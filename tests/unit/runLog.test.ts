/**
 * The run recorder, against a real `Sim`: what it reports has to be what the world says, and
 * recording must not allocate.
 */
import { describe, expect, it } from 'vitest';
import { BINS, BIN_MS, RunLog, reportText, statsLines } from '../../src/app/runLog';
import { PASSIVE_INFO, W_SLAM, WEAPON_INFO } from '../../src/sim/arsenal';
import { BOSS_TIMES } from '../../src/sim/balance';
import { makeBowl } from '../../src/sim/bowl';
import { setWeaponLevel } from '../../src/sim/build';
import { TICK_HZ } from '../../src/sim/constants';
import { hurtPlayer } from '../../src/sim/contact';
import { OFFER_LEVEL } from '../../src/sim/offer';
import { Sim } from '../../src/sim/sim';
import type { InputFrame } from '../../src/sim/types';
import { damageEnemy, HURT_COUNT, KIND_BRUISER, KIND_SHUFFLER, KINDS, PHASE_CHOOSE, PHASE_PLAY, spawnEnemy } from '../../src/sim/world';
import { arena } from '../sim/world-fixtures';
import { TUCK } from '../sim/fixtures';

const input: InputFrame = { steerX: 0.3, steerY: 1, carve: true, hop: false };

/** The heap in use, bytes (node's `process` is not in the project's types). */
function heapUsed(): number {
  const proc = (globalThis as unknown as { process: { memoryUsage(): { heapUsed: number } } }).process;
  return proc.memoryUsage().heapUsed;
}

function sum(a: ArrayLike<number>): number {
  let t = 0;
  for (let i = 0; i < a.length; i++) t += a[i];
  return t;
}

/** 40 s on the bowl among a minute-two crowd, never dying and never levelling. */
function fight(): { sim: Sim; log: RunLog } {
  const sim = new Sim(makeBowl(2), { seed: 2, horde: true, autoPick: false });
  const w = sim.world;
  setWeaponLevel(w, W_SLAM, 3);
  w.run.ticks = 120 * 60;
  const log = new RunLog();
  log.reset(1000);
  for (let i = 0; i < 40 * 60 && w.run.phase !== 1; i++) {
    w.player.xp = 0;
    sim.step(input);
    log.afterStep(sim, true);
    if (w.player.hp < 50) w.player.hp = w.player.maxHp;
  }
  return { sim, log };
}

describe('the run report', () => {
  it('reports kills, level, time and seed as the world has them', () => {
    const { sim, log } = fight();
    const w = sim.world;
    const r = log.report(sim);
    expect(w.player.kills).toBeGreaterThan(0);
    expect(r.kills).toBe(w.player.kills);
    expect(r.level).toBe(w.player.level);
    expect(r.seconds).toBeCloseTo(w.run.ticks / TICK_HZ, 1);
    expect(r.seed).toBe(w.seed);
    expect(r.id).toBe(1000);
    expect(r.outcome).toBe('running');
    expect(r.movement.distance).toBeCloseTo(sim.state.distance, 0);
  });

  it('damage shares add up to one, and every cause of a hit is counted', () => {
    const { sim, log } = fight();
    const w = sim.world;
    const r = log.report(sim);
    expect(r.damage.total).toBeGreaterThan(0);
    expect(r.damage.bySource.length).toBeGreaterThan(1);
    expect(sum(r.damage.bySource.map((d) => d.share))).toBeCloseTo(1, 9);
    expect(r.damage.bySource[0].dealt).toBeGreaterThanOrEqual(r.damage.bySource[1].dealt);
    // Hits by cause are the hits that happened.
    expect(w.tally.hits.length).toBe(HURT_COUNT);
    expect(r.taken.hits).toBeGreaterThan(0);
    expect(sum(r.taken.byCause.map((c) => c.hits))).toBe(sum(w.tally.hits));
    expect(r.taken.hits).toBe(sum(w.tally.hits));
    expect(r.taken.damage).toBeCloseTo(sum(w.tally.hurt), 0);
  });

  it('records movement the way the mover did it', () => {
    const { sim, log } = fight();
    const r = log.report(sim);
    const m = r.movement;
    expect(m.avgSpeed).toBeGreaterThan(0);
    expect(m.topSpeed).toBeGreaterThanOrEqual(m.avgSpeed);
    expect(sum(m.gearShare)).toBeCloseTo(1, 9);
    expect(m.holdingShare).toBeCloseTo(1, 9);
    expect(r.taken.lowestShare).toBeLessThanOrEqual(1);
    expect(r.horde.peak).toBeGreaterThan(0);
    // The run began at 2:00 on the clock, so the first minute mark is the 3:00 one.
    expect(r.horde.atMinute.length).toBe(0);
  });

  it('samples health and the crowd at each whole minute', () => {
    const sim = arena();
    const log = new RunLog();
    log.reset(5);
    hurtPlayer(sim.world, sim.state, 10);
    for (let i = 0; i < 2 * 60 * 60 + 5; i++) {
      sim.step(TUCK);
      log.afterStep(sim, false);
    }
    const r = log.report(sim);
    expect(r.taken.hpAtMinute.length).toBe(2);
    expect(r.horde.atMinute.length).toBe(2);
    expect(r.taken.lowestHp).toBeLessThan(sim.world.player.maxHp);
    expect(r.movement.stillSeconds).toBeGreaterThan(100);
    expect(r.movement.holdingShare).toBe(0);
  });

  it('times a boss: when it came, how long it lived, what hit the rider meanwhile, that it fell', () => {
    const sim = arena();
    const w = sim.world;
    const log = new RunLog();
    log.reset(9);
    w.run.ticks = BOSS_TIMES[0] * TICK_HZ;
    sim.step(TUCK);
    log.afterStep(sim, false);
    expect(w.boss.kind).toBe(KIND_BRUISER);
    for (let i = 0; i < 90; i++) {
      sim.step(TUCK);
      log.afterStep(sim, false);
    }
    // Two hits while it stands.
    hurtPlayer(w, sim.state, 1);
    hurtPlayer(w, sim.state, 1);
    sim.step(TUCK);
    log.afterStep(sim, false);
    const standing = log.report(sim);
    expect(standing.bosses).toHaveLength(1);
    expect(standing.bosses[0].fell).toBe(false);
    expect(standing.bosses[0].name).toBe(KINDS[KIND_BRUISER].name);

    const up = w.horde.count;
    expect(up).toBeGreaterThan(0);
    for (let i = 0; i < w.horde.count; i++) if (w.horde.kind[i] === KIND_BRUISER) damageEnemy(w, i, 1e6);
    for (let i = 0; i < 3; i++) {
      sim.step(TUCK);
      log.afterStep(sim, false);
    }
    const r = log.report(sim);
    expect(w.boss.felled).toBe(1);
    expect(r.bosses).toHaveLength(1);
    const b = r.bosses[0];
    expect(b.arrived).toBeCloseTo(BOSS_TIMES[0], 1);
    // Up for the 90 steps, the hit step and the step it fell on: 92 ticks, 1.5 s (rounded to a tenth).
    expect(b.lived).toBeCloseTo(92 / TICK_HZ, 1);
    expect(b.hitsWhileUp).toBe(2);
    expect(b.fell).toBe(true);
  });

  it('names the cards taken, in order, with the run time and where they came from', () => {
    const sim = new Sim(makeBowl(2), { seed: 2, horde: true, autoPick: false });
    const w = sim.world;
    const log = new RunLog();
    log.reset(1);
    for (let n = 0; n < 2; n++) {
      w.player.xp = w.player.xpNext;
      for (let i = 0; i < 5 && w.run.phase !== PHASE_CHOOSE; i++) {
        sim.step(TUCK);
        log.afterStep(sim, false);
      }
      expect(w.run.phase).toBe(PHASE_CHOOSE);
      expect(w.offer.source).toBe(OFFER_LEVEL);
      const was = w.offer.id[0];
      const type = w.offer.type[0];
      log.notePick(0);
      sim.step({ ...TUCK, pick: 0 });
      log.afterStep(sim, false);
      expect(w.run.phase).toBe(PHASE_PLAY);
      const cards = log.report(sim).build.cards;
      expect(cards).toHaveLength(n + 1);
      const c = cards[n];
      expect(c.from).toBe('level');
      expect(c.type).toBe(type === 0 ? 'weapon' : type === 1 ? 'passive' : 'boon');
      if (type === 0) expect(c.name).toBe(WEAPON_INFO[was].name);
      if (type === 1) expect(c.name).toBe(PASSIVE_INFO[was].name);
      expect(c.by).toBeGreaterThanOrEqual(1);
    }
    const r = log.report(sim);
    expect(r.build.weapons.length + r.build.passives.length).toBeGreaterThan(0);
  });

  it('times the choosing in real time, per offer', () => {
    const sim = new Sim(makeBowl(2), { seed: 2, horde: true, autoPick: false });
    const w = sim.world;
    const log = new RunLog();
    log.reset(1);
    w.player.xp = w.player.xpNext;
    for (let i = 0; i < 5 && w.run.phase !== PHASE_CHOOSE; i++) {
      sim.step(TUCK);
      log.afterStep(sim, false);
    }
    for (let i = 0; i < 30; i++) log.frame(100);
    sim.step({ ...TUCK, pick: 0 });
    log.afterStep(sim, false);
    for (let i = 0; i < 30; i++) log.frame(16);
    const r = log.report(sim);
    expect(r.cards.choosingSeconds).toBeCloseTo(3, 5);
    expect(r.cards.perOffer).toEqual([3]);
  });

  it('reads the frame histogram against a known list', () => {
    const log = new RunLog();
    log.reset(1);
    const times: number[] = [];
    for (let i = 0; i < 95; i++) times.push(16 + (i % 3) * 0.2);
    for (let i = 0; i < 4; i++) times.push(40);
    times.push(120);
    for (const t of times) log.frame(t);
    const sorted = [...times].sort((a, b) => a - b);
    const nearest = (q: number): number => sorted[Math.ceil(q * sorted.length) - 1];
    expect(log.percentile(0.95)).toBeCloseTo(nearest(0.95), 0);
    expect(Math.abs(log.percentile(0.95) - nearest(0.95))).toBeLessThanOrEqual(BIN_MS);
    expect(Math.abs(log.percentile(0.99) - nearest(0.99))).toBeLessThanOrEqual(BIN_MS);
    // The slowest frame is past the last bin's edge only when it is; here it is not.
    expect(120).toBeLessThan(BINS * BIN_MS);
    const sim = new Sim(makeBowl(2), { seed: 2, horde: true, autoPick: false });
    const f = log.report(sim).frames;
    expect(f.count).toBe(100);
    expect(f.avgMs).toBeCloseTo(times.reduce((a, b) => a + b, 0) / 100, 1);
    expect(f.over33).toBe(5);
    expect(f.over50).toBe(1);
    expect(f.avgMsBigHorde).toBeNull();
  });

  it('keeps the slowest frame when it is beyond the histogram', () => {
    const log = new RunLog();
    log.reset(1);
    log.frame(16);
    log.frame(5000);
    expect(log.percentile(1)).toBe(5000);
  });

  it('averages frames separately while the crowd is over 200', () => {
    const sim = arena();
    const w = sim.world;
    const log = new RunLog();
    log.reset(1);
    log.frame(10);
    for (let i = 0; i < 250; i++) spawnEnemy(w, KIND_SHUFFLER, 20 + (i % 25), 0, 20 + Math.floor(i / 25));
    expect(w.horde.count).toBe(250);
    log.afterStep(sim, false);
    log.frame(30);
    log.frame(50);
    expect(log.report(sim).frames.avgMsBigHorde).toBe(40);
  });

  it('recording allocates nothing per step or frame', () => {
    const sim = new Sim(makeBowl(2), { seed: 2, horde: true, autoPick: false });
    const log = new RunLog();
    log.reset(1);
    for (let i = 0; i < 600; i++) {
      sim.step(input);
      log.afterStep(sim, true);
      log.frame(16.7);
    }
    const before = heapUsed();
    for (let i = 0; i < 300_000; i++) {
      log.afterStep(sim, true);
      log.frame(16.7);
    }
    const grew = heapUsed() - before;
    // Three hundred thousand calls that each made even a small object would be tens of MB.
    expect(grew).toBeLessThan(3_000_000);
  });

  it('the text is a readable summary then the report as JSON on one line', () => {
    const { sim, log } = fight();
    log.meta.scheme = 'tuck';
    const r = log.report(sim);
    const text = reportText(r);
    const lines = text.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(20);
    expect(lines.length).toBeLessThanOrEqual(30);
    expect(JSON.parse(lines[lines.length - 1])).toEqual(r);
    expect(lines[lines.length - 2]).toBe('');
    const stats = statsLines(r);
    expect(stats).toHaveLength(3);
    expect(stats[0]).toContain(`${r.kills} kills`);
  });

  it('a new run starts a new log, but the lesson times belong to the session', () => {
    const { sim, log } = fight();
    log.lessonTick(0);
    log.lessonTick(0);
    log.lessonTick(3);
    log.reset(2);
    const sim2 = new Sim(makeBowl(2), { seed: 2, horde: true, autoPick: false });
    const r = log.report(sim2);
    expect(r.id).toBe(2);
    expect(r.frames.count).toBe(0);
    expect(r.movement.distance).toBe(0);
    expect(r.lesson).not.toBeNull();
    expect(r.lesson?.[0]).toBeCloseTo(2 / 60, 1);
    expect(sim.world.player.kills).toBeGreaterThan(0);
  });
});
