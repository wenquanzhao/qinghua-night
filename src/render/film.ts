import * as THREE from 'three';
import type { NightField, QualityProfile } from './night';

/**
 * The reference grades a linear picture: cone light scattered in the fog,
 * a soft halation on the bright spots, then ACES pulled toward AgX,
 * split tone, and luminance-weighted grain. Palette and place stay ours.
 */

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const VOL_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDepth;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform vec3 uFogColor;
uniform vec3 uLP0, uLP1, uLP2, uLP3, uLP4, uLP5, uLP6, uLP7;
uniform vec3 uLD0, uLD1, uLD2, uLD3, uLD4, uLD5, uLD6, uLD7;
uniform vec3 uLC0, uLC1, uLC2, uLC3, uLC4, uLC5, uLC6, uLC7;
uniform vec4 uLRange, uLCos, uLInt, uLRangeB, uLCosB, uLIntB;
uniform float uScatter;

vec3 cone(vec3 p, vec3 lp, vec3 ld, vec3 lc, float range, float cosA, float inten){
  if (inten < 0.02 || range < 0.2) return vec3(0.0);
  vec3 toL = p - lp;
  float dist = length(toL);
  vec3 L = toL / max(dist, 1e-3);
  float spot = 1.0;
  if (cosA > -0.2) spot = smoothstep(cosA, mix(cosA, 1.0, 0.45), dot(L, normalize(ld)));
  float att = pow(clamp(1.0 - dist / range, 0.0, 1.0), 1.35);
  float shaft = 0.35 + 0.65 * spot;
  return lc * inten * shaft * att * spot;
}

void main(){
  float d = texture2D(tDepth, vUv).x;
  vec4 clip = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 w = uInvViewProj * clip;
  w /= w.w;
  float dist = length(w.xyz - uCamPos);
  if (d > 0.9992) dist = 16.0;
  dist = clamp(dist, 0.2, 16.0);
  vec3 rd = normalize(w.xyz - uCamPos);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    vec3 p = uCamPos + rd * (dist * (float(i) + 0.5) / 8.0);
    acc += cone(p, uLP0, uLD0, uLC0, uLRange.x, uLCos.x, uLInt.x);
    acc += cone(p, uLP1, uLD1, uLC1, uLRange.y, uLCos.y, uLInt.y);
    acc += cone(p, uLP2, uLD2, uLC2, uLRange.z, uLCos.z, uLInt.z);
    acc += cone(p, uLP3, uLD3, uLC3, uLRange.w, uLCos.w, uLInt.w);
    acc += cone(p, uLP4, uLD4, uLC4, uLRangeB.x, uLCosB.x, uLIntB.x);
    acc += cone(p, uLP5, uLD5, uLC5, uLRangeB.y, uLCosB.y, uLIntB.y);
    acc += cone(p, uLP6, uLD6, uLC6, uLRangeB.z, uLCosB.z, uLIntB.z);
    acc += cone(p, uLP7, uLD7, uLC7, uLRangeB.w, uLCosB.w, uLIntB.w);
    acc += uFogColor * 0.02;
  }
  gl_FragColor = vec4(acc * (dist / 8.0) * uScatter, 1.0);
}
`;

const EXTRACT_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tVol;
void main(){
  vec3 c = texture2D(tScene, vUv).rgb + texture2D(tVol, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 h = max(c - vec3(0.85), 0.0) * smoothstep(0.7, 1.8, l);
  gl_FragColor = vec4(h, 1.0);
}
`;

const DOWN_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
void main(){
  vec3 c = (
    texture2D(tSrc, vUv + vec2(-uTexel.x, -uTexel.y)).rgb +
    texture2D(tSrc, vUv + vec2( uTexel.x, -uTexel.y)).rgb +
    texture2D(tSrc, vUv + vec2(-uTexel.x,  uTexel.y)).rgb +
    texture2D(tSrc, vUv + vec2( uTexel.x,  uTexel.y)).rgb
  ) * 0.25;
  gl_FragColor = vec4(c, 1.0);
}
`;

const UP_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tLow;
uniform sampler2D tHigh;
void main(){
  vec3 low = texture2D(tLow, vUv).rgb;
  low += texture2D(tLow, vUv + vec2(0.012, 0.0)).rgb * 0.35;
  low += texture2D(tLow, vUv - vec2(0.012, 0.0)).rgb * 0.35;
  gl_FragColor = vec4(texture2D(tHigh, vUv).rgb + low * 0.62, 1.0);
}
`;

const GRADE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tVol;
uniform sampler2D tBloom;
uniform float uVolMix, uBloom, uGrain, uVignette, uDamage, uTime, uAspect;

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 slAgxContrast(vec3 x){
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 slAgx(vec3 color){
  mat3 recToS = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
  mat3 sToRec = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
  mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  color = inset * (sToRec * color);
  color = clamp((log2(max(color, vec3(1e-10))) - (-12.47393)) / (4.026069 - (-12.47393)), 0.0, 1.0);
  color = slAgxContrast(color);
  float l = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = pow(max(color, vec3(0.0)), vec3(1.18));
  color = l + (color - l) * 1.22;
  color = outset * color;
  color = pow(max(color, vec3(0.0)), vec3(2.2));
  return clamp(recToS * color, 0.0, 1.0);
}
vec3 slRRTODT(vec3 v){
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 slAces(vec3 c){
  mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  return clamp(outM * slRRTODT(inM * (c * 1.3)), 0.0, 1.0);
}
vec3 toSRGB(vec3 c){
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

void main(){
  vec2 c = vUv - 0.5;
  float r2 = dot(c * vec2(uAspect, 1.0), c * vec2(uAspect, 1.0)) / (0.25 * (uAspect * uAspect + 1.0));
  vec2 off = c * r2 * 0.0011;
  vec3 scene = vec3(
    texture2D(tScene, vUv + off).r,
    texture2D(tScene, vUv).g,
    texture2D(tScene, vUv - off).b
  );
  vec3 vol = texture2D(tVol, vUv).rgb;
  vec3 col = scene + vol * uVolMix;
  vec3 bloom = texture2D(tBloom, vUv).rgb;
  col += bloom * vec3(1.12, 0.78, 0.52) * uBloom;
  col *= 1.12;
  col = mix(slAces(col), slAgx(col), 0.25);
  float l = luma(col);
  vec3 sh = vec3(0.80, 1.01, 1.13);
  vec3 hi = vec3(1.07, 1.0, 0.90);
  col *= mix(sh, hi, smoothstep(0.03, 0.55, l));
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);
  col = col * 0.988 + vec3(0.006, 0.0085, 0.011);
  l = luma(col);
  col = mix(vec3(l), col, 1.05);
  float vig = uVignette;
  float vr = smoothstep(0.15, 1.05, r2);
  col *= 1.0 - vig * vr * vr * (3.0 - 2.0 * vr);
  float edge = smoothstep(0.18, 1.0, r2);
  col = mix(col, vec3(0.55, 0.02, 0.01) * (0.35 + l), clamp(uDamage * edge * 0.85, 0.0, 1.0));
  col = toSRGB(clamp(col, 0.0, 1.0));
  vec2 seed = gl_FragCoord.xy + fract(uTime * vec2(7.31, 3.17)) * vec2(311.7, 173.3);
  float g = hash12(seed) + hash12(seed + 57.3) - 1.0;
  l = dot(col, vec3(0.299, 0.587, 0.114));
  col += g * uGrain * mix(1.0, 0.30, smoothstep(0.25, 0.9, l)) * (0.35 + 0.65 * smoothstep(0.0, 0.08, l));
  col += (hash12(gl_FragCoord.xy * 1.37 + 11.0) + hash12(gl_FragCoord.xy * 0.71 + 3.0) - 1.0) / 255.0;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

function target(w: number, h: number, depth = false): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(Math.max(2, w), Math.max(2, h), {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: depth,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
  if (depth) {
    rt.depthTexture = new THREE.DepthTexture(rt.width, rt.height);
    rt.depthTexture.format = THREE.DepthFormat;
    rt.depthTexture.type = THREE.UnsignedIntType;
  }
  return rt;
}

function pass(fragment: string, uniforms: { [key: string]: THREE.IUniform }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: QUAD_VERT,
    fragmentShader: fragment,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

export class Film {
  private readonly sceneRT: THREE.WebGLRenderTarget;
  private readonly volRT: THREE.WebGLRenderTarget;
  private readonly down: THREE.WebGLRenderTarget[];
  private readonly up: THREE.WebGLRenderTarget[];
  private readonly quad: THREE.Mesh;
  private readonly fsScene = new THREE.Scene();
  private readonly fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly volMat: THREE.ShaderMaterial;
  private readonly extractMat: THREE.ShaderMaterial;
  private readonly downMat: THREE.ShaderMaterial;
  private readonly upMat: THREE.ShaderMaterial;
  private readonly gradeMat: THREE.ShaderMaterial;
  private readonly inv = new THREE.Matrix4();
  private readonly viewProj = new THREE.Matrix4();
  private bloomOn = true;
  private volOn = true;

  constructor(field: NightField) {
    this.sceneRT = target(4, 4, true);
    this.volRT = target(2, 2);
    this.down = [target(2, 2), target(2, 2), target(2, 2), target(2, 2)];
    this.up = [target(2, 2), target(2, 2), target(2, 2)];
    const lights = field.uniforms;
    this.volMat = pass(VOL_FRAG, {
      tDepth: { value: this.sceneRT.depthTexture },
      uInvViewProj: { value: this.inv },
      uCamPos: { value: new THREE.Vector3() },
      uFogColor: lights.uFogColor,
      uLP0: lights.uLP0, uLP1: lights.uLP1, uLP2: lights.uLP2, uLP3: lights.uLP3,
      uLP4: lights.uLP4, uLP5: lights.uLP5, uLP6: lights.uLP6, uLP7: lights.uLP7,
      uLD0: lights.uLD0, uLD1: lights.uLD1, uLD2: lights.uLD2, uLD3: lights.uLD3,
      uLD4: lights.uLD4, uLD5: lights.uLD5, uLD6: lights.uLD6, uLD7: lights.uLD7,
      uLC0: lights.uLC0, uLC1: lights.uLC1, uLC2: lights.uLC2, uLC3: lights.uLC3,
      uLC4: lights.uLC4, uLC5: lights.uLC5, uLC6: lights.uLC6, uLC7: lights.uLC7,
      uLRange: lights.uLRange, uLCos: lights.uLCos, uLInt: lights.uLInt,
      uLRangeB: lights.uLRangeB, uLCosB: lights.uLCosB, uLIntB: lights.uLIntB,
      uScatter: { value: 0.028 },
    });
    this.extractMat = pass(EXTRACT_FRAG, {
      tScene: { value: this.sceneRT.texture },
      tVol: { value: this.volRT.texture },
    });
    this.downMat = pass(DOWN_FRAG, {
      tSrc: { value: null },
      uTexel: { value: new THREE.Vector2(1, 1) },
    });
    this.upMat = pass(UP_FRAG, {
      tLow: { value: null },
      tHigh: { value: null },
    });
    this.gradeMat = pass(GRADE_FRAG, {
      tScene: { value: this.sceneRT.texture },
      tVol: { value: this.volRT.texture },
      tBloom: { value: this.up[0].texture },
      uVolMix: { value: 1 },
      uBloom: { value: 0.55 },
      uGrain: { value: 0.02 },
      uVignette: { value: 0.32 },
      uDamage: { value: 0 },
      uTime: lights.uTime,
      uAspect: { value: 1.6 },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.gradeMat);
    this.quad.frustumCulled = false;
    this.fsScene.add(this.quad);
  }

  resize(cssW: number, cssH: number, profile: QualityProfile): void {
    const w = Math.max(16, Math.floor(cssW * profile.scale));
    const h = Math.max(16, Math.floor(cssH * profile.scale));
    this.sceneRT.setSize(w, h);
    if (this.sceneRT.depthTexture) {
      this.sceneRT.depthTexture.image.width = w;
      this.sceneRT.depthTexture.image.height = h;
      this.sceneRT.depthTexture.needsUpdate = true;
    }
    const hw = Math.max(4, Math.floor(w / 2));
    const hh = Math.max(4, Math.floor(h / 2));
    this.volRT.setSize(hw, hh);
    let dw = hw;
    let dh = hh;
    for (let i = 0; i < 4; i++) {
      this.down[i].setSize(dw, dh);
      if (i < 3) this.up[i].setSize(dw, dh);
      dw = Math.max(2, dw >> 1);
      dh = Math.max(2, dh >> 1);
    }
    this.bloomOn = profile.post;
    this.volOn = profile.vol > 0;
    this.gradeMat.uniforms.uGrain.value = profile.grain;
    this.gradeMat.uniforms.uVignette.value = profile.vignette;
    this.gradeMat.uniforms.uVolMix.value = this.volOn ? 1 : 0;
    this.gradeMat.uniforms.uBloom.value = this.bloomOn ? 0.28 : 0;
    this.gradeMat.uniforms.uAspect.value = cssW / Math.max(1, cssH);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, damage: number): void {
    renderer.setRenderTarget(this.sceneRT);
    renderer.render(scene, camera);
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.inv.copy(this.viewProj).invert();
    camera.getWorldPosition(this.volMat.uniforms.uCamPos.value as THREE.Vector3);
    this.volMat.uniforms.tDepth.value = this.sceneRT.depthTexture;
    if (this.volOn) this.blit(renderer, this.volMat, this.volRT);
    if (this.bloomOn) {
      this.blit(renderer, this.extractMat, this.down[0]);
      for (let i = 1; i < 4; i++) {
        const src = this.down[i - 1];
        (this.downMat.uniforms.uTexel.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
        this.downMat.uniforms.tSrc.value = src.texture;
        this.blit(renderer, this.downMat, this.down[i]);
      }
      this.upMat.uniforms.tLow.value = this.down[3].texture;
      this.upMat.uniforms.tHigh.value = this.down[2].texture;
      this.blit(renderer, this.upMat, this.up[2]);
      this.upMat.uniforms.tLow.value = this.up[2].texture;
      this.upMat.uniforms.tHigh.value = this.down[1].texture;
      this.blit(renderer, this.upMat, this.up[1]);
      this.upMat.uniforms.tLow.value = this.up[1].texture;
      this.upMat.uniforms.tHigh.value = this.down[0].texture;
      this.blit(renderer, this.upMat, this.up[0]);
    }
    this.gradeMat.uniforms.uDamage.value = damage;
    this.gradeMat.uniforms.tBloom.value = this.bloomOn ? this.up[0].texture : this.volRT.texture;
    renderer.setRenderTarget(null);
    this.blit(renderer, this.gradeMat, null);
  }

  private blit(renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial, to: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    renderer.setRenderTarget(to);
    renderer.render(this.fsScene, this.fsCam);
  }
}
