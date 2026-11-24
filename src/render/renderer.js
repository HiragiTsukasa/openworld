// MUGEN CITY — renderer (G.renderer, ARCHITECTURE §5).
//
// scene → HDR half-float target (MSAA per quality) → bloom (threshold + mip chain) →
// composite (ACES tone mapping, grading, vignette, screen effects) → optional FXAA → canvas.
//
//   G.renderer.three / .scene / .camera / .canvas / .frame / .width / .height (CSS px)
//   G.renderer.post.set('exposure', 1.2)
//   G.renderer.addPassHook(fn, 'afterScene')
//   G.renderer.info() → {drawCalls, tris, programs, ...}

import * as THREE from 'three';
import { G, registerSystem, reportError } from '../core/game.js';
import { CONFIG } from '../core/config.js';

// ------------------------------------------------------------------------------------------------
// Shaders (GLSL ES 3.00, RawShaderMaterial)
// ------------------------------------------------------------------------------------------------

const VERT = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG_PREFILTER = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform vec2 uThreshold; // x = threshold, y = knee
in vec2 vUv;
out vec4 outColor;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 safe(vec3 c) { return min(max(c, vec3(0.0)), vec3(64.0)); }
void main() {
  vec3 a = safe(texture(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb);
  vec3 b = safe(texture(tSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb);
  vec3 c = safe(texture(tSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb);
  vec3 d = safe(texture(tSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb);
  // Karis average: suppresses fireflies from tiny very bright pixels
  float wa = 1.0 / (1.0 + luma(a));
  float wb = 1.0 / (1.0 + luma(b));
  float wc = 1.0 / (1.0 + luma(c));
  float wd = 1.0 / (1.0 + luma(d));
  vec3 col = (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
  float br = max(col.r, max(col.g, col.b));
  float knee = uThreshold.y;
  float soft = clamp(br - uThreshold.x + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float contrib = max(soft, br - uThreshold.x) / max(br, 1e-4);
  col *= max(contrib, 0.0);
  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  outColor = vec4(col, 1.0);
}`;

const FRAG_DOWN = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 s = texture(tSrc, vUv).rgb * 4.0;
  s += texture(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  s += texture(tSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb;
  s += texture(tSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb;
  s += texture(tSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  outColor = vec4(s * 0.125, 1.0);
}`;

const FRAG_UP = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uWeight;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 d = uTexel;
  vec3 s = texture(tSrc, vUv).rgb * 4.0;
  s += (texture(tSrc, vUv + vec2(-d.x, 0.0)).rgb + texture(tSrc, vUv + vec2(d.x, 0.0)).rgb
      + texture(tSrc, vUv + vec2(0.0, -d.y)).rgb + texture(tSrc, vUv + vec2(0.0, d.y)).rgb) * 2.0;
  s += texture(tSrc, vUv + vec2(-d.x, -d.y)).rgb + texture(tSrc, vUv + vec2(d.x, -d.y)).rgb
     + texture(tSrc, vUv + vec2(-d.x,  d.y)).rgb + texture(tSrc, vUv + vec2(d.x,  d.y)).rgb;
  outColor = vec4(s * (uWeight / 16.0), 1.0);
}`;

const FRAG_COMPOSITE = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform vec2 uTexel;
uniform float uTime;
uniform float uExposure;
uniform float uBloom;
uniform float uSaturation;
uniform float uContrast;
uniform vec3 uTint;
uniform float uVignette;
uniform float uDamage;
uniform float uUnderwater;
uniform float uBlur;
uniform float uSpeed;
uniform float uGrain;
uniform float uFade;
in vec2 vUv;
out vec4 outColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// ACES filmic fit (Stephen Hill), matches three.js ACESFilmicToneMapping
vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 acesFilmic(vec3 color) {
  const mat3 ACESInputMat = mat3(
    vec3(0.59719, 0.07600, 0.02840),
    vec3(0.35458, 0.90834, 0.13383),
    vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOutputMat = mat3(
    vec3( 1.60475, -0.10208, -0.00327),
    vec3(-0.53108,  1.10813, -0.07276),
    vec3(-0.07367, -0.00605,  1.07602));
  color *= 1.0 / 0.6;
  color = ACESInputMat * color;
  color = RRTAndODTFit(color);
  color = ACESOutputMat * color;
  return clamp(color, 0.0, 1.0);
}
vec3 linearToSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

void main() {
  vec2 uv = vUv;
  if (uUnderwater > 0.001) {
    uv += uUnderwater * 0.0035 * vec2(sin(uv.y * 34.0 + uTime * 2.3), cos(uv.x * 29.0 + uTime * 1.9));
  }
  vec3 col = texture(tScene, uv).rgb;
  if (uBlur > 0.001) {
    // golden-angle disc, rotated per pixel so the taps dissolve into fine grain
    vec3 acc = col;
    float r = uBlur * 7.0;
    float rot = hash12(gl_FragCoord.xy) * 6.2831853;
    for (int i = 0; i < 12; i++) {
      float a = float(i) * 2.39996323 + rot;
      float rr = r * sqrt((float(i) + 0.5) / 12.0);
      acc += texture(tScene, uv + vec2(cos(a), sin(a)) * rr * uTexel).rgb;
    }
    col = mix(col, acc / 13.0, clamp(uBlur * 2.0, 0.0, 1.0));
  }
  col = max(col, vec3(0.0));
  col += texture(tBloom, uv).rgb * uBloom;
  col *= uExposure;
  col *= mix(vec3(1.0), vec3(0.42, 0.78, 0.95), uUnderwater);

  col = acesFilmic(col);

  // grading (display-referred)
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSaturation);
  col *= uTint;
  col = linearToSRGB(clamp(col, 0.0, 1.0));
  col = (col - 0.5) * uContrast + 0.5;

  vec2 q = vUv * 2.0 - 1.0;
  float r2 = dot(q, q) * 0.5;
  col *= 1.0 - uVignette * smoothstep(0.2, 1.05, r2);
  if (uSpeed > 0.001) {
    float ang = atan(q.y, q.x) * 46.0;
    float seg = floor(ang);
    float f = fract(ang);
    float n = hash12(vec2(seg, floor(uTime * 30.0)));
    float profile = smoothstep(0.0, 0.35, f) * smoothstep(1.0, 0.65, f);
    float streak = step(0.86, n) * profile * smoothstep(0.55, 1.35, length(q)) * (0.5 + 0.5 * hash12(vec2(seg, 3.0)));
    col += vec3(streak * uSpeed * 0.28);
  }
  if (uUnderwater > 0.001) col = mix(col, vec3(0.03, 0.22, 0.32), uUnderwater * 0.22 * (0.5 + r2));
  col = mix(col, vec3(0.62, 0.02, 0.03), clamp(uDamage, 0.0, 1.0) * (0.18 + 0.82 * smoothstep(0.15, 1.0, r2)));
  col = mix(col, vec3(0.0), uFade);
  float n = hash12(gl_FragCoord.xy + fract(uTime) * 61.0);
  col += (n - 0.5) * (1.0 / 255.0 + uGrain * 0.08);
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const FRAG_FXAA = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 outColor;
void main() {
  const vec3 W = vec3(0.299, 0.587, 0.114);
  vec3 rgbNW = texture(tSrc, vUv + vec2(-1.0, -1.0) * uTexel).rgb;
  vec3 rgbNE = texture(tSrc, vUv + vec2( 1.0, -1.0) * uTexel).rgb;
  vec3 rgbSW = texture(tSrc, vUv + vec2(-1.0,  1.0) * uTexel).rgb;
  vec3 rgbSE = texture(tSrc, vUv + vec2( 1.0,  1.0) * uTexel).rgb;
  vec3 rgbM  = texture(tSrc, vUv).rgb;
  float lumaNW = dot(rgbNW, W), lumaNE = dot(rgbNE, W), lumaSW = dot(rgbSW, W), lumaSE = dot(rgbSE, W), lumaM = dot(rgbM, W);
  float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
  float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));
  vec2 dir = vec2(-((lumaNW + lumaNE) - (lumaSW + lumaSE)), ((lumaNW + lumaSW) - (lumaNE + lumaSE)));
  float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * 0.03125, 1.0 / 128.0);
  float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = clamp(dir * rcpDirMin, vec2(-8.0), vec2(8.0)) * uTexel;
  vec3 rgbA = 0.5 * (texture(tSrc, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture(tSrc, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 rgbB = rgbA * 0.5 + 0.25 * (texture(tSrc, vUv + dir * -0.5).rgb + texture(tSrc, vUv + dir * 0.5).rgb);
  float lumaB = dot(rgbB, W);
  outColor = vec4((lumaB < lumaMin || lumaB > lumaMax) ? rgbA : rgbB, 1.0);
}`;

const ENV_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const ENV_FRAG = /* glsl */ `
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 sky = mix(vec3(0.78, 0.86, 0.96), vec3(0.20, 0.42, 0.86), pow(max(h, 0.0), 0.5));
  vec3 ground = mix(vec3(0.42, 0.41, 0.39), vec3(0.16, 0.16, 0.17), pow(max(-h, 0.0), 0.6));
  vec3 c = h > 0.0 ? sky : ground;
  float sun = max(dot(d, normalize(vec3(0.45, 0.72, 0.35))), 0.0);
  c += vec3(1.0, 0.92, 0.78) * (pow(sun, 350.0) * 28.0 + pow(sun, 12.0) * 0.35);
  gl_FragColor = vec4(c * 1.15, 1.0);
}`;

// ------------------------------------------------------------------------------------------------
// State
// ------------------------------------------------------------------------------------------------

let three = null;
let scene = null;
let camera = null;
let canvas = null;
let frameEl = null;
let hdr = true;
let needsResize = true;
let needsTargets = true;
let bufferW = 1;
let bufferH = 1;
let overrideScene = null;
let overrideCamera = null;
let defaultEnv = null;
let depthTextureWanted = false;

let fsGeo = null;
let fsMesh = null;
let fsCam = null;
let rtScene = null;
let rtLdr = null;
/** @type {THREE.WebGLRenderTarget[]} */
const bloomMips = [];
let matPrefilter = null;
let matDown = null;
let matUp = null;
let matComposite = null;
let matFxaa = null;

const hooks = { beforeScene: [], afterScene: [], afterPost: [] };
const hookCtx = { three: null, scene: null, camera: null, target: null, width: 0, height: 0, dt: 0, stage: '' };
const lastInfo = {
  drawCalls: 0, tris: 0, points: 0, lines: 0, postCalls: 0, programs: 0, geometries: 0, textures: 0,
  width: 0, height: 0, bufferWidth: 0, bufferHeight: 0, pixelRatio: 1, hdr: true, msaa: 0, frame: 0,
};
const resizeEvent = { width: 0, height: 0, pixelRatio: 1 };
const _v = new THREE.Vector3();
const warnedPost = new Set();

const POST_DEFAULTS = {
  exposure: 1.0,
  saturation: 1.04,
  contrast: 1.03,
  tint: 0xffffff,
  vignette: 0.22,
  damageFlash: 0,
  underwater: 0,
  blur: 0,
  speedLines: 0,
  grain: 0,
  fade: 0,
  bloomStrength: 0.5,
  bloomThreshold: 1.0,
  bloomKnee: 0.5,
  bloomRadius: 0.7,
};
const UNIFORM_OF = {
  exposure: 'uExposure', saturation: 'uSaturation', contrast: 'uContrast', vignette: 'uVignette',
  damageFlash: 'uDamage', underwater: 'uUnderwater', blur: 'uBlur', speedLines: 'uSpeed', grain: 'uGrain',
  fade: 'uFade', bloomStrength: 'uBloom',
};
const postParams = Object.assign({}, POST_DEFAULTS);

function makePassMaterial(fragmentShader, uniforms, additive) {
  const m = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  if (additive) {
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneFactor;
    m.blendSrcAlpha = THREE.OneFactor;
    m.blendDstAlpha = THREE.OneFactor;
    m.transparent = true;
  } else {
    m.blending = THREE.NoBlending;
  }
  return m;
}

function makeTarget(w, h, opts) {
  const rt = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type: opts.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.NoColorSpace,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
    depthBuffer: !!opts.depth,
    stencilBuffer: false,
    samples: opts.samples || 0,
  });
  rt.texture.name = opts.name || 'rt';
  return rt;
}

function disposeTargets() {
  if (rtScene) {
    if (rtScene.depthTexture) rtScene.depthTexture.dispose();
    rtScene.dispose();
  }
  if (rtLdr) rtLdr.dispose();
  for (let i = 0; i < bloomMips.length; i++) bloomMips[i].dispose();
  bloomMips.length = 0;
  rtScene = null;
  rtLdr = null;
}

function buildTargets() {
  disposeTargets();
  const q = G.quality;
  const maxSamples = three.capabilities.maxSamples || 0;
  const samples = Math.min(q.get('msaa') || 0, maxSamples);
  rtScene = makeTarget(bufferW, bufferH, { hdr, depth: true, samples, name: 'scene' });
  if (depthTextureWanted) {
    const dt = new THREE.DepthTexture(bufferW, bufferH);
    dt.type = THREE.UnsignedIntType;
    dt.minFilter = THREE.NearestFilter;
    dt.magFilter = THREE.NearestFilter;
    rtScene.depthTexture = dt;
  }
  if (q.get('bloom')) {
    const levels = Math.max(2, Math.min(7, q.get('bloomLevels') || 4));
    let w = bufferW;
    let h = bufferH;
    for (let i = 0; i < levels; i++) {
      w = Math.max(2, w >> 1);
      h = Math.max(2, h >> 1);
      bloomMips.push(makeTarget(w, h, { hdr, name: 'bloom' + i }));
      if (w <= 4 || h <= 4) break;
    }
  }
  if (q.get('fxaa')) rtLdr = makeTarget(bufferW, bufferH, { hdr: false, name: 'ldr' });
  lastInfo.msaa = samples;
  needsTargets = false;
}

function applySize(self) {
  const cssW = Math.max(1, Math.round(frameEl.clientWidth || canvas.clientWidth || 390));
  const cssH = Math.max(1, Math.round(frameEl.clientHeight || canvas.clientHeight || 844));
  let pr = G.quality.pixelRatio || 1;
  // keep the back buffer within sane bounds (memory / fill rate on huge displays)
  const longSide = Math.max(cssW, cssH) * pr;
  if (longSide > 2800) pr *= 2800 / longSide;
  const w = Math.max(1, Math.floor(cssW * pr));
  const h = Math.max(1, Math.floor(cssH * pr));
  const sizeChanged = w !== bufferW || h !== bufferH;
  bufferW = w;
  bufferH = h;
  three.setPixelRatio(pr);
  three.setSize(cssW, cssH, false);
  if (needsTargets || !rtScene) buildTargets();
  else if (sizeChanged) {
    rtScene.setSize(w, h);
    if (rtLdr) rtLdr.setSize(w, h);
    let mw = w;
    let mh = h;
    for (let i = 0; i < bloomMips.length; i++) {
      mw = Math.max(2, mw >> 1);
      mh = Math.max(2, mh >> 1);
      bloomMips[i].setSize(mw, mh);
    }
  }
  camera.aspect = cssW / cssH;
  camera.updateProjectionMatrix();
  const changed = self.width !== cssW || self.height !== cssH || self.pixelRatio !== pr;
  self.width = cssW;
  self.height = cssH;
  self.pixelRatio = pr;
  needsResize = false;
  if (changed) {
    resizeEvent.width = cssW;
    resizeEvent.height = cssH;
    resizeEvent.pixelRatio = pr;
    G.events.emit('renderer:resize', resizeEvent);
  }
}

function applyQualitySettings() {
  const q = G.quality;
  const shadowSize = q.get('shadowMapSize') || 0;
  const enabled = shadowSize > 0;
  const type = q.get('shadowSoft') ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  if (three.shadowMap.enabled !== enabled || three.shadowMap.type !== type) {
    three.shadowMap.enabled = enabled;
    three.shadowMap.type = type;
    three.shadowMap.needsUpdate = true;
    // shadow support is baked into compiled programs
    scene.traverse((o) => {
      const m = o.material;
      if (!m) return;
      if (Array.isArray(m)) for (let i = 0; i < m.length; i++) m[i].needsUpdate = true;
      else m.needsUpdate = true;
    });
  }
  camera.far = Math.max(1000, CONFIG.CAMERA_FAR);
  camera.updateProjectionMatrix();
}

function runHooks(stage, target, dt) {
  const list = hooks[stage];
  if (list.length === 0) return;
  hookCtx.three = three;
  hookCtx.scene = overrideScene || scene;
  hookCtx.camera = overrideCamera || camera;
  hookCtx.target = target;
  hookCtx.width = bufferW;
  hookCtx.height = bufferH;
  hookCtx.dt = dt;
  hookCtx.stage = stage;
  for (let i = 0; i < list.length; i++) {
    try {
      list[i](hookCtx);
    } catch (err) {
      reportError(err, 'renderer', 'hook:' + stage);
    }
  }
}

function drawPass(material, target) {
  fsMesh.material = material;
  three.setRenderTarget(target);
  three.render(fsMesh, fsCam);
}

function setTint(value) {
  const u = matComposite.uniforms.uTint.value;
  if (value && value.isColor) u.copy(value);
  else if (Array.isArray(value)) u.setRGB(value[0], value[1], value[2]);
  else u.set(value);
}

// ------------------------------------------------------------------------------------------------
// System
// ------------------------------------------------------------------------------------------------

export const renderer = registerSystem({
  name: 'renderer',
  order: 10,
  critical: true,
  runWhenPaused: true,

  /** THREE.WebGLRenderer */
  three: null,
  /** THREE.Scene (also G.scene) */
  scene: null,
  /** THREE.PerspectiveCamera (also G.camera) */
  camera: null,
  /** the <canvas> element */
  canvas: null,
  /** the portrait frame element (#game) */
  frame: null,
  /** frame size in CSS px */
  width: 390,
  height: 844,
  /** effective pixel ratio of the back buffer */
  pixelRatio: 1,
  /** true while the WebGL context is lost */
  contextLost: false,
  /** GPU / driver string (may be empty) */
  gpu: '',
  /** the THREE namespace, for modules that want constants without importing */
  THREE,

  /** Post-processing controls. */
  post: {
    /** current parameter values (read-only snapshot object, updated by set) */
    params: postParams,
    /** false = skip bloom / grading and tone-map only (debug) */
    enabled: true,

    /**
     * post.set(key, value) — sets a post-processing parameter:
     * exposure, saturation, contrast, tint (hex | THREE.Color | [r,g,b]), vignette, damageFlash,
     * underwater, blur, speedLines, grain, fade (0..1), bloomStrength, bloomThreshold,
     * bloomKnee, bloomRadius. Unknown keys warn once.
     * @param {string} key
     * @param {any} value
     */
    set(key, value) {
      if (!(key in POST_DEFAULTS)) {
        if (!warnedPost.has(key)) {
          warnedPost.add(key);
          console.warn('[MUGEN] renderer.post.set: unknown key "' + key + '"');
        }
        return;
      }
      if (key === 'tint') {
        postParams.tint = value;
        if (matComposite) setTint(value);
        return;
      }
      const v = Number(value);
      if (!Number.isFinite(v)) return;
      postParams[key] = v;
      if (!matComposite) return;
      const uniform = UNIFORM_OF[key];
      if (uniform) matComposite.uniforms[uniform].value = v;
      else if (key === 'bloomThreshold') matPrefilter.uniforms.uThreshold.value.x = v;
      else if (key === 'bloomKnee') matPrefilter.uniforms.uThreshold.value.y = v;
    },

    /**
     * post.get(key) → current value of a parameter.
     * @param {string} key
     * @returns {any}
     */
    get(key) {
      return postParams[key];
    },

    /**
     * post.reset() — restores every parameter to its default.
     */
    reset() {
      for (const key in POST_DEFAULTS) this.set(key, POST_DEFAULTS[key]);
    },
  },

  init() {
    frameEl = document.getElementById('game');
    if (!frameEl) {
      frameEl = document.createElement('div');
      frameEl.id = 'game';
      frameEl.style.cssText = 'position:fixed;inset:0;overflow:hidden;background:#000';
      document.body.appendChild(frameEl);
    }
    canvas = frameEl.querySelector('canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'canvas';
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
      frameEl.insertBefore(canvas, frameEl.firstChild);
    }

    three = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: G.flags.test === true,
      failIfMajorPerformanceCaveat: false,
    });
    const gl = three.getContext();
    hdr = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    try {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      this.gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '';
    } catch (_) {
      this.gpu = '';
    }
    G.quality.refineForGPU(this.gpu);

    three.outputColorSpace = THREE.SRGBColorSpace;
    three.toneMapping = THREE.NoToneMapping;
    three.autoClear = false;
    three.info.autoReset = false;
    three.sortObjects = true;
    three.setClearColor(0x0b0e14, 1);

    scene = new THREE.Scene();
    scene.name = 'world';
    camera = new THREE.PerspectiveCamera(CONFIG.CAMERA_FOV, 390 / 844, CONFIG.CAMERA_NEAR, CONFIG.CAMERA_FAR);
    camera.position.set(0, 3, -8);
    camera.lookAt(0, 1, 0);
    camera.layers.enable(CONFIG.LAYER_FX);
    camera.layers.enable(CONFIG.LAYER_UI3D);
    scene.add(camera);

    this.three = three;
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.frame = frameEl;
    G.scene = scene;
    G.camera = camera;

    // post pipeline
    fsGeo = new THREE.BufferGeometry();
    fsGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    fsMesh = new THREE.Mesh(fsGeo, null);
    fsMesh.frustumCulled = false;
    fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    matPrefilter = makePassMaterial(FRAG_PREFILTER, {
      tSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uThreshold: { value: new THREE.Vector2(postParams.bloomThreshold, postParams.bloomKnee) },
    });
    matDown = makePassMaterial(FRAG_DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    matUp = makePassMaterial(FRAG_UP, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } }, true);
    matComposite = makePassMaterial(FRAG_COMPOSITE, {
      tScene: { value: null },
      tBloom: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uExposure: { value: postParams.exposure },
      uBloom: { value: postParams.bloomStrength },
      uSaturation: { value: postParams.saturation },
      uContrast: { value: postParams.contrast },
      uTint: { value: new THREE.Color(0xffffff) },
      uVignette: { value: postParams.vignette },
      uDamage: { value: 0 },
      uUnderwater: { value: 0 },
      uBlur: { value: 0 },
      uSpeed: { value: 0 },
      uGrain: { value: 0 },
      uFade: { value: 0 },
    });
    matFxaa = makePassMaterial(FRAG_FXAA, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    setTint(postParams.tint);
    this._blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this._blackTex.needsUpdate = true;

    applyQualitySettings();
    applySize(this);

    // resize handling
    const flag = () => {
      needsResize = true;
    };
    try {
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(flag).observe(frameEl);
    } catch (_) {
      /* ignore */
    }
    window.addEventListener('resize', flag);
    window.addEventListener('orientationchange', flag);

    G.events.on('quality:change', (e) => {
      needsResize = true;
      if (e.reason === 'level' || e.reason === 'detect') {
        needsTargets = true;
        applyQualitySettings();
      }
    });

    // context loss
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      G.suspend('contextlost', true);
      G.events.emit('renderer:contextlost', {});
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      needsTargets = true;
      needsResize = true;
      // render-target contents are gone: rebuild the default environment if it is in use.
      // Modules that own render targets (sky, water ...) listen to `renderer:contextrestored`.
      const old = defaultEnv;
      defaultEnv = null;
      if (old) {
        try {
          const fresh = this.getDefaultEnvironment();
          if (scene.environment === old) scene.environment = fresh;
          if (overrideScene && overrideScene.environment === old) overrideScene.environment = fresh;
          old.dispose();
        } catch (err) {
          reportError(err, 'renderer', 'contextrestored');
        }
      }
      G.suspend('contextlost', false);
      G.events.emit('renderer:contextrestored', {});
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  },

  /**
   * render(dt) — renders one frame through the post pipeline. Called by the core loop.
   * @param {number} [dt] real seconds since the previous frame (drives time-based effects)
   */
  render(dt = 0) {
    if (!three || this.contextLost) return;
    if (needsResize || needsTargets) applySize(this);
    const activeScene = overrideScene || scene;
    const activeCamera = overrideCamera || camera;
    const info = three.info;
    info.reset();

    runHooks('beforeScene', rtScene, dt);

    three.setRenderTarget(rtScene);
    three.autoClear = true;
    three.render(activeScene, activeCamera);
    three.autoClear = false;
    lastInfo.drawCalls = info.render.calls;
    lastInfo.tris = info.render.triangles;
    lastInfo.points = info.render.points;
    lastInfo.lines = info.render.lines;

    runHooks('afterScene', rtScene, dt);

    const uni = matComposite.uniforms;
    let bloomTex = this._blackTex;
    if (this.post.enabled && bloomMips.length > 0 && postParams.bloomStrength > 0) {
      // prefilter + downsample chain
      matPrefilter.uniforms.tSrc.value = rtScene.texture;
      matPrefilter.uniforms.uTexel.value.set(1 / bufferW, 1 / bufferH);
      drawPass(matPrefilter, bloomMips[0]);
      for (let i = 1; i < bloomMips.length; i++) {
        const src = bloomMips[i - 1];
        matDown.uniforms.tSrc.value = src.texture;
        matDown.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
        drawPass(matDown, bloomMips[i]);
      }
      // additive upsample chain back to mip 0
      const radius = postParams.bloomRadius;
      let norm = 1;
      let w = 1;
      for (let i = bloomMips.length - 1; i > 0; i--) {
        const src = bloomMips[i];
        matUp.uniforms.tSrc.value = src.texture;
        matUp.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
        matUp.uniforms.uWeight.value = radius;
        drawPass(matUp, bloomMips[i - 1]);
        w *= radius;
        norm += w;
      }
      bloomTex = bloomMips[0].texture;
      uni.uBloom.value = postParams.bloomStrength / norm;
    } else {
      uni.uBloom.value = 0;
    }

    uni.tScene.value = rtScene.texture;
    uni.tBloom.value = bloomTex;
    uni.uTexel.value.set(1 / bufferW, 1 / bufferH);
    uni.uTime.value = G.time.now % 3600;
    if (rtLdr) {
      drawPass(matComposite, rtLdr);
      matFxaa.uniforms.tSrc.value = rtLdr.texture;
      matFxaa.uniforms.uTexel.value.set(1 / bufferW, 1 / bufferH);
      drawPass(matFxaa, null);
    } else {
      drawPass(matComposite, null);
    }

    runHooks('afterPost', null, dt);

    lastInfo.postCalls = info.render.calls - lastInfo.drawCalls;
    lastInfo.frame = G.time.frame;
  },

  /**
   * resize() — forces the frame size / pixel ratio to be re-read before the next render.
   */
  resize() {
    needsResize = true;
  },

  /**
   * info() → {drawCalls, tris, points, lines, postCalls, programs, geometries, textures, width,
   * height, bufferWidth, bufferHeight, pixelRatio, hdr, msaa, frame}. Scene statistics of the
   * last rendered frame (drawCalls / tris exclude the post passes).
   * @returns {object}
   */
  info() {
    if (three) {
      lastInfo.programs = three.info.programs ? three.info.programs.length : 0;
      lastInfo.geometries = three.info.memory.geometries;
      lastInfo.textures = three.info.memory.textures;
    }
    lastInfo.width = this.width;
    lastInfo.height = this.height;
    lastInfo.bufferWidth = bufferW;
    lastInfo.bufferHeight = bufferH;
    lastInfo.pixelRatio = this.pixelRatio;
    lastInfo.hdr = hdr;
    return lastInfo;
  },

  /**
   * addPassHook(fn, stage='afterScene') → remove(). Registers `fn(ctx)` called every frame with
   * ctx = {three, scene, camera, target, width, height, dt, stage}. Stages:
   * 'beforeScene' (before the main pass), 'afterScene' (HDR target still holds the scene —
   * render extra passes into `ctx.target`), 'afterPost' (after the final blit to the canvas).
   * @param {(ctx: object) => void} fn
   * @param {'beforeScene'|'afterScene'|'afterPost'} [stage]
   * @returns {() => void}
   */
  addPassHook(fn, stage = 'afterScene') {
    const list = hooks[stage] || hooks.afterScene;
    list.push(fn);
    return () => {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  },

  /**
   * setOverride(scene | null, camera | null) — renders another scene / camera through the same
   * pipeline instead of the world (model viewer, photo studio). Pass nulls to restore.
   * @param {THREE.Scene|null} sceneOverride
   * @param {THREE.Camera|null} cameraOverride
   */
  setOverride(sceneOverride, cameraOverride) {
    overrideScene = sceneOverride || null;
    overrideCamera = cameraOverride || null;
    if (overrideCamera && overrideCamera.isPerspectiveCamera) {
      overrideCamera.aspect = this.width / this.height;
      overrideCamera.updateProjectionMatrix();
    }
  },

  /**
   * getDefaultEnvironment() → THREE.Texture (PMREM). A neutral procedural sky environment for
   * PBR reflections, generated lazily. The sky module replaces `scene.environment` later.
   * @returns {THREE.Texture}
   */
  getDefaultEnvironment() {
    if (defaultEnv) return defaultEnv;
    const pmrem = new THREE.PMREMGenerator(three);
    const envScene = new THREE.Scene();
    const geo = new THREE.SphereGeometry(40, 32, 16);
    const mat = new THREE.ShaderMaterial({
      vertexShader: ENV_VERT,
      fragmentShader: ENV_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
    });
    envScene.add(new THREE.Mesh(geo, mat));
    const prevTarget = three.getRenderTarget();
    defaultEnv = pmrem.fromScene(envScene, 0.02).texture;
    three.setRenderTarget(prevTarget);
    three.autoClear = false;
    pmrem.dispose();
    geo.dispose();
    mat.dispose();
    return defaultEnv;
  },

  /**
   * useDepthTexture(on=true) → THREE.DepthTexture | null. Attaches a sampleable depth texture to
   * the HDR scene target (soft particles, water). Available as `G.renderer.depthTexture` after
   * the next frame.
   * @param {boolean} [on]
   * @returns {THREE.DepthTexture|null}
   */
  useDepthTexture(on = true) {
    if (depthTextureWanted !== !!on) {
      depthTextureWanted = !!on;
      needsTargets = true;
      if (three && !this.contextLost) applySize(this);
    }
    return this.depthTexture;
  },

  /** depthTexture → the scene depth texture, or null when not enabled. */
  get depthTexture() {
    return rtScene ? rtScene.depthTexture : null;
  },

  /** sceneTarget → the HDR WebGLRenderTarget the world is rendered into. */
  get sceneTarget() {
    return rtScene;
  },

  /**
   * worldToScreen(pos, out) → out {x, y, z, visible}. Projects a world position to frame CSS
   * px. `visible` is false behind the camera or outside the frame. Uses the camera matrices of
   * the current frame (call `camera.updateMatrixWorld()` first if you moved it this frame).
   * @param {{x:number,y:number,z:number}} pos
   * @param {{x:number,y:number,z:number,visible:boolean}} out
   * @returns {{x:number,y:number,z:number,visible:boolean}}
   */
  worldToScreen(pos, out) {
    const cam = overrideCamera || camera;
    _v.set(pos.x, pos.y, pos.z).applyMatrix4(cam.matrixWorldInverse);
    const behind = _v.z > -cam.near;
    _v.applyMatrix4(cam.projectionMatrix);
    out.x = (_v.x * 0.5 + 0.5) * this.width;
    out.y = (-_v.y * 0.5 + 0.5) * this.height;
    out.z = _v.z;
    out.visible = !behind && _v.x >= -1 && _v.x <= 1 && _v.y >= -1 && _v.y <= 1;
    if (behind) out.z = 2;
    return out;
  },
});

export default renderer;
