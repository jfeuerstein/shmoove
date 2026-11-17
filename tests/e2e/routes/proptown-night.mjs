// City view fixture at night: cobalt silhouettes with mango points of light (windows, lamps,
// signs, bulbs). One shot at the lookout, one rolling down into the Terraces.
export default {
  name: 'proptown-night',
  params: 'world=proptown&t=0.92',
  steps: [
    { do: 'wait', ticks: 2 },
    { do: 'expect', label: 'it is night', test: (s) => s.dayFrac > 0.85 || s.dayFrac < 0.2 },
    { do: 'shot', name: '1' },
    { do: 'wait', ticks: 900 },
    { do: 'expect', label: 'rolled down into the Terraces', test: (s) => s.mode === 'GROUND' && s.z < 300 },
    { do: 'shot', name: '2' },
  ],
};
