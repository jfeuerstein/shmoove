/**
 * The one Node API the balance harness uses: writing its results file. The project carries no
 * Node types (nothing else in it runs in Node), so this declares just that.
 */
declare module 'node:fs' {
  export function writeFileSync(path: URL, data: string): void;
}
