You are the implementer for task M5A-FIX on SKITCH: a denser chalk share code, the tests a verifier found missing, and a cheaper save backup. Read `.claude/agents/implementer.md` (your rules), `CLAUDE.md`, `docs/briefs/m5a-chalk-saves.md` (the original contract), `docs/DECISIONS.md` items 25–32, then `src/sim/game/chalk.ts`, `src/sim/game/game.ts`, `src/sim/game/save.ts`, `src/app/save.ts`, `tests/sim/chalk.test.ts`, `tests/sim/save.test.ts`, `src/input/gestures.ts`. Run `npm install` first. Commit after each part; uncommitted work can be lost without warning.

## Why
An independent verifier measured share codes with realistic thumb input (the real `Gestures` class driven by a finger dragging sinusoidally at 0.3–1.5 Hz with ±1.5 px jitter, flicks, holds and lifts): about 6.5 kB for 30 s, 25 kB for 2 minutes and 52 kB for 4 minutes with the current run-length format, because a moving thumb changes steer every tick. That is too long to paste anywhere. Everything else about chalk lines passed (exact replay on 66 660 compared ticks, 40 000 fuzzed codes rejected safely).

## Files you own
`src/sim/game/chalk.ts`, the steer quantisation in `src/sim/game/game.ts`, `src/app/save.ts`, `tests/sim/chalk.test.ts`, `tests/sim/save.test.ts`, and `docs/DECISIONS.md` item 31 (rewrite it with the new format and measured sizes). Nothing else. No other behaviour of chalk lines, racing or saves may change.

## Part 1: 63 steer levels
`Game.step` quantises steer to 63 levels instead of 255: `steerQ = round(clamp(steer, -1, 1) * 31)`, the sim gets `steerQ / 31`. Always, recording or not (DECISIONS 25). Update the quantisation test (values either side of a level boundary; the quantised value is within 1/62 of the input). Sim tests that go through `Game` may change numerically; tests that assert behaviour must still pass without being loosened. If one fails, find out why before touching it.

## Part 2: share code version 2
Keep the envelope (prefix, base64url, name, start tick, exact float64 start, float32 end, ticks, CRC-32 over everything before it, one canonical spelling so any single-character change is an error). Change the prefix to `SK2-` and the version byte to 2; version 1 codes are rejected with `unknown version` (none exist outside tests). Replace the input section with a lossless packing of the per-tick frames (steer level −31..31, hold bit, hop bit):
- steer as deltas from the previous tick's level (first tick from 0), coded with an adaptive binary range coder or adaptive arithmetic coder you write by hand in the sim layer (integer arithmetic only, no floats in the coder state; deterministic on every engine). Model the delta with a small context (for example the previous delta, clamped to a few classes) so smooth drags, long constant runs and the common delta of 0 all code cheaply.
- hold and hop as change positions: hold toggles and hop ticks are rare, so code "ticks until the next toggle" and "ticks until the next hop" rather than a bit per tick (through the same coder, or as variable-length integers; your choice by measured size).
- The in-memory `ChalkLine` may keep whatever representation is convenient for stepping the ghost (decoded frames are fine); only the code and the saved form need to be dense. Recording must still not allocate per tick.
- Decoding must be bounded and safe on hostile input: never throw, never loop without bound, never allocate more than a 4-minute route needs, reject trailing data and any stream that does not decode to exactly `ticks` frames.
Target sizes, measured with realistic input (write the generator in the test: the real `Gestures` class fed a simulated finger as described above, three seeds, through `Game`): at most 1.3 kB for 30 s, 4.5 kB for 2 minutes, 9 kB for 4 minutes, as code characters. Assert those bounds in a test, and assert steady steering (steer changing about every half second) stays under 0.5 kB for 30 s. Report what you measure.
Saves store lines as their codes, so saves shrink too; saved data with `SK1-` codes must be dropped cleanly on import (that line is skipped, others kept; no throw).

## Part 3: tests the verifier found missing (each must fail if the rule is removed; check by mutating the source and restoring it)
- A bail in water aborts a recording: `chalkRecordDiscard` with the water reason and no line added.
- The loop rule (DECISIONS 28): racing a line whose finish is within the finish radius of its start does not finish until the player has left the zone and come back.
- The open-ground rule (DECISIONS 29): `chalkCannotRecord()` gives its reason under an awning or roof and recording does not start there.
- The win boundary: finishing in exactly the line's `ticks` is a win; one tick more is a loss.
Re-run the existing exactness tests after the format change: record → encode → decode → race must still give identical player and ghost states on every tick and equal final hashes, for routes that hitch.

## Part 4: cheaper backup
`src/app/save.ts` re-parses the previous save and re-encodes every line on each autosave. Keep the last string written (and the last known-good string read at boot) in memory and write that as the backup instead of reading storage back. Behaviour otherwise unchanged; all storage access stays in try/catch.

## Acceptance
`npm run typecheck`, `npm run lint`, `npm test` pass; `npm run build && node tests/e2e/run.mjs slice-chalk` and `slice-chalk-void` pass (the void route's corrupted code must be regenerated for the new format; the share screenshot should show a shorter code). Fuzz the new decoder yourself with at least 20 000 random strings and 20 000 one- and two-character mutations of real codes (a test with a fixed seed): zero lines returned for mutated codes, zero throws, and it finishes in a few seconds.

## Return
The size table (30 s / 2 min / 4 min realistic, 30 s steady) before and after, how the coder works in three sentences, which sim tests changed numerically and why, the four mutations and that each new test caught its one. Commands run with pass/fail. Changed files. No file contents. Commit on your current branch; do not push or merge.
