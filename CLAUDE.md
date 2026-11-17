# SKITCH

Portrait-mode, one-thumb skating game set in Santa Rampa. TypeScript + Three.js + Vite, shipped as an
installable PWA. Spec: `docs/DESIGN.md`. Progress: `docs/PLAN.md`. Decisions: `docs/DECISIONS.md`.
Human-only tuning list: `docs/PLAYTEST.md`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server (add `?debug` for the feel panel, `?slice` for the M1 feel slice) |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run preview` | Serve `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (includes the sim purity rules) |
| `npm test` | Vitest: unit tests + deterministic sim tests (headless, no browser) |
| `npm run e2e` | Playwright at 390x844 with touch: plays the scripted route, saves `artifacts/screens/*.png` |
| `npm run perf` | Headless Chrome, 4x CPU throttle: frame time, draw calls, triangles vs. budgets |
| `npm run gate` | All of the above in order. A milestone is done only when this is green |

## Layout

- `src/sim/` deterministic simulation. Pure TypeScript. Fixed 60 Hz step, seeded RNG.
- `src/input/` touch gestures -> `InputFrame`.
- `src/render/` Three.js. Reads sim state, never writes it.
- `src/audio/` Web Audio synthesis and the stem mixer.
- `src/ui/` DOM overlay: destination boards, ticket stubs, line map, menus.
- `src/app/` boot, main loop, saves, debug panel, PWA glue.
- `tests/unit`, `tests/sim`, `tests/e2e`, `tests/perf`.

## Conventions

- **Sim purity.** `src/sim/**` imports nothing from `three`, the DOM, `src/render`, `src/ui`,
  `src/audio` or `src/app`. No `Date`, `performance`, `Math.random`. No `Math.sin/cos/tan/atan2/
  asin/acos/pow/exp/log` (engine-dependent results): use `dsin/dcos/datan2/...` from
  `src/sim/math.ts`. `Math.sqrt/abs/floor/ceil/round/min/max/sign/trunc/fround/imul` are fine.
  ESLint enforces this.
- **One clock.** The sim advances only through `Sim.step(input)`; one step = 1/60 s. Rides are a pure
  function of the tick. Rendering interpolates between the last two sim states.
- **Feel constants** live in `src/sim/constants.ts` (`FEEL`). Nothing feel-related is hard-coded
  elsewhere. Every constant appears in the debug panel and, if only a thumb can judge it, in
  `docs/PLAYTEST.md`.
- **No assets.** Geometry, textures, shaders, fonts-as-shapes and audio are generated in code.
- **Strict TypeScript.** No `any`, no non-null `!` on things that can be null at runtime.
- **Allocation.** No per-tick or per-frame allocation in sim or render hot paths; use `out` params
  and scratch objects.
- **Tests assert behaviour** (what the player would observe), not implementation. Never weaken a test
  to make it pass; fix the code or flag it.
- **Commits** are small and say why. Each milestone ends with a green `npm run gate` and a tag `mN`.
- **Docs stay current.** `docs/PLAN.md` is updated in the same commit that changes status. Anything
  cut or decided without the owner goes in `docs/DECISIONS.md`.

## Who does what (model rules)

Fable is the scarce resource; Opus does the bulk of the work.

- **Fable (lead):** architecture and plan, interface contracts, the movement controller
  (`src/sim/player.ts`), hitch / slingshot / chain logic (`src/sim/hitch.ts`), the camera
  (`src/render/camera.ts`), the core look (`src/render/look.ts`), integration, and debugging anything
  Opus has failed at twice.
- **Opus subagents:** everything with a clear contract: scaffolding, build config, test harness, city
  generation, ride and timetable data, UI screens, audio sequencing, errands, saves, PWA setup, docs,
  refactors, and all independent verification.

Delegation rules:

- Agents are defined in `.claude/agents/implementer.md` and `.claude/agents/verifier.md`
  (`model: opus`). Pass the model explicitly on every spawn as well.
- Every brief states: the goal, the files the agent owns, the interfaces to match, the acceptance
  tests, and what to return (a short summary and the list of changed files, never file contents).
- Independent tasks run in parallel in separate git worktrees and are merged by the lead.
- The verifier checks each result against its brief with fresh context. The lead reviews only
  interfaces, feel-critical code, and whatever the verifier flags.
- Do not spawn an agent for a task smaller than its brief.
