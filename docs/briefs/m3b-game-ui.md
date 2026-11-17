Your role and rules are defined in `.claude/agents/implementer.md` in this repo: read that file first and follow it exactly (ignore its YAML frontmatter). Then read `CLAUDE.md`, `docs/DESIGN.md` (sections 2, 5, 6, 7 "UI", 9, 11), and these files in full: `src/sim/types.ts`, `src/sim/lines.ts`, `src/sim/sim.ts`, `src/sim/world.ts` (types and zones), `src/sim/constants.ts` (skim), `src/app/main.ts`, `src/app/testHook.ts`, `src/input/gestures.ts`, `tests/sim/helpers.ts`, `tests/e2e/routes/slice-hitch.mjs`, `tests/e2e/lib/route.d.mts`. Run `npm install` first.

You are the implementer for task M3B-GAME-UI on SKITCH: the game-state layer above the sim (starting with line-map progress), the UI foundation in the game's print style, the in-play HUD, the stop timetable board and the line map screen. Work against the feel-slice world (`?slice`, two lines); everything must be data-driven so it works unchanged when the full city with 16 lines lands.

## Files you own
- `src/sim/game/**` (new; pure sim code, all sim purity rules apply)
- `src/ui/**` (new)
- `src/app/main.ts` (wiring changes only: use `Game` instead of `Sim` directly, create the UI, honour pause, feed the test hook; keep the loop structure, the debug panel, the route playback and the hook contract intact)
- `tests/sim/game.test.ts`, `tests/unit/ui/**`, `tests/e2e/routes/slice-map.mjs`
Do not edit anything else. In particular not `src/sim/player.ts`, `hitch.ts`, `lines.ts`, `world.ts`, `constants.ts`, `src/render/**`, `src/input/**`, `index.html`. If you need a change there, stop and report it.

## Part 1: `Game` (src/sim/game/)
```ts
// src/sim/game/game.ts
export type GameEvent =
  | { type: 'segmentInked'; line: number; segment: number }
  | { type: 'lineComplete'; line: number }
  | { type: 'lineDiscovered'; line: number }   // a secret line ridden for the first time
  | { type: 'mapComplete' };
export class Game {
  readonly sim: Sim;
  readonly progress: Progress;
  /** Events from the most recent step (cleared at the start of each step). */
  readonly events: GameEvent[];
  constructor(world: World, opts?: SimOpts);
  /** One tick: steps the sim, then every game reducer in a fixed order. The only way time advances. */
  step(input: InputFrame): void;
}
```
Design it so later tasks add more reducers (errands, conductors, secrets, chalk lines, saves) without touching existing ones: a reducer is a module with its own state object and a `step(game)` function that reads `game.sim`, `game.sim.events` and pushes `GameEvent`s. Keep `GameEvent` an open union other modules can extend by editing the type.

**Line-map progress** (`src/sim/game/progress.ts`):
- Segments of a line come from `CompiledLine.allStops` and `length`: for a loop with stops at s0 = 0 < s1 < … < sk-1, segment i runs from s_i to s_(i+1), and the last from s_(k-1) to `length` (back to the terminus). For a shuttle (loop false) the segments are the k−1 gaps between consecutive stops; riding one in either direction inks it.
- A segment is inked when, during one unbroken hitch to a vehicle of that line, the vehicle travels the whole segment: it was at or before the segment's start (within `INK_SLACK` = 12 m inside the segment still counts, because a bumper is grabbed as the vehicle pulls away) and reaches the segment's end (same slack). Track it from the vehicle's arc position each tick (`vehicleAt(line, vehicle, sim.tick, out)`: `out.s`, `out.dir`), handling the loop wrap at `length` and shuttle direction reversal. A release or bail ends the hitch and discards partial coverage.
- `Progress` state: per line `inked: boolean[]`, `complete`, `discovered` (regular lines start discovered; `secret` lines become discovered on the first hitch, emitting `lineDiscovered`). Emits `segmentInked` once per segment, `lineComplete` when a line's last segment is inked, `mapComplete` when every non-secret line is complete.
- Pure helpers the UI needs: `lineSegments(line)`, `inkedCount(progress, lineIndex)`, `mapFraction(progress, lines)` (non-secret segments inked / total).
- State must be plain JSON-serialisable data (the saves task will persist it): export `exportProgress(p)` / `importProgress(lines, data)` that round-trip and tolerate data for a line whose segment count changed (clamp/ignore).

## Part 2: UI foundation and screens (src/ui/)
Look: DESIGN section 7 "UI". Destination boards: ink `#1B1A2E` panels, mango `#FFAE1A` condensed capitals in split-flap cells (each character its own cell with a hairline split across the middle; when a character changes the cell flips with a 2-step animation, i.e. on twos). Ticket stubs: paper `#F3EBDD` cards with a perforated edge (CSS mask/radial-gradient), a punched hole, a serial number, and pink `#FF2E88` / cobalt `#1F3FBF` overprint a pixel off-register (text-shadow). No images, no web fonts (font stack: `'Arial Narrow','Roboto Condensed','Helvetica Neue',Arial,sans-serif` with uppercase and letter-spacing; monospace digits where they tick). CSS lives in TS (one injected `<style>`), prefixed `sk-`. Respect `env(safe-area-inset-*)`. Everything under `#ui` is `pointer-events: none` except explicit controls. Layout must work from 320x568 to 430x932 portrait; the e2e viewport is 390x844.

```ts
// src/ui/index.ts
export interface UiFrame {
  game: Game;
  armed: boolean;                      // gestures.isArmed
  simEvents: readonly SimEvent[];      // all sim events since the last frame
  gameEvents: readonly GameEvent[];    // all game events since the last frame
  dt: number;                          // seconds since the last frame
}
export interface UiSound { ui(name: 'tick' | 'punch' | 'ink' | 'fanfare' | 'deny'): void }
export interface Ui {
  update(f: UiFrame): void;
  /** True while a screen that pauses play is open (the line map). main.ts stops stepping the sim. */
  readonly paused: boolean;
  /** Flat facts for the e2e hook (see below). */
  testState(): Record<string, string | number | boolean>;
  dispose(): void;
}
export function createUi(root: HTMLElement, game: Game, sound: UiSound | null): Ui;
```
Components (small modules, each updating the DOM only when its displayed value changes; no per-frame innerHTML churn, no layout thrash; the UI's work is inside the frame budget):
1. **Destination board (top).** Not hitched: district name (`districtAt` + `DISTRICT_NAMES`), the clock (the 12-minute day shown as a 24-hour clock HH:MM from `sim.dayFrac`, ticking in 5-minute steps of game time), speed in km/h. Hitched: a line badge (the line id on a chip in the livery base colour with the stripe colour as a band), the line name, an arrow and the next stop's name, and a countdown to arrival there (m:ss of real time, from the timetable: use the line's lap table, do not simulate).
2. **Chain meter.** Hidden at 0. Shows ×N with one pip per link (mango pips, the newest flips in), and while the chain is alive in flight a thin bar draining with the ground grace used (`player.chainGround / FEEL.CHAIN_GROUND_GRACE`). A lost chain (`chainEnd`) flips the board to the count that was lost for a moment, then clears.
3. **Hold cue.** A small unobtrusive mark at the bottom centre that shows when the touch is armed (so the player learns that a still press arms): an open ring when armed with nothing in reach, filled when hitched. No text.
4. **Ticket toasts.** A stack (max 3, newest on top, each lives ~3.5 s, slides in on twos): segment inked ("INKED" + line badge + "FROM → TO" stop names), line complete (bigger, punched), line discovered (secret), denied ("NEEDS N LINKS" from the sim `denied` event), map complete. Calls `sound.ui(...)` with the matching name when a toast appears.
5. **Stop board.** When the skater is within 14 m (plan distance) of a stop of any discovered line and not hitched, a timetable board slides up from the bottom: stop name as title, then up to 4 rows: line badge, "→ next stop name", time to arrival m:ss, soonest first (`ticksToArrival`). Rows for lines not in service at that time show "NO SERVICE". Recompute at most 4 times a second.
6. **Line map screen.** A small map button (top-left, 44x44 px minimum touch target, pointer-events auto) opens it; opening pauses play (`paused` true), a close control or tapping the button again closes it. Content: a schematic of the whole network drawn as inline SVG from the lines' path geometry projected to (x, z) with uphill at the top, simplified (Douglas-Peucker, ~3 m tolerance) and fitted to the screen with margins; district bands as faint stripes with their names; each discovered line in its livery base colour: un-inked segments as a thin dashed stroke at 35% opacity, inked segments as a thick solid stroke with a one-pixel off-register pink/cobalt shadow; stops as small circles; a "you are here" marker at the skater. Below or beside it a legend: one row per discovered line (badge, name, inked/total segments, a punch mark when complete), tappable to highlight that line on the map and show its stop names. Undiscovered secret lines do not appear at all. A header strip shows overall progress as a percentage and "n / m lines".
`testState()` must include at least: `hudMode` ('free' | 'hitched'), `hudLine` (line id or ''), `hudNextStop`, `chainShown` (number), `toasts` (count currently visible), `lastToast` (kind of the newest: 'inked' | 'complete' | 'discovered' | 'denied' | 'map' | ''), `stopBoard` (stop name or ''), `mapOpen` (boolean), `mapLines` (number of lines drawn), `inkedSegments` (total inked), `mapPercent` (0-100 integer).

## Part 3: wiring in `src/app/main.ts`
Replace the bare `Sim` with a `Game` (the view, debug panel and route scripts still receive `game.sim`). Collect game events alongside sim events and pass both to `ui.update` each frame, then clear. When `ui.paused` is true, do not step the sim in either loop mode: in the rAF loop skip stepping and reset the accumulator; in manual mode `advance(n)` renders a frame without stepping (so the e2e harness can still take screenshots and read state while the map is open). Add the UI's `testState()` as the `ui` field of the hook state. The debug panel (`?debug`) must still work and not overlap the map button.

## Acceptance tests
1. `tests/sim/game.test.ts` (scripted input on the slice via the helpers; use `seekVehicle` and friends):
   - hitching a tram stopped at a stop and holding through to the next stop inks exactly that segment and emits `segmentInked` once;
   - grabbing a tram just after it leaves a stop (within the slack) and riding to the next stop inks the segment; grabbing it mid-segment (well past the slack) and riding to the next stop does not ink that segment, but staying on through the following stop inks the next one;
   - letting go before the stop and re-catching does not ink (coverage must be one unbroken hitch);
   - riding the tram for a full lap (all four segments of the slice tram) completes the line and emits `lineComplete` exactly once; riding both slice lines fully emits `mapComplete` once (you may hold the skater on with continuous `hold: true`; the lines are loops);
   - the loop wrap at the terminus is handled (a hitch that starts before the terminus and continues past it inks the last segment and then the first);
   - a shuttle line inks in both directions (build a small world with `flatWorld`/`testLine({ loop: false, … })`);
   - a `secret` line is undiscovered until first hitched, then emits `lineDiscovered` once, and never counts toward `mapComplete`;
   - `exportProgress`/`importProgress` round-trip and tolerate mismatched data;
   - `Game.step` is deterministic: two games fed the same inputs have equal progress and equal `sim.hash()`.
2. `tests/unit/ui/**` (node environment, pure functions only): clock formatting from `dayFrac`; countdown formatting; next-stop and time-to-arrival computation agree with `vehicleAt` (ride a vehicle forward the returned number of ticks and check it is dwelling at that stop); polyline simplification keeps endpoints and stays within tolerance; map projection fits all lines inside the viewport box with the margin; toast queue caps at 3 and expires.
3. `tests/e2e/routes/slice-map.mjs` (params `slice&t=0.330556`, the clock at which the tram leaves the top stop as the route starts; see `slice-hitch.mjs`): hold to catch the tram at the lookout, stay on until the segment to the next stop is inked (assert via `state.ui.inkedSegments >= 1` and `state.ui.lastToast === 'inked'`), screenshot `hud-hitched` (taken while hitched, before that) and `toast-inked`; release; tap the map button (touch down + up at its centre); assert `state.ui.mapOpen === true`, that the sim tick does not advance across a `wait` while the map is open, `mapLines === 2`, `mapPercent > 0`; screenshot `map`; close it; assert play resumes. Also assert on the way that `hudMode` goes 'free' → 'hitched' with `hudLine === 'T5'` and a non-empty `hudNextStop`.
4. Open every screenshot you produce with the Read tool and iterate until it matches the look: boards read as split-flap destination boards, toasts as ticket stubs, the map as a transit map; nothing overlaps the skater in the lower-middle of the screen; text is legible at 390 px wide. Describe each screenshot in your summary.
5. `npm run gate` is green (typecheck, lint, all tests, build, all e2e routes including the three existing slice routes, perf within budgets).

## Return
A short summary: structure, how inking is tracked, what each screenshot shows, numbers (tests added, UI frame cost if you measured it), deviations from this brief and why, anything you are unsure about. Commands run with pass/fail. List of changed files. No file contents. Commit on your current branch in small commits; do not push or merge.
