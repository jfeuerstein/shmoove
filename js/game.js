/* Shmoove — the game: rendering, input, tide, upgrades, HUD, sound. */
(function () {
  'use strict';
  var S = window.Sim, Wd = window.World, THREE = window.THREE;
  function $(q) { return document.querySelector(q); }
  var app = $('#app'), canvas = $('#gl');
  var STEP = 1 / 120;

  /* ---------------- upgrades ---------------- */
  var UPS = [
    { id: 'airjump', name: 'Air jump', kind: 'move', text: 'Jump again in mid-air. One pip, refilled when you land.', can: function (g) { return !g.cfg.m.airJump; }, apply: function (g) { g.cfg.m.airJump = true; g.cfg.t.pips = 1; } },
    { id: 'pip', name: 'Extra pip', kind: 'stat', text: 'One more air jump before you have to land.', can: function (g) { return g.cfg.m.airJump && g.cfg.t.pips < 3; }, apply: function (g) { g.cfg.t.pips += 1; } },
    { id: 'dive', name: 'Dive', kind: 'move', text: 'New button. Lunge forward for distance and land in a slide. Jump pops you out.', can: function (g) { return !g.cfg.m.dive; }, apply: function (g) { g.cfg.m.dive = true; } },
    { id: 'slide', name: 'Slide and long jump', kind: 'move', text: 'Crouch while running to slide. Jump out of the slide to fly low and far.', can: function (g) { return !g.cfg.m.slide; }, apply: function (g) { g.cfg.m.slide = true; g.cfg.m.longJump = true; } },
    { id: 'stomp', name: 'Stomp bounce', kind: 'move', text: 'Crouch in the air to drop straight down. Jump as you land to bounce four metres.', can: function (g) { return !g.cfg.m.stomp; }, apply: function (g) { g.cfg.m.stomp = true; } },
    { id: 'glide', name: 'Glide', kind: 'move', text: 'Press Jump in the air and keep holding to float and steer.', can: function (g) { return !g.cfg.m.glide; }, apply: function (g) { g.cfg.m.glide = true; } },
    { id: 'triple', name: 'Triple jump', kind: 'move', text: 'Jump again the instant you land, while moving. Each of three goes higher.', can: function (g) { return !g.cfg.m.chain; }, apply: function (g) { g.cfg.m.chain = true; } },
    { id: 'high', name: 'High jump', kind: 'move', text: 'Stand still, hold Crouch, then Jump: half again as high.', can: function (g) { return !g.cfg.m.highJump; }, apply: function (g) { g.cfg.m.highJump = true; } },
    { id: 'legs', name: 'Spring legs', kind: 'stat', max: 3, text: 'Every jump goes 10% higher.', can: function () { return true; }, apply: function (g) { g.cfg.t.jumpHeight *= 1.1; g.cfg.t.apexTime *= 1.04; } },
    { id: 'feet', name: 'Quick feet', kind: 'stat', max: 3, text: 'Run 8% faster.', can: function () { return true; }, apply: function (g) { g.cfg.t.runSpeed *= 1.08; g.cfg.t.maxSpeed *= 1.08; } },
    { id: 'wall', name: 'Breakwater', kind: 'stat', max: 3, text: 'The tide rises 12% slower for the rest of the run.', can: function () { return true; }, apply: function (g) { g.tideMul *= 0.88; } },
    { id: 'magnet', name: 'Magnet', kind: 'stat', max: 2, text: 'Shards fly to you from further away.', can: function () { return true; }, apply: function (g) { g.magnet *= 1.7; } }
  ];

  /* ---------------- palettes by height ---------------- */
  var ZONES = [
    { top: 0x86b4e8, bot: 0xf8dcc2, plat: 0xf6f1e8, fin: 0xff6a1a, isle: 0x79c9b3, ring: 0x2a2e38, core: 0x6b7382, spring: 0x3ddc84 },
    { top: 0x3a80d6, bot: 0xcdeaf8, plat: 0xffffff, fin: 0xff5136, isle: 0xffcf5a, ring: 0x1f2a44, core: 0x5d6d88, spring: 0x3ddc84 },
    { top: 0x4a3d90, bot: 0xffb18c, plat: 0xffe6d6, fin: 0xff2f7d, isle: 0x9fd0ff, ring: 0x2b1f3f, core: 0x5c4c72, spring: 0x57e39a },
    { top: 0x070b1e, bot: 0x2a3a74, plat: 0xbcc8f6, fin: 0xffd23f, isle: 0x6ef2c8, ring: 0xf4f6ff, core: 0x2e3860, spring: 0x6ef2c8 },
    { top: 0x06141c, bot: 0x20706c, plat: 0xd2fff2, fin: 0xff7ad9, isle: 0xfff07a, ring: 0xffffff, core: 0x21424a, spring: 0xfff07a }
  ];
  function zoneOf(y) { return ZONES[Math.max(0, Math.floor(y / Wd.RING_EVERY)) % ZONES.length]; }
  function colOf(z, cls) { return cls === 'pad' ? z.plat : (z[cls] != null ? z[cls] : z.plat); }

  /* ---------------- sound ---------------- */
  var AC = null, muted = false;
  try { muted = localStorage.getItem('shmoove-mute') === '1'; } catch (e) { /* no storage */ }
  function audioOn() { if (AC || muted) return; try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; } }
  function tone(f0, f1, dur, type, vol, delay) {
    if (!AC || muted) return;
    var t = AC.currentTime + (delay || 0), o = AC.createOscillator(), g = AC.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  var SFX = {
    jump: function () { tone(330, 560, 0.09, 'square', 0.05); },
    air: function () { tone(520, 900, 0.11, 'square', 0.05); },
    kick: function () { tone(420, 760, 0.08, 'triangle', 0.11); },
    land: function (v) { tone(150, 60, 0.09, 'sine', Math.min(0.22, 0.05 + v * 0.008)); },
    spring: function () { tone(240, 1100, 0.22, 'sawtooth', 0.06); },
    dive: function () { tone(700, 260, 0.14, 'triangle', 0.09); },
    stomp: function () { tone(300, 70, 0.16, 'sawtooth', 0.07); },
    shard: function (n) { tone(880 * Math.pow(2, Math.min(n, 14) / 12), 880 * Math.pow(2, Math.min(n, 14) / 12) * 1.5, 0.1, 'sine', 0.1); },
    pick: function () { tone(523, 523, 0.3, 'triangle', 0.1); tone(659, 659, 0.3, 'triangle', 0.1, 0.07); tone(784, 784, 0.4, 'triangle', 0.1, 0.14); },
    ring: function () { tone(392, 784, 0.35, 'triangle', 0.12); },
    dead: function () { tone(360, 50, 0.7, 'sawtooth', 0.1); }
  };
  function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* unsupported */ } }

  /* ---------------- scene ---------------- */
  var renderer, scene, camera, sky, tideMesh, coreMesh, groundMesh, player, body, glider, shadow, trail, dust = [], mat, shardGeo, shardMat;
  var VS = 'attribute vec3 col; varying vec3 vW; varying vec3 vN; varying vec3 vC; varying vec3 vV; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vN = normal; vC = col; vec4 v = viewMatrix * w; vV = v.xyz; gl_Position = projectionMatrix * v; }';
  var FS = 'uniform vec3 uFog; uniform float uTide; varying vec3 vW; varying vec3 vN; varying vec3 vC; varying vec3 vV;' +
    'float gl1(vec2 p, float w){ vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p); return 1.0 - clamp(min(g.x, g.y) - w, 0.0, 1.0); }' +
    'void main(){ float vD = length(vV); vec3 n = normalize(vN); vec3 a = abs(n); vec2 uv = a.y > 0.6 ? vW.xz : (a.x > a.z ? vW.zy : vW.xy);' +
    'float sh = a.y > 0.6 ? (n.y > 0.0 ? 1.0 : 0.55) : (0.70 + 0.16 * dot(n, normalize(vec3(0.5, 0.0, 0.85))));' +
    'float g = gl1(uv, 0.0) * 0.5 * clamp(1.0 - vD / 60.0, 0.0, 1.0);' +
    'vec3 c = vC * sh; c = mix(c, c * 0.8, g);' +
    'float glow = clamp(1.0 - (vW.y - uTide) / 7.0, 0.0, 1.0); c = mix(c, vec3(1.0, 0.18, 0.49), glow * glow * 0.75);' +
    'gl_FragColor = vec4(mix(c, uFog, smoothstep(40.0, 150.0, vD)), 1.0); }';
  var TIDE_FS = 'uniform float uT; uniform float uHeld; varying vec3 vW; void main(){ float r = length(vW.xz); float w = sin(r * 0.55 - uT * 1.6) * 0.5 + 0.5; float w2 = sin(vW.x * 0.9 + uT) * sin(vW.z * 0.8 - uT * 0.7) * 0.5 + 0.5;' +
    'vec3 a = mix(vec3(1.0, 0.18, 0.49), vec3(1.0, 0.45, 0.12), w * 0.6 + w2 * 0.3); a = mix(a, vec3(1.0, 0.9, 0.4), uHeld * 0.6); a += smoothstep(0.92, 1.0, w) * 0.25; gl_FragColor = vec4(a, 1.0); }';

  function prisms(list, colorFor) {
    var pos = [], col = [], c = new THREE.Color();
    list.forEach(function (s) {
      function t(x, z) { return S.topAt(s, x, z); }
      var b00 = [s.x0, s.y0, s.z0], b10 = [s.x1, s.y0, s.z0], b11 = [s.x1, s.y0, s.z1], b01 = [s.x0, s.y0, s.z1];
      var t00 = [s.x0, t(s.x0, s.z0), s.z0], t10 = [s.x1, t(s.x1, s.z0), s.z0], t11 = [s.x1, t(s.x1, s.z1), s.z1], t01 = [s.x0, t(s.x0, s.z1), s.z1];
      c.setHex(colorFor(s));
      [[t00, t01, t11], [t00, t11, t10], [b00, b11, b01], [b00, b10, b11], [b00, t00, t10], [b00, t10, b10], [b01, b11, t11], [b01, t11, t01], [b00, b01, t01], [b00, t01, t00], [b10, t10, t11], [b10, t11, b11]]
        .forEach(function (tri) { tri.forEach(function (v) { pos.push(v[0], v[1], v[2]); col.push(c.r, c.g, c.b); }); });
    });
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('col', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    return g;
  }
  function initGL() {
    if (!THREE) return false;
    try { renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' }); } catch (e) { return false; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(78, 0.5, 0.2, 420);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.0));
    var dl = new THREE.DirectionalLight(0xffffff, 0.5); dl.position.set(0.4, 0.9, 0.5); scene.add(dl);
    mat = new THREE.ShaderMaterial({ uniforms: { uFog: { value: new THREE.Color() }, uTide: { value: -100 } }, vertexShader: VS, fragmentShader: FS, extensions: { derivatives: true } });
    sky = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 12), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, uniforms: { uTop: { value: new THREE.Color() }, uBot: { value: new THREE.Color() } },
      vertexShader: 'varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uTop; uniform vec3 uBot; varying float vY; void main(){ gl_FragColor = vec4(mix(uBot, uTop, smoothstep(-0.15, 0.75, vY)), 1.0); }'
    }));
    sky.renderOrder = -1; scene.add(sky);
    tideMesh = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uHeld: { value: 0 } },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }', fragmentShader: TIDE_FS
    }));
    tideMesh.rotation.x = -Math.PI / 2; scene.add(tideMesh);
    shardGeo = new THREE.OctahedronGeometry(0.34); shardMat = new THREE.MeshBasicMaterial({ color: 0xffe45c });

    player = new THREE.Group(); body = new THREE.Group(); player.add(body);
    var white = new THREE.MeshLambertMaterial({ color: 0xffffff }), dark = new THREE.MeshLambertMaterial({ color: 0x15171d }), org = new THREE.MeshLambertMaterial({ color: 0xff6a1a });
    var torso = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.39, 0.95, 14), white); torso.position.y = -0.12; body.add(torso);
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12), white); head.position.y = 0.58; body.add(head);
    var visor = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.14, 0.14), dark); visor.position.set(0, 0.6, 0.28); body.add(visor);
    var pack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.52, 0.22), org); pack.position.set(0, 0, -0.39); body.add(pack);
    var fl = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.36), dark); fl.position.set(-0.17, -0.74, 0.04); body.add(fl);
    var fr = fl.clone(); fr.position.x = 0.17; body.add(fr);
    var gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute([-1.6, 0, -0.5, 1.6, 0, -0.5, 0, 0, 0.95], 3)); gg.computeVertexNormals();
    glider = new THREE.Mesh(gg, new THREE.MeshBasicMaterial({ color: 0xff6a1a, side: THREE.DoubleSide })); glider.position.y = 1.2; glider.visible = false; body.add(glider);
    scene.add(player);
    shadow = new THREE.Mesh(new THREE.CircleGeometry(0.52, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    shadow.rotation.x = -Math.PI / 2; scene.add(shadow);
    trail = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(70 * 3), 3)), new THREE.LineBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0.8 })); trail.frustumCulled = false; scene.add(trail);
    for (var i = 0; i < 26; i++) { var dm = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 })); dm.visible = false; scene.add(dm); dust.push({ m: dm, life: 0, vx: 0, vy: 0, vz: 0 }); }
    resize(); return true;
  }
  function resize() {
    if (!renderer) return; var w = app.clientWidth, h = app.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w / h < 0.75 ? 78 : w / h < 1.2 ? 68 : 58; camera.updateProjectionMatrix();
  }
  function puff(n, x, y, z, spd, hex) {
    for (var i = 0, k = 0; i < dust.length && k < n; i++) { var d = dust[i]; if (d.life > 0) continue; var a = Math.random() * 6.283; d.life = 0.35 + Math.random() * 0.2; d.vx = Math.cos(a) * spd; d.vz = Math.sin(a) * spd; d.vy = 0.8 + Math.random() * 1.2; d.m.position.set(x, y + 0.1, z); d.m.material.color.setHex(hex || 0xffffff); d.m.visible = true; k++; }
  }

  /* ---------------- run state ---------------- */
  var G = null, best = 0, lastTs = 0, acc = 0, frameN = 0, paused = false;
  try { best = parseFloat(localStorage.getItem('shmoove-best') || '0') || 0; } catch (e) { best = 0; }
  var camAng = -0.9, camR = 21, focusY = 1.2, sq = 1, sqV = 0, tilt = 0, spin = 0;
  var worldG = null;

  function buildSide(sd) {
    var z = zoneOf(sd.y0), grp = new THREE.Group();
    grp.add(new THREE.Mesh(prisms(sd.solids, function (s) { return colOf(z, s.c); }), mat));
    sd.shards.forEach(function (sh) { var m = new THREE.Mesh(shardGeo, shardMat); m.position.set(sh.x, sh.y, sh.z); sh.m = m; grp.add(m); });
    sd.mesh = grp; worldG.add(grp);
  }
  function dropSide(sd) { if (!sd.mesh) return; worldG.remove(sd.mesh); sd.mesh.children[0].geometry.dispose(); sd.mesh = null; }
  function newRun() {
    if (worldG) { scene.remove(worldG); worldG.traverse(function (o) { if (o.geometry && o.geometry !== shardGeo) o.geometry.dispose(); }); }
    worldG = new THREE.Group(); scene.add(worldG);
    var seed = (Math.random() * 4294967296) >>> 0, T = Wd.Tower(seed), st = T.start();
    var m = {}; for (var k in S.DEFAULT_M) m[k] = false; m.ledge = true; m.wallKick = true;
    var t = {}; for (k in S.DEFAULT_T) t[k] = S.DEFAULT_T[k]; t.pips = 0;
    G = { T: T, p: S.makePlayer(st.x, st.y, st.z, st.yaw), cfg: { m: m, t: t }, tide: -12, tideHold: 0, tideMul: 1, magnet: 1, time: 0, started: false, shards: 0, streak: 0, streakT: 0, maxH: 0, ring: 0, taken: {}, kit: [], dead: false, deadT: 0, hint: 0 };
    coreMesh = new THREE.Mesh(prisms([{ x0: -Wd.C, x1: Wd.C, z0: -Wd.C, z1: Wd.C, y0: -200, y1: 200, c: 'core' }], function () { return 0xffffff; }), mat);
    groundMesh = new THREE.Mesh(prisms([{ x0: -60, x1: 60, z0: -60, z1: 60, y0: -3, y1: 0, c: 'ground' }], function () { return ZONES[0].core; }), mat);
    worldG.add(coreMesh); worldG.add(groundMesh);
    T.gen(50).forEach(buildSide);
    camAng = Math.atan2(st.x, st.z); focusY = 1.2; camR = 21;
    var a = trail.geometry.attributes.position.array; for (var i = 0; i < a.length; i += 3) { a[i] = st.x; a[i + 1] = st.y + 0.9; a[i + 2] = st.z; } trail.geometry.attributes.position.needsUpdate = true;
    syncButtons(); hud(true);
  }
  function syncButtons() {
    var m = G.cfg.m; $('#b-dive').hidden = !m.dive; $('#b-crouch').hidden = !(m.slide || m.stomp || m.highJump);
  }
  function setMode(m) { app.className = m + (paused ? ' paused' : ''); }
  function mode() { return app.classList.contains('play') ? 'play' : app.classList.contains('pick') ? 'pick' : app.classList.contains('dead') ? 'dead' : 'title'; }

  var toastT = 0;
  function toast(text, secs) { var e = $('#toast'); e.textContent = text; e.classList.add('on'); toastT = secs || 2.6; }

  /* ---------------- upgrades UI ---------------- */
  function offer() {
    var pool = UPS.filter(function (u) { return u.can(G) && (G.taken[u.id] || 0) < (u.max || 1); }), pickd = [];
    if (G.ring === 1) { var star = pool.filter(function (u) { return u.id === 'airjump' || u.id === 'dive' || u.id === 'glide'; }); if (star.length) pickd.push(star[Math.floor(Math.random() * star.length)]); }
    var moves = pool.filter(function (u) { return u.kind === 'move' && pickd.indexOf(u) < 0; });
    if (pickd.length < 1 && moves.length) pickd.push(moves[Math.floor(Math.random() * moves.length)]);
    while (pickd.length < 3 && pickd.length < pool.length) { var u = pool[Math.floor(Math.random() * pool.length)]; if (pickd.indexOf(u) < 0) pickd.push(u); }
    $('#p-title').textContent = 'Rest pad, ' + (G.ring * Wd.RING_EVERY) + ' m';
    var box = $('#p-cards'); box.innerHTML = '';
    pickd.forEach(function (u) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'card' + (u.kind === 'stat' ? ' stat' : '');
      b.innerHTML = '<b>' + u.name + '</b><em>' + (u.kind === 'move' ? 'New move' : 'Boost') + '</em><span>' + u.text + '</span>';
      b.addEventListener('click', function () {
        u.apply(G); G.taken[u.id] = (G.taken[u.id] || 0) + 1; G.kit.push(u.name); G.p.stam = S.pipCount(G.cfg); G.tideHold = Math.max(G.tideHold, 3);
        SFX.pick(); buzz(20); syncButtons(); setMode('play'); toast(u.name, 1.8); clearInput();
      });
      box.appendChild(b);
    });
    setMode('pick'); SFX.ring(); clearInput();
  }

  /* ---------------- input ---------------- */
  var keys = {}, pad = { mx: 0, my: 0, jump: false, dive: false, crouch: false }, ptr = {};
  function clearInput() { keys = {}; pad.mx = pad.my = 0; pad.jump = pad.dive = pad.crouch = false; ptr = {}; $('#joy').classList.add('idle'); $('#joy').firstChild.style.transform = ''; ['#b-jump', '#b-dive', '#b-crouch'].forEach(function (q) { $(q).classList.remove('down'); }); joyHome(); }
  function joyHome() { var j = $('#joy'); j.style.left = ''; j.style.top = ''; }
  function inRect(el, x, y, grow) { if (el.hidden) return false; var r = el.getBoundingClientRect(); return x > r.left - grow && x < r.right + grow && y > r.top - grow && y < r.bottom + grow; }
  var ctl = $('#ctl');
  ctl.addEventListener('pointerdown', function (e) {
    audioOn(); if (AC && AC.state === 'suspended') AC.resume();
    var r = app.getBoundingClientRect(), x = e.clientX, y = e.clientY, kind;
    if (inRect($('#b-dive'), x, y, 8)) kind = 'dive';
    else if (inRect($('#b-crouch'), x, y, 8)) kind = 'crouch';
    else if (x - r.left < r.width * 0.5) kind = 'joy';
    else kind = 'jump';                                       // anywhere else on the right half is Jump
    if (kind === 'joy') { for (var id in ptr) if (ptr[id].kind === 'joy') return; var j = $('#joy'); j.style.left = (x - r.left) + 'px'; j.style.top = (y - r.top) + 'px'; j.classList.remove('idle'); }
    else { pad[kind] = true; $('#b-' + kind).classList.add('down'); }
    ptr[e.pointerId] = { kind: kind, x0: x, y0: y };
    try { ctl.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
    e.preventDefault();
  });
  ctl.addEventListener('pointermove', function (e) {
    var p = ptr[e.pointerId]; if (!p || p.kind !== 'joy') return;
    var dx = (e.clientX - p.x0) / 44, dy = (e.clientY - p.y0) / 44, l = Math.sqrt(dx * dx + dy * dy);
    if (l > 1) { dx /= l; dy /= l; p.x0 = e.clientX - dx * 44; p.y0 = e.clientY - dy * 44; var r = app.getBoundingClientRect(), j = $('#joy'); j.style.left = (p.x0 - r.left) + 'px'; j.style.top = (p.y0 - r.top) + 'px'; }
    pad.mx = dx; pad.my = -dy; $('#joy').firstChild.style.transform = 'translate(' + dx * 32 + 'px,' + dy * 32 + 'px)';
  });
  function pup(e) {
    var p = ptr[e.pointerId]; if (!p) return; delete ptr[e.pointerId];
    if (p.kind === 'joy') { pad.mx = pad.my = 0; $('#joy').classList.add('idle'); $('#joy').firstChild.style.transform = ''; joyHome(); }
    else { var still = false; for (var id in ptr) if (ptr[id].kind === p.kind) still = true; if (!still) { pad[p.kind] = false; $('#b-' + p.kind).classList.remove('down'); } }
  }
  ctl.addEventListener('pointerup', pup); ctl.addEventListener('pointercancel', pup);
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  var KEYS = { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Space: 1, KeyJ: 1, KeyK: 1, KeyC: 1, ShiftLeft: 1, ShiftRight: 1 };
  window.addEventListener('keydown', function (e) {
    if (e.code === 'Escape' || e.code === 'KeyP') { if (mode() === 'play') setPaused(!paused); return; }
    if ((e.code === 'Enter' || e.code === 'Space') && !e.repeat) { var m = mode(); if (m === 'title') { start(); e.preventDefault(); return; } if (m === 'dead' && G.deadT > 0.8) { start(); e.preventDefault(); return; } }
    if (KEYS[e.code]) { keys[e.code] = true; e.preventDefault(); audioOn(); }
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });
  function readInput() {
    var mx = pad.mx, my = pad.my;
    if (keys.KeyA || keys.ArrowLeft) mx -= 1; if (keys.KeyD || keys.ArrowRight) mx += 1; if (keys.KeyW || keys.ArrowUp) my += 1; if (keys.KeyS || keys.ArrowDown) my -= 1;
    var gps = navigator.getGamepads ? navigator.getGamepads() : [], jump = pad.jump || !!keys.Space, dive = pad.dive || !!(keys.KeyJ || keys.ShiftLeft || keys.ShiftRight), crouch = pad.crouch || !!(keys.KeyK || keys.KeyC);
    for (var i = 0; i < gps.length; i++) { var g = gps[i]; if (!g || !g.connected || g.axes.length < 2) continue; if (Math.abs(g.axes[0]) + Math.abs(g.axes[1]) > 0.25) { mx += g.axes[0]; my -= g.axes[1]; } if (g.buttons[0] && g.buttons[0].pressed) jump = true; if (g.buttons[2] && g.buttons[2].pressed) dive = true; if ((g.buttons[1] && g.buttons[1].pressed) || (g.buttons[7] && g.buttons[7].pressed)) crouch = true; break; }
    // the camera always looks at the spire, so up is "toward the wall" and right is "along the path"
    var f0 = -Math.sin(camAng), f1 = -Math.cos(camAng);
    return { mx: f0 * my + (-f1) * mx, mz: f1 * my + f0 * mx, jump: jump, dive: dive && G.cfg.m.dive, crouch: crouch, grab: false };
  }

  /* ---------------- flow ---------------- */
  function start() { audioOn(); paused = false; newRun(); setMode('play'); toast('The path leads right', 2.8); G.hint = 1; clearInput(); }
  function setPaused(v) { paused = v; app.classList.toggle('paused', v); clearInput(); lastTs = 0; }
  function die() {
    if (G.dead) return; G.dead = true; G.deadT = 0; SFX.dead(); buzz([30, 40, 80]);
    var h = Math.floor(G.maxH), wasBest = h > best;
    if (wasBest) { best = h; try { localStorage.setItem('shmoove-best', String(best)); } catch (e) { /* fine */ } }
    $('#d-title').textContent = wasBest && h > 0 ? 'New best' : 'The tide took you';
    $('#d-line').textContent = h < 30 ? 'The first rest pad is at 30 m.' : 'You passed ' + Math.floor(h / Wd.RING_EVERY) + (Math.floor(h / Wd.RING_EVERY) === 1 ? ' rest pad.' : ' rest pads.');
    $('#d-h').textContent = h; $('#d-s').textContent = G.shards; var s = Math.floor(G.time); $('#d-t').textContent = Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
    $('#d-kit').textContent = G.kit.length ? 'Picked: ' + G.kit.join(', ') : '';
    $('#d-best').textContent = 'Best ' + best + ' m';
    setTimeout(function () { if (G.dead) setMode('dead'); }, 650);
  }
  function tideSpeed() { return Math.min(3.2, 0.45 + G.time * 0.005) * G.tideMul; }

  function events() {
    var P = G.p;
    for (var i = 0; i < P.ev.length; i++) {
      var e = P.ev[i];
      if (e.k === 'jump') { sqV = 5; puff(e.type === 'bounce' ? 7 : 3, P.x, P.y, P.z, 1.6); if (e.type === 'bounce') SFX.spring(); else SFX.jump(); }
      else if (e.k === 'airjump') { sqV = 4; puff(6, P.x, P.y, P.z, 2, 0xff6a1a); SFX.air(); }
      else if (e.k === 'kick') { sqV = 4; puff(5, P.x - P.wnx * 0.3, P.y + 0.6, P.z - P.wnz * 0.3, 1.4); SFX.kick(); buzz(8); }
      else if (e.k === 'spring') { sqV = 7; puff(8, P.x, P.y, P.z, 2.4, 0x3ddc84); SFX.spring(); buzz(15); }
      else if (e.k === 'dive') SFX.dive();
      else if (e.k === 'stomp') SFX.stomp();
      else if (e.k === 'land') { sqV = Math.max(-9, e.vy * 0.28); puff(e.was === 'stomp' ? 10 : 4, P.x, P.y, P.z, e.was === 'stomp' ? 3 : 1.6); SFX.land(-e.vy); if (e.vy < -18) buzz(12); }
    }
    P.ev.length = 0;
  }

  function update(dt) {
    var P = G.p, T = G.T, inp = readInput(), n = 0;
    acc += dt;
    while (acc >= STEP && n < 8) {
      S.step(P, T, G.cfg, inp, STEP); events(); acc -= STEP; n++;
      // shards
      var r = 1.25 * G.magnet, r2 = r * r;
      for (var si = 0; si < T.sides.length; si++) {
        var sd = T.sides[si]; if (sd.gone || !sd.shards.length || sd.y0 > P.y + 14 || sd.hEnd < P.y - 16) continue;
        for (var k = 0; k < sd.shards.length; k++) {
          var sh = sd.shards[k]; if (sh.taken) continue;
          var dx = sh.x - P.x, dy = sh.y - (P.y + 0.9), dz = sh.z - P.z, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < r2) {
            sh.taken = true; if (sh.m) { sd.mesh.remove(sh.m); sh.m = null; }
            G.shards++; G.streak = G.streakT > 0 ? G.streak + 1 : 0; G.streakT = 1.4; G.tideHold = Math.min(4, G.tideHold + 0.3);
            SFX.shard(G.streak); puff(4, sh.x, sh.y, sh.z, 2.2, 0xffe45c);
          } else if (G.magnet > 1 && d2 < r2 * 6) { var pull = STEP * 9 / Math.sqrt(d2); sh.x -= dx * pull; sh.y -= dy * pull; sh.z -= dz * pull; if (sh.m) sh.m.position.set(sh.x, sh.y, sh.z); }
        }
      }
    }
    G.time += dt; G.streakT -= dt;
    if (P.y > G.maxH) G.maxH = P.y;
    if (!G.started && (P.y > 1.2 || G.time > 7)) G.started = true;
    // the tide
    if (G.started) {
      if (G.tideHold > 0) G.tideHold -= dt; else G.tide += tideSpeed() * dt;
      if (G.tide < G.maxH - 34) G.tide = G.maxH - 34;
    }
    if (P.y < G.tide - 0.15 && !G.dead) die();
    // rest pads
    if (P.grounded && P.gs && P.gs.ringNo && P.gs.ringNo > G.ring && !G.dead) { G.ring = P.gs.ringNo; offer(); }
    // world upkeep
    if (T.top < P.y + 46) T.gen(P.y + 60).forEach(buildSide);
    if ((frameN & 31) === 0) T.cull(G.tide - 6).forEach(dropSide);
    // hints
    if (G.hint === 1 && G.time > 5) { toast('Push into a ledge to pull up', 2.6); G.hint = 2; }
    if (G.hint === 2) { for (var q = 0; q < T.sides.length; q++) { var c = T.sides[q].chimney; if (c && !T.sides[q].gone && Math.abs(P.y + 1.9 - c.yb) < 1.2 && P.grounded) { toast('Orange fins: jump into one, then jump again', 3.4); G.hint = 3; break; } } }
  }

  function render(dt) {
    var P = G.p, sp = Math.sqrt(P.vx * P.vx + P.vz * P.vz), st = P.state;
    // camera rides a circle around the spire, on the player's side
    var ang = Math.atan2(P.x, P.z), da = ang - camAng; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    camAng += da * Math.min(1, 4.5 * dt);
    var pr = Math.sqrt(P.x * P.x + P.z * P.z), wantR = Math.max(pr + 11.5, 20.5); camR += (wantR - camR) * Math.min(1, 3 * dt);
    var gy = (P.grounded || st === 'climb' || st === 'hang' || st === 'wall' || st === 'glide') ? P.y : (P.y < focusY - 1.2 ? P.y : Math.max(focusY - 1.2, P.y - 3.4));
    focusY += (gy + 1.2 - focusY) * Math.min(1, 7 * dt);
    var lead = Math.min(1, sp / 7) * 0.2;
    camera.position.set(Math.sin(camAng) * camR, focusY + 6.2, Math.cos(camAng) * camR);
    camera.lookAt(P.x + P.vx * lead, focusY + 2.3, P.z + P.vz * lead);
    sky.position.copy(camera.position);

    // sky and fog blend between the palettes of this height and the next
    var zf = Math.max(0, focusY / Wd.RING_EVERY), zi = Math.floor(zf), k = Math.max(0, (zf - zi - 0.6) / 0.4), A = ZONES[zi % ZONES.length], B = ZONES[(zi + 1) % ZONES.length];
    sky.material.uniforms.uTop.value.setHex(A.top).lerp(tmpC.setHex(B.top), k); sky.material.uniforms.uBot.value.setHex(A.bot).lerp(tmpC.setHex(B.bot), k);
    mat.uniforms.uFog.value.copy(sky.material.uniforms.uBot.value); mat.uniforms.uTide.value = G.tide;
    coreMesh.position.y = Math.round(focusY / 20) * 20;
    var cc = coreMesh.geometry.attributes.col; if (coreMesh.userData.z !== zi) { coreMesh.userData.z = zi; tmpC.setHex(A.core); for (var ci = 0; ci < cc.count; ci++) cc.setXYZ(ci, tmpC.r, tmpC.g, tmpC.b); cc.needsUpdate = true; }
    tideMesh.position.y = G.tide; tideMesh.material.uniforms.uT.value = G.time; tideMesh.material.uniforms.uHeld.value = G.tideHold > 0 ? 1 : 0;

    player.position.set(P.x, P.y, P.z); player.rotation.y = P.yaw;
    sqV += (1 - sq) * 260 * dt; sqV *= Math.pow(0.0008, dt); sq += sqV * dt; sq = Math.max(0.6, Math.min(1.4, sq));
    var wantTilt = st === 'dive' ? 1.3 : st === 'slide' ? (P.slideKind === 'belly' ? 1.45 : -1.0) : st === 'glide' ? 0.55 : st === 'ground' ? Math.min(0.3, sp * 0.022) : st === 'air' ? Math.max(-0.25, Math.min(0.3, -P.vy * 0.02)) : 0;
    tilt += (wantTilt - tilt) * Math.min(1, 14 * dt); spin = st === 'stomp' ? spin + 22 * dt : 0;
    body.rotation.x = tilt + spin; body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq)); body.position.y = 0.85 * sq - (st === 'slide' ? 0.42 : 0);
    player.visible = !G.dead || G.deadT < 0.25; glider.visible = st === 'glide';
    var g0 = S.groundAt(G.T, P.x, P.z, P.y + 0.3), hgt = P.y - g0.y, ss = Math.max(0.4, 1 - hgt / 14);
    shadow.visible = g0.y > -50 && g0.y > G.tide; shadow.position.set(P.x, g0.y + 0.03, P.z); shadow.scale.set(ss, ss, ss); shadow.material.opacity = 0.22 + 0.25 * ss;
    if ((frameN & 1) === 0) { var ta = trail.geometry.attributes.position.array; ta.copyWithin(0, 3); var L = ta.length; ta[L - 3] = P.x; ta[L - 2] = P.y + 0.9; ta[L - 1] = P.z; trail.geometry.attributes.position.needsUpdate = true; }
    for (var i = 0; i < dust.length; i++) { var d = dust[i]; if (d.life <= 0) continue; d.life -= dt; d.m.position.x += d.vx * dt; d.m.position.y += d.vy * dt; d.m.position.z += d.vz * dt; d.m.material.opacity = Math.max(0, d.life * 2); if (d.life <= 0) d.m.visible = false; }
    var rot = G.time * 2.4;
    for (var s = 0; s < G.T.sides.length; s++) { var sd = G.T.sides[s]; if (!sd.mesh || sd.y0 > P.y + 30 || sd.hEnd < P.y - 30) continue; for (var j = 0; j < sd.shards.length; j++) { var m = sd.shards[j].m; if (m) m.rotation.y = rot + j; } }
    renderer.render(scene, camera);
  }
  var tmpC = THREE ? new THREE.Color() : null;

  function hud(force) {
    if (!force && (frameN % 5) !== 0) return;
    var P = G.p, h = Math.max(0, Math.floor(P.y));
    $('#h-height').firstChild.nodeValue = String(h);
    $('#h-best').textContent = 'Best ' + Math.max(best, Math.floor(G.maxH)) + ' m';
    $('#h-shardn').textContent = G.shards;
    var gap = P.y - G.tide, te = $('#h-tide');
    te.textContent = !G.started ? 'Tide is rising' : G.tideHold > 0 ? 'Tide held' : 'Tide ' + Math.max(0, Math.floor(gap)) + ' m below';
    te.className = G.tideHold > 0 && G.started ? 'held' : gap < 6 ? 'near' : '';
    $('#vig').style.opacity = G.dead ? 1 : gap < 7 ? (0.25 + 0.75 * (1 - gap / 7)) * (0.75 + 0.25 * Math.sin(G.time * 9)) : 0;
    var pm = S.pipCount(G.cfg), s = ''; for (var q = 0; q < pm; q++) s += '<i class="' + (P.stam >= q + 0.99 ? 'f' : '') + '"></i>';
    var pe = $('#h-pips'); if (pe.dataset.h !== s) { pe.innerHTML = s; pe.dataset.h = s; }
  }

  function frame(ts) {
    requestAnimationFrame(frame);
    if (!renderer || !G) return;
    var dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016; lastTs = ts; frameN++;
    var m = mode();
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('#toast').classList.remove('on'); }
    if (m === 'play' && !paused && !document.hidden) { if (!G.dead) update(dt); else { G.deadT += dt; G.tide += 5 * dt; } }
    else if (m === 'dead') { G.deadT += dt; G.tide += 1.5 * dt; }
    else if (m === 'title') { G.time += dt; camAng += 0.12 * dt; }
    if (m === 'title') { var keep = camAng; render(dt); camAng = keep; } else render(m === 'pick' || paused ? 0 : dt);
    hud(false);
  }

  /* ---------------- boot ---------------- */
  // The game that used to live at this address cached itself with a service worker. Clear it out.
  try {
    if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { r.unregister(); }); }).catch(function () { /* fine */ });
    if (window.caches) caches.keys().then(function (ks) { ks.forEach(function (k) { if (k.indexOf('skitch-') === 0) caches.delete(k); }); }).catch(function () { /* fine */ });
  } catch (e) { /* not available here */ }
  $('#b-start').addEventListener('click', start);
  $('#b-again').addEventListener('click', function () { if (G.deadT > 0.5) start(); });
  $('#b-pause').addEventListener('click', function () { if (mode() === 'play') setPaused(true); });
  $('#b-resume').addEventListener('click', function () { setPaused(false); });
  $('#b-restart').addEventListener('click', start);
  function muteLabel() { $('#b-mute').style.opacity = muted ? 0.45 : 1; }
  $('#b-mute').addEventListener('click', function () { muted = !muted; try { localStorage.setItem('shmoove-mute', muted ? '1' : '0'); } catch (e) { /* fine */ } if (!muted) audioOn(); muteLabel(); });
  muteLabel();
  $('#t-best').textContent = best > 0 ? 'Best ' + best + ' m' : 'No best yet';
  function fitWord() { var w = $('.word'), max = w.parentNode.clientWidth, n = 0; w.style.fontSize = ''; while (w.scrollWidth > max && n++ < 40) w.style.fontSize = (parseFloat(getComputedStyle(w).fontSize) * 0.95) + 'px'; }
  fitWord(); if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitWord); window.addEventListener('resize', fitWord);
  document.addEventListener('visibilitychange', function () { if (document.hidden && mode() === 'play' && G && !G.dead) setPaused(true); });
  if (initGL()) {
    newRun(); G.p.yaw = Math.PI / 2;
    if (window.ResizeObserver) new ResizeObserver(resize).observe(app); window.addEventListener('resize', resize); window.addEventListener('orientationchange', resize);
    requestAnimationFrame(frame);
  } else app.classList.add('nogl');
  window.__shmoove = { get G() { return G; }, start: start, offer: offer, UPS: UPS };
})();
