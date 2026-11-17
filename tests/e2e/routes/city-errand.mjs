// M5b things to do: in the city at the new-game spawn (the lookout at the top of the Mercado Steps,
// where the funicular errand's giver stands), hold still to take the errand, then open the ledger,
// look at each tab and close it. The only open-loop touch script is the first seconds at the
// spawn; controls are tapped at fixed points, each preceded by an expect that the control's centre
// (from the UI's test state) is where the route taps, so a layout change fails loudly.
const near = (s, key, pt) => Math.abs(s.ui[key + 'X'] - pt.x) <= 6 && Math.abs(s.ui[key + 'Y'] - pt.y) <= 6;
const at = (key, pt) => ({ do: 'expect', label: `the ${key} control is at (${pt.x}, ${pt.y})`, test: (s) => near(s, key, pt) });
const tap = (pt) => [{ do: 'down', x: pt.x, y: pt.y }, { do: 'up' }];

const LEDGER_BTN = { x: 31, y: 193 };
const TAB_CONDUCTORS = { x: 195, y: 140 };
const TAB_SECRETS = { x: 195, y: 188 };
const CLOSE = { x: 347, y: 31 };

export default {
  name: 'city-errand',
  params: 'world=city&t=0.42',
  steps: [
    { do: 'wait', ticks: 2 },
    { do: 'expect', label: 'starts at the lookout, offered the funicular errand', test: (s) => s.mode === 'GROUND' && s.ui.errandOffered === 'funicular_valve' && s.ui.errandOfferFill === 0 },
    // Hold still: the touch arms, then the offer's punch fills.
    { do: 'down', x: 195, y: 560 },
    { do: 'wait', ticks: 24 },
    {
      do: 'expect',
      label: 'holding still fills the offer part way',
      test: (s) => s.armed === true && s.ui.errandOffered === 'funicular_valve' && s.ui.errandOfferFill > 15 && s.ui.errandOfferFill < 90 && s.ui.errandActive === '',
    },
    { do: 'shot', name: 'errand-offer' },
    { do: 'wait', ticks: 30 },
    {
      do: 'expect',
      label: 'kept long enough, the errand starts with its full time',
      test: (s) => s.ui.errandActive === 'funicular_valve' && s.ui.errandStep === 0 && s.ui.errandLeft > 140 && s.ui.errandOffered === '',
    },
    { do: 'up' },
    { do: 'wait', ticks: 12 },
    { do: 'shot', name: 'errand-active' },
    { do: 'wait', ticks: 60 },
    { do: 'expect', label: 'the clock runs', test: (s) => s.ui.errandActive === 'funicular_valve' && s.ui.errandLeft < 150 && s.ui.errandLeft > 140 },
    at('ledgerBtn', LEDGER_BTN),
    ...tap(LEDGER_BTN),
    { do: 'wait', ticks: 18 },
    {
      do: 'expect',
      label: 'the ledger opens on the errands tab and pauses play',
      test: (s, h) => s.ui.ledgerOpen === true && s.ui.ledgerTab === 'errands' && h[h.length - 1].tick === h[h.length - 3].tick,
    },
    { do: 'shot', name: 'ledger-errands' },
    at('ledgerTabConductors', TAB_CONDUCTORS),
    ...tap(TAB_CONDUCTORS),
    { do: 'wait', ticks: 18 },
    { do: 'expect', label: 'the conductors tab', test: (s) => s.ui.ledgerOpen === true && s.ui.ledgerTab === 'conductors' && s.ui.conductorsPunched === 0 },
    { do: 'shot', name: 'ledger-conductors' },
    at('ledgerTabSecrets', TAB_SECRETS),
    ...tap(TAB_SECRETS),
    { do: 'wait', ticks: 18 },
    { do: 'expect', label: 'the secrets tab', test: (s) => s.ui.ledgerOpen === true && s.ui.ledgerTab === 'secrets' && s.ui.secretsFound === 0 },
    { do: 'shot', name: 'ledger-secrets' },
    at('ledgerClose', CLOSE),
    ...tap(CLOSE),
    { do: 'wait', ticks: 12 },
    {
      do: 'expect',
      label: 'closing the ledger resumes play with the errand still running',
      test: (s, h) => s.ui.ledgerOpen === false && s.ui.errandActive === 'funicular_valve' && h[h.length - 1].tick > h[h.length - 3].tick,
    },
  ],
};
