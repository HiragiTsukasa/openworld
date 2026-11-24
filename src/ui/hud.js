// MUGEN CITY — basic HUD (G.hud) + the complete G.ui API of ARCHITECTURE §18.
//
// Foundation version: functional and tidy; the `ui` module redesigns it later (keeping the API).
// HUD: minimap radar, health / armor, money, wanted stars, clock, objective, prompt, toasts,
// banner, phone / map / pause buttons. G.ui: notify, banner, objective, prompt, speechBubble,
// floatText, dialog, openPanel / closePanel / registerPanel, listPanel, registerPhoneApp,
// minimap.*, marker.*, hud.setVisible, setHudMode, fade.

import * as THREE from 'three';
import { G, registerSystem, reportError } from '../core/game.js';
import { CONFIG } from '../core/config.js';
import { formatYen } from '../core/mathx.js';
import { ui, icon, el, injectCSS, onTap } from './theme.js';

const CSS = `
.mg-hud{position:absolute;inset:0;pointer-events:none;transition:opacity .25s}
.mg-hud.mg-off{opacity:0;visibility:hidden}
.mg-hud-tl{position:absolute;left:calc(var(--sal,0px) + 10px);top:calc(var(--sat,0px) + 10px);width:108px}
.mg-minimap{display:block;width:108px;height:108px;border-radius:50%;border:2px solid rgba(255,255,255,.28);
  background:rgba(10,14,24,.6);box-shadow:0 4px 14px rgba(0,0,0,.4)}
.mg-vitals{margin-top:8px;display:flex;flex-direction:column;gap:5px}
.mg-vital{display:flex;align-items:center;gap:5px;height:12px}
.mg-vital .mg-bar{flex:1;height:7px;background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.18)}
.mg-vital.hp{color:#ff6b7c}.mg-vital.hp .mg-bar>i{background:linear-gradient(90deg,#ff5468,#ff8a6b)}
.mg-vital.ar{color:#6bc5ff}.mg-vital.ar .mg-bar>i{background:linear-gradient(90deg,#3aa4ff,#7fe0ff)}
.mg-hud-tr{position:absolute;right:calc(var(--sar,0px) + 10px);top:calc(var(--sat,0px) + 10px);
  display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.mg-hud-btns{display:flex;gap:8px}
.mg-money{font:800 20px/1.1 var(--mg-font);color:var(--mg-money);font-variant-numeric:tabular-nums;letter-spacing:.02em}
.mg-money.up{animation:mg-pop .25s}
.mg-wanted{display:flex;gap:1px;color:rgba(255,255,255,.22)}
.mg-wanted.mg-off{display:none}
.mg-wanted span{display:flex}
.mg-wanted span.on{color:var(--mg-warn);filter:drop-shadow(0 0 4px rgba(255,210,74,.8))}
.mg-wanted svg{fill:currentColor;stroke-width:1}
.mg-clock{font:700 14px/1 var(--mg-font);color:var(--mg-text);font-variant-numeric:tabular-nums;opacity:.92}
.mg-objective{position:absolute;left:calc(var(--sal,0px) + 10px);top:calc(var(--sat,0px) + 170px);max-width:62%;
  display:flex;align-items:flex-start;gap:6px;padding:7px 10px;font-weight:700;font-size:13px;color:var(--mg-text);
  border-left:3px solid var(--mg-accent);animation:mg-slide-down .25s}
.mg-objective svg{color:var(--mg-accent);margin-top:1px}
.mg-toasts{position:absolute;left:50%;top:calc(var(--sat,0px) + 132px);transform:translateX(-50%);
  display:flex;flex-direction:column;align-items:center;gap:6px;width:min(78%,300px)}
.mg-toast{display:flex;align-items:center;gap:8px;max-width:100%;padding:8px 12px;border-radius:12px;font-weight:700;
  font-size:13px;background:var(--mg-panel);border:1px solid var(--mg-line);box-shadow:var(--mg-shadow);
  animation:mg-slide-down .2s}
.mg-toast svg{color:var(--mg-accent)}
.mg-toast.good{border-color:rgba(75,224,138,.55)}.mg-toast.good svg{color:var(--mg-good)}
.mg-toast.bad{border-color:rgba(255,84,104,.55)}.mg-toast.bad svg{color:var(--mg-bad)}
.mg-toast.money{border-color:rgba(134,247,164,.55)}.mg-toast.money svg{color:var(--mg-money)}
.mg-banner{position:absolute;left:0;right:0;top:27%;text-align:center;padding:0 16px;animation:mg-pop .35s}
.mg-banner .t{font:900 34px/1.15 var(--mg-font);letter-spacing:.08em;color:#fff;
  text-shadow:0 2px 0 rgba(0,0,0,.6),0 0 5px rgba(0,0,0,.85),0 4px 14px rgba(0,0,0,.6),0 0 24px var(--bn,rgba(54,224,255,.8))}
.mg-banner .s{margin-top:6px;font:700 15px/1.3 var(--mg-font);color:var(--mg-text);
  text-shadow:0 1px 3px rgba(0,0,0,.95),0 0 10px rgba(0,0,0,.7)}
.mg-banner.area .t{font-size:26px}
.mg-banner.mission{--bn:rgba(255,210,74,.85)}.mg-banner.pass{--bn:rgba(75,224,138,.9)}
.mg-banner.fail,.mg-banner.down{--bn:rgba(255,84,104,.95)}.mg-banner.down .t,.mg-banner.busted .t{font-size:46px}
.mg-banner.busted{--bn:rgba(80,140,255,.95)}
.mg-prompt{position:absolute;left:50%;bottom:calc(var(--sab,0px) + 306px);transform:translateX(-50%);max-width:80%;
  display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:20px;font-weight:700;font-size:14px;
  background:var(--mg-panel);border:1px solid rgba(54,224,255,.5);box-shadow:var(--mg-glow);white-space:nowrap}
.mg-prompt svg{color:var(--mg-accent)}
#ui.mg-desktop .mg-prompt{bottom:calc(var(--sab,0px) + 90px)}
.mg-world-item{position:absolute;left:0;top:0;will-change:transform;pointer-events:none}
.mg-bubble{transform-origin:50% 100%;max-width:190px;padding:6px 10px;border-radius:12px;background:rgba(250,250,252,.95);
  color:#14161c;font:700 12px/1.3 var(--mg-font);box-shadow:0 3px 10px rgba(0,0,0,.35);white-space:normal;text-align:center}
.mg-bubble:after{content:"";position:absolute;left:50%;bottom:-6px;margin-left:-6px;border:6px solid transparent;
  border-top-color:rgba(250,250,252,.95);border-bottom:0}
.mg-float{font:900 16px/1 var(--mg-font);color:#fff;text-shadow:0 1px 2px #000,0 0 6px rgba(0,0,0,.7);white-space:nowrap}
.mg-marker{display:flex;flex-direction:column;align-items:center;gap:2px;color:var(--mk,#36e0ff);
  filter:drop-shadow(0 1px 3px rgba(0,0,0,.8))}
.mg-marker .ic{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  background:rgba(10,12,20,.72);border:2px solid currentColor}
.mg-marker .tx{font:800 10px/1.1 var(--mg-font);color:#fff;text-shadow:0 1px 2px #000;white-space:nowrap}
.mg-marker.edge{opacity:.7}
.mg-fade{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity .5s linear}
.mg-fade.on{pointer-events:auto}
.mg-sheet-host{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;pointer-events:auto;
  background:rgba(4,6,12,.5);animation:mg-fade-in .15s}
.mg-sheet{margin:0 8px calc(var(--sab,0px) + 8px);max-height:82%;display:flex;flex-direction:column;padding:12px;
  animation:mg-slide-up .2s}
.mg-sheet-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.mg-sheet-head .mg-title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mg-sheet-body{flex:1;min-height:0}
.mg-sheet .mg-tabs{margin-bottom:10px}
.mg-dialog .sp{font-weight:800;color:var(--mg-accent);margin-bottom:4px}
.mg-dialog .tx{font-size:15px;line-height:1.55;margin-bottom:12px;white-space:pre-wrap}
.mg-dialog .ch{display:flex;flex-direction:column;gap:8px}
.mg-apps{display:grid;grid-template-columns:repeat(4,1fr);gap:10px 6px;padding:4px 0}
.mg-app{position:relative;display:flex;flex-direction:column;align-items:center;gap:5px;padding:6px 2px;border-radius:12px;
  pointer-events:auto;cursor:pointer;font:700 11px/1.2 var(--mg-font);color:var(--mg-text);text-align:center}
.mg-app .ic{width:52px;height:52px;border-radius:15px;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(160deg,rgba(54,224,255,.28),rgba(255,79,163,.2));border:1px solid var(--mg-line);color:#fff}
.mg-app .mg-badge{position:absolute;top:2px;right:10px}
.mg-app:active .ic{transform:scale(.93)}
.mg-pause{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;
  background:rgba(4,6,12,.72);pointer-events:auto;animation:mg-fade-in .15s}
.mg-pause .t{font:900 30px/1 var(--mg-font);letter-spacing:.2em}
`;

// ------------------------------------------------------------------------------------------------
// State
// ------------------------------------------------------------------------------------------------

let root = null;
let nodes = null;
let minimapCtx = null;
let minimapScale = 2;
let refreshTimer = 0;
let minimapTimer = 0;
const shown = { hp: -1, ar: -1, money: NaN, wanted: -1, clock: '', mode: 'foot', prompt: '' };
/** @type {{node: HTMLElement, expire: number}[]} */
const toasts = [];
let bannerExpire = 0;
let fadeNode = null;
let pauseNode = null;

const blips = new Map();
let waypoint = null;
let searchArea = null;

const markers = new Map();
const bubbles = new Map();
const floats = [];
const _proj = { x: 0, y: 0, z: 0, visible: false };
const _pos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
let beamGeo = null;

const panels = new Map();
let panelHost = null;
let panelBody = null;
let panelDef = null;
let panelRestore = null;
let activeDialog = null;
const phoneApps = [];
const warnedPanels = new Set();

function esc(s) {
  return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
}

function targetPos(item, out) {
  const e = item.entity;
  if (e && e.pos) {
    out.set(e.pos.x, e.pos.y, e.pos.z);
    return e.alive !== false || item.keepDead === true;
  }
  const p = item.pos;
  if (p) {
    out.set(p.x, p.y || 0, p.z);
    return true;
  }
  return false;
}

function focusPos(out) {
  const p = G.player && G.player.pos;
  if (p) return out.set(p.x, p.y, p.z);
  if (G.camera) return out.setFromMatrixPosition(G.camera.matrixWorld);
  return out.set(0, 0, 0);
}

// ------------------------------------------------------------------------------------------------
// HUD refresh
// ------------------------------------------------------------------------------------------------

function refreshHud() {
  const player = G.player;
  const maxHp = player && player.maxHealth > 0 ? player.maxHealth : 100;
  const hp = player && typeof player.health === 'number' ? Math.max(0, Math.min(1, player.health / maxHp)) : 1;
  const ar = player && typeof player.armor === 'number' ? Math.max(0, Math.min(1, player.armor / 100)) : 0;
  if (Math.abs(hp - shown.hp) > 0.004) {
    shown.hp = hp;
    nodes.hpBar.style.transform = 'scaleX(' + hp.toFixed(3) + ')';
  }
  if (Math.abs(ar - shown.ar) > 0.004) {
    shown.ar = ar;
    nodes.arBar.style.transform = 'scaleX(' + ar.toFixed(3) + ')';
    nodes.arRow.style.visibility = ar > 0 ? 'visible' : 'hidden';
  }
  const money = G.economy && typeof G.economy.money === 'number' ? G.economy.money : 0;
  if (money !== shown.money) {
    const up = money > shown.money;
    shown.money = money;
    nodes.money.textContent = formatYen(money);
    if (up) {
      nodes.money.classList.remove('up');
      void nodes.money.offsetWidth;
      nodes.money.classList.add('up');
    }
  }
  const wanted = G.police && typeof G.police.level === 'number' ? Math.max(0, Math.min(6, Math.round(G.police.level))) : 0;
  if (wanted !== shown.wanted) {
    shown.wanted = wanted;
    nodes.wanted.classList.toggle('mg-off', wanted <= 0);
    const stars = nodes.wanted.children;
    for (let i = 0; i < stars.length; i++) stars[i].classList.toggle('on', i < wanted);
  }
  const h = G.time.hour;
  const hh = Math.floor(h) % 24;
  const mm = Math.floor((h - Math.floor(h)) * 60);
  const clock = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  if (clock !== shown.clock) {
    shown.clock = clock;
    nodes.clock.textContent = clock;
  }
}

const mm = { c: 0, k: 1, px: 0, pz: 0, fx: 0, fz: 1, max: 1 };
const mmOut = { x: 0, y: 0, edge: false };
/** world (x, z) → minimap canvas coordinates; null when out of range and not clamped. */
function mapToScreen(wx, wz, clampEdge) {
  const dx = wx - mm.px;
  const dz = wz - mm.pz;
  let sx = (dx * -mm.fz + dz * mm.fx) * mm.k;
  let sy = -(dx * mm.fx + dz * mm.fz) * mm.k;
  const d = Math.hypot(sx, sy);
  let edge = false;
  if (d > mm.max) {
    if (!clampEdge) return null;
    sx = (sx / d) * mm.max;
    sy = (sy / d) * mm.max;
    edge = true;
  }
  mmOut.x = mm.c + sx;
  mmOut.y = mm.c + sy;
  mmOut.edge = edge;
  return mmOut;
}

function drawMinimap() {
  const ctx = minimapCtx;
  if (!ctx) return;
  const size = 108 * minimapScale;
  const c = size / 2;
  const range = 140; // meters from centre to rim
  const k = (c - 6 * minimapScale) / range;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, c - 1, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = 'rgba(12,18,30,0.55)';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = minimapScale;
  for (let r = 1; r <= 2; r++) {
    ctx.beginPath();
    ctx.arc(c, c, ((c - 6 * minimapScale) * r) / 2, 0, Math.PI * 2);
    ctx.stroke();
  }
  // orientation: camera forward is up
  let fx = 0;
  let fz = 1;
  if (G.camera) {
    G.camera.getWorldDirection(_fwd);
    const l = Math.hypot(_fwd.x, _fwd.z);
    if (l > 1e-4) {
      fx = _fwd.x / l;
      fz = _fwd.z / l;
    }
  }
  focusPos(_pos);
  mm.c = c;
  mm.k = k;
  mm.px = _pos.x;
  mm.pz = _pos.z;
  mm.fx = fx;
  mm.fz = fz;
  mm.max = c - 8 * minimapScale;
  const toScreen = mapToScreen;
  if (searchArea) {
    const s = toScreen(searchArea.x, searchArea.z, true);
    if (s) {
      ctx.fillStyle = 'rgba(255,84,104,0.22)';
      ctx.strokeStyle = 'rgba(255,84,104,0.7)';
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(4, searchArea.radius * k), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  // north tick
  {
    const nx = (0 * -fz + -1 * fx) * (c - 9 * minimapScale);
    const ny = -(0 * fx + -1 * fz) * (c - 9 * minimapScale);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '700 ' + 10 * minimapScale + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', c + nx, c + ny);
  }
  for (const b of blips.values()) {
    if (!targetPos(b, _pos)) continue;
    const s = toScreen(_pos.x, _pos.z, b.edge === true);
    if (!s) continue;
    ctx.fillStyle = b.color || '#36e0ff';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = minimapScale;
    ctx.beginPath();
    ctx.arc(s.x, s.y, (s.edge ? 3 : 4) * minimapScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  if (waypoint) {
    const s = toScreen(waypoint.x, waypoint.z, true);
    ctx.fillStyle = '#ff4fa3';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = minimapScale;
    ctx.beginPath();
    ctx.rect(s.x - 4 * minimapScale, s.y - 4 * minimapScale, 8 * minimapScale, 8 * minimapScale);
    ctx.fill();
    ctx.stroke();
  }
  // player arrow (always pointing up = camera forward)
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = minimapScale;
  ctx.beginPath();
  ctx.moveTo(c, c - 7 * minimapScale);
  ctx.lineTo(c + 5 * minimapScale, c + 6 * minimapScale);
  ctx.lineTo(c, c + 3 * minimapScale);
  ctx.lineTo(c - 5 * minimapScale, c + 6 * minimapScale);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// ------------------------------------------------------------------------------------------------
// World-anchored DOM (markers, speech bubbles, floating text) — projected right before rendering
// ------------------------------------------------------------------------------------------------

function place(node, x, y, scale) {
  node.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) translate(-50%,-100%)' + (scale !== 1 ? ' scale(' + scale.toFixed(2) + ')' : '');
}

function projectWorldUI() {
  const renderer = G.renderer;
  const cam = G.camera;
  if (!renderer || !cam) return;
  if (markers.size === 0 && bubbles.size === 0 && floats.length === 0) return;
  cam.updateMatrixWorld();
  const now = G.time.now;
  const w = renderer.width;
  const h = renderer.height;
  const camPos = _fwd.setFromMatrixPosition(cam.matrixWorld);

  markers.forEach((m) => {
    if (!targetPos(m, _pos)) {
      m.node.style.display = 'none';
      if (m.beam) m.beam.visible = false;
      return;
    }
    if (m.beam) {
      m.beam.visible = true;
      m.beam.position.set(_pos.x, _pos.y, _pos.z);
    }
    const dist = _pos.distanceTo(camPos);
    _pos.y += m.height;
    renderer.worldToScreen(_pos, _proj);
    let x = _proj.x;
    let y = _proj.y;
    let edge = false;
    if (!_proj.visible) {
      // clamp to the frame edge, pointing towards the target
      const behind = _proj.z > 1;
      let dx = x - w / 2;
      let dy = y - h / 2;
      if (behind) {
        dx = -dx;
        dy = Math.abs(dy) + h;
      }
      const sx = (w / 2 - 26) / Math.max(1e-3, Math.abs(dx));
      const sy = (h / 2 - 60) / Math.max(1e-3, Math.abs(dy));
      const s = Math.min(sx, sy, 1);
      x = w / 2 + dx * s;
      y = h / 2 + dy * s + 20;
      edge = true;
    }
    m.node.style.display = '';
    m.node.classList.toggle('edge', edge);
    place(m.node, x, y, 1);
    const dtxt = dist >= 1000 ? (dist / 1000).toFixed(1) + 'km' : Math.round(dist) + 'm';
    if (dtxt !== m.dtxt) {
      m.dtxt = dtxt;
      m.distNode.textContent = dtxt;
    }
  });

  bubbles.forEach((b, entity) => {
    // gone when expired, dead, or despawned (only entities that were registered carry an id)
    if (now >= b.expire || !entity.pos || entity.alive === false || (entity.id !== undefined && !G.entities.has(entity))) {
      b.node.remove();
      bubbles.delete(entity);
      return;
    }
    _pos.set(entity.pos.x, entity.pos.y + (entity.height || 1.85) + 0.25, entity.pos.z);
    const dist = _pos.distanceTo(camPos);
    renderer.worldToScreen(_pos, _proj);
    if (!_proj.visible || dist > 45) {
      b.node.style.display = 'none';
      return;
    }
    b.node.style.display = '';
    place(b.node, _proj.x, _proj.y, Math.max(0.6, Math.min(1, 9 / dist)));
  });

  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i];
    const t = (now - f.t0) / f.duration;
    if (t >= 1) {
      f.node.remove();
      floats[i] = floats[floats.length - 1];
      floats.pop();
      continue;
    }
    _pos.set(f.x, f.y + t * 1.4, f.z);
    renderer.worldToScreen(_pos, _proj);
    if (!_proj.visible) {
      f.node.style.display = 'none';
      continue;
    }
    f.node.style.display = '';
    f.node.style.opacity = String(t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3);
    place(f.node, _proj.x, _proj.y, 1);
  }
}

// ------------------------------------------------------------------------------------------------
// Panels
// ------------------------------------------------------------------------------------------------

function ensurePanelHost() {
  if (panelHost) return;
  panelHost = el('div', { class: 'mg-sheet-host mg-hidden' });
  panelBody = el('div', { class: 'mg-sheet mg-panel' });
  panelHost.appendChild(panelBody);
  panelHost.addEventListener('pointerdown', (e) => {
    if (e.target === panelHost && panelDef && panelDef.modal !== true) ui.closePanel();
  });
  ui.layer('panel').appendChild(panelHost);
}

function sheetHeader(title, onBack) {
  const head = el('div', { class: 'mg-sheet-head' });
  if (onBack) head.appendChild(onTap(el('div', { class: 'mg-icon-btn', html: icon('back', 22) }), onBack));
  head.appendChild(el('div', { class: 'mg-title', text: title || '' }));
  head.appendChild(onTap(el('div', { class: 'mg-icon-btn', html: icon('close', 22) }), () => ui.closePanel()));
  return head;
}

function renderRows(listNode, items, opts) {
  listNode.textContent = '';
  const list = items || [];
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    const row = el('div', { class: 'mg-row' + (it.disabled ? ' disabled' : '') });
    if (it.icon) row.appendChild(el('div', { class: 'mg-row-icon', html: icon(it.icon, 22) }));
    const main = el('div', { class: 'mg-row-main' });
    main.appendChild(el('div', { class: 'mg-row-label', text: it.label || '' }));
    if (it.sub) main.appendChild(el('div', { class: 'mg-row-sub', text: it.sub }));
    row.appendChild(main);
    if (it.price !== undefined && it.price !== null) {
      row.appendChild(el('div', { class: 'mg-row-price', text: typeof it.price === 'number' ? formatYen(it.price) : String(it.price) }));
    }
    onTap(row, () => {
      if (it.disabled) return;
      try {
        if (typeof it.action === 'function') it.action(it);
      } catch (err) {
        reportError(err, 'ui', 'listPanel.action');
      }
      if (opts && opts.closeOnSelect) ui.closePanel();
    });
    listNode.appendChild(row);
  }
  if (list.length === 0) listNode.appendChild(el('div', { class: 'mg-sub', text: opts && opts.empty ? opts.empty : '項目がありません', style: 'padding:14px;text-align:center' }));
}

function openPhoneHome(body) {
  body.textContent = '';
  body.appendChild(sheetHeader('スマホ'));
  const grid = el('div', { class: 'mg-apps mg-scroll mg-sheet-body' });
  if (phoneApps.length === 0) grid.appendChild(el('div', { class: 'mg-sub', text: 'アプリがありません', style: 'grid-column:1/-1;padding:14px;text-align:center' }));
  for (let i = 0; i < phoneApps.length; i++) {
    const app = phoneApps[i];
    const node = el('div', { class: 'mg-app' });
    node.appendChild(el('div', { class: 'ic', html: icon(app.icon || 'dot', 26) }));
    node.appendChild(el('div', { text: app.name || app.id }));
    let badge = 0;
    try {
      badge = typeof app.badge === 'function' ? app.badge() : app.badge;
    } catch (err) {
      reportError(err, 'ui', 'phone.badge');
    }
    if (badge) node.appendChild(el('div', { class: 'mg-badge', text: String(badge) }));
    onTap(node, () => openPhoneApp(body, app));
    grid.appendChild(node);
  }
  body.appendChild(grid);
}

let currentApp = null;
function closePhoneApp() {
  if (!currentApp) return;
  const app = currentApp;
  currentApp = null;
  try {
    if (typeof app.onClose === 'function') app.onClose();
  } catch (err) {
    reportError(err, 'ui', 'phone.onClose');
  }
}

function openPhoneApp(body, app) {
  closePhoneApp();
  body.textContent = '';
  body.appendChild(
    sheetHeader(app.name || app.id, () => {
      closePhoneApp();
      openPhoneHome(body);
    })
  );
  const content = el('div', { class: 'mg-scroll mg-sheet-body' });
  body.appendChild(content);
  currentApp = app;
  try {
    if (typeof app.onOpen === 'function') app.onOpen();
    if (typeof app.render === 'function') app.render(content);
  } catch (err) {
    reportError(err, 'ui', 'phone.render:' + app.id);
  }
}

// ------------------------------------------------------------------------------------------------
// G.ui API (ARCHITECTURE §18)
// ------------------------------------------------------------------------------------------------

const api = {
  /**
   * notify(text, {icon, type='info', duration=3}) — toast message at the top of the screen.
   * type: 'info' | 'good' | 'bad' | 'money'.
   * @param {string} text
   * @param {{icon?: string, type?: string, duration?: number}} [opts]
   */
  notify(text, opts) {
    if (!nodes) return;
    const o = opts || {};
    const type = o.type || 'info';
    const ic = o.icon || (type === 'good' ? 'check' : type === 'bad' ? 'warning' : type === 'money' ? 'yen' : 'info');
    const node = el('div', { class: 'mg-toast ' + type, html: icon(ic, 18) + '<span>' + esc(text) + '</span>' });
    nodes.toasts.appendChild(node);
    toasts.push({ node, expire: G.time.now + (o.duration > 0 ? o.duration : 3) });
    while (toasts.length > 4) toasts.shift().node.remove();
  },

  /**
   * banner(title, subtitle?, {style='area', duration=3}) — big centred announcement.
   * style: 'area' | 'mission' | 'pass' | 'fail' | 'down' | 'busted'.
   * @param {string} title
   * @param {string} [subtitle]
   * @param {{style?: string, duration?: number}} [opts]
   */
  banner(title, subtitle, opts) {
    if (!nodes) return;
    const o = opts || {};
    const b = nodes.banner;
    b.className = 'mg-banner ' + (o.style || 'area');
    b.innerHTML = '<div class="t">' + esc(title) + '</div>' + (subtitle ? '<div class="s">' + esc(subtitle) + '</div>' : '');
    b.style.display = '';
    // restart the entrance animation
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
    bannerExpire = G.time.now + (o.duration > 0 ? o.duration : 3);
  },

  /**
   * objective(text | null) — sets / clears the current objective line.
   * @param {string|null} text
   */
  objective(text) {
    if (!nodes) return;
    if (!text) {
      nodes.objective.classList.add('mg-hidden');
      return;
    }
    nodes.objective.innerHTML = icon('flag', 16) + '<span>' + esc(text) + '</span>';
    nodes.objective.classList.remove('mg-hidden');
  },

  /**
   * prompt(text | null, {icon}) — sets / clears the contextual interaction prompt.
   * @param {string|null} text
   * @param {{icon?: string}} [opts]
   */
  prompt(text, opts) {
    if (!nodes) return;
    if (!text) {
      if (shown.prompt) {
        shown.prompt = '';
        nodes.prompt.classList.add('mg-hidden');
      }
      return;
    }
    const key = text + '|' + (opts && opts.icon ? opts.icon : '');
    if (shown.prompt === key) return;
    shown.prompt = key;
    nodes.prompt.innerHTML = icon((opts && opts.icon) || 'interact', 18) + '<span>' + esc(text) + '</span>';
    nodes.prompt.classList.remove('mg-hidden');
  },

  /**
   * speechBubble(entity, text, duration=3) — speech bubble above an entity (one per entity).
   * @param {{pos: THREE.Vector3, height?: number}} entity
   * @param {string} text
   * @param {number} [duration]
   */
  speechBubble(entity, text, duration = 3) {
    if (!entity || !entity.pos || !root) return;
    let b = bubbles.get(entity);
    if (!b) {
      if (bubbles.size >= 12) return;
      b = { node: el('div', { class: 'mg-world-item mg-bubble' }), expire: 0 };
      b.node.style.display = 'none';
      ui.layer('world').appendChild(b.node);
      bubbles.set(entity, b);
    }
    b.node.textContent = String(text);
    b.expire = G.time.now + (duration > 0 ? duration : 3);
  },

  /**
   * floatText(pos, text, {color, duration=1.2, size}) — text that rises from a world position
   * and fades (damage numbers, money pickups).
   * @param {{x:number,y:number,z:number}} pos
   * @param {string} text
   * @param {{color?: string, duration?: number, size?: number}} [opts]
   */
  floatText(pos, text, opts) {
    if (!pos || !root) return;
    if (floats.length >= 24) {
      const old = floats.shift();
      old.node.remove();
    }
    const o = opts || {};
    const node = el('div', { class: 'mg-world-item mg-float', text: String(text) });
    if (o.color) node.style.color = typeof o.color === 'number' ? '#' + o.color.toString(16).padStart(6, '0') : o.color;
    if (o.size) node.style.fontSize = o.size + 'px';
    node.style.display = 'none';
    ui.layer('world').appendChild(node);
    floats.push({ node, x: pos.x, y: pos.y, z: pos.z, t0: G.time.now, duration: o.duration > 0 ? o.duration : 1.2 });
  },

  /**
   * dialog({title, text, speaker, choices:[{label, action, style}]}) → Promise<number>.
   * Modal dialog; resolves with the index of the chosen choice after running its `action`
   * (-1 when closed programmatically). Without choices a single 「OK」 button is shown.
   * `G.ui.activeDialog.choose(i)` selects programmatically (tests).
   * @param {{title?: string, text?: string, speaker?: string, choices?: {label: string, action?: Function, style?: string}[]}} opts
   * @returns {Promise<number>}
   */
  dialog(opts) {
    const o = opts || {};
    const choices = o.choices && o.choices.length ? o.choices : [{ label: 'OK' }];
    if (activeDialog) activeDialog.choose(-1);
    return new Promise((resolve) => {
      let done = false;
      const choose = (i) => {
        if (done) return;
        done = true;
        ui.activeDialog = activeDialog = null;
        if (ui.panelOpen === 'dialog') ui.closePanel();
        const c = choices[i];
        if (c && typeof c.action === 'function') {
          try {
            c.action(c);
          } catch (err) {
            reportError(err, 'ui', 'dialog.action');
          }
        }
        resolve(i);
      };
      ui.activeDialog = activeDialog = { choose, options: o };
      ui.openPanel('dialog', { o, choices, choose });
    });
  },

  /** the open dialog's controller {choose(index)} or null */
  activeDialog: null,

  /**
   * registerPanel(name, {open(container, data, ctl), close(), modal}) — registers a panel that
   * `openPanel(name, data)` can show inside the bottom sheet. `ctl = {close()}`.
   * @param {string} name
   * @param {{open: Function, close?: Function, modal?: boolean}} def
   */
  registerPanel(name, def) {
    if (def && typeof def.open === 'function') panels.set(name, def);
  },

  /**
   * openPanel(name, data?) → true when the panel was opened. Closes any other open panel,
   * switches input to the 'menu' context and emits `ui:open {panel}`.
   * @param {string} name
   * @param {any} [data]
   * @returns {boolean}
   */
  openPanel(name, data) {
    const d = panels.get(name);
    if (!d) {
      if (!warnedPanels.has(name)) {
        warnedPanels.add(name);
        console.warn('[MUGEN] ui.openPanel: unknown panel "' + name + '"');
      }
      return false;
    }
    if (ui.panelOpen) ui.closePanel();
    ensurePanelHost();
    panelDef = d;
    ui.panelOpen = name;
    ui.panelOpen = name;
    panelBody.textContent = '';
    panelBody.className = 'mg-sheet mg-panel';
    panelHost.classList.remove('mg-hidden');
    panelRestore = G.input.pushContext('menu');
    G.input.exitPointerLock();
    try {
      d.open(panelBody, data, { close: () => ui.closePanel() });
    } catch (err) {
      reportError(err, 'ui', 'panel.open:' + name);
    }
    G.events.emit('ui:open', { panel: name });
    return true;
  },

  /**
   * closePanel() — closes the open panel (no-op when none), restores the input context and
   * emits `ui:close {panel}`.
   */
  closePanel() {
    const name = ui.panelOpen;
    if (!name) return;
    const d = panelDef;
    ui.panelOpen = null;
    ui.panelOpen = null;
    panelDef = null;
    if (panelHost) panelHost.classList.add('mg-hidden');
    if (panelBody) panelBody.textContent = '';
    if (panelRestore) {
      panelRestore();
      panelRestore = null;
    }
    try {
      if (d && typeof d.close === 'function') d.close();
    } catch (err) {
      reportError(err, 'ui', 'panel.close:' + name);
    }
    G.events.emit('ui:close', { panel: name });
  },

  /** name of the open panel or null */
  panelOpen: null,

  /**
   * listPanel({title, items, tabs, onClose, closeOnSelect, empty}) → {close(), setItems(items)}.
   * Generic shop / menu list. items: [{label, sub, price, icon, disabled, action(item)}];
   * tabs: [{label, items}] (when given, each tab has its own item list).
   * @param {{title?: string, items?: object[], tabs?: {label: string, items: object[]}[], onClose?: Function, closeOnSelect?: boolean, empty?: string}} opts
   * @returns {{close: () => void, setItems: (items: object[]) => void}}
   */
  listPanel(opts) {
    const handle = { close: () => {}, setItems: () => {} };
    ui.openPanel('list', { opts: opts || {}, handle });
    return handle;
  },

  /**
   * registerPhoneApp({id, name, icon, order, render(container), onOpen, onClose, badge}) —
   * adds an app to the in-game phone (replaces an app with the same id).
   * @param {{id: string, name: string, icon?: string, order?: number, render?: Function, onOpen?: Function, onClose?: Function, badge?: number|Function}} app
   */
  registerPhoneApp(app) {
    if (!app || !app.id) return;
    const i = phoneApps.findIndex((a) => a.id === app.id);
    if (i >= 0) phoneApps.splice(i, 1);
    phoneApps.push(app);
    phoneApps.sort((a, b) => (a.order || 0) - (b.order || 0));
    G.events.emit('ui:phoneapp', { app });
  },

  /** registered phone apps, sorted by order */
  phoneApps,

  /** Minimap controls. */
  minimap: {
    /** live blip table (id → blip) */
    blips,
    /**
     * addBlip({id, pos | entity, icon, color, label, edge}) → id. `edge: true` keeps the blip
     * on the rim when out of range. Replaces a blip with the same id.
     * @param {{id?: string, pos?: object, entity?: object, icon?: string, color?: string, label?: string, edge?: boolean}} blip
     * @returns {string}
     */
    addBlip(blip) {
      if (!blip) return '';
      if (blip.id === undefined || blip.id === null) blip.id = 'blip' + ++autoId;
      blips.set(blip.id, blip);
      return blip.id;
    },
    /**
     * removeBlip(id) — removes a blip (no-op for unknown ids).
     * @param {string} id
     */
    removeBlip(id) {
      blips.delete(id);
    },
    /**
     * setWaypoint(x, z) / setWaypoint(null) — sets or clears the player's waypoint.
     * Emits `ui:waypoint {x, z} | {x:null}`.
     * @param {number|null} x
     * @param {number} [z]
     */
    setWaypoint(x, z) {
      waypoint = x === null || x === undefined ? null : { x, z };
      ui.minimap.waypoint = waypoint;
      G.events.emit('ui:waypoint', waypoint || { x: null, z: null });
    },
    /** current waypoint {x, z} or null */
    waypoint: null,
    /**
     * setSearchArea(x, z, radius) / setSearchArea(null) — police search circle.
     * @param {number|null} x
     * @param {number} [z]
     * @param {number} [radius]
     */
    setSearchArea(x, z, radius) {
      searchArea = x === null || x === undefined ? null : { x, z, radius: radius || 60 };
      ui.minimap.searchArea = searchArea;
    },
    searchArea: null,
  },

  /** 3D world markers. */
  marker: {
    /** live marker table (id → marker) */
    markers,
    /**
     * add({id, pos | entity, icon, color, label, beam, radius, height}) → id. Screen-space
     * marker with distance read-out (clamped to the screen edge when off-screen); `beam: true`
     * adds a light column of `radius` meters. Replaces a marker with the same id.
     * @param {{id?: string, pos?: object, entity?: object, icon?: string, color?: string|number, label?: string, beam?: boolean, radius?: number, height?: number}} marker
     * @returns {string}
     */
    add(marker) {
      if (!marker || !root) return '';
      if (marker.id === undefined || marker.id === null) marker.id = 'marker' + ++autoId;
      ui.marker.remove(marker.id);
      const color = typeof marker.color === 'number' ? '#' + marker.color.toString(16).padStart(6, '0') : marker.color || '#36e0ff';
      const node = el('div', { class: 'mg-world-item mg-marker' });
      node.style.setProperty('--mk', color);
      node.appendChild(el('div', { class: 'ic', html: icon(marker.icon || 'pin', 18) }));
      if (marker.label) node.appendChild(el('div', { class: 'tx', text: marker.label }));
      const distNode = el('div', { class: 'tx' });
      node.appendChild(distNode);
      node.style.display = 'none';
      ui.layer('world').appendChild(node);
      const rec = { id: marker.id, pos: marker.pos, entity: marker.entity, node, distNode, dtxt: '', beam: null, height: marker.height !== undefined ? marker.height : 2.4, keepDead: true };
      if (marker.beam && G.scene) {
        if (!beamGeo) {
          beamGeo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true);
          beamGeo.translate(0, 0.5, 0);
        }
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
        const mesh = new THREE.Mesh(beamGeo, mat);
        const r = marker.radius > 0 ? marker.radius : 1.2;
        mesh.scale.set(r, 40, r);
        mesh.layers.set(CONFIG.LAYER_UI3D);
        mesh.renderOrder = 10;
        mesh.frustumCulled = false;
        G.scene.add(mesh);
        rec.beam = mesh;
      }
      markers.set(marker.id, rec);
      return marker.id;
    },
    /**
     * remove(id) — removes a marker (no-op for unknown ids).
     * @param {string} id
     */
    remove(id) {
      const rec = markers.get(id);
      if (!rec) return;
      rec.node.remove();
      if (rec.beam) {
        if (rec.beam.parent) rec.beam.parent.remove(rec.beam);
        rec.beam.material.dispose();
      }
      markers.delete(id);
    },
  },

  /**
   * setHudMode(mode) — 'foot' | 'vehicle' | 'aircraft' | 'boat' | 'cinematic' ...; exposed as
   * `data-mode` on the HUD root (CSS hooks) and emitted as `ui:hudmode {mode}`.
   * @param {string} mode
   */
  setHudMode(mode) {
    if (shown.mode === mode) return;
    shown.mode = mode;
    ui.hudMode = mode;
    if (root) root.dataset.mode = mode;
    G.events.emit('ui:hudmode', { mode });
  },

  /** current HUD mode */
  hudMode: 'foot',

  /**
   * fade(toBlack, seconds=0.5) → Promise resolved when the fade finished. Fades the whole frame
   * (world + HUD) to / from black. Instant in test mode.
   * @param {boolean} toBlack
   * @param {number} [seconds]
   * @returns {Promise<void>}
   */
  fade(toBlack, seconds = 0.5) {
    if (!fadeNode) return Promise.resolve();
    const secs = G.flags.test ? 0 : Math.max(0, seconds);
    fadeNode.style.transitionDuration = secs + 's';
    fadeNode.classList.toggle('on', !!toBlack);
    // force style flush so the transition always starts from the current value
    void fadeNode.offsetWidth;
    fadeNode.style.opacity = toBlack ? '1' : '0';
    ui.faded = !!toBlack;
    if (secs === 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, secs * 1000 + 30));
  },

  /** true while the screen is (fading to) black */
  faded: false,
};

let autoId = 0;
// G.ui is the object registered by ui/theme.js: the API (and its state fields) live on it.
Object.assign(ui, api);

// ------------------------------------------------------------------------------------------------
// Built-in panels
// ------------------------------------------------------------------------------------------------

ui.registerPanel('list', {
  open(body, data) {
    const o = data.opts;
    this._onClose = o.onClose;
    body.appendChild(sheetHeader(o.title || ''));
    const listNode = el('div', { class: 'mg-list mg-scroll mg-sheet-body' });
    let tabIndex = 0;
    if (o.tabs && o.tabs.length) {
      const tabsNode = el('div', { class: 'mg-tabs' });
      const select = (i) => {
        tabIndex = i;
        for (let k = 0; k < tabsNode.children.length; k++) tabsNode.children[k].classList.toggle('active', k === i);
        renderRows(listNode, o.tabs[i].items, o);
      };
      o.tabs.forEach((t, i) => tabsNode.appendChild(onTap(el('button', { class: 'mg-tab', text: t.label, attrs: { type: 'button' } }), () => select(i))));
      body.appendChild(tabsNode);
      body.appendChild(listNode);
      select(0);
    } else {
      body.appendChild(listNode);
      renderRows(listNode, o.items, o);
    }
    data.handle.close = () => {
      if (ui.panelOpen === 'list') ui.closePanel();
    };
    data.handle.setItems = (items) => {
      if (o.tabs && o.tabs.length) o.tabs[tabIndex].items = items;
      else o.items = items;
      renderRows(listNode, items, o);
    };
  },
  close() {
    const cb = this._onClose;
    this._onClose = null;
    if (typeof cb === 'function') {
      try {
        cb();
      } catch (err) {
        reportError(err, 'ui', 'listPanel.onClose');
      }
    }
  },
});

ui.registerPanel('dialog', {
  modal: true,
  open(body, data) {
    const o = data.o;
    body.classList.add('mg-dialog');
    if (o.title) body.appendChild(el('div', { class: 'mg-title', text: o.title, style: 'margin-bottom:8px' }));
    if (o.speaker) body.appendChild(el('div', { class: 'sp', text: o.speaker }));
    if (o.text) body.appendChild(el('div', { class: 'tx', text: o.text }));
    const ch = el('div', { class: 'ch' });
    data.choices.forEach((c, i) => {
      ch.appendChild(onTap(el('button', { class: 'mg-btn' + (i === 0 ? ' primary' : '') + (c.style ? ' ' + c.style : ''), text: c.label, attrs: { type: 'button' } }), () => data.choose(i)));
    });
    body.appendChild(ch);
    this._choose = data.choose;
  },
  close() {
    const choose = this._choose;
    this._choose = null;
    if (choose) choose(-1);
  },
});

ui.registerPanel('phone', {
  open(body) {
    openPhoneHome(body);
  },
  close() {
    closePhoneApp();
  },
});

// ------------------------------------------------------------------------------------------------
// HUD system
// ------------------------------------------------------------------------------------------------

function buildHud() {
  root = el('div', { class: 'mg-hud' });
  root.dataset.mode = shown.mode;
  const tl = el('div', { class: 'mg-hud-tl' });
  const mm = el('canvas', { class: 'mg-minimap' });
  minimapScale = Math.min(3, Math.max(1, Math.round(G.flags.test ? 2 : window.devicePixelRatio || 1)));
  mm.width = mm.height = 108 * minimapScale;
  minimapCtx = mm.getContext('2d');
  tl.appendChild(mm);
  const vitals = el('div', { class: 'mg-vitals' });
  const hpRow = el('div', { class: 'mg-vital hp', html: icon('heart', 12) + '<div class="mg-bar"><i></i></div>' });
  const arRow = el('div', { class: 'mg-vital ar', html: icon('shield', 12) + '<div class="mg-bar"><i></i></div>' });
  vitals.appendChild(hpRow);
  vitals.appendChild(arRow);
  tl.appendChild(vitals);
  root.appendChild(tl);

  const tr = el('div', { class: 'mg-hud-tr' });
  const btns = el('div', { class: 'mg-hud-btns' });
  const mkBtn = (name, ic, label) => {
    const b = el('div', { class: 'mg-icon-btn', html: icon(ic, 22), attrs: { role: 'button', 'aria-label': label, 'data-btn': name } });
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      G.input.press(name);
      G.input.vibrate(8);
    });
    btns.appendChild(b);
    return b;
  };
  mkBtn('map', 'map', 'マップ');
  mkBtn('phone', 'phone', 'スマホ');
  mkBtn('pause', 'pause', 'ポーズ');
  tr.appendChild(btns);
  const money = el('div', { class: 'mg-money mg-text-shadow', text: '¥0' });
  const wanted = el('div', { class: 'mg-wanted mg-off' });
  for (let i = 0; i < 6; i++) wanted.appendChild(el('span', { html: icon('star', 17) }));
  const clock = el('div', { class: 'mg-clock mg-text-shadow', text: '08:00' });
  tr.appendChild(money);
  tr.appendChild(wanted);
  tr.appendChild(clock);
  root.appendChild(tr);

  const objective = el('div', { class: 'mg-objective mg-glass mg-hidden' });
  const toastsNode = el('div', { class: 'mg-toasts' });
  const banner = el('div', { class: 'mg-banner' });
  banner.style.display = 'none';
  const prompt = el('div', { class: 'mg-prompt mg-hidden' });
  root.appendChild(objective);
  root.appendChild(toastsNode);
  root.appendChild(banner);
  root.appendChild(prompt);
  ui.layer('hud').appendChild(root);

  fadeNode = el('div', { class: 'mg-fade' });
  ui.layer('overlay').appendChild(fadeNode);

  nodes = {
    hpBar: hpRow.querySelector('i'),
    arBar: arRow.querySelector('i'),
    arRow,
    money,
    wanted,
    clock,
    objective,
    toasts: toastsNode,
    banner,
    prompt,
    minimap: mm,
  };
}

function showBasicPause(show) {
  if (show) {
    if (pauseNode) return;
    pauseNode = el('div', { class: 'mg-pause' });
    pauseNode.appendChild(el('div', { class: 't', text: '一時停止' }));
    pauseNode.appendChild(onTap(el('button', { class: 'mg-btn primary', text: '再開', attrs: { type: 'button' } }), () => G.setPaused(false)));
    ui.layer('top').appendChild(pauseNode);
  } else if (pauseNode) {
    pauseNode.remove();
    pauseNode = null;
  }
}

export const hud = registerSystem({
  name: 'hud',
  order: 25,
  runWhenPaused: true,

  /** the HUD root element */
  get root() {
    return root;
  },

  /** visible → true while the HUD is shown. */
  visible: true,

  /**
   * setVisible(show) — shows / hides the whole HUD (cutscenes, photo mode).
   * @param {boolean} show
   */
  setVisible(show) {
    this.visible = !!show;
    if (root) root.classList.toggle('mg-off', !this.visible);
  },

  /**
   * refresh() — forces an immediate HUD + minimap redraw (normally ~8 Hz).
   */
  refresh() {
    if (!nodes) return;
    refreshHud();
    drawMinimap();
  },

  init() {
    injectCSS('hud', CSS);
    buildHud();
    refreshHud();
    if (G.renderer && G.renderer.addPassHook) G.renderer.addPassHook(projectWorldUI, 'beforeScene');
    G.events.on('money:change', () => {
      refreshTimer = 0;
    });
    G.events.on('wanted:change', () => {
      refreshTimer = 0;
    });
    G.events.on('time:hour', () => {
      refreshTimer = 0;
    });
    G.events.on('game:pause', (e) => {
      // basic pause screen until the menus module provides its own
      if (!G.menus) showBasicPause(e.paused);
    });
  },

  update(dt) {
    if (!nodes) return;
    const rdt = G.time.realDt || dt;
    const now = G.time.now;

    // buttons handled by the basic UI until dedicated modules exist
    const input = G.input;
    if (input.btn('pause').pressed && !G.menus) {
      if (ui.panelOpen) ui.closePanel();
      else G.setPaused(!G.time.paused);
    }
    if (input.btn('phone').pressed && !G.phone && !G.time.paused) {
      if (ui.panelOpen === 'phone') ui.closePanel();
      else if (!ui.panelOpen) ui.openPanel('phone');
    }

    for (let i = toasts.length - 1; i >= 0; i--) {
      if (now >= toasts[i].expire) {
        toasts[i].node.remove();
        toasts.splice(i, 1);
      }
    }
    if (bannerExpire > 0 && now >= bannerExpire) {
      bannerExpire = 0;
      nodes.banner.style.display = 'none';
    }

    refreshTimer -= rdt;
    if (refreshTimer <= 0) {
      refreshTimer = 0.125;
      refreshHud();
    }
    minimapTimer -= rdt;
    if (minimapTimer <= 0 && this.visible) {
      minimapTimer = 0.1;
      drawMinimap();
    }
  },
});

// §18: G.ui.hud.setVisible(b)
ui.hud = hud;

export default hud;
