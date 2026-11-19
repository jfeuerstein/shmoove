/**
 * The build at a glance: four weapon tiles then four passive tiles just above the XP bar, each the
 * thing's icon with level pips under it. Empty slots are faint outlines. Tiles are 38 px wide with a
 * 28 px icon, so all eight fit at 360 px. A tile is rewritten only when its slot's item or level
 * changes, so a frame in which the build did not change writes nothing.
 *
 * `BuildRow` is the same build, written once, for the end card: what was carried, as icons with levels.
 */
import { PALETTE } from '../render/look';
import { MAX_LEVEL, PASSIVE_INFO, SLOTS, WEAPON_INFO, type Loadout } from '../sim/arsenal';
import { cssHex, iconSvg } from './icons';
import './buildBar.css';

export interface TileState {
  /** The icon's SVG markup, or empty for an empty slot. */
  icon: string;
  /** What it is, for assistive tech; empty for an empty slot. */
  name: string;
  /** 0 for an empty slot, else 1..5. */
  level: number;
}

/** What slot `slot` of the weapons (`passive` false) or passives shows. Pure. */
export function tileOf(l: Loadout, passive: boolean, slot: number): TileState {
  const id = passive ? l.passives[slot] : l.weapons[slot];
  if (id < 0) return { icon: '', name: '', level: 0 };
  return passive
    ? { icon: iconSvg('passive', id), name: PASSIVE_INFO[id].name, level: l.passiveLevel[id] }
    : { icon: iconSvg('weapon', id), name: WEAPON_INFO[id].name, level: l.weaponLevel[id] };
}

interface TileEls {
  root: HTMLElement;
  icon: HTMLElement;
  pips: HTMLElement[];
}

const TILES = SLOTS * 2;

/** One tile: an icon box with a row of level pips under it. */
function makeTile(doc: Document, parent: HTMLElement): TileEls {
  const root = doc.createElement('div');
  root.className = 'bb-tile';
  const icon = doc.createElement('div');
  icon.className = 'bb-icon';
  const pipRow = doc.createElement('div');
  pipRow.className = 'bb-pips';
  const pips: HTMLElement[] = [];
  for (let p = 0; p < MAX_LEVEL; p++) {
    const pip = doc.createElement('div');
    pip.className = 'bb-pip';
    pipRow.appendChild(pip);
    pips.push(pip);
  }
  root.appendChild(icon);
  root.appendChild(pipRow);
  parent.appendChild(root);
  return { root, icon, pips };
}

function paint(t: TileEls, state: TileState, passive: boolean): void {
  const kind = passive ? 'bb-passive' : 'bb-weapon';
  t.root.className = state.level === 0 ? `bb-tile bb-empty ${kind}` : `bb-tile ${kind}`;
  t.icon.innerHTML = state.icon;
  t.icon.setAttribute('aria-label', state.name);
  for (let p = 0; p < t.pips.length; p++) t.pips[p].className = p < state.level ? 'bb-pip on' : 'bb-pip';
}

/** Weapons in their colour, passives in theirs, read from the palette when the view is built. */
function tint(el: HTMLElement): void {
  el.setAttribute('style', `--bb-weapon: ${cssHex(PALETTE.accent)}; --bb-passive: ${cssHex(PALETTE.pad)}`);
}

export class BuildBar {
  readonly element: HTMLElement;
  private readonly tiles: TileEls[] = [];
  /** What each tile shows now: the id (-1 empty, -2 before the first write) and the level. */
  private readonly shownId = new Int16Array(TILES).fill(-2);
  private readonly shownLevel = new Uint8Array(TILES);

  /** `doc` is a seam so tests can build the bar over a fake element tree. */
  constructor(root: HTMLElement, doc: Document = document) {
    const el = doc.createElement('div');
    el.className = 'bb';
    tint(el);
    for (let i = 0; i < TILES; i++) {
      if (i === SLOTS) {
        const gap = doc.createElement('div');
        gap.className = 'bb-gap';
        el.appendChild(gap);
      }
      this.tiles.push(makeTile(doc, el));
    }
    root.appendChild(el);
    this.element = el;
  }

  /** Once per frame. */
  update(l: Loadout): void {
    for (let i = 0; i < TILES; i++) {
      const passive = i >= SLOTS;
      const slot = passive ? i - SLOTS : i;
      const id = passive ? l.passives[slot] : l.weapons[slot];
      const level = id < 0 ? 0 : passive ? l.passiveLevel[id] : l.weaponLevel[id];
      if (id === this.shownId[i] && level === this.shownLevel[i]) continue;
      this.shownId[i] = id;
      this.shownLevel[i] = level;
      paint(this.tiles[i], tileOf(l, passive, slot), passive);
    }
  }
}

/**
 * The build as a row of icons with level pips, written once when asked (the end card). Only what
 * was carried is shown: weapons first, then passives, each in the order taken.
 */
export class BuildRow {
  readonly element: HTMLElement;
  private readonly tiles: TileEls[] = [];

  constructor(parent: HTMLElement, doc: Document = document) {
    const el = doc.createElement('div');
    el.className = 'bb-row';
    tint(el);
    for (let i = 0; i < TILES; i++) this.tiles.push(makeTile(doc, el));
    parent.appendChild(el);
    this.element = el;
  }

  show(l: Loadout): void {
    let carried = 0;
    for (let i = 0; i < TILES; i++) {
      const passive = i >= SLOTS;
      const state = tileOf(l, passive, passive ? i - SLOTS : i);
      const t = this.tiles[i];
      paint(t, state, passive);
      t.root.hidden = state.level === 0;
      if (state.level > 0) carried++;
    }
    this.element.hidden = carried === 0;
  }
}
