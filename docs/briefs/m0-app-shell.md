# M0: app shell

Model: opus. Read `docs/briefs/README.md` for the common rules.

## Goal

The game boots on a phone-sized portrait screen, runs the sim on a fixed 60 Hz clock, and draws a
terrain and a greybox mover from behind the chase camera with the gear on screen. Plus the e2e and
perf runners the gate needs. No touch input and no real map yet: those are built in parallel and
wired in by the lead.

## You own

- `index.html`, `src/vite-env.d.ts`
- `src/app/main.ts`, `src/app/loop.ts`, `src/app/params.ts`, `src/app/testHook.ts`, `src/app/platform.ts`
- `src/render/scene.ts`, `src/render/terrainView.ts`, `src/render/moverView.ts`
- `src/ui/hud.ts` (and a CSS file beside it if you want one)
- `tests/e2e/run.mjs`, `tests/e2e/routes/*.mjs`, `tests/perf/run.mjs`, `tests/perf/budgets.json`
- `tests/unit/loop.test.ts`, `tests/unit/params.test.ts`, `tests/unit/terrainView.test.ts`

## Interfaces to match (already in the repo, read them)

- `src/sim/sim.ts`: `new Sim(terrain)`, `.step(input)`, `.state`, `.prev`.
- `src/sim/types.ts`: `InputFrame`, `SimState`, `MoverState`, `EV_*`.
- `src/sim/terrain.ts`: `Terrain`, `flatTerrain()`, `terrainFromHeight()`.
- `src/sim/constants.ts`: `FEEL`, `DT`, `GEAR_NAMES`.
- `src/render/camera.ts`: `new ChaseCamera(camera)`, `.update(prev, cur, alpha, dt, terrain)`.
- `src/render/look.ts`: `PALETTE`, fog and light constants, `flatMaterial()`, `gearCss()`. Every
  colour and material comes from here.
- `src/input/source.ts`: `InputSource`.

## What to build

**`params.ts`**: `parseParams(search: string): Params`, pure. `debug` (flag), `hook` (flag), `perf`
(flag), `seed` (integer, default 1), `scheme` (`tuck` | `lift` | `swipe`, default `tuck`, anything
else falls back).

**`loop.ts`**: `FixedStepper`, pure and DOM-free: fed real elapsed seconds, it calls `step()` zero or
more times at exactly 1/60 s per step and returns the interpolation alpha (0..1). At most 5 steps per
call; time beyond that is dropped, not banked (a backgrounded tab must not fast-forward). Plus the
`requestAnimationFrame` driver around it, which can be paused.

**`scene.ts`**: `WebGLRenderer` (no shadows, no post-processing, pixel ratio capped at 2,
`powerPreference: 'high-performance'`), scene with fog and background from `look.ts`, one directional
and one ambient light from `look.ts`, a `PerspectiveCamera`. Canvas fills the viewport (use `100dvh`)
and follows resizes and orientation changes.

**`terrainView.ts`**: `makeTerrainView(terrain: Terrain): Object3D`. One mesh for any `Terrain`:
sample `heightAt` on a 2 m grid over the disc of `terrain.radius`, flat-shaded, vertex-coloured as a
checker of 8 m squares in `PALETTE.groundA` / `groundB` with every fourth line (32 m) in
`PALETTE.groundLine`, so speed and slope read without textures. Cells whose height is far above the
floor shade toward `PALETTE.rim`. Boost pads (`terrain.pads`) as flat discs in `PALETTE.pad` just
above the ground. Two draw calls at most.

**`moverView.ts`**: `class MoverView { readonly object: Object3D; update(prev, cur, alpha, terrain) }`.
A greybox figure about 1.7 m tall in `PALETTE.mover`: interpolated position, faces `heading`, tilts
to the ground normal while grounded, sits low and turns `PALETTE.moverTuck` while `tucked`, leans
into turns, stretches a little in the air. A dark blob shadow on the ground directly below it at all
times (this is how hop height is read). No allocation in `update`.

**`hud.ts`**: `class Hud { constructor(root: HTMLElement); update(state: SimState): void }`. Top of
the screen only, inside the safe-area insets: the gear as a very large numeral in `gearCss(gear)`,
the gear name under it, speed in m/s small, and the clean-hop chain count when it is above zero.
Writes to the DOM only when a shown value changes.

**`testHook.ts`**: a permanent `InputSource` plus `window.__shmoove`, installed only with `?hook`:

```ts
interface TestHook {
  ready: boolean;
  state(): { tick; x; y; z; speed; gear; grounded; tucked; chain; viewYaw; events };  // plain copy
  hold(frame: Partial<InputFrame> | null): void; // override the input until cleared with null
  hop(): void;                                   // a hop on the next step
  pause(on: boolean): void;                      // stop the real-time clock
  step(n: number): void;                         // advance n ticks now and render one frame
  stats(): { drawCalls; triangles; frameMs; stepMs }; // averages over the last 120 frames
}
```

**`platform.ts`**: block the browser gestures that fight a game (pinch, double-tap zoom, context
menu, pull-to-refresh, text selection), and hold a screen wake lock from the first touch,
re-acquired when the page becomes visible again. Fail silently where unsupported.

**`main.ts`**: boot. One call site that makes the terrain (`flatTerrain()` for now) and one that
makes the input source (the hook's source for now), so the lead can swap both in one line each.
Each tick: `input.sample(frame)` then `sim.step(frame)`. Each frame: mover view, camera, HUD, render.

**`index.html`**: portrait viewport (`viewport-fit=cover`, no user scaling), theme colour from the
palette, dark background before the canvas appears. No manifest or icon links (the PWA task adds
them).

**`tests/e2e/run.mjs`**: serves `dist/` with `vite preview`, opens Chromium at 390x844 with touch and
device scale factor 2, runs every route in `tests/e2e/routes/`, fails on any console error or
warning or page error, saves `artifacts/screens/<route>.png`, exits non-zero on failure. Routes:

- `boot`: loads with `?hook`; canvas covers the viewport; HUD shows gear 1; screenshot.
- `drive`: holds the stick forward through the hook for 240 ticks; the mover has moved along its
  heading, speed is near run speed, the HUD shows gear 2; then a hop leaves the ground and lands;
  screenshot mid-run.

**`tests/perf/run.mjs`**: same server, CDP CPU throttle 4x, drives forward through the hook for 10
seconds, reads `stats()`, measures the gzip size of the JS in `dist/`, compares with
`tests/perf/budgets.json`, writes `artifacts/perf.json`, exits non-zero over budget. Starting
budgets: frame work 8 ms, sim step 1 ms, 30 draw calls, 120 000 triangles, 400 kB gzip JS.

## Acceptance

1. `npm run typecheck`, `npm run lint`, `npm test` pass.
2. `npx vite build` passes, then `npm run e2e` and `npm run perf` pass. (`npm run build` will not
   work yet: it calls generators the PWA task adds later. Do not change `package.json`.)
3. Unit tests: the stepper (exact step counts for given times, the 5-step cap, alpha in range, no
   banked time), `parseParams` (defaults, each flag, bad values), the terrain view (triangle count
   within budget for radius 170, every vertex on the surface, nothing outside the radius).
4. Open both screenshots with the Read tool and say what you see. The mover must be in the lower
   middle of the frame, the checker must be readable to the horizon fog, the gear numeral must be at
   the top and legible, nothing may cover the middle of the screen.
5. No per-frame allocation in `update` paths; no DOM writes when nothing changed.
