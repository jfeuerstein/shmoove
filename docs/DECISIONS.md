# Decisions

Decisions made without the owner in the room, oldest first, in one numbered list. Each starts with
the milestone or task it came from. Where a later entry overturns an earlier one, the earlier one
says so. Everything in the original design that was not built, or was built smaller, is listed
under **Cut** at the end.

1. *[Foundations]* **Deterministic math in the sim.** JS does not specify the results of
   `Math.sin/cos/atan2/pow/...` across engines, so the sim uses its own polynomial versions
   (`src/sim/math.ts`) and only `+ - * / sqrt`. This is what lets a ghost recorded in one browser
   replay exactly in another.
2. *[Foundations]* **Input model for one thumb.** Drag and hold share one touch: a touch that stays
   inside a small dead zone for `HOLD_ARM_TIME` arms the hitch; a touch that moves first is a pure
   carve. Dragging after arming still steers. Without this, carving near any vehicle would grab it.
3. *[Foundations]* **Anti-soft-lock pump.** With no push button a skater can stop on the flat docks.
   Tic-tac carving adds a trickle of speed below walking pace. It cannot climb.
4. *[Foundations]* **Chain definition.** "Before landing" is implemented as: the chain survives
   until the skater has rolled on the ground for `CHAIN_GROUND_GRACE` (short, tunable; 0 = strict).
   Grinds and wallrides do not count as landing. A link needs a different vehicle.
5. *[Foundations]* **Line map inking by segment.** "Ride end to end" is tracked per stop-to-stop
   segment, so partial progress shows on the map; a line completes when all its segments are inked.
6. *[Foundations]* **Timetable.** Every line's lap period is padded to a divisor of the 43 200-tick
   day so the timetable repeats exactly each day. A vehicle is in service for a lap if the lap
   started in service hours.
7. *[Foundations]* **Heightfield + boxes + polylines** as the whole collision world. Stairs are a
   rough ramp in the sim and drawn as steps. Keeps the controller small and the city generator free.
8. *[Foundations]* **No shadow maps.** Halftone form shading plus blob shadows under moving things.
   Shadow maps would cost a second scene pass on a phone and fight the flat printed look.
9. *[Foundations]* **Districts and music follow the line.** A line's stem belongs to its home
   district's track even when the line crosses into another district; trams carry their music with
   them.
10. *[Foundations]* **13 regular lines + 3 secret lines** (roster in DESIGN section 5). "Cranes",
    "trams" and "cable cars" in the brief are covered by one crane, two trams and two cable-car
    lines.
11. *[Foundations]* **Frame-time gate measures main-thread work** (sim + scene update + render
    submit) under 4x CPU throttle. Headless Chrome rasterises on the CPU, so its GPU time says
    nothing about a phone.
12. *[M1]* **Steer drives the swing.** While hitched, carving is a strong torque on the pendulum,
    not a gentle lean. Passive timing alone gave exits within about ±30°; carving out and cracking
    back gives the big whip and lets the player aim a chain. The swing also sustains itself at a
    minimum amplitude so there is always something to time.
13. *[M1]* **Bumpers are grabbed as they pass.** A ground ride cannot be hitched from in front of
    its bumper (`HITCH_AHEAD`), otherwise the skater is dragged through the vehicle body.
14. *[M1]* **Vehicles are solid.** They shove, bail head-on, and their roofs bounce. Riding on a
    moving roof was cut: it needs moving-platform support in the controller, and the bounce is a
    better trick. **CUT:** standing on vehicle roofs.
15. *[M1]* **Slow wall contact slides, it does not bounce.** With no push button a bounce at low
    speed traps the skater against a wall on a slope; below 3 m/s the board turns along the wall
    instead.
16. *[M1]* **Timetable phase.** Lines take a `phase` offset so designed meetings between lines
    (chain opportunities) recur on every lap rather than by luck.
17. *[M1]* **Flat normals in the shader.** The ink shader derives face normals from derivatives, so
    meshes carry only position and colour. Colour management is off: inks are authored and output in
    display space, as a printer would think of them.
18. *[M1]* **Camera yaw follows the ride while hitched,** not the swinging skater, so the swing
    reads against a steady frame.
19. *[M1]* **M1 verification follow-ups.** An independent Opus verifier (11 source mutations, all
    caught) flagged: a tap release during the strap's yank could throw the skater backwards (fixed:
    no release before `YANK_TIME`); a bail loop at the water's edge (fixed: respawn points keep
    `SAFE_MARGIN` from water and face inland); a diagonal swipe-and-hold could not arm (fixed); the
    e2e panel check was too loose (now exact). The literals left in `camera.ts`, `hitch.ts` and
    `player.ts` (smoothing rates, bounce factors) were moved into `FEEL` in M6c1.
20. *[M1]* **Milestone tags are local.** The remote for this session only accepts pushes to the
    working branch, so milestone tags are local. Only `m1` was ever tagged; M2–M5 were closed by
    their merge commits and PLAN status, and `m6` is the lead's to tag after the final gate.
21. *[M3b/M4]* **UI animation is clocked by the frame, not CSS.** Split-flap flips and ticket slides
    step on twos from the UI frame `dt`. CSS animations run on wall time, which made deterministic
    e2e screenshots catch every flap mid-flip.
22. *[M3b/M4]* **Ink slack.** A segment inks if the hitch began within `min(12 m, segment / 4)` of
    its start, because a bumper is grabbed as the vehicle pulls away from the stop, not while it
    stands there.
23. *[M3b/M4]* **The line map may stretch a long thin network** up to 3x across so it fills a
    portrait screen.
24. *[M3b/M4]* **Audio starts on the first touch or key** (browser autoplay rules) and follows the
    sim through one `AudioView` per frame; the nearest-ride search for motor sounds runs every sixth
    frame.
25. *[M5a]* **Steer is quantised to 63 levels for everyone, always** (`Game.step`), so a recording
    is exact and play never differs depending on whether one is running.
26. *[M5a]* **A chalk line starts from a canonical state** (position, heading, speed on the ground;
    timers reset), so a share code needs four numbers for its start rather than the whole skater.
27. *[M5a]* **A race moves the clock forward** to the recorded time of day minus a three-second
    countdown, during which the city runs and both skaters wait. Without that the ghost's rides
    would not be where they were.
28. *[M5a]* **A loop route must be skated:** the finish only counts after the player has left the
    finish zone.
29. *[M5a]* **Recording refuses under a roof or awning** ("find open ground"): the canonical start
    places the skater on the highest surface at that spot.
30. *[M5a]* **Import by link.** `?chalk=SK2-…` opens the import box pre-filled. It exists because
    the e2e harness can tap but not type, and it is a reasonable way to share a line anyway.
31. *[M5a]* **Share-code size: `SK2-` codes with an arithmetic-coded input stream.** Steer is 63
    levels (item 25 now reads 63, not 255). The input section is one stream from a hand-written
    adaptive binary arithmetic coder (32-bit integer interval, 12-bit probabilities per context):
    each tick's steer as a delta from the last, modelled on the previous delta or on how long steer
    has been still, then hold toggles and hops as gaps. Decoding is bounded by `ticks` and
    re-encodes to check the stream byte for byte, so each line has one code. Measured with the real
    `Gestures` class fed a jittery dragging thumb (three seeds): about 0.7 kB for 30 s, 2.4 kB for 2
    minutes and 4.8 kB for 4 minutes (the run-length `SK1-` format gave 6.0 / 23 / 47 kB); steady
    steering is 0.24 kB for 30 s (was 0.37 kB). `SK1-` codes are rejected as an unknown version, and
    saved ones are skipped on load.
32. *[M5a]* **Camera cuts on teleport** (race start, far respawn) instead of flying across the map.
33. *[M2]* **Ramp streets are two switchback roads at the edges of the hill,** not ramps between the
    stair streets: a straight ramp cannot climb a 20% hill at a grade a tram can drive. Their
    hairpins meet every Mercado landing and terrace street, and several ground lines share them.
34. *[M2]* **The spine is a 12 m staircase with landings** through the Mercado and Terraces, a
    street on the hill. Mercado alleys are stair-surfaced too: as smooth paving an unsteered skater
    reached the docks at 20 m/s.
35. *[M2]* **Funicular tracks** run 4 m apart mid-hill and spread at both ends to keep corners
    drivable. **The lower cable car** starts just above the Antenna gate (z 978), not on the top
    terrace.
36. *[M2]* **The ghost tram shares the switchbacks;** its tunnel is a covered stretch on the top
    Mercado landing rather than a track of its own.
37. *[M2]* **The ground curls up at the side edges of the world** so a skater cannot be pinned
    there.
38. *[M6a]* **The service worker is generated after the build** from the built file list; its cache
    name is a hash of their contents. A new build installs and waits; the page shows a "new
    timetable" ticket and only swaps on RELOAD. Cached files are matched ignoring `Vary` (module
    scripts send an Origin header the precache requests lack). It never registers under `?e2e`
    without `sw`.
39. *[M6a]* **Icons are drawn and PNG-encoded in code at build time** (git-ignored output), so the
    repo holds no binary assets.
40. *[M6a]* **App-only settings** (reduced motion, print pass) and total play time live under their
    own storage key beside the sim save. RESET SAVE also resets settings; NEW GAME keeps them.
41. *[M6a]* **Auto-pause on blur/hide is off under `?e2e` and `?route=`** so stepped routes and the
    perf run stay deterministic.
42. *[M6a]* **Haptic patterns are literals in `src/app/haptics.ts`,** not `FEEL` entries: they are
    not sim feel and the debug panel cannot preview them on a desktop. They are on the playtest
    list.
43. *[M3a]* **Lanes.** Ground lines that share a road each run a lane to the right of the route
    centreline (narrowing where a wall is close), resampled every half metre so a bumper tracks
    smoothly round hairpins. Stops sit off the spine crossings so waiting vehicles do not block the
    run downhill.
44. *[M3a]* **Tram 5's loop is 3.9 km,** so one lap fills the 12-minute day. With three trams that
    is one every four minutes; the city-fix task raises it to six. DESIGN's "tram ×3" becomes ×6.
    **Superseded by 55.**
45. *[M3a]* **The king kite lets go by itself.** S3 vanishes at the end of its lap 1.8 m above the
    needle, so the rider drops onto the platform. A manual release cannot land there: the
    slingshot's minimum exit speed throws the skater about ten metres. The route is lower cable car
    → summit cable car → kite → king kite, one four-link chain. **Superseded by 95:** the king kite
    now flies out and back and goes out of service over the needle, setting the rider down.
46. *[M3a]* **"Dawn–afternoon" for the handcarts is 0.22–0.65.**
47. *[M3a]* **Vehicle flanks bounce.** Side contact reflects half the skater's speed and adds a
    share of the vehicle's, instead of stopping them; a full-speed T-bone is a bail.
48. *[M3a]* **Chunk builds get 2 ms of each frame,** not 4: with all rides running the city's p95
    frame work at 4x throttle was 19 ms against a 16.6 ms budget; at 2 ms it is 14 ms.
49. *[M3a]* **A deploy must not be served from the HTTP cache.** The service worker precaches with
    `cache: 'reload'`: on hosts that cache `index.html` (GitHub Pages) the old page could be stored
    beside new scripts and white-screen after the next eviction. Found and fixed by the verifier.
50. *[M5b]* **Hold still to accept.** The only verb beyond the four gestures: inside an offer's
    zone, slow, not hitched, with the touch armed and no ride in reach, an offer fills in 0.6 s.
    After an errand starts or ends the touch must lift before another offer can fill.
51. *[M5b]* **13 errands, 13 conductor challenges, 4 secrets** (ghost tram, blimp, needle, tunnel).
    Finished errands can be replayed for a better time. Feasibility is asserted from geometry and
    the timetable for all of them; four errands and two conductor challenges are also played end to
    end by closed-loop bots. The rest have not been played by anything yet. The M5 verifier also
    completed every errand and challenge with bots of its own, which are not in the repository; the
    full-game check (80–82) does not play errands.
52. *[M5b]* **Conductor numbers are measured, not guessed:** each sling distance or air time is 0.75
    x the best a scripted whip achieves off that ride, re-measured by a test.
53. *[M5b]* **Riders hang:** a `rideTo` target allows 12 m of height difference so cable cars and
    the crane count when their rider passes over a zone.
54. *[M5b]* **e2e routes assert what the game shows, not which way a race went.** The chalk route's
    skater used to lose its race; a controller change made it win. The route now requires a result
    ticket and a matching toast, whichever it is.
55. *[M3 retune]* **Tram 5 runs at 13 m/s with three trams,** so its lap fits half a day and one
    comes every two minutes. (This replaces item 44's "six trams": six would stand on each other at
    the terminus.) Forklifts run at 7 m/s so their two-lobe lap fits a four-minute period.
56. *[M3 retune]* **The Antenna rides are all shifted 750 ticks together** so a climber who takes
    tram 5 from the docks at the start of the day still catches the last summit cable car. The climb
    takes 400 s with a few seconds to spare; the summit route's two daily windows are unchanged.
57. *[M3 retune]* **The no-trap rule is exact:** a skater at rest must be on locally level ground
    (under 1.5% at their own position). Anything else is a pin. 400 drops with no vehicles: no pins,
    3.5% of runs with a bail. Parapets at the outer hairpins are left open where the bank behind is
    higher, and dishes are turned 45 degrees to the slope.
58. *[M3 retune]* **Awnings hang off the side walls that face stair streets,** where skaters
    actually fall (245 in all). Landing lips have no drop beside the flights, so nothing can hang
    under them.
59. *[M3 retune]* **Awnings and vehicle flanks cannot trap or launch.** An awning sends a skater who
    comes straight down off along their heading instead of bouncing them on the spot for ever (found
    when awnings went into alleys: 507 bounces). A vehicle flank brings the skater up to a share of
    its speed rather than adding that share every tick of contact (a moped had shoved the climb bot
    to 39 m/s).
60. *[Deploy]* **`develop` is the testing branch.** The owner tests from a GitHub Pages deploy, so
    the working branch is pushed to `develop` after each merge that builds.
    `.github/workflows/pages.yml` builds and deploys on every push to `develop` (and to the working
    branch, which as the repository's default branch may be the only one the `github-pages`
    environment lets deploy until `develop` is added under Settings → Environments → github-pages →
    Deployment branches). A `checks` job runs typecheck, lint and tests beside the deploy without
    holding it back.
61. *[M3 verification]* **The blimp dips to the hill station.** Its one pass (leaving at 0.76) comes
    down so the end of its ladder crosses the platform 4.2 m up for about three seconds: out of
    standing reach (3.6 m), inside a hop's (about 4.9 m). The platform was enlarged to give the
    sweep its length. Before this nobody could catch it: the ladder never came within 26 m of
    anything. **Superseded by 94:** the lap now starts and ends over the platform.
62. *[M3 verification]* **The night bus is an express:** 18 m/s, laps leaving between 0.80 and
    midnight, home by 0.18, so none is on the road by day. The tram 9 meeting became a tram 5
    meeting at night.
63. *[M3 verification]* **The climb works from any morning start** (the bot crosses the hill station
    platform instead of waiting for two cars to coincide). Latest docks start that still reaches the
    summit the same day: about 0.458.
64. *[M3 verification]* **The summit route stays hard:** three timed releases with roughly 0.3–1.2 s
    of slack, two windows a day (0.5125 and 0.6375). It is a secret. On the playtest list.
65. *[M6c2]* **What the frame-time gate measures now.** `npm run perf` reports frame work per part
    (sim, each reducer, vehicles, world streaming, camera, render submit, UI, audio), per game step,
    and for frames that carry exactly one sim step, on a route that rides the city the way a player
    would, and it tours fixed viewpoints in every district by day and night for the draw-call and
    triangle budgets (worst seen: 71 draw calls, 140k triangles). Budgets gated: the two in DESIGN
    (mean 10, p95 16.6 ms of frame work), game step mean 0.6 / p95 1.5 ms, one-step frame mean 6 ms.
    Measured after the pass, at 4x throttle on a shared machine: work mean 4.5–4.9 ms, p95 10.6–13.1
    ms. **Superseded by 83** (the route described here timed the summit lawn only).
66. *[M6c2]* **One-step frame p95 is reported, not gated.** Headless Chromium rasterises in software
    at about ten frames a second, so a run has only 9–16 one-step frames and their p95 is the single
    slowest: always a 12–27 ms wait inside the render submit for the software rasteriser, with the
    main thread idle. It says nothing about a phone. GPU frame time on a device is on the playtest
    list.
67. *[M6c2]* **What bought the time:** remembering each vehicle's state for the current tick
    (results bit-identical: the 20 000-tick sim hash is unchanged), building chunk meshes on
    growable typed arrays (chunk build 0.80 → 0.46 ms), skipping lines whose path is out of drawing
    range, and the stop board remembering each stop's next arrival.
68. *[M6c2]* **A path's heading never depends on call history.** `pathAt` kept the previous call's
    direction on a segment with no horizontal extent, so the same lookup could return different
    headings: a latent determinism bug since M1, exposed when the blimp's new descent met the
    vehicle memo. Segment directions are now precomputed, a vertical segment borrowing its
    neighbour's.
69. *[M6d]* **Haze ends where the streamed city ends.** The furthest chunks arrive 290–345 m out,
    where the old haze (140–520 m) was only 40% deep, so they appeared half-faded against an empty
    band. Haze now runs 190–350 m: the middle distance is clearer than before and the far ring
    arrives already in the horizon colour. The distances are named constants in `look.ts` beside the
    reason.
70. *[M6d]* **Night prints in cobalt.** The verifier found night reading as a dimmed day. The night
    ink tint went from about half strength to a third, so the hill is cobalt and lit windows, signs
    and cabin lights carry the picture. Whether a rail can still be read at speed at night is on the
    playtest list.
71. *[M6b]* **The lesson is six things done once, in the order the hill presents them** (carve, hop,
    grind, hitch, sling, ink), then the map pointer and one line: "No pushing. Everything that moves
    is a lift." Nothing blocks; a step counts whenever it happens, even before its hint has shown.
    Chains are taught later, the first time a second ride is in reach after a release, and are not
    part of completion. **Superseded by 88** (four lesson steps: carve, hitch, ink, sling; hop and
    grind became situational hints).
72. *[M6b]* **A new game starts at 0.4036 of the day** (`NEW_GAME_DAY_FRAC`: 09:41, which the board,
    whose clock moves in five-minute steps, shows as 09:40), chosen so a handcart reaches Rellano
    410, the first stop below the lookout, as a player who follows the hints gets there (about 24 s
    in), with a moped behind it. The property tested: arrive anywhere from 15 s early to 15 s late,
    dawdle up to 20 s more, and a ride is at the stop or due within 12 s. Earlier in the morning was
    not possible: lines start service by lap, so no moped passes that stop before about 10:20 on the
    24-hour clock (0.4295 of the day: 18.6 s after a new game starts, in a 12-minute day).
73. *[M6b]* **Errand offers wait until the first hitch.** The lookout where a new game starts is an
    errand giver's spot, and an offer asks you to hold still before you know what holding does.
74. *[M6b]* **Fixtures skip the lesson.** A boot with `t=`, a test world or a scripted route keeps
    its own clock and has hints off; the sim's `Game` teaches only when asked (`GameOpts.hints`).
    The settings toggle turns hints off and on without marking steps learnt.
75. *[M6b]* **The stop board hides while a hint is up**, as it does for an errand offer: raised
    above it, the hint covered the ride it was pointing at.
76. *[M6b]* **The camera never loses the skater off the bottom of the screen.** Pulled in against a
    wall or stairs, or lifted while towed up a steep street, it sat high and close and aimed over
    the skater's head (found in the first-launch screenshots: the skater was under the hint at the
    moment of the first hitch). It now pitches down just enough to keep the skater within
    `CAM_FRAME_MAX` degrees of the centre.
77. *[M6 onboarding check; superseded by 113]* **Holding a still finger plants a foot.** The independent check of
    onboarding found that a clumsy first-timer never caught a ride: by the time they reacted to the
    hint they had rolled past the stop, and nothing in the game let them stop or go back. Landings
    fall, so nobody could stand and wait at a stop at all, in a game about catching scheduled rides.
    Now a held, still finger with no ride near brakes the board to a stop and holds it there, even
    on a slope, until the finger lifts or a ride's grab point comes past (then it latches as
    before). It is not a push: it only ever removes speed. It does nothing above `FOOT_SPEED` (a
    hand out at speed is not a brake), nothing while carving (a dragging finger is reaching on the
    move), and nothing while rolling with a grabbable ride within `FOOT_NEAR` (coast into it).
    "Press and hold still" now means what it says.
78. *[M6 onboarding check]* **A forged chalk tick count is not always damage.** The test that
    claimed one tick fewer and expected an error depended on the recorded run: when the dropped
    frame costs under a bit, the shorter line has the same bytes and that code is simply the one
    code of a shorter line. The test now asserts what the format guarantees: a forged count either
    fails as a bad stream or decodes to a line whose one code is the forged code; trailing bytes
    always fail.
79. *[M6e]* **The blimp (S2) can never be completed.** Its first segment (Cumbre to Cerro Sur) can
    only ink on a hitch caught within 12 m of the start of its pass, where the ladder hangs 28 m
    above the summit with nothing under it to reach from; the only catch is the low sweep over the
    hill station platform, 410 m into the lap. The full-game test asserts the blimp is found and its
    second segment inked, and every other line complete. Left for the lead: move the pass's start
    over something a skater can stand on, or start the lap at the hill station. **Superseded by
    94:** the blimp is now completable.
80. *[M6e]* **What a save/load is compared on.** A save keeps the time of day, not the day, and puts
    the skater down at rest at their last safe spot, so a loaded game cannot match an uninterrupted
    one tick for tick. The test compares, from the save on: the same game events in the same order,
    every ink, line and secret event at the same time of day, and at the end the skater bit for bit
    except the resume spot, the half-second clock that refreshes it, and the memory of the last
    handrail ground. Saves are taken when the bot is waiting at a stop and the game's safe spot has
    caught up with it (within 0.5 s of stepping off a ride the safe spot is still where the ride was
    boarded, and a save there resumes the skater at the boarding stop).
81. *[M6e]* **The rail magnet counts as a move a skater can make.** Snapping onto a handrail moves
    the board up to `RAIL_SNAP` sideways in one tick (0.97 m on the spine's handrail); the
    no-teleport bound is the fastest speed for a tick plus `RAIL_SNAP`.
82. *[M6e]* **"Never stuck" is a new segment or a change of district every 3 minutes, up to the
    map.** The longest stretch is 161 s (night 2, the walk from Rellano 410 to the crane at the west
    end of the quay and its run to Grúa Centro). Tram 5's first run of day 4 leaves Muelle 181 s
    after the last forklift lap ends; the bot rolls to the foot of the Mercado steps behind the stop
    while it waits, which counts as a change of district. The secret phase waits for midnight and
    the windy hours, and is not held to the 3-minute rule.
83. *[M6f]* **What the frame-time gate times now (corrects 65).** Item 65 said the gate rode "the
    city the way a player would"; it timed about 8 simulated seconds on the summit lawn (11 m, no
    hitch, ~25 draw calls). `npm run perf` now plays `?route=perfcity`: five legs of 600 ticks
    (Mercado, Terraces, Antenna Hill, a fast Terraces run that crosses chunk rows, the Docks), each
    starting on the spine at a fixed z, and times ticks 150–600 of each leg as normal frames of the
    normal loop. Windows are cut by route tick, not wall time, so they hold the same riding on any
    machine. The frames of all windows are pooled for the gated mean and p95; each window's mean,
    p95, draw calls, triangles and parts are printed and stored with its district. The run fails
    unless every window travels 40 m, all four districts are seen, two hitches fall in timed frames,
    two windows hitch and sling, one window crosses two chunk boundaries at 8 m/s or more while
    chunks are built, and there are 300 timed frames. The gated draw calls and triangles are now the
    most seen in any timed frame (they were the last frame's). The route steers with the sim's
    deterministic math, so `tests/unit/perfRoute.test.ts` plays it in Node tick for tick and checks
    the same facts with margin. Leg starts were picked by riding candidate starts in the sim: the
    rides run to a timetable, so a leg's hitches depend on its start tick and the order matters. The
    old summit loop stays as `?route=perf` (profiling, sim hash); `profile.mjs` defaults to
    `perfcity`. A whole `npm run perf` takes about 3 minutes here.
84. *[M6f]* **Chunk builds come in one-row pieces, and the typed-array build is a piece of its
    own.** A piece is one terrain row of ground, of paint or of stair treads, one solid, one rail,
    one zone, and last `MeshBuilder.build()`. The pieces run in `meshChunk`'s order, so the geometry
    is identical to an uninterrupted build (a test hashes every attribute array of every chunk).
    Measured in Node, best of five passes over every chunk at both levels of detail: worst piece
    0.51–0.55 ms (the build of the biggest near chunk, 18k vertices), worst meshing piece 0.27 ms.
    Before, pieces of four rows were up to 0.23 ms but the 0.51 ms build ran unchecked right after
    the last piece. In the browser at 4x throttle the world part's p95 is 2.3–2.9 ms; its rare 8–17
    ms spikes land on pieces that add a few dozen vertices or none, i.e. GC pauses and the throttler
    or a loaded machine suspending the thread, not piece work.
85. *[M6f]* **Bounds are still computed in `build()`.** `computeBoundingSphere` and
    `computeBoundingBox` are about 60% of the build piece (0.36 + 0.17 of ~0.85 ms on a big near
    chunk, not best-of). They live in `src/render/geom.ts`, which this task did not own: proposed
    follow-up is an optional bounds argument (or box only, sphere from the box), which would bring
    the worst piece to about 0.25 ms. Reusing builder storage between chunks (a `reset()`) would
    also cut the GC churn behind the spikes in 84. **Resolved after M6f:** `MeshBuilder.build()` now
    sets the box from its own pass over the positions and the sphere from the box (commit 68f15d4),
    so the build piece no longer pays for three.js's bounds; builder storage is still not reused
    between chunks.
86. *[M6f]* **After a teleport the camera's view is built at once.** Besides the 3x3 under the
    camera, every chunk within NEAR_R whose box (ground to its tallest solid plus 30 m) meets the
    camera's frustum is built in the first frame at the new place, so chunks 110–170 m out no longer
    pop in over the following frames. The cost is a longer cut: the worst building frame at 4x
    throttle (load, respawn) is 135–290 ms against 158 ms with the 3x3 only. e2e screenshots differ
    only where chunks now arrive earlier (pixel diff against the previous build: 45 of 54 identical;
    the city and proptown differences are extra chunks in the middle distance, the rest a few UI
    pixels that differ from run to run).
87. *[M6f]* **The honest numbers miss the p95 budget on a loaded machine, and the miss is the render
    submit.** Pooled over the five windows at load 2.6–4.5: work mean 5.4–6.0 ms, p95 14.3–16.0 ms
    (pass). At load 5.9–9.1 (other agents on this 4-core box): mean 7.0–7.3, p95 20.3–20.6 (fail).
    In every run the submit part (WebGL calls waiting on the software rasteriser in the GPU process)
    is about two thirds of the p95 frame (pooled p95 9.5–13.9 ms); sim, vehicles, world, camera and
    UI are each under 3 ms at p95. Single windows go over 16.6 ms p95 at times (Antenna 23.3 once at
    load 2.6) for the same reason. Submit cost is set by the renderer and the look, not by the code
    this task owned; budgets were not raised and the route was not shortened.
88. *[M6g]* **The lesson is carve, hitch, ink, sling (corrects 71).** Hop and grind are hints that
    show in their situations until each is done once, before or after completion, like the chain; a
    fourth such hint, `roll` ("WIGGLE TO ROLL"), shows after 3 s stalled on flat ground without
    holding (stalled: under 1.5 m/s and within 3 m of where the stall began) and is done above 2
    m/s. On the first ride the player is told to stay on to the next stop first and only then to
    drag and let go: with the sling first, players were thrown off their first ride and then needed
    a whole second stop-to-stop ride to ink, which most of the remaining failures came down to. A
    ride that lets go of the player (out of service, strap slip) never counts as the sling; only a
    lifted finger or a flick does.
89. *[M6g]* **The hitch hint leads to a waiting spot.** Stops of ground rides each get up to two
    spots, beside the grab point where the ride stands, 1.2 m clear of its body, more than 1 m clear
    of every other ride's lane, on level ground that is not stairs or water. The hint shows when the
    skater is heading for such a stop (within 45 m, no more than 1 m above them, ahead within 60
    degrees unless within 15 m) and a ride of that line stands at or passes it within 20 s (kept
    while one is due within 45 s); the pointer is on the spot until that ride is within 30 m, then
    on its grab bar. A slow skater on flat ground (under 2.5 m/s) is led to stops up to 120 m off
    and 2.5 m above, rides due within 45 s: landings, terraces and docks are flat and nothing else
    would get them moving. A spot across another lane from the skater counts 30 m further. The ink
    hint uses the same lead when the player is not on a ride ("PRESS AND HOLD STILL / RIDE IT TO THE
    NEXT STOP"). Before the hitch is learnt no ride that needs a hop is pointed at; after it, such a
    ride is, with "FLICK UP, THEN HOLD".
90. *[M6g]* **The carve hint waits until the skater is doing 4 m/s (or has rolled 6 s).** A carve at
    walking pace on the lookout swung players east onto the x = 30 stairs and a flat landing at y =
    55, about 100 m from the first stop: first rides at about 95 s for attentive players; with the
    wait, 35-55 s.
91. *[M6g]* **The pointer.** A 1.35 m chevron, clear above the vehicle's drawn geometry (roof,
    parasol) over its grab point; a ring on the ground at a waiting spot (the ring alone once the
    skater stands on it); a half-size chevron over a rail, which is outlined. When the target is
    off-screen, behind the camera, above the bottom of the top board or below the top of the stub, a
    mango arrow at the edge of the clear part of the screen turns toward it (from the hint view's
    projection each frame).
92. *[M6g]* **Old saves.** A save with no onboarding section but with an inked segment, an errand, a
    conductor's ticket or a chalk line migrates to every step learnt and the lesson complete
    (errands open). An empty one gets the lesson.
93. *[M6g]* **Players, not a perfect bot.** `tests/sim/onboardingPlayers.test.ts`: bots that see
    only the hint, its copy, the pointer and themselves. At the time of writing attentive 30/30,
    clumsy 30/30 and fast (never hops onto a rail) 30/30 complete within 5 minutes (medians 95-100
    s) against thresholds of 27, 20 and 27. Their first ride is still at 35-55 s rather than about
    24 s: the new-game clock (item 72) has a moped at Rellano 410 at 20-23 s, before any of them is
    down there; the next rides are the handcart at 40 s and a moped at 56 s. The clock was left
    alone.
94. *[M6h]* **The blimp's lap starts and ends over the hill station platform.** Its first segment
    could never be inked (it started 28 m above the summit) and it vanished with its rider on the
    ladder. Its one lap now leaves at 0.76 from a stop over the platform (Estación del Cerro: it
    waits 5 s, ladder 4.2 m above the deck, out of standing reach and in a hop's), runs by Cerro Sur
    and the summit (Cumbre) and arrives back over the deck at 0.9965, where it goes and the rider
    drops 3 m onto the deck. Cruise went from 6 to 6.5 m/s so the lap with its third stop still ends
    before midnight (the timetable test keeps the lap inside the day).
95. *[M6h]* **The king kite is a shuttle on its circuit, not a loop: the brief's way could not
    work.** The brief asked for its stops to move so the summit chain's catch comes before the first
    stop's segment, without touching the chain's timing. That cannot be done under the ink rule: the
    chain catches the kite 35 m after Cresta Sur, a segment only inks if the ride starts within 12 m
    of its start, a loop's segments cover the whole circuit, and the only gentle way off is the kite
    going out of service at the end of a lap (letting go slings you at chain speed, +8.8 m/s at four
    links, off a 4 m platform). So the lap's end must be the needle, the catch is far from it, and
    the segments before the catch stay unridden; a stop near the catch would change the kite's speed
    there. Instead the line runs out and back on the same circuit: the way out is the old lap tick
    for tick (same stops, same phase relative to the chain, so the chain and its windows are
    unchanged), then it perches on the needle 5 s and flies the circuit back the other way, which
    inks both segments for a rider who held on, and goes out of service on the needle, setting them
    down. One lap every 90 s (period 5400) instead of every 45 s; laps leave at 0.417, 0.542 and
    0.667. `tests/sim/citySummit.test.ts` changed in one number only: its run is 6600 ticks instead
    of 4000, because the drop onto the needle now comes after the way back; its assertions and the
    route's touches are unchanged.
96. *[M6h]* **The needle's guy wire.** A straight 'guy' rail from 0.4 m off the needle platform's
    south edge, 0.3 m below its top, to the lawn east of the spine stairs (9, 1180), 44 m lower:
    rolling or hopping off that edge snaps onto it, it reaches `MAX_SPEED` and lands gently on the
    lawn (impact about 6 m/s). It falls further than a skater at `MAX_SPEED` could grind up plus a
    hop, so it is no way up; the needle test now says that instead of "no rail within 8 m". It
    passes 6–9 m west of the summit cable car's cables.
97. *[M6h]* **The hill station platform gets run-in steps, not a lower lip or a parapet.** A flight
    of steps (STAIRS surface on a ramp, drawn as treads) from the lawn and the spine down flush onto
    the deck's north edge, x 6–27, west of the cable cars' station so the cable paths (which follow
    the ground under them) are untouched. The steps' drag takes a 14 m/s skater to about 7 m/s by
    the deck, where a planted foot stops them; a parapet would bail anyone hitting it above 12 m/s.
98. *[M6h]* **Errand givers.** A giver whose offer was withdrawn without being taken stays quiet for
    45 s (transient: a save does not keep it). Seven givers that stood on or beside a stop now stand
    at spots of their own nearby (`GIVERS` in `src/sim/city/zones.ts`, kind 'giver', same names),
    which meant editing the giver ids in `src/sim/game/content/errands.ts`. Saffron's hours end at
    0.77 instead of 0.78: from its new spot the last moped could leave before a skater reached the
    stop.
99. *[M6h]* **Saves keep the day (version 2), and the resume spot follows landings.** The safe spot
    also refreshes on the first grounded tick after any ride, grind, wallride or air (in
    `src/sim/player.ts`, the safe-spot block only). The full-game check takes saves only once the
    bot stands still on a planted foot with the safe spot under it, so a load starts from exactly
    where it stood (before, it could be up to 2 m and a walking pace away).
100. **[M6b]** Known and left after onboarding (was an unnumbered note): a hands-off skater from the
     lookout comes to rest on a plaza block 13 m short of the first stop (the hints carry a player
     past it); landings fall, so you cannot stand and wait at a stop without leaning on a wall (see
     PLAYTEST); a save from before onboarding starts the lesson once. The second point is
     **superseded by 77** (a planted foot stops and holds you at a stop) and the third by **92**
     (old saves migrate).
101. **[M3b/M5b/M6a]** Four small corner buttons open screens: the line map, chalk lines, the ledger
     and pause. Pillar 2 asked for no on-screen buttons in play; these open screens rather than do
     anything in play, and each also has a key (M, L, P). Skating never needs them.
102. **[M6j]** A single ride is not a chain. The chain meter shows a lost chain (its count in pink
     for 1.3 s) only when a chain of two or more links ends; one ride ending shows nothing.
     `ChainDisplay` in `src/ui/chain.ts` holds the decision apart from the DOM so a unit test covers
     it.
103. **[M6j]** Liveries are checked as drawn. The test hook reports, per line, whether its vehicle
     meshes carry the livery's base and stripe colours and a hash of the colours they are painted
     with; the line-up route asserts all 16 lines are present, painted, distinct and on screen.
     Distinct means base + pattern (DESIGN section 7): three pairs of lines (T1/T2, T3/T4, A2/A3)
     share base and stripe colours and differ by pattern, so "a unique base + stripe pair" would be
     false.
104. **[M6j]** An e2e route fails on any console error, warning or failed assertion, as well as on a
     page error. The full run printed none.
105. **[M6j]** Dead code removed in the ship audit: six exports nothing imported (`BEATS_PER_BAR`,
     `SolidKind`, `RailKind`, `StepKind`, `ipow`, `setHeight`) and four parameters never read (in
     `roofClutter`, `cellColor` and two test helpers). About 200 exports are used only inside their
     own file; they were left exported.

## M6i — Last independent check

106. **The camera looks for a clear line to the skater.** It used to ask for the tallest thing at
     each point between itself and the skater, so under an awning it climbed onto the roof and
     showed the awning, and a pillar between two of its six samples filled the frame. It now takes
     the furthest of nine distances from which both the skater's chest and board can be seen (from
     where the skater really is, not the lagging follow height), sampling the lines every 0.4 m,
     and when every one of those is blocked (a low awning between even the closest and the skater)
     it ducks to shoulder height behind them. It keeps clear only of ground and roofs below it.
     `CAM_FRAME_MAX` keeps the skater off the bottom edge in every case (item 76).
107. *(Superseded by 113.)* **A ride ahead keeps you rolling from 25 m.** The check found that pressing early while
     rolling up behind a ride (the natural thing to do) planted the foot 3–20 m short of it: the
     first version of item 77 only spared rides within 10 m. Now a ride whose grab point is within
     standing reach height, in front of where the skater is travelling and within `FOOT_NEAR`
     (25 m) keeps the foot up; a ride coming from behind, passing to the side or hanging overhead
     is waited for. The cost that remains: pressing early for a ride you will not reach still
     slows you once it is out of that cone.
108. **Waiting spots have nothing to land on beside them.** A quarter of one group of test players
     landed on a stall roof half a metre from the first stop's waiting ring and stood there while
     rides passed underneath. A spot now needs nothing standing higher than a step within 1.6 m.
109. **Chalk lines do not survive a change to the movement rules, and the format version does not
     change before release.** A line is a recording of inputs; the foot rule changed what inputs
     do, so lines recorded on earlier test builds replay differently. Nothing has shipped, so
     `CHALK_VERSION` stays 1. After release, any change to `src/sim` that alters movement must
     bump it, so old codes are refused with a reason rather than replayed wrong.
110. **Left for a thumb:** a faint pop is possible where a far chunk's near corner arrives at
     about two-thirds haze; the hill station deck cannot be reached standing from the lawn east
     of its run-in steps; stair edges are low in contrast at night. All three are in PLAYTEST.

## M6k — The city is lit at night

111. **Night lights are added geometry, baked into the chunks.** The check found almost nothing lit
     at night. The cause was not the lit share (about half the facade windows were already lit) but
     where windows were: a facade's window grid starts from the highest ground along the face, so a
     terraced building beside a stepped street had none on its street side, the far level of detail
     had no glow at all, warehouses had no windows, and from up the hill the camera mostly sees
     roofs. Added, after the unchanged day dressing (`src/render/dress/lights.ts`): windows laid
     from the ground under each column down a slope, 0.3 m glass roof lanterns on flat roofs (under
     the roof clutter limit, so roofs stay rideable), warehouse clerestories, shed windows and stall
     lanterns; the far box carries the lit glass of the same windows at exactly the near glass's
     place, so a LOD swap moves no light. About 57 % of window panes are lit, chosen by `hash2`.
     The new windows show by day too (as dark glass). No street lamps were added: the world has no
     lamp posts and DESIGN names none on the spine; the views that still show no lit window (the
     Terraces terrace, the Antenna and the container yard) have no building in them.
     `tests/unit/nightLights.test.ts` holds the shares and checks the day dressing against hashes
     recorded before the change.

## M7 — After the first human playtest

112. **The first thumb said it feels clunky, slow and bad**: objectives confusing, the city empty
     and bland, the UI overwhelming, and play as short bursts of dull movement between being
     dragged slowly by vehicles and crawling at walking pace looking for speed. Every check before
     this was a bot or a screenshot; none of them measured whether it was fun. Measured afterwards
     on an ordinary descent of the spine (the best case: always downhill): mean speed off a ride
     7.8 m/s, above 14 m/s 6 % of the time, mean speed on a ride 5.0 m/s. Rides cruise at 2.2 to
     13 m/s, pumping topped out at 2.6 m/s, and the main way down the hill is stairs with drag
     chosen to be unpleasant. Items 113–115 are the first answer; rides, the city's life, goals
     and the HUD follow.
113. **A resting thumb never brakes; pulling down does.** Item 77 (and 107) stopped the board
     whenever a still finger rested on the glass below 7 m/s with no ride ahead. In a one-thumb
     game the thumb rests on the glass, so players were stopped at the spawn and every time they
     slowed, with nothing to tell them why: most of "crawling at 1 mph". Superseded: the brake is
     now a deliberate gesture, the finger pulled down `BRAKE_PULL_PX` from where it landed (or the
     down arrow), at any speed, braking at `FOOT_BRAKE` and holding on a slope. Hold is only ever
     a hand out for a ride. `InputFrame` gains `brake`.
114. **Twice as fast.** Stairs no longer punish (`STAIR_DRAG` 0.85 → 0.35) and rails pay
     (`GRIND_ENTRY_BOOST` 1 → 3.5); less rolling and air drag; carving turns harder
     (`TURN_RATE_MAX` 2.4 → 3.0, `LAT_ACCEL_MAX` 10 → 18); reach is longer (`HITCH_REACH` 4.5 →
     6.5 m); any release throws you at 11 m/s or more (`SLING_MIN` 6.5 → 11, `SLING_GAIN` 1.14 →
     1.2), so even a slow ride is a slingshot; walls bail only above 20 m/s and a bail lasts 0.9 s.
     The same descent now averages 13.4 m/s, above 14 m/s 34 % of the time.
115. **Pumping is real.** Carving back and forth drives the board up to `PUMP_SPEED_CAP` 7 m/s
     (was 2.6), on the flat and downhill only: it fades to nothing by a rise of `PUMP_UPHILL`
     (6 %). This keeps the rule that matters (no push button; to go up the hill you hitch) while
     ending the dead state where a stalled skater could not get anywhere. If the owner reads "no
     push" more strictly than this, lower the cap.

116. **Second verdict: it looks bad, speed is not fun or rewarding, the city is not fun to explore.**
     Full-size frames showed why: two-thirds of the screen was flat untextured ground under a high
     camera (nothing streams past, so no speed reads at any speed); cream roofs merged into cream
     walls with no line between them; and the city is open terraces looked down on, with nothing
     beside or above the skater. The look and camera answer is item 117; the city answer is a new
     district built as a street canyon with braided lines (brief `m7e-barrio`), played and judged
     by the owner before it is rolled out to the rest of the hill.
117. **The print gets a key plate, the ground gets a texture, the camera gets down.** Ink outlines
     wherever the scene steps in depth, drawn in the print pass from the depth buffer, fading out
     by the haze. Pavers on anything walkable and courses on walls, printed by the world's ink
     shader from world position (no geometry), fading before they shimmer: the ground now streams
     under the board. Clouds and a haloed sun in the sky; a little more saturation; half the
     misregistration (wide, it read as a blurred screen). The camera sits lower and closer
     (`CAM_HEIGHT` 4.2 → 2.9, `CAM_DIST` 6.4 → 5.4), is wider (`CAM_FOV` 76 → 80, +16 at speed),
     rolls into carves (`CAM_BANK`), and paper streaks rush out from the heading above
     `CAM_STREAK_SPEED`.

118. **Flow: skating well is how you go fast.** Nothing rewarded speed or tricks. Now a grind, a
     wallride, an awning bounce, a jump that stays up (`FLOW_AIR_TIME`), a sling and a catch each
     add to a line if the last one was within `FLOW_WINDOW`; the four done on the board kick it
     faster (`FLOW_KICK`, growing by `FLOW_KICK_STEP` per trick up to `FLOW_CAP`), and a line in
     progress sheds drag (`FLOW_HOLD` per trick), so speed earned is speed kept. The same rail or
     the same kind of trick twice running does not count (`FLOW_REPEAT`), a bail ends the line,
     and the clock stops while towed. The ride chain (the original design's, which gates the
     summit) is untouched and runs alongside. The sim raises `flow` and `flowEnd`; showing and
     sounding them is the HUD and audio's job (brief `m7d`).

119. **The strap is thrown, not reached with** (owner: "latch onto vehicles from further away").
     `HITCH_REACH` 6.5 → 14 m. A catch from beyond `HITCH_SIGHT` (5 m) needs a clear line to the
     grab point (no catching a tram through a house); the strap then reels the skater in at
     `REEL_RATE` 14 m/s (was 3.5), which is a burst of speed in itself. A wall now makes the
     strap slip by how far it has stretched it (`ropeSlack`), not by how long the strap is, since
     a long throw starts long. Vertical reach is unchanged, so the blimp still needs its hop.
120. **Transport every 20 to 30 seconds** (owner: "denser and more frequent public transport").
     The city's ground lines are faster and far more numerous: forklifts 3 → 9 at 11 m/s, fish
     trucks 2 → 6 at 13, mopeds 4 → 6 at 14, handcarts 3 → 6 at 8 (were 3.5), funicular 2 → 4 at
     14, tram 5 3 → 12 at 15, tram 9 2 → 6 at 14, night bus 2 → 4 at 20; 70 vehicles in all,
     were 36. Headways at a stop: 20–30 s, were 36–120 s. Most ground lines now run the whole
     working day (`HOURS.dawnDusk`), tram 9 all day. The cable cars, kites and the secret lines
     keep their timing: the summit chain depends on it. The meetings, the conductor and errand
     limits, the new-game clock and the scripted runs are found again by task M7a. Worst view:
     96 draw calls (was 71), 155k triangles.

## Cut

What the original design promised and the game does not have, or has smaller, with why.

- **Standing on vehicle roofs.** It needs moving-platform support in the controller; a roof bounces
  you instead, which keeps a chain alive and is the better trick (14).
- **Real shadow maps.** A second scene pass per frame on a phone, and smooth shadows fight the flat
  printed look; faces turned from the sun get halftone dots and moving things get blob shadows (8).
- **The Capacitor native shell.** Not built, by instruction. `dist/` is ready for it (relative URLs,
  nothing assumes a browser chrome) and the README has the commands.
- **Online sharing of chalk lines.** Local only by design: no backend. A line is shared as a text
  code or a `?chalk=` link that someone else pastes or opens.
- **An automatic quality governor.** DESIGN once said the print pass "may be dropped by the
  governor"; nothing measures frame time on the device. The print pass is a setting the player turns
  off, and the pixel ratio is capped at 2.
- **No on-screen buttons at all.** Four corner buttons open the map, chalk, ledger and pause screens
  (101); play itself has none.
- **Six trams on tram 5.** Six stood on each other at the terminus; three trams at 13 m/s give one
  every two minutes (44, 55).
- **A six-step lesson.** Onboarding teaches four steps (carve, hitch, ink, sling); hop and grind are
  situational hints, with chain and roll (71, 88).
- **The blimp as a pass "off the timetable".** It is one timetabled lap a day from the hill station,
  so it can be caught and finished (61, 94).
- **Gating the one-step frame p95.** Headless Chromium has too few one-step frames for a meaningful
  p95; it is reported, not gated (66).
- **Every errand and challenge played by a bot in the repository.** Four errands and two conductor
  challenges are played end to end in `tests/sim/content.test.ts`; the rest are proved feasible from
  geometry and the timetable (51).
- **Real-device numbers.** GPU frame time, heat, haptics, install flow and the sound have only been
  judged by measurement here; they are the top of `docs/PLAYTEST.md`.
