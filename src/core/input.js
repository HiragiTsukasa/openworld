// MUGEN CITY — unified input (G.input, ARCHITECTURE §4).
//
// One action state for every device. Keyboard + mouse are handled here; on-screen touch controls
// (ui/touch.js) feed the same state through the `feed*` methods. Conventions:
//
//   move.x  +1 = right        move.y  +1 = forward
//   steer   +1 = right        throttle / brake  0..1
//   pitch   +1 = nose up      roll  +1 = right   yaw  +1 = right   lift  +1 = up
//   look.dx > 0 = turn right  look.dy > 0 = look down     (radians accumulated this frame)
//
// Button edges (`pressed` / `released`) are valid in both `update()` (per rendered frame) and
// `fixedUpdate()` (delivered exactly once to the first fixed tick after the edge happened).

import { Vector3 } from 'three';
import { G, registerSystem, reportError } from './game.js';
import { CONFIG } from './config.js';

/** Every action button name (ARCHITECTURE §4). */
export const BUTTONS = [
  'jump', 'sprint', 'crouch', 'attack', 'aim', 'interact', 'enterExit', 'reload', 'weaponNext',
  'weaponPrev', 'weaponWheel', 'handbrake', 'horn', 'lights', 'radio', 'camera', 'phone', 'map',
  'pause', 'emote', 'gadget', 'special1', 'special2',
];

/** Every input context. */
export const CONTEXTS = ['foot', 'car', 'bike', 'boat', 'heli', 'plane', 'tank', 'menu', 'photo'];

const CTX_GROUP = {
  foot: 'foot', menu: 'foot', photo: 'foot',
  car: 'ground', bike: 'ground', boat: 'ground', tank: 'ground',
  heli: 'air', plane: 'air',
};

const KEYS_FOOT = {
  jump: ['Space'], sprint: ['ShiftLeft', 'ShiftRight'], crouch: ['KeyC'], attack: ['KeyJ'], aim: ['KeyK'],
  interact: ['KeyE'], enterExit: ['KeyF'], reload: ['KeyR'], weaponNext: ['KeyQ'], weaponPrev: ['KeyZ'],
  weaponWheel: ['KeyT'], handbrake: ['KeyX'], horn: ['KeyH'], lights: ['KeyL'], radio: ['KeyN'],
  camera: ['KeyV'], phone: ['Tab'], map: ['KeyM'], pause: ['Escape', 'KeyP'], emote: ['KeyB'],
  gadget: ['KeyG'], special1: ['Digit1'], special2: ['Digit2'],
};
const KEYS_GROUND = Object.assign({}, KEYS_FOOT, {
  jump: [], reload: [], handbrake: ['Space', 'KeyX'], radio: ['KeyN', 'KeyR'],
});
const KEYS_AIR = Object.assign({}, KEYS_FOOT, {
  jump: [], reload: [], sprint: [], crouch: [], interact: [], weaponNext: [],
  handbrake: ['Space', 'KeyX'], radio: ['KeyN', 'KeyR'],
});
const KEYMAPS = { foot: KEYS_FOOT, ground: KEYS_GROUND, air: KEYS_AIR };

// keys whose default browser action must be suppressed while playing
const PREVENT = new Set([
  'Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD',
]);
const MENU_ALLOWED = new Set(['pause', 'phone', 'map']);

function makeButton(name) {
  return {
    name,
    /** currently held */
    down: false,
    /** went down this frame / fixed tick */
    pressed: false,
    /** went up this frame / fixed tick */
    released: false,
    /** seconds held (keeps its last value during the `released` frame) */
    heldTime: 0,
    _fp: false, _fr: false, _xp: false, _xr: false,
    _touch: 0, _sim: false, _pulse: 0, _edge: false,
  };
}

const buttons = {};
const buttonList = [];
for (let i = 0; i < BUTTONS.length; i++) {
  const b = makeButton(BUTTONS[i]);
  buttons[b.name] = b;
  buttonList.push(b);
}
const dummyButton = makeButton('none');
const warnedButtons = new Set();

/** resolved key lists per context group: [group][buttonIndex] → codes[] */
const resolved = {};
for (const group in KEYMAPS) {
  resolved[group] = buttonList.map((b) => KEYMAPS[group][b.name] || []);
}

const keys = Object.create(null); // code → true while held
const keyEdges = Object.create(null); // code → true if pressed since last poll
let keyEdgeList = [];
let mouseButtons = 0;
let mouseEdges = 0;
let lookAccX = 0;
let lookAccY = 0;
const touch = { moveX: 0, moveY: 0, axes: { throttle: 0, brake: 0, lift: 0, yaw: 0, pitch: 0, roll: 0, steer: 0 } };
const sim = {
  active: false,
  moveX: 0,
  moveY: 0,
  axes: { throttle: 0, brake: 0, lift: 0, yaw: 0, pitch: 0, roll: 0, steer: 0 },
  has: { throttle: false, brake: false, lift: false, yaw: false, pitch: false, roll: false, steer: false },
};
const tapQueue = [];
const labels = {};
const contextEvent = { context: 'foot', prev: 'foot' };
const _origin = new Vector3();
const _dir = new Vector3();

function keyDown(code) {
  return keys[code] === true || keyEdges[code] === true;
}

function anyKey(codes) {
  for (let i = 0; i < codes.length; i++) if (keys[codes[i]] === true || keyEdges[codes[i]] === true) return true;
  return false;
}

function isTyping(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true;
}

function clearHeld() {
  for (const code in keys) delete keys[code];
  mouseButtons = 0;
  touch.moveX = 0;
  touch.moveY = 0;
  for (const k in touch.axes) touch.axes[k] = 0;
  for (let i = 0; i < buttonList.length; i++) buttonList[i]._touch = 0;
}

function clamp1(v) {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

function tappable(e) {
  return typeof e.onTap === 'function' || typeof e.getInteractions === 'function';
}

export const input = registerSystem({
  name: 'input',
  order: 11,
  runWhenPaused: true,

  /** left stick / WASD: {x, y} in -1..1 (y = forward), length ≤ 1 */
  move: { x: 0, y: 0 },
  /** camera look delta in radians accumulated this frame */
  look: { dx: 0, dy: 0 },
  steer: 0,
  throttle: 0,
  brake: 0,
  pitch: 0,
  roll: 0,
  yaw: 0,
  lift: 0,
  /** current context: 'foot'|'car'|'bike'|'boat'|'heli'|'plane'|'tank'|'menu'|'photo' */
  context: 'foot',
  /** true when on-screen touch controls are in use */
  isTouch: false,
  /** last device that produced input: 'touch' | 'keyboard' */
  device: 'keyboard',
  /** true while the mouse pointer is locked to the canvas */
  pointerLocked: false,
  /** button names */
  buttonNames: BUTTONS,
  /** contextual labels set through setActionLabel: name → {label, icon, visible, enabled} */
  actionLabels: labels,

  /**
   * btn(name) → {down, pressed, released, heldTime}. The returned object is live (same object
   * every call). Unknown names return an inert button and warn once.
   * @param {string} name
   * @returns {{down:boolean, pressed:boolean, released:boolean, heldTime:number}}
   */
  btn(name) {
    const b = buttons[name];
    if (b) return b;
    if (!warnedButtons.has(name)) {
      warnedButtons.add(name);
      console.warn('[MUGEN] input.btn: unknown button "' + name + '"');
    }
    return dummyButton;
  },

  /**
   * setContext(ctx) — switches the control scheme ('foot'|'car'|'bike'|'boat'|'heli'|'plane'|
   * 'tank'|'menu'|'photo'). In 'menu' every gameplay action is suppressed (only pause / phone /
   * map buttons stay live). Emits `input:context {context, prev}`.
   * @param {string} ctx
   */
  setContext(ctx) {
    if (!CTX_GROUP[ctx]) {
      console.warn('[MUGEN] input.setContext: unknown context "' + ctx + '"');
      ctx = 'foot';
    }
    if (ctx === this.context) return;
    const prev = this.context;
    this.context = ctx;
    contextEvent.context = ctx;
    contextEvent.prev = prev;
    G.events.emit('input:context', contextEvent);
  },

  /**
   * pushContext(ctx) → restore(). Temporarily switches context (dialogs, panels); call the
   * returned function to go back to the context that was active before.
   * @param {string} ctx
   * @returns {() => void}
   */
  pushContext(ctx) {
    const prev = this.context;
    this.setContext(ctx);
    let restored = false;
    return () => {
      if (restored) return;
      restored = true;
      if (this.context === ctx) this.setContext(prev);
    };
  },

  /**
   * setActionLabel(buttonName, {label, icon, visible, enabled}) — contextual text / icon /
   * visibility for an on-screen button (merged with the previous values). Pass null to reset to
   * the layout default. Emits `input:label {name, label, icon, visible, enabled}`.
   * @param {string} buttonName
   * @param {{label?: string, icon?: string, visible?: boolean, enabled?: boolean}|null} opts
   */
  setActionLabel(buttonName, opts) {
    if (!buttons[buttonName]) {
      this.btn(buttonName);
      return;
    }
    let cur = labels[buttonName];
    if (opts === null || opts === undefined) {
      if (!cur) return;
      delete labels[buttonName];
      G.events.emit('input:label', { name: buttonName, reset: true });
      return;
    }
    if (!cur) cur = labels[buttonName] = { name: buttonName, label: undefined, icon: undefined, visible: undefined, enabled: undefined };
    let changed = false;
    if (opts.label !== undefined && opts.label !== cur.label) { cur.label = opts.label; changed = true; }
    if (opts.icon !== undefined && opts.icon !== cur.icon) { cur.icon = opts.icon; changed = true; }
    if (opts.visible !== undefined && opts.visible !== cur.visible) { cur.visible = opts.visible; changed = true; }
    if (opts.enabled !== undefined && opts.enabled !== cur.enabled) { cur.enabled = opts.enabled; changed = true; }
    if (changed) G.events.emit('input:label', cur);
  },

  /**
   * getActionLabel(buttonName) → {label, icon, visible, enabled} | null.
   * @param {string} buttonName
   * @returns {{label?: string, icon?: string, visible?: boolean, enabled?: boolean}|null}
   */
  getActionLabel(buttonName) {
    return labels[buttonName] || null;
  },

  /**
   * simulate(state | null) — test helper. REPLACES the simulated input state:
   *   {move:{x,y}, look:{dx,dy}, buttons:{jump:true}, taps:[{x,y}],
   *    steer, throttle, brake, pitch, roll, yaw, lift}
   * `move`, `buttons` and the axes stay active until the next simulate() call;
   * `look` (radians) and `taps` (frame CSS px) are one-shot. `simulate(null)` clears everything.
   * @param {object|null} state
   */
  simulate(state) {
    const s = state || {};
    sim.active = !!state;
    sim.moveX = s.move && Number.isFinite(s.move.x) ? s.move.x : 0;
    sim.moveY = s.move && Number.isFinite(s.move.y) ? s.move.y : 0;
    for (const k in sim.axes) {
      sim.has[k] = Number.isFinite(s[k]);
      sim.axes[k] = sim.has[k] ? s[k] : 0;
    }
    for (let i = 0; i < buttonList.length; i++) {
      const b = buttonList[i];
      b._sim = !!(s.buttons && s.buttons[b.name]);
    }
    if (s.buttons) {
      for (const name in s.buttons) if (!buttons[name]) this.btn(name);
    }
    if (s.look) {
      lookAccX += Number(s.look.dx) || 0;
      lookAccY += Number(s.look.dy) || 0;
    }
    if (Array.isArray(s.taps)) {
      for (let i = 0; i < s.taps.length; i++) this.tap(s.taps[i].x, s.taps[i].y);
    }
  },

  /**
   * press(name) — queues a one-frame button tap (pressed on the next poll, released on the one
   * after). Used by HUD buttons, the mouse wheel and scripted input.
   * @param {string} name
   */
  press(name) {
    const b = buttons[name];
    if (b) b._pulse++;
    else this.btn(name);
  },

  /**
   * tap(x, y) — queues a tap at frame coordinates (CSS px, origin top-left of #game). On the
   * next poll the camera ray is cast into the world and `tap:world {point, entity, screen,
   * normal, distance, origin, dir}` is emitted (`point` is null when nothing was hit).
   * @param {number} x
   * @param {number} y
   */
  tap(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (tapQueue.length < 8) tapQueue.push(x, y);
  },

  /**
   * vibrate(ms) — optional haptic feedback (no-op when unsupported, disabled or in test mode).
   * @param {number|number[]} ms
   */
  vibrate(ms) {
    if (G.flags.test) return;
    if (G.settings && G.settings.get('haptics', true) === false) return;
    try {
      if (navigator.vibrate) navigator.vibrate(ms);
    } catch (_) {
      /* ignore */
    }
  },

  // ---- device feeds (ui/touch.js) ------------------------------------------------------------

  /**
   * feedMove(x, y) — sets the virtual stick (−1..1 each, y = forward). Stays until changed.
   * @param {number} x
   * @param {number} y
   */
  feedMove(x, y) {
    touch.moveX = x;
    touch.moveY = y;
    if (x !== 0 || y !== 0) this.device = 'touch';
  },

  /**
   * feedButton(name, down) — presses / releases an on-screen button. Quick taps between two
   * frames are never lost.
   * @param {string} name
   * @param {boolean} down
   */
  feedButton(name, down) {
    const b = buttons[name];
    if (!b) {
      this.btn(name);
      return;
    }
    if (down) {
      b._touch++;
      b._edge = true;
      this.device = 'touch';
    } else if (b._touch > 0) {
      b._touch--;
    }
  },

  /**
   * feedAxis(name, value) — sets a touch axis: 'throttle' | 'brake' (0..1), 'lift' | 'yaw' |
   * 'pitch' | 'roll' | 'steer' (−1..1). Stays until changed.
   * @param {string} name
   * @param {number} value
   */
  feedAxis(name, value) {
    if (name in touch.axes) touch.axes[name] = value;
  },

  /**
   * feedLook(dx, dy) — adds a camera look delta in radians (sensitivity already applied by the
   * caller; the user's sensitivity / invert-Y settings are applied on top).
   * @param {number} dx
   * @param {number} dy
   */
  feedLook(dx, dy) {
    const s = G.settings ? G.settings.get('lookSensitivity', 1) : 1;
    lookAccX += dx * s;
    lookAccY += dy * s;
  },

  /**
   * requestPointerLock() — tries to lock the mouse to the canvas (desktop). Failure is silent and
   * disables further attempts for this session.
   */
  requestPointerLock() {
    if (this.pointerLocked || lockBroken || G.flags.test) return;
    if (G.settings && G.settings.get('pointerLock', true) === false) return;
    const canvas = G.renderer && G.renderer.canvas;
    if (!canvas || !canvas.requestPointerLock) return;
    try {
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => { lockBroken = true; });
    } catch (_) {
      lockBroken = true;
    }
  },

  /**
   * exitPointerLock() — releases the mouse (menus).
   */
  exitPointerLock() {
    try {
      if (document.pointerLockElement) {
        expectedUnlock = true;
        document.exitPointerLock();
      }
    } catch (_) {
      /* ignore */
    }
  },

  /** wantsPointerLock → true when a canvas click should lock the mouse (desktop, enabled, not broken). */
  get wantsPointerLock() {
    if (this.isTouch || lockBroken || G.flags.test) return false;
    return !(G.settings && G.settings.get('pointerLock', true) === false);
  },

  // ---- core hooks ----------------------------------------------------------------------------

  /**
   * poll(dt) — samples devices into the action state. Called once per frame by the core.
   * @param {number} dt real seconds since the previous poll
   */
  poll(dt) {
    const ctx = this.context;
    const group = CTX_GROUP[ctx];
    const menu = ctx === 'menu';
    const map = resolved[group];
    const locked = this.pointerLocked;

    // buttons
    for (let i = 0; i < buttonList.length; i++) {
      const b = buttonList[i];
      const was = b.down;
      let now = b._touch > 0 || b._sim || b._edge || anyKey(map[i]);
      if (!now && locked) {
        if (b.name === 'attack') now = (mouseButtons & 1) !== 0 || (mouseEdges & 1) !== 0;
        else if (b.name === 'aim') now = (mouseButtons & 4) !== 0 || (mouseEdges & 4) !== 0;
      }
      b._edge = false;
      if (b._pulse > 0) {
        if (was) now = false;
        else {
          now = true;
          b._pulse--;
        }
      }
      if (menu && !MENU_ALLOWED.has(b.name)) now = false;
      b.down = now;
      const p = now && !was;
      const r = !now && was;
      b._fp = p;
      b._fr = r;
      b.pressed = p;
      b.released = r;
      if (p) {
        b._xp = true;
        b.heldTime = 0;
      } else if (now) {
        b.heldTime += dt;
      }
      if (r) b._xr = true;
    }

    // raw stick
    let mx = touch.moveX + sim.moveX;
    let my = touch.moveY + sim.moveY;
    const kR = keyDown('KeyD') || keyDown('ArrowRight');
    const kL = keyDown('KeyA') || keyDown('ArrowLeft');
    const kU = keyDown('KeyW') || keyDown('ArrowUp');
    const kD = keyDown('KeyS') || keyDown('ArrowDown');
    mx += (kR ? 1 : 0) - (kL ? 1 : 0);
    my += (kU ? 1 : 0) - (kD ? 1 : 0);
    const len = Math.sqrt(mx * mx + my * my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }

    let steer = 0;
    let throttle = 0;
    let brake = 0;
    let pitch = 0;
    let roll = 0;
    let yaw = 0;
    let lift = 0;
    const ta = touch.axes;
    const sa = sim.axes;
    if (group === 'ground') {
      steer = clamp1(mx + ta.steer);
      throttle = Math.max(kU ? 1 : 0, ta.throttle, sim.moveY > 0 ? sim.moveY : 0);
      brake = Math.max(kD ? 1 : 0, ta.brake, sim.moveY < 0 ? -sim.moveY : 0);
    } else if (group === 'air') {
      const up = Math.max(keyDown('ShiftLeft') || keyDown('ShiftRight') ? 1 : 0, ta.throttle, ta.lift > 0 ? ta.lift : 0);
      const down = Math.max(
        keyDown('ControlLeft') || keyDown('ControlRight') || keyDown('KeyC') ? 1 : 0,
        ta.brake,
        ta.lift < 0 ? -ta.lift : 0
      );
      pitch = clamp1(-my + ta.pitch);
      roll = clamp1(mx + ta.roll);
      yaw = clamp1((keyDown('KeyE') ? 1 : 0) - (keyDown('KeyQ') ? 1 : 0) + ta.yaw);
      lift = clamp1(up - down);
      throttle = up;
      brake = down;
      steer = roll;
    } else {
      steer = mx;
      throttle = my > 0 ? my : 0;
      brake = my < 0 ? -my : 0;
    }
    if (sim.active) {
      if (sim.has.steer) steer = clamp1(sa.steer);
      if (sim.has.throttle) throttle = clamp1(sa.throttle);
      if (sim.has.brake) brake = clamp1(sa.brake);
      if (sim.has.pitch) pitch = clamp1(sa.pitch);
      if (sim.has.roll) roll = clamp1(sa.roll);
      if (sim.has.yaw) yaw = clamp1(sa.yaw);
      if (sim.has.lift) lift = clamp1(sa.lift);
    }

    if (menu) {
      mx = my = steer = throttle = brake = pitch = roll = yaw = lift = 0;
      lookAccX = lookAccY = 0;
    }
    this.move.x = mx;
    this.move.y = my;
    this.steer = steer;
    this.throttle = throttle;
    this.brake = brake;
    this.pitch = pitch;
    this.roll = roll;
    this.yaw = yaw;
    this.lift = lift;

    const invert = G.settings && G.settings.get('invertY', false) === true;
    this.look.dx = lookAccX;
    this.look.dy = invert ? -lookAccY : lookAccY;
    lookAccX = 0;
    lookAccY = 0;

    // clear per-poll edges
    if (keyEdgeList.length > 0) {
      for (let i = 0; i < keyEdgeList.length; i++) delete keyEdges[keyEdgeList[i]];
      keyEdgeList.length = 0;
    }
    mouseEdges = 0;

    // world taps
    if (tapQueue.length > 0) {
      for (let i = 0; i < tapQueue.length; i += 2) emitTap(tapQueue[i], tapQueue[i + 1]);
      tapQueue.length = 0;
    }
  },

  /**
   * beginFixed() — switches button edges to fixed-tick delivery. Core only.
   */
  beginFixed() {
    for (let i = 0; i < buttonList.length; i++) {
      const b = buttonList[i];
      b.pressed = b._xp;
      b.released = b._xr;
      b._xp = false;
      b._xr = false;
    }
  },

  /**
   * endFixed() — restores per-frame button edges after the fixed ticks. Core only.
   */
  endFixed() {
    for (let i = 0; i < buttonList.length; i++) {
      const b = buttonList[i];
      b.pressed = b._fp;
      b.released = b._fr;
    }
  },

  /**
   * reset() — releases everything (focus loss, context loss, tests).
   */
  reset() {
    clearHeld();
    for (const code in keyEdges) delete keyEdges[code];
    keyEdgeList.length = 0;
    mouseEdges = 0;
    lookAccX = lookAccY = 0;
    tapQueue.length = 0;
    this.simulate(null);
    for (let i = 0; i < buttonList.length; i++) {
      const b = buttonList[i];
      b._pulse = 0;
      b._edge = false;
    }
  },

  init() {
    let touchCapable = false;
    try {
      touchCapable = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    } catch (_) {
      /* ignore */
    }
    this.isTouch = G.flags.touch !== null ? G.flags.touch : touchCapable;
    this.device = this.isTouch ? 'touch' : 'keyboard';

    window.addEventListener('keydown', (e) => {
      if (isTyping(e.target)) return;
      const code = e.code;
      if (!code) return;
      if (PREVENT.has(code) && !e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault();
      if (e.repeat) return;
      keys[code] = true;
      if (keyEdges[code] !== true) {
        keyEdges[code] = true;
        keyEdgeList.push(code);
      }
      this.device = 'keyboard';
    });
    window.addEventListener('keyup', (e) => {
      if (e.code) delete keys[e.code];
    });
    window.addEventListener('blur', clearHeld);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') clearHeld();
    });

    document.addEventListener('pointerlockchange', () => {
      const canvas = G.renderer && G.renderer.canvas;
      const locked = !!canvas && document.pointerLockElement === canvas;
      const was = this.pointerLocked;
      this.pointerLocked = locked;
      mouseButtons = 0;
      if (was && !locked) {
        // Esc releases the lock without delivering a keydown: treat it as "pause"
        if (!expectedUnlock && G.ready && !G.time.paused && this.context !== 'menu') this.press('pause');
        expectedUnlock = false;
      }
      G.events.emit('input:pointerlock', { locked });
    });
    document.addEventListener('pointerlockerror', () => {
      lockBroken = true;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      const s = CONFIG.MOUSE_SENSITIVITY * (G.settings ? G.settings.get('lookSensitivity', 1) : 1);
      lookAccX += (e.movementX || 0) * s;
      lookAccY += (e.movementY || 0) * s;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked) return;
      const bit = 1 << e.button;
      mouseButtons |= bit;
      mouseEdges |= bit;
      this.device = 'keyboard';
    });
    document.addEventListener('mouseup', (e) => {
      mouseButtons &= ~(1 << e.button);
    });
    document.addEventListener(
      'wheel',
      (e) => {
        if (this.context === 'menu') return;
        const canvas = G.renderer && G.renderer.canvas;
        if (!this.pointerLocked && e.target !== canvas) return;
        if (e.deltaY > 0) this.press('weaponNext');
        else if (e.deltaY < 0) this.press('weaponPrev');
      },
      { passive: true }
    );
  },
});

let lockBroken = false;
let expectedUnlock = false;

function emitTap(x, y) {
  const payload = {
    point: null,
    entity: null,
    screen: { x, y },
    normal: null,
    distance: Infinity,
    origin: null,
    dir: null,
    collider: null,
  };
  try {
    const renderer = G.renderer;
    const cam = G.camera;
    if (renderer && cam && renderer.width > 0 && renderer.height > 0) {
      cam.updateMatrixWorld();
      _origin.setFromMatrixPosition(cam.matrixWorld);
      _dir
        .set((x / renderer.width) * 2 - 1, -(y / renderer.height) * 2 + 1, 0.5)
        .unproject(cam)
        .sub(_origin)
        .normalize();
      payload.origin = _origin.clone();
      payload.dir = _dir.clone();
      const physics = G.physics;
      const hit = physics && physics.world ? physics.raycast(_origin, _dir, CONFIG.TAP_RANGE) : null;
      let maxEntityDist = CONFIG.TAP_RANGE;
      if (hit) {
        payload.point = hit.point.clone();
        payload.normal = hit.normal.clone();
        payload.distance = hit.distance;
        payload.collider = hit.collider;
        payload.entity = hit.entity || null;
        maxEntityDist = hit.distance + 0.5;
      }
      if (!payload.entity && G.entities) {
        // entities without their own collider (or hidden behind a thin one) are still tappable
        const eh = G.entities.raycast(_origin, _dir, maxEntityDist, tappable, 2.5);
        if (eh) {
          payload.entity = eh.entity;
          payload.distance = eh.distance;
          payload.point = _origin.clone().addScaledVector(_dir, eh.distance);
        }
      }
    }
  } catch (err) {
    reportError(err, 'input', 'tap');
  }
  G.events.emit('tap:world', payload);
}

export default input;
