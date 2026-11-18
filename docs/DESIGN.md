# SKITCH — Design

One-thumb skating in Santa Rampa, a steep port city. There is no push button. Gravity gives you speed
downhill; going uphill means hitching onto something that moves.

This file describes the game as built. Code contracts named here (`src/sim/types.ts`, `world.ts`,
`lines.ts`, `constants.ts`) are the source of truth where they are more precise than the prose; what
was cut or built smaller is listed at the end of `docs/DECISIONS.md`.

## 1. Pillars

1. **Borrowed speed.** Every metre of altitude is earned by catching a ride. The city is a machine of
   moving things and the player reads it like a timetable.
2. **One thumb.** Drag, hold, release, swipe up. Nothing else in play. Four small corner buttons
   (map, chalk, ledger, pause) open screens; none of them is needed to skate.
3. **The whip.** Releasing a ride is the best-feeling thing in the game. Timing sets the angle;
   chains set the speed.
4. **A city worth learning.** One seamless hillside, a 12-minute day, a deterministic timetable.
   Knowledge of the place is the progression.
5. **Painted-bus maximalism.** Loud, flat, printed. It should look like a risograph poster of a
   decorated bus.

## 2. Controls

All input is one touch. The gesture layer (`src/input/gestures.ts`) turns it into an `InputFrame`
per sim tick: `{ steer: -1..1, hold: boolean, hop: boolean }`. It is clocked by sim ticks, so a
scripted touch replays identically.

| Gesture | Result |
| --- | --- |
| Touch and drag left/right | **Carve.** `steer` = horizontal offset from the anchor / `STEER_RANGE_PX`. The anchor follows a finger dragged past full lock, so reversing responds at once. |
| Touch and keep the finger still for `HOLD_ARM_TIME` | **Hold** arms. While armed, the skater hitches to the nearest ride in reach the moment one is in reach. Dragging after arming still steers (leans the swing while hitched). |
| Hold a still finger with no ride near | **Plant a foot.** Below `FOOT_SPEED`, with steer under `FOOT_STEER`, the board brakes at `FOOT_BRAKE` and holds, even on a slope, until the finger lifts or a grab point comes into reach (then it latches). A ride you could grab at standing height, ahead of where you are rolling and within `FOOT_NEAR`, keeps a rolling skater rolling so they coast into it; one already slower than `FOOT_STAND` stays put and lets it come. It only ever removes speed. This is how you stop and wait at a stop. |
| Drag past `DRAG_DEADZONE_PX` before arming | That touch is a pure carve; it never hitches. Lift and press again to grab. |
| Lift the finger while hitched | **Release**: slingshot. |
| Swipe up (`SWIPE_UP_PX` within `SWIPE_UP_TIME`) | **Hop.** On the ground: ollie. On a rail or wall: jump off. While hitched: release with extra height. The touch stays armed if the finger stays down, so *swipe-up-and-hold* hops into an overhead ride. |
| Hold still in an errand giver's spot | **Accept the offer.** Slow, not hitched, armed and no ride in reach: the offer fills in 0.6 s. |

Keyboard (desktop and debugging): Left/A and Right/D steer, Space holds, Up/W hops. M opens the line
map, L the ledger, P pauses, Escape closes a screen.

No push. To avoid a soft lock on the flat, tic-tac carving (alternating steer) adds a trickle of
speed below `PUMP_SPEED_CAP` (about walking pace). It is never a way to climb.

## 3. Movement model

The sim is a point skater with a heading, on a heightfield with boxes, rails and rides. Modes:

- **GROUND** — rolls along heading. Gravity along the slope accelerates or brakes. Rolling resistance
  and air drag set terminal speed. Steer turns the heading, tighter at low speed; carving scrubs a
  little speed. At low speed the board drifts toward the fall line. Stairs are a rough surface: slow
  and rattly. Crests and ledges launch you when the ground falls away faster than a ballistic arc.
- **AIR** — ballistic, slight air steer. Lands on whatever surface is below (street, roof, awning).
  Landing projects velocity onto the surface, so landing on a downslope keeps speed. Awnings bounce,
  and send a skater who comes straight down off along their heading.
- **GRIND** — snapped to a rail polyline; gravity along the rail drives it. Enter by being airborne
  on top of a rail roughly along it (the rail magnet reaches `RAIL_SNAP` sideways). Leaves at the
  rail end or by hopping (steer picks the side).
- **WALL** — wallride: airborne contact with a wall at a shallow angle. Low gravity for a moment,
  then drop off or hop to wall-jump. Riding over the top lip puts you on the roof.
- **HITCH** — attached to a ride by a strap. See below.
- **BAIL** — head-on wall hit at speed, very hard landing, a vehicle, or water. A short tumble, chain
  lost, then back on the board at a standstill (water puts you back at the last safe spot, at least
  `SAFE_MARGIN` from the edge, facing away from it). The safe spot refreshes every half second on
  safe ground and on the first grounded tick after any ride, grind, wallride or air.

Smaller rules that keep a push-less skater moving: a board that stalls facing uphill kickturns and
rolls back down; a slow square hit on a wall (under `WALL_SLIDE_SPEED`) turns the board along the
wall, a fast one bounces back; the ground curls up at the side edges of the world; rolling onto an
awning throws you; entering a rail adds a little speed and a rail too flat to slide on lets you step
off. A skater at rest is always on locally level ground (under 1.5%).

### Hitch, slingshot, chain

- **Reach.** While `hold` is armed, the nearest active ride whose grab point is within `HITCH_REACH`
  (and `HITCH_REACH_Y`) of the skater's hand latches. Ground rides have a grab point at the rear
  bumper and can only be caught from beside or behind it (`HITCH_AHEAD`), as it comes past; overhead
  rides (crane hook, cable cars, kites, blimp) have a strap hanging `hang` metres below them, so they
  are caught from a hop, a rail, a roof or the air.
- **Tow.** Hitched, the skater is a pendulum on a rope behind the ride: world-space angle with a
  restoring pull toward "straight behind the ride's velocity", light damping, a self-sustaining
  minimum swing, and `steer` as a strong torque that drives the swing. When the ride corners, the
  skater cracks the whip. Height follows the ground, or hangs under an overhead ride.
- **Slingshot.** On release the skater leaves in the direction they are actually moving (ride
  velocity + swing velocity), at `max(speed * SLING_GAIN, SLING_MIN) + LINK_BONUS * chain`, capped at
  `SLING_CAP` (or the speed they already had, if higher), with an upward pop (`SLING_POP`, plus up to
  `SLING_VY_CARRY` of any climb the tow was giving, plus `SLING_HOP_POP` on a swipe-up release).
  Release mid-swing to fling wide; release at the end of a swing to go straight. An aim arrow on the
  ground shows the current exit vector. A release only registers once the strap has taken up its
  slack (`YANK_TIME`, `HITCH_MIN_TIME`). If the ride leaves service, or drags the skater round a
  corner behind a wall (`STRAP_SLIP`), the strap lets go without a sling and the chain stays alive.
- **Chain.** A chain is alive from a release until the skater has rolled on the ground for
  `CHAIN_GROUND_GRACE`. Air, grinds and wallrides do not end it. Catching a *different* vehicle while
  the chain is alive adds a link. Each link adds `LINK_BONUS` exit speed, up to the cap. Re-catching
  the same vehicle keeps the chain but adds no link. A bail ends it. The chain meter shows ×N with a
  pip per link and, in flight, a bar draining with the ground grace; a chain of two or more that ends
  shows its count in pink for a moment (a single ride ending shows nothing).
- **Gates.** A line may declare `minChain`: it can only be caught as the Nth link (Cometa Rey, 4).
- **Vehicle bodies.** Ground rides are solid: they shove a slow skater aside, bounce one off a flank
  (bringing them up to a share of the ride's speed), bail one they meet head-on or who rams their
  back at speed, and bounce one who comes down on the roof (which keeps a chain alive). Nobody stands
  on a moving roof.

Every constant above lives in `FEEL` (`src/sim/constants.ts`) and in the `?debug` panel.

## 4. The city

One seamless hillside, uphill = +z, sea at z < 0. 360 m wide (x −180..180) and 1344 m long
(z −42..1302) on a 3 m grid, 230 m of climb from the quay to the summit.

| Band | z range (m) | Altitude (m) | Character | Rides |
| --- | --- | --- | --- | --- |
| **Docks** | 0–280 | 3–6 | Flat quays (1% grade), warehouses, container stacks, the fish market, the ferry pier. Wide and open. | Gantry crane (overhead), forklifts, fish trucks |
| **Mercado Steps** | 280–600 | 6–70 | The spine staircase with landings, stair alleys, market awnings (bouncy), handrails everywhere, two switchback ramp roads at the edges. Tight. | Mopeds, handcarts, the wedding parade |
| **Terraces** | 600–940 | 70–150 | Switchback roads across flat residential terraces with retaining walls, laundry lines, low roofs. | Funicular, trams 5 and 9, the night bus |
| **Antenna Hill** | 940–1280 | 150–230 | Bare windy summit: masts, guy wires, dishes, grass, the hill station platform, the radio shack, the Needle. Sparse ground, busy sky. | Cable cars (two lines), kites, the blimp |

World representation (contract: `src/sim/world.ts`):

- **Heightfield** grid, `cell` metres square, bilinear. It *is* the ground: streets, stair ramps,
  terraces, banks. A per-cell **surface** type: street, plaza, stairs, dirt, grass, track, water.
- **Solids**: oriented boxes with a rideable flat top (buildings/roofs, awnings, containers, crates,
  walls). `yBase..yTop`; thin slabs (awnings) can be skated under. The city has about 1700.
- **Rails**: 3D polylines (handrails, ledges, wires, pipes, guy wires). About 250.
- **Lines**: ride definitions (see section 5).
- **Zones**: named discs used by errands, stops, secrets and districts: spawns, landmarks, errand
  givers, stops (one per line stop), chain meeting points and two secret zones.

The layout is hand-authored (`src/sim/city/layout.ts`); the seeded RNG only dresses it. The sim
holds the whole city's collision data in a spatial hash. Rendering streams 60 m chunks (20 cells)
around the camera: fully dressed within 170 m, as silhouettes to 330 m, built from the same data in
one-row pieces within 2 ms a frame, so what you see is what you collide with.

## 5. Rides, lines and time

A **line** is a path with stops, vehicles and service hours. Vehicles are a pure function of the
day tick (`vehicleAt(line, i, tick)`): each line has a lap table whose period divides the day, so the
timetable is identical every day and can be learned. A `phase` offset makes designed meetings
between lines recur on every lap.

Day: 12 minutes = 43 200 ticks. `dayFrac` 0 = midnight. Dawn 0.22–0.30, day 0.30–0.72, dusk
0.72–0.80, night 0.80–0.22. A new game starts at 0.4036 (09:41; the board's clock steps in five
minutes and shows 09:40), chosen so the first ride reaches the first stop as a new player does
(`src/app/newGame.ts`). Fixtures and scripted routes start at 0.30 unless `t=` says otherwise.

A vehicle is in service for a lap if that lap *started* inside a service window, so vehicles leave the
terminus on time and always finish their run. Ground lines drive on the right, each in a lane offset
from its route's centre line. Data: `src/sim/city/lines.ts` (roster) and `routes.ts` (paths, stops).

| Id | Name | District (track) | Stem | Kind | Cruise m/s | Laps leave | Lap | Stops |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D1 | Grúa Uno | Docks (cumbia) | perc | gantry crane ×1, overhead, shuttle | 4 | all day | 180 s | Grúa Oeste, Grúa Centro, Grúa Este |
| D2 | Montacargas | Docks | bass | forklifts ×3 | 7 | 0.30–0.72 | 240 s | Almacenes Sur, Almacenes Este, Cocheras, Almacenes Oeste, Muelle Oeste, Contenedores, Grúa Este, Muelle Este, Bulevar Este, Almacenes Centro |
| D3 | Pescado Express | Docks | harmony | fish trucks ×2 | 8 | 0.22–0.50 | 240 s | Lonja, Bulevar, Puerta del Mercado, Muelle |
| M1 | Las Motos | Mercado (funk) | perc | mopeds ×4 | 11 | 0.30–0.80 | 144 s | Bulevar, Rampa Oeste, Rellano 410, Rampa Este |
| M2 | Carretillas | Mercado | bass | handcarts ×3 | 3.5 | 0.22–0.65 | 240 s | Rellano 358, Rampa Oeste, Rellano 410, Rampa Este |
| M3 | La Boda | Mercado | harmony | wedding parade ×1 (float + band) | 2.2 | 0.60 and 0.70 | 72 s | Iglesia, Fuente, Torre |
| T1 | Funicular | Terraces (highlife) | perc | funicular ×2 | 11 | all day | 120 s | Base, Cima |
| T2 | Tranvía 5 | Terraces | bass | tram ×3 | 13 | all day | 360 s | Muelle, Mercado, Terrazas, Puerta de la Antena, Escuela, Mercado Este |
| T3 | Tranvía 9 | Terraces | harmony | tram ×2 | 10 | 0.30–0.80 | 180 s | Terraza Baja, Zigzag Oeste, Terraza Alta, Zigzag Este |
| T4 | Nocturno | Terraces | lead | night bus ×2 | 18 | 0.80–1.00 | 180 s | Garaje, Rampa Este, Terraza 727, Rampa Oeste |
| A1 | Teleférico Bajo | Antenna (city pop) | perc | cable cars ×4, overhead | 7 | all day | 45 s | Puerta, Estación del Cerro |
| A2 | Teleférico Cumbre | Antenna | bass | cable cars ×3, overhead | 7 | 0.30–0.80 | 90 s | Estación del Cerro, Cresta |
| A3 | Cometas | Antenna | harmony | kites ×5, overhead | 8 | 0.35–0.70 (windy) | 90 s | Campo Sur, Campo Este |
| S1 | Tranvía Fantasma | (secret) | lead (Terraces) | ghost tram ×1 | 12 | one lap at 0.00 | 80 s | Túnel, Terraza Baja |
| S2 | El Dirigible | (secret) | lead (Antenna) | blimp ×1, overhead | 6.5 | one lap at 0.76 | about 170 s | Estación del Cerro, Cerro Sur, Cumbre |
| S3 | Cometa Rey | (secret) | lead (Antenna) | king kite ×1, overhead, `minChain` 4, shuttle | 11 | 0.417, 0.542, 0.667 | 90 s | La Aguja, Cresta Sur, La Aguja |

Notes. Tram 5 is the main way up: the docks to the Antenna gate and back, one every two minutes.
The funicular runs straight up from the top of the Mercado to the Antenna gate. The night bus is an
express: home by about 0.19, none on the road by day. The ghost tram, the blimp and the king kite vanish
while they wait at the terminus. The blimp waits 5 s over the hill station platform at 0.76 with its
ladder 4.2 m above the deck (a hop's reach), laps by Cerro Sur and the summit, and sets its rider
down on the deck again at about 0.9965. Cometa Rey flies out from the Needle by Cresta Sur, perches
on the Needle 5 s, flies the circuit back and goes out of service on the Needle, setting its rider
down; it can only be caught as the fourth link of the summit chain (lower cable car → summit cable
car → kite → king kite), which lines up at 0.5125 and 0.6375.

**Line map.** Each line's path is split into segments between consecutive stops. Staying hitched to
a vehicle of that line across a whole segment inks it (the hitch may begin within `min(12 m,
segment / 4)` of the segment's start). A line is complete when every segment is inked. The map is
complete when all 13 regular lines are; that opens the map-complete celebration. Secret lines appear
on the map once first ridden.

## 6. Things to do

- **First launch** (`src/sim/game/onboarding.ts`): the game teaches by play, one hint at a time on a
  small ticket stub with an animated thumb glyph and a pointer in the world. Nothing blocks; a step
  counts whenever it happens. The lesson is four steps in the order the hill presents them: carve
  ("DRAG", once rolling at 4 m/s or for 6 s), hitch ("PRESS AND HOLD STILL", leading the player to a
  waiting spot beside a stop where a ride is due, then to the ride's grab bar), ink ("STAY ON TO THE
  NEXT STOP"), sling ("DRAG... THEN LET GO"). Then two closing tickets: the map, and "NO PUSHING.
  EVERYTHING THAT MOVES IS A LIFT." Four more hints show in their situations until each is done
  once and are not part of completion: hop, grind, chain, and roll ("WIGGLE TO ROLL", after 3 s
  stalled on flat ground). Errand offers wait until the first hitch. Hints follow the Hints setting;
  fixtures (`t=`, a test world, a route) skip the lesson. A new game starts at the lookout, above
  the first ground stop, Rellano 410.
- **Line map** (section 5): the spine of progression.
- **Errands** (`src/sim/game/content/errands.ts`): 13 timed jobs of 2–4 minutes from givers at fixed
  spots: Docks 3, Mercado 4, Terraces 3, Antenna Hill 3. Step types: go to a zone, hitch a given
  line, ride a line to a zone, deliver to a zone (optionally slowly), arrive with a chain of N, grind
  N metres, stay in the air N seconds; any step may forbid a bail. Some givers keep hours. Accepted
  by holding still in the giver's spot; a giver whose offer was left alone stays quiet for 45 s.
  Finished errands can be replayed for a better time.
- **Conductor challenges** (`src/sim/game/content/conductors.ts`): one per regular line (13), started
  by hitching that line within 30 m of its conductor's stop. Tasks: chain N starting from this line,
  sling distance, air time off a sling, stay on for N segments, stop to stop within a time, land on a
  named place (the hill station platform). Each sling number is 0.75 of the best a scripted whip
  achieves off that ride, re-measured by a test.
- **Secrets** (`src/sim/game/secrets.ts`), four: ride the ghost tram (just after midnight), ride the
  blimp (its one lap at dusk), stand on the Needle at the summit (only reachable by Cometa Rey), and
  find the ghost tram's tunnel (Túnel Fantasma, a covered stretch on the top Mercado landing). Each
  secret line can be finished in one ride and leaves the rider standing. The way down from the Needle
  is its guy wire, a grind from the platform's south edge to the summit lawn. The hill station
  platform has run-in steps from the lawn and the spine, so a skater from the summit (up to 14 m/s)
  can stop on it with a planted foot.
- **Ledger** (L, or its corner button): errands with best times, conductors' punched tickets, secrets
  found.
- **Chalk lines** (`src/sim/game/chalk.ts`): start recording anywhere with open sky, stop anywhere
  (up to 4 minutes; up to 20 lines kept; names up to 24 characters). A line is its canonical start
  (position, heading, speed), its time of day and its quantised input stream (63 steer levels).
  It exports as a text share code, `SK2-` + base64url, with the inputs arithmetic-coded: about
  0.7 kB for 30 s of jittery thumb, 2.4 kB for 2 minutes, 4.8 kB for 4 minutes. A link with
  `?chalk=SK2-...` opens the import box pre-filled. Racing a line moves the clock to its recorded
  time minus a three-second countdown and runs the ghost as a second deterministic skater beside
  the player; beat its time to the end zone (a loop must be skated: the finish counts only after
  leaving it). Local only: no backend, no online sharing.
- **Saves** (`src/sim/game/save.ts`, `src/app/save.ts`): `localStorage`, one slot, version 2 (a
  version 1 save upgrades). It keeps the resume spot (the last safe spot), the time of day and the
  day count, settings, and every reducer's state: line map, onboarding, errands, conductors,
  secrets, chalk lines. Autosaved every 15 s of play and on progress events, with the previous good
  save kept as a backup; a corrupt save falls back to the backup. App-only settings (reduced motion,
  print pass) and play time live under their own key. NEW GAME keeps settings; RESET SAVE clears
  them too.

## 7. Look

Painted-bus maximalism, printed on a risograph (`src/render/look.ts`).

- **Palette** (inks): mango `#FFAE1A`, hot pink `#FF2E88`, teal `#00A99D`, cobalt `#1F3FBF`, on
  sun-bleached concrete `#D9D2C3`, paper `#F3EBDD`, ink `#1B1A2E`, plus a few supporting mixes
  (asphalt, curb, brick, sand, leaf, sea). Districts lean: Docks teal + mango, Mercado pink + mango,
  Terraces mango + cobalt, Antenna cobalt + pink.
- **Form**: chunky low-poly, flat-shaded, no textures. Colour is per-vertex flat ink.
- **Shadow**: no smooth shading. Faces turned from the sun get a screen-space **halftone** dot
  screen of shadow ink (cobalt-leaning multiply). Two tones plus dots. Moving things and the skater
  get a halftone blob shadow on the ground (vehicles within 120 m). No shadow maps.
- **Misregistration**: a post pass prints the pink and cobalt plates a pixel or two off-register in
  fixed, different directions, with paper grain and slight ink density noise. Settings can turn the
  print pass off.
- **Haze**: clear to 190 m, the horizon colour by 350 m, just past where the streamed city stops,
  so the furthest chunks arrive already in the haze.
- **Liveries**: every line has a base colour, a stripe colour, an accent and one of six patterns
  (band, chevrons, checks, diagonal, dots, zigzag) as geometry on its flanks, and a roof mark: no two
  lines share a base + pattern pair (`LIVERIES` in `src/sim/lineup.ts`).
- **Day and night**: sky and ink ramps move through dawn (pink), day (bleached), dusk (mango) and
  night. Night prints in cobalt: lit faces are tinted to about a third of their red and green, and
  windows, signs, lamps and cabin lights glow mango. About half the windows of a building are lit,
  in a fixed pattern from the solid's index: facade windows (laid down a slope from the ground under
  each column), glass roof lanterns on flat roofs (what the camera sees of the town below it),
  warehouse clerestories and stall lanterns. Far silhouettes carry the lit glass of the same
  windows, so the hill reads as a town. A sun crosses by day and a moon by night; stars come out.
- **Characters animate on twos**: poses update at 12 Hz while position stays smooth. So do vehicle
  animation frames and every UI flip and slide.
- **UI** (`src/ui/`): destination boards (split-flap rows, condensed caps, mango on ink) for line,
  speed, chain, clock and each stop's timetable; ticket stubs (perforated, punched) for errands,
  challenges, hints and toasts; a transit-map screen; title, pause, settings and map-complete screens;
  a rotate card in landscape. Drawn with CSS and inline SVG. No images, no web fonts.
- **World markers**: errand givers, conductors (cap and coat in their line's livery), a beacon over
  the active errand's target, the chalk ghost, and the onboarding pointer (a chevron over a grab point, a ring at a waiting spot, an edge arrow
  when the target is off screen).

Render contract (`src/render/look.ts`): every world mesh uses `inkMaterial()` with attributes
`position` and `color`; optional `glow` (0..1, lit at night). No normals: faces are flat-shaded from
screen-space derivatives. Colour management is off: inks are authored and output in display space.
Geometry is built with `MeshBuilder` (`src/render/geom.ts`).

### Camera

A chase camera for a portrait screen (`src/render/camera.ts`). It sits behind the direction of travel
(behind the ride while hitched, so the swing reads against a steady frame), keeps the skater low in
the frame, widens and backs off with speed, lifts when hitched, airborne or climbing, and tilts its
look target with the ground ahead (`CAM_LOOK_FAR`). When something blocks the view it pulls in to the
furthest of nine distances from which the skater's chest and board can both be seen, sampling the
sight lines every 0.4 m from where the skater really is; when all nine are blocked (a low awning
between even the closest and the skater) it ducks to shoulder height behind them. Under an awning
it goes under with the skater instead of climbing onto the roof. It keeps
`CAM_MIN_CLEAR` above the ground and roofs below it, never lets the skater sit more than
`CAM_FRAME_MAX` degrees below the centre of the view, rattles on stairs, shakes on impacts, and cuts
instead of flying after a teleport.

## 8. Sound

Web Audio synthesis only (`src/audio/`). Four district tracks, each a looping 8-bar arrangement in
four stems: **perc, bass, harmony, lead**.

| District | Style | Tempo | Flavour |
| --- | --- | --- | --- |
| Docks | cumbia | 92 | guacharaca + kick, tumbao bass, accordion stabs, clarinet lead |
| Mercado Steps | funk | 104 | tight kit, slap-ish bass, wah clav, horn hits |
| Terraces | highlife | 116 | bell pattern + shaker, walking bass, palm-wine guitar arps, horn lead |
| Antenna Hill | city pop | 100 | gated kit, octave synth bass, electric-piano maj7 pads, glassy lead |

Mix rules, driven by sim events (the pure state machine in `src/audio/mixer.ts`):

- Always: wheel noise (filtered noise, pitch and level by speed, surface changes the filter), wind in
  the air and on Antenna Hill, ride motors (rail, engine or hum) for the nearest ride within 25 m.
- **Hitching** a line fades in that line's stem of its *own* district's track (starting on the next
  beat). Stems of earlier links in the current chain stay in.
- **Chain of 3+** brings in the full band for the current line's district.
- Landing and ending the chain fades stems out over two bars. **Bailing** cuts to wheel noise at once.
- One track plays at a time: the track of the most recent hitch; a change cross-fades over one beat.
- One-shots: hop, landing, awning boing, scuffs and thuds, a release note on the track's scale that
  rises with the chain, a "denied" buzz, the bail.

Audio starts on the first touch or key (browser autoplay rules). `?mute` starts muted; Settings has
music and effects volumes.

## 9. Architecture

```
input (touch) ──> InputFrame ──> Sim.step() ──> SimState + SimEvents
                                      │                 │
                         World (static, generated)      ├──> render (interpolated)
                         Lines (pure fn of tick)        ├──> audio (events + state)
                                                        └──> ui / game systems
```

- Fixed step 60 Hz, accumulator in `src/app/main.ts`, at most 4 catch-up steps per frame.
- The sim never reads wall-clock time, the DOM or a random source other than its seeded RNG, and uses
  only deterministic math (`src/sim/math.ts`). Two sims with the same world, seed and input stream
  are bit-identical on any engine. That is what makes ghosts and scripted tests exact.
- Game systems (line map progress, onboarding, errands, conductors, secrets, chalk) are
  deterministic reducers over sim state and events, under `src/sim/game/`, stepped by `Game`. Steer
  is quantised to 63 levels for everyone, always, so a recording never differs from play.
- Render, audio and UI are observers. They may keep their own presentation state but never feed back
  into the sim except through `InputFrame` and explicit game commands (take an errand, record or race
  chalk); the UI's `paused` stops the stepping.
- With `?e2e` nothing runs on its own: the harness advances time through `window.__skitch`
  (`src/app/testHook.ts`).

## 10. Performance budgets

Target: 60 fps on a mid-range phone (2021-class, e.g. Snapdragon 7-series / A13).

| Budget | Limit | Where it is checked |
| --- | --- | --- |
| Draw calls per frame | ≤ 120 | `npm run perf`: most in any timed frame and at any tour viewpoint |
| Triangles per frame | ≤ 180 000 | the same |
| Main-thread frame work (rAF callback: sim + scene update + render submit), headless Chrome, 4x CPU throttle | mean ≤ 10 ms, p95 ≤ 16.6 ms | `npm run perf`, pooled over the timed windows |
| Game step (sim plus every reducer) | mean ≤ 0.6 ms, p95 ≤ 1.5 ms | `npm run perf` |
| Frames that carry exactly one sim step | mean ≤ 6 ms (p95 reported, not gated) | `npm run perf` |
| JS bundle | ≤ 400 kB gzip | `npm run perf` |
| Sim step on the feel slice | ≤ 0.3 ms mean in Node | `tests/sim/movement.test.ts` |
| Device pixel ratio | capped at 2 | `src/render/view.ts` |

Budgets live in `tests/perf/budgets.json`. `npm run perf` runs two checks in headless Chrome at 4x
CPU throttle and fails the gate when a budget is exceeded. First, the `perfcity` route rides the
city the way a player would (carving, hopping, hitching, slinging) in five legs of 600 ticks:
Mercado, Terraces, Antenna Hill, a fast run down the Terraces spine that crosses chunk rows while
the world streams, and the Docks. Ticks 150–600 of each leg are timed as normal frames of the normal
loop; the frames of all windows are pooled for the gated figures, and each window's mean, p95, draw
calls, triangles and per-part breakdown are printed with its district. The run fails unless it went
somewhere: every window travels at least 40 m, the windows see all four districts, at least two
hitches fall in timed frames and two windows hitch and sling, one window crosses two chunk
boundaries at 8 m/s or more while chunks are built, and there are at least 300 timed frames.
Second, a tour of fixed viewpoints in every district by day and night, for the draw-call and
triangle maxima. Headless Chrome rasterises in software, so GPU cost is not representative there;
the frame-work figure is the main-thread cost only. Real-device frame time is the first item on the
PLAYTEST list.

## 11. Platform

Installable PWA, portrait (`"orientation": "portrait"`, a fullscreen orientation lock where the
browser allows it, and a rotate card that pauses play in landscape), offline after first load (a
service worker generated after the build precaches every built file; a new build waits and offers
itself as a "NEW TIMETABLE" ticket until RELOAD), safe-area aware, no network calls at runtime.
Icons are drawn and PNG-encoded in code at build time. Auto-pause on blur or hide. Haptics through
`navigator.vibrate` where present (not on iOS Safari). Every URL is relative, so `dist/` works under
any sub-path; nothing assumes a browser chrome.
