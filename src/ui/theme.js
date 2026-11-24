// MUGEN CITY — UI theme: CSS variables, base component classes, inline-SVG icon set, DOM helpers
// and the `G.ui` system object (order 24). ui/hud.js fills `G.ui` with the full §18 API.
//
// This module is a pure helper too: other modules may import { ui, icon, el, injectCSS, ICONS }.
// No emoji anywhere — icons are inline SVG strokes that inherit `currentColor`.

import { G, registerSystem } from '../core/game.js';

// ------------------------------------------------------------------------------------------------
// Icons (24×24, stroke based)
// ------------------------------------------------------------------------------------------------

/** Inner SVG markup per icon name. */
export const ICONS = {
  attack: '<path d="M7 11V7.5a1.75 1.75 0 0 1 3.5 0V6.5a1.75 1.75 0 0 1 3.5 0v1a1.75 1.75 0 0 1 3.5 0V14a6 6 0 0 1-6 6h-.5a6 6 0 0 1-5.2-3L4.3 14.2A1.6 1.6 0 0 1 7 12.6z"/><path d="M10.5 7.5V11M14 7.5V11"/>',
  jump: '<path d="M6 13l6-6 6 6"/><path d="M6 19l6-6 6 6"/>',
  sprint: '<path d="M5 6l6 6-6 6"/><path d="M13 6l6 6-6 6"/>',
  crouch: '<path d="M6 5l6 6 6-6"/><path d="M6 11l6 6 6-6"/><path d="M5 21h14"/>',
  aim: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1"/>',
  interact: '<path d="M9 11.5V5a2 2 0 0 1 4 0v5.5"/><path d="M13 10.5a2 2 0 0 1 4 0V12a2 2 0 0 1 3.5 1.3V16a6 6 0 0 1-6 6h-1.4a6 6 0 0 1-5-2.7L5.2 15.4a1.6 1.6 0 0 1 2.6-1.9L9 15"/>',
  car: '<path d="M3 17v-4l2.2-5.2A2 2 0 0 1 7 6.5h10a2 2 0 0 1 1.8 1.3L21 13v4"/><path d="M3 13h18"/><path d="M5 17v2h3v-2M16 17v2h3v-2M3 17h18"/><circle cx="7" cy="15" r=".6"/><circle cx="17" cy="15" r=".6"/>',
  exit: '<path d="M10 4H5v16h5"/><path d="M14 8l4 4-4 4M9 12h9"/>',
  enter: '<path d="M14 4h5v16h-5"/><path d="M9 8l4 4-4 4M4 12h9"/>',
  reload: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 3.5V9h-5.5"/>',
  weapon: '<path d="M3 7h15.5v4.5H12l-1.2 2.5H7.5L7 20H3.5z"/><path d="M18.5 8l2.5-.8v3.3l-2.5.5"/><path d="M11 11.5v2"/>',
  handbrake: '<circle cx="12" cy="12" r="8"/><path d="M10 16.5v-9h3a2.6 2.6 0 0 1 0 5.2h-3"/><path d="M2.5 8a10 10 0 0 0 0 8M21.5 8a10 10 0 0 1 0 8"/>',
  horn: '<path d="M4 10v4h3l6 4.5v-13L7 10z"/><path d="M16.5 9a4.2 4.2 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11"/>',
  lights: '<path d="M10 5a7 7 0 0 0 0 14h1V5z"/><path d="M14.5 7.5h6M14.5 12h7M14.5 16.5h6"/>',
  radio: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  camera: '<path d="M4 8h3l1.8-3h6.4L17 8h3v11H4z"/><circle cx="12" cy="13.2" r="3.5"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M10.8 18.5h2.4"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  pause: '<path d="M8.5 5v14M15.5 5v14"/>',
  play: '<path d="M7 4.5l12.5 7.5L7 19.5z"/>',
  emote: '<circle cx="12" cy="12" r="9"/><path d="M8 14a4.5 4.5 0 0 0 8 0"/><path d="M9 9.3v.9M15 9.3v.9"/>',
  gadget: '<path d="M12 2.5c3 2.2 4.8 5.8 4.8 9.5l-1.8 4H9l-1.8-4c0-3.7 1.8-7.3 4.8-9.5z"/><circle cx="12" cy="9.5" r="1.6"/><path d="M9.5 16l-1.5 5M14.5 16l1.5 5M12 16v5.5"/>',
  heart: '<path d="M12 20.5C5 15.5 3 12 3 8.8A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 9 1.8c0 3.2-2 6.7-9 11.7z"/>',
  shield: '<path d="M12 3l8 3v5.5c0 4.7-3.2 8-8 9.5-4.8-1.5-8-4.8-8-9.5V6z"/>',
  star: '<path d="M12 3l2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.5l6.3-.8z"/>',
  yen: '<path d="M6 4l6 8 6-8M12 12v8M7 12h10M7 16h10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  pin: '<path d="M12 21.5s7-6.3 7-11.5a7 7 0 0 0-14 0c0 5.2 7 11.5 7 11.5z"/><circle cx="12" cy="10" r="2.5"/>',
  arrow_up: '<path d="M12 20V5M5.5 11.5L12 5l6.5 6.5"/>',
  arrow_down: '<path d="M12 4v15M5.5 12.5L12 19l6.5-6.5"/>',
  arrow_left: '<path d="M20 12H5M11.5 5.5L5 12l6.5 6.5"/>',
  arrow_right: '<path d="M4 12h15M12.5 5.5L19 12l-6.5 6.5"/>',
  rotate_left: '<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 3.5V9h5.5"/>',
  rotate_right: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 3.5V9h-5.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M4.5 12.5l5 5L19.5 7"/>',
  warning: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.3v.2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.3v.2"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  home: '<path d="M3.5 11.5L12 4l8.5 7.5"/><path d="M6 10v10h12V10"/><path d="M10 20v-5.5h4V20"/>',
  cart: '<path d="M3 4h2.5l2.2 10.5h10.3L20 7H6.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
  fuel: '<path d="M5 20V5a1.5 1.5 0 0 1 1.5-1.5h6A1.5 1.5 0 0 1 14 5v15z"/><path d="M4 20h11M7.5 7h4v4h-4z"/><path d="M14 9l4 3v5.5a1.5 1.5 0 0 0 3 0V9l-2.5-3"/>',
  wrench: '<path d="M14.5 6.5a4.5 4.5 0 0 0-6 5.6L3.5 17a2.1 2.1 0 0 0 3 3l5-5a4.5 4.5 0 0 0 5.6-6l-3 3-2.6-.5-.5-2.6z"/>',
  skull: '<path d="M5 11a7 7 0 0 1 14 0c0 2.4-1 4-2.5 5v3.5h-9V16C6 15 5 13.4 5 11z"/><circle cx="9.3" cy="11" r="1.4"/><circle cx="14.7" cy="11" r="1.4"/><path d="M10.5 19.5v-2M13.5 19.5v-2"/>',
  fire: '<path d="M12 21c-3.6 0-6-2.5-6-5.8 0-2.7 1.7-4.3 3-6.2.9 1.3 1 2.3 1 3 2-1.5 3.2-4.2 2.5-8.5 3.5 2.3 5.5 6 5.5 10.5 0 4-2.4 7-6 7z"/>',
  bolt: '<path d="M13.5 2.5L5 13.5h6l-1 8L19 10.5h-6.3z"/>',
  eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  speaker: '<path d="M4 9.5v5h3.5l5 4v-13l-5 4z"/><path d="M16 9a4.2 4.2 0 0 1 0 6"/>',
  plane: '<path d="M10.5 3.5c0-1 3-1 3 0V9l7.5 4.5v2L13.5 13v5l2.5 2v1.5l-4-1-4 1V20l2.5-2v-5L3 15.5v-2L10.5 9z"/>',
  heli: '<path d="M3 5.5h14M10 5.5V9"/><path d="M4 9h9a5 5 0 0 1 5 5v1.5H9.5L4 12z"/><path d="M4 9v3M8 18.5h9M11 15.5v3M15 15.5v3M18 12.5l3.5-1.5"/>',
  boat: '<path d="M3 14.5h18l-2.5 5h-13z"/><path d="M12 14.5V3.5l6 8H12M12 5.5L7.5 11.5H12"/>',
  bike: '<circle cx="5.5" cy="16" r="3.5"/><circle cx="18.5" cy="16" r="3.5"/><path d="M5.5 16l4-7h5l4 7M9.5 9l3 7M14 6.5h2.5l2 9.5M8 9h3"/>',
  person: '<circle cx="12" cy="6.5" r="3"/><path d="M5.5 20.5a6.5 6.5 0 0 1 13 0"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  flag: '<path d="M5.5 21V3.5"/><path d="M5.5 4.5h12l-2.5 4 2.5 4h-12"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 5.5H4.5V7A3.5 3.5 0 0 0 8 10.5M16 5.5h3.5V7a3.5 3.5 0 0 1-3.5 3.5M12 13v4M8.5 20h7M9.5 17h5"/>',
  chat: '<path d="M4 5h16v11H10.5L6 20v-4H4z"/>',
  gas: '<path d="M9 3.5h6l1.5 14a3 3 0 0 1-3 3.5h-3a3 3 0 0 1-3-3.5z"/><path d="M9.5 8h5M9 12h6M8.7 16h6.6"/>',
  brake: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3"/><path d="M12 3.5v5.5M12 15v5.5M3.5 12H9M15 12h5.5"/>',
  menu: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  news: '<path d="M4 5h13v14H6a2 2 0 0 1-2-2z"/><path d="M17 9h3v8a2 2 0 0 1-2 2M7.5 9h6M7.5 12.5h6M7.5 16h4"/>',
  bag: '<path d="M5 8.5h14l-1 12H6z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/>',
  dot: '<circle cx="12" cy="12" r="4"/>',
};

const ICON_NAMES = Object.keys(ICONS);

/**
 * icon(name, size=24, cls='') → SVG markup string. Unknown names fall back to a dot.
 * The icon inherits the text colour of its container.
 * @param {string} name
 * @param {number} [size]
 * @param {string} [cls]
 * @returns {string}
 */
export function icon(name, size = 24, cls = '') {
  const inner = ICONS[name] || ICONS.dot;
  return (
    '<svg class="mg-icon' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" width="' + size + '" height="' + size +
    '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    inner + '</svg>'
  );
}

/**
 * el(tag, props?, children?) → HTMLElement. props: {class, text, html, style (string|object),
 * attrs:{}, on:{event: handler}, parent}. children: array of nodes / strings.
 * @param {string} tag
 * @param {object} [props]
 * @param {(Node|string)[]} [children]
 * @returns {HTMLElement}
 */
export function el(tag, props, children) {
  const node = document.createElement(tag);
  if (props) {
    if (props.class) node.className = props.class;
    if (props.text !== undefined) node.textContent = props.text;
    if (props.html !== undefined) node.innerHTML = props.html;
    if (props.style) {
      if (typeof props.style === 'string') node.style.cssText = props.style;
      else Object.assign(node.style, props.style);
    }
    if (props.attrs) for (const k in props.attrs) node.setAttribute(k, props.attrs[k]);
    if (props.on) for (const k in props.on) node.addEventListener(k, props.on[k]);
    if (props.parent) props.parent.appendChild(node);
  }
  if (children) {
    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      if (c === null || c === undefined) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
  }
  return node;
}

/**
 * injectCSS(id, css) — adds a <style> block once (later calls with the same id replace it).
 * @param {string} id
 * @param {string} css
 */
export function injectCSS(id, css) {
  let style = document.getElementById('mg-css-' + id);
  if (!style) {
    style = document.createElement('style');
    style.id = 'mg-css-' + id;
    document.head.appendChild(style);
  }
  style.textContent = css;
}

/**
 * onTap(node, handler) — fast, touch-safe click: fires `handler(event)` on pointerup inside the
 * element (no 300 ms delay, no ghost clicks). Returns the node.
 * @param {HTMLElement} node
 * @param {(e: PointerEvent) => void} handler
 * @returns {HTMLElement}
 */
export function onTap(node, handler) {
  node.addEventListener('click', (e) => {
    e.stopPropagation();
    handler(e);
  });
  return node;
}

// ------------------------------------------------------------------------------------------------
// Base CSS
// ------------------------------------------------------------------------------------------------

const BASE_CSS = `
#game{
  --mg-font:"Hiragino Sans","Noto Sans JP","Yu Gothic",system-ui,sans-serif;
  --mg-text:#f3f5fa;--mg-dim:#a3abbd;--mg-faint:rgba(255,255,255,.14);
  --mg-bg:rgba(10,12,20,.62);--mg-panel:rgba(14,17,28,.9);--mg-panel-solid:#0e111c;--mg-line:rgba(255,255,255,.13);
  --mg-accent:#36e0ff;--mg-accent2:#ff4fa3;--mg-good:#4be08a;--mg-bad:#ff5468;--mg-warn:#ffd24a;--mg-money:#86f7a4;
  --mg-radius:14px;--mg-radius-sm:9px;
  --mg-shadow:0 6px 24px rgba(0,0,0,.45);
  --mg-glow:0 0 0 1px rgba(54,224,255,.35),0 0 18px rgba(54,224,255,.25);
}
#ui{font-family:var(--mg-font);color:var(--mg-text);font-size:14px;line-height:1.35;-webkit-font-smoothing:antialiased}
#ui *{box-sizing:border-box}
.mg-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.mg-hidden{display:none!important}
.mg-icon{display:block;flex:none}
.mg-panel{background:var(--mg-panel);border:1px solid var(--mg-line);border-radius:var(--mg-radius);
  box-shadow:var(--mg-shadow);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);pointer-events:auto}
.mg-glass{background:var(--mg-bg);border:1px solid var(--mg-line);border-radius:var(--mg-radius-sm);
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.mg-title{font-size:17px;font-weight:800;letter-spacing:.04em}
.mg-sub{font-size:12px;color:var(--mg-dim)}
.mg-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 18px;
  border-radius:12px;border:1px solid var(--mg-line);background:rgba(255,255,255,.07);color:var(--mg-text);
  font:700 15px var(--mg-font);pointer-events:auto;cursor:pointer;touch-action:manipulation;user-select:none;
  -webkit-user-select:none;transition:transform .08s,background .12s,border-color .12s}
.mg-btn:active{transform:scale(.96);background:rgba(255,255,255,.14)}
.mg-btn.primary{background:linear-gradient(180deg,#3fe6ff,#1bb3e6);color:#04121a;border-color:transparent;
  box-shadow:0 0 18px rgba(54,224,255,.35)}
.mg-btn.danger{background:linear-gradient(180deg,#ff6b7c,#e23a50);color:#fff;border-color:transparent}
.mg-btn.ghost{background:transparent}
.mg-btn[disabled],.mg-btn.disabled{opacity:.4;pointer-events:none}
.mg-icon-btn{width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:12px;
  background:var(--mg-bg);border:1px solid var(--mg-line);color:var(--mg-text);pointer-events:auto;cursor:pointer;
  touch-action:manipulation;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);transition:transform .08s}
.mg-icon-btn:active{transform:scale(.92);border-color:var(--mg-accent)}
.mg-list{display:flex;flex-direction:column;gap:6px}
.mg-row{display:flex;align-items:center;gap:12px;min-height:52px;padding:8px 12px;border-radius:12px;
  background:rgba(255,255,255,.05);border:1px solid transparent;pointer-events:auto;cursor:pointer;
  touch-action:manipulation;transition:background .12s,border-color .12s}
.mg-row:active{background:rgba(54,224,255,.14);border-color:rgba(54,224,255,.5)}
.mg-row.disabled{opacity:.42;pointer-events:none}
.mg-row .mg-row-main{flex:1;min-width:0}
.mg-row .mg-row-label{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mg-row .mg-row-sub{font-size:12px;color:var(--mg-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mg-row .mg-row-price{font-weight:800;color:var(--mg-money);font-variant-numeric:tabular-nums}
.mg-row .mg-row-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;
  background:rgba(255,255,255,.07);color:var(--mg-accent);flex:none}
.mg-tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;pointer-events:auto}
.mg-tabs::-webkit-scrollbar{display:none}
.mg-tab{flex:none;min-height:36px;padding:0 14px;border-radius:18px;border:1px solid var(--mg-line);
  background:transparent;color:var(--mg-dim);font:700 13px var(--mg-font);pointer-events:auto;cursor:pointer}
.mg-tab.active{background:rgba(54,224,255,.16);border-color:rgba(54,224,255,.6);color:var(--mg-text)}
.mg-scroll{overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y;
  pointer-events:auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.25) transparent}
.mg-bar{height:8px;border-radius:4px;background:rgba(255,255,255,.14);overflow:hidden}
.mg-bar>i{display:block;height:100%;width:100%;transform-origin:left center;border-radius:4px;
  background:var(--mg-accent);transition:transform .2s}
.mg-chip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:14px;
  background:var(--mg-bg);border:1px solid var(--mg-line);font-weight:700;font-size:13px}
.mg-badge{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--mg-accent2);color:#fff;
  font:800 11px/18px var(--mg-font);text-align:center}
.mg-text-shadow{text-shadow:0 1px 2px rgba(0,0,0,.9),0 0 8px rgba(0,0,0,.55)}
@keyframes mg-pop{from{transform:scale(.9);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes mg-slide-down{from{transform:translateY(-14px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes mg-slide-up{from{transform:translateY(24px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes mg-fade-in{from{opacity:0}to{opacity:1}}
/* test mode: no animations, so scripted screenshots are deterministic */
#ui.mg-test *{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important}
`;

const LAYER_Z = { world: 10, hud: 20, controls: 30, panel: 40, overlay: 50, top: 60 };
const layers = {};

// ------------------------------------------------------------------------------------------------
// G.ui
// ------------------------------------------------------------------------------------------------

export const ui = registerSystem({
  name: 'ui',
  order: 24,
  runWhenPaused: true,

  /** the #ui overlay element (pointer-events: none; controls opt back in) */
  root: null,
  /** icon markup table and names */
  icons: ICONS,
  iconNames: ICON_NAMES,
  /** name of the open panel, or null */
  panelOpen: null,

  icon,
  el,
  injectCSS,
  onTap,

  /**
   * layer(name, zIndex?) → HTMLElement. Returns (creating on first use) a full-frame layer
   * inside #ui. Built-in layers, back to front: world(10) hud(20) controls(30) panel(40)
   * overlay(50) top(60).
   * @param {string} name
   * @param {number} [zIndex]
   * @returns {HTMLElement}
   */
  layer(name, zIndex) {
    let node = layers[name];
    if (node) return node;
    const root = ensureRoot(this);
    node = el('div', { class: 'mg-layer mg-layer-' + name });
    node.style.zIndex = String(zIndex !== undefined ? zIndex : LAYER_Z[name] !== undefined ? LAYER_Z[name] : 25);
    root.appendChild(node);
    layers[name] = node;
    return node;
  },

  init() {
    ensureRoot(this);
    injectCSS('theme', BASE_CSS);
    for (const name in LAYER_Z) this.layer(name);
    const touchMode = G.input ? G.input.isTouch : false;
    this.root.classList.toggle('mg-touch', !!touchMode);
    this.root.classList.toggle('mg-desktop', !touchMode);
    this.root.classList.toggle('mg-test', !!G.flags.test);
  },
});

function ensureRoot(self) {
  if (self.root) return self.root;
  let root = document.getElementById('ui');
  if (!root) {
    const frame = document.getElementById('game') || document.body;
    root = el('div', { attrs: { id: 'ui' }, style: 'position:absolute;inset:0;pointer-events:none;overflow:hidden' });
    frame.appendChild(root);
  }
  self.root = root;
  return root;
}

export default ui;
