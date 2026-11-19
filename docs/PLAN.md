# SHMOOVE: the plan

How the game in `PITCH.md` gets built. Status lives here and is updated in the same commit that
changes it.

**Now: ready for a full playtest.** A whole ten-minute run with two mini-bosses and a final boss
(M4), sound and hit feedback (the part of M5 a player notices first), balanced with bots,
independently verified and its findings fixed, and an art pass: the rider, the horde and the
bosses as characters, a look for every weapon, a dressed park with points of interest, drawn
icons, and four looks to choose between. Riders, unlocks and the rest of the meta (M6) wait
until after the playtest.

The design changed once already: after a first play the owner asked for "a pretty standard
survivor-like but with fun movement", and chose a skateboard for the movement. `PITCH.md` is the
second pitch; touching hurts at any speed, weapons fire on timers, nothing reads how fast the
player is going.

What the playtest is for, and how to run it, is `docs/PLAYTEST.md`: a 45-minute session, the
measures the game records itself (COPY REPORT on the end card) with a target for each, and ten
ratings only a thumb can give. After it, in the order the reports suggest:

1. Whatever misses its target in the reports, performance first.
2. The pace of levelling (the bots take 5 to 8 cards a minute) and a late game that a full build
   finds too safe (DECISIONS 73).
3. Choosing one of the four looks and finishing it; the others go.
4. Art still weak, as its own tasks reported: the Slipstream is mostly behind the camera, the
   Lance's core is thin, tar is dark on dark, the gnat and the clinger are close at a distance,
   the rim is rarely on screen from the floor of the bowl.
5. The rest of M5 (music variation, more effects), then M6.

Milestones M0 to M2 stand as built (toolchain, the mover and the bowl, the horde, sparks and
levels). M3's content (cards, ten weapons, eleven passives, seven enemies, elites, map objects)
stands; its rules were rewritten.

Still only the owner can:

1. Play it and say what is and is not fun. The deploy works now; every push updates the link.
2. Say whether the board lands. The owner chose the skateboard over a grappling hook.

## The order, and why

The order is set by the risks, biggest first. The premise (one thumb can drive this) is tested before
any content exists, the horde's performance before any build system, and the full run before any
polish. Each milestone ends with something playable on the phone and a decision the owner makes with
a thumb, because tests cannot judge feel.

| | Milestone | Proves | Size | Status |
| --- | --- | --- | --- | --- |
| M0 | Ground | The toolchain, the gate, a link that opens on the phone | S | built, gate green at `f769d0d`; the link waits on a repo setting |
| M1 | Feel slice | Moving around an empty bowl with one thumb is fun | L | built, gate green; passed without a playtest on the owner's say-so |
| M2 | Horde slice | 400 enemies, readable in portrait, at 60 fps; three minutes are fun | L | built, gate green; fun is unjudged |
| M3 | Build | Level-ups, the arsenal and the drive-through map make runs differ | L | in progress |
| M4 | Run | A whole ten-minute run with bosses, an ending and resume | M | |
| M5 | Juice | It looks, sounds and hits like the pitch | M | |
| M6 | Meta | A reason for the next run: movers, feats, unlocks, daily bowl | M | |
| M7 | Ship | Installed, offline, tuned, on real phones | S | |

M1 is a go / no-go. If no control scheme is fun in an empty bowl, the project stops or changes shape
there, having cost one milestone.

## M0. Ground

Goal: an empty world on the phone, and every check that later milestones depend on.

- Vite + strict TypeScript + Three.js, ESLint with the sim purity rules, Vitest, Playwright at
  390x844 with touch.
- `src/sim` (deterministic, 60 Hz, seeded RNG, deterministic maths), `src/input`, `src/render`,
  `src/audio`, `src/ui`, `src/app`. Main loop with interpolation. A test hook for e2e.
- Debug panel (`?debug`) driven by the `FEEL` constants table.
- PWA shell: manifest, generated icons, service worker, safe-area insets, browser gestures
  (pull-to-refresh, edge swipe, double-tap zoom) suppressed, screen wake lock.
- `npm run gate`: typecheck, lint, test, build, e2e, perf. Perf budgets file, empty but enforced.
- GitHub Pages deploy on every push to the working branch.

Done when: the gate is green and the owner opens the link on their phone and sees a lit, empty
ground plane that follows a finger.

## M1. Feel slice

Goal: answer the only question that matters yet. Greybox, no enemies.

- Bowl generator v0: seeded heightfield with the banked rim, hills, a crater, one half-pipe, ramps,
  boost pads. Height and normal sampling for the sim.
- The mover: carve, tuck, hop, clean-hop chains and the buffer, air-steer, slope gravity, drag, grip
  scrub, the powerslide turn, rim riding. Every number in `FEEL`.
- Gears: thresholds, hysteresis, the HUD numeral.
- Camera: velocity-following chase camera, pull-back and field of view by gear, landing kick.
- The three control schemes from the pitch, switchable in the debug panel and by URL.
- Input: floating stick, tap vs drag discrimination, second-touch hop, dead zones, left-handed mirror.
- Bots: a tuck-only bot, a carve-only bot and a line-following bot, with tests that pin what the
  player would see (the stick alone never passes gear 2; a clean chain down the half-pipe reaches
  gear 4; a missed hop loses the chain, not the run).
- `docs/PLAYTEST.md` starts here: the list of constants only a thumb can judge.

Done when: gate green, and the owner has played each scheme on the phone for five minutes and picked
one (or sent it back with notes). **Go / no-go.**

What the bots say about the slice as built (seeds 1 to 5, two minutes each; `npx vitest run
tests/sim/bowl-bots.test.ts --silent=false` prints the table):

| Player | Average speed | Time in gear 3 or higher | Top gear |
| --- | --- | --- | --- |
| Never touches the screen | 2 to 4 m/s | 6 to 14% | 4, briefly |
| Holds the stick, never tucks or hops | 10 m/s | 0 to 3% | 3 |
| Steers a good line but hops at random | 12 to 13 m/s | 58 to 65% | 4, rarely 5 |
| Plays a line: tucks downhill, clean hops | 16 to 19 m/s | 86 to 97% | 5 |

So skill shows, the stick alone does not make speed, and gear 5 is reachable but not held. Whether
any of it is fun is the owner's call.

## M2. Horde slice

Goal: the second and third risks. A three-minute run with one enemy family and two weapons.

- Enemy core: pooled entities, uniform grid, steering toward the player with separation, recycling
  of enemies left behind, distance-based tick reduction.
- Instanced rendering with shader hop-wobble, blob shadows.
- Three enemies: Shuffler, Gnats, Bollard. Contact rules by gear (hurt, plow, bonk), the hit shove,
  invulnerability window, HP, death.
- Sparks: drops, magnet, merging above a cap, XP and levels (no cards yet: fixed upgrades).
- Two weapons: Wake (with loop detection and the pop) and Seekers. The metres-based tick.
- Spawn director v0: a density curve over three minutes, spawning out of frame ahead and around.
- Edge markers and the rear-pressure rim glow.
- Perf in the gate: 400 enemies and 600 sparks at 4x CPU throttle against budgets for frame work,
  sim step, draw calls and triangles.

Done when: gate green with the perf budgets met, and the owner agrees that deaths feel earned and the
loop pop feels as good as it reads. If the browser cannot hold the horde, this is where the enemy cap
drops or the platform decision is reopened.

As built. Perf at 4x CPU throttle with 400 enemies and 600 sparks: 5.0 ms of frame work (budget
8), 0.8 ms a sim step (budget 2), 15 draw calls, 66 000 triangles. The browser holds the horde in
headless Chromium; a real phone has not been tried.

What five bots do with the three minutes, seeds 1 to 5 (`npx vitest run tests/sim/balance.test.ts
--silent=false` prints the table; the bands are asserted there):

| Player | Outcome | Kills | Hits taken |
| --- | --- | --- | --- |
| Never touches the screen | dead at 0:39 to 0:45 | 43 to 94 | 13 to 14 |
| Holds the stick, blind to the horde | dead at 0:35 to 0:50 | 46 to 126 | 13 to 14 |
| Holds the stick, dodges well, never tucks or hops | dead at 1:37 to 2:46 | 530 to 1430 | 13 to 18 |
| Dodges and closes loops round crowds | dead at 2:34 to 2:53, wins 1 of 5 | 1240 to 1680 | 10 to 17 |
| Rides lines, keeps gear 3 and up, plows | wins 5 of 5 with 10 to 92 health | 1535 to 1640 | 5 to 21 |

Three things had to change to get a skill curve at all, and they are worth a thumb's attention
first: the director spawns at a rate (so killing thins the horde, where refilling to a target count
made kills meaningless); the gear that contact goes by outlasts the gear itself for 0.75 s (so
riding into a crowd and losing gear 3 inside it is not a trap); and health comes back in gear 3 and
above (the only healing, so keeping speed is what outlasts dodging). The loop pops what is on its
ring as well as inside it, because the horde chasing you round is on the trail.

## M3. Build

Goal: runs differ from each other.

- Stat system (one table of modifiers that weapons, mover and passives read).
- Level-up flow: slow motion, three cards in the thumb zone, momentum handed back, auto-pick.
- The remaining eight weapons and the eleven passives, four slots each, five levels each.
- The remaining enemies: Cutter, Lobber, Sludge, Clinger. Elites and auras.
- Drive-through interactables: crates, orbit shrines, slaloms, hoops, totems. Bowl generator v1
  places them off the natural circuits.
- HUD: timer, HP, gear, XP bar, build icons, damage numbers (pooled, capped).
- Bots that take builds; a test per weapon that it kills more per minute in a higher gear.

Done when: gate green with `STRICT = true` in `tests/sim/balance.test.ts` (three balance bands are
printed but not asserted while M3's content lands), and two runs with different first picks play
visibly differently.

Status: the build system, cards on screen, all ten weapons, all eleven passives, the four new
enemies and elites and the map's drive-through objects are merged.

### M3, second pass (after the owner's first play)

Done: contact, damage and healing no longer read speed or gear; Seekers is the starting weapon;
passives renamed to the genre's (Might, Haste, Regen); crates open to a touch; carving no longer
gives up a slope's pull.

To do, in order:

1. Weapons fire on timers, not metres or hops or tucks. Done: a test holds the mover still, rides
   it and launches it at 30 m/s and the same field takes the same damage.
2. Draw the M3 content (enemies, zones, map objects, weapon effects); the mover becomes a rider on
   a board. Done.
3. Done: a first-run lesson (seven lines on the real bowl, SKIP), a how-to sheet, and a HUD that leads
   with a small speed readout instead of the gear.
4. Bots and balance for standard rules, with `STRICT` back on in `tests/sim/balance.test.ts`.
5. An independent verification of all of M3.
6. Rails to grind. Done: in the sim, on the map (eight to twelve a bowl), drawn, with a grind
   pose and sparks.
7. Then whatever the owner's next play asks for.

## M4. Run

Goal: a beginning, a middle and an end.

- Spawn director v1: the three acts from the pitch, waves, elite timing.
- The Toll, The Roundabout, The Standstill.
- Win, death, Overtime. Results screen.
- Snapshot on backgrounding; resume; a snapshot round-trip test.
- Balance harness: bots at three skill levels play full seeded runs headlessly. Targets to start
  from: the tuck-and-circle bot dies before 4:00, the competent bot reaches the final boss about half
  the time, no single weapon wins more than twice as often as the median.

Done when: gate green including the balance harness, and the owner finishes (or fairly loses) a full
run on the phone.

## M5. Juice

Goal: the pitch's look, sound and feel.

- Look: palette, fog, flat shading, enemy silhouettes, the five movers' models, the Wake, speed
  streaks, pops and slams.
- Audio: synthesised stems that follow the gear, clean-hop scale, level-up and boss stingers, SFX.
- Feel: hit-stop, camera kicks, haptics where available, reduced-motion setting.
- Screenshots of every state in `artifacts/screens/` for review.

Done when: gate green (perf budgets unchanged) and the owner signs off the look on the phone outdoors.

## M6. Meta

Goal: the next run.

- Tokens, saves with versioning and migration tests.
- The four other movers, each with its own movement rule.
- Feats (about thirty) and the unlocks they gate; small capped perks.
- Records per mover; the daily bowl.
- Menus, settings (handedness, auto-pick, reduced motion, volume), a thirty-second first-run lesson
  that teaches carve, tuck, hop by doing them.

Done when: gate green and a new player (not the owner) gets from the link to gear 4 without help.

## M7. Ship

- PWA install, offline and update flow tested end to end (`e2e:pwa`).
- Perf pass on the real target phones; budgets tightened to what they actually do.
- Balance pass from the owner's `PLAYTEST.md` notes.
- README, a how-to-play screen, version stamp.

Done when: gate green, tag `v1`, installed on the owner's phone from the public link.

## After v1

Evolutions, rails, a second biome (The Stacks: terraces and drops), ghosts of your best daily run,
online leaderboards for the daily bowl.

## How the work is done

- **The gate.** A milestone is done only when `npm run gate` is green and tagged `mN`.
- **Bots before thumbs.** Anything a bot can check (determinism, reachability of gears, kill rates,
  survival curves, perf) is a test. The owner's time is spent only on what a thumb must judge, and
  that list is `docs/PLAYTEST.md`.
- **Lead and implementers.** The lead writes contracts and owns the feel-critical code (the mover,
  the gears and loop logic, the camera, the core look). Everything with a clear contract goes to
  implementer agents in parallel worktrees and is checked by a verifier with fresh context. See
  `CLAUDE.md`.
- **Decisions** made without the owner are logged in `docs/DECISIONS.md` from M0 on.

## Decisions made in this pitch, to overrule if wrong

| # | Decision | Default taken | Why |
| --- | --- | --- | --- |
| 1 | Name and fiction | SHMOOVE; Stiffs; the last thing moving | The repo name, and a fiction where speed as power needs no explaining |
| 2 | Platform | Web PWA | On the phone from a link, no store. Reopened at M2 if the horde will not fit |
| 3 | Hands | One thumb is complete; a second is optional | Portrait is a one-handed grip |
| 4 | Run length | Ten minutes, resumable | Long enough for a build, short enough for a phone |
| 5 | Slots | Four weapons, four passives | Readable on a narrow HUD |
| 6 | Art and audio | All generated in code | Small, offline, nothing to license |
| 7 | Monetisation and network | None | It is your game on your phone |

## What the owner needs to answer

1. Which phone or phones is this for? It sets the perf target and whether haptics exist.
2. Is the fiction (Stiffs, the Bowl, funk) the tone you want, or should it be something else?
3. Where should it deploy from? The old Pages workflow built from `develop` and the old default
   branch; M0 will point a new one at this branch unless told otherwise.
