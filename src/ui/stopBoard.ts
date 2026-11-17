/**
 * Stop timetable board: slides up from the bottom when the skater is near a stop of a discovered
 * line and not hitched. Title = stop name; up to four rows of line, next stop and time to arrival,
 * soonest first. Recomputed at most four times a second.
 */
import type { Game } from '../sim/game/game';
import { Mode } from '../sim/types';
import { ClassSlot, el, styleBadge, TextSlot } from './dom';
import { FlapRow } from './flap';
import { boardText, countdownSeconds, countdownText } from './format';
import { boardRows, nearbyStops, stopPositions, type StopPos } from './timetable';

export const STOP_RADIUS = 14;
const ROWS = 4;
const PERIOD = 0.25;

interface RowEls {
  el: HTMLElement;
  badge: HTMLElement;
  badgeLine: number;
  next: FlapRow;
  time: FlapRow;
}

export class StopBoard {
  readonly el: HTMLElement;
  private readonly title = new FlapRow(16);
  private readonly titleSlot: TextSlot;
  private readonly rows: RowEls[] = [];
  private readonly stops: StopPos[];
  private readonly on: ClassSlot;
  private t = PERIOD;
  /** Name of the stop shown, or '' when hidden. */
  stopName = '';

  constructor(
    private readonly game: Game,
    private readonly rootFlag: ClassSlot,
  ) {
    this.el = el('div', 'sk-stop sk-panel');
    this.stops = stopPositions(game.sim.world.lines);
    const head = el('div', 'sk-row sk-title');
    const slot = el('span', 'sk-slot');
    this.titleSlot = new TextSlot(slot);
    this.titleSlot.set('STOP');
    head.append(slot, this.title.el);
    this.el.appendChild(head);
    for (let i = 0; i < ROWS; i++) {
      const r = el('div', 'sk-row');
      const badge = el('span', 'sk-badge');
      badge.style.visibility = 'hidden';
      const next = new FlapRow(11);
      const time = new FlapRow(5, 'right');
      r.append(badge, next.el, time.el);
      this.el.appendChild(r);
      this.rows.push({ el: r, badge, badgeLine: -1, next, time });
    }
    this.on = new ClassSlot(this.el, 'sk-on');
  }

  update(dt: number): void {
    this.t += dt;
    if (this.t < PERIOD) return;
    this.t = 0;
    this.refresh();
  }

  /** Recompute now (also used when play resumes). */
  refresh(): void {
    const sim = this.game.sim;
    const p = sim.player;
    const prog = this.game.progress;
    const near =
      p.mode === Mode.HITCH
        ? []
        : nearbyStops(this.stops, p.x, p.z, STOP_RADIUS, (li) => prog.lines[li].discovered);
    const show = near.length > 0;
    this.on.set(show);
    this.rootFlag.set(show);
    if (!show) {
      this.stopName = '';
      return;
    }
    const lines = sim.world.lines;
    const first = near[0];
    this.stopName = lines[first.line].allStops[first.stop].name;
    this.title.set(boardText(this.stopName));
    const rows = boardRows(lines, near, sim.tick, ROWS);
    for (let i = 0; i < ROWS; i++) {
      const r = this.rows[i];
      const row = i < rows.length ? rows[i] : null;
      if (!row) {
        r.badge.style.visibility = 'hidden';
        r.next.set('');
        r.time.set('');
        continue;
      }
      const line = lines[row.line];
      if (r.badgeLine !== row.line) {
        r.badgeLine = row.line;
        styleBadge(r.badge, line);
      }
      r.badge.style.visibility = '';
      r.next.set(row.service ? boardText('→' + line.allStops[row.next].name) : 'NO SERVICE');
      r.time.set(row.service ? countdownText(countdownSeconds(row.ticks)) : '');
    }
  }
}
