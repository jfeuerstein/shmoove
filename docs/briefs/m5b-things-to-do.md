You are the implementer for task M5B-THINGS-TO-DO on SKITCH: errands, conductor challenges and secrets, as game reducers with content for the real city, their UI, and their markers in the world. Read `.claude/agents/implementer.md` (your rules), `CLAUDE.md`, `docs/DESIGN.md` (sections 2, 5, 6, 7 "UI"), `docs/DECISIONS.md` (items 21–32), `docs/briefs/m2-citygen.md` (the zone ids the city provides: spawns, landmarks, secrets, stops, chain zones), then these files in full: `src/sim/game/game.ts` (the reducer interface with `key`, `exportState`, `importState`; commands), `src/sim/game/progress.ts`, `src/sim/game/chalk.ts` (a full example of a reducer with commands, events and state the UI reads), `src/sim/game/save.ts`, `src/sim/types.ts` (SimEvent), `src/sim/world.ts` (zones), `src/sim/city/index.ts` and `src/sim/city/lines.ts`, `src/ui/index.ts`, `src/ui/toasts.ts`, `src/ui/toastQueue.ts`, `src/ui/lineMap.ts`, `src/ui/chalkScreen.ts`, `src/ui/chalkHud.ts`, `src/ui/style.ts`, `src/render/chalkView.ts` (how world markers are added to `view.scene`), `src/render/skater.ts` (box figures on twos), `src/app/main.ts`, `tests/sim/chalk.test.ts`, `tests/e2e/routes/slice-chalk.mjs`. Run `npm install` first.

Commit early and often: anything not committed can vanish without warning. Commit at the end of each part and at least every 20 minutes; work-in-progress commits are fine if `npm run typecheck` passes.

## Files you own
- `src/sim/game/errands.ts`, `conductors.ts`, `secrets.ts`, `src/sim/game/content/**` (new; pure sim code), and the registration of the three reducers plus their commands and event types in `src/sim/game/game.ts`
- `src/ui/errand*.ts`, `src/ui/conductor*.ts`, `src/ui/ledger*.ts` (new), plus minimal mounting edits in `src/ui/index.ts`, new toast kinds in `src/ui/toastQueue.ts`/`toasts.ts`, and the line map legend in `src/ui/lineMap.ts` (conductor punch per line, secrets found)
- `src/render/markersView.ts` (new), wiring edits in `src/app/main.ts`
- `tests/sim/errands.test.ts`, `tests/sim/conductors.test.ts`, `tests/sim/secrets.test.ts`, `tests/sim/content.test.ts`, `tests/e2e/routes/city-errand.mjs`
Nothing else. If you need a change elsewhere, stop and report it.

## One-thumb interaction rule
There are no buttons in play. The only extra verb is: **hold still to accept.** When the skater is inside an offer's zone, not hitched, slower than 4 m/s, and the touch is armed (`hold` true) with no ride in reach, an offer fills over 0.6 s and is accepted. The HUD shows the offer as a ticket with a punch filling in. Rolling out of the zone or releasing cancels it. Only one errand can be active at a time; conductor challenges start by themselves (below).

## Part 1: errands (`errands.ts` + `content/errands.ts`)
An errand is data: `{ id, title, giver: zoneId, district, brief: string (one line, under 60 characters), limitTicks (2–4 minutes), steps: Step[] }`. Steps are checked in order; the errand is done when the last step completes inside the limit, failed when the limit passes or a step's fail condition fires. Step types (each a small pure checker over sim state and events):
- `reach { zone }`: enter the zone (plan radius, |dy| < 4).
- `hitch { line }`: be hitched to that line.
- `rideTo { line, zone }`: arrive in the zone while hitched to that line, or within 3 s of releasing it.
- `deliver { zone, maxSpeed? }`: be inside the zone on the ground, optionally slower than `maxSpeed` (fragile cargo: "don't spill the soup").
- `chain { links }`: have a chain of at least that many links at some moment.
- `grind { metres }`: accumulate that many metres of grinding since the step began.
- `air { seconds }`: a single flight of at least that long.
- Modifiers on any step: `noBail` (a bail fails the errand), `noGround { seconds }` (must be completed without more than that much ground time since the step began).
Write at least 10 errands for the city, at least two starting in each district, each with a small story in its title and brief that fits Santa Rampa (fish that must reach the Mercado before it turns, wedding rings for the parade, a spare valve for the funicular, a kite spool for the hill, soup that must not spill, a night-bus driver's forgotten keys that only matters at night, and so on), using real zone and line ids. Mix the types: several are downhill deliveries against the clock, several require a specific ride uphill, at least two require a chain of 2+, at least one a long grind, at least one must be done at a particular time of day (the giver only offers it then: `hours: [from, to]`). Each must be feasible: see the content test.
State: `offered` (id or null, with fill 0..1), `active` (id, step index, ticks left, per-step counters), `done: Record<id, { bestTicks }>`, `failedLast`. Commands: `errandAbandon()`. Events: `errandOffer { id }`, `errandStart { id }`, `errandStep { id, step }`, `errandDone { id, ticks, best }`, `errandFail { id, reason: 'time' | 'bail' | 'ground' | 'abandon' }`. Export/import state for saves (done errands and best times; an active errand is not resumed).

## Part 2: conductor challenges (`conductors.ts` + `content/conductors.ts`)
One per regular line (13). Each line's conductor stands at one of its stops (choose per line). Hitching that line within 30 m of that stop starts the challenge (if not already punched); a ticket announces it. Types:
- `chainFrom { links }`: reach a chain of N links in the chain that starts with this hitch.
- `slingDistance { metres }`: from the release of this hitch to the first ground contact, plan distance at least D.
- `slingAir { seconds }`: flight time from release to first ground contact.
- `stayOn { segments }`: stay hitched through N stops of the line without letting go.
- `stopToStop { from, to, seconds }`: release within the `from` stop zone and reach the `to` stop zone under your own momentum within the time.
- `landOn { zone }`: after releasing this hitch, the next ground contact is inside the named zone (a roof, the needle is not allowed here).
The challenge fails silently (and can be retried by hitching there again) when its condition can no longer be met: the chain ends, the skater lands, bails, or a time limit passes. Pick a type and numbers per line that suit the ride: the crane a `slingAir`, the funicular a `chainFrom 2` (it meets the tram), the handcarts a `stayOn`, the mopeds a `slingDistance`, the night bus a `stopToStop`, the kites a `chainFrom 3`, a cable car a `landOn` a named roof or platform, and so on. Numbers must be achievable but not free: derive them from the sim (for example the sling distance a full whip gives off that ride, times 0.75) and state how each was chosen.
State: `active` (line, type progress), `punched: Record<lineId, true>`. Events: `conductorStart { line }`, `conductorPunch { line }`, `conductorFail { line }`. Export/import.

## Part 3: secrets (`secrets.ts`)
Three secrets from DESIGN: `ghost` (hitch the ghost tram S1), `blimp` (hitch the blimp S2), `needle` (land in the `needle` zone). Plus `tunnel` (enter the `ghost_tunnel` zone). State `found: Record<id, tickFound>`. Event `secretFound { id }`. Export/import. The needle secret needs no special-casing of the chain: the only way up is S3, which the sim already gates.

## Part 4: UI
Same printed look as the existing UI (ticket stubs, destination boards, on twos via `twos.ts`).
- **Offer ticket**: slides up at the bottom when an errand is offered: title, brief, time limit, a punch circle filling as the hold is kept; a line "HOLD TO TAKE".
- **Active errand ticket**: a compact stub under the destination board: title, current step as a short imperative ("RIDE TRANVÍA 5 TO THE CLOCK TOWER", "GRIND 40 M"), a progress figure where there is one, and the time left m:ss, turning pink under 20 s. Done: a stamped ticket ("DELIVERED", time, "NEW BEST"); failed: a torn one with the reason.
- **Conductor ticket**: when a challenge starts, a ticket in the line's livery with the conductor's line badge and the task in one line; a small progress chip while it runs; a punch animation and `sound.ui('punch')` on success.
- **Ledger screen** (pauses play, opened from a third button under the chalk button): three tabs as board rows: ERRANDS (each as a stub: title, giver's district, best time or "—", stamped when done; undone ones show where to find the giver), CONDUCTORS (13 rows with line badges, the task, punched or not), SECRETS (four rows; unfound ones show only "?????" and a hint that does not spoil: "runs when the trams sleep", "off the timetable at dusk", "above the summit", "where the old track goes dark"). A header with totals. The line map legend gets a conductor punch mark per line and the map header a secrets count.
- Toast kinds: 'errand-done', 'errand-fail', 'conductor', 'conductor-punch', 'secret'.
- `Ui.testState()` additions: `errandOffered` (id or ''), `errandOfferFill` (0–100), `errandActive` (id or ''), `errandStep` (index, -1 none), `errandLeft` (seconds), `errandsDone` (count), `conductorActive` (line id or ''), `conductorsPunched` (count), `secretsFound` (count), `ledgerOpen`, `ledgerTab`, and the centres of the ledger button and tabs like the chalk controls.

## Part 5: world markers (`src/render/markersView.ts`)
`createMarkersView(scene, world, game): { update(game, alpha, dt): void; dispose(): void }`. With `MeshBuilder` and `inkMaterial()`, box figures in the skater's style, animated on twos with two-frame geometry swaps, never rebuilt per frame; only markers within 150 m of the skater are visible:
- Errand givers: a standing figure at each giver zone holding up a ticket (mango), waving on twos; grey-blue and still when their errand is done or not on offer at this hour.
- Conductors: a figure in a cap and coat in the line's livery base colour with a stripe, at their stop, holding a ticket punch; they tip the cap (a second frame) once punched.
- The active errand's current target: a tall thin beacon post with a pink ring at its foot (like the chalk finish ring) and a flag on top visible over roofs, at the target zone; for `hitch`/`rideTo` steps, the beacon is at the nearest stop of that line.
- Draw calls: at most 6 for all markers (merge figures per type or use a few instanced meshes).

## Acceptance tests
1. `tests/sim/errands.test.ts`, on small synthetic worlds (`flatWorld`, `testLine`, zones added by hand) and scripted state: every step type completes when its condition is met and not before; each modifier fails the errand correctly; the time limit fails it; the hold-to-accept rule (fills only while in zone, slow, armed, not hitched; cancels on leaving; nothing is offered while another errand is active or outside the errand's hours); `errandAbandon`; best time only improves; events fire once each in order; state round-trips through export/import; two games fed the same inputs stay identical (determinism).
2. `tests/sim/conductors.test.ts`: each challenge type punches when achieved and fails/retries as specified; starting requires hitching the right line near the right stop; a punched line never restarts.
3. `tests/sim/secrets.test.ts`: each secret fires once on its condition; saves round-trip.
4. `tests/sim/content.test.ts` on the real city (`buildCity()`): every errand and challenge references existing zones, lines and stops; counts and district spread as specified; limits within 2–4 minutes; feasibility: for each errand, a lower bound on the time needed, computed from the geometry (straight-line distances between consecutive targets divided by a generous speed, plus timetable waits for required rides from `ticksToArrival` at the offered hours), is under 70% of its limit; every `rideTo`/`hitch` line actually serves a stop within 40 m of where the step needs it and runs during the errand's hours; every downhill delivery ends lower than it starts; every conductor's stop belongs to their line. Then play at least three errands for real with scripted closed-loop skaters (steer toward a point, arm the hold near a wanted vehicle, release at a stop): one pure downhill delivery, one that rides a line uphill, and one conductor challenge; assert `errandDone` / `conductorPunch`.
5. `tests/e2e/routes/city-errand.mjs`: in the city at the new-game spawn (or with a `t=` and spawn that puts a giver within easy reach; say which), roll into a giver's zone, hold to accept (screenshot `errand-offer` mid-fill and `errand-active` after), open the ledger (screenshots of each tab), close. Assert through `state.ui`. Keep it short and deterministic. If the city world view is not yet the default in your tree, write the route against whatever `?world=city` renders and say so.
6. Open every screenshot with the Read tool and iterate until it matches the existing UI's look; describe each in your summary.
7. `npm run gate` green.

## Return
A short summary: the errand table (id, title, district, steps in words, limit, feasibility bound), the conductor table (line, stop, type, number, how the number was chosen), what each screenshot shows, deviations and why. Commands run with pass/fail. Changed files. No file contents. Commit on your current branch; do not push or merge.
