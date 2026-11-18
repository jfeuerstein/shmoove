import { describe, expect, it } from 'vitest';
import { FEEL } from '../../src/sim/constants';
import { PI } from '../../src/sim/math';
import { AWNING_TOP, SLICE } from '../../src/sim/slice';
import { Mode } from '../../src/sim/types';
import { Surface, terrainHeight } from '../../src/sim/world';
import { hSpeed, newSim, run, runUntil, teleport } from './helpers';

const DOWNHILL = PI;

describe('rolling', () => {
  it('gravity alone carries a skater downhill up to a terminal speed', () => {
    const sim = newSim();
    const z0 = sim.player.z;
    run(sim, 60 * 4);
    expect(sim.player.mode).toBe(Mode.GROUND);
    expect(sim.player.z).toBeLessThan(z0 - 15);
    const early = sim.player.speed;
    expect(early).toBeGreaterThan(5);
    run(sim, 60 * 12);
    const late = sim.player.speed;
    // Terminal speed on the slope: g*sin - rolling = drag * v^2.
    const sin = SLICE.slope / Math.sqrt(1 + SLICE.slope * SLICE.slope);
    const terminal = Math.sqrt((FEEL.GRAVITY * sin - FEEL.ROLL_RESIST) / FEEL.AIR_DRAG);
    expect(late).toBeGreaterThan(early);
    expect(late).toBeGreaterThan(terminal * 0.9);
    expect(late).toBeLessThanOrEqual(terminal * 1.001);
  });

  it('stays glued to the street surface while rolling', () => {
    const sim = newSim();
    for (let i = 0; i < 600; i++) {
      sim.step({ steer: 0, hold: false, hop: false });
      expect(sim.player.y).toBeCloseTo(terrainHeight(sim.world, sim.player.x, sim.player.z), 4);
    }
  });

  it('never rolls uphill: without a ride the skater ends lower than they started', () => {
    const sim = newSim();
    teleport(sim, 0, 200, 0, 8);
    const y0 = sim.player.y;
    let top = y0;
    run(sim, 60 * 10, (s) => {
      top = Math.max(top, s.player.y);
      return {};
    });
    // The 8 m/s run-up coasts a little way up, then gravity turns it round.
    expect(top - y0).toBeLessThan((8 * 8) / (2 * FEEL.GRAVITY) + 0.2);
    expect(sim.player.y).toBeLessThan(y0 - 5);
  });

  it('a stalled board facing uphill kickturns and rolls back down', () => {
    const sim = newSim();
    teleport(sim, 0, 200, 0, 0);
    const ev = run(sim, 120);
    expect(ev.some((e) => e.type === 'kickturn')).toBe(true);
    expect(sim.player.z).toBeLessThan(200);
    expect(Math.cos(sim.player.heading)).toBeLessThan(-0.9);
  });

  it('tic-tac carving creeps forward on the flat, but only to walking pace', () => {
    const still = newSim();
    teleport(still, 0, 20, PI / 2, 0);
    run(still, 300);
    expect(still.player.speed).toBe(0);

    const sim = newSim();
    teleport(sim, 0, 20, PI / 2, 0);
    const x0 = sim.player.x;
    let top = 0;
    run(sim, 600, (s, i) => {
      top = Math.max(top, s.player.speed);
      return { steer: Math.floor(i / 10) % 2 === 0 ? 1 : -1 };
    });
    expect(Math.abs(sim.player.x - x0) + Math.abs(sim.player.z - 20)).toBeGreaterThan(4);
    expect(top).toBeGreaterThan(1.2);
    expect(top).toBeLessThanOrEqual(FEEL.PUMP_SPEED_CAP + 1e-9);
  });
});

describe('carving', () => {
  it('steer right moves the skater to their right, steer left to their left', () => {
    // Facing downhill (-z), the skater's right is +x.
    const right = newSim();
    run(right, 120, () => ({ steer: 0.5 }));
    const left = newSim();
    run(left, 120, () => ({ steer: -0.5 }));
    expect(right.player.x).toBeGreaterThan(left.player.x + 2);
    expect(right.player.x).toBeGreaterThan(SLICE.tramDownX - 2.5);
    expect(left.player.x).toBeLessThan(1.5);
  });

  it('turns tighter at low speed than at high speed', () => {
    const radius = (speed: number): number => {
      const sim = newSim();
      teleport(sim, 0, 20, PI / 2, speed);
      sim.step({ steer: 1, hold: false, hop: false });
      // Let the steer smoothing settle, then measure turn rate against speed.
      run(sim, 20, () => ({ steer: 1 }));
      const h1 = sim.player.heading;
      const v = sim.player.speed;
      run(sim, 1, () => ({ steer: 1 }));
      const rate = Math.abs(sim.player.heading - h1) * 60;
      return v / rate;
    };
    expect(radius(4)).toBeLessThan(radius(16) * 0.5);
  });

  it('carving costs speed compared with rolling straight', () => {
    const straight = newSim();
    run(straight, 300);
    const weave = newSim();
    run(weave, 300, (_s, i) => ({ steer: Math.floor(i / 40) % 2 === 0 ? 0.6 : -0.6 }));
    expect(weave.player.speed).toBeLessThan(straight.player.speed);
    expect(weave.player.mode).toBe(Mode.GROUND);
  });
});

describe('hopping', () => {
  it('a swipe leaves the ground, peaks about where the hop speed says, and lands rolling', () => {
    const sim = newSim();
    teleport(sim, 0, 20, PI / 2, 6);
    const y0 = sim.player.y;
    let peak = 0;
    const ev = run(sim, 90, (s, i) => {
      peak = Math.max(peak, s.player.y - y0);
      return { hop: i === 5 };
    });
    const v = FEEL.HOP_V + 6 * FEEL.HOP_SPEED_BONUS;
    expect(ev.filter((e) => e.type === 'hop')).toHaveLength(1);
    expect(peak).toBeGreaterThan(((v * v) / (2 * FEEL.GRAVITY)) * 0.9);
    expect(peak).toBeLessThan(((v * v) / (2 * FEEL.GRAVITY)) * 1.05);
    expect(ev.some((e) => e.type === 'land')).toBe(true);
    expect(sim.player.mode).toBe(Mode.GROUND);
    expect(sim.player.y).toBeCloseTo(y0, 3);
  });

  it('cannot hop again in mid-air', () => {
    const sim = newSim();
    teleport(sim, 0, 20, PI / 2, 6);
    const ev = run(sim, 60, (_s, i) => ({ hop: i === 5 || i === 25 }));
    expect(ev.filter((e) => e.type === 'hop')).toHaveLength(1);
  });

  it('a swipe just before touching down is buffered into a hop on landing', () => {
    const sim = newSim();
    teleport(sim, 0, 20, PI / 2, 6);
    let landTick = -1;
    run(sim, 90, (s, i) => {
      if (landTick < 0 && i > 10 && s.player.mode === Mode.GROUND) landTick = i;
      return { hop: i === 5 };
    });
    expect(landTick).toBeGreaterThan(20);

    const again = newSim();
    teleport(again, 0, 20, PI / 2, 6);
    const ev = run(again, 120, (_s, i) => ({ hop: i === 5 || i === landTick - 4 }));
    expect(ev.filter((e) => e.type === 'hop')).toHaveLength(2);
  });
});

describe('the staircase and its handrail', () => {
  /** Ticks from the top step of the staircase to its bottom, riding `rail` or the stairs. */
  const flightTicks = (rail: boolean): { ticks: number; exit: number } => {
    const sim = newSim();
    teleport(sim, rail ? SLICE.railX : 18, rail ? 262 : 252, DOWNHILL, 7);
    let hopped = false;
    let top = -1;
    let bottom = -1;
    let exit = 0;
    run(sim, 3000, (s, i) => {
      if (top < 0 && s.player.z < SLICE.terraceZ0) top = i;
      if (bottom < 0 && s.player.z < SLICE.stairZ0) bottom = i;
      if (s.player.z > SLICE.stairZ0 - 8) exit = hSpeed(s);
      const hop = rail && !hopped && s.player.z <= 254;
      if (hop) hopped = true;
      return { hop };
    });
    return { ticks: top >= 0 && bottom >= 0 ? bottom - top : -1, exit };
  };

  // DECISIONS 114: stairs cost some speed but are a real way down; the rail is the fast line.
  it('stairs cost some speed but are a real way down', () => {
    const sim = newSim();
    teleport(sim, 18, 252, DOWNHILL, 7);
    let onStairs = 0;
    let topSpeedOnStairs = 0;
    const t = runUntil(sim, 3000, (s) => {
      if (s.player.surface === Surface.STAIRS) {
        onStairs++;
        topSpeedOnStairs = Math.max(topSpeedOnStairs, s.player.speed);
      }
      return s.player.z < SLICE.stairZ0;
    });
    expect(t).toBeGreaterThan(0);
    expect(onStairs).toBeGreaterThan(200);
    expect(topSpeedOnStairs).toBeGreaterThan(9);
    expect(topSpeedOnStairs).toBeLessThan(15);
  });

  it('hopping onto the handrail grinds it end to end, much faster than the stairs', () => {
    const sim = newSim();
    teleport(sim, SLICE.railX, 262, DOWNHILL, 7);
    let hopped = false;
    let grindTicks = 0;
    const events = [] as string[];
    const t = runUntil(
      sim,
      3000,
      (s) => {
        for (const e of s.events) events.push(e.type);
        if (s.player.mode === Mode.GRIND) grindTicks++;
        return s.player.z < SLICE.stairZ0 - 8;
      },
      (s) => {
        const hop = !hopped && s.player.z <= 254;
        if (hop) hopped = true;
        return { hop };
      },
    );
    expect(events).toContain('grindStart');
    expect(events).toContain('grindEnd');
    expect(events).not.toContain('bail');
    expect(grindTicks).toBeGreaterThan(120);
    // Came off the bottom end of the rail, not partway down.
    const endIdx = events.indexOf('grindEnd');
    expect(endIdx).toBeGreaterThan(events.indexOf('grindStart'));
    expect(t).toBeGreaterThan(0);
    // The clearly faster line: at least 15 % quicker from the top step to the bottom, and off
    // the end above 16 m/s.
    const stairs = flightTicks(false);
    const rail = flightTicks(true);
    expect(stairs.ticks).toBeGreaterThan(0);
    expect(rail.ticks).toBeGreaterThan(0);
    expect(rail.ticks).toBeLessThan(stairs.ticks * 0.85);
    expect(rail.exit).toBeGreaterThan(16);
    expect(hSpeed(sim)).toBeGreaterThan(16);
  });

  it('the rail is ridden at rail height, not at stair height', () => {
    const sim = newSim();
    teleport(sim, SLICE.railX, 262, DOWNHILL, 7);
    let hopped = false;
    let checked = 0;
    run(sim, 600, (s) => {
      if (s.player.mode === Mode.GRIND && s.player.z < SLICE.terraceZ0 - 2 && s.player.z > SLICE.stairZ0 + 2) {
        const over = s.player.y - terrainHeight(s.world, s.player.x, s.player.z);
        expect(over).toBeGreaterThan(0.8);
        expect(over).toBeLessThan(1.0);
        expect(s.player.x).toBeCloseTo(SLICE.railX, 5);
        checked++;
      }
      const hop = !hopped && s.player.z <= 254;
      if (hop) hopped = true;
      return { hop };
    });
    expect(checked).toBeGreaterThan(100);
  });

  it('hopping off a rail leaves to the side the thumb leans', () => {
    const side = (steer: number): number => {
      const sim = newSim();
      teleport(sim, SLICE.railX, 262, DOWNHILL, 7);
      let hopped = false;
      let off = false;
      run(sim, 500, (s) => {
        const first = !hopped && s.player.z <= 254;
        if (first) hopped = true;
        const second = !off && s.player.mode === Mode.GRIND && s.player.z < 232;
        if (second) off = true;
        return { hop: first || second, steer: s.player.mode === Mode.GRIND ? steer : 0 };
      });
      expect(off).toBe(true);
      return sim.player.x - SLICE.railX;
    };
    // Heading downhill, right is +x.
    expect(side(1)).toBeGreaterThan(1);
    expect(side(-1)).toBeLessThan(-1);
  });
});

describe('walls, roofs and awnings', () => {
  it('a shallow airborne hit on the kiosk wall becomes a wallride, and a hop wall-jumps away', () => {
    const sim = newSim();
    // West face of the kiosk is at x = 12; come down the sidewalk angling into it.
    teleport(sim, 10.6, 78, DOWNHILL - 0.25, 10);
    let wallAt = -1;
    let jumped = false;
    const types: string[] = [];
    run(sim, 200, (s, i) => {
      for (const e of s.events) types.push(e.type);
      if (wallAt < 0 && s.player.mode === Mode.WALL) wallAt = i;
      const jump = wallAt >= 0 && !jumped && i === wallAt + 12;
      if (jump) jumped = true;
      return { hop: i === 2 || jump };
    });
    expect(types).toContain('wallStart');
    expect(types).toContain('wallEnd');
    expect(jumped).toBe(true);
    // Thrown back out over the sidewalk, away from the wall.
    expect(sim.player.x).toBeLessThan(11.6);
    expect(types).not.toContain('bail');
  });

  it('wallriding gains height over simply falling, and tops out onto a low roof', () => {
    const sim = newSim();
    // Near the uphill end the kiosk roof is barely above the sidewalk: the wallride clears the lip.
    teleport(sim, 10.6, 85, DOWNHILL - 0.25, 10);
    const types: string[] = [];
    let onRoof = false;
    run(sim, 240, (s, i) => {
      for (const e of s.events) {
        types.push(e.type);
        if (e.type === 'wallEnd' && e.topped) onRoof = true;
      }
      return { hop: i === 2 };
    });
    expect(types).toContain('wallStart');
    expect(onRoof).toBe(true);
  });

  // DECISIONS 114: walls bail only above WALL_BAIL_SPEED.
  it('hitting a wall square on above the bail speed is a bail; below it, a knock; slowly, it just turns you along it', () => {
    const fast = newSim();
    teleport(fast, 5, 80, PI / 2, FEEL.WALL_BAIL_SPEED + 3);
    const ev = run(fast, 90);
    expect(ev.some((e) => e.type === 'bail' && e.reason === 'wall')).toBe(true);

    // Just under the bail speed at the moment of contact: knocked back, still on the board.
    const knock = newSim();
    teleport(knock, 5, 80, PI / 2, FEEL.WALL_BAIL_SPEED - 2);
    const evK = run(knock, 90);
    const hitK = evK.find((e) => e.type === 'wallHit');
    expect(hitK).toBeDefined();
    if (hitK && hitK.type === 'wallHit') expect(hitK.speed).toBeLessThan(FEEL.WALL_BAIL_SPEED);
    expect(evK.some((e) => e.type === 'bail')).toBe(false);
    expect(knock.player.mode).not.toBe(Mode.BAIL);

    const slow = newSim();
    teleport(slow, 9, 80, PI / 2, 2.5);
    const ev2 = run(slow, 600);
    expect(ev2.some((e) => e.type === 'bail')).toBe(false);
    // Not pinned: gravity takes the skater along and away down the hill.
    expect(slow.player.z).toBeLessThan(60);
    expect(slow.player.x).toBeLessThan(12);
  });

  it('never ends up inside a solid', () => {
    const sim = newSim();
    teleport(sim, 5, 80, PI / 2, 16);
    for (let i = 0; i < 400; i++) {
      sim.step({ steer: 0, hold: false, hop: false });
      const p = sim.player;
      const inside = p.x > 12.05 && p.x < 15.95 && p.z > 66.05 && p.z < 93.95 && p.y < 9;
      expect(inside).toBe(false);
    }
  });

  it('rolling under the awning is clear; hopping onto it bounces high', () => {
    const under = newSim();
    teleport(under, 13, 186, DOWNHILL, 9);
    const ev = run(under, 150);
    expect(ev.some((e) => e.type === 'bounce' || e.type === 'wallHit' || e.type === 'bail')).toBe(false);
    expect(under.player.z).toBeLessThan(165);

    const over = newSim();
    teleport(over, 13, 186, DOWNHILL, 9);
    let peak = -Infinity;
    let bounced = false;
    let hopped = false;
    run(over, 150, (s) => {
      for (const e of s.events) if (e.type === 'bounce') bounced = true;
      if (bounced) peak = Math.max(peak, s.player.y);
      const hop = !hopped && s.player.z <= 180;
      if (hop) hopped = true;
      return { hop };
    });
    expect(bounced).toBe(true);
    const awningTop = terrainHeight(over.world, 13, 170) + AWNING_TOP;
    const bounce = (FEEL.AWNING_BOUNCE * FEEL.AWNING_BOUNCE) / (2 * FEEL.GRAVITY);
    expect(peak - awningTop).toBeGreaterThan(bounce * 0.85);
  });
});

describe('bailing', () => {
  it('rolling into the sea bails, then puts the skater back on dry ground at a standstill', () => {
    const sim = newSim();
    teleport(sim, 0, 30, DOWNHILL, 12);
    const types: string[] = [];
    run(sim, 600, (s) => {
      for (const e of s.events) types.push(e.type === 'bail' ? `bail:${e.reason}` : e.type);
      return {};
    });
    expect(types).toContain('bail:water');
    expect(types).toContain('recover');
    expect(sim.player.mode).toBe(Mode.GROUND);
    expect(sim.player.speed).toBe(0);
    expect(sim.player.z).toBeGreaterThan(-2);
    expect(sim.player.surface).not.toBe(Surface.WATER);
  });

  // DECISIONS 114: the tumble lasts BAIL_TIME, then the skater is up again.
  it('a bail ignores input until the tumble is over, and the tumble lasts BAIL_TIME', () => {
    const sim = newSim();
    teleport(sim, 5, 80, PI / 2, FEEL.WALL_BAIL_SPEED + 4);
    runUntil(sim, 200, (s) => s.player.mode === Mode.BAIL);
    expect(sim.player.mode).toBe(Mode.BAIL);
    const tumble = Math.round(FEEL.BAIL_TIME * 60);
    const ev = run(sim, tumble - 5, () => ({ hop: true, hold: true, steer: 1 }));
    expect(ev.some((e) => e.type === 'hop' || e.type === 'hitch')).toBe(false);
    expect(sim.player.mode).toBe(Mode.BAIL);
    const rest = runUntil(sim, 120, (s) => s.player.mode !== Mode.BAIL);
    expect(rest).toBeGreaterThan(0);
    // Up within a few ticks of BAIL_TIME after the fall, not the old 1.3 s.
    expect(tumble - 5 + rest).toBeLessThanOrEqual(tumble + 2);
    runUntil(sim, 120, (s) => s.player.mode === Mode.GROUND);
    expect(sim.player.mode).toBe(Mode.GROUND);
  });

  it('the edge of the world turns the skater back instead of letting them leave', () => {
    const sim = newSim();
    teleport(sim, 60, 20, -PI / 2, 10);
    run(sim, 300);
    expect(sim.player.x).toBeLessThanOrEqual(sim.world.maxX);
    expect(sim.player.x).toBeGreaterThanOrEqual(sim.world.minX);
  });
});

describe('review fixes', () => {
  it('a skater who keeps rolling into the sea is put back clear of the edge, facing inland', () => {
    const sim = newSim();
    teleport(sim, 0, 30, DOWNHILL, 12);
    let bails = 0;
    run(sim, 60 * 40, (s) => {
      for (const e of s.events) if (e.type === 'bail') bails++;
      return {};
    });
    // One dunking, then they stay ashore: no bail loop at the quay.
    expect(bails).toBe(1);
    expect(sim.player.z).toBeGreaterThan(FEEL.SAFE_MARGIN - 2.5);
  });

  it('one sim step is far inside its time budget', () => {
    const sim = newSim();
    const n = 60000;
    const t0 = performance.now();
    run(sim, n, (_s, i) => ({ steer: Math.sin(i / 40), hold: i % 400 > 200, hop: i % 97 === 0 }));
    const ms = (performance.now() - t0) / n;
    expect(ms).toBeLessThan(0.3);
  });
});

describe('awnings and traffic never trap', () => {
  it('a skater dropped straight down onto an awning bounces off it, not on the spot for ever', () => {
    const sim = newSim();
    // The slice's awning spans x 10..16, z 165..175.
    teleport(sim, 13, 170, DOWNHILL, 0);
    sim.player.mode = Mode.AIR;
    sim.player.y += 6;
    let bounces = 0;
    run(sim, 60 * 20, (s) => {
      for (const e of s.events) if (e.type === 'bounce') bounces++;
      return {};
    });
    expect(bounces).toBeGreaterThanOrEqual(1);
    expect(bounces).toBeLessThan(6);
    expect(sim.player.mode).toBe(Mode.GROUND);
    expect(sim.player.z).toBeLessThan(165);
  });
});
