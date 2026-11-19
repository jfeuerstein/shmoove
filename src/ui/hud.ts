/**
 * The HUD: the gear as a very large numeral at the top centre, its name, the speed, and the clean-hop
 * chain while there is one. With a run there is also the clock (top left), kills (top right), a thin
 * health bar along the top edge and a thin XP bar with the level along the bottom edge. Nothing sits
 * over the middle of the screen. Each element is written only when the value it shows changes.
 */
import { gearCss, PALETTE } from '../render/look';
import { RUN_TICKS } from '../sim/balance';
import { GEAR_NAMES } from '../sim/constants';
import type { Sim } from '../sim/sim';
import './hud.css';

/** Bars are redrawn only when they move by at least 1/BAR_STEPS of their length (about 2 px). */
const BAR_STEPS = 200;
/** Health under this share of the maximum turns the bar to the warning colour. */
export const LOW_HP = 0.3;

export interface HudOptions {
  /** Show the run parts (clock, kills, health, XP). */
  run: boolean;
  /** The debug button sits at the top right: keep clear of it. */
  debug?: boolean;
}

/** Whole seconds as `m:ss`. */
export function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const r = s % 60;
  return `${Math.floor(s / 60)}:${r < 10 ? '0' : ''}${r}`;
}

/** The run clock: time left, rounded up so it reads 3:00 at the start and 0:00 only at the end. */
export function clockText(ticksPlayed: number): string {
  return formatTime(Math.ceil(Math.max(0, RUN_TICKS - ticksPlayed) / 60));
}

/** Fill colour of the health bar for a share of full health (0..1). */
export function hpColour(frac: number): number {
  return frac < LOW_HP ? PALETTE.hpLow : PALETTE.hp;
}

interface RunParts {
  clock: HTMLElement;
  kills: HTMLElement;
  hp: HTMLElement;
  hpFill: HTMLElement;
  xp: HTMLElement;
  xpFill: HTMLElement;
  level: HTMLElement;
}

export class Hud {
  readonly element: HTMLElement;
  private readonly gearEl: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly speedEl: HTMLElement;
  private readonly chainEl: HTMLElement;
  private readonly run: RunParts | null;
  private gear = -1;
  private speed = -1;
  private chain = -1;
  private clock = '';
  private kills = -1;
  private hpStep = -1;
  private hpLow = false;
  private hpValue = -1;
  private xpStep = -1;
  private level = -1;
  private hpPulse = 0;
  private lvlPulse = 0;

  /** `doc` is a seam so tests can build the HUD over a fake element tree. */
  constructor(root: HTMLElement, options: HudOptions = { run: false }, doc: Document = document) {
    const el = doc.createElement('div');
    el.className = options.debug === true ? 'hud hud-debug' : 'hud';
    el.setAttribute('aria-live', 'off');
    this.gearEl = part(doc, el, 'hud-gear');
    this.nameEl = part(doc, el, 'hud-name');
    this.speedEl = part(doc, el, 'hud-speed');
    this.chainEl = part(doc, el, 'hud-chain');
    this.chainEl.hidden = true;
    this.chainEl.style.color = cssHex(PALETTE.accent);
    if (options.run) {
      const clock = part(doc, el, 'hud-clock');
      const kills = part(doc, el, 'hud-kills');
      const hp = part(doc, el, 'hud-hp');
      const hpFill = part(doc, hp, 'hud-fill');
      const xp = part(doc, el, 'hud-xp');
      const level = part(doc, xp, 'hud-level');
      const track = part(doc, xp, 'hud-track');
      const xpFill = part(doc, track, 'hud-fill');
      hpFill.style.backgroundColor = cssHex(PALETTE.hp);
      xpFill.style.backgroundColor = cssHex(PALETTE.spark);
      this.run = { clock, kills, hp, hpFill, xp, xpFill, level };
    } else {
      this.run = null;
    }
    root.appendChild(el);
    this.element = el;
  }

  update(sim: Sim): void {
    const m = sim.state.mover;
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
    if (this.run && sim.horde) this.updateRun(this.run, sim);
  }

  private updateRun(r: RunParts, sim: Sim): void {
    const w = sim.world;
    const p = w.player;

    const clock = clockText(w.run.ticks);
    if (clock !== this.clock) {
      this.clock = clock;
      r.clock.textContent = clock;
    }
    if (p.kills !== this.kills) {
      this.kills = p.kills;
      r.kills.textContent = `${p.kills} kills`;
    }

    const hpFrac = p.maxHp > 0 ? Math.min(1, Math.max(0, p.hp / p.maxHp)) : 0;
    const hpStep = Math.round(hpFrac * BAR_STEPS);
    if (hpStep !== this.hpStep) {
      this.hpStep = hpStep;
      r.hpFill.style.transform = `scaleX(${hpStep / BAR_STEPS})`;
    }
    const low = hpFrac < LOW_HP;
    if (low !== this.hpLow) {
      this.hpLow = low;
      r.hpFill.style.backgroundColor = cssHex(hpColour(hpFrac));
    }
    if (this.hpValue >= 0 && p.hp < this.hpValue) {
      // Alternate between two identical animations so each hit restarts the pulse.
      this.hpPulse ^= 1;
      r.hp.className = this.hpPulse ? 'hud-hp pulse-a' : 'hud-hp pulse-b';
    }
    this.hpValue = p.hp;

    const xpFrac = p.xpNext > 0 ? Math.min(1, Math.max(0, p.xp / p.xpNext)) : 0;
    const xpStep = Math.round(xpFrac * BAR_STEPS);
    if (xpStep !== this.xpStep) {
      this.xpStep = xpStep;
      r.xpFill.style.transform = `scaleX(${xpStep / BAR_STEPS})`;
    }
    if (p.level !== this.level) {
      if (this.level > 0 && p.level > this.level) {
        this.lvlPulse ^= 1;
        r.xp.className = this.lvlPulse ? 'hud-xp pulse-a' : 'hud-xp pulse-b';
      }
      this.level = p.level;
      r.level.textContent = String(p.level);
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
