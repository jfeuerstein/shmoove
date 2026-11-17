/**
 * The core look: flat ink colours, halftone shadows, risograph misregistration.
 *
 * Contract for every world mesh: use `inkMaterial()` with attributes `position` and `color`
 * (vec3, display-referred sRGB values) and optionally `glow` (float 0..1: lit at night, e.g.
 * windows and lamps). Normals are not needed: faces are flat-shaded from screen-space derivatives,
 * so geometry can be indexed and share vertices freely within one colour.
 *
 * Colours are authored and output in display space; three.js colour management is off.
 */
import * as THREE from 'three';

THREE.ColorManagement.enabled = false;

export const INK = {
  mango: 0xffae1a,
  pink: 0xff2e88,
  teal: 0x00a99d,
  cobalt: 0x1f3fbf,
  concrete: 0xd9d2c3,
  paper: 0xf3ebdd,
  ink: 0x1b1a2e,
  // Supporting tones, all mixes of the five inks and paper.
  asphalt: 0x8f8a86,
  curb: 0xbfb7a6,
  brick: 0xe0704a,
  sand: 0xe8cf9e,
  leaf: 0x4fb37a,
  sea: 0x1aa7c4,
  white: 0xfbf6ec,
} as const;

export function rgb(hex: number, out: THREE.Color = new THREE.Color()): THREE.Color {
  return out.setRGB(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
}

/** Uniforms shared by every ink material, sky and shadow. Set by `applyTimeOfDay` and `setViewport`. */
export const LOOK = {
  uSunDir: { value: new THREE.Vector3(0.45, 0.75, 0.48).normalize() },
  uLitTint: { value: new THREE.Color(1, 1, 1) },
  uShadowInk: { value: new THREE.Color(0.56, 0.55, 0.88) },
  uFogColor: { value: rgb(INK.paper) },
  uFogNear: { value: 140 },
  uFogFar: { value: 520 },
  uNight: { value: 0 },
  uGlowColor: { value: rgb(INK.mango) },
  uSkyTop: { value: new THREE.Color(0.44, 0.78, 0.85) },
  uSkyHorizon: { value: rgb(INK.paper) },
  uSunColor: { value: rgb(INK.white) },
  /** Halftone dot pitch in device pixels. */
  uDotPx: { value: 7 },
};

const HALFTONE_GLSL = /* glsl */ `
  // Screen-space dot screen at 30 degrees. Returns 1 inside a dot whose area grows with darkness.
  float halftone(vec2 frag, float pitch, float darkness) {
    const mat2 R = mat2(0.8660254, -0.5, 0.5, 0.8660254);
    vec2 p = R * frag / pitch;
    vec2 c = fract(p) - 0.5;
    float r = 0.74 * sqrt(clamp(darkness, 0.0, 1.0));
    float aa = 0.9 / pitch;
    return 1.0 - smoothstep(r - aa, r + aa, length(c));
  }
`;

const INK_VERT = /* glsl */ `
  attribute float glow;
  varying vec3 vColor;
  varying vec3 vWorld;
  varying float vGlow;
  varying float vDepth;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    #ifdef USE_INSTANCING
      wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    #endif
    vWorld = wp.xyz;
    vColor = color;
    vGlow = glow;
    vec4 mv = viewMatrix * wp;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const INK_FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uLitTint;
  uniform vec3 uShadowInk;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uNight;
  uniform vec3 uGlowColor;
  uniform float uDotPx;
  varying vec3 vColor;
  varying vec3 vWorld;
  varying float vGlow;
  varying float vDepth;
  ${HALFTONE_GLSL}
  void main() {
    // Flat face normal from derivatives: chunky low-poly without normal attributes.
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    float ndl = dot(n, uSunDir);
    // Two tones plus dots: full light above 0.28, then a dot screen that fills in as the face turns away.
    float darkness = (0.28 - ndl) / 1.0;
    float dots = halftone(gl_FragCoord.xy, uDotPx, darkness);
    vec3 base = vColor * uLitTint;
    vec3 col = mix(base, base * uShadowInk, dots);
    // Lamps and windows come on at night, and ignore the shadow screen.
    col = mix(col, uGlowColor, clamp(vGlow * uNight, 0.0, 1.0));
    float fog = smoothstep(uFogNear, uFogFar, vDepth);
    gl_FragColor = vec4(mix(col, uFogColor, fog * 0.92), 1.0);
  }
`;

let sharedInk: THREE.ShaderMaterial | null = null;

/**
 * The material for all world geometry. One shared instance by default (one program, one state);
 * pass `{ unique: true }` for a variant (e.g. double-sided).
 */
export function inkMaterial(opts: { unique?: boolean; doubleSided?: boolean } = {}): THREE.ShaderMaterial {
  if (!opts.unique && !opts.doubleSided && sharedInk) return sharedInk;
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: LOOK.uSunDir,
      uLitTint: LOOK.uLitTint,
      uShadowInk: LOOK.uShadowInk,
      uFogColor: LOOK.uFogColor,
      uFogNear: LOOK.uFogNear,
      uFogFar: LOOK.uFogFar,
      uNight: LOOK.uNight,
      uGlowColor: LOOK.uGlowColor,
      uDotPx: LOOK.uDotPx,
    },
    vertexShader: INK_VERT,
    fragmentShader: INK_FRAG,
    vertexColors: true,
    side: opts.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  m.name = 'ink';
  if (!opts.unique && !opts.doubleSided) sharedInk = m;
  return m;
}

/**
 * Halftone blob shadow: a flat quad or disc under a moving thing. Multiplies what is under it with
 * shadow ink through the dot screen. Geometry needs `position` and `uv` (0..1 across the blob).
 */
export function shadowMaterial(): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: { uShadowInk: LOOK.uShadowInk, uDotPx: LOOK.uDotPx, uStrength: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uShadowInk;
      uniform float uDotPx;
      uniform float uStrength;
      varying vec2 vUv;
      ${HALFTONE_GLSL}
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float darkness = (1.0 - smoothstep(0.35, 1.0, d)) * 0.8 * uStrength;
        float dots = halftone(gl_FragCoord.xy, uDotPx, darkness);
        gl_FragColor = vec4(mix(vec3(1.0), uShadowInk, dots), 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    // dst = dst * src: multiply what is underneath by the shadow ink.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor,
    blendDst: THREE.SrcColorFactor,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  m.name = 'shadow';
  return m;
}

/** Sky dome: two-ink gradient, a hard sun or moon disc, a halftone haze band, stars at night. */
export function createSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(1, 20, 12);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSkyTop: LOOK.uSkyTop,
      uSkyHorizon: LOOK.uSkyHorizon,
      uSunDir: LOOK.uSunDir,
      uSunColor: LOOK.uSunColor,
      uNight: LOOK.uNight,
      uDotPx: LOOK.uDotPx,
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * viewMatrix * vec4(position * 900.0 + cameraPosition, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSkyTop;
      uniform vec3 uSkyHorizon;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform float uNight;
      uniform float uDotPx;
      varying vec3 vDir;
      ${HALFTONE_GLSL}
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float t = clamp(d.y * 1.6 + 0.08, 0.0, 1.0);
        // Hard two-tone sky joined by a dot screen instead of a smooth gradient.
        float band = halftone(gl_FragCoord.xy, uDotPx * 1.6, 1.0 - t);
        vec3 col = mix(uSkyTop, uSkyHorizon, band);
        float sun = dot(d, uSunDir);
        col = mix(col, uSunColor, step(0.9972, sun));
        // Stars: sparse dots on a direction grid.
        vec2 g = vec2(atan(d.z, d.x) * 40.0, d.y * 60.0);
        float star = step(0.985, hash(floor(g))) * step(length(fract(g) - 0.5), 0.16) * step(0.05, d.y);
        col = mix(col, vec3(0.98, 0.93, 0.8), star * uNight);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    depthFunc: THREE.LessEqualDepth,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  mesh.name = 'sky';
  return mesh;
}

// ---------------------------------------------------------------------------------------------
// Time of day

interface Key {
  t: number;
  top: number;
  horizon: number;
  tint: [number, number, number];
  shadow: [number, number, number];
  night: number;
}

/** Sky and ink ramps through the 12-minute day. 0 = midnight. */
const KEYS: Key[] = [
  { t: 0.0, top: 0x0b1447, horizon: 0x243a9e, tint: [0.5, 0.58, 0.92], shadow: [0.42, 0.45, 0.8], night: 1 },
  { t: 0.2, top: 0x0f1a55, horizon: 0x2c44aa, tint: [0.52, 0.6, 0.93], shadow: [0.42, 0.45, 0.8], night: 1 },
  { t: 0.255, top: 0x5b6bd6, horizon: 0xff8fb5, tint: [1.0, 0.84, 0.88], shadow: [0.58, 0.48, 0.82], night: 0.35 },
  { t: 0.31, top: 0x6fc7d9, horizon: 0xf3ebdd, tint: [1, 1, 1], shadow: [0.56, 0.55, 0.88], night: 0 },
  { t: 0.69, top: 0x62bfd6, horizon: 0xf3ebdd, tint: [1, 1, 1], shadow: [0.56, 0.55, 0.88], night: 0 },
  { t: 0.755, top: 0x7a4fc9, horizon: 0xffae1a, tint: [1.0, 0.86, 0.7], shadow: [0.62, 0.45, 0.78], night: 0.3 },
  { t: 0.81, top: 0x141c5e, horizon: 0x3a3aa8, tint: [0.55, 0.6, 0.92], shadow: [0.42, 0.45, 0.8], night: 1 },
  { t: 1.0, top: 0x0b1447, horizon: 0x243a9e, tint: [0.5, 0.58, 0.92], shadow: [0.42, 0.45, 0.8], night: 1 },
];

const _c0 = new THREE.Color();
const _c1 = new THREE.Color();

/** Set every shared uniform for a day fraction (0 = midnight). */
export function applyTimeOfDay(dayFrac: number): void {
  const f = dayFrac - Math.floor(dayFrac);
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].t <= f) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const k = (f - a.t) / (b.t - a.t);
  LOOK.uSkyTop.value.copy(rgb(a.top, _c0)).lerp(rgb(b.top, _c1), k);
  LOOK.uSkyHorizon.value.copy(rgb(a.horizon, _c0)).lerp(rgb(b.horizon, _c1), k);
  LOOK.uFogColor.value.copy(LOOK.uSkyHorizon.value);
  LOOK.uLitTint.value.setRGB(
    a.tint[0] + (b.tint[0] - a.tint[0]) * k,
    a.tint[1] + (b.tint[1] - a.tint[1]) * k,
    a.tint[2] + (b.tint[2] - a.tint[2]) * k,
  );
  LOOK.uShadowInk.value.setRGB(
    a.shadow[0] + (b.shadow[0] - a.shadow[0]) * k,
    a.shadow[1] + (b.shadow[1] - a.shadow[1]) * k,
    a.shadow[2] + (b.shadow[2] - a.shadow[2]) * k,
  );
  const night = a.night + (b.night - a.night) * k;
  LOOK.uNight.value = night;

  // The sun crosses east to west on the uphill side of the sky, so faces toward the usual
  // downhill-looking camera catch light. At night the moon takes the opposite arc.
  const isDay = f > 0.25 && f < 0.78;
  const span = isDay ? (f - 0.25) / 0.53 : ((f + 1 - 0.78) % 1) / 0.47;
  const az = (0.12 + 0.76 * span) * Math.PI;
  const el = (0.15 + 0.24 * Math.sin(Math.PI * span)) * Math.PI;
  const ce = Math.cos(el);
  LOOK.uSunDir.value.set(Math.cos(az) * ce, Math.sin(el), 0.55 * ce + 0.15).normalize();
  LOOK.uSunColor.value.copy(isDay ? rgb(INK.white, _c0) : rgb(0xd8e0ff, _c0));
  if (isDay && night > 0.05) LOOK.uSunColor.value.lerp(rgb(INK.pink, _c1), Math.min(1, night * 1.6));
}

// ---------------------------------------------------------------------------------------------
// Risograph post pass

export interface Riso {
  /** Render `scene` through the print pass (or straight to the screen when disabled). */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void;
  setSize(width: number, height: number, pixelRatio: number): void;
  enabled: boolean;
  dispose(): void;
}

/**
 * Prints the frame like a two-plate risograph: the pink plate (red channel) and the cobalt plate
 * (blue channel) sit a pixel or two off-register in fixed, different directions, over paper grain
 * with uneven ink density.
 */
export function createRiso(): Riso {
  const target = new THREE.WebGLRenderTarget(4, 4, {
    depthBuffer: true,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
  });
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: target.texture },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uPx: { value: 2 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = position.xy * 0.5 + 0.5;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tScene;
      uniform vec2 uTexel;
      uniform float uPx;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        // Plate offsets in device pixels: fixed, like a real mis-fed sheet.
        vec2 offPink = vec2(1.15, 0.55) * uPx * uTexel;
        vec2 offCobalt = vec2(-0.7, 0.95) * uPx * uTexel;
        vec3 c = texture2D(tScene, vUv).rgb;
        c.r = texture2D(tScene, vUv + offPink).r;
        c.b = texture2D(tScene, vUv + offCobalt).b;
        // Paper grain and uneven ink lay-down.
        vec2 frag = gl_FragCoord.xy;
        float grain = hash(floor(frag / max(1.0, uPx * 0.5)));
        float density = vnoise(frag / (90.0 * uPx));
        c *= 0.965 + 0.05 * density;
        c += (grain - 0.5) * 0.035;
        // Paper shows through: nothing is ever pure black or pure white.
        c = mix(vec3(0.075, 0.07, 0.13), vec3(0.985, 0.965, 0.93), c);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  // One big triangle covering the screen.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const quad = new THREE.Mesh(geo, mat);
  quad.frustumCulled = false;
  const postScene = new THREE.Scene();
  postScene.add(quad);
  const postCam = new THREE.Camera();

  return {
    enabled: true,
    render(renderer, scene, camera) {
      if (!this.enabled) {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
        return;
      }
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCam);
    },
    setSize(width, height, pixelRatio) {
      const w = Math.max(1, Math.floor(width * pixelRatio));
      const h = Math.max(1, Math.floor(height * pixelRatio));
      target.setSize(w, h);
      mat.uniforms.uTexel.value.set(1 / w, 1 / h);
      mat.uniforms.uPx.value = pixelRatio;
      LOOK.uDotPx.value = 3.6 * pixelRatio;
    },
    dispose() {
      target.dispose();
      mat.dispose();
      geo.dispose();
    },
  };
}
