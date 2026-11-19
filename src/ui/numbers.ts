/**
 * Damage numbers. Each `FX_ENEMY_HIT` in the world's effects queue (burn and pop do not emit one)
 * becomes a number at the hit's place on the screen that floats up and fades over about 0.6 s; an
 * `FX_POP` becomes one larger number at the loop's centre with how many enemies died that tick.
 *
 * A fixed pool of 24 elements, the oldest reused when all are in use; nothing is created after the
 * constructor and elements are moved by transform only. `ingest` is called after every sim tick (the
 * effects queue is cleared each tick); `update` once per frame, with the world-to-screen matrix.
 */
import { Matrix4, type Camera } from 'three';
import { FX_ENEMY_DIE, FX_ENEMY_HIT, FX_POP, type World } from '../sim/world';
import { project, type Projected } from './threat';
import './numbers.css';

export const NUMBER_POOL = 24;
/** Seconds a number lives. */
export const NUMBER_LIFE = 0.6;
/** CSS px a number rises over its life. */
export const NUMBER_RISE = 56;
/** Height above the hit's place where the number starts, m. */
const LIFT = 0.9;

export class Numbers {
  readonly element: HTMLElement;
  private readonly els: HTMLElement[] = [];
  /** Seconds each has lived; at or past `NUMBER_LIFE` means free. */
  private readonly age = new Float32Array(NUMBER_POOL).fill(NUMBER_LIFE);
  private readonly wx = new Float32Array(NUMBER_POOL);
  private readonly wy = new Float32Array(NUMBER_POOL);
  private readonly wz = new Float32Array(NUMBER_POOL);
  /** 1 while the element is showing, 0 once hidden. */
  private readonly on = new Uint8Array(NUMBER_POOL);
  private readonly big = new Uint8Array(NUMBER_POOL);
  private readonly viewProj = new Matrix4();
  private readonly p: Projected = { x: 0, y: 0, w: 0 };

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
  }

  /** Take what one sim tick put in the world's effects queue. */
  ingest(w: World): void {
    const fx = w.fx;
    let died = 0;
    for (let i = 0; i < fx.count; i++) if (fx.type[i] === FX_ENEMY_DIE) died++;
    for (let i = 0; i < fx.count; i++) {
      const t = fx.type[i];
      if (t === FX_ENEMY_HIT) {
        this.spawn(fx.x[i], fx.y[i] + LIFT, fx.z[i], String(Math.max(1, Math.round(fx.a[i]))), false);
      } else if (t === FX_POP) {
        this.spawn(fx.x[i], fx.y[i] + LIFT, fx.z[i], died > 0 ? String(died) : 'POP', true);
      }
    }
  }

  /** Once per frame, `dt` real seconds, after the camera has been placed for this frame. */
  updateCamera(dt: number, camera: Camera, width: number, height: number): void {
    camera.updateMatrixWorld();
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.update(dt, this.viewProj.elements, width, height);
  }

  /** The same with the view-projection matrix (column-major) already worked out. */
  update(dt: number, viewProj: ArrayLike<number>, width: number, height: number): void {
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
      if (!this.on[i]) {
        this.on[i] = 1;
        el.hidden = false;
      }
      const x = ((this.p.x + 1) / 2) * width;
      const y = ((1 - this.p.y) / 2) * height - NUMBER_RISE * (1 - (1 - k) * (1 - k));
      el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
      el.style.opacity = String(Math.round((1 - k * k) * 20) / 20);
    }
  }

  private hide(i: number): void {
    this.on[i] = 0;
    this.els[i].hidden = true;
  }

  /** Put a number in a free slot, or the one that has lived longest. */
  private spawn(x: number, y: number, z: number, text: string, big: boolean): void {
    let slot = 0;
    let oldest = -1;
    for (let i = 0; i < NUMBER_POOL; i++) {
      if (this.age[i] >= NUMBER_LIFE) {
        slot = i;
        oldest = Infinity;
        break;
      }
      if (this.age[i] > oldest) {
        oldest = this.age[i];
        slot = i;
      }
    }
    this.age[slot] = 0;
    this.wx[slot] = x;
    this.wy[slot] = y;
    this.wz[slot] = z;
    const el = this.els[slot];
    el.textContent = text;
    const b = big ? 1 : 0;
    if (b !== this.big[slot]) {
      this.big[slot] = b;
      el.className = big ? 'num num-big' : 'num';
    }
    // Shown (and placed) by the next update.
  }
}
