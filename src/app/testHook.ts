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
