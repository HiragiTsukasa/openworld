// MUGEN CITY — shared helpers for tools/smoke.mjs and tools/shot.mjs.
//
// Headless Chromium (Playwright, preinstalled globally) with software WebGL: rendering is slow
// (1–5 fps), so nothing here waits for frames — the simulation is driven through
// G.debug.advance() / G.debug.settle() and screenshots are taken after an explicit render.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIST = path.join(ROOT, 'dist');
export const SHOTS = path.join(ROOT, 'shots');

/**
 * parseArgs(argv) → {flags: {name: value|true}, rest: [positional]}.
 * `--name value`, `--name=value` and bare `--flag` are supported.
 */
export function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[a.slice(2)] = argv[++i];
      else flags[a.slice(2)] = true;
    } else rest.push(a);
  }
  return { flags, rest };
}

/**
 * gameUrl({file='dev.html', params}) → file:// URL of a built page with query parameters.
 */
export function gameUrl({ file = 'dev.html', params = {} } = {}) {
  const p = path.isAbsolute(file) ? file : path.join(DIST, file);
  if (!fs.existsSync(p)) throw new Error('missing ' + p + ' — run `npm run build` first');
  const url = pathToFileURL(p);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== false) url.searchParams.set(k, String(v));
  }
  return url.href;
}

/**
 * openGame(opts) → {browser, context, page, problems, url, close()}.
 * opts: {file, params, width=390, height=844, touch=true, dpr=1, readyTimeout=180000, wait=true}
 * `problems` collects console errors and uncaught page errors: [{type, text, stack}].
 */
export async function openGame(opts = {}) {
  const width = Number(opts.width) || 390;
  const height = Number(opts.height) || 844;
  const touch = opts.touch !== false;
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: Number(opts.dpr) || 1,
    hasTouch: touch,
    isMobile: touch,
    locale: 'ja-JP',
  });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const loc = msg.location();
    problems.push({
      type: 'console.error',
      text: msg.text(),
      stack: loc && loc.url ? path.basename(loc.url.split('?')[0]) + ':' + loc.lineNumber + ':' + loc.columnNumber : '',
    });
  });
  page.on('pageerror', (err) => {
    problems.push({ type: 'pageerror', text: String(err && err.message ? err.message : err), stack: err && err.stack ? err.stack : '' });
  });
  page.on('crash', () => problems.push({ type: 'crash', text: 'page crashed', stack: '' }));
  const url = gameUrl({ file: opts.file, params: opts.params });
  const game = {
    browser,
    context,
    page,
    problems,
    url,
    async close() {
      await browser.close().catch(() => {});
    },
  };
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  if (opts.wait !== false) await waitReady(page, opts.readyTimeout || 180000);
  return game;
}

/**
 * waitReady(page, timeoutMs=180000) — resolves when `window.__game.ready` is true; rejects with
 * the boot error when the fatal screen was shown.
 */
export async function waitReady(page, timeoutMs = 180000) {
  const t0 = Date.now();
  for (;;) {
    const state = await page.evaluate(() => ({
      ready: !!(window.__game && window.__game.ready),
      bootError: window.__bootError || null,
    }));
    if (state.bootError) throw new Error('boot failed: ' + state.bootError);
    if (state.ready) return;
    if (Date.now() - t0 > timeoutMs) throw new Error('timeout: __game.ready not set after ' + Math.round(timeoutMs / 1000) + ' s');
    await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * makeHelpers(page, {shotDir}) → h, the helper object passed to smoke scenarios and shot scripts:
 *
 *   h.evalG(fnOrString, arg?)  run code in the page with G: a function `(G, arg) => value`
 *                              (serialized — no closures) or a JS string (expression or
 *                              statements, may be async / use `return`). Returns plain data.
 *   h.advance(sec, opts?)      G.debug.advance — simulate without the wall clock
 *   h.settle(maxMs?)           G.debug.settle — flush generation jobs; returns pending count
 *   h.assert(cond, msg)        throws when cond is falsy
 *   h.assertNear(a, b, eps, msg)
 *   h.shot(name)               render + screenshot → shots/<name>.png (or an absolute path)
 *   h.stats()                  G.debug.stats()
 *   h.errors()                 current G.debug.errors
 *   h.simulate(state)          G.input.simulate(state)
 *   h.reset()                  neutral state (no simulated input / debug camera / showcase /
 *                              panel, unpaused, time scale 1) — the smoke harness calls it
 *                              after every scenario
 *   h.wait(ms)                 real-time wait (avoid unless testing timers)
 *   h.expectProblem(regex)     declare that console errors / G.debug.errors matching `regex`
 *                              are provoked on purpose by this scenario (not failures)
 *   h.log(...args)
 */
export function makeHelpers(page, { shotDir = SHOTS } = {}) {
  const expected = [];
  const h = {
    page,
    expectProblem(pattern) {
      expected.push(pattern instanceof RegExp ? pattern : new RegExp(String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    },
    isExpected(problem) {
      const text = String(problem.text || problem.msg || '') + '\n' + String(problem.stack || '');
      return expected.some((re) => re.test(text));
    },
    /** internal (smoke harness): forget expected problems in the page and reset the list */
    async resetExpected() {
      if (expected.length === 0) return;
      const sources = expected.map((re) => [re.source, re.flags]);
      expected.length = 0;
      await h
        .evalG((G, list) => {
          const res = list.map((s) => new RegExp(s[0], s[1]));
          G.debug.clearErrors((e) => res.some((re) => re.test(e.msg + '\n' + e.stack)));
        }, sources)
        .catch(() => {});
    },
    async evalG(code, arg) {
      if (typeof code === 'function') {
        return page.evaluate(
          async ({ src, arg }) => {
            const fn = (0, eval)('(' + src + ')');
            return await fn(window.__game, arg);
          },
          { src: code.toString(), arg }
        );
      }
      return page.evaluate(
        async ({ src, arg }) => {
          const G = window.__game;
          const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
          let fn;
          try {
            fn = new AsyncFunction('G', 'arg', 'return (' + src + '\n);');
          } catch (_) {
            fn = new AsyncFunction('G', 'arg', src);
          }
          return await fn(G, arg);
        },
        { src: String(code), arg }
      );
    },
    advance(seconds, opts) {
      return h.evalG((G, a) => G.debug.advance(a.seconds, a.opts), { seconds, opts: opts || null });
    },
    settle(maxMs) {
      return h.evalG((G, ms) => G.debug.settle(ms || undefined), maxMs || 0);
    },
    assert(cond, msg) {
      if (!cond) throw new Error('assertion failed: ' + (msg || '(no message)'));
    },
    assertNear(a, b, eps, msg) {
      if (!(Math.abs(a - b) <= eps)) throw new Error('assertion failed: ' + (msg || 'values differ') + ' (' + a + ' vs ' + b + ', eps ' + eps + ')');
    },
    async shot(name) {
      let file = String(name);
      if (!path.isAbsolute(file)) file = path.join(shotDir, file);
      if (!/\.png$/i.test(file)) file += '.png';
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await h.evalG((G) => G.debug.render());
      await page.screenshot({ path: file });
      return file;
    },
    stats() {
      return h.evalG((G) => G.debug.stats());
    },
    errors() {
      return h.evalG((G) => G.debug.errors.map((e) => ({ msg: e.msg, stack: e.stack, system: e.system, t: e.t, count: e.count })));
    },
    simulate(state) {
      return h.evalG((G, s) => G.input.simulate(s), state || null);
    },
    /** back to a neutral state: no simulated input, no debug camera / showcase / panel, unpaused */
    reset() {
      return h.evalG((G) => {
        G.input.simulate(null);
        G.debug.camRelease();
        G.debug.showcase(null);
        if (G.ui && G.ui.panelOpen) G.ui.closePanel();
        if (G.time.paused) G.setPaused(false);
        G.time.scale = 1;
      });
    },
    wait(ms) {
      return new Promise((r) => setTimeout(r, ms));
    },
    log(...args) {
      console.log('   ', ...args);
    },
  };
  return h;
}

/** formatProblem(p) → printable multi-line string for a console error / page error / game error. */
export function formatProblem(p) {
  const head = '[' + (p.type || p.system || 'error') + '] ' + (p.text || p.msg || '');
  const stack = p.stack ? '\n' + String(p.stack).split('\n').slice(0, 12).map((l) => '      ' + l).join('\n') : '';
  return head + stack + (p.count > 1 ? '\n      (x' + p.count + ')' : '');
}

/** withTimeout(promise, ms, label) → rejects when the promise takes longer than ms. */
export function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout after ' + Math.round(ms / 1000) + ' s: ' + label)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
