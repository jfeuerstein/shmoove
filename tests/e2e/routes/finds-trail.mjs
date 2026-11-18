// M7f finds, on the finds fixture (the slice with things to find): from the lookout the skater
// rolls straight down the street through a trail of three tiles (the counter climbs, the first and
// third unlock decks), clears the spot below them at speed (its stamp), then opens the ledger's
// album and puts on the first deck it earned; further down, the fountain's postcard brings a kit,
// which goes on too. Controls are tapped at fixed points, each preceded by
// an expect that the control's centre (from the UI's test state) is there, so a layout change
// fails loudly.
const near = (s, key, pt) => Math.abs(s.ui[key + 'X'] - pt.x) <= 6 && Math.abs(s.ui[key + 'Y'] - pt.y) <= 6;
const at = (key, pt) => ({ do: 'expect', label: `the ${key} control is at (${pt.x}, ${pt.y})`, test: (s) => near(s, key, pt) });
const tap = (pt) => [{ do: 'down', x: pt.x, y: pt.y }, { do: 'up' }];

const MAP_BTN = { x: 31, y: 31 };
const LEDGER_BTN = { x: 31, y: 193 };
const TAB_ALBUM = { x: 195, y: 236 };
const WEAR_MANGO = { x: 141, y: 383 };
const WEAR_BRICK = { x: 230, y: 481 };
const CLOSE = { x: 347, y: 31 };

export default {
  name: 'finds-trail',
  params: 'world=finds&t=0.42',
  steps: [
    { do: 'wait', ticks: 2 },
    {
      do: 'expect',
      label: 'at the lookout with nothing found, the trail drawn ahead',
      test: (s) => s.mode === 'GROUND' && s.finds.count === 0 && s.finds.drawn >= 3 && s.finds.deck === 'deck.street',
    },
    { do: 'wait', ticks: 120 },
    { do: 'shot', name: 'trail-ahead' },
    { do: 'wait', ticks: 38 },
    {
      do: 'expect',
      label: 'rolling down through the first tile takes it: the counter, a burst, the first deck',
      test: (s) => s.finds.count === 1 && s.finds.bursts > 0 && s.ui.findsCounter === 'TILE 1/12' && s.ui.findsTickets.includes('unlock'),
    },
    { do: 'shot', name: 'tile-1' },
    { do: 'wait', ticks: 118 },
    {
      do: 'expect',
      label: 'the third tile in the trail: one counter, now at three, and a second deck',
      test: (s) => s.finds.count === 3 && s.ui.findsCounter === 'TILE 3/12' && s.ui.findsTickets.split(',').filter((k) => k === 'tile').length === 1,
    },
    { do: 'shot', name: 'tile-3' },
    { do: 'wait', ticks: 72 },
    {
      do: 'expect',
      label: 'clearing the spot below at speed stamps it',
      test: (s) => s.speed >= 8 && s.ui.findsTickets.split(',')[0] === 'spot' && s.ui.findsSpots === 1,
    },
    { do: 'shot', name: 'spot' },
    at('ledgerBtn', LEDGER_BTN),
    ...tap(LEDGER_BTN),
    { do: 'wait', ticks: 18 },
    { do: 'expect', label: 'the ledger opens', test: (s) => s.ui.ledgerOpen === true },
    at('ledgerTabAlbum', TAB_ALBUM),
    ...tap(TAB_ALBUM),
    { do: 'wait', ticks: 18 },
    {
      do: 'expect',
      label: 'the album: three tiles, one spot, the two decks earned unlocked',
      test: (s) => s.ui.ledgerTab === 'album' && s.ui.albumTiles === '3/12' && s.ui.albumSpots === '1/3' && s.ui.albumOpen === 4,
    },
    { do: 'shot', name: 'album' },
    at('wear.deck.mangoCheck', WEAR_MANGO),
    ...tap(WEAR_MANGO),
    { do: 'wait', ticks: 12 },
    { do: 'expect', label: 'tapping an unlocked deck puts it on', test: (s) => s.finds.deck === 'deck.mangoCheck' && s.ui.albumWorn.includes('deck.mangoCheck') },
    { do: 'shot', name: 'wardrobe' },
    at('ledgerClose', CLOSE),
    ...tap(CLOSE),
    { do: 'wait', ticks: 24 },
    { do: 'expect', label: 'play resumes with the new deck on', test: (s) => s.ui.ledgerOpen === false && s.finds.deck === 'deck.mangoCheck' },
    // On down the hill: the timed route from the lookout ends, then the fountain sends a postcard
    // and its kit.
    { do: 'wait', ticks: 760 },
    {
      do: 'expect',
      label: 'the route is timed and the fountain sends a postcard, which unlocks a kit',
      test: (s) => s.ui.findsTickets.includes('postcard') && s.ui.findsTickets.includes('unlock') && s.ui.albumOpen === 5,
    },
    { do: 'shot', name: 'postcard' },
    ...tap(LEDGER_BTN),
    { do: 'wait', ticks: 18 },
    { do: 'expect', label: 'the ledger opens on the album again', test: (s) => s.ui.ledgerOpen === true && s.ui.ledgerTab === 'album' },
    at('wear.kit.brickPaper', WEAR_BRICK),
    ...tap(WEAR_BRICK),
    { do: 'wait', ticks: 6 },
    { do: 'expect', label: 'the kit goes on beside the deck', test: (s) => s.finds.kit === 'kit.brickPaper' && s.finds.deck === 'deck.mangoCheck' },
    ...tap(CLOSE),
    { do: 'wait', ticks: 12 },
    { do: 'expect', label: 'play resumes in the new deck and kit', test: (s) => s.ui.ledgerOpen === false && s.mode !== 'BAIL' },
    { do: 'shot', name: 'worn' },
    // The line map counts tiles and spots per district.
    ...tap(MAP_BTN),
    { do: 'wait', ticks: 18 },
    { do: 'expect', label: 'the line map opens', test: (s) => s.ui.mapOpen === true },
    { do: 'shot', name: 'map' },
  ],
};
