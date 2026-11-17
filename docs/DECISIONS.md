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

25. **Steer is quantised to 255 levels for everyone, always** (`Game.step`), so a recording is exact
    and play never differs depending on whether one is running.
26. **A chalk line starts from a canonical state** (position, heading, speed on the ground; timers
    reset), so a share code needs four numbers for its start rather than the whole skater.
27. **A race moves the clock forward** to the recorded time of day minus a three-second countdown,
    during which the city runs and both skaters wait. Without that the ghost's rides would not be
    where they were.
28. **A loop route must be skated:** the finish only counts after the player has left the finish zone.
29. **Recording refuses under a roof or awning** ("find open ground"): the canonical start places the
    skater on the highest surface at that spot.
30. **Import by link.** `?chalk=SK1-…` opens the import box pre-filled. It exists because the e2e
    harness can tap but not type, and it is a reasonable way to share a line anyway.
31. **Share-code size.** Run-length coding gives about 0.6 kB for 30 s of steady steering but about
    7 kB for two minutes of constant dragging. Open: a denser packing before ship.
32. **Camera cuts on teleport** (race start, far respawn) instead of flying across the map.
