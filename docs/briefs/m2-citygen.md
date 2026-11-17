Your role and rules are defined in `.claude/agents/implementer.md` in this repo: read that file first and follow it exactly (ignore its YAML frontmatter). Then read `CLAUDE.md`, `docs/DESIGN.md` (sections 3, 4, 5, 9) and these contract files in full: `src/sim/world.ts`, `src/sim/lines.ts` (only for `smoothPath`/`nearestArc` and the meaning of a line path), `src/sim/slice.ts` (a small worked example of building a World), `src/sim/player.ts` (so you know exactly how the skater treats ground, solids, rails), `tests/sim/helpers.ts`.

You are the implementer for task M2-CITYGEN on SKITCH: the deterministic generator for the whole city of Santa Rampa, simulation side only (no rendering).

## Goal
`buildCity(seed)` returns the complete static World for the game (heightfield, surfaces, solids, rails, zones, district bands) plus the route geometry every ride line will later run on. It must be a great place to skate with no push button: gravity carries you down, rides carry you up. Hand-authored layout (constants and parametric layout code), with the seeded RNG used only for dressing (building heights, awning placement, crate scatter, colours/styles). Same seed = identical world.

## Files you own
- `src/sim/city/**` (entry `src/sim/city/index.ts`)
- `tests/sim/city.test.ts`
Nothing else. Do not edit `world.ts`, `lines.ts`, `player.ts`, `hitch.ts`, `constants.ts`. If a contract there blocks you, stop and report exactly what you need.

## Interface to export from `src/sim/city/index.ts`
```ts
export const CITY: {
  minX: -180; maxX: 180; minZ: -42; maxZ: 1302; cell: 3;
  /** z where each band starts: docks 0, mercado 280, terraces 600, antenna 940, top 1280 */
  bands: { docks: 0; mercado: 280; terraces: 600; antenna: 940; top: 1280 };
};
export interface RouteDef {
  /** Line id from DESIGN section 5: 'D1','D2','D3','M1','M2','M3','T1','T2','T3','T4','A1','A2','A3','S1','S2','S3'. */
  id: string;
  /** true = closed circuit (last point equals first); false = shuttle track ridden out and back. */
  loop: boolean;
  overhead: boolean;
  /** xyz triplets, already smoothed (point spacing <= 4 m). Ground routes are draped on the terrain (y = ground). Overhead routes carry the absolute height of the carriage/kite/hook. */
  path: number[];
  /** Named stops by arc position along `path` (use nearestArc). At least 2 per route, the first at s = 0. */
  stops: { name: string; s: number }[];
}
export interface City {
  world: World;               // finalized; world.lines is [] (the rides task fills it)
  routes: Record<string, RouteDef>;
  /** xyz polyline along streets from the summit down to the docks that is downhill (or level) all the way: the line a skater with no rides follows. */
  spine: number[];
}
export function buildCity(seed?: number): City;
```
Also export the vocabulary of `Solid.kind` and `Rail.kind` strings you use and what `style` means for each, as const data in `src/sim/city/kinds.ts` (the render task will dress meshes from it). Suggested kinds: building, house, warehouse, container, crate, awning, stall, wall, quay, kiosk, shed, mast, pylon, tank, platform, tower; rails: handrail, ledge, wire, pipe, guy, fence.

## World requirements
Coordinates: metres, +y up, uphill = +z, sea at z < 0. Grid: `createWorld({ seed, minX: -180, minZ: -42, cell: 3, nx: 120, nz: 448 })`. `world.bands` set from CITY.bands. Bands and character are in DESIGN section 4; details:

**Sea and quay** (z < 0): WATER surface at y ≈ 0.3 below the quay. A continuous low quay wall (solid, 0.7 m high, kind 'quay') along z ≈ 0 keeps rolling skaters out of the sea, with exactly two 10 m slipway gaps.

**Docks** (z 0–280, y 3 → about 6): genuinely flat. Any grade must be under 1.2% so a skater at rest stays at rest (rolling resistance is 0.3 m/s², gravity 20). Wide open aprons of PLAZA/STREET. Warehouses (8–12 m, big footprints), container stacks 1–3 levels of 2.6 m with stepped rideable tops, crates (1.0–1.3 m, hop-on height), a fish market hall with a low roof (3 m), the gantry crane's rail line parallel to the quay, pipes and ledges as rails (at least 25 rails).

**Mercado Steps** (z 280–600, y about 6 → 70): tight and steep. At least 8 stair streets (STAIRS surface, 25–45% grade, 6–9 m wide) broken by level landings/plazas, each flight with at least one handrail rail (0.9 m above the stair surface, starting with a 4–6 m level run-in on the landing above so a hop lands on it, ending 2–3 m past the bottom). Beside or between stairs, ramp streets (STREET, 8–14% grade, 7+ m wide) that vehicles can drive: these carry routes M1, M2 and the trams. At least 40 awnings (one-way, AWNING surface, underside 2.3–3.0 m above the ground beneath so a skater rolls under; 0.2 m thick), market stalls with 2.4 m roofs, dense 6–12 m buildings forming street walls with alleys through, a wedding plaza (flat, at least 40 x 30 m) around z ≈ 450.

**Terraces** (z 600–940, y about 70 → 150): 5–7 residential terraces, each a near-level shelf (cross-street running east-west, 1.5–3% grade along its length so skaters keep rolling) separated by retaining walls built as solids (kind 'wall', 4–7 m), linked by switchback ramp streets (STREET, 8–13%). Houses 5–9 m with flat roofs; several roofs low enough (top within 0.4–1.5 m of the street on their uphill side) to roll or hop onto from the terrace above. Laundry wires (rails, kind 'wire') spanning streets 3–5 m up, ledges on wall tops (at least 30 rails). The funicular's straight track bed (TRACK surface) climbs through this band.

**Antenna Hill** (z 940–1280, y about 150 → 230 at the summit): open GRASS/DIRT with a few paved paths (STREET) including the spine, masts (thin tall solids), dishes, sheds, and at least 12 long guy-wire rails running from mast tops down to ground anchors (steep, 30–60 m long: these are the big grinds). A hill station platform at about z 1040. The summit antenna near (0, 1262): a mast with a small platform solid on top, 4 x 4 m, top about 26 m above the summit ground: zone 'needle'. Nothing may make the needle reachable from the ground (no rail ends within 8 m of it, no solid within 6 m of its height nearby).

**Skateability rules (the important part)**
- The terrain is the truth: heightfield triangles as defined in `world.ts`. Vertical faces (retaining walls, quay, building sides) must be solids, not near-vertical terrain. No terrain cell steeper than 100% grade except deliberate banks; stairs are ramps with STAIRS surface.
- No traps. A wall across a fall line pins a skater who cannot push. Every street that runs downhill into a building or wall must turn, open onto a cross street, or end in a ramp. Courtyards and landings must have a downhill exit at least 5 m wide (or be flat docks).
- The `spine` must be continuously downhill or level from the summit to the docks on STREET/PLAZA/STAIRS surface, at least 7 m wide, never passing within 2 m of a solid.
- Streets are at least 9 m wide where a route runs on them; a ground route's centreline keeps at least 2.6 m clear of every non-one-way solid, has no grade steeper than 14% (trams, bus, trucks, mopeds, handcarts, forklifts, parade) or 45% (funicular, T1), and no corner tighter than 12 m radius (6 m for mopeds, handcarts, forklifts).
- Roofs are play space: across the city at least 60 roofs must be enterable from higher ground without a hop taller than 1.2 m (uphill side within reach, or an adjacent lower roof/crate/awning as a step).
- Totals: at most 2600 solids and 700 rails; at least 150 rails. `buildCity` must run in under 500 ms in Node.

**Routes** (geometry only; the rides task adds vehicles, speeds, timetable and liveries). One RouteDef for each of the 16 line ids in DESIGN section 5, matching the description there:
- D1 crane: overhead shuttle along the quay at about 11 m. D2 forklifts: loop round the warehouses. D3 fish trucks: loop from the fish market up a ramp street to the Mercado gate (z ≈ 300) and back.
- M1 mopeds: loop on the Mercado ramp streets. M2 handcarts: loop that descends a ramp beside stairs and returns. M3 wedding parade: loop round the wedding plaza.
- T1 funicular: straight shuttle from the top of the Mercado (z ≈ 590) up to the Antenna gate (z ≈ 950), on its own TRACK bed with a passing loop mid-way (model it as a closed circuit of two parallel tracks 4 m apart joined at the ends, like the slice does: set loop true). T2 tram 5: long loop Docks → Mercado → Terraces and back down a different street. T3 tram 9: switchback loop across the terraces. T4 night bus: long loop from the Terraces down through the Mercado to the Docks.
- A1 lower cable car: overhead loop from the top terrace (z ≈ 920) to the hill station (z ≈ 1040), 9–13 m above the ground under it. A2 summit cable car: overhead loop hill station → summit ridge (z ≈ 1230). A3 kites: overhead loop circling over the hill between z 1000 and 1200 at 12–22 m. Mark pylons as thin solids (kind 'pylon') under cable routes, not blocking streets.
- S1 ghost tram: a disused track (TRACK surface) from the Terraces down through a cut to the upper Mercado, a loop. S2 blimp: overhead loop passing over Antenna Hill at 30–45 m. S3 Cometa Rey: overhead loop over the summit that passes directly above the needle, 5–7 m above the needle platform's top.
Make chains possible: at least 8 places where two different routes pass within 12 m of each other (plan distance) at compatible heights, for example tram 5 alongside the funicular base, the lower cable car crossing over tram 9, kites crossing the summit cable car, fish truck ramp beside the mopeds. List them as zones of kind 'chain' named after the two lines.

**Zones** (ids are a contract for later tasks; `y` = ground or platform height there, `r` 4–10 m):
- kind 'spawn': `spawn` (new-game start: a lookout at the top of the Mercado Steps, on the spine, facing downhill, with a clear run of at least 40 m), `spawn_docks`, `spawn_mercado`, `spawn_terraces`, `spawn_antenna`. Set `world.spawn` to `spawn` with heading PI (downhill).
- kind 'landmark': `fish_market`, `crane_yard`, `container_yard`, `ferry_pier`, `mercado_gate`, `plaza_boda`, `clock_tower`, `spice_row`, `funicular_base`, `funicular_top`, `tram_depot`, `laundry_terrace`, `bus_garage`, `school_roof` (on a roof), `hill_station`, `radio_shack`, `kite_field`, `summit`.
- kind 'secret': `needle`, `ghost_tunnel`.
- kind 'stop': one per route stop, id `stop_<routeId>_<n>`.

## Acceptance tests (write them in `tests/sim/city.test.ts`; they must assert behaviour and would fail if the property broke)
1. Determinism: `worldHash` equal for two builds with the same seed, different for another seed; build time under 500 ms (measure with `performance.now()` in the test, which is allowed in tests).
2. Shape: band altitudes within the ranges above; docks grade under 1.2% everywhere on non-water docks terrain; counts (stair streets ≥ 8 detected as connected STAIRS regions with ≥ 25% grade, awnings ≥ 40, rails ≥ 150 with the per-district minimums above, guy wires ≥ 12 of length ≥ 30 m, solids ≤ 2600, rails ≤ 700); every zone id above exists and sits on its stated kind of place; the needle is at least 20 m above the ground and no rail endpoint or other solid top is within reach of it as specified.
3. Routes: all 16 present; loops closed; ground routes draped (|y − terrainHeight| < 0.05), within grade and curvature limits, at least 2.6 m clear of solids (sample every 2 m with `collideSolids` radius 2.6 at ground height), on STREET/TRACK/PLAZA surface; overhead routes within their height bands above `topHeight`; S3 passes 5–7 m above the needle; at least 8 'chain' zones and each really has two routes within 12 m.
4. The spine: monotonically non-increasing height from summit to docks, required width and clearance. A bot that steers toward the spine (write it in the test: steer proportional to the signed angle to a look-ahead point 12 m along the spine, clamp to ±1; no hop, no hold) starting at the first spine point reaches z < 280 in under 5 simulated minutes with zero bails. Use `new Sim(city.world, ...)`, `placePlayer`, `sim.step`.
5. No traps: from 60 seeded random points on STREET/PLAZA/STAIRS cells above the docks, a no-input skater run for 90 s never bails more than once, never ends up inside a non-one-way solid (check `collideSolids` with a tiny radius each second), stays finite and inside the world, and in at least 85% of runs either descends at least 15 m or comes to rest on ground flatter than 1.5%; none may be oscillating against a wall at the end (speed > 0.5 while net displacement over the last 10 s < 1 m).
6. Stairs and rails work in the real city: for at least 6 different handrails, a scripted skater placed on the landing above, rolling at the rail and hopping once, produces `grindStart` then `grindEnd` on that rail and exits lower than it entered.
7. Roofs: at least 60 roofs satisfy the enterable rule (implement the check geometrically in the test).
8. `npm run typecheck`, `npm run lint`, `npm test` all pass (existing tests must stay green).

Iterate on the layout until all of these hold; do not weaken a test to get there. If something in this brief is geometrically contradictory, resolve it in the direction of better skating and say so in your summary.

## Return
A short summary: the layout in a few lines (streets, where things are), numbers (solids, rails, awnings, stairs, roofs enterable, build ms, chain spots), the kind/style vocabulary, any deviation from this brief and why. The commands you ran with pass/fail. The list of changed files. No file contents. Commit on your current branch in small commits; do not push or merge.
