# SHMOOVE: the pitch

**A one-thumb 3D survivor where your speed is your build.**

Everything in the world has seized up, and it wants you to stop too. You are the last thing still
moving. Carve, tuck and hop around a giant bowl while a horde of Stiffs closes in. Your weapons fire
themselves, but they are fed by distance, not time, and they hit harder in every gear you climb. Stand
still and you are a bad build. Find a line and you are a comet with a tail of explosions.

Portrait. One thumb. Ten-minute runs. Installs from a link.

Everything numeric below is a starting value for the debug panel, not a promise.

## 1. Why this game

The 3D survivor (Megabonk is the reference point) showed that the genre gets better when the player
has real movement: slopes, slides, bunny hops. But movement there is mostly how you *travel and
dodge*; the build does the killing. And it needs a keyboard, a mouse and a landscape screen.

SHMOOVE makes two bets:

1. **Auto-attack frees the thumb.** A survivor never asks you to aim or fire. On a phone held in one
   hand, that leaves the whole input budget for movement, so movement can be the deep part.
2. **Speed should be the stat everything scales from.** Not a means to an end: the thing the weapons,
   the defence, the pickups and the music all read.

## 2. Pillars

| Pillar | What it means in practice |
| --- | --- |
| **Speed is the build** | Five gears of speed. Each gear multiplies weapon power, widens the magnet, and from gear 3 turns contact with small enemies from damage taken into damage dealt. |
| **Metres, not seconds** | Most weapons tick per metre travelled. A faster line is literally more shots. Standing still switches your build off. |
| **One thumb, three verbs** | Drag to carve, let go to tuck, tap to hop. Nothing else is ever required. |
| **Nothing makes you stop** | Chests are rammed open, shrines are orbited, level-ups happen in slow motion and hand your momentum back. No interaction is "stand here". |
| **The map is the engine** | The stick only gets you to gear 2. Slopes, transitions, ramps and well-timed hops get you the rest. Learning the bowl is the long-term skill. |

## 3. Controls

One thumb, anywhere on the lower two thirds of the screen.

| Gesture | Verb | What it does |
| --- | --- | --- |
| Hold and drag | **Carve** | Floating stick, camera-relative. Pushes you up to run speed (10 m/s) and steers. Above run speed it only steers, and hard turns scrub speed. Pulling the stick back toward you is a powerslide U-turn. |
| Lift the thumb | **Tuck** | You drop low and coast: lowest drag, full pull from slopes, no steering. This is how you gain speed downhill and hold it on the flat. |
| Tap | **Hop** | A short jump. Tap within 120 ms of landing and it is a clean hop: you keep all your speed and gain a little. Chain them. Taps up to 150 ms early are buffered. In the air, holding the thumb gives gentle air-steer. |

A second thumb is optional, never needed: any second touch is an instant hop, for people who want to
steer and hop at once.

The trade the controls set up is the one a downhill skier makes: tucked is fast and blind to
steering, carving is control that costs speed. Every second of a run is that decision.

Two alternates get built in the first prototype and judged on a real phone before anything else is
made (see `PLAN.md`, M1): *lift to hop* (no tuck verb, tuck is automatic downhill) and *swipe to
hop* (flick up, for players whose taps misfire).

## 4. Movement and Flow

**Gears.** Speed is shown as a gear, 1 to 5, huge on the HUD.

| Gear | Name | Speed | Weapon power | Contact |
| --- | --- | --- | --- | --- |
| 1 | Shuffle | under 7 m/s | x0.6 | Everything hurts you |
| 2 | Roll | 7 to 12 | x1.0 | Everything hurts you |
| 3 | Cruise | 12 to 18 | x1.3 | You plow fodder: it takes ram damage, you take none |
| 4 | Rip | 18 to 25 | x1.7 | You plow fodder and mediums |
| 5 | SHMOOVE | 25 and up | x2.2 | You plow everything but bosses; heavies shatter |

**Where speed comes from:** tucking down slopes, clean hop chains, pumping through transitions (tuck
into the bottom of a dip, carve out), boost pads, the banked rim of the bowl, and (with the right
upgrades) kills.

**Where it goes:** climbing, hard carving, tar, being grabbed, hitting a heavy below the gear that
breaks it, and taking a hit. A hit drops you one gear and gives 0.6 s of invulnerability.

**The spiral, and the way out.** Slow means weak and touchable, which means hit, which means slower.
That is the tension the game runs on, and it needs a release valve: after a hit the enemies around
you are shoved back, and every map is built so that a downhill is never more than a few seconds away.

**The stick only reaches gear 2.** This is the rule that makes the map matter. Gear 3 needs terrain or
timing. Gear 5 needs a line.

## 5. Camera and the portrait screen

A portrait screen is narrow and tall, which is wrong for watching a horde on all sides and exactly
right for looking down a line. The design leans into that.

- Chase camera behind and above, pitched down about 35 degrees, yawing to follow your *velocity*, not
  your stick. It pulls back and widens its field of view with each gear.
- The horde tops out below gear 3. What is behind you stays behind you. Danger is what you are
  heading into, and the tall screen shows it early.
- What the frame cannot show is drawn on its edges: arcs for elites and bosses, markers for incoming
  shots, a rim glow that thickens as the horde closes in from behind.
- HUD is top and bottom only: timer, HP and gear at the top, XP bar and build icons at the bottom
  edge under the thumb zone. The middle of the screen is never covered.

## 6. A run

Ten minutes on one map. Pause or leave at any time; the run is snapshotted and resumes.

| Time | What happens |
| --- | --- |
| 0:00 to 3:00 | Fodder only. Learn the map, find a line, take the first upgrades. |
| 3:00 | Mini-boss: **The Toll**, a barrier that follows you and only breaks to a gear 4 ram. |
| 3:00 to 6:00 | Interceptors and lobbers join. Straight lines stop being safe. |
| 6:00 | Mini-boss: **The Roundabout**, which has to be lassoed three times. |
| 6:00 to 9:00 | Everything, plus elites, tar and grabbers. |
| 9:00 | **The Standstill** arrives: a slowing field with weak points that open to slams and rams. |
| After | Win, bank the rewards, or stay for Overtime: endless escalation for the record book. |

**Levelling.** Kills drop sparks (XP). A level is three cards: a new weapon, a weapon level, or a
passive. Four weapon slots and four passive slots, five levels each, sized to stay readable on a
phone. Time drops to a crawl while you choose, cards sit in the thumb zone, and you get your exact
speed and heading back with a half-second ramp. There is an auto-pick setting for players who never
want to stop.

## 7. The arsenal

Weapons fire themselves. Most count **metres**, a few count **events** (hops, landings, rams).

| Weapon | What it does | Fed by |
| --- | --- | --- |
| **Wake** | A burning trail behind you. Close a loop and everything inside it pops. | Metres; loop size |
| **Bumper** | Contact damage on your nose. Kills refund a little speed. | Speed at impact |
| **Slam** | A shockwave where you land. | Fall height and air time |
| **Seekers** | A volley of homing darts. | Every N metres |
| **Orbit** | Discs circling you. They spin as fast as you move. | Speed |
| **Static** | Builds charge as you travel, then arcs through a chain of enemies. | Metres |
| **Skipper** | Every hop throws a stone that skips forward through the crowd. | Hops; clean hops throw two |
| **Slipstream** | The draft behind you drags sparks and small enemies into your line. | Gear |
| **Crumbs** | Drops a mine at intervals along your path. | Metres |
| **Lance** | A beam ahead of you that only exists while you are tucked. | Tuck time; gear |

The **Wake loop** is the signature. It turns the survivor's oldest habit, circling the horde, into
the attack itself, and it is something a thumb can do and a mouse would find dull.

**Passives:** Wax (less drag), Edges (carving scrubs less), Springs (wider hop window, higher hops),
Wings (air control and hang time), Magnet, Heart (max HP), Second Wind (regen in gear 3 and up),
Overdrive (stronger gear multipliers), Hide (armour), Luck, Wide Load (area).

**After v1:** evolutions (a maxed weapon plus a named passive becomes a new weapon), rails to grind.

## 8. The horde

Every enemy is a question about your speed.

| Enemy | Behaviour | What it asks |
| --- | --- | --- |
| **Shuffler** | Slow, endless, the bulk of the horde. | Fuel. Plow it, loop it. |
| **Gnats** | A tiny fast cloud with almost no health. | Loop bait. |
| **Bollard** | A heavy that barely chases. Hit it below gear 5 and you stop dead. | Read the line ahead. |
| **Cutter** | Fast, and aims at where you will be, not where you are. | Change direction. |
| **Lobber** | Lobs slow shots that land in telegraphed circles on your predicted path. | Change your line or hop. |
| **Sludge** | Leaves tar that scrubs speed. | The map changes under you. |
| **Clinger** | Latches on and adds drag until shaken off by a hop, a slam or a loop. | Use the verbs. |

Elites are larger versions with an aura (haste, shield, magnet-jam). Target: 400 enemies alive at
60 fps on a mid-range phone. Enemies left far behind are recycled ahead and out of view, so the
horde always feels like it is everywhere without the phone simulating the whole map.

## 9. The map

**The Bowl.** About 320 m across, generated from a seed: a banked outer rim that turns you around
instead of stopping you, rolling hills, a central crater, two half-pipe valleys, kicker lines, boost
pads. It is a heightfield, which keeps collision cheap, deterministic and smooth under a thumb.

Everything you can interact with is a drive-through:

| Thing | How you use it | Reward |
| --- | --- | --- |
| **Crate** | Ram it in gear 2 or better. Gold crates need gear 4. | A free upgrade card, a heal, a magnet, a bomb |
| **Orbit shrine** | Three laps around it inside ten seconds. | Pick one of three boons |
| **Slalom** | Clear a line of five gates in time. | A burst of sparks and tokens |
| **Hoops** | Rings in the air over the ramps. | Tokens; a streak bonus |
| **Totem** | Ram it to call an elite pack on purpose. | A guaranteed rare card |

These exist to pull you off your safe circuit and across the map, which is also the answer to the
obvious degenerate strategy (lap one loop forever).

## 10. Between runs

- **Tokens** from every run (time survived, kills, gates, hoops, bosses), win or lose.
- **Movers.** Five characters, each a different way to move:
  Rolla (baseline, holds speed on the flat), Puck (terrible runner, superb in a tuck, lands with a
  belly slam), Boing (double hop, bigger slams), Brick (slow to start, loses no speed on a ram),
  Wisp (long air time, weapons fire faster airborne).
- **Unlocks.** Six weapons at the start, the rest and the movers earned by feats ("hold gear 5 for
  30 seconds", "pop 50 in one loop"), about thirty in all. Permanent stat perks exist but are small
  and capped: you get better at this game by learning the bowl, not by grinding.
- **Records**, all local: best time, top speed, longest gear 5 streak, biggest loop, per mover.
- **Daily bowl.** One seed per day, same map and spawns for every attempt.

No accounts, no ads, no store, no network after install.

## 11. Look, sound, feel

- **Look.** Flat-shaded low-poly, heavy fog, a dark ground and saturated enemies so the screen reads
  outdoors. Stiffs are chunky and blocky and hop-wobble in the vertex shader. Speed is shown by field
  of view, ground streaks, the Wake, and the horde shrinking behind you.
- **Sound.** A generated funk loop in stems that follow the gear: drums in gear 1, bass in 2, keys in
  3, guitar in 4, horns in 5. Dropping a gear drops a layer. Clean hops land on a rising scale.
- **Feel.** Hit-stop on rams and loop pops, a camera kick on slams, haptics where the phone allows
  them (Android; iOS browsers do not expose vibration).
- **No assets.** Geometry, textures, shaders and audio are generated in code. Small download, nothing
  to license.

## 12. Platform and tech

TypeScript, Three.js on WebGL2, Vite, shipped as an installable offline PWA on GitHub Pages.

- **Why the web:** it is on your phone the moment a commit lands, with no store, no developer account
  and no build machine. The cost is a lower performance ceiling than native and no iOS haptics. If
  the horde cannot hit its numbers in a browser, that is discovered in M2, early enough to change
  course.
- **Deterministic sim.** Fixed 60 Hz step, seeded RNG, no engine-dependent maths; rendering
  interpolates. This buys headless bots that play whole runs in seconds (balance and regression
  tests), the daily seed, and suspend/resume by snapshot.
- **Horde tech.** One instanced mesh per enemy type with shader animation, a uniform grid for
  neighbour queries, flow-toward-player steering with separation, reduced tick rate for distant
  enemies, blob shadows only, no post-processing.

## 13. What v1 is

One map generator, five movers, ten weapons, eleven passives, seven enemies plus elites, three
bosses, five interactables, about thirty feats, the daily bowl, full offline PWA.

Not in v1: evolutions, rails, a second biome, online leaderboards, ghosts, multiplayer.

## 14. Risks

| Risk | Why it could sink the game | How it is handled |
| --- | --- | --- |
| One thumb cannot drive 3D movement without a camera stick | The whole premise | M1 is nothing but this, with three control schemes, on a real phone. If none of them is fun in an empty bowl, stop. |
| Portrait hides the horde | Deaths feel unfair | Velocity camera, edge markers, a horde slower than gear 3. Judged in M2. |
| A browser cannot draw the horde | No horde, no survivor | Instancing from day one, perf budget in the gate from M2, enemy cap as a tunable. |
| Level-up pauses kill the flow | Fights pillar 4 | Slow motion, momentum handed back, auto-pick. Fallback: bank levels and spend them when you choose. |
| Speed as power snowballs or death-spirals | Runs decided in minute two | Bots at several skill levels run every balance change; the hit shove and nearby slopes are the valves. |
| Lapping one circuit is optimal | The map stops mattering | Cutters and lobbers punish predictable lines; rewards sit off the circuit. |
| Content treadmill | Never ships | v1 list above is fixed. New ideas go to the "after v1" list. |
