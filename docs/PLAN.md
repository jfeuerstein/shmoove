# SHMOOVE: the plan

How the game in `PITCH.md` gets built. Status lives here and is updated in the same commit that
changes it.

**Now:** nothing is built. The repo holds the pitch, this plan and the working rules. M0 is next.

## The order, and why

The order is set by the risks, biggest first. The premise (one thumb can drive this) is tested before
any content exists, the horde's performance before any build system, and the full run before any
polish. Each milestone ends with something playable on the phone and a decision the owner makes with
a thumb, because tests cannot judge feel.

| | Milestone | Proves | Size | Status |
| --- | --- | --- | --- | --- |
| M0 | Ground | The toolchain, the gate, a link that opens on the phone | S | next |
| M1 | Feel slice | Moving around an empty bowl with one thumb is fun | L | |
| M2 | Horde slice | 400 enemies, readable in portrait, at 60 fps; three minutes are fun | L | |
| M3 | Build | Level-ups, the arsenal and the drive-through map make runs differ | L | |
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

Done when: gate green, and two runs with different first picks play visibly differently.

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
