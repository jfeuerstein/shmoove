const S = require('../js/sim.js'), Wd = require('../js/world.js');
function cfg0() { const m = {}; for (const k in S.DEFAULT_M) m[k] = false; m.ledge = true; m.wallKick = true; return { m, t: Object.assign({}, S.DEFAULT_T, { pips: 0 }) }; }
let TRACE = null;
function climb(seed, goal, cfg, verbose) {
  const T = Wd.Tower(seed); T.gen(goal + 30);
  const st = T.start(), p = S.makePlayer(st.x, st.y, st.z, st.yaw), dt = 1 / 120;
  const way = []; T.sides.forEach(sd => sd.way.forEach(w => way.push({ w, sd })));
  let k = 0, t = 0, rel = 0, stuck = 0, lastK = 0, lastKt = 0;
  while (t < 900) {
    if (p.grounded && p.gs) { for (let q = k + 1; q < Math.min(way.length, k + 8); q++) if (way[q].w === p.gs) { k = q + 1; break; } }
    if (p.air && p.air.kind === 'spring' && !p.air.seen) { p.air.seen = true; for (let q = k; q < Math.min(way.length, k + 3); q++) if (way[q].w.spring) { k = q + 1; break; } }
    const cur = way[k]; if (!cur) return { ok: true, t, h: p.y };
    const s = cur.w.spring ? cur.w.s : cur.w, top = s.y1;
    if (cur.w.spring) { if (p.air && p.air.kind === 'spring') { k++; continue; } }
    else if (p.grounded && (p.gs === s || (Math.abs(p.y - top) < 0.05 && p.x >= s.x0 && p.x <= s.x1 && p.z >= s.z0 && p.z <= s.z1))) { k++; if (p.y >= goal) return { ok: true, t, h: p.y }; continue; }
    const mrg = 0.7, cx = (s.x1 - s.x0 > 2 * mrg) ? Math.min(Math.max(p.x, s.x0 + mrg), s.x1 - mrg) : (s.x0 + s.x1) / 2, cz = (s.z1 - s.z0 > 2 * mrg) ? Math.min(Math.max(p.z, s.z0 + mrg), s.z1 - mrg) : (s.z0 + s.z1) / 2;
    let dx = cx - p.x, dz = cz - p.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    if (d < 0.35) { const sp = Math.hypot(p.vx, p.vz) || 1; dx = -p.vx / sp * Math.min(1, sp / 3); dz = -p.vz / sp * Math.min(1, sp / 3); }
    if (TRACE && t > TRACE[0] && t < TRACE[1] && Math.round(t * 120) % 6 === 0) console.log(t.toFixed(2), 'k', k, p.state, 'pos', p.x.toFixed(2), p.y.toFixed(2), p.z.toFixed(2), 'v', p.vx.toFixed(1), p.vy.toFixed(1), p.vz.toFixed(1), 'tgt', cx.toFixed(2), cz.toFixed(2), 'top', top.toFixed(2), 'gs', p.gs ? p.gs.c : '-');
    let jump = false;
    if (p.grounded) {
      if (rel > 0) rel--; else {
        const gA = S.groundAt(T, p.x + dx * 0.55, p.z + dz * 0.55, p.y + 0.4).y;
        const gB = S.groundAt(T, p.x + dx * 0.8, p.z + dz * 0.8, p.y + 4.3).y;
        if (!cur.w.spring && (gA < p.y - 0.45 || (gB > p.y + 0.4 && gB < 1e5))) jump = true;
      }
    } else if (p.state === 'hang') { jump = Math.round(t * 120) % 20 < 3; dx = -p.wnx; dz = -p.wnz; } else { jump = true; rel = 3; }
    S.step(p, T, cfg, { mx: dx, mz: dz, jump, dive: false, crouch: false, grab: false }, dt); p.ev.length = 0; t += dt;
    if (k !== lastK) { lastK = k; lastKt = t; }
    const ref = k > 0 ? (way[k - 1].w.spring ? way[k - 1].w.s.y1 : way[k - 1].w.y1) : 0;
    if (p.y < ref - 4 || t - lastKt > 12) return { ok: false, t, h: p.y, side: cur.sd.i, k, target: { x0: s.x0, x1: s.x1, z0: s.z0, z1: s.z1, y1: s.y1, c: s.c, spring: !!cur.w.spring }, ref, pos: [p.x.toFixed(2), p.y.toFixed(2), p.z.toFixed(2)], state: p.state, why: p.y < ref - 4 ? 'fell' : 'stuck' };
  }
  return { ok: false, t, h: p.y, why: 'timeout' };
}
let fails = 0, times = []; 
const N = +process.argv[2] || 40, GOAL = +process.argv[3] || 150;
if (process.argv[4]) { TRACE = [+process.argv[5], +process.argv[6]]; console.log(JSON.stringify(climb(+process.argv[4], GOAL, cfg0()))); process.exit(0); }
for (let seed = 1; seed <= N; seed++) { const r = climb(seed * 7919, GOAL, cfg0()); if (!r.ok) { fails++; console.log('F', seed * 7919, 't', r.t.toFixed(1), r.why, r.state, 'side', r.side, 'rise', r.target ? (r.target.y1 - r.ref).toFixed(2) : '', r.target ? r.target.c + (r.target.spring ? '/spring' : '') : '', 'len', r.target ? Math.max(r.target.x1 - r.target.x0, r.target.z1 - r.target.z0).toFixed(1) : ''); } else times.push(r.t); }
times.sort((a, b) => a - b);
console.log('seeds', N, 'fails', fails, 'median s to', GOAL, 'm:', times.length ? times[times.length >> 1].toFixed(1) : '-', 'rate m/s', times.length ? (GOAL / times[times.length >> 1]).toFixed(2) : '-');
if (fails) process.exitCode = 1;
// stats on generation
const T = Wd.Tower(12345); T.gen(300); let ch = 0, rings = 0, sh = 0, sp = 0, hi = 0; T.sides.forEach(s => { if (s.chimney) ch++; if (s.ring) rings++; sh += s.shards.length; s.solids.forEach(b => { if (b.spring) sp++; }); });
console.log('sides to 300 m:', T.sides.length, 'chimneys', ch, 'ring sides', rings, 'shards', sh, 'springs', sp, 'solids', T.solids.length);
