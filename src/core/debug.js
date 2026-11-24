// MUGEN CITY — debug / test API (G.debug, window.__game, ARCHITECTURE §19).
//
// Tests never depend on wall-clock frame rate: drive the simulation with
// `G.debug.advance(seconds)` and `G.debug.settle()`. In test mode (`?test=1`) the realtime loop
// is not started at all (add `&live=1` to keep it running for manual debugging).

import * as THREE from 'three';
import { G, registerSystem, reportError, clearErrors } from './game.js';

// ---- global error capture (installed at import time so boot errors are recorded too) ---------

if (typeof window !== 'undefined') {
  window.__game = G;
  window.addEventListener('error', (e) => {
    // resource errors (no message) are ignored: the game loads nothing at runtime
    if (!e || (!e.error && !e.message)) return;
    reportError(e.error || new Error(String(e.message) + ' @' + e.filename + ':' + e.lineno), 'window', 'error');
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e ? e.reason : null;
    reportError(r instanceof Error ? r : new Error('unhandled rejection: ' + String(r)), 'window', 'promise');
  });
}

const CORE_NAMES = new Set();
const camOverride = { active: false, pos: new THREE.Vector3(), target: new THREE.Vector3() };
const _v = new THREE.Vector3();
const _box = new THREE.Box3();
const _sphere = new THREE.Sphere();
const _down = { x: 0, y: -1, z: 0 };
let overlay = null;
let overlayTimer = 0;
let logEnabled = false;

const showcaseState = {
  scene: null,
  camera: null,
  ground: null,
  object: null,
  prevParent: null,
};

function focusPoint(out) {
  if (camOverride.active) return out.copy(camOverride.target);
  if (G.player && G.player.pos) return out.copy(G.player.pos);
  if (G.camera) return out.setFromMatrixPosition(G.camera.matrixWorld);
  return out.set(0, 0, 0);
}

function applyCamOverride() {
  const cam = G.camera;
  if (!cam || !camOverride.active) return;
  cam.position.copy(camOverride.pos);
  cam.up.set(0, 1, 0);
  cam.lookAt(camOverride.target);
  cam.updateMatrixWorld();
}

function ensureShowcase() {
  const s = showcaseState;
  if (s.scene) return s;
  s.scene = new THREE.Scene();
  s.scene.name = 'showcase';
  s.scene.background = new THREE.Color(0x59626e);
  s.scene.add(new THREE.HemisphereLight(0xffffff, 0x7c8088, 1.15));
  const key = new THREE.DirectionalLight(0xfff4e6, 2.8);
  key.position.set(3.5, 6, 4.5);
  s.scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfd8ff, 0.9);
  rim.position.set(-4, 3, -5);
  s.scene.add(rim);
  s.ground = new THREE.Mesh(
    new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x4d5560, roughness: 0.95, metalness: 0 })
  );
  s.scene.add(s.ground);
  s.camera = new THREE.PerspectiveCamera(38, 390 / 844, 0.05, 2000);
  return s;
}

export const debug = registerSystem({
  name: 'debug',
  order: 99,
  runWhenPaused: true,

  /** [{msg, stack, system, t, count}] — any entry fails the smoke test */
  errors: G.errors,

  /**
   * log(tag, ...args) — console.log that is silent in release builds (enabled in dev builds
   * and with `?debug=1`).
   * @param {string} tag
   * @param {...any} args
   */
  log(tag, ...args) {
    if (logEnabled) console.log('[' + tag + ']', ...args);
  },

  /**
   * advance(seconds, {render=true}) → number of simulated frames. Runs the full game loop
   * synchronously at 60 Hz without touching the wall clock (fixed ticks, physics, updates,
   * jobs); renders one frame at the end unless `render: false`.
   * @param {number} seconds
   * @param {{render?: boolean}} [opts]
   * @returns {number}
   */
  advance(seconds, opts) {
    const n = Math.max(0, Math.round((Number(seconds) || 0) * 60));
    for (let i = 0; i < n; i++) G.frame(1 / 60, false);
    if (!opts || opts.render !== false) this.render();
    return n;
  },

  /**
   * render() — renders one frame without advancing the simulation (applies the debug camera).
   */
  render() {
    applyCamOverride();
    if (G.renderer && G.renderer.render) {
      try {
        G.renderer.render(0);
      } catch (err) {
        reportError(err, 'renderer', 'render');
      }
    }
  },

  /**
   * settle(maxMs=15000) → number of jobs still pending (0 = settled). Makes sure the chunks
   * around the camera target are requested, then flushes the job queue synchronously.
   * @param {number} [maxMs]
   * @returns {number}
   */
  settle(maxMs = 15000) {
    const t0 = performance.now();
    focusPoint(_v);
    try {
      if (G.chunks && G.chunks.ensureLoadedAround) G.chunks.ensureLoadedAround(_v.x, _v.z);
    } catch (err) {
      reportError(err, 'chunks', 'ensureLoadedAround');
    }
    const left = Math.max(0, maxMs - (performance.now() - t0));
    return G.jobs ? G.jobs.flush(left) : 0;
  },

  /**
   * teleport(x, z, y?) → {x, y, z}. Moves the player (or the camera when there is no player
   * yet) and synchronously loads the surroundings. `y` defaults to the ground height.
   * @param {number} x
   * @param {number} z
   * @param {number} [y]
   * @returns {{x:number, y:number, z:number}}
   */
  teleport(x, z, y) {
    try {
      if (G.chunks && G.chunks.ensureLoadedAround) G.chunks.ensureLoadedAround(x, z);
    } catch (err) {
      reportError(err, 'chunks', 'ensureLoadedAround');
    }
    let gy = y;
    if (!Number.isFinite(gy)) {
      gy = G.world && G.world.groundAt ? G.world.groundAt(x, z) : NaN;
      if (!Number.isFinite(gy) && G.physics && G.physics.world) {
        _v.set(x, 3000, z);
        const hit = G.physics.raycast(_v, _down, 6000, { groups: G.physics.GROUPS.TERRAIN | G.physics.GROUPS.STATIC });
        gy = hit ? hit.point.y : 0;
      }
      if (!Number.isFinite(gy)) gy = 0;
    }
    if (G.player && typeof G.player.teleport === 'function') {
      G.player.teleport(x, gy, z);
    } else if (G.camera) {
      const cam = G.camera;
      cam.position.set(x, gy + 3.2, z - 9);
      cam.lookAt(x, gy + 1.2, z);
      cam.updateMatrixWorld();
    }
    return { x, y: gy, z };
  },

  /**
   * setTime(hour) — sets the game clock (0..24).
   * @param {number} hour
   */
  setTime(hour) {
    G.time.setHour(hour);
  },

  /**
   * setWeather(name) — forwards to the weather system when present.
   * @param {string} name
   */
  setWeather(name) {
    const w = G.weather;
    if (!w) return;
    if (typeof w.set === 'function') w.set(name, { instant: true });
    else if (typeof w.setWeather === 'function') w.setWeather(name, { instant: true });
  },

  /**
   * setQuality(level) — 'low' | 'medium' | 'high' | 'ultra'.
   * @param {string} level
   */
  setQuality(level) {
    G.quality.set(level);
  },

  /**
   * cam(px, py, pz, tx, ty, tz) — free camera override for screenshots: places the camera at
   * p looking at t until `camRelease()` (applied after every system's lateUpdate).
   * @param {number} px @param {number} py @param {number} pz
   * @param {number} tx @param {number} ty @param {number} tz
   */
  cam(px, py, pz, tx, ty, tz) {
    camOverride.active = true;
    camOverride.pos.set(px, py, pz);
    camOverride.target.set(tx, ty, tz);
    applyCamOverride();
  },

  /**
   * camRelease() — removes the camera override.
   */
  camRelease() {
    camOverride.active = false;
  },

  /** camActive → true while the debug camera override is on. */
  get camActive() {
    return camOverride.active;
  },

  /**
   * spawnVehicle(id, opts?) → Vehicle | null. Spawns in front of the focus point by default.
   * @param {string} id
   * @param {object} [opts]
   * @returns {any}
   */
  spawnVehicle(id, opts) {
    if (!G.vehicles || typeof G.vehicles.spawn !== 'function') return null;
    const o = Object.assign({}, opts);
    if (!o.pos) {
      focusPoint(_v);
      o.pos = { x: _v.x + 4, y: _v.y + 0.5, z: _v.z + 4 };
    }
    return G.vehicles.spawn(id, o);
  },

  /**
   * enterVehicle(vehicle) — puts the player into the driver seat instantly.
   * @param {any} vehicle
   */
  enterVehicle(vehicle) {
    if (G.player && typeof G.player.enterVehicle === 'function' && vehicle) G.player.enterVehicle(vehicle, 0, { instant: true });
  },

  /**
   * spawnNpc(opts?) → Npc | null.
   * @param {object} [opts]
   * @returns {any}
   */
  spawnNpc(opts) {
    if (!G.npcs || typeof G.npcs.spawn !== 'function') return null;
    const o = Object.assign({}, opts);
    if (!o.pos) {
      focusPoint(_v);
      o.pos = { x: _v.x + 2, y: _v.y, z: _v.z + 3 };
    }
    return G.npcs.spawn(o);
  },

  /**
   * give(item, n=1) — gives an inventory item ('money' adds yen).
   * @param {string} item
   * @param {number} [n]
   */
  give(item, n = 1) {
    if (item === 'money') {
      if (G.economy && typeof G.economy.add === 'function') G.economy.add(n, 'debug');
      return;
    }
    if (G.inventory && typeof G.inventory.give === 'function') G.inventory.give(item, n);
  },

  /**
   * showcase(object3d | null, {distance, yaw=0.7, pitch=0.28, bg, ground=true, ui=false}) →
   * {scene, camera}. Isolated model viewer: renders only `object3d` in a neutral studio through
   * the normal pipeline (models face +Z, so yaw 0 looks at the front); the HUD is hidden unless
   * `ui: true`. `showcase(null)` restores the world view and puts the object back where it was.
   * @param {THREE.Object3D|null} object3d
   * @param {{distance?: number, yaw?: number, pitch?: number, bg?: number|string, ground?: boolean, ui?: boolean}} [opts]
   * @returns {{scene: THREE.Scene, camera: THREE.PerspectiveCamera}|null}
   */
  showcase(object3d, opts) {
    const s = showcaseState;
    if (s.object) {
      if (s.scene) s.scene.remove(s.object);
      if (s.prevParent) s.prevParent.add(s.object);
      s.object = null;
      s.prevParent = null;
    }
    const uiRoot = typeof document !== 'undefined' ? document.getElementById('ui') : null;
    if (!object3d) {
      if (G.renderer) G.renderer.setOverride(null, null);
      if (uiRoot) uiRoot.style.visibility = '';
      return null;
    }
    ensureShowcase();
    const o = opts || {};
    // the HUD / touch controls would cover the model
    if (uiRoot) uiRoot.style.visibility = o.ui === true ? '' : 'hidden';
    s.prevParent = object3d.parent || null;
    s.object = object3d;
    s.scene.add(object3d);
    s.scene.background.set(o.bg !== undefined ? o.bg : 0x59626e);
    if (G.renderer) {
      try {
        s.scene.environment = G.renderer.getDefaultEnvironment();
      } catch (err) {
        reportError(err, 'debug', 'showcase.env');
      }
    }
    object3d.updateMatrixWorld(true);
    _box.setFromObject(object3d);
    if (_box.isEmpty()) _box.set(_v.set(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
    _box.getBoundingSphere(_sphere);
    const radius = Math.max(0.05, _sphere.radius);
    const cam = s.camera;
    const aspect = G.renderer ? G.renderer.width / G.renderer.height : 390 / 844;
    cam.aspect = aspect;
    const vHalf = (cam.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * aspect);
    const fit = radius / Math.sin(Math.min(vHalf, hHalf));
    const dist = o.distance > 0 ? o.distance : fit * 1.08;
    const yaw = o.yaw !== undefined ? o.yaw : 0.7;
    const pitch = o.pitch !== undefined ? o.pitch : 0.28;
    cam.position.set(
      _sphere.center.x + Math.sin(yaw) * Math.cos(pitch) * dist,
      _sphere.center.y + Math.sin(pitch) * dist,
      _sphere.center.z + Math.cos(yaw) * Math.cos(pitch) * dist
    );
    cam.near = Math.max(0.02, dist * 0.01);
    cam.far = dist * 20 + radius * 10;
    cam.lookAt(_sphere.center);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    s.ground.visible = o.ground !== false;
    s.ground.position.set(_sphere.center.x, _box.min.y - 0.002, _sphere.center.z);
    s.ground.scale.setScalar(radius * 6);
    s.ground.material.color.copy(s.scene.background).multiplyScalar(0.82);
    if (G.renderer) G.renderer.setOverride(s.scene, cam);
    return { scene: s.scene, camera: cam };
  },

  /**
   * stats() → {fps, frameMs, cpuMs, drawCalls, tris, programs, textures, geometries, bodies,
   * activeBodies, colliders, entities, npcs, vehicles, chunks, jobs, heapMB, errors, quality,
   * pixelRatio, frame, tick, hour}. Plain numbers — safe to JSON.stringify.
   * @returns {object}
   */
  stats() {
    const info = G.renderer && G.renderer.info ? G.renderer.info() : null;
    const phys = G.physics && G.physics.stats ? G.physics.stats() : null;
    let heapMB = 0;
    try {
      if (performance.memory) heapMB = Math.round((performance.memory.usedJSHeapSize / 1048576) * 10) / 10;
    } catch (_) {
      /* ignore */
    }
    const count = (sys, type) => {
      if (sys && sys.list && typeof sys.list.length === 'number') return sys.list.length;
      return G.entities ? G.entities.byType(type).size : 0;
    };
    return {
      fps: Math.round(G.perf.fps * 10) / 10,
      frameMs: Math.round(G.perf.frameMs * 100) / 100,
      cpuMs: Math.round(G.perf.cpuMs * 100) / 100,
      drawCalls: info ? info.drawCalls : 0,
      tris: info ? info.tris : 0,
      programs: info ? info.programs : 0,
      textures: info ? info.textures : 0,
      geometries: info ? info.geometries : 0,
      bodies: phys ? phys.bodies : 0,
      activeBodies: phys ? phys.active : 0,
      colliders: phys ? phys.colliders : 0,
      entities: G.entities ? G.entities.count : 0,
      npcs: count(G.npcs, 'npc'),
      vehicles: count(G.vehicles, 'vehicle'),
      chunks: G.chunks && typeof G.chunks.loadedCount === 'number' ? G.chunks.loadedCount : 0,
      jobs: G.jobs ? G.jobs.pending : 0,
      heapMB,
      errors: G.errors.length,
      quality: G.quality ? G.quality.level : '',
      pixelRatio: G.renderer ? Math.round(G.renderer.pixelRatio * 100) / 100 : 1,
      frame: G.time.frame,
      tick: G.time.tick,
      hour: Math.round(G.time.hour * 100) / 100,
    };
  },

  /**
   * screenStats() → {width, height, mean, std, distinct}. Renders a frame and measures the
   * canvas content (luma mean / standard deviation 0..255, number of distinct sampled colours).
   * Used by the smoke test to prove that something was drawn.
   * @returns {{width:number, height:number, mean:number, std:number, distinct:number}}
   */
  screenStats() {
    const out = { width: 0, height: 0, mean: 0, std: 0, distinct: 0 };
    const canvas = G.renderer && G.renderer.canvas;
    if (!canvas) return out;
    this.render();
    const w = 48;
    const h = Math.max(8, Math.round((w * canvas.height) / Math.max(1, canvas.width)));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    let sum = 0;
    let sum2 = 0;
    const seen = new Set();
    const n = w * h;
    for (let i = 0; i < d.length; i += 4) {
      const l = d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
      sum += l;
      sum2 += l * l;
      seen.add(((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3));
    }
    out.width = canvas.width;
    out.height = canvas.height;
    out.mean = Math.round((sum / n) * 100) / 100;
    out.std = Math.round(Math.sqrt(Math.max(0, sum2 / n - (sum / n) * (sum / n))) * 100) / 100;
    out.distinct = seen.size;
    return out;
  },

  /**
   * register(name, fn) — adds a module specific helper as `G.debug[name]` (core helpers cannot
   * be overwritten).
   * @param {string} name
   * @param {Function} fn
   */
  register(name, fn) {
    if (CORE_NAMES.has(name)) {
      console.warn('[MUGEN] debug.register: "' + name + '" is a core helper and cannot be replaced');
      return;
    }
    this[name] = fn;
  },

  /**
   * clearErrors(match?) → number removed. Forgets recorded errors: all of them, or only those
   * matching a RegExp / substring / predicate (tests that provoke errors on purpose).
   * @param {RegExp|string|((e: object) => boolean)} [match]
   * @returns {number}
   */
  clearErrors(match) {
    return clearErrors(match);
  },

  init() {
    logEnabled = G.flags.dev || G.flags.debug;
    if (G.flags.debug) this.setOverlay(true);
    if (G.flags.dev && !G.flags.test) {
      window.addEventListener('keydown', (e) => {
        if (e.code === 'Backquote') this.setOverlay(!overlay);
      });
    }
  },

  start() {
    const f = G.flags;
    if (f.time !== null) this.setTime(f.time);
    if (f.weather !== null) this.setWeather(f.weather);
    if (f.pos !== null) this.teleport(f.pos[0], f.pos[1], f.pos.length > 2 ? f.pos[2] : undefined);
  },

  /**
   * setOverlay(on) — shows / hides the on-screen statistics overlay.
   * @param {boolean} on
   */
  setOverlay(on) {
    if (on && !overlay) {
      overlay = document.createElement('div');
      overlay.style.cssText =
        'position:absolute;left:50%;top:calc(var(--sat,0px) + 4px);transform:translateX(-50%);z-index:90;pointer-events:none;' +
        'font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#9effc0;background:rgba(0,0,0,.55);padding:4px 8px;' +
        'border-radius:6px;white-space:pre;text-align:left';
      (document.getElementById('game') || document.body).appendChild(overlay);
    } else if (!on && overlay) {
      overlay.remove();
      overlay = null;
    }
  },

  lateUpdate(dt) {
    if (camOverride.active) applyCamOverride();
    if (!overlay) return;
    overlayTimer -= G.time.realDt || dt;
    if (overlayTimer > 0) return;
    overlayTimer = 0.5;
    const s = this.stats();
    overlay.textContent =
      s.fps.toFixed(0) + ' fps  ' + s.frameMs.toFixed(1) + ' ms  cpu ' + s.cpuMs.toFixed(1) + '\n' +
      'draw ' + s.drawCalls + '  tris ' + (s.tris / 1000).toFixed(0) + 'k  q ' + s.quality + ' @' + s.pixelRatio + '\n' +
      'bodies ' + s.activeBodies + '/' + s.bodies + '  ent ' + s.entities + '  jobs ' + s.jobs + '  err ' + s.errors;
  },
});

for (const k of Object.keys(debug)) CORE_NAMES.add(k);
['errors', 'camActive'].forEach((k) => CORE_NAMES.add(k));

export default debug;
