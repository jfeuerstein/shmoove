// M6a map-complete celebration, opened by the e2e-only `celebrate` test switch (the slice cannot
// be inked whole by a scripted route in reasonable time). Every line's badge gets punched, the
// screen pauses play, and CONTINUE returns to the game.
const near = (s, key, pt) => Math.abs(s.ui[key + 'X'] - pt.x) <= 6 && Math.abs(s.ui[key + 'Y'] - pt.y) <= 6;
const at = (key, pt) => ({ do: 'expect', label: `the ${key} control is at (${pt.x}, ${pt.y})`, test: (s) => near(s, key, pt) });
const tap = (pt) => [{ do: 'down', x: pt.x, y: pt.y }, { do: 'up' }];

const CONTINUE = { x: 195, y: 801 };

export default {
  name: 'shell-complete',
  params: 'slice&celebrate&t=0.330556',
  steps: [
    { do: 'wait', ticks: 60 },
    {
      do: 'expect',
      label: 'the celebration is open, every discovered line punched, and play is paused',
      test: (s, h) => s.ui.completeOpen === true && s.ui.completePunched === s.ui.mapLines && s.ui.mapLines > 0 && h[h.length - 1].tick === h[h.length - 3].tick,
    },
    { do: 'shot', name: 'complete' },
    at('completeContinue', CONTINUE),
    ...tap(CONTINUE),
    { do: 'wait', ticks: 30 },
    { do: 'expect', label: 'CONTINUE closes it and play runs', test: (s, h) => s.ui.completeOpen === false && h[h.length - 1].tick > h[h.length - 3].tick },
  ],
};
