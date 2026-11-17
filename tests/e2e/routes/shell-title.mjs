// M6a app shell: the title screen over the paused slice, PLAY, the pause card, settings from the
// pause card (music volume set by a tap and then a drag on its row of flaps, haptics off, all
// written to storage), back to play, QUIT TO TITLE (still PLAY: changed settings are not a game to
// continue), 30 s of play, QUIT TO TITLE again (now CONTINUE and NEW GAME), the NEW GAME tear-off
// ticket, and RESET SAVE from settings: its two confirmations on different controls, KEEP backing
// out, then the wipe putting the skater back at the spawn and the title back to PLAY.
//
// The runner cannot reload the page, so "survives a reload" is checked by reading back what the
// app wrote to localStorage (`storedMusic` / `storedHaptics` are parsed from the stored save, not
// from memory). The route runs with `save` so storage is in use.
const near = (s, key, pt) => Math.abs(s.ui[key + 'X'] - pt.x) <= 6 && Math.abs(s.ui[key + 'Y'] - pt.y) <= 6;
const at = (key, pt) => ({ do: 'expect', label: `the ${key} control is at (${pt.x}, ${pt.y})`, test: (s) => near(s, key, pt) });
const tap = (pt) => [{ do: 'down', x: pt.x, y: pt.y }, { do: 'up' }];
const still = (h) => h[h.length - 1].tick === h[h.length - 3].tick;
const moving = (h) => h[h.length - 1].tick > h[h.length - 3].tick;

const PLAY = { x: 195, y: 714 };
const T_SETTINGS = { x: 282, y: 788 };
const PAUSE_BTN = { x: 31, y: 139 };
const P_RESUME = { x: 206, y: 357 };
const P_SETTINGS = { x: 206, y: 481 };
const P_QUIT = { x: 206, y: 539 };
const MUSIC6 = { x: 218, y: 169 };
const HAPTICS = { x: 337, y: 363 };
const CLOSE = { x: 347, y: 31 };
const MUSIC_DRAG_TO = { x: 145, y: 169 };
const NEW_GAME = { x: 108, y: 788 };
const KEEP = { x: 228, y: 460 };
const RESET = { x: 112, y: 643 };
const WIPE1 = { x: 281, y: 460 };
const KEEP1 = { x: 131, y: 460 };
const WIPE2 = { x: 131, y: 460 };
const shown = (s, key) => typeof s.ui[key + 'X'] === 'number';

export default {
  name: 'shell-title',
  params: 'slice&title&save&t=0.330556',
  steps: [
    { do: 'wait', ticks: 72 },
    {
      do: 'expect',
      label: 'the title is open over a paused game, offering PLAY (no save yet), with the wordmark flipped in',
      test: (s, h) => s.ui.titleOpen === true && s.ui.titlePlayLabel === 'PLAY' && s.ui.wordmark === 'SKITCH' && still(h) && s.ui.pauseBtnX === -1,
    },
    { do: 'shot', name: 'title' },
    at('titlePlay', PLAY),
    ...tap(PLAY),
    { do: 'wait', ticks: 30 },
    { do: 'expect', label: 'PLAY closes the title and play runs', test: (s, h) => s.ui.titleOpen === false && moving(h) && s.ui.pauseBtnX > 0 },
    at('pauseBtn', PAUSE_BTN),
    ...tap(PAUSE_BTN),
    { do: 'wait', ticks: 12 },
    { do: 'expect', label: 'the pause button opens the pause card and play stops', test: (s, h) => s.ui.pauseOpen === true && still(h) },
    { do: 'shot', name: 'pause' },
    at('pauseSettings', P_SETTINGS),
    ...tap(P_SETTINGS),
    { do: 'wait', ticks: 12 },
    {
      do: 'expect',
      label: 'SETTINGS opens the settings screen at the defaults, still paused',
      test: (s, h) => s.ui.settingsOpen === true && s.ui.setMusic === 10 && s.ui.setHaptics === true && s.ui.setRiso === true && still(h),
    },
    {
      do: 'expect',
      label: 'the slider steps and its row are thumb-sized controls (the row of flaps is one control)',
      test: (s) => shown(s, 'setMusicRow') && shown(s, 'setMusicDown') && shown(s, 'setMusicUp'),
    },
    at('setMusic6', MUSIC6),
    ...tap(MUSIC6),
    { do: 'wait', ticks: 6 },
    { do: 'expect', label: 'a tap on the sixth flap sets music to 6', test: (s) => s.ui.setMusic === 6 },
    // A drag along the row follows the finger: down to the flap under it, then back to the sixth.
    { do: 'down', x: MUSIC6.x, y: MUSIC6.y },
    { do: 'move', x: MUSIC6.x - 30, y: MUSIC6.y },
    { do: 'move', x: MUSIC_DRAG_TO.x, y: MUSIC_DRAG_TO.y },
    { do: 'wait', ticks: 2 },
    { do: 'expect', label: 'dragging left along the row lowers the music to the flap under the finger', test: (s) => s.ui.setMusic > 0 && s.ui.setMusic < 6 },
    { do: 'move', x: MUSIC6.x, y: MUSIC6.y },
    { do: 'up' },
    { do: 'wait', ticks: 4 },
    at('setHapticsBtn', HAPTICS),
    ...tap(HAPTICS),
    { do: 'wait', ticks: 12 },
    { do: 'expect', label: 'music is at 6 of 10 and haptics are off', test: (s) => s.ui.setMusic === 6 && s.ui.setHaptics === false },
    {
      do: 'expect',
      label: 'both settings are in the save written to storage',
      test: (s) => s.ui.storedMusic === 6 && s.ui.storedHaptics === 'false',
    },
    { do: 'shot', name: 'settings' },
    at('setClose', CLOSE),
    ...tap(CLOSE),
    { do: 'wait', ticks: 6 },
    { do: 'expect', label: 'CLOSE goes back to the pause card', test: (s, h) => s.ui.settingsOpen === false && s.ui.pauseOpen === true && still(h) },
    at('pauseResume', P_RESUME),
    ...tap(P_RESUME),
    { do: 'wait', ticks: 30 },
    { do: 'expect', label: 'RESUME closes the card and play runs again with the new settings', test: (s, h) => s.ui.pauseOpen === false && moving(h) && s.ui.setMusic === 6 },
    ...tap(PAUSE_BTN),
    { do: 'wait', ticks: 12 },
    at('pauseQuit', P_QUIT),
    ...tap(P_QUIT),
    { do: 'wait', ticks: 72 },
    {
      do: 'expect',
      label: 'with only settings changed and a few seconds played, the title still offers PLAY, not CONTINUE',
      test: (s, h) => s.ui.titleOpen === true && s.ui.titlePlayLabel === 'PLAY' && !shown(s, 'titleNew') && still(h),
    },
    ...tap(PLAY),
    { do: 'wait', ticks: 30 * 60 },
    { do: 'expect', label: 'thirty seconds of play', test: (s) => s.ui.titleOpen === false && s.ui.playSeconds >= 30 },
    ...tap(PAUSE_BTN),
    { do: 'wait', ticks: 12 },
    ...tap(P_QUIT),
    { do: 'wait', ticks: 72 },
    {
      do: 'expect',
      label: 'QUIT TO TITLE shows the title again, now offering CONTINUE and NEW GAME',
      test: (s, h) => s.ui.titleOpen === true && s.ui.pauseOpen === false && s.ui.titlePlayLabel === 'CONTINUE' && still(h),
    },
    at('titleNew', NEW_GAME),
    ...tap(NEW_GAME),
    { do: 'wait', ticks: 12 },
    { do: 'expect', label: 'NEW GAME asks first, on a tear-off ticket', test: (s) => s.ui.titleConfirm === true },
    { do: 'shot', name: 'title-confirm' },
    at('titleKeep', KEEP),
    ...tap(KEEP),
    { do: 'wait', ticks: 6 },
    { do: 'expect', label: 'KEEP leaves the save alone', test: (s) => s.ui.titleConfirm === false && s.ui.titlePlayLabel === 'CONTINUE' && s.ui.storedMusic === 6 },
    // RESET SAVE, from the title's settings.
    at('titleSettings', T_SETTINGS),
    ...tap(T_SETTINGS),
    { do: 'wait', ticks: 12 },
    at('setReset', RESET),
    ...tap(RESET),
    { do: 'wait', ticks: 6 },
    {
      do: 'expect',
      label: 'RESET SAVE opens a tear-off ticket asking first, its wipe control away from where the tap landed',
      test: (s) => shown(s, 'setResetWipe1') && shown(s, 'setResetKeep1') && !shown(s, 'setResetWipe2') && Math.hypot(s.ui.setResetWipe1X - RESET.x, s.ui.setResetWipe1Y - RESET.y) > 60,
    },
    { do: 'shot', name: 'settings-reset' },
    at('setResetKeep1', KEEP1),
    ...tap(KEEP1),
    { do: 'wait', ticks: 6 },
    { do: 'expect', label: 'KEEP closes the ticket and the save is still there', test: (s) => !shown(s, 'setResetWipe1') && s.ui.storedMusic === 6 },
    ...tap(RESET),
    { do: 'wait', ticks: 6 },
    at('setResetWipe1', WIPE1),
    ...tap(WIPE1),
    { do: 'wait', ticks: 6 },
    {
      do: 'expect',
      label: 'the first WIPE asks again on a different control on the other side; a second tap on the same spot lands on KEEP',
      test: (s) => !shown(s, 'setResetWipe1') && shown(s, 'setResetWipe2') && near(s, 'setResetKeep2', WIPE1) && s.ui.storedMusic === 6,
    },
    at('setResetWipe2', WIPE2),
    ...tap(WIPE2),
    { do: 'wait', ticks: 6 },
    {
      do: 'expect',
      label: 'the second WIPE wipes: settings back to defaults, nothing stored, the skater back where the route started (the spawn)',
      test: (s, h) => !shown(s, 'setResetWipe2') && s.ui.setMusic === 10 && s.ui.setHaptics === true && s.ui.storedMusic === -1 && Math.hypot(s.x - h[0].x, s.z - h[0].z) < 1,
    },
    at('setClose', CLOSE),
    ...tap(CLOSE),
    { do: 'wait', ticks: 12 },
    { do: 'expect', label: 'after the wipe the title offers PLAY again', test: (s) => s.ui.titleOpen === true && s.ui.titlePlayLabel === 'PLAY' },
  ],
};
