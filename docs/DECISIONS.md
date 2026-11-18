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
7. **Slopes pay in full only when tucked.** First version: carving downhill gained speed like a
   tuck and only bled it a little faster. Bots showed that made the stick an engine (run up any
   slope, carve down at 18 m/s and more, gear 4 without ever letting go). Now, above run speed, a
   downhill pays only a share (`carveSlopeGain`, 0.2) while the thumb is down. Holding the stick
   stays in gears 1 to 3; letting go is how you get paid.
8. **Camera sits closer and steeper than a third-person game's.** The mover is about two thirds
   down the screen (above the thumb), the horizon is just under the HUD, and the ground fills the
   rest. A flatter chase camera spent 40% of a portrait screen on sky.
9. **Tuned feel values are applied on every boot**, not only with `?debug`, so a tuning session
   carries over to plain play on the same phone. "Reset all" in the panel clears them.
10. **A `?flat` world exists for tests** that need level ground (run speed, the debug panel's
   slider check). The game itself always uses the bowl.
11. **A clean hop skips the landing scrub and adds a bonus; it does not give back what touchdown
   took.** The first version restored the pre-landing speed, which created speed on banked
   landings and let hop chains round the rim pass the speed limit.
12. **The spawn has to lead somewhere.** The generator rejects a layout whose fall line from the
   spawn drops less than 5 m before levelling out, so a player who lets go at the start gets a
   ride. The check is geometric so the map for a seed never depends on a feel constant.
13. **A two-finger tap in the tuck scheme asks for two hops.** The second is buffered and expires
   in the air, so nothing happens. Left as is.
14. **M0 is tagged with its gate green but its last step open.** "The owner opens the link on the
   phone" cannot happen until a repository setting allows this branch to deploy to Pages.
