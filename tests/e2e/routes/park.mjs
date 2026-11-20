// park: the bowl as a place. Each kind of point of interest is looked at from 8 m and from 60 m, with
// its beacon, fresh (park-<kind>-fresh-8.png, park-<kind>-fresh-60.png), then used up by riding it the
// way a player would and looked at again (park-<kind>-spent-8.png, -60). No words are over anything:
// each thing shows what it wants itself. Crates rammed. The shrine untouched (park-shrine-untouched.png),
// circled half a lap (park-shrine-half.png: half its ring lit), and circled the rest of the way, the
// last segment ridden into facing it (park-shrine-opening.png: the ring flashing, its cards up;
// park-shrine-cards.png). The slalom before
// it is started (park-slalom-start.png: the line marching from the first gate), two gates taken and half
// the clock to the third gone (park-slalom-clock.png: half the leg's dots out), left to run out
// (park-slalom-reset.png: the banners rising, the line marching again), then ridden whole. The hoop
// from its run-in (park-hoop-runin.png: the dotted flight up the ramp and through the ring) and a
// rider ollied through it (park-hoop-through.png). The totem (park-totem-fresh-8.png: its red eyes and
// its ring) rammed. Then a rail with the rider grinding it (park-rail.png), a boost pad (park-pad.png),
// a kicker with its hoop from behind and from the side (park-kicker.png, park-kicker-side.png), and
// three wide views of the bowl from different places that show the rim's dressing (park-wide-1..3.png;
// the route's own park.png is the first).
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
/** A shrine is circled this far out, m (inside THINGS.shrineNear..shrineFar in src/sim/things.ts). */
const SHRINE_ORBIT = 6;
/** A slalom's clock, ticks (THINGS.slalomTicks). */
const SLALOM_TICKS = 300;
/** A hoop run starts this far behind the hoop (which hangs over its kicker's top), m, with an ollie this far before it. */
const HOOP_BACK = 18;
const HOOP_HOP = 5.5;
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
 * few speeds with an ollie `HOOP_HOP` m before it. The page replays it exactly.
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
      let hopped = false;
      for (let i = 0; i < 200 && t.state[hp.i] === 0; i++) {
        const m = S.state.mover;
        input.hop = !hopped && (m.x - hp.x) * fx + (m.z - hp.z) * fz > -HOOP_HOP;
        if (input.hop) hopped = true;
        S.step(input);
      }
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

/**
 * Ride round (cx, cz) at radius `r` and `speed` from angle `a0` (atan2(x, z)) through `turns` of a
 * lap, put on the circle each tick. Stops early, returning the offer's source, if an offer opens.
 */
function circle(page, cx, cz, r, speed, a0, turns) {
  return page.evaluate(
    ([cx, cz, r, speed, a0, turns, choose]) => {
      const h = window.__shmoove;
      const ticks = Math.ceil((turns * 2 * Math.PI * r) / (speed / 60));
      for (let t = 0; t <= ticks; t++) {
        const a = a0 + (t * speed) / 60 / r;
        h.place(cx + r * Math.sin(a), cz + r * Math.cos(a), a + Math.PI / 2, speed);
        h.step(1);
        const s = h.state();
        if (s.phase === choose) return s.offer ? s.offer.source : -1;
      }
      return null;
    },
    [cx, cz, r, speed, a0, turns, PHASE_CHOOSE],
  );
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
    // Shrine: untouched, half circled, then circled the rest of the way: it opens. Its cards.
    const sh = first(2);
    const shYaw = facing(sh);
    await look(page, sh.x, sh.z, 12, shYaw, 'park-shrine-untouched.png');
    const a0 = shYaw + Math.PI;
    check((await circle(page, sh.x, sh.z, SHRINE_ORBIT, 9, a0, 0.5)) === null, 'half a lap round the shrine opens nothing');
    // From 12 m, within the 25 m that keeps what is lit.
    await look(page, sh.x, sh.z, 12, shYaw, 'park-shrine-half.png');
    // On round, short of the last segment: the one just before the one where the lap began (segment k
    // covers atan2(dx, dz) from -PI + k * SEG; see shrineSector in src/sim/things.ts)...
    const SEG = (Math.PI * 2) / 12;
    const wrap = (a) => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
    // The first segment lit is where the rider is after the first tick (a0 may sit on a boundary).
    const k0 = Math.floor((wrap(a0 + 0.05) + Math.PI) / SEG);
    // Where the last segment starts, one lap on from a0.
    let lastFrom = -Math.PI + (k0 - 1) * SEG;
    while (lastFrom < a0 + Math.PI) lastFrom += Math.PI * 2;
    const rest = (lastFrom - 0.08 - (a0 + Math.PI)) / (Math.PI * 2);
    check((await circle(page, sh.x, sh.z, SHRINE_ORBIT, 9, a0 + Math.PI, rest)) === null, 'eleven twelfths of a lap opens nothing');
    // ...then straight in through that one, facing the shrine, so the picture has it and its ring.
    const b = lastFrom + SEG / 2;
    await call(page, 'place', sh.x + Math.sin(b) * 16, sh.z + Math.cos(b) * 16, b + Math.PI, 9);
    await call(page, 'hold', FORWARD);
    let opened = null;
    for (let i = 0; i < 120 && opened === null; i++) {
      await call(page, 'step', 1);
      const s = await call(page, 'state');
      if (s.phase === PHASE_CHOOSE) opened = s.offer ? s.offer.source : -1;
    }
    await settle(page);
    await page.screenshot({ path: join(SCREENS, 'park-shrine-opening.png') });
    check(opened === OFFER_SHRINE, 'the last segment of the lap opens its boons', opened);
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(SCREENS, 'park-shrine-cards.png') });
    await call(page, 'pick', 0);
    await call(page, 'step', 1);
    // Slalom: before it is started; two gates taken and half the clock to the third gone; left to run
    // out (it goes back to the start); then ridden whole.
    const gates = map.things.filter((th) => th.kind === 3 && th.group === first(3).group);
    const preSlalom = (await call(page, 'state')).tokens;
    await look(page, gates[0].x, gates[0].z, 14, gates[0].yaw, 'park-slalom-start.png');
    for (const g of gates.slice(0, 2)) await rideInto(page, g.x, g.z, g.yaw, 2.5, 10, 20);
    // About 5 ticks since the second gate; `look` steps 61 more.
    await call(page, 'hold', WAIT);
    await stepThrough(page, SLALOM_TICKS / 2 - 5 - 61);
    // Just past the gate taken, looking along the leg to the next: the dots near the rider are out.
    const leg = [gates[2].x - gates[1].x, gates[2].z - gates[1].z];
    const legLen = Math.hypot(leg[0], leg[1]);
    await look(page, gates[2].x, gates[2].z, legLen + 4, Math.atan2(leg[0], leg[1]), 'park-slalom-clock.png');
    await stepThrough(page, SLALOM_TICKS / 2 + 10);
    await look(page, gates[0].x, gates[0].z, 14, gates[0].yaw, 'park-slalom-reset.png');
    for (const g of gates) await rideInto(page, g.x, g.z, g.yaw, 2.5, 10, 20);
    check((await call(page, 'state')).tokens >= preSlalom + 2, 'the slalom was cleared after its reset (its tokens)', { pre: preSlalom });
    // Hoop: from its run-in; then the run found in node, replayed tick for tick, the ollie near the
    // lip; the picture as the rider goes through.
    const hp = first(THING_HOOP);
    await look(page, hp.x, hp.z, HOOP_BACK + 6, hp.yaw, 'park-hoop-runin.png');
    const preHoop = (await call(page, 'state')).tokens;
    check(map.hoopRun !== null, 'a run up a kicker with an ollie through its hoop was found');
    const run = map.hoopRun ?? { speed: 14 };
    await call(page, 'place', hp.x - Math.sin(hp.yaw) * HOOP_BACK, hp.z - Math.cos(hp.yaw) * HOOP_BACK, hp.yaw, run.speed);
    await call(page, 'hold', FORWARD);
    let took = false;
    let hopped = false;
    for (let i = 0; i < 200 && !took; i++) {
      const s = await call(page, 'state');
      if (!hopped && (s.x - hp.x) * Math.sin(hp.yaw) + (s.z - hp.z) * Math.cos(hp.yaw) > -HOOP_HOP) {
        hopped = true;
        await call(page, 'hold', { ...FORWARD, hop: true });
      } else await call(page, 'hold', FORWARD);
      await call(page, 'step', 1);
      const after = await call(page, 'state');
      if (after.phase === PHASE_CHOOSE) await call(page, 'pick', 0);
      took = after.tokens > preHoop;
    }
    await settle(page);
    await page.screenshot({ path: join(SCREENS, 'park-hoop-through.png') });
    check(took, 'the hoop was ollied through off its kicker (its token)');
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
