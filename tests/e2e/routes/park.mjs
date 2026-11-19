// park: the bowl as a place. Each kind of point of interest is looked at from 8 m, with its label,
// and from 60 m, with its beacon, fresh (park-<kind>-fresh-8.png, park-<kind>-fresh-60.png), then
// used up by riding it the way a player would and looked at again (park-<kind>-spent-8.png, -60):
// crates rammed; the shrine ridden into (park-shrine-riding.png) and its cards
// (park-shrine-cards.png); the slalom's first two gates ridden and the third looked at
// (park-gate-2of5.png, labelled GATES 2/5) before the rest; the hoop ridden through off its kicker
// (park-hoop-through.png). Then a rail with the rider grinding it (park-rail.png), a boost pad
// (park-pad.png), a kicker with its hoop from behind and from the side (park-kicker.png,
// park-kicker-side.png), and three wide views of the bowl from different places that show the rim's
// dressing (park-wide-1..3.png; the route's own park.png is the first).
//
// The hook does not list the map's things, so the route works them out the way the game does: it
// loads the sim from src/ in node (vite's module runner) and places the same seed's things. The
// page is a run with the director off (`horde=0&sparks=1`): things step, nothing spawns.
import { join } from 'node:path';
import { runnerImport } from 'vite';
import { ROOT } from '../run.mjs';

const SEED = 1;
const SCREENS = join(ROOT, 'artifacts', 'screens');
/** THING_* in src/sim/world.ts, in kind order, and the names of the shots. */
const KINDS = ['crate', 'gold', 'shrine', 'gate', 'hoop', 'totem'];
const THING_HOOP = 4;
/** PHASE_CHOOSE in src/sim/world.ts; OFFER_SHRINE in src/sim/offer.ts. */
const PHASE_CHOOSE = 3;
const OFFER_SHRINE = 3;
/** A shrine opens when the rider comes within its reach (THINGS.shrineReach in src/sim/things.ts), m. */
const SHRINE_REACH = 4;
/** A hoop run starts this far behind the hoop (which stands on its kicker's top), m. */
const HOOP_BACK = 18;
const WAIT = { steerX: 0, steerY: 0, carve: true };
const FORWARD = { steerX: 0, steerY: 1, carve: true };

const call = (page, method, ...args) => page.evaluate(([m, a]) => window.__shmoove[m](...a), [method, args]);
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));

/** Put the rider at (x, z) heading `yaw` at `speed`, as the hook's `place` does. */
function placeMover(simModule, S, x, z, yaw, speed) {
  const s = S.state;
  const m = s.mover;
  const n = { x: 0, y: 1, z: 0 };
  S.terrain.normalAt(x, z, n);
  m.x = x;
  m.y = S.terrain.heightAt(x, z);
  m.z = z;
  m.nx = n.x;
  m.ny = n.y;
  m.nz = n.z;
  const hx = Math.sin(yaw);
  const hz = Math.cos(yaw);
  const hy = -(hx * n.x + hz * n.z) / n.y;
  const k = speed / Math.sqrt(hx * hx + hy * hy + hz * hz);
  m.vx = hx * k;
  m.vy = hy * k;
  m.vz = hz * k;
  m.speed = speed;
  m.heading = yaw;
  m.grounded = true;
  m.rail = -1;
  m.railCooldown = 0;
  m.airTicks = 0;
  m.hopBuffer = 0;
  m.landPending = false;
  s.viewYaw = yaw;
  simModule.copySimState(S.prev, s);
}

/**
 * The things the page's sim places for this seed (kind, position, yaw, group, in order), and a way
 * through one of its hoops: found here, on the same sim, by trying straight runs up its kicker at a
 * few speeds with no ollie. The page replays it exactly.
 */
async function thingsOf(seed) {
  const sim = (await runnerImport(join(ROOT, 'src', 'sim', 'sim.ts'))).module;
  const bowl = (await runnerImport(join(ROOT, 'src', 'sim', 'bowl.ts'))).module;
  const fixtures = (await runnerImport(join(ROOT, 'src', 'app', 'fixtures.ts'))).module;
  const b = bowl.makeBowl(seed);
  const t0 = new sim.Sim(b, { seed, horde: false }).world.things;
  const things = [];
  for (let i = 0; i < t0.count; i++) things.push({ i, kind: t0.kind[i], x: t0.x[i], y: t0.y[i], z: t0.z[i], yaw: t0.yaw[i], group: t0.group[i] });
  let hoopRun = null;
  for (const hp of things.filter((th) => th.kind === THING_HOOP)) {
    for (const speed of [14, 12, 18]) {
      if (hoopRun) break;
      const S = new sim.Sim(b, { seed, horde: true });
      fixtures.applyFixture(S, 0, 1);
      const t = S.world.things;
      const fx = Math.sin(hp.yaw);
      const fz = Math.cos(hp.yaw);
      placeMover(sim, S, hp.x - fx * HOOP_BACK, hp.z - fz * HOOP_BACK, hp.yaw, speed);
      const input = { steerX: 0, steerY: 1, carve: true, hop: false };
      for (let i = 0; i < 200 && t.state[hp.i] === 0; i++) S.step(input);
      if (t.state[hp.i] !== 0) hoopRun = { i: hp.i, speed };
    }
  }
  return { things, hoopRun, kickers: b.features.kickers, pads: b.pads, radius: b.radius };
}

/** Step n ticks, taking the first card of any offer that opens. Returns the offers seen. */
async function stepThrough(page, n) {
  const seen = [];
  for (let left = n; left > 0; ) {
    const k = Math.min(left, 10);
    await call(page, 'step', k);
    left -= k;
    const s = await call(page, 'state');
    if (s.phase === PHASE_CHOOSE) {
      if (s.offer) seen.push(s.offer.source);
      await call(page, 'pick', 0);
      await call(page, 'step', 1);
    }
  }
  return seen;
}

/**
 * Stand the rider `dist` m from (x, z), facing it from the direction `from` (yaw), and take a
 * picture. The rider is put back between steps (on a slope it would roll away, and the view would
 * turn to follow it) until the chase camera has settled behind it.
 */
async function look(page, x, z, dist, from, file) {
  const sx = x - Math.sin(from) * dist;
  const sz = z - Math.cos(from) * dist;
  await call(page, 'hold', WAIT);
  await page.evaluate(
    ([px, pz, yaw]) => {
      const h = window.__shmoove;
      // The camera eases toward the rider by the time a step covers: half a second twice is enough,
      // and from rest the rider barely rolls in that time.
      for (const n of [30, 30, 1]) {
        h.place(px, pz, yaw, 0);
        h.step(n);
        if (h.state().phase === 3) h.pick(0);
      }
    },
    [sx, sz, from],
  );
  await settle(page);
  await page.screenshot({ path: join(SCREENS, file) });
}

/** Ride at (x, z) from `back` m away at `speed`, through it. */
async function rideInto(page, x, z, yaw, back, speed, ticks) {
  await call(page, 'place', x - Math.sin(yaw) * back, z - Math.cos(yaw) * back, yaw, speed);
  await call(page, 'hold', FORWARD);
  return stepThrough(page, ticks);
}

export default {
  name: 'park',
  query: `?hook&nolesson&seed=${SEED}&horde=0&sparks=1`,
  async run(t) {
    const { page, check } = t;
    const map = await thingsOf(SEED);
    await call(page, 'pause', true);
    await stepThrough(page, 1);
    // The hoop looked at is the one there is a way through.
    const first = (kind) => (kind === THING_HOOP && map.hoopRun ? map.things[map.hoopRun.i] : map.things.find((th) => th.kind === kind));

    // The wide views first, while everything is fresh. The chase camera looks down, so the rim's lip
    // is on screen only from about 190 m away (or from high on the bank): two views across the bowl
    // from beyond the middle, and one from the bank looking along it and in.
    const R = map.radius;
    const at = (r, a) => [Math.sin(a) * r, Math.cos(a) * r];
    const [w1x, w1z] = at(55, 0.3);
    await look(page, w1x, w1z, 0, 0.3 + Math.PI, 'park-wide-1.png');
    await t.shot();
    const [w2x, w2z] = at(75, 2.4);
    await look(page, w2x, w2z, 0, 2.4 + Math.PI - 0.3, 'park-wide-2.png');
    const [w3x, w3z] = at(R - 25, 4.2);
    await look(page, w3x, w3z, 0, 4.2 + Math.PI / 2 + 0.5, 'park-wide-3.png');

    // Each kind fresh, from 8 m and 60 m, looking along its own way (a gate or hoop is approached
    // along its yaw; the rest from the bowl's middle).
    const facing = (th) => (th.kind === 3 || th.kind === THING_HOOP ? th.yaw : Math.atan2(th.x, th.z));
    for (let k = 0; k < KINDS.length; k++) {
      const th = first(k);
      check(th !== undefined, `the map has a ${KINDS[k]}`);
      if (!th) continue;
      const lookY = th.kind === THING_HOOP ? 14 : 8;
      await look(page, th.x, th.z, lookY, facing(th), `park-${KINDS[k]}-fresh-8.png`);
      await look(page, th.x, th.z, 60, facing(th), `park-${KINDS[k]}-fresh-60.png`);
    }

    // Use each one up.
    const before = await call(page, 'state');
    // Crate and gold crate: rammed.
    for (const k of [0, 1]) {
      const th = first(k);
      await rideInto(page, th.x, th.z, facing(th), 4, 8, 40);
    }
    const afterCrates = await call(page, 'state');
    check(afterCrates.tokens >= before.tokens + 5, 'the gold crate opened (its tokens)', { before: before.tokens, after: afterCrates.tokens });
    // Shrine: ridden straight into. A picture as the rider comes in, and of its cards.
    const sh = first(2);
    const shYaw = facing(sh);
    await call(page, 'place', sh.x - Math.sin(shYaw) * 16, sh.z - Math.cos(shYaw) * 16, shYaw, 9);
    await call(page, 'hold', FORWARD);
    const offers = [];
    for (let i = 0; i < 120; i++) {
      const s = await call(page, 'state');
      if (Math.hypot(s.x - sh.x, s.z - sh.z) < SHRINE_REACH + 3.5) break;
      await call(page, 'step', 1);
    }
    await settle(page);
    await page.screenshot({ path: join(SCREENS, 'park-shrine-riding.png') });
    for (let i = 0; i < 60; i++) {
      await call(page, 'step', 1);
      const s = await call(page, 'state');
      if (s.phase === PHASE_CHOOSE) {
        if (s.offer) offers.push(s.offer.source);
        break;
      }
    }
    await settle(page);
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(SCREENS, 'park-shrine-cards.png') });
    check(offers.includes(OFFER_SHRINE), 'riding into the shrine opens its boons', offers);
    await call(page, 'pick', 0);
    await call(page, 'step', 1);
    // Slalom: through the first two gates, a look at the third (its label counts them), then the rest.
    const gates = map.things.filter((th) => th.kind === 3 && th.group === first(3).group);
    const preSlalom = (await call(page, 'state')).tokens;
    for (const g of gates.slice(0, 2)) await rideInto(page, g.x, g.z, g.yaw, 2.5, 10, 20);
    await look(page, gates[2].x, gates[2].z, 10, gates[2].yaw, 'park-gate-2of5.png');
    for (const g of gates.slice(2)) await rideInto(page, g.x, g.z, g.yaw, 2.5, 10, 20);
    check((await call(page, 'state')).tokens >= preSlalom + 2, 'the slalom was cleared (its tokens)', { pre: preSlalom });
    // Hoop: the run found in node, replayed tick for tick; the picture as the rider goes through.
    const hp = first(THING_HOOP);
    const preHoop = (await call(page, 'state')).tokens;
    check(map.hoopRun !== null, 'a straight run through a hoop was found');
    const run = map.hoopRun ?? { speed: 14 };
    await call(page, 'place', hp.x - Math.sin(hp.yaw) * HOOP_BACK, hp.z - Math.cos(hp.yaw) * HOOP_BACK, hp.yaw, run.speed);
    await call(page, 'hold', FORWARD);
    let took = false;
    for (let i = 0; i < 200 && !took; i++) {
      await call(page, 'step', 1);
      const s = await call(page, 'state');
      if (s.phase === PHASE_CHOOSE) await call(page, 'pick', 0);
      took = s.tokens > preHoop;
    }
    await settle(page);
    await page.screenshot({ path: join(SCREENS, 'park-hoop-through.png') });
    check(took, 'the hoop was ridden through off its kicker (its token)');
    // Totem: rammed; the shots catch it shaking with its eyes lit, then the stump.
    const tm = first(5);
    await rideInto(page, tm.x, tm.z, facing(tm), 4, 8, 25);
    await call(page, 'hold', WAIT);
    for (const n of [30, 1]) {
      await call(page, 'place', tm.x - Math.sin(facing(tm)) * 8, tm.z - Math.cos(facing(tm)) * 8, facing(tm), 0);
      await call(page, 'step', n);
    }
    await settle(page);
    await page.screenshot({ path: join(SCREENS, 'park-totem-called.png') });
    // Real time drives the call's shaking and sinking: let it finish.
    await page.waitForTimeout(2800);

    for (let k = 0; k < KINDS.length; k++) {
      const th = first(k);
      if (!th) continue;
      const lookY = th.kind === THING_HOOP ? 14 : 8;
      await look(page, th.x, th.z, lookY, facing(th), `park-${KINDS[k]}-spent-8.png`);
      await look(page, th.x, th.z, 60, facing(th), `park-${KINDS[k]}-spent-60.png`);
    }

    // A pad, from 9 m up its fall line.
    const pad = map.pads[0];
    await look(page, pad.x, pad.z, 9, Math.atan2(pad.x, pad.z), 'park-pad.png');

    // A kicker and the hoop over it: from behind along its line, and from the side.
    const kick = map.kickers.reduce((best, k) => (Math.hypot(k.x - hp.x, k.z - hp.z) < Math.hypot(best.x - hp.x, best.z - hp.z) ? k : best));
    await look(page, kick.x, kick.z, 26, kick.yaw, 'park-kicker.png');
    await look(page, kick.x, kick.z, 18, kick.yaw + Math.PI / 2, 'park-kicker-side.png');

    // A rail with the rider on it: the longest, ridden from its run-up with a hop onto it.
    const rails = await call(page, 'rails');
    let pick = 0;
    const len = (r) => Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
    for (let i = 1; i < rails.length; i++) if (len(rails[i]) > len(rails[pick])) pick = i;
    const r = rails[pick];
    const l = len(r);
    const ux = (r.x1 - r.x0) / l;
    const uz = (r.z1 - r.z0) / l;
    const yaw = Math.atan2(ux, uz);
    await call(page, 'place', r.x0 - ux * 3, r.z0 - uz * 3, yaw, 10);
    await call(page, 'hold', FORWARD);
    let s = await call(page, 'state');
    const along = (p) => (p.x - r.x0) * ux + (p.z - r.z0) * uz;
    for (let i = 0; i < 60 && along(s) < -1; i++) {
      await call(page, 'step', 1);
      s = await call(page, 'state');
    }
    await call(page, 'hold', null);
    await call(page, 'hop');
    let on = false;
    for (let i = 0; i < 50 && !on; i++) {
      await call(page, 'step', 1);
      on = (await call(page, 'state')).rail === pick;
    }
    check(on, 'the rider grinds the rail');
    await call(page, 'step', 10);
    await settle(page);
    await page.screenshot({ path: join(SCREENS, 'park-rail.png') });
  },
};
