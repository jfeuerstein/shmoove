import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';
import { routeQuery, validateRoute, waitSlices, type Route } from '../e2e/lib/route.mjs';

describe('route validation', () => {
  const valid: Route = {
    name: 'demo',
    params: 'seed=3',
    steps: [
      { do: 'down', x: 300, y: 600 },
      { do: 'move', x: 200, y: 500 },
      { do: 'up' },
      { do: 'swipeUp' },
      { do: 'swipeUp', x: 195, y: 700, hold: true },
      { do: 'wait', ticks: 30 },
      { do: 'shot', name: 'after-wait' },
      { do: 'expect', label: 'moved', test: (s) => s.x > 0 },
    ],
  };

  it('accepts a well-formed route using every step type', () => {
    expect(validateRoute(valid)).toEqual([]);
  });

  it('rejects non-objects and missing fields', () => {
    expect(validateRoute(null)).not.toEqual([]);
    expect(validateRoute({ steps: [{ do: 'up' }] })).toEqual([expect.stringContaining("'name'")]);
    expect(validateRoute({ name: 'x', steps: [] })).toEqual([expect.stringContaining("'steps'")]);
    expect(validateRoute({ name: 'x', params: 3, steps: [{ do: 'up' }] })).toEqual([
      expect.stringContaining("'params'"),
    ]);
  });

  it('reports each bad step with its index', () => {
    const errs = validateRoute({
      name: 'bad',
      steps: [
        { do: 'down', x: 300 },
        { do: 'move', x: 500, y: 10 },
        { do: 'wait', ticks: 0 },
        { do: 'wait', ticks: 2.5 },
        { do: 'shot', name: '../escape' },
        { do: 'expect', label: '', test: 'x > 0' },
        { do: 'swipeUp', hold: 'yes' },
        { do: 'jump' },
      ],
    });
    expect(errs.some((e) => e.startsWith('steps[0]') && e.includes("'y' is required"))).toBe(true);
    expect(errs.some((e) => e.startsWith('steps[1]') && e.includes("'x'"))).toBe(true);
    expect(errs.some((e) => e.startsWith('steps[2]'))).toBe(true);
    expect(errs.some((e) => e.startsWith('steps[3]'))).toBe(true);
    expect(errs.some((e) => e.startsWith('steps[4]'))).toBe(true);
    expect(errs.filter((e) => e.startsWith('steps[5]'))).toHaveLength(2);
    expect(errs.some((e) => e.startsWith('steps[6]') && e.includes("'hold'"))).toBe(true);
    expect(errs.some((e) => e.startsWith('steps[7]') && e.includes("unknown step 'jump'"))).toBe(true);
  });

  it('builds the page query from route params', () => {
    expect(routeQuery({})).toBe('?e2e&mute');
    expect(routeQuery({ params: 'seed=3&t=0.5' })).toBe('?e2e&mute&seed=3&t=0.5');
    expect(routeQuery({ params: '?slice' })).toBe('?e2e&mute&slice');
  });

  it('splits waits into slices of at most 6 ticks', () => {
    expect(waitSlices(30)).toEqual([6, 6, 6, 6, 6]);
    expect(waitSlices(13)).toEqual([6, 6, 1]);
    expect(waitSlices(4)).toEqual([4]);
  });
});

describe('sim purity lint rules', () => {
  // One line per restricted item; each line must produce at least one report on its own line.
  const lines: Array<[string, string]> = [
    ['three', "import { Vector3 } from 'three';"],
    ['three/*', "import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';"],
    ['src/render', "import { look } from '../render/look';"],
    ['src/ui', "import { board } from '../ui/board';"],
    ['src/audio', "import { mixer } from '../audio/mixer';"],
    ['src/app', "import { boot } from '../../src/app/main';"],
    ['src/input', "import { gestures } from '../input/gestures';"],
    ['window', 'export const g1 = window;'],
    ['document', 'export const g2 = document;'],
    ['navigator', 'export const g3 = navigator;'],
    ['performance', 'export const g4 = performance;'],
    ['Date', 'export const g5 = Date;'],
    ['localStorage', 'export const g6 = localStorage;'],
    ['requestAnimationFrame', 'export const g7 = requestAnimationFrame;'],
    ['setTimeout', 'export const g8 = setTimeout;'],
    ['setInterval', 'export const g9 = setInterval;'],
    ...[
      'random', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'pow', 'exp', 'log', 'log2',
      'log10', 'sinh', 'cosh', 'tanh', 'hypot', 'cbrt', 'expm1', 'log1p',
    ].map((p): [string, string] => [`Math.${p}`, `export const m_${p} = Math.${p};`]),
    ['** operator', 'export const p1 = (look as unknown as number) ** 2;'],
    ['**= operator', 'export let p2 = 2; p2 **= 2;'],
  ];
  const allowed = 'export const ok = Math.sqrt(2) + Math.abs(-1) + Math.floor(1.5) + Math.min(1, 2);';
  const source = [...lines.map(([, code]) => code), allowed].join('\n') + '\n';

  let simMessages: ESLint.LintResult['messages'] = [];
  let renderMessages: ESLint.LintResult['messages'] = [];

  beforeAll(async () => {
    const eslint = new ESLint();
    [{ messages: simMessages }] = await eslint.lintText(source, { filePath: 'src/sim/x.ts' });
    [{ messages: renderMessages }] = await eslint.lintText(source, { filePath: 'src/render/x.ts' });
  });

  const PURITY_RULES = new Set([
    'no-restricted-imports',
    'no-restricted-globals',
    'no-restricted-properties',
    'no-restricted-syntax',
  ]);

  it.each(lines.map(([label], i) => [label, i + 1] as const))('reports %s in src/sim', (_label, line) => {
    const hits = simMessages.filter((m) => m.line === line && m.ruleId !== null && PURITY_RULES.has(m.ruleId));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((m) => m.severity === 2)).toBe(true);
  });

  it('allows the deterministic Math functions in src/sim', () => {
    const line = lines.length + 1;
    expect(simMessages.filter((m) => m.line === line)).toEqual([]);
  });

  it('does not apply the purity rules outside src/sim', () => {
    expect(renderMessages.filter((m) => m.ruleId !== null && PURITY_RULES.has(m.ruleId))).toEqual([]);
  });
});

describe('repo-wide lint rules', () => {
  const eslint = new ESLint();
  const lint = async (code: string) => (await eslint.lintText(code, { filePath: 'src/app/y.ts' }))[0].messages;

  it('forbids any', async () => {
    const m = await lint('export const v: any = 1;\n');
    expect(m.map((x) => x.ruleId)).toContain('@typescript-eslint/no-explicit-any');
  });

  it('forbids @ts-ignore', async () => {
    const m = await lint('// @ts-ignore\nexport const v = 1;\n');
    expect(m.map((x) => x.ruleId)).toContain('@typescript-eslint/ban-ts-comment');
  });

  it('errors on unused vars but allows the _ prefix', async () => {
    const m = await lint('const unused = 1;\nconst _ignored = 2;\nexport function f(_a: number): void {}\n');
    const unused = m.filter((x) => x.ruleId === '@typescript-eslint/no-unused-vars');
    expect(unused).toHaveLength(1);
    expect(unused[0].line).toBe(1);
    expect(unused[0].severity).toBe(2);
  });
});
