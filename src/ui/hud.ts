/**
 * The HUD: small and top centre, the speed in m/s (tinted by the gear, so it warms up as the rider
 * goes faster) and the ollie chain while there is one. With a run there is also the clock counting
 * up (top left), kills (top right), a thin health bar along the top edge, a thin XP bar with the
 * level along the bottom edge, and while a boss is on the field its bar under the clock (see
 * `BossBar`). Nothing sits over the middle of the screen. Each element is written only when the
 * value it shows changes.
 */
import { gearCss, PALETTE } from '../render/look';
import type { Sim } from '../sim/sim';
import { BossBar } from './bossBar';
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

/** The run clock: time played, counting up from 0:00. Past the final boss it keeps counting. */
export function clockText(ticksPlayed: number): string {
  return formatTime(secondsPlayed(ticksPlayed));
}

/** Whole seconds played. */
function secondsPlayed(ticksPlayed: number): number {
  return Math.floor(Math.max(0, ticksPlayed) / 60);
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
  boss: BossBar;
}

export class Hud {
  readonly element: HTMLElement;
  private readonly speedEl: HTMLElement;
  private readonly chainEl: HTMLElement;
  private readonly run: RunParts | null;
  private gear = -1;
  private speed = -1;
  private chain = -1;
  private clockSeconds = -1;
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
      const boss = new BossBar(doc, el);
      this.run = { clock, kills, hp, hpFill, xp, xpFill, level, boss };
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
      this.speedEl.style.color = gearCss(m.gear);
    }
    const speed = Math.round(m.speed);
    if (speed !== this.speed) {
      this.speed = speed;
      this.speedEl.textContent = `${speed} m/s`;
    }
    if (m.chain !== this.chain) {
      this.chain = m.chain;
      this.chainEl.hidden = m.chain <= 0;
      if (m.chain > 0) this.chainEl.textContent = `OLLIE CHAIN ×${m.chain}`;
    }
    if (this.run && sim.horde) this.updateRun(this.run, sim);
  }

  private updateRun(r: RunParts, sim: Sim): void {
    const w = sim.world;
    const p = w.player;

    const played = secondsPlayed(w.run.ticks);
    if (played !== this.clockSeconds) {
      this.clockSeconds = played;
      r.clock.textContent = formatTime(played);
    }
    r.boss.update(w);
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
