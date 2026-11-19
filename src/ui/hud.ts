/**
 * The HUD: top of the screen only, inside the safe area. The gear as a very large numeral in its
 * colour, the gear name under it, the speed small, and the clean-hop chain while there is one.
 * Each element is written only when the value it shows changes.
 */
import { gearCss, PALETTE } from '../render/look';
import { GEAR_NAMES } from '../sim/constants';
import type { SimState } from '../sim/types';
import './hud.css';

export class Hud {
  readonly element: HTMLElement;
  private readonly gearEl: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly speedEl: HTMLElement;
  private readonly chainEl: HTMLElement;
  private gear = -1;
  private speed = -1;
  private chain = -1;

  /** `doc` is a seam so tests can build the HUD over a fake element tree. */
  constructor(root: HTMLElement, doc: Document = document) {
    const el = doc.createElement('div');
    el.className = 'hud';
    el.setAttribute('aria-live', 'off');
    this.gearEl = part(doc, el, 'hud-gear');
    this.nameEl = part(doc, el, 'hud-name');
    this.speedEl = part(doc, el, 'hud-speed');
    this.chainEl = part(doc, el, 'hud-chain');
    this.chainEl.hidden = true;
    this.chainEl.style.color = cssHex(PALETTE.accent);
    root.appendChild(el);
    this.element = el;
  }

  update(state: SimState): void {
    const m = state.mover;
    if (m.gear !== this.gear) {
      this.gear = m.gear;
      const colour = gearCss(m.gear);
      this.gearEl.textContent = String(m.gear);
      this.gearEl.style.color = colour;
      this.nameEl.textContent = GEAR_NAMES[Math.min(GEAR_NAMES.length, Math.max(1, m.gear)) - 1];
      this.nameEl.style.color = colour;
    }
    const speed = Math.round(m.speed);
    if (speed !== this.speed) {
      this.speed = speed;
      this.speedEl.textContent = `${speed} m/s`;
    }
    if (m.chain !== this.chain) {
      this.chain = m.chain;
      this.chainEl.hidden = m.chain <= 0;
      if (m.chain > 0) this.chainEl.textContent = `CHAIN ×${m.chain}`;
    }
  }
}

function part(doc: Document, parent: HTMLElement, cls: string): HTMLElement {
  const e = doc.createElement('div');
  e.className = cls;
  parent.appendChild(e);
  return e;
}

function cssHex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}
