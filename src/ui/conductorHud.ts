/**
 * The running conductor challenge as a small chip on the right, under the chain meter: the line
 * badge and the progress figure. On a punch the chip holds PUNCHED with a hole knocked through it
 * for a moment, on twos. The start and punch tickets themselves are toasts.
 */
import type { ConductorDef } from '../sim/game/conductors';
import type { Game, GameEvent } from '../sim/game/game';
import { ClassSlot, TextSlot, el, styleBadge } from './dom';
import { chipText } from './errandFormat';
import type { Twos } from './twos';

/** How long the punched chip stays, seconds. */
const PUNCH_SHOW = 1.6;

export class ConductorHud {
  readonly el: HTMLElement;
  private readonly on: ClassSlot;
  private readonly punched: ClassSlot;
  private readonly badge: HTMLElement;
  private readonly text: TextSlot;
  private readonly defs = new Map<string, ConductorDef>();
  private line = -1;
  private punchLeft = 0;

  constructor(
    private readonly game: Game,
    private readonly twos: Twos,
  ) {
    for (const c of game.conductors.list) this.defs.set(c.line, c);
    this.el = el('div', 'sk-cchip sk-panel');
    this.badge = el('span', 'sk-badge');
    const label = el('span', 'sk-cchiplabel', 'CONDUCTOR');
    const text = el('span', 'sk-cchiptext');
    this.text = new TextSlot(text);
    this.el.append(this.badge, label, text, el('i', 'sk-cchiphole'));
    this.on = new ClassSlot(this.el, 'sk-on');
    this.punched = new ClassSlot(this.el, 'sk-punched');
  }

  onEvent(e: GameEvent): void {
    if (e.type !== 'conductorPunch') return;
    this.punchLeft = PUNCH_SHOW;
    this.show(e.line);
    this.text.set('PUNCHED');
    this.punched.set(true);
    this.twos.play(this.el, 'sk-pop1', 'sk-pop2');
  }

  update(dt: number): void {
    if (this.punchLeft > 0) {
      this.punchLeft -= dt;
      if (this.punchLeft > 0) return;
      this.punched.set(false);
      this.line = -1;
    }
    const a = this.game.conductors.active;
    if (!a) {
      this.on.set(false);
      this.line = -1;
      return;
    }
    const L = this.game.sim.world.lines[a.line];
    const def = this.defs.get(L.id);
    if (!def) return;
    if (a.line !== this.line) {
      this.show(a.line);
      this.twos.play(this.el, 'sk-pop1', 'sk-pop2');
    }
    this.text.set(chipText(def, a));
  }

  private show(li: number): void {
    this.line = li;
    styleBadge(this.badge, this.game.sim.world.lines[li]);
    this.on.set(true);
  }
}
