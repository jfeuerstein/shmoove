# M1: the bowl generator

Model: opus. Read `docs/briefs/README.md` for the common rules, and `docs/PITCH.md` sections 4 and 9.

## Goal

`makeBowl(seed)`: the map. A seeded heightfield about 340 m across that is a machine for making
speed: a banked rim that turns the mover around instead of stopping it, hills, a crater, two
half-pipe valleys, kickers and boost pads. The stick alone only reaches 10 m/s; everything faster has
to come from this terrain, so its shapes are the game.

## You own

`src/sim/bowl.ts`, `tests/unit/bowl.test.ts`, `tests/sim/bowl-ride.test.ts`.

## Interface

```ts
export const BOWL_RADIUS = 170;
export interface BowlFeatures {
  crater: { x: number; z: number; radius: number };
  pipes: { x0: number; z0: number; x1: number; z1: number; halfWidth: number }[]; // x0,z0 is the high end
  kickers: { x: number; z: number; yaw: number }[]; // yaw = the direction to ride it
}
export interface Bowl extends Terrain { readonly seed: number; readonly features: BowlFeatures }
export function makeBowl(seed: number): Bowl;
```

`Terrain` is in `src/sim/terrain.ts`. Physics you are building for is in `src/sim/mover.ts` and
`FEEL` in `src/sim/constants.ts` (gravity 25 m/s2, gears start at 7 / 12 / 18 / 25 m/s, hard speed
limit 42). Read `stepGround` and `stepAir` before shaping anything.

## Shape

- **Floor**, r < 130: rolling hills, about 6 m of relief either way, wavelengths 50 to 90 m. Nowhere
  steeper than a 0.9 slope.
- **Rim**, r from 130 to 170: a smooth bank whose slope grows with radius to about 60 degrees and
  rises at least 28 m above the mean floor. Never vertical. A tucked mover hitting it head-on at
  25 m/s must turn around below the top.
- **Crater** near the middle: about 35 m radius, 9 m deep, a 2 m raised lip.
- **Two half-pipes**: troughs at least 120 m long, about 16 m half-width, about 7 m deep, falling
  along their length by at least 0.06, at seeded positions off the centre. Tucking down one from the
  high end must reach gear 3 before the low end.
- **Kickers**, 6 to 10: smooth table ramps (2 to 3.5 m up over 8 to 12 m, a short top, a smooth
  back), placed where lines naturally arrive: the low ends of the pipes, the crater lip, hill
  shoulders.
- **Boost pads**, 6 to 10, radius 2.5 m, on runs with slope under 0.15, none within 12 m of spawn.
- **Spawn**: 60 to 100 m from the centre, slope under 0.05 within 6 m, `spawnYaw` facing the centre.
- From any floor point there is a point at least 4 m lower within 40 m (a downhill is always close).

## Representation

Compose the shape analytically, sample it once into a `Float32Array` on a 1 m grid, and serve
`heightAt` by bicubic (Catmull-Rom) interpolation so the surface has a continuous slope. `normalAt`
from the interpolant's derivative or central differences. No allocation in `heightAt` / `normalAt`.
Deterministic: `Rng` from `src/sim/rng.ts` and `src/sim/math.ts` only (ESLint enforces the sim
purity rules). Same seed, bit-identical heights; different seeds, different maps. Finite everywhere
within radius + 5 m.

## Acceptance

1. `npm run typecheck`, `npm run lint`, `npm test` pass.
2. `tests/unit/bowl.test.ts` asserts, for seeds 1 to 5: determinism; floor slope limit; slope
   continuity (scan lines in 0.1 m steps, no jump in slope above 0.08); rim height and that it keeps
   rising from r = 135 to the radius at every angle; crater depth and lip; both pipes' length, depth
   and fall; kicker and pad counts and placement rules; the spawn rules; the downhill rule;
   construction under 500 ms.
3. `tests/sim/bowl-ride.test.ts` drives a real `Sim` (helpers in `tests/sim/fixtures.ts`): a mover
   tucked from the high end of each pipe reaches gear 3 before the low end; movers launched at
   25 m/s into the rim at 16 angles stay inside the radius and are back inside r = 130 within 10 s;
   60 s of seeded random stick and hops never leaves the radius or produces a non-finite number; a
   tucked mover from spawn is moving faster than 3 m/s within 5 s (the spawn is not a dead spot:
   relax the spawn slope rule within the brief's 0.05 if needed, or face it at a nearby downhill).
4. Report the numbers for seed 1: floor height range, rim height, top speed reached tucking each
   pipe, and how high a 25 m/s mover climbs the rim.
