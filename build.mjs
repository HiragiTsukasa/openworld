// MUGEN CITY — build script.
//
//   node build.mjs            → dist/index.html  (minified release, single self-contained file)
//                               dist/dev.html    (unminified, keepNames, readable stack traces)
//                               dist/artifact.html (fragment: <title> + <style> + markup + script,
//                                                   no doctype/html/head/body — for iframe hosts)
//
// Everything is inlined (classic <script>, no modules, no fetch) so the files work from file://.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const BUNDLE_MARK = '/*__BUNDLE__*/';

function kb(bytes) {
  return (bytes / 1024).toFixed(1).padStart(9) + ' kB';
}

async function bundle(dev) {
  const result = await build({
    entryPoints: [path.join(SRC, 'main.js')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    charset: 'utf8',
    legalComments: 'none',
    minify: !dev,
    keepNames: dev,
    treeShaking: true,
    define: { __DEV__: dev ? 'true' : 'false' },
    logLevel: 'warning',
  });
  let code = result.outputFiles[0].text;
  if (dev) code += '\n//# sourceURL=mugen-city.dev.js\n';
  return code;
}

/** Makes JS safe to place inside an inline <script> element. */
function escapeInlineScript(code) {
  const escaped = code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  // the replacements only touch string / regex / comment contexts; prove the result still parses
  new vm.Script(escaped, { filename: 'bundle.js' });
  return escaped;
}

function extract(template, re, what) {
  const m = re.exec(template);
  if (!m) throw new Error('src/index.html: cannot find ' + what);
  return m[1];
}

function fullPage(template, code) {
  if (!template.includes(BUNDLE_MARK)) throw new Error('src/index.html: missing ' + BUNDLE_MARK);
  // function replacer: `$` sequences in the bundle must not be interpreted
  return template.replace(BUNDLE_MARK, () => code);
}

function fragmentPage(template, code) {
  const title = extract(template, /<title>([\s\S]*?)<\/title>/i, '<title>');
  const style = extract(template, /<style>([\s\S]*?)<\/style>/i, '<style>');
  const body = extract(template, /<!--BODY-->([\s\S]*?)<!--\/BODY-->/, '<!--BODY--> markers').trim();
  const html = '<title>' + title + '</title>\n<style>' + style + '</style>\n' + body + '\n<script>' + code + '</script>\n';
  if (/<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i.test(html.slice(0, html.indexOf('<script>')))) {
    throw new Error('artifact fragment must not contain doctype/html/head/body tags');
  }
  return html;
}

async function main() {
  const t0 = Date.now();
  const template = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  fs.mkdirSync(DIST, { recursive: true });

  const [devCode, relCode] = await Promise.all([bundle(true), bundle(false)]);
  const dev = escapeInlineScript(devCode);
  const rel = escapeInlineScript(relCode);

  const outputs = [
    ['dev.html', fullPage(template, dev)],
    ['index.html', fullPage(template, rel)],
    ['artifact.html', fragmentPage(template, rel)],
  ];
  for (const [name, html] of outputs) {
    fs.writeFileSync(path.join(DIST, name), html);
    console.log('  dist/' + name.padEnd(14) + kb(Buffer.byteLength(html)));
  }
  console.log('build ok in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
