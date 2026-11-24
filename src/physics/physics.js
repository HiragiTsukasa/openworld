// MUGEN CITY — Rapier wrapper (G.physics, ARCHITECTURE §6).
//
// Notes for users:
// * Rapier's scene queries only see colliders after the next world step. This wrapper also tests
//   colliders created since the last step, so `addStatic(...)` followed by `raycast(...)` in the
//   same tick works. Bodies teleported with setTranslation are seen at their new place after the
//   next step.
// * Query results (`raycast`, `spherecast`) come from a ring of 16 reusable hit objects:
//   copy what you need if you keep it longer than the current function.
// * `dir` arguments are normalized internally; `distance` is always in meters.

import * as RAPIER_NS from '@dimforge/rapier3d-compat';
import { Vector3, Quaternion } from 'three';
import { G, registerSystem, reportError } from '../core/game.js';
import { CONFIG } from '../core/config.js';

const RAPIER = RAPIER_NS.default && RAPIER_NS.default.World ? RAPIER_NS.default : RAPIER_NS;

let rapierReady = null;

/**
 * loadRapier() → Promise<RAPIER>. Initialises the WASM module once (idempotent).
 * Awaited by the boot sequence before any system is initialised.
 * @returns {Promise<any>}
 */
export function loadRapier() {
  if (!rapierReady) rapierReady = RAPIER.init().then(() => RAPIER);
  return rapierReady;
}

// ------------------------------------------------------------------------------------------------
// Collision groups
// ------------------------------------------------------------------------------------------------

const GROUPS = {
  TERRAIN: 0x0001,
  STATIC: 0x0002,
  VEHICLE: 0x0004,
  CHARACTER: 0x0008,
  PROP: 0x0010,
  DEBRIS: 0x0020,
  PROJECTILE: 0x0040,
  SENSOR: 0x0080,
  RAGDOLL: 0x0100,
  PLAYER: 0x0200,
};
const ALL = 0xffff;
const QUERY_ONLY = 0x8000; // reserved bit no collider is a member of

function bits(list) {
  if (typeof list === 'number') return list & ALL;
  let b = 0;
  if (Array.isArray(list)) for (let i = 0; i < list.length; i++) b |= list[i];
  return b & ALL;
}

function makeMask(memberships, filter) {
  return ((bits(memberships) << 16) | bits(filter)) >>> 0;
}

const g = GROUPS;
/** Default interaction groups per GROUPS key (collision table of ARCHITECTURE §6). */
const MASKS = {
  TERRAIN: makeMask(g.TERRAIN, ALL),
  STATIC: makeMask(g.STATIC, ALL),
  VEHICLE: makeMask(g.VEHICLE, g.TERRAIN | g.STATIC | g.VEHICLE | g.CHARACTER | g.PLAYER | g.PROP | g.DEBRIS | g.RAGDOLL | g.SENSOR),
  CHARACTER: makeMask(g.CHARACTER, g.TERRAIN | g.STATIC | g.VEHICLE | g.PROP | g.SENSOR),
  PLAYER: makeMask(g.PLAYER, g.TERRAIN | g.STATIC | g.VEHICLE | g.PROP | g.SENSOR),
  PROP: makeMask(g.PROP, g.TERRAIN | g.STATIC | g.VEHICLE | g.CHARACTER | g.PLAYER | g.PROP | g.RAGDOLL | g.SENSOR),
  DEBRIS: makeMask(g.DEBRIS, g.TERRAIN | g.STATIC | g.VEHICLE),
  RAGDOLL: makeMask(g.RAGDOLL, g.TERRAIN | g.STATIC | g.VEHICLE | g.PROP),
  PROJECTILE: makeMask(g.PROJECTILE, QUERY_ONLY),
  SENSOR: makeMask(g.SENSOR, g.VEHICLE | g.CHARACTER | g.PLAYER | g.PROP),
};
const MASK_BY_BIT = new Map();
for (const key in GROUPS) MASK_BY_BIT.set(GROUPS[key], MASKS[key]);

const DEFAULT_QUERY_BITS = g.TERRAIN | g.STATIC | g.VEHICLE | g.CHARACTER | g.PROP | g.RAGDOLL | g.PLAYER;
const DEFAULT_QUERY = ((ALL << 16) | DEFAULT_QUERY_BITS) >>> 0;

/** Resolves a user supplied `groups` value for a collider into Rapier interaction groups. */
function colliderGroups(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') return MASKS[value] !== undefined ? MASKS[value] : fallback;
  if (typeof value !== 'number') return fallback;
  if (value > ALL) return value >>> 0; // already a full (memberships << 16 | filter) value
  const preset = MASK_BY_BIT.get(value);
  return preset !== undefined ? preset : makeMask(value, ALL);
}

/** Resolves a user supplied `groups` filter for a query into Rapier interaction groups. */
function queryGroups(value) {
  if (value === undefined || value === null) return DEFAULT_QUERY;
  if (Array.isArray(value)) return ((ALL << 16) | bits(value)) >>> 0;
  if (typeof value === 'string') return GROUPS[value] ? ((ALL << 16) | GROUPS[value]) >>> 0 : DEFAULT_QUERY;
  if (value > ALL) return value >>> 0;
  return ((ALL << 16) | (value & ALL)) >>> 0;
}

function groupsInteract(a, b) {
  return ((a >>> 16) & b) !== 0 && ((b >>> 16) & a) !== 0;
}

// ------------------------------------------------------------------------------------------------
// State
// ------------------------------------------------------------------------------------------------

let world = null;
let eventQueue = null;
let ray = null;
let ballShape = null;
let rayTarget = null;
let rayLocalTarget = null;
let castTarget = null;
let castLocalTarget = null;
let gravityScale = 1;
let stepMs = 0;

/** @type {Map<number, any>} collider handle → entity */
const colliderEntity = new Map();
/** @type {Map<number, {cb: Function, minImpulse: number}>} collider handle → contact callback */
const contactCbs = new Map();
/** @type {Map<number, Function>} collider handle → trigger callback */
const triggerCbs = new Map();
/** @type {Map<number, any>} body handle → binding record */
const bindings = new Map();
const bindingList = [];
/** colliders created since the last world step (not yet visible to Rapier scene queries) */
const pending = [];

const IDENTITY_ROT = { x: 0, y: 0, z: 0, w: 1 };
const _vA = { x: 0, y: 0, z: 0 };
const _vB = { x: 0, y: 0, z: 0 };
const _vC = { x: 0, y: 0, z: 0 };
const _qA = { x: 0, y: 0, z: 0, w: 1 };
const _v3 = new Vector3();
const _q3 = new Quaternion();
const _bodySet = new Set();

const HIT_POOL = 16;
const hits = [];
for (let i = 0; i < HIT_POOL; i++) {
  hits.push({ point: new Vector3(), normal: new Vector3(), distance: 0, collider: null, body: null, entity: null });
}
let hitIndex = 0;
function nextHit() {
  hitIndex = (hitIndex + 1) & (HIT_POOL - 1);
  return hits[hitIndex];
}

// buffered events (dispatched after the event queue has been drained)
const forceEvents = { n: 0, h1: [], h2: [], mag: [], dx: [], dy: [], dz: [] };
const collisionEvents = { n: 0, h1: [], h2: [], started: [] };
const contactInfo = {
  /** impulse magnitude in N·s (sum over the contact manifold for this step) */
  impulse: 0,
  /** total contact force magnitude in N */
  force: 0,
  /** world-space contact point */
  point: new Vector3(),
  /** world-space unit normal pointing from the other collider towards this one */
  normal: new Vector3(),
  otherCollider: null,
  otherBody: null,
  /** the collider the callback was registered on */
  collider: null,
};
const triggerInfo = { entered: false, otherCollider: null, otherBody: null, collider: null };

function isBody(o) {
  return o instanceof RAPIER.RigidBody;
}

function isCollider(o) {
  return o instanceof RAPIER.Collider;
}

function setRot(target, rot) {
  if (rot === undefined || rot === null) {
    target.x = 0; target.y = 0; target.z = 0; target.w = 1;
  } else if (typeof rot === 'number') {
    const h = rot * 0.5;
    target.x = 0; target.y = Math.sin(h); target.z = 0; target.w = Math.cos(h);
  } else {
    target.x = rot.x; target.y = rot.y; target.z = rot.z; target.w = rot.w;
  }
  return target;
}

function forgetCollider(handle) {
  colliderEntity.delete(handle);
  contactCbs.delete(handle);
  triggerCbs.delete(handle);
  for (let i = pending.length - 1; i >= 0; i--) {
    if (pending[i].handle === handle) {
      pending[i] = pending[pending.length - 1];
      pending.pop();
    }
  }
}

function entityOfHandle(handle) {
  const e = colliderEntity.get(handle);
  if (e !== undefined) return e;
  const c = world.colliders.get(handle);
  if (!c) return null;
  const parent = c.parent();
  return parent && parent.userData ? parent.userData : null;
}

function fillHit(hit, collider, distance, origin, dir, nx, ny, nz) {
  hit.distance = distance;
  hit.point.set(origin.x + dir.x * distance, origin.y + dir.y * distance, origin.z + dir.z * distance);
  hit.normal.set(nx, ny, nz);
  hit.collider = collider;
  hit.body = collider.parent();
  const e = colliderEntity.get(collider.handle);
  hit.entity = e !== undefined ? e : hit.body && hit.body.userData ? hit.body.userData : null;
  return hit;
}

function pendingAllowed(c, groups, excludeSensors, opts) {
  if (!c.isValid() || !c.isEnabled()) return false;
  if (excludeSensors && c.isSensor()) return false;
  if (!groupsInteract(groups, c.collisionGroups())) return false;
  if (opts) {
    if (opts.excludeCollider && opts.excludeCollider.handle === c.handle) return false;
    if (opts.excludeBody) {
      const p = c.parent();
      if (p && p.handle === opts.excludeBody.handle) return false;
    }
    if (opts.filter && opts.filter(c, entityOfHandle(c.handle)) !== true) return false;
  }
  return true;
}

function makePredicate(opts) {
  if (!opts || typeof opts.filter !== 'function') return undefined;
  const filter = opts.filter;
  return (handle) => {
    const c = world.colliders.get(handle);
    return !!c && filter(c, entityOfHandle(handle)) === true;
  };
}

function normalizeDir(dir) {
  const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
  if (!(len > 1e-9)) return false;
  const inv = 1 / len;
  ray.dir.x = dir.x * inv;
  ray.dir.y = dir.y * inv;
  ray.dir.z = dir.z * inv;
  return true;
}

// ------------------------------------------------------------------------------------------------
// System
// ------------------------------------------------------------------------------------------------

export const physics = registerSystem({
  name: 'physics',
  order: 12,
  critical: true,
  runWhenPaused: false,

  /** the Rapier module (valid after boot) */
  RAPIER,
  /** the Rapier World (null until init) */
  world: null,
  /** collision group bits */
  GROUPS,
  /** default interaction groups per group name: MASKS.VEHICLE, MASKS.PROP, ... */
  MASKS,
  /** fixed timestep in seconds */
  dt: CONFIG.FIXED_DT,

  async init() {
    await loadRapier();
    world = new RAPIER.World({ x: 0, y: CONFIG.GRAVITY, z: 0 });
    world.timestep = CONFIG.FIXED_DT;
    eventQueue = new RAPIER.EventQueue(true);
    ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    ballShape = new RAPIER.Ball(0.5);
    rayTarget = new RAPIER.RayColliderIntersection(null, 0, { x: 0, y: 1, z: 0 });
    rayLocalTarget = new RAPIER.RayIntersection(0, { x: 0, y: 1, z: 0 });
    castTarget = new RAPIER.ColliderShapeCastHit(null, 0, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 });
    castLocalTarget = new RAPIER.ShapeCastHit(0, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 });
    this.world = world;
  },

  /**
   * mask(memberships, filter) → u32 Rapier interaction groups.
   * Both arguments are arrays of GROUPS bits (or an already OR-ed number).
   * @param {number[]|number} memberships
   * @param {number[]|number} filter
   * @returns {number}
   */
  mask(memberships, filter) {
    return makeMask(memberships, filter);
  },

  /**
   * addStatic(colliderDesc, {pos, rot, entity, groups}) → Collider. Creates a fixed collider
   * without a body. `rot` is a quaternion {x,y,z,w} or a yaw number. `groups` is a GROUPS key
   * ('STATIC'), a single GROUPS bit, or a full mask from `mask()`; default MASKS.STATIC (kept
   * as-is when the desc already has custom collision groups).
   * @param {any} colliderDesc RAPIER.ColliderDesc
   * @param {{pos?: {x:number,y:number,z:number}, rot?: {x:number,y:number,z:number,w:number}|number, entity?: any, groups?: number|string}} [opts]
   * @returns {any} RAPIER.Collider
   */
  addStatic(colliderDesc, opts) {
    const o = opts || {};
    if (o.pos) colliderDesc.setTranslation(o.pos.x, o.pos.y, o.pos.z);
    if (o.rot !== undefined && o.rot !== null) colliderDesc.setRotation(setRot(_qA, o.rot));
    if (o.groups !== undefined || colliderDesc.collisionGroups === 0xffffffff) {
      colliderDesc.setCollisionGroups(colliderGroups(o.groups, MASKS.STATIC));
    }
    const collider = world.createCollider(colliderDesc);
    pending.push(collider);
    if (o.entity) colliderEntity.set(collider.handle, o.entity);
    return collider;
  },

  /**
   * addBody({type, pos, rot, colliders, mass, linearDamping, angularDamping, ccd, canSleep,
   *          entity, groups, gravityScale, linvel, angvel, sleeping}) → RigidBody.
   * `type`: 'dynamic' | 'kinematic' (position based) | 'kinematicVelocity' | 'fixed'.
   * `colliders`: array of RAPIER.ColliderDesc attached to the body (their collision groups
   * default to `groups`, which defaults to MASKS.PROP for dynamic, MASKS.STATIC for fixed and
   * MASKS.CHARACTER for kinematic bodies). `mass` rescales the colliders' mass to that total (kg).
   * `entity` is tagged on the body (`body.userData`) and all its colliders.
   * @param {object} opts
   * @returns {any} RAPIER.RigidBody
   */
  addBody(opts) {
    const o = opts || {};
    const type = o.type || 'dynamic';
    let desc;
    if (type === 'dynamic') desc = RAPIER.RigidBodyDesc.dynamic();
    else if (type === 'kinematic') desc = RAPIER.RigidBodyDesc.kinematicPositionBased();
    else if (type === 'kinematicVelocity') desc = RAPIER.RigidBodyDesc.kinematicVelocityBased();
    else desc = RAPIER.RigidBodyDesc.fixed();
    if (o.pos) desc.setTranslation(o.pos.x, o.pos.y, o.pos.z);
    if (o.rot !== undefined && o.rot !== null) desc.setRotation(setRot(_qA, o.rot));
    if (o.linearDamping !== undefined) desc.setLinearDamping(o.linearDamping);
    if (o.angularDamping !== undefined) desc.setAngularDamping(o.angularDamping);
    if (o.ccd) desc.setCcdEnabled(true);
    if (o.canSleep === false) desc.setCanSleep(false);
    if (o.sleeping) desc.setSleeping(true);
    if (o.gravityScale !== undefined) desc.setGravityScale(o.gravityScale);
    if (o.linvel) desc.setLinvel(o.linvel.x, o.linvel.y, o.linvel.z);
    if (o.angvel) desc.setAngvel(o.angvel);
    const body = world.createRigidBody(desc);
    body.userData = o.entity || null;
    const fallback = type === 'dynamic' ? MASKS.PROP : type === 'fixed' ? MASKS.STATIC : MASKS.CHARACTER;
    const groups = colliderGroups(o.groups, fallback);
    const descs = o.colliders || [];
    for (let i = 0; i < descs.length; i++) {
      const cd = descs[i];
      if (o.groups !== undefined || cd.collisionGroups === 0xffffffff) cd.setCollisionGroups(groups);
      const c = world.createCollider(cd, body);
      pending.push(c);
      if (o.entity) colliderEntity.set(c.handle, o.entity);
    }
    if (o.mass > 0 && type === 'dynamic') this.setMass(body, o.mass);
    if (o.entity && o.entity.body === undefined) o.entity.body = body;
    return body;
  },

  /**
   * addCollider(body, colliderDesc, {entity, groups}) → Collider attached to an existing body.
   * @param {any} body RAPIER.RigidBody
   * @param {any} colliderDesc RAPIER.ColliderDesc
   * @param {{entity?: any, groups?: number|string}} [opts]
   * @returns {any}
   */
  addCollider(body, colliderDesc, opts) {
    const o = opts || {};
    if (o.groups !== undefined || colliderDesc.collisionGroups === 0xffffffff) {
      const fallback = body.isDynamic() ? MASKS.PROP : body.isFixed() ? MASKS.STATIC : MASKS.CHARACTER;
      colliderDesc.setCollisionGroups(colliderGroups(o.groups, fallback));
    }
    const c = world.createCollider(colliderDesc, body);
    pending.push(c);
    const e = o.entity || body.userData;
    if (e) colliderEntity.set(c.handle, e);
    return c;
  },

  /**
   * setMass(body, mass) — rescales the mass of every collider so the body totals `mass` kg
   * (inertia follows the collider shapes).
   * @param {any} body
   * @param {number} mass
   */
  setMass(body, mass) {
    const n = body.numColliders();
    let total = 0;
    for (let i = 0; i < n; i++) total += body.collider(i).mass();
    if (total > 1e-9) {
      const k = mass / total;
      for (let i = 0; i < n; i++) {
        const c = body.collider(i);
        const m = c.mass();
        if (m > 0) c.setMass(m * k);
      }
    } else {
      body.setAdditionalMass(mass, true);
    }
    body.recomputeMassPropertiesFromColliders();
  },

  /**
   * remove(bodyOrCollider) — removes a rigid body (with its colliders) or a single collider,
   * including its tags, contact callbacks and bindings. Safe to call twice / with null.
   * @param {any} target
   */
  remove(target) {
    if (!target || !world) return;
    try {
      if (isBody(target)) {
        if (!world.bodies.contains(target.handle)) return;
        const n = target.numColliders();
        for (let i = 0; i < n; i++) forgetCollider(target.collider(i).handle);
        this.unbind(target);
        target.userData = null;
        world.removeRigidBody(target);
      } else if (isCollider(target)) {
        if (!world.colliders.contains(target.handle)) return;
        forgetCollider(target.handle);
        world.removeCollider(target, true);
      }
    } catch (err) {
      reportError(err, 'physics', 'remove');
    }
  },

  /**
   * tag(colliderOrBody, entity) — associates an entity with a collider, or with a body and all
   * of its current colliders. Query hits and contact callbacks report it.
   * @param {any} target
   * @param {any} entity
   */
  tag(target, entity) {
    if (!target) return;
    if (isBody(target)) {
      target.userData = entity || null;
      const n = target.numColliders();
      for (let i = 0; i < n; i++) {
        if (entity) colliderEntity.set(target.collider(i).handle, entity);
        else colliderEntity.delete(target.collider(i).handle);
      }
    } else if (entity) colliderEntity.set(target.handle, entity);
    else colliderEntity.delete(target.handle);
  },

  /**
   * entityOf(colliderOrBody) → tagged entity or null.
   * @param {any} target
   * @returns {any}
   */
  entityOf(target) {
    if (!target) return null;
    if (isBody(target)) return target.userData || null;
    const e = colliderEntity.get(target.handle);
    if (e !== undefined) return e;
    const parent = target.parent ? target.parent() : null;
    return parent && parent.userData ? parent.userData : null;
  },

  /**
   * raycast(origin, dir, maxDist, {groups, excludeBody, excludeCollider, sensors, filter})
   *   → hit {point, normal, distance, collider, body, entity} | null.
   * `groups`: OR-ed GROUPS bits (or array) of what may be hit; default = everything solid
   * (TERRAIN, STATIC, VEHICLE, CHARACTER, PLAYER, PROP, RAGDOLL). `sensors: true` includes
   * sensor colliders. `filter(collider, entity) → boolean` is an optional predicate.
   * @param {{x:number,y:number,z:number}} origin
   * @param {{x:number,y:number,z:number}} dir
   * @param {number} maxDist
   * @param {object} [opts]
   * @returns {{point:Vector3, normal:Vector3, distance:number, collider:any, body:any, entity:any}|null}
   */
  raycast(origin, dir, maxDist, opts) {
    if (!world || !(maxDist > 0) || !normalizeDir(dir)) return null;
    ray.origin.x = origin.x;
    ray.origin.y = origin.y;
    ray.origin.z = origin.z;
    const groups = queryGroups(opts ? opts.groups : undefined);
    const excludeSensors = !(opts && opts.sensors);
    const flags = excludeSensors ? RAPIER.QueryFilterFlags.EXCLUDE_SENSORS : 0;
    const res = world.broadPhase.castRayAndGetNormal(
      world.narrowPhase, world.bodies, world.colliders, ray, maxDist, true, flags, groups,
      opts && opts.excludeCollider ? opts.excludeCollider.handle : null,
      opts && opts.excludeBody ? opts.excludeBody.handle : null,
      makePredicate(opts), rayTarget
    );
    let bestDist = maxDist;
    let bestCollider = null;
    let nx = 0;
    let ny = 1;
    let nz = 0;
    if (res && res.collider) {
      bestDist = res.timeOfImpact;
      bestCollider = res.collider;
      nx = res.normal.x; ny = res.normal.y; nz = res.normal.z;
    }
    for (let i = 0; i < pending.length; i++) {
      const c = pending[i];
      if (!pendingAllowed(c, groups, excludeSensors, opts)) continue;
      const r = c.castRayAndGetNormal(ray, bestDist, true, rayLocalTarget);
      if (r && r.timeOfImpact < bestDist) {
        bestDist = r.timeOfImpact;
        bestCollider = c;
        nx = r.normal.x; ny = r.normal.y; nz = r.normal.z;
      }
    }
    if (!bestCollider) return null;
    return fillHit(nextHit(), bestCollider, bestDist, origin, ray.dir, nx, ny, nz);
  },

  /**
   * spherecast(origin, dir, radius, maxDist, opts) → hit | null. Sweeps a sphere; `hit.point`
   * is the contact point on the hit collider, `hit.distance` the distance travelled by the
   * sphere centre. Same options as `raycast`.
   * @param {{x:number,y:number,z:number}} origin
   * @param {{x:number,y:number,z:number}} dir
   * @param {number} radius
   * @param {number} maxDist
   * @param {object} [opts]
   * @returns {{point:Vector3, normal:Vector3, distance:number, collider:any, body:any, entity:any}|null}
   */
  spherecast(origin, dir, radius, maxDist, opts) {
    if (!world || !(maxDist > 0) || !normalizeDir(dir)) return null;
    _vA.x = origin.x; _vA.y = origin.y; _vA.z = origin.z;
    ballShape.radius = radius;
    const groups = queryGroups(opts ? opts.groups : undefined);
    const excludeSensors = !(opts && opts.sensors);
    const flags = excludeSensors ? RAPIER.QueryFilterFlags.EXCLUDE_SENSORS : 0;
    const res = world.broadPhase.castShape(
      world.narrowPhase, world.bodies, world.colliders, _vA, IDENTITY_ROT, ray.dir, ballShape, 0, maxDist, true, flags, groups,
      opts && opts.excludeCollider ? opts.excludeCollider.handle : null,
      opts && opts.excludeBody ? opts.excludeBody.handle : null,
      makePredicate(opts), castTarget
    );
    let bestDist = maxDist;
    let bestCollider = null;
    let px = 0, py = 0, pz = 0, nx = 0, ny = 1, nz = 0;
    if (res && res.collider) {
      bestDist = res.time_of_impact;
      bestCollider = res.collider;
      px = res.witness1.x; py = res.witness1.y; pz = res.witness1.z;
      nx = res.normal1.x; ny = res.normal1.y; nz = res.normal1.z;
    }
    for (let i = 0; i < pending.length; i++) {
      const c = pending[i];
      if (!pendingAllowed(c, groups, excludeSensors, opts)) continue;
      _vB.x = 0; _vB.y = 0; _vB.z = 0;
      const r = c.castShape(_vB, ballShape, _vA, IDENTITY_ROT, ray.dir, 0, bestDist, true, castLocalTarget);
      if (r && r.time_of_impact < bestDist) {
        bestDist = r.time_of_impact;
        bestCollider = c;
        // witness / normal are in the collider's local space
        c.rotation(_qA);
        c.translation(_vC);
        _q3.set(_qA.x, _qA.y, _qA.z, _qA.w);
        _v3.set(r.witness1.x, r.witness1.y, r.witness1.z).applyQuaternion(_q3);
        px = _v3.x + _vC.x; py = _v3.y + _vC.y; pz = _v3.z + _vC.z;
        _v3.set(r.normal1.x, r.normal1.y, r.normal1.z).applyQuaternion(_q3);
        nx = _v3.x; ny = _v3.y; nz = _v3.z;
      }
    }
    if (!bestCollider) return null;
    const hit = fillHit(nextHit(), bestCollider, bestDist, origin, ray.dir, nx, ny, nz);
    hit.point.set(px, py, pz);
    return hit;
  },

  /**
   * overlapSphere(pos, radius, cb(collider, entity), opts) → number of colliders visited.
   * Calls `cb` for every collider touching the sphere; return `false` from `cb` to stop early.
   * Options: {groups, excludeBody, excludeCollider, sensors, filter} as in `raycast`
   * (`sensors: true` to include triggers).
   * @param {{x:number,y:number,z:number}} pos
   * @param {number} radius
   * @param {(collider:any, entity:any) => (boolean|void)} cb
   * @param {object} [opts]
   * @returns {number}
   */
  overlapSphere(pos, radius, cb, opts) {
    if (!world) return 0;
    _vA.x = pos.x; _vA.y = pos.y; _vA.z = pos.z;
    ballShape.radius = radius;
    const groups = queryGroups(opts ? opts.groups : undefined);
    const excludeSensors = !(opts && opts.sensors);
    const flags = excludeSensors ? RAPIER.QueryFilterFlags.EXCLUDE_SENSORS : 0;
    let count = 0;
    let stopped = false;
    world.broadPhase.intersectionsWithShape(
      world.narrowPhase, world.bodies, world.colliders, _vA, IDENTITY_ROT, ballShape,
      (handle) => {
        const c = world.colliders.get(handle);
        if (!c) return true;
        count++;
        if (cb(c, entityOfHandle(handle)) === false) {
          stopped = true;
          return false;
        }
        return true;
      },
      flags, groups,
      opts && opts.excludeCollider ? opts.excludeCollider.handle : null,
      opts && opts.excludeBody ? opts.excludeBody.handle : null,
      makePredicate(opts)
    );
    if (!stopped) {
      for (let i = 0; i < pending.length; i++) {
        const c = pending[i];
        if (!pendingAllowed(c, groups, excludeSensors, opts)) continue;
        if (!c.intersectsShape(ballShape, _vA, IDENTITY_ROT)) continue;
        count++;
        if (cb(c, entityOfHandle(c.handle)) === false) break;
      }
    }
    return count;
  },

  /**
   * applyExplosion(pos, radius, impulse, cb?) → number of bodies pushed. Applies a radial
   * impulse (N·s at the centre, linear falloff to 0 at `radius`, velocity change capped at
   * 30 m/s) to every dynamic body in range. Optional `cb(body, entity, falloff)` per body.
   * @param {{x:number,y:number,z:number}} pos
   * @param {number} radius
   * @param {number} impulse
   * @param {(body:any, entity:any, falloff:number) => void} [cb]
   * @returns {number}
   */
  applyExplosion(pos, radius, impulse, cb) {
    if (!world || !(radius > 0)) return 0;
    _bodySet.clear();
    this.overlapSphere(
      pos, radius,
      (collider) => {
        const body = collider.parent();
        if (body && body.isDynamic()) _bodySet.add(body.handle);
      },
      EXPLOSION_QUERY
    );
    let n = 0;
    for (const handle of _bodySet) {
      const body = world.bodies.get(handle);
      if (!body) continue;
      const mass = body.mass();
      if (!(mass > 0)) continue;
      body.worldCom(_vB);
      let dx = _vB.x - pos.x;
      let dy = _vB.y - pos.y;
      let dz = _vB.z - pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const falloff = Math.max(0.05, 1 - dist / radius);
      if (dist > 1e-4) {
        dx /= dist; dy /= dist; dz /= dist;
      } else {
        dx = 0; dy = 1; dz = 0;
      }
      dy += 0.35; // explosions lift things
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);
      const dv = Math.min((impulse * falloff) / mass, 30);
      const j = dv * mass * inv;
      _vC.x = dx * j; _vC.y = dy * j; _vC.z = dz * j;
      _vB.y -= 0.12; // push slightly below the centre of mass → tumbling
      body.applyImpulseAtPoint(_vC, _vB, true);
      n++;
      if (cb) cb(body, body.userData || null, falloff);
    }
    _bodySet.clear();
    return n;
  },

  /**
   * onContact(bodyOrCollider, cb(otherEntity, info), {minImpulse}) → unsubscribe().
   * Contact callbacks via contact-force events: `info = {impulse (N·s), force (N), point,
   * normal (towards this collider), otherCollider, otherBody, collider}` — `info` is reused,
   * copy vectors you keep. Fires on every step in which the contact impulse on the pair is at
   * least `minImpulse` (default: 0.5 × body mass for dynamic bodies, 40 otherwise), so resting
   * contacts stay silent. Covers the colliders the body has at call time.
   * @param {any} target RAPIER.RigidBody or Collider
   * @param {(otherEntity:any, info:object) => void} cb
   * @param {{minImpulse?: number}} [opts]
   * @returns {() => void}
   */
  onContact(target, cb, opts) {
    if (!target || typeof cb !== 'function') return () => {};
    const handles = [];
    const body = isBody(target) ? target : target.parent ? target.parent() : null;
    let minImpulse = opts && opts.minImpulse >= 0 ? opts.minImpulse : -1;
    if (minImpulse < 0) minImpulse = body && body.isDynamic() ? Math.max(1, body.mass() * 0.5) : 40;
    const add = (c) => {
      c.setActiveEvents(c.activeEvents() | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
      c.setContactForceEventThreshold(minImpulse / CONFIG.FIXED_DT);
      contactCbs.set(c.handle, { cb, minImpulse });
      handles.push(c.handle);
    };
    if (isBody(target)) {
      const n = target.numColliders();
      for (let i = 0; i < n; i++) add(target.collider(i));
    } else add(target);
    return () => {
      for (let i = 0; i < handles.length; i++) {
        const rec = contactCbs.get(handles[i]);
        if (rec && rec.cb === cb) contactCbs.delete(handles[i]);
      }
    };
  },

  /**
   * onTrigger(bodyOrCollider, cb(otherEntity, info)) → unsubscribe(). Enter / leave events for
   * sensor colliders (or any collider pair with collision events): `info = {entered,
   * otherCollider, otherBody, collider}` (reused object).
   * @param {any} target RAPIER.RigidBody or Collider
   * @param {(otherEntity:any, info:object) => void} cb
   * @returns {() => void}
   */
  onTrigger(target, cb) {
    if (!target || typeof cb !== 'function') return () => {};
    const handles = [];
    const add = (c) => {
      c.setActiveEvents(c.activeEvents() | RAPIER.ActiveEvents.COLLISION_EVENTS);
      // triggers must also see kinematic characters and fixed bodies
      c.setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL & ~RAPIER.ActiveCollisionTypes.FIXED_FIXED);
      triggerCbs.set(c.handle, cb);
      handles.push(c.handle);
    };
    if (isBody(target)) {
      const n = target.numColliders();
      for (let i = 0; i < n; i++) add(target.collider(i));
    } else add(target);
    return () => {
      for (let i = 0; i < handles.length; i++) {
        if (triggerCbs.get(handles[i]) === cb) triggerCbs.delete(handles[i]);
      }
    };
  },

  /**
   * bind(body, object3d, {interpolate=true}) — keeps `object3d.position/quaternion` in sync with
   * the body every rendered frame (interpolated between fixed ticks unless `interpolate:false`).
   * Sleeping bodies cost nothing. Teleports (> 5 m in one tick) snap instead of smearing.
   * @param {any} body RAPIER.RigidBody
   * @param {import('three').Object3D} object3d
   * @param {{interpolate?: boolean}} [opts]
   */
  bind(body, object3d, opts) {
    if (!body || !object3d) return;
    this.unbind(body);
    const t = body.translation(_vA);
    const r = body.rotation(_qA);
    const rec = {
      body,
      obj: object3d,
      interpolate: !(opts && opts.interpolate === false),
      px: t.x, py: t.y, pz: t.z, pqx: r.x, pqy: r.y, pqz: r.z, pqw: r.w,
      cx: t.x, cy: t.y, cz: t.z, cqx: r.x, cqy: r.y, cqz: r.z, cqw: r.w,
      settled: false,
      index: bindingList.length,
    };
    bindings.set(body.handle, rec);
    bindingList.push(rec);
    object3d.position.set(t.x, t.y, t.z);
    object3d.quaternion.set(r.x, r.y, r.z, r.w);
  },

  /**
   * unbind(body) — stops syncing the object bound to `body`.
   * @param {any} body
   */
  unbind(body) {
    if (!body) return;
    const rec = bindings.get(body.handle);
    if (!rec) return;
    bindings.delete(body.handle);
    const last = bindingList.pop();
    if (last !== rec) {
      bindingList[rec.index] = last;
      last.index = rec.index;
    }
  },

  /**
   * syncBinding(body) — snaps the bound object to the body's current transform right now
   * (call after teleporting a bound body to avoid one interpolated frame).
   * @param {any} body
   */
  syncBinding(body) {
    const rec = body ? bindings.get(body.handle) : null;
    if (!rec) return;
    const t = body.translation(_vA);
    const r = body.rotation(_qA);
    rec.px = rec.cx = t.x; rec.py = rec.cy = t.y; rec.pz = rec.cz = t.z;
    rec.pqx = rec.cqx = r.x; rec.pqy = rec.cqy = r.y; rec.pqz = rec.cqz = r.z; rec.pqw = rec.cqw = r.w;
    rec.obj.position.set(t.x, t.y, t.z);
    rec.obj.quaternion.set(r.x, r.y, r.z, r.w);
    rec.settled = false;
  },

  /**
   * setGravityScale(s) — scales world gravity (1 = normal, 0 = weightless) and wakes every body.
   * @param {number} s
   */
  setGravityScale(s) {
    gravityScale = Number.isFinite(s) ? s : 1;
    if (!world) return;
    world.gravity = { x: 0, y: CONFIG.GRAVITY * gravityScale, z: 0 };
    world.forEachRigidBody((b) => {
      if (b.isDynamic()) b.wakeUp();
    });
  },

  /** gravityScale → current gravity multiplier. */
  get gravityScale() {
    return gravityScale;
  },

  /**
   * step() — advances the world by one fixed tick, dispatches contact / trigger callbacks and
   * captures transforms for interpolation. Called by the core loop only.
   */
  step() {
    if (!world) return;
    const t0 = performance.now();
    // remember the previous transforms of awake bound bodies
    for (let i = bindingList.length - 1; i >= 0; i--) {
      const rec = bindingList[i];
      if (rec.settled) continue;
      rec.px = rec.cx; rec.py = rec.cy; rec.pz = rec.cz;
      rec.pqx = rec.cqx; rec.pqy = rec.cqy; rec.pqz = rec.cqz; rec.pqw = rec.cqw;
    }
    const wantEvents = contactCbs.size > 0 || triggerCbs.size > 0;
    world.step(wantEvents ? eventQueue : undefined);
    pending.length = 0;

    for (let i = bindingList.length - 1; i >= 0; i--) {
      const rec = bindingList[i];
      const body = rec.body;
      if (!body.isValid()) {
        this.unbind(body);
        continue;
      }
      if (body.isSleeping()) {
        if (rec.settled) continue;
        rec.settled = true; // one last sync below, then idle until it wakes up
      } else {
        rec.settled = false;
      }
      const t = body.translation(_vA);
      const r = body.rotation(_qA);
      rec.cx = t.x; rec.cy = t.y; rec.cz = t.z;
      rec.cqx = r.x; rec.cqy = r.y; rec.cqz = r.z; rec.cqw = r.w;
      const dx = rec.cx - rec.px;
      const dy = rec.cy - rec.py;
      const dz = rec.cz - rec.pz;
      if (rec.settled || dx * dx + dy * dy + dz * dz > 25) {
        rec.px = rec.cx; rec.py = rec.cy; rec.pz = rec.cz;
        rec.pqx = rec.cqx; rec.pqy = rec.cqy; rec.pqz = rec.cqz; rec.pqw = rec.cqw;
        rec.obj.position.set(rec.cx, rec.cy, rec.cz);
        rec.obj.quaternion.set(rec.cqx, rec.cqy, rec.cqz, rec.cqw);
      }
    }

    if (wantEvents) dispatchEvents();
    stepMs += (performance.now() - t0 - stepMs) * 0.1;
  },

  /**
   * update() — per-frame interpolation of bound objects. System lifecycle (core only).
   */
  update() {
    const alpha = G.time.alpha;
    for (let i = 0; i < bindingList.length; i++) {
      const rec = bindingList[i];
      if (rec.settled) continue;
      const obj = rec.obj;
      if (rec.interpolate) {
        obj.position.set(
          rec.px + (rec.cx - rec.px) * alpha,
          rec.py + (rec.cy - rec.py) * alpha,
          rec.pz + (rec.cz - rec.pz) * alpha
        );
        _q3.set(rec.pqx, rec.pqy, rec.pqz, rec.pqw);
        obj.quaternion.set(rec.cqx, rec.cqy, rec.cqz, rec.cqw);
        obj.quaternion.slerpQuaternions(_q3, obj.quaternion, alpha);
      } else {
        obj.position.set(rec.cx, rec.cy, rec.cz);
        obj.quaternion.set(rec.cqx, rec.cqy, rec.cqz, rec.cqw);
      }
    }
  },

  /**
   * stats() → {bodies, colliders, active, bindings, stepMs}. `active` = awake dynamic bodies.
   * @returns {{bodies:number, colliders:number, active:number, bindings:number, stepMs:number}}
   */
  stats() {
    if (!world) return { bodies: 0, colliders: 0, active: 0, bindings: 0, stepMs: 0 };
    let active = 0;
    world.islands.forEachActiveRigidBodyHandle(() => {
      active++;
    });
    return {
      bodies: world.bodies.len(),
      colliders: world.colliders.len(),
      active,
      bindings: bindingList.length,
      stepMs: Math.round(stepMs * 100) / 100,
    };
  },
});

const EXPLOSION_QUERY = { groups: g.VEHICLE | g.PROP | g.DEBRIS | g.RAGDOLL | g.CHARACTER | g.PLAYER };

function bufferForceEvent(ev) {
  const h1 = ev.collider1();
  const h2 = ev.collider2();
  if (!contactCbs.has(h1) && !contactCbs.has(h2)) return;
  const i = forceEvents.n++;
  forceEvents.h1[i] = h1;
  forceEvents.h2[i] = h2;
  forceEvents.mag[i] = ev.totalForceMagnitude();
  const d = ev.maxForceDirection(_vA);
  forceEvents.dx[i] = d.x;
  forceEvents.dy[i] = d.y;
  forceEvents.dz[i] = d.z;
}

function bufferCollisionEvent(h1, h2, started) {
  if (!triggerCbs.has(h1) && !triggerCbs.has(h2)) return;
  const i = collisionEvents.n++;
  collisionEvents.h1[i] = h1;
  collisionEvents.h2[i] = h2;
  collisionEvents.started[i] = started;
}

function dispatchEvents() {
  // 1) buffer (event objects are only valid inside the drain closures)
  forceEvents.n = 0;
  collisionEvents.n = 0;
  if (contactCbs.size > 0) eventQueue.drainContactForceEvents(bufferForceEvent);
  if (triggerCbs.size > 0) eventQueue.drainCollisionEvents(bufferCollisionEvent);
  // 2) dispatch (callbacks may add / remove bodies freely)
  for (let i = 0; i < forceEvents.n; i++) {
    const h1 = forceEvents.h1[i];
    const h2 = forceEvents.h2[i];
    const impulse = forceEvents.mag[i] * CONFIG.FIXED_DT;
    const rec1 = contactCbs.get(h1);
    if (rec1 && impulse >= rec1.minImpulse) fireContact(rec1, h1, h2, i, impulse);
    const rec2 = contactCbs.get(h2);
    if (rec2 && impulse >= rec2.minImpulse) fireContact(rec2, h2, h1, i, impulse);
  }
  for (let i = 0; i < collisionEvents.n; i++) {
    const h1 = collisionEvents.h1[i];
    const h2 = collisionEvents.h2[i];
    const cb1 = triggerCbs.get(h1);
    if (cb1) fireTrigger(cb1, h1, h2, collisionEvents.started[i]);
    const cb2 = triggerCbs.get(h2);
    if (cb2) fireTrigger(cb2, h2, h1, collisionEvents.started[i]);
  }
}

let manifoldFound = false;
function readManifold(manifold) {
  if (manifoldFound) return;
  if (manifold.numSolverContacts() > 0) {
    const p = manifold.solverContactPoint(0, _vB);
    if (p) {
      contactInfo.point.set(p.x, p.y, p.z);
      const n = manifold.normal(_vC);
      contactInfo.normal.set(n.x, n.y, n.z);
      manifoldFound = true;
    }
  }
}

function fireContact(rec, selfHandle, otherHandle, i, impulse) {
  const self = world.colliders.get(selfHandle);
  const other = world.colliders.get(otherHandle);
  if (!self || !other) return;
  const info = contactInfo;
  info.impulse = impulse;
  info.force = forceEvents.mag[i];
  info.collider = self;
  info.otherCollider = other;
  info.otherBody = other.parent();
  manifoldFound = false;
  try {
    world.contactPair(self, other, readManifold);
  } catch (_) {
    manifoldFound = false;
  }
  const sp = self.translation(_vA);
  if (!manifoldFound) {
    const op = other.translation(_vB);
    info.point.set((sp.x + op.x) * 0.5, (sp.y + op.y) * 0.5, (sp.z + op.z) * 0.5);
    info.normal.set(forceEvents.dx[i], forceEvents.dy[i], forceEvents.dz[i]);
    if (info.normal.lengthSq() < 1e-8) info.normal.set(0, 1, 0);
  }
  // orient the normal towards this collider
  const d = (sp.x - info.point.x) * info.normal.x + (sp.y - info.point.y) * info.normal.y + (sp.z - info.point.z) * info.normal.z;
  if (d < 0) info.normal.multiplyScalar(-1);
  try {
    rec.cb(entityOfHandle(otherHandle), info);
  } catch (err) {
    reportError(err, 'physics', 'onContact');
  }
}

function fireTrigger(cb, selfHandle, otherHandle, started) {
  const self = world.colliders.get(selfHandle);
  const other = world.colliders.get(otherHandle);
  if (!self) return;
  triggerInfo.entered = started;
  triggerInfo.collider = self;
  triggerInfo.otherCollider = other || null;
  triggerInfo.otherBody = other ? other.parent() : null;
  try {
    cb(other ? entityOfHandle(otherHandle) : null, triggerInfo);
  } catch (err) {
    reportError(err, 'physics', 'onTrigger');
  }
}

export default physics;
