# Briefs

One file per delegated task. A brief is the contract: goal, owned files, interfaces, acceptance,
what to return. The verifier gets the same file.

| Brief | Milestone | Model | Status |
| --- | --- | --- | --- |
| `m0-app-shell.md` | M0 | opus | merged |
| `m1-bowl.md` | M1 | opus | merged |
| `m1-input.md` | M1 | sonnet | merged |
| `m0-pwa.md` | M0 | sonnet | merged |
| `m1-debug-panel.md` | M1 | sonnet | merged |
| `m1-bots.md` | M1 | opus | merged |
| `m1-verifier-fixes.md` | M1 | sonnet | merged |
| `m2-common.md` | M2 | - | shared rules for the four below |
| `m2-horde.md` | M2 | opus | merged |
| `m2-render.md` | M2 | opus | merged |
| `m2-sparks-seekers.md` | M2 | sonnet | merged |
| `m2-hud.md` | M2 | sonnet | merged |
| `m2-balance.md` | M2 | opus | merged (two rounds) |
| `m2-verifier-fixes.md` | M2 | sonnet | merged |
| `m3-common.md` | M3 | - | shared rules for the M3 briefs |
| `m3-weapons.md` | M3 | opus | merged |
| `m3-enemies.md` | M3 | opus | merged |
| `m3-things.md` | M3 | opus | merged |
| `m3-cards-ui.md` | M3 | sonnet | merged |
| `m3-render.md` | M3 | opus | merged |
| `m3-balance.md` | M3 | opus | stopped at the pivot; not merged |
| `m3-lesson.md` | M3 (pulled forward from M6) | sonnet | merged |
| `m3b-weapons-timers.md` | M3, second pass | opus | merged |
| `m3b-balance.md` | M3, second pass | opus | superseded by the M4 balance brief (the run is ten minutes now) |
| `m3b-rails.md` | M3, second pass | opus | merged |
| `m4-run.md` | M4 | opus | merged |
| `m5-audio.md` | M5 (the part a playtest needs) | opus | merged |
| `m5-juice.md` | M5 (the part a playtest needs) | sonnet | merged |
| `m4-balance.md` | M4 | opus | merged; all bands met after the lead's weapon fixes |
| `playtest-verify.md` | before the first full playtest | opus (verifier) | done: works end to end; bosses unseen, no pause |
| `playtest-fixes.md` | before the first full playtest | opus | merged |
| `playtest-report.md` | playtest | sonnet | merged |
| `art-common.md` | art pass | - | shared rules for the four below |
| `art-figures.md` | art pass | opus | merged |
| `art-weapons.md` | art pass | opus | merged |
| `art-park.md` | art pass | opus | merged |
| `art-icons.md` | art pass | opus | merged |
| `clear-objectives.md` | after the first full playtest | opus | merged |
| `refit-balance.md` | after the first full playtest | opus | merged |
| `clear-picture.md` | after the first full playtest | opus | merged |
| `objectives-shown.md` | after the owner's second note on objectives | opus | out |

Verification: one opus verifier checked the five merged M0/M1 briefs together; its findings became
`m1-verifier-fixes.md`. A second checked the four M2 briefs and the lead's M2 core; the core's
bugs were fixed by the lead and the rest became `m2-verifier-fixes.md`.

Common to every brief:

- Read `CLAUDE.md` first. Work only in the files the brief says you own. If you need a change
  anywhere else, stop and report it.
- You start in a fresh git worktree. Run `npm ci` once. Commit on the branch you were started on, in
  small commits that say why. Do not push or merge.
- Lead-owned, never edited: `src/sim/{types,terrain,constants,mover,flow,sim,math,rng}.ts`,
  `src/render/{camera,look}.ts`, `src/input/source.ts`, `package.json`, the config files.
- No new dependencies. No asset files. No placeholders, TODOs or stubs. No `any`.
- For tooling mechanics only (how a runner starts a server, captures console errors, throttles the
  CPU), you may read the pre-restart versions with `git show 63fa105:<path>` (for example
  `tests/e2e/run.mjs`, `tests/perf/run.mjs`). That was a different game: take mechanics, not content,
  and leave no trace of its names.
- Return: a short summary (what was built, decisions made, anything cut or uncertain), the commands
  you ran with pass/fail, and the list of changed files. Never file contents.
