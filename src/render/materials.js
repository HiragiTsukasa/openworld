// MUGEN CITY — shared material library (G.materials, ARCHITECTURE §7).
//
//   G.materials.get('asphalt')                       shared MeshStandardMaterial
//   G.materials.get('car_paint', {color: 0xc0392b})  cached variant
//   G.materials.solid(0x336699, {roughness: 0.4})    untextured PBR colour
//
// Materials are created lazily, cached by key + options and never disposed (they are shared).
// Do not mutate a shared material — request a variant through `opts` instead.

import * as THREE from 'three';
import { G, registerSystem } from '../core/game.js';

/** @type {Map<string, THREE.Material>} */
const cache = new Map();
/** materials whose emissive intensity follows the night factor: [material, baseIntensity] */
const nightLit = [];
const warned = new Set();
let night = 0;
let nightManual = false;
let nightTimer = 0;

// per-key PBR tweaks for surface textures
const SURFACE_PROPS = {
  metal: { metalness: 1 },
  metal_rust: { metalness: 0.55 },
  metal_painted: { metalness: 0.25 },
  chrome: { metalness: 1, envMapIntensity: 1.4 },
  corrugated: { metalness: 0.7 },
  roof_metal: { metalness: 0.7 },
  container: { metalness: 0.4 },
  car_paint: { metalness: 0.55, normalScale: 0.35, envMapIntensity: 1.3 },
  glass: { transparent: true, opacity: 0.38, depthWrite: false, envMapIntensity: 1.6, metalness: 0.1 },
  tiles: { envMapIntensity: 1.1 },
  snow: { normalScale: 0.6 },
  hedge: {},
};

const BASIC_KEYS = {
  light_glow: { additive: true },
  sprite_atlas: {},
  particle_atlas: {},
  noise: { opaque: true },
  cloud: {},
  smoke: {},
  fire: { additive: true },
  flare: { additive: true },
  caustics: { additive: true, opaque: false },
};

function stableKey(key, opts) {
  if (!opts) return key;
  const names = Object.keys(opts).sort();
  let s = key;
  for (let i = 0; i < names.length; i++) {
    let v = opts[names[i]];
    if (v && v.isColor) v = v.getHex();
    s += '|' + names[i] + '=' + (Array.isArray(v) ? v.join(',') : String(v));
  }
  return s;
}

function tex(key, type, opts) {
  if (opts && opts.repeat !== undefined) return G.textures.get(key, { type, repeat: opts.repeat });
  return G.textures.get(key, type === 'map' ? undefined : { type });
}

function applyCommon(m, opts) {
  if (!opts) return m;
  if (opts.color !== undefined && m.color) m.color.set(opts.color);
  if (opts.emissive !== undefined && m.emissive) m.emissive.set(opts.emissive);
  if (opts.emissiveIntensity !== undefined && m.emissiveIntensity !== undefined) m.emissiveIntensity = opts.emissiveIntensity;
  if (opts.roughness !== undefined && m.roughness !== undefined) m.roughness = opts.roughness;
  if (opts.metalness !== undefined && m.metalness !== undefined) m.metalness = opts.metalness;
  if (opts.envMapIntensity !== undefined && m.envMapIntensity !== undefined) m.envMapIntensity = opts.envMapIntensity;
  if (opts.normalScale !== undefined && m.normalScale) m.normalScale.set(opts.normalScale, opts.normalScale);
  if (opts.opacity !== undefined) {
    m.opacity = opts.opacity;
    if (opts.opacity < 1 && opts.transparent === undefined) m.transparent = true;
  }
  if (opts.transparent !== undefined) m.transparent = opts.transparent;
  if (opts.alphaTest !== undefined) m.alphaTest = opts.alphaTest;
  if (opts.depthWrite !== undefined) m.depthWrite = opts.depthWrite;
  if (opts.depthTest !== undefined) m.depthTest = opts.depthTest;
  if (opts.side !== undefined) m.side = opts.side === 'double' ? THREE.DoubleSide : opts.side === 'back' ? THREE.BackSide : opts.side === 'front' ? THREE.FrontSide : opts.side;
  if (opts.flatShading !== undefined) m.flatShading = opts.flatShading;
  if (opts.vertexColors !== undefined) m.vertexColors = opts.vertexColors;
  if (opts.fog !== undefined) m.fog = opts.fog;
  if (opts.polygonOffset) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = typeof opts.polygonOffset === 'number' ? opts.polygonOffset : -2;
    m.polygonOffsetUnits = m.polygonOffsetFactor;
  }
  return m;
}

function registerNight(m, base) {
  nightLit.push(m, base);
  m.emissiveIntensity = base * night;
}

function create(key, opts) {
  const T = G.textures;
  let m;

  if (BASIC_KEYS[key]) {
    const def = BASIC_KEYS[key];
    m = new THREE.MeshBasicMaterial({
      map: tex(key, 'map', opts),
      transparent: !def.opaque,
      depthWrite: !!def.opaque,
      blending: def.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  } else if (/^facade_/.test(key)) {
    m = new THREE.MeshStandardMaterial({
      map: tex(key, 'map', opts),
      normalMap: tex(key, 'normal', opts),
      roughnessMap: tex(key, 'roughness', opts),
      emissiveMap: tex(key, 'emissive', opts),
      emissive: 0xffffff,
      emissiveIntensity: 0,
      roughness: 1,
      metalness: /facade_glass/.test(key) ? 0.25 : 0.02,
      envMapIntensity: /facade_glass/.test(key) ? 1.3 : 1,
    });
    if (!opts || opts.emissiveIntensity === undefined) registerNight(m, 1.9);
  } else if (/^leaves_\d+$/.test(key)) {
    m = new THREE.MeshStandardMaterial({
      map: tex(key, 'map', opts),
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.85,
      metalness: 0,
    });
  } else if (key === 'neon_atlas') {
    const map = tex(key, 'map', opts);
    m = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 2.4, roughness: 0.6, metalness: 0 });
  } else if (/^billboard_\d+$/.test(key)) {
    const map = tex(key, 'map', opts);
    m = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.55, metalness: 0 });
    if (!opts || opts.emissiveIntensity === undefined) registerNight(m, 0.9);
  } else if (key === 'sign_atlas' || key === 'plate') {
    m = new THREE.MeshStandardMaterial({ map: tex(key, 'map', opts), roughness: 0.55, metalness: 0 });
  } else if (key === 'road_markings' || /^graffiti_\d+$/.test(key)) {
    m = new THREE.MeshStandardMaterial({
      map: tex(key, 'map', opts),
      transparent: true,
      depthWrite: false,
      roughness: 0.75,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  } else if (key === 'water_normal') {
    m = new THREE.MeshStandardMaterial({
      color: 0x1b5f80,
      normalMap: tex(key, 'map', opts),
      roughness: 0.08,
      metalness: 0.1,
      transparent: true,
      opacity: 0.86,
      envMapIntensity: 1.4,
    });
  } else if (T.has(key)) {
    const set = T.getSet(key);
    const props = SURFACE_PROPS[key] || {};
    m = new THREE.MeshStandardMaterial({
      map: tex(key, 'map', opts),
      normalMap: set.normalMap ? tex(key, 'normal', opts) : null,
      roughnessMap: set.roughnessMap ? tex(key, 'roughness', opts) : null,
      roughness: 1,
      metalness: 0,
    });
    applyCommon(m, props);
  } else {
    if (!warned.has(key)) {
      warned.add(key);
      console.warn('[MUGEN] materials: unknown key "' + key + '" (neutral fallback used)');
    }
    m = new THREE.MeshStandardMaterial({ color: 0x8c8c8c, roughness: 0.8, metalness: 0 });
  }
  applyCommon(m, opts);
  m.name = key;
  return m;
}

function autoNight(hour) {
  // lights on 18:00 → 19:00, off 05:30 → 06:30
  if (hour >= 19 || hour < 5.5) return 1;
  if (hour >= 18) return hour - 18;
  if (hour < 6.5) return 1 - (hour - 5.5);
  return 0;
}

export const materials = registerSystem({
  name: 'materials',
  order: 16,
  runWhenPaused: true,

  /**
   * get(key, opts?) → cached shared THREE.Material for a texture key of ARCHITECTURE §7.
   * opts (each distinct combination is cached as its own variant):
   *   color, emissive, emissiveIntensity, roughness, metalness, envMapIntensity, normalScale,
   *   opacity, transparent, alphaTest, depthWrite, depthTest, side ('front'|'back'|'double'),
   *   flatShading, vertexColors, fog, polygonOffset, repeat (number | [x, y]).
   * Unknown keys return a neutral grey material and warn once (never throws).
   * @param {string} key
   * @param {object} [opts]
   * @returns {THREE.Material}
   */
  get(key, opts) {
    const ck = stableKey(key, opts);
    let m = cache.get(ck);
    if (!m) {
      m = create(key, opts);
      cache.set(ck, m);
    }
    return m;
  },

  /**
   * solid(color, opts?) → cached untextured MeshStandardMaterial.
   * opts: roughness (0.6), metalness (0), emissive, emissiveIntensity, opacity, transparent,
   * side, flatShading, vertexColors, envMapIntensity.
   * @param {number|string} color
   * @param {object} [opts]
   * @returns {THREE.MeshStandardMaterial}
   */
  solid(color, opts) {
    const ck = stableKey('solid:' + new THREE.Color(color).getHex(), opts);
    let m = cache.get(ck);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0 });
      applyCommon(m, opts);
      m.name = 'solid';
      cache.set(ck, m);
    }
    return m;
  },

  /**
   * glow(color, intensity=2, opts?) → cached emissive MeshStandardMaterial (intensity > 1 blooms:
   * neon tubes, lamps, tail lights).
   * @param {number|string} color
   * @param {number} [intensity]
   * @param {object} [opts]
   * @returns {THREE.MeshStandardMaterial}
   */
  glow(color, intensity = 2, opts) {
    const ck = stableKey('glow:' + new THREE.Color(color).getHex() + ':' + intensity, opts);
    let m = cache.get(ck);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: intensity, roughness: 0.5, metalness: 0 });
      applyCommon(m, opts);
      m.name = 'glow';
      cache.set(ck, m);
    }
    return m;
  },

  /**
   * basic(color, opts?) → cached unlit MeshBasicMaterial (opts: opacity, transparent, side,
   * additive, depthWrite, depthTest, fog).
   * @param {number|string} color
   * @param {object} [opts]
   * @returns {THREE.MeshBasicMaterial}
   */
  basic(color, opts) {
    const ck = stableKey('basic:' + new THREE.Color(color).getHex(), opts);
    let m = cache.get(ck);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color });
      applyCommon(m, opts);
      if (opts && opts.additive) {
        m.blending = THREE.AdditiveBlending;
        m.transparent = true;
        m.depthWrite = false;
      }
      m.name = 'basic';
      cache.set(ck, m);
    }
    return m;
  },

  /**
   * setNight(factor) — 0 (day) .. 1 (night): drives the emissive intensity of night-lit shared
   * materials (facade windows, billboards). Owned by the sky module; until it is called the
   * factor follows the game clock automatically. Pass null to return to automatic mode.
   * @param {number|null} factor
   */
  setNight(factor) {
    if (factor === null || factor === undefined) {
      nightManual = false;
      return;
    }
    nightManual = true;
    applyNight(factor);
  },

  /** night → current night factor (0..1). */
  get night() {
    return night;
  },

  /** count → number of cached materials (diagnostics). */
  get count() {
    return cache.size;
  },

  update(dt) {
    if (nightManual) return;
    nightTimer -= dt > 0 ? dt : G.time.realDt;
    if (nightTimer > 0) return;
    nightTimer = 0.5;
    applyNight(autoNight(G.time.hour));
  },
});

function applyNight(f) {
  f = f < 0 ? 0 : f > 1 ? 1 : f;
  if (Math.abs(f - night) < 1e-3) return;
  night = f;
  for (let i = 0; i < nightLit.length; i += 2) nightLit[i].emissiveIntensity = nightLit[i + 1] * f;
}

export default materials;
