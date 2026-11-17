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
