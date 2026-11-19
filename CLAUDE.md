# SHMOOVE

Portrait-mode, one-thumb 3D survivor on a skateboard: a standard survivor (weapons on timers,
touching hurts, sparks, levels, cards) where the movement is the fun part and not a stat. Pitch and
design: `docs/PITCH.md`. Milestones and status: `docs/PLAN.md`. Decisions: `docs/DECISIONS.md`.

**State of the repo:** M0 to M2 are built. M3's content is in (cards, ten weapons, eleven passives,
seven enemies, elites, map objects). The design changed after the owner's first play (DECISIONS
42): the core rules are already standard-survivor; `docs/PLAN.md` lists what is left of the change
(weapons to timers, drawing the M3 content, a lesson, balance).

**Rules of the game that code must not break:** how fast the player is moving never changes damage
dealt, damage taken or healing. Weapons fire on timers. Touching an enemy hurts.

## Stack

TypeScript + Three.js (WebGL2) + Vite, shipped as an installable offline PWA.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Draws the icons, then the Vite dev server |
| `npm run build` | Typecheck, icons, production build to `dist/`, service worker |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint, including the sim purity rules |
| `npm test` | Vitest: unit tests and deterministic sim tests with bots (headless) |
| `npm run e2e` | Playwright at 390x844 with touch: every route in `tests/e2e/routes/`; fails on a console error or warning; saves `artifacts/screens/*.png` |
| `npm run e2e:pwa` | The built app installs, works offline and updates through the bottom bar |
| `npm run perf` | Headless Chrome at 4x CPU throttle against `tests/perf/budgets.json`; writes `artifacts/perf.json` |
| `npm run gate` | All of the above in order, stopping at the first failure. A milestone is done only when this is green |

URL parameters: `?debug` (feel panel), `?scheme=tuck|lift|swipe`, `?seed=N` (map and run), `?solo`
(the bowl with no horde), `?flat` (level ground with no horde, for tests), `?horde=N&sparks=M` (a
fixed crowd with the director off, for perf and screenshots), `?arsenal` (every weapon and one of
each map object, for screenshots), `?lesson` / `?nolesson` (force or skip the first-run lesson),
`?mute`, `?hook` (`window.__shmoove` test hook), `?perf`, `?look=night|pool|tape|riso` (the look;
saved on the device once chosen).

## Layout

- `src/sim/` deterministic simulation. Pure TypeScript. Fixed 60 Hz step, seeded RNG.
  `mover.ts` (carve, tuck, hop), `flow.ts` (gears), `bowl.ts` (the map), `constants.ts` (`FEEL`:
  how it feels), `balance.ts` (how strong things are), `world.ts` (the horde, sparks, shots, zones,
  map things, player and run state, as dense arrays), `arsenal.ts` (weapon and passive ids and
  card text), `stats.ts` (the player's stats, from the build), `build.ts` (the only place the
  loadout changes; offers), `offer.ts` (what is on a card), `weapons/` (one file per weapon and
  the registry), `contact.ts` (hurt, plow, bonk), `wake.ts`, `seekers.ts`, `sparks.ts`, `horde.ts`
  (movement), `director.ts` (spawning), `sim.ts` (the tick order).
- `src/input/` touch gestures -> `InputFrame`. `gestures.ts` is pure; `touch.ts` binds the DOM.
- `src/render/` Three.js. Reads sim state, never writes it. `camera.ts`, `look.ts` (the looks: each a
  palette and a style, one chosen when the page loads), `scene.ts` (renderer, lights, and the one
  pass over the frame a look may ask for), one view per kind of thing; the horde, sparks and shots
  are instanced. Views take every colour from `PALETTE` and every material from `look.ts`.
- `src/audio/` Web Audio synthesis: the generated soundtrack (pure pattern, mix and scheduler) and
  the effects (a pure mapping from the tick's events to sounds), behind one `GameAudio`.
- `src/ui/` DOM overlay: HUD, cards, build bar, end card, lesson, how-to, threat cues, stick view,
  debug panel.
- `src/app/` boot, main loop, settings, platform glue, PWA, test hook.
- `scripts/` the gate, the icon generator, the service-worker generator.
- `tests/unit`, `tests/sim` (bots in `tests/sim/bot/`), `tests/e2e`, `tests/perf`.
- `docs/briefs/` one file per delegated task.

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
  (`src/sim/mover.ts`), gears, contact and Wake loop logic (`src/sim/flow.ts`, `src/sim/contact.ts`,
  `src/sim/wake.ts`), the shared world state and the build system (`src/sim/world.ts`,
  `arsenal.ts`, `stats.ts`, `build.ts`, `offer.ts`), the camera
  (`src/render/camera.ts`), the core look (`src/render/look.ts`), integration, and debugging anything
  Opus has failed at twice.
- **Opus subagents:** contract-bound work that needs design judgement: bowl generation, the app
  shell and render views, enemies and the spawn director, weapons and passives, bots and balance
  tests, and all independent verification.
- **Sonnet subagents:** contract-bound work that is mostly plumbing: input gesture logic, PWA setup
  and deploy, the debug panel and settings, simple UI screens, saves, docs, mechanical refactors.

Delegation rules:

- Agents are defined in `.claude/agents/implementer.md` and `.claude/agents/verifier.md`. Pass the
  model explicitly on every spawn (`opus` or `sonnet` as above); the brief names it too.
- Every brief states: the goal, the files the agent owns, the interfaces to match, the acceptance
  tests, and what to return (a short summary and the list of changed files, never file contents).
- Independent tasks run in parallel in separate git worktrees and are merged by the lead.
- The verifier checks each result against its brief with fresh context. The lead reviews only
  interfaces, feel-critical code, and whatever the verifier flags.
- Do not spawn an agent for a task smaller than its brief.
