// MUGEN CITY — entity registry + spatial hash (G.entities, ARCHITECTURE §3.6).
//
// An entity is any duck-typed object with { type, pos (THREE.Vector3, live), radius, alive }.
// The registry assigns `e.id`, keeps per-type sets and a 32 m spatial hash that is re-synced
// every fixed tick for entities whose `dynamic !== false`.

import { Vector3 } from 'three';
import { registerSystem, reportError } from './game.js';
import { CONFIG } from './config.js';

const CELL = CONFIG.ENTITY_CELL;
const INV_CELL = 1 / CELL;
const OFFSET = 4096; // supports ±131 km
const LARGE_RADIUS = 48; // entities bigger than this are kept in a linear list

/** @type {Map<number, any[]>} */
const cells = new Map();
const all = [];
const large = [];
const dynamic = [];
/** @type {Map<string, Set<any>>} */
const types = new Map();
/** @type {Map<number, any>} */
const byId = new Map();
let nextId = 1;
let maxRadius = 0.5;
const scratch = [];
const rayHit = { entity: null, distance: 0 };

function cellKey(x, z) {
  return (Math.floor(x * INV_CELL) + OFFSET) * 8192 + (Math.floor(z * INV_CELL) + OFFSET);
}

function cellInsert(e, key) {
  let bucket = cells.get(key);
  if (!bucket) {
    bucket = [];
    cells.set(key, bucket);
  }
  e._cell = key;
  e._ci = bucket.length;
  bucket.push(e);
}

function cellRemove(e) {
  const bucket = cells.get(e._cell);
  if (bucket) {
    const last = bucket.pop();
    if (last !== e) {
      bucket[e._ci] = last;
      last._ci = e._ci;
    }
    if (bucket.length === 0) cells.delete(e._cell);
  }
  e._cell = -1;
  e._ci = -1;
}

function swapRemove(list, e, field) {
  const idx = e[field];
  if (idx < 0 || list[idx] !== e) return;
  const last = list.pop();
  if (last !== e) {
    list[idx] = last;
    last[field] = idx;
  }
  e[field] = -1;
}

function matches(e, filter) {
  if (filter === undefined || filter === null) return true;
  if (typeof filter === 'string') return e.type === filter;
  if (typeof filter === 'function') return filter(e) === true;
  if (Array.isArray(filter)) return filter.indexOf(e.type) >= 0;
  return true;
}

export const entities = registerSystem({
  name: 'entities',
  order: 14,

  /** every registered entity (array; do not mutate; removal during iteration may skip one item) */
  all,
  /** spatial hash cell size in meters */
  cellSize: CELL,

  /** count → number of registered entities. */
  get count() {
    return all.length;
  },

  /**
   * add(e) → e. Registers an entity and assigns `e.id` (stable, unique for the session).
   * Missing `alive` defaults to true, missing `radius` to 0.5. Set `e.dynamic = false` for
   * entities that never move (they are hashed once).
   * @template T
   * @param {T & {type: string, pos: Vector3, radius?: number}} e
   * @returns {T}
   */
  add(e) {
    if (!e || typeof e !== 'object') {
      reportError(new Error('entities.add: entity must be an object'), 'entities', 'add');
      return e;
    }
    if (e._ai !== undefined && e._ai >= 0 && all[e._ai] === e) return e;
    if (!e.pos || typeof e.pos.x !== 'number') {
      reportError(new Error('entities.add: entity needs a live `pos` Vector3 (type ' + e.type + ')'), 'entities', 'add');
      e.pos = new Vector3();
    }
    if (e.alive === undefined) e.alive = true;
    if (!(e.radius >= 0)) e.radius = 0.5;
    if (e.type === undefined) e.type = 'prop';
    e.id = nextId++;
    byId.set(e.id, e);
    e._ai = all.length;
    all.push(e);
    let set = types.get(e.type);
    if (!set) {
      set = new Set();
      types.set(e.type, set);
    }
    set.add(e);
    e._type = e.type;
    e._li = -1;
    e._di = -1;
    e._cell = -1;
    e._ci = -1;
    if (e.radius > LARGE_RADIUS) {
      e._li = large.length;
      large.push(e);
    } else {
      if (e.radius > maxRadius) maxRadius = e.radius;
      cellInsert(e, cellKey(e.pos.x, e.pos.z));
      if (e.dynamic !== false) {
        e._di = dynamic.length;
        dynamic.push(e);
      }
    }
    return e;
  },

  /**
   * remove(e) → true when the entity was registered. Idempotent.
   * @param {any} e
   * @returns {boolean}
   */
  remove(e) {
    if (!e || e._ai === undefined || e._ai < 0 || all[e._ai] !== e) return false;
    swapRemove(all, e, '_ai');
    byId.delete(e.id);
    const set = types.get(e._type);
    if (set) set.delete(e);
    if (e._li >= 0) swapRemove(large, e, '_li');
    if (e._di >= 0) swapRemove(dynamic, e, '_di');
    if (e._cell >= 0) cellRemove(e);
    return true;
  },

  /**
   * has(e) → true while the entity is registered.
   * @param {any} e
   * @returns {boolean}
   */
  has(e) {
    return !!e && e._ai !== undefined && e._ai >= 0 && all[e._ai] === e;
  },

  /**
   * get(id) → entity with that id, or null.
   * @param {number} id
   * @returns {any}
   */
  get(id) {
    return byId.get(id) || null;
  },

  /**
   * byType(type) → live Set of entities of that type (never null; do not mutate).
   * @param {string} type
   * @returns {Set<any>}
   */
  byType(type) {
    let set = types.get(type);
    if (!set) {
      set = new Set();
      types.set(type, set);
    }
    return set;
  },

  /**
   * query(pos, radius, typeOrFilter?, out?) → array of entities whose bounding sphere touches
   * the query sphere (|e.pos - pos| ≤ radius + e.radius, 3D). `typeOrFilter` is a type string,
   * an array of types or a predicate `(e) => boolean`. Pass `out` to avoid allocating
   * (it is cleared first); without it a new array is returned.
   * @param {{x:number,y:number,z:number}} pos
   * @param {number} radius
   * @param {string|string[]|((e:any)=>boolean)|null} [typeOrFilter]
   * @param {any[]} [out]
   * @returns {any[]}
   */
  query(pos, radius, typeOrFilter, out) {
    if (!out) out = [];
    else out.length = 0;
    const px = pos.x;
    const py = pos.y;
    const pz = pos.z;
    const reach = radius + maxRadius;
    const x0 = Math.floor((px - reach) * INV_CELL) + OFFSET;
    const x1 = Math.floor((px + reach) * INV_CELL) + OFFSET;
    const z0 = Math.floor((pz - reach) * INV_CELL) + OFFSET;
    const z1 = Math.floor((pz + reach) * INV_CELL) + OFFSET;
    const cellCount = (x1 - x0 + 1) * (z1 - z0 + 1);
    if (cellCount > all.length + 16) {
      // huge radius: a linear scan is cheaper than visiting every cell
      for (let i = 0; i < all.length; i++) {
        const e = all[i];
        if (e._li >= 0) continue;
        const dx = e.pos.x - px;
        const dy = e.pos.y - py;
        const dz = e.pos.z - pz;
        const rr = radius + e.radius;
        if (dx * dx + dy * dy + dz * dz <= rr * rr && matches(e, typeOrFilter)) out.push(e);
      }
    } else {
      for (let cx = x0; cx <= x1; cx++) {
        const base = cx * 8192;
        for (let cz = z0; cz <= z1; cz++) {
          const bucket = cells.get(base + cz);
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i++) {
            const e = bucket[i];
            const dx = e.pos.x - px;
            const dy = e.pos.y - py;
            const dz = e.pos.z - pz;
            const rr = radius + e.radius;
            if (dx * dx + dy * dy + dz * dz <= rr * rr && matches(e, typeOrFilter)) out.push(e);
          }
        }
      }
    }
    for (let i = 0; i < large.length; i++) {
      const e = large[i];
      const dx = e.pos.x - px;
      const dy = e.pos.y - py;
      const dz = e.pos.z - pz;
      const rr = radius + e.radius;
      if (dx * dx + dy * dy + dz * dz <= rr * rr && matches(e, typeOrFilter)) out.push(e);
    }
    return out;
  },

  /**
   * nearest(pos, radius, typeOrFilter?) → entity with the closest center inside the query
   * sphere, or null.
   * @param {{x:number,y:number,z:number}} pos
   * @param {number} radius
   * @param {string|string[]|((e:any)=>boolean)|null} [typeOrFilter]
   * @returns {any}
   */
  nearest(pos, radius, typeOrFilter) {
    this.query(pos, radius, typeOrFilter, scratch);
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < scratch.length; i++) {
      const e = scratch[i];
      const dx = e.pos.x - pos.x;
      const dy = e.pos.y - pos.y;
      const dz = e.pos.z - pos.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    scratch.length = 0;
    return best;
  },

  /**
   * raycast(origin, dir, maxDist, typeOrFilter?, maxRadius=Infinity) → {entity, distance} | null.
   * Ray vs. entity bounding spheres (radius clamped to `maxRadius`); `dir` must be normalized.
   * The returned object is reused by the next call.
   * @param {{x:number,y:number,z:number}} origin
   * @param {{x:number,y:number,z:number}} dir
   * @param {number} maxDist
   * @param {string|string[]|((e:any)=>boolean)|null} [typeOrFilter]
   * @param {number} [maxRadiusClamp]
   * @returns {{entity:any, distance:number}|null}
   */
  raycast(origin, dir, maxDist, typeOrFilter, maxRadiusClamp = Infinity) {
    const half = maxDist * 0.5;
    mid.x = origin.x + dir.x * half;
    mid.y = origin.y + dir.y * half;
    mid.z = origin.z + dir.z * half;
    this.query(mid, half, typeOrFilter, scratch);
    let best = null;
    let bestT = maxDist;
    for (let i = 0; i < scratch.length; i++) {
      const e = scratch[i];
      const r = e.radius < maxRadiusClamp ? e.radius : maxRadiusClamp;
      const ox = e.pos.x - origin.x;
      const oy = e.pos.y - origin.y;
      const oz = e.pos.z - origin.z;
      const tca = ox * dir.x + oy * dir.y + oz * dir.z;
      if (tca < 0) continue;
      const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
      if (d2 > r * r) continue;
      const t = tca - Math.sqrt(r * r - d2);
      const tt = t < 0 ? 0 : t;
      if (tt < bestT) {
        bestT = tt;
        best = e;
      }
    }
    scratch.length = 0;
    if (!best) return null;
    rayHit.entity = best;
    rayHit.distance = bestT;
    return rayHit;
  },

  /**
   * rehash() — re-syncs the spatial hash with entity positions (and type changes).
   * Called by the core after every fixed tick.
   */
  rehash() {
    for (let i = 0; i < dynamic.length; i++) {
      const e = dynamic[i];
      const key = cellKey(e.pos.x, e.pos.z);
      if (key !== e._cell && key === key) {
        cellRemove(e);
        cellInsert(e, key);
      }
      if (e.type !== e._type) retype(e);
    }
  },

  /**
   * update(e) — re-hashes a single entity immediately (after teleporting a `dynamic: false`
   * entity or changing its type/radius).
   * @param {any} e
   */
  update(e) {
    if (!this.has(e)) return;
    if (e.type !== e._type) retype(e);
    if (e._li >= 0) return;
    if (e.radius > maxRadius) maxRadius = Math.min(e.radius, LARGE_RADIUS);
    const key = cellKey(e.pos.x, e.pos.z);
    if (key !== e._cell && key === key) {
      cellRemove(e);
      cellInsert(e, key);
    }
  },

  /**
   * clear() — removes every entity (new game / tests).
   */
  clear() {
    for (let i = all.length - 1; i >= 0; i--) this.remove(all[i]);
  },
});

const mid = { x: 0, y: 0, z: 0 };

function retype(e) {
  const old = types.get(e._type);
  if (old) old.delete(e);
  let set = types.get(e.type);
  if (!set) {
    set = new Set();
    types.set(e.type, set);
  }
  set.add(e);
  e._type = e.type;
}

export default entities;
