// clarity: is what matters the first thing the eye finds? Three seeded moments of real play driven
// through the hook, each in all four looks, saved as clarity-<look>-<moment>.png:
//
// - early: the first minute, the starting weapon only;
// - mid: a mid run with three weapons;
// - late: a late crowd with four weapons at level 5 (the ones centred on the rider: the Wake, the
//   Bumper, Slam and Orbit, the worst case for finding the rider under its own effects).
//
// Before the early moment, a calm frame: full health, a few seconds in, when nothing can be within
// 10 m yet (spawns land at least 38 m away; see DIRECTOR.nearest). Measured from the screenshots:
//
// - calm: the share of pixels in the outer tenth of the screen that are red-dominant: under 1%;
// - late: the share of near-white pixels in the box 2 m round the rider (a 4 m square of ground
//   centred on it, up to head height, projected with the chase camera's own numbers): under a third;
// - every moment: the mean brightness of the top fifth of the screen is below the middle three fifths.
//
// The measures are printed, one line per look and moment, for the record.
//
// SHMOOVE_LOOKS=night,pool shoots only those looks (the whole set fits in a route's time, but a
// busy machine may want fewer).
import { join } from 'node:path';
import { newPhoneContext, ROOT, waitForHook, watchProblems } from '../run.mjs';

const ALL_LOOKS = ['night', 'pool', 'tape', 'riso'];
const LOOKS = process.env.SHMOOVE_LOOKS ? process.env.SHMOOVE_LOOKS.split(',').filter((l) => ALL_LOOKS.includes(l)) : ALL_LOOKS;
const SEED = 11;
/** PHASE_CHOOSE in src/sim/world.ts. */
const PHASE_CHOOSE = 3;
/** Weapon ids (src/sim/arsenal.ts W_*). */
const WAKE = 0;
const SEEKERS = 1;
const BUMPER = 2;
const SLAM = 3;
const ORBIT = 4;
const WEAPON_COUNT = 10;

/**
 * The moments: run clock to start from, weapons to set as [id, level], ticks of play. The weapons
 * are set again after the play (a card taken on the way may have changed them).
 */
const MOMENTS = [
  { name: 'early', clock: 30, weapons: [[WAKE, 1]], ticks: 420 },
  { name: 'mid', clock: 200, weapons: [[WAKE, 3], [SEEKERS, 3], [SLAM, 3]], ticks: 420 },
  { name: 'late', clock: 450, weapons: [[WAKE, 5], [BUMPER, 5], [SLAM, 5], [ORBIT, 5]], ticks: 360 },
];
/** Ticks of play before the calm frame: too few for anything spawned 38 m off to come within 10 m. */
const CALM_TICKS = 90;
/** Ticks stepped per drawn frame while playing (each step of the hook draws one frame). */
const CHUNK = 6;

/** The chase camera's numbers (FEEL in src/sim/constants.ts), to find the rider's box on screen. */
const CAM = { dist: 7, height: 5.5, distPerGear: 1, heightPerGear: 0.75, ahead: 4, aheadPerGear: 1.2, fov: 74, fovPerGear: 3 };
const W = 390;
const H = 844;

/** Play `ticks` ticks of a weaving, carving ride with a hop now and then, taking any card offered. */
async function play(page, ticks, from) {
  return page.evaluate(
    ([ticks, from, chunk, choose]) => {
      const h = window.__shmoove;
      for (let t = from; t < from + ticks; t += chunk) {
        h.hold({ steerX: Math.sin(t / 70) * 0.7, steerY: 1, carve: true });
        if (Math.floor(t / 97) !== Math.floor((t + chunk) / 97)) h.hop();
        h.step(chunk);
        if (h.state().phase === choose) {
          h.pick(0);
          h.step(1);
        }
      }
      return h.state();
    },
    [ticks, from, CHUNK, PHASE_CHOOSE],
  );
}

/** Where the rider's 2 m box lands on the screen, CSS px, from the hook's state and the camera's numbers. */
function riderBox(s) {
  const zoom = Math.max(0, s.gear - 1);
  const dist = CAM.dist + CAM.distPerGear * zoom;
  const height = CAM.height + CAM.heightPerGear * zoom;
  const ahead = CAM.ahead + CAM.aheadPerGear * zoom;
  const fov = ((CAM.fov + CAM.fovPerGear * zoom) * Math.PI) / 180;
  const sx = Math.sin(s.viewYaw);
  const sz = Math.cos(s.viewYaw);
  const eye = [s.x - sx * dist, s.y + height, s.z - sz * dist];
  const at = [s.x + sx * ahead, s.y + 1, s.z + sz * ahead];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (a) => {
    const l = Math.hypot(a[0], a[1], a[2]);
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const back = norm(sub(eye, at));
  const right = norm(cross([0, 1, 0], back));
  const up = cross(back, right);
  const f = 1 / Math.tan(fov / 2);
  const aspect = W / H;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const dx of [-2, 2]) {
    for (const dz of [-2, 2]) {
      for (const dy of [0, 1.8]) {
        const p = sub([s.x + dx, s.y + dy, s.z + dz], eye);
        const depth = -dot(p, back);
        const nx = (dot(p, right) * f) / aspect / depth;
        const ny = (dot(p, up) * f) / depth;
        const px = ((nx + 1) / 2) * W;
        const py = ((1 - ny) / 2) * H;
        x0 = Math.min(x0, px);
        x1 = Math.max(x1, px);
        y0 = Math.min(y0, py);
        y1 = Math.max(y1, py);
      }
    }
  }
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  return { x0: clamp(x0, 0, W), y0: clamp(y0, 0, H), x1: clamp(x1, 0, W), y1: clamp(y1, 0, H) };
}

/** Measure a screenshot (PNG bytes) at CSS size in the page: red edge share, white share in `box`, mean brightness of bands. */
async function measure(page, png, box) {
  return page.evaluate(
    async ([b64, box, W, H]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, W, H);
      const d = g.getImageData(0, 0, W, H).data;
      const ex = Math.round(W * 0.1);
      const ey = Math.round(H * 0.1);
      let edge = 0;
      let red = 0;
      let inBox = 0;
      let white = 0;
      let topSum = 0;
      let topN = 0;
      let midSum = 0;
      let midN = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const r = d[i];
          const gg = d[i + 1];
          const bb = d[i + 2];
          const luma = 0.2126 * r + 0.7152 * gg + 0.0722 * bb;
          if (x < ex || x >= W - ex || y < ey || y >= H - ey) {
            edge++;
            if (r > 80 && r > 1.6 * gg && r > 1.6 * bb) red++;
          }
          if (box && x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1) {
            inBox++;
            if (r > 225 && gg > 225 && bb > 225) white++;
          }
          if (y < H * 0.2) {
            topSum += luma;
            topN++;
          } else if (y < H * 0.8) {
            midSum += luma;
            midN++;
          }
        }
      }
      return { red: red / edge, white: inBox ? white / inBox : 0, top: topSum / topN, mid: midSum / midN };
    },
    [png.toString('base64'), box, W, H],
  );
}

const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));

async function picture(page, name) {
  await settle(page);
  return page.screenshot({ path: join(ROOT, 'artifacts', 'screens', `${name}.png`), timeout: 120_000 });
}

/** Exactly these weapons (only four slots can be filled): any other a card added is taken away first. */
function setWeapons(page, weapons) {
  return page.evaluate(
    ([ws, n]) => {
      const h = window.__shmoove;
      for (let k = 0; k < n; k++) if (!ws.some(([id]) => id === k)) h.setWeapon(k, 0);
      for (const [id, level] of ws) h.setWeapon(id, level);
    },
    [weapons, WEAPON_COUNT],
  );
}

const pct = (v) => `${(v * 100).toFixed(1)}%`;

/** One look: the calm frame, then the three moments, each from a fresh run. */
async function shootLook(browser, origin, look, problems, check) {
  const context = await newPhoneContext(browser);
  const page = await context.newPage();
  watchProblems(page, problems);
  try {
    await page.goto(`${origin}/?hook&nolesson&mute&seed=${SEED}&look=${look}`);
    await waitForHook(page);
    await page.evaluate(() => window.__shmoove.pause(true));

    // Calm: full health, nothing near yet.
    const calm = await play(page, CALM_TICKS, 0);
    check(calm.hp === calm.maxHp, `${look}: full health in the calm frame`, calm);
    const calmShot = await picture(page, `clarity-${look}-calm`);
    const cm = await measure(page, calmShot, null);
    console.log(`    [clarity] ${look} calm: red at the edges ${pct(cm.red)}, top ${cm.top.toFixed(1)}, middle ${cm.mid.toFixed(1)}`);
    check(cm.red < 0.01, `${look}: no red at the edges with full health and nothing near`, cm);

    for (const m of MOMENTS) {
      await page.evaluate((clock) => {
        const h = window.__shmoove;
        h.restart();
        h.step(1);
        h.setClock(clock);
      }, m.clock);
      await setWeapons(page, m.weapons);
      const s = await play(page, m.ticks, 0);
      await setWeapons(page, m.weapons);
      const end = await page.evaluate(() => {
        const h = window.__shmoove;
        h.step(1);
        return h.state();
      });
      check(end.phase === 0, `${look} ${m.name}: still riding`, { phase: end.phase, hp: end.hp });
      const shot = await picture(page, `clarity-${look}-${m.name}`);
      const box = riderBox(end);
      const r = await measure(page, shot, box);
      console.log(
        `    [clarity] ${look} ${m.name}: hp ${Math.round(end.hp)}/${Math.round(end.maxHp)}, ${end.enemies} enemies, ` +
          `red at the edges ${pct(r.red)}, white round the rider ${pct(r.white)}, top ${r.top.toFixed(1)}, middle ${r.mid.toFixed(1)}` +
          ` (played ${s.seconds.toFixed(0)} s on the clock)`,
      );
      check(r.top < r.mid, `${look} ${m.name}: the top of the screen is darker than the middle`, r);
      if (m.name === 'late') check(r.white < 1 / 3, `${look} late: the rider is not lost under white`, { ...r, box });
    }
  } finally {
    await context.close();
  }
}

export default {
  name: 'clarity',
  query: `?hook&nolesson&mute&seed=${SEED}`,
  async run(t) {
    const { page, check } = t;
    const origin = new URL(page.url()).origin;
    const browser = page.context().browser();
    const problems = [];
    for (const look of LOOKS) await shootLook(browser, origin, look, problems, check);
    for (const p of problems) check(false, p);
    await t.shot();
  },
};
