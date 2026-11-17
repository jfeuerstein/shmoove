export const SW_FILE: string;
export const CACHE_PREFIX: string;
export function listFiles(dir: string): string[];
export function cacheName(dir: string, files: string[]): string;
export function swSource(name: string, files: string[]): string;
export function buildServiceWorker(dir: string): { name: string; files: string[]; source: string };
export function writeServiceWorker(dir: string): { name: string; files: string[]; source: string };
