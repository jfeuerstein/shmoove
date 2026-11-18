# SHMOOVE

Portrait-mode, one-thumb 3D survivor where speed is the build. Pitch and design: `docs/PITCH.md`.
Milestones and status: `docs/PLAN.md`.

**State of the repo:** restarted from scratch. There is no code yet; M0 in `docs/PLAN.md` creates the
toolchain. The commands and layout below are the contract M0 builds to. Update this file in the
commit that makes any of it real or different.

## Stack

TypeScript + Three.js (WebGL2) + Vite, shipped as an installable offline PWA.

## Commands (from M0)

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server (`?debug` for the feel panel) |
| `npm run build` | Typecheck, production build to `dist/`, service worker |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint, including the sim purity rules |
| `npm test` | Vitest: unit tests and deterministic sim tests with bots (headless) |
| `npm run e2e` | Playwright at 390x844 with touch; fails on a console error or warning; saves screenshots |
| `npm run perf` | Headless Chrome at 4x CPU throttle against `tests/perf/budgets.json` |
| `npm run gate` | All of the above in order. A milestone is done only when this is green |

## Layout (from M0)

- `src/sim/` deterministic simulation. Pure TypeScript. Fixed 60 Hz step, seeded RNG.
- `src/input/` touch gestures -> `InputFrame`.
- `src/render/` Three.js. Reads sim state, never writes it.
- `src/audio/` Web Audio synthesis and the gear-driven stem mixer.
- `src/ui/` DOM overlay: HUD, level-up cards, menus.
- `src/app/` boot, main loop, saves, settings, haptics, debug panel, PWA glue, test hook.
- `tests/unit`, `tests/sim` (bots in `tests/sim/bot/`), `tests/e2e`, `tests/perf`.

## Conventions

- **Sim purity.** `src/sim/**` imports nothing from `three`, the DOM, or any other `src/` folder. No
  `Date`, `performance`, `Math.random`. No `Math.sin/cos/tan/atan2/asin/acos/pow/exp/log`
  (engine-dependent results): use the deterministic versions in `src/sim/math.ts`. ESLint enforces it.
- **One clock.** The sim advances only through `Sim.step(input)`; one step = 1/60 s. Rendering
  interpolates between the last two sim states.
- **Feel constants** live in `src/sim/constants.ts` (`FEEL`). Nothing feel-related is hard-coded
  elsewhere. Every constant appears in the debug panel and, if only a thumb can judge it, in
  `docs/PLAYTEST.md`.
- **No assets.** Geometry, textures, shaders and audio are generated in code.
- **Strict TypeScript.** No `any`, no non-null `!` on things that can be null at runtime.
- **Allocation.** No per-tick or per-frame allocation in sim or render hot paths. Enemies, sparks,
  projectiles and damage numbers are pooled.
- **Tests assert behaviour** (what the player would observe), not implementation. Never weaken a test
  to make it pass; fix the code or flag it.
- **Commits** are small and say why. Each milestone ends with a green `npm run gate` and a tag `mN`.
- **Docs stay current.** `docs/PLAN.md` is updated in the same commit that changes status. Anything
  cut or decided without the owner goes in `docs/DECISIONS.md`.

## Who does what (model rules)

Fable is the scarce resource; Opus does the bulk of the work.

- **Fable (lead):** architecture and plan, interface contracts, the movement controller
  (`src/sim/mover.ts`), gears and Wake loop logic (`src/sim/flow.ts`, `src/sim/wake.ts`), the camera
  (`src/render/camera.ts`), the core look (`src/render/look.ts`), integration, and debugging anything
  Opus has failed at twice.
- **Opus subagents:** everything with a clear contract: scaffolding, build config, test harness, bowl
  generation, enemies and the spawn director, weapons and passives, UI screens, audio, saves, PWA
  setup, docs, refactors, and all independent verification.

Delegation rules:

- Agents are defined in `.claude/agents/implementer.md` and `.claude/agents/verifier.md`
  (`model: opus`). Pass the model explicitly on every spawn as well.
- Every brief states: the goal, the files the agent owns, the interfaces to match, the acceptance
  tests, and what to return (a short summary and the list of changed files, never file contents).
- Independent tasks run in parallel in separate git worktrees and are merged by the lead.
- The verifier checks each result against its brief with fresh context. The lead reviews only
  interfaces, feel-critical code, and whatever the verifier flags.
- Do not spawn an agent for a task smaller than its brief.
