// The city, first look: roll down the spine from the new-game spawn at the top of the Mercado
// Steps, hands off, and photograph each stretch, closer together through the Mercado.
export default {
  name: 'city-spine',
  params: 'world=city&t=0.42',
  steps: [
    { do: 'wait', ticks: 2 },
    { do: 'shot', name: 'spawn' },
    { do: 'expect', label: 'starts at the top of the Mercado Steps', test: (s) => s.mode === 'GROUND' && s.z > 540 && s.z < 600 },
    // The lookout apron falls toward the first flight: the skater rolls off it by itself.
    { do: 'wait', ticks: 90 },
    { do: 'shot', name: 'apron' },
    { do: 'expect', label: 'rolling off the apron with no input', test: (s) => s.speed > 0.5 && s.z < 569.5 },
    { do: 'wait', ticks: 390 },
    { do: 'shot', name: 'mercado-1' },
    { do: 'expect', label: 'gravity takes the skater down the steps', test: (s) => s.z < 560 },
    { do: 'wait', ticks: 240 },
    { do: 'shot', name: 'mercado-1b' },
    { do: 'wait', ticks: 240 },
    { do: 'shot', name: 'mercado-2' },
    { do: 'wait', ticks: 300 },
    { do: 'shot', name: 'mercado-2b' },
    { do: 'wait', ticks: 300 },
    { do: 'shot', name: 'mercado-3' },
    { do: 'wait', ticks: 900 },
    { do: 'shot', name: 'lower' },
    { do: 'expect', label: 'still in one piece and inside the world', test: (s) => Number.isFinite(s.x + s.y + s.z) && Math.abs(s.x) < 180 },
  ],
};
