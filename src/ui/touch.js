// MUGEN CITY — on-screen controls for portrait play (G.touch, ARCHITECTURE §4).
//
// * bottom-left zone: floating virtual joystick → G.input.feedMove
// * bottom-right cluster: context dependent buttons → G.input.feedButton / feedAxis
// * everywhere else on the canvas: drag = camera look (G.input.feedLook), short tap = world tap
//   (G.input.tap → raycast from the camera → `tap:world`)
// Every control tracks its own pointerId (multi-touch safe) and respects the safe-area insets.
// On desktop the buttons are hidden; dragging with the mouse still looks around and a click
// either locks the pointer or taps the world.

import { G, registerSystem, reportError } from '../core/game.js';
import { CONFIG } from '../core/config.js';
import { ui, icon, el, injectCSS } from './theme.js';

const ICON_SIZE = { xl: 34, lg: 28, md: 22, sm: 19 };
const JOY_RADIUS = 54;
const JOY_DEADZONE = 0.12;
const HOLD_MS = 350;

// Button slots: r / b = distance (px) of the button's right / bottom edge from the frame corner.
const P = { primary: [14, 84, 'xl'], secondary: [108, 34, 'lg'], corner: [20, 20, 'md'], far: [184, 22, 'md'],
  mid: [112, 112, 'md'], midFar: [176, 120, 'sm'], top1: [22, 178, 'md'], top2: [84, 180, 'md'], top3: [148, 178, 'sm'],
  high1: [26, 242, 'sm'], high2: [84, 244, 'sm'] };

function def(slot, o) {
  const p = P[slot];
  return Object.assign({ r: p[0], b: p[1], size: p[2] }, o);
}

const GROUND = (extra) => [
  def('primary', { id: 'throttle', axis: 'throttle', value: 1, label: 'アクセル', icon: 'gas' }),
  def('secondary', { id: 'brake', axis: 'brake', value: 1, label: 'ブレーキ', icon: 'brake' }),
  def('corner', { id: 'handbrake', btn: 'handbrake', label: 'ドリフト', icon: 'handbrake' }),
  def('far', { id: 'horn', btn: 'horn', label: 'ホーン', icon: 'horn' }),
  def('mid', Object.assign({ id: 'attack', btn: 'attack', label: '攻撃', icon: 'aim', hidden: true }, extra && extra.attack)),
  def('top2', { id: 'enterExit', btn: 'enterExit', label: '降りる', icon: 'exit' }),
  def('top1', { id: 'camera', btn: 'camera', label: '視点', icon: 'camera', size: 'sm', r: 26, b: 182 }),
  def('top3', { id: 'lights', btn: 'lights', label: 'ライト', icon: 'lights' }),
  def('midFar', { id: 'radio', btn: 'radio', label: 'ラジオ', icon: 'radio' }),
  def('high1', Object.assign({ id: 'special1', btn: 'special1', label: '特殊', icon: 'bolt', hidden: true }, extra && extra.special1)),
];

const AIR = (primary, secondary) => [
  def('primary', Object.assign({ id: 'up', axis: 'throttle', value: 1 }, primary)),
  def('secondary', Object.assign({ id: 'down', axis: 'brake', value: 1 }, secondary)),
  def('midFar', { id: 'yawL', axis: 'yaw', value: -1, label: '左', icon: 'rotate_left', size: 'md', r: 176, b: 112 }),
  def('mid', { id: 'yawR', axis: 'yaw', value: 1, label: '右', icon: 'rotate_right' }),
  def('corner', { id: 'attack', btn: 'attack', label: '攻撃', icon: 'aim', hidden: true }),
  def('top2', { id: 'enterExit', btn: 'enterExit', label: '降りる', icon: 'exit' }),
  def('top1', { id: 'camera', btn: 'camera', label: '視点', icon: 'camera', size: 'sm', r: 26, b: 182 }),
  def('top3', { id: 'radio', btn: 'radio', label: 'ラジオ', icon: 'radio' }),
  def('high1', { id: 'special1', btn: 'special1', label: '特殊', icon: 'bolt', hidden: true }),
];

/** Default button layout per input context. */
const LAYOUTS = {
  foot: [
    def('primary', { id: 'attack', btn: 'attack', label: '攻撃', icon: 'attack' }),
    def('secondary', { id: 'jump', btn: 'jump', label: 'ジャンプ', icon: 'jump' }),
    def('corner', { id: 'sprint', btn: 'sprint', label: 'ダッシュ', icon: 'sprint' }),
    def('far', { id: 'crouch', btn: 'crouch', label: 'しゃがむ', icon: 'crouch' }),
    def('mid', { id: 'aim', btn: 'aim', label: '構える', icon: 'aim' }),
    def('top1', { id: 'interact', btn: 'interact', label: '調べる', icon: 'interact', hidden: true, accent: true }),
    def('top2', { id: 'enterExit', btn: 'enterExit', label: '乗る', icon: 'car' }),
    def('top3', { id: 'weaponNext', btn: 'weaponNext', label: '武器', icon: 'weapon', hold: 'weaponWheel' }),
    def('midFar', { id: 'reload', btn: 'reload', label: '装填', icon: 'reload' }),
    def('high1', { id: 'gadget', btn: 'gadget', label: 'ガジェット', icon: 'gadget' }),
    def('high2', { id: 'camera', btn: 'camera', label: '視点', icon: 'camera' }),
  ],
  car: GROUND(),
  bike: GROUND(),
  boat: GROUND(),
  tank: GROUND({ attack: { label: '砲撃', icon: 'target', hidden: false }, special1: { label: '機銃', icon: 'weapon', hidden: false } }),
  heli: AIR({ label: '上昇', icon: 'arrow_up' }, { label: '下降', icon: 'arrow_down' }),
  plane: AIR({ label: 'スロットル', icon: 'plane' }, { label: '減速', icon: 'brake' }),
  photo: [],
  menu: [],
};

const CSS = `
.mg-controls{position:absolute;inset:0;pointer-events:none;transition:opacity .2s}
#ui.mg-desktop .mg-controls{display:none}
.mg-controls.mg-off{opacity:0;visibility:hidden}
.mg-tbtn{position:absolute;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:2px;padding:0;margin:0;color:#fff;font:700 10px/1 var(--mg-font);pointer-events:auto;touch-action:none;
  user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;outline:none;
  background:radial-gradient(circle at 35% 28%,rgba(255,255,255,.26),rgba(18,22,36,.5) 72%);
  border:1.5px solid rgba(255,255,255,.3);box-shadow:0 4px 14px rgba(0,0,0,.35),inset 0 0 12px rgba(255,255,255,.05);
  backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
  transition:transform .06s,border-color .1s,box-shadow .1s,opacity .15s}
.mg-tbtn.down{transform:scale(.92);border-color:var(--mg-accent);
  background:radial-gradient(circle at 35% 28%,rgba(54,224,255,.55),rgba(14,54,76,.62) 72%);box-shadow:var(--mg-glow)}
.mg-tbtn.accent{border-color:var(--mg-accent);box-shadow:var(--mg-glow)}
.mg-tbtn.disabled{opacity:.35}
.mg-tbtn .lbl{max-width:94%;overflow:hidden;white-space:nowrap;letter-spacing:.02em;text-shadow:0 1px 2px rgba(0,0,0,.85)}
.mg-tbtn-xl{width:84px;height:84px}.mg-tbtn-xl .lbl{font-size:12px}
.mg-tbtn-lg{width:68px;height:68px}.mg-tbtn-lg .lbl{font-size:11px}
.mg-tbtn-md{width:54px;height:54px}.mg-tbtn-md .lbl{font-size:9.5px}
.mg-tbtn-sm{width:46px;height:46px}.mg-tbtn-sm .lbl{font-size:8.5px}
.mg-joy{position:absolute;left:0;top:0;width:${JOY_RADIUS * 2 + 16}px;height:${JOY_RADIUS * 2 + 16}px;margin:-${JOY_RADIUS + 8}px 0 0 -${JOY_RADIUS + 8}px;
  border-radius:50%;border:1.5px solid rgba(255,255,255,.3);
  background:radial-gradient(circle,rgba(255,255,255,.05) 0,rgba(255,255,255,.12) 100%);
  box-shadow:inset 0 0 18px rgba(0,0,0,.25);opacity:.4;transition:opacity .15s;will-change:transform}
.mg-joy.active{opacity:1;border-color:rgba(54,224,255,.7)}
.mg-joy-knob{position:absolute;left:0;top:0;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;
  background:radial-gradient(circle at 35% 28%,rgba(255,255,255,.75),rgba(150,170,200,.4) 75%);
  border:1.5px solid rgba(255,255,255,.55);box-shadow:0 4px 12px rgba(0,0,0,.4);opacity:.45;transition:opacity .15s;will-change:transform}
.mg-joy-knob.active{opacity:1}
`;

let container = null;
let joyBase = null;
let joyKnob = null;
let canvas = null;
let frame = null;
let touchUI = false;
let visible = true;
/** @type {Map<string, {def: any, node: HTMLElement, pointer: number, holdTimer: any, holding: boolean}>} */
const buttons = new Map();
const axisSum = { throttle: 0, brake: 0, yaw: 0, lift: 0, pitch: 0, roll: 0, steer: 0 };
const joy = { id: -1, ox: 0, oy: 0, x: 0, y: 0, active: false };
const look = { id: -1, lastX: 0, lastY: 0, startX: 0, startY: 0, t0: 0, moved: 0, mouse: false };
let rect = { left: 0, top: 0, width: 390, height: 844 };

function refreshRect() {
  if (frame) rect = frame.getBoundingClientRect();
}

function joyHome() {
  return { x: 34 + JOY_RADIUS + 8, y: rect.height - (58 + JOY_RADIUS + 8) };
}

function placeJoy(bx, by, kx, ky) {
  joyBase.style.transform = 'translate3d(' + bx + 'px,' + by + 'px,0)';
  joyKnob.style.transform = 'translate3d(' + kx + 'px,' + ky + 'px,0)';
}

function resetJoy() {
  joy.id = -1;
  joy.active = false;
  joy.x = 0;
  joy.y = 0;
  G.input.feedMove(0, 0);
  if (!joyBase) return;
  const h = joyHome();
  placeJoy(h.x, h.y, h.x, h.y);
  joyBase.classList.remove('active');
  joyKnob.classList.remove('active');
}

function joystickAllowed() {
  return touchUI && visible && G.input.context !== 'menu';
}

function inJoyZone(x, y) {
  return x < rect.width * 0.5 && y > rect.height * 0.56;
}

function updateJoy(x, y) {
  let dx = x - joy.ox;
  let dy = y - joy.oy;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > JOY_RADIUS) {
    // drag the base along so the stick never "sticks" at the rim
    const k = (d - JOY_RADIUS) / d;
    joy.ox += dx * k;
    joy.oy += dy * k;
    dx = x - joy.ox;
    dy = y - joy.oy;
  }
  let nx = dx / JOY_RADIUS;
  let ny = -dy / JOY_RADIUS;
  const len = Math.sqrt(nx * nx + ny * ny);
  if (len < JOY_DEADZONE) {
    nx = 0;
    ny = 0;
  } else {
    const k = (len - JOY_DEADZONE) / (1 - JOY_DEADZONE) / len;
    nx *= k;
    ny *= k;
  }
  joy.x = nx;
  joy.y = ny;
  G.input.feedMove(nx, ny);
  placeJoy(joy.ox, joy.oy, joy.ox + dx, joy.oy + dy);
}

function setAxis(name, delta) {
  axisSum[name] += delta;
  const v = axisSum[name];
  G.input.feedAxis(name, v < -1 ? -1 : v > 1 ? 1 : v);
}

function pressButton(rec, e) {
  if (rec.pointer !== -1) return;
  const d = rec.def;
  if (rec.node.classList.contains('disabled')) return;
  rec.pointer = e.pointerId;
  try {
    rec.node.setPointerCapture(e.pointerId);
  } catch (_) {
    /* ignore */
  }
  rec.node.classList.add('down');
  G.input.vibrate(8);
  if (d.axis) setAxis(d.axis, d.value);
  else if (d.hold) {
    rec.holding = false;
    rec.holdTimer = setTimeout(() => {
      rec.holdTimer = null;
      if (rec.pointer === -1) return;
      rec.holding = true;
      G.input.feedButton(d.hold, true);
    }, HOLD_MS);
  } else G.input.feedButton(d.btn, true);
}

function releaseButton(rec) {
  if (rec.pointer === -1) return;
  const d = rec.def;
  rec.pointer = -1;
  rec.node.classList.remove('down');
  if (d.axis) setAxis(d.axis, -d.value);
  else if (d.hold) {
    if (rec.holdTimer) {
      clearTimeout(rec.holdTimer);
      rec.holdTimer = null;
      G.input.press(d.btn);
    } else if (rec.holding) {
      rec.holding = false;
      G.input.feedButton(d.hold, false);
    }
  } else G.input.feedButton(d.btn, false);
}

function releaseAll() {
  buttons.forEach(releaseButton);
  for (const k in axisSum) {
    axisSum[k] = 0;
    G.input.feedAxis(k, 0);
  }
  if (joy.id !== -1) resetJoy();
  look.id = -1;
}

function applyLabel(rec) {
  const d = rec.def;
  const o = d.btn ? G.input.getActionLabel(d.btn) : null;
  const label = o && o.label !== undefined ? o.label : d.label;
  const ic = o && o.icon !== undefined ? o.icon : d.icon;
  const show = o && o.visible !== undefined ? o.visible : !d.hidden;
  const enabled = o && o.enabled !== undefined ? o.enabled : true;
  const key = label + '|' + ic;
  if (rec.key !== key) {
    rec.key = key;
    rec.node.innerHTML = icon(ic, ICON_SIZE[d.size]) + '<span class="lbl">' + escapeHtml(label || '') + '</span>';
  }
  rec.node.classList.toggle('mg-hidden', !show);
  rec.node.classList.toggle('disabled', !enabled);
  if ((!show || !enabled) && rec.pointer !== -1) releaseButton(rec);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
}

function build(context) {
  releaseAll();
  buttons.forEach((rec) => rec.node.remove());
  buttons.clear();
  const layout = LAYOUTS[context] || [];
  for (let i = 0; i < layout.length; i++) {
    const d = layout[i];
    const node = el('button', { class: 'mg-tbtn mg-tbtn-' + d.size + (d.accent ? ' accent' : ''), attrs: { type: 'button', 'data-id': d.id, 'aria-label': d.label } });
    node.style.right = 'calc(var(--sar, 0px) + ' + d.r + 'px)';
    node.style.bottom = 'calc(var(--sab, 0px) + ' + d.b + 'px)';
    const rec = { def: d, node, pointer: -1, holdTimer: null, holding: false, key: '' };
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      pressButton(rec, e);
    });
    const up = (e) => {
      if (e.pointerId === rec.pointer) releaseButton(rec);
    };
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    node.addEventListener('lostpointercapture', up);
    node.addEventListener('contextmenu', (e) => e.preventDefault());
    applyLabel(rec);
    container.appendChild(node);
    buttons.set(d.id, rec);
  }
  const showJoy = context !== 'menu';
  joyBase.classList.toggle('mg-hidden', !showJoy);
  joyKnob.classList.toggle('mg-hidden', !showJoy);
}

// ---- canvas pointers: joystick / look / tap ------------------------------------------------

function local(e) {
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function onCanvasDown(e) {
  if (!G.ready) return;
  const mouse = e.pointerType === 'mouse';
  if (mouse && (e.button !== 0 || document.pointerLockElement)) return;
  if (G.input.context === 'menu') return;
  refreshRect();
  const p = local(e);
  if (!mouse && joystickAllowed() && joy.id === -1 && inJoyZone(p.x, p.y)) {
    joy.id = e.pointerId;
    joy.active = true;
    joy.ox = Math.max(JOY_RADIUS + 12, Math.min(rect.width - JOY_RADIUS - 12, p.x));
    joy.oy = Math.max(JOY_RADIUS + 12, Math.min(rect.height - JOY_RADIUS - 12, p.y));
    joyBase.classList.add('active');
    joyKnob.classList.add('active');
    updateJoy(p.x, p.y);
  } else if (look.id === -1) {
    look.id = e.pointerId;
    look.lastX = look.startX = p.x;
    look.lastY = look.startY = p.y;
    look.t0 = performance.now();
    look.moved = 0;
    look.mouse = mouse;
  } else {
    return;
  }
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch (_) {
    /* ignore */
  }
  e.preventDefault();
}

function onCanvasMove(e) {
  if (e.pointerId === joy.id) {
    const p = local(e);
    updateJoy(p.x, p.y);
  } else if (e.pointerId === look.id) {
    const p = local(e);
    const dx = p.x - look.lastX;
    const dy = p.y - look.lastY;
    look.lastX = p.x;
    look.lastY = p.y;
    look.moved += Math.abs(dx) + Math.abs(dy);
    if (G.input.context !== 'menu') G.input.feedLook(dx * CONFIG.TOUCH_SENSITIVITY, dy * CONFIG.TOUCH_SENSITIVITY);
  }
}

function onCanvasUp(e) {
  if (e.pointerId === joy.id) {
    resetJoy();
  } else if (e.pointerId === look.id) {
    look.id = -1;
    if (e.type !== 'pointerup') return;
    const dt = performance.now() - look.t0;
    if (dt <= CONFIG.TAP_MAX_MS && look.moved <= CONFIG.TAP_MAX_MOVE && G.input.context !== 'menu') {
      if (look.mouse && G.input.wantsPointerLock) G.input.requestPointerLock();
      else G.input.tap(look.startX, look.startY);
    }
  }
}

export const touch = registerSystem({
  name: 'touch',
  order: 26,
  runWhenPaused: true,

  /** default layouts per context (array of button defs) — the UI module may edit them */
  layouts: LAYOUTS,
  /** live joystick state {active, x, y} */
  joystick: joy,

  /** visible → true while the on-screen controls are shown. */
  get visible() {
    return visible;
  },

  /**
   * setVisible(show) — shows / hides all on-screen controls (cutscenes, photo mode). Held
   * controls are released when hiding.
   * @param {boolean} show
   */
  setVisible(show) {
    visible = !!show;
    if (!container) return;
    container.classList.toggle('mg-off', !visible);
    if (!visible) releaseAll();
  },

  /**
   * rebuild() — re-creates the buttons for the current input context (after editing layouts).
   */
  rebuild() {
    if (container) build(G.input.context);
  },

  /**
   * button(id) → HTMLElement | null of an on-screen button of the current layout
   * (ids: attack, jump, sprint, crouch, aim, interact, enterExit, throttle, brake, ...).
   * @param {string} id
   * @returns {HTMLElement|null}
   */
  button(id) {
    const rec = buttons.get(id);
    return rec ? rec.node : null;
  },

  init() {
    injectCSS('touch', CSS);
    touchUI = !!G.input.isTouch;
    frame = (G.renderer && G.renderer.frame) || document.getElementById('game');
    canvas = (G.renderer && G.renderer.canvas) || (frame && frame.querySelector('canvas'));
    container = el('div', { class: 'mg-controls' });
    joyBase = el('div', { class: 'mg-joy' });
    joyKnob = el('div', { class: 'mg-joy-knob' });
    container.appendChild(joyBase);
    container.appendChild(joyKnob);
    ui.layer('controls').appendChild(container);
    refreshRect();
    build(G.input.context);
    resetJoy();

    if (canvas) {
      canvas.addEventListener('pointerdown', onCanvasDown);
      canvas.addEventListener('pointermove', onCanvasMove);
      canvas.addEventListener('pointerup', onCanvasUp);
      canvas.addEventListener('pointercancel', onCanvasUp);
    }
    // iOS: stop pinch / double-tap gestures from zooming the page
    const stop = (e) => e.preventDefault();
    try {
      document.addEventListener('gesturestart', stop, { passive: false });
      document.addEventListener('dblclick', stop, { passive: false });
    } catch (_) {
      /* ignore */
    }

    G.events.on('input:context', (e) => {
      try {
        build(e.context);
        resetJoy();
      } catch (err) {
        reportError(err, 'touch', 'context');
      }
    });
    G.events.on('input:label', (e) => {
      buttons.forEach((rec) => {
        if (rec.def.btn === e.name) applyLabel(rec);
      });
    });
    G.events.on('renderer:resize', () => {
      refreshRect();
      if (joy.id === -1) resetJoy();
    });
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') releaseAll();
    });
  },
});

export default touch;
