// M1 feel slice, route 1: roll, carve, hop. Also checks the feel panel is complete.
const ev = (h, type) => h.some((s) => (s.events ?? []).includes(type));

export default {
  name: 'slice',
  params: 'slice&debug',
  steps: [
    { do: 'wait', ticks: 2 },
    { do: 'shot', name: 'spawn' },
    { do: 'expect', label: 'feel panel lists every constant', test: (s) => s.feelRows > 80 },
    { do: 'wait', ticks: 180 },
    { do: 'expect', label: 'gravity alone rolls the skater downhill', test: (s) => s.mode === 'GROUND' && s.speed > 5 && s.z < 330 },
    { do: 'shot', name: 'rolling' },
    { do: 'down', x: 195, y: 600 },
    { do: 'move', x: 235, y: 600 },
    { do: 'move', x: 275, y: 600 },
    { do: 'wait', ticks: 30 },
    { do: 'expect', label: 'dragging right carves right', test: (s) => s.steer > 0.5 && s.x > 2 },
    { do: 'expect', label: 'a touch that drags first never arms the hitch', test: (s) => s.armed === false },
    { do: 'shot', name: 'carve' },
    { do: 'up' },
    { do: 'wait', ticks: 20 },
    { do: 'swipeUp', x: 195, y: 650 },
    { do: 'wait', ticks: 12 },
    { do: 'expect', label: 'a swipe up hops', test: (s, h) => ev(h, 'hop') && s.mode === 'AIR' },
    { do: 'shot', name: 'hop' },
    { do: 'wait', ticks: 60 },
    { do: 'expect', label: 'and lands rolling', test: (s, h) => ev(h, 'land') && s.mode === 'GROUND' },
  ],
};
