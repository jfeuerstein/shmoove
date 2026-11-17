// City view fixture: roll down proptown by gravity from the Antenna lookout to the docks, with a
// few carve touches, photographing each district. Checks the skater never ends up inside a solid
// (against the same fixture built here in Node) and that the view still renders after 150 m.
import { registerHooks } from 'node:module';

// Load the fixture's TypeScript straight from src/sim (Node strips the types); extensionless
// relative imports inside src resolve to their .ts files.
registerHooks({
  resolve(spec, ctx, next) {
    if (/^\.\.?\//.test(spec) && !/\.[cm]?[jt]s$/.test(spec) && ctx.parentURL?.endsWith('.ts')) {
      try {
        return next(`${spec}.ts`, ctx);
      } catch {
        // not a TypeScript sibling: fall through
      }
    }
    return next(spec, ctx);
  },
});
const { buildProptown } = await import('../../../src/sim/proptown.ts');
const { collideSolids, makeWallHit } = await import('../../../src/sim/world.ts');
const { FEEL } = await import('../../../src/sim/constants.ts');

const world = buildProptown(1);
const hit = makeWallHit();
/** Is the skater's body (feet at y) inside a solid it should collide with? */
const inside = (s) => {
  collideSolids(world, s.x, s.y, s.z, 0.02, FEEL.PLAYER_HEIGHT, FEEL.STEP_UP, hit);
  return hit.hit;
};
const neverInside = (h) => h.every((s) => !inside(s));
const ev = (h, type) => h.some((s) => (s.events ?? []).includes(type));

// A carve: drag sideways by dx px for `ticks`, then the same back, then lift.
const carve = (dx, ticks) => [
  { do: 'down', x: 195, y: 620 },
  { do: 'move', x: 195 + dx, y: 620 },
  { do: 'wait', ticks },
  { do: 'move', x: 195 - dx, y: 620 },
  { do: 'wait', ticks },
  { do: 'up' },
];

export default {
  name: 'proptown',
  params: 'world=proptown&t=0.5',
  steps: [
    { do: 'wait', ticks: 2 },
    { do: 'expect', label: 'starts on the Antenna lookout', test: (s) => s.mode === 'GROUND' && s.z > 370 },
    { do: 'shot', name: '1' },
    { do: 'wait', ticks: 300 },
    { do: 'expect', label: 'gravity alone rolls the skater down the hill', test: (s) => s.speed > 5 && s.z < 368 },
    ...carve(30, 24),
    { do: 'wait', ticks: 450 },
    { do: 'expect', label: 'into the Terraces', test: (s) => s.z < 300 && s.z > 200 },
    { do: 'shot', name: '2' },
    ...carve(-30, 24),
    // Long enough to travel well over 150 m: streaming must keep up.
    { do: 'wait', ticks: 420 },
    { do: 'expect', label: 'down in the Mercado', test: (s) => s.z < 200 && s.z > 100 },
    { do: 'shot', name: '3' },
    { do: 'wait', ticks: 400 },
    { do: 'expect', label: 'on the docks', test: (s) => s.z < 100 },
    { do: 'shot', name: '4' },
    { do: 'expect', label: 'the skater was never inside a solid', test: (_s, h) => neverInside(h) },
    { do: 'expect', label: 'no bail on the way down', test: (_s, h) => !ev(h, 'bail') },
  ],
};
