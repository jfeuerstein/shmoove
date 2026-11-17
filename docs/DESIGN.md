# SKITCH — Design

One-thumb skating in Santa Rampa, a steep port city. There is no push button. Gravity gives you speed
downhill; going uphill means hitching onto something that moves.

This file is the spec. Code contracts named here (`src/sim/types.ts`, `world.ts`, `lines.ts`) are the
source of truth where they are more precise than the prose.

## 1. Pillars

1. **Borrowed speed.** Every metre of altitude is earned by catching a ride. The city is a machine of
   moving things and the player reads it like a timetable.
2. **One thumb.** Drag, hold, release, swipe up. Nothing else, ever. No on-screen buttons in play.
3. **The whip.** Releasing a ride is the best-feeling thing in the game. Timing sets the angle;
   chains set the speed.
4. **A city worth learning.** One seamless hillside, a 12-minute day, a deterministic timetable.
   Knowledge of the place is the progression.
5. **Painted-bus maximalism.** Loud, flat, printed. It should look like a risograph poster of a
   decorated bus.

## 2. Controls

All input is one touch. The gesture layer (`src/input/gestures.ts`) turns it into an `InputFrame`
per sim tick: `{ steer: -1..1, hold: boolean, hop: boolean }`.

| Gesture | Result |
| --- | --- |
| Touch and drag left/right | **Carve.** `steer` = horizontal offset from touch-down / `STEER_RANGE_PX`. |
| Touch without dragging sideways for `HOLD_ARM_TIME` | **Hold** arms. While armed, the skater hitches to the nearest ride in reach the moment one is in reach. Dragging after arming still steers (leans the swing while hitched). |
| Drag past the dead zone before arming | That touch is a pure carve; it never hitches. Lift and press again to grab. |
| Lift the finger while hitched | **Release**: slingshot. |
| Swipe up (fast upward flick) | **Hop.** On the ground: ollie. On a rail or wall: jump off. While hitched: release with extra height. The touch stays armed if the finger stays down, so *swipe-up-and-hold* hops into an overhead ride. |

Desktop/debug: arrow keys or A/D steer, Space holds, W / Up hops.

No push. To avoid a soft lock on the flat, tic-tac carving (alternating steer) adds a trickle of
speed below `PUMP_SPEED_CAP` (about walking pace). It is never a way to climb.

## 3. Movement model

The sim is a point skater with a heading, on a heightfield with boxes, rails and rides. Modes:

- **GROUND** — rolls along heading. Gravity along the slope accelerates or brakes. Rolling resistance
  and air drag set terminal speed. Steer turns the heading, tighter at low speed; carving scrubs a
  little speed. At low speed the board drifts toward the fall line. Stairs are a rough surface: slow
  and rattly. Crests and ledges launch you when the ground falls away faster than a ballistic arc.
- **AIR** — ballistic, slight air steer. Lands on whatever surface is below (street, roof, awning).
  Landing projects velocity onto the surface, so landing on a downslope keeps speed. Awnings bounce.
- **GRIND** — snapped to a rail polyline; gravity along the rail drives it. Enter by being airborne
  on top of a rail roughly along it. Leaves at the rail end or by hopping (steer picks the side).
- **WALL** — wallride: airborne contact with a wall at a shallow angle. Low gravity for a moment,
  then drop off or hop to wall-jump. Riding over the top lip puts you on the roof.
- **HITCH** — attached to a ride by a strap. See below.
- **BAIL** — head-on wall hit at speed, very hard landing, a vehicle, or water. A short tumble, chain
  lost, then back on the board at a standstill (water puts you back at the last safe ground, well
  clear of the edge, facing away from it).

Smaller rules that keep a push-less skater moving: a board that stalls facing uphill kickturns and
rolls back down; a slow square hit on a wall turns the board along the wall (a fast one bounces
back); the edge of the world turns you round; rolling onto an awning throws you; entering a rail
adds a little speed and a rail too flat to slide on lets you step off.

### Hitch, slingshot, chain

- **Reach.** While `hold` is armed, the nearest active ride whose grab point is within `HITCH_REACH`
  of the skater's hand latches. Ground rides have a grab point at the rear bumper; overhead rides
  (crane hook, cable car, kite, blimp) have a strap hanging `hang` metres below them, so they are
  caught from a hop, a rail, a roof or the air.
- **Tow.** Hitched, the skater is a pendulum on a rope behind the ride: world-space angle with a
  restoring pull toward "straight behind the ride's velocity", light damping, a self-sustaining
  minimum swing, and `steer` as a lean torque. When the ride corners, the skater cracks the whip.
  Height follows the ground, or hangs under an overhead ride.
- **Slingshot.** On release the skater leaves in the direction they are actually moving (ride
  velocity + swing velocity), at `max(speed * SLING_GAIN, SLING_MIN) + LINK_BONUS * chain`, capped at
  `SLING_CAP` (or the speed they already had, if higher), with an upward pop (`SLING_POP`, plus up to
  `SLING_VY_CARRY` of any climb the tow was giving, plus `SLING_HOP_POP` on a swipe-up release).
  Release mid-swing to fling wide; release at the end of a swing to go straight. An aim arrow on the
  ground shows the current exit vector. A release only registers once the strap has taken up its
  slack (`YANK_TIME`). If the ride leaves service, or drags the skater round a corner behind a wall,
  the strap lets go without a sling.
- **Chain.** A chain is alive from a release until the skater has rolled on the ground for
  `CHAIN_GROUND_GRACE`. Air, grinds and wallrides do not end it. Catching a *different* vehicle while
  the chain is alive adds a link. Each link adds `LINK_BONUS` exit speed, up to the cap. Re-catching
  the same vehicle keeps the chain but adds no link. A bail ends it.
- **Gates.** A line may declare `minChain`: it can only be caught as the Nth link (the summit kite).
- **Vehicle bodies.** Ground rides are solid: they shove a slow skater aside, bail one they meet
  head-on or who rams their back at speed, and bounce one who comes down on the roof (which keeps a chain alive). A bumper
  can only be grabbed from beside or behind it, as it comes past.

Every constant above lives in `FEEL` (`src/sim/constants.ts`) and in the `?debug` panel.

## 4. The city

One seamless hillside, uphill = +z, sea at z < 0. About 360 m wide and 1300 m long, 230 m of climb.

| Band | z range (m) | Altitude (m) | Character | Rides |
| --- | --- | --- | --- | --- |
| **Docks** | 0–280 | 2–8 | Flat quays, warehouses, container stacks, the fish market. Wide and open. | Gantry crane (overhead), forklifts, fish trucks |
| **Mercado Steps** | 280–600 | 8–70 | Stair streets, landings, market awnings (bouncy), handrails everywhere. Tight. | Mopeds, handcarts, the wedding parade |
| **Terraces** | 600–940 | 70–150 | Switchback roads across flat residential terraces with retaining walls, laundry lines, low roofs. | Funicular, trams 5 and 9, the night bus |
| **Antenna Hill** | 940–1280 | 150–230 | Bare windy summit: masts, guy wires, dishes, grass. Sparse ground, busy sky. | Cable cars (two lines), kites, the blimp |

World representation (contract: `src/sim/world.ts`):

- **Heightfield** grid, `cell` metres square, bilinear. It *is* the ground: streets, stair ramps,
  terraces, banks. A per-cell **surface** type: street, plaza, stairs, dirt, grass, track, water.
- **Solids**: oriented boxes with a rideable flat top (buildings/roofs, awnings, containers, crates,
  walls). `yBase..yTop`; thin slabs (awnings) can be skated under.
- **Rails**: 3D polylines (handrails, ledges, wires, pipes, guy wires).
- **Lines**: ride definitions (see section 5).
- **Zones**: named discs/boxes used by errands, stops, secrets and districts.

The sim holds the whole city's collision data in a spatial hash (it is small). Rendering streams
64 m chunks around the camera, building merged meshes from the same data, so what you see is what
you collide with.

## 5. Rides, lines and time

A **line** is a path with stops, vehicles and service hours. Vehicles are a pure function of the
day tick (`vehicleAt(line, i, tick)`): each line has a lap table whose period divides the day, so the
timetable is identical every day and can be learned.

Day: 12 minutes = 43 200 ticks. `dayFrac` 0 = midnight. Dawn 0.22–0.30, day 0.30–0.72, dusk
0.72–0.80, night 0.80–0.22. A new game starts at 0.30.

A vehicle is in service for a lap if that lap *started* inside a service window, so vehicles leave the
terminus on time and always finish their run.

| Id | Name | District (track) | Stem | Kind | Hours | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | Grúa Uno | Docks (cumbia) | perc | gantry crane, overhead | all day | Shuttles along the quay; the hook is the strap. |
| D2 | Montacargas | Docks | bass | forklifts ×3 | day | Loop round the warehouses. |
| D3 | Pescado Express | Docks | harmony | fish trucks ×2 | dawn–noon | Docks up to the Mercado gate and back. |
| M1 | Las Motos | Mercado (funk) | perc | mopeds ×4 | day + dusk | Fast loop on the ramps beside the stairs. |
| M2 | Carretillas | Mercado | bass | handcarts ×3 | dawn–afternoon | Slow, downhill, easy to catch. |
| M3 | La Boda | Mercado | harmony | wedding parade, 1 float + band | 0.55–0.72 only | Slow loop round the plaza. |
| T1 | Funicular | Terraces (highlife) | perc | funicular ×2, shuttle | all day | Straight up from Mercado top to the Antenna gate. |
| T2 | Tranvía 5 | Terraces | bass | tram ×3 | all day | Docks → Mercado → Terraces. The main way up. |
| T3 | Tranvía 9 | Terraces | harmony | tram ×2 | day + dusk | Switchback loop across the terraces. |
| T4 | Nocturno | Terraces | lead | night bus ×2 | night only | Long loop, Terraces down to the Docks. |
| A1 | Teleférico Bajo | Antenna (city pop) | perc | cable cars ×4, overhead | all day | Terraces top → hill station. |
| A2 | Teleférico Cumbre | Antenna | bass | cable cars ×3, overhead | day + dusk | Hill station → summit ridge. |
| A3 | Cometas | Antenna | harmony | kites ×5, overhead | windy hours 0.35–0.70 | Circles over the hill. |
| S1 | Tranvía Fantasma | (secret) | lead (Terraces) | ghost tram | 0.00–0.06 only | Disused track; not on the map until ridden. |
| S2 | El Dirigible | (secret) | lead (Antenna) | blimp, overhead | one lap at 0.76 | Off the timetable. Waits over the hill station platform at 0.76 (ladder a hop above the deck), laps by Cerro Sur and the summit, sets the rider down on the deck again at about 0.996. Stops: Estación del Cerro, Cerro Sur, Cumbre. |
| S3 | Cometa Rey | (secret) | lead (Antenna) | king kite, overhead, `minChain` 4 | laps leave 0.35–0.70 (0.417, 0.542, 0.667) | Only catchable as the 4th link. Flies its circuit from the Needle by Cresta Sur and back onto the Needle, perches, flies it back the other way and sets its rider down on the Needle. Stops: La Aguja, Cresta Sur, La Aguja. |

**Line map.** Each line's path is split into segments between consecutive stops. Staying hitched to
a vehicle of that line across a whole segment inks it. A line is complete when every segment is
inked. The map is complete when all 13 regular lines are. Secret lines appear once first ridden.

## 6. Things to do

- **Line map** (section 5): the spine of progression.
- **Errands**: 2–4 minute timed jobs from characters at stops. Step types: go to a zone, hitch a
  given line, deliver before a deadline, arrive with a chain of N, don't bail. At least 8, at
  least two per district.
- **Conductor challenges**: one per regular line (13). Each is a line-specific skill test started by
  hitching that line near its conductor's stop: chain N starting from this line, slingshot distance,
  land on a named roof, ride N segments without touching down, beat a time between two stops.
- **Secrets**: the ghost tram, the blimp, the summit Needle (reached via Cometa Rey, which needs a
  four-link chain). Each secret line can be finished in one ride and leaves the rider standing:
  the blimp is caught from the hill station platform as it waits there at dusk and brings its
  rider back to the deck; the summit chain's ride on Cometa Rey goes out, over the Needle and back
  round its circuit, inking the line, and ends on the Needle. The way down from the Needle is its
  guy wire, a grind from the platform's south edge to the summit lawn. The hill station platform
  has a run-in of steps from the lawn and the spine, so a skater from the summit (up to 14 m/s)
  can stop on it.
- **Chalk lines**: start recording anywhere, stop anywhere. The route is the start state, the day
  tick, and the input stream. It exports as a share code (text). Importing or replaying sets the
  clock to the recorded tick and runs the ghost as a second deterministic skater beside the player.
  Beat its time to the end zone. Local only; no backend.
- **Saves**: `localStorage`, versioned, one slot. Line map, errands, conductors, secrets, chalk
  lines, settings.

## 7. Look

Painted-bus maximalism, printed on a risograph.

- **Palette** (inks): mango `#FFAE1A`, hot pink `#FF2E88`, teal `#00A99D`, cobalt `#1F3FBF`, on
  sun-bleached concrete `#D9D2C3`, paper `#F3EBDD`, ink `#1B1A2E`. Districts lean: Docks teal +
  mango, Mercado pink + mango, Terraces mango + cobalt, Antenna cobalt + pink.
- **Form**: chunky low-poly, flat-shaded, no textures. Colour is per-vertex flat ink.
- **Shadow**: no smooth shading. Faces turned from the sun get a screen-space **halftone** dot
  screen of shadow ink (cobalt-leaning multiply). Two tones plus dots. Moving things and the skater
  get a halftone blob shadow on the ground. No shadow maps (cost; see DECISIONS).
- **Misregistration**: a post pass prints the pink and cobalt plates a pixel or two off-register in
  fixed, different directions, with paper grain and slight ink density noise.
- **Liveries**: every line has a base colour, a stripe pattern and a roof mark readable from 100 m:
  no two lines share a base + pattern pair.
- **Day and night**: sky and ink ramps move through dawn (pink), day (bleached), dusk (mango), night
  (cobalt, windows and ride lamps glow mango).
- **Characters animate on twos**: poses update at 12 Hz while position stays smooth.
- **UI**: destination boards (split-flap rows, condensed caps, mango on ink) for line, speed,
  chain and timetable; ticket stubs (perforated, punched) for errands, challenges and toasts. Drawn
  with CSS and inline SVG. No images, no web fonts.

Render contract (`src/render/look.ts`): every world mesh uses `inkMaterial()` with attributes
`position` and `color`; optional `glow` (0..1, lit at night). No normals: faces are flat-shaded from
screen-space derivatives. Geometry is built with `MeshBuilder` (`src/render/geom.ts`).

## 8. Sound

Web Audio synthesis only. Four district tracks, each a looping 8-bar arrangement in four stems:
**perc, bass, harmony, lead**.

| District | Style | Tempo | Flavour |
| --- | --- | --- | --- |
| Docks | cumbia | 92 | guacharaca + kick, tumbao bass, accordion stabs, clarinet lead |
| Mercado Steps | funk | 104 | tight kit, slap-ish bass, wah clav, horn hits |
| Terraces | highlife | 116 | bell pattern + shaker, walking bass, palm-wine guitar arps, horn lead |
| Antenna Hill | city pop | 100 | gated kit, octave synth bass, electric-piano maj7 pads, glassy lead |

Mix rules, driven by sim events:

- Always: wheel noise (filtered noise, pitch and level by speed, surface changes the filter), wind in
  the air and on Antenna Hill, ride motors near the camera.
- **Hitching** a line fades in that line's stem of its *own* district's track (quantised to the next
  beat). Stems of earlier links in the current chain stay in.
- **Chain of 3+** brings in the full band for the current line's district.
- Landing and ending the chain fades stems out over two bars. **Bailing** cuts to wheel noise at once.
- One track plays at a time: the track of the most recent hitch.

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
- Game systems (line map progress, errands, conductors, secrets, chalk) are deterministic reducers
  over sim state and events, under `src/sim/game/`.
- Render, audio and UI are observers. They may keep their own presentation state but never feed back
  into the sim except through `InputFrame` and explicit game commands (start errand, start chalk).

## 10. Performance budgets

Target: 60 fps on a mid-range phone (2021-class, e.g. Snapdragon 7-series / A13).

| Budget | Limit |
| --- | --- |
| Draw calls per frame | ≤ 120 |
| Triangles per frame | ≤ 180 000 |
| Sim step | ≤ 0.3 ms mean on desktop Node |
| Main-thread frame work (rAF callback: sim + scene update + render submit), headless Chrome, 4x CPU throttle | mean ≤ 10 ms, p95 ≤ 16.6 ms |
| JS bundle | ≤ 400 kB gzip |
| Device pixel ratio | capped at 2; post pass may be dropped by the governor |

`npm run perf` measures these in headless Chrome at 4x CPU throttle and fails the gate when one is
exceeded. It runs two checks. First, the `perfcity` route rides the city the way a player would
(carving, hopping, hitching, slinging) in five legs of ten simulated seconds: Mercado, Terraces,
Antenna Hill, a fast run down the Terraces spine that crosses chunk rows while the world streams,
and the Docks. The last 7.5 s of each leg are timed as normal frames of the normal loop; the frames
of all windows are pooled for the gated figures, and each window's mean, p95, draw calls, triangles
and per-part breakdown are printed with its district. The run fails unless it went somewhere:
every window travels at least 40 m, the windows see all four districts, at least two hitches fall in
timed frames and two windows hitch and sling, one window crosses two chunk boundaries at 8 m/s or
more while chunks are built, and there are at least 300 timed frames. Second, a tour of fixed
viewpoints in every district by day and night, for the draw-call and triangle maxima. Further gated budgets: game step
(sim plus every reducer) mean ≤ 0.6 ms and p95 ≤ 1.5 ms; one-step frame mean ≤ 6 ms. Headless Chrome
rasterises in software, so GPU cost is not representative there; the frame-work figure is the
main-thread cost only. Real-device GPU cost is on the PLAYTEST list.

## 11. Platform

Installable PWA, portrait-locked (`"orientation": "portrait"` plus a rotate notice in landscape),
offline after first load (service worker precache), safe-area aware, no network calls at runtime.
Haptics through `navigator.vibrate` where present. Nothing in the app assumes a browser chrome, so a
Capacitor shell can wrap `dist/` later.
