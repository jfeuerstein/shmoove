# Shmoove

Climb the spire. Outrun the tide.

A portrait, two-thumb 3D platformer for phones. The spire is generated fresh each run. A tide rises under you and speeds up. Every 30 m there is a rest pad where you pick one of three upgrades, so the moveset you finish with is different every run.

## Play

Open `index.html` from any static host. There is no build step. Pushing to the default branch deploys the site to GitHub Pages through `.github/workflows/pages.yml`.

On a phone, use Add to Home Screen to get it full-screen.

- **Left thumb** runs. The camera always faces the spire, so right is along the path and up is toward the wall.
- **Right thumb** jumps. Anywhere on the right half of the screen counts. Hold for height.
- **Push into a ledge** to pull yourself up.
- **Jump into a wall, then jump again** to kick off it. Orange fins are wall-kick chimneys that skip a whole lap.
- **Green pads** are springs. **Yellow shards** hold the tide still for a moment.
- Dive and Crouch buttons appear when you pick a move that needs them.

Keyboard, for testing on a desktop: WASD or arrows, Space to jump, J or Shift to dive, K or C to crouch, P to pause.

## How it is put together

| File | What it does |
| --- | --- |
| `js/sim.js` | The character controller: a kinematic, fixed-step (120 Hz) state machine with no dependencies. Run, variable jump, coyote time, jump buffer, edge pop, ledge grab and vault, wall slide and kick, slide, long jump, high jump, triple jump, air jump, dive, stomp bounce, glide, springs. |
| `js/world.js` | The spire generator. One side of the square core at a time: ledges, small pads, tall steps, springs, shard islands, wall-kick chimneys, and a rest pad every 30 m. Seeded and deterministic. |
| `js/game.js` | Rendering (three.js), the orbiting camera, touch and keyboard input, the tide, upgrades, HUD and sound. |
| `vendor/three.min.js` | three.js r128, vendored so the game has no network dependency beyond the web font. |
| `sw.js` | Not a cache. It removes the service worker and caches left by the game that used to live at this address. |

Every generated side is climbable with the starting kit (run, jump, ledge grab, wall kick). Upgrades and chimneys are faster lines, never requirements.

## Tuning

- Controller numbers live in `DEFAULT_T` in `js/sim.js`.
- Tide speed is `tideSpeed()` in `js/game.js`. Each shard holds the tide for 0.3 s.
- Upgrades are the `UPS` table at the top of `js/game.js`.
- Generation knobs (gap, rise and ledge-length ranges, how often each feature appears) are in `genSide()` in `js/world.js`.

## Checks

`tests/` holds Node scripts that drive the controller without a browser:

```
node tests/bot.js 200 240   # a path-only climber on 200 seeds, to 240 m, starting kit only
node tests/chim.js          # wall-kick climbs of generated chimneys
node tests/tide.js          # where the tide catches climbers of different speeds
```
