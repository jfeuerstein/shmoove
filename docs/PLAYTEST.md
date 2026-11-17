# Playtest list

What only a human thumb can judge, and the constant in `src/sim/constants.ts` (`FEEL`) that controls
it. Open the game with `?debug` to tune every one of these live; `COPY` exports the changed values.
Automated tests only prove the mechanics work; they cannot say whether they feel good.

## Play these first

1. **The whip.** Hitch the tram, carve hard to one side, crack back and let go mid-swing. Does the
   release feel like a throw? Too violent or too weak → `SWING_OMEGA_MAX` (caps the whip),
   `SWING_STEER` (how hard a carve drives the swing), `SLING_GAIN`, `SLING_POP`.
2. **Release timing.** Hang on without steering and release at different points of the swing. Can you
   predict the exit angle from the aim arrow? Swing too slow or fast to time → `SWING_FREQ`; swing too
   small to matter → `SWING_MIN_AMP`, `SWING_PUMP`.
3. **Catching a ride.** Press and hold beside a passing tram. Does the grab happen when you expect?
   Reach too stingy or too generous → `HITCH_REACH`, `HITCH_REACH_Y`, `HITCH_AHEAD`. Does the catch
   yank or glide → `YANK_TIME`, `SWING_SETTLE_TIME`, `SWING_SETTLE_DAMP`.
4. **Hold vs. carve.** Do you ever grab a ride when you only meant to steer, or fail to grab when you
   meant to? → `HOLD_ARM_TIME`, `DRAG_DEADZONE_PX`.
5. **Carving.** Roll down the hill weaving. Twitchy or sluggish → `STEER_RANGE_PX`, `STEER_SMOOTH`,
   `TURN_RATE_MAX` (slow speed), `LAT_ACCEL_MAX` (high speed), `CARVE_SCRUB`.

## Movement

| Question | Constants |
| --- | --- |
| Is top speed on a long hill exciting but controllable? | `AIR_DRAG`, `GRAVITY`, `MAX_SPEED`, `ROLL_RESIST` |
| Does a slow board find the fall line without fighting you? | `FALLLINE_GAIN`, `FALLLINE_SPEED` |
| Is tic-tac on the flat a usable last resort without being a push button? | `PUMP_GAIN`, `PUMP_SPEED_CAP` |
| Is the hop high enough for rails and awnings, with a forgiving window? | `HOP_V`, `HOP_SPEED_BONUS`, `HOP_BUFFER`, `COYOTE_TIME`, `HOP_COOLDOWN` |
| Is the swipe-up recognised every time, and never by accident while carving? | `SWIPE_UP_PX`, `SWIPE_UP_TIME` |
| Do crests and ledges launch you when they should and not when they shouldn't? | `GROUND_STICK`, `STEP_UP` |
| Are stairs unpleasant enough to make the rail the obvious line? | `STAIR_DRAG`, `CAM_SHAKE` |
| Does the rail magnet catch honest attempts and ignore near misses? | `RAIL_SNAP`, `RAIL_SNAP_UP`, `RAIL_SNAP_DOWN`, `RAIL_ENTRY_VY`, `GRIND_ALIGN` |
| Is a grind fast and does it throw you off the end nicely? | `GRIND_MIN_SPEED`, `GRIND_ENTRY_BOOST`, `GRIND_FRICTION`, `GRIND_EXIT_POP`, `GRIND_HOP_SIDE` |
| Do wallrides trigger when you mean them and last long enough to use? | `WALL_ALIGN`, `WALL_MIN_SPEED`, `WALL_TIME`, `WALL_GRAVITY`, `WALL_ENTRY_UP`, `WALL_JUMP_OUT`, `WALL_JUMP_UP` |
| Do awnings feel like trampolines? | `AWNING_BOUNCE`, `AWNING_KEEP` |
| Are bails rare, fair and short? | `WALL_BAIL_SPEED`, `BAIL_IMPACT`, `RIDE_BAIL_SPEED`, `BAIL_TIME`, `BAIL_FRICTION` |
| Does brushing a wall cost the right amount of speed? | `WALL_SCRUB`, `WALL_BOUNCE` |

## Hitching and chains

| Question | Constants |
| --- | --- |
| Is the tow rope the right length to carve behind a ride? | per-line `rope` (ride data), `REEL_RATE` |
| Is the window to chain into a second ride fair? | `CHAIN_GROUND_GRACE`, `SLING_POP`, `SLING_HOP_POP`, `RELATCH_COOLDOWN` |
| Do links make you feel faster without breaking the city? | `LINK_BONUS`, `SLING_CAP`, `SLING_MIN` |
| Does hanging under an overhead ride feel like flying? | `HITCH_Y_RATE`, per-line `hang` |
| Does bouncing off a vehicle roof feel deliberate? | `RIDE_ROOF_BOUNCE` |

## Camera

| Question | Constants |
| --- | --- |
| Can you see far enough down the hill in portrait? | `CAM_HEIGHT`, `CAM_DIST`, `CAM_LOOK_AHEAD`, `CAM_LOOK_UP`, `CAM_FOV` |
| Does speed feel fast? | `CAM_FOV_SPEED`, `CAM_SPEED_DIST` |
| Does the camera turn with you without making you seasick? | `CAM_YAW_RATE`, `CAM_POS_RATE` |
| Can you read the swing and the aim arrow while hitched? | `CAM_HITCH_DIST`, `CAM_HITCH_HEIGHT` |
| Can you see where you will land, and the hill while climbing? | `CAM_AIR_HEIGHT`, `CAM_UPHILL_HEIGHT`, `CAM_MIN_CLEAR` |

## Only on a real phone

- Frame rate and heat on a mid-range device. Headless Chrome rasterises on the CPU, so the gate only
  measures main-thread work. If the GPU is the limit, the print pass is the first thing to drop
  (`view.riso.enabled`), then the pixel-ratio cap in `src/render/view.ts`.
- Thumb reach: is the lower half of the screen enough room to drag full lock both ways
  (`STEER_RANGE_PX`)?
- Halftone dot size on a high-density screen (`3.6 * pixelRatio` in `createRiso().setSize`).
- Misregistration strength: readable as print, not as blur (plate offsets in the riso shader).

## Sound (nobody has heard it yet)

The audio was written and verified by measurement only: levels, timing, voice counts, chord charts.
An ear has to judge the rest. Mute with `?mute`.

- Does each district sound like its style: cumbia (Docks), funk (Mercado), highlife (Terraces), city
  pop (Antenna Hill)? Does a lone stem still groove when it is the only one in?
- Balance between stems, and of music against wheel noise (`setVolumes` in `src/audio/index.ts`; stem
  levels in `src/audio/tracks/*.ts`).
- The stem fade-in on a hitch (starts on the next beat), the one-beat cross-fade between district
  tracks at different tempos, and the two-bar fade after landing.
- Is the hard cut on a bail satisfying or just abrupt?
- City pop bar 2: the lead holds F over C7 (a minor ninth against the E in the chord). Colour or clash?
- Wheel noise character, the stairs clatter rate, wind, the three motor timbres, the grind scrape.
- CPU cost of the synth on a real phone.
