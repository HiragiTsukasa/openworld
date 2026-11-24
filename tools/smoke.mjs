// MUGEN CITY — smoke test.
//
//   node tools/smoke.mjs [filter ...] [--q low] [--w 390 --h 844] [--release] [--timeout 180]
//
// Loads dist/dev.html?test=1&q=low in headless Chromium (portrait 390x844, touch emulation,
// software WebGL), waits for __game.ready, runs the base checks, then every scenario in
// tools/smoke.d/*.mjs (alphabetical; optional name filters). Exits 1 on any failed assertion,
// any entry in G.debug.errors, any console error or uncaught page error.
//
// Scenario module:  export default async (page, h) => { ... }      (h: see tools/lib.mjs)
//                   export const timeout = 300;                    // seconds, optional

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, DIST, parseArgs, openGame, waitReady, makeHelpers, formatProblem, withTimeout } from './lib.mjs';

const { flags, rest } = parseArgs(process.argv.slice(2));
const quality = typeof flags.q === 'string' ? flags.q : 'low';
const readyTimeout = Math.max(180, Number(flags.timeout) || 180) * 1000;
const SCENARIO_DIR = path.join(ROOT, 'tools', 'smoke.d');

function ms(t0) {
  return ((Date.now() - t0) / 1000).toFixed(1) + ' s';
}

async function baseChecks(page, h) {
  const boot = await h.evalG((G) => ({
    ready: G.ready,
    systems: G.systems.map((s) => s.name),
    quality: G.quality.level,
    test: G.flags.test,
    frame: G.time.frame,
    game: G.time.game,
    hour: G.time.hour,
  }));
  h.assert(boot.ready, 'game is ready');
  h.assert(boot.test, 'test mode flag is set');
  for (const name of ['jobs', 'quality', 'renderer', 'input', 'physics', 'entities', 'textures', 'materials', 'ui', 'hud', 'touch', 'save', 'debug']) {
    h.assert(boot.systems.includes(name), 'system "' + name + '" is registered');
  }
  h.log('systems: ' + boot.systems.join(' '));

  // advance works and does not depend on the wall clock
  const frames = await h.advance(0.5);
  const after = await h.evalG((G) => ({ frame: G.time.frame, game: G.time.game, tick: G.time.tick, hour: G.time.hour }));
  h.assert(frames === 30, 'advance(0.5) simulated 30 frames (got ' + frames + ')');
  h.assert(after.frame - boot.frame === 30, 'frame counter advanced by 30');
  h.assertNear(after.game - boot.game, 0.5, 1e-6, 'game time advanced by 0.5 s');
  h.assert(after.tick >= 29, 'fixed ticks ran (' + after.tick + ')');
  h.assert(after.hour > boot.hour, 'game clock advanced');

  // the renderer drew something
  const screen = await h.evalG((G) => G.debug.screenStats());
  const info = await h.evalG((G) => {
    const i = G.renderer.info();
    return { drawCalls: i.drawCalls, tris: i.tris, width: i.width, height: i.height, hdr: i.hdr };
  });
  h.log('screen: ' + JSON.stringify(screen) + '  render: ' + JSON.stringify(info));
  h.assert(info.drawCalls > 0 && info.tris > 0, 'scene produced draw calls');
  h.assert(screen.std > 3 && screen.distinct > 12, 'canvas is not blank (std ' + screen.std + ', ' + screen.distinct + ' colours)');
  await h.shot(path.join(DIST, 'smoke.png'));
}

async function main() {
  const t0 = Date.now();
  let game;
  const failures = [];
  try {
    game = await openGame({
      file: flags.release ? 'index.html' : 'dev.html',
      params: { test: 1, q: quality },
      width: flags.w,
      height: flags.h,
      readyTimeout,
    });
  } catch (err) {
    console.error('FAIL  could not start the game: ' + (err && err.stack ? err.stack : err));
    process.exit(1);
  }
  const { page, problems } = game;
  const h = makeHelpers(page);
  const baseViewport = { width: Number(flags.w) || 390, height: Number(flags.h) || 844 };
  console.log('ready in ' + ms(t0) + '  (' + game.url.replace(/^.*\/dist\//, 'dist/') + ')');

  const run = async (name, fn, timeoutSec) => {
    const t1 = Date.now();
    const errorsBefore = (await h.errors().catch(() => [])).length;
    const problemsBefore = problems.length;
    let error = null;
    try {
      await withTimeout(fn(), timeoutSec * 1000, name);
    } catch (err) {
      error = err;
    }
    // leave a neutral state for the next scenario (scenarios share one page)
    const resetOk = await h.reset().then(() => true, () => false);
    await page.setViewportSize(baseViewport).catch(() => {});
    // problems a scenario declared with h.expectProblem() are removed from every record
    const gameErrors = (await h.errors().catch(() => [])).slice(errorsBefore).filter((e) => !h.isExpected(e));
    const newProblems = problems.slice(problemsBefore).filter((p) => !h.isExpected(p));
    for (let i = problems.length - 1; i >= problemsBefore; i--) if (h.isExpected(problems[i])) problems.splice(i, 1);
    await h.resetExpected();
    const ok = !error && gameErrors.length === 0 && newProblems.length === 0;
    console.log((ok ? 'ok    ' : 'FAIL  ') + name + '  (' + ms(t1) + ')');
    if (!ok) {
      failures.push(name);
      if (error) console.log('   ' + (error.stack || error));
      for (const e of gameErrors) console.log('   ' + formatProblem({ type: 'G.debug.errors ' + e.system, text: e.msg, stack: e.stack, count: e.count }));
      for (const p of newProblems) console.log('   ' + formatProblem(p));
      try {
        const file = await withTimeout(h.shot(path.join(DIST, 'smoke-fail-' + name.replace(/[^\w.-]+/g, '_') + '.png')), 60000, 'screenshot');
        console.log('   screenshot: ' + file);
      } catch (_) {
        /* page may be gone */
      }
    }
    if (!resetOk || (error && /^timeout after/.test(String(error.message)))) {
      // a hung or broken page would poison every later scenario: start from a fresh one
      console.log('   reloading the game for the remaining scenarios');
      try {
        await page.reload({ waitUntil: 'load', timeout: 120000 });
        await waitReady(page, readyTimeout);
      } catch (err) {
        console.log('   reload failed: ' + (err && err.message ? err.message : err));
      }
    }
  };

  await run('base', () => baseChecks(page, h), 240);

  let files = [];
  if (fs.existsSync(SCENARIO_DIR)) files = fs.readdirSync(SCENARIO_DIR).filter((f) => f.endsWith('.mjs')).sort();
  if (rest.length) files = files.filter((f) => rest.some((r) => f.includes(r)));
  for (const file of files) {
    let mod;
    try {
      mod = await import(pathToFileURL(path.join(SCENARIO_DIR, file)).href);
    } catch (err) {
      failures.push(file);
      console.log('FAIL  ' + file + '\n   cannot import scenario: ' + (err.stack || err));
      continue;
    }
    if (typeof mod.default !== 'function') {
      failures.push(file);
      console.log('FAIL  ' + file + '\n   scenario must `export default async (page, h) => {}`');
      continue;
    }
    await run(file, () => mod.default(page, h), Number(mod.timeout) || 300);
  }

  // final sweep: anything recorded outside a scenario window
  const allErrors = await h.errors().catch(() => []);
  await game.close();

  console.log('');
  if (failures.length === 0 && allErrors.length === 0 && problems.length === 0) {
    console.log('SMOKE PASSED  ' + (files.length + 1) + ' checks in ' + ms(t0));
    process.exit(0);
  }
  console.log('SMOKE FAILED  (' + ms(t0) + ')');
  if (failures.length) console.log('  failed: ' + failures.join(', '));
  if (allErrors.length) {
    console.log('  G.debug.errors (' + allErrors.length + '):');
    for (const e of allErrors) console.log('   ' + formatProblem({ type: e.system, text: e.msg, stack: e.stack, count: e.count }));
  }
  if (problems.length) {
    console.log('  console errors / page errors (' + problems.length + '):');
    for (const p of problems) console.log('   ' + formatProblem(p));
  }
  process.exit(1);
}

main().catch((err) => {
  console.error('SMOKE CRASHED: ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
