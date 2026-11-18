/**
 * The DOM overlay: destination board, chain meter, hold cue, ticket toasts, stop timetable board,
 * errand offer and stub, conductor chip, and the line map, chalk and ledger screens. An observer of the game: it reads state and events and never writes
 * them; the only thing it feeds back is `paused`, which main.ts honours by not stepping.
 */
import type { Game, GameEvent } from '../sim/game/game';
import { inkedCount, lineSegments, mapFraction, type Segment } from '../sim/game/progress';
import { Mode, type SimEvent } from '../sim/types';
import { DISTRICT_NAMES, districtAt } from '../sim/world';
import { chalkClock, chalkDefaultName, chalkTime } from './chalkFormat';
import { ChalkHud } from './chalkHud';
import { ChalkScreen } from './chalkScreen';
import { injectChalkStyle } from './chalkStyle';
import { DestinationBoard } from './board';
import { ChainMeter } from './chain';
import { ConductorHud } from './conductorHud';
import { ClassSlot, el } from './dom';
import { SECRET_INFO, failText, taskText, ticksClock } from './errandFormat';
import { ErrandHud } from './errandHud';
import { findsTicket, swatchCss } from './findsFormat';
import { injectFindsStyle } from './findsStyle';
import { HintStub, type HintPointerScreen } from './hint';
import { injectHintStyle } from './hintStyle';
import { injectErrandStyle } from './errandStyle';
import { LedgerScreen } from './ledgerScreen';
import { injectLedgerStyle } from './ledgerStyle';
import { LineMap } from './lineMap';
import { StopBoard } from './stopBoard';
import { injectStyle } from './style';
import { clockMinutes, clockText } from './format';
import { Shell, type ShellHost } from './titleShell';
import { Toasts } from './toasts';
import { Twos } from './twos';

export interface UiFrame {
  game: Game;
  /** gestures.isArmed */
  armed: boolean;
  /** All sim events since the last frame. */
  simEvents: readonly SimEvent[];
  /** All game events since the last frame. */
  gameEvents: readonly GameEvent[];
  /** Seconds since the last frame. */
  dt: number;
  /** Where the onboarding pointer's world target is on screen (the hint view's projection), if any. */
  pointer?: HintPointerScreen;
}

export interface UiSound {
  ui(name: 'tick' | 'punch' | 'ink' | 'fanfare' | 'deny'): void;
}

export interface Ui {
  update(f: UiFrame): void;
  /** True while a screen that pauses play is open (line map, chalk screen, ledger, title, pause, settings, ...). main.ts stops stepping the sim. */
  readonly paused: boolean;
  /** Open the chalk screen's import box with a code already pasted (a shared link). */
  openChalkImport(code: string): void;
  /** Flat facts for the e2e hook. */
  testState(): Record<string, string | number | boolean>;
  dispose(): void;
}

const MAP_ICON =
  '<svg class="sk-icon" viewBox="0 0 30 30" aria-hidden="true">' +
  '<path d="M4 22 L12 14 L19 18 L26 7" stroke="#FFAE1A" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<path d="M5 8 L13 8 L15 24 L25 24" stroke="#FF2E88" stroke-width="2.4" fill="none" stroke-dasharray="3.5 2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<circle cx="12" cy="14" r="2.6" fill="#F3EBDD" stroke="#1B1A2E" stroke-width="1"/>' +
  '<circle cx="19" cy="18" r="2.6" fill="#F3EBDD" stroke="#1B1A2E" stroke-width="1"/>' +
  '</svg>' +
  '<svg class="sk-x" viewBox="0 0 30 30" aria-hidden="true">' +
  '<path d="M8 8 L22 22 M22 8 L8 22" stroke="#FFAE1A" stroke-width="3.4" stroke-linecap="round"/>' +
  '</svg>';

const CHALK_ICON =
  '<svg class="sk-icon" viewBox="0 0 30 30" aria-hidden="true">' +
  '<path d="M4 25 C9 21 13 26 17 21 S24 15 27 17" stroke="#FBF6EC" stroke-width="2.6" fill="none" stroke-dasharray="1 3.6" stroke-linecap="round"/>' +
  '<rect x="13" y="3.5" width="6" height="16" rx="1.5" transform="rotate(38 16 11.5)" fill="#FBF6EC" stroke="#1B1A2E" stroke-width="1"/>' +
  '<rect x="13" y="3.5" width="6" height="5" rx="1.5" transform="rotate(38 16 11.5)" fill="#FF2E88"/>' +
  '</svg>' +
  '<span class="sk-stoptxt"><i></i>STOP</span>' +
  '<svg class="sk-x" viewBox="0 0 30 30" aria-hidden="true">' +
  '<path d="M8 8 L22 22 M22 8 L8 22" stroke="#FF2E88" stroke-width="3.4" stroke-linecap="round"/>' +
  '</svg>';

const LEDGER_ICON =
  '<svg viewBox="0 0 30 30" aria-hidden="true">' +
  '<rect x="6" y="5" width="19" height="22" rx="1.5" fill="#1F3FBF"/>' +
  '<rect x="5" y="4" width="19" height="22" rx="1.5" fill="#F3EBDD"/>' +
  '<rect x="5" y="4" width="19" height="5" rx="1.5" fill="#FFAE1A"/>' +
  '<path d="M8.5 13.5 H20.5 M8.5 17.5 H20.5 M8.5 21.5 H15" stroke="#1B1A2E" stroke-width="1.8" stroke-linecap="round"/>' +
  '<circle cx="20" cy="21.5" r="2.4" fill="#FF2E88"/>' +
  '</svg><i class="sk-ldot"></i>';

/** How long the tile counter stays up after the last tile, s. */
const TILE_COUNTER_S = 2;

/** `shell` adds the title, pause, settings, map-complete and rotate screens (src/ui/titleShell.ts). */
export function createUi(root: HTMLElement, game: Game, sound: UiSound | null, shellHost: ShellHost | null = null): Ui {
  const releaseStyle = injectStyle();
  const releaseChalkStyle = injectChalkStyle();
  const releaseErrandStyle = injectErrandStyle();
  const releaseLedgerStyle = injectLedgerStyle();
  const releaseHintStyle = injectHintStyle();
  const releaseFindsStyle = injectFindsStyle();
  const lines = game.sim.world.lines;
  const segs: Segment[][] = lines.map(lineSegments);

  const hud = el('div', 'sk-hud');
  if (root.querySelector('.feel')) hud.classList.add('sk-debug');
  const stopUp = new ClassSlot(hud, 'sk-stopup');

  const twos = new Twos();
  const board = new DestinationBoard(game, twos);
  const chain = new ChainMeter(game, twos);
  const toasts = new Toasts(sound, twos);
  const stopBoard = new StopBoard(game, stopUp, twos);
  const hint = new HintStub(game, twos, sound);
  const hold = el('div', 'sk-hold');
  const holdOn = new ClassSlot(hold, 'sk-on');
  const holdFull = new ClassSlot(hold, 'sk-full');

  let mapOpen = false;
  let chalkOpen = false;
  let ledgerOpen = false;
  const setOpen = (open: boolean): void => {
    if (open === mapOpen) return;
    if (open) {
      setChalkOpen(false, true);
      setLedgerOpen(false, true);
    }
    mapOpen = open;
    hud.classList.toggle('sk-open', open);
    mapBtn.setAttribute('aria-expanded', String(open));
    mapBtn.setAttribute('aria-label', open ? 'Close the line map' : 'Open the line map');
    if (open) {
      map.render();
      twos.play(map.el, 'sk-r1', 'sk-r2');
    } else twos.cancel(map.el);
    sound?.ui('tick');
  };
  const toggle = (): void => setOpen(!mapOpen);

  const map = new LineMap(game, twos, () => setOpen(false), () => sound?.ui('tick'));

  // Chalk lines: the button under the map button, the screen, and the in-play pieces.
  const chalkHud = new ChalkHud(game, twos);
  /** The name prompt is saving a recording: its chalkRecordStop is expected. */
  let uiStopping = false;
  const chalkScreen: ChalkScreen = new ChalkScreen(game, twos, {
    close: () => setChalkOpen(false),
    tap: () => sound?.ui('tick'),
    drew: () => setChalkOpen(false, true),
    raced: () => setChalkOpen(false, true),
    named: (stopped) => {
      uiStopping = stopped;
      setChalkOpen(false, true);
    },
  });
  function setChalkOpen(open: boolean, quiet = false): void {
    if (open === chalkOpen) return;
    if (open) {
      setOpen(false);
      setLedgerOpen(false, true);
    }
    chalkOpen = open;
    hud.classList.toggle('sk-chalkopen', open);
    chalkBtn.setAttribute('aria-expanded', String(open));
    if (open) twos.play(chalkScreen.el, 'sk-r1', 'sk-r2');
    else {
      twos.cancel(chalkScreen.el);
      chalkScreen.show('list');
    }
    if (!quiet) sound?.ui('tick');
  }
  const defaultName = (): string => {
    const p = game.sim.player;
    return chalkDefaultName(DISTRICT_NAMES[districtAt(game.sim.world, p.z)], game.sim.dayFrac);
  };
  const chalkAction = (): void => {
    const mode = game.chalk.mode;
    if (mode === 'recording') {
      setChalkOpen(true);
      chalkScreen.promptName(defaultName());
    } else if (mode === 'countdown' || mode === 'racing') {
      game.chalkAbortRace();
      sound?.ui('tick');
    } else if (chalkOpen) setChalkOpen(false);
    else {
      setChalkOpen(true);
      chalkScreen.show('list');
    }
  };

  const chalkBtn = el('button', 'sk-chalkbtn');
  chalkBtn.type = 'button';
  chalkBtn.innerHTML = CHALK_ICON;
  chalkBtn.dataset.sk = 'chalkBtn';
  chalkBtn.setAttribute('aria-label', 'Chalk lines');
  chalkBtn.setAttribute('aria-expanded', 'false');
  let chalkPointer = -1;
  const onChalkDown = (e: PointerEvent): void => {
    chalkPointer = e.pointerId;
    e.preventDefault();
    e.stopPropagation();
  };
  const onChalkUp = (e: PointerEvent): void => {
    if (e.pointerId !== chalkPointer) return;
    chalkPointer = -1;
    e.preventDefault();
    e.stopPropagation();
    chalkAction();
  };
  const onChalkCancel = (): void => {
    chalkPointer = -1;
  };
  const onChalkClick = (e: MouseEvent): void => {
    if (e.detail === 0) chalkAction();
  };
  chalkBtn.addEventListener('pointerdown', onChalkDown);
  chalkBtn.addEventListener('pointerup', onChalkUp);
  chalkBtn.addEventListener('pointercancel', onChalkCancel);
  chalkBtn.addEventListener('click', onChalkClick);
  let lastChalkMode = '';
  const recording = new ClassSlot(hud, 'sk-recording');
  const racing = new ClassSlot(hud, 'sk-racing');

  // Errands, conductors, secrets: the in-play pieces, the ledger screen and its button.
  const errandHud = new ErrandHud(game, twos);
  const conductorHud = new ConductorHud(game, twos);
  const errandOn = new ClassSlot(hud, 'sk-errand');
  const offering = new ClassSlot(hud, 'sk-offering');
  const hinting = new ClassSlot(hud, 'sk-hinting');
  const ledger = new LedgerScreen(game, twos, {
    close: () => setLedgerOpen(false),
    tap: () => sound?.ui('tick'),
  });
  const ledgerBtn = el('button', 'sk-ledgerbtn');
  ledgerBtn.type = 'button';
  ledgerBtn.innerHTML = LEDGER_ICON;
  ledgerBtn.dataset.sk = 'ledgerBtn';
  ledgerBtn.setAttribute('aria-label', 'Ledger: errands, conductors, secrets, album');
  ledgerBtn.setAttribute('aria-expanded', 'false');
  /** Something new went into the ledger since it was last opened. */
  const news = new ClassSlot(ledgerBtn, 'sk-news');
  function setLedgerOpen(open: boolean, quiet = false): void {
    if (open === ledgerOpen) return;
    if (open) {
      setOpen(false);
      setChalkOpen(false, true);
    }
    ledgerOpen = open;
    hud.classList.toggle('sk-ledgeropen', open);
    ledgerBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      news.set(false);
      ledger.render();
      twos.play(ledger.el, 'sk-r1', 'sk-r2');
    } else twos.cancel(ledger.el);
    if (!quiet) sound?.ui('tick');
  }
  let ledgerPointer = -1;
  const onLedgerDown = (e: PointerEvent): void => {
    ledgerPointer = e.pointerId;
    e.preventDefault();
    e.stopPropagation();
  };
  const onLedgerUp = (e: PointerEvent): void => {
    if (e.pointerId !== ledgerPointer) return;
    ledgerPointer = -1;
    e.preventDefault();
    e.stopPropagation();
    setLedgerOpen(!ledgerOpen);
  };
  const onLedgerCancel = (): void => {
    ledgerPointer = -1;
  };
  const onLedgerClick = (e: MouseEvent): void => {
    if (e.detail === 0) setLedgerOpen(!ledgerOpen);
  };
  ledgerBtn.addEventListener('pointerdown', onLedgerDown);
  ledgerBtn.addEventListener('pointerup', onLedgerUp);
  ledgerBtn.addEventListener('pointercancel', onLedgerCancel);
  ledgerBtn.addEventListener('click', onLedgerClick);

  const mapBtn = el('button', 'sk-mapbtn');
  mapBtn.type = 'button';
  mapBtn.innerHTML = MAP_ICON;
  mapBtn.setAttribute('aria-label', 'Open the line map');
  mapBtn.setAttribute('aria-expanded', 'false');
  // Toggle on pointer up after a pointer down on the button (taps), or on a keyboard click.
  let btnPointer = -1;
  const onBtnDown = (e: PointerEvent): void => {
    btnPointer = e.pointerId;
    e.preventDefault();
    e.stopPropagation();
  };
  const onBtnUp = (e: PointerEvent): void => {
    if (e.pointerId !== btnPointer) return;
    btnPointer = -1;
    e.preventDefault();
    e.stopPropagation();
    toggle();
  };
  const onBtnCancel = (): void => {
    btnPointer = -1;
  };
  const onBtnClick = (e: MouseEvent): void => {
    if (e.detail === 0) toggle();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    // Typing a name or a code is not a shortcut.
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
    if (e.code === 'KeyM') toggle();
    else if (e.code === 'KeyL') setLedgerOpen(!ledgerOpen);
    else if (e.code === 'Escape' && mapOpen) setOpen(false);
    else if (e.code === 'Escape' && chalkOpen) setChalkOpen(false);
    else if (e.code === 'Escape' && ledgerOpen) setLedgerOpen(false);
  };
  mapBtn.addEventListener('pointerdown', onBtnDown);
  mapBtn.addEventListener('pointerup', onBtnUp);
  mapBtn.addEventListener('pointercancel', onBtnCancel);
  mapBtn.addEventListener('click', onBtnClick);
  window.addEventListener('keydown', onKey);

  hud.append(
    board.el,
    chain.el,
    errandHud.stubEl,
    conductorHud.el,
    toasts.el,
    stopBoard.el,
    errandHud.offerEl,
    hint.el,
    hold,
    chalkHud.el,
    map.el,
    mapBtn,
    chalkBtn,
    ledgerBtn,
    hint.mapPointer,
    hint.edge,
    chalkScreen.el,
    ledger.el,
  );
  const shell = shellHost
    ? new Shell(game, twos, shellHost, {
        openMap: () => setOpen(true),
        openChalk: () => {
          setChalkOpen(true);
          chalkScreen.show('list');
        },
        openLedger: () => {
          setLedgerOpen(true);
          ledger.show('errands');
        },
        busy: () => mapOpen || chalkOpen || ledgerOpen,
        mapPercent: () => Math.floor(mapFraction(game.progress, lines) * 100),
        clock: () => clockText(clockMinutes(game.sim.dayFrac)),
        tap: () => sound?.ui('tick'),
        fanfare: () => sound?.ui('fanfare'),
      })
    : null;
  if (shell) hud.append(...shell.els);
  // Under anything already in the root (the debug panel stays on top and readable).
  root.prepend(hud);

  const segmentToast = (line: number, segment: number): void => {
    const L = lines[line];
    const g = segs[line][segment];
    toasts.show('inked', {
      line: L,
      title: 'Inked',
      body: `${L.allStops[g.from].name} → ${L.allStops[g.to].name}`,
      serial: game.sim.tick,
    });
  };

  const onGameEvent = (e: GameEvent): void => {
    switch (e.type) {
      case 'segmentInked':
        segmentToast(e.line, e.segment);
        break;
      case 'lineComplete':
        toasts.show('complete', { line: lines[e.line], title: 'Line complete', body: lines[e.line].name, serial: game.sim.tick });
        break;
      case 'lineDiscovered':
        toasts.show('discovered', { line: lines[e.line], title: 'Secret line', body: lines[e.line].name, serial: game.sim.tick });
        break;
      case 'mapComplete':
        toasts.show('map', { line: null, title: 'Map complete', body: 'Every line inked', serial: game.sim.tick });
        break;
      case 'chalkRecordStop': {
        const line = game.chalk.lines.find((l) => l.id === e.id);
        toasts.show('chalk-saved', {
          line: null,
          title: 'Chalk saved',
          body: `${line ? line.name : ''} · ${chalkClock(e.ticks)}`,
          serial: game.sim.tick,
        });
        // Stopped by the length cap rather than the name prompt: ask for a name now.
        if (!uiStopping && line) {
          setChalkOpen(true, true);
          chalkScreen.promptName(defaultName(), line.id);
        }
        uiStopping = false;
        break;
      }
      case 'chalkRecordDiscard':
        uiStopping = false;
        toasts.show('chalk-discarded', { line: null, title: 'Chalk wiped', body: e.reason, serial: game.sim.tick });
        break;
      case 'chalkFinish':
        toasts.show(e.won ? 'chalk-won' : 'chalk-lost', {
          line: null,
          title: e.won ? 'Ghost beaten' : 'Ghost wins',
          body: e.ticks > 0 ? `${chalkTime(e.ticks)} vs ${chalkTime(e.ghostTicks)}` : `Ghost ${chalkTime(e.ghostTicks)}`,
          serial: game.sim.tick,
        });
        break;
      case 'errandDone': {
        const def = game.errands.list.find((d) => d.id === e.id);
        toasts.show('errand-done', {
          line: null,
          title: def ? def.title : 'Errand',
          body: ticksClock(e.ticks),
          serial: game.sim.tick,
          stamp: 'DELIVERED',
          best: e.best,
        });
        news.set(true);
        break;
      }
      case 'errandFail': {
        const def = game.errands.list.find((d) => d.id === e.id);
        toasts.show('errand-fail', { line: null, title: def ? def.title : 'Errand', body: failText(e.reason), serial: game.sim.tick });
        break;
      }
      case 'conductorStart': {
        const L = lines[e.line];
        const def = game.conductors.list.find((c) => c.line === L.id);
        toasts.show('conductor', { line: L, title: 'Conductor', body: def ? taskText(game.sim.world, def) : L.name, serial: game.sim.tick });
        break;
      }
      case 'conductorPunch':
        toasts.show('conductor-punch', { line: lines[e.line], title: 'Punched', body: lines[e.line].name, serial: game.sim.tick });
        news.set(true);
        break;
      case 'secretFound':
        toasts.show('secret', { line: null, title: 'Secret found', body: SECRET_INFO[e.id].name, serial: game.sim.tick });
        news.set(true);
        break;
      default:
        findsToast(e);
        break;
    }
    chalkHud.onEvent(e);
    conductorHud.onEvent(e);
    hint.onEvent(e);
  };

  /** Finds: the tile counter (one at a time, two seconds), stamps, postcards, unlocks and bests. */
  const findsToast = (e: GameEvent): void => {
    const t = findsTicket(e);
    if (t === null) return;
    const data = { line: null, title: t.title, body: t.body, serial: game.sim.tick, stamp: t.stamp };
    if (t.kind === 'tile') {
      toasts.counter('tile', data, TILE_COUNTER_S);
      return;
    }
    if (e.type === 'unlock') {
      const it = game.finds.catalog.unlocks.find((u) => u.item.id === e.id);
      toasts.show('unlock', { ...data, swatch: it ? swatchCss(it.item) : undefined });
    } else toasts.show(t.kind, data);
    if (t.kind !== 'best') news.set(true);
  };

  const onSimEvent = (e: SimEvent): void => {
    if (e.type !== 'denied') return;
    // One denied ticket per line on screen at a time: the sim repeats the event while you hold.
    for (const t of toasts.queue.items) if (t.kind === 'denied' && t.data.line === lines[e.line]) return;
    toasts.show('denied', {
      line: lines[e.line],
      title: `Needs ${e.need} links`,
      body: lines[e.line].name,
      serial: game.sim.tick,
    });
  };

  let disposed = false;

  const chalkTestState = (): Record<string, string | number | boolean> => {
    const ch = game.chalk;
    const ghost = ch.ghost;
    const out: Record<string, string | number | boolean> = {
      chalkOpen,
      chalkView: chalkOpen ? chalkScreen.view : '',
      chalkLines: ch.lines.length,
      chalkMode: ch.mode,
      chalkCountdown: chalkHud.countdown,
      chalkResult: chalkHud.result,
      chalkCode: chalkOpen && chalkScreen.view === 'share' ? chalkScreen.code : '',
      chalkError: chalkScreen.error,
      chalkElapsed: ch.elapsedTicks,
      ghostX: ghost ? ghost.player.x : Number.NaN,
      ghostY: ghost ? ghost.player.y : Number.NaN,
      ghostZ: ghost ? ghost.player.z : Number.NaN,
    };
    const r = chalkBtn.getBoundingClientRect();
    out.chalkBtnX = Math.round(r.left + r.width / 2);
    out.chalkBtnY = Math.round(r.top + r.height / 2);
    if (chalkOpen) chalkScreen.centres(out);
    return out;
  };

  const ledgerTestState = (): Record<string, string | number | boolean> => {
    const er = game.errands;
    const a = er.active;
    const n = ledger.counts();
    const out: Record<string, string | number | boolean> = {
      errandOffered: er.offered ?? '',
      errandOfferFill: Math.round(er.offerFill * 100),
      errandActive: a ? a.id : '',
      errandStep: a ? a.step : -1,
      errandLeft: a ? Math.ceil(a.ticksLeft / 60) : 0,
      errandsDone: n.errands[0],
      conductorActive: game.conductors.active ? lines[game.conductors.active.line].id : '',
      conductorsPunched: n.conductors[0],
      secretsFound: n.secrets[0],
      ledgerOpen,
      ledgerTab: ledgerOpen ? ledger.tab : '',
    };
    const r = ledgerBtn.getBoundingClientRect();
    const shown = r.width > 0 && !mapOpen && !chalkOpen && !ledgerOpen;
    out.ledgerBtnX = shown ? Math.round(r.left + r.width / 2) : -1;
    out.ledgerBtnY = shown ? Math.round(r.top + r.height / 2) : -1;
    if (ledgerOpen) ledger.centres(out);
    return out;
  };

  return {
    update(f: UiFrame): void {
      if (disposed) return;
      for (const e of f.gameEvents) onGameEvent(e);
      for (const e of f.simEvents) onSimEvent(e);
      board.update();
      chain.update(f.simEvents, f.dt);
      toasts.update(f.dt);
      if (!mapOpen) stopBoard.update(f.dt);
      const hitched = game.sim.player.mode === Mode.HITCH;
      holdOn.set(f.armed);
      holdFull.set(f.armed && hitched);
      const cm = game.chalk.mode;
      recording.set(cm === 'recording');
      racing.set(cm === 'countdown' || cm === 'racing');
      // Only touch the DOM when the mode changes.
      if (cm !== lastChalkMode) {
        lastChalkMode = cm;
        chalkBtn.setAttribute('aria-label', cm === 'recording' ? 'Stop drawing' : cm === 'idle' ? 'Chalk lines' : 'Abandon the race');
      }
      chalkHud.update(f.dt);
      errandHud.update(shellHost ? shellHost.values().hints : true);
      errandOn.set(errandHud.active);
      offering.set(errandHud.offering);
      conductorHud.update(f.dt);
      shell?.frame(f.dt, f.gameEvents);
      hint.update(f.dt, mapOpen || chalkOpen || ledgerOpen || (shell !== null && shell.paused), f.pointer ?? null);
      hinting.set(hint.hint !== '');
      twos.update(f.dt);
    },
    get paused(): boolean {
      return mapOpen || chalkOpen || ledgerOpen || (shell !== null && shell.paused);
    },
    openChalkImport(code: string): void {
      setChalkOpen(true, true);
      chalkScreen.prefillImport(code);
    },
    testState() {
      const prog = game.progress;
      let inked = 0;
      let discovered = 0;
      for (let i = 0; i < lines.length; i++) {
        inked += inkedCount(prog, i);
        if (prog.lines[i].discovered) discovered++;
      }
      const out: Record<string, string | number | boolean> = {
        hudMode: board.mode === '' ? 'free' : board.mode,
        hudLine: board.lineId,
        hudNextStop: board.nextStopName,
        chainShown: chain.count,
        toasts: toasts.queue.items.length,
        lastToast: toasts.lastKind,
        stopBoard: stopBoard.stopName,
        mapOpen,
        mapLines: mapOpen ? map.drawn : discovered,
        inkedSegments: inked,
        mapPercent: Math.floor(mapFraction(prog, lines) * 100),
        hint: hint.hint,
        hintsDone: hint.doneCount,
        hintTarget: hint.hint === '' ? 'none' : game.onboarding.target.kind,
        hintPointer: hint.pointer,
        onboardingComplete: game.onboarding.complete,
        ...chalkTestState(),
        ...ledgerTestState(),
      };
      shell?.testState(out);
      return out;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      mapBtn.removeEventListener('pointerdown', onBtnDown);
      mapBtn.removeEventListener('pointerup', onBtnUp);
      mapBtn.removeEventListener('pointercancel', onBtnCancel);
      mapBtn.removeEventListener('click', onBtnClick);
      window.removeEventListener('keydown', onKey);
      chalkBtn.removeEventListener('pointerdown', onChalkDown);
      chalkBtn.removeEventListener('pointerup', onChalkUp);
      chalkBtn.removeEventListener('pointercancel', onChalkCancel);
      chalkBtn.removeEventListener('click', onChalkClick);
      ledgerBtn.removeEventListener('pointerdown', onLedgerDown);
      ledgerBtn.removeEventListener('pointerup', onLedgerUp);
      ledgerBtn.removeEventListener('pointercancel', onLedgerCancel);
      ledgerBtn.removeEventListener('click', onLedgerClick);
      shell?.dispose();
      hud.remove();
      releaseFindsStyle();
      releaseLedgerStyle();
      releaseHintStyle();
      releaseErrandStyle();
      releaseChalkStyle();
      releaseStyle();
    },
  };
}
