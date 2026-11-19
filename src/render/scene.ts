/**
 * Renderer, scene, lights and camera. No shadows, no post-processing.
 *
 * The canvas fills the viewport (CSS sizes it to 100vw x 100dvh) and the drawing buffer follows it
 * through a ResizeObserver, which covers window resizes, orientation changes and the mobile URL bar.
 */
import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { FEEL } from '../sim/constants';
import { AMBIENT_INTENSITY, FOG_FAR, FOG_NEAR, PALETTE, SUN_DIR, SUN_INTENSITY } from './look';

/** Highest device pixel ratio drawn at. */
export const MAX_PIXEL_RATIO = 2;
const NEAR = 0.1;
/** Past the fog nothing is visible, so nothing is drawn beyond a little more than it. */
const FAR = FOG_FAR * 1.5;
/** How far the sun sits from its target, m (only the direction matters for a directional light). */
const SUN_DISTANCE = 100;

export class GameScene {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  private readonly canvas: HTMLCanvasElement;
  private readonly observer: ResizeObserver | null;
  private width = 0;
  private height = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = false;
    this.renderer.setClearColor(PALETTE.sky, 1);

    this.scene = new Scene();
    this.scene.background = new Color(PALETTE.sky);
    this.scene.fog = new Fog(PALETTE.fog, FOG_NEAR, FOG_FAR);

    // A directional light: only the direction from its target to it matters.
    const sun = new DirectionalLight(PALETTE.sun, SUN_INTENSITY);
    sun.position.set(SUN_DIR.x * SUN_DISTANCE, SUN_DIR.y * SUN_DISTANCE, SUN_DIR.z * SUN_DISTANCE);
    this.scene.add(sun, sun.target);
    this.scene.add(new AmbientLight(PALETTE.ambient, AMBIENT_INTENSITY));

    this.camera = new PerspectiveCamera(FEEL.camFov, 1, NEAR, FAR);

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
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
