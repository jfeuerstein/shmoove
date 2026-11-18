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
  /** Audio mixer facts: context running, track (district, -1 none), stems in, full band, wheel level. */
  audio?: { running: boolean; track: number; stems: number; fullBand: boolean; wheel: number };
  /**
   * Every ride line in world order: its id; its livery base and stripe (0xRRGGBB) and pattern;
   * `painted`, whether base and stripe are both in the vertex colours of every one of its vehicle
   * meshes; `paint`, a hash of the vertex colours its first vehicle is drawn with; and `drawn`, how
   * many of its vehicles are drawn this frame.
   */
  lines?: { id: string; base: number; stripe: number; pattern: number; painted: boolean; paint: number; drawn: number }[];
  /** Finds: tiles drawn in the world and bursts flying this frame, tiles taken, the deck and kit worn. */
  finds?: { drawn: number; bursts: number; count: number; deck: string; kit: string };
  /** Anything else a screen wants a route to be able to assert on. */
  ui?: Record<string, string | number | boolean>;
}

export interface SkitchPerfStats {
  frames: number;
  workMs: number[];
  drawCalls: number;
  triangles: number;
  /**
   * Frame accounting, one entry per frame like `workMs`: milliseconds per part of the frame (sim,
   * each reducer, each view part, UI, audio...) and `steps`, the sim steps the frame carried.
   */
  parts?: Record<string, number[]>;
  /** Milliseconds of each game step (sim + reducers) in those frames, in order. */
  stepMs?: number[];
  /**
   * Where each frame was, one entry per frame like `workMs`: `tick` (route ticks played after the
   * frame), `x`, `z`, `district`, `chunk` (streaming chunk under the skater), `hitches` (in the
   * frame), `built` (chunk meshes the world view finished in the frame), `draws` and `tris` (the
   * frame's draw calls and triangles), `slings` (ride releases in the frame) and `piece` (the
   * longest chunk-build piece of the frame, ms).
   */
  track?: Record<string, number[]>;
  /** The route's timed windows, in route ticks (src/app/routes.ts `routeWindows`). */
  windows?: { name: string; from: number; to: number }[];
  /** Streaming totals of the city view since load (absent for a world drawn whole). */
  stream?: { shown: number; resident: number; builtTotal: number; worstChunkMs: number; worstFrameBuildMs: number; worstPieceMs: number; triangles: number };
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
