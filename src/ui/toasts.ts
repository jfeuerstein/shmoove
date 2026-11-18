/**
 * Ticket-stub toasts: newest on top, at most three, each lives TOAST_LIFE seconds and slides in
 * and out on twos.
 */
import type { CompiledLine } from '../sim/lines';
import type { UiSound } from './index';
import { el, makeBadge } from './dom';
import { boardText, hexColor, textOn } from './format';
import { ToastQueue, type Toast, type ToastKind } from './toastQueue';
import type { Twos } from './twos';

export interface ToastData {
  line: CompiledLine | null;
  title: string;
  body: string;
  serial: number;
  /** A rubber stamp on the ticket (errand results). */
  stamp?: string;
  /** A NEW BEST tag after the body. */
  best?: boolean;
  /** A swatch beside the title (an unlocked deck or kit): a CSS background. */
  swatch?: string;
}

/** The sound a ticket makes; null for finds whose own sound plays (src/app/audioView.ts). */
const SOUND: Record<ToastKind, 'tick' | 'ink' | 'punch' | 'fanfare' | 'deny' | null> = {
  inked: 'ink',
  complete: 'punch',
  discovered: 'fanfare',
  denied: 'deny',
  map: 'fanfare',
  'chalk-saved': 'punch',
  'chalk-discarded': 'deny',
  'chalk-won': 'fanfare',
  'chalk-lost': 'deny',
  'errand-done': 'fanfare',
  'errand-fail': 'deny',
  conductor: 'tick',
  'conductor-punch': 'punch',
  secret: 'fanfare',
  tile: null,
  spot: null,
  postcard: 'punch',
  unlock: null,
  best: 'tick',
};

export class Toasts {
  readonly el: HTMLElement;
  readonly queue = new ToastQueue<ToastData>();
  private readonly nodes = new Map<number, HTMLElement>();

  constructor(
    private readonly sound: UiSound | null,
    private readonly twos: Twos,
  ) {
    this.el = el('div', 'sk-toasts');
  }

  get lastKind(): ToastKind | '' {
    return this.queue.newest?.kind ?? '';
  }

  show(kind: ToastKind, data: ToastData): void {
    const { added, dropped } = this.queue.push(kind, data);
    for (const t of dropped) this.remove(t);
    const node = this.build(added);
    this.nodes.set(added.id, node);
    this.el.prepend(node);
    this.twos.play(node, 'sk-in1', 'sk-in2');
    const s = SOUND[kind];
    if (s !== null) this.sound?.ui(s);
  }

  /**
   * A counter ticket (the tile count): one of its kind at a time, showing `seconds` from now. A new
   * count rewrites the one on screen instead of stacking another.
   */
  counter(kind: ToastKind, data: ToastData, seconds: number): void {
    let t = this.queue.items.find((q) => q.kind === kind);
    if (t === undefined) {
      this.show(kind, data);
      t = this.queue.newest ?? undefined;
    } else {
      t.data = data;
      const node = this.nodes.get(t.id);
      const op = node?.querySelector('.sk-op');
      if (op) op.textContent = boardText(data.title);
      if (node) this.twos.play(node, 'sk-in2', 'sk-in2');
    }
    if (t) t.age = Math.max(0, this.queue.life - seconds);
  }

  update(dt: number): void {
    for (const t of this.queue.update(dt)) this.remove(t);
  }

  private remove(t: Toast<ToastData>): void {
    const node = this.nodes.get(t.id);
    if (!node) return;
    this.nodes.delete(t.id);
    // Slides away on twos, then leaves the stack.
    this.twos.play(node, 'sk-out1', 'sk-out2', () => node.remove());
  }

  private build(t: Toast<ToastData>): HTMLElement {
    const big =
      t.kind === 'complete' ||
      t.kind === 'map' ||
      t.kind === 'discovered' ||
      t.kind === 'chalk-won' ||
      t.kind === 'errand-done' ||
      t.kind === 'secret' ||
      t.kind === 'postcard' ||
      t.kind === 'unlock' ||
      t.kind === 'spot';
    const node = el('div', 'sk-ticket' + (big ? ' sk-big' : '') + (t.kind === 'tile' ? ' sk-ftile' : ''));
    node.dataset.kind = t.kind;
    if (t.data.line && (t.kind === 'conductor' || t.kind === 'conductor-punch')) {
      // A conductor's ticket is printed in the line's livery.
      const lv = t.data.line.livery;
      node.style.setProperty('--sk-lbase', hexColor(lv.base));
      node.style.setProperty('--sk-lstripe', hexColor(lv.stripe));
      node.style.setProperty('--sk-ltext', textOn(lv.base));
    }
    const head = el('div', 'sk-thead');
    if (t.data.line) head.appendChild(makeBadge(t.data.line));
    if (t.data.swatch !== undefined) {
      const sw = el('span', 'sk-fswatch');
      sw.style.background = t.data.swatch;
      head.appendChild(sw);
    }
    head.appendChild(el('span', 'sk-op', boardText(t.data.title)));
    if (t.kind !== 'tile') head.appendChild(el('span', 'sk-serial', 'Nº ' + String(t.data.serial % 1000000).padStart(6, '0')));
    node.appendChild(head);
    if (t.data.body) {
      const body = el('div', 'sk-tbody', boardText(t.data.body));
      if (t.data.best) body.appendChild(el('span', 'sk-ebest', 'NEW BEST'));
      node.appendChild(body);
    }
    if (t.data.stamp && t.kind === 'spot') node.appendChild(el('span', 'sk-fstamp', t.data.stamp));
    else if (t.data.stamp) node.appendChild(el('span', 'sk-stamp', t.data.stamp));
    else if (t.kind === 'postcard') node.appendChild(el('span', 'sk-fpost'));
    else if (t.kind === 'complete' || t.kind === 'map' || t.kind === 'chalk-saved' || t.kind === 'chalk-won') {
      node.appendChild(el('span', 'sk-stamp', 'OK'));
    }
    return node;
  }
}
