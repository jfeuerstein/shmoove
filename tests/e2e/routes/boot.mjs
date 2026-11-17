// Temporary-app route: a touch on the right of the screen must move the cube right, and the
// fixed-step clock must advance exactly as many ticks as the runner asked for.
export default {
  name: 'boot',
  steps: [
    { do: 'shot', name: 'start' },
    { do: 'expect', label: 'cube starts centred at tick 0', test: (s) => s.tick === 0 && s.x === 0 },
    { do: 'down', x: 300, y: 600 },
    { do: 'wait', ticks: 30 },
    { do: 'expect', label: 'cube followed the touch to the right', test: (s) => s.x > 0 },
    { do: 'expect', label: 'clock advanced exactly 30 ticks', test: (s) => s.tick === 30 },
    { do: 'expect', label: 'wait sampled 5 slices of 6 ticks', test: (_s, h) => h.length === 6 && h[1].tick === 6 },
    { do: 'shot', name: 'touch' },
    { do: 'up' },
  ],
};
