# M5: the hits land

Model: sonnet. Read `docs/PITCH.md`, `docs/briefs/README.md`, `docs/briefs/m2-common.md`, then
`src/app/main.ts`, `src/app/loop.ts` (`FixedStepper.scale`, `TimeRamp`), `src/render/camera.ts`
(read only), `src/render/scene.ts`, `src/sim/world.ts` (`FX_*`), `src/sim/types.ts` (`EV_*`),
`src/app/settings.ts`, `src/ui/debugPanel.ts`, `src/ui/threat.ts`.

## Goal

When something big happens the player feels it without reading anything: the frame jolts, time
catches for an instant, the phone buzzes. And a player who does not want any of that can turn it
off.

## You own

New `src/render/shake.ts`, `src/app/hitstop.ts`, `src/app/haptics.ts`, `src/ui/lowHealth.ts`
(+ CSS), `tests/unit/shake.test.ts`, `tests/unit/hitstop.test.ts`, `tests/unit/haptics.test.ts`,
`tests/unit/lowHealth.test.ts`. In `src/app/settings.ts` (+ test): `haptics` and
`reducedMotion`. In `src/ui/debugPanel.ts`: switches for both. In `src/app/main.ts`: wiring. Do
not edit `src/render/camera.ts`: apply the shake to the camera after `ChaseCamera.update`.

## What to build

**Shake** (`shake.ts`). A trauma value from 0 to 1 that decays over about 0.4 s; the camera is
offset and rolled by a smooth noise scaled by trauma squared (a few centimetres and a degree or
two at most, so it is a jolt and never a blur). Trauma is added by: `FX_PLAYER_HIT` (large),
`FX_BONK` (medium), `FX_SLAM` and `FX_BLAST` near the mover (small, falling off with distance),
`FX_BOSS_IN` and `FX_BOSS_DOWN` (large), a hard landing (`EV_LAND` with a large `impact`: small).
Deterministic noise from a counter, no `Math.random`.

**Hit-stop** (`hitstop.ts`). On `FX_PLAYER_HIT` the game runs at 0.05 speed for 70 ms; on
`FX_BOSS_DOWN` for 250 ms; then back to what it was. It multiplies the stepper's scale and must
compose with the ramp that follows a card (neither cancels the other). Pure logic with real time
passed in; tested.

**Haptics** (`haptics.ts`). `navigator.vibrate` where it exists (Android; iOS has none: fail
silently): a short buzz on a hit, a tick on a clean ollie, a double on a level, a long one on a
boss arriving and falling. Rate-limited to one call per 50 ms. A pure function from effects to
the pattern asked for, tested with a fake `vibrate`.

**Low health** (`lowHealth.ts`). Under 30% health the screen's edges pulse red slowly, faster as
it falls; gone the moment health is back above. Drawn over the threat glow without hiding it.

**Settings.** `haptics` (on by default) and `reducedMotion` (off by default; on at first run if
the browser reports `prefers-reduced-motion`). Reduced motion turns off shake and hit-stop and
makes the low-health pulse a steady tint.

## Acceptance

1. `npm run gate` is green.
2. Unit tests: trauma adds and decays, the offset is bounded and zero at zero trauma, the same
   inputs give the same shake; hit-stop's durations, its return to the previous scale, and its
   composing with a card ramp in both orders; the haptic pattern for each effect, the rate limit,
   and silence when the setting is off or `vibrate` is missing; the low-health pulse's
   thresholds and its reduced-motion form; reduced motion disables shake and hit-stop.
3. Nothing allocates per frame in shake or hit-stop.
4. The existing e2e routes pass unchanged (a route that hurts the player must not time out
   because of hit-stop).
