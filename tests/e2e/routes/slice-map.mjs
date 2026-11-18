// M3 line map: catch the tram at the lookout as it leaves the top stop, ride it until a whole
// segment is inked (the catch is too far past Mirador for the first one, so the tram carries the
// skater through Escalera and on to Muelle), then open the line map, which pauses play.
const ev = (h, type) => h.some((s) => (s.events ?? []).includes(type));
const MAP_BTN = { x: 31, y: 31 };

export default {
  name: 'slice-map',
  params: 'slice&t=0.330556',
  steps: [
    { do: 'wait', ticks: 30 },
    { do: 'expect', label: 'the board starts in free mode with no line', test: (s) => s.ui.hudMode === 'free' && s.ui.hudLine === '' && s.ui.mapOpen === false },
    { do: 'down', x: 195, y: 620 },
    { do: 'wait', ticks: 12 },
    { do: 'expect', label: 'a still touch arms the hitch', test: (s) => s.armed === true },
    { do: 'wait', ticks: 150 },
    { do: 'expect', label: 'the armed touch catches the tram', test: (s, h) => ev(h, 'hitch') && s.mode === 'HITCH' && s.hitchedLine === 'T5' },
    {
      do: 'expect',
      label: 'the board flips to the line, its next stop and the chain',
      test: (s) => s.ui.hudMode === 'hitched' && s.ui.hudLine === 'T5' && s.ui.hudNextStop !== '' && s.ui.chainShown === 1,
    },
    { do: 'wait', ticks: 30 },
    { do: 'shot', name: 'hud-hitched' },
    { do: 'expect', label: 'nothing is inked yet', test: (s) => s.ui.inkedSegments === 0 && s.ui.mapPercent === 0 },
    { do: 'wait', ticks: 2460 },
    {
      do: 'expect',
      label: 'staying on through a whole segment inks it and shows a ticket',
      test: (s) => s.mode === 'HITCH' && s.ui.inkedSegments >= 1 && s.ui.lastToast === 'inked' && s.ui.toasts >= 1,
    },
    { do: 'shot', name: 'toast-inked' },
    // Let go on the way into Muelle (every release is a slingshot, so a little early), wait a third
    // of a second for the tram to draw away (a touch held still arms a catch, and the strap reaches
    // 14 m), then pull down and stop beside the stop: its timetable board comes up. Found by search
    // in the deterministic sim (tests/sim/sliceRoutes.test.ts replays it; SKITCH_FIND_SLICE re-finds it).
    { do: 'wait', ticks: 30 },
    { do: 'up' },
    { do: 'wait', ticks: 20 },
    { do: 'expect', label: 'letting go returns the board to free mode', test: (s) => s.mode !== 'HITCH' && s.ui.hudMode === 'free' },
    { do: 'down', x: 195, y: 560 },
    { do: 'move', x: 195, y: 660 },
    { do: 'wait', ticks: 150 },
    { do: 'expect', label: 'pulling down stops the skater', test: (s) => s.mode === 'GROUND' && s.speed < 0.3 },
    { do: 'expect', label: 'standing at a stop shows its timetable board', test: (s) => s.ui.stopBoard === 'Muelle' },
    { do: 'shot', name: 'stop-board' },
    { do: 'up' },
    { do: 'down', x: MAP_BTN.x, y: MAP_BTN.y },
    { do: 'up' },
    { do: 'expect', label: 'tapping the map button opens the map', test: (s) => s.ui.mapOpen === true && s.armed === false },
    { do: 'wait', ticks: 30 },
    {
      do: 'expect',
      label: 'the map pauses play',
      test: (s, h) => s.ui.mapOpen === true && h.slice(-6).every((x) => x.tick === s.tick),
    },
    {
      do: 'expect',
      label: 'the map draws both lines with some ink',
      test: (s) => s.ui.mapLines === 2 && s.ui.mapPercent > 0 && s.ui.mapPercent < 100,
    },
    { do: 'shot', name: 'map' },
    { do: 'down', x: MAP_BTN.x, y: MAP_BTN.y },
    { do: 'up' },
    { do: 'wait', ticks: 30 },
    {
      do: 'expect',
      label: 'tapping it again closes the map and play resumes',
      test: (s, h) => s.ui.mapOpen === false && h[h.length - 1].tick - h[h.length - 6].tick === 30,
    },
  ],
};
