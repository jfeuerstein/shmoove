// M5a chalk lines: draw a route on the slice, save it under the default name, share it, then race
// its ghost and let the race run to its result. Controls are tapped at fixed points; each tap is
// preceded by an expect that the control's centre (exposed by the UI's test state) is where the
// route is about to tap, so a layout change fails loudly instead of tapping the wrong thing.
const ev = (h, type) => h.some((s) => (s.events ?? []).includes(type));
const near = (s, key, pt) => Math.abs(s.ui[key + 'X'] - pt.x) <= 6 && Math.abs(s.ui[key + 'Y'] - pt.y) <= 6;
const at = (key, pt) => ({ do: 'expect', label: `the ${key} control is at (${pt.x}, ${pt.y})`, test: (s) => near(s, key, pt) });
const tap = (pt) => [{ do: 'down', x: pt.x, y: pt.y }, { do: 'up' }];

const CHALK_BTN = { x: 31, y: 85 };
const CLOSE = { x: 347, y: 31 };
const DRAW = { x: 115, y: 805 };
const SAVE = { x: 123, y: 210 };
const SHARE0 = { x: 164, y: 161 };
const RACE0 = { x: 81, y: 161 };

/** Carve right, carve left, hop, carve right: about 8 s of skating with the finger down. */
const SKATE = [
  { do: 'down', x: 195, y: 620 },
  { do: 'move', x: 235, y: 620 },
  { do: 'move', x: 260, y: 620 },
  { do: 'wait', ticks: 120 },
  { do: 'move', x: 195, y: 620 },
  { do: 'move', x: 140, y: 620 },
  { do: 'wait', ticks: 120 },
  { do: 'up' },
  { do: 'wait', ticks: 20 },
  { do: 'swipeUp', x: 195, y: 650 },
  { do: 'wait', ticks: 60 },
  { do: 'down', x: 195, y: 620 },
  { do: 'move', x: 240, y: 620 },
  { do: 'wait', ticks: 150 },
  { do: 'up' },
];

export default {
  name: 'slice-chalk',
  params: 'slice&t=0.330556',
  steps: [
    { do: 'wait', ticks: 30 },
    { do: 'expect', label: 'no chalk lines and nothing recording at the start', test: (s) => s.ui.chalkLines === 0 && s.ui.chalkMode === 'idle' && s.ui.chalkOpen === false },
    at('chalkBtn', CHALK_BTN),
    ...tap(CHALK_BTN),
    { do: 'wait', ticks: 18 },
    { do: 'expect', label: 'the chalk button opens the chalk screen, which pauses play', test: (s, h) => s.ui.chalkOpen === true && s.ui.chalkView === 'list' && h[h.length - 1].tick === h[h.length - 3].tick },
    { do: 'shot', name: 'chalk-empty' },
    at('chalkDraw', DRAW),
    ...tap(DRAW),
    { do: 'wait', ticks: 6 },
    { do: 'expect', label: 'DRAW closes the screen and starts recording', test: (s) => s.ui.chalkOpen === false && s.ui.chalkMode === 'recording' },
    ...SKATE,
    { do: 'expect', label: 'the recording runs for the whole skate', test: (s) => s.ui.chalkMode === 'recording' && s.ui.chalkElapsed >= 8 * 60 },
    { do: 'shot', name: 'chalk-rec' },
    at('chalkBtn', CHALK_BTN),
    ...tap(CHALK_BTN),
    { do: 'wait', ticks: 18 },
    { do: 'expect', label: 'STOP opens the name prompt and pauses', test: (s) => s.ui.chalkOpen === true && s.ui.chalkView === 'name' && s.ui.chalkMode === 'recording' },
    at('chalkSave', SAVE),
    ...tap(SAVE),
    { do: 'wait', ticks: 6 },
    { do: 'expect', label: 'saving under the default name adds a line and shows a ticket', test: (s) => s.ui.chalkLines === 1 && s.ui.chalkMode === 'idle' && s.ui.lastToast === 'chalk-saved' },
    { do: 'shot', name: 'chalk-saved' },
    at('chalkBtn', CHALK_BTN),
    ...tap(CHALK_BTN),
    { do: 'wait', ticks: 18 },
    { do: 'expect', label: 'the list shows the line', test: (s) => s.ui.chalkOpen === true && s.ui.chalkView === 'list' && s.ui.chalkLines === 1 },
    { do: 'shot', name: 'chalk-list' },
    at('chalkShare0', SHARE0),
    ...tap(SHARE0),
    { do: 'wait', ticks: 6 },
    { do: 'expect', label: 'SHARE shows the line as a code', test: (s) => s.ui.chalkView === 'share' && typeof s.ui.chalkCode === 'string' && s.ui.chalkCode.startsWith('SK2-') && s.ui.chalkCode.length > 40 },
    { do: 'shot', name: 'chalk-share' },
    at('chalkClose', CLOSE),
    ...tap(CLOSE),
    { do: 'wait', ticks: 6 },
    { do: 'expect', label: 'CLOSE closes the screen and play resumes', test: (s, h) => s.ui.chalkOpen === false && s.ui.chalkCode === '' && h[h.length - 1].tick > h[h.length - 3].tick },
    ...tap(CHALK_BTN),
    { do: 'wait', ticks: 18 },
    at('chalkRace0', RACE0),
    ...tap(RACE0),
    { do: 'wait', ticks: 6 },
    { do: 'expect', label: 'RACE closes the screen and counts down from 3', test: (s) => s.ui.chalkOpen === false && s.ui.chalkMode === 'countdown' && s.ui.chalkCountdown === 3 && Number.isFinite(s.ui.ghostZ) },
    { do: 'wait', ticks: 66 },
    { do: 'expect', label: 'the countdown reaches 2 while the skater waits', test: (s, h) => s.ui.chalkCountdown === 2 && h.slice(-8).every((q) => q.x === s.x && q.z === s.z) && h[h.length - 1].tick > h[h.length - 8].tick },
    { do: 'wait', ticks: 12 },
    { do: 'shot', name: 'chalk-countdown' },
    { do: 'wait', ticks: 102 },
    { do: 'expect', label: 'GO: the race is on', test: (s, h) => ev(h, 'chalkGo') || (s.ui.chalkMode === 'racing' && s.ui.chalkCountdown === 0) },
    // Set off a little late, so the ghost leads.
    { do: 'wait', ticks: 40 },
    ...SKATE.slice(0, 4),
    { do: 'shot', name: 'chalk-race' },
    {
      do: 'expect',
      label: 'the ghost skates its line while the race runs',
      test: (s, h) => s.ui.chalkMode === 'racing' && new Set(h.filter((q) => q.ui.chalkMode === 'racing').map((q) => q.ui.ghostZ)).size > 10,
    },
    ...SKATE.slice(4),
    // The race ends either when the skater reaches the finish ring or 20 s after the ghost has
    // finished. Which of the two happens, and so which result it is, depends on the exact run and
    // changes whenever the controller does; what must hold is that a result ticket appears with
    // its matching toast, and then clears.
    { do: 'wait', ticks: 60 },
    { do: 'shot', name: 'chalk-result-early' },
    { do: 'wait', ticks: 1240 },
    { do: 'shot', name: 'chalk-result' },
    { do: 'wait', ticks: 600 },
    {
      do: 'expect',
      label: 'the race ended with a result ticket and a matching ticket toast, and the ticket cleared',
      test: (s, h) => {
        const shown = h.find((q) => q.ui.chalkResult === 'won' || q.ui.chalkResult === 'lost');
        return (
          shown !== undefined &&
          h.some((q) => q.ui.lastToast === `chalk-${shown.ui.chalkResult}`) &&
          s.ui.chalkMode === 'idle' &&
          s.ui.chalkResult === '' &&
          s.ui.chalkLines === 1 &&
          !Number.isFinite(s.ui.ghostZ)
        );
      },
    },
  ],
};
