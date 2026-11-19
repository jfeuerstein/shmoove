// horde: the crowd fixture on the bowl (200 enemies, 100 sparks). The mover runs forward and bends
// left for 120 ticks, laying Wake; the frame must stay within the draw-call budget, actually draw
// the crowd, and log nothing. Screenshot at the end.

/** tests/perf/budgets.json `hordeDrawCalls`: the budget for the full 400-enemy crowd with the arsenal. */
const DRAW_CALL_BUDGET = 32;
/** The empty bowl draws about 46 000 triangles; 200 enemies and their shadows add well over this. */
const MIN_EXTRA_TRIANGLES = 6000;

export default {
  name: 'horde',
  query: '?hook&horde=200&sparks=100',
  async run(t) {
    const { hook, check } = t;
    await hook.pause(true);
    const start = await hook.state();

    await hook.hold({ steerX: 0, steerY: 1, carve: true });
    await hook.step(70);
    await hook.hold({ steerX: -0.6, steerY: 0.8, carve: true });
    await hook.step(50);
    const end = await hook.state();
    check(end.tick === start.tick + 120, 'ran 120 ticks', { start: start.tick, end: end.tick });
    check(Math.hypot(end.x - start.x, end.z - start.z) > 10, 'the mover went somewhere through the crowd', end);

    // Draw a few more frames so the stats window is all crowd.
    for (let i = 0; i < 6; i++) await hook.step(1);
    const stats = await hook.stats();
    check(stats.drawCalls > 0 && stats.drawCalls <= DRAW_CALL_BUDGET, `draw calls within ${DRAW_CALL_BUDGET}`, stats);
    check(stats.triangles > 46000 + MIN_EXTRA_TRIANGLES, 'the crowd is drawn', stats);
    await t.shot();
    await hook.hold(null);
  },
};
