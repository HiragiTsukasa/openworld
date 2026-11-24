// MUGEN CITY — boot sequence.
//
// loading screen → environment checks → await Rapier (WASM) → import manifest (all system
// modules self-register) → init systems in order with progress → save load → start →
// first-load job flush → ready → realtime loop (skipped in test mode: tests drive G.debug.advance).

import { G, reportError } from './core/game.js';
import { CONFIG } from './core/config.js';
import { mulberry32 } from './core/rng.js';
import './core/jobs.js';
import './core/save.js';
import './core/quality.js';
import './core/input.js';
import './core/entities.js';
import './core/debug.js';
import { loadRapier } from './physics/physics.js';

const STATUS = {
  renderer: '描画エンジンを準備中',
  physics: '物理エンジンを準備中',
  textures: 'テクスチャを生成中',
  materials: 'マテリアルを準備中',
  audio: 'サウンドを準備中',
  ui: '画面を準備中',
  sky: '空を描いています',
  world: '無限島を生成中',
  roads: '道路を敷いています',
  chunks: '街を読み込み中',
  terrain: '地形を生成中',
  buildings: 'ビルを建設中',
  vehicles: '車両を整備中',
  player: 'プレイヤーを準備中',
  npcs: '住民を呼んでいます',
  traffic: '交通を流しています',
};

const dom = {
  app: document.getElementById('app'),
  boot: document.getElementById('boot'),
  bar: document.getElementById('boot-bar'),
  status: document.getElementById('boot-status'),
  fatal: document.getElementById('fatal'),
  fatalTitle: document.getElementById('fatal-title'),
  fatalText: document.getElementById('fatal-text'),
  fatalDetail: document.getElementById('fatal-detail'),
  fatalReload: document.getElementById('fatal-reload'),
};

let shownProgress = 0;

function setProgress(fraction, text) {
  const f = Math.max(shownProgress, Math.min(1, fraction));
  shownProgress = f;
  if (dom.bar) dom.bar.style.transform = 'scaleX(' + f.toFixed(3) + ')';
  if (dom.status && text !== undefined) dom.status.textContent = text;
}

/** Yields to the browser so the loading screen can repaint (never uses rAF: hidden tabs). */
function breathe() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function fatal(title, text, err) {
  const detail = err ? (err.stack ? String(err.stack) : String(err.message || err)) : '';
  try {
    window.__bootError = title + (detail ? ': ' + detail : '');
  } catch (_) {
    /* ignore */
  }
  if (dom.boot) dom.boot.style.display = 'none';
  if (dom.fatal) {
    if (dom.fatalTitle) dom.fatalTitle.textContent = title;
    if (dom.fatalText) dom.fatalText.textContent = text;
    if (dom.fatalDetail) dom.fatalDetail.textContent = detail.split('\n').slice(0, 6).join('\n');
    dom.fatal.style.display = 'flex';
    if (dom.fatalReload) {
      dom.fatalReload.onclick = () => {
        try {
          window.location.reload();
        } catch (_) {
          /* sandboxed */
        }
      };
    }
  }
}

function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    const ext = gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
    return true;
  } catch (_) {
    return false;
  }
}

function ensureViewportMeta() {
  // the artifact (fragment) build has no <head> of its own
  try {
    const want = 'width=device-width,initial-scale=1,maximum-scale=1,minimum-scale=1,user-scalable=no,viewport-fit=cover';
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      document.head.appendChild(meta);
    }
    if (meta.content.indexOf('viewport-fit') < 0 || meta.content.indexOf('user-scalable') < 0) meta.content = want;
  } catch (_) {
    /* ignore */
  }
}

function watchOrientation() {
  const update = () => {
    let show = false;
    try {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const coarse = navigator.maxTouchPoints > 0 || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
      let deviceLandscape = w > h;
      const so = window.screen && window.screen.orientation;
      if (so && typeof so.type === 'string') deviceLandscape = so.type.indexOf('landscape') === 0;
      else if (typeof window.orientation === 'number') deviceLandscape = Math.abs(window.orientation) === 90;
      const shortSide = window.screen ? Math.min(window.screen.width, window.screen.height) : Math.min(w, h);
      // phones only: tablets / desktops play inside the centred portrait frame instead
      show = !!coarse && deviceLandscape && w > h && shortSide < 600;
    } catch (_) {
      show = false;
    }
    if (dom.app) dom.app.setAttribute('data-rotate', show ? '1' : '0');
    G.suspend('rotate', show);
  };
  update();
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  try {
    if (window.screen && window.screen.orientation && window.screen.orientation.addEventListener) {
      window.screen.orientation.addEventListener('change', update);
    }
  } catch (_) {
    /* ignore */
  }
}

async function firstLoad() {
  // let streaming / generation jobs queued by start() finish behind the loading screen
  const jobs = G.jobs;
  if (!jobs || jobs.pending === 0) return;
  const t0 = performance.now();
  const initial = jobs.pending;
  while (jobs.pending > 0 && performance.now() - t0 < 20000) {
    jobs.flush(40);
    setProgress(0.9 + 0.09 * (1 - jobs.pending / Math.max(1, initial)), 'ワールドを読み込み中');
    await breathe();
  }
}

async function boot() {
  ensureViewportMeta();
  watchOrientation();
  setProgress(0.02, '起動中');

  if (!hasWebGL2()) {
    fatal('このブラウザではプレイできません', 'WebGL2 が利用できません。最新のブラウザでお試しください。', null);
    return;
  }
  if (typeof WebAssembly !== 'object' || typeof WebAssembly.instantiate !== 'function') {
    fatal('このブラウザではプレイできません', 'WebAssembly が利用できないか、ブロックされています。', null);
    return;
  }

  if (G.flags.test) {
    // deterministic gameplay randomness in tests
    Math.random = mulberry32((CONFIG.WORLD_SEED ^ 0x5eed) >>> 0);
  }

  setProgress(0.05, '物理エンジンを起動中');
  await breathe();
  try {
    await loadRapier();
  } catch (err) {
    reportError(err, 'physics', 'wasm');
    fatal('このブラウザではプレイできません', 'WebAssembly の初期化に失敗しました(ブロックされている可能性があります)。', err);
    return;
  }

  setProgress(0.12, 'ゲームデータを読み込み中');
  await breathe();
  await import('./manifest.js');

  G.jobs.loading = true;
  try {
    await G.initSystems(async (fraction, name) => {
      setProgress(0.14 + fraction * 0.72, STATUS[name]);
      await breathe();
    });
  } catch (err) {
    fatal('起動に失敗しました', '描画または物理エンジンを初期化できませんでした。', err);
    return;
  }

  setProgress(0.88, 'セーブデータを確認中');
  await breathe();
  let loaded = false;
  try {
    loaded = G.save.load();
  } catch (err) {
    reportError(err, 'save', 'load');
  }
  G.newGame = !loaded;

  G.startSystems();
  setProgress(0.9, 'ワールドを読み込み中');
  await breathe();
  if (!G.flags.test) await firstLoad();
  G.jobs.loading = false;

  setProgress(1, '');
  G.finishBoot();
  // draw the first frame behind the loading screen, then reveal
  G.frame(0, true);
  if (dom.boot) {
    dom.boot.classList.add('done');
    setTimeout(() => {
      if (dom.boot) dom.boot.style.display = 'none';
    }, G.flags.test ? 0 : 650);
  }
  if (!G.flags.test || G.flags.live) G.run();
}

function begin() {
  boot().catch((err) => {
    reportError(err, 'core', 'boot');
    fatal('起動に失敗しました', '予期しないエラーが発生しました。', err);
  });
}

// Defer one task so the loading screen paints before the heavy work starts.
setTimeout(begin, 0);
