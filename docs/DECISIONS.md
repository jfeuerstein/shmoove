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
