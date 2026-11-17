import { describe, expect, it } from 'vitest';
import { FEEL } from '../../src/sim/constants';
import { grabPoint, makeVehicleState, vehicleAt } from '../../src/sim/lines';
import { PI } from '../../src/sim/math';
import type { Sim } from '../../src/sim/sim';
import { Mode, type SimEvent } from '../../src/sim/types';
import { flatWorld, hSpeed, newSim, run, runUntil, seekVehicle, seekWhen, teleport, testLine } from './helpers';

const TRAM = 0;
const FUNI = 1;
const vs = makeVehicleState();
const gp = { x: 0, y: 0, z: 0 };

/** Stand beside the up lane just ahead of tram 0 as it climbs past z = 60, touch armed. */
function waitForTram(): Sim {
  const sim = newSim();
  seekVehicle(sim, TRAM, 0, 60, 1, 60);
  teleport(sim, -1.5, 62, 0, 5);
  return sim;
}

/** Hold until hitched, keep holding `holdTicks` more with `steerFn`, then release and coast. */
function towAndRelease(
  holdTicks: number,
  steerFn: (k: number) => number = () => 0,
  after = 90,
  hopRelease = false,
): { sim: Sim; events: SimEvent[]; release: Extract<SimEvent, { type: 'release' }>; vx: number; vy: number; vz: number; pre: { vx: number; vz: number } } {
  const sim = waitForTram();
  const events: SimEvent[] = [];
  let hitchedAt = -1;
  let release: Extract<SimEvent, { type: 'release' }> | null = null;
  let v = { vx: 0, vy: 0, vz: 0 };
  let pre = { vx: 0, vz: 0 };
  let since = 0;
  for (let i = 0; i < 2000; i++) {
    const k = hitchedAt < 0 ? -1 : i - hitchedAt;
    const letGo = k >= holdTicks;
    if (!release && !letGo) pre = { vx: sim.player.vx, vz: sim.player.vz };
    sim.step({ steer: k >= 0 && !release ? steerFn(k) : 0, hold: !letGo && !release, hop: hopRelease && k === holdTicks });
    for (const e of sim.events) {
      events.push(e);
      if (e.type === 'hitch' && hitchedAt < 0) hitchedAt = i;
      if (e.type === 'release' && !release) {
        release = e;
        v = { vx: sim.player.vx, vy: sim.player.vy, vz: sim.player.vz };
      }
    }
    if (!release && k >= 0 && k < holdTicks) pre = { vx: sim.player.vx, vz: sim.player.vz };
    if (release && ++since > after) break;
  }
  if (!release) throw new Error('never released');
  return { sim, events, release, ...v, pre };
}

describe('hitching', () => {
  it('an armed touch latches onto the tram as its bumper comes past', () => {
    const sim = waitForTram();
    const t = runUntil(sim, 600, (s) => s.player.mode === Mode.HITCH, () => ({ hold: true }));
    expect(t).toBeGreaterThan(0);
    expect(sim.events.find((e) => e.type === 'hitch')).toMatchObject({ line: TRAM, vehicle: 0, chain: 1, newLink: true });
    // Grabbed from beside or behind the bumper, never from in front of it.
    vehicleAt(sim.world.lines[TRAM], 0, sim.tick, vs);
    grabPoint(sim.world.lines[TRAM], vs, gp);
    const ahead = (sim.player.x - gp.x) * vs.hx + (sim.player.z - gp.z) * vs.hz;
    expect(ahead).toBeLessThan(FEEL.HITCH_AHEAD + 0.5);
  });

  it('without an armed touch the tram just goes by', () => {
    const sim = waitForTram();
    const ev = run(sim, 600);
    expect(ev.some((e) => e.type === 'hitch')).toBe(false);
    expect(sim.player.mode).not.toBe(Mode.HITCH);
  });

  it('a towed skater inherits the ride: climbs with it, trailing by the rope', () => {
    const sim = waitForTram();
    runUntil(sim, 600, (s) => s.player.mode === Mode.HITCH, () => ({ hold: true }));
    run(sim, 90, () => ({ hold: true }));
    const y0 = sim.player.y;
    const z0 = sim.player.z;
    let sumVz = 0;
    let n = 0;
    run(sim, 240, (s) => {
      sumVz += s.player.vz;
      n++;
      return { hold: true };
    });
    vehicleAt(sim.world.lines[TRAM], 0, sim.tick, vs);
    grabPoint(sim.world.lines[TRAM], vs, gp);
    expect(sim.player.mode).toBe(Mode.HITCH);
    expect(sumVz / n).toBeGreaterThan(vs.vz * 0.9);
    expect(sumVz / n).toBeLessThan(vs.vz * 1.1);
    expect(sim.player.z - z0).toBeGreaterThan(30);
    expect(sim.player.y - y0).toBeGreaterThan(3.5);
    expect(Math.hypot(sim.player.x - gp.x, sim.player.z - gp.z)).toBeCloseTo(sim.world.lines[TRAM].rope, 3);
    // Behind the tram, not in front of it.
    expect((sim.player.x - gp.x) * vs.hx + (sim.player.z - gp.z) * vs.hz).toBeLessThan(0);
  });

  it('the strap takes up slack smoothly: no teleport at the catch', () => {
    const sim = waitForTram();
    let px = sim.player.x;
    let pz = sim.player.z;
    let worst = 0;
    run(sim, 400, (s) => {
      worst = Math.max(worst, Math.hypot(s.player.x - px, s.player.z - pz));
      px = s.player.x;
      pz = s.player.z;
      return { hold: true };
    });
    expect(sim.player.mode).toBe(Mode.HITCH);
    // Never moves more in one tick than the fastest whip allows.
    expect(worst).toBeLessThan((9 + FEEL.SWING_OMEGA_MAX * 4.5) / 60);
  });

  it('the swing keeps itself alive, so there is always a release to time', () => {
    const sim = waitForTram();
    runUntil(sim, 600, (s) => s.player.mode === Mode.HITCH, () => ({ hold: true }));
    run(sim, 150, () => ({ hold: true }));
    let lo = Infinity;
    let hi = -Infinity;
    run(sim, 200, (s) => {
      lo = Math.min(lo, s.player.x);
      hi = Math.max(hi, s.player.x);
      return { hold: true };
    });
    const sweep = 2 * sim.world.lines[TRAM].rope * Math.sin(FEEL.SWING_MIN_AMP);
    expect(hi - lo).toBeGreaterThan(sweep * 0.6);
    expect(hi - lo).toBeLessThan(sweep * 1.4);
  });
});

describe('slingshot', () => {
  it('release timing sets the exit angle', () => {
    const angles: number[] = [];
    for (let hold = 150; hold < 310; hold += 10) {
      const r = towAndRelease(hold);
      angles.push((Math.atan2(r.vx, r.vz) * 180) / Math.PI);
    }
    const lo = Math.min(...angles);
    const hi = Math.max(...angles);
    // Tram climbs along +z: exits fan out to both sides of straight ahead.
    expect(lo).toBeLessThan(-12);
    expect(hi).toBeGreaterThan(12);
    expect(hi - lo).toBeGreaterThan(40);
  });

  it('throws the skater the way they were already moving, faster', () => {
    for (const hold of [160, 200, 240]) {
      const r = towAndRelease(hold);
      const pre = Math.hypot(r.pre.vx, r.pre.vz);
      const post = Math.hypot(r.vx, r.vz);
      const cos = (r.pre.vx * r.vx + r.pre.vz * r.vz) / (pre * post);
      expect(cos).toBeGreaterThan(0.98);
      expect(post).toBeGreaterThan(pre);
      expect(r.release.speed).toBeCloseTo(post, 6);
      expect(post).toBeLessThanOrEqual(Math.max(FEEL.SLING_CAP, pre) + 1e-9);
      expect(r.release).toMatchObject({ line: TRAM, chain: 1 });
    }
  });

  it('pops off the ground, and a swipe-up release pops higher', () => {
    const plain = towAndRelease(200);
    const hop = towAndRelease(200, () => 0, 90, true);
    expect(plain.vy).toBeGreaterThan(FEEL.SLING_POP * 0.9);
    expect(hop.vy).toBeGreaterThan(plain.vy + FEEL.SLING_HOP_POP * 0.9);
    expect(hop.release.hop).toBe(true);
  });

  it('carving hard behind the ride whips out faster than hanging on', () => {
    const passive = towAndRelease(200);
    // Lean left, then crack back right and let go mid-swing.
    const whip = towAndRelease(200, (k) => (k < 127 ? 0 : k < 172 ? -1 : 1));
    expect(whip.release.speed).toBeGreaterThan(passive.release.speed + 1.5);
    // Tram climbs along +z, so the skater's right is -x.
    expect(whip.vx).toBeLessThan(-6);
  });

  it('a very short tap still holds on for the minimum hitch time', () => {
    const r = towAndRelease(1);
    const hitchIdx = r.events.findIndex((e) => e.type === 'hitch');
    const relIdx = r.events.findIndex((e) => e.type === 'release');
    expect(hitchIdx).toBeGreaterThanOrEqual(0);
    expect(relIdx).toBeGreaterThan(hitchIdx);
  });
});

interface ChainResult {
  links: number;
  secondLine: number;
  exit2: number;
  events: SimEvent[];
}

/** Tow behind the tram, lean left then whip right and release, re-arm, ride the catch for 2 s. */
function chainAttempt(holdTicks: number, whipTicks: number, grace = FEEL.CHAIN_GROUND_GRACE): ChainResult {
  const sim = waitForTram();
  FEEL.CHAIN_GROUND_GRACE = grace;
  const events: SimEvent[] = [];
  let hitchedAt = -1;
  let releasedAt = -1;
  let secondAt = -1;
  let secondLine = -1;
  let links = 0;
  let exit2 = 0;
  for (let i = 0; i < 1600; i++) {
    const k = hitchedAt < 0 ? -1 : i - hitchedAt;
    let steer = 0;
    let hold = true;
    if (releasedAt < 0) {
      if (k >= holdTicks - whipTicks) steer = 1;
      else if (k >= holdTicks - whipTicks - 45) steer = -1;
      hold = k < holdTicks;
    } else if (secondAt < 0) {
      hold = i > releasedAt + 4;
    } else {
      hold = i < secondAt + 120;
    }
    sim.step({ steer, hold, hop: false });
    for (const e of sim.events) {
      events.push(e);
      if (e.type === 'hitch') {
        if (hitchedAt < 0) hitchedAt = i;
        else if (secondAt < 0) {
          secondAt = i;
          secondLine = e.line;
          links = e.chain;
        }
      }
      if (e.type === 'release') {
        if (releasedAt < 0) releasedAt = i;
        else exit2 = e.speed;
      }
    }
    if (exit2 > 0) break;
    if (releasedAt >= 0 && i > releasedAt + 200 && secondAt < 0) break;
  }
  return { links, secondLine, exit2, events };
}

/** The first (hold, whip) script in a small grid that catches the funicular off the tram. */
function findChain(): { hold: number; whip: number; result: ChainResult } {
  for (let hold = 400; hold <= 480; hold += 4) {
    for (const whip of [16, 22, 28, 34]) {
      const result = chainAttempt(hold, whip);
      if (result.secondLine === FUNI && result.links === 2) return { hold, whip, result };
    }
  }
  throw new Error('no chain found in the grid');
}

describe('chains', () => {
  it('releasing the tram and catching the funicular before landing for long is a two-link chain', () => {
    const { result } = findChain();
    expect(result.links).toBe(2);
    expect(result.events.find((e) => e.type === 'hitch' && e.line === FUNI)).toMatchObject({ chain: 2, newLink: true });
    expect(result.events.some((e) => e.type === 'chainEnd')).toBe(false);
    expect(result.events.some((e) => e.type === 'bail')).toBe(false);
  });

  it('each link adds exit speed: the same catch without the chain exits slower by one link bonus', () => {
    const { hold, whip, result } = findChain();
    // Identical inputs, but with no ground grace the chain ends on touchdown before the catch.
    const strict = chainAttempt(hold, whip, 0);
    expect(strict.secondLine).toBe(FUNI);
    expect(strict.links).toBe(1);
    expect(strict.events.some((e) => e.type === 'chainEnd' && e.reason === 'land')).toBe(true);
    expect(result.exit2 - strict.exit2).toBeCloseTo(FEEL.LINK_BONUS, 6);
    expect(result.exit2).toBeLessThanOrEqual(FEEL.SLING_CAP + 1e-9);
  });

  it('a chain ends once the skater has rolled for the grace time after a release', () => {
    const r = towAndRelease(200, () => 0, 200);
    const end = r.events.find((e) => e.type === 'chainEnd');
    expect(end).toMatchObject({ chain: 1, reason: 'land' });
    expect(r.sim.player.chain).toBe(0);
    expect(r.sim.player.chainAlive).toBe(0);

    // Count ground ticks between the release and the end of the chain.
    const sim = waitForTram();
    let hitched = -1;
    let released = false;
    let groundTicks = 0;
    let ended = false;
    for (let i = 0; i < 1200 && !ended; i++) {
      const hold = hitched < 0 || i < hitched + 200;
      sim.step({ steer: 0, hold, hop: false });
      for (const e of sim.events) {
        if (e.type === 'hitch') hitched = i;
        if (e.type === 'release') released = true;
        if (e.type === 'chainEnd') ended = true;
      }
      if (released && !ended && sim.player.mode === Mode.GROUND) groundTicks++;
    }
    expect(ended).toBe(true);
    expect(groundTicks).toBeGreaterThanOrEqual(Math.floor(FEEL.CHAIN_GROUND_GRACE * 60) - 1);
    expect(groundTicks).toBeLessThanOrEqual(Math.ceil(FEEL.CHAIN_GROUND_GRACE * 60) + 1);
  });

  it('re-catching the same vehicle keeps the chain but adds no link', () => {
    let recaught = 0;
    for (let gapAt = 100; gapAt <= 220; gapAt += 8) {
      const sim = waitForTram();
      const events: SimEvent[] = [];
      let hitched = -1;
      let released = -1;
      for (let i = 0; i < 700; i++) {
        // Let go for a moment, then keep the touch armed.
        const gap = hitched >= 0 && i >= hitched + gapAt && i < hitched + gapAt + 6;
        sim.step({ steer: 0, hold: !gap, hop: false });
        for (const e of sim.events) {
          events.push(e);
          if (e.type === 'hitch' && hitched < 0) hitched = i;
          if (e.type === 'release' && released < 0) released = i;
          if (e.type === 'hitch' && released >= 0) {
            // Whatever is caught while this chain is alive: the same tram never counts as a link.
            if (e.line === TRAM && e.vehicle === 0 && sim.player.chain === 1) {
              expect(e.newLink).toBe(false);
              expect(i - released).toBeGreaterThanOrEqual(Math.floor(FEEL.RELATCH_COOLDOWN * 60) - 1);
              if (!events.some((x) => x.type === 'chainEnd')) recaught++;
            }
          }
        }
      }
    }
    expect(recaught).toBeGreaterThan(0);
  });

  it('a bail ends the chain', () => {
    const sim = waitForTram();
    runUntil(sim, 600, (s) => s.player.mode === Mode.HITCH, () => ({ hold: true }));
    run(sim, 60, () => ({ hold: true }));
    // Aim the release at the kiosk wall is not needed: bail directly through a hard landing.
    run(sim, 2);
    expect(sim.player.chainAlive).toBe(1);
    sim.player.vy = -40;
    sim.player.y += 30;
    const ev = run(sim, 120);
    expect(ev.some((e) => e.type === 'bail' && e.reason === 'impact')).toBe(true);
    expect(ev.find((e) => e.type === 'chainEnd')).toMatchObject({ reason: 'bail' });
    expect(sim.player.chain).toBe(0);
  });
});

describe('vehicle bodies', () => {
  it('a slow skater in the lane is shoved aside, never driven through', () => {
    const sim = newSim();
    seekVehicle(sim, TRAM, 0, 60, 1, 420);
    // Park across the up lane on the flat at the bottom of the hill, just past the tram stop.
    teleport(sim, -4, 37, PI / 2, 0);
    const L = sim.world.lines[TRAM];
    let touched = false;
    for (let i = 0; i < 400; i++) {
      sim.step({ steer: 0, hold: false, hop: false });
      vehicleAt(L, 0, sim.tick, vs);
      const dx = sim.player.x - vs.x;
      const dz = sim.player.z - vs.z;
      const lon = dx * vs.hx + dz * vs.hz;
      const lat = -dx * vs.hz + dz * vs.hx;
      if (Math.abs(lon) < L.bodyHalfLen) {
        touched = touched || Math.abs(lat) < L.bodyHalfWid + FEEL.PLAYER_RADIUS + 0.05;
        expect(Math.abs(lat)).toBeGreaterThanOrEqual(L.bodyHalfWid + FEEL.PLAYER_RADIUS - 1e-6);
      }
    }
    expect(touched).toBe(true);
    expect(sim.player.mode).not.toBe(Mode.BAIL);
  });

  it('meeting a tram head-on at speed is a bail', () => {
    const sim = newSim();
    seekVehicle(sim, TRAM, 0, 100, 1, 60);
    teleport(sim, -4, 125, PI, 12);
    const ev = run(sim, 240);
    expect(ev.some((e) => e.type === 'bail' && e.reason === 'vehicle')).toBe(true);
  });

  it('coming down on a roof bounces instead of landing', () => {
    const sim = newSim();
    seekVehicle(sim, TRAM, 0, 100, 1, 0);
    vehicleAt(sim.world.lines[TRAM], 0, sim.tick, vs);
    teleport(sim, vs.x, vs.z + 1, 0, 0);
    sim.player.mode = Mode.AIR;
    sim.player.y = vs.y + 6;
    sim.player.vz = vs.vz;
    const ev = run(sim, 60);
    const bounce = ev.find((e) => e.type === 'bounce');
    expect(bounce).toBeDefined();
    expect(sim.player.mode).not.toBe(Mode.BAIL);
  });
});

describe('overhead rides, gates and service hours', () => {
  const kite = testLine({
    id: 'K1',
    kind: 'kite',
    overhead: true,
    path: [30, 9, -30, 30, 9, 30, -30, 9, 30, -30, 9, -30, 30, 9, -30],
    anchorBack: 0,
    anchorY: 0,
    hang: 4.6,
    rope: 0.6,
    bodyHalfLen: 0,
    bodyHalfWid: 0,
    bodyHeight: 0,
  });

  function underKite(): Sim {
    const sim = newSim(flatWorld([kite]));
    seekWhen(sim, 0, 0, (v) => v.vz > 7 && Math.abs(v.z + 6) < 0.2);
    teleport(sim, 30, 0, 0, 0);
    return sim;
  }

  it('a strap out of standing reach is caught with a hop, and lifts the skater off the ground', () => {
    const grounded = underKite();
    const ev = run(grounded, 240, () => ({ hold: true }));
    expect(ev.some((e) => e.type === 'hitch')).toBe(false);

    const sim = underKite();
    // Swipe up and keep the finger down as the strap arrives overhead.
    const ev2 = run(sim, 40, (_s, i) => ({ hold: true, hop: i === 28 }));
    expect(ev2.some((e) => e.type === 'hop')).toBe(true);
    expect(ev2.some((e) => e.type === 'hitch')).toBe(true);
    run(sim, 90, () => ({ hold: true }));
    expect(sim.player.mode).toBe(Mode.HITCH);
    // Hanging from the strap: hand at the strap end, board well clear of the ground.
    expect(sim.player.y).toBeGreaterThan(2.5);
    expect(sim.player.y).toBeCloseTo(9 - 4.6 - FEEL.HAND_HEIGHT, 1);
    expect(hSpeed(sim)).toBeGreaterThan(5);
    // Letting go from up there is a long flight: the chain stays alive in the air.
    const ev3 = run(sim, 30);
    expect(ev3.some((e) => e.type === 'release')).toBe(true);
    expect(sim.player.chainAlive).toBe(1);
  });

  it('a gated line refuses a skater without enough links, and says how many it needs', () => {
    const gated = testLine({ id: 'G1', minChain: 2 });
    const sim = newSim(flatWorld([gated]));
    seekWhen(sim, 0, 0, (v) => v.vz > 7 && Math.abs(v.z + 2) < 0.2);
    teleport(sim, 27, 0, 0, 0);
    const ev = run(sim, 200, () => ({ hold: true }));
    expect(ev.some((e) => e.type === 'hitch')).toBe(false);
    expect(ev.find((e) => e.type === 'denied')).toMatchObject({ line: 0, need: 2 });
    // The refusal does not spam every tick.
    expect(ev.filter((e) => e.type === 'denied').length).toBeLessThan(8);
  });

  it('a gated line accepts a skater who arrives on a live one-link chain', () => {
    const gated = testLine({ id: 'G1', minChain: 2 });
    const sim = newSim(flatWorld([gated]));
    seekWhen(sim, 0, 0, (v) => v.vz > 7 && Math.abs(v.z - 5) < 0.2);
    teleport(sim, 27, 0, 0, 0);
    // As if just slung off some other ride.
    sim.player.chain = 1;
    sim.player.chainAlive = 1;
    sim.player.lastLine = 5;
    sim.player.lastVeh = 0;
    const ev = run(sim, 30, () => ({ hold: true }));
    expect(ev.find((e) => e.type === 'hitch')).toMatchObject({ line: 0, chain: 2, newLink: true });
    expect(ev.some((e) => e.type === 'denied')).toBe(false);
  });

  it('a ride that goes out of service lets the skater go', () => {
    const shortDay = testLine({ windows: [[0.3, 0.3004]], vehicles: 1 });
    const sim = newSim(flatWorld([shortDay]));
    const L = sim.world.lines[0];
    // Find the one lap that runs, and wait beside the track during it.
    seekWhen(sim, 0, 0, (v) => v.active && v.vz > 7 && Math.abs(v.z + 2) < 0.2);
    teleport(sim, 27, 0, 0, 0);
    const events: SimEvent[] = [];
    run(sim, L.period + 200, (s) => {
      for (const e of s.events) events.push(e);
      return { hold: true };
    });
    expect(events.some((e) => e.type === 'hitch')).toBe(true);
    expect(events.some((e) => e.type === 'release')).toBe(true);
    vehicleAt(L, 0, sim.tick, vs);
    expect(vs.active).toBe(false);
    expect(sim.player.mode).not.toBe(Mode.HITCH);
  });
});

describe('review fixes', () => {
  it('a quick tap on a passing ride never throws the skater back against its travel', () => {
    for (let holdTicks = 1; holdTicks <= 24; holdTicks++) {
      const r = towAndRelease(holdTicks);
      // The tram climbs along +z: the throw may be wide (the catch swings the skater in from the
      // side) but never has a component back down the hill.
      expect(r.vz).toBeGreaterThan(1);
    }
  });
});
