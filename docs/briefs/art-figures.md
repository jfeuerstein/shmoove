# Art: the rider, the horde and the bosses

Model: opus. Read `docs/briefs/art-common.md` first (it is the contract), then `docs/PITCH.md`
sections 5 and 6, `src/render/moverView.ts`, `src/render/hordeView.ts`, `src/render/look.ts`,
`src/sim/world.ts` (`KINDS`, `Horde`, marks, elites), `src/sim/bosses.ts` (boss phases),
`src/sim/stats.ts` and `src/sim/arsenal.ts` (passives), their unit tests, and
`tests/e2e/routes/horde.mjs`, `arsenal.mjs`, `boss.mjs`.

## Goal

The rider is a character you would put on the app icon, and every enemy is a creature with a
personality you can read from its shape and the way it moves.

## You own

`src/render/moverView.ts`, `src/render/hordeView.ts`, their unit tests, and screenshots added to
`tests/e2e/routes/horde.mjs` and `boss.mjs` (add a new route `tests/e2e/routes/figures.mjs` for
close-ups if that is easier; the test hook can `place` the rider and `setClock`).

## What to build

**The rider.** A skater with a character: helmet or cap, a face or visor, hands, shoes, a board
with a deck, trucks and four wheels that turn with speed. Poses that blend, not snap: pushing
(a foot comes off and pushes while the stick is held on the flat), coasting crouch, carving lean
into the turn, the ollie (pop, tuck in the air, land and absorb), grinding (already there: keep
it reading as a grind), hurt (a flinch on `FX_PLAYER_HIT`/invulnerable blink), and a wipe-out when
the run ends dead. A loose bit that trails with speed (scarf, hoodie strings or hair) sells
motion more than anything else: one such bit.

**Passives the board carries, visible on the rider:** Wax (a shine or streak under the board),
Springs (coils under the trucks), Wings (small wings on the board or shoes), Magnet (a
horseshoe on the back or a faint ring at pick-up range), Heart, Hide (pads or plating), Might,
Haste, Regen, Luck, Wide Load: each carried passive shows as one small readable part or mark,
growing a little with its level. Eleven small things, not eleven systems; skip any that cannot
be made to read and say which.

**The seven enemies.** Keep each one's silhouette idea (they are described at the top of
`hordeView.ts`) and make it a creature: a face, limbs or their stand-in, two or three tones, a
way of moving that suits it (the shuffler lurches, gnats buzz and bob, the bollard waddles, the
cutter skates low and leans, the lobber winds up before a lob, the sludge oozes and stretches,
the clinger scuttles and, latched, hangs on the rider's back kicking). The rise out of the
ground and the hit flash stay. Elites: more than bigger and white; a crown, horns or armour in
the aura's colour, so an elite reads as "the leader" of its kind.

**The three bosses.** Each a proper character at its size: the Bruiser a bull of a thing whose
tell is in its body (head down, pawing, leaning along its aim) and whose charge stretches it;
the Mortar a walking gun whose tube recoils when it fires a volley; the Standstill a monolith
with something alive in it (an eye that tracks the rider, plates that open when a ring goes
out). Their health can show: a boss under a third of its health looks damaged.

## Acceptance

1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run e2e` pass.
2. Close-up screenshots: the rider in each pose; the rider carrying all eleven passives at level
   5 and at level 1; each enemy alone at 5 m and a mixed crowd at 30 m; an elite of each aura;
   each boss, and the Bruiser mid-tell.
3. At 30 m in the crowd shot, a stranger could count the kinds. Say honestly which two are
   closest to being confused.
4. Triangle counts per model and the perf scene's draw calls and triangles, in your report.

## Return

Summary, decisions, what is still weak, per-model triangle counts, perf numbers, commands with
pass/fail, changed files, branch and last commit.
