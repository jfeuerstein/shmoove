// drive: stick held forward for 240 ticks runs the mover along its heading up to run speed and into
// gear 2; then a hop leaves the ground and lands. Screenshot mid-run.

/** FEEL.runSpeed (src/sim/constants.ts): what the stick alone reaches on the flat, m/s. */
const RUN_SPEED = 10;
const FORWARD = { steerX: 0, steerY: 1, carve: true };

export default {
  name: 'drive',
  query: '?hook',
  async run(t) {
    const { page, hook, check } = t;
    await hook.pause(true);
    const start = await hook.state();
    // The spawn heading is the view yaw at the start: forward(yaw) = (sin yaw, 0, cos yaw).
    const fx = Math.sin(start.viewYaw);
    const fz = Math.cos(start.viewYaw);

    await hook.hold(FORWARD);
    await hook.step(240);
    const run = await hook.state();
    const dx = run.x - start.x;
    const dz = run.z - start.z;
    const along = dx * fx + dz * fz;
    const across = Math.abs(dx * fz - dz * fx);
    check(run.tick === start.tick + 240, 'ran 240 ticks', run);
    check(along > 25, 'the mover moved along its heading', { along, across });
    check(across < 0.5, 'and not sideways', { along, across });
    check(Math.abs(run.speed - RUN_SPEED) < 0.75, 'speed is near run speed', run);
    check(run.gear === 2, 'the sim is in gear 2', run);
    const gearText = await page.evaluate(() => document.querySelector('.hud-gear')?.textContent ?? null);
    check(gearText === '2', 'HUD shows gear 2', gearText);

    // Hop: within a few ticks the mover is off the ground, and it comes back down.
    await hook.hop();
    let up = null;
    for (let i = 0; i < 12 && !up; i++) {
      await hook.step(1);
      const s = await hook.state();
      if (!s.grounded) up = s;
    }
    check(up !== null, 'a hop leaves the ground');
    let peak = up ? up.y : run.y;
    let down = null;
    for (let i = 0; up && i < 180 && !down; i++) {
      await hook.step(1);
      const s = await hook.state();
      peak = Math.max(peak, s.y);
      if (s.grounded) down = s;
    }
    check(down !== null, 'the hop lands');
    check(peak - run.y > 0.5, 'the hop goes up', { peak, ground: run.y });

    await hook.step(20);
    const after = await hook.state();
    check(after.speed > RUN_SPEED * 0.8 && after.grounded, 'still running after landing', after);
    await t.shot();
    await hook.hold(null);
  },
};
