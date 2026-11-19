/**
 * The boss on screen: a bar at the top, under the clock, with its name and its health while one is
 * on the field, and its name in big letters across the upper screen for two seconds when it
 * arrives. Part of the HUD; written only when what it shows changes.
 */
import { PALETTE } from '../render/look';
import { TICK_HZ } from '../sim/constants';
import { KIND_BRUISER, KIND_MORTAR, KIND_STANDSTILL, type World } from '../sim/world';

/** How long the name stays across the screen after a boss arrives, s. */
export const BANNER_SECONDS = 2;
/** The bar is redrawn only when it moves by at least 1/BAR_STEPS of its length. */
const BAR_STEPS = 200;

/** What the player calls each boss. */
export function bossName(kind: number): string {
  if (kind === KIND_BRUISER) return 'THE BRUISER';
  if (kind === KIND_MORTAR) return 'THE MORTAR';
  if (kind === KIND_STANDSTILL) return 'THE STANDSTILL';
  return '';
}

/** The boss's colour, as CSS. */
function bossCss(kind: number): string {
  const c = PALETTE.bosses[kind - KIND_BRUISER] ?? PALETTE.threat;
  return `#${c.toString(16).padStart(6, '0')}`;
}

export class BossBar {
  readonly bar: HTMLElement;
  readonly banner: HTMLElement;
  private readonly name: HTMLElement;
  private readonly fill: HTMLElement;
  private kind = -1;
  private step = -1;
  /** Sim tick at which the boss on the field arrived. */
  private arrived = 0;
  private bannerShown = false;

  constructor(doc: Document, parent: HTMLElement) {
    this.bar = el(doc, parent, 'hud-boss');
    this.name = el(doc, this.bar, 'hud-boss-name');
    const track = el(doc, this.bar, 'hud-boss-track');
    this.fill = el(doc, track, 'hud-fill');
    this.banner = el(doc, parent, 'hud-boss-banner');
    this.bar.hidden = true;
    this.banner.hidden = true;
  }

  /** `tick` is the sim's step count, which only moves while the world does. */
  update(w: World, tick: number): void {
    const b = w.boss;
    if (b.kind !== this.kind) {
      this.kind = b.kind;
      this.step = -1;
      this.bar.hidden = b.kind < 0;
      if (b.kind >= 0) {
        const name = bossName(b.kind);
        const css = bossCss(b.kind);
        this.name.textContent = name;
        this.fill.style.backgroundColor = css;
        this.banner.textContent = name;
        this.banner.style.color = css;
        this.arrived = tick;
      }
    }
    const show = b.kind >= 0 && tick - this.arrived < BANNER_SECONDS * TICK_HZ;
    if (show !== this.bannerShown) {
      this.bannerShown = show;
      this.banner.hidden = !show;
    }
    if (b.kind < 0) return;
    const frac = b.maxHp > 0 ? Math.min(1, Math.max(0, b.hp / b.maxHp)) : 0;
    const step = Math.ceil(frac * BAR_STEPS);
    if (step !== this.step) {
      this.step = step;
      this.fill.style.transform = `scaleX(${step / BAR_STEPS})`;
    }
  }
}

function el(doc: Document, parent: HTMLElement, cls: string): HTMLElement {
  const e = doc.createElement('div');
  e.className = cls;
  parent.appendChild(e);
  return e;
}
