// M1 feel slice, route 3: carve across to the terrace, hop onto the handrail, grind the stairs.
// Open-loop touches found by search in the deterministic sim; the run is identical every time.
const ev = (h, type) => h.some((s) => (s.events ?? []).includes(type));

export default {
  name: 'slice-grind',
  params: 'slice&t=0.330556',
  steps: [
    { do: 'wait', ticks: 150 },
    // Carve right for 36 ticks, counter-steer for 26, then roll straight onto the terrace.
    { do: 'down', x: 195, y: 620 },
    { do: 'move', x: 246.6, y: 620 },
    { do: 'wait', ticks: 36 },
    { do: 'move', x: 143.4, y: 620 },
    { do: 'wait', ticks: 26 },
    { do: 'up' },
    { do: 'wait', ticks: 404 },
    { do: 'expect', label: 'rolled onto the terrace above the stairs', test: (s) => s.mode === 'GROUND' && s.x > 18 && s.x < 22 && s.z < 262 },
    { do: 'shot', name: 'terrace' },
    { do: 'swipeUp', x: 195, y: 650 },
    { do: 'wait', ticks: 60 },
    { do: 'expect', label: 'the hop lands on the handrail', test: (s, h) => ev(h, 'grindStart') && s.mode === 'GRIND' },
    { do: 'shot', name: 'grind' },
    { do: 'wait', ticks: 240 },
    { do: 'expect', label: 'ground the rail to its end and came off fast', test: (s, h) => ev(h, 'grindEnd') && !ev(h, 'bail') && s.z < 200 },
    { do: 'shot', name: 'after' },
  ],
};
