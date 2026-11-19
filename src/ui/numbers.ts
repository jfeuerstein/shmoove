/**
 * Damage numbers, few and small, so they say how hard things are hit without burying the fight.
 *
 * - Each `FX_ENEMY_HIT` in the world's effects queue (burn and pop do not emit one) adds its damage
 *   to a number at the hit's place: hits landing within `MERGE_DIST` of a number born less than
 *   `MERGE_TIME` ago (in practice, the same enemy hit again) add to it instead of making another.
 * - A hit with an `FX_ENEMY_DIE` at its place in the same tick is a kill (drawn a little larger and
 *   warmer).
 * - An `FX_POP` becomes one larger number at the loop's centre with how many enemies died that tick.
 * - At most `NUMBER_POOL` show at once. When all are in use, a new number takes the place of the
 *   least of them (a pop over a kill over a bigger hit over a smaller one, the oldest of equals), or
 *   is not shown at all if it is the least: big hits and kills win the cap.
 * - None is drawn over the rider: one that would land within 2 m of it on the screen is pushed out
 *   to that edge (`riderOnScreen`, from the threat view, or the place passed to `update`). None is
 *   drawn over the build bar along the bottom.
 *
 * Numbers float up and fade over about 0.6 s. A fixed pool of elements; nothing is created after
 * the constructor and elements are moved by transform only. `ingest` is called after every sim tick
 * (the effects queue is cleared each tick); `update` once per frame, with the world-to-screen matrix.
 */
import { Matrix4, type Camera } from 'three';
import { FX_ENEMY_DIE, FX_ENEMY_HIT, FX_POP, type World } from '../sim/world';
import { project, riderOnScreen, type Projected } from './threat';
import './numbers.css';

/** The most numbers on screen at once. */
export const NUMBER_POOL = 8;
/** Seconds a number lives. */
export const NUMBER_LIFE = 0.6;
/** CSS px a number rises over its life. */
export const NUMBER_RISE = 40;
/** Hits this near a number (m, on the ground) born this recently (s) add to it. */
export const MERGE_DIST = 1.2;
export const MERGE_TIME = 0.3;
/** No number is drawn this near the bottom of the screen, where the build bar is, CSS px. */
export const NUMBER_BOTTOM = 110;
/** The least room kept round the rider on the screen, CSS px, however far away it is drawn. */
export const RIDER_KEEP_MIN = 36;
/** Height above the hit's place where the number starts, m. */
const LIFT = 0.9;
/** A hit and a death this near each other in one tick are the same enemy, m. */
const SAME_PLACE = 0.05;

/** What a number is, for the cap: higher wins. */
const RANK_HIT = 0;
const RANK_KILL = 1;
const RANK_POP = 2;

/** A place on the screen to keep clear: centre and radius, CSS px. */
export interface KeepOut {
  x: number;
  y: number;
  r: number;
  known: boolean;
}

const NOWHERE: KeepOut = { x: 0, y: 0, r: 0, known: false };

export class Numbers {
  readonly element: HTMLElement;
  private readonly els: HTMLElement[] = [];
  /** Seconds each has lived; at or past `NUMBER_LIFE` means free. */
  private readonly age = new Float32Array(NUMBER_POOL).fill(NUMBER_LIFE);
  private readonly wx = new Float32Array(NUMBER_POOL);
  private readonly wy = new Float32Array(NUMBER_POOL);
  private readonly wz = new Float32Array(NUMBER_POOL);
  /** The damage it adds up (or the pop's count), and what it is (RANK_*). */
  private readonly value = new Float32Array(NUMBER_POOL);
  private readonly rank = new Uint8Array(NUMBER_POOL);
  /** The text it shows now, to write only when it changes. */
  private readonly shownValue = new Int32Array(NUMBER_POOL).fill(-1);
  /** The class it has now (its rank), to write only when it changes. */
  private readonly shownRank = new Int8Array(NUMBER_POOL).fill(-1);
  /** 1 while the element is showing, 0 once hidden. */
  private readonly on = new Uint8Array(NUMBER_POOL);
  private readonly viewProj = new Matrix4();
  private readonly p: Projected = { x: 0, y: 0, w: 0 };
  /** Numbers not shown for want of room since the last reset, and hits merged into another: for tests. */
  dropped = 0;
  merged = 0;

  /** `doc` is a seam so tests can build the pool over a fake element tree. */
  constructor(root: HTMLElement, doc: Document = document) {
    const el = doc.createElement('div');
    el.className = 'nums';
    for (let i = 0; i < NUMBER_POOL; i++) {
      const n = doc.createElement('div');
      n.className = 'num';
      n.hidden = true;
      el.appendChild(n);
      this.els.push(n);
    }
    root.appendChild(el);
    this.element = el;
  }

  /** Numbers on screen now. */
  get active(): number {
    let n = 0;
    for (let i = 0; i < NUMBER_POOL; i++) if (this.age[i] < NUMBER_LIFE) n++;
    return n;
  }

  /** Forget everything on screen (a new run begins). */
  reset(): void {
    for (let i = 0; i < NUMBER_POOL; i++) {
      this.age[i] = NUMBER_LIFE;
      this.hide(i);
    }
    this.dropped = 0;
    this.merged = 0;
  }

  /** Take what one sim tick put in the world's effects queue. */
  ingest(w: World): void {
    const fx = w.fx;
    let died = 0;
    for (let i = 0; i < fx.count; i++) if (fx.type[i] === FX_ENEMY_DIE) died++;
    for (let i = 0; i < fx.count; i++) {
      const t = fx.type[i];
      if (t === FX_ENEMY_HIT) {
        // A hit that killed: a death this tick where the hit landed (both are at the enemy's place).
        let lethal = false;
        if (died > 0) {
          for (let j = 0; j < fx.count && !lethal; j++) {
            if (fx.type[j] !== FX_ENEMY_DIE) continue;
            const dx = fx.x[j] - fx.x[i];
            const dz = fx.z[j] - fx.z[i];
            lethal = dx * dx + dz * dz < SAME_PLACE * SAME_PLACE;
          }
        }
        this.hit(fx.x[i], fx.y[i] + LIFT, fx.z[i], Math.max(1, fx.a[i]), lethal);
      } else if (t === FX_POP) {
        this.spawn(fx.x[i], fx.y[i] + LIFT, fx.z[i], died, RANK_POP);
      }
    }
  }

  /** Once per frame, `dt` real seconds, after the camera has been placed for this frame. */
  updateCamera(dt: number, camera: Camera, width: number, height: number): void {
    camera.updateMatrixWorld();
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.update(dt, this.viewProj.elements, width, height, riderOnScreen);
  }

  /** The same with the view-projection matrix (column-major) already worked out; `keep` is the rider's place to keep clear. */
  update(dt: number, viewProj: ArrayLike<number>, width: number, height: number, keep: KeepOut = NOWHERE): void {
    for (let i = 0; i < NUMBER_POOL; i++) {
      if (this.age[i] >= NUMBER_LIFE) {
        if (this.on[i]) this.hide(i);
        continue;
      }
      this.age[i] += dt;
      const k = this.age[i] / NUMBER_LIFE;
      if (k >= 1) {
        this.age[i] = NUMBER_LIFE;
        this.hide(i);
        continue;
      }
      const el = this.els[i];
      if (!project(viewProj, this.wx[i], this.wy[i], this.wz[i], this.p)) {
        if (this.on[i]) this.hide(i);
        continue;
      }
      let x = ((this.p.x + 1) / 2) * width;
      let y = ((1 - this.p.y) / 2) * height - NUMBER_RISE * (1 - (1 - k) * (1 - k));
      if (keep.known) {
        // Off the rider: out to the edge of the room kept round it.
        const r = Math.max(RIDER_KEEP_MIN, keep.r);
        const dx = x - keep.x;
        const dy = y - keep.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < r * r) {
          const d = Math.sqrt(d2);
          if (d > 1e-3) {
            x = keep.x + (dx / d) * r;
            y = keep.y + (dy / d) * r;
          } else {
            y = keep.y - r;
          }
        }
      }
      // Not over the build bar along the bottom.
      if (y > height - NUMBER_BOTTOM) {
        if (this.on[i]) this.hide(i);
        continue;
      }
      if (!this.on[i]) {
        this.on[i] = 1;
        el.hidden = false;
      }
      this.write(i);
      el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
      el.style.opacity = String(Math.round((1 - k * k) * 20) / 20);
    }
  }

  private hide(i: number): void {
    this.on[i] = 0;
    this.els[i].hidden = true;
  }

  /** Text and class, written only when they change. */
  private write(i: number): void {
    const v = Math.max(0, Math.round(this.value[i]));
    if (v !== this.shownValue[i]) {
      this.shownValue[i] = v;
      this.els[i].textContent = this.rank[i] === RANK_POP && v === 0 ? 'POP' : String(v);
    }
    const r = this.rank[i];
    if (r !== this.shownRank[i]) {
      this.shownRank[i] = r;
      this.els[i].className = r === RANK_POP ? 'num num-big' : r === RANK_KILL ? 'num num-kill' : 'num';
    }
  }

  /** A hit of `damage` at (x, y, z), `lethal` if it killed: added to a young number at the same place, or a new one. */
  private hit(x: number, y: number, z: number, damage: number, lethal: boolean): void {
    const m2 = MERGE_DIST * MERGE_DIST;
    let best = -1;
    let bestD = m2;
    for (let i = 0; i < NUMBER_POOL; i++) {
      if (this.age[i] >= MERGE_TIME || this.rank[i] === RANK_POP) continue;
      const dx = this.wx[i] - x;
      const dz = this.wz[i] - z;
      const d = dx * dx + dz * dz;
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      this.value[best] += damage;
      this.wx[best] = x;
      this.wy[best] = y;
      this.wz[best] = z;
      if (lethal) this.rank[best] = RANK_KILL;
      this.merged++;
      return;
    }
    this.spawn(x, y, z, damage, lethal ? RANK_KILL : RANK_HIT);
  }

  /** Is number `i` less than a new one of rank `r` and value `v`? (Ties: the new one wins, the old has shown a while.) */
  private below(i: number, r: number, v: number): boolean {
    if (this.rank[i] !== r) return this.rank[i] < r;
    return this.value[i] <= v;
  }

  /** Put a number in a free slot, or in place of the least one if it is less than this. */
  private spawn(x: number, y: number, z: number, value: number, rank: number): void {
    let slot = -1;
    for (let i = 0; i < NUMBER_POOL; i++) {
      if (this.age[i] >= NUMBER_LIFE) {
        slot = i;
        break;
      }
    }
    if (slot < 0) {
      // The least: lowest rank, then smallest value, then oldest.
      let least = 0;
      for (let i = 1; i < NUMBER_POOL; i++) {
        const a = this.rank[i];
        const b = this.rank[least];
        if (a < b || (a === b && (this.value[i] < this.value[least] || (this.value[i] === this.value[least] && this.age[i] > this.age[least])))) {
          least = i;
        }
      }
      if (!this.below(least, rank, value)) {
        this.dropped++;
        return;
      }
      slot = least;
    }
    this.age[slot] = 0;
    this.wx[slot] = x;
    this.wy[slot] = y;
    this.wz[slot] = z;
    this.value[slot] = value;
    this.rank[slot] = rank;
    // Shown (written and placed) by the next update.
  }
}
