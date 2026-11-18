# Briefs

The exact brief each Opus subagent was given, one file per task, as sent. Kept so the delegation can
be audited and so a task can be re-run from its brief if a session is interrupted. Implementers
build to a brief; verifiers check a result against its brief with fresh context and report without
repairing. Numbers in the outcomes refer to `docs/DECISIONS.md`.

| Brief | Role | Task | Outcome |
| --- | --- | --- | --- |
| [m0-scaffold](m0-scaffold.md) | implementer | Vite + strict TypeScript, ESLint with the sim purity rules, Vitest, the Playwright e2e and perf harnesses, `npm run gate` | Done (M0) |
| [m1-verify](m1-verify.md) | verifier | Check the feel slice against DESIGN and PLAN M1 | 11 source mutations, all caught; four defects found and fixed, two feel literals left for later (19, since resolved) |
| [m2-citygen](m2-citygen.md) | implementer | Generate Santa Rampa as sim data: four districts, routes, stops, zones | Merged (b1e349a); decisions 33–37 |
| [m2-cityview](m2-cityview.md) | implementer | Draw the city: streaming chunks, dressing for every kind, sea, the proptown fixture | Merged (8c7618e) |
| [m2-cityfix](m2-cityfix.md) | implementer | Fix what the verifier and the lead found in the city; tighten the tests that let it through | Merged (505a93c): rolling spawn, falling landings, crowned summit, tighter Mercado, east docks loop |
| [m3a-lines](m3a-lines.md) | implementer | Ride data on the city: 16 lines, lanes, stops, hours, meetings, the climb and the summit route | Merged (3ae80b3); decisions 43–49 |
| [m3b-game-ui](m3b-game-ui.md) | implementer | The game layer (line-map progress) and the print-style UI: HUD, stop board, line map, toasts | Merged (d5f6c10); decisions 21–24 |
| [m3c-vehicles](m3c-vehicles.md) | implementer | Vehicles for every ride kind, pattern liveries, the line-up world | Merged (40d5f0e) |
| [m3-retune](m3-retune.md) | implementer | Reconcile the city fixes with the ride data; tram 5 every two minutes | Merged (5b69ec1); decisions 55–59 |
| [m4-audio](m4-audio.md) | implementer | Four district tracks in four stems, the stem mixer, transport and Web Audio engine | Merged (96a190e) |
| [m4-audio-verify](m4-audio-verify.md) | verifier | Check the audio by measurement | Passed with follow-ups: lighter compressor, two mixer tests, lead register (a3cf401). Nobody has heard it: PLAYTEST |
| [m5a-chalk-saves](m5a-chalk-saves.md) | implementer | Chalk lines (record, share code, ghost race) and saves | Merged (fa06161); decisions 25–30, 32 |
| [m5a-fix-chalk-packing](m5a-fix-chalk-packing.md) | implementer | A denser share code, missing chalk tests, a cheaper save backup | Merged (e3cb995): `SK2-` arithmetic-coded codes, 63 steer levels (31) |
| [m5b-things-to-do](m5b-things-to-do.md) | implementer | Errands, conductor challenges, secrets, the ledger and world markers | Merged (681b779); decisions 50–54 |
| [m6a-shell](m6a-shell.md) | implementer | PWA, title, pause, settings, haptics, map-complete, README | Merged (96acc42); decisions 38–42; the verifier's stale-cache fix (49) |
| [m6b-onboarding](m6b-onboarding.md) | implementer | A first launch that teaches by play | Merged; decisions 71–76. Its independent check found clumsy players never caught a ride, which led to the planted foot (77) and M6g |
| [m6c1-followups](m6c1-followups.md) | implementer | Close verifier findings across audio, shell, errands and feel constants | Merged (8eafb6e); the last feel literals moved into `FEEL` |
| [m6c2-perf](m6c2-perf.md) | implementer | The performance pass | Merged (071eeb8); decisions 65–68. 65 was later found to time only the summit lawn (83) |
| [m6d-verify-world](m6d-verify-world.md) | verifier | Check the drawn city, the vehicles, the city fixes and the perf pass | Haze and night fixed (69, 70); found the perf gate's narrow coverage and chunk-build overruns, which became M6f |
| [m6e-full-game](m6e-full-game.md) | implementer | First launch to a completed line map by a scripted skater, with save/load | Merged; decisions 79–82. Found the blimp could not be completed (79, fixed in M6h) |
| [m6f-perf-honesty](m6f-perf-honesty.md) | implementer | Time the whole city; keep chunk builds inside their frame budget | Merged; decisions 83–87 |
| [m6g-onboarding-fixes](m6g-onboarding-fixes.md) | implementer | A first minute that clumsy players get through | Merged; decisions 88–93: player bots complete 30/30 for each profile |
| [m6h-secrets-finishable](m6h-secrets-finishable.md) | implementer | Secrets a player can finish, rides that set you down, saves that keep the day | Merged; decisions 94–99 |
| [m6i-verify-final](m6i-verify-final.md) | verifier | Check the onboarding fixes, finishable secrets, the planted foot and the camera | Running alongside M6j; its report goes to the lead and is not in this tree |
| [m6j-final-docs-audit](m6j-final-docs-audit.md) | implementer | Documents that match the code, two small defects, the ship audit | This task; decisions 102–105 |

## Re-finding the scripted runs

Everything the city tests replay open-loop (release ticks, touch scripts, clocks, starts) was found
by search in the deterministic sim, and each search stays in the repository. When the controller,
the city or the timetable changes and one of those tests fails, run its command, paste what it
prints where it says, and run the test again (M7a, DECISIONS 126). Searches that run with their
test every time need no command: the meeting chains (`tests/sim/cityLines.test.ts`) and the kite
spool's release (`tests/sim/content.test.ts`).

| What | Command | Paste into |
| --- | --- | --- |
| The ground lines' lanes, dwells and phases: no two bodies overlap, every meeting holds | `SKITCH_FIND_TIMETABLE=1 npx vitest run tests/sim/findTimetable.test.ts --silent=false` (`=report` lists the overlaps) | `CITY_LINES` in `src/sim/city/lines.ts` |
| The summit chain (lower cable car, summit car, kite, king kite) | `SKITCH_FIND_SUMMIT=1 npx vitest run tests/sim/findRoutes.test.ts --silent=false` | `SUMMIT.keys` in `tests/sim/citySummit.test.ts` and `tests/sim/bot/secrets.ts` |
| The new-game clock | `SKITCH_FIND_CLOCK=1 npx vitest run tests/sim/onboarding.test.ts -t 'new-game clock' --silent=false` | `NEW_GAME_DAY_FRAC` in `src/app/newGame.ts`, and the clock check in `tests/e2e/routes/city-first-launch.mjs` |
| The first-launch touch script | `SKITCH_PRINT_ROUTE=1 npx vitest run tests/sim/onboarding.test.ts -t 'real gesture' --silent=false` (`SKITCH_LAUNCH_TRACE=1` adds positions to the bots' logs) | `TOUCHES` in `tests/e2e/routes/city-first-launch.mjs` |
| The perfcity legs | `SKITCH_FIND_PERF=1 npx vitest run tests/unit/perfRoute.test.ts --silent=false` | `PERF_LEGS` in `src/app/routes.ts` |
| The stop-to-stop conductor limits (1.3x the bot) | `SKITCH_FIND_CONDUCTORS=1 npx vitest run tests/sim/content.test.ts -t 'stop-to-stop limits' --silent=false` | `src/sim/game/content/conductors.ts` |
| The feel slice's grind and map routes | `SKITCH_FIND_SLICE=1 npx vitest run tests/sim/sliceRoutes.test.ts --silent=false` | `GRIND`/`MAP` in that test and `tests/e2e/routes/slice-grind.mjs`, `slice-map.mjs` |
| First-launch player bots (report, trace one) | `SKITCH_PLAYERS_REPORT=1` or `SKITCH_PLAYERS_TRACE=profile:seed` with `npx vitest run tests/sim/onboardingPlayers.test.ts --silent=false` | (diagnostic) |

The full-game bot's plan (`tests/sim/bot/plan.ts`) is a closed-loop itinerary, not a search: when
it fails, its failure names the task, tick and place, and the plan is edited by hand.
