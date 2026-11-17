/** Contract between the app and the e2e / perf harness (tests/e2e, tests/perf). */
export interface SkitchTestState {
  tick: number;
  mode: string;
  x: number;
  y: number;
  z: number;
  speed: number;
  chain: number;
  hitchedLine: string | null;
  dayFrac: number;
  /** Types of the sim events since the previous state() call, in order. */
  events?: string[];
  /** Smoothed steer applied to the board, and whether the touch is armed to hitch. */
  steer?: number;
  armed?: boolean;
  /** Rows in the feel panel (0 when it is not open). */
  feelRows?: number;
  /** Anything else a screen wants a route to be able to assert on. */
  ui?: Record<string, string | number | boolean>;
}

export interface SkitchPerfStats {
  frames: number;
  workMs: number[];
  drawCalls: number;
  triangles: number;
}

export interface SkitchHook {
  ready: boolean;
  /** true when opened with ?e2e: the app does not run its own rAF loop */
  manual: boolean;
  /** manual mode only: step the sim `ticks` fixed steps (sampling current input each step), then render exactly one frame */
  advance(ticks: number): void;
  state(): SkitchTestState;
  /** since the last resetStats(); workMs[i] = duration of frame i's work (sim + scene update + render submit) inside the rAF callback; drawCalls/triangles are from the most recent frame */
  stats(): SkitchPerfStats;
  resetStats(): void;
}

declare global {
  interface Window {
    __skitch?: SkitchHook;
  }
}

export function installHook(hook: SkitchHook): void {
  window.__skitch = hook;
}
