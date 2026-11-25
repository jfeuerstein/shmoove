/* Shmoove — character controller (from Moveset Lab).
   Pure logic, no DOM. Units: metres, seconds. y is up. Player position is the feet. */
(function (root) {
  'use strict';

  var R = 0.4, H = 1.7, STEP = 0.4, SNAP = 0.45, REACH = 1.85, HANG = 1.5;

  var DEFAULT_T = {
    runSpeed: 7, maxSpeed: 14, accelTime: 0.18, decelTime: 0.14, airControl: 0.6,
    jumpHeight: 2.4, apexTime: 0.38, fallMult: 1.6, cutMult: 3, apexHang: 1,
    coyote: 0.12, buffer: 0.12, edgePop: 0.25,
    groundBleed: 6, airDrag: 0, slideFriction: 3, slopeGain: 1, steer: 2.6,
    diveBoost: 3, glideSink: 2.5, glideSpeed: 9, pips: 1, climbSpeed: 3, wallSlide: 3
  };
  var DEFAULT_M = {
    slide: true, longJump: true, highJump: true, chain: false,
    airJump: true, dive: true, stomp: true, glide: true,
    ledge: true, wallKick: true, climb: false, slope: true, grapple: false
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hsp(p) { return Math.sqrt(p.vx * p.vx + p.vz * p.vz); }
  function setH(p, dx, dz, m) { p.vx = dx * m; p.vz = dz * m; }
  function approach(p, tx, tz, a, dt) {
    var dx = tx - p.vx, dz = tz - p.vz, d = Math.sqrt(dx * dx + dz * dz), m = a * dt;
    if (d <= m || d < 1e-6) { p.vx = tx; p.vz = tz; } else { p.vx += dx / d * m; p.vz += dz / d * m; }
  }
  function rotToward(dx, dz, ux, uz, maxAng) {
    var cur = Math.atan2(dz, dx), d = Math.atan2(uz, ux) - cur;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    cur += clamp(d, -maxAng, maxAng);
    return [Math.cos(cur), Math.sin(cur)];
  }

  /* ---------- world queries ---------- */
  function topAt(s, x, z) {
    if (!s.ramp) return s.y1;
    var t = s.ramp.axis === 'x' ? (x - s.x0) / (s.x1 - s.x0) : (z - s.z0) / (s.z1 - s.z0);
    t = clamp(t, 0, 1);
    if (s.ramp.dir < 0) t = 1 - t;
    return s.ramp.low + (s.y1 - s.ramp.low) * t;
  }
  function slopeOf(s) {
    if (!s || !s.ramp) return null;
    var rise = s.y1 - s.ramp.low, len = s.ramp.axis === 'x' ? s.x1 - s.x0 : s.z1 - s.z0;
    var d = -s.ramp.dir; // downhill sign along the axis
    return { dx: s.ramp.axis === 'x' ? d : 0, dz: s.ramp.axis === 'z' ? d : 0, sin: rise / Math.sqrt(rise * rise + len * len), tan: rise / len };
  }
  function groundAt(W, x, z, maxY) {
    var best = -1e9, bs = null, S = W.solids;
    for (var i = 0; i < S.length; i++) {
      var s = S[i];
      if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
      var t = topAt(s, x, z);
      if (t <= maxY && t > best) { best = t; bs = s; }
    }
    return { y: best, s: bs };
  }
  function collide(p, W, tol) {
    var hit = null, S = W.solids;
    for (var i = 0; i < S.length; i++) {
      var s = S[i];
      if (s.base) continue;
      var cx = clamp(p.x, s.x0, s.x1), cz = clamp(p.z, s.z0, s.z1);
      var dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= R * R) continue;
      var top = topAt(s, cx, cz);
      if (top <= p.y + tol || s.y0 >= p.y + H) continue;
      var nx, nz, pen;
      if (d2 > 1e-8) { var d = Math.sqrt(d2); nx = dx / d; nz = dz / d; pen = R - d; }
      else {
        var l = p.x - s.x0, r = s.x1 - p.x, n = p.z - s.z0, f = s.z1 - p.z, m = Math.min(l, r, n, f);
        if (m === l) { nx = -1; nz = 0; } else if (m === r) { nx = 1; nz = 0; } else if (m === n) { nx = 0; nz = -1; } else { nx = 0; nz = 1; }
        pen = m + R;
      }
      p.x += nx * pen; p.z += nz * pen;
      var vn = p.vx * nx + p.vz * nz;
      if (vn < 0) { p.vx -= vn * nx; p.vz -= vn * nz; }
      if (!hit || top > hit.top) hit = { nx: nx, nz: nz, s: s, top: top, vn: vn };
    }
    return hit;
  }
  function probe(W, p, nx, nz) {
    var qx = p.x - nx * (R + 0.2), qz = p.z - nz * (R + 0.2), best = null, S = W.solids;
    for (var i = 0; i < S.length; i++) {
      var s = S[i];
      if (s.base || qx < s.x0 || qx > s.x1 || qz < s.z0 || qz > s.z1) continue;
      var t = topAt(s, qx, qz);
      if (s.y0 < p.y + H * 0.6 && t > p.y + 0.3 && (!best || t > best.top)) best = { s: s, top: t };
    }
    return best;
  }
  function clearAbove(W, x, z, y, self) {
    var S = W.solids;
    for (var i = 0; i < S.length; i++) {
      var s = S[i];
      if (s === self || x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
      if (s.y0 < y + H && topAt(s, x, z) > y + 0.05) return false;
    }
    return true;
  }
  function axisAligned(h) { return Math.abs(h.nx) > 0.92 || Math.abs(h.nz) > 0.92; }

  /* ---------- player ---------- */
  function makePlayer(x, y, z, yaw) {
    return {
      x: x, y: y, z: z, vx: 0, vy: 0, vz: 0, yaw: yaw == null ? Math.PI : yaw,
      state: 'air', grounded: false, gs: null,
      pj: false, pd: false, pc: false, pg: false,
      buf: 0, coy: 0, landT: 9, wallT: 9, ledgeCool: 0, lock: 0, skid: 0, time: 0,
      stam: 0, diveUsed: false, armed: false, cut: false, lowG: 1, chain: 0,
      wnx: 0, wnz: 0, ws: null, wallOK: true, lastWall: null, noClimb: false,
      hangT: 0, boostT: 0, stompT: 0, stompWin: 0, slideKind: '', slideT: 0,
      mant: null, rope: null, air: null, last: null, safe: { x: x, y: y, z: z }, safeT: 0,
      ev: []
    };
  }
  function startAir(p, kind) { p.air = { t: 0, x: p.x, z: p.z, y: p.y, top: p.y, kind: kind }; }
  function pipCount(cfg) { return (cfg.m.airJump || cfg.m.climb) ? Math.round(cfg.t.pips) : 0; }

  function startMantle(p, W, s, nx, nz, dur) {
    var tx = clamp(p.x - nx * (R + 0.3), s.x0 + 0.05, s.x1 - 0.05), tz = clamp(p.z - nz * (R + 0.3), s.z0 + 0.05, s.z1 - 0.05);
    p.mant = { t: 0, dur: dur, x0: p.x, y0: p.y, z0: p.z, x1: tx, y1: topAt(s, tx, tz), z1: tz, nx: nx, nz: nz };
    p.state = 'mantle'; p.grounded = false; p.vx = p.vy = p.vz = 0; p.yaw = Math.atan2(-nx, -nz);
    p.ev.push({ k: 'mantle' });
  }

  /* ---------- one fixed step ---------- */
  function step(p, W, cfg, inp, dt) {
    var T = cfg.t, M = cfg.m;
    var jp = !!inp.jump && !p.pj, dp = !!inp.dive && !p.pd, cp = !!inp.crouch && !p.pc, gp = !!inp.grab && !p.pg;
    p.pj = !!inp.jump; p.pd = !!inp.dive; p.pc = !!inp.crouch; p.pg = !!inp.grab;
    if (jp) p.buf = T.buffer; else p.buf -= dt;
    p.coy -= dt; p.landT += dt; p.wallT += dt; p.ledgeCool -= dt; p.lock -= dt; p.skid -= dt; p.stompWin -= dt; p.time += dt;

    var run = T.runSpeed, v0 = 2 * T.jumpHeight / T.apexTime, gUp = v0 / T.apexTime;
    var il = Math.sqrt(inp.mx * inp.mx + inp.mz * inp.mz), ux = 0, uz = 0;
    if (il > 0.08) { ux = inp.mx / il; uz = inp.mz / il; if (il > 1) il = 1; } else il = 0;
    var pipsMax = pipCount(cfg);
    var sp = hsp(p), fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    var vdx = sp > 1e-3 ? p.vx / sp : fx, vdz = sp > 1e-3 ? p.vz / sp : fz;

    function refill() { p.diveUsed = false; p.armed = false; p.lowG = 1; p.cut = false; p.noClimb = false; p.lastWall = null; p.rope = null; }
    function wallKick() {
      var nx = p.wnx, nz = p.wnz, tx = -nz, tz = nx, vt = (p.vx * tx + p.vz * tz) * 0.5;
      p.vx = nx * run * 0.95 + tx * vt; p.vz = nz * run * 0.95 + tz * vt; p.vy = 0.95 * v0;
      p.state = 'air'; p.grounded = false; p.cut = false; p.lowG = 1; p.lock = 0.16; p.diveUsed = false; p.armed = false;
      p.buf = 0; p.wallT = 9; p.lastWall = { s: p.ws, nx: nx, nz: nz }; p.yaw = Math.atan2(nx, nz);
      if (!p.air) startAir(p, 'kick');
      jp = false;
      p.ev.push({ k: 'kick' });
    }
    function airJump() {
      p.vy = 0.85 * v0; p.stam -= 1; p.state = 'air'; p.cut = true; p.lowG = 1; p.armed = true; p.buf = 0;
      if (il > 0) { var m = Math.max(sp, run * 0.8) * il; p.vx += (ux * m - p.vx) * 0.7; p.vz += (uz * m - p.vz) * 0.7; }
      p.ev.push({ k: 'airjump' });
    }
    function groundJump() {
      var type = 'jump', dx = vdx, dz = vdz;
      if (p.stompWin > 0 && M.stomp) {
        type = 'bounce'; p.vy = 1.3 * v0; p.cut = false; p.vx = p.vz = 0;
      } else if (M.longJump && (p.state === 'slide' || (inp.crouch && sp > 0.4 * run))) {
        type = 'long'; setH(p, dx, dz, clamp(Math.max(sp * 1.15, run * 1.35), 0, T.maxSpeed));
        p.vy = 0.6 * v0; p.lowG = 0.55; p.cut = false;
      } else if (M.highJump && inp.crouch && sp < 0.3 * run) {
        type = 'high'; p.vy = 1.25 * v0; p.vx = p.vz = 0; p.cut = false;
      } else if (M.highJump && p.skid > 0 && il > 0) {
        type = 'side'; p.vy = 1.2 * v0; setH(p, ux, uz, run * 0.55); p.cut = false;
      } else {
        if (M.chain && p.landT < 0.22 && sp > 0.5 * run && p.chain < 2) p.chain++; else p.chain = 0;
        p.vy = v0 * [1, 1.12, 1.3][p.chain]; p.cut = true;
        if (p.chain === 2) type = 'triple'; else if (p.chain === 1) type = 'double';
      }
      if (type !== 'jump' && type !== 'double' && type !== 'triple') p.chain = 0;
      p.state = 'air'; p.grounded = false; p.coy = 0; p.buf = 0; p.stompWin = 0; p.gs = null;
      startAir(p, type); p.ev.push({ k: 'jump', type: type });
    }
    function doDive(fromGround) {
      var dx = il > 0 ? ux : fx, dz = il > 0 ? uz : fz;
      setH(p, dx, dz, clamp(Math.max(sp + T.diveBoost, run * 1.25), 0, T.maxSpeed));
      p.vy = fromGround ? 0.45 * v0 : Math.max(p.vy * 0.3, 0) + 0.32 * v0;
      if (fromGround) startAir(p, 'dive');
      p.state = 'dive'; p.grounded = false; p.diveUsed = true; p.cut = false; p.lowG = 1; p.armed = false; p.gs = null;
      p.ev.push({ k: 'dive' });
    }
    function land(s) {
      var a = p.air, rec = a ? { h: a.top - a.y, d: Math.sqrt((p.x - a.x) * (p.x - a.x) + (p.z - a.z) * (p.z - a.z)), t: a.t, drop: a.y - p.y, kind: a.kind } : null;
      var was = p.state, vyIn = p.vy;
      p.last = rec; p.air = null; p.grounded = true; p.gs = s; p.vy = 0; p.landT = 0; refill();
      if (was === 'dive') { p.state = 'slide'; p.slideKind = 'belly'; p.slideT = 0; }
      else if (was === 'stomp') { p.state = 'ground'; p.stompWin = 0.16; p.vx = p.vz = 0; }
      else if (inp.crouch && M.slide && hsp(p) > 0.4 * run) { p.state = 'slide'; p.slideKind = 'crouch'; p.slideT = 0; }
      else p.state = 'ground';
      p.ev.push({ k: 'land', rec: rec, vy: vyIn, was: was });
      if (s && s.spring) spring(s);
    }
    function spring(s) {
      if (s.push) { var along = p.vx * s.push[0] + p.vz * s.push[1]; if (along < 7) { p.vx = s.push[0] * 7; p.vz = s.push[1] * 7; } }
      p.vy = 1.55 * v0; p.state = 'air'; p.grounded = false; p.cut = false; p.lowG = 1; p.coy = 0; p.buf = 0; p.stompWin = 0; p.gs = null;
      p.diveUsed = false; p.armed = false; p.chain = 0;
      startAir(p, 'spring'); p.ev.push({ k: 'spring' });
    }

    /* --- locked states --- */
    if (p.state === 'mantle') {
      var m = p.mant; m.t += dt;
      var k = Math.min(1, m.t / m.dur), ky = Math.min(1, k / 0.6), kh = Math.max(0, (k - 0.4) / 0.6);
      p.y = m.y0 + (m.y1 - m.y0) * (1 - (1 - ky) * (1 - ky));
      p.x = m.x0 + (m.x1 - m.x0) * kh; p.z = m.z0 + (m.z1 - m.z0) * kh;
      if (k >= 1) {
        p.state = 'ground'; p.grounded = true; p.air = null; p.landT = 0.3; refill();
        p.gs = groundAt(W, p.x, p.z, p.y + 0.1).s;
        p.vx = -m.nx * il * run * 0.7; p.vz = -m.nz * il * run * 0.7; p.vy = 0;
      }
      return;
    }
    if (p.state === 'hang') {
      p.hangT += dt;
      var intoH = -(ux * p.wnx + uz * p.wnz) * il;
      if (jp && intoH < -0.3 && M.wallKick) wallKick();
      else if (jp || (intoH > 0.5 && p.hangT > 0.1)) { p.buf = 0; startMantle(p, W, p.ws, p.wnx, p.wnz, 0.22); }
      else if (cp || (intoH < -0.5 && p.hangT > 0.15)) { p.state = 'air'; p.ledgeCool = 0.4; }
      if (p.state === 'hang' || p.state === 'mantle') return;
    }
    if (p.state === 'climb') {
      var prc = probe(W, p, p.wnx, p.wnz);
      var intoC = -(ux * p.wnx + uz * p.wnz) * il, lat = (ux * -p.wnz + uz * p.wnx) * il;
      if (!prc) p.state = 'air';
      else {
        if (jp) {
          p.buf = 0;
          if (intoC < -0.3) wallKick();
          else if (p.stam >= 0.5) { p.stam -= 0.5; p.boostT = 0.22; p.ev.push({ k: 'leap' }); }
        }
        if (p.state === 'climb') {
          p.boostT -= dt;
          var up = (p.boostT > 0 ? 3.2 : intoC) * T.climbSpeed;
          p.y += up * dt; p.x += -p.wnz * lat * T.climbSpeed * 0.7 * dt; p.z += p.wnx * lat * T.climbSpeed * 0.7 * dt;
          p.vx = p.vy = p.vz = 0; p.yaw = Math.atan2(-p.wnx, -p.wnz);
          p.stam -= ((Math.abs(intoC) + Math.abs(lat) > 0.1 || p.boostT > 0) ? 0.45 : 0.12) * dt;
          if (p.air) { p.air.t += dt; if (p.y > p.air.top) p.air.top = p.y; }
          var gc = groundAt(W, p.x, p.z, p.y + 0.3);
          if (p.y <= gc.y) { p.y = gc.y; p.state = 'air'; land(gc.s); }
          else if (prc.top - p.y <= HANG && clearAbove(W, clamp(p.x - p.wnx * 0.7, prc.s.x0, prc.s.x1), clamp(p.z - p.wnz * 0.7, prc.s.z0, prc.s.z1), prc.top, prc.s)) startMantle(p, W, prc.s, p.wnx, p.wnz, 0.24);
          else if (cp) { p.state = 'air'; p.ledgeCool = 0.3; p.noClimb = true; }
          else if (p.stam <= 0) { p.stam = 0; p.state = 'air'; p.noClimb = true; p.ev.push({ k: 'slip' }); }
        }
      }
      if (p.state === 'climb' || p.state === 'mantle' || p.grounded) return;
    }
    if (p.state === 'wall') {
      var prw = probe(W, p, p.wnx, p.wnz);
      var intoW = -(ux * p.wnx + uz * p.wnz) * il;
      if (!prw) p.state = 'air';
      else if (jp) wallKick();
      else if (cp || intoW < -0.4) { p.state = 'air'; p.ledgeCool = 0.25; p.lastWall = { s: p.ws, nx: p.wnx, nz: p.wnz }; }
      else if (M.climb && intoW > 0.6 && p.stam > 0.2 && !p.noClimb) { p.state = 'climb'; p.boostT = 0; }
      else {
        p.vy = Math.max(p.vy - gUp * dt, -T.wallSlide); p.y += p.vy * dt; p.vx = p.vz = 0; p.yaw = Math.atan2(p.wnx, p.wnz);
        if (p.air) p.air.t += dt;
        var gw = groundAt(W, p.x, p.z, p.y + 0.3);
        if (p.y <= gw.y) { p.y = gw.y; p.state = 'air'; land(gw.s); }
      }
      if (p.state === 'wall' || p.state === 'climb' || p.grounded) return;
    }

    /* --- swing --- */
    if (M.grapple && gp && p.state !== 'swing' && W.anchors) {
      var best = null, bsc = 1e9, ax = il > 0 ? ux : vdx, az = il > 0 ? uz : vdz;
      for (var i = 0; i < W.anchors.length; i++) {
        var a = W.anchors[i], adx = a.x - p.x, ady = a.y - (p.y + 1), adz = a.z - p.z, dd = Math.sqrt(adx * adx + ady * ady + adz * adz);
        if (ady < 3 || dd > 26) continue;
        var hd = Math.sqrt(adx * adx + adz * adz) || 1, sc = dd - 9 * ((adx * ax + adz * az) / hd);
        if (sc < bsc) { bsc = sc; best = { a: a, L: dd, Lt: Math.min(dd, a.y - 2.2) }; }
      }
      if (best) {
        if (p.grounded || !p.air) startAir(p, 'swing');
        if (p.grounded) { p.y += 0.06; p.vy = 0.55 * v0; }
        p.rope = best; p.state = 'swing'; p.grounded = false; p.gs = null; p.ev.push({ k: 'grab' });
      }
    }
    if (p.state === 'swing' && (!inp.grab || jp)) {
      p.state = 'air'; p.rope = null; p.diveUsed = false; p.armed = false; p.cut = false;
      if (jp) { p.vy += 0.45 * v0; p.buf = 0; jp = false; }
      p.ev.push({ k: 'release' });
    }

    /* --- input-driven transitions --- */
    var grounded = p.grounded;
    if (grounded) {
      p.stam = Math.min(pipsMax, p.stam + 5 * dt);
      if (p.buf > 0 && p.lock <= 0) { groundJump(); grounded = false; }
      else if (dp && M.dive && p.lock <= 0) { doDive(true); grounded = false; }
      else if (p.state === 'ground' && cp && M.slide && sp > 0.4 * run) { p.state = 'slide'; p.slideKind = 'crouch'; p.slideT = 0; p.ev.push({ k: 'slide' }); }
    } else if (p.state !== 'swing') {
      if (p.buf > 0 && p.coy > 0 && p.state === 'air') groundJump();
      else if (jp) {
        if (M.wallKick && p.wallT < 0.15 && p.wallOK) wallKick();
        else if (M.airJump && p.stam >= 1 && p.state !== 'stomp') airJump();
        else if (p.state !== 'stomp') p.armed = true;
      }
      if (dp && M.dive && !p.diveUsed && (p.state === 'air' || p.state === 'glide')) doDive(false);
      if (cp && M.stomp && (p.state === 'air' || p.state === 'glide' || p.state === 'dive')) {
        p.state = 'stomp'; p.stompT = 0.09; p.vx = p.vz = 0; p.vy = 0; p.ev.push({ k: 'stomp' });
      }
      if (p.state === 'air' && M.glide && p.armed && inp.jump && p.vy < 0) { p.state = 'glide'; p.ev.push({ k: 'glide' }); }
      else if (p.state === 'glide' && !inp.jump) p.state = 'air';
    }

    /* --- horizontal velocity --- */
    sp = hsp(p); vdx = sp > 1e-3 ? p.vx / sp : fx; vdz = sp > 1e-3 ? p.vz / sp : fz;
    var slope = grounded ? slopeOf(p.gs) : null, d2, mag;
    if (p.state === 'ground') {
      var top = run * (inp.crouch ? 0.4 : 1);
      var down = M.slope && slope && il > 0 && sp > run * 0.97 && (p.vx * slope.dx + p.vz * slope.dz) > 0.5 * sp;
      if (sp > run * 1.03 || down) {
        if (il > 0 && (ux * vdx + uz * vdz) > -0.3) { d2 = rotToward(vdx, vdz, ux, uz, T.steer * dt); setH(p, d2[0], d2[1], Math.max(run, sp - T.groundBleed * dt)); }
        else approach(p, 0, 0, run / T.decelTime * 1.5, dt);
      } else {
        if (il > 0 && sp > 0.5 * run && (ux * vdx + uz * vdz) < -0.5) p.skid = 0.14;
        approach(p, ux * il * top, uz * il * top, il > 0 ? run / T.accelTime : run / T.decelTime, dt);
      }
      if (M.slope && slope && sp > 0.5) { var as = 9 * slope.sin * T.slopeGain; p.vx += slope.dx * as * dt; p.vz += slope.dz * as * dt; }
    } else if (p.state === 'slide') {
      p.slideT += dt;
      d2 = il > 0 ? rotToward(vdx, vdz, ux, uz, 1.8 * dt) : [vdx, vdz];
      setH(p, d2[0], d2[1], Math.max(0, sp - T.slideFriction * dt));
      if (slope) { var al = 22 * slope.sin * (M.slope ? T.slopeGain : 0.5); p.vx += slope.dx * al * dt; p.vz += slope.dz * al * dt; }
      sp = hsp(p);
      if (sp < 1.5) p.state = 'ground';
      else if (p.slideKind === 'crouch' && !inp.crouch && p.slideT > 0.15) p.state = 'ground';
      else if (p.slideKind === 'belly' && p.slideT > 0.45 && (il > 0 || sp < run * 0.7) && !inp.crouch) p.state = 'ground';
    } else if (p.state === 'air' || p.state === 'dive') {
      var aa = T.airControl * run / T.accelTime * (p.state === 'dive' ? 0.12 : 1) * (p.lowG < 1 ? 0.35 : 1);
      if (p.lock > 0) aa = 0;
      if (il > 0 && aa > 0) {
        if (sp <= run * 1.03) approach(p, ux * il * run, uz * il * run, aa, dt);
        else {
          var dot = ux * vdx + uz * vdz;
          d2 = rotToward(vdx, vdz, ux, uz, 1.6 * T.airControl * dt * (p.state === 'dive' ? 0.3 : 1));
          mag = sp; if (dot < -0.2) mag -= aa * dt;
          setH(p, d2[0], d2[1], Math.max(0, mag));
        }
      }
      if (T.airDrag > 0) { sp = hsp(p); if (sp > run) { mag = Math.max(run, sp - T.airDrag * dt); p.vx *= mag / sp; p.vz *= mag / sp; } }
    } else if (p.state === 'glide') {
      var gsv = T.glideSpeed;
      if (sp <= gsv * 1.03) approach(p, ux * il * gsv, uz * il * gsv, run / T.accelTime * 0.25, dt);
      else { d2 = il > 0 ? rotToward(vdx, vdz, ux, uz, 1.4 * dt) : [vdx, vdz]; setH(p, d2[0], d2[1], Math.max(gsv, sp - 2 * dt)); }
    } else if (p.state === 'swing') {
      p.vx += ux * il * 7 * dt; p.vz += uz * il * 7 * dt;
    }

    /* --- gravity --- */
    if (!grounded) {
      if (p.state === 'stomp') { p.stompT -= dt; p.vy = p.stompT > 0 ? 0 : -2.4 * v0; }
      else if (p.state === 'glide') { p.vy -= gUp * dt; if (p.vy < -T.glideSink) p.vy = Math.min(-T.glideSink, p.vy + 60 * dt); }
      else {
        var g = p.vy > 0 ? gUp * ((p.cut && !inp.jump) ? T.cutMult : 1) : gUp * T.fallMult;
        if (T.apexHang && p.cut && inp.jump && Math.abs(p.vy) < 0.14 * v0) g *= 0.5;
        if (p.state === 'swing') g = gUp * 0.9;
        p.vy -= g * p.lowG * dt;
        if (p.vy < -2.6 * v0) p.vy = -2.6 * v0;
      }
    }
    var cap = T.maxSpeed * (p.state === 'swing' ? 1.25 : 1); sp = hsp(p);
    if (sp > cap) { p.vx *= cap / sp; p.vz *= cap / sp; }
    var preSp = sp;

    /* --- move & collide --- */
    var tol = grounded ? STEP : (p.vy <= 0 ? T.edgePop : 0.02);
    p.x += p.vx * dt; p.z += p.vz * dt;
    var hit = collide(p, W, tol);
    var prevY = p.y, ny = p.y + p.vy * dt, gnd;
    if (grounded) {
      gnd = groundAt(W, p.x, p.z, p.y + STEP);
      if (gnd.y >= p.y - SNAP) { p.y = gnd.y; p.vy = 0; p.gs = gnd.s; if (gnd.s && gnd.s.spring) spring(gnd.s); }
      else {
        var sl = slopeOf(p.gs);
        p.vy = sl ? -(p.vx * sl.dx + p.vz * sl.dz) * sl.tan : 0;
        p.grounded = false; p.state = 'air'; p.coy = T.coyote; p.cut = false; p.lowG = 1; p.gs = null; startAir(p, 'fall');
      }
    } else if (p.vy <= 0) {
      gnd = groundAt(W, p.x, p.z, prevY + tol);
      if (ny <= gnd.y) { p.y = gnd.y; land(gnd.s); } else p.y = ny;
    } else {
      var S = W.solids;
      for (var j = 0; j < S.length; j++) {
        var s = S[j];
        if (p.x < s.x0 || p.x > s.x1 || p.z < s.z0 || p.z > s.z1) continue;
        if (s.y0 >= prevY + H - 0.05 && s.y0 < ny + H) { ny = s.y0 - H; p.vy = 0; }
      }
      p.y = ny;
    }
    if (p.state === 'swing' && p.rope) {
      var ra = p.rope.a; p.rope.L = Math.max(p.rope.Lt, p.rope.L - 14 * dt);
      var cx = p.x - ra.x, cy = p.y + 1 - ra.y, cz = p.z - ra.z, rd = Math.sqrt(cx * cx + cy * cy + cz * cz);
      if (rd > p.rope.L) {
        var kk = p.rope.L / rd; p.x = ra.x + cx * kk; p.y = ra.y + cy * kk - 1; p.z = ra.z + cz * kk;
        var rx = cx / rd, ry = cy / rd, rz = cz / rd, vr = p.vx * rx + p.vy * ry + p.vz * rz;
        if (vr > 0) { p.vx -= vr * rx; p.vy -= vr * ry; p.vz -= vr * rz; }
        var gsw = groundAt(W, p.x, p.z, p.y + 1.2);
        if (p.y < gsw.y) { p.y = gsw.y; land(gsw.s); }
      }
    }
    if (p.air) { p.air.t += dt; if (p.y > p.air.top) p.air.top = p.y; }

    /* --- wall contact --- */
    if (hit && axisAligned(hit)) {
      var rel = hit.top - p.y, into = -(ux * hit.nx + uz * hit.nz) * il;
      if (!p.grounded && p.state !== 'stomp' && p.state !== 'swing' && p.state !== 'mantle') {
        p.wallT = 0; p.wnx = hit.nx; p.wnz = hit.nz; p.ws = hit.s;
        p.wallOK = !(p.lastWall && p.lastWall.s === hit.s && p.lastWall.nx === hit.nx && p.lastWall.nz === hit.nz);
        var cxm = clamp(p.x - hit.nx * 0.7, hit.s.x0, hit.s.x1), czm = clamp(p.z - hit.nz * 0.7, hit.s.z0, hit.s.z1);
        if (M.ledge && p.ledgeCool <= 0 && p.vy < 4 && rel > tol && rel <= REACH && clearAbove(W, cxm, czm, hit.top, hit.s)) {
          if (into > 0.3 || rel < 1.0 || p.state === 'dive') startMantle(p, W, hit.s, hit.nx, hit.nz, 0.14 + rel * 0.05);
          else { p.state = 'hang'; p.hangT = 0; if (rel > HANG) p.y = hit.top - HANG; p.vx = p.vy = p.vz = 0; p.yaw = Math.atan2(-hit.nx, -hit.nz); p.ev.push({ k: 'hang' }); }
        } else if (M.climb && !p.noClimb && p.stam > 0.2 && into > 0.6 && rel > REACH) {
          p.state = 'climb'; p.vx = p.vy = p.vz = 0; p.boostT = 0; p.ev.push({ k: 'climb' });
        } else if (M.wallKick && p.vy <= 1 && rel > 1.2 && p.wallOK && (into > 0.2 || hit.vn < -3)) {
          p.state = 'wall'; p.vx = p.vz = 0; if (p.vy < -T.wallSlide) p.vy = -T.wallSlide; p.ev.push({ k: 'wall' });
        } else if (p.state === 'dive') p.state = 'air';
      } else if (p.grounded && (p.state === 'ground' || p.state === 'slide')) {
        var cxg = clamp(p.x - hit.nx * 0.7, hit.s.x0, hit.s.x1), czg = clamp(p.z - hit.nz * 0.7, hit.s.z0, hit.s.z1);
        if (M.ledge && into > 0.5 && rel > STEP && rel <= 1.25 && clearAbove(W, cxg, czg, hit.top, hit.s)) startMantle(p, W, hit.s, hit.nx, hit.nz, 0.14 + rel * 0.06);
        else if (M.climb && into > 0.7 && rel > 1.25 && p.stam > 0.5) {
          p.wnx = hit.nx; p.wnz = hit.nz; p.ws = hit.s; p.state = 'climb'; p.grounded = false; p.gs = null; p.boostT = 0; p.vx = p.vy = p.vz = 0; startAir(p, 'climb'); p.ev.push({ k: 'climb' });
        }
      }
    }

    /* --- facing, safety --- */
    if (p.state !== 'mantle' && p.state !== 'hang' && p.state !== 'climb' && p.state !== 'wall') {
      sp = hsp(p);
      var ty = sp > 0.8 ? Math.atan2(p.vx, p.vz) : (il > 0 ? Math.atan2(ux, uz) : p.yaw), dy = ty - p.yaw;
      while (dy > Math.PI) dy -= 2 * Math.PI;
      while (dy < -Math.PI) dy += 2 * Math.PI;
      p.yaw += clamp(dy, -14 * dt, 14 * dt);
    }
    if (p.grounded && p.state === 'ground' && p.time - p.safeT > 0.4) { p.safe = { x: p.x, y: p.y, z: p.z }; p.safeT = p.time; }
  }

  var api = { step: step, makePlayer: makePlayer, topAt: topAt, groundAt: groundAt, pipCount: pipCount, DEFAULT_T: DEFAULT_T, DEFAULT_M: DEFAULT_M, R: R, H: H };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Sim = api;
})(typeof window !== 'undefined' ? window : this);
