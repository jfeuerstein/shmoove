# Decisions

Things decided without the owner, newest last. Overrule any of them.

1. **Toolchain reused from before the restart.** `package.json`, the TypeScript / ESLint / Vite /
   Vitest configs, `scripts/gate.mjs`, and the deterministic maths and RNG (`src/sim/math.ts`,
   `src/sim/rng.ts`) are the generic files from the old repo, renamed. Nothing game-specific came
   with them. It saved a day of setup and they were already proven.
2. **The stick is read against a view the sim owns.** `SimState.viewYaw` follows the direction of
   travel with a lag; the stick is relative to it and the camera sits behind it. Putting it in the
   sim keeps input deterministic (bots, replays, the daily seed) instead of depending on a
   render-side camera.
3. **Pulling the stick back is one U-turn, not a spin.** Because the view swings round with the
   turn, a stick held back would otherwise spin the mover for as long as it was held. The direction
   is fixed when the stick goes back and released when it comes forward.
4. **No left-handed mirror in the input.** The stick floats to wherever the thumb lands, so there is
   nothing to mirror. Handedness will matter for HUD and card layout (M3), not for input.
5. **Landing costs speed only in proportion to the impact.** The pitch says a hop that is not clean
   loses speed. As built, the loss scales with how hard you hit the ground, so landing on a slope
   that matches your fall costs almost nothing even without a hop. It rewards reading the terrain
   as well as timing.
6. **Models by task.** Lead (Fable): contracts, the mover, gears, camera, palette, integration.
   Opus: the app shell, the bowl generator, bots, verification. Sonnet: touch input, the PWA shell
   and deploy, the debug panel.
7. **Carving downhill still gains speed.** "The stick only reaches gear 2" holds on level ground.
   On a slope the fall line pulls whether you carve or tuck; carving only bleeds the excess faster.
   Holding forward from the spawn ramp reaches gear 4 for a moment. Making carve cancel gravity
   would feel like glue.
8. **Camera sits closer and steeper than a third-person game's.** The mover is about two thirds
   down the screen (above the thumb), the horizon is just under the HUD, and the ground fills the
   rest. A flatter chase camera spent 40% of a portrait screen on sky.
9. **Tuned feel values are applied on every boot**, not only with `?debug`, so a tuning session
   carries over to plain play on the same phone. "Reset all" in the panel clears them.
10. **A `?flat` world exists for tests** that need level ground (run speed, the debug panel's
   slider check). The game itself always uses the bowl.
