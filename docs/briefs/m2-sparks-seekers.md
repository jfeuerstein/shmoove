# M2: sparks, levels and the Seekers

Model: sonnet. Read `docs/briefs/m2-common.md` first.

## Goal

Killing things pays: enemies drop sparks, sparks fly to a player who comes close, sparks are XP,
XP is levels, and levels raise the two weapons. And the second weapon: Seekers, darts that fire
themselves every few metres travelled.

## You own

`src/sim/sparks.ts`, `src/sim/seekers.ts`, `tests/sim/sparks.test.ts`, `tests/sim/seekers.test.ts`.
In `src/sim/sim.ts`: the `// [seekers]` and `// [sparks]` lines and their imports.

## `stepSparks(w, s, terrain)`

- **Drops**: for each entry in `w.deaths`, one spark worth `KINDS[kind].xp` at the death position,
  half a metre above the ground. If the death carries `MARK_SWEPT`, the spark starts with
  `pull = 1`.
- **Cap**: at 600 living sparks, a new one is not created; its value is added to the nearest
  living spark within 8 m of it, or to spark 0 if there is none.
- **Magnet**: a spark within `MAGNET_BASE + MAGNET_PER_GEAR * (gear - 1)` metres of the mover
  (measured on the ground plane) gets `pull = 1`. It stays pulled.
- **Flight**: a pulled spark flies straight at the mover (height included, aiming 1 m above its
  feet) at the faster of 18 m/s and the mover's speed plus 8 m/s. Unpulled sparks do not move.
- **Taken**: within 0.9 m of the mover it is removed, its value added to `player.xp`, and
  `FX_SPARK` emitted.
- **Levels**: while `xp >= xpNext`: subtract, `level++`, `xpNext = xpForLevel(level)`, apply
  `LEVEL_GRANTS[level - 2]` if there is one (raise `wakeLevel` or `seekersLevel` by one, never past
  `WEAPON_MAX_LEVEL`), emit `FX_LEVEL_UP`.

## `stepSeekers(w, s, terrain)`

Keep the numbers in one exported `SEEKERS` table in `seekers.ts`, indexed by level 1..5:
metres between volleys 14, 12, 10, 9, 8; darts per volley 1, 2, 2, 3, 4; damage 6, 7, 9, 11, 13.

- **The meter**: each tick add the mover's horizontal travel (`sqrt(vx² + vz²) * DT`) to
  `w.seekerMeter`. Standing still fires nothing. At level 0 the meter stays at zero.
- **A volley**: when the meter reaches the interval and there is at least one risen enemy within
  28 m, fire: one dart per target at the nearest enemies, different targets where there are
  enough, and subtract the interval. With no target, hold the meter at the interval (it fires the
  moment something comes in range).
- **A dart**: starts 1 m above the mover, flies at 32 m/s, lives 90 ticks, carries the level's
  damage times `gearPower` of the gear at the moment of firing. It steers toward the nearest risen
  enemy within 12 m of itself, turning at most 6 rad/s, re-choosing every 6 ticks, and holds about
  1 m above the ground. Within the enemy's radius plus 0.4 m it hits: `damageEnemy`, then gone.
  `FX_SHOT` when fired.

## Acceptance

1. `npm run typecheck`, `npm run lint`, `npm test` pass; nothing existing breaks.
2. `tests/sim/sparks.test.ts` on `arena()`: a killed shuffler leaves one spark where it died; a
   spark out of magnet range stays put for 10 s; walking near it pulls it in and XP rises by its
   value; the magnet is wider in a higher gear; a swept death's spark flies in from far away; at
   the cap, values merge and no XP is lost (total XP available is conserved); levels go up at the
   thresholds from `xpForLevel` and grant weapons in `LEVEL_GRANTS` order, stopping at the maximum;
   several levels from one big spark all happen; `FX_SPARK` and `FX_LEVEL_UP` are emitted.
3. `tests/sim/seekers.test.ts`: nothing fires at level 0 or standing still; the number of volleys
   over a known distance matches the interval at each level; darts go to different targets;
   a dart reaches and damages a target 20 m away and kills a shuffler in the expected number of
   hits; darts do not target rising enemies; with nothing in range the volley waits and fires as
   soon as something is; damage is higher in a higher gear; a dart that finds nothing expires; the
   shot pool never overflows (`MAX_SHOTS`) under the fastest fire rate.
4. A determinism test: a 30 s scripted run with hand-placed enemies gives the same `hashWorld`
   twice.
5. No allocation in either step (say how you checked).
