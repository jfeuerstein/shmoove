# M5: sound

Model: opus. Read `docs/PITCH.md`, `docs/briefs/README.md`, `docs/briefs/m2-common.md`, then
`src/app/main.ts` (where effects are handed to the views once per tick), `src/sim/world.ts` (the
`FX_*` types and what `a` carries), `src/sim/types.ts` (the `EV_*` flags and the mover's state),
`src/app/settings.ts`, `src/ui/debugPanel.ts`, `src/ui/howTo.ts`, `src/app/params.ts`.

## Goal

The game has no sound at all. Give it a soundtrack that follows how fast you are going and a
sound for everything that happens, all made in code (no audio files), so that with eyes shut you
could tell an ollie from a landing, a hit from a kill, and gear 1 from gear 5.

## You own

Everything under `src/audio/`; `tests/unit/audio*.test.ts`; `tests/e2e/routes/audio.mjs`. In
`src/app/settings.ts` (+ test): `mute` and a music volume. In `src/app/params.ts` (+ test):
`mute`. In `src/ui/debugPanel.ts`: a mute switch and a volume slider at the top. In
`src/ui/howTo.ts` (+ CSS, test): a `SOUND ON / OFF` button on the sheet. In `src/app/main.ts`:
creating the audio, handing it each tick's effects and the mover's state, and unlocking it.

## What to build

**The engine.** One `AudioContext`, created and resumed on the first touch (browsers refuse
sound before a gesture; iOS Safari especially), suspended when the page is hidden. A master gain,
a music bus and an effects bus, a soft limiter on the master. A cap of 24 voices; the oldest of
the same kind is cut first. Nothing may throw or log if audio is unavailable.

**Music.** A funk loop in five stems, generated: drums, bass, keys, guitar, horns; about 104 bpm,
a four-bar pattern with a variation every fourth time round, in one key. A scheduler with a short
lookahead queues notes ahead of the audio clock. How many stems sound follows the mover's speed
tier (`mover.gear` 1 to 5: drums only, then bass, keys, guitar, horns), each stem fading in and
out over half a bar so a tier change is never a click. While a card offer is open the music ducks
to a low-passed murmur; when a boss arrives the key drops a fourth until it falls. Keep the
pattern, the choice of stems and the scheduling in pure functions (given a bar, a gear and a
seed: these notes at these times) and test those.

**Effects**, synthesised, from each tick's `w.fx` and the mover's events:

| From | Sound |
| --- | --- |
| `EV_HOP` | a short pop |
| `EV_CLEAN_HOP` | the same, one step higher up a scale for each ollie in the chain |
| `EV_LAND` | a thud, louder with `mover.impact` |
| `EV_GRIND_START` / grinding / `EV_GRIND_END` | a metallic hiss that lasts as long as the grind |
| `EV_BOOST` | a rising whoosh |
| rolling | a quiet board hum whose pitch follows speed, silent in the air |
| `FX_PLAYER_HIT` | a hard low hit; the music drops out for a beat |
| `FX_ENEMY_HIT`, `FX_ENEMY_DIE` | a tick and a crunch, rate-limited so 100 a second is a texture and not a wall |
| `FX_SPARK` | a chime, rising with each one taken within a second |
| `FX_LEVEL_UP`, `FX_CARD` | a rising figure in key; a confirm |
| `FX_SHOT`, `FX_STONE`, `FX_ARC`, `FX_SLAM`, `FX_BLAST`, `FX_POP` | each its own short voice, quiet (they fire constantly) |
| `FX_THING`, `FX_TOKEN`, `FX_HEAL` | a pickup, a coin, a soft swell |
| `FX_BOSS_IN`, `FX_BOSS_DOWN` | a stinger each |
| run ends (dead / cleared) | the music stops on a fall / resolves on a cadence |

Keep "which sound, how loud, at what pitch, or none because of the rate limit" a pure function of
the effects and state, and test that.

**Settings.** Mute (also `?mute`) and music volume persist. Muted means nothing is scheduled.

## Acceptance

1. `npm run gate` is green; every existing e2e route still passes with no console errors or
   warnings (headless Chromium has an `AudioContext`; nothing may warn before the first gesture).
2. Unit tests: the pattern (deterministic, four bars, the variation, in key); stems by gear and
   the fades; the scheduler (given a clock that advances in steps, every note is queued once, in
   order, never late, never twice); the effects mapping for each row above, including both rate
   limits and the rising chime and ollie scale; mute schedules nothing.
3. `tests/e2e/routes/audio.mjs` with `?hook&nolesson`: after a real touch the context is running;
   stepping through a hop, a landing and a kill schedules sounds (expose a small counter on the
   test hook for this, not the audio graph); with `?mute` nothing is scheduled; hiding the page
   suspends it.
4. No allocation per tick in the effects mapping; node creation only when a sound actually plays.
5. In your report, describe the soundtrack in words (what each stem plays) and list anything you
   could not make sound right without hearing it. Nobody on this task can hear the result: say
   so, and say what the owner should listen for first.
