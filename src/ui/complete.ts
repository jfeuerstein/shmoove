/**
 * The map-complete celebration: every line's badge punched in a grid of ticket squares, total play
 * time, "SANTA RAMPA IS YOURS", a fanfare and CONTINUE. The punches land one by one on twos.
 */
import type { Game } from '../sim/game/game';
import { el, makeBadge } from './dom';
import { FlapRow } from './flap';
import { playTimeText, shellButton } from './titleKit';
import { TWOS_STEP, type Twos } from './twos';

/** Time between punches: two steps on twos. */
const PUNCH_EVERY = 2 * TWOS_STEP;

export class CompleteScreen {
  readonly el: HTMLElement;
  private readonly word: FlapRow;
  private readonly grid: HTMLElement;
  private readonly time: HTMLElement;
  private readonly cells: HTMLElement[] = [];
  private t = 0;
  private punched = 0;

  constructor(
    private readonly game: Game,
    private readonly twos: Twos,
    onContinue: () => void,
    tap: () => void,
  ) {
    this.el = el('div', 'sk-complete');
    const head = el('div', 'sk-maphead sk-chalkhead');
    this.word = new FlapRow(twos, 12);
    head.appendChild(this.word.el);
    const body = el('div', 'sk-chalkbody sk-xbody');
    const hero = el('div', 'sk-xhero');
    hero.append(el('div', 'sk-xkicker', 'Every line inked'), el('div', 'sk-xtitle', 'Santa Rampa is yours'));
    this.grid = el('div', 'sk-xgrid');
    const facts = el('div', 'sk-ticket sk-big sk-xfacts');
    const row = el('div', 'sk-cfacts');
    this.time = el('b', '', '0:00');
    row.append(el('span', 'sk-cfact', 'Time on the board'), this.time);
    facts.appendChild(row);
    body.append(hero, this.grid, facts);
    const foot = el('div', 'sk-chalkfoot');
    const cont = shellButton('sk-tplay sk-xcontinue', 'Continue', 'completeContinue', () => {
      tap();
      onContinue();
    });
    foot.appendChild(cont);
    this.el.append(head, body, foot);
  }

  get punchedCount(): number {
    return this.punched;
  }

  /** Fill the grid with the lines (secret ones only once found) and start punching. */
  open(playSeconds: number, instant: boolean): void {
    const lines = this.game.sim.world.lines;
    const prog = this.game.progress;
    this.grid.textContent = '';
    this.cells.length = 0;
    lines.forEach((line, i) => {
      if (!prog.lines[i].discovered) return;
      const cell = el('div', 'sk-xcell');
      const name = el('div', 'sk-xname', line.name);
      cell.append(makeBadge(line), el('span', 'sk-xhole'), name);
      this.grid.appendChild(cell);
      this.cells.push(cell);
    });
    this.time.textContent = playTimeText(playSeconds);
    this.word.set('MAP COMPLETE');
    this.t = 0;
    this.punched = 0;
    if (instant) this.step(0, true);
  }

  step(dt: number, instant: boolean): void {
    this.t += dt;
    const want = instant ? this.cells.length : Math.min(this.cells.length, Math.floor(this.t / PUNCH_EVERY));
    while (this.punched < want) {
      const c = this.cells[this.punched++];
      c.classList.add('sk-punched');
      if (!instant) this.twos.play(c, 'sk-pop1', 'sk-pop2');
    }
  }
}
