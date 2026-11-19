/**
 * Renderer, scene, lights and camera. No shadows.
 *
 * The canvas fills the viewport (CSS sizes it to 100vw x 100dvh) and the drawing buffer follows it
 * through a ResizeObserver, which covers window resizes, orientation changes and the mobile URL bar.
 *
 * A look (`look.ts`) may ask for one pass over the finished frame: the scene is then drawn into a
 * target with a depth texture and a single full-screen triangle pair turns that into the picture
 * (outlines where depth breaks, a sky gradient, chunky pixels, posterising and dither, halftone,
 * grain, vignette, saturation and contrast). A look that asks for none of it is drawn straight to
 * the canvas, as before, at no cost.
 */
import {
  AmbientLight,
  Color,
  DepthTexture,
  DirectionalLight,
  Fog,
  LinearFilter,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  UnsignedIntType,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { FEEL } from '../sim/constants';
import { LOOK_ID, PALETTE, STYLE, type Style } from './look';
import './look.css';

/** Highest device pixel ratio drawn at. */
export const MAX_PIXEL_RATIO = 2;
const NEAR = 0.1;
/** Past the fog nothing is visible, so nothing is drawn beyond a little more than it. */
const FAR = STYLE.fogFar * 1.5;
/** How far the sun sits from its target, m (only the direction matters for a directional light). */
const SUN_DISTANCE = 100;

/** Does this style need the pass over the finished frame? */
export function needsPass(s: Style): boolean {
  return (
    s.pixel > 1 ||
    s.outline > 0 ||
    s.skyTop >= 0 ||
    s.posterize > 0 ||
    s.halftone > 0 ||
    s.grain > 0 ||
    s.vignette > 0 ||
    s.saturation !== 1 ||
    s.contrast !== 1
  );
}

/** The size of the target the scene is drawn into, for a canvas of w x h CSS px at `ratio`. */
export function targetSize(w: number, h: number, ratio: number, pixel: number, out: { w: number; h: number }): void {
  if (pixel > 1) {
    out.w = Math.max(1, Math.round(w / pixel));
    out.h = Math.max(1, Math.round(h / pixel));
  } else {
    out.w = Math.max(1, Math.round(w * ratio));
    out.h = Math.max(1, Math.round(h * ratio));
  }
}

const PASS_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const PASS_FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uNear;
uniform float uFar;
uniform float uFogNear;
uniform float uFogFar;
uniform float uOutline;
uniform float uOutlineWidth;
uniform vec3 uOutlineColor;
uniform float uSky;
uniform vec3 uSkyTop;
uniform vec3 uSkyLow;
uniform float uHorizon;
uniform float uPosterize;
uniform float uDither;
uniform float uHalftone;
uniform float uGrain;
uniform float uVignette;
uniform float uSaturation;
uniform float uContrast;
uniform float uAspect;
varying vec2 vUv;

vec3 toDisplay(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

float bayer(vec2 p) {
  // 4x4 ordered dither, 0..1.
  vec2 a = floor(mod(p, 4.0));
  float m = mod(a.x + a.y * 2.0, 4.0) * 4.0 + mod(a.x * 3.0 + a.y, 4.0);
  return (m + 0.5) / 16.0;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec3 col = toDisplay(texture2D(tColor, vUv).rgb);
  float d = texture2D(tDepth, vUv).x;
  vec2 px = floor(vUv / uTexel);

  // The sky: from the horizon's haze up to the top colour.
  if (uSky > 0.5 && d >= 0.9999995) {
    float t = smoothstep(uHorizon, uHorizon + 0.55, vUv.y);
    col = mix(uSkyLow, uSkyTop, t);
  }

  if (uOutline > 0.0) {
    vec2 o = uTexel * uOutlineWidth;
    float l = texture2D(tDepth, vUv - vec2(o.x, 0.0)).x;
    float r = texture2D(tDepth, vUv + vec2(o.x, 0.0)).x;
    float u = texture2D(tDepth, vUv + vec2(0.0, o.y)).x;
    float b = texture2D(tDepth, vUv - vec2(0.0, o.y)).x;
    // Buffer depth is flat across a plane, so its second difference is zero on the ground and
    // jumps only where one thing stands in front of another.
    float lap = abs(l + r - 2.0 * d) + abs(u + b - 2.0 * d);
    float dn = min(d, min(min(l, r), min(u, b)));
    float z = uNear * uFar / (uFar - dn * (uFar - uNear));
    float jump = lap * z * z * (uFar - uNear) / (uFar * uNear);
    float e = smoothstep(0.03, 0.09, jump / z);
    // Lost in the fog with everything else.
    e *= 1.0 - smoothstep(uFogNear, uFogFar * 0.8, z);
    col = mix(col, uOutlineColor, e * uOutline);
  }

  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uSaturation);
  col = (col - 0.5) * uContrast + 0.5;

  if (uHalftone > 0.0) {
    // Dots of darker ink, bigger where the picture is darker.
    vec2 q = mat2(0.7071, -0.7071, 0.7071, 0.7071) * px / 5.0;
    float dist = length(fract(q) - 0.5);
    float size = 0.62 * (1.0 - clamp(lum * 1.6, 0.0, 1.0));
    float ink = 1.0 - smoothstep(size - 0.08, size + 0.08, dist);
    col *= 1.0 - 0.38 * ink * uHalftone;
  }

  if (uPosterize > 0.0) {
    col = floor(col * uPosterize + 0.5 + (bayer(px) - 0.5) * uDither) / uPosterize;
  }

  if (uGrain > 0.0) col += (hash(px) - 0.5) * 0.09 * uGrain;

  if (uVignette > 0.0) {
    vec2 c = (vUv - 0.5) * vec2(1.0, 1.0 / max(uAspect, 0.001)) * 2.0;
    float v = smoothstep(0.75, 1.9, length(c));
    col *= 1.0 - v * uVignette;
  }

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

interface Pass {
  target: WebGLRenderTarget;
  scene: Scene;
  camera: OrthographicCamera;
  material: ShaderMaterial;
}

export class GameScene {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  private readonly canvas: HTMLCanvasElement;
  private readonly observer: ResizeObserver | null;
  private readonly pass: Pass | null;
  private readonly size = { w: 1, h: 1 };
  private readonly look = new Vector3();
  private width = 0;
  private height = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const pass = needsPass(STYLE);
    // With the pass the scene is smoothed in its own target (or is meant to be blocky).
    this.renderer = new WebGLRenderer({ canvas, antialias: !pass, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = false;
    this.renderer.setClearColor(PALETTE.sky, 1);
    // Counted over the whole frame, pass included: reset by hand in `render`.
    this.renderer.info.autoReset = false;
    if (STYLE.pixel > 1) canvas.style.imageRendering = 'pixelated';
    // The overlay styles itself by these.
    const root = canvas.ownerDocument.documentElement;
    root.dataset.look = LOOK_ID;
    root.dataset.ui = STYLE.lightUi ? 'light' : 'dark';

    this.scene = new Scene();
    this.scene.background = new Color(PALETTE.sky);
    this.scene.fog = new Fog(PALETTE.fog, STYLE.fogNear, STYLE.fogFar);

    // A directional light: only the direction from its target to it matters.
    const sun = new DirectionalLight(PALETTE.sun, STYLE.sunIntensity);
    sun.position.set(STYLE.sunDir.x * SUN_DISTANCE, STYLE.sunDir.y * SUN_DISTANCE, STYLE.sunDir.z * SUN_DISTANCE);
    this.scene.add(sun, sun.target);
    this.scene.add(new AmbientLight(PALETTE.ambient, STYLE.ambientIntensity));

    this.camera = new PerspectiveCamera(FEEL.camFov, 1, NEAR, FAR);
    this.pass = pass ? makePass() : null;

    this.resize();
    this.observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
    if (this.observer) this.observer.observe(canvas);
    else window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => this.resize());
  }

  /** Match the drawing buffer and the camera to the canvas's CSS size. */
  resize(): void {
    const w = Math.max(1, Math.round(this.canvas.clientWidth || window.innerWidth));
    const h = Math.max(1, Math.round(this.canvas.clientHeight || window.innerHeight));
    const ratio = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);
    if (w === this.width && h === this.height && this.renderer.getPixelRatio() === ratio) return;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const p = this.pass;
    if (p) {
      targetSize(w, h, ratio, STYLE.pixel, this.size);
      p.target.setSize(this.size.w, this.size.h);
      const u = p.material.uniforms;
      (u.uTexel.value as Vector2).set(1 / this.size.w, 1 / this.size.h);
      u.uAspect.value = w / h;
    }
  }

  render(): void {
    const r = this.renderer;
    r.info.reset();
    const p = this.pass;
    if (!p) {
      r.render(this.scene, this.camera);
      return;
    }
    p.material.uniforms.uHorizon.value = this.horizon();
    r.setRenderTarget(p.target);
    r.render(this.scene, this.camera);
    r.setRenderTarget(null);
    r.render(p.scene, p.camera);
  }

  /** How far up the screen the horizon is, 0 (bottom) to 1 (top); beyond that range when it is out of frame. */
  private horizon(): number {
    const cam = this.camera;
    const v = this.look;
    cam.getWorldDirection(v);
    const flat = Math.sqrt(v.x * v.x + v.z * v.z);
    if (flat < 1e-4) return v.y < 0 ? 2 : -1;
    v.set(cam.position.x + (v.x / flat) * 1000, cam.position.y, cam.position.z + (v.z / flat) * 1000);
    v.project(cam);
    return v.y * 0.5 + 0.5;
  }
}

function makePass(): Pass {
  const blocky = STYLE.pixel > 1;
  const depth = new DepthTexture(1, 1, UnsignedIntType);
  depth.minFilter = NearestFilter;
  depth.magFilter = NearestFilter;
  const target = new WebGLRenderTarget(1, 1, {
    depthTexture: depth,
    depthBuffer: true,
    samples: blocky ? 0 : 4,
    minFilter: blocky ? NearestFilter : LinearFilter,
    magFilter: blocky ? NearestFilter : LinearFilter,
    generateMipmaps: false,
  });
  // Stored display-encoded, so the dark end keeps its steps; sampling gives linear back.
  target.texture.colorSpace = SRGBColorSpace;

  const top = new Color(STYLE.skyTop >= 0 ? STYLE.skyTop : PALETTE.sky);
  const low = new Color(PALETTE.fog);
  const line = new Color(STYLE.outlineColor);
  const material = new ShaderMaterial({
    vertexShader: PASS_VERTEX,
    fragmentShader: PASS_FRAGMENT,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      tColor: { value: target.texture },
      tDepth: { value: depth },
      uTexel: { value: new Vector2(1, 1) },
      uNear: { value: NEAR },
      uFar: { value: FAR },
      uFogNear: { value: STYLE.fogNear },
      uFogFar: { value: STYLE.fogFar },
      uOutline: { value: STYLE.outline },
      uOutlineWidth: { value: STYLE.outlineWidth },
      // Display values: the pass works on the picture as the eye gets it.
      uOutlineColor: { value: new Vector3(...displayOf(line)) },
      uSky: { value: STYLE.skyTop >= 0 ? 1 : 0 },
      uSkyTop: { value: new Vector3(...displayOf(top)) },
      uSkyLow: { value: new Vector3(...displayOf(low)) },
      uHorizon: { value: 0.6 },
      uPosterize: { value: STYLE.posterize },
      uDither: { value: STYLE.dither },
      uHalftone: { value: STYLE.halftone },
      uGrain: { value: STYLE.grain },
      uVignette: { value: STYLE.vignette },
      uSaturation: { value: STYLE.saturation },
      uContrast: { value: STYLE.contrast },
      uAspect: { value: 1 },
    },
  });
  const scene = new Scene();
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);
  return { target, scene, camera: new OrthographicCamera(-1, 1, 1, -1, 0, 1), material };
}

/** A colour's display (sRGB) components, 0..1. */
function displayOf(c: Color): [number, number, number] {
  const hex = c.getHex(SRGBColorSpace);
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}
