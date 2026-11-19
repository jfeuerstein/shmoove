/**
 * The build at a glance: four weapon tiles then four passive tiles just above the XP bar, each the
 * two-letter code with level pips under it. Empty slots are faint outlines. Tiles are about 34 px so
 * all eight fit at 390 px. A tile is rewritten only when its slot's item or level changes, so a
 * frame in which the build did not change writes nothing.
 */
import { PALETTE } from '../render/look';
import { MAX_LEVEL, PASSIVE_INFO, SLOTS, WEAPON_INFO, type Loadout } from '../sim/arsenal';
import './buildBar.css';

export interface TileState {
  /** Two letters, or empty for an empty slot. */
  code: string;
  /** 0 for an empty slot, else 1..5. */
  level: number;
}

/** What slot `slot` of the weapons (`passive` false) or passives shows. Pure. */
export function tileOf(l: Loadout, passive: boolean, slot: number): TileState {
  const id = passive ? l.passives[slot] : l.weapons[slot];
  if (id < 0) return { code: '', level: 0 };
  return passive
    ? { code: PASSIVE_INFO[id].code, level: l.passiveLevel[id] }
    : { code: WEAPON_INFO[id].code, level: l.weaponLevel[id] };
}

function cssHex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

interface TileEls {
  root: HTMLElement;
  code: HTMLElement;
  pips: HTMLElement[];
}

const TILES = SLOTS * 2;

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
    el.style.setProperty('--bb-weapon', cssHex(PALETTE.accent));
    el.style.setProperty('--bb-passive', cssHex(PALETTE.pad));
    for (let i = 0; i < TILES; i++) {
      if (i === SLOTS) {
        const gap = doc.createElement('div');
        gap.className = 'bb-gap';
        el.appendChild(gap);
      }
      const tile = doc.createElement('div');
      tile.className = 'bb-tile';
      const code = doc.createElement('div');
      code.className = 'bb-code';
      const pips = doc.createElement('div');
      pips.className = 'bb-pips';
      const pipEls: HTMLElement[] = [];
      for (let p = 0; p < MAX_LEVEL; p++) {
        const pip = doc.createElement('div');
        pip.className = 'bb-pip';
        pips.appendChild(pip);
        pipEls.push(pip);
      }
      tile.appendChild(code);
      tile.appendChild(pips);
      el.appendChild(tile);
      this.tiles.push({ root: tile, code, pips: pipEls });
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
      const t = this.tiles[i];
      const state = tileOf(l, passive, slot);
      const kind = passive ? 'bb-passive' : 'bb-weapon';
      t.root.className = id < 0 ? `bb-tile bb-empty ${kind}` : `bb-tile ${kind}`;
      t.code.textContent = state.code;
      for (let p = 0; p < t.pips.length; p++) t.pips[p].className = p < state.level ? 'bb-pip on' : 'bb-pip';
    }
  }
}
