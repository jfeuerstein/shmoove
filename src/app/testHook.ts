/**
 * The test hook: an `InputSource` that scripts can hold, and `window.__shmoove`, installed only with
 * `?hook`. The e2e and perf runners drive the game through it.
 *
 * Without a script holding it, `HookInput` reads as a thumb off the screen (tucked, no stick).
 */
import type { InputSource } from '../input/source';
import type { Sim } from '../sim/sim';
import type { InputFrame } from '../sim/types';
import type { FrameStatsSummary } from './loop';

export interface HookState {
  tick: number;
  x: number;
  y: number;
  z: number;
  speed: number;
  gear: number;
  grounded: boolean;
  tucked: boolean;
  chain: number;
  viewYaw: number;
  events: number;
}

export interface TestHook {
  ready: boolean;
  /** A plain copy of the parts of the sim state scripts check. */
  state(): HookState;
  /** Override the input until cleared with null. Fields left out read as a thumb off the screen. */
  hold(frame: Partial<InputFrame> | null): void;
  /** A hop on the next step. */
  hop(): void;
  /** Stop (true) or restart (false) the real-time clock. */
  pause(on: boolean): void;
  /** Advance n ticks now and render one frame. */
  step(n: number): void;
  /** Averages over the last 120 frames. */
  stats(): FrameStatsSummary;
}

declare global {
  interface Window {
    __shmoove?: TestHook;
  }
}

export class HookInput implements InputSource {
  private held: InputFrame | null = null;
  private hopNext = false;

  hold(frame: Partial<InputFrame> | null): void {
    if (frame === null) {
      this.held = null;
      return;
    }
    this.held = {
      steerX: typeof frame.steerX === 'number' ? frame.steerX : 0,
      steerY: typeof frame.steerY === 'number' ? frame.steerY : 0,
      carve: frame.carve === true,
      hop: frame.hop === true,
    };
  }

  hop(): void {
    this.hopNext = true;
  }

  sample(out: InputFrame): void {
    const h = this.held;
    if (h) {
      out.steerX = h.steerX;
      out.steerY = h.steerY;
      out.carve = h.carve;
      out.hop = h.hop;
    } else {
      out.steerX = 0;
      out.steerY = 0;
      out.carve = false;
      out.hop = false;
    }
    if (this.hopNext) {
      out.hop = true;
      this.hopNext = false;
    }
  }
}

/** What the hook needs from the app. */
export interface HookHost {
  sim: Sim;
  input: HookInput;
  pause(on: boolean): void;
  /** Run n sim steps now and draw one frame of the result. */
  stepNow(n: number): void;
  stats(): FrameStatsSummary;
}

export function installTestHook(host: HookHost): TestHook {
  const hook: TestHook = {
    ready: false,
    state() {
      const s = host.sim.state;
      const m = s.mover;
      return {
        tick: s.tick,
        x: m.x,
        y: m.y,
        z: m.z,
        speed: m.speed,
        gear: m.gear,
        grounded: m.grounded,
        tucked: m.tucked,
        chain: m.chain,
        viewYaw: s.viewYaw,
        events: s.events,
      };
    },
    hold(frame) {
      host.input.hold(frame);
    },
    hop() {
      host.input.hop();
    },
    pause(on) {
      host.pause(on);
    },
    step(n) {
      const k = Math.floor(n);
      if (!(k > 0)) return;
      host.stepNow(k);
    },
    stats() {
      return host.stats();
    },
  };
  window.__shmoove = hook;
  return hook;
}
