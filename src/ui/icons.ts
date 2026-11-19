/**
 * Icons for everything a build is made of: one per weapon, passive and boon, drawn in code as inline
 * SVG. One family: a 24-unit grid, bold filled shapes with one cut-out detail, sized to read at 28 px
 * in the build bar and to look good at 64 px on a card. Every icon is filled or stroked with
 * `currentColor`, so whoever shows it tints it (weapons, passives and boons each have their colour).
 *
 * The markup is built once, when this module loads, and the same string is handed out every time.
 * Cut-outs are holes in a path (`fill-rule="evenodd"`), never masks, so the same icon can appear any
 * number of times on a page without ids.
 */
import { P_HASTE, P_HEART, P_HIDE, P_LUCK, P_MAGNET, P_MIGHT, P_REGEN, P_SPRINGS, P_WAX, P_WIDE_LOAD, P_WINGS } from '../sim/arsenal';
import { W_BUMPER, W_CRUMBS, W_LANCE, W_ORBIT, W_SEEKERS, W_SLAM, W_SLIPSTREAM, W_STATIC, W_SKIPPER, W_WAKE } from '../sim/arsenal';
import { BOON_HEAL, BOON_MIGHT, BOON_REACH, BOON_TOKENS, BOON_VIGOUR } from '../sim/offer';

export type IconKind = 'weapon' | 'passive' | 'boon';

// ---- drawing helpers: path data on the 24-unit grid ------------------------------------------

function n(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

function polyD(pts: readonly number[]): string {
  let d = `M${n(pts[0])} ${n(pts[1])}`;
  for (let i = 2; i < pts.length; i += 2) d += `L${n(pts[i])} ${n(pts[i + 1])}`;
  return `${d}Z`;
}

function circleD(cx: number, cy: number, r: number): string {
  return `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;
}

function ellipseD(cx: number, cy: number, rx: number, ry: number): string {
  return `M${n(cx - rx)} ${n(cy)}a${n(rx)} ${n(ry)} 0 1 0 ${n(2 * rx)} 0a${n(rx)} ${n(ry)} 0 1 0 ${n(-2 * rx)} 0Z`;
}

function rrectD(x: number, y: number, w: number, h: number, r: number): string {
  const k = Math.min(r, w / 2, h / 2);
  return (
    `M${n(x + k)} ${n(y)}H${n(x + w - k)}a${n(k)} ${n(k)} 0 0 1 ${n(k)} ${n(k)}V${n(y + h - k)}` +
    `a${n(k)} ${n(k)} 0 0 1 ${n(-k)} ${n(k)}H${n(x + k)}a${n(k)} ${n(k)} 0 0 1 ${n(-k)} ${n(-k)}` +
    `V${n(y + k)}a${n(k)} ${n(k)} 0 0 1 ${n(k)} ${n(-k)}Z`
  );
}

/** A point at angle `a` (radians, 0 = up, clockwise) and radius `r` round (cx, cy), pushed onto `out`. */
function polar(out: number[], cx: number, cy: number, r: number, a: number): void {
  out.push(cx + Math.sin(a) * r, cy - Math.cos(a) * r);
}

/** A star of `points` tips between radius `inner` and `outer`, first tip at angle `rot`. */
function starPts(cx: number, cy: number, points: number, outer: number, inner: number, rot = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < points * 2; i++) polar(out, cx, cy, i % 2 === 0 ? outer : inner, rot + (i * Math.PI) / points);
  return out;
}

/** A plus sign: arms of half-length `arm` and half-width `half`. */
function crossPts(cx: number, cy: number, arm: number, half: number): number[] {
  const a = arm;
  const h = half;
  return [
    cx - h, cy - a, cx + h, cy - a, cx + h, cy - h, cx + a, cy - h, cx + a, cy + h, cx + h, cy + h,
    cx + h, cy + a, cx - h, cy + a, cx - h, cy + h, cx - a, cy + h, cx - a, cy - h, cx - h, cy - h,
  ];
}

/** Rotate a flat point list by `a` radians (clockwise on screen) about (cx, cy) and move it by (dx, dy). */
function turn(pts: readonly number[], a: number, cx = 0, cy = 0, dx = cx, dy = cy): number[] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i] - cx;
    const y = pts[i + 1] - cy;
    out.push(dx + x * c - y * s, dy + x * s + y * c);
  }
  return out;
}

/** An arc's path from angle a0 to a1 (radians, 0 = up, clockwise), for a stroke. */
function arcD(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p: number[] = [];
  polar(p, cx, cy, r, a0);
  polar(p, cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `M${n(p[0])} ${n(p[1])}A${n(r)} ${n(r)} 0 ${large} ${sweep} ${n(p[2])} ${n(p[3])}`;
}

/** A filled shape; several sub-paths in one `d` cut holes in each other. */
function fill(d: string, transform = ''): string {
  const t = transform === '' ? '' : ` transform="${transform}"`;
  return `<path fill="currentColor" fill-rule="evenodd" d="${d}"${t}/>`;
}

function stroke(d: string, width: number, cap: 'round' | 'butt' = 'round', extra = ''): string {
  return (
    `<path fill="none" stroke="currentColor" stroke-width="${n(width)}" stroke-linecap="${cap}" ` +
    `stroke-linejoin="round" d="${d}"${extra}/>`
  );
}

function svg(kind: IconKind, name: string, body: string): string {
  return (
    `<svg class="icon icon-${kind}" data-icon="${kind}-${name}" xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`
  );
}

// ---- weapons --------------------------------------------------------------------------------

/** Wake: a flame with a trail of embers behind it. */
function wake(): string {
  const flame =
    'M15 22.5C10.6 22.5 8 19 8.9 15C9.6 11.8 12.6 10.2 12.4 5.8C15.6 7.6 16.6 10.4 16 12.8' +
    'C17.4 12 18.1 10.4 18 8.6C20.6 10.8 22.2 14 21.6 17.2C21 20.4 18.4 22.5 15 22.5Z' +
    'M15.1 20.4C13.3 20.4 12.3 19 12.7 17.3C13.1 15.7 14.6 15.1 14.8 13.6C16.6 15 17.9 16.6 17.5 18.4' +
    'C17.2 19.6 16.3 20.4 15.1 20.4Z';
  return fill(flame) + fill(circleD(5.6, 19.6, 2.3)) + fill(circleD(1.9, 21.7, 1.4));
}

/** Seekers: a homing dart, nose up and to the right. */
function seekers(): string {
  const dart = [0, -11.5, 4.6, -3.2, 1.6, -3.6, 1.6, 4.6, 4.4, 8.6, 4.4, 11.5, 0, 8.8, -4.4, 11.5, -4.4, 8.6, -1.6, 4.6, -1.6, -3.6, -4.6, -3.2];
  const slot = [0, -7.6, 1.9, -4.6, -1.9, -4.6];
  return fill(polyD(turn(dart, Math.PI / 4, 0, 0, 12, 12)) + polyD(turn(slot, Math.PI / 4, 0, 0, 12, 12)));
}

/** Bumper: the one who was hit, and everything round them thrown back. */
function bumper(): string {
  const chevron = [12, 0.6, 16.8, 5.4, 14.2, 5.4, 12, 3.2, 9.8, 5.4, 7.2, 5.4];
  let out = '';
  for (let q = 0; q < 4; q++) out += polyD(turn(chevron, (q * Math.PI) / 2, 12, 12));
  return fill(out) + fill(polyD(starPts(12, 12, 6, 5.6, 3.6, 0)) + circleD(12, 12, 1.7));
}

/** Slam: a blow straight down and the rings it sends along the ground. */
function slam(): string {
  const arrow = [10.2, 1, 13.8, 1, 13.8, 5.6, 17.4, 5.6, 12, 11.2, 6.6, 5.6, 10.2, 5.6];
  return (
    fill(polyD(arrow)) +
    fill(ellipseD(12, 17.4, 11.5, 5.4) + ellipseD(12, 17.4, 9.3, 4.1)) +
    fill(ellipseD(12, 17.4, 6.6, 2.9) + ellipseD(12, 17.4, 4.6, 1.9)) +
    fill(ellipseD(12, 17.4, 2.4, 1))
  );
}

/** Orbit: a saw disc. */
function orbit(): string {
  const teeth = 8;
  const pts: number[] = [];
  const step = (2 * Math.PI) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    polar(pts, 12, 12, 7.6, a);
    polar(pts, 12, 12, 11.6, a + step * 0.62);
    polar(pts, 12, 12, 9.4, a + step);
  }
  return fill(polyD(pts) + circleD(12, 12, 3.2));
}

/** Static: a bolt jumping between two enemies. */
function staticBolt(): string {
  const bolt = [13.4, 1, 5, 13.2, 10.6, 13.2, 8.2, 23, 19.4, 9.6, 13.6, 9.6, 16.6, 1];
  return fill(polyD(bolt)) + fill(circleD(3.4, 5.2, 2.4)) + fill(circleD(20.6, 19, 2.4));
}

/** Skipper: a flat stone and the skips it made. */
function skipper(): string {
  return (
    stroke('M1.4 20Q4.4 5.6 7.6 19.2Q10.4 9.6 13.2 17.6', 2.8, 'round', ' stroke-dasharray="0.1 3.9"') +
    fill(ellipseD(7.6, 21.6, 2.6, 0.9)) +
    fill(ellipseD(18.2, 15.4, 5.4, 3.4) + ellipseD(16.6, 14.4, 2.2, 1))
  );
}

/** Slipstream: the draft, curling in behind. */
function slipstream(): string {
  return (
    stroke('M2 7.4H13.4A3.4 3.4 0 1 0 10.2 3', 2.6) +
    stroke('M2 12.4H18.4A3.6 3.6 0 1 1 15 17', 2.6) +
    stroke('M2 17.4H9', 2.6) +
    fill(polyD(starPts(20.6, 5.6, 4, 2.8, 0.9, 0)))
  );
}

/** Crumbs: a mine with a lit fuse. */
function crumbs(): string {
  const cap = turn([-2.6, -2, 2.6, -2, 2.6, 2, -2.6, 2], Math.PI / 4, 0, 0, 15.8, 8.2);
  return (
    fill(circleD(10.4, 14.6, 7.6) + circleD(7.4, 11.6, 2)) +
    fill(polyD(cap)) +
    stroke('M17.2 6.8Q18 3.2 20.6 3.4', 1.8) +
    fill(polyD(starPts(21.4, 3.2, 4, 2.6, 0.8, Math.PI / 4)))
  );
}

/** Lance: a beam straight ahead, from the emitter to whatever it burns through. */
function lance(): string {
  return (
    fill(rrectD(9.2, 7, 5.6, 12, 1.2) + rrectD(11.2, 9.6, 1.6, 7.4, 0.8)) +
    fill(polyD(starPts(12, 5.6, 8, 5.6, 2.4, 0))) +
    fill('M5 23.4A7 5 0 0 1 19 23.4Z')
  );
}

// ---- passives -------------------------------------------------------------------------------

/** Wax: a block of board wax with a shine, sliding. */
function wax(): string {
  return (
    fill(rrectD(7.6, 6.4, 15, 11.2, 3) + polyD(starPts(13.4, 11.6, 4, 3.4, 1, 0)), 'rotate(-12 15 12)') +
    stroke('M1.6 10.4H4.8', 2.2) +
    stroke('M2.8 15H5.6', 2.2) +
    stroke('M5 21H18', 2.2)
  );
}

/** Haste: a stopwatch, its hand racing. */
function haste(): string {
  return (
    fill(circleD(12, 13.8, 9.4) + circleD(12, 13.8, 6.8)) +
    fill(rrectD(9.2, 0.8, 5.6, 2.8, 1.2)) +
    fill(polyD([11, 3.2, 13, 3.2, 13, 4.8, 11, 4.8])) +
    fill(polyD(turn([-1.4, -1.2, 1.4, -1.2, 1.4, 1.2, -1.4, 1.2], Math.PI / 4, 0, 0, 19.6, 5.6))) +
    stroke('M12 13.8L15.8 9.4', 2.4) +
    fill(circleD(12, 13.8, 1.9))
  );
}

/** Springs: a coil between two plates. */
function springs(): string {
  return (
    fill(rrectD(4, 1.4, 16, 3.2, 1.4)) +
    fill(rrectD(4, 19.4, 16, 3.2, 1.4)) +
    stroke('M7.4 6.4L16.6 8.6L7.4 11L16.6 13.4L7.4 15.6L16.6 17.8', 2.6)
  );
}

/** Wings: one wing, feathers fanned. */
function wings(): string {
  const wing =
    'M2.4 21C3.2 12.6 9 4.6 21.6 3C21.4 5.4 20 7.2 18 8.2C20 8.8 20.6 9.6 20 11' +
    'C18.8 12.8 16.6 13.4 14.2 13.6C15.6 14.4 15.6 15.6 14.4 16.6C12.4 18.2 9.4 18.4 7.2 18.2' +
    'C6 19.6 4.4 20.6 2.4 21Z' +
    'M6.6 15.6C8.4 11.6 11.4 8.6 15.4 6.8C12.2 9.4 10 12.2 8.6 15.6Z';
  return fill(wing);
}

/** Magnet: a horseshoe magnet. */
function magnet(): string {
  return (
    stroke('M6.4 7.6V13A5.6 5.6 0 0 0 17.6 13V7.6', 5, 'butt') +
    fill(polyD([3.9, 1.4, 8.9, 1.4, 8.9, 6.2, 3.9, 6.2])) +
    fill(polyD([15.1, 1.4, 20.1, 1.4, 20.1, 6.2, 15.1, 6.2]))
  );
}

const HEART =
  'M12 21.6C5.2 16.8 1.6 12.8 1.6 8.4C1.6 5.2 4 2.6 7.1 2.6C9.3 2.6 11 3.8 12 5.6' +
  'C13 3.8 14.7 2.6 16.9 2.6C20 2.6 22.4 5.2 22.4 8.4C22.4 12.8 18.8 16.8 12 21.6Z';

/** Heart: a heart with a shine. */
function heart(): string {
  return fill(HEART + ellipseD(6.8, 8, 1.6, 2.4));
}

/** Regen: a cross inside an arrow that comes round again. */
function regen(): string {
  const a0 = 0.5;
  const a1 = 2 * Math.PI - 0.45;
  const head: number[] = [];
  polar(head, 12, 12, 13.2, a0);
  polar(head, 12, 12, 5.8, a0);
  polar(head, 12, 12, 9.5, a0 - 0.75);
  return stroke(arcD(12, 12, 9.5, a0, a1), 2.6, 'butt') + fill(polyD(head)) + fill(polyD(crossPts(12, 12, 4.6, 1.7)));
}

/** Might: a kettlebell. */
function might(): string {
  return fill(rrectD(6.4, 1.6, 11.2, 10, 4.4) + rrectD(9, 4.2, 6, 5.6, 2.2)) + fill(circleD(12, 15.4, 7.4));
}

/** Hide: a shield with a chevron. */
function hide(): string {
  const shield = 'M12 1.4L21 4.8V11C21 16.6 17.2 20.6 12 22.6C6.8 20.6 3 16.6 3 11V4.8Z';
  return fill(shield + polyD([7, 9.4, 12, 12.6, 17, 9.4, 17, 12.6, 12, 15.8, 7, 12.6]));
}

/** Luck: a four-leaf clover. */
function luck(): string {
  const leaves = circleD(6.8, 6.4, 3.8) + circleD(15.2, 6.4, 3.8) + circleD(6.8, 14.8, 3.8) + circleD(15.2, 14.8, 3.8);
  return fill(leaves) + fill(circleD(11, 10.6, 1.8)) + stroke('M11 13Q11.4 19.6 16 23', 2.2);
}

/** Wide Load: a load with arrows pushing out to every corner. */
function wideLoad(): string {
  const arrow = [1.4, 1.4, 9, 1.4, 6.6, 3.8, 9.8, 7, 7, 9.8, 3.8, 6.6, 1.4, 9];
  let arrows = '';
  for (let q = 0; q < 4; q++) arrows += polyD(turn(arrow, (q * Math.PI) / 2, 12, 12));
  return fill(arrows) + fill(rrectD(9.2, 9.2, 5.6, 5.6, 1.2));
}

// ---- boons ----------------------------------------------------------------------------------

/** Breather: a flask of health. */
function breather(): string {
  return (
    fill(rrectD(7.6, 1, 8.8, 2.8, 1.2)) +
    fill(polyD([9.6, 3.4, 14.4, 3.4, 14.4, 8.6, 9.6, 8.6])) +
    fill(circleD(12, 15.2, 7.8) + polyD(crossPts(12, 15.4, 4, 1.4)))
  );
}

/** Pocket change: a stack of tokens and one on its edge. */
function pocketChange(): string {
  return (
    fill(rrectD(1.6, 19, 13.6, 3.6, 1.8)) +
    fill(rrectD(2.4, 14.4, 13.6, 3.6, 1.8)) +
    fill(rrectD(1.6, 9.8, 13.6, 3.6, 1.8)) +
    fill(circleD(17.6, 7, 5.6) + circleD(17.6, 7, 2.4))
  );
}

/** Might (boon): a mallet, for good. */
function mightBoon(): string {
  return fill(rrectD(4, 2.4, 16, 7.4, 1.8) + rrectD(6.4, 4.8, 2.4, 2.6, 0.6) + rrectD(15.2, 4.8, 2.4, 2.6, 0.6), 'rotate(-30 12 12)') +
    fill(rrectD(10.4, 9, 3.2, 14, 1.6), 'rotate(-30 12 12)');
}

/** Vigour: a heart with a plus cut in it. */
function vigour(): string {
  return fill(HEART + polyD(crossPts(12, 10.8, 4.2, 1.5)));
}

/** Reach: a spark and the wider ring it now comes from. */
function reach(): string {
  return (
    fill(polyD(starPts(12, 12, 4, 6.4, 2, 0))) +
    stroke('M12 12m-9.6 0a9.6 9.6 0 1 0 19.2 0a9.6 9.6 0 1 0 -19.2 0', 2.2, 'round', ' stroke-dasharray="3.6 3"')
  );
}

// ---- the tables -----------------------------------------------------------------------------

function table(kind: IconKind, entries: readonly [number, string, () => string][]): readonly string[] {
  const out: string[] = [];
  for (const [id, name, draw] of entries) out[id] = svg(kind, name, draw());
  return out;
}

/** Weapon icons by weapon id. */
export const WEAPON_ICONS: readonly string[] = table('weapon', [
  [W_WAKE, 'wake', wake],
  [W_SEEKERS, 'seekers', seekers],
  [W_BUMPER, 'bumper', bumper],
  [W_SLAM, 'slam', slam],
  [W_ORBIT, 'orbit', orbit],
  [W_STATIC, 'static', staticBolt],
  [W_SKIPPER, 'skipper', skipper],
  [W_SLIPSTREAM, 'slipstream', slipstream],
  [W_CRUMBS, 'crumbs', crumbs],
  [W_LANCE, 'lance', lance],
]);

/** Passive icons by passive id. */
export const PASSIVE_ICONS: readonly string[] = table('passive', [
  [P_WAX, 'wax', wax],
  [P_HASTE, 'haste', haste],
  [P_SPRINGS, 'springs', springs],
  [P_WINGS, 'wings', wings],
  [P_MAGNET, 'magnet', magnet],
  [P_HEART, 'heart', heart],
  [P_REGEN, 'regen', regen],
  [P_MIGHT, 'might', might],
  [P_HIDE, 'hide', hide],
  [P_LUCK, 'luck', luck],
  [P_WIDE_LOAD, 'wide-load', wideLoad],
]);

/** Boon icons by boon id. */
export const BOON_ICONS: readonly string[] = table('boon', [
  [BOON_HEAL, 'breather', breather],
  [BOON_TOKENS, 'pocket-change', pocketChange],
  [BOON_MIGHT, 'might', mightBoon],
  [BOON_VIGOUR, 'vigour', vigour],
  [BOON_REACH, 'reach', reach],
]);

/** The icon's SVG markup for a weapon, passive or boon id, or '' for an id that has none. */
export function iconSvg(kind: IconKind, id: number): string {
  const list = kind === 'weapon' ? WEAPON_ICONS : kind === 'passive' ? PASSIVE_ICONS : BOON_ICONS;
  return list[id] ?? '';
}

/** CSS hex for a palette colour. */
export function cssHex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}
