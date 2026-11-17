// M6b onboarding, the first launch: a new game in the city (no saved game, no `t=`, so the
// new-game clock), played by one thumb that does what each hint asks. Carve both ways at DRAG, flick
// up at FLICK UP, line up with the stair handrail and hop onto it at LAND ON THE RAIL, roll down to
// Rellano 410 and hold still behind the handcart the pointer is over (PRESS AND HOLD STILL), let go
// at DRAG... THEN LET GO, catch it again and stay on to the next stop for the first inked segment,
// then the map pointer and the last ticket. Each hint is photographed and checked as it shows.
//
// Open-loop: the touches below were recorded from the hint-following player in tests/sim/
// onboarding.test.ts, driven through the same Gestures recogniser the app uses, in the deterministic
// sim; the run is identical every time. That test replays this exact script and checks every marker,
// so if the sim changes and the script drifts it fails there first (regenerate it from touchLaunch).
//
// Tuples: ['w', ticks] wait; ['d', x, y] finger down; ['m', x, y] move; ['u'] lift;
// ['f', hold] swipe up (keeping the finger down if hold); ['s', step, done] the hint `step` is up with
// `done` steps learnt: a screenshot `hint-<step>` and a check.
export const TOUCHES = [
  ['w',124], ['s','carve',0],
  ['w',6], ['d',195,700], ['m',272,700], ['w',32], ['m',118,700], ['w',6], ['m',109,700], ['w',24], ['m',121,700], ['w',3],
  ['m',139,700], ['w',3], ['m',155,700], ['w',3], ['m',167,700], ['w',3], ['m',176,700], ['w',3], ['m',183,700], ['w',3],
  ['m',188,700], ['w',1], ['u'], ['w',7], ['s','hop',1],
  ['w',6], ['f',false], ['w',30], ['s','grind',2],
  ['d',195,700], ['m',179,700], ['w',1], ['u'], ['w',11], ['d',195,700], ['m',179,700], ['w',1], ['u'], ['w',2],
  ['d',195,700], ['m',178,700], ['w',6], ['m',182,700], ['w',6], ['m',187,700], ['w',2], ['u'], ['w',26], ['d',195,700],
  ['m',179,700], ['w',1], ['u'], ['w',7], ['d',195,700], ['m',179,700], ['w',1], ['u'], ['w',11], ['d',195,700],
  ['m',179,700], ['w',1], ['u'], ['w',11], ['d',195,700], ['m',179,700], ['w',1], ['u'], ['w',16], ['d',195,700],
  ['m',179,700], ['w',1], ['u'], ['w',25], ['d',195,700], ['m',179,700], ['w',1], ['u'], ['w',75], ['d',195,700],
  ['m',179,700], ['w',1], ['u'], ['w',426], ['f',false], ['w',210], ['d',195,700], ['m',115,700], ['w',8], ['m',124,700],
  ['w',3], ['m',135,700], ['w',3], ['m',147,700], ['w',3], ['m',159,700], ['w',3], ['m',171,700], ['w',3], ['m',182,700],
  ['w',2], ['u'], ['w',5], ['d',195,700], ['m',211,700], ['w',5], ['m',214,700], ['w',3], ['m',220,700], ['w',3],
  ['m',226,700], ['w',3], ['m',232,700], ['w',3], ['m',237,700], ['w',3], ['m',242,700], ['w',3], ['m',246,700], ['w',3],
  ['m',249,700], ['w',6], ['m',252,700], ['w',15], ['m',247,700], ['w',6], ['m',241,700], ['w',3], ['m',238,700], ['w',3],
  ['m',234,700], ['w',3], ['m',230,700], ['w',3], ['m',226,700], ['w',3], ['m',222,700], ['w',3], ['m',218,700], ['w',3],
  ['m',214,700], ['w',3], ['m',210,700], ['w',3], ['m',207,700], ['w',3], ['m',204,700], ['w',2], ['u'], ['w',20],
  ['d',195,700], ['m',179,700], ['w',2], ['m',187,700], ['w',9], ['m',184,700], ['w',27], ['m',187,700], ['w',7], ['u'],
  ['w',12], ['d',195,700], ['m',179,700], ['w',2], ['u'], ['w',15], ['d',195,700], ['m',179,700], ['w',1], ['u'],
  ['w',8], ['d',195,700], ['m',179,700], ['w',1], ['u'], ['w',15], ['d',195,700], ['m',179,700], ['w',1], ['u'],
  ['w',22], ['d',195,700], ['m',179,700], ['w',1], ['u'], ['w',4], ['d',195,700], ['m',281,700], ['w',37], ['m',268,700],
  ['w',3], ['m',257,700], ['w',3], ['m',247,700], ['w',3], ['m',239,700], ['w',3], ['m',231,700], ['w',3], ['m',225,700],
  ['w',3], ['m',220,700], ['w',3], ['m',215,700], ['w',3], ['m',212,700], ['w',3], ['m',209,700], ['w',3], ['m',206,700],
  ['w',6], ['m',203,700], ['w',2], ['u'], ['w',18], ['d',195,700], ['m',211,700], ['w',1], ['m',202,700], ['w',3],
  ['u'], ['w',3], ['d',195,700], ['m',211,700], ['w',2], ['u'], ['w',4], ['d',195,700], ['m',211,700], ['w',3],
  ['u'], ['w',3], ['d',195,700], ['m',211,700], ['w',3], ['m',202,700], ['w',6], ['m',205,700], ['w',3], ['m',215,700],
  ['w',3], ['m',281,700], ['w',21], ['m',109,700], ['w',99], ['m',177,700], ['w',3], ['u'], ['w',8], ['d',195,700],
  ['m',211,700], ['w',1], ['m',202,700], ['w',3], ['u'], ['w',9], ['s','hitch',3],
  ['w',74], ['d',195,700], ['m',179,700], ['w',1], ['m',188,700], ['w',3], ['u'], ['w',4], ['d',195,700], ['m',179,700],
  ['w',2], ['u'], ['w',6], ['d',195,700], ['m',179,700], ['w',2], ['u'], ['w',5], ['d',195,700], ['m',179,700],
  ['w',2], ['u'], ['w',4], ['d',195,700], ['m',179,700], ['w',2], ['u'], ['w',4], ['d',195,700], ['m',179,700],
  ['w',1], ['u'], ['w',1], ['d',195,700], ['m',179,700], ['w',1], ['u'], ['w',3], ['d',195,700], ['m',179,700],
  ['w',2], ['u'], ['w',4], ['d',195,700], ['m',179,700], ['w',1], ['u'], ['w',1], ['d',195,700], ['m',179,700],
  ['w',1], ['u'], ['w',2], ['d',195,700], ['m',179,700], ['w',1], ['u'], ['w',2], ['d',195,700], ['m',179,700],
  ['w',1], ['u'], ['w',2], ['d',195,700], ['m',179,700], ['w',1], ['u'], ['w',1], ['d',195,700], ['m',179,700],
  ['w',1], ['u'], ['w',3], ['d',195,700], ['m',179,700], ['w',2], ['u'], ['w',4], ['d',195,700], ['m',179,700],
  ['w',2], ['u'], ['w',2], ['d',195,700], ['m',179,700], ['w',1], ['u'], ['w',2], ['d',195,700], ['m',179,700],
  ['w',1], ['u'], ['w',2], ['d',195,700], ['m',179,700], ['w',2], ['u'], ['w',3], ['d',195,700], ['m',111,700],
  ['w',1], ['u'], ['w',15], ['d',195,700], ['m',111,700], ['w',1], ['u'], ['w',11], ['d',195,700], ['w',8],
  ['m',262,700], ['w',3], ['m',176,700], ['w',3], ['m',171,700], ['w',9], ['m',174,700], ['w',3], ['m',153,700], ['w',6],
  ['m',186,700], ['w',3], ['m',109,700], ['w',36], ['m',195,700], ['w',112], ['s','sling',4],
  ['w',16], ['u'], ['w',1], ['d',195,700], ['w',9], ['m',109,700], ['w',21], ['m',281,700], ['w',12], ['m',195,700],
  ['w',24], ['s','ink',5],
  ['w',2519], ['s','map',6],
  ['w',239], ['s','lift',6],
  ['w',276],
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
        { do: 'shot', name: `hint-${t[1]}` },
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
      test: (s) => s.mode === 'GROUND' && s.z > 565 && Math.abs(s.dayFrac - 0.408) < 0.0005 && s.ui.hint === '' && s.ui.hintsDone === 0 && !s.ui.onboardingComplete,
    },
    // Rolling off the lookout, inside the funicular errand giver's zone: no offer until the hitch is learnt.
    ...TOUCHES.slice(0, 2).flatMap(toSteps),
    { do: 'expect', label: 'still at the lookout, and the funicular errand is not offered yet', test: (s) => s.z > 560 && s.ui.errandOffered === '' },
    ...TOUCHES.slice(2).flatMap(toSteps),
    { do: 'wait', ticks: 12 },
    {
      do: 'expect',
      label: 'all six learnt: carved, hopped, ground a rail, caught a ride, slung off it and inked a segment',
      test: (s, h) => s.ui.onboardingComplete === true && s.ui.hintsDone >= 6 && s.ui.hint === '' && s.ui.inkedSegments >= 1 && ev(h, 'grindStart') && ev(h, 'release'),
    },
    { do: 'shot', name: 'done' },
  ],
};
