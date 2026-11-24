// MUGEN CITY — G singleton, system registry and main loop (ARCHITECTURE §3.1 / §3.2).
//
//   import { G, registerSystem } from '../core/game.js';
//
// A system object *is* its public API: `registerSystem({name:'traffic', ...})` makes it available
// as `G.traffic` immediately. Never import another gameplay system's module — go through `G.<name>`.

import { CONFIG } from './config.js';
import { EventBus } from './events.js';

const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__ === true;
const MAX_ERRORS = 200;

/** @type {{msg:string, stack:string, system:string, t:number, count:number}[]} */
const errors = [];
const errorIndex = new Map();

/**
 * reportError(err, system='core', phase='') — records an error in `G.debug.errors` (deduplicated
 * by message + system) and logs it once to the console. Never throws.
 * @param {any} err
 * @param {string} [system]
 * @param {string} [phase]
 */
export function reportError(err, system = 'core', phase = '') {
  try {
    const msg = err && err.message !== undefined ? String(err.message) : String(err);
    const where = phase ? system + '.' + phase : system;
    const key = where + '|' + msg;
    const known = errorIndex.get(key);
    if (known) {
      known.count++;
      return;
    }
    const entry = {
      msg,
      stack: err && err.stack ? String(err.stack) : '',
      system: where,
      t: G.time ? G.time.now : 0,
      count: 1,
    };
    errorIndex.set(key, entry);
    if (errors.length < MAX_ERRORS) errors.push(entry);
    console.error('[MUGEN] error in ' + where + ': ' + (entry.stack || msg));
  } catch (_) {
    /* never throw from the error path */
  }
}

/**
 * clearErrors(match?) → number of removed entries. Removes recorded errors (all, or those whose
 * `msg + stack` matches a RegExp / contains a string / satisfies a predicate) so they can be
 * recorded again. For tests that provoke errors on purpose.
 * @param {RegExp|string|((e: object) => boolean)} [match]
 * @returns {number}
 */
export function clearErrors(match) {
  let removed = 0;
  for (let i = errors.length - 1; i >= 0; i--) {
    const e = errors[i];
    const text = e.msg + '\n' + e.stack;
    const hit =
      match === undefined || match === null
        ? true
        : typeof match === 'function'
          ? match(e) === true
          : match instanceof RegExp
            ? match.test(text)
            : text.indexOf(String(match)) >= 0;
    if (!hit) continue;
    errors.splice(i, 1);
    removed++;
    errorIndex.forEach((entry, key) => {
      if (entry === e) errorIndex.delete(key);
    });
  }
  if (match === undefined || match === null) errorIndex.clear();
  return removed;
}

function parseFlags() {
  const f = {
    /** dev build (dist/dev.html) */
    dev: IS_DEV,
    /** ?test=1 — deterministic test mode (no title, no audio, no save, manual stepping) */
    test: false,
    /** ?live=1 — keep the realtime loop running even in test mode */
    live: false,
    /** ?debug=1 — show the debug overlay, enable G.debug.log */
    debug: false,
    /** ?touch=1|0 — force touch / desktop controls */
    touch: null,
    /** ?q=low|medium|high|ultra */
    quality: null,
    /** ?seed=N */
    seed: null,
    /** ?pos=x,z */
    pos: null,
    /** ?time=h */
    time: null,
    /** ?weather=name */
    weather: null,
  };
  try {
    const p = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
    f.test = p.get('test') === '1';
    f.live = p.get('live') === '1';
    f.debug = p.get('debug') === '1';
    if (p.has('touch')) f.touch = p.get('touch') !== '0';
    const q = p.get('q');
    if (q === 'low' || q === 'medium' || q === 'high' || q === 'ultra') f.quality = q;
    if (p.has('seed')) {
      const s = Number(p.get('seed'));
      if (Number.isFinite(s)) f.seed = s;
    }
    if (p.has('pos')) {
      const parts = String(p.get('pos')).split(',').map(Number);
      if (parts.length >= 2 && parts.every(Number.isFinite)) f.pos = parts;
    }
    if (p.has('time')) {
      const h = Number(p.get('time'));
      if (Number.isFinite(h)) f.time = h;
    }
    if (p.has('weather')) f.weather = String(p.get('weather'));
  } catch (_) {
    /* sandboxed / no location: production never needs URL params */
  }
  return f;
}

const flags = parseFlags();
if (flags.seed !== null) CONFIG.WORLD_SEED = flags.seed >>> 0;

const events = new EventBus(reportError);

const time = {
  /** real seconds since boot (advances while paused; simulated time in G.debug.advance) */
  now: 0,
  /** scaled simulation seconds (does not advance while paused) */
  game: 0,
  /** dt of the current rendered frame (scaled, clamped to 0.1; 0 while paused) */
  dt: 0,
  /** unscaled dt of the current frame (clamped to 0.1) */
  realDt: 0,
  fixedDt: CONFIG.FIXED_DT,
  /** time scale (1 = realtime, < 1 slow motion) */
  scale: 1,
  paused: false,
  /** time of day, 0..24 float */
  hour: CONFIG.START_HOUR,
  /** day counter, starts at 1 */
  day: 1,
  dayLengthSec: CONFIG.DAY_LENGTH_SEC,
  /** rendered frame counter */
  frame: 0,
  /** fixed tick counter */
  tick: 0,
  /** interpolation factor between the previous and current fixed tick (0..1) */
  alpha: 0,
  /**
   * setHour(h) — jumps the game clock to hour h (0..24) and emits `time:hour {hour, jump:true}`.
   * @param {number} h
   */
  setHour(h) {
    let v = Number(h);
    if (!Number.isFinite(v)) return;
    v = ((v % 24) + 24) % 24;
    time.hour = v;
    lastHourInt = Math.floor(v);
    hourEvent.hour = lastHourInt;
    hourEvent.jump = true;
    events.emit('time:hour', hourEvent);
    hourEvent.jump = false;
  },
};

let lastHourInt = Math.floor(time.hour);
const hourEvent = { hour: lastHourInt, jump: false };
const dayEvent = { day: 1 };

/** @type {any[]} sorted by (order, registration sequence) */
const systems = [];
const byName = new Map();
const inited = new WeakSet();
const started = new WeakSet();
let seq = 0;
const phaseLists = { fixedUpdate: [], postPhysics: [], update: [], lateUpdate: [] };

function rebuildPhaseLists() {
  for (const phase in phaseLists) {
    const list = phaseLists[phase];
    list.length = 0;
    for (let i = 0; i < systems.length; i++) {
      if (typeof systems[i][phase] === 'function') list.push(systems[i]);
    }
  }
}

function runPhase(phase, dt) {
  const list = phaseLists[phase];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    try {
      s[phase](dt);
    } catch (err) {
      reportError(err, s.name, phase);
    }
  }
}

function runPhasePaused(phase, dt) {
  const list = phaseLists[phase];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.runWhenPaused !== true) continue;
    try {
      s[phase](dt);
    } catch (err) {
      reportError(err, s.name, phase);
    }
  }
}

/**
 * The global game object. Systems appear on it by name (`G.physics`, `G.player`, ...).
 */
export const G = {
  version: CONFIG.VERSION,
  config: CONFIG,
  flags,
  events,
  time,
  /** all registered systems, sorted by order */
  systems,
  /** THREE.Scene / THREE.PerspectiveCamera — set by the renderer system */
  scene: null,
  camera: null,
  /** boot state: 'boot' → 'init' → 'started' → 'ready' */
  state: 'boot',
  /** true once every system has been initialised and started and the first load finished */
  ready: false,
  /** true while the realtime loop is running */
  running: false,
  /** true when started without an existing save */
  newGame: true,
  /** frame statistics (smoothed) */
  perf: { fps: 60, frameMs: 16.7, cpuMs: 0, steps: 0 },
  /** active suspend reasons (loop is skipped while non-empty) */
  suspended: new Set(),
  errors,
  reportError,
  registerSystem,

  /**
   * initSystems(onProgress?) → Promise. Calls `init()` of every system in order (awaiting async
   * inits). Errors of non-critical systems are recorded and skipped; `critical: true` systems
   * rethrow (fatal). Systems registered while this runs are picked up too.
   * @param {(fraction: number, system: string) => (void|Promise<void>)} [onProgress]
   */
  async initSystems(onProgress) {
    G.state = 'init';
    let done = 0;
    for (;;) {
      let next = null;
      for (let i = 0; i < systems.length; i++) {
        if (!inited.has(systems[i])) {
          next = systems[i];
          break;
        }
      }
      if (!next) break;
      inited.add(next);
      if (onProgress) await onProgress(done / Math.max(1, systems.length), next.name);
      if (typeof next.init === 'function') {
        try {
          await next.init();
        } catch (err) {
          reportError(err, next.name, 'init');
          if (next.critical) throw err;
        }
      }
      done++;
    }
    if (onProgress) await onProgress(1, '');
  },

  /**
   * startSystems() — calls `start()` of every system in order (after all inits + save load).
   */
  startSystems() {
    for (let i = 0; i < systems.length; i++) {
      const s = systems[i];
      if (started.has(s) || !inited.has(s)) continue;
      started.add(s);
      if (typeof s.start === 'function') {
        try {
          s.start();
        } catch (err) {
          reportError(err, s.name, 'start');
        }
      }
    }
    G.state = 'started';
  },

  /**
   * finishBoot() — marks the game ready (`G.ready = true`) and emits `game:ready {}` then
   * `game:start {newGame}`. Systems registered during boot after the init pass are initialised
   * here; later registrations are initialised immediately.
   */
  finishBoot() {
    for (let i = 0; i < systems.length; i++) {
      if (!inited.has(systems[i])) lateInit(systems[i]);
    }
    G.state = 'ready';
    G.ready = true;
    events.emit('game:ready', {});
    events.emit('game:start', { newGame: G.newGame });
  },

  /**
   * frame(realDt, render=true) — runs one full frame of the loop (ARCHITECTURE §3.2):
   * input.poll → fixed steps (max 3) → update → lateUpdate → render → jobs.
   * Called by the realtime loop and by `G.debug.advance`.
   * @param {number} realDt seconds since the previous frame (clamped to 0.1)
   * @param {boolean} [render]
   */
  frame(realDt, render = true) {
    if (!(realDt >= 0)) realDt = 0;
    if (realDt > CONFIG.MAX_FRAME_DT) realDt = CONFIG.MAX_FRAME_DT;
    time.frame++;
    time.realDt = realDt;
    time.now += realDt;

    const input = G.input;
    if (input) {
      try {
        input.poll(realDt);
      } catch (err) {
        reportError(err, 'input', 'poll');
      }
    }

    if (!time.paused) {
      const dt = realDt * time.scale;
      const fixedDt = time.fixedDt;
      acc += dt;
      let steps = 0;
      while (acc >= fixedDt && steps < CONFIG.MAX_FIXED_STEPS) {
        acc -= fixedDt;
        steps++;
        time.tick++;
        if (input) input.beginFixed();
        runPhase('fixedUpdate', fixedDt);
        const physics = G.physics;
        if (physics && physics.world) {
          try {
            physics.step();
          } catch (err) {
            reportError(err, 'physics', 'step');
          }
        }
        runPhase('postPhysics', fixedDt);
        const entities = G.entities;
        if (entities) {
          try {
            entities.rehash();
          } catch (err) {
            reportError(err, 'entities', 'rehash');
          }
        }
      }
      if (input && steps > 0) input.endFixed();
      if (acc >= fixedDt) acc %= fixedDt; // drop the backlog, keep the fraction
      G.perf.steps = steps;
      time.alpha = acc / fixedDt;
      time.dt = dt;
      time.game += dt;
      advanceClock(dt);
      runPhase('update', dt);
      runPhase('lateUpdate', dt);
    } else {
      time.dt = 0;
      G.perf.steps = 0;
      runPhasePaused('update', realDt);
      runPhasePaused('lateUpdate', realDt);
    }

    if (render) {
      const renderer = G.renderer;
      if (renderer && renderer.render) {
        try {
          renderer.render(realDt);
        } catch (err) {
          reportError(err, 'renderer', 'render');
        }
      }
    }

    const jobs = G.jobs;
    if (jobs) {
      try {
        jobs.run(jobs.loading ? CONFIG.JOBS_BUDGET_LOADING_MS : jobs.budgetMs);
      } catch (err) {
        reportError(err, 'jobs', 'run');
      }
    }
  },

  /**
   * run() — starts the realtime requestAnimationFrame loop (no-op when already running).
   */
  run() {
    if (G.running) return;
    G.running = true;
    lastT = -1;
    rafId = requestAnimationFrame(tick);
  },

  /**
   * stop() — stops the realtime loop (frames can still be driven with `G.frame`).
   */
  stop() {
    G.running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  },

  /**
   * setPaused(paused) — pauses / resumes the simulation. While paused only systems with
   * `runWhenPaused: true` receive update/lateUpdate (with the real dt). Calls `onPause(paused)`
   * on every system and emits `game:pause {paused}`.
   * @param {boolean} paused
   */
  setPaused(paused) {
    paused = !!paused;
    if (time.paused === paused) return;
    time.paused = paused;
    for (let i = 0; i < systems.length; i++) {
      const s = systems[i];
      if (typeof s.onPause === 'function') {
        try {
          s.onPause(paused);
        } catch (err) {
          reportError(err, s.name, 'onPause');
        }
      }
    }
    events.emit('game:pause', { paused });
  },

  /**
   * suspend(reason, on) — adds / removes a suspend reason ('rotate', 'contextlost', 'hidden').
   * While any reason is active the realtime loop neither simulates nor renders.
   * @param {string} reason
   * @param {boolean} on
   */
  suspend(reason, on) {
    if (on) G.suspended.add(reason);
    else G.suspended.delete(reason);
  },
};

let acc = 0;
let rafId = 0;
let lastT = -1;

function advanceClock(dt) {
  if (dt <= 0) return;
  let h = time.hour + (dt * 24) / time.dayLengthSec;
  if (h >= 24) {
    h -= 24;
    time.day++;
    time.hour = h;
    dayEvent.day = time.day;
    events.emit('time:day', dayEvent);
  } else {
    time.hour = h;
  }
  const hi = Math.floor(h);
  if (hi !== lastHourInt) {
    lastHourInt = hi;
    hourEvent.hour = hi;
    events.emit('time:hour', hourEvent);
  }
}

function tick(tMs) {
  if (!G.running) return;
  rafId = requestAnimationFrame(tick);
  if (lastT < 0 || G.suspended.size > 0) {
    lastT = tMs;
    if (G.suspended.size > 0) return;
  }
  const realDt = (tMs - lastT) / 1000;
  lastT = tMs;
  const t0 = performance.now();
  try {
    G.frame(realDt, true);
  } catch (err) {
    reportError(err, 'core', 'frame');
  }
  const cpu = performance.now() - t0;
  const perf = G.perf;
  const ms = realDt * 1000;
  if (ms > 0 && ms < 1000) {
    perf.frameMs += (ms - perf.frameMs) * 0.08;
    perf.fps = 1000 / Math.max(0.001, perf.frameMs);
  }
  perf.cpuMs += (cpu - perf.cpuMs) * 0.08;
  const quality = G.quality;
  if (quality && quality.sampleFrame) quality.sampleFrame(ms, cpu);
}

/**
 * registerSystem(sys) → sys. Registers a system and exposes it as `G[sys.name]` immediately.
 *
 *   { name, order, init(), start(), fixedUpdate(dt), postPhysics(dt), update(dt), lateUpdate(dt),
 *     onPause(paused), runWhenPaused?: boolean, critical?: boolean, stub?: boolean }
 *
 * - Registering a name twice replaces the earlier system (real modules override stubs);
 *   a system marked `stub: true` never replaces an existing one.
 * - Systems registered after boot are initialised and started right away.
 * @template T
 * @param {T & {name: string, order?: number}} sys
 * @returns {T}
 */
export function registerSystem(sys) {
  if (!sys || typeof sys.name !== 'string' || !sys.name) {
    reportError(new Error('registerSystem: system needs a name'), 'core', 'registerSystem');
    return sys;
  }
  const existing = byName.get(sys.name);
  if (existing) {
    if (sys.stub === true) return existing;
    const idx = systems.indexOf(existing);
    if (idx >= 0) systems.splice(idx, 1);
  }
  if (typeof sys.order !== 'number') sys.order = 50;
  sys._seq = seq++;
  byName.set(sys.name, sys);
  G[sys.name] = sys;
  let at = systems.length;
  for (let i = 0; i < systems.length; i++) {
    if (systems[i].order > sys.order) {
      at = i;
      break;
    }
  }
  systems.splice(at, 0, sys);
  rebuildPhaseLists();
  if (G.ready) lateInit(sys);
  return sys;
}

async function lateInit(sys) {
  inited.add(sys);
  started.add(sys);
  try {
    if (typeof sys.init === 'function') await sys.init();
    if (typeof sys.start === 'function') sys.start();
  } catch (err) {
    reportError(err, sys.name, 'lateInit');
  }
}
