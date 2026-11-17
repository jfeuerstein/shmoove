/**
 * The rotate card: SKITCH is portrait only. On a touch screen held sideways a full-screen ticket
 * stub asks for the phone upright (a phone glyph turning, on twos) and play pauses. Desktop
 * windows are often wider than tall, so the card only shows where the main pointer is coarse.
 */
import { el } from './dom';
import { TWOS_STEP } from './twos';

/** Pure: whether the rotate card shows for a viewport. */
export function rotateShown(width: number, height: number, coarsePointer: boolean): boolean {
  return coarsePointer && width > height;
}

/** Poses of the phone glyph, degrees: from sideways to upright, then a hold. */
const POSES = [90, 90, 72, 54, 36, 18, 0, 0, 0, 0, 0, 0];

const PHONE =
  '<svg class="sk-rotphone" viewBox="-40 -40 80 80" aria-hidden="true">' +
  '<path class="sk-rotarc" d="M-30 -14 A32 32 0 0 1 -14 -30" stroke="#FF2E88" stroke-width="4" fill="none" stroke-linecap="round"/>' +
  '<path d="M-14 -30 L-22 -32 M-14 -30 L-17 -22" stroke="#FF2E88" stroke-width="4" fill="none" stroke-linecap="round"/>' +
  '<g class="sk-rotg">' +
  '<rect x="-14.5" y="-25.5" width="31" height="53" rx="6" fill="#1F3FBF"/>' +
  '<rect x="-16" y="-27" width="31" height="53" rx="6" fill="#1B1A2E"/>' +
  '<rect x="-12" y="-20" width="23" height="38" rx="1.5" fill="#FFAE1A"/>' +
  '<circle cx="-0.5" cy="22" r="2" fill="#F3EBDD"/>' +
  '</g></svg>';

export class RotateCard {
  readonly el: HTMLElement;
  private readonly glyph: SVGGElement | null;
  private t = 0;
  private pose = -1;

  constructor() {
    this.el = el('div', 'sk-rotate');
    const card = el('div', 'sk-ticket sk-big sk-rotcard');
    card.innerHTML = PHONE;
    card.append(el('div', 'sk-op sk-rothead', 'Turn it upright'), el('div', 'sk-tbody sk-rotbody', 'Skitch rides portrait'));
    this.el.appendChild(card);
    this.glyph = card.querySelector<SVGGElement>('.sk-rotg');
  }

  /** Advance the turning glyph on twos. `still` holds it upright (reduced motion). */
  update(dt: number, still: boolean): void {
    this.t += dt;
    const i = still ? POSES.length - 1 : Math.floor(this.t / TWOS_STEP) % POSES.length;
    if (i === this.pose || !this.glyph) return;
    this.pose = i;
    this.glyph.setAttribute('transform', `rotate(${POSES[i]})`);
  }

  reset(): void {
    this.t = 0;
    this.pose = -1;
  }
}
