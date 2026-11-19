# M3: four more enemies, and elites

Model: opus. Read `docs/briefs/m3-common.md` first, then `src/sim/horde.ts`, `src/sim/director.ts`,
`src/sim/contact.ts`, `src/sim/sparks.ts`, `tests/sim/horde.test.ts`, `tests/sim/director.test.ts`.

## Goal

Every enemy is a question about the player's speed (PITCH section 8). The three that exist ask
"can you plow?". These four ask the others: change direction, change your line, the map changes
under you, use your verbs. And elites give the late run something to hunt or flee.

## You own

`src/sim/horde.ts`, `src/sim/director.ts`, a new `src/sim/hazards.ts`, their tests
(`tests/sim/horde.test.ts`, `tests/sim/director.test.ts`, new `tests/sim/enemies.test.ts`,
`tests/sim/hazards.test.ts`). In `src/sim/world.ts`: new entries in `KINDS` and the `KIND_*`
constants for them, nothing else. In `src/sim/sim.ts`: the `// [hazards]` line and its import. In
`src/sim/sparks.ts`: only the magnet check, for the jam aura. In `src/render/hordeView.ts`: only
what it takes for a kind with no geometry of its own to draw as the shuffler's block, scaled to
the kind's radius and height, in `PALETTE.enemies[kind]` (the real shapes are a later task; the
game must not break when your kinds spawn).

## The enemies

Numbers are starting points; keep each kind's speed below the floor of gear 3.

- **Cutter** (kind 3). Fast (10.5 m/s) and medium (plowed from gear 4), 26 health, 10 damage, 3 XP.
  It runs for where the mover will be in about 1.2 s, not where it is: straight lines get cut off.
  From 60 s, about 8% of the horde.
- **Lobber** (kind 4). Medium, 18 health, slow. It keeps 14 to 22 m from the mover and every 3.5 s
  lobs a shot: a `ZONE_LOB` 2.4 m across where the mover will be in 0.9 s, shown for 66 ticks and
  then landing. A mover inside it when it lands, on the ground or under 1.5 m up, takes
  `hurtPlayer(12)`. From 75 s, at most 8 alive.
- **Sludge** (kind 5). Slow (3 m/s), medium, 40 health. Every 4 m it travels it leaves tar: a
  `ZONE_TAR` 2.2 m across lasting 10 s, at most 24 at once. A grounded mover in tar gets 1.2 /s of
  extra drag through `w.player.cling`. From 100 s, at most 5 alive.
- **Clinger** (kind 6, `latches: true`). Small, fast (9 m/s), light, 8 health. Below its plow gear
  contact latches it (contact already sets `STATE_LATCHED` and counts `p.latched`). A latched
  clinger rides the mover, hurts nothing, and adds 0.25 /s to `w.player.cling`. One is shaken off
  by each clean hop, all by a landing with an impact of 5 m/s or more or by a loop popping
  (`FX_POP` this tick): thrown clear, stunned 60 ticks, taking 6 damage. From 120 s.
- `w.player.cling` is the sum of tar and clingers, written by your step every tick (0 when
  neither). The mover already reads it.

## Elites

From 90 s, about every 25 s, one newly spawned shuffler or cutter is an elite: 6 times the health,
8 times the XP, drawn 1.4 times as large (set `Horde.elite`; contact size is unchanged), with one
aura reaching 8 m:

- `ELITE_HASTE`: other enemies in it steer 25% faster (still under gear 3's floor).
- `ELITE_SHIELD`: other enemies in it carry `MARK_SHIELDED` that tick (the world halves their
  damage). Clear the mark when they leave or it dies.
- `ELITE_JAM`: sparks within 10 m of it are not pulled by the magnet (already-pulled sparks keep
  flying).

**Totem packs.** When `w.packs > 0`, for each requested place spawn one elite (random aura, with
`MARK_PACK`) and ten shufflers in a ring 18 to 24 m from it, outside the budget, then clear the
request.

## Acceptance

1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run e2e`, `npm run perf`
   pass (the perf fixture still draws; nothing new is in it).
2. `tests/sim/enemies.test.ts` on `arena()`, one block per kind, an assertion per clause above:
   a cutter reaches a mover running a straight line sooner than a same-speed chaser would and is
   beaten by a turn; a lobber holds its distance, its ring lands where the mover would have been,
   hurts a mover that kept its line and misses one that changed it or hopped high; sludge leaves
   tar at the stated spacing and tar slows a tucked mover by the stated drag and wears off; a
   clinger latches, drags, stacks to four, is shed one per clean hop, all by a hard landing and by
   a pop; none of them exceed gear 3's floor.
3. Elites: each aura does what it says to others and not to itself; an elite's death drops its XP;
   a pack request spawns 1 + 10 at the stated distance with the mark and is cleared.
4. `tests/sim/director.test.ts`: each kind appears from its time, in its share or under its cap,
   on seeds 1 to 3; the existing rate, floor, cap and recycling tests still pass.
5. `hashWorld` is the same every tick across two identical 60 s runs with every kind present. The
   horde and director step with 400 enemies of mixed kinds stays under 1 ms a tick in Node (assert
   under 3 ms; report it). No allocation in any step.
6. `tests/sim/balance.test.ts` will move: run it, report the table, and do not retune (a balance
   pass follows). If a band fails, say which and by how much; leave the assertion as it is.
