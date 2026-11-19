# M3: the drive-through map

Model: opus. Read `docs/briefs/m3-common.md` first, then `docs/PITCH.md` section 9, the interface
and `layout` of `src/sim/bowl.ts`, `tests/unit/bowl.test.ts`, `src/sim/contact.ts`,
`src/sim/build.ts`, `src/sim/offer.ts`.

## Goal

Nothing on the map makes the player stop. Crates are rammed open, shrines are orbited, slaloms are
ridden, hoops are flown through, totems are rammed to call a fight. They sit off the natural
circuits so that going for one is a decision.

## You own

A new `src/sim/things.ts` and `tests/sim/things.test.ts`. In `src/sim/bowl.ts`: a `sites` list on
`BowlFeatures` and the code that chooses it (the heightfield itself must not change: every existing
bowl test must pass unchanged and the same seed must give bit-identical heights). In
`tests/unit/bowl.test.ts`: tests for the sites. In `src/sim/sim.ts`: the `// [things]` line and its
import, plus placing the things from the terrain's sites when a run starts and on `reset` (the
`Sim` constructor and `reset()`; a terrain that is not a bowl has none).

## Sites (`bowl.features.sites`)

`{ kind, x, z, yaw, group }[]`, chosen from the seed after the layout is accepted, on the floor
(r < 125), on slope under 0.35, at least 14 m from the spawn, from boost pads and from each other
(gates of one slalom excepted):

- 12 crates and 2 gold crates, at least 25 m apart from one another, at least half of them more
  than 20 m from the nearest pipe axis and the crater (off the circuits).
- 2 shrines on open ground with room for a 7 m circle round them.
- 2 slaloms: 5 gates each, 18 m apart along a line that runs downhill on average, alternating
  3 m either side of it; each gate faces along the line; one `group` per slalom.
- 1 hoop for each of up to 4 kickers: 3 m above the kicker's top, 5 m along its `yaw`.
- 2 totems, at least 60 m apart.

## Things (`stepThings(w, s, terrain)`), from PITCH section 9

- **Crate.** Touched (within 1.4 m) in gear 2 or better, counting plow grace (`p.graceGear`), it
  breaks. Reward, rolled with `w.rng`: 50% a card (`queueOffer(w, OFFER_CRATE)`), 20% a heal of 25,
  15% every spark on the map pulled, 15% a bomb (60 x `powerOf` to every risen enemy within 22 m,
  `FX_BLAST`). Luck shifts the split toward the card. Below gear 2 it only rattles (`FX_THING`, at
  most once a second). **Gold crate**: needs gear 4; gives a card and 5 tokens.
- **Shrine.** Riding round it inside a ring 4 to 11 m from it, the angle swept in one direction
  adds up; three full laps within 10 s of the first degree finish it:
  `queueOffer(w, OFFER_SHRINE)`. Reversing or leaving the ring starts the count again. `progress`
  holds laps so far, for the renderer.
- **Slalom.** Crossing a gate's line between its posts (3 m either side of its centre, in either
  direction) clears it. Gates clear in order; the clock starts at the first and each next gate
  must come within 2.4 s. All five: 12 XP straight to `p.xp` and 2 tokens. A miss resets that
  slalom after 3 s. `state` shows which gate is next.
- **Hoop.** An airborne mover passing within 1.6 m of its centre takes it: 1 token, plus 1 more for
  each hoop taken in the 20 s before it. A hoop comes back after 20 s.
- **Totem.** Touched in any gear: it is spent, and `w.packX/Z[w.packs++]` asks the director for a
  pack there (if there is room for the request). When an enemy carrying `MARK_PACK` appears in
  `w.deaths`, `queueOffer(w, OFFER_TOTEM)`.
- Every use emits `FX_THING` with the kind; tokens emit `FX_TOKEN`; heals `FX_HEAL`.
- Spent things stay in `w.things` with `state = THING_DONE` (the renderer shows them spent).

## Acceptance

1. `npm run typecheck`, `npm run lint`, `npm test` pass; every existing bowl test passes unchanged.
2. `tests/unit/bowl.test.ts` for seeds 1 to 5: counts, spacing, slope, the off-circuit rule, slalom
   geometry (spacing, alternation, downhill on average), hoops over kickers, deterministic, and
   heights bit-identical to before your change (compare a few hundred sampled heights against
   values you record from the current code before you touch it).
3. `tests/sim/things.test.ts` on a small hand-made world (`arena()` plus things placed by hand):
   an assertion for every clause above, including the gear rules and grace, each crate reward (force
   the roll by seeding or by a test hook you keep out of the game path), the lap count (three laps
   yes; two and a half no; a reversal resets; too slow resets), gate order and timing, the hoop
   streak and its return, the totem's request and its reward on the marked death.
4. With a real bowl and a bot that rides at the nearest unspent thing, every kind of thing can be
   used within 3 minutes on seeds 1 to 3 (they are reachable and the rules are satisfiable on real
   terrain).
5. Deterministic (`hashWorld` twice over a 60 s run that uses things). No allocation in the step.
