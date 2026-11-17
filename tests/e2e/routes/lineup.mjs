// Line-up fixture, day: stand at the south edge of the plaza and watch every ride cross in front,
// nearest lane first (one every 50 ticks from tick 150). This route only looks, and checks that
// each of the 16 lines is drawn in its own livery.
const neverHitched = (h) => h.every((s) => s.mode !== 'HITCH' && s.hitchedLine === null && !(s.events ?? []).includes('hitch'));
const LINE_COUNT = 16;
const lines = (s) => s.lines ?? [];
const distinct = (xs) => new Set(xs).size === xs.length;

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
    {
      do: 'expect',
      label: 'all 16 lines are on the plaza, each with its own id',
      test: (s) => lines(s).length === LINE_COUNT && distinct(lines(s).map((l) => l.id)),
    },
    {
      do: 'expect',
      label: 'no two lines share a livery (base colour and pattern)',
      test: (s) => distinct(lines(s).map((l) => `${l.base}/${l.pattern}`)),
    },
    {
      do: 'expect',
      label: "every line's vehicles are drawn with its livery's base and stripe colours",
      test: (s) => lines(s).every((l) => l.painted === true),
    },
    {
      do: 'expect',
      label: 'every line is painted differently from every other (its own colours on its own body)',
      test: (s) => lines(s).every((l) => l.paint >= 0) && distinct(lines(s).map((l) => l.paint)),
    },
    {
      do: 'expect',
      label: 'every line had a vehicle on screen during the line-up',
      test: (s, h) => lines(s).every((_, i) => h.some((x) => (x.lines?.[i]?.drawn ?? 0) > 0)),
    },
  ],
};
