/**
 * Ticket-stub toasts: newest on top, at most three, each lives TOAST_LIFE seconds and slides in
 * and out on twos.
 */
import type { CompiledLine } from '../sim/lines';
import type { UiSound } from './index';
import { el, makeBadge } from './dom';
import { boardText } from './format';
import { ToastQueue, type Toast, type ToastKind } from './toastQueue';

export interface ToastData {
  line: CompiledLine | null;
  title: string;
  body: string;
  serial: number;
}

const SOUND: Record<ToastKind, 'ink' | 'punch' | 'fanfare' | 'deny'> = {
  inked: 'ink',
  complete: 'punch',
  discovered: 'fanfare',
  denied: 'deny',
  map: 'fanfare',
};

/** How long a leaving ticket stays in the DOM while it slides out, s. */
const OUT_TIME = 0.17;

export class Toasts {
  readonly el: HTMLElement;
  readonly queue = new ToastQueue<ToastData>();
  private readonly nodes = new Map<number, HTMLElement>();
  private readonly leaving: Array<{ node: HTMLElement; t: number }> = [];

  constructor(private readonly sound: UiSound | null) {
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
    this.sound?.ui(SOUND[kind]);
  }

  update(dt: number): void {
    for (const t of this.queue.update(dt)) this.remove(t);
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const l = this.leaving[i];
      l.t -= dt;
      if (l.t <= 0) {
        l.node.remove();
        this.leaving.splice(i, 1);
      }
    }
  }

  private remove(t: Toast<ToastData>): void {
    const node = this.nodes.get(t.id);
    if (!node) return;
    this.nodes.delete(t.id);
    node.classList.add('sk-out');
    this.leaving.push({ node, t: OUT_TIME });
  }

  private build(t: Toast<ToastData>): HTMLElement {
    const big = t.kind === 'complete' || t.kind === 'map' || t.kind === 'discovered';
    const node = el('div', 'sk-ticket' + (big ? ' sk-big' : ''));
    node.dataset.kind = t.kind;
    const head = el('div', 'sk-thead');
    if (t.data.line) head.appendChild(makeBadge(t.data.line));
    head.appendChild(el('span', 'sk-op', boardText(t.data.title)));
    head.appendChild(el('span', 'sk-serial', 'Nº ' + String(t.data.serial % 1000000).padStart(6, '0')));
    node.appendChild(head);
    if (t.data.body) node.appendChild(el('div', 'sk-tbody', boardText(t.data.body)));
    if (t.kind === 'complete' || t.kind === 'map') node.appendChild(el('span', 'sk-stamp', 'OK'));
    return node;
  }
}
