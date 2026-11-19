import {
  Color,
  type InstancedBufferAttribute,
  type InstancedMesh,
  type MeshLambertMaterial,
} from "three";
import { describe, expect, it } from "vitest";
import { PALETTE } from "../../src/render/look";
import {
  GLOW_REACH,
  NO_RAIL,
  PAD_CHEVRONS,
  ParkView,
} from "../../src/render/parkView";
import { makeBowl } from "../../src/sim/bowl";
import { flatTerrain } from "../../src/sim/terrain";

/** Every corner of every box of the dressing and its lights, in world space. */
function corners(view: ParkView): { x: number; y: number; z: number }[] {
  return [...cornersOf(view.dressing), ...cornersOf(view.unfogged)];
}

function cornersOf(mesh: InstancedMesh): { x: number; y: number; z: number }[] {
  const m = mesh.instanceMatrix.array;
  const out = [];
  for (let i = 0; i < mesh.count; i++) {
    const o = i * 16;
    for (let c = 0; c < 8; c++) {
      const sx = c & 1 ? 0.5 : -0.5;
      const sy = c & 2 ? 0.5 : -0.5;
      const sz = c & 4 ? 0.5 : -0.5;
      out.push({
        x: m[o] * sx + m[o + 4] * sy + m[o + 8] * sz + m[o + 12],
        y: m[o + 1] * sx + m[o + 5] * sy + m[o + 9] * sz + m[o + 13],
        z: m[o + 2] * sx + m[o + 6] * sy + m[o + 10] * sz + m[o + 14],
      });
    }
  }
  return out;
}

/** The dressing as numbers: matrices and colours of the boxes in use, solids and lights. */
function dressingOf(view: ParkView): number[] {
  const out: number[] = [];
  for (const mesh of [view.dressing, view.unfogged]) {
    const n = mesh.count;
    const c = mesh.instanceColor;
    if (!c) throw new Error("no colours");
    out.push(
      ...Array.from(mesh.instanceMatrix.array.slice(0, n * 16)),
      ...Array.from((c.array as Float32Array).slice(0, n * 3)),
    );
  }
  return out;
}

describe("ParkView", () => {
  it("dresses the same seed the same way and another seed differently", () => {
    const a = new ParkView(makeBowl(3), 3);
    const b = new ParkView(makeBowl(3), 3);
    const c = new ParkView(makeBowl(3), 4);
    expect(a.dressingCount).toBeGreaterThan(300);
    expect(dressingOf(a)).toEqual(dressingOf(b));
    expect(dressingOf(a)).not.toEqual(dressingOf(c));
  });

  it("stands nothing of the dressing where the rider can ride", () => {
    for (const seed of [1, 2, 9]) {
      const bowl = makeBowl(seed);
      const view = new ParkView(bowl, seed);
      let nearest = Infinity;
      for (const p of corners(view))
        nearest = Math.min(nearest, Math.hypot(p.x, p.z));
      expect(nearest).toBeGreaterThan(bowl.radius);
      // Nor anywhere on a box's footprint: the nearest point of each to the middle is outside too.
      for (const mesh of [view.dressing, view.unfogged]) {
        const m = mesh.instanceMatrix.array;
        for (let i = 0; i < mesh.count; i++) {
          const o = i * 16;
          const x = m[o + 12];
          const z = m[o + 14];
          // Nearest point of the box's footprint to the middle, by clamping the middle into it.
          const ux = m[o];
          const uz = m[o + 2];
          const vx = m[o + 8];
          const vz = m[o + 10];
          const lu = Math.hypot(ux, uz);
          const lv = Math.hypot(vx, vz);
          const cu = Math.max(
            -lu / 2,
            Math.min(lu / 2, -(x * ux + z * uz) / lu),
          );
          const cv = Math.max(
            -lv / 2,
            Math.min(lv / 2, -(x * vx + z * vz) / lv),
          );
          const px = x + (ux / lu) * cu + (vx / lv) * cv;
          const pz = z + (uz / lu) * cu + (vz / lv) * cv;
          expect(Math.hypot(px, pz), `${mesh.name} box ${i}`).toBeGreaterThan(
            bowl.radius,
          );
        }
      }
    }
  });

  it("builds the place: a fence all round, lights and things standing above it, a skyline far out", () => {
    const bowl = makeBowl(5);
    const view = new ParkView(bowl, 5);
    const lip = bowl.heightAt(bowl.radius, 0);
    const pts = corners(view);
    // All the way round: every 10 degrees of the circle has dressing near the lip.
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * Math.PI * 2;
      const near = pts.some((p) => {
        const pa = Math.atan2(p.x, p.z);
        let d = Math.abs(pa - (a > Math.PI ? a - Math.PI * 2 : a));
        if (d > Math.PI) d = Math.PI * 2 - d;
        return (
          d < 0.09 && Math.hypot(p.x, p.z) < bowl.radius + 3 && p.y > lip + 1
        );
      });
      expect(near, `angle ${k * 10}`).toBe(true);
    }
    // Floodlights and the skyline rise well above the lip; the skyline stands far out.
    expect(
      pts.some(
        (p) => p.y > lip + 20 && Math.hypot(p.x, p.z) < bowl.radius + 10,
      ),
    ).toBe(true);
    expect(
      pts.some(
        (p) => p.y > lip + 40 && Math.hypot(p.x, p.z) > bowl.radius + 25,
      ),
    ).toBe(true);
    // Its lights and far silhouettes are not fogged, so they read from across the bowl; the rest is
    // fogged. Most of what is not fogged glows.
    const glow = view.unfogged.geometry.getAttribute(
      "aGlow",
    ) as InstancedBufferAttribute;
    let glowing = 0;
    for (let i = 0; i < view.unfogged.count; i++)
      if (glow.getX(i) >= 0.5) glowing++;
    expect(glowing).toBeGreaterThan(150);
    expect(glowing).toBeGreaterThan(view.unfoggedCount / 2);
    expect((view.unfogged.material as MeshLambertMaterial).fog).toBe(false);
    expect((view.dressing.material as MeshLambertMaterial).fog).toBe(true);
    // Floodlights in the sun's colour.
    const c = view.unfogged.instanceColor;
    if (!c) throw new Error("no colours");
    const sun = new Color(PALETTE.sun);
    let heads = 0;
    for (let i = 0; i < view.unfogged.count; i++)
      if (
        Math.abs(c.getX(i) - sun.r) +
          Math.abs(c.getY(i) - sun.g) +
          Math.abs(c.getZ(i) - sun.b) <
        1e-4
      )
        heads++;
    expect(heads).toBeGreaterThanOrEqual(6);
  });

  it("is three draw calls and a modest number of triangles", () => {
    const view = new ParkView(makeBowl(1), 1);
    expect(view.object.children).toEqual([
      view.dressing,
      view.unfogged,
      view.decals,
    ]);
    expect(
      (view.dressingCount + view.unfoggedCount) * 12 + view.decalTriangles,
    ).toBeLessThan(20000);
    // The double-sided decals are drawn in one pass: one draw call.
    expect((view.decals.material as MeshLambertMaterial).forceSinglePass).toBe(
      true,
    );
  });

  it("paints chevrons on every pad, pointing down its fall line, and lights them in turn along it", () => {
    const bowl = makeBowl(2);
    const view = new ParkView(bowl, 2);
    const g = view.decals.geometry;
    const pos = g.getAttribute("position");
    const flow = g.getAttribute("aFlow");
    for (const p of bowl.pads) {
      // The chevrons' vertices on this pad, and their phase.
      const mine: { x: number; z: number; y: number; flow: number }[] = [];
      for (let v = 0; v < pos.count; v++) {
        if (flow.getX(v) < 0) continue;
        if (Math.hypot(pos.getX(v) - p.x, pos.getZ(v) - p.z) > p.radius)
          continue;
        mine.push({
          x: pos.getX(v),
          y: pos.getY(v),
          z: pos.getZ(v),
          flow: flow.getX(v),
        });
      }
      const phases = [...new Set(mine.map((m) => m.flow))].sort();
      expect(phases.length).toBe(PAD_CHEVRONS);
      // Lifted just over the ground.
      for (const m of mine) {
        const h = m.y - bowl.heightAt(m.x, m.z);
        expect(h).toBeGreaterThan(0.02);
        expect(h).toBeLessThan(0.3);
      }
      // Later phases lie further downhill: the light runs down the fall line.
      const mean = (f: number): number => {
        const s = mine.filter((m) => m.flow === f);
        return (
          s.reduce((acc, m) => acc + bowl.heightAt(m.x, m.z), 0) / s.length
        );
      };
      const n = { x: 0, y: 1, z: 0 };
      bowl.normalAt(p.x, p.z, n);
      if (Math.hypot(n.x, n.z) > 0.01)
        expect(mean(phases[PAD_CHEVRONS - 1])).toBeLessThan(mean(phases[0]));
    }
  });

  it("marks every kicker with stripes up its edges and a bright lip band", () => {
    const bowl = makeBowl(4);
    const view = new ParkView(bowl, 4);
    const pos = view.decals.geometry.getAttribute("position");
    const fade = view.decals.geometry.getAttribute("aFade");
    const rail = view.decals.geometry.getAttribute("aRail");
    for (const k of bowl.features.kickers) {
      const fx = Math.sin(k.yaw);
      const fz = Math.cos(k.yaw);
      let near = 0;
      let first = Infinity;
      let last = -Infinity;
      let lipAt = -Infinity;
      for (let v = 0; v < pos.count; v++) {
        const dx = pos.getX(v) - k.x;
        const dz = pos.getZ(v) - k.z;
        if (Math.hypot(dx, dz) > 12 || rail.getX(v) >= 0) continue;
        near++;
        // On the ground, just over it, all along: the stripes follow the ramp's surface.
        const h = pos.getY(v) - bowl.heightAt(pos.getX(v), pos.getZ(v));
        expect(h).toBeGreaterThan(0.02);
        expect(h).toBeLessThan(0.3);
        const along = dx * fx + dz * fz;
        first = Math.min(first, along);
        last = Math.max(last, along);
        if (fade.getX(v) >= 1) lipAt = Math.max(lipAt, along);
      }
      expect(near).toBeGreaterThan(100);
      // From the foot of the ramp up to past the crest, and the bright band at the lip ahead of it.
      expect(first).toBeLessThan(-9);
      expect(last).toBeGreaterThan(0.5);
      expect(lipAt).toBeGreaterThan(0.5);
    }
  });

  it("glows along the rail being ground only, brightest at the board", () => {
    const bowl = makeBowl(1);
    const view = new ParkView(bowl, 1);
    view.update({ rail: -1, railT: 0 }, 1);
    expect(view.uRail.value).toBe(NO_RAIL);
    expect(view.uTime.value).toBe(1);
    view.update({ rail: 2, railT: 0.5 }, 2);
    expect(view.uRail.value).toBe(2);
    const r = bowl.rails[2];
    expect(view.uRailM.value).toBeCloseTo(
      Math.hypot(r.x1 - r.x0, r.y1 - r.y0, r.z1 - r.z0) / 2,
      5,
    );
    // Every rail has its strips, tagged with its index and running its whole length.
    const rail = view.decals.geometry.getAttribute("aRail");
    for (let i = 0; i < bowl.rails.length; i++) {
      let maxAlong = 0;
      let count = 0;
      for (let v = 0; v < rail.count; v++) {
        if (rail.getX(v) !== i) continue;
        count++;
        maxAlong = Math.max(maxAlong, rail.getY(v));
      }
      const q = bowl.rails[i];
      expect(count).toBeGreaterThan(0);
      expect(maxAlong).toBeCloseTo(
        Math.hypot(q.x1 - q.x0, q.y1 - q.y0, q.z1 - q.z0),
        3,
      );
    }
    expect(GLOW_REACH).toBeGreaterThan(2);
    // The material shows a strip only where its rail matches the uniform.
    const mat = view.decals.material as MeshLambertMaterial;
    const shader = {
      uniforms: {} as Record<string, { value: number }>,
      vertexShader: "#include <common>\n#include <begin_vertex>",
      fragmentShader:
        "#include <common>\n#include <emissivemap_fragment>\n#include <opaque_fragment>",
    };
    mat.onBeforeCompile(shader as never, undefined as never);
    expect(shader.uniforms.uRail).toBe(view.uRail);
    expect(shader.vertexShader).toContain("abs(aRail.x - uRail) < 0.5");
  });

  it("draws no kicker marks on ground that has none, and nothing breaks without rails or pads", () => {
    const view = new ParkView(flatTerrain(170), 1);
    expect(view.decalTriangles).toBe(0);
    expect(view.decals.visible).toBe(false);
    expect(view.dressingCount).toBeGreaterThan(300);
    view.update({ rail: 0, railT: 0.3 }, 0);
    expect(view.uRail.value).toBe(NO_RAIL);
  });
});
