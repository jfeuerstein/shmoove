Your role and rules are defined in `.claude/agents/implementer.md` in this repo: read that file first and follow it exactly (ignore its YAML frontmatter). Then read `CLAUDE.md` and `docs/DESIGN.md` (sections 9, 10, 11). The repo currently holds only docs.

You are the implementer for task M0-SCAFFOLD on SKITCH.

## Goal
Scaffold the project so that `npm install`, `npm run build`, `npm test`, `npm run e2e`, `npm run perf` and `npm run gate` all work end to end on a tiny bootable app, and so the lead can then drop the real game into `src/` without touching build config. Keep dependencies minimal.

## Files you own
- `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `index.html`
- `src/app/main.ts` (a tiny boot; the lead will replace it), `src/app/testHook.ts`, `src/app/params.ts`
- `tests/e2e/**`, `tests/perf/**`, `tests/unit/harness.test.ts`, `tests/unit/params.test.ts`
- `scripts/**` (gate runner etc.)
Do not create anything under `src/sim`, `src/render`, `src/input`, `src/ui`, `src/audio`. Do not edit docs except to fix a command name in CLAUDE.md if you had to deviate (say so).

## Requirements

**Dependencies.** Runtime: `three` only. Dev: `typescript`, `vite`, `vitest`, `eslint` + `typescript-eslint`, `@types/three`, `playwright` pinned to exactly `1.63.0` (this matches the Chromium preinstalled in this container at `/opt/pw-browsers`; do NOT run `playwright install`). Nothing else unless strictly needed; justify any addition in your summary. Node 22.

**TypeScript.** `strict`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, ES2022 target, `moduleResolution: bundler` (leave `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` off). `tsc --noEmit` covers `src`, `tests` and any typed files in `scripts`.

**Scripts** (exact names): `dev`, `build` (typecheck then `vite build`), `preview`, `typecheck`, `lint`, `test` (vitest run over `tests/unit/**/*.test.ts` and `tests/sim/**/*.test.ts`, node environment, no browser; must not fail when `tests/sim` is empty), `e2e`, `perf`, `gate`.

**ESLint (flat config).** typescript-eslint recommended, plus the sim purity rules for files matching `src/sim/**`:
- `no-restricted-imports`: forbid `three`, `three/*`, and any path into `src/render`, `src/ui`, `src/audio`, `src/app`, `src/input`.
- `no-restricted-globals`: `window`, `document`, `navigator`, `performance`, `Date`, `localStorage`, `requestAnimationFrame`, `setTimeout`, `setInterval`.
- `no-restricted-properties` on `Math`: `random`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `pow`, `exp`, `log`, `log2`, `log10`, `sinh`, `cosh`, `tanh`, `hypot`, `cbrt`, `expm1`, `log1p` (message: use src/sim/math.ts).
- Ban the `**` exponent operator in `src/sim/**` via `no-restricted-syntax`.
Repo-wide: forbid `any` (`@typescript-eslint/no-explicit-any` error), forbid `// @ts-ignore`, error on unused vars (allow `_` prefix). Lint must pass with zero warnings (`--max-warnings 0`). Add a unit test (`tests/unit/harness.test.ts`) that runs ESLint programmatically on an in-memory `src/sim/x.ts` snippet and asserts each purity rule fires (so the rules cannot silently rot).

**index.html.** Portrait game shell: `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">`, a full-viewport `<canvas id="game">`, an overlay `<div id="ui">` above it (pointer-events none by default), body `touch-action: none; overscroll-behavior: none; user-select: none; background: #1B1A2E`. Title SKITCH. No external fonts or assets.

**URL params** (`src/app/params.ts`, parsed once, typed, with a pure `parseParams(search: string)` function): `e2e` (flag: manual stepping), `debug` (flag), `slice` (flag), `route` (string|null), `seed` (int, default 1), `t` (number|null, start day fraction), `mute` (flag).

**Test hook contract** (`src/app/testHook.ts`) — implement exactly these types and install on `window.__skitch`:
```ts
export interface SkitchTestState { tick: number; mode: string; x: number; y: number; z: number; speed: number; chain: number; hitchedLine: string | null; dayFrac: number; }
export interface SkitchPerfStats { frames: number; workMs: number[]; drawCalls: number; triangles: number; }
export interface SkitchHook {
  ready: boolean;
  /** true when opened with ?e2e: the app does not run its own rAF loop */
  manual: boolean;
  /** manual mode only: step the sim `ticks` fixed steps (sampling current input each step), then render exactly one frame */
  advance(ticks: number): void;
  state(): SkitchTestState;
  /** since the last resetStats(); workMs[i] = duration of frame i's work (sim + scene update + render submit) inside the rAF callback; drawCalls/triangles are from the most recent frame */
  stats(): SkitchPerfStats;
  resetStats(): void;
}
declare global { interface Window { __skitch?: SkitchHook } }
export function installHook(hook: SkitchHook): void;
```
`src/app/main.ts` (temporary boot): a Three.js `WebGLRenderer` on `#game` (antialias off, pixel ratio min(devicePixelRatio, 2)), concrete-coloured clear (`#D9D2C3`), one flat-shaded mango (`#FFAE1A`) cube that rotates one fixed increment per sim tick and moves horizontally to follow the current touch x (so the e2e can assert touch input reaches the app), a fixed-step 60 Hz accumulator loop (max 4 catch-up steps per frame), and a full implementation of the hook (in `?e2e` mode no rAF loop runs; `advance` steps and renders). `state()` returns tick, `mode: 'BOOT'`, x = cube x, the rest zero/null. Keep it under ~150 lines; it is a harness fixture, the lead replaces it.

**e2e runner** (`tests/e2e/`). A plain Node script (ESM) using the `playwright` library, not `@playwright/test`. It: builds if `dist/` is missing, starts `vite preview` on a free port, launches Chromium headless (`chromium.launch()` with no executablePath; if that throws, retry with `executablePath: process.env.SKITCH_CHROMIUM || '/opt/pw-browsers/chromium'` when it exists) with flags that give a working WebGL context in headless (verify; typically `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`, pick what actually works here), opens a context at viewport 390x844, `deviceScaleFactor: 2`, `hasTouch: true`, `isMobile: true`, portrait, navigates to `/?e2e&mute` (+ extra params per route), waits for `window.__skitch.ready`, then plays **routes**.
- A route is a named, data-only script exported from `tests/e2e/routes/*.mjs`: `{ name, params?: string, steps: Step[] }` with steps: `{do:'down',x,y}`, `{do:'move',x,y}`, `{do:'up'}`, `{do:'swipeUp', x?, y?, hold?}` (a fast upward flick: down, 3 moves upward totalling ≥160 px across 3 ticks, then up — unless `hold:true`, then the finger stays down; if a finger is already down, the flick continues from its current position), `{do:'wait',ticks}`, `{do:'shot',name}`, `{do:'expect', label, test: (state, history) => boolean}` where the runner passes the current `SkitchTestState` and an array of all states sampled so far. Coordinates are CSS px in the 390x844 viewport.
- Touch is dispatched as real touch events through CDP `Input.dispatchTouchEvent` (not synthetic JS events). Between steps time only advances through `__skitch.advance(n)`; the run is therefore deterministic. `wait` advances in slices of at most 6 ticks so intermediate frames render, and a state is sampled into the history after each slice.
- `shot` saves `artifacts/screens/<route>-<name>.png`.
- The runner fails (non-zero exit) on any failed `expect`, page error, console error, or a blank canvas: add a helper that takes a screenshot and asserts the game canvas region is not a single flat colour.
- Runs all routes in `tests/e2e/routes/` or a single one via `npm run e2e -- <name>`. Prints a compact per-route PASS/FAIL table.
- Ship one route `boot.mjs` for the temporary app: touch down at x=300, wait, expect state.x > 0 (cube followed the touch), shot.

**perf runner** (`tests/perf/`). Node script, same browser launch helper (share it in `tests/e2e/lib/`). Opens `/?route=perf&mute` (no `e2e`: the real rAF loop runs), applies CDP `Emulation.setCPUThrottlingRate` rate 4, waits for ready, lets it warm up 2 s, `resetStats()`, runs 10 s, reads `stats()`, and checks against `tests/perf/budgets.json` (create it from DESIGN section 10: `drawCalls` 120, `triangles` 180000, `workMeanMs` 10, `workP95Ms` 16.6, plus `bundleGzipKb` 400 measured by gzipping the JS in `dist/assets`). Prints mean/p50/p95/max work ms, frames, draw calls, triangles, bundle size, and PASS/FAIL per budget; writes the same to `artifacts/perf.json`; non-zero exit on any failure. In the temporary app `?route=perf` needs no special behaviour.

**gate** (`scripts/gate.mjs`): runs typecheck, lint, test, build, e2e, perf in order, stops at the first failure, prints a summary table with durations.

**Sample unit tests** so `npm test` is non-empty: test `parseParams` and the route step validation (a pure function you write in `tests/e2e/lib/` that validates route objects).

## Acceptance tests (run all, report results)
1. `rm -rf node_modules dist && npm install && npm run build && npm test` passes from a clean tree.
2. `npm run lint` passes with zero warnings; the purity-rule unit test proves each restricted item is reported.
3. `npm run e2e` passes, and `artifacts/screens/boot-*.png` exists, is 780x1688, and visibly shows the mango cube on concrete (open it with the Read tool and look).
4. `npm run perf` prints the table and passes budgets on the temporary app.
5. `npm run gate` is green end to end.
6. `git status` is clean after committing; `artifacts/`, `dist/`, `node_modules/` are ignored.

## Return
A short summary (versions chosen, any deviation from this brief and why, the Chromium flags that worked), the commands you ran with pass/fail and key numbers, and the list of changed files. No file contents. Commit on your current branch with small commits; do not push or merge.
