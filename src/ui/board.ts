/**
 * The destination board at the top. Free: district, clock, speed. Hitched: line badge and name,
 * clock, arrow and next stop, countdown to arrival there (read from the lap table).
 */
import type { Game } from '../sim/game/game';
import { districtAt, DISTRICT_NAMES } from '../sim/world';
import { Mode } from '../sim/types';
import { el, styleBadge, TextSlot } from './dom';
import { FlapRow } from './flap';
import { boardText, clockMinutes, clockText, countdownSeconds, countdownText, kmh } from './format';
import { nextStopOf, type NextStop } from './timetable';

export class DestinationBoard {
  readonly el: HTMLElement;
  private readonly name = new FlapRow(9);
  private readonly clock = new FlapRow(5, 'right');
  private readonly info = new FlapRow(9);
  private readonly right = new FlapRow(5, 'right');
  private readonly slot1: TextSlot;
  private readonly slot2: TextSlot;
  private readonly badge: HTMLElement;
  private readonly slot1El: HTMLElement;
  private readonly slot2El: HTMLElement;

  /** What the board shows: free roaming or hitched ('' before the first update). */
  mode: 'free' | 'hitched' | '' = '';
  private minutes = -1;
  private speed = -1;
  private district = -1;
  private seconds = -2;
  private hLine = -1;
  private hVeh = -1;
  /** Absolute tick at which the hitched vehicle reaches `next`. */
  private arriveTick = -1;
  private readonly next: NextStop = { stop: -1, ticks: 0 };
  nextStopName = '';
  lineId = '';

  constructor(private readonly game: Game) {
    this.el = el('div', 'sk-board sk-panel');
    const r1 = el('div', 'sk-row');
    const r2 = el('div', 'sk-row');
    this.slot1El = el('span', 'sk-slot');
    this.badge = el('span', 'sk-badge');
    this.badge.style.display = 'none';
    const s2 = el('span', 'sk-slot');
    this.slot1 = new TextSlot(this.slot1El);
    this.slot2 = new TextSlot(s2);
    const left1 = el('span', 'sk-row');
    left1.append(this.slot1El, this.badge, this.name.el);
    const left2 = el('span', 'sk-row');
    left2.append(s2, this.info.el);
    r1.append(left1, this.clock.el);
    r2.append(left2, this.right.el);
    this.el.append(r1, r2);
    this.slot2El = s2;
  }

  update(): void {
    const sim = this.game.sim;
    const p = sim.player;
    const lines = sim.world.lines;

    const mins = clockMinutes(sim.dayFrac);
    if (mins !== this.minutes) {
      this.minutes = mins;
      this.clock.set(clockText(mins));
    }

    const hitched = p.mode === Mode.HITCH;
    const mode = hitched ? 'hitched' : 'free';
    if (mode !== this.mode) {
      this.mode = mode;
      this.district = -1;
      this.speed = -1;
      this.seconds = -2;
      this.hLine = -1;
      this.slot1El.style.display = hitched ? 'none' : '';
      this.badge.style.display = hitched ? '' : 'none';
      this.slot2El.classList.toggle('sk-arrow', hitched);
      this.slot1.set(hitched ? '' : 'AT');
      this.slot2.set(hitched ? '→' : 'KM/H');
      if (!hitched) {
        this.right.set('');
        this.nextStopName = '';
        this.lineId = '';
      }
    }

    if (!hitched) {
      const d = districtAt(sim.world, p.z);
      if (d !== this.district) {
        this.district = d;
        this.name.set(boardText(DISTRICT_NAMES[d]));
      }
      const v = kmh(p.speed);
      if (v !== this.speed) {
        this.speed = v;
        this.info.set(String(v));
      }
      return;
    }

    const line = lines[p.hLine];
    if (p.hLine !== this.hLine || p.hVeh !== this.hVeh) {
      this.hLine = p.hLine;
      this.hVeh = p.hVeh;
      this.arriveTick = -1;
      styleBadge(this.badge, line);
      this.name.set(boardText(line.name));
      this.lineId = line.id;
    }
    if (this.arriveTick < sim.tick) {
      if (nextStopOf(line, p.hVeh, sim.tick, this.next)) {
        this.arriveTick = sim.tick + this.next.ticks;
        this.nextStopName = line.allStops[this.next.stop].name;
      } else {
        this.arriveTick = Infinity;
        this.nextStopName = '';
      }
      this.info.set(boardText(this.nextStopName));
    }
    const secs = countdownSeconds(this.arriveTick - sim.tick);
    if (secs !== this.seconds) {
      this.seconds = secs;
      this.right.set(countdownText(secs));
    }
  }
}
