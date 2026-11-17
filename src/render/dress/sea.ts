/**
 * The sea's wave print: white halftone dots in bands that drift with time, laid over the flat
 * teal water ground. One mesh and one draw call for the whole sea. Shares the look's uniforms so
 * it fogs and tints with the time of day like every other ink.
 */
import * as THREE from 'three';
import type { World } from '../../sim/world';
import { MeshBuilder } from '../geom';
import { LOOK } from '../look';
import { meshSea } from './terrain';

export interface Sea {
  mesh: THREE.Mesh;
  /** Seconds of drift. */
  setTime(seconds: number): void;
  dispose(): void;
}

const SEA_VERT = /* glsl */ `
  varying vec3 vWorld;
  varying float vDepth;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mv = viewMatrix * wp;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const SEA_FRAG = /* glsl */ `
  uniform vec3 uLitTint;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uDotPx;
  uniform float uTime;
  varying vec3 vWorld;
  varying float vDepth;
  float halftone(vec2 frag, float pitch, float darkness) {
    const mat2 R = mat2(0.8660254, -0.5, 0.5, 0.8660254);
    vec2 p = R * frag / pitch;
    vec2 c = fract(p) - 0.5;
    float r = 0.74 * sqrt(clamp(darkness, 0.0, 1.0));
    float aa = 0.9 / pitch;
    return 1.0 - smoothstep(r - aa, r + aa, length(c));
  }
  void main() {
    // Long swells rolling toward the quay, wobbling along the shore.
    float phase = vWorld.z * 0.42 + uTime * 0.9 + sin(vWorld.x * 0.07 + uTime * 0.25) * 2.2;
    float band = smoothstep(0.35, 0.95, sin(phase));
    float dots = halftone(gl_FragCoord.xy, uDotPx * 1.25, band * 0.75);
    if (dots < 0.5) discard;
    vec3 col = vec3(0.98, 0.965, 0.93) * uLitTint;
    float fog = smoothstep(uFogNear, uFogFar, vDepth);
    gl_FragColor = vec4(mix(col, uFogColor, fog * 0.92), 1.0);
  }
`;

export function createSea(w: World): Sea | null {
  const b = new MeshBuilder();
  if (!meshSea(b, w)) return null;
  const geo = b.build();
  const uTime = { value: 0 };
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uLitTint: LOOK.uLitTint,
      uFogColor: LOOK.uFogColor,
      uFogNear: LOOK.uFogNear,
      uFogFar: LOOK.uFogFar,
      uDotPx: LOOK.uDotPx,
      uTime,
    },
    vertexShader: SEA_VERT,
    fragmentShader: SEA_FRAG,
    // Lies exactly on the water ground: pull it forward in depth instead of lifting it.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  mat.name = 'sea';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sea';
  return {
    mesh,
    setTime(seconds) {
      uTime.value = seconds % 4096;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
