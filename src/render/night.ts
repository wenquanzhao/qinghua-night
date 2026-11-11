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
  /** Octave noise, wet beads, normal wobble. Off on low. */
  detail: number;
  /** Cone light scattered in the fog. Off on low. */
  vol: number;
}

export const PROFILES: Record<QualityName, QualityProfile> = {
  low: { id: 'low', scale: 0.7, snow: 280, post: false, grain: 0, vignette: 0.28, samples: 0, detail: 0, vol: 0 },
  mid: { id: 'mid', scale: 1, snow: 900, post: true, grain: 0.045, vignette: 0.42, samples: 0, detail: 1, vol: 1 },
  high: { id: 'high', scale: 1.25, snow: 1600, post: true, grain: 0.06, vignette: 0.5, samples: 2, detail: 1, vol: 1 },
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
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
WHITE.needsUpdate = true;
WHITE.colorSpace = THREE.NoColorSpace;

export class NightField {
  readonly lights: ConeLight[] = Array.from({ length: 8 }, () => ({
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
      uIndoor: { value: 0 },
      uDetail: { value: 1 },
      uVol: { value: 1 },
      uMode: { value: 0 },
      uHasMap: { value: 0 },
      tMap: { value: WHITE },
      tNoise: { value: makeNoise() },
    };
    for (let i = 0; i < 8; i++) {
      u[`uLP${i}`] = { value: this.lights[i].pos };
      u[`uLD${i}`] = { value: this.lights[i].dir };
      u[`uLC${i}`] = { value: this.lights[i].color };
    }
    u.uLRange = { value: new THREE.Vector4() };
    u.uLCos = { value: new THREE.Vector4() };
    u.uLInt = { value: new THREE.Vector4() };
    u.uLRangeB = { value: new THREE.Vector4() };
    u.uLCosB = { value: new THREE.Vector4() };
    u.uLIntB = { value: new THREE.Vector4() };
    this.uniforms = u;
  }

  upload(): void {
    const keys = ['x', 'y', 'z', 'w'] as const;
    const write = (range: THREE.Vector4, angle: THREE.Vector4, intensity: THREE.Vector4, offset: number) => {
      for (let i = 0; i < 4; i++) {
        const k = keys[i];
        range[k] = this.lights[offset + i].range;
        angle[k] = this.lights[offset + i].angle;
        intensity[k] = this.lights[offset + i].intensity;
      }
    };
    write(this.uniforms.uLRange.value as THREE.Vector4, this.uniforms.uLCos.value as THREE.Vector4, this.uniforms.uLInt.value as THREE.Vector4, 0);
    write(this.uniforms.uLRangeB.value as THREE.Vector4, this.uniforms.uLCosB.value as THREE.Vector4, this.uniforms.uLIntB.value as THREE.Vector4, 4);
    this.uniforms.uTime.value = this.time;
  }

  /** Road fog and ambient. Chapters that change the night put it back on dispose. */
  resetMood(): void {
    (this.uniforms.uAmbient.value as THREE.Color).set(0.07, 0.086, 0.11);
    (this.uniforms.uFogColor.value as THREE.Color).set(0.055, 0.068, 0.086);
    this.uniforms.uFogDensity.value = 0.0115;
    this.uniforms.uIndoor.value = 0;
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
  vec2 uv = (i + 0.5) / 256.0;
  vec2 dx = vec2(1.0 / 256.0, 0.0);
  vec2 dy = vec2(0.0, 1.0 / 256.0);
  float a = texture2D(tNoise, uv).r;
  float b = texture2D(tNoise, uv + dx).r;
  float c = texture2D(tNoise, uv + dy).r;
  float d = texture2D(tNoise, uv + dx + dy).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm3(vec2 p){
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 3; i++) {
    s += a * n2(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 17.3;
    a *= 0.5;
  }
  return s / 0.875;
}
`;

const LAMPS = /* glsl */ `
uniform vec3 uLP0, uLP1, uLP2, uLP3, uLP4, uLP5, uLP6, uLP7;
uniform vec3 uLD0, uLD1, uLD2, uLD3, uLD4, uLD5, uLD6, uLD7;
uniform vec3 uLC0, uLC1, uLC2, uLC3, uLC4, uLC5, uLC6, uLC7;
uniform vec4 uLRange, uLCos, uLInt, uLRangeB, uLCosB, uLIntB;
uniform vec3 uAmbient, uFogColor;
uniform float uFogDensity, uMode, uHasMap, uTime, uDetail, uVol;

vec3 lamp(vec3 pos, vec3 N, vec3 V, vec3 albedo, float rough, float wet, vec3 lp, vec3 ld, vec3 lc, float range, float cosA, float inten){
  if (inten < 0.001 || range < 0.1) return vec3(0.0);
  vec3 toL = pos - lp;
  float dist = length(toL);
  vec3 L = toL / max(dist, 0.001);
  float spot = 1.0;
  if (cosA > -0.2) {
    float ang = dot(L, normalize(ld));
    spot = smoothstep(cosA, mix(cosA, 1.0, 0.55), ang);
  }
  float att = pow(clamp(1.0 - dist / range, 0.0, 1.0), 1.45);
  float ndl = max(dot(N, L), 0.0);
  float wrap = max(dot(N, L) * 0.65 + 0.35, 0.0);
  float diff = mix(ndl, wrap, 0.35);
  vec3 H = normalize(L + V);
  float specPow = mix(10.0, 96.0, clamp(1.0 - rough, 0.0, 1.0));
  float spec = pow(max(dot(N, H), 0.0), specPow) * (0.04 + wet * 0.85);
  return lc * inten * spot * att * (albedo * diff + spec);
}

vec3 volCone(vec3 pos, vec3 lp, vec3 ld, vec3 lc, float range, float cosA, float inten){
  if (uVol < 0.5 || inten < 0.08 || range < 0.2) return vec3(0.0);
  vec3 toF = pos - cameraPosition;
  float dist = length(toF);
  vec3 V = toF / max(dist, 0.001);
  vec3 acc = vec3(0.0);
  float reach = min(dist, range);
  for (int i = 1; i <= 2; i++) {
    vec3 p = cameraPosition + V * (reach * float(i) / 3.0);
    vec3 toL = p - lp;
    float ldn = length(toL);
    vec3 L = toL / max(ldn, 0.001);
    float spot = 1.0;
    if (cosA > -0.2) spot = smoothstep(cosA, mix(cosA, 1.0, 0.4), dot(L, normalize(ld)));
    float att = pow(clamp(1.0 - ldn / range, 0.0, 1.0), 1.5);
    acc += lc * inten * spot * att;
  }
  return acc * 0.012;
}

vec3 shade(vec3 pos, vec3 N, vec3 albedo, float rough, float wet){
  vec3 V = normalize(cameraPosition - pos);
  float up = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 sky = mix(uFogColor, vec3(0.03, 0.04, 0.07), up);
  vec3 col = albedo * (uAmbient * mix(0.55, 1.0, up) + sky * 0.08 * up);
  col += lamp(pos, N, V, albedo, rough, wet, uLP0, uLD0, uLC0, uLRange.x, uLCos.x, uLInt.x);
  col += lamp(pos, N, V, albedo, rough, wet, uLP1, uLD1, uLC1, uLRange.y, uLCos.y, uLInt.y);
  col += lamp(pos, N, V, albedo, rough, wet, uLP2, uLD2, uLC2, uLRange.z, uLCos.z, uLInt.z);
  col += lamp(pos, N, V, albedo, rough, wet, uLP3, uLD3, uLC3, uLRange.w, uLCos.w, uLInt.w);
  col += lamp(pos, N, V, albedo, rough, wet, uLP4, uLD4, uLC4, uLRangeB.x, uLCosB.x, uLIntB.x);
  col += lamp(pos, N, V, albedo, rough, wet, uLP5, uLD5, uLC5, uLRangeB.y, uLCosB.y, uLIntB.y);
  col += lamp(pos, N, V, albedo, rough, wet, uLP6, uLD6, uLC6, uLRangeB.z, uLCosB.z, uLIntB.z);
  col += lamp(pos, N, V, albedo, rough, wet, uLP7, uLD7, uLC7, uLRangeB.w, uLCosB.w, uLIntB.w);
  col += volCone(pos, uLP0, uLD0, uLC0, uLRange.x, uLCos.x, uLInt.x);
  col += volCone(pos, uLP1, uLD1, uLC1, uLRange.y, uLCos.y, uLInt.y);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += uFogColor * rim * 0.22;
  float dist = length(cameraPosition - pos);
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, clamp(fog, 0.0, 0.92));
  return col;
}

vec3 grade(vec3 col){
  col *= 1.18;
  col = clamp((col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14), 0.0, 1.0);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col *= mix(vec3(0.80, 0.93, 1.08), vec3(1.08, 1.0, 0.86), smoothstep(0.04, 0.5, l));
  return pow(max(col, 0.0), vec3(0.4545));
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

float macro(vec2 p){
  return uDetail > 0.5 ? fbm3(p) : n2(p);
}

float rough;
float wet;
vec3 surface(vec3 world, vec3 N, vec3 base){
  float kind = uMode;
  float n = macro(world.xz * 0.11);
  float up = smoothstep(0.05, 0.8, N.y);
  rough = 0.62;
  wet = up * 0.25;
  if (kind < 0.5) {
    float wear = macro(world.xz * 0.17 + world.yz * 0.08);
    vec3 alb = base * (0.78 + 0.28 * wear);
    wet = up * (0.35 + 0.4 * smoothstep(0.55, 0.85, n2(world.xz * 0.42)));
    alb = mix(alb, alb * 0.55 + vec3(0.015, 0.018, 0.02), wet);
    rough = mix(0.72, 0.18, wet);
    return alb;
  }
  if (kind < 1.5) {
    vec3 asphalt = vec3(0.045, 0.048, 0.055);
    asphalt += vec3(0.012) * n2(vec2(world.x * 0.55, world.z * 0.035));
    float edge = smoothstep(2.85, 3.15, abs(world.x)) * (1.0 - smoothstep(3.25, 3.7, abs(world.x)));
    asphalt = mix(asphalt, vec3(0.55, 0.52, 0.42), edge * 0.85);
    float track = smoothstep(0.18, 0.0, abs(abs(world.x) - 1.15)) + smoothstep(0.18, 0.0, abs(abs(world.x) - 2.2));
    asphalt *= 1.0 - track * 0.35;
    float puddle = smoothstep(0.48, 0.82, macro(world.xz * 0.23 + vec2(0.0, world.z * 0.01)));
    puddle *= smoothstep(3.3, 1.2, abs(world.x));
    float slush = smoothstep(0.62, 0.88, n2(world.xz * 0.16));
    slush *= smoothstep(0.7, 3.1, abs(world.x));
    asphalt = mix(asphalt, vec3(0.62, 0.66, 0.7), slush * 0.75);
    asphalt = mix(asphalt, vec3(0.02, 0.022, 0.028), puddle * 0.82);
    wet = clamp(puddle * 0.95 + 0.22, 0.0, 1.0);
    rough = mix(0.55, 0.07, wet);
    return asphalt;
  }
  if (kind < 2.5) {
    vec3 snow = vec3(0.55, 0.58, 0.62) * (0.84 + 0.22 * n);
    rough = 0.78;
    wet = 0.08;
    return snow;
  }
  if (kind < 3.5) {
    rough = 0.08;
    wet = 0.9;
    return vec3(0.62, 0.7, 0.76) * (0.86 + 0.16 * n);
  }
  if (kind < 4.5) {
    rough = 0.06;
    wet = 1.0;
    return vec3(0.025, 0.04, 0.055);
  }
  if (kind < 5.5) {
    rough = 0.85;
    wet = 0.15;
    return vec3(0.03, 0.035, 0.04) * (0.75 + 0.25 * n);
  }
  if (kind < 6.5) {
    vec3 concrete = vec3(0.09, 0.095, 0.1);
    concrete += vec3(0.02) * (step(0.94, fract(world.x * 0.5)) + step(0.94, fract(world.z * 0.5)));
    float puddle = smoothstep(0.58, 0.88, macro(world.xz * 0.19));
    concrete = mix(concrete, vec3(0.03, 0.034, 0.04), puddle);
    wet = puddle * 0.9 + 0.15;
    rough = mix(0.62, 0.1, puddle);
    return concrete;
  }
  if (kind < 7.5) {
    vec3 wall = vec3(0.18, 0.19, 0.2);
    float stain = smoothstep(0.62, 0.92, macro(world.xy * 0.09 + world.zy * 0.05));
    float frost = smoothstep(2.15, 3.05, world.y) * smoothstep(0.35, 0.8, n2(world.xz * 0.12));
    float drip = 0.0;
    if (uDetail > 0.5) drip = smoothstep(0.55, 0.8, fbm3(vec2(world.x * 1.7 + world.z, world.y * 0.35)));
    wall = mix(wall, vec3(0.1, 0.11, 0.12), stain * 0.5);
    wall = mix(wall, wall * 0.7, drip * 0.45);
    wall = mix(wall, vec3(0.62, 0.66, 0.7), frost * 0.55);
    wet = drip * 0.35 + frost * 0.2;
    rough = mix(0.86, 0.35, wet);
    return wall;
  }
  if (kind < 8.5) {
    float brush = macro(world.xz * 0.7 + world.yz);
    float scratch = n2(vec2(world.x * 8.0, world.y * 2.0));
    vec3 metal = vec3(0.22, 0.24, 0.26) * (0.75 + 0.35 * brush);
    metal *= 0.85 + 0.15 * scratch;
    wet = up * 0.45;
    rough = mix(0.48, 0.16, wet);
    return metal;
  }
  vec3 cloth = base * (0.82 + 0.2 * n2(world.xy * 5.0 + world.yz * 2.0));
  float fold = smoothstep(0.42, 0.78, n2(world.xy * 3.0));
  cloth *= 0.82 + 0.18 * fold;
  wet = up * 0.22 + smoothstep(0.6, 0.9, n2(world.xy * 1.4)) * 0.18;
  cloth = mix(cloth, cloth * 0.78 + vec3(0.03), wet);
  rough = 0.82;
  return cloth;
}

void main(){
  vec3 N = normalize(vN);
  if (uDetail > 0.5 && uMode > 0.5 && uMode < 6.5) {
    float h = fbm3(vWorld.xz * 1.4);
    float hx = fbm3(vWorld.xz * 1.4 + vec2(0.12, 0.0));
    float hz = fbm3(vWorld.xz * 1.4 + vec2(0.0, 0.12));
    N = normalize(N + vec3(h - hx, 0.0, h - hz) * 2.4);
  }
  vec3 albedo = vColor;
  if (uHasMap > 0.5) albedo = pow(texture2D(tMap, vUv).rgb, vec3(2.2));
  albedo = surface(vWorld, N, albedo);
  vec3 col = shade(vWorld, N, albedo, rough, wet);
  if (uMode > 0.5 && uMode < 1.5) {
    float dash = step(0.42, fract(vWorld.z * 0.11));
    dash *= 1.0 - smoothstep(0.05, 0.16, abs(vWorld.x));
    col = mix(col, vec3(0.95, 0.72, 0.22), dash * 0.55);
    float edgeLine = smoothstep(2.7, 2.95, abs(vWorld.x)) * (1.0 - smoothstep(3.15, 3.45, abs(vWorld.x)));
    col = mix(col, vec3(0.9, 0.88, 0.78), edgeLine * 0.45);
  }
  if (wet > 0.45 && uMode < 8.5) {
    float bead = smoothstep(0.72, 0.92, n2(vWorld.xz * 3.5 + vWorld.yz * 0.4));
    col += vec3(0.85, 0.9, 1.0) * bead * wet * 0.35;
  }
  gl_FragColor = vec4(grade(max(col, 0.0)), 1.0);
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
        vec4 world = modelMatrix * vec4(position, 1.0);
        vDir = world.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * world;
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
        vec3 zen = vec3(0.01, 0.014, 0.028);
        vec3 hor = uFogColor * 1.55;
        float bank = pow(max(dot(normalize(d.xz + vec2(1e-4)), normalize(vec2(0.9, 0.25))), 0.0), 7.0);
        bank *= 1.0 - smoothstep(0.0, 0.32, d.y);
        hor += vec3(0.42, 0.2, 0.06) * bank;
        vec3 col = mix(hor, zen, smoothstep(0.0, 0.58, h));
        float cover = 0.0;
        if (h > 0.015) {
          vec2 q = d.xz / (h + 0.14) * 0.75 + vec2(-0.008, 0.003) * uTime;
          float dens = fbm3(q);
          float body = dens * 0.72 + n2(q * 0.21 + 3.0) * 0.28;
          cover = smoothstep(0.38, 0.78, body) * smoothstep(0.0, 0.22, h);
          vec3 cloud = vec3(0.045, 0.055, 0.075);
          cloud += vec3(0.38, 0.16, 0.05) * bank * (0.35 + dens);
          float head = pow(max(dot(d, normalize(uLD0)), 0.0), 5.0) * uLInt.x;
          float flash = pow(max(dot(d, normalize(uLD1)), 0.0), 9.0) * uLInt.y;
          cloud += uLC0 * head * 0.22 + uLC1 * flash * 0.4;
          col = mix(col, cloud, cover * 0.9);
        }
        float star = step(0.986, n2(d.xy * 36.0 + d.zx * 14.0));
        star *= (1.0 - cover) * smoothstep(0.22, 0.55, h);
        col += vec3(0.8, 0.86, 0.95) * star * 0.85;
        float head = pow(max(dot(d, normalize(uLD0)), 0.0), 7.0) * uLInt.x;
        float flash = pow(max(dot(d, normalize(uLD1)), 0.0), 12.0) * uLInt.y;
        col += uLC0 * head * 0.05 + uLC1 * flash * 0.08;
        if (d.y < 0.0) col = mix(col, uFogColor * 0.72, clamp(-d.y * 4.0, 0.0, 1.0));
        gl_FragColor = vec4(pow(max(col, 0.0), vec3(0.4545)), 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(80, 48, 32), mat);
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
uniform float uIndoor;
void main(){
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.12, d) * (1.0 - uIndoor * 0.94);
  if (a < 0.02) discard;
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

export function createBeam(field?: NightField): THREE.Mesh {
  const geo = new THREE.ConeGeometry(1, 1, 20, 1, true);
  geo.translate(0, -0.5, 0);
  geo.rotateX(Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(1, 0.86, 0.62) },
      uAlpha: { value: 0.16 },
      uTime: field ? field.uniforms.uTime : { value: 0 },
      tNoise: field ? field.uniforms.tNoise : { value: WHITE },
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
      uniform float uTime;
      uniform sampler2D tNoise;
      float n2(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        vec2 uv = (i + 0.5) / 256.0;
        vec2 dx = vec2(1.0 / 256.0, 0.0);
        vec2 dy = vec2(0.0, 1.0 / 256.0);
        float a = texture2D(tNoise, uv).r;
        float b = texture2D(tNoise, uv + dx).r;
        float c = texture2D(tNoise, uv + dy).r;
        float d = texture2D(tNoise, uv + dx + dy).r;
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      void main(){
        float along = clamp(-vL.z, 0.0, 1.0);
        float radial = length(vL.xy) / max(along, 0.04);
        float beam = (1.0 - smoothstep(0.02, 0.92, radial)) * (1.0 - along);
        float streak = n2(vec2(along * 7.0 - uTime * 0.35, radial * 3.0 + vL.x));
        beam *= 0.55 + streak * 0.9;
        beam *= exp(-along * 0.65);
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
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col *= mix(vec3(0.86, 0.95, 1.06), vec3(1.05, 1.0, 0.92), smoothstep(0.12, 0.62, l));
        col = mix(col, col * col * (3.0 - 2.0 * col), 0.18);
        vec2 seed = gl_FragCoord.xy + fract(uTime * vec2(7.1, 3.7)) * vec2(300.0, 170.0);
        float g = hash(seed) - 0.5;
        col += g * uGrain * (0.65 + l);
        vec2 q = vUv - 0.5;
        float vig = smoothstep(0.22, 0.9, length(q * vec2(1.15, 1.35)));
        col *= 1.0 - vig * uVignette;
        float edge = smoothstep(0.2, 0.9, length(q * 1.4));
        col = mix(col, col * vec3(0.55, 0.66, 0.78), clamp(uDamage, 0.0, 1.0) * edge);
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

/** Cloth / ice / concrete. Every mesh under the object picks up the mode. */
export function tagTree(root: THREE.Object3D, field: NightField, mode: number): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) tagMode(mesh, field, mode);
  });
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
