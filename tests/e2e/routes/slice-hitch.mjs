// M1 feel slice, route 2: hold to hitch the tram as it passes the lookout, carve behind it,
// release to slingshot. The clock is set so the tram leaves the top stop as the route starts.
const ev = (h, type) => h.some((s) => (s.events ?? []).includes(type));

export default {
  name: 'slice-hitch',
  params: 'slice&t=0.330556',
  steps: [
    { do: 'wait', ticks: 30 },
    { do: 'down', x: 195, y: 620 },
    { do: 'wait', ticks: 12 },
    { do: 'expect', label: 'a still touch arms the hitch', test: (s) => s.armed === true },
    { do: 'wait', ticks: 150 },
    { do: 'expect', label: 'the armed touch catches the tram', test: (s, h) => ev(h, 'hitch') && s.mode === 'HITCH' && s.hitchedLine === 'T5' && s.chain === 1 },
    { do: 'shot', name: 'tow' },
    { do: 'wait', ticks: 90 },
    { do: 'expect', label: 'towed at the tram\'s pace', test: (s) => s.mode === 'HITCH' && s.speed > 6 },
    // Carve out to the left, then crack back right and let go mid-swing.
    { do: 'move', x: 110, y: 620 },
    { do: 'wait', ticks: 45 },
    { do: 'shot', name: 'lean' },
    { do: 'move', x: 300, y: 620 },
    { do: 'wait', ticks: 22 },
    { do: 'shot', name: 'whip' },
    { do: 'up' },
    { do: 'wait', ticks: 6 },
    { do: 'expect', label: 'lifting the finger slings the skater off, airborne and faster', test: (s, h) => ev(h, 'release') && s.mode === 'AIR' && s.speed > 13 },
    { do: 'shot', name: 'sling' },
    { do: 'wait', ticks: 150 },
    { do: 'expect', label: 'the chain ends once the skater is rolling again', test: (s, h) => ev(h, 'chainEnd') && s.chain === 0 },
  ],
};
