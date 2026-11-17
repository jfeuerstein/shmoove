/**
 * Secrets: four things the city does not tell you about. Each is found once and remembered with
 * the tick it was found.
 *
 * - `ghost`: hitch the ghost tram (S1), which runs only just after midnight.
 * - `blimp`: hitch the blimp (S2) on its one pass of the day.
 * - `needle`: land in the `needle` zone on top of the summit antenna. The only way up is the king
 *   kite (S3), which the sim already gates behind a four-link chain; nothing here special-cases it.
 * - `tunnel`: enter the `ghost_tunnel` zone, where the disused track runs under cover.
 */
import { Mode } from '../types';
import type { World, Zone } from '../world';
import { inZone } from './errands';
import type { Game, GameReducer } from './game';

export const SECRET_IDS = ['ghost', 'blimp', 'needle', 'tunnel'] as const;
export type SecretId = (typeof SECRET_IDS)[number];

/** Lines and zones the secrets are about. */
export const SECRET_LINES: Readonly<Record<'ghost' | 'blimp', string>> = { ghost: 'S1', blimp: 'S2' };
export const SECRET_ZONES: Readonly<Record<'needle' | 'tunnel', string>> = { needle: 'needle', tunnel: 'ghost_tunnel' };

export interface SecretState {
  /** Secret id -> the tick it was found. */
  found: Partial<Record<SecretId, number>>;
}

export interface SecretData {
  v: 1;
  found: Record<string, number>;
}

function zoneOf(w: World, id: string): Zone | null {
  for (const z of w.zones) if (z.id === id) return z;
  return null;
}

export class SecretsReducer implements GameReducer {
  readonly key = 'secrets';
  readonly state: SecretState = { found: {} };
  private readonly ghostLine: number;
  private readonly blimpLine: number;
  private readonly needle: Zone | null;
  private readonly tunnel: Zone | null;

  constructor(world: World) {
    this.ghostLine = world.lines.findIndex((l) => l.id === SECRET_LINES.ghost);
    this.blimpLine = world.lines.findIndex((l) => l.id === SECRET_LINES.blimp);
    this.needle = zoneOf(world, SECRET_ZONES.needle);
    this.tunnel = zoneOf(world, SECRET_ZONES.tunnel);
  }

  exportState(): SecretData {
    const found: Record<string, number> = {};
    for (const id of SECRET_IDS) {
      const t = this.state.found[id];
      if (t !== undefined) found[id] = t;
    }
    return { v: 1, found };
  }

  importState(data: unknown): void {
    const f: Partial<Record<SecretId, number>> = {};
    this.state.found = f;
    if (typeof data !== 'object' || data === null) return;
    const found = (data as { found?: unknown }).found;
    if (typeof found !== 'object' || found === null || Array.isArray(found)) return;
    for (const id of SECRET_IDS) {
      const t = (found as Record<string, unknown>)[id];
      if (typeof t === 'number' && Number.isInteger(t) && t >= 0) f[id] = t;
    }
  }

  step(game: Game): void {
    const sim = game.sim;
    const p = sim.player;
    for (const e of sim.events) {
      if (e.type !== 'hitch') continue;
      if (e.line === this.ghostLine && this.ghostLine >= 0) this.find(game, 'ghost');
      else if (e.line === this.blimpLine && this.blimpLine >= 0) this.find(game, 'blimp');
    }
    if (this.needle && p.mode === Mode.GROUND && inZone(this.needle, p.x, p.y, p.z)) this.find(game, 'needle');
    if (this.tunnel && inZone(this.tunnel, p.x, p.y, p.z)) this.find(game, 'tunnel');
  }

  private find(game: Game, id: SecretId): void {
    if (this.state.found[id] !== undefined) return;
    this.state.found[id] = game.sim.tick;
    game.events.push({ type: 'secretFound', id });
  }
}
