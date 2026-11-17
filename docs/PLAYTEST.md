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
| Do awnings feel like trampolines? | `AWNING_BOUNCE`, `AWNING_KEEP`, `AWNING_ROLL_THROW` |
| Are bails rare, fair and short? | `WALL_BAIL_SPEED`, `BAIL_IMPACT`, `RIDE_BAIL_SPEED`, `BAIL_TIME`, `BAIL_FRICTION` |
| Does a bail by a vehicle or a wall throw you clear without looking silly? | `BAIL_KNOCK_CARRY`, `BAIL_KNOCK_SIDE`, `BAIL_KNOCK_UP`, `AIR_BONK_BAIL` |
| Does brushing a wall cost the right amount of speed? | `WALL_SCRUB`, `WALL_BOUNCE` |
| Does clipping a wall in the air (or another wall mid-wallride) feel like a bonk, not a stop or a launch? | `AIR_BONK` |
| Does stalling on a nearly flat rail step you off when it should? | `GRIND_STALL_SPEED`, `GRIND_FLAT_SLOPE` |

## Hitching and chains

| Question | Constants |
| --- | --- |
| Is the tow rope the right length to carve behind a ride? | per-line `rope` (ride data), `REEL_RATE` |
| Is the window to chain into a second ride fair? | `CHAIN_GROUND_GRACE`, `SLING_POP`, `SLING_HOP_POP`, `RELATCH_COOLDOWN` |
| Do links make you feel faster without breaking the city? | `LINK_BONUS`, `SLING_CAP`, `SLING_MIN` |
| Does hanging under an overhead ride feel like flying? | `HITCH_Y_RATE`, per-line `hang` |
| Does bouncing off a vehicle roof feel deliberate? | `RIDE_ROOF_BOUNCE` |
| Does the swing feel alive behind slow rides and not frantic behind fast ones? | `SWING_REF_SPEED`, `SWING_REF_MIN`, `SWING_REF_MAX` |
| Does getting towed into a wall feel fair: a knock, and a slip only when really dragged round a corner? | `HITCH_WALL_BOUNCE`, `STRAP_SLIP` |
| Behind a ground ride, do small bumps keep you on the ground instead of floating? | `TOW_SNAP_HEIGHT` |

## Camera

| Question | Constants |
| --- | --- |
| Can you see far enough down the hill in portrait? | `CAM_HEIGHT`, `CAM_DIST`, `CAM_LOOK_AHEAD`, `CAM_LOOK_UP`, `CAM_FOV`, `CAM_LOOK_FAR`, `CAM_LOOK_SLOPE`, `CAM_LOOK_TILT_MAX` |
| Does speed feel fast? | `CAM_FOV_SPEED`, `CAM_SPEED_DIST` |
| Does the camera turn with you without making you seasick? | `CAM_YAW_RATE`, `CAM_POS_RATE` |
| Can you read the swing and the aim arrow while hitched? | `CAM_HITCH_DIST`, `CAM_HITCH_HEIGHT` |
| Can you see where you will land, and the hill while climbing? | `CAM_AIR_HEIGHT`, `CAM_UPHILL_HEIGHT`, `CAM_UPHILL_GAIN`, `CAM_CLIMB_RATE`, `CAM_AIR_FOLLOW`, `CAM_MIN_CLEAR` |
| Do the camera's moves (pulling back for speed or a hitch, tilting for the ground, widening the view) ease rather than lurch? | `CAM_EXTRA_RATE`, `CAM_TILT_RATE`, `CAM_FOV_RATE` |
| When a wall or roof blocks the view, does the camera duck in quickly and back out calmly? | `CAM_PULL_IN_RATE`, `CAM_PULL_OUT_RATE`, `CAM_PULL_MIN`, `CAM_PULL_DROP` |
| Squeezed against a wall, coming off stairs or towed up a steep street, is the skater still comfortably above your thumb? | `CAM_FRAME_MAX` |
| Do stairs rattle and do hits shake for about the right time? | `CAM_STAIR_RATTLE`, `CAM_STAIR_SPEED`, `CAM_SHAKE_DECAY`, `CAM_SHAKE` |

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
- City pop bar 2: the lead's sigh now lands on E over C7 (it held F, a minor ninth against the E).
  Does the hook still read? Funk bars 2 and 6 and highlife bars 3, 7 and 8 have the harmony voiced
  under the horns: does the clav or guitar sound too thin or too low there?
- Wheel noise character, the stairs clatter rate, wind, the three motor timbres, the grind scrape.
- CPU cost of the synth on a real phone.

## Haptics and shell (phone only)

- Vibration patterns in `src/app/haptics.ts` (`PATTERNS`): is the hitch a firm tap, the release a
  snap, the grind tick too busy, the bail too long? Android only; iOS Safari has no vibration API.
- Install flow: Android Chrome's INSTALL button on the title screen; iOS "Share → Add to Home
  Screen". Does it launch fullscreen and portrait, and does it start offline?
- The "NEW TIMETABLE" update ticket after a redeploy.
- Reduced motion: does it remove everything that bothers you (camera shake, flips, slides)?

## Rides in the city

- Night prints in cobalt with lit windows and signs carrying the picture (`KEYS` in
  `src/render/look.ts`, the night `tint`). On a phone outdoors, can you still read a rail, a stair
  edge and an approaching ride at speed at night? If not, raise the night tint toward 0.5.
- Distance haze runs 190–350 m (`FOG_NEAR`, `FOG_FAR` in `src/render/look.ts`). Does the hill feel
  big enough from the summit, and does anything visibly appear out of the haze?
- Waiting at a stop: holding a still finger plants a foot and stops you (below `FOOT_SPEED`, braking
  at `FOOT_BRAKE`, unless a ride you could grab is within `FOOT_NEAR` or you are carving past
  `FOOT_STEER`). Does stopping feel like a choice or an accident? Does pressing early while chasing
  a ride from behind ever brake you out of a catch? Standing beside the lane, does the ride pick
  you up cleanly, and how close is too close (`RIDE_SIDE_BOUNCE`)?
- Tram 5 runs at 13 m/s and the night bus at 18 m/s (`src/sim/city/lines.ts`). Is being towed that
  fast up or down the switchbacks fun or uncontrollable? Per-line `cruise`, `rope`.
- The summit route (lower cable car → summit cable car → kite → king kite → needle): a verifier
  measured 0.3–1.2 s of slack on each of three releases, with two windows a day. Is it a satisfying
  secret or impossible by hand? Phases and heights in `src/sim/city/lines.ts` and `routes.ts`;
  `CHAIN_GROUND_GRACE`, `HITCH_REACH`, `HITCH_REACH_Y`.
- The king kite's ride after the chain is long (about 55 s: out, 5 s perched over the needle, the
  whole circuit back). Is holding on that long a reward or a chore? Letting go while it perches
  slings you off the needle at chain speed: does anyone try it, and is it clear they should hold
  on? S3 `dwell`, `cruise` in `src/sim/city/lines.ts`.
- The needle's guy wire: 34 m/s at the bottom (`MAX_SPEED`). A thrill, or a blur? Do players find
  it (roll off the south edge)? Does the landing on the lawn feel right? `NEEDLE_WIRE` in
  `src/sim/city/layout.ts`; `RAIL_SNAP`, `GRIND_FRICTION`.
- The hill station's run-in steps: coming down from the summit at speed, do the steps slow you
  enough to stop on the deck with a held finger, and does it read as a way onto the platform?
  `HILL_STATION_RUNIN` in `src/sim/city/terrain.ts`; `STAIR_DRAG`, `FOOT_BRAKE`.
- The blimp: on the hill station platform at dusk (0.76) it waits 5 s with its ladder 4.2 m over the
  deck; hop to it. Is that a fair hop? Its lap takes nearly three minutes before it drops you 3 m
  back onto the deck: too long to hang on? `HOP_V`, `HITCH_REACH_Y`; S2 `cruise`.
- Catching overhead rides that need a hop (crane, cable cars, kites): is the swipe-up-and-hold
  natural?
- Is a wait of up to two minutes for tram 5, or up to four for a handcart or fish truck, too long?
