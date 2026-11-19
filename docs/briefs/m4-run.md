# M4: the whole run

Model: opus. Read `docs/PITCH.md` (section 4 especially), `docs/DECISIONS.md` items 42 to 54,
`docs/briefs/README.md`, `docs/briefs/m2-common.md`, `docs/briefs/m3-common.md`, then
`src/sim/director.ts`, `src/sim/horde.ts`, `src/sim/hazards.ts`, `src/sim/contact.ts`,
`src/sim/world.ts` (`BossState`, `EnemyKind.boss`, `ZONE_RING`, `FX_BOSS_IN`, `FX_BOSS_DOWN`),
`src/sim/sim.ts`, `src/sim/balance.ts`, `src/sim/build.ts`, `src/render/hordeView.ts`,
`src/render/zonesView.ts`, `src/ui/hud.ts`, `src/ui/endScreen.ts`, `src/app/main.ts`,
`src/app/testHook.ts`.

## Goal

A run with a beginning, a middle and an end: ten minutes in three acts, a mini-boss at 3:00 and at
6:00, a final boss at 9:00, and the run is won when the final boss falls. Each boss is a movement
problem the board solves (turn, read the ground, ollie), in a game where touching still just
hurts and weapons still fire themselves.

## You own

- `src/sim/director.ts`, a new `src/sim/bosses.ts`, `src/sim/hazards.ts`; in `src/sim/world.ts`
  only new `KINDS` entries and `KIND_*` constants for the three bosses; in `src/sim/balance.ts`
  the run's clock constants; in `src/sim/sim.ts` only the clock and win lines at the end of
  `stepWorld` and one new call for the bosses.
- `src/render/hordeView.ts` (three boss shapes), `src/render/zonesView.ts` (the ring), their tests.
- `src/ui/hud.ts` (the clock; a boss bar) and a new `src/ui/bossBar.ts` if you want one,
  `src/ui/endScreen.ts`, their CSS and tests.
- `src/app/testHook.ts`: a way to set the run clock. `src/app/main.ts`: wiring.
- Tests: `tests/sim/bosses.test.ts`, `tests/sim/director.test.ts`, `tests/sim/hazards.test.ts`,
  `tests/sim/run.test.ts` (new), `tests/e2e/routes/boss.mjs` (new), and whatever of the existing
  tests the new clock touches (`tests/sim/contact.test.ts`'s "won when the clock runs out",
  the HUD and end-card tests, `tests/e2e/routes/run.mjs`).
- Delete `tests/sim/balance.test.ts` and `tests/sim/bot/fighters.ts`: they assume a three-minute
  run won on the clock and rules the game no longer has. A balance task follows this one and
  writes new bots and bands. Keep `tests/sim/bot/playRun.ts`, `picks.ts`, `steer.ts`, `bots.ts`
  working (update `playRun` for the new clock).

## The run

| Time | What |
| --- | --- |
| 0:00 | Shufflers. Gnats from 0:40. Bollards from 2:00. |
| 3:00 | **The Bruiser.** |
| 3:00 to 6:00 | Cutters from 3:10, lobbers from 3:40. Elites from 5:00, about every 30 s. |
| 6:00 | **The Mortar.** |
| 6:00 to 9:00 | Sludge from 6:10, clingers from 6:40. |
| 9:00 | **The Standstill.** The run is won when it falls. |

Stretch the director's rate, floor and cap tables over the ten minutes (ending at the 400 cap
around 8:00). While a boss is alive the spawn rate is 0.6 of normal and no new bollards come. The
numbers are yours to start; a balance pass follows.

There is no win on the clock. `RUN_TICKS` goes; export the boss times (in seconds) from
`balance.ts`. Past 9:00 the clock simply keeps counting.

## The bosses (`bosses.ts`)

A boss is an enemy with `boss: true` in its kind: one at a time, never thrown by a hit, never
recycled, cannot be hopped over (contact already refuses), heavy. Every tick while one is alive,
write `w.boss` (kind, hp, maxHp, x, z); when none, `kind = -1`. Use `Horde.state` and `timer` for
its phases. It comes up 45 m ahead of the mover, on the floor, with `FX_BOSS_IN`.

When a boss dies: `FX_BOSS_DOWN`, `w.boss.felled++`, the player gets 40% of maximum health back
(`FX_HEAL`), sparks worth 30 XP are dropped where it fell, and `queueOffer(w, OFFER_TOTEM)` (a
rare card). The Standstill's death also sets `PHASE_WON`.

- **The Bruiser** (kind 7). 2.2 m radius, 900 health, 20 damage on contact. It walks at you at
  3 m/s; every 4 s it stops, faces you for 0.8 s (that is the tell), then charges in a straight
  line at 16 m/s for up to 40 m or 2.5 s, whichever comes first, and stands winded for 1 s. It
  does not steer in a charge: turning beats it.
- **The Mortar** (kind 8). 1.8 m radius, 1400 health. It keeps 20 to 30 m from you at 2 m/s.
  Every 4 s it lays five lob rings (`ZONE_LOB`, as the lobber's) in a line across where you are
  heading, 4 m apart, landing 1.2 s later. Every 12 s it calls a cloud of gnats.
- **The Standstill** (kind 9). 3 m radius, 2600 health, 2.5 m/s. Within 12 m of it a grounded
  mover is slowed (0.8 /s through `w.player.cling`, added to tar and clingers). Every 3.5 s it
  sends a ring out along the ground (`ZONE_RING`): the front spreads at 9 m/s to 40 m and a mover
  on the ground when the front crosses it takes 15 (`hurtPlayer`). In the air, or on a rail, it
  passes under. Every 15 s it calls an elite.

## On screen

- The clock counts up as `m:ss`.
- A boss bar at the top under the clock while `w.boss.kind >= 0`: its name and its health. Its
  name across the upper screen for 2 s when it arrives.
- Boss shapes in `hordeView.ts`, at most 80 triangles each, in `PALETTE.bosses[0..2]`, big and
  unmistakable: the Bruiser broad and low with a head down to charge, visibly facing where it
  will go during its tell; the Mortar a squat tube pointing up; the Standstill a tall, still
  monolith. The ring in `zonesView.ts`: a bright line on the ground in `PALETTE.ring` at the
  front's radius, readable in time to ollie.
- The end card: `STOPPED` when dead, `CLEARED` when the Standstill falls; time, kills, level and
  bosses felled.

## Test hook

`setClock(seconds)` sets the run clock (the director and the bosses go by it), so a route or a
bot can start at 2:55.

## Acceptance

1. `npm run gate` is green.
2. `tests/sim/bosses.test.ts`, on `arena()` or a small world, an assertion for every clause: each
   boss arrives at its time, once, 45 m ahead; `w.boss` is right every tick and `-1` otherwise;
   the Bruiser's tell, its straight charge (a mover that turns during the tell is missed; one that
   keeps its line is hit), its limits and its rest; the Mortar keeps its distance, its five rings
   land where the mover would have been, a mover that changes line is missed, the gnats come; the
   Standstill's aura slows a grounded mover and not an airborne one, its ring hurts a mover on
   the ground as the front crosses, an ollie timed over the front clears it, a mover on a rail is
   passed under, the elite comes; no boss is thrown by a hit, recycled or hopped over; each death
   gives the heal, the sparks and the rare card; the Standstill's death wins the run.
3. `tests/sim/director.test.ts`: the schedule above on seeds 1 to 3; the slower rate and no new
   bollards while a boss lives; the old rate, floor, cap and recycling tests adapted to ten
   minutes.
4. `tests/sim/run.test.ts`: a simple bot that keeps away from the nearest enemies, with a strong
   fixed build and health topped up, plays a whole run on seed 1: the three bosses arrive at
   3:00, 6:00 and 9:00 and fall, the run ends `PHASE_WON`, and the same run replays identically
   (`hashWorld` every 60 ticks). It must take under 20 s of test time.
5. Horde, director, hazards and bosses together with 400 enemies and a boss stay under 1.5 ms a
   tick in Node (assert under 4 ms; report it). No allocation in any step.
6. `tests/e2e/routes/boss.mjs` with `?hook&nolesson`: for each boss, set the clock to just before
   its time, step until it is on the field, assert the bar and the name show, take a screenshot;
   kill it through the hook (add what you need, small) and assert the card and the heal; after the
   third, the `CLEARED` card. Open the three screenshots with the Read tool and say what you see:
   each boss must be unmistakable, and the Standstill's ring readable.
7. Report the director's tables and the bosses' numbers as shipped.
