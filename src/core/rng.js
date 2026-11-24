// MUGEN CITY — deterministic randomness: integer hashes, seeded RNG, value/simplex/worley noise,
// fbm / ridged / domain-warp helpers. Everything here is pure, allocation free and fast enough
// for per-vertex / per-texel use. All noise functions take an integer `seed`.
//
// Ranges: valueNoise*, simplex*, fbm* return ~[-1, 1]; ridged* and worley* return [0, 1].

const INV_U32 = 1 / 4294967296;

// ------------------------------------------------------------------------------------------------
// Hashes
// ------------------------------------------------------------------------------------------------

/**
 * hash2(x, y, seed=0) → uint32. Integer lattice hash (inputs are truncated to int32).
 * @param {number} x @param {number} y @param {number} [seed]
 * @returns {number}
 */
export function hash2(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * hash3(x, y, z, seed=0) → uint32.
 * @param {number} x @param {number} y @param {number} z @param {number} [seed]
 * @returns {number}
 */
export function hash3(x, y, z, seed = 0) {
  let h =
    (Math.imul(x | 0, 0x27d4eb2d) ^
      Math.imul(y | 0, 0x165667b1) ^
      Math.imul(z | 0, 0x1b873593) ^
      Math.imul(seed | 0, 0x9e3779b1)) |
    0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * hash1(n, seed=0) → uint32.
 * @param {number} n @param {number} [seed]
 * @returns {number}
 */
export function hash1(n, seed = 0) {
  let h = (Math.imul(n | 0, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca77)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * hash2f(x, y, seed=0) → float in [0, 1).
 * @param {number} x @param {number} y @param {number} [seed]
 * @returns {number}
 */
export function hash2f(x, y, seed = 0) {
  return hash2(x, y, seed) * INV_U32;
}

/**
 * hash3f(x, y, z, seed=0) → float in [0, 1).
 * @param {number} x @param {number} y @param {number} z @param {number} [seed]
 * @returns {number}
 */
export function hash3f(x, y, z, seed = 0) {
  return hash3(x, y, z, seed) * INV_U32;
}

/**
 * hashString(str) → uint32 (FNV-1a with avalanche). Stable across sessions.
 * @param {string} str
 * @returns {number}
 */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * toSeed(value) → uint32 seed from a number or string.
 * @param {number|string} value
 * @returns {number}
 */
export function toSeed(value) {
  if (typeof value === 'string') return hashString(value);
  if (typeof value !== 'number' || value !== value) return 0x9e3779b9;
  return Number.isInteger(value) ? value >>> 0 : hash1(Math.floor(value * 1e6));
}

// ------------------------------------------------------------------------------------------------
// Generators
// ------------------------------------------------------------------------------------------------

/**
 * mulberry32(seed) → () => float in [0, 1). Small/fast generator (one uint32 of state).
 * @param {number} seed
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) * INV_U32;
  };
}

/**
 * sfc32(a, b, c, d) → () => float in [0, 1). High quality 128-bit state generator.
 * @param {number} a @param {number} b @param {number} c @param {number} d
 * @returns {() => number}
 */
export function sfc32(a, b, c, d) {
  a |= 0;
  b |= 0;
  c |= 0;
  d |= 0;
  return function () {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) * INV_U32;
  };
}

/**
 * Seeded random number generator (sfc32 core). Deterministic for a given seed;
 * use one instance per generation task and `fork(key)` for independent sub-streams.
 */
export class RNG {
  /**
   * @param {number|string} [seed=1]
   */
  constructor(seed = 1) {
    this.a = 0;
    this.b = 0;
    this.c = 0;
    this.d = 1;
    this.reseed(seed);
  }

  /**
   * reseed(seed) → this. Resets the stream.
   * @param {number|string} seed
   * @returns {RNG}
   */
  reseed(seed) {
    const s = toSeed(seed);
    this.a = hash1(s, 0x1234) | 0;
    this.b = hash1(s, 0x5678) | 0;
    this.c = hash1(s, 0x9abc) | 0;
    this.d = 1;
    for (let i = 0; i < 12; i++) this.u32();
    return this;
  }

  /**
   * u32() → uniform uint32.
   * @returns {number}
   */
  u32() {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /**
   * next() → float in [0, 1).
   * @returns {number}
   */
  next() {
    return this.u32() * INV_U32;
  }

  /**
   * range(min, max) → float in [min, max). `range(max)` → [0, max).
   * @param {number} min @param {number} [max]
   * @returns {number}
   */
  range(min, max) {
    if (max === undefined) return this.next() * min;
    return min + (max - min) * this.next();
  }

  /**
   * int(n) → integer in [0, n).
   * @param {number} n
   * @returns {number}
   */
  int(n) {
    return Math.floor(this.next() * n);
  }

  /**
   * irange(min, max) → integer in [min, max] (inclusive).
   * @param {number} min @param {number} max
   * @returns {number}
   */
  irange(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /**
   * chance(p=0.5) → true with probability p.
   * @param {number} [p]
   * @returns {boolean}
   */
  chance(p = 0.5) {
    return this.next() < p;
  }

  /**
   * sign() → -1 or +1.
   * @returns {number}
   */
  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }

  /**
   * pick(array) → random element (undefined for an empty array).
   * @template T @param {T[]} array
   * @returns {T}
   */
  pick(array) {
    return array[Math.floor(this.next() * array.length)];
  }

  /**
   * weighted(weights) → index chosen proportionally to `weights[i]` (≥ 0).
   * @param {ArrayLike<number>} weights
   * @returns {number}
   */
  weighted(weights) {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i];
    if (total <= 0) return 0;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  /**
   * shuffle(array) → the same array, shuffled in place (Fisher–Yates).
   * @template T @param {T[]} array
   * @returns {T[]}
   */
  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = array[i];
      array[i] = array[j];
      array[j] = t;
    }
    return array;
  }

  /**
   * gauss(mean=0, sd=1) → normally distributed float (Box–Muller).
   * @param {number} [mean] @param {number} [sd]
   * @returns {number}
   */
  gauss(mean = 0, sd = 1) {
    const u = 1 - this.next();
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307179586 * v);
  }

  /**
   * inCircle(out, radius=1) → out {x, y|z} uniformly inside a disc. Writes `out.x` and `out.z`
   * (and `out.y` when the target has no `z`).
   * @param {{x:number, y?:number, z?:number}} out @param {number} [radius]
   */
  inCircle(out, radius = 1) {
    const a = this.next() * 6.283185307179586;
    const r = Math.sqrt(this.next()) * radius;
    out.x = Math.cos(a) * r;
    if ('z' in out) out.z = Math.sin(a) * r;
    else out.y = Math.sin(a) * r;
    return out;
  }

  /**
   * fork(key=0) → new independent RNG derived from this stream's state and `key`
   * (does not advance this stream).
   * @param {number|string} [key]
   * @returns {RNG}
   */
  fork(key = 0) {
    return new RNG(hash3(this.a, this.b, this.c ^ this.d, toSeed(key)));
  }

  /**
   * getState() → [a, b, c, d] (for saves).
   * @returns {number[]}
   */
  getState() {
    return [this.a, this.b, this.c, this.d];
  }

  /**
   * setState(state) → this.
   * @param {number[]} state
   * @returns {RNG}
   */
  setState(state) {
    this.a = state[0] | 0;
    this.b = state[1] | 0;
    this.c = state[2] | 0;
    this.d = state[3] | 0;
    return this;
  }
}

// ------------------------------------------------------------------------------------------------
// Value noise
// ------------------------------------------------------------------------------------------------

/**
 * valueNoise2(x, y, seed=0) → [-1, 1]. Quintic-interpolated lattice value noise.
 * @param {number} x @param {number} y @param {number} [seed]
 * @returns {number}
 */
export function valueNoise2(x, y, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  const ab = a + (b - a) * u;
  const cd = c + (d - c) * u;
  return (ab + (cd - ab) * v) * (2 * INV_U32) - 1;
}

/**
 * valueNoise2p(x, y, px, py, seed=0) → [-1, 1]. Periodic value noise: tiles every `px` × `py`
 * lattice cells (px, py are positive integers). Used for tileable textures.
 * @param {number} x @param {number} y @param {number} px @param {number} py @param {number} [seed]
 * @returns {number}
 */
export function valueNoise2p(x, y, px, py, seed = 0) {
  const xf = Math.floor(x);
  const yf = Math.floor(y);
  const fx = x - xf;
  const fy = y - yf;
  let x0 = xf % px;
  if (x0 < 0) x0 += px;
  let y0 = yf % py;
  if (y0 < 0) y0 += py;
  const x1 = x0 + 1 === px ? 0 : x0 + 1;
  const y1 = y0 + 1 === py ? 0 : y0 + 1;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  const ab = a + (b - a) * u;
  const cd = c + (d - c) * u;
  return (ab + (cd - ab) * v) * (2 * INV_U32) - 1;
}

/**
 * valueNoise3(x, y, z, seed=0) → [-1, 1].
 * @param {number} x @param {number} y @param {number} z @param {number} [seed]
 * @returns {number}
 */
export function valueNoise3(x, y, z, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const w = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a0 = hash3(xi, yi, zi, seed);
  const b0 = hash3(xi + 1, yi, zi, seed);
  const c0 = hash3(xi, yi + 1, zi, seed);
  const d0 = hash3(xi + 1, yi + 1, zi, seed);
  const a1 = hash3(xi, yi, zi + 1, seed);
  const b1 = hash3(xi + 1, yi, zi + 1, seed);
  const c1 = hash3(xi, yi + 1, zi + 1, seed);
  const d1 = hash3(xi + 1, yi + 1, zi + 1, seed);
  const ab0 = a0 + (b0 - a0) * u;
  const cd0 = c0 + (d0 - c0) * u;
  const ab1 = a1 + (b1 - a1) * u;
  const cd1 = c1 + (d1 - c1) * u;
  const e0 = ab0 + (cd0 - ab0) * v;
  const e1 = ab1 + (cd1 - ab1) * v;
  return (e0 + (e1 - e0) * w) * (2 * INV_U32) - 1;
}

// ------------------------------------------------------------------------------------------------
// Simplex noise (hash based gradients → any seed, no permutation tables)
// ------------------------------------------------------------------------------------------------

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;

// 16 unit gradients on a circle.
const GRAD2 = new Float32Array(32);
for (let i = 0; i < 16; i++) {
  const a = ((i + 0.37) / 16) * Math.PI * 2;
  GRAD2[i * 2] = Math.cos(a);
  GRAD2[i * 2 + 1] = Math.sin(a);
}
// 12 cube-edge gradients padded to 16.
const GRAD3 = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1,
  -1, 1, 1, 0, 0, -1, 1, -1, 1, 0, 0, -1, -1,
]);

/**
 * simplex2(x, y, seed=0) → [-1, 1]. 2D simplex noise.
 * @param {number} x @param {number} y @param {number} [seed]
 * @returns {number}
 */
export function simplex2(x, y, seed = 0) {
  const s = (x + y) * F2;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const t = (i + j) * G2;
  const x0 = x - (i - t);
  const y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0;
  const j1 = 1 - i1;
  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;
  let n = 0;
  let tt = 0.5 - x0 * x0 - y0 * y0;
  if (tt > 0) {
    const g = (hash2(i, j, seed) & 15) << 1;
    tt *= tt;
    n += tt * tt * (GRAD2[g] * x0 + GRAD2[g + 1] * y0);
  }
  tt = 0.5 - x1 * x1 - y1 * y1;
  if (tt > 0) {
    const g = (hash2(i + i1, j + j1, seed) & 15) << 1;
    tt *= tt;
    n += tt * tt * (GRAD2[g] * x1 + GRAD2[g + 1] * y1);
  }
  tt = 0.5 - x2 * x2 - y2 * y2;
  if (tt > 0) {
    const g = (hash2(i + 1, j + 1, seed) & 15) << 1;
    tt *= tt;
    n += tt * tt * (GRAD2[g] * x2 + GRAD2[g + 1] * y2);
  }
  return n * 99.2;
}

/**
 * simplex3(x, y, z, seed=0) → [-1, 1]. 3D simplex noise.
 * @param {number} x @param {number} y @param {number} z @param {number} [seed]
 * @returns {number}
 */
export function simplex3(x, y, z, seed = 0) {
  const s = (x + y + z) * F3;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const k = Math.floor(z + s);
  const t = (i + j + k) * G3;
  const x0 = x - (i - t);
  const y0 = y - (j - t);
  const z0 = z - (k - t);
  let i1, j1, k1, i2, j2, k2;
  if (x0 >= y0) {
    if (y0 >= z0) {
      i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
    } else if (x0 >= z0) {
      i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1;
    } else {
      i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1;
    }
  } else if (y0 < z0) {
    i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1;
  } else if (x0 < z0) {
    i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1;
  } else {
    i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
  }
  const x1 = x0 - i1 + G3;
  const y1 = y0 - j1 + G3;
  const z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2 * G3;
  const y2 = y0 - j2 + 2 * G3;
  const z2 = z0 - k2 + 2 * G3;
  const x3 = x0 - 1 + 3 * G3;
  const y3 = y0 - 1 + 3 * G3;
  const z3 = z0 - 1 + 3 * G3;
  let n = 0;
  let tt = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
  if (tt > 0) {
    const g = (hash3(i, j, k, seed) & 15) * 3;
    tt *= tt;
    n += tt * tt * (GRAD3[g] * x0 + GRAD3[g + 1] * y0 + GRAD3[g + 2] * z0);
  }
  tt = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
  if (tt > 0) {
    const g = (hash3(i + i1, j + j1, k + k1, seed) & 15) * 3;
    tt *= tt;
    n += tt * tt * (GRAD3[g] * x1 + GRAD3[g + 1] * y1 + GRAD3[g + 2] * z1);
  }
  tt = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
  if (tt > 0) {
    const g = (hash3(i + i2, j + j2, k + k2, seed) & 15) * 3;
    tt *= tt;
    n += tt * tt * (GRAD3[g] * x2 + GRAD3[g + 1] * y2 + GRAD3[g + 2] * z2);
  }
  tt = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
  if (tt > 0) {
    const g = (hash3(i + 1, j + 1, k + 1, seed) & 15) * 3;
    tt *= tt;
    n += tt * tt * (GRAD3[g] * x3 + GRAD3[g + 1] * y3 + GRAD3[g + 2] * z3);
  }
  return n * 32;
}

// ------------------------------------------------------------------------------------------------
// Fractal helpers
// ------------------------------------------------------------------------------------------------

/**
 * fbm2(x, y, octaves=5, lacunarity=2, gain=0.5, seed=0) → ~[-1, 1]. Simplex fBm (normalized).
 * @param {number} x @param {number} y @param {number} [octaves] @param {number} [lacunarity]
 * @param {number} [gain] @param {number} [seed]
 * @returns {number}
 */
export function fbm2(x, y, octaves = 5, lacunarity = 2, gain = 0.5, seed = 0) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * simplex2(x, y, seed + o * 131);
    norm += amp;
    amp *= gain;
    x *= lacunarity;
    y *= lacunarity;
  }
  return sum / norm;
}

/**
 * fbm3(x, y, z, octaves=4, lacunarity=2, gain=0.5, seed=0) → ~[-1, 1].
 * @param {number} x @param {number} y @param {number} z @param {number} [octaves]
 * @param {number} [lacunarity] @param {number} [gain] @param {number} [seed]
 * @returns {number}
 */
export function fbm3(x, y, z, octaves = 4, lacunarity = 2, gain = 0.5, seed = 0) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * simplex3(x, y, z, seed + o * 131);
    norm += amp;
    amp *= gain;
    x *= lacunarity;
    y *= lacunarity;
    z *= lacunarity;
  }
  return sum / norm;
}

/**
 * vfbm2(x, y, octaves=4, lacunarity=2, gain=0.5, seed=0) → ~[-1, 1]. Value-noise fBm (cheaper,
 * blockier than simplex; good for masks).
 * @param {number} x @param {number} y @param {number} [octaves] @param {number} [lacunarity]
 * @param {number} [gain] @param {number} [seed]
 * @returns {number}
 */
export function vfbm2(x, y, octaves = 4, lacunarity = 2, gain = 0.5, seed = 0) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise2(x, y, seed + o * 131);
    norm += amp;
    amp *= gain;
    x *= lacunarity;
    y *= lacunarity;
  }
  return sum / norm;
}

/**
 * fbm2p(x, y, period, octaves=4, gain=0.5, seed=0) → ~[-1, 1]. Tileable value-noise fBm:
 * repeats every `period` units in x and y (period = positive integer, lacunarity fixed at 2).
 * @param {number} x @param {number} y @param {number} period @param {number} [octaves]
 * @param {number} [gain] @param {number} [seed]
 * @returns {number}
 */
export function fbm2p(x, y, period, octaves = 4, gain = 0.5, seed = 0) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let p = period;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise2p(x, y, p, p, seed + o * 131);
    norm += amp;
    amp *= gain;
    x *= 2;
    y *= 2;
    p *= 2;
  }
  return sum / norm;
}

/**
 * ridged2(x, y, octaves=5, lacunarity=2, gain=0.5, seed=0) → [0, 1]. Ridged multifractal
 * (sharp crests — mountains, cracks).
 * @param {number} x @param {number} y @param {number} [octaves] @param {number} [lacunarity]
 * @param {number} [gain] @param {number} [seed]
 * @returns {number}
 */
export function ridged2(x, y, octaves = 5, lacunarity = 2, gain = 0.5, seed = 0) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let weight = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(simplex2(x, y, seed + o * 131));
    n *= n;
    n *= weight;
    weight = n * 2;
    if (weight > 1) weight = 1;
    sum += amp * n;
    norm += amp;
    amp *= gain;
    x *= lacunarity;
    y *= lacunarity;
  }
  return sum / norm;
}

/**
 * warp2(x, y, amp, freq, seed, out) → out {x, y}. Domain warp: offsets a coordinate by two
 * decorrelated simplex fields. Feed `out.x/out.y` into any other noise.
 * @param {number} x @param {number} y @param {number} amp @param {number} freq
 * @param {number} seed @param {{x:number, y:number}} out
 * @returns {{x:number, y:number}}
 */
export function warp2(x, y, amp, freq, seed, out) {
  out.x = x + amp * simplex2(x * freq, y * freq, seed + 7919);
  out.y = y + amp * simplex2(x * freq + 31.7, y * freq - 17.3, seed + 104729);
  return out;
}

/**
 * warpedFbm2(x, y, octaves=5, warpAmp=0.5, warpFreq=1, seed=0) → ~[-1, 1]. fBm evaluated on a
 * domain-warped coordinate (natural looking terrain / clouds). Allocation free.
 * @param {number} x @param {number} y @param {number} [octaves] @param {number} [warpAmp]
 * @param {number} [warpFreq] @param {number} [seed]
 * @returns {number}
 */
export function warpedFbm2(x, y, octaves = 5, warpAmp = 0.5, warpFreq = 1, seed = 0) {
  const wx = x + warpAmp * simplex2(x * warpFreq, y * warpFreq, seed + 7919);
  const wy = y + warpAmp * simplex2(x * warpFreq + 31.7, y * warpFreq - 17.3, seed + 104729);
  return fbm2(wx, wy, octaves, 2, 0.5, seed);
}

// ------------------------------------------------------------------------------------------------
// Worley (cellular) noise
// ------------------------------------------------------------------------------------------------

/**
 * worley2(x, y, seed=0) → [0, 1]. Distance to the nearest feature point (F1, clamped).
 * @param {number} x @param {number} y @param {number} [seed]
 * @returns {number}
 */
export function worley2(x, y, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let best = 9;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = xi + ox;
      const cy = yi + oy;
      const h = hash2(cx, cy, seed);
      const px = cx + (h & 0xffff) / 65536;
      const py = cy + (h >>> 16) / 65536;
      const dx = px - x;
      const dy = py - y;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
  }
  const r = Math.sqrt(best);
  return r > 1 ? 1 : r;
}

/**
 * worley2p(x, y, period, seed=0) → [0, 1]. Tileable F1 worley noise (period = positive integer).
 * @param {number} x @param {number} y @param {number} period @param {number} [seed]
 * @returns {number}
 */
export function worley2p(x, y, period, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let best = 9;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = xi + ox;
      const cy = yi + oy;
      let wx = cx % period;
      if (wx < 0) wx += period;
      let wy = cy % period;
      if (wy < 0) wy += period;
      const h = hash2(wx, wy, seed);
      const px = cx + (h & 0xffff) / 65536;
      const py = cy + (h >>> 16) / 65536;
      const dx = px - x;
      const dy = py - y;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
  }
  const r = Math.sqrt(best);
  return r > 1 ? 1 : r;
}
