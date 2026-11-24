// MUGEN CITY — procedural texture library (G.textures, ARCHITECTURE §7).
//
// Foundation version: simple but tasteful placeholders for EVERY required key (generators live
// in render/texgen.js). All textures are generated lazily on first use (< 30 ms each), cached,
// tileable where it makes sense, and come as PBR sets:
//   G.textures.getSet(key) → {map, normalMap, roughnessMap, emissiveMap?}.
// The `tex` module upgrades the generators later while keeping keys and API.

import * as THREE from 'three';
import { G, registerSystem, reportError } from '../core/game.js';
import { RNG } from '../core/rng.js';
import { buildRaw, buildNeutral, allKeys, ATLASES, SIGN_STYLES, drawSign, shopName, SLOGANS, makeCanvas } from './texgen.js';

// ------------------------------------------------------------------------------------------------
// Texture objects + cache
// ------------------------------------------------------------------------------------------------

/** @type {Map<string, any>} key → built set of THREE textures */
const sets = new Map();
/** @type {Map<string, THREE.Texture>} variant cache (repeat etc.) */
const variants = new Map();
/** @type {Map<string, THREE.Texture>} */
const signs = new Map();
const warned = new Set();
const generationMs = {};

function toTexture(canvas, srgb, opts) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (opts && opts.clamp) {
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  } else {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  }
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = G.quality ? G.quality.get('anisotropy') || 1 : 1;
  tex.needsUpdate = true;
  return tex;
}

function buildSet(key) {
  const t0 = performance.now();
  let raw = null;
  try {
    raw = buildRaw(key);
  } catch (err) {
    reportError(err, 'textures', key);
  }
  let fallback = false;
  if (!raw) {
    fallback = true;
    if (!warned.has(key)) {
      warned.add(key);
      console.warn('[MUGEN] textures: unknown key "' + key + '" (neutral fallback used)');
    }
    raw = buildNeutral(key);
  }
  const clampOpt = raw.clamp ? { clamp: true } : null;
  const set = {
    map: toTexture(raw.map, !raw.data, clampOpt),
    normalMap: raw.normalMap ? toTexture(raw.normalMap, false, clampOpt) : null,
    roughnessMap: raw.roughnessMap ? toTexture(raw.roughnessMap, false, clampOpt) : null,
    emissiveMap: raw.emissiveMap ? (raw.emissiveMap === raw.map ? null : toTexture(raw.emissiveMap, true, clampOpt)) : null,
    alpha: !!raw.alpha,
    meta: raw.meta || {},
    fallback,
  };
  if (raw.emissiveMap && raw.emissiveMap === raw.map) set.emissiveMap = set.map;
  set.map.name = key;
  set.map.userData.meta = set.meta;
  if (set.normalMap) set.normalMap.name = key + ':normal';
  if (set.roughnessMap) set.roughnessMap.name = key + ':roughness';
  if (set.emissiveMap && set.emissiveMap !== set.map) set.emissiveMap.name = key + ':emissive';
  generationMs[key] = Math.round((performance.now() - t0) * 10) / 10;
  return set;
}

const uvOut = { u0: 0, v0: 0, u1: 1, v1: 1 };

export const textures = registerSystem({
  name: 'textures',
  order: 15,

  /** every supported texture key */
  keys: allKeys(),
  /** generation time per key in ms (diagnostics) */
  generationMs,

  /**
   * get(key, opts?) → cached THREE.Texture (colour map by default).
   * opts: { type: 'map'|'normal'|'roughness'|'emissive', repeat: number|[x, y] }.
   * A `repeat` returns a cached clone sharing the same image. Unknown keys return a neutral
   * grey fallback and warn once (never throws).
   * @param {string} key
   * @param {{type?: string, repeat?: number|number[]}} [opts]
   * @returns {THREE.Texture}
   */
  get(key, opts) {
    const set = this.getSet(key);
    const type = opts && opts.type ? opts.type : 'map';
    let tex = set.map;
    if (type === 'normal') tex = set.normalMap || null;
    else if (type === 'roughness') tex = set.roughnessMap || null;
    else if (type === 'emissive') tex = set.emissiveMap || null;
    if (!tex || !opts || opts.repeat === undefined) return tex;
    const rx = Array.isArray(opts.repeat) ? opts.repeat[0] : opts.repeat;
    const ry = Array.isArray(opts.repeat) ? opts.repeat[1] : opts.repeat;
    const vkey = key + '|' + type + '|' + rx + 'x' + ry;
    let v = variants.get(vkey);
    if (!v) {
      v = tex.clone();
      v.repeat.set(rx, ry);
      v.needsUpdate = true;
      variants.set(vkey, v);
    }
    return v;
  },

  /**
   * getSet(key) → {map, normalMap, roughnessMap, emissiveMap, alpha, meta} (cached; maps may be
   * null when a key has none). Facade sets carry `meta = {bays, floors, tileW, tileH}` (one
   * texture tile covers tileW × tileH meters) and an emissive night-window map.
   * @param {string} key
   * @returns {{map: THREE.Texture, normalMap: THREE.Texture|null, roughnessMap: THREE.Texture|null, emissiveMap: THREE.Texture|null, alpha: boolean, meta: object}}
   */
  getSet(key) {
    let set = sets.get(key);
    if (!set) {
      set = buildSet(String(key));
      sets.set(key, set);
    }
    return set;
  },

  /**
   * has(key) → true when `key` is a known texture key.
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this.keys.indexOf(key) >= 0;
  },

  /**
   * meta(key) → metadata of a texture set ({tile}, facade {bays, floors, tileW, tileH},
   * atlas {atlas}, {aspect} ...).
   * @param {string} key
   * @returns {object}
   */
  meta(key) {
    return this.getSet(key).meta;
  },

  /**
   * atlas(key) → {cols, rows, cells:[names]} | null for atlas textures (road_markings,
   * sign_atlas, neon_atlas, particle_atlas, sprite_atlas).
   * @param {string} key
   * @returns {{cols:number, rows:number, cells:string[]}|null}
   */
  atlas(key) {
    return ATLASES[key] || null;
  },

  /**
   * atlasUV(key, cell, out?) → {u0, v0, u1, v1} UV rectangle of an atlas cell (name or index;
   * v is in three.js convention, v=1 at the top). The default `out` object is reused.
   * @param {string} key
   * @param {string|number} cell
   * @param {{u0:number,v0:number,u1:number,v1:number}} [out]
   * @returns {{u0:number,v0:number,u1:number,v1:number}}
   */
  atlasUV(key, cell, out) {
    const o = out || uvOut;
    const a = ATLASES[key];
    o.u0 = 0; o.v0 = 0; o.u1 = 1; o.v1 = 1;
    if (!a) return o;
    let i = typeof cell === 'number' ? cell : a.cells.indexOf(cell);
    if (i < 0) i = 0;
    i %= a.cols * a.rows;
    const col = i % a.cols;
    const row = Math.floor(i / a.cols);
    o.u0 = col / a.cols;
    o.u1 = (col + 1) / a.cols;
    o.v1 = 1 - row / a.rows;
    o.v0 = 1 - (row + 1) / a.rows;
    return o;
  },

  /**
   * makeSign(text, style?) → cached THREE.Texture with a rendered sign.
   * `style` is a preset name ('shop'|'neon'|'road'|'billboard'|'plate'|'danger'|'wood'|'info')
   * or an object {w, h, bg, fg, border, neon, vertical, sub} (colours as hex numbers).
   * `texture.userData.aspect` = width / height.
   * @param {string} text
   * @param {string|object} [style]
   * @returns {THREE.Texture}
   */
  makeSign(text, style) {
    const preset = typeof style === 'string' ? SIGN_STYLES[style] || SIGN_STYLES.shop : SIGN_STYLES.shop;
    const st = typeof style === 'object' && style ? Object.assign({}, preset, style) : preset;
    const ckey = String(text) + '|' + JSON.stringify(st);
    let tex = signs.get(ckey);
    if (tex) return tex;
    const k = G.quality ? G.quality.get('textureSize') || 1 : 1;
    const w = Math.max(32, Math.round((st.w || 256) * k));
    const h = Math.max(16, Math.round((st.h || 64) * k));
    const c = makeCanvas(w, h);
    try {
      drawSign(c.getContext('2d'), 0, 0, w, h, String(text), st, st.sub || null);
    } catch (err) {
      reportError(err, 'textures', 'makeSign');
    }
    tex = toTexture(c, true, { clamp: true });
    tex.name = 'sign:' + text;
    tex.userData.aspect = w / h;
    signs.set(ckey, tex);
    return tex;
  },

  /**
   * shopName(rngOrSeed, kind?) → fictional Japanese shop name ("ミナト食堂").
   * kind: 'shop'|'food'|'bar'|'tech'|'service'|'fun' (random when omitted).
   * @param {RNG|number|string} rngOrSeed
   * @param {string} [kind]
   * @returns {string}
   */
  shopName(rngOrSeed, kind) {
    const rng = rngOrSeed instanceof RNG ? rngOrSeed : new RNG(rngOrSeed === undefined ? 1 : rngOrSeed);
    return shopName(rng, kind);
  },

  /**
   * slogan(rngOrSeed) → short fictional advertising slogan (billboards).
   * @param {RNG|number|string} rngOrSeed
   * @returns {string}
   */
  slogan(rngOrSeed) {
    const rng = rngOrSeed instanceof RNG ? rngOrSeed : new RNG(rngOrSeed === undefined ? 1 : rngOrSeed);
    return rng.pick(SLOGANS);
  },

  init() {
    G.events.on('quality:change', (e) => {
      if (e.reason !== 'level' && e.reason !== 'detect') return;
      const aniso = G.quality.get('anisotropy') || 1;
      const apply = (t) => {
        if (t && t.anisotropy !== aniso) {
          t.anisotropy = aniso;
          t.needsUpdate = true;
        }
      };
      sets.forEach((s) => {
        apply(s.map);
        apply(s.normalMap);
        apply(s.roughnessMap);
        if (s.emissiveMap !== s.map) apply(s.emissiveMap);
      });
      variants.forEach(apply);
    });
  },
});

export default textures;
