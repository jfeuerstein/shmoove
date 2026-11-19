# M3: what every M3 brief shares

Read `docs/briefs/README.md`, `docs/briefs/m2-common.md` (the world's rules still hold) and
`docs/PITCH.md` sections 2, 6, 7, 8 and 9 first.

## What M3 adds to the core (lead-owned; read, do not edit, unless your brief names a line)

- `src/sim/arsenal.ts`: weapon and passive ids, their names and card text, the `Loadout` (four
  weapons, four passives, levels by id: `p.loadout.weaponLevel[W_SLAM]`, 0 = not carried).
- `src/sim/stats.ts`: `Stats` on `w.player.stats`, worked out from the build. Everything that hits
  multiplies by `powerOf(w.player.stats, mover.gear)`; everything with a size multiplies by
  `w.player.stats.area`. `MoverMods` on `SimState.mods` is what the build does to movement.
- `src/sim/build.ts`: the only place the loadout changes. `setWeaponLevel` / `setPassiveLevel`
  (tests, fixtures), `queueOffer(w, source)`, `openOffer`, `pickCard`.
- `src/sim/offer.ts`: what an offer is (`w.offer`: up to three cards, each a type, an id and a
  `by`), `CARD_*`, `BOON_*`, `OFFER_*` sources.
- `src/sim/weapons/index.ts`: the weapon registry. A weapon is `{ id, step?(w, s, terrain, level) }`
  run once a tick while carried, after contact and before the reap: indices are stable, the grid is
  fresh, `s.events` holds what the mover did this tick (`EV_HOP`, `EV_CLEAN_HOP`, `EV_LAND`), and
  `s.mover.lastAir` / `impact` describe the landing. A weapon that is not registered is never
  offered.
- `src/sim/world.ts` additions: `PHASE_CHOOSE` (an offer is open; nothing steps); `w.zones`
  (`addZone` / `removeZone`: mines, tar, lob rings; whoever makes a kind of zone steps and removes
  it); `w.shots` now has a `kind` (`SHOT_DART`, `SHOT_STONE`) and `aux`, and `removeShot` (whoever
  makes a kind of shot flies and removes it; `seekers.ts` flies only darts); `w.things` (map
  objects); `w.mem` (`WEAPON_MEM` numbers per weapon id, zeroed at the start of a run:
  `w.mem[id * WEAPON_MEM + k]`); `Horde.elite` / `state` / `timer`; `MARK_SHIELDED`, `MARK_PACK`;
  `w.player.cling` (extra drag on the mover, 1/s) and `latched`; `w.packs` (places a totem asked
  for a pack); new `FX_*` types (`FX_SLAM`, `FX_ARC`, `FX_BLAST`, `FX_HEAL`, `FX_CARD`, `FX_THING`,
  `FX_TOKEN`, `FX_STONE`).
- `Sim`: `new Sim(terrain, { seed, horde: true, autoPick: true })` answers offers at once with the
  first card (or pass a function); without `autoPick` the world holds at `PHASE_CHOOSE` until an
  `InputFrame` carries `pick`. `arena()` in `tests/sim/world-fixtures.ts` auto-picks.
- `src/render/look.ts`: colours for everything M3 adds are already in `PALETTE`.

## Rules (on top of the M2 ones)

- Numbers live in one exported table per file, by level 1..5 where a level applies.
- A weapon reads its level from the argument, its strength from `powerOf`, its size from
  `stats.area`. It never changes the loadout or the stats.
- Hurt the player only through `hurtPlayer` (`src/sim/contact.ts`). Give health only by adding to
  `p.hp` up to `p.maxHp`, with `FX_HEAL`.
- If two tasks need the same marked line in `src/sim/sim.ts`, each replaces only its own.
