// MUGEN CITY — quality presets + dynamic resolution (G.quality, ARCHITECTURE §3.8).
//
//   G.quality.level            'low' | 'medium' | 'high' | 'ultra'
//   G.quality.get('npcCap')    preset value for the current level
//   G.quality.pixelRatio       final canvas pixel ratio = min(devicePixelRatio, cap) × renderScale
//
// `auto` mode adapts renderScale (minRenderScale..1) to hold the frame time and emits
// `quality:change {level, prev, renderScale, pixelRatio, reason}` whenever anything changes.

import { G, registerSystem } from './game.js';
import { QUALITY_PRESETS, QUALITY_LEVELS } from './config.js';

const SCALE_STEP = 0.05;
const WINDOW_FRAMES = 30;

let winSum = 0;
let winCount = 0;
let overCount = 0;
let underCount = 0;
let raiseHoldoff = 6; // evaluation windows of good frames required before raising
let sinceRaise = 1e9;
const changeEvent = { level: 'high', prev: 'high', renderScale: 1, pixelRatio: 1, reason: '' };

function deviceRatio() {
  if (G.flags.test) return 1;
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
  return dpr > 0 ? dpr : 1;
}

function isCoarsePointer() {
  try {
    if (navigator.maxTouchPoints > 0) return true;
    return window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  } catch (_) {
    return false;
  }
}

export const quality = registerSystem({
  name: 'quality',
  order: 5,
  runWhenPaused: true,

  /** current preset id */
  level: 'high',
  /** true when the level was chosen automatically (no URL param / user setting) */
  autoLevel: true,
  /** dynamic resolution on/off */
  auto: true,
  /** 0.55..1 multiplier applied on top of the capped device pixel ratio */
  renderScale: 1,
  /** final pixel ratio used by the renderer */
  pixelRatio: 1,
  /** all level ids, worst → best */
  levels: QUALITY_LEVELS,

  /**
   * get(key) → preset value for the current level (undefined + one warning for unknown keys).
   * Keys: shadowMapSize, shadowDistance, bloom, msaa, maxPixelRatio, lodBias, npcCap, trafficCap,
   * particleCap, grassDensity, viewDistance, reflections, ... (see QUALITY_PRESETS in config.js).
   * @param {string} key
   * @returns {any}
   */
  get(key) {
    const preset = QUALITY_PRESETS[this.level];
    const v = preset[key];
    if (v === undefined && !warned.has(key)) {
      warned.add(key);
      console.warn('[MUGEN] quality.get: unknown key "' + key + '"');
    }
    return v;
  },

  /**
   * set(level, {persist=false}) → true when the level changed. Emits `quality:change`.
   * @param {'low'|'medium'|'high'|'ultra'} level
   * @param {{persist?: boolean}} [opts]
   * @returns {boolean}
   */
  set(level, opts) {
    if (!QUALITY_PRESETS[level]) {
      console.warn('[MUGEN] quality.set: unknown level "' + level + '"');
      return false;
    }
    if (opts && opts.persist && G.settings) G.settings.set('quality', level);
    if (level === this.level) return false;
    const prev = this.level;
    this.level = level;
    this.autoLevel = false;
    const min = QUALITY_PRESETS[level].minRenderScale;
    if (this.renderScale < min) this.renderScale = min;
    this._recompute();
    this._emit(prev, 'level');
    return true;
  },

  /**
   * setAuto(on) — enables / disables dynamic resolution (resets renderScale to 1 when disabled).
   * @param {boolean} on
   */
  setAuto(on) {
    this.auto = !!on && !G.flags.test;
    if (!this.auto && this.renderScale !== 1) this.setRenderScale(1, 'manual');
  },

  /**
   * setRenderScale(scale, reason='manual') — sets the resolution multiplier (clamped to the
   * preset's minRenderScale..1, quantized to 0.05). Emits `quality:change` when it changes.
   * @param {number} scale
   * @param {string} [reason]
   */
  setRenderScale(scale, reason = 'manual') {
    const min = QUALITY_PRESETS[this.level].minRenderScale;
    let s = Math.round(scale / SCALE_STEP) * SCALE_STEP;
    s = s < min ? min : s > 1 ? 1 : s;
    if (Math.abs(s - this.renderScale) < 1e-4) return;
    this.renderScale = s;
    this._recompute();
    this._emit(this.level, reason);
  },

  /**
   * detect(gpuName?) → recommended level for this device (heuristic: pointer type, cores,
   * memory, GPU string).
   * @param {string} [gpuName]
   * @returns {'low'|'medium'|'high'|'ultra'}
   */
  detect(gpuName) {
    const gpu = (gpuName || '').toLowerCase();
    if (/swiftshader|llvmpipe|software|basic render/.test(gpu)) return 'low';
    let cores = 4;
    let mem = 4;
    try {
      cores = navigator.hardwareConcurrency || 4;
      mem = navigator.deviceMemory || 4;
    } catch (_) {
      /* ignore */
    }
    if (isCoarsePointer()) {
      let ios = false;
      try {
        ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
      } catch (_) {
        /* ignore */
      }
      if (ios) return 'high';
      if (/mali-4|mali-t|adreno \(tm\) [2345]\d\d|powervr sgx/.test(gpu)) return 'low';
      if (cores >= 8 && mem >= 6) return 'high';
      if (cores >= 6 && mem >= 3) return 'medium';
      return 'low';
    }
    if (cores <= 2) return 'medium';
    return 'high';
  },

  /**
   * refineForGPU(gpuName) — called by the renderer once the GPU string is known; re-runs
   * `detect` when the level was chosen automatically.
   * @param {string} gpuName
   */
  refineForGPU(gpuName) {
    if (!this.autoLevel) return;
    const level = this.detect(gpuName);
    if (level !== this.level) {
      const prev = this.level;
      this.level = level;
      this._recompute();
      this._emit(prev, 'detect');
    }
  },

  /**
   * sampleFrame(frameMs, cpuMs) — feeds one realtime frame into the dynamic resolution
   * controller. Called by the core loop only.
   * @param {number} frameMs
   * @param {number} cpuMs
   */
  sampleFrame(frameMs, cpuMs) {
    if (!this.auto || frameMs <= 0 || frameMs > 250) return;
    if (G.time.paused || (G.jobs && G.jobs.loading)) return;
    winSum += frameMs;
    winCount++;
    sinceRaise++;
    if (winCount < WINDOW_FRAMES) return;
    const avg = winSum / winCount;
    winSum = 0;
    winCount = 0;
    const min = QUALITY_PRESETS[this.level].minRenderScale;
    if (avg > 21) {
      underCount = 0;
      overCount++;
      // the last raise was a mistake: wait longer before trying again
      if (sinceRaise < WINDOW_FRAMES * 4 && raiseHoldoff < 120) raiseHoldoff *= 2;
      if ((overCount >= 2 || avg > 30) && this.renderScale > min) {
        overCount = 0;
        this.setRenderScale(this.renderScale - (avg > 30 ? SCALE_STEP * 2 : SCALE_STEP), 'auto');
      }
    } else if (avg < 17.6) {
      overCount = 0;
      underCount++;
      if (underCount >= raiseHoldoff && this.renderScale < 1) {
        underCount = 0;
        sinceRaise = 0;
        this.setRenderScale(this.renderScale + SCALE_STEP, 'auto');
      }
    } else {
      overCount = 0;
      underCount = 0;
    }
    void cpuMs;
  },

  _recompute() {
    const cap = QUALITY_PRESETS[this.level].maxPixelRatio;
    const base = Math.min(deviceRatio(), cap);
    this.pixelRatio = Math.max(0.3, base * this.renderScale);
  },

  _emit(prev, reason) {
    changeEvent.level = this.level;
    changeEvent.prev = prev;
    changeEvent.renderScale = this.renderScale;
    changeEvent.pixelRatio = this.pixelRatio;
    changeEvent.reason = reason;
    G.events.emit('quality:change', changeEvent);
  },

  init() {
    const flagLevel = G.flags.quality;
    const stored = G.settings ? G.settings.get('quality', 'auto') : 'auto';
    if (flagLevel) {
      this.level = flagLevel;
      this.autoLevel = false;
    } else if (stored && stored !== 'auto' && QUALITY_PRESETS[stored]) {
      this.level = stored;
      this.autoLevel = false;
    } else {
      this.level = this.detect('');
      this.autoLevel = true;
    }
    this.auto = !G.flags.test && (G.settings ? G.settings.get('dynamicResolution', true) !== false : true);
    this.renderScale = 1;
    this._recompute();
    try {
      // devicePixelRatio changes when the window moves between screens / browser zoom
      window.addEventListener('resize', () => {
        const before = this.pixelRatio;
        this._recompute();
        if (Math.abs(before - this.pixelRatio) > 1e-3) this._emit(this.level, 'dpr');
      });
    } catch (_) {
      /* ignore */
    }
  },
});

const warned = new Set();

export default quality;
