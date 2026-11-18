/** The playtest list quotes feel constants; it must quote the shipped values. */
import { describe, expect, it } from 'vitest';
import text from '../../docs/PLAYTEST.md?raw';
import { FEEL_DEFS, type FeelKey } from '../../src/sim/constants';

// Rows look like: | `key` | 0.35 /s | too low ... | too high ... |
const rows = [...text.matchAll(/^\| `([A-Za-z0-9]+)` \| (-?[0-9.]+)/gm)];

describe('docs/PLAYTEST.md', () => {
  it('lists constants that exist, with their shipped values', () => {
    expect(rows.length).toBeGreaterThan(10);
    const wrong: string[] = [];
    for (const [, key, value] of rows) {
      const def = FEEL_DEFS[key as FeelKey];
      if (!def) wrong.push(`${key}: not a FEEL constant`);
      else if (Number(value) !== def.v) wrong.push(`${key}: the list says ${value}, the game ships ${def.v}`);
    }
    expect(wrong).toEqual([]);
  });
});
