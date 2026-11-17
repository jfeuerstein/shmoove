// Line-up fixture, night: the same plaza at 0.9 of the day, for glowing windows and lamps.
// This route only looks.
const neverHitched = (h) => h.every((s) => s.mode !== 'HITCH' && s.hitchedLine === null && !(s.events ?? []).includes('hitch'));

export default {
  name: 'lineup-night',
  params: 'world=lineup&t=0.9',
  steps: [
    { do: 'wait', ticks: 240 },
    { do: 'shot', name: 'night' },
    { do: 'expect', label: 'the skater only watched: never hitched', test: (s, h) => neverHitched(h) },
  ],
};
