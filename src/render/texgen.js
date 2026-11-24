// MUGEN CITY — procedural texture generators (used by render/textures.js).
//
// Pure canvas generators: every builder returns raw canvases
//   { map, normalMap?, roughnessMap?, emissiveMap?, alpha?, data?, clamp?, meta }
// for one texture key of ARCHITECTURE §7. Foundation quality: simple but tasteful placeholders
// (tileable noise + colour, overlays for relief, facades with emissive night windows, fictional
// Japanese signage). Each generator stays well below 30 ms. The `tex` module upgrades these
// while keeping the keys.

import { G } from '../core/game.js';
import { RNG, hash2, hashString, fbm2p, worley2p, valueNoise2p } from '../core/rng.js';

const FONT = '"Hiragino Sans","Noto Sans JP","Yu Gothic","IPAGothic",system-ui,sans-serif';

// ------------------------------------------------------------------------------------------------
// Low level helpers
// ------------------------------------------------------------------------------------------------

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function rgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function css(hex, a) {
  const c = rgb(hex);
  return a === undefined ? 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')' : 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
}

function qualitySize(base) {
  const k = G.quality ? G.quality.get('textureSize') || 1 : 1;
  return Math.max(64, Math.round(base * k));
}

/** Tileable fbm field in 0..1 (Float32Array size²). */
function noiseField(size, period, octaves, gain, seed) {
  const f = new Float32Array(size * size);
  const k = period / size;
  let i = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      f[i++] = fbm2p(x * k, y * k, period, octaves, gain, seed) * 0.5 + 0.5;
    }
  }
  return f;
}

/** Tileable worley field in 0..1. */
function worleyField(size, period, seed) {
  const f = new Float32Array(size * size);
  const k = period / size;
  let i = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) f[i++] = worley2p(x * k, y * k, period, seed);
  }
  return f;
}

/** Paints a field into a canvas as a 2- or 3-stop gradient with per-texel grain. */
function paintField(size, field, c0, c1, grain, seed, contrast, cMid) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const a = rgb(c0);
  const b = rgb(c1);
  const m = cMid !== undefined ? rgb(cMid) : null;
  const con = contrast || 1;
  for (let i = 0, p = 0; i < field.length; i++, p += 4) {
    let t = (field[i] - 0.5) * con + 0.5;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const g = grain > 0 ? ((hash2(i, seed, 77) & 255) / 255 - 0.5) * grain * 255 : 0;
    let r, gg, bb;
    if (m) {
      if (t < 0.5) {
        const u = t * 2;
        r = a[0] + (m[0] - a[0]) * u; gg = a[1] + (m[1] - a[1]) * u; bb = a[2] + (m[2] - a[2]) * u;
      } else {
        const u = t * 2 - 1;
        r = m[0] + (b[0] - m[0]) * u; gg = m[1] + (b[1] - m[1]) * u; bb = m[2] + (b[2] - m[2]) * u;
      }
    } else {
      r = a[0] + (b[0] - a[0]) * t; gg = a[1] + (b[1] - a[1]) * t; bb = a[2] + (b[2] - a[2]) * t;
    }
    d[p] = r + g;
    d[p + 1] = gg + g;
    d[p + 2] = bb + g;
    d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Grayscale canvas from a field (height map the overlays can draw on). */
function heightCanvas(size, field, lo, hi) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0, p = 0; i < field.length; i++, p += 4) {
    const v = (lo + (hi - lo) * field[i]) * 255;
    d[p] = d[p + 1] = d[p + 2] = v;
    d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function readLuma(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const f = new Float32Array(w * h);
  for (let i = 0, p = 0; i < f.length; i++, p += 4) f[i] = d[p] / 255;
  return f;
}

/** Tangent-space normal map from a tileable height field. */
function normalCanvas(field, w, h, strength) {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const s = strength * 4;
  for (let y = 0; y < h; y++) {
    const y0 = ((y - 1 + h) % h) * w;
    const y1 = ((y + 1) % h) * w;
    const yc = y * w;
    for (let x = 0; x < w; x++) {
      const x0 = (x - 1 + w) % w;
      const x1 = (x + 1) % w;
      const dx = (field[yc + x1] - field[yc + x0]) * s;
      const dy = (field[y1 + x] - field[y0 + x]) * s;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const p = (yc + x) * 4;
      d[p] = (-dx * inv * 0.5 + 0.5) * 255;
      d[p + 1] = (dy * inv * 0.5 + 0.5) * 255;
      d[p + 2] = (inv * 0.5 + 0.5) * 255;
      d[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Roughness map (green channel is what three.js reads) from a field. */
function roughCanvas(field, w, h, lo, hi, seed) {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let i = 0, p = 0; i < field.length; i++, p += 4) {
    const g = ((hash2(i, seed, 91) & 255) / 255 - 0.5) * 0.06;
    let v = lo + (hi - lo) * (1 - field[i]) + g;
    v = v < 0.02 ? 0.02 : v > 1 ? 1 : v;
    d[p] = d[p + 1] = d[p + 2] = v * 255;
    d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function flatCanvas(w, h, fill) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, w, h);
  return c;
}

function fitText(ctx, text, maxW, px, weight) {
  let size = px;
  ctx.font = (weight || '700') + ' ' + size + 'px ' + FONT;
  const w = ctx.measureText(text).width;
  if (w > maxW && w > 0) {
    size = Math.max(6, Math.floor((size * maxW) / w));
    ctx.font = (weight || '700') + ' ' + size + 'px ' + FONT;
  }
  return size;
}

// ------------------------------------------------------------------------------------------------
// Fictional Japanese names
// ------------------------------------------------------------------------------------------------

const NAME_HEAD = [
  'ミナト', 'ホシゾラ', 'カゼマチ', 'ツキミ', 'ヒカリ', 'アオバ', 'コトブキ', 'ムゲン', 'クロガネ', 'シラユキ',
  'タチバナ', 'ナナホシ', 'ハヤテ', 'ミヤビ', 'ユメジ', 'リュウセイ', 'ワカバ', 'しののめ', 'あかつき', 'こもれび',
  'うみねこ', 'ほたる', 'はなまる', 'まんげつ', '虹ノ橋', '七福', '八雲', '千歳', '大黒', '若葉',
];
const NAME_TAIL = {
  shop: ['商店', 'ストア', 'マート', '堂', '屋', '百貨', '市場'],
  food: ['食堂', 'ラーメン', '寿司', 'カレー', '喫茶', '酒場', '弁当', '焼肉', 'そば', '餃子', 'うどん'],
  bar: ['酒場', 'バー', '横丁', 'スナック', '居酒屋'],
  tech: ['電機', 'デンキ', 'テック', 'モバイル', '無線'],
  service: ['薬局', '理容', '銀行', '不動産', '自動車', '旅館', 'ホテル', '温泉', '書店', '交通'],
  fun: ['ゲーム', 'カラオケ', 'シネマ', 'ボウル', 'ホール'],
};
const NAME_KINDS = Object.keys(NAME_TAIL);
const SLOGANS = [
  '毎日が新発見', '夢は無限大', '走れ、どこまでも', '今夜も営業中', '島いちばんの味', '未来へ一直線',
  '安心と信頼', 'あなたの街の', '大特価セール', 'まごころ込めて', '海と山と', '旅に出よう',
];

/**
 * Deterministic fictional shop name, e.g. "ミナト食堂".
 * @param {RNG} rng
 * @param {string} [kind] 'shop'|'food'|'bar'|'tech'|'service'|'fun'
 * @returns {string}
 */
function shopName(rng, kind) {
  const k = NAME_TAIL[kind] ? kind : rng.pick(NAME_KINDS);
  return rng.pick(NAME_HEAD) + rng.pick(NAME_TAIL[k]);
}

// ------------------------------------------------------------------------------------------------
// Overlays (draw on the colour canvas `c` and, where relief matters, the height canvas `h`)
// ------------------------------------------------------------------------------------------------

function lines(ctx, size, n, vertical, style, width, jitter, rng) {
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const p = ((i + 0.5) / n) * size + (jitter && rng ? rng.range(-jitter, jitter) : 0);
    if (vertical) {
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
    } else {
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
    }
  }
  ctx.stroke();
}

function cracks(ctx, size, n, style, rng) {
  ctx.strokeStyle = style;
  ctx.lineWidth = Math.max(1, size / 256);
  for (let i = 0; i < n; i++) {
    let x = rng.range(size);
    let y = rng.range(size);
    let a = rng.range(Math.PI * 2);
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = rng.irange(6, 16);
    for (let s = 0; s < steps; s++) {
      a += rng.range(-0.7, 0.7);
      x += Math.cos(a) * size * 0.03;
      y += Math.sin(a) * size * 0.03;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function speckle(ctx, size, n, style, rMin, rMax, rng) {
  ctx.fillStyle = style;
  for (let i = 0; i < n; i++) {
    const r = rng.range(rMin, rMax);
    ctx.beginPath();
    ctx.arc(rng.range(size), rng.range(size), r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function brickPattern(c, h, size, rows, cols, mortar, mortarH, rng, tint) {
  const bh = size / rows;
  const bw = size / cols;
  const cc = c.getContext('2d');
  const hc = h.getContext('2d');
  const gap = Math.max(1, size / 128);
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? bw / 2 : 0;
    for (let i = -1; i < cols; i++) {
      const x = i * bw + off;
      const y = r * bh;
      if (tint) {
        cc.fillStyle = 'rgba(' + (rng.chance() ? '0,0,0' : '255,255,255') + ',' + rng.range(0, tint) + ')';
        cc.fillRect(x + gap, y + gap, bw - gap * 2, bh - gap * 2);
      }
      cc.strokeStyle = mortar;
      cc.lineWidth = gap * 2;
      cc.strokeRect(x, y, bw, bh);
      hc.strokeStyle = mortarH;
      hc.lineWidth = gap * 2;
      hc.strokeRect(x, y, bw, bh);
    }
  }
}

// ------------------------------------------------------------------------------------------------
// Surface recipes: key → [c0, c1, period, octaves, grain, bump, roughLo, roughHi, overlay]
// ------------------------------------------------------------------------------------------------

const SURFACES = {
  // ground
  asphalt: [0x2a2b2e, 0x3b3c40, 8, 4, 0.1, 0.5, 0.82, 0.96, 'asphalt'],
  asphalt_worn: [0x38393b, 0x55565a, 4, 4, 0.1, 0.7, 0.8, 0.98, 'worn'],
  concrete: [0x8a8983, 0xa5a49d, 4, 4, 0.05, 0.4, 0.7, 0.92, 'joints'],
  sidewalk: [0x96948c, 0xb2b0a8, 4, 3, 0.05, 0.5, 0.72, 0.9, 'pavers'],
  curb: [0xa5a39c, 0xc0beb6, 4, 3, 0.05, 0.3, 0.7, 0.88, null],
  crosswalk: [0x2c2d30, 0x3a3b3f, 8, 3, 0.08, 0.3, 0.75, 0.92, 'zebra'],
  grass: [0x3a6426, 0x5f8f3a, 6, 4, 0.12, 0.9, 0.85, 1.0, 'blades'],
  grass_dry: [0x7f7d3e, 0xab9f5a, 6, 4, 0.12, 0.9, 0.88, 1.0, 'blades'],
  dirt: [0x594532, 0x7d654c, 5, 4, 0.08, 0.8, 0.85, 1.0, 'pebbles'],
  mud: [0x3a2c20, 0x57432f, 4, 4, 0.04, 0.9, 0.3, 0.7, null],
  sand: [0xc9b385, 0xe2d2a8, 5, 3, 0.05, 0.4, 0.88, 1.0, 'ripples'],
  rock: [0x66635f, 0x8e8a84, 4, 5, 0.06, 1.3, 0.78, 0.98, 'cracks'],
  cliff: [0x5a534c, 0x8a7f73, 3, 5, 0.06, 1.5, 0.8, 0.98, 'strata'],
  snow: [0xe2eaf3, 0xfbfdff, 4, 3, 0.02, 0.35, 0.45, 0.8, null],
  gravel: [0x74726e, 0xa5a19b, 16, 2, 0.1, 1.2, 0.85, 1.0, 'gravel'],
  farmland: [0x57432e, 0x735d3f, 4, 3, 0.07, 1.0, 0.88, 1.0, 'furrows'],
  forest_floor: [0x3a3222, 0x5b4d31, 6, 4, 0.1, 0.9, 0.88, 1.0, 'litter'],
  // build
  roof_flat: [0x6b6b6d, 0x88888a, 8, 3, 0.1, 0.5, 0.82, 0.96, 'joints'],
  roof_tile: [0x33414f, 0x4b5c6c, 4, 3, 0.04, 1.2, 0.4, 0.7, 'kawara'],
  roof_metal: [0x47625a, 0x5d7c72, 4, 2, 0.03, 0.9, 0.35, 0.6, 'seams'],
  brick: [0x8d4a38, 0xa9604a, 6, 3, 0.07, 1.0, 0.8, 0.95, 'brick'],
  plaster: [0xd8d2c4, 0xece7db, 4, 4, 0.03, 0.3, 0.82, 0.96, null],
  wood: [0x9a7448, 0xb98f5e, 3, 4, 0.04, 0.7, 0.6, 0.85, 'planks'],
  wood_dark: [0x3d2a1c, 0x5a402b, 3, 4, 0.04, 0.7, 0.55, 0.82, 'planks'],
  metal: [0x8d9197, 0xa9adb3, 3, 3, 0.03, 0.2, 0.28, 0.5, 'brushed'],
  metal_rust: [0x6d3b1e, 0x9a643a, 5, 5, 0.08, 0.8, 0.7, 0.98, 'rust'],
  metal_painted: [0xdadada, 0xf2f2f2, 4, 3, 0.02, 0.2, 0.38, 0.6, 'chips'],
  glass: [0x9fc4d8, 0xb9d8e6, 2, 2, 0.0, 0.05, 0.03, 0.1, null],
  corrugated: [0x8f969b, 0xa9b0b5, 4, 2, 0.03, 1.4, 0.4, 0.65, 'corrugated'],
  tiles: [0xd9dfe2, 0xf1f4f5, 4, 2, 0.02, 0.8, 0.15, 0.4, 'tiles'],
  shoji: [0xeee8d6, 0xf8f4e8, 4, 3, 0.02, 0.6, 0.75, 0.92, 'shoji'],
  container: [0xd8d8d8, 0xeeeeee, 4, 2, 0.03, 1.4, 0.45, 0.7, 'container'],
  // props
  bark: [0x4a3828, 0x6e5540, 4, 4, 0.06, 1.5, 0.85, 1.0, 'bark'],
  hedge: [0x244a1c, 0x3f7430, 12, 3, 0.16, 1.2, 0.8, 1.0, 'leafy'],
  fabric: [0xc8c8c8, 0xe6e6e6, 4, 2, 0.03, 0.6, 0.85, 1.0, 'weave'],
  rubber: [0x161616, 0x232323, 6, 3, 0.05, 0.5, 0.8, 0.95, null],
  plastic: [0xd4d4d4, 0xe8e8e8, 3, 2, 0.01, 0.1, 0.35, 0.5, null],
  chrome: [0xd8dde2, 0xf2f5f8, 2, 2, 0.0, 0.03, 0.04, 0.12, null],
  car_paint: [0xf0f0f0, 0xffffff, 2, 2, 0.0, 0.0, 0.22, 0.34, 'flakes'],
};

function buildSurface(key, def) {
  const seed = hashString(key);
  const rng = new RNG(seed);
  const size = qualitySize(256);
  const [c0, c1, period, octaves, grain, bump, rLo, rHi, overlay] = def;
  let field;
  if (overlay === 'gravel') field = worleyField(size, period, seed);
  else field = noiseField(size, period, octaves, 0.5, seed);
  const c = paintField(size, field, c0, c1, grain, seed, 1.25);
  const h = heightCanvas(size, field, 0.25, 0.75);
  const cc = c.getContext('2d');
  const hc = h.getContext('2d');
  const u = size / 256;
  let customNormal = null;

  switch (overlay) {
    case 'asphalt':
      speckle(cc, size, 500, 'rgba(255,255,255,0.07)', 0.4 * u, 1.1 * u, rng);
      speckle(cc, size, 300, 'rgba(0,0,0,0.18)', 0.4 * u, 1.3 * u, rng);
      break;
    case 'worn':
      speckle(cc, size, 400, 'rgba(255,255,255,0.08)', 0.4 * u, 1.2 * u, rng);
      cracks(cc, size, 7, 'rgba(10,10,12,0.55)', rng);
      cracks(hc, size, 7, 'rgba(0,0,0,0.8)', new RNG(seed));
      break;
    case 'cracks':
      cracks(cc, size, 10, 'rgba(20,18,16,0.5)', rng);
      cracks(hc, size, 10, 'rgba(0,0,0,0.9)', new RNG(seed));
      break;
    case 'joints':
      cc.strokeStyle = 'rgba(40,40,40,0.35)';
      cc.lineWidth = 2 * u;
      cc.strokeRect(0, 0, size, size);
      hc.strokeStyle = 'rgba(0,0,0,0.7)';
      hc.lineWidth = 2 * u;
      hc.strokeRect(0, 0, size, size);
      break;
    case 'pavers':
      lines(cc, size, 4, true, 'rgba(50,50,48,0.4)', 1.5 * u);
      lines(cc, size, 4, false, 'rgba(50,50,48,0.4)', 1.5 * u);
      lines(hc, size, 4, true, 'rgba(0,0,0,0.75)', 2 * u);
      lines(hc, size, 4, false, 'rgba(0,0,0,0.75)', 2 * u);
      break;
    case 'zebra':
      cc.fillStyle = 'rgba(232,232,226,0.93)';
      for (let i = 0; i < 4; i++) cc.fillRect((i / 4) * size + size * 0.03, 0, size * 0.13, size);
      hc.fillStyle = 'rgba(255,255,255,0.25)';
      for (let i = 0; i < 4; i++) hc.fillRect((i / 4) * size + size * 0.03, 0, size * 0.13, size);
      break;
    case 'blades':
      cc.lineWidth = Math.max(1, u);
      for (let i = 0; i < 900; i++) {
        const x = rng.range(size);
        const y = rng.range(size);
        cc.strokeStyle = rng.chance(0.5) ? 'rgba(255,255,190,0.10)' : 'rgba(0,25,0,0.16)';
        cc.beginPath();
        cc.moveTo(x, y);
        cc.lineTo(x + rng.range(-2, 2) * u, y - rng.range(2, 6) * u);
        cc.stroke();
      }
      break;
    case 'pebbles':
      speckle(cc, size, 160, 'rgba(160,150,135,0.35)', 0.6 * u, 2.2 * u, rng);
      speckle(cc, size, 160, 'rgba(30,22,14,0.3)', 0.6 * u, 2 * u, rng);
      break;
    case 'litter':
      speckle(cc, size, 220, 'rgba(140,95,40,0.4)', 0.8 * u, 2.4 * u, rng);
      speckle(cc, size, 160, 'rgba(60,80,30,0.4)', 0.8 * u, 2.2 * u, rng);
      break;
    case 'ripples':
      for (let i = 0; i < 10; i++) {
        const y = ((i + 0.5) / 10) * size;
        for (const [ctx, style] of [[cc, 'rgba(120,95,50,0.14)'], [hc, 'rgba(0,0,0,0.35)']]) {
          ctx.strokeStyle = style;
          ctx.lineWidth = 3 * u;
          ctx.beginPath();
          for (let x = 0; x <= size; x += 4) {
            const yy = y + Math.sin((x / size) * Math.PI * 4 + i) * 3 * u;
            if (x === 0) ctx.moveTo(x, yy);
            else ctx.lineTo(x, yy);
          }
          ctx.stroke();
        }
      }
      break;
    case 'strata':
      for (let i = 0; i < 14; i++) {
        const y = rng.range(size);
        const hgt = rng.range(2, 9) * u;
        cc.fillStyle = rng.chance() ? 'rgba(0,0,0,0.14)' : 'rgba(255,240,220,0.10)';
        cc.fillRect(0, y, size, hgt);
        hc.fillStyle = rng.chance() ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.2)';
        hc.fillRect(0, y, size, hgt);
      }
      break;
    case 'furrows':
      lines(cc, size, 8, true, 'rgba(25,15,5,0.35)', 7 * u);
      lines(hc, size, 8, true, 'rgba(0,0,0,0.6)', 9 * u);
      break;
    case 'kawara': {
      const rows = 8;
      const cols = 8;
      for (let r = 0; r < rows; r++) {
        for (let i = 0; i < cols; i++) {
          const x = (i / cols) * size;
          const y = (r / rows) * size;
          const w = size / cols;
          const hh = size / rows;
          const g1 = cc.createLinearGradient(x, 0, x + w, 0);
          g1.addColorStop(0, 'rgba(0,0,0,0.3)');
          g1.addColorStop(0.5, 'rgba(255,255,255,0.14)');
          g1.addColorStop(1, 'rgba(0,0,0,0.3)');
          cc.fillStyle = g1;
          cc.fillRect(x, y, w, hh);
          const g2 = hc.createLinearGradient(x, 0, x + w, 0);
          g2.addColorStop(0, 'rgba(0,0,0,0.75)');
          g2.addColorStop(0.5, 'rgba(255,255,255,0.75)');
          g2.addColorStop(1, 'rgba(0,0,0,0.75)');
          hc.fillStyle = g2;
          hc.fillRect(x, y, w, hh);
          cc.fillStyle = 'rgba(0,0,0,0.35)';
          cc.fillRect(x, y + hh - 2 * u, w, 2 * u);
          hc.fillStyle = 'rgba(0,0,0,0.8)';
          hc.fillRect(x, y + hh - 2 * u, w, 2 * u);
        }
      }
      break;
    }
    case 'seams':
      lines(cc, size, 6, true, 'rgba(255,255,255,0.22)', 3 * u);
      lines(hc, size, 6, true, 'rgba(255,255,255,0.9)', 4 * u);
      break;
    case 'brick':
      brickPattern(c, h, size, 12, 6, 'rgba(190,180,165,0.85)', 'rgba(0,0,0,0.85)', rng, 0.16);
      break;
    case 'planks':
      for (let i = 0; i < 40; i++) {
        cc.strokeStyle = 'rgba(40,22,8,' + rng.range(0.05, 0.16) + ')';
        cc.lineWidth = rng.range(0.5, 1.6) * u;
        const x = rng.range(size);
        cc.beginPath();
        cc.moveTo(x, 0);
        cc.bezierCurveTo(x + rng.range(-4, 4) * u, size * 0.33, x + rng.range(-4, 4) * u, size * 0.66, x, size);
        cc.stroke();
      }
      lines(cc, size, 4, true, 'rgba(20,10,4,0.6)', 2 * u);
      lines(hc, size, 4, true, 'rgba(0,0,0,0.9)', 2.5 * u);
      break;
    case 'brushed':
      for (let i = 0; i < 300; i++) {
        cc.strokeStyle = 'rgba(255,255,255,' + rng.range(0.02, 0.07) + ')';
        cc.lineWidth = u;
        const y = rng.range(size);
        cc.beginPath();
        cc.moveTo(0, y);
        cc.lineTo(size, y);
        cc.stroke();
      }
      break;
    case 'rust':
      for (let i = 0; i < 26; i++) {
        const x = rng.range(size);
        const y = rng.range(size);
        const r = rng.range(6, 26) * u;
        const gr = cc.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(60,24,8,0.5)');
        gr.addColorStop(1, 'rgba(60,24,8,0)');
        cc.fillStyle = gr;
        cc.fillRect(x - r, y - r, r * 2, r * 2);
      }
      break;
    case 'chips':
      speckle(cc, size, 30, 'rgba(90,90,90,0.25)', 0.6 * u, 2.5 * u, rng);
      break;
    case 'corrugated':
    case 'container': {
      const n = overlay === 'container' ? 16 : 24;
      const w = size / n;
      for (let i = 0; i < n; i++) {
        const x = i * w;
        const g1 = cc.createLinearGradient(x, 0, x + w, 0);
        g1.addColorStop(0, 'rgba(0,0,0,0.22)');
        g1.addColorStop(0.5, 'rgba(255,255,255,0.16)');
        g1.addColorStop(1, 'rgba(0,0,0,0.22)');
        cc.fillStyle = g1;
        cc.fillRect(x, 0, w, size);
        const g2 = hc.createLinearGradient(x, 0, x + w, 0);
        g2.addColorStop(0, 'rgba(0,0,0,0.85)');
        g2.addColorStop(0.5, 'rgba(255,255,255,0.85)');
        g2.addColorStop(1, 'rgba(0,0,0,0.85)');
        hc.fillStyle = g2;
        hc.fillRect(x, 0, w, size);
      }
      break;
    }
    case 'tiles':
      lines(cc, size, 8, true, 'rgba(120,130,135,0.7)', 2 * u);
      lines(cc, size, 8, false, 'rgba(120,130,135,0.7)', 2 * u);
      lines(hc, size, 8, true, 'rgba(0,0,0,0.9)', 2.5 * u);
      lines(hc, size, 8, false, 'rgba(0,0,0,0.9)', 2.5 * u);
      break;
    case 'shoji':
      lines(cc, size, 4, true, 'rgba(70,45,25,0.95)', 5 * u);
      lines(cc, size, 6, false, 'rgba(70,45,25,0.95)', 4 * u);
      lines(hc, size, 4, true, 'rgba(255,255,255,0.95)', 5 * u);
      lines(hc, size, 6, false, 'rgba(255,255,255,0.95)', 4 * u);
      break;
    case 'bark':
      for (let i = 0; i < 70; i++) {
        const x = rng.range(size);
        const w = rng.range(1, 3.5) * u;
        cc.fillStyle = 'rgba(20,12,6,' + rng.range(0.15, 0.4) + ')';
        hc.fillStyle = 'rgba(0,0,0,' + rng.range(0.3, 0.7) + ')';
        const y = rng.range(size);
        const len = rng.range(size * 0.2, size * 0.7);
        cc.fillRect(x, y, w, len);
        cc.fillRect(x, y - size, w, len);
        hc.fillRect(x, y, w, len);
        hc.fillRect(x, y - size, w, len);
      }
      break;
    case 'leafy':
      speckle(cc, size, 500, 'rgba(120,190,70,0.28)', 1.5 * u, 4 * u, rng);
      speckle(cc, size, 400, 'rgba(8,30,8,0.4)', 1.5 * u, 4 * u, rng);
      break;
    case 'weave':
      lines(cc, size, 32, true, 'rgba(0,0,0,0.08)', u);
      lines(cc, size, 32, false, 'rgba(0,0,0,0.08)', u);
      lines(hc, size, 32, true, 'rgba(0,0,0,0.3)', u);
      lines(hc, size, 32, false, 'rgba(0,0,0,0.3)', u);
      break;
    case 'flakes': {
      // metallic flake normal: tiny random per-texel tilts
      const n = makeCanvas(size, size);
      const nctx = n.getContext('2d');
      const img = nctx.createImageData(size, size);
      const d = img.data;
      for (let i = 0, p = 0; i < size * size; i++, p += 4) {
        const hh = hash2(i, seed, 5);
        d[p] = 128 + ((hh & 255) - 128) * 0.1;
        d[p + 1] = 128 + (((hh >> 8) & 255) - 128) * 0.1;
        d[p + 2] = 250;
        d[p + 3] = 255;
      }
      nctx.putImageData(img, 0, 0);
      customNormal = n;
      break;
    }
    default:
      break;
  }

  const hf = readLuma(h);
  return {
    map: c,
    normalMap: customNormal || normalCanvas(hf, size, size, bump),
    roughnessMap: roughCanvas(hf, size, size, rLo, rHi, seed),
    emissiveMap: null,
    meta: { tile: 1 },
  };
}

// ------------------------------------------------------------------------------------------------
// Facades (tiling sets with emissive night-window maps)
// ------------------------------------------------------------------------------------------------

const FACADE_STYLES = {
  office: { walls: [0x9aa0a6, 0xb9b3a7, 0x7d858c, 0xc9c5bb], glass: 0x2b4254, cols: 4, rows: 4, ww: 0.74, wh: 0.56, lit: 0.42, bay: 3.0, floor: 3.4 },
  glass: { walls: [0x35566b, 0x2d5a5a, 0x5b5348], glass: 0x3f7896, cols: 4, rows: 4, ww: 0.94, wh: 0.9, lit: 0.36, bay: 2.6, floor: 3.6, curtain: true },
  apartment: { walls: [0xcfc7b8, 0xb9c2c6, 0xd9cfc0, 0xa9a39a], glass: 0x33424d, cols: 4, rows: 4, ww: 0.5, wh: 0.5, lit: 0.5, bay: 3.2, floor: 2.9, balcony: true },
  house: { walls: [0xe6dfd0, 0xd8c8ac, 0xc9d0cc, 0xb8a58a], glass: 0x39464f, cols: 2, rows: 2, ww: 0.42, wh: 0.4, lit: 0.55, bay: 3.6, floor: 2.8 },
  shop: { walls: [0xd9d2c4, 0xbfb6a6, 0xe3dccf, 0xa8a196], glass: 0x2e3f4a, cols: 2, rows: 2, ww: 0.8, wh: 0.62, lit: 0.7, bay: 4.0, floor: 3.4, awning: true },
  industrial: { walls: [0x8b8f8c, 0x9c948a, 0x74808a], glass: 0x30404a, cols: 4, rows: 2, ww: 0.36, wh: 0.26, lit: 0.25, bay: 5.0, floor: 5.0, ribs: true },
  old: { walls: [0x6b5138, 0x86705a], glass: 0xcfc6ac, cols: 3, rows: 2, ww: 0.6, wh: 0.5, lit: 0.6, bay: 2.7, floor: 2.9, lattice: true },
};
const AWNINGS = [0xb5352f, 0x2f6fb5, 0x2f8f58, 0xd08a1c];
const LIT_COLORS = ['#ffd69a', '#ffe9c4', '#fff4dc', '#cfe4ff', '#ffc978'];

function buildFacade(key, kind, variant) {
  const st = FACADE_STYLES[kind];
  const seed = hashString(key);
  const rng = new RNG(seed);
  const size = qualitySize(256);
  const wall = st.walls[(variant - 1) % st.walls.length];
  const field = noiseField(size, 4, 3, 0.5, seed);
  const wr = rgb(wall);
  const dark = ((wr[0] * 0.86) << 16) | ((wr[1] * 0.86) << 8) | (wr[2] * 0.86);
  const c = paintField(size, field, dark, wall, 0.035, seed, 1.0);
  const h = flatCanvas(size, size, 'rgb(150,150,150)');
  const r = flatCanvas(size, size, 'rgb(215,215,215)');
  const e = flatCanvas(size, size, '#000');
  const cc = c.getContext('2d');
  const hc = h.getContext('2d');
  const rc = r.getContext('2d');
  const ec = e.getContext('2d');
  const cw = size / st.cols;
  const ch = size / st.rows;
  const u = size / 256;

  if (st.ribs) {
    lines(cc, size, 24, true, 'rgba(0,0,0,0.10)', 2 * u);
    lines(hc, size, 24, true, 'rgba(0,0,0,0.5)', 3 * u);
  }
  if (st.lattice) {
    lines(cc, size, 12, true, 'rgba(30,18,8,0.35)', 2 * u);
    lines(hc, size, 12, true, 'rgba(0,0,0,0.5)', 2 * u);
  }
  // floor separators
  for (let row = 0; row < st.rows; row++) {
    const y = row * ch;
    cc.fillStyle = st.curtain ? 'rgba(20,28,34,0.9)' : 'rgba(0,0,0,0.16)';
    cc.fillRect(0, y, size, (st.curtain ? 3 : 2) * u);
    hc.fillStyle = 'rgb(190,190,190)';
    hc.fillRect(0, y, size, 3 * u);
  }

  for (let row = 0; row < st.rows; row++) {
    for (let col = 0; col < st.cols; col++) {
      const ww = cw * st.ww;
      const wh = ch * st.wh;
      const x = col * cw + (cw - ww) / 2;
      const y = row * ch + (ch - wh) * (st.balcony ? 0.38 : 0.45);
      // frame
      if (!st.curtain) {
        cc.fillStyle = st.lattice ? 'rgb(58,38,22)' : 'rgba(235,235,235,0.9)';
        cc.fillRect(x - 2 * u, y - 2 * u, ww + 4 * u, wh + 4 * u);
        hc.fillStyle = 'rgb(205,205,205)';
        hc.fillRect(x - 2 * u, y - 2 * u, ww + 4 * u, wh + 4 * u);
      }
      // glass
      const g = cc.createLinearGradient(0, y, 0, y + wh);
      const gl = rgb(st.glass);
      const tintK = rng.range(0.85, 1.15);
      g.addColorStop(0, 'rgb(' + Math.min(255, gl[0] * tintK * 1.5) + ',' + Math.min(255, gl[1] * tintK * 1.5) + ',' + Math.min(255, gl[2] * tintK * 1.5) + ')');
      g.addColorStop(1, 'rgb(' + gl[0] * tintK * 0.75 + ',' + gl[1] * tintK * 0.75 + ',' + gl[2] * tintK * 0.75 + ')');
      cc.fillStyle = g;
      cc.fillRect(x, y, ww, wh);
      hc.fillStyle = 'rgb(95,95,95)';
      hc.fillRect(x, y, ww, wh);
      rc.fillStyle = st.lattice ? 'rgb(190,190,190)' : 'rgb(28,28,28)';
      rc.fillRect(x, y, ww, wh);
      // mullions
      cc.fillStyle = st.lattice ? 'rgba(58,38,22,0.95)' : 'rgba(225,225,225,0.85)';
      const mull = st.lattice ? 3 : st.curtain ? 1 : 2;
      for (let m = 1; m < mull; m++) cc.fillRect(x + (ww * m) / mull - u * 0.75, y, 1.5 * u, wh);
      if (st.lattice) for (let m = 1; m < 3; m++) cc.fillRect(x, y + (wh * m) / 3 - u * 0.75, ww, 1.5 * u);
      // curtains / blinds
      if (!st.curtain && !st.lattice && rng.chance(0.35)) {
        cc.fillStyle = 'rgba(230,225,210,' + rng.range(0.25, 0.6) + ')';
        cc.fillRect(x, y, ww, wh * rng.range(0.2, 0.7));
      }
      // emissive: random lit windows
      if (rng.chance(st.lit)) {
        const eg = ec.createLinearGradient(0, y, 0, y + wh);
        const col = rng.pick(LIT_COLORS);
        eg.addColorStop(0, col);
        eg.addColorStop(1, 'rgba(120,90,50,1)');
        ec.fillStyle = eg;
        ec.globalAlpha = rng.range(0.55, 1);
        ec.fillRect(x, y, ww, wh);
        ec.globalAlpha = 1;
        if (rng.chance(0.4)) {
          ec.fillStyle = 'rgba(0,0,0,0.55)';
          ec.fillRect(x, y, ww * rng.range(0.2, 0.5), wh);
        }
        ec.fillStyle = 'rgba(0,0,0,0.6)';
        for (let m = 1; m < mull; m++) ec.fillRect(x + (ww * m) / mull - u * 0.75, y, 1.5 * u, wh);
      }
      // balcony rail / awning / sill
      if (st.balcony) {
        cc.fillStyle = 'rgba(70,74,78,0.9)';
        cc.fillRect(col * cw + cw * 0.08, y + wh + 3 * u, cw * 0.84, ch * 0.16);
        cc.fillStyle = 'rgba(255,255,255,0.12)';
        cc.fillRect(col * cw + cw * 0.08, y + wh + 3 * u, cw * 0.84, 1.5 * u);
        hc.fillStyle = 'rgb(220,220,220)';
        hc.fillRect(col * cw + cw * 0.08, y + wh + 3 * u, cw * 0.84, ch * 0.16);
      } else if (st.awning && row === st.rows - 1) {
        cc.fillStyle = css(AWNINGS[(variant + col) % AWNINGS.length]);
        cc.fillRect(col * cw + cw * 0.05, y - ch * 0.14, cw * 0.9, ch * 0.1);
        hc.fillStyle = 'rgb(235,235,235)';
        hc.fillRect(col * cw + cw * 0.05, y - ch * 0.14, cw * 0.9, ch * 0.1);
      } else if (!st.curtain) {
        cc.fillStyle = 'rgba(0,0,0,0.22)';
        cc.fillRect(x - 3 * u, y + wh + 2 * u, ww + 6 * u, 2 * u);
      }
    }
  }
  // grime streaks
  for (let i = 0; i < 10; i++) {
    cc.fillStyle = 'rgba(0,0,0,' + rng.range(0.02, 0.06) + ')';
    cc.fillRect(rng.range(size), 0, rng.range(2, 8) * u, size);
  }
  const hf = readLuma(h);
  return {
    map: c,
    normalMap: normalCanvas(hf, size, size, 0.9),
    roughnessMap: r,
    emissiveMap: e,
    meta: { tile: 1, bays: st.cols, floors: st.rows, tileW: st.cols * st.bay, tileH: st.rows * st.floor },
  };
}

// ------------------------------------------------------------------------------------------------
// Foliage, signs, decals, atlases, fx
// ------------------------------------------------------------------------------------------------

const LEAF_COLORS = [
  [0x2f6a25, 0x5c9a3a],
  [0x1f4d2c, 0x3f7a44],
  [0xa8521c, 0xd89a2a],
  [0xe7a3bd, 0xf7d3df],
];

function buildLeaves(key, variant) {
  const seed = hashString(key);
  const rng = new RNG(seed);
  const size = qualitySize(256);
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const [a, b] = LEAF_COLORS[(variant - 1) % LEAF_COLORS.length];
  const ca = rgb(a);
  const cb = rgb(b);
  const u = size / 256;
  for (let i = 0; i < 520; i++) {
    const t = rng.next();
    const x = rng.range(size);
    const y = rng.range(size);
    const rx = rng.range(5, 10) * u;
    const ry = rx * rng.range(0.4, 0.6);
    const ang = rng.range(Math.PI * 2);
    ctx.fillStyle = 'rgb(' + (ca[0] + (cb[0] - ca[0]) * t) + ',' + (ca[1] + (cb[1] - ca[1]) * t) + ',' + (ca[2] + (cb[2] - ca[2]) * t) + ')';
    // draw wrapped so the texture tiles
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const px = x + ox * size;
        const py = y + oy * size;
        if (px < -12 * u || px > size + 12 * u || py < -12 * u || py > size + 12 * u) continue;
        ctx.beginPath();
        ctx.ellipse(px, py, rx, ry, ang, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  return { map: c, normalMap: null, roughnessMap: null, emissiveMap: null, alpha: true, meta: { tile: 1 } };
}

const SIGN_STYLES = {
  shop: { w: 256, h: 64, bg: 0xf4f1e8, fg: 0x1d1d22, border: 0xb5352f },
  neon: { w: 256, h: 64, bg: 0x08080c, fg: 0xff4fa3, neon: true },
  road: { w: 256, h: 96, bg: 0x1b55a8, fg: 0xffffff, border: 0xffffff },
  billboard: { w: 512, h: 256, bg: 0xf7d24a, fg: 0x1a1a1a },
  plate: { w: 256, h: 128, bg: 0xf5f5f0, fg: 0x1d5a34, border: 0x1d5a34 },
  danger: { w: 256, h: 64, bg: 0xf2c41d, fg: 0x111111, border: 0x111111 },
  wood: { w: 128, h: 256, bg: 0x6b4a2c, fg: 0xf3ead6, vertical: true },
  info: { w: 256, h: 64, bg: 0x1f7a4d, fg: 0xffffff },
};

function drawSign(ctx, x, y, w, h, text, st, sub) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = css(st.bg);
  ctx.fillRect(x, y, w, h);
  if (st.border !== undefined) {
    const bw = Math.max(2, Math.min(w, h) * 0.06);
    ctx.strokeStyle = css(st.border);
    ctx.lineWidth = bw;
    ctx.strokeRect(x + bw / 2, y + bw / 2, w - bw, h - bw);
  }
  ctx.fillStyle = css(st.fg);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (st.neon) {
    ctx.shadowColor = css(st.fg);
    ctx.shadowBlur = Math.min(w, h) * 0.22;
  }
  if (st.vertical) {
    const chars = Array.from(text);
    const cell = Math.min(w * 0.72, (h * 0.9) / Math.max(1, chars.length));
    ctx.font = '700 ' + Math.floor(cell * 0.92) + 'px ' + FONT;
    const y0 = y + h / 2 - (cell * (chars.length - 1)) / 2;
    for (let i = 0; i < chars.length; i++) ctx.fillText(chars[i], x + w / 2, y0 + i * cell);
  } else {
    const main = sub ? h * 0.46 : h * 0.6;
    fitText(ctx, text, w * 0.86, main, '800');
    ctx.fillText(text, x + w / 2, y + (sub ? h * 0.4 : h * 0.53));
    if (st.neon) ctx.fillText(text, x + w / 2, y + (sub ? h * 0.4 : h * 0.53));
    if (sub) {
      ctx.shadowBlur = 0;
      fitText(ctx, sub, w * 0.86, h * 0.2, '600');
      ctx.fillText(sub, x + w / 2, y + h * 0.78);
    }
  }
  ctx.restore();
}

function buildAtlas(size, cols, rows, drawCell, bg) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);
  }
  const cw = size / cols;
  const ch = size / rows;
  for (let i = 0; i < cols * rows; i++) {
    const x = (i % cols) * cw;
    const y = Math.floor(i / cols) * ch;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, cw, ch);
    ctx.clip();
    drawCell(ctx, i, x, y, cw, ch);
    ctx.restore();
  }
  return c;
}

const SIGN_BG = [0xf4f1e8, 0xb5352f, 0x1b55a8, 0x1f7a4d, 0x22222a, 0xf2c41d, 0xffffff, 0xd9631e];
const NEON_FG = [0xff4fa3, 0x3fe0ff, 0xffe14a, 0x7dff6a, 0xff7a3a, 0xc07bff];

const ATLASES = {
  road_markings: {
    cols: 4, rows: 4,
    cells: ['line_solid', 'line_dashed', 'line_double', 'line_yellow', 'arrow_straight', 'arrow_left', 'arrow_right',
      'arrow_straight_left', 'arrow_straight_right', 'stop_line', 'stop_text', 'speed_40', 'speed_60', 'diamond', 'zebra', 'bike'],
  },
  sign_atlas: { cols: 4, rows: 4, cells: Array.from({ length: 16 }, (_, i) => 'sign_' + i) },
  neon_atlas: { cols: 4, rows: 4, cells: Array.from({ length: 16 }, (_, i) => 'neon_' + i) },
  particle_atlas: {
    cols: 4, rows: 4,
    cells: ['soft', 'smoke1', 'smoke2', 'fire1', 'fire2', 'spark', 'debris', 'drop', 'ring', 'star', 'leaf', 'glass', 'flash', 'puff', 'line', 'dot'],
  },
  sprite_atlas: {
    cols: 4, rows: 4,
    cells: ['glow', 'cone', 'shadow', 'arrow', 'ring', 'cross', 'heart', 'yen', 'star', 'exclaim', 'question', 'dot', 'square', 'triangle', 'bolt', 'chevron'],
  },
};

function arrowPath(ctx, cx, cy, s, kind) {
  ctx.beginPath();
  if (kind === 'straight') {
    ctx.moveTo(cx, cy - s);
    ctx.lineTo(cx + s * 0.45, cy - s * 0.3);
    ctx.lineTo(cx + s * 0.15, cy - s * 0.3);
    ctx.lineTo(cx + s * 0.15, cy + s);
    ctx.lineTo(cx - s * 0.15, cy + s);
    ctx.lineTo(cx - s * 0.15, cy - s * 0.3);
    ctx.lineTo(cx - s * 0.45, cy - s * 0.3);
  } else {
    const d = kind === 'left' ? -1 : 1;
    ctx.moveTo(cx - d * s * 0.2, cy + s);
    ctx.lineTo(cx - d * s * 0.2, cy - s * 0.2);
    ctx.lineTo(cx + d * s * 0.25, cy - s * 0.2);
    ctx.lineTo(cx + d * s * 0.25, cy + s * 0.15);
    ctx.lineTo(cx + d * s * 0.85, cy - s * 0.4);
    ctx.lineTo(cx + d * s * 0.25, cy - s * 0.95);
    ctx.lineTo(cx + d * s * 0.25, cy - s * 0.55);
    ctx.lineTo(cx - d * s * 0.5, cy - s * 0.55);
    ctx.lineTo(cx - d * s * 0.5, cy + s);
  }
  ctx.closePath();
  ctx.fill();
}

function drawRoadMarking(ctx, i, x, y, w, h) {
  const name = ATLASES.road_markings.cells[i];
  const cx = x + w / 2;
  const cy = y + h / 2;
  ctx.fillStyle = 'rgba(236,236,228,0.96)';
  ctx.strokeStyle = 'rgba(236,236,228,0.96)';
  switch (name) {
    case 'line_solid':
      ctx.fillRect(cx - w * 0.06, y, w * 0.12, h);
      break;
    case 'line_dashed':
      ctx.fillRect(cx - w * 0.06, y, w * 0.12, h * 0.5);
      break;
    case 'line_double':
      ctx.fillStyle = 'rgba(238,190,40,0.96)';
      ctx.fillRect(cx - w * 0.14, y, w * 0.09, h);
      ctx.fillRect(cx + w * 0.05, y, w * 0.09, h);
      break;
    case 'line_yellow':
      ctx.fillStyle = 'rgba(238,190,40,0.96)';
      ctx.fillRect(cx - w * 0.06, y, w * 0.12, h);
      break;
    case 'arrow_straight':
      arrowPath(ctx, cx, cy, h * 0.4, 'straight');
      break;
    case 'arrow_left':
      arrowPath(ctx, cx, cy, h * 0.4, 'left');
      break;
    case 'arrow_right':
      arrowPath(ctx, cx, cy, h * 0.4, 'right');
      break;
    case 'arrow_straight_left':
      arrowPath(ctx, cx + w * 0.12, cy, h * 0.4, 'straight');
      arrowPath(ctx, cx - w * 0.1, cy + h * 0.05, h * 0.3, 'left');
      break;
    case 'arrow_straight_right':
      arrowPath(ctx, cx - w * 0.12, cy, h * 0.4, 'straight');
      arrowPath(ctx, cx + w * 0.1, cy + h * 0.05, h * 0.3, 'right');
      break;
    case 'stop_line':
      ctx.fillRect(x, cy - h * 0.12, w, h * 0.24);
      break;
    case 'stop_text': {
      const chars = ['止', 'ま', 'れ'];
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '800 ' + Math.floor(h * 0.3) + 'px ' + FONT;
      for (let k = 0; k < 3; k++) ctx.fillText(chars[k], cx, y + h * (0.2 + k * 0.3));
      break;
    }
    case 'speed_40':
    case 'speed_60':
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(238,190,40,0.96)';
      ctx.font = '800 ' + Math.floor(h * 0.62) + 'px ' + FONT;
      ctx.fillText(name === 'speed_40' ? '40' : '60', cx, cy + h * 0.03);
      break;
    case 'diamond':
      ctx.lineWidth = w * 0.07;
      ctx.beginPath();
      ctx.moveTo(cx, y + h * 0.08);
      ctx.lineTo(cx + w * 0.22, cy);
      ctx.lineTo(cx, y + h * 0.92);
      ctx.lineTo(cx - w * 0.22, cy);
      ctx.closePath();
      ctx.stroke();
      break;
    case 'zebra':
      for (let k = 0; k < 3; k++) ctx.fillRect(x + w * (0.06 + k * 0.33), y, w * 0.2, h);
      break;
    case 'bike':
      ctx.lineWidth = w * 0.05;
      ctx.beginPath();
      ctx.arc(cx - w * 0.2, cy + h * 0.12, w * 0.14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + w * 0.2, cy + h * 0.12, w * 0.14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.2, cy + h * 0.12);
      ctx.lineTo(cx - w * 0.04, cy - h * 0.12);
      ctx.lineTo(cx + w * 0.12, cy - h * 0.12);
      ctx.lineTo(cx + w * 0.2, cy + h * 0.12);
      ctx.stroke();
      break;
    default:
      break;
  }
}

function softBlob(ctx, cx, cy, r, color, alpha) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, 'rgba(' + color + ',' + alpha + ')');
  g.addColorStop(1, 'rgba(' + color + ',0)');
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
}

function drawParticle(ctx, i, x, y, w, h, rng) {
  const name = ATLASES.particle_atlas.cells[i];
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = w * 0.46;
  const W = '255,255,255';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  switch (name) {
    case 'soft':
      softBlob(ctx, cx, cy, r, W, 1);
      break;
    case 'smoke1':
    case 'smoke2':
    case 'puff':
      for (let k = 0; k < 9; k++) softBlob(ctx, cx + rng.range(-0.4, 0.4) * r, cy + rng.range(-0.4, 0.4) * r, r * rng.range(0.35, 0.6), W, 0.42);
      break;
    case 'fire1':
    case 'fire2':
      for (let k = 0; k < 7; k++) softBlob(ctx, cx + rng.range(-0.25, 0.25) * r, cy + rng.range(-0.1, 0.5) * r, r * rng.range(0.3, 0.55), W, 0.5);
      softBlob(ctx, cx, cy - r * 0.35, r * 0.4, W, 0.6);
      break;
    case 'spark':
      softBlob(ctx, cx, cy, r * 0.5, W, 1);
      ctx.fillRect(cx - r * 0.9, cy - r * 0.04, r * 1.8, r * 0.08);
      break;
    case 'debris':
    case 'glass':
      ctx.beginPath();
      for (let k = 0; k < (name === 'glass' ? 3 : 6); k++) {
        const a = (k / (name === 'glass' ? 3 : 6)) * Math.PI * 2 + rng.range(-0.3, 0.3);
        const rr = r * rng.range(0.45, 0.85);
        if (k === 0) ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        else ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.globalAlpha = name === 'glass' ? 0.7 : 1;
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    case 'drop':
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.12, r * 0.85, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'ring':
      ctx.lineWidth = r * 0.12;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.75, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'star':
    case 'flash':
      softBlob(ctx, cx, cy, r * 0.7, W, 0.9);
      for (let k = 0; k < (name === 'flash' ? 8 : 4); k++) {
        const a = (k / (name === 'flash' ? 8 : 4)) * Math.PI;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a);
        const g = ctx.createLinearGradient(-r, 0, r, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.5, 'rgba(255,255,255,0.95)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(-r, -r * 0.035, r * 2, r * 0.07);
        ctx.restore();
      }
      break;
    case 'leaf':
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.7, r * 0.32, 0.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'line':
      ctx.fillRect(cx - r * 0.05, cy - r * 0.9, r * 0.1, r * 1.8);
      break;
    case 'dot':
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      break;
  }
}

function drawSprite(ctx, i, x, y, w, h) {
  const name = ATLASES.sprite_atlas.cells[i];
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = w * 0.44;
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = r * 0.16;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  switch (name) {
    case 'glow':
      softBlob(ctx, cx, cy, r, '255,255,255', 1);
      break;
    case 'cone': {
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.06, y);
      ctx.lineTo(cx + w * 0.06, y);
      ctx.lineTo(x + w * 0.95, y + h);
      ctx.lineTo(x + w * 0.05, y + h);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'shadow':
      softBlob(ctx, cx, cy, r, '0,0,0', 0.85);
      break;
    case 'arrow':
      arrowPath(ctx, cx, cy, r * 0.9, 'straight');
      break;
    case 'ring':
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'cross':
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.6, cy - r * 0.6);
      ctx.lineTo(cx + r * 0.6, cy + r * 0.6);
      ctx.moveTo(cx + r * 0.6, cy - r * 0.6);
      ctx.lineTo(cx - r * 0.6, cy + r * 0.6);
      ctx.stroke();
      break;
    case 'heart':
      ctx.beginPath();
      ctx.moveTo(cx, cy + r * 0.7);
      ctx.bezierCurveTo(cx - r * 1.3, cy - r * 0.2, cx - r * 0.5, cy - r * 1.0, cx, cy - r * 0.35);
      ctx.bezierCurveTo(cx + r * 0.5, cy - r * 1.0, cx + r * 1.3, cy - r * 0.2, cx, cy + r * 0.7);
      ctx.fill();
      break;
    case 'yen':
    case 'exclaim':
    case 'question':
      ctx.font = '800 ' + Math.floor(r * 1.7) + 'px ' + FONT;
      ctx.fillText(name === 'yen' ? '¥' : name === 'exclaim' ? '!' : '?', cx, cy + r * 0.05);
      break;
    case 'star':
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = k % 2 ? r * 0.38 : r * 0.9;
        if (k === 0) ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        else ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      break;
    case 'dot':
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'square':
      ctx.fillRect(cx - r * 0.6, cy - r * 0.6, r * 1.2, r * 1.2);
      break;
    case 'triangle':
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.75);
      ctx.lineTo(cx + r * 0.75, cy + r * 0.6);
      ctx.lineTo(cx - r * 0.75, cy + r * 0.6);
      ctx.closePath();
      ctx.fill();
      break;
    case 'bolt':
      ctx.beginPath();
      ctx.moveTo(cx + r * 0.2, cy - r * 0.9);
      ctx.lineTo(cx - r * 0.5, cy + r * 0.1);
      ctx.lineTo(cx - r * 0.05, cy + r * 0.1);
      ctx.lineTo(cx - r * 0.2, cy + r * 0.9);
      ctx.lineTo(cx + r * 0.5, cy - r * 0.1);
      ctx.lineTo(cx + r * 0.05, cy - r * 0.1);
      ctx.closePath();
      ctx.fill();
      break;
    case 'chevron':
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.6, cy + r * 0.3);
      ctx.lineTo(cx, cy - r * 0.4);
      ctx.lineTo(cx + r * 0.6, cy + r * 0.3);
      ctx.stroke();
      break;
    default:
      break;
  }
}

function buildSpecial(key) {
  const seed = hashString(key);
  const rng = new RNG(seed);
  let m;
  if (key === 'road_markings') {
    return { map: buildAtlas(qualitySize(512), 4, 4, drawRoadMarking), alpha: true, meta: { atlas: 'road_markings' } };
  }
  if (key === 'sign_atlas') {
    const c = buildAtlas(qualitySize(512), 4, 4, (ctx, i, x, y, w, h) => {
      const bg = SIGN_BG[i % SIGN_BG.length];
      const lum = rgb(bg)[0] * 0.3 + rgb(bg)[1] * 0.6 + rgb(bg)[2] * 0.1;
      const st = { bg, fg: lum > 140 ? 0x1d1d22 : 0xffffff, border: i % 3 === 0 ? (lum > 140 ? 0xb5352f : 0xffffff) : undefined, vertical: i % 4 === 3 };
      drawSign(ctx, x + 2, y + 2, w - 4, h - 4, shopName(rng), st, st.vertical ? null : rng.chance(0.5) ? rng.pick(SLOGANS) : null);
    }, '#222');
    return { map: c, meta: { atlas: 'sign_atlas' } };
  }
  if (key === 'neon_atlas') {
    const c = buildAtlas(qualitySize(512), 4, 4, (ctx, i, x, y, w, h) => {
      const st = { bg: 0x000000, fg: NEON_FG[i % NEON_FG.length], neon: true, vertical: i % 4 === 1 };
      drawSign(ctx, x + 2, y + 2, w - 4, h - 4, shopName(rng, i % 2 ? 'bar' : 'fun'), st, null);
    }, '#000');
    return { map: c, emissiveMap: c, meta: { atlas: 'neon_atlas' } };
  }
  if ((m = /^billboard_(\d+)$/.exec(key))) {
    const n = Number(m[1]);
    const w = qualitySize(512);
    const h = w / 2;
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    const bgs = [0xf7d24a, 0x1b55a8, 0xe8e2d2, 0xb5352f, 0x1f7a4d, 0x22222a, 0xf08cb0, 0x3fb0c8];
    const bg = bgs[(n - 1) % bgs.length];
    const g = ctx.createLinearGradient(0, 0, w, h);
    const b = rgb(bg);
    g.addColorStop(0, css(bg));
    g.addColorStop(1, 'rgb(' + b[0] * 0.7 + ',' + b[1] * 0.7 + ',' + b[2] * 0.7 + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.arc(w * rng.range(0.6, 0.9), h * rng.range(0.2, 0.8), h * rng.range(0.35, 0.6), 0, Math.PI * 2);
    ctx.fill();
    const lum = b[0] * 0.3 + b[1] * 0.6 + b[2] * 0.1;
    ctx.fillStyle = lum > 140 ? '#16161a' : '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const slogan = SLOGANS[(n * 5) % SLOGANS.length];
    fitText(ctx, slogan, w * 0.8, h * 0.26, '800');
    ctx.fillText(slogan, w * 0.07, h * 0.4);
    const brand = shopName(rng);
    fitText(ctx, brand, w * 0.8, h * 0.13, '600');
    ctx.fillText(brand, w * 0.07, h * 0.72);
    return { map: c, emissiveMap: c, meta: { aspect: 2 } };
  }
  if ((m = /^graffiti_(\d+)$/.exec(key))) {
    const n = Number(m[1]);
    const size = qualitySize(256);
    const c = makeCanvas(size, size);
    const ctx = c.getContext('2d');
    const cols = ['#ff3f8e', '#3fe0ff', '#ffe14a', '#7dff6a', '#ff7a3a', '#ffffff'];
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let k = 0; k < 5; k++) {
      ctx.strokeStyle = cols[(n + k) % cols.length];
      ctx.lineWidth = rng.range(5, 14) * (size / 256);
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      let x = rng.range(0.15, 0.85) * size;
      let y = rng.range(0.2, 0.8) * size;
      ctx.moveTo(x, y);
      for (let s = 0; s < 4; s++) {
        const nx = rng.range(0.1, 0.9) * size;
        const ny = rng.range(0.15, 0.85) * size;
        ctx.quadraticCurveTo(x + rng.range(-40, 40), y + rng.range(-40, 40), nx, ny);
        x = nx;
        y = ny;
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 3 * (size / 256);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const words = ['夢', '無限', '自由', '風'];
    ctx.font = '900 ' + Math.floor(size * 0.34) + 'px ' + FONT;
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(rng.range(-0.25, 0.25));
    ctx.strokeText(words[(n - 1) % words.length], 0, 0);
    ctx.fillText(words[(n - 1) % words.length], 0, 0);
    ctx.restore();
    return { map: c, alpha: true, meta: {} };
  }
  if (key === 'plate') {
    const w = qualitySize(256);
    const h = w / 2;
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    const st = SIGN_STYLES.plate;
    ctx.fillStyle = css(st.bg);
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = css(st.border);
    ctx.lineWidth = h * 0.05;
    ctx.strokeRect(h * 0.04, h * 0.04, w - h * 0.08, h - h * 0.08);
    ctx.fillStyle = css(st.fg);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 ' + Math.floor(h * 0.22) + 'px ' + FONT;
    ctx.fillText('無限 500', w / 2, h * 0.24);
    ctx.font = '800 ' + Math.floor(h * 0.46) + 'px ' + FONT;
    ctx.fillText('む 12-34', w / 2, h * 0.64);
    return { map: c, meta: { aspect: 2 } };
  }
  if (key === 'light_glow') {
    const size = 128;
    const c = makeCanvas(size, size);
    softBlob(c.getContext('2d'), size / 2, size / 2, size / 2, '255,255,255', 1);
    return { map: c, alpha: true, clamp: true, meta: {} };
  }
  if (key === 'sprite_atlas') {
    return { map: buildAtlas(qualitySize(512), 4, 4, drawSprite), alpha: true, meta: { atlas: 'sprite_atlas' } };
  }
  if (key === 'particle_atlas') {
    return {
      map: buildAtlas(qualitySize(512), 4, 4, (ctx, i, x, y, w, h) => drawParticle(ctx, i, x, y, w, h, rng)),
      alpha: true,
      meta: { atlas: 'particle_atlas' },
    };
  }
  if (key === 'noise') {
    const size = 256;
    const c = makeCanvas(size, size);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const d = img.data;
    const k = 8 / size;
    for (let y = 0, p = 0; y < size; y++) {
      for (let x = 0; x < size; x++, p += 4) {
        d[p] = (fbm2p(x * k, y * k, 8, 4, 0.5, 11) * 0.5 + 0.5) * 255;
        d[p + 1] = (valueNoise2p(x * k * 2, y * k * 2, 16, 16, 23) * 0.5 + 0.5) * 255;
        d[p + 2] = worley2p(x * k, y * k, 8, 37) * 255;
        d[p + 3] = hash2(x, y, 53) & 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return { map: c, data: true, meta: { channels: 'r=fbm g=value b=worley a=white' } };
  }
  if (key === 'water_normal') {
    const size = qualitySize(256);
    const f = noiseField(size, 6, 4, 0.55, seed);
    return { map: normalCanvas(f, size, size, 1.6), data: true, meta: {} };
  }
  if (key === 'caustics') {
    const size = qualitySize(256);
    const f1 = worleyField(size, 6, seed);
    const f2 = worleyField(size, 9, seed + 1);
    const c = makeCanvas(size, size);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const d = img.data;
    for (let i = 0, p = 0; i < f1.length; i++, p += 4) {
      let v = Math.pow(f1[i], 2.2) * 1.5 + Math.pow(f2[i], 2.6) * 0.9;
      v = v > 1 ? 1 : v;
      d[p] = d[p + 1] = d[p + 2] = v * 255;
      d[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return { map: c, meta: {} };
  }
  if (key === 'cloud' || key === 'smoke') {
    const size = qualitySize(256);
    const f = noiseField(size, 4, 5, 0.55, seed);
    const c = makeCanvas(size, size);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const d = img.data;
    const half = size / 2;
    for (let y = 0, i = 0, p = 0; y < size; y++) {
      for (let x = 0; x < size; x++, i++, p += 4) {
        const dx = (x - half) / half;
        const dy = (y - half) / half;
        let fall = 1 - Math.sqrt(dx * dx + dy * dy);
        fall = fall < 0 ? 0 : fall;
        let a = (f[i] - 0.3) * 1.9 * Math.min(1, fall * (key === 'smoke' ? 2.2 : 1.6));
        a = a < 0 ? 0 : a > 1 ? 1 : a;
        const shade = 200 + f[i] * 55;
        d[p] = d[p + 1] = d[p + 2] = shade;
        d[p + 3] = a * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return { map: c, alpha: true, clamp: true, meta: {} };
  }
  if (key === 'fire') {
    const size = qualitySize(256);
    const f = noiseField(size, 4, 4, 0.55, seed);
    const c = makeCanvas(size, size);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const d = img.data;
    const half = size / 2;
    for (let y = 0, i = 0, p = 0; y < size; y++) {
      for (let x = 0; x < size; x++, i++, p += 4) {
        const dx = Math.abs(x - half) / half;
        const v = y / size; // 0 top .. 1 bottom
        let a = (f[i] * 0.9 + v * 0.9 - 0.55) * (1 - dx * dx) * 1.8;
        a = a < 0 ? 0 : a > 1 ? 1 : a;
        d[p] = 255;
        d[p + 1] = 90 + a * 165;
        d[p + 2] = 20 + a * a * 150;
        d[p + 3] = a * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return { map: c, alpha: true, clamp: true, meta: {} };
  }
  if (key === 'flare') {
    const size = 256;
    const c = makeCanvas(size, size);
    const ctx = c.getContext('2d');
    drawParticle(ctx, ATLASES.particle_atlas.cells.indexOf('flash'), 0, 0, size, size, rng);
    return { map: c, alpha: true, clamp: true, meta: {} };
  }
  return null;
}

// ------------------------------------------------------------------------------------------------
// Dispatcher
// ------------------------------------------------------------------------------------------------

/**
 * buildRaw(key) → raw canvases for a texture key, or null for unknown keys.
 * @param {string} key
 * @returns {{map: HTMLCanvasElement, normalMap?: HTMLCanvasElement, roughnessMap?: HTMLCanvasElement, emissiveMap?: HTMLCanvasElement, alpha?: boolean, data?: boolean, clamp?: boolean, meta: object}|null}
 */
export function buildRaw(key) {
  let m;
  if (SURFACES[key]) return buildSurface(key, SURFACES[key]);
  if ((m = /^facade_(office|glass|apartment|house|shop|industrial|old)_(\d+)$/.exec(key))) {
    return buildFacade(key, m[1], Number(m[2]) || 1);
  }
  if ((m = /^leaves_(\d+)$/.exec(key))) return buildLeaves(key, Number(m[1]) || 1);
  return buildSpecial(key);
}

/**
 * buildNeutral(key) → neutral grey fallback set for unknown keys.
 * @param {string} key
 */
export function buildNeutral(key) {
  return buildSurface('fallback:' + key, [0x7d7d7d, 0x9a9a9a, 4, 3, 0.04, 0.3, 0.7, 0.9, null]);
}

const FACADE_COUNTS = { office: 4, glass: 3, apartment: 4, house: 4, shop: 4, industrial: 3, old: 2 };

/**
 * allKeys() → every supported texture key.
 * @returns {string[]}
 */
export function allKeys() {
  const keys = Object.keys(SURFACES);
  for (const kind in FACADE_COUNTS) for (let i = 1; i <= FACADE_COUNTS[kind]; i++) keys.push('facade_' + kind + '_' + i);
  for (let i = 1; i <= 4; i++) keys.push('leaves_' + i);
  for (let i = 1; i <= 8; i++) keys.push('billboard_' + i);
  for (let i = 1; i <= 4; i++) keys.push('graffiti_' + i);
  keys.push('road_markings', 'sign_atlas', 'neon_atlas', 'plate', 'light_glow', 'sprite_atlas', 'noise', 'particle_atlas',
    'water_normal', 'cloud', 'flare', 'smoke', 'fire', 'caustics');
  return keys;
}


export { ATLASES, SIGN_STYLES, drawSign, shopName, SLOGANS, makeCanvas };
