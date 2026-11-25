/* Shmoove — the spire. A square core with a path of ledges spiralling up it, generated one side at a time.
   Every side is climbable with run, jump, ledge grab and wall kick alone. Everything else is a faster line. */
(function (root) {
  'use strict';

  var C = 6;            // half-width of the core
  var PD = 3.2;         // depth of the path ledges
  var RW = 5.4;         // size of a rest pad
  var RING_EVERY = 30;  // metres between rest rings
  var FACE = [{ n: [0, 1], t: [1, 0] }, { n: [1, 0], t: [0, -1] }, { n: [0, -1], t: [-1, 0] }, { n: [-1, 0], t: [0, 1] }];

  function rng(seed) {
    var a = seed >>> 0;
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function pt(f, a, d) { var F = FACE[f & 3]; return [F.n[0] * (C + d) + F.t[0] * a, F.n[1] * (C + d) + F.t[1] * a]; }
  function box(f, a0, a1, d0, d1, y0, y1, c, extra) {
    var p = pt(f, a0, d0), q = pt(f, a1, d1);
    var s = { x0: Math.min(p[0], q[0]), x1: Math.max(p[0], q[0]), z0: Math.min(p[1], q[1]), z1: Math.max(p[1], q[1]), y0: y0, y1: y1, c: c };
    if (extra) for (var k in extra) s[k] = extra[k];
    return s;
  }

  function Tower(seed) {
    var R = rng(seed);
    function r(a, b) { return a + (b - a) * R(); }
    var T = {
      seed: seed, C: C, PD: PD, RING_EVERY: RING_EVERY,
      solids: [
        { x0: -C, x1: C, z0: -C, z1: C, y0: -60, y1: 1e6, c: 'core' },
        { x0: -60, x1: 60, z0: -60, z1: 60, y0: -60, y1: 0, c: 'ground', base: true }
      ],
      anchors: [], sides: [], top: 0, nextFace: 0, faceTop: [null, null, null, null]
    };

    function genSide() {
      var i = T.sides.length, f = T.nextFace, prev = T.sides[i - 1], lower = T.faceTop[f], h0 = prev ? prev.hEnd : 0;
      var side = { i: i, f: f, ring: 0, segs: [], solids: [], shards: [], way: [], y0: h0, hEnd: h0, reserve: null, mesh: null };
      var nextRing = (Math.floor(h0 / RING_EVERY + 1e-6) + 1) * RING_EVERY;
      function plat(a0, a1, h, cls, d0, d1, extra) {
        var s = box(f, a0, a1, d0 == null ? 0 : d0, d1 == null ? PD : d1, extra && extra.y0 != null ? extra.y0 : h - 0.7, h, cls || 'plat');
        side.solids.push(s); side.segs.push({ a0: a0, a1: a1, h: h, cls: cls || 'plat', y0: s.y0 }); side.way.push(s); return s;
      }
      function shard(a, d, y) { var p = pt(f, a, d); side.shards.push({ x: p[0], y: y, z: p[1], taken: false }); }

      var a = -C, h = h0, sum = 0, diff = Math.min(1, h0 / 150), special = false, lastGapShard = true;
      var approach = h0 >= nextRing - 7;
      function rise(lo, hi, cap) { var v = r(lo, hi); if (sum + v > (cap || 5.0)) v = Math.max(0.15, (cap || 5.0) - sum); sum += v; return v; }
      function gapShard(a0, a1, hA, hB) { if (a1 - a0 > 1.1 && R() < 0.7) shard((a0 + a1) / 2, PD / 2, Math.max(hA, hB) + 1.2); }

      if (approach) {                                         // three even steps up to a big rest pad on the corner
        var st = (nextRing - h0) / 4;
        for (var k = 0; k < 3; k++) { var g0 = r(1.3, 1.8), L0 = 2.2; gapShard(a, a + g0, h, h + st); h += st; plat(a + g0, a + g0 + L0, h); a += g0 + L0; }
        side.segs[side.segs.length - 1].a1 = C - 1.5; side.solids[side.solids.length - 1] = box(f, a - L0, C - 1.5, 0, PD, h - 0.7, h, 'plat'); side.way[side.way.length - 1] = side.solids[side.solids.length - 1];
        h = nextRing; var rp = plat(C, C + RW, h, 'ring', 0, RW); rp.ringNo = Math.round(h / RING_EVERY); side.ring = rp.ringNo; side.hEnd = h;
        finish(side); return;
      }

      var res = lower && lower.reserve ? lower.reserve : null, g, L, v, s, pA;
      if (res) {                                              // the top of a wall-kick chimney started one lap below
        g = r(1.2, 1.5); pA = h; h += rise(0.4, 1.0);
        gapShard(a, a + g, pA, h); plat(-C + g, res.gs, h); var hA = h;
        h += rise(-0.2, 0.7); var be = Math.min(res.ge + r(2.4, 3.2), C - 1.3); plat(res.ge, be, h);
        var yb = res.h + 1.9;
        if (Math.min(hA, h) - yb >= 4) {
          side.solids.push(box(f, res.gs - 0.8, res.gs, 0, PD, yb, hA, 'fin'));
          side.solids.push(box(f, res.ge, res.ge + 0.8, 0, PD, yb, h, 'fin'));
          for (var q = 1; q <= 3; q++) shard((res.gs + res.ge) / 2, PD / 2, yb + (Math.min(hA, h) - yb) * q / 3.4);
          side.chimney = { a: (res.gs + res.ge) / 2, yb: yb, top: Math.min(hA, h) };
        }
        a = be;
      } else if (i >= 1 && R() < 0.15) {                       // a long ledge that the next lap will hang a chimney over
        g = r(1.3, 1.8); pA = h; h += rise(0.3, 1.0); gapShard(a, a + g, pA, h);
        plat(-C + g, -C + g + 6.4, h); var c = -C + g + 3.2;
        side.reserve = { gs: c - 1.5, ge: c + 1.5, h: h }; a = -C + g + 6.4;
      }

      while (true) {
        var roll = R(), kind = 'plat';
        if (!special && i > 1) { if (roll < 0.12 + 0.05 * diff) kind = 'high'; else if (roll < 0.36 + 0.06 * diff) kind = 'spring'; else if (roll < 0.52 + 0.12 * diff) kind = 'pillars'; }
        var last = side.segs[side.segs.length - 1];
        if (kind === 'spring' && !(last && last.a1 - last.a0 >= 2.6 && last.cls === 'plat')) kind = 'plat';
        if (kind === 'high' && !last) kind = 'plat';
        if (kind === 'plat') {
          g = r(1.3, 2.2 + 0.9 * diff); L = r(2.4, 4.2 - 1.0 * diff);
          if (a + g + L > C - 1.2) break;
          pA = h; h += (side.segs.length && R() < 0.12) ? -r(0, 0.4) : rise(0.3, 1.2); gapShard(a, a + g, pA, h); plat(a + g, a + g + L, h); a += g + L;
        } else if (kind === 'high') {                         // a tall step: jump, catch the lip, pull up
          g = r(0, 0.4); L = r(2.6, 3.4);
          if (a + g + L > C - 1.2) break;
          pA = h; h += rise(2.7, 3.2, 5.2); plat(a + g, a + g + L, h, 'plat', null, null, { y0: pA - 0.7 }); a += g + L; special = true;
        } else if (kind === 'spring') {                       // a spring pad at the end of the last ledge
          g = r(2.2, 2.6); L = r(2.6, 3.2);
          if (a + g + L > C - 1.2) { kind = 'plat'; continue; }
          side.solids.push(box(f, last.a1 - 2.0, last.a1 - 0.7, PD / 2 - 0.8, PD / 2 + 0.8, last.h, last.h + 0.22, 'spring', { spring: true, push: FACE[f].t }));
          side.way.push({ spring: true, s: side.solids[side.solids.length - 1] });
          v = rise(3.6, 4.3, 5.2); shard(a - 0.4, PD / 2, h + 3.4); shard(a + g * 0.7, PD / 2, h + 5.4);
          h += v; plat(a + g, a + g + L, h); a += g + L; special = true;
        } else {                                              // two or three small pads set off the wall
          var n = R() < 0.5 ? 2 : 3;
          if (a + n * 3.4 > C - 1.2) { n = 2; if (a + n * 3.4 > C - 1.2) break; }
          for (var m = 0; m < n; m++) { g = r(1.3, 1.9); pA = h; h += rise(0.3, 0.8); gapShard(a, a + g, pA, h); plat(a + g, a + g + 1.8, h, 'pad', 0.7, 2.5); a += g + 1.8; }
        }
      }
      // close the side: stretch the last ledge so the hop to the corner pad is a comfortable one
      var lastSeg = side.segs[side.segs.length - 1], gF = r(1.3, 2.2);
      if (lastSeg && lastSeg.cls !== 'pad' && C - a > gF) {
        lastSeg.a1 = C - gF; var idx = side.solids.indexOf(side.way[side.way.length - 1]);
        var ns = box(f, lastSeg.a0, lastSeg.a1, 0, PD, lastSeg.y0, lastSeg.h, 'plat'); side.solids[idx] = ns; side.way[side.way.length - 1] = ns; a = lastSeg.a1;
      } else if (C - a > 2.6) { pA = h; h += rise(0.2, 0.8); L = C - a - 1.3 - 1.4; plat(a + 1.3, a + 1.3 + Math.max(1.6, L), h); a = a + 1.3 + Math.max(1.6, L); }
      pA = h; v = Math.min(1.7, Math.max(r(0.3, 1.0), 2.4 - sum)); sum += v; h += v; gapShard(a, C, pA, h); plat(C, C + PD, h, 'plat');
      side.hEnd = h;

      // an island off the wall with a few shards, for anyone with reach to spare
      if (R() < 0.5) {
        var cand = side.segs.filter(function (sg) { return sg.cls === 'plat' && sg.a1 - sg.a0 >= 2.4 && sg.a1 <= C; });
        if (cand.length) {
          var sg = cand[Math.floor(R() * cand.length)], ca = (sg.a0 + sg.a1) / 2, far = R() < 0.35 + 0.3 * diff, d0 = far ? 6.6 : 5.0, hi = sg.h + r(-0.3, 0.9);
          side.solids.push(box(f, ca - 1.3, ca + 1.3, d0, d0 + 2.4, hi - 0.7, hi, 'isle'));
          for (var e = 0; e < 3; e++) shard(ca - 0.7 + e * 0.7, d0 + 1.2, hi + 1.1);
          if (far) shard(ca, (PD + d0) / 2, hi + 2.0);
        }
      }
      finish(side);
    }
    function finish(side) {
      for (var j = 0; j < side.solids.length; j++) T.solids.push(side.solids[j]);
      side.y1 = side.hEnd; T.sides.push(side); T.top = side.hEnd; T.faceTop[side.f] = side; T.nextFace = (side.f + 1) & 3;
    }

    T.gen = function (untilY) { var made = []; while (T.top < untilY) { genSide(); made.push(T.sides[T.sides.length - 1]); } return made; };
    T.cull = function (belowY) {                              // forget what the tide has swallowed
      var gone = [];
      for (var i = 0; i < T.sides.length; i++) { var sd = T.sides[i]; if (!sd.gone && sd.hEnd < belowY) { sd.gone = true; gone.push(sd); } }
      if (gone.length) T.solids = T.solids.filter(function (s) { return s.base || s.c === 'core' || s.y1 >= belowY; });
      return gone;
    };
    T.start = function () { var p = pt(0, -C - 1.6, PD / 2); return { x: p[0], y: 0.05, z: p[1], yaw: Math.PI / 2 }; };
    return T;
  }

  var api = { Tower: Tower, pt: pt, C: C, PD: PD, RW: RW, RING_EVERY: RING_EVERY, FACE: FACE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.World = api;
})(typeof window !== 'undefined' ? window : this);
