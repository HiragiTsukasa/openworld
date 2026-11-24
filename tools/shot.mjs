// MUGEN CITY — scripted screenshots for visual verification (ARCHITECTURE §19).
//
//   node tools/shot.mjs --out /abs/path.png [--w 390 --h 844] [--q high] [--pos x,z] [--time 18]
//        [--weather rain] [--seed N] [--eval "<js; has G; may be async>"] [--advance 2]
//        [--frames 3] [--script file.mjs] [--release] [--touch 0|1] [--dpr 1] [--settle 15000]
//
// Order: load (?test=1) → settle → --eval → advance → settle → render --frames frames →
// screenshot. Prints console errors, G.debug.errors and a stats JSON line; exits 1 when the
// page reported errors (the PNG is still written).
//
// --script modules `export default async (page, helpers) => {}` and take over after the first
// settle; use helpers.shot('/abs/a.png'), helpers.evalG(...), helpers.advance(...) for
// multi-shot sequences (see tools/lib.mjs for the helper list).

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, openGame, makeHelpers, formatProblem } from './lib.mjs';

const { flags } = parseArgs(process.argv.slice(2));

function usage(msg) {
  if (msg) console.error('shot: ' + msg);
  console.error(
    'usage: node tools/shot.mjs --out /abs/path.png [--w 390 --h 844] [--q high] [--pos x,z] [--time 18]\n' +
      '       [--weather rain] [--seed N] [--eval "<js>"] [--advance 2] [--frames 3] [--script file.mjs]'
  );
  process.exit(2);
}

if (flags.help) usage();
if (!flags.out && !flags.script) usage('--out (or --script) is required');

async function main() {
  const t0 = Date.now();
  const params = { test: 1, q: typeof flags.q === 'string' ? flags.q : 'high' };
  if (flags.pos) params.pos = flags.pos;
  if (flags.time !== undefined) params.time = flags.time;
  if (flags.weather) params.weather = flags.weather;
  if (flags.seed !== undefined) params.seed = flags.seed;
  if (flags.touch !== undefined) params.touch = flags.touch === '0' ? 0 : 1;
  if (flags.debug) params.debug = 1;

  const game = await openGame({
    file: flags.release ? 'index.html' : 'dev.html',
    params,
    width: flags.w,
    height: flags.h,
    dpr: flags.dpr,
    touch: flags.touch !== '0',
    readyTimeout: (Number(flags.timeout) || 240) * 1000,
  });
  const { page, problems } = game;
  const h = makeHelpers(page);
  const settleMs = Number(flags.settle) || 15000;
  let failed = false;

  try {
    await h.settle(settleMs);
    if (flags.script) {
      const mod = await import(pathToFileURL(path.resolve(String(flags.script))).href);
      if (typeof mod.default !== 'function') throw new Error('--script module must `export default async (page, helpers) => {}`');
      await mod.default(page, h);
    }
    if (typeof flags.eval === 'string') {
      const value = await h.evalG(flags.eval);
      if (value !== undefined && value !== null) console.log('eval → ' + JSON.stringify(value));
    }
    if (flags.out) {
      const advance = flags.advance !== undefined ? Number(flags.advance) : 0.5;
      if (advance > 0) await h.advance(advance, { render: false });
      await h.settle(settleMs);
      const frames = Math.max(1, Number(flags.frames) || 2);
      await h.evalG((G, n) => {
        for (let i = 0; i < n; i++) G.frame(1 / 60, true);
      }, frames);
      const file = await h.shot(path.resolve(String(flags.out)));
      console.log('saved ' + file);
    }
  } catch (err) {
    failed = true;
    console.error('shot failed: ' + (err && err.stack ? err.stack : err));
  }

  let gameErrors = [];
  let stats = null;
  try {
    gameErrors = await h.errors();
    stats = await h.stats();
  } catch (_) {
    /* page may be gone */
  }
  await game.close();

  for (const e of gameErrors) console.log(formatProblem({ type: 'G.debug.errors ' + e.system, text: e.msg, stack: e.stack, count: e.count }));
  for (const p of problems) console.log(formatProblem(p));
  if (stats) console.log('stats ' + JSON.stringify(stats));
  console.log('done in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s' + (gameErrors.length + problems.length ? '  (' + (gameErrors.length + problems.length) + ' error(s))' : ''));
  process.exit(failed || gameErrors.length || problems.length ? 1 : 0);
}

main().catch((err) => {
  console.error('shot crashed: ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
