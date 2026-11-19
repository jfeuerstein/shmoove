# M2: what every M2 brief shares

Read `docs/briefs/README.md` (common rules) and `docs/PITCH.md` sections 4, 7 and 8 first.

## The state you build on (lead-owned; read, do not edit, unless your brief names a line)

- `src/sim/world.ts`: `World` and everything in it. Enemies, sparks and shots are dense
  structure-of-arrays: live items are indices `[0, count)`, removal moves the last into the gap.
  **Indices are only stable within a tick, and for enemies only until `reapHorde`.** Core
  operations: `spawnEnemy`, `removeEnemy`, `damageEnemy`, `shoveEnemy`, `reapHorde`, `rebuildGrid`,
  `queryEnemies` (results into `w.nearA` or `w.nearB`), `nearestEnemy`, `emitFx`. `KINDS` is the
  enemy table. `w.deaths` lists this tick's deaths; `w.fx` lists this tick's effects.
- `src/sim/balance.ts`: `gearPower`, plow gears, magnet, XP curve, `LEVEL_GRANTS`, `WAKE`.
- `src/sim/contact.ts` (hurt, plow, bonk) and `src/sim/wake.ts` (trail, loop pop): done.
- `src/sim/sim.ts`: `new Sim(terrain, { seed, horde: true })` runs the world; `stepWorld` has the
  tick order with marked lines (`// [director]`, `// [horde]`, `// [seekers]`, `// [sparks]`) where
  your step goes. Replace only your marked line with your call, plus its import. `Sim.reset()`
  restarts a run in place.
- `tests/sim/world-fixtures.ts`: `arena()` (a run on level ground with the director off), `place()`,
  `root()`, `stepCounting()`.

## Rules for sim code

- Deterministic and pure (ESLint enforces it). All randomness from `w.rng`.
- No allocation per tick: no arrays, objects or closures created in a step. Scratch buffers at
  module level.
- Damage only through `damageEnemy`; never remove an enemy that died (that is `reapHorde`'s job).
- An enemy with `age < SPAWN_TICKS` is still rising: it cannot hurt or be hurt, targeted or moved.
- A world with `w.spawning === false` gets no enemies from the director.

## Rules for render and UI code

- Read the sim, never write it. Colours and materials only from `src/render/look.ts`.
- The world is not interpolated between two states (indices move). Draw a thing at
  `position - velocity * (1 - alpha) * DT`.
- Effects arrive as `w.fx`, valid only until the next `sim.step`. `main.ts` hands them to the views
  once per tick, right after the step.
- No allocation per frame; pools for everything; DOM writes only when a value changes.
