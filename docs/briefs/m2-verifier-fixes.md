# M2: small fixes from the verification pass

Model: sonnet. Read `docs/briefs/README.md` and `docs/briefs/m2-common.md`. You may edit exactly
the files each item names, and only for that item.

1. **Restart carries things over** (`src/app/main.ts`, `src/ui/threat.ts`, `src/render/fxView.ts`):
   after `AGAIN` the threat glow fades from its old strength, pooled effects from the last run may
   still be playing, and with `?horde=N` the crowd is not put back (restart gives an empty bowl
   with the director off). Give `ThreatView` and `FxView` a `reset()`, call both from `restart`,
   and re-apply the fixture there when one was asked for.
2. **A string is built every frame for the clock** (`src/ui/hud.ts`): compare whole seconds left
   as a number first and build the text only when it changes. Extend the write-counting test in
   `tests/unit/hud.test.ts` if it does not already cover the clock.
3. **The speed on the end card** (`tests/e2e/routes/run.mjs`): the sim now zeroes the mover's speed
   when a run ends. Assert the HUD reads `0 m/s` once the card is up.
4. **The Wake ribbon is too heavy on screen** (`src/render/wakeView.ts`,
   `tests/unit/wakeView.test.ts`): close to the camera it is a wide opaque slab that fills the
   lower third and competes with the mover. Keep the full burn width, but draw it as a bright
   core down the middle 40% of the width and faint edges out to the full width (so it needs four
   vertices across, not two), with the head no stronger than about 0.5 alpha at the core and 0.15
   at the edges, fading to nothing at the tail. Still one draw call and one preallocated buffer.
   Update the ribbon tests to the new layout.
5. **Tests that could not fail** (new `tests/unit/fixtures.test.ts`; `tests/unit/threat.test.ts`):
   the fixture's mix (about 80 / 15 / 5), its 8 m clearance from the spawn, that it is
   deterministic and turns the director off; the threat glow's smoothing (after a step change in
   the count it is about 63% of the way there after a third of a second, and `reset()` zeroes it).

## Acceptance

1. `npm run gate` is green.
2. For items 1, 2 and 5, say how you saw each new assertion fail against the old behaviour.
3. Open `artifacts/screens/horde.png` with the Read tool and say what the Wake looks like now.
4. No change outside the files the items name.
