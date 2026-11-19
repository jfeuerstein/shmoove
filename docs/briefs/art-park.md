# Art: the park and its points of interest

Model: opus. Read `docs/briefs/art-common.md` first (it is the contract), then `docs/PITCH.md`
section 7, `src/render/thingsView.ts`, `railsView.ts`, `terrainView.ts` (read only),
`src/render/look.ts`, `src/sim/things.ts` (what each thing's `state` and `progress` mean),
`src/sim/bowl.ts` (features, sites, pads, kickers, rails), `src/sim/terrain.ts`, their unit tests
and `tests/e2e/routes/arsenal.mjs`, `rails.mjs`.

## Goal

The bowl looks like a place: a skatepark someone built, with landmarks you steer by and points
of interest you can recognise from across the map and want to ride to.

## You own

`src/render/thingsView.ts`, `src/render/railsView.ts`, a new `src/render/parkView.ts` (dressing:
things that are only drawn), their unit tests, a new `tests/e2e/routes/park.mjs`, and the wiring
of `parkView` in `src/app/main.ts` (construct and update only). `terrainView.ts` belongs to the
lead (the ground's pattern changes with the look): do not edit it. If the ground mesh needs to
expose something for you, say so.

## What to build

**Points of interest**, each recognisable from 60 m and readable in its states:

- **Crate / gold crate:** a proper crate (planks, corner braces, a lid), the gold one a chest
  that glints. Breaking it throws planks.
- **Shrine:** a small monument with something floating over it; the lap ring on the ground
  fills as laps are made; done, it goes dark and the floating thing drops.
- **Slalom:** gates as flag poles or cones with a banner; the next gate bright and beckoning,
  passed gates lowered; a line on the ground from one to the next.
- **Hoop:** a ring in the air with a frame or balloons holding it up, facing its way, with an
  arrow on the ground under it showing the approach and the kicker that reaches it.
- **Totem:** a carved stack with a face per stage; when called, it shakes and its eyes light.
- **Each has a beacon:** a thin column of light or a tall flag above it that can be seen over
  hills and through fog, in the thing's colour, gone when the thing is spent. One instanced mesh
  for all beacons.

**Rails:** rails with real posts and feet, a bright top edge, end caps; a faint glow along the
rail being ground. **Boost pads:** chevrons that animate along the direction of the boost.
**Kickers:** a ramp that reads as a ramp from the side as well as from behind (edge stripes,
a lip). The pads and kickers are part of the terrain mesh; draw your additions on top of it
(decals lifted a few centimetres), do not change the terrain.

**Dressing** (`parkView.ts`), all decoration with no collision, generated from the map's seed
so a seed always looks the same: things at the rim that make it a place and give a sense of
speed as they pass (a fence or wall segments with graffiti-like blocks of colour, floodlight
towers, bleachers, signs, a few distant silhouettes beyond the rim). Keep the floor of the bowl
clear: nothing drawn where the rider can ride that is not a real thing. A handful of instanced
meshes at most.

## Acceptance

1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run e2e` pass.
2. `tests/e2e/routes/park.mjs`: no console errors; screenshots of each point of interest fresh
   and spent, at 8 m and at 60 m; a rail with a rider on it; a pad; a kicker with its hoop; three
   wide views of the bowl from different places showing the dressing.
3. Dressing is the same for the same seed and different for another (a unit test), and nothing
   of it stands within the rideable radius (a unit test against the terrain's radius).
4. Perf scene draw calls and triangles, both scenes, in your report.

## Return

Summary, decisions, what is still weak, perf numbers, commands with pass/fail, changed files,
branch and last commit.
