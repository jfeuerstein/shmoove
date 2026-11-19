# M3, second pass: rails on the map

Model: opus. Read `docs/PITCH.md`, `docs/DECISIONS.md` items 42 to 49, `docs/briefs/README.md`,
`docs/briefs/m2-common.md`, `docs/briefs/m3-common.md`, then `src/sim/terrain.ts` (`Rail`,
`railOver`), the rail code in `src/sim/mover.ts` (`catchRail`, `stepGrind`), `tests/sim/rails.test.ts`,
`src/sim/bowl.ts` (the layout, `chooseSites`), `tests/unit/bowl.test.ts`, `src/render/thingsView.ts`,
`src/render/moverView.ts`, `src/render/fxView.ts`, `src/render/look.ts`.

## Goal

The bowl is a skatepark with rails in it. A rider who hops onto one grinds it, above the reach of
the small enemies, and comes off the end with more speed than they went on with. Rails are placed
where a line already wants to go, and they can be seen, read and aimed at from a distance.

The grinding itself is built and tested on hand-made terrains (lead-owned, do not edit). This
task puts rails on the real map and draws them.

## You own

In `src/sim/bowl.ts`: choosing the rails (`BowlTerrain.rails`, and a `rails` list on
`BowlFeatures`), nothing about the heightfield. `tests/unit/bowl.test.ts`: tests for them. A new
`tests/sim/bowl-rails.test.ts`. A new `src/render/railsView.ts` and `tests/unit/railsView.test.ts`.
In `src/render/moverView.ts` (+ its test): the grinding pose. In `src/render/fxView.ts`: grind
sparks. In `src/app/main.ts`: creating and updating the rails view.

## Placing rails

Chosen from the seed after the layout and the sites, from their own random stream
(`new Rng(seed).fork('rails')`); the heightfield and every existing site must not change (the
recorded-heights test in `tests/unit/bowl.test.ts` must pass untouched).

- 8 to 12 rails, each straight, 14 to 32 m long, on the floor (r < 125).
- Each stands 1.2 m above the ground at both ends (`railOver`). Along its whole length the ground
  under it is between 0.7 and 2.4 m below it (sample every metre): no rail buried in a hill, none
  out of reach of a hop.
- Each falls from one end to the other by at least 0.03 of its length, or is within 0.02 of level;
  none climbs steeply both ways.
- At least 3 m of clear run-up before each end: slope under 0.35, no site, pad or other rail
  within 4 m of the rail's line (hoops excepted).
- Where they go: at least two **chains** (two or three rails end to end along one line, 5 to 8 m
  apart, so coming off one lands on the next); at least two along the fall line of a hillside; at
  least one down the length of each half-pipe's floor, off its centre line; the rest where they
  fit. No rail within 14 m of the spawn.

## Drawing them (`railsView.ts`)

One instanced mesh for the bars (a thin box per rail, `PALETTE.rail`, bright enough to pick out
against the ground at 60 m) and one for the posts (a post at each end and every 6 m or so,
`PALETTE.railPost`). Built once from `terrain.rails`; nothing per frame.

**The rider on a rail** (`moverView.ts`): while `mover.rail >= 0` the board sits across the rail
(a boardslide) and the figure crouches with arms out. **Sparks** (`fxView.ts`): a stream of small
`PALETTE.grindSpark` shards from the board while grinding, from the pooled shards, and a burst on
`EV_GRIND_START` and `EV_GRIND_END` (read `SimState.events` each tick alongside `w.fx`).

## Acceptance

1. `npm run gate` is green; every existing bowl test passes unchanged.
2. `tests/unit/bowl.test.ts` for seeds 1 to 5: the count, lengths, the clearance along each
   length, the fall rule, the run-up and spacing rules, the chains (count, alignment, gaps), the
   pipe and hillside rails, deterministic, and no change to heights or sites.
3. `tests/sim/bowl-rails.test.ts` on real bowls, seeds 1 to 3: a scripted rider that rides at
   the high end of each rail and hops catches it (every rail on the map is catchable from its
   run-up at run speed); it leaves the end faster than it arrived on every falling rail; in each
   chain, coming off the first rail without touching anything it catches the second; a rider
   that never hops never catches one.
4. `tests/unit/railsView.test.ts`: one bar per rail between its ends, posts at both ends and
   between, nothing rebuilt per frame. The mover view's grind pose differs from riding and from
   the air.
5. An e2e route `rails` with `?hook&nolesson`: place the rider on a rail's run-up through the
   hook, hop, and assert the rider is grinding (`state().rail >= 0`; add `rail` to the hook's
   state); two screenshots, one from the run-up looking at the rail, one mid-grind. Open them
   with the Read tool and say what you see: can the rail be seen and aimed at; does the grind
   read as a grind.
6. Report where the rails are for seed 1 (ends, length, fall) and the perf numbers.
