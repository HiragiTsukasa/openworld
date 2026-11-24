// MUGEN CITY — persistence: save registry (G.save, ARCHITECTURE §3.7) and user settings (G.settings).
//
//   G.save.register('economy', { save: () => ({money}), load: (d) => { money = d.money; } });
//
// Everything is stored as JSON in localStorage (every access wrapped in try/catch: sandboxed
// iframes may throw). Saving is disabled in test mode (`?test=1`).

import { G, registerSystem, reportError } from './game.js';
import { CONFIG } from './config.js';

function storageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

function storageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (_) {
    return false;
  }
}

function storageRemove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (_) {
    /* ignore */
  }
}

// ------------------------------------------------------------------------------------------------
// Settings (independent from the game save: survives "new game")
// ------------------------------------------------------------------------------------------------

const SETTING_DEFAULTS = {
  quality: 'auto', // 'auto' | 'low' | 'medium' | 'high' | 'ultra'
  dynamicResolution: true,
  lookSensitivity: 1,
  invertY: false,
  haptics: true,
  pointerLock: true,
  volumeMaster: 0.8,
  volumeSfx: 0.9,
  volumeMusic: 0.6,
  volumeAmbient: 0.7,
  leftHanded: false,
  showFps: false,
};

let settingsData = null;

function loadSettings() {
  settingsData = Object.assign({}, SETTING_DEFAULTS);
  if (G.flags.test) return;
  const raw = storageGet(CONFIG.SETTINGS_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') Object.assign(settingsData, parsed);
  } catch (_) {
    /* corrupted settings: keep defaults */
  }
}

/**
 * User settings store (`G.settings`). Persisted separately from the save game.
 */
export const settings = {
  /** default values (read-only) */
  defaults: SETTING_DEFAULTS,

  /**
   * get(key, fallback?) → stored value, the built-in default, or `fallback`.
   * @param {string} key
   * @param {any} [fallback]
   * @returns {any}
   */
  get(key, fallback) {
    if (!settingsData) loadSettings();
    const v = settingsData[key];
    return v === undefined ? fallback : v;
  },

  /**
   * set(key, value) — stores a setting, persists it and emits `settings:change {key, value}`.
   * @param {string} key
   * @param {any} value
   */
  set(key, value) {
    if (!settingsData) loadSettings();
    if (settingsData[key] === value) return;
    settingsData[key] = value;
    if (!G.flags.test) storageSet(CONFIG.SETTINGS_KEY, JSON.stringify(settingsData));
    G.events.emit('settings:change', { key, value });
  },

  /**
   * all() → shallow copy of every setting.
   * @returns {Record<string, any>}
   */
  all() {
    if (!settingsData) loadSettings();
    return Object.assign({}, settingsData);
  },

  /**
   * reset() — restores every setting to its default.
   */
  reset() {
    settingsData = Object.assign({}, SETTING_DEFAULTS);
    if (!G.flags.test) storageRemove(CONFIG.SETTINGS_KEY);
    G.events.emit('settings:change', { key: '*', value: null });
  },
};

G.settings = settings;

// ------------------------------------------------------------------------------------------------
// Save registry
// ------------------------------------------------------------------------------------------------

/** @type {Map<string, {save: () => any, load: (data: any) => void}>} */
const handlers = new Map();
let autosaveTimer = 0;
let pendingData = null;

function readSave() {
  const raw = storageGet(CONFIG.SAVE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.data && typeof parsed.data === 'object') return parsed;
  } catch (_) {
    /* corrupted save */
  }
  return null;
}

export const save = registerSystem({
  name: 'save',
  order: 95,
  runWhenPaused: true,

  /** false in test mode or when disabled by the game (e.g. during missions / cutscenes) */
  enabled: !G.flags.test,
  /** seconds between autosaves */
  interval: CONFIG.AUTOSAVE_SEC,
  /** Date.now() of the last successful save (0 = never) */
  lastSaved: 0,

  /**
   * register(key, {save, load}) — registers a persistence handler. `save()` returns plain JSON
   * data; `load(data)` restores it. If a save was already loaded, `load` is called right away
   * with this key's data (late registration).
   * @param {string} key
   * @param {{save: () => any, load: (data: any) => void}} handler
   */
  register(key, handler) {
    if (!handler || typeof handler.save !== 'function' || typeof handler.load !== 'function') {
      reportError(new Error('save.register(' + key + '): handler needs save() and load()'), 'save', 'register');
      return;
    }
    handlers.set(key, handler);
    if (pendingData && pendingData[key] !== undefined) {
      try {
        handler.load(pendingData[key]);
      } catch (err) {
        reportError(err, 'save', 'load:' + key);
      }
    }
  },

  /**
   * unregister(key) — removes a persistence handler.
   * @param {string} key
   */
  unregister(key) {
    handlers.delete(key);
  },

  /**
   * hasSave() → true when a stored save game exists.
   * @returns {boolean}
   */
  hasSave() {
    if (G.flags.test) return false;
    return readSave() !== null;
  },

  /**
   * collect() → {v, t, data:{key: plainData}} snapshot of every registered handler (not written).
   * @returns {{v:number, t:number, data:Record<string, any>}}
   */
  collect() {
    const data = {};
    handlers.forEach((h, key) => {
      try {
        const d = h.save();
        if (d !== undefined) data[key] = d;
      } catch (err) {
        reportError(err, 'save', 'save:' + key);
      }
    });
    return { v: 1, t: Date.now(), data };
  },

  /**
   * now() → true when the save was written. Emits `save:before {}` first.
   * No-op (returns false) while saving is disabled.
   * @returns {boolean}
   */
  now() {
    if (!this.enabled || G.flags.test) return false;
    G.events.emit('save:before', {});
    let json;
    try {
      json = JSON.stringify(this.collect());
    } catch (err) {
      reportError(err, 'save', 'stringify');
      return false;
    }
    const ok = storageSet(CONFIG.SAVE_KEY, json);
    if (ok) this.lastSaved = Date.now();
    autosaveTimer = 0;
    return ok;
  },

  /**
   * load() → true when a save existed and was applied (each handler's `load(data)` is called
   * with its own slice). Emits `save:loaded {}`.
   * @returns {boolean}
   */
  load() {
    if (G.flags.test) return false;
    const stored = readSave();
    if (!stored) return false;
    pendingData = stored.data;
    handlers.forEach((h, key) => {
      if (stored.data[key] === undefined) return;
      try {
        h.load(stored.data[key]);
      } catch (err) {
        reportError(err, 'save', 'load:' + key);
      }
    });
    G.events.emit('save:loaded', {});
    return true;
  },

  /**
   * apply(snapshot) → true. Applies a snapshot produced by `collect()` without touching storage
   * (tests, cloud saves).
   * @param {{data: Record<string, any>}} snapshot
   * @returns {boolean}
   */
  apply(snapshot) {
    if (!snapshot || !snapshot.data) return false;
    pendingData = snapshot.data;
    handlers.forEach((h, key) => {
      if (snapshot.data[key] === undefined) return;
      try {
        h.load(snapshot.data[key]);
      } catch (err) {
        reportError(err, 'save', 'load:' + key);
      }
    });
    G.events.emit('save:loaded', {});
    return true;
  },

  /**
   * reset() — deletes the stored save game (settings are kept).
   */
  reset() {
    pendingData = null;
    storageRemove(CONFIG.SAVE_KEY);
    this.lastSaved = 0;
  },

  init() {
    loadSettings();
    if (G.flags.test) return;
    const flush = () => {
      if (G.ready) this.now();
    };
    try {
      window.addEventListener('pagehide', flush);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
      });
    } catch (_) {
      /* ignore */
    }
  },

  update(dt) {
    if (!this.enabled || G.flags.test) return;
    autosaveTimer += G.time.realDt || dt;
    if (autosaveTimer >= this.interval) {
      autosaveTimer = 0;
      if (!G.time.paused) this.now();
    }
  },
});

export default save;
