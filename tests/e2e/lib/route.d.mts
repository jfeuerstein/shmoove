import type { SkitchTestState } from '../../../src/app/testHook';

export type Step =
  | { do: 'down'; x: number; y: number }
  | { do: 'move'; x: number; y: number }
  | { do: 'up' }
  | { do: 'swipeUp'; x?: number; y?: number; hold?: boolean }
  | { do: 'wait'; ticks: number }
  | { do: 'shot'; name: string }
  | { do: 'expect'; label: string; test: (state: SkitchTestState, history: SkitchTestState[]) => boolean };

export interface Route {
  name: string;
  params?: string;
  steps: Step[];
}

export const VIEW_W: number;
export const VIEW_H: number;
export const MAX_SLICE_TICKS: number;
export const SWIPE_STEP_PX: number;
export const SWIPE_MOVES: number;
export function validateRoute(route: unknown): string[];
export function routeQuery(route: Pick<Route, 'params'>): string;
export function waitSlices(ticks: number): number[];
