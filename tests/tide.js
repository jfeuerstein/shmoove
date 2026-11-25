// how far does the path-only bot get against the tide, with and without picking up shards on the way
const S = require('../js/sim.js'), Wd = require('../js/world.js');
function cfg0() { const m = {}; for (const k in S.DEFAULT_M) m[k] = false; m.ledge = true; m.wallKick = true; return { m, t: Object.assign({}, S.DEFAULT_T, { pips: 0 }) }; }
function run(seed, slow, shards) {
  const T = Wd.Tower(seed); T.gen(700); const st = T.start(), p = S.makePlayer(st.x, st.y, st.z, st.yaw), dt = 1 / 120, cfg = cfg0();
  const way = []; T.sides.forEach(sd => sd.way.forEach(w => way.push({ w, sd })));
  let k = 0, t = 0, rel = 0, tide = -12, hold = 0, got = 0, pause = 0;
  while (t < 1500) {
    if (p.grounded && p.gs) { for (let q = k + 1; q < Math.min(way.length, k + 8); q++) if (way[q].w === p.gs) { k = q + 1; break; } }
    if (p.air && p.air.kind === 'spring' && !p.air.seen) { p.air.seen = true; for (let q = k; q < Math.min(way.length, k + 3); q++) if (way[q].w.spring) { k = q + 1; break; } }
    const cur = way[k]; if (!cur) return { h: p.y, t, got };
    const s = cur.w.spring ? cur.w.s : cur.w, top = s.y1;
    if (!cur.w.spring && p.grounded && (p.gs === s || (Math.abs(p.y - top) < 0.05 && p.x >= s.x0 && p.x <= s.x1 && p.z >= s.z0 && p.z <= s.z1))) { k++; pause = slow; continue; }
    const mrg = 0.7, cx = (s.x1 - s.x0 > 2 * mrg) ? Math.min(Math.max(p.x, s.x0 + mrg), s.x1 - mrg) : (s.x0 + s.x1) / 2, cz = (s.z1 - s.z0 > 2 * mrg) ? Math.min(Math.max(p.z, s.z0 + mrg), s.z1 - mrg) : (s.z0 + s.z1) / 2;
    let dx = cx - p.x, dz = cz - p.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    if (d < 0.35) { const sp = Math.hypot(p.vx, p.vz) || 1; dx = -p.vx / sp * Math.min(1, sp / 3); dz = -p.vz / sp * Math.min(1, sp / 3); }
    let jump = false;
    if (pause > 0 && p.grounded) { pause -= dt; dx = dz = 0; }
    else if (p.grounded) { if (rel > 0) rel--; else { const gA = S.groundAt(T, p.x + dx * 0.55, p.z + dz * 0.55, p.y + 0.4).y, gB = S.groundAt(T, p.x + dx * 0.8, p.z + dz * 0.8, p.y + 4.3).y; if (!cur.w.spring && (gA < p.y - 0.45 || (gB > p.y + 0.4 && gB < 1e5))) jump = true; } }
    else if (p.state === 'hang') { jump = Math.round(t * 120) % 20 < 3; dx = -p.wnx; dz = -p.wnz; } else { jump = true; rel = 3; }
    S.step(p, T, cfg, { mx: dx, mz: dz, jump, dive: false, crouch: false, grab: false }, dt); p.ev.length = 0; t += dt;
    if (shards) for (const sh of cur.sd.shards) { if (!sh.taken && (sh.x - p.x) ** 2 + (sh.y - p.y - 0.9) ** 2 + (sh.z - p.z) ** 2 < 1.56) { sh.taken = true; got++; hold = Math.min(4, hold + 0.3); } }
    if (p.y > 1.2 || t > 7) { if (hold > 0) hold -= dt; else tide += Math.min(3.2, 0.45 + t * 0.005) * dt; }
    if (p.y < tide) return { h: p.y, t, got };
  }
  return { h: p.y, t, got };
}
for (const [slow, shards, name] of [[0, false, 'perfect, no shards'], [0, true, 'perfect, shards'], [0.35, true, 'hesitant (0.35 s per ledge), shards'], [0.8, true, 'novice (0.8 s per ledge), shards']]) {
  const hs = []; for (let i = 1; i <= 12; i++) hs.push(run(i * 7919, slow, shards)); hs.sort((a, b) => a.h - b.h); const m = hs[6];
  console.log(name.padEnd(40), 'median height', m.h.toFixed(0), 'm at', m.t.toFixed(0), 's, shards', m.got, '| range', hs[0].h.toFixed(0), '-', hs[11].h.toFixed(0));
}
