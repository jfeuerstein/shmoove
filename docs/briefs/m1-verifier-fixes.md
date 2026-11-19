# M1: fixes from the verification pass

Model: sonnet. Read `docs/briefs/README.md` for the common rules. For this task the ownership rule
is: you may edit exactly the files named in each item below, and only for that item.

## Goal

An independent verifier checked the five merged M0/M1 tasks. The behaviour was mostly right; these
are the gaps it found. Close each one. Every fix that changes behaviour gets a test that fails
without it.

## Items

1. **`src/app/main.ts`**: `registerPwa()` is the last line of `boot()`, so anything that throws
   earlier (no WebGL, a bad seed) leaves a player with no way to receive a fixed version. Call it
   first, before anything that can throw.
2. **`tests/perf/run.mjs`**: the run is a fixed 10 s and requires 120 frames; headless software
   rendering draws 100 to 120 depending on machine load, so the gate flakes. Run until at least 130
   frames have been drawn and at least 300 ticks have passed, with a 45 s cap (failing clearly if
   the cap is hit), instead of a fixed time. Keep the distance check. Budgets are unchanged.
3. **`src/input/touch.ts`** (+ `tests/unit/gestures.test.ts` or a new `tests/unit/touch.test.ts`):
   there is no `lostpointercapture` handler; if a `pointerup` is lost the stick stays stuck at full
   deflection. Handle `lostpointercapture` like a pointer up for that id, without double-counting
   when the normal `pointerup` also arrives (in the `lift` scheme that must not hop twice).
4. **`tests/e2e/routes/debug.mjs`**: the "touching the panel does not reach the game" check cannot
   fail, because the loop is paused and the stick view only updates on a drawn frame. Tap the panel
   with touch, advance with `hook.step(1)`, then assert that no hop happened and the stick view is
   hidden. Also add: a real touch drag on the open sheet scrolls it (`scrollTop` changes).
5. **`tests/sim/bowl-ride.test.ts`**: the `r <= radius` assertions are guaranteed by the mover's
   clamp. In the rim test, track the furthest radius each mover reaches and assert it stays below
   `BOWL_RADIUS - 5` (it turns around on the bank, it is not stopped by the clamp). In the random
   ride, keep the finite-number check and assert the same margin is never touched for more than a
   few ticks, or drop the radius assertion and say why in a comment.
6. **`tests/unit/gestures.test.ts`**: the "no allocation" test cannot detect allocation: rename it
   to what it does check. Add the missing cases: the thumb lifting while a second finger is still
   down (idle frame; that finger's later moves and lift are ignored); `cancelAll` while a touch is
   undecided followed by a late `up` (no hop in `tuck` or `lift`); a pointer id reused after its
   touch ended.
7. **`tests/unit/hud.test.ts`** (new): a `Hud` given a minimal fake element tree writes text only
   when a shown value changes (count writes across repeated updates with the same state, then with
   one changed value). If `Hud` cannot be built without a real DOM, give it the smallest seam that
   allows it in `src/ui/hud.ts`.
8. **`src/app/platform.ts`**: `selectstart` and `contextmenu` are blocked on the whole document, so
   the debug panel's fallback copy box cannot be selected by hand. Do not block them when the
   event target is a `textarea` or `input`.
9. **`src/ui/debugPanel.ts`**: `refreshBadges` rewrites badge text every frame while open. Write
   only when the count changes.
10. **`src/ui/stickView.ts`**: two style writes every frame while touching even when nothing moved.
    Cache the last values and skip.
11. **`scripts/make-sw.mjs`**: on activate, delete every cache other than the current one, not only
    those with the `shmoove-` prefix (the site's origin held another app's caches before the
    restart). Extend `tests/e2e/pwa.mjs` to seed a foreign cache and assert it is gone after
    activation.
12. **`.github/workflows/pages.yml`**: set `cancel-in-progress: false` for the deploy; add a header
    comment saying what the repository needs for the deploy to run (Settings, Pages, source
    "GitHub Actions"; and Settings, Environments, `github-pages`, deployment branches must include
    the branch being pushed, because by default only the default branch may deploy).

## Acceptance

1. `npm run gate` is green, three times in a row (the perf stage must no longer depend on load).
2. Each of items 3, 4, 5, 6, 7, 11 has a test that you have seen fail against the old behaviour
   (say how you checked).
3. No change outside the files the items name.
