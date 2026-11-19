/**
 * The tuned tables, as source text, and one hash of them all. `npm run balance` stores the hash
 * in `last.json` with its results; the light balance test in `npm test` fails when the hash no
 * longer matches, so no number in these tables can change without the full harness being run again.
 *
 * Only the tables are hashed, not the files they live in: code around them can change freely.
 */
/** Every source file under src/sim, as text, by path relative to this file. */
const SOURCES = import.meta.glob<string>('../../src/sim/**/*.ts', { query: '?raw', import: 'default', eager: true });

function source(file: string): string {
  const text = SOURCES[`../../${file}`];
  if (text === undefined) throw new Error(`no source ${file}`);
  return text.replace(/\r\n/g, '\n');
}

/** Each tuned file and the tables in it: named constants, or `*` for the whole file. */
export const TUNED: readonly { file: string; names: readonly string[] }[] = [
  { file: 'src/sim/balance.ts', names: ['*'] },
  { file: 'src/sim/seekers.ts', names: ['SEEKERS', 'SEEKER_RANGE', 'DART_SPEED', 'DART_LIFE_TICKS'] },
  { file: 'src/sim/weapons/crumbs.ts', names: ['CRUMBS'] },
  { file: 'src/sim/weapons/lance.ts', names: ['LANCE'] },
  { file: 'src/sim/weapons/orbit.ts', names: ['ORBIT'] },
  { file: 'src/sim/weapons/skipper.ts', names: ['SKIPPER'] },
  { file: 'src/sim/weapons/slam.ts', names: ['SLAM'] },
  { file: 'src/sim/weapons/slipstream.ts', names: ['SLIPSTREAM'] },
  { file: 'src/sim/weapons/static.ts', names: ['STATIC'] },
  { file: 'src/sim/stats.ts', names: ['BASE_HP', 'BUMPER'] },
  { file: 'src/sim/arsenal.ts', names: ['PASSIVE_INFO'] },
  { file: 'src/sim/offer.ts', names: ['OFFER'] },
  { file: 'src/sim/world.ts', names: ['KINDS'] },
  { file: 'src/sim/director.ts', names: ['DIRECTOR'] },
  { file: 'src/sim/horde.ts', names: ['HORDE'] },
  { file: 'src/sim/hazards.ts', names: ['HAZARDS'] },
  { file: 'src/sim/bosses.ts', names: ['BOSS'] },
  { file: 'src/sim/things.ts', names: ['THINGS'] },
  { file: 'src/sim/constants.ts', names: ['FEEL:combat', 'FEEL:wake'] },
];

/** The text of `const name = ...;` in `src`: a bracketed literal to its matching close, or one line. */
function block(src: string, name: string, file: string): string {
  if (name.startsWith('FEEL:')) {
    // The rows of one group of the feel table.
    const group = name.slice(5);
    const rows = src.split('\n').filter((l) => l.includes(`group: '${group}'`));
    if (rows.length === 0) throw new Error(`${file}: no FEEL rows in group ${group}`);
    return rows.join('\n');
  }
  const m = new RegExp(`(^|\\n)export const ${name}\\b[^=]*=\\s*`).exec(src);
  if (!m) throw new Error(`${file}: no table ${name}`);
  const start = m.index + m[0].length;
  const open = src[start];
  if (open !== '{' && open !== '[') {
    const end = src.indexOf(';', start);
    return src.slice(m.index, end + 1);
  }
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) {
        if (c !== close) throw new Error(`${file}: ${name} is not balanced`);
        return src.slice(m.index, i + 1);
      }
    }
  }
  throw new Error(`${file}: ${name} never closes`);
}

/** The tuned tables' source text, in a fixed order. */
export function tablesText(): string {
  const parts: string[] = [];
  for (const t of TUNED) {
    const src = source(t.file);
    for (const name of t.names) parts.push(`// ${t.file} ${name}\n${name === '*' ? src : block(src, name, t.file)}`);
  }
  return parts.join('\n');
}

/** Two 32-bit FNV-1a hashes of the text (different offsets), as 16 hex digits. */
function fnv(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193) >>> 0;
    b = (b ^ (b >>> 15)) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** The hash of `tablesText()`. */
export function tablesHash(): string {
  return fnv(tablesText());
}
