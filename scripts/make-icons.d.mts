export type IconKind = 'any' | 'maskable' | 'apple';
export interface IconSpec {
  file: string;
  size: number;
  kind: IconKind;
}
export const PALETTE: Record<'ink' | 'mango' | 'pink' | 'cobalt' | 'paper', [number, number, number]>;
export const ICONS: IconSpec[];
export const MASKABLE_SAFE_RADIUS: number;
export const MARK_CENTRE: [number, number];
export const MARK_RADIUS: number;
export function renderIcon(size: number, kind: IconKind): Uint8Array;
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array;
export function makeIcons(): Array<IconSpec & { png: Uint8Array }>;
export function writeIcons(outDir: string): Array<IconSpec & { png: Uint8Array }>;
