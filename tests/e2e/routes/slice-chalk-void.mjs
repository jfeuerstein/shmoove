// M5a chalk lines, import: a shared link carries a code with one character changed in transit.
// The import box opens with it pasted; ADD stamps it VOID with the reason and adds nothing.
const GOOD =
  'SK2-AgtNaXJhZG9yIHJ1buY3AAAAAAAA-D99-QxZVft0QBgtRFT7IQnA4Q6lBuQ08j_Z0Z5Ag9MGQsPyjUPgAQ_AD7f_An9iFaQJUlKsPjjPfGOv';
// The 'B' at index 60 became a 'Q'.
const BAD = GOOD.slice(0, 60) + 'Q' + GOOD.slice(61);
const near = (s, key, pt) => Math.abs(s.ui[key + 'X'] - pt.x) <= 6 && Math.abs(s.ui[key + 'Y'] - pt.y) <= 6;
const ADD = { x: 123, y: 264 };

export default {
  name: 'slice-chalk-void',
  params: `slice&t=0.330556&chalk=${BAD}`,
  steps: [
    { do: 'wait', ticks: 18 },
    {
      do: 'expect',
      label: 'a chalk link opens the import box, paused, with nothing imported yet',
      test: (s, h) => s.ui.chalkOpen === true && s.ui.chalkView === 'import' && s.ui.chalkLines === 0 && s.ui.chalkError === '' && h[h.length - 1].tick === h[0].tick,
    },
    { do: 'expect', label: `the ADD control is at (${ADD.x}, ${ADD.y})`, test: (s) => near(s, 'chalkAdd', ADD) },
    { do: 'down', x: ADD.x, y: ADD.y },
    { do: 'up' },
    { do: 'wait', ticks: 6 },
    {
      do: 'expect',
      label: 'ADD stamps the damaged code VOID with a reason and keeps the list unchanged',
      test: (s) => s.ui.chalkError === 'checksum mismatch' && s.ui.chalkLines === 0 && s.ui.chalkView === 'import',
    },
    { do: 'shot', name: 'chalk-void' },
  ],
};
