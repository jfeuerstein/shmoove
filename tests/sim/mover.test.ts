/** What a player would notice about carve, tuck and hop. Analytic terrains only. */
import { describe, expect, it } from 'vitest';
import { FEEL } from '../../src/sim/constants';
import { hashSimState, Sim } from '../../src/sim/sim';
import { flatTerrain } from '../../src/sim/terrain';
import { EV_CHAIN_LOST, EV_CLEAN_HOP, EV_GEAR_DOWN, EV_HOP, EV_LAND, type InputFrame } from '../../src/sim/types';
import { FORWARD, halfPipeTerrain, launch, run, slopeTerrain, steer, tableTerrain, TUCK } from './fixtures';

const hopNow = (f: InputFrame): InputFrame => ({ ...f, hop: true });

/** Hop `delay` ticks after every landing while holding `base`. Returns clean hops made. */
function hopChain(sim: Sim, base: InputFrame, ticks: number, delay: number): number {
  let clean = 0;
  let wait = 0;
  for (let i = 0; i < ticks; i++) {
    if ((sim.state.events & EV_LAND) !== 0) wait = delay + 1;
    const fire = i === 0 || wait === 1;
    if (wait > 0) wait--;
    sim.step(fire ? hopNow(base) : base);
    if ((sim.state.events & EV_CLEAN_HOP) !== 0) clean++;
  }
  return clean;
}

describe('the stick', () => {
  it('reaches run speed on the flat and never gear 3', () => {
    const sim = new Sim(flatTerrain());
    let top = 0;
    let topGear = 1;
    for (let i = 0; i < 1800; i++) {
      sim.step(i % 240 < 120 ? FORWARD : steer(0.6, 0.8));
      top = Math.max(top, sim.state.mover.speed);
      topGear = Math.max(topGear, sim.state.mover.gear);
    }
    expect(top).toBeCloseTo(FEEL.runSpeed, 1);
    expect(topGear).toBe(2);
  });

  it('is at run speed within a second from rest', () => {
    const sim = new Sim(flatTerrain());
    run(sim, FORWARD, 60);
    expect(sim.state.mover.speed).toBeGreaterThan(FEEL.runSpeed * 0.95);
  });

  it('goes where it points: up is forward, right is right', () => {
    const fwd = new Sim(flatTerrain());
    run(fwd, FORWARD, 60);
    expect(fwd.state.mover.z).toBeGreaterThan(5);
    expect(Math.abs(fwd.state.mover.x)).toBeLessThan(1e-6);

    // Facing +z, screen-right is -x.
    const right = new Sim(flatTerrain());
    run(right, steer(1, 0), 20);
    expect(right.state.mover.x).toBeLessThan(-0.5);
  });

  it('half stick runs at half speed', () => {
    const sim = new Sim(flatTerrain());
    run(sim, steer(0, 0.5), 180);
    expect(sim.state.mover.speed).toBeCloseTo(FEEL.runSpeed * 0.5, 1);
  });

  it('held off-centre keeps turning, and a wider angle turns tighter', () => {
    const radius = (x: number, y: number): number => {
      const sim = new Sim(flatTerrain());
      run(sim, steer(x, y), 240);
      let minX = Infinity;
      let maxX = -Infinity;
      for (let i = 0; i < 600; i++) {
        sim.step(steer(x, y));
        minX = Math.min(minX, sim.state.mover.x);
        maxX = Math.max(maxX, sim.state.mover.x);
      }
      return (maxX - minX) / 2;
    };
    const gentle = radius(-0.34, 0.94);
    const hard = radius(-0.87, 0.5);
    expect(gentle).toBeLessThan(40);
    expect(hard).toBeLessThan(gentle * 0.6);
  });

  it('centred with the thumb down is a gentle brake', () => {
    const sim = new Sim(flatTerrain());
    run(sim, FORWARD, 120);
    run(sim, steer(0, 0), 60);
    expect(sim.state.mover.speed).toBeLessThan(FEEL.runSpeed - 3);
    expect(sim.state.mover.speed).toBeGreaterThan(1);
  });
});

describe('tuck', () => {
  it('holds speed on the flat far better than carving', () => {
    const tucked = new Sim(flatTerrain());
    launch(tucked, 25);
    run(tucked, TUCK, 180);
    const carving = new Sim(flatTerrain());
    launch(carving, 25);
    run(carving, FORWARD, 180);
    expect(tucked.state.mover.speed).toBeGreaterThan(21);
    expect(carving.state.mover.speed).toBeLessThan(tucked.state.mover.speed - 4);
  });

  it('gains speed down a slope: gear 3 on a gentle one, gear 5 on a steep one', () => {
    const gentle = new Sim(slopeTerrain(0.12));
    run(gentle, TUCK, 600);
    expect(gentle.state.mover.gear).toBeGreaterThanOrEqual(3);
    const steep = new Sim(slopeTerrain(0.35));
    run(steep, TUCK, 360);
    expect(steep.state.mover.gear).toBe(5);
  });

  it('does not steer', () => {
    const sim = new Sim(flatTerrain());
    launch(sim, 15);
    run(sim, { steerX: 1, steerY: 0, carve: false, hop: false }, 120);
    expect(Math.abs(sim.state.mover.x)).toBeLessThan(1e-6);
  });

  it('stays put on the flat and rolls back down a slope it cannot climb', () => {
    const flat = new Sim(flatTerrain());
    run(flat, TUCK, 120);
    expect(flat.state.mover.speed).toBe(0);
    const hill = new Sim(slopeTerrain(-0.3));
    launch(hill, 12);
    run(hill, TUCK, 600);
    expect(hill.state.mover.z).toBeLessThan(0);
  });

  it('never exceeds the hard speed limit', () => {
    const sim = new Sim(slopeTerrain(1.2, 100000));
    let top = 0;
    for (let i = 0; i < 1200; i++) {
      sim.step(TUCK);
      top = Math.max(top, sim.state.mover.speed);
    }
    expect(top).toBeLessThanOrEqual(FEEL.maxSpeed + 1e-9);
  });
});

describe('carving at speed', () => {
  it('costs speed in proportion to how much you turn', () => {
    const straight = new Sim(flatTerrain());
    launch(straight, 25);
    run(straight, FORWARD, 60);
    const gentle = new Sim(flatTerrain());
    launch(gentle, 25);
    run(gentle, steer(-0.26, 0.97), 60);
    const hard = new Sim(flatTerrain());
    launch(hard, 25);
    run(hard, steer(-1, 0), 60);
    expect(gentle.state.mover.speed).toBeLessThan(straight.state.mover.speed);
    expect(hard.state.mover.speed).toBeLessThan(gentle.state.mover.speed - 1);
  });

  it('turns in a wider circle the faster you go', () => {
    const turned = (speed: number): number => {
      const sim = new Sim(flatTerrain());
      launch(sim, speed);
      const h0 = sim.state.mover.heading;
      run(sim, steer(-1, 0), 20);
      return Math.abs(sim.state.mover.heading - h0);
    };
    expect(turned(25)).toBeLessThan(turned(10) * 0.6);
  });

  it('pulling back is a powerslide: it turns you round and takes most of your speed', () => {
    const sim = new Sim(flatTerrain());
    launch(sim, 22);
    let slid = false;
    for (let i = 0; i < 50; i++) {
      sim.step(steer(0.2, -1));
      slid ||= sim.state.mover.sliding;
    }
    expect(slid).toBe(true);
    expect(sim.state.mover.speed).toBeLessThan(11);
    expect(Math.cos(sim.state.mover.heading)).toBeLessThan(0);
  });

  it('holding the stick back turns you round once, not in circles', () => {
    const sim = new Sim(flatTerrain());
    launch(sim, 22);
    run(sim, steer(0.2, -1), 240);
    // Started along +z; four seconds later it is running steadily the other way.
    expect(Math.cos(sim.state.mover.heading)).toBeLessThan(-0.9);
    expect(sim.state.mover.sliding).toBe(false);
    expect(sim.state.mover.speed).toBeCloseTo(FEEL.runSpeed, 0);
    const h = sim.state.mover.heading;
    run(sim, steer(0.2, -1), 60);
    expect(Math.abs(sim.state.mover.heading - h)).toBeLessThan(0.05);
  });
});

describe('hops', () => {
  it('leave the ground for about half a second and come back', () => {
    const sim = new Sim(flatTerrain());
    run(sim, FORWARD, 120);
    sim.step(hopNow(FORWARD));
    expect(sim.state.mover.grounded).toBe(false);
    let air = 1;
    let peak = 0;
    while (!sim.state.mover.grounded && air < 200) {
      sim.step(FORWARD);
      peak = Math.max(peak, sim.state.mover.y);
      air++;
    }
    expect(air).toBeGreaterThan(24);
    expect(air).toBeLessThan(45);
    expect(peak).toBeGreaterThan(0.7);
    expect(peak).toBeLessThan(1.6);
  });

  it('a clean chain on the flat climbs past run speed into gear 3', () => {
    const sim = new Sim(flatTerrain());
    run(sim, FORWARD, 120);
    const clean = hopChain(sim, FORWARD, 900, 0);
    expect(clean).toBeGreaterThan(20);
    expect(sim.state.mover.chain).toBe(clean);
    expect(sim.state.mover.gear).toBeGreaterThanOrEqual(3);
  });

  it('a tap a little before landing still counts as clean', () => {
    const sim = new Sim(flatTerrain());
    run(sim, FORWARD, 120);
    sim.step(hopNow(FORWARD));
    let landedClean = false;
    for (let i = 0; i < 120; i++) {
      const m = sim.state.mover;
      // About 70 ms before touchdown on the way down.
      const early = !m.grounded && m.vy < 0 && m.y < 0.45 && m.hopBuffer === 0;
      sim.step(early ? hopNow(FORWARD) : FORWARD);
      if ((sim.state.events & EV_CLEAN_HOP) !== 0) landedClean = true;
    }
    expect(landedClean).toBe(true);
  });

  it('a tap just after the top of the arc is too early to count', () => {
    const sim = new Sim(flatTerrain());
    run(sim, FORWARD, 120);
    sim.step(hopNow(FORWARD));
    let tapped = false;
    let hops = 0;
    for (let i = 0; i < 120; i++) {
      const m = sim.state.mover;
      const early: boolean = !tapped && !m.grounded && m.vy < 0;
      if (early) tapped = true;
      sim.step(early ? hopNow(FORWARD) : FORWARD);
      if ((sim.state.events & EV_HOP) !== 0) hops++;
    }
    expect(tapped).toBe(true);
    expect(hops).toBe(0);
  });

  it('a late hop loses the chain but not the run', () => {
    const sim = new Sim(flatTerrain());
    run(sim, FORWARD, 120);
    hopChain(sim, FORWARD, 600, 0);
    const fast = sim.state.mover.speed;
    expect(sim.state.mover.chain).toBeGreaterThan(5);

    let lost = false;
    let wait = 0;
    for (let i = 0; i < 90; i++) {
      if ((sim.state.events & EV_LAND) !== 0) wait = FEEL.cleanWindowTicks + 4;
      const fire = wait === 1;
      if (wait > 0) wait--;
      sim.step(fire ? hopNow(FORWARD) : FORWARD);
      if ((sim.state.events & EV_CHAIN_LOST) !== 0) lost = true;
    }
    expect(lost).toBe(true);
    expect(sim.state.mover.chain).toBe(0);
    expect(sim.state.mover.speed).toBeGreaterThan(fast * 0.8);
  });

  it('late hops every time gain nothing over running', () => {
    const sim = new Sim(flatTerrain());
    run(sim, FORWARD, 120);
    const clean = hopChain(sim, FORWARD, 900, FEEL.cleanWindowTicks + 3);
    expect(clean).toBe(0);
    expect(sim.state.mover.gear).toBe(2);
  });

  it('a clean chain down a falling half-pipe reaches gear 4', () => {
    const sim = new Sim(halfPipeTerrain(16, 7, 0.08));
    hopChain(sim, TUCK, 600, 0);
    expect(sim.state.mover.gear).toBeGreaterThanOrEqual(4);
  });

  it('air-steer bends the flight a little, tucked flight not at all', () => {
    const steered = new Sim(flatTerrain());
    launch(steered, 15);
    steered.step(hopNow(steer(-1, 0)));
    while (!steered.state.mover.grounded) steered.step(steer(-1, 0));
    expect(steered.state.mover.x).toBeGreaterThan(0.3);
    expect(steered.state.mover.x).toBeLessThan(4);

    const tucked = new Sim(flatTerrain());
    launch(tucked, 15);
    tucked.step(hopNow(TUCK));
    while (!tucked.state.mover.grounded) tucked.step(TUCK);
    expect(Math.abs(tucked.state.mover.x)).toBeLessThan(1e-6);
  });
});

describe('terrain', () => {
  it('a fast mover flies off a crest and a slow one rolls over it', () => {
    const airTicks = (speed: number): number => {
      const sim = new Sim(tableTerrain(20, 10, 3, 4));
      launch(sim, speed);
      let air = 0;
      for (let i = 0; i < 400; i++) {
        sim.step(speed < 10 ? FORWARD : TUCK);
        if (!sim.state.mover.grounded) air++;
      }
      return air;
    };
    expect(airTicks(26)).toBeGreaterThan(20);
    expect(airTicks(9)).toBeLessThan(FEEL.minAirTicks);
  });

  it('landing on a downslope keeps more speed than landing flat', () => {
    const after = (slope: number): number => {
      const sim = new Sim(slopeTerrain(slope));
      launch(sim, 18);
      sim.step(hopNow(TUCK));
      while (!sim.state.mover.grounded) sim.step(TUCK);
      const landed = sim.state.mover.landSpeed;
      run(sim, TUCK, FEEL.cleanWindowTicks + 2);
      return sim.state.mover.speed - landed;
    };
    expect(after(0.4)).toBeGreaterThan(after(0) + 1);
  });

  it('riding a smooth surface is not a string of landings', () => {
    const sim = new Sim(halfPipeTerrain(16, 7, 0.08));
    sim.state.mover.x = 10;
    let landings = 0;
    for (let i = 0; i < 900; i++) {
      sim.step(TUCK);
      if ((sim.state.events & EV_LAND) !== 0) landings++;
    }
    expect(landings).toBe(0);
  });

  it('swings up a half-pipe wall and back', () => {
    const sim = new Sim(halfPipeTerrain(16, 7));
    sim.state.mover.heading = Math.PI / 2;
    launch(sim, 14);
    let maxX = 0;
    let came = false;
    for (let i = 0; i < 600; i++) {
      sim.step(TUCK);
      maxX = Math.max(maxX, sim.state.mover.x);
      if (maxX > 8 && sim.state.mover.x < 0) came = true;
    }
    expect(maxX).toBeGreaterThan(8);
    expect(maxX).toBeLessThan(16);
    expect(came).toBe(true);
  });

  it('cannot leave the terrain', () => {
    const sim = new Sim(flatTerrain(50));
    launch(sim, 30);
    let far = 0;
    for (let i = 0; i < 600; i++) {
      sim.step(i % 50 === 0 ? hopNow(FORWARD) : FORWARD);
      far = Math.max(far, Math.hypot(sim.state.mover.x, sim.state.mover.z));
    }
    expect(far).toBeLessThanOrEqual(50 + 1e-6);
  });
});

describe('gears', () => {
  it('do not flicker at the edge of a gear', () => {
    const sim = new Sim(flatTerrain());
    launch(sim, FEEL.gear3 + 0.3);
    let changes = 0;
    for (let i = 0; i < 300; i++) {
      // Wobble the stick: little scrubs right at the threshold.
      sim.step(steer(i % 20 < 10 ? 0.15 : -0.15, 1));
      if ((sim.state.events & EV_GEAR_DOWN) !== 0) changes++;
    }
    expect(changes).toBeLessThanOrEqual(1);
  });

  it('a hop does not cost a gear', () => {
    const sim = new Sim(flatTerrain());
    launch(sim, FEEL.gear4 + 1);
    sim.step(TUCK);
    expect(sim.state.mover.gear).toBe(4);
    sim.step(hopNow(TUCK));
    let dropped = false;
    while (!sim.state.mover.grounded) {
      sim.step(TUCK);
      if ((sim.state.events & EV_GEAR_DOWN) !== 0) dropped = true;
    }
    expect(dropped).toBe(false);
  });
});

describe('determinism', () => {
  it('the same inputs give the same run, bit for bit', () => {
    const play = (): number => {
      const sim = new Sim(halfPipeTerrain(16, 7, 0.05));
      let h = 0;
      for (let i = 0; i < 3000; i++) {
        const a = i * 0.013;
        const f: InputFrame = { steerX: Math.sin(a), steerY: Math.cos(a * 0.7), carve: i % 400 < 300, hop: i % 37 === 0 };
        sim.step(f);
        h = (Math.imul(h, 31) + hashSimState(sim.state)) >>> 0;
      }
      return h;
    };
    expect(play()).toBe(play());
  });
});
