// MUGEN CITY — math helpers and temp-object pools.
// Scalar helpers are pure. The tmp*() pools hand out scratch objects from a ring buffer:
// they are valid for the current short computation only (never store them, never hold more
// than a handful at once across calls into other modules).

import { Vector2, Vector3, Quaternion, Matrix4, Euler, Color, Box3, Sphere } from 'three';

export const PI = Math.PI;
export const TAU = Math.PI * 2;
export const HALF_PI = Math.PI / 2;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const EPS = 1e-6;

/** Shared constant axes (never mutate). */
export const AXIS_X = Object.freeze(new Vector3(1, 0, 0));
export const AXIS_Y = Object.freeze(new Vector3(0, 1, 0));
export const AXIS_Z = Object.freeze(new Vector3(0, 0, 1));

// ------------------------------------------------------------------------------------------------
// Scalars
// ------------------------------------------------------------------------------------------------

/**
 * clamp(x, min, max) → x limited to [min, max].
 * @param {number} x @param {number} min @param {number} max @returns {number}
 */
export function clamp(x, min, max) {
  return x < min ? min : x > max ? max : x;
}

/**
 * clamp01(x) → x limited to [0, 1].
 * @param {number} x @returns {number}
 */
export function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * lerp(a, b, t) → a + (b - a) * t (unclamped).
 * @param {number} a @param {number} b @param {number} t @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * invLerp(a, b, x) → t such that lerp(a, b, t) = x (0 when a = b).
 * @param {number} a @param {number} b @param {number} x @returns {number}
 */
export function invLerp(a, b, x) {
  return a === b ? 0 : (x - a) / (b - a);
}

/**
 * remap(x, inMin, inMax, outMin, outMax) → linear remap (unclamped).
 * @param {number} x @param {number} inMin @param {number} inMax @param {number} outMin @param {number} outMax
 * @returns {number}
 */
export function remap(x, inMin, inMax, outMin, outMax) {
  return outMin + ((x - inMin) / (inMax - inMin)) * (outMax - outMin);
}

/**
 * remapClamped(x, inMin, inMax, outMin, outMax) → linear remap clamped to the output range.
 * @param {number} x @param {number} inMin @param {number} inMax @param {number} outMin @param {number} outMax
 * @returns {number}
 */
export function remapClamped(x, inMin, inMax, outMin, outMax) {
  let t = inMin === inMax ? 0 : (x - inMin) / (inMax - inMin);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return outMin + t * (outMax - outMin);
}

/**
 * smoothstep(edge0, edge1, x) → Hermite 0..1.
 * @param {number} edge0 @param {number} edge1 @param {number} x @returns {number}
 */
export function smoothstep(edge0, edge1, x) {
  let t = edge0 === edge1 ? (x < edge0 ? 0 : 1) : (x - edge0) / (edge1 - edge0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

/**
 * smootherstep(edge0, edge1, x) → quintic 0..1.
 * @param {number} edge0 @param {number} edge1 @param {number} x @returns {number}
 */
export function smootherstep(edge0, edge1, x) {
  let t = edge0 === edge1 ? (x < edge0 ? 0 : 1) : (x - edge0) / (edge1 - edge0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * damp(current, target, lambda, dt) → frame-rate independent exponential approach.
 * `lambda` ≈ speed (1/s): higher = snappier. damp(a, b, 8, dt) covers ~63 % in 1/8 s.
 * @param {number} current @param {number} target @param {number} lambda @param {number} dt
 * @returns {number}
 */
export function damp(current, target, lambda, dt) {
  return target + (current - target) * Math.exp(-lambda * dt);
}

/**
 * dampFactor(lambda, dt) → interpolation factor t = 1 - exp(-lambda·dt) for lerp-style smoothing.
 * @param {number} lambda @param {number} dt @returns {number}
 */
export function dampFactor(lambda, dt) {
  return 1 - Math.exp(-lambda * dt);
}

/**
 * moveTowards(current, target, maxDelta) → current moved by at most maxDelta towards target.
 * @param {number} current @param {number} target @param {number} maxDelta @returns {number}
 */
export function moveTowards(current, target, maxDelta) {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/**
 * sq(x) → x².
 * @param {number} x @returns {number}
 */
export function sq(x) {
  return x * x;
}

/**
 * sign0(x) → -1, 0 or 1.
 * @param {number} x @returns {number}
 */
export function sign0(x) {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}

/**
 * deadzone(x, dz) → 0 inside ±dz, rescaled to keep the full -1..1 range outside.
 * @param {number} x @param {number} dz @returns {number}
 */
export function deadzone(x, dz) {
  const a = Math.abs(x);
  if (a <= dz) return 0;
  return Math.sign(x) * ((a - dz) / (1 - dz));
}

/**
 * fract(x) → fractional part in [0, 1).
 * @param {number} x @returns {number}
 */
export function fract(x) {
  return x - Math.floor(x);
}

/**
 * mod(x, m) → positive modulo in [0, m).
 * @param {number} x @param {number} m @returns {number}
 */
export function mod(x, m) {
  return ((x % m) + m) % m;
}

/**
 * pingPong(t, length) → triangle wave 0..length..0.
 * @param {number} t @param {number} length @returns {number}
 */
export function pingPong(t, length) {
  const m = mod(t, length * 2);
  return length - Math.abs(m - length);
}

// ------------------------------------------------------------------------------------------------
// Angles (radians). Yaw convention: forward = (sin yaw, 0, cos yaw); yaw 0 faces +Z.
// ------------------------------------------------------------------------------------------------

/**
 * wrapAngle(a) → a wrapped to (-π, π].
 * @param {number} a @returns {number}
 */
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a <= 0) a += TAU;
  return a - Math.PI;
}

/**
 * angleDelta(from, to) → shortest signed difference to - from in (-π, π].
 * @param {number} from @param {number} to @returns {number}
 */
export function angleDelta(from, to) {
  return wrapAngle(to - from);
}

/**
 * lerpAngle(a, b, t) → interpolation along the shortest arc.
 * @param {number} a @param {number} b @param {number} t @returns {number}
 */
export function lerpAngle(a, b, t) {
  return a + wrapAngle(b - a) * t;
}

/**
 * dampAngle(current, target, lambda, dt) → exponential approach along the shortest arc.
 * @param {number} current @param {number} target @param {number} lambda @param {number} dt
 * @returns {number}
 */
export function dampAngle(current, target, lambda, dt) {
  return current + wrapAngle(target - current) * (1 - Math.exp(-lambda * dt));
}

/**
 * moveTowardsAngle(current, target, maxDelta) → rotate by at most maxDelta along the shortest arc.
 * @param {number} current @param {number} target @param {number} maxDelta @returns {number}
 */
export function moveTowardsAngle(current, target, maxDelta) {
  const d = wrapAngle(target - current);
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/**
 * yawToDir(yaw, out) → out = (sin yaw, 0, cos yaw).
 * @param {number} yaw @param {Vector3} out @returns {Vector3}
 */
export function yawToDir(yaw, out) {
  out.x = Math.sin(yaw);
  out.y = 0;
  out.z = Math.cos(yaw);
  return out;
}

/**
 * dirToYaw(x, z) → yaw whose forward vector points along (x, 0, z).
 * @param {number} x @param {number} z @returns {number}
 */
export function dirToYaw(x, z) {
  return Math.atan2(x, z);
}

/**
 * yawBetween(ax, az, bx, bz) → yaw looking from a towards b.
 * @param {number} ax @param {number} az @param {number} bx @param {number} bz @returns {number}
 */
export function yawBetween(ax, az, bx, bz) {
  return Math.atan2(bx - ax, bz - az);
}

// ------------------------------------------------------------------------------------------------
// Distances
// ------------------------------------------------------------------------------------------------

/**
 * dist2D(ax, az, bx, bz) → planar distance.
 * @param {number} ax @param {number} az @param {number} bx @param {number} bz @returns {number}
 */
export function dist2D(ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * distSq2D(ax, az, bx, bz) → squared planar distance.
 * @param {number} ax @param {number} az @param {number} bx @param {number} bz @returns {number}
 */
export function distSq2D(ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  return dx * dx + dz * dz;
}

/**
 * distXZ(a, b) → planar distance between two {x, z} points.
 * @param {{x:number, z:number}} a @param {{x:number, z:number}} b @returns {number}
 */
export function distXZ(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * pointSegDistSq2D(px, pz, ax, az, bx, bz) → squared distance from p to segment ab.
 * @returns {number}
 */
export function pointSegDistSq2D(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const len = abx * abx + abz * abz;
  let t = len > 0 ? ((px - ax) * abx + (pz - az) * abz) / len : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = ax + abx * t - px;
  const dz = az + abz * t - pz;
  return dx * dx + dz * dz;
}

// ------------------------------------------------------------------------------------------------
// Easing
// ------------------------------------------------------------------------------------------------

/**
 * easeOutCubic(t) → 0..1.
 * @param {number} t @returns {number}
 */
export function easeOutCubic(t) {
  const u = 1 - (t < 0 ? 0 : t > 1 ? 1 : t);
  return 1 - u * u * u;
}

/**
 * easeInOutCubic(t) → 0..1.
 * @param {number} t @returns {number}
 */
export function easeInOutCubic(t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * easeOutBack(t) → 0..1 with a small overshoot.
 * @param {number} t @returns {number}
 */
export function easeOutBack(t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const c1 = 1.70158;
  const u = t - 1;
  return 1 + (c1 + 1) * u * u * u + c1 * u * u;
}

// ------------------------------------------------------------------------------------------------
// Temp pools (ring buffers)
// ------------------------------------------------------------------------------------------------

function makePool(Ctor, size) {
  const items = new Array(size);
  for (let i = 0; i < size; i++) items[i] = new Ctor();
  return { items, i: 0, mask: size - 1 };
}

const poolV2 = makePool(Vector2, 16);
const poolV3 = makePool(Vector3, 64);
const poolQ = makePool(Quaternion, 32);
const poolM4 = makePool(Matrix4, 16);
const poolE = makePool(Euler, 8);
const poolC = makePool(Color, 16);
const poolB3 = makePool(Box3, 8);
const poolS = makePool(Sphere, 8);

/**
 * tmpVec3(x=0, y=0, z=0) → scratch Vector3 (ring of 64; do not store).
 * @param {number} [x] @param {number} [y] @param {number} [z] @returns {Vector3}
 */
export function tmpVec3(x = 0, y = 0, z = 0) {
  const v = poolV3.items[(poolV3.i = (poolV3.i + 1) & poolV3.mask)];
  v.x = x;
  v.y = y;
  v.z = z;
  return v;
}

/**
 * tmpVec2(x=0, y=0) → scratch Vector2 (ring of 16; do not store).
 * @param {number} [x] @param {number} [y] @returns {Vector2}
 */
export function tmpVec2(x = 0, y = 0) {
  const v = poolV2.items[(poolV2.i = (poolV2.i + 1) & poolV2.mask)];
  v.x = x;
  v.y = y;
  return v;
}

/**
 * tmpQuat() → scratch Quaternion set to identity (ring of 32; do not store).
 * @returns {Quaternion}
 */
export function tmpQuat() {
  const q = poolQ.items[(poolQ.i = (poolQ.i + 1) & poolQ.mask)];
  q.x = 0;
  q.y = 0;
  q.z = 0;
  q.w = 1;
  return q;
}

/**
 * tmpMat4() → scratch Matrix4 (ring of 16; contents undefined; do not store).
 * @returns {Matrix4}
 */
export function tmpMat4() {
  return poolM4.items[(poolM4.i = (poolM4.i + 1) & poolM4.mask)];
}

/**
 * tmpEuler(x=0, y=0, z=0, order='YXZ') → scratch Euler (ring of 8; do not store).
 * @param {number} [x] @param {number} [y] @param {number} [z] @param {string} [order] @returns {Euler}
 */
export function tmpEuler(x = 0, y = 0, z = 0, order = 'YXZ') {
  const e = poolE.items[(poolE.i = (poolE.i + 1) & poolE.mask)];
  e.set(x, y, z, order);
  return e;
}

/**
 * tmpColor(hex=0xffffff) → scratch Color (ring of 16; do not store).
 * @param {number|string} [hex] @returns {Color}
 */
export function tmpColor(hex = 0xffffff) {
  const c = poolC.items[(poolC.i = (poolC.i + 1) & poolC.mask)];
  c.set(hex);
  return c;
}

/**
 * tmpBox3() → scratch Box3 made empty (ring of 8; do not store).
 * @returns {Box3}
 */
export function tmpBox3() {
  return poolB3.items[(poolB3.i = (poolB3.i + 1) & poolB3.mask)].makeEmpty();
}

/**
 * tmpSphere() → scratch Sphere (ring of 8; do not store).
 * @returns {Sphere}
 */
export function tmpSphere() {
  return poolS.items[(poolS.i = (poolS.i + 1) & poolS.mask)];
}

// ------------------------------------------------------------------------------------------------
// Vector / quaternion helpers
// ------------------------------------------------------------------------------------------------

/**
 * dampVec3(current, target, lambda, dt) → current (mutated) exponentially approaching target.
 * @param {Vector3} current @param {{x:number,y:number,z:number}} target @param {number} lambda @param {number} dt
 * @returns {Vector3}
 */
export function dampVec3(current, target, lambda, dt) {
  const t = 1 - Math.exp(-lambda * dt);
  current.x += (target.x - current.x) * t;
  current.y += (target.y - current.y) * t;
  current.z += (target.z - current.z) * t;
  return current;
}

/**
 * yawQuat(yaw, out) → out quaternion for a rotation of `yaw` about +Y.
 * @param {number} yaw @param {Quaternion} out @returns {Quaternion}
 */
export function yawQuat(yaw, out) {
  const h = yaw * 0.5;
  out.x = 0;
  out.y = Math.sin(h);
  out.z = 0;
  out.w = Math.cos(h);
  return out;
}

/**
 * quatYaw(q) → yaw (rotation about +Y) of a quaternion's forward (+Z) axis.
 * @param {{x:number,y:number,z:number,w:number}} q @returns {number}
 */
export function quatYaw(q) {
  // forward = q * (0,0,1)
  const fx = 2 * (q.x * q.z + q.w * q.y);
  const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
  return Math.atan2(fx, fz);
}

/**
 * formatYen(n) → "¥12,345" (Japanese digit grouping).
 * @param {number} n @returns {string}
 */
export function formatYen(n) {
  const v = Math.round(n || 0);
  const s = Math.abs(v).toString();
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return (v < 0 ? '-¥' : '¥') + out;
}
