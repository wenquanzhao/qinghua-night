import * as THREE from 'three';
import type { QualityName } from '../game/settings';

/**
 * Night rendering for 青桦一夜.
 * Technique (procedural noise, cone lights in fog, quality-scaled grain)
 * follows the repo's rendering reference. Palette, place, and content do not.
 */

export interface QualityProfile {
  id: QualityName;
  scale: number;
  snow: number;
  post: boolean;
  grain: number;
  vignette: number;
  samples: number;
}

export const PROFILES: Record<QualityName, QualityProfile> = {
  low: { id: 'low', scale: 0.7, snow: 220, post: false, grain: 0, vignette: 0.28, samples: 0 },
  mid: { id: 'mid', scale: 1, snow: 680, post: true, grain: 0.04, vignette: 0.4, samples: 0 },
  high: { id: 'high', scale: 1.35, snow: 1300, post: true, grain: 0.055, vignette: 0.48, samples: 2 },
};

export function detectQuality(): QualityName {
  const cores = navigator.hardwareConcurrency || 8;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  if (coarse && cores <= 6) return 'low';
  return 'mid';
}

export interface ConeLight {
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  color: THREE.Color;
  range: number;
  /** Cosine of the cone angle. Below -0.2 the lamp is a point light. */
  angle: number;
  intensity: number;
}

function makeNoise(): THREE.DataTexture {
  const data = new Uint8Array(256 * 256 * 4);
  let t = 2654435769;
  const next = () => {
    t ^= t << 13;
    t >>>= 0;
    t ^= t >>> 17;
    t ^= t << 5;
    t >>>= 0;
    return t / 4294967296;
  };
  for (let i = 0; i < 256 * 256; i++) {
    const n = Math.floor(next() * 256);
    data[i * 4] = n;
    data[i * 4 + 1] = n;
    data[i * 4 + 2] = n;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, 256, 256, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
WHITE.needsUpdate = true;
WHITE.colorSpace = THREE.NoColorSpace;

export class NightField {
  readonly lights: ConeLight[] = Array.from({ length: 4 }, () => ({
    pos: new THREE.Vector3(),
    dir: new THREE.Vector3(0, 0, 1),
    color: new THREE.Color(1, 1, 1),
    range: 1,
    angle: -1,
    intensity: 0,
  }));
  time = 0;
  damage = 0;
  readonly uniforms: { [key: string]: THREE.IUniform };

  constructor() {
    const u: { [key: string]: THREE.IUniform } = {
      uTime: { value: 0 },
      uAmbient: { value: new THREE.Color(0.07, 0.086, 0.11) },
      uFogColor: { value: new THREE.Color(0.055, 0.068, 0.086) },
      uFogDensity: { value: 0.0115 },
      uMode: { value: 0 },
      uHasMap: { value: 0 },
      tMap: { value: WHITE },
      tNoise: { value: makeNoise() },
    };
    for (let i = 0; i < 4; i++) {
      u[`uLP${i}`] = { value: this.lights[i].pos };
      u[`uLD${i}`] = { value: this.lights[i].dir };
      u[`uLC${i}`] = { value: this.lights[i].color };
    }
    u.uLRange = { value: new THREE.Vector4() };
    u.uLCos = { value: new THREE.Vector4() };
    u.uLInt = { value: new THREE.Vector4() };
    this.uniforms = u;
  }

  upload(): void {
    const r = this.uniforms.uLRange.value as THREE.Vector4;
    const c = this.uniforms.uLCos.value as THREE.Vector4;
    const n = this.uniforms.uLInt.value as THREE.Vector4;
    const keys = ['x', 'y', 'z', 'w'] as const;
    for (let i = 0; i < 4; i++) {
      const k = keys[i];
      r[k] = this.lights[i].range;
      c[k] = this.lights[i].angle;
      n[k] = this.lights[i].intensity;
    }
    this.uniforms.uTime.value = this.time;
  }

  zero(): void {
    for (const lamp of this.lights) lamp.intensity = 0;
  }
}

const NOISE = /* glsl */ `
float n2(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return texture2D(tNoise, (i + f + 0.5) / 256.0).r;
}
`;

const LAMPS = /* glsl */ `
uniform vec3 uLP0, uLP1, uLP2, uLP3;
uniform vec3 uLD0, uLD1, uLD2, uLD3;
uniform vec3 uLC0, uLC1, uLC2, uLC3;
uniform vec4 uLRange, uLCos, uLInt;
uniform vec3 uAmbient, uFogColor;
uniform float uFogDensity, uMode, uHasMap, uTime;

vec3 lamp(vec3 pos, vec3 N, vec3 V, vec3 albedo, vec3 lp, vec3 ld, vec3 lc, float range, float cosA, float inten){
  if (inten < 0.001 || range < 0.1) return vec3(0.0);
  vec3 toL = pos - lp;
  float dist = length(toL);
  vec3 L = toL / max(dist, 0.001);
  float spot = 1.0;
  if (cosA > -0.2) {
    float ang = dot(L, normalize(ld));
    spot = smoothstep(cosA, mix(cosA, 1.0, 0.5), ang);
  }
  float att = pow(clamp(1.0 - dist / range, 0.0, 1.0), 1.35);
  float diff = max(dot(N, L), 0.0);
  float spec = pow(max(dot(N, normalize(L + V)), 0.0), 28.0);
  return lc * inten * spot * att * (albedo * diff + spec * 0.45);
}

vec3 shade(vec3 pos, vec3 N, vec3 albedo){
  vec3 V = normalize(cameraPosition - pos);
  float up = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = albedo * mix(uAmbient * 0.45, uAmbient, up);
  col += lamp(pos, N, V, albedo, uLP0, uLD0, uLC0, uLRange.x, uLCos.x, uLInt.x);
  col += lamp(pos, N, V, albedo, uLP1, uLD1, uLC1, uLRange.y, uLCos.y, uLInt.y);
  col += lamp(pos, N, V, albedo, uLP2, uLD2, uLC2, uLRange.z, uLCos.z, uLInt.z);
  col += lamp(pos, N, V, albedo, uLP3, uLD3, uLC3, uLRange.w, uLCos.w, uLInt.w);
  float dist = length(cameraPosition - pos);
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
  return col;
}
`;

const VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vColor;
varying vec2 vUv;
void main(){
  vUv = uv;
  vColor = color;
  #ifdef USE_INSTANCING
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  #else
    vec4 world = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
  #endif
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vColor;
varying vec2 vUv;
uniform sampler2D tMap;
uniform sampler2D tNoise;
${NOISE}
${LAMPS}

vec3 surface(vec3 world, vec3 base){
  float kind = uMode;
  if (kind < 0.5) return base;
  float n = n2(world.xz * 0.09);
  if (kind < 1.5) {
    vec3 asphalt = vec3(0.04, 0.043, 0.05);
    float streak = n2(vec2(world.x * 0.55, world.z * 0.03));
    asphalt += vec3(0.012, 0.013, 0.016) * streak;
    float edge = smoothstep(2.85, 3.2, abs(world.x)) * (1.0 - smoothstep(3.35, 3.8, abs(world.x)));
    asphalt = mix(asphalt, vec3(0.62, 0.6, 0.5), edge * 0.92);
    float dash = step(0.55, fract(world.z * 0.15));
    float center = (1.0 - smoothstep(0.02, 0.1, abs(world.x))) * dash;
    asphalt = mix(asphalt, vec3(0.75, 0.66, 0.32), center * 0.8);
    float track = smoothstep(0.22, 0.0, abs(abs(world.x) - 1.15)) + smoothstep(0.22, 0.0, abs(abs(world.x) - 2.25));
    asphalt *= 1.0 - track * 0.28;
    float slush = smoothstep(0.55, 0.84, n2(world.xz * 0.17));
    slush *= smoothstep(0.55, 2.5, abs(world.x));
    asphalt = mix(asphalt, vec3(0.64, 0.68, 0.72), slush * 0.82);
    return asphalt * (0.92 + 0.08 * n);
  }
  if (kind < 2.5) {
    vec3 snow = vec3(0.42, 0.46, 0.5);
    return snow * (0.82 + 0.22 * n);
  }
  if (kind < 3.5) {
    return vec3(0.55, 0.62, 0.68) * (0.85 + 0.15 * n);
  }
  if (kind < 4.5) {
    return vec3(0.03, 0.045, 0.06);
  }
  return vec3(0.02, 0.025, 0.03) * (0.7 + 0.3 * n);
}

void main(){
  vec3 N = normalize(vN);
  vec3 albedo = vColor;
  if (uHasMap > 0.5) albedo = pow(texture2D(tMap, vUv).rgb, vec3(2.2));
  albedo = surface(vWorld, albedo);
  if (uMode > 0.5 && uMode < 1.5) {
    float wet = n2(vWorld.xz * 0.35);
    albedo = mix(albedo, albedo * 0.65 + vec3(0.02), smoothstep(0.45, 0.8, wet));
  }
  vec3 col = shade(vWorld, N, albedo);
  if (uMode > 0.5 && uMode < 1.5) {
    float dash = step(0.36, fract(vWorld.z * 0.1));
    dash *= 1.0 - smoothstep(0.07, 0.2, abs(vWorld.x));
    col = mix(col, vec3(0.95, 0.76, 0.28), dash * 0.8);
    float edgeLine = smoothstep(2.65, 2.9, abs(vWorld.x)) * (1.0 - smoothstep(3.15, 3.5, abs(vWorld.x)));
    col = mix(col, vec3(0.92, 0.9, 0.8), edgeLine * 0.7);
    float slush = smoothstep(0.58, 0.88, n2(vWorld.xz * 0.1 + vec2(2.0, 0.4)));
    slush *= smoothstep(1.15, 3.3, abs(vWorld.x));
    col = mix(col, vec3(0.86, 0.9, 0.94), slush * 0.62);
  } else if (uMode > 1.5 && uMode < 2.5) {
    float drift = n2(vWorld.xz * 0.06);
    col = mix(col, vec3(0.78, 0.84, 0.9), smoothstep(0.35, 0.75, drift) * 0.4);
  }
  gl_FragColor = vec4(pow(max(col, 0.0), vec3(0.4545)), 1.0);
}
`;

export function createLitMaterial(field: NightField): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: field.uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    vertexColors: true,
  });
}

export function paint(geo: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const count = geo.getAttribute('position').count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

export function meshBox(mat: THREE.Material, w: number, h: number, d: number, color: number): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  paint(geo, new THREE.Color(color));
  return new THREE.Mesh(geo, mat);
}

const EMISSIVE_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uGain;
void main(){
  vec3 col = uColor * uGain;
  gl_FragColor = vec4(pow(max(col, 0.0), vec3(0.4545)), 1.0);
}
`;

export function emissiveMaterial(color: number, gain = 2): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uGain: { value: gain },
    },
    vertexShader: /* glsl */ `
      void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: EMISSIVE_FRAG,
    toneMapped: false,
  });
}

export function createSky(field: NightField): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: field.uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){
        vDir = position;
        vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vDir;
      uniform vec3 uLD0, uLD1, uLC0, uLC1, uFogColor;
      uniform vec4 uLInt;
      uniform float uTime;
      uniform sampler2D tNoise;
      ${NOISE}
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 zen = vec3(0.008, 0.012, 0.024);
        vec3 hor = uFogColor * 1.35;
        vec3 col = mix(hor, zen, smoothstep(0.0, 0.55, h));
        float bank = pow(max(dot(normalize(d.xz + vec2(1e-4)), normalize(vec2(0.92, 0.28))), 0.0), 10.0);
        bank *= 1.0 - smoothstep(0.0, 0.22, d.y);
        col += vec3(0.42, 0.24, 0.08) * bank * 0.55;
        float star = step(0.992, n2(d.xy * 18.0 + d.zx * 9.0)) * smoothstep(0.18, 0.5, h);
        col += vec3(0.75, 0.8, 0.9) * star * 0.55;
        float head = pow(max(dot(d, normalize(uLD0)), 0.0), 8.0) * uLInt.x;
        float flash = pow(max(dot(d, normalize(uLD1)), 0.0), 14.0) * uLInt.y;
        col += uLC0 * head * 0.08;
        col += uLC1 * flash * 0.12;
        if (d.y < 0.0) col = mix(col, uFogColor * 0.7, clamp(-d.y * 4.0, 0.0, 1.0));
        gl_FragColor = vec4(pow(max(col, 0.0), vec3(0.4545)), 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'night-sky';
  return mesh;
}

const SNOW_VERT = /* glsl */ `
uniform float uTime;
varying float vFog;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(90.0 / max(1.0, -mv.z), 1.2, 5.5);
  vFog = clamp(-mv.z / 36.0, 0.0, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;

const SNOW_FRAG = /* glsl */ `
precision highp float;
varying float vFog;
uniform vec3 uFogColor;
void main(){
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.12, d);
  vec3 col = mix(vec3(0.78, 0.82, 0.86), uFogColor, vFog);
  gl_FragColor = vec4(pow(col, vec3(0.4545)), a * (1.0 - vFog * 0.65));
}
`;

export class Snow {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private count = 0;

  constructor(field: NightField, max = 1400) {
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(max * 2), 2));
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: field.uniforms,
      vertexShader: SNOW_VERT,
      fragmentShader: SNOW_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  setCount(count: number): void {
    this.count = count;
    const geo = this.points.geometry;
    geo.setDrawRange(0, count);
    for (let i = 0; i < count; i++) this.respawn(i, true);
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  private respawn(i: number, anywhere: boolean): void {
    this.pos[i * 3] = (Math.random() - 0.5) * 36;
    this.pos[i * 3 + 1] = anywhere ? Math.random() * 16 - 3 : 8 + Math.random() * 6;
    this.pos[i * 3 + 2] = (Math.random() - 0.5) * 36;
    this.vel[i] = 1.6 + Math.random() * 2.4;
  }

  update(dt: number): void {
    for (let i = 0; i < this.count; i++) {
      this.pos[i * 3] += dt * 0.7;
      this.pos[i * 3 + 1] -= dt * this.vel[i];
      this.pos[i * 3 + 2] += dt * 0.2;
      if (this.pos[i * 3 + 1] < -4 || Math.abs(this.pos[i * 3]) > 20) this.respawn(i, false);
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}

export function createBeam(): THREE.Mesh {
  const geo = new THREE.ConeGeometry(1, 1, 18, 1, true);
  geo.translate(0, -0.5, 0);
  geo.rotateX(Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(1, 0.86, 0.62) },
      uAlpha: { value: 0.16 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec3 vL;
      void main(){
        vL = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vL;
      uniform vec3 uColor;
      uniform float uAlpha;
      void main(){
        float along = clamp(-vL.z, 0.0, 1.0);
        float radial = length(vL.xy) / max(along, 0.05);
        float beam = (1.0 - smoothstep(0.05, 1.0, radial)) * (1.0 - along);
        beam *= exp(-along * 0.8);
        gl_FragColor = vec4(uColor, beam * uAlpha);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return mesh;
}

export function createPost(field: NightField): {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  material: THREE.ShaderMaterial;
} {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      uGrain: { value: 0.04 },
      uVignette: { value: 0.4 },
      uDamage: { value: 0 },
      uTime: field.uniforms.uTime,
    },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      uniform float uGrain, uVignette, uDamage, uTime;
      float hash(vec2 p){
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      void main(){
        vec3 col = texture2D(tDiffuse, vUv).rgb;
        vec2 seed = gl_FragCoord.xy + fract(uTime * vec2(7.1, 3.7)) * vec2(300.0, 170.0);
        float g = hash(seed) - 0.5;
        col += g * uGrain;
        vec2 q = vUv - 0.5;
        float vig = smoothstep(0.25, 0.85, length(q * vec2(1.15, 1.35)));
        col *= 1.0 - vig * uVignette;
        float edge = smoothstep(0.2, 0.9, length(q * 1.4));
        col = mix(col, col * vec3(0.55, 0.62, 0.72), clamp(uDamage, 0.0, 1.0) * edge);
        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
      }
    `,
  });
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(quad);
  return { scene, camera, material };
}

export function signMaterial(field: NightField, tex: THREE.Texture): THREE.ShaderMaterial {
  const uniforms: { [key: string]: THREE.IUniform } = { ...field.uniforms, uHasMap: { value: 1 }, tMap: { value: tex }, uMode: { value: 0 } };
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
}

export function tagMode(mesh: THREE.Object3D, field: NightField, mode: number): void {
  mesh.onBeforeRender = () => {
    field.uniforms.uMode.value = mode;
  };
  mesh.onAfterRender = () => {
    field.uniforms.uMode.value = 0;
  };
}

const WINDOW_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
varying vec3 vWorld;
void main(){
  float tw = 0.55 + 0.45 * sin(uTime * 1.7 + vWorld.z * 0.15);
  float on = step(0.2, fract(sin(vWorld.z * 12.3 + vWorld.y * 4.0) * 43758.5));
  vec3 col = vec3(1.0, 0.68, 0.32) * tw * on * 1.4;
  gl_FragColor = vec4(pow(max(col, 0.0), vec3(0.4545)), 1.0);
}
`;

export function windowMaterial(field: NightField): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: field.uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main(){
        #ifdef USE_INSTANCING
          vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
        #else
          vec4 world = modelMatrix * vec4(position, 1.0);
        #endif
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: WINDOW_FRAG,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
}
