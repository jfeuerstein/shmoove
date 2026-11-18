// M6b/M6g onboarding, the first launch: a new game in the city (no saved game, no `t=`, so the
// new-game clock), played by one thumb that does what each hint asks. Carve both ways at DRAG, flick
// up at FLICK UP, line up with the stair handrail and hop onto it at LAND ON THE RAIL, roll down to
// Rellano 410 where PULL DOWN TO STOP points at a waiting spot beside the lane, rest a thumb there
// until the ride the pointer moves to comes by (this player never brakes: it is an option), stay on to the next stop for the first inked segment
// (STAY ON TO THE NEXT STOP), let go at DRAG... THEN LET GO, then the map pointer and the last
// ticket. Each hint is photographed and checked as it shows.
//
// Open-loop: the touches below were recorded from the hint-following player in tests/sim/
// onboarding.test.ts, driven through the same Gestures recogniser the app uses, in the deterministic
// sim; the run is identical every time. That test replays this exact script and checks every marker,
// so if the sim changes and the script drifts it fails there first (regenerate it with
// SKITCH_PRINT_ROUTE=1 npx vitest run tests/sim/onboarding.test.ts -t 'real gesture' --silent=false).
//
// Tuples: ['w', ticks] wait; ['d', x, y] finger down; ['m', x, y] move; ['u'] lift;
// ['f', hold] swipe up (keeping the finger down if hold); ['s', step, done] the hint `step` is up with
// `done` steps learnt: a screenshot `hint-<step>` and a check (a fourth element names a second look,
// `hint-<step>-<look>`: at the hop onto the rail and at the press at the waiting spot, where the
// world pointer matters).
export const TOUCHES = [
  ['w',303], ['s','carve',0],
  ['w',5], ['d',195,700], ['m',247,700], ['w',16], ['m',143,700], ['w',9], ['m',109,700], ['w',15], ['m',116,700], ['w',3],
  ['m',140,700], ['w',3], ['m',163,700], ['w',3], ['m',181,700], ['w',2], ['u'], ['w',5], ['d',195,700], ['m',211,700],
  ['w',2], ['m',205,700], ['w',6], ['m',209,700], ['w',7], ['s','hop',1],
  ['w',5], ['f',true], ['m',158,520], ['w',6], ['m',164,520], ['w',3], ['m',170,520], ['w',3], ['m',175,520], ['w',3],
  ['m',180,520], ['w',3], ['m',185,520], ['w',3], ['u'], ['w',13], ['d',195,700], ['m',211,700], ['w',2], ['m',204,700],
  ['w',6], ['m',207,700], ['w',6], ['m',210,700], ['w',9], ['m',187,700], ['w',3], ['u'], ['w',19], ['d',195,700],
  ['m',211,700], ['w',2], ['m',203,700], ['w',12], ['m',206,700], ['w',21], ['m',203,700], ['w',3], ['u'], ['w',10],
  ['d',195,700], ['m',211,700], ['w',2], ['u'], ['w',9], ['d',195,700], ['m',211,700], ['w',1], ['u'], ['w',4],
  ['d',195,700], ['m',211,700], ['w',1], ['u'], ['w',9], ['d',195,700], ['m',211,700], ['w',1], ['u'], ['w',9],
  ['d',195,700], ['m',211,700], ['w',1], ['u'], ['w',15], ['d',195,700], ['m',211,700], ['w',1], ['u'], ['w',26],
  ['d',195,700], ['m',211,700], ['w',1], ['u'], ['w',68], ['s','grind',2,'hop'],
  ['f',false], ['w',13], ['s','grind',2],
  ['w',122], ['d',195,700], ['m',115,700], ['w',6], ['m',123,700], ['w',3], ['m',134,700], ['w',3], ['m',146,700], ['w',3],
  ['m',158,700], ['w',3], ['m',171,700], ['w',3], ['m',183,700], ['w',2], ['u'], ['w',3], ['d',195,700], ['m',211,700],
  ['w',1], ['m',205,700], ['w',3], ['m',214,700], ['w',3], ['m',220,700], ['w',3], ['m',228,700], ['w',3], ['m',234,700],
  ['w',3], ['m',240,700], ['w',3], ['m',244,700], ['w',3], ['m',247,700], ['w',18], ['m',243,700], ['w',3], ['m',240,700],
  ['w',3], ['m',236,700], ['w',3], ['m',232,700], ['w',3], ['m',227,700], ['w',3], ['m',223,700], ['w',3], ['m',218,700],
  ['w',3], ['m',213,700], ['w',1], ['s','hitch',3],
  ['w',2], ['m',208,700], ['w',3], ['m',203,700], ['w',2], ['u'], ['w',10], ['d',195,700], ['m',179,700], ['w',3],
  ['m',185,700], ['w',6], ['m',181,700], ['w',6], ['m',178,700], ['w',21], ['m',281,700], ['w',228], ['m',227,700], ['w',1],
  ['u'], ['w',1], ['d',195,700], ['m',170,700], ['w',1], ['m',137,700], ['w',3], ['m',109,700], ['w',102], ['m',122,700],
  ['w',3], ['m',146,700], ['w',3], ['m',166,700], ['w',3], ['m',181,700], ['w',2], ['u'], ['w',67], ['d',195,700],
  ['m',179,700], ['w',3], ['u'], ['w',9], ['d',195,700], ['m',179,700], ['w',2], ['u'], ['w',6], ['d',195,700],
  ['m',179,700], ['w',1], ['u'], ['w',3], ['d',195,700], ['m',179,700], ['w',1], ['u'], ['w',4], ['d',195,700],
  ['m',179,700], ['w',1], ['u'], ['w',4], ['d',195,700], ['m',179,700], ['w',1], ['u'], ['w',4], ['d',195,700],
  ['m',179,700], ['w',1], ['u'], ['w',5], ['d',195,700], ['m',179,700], ['w',2], ['u'], ['w',9], ['d',195,700],
  ['m',179,700], ['w',1], ['u'], ['w',1], ['d',195,700], ['m',109,700], ['w',8], ['m',119,700], ['w',3], ['m',141,700],
  ['w',3], ['m',160,700], ['w',3], ['m',176,700], ['w',3], ['m',187,700], ['w',1], ['u'], ['w',77], ['d',195,700],
  ['m',179,700], ['w',1], ['u'], ['w',3], ['d',195,700], ['m',179,700], ['w',1], ['u'], ['w',7], ['d',195,700],
  ['m',179,700], ['w',1], ['u'], ['w',4], ['d',195,700], ['m',179,700], ['w',1], ['u'], ['w',5], ['d',195,700],
  ['m',179,700], ['w',1], ['u'], ['w',5], ['d',195,700], ['m',179,700], ['w',1], ['u'], ['w',5], ['d',195,700],
  ['m',179,700], ['w',1], ['u'], ['w',4], ['d',195,700], ['m',179,700], ['w',1], ['u'], ['w',5], ['d',195,700],
  ['m',179,700], ['w',1], ['u'], ['w',4], ['d',195,700], ['m',179,700], ['w',1], ['u'], ['w',4], ['d',195,700],
  ['m',179,700], ['w',1], ['u'], ['w',5], ['d',195,700], ['m',179,700], ['w',1], ['u'], ['w',3], ['d',195,700],
  ['m',179,700], ['w',1], ['u'], ['w',5], ['d',195,700], ['m',179,700], ['w',1], ['u'], ['w',4], ['d',195,700],
  ['m',179,700], ['w',1], ['u'], ['w',3], ['d',195,700], ['m',179,700], ['w',1], ['u'], ['w',5], ['d',195,700],
  ['m',179,700], ['w',1], ['u'], ['w',4], ['d',195,700], ['m',179,700], ['w',1], ['u'], ['w',4], ['d',195,700],
  ['m',179,700], ['w',1], ['u'], ['w',4], ['d',195,700], ['m',179,700], ['w',1], ['u'], ['w',4], ['d',195,700],
  ['m',179,700], ['w',1], ['u'], ['w',4], ['d',195,700], ['m',179,700], ['w',1], ['u'], ['w',5], ['d',195,700],
  ['m',179,700], ['w',1], ['u'], ['w',3], ['s','hitch',3,'press'],
  ['d',195,700], ['w',7], ['m',264,700], ['w',3], ['m',178,700], ['w',3], ['m',173,700], ['w',9], ['m',180,700], ['w',3],
  ['m',281,700], ['w',9], ['m',204,700], ['w',3], ['m',281,700], ['w',21], ['m',204,700], ['w',12], ['m',195,700], ['w',40],
  ['s','ink',4],
  ['w',2597], ['s','sling',5],
  ['u'], ['w',1], ['d',195,700], ['m',109,700], ['w',40], ['s','map',6],
  ['w',88], ['m',119,700], ['w',3], ['m',130,700], ['w',3], ['m',140,700], ['w',3], ['m',149,700], ['w',3], ['m',157,700],
  ['w',3], ['m',164,700], ['w',3], ['m',170,700], ['w',3], ['m',175,700], ['w',3], ['m',180,700], ['w',3], ['m',183,700],
  ['w',6], ['m',188,700], ['w',1], ['u'], ['w',78], ['d',195,700], ['m',179,700], ['w',2], ['m',186,700], ['w',3],
  ['m',183,700], ['w',3], ['m',177,700], ['w',3], ['m',168,700], ['w',3], ['m',158,700], ['w',3], ['m',147,700], ['w',3],
  ['m',135,700], ['w',3], ['m',124,700], ['w',3], ['m',114,700], ['w',3], ['m',109,700], ['w',10], ['s','lift',6],
  ['w',35], ['m',186,700], ['w',3], ['m',109,700], ['w',45], ['m',186,700], ['w',3], ['m',109,700], ['w',27], ['m',186,700],
  ['w',6], ['m',109,700], ['w',39], ['m',186,700], ['w',3], ['m',109,700], ['w',21], ['m',186,700], ['w',6], ['m',109,700],
  ['w',39], ['m',186,700], ['w',3], ['m',109,700], ['w',24], ['m',186,700], ['w',6],
];

const toSteps = (t) => {
  switch (t[0]) {
    case 'w':
      return [{ do: 'wait', ticks: t[1] }];
    case 'd':
      return [{ do: 'down', x: t[1], y: t[2] }];
    case 'm':
      return [{ do: 'move', x: t[1], y: t[2] }];
    case 'u':
      return [{ do: 'up' }];
    case 'f':
      return [{ do: 'swipeUp', hold: t[1] }];
    case 's':
      return [
        { do: 'expect', label: `the ${t[1]} hint is up with ${t[2]} steps learnt`, test: (s) => s.ui.hint === t[1] && s.ui.hintsDone === t[2] },
        // A hint about something in the world shows where it is: the chevron in sight, or the edge arrow.
        { do: 'expect', label: `the ${t[1]} hint's pointer can be seen`, test: (s) => s.ui.hintTarget === 'none' || s.ui.hintPointer === 'world' || s.ui.hintPointer === 'edge' },
        { do: 'shot', name: `hint-${t[1]}${t[3] ? '-' + t[3] : ''}` },
      ];
    default:
      throw new Error(`unknown touch ${JSON.stringify(t)}`);
  }
};

const ev = (h, type) => h.some((s) => (s.events ?? []).includes(type));

export default {
  name: 'city-first-launch',
  params: 'world=city',
  steps: [
    {
      do: 'expect',
      label: 'a new game: at the lookout at the new-game clock, nothing on screen yet',
      test: (s) => s.mode === 'GROUND' && s.z > 565 && Math.abs(s.dayFrac - 0.4036) < 0.0005 && s.ui.hint === '' && s.ui.hintsDone === 0 && !s.ui.onboardingComplete,
    },
    // Rolling off the lookout, inside the funicular errand giver's zone: no offer until the hitch is learnt.
    ...TOUCHES.slice(0, 2).flatMap(toSteps),
    { do: 'expect', label: 'still at the lookout, and the funicular errand is not offered yet', test: (s) => s.z > 555 && s.y > 64 && s.ui.errandOffered === '' },
    ...TOUCHES.slice(2).flatMap(toSteps),
    { do: 'wait', ticks: 12 },
    {
      do: 'expect',
      label: 'the lesson learnt (and the hop and grind on the way): carved, hopped, ground a rail, caught a ride, inked a segment and slung off it',
      test: (s, h) => s.ui.onboardingComplete === true && s.ui.hintsDone >= 6 && s.ui.hint === '' && s.ui.inkedSegments >= 1 && ev(h, 'grindStart') && ev(h, 'release'),
    },
    { do: 'shot', name: 'done' },
  ],
};
