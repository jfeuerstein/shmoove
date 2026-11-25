const S = require('../js/sim.js'), Wd = require('../js/world.js');
function cfg0() { const m = {}; for (const k in S.DEFAULT_M) m[k] = false; m.ledge = true; m.wallKick = true; return { m, t: Object.assign({}, S.DEFAULT_T, { pips: 0 }) }; }
let ok = 0, n = 0, times = [];
for (let seed = 1; seed <= 60 && n < 40; seed++) {
  const T = Wd.Tower(seed * 104729); T.gen(200);
  for (const sd of T.sides) { if (!sd.chimney) continue; n++;
    const c = sd.chimney, F = Wd.FACE[sd.f], st = Wd.pt(sd.f, c.a, 1.6), p = S.makePlayer(st[0], c.yb - 1.9 + 0.05, st[1], 0), cfg = cfg0();
    let t = 0, dir = 1, jt = 0, done = false, lastWallN = null;
    while (t < 12) {
      let jump = false;
      if (p.grounded) { if (p.y > c.top - 0.2) { done = true; break; } jump = Math.round(t * 120) % 40 < 30; dir = 1; }
      else if (p.state === 'wall') { jt += 1 / 120; if (jt > 0.06) jump = true; }
      else { jt = 0; if (p.lastWall) dir = (p.lastWall.nx * F.t[0] + p.lastWall.nz * F.t[1]) > 0 ? 1 : -1; jump = p.vy > 0 && !p.lastWall; }
      if (p.state === 'hang') { jump = Math.round(t * 120) % 12 < 3; }
      S.step(p, T, cfg, { mx: F.t[0] * dir, mz: F.t[1] * dir, jump, dive: false, crouch: false, grab: false }, 1 / 120); p.ev.length = 0; t += 1 / 120;
    }
    if (done) { ok++; times.push(t); } else if (n - ok <= 4) console.log('chimney fail seed', seed * 104729, 'side', sd.i, 'h', (c.top - c.yb).toFixed(1), 'end', p.state, (p.y - (c.yb - 1.9)).toFixed(1));
    if (n >= 40) break; }
}
times.sort((a, b) => a - b);
console.log('chimneys', n, 'climbed', ok, 'median s', times.length ? times[times.length >> 1].toFixed(1) : '-');
if (ok < n) process.exitCode = 1;
