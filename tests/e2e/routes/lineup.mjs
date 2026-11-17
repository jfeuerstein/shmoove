// Line-up fixture, day: stand at the south edge of the plaza and watch every ride cross in front,
// nearest lane first (one every 50 ticks from tick 150). This route only looks.
const neverHitched = (h) => h.every((s) => s.mode !== 'HITCH' && s.hitchedLine === null && !(s.events ?? []).includes('hitch'));

export default {
  name: 'lineup',
  params: 'world=lineup&t=0.5',
  steps: [
    { do: 'wait', ticks: 170 },
    { do: 'shot', name: 'day-1' },
    { do: 'wait', ticks: 230 },
    { do: 'shot', name: 'day-2' },
    { do: 'wait', ticks: 300 },
    { do: 'shot', name: 'day-3' },
    { do: 'expect', label: 'the skater only watched: never hitched', test: (s, h) => neverHitched(h) },
  ],
};
