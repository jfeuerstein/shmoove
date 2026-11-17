# Brief M6f — time the whole city, and keep chunk builds inside their frame budget

Role: implementer (`.claude/agents/implementer.md`). Run `npm install` first. Commit early and often
(at least every 20 minutes): uncommitted work can vanish without warning.

An independent check of the performance pass (`docs/briefs/m6d-verify-world.md`) found two things
that are not as claimed. Fix both.

## 1. The frame-time gate only ever times the summit

`npm run perf` (`tests/perf/run.mjs`) warms up 2 s and measures 10 s of real time of the `perf`
route (`src/app/routes.ts`), which starts at the summit. Under 4x throttle and software rendering
that is about 8 simulated seconds: the skater moves 11 m across the summit lawn, never hitches, and
draws 22–27 draw calls and 17k triangles. The busy districts (Mercado: 60+ draw calls, 130k+
triangles, rides, stalls) are never timed. The verifier's rough measurement there, on a loaded
machine: work mean 8.6 ms, p95 20.2 ms, world-streaming p95 4.7 ms.

Make the timed run cover the game the player plays:

- Time several windows, one per district at least (Antenna Hill, Terraces, Mercado, Docks), each
  with the skater moving at play speed down the route and at least two of them including a hitch
  and a sling, and one more window that crosses chunk boundaries at speed (streaming under load).
  How you get the skater there is up to you (a `perfStart`/`leg` parameter the route understands,
  or fast-forwarding the sim without drawing before each window), but the measured frames must be
  normal frames of the normal loop.
- Pool the frames of all windows for the gated mean and p95, and also print and store
  (`artifacts/perf.json`) each window's own mean, p95, draw calls, triangles and its per-part
  breakdown, with the district name, so a regression can be placed.
- Assert that the run really went somewhere: each window's skater travelled at least 40 m, the
  windows between them saw all four districts, at least two hitches happened in the timed frames,
  and the pooled run has at least 300 timed frames. A run that fails these is a failed gate with a
  message that says which.
- Keep the whole `npm run perf` under about 4 minutes on this machine.

Then report the honest numbers. The budgets in `tests/perf/budgets.json` (and DESIGN §10) stay as
they are: frame work mean ≤ 10 ms, p95 ≤ 16.6 ms at 4x throttle. If the pooled figures or any
district are over, find out where the time goes with the per-part breakdown and
`tests/perf/profile.mjs`, and fix it in the code you may touch (below). Do not raise a budget, do
not shorten or cheapen the route to pass. If after real effort a district is still over, stop and
report the breakdown.

## 2. Chunk builds overrun the 2 ms a frame they are given

`ChunkJob.run` in `src/render/cityView.ts` always finishes one whole piece (four terrain rows, or
one solid with its dressing, or one rail) before looking at the clock. Seen: a 13.6 ms world part
in one frame at 4x throttle, 7.1 ms for one chunk on desktop. On a phone that is a dropped frame
every time a chunk row streams in.

- Make the pieces small enough that no single piece takes more than about 0.5 ms unthrottled on
  this machine (one terrain row at a time, a solid's dressing split from its walls if it is the
  dressing that is slow, the final `build()` of typed arrays included: measure it, it may be the
  biggest piece; if it is, see whether the chunk can be built as two or three geometries or
  whether `computeBoundingSphere/Box` can be replaced by bounds known from the chunk).
- Add a test in Node (like the existing chunk-build tests in `tests/unit`) that builds every chunk
  of the city piece by piece and asserts the worst piece against a generous absolute bound (so
  machine load cannot fail it: take the best of several runs), and that the geometry produced is
  identical to an uninterrupted build (hash of the attribute arrays).
- After a teleport (race start, respawn far away) chunks 110–120 m out that are in view stay
  missing for about six frames (`cityView.ts` near line 328 builds only the 3×3 at once). Extend
  the immediate build to what the camera can see within the near radius, or justify leaving it.

## Files you own

`tests/perf/**`, `src/app/routes.ts`, `src/render/cityView.ts`, `src/render/worldMesh.ts`,
`src/render/dress/**`, new tests under `tests/unit/`, and the timing/route plumbing in
`src/app/main.ts` and `src/app/testHook.ts` (minimal edits; another agent is editing `main.ts`
for onboarding, so keep your diff there small and local). `docs/DESIGN.md` §10 and
`docs/DECISIONS.md` (append an entry; item 65 describes the route wrongly today: correct it by a
new entry that says what is timed now). Not yours: `src/sim/**`, `src/render/look.ts`,
`camera.ts`, `view.ts`, `src/ui/**`.

## Acceptance

1. `npm run perf` passes with the windows and assertions above; three consecutive runs reported
   with the machine's load average at the start of each.
2. The piecewise chunk-build test passes; worst piece and worst whole frame's world part (4x
   throttle, from the perf data) reported before and after.
3. Every e2e screenshot is unchanged apart from chunks arriving earlier (say how you checked).
4. `npm run gate` green.

## Return

A short summary: the per-district table (mean, p95, draw calls, triangles), pooled figures for
three runs, what was over and what you changed, the chunk piece figures before and after, anything
still expensive and why. Commands run with pass/fail. Changed files. No file contents. Commit on
your current branch; do not push or merge.
