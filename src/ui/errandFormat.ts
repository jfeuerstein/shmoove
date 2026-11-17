/**
 * Words for errands, conductor challenges and secrets on tickets and in the ledger. Pure: reads
 * definitions and the world, returns board text (upper case, accents kept).
 */
import type { ActiveChallenge, ConductorDef } from '../sim/game/conductors';
import type { ErrandDef, ErrandFailReason, StepDef } from '../sim/game/errands';
import type { SecretId } from '../sim/game/secrets';
import type { World } from '../sim/world';
import { boardText, clockMinutes, clockText } from './format';

function zoneName(w: World, id: string): string {
  for (const z of w.zones) if (z.id === id) return z.name;
  return id;
}

function lineName(w: World, id: string): string {
  for (const l of w.lines) if (l.id === id) return l.name;
  return id;
}

/** m:ss for a number of ticks, rounded up (reads 0:00 only when time is up). */
export function ticksClock(ticks: number): string {
  const s = Math.max(0, Math.ceil(ticks / 60 - 1e-9));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss < 10 ? '0' : ''}${ss}`;
}

/** One decimal, dropping a trailing .0. */
function num(v: number): string {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** A step as a short imperative: "RIDE TRANVÍA 9 TO TERRAZA ALTA", "GRIND 30 M". */
export function stepText(w: World, s: StepDef): string {
  let t: string;
  switch (s.kind) {
    case 'reach':
      t = `Go to ${zoneName(w, s.zone)}`;
      break;
    case 'hitch':
      t = `Catch ${lineName(w, s.line)}`;
      break;
    case 'rideTo':
      t = `Ride ${lineName(w, s.line)} to ${zoneName(w, s.zone)}`;
      break;
    case 'deliver':
      t = `${s.maxSpeed !== undefined ? 'Gently to' : 'Deliver to'} ${zoneName(w, s.zone)}`;
      break;
    case 'chain':
      t = `Chain ${s.links} rides`;
      break;
    case 'grind':
      t = `Grind ${num(s.metres)} m`;
      break;
    case 'air':
      t = `Fly ${num(s.seconds)} s`;
      break;
  }
  if (s.noBail === true) t += ', no falls';
  if (s.noGround !== undefined) t += ', feet up';
  return boardText(t);
}

/** The progress figure of a step, or '' when it has none. */
export function progressText(s: StepDef, progress: number): string {
  switch (s.kind) {
    case 'chain':
      return `${Math.min(progress, s.links)}/${s.links}`;
    case 'grind':
      return `${Math.floor(Math.min(progress, s.metres))}/${num(s.metres)} M`;
    case 'air':
      return `${num(Math.min(progress, s.seconds))}/${num(s.seconds)} S`;
    default:
      return '';
  }
}

export function failText(reason: ErrandFailReason): string {
  switch (reason) {
    case 'time':
      return 'OUT OF TIME';
    case 'bail':
      return 'YOU FELL';
    case 'ground':
      return 'TOUCHED DOWN';
    case 'abandon':
      return 'GIVEN UP';
  }
}

/** "09:00–13:30" for an errand's hours, '' when it is offered all day. */
export function hoursText(def: Pick<ErrandDef, 'hours'>): string {
  if (!def.hours) return '';
  return `${clockText(clockMinutes(def.hours[0]))}–${clockText(clockMinutes(def.hours[1]))}`;
}

/** Where to find an errand's giver: the zone's name. */
export function giverText(w: World, def: ErrandDef): string {
  return boardText(zoneName(w, def.giver));
}

/** A conductor's task in one line. */
export function taskText(w: World, c: ConductorDef): string {
  const L = w.lines.find((l) => l.id === c.line);
  const t = c.task;
  let s: string;
  switch (t.kind) {
    case 'chainFrom':
      s = `Chain ${t.links} rides from here`;
      break;
    case 'slingDistance':
      s = `Let go and fly ${num(t.metres)} m`;
      break;
    case 'slingAir':
      s = `Let go and hang ${num(t.seconds)} s in the air`;
      break;
    case 'stayOn':
      s = `Stay on for ${t.segments} stops`;
      break;
    case 'stopToStop': {
      const from = L ? L.allStops[t.from]?.name ?? '' : '';
      const to = L ? L.allStops[t.to]?.name ?? '' : '';
      s = `Off at ${from}, roll to ${to} in ${t.seconds} s`;
      break;
    }
    case 'landOn':
      s = `Let go and land on ${zoneName(w, t.zone)}`;
      break;
  }
  return boardText(s);
}

/** The stop a conductor stands at. */
export function conductorStop(w: World, c: ConductorDef): string {
  const L = w.lines.find((l) => l.id === c.line);
  return boardText(L ? L.allStops[c.stop]?.name ?? '' : '');
}

/** The running challenge's progress chip text. */
export function chipText(c: ConductorDef, a: ActiveChallenge): string {
  const t = c.task;
  switch (t.kind) {
    case 'chainFrom':
      return `${Math.min(a.progress, t.links)}/${t.links}`;
    case 'slingDistance':
      return `${Math.floor(a.progress)}/${num(t.metres)} M`;
    case 'slingAir':
      return `${num(a.progress)}/${num(t.seconds)} S`;
    case 'stayOn':
      return `${a.progress}/${t.segments}`;
    case 'stopToStop':
      return a.progress > 0 ? ticksClock(Math.max(0, t.seconds - a.progress) * 60) : 'RIDE';
    case 'landOn':
      return 'LAND';
  }
}

export const SECRET_INFO: Readonly<Record<SecretId, { name: string; hint: string }>> = {
  ghost: { name: 'Tranvía Fantasma', hint: 'Runs when the trams sleep' },
  blimp: { name: 'El Dirigible', hint: 'Off the timetable at dusk' },
  needle: { name: 'La Aguja', hint: 'Above the summit' },
  tunnel: { name: 'Túnel Fantasma', hint: 'Where the old track goes dark' },
};
