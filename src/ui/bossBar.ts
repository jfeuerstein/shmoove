/**
 * The boss on screen: a bar at the top, under the clock, with its name and its health while one is
 * on the field, and its name in big letters across the upper screen for two seconds when it
 * arrives. Part of the HUD; written only when what it shows changes.
 *
 * The name is timed by real time, not by sim ticks: the world holds still behind cards and after
 * the run, and a name timed by ticks would stay up there. It is hidden at once whenever the run is
 * not being played (cards open, the run over).
 */
import { PALETTE } from '../render/look';
import { KIND_BRUISER, KIND_MORTAR, KIND_STANDSTILL, PHASE_PLAY, type World } from '../sim/world';

/** How long the name stays across the screen after a boss arrives, real seconds. */
export const BANNER_SECONDS = 2;

/**
 * Is the name across the screen: a boss of `kind` (-1 for none) is on the field, it arrived
 * `sinceArrival` real seconds ago, and the run is in `phase`?
 */
export function bannerShown(kind: number, sinceArrival: number, phase: number): boolean {
  return kind >= 0 && phase === PHASE_PLAY && sinceArrival >= 0 && sinceArrival < BANNER_SECONDS;
}

/** Real seconds, from the page's clock. */
function realSeconds(): number {
  return performance.now() / 1000;
}
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
  /** Real time at which the boss on the field arrived, s. */
  private arrived = 0;
  private bannerOn = false;
  private readonly clock: () => number;

  /** `clock` gives real seconds; a seam for tests. */
  constructor(doc: Document, parent: HTMLElement, clock: () => number = realSeconds) {
    this.clock = clock;
    this.bar = el(doc, parent, 'hud-boss');
    this.name = el(doc, this.bar, 'hud-boss-name');
    const track = el(doc, this.bar, 'hud-boss-track');
    this.fill = el(doc, track, 'hud-fill');
    this.banner = el(doc, parent, 'hud-boss-banner');
    this.bar.hidden = true;
    this.banner.hidden = true;
  }

  update(w: World): void {
    const b = w.boss;
    const now = this.clock();
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
        this.arrived = now;
      }
    }
    const show = bannerShown(b.kind, now - this.arrived, w.run.phase);
    if (show !== this.bannerOn) {
      this.bannerOn = show;
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
