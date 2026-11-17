// The milestone gate: typecheck, lint, test, build, e2e, pwa, perf, in order. Stops at the first failure
// and prints a summary table with durations. Exit code is non-zero unless every stage passed.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// `build` already typechecks; build:app (icons, vite build, service worker) avoids running tsc twice.
const STAGES = [
  ['typecheck', ['run', 'typecheck']],
  ['lint', ['run', 'lint']],
  ['test', ['test']],
  ['build', ['run', 'build:app']],
  ['e2e', ['run', 'e2e']],
  ['pwa', ['run', 'e2e:pwa']],
  ['perf', ['run', 'perf']],
];

const results = [];
let failed = false;
for (const [name, args] of STAGES) {
  if (failed) {
    results.push({ name, status: 'SKIP', ms: 0 });
    continue;
  }
  console.log(`\n=== gate: ${name} ===`);
  const t0 = Date.now();
  const r = spawnSync('npm', args, { cwd: ROOT, stdio: 'inherit' });
  const ok = r.status === 0;
  results.push({ name, status: ok ? 'PASS' : 'FAIL', ms: Date.now() - t0 });
  if (!ok) failed = true;
}

const total = results.reduce((s, r) => s + r.ms, 0);
console.log('\ngate summary');
console.log(`  ${'stage'.padEnd(10)}${'result'.padEnd(8)}${'time'.padStart(8)}`);
for (const r of results) {
  console.log(`  ${r.name.padEnd(10)}${r.status.padEnd(8)}${(r.ms / 1000).toFixed(1).padStart(7)}s`);
}
console.log(`  ${'total'.padEnd(18)}${(total / 1000).toFixed(1).padStart(7)}s`);
console.log(failed ? '\ngate: RED' : '\ngate: GREEN');
process.exitCode = failed ? 1 : 0;
