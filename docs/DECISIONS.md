# Decisions

Decisions made without the owner in the room, newest last. Cuts are marked **CUT**.

## Foundations

1. **Deterministic math in the sim.** JS does not specify the results of `Math.sin/cos/atan2/pow/...`
   across engines, so the sim uses its own polynomial versions (`src/sim/math.ts`) and only
   `+ - * / sqrt`. This is what lets a ghost recorded in one browser replay exactly in another.
2. **Input model for one thumb.** Drag and hold share one touch: a touch that stays inside a small
   dead zone for `HOLD_ARM_TIME` arms the hitch; a touch that moves first is a pure carve. Dragging
   after arming still steers. Without this, carving near any vehicle would grab it.
3. **Anti-soft-lock pump.** With no push button a skater can stop on the flat docks. Tic-tac carving
   adds a trickle of speed below walking pace. It cannot climb.
4. **Chain definition.** "Before landing" is implemented as: the chain survives until the skater has
   rolled on the ground for `CHAIN_GROUND_GRACE` (short, tunable; 0 = strict). Grinds and wallrides do
   not count as landing. A link needs a different vehicle.
5. **Line map inking by segment.** "Ride end to end" is tracked per stop-to-stop segment, so partial
   progress shows on the map; a line completes when all its segments are inked.
6. **Timetable.** Every line's lap period is padded to a divisor of the 43 200-tick day so the
   timetable repeats exactly each day. A vehicle is in service for a lap if the lap started in
   service hours.
7. **Heightfield + boxes + polylines** as the whole collision world. Stairs are a rough ramp in the
   sim and drawn as steps. Keeps the controller small and the city generator free.
8. **No shadow maps.** Halftone form shading plus blob shadows under moving things. Shadow maps would
   cost a second scene pass on a phone and fight the flat printed look.
9. **Districts and music follow the line.** A line's stem belongs to its home district's track even
   when the line crosses into another district; trams carry their music with them.
10. **13 regular lines + 3 secret lines** (roster in DESIGN section 5). "Cranes", "trams" and "cable
    cars" in the brief are covered by one crane, two trams and two cable-car lines.
11. **Frame-time gate measures main-thread work** (sim + scene update + render submit) under 4x CPU
    throttle. Headless Chrome rasterises on the CPU, so its GPU time says nothing about a phone.

## M1 — Feel slice

12. **Steer drives the swing.** While hitched, carving is a strong torque on the pendulum, not a
    gentle lean. Passive timing alone gave exits within about ±30°; carving out and cracking back
    gives the big whip and lets the player aim a chain. The swing also sustains itself at a minimum
    amplitude so there is always something to time.
13. **Bumpers are grabbed as they pass.** A ground ride cannot be hitched from in front of its
    bumper (`HITCH_AHEAD`), otherwise the skater is dragged through the vehicle body.
14. **Vehicles are solid.** They shove, bail head-on, and their roofs bounce. Riding on a moving roof
    was cut: it needs moving-platform support in the controller, and the bounce is a better trick.
    **CUT:** standing on vehicle roofs.
15. **Slow wall contact slides, it does not bounce.** With no push button a bounce at low speed
    traps the skater against a wall on a slope; below 3 m/s the board turns along the wall instead.
16. **Timetable phase.** Lines take a `phase` offset so designed meetings between lines (chain
    opportunities) recur on every lap rather than by luck.
17. **Flat normals in the shader.** The ink shader derives face normals from derivatives, so meshes
    carry only position and colour. Colour management is off: inks are authored and output in display
    space, as a printer would think of them.
18. **Camera yaw follows the ride while hitched,** not the swinging skater, so the swing reads
    against a steady frame.
19. **M1 verification follow-ups.** An independent Opus verifier (11 source mutations, all caught)
    flagged: a tap release during the strap's yank could throw the skater backwards (fixed: no
    release before `YANK_TIME`); a bail loop at the water's edge (fixed: respawn points keep
    `SAFE_MARGIN` from water and face inland); a diagonal swipe-and-hold could not arm (fixed); the
    e2e panel check was too loose (now exact). Still open, deferred to the M6 clean-up pass: a few
    smoothing rates in `camera.ts` and bounce factors in `player.ts` are literals rather than `FEEL`
    entries.
20. **Milestone tags are local.** The remote for this session only accepts pushes to the working
    branch, so `m1`…`m6` exist as local tags and as "tag mN" markers in commit subjects.

## M3b / M4 — Game layer, UI, audio wiring

21. **UI animation is clocked by the frame, not CSS.** Split-flap flips and ticket slides step on
    twos from the UI frame `dt`. CSS animations run on wall time, which made deterministic e2e
    screenshots catch every flap mid-flip.
22. **Ink slack.** A segment inks if the hitch began within `min(12 m, segment / 4)` of its start,
    because a bumper is grabbed as the vehicle pulls away from the stop, not while it stands there.
23. **The line map may stretch a long thin network** up to 3x across so it fills a portrait screen.
24. **Audio starts on the first touch or key** (browser autoplay rules) and follows the sim through
    one `AudioView` per frame; the nearest-ride search for motor sounds runs every sixth frame.

## M5a — Chalk lines and saves

25. **Steer is quantised to 63 levels for everyone, always** (`Game.step`), so a recording is exact
    and play never differs depending on whether one is running.
26. **A chalk line starts from a canonical state** (position, heading, speed on the ground; timers
    reset), so a share code needs four numbers for its start rather than the whole skater.
27. **A race moves the clock forward** to the recorded time of day minus a three-second countdown,
    during which the city runs and both skaters wait. Without that the ghost's rides would not be
    where they were.
28. **A loop route must be skated:** the finish only counts after the player has left the finish zone.
29. **Recording refuses under a roof or awning** ("find open ground"): the canonical start places the
    skater on the highest surface at that spot.
30. **Import by link.** `?chalk=SK2-…` opens the import box pre-filled. It exists because the e2e
    harness can tap but not type, and it is a reasonable way to share a line anyway.
31. **Share-code size: `SK2-` codes with an arithmetic-coded input stream.** Steer is 63 levels
    (item 25 now reads 63, not 255). The input section is one stream from a hand-written adaptive
    binary arithmetic coder (32-bit integer interval, 12-bit probabilities per context): each tick's
    steer as a delta from the last, modelled on the previous delta or on how long steer has been
    still, then hold toggles and hops as gaps. Decoding is bounded by `ticks` and re-encodes to check
    the stream byte for byte, so each line has one code. Measured with the real `Gestures` class fed
    a jittery dragging thumb (three seeds): about 0.7 kB for 30 s, 2.4 kB for 2 minutes and 4.8 kB
    for 4 minutes (the run-length `SK1-` format gave 6.0 / 23 / 47 kB); steady steering is 0.24 kB
    for 30 s (was 0.37 kB). `SK1-` codes are rejected as an unknown version, and saved ones are
    skipped on load.
32. **Camera cuts on teleport** (race start, far respawn) instead of flying across the map.

## M2 — The city (generator)

33. **Ramp streets are two switchback roads at the edges of the hill,** not ramps between the stair
    streets: a straight ramp cannot climb a 20% hill at a grade a tram can drive. Their hairpins meet
    every Mercado landing and terrace street, and several ground lines share them.
34. **The spine is a 12 m staircase with landings** through the Mercado and Terraces, a street on the
    hill. Mercado alleys are stair-surfaced too: as smooth paving an unsteered skater reached the
    docks at 20 m/s.
35. **Funicular tracks** run 4 m apart mid-hill and spread at both ends to keep corners drivable.
    **The lower cable car** starts just above the Antenna gate (z 978), not on the top terrace.
36. **The ghost tram shares the switchbacks;** its tunnel is a covered stretch on the top Mercado
    landing rather than a track of its own.
37. **The ground curls up at the side edges of the world** so a skater cannot be pinned there.

## M6a — App shell

38. **The service worker is generated after the build** from the built file list; its cache name is a
    hash of their contents. A new build installs and waits; the page shows a "new timetable" ticket
    and only swaps on RELOAD. Cached files are matched ignoring `Vary` (module scripts send an
    Origin header the precache requests lack). It never registers under `?e2e` without `sw`.
39. **Icons are drawn and PNG-encoded in code at build time** (git-ignored output), so the repo holds
    no binary assets.
40. **App-only settings** (reduced motion, print pass) and total play time live under their own
    storage key beside the sim save. RESET SAVE also resets settings; NEW GAME keeps them.
41. **Auto-pause on blur/hide is off under `?e2e` and `?route=`** so stepped routes and the perf run
    stay deterministic.
42. **Haptic patterns are literals in `src/app/haptics.ts`,** not `FEEL` entries: they are not sim
    feel and the debug panel cannot preview them on a desktop. They are on the playtest list.

## M3a — Ride data on the city

43. **Lanes.** Ground lines that share a road each run a lane to the right of the route centreline
    (narrowing where a wall is close), resampled every half metre so a bumper tracks smoothly round
    hairpins. Stops sit off the spine crossings so waiting vehicles do not block the run downhill.
44. **Tram 5's loop is 3.9 km,** so one lap fills the 12-minute day. With three trams that is one
    every four minutes; the city-fix task raises it to six. DESIGN's "tram ×3" becomes ×6.
45. **The king kite lets go by itself.** S3 vanishes at the end of its lap 1.8 m above the needle, so
    the rider drops onto the platform. A manual release cannot land there: the slingshot's minimum
    exit speed throws the skater about ten metres. The route is lower cable car → summit cable car →
    kite → king kite, one four-link chain.
46. **"Dawn–afternoon" for the handcarts is 0.22–0.65.**
47. **Vehicle flanks bounce.** Side contact reflects half the skater's speed and adds a share of the
    vehicle's, instead of stopping them; a full-speed T-bone is a bail.
48. **Chunk builds get 2 ms of each frame,** not 4: with all rides running the city's p95 frame work
    at 4x throttle was 19 ms against a 16.6 ms budget; at 2 ms it is 14 ms.
49. **A deploy must not be served from the HTTP cache.** The service worker precaches with
    `cache: 'reload'`: on hosts that cache `index.html` (GitHub Pages) the old page could be stored
    beside new scripts and white-screen after the next eviction. Found and fixed by the verifier.

## M5b — Errands, conductors, secrets

50. **Hold still to accept.** The only verb beyond the four gestures: inside an offer's zone, slow,
    not hitched, with the touch armed and no ride in reach, an offer fills in 0.6 s. After an errand
    starts or ends the touch must lift before another offer can fill.
51. **13 errands, 13 conductor challenges, 4 secrets** (ghost tram, blimp, needle, tunnel). Finished
    errands can be replayed for a better time. Feasibility is asserted from geometry and the
    timetable for all of them; four errands and two conductor challenges are also played end to end
    by closed-loop bots. The rest have not been played by anything yet.
52. **Conductor numbers are measured, not guessed:** each sling distance or air time is 0.75 x the
    best a scripted whip achieves off that ride, re-measured by a test.
53. **Riders hang:** a `rideTo` target allows 12 m of height difference so cable cars and the crane
    count when their rider passes over a zone.
54. **e2e routes assert what the game shows, not which way a race went.** The chalk route's skater
    used to lose its race; a controller change made it win. The route now requires a result ticket
    and a matching toast, whichever it is.

## M3 retune

55. **Tram 5 runs at 13 m/s with three trams,** so its lap fits half a day and one comes every two
    minutes. (This replaces item 44's "six trams": six would stand on each other at the terminus.)
    Forklifts run at 7 m/s so their two-lobe lap fits a four-minute period.
56. **The Antenna rides are all shifted 750 ticks together** so a climber who takes tram 5 from the
    docks at the start of the day still catches the last summit cable car. The climb takes 400 s
    with a few seconds to spare; the summit route's two daily windows are unchanged.
57. **The no-trap rule is exact:** a skater at rest must be on locally level ground (under 1.5% at
    their own position). Anything else is a pin. 400 drops with no vehicles: no pins, 3.5% of runs
    with a bail. Parapets at the outer hairpins are left open where the bank behind is higher, and
    dishes are turned 45 degrees to the slope.
58. **Awnings hang off the side walls that face stair streets,** where skaters actually fall (245 in
    all). Landing lips have no drop beside the flights, so nothing can hang under them.
59. **Awnings and vehicle flanks cannot trap or launch.** An awning sends a skater who comes straight
    down off along their heading instead of bouncing them on the spot for ever (found when awnings
    went into alleys: 507 bounces). A vehicle flank brings the skater up to a share of its speed
    rather than adding that share every tick of contact (a moped had shoved the climb bot to 39 m/s).

## Deploy

60. **`develop` is the testing branch.** The owner tests from a GitHub Pages deploy, so the working
    branch is pushed to `develop` after each merge that builds. `.github/workflows/pages.yml`
    builds and deploys on every push to `develop` (and to the working branch, which as the
    repository's default branch may be the only one the `github-pages` environment lets deploy until
    `develop` is added under Settings → Environments → github-pages → Deployment branches). A
    `checks` job runs typecheck, lint and tests beside the deploy without holding it back.

## M3 verification follow-ups

61. **The blimp dips to the hill station.** Its one pass (leaving at 0.76) comes down so the end of
    its ladder crosses the platform 4.2 m up for about three seconds: out of standing reach (3.6 m),
    inside a hop's (about 4.9 m). The platform was enlarged to give the sweep its length. Before
    this nobody could catch it: the ladder never came within 26 m of anything.
62. **The night bus is an express:** 18 m/s, laps leaving between 0.80 and midnight, home by 0.18, so
    none is on the road by day. The tram 9 meeting became a tram 5 meeting at night.
63. **The climb works from any morning start** (the bot crosses the hill station platform instead of
    waiting for two cars to coincide). Latest docks start that still reaches the summit the same
    day: about 0.458.
64. **The summit route stays hard:** three timed releases with roughly 0.3–1.2 s of slack, two
    windows a day (0.5125 and 0.6375). It is a secret. On the playtest list.

## M6c2 — Performance pass

65. **What the frame-time gate measures now.** `npm run perf` reports frame work per part (sim, each
    reducer, vehicles, world streaming, camera, render submit, UI, audio), per game step, and for
    frames that carry exactly one sim step, on a route that rides the city the way a player would,
    and it tours fixed viewpoints in every district by day and night for the draw-call and triangle
    budgets (worst seen: 71 draw calls, 140k triangles). Budgets gated: the two in DESIGN (mean 10,
    p95 16.6 ms of frame work), game step mean 0.6 / p95 1.5 ms, one-step frame mean 6 ms. Measured
    after the pass, at 4x throttle on a shared machine: work mean 4.5–4.9 ms, p95 10.6–13.1 ms.
66. **One-step frame p95 is reported, not gated.** Headless Chromium rasterises in software at about
    ten frames a second, so a run has only 9–16 one-step frames and their p95 is the single slowest:
    always a 12–27 ms wait inside the render submit for the software rasteriser, with the main thread
    idle. It says nothing about a phone. GPU frame time on a device is on the playtest list.
67. **What bought the time:** remembering each vehicle's state for the current tick (results
    bit-identical: the 20 000-tick sim hash is unchanged), building chunk meshes on growable typed
    arrays (chunk build 0.80 → 0.46 ms), skipping lines whose path is out of drawing range, and the
    stop board remembering each stop's next arrival.
68. **A path's heading never depends on call history.** `pathAt` kept the previous call's direction
    on a segment with no horizontal extent, so the same lookup could return different headings: a
    latent determinism bug since M1, exposed when the blimp's new descent met the vehicle memo.
    Segment directions are now precomputed, a vertical segment borrowing its neighbour's.

## M6d — Independent check of the drawn city, vehicles, city fixes and perf pass

69. **Haze ends where the streamed city ends.** The furthest chunks arrive 290–345 m out, where the
    old haze (140–520 m) was only 40% deep, so they appeared half-faded against an empty band. Haze
    now runs 190–350 m: the middle distance is clearer than before and the far ring arrives already
    in the horizon colour. The distances are named constants in `look.ts` beside the reason.
70. **Night prints in cobalt.** The verifier found night reading as a dimmed day. The night ink tint
    went from about half strength to a third, so the hill is cobalt and lit windows, signs and cabin
    lights carry the picture. Whether a rail can still be read at speed at night is on the playtest
    list.

## M6b — Onboarding

71. **The lesson is six things done once, in the order the hill presents them** (carve, hop, grind,
    hitch, sling, ink), then the map pointer and one line: "No pushing. Everything that moves is a
    lift." Nothing blocks; a step counts whenever it happens, even before its hint has shown. Chains
    are taught later, the first time a second ride is in reach after a release, and are not part of
    completion.
72. **A new game starts at 10:41 on the hill's clock** (`NEW_GAME_DAY_FRAC = 0.4036`), chosen so a
    handcart reaches Rellano 410, the first stop below the lookout, as a player who follows the hints
    gets there (about 24 s in), with a moped behind it. The property tested: arrive anywhere from
    15 s early to 15 s late, dawdle up to 20 s more, and a ride is at the stop or due within 12 s.
    Earlier in the morning was not possible: lines start service by lap, so no moped passes that
    stop before about 10:20.
73. **Errand offers wait until the first hitch.** The lookout where a new game starts is an errand
    giver's spot, and an offer asks you to hold still before you know what holding does.
74. **Fixtures skip the lesson.** A boot with `t=`, a test world or a scripted route keeps its own
    clock and has hints off; the sim's `Game` teaches only when asked (`GameOpts.hints`). The
    settings toggle turns hints off and on without marking steps learnt.
75. **The stop board hides while a hint is up**, as it does for an errand offer: raised above it, the
    hint covered the ride it was pointing at.
76. **The camera never loses the skater off the bottom of the screen.** Pulled in against a wall or
    stairs, or lifted while towed up a steep street, it sat high and close and aimed over the
    skater's head (found in the first-launch screenshots: the skater was under the hint at the
    moment of the first hitch). It now pitches down just enough to keep the skater within
    `CAM_FRAME_MAX` degrees of the centre.

Known and left: a hands-off skater from the lookout comes to rest on a plaza block 13 m short of the
first stop (the hints carry a player past it); landings fall, so you cannot stand and wait at a stop
without leaning on a wall (see PLAYTEST); a save from before onboarding starts the lesson once.
