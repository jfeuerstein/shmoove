# Shmoove

Portrait mobile 3D platformer. Static site, no build step, no package manager. Open `index.html`.

## Layout

- `index.html` holds all markup and CSS. Scripts load in order: `vendor/three.min.js`, `js/sim.js`, `js/world.js`, `js/game.js`.
- `js/sim.js` is the character controller. Pure logic, no DOM, runs in Node. `Sim.step(player, world, cfg, input, dt)` advances one fixed step. `cfg.m` switches moves on and off, `cfg.t` holds tuning numbers.
- `js/world.js` generates the spire. `World.Tower(seed)` returns `{ solids, sides, gen(untilY), cull(belowY), start() }`. Solids are axis-aligned boxes `{x0,x1,z0,z1,y0,y1,c}`.
- `js/game.js` is everything the player sees and touches.
- `tests/` has Node scripts. Run them after touching `sim.js` or `world.js`.
- `sw.js` only exists to remove the previous game's service worker. Do not turn it into a cache without changing its name.
- `.github/workflows/pages.yml` copies the static files to GitHub Pages on a push to the default branch. A new top-level file the game loads must be added to its `cp` line.

## Rules for changes

- Units are metres and seconds. y is up. The player position is the feet.
- The generator must stay climbable with the starting kit: run, jump, ledge grab, wall kick. `node tests/bot.js 200 240` must report `fails 0`.
- Keep a clear 5 m of headroom over any ledge the path uses. The lap above is at least 9.6 m higher by construction (minimum 2.4 m rise per side).
- A tall step must be a solid block down to the lower ledge, or the player walks under it.
- The controller is fixed-step. Never scale `dt` inside `Sim.step`; call it more or fewer times.
- No new buttons without a strong reason. New verbs come from state plus an existing button.
- Touch first. Anything added to the HUD must respect the safe-area insets and stay out of the bottom third, where the thumbs are.
