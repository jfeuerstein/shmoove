/**
 * The DOM overlay: destination board, chain meter, hold cue, ticket toasts, stop timetable board
 * and the line map screen. An observer of the game: it reads state and events and never writes
 * them; the only thing it feeds back is `paused`, which main.ts honours by not stepping.
 */
import type { Game, GameEvent } from '../sim/game/game';
import { inkedCount, lineSegments, mapFraction, type Segment } from '../sim/game/progress';
import { Mode, type SimEvent } from '../sim/types';
import { DestinationBoard } from './board';
import { ChainMeter } from './chain';
import { ClassSlot, el } from './dom';
import { LineMap } from './lineMap';
import { StopBoard } from './stopBoard';
import { injectStyle } from './style';
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
}

export interface UiSound {
  ui(name: 'tick' | 'punch' | 'ink' | 'fanfare' | 'deny'): void;
}

export interface Ui {
  update(f: UiFrame): void;
  /** True while a screen that pauses play is open (the line map). main.ts stops stepping the sim. */
  readonly paused: boolean;
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

export function createUi(root: HTMLElement, game: Game, sound: UiSound | null): Ui {
  const releaseStyle = injectStyle();
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
  const hold = el('div', 'sk-hold');
  const holdOn = new ClassSlot(hold, 'sk-on');
  const holdFull = new ClassSlot(hold, 'sk-full');

  let mapOpen = false;
  const setOpen = (open: boolean): void => {
    if (open === mapOpen) return;
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
    if (e.code === 'KeyM') toggle();
    else if (e.code === 'Escape' && mapOpen) setOpen(false);
  };
  mapBtn.addEventListener('pointerdown', onBtnDown);
  mapBtn.addEventListener('pointerup', onBtnUp);
  mapBtn.addEventListener('pointercancel', onBtnCancel);
  mapBtn.addEventListener('click', onBtnClick);
  window.addEventListener('keydown', onKey);

  hud.append(board.el, chain.el, toasts.el, stopBoard.el, hold, map.el, mapBtn);
  root.appendChild(hud);

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
    }
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
      twos.update(f.dt);
    },
    get paused(): boolean {
      return mapOpen;
    },
    testState() {
      const prog = game.progress;
      let inked = 0;
      let discovered = 0;
      for (let i = 0; i < lines.length; i++) {
        inked += inkedCount(prog, i);
        if (prog.lines[i].discovered) discovered++;
      }
      return {
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
      };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      mapBtn.removeEventListener('pointerdown', onBtnDown);
      mapBtn.removeEventListener('pointerup', onBtnUp);
      mapBtn.removeEventListener('pointercancel', onBtnCancel);
      mapBtn.removeEventListener('click', onBtnClick);
      window.removeEventListener('keydown', onKey);
      hud.remove();
      releaseStyle();
    },
  };
}
