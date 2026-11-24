// Core engine scenario: events, jobs, entities, input.simulate, physics queries, debug helpers,
// UI API surface, textures / materials for every required key.

export const timeout = 420;

export default async (page, h) => {
  // ---- events --------------------------------------------------------------------------------
  const ev = await h.evalG((G) => {
    const log = [];
    const off = G.events.on('smoke:test', (p) => log.push('a' + p.n));
    G.events.once('smoke:test', (p) => log.push('once' + p.n));
    G.events.on('smoke:test', function self(p) {
      log.push('b' + p.n);
      G.events.off('smoke:test', self); // removing during emit must be safe
    });
    G.events.emit('smoke:test', { n: 1 });
    G.events.emit('smoke:test', { n: 2 });
    off();
    const n3 = G.events.emit('smoke:test', { n: 3 });
    return { log, n3 };
  });
  h.assert(ev.log.join(',') === 'a1,once1,b1,a2', 'event order / once / off (' + ev.log.join(',') + ')');
  h.assert(ev.n3 === 0, 'no listeners left after off()');

  // ---- systems: lifecycle, pause, stubs, replacement ---------------------------------------------
  const sys = await h.evalG(async (G) => {
    const calls = [];
    const real = G.registerSystem({
      name: 'smokeSys',
      order: 97,
      init() { calls.push('init'); },
      start() { calls.push('start'); },
      fixedUpdate() { calls.push('fixed'); },
      update() { calls.push('update'); },
      onPause(p) { calls.push('pause:' + p); },
    });
    const stub = G.registerSystem({ name: 'smokeSys', stub: true, marker: 'stub' });
    await new Promise((r) => setTimeout(r, 0)); // late init is async
    G.debug.advance(1 / 60, { render: false });
    G.setPaused(true);
    G.debug.advance(2 / 60, { render: false }); // paused: no fixedUpdate / update for normal systems
    G.setPaused(false);
    const v2 = G.registerSystem({ name: 'smokeSys', order: 97, marker: 'v2' });
    return {
      stubIgnored: stub === real,
      calls: calls.join(','),
      replaced: G.smokeSys === v2 && G.systems.filter((s) => s.name === 'smokeSys').length === 1,
      sorted: G.systems.every((s, i, a) => i === 0 || a[i - 1].order <= s.order),
    };
  });
  h.assert(sys.stubIgnored, 'a stub never replaces a registered system');
  h.assert(sys.calls === 'init,start,fixed,update,pause:true,pause:false', 'late system lifecycle + pause (' + sys.calls + ')');
  h.assert(sys.replaced && sys.sorted, 'registering the same name replaces the system; list stays sorted');

  // ---- game clock ----------------------------------------------------------------------------
  const clock = await h.evalG((G) => {
    const hours = [];
    const off = G.events.on('time:hour', (e) => hours.push(e.hour));
    const before = G.time.hour;
    G.debug.setTime(11.99);
    G.debug.advance(1, { render: false }); // 1 s = 1 game minute → crosses 12:00
    const mid = G.time.hour;
    G.debug.setTime(before);
    off();
    return { hours, mid };
  });
  h.assert(clock.hours.includes(12), 'time:hour fired when the clock crossed 12:00 (' + clock.hours.join(',') + ')');
  h.assert(clock.mid > 12 && clock.mid < 12.02, 'clock advanced one game minute per second');

  // ---- jobs ----------------------------------------------------------------------------------
  h.expectProblem(/intentional job failure/); // provoked below to prove error isolation
  const jobs = await h.evalG(async (G) => {
    const order = [];
    const mk = (name, n) =>
      function* () {
        for (let i = 0; i < n; i++) {
          order.push(name);
          yield;
        }
      };
    const low = G.jobs.add(mk('low', 3), { priority: 1 });
    const high = G.jobs.add(mk('high', 2), { priority: 5, key: 'smoke:high' });
    const cancelled = G.jobs.add(mk('cancelled', 50), { priority: 9 });
    cancelled.cancel();
    const replaced = G.jobs.add(mk('replaced', 50), { priority: 3, key: 'smoke:k' });
    const replacement = G.jobs.add(mk('new', 1), { priority: 3, key: 'smoke:k' });
    const bad = G.jobs.add(function* () {
      yield;
      throw new Error('smoke: intentional job failure');
    });
    const pendingBefore = G.jobs.pending;
    const left = G.jobs.flush(5000);
    const threw = G.debug.errors.some((e) => e.msg.includes('intentional job failure'));
    let resolved = null;
    low.promise.then((ok) => (resolved = ok));
    await new Promise((r) => setTimeout(r, 0));
    return {
      order,
      left,
      pendingBefore,
      threw,
      resolved,
      done: [low.done, high.done, cancelled.done, replaced.cancelled, replacement.done, bad.done],
    };
  });
  h.assert(jobs.left === 0, 'jobs.flush() drained the queue');
  h.assert(jobs.order.join(',') === 'high,high,new,low,low,low', 'jobs ran by priority, cancelled/replaced skipped (' + jobs.order.join(',') + ')');
  h.assert(jobs.done.every(Boolean), 'job handles report done / cancelled');
  h.assert(jobs.threw, 'a throwing job is reported to G.debug.errors without stopping the queue');
  h.assert(jobs.resolved === true, 'job handle promise resolves');

  // ---- entities ------------------------------------------------------------------------------
  const ent = await h.evalG((G) => {
    const V = G.renderer.THREE.Vector3;
    const made = [];
    const mk = (type, x, z, r) => {
      const e = G.entities.add({ type, pos: new V(x, 0, z), radius: r });
      made.push(e);
      return e;
    };
    const a = mk('smoke_a', 1000, 1000, 0.5);
    const b = mk('smoke_a', 1010, 1000, 0.5);
    mk('smoke_b', 1040, 1000, 2); // "c": radius 2
    mk('smoke_b', 1300, 1000, 120); // "big": larger than a hash cell
    const out = [];
    const res = {
      ids: a.id > 0 && b.id === a.id + 1,
      near: G.entities.query(a.pos, 12, 'smoke_a').length,
      nearFn: G.entities.query(a.pos, 100, (e) => e.type === 'smoke_b' && e.radius < 10).length,
      outReuse: G.entities.query(a.pos, 12, null, out) === out && out.length >= 2,
      radiusOverlap: G.entities.query({ x: 1043, y: 0, z: 1000 }, 1.5, 'smoke_b').length, // touches c (r=2)
      large: G.entities.query({ x: 1190, y: 0, z: 1000 }, 5, 'smoke_b').length, // inside big's sphere
      nearest: G.entities.nearest({ x: 1008, y: 0, z: 1000 }, 50, 'smoke_a') === b,
      byType: G.entities.byType('smoke_a').size,
      get: G.entities.get(a.id) === a,
    };
    // moving + rehash
    b.pos.set(2000, 0, 2000);
    G.entities.rehash();
    res.afterMove = G.entities.query(a.pos, 12, 'smoke_a').length;
    res.movedFound = G.entities.query({ x: 2001, y: 0, z: 2000 }, 3, 'smoke_a')[0] === b;
    const ray = G.entities.raycast({ x: 990, y: 0, z: 1000 }, { x: 1, y: 0, z: 0 }, 100, 'smoke_a');
    res.ray = !!ray && ray.entity === a && Math.abs(ray.distance - 9.5) < 1e-6;
    const before = G.entities.count;
    for (const e of made) G.entities.remove(e);
    res.removed = before - G.entities.count;
    res.byTypeAfter = G.entities.byType('smoke_a').size;
    return res;
  });
  h.assert(ent.ids, 'entities.add assigns increasing ids');
  h.assert(ent.near === 2, 'query by type and radius (' + ent.near + ')');
  h.assert(ent.nearFn === 1, 'query with predicate');
  h.assert(ent.outReuse, 'query fills the provided out array');
  h.assert(ent.radiusOverlap === 1, 'query respects entity radius');
  h.assert(ent.large === 1, 'large entities are found');
  h.assert(ent.nearest, 'nearest returns the closest entity');
  h.assert(ent.byType === 2 && ent.byTypeAfter === 0, 'byType set is live');
  h.assert(ent.get, 'get(id)');
  h.assert(ent.afterMove === 1 && ent.movedFound, 'rehash follows moving entities');
  h.assert(ent.ray, 'entity raycast');
  h.assert(ent.removed === 4, 'remove unregisters entities');

  // ---- input.simulate ------------------------------------------------------------------------
  const input = await h.evalG((G) => {
    const res = {};
    const jump = G.input.btn('jump');
    const frameEdges = [];
    const fixedEdges = [];
    const probe = {
      name: 'smokeProbe',
      order: 98,
      fixedUpdate() {
        if (jump.pressed) fixedEdges.push('p' + G.time.tick);
        if (jump.released) fixedEdges.push('r' + G.time.tick);
      },
      update() {
        if (jump.pressed) frameEdges.push('p');
        if (jump.released) frameEdges.push('r');
      },
    };
    G.registerSystem(probe);
    G.input.setContext('foot');
    G.input.simulate({ move: { x: 0.5, y: 1 }, look: { dx: 0.1, dy: -0.05 }, buttons: { jump: true } });
    G.debug.advance(1 / 60, { render: false });
    res.move = [G.input.move.x, G.input.move.y];
    res.look1 = [G.input.look.dx, G.input.look.dy];
    res.down1 = jump.down;
    G.debug.advance(3 / 60, { render: false });
    res.look2 = [G.input.look.dx, G.input.look.dy];
    res.held = jump.heldTime;
    G.input.simulate({});
    G.debug.advance(2 / 60, { render: false });
    res.down2 = jump.down;
    res.moveAfter = [G.input.move.x, G.input.move.y];
    res.frameEdges = frameEdges.join('');
    res.fixedEdges = fixedEdges.length;
    res.fixedPattern = fixedEdges.map((s) => s[0]).join('');
    // vehicle context mapping
    G.input.setContext('car');
    G.input.simulate({ move: { x: -1, y: 1 } });
    G.debug.advance(1 / 60, { render: false });
    res.car = [G.input.steer, G.input.throttle, G.input.brake];
    G.input.setContext('heli');
    G.input.simulate({ move: { x: 0, y: 1 }, lift: 1, yaw: -1 });
    G.debug.advance(1 / 60, { render: false });
    res.heli = [G.input.pitch, G.input.lift, G.input.yaw];
    // menu context suppresses gameplay input
    G.input.setContext('menu');
    G.input.simulate({ move: { x: 1, y: 1 }, buttons: { attack: true, map: true } });
    G.debug.advance(1 / 60, { render: false });
    res.menu = [G.input.move.x, G.input.btn('attack').down, G.input.btn('map').down];
    G.input.simulate(null);
    G.input.setContext('foot');
    // one-frame pulse
    G.input.press('interact');
    G.debug.advance(1 / 60, { render: false });
    res.pulseDown = G.input.btn('interact').pressed;
    G.debug.advance(1 / 60, { render: false });
    res.pulseUp = G.input.btn('interact').released;
    // labels
    let labelEvent = null;
    const off = G.events.on('input:label', (e) => (labelEvent = e.name));
    G.input.setActionLabel('interact', { label: '話す', icon: 'chat', visible: true });
    off();
    res.label = labelEvent === 'interact' && G.input.getActionLabel('interact').label === '話す';
    res.touchBtnVisible = G.touch.button('interact') ? !G.touch.button('interact').classList.contains('mg-hidden') : null;
    G.input.setActionLabel('interact', null);
    res.unknown = G.input.btn('nope').down === false;
    const restore = G.input.pushContext('menu');
    const pushed = G.input.context;
    restore();
    res.push = pushed === 'menu' && G.input.context === 'foot';
    // remove the probe system again
    const i = G.systems.indexOf(probe);
    if (i >= 0) G.systems.splice(i, 1);
    delete G.smokeProbe;
    G.registerSystem({ name: 'smokeProbe', order: 98 }); // rebuilds phase lists without the probe hooks
    return res;
  });
  h.assertNear(Math.hypot(input.move[0], input.move[1]), 1, 1e-6, 'simulated move is normalized');
  h.assertNear(input.look1[0], 0.1, 1e-9, 'simulated look is delivered');
  h.assert(input.look2[0] === 0 && input.look2[1] === 0, 'look is one-shot');
  h.assert(input.down1 && !input.down2, 'simulated button down / up');
  h.assert(input.held > 0.03, 'heldTime accumulates (' + input.held + ')');
  h.assert(input.moveAfter[0] === 0 && input.moveAfter[1] === 0, 'simulate({}) clears move');
  h.assert(input.frameEdges === 'pr', 'frame edges fire once each (' + input.frameEdges + ')');
  h.assert(input.fixedEdges === 2 && input.fixedPattern === 'pr', 'fixed-step edges fire exactly once each (' + input.fixedPattern + ')');
  h.assert(input.car[0] === -1 && input.car[1] === 1 && input.car[2] === 0, 'car context maps move to steer / throttle');
  h.assert(input.heli[0] === -1 && input.heli[1] === 1 && input.heli[2] === -1, 'heli context maps pitch / lift / yaw (' + input.heli + ')');
  h.assert(input.menu[0] === 0 && input.menu[1] === false && input.menu[2] === true, 'menu context suppresses gameplay input');
  h.assert(input.pulseDown && input.pulseUp, 'press() produces a one-frame tap');
  h.assert(input.label, 'setActionLabel stores + emits');
  h.assert(input.touchBtnVisible === true, 'touch button follows setActionLabel visibility');
  h.assert(input.unknown, 'unknown buttons are inert');
  h.assert(input.push, 'pushContext returns a restore function');

  // ---- physics -------------------------------------------------------------------------------
  const phys = await h.evalG((G) => {
    const P = G.physics;
    const R = P.RAPIER;
    const res = {};
    const down = { x: 0, y: -1, z: 0 };
    // ray against the test ground (far from the props)
    const hit = P.raycast({ x: 60, y: 10, z: -60 }, down, 100);
    res.ground = hit ? { y: hit.point.y, d: hit.distance, ny: hit.normal.y, terrain: hit.collider === G.testscene.groundCollider } : null;
    res.miss = P.raycast({ x: 60, y: 10, z: -60 }, { x: 0, y: 1, z: 0 }, 100) === null;
    res.groupMiss = P.raycast({ x: 60, y: 10, z: -60 }, down, 100, { groups: P.GROUPS.VEHICLE }) === null;
    // a collider added this tick is visible to queries immediately (no step in between)
    const entity = { type: 'smoke_phys', name: 'pad' };
    const pad = P.addStatic(R.ColliderDesc.cuboid(2, 0.5, 2), { pos: { x: 60, y: 3, z: -60 }, entity });
    const hit2 = P.raycast({ x: 60, y: 10, z: -60 }, down, 100);
    res.pending = hit2 ? { y: hit2.point.y, entity: hit2.entity === entity } : null;
    res.entityOf = P.entityOf(pad) === entity;
    const sc = P.spherecast({ x: 60, y: 10, z: -60 }, down, 0.5, 100);
    res.sphere = sc ? sc.distance : null;
    let overlaps = 0;
    P.overlapSphere({ x: 60, y: 3, z: -60 }, 1, (c, e) => {
      if (e === entity) overlaps++;
    });
    res.overlap = overlaps;
    G.debug.advance(2 / 60, { render: false });
    const hit3 = P.raycast({ x: 60, y: 10, z: -60 }, down, 100, { excludeCollider: pad });
    res.exclude = hit3 ? hit3.point.y : null;
    const hit4 = P.raycast({ x: 60, y: 10, z: -60 }, down, 100);
    res.afterStep = hit4 ? hit4.point.y : null;

    // dynamic body: falls, lands, contact callback, binding, explosion, removal
    const obj = new G.renderer.THREE.Object3D();
    const boxEntity = { type: 'smoke_phys', name: 'crate' };
    const body = P.addBody({
      type: 'dynamic',
      pos: { x: 70, y: 4, z: -60 },
      colliders: [R.ColliderDesc.cuboid(0.5, 0.5, 0.5)],
      mass: 25,
      entity: boxEntity,
    });
    res.mass = body.mass();
    res.bodyEntity = P.entityOf(body) === boxEntity && boxEntity.body === body;
    P.bind(body, obj);
    let contacts = 0;
    let contactImpulse = 0;
    let contactNormalY = 0;
    P.onContact(body, (other, info) => {
      contacts++;
      if (info.impulse > contactImpulse) {
        contactImpulse = info.impulse;
        contactNormalY = info.normal.y;
      }
    });
    G.debug.advance(2, { render: false });
    res.restY = body.translation().y;
    res.boundY = obj.position.y;
    res.contacts = contacts;
    res.contactImpulse = contactImpulse;
    res.contactNormalY = contactNormalY;
    res.sleeping = body.isSleeping();
    const pushed = P.applyExplosion({ x: 70, y: 0, z: -61 }, 6, 400);
    G.debug.advance(0.25, { render: false });
    res.pushed = pushed;
    res.flewY = body.translation().y;
    const statsBefore = P.stats();
    P.remove(body);
    P.remove(body); // double remove is safe
    P.remove(pad);
    const statsAfter = P.stats();
    res.removed = statsBefore.bodies - statsAfter.bodies;
    // gravity scale, extra colliders, bind / unbind / syncBinding
    const floater = P.addBody({ type: 'dynamic', pos: { x: 80, y: 5, z: -60 }, colliders: [R.ColliderDesc.ball(0.4)], mass: 3 });
    const extra = P.addCollider(floater, R.ColliderDesc.ball(0.2).setTranslation(0, 0.5, 0), { entity: boxEntity });
    res.extraCollider = floater.numColliders() === 2 && P.entityOf(extra) === boxEntity;
    const obj2 = new G.renderer.THREE.Object3D();
    P.bind(floater, obj2);
    P.setGravityScale(0);
    G.debug.advance(0.5, { render: false });
    res.weightless = Math.abs(floater.translation().y - 5) < 1e-3 && P.gravityScale === 0;
    P.setGravityScale(1);
    G.debug.advance(0.25, { render: false });
    // the bound object is interpolated: with exact 1/60 s frames it trails the body by one tick
    res.falls = floater.translation().y < 4.9 && Math.abs(obj2.position.y - floater.translation().y) < 0.12;
    floater.setTranslation({ x: 80, y: 30, z: -60 }, true);
    P.syncBinding(floater);
    res.synced = obj2.position.y === 30;
    P.unbind(floater);
    G.debug.advance(0.1, { render: false });
    res.unbound = obj2.position.y === 30;
    P.remove(floater);
    res.maskOk = P.mask([P.GROUPS.VEHICLE], [P.GROUPS.TERRAIN, P.GROUPS.STATIC]) === ((P.GROUPS.VEHICLE << 16) | P.GROUPS.TERRAIN | P.GROUPS.STATIC) >>> 0;
    // test boxes from the scene are bound and resting on the ground
    res.boxY = G.testscene.boxes.map((b) => Math.round(b.mesh.position.y * 100) / 100);
    return res;
  });
  h.assert(phys.ground && Math.abs(phys.ground.y) < 1e-3 && Math.abs(phys.ground.d - 10) < 1e-3, 'raycast hits the test ground at y=0 (' + JSON.stringify(phys.ground) + ')');
  h.assert(phys.ground.ny > 0.99 && phys.ground.terrain, 'raycast reports normal and collider');
  h.assert(phys.miss && phys.groupMiss, 'raycast misses upwards / with a non-matching group filter');
  h.assert(phys.pending && Math.abs(phys.pending.y - 3.5) < 1e-3 && phys.pending.entity, 'a collider added this tick is hit immediately, with its entity');
  h.assert(phys.entityOf, 'entityOf(collider)');
  h.assertNear(phys.sphere, 6, 1e-2, 'spherecast distance');
  h.assert(phys.overlap === 1, 'overlapSphere finds the tagged collider');
  h.assert(phys.exclude !== null && Math.abs(phys.exclude) < 1e-3, 'excludeCollider skips to the ground');
  h.assert(phys.afterStep !== null && Math.abs(phys.afterStep - 3.5) < 1e-3, 'collider still hit after a world step');
  h.assertNear(phys.mass, 25, 1e-3, 'addBody mass');
  h.assert(phys.bodyEntity, 'body entity tagging');
  h.assertNear(phys.restY, 0.5, 0.03, 'dynamic box rests on the ground');
  h.assertNear(phys.boundY, phys.restY, 1e-3, 'bound object follows the body');
  h.assert(phys.contacts >= 1 && phys.contactImpulse > 20 && phys.contactNormalY > 0.9, 'contact callback (n=' + phys.contacts + ', J=' + phys.contactImpulse.toFixed(1) + ')');
  h.assert(phys.contacts < 12, 'resting contacts stay silent (' + phys.contacts + ' callbacks)');
  h.assert(phys.pushed === 1 && phys.flewY > 0.6, 'applyExplosion pushes dynamic bodies (y=' + phys.flewY + ')');
  h.assert(phys.removed === 1, 'remove(body) is idempotent');
  h.assert(phys.extraCollider && phys.weightless && phys.falls && phys.synced && phys.unbound, 'addCollider / setGravityScale / syncBinding / unbind (' + JSON.stringify([phys.extraCollider, phys.weightless, phys.falls, phys.synced, phys.unbound]) + ')');
  h.assert(phys.maskOk, 'mask(memberships, filter)');
  h.assert(phys.boxY.every((y) => Math.abs(y - 0.5) < 0.05 || Math.abs(y - 1.5) < 0.05), 'scene boxes rest in two rows (' + phys.boxY + ')');

  // ---- tap:world -----------------------------------------------------------------------------
  const tap = await h.evalG((G) => {
    let payload = null;
    const off = G.events.on('tap:world', (p) => (payload = p));
    G.debug.cam(0, 6, -10, 0, 0, 4);
    G.input.simulate({ taps: [{ x: G.renderer.width / 2, y: G.renderer.height / 2 }] });
    G.debug.advance(1 / 60, { render: false });
    off();
    G.input.simulate(null);
    G.debug.camRelease();
    return payload ? { hasPoint: !!payload.point, y: payload.point ? payload.point.y : null, sx: payload.screen.x } : null;
  });
  h.assert(tap && tap.hasPoint && tap.y > -0.01 && tap.y < 13, 'tap:world reports a world point (' + JSON.stringify(tap) + ')');

  // ---- debug helpers -------------------------------------------------------------------------
  const dbg = await h.evalG((G) => {
    const res = {};
    const t = G.debug.teleport(25, -40);
    res.teleport = t;
    res.camNear = G.camera.position.distanceTo(new G.renderer.THREE.Vector3(25, t.y + 3.2, -49)) < 0.01;
    G.debug.cam(10, 5, -10, 0, 1, 0);
    G.debug.advance(1 / 60, { render: false });
    res.cam = [G.camera.position.x, G.camera.position.y, G.camera.position.z];
    G.debug.camRelease();
    G.debug.register('smokeHelper', () => 42);
    res.registered = G.debug.smokeHelper() === 42;
    const prevQ = G.quality.level;
    let qEvents = 0;
    const off = G.events.on('quality:change', () => qEvents++);
    G.debug.setQuality('medium');
    res.quality = G.quality.level === 'medium' && G.quality.get('npcCap') === 22;
    G.debug.advance(1 / 60);
    G.debug.setQuality(prevQ);
    off();
    res.qEvents = qEvents;
    res.settle = G.debug.settle(2000);
    // showcase
    const THREE = G.renderer.THREE;
    const model = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.4, 4.2), G.materials.get('car_paint', { color: 0xd32f2f }));
    const sc = G.debug.showcase(model, { yaw: 0.8 });
    res.showcase = !!sc && model.parent === sc.scene;
    const screen = G.debug.screenStats();
    res.showcaseDrawn = screen.std > 3;
    G.debug.showcase(null);
    res.showcaseOff = model.parent === null;
    model.geometry.dispose();
    const s = G.debug.stats();
    res.stats = ['fps', 'frameMs', 'drawCalls', 'tris', 'bodies', 'entities', 'npcs', 'vehicles', 'chunks', 'jobs', 'heapMB'].every((k) => typeof s[k] === 'number');
    G.camera.position.set(0, 3.4, -8.5);
    G.camera.lookAt(0, 2.4, 6);
    return res;
  });
  h.assert(dbg.teleport && Math.abs(dbg.teleport.y) < 1e-3 && dbg.camNear, 'debug.teleport finds the ground and moves the camera');
  h.assert(dbg.cam[0] === 10 && dbg.cam[1] === 5 && dbg.cam[2] === -10, 'debug.cam overrides the camera');
  h.assert(dbg.registered, 'debug.register');
  h.assert(dbg.quality && dbg.qEvents === 2, 'debug.setQuality switches presets and emits quality:change');
  h.assert(dbg.settle === 0, 'debug.settle drains jobs');
  h.assert(dbg.showcase && dbg.showcaseDrawn && dbg.showcaseOff, 'debug.showcase renders an isolated model and restores');
  h.assert(dbg.stats, 'debug.stats has every numeric field');

  // ---- textures & materials: every required key ------------------------------------------------
  const tex = await h.evalG((G) => {
    const required = (
      'asphalt asphalt_worn concrete sidewalk curb road_markings crosswalk grass grass_dry dirt mud sand rock cliff snow gravel farmland forest_floor ' +
      'facade_office_1 facade_office_2 facade_office_3 facade_office_4 facade_glass_1 facade_glass_2 facade_glass_3 ' +
      'facade_apartment_1 facade_apartment_2 facade_apartment_3 facade_apartment_4 facade_house_1 facade_house_2 facade_house_3 facade_house_4 ' +
      'facade_shop_1 facade_shop_2 facade_shop_3 facade_shop_4 facade_industrial_1 facade_industrial_2 facade_industrial_3 facade_old_1 facade_old_2 ' +
      'roof_flat roof_tile roof_metal brick plaster wood wood_dark metal metal_rust metal_painted glass corrugated tiles shoji container ' +
      'bark leaves_1 leaves_2 leaves_3 leaves_4 hedge sign_atlas neon_atlas billboard_1 billboard_2 billboard_3 billboard_4 billboard_5 billboard_6 billboard_7 billboard_8 ' +
      'graffiti_1 graffiti_2 graffiti_3 graffiti_4 plate fabric rubber plastic chrome car_paint light_glow sprite_atlas ' +
      'noise particle_atlas water_normal cloud flare smoke fire caustics'
    ).split(' ');
    const bad = [];
    let slowest = ['', 0];
    for (const key of required) {
      if (!G.textures.has(key)) bad.push(key + ':unknown');
      const set = G.textures.getSet(key);
      if (!set || !set.map || !set.map.isTexture || set.fallback) bad.push(key + ':texture');
      if (/^facade_/.test(key) && (!set.emissiveMap || !set.normalMap || !set.roughnessMap || !(set.meta.tileW > 0))) bad.push(key + ':facade-set');
      if (G.textures.get(key) !== set.map) bad.push(key + ':cache');
      const m = G.materials.get(key);
      if (!m || !m.isMaterial) bad.push(key + ':material');
      if (G.materials.get(key) !== m) bad.push(key + ':material-cache');
      const ms = G.textures.generationMs[key] || 0;
      if (ms > slowest[1]) slowest = [key, ms];
    }
    const sign = G.textures.makeSign('ミナト食堂', 'shop');
    const sign2 = G.textures.makeSign('ミナト食堂', 'shop');
    const variant = G.materials.get('car_paint', { color: 0x00ff00 });
    const uv = G.textures.atlasUV('particle_atlas', 'spark', {});
    const slow = Object.entries(G.textures.generationMs).sort((a, b) => b[1] - a[1]).slice(0, 6).map((e) => e[0] + ' ' + e[1]);
    return {
      count: required.length,
      bad,
      slowest,
      slow,
      sign: !!sign && sign.isTexture && sign === sign2 && sign.userData.aspect === 4,
      variant: variant !== G.materials.get('car_paint') && variant === G.materials.get('car_paint', { color: 0x00ff00 }),
      repeat: G.textures.get('asphalt', { repeat: 4 }).repeat.x === 4 && G.textures.get('asphalt').repeat.x === 1,
      uv: uv.u0 === 0.25 && uv.u1 === 0.5 && uv.v1 === 0.75 && uv.v0 === 0.5,
      name: typeof G.textures.shopName(7) === 'string' && G.textures.shopName(7) === G.textures.shopName(7),
      solid: G.materials.solid(0x123456) === G.materials.solid(0x123456),
    };
  });
  h.assert(tex.bad.length === 0, 'every §7 key yields a texture set and a material (' + tex.bad.join(' ') + ')');
  h.log(tex.count + ' texture keys ok; slowest (ms): ' + tex.slow.join(', '));
  h.assert(tex.sign && tex.variant && tex.repeat && tex.uv && tex.name && tex.solid, 'makeSign / variants / repeat / atlasUV / shopName (' + JSON.stringify(tex) + ')');
  // unknown keys: neutral fallback + warning, never an exception
  const fb = await h.evalG((G) => {
    const t = G.textures.get('definitely_not_a_key');
    const m = G.materials.get('definitely_not_a_key');
    return !!t && t.isTexture && !!m && m.isMaterial;
  });
  h.assert(fb, 'unknown texture / material keys fall back gracefully');

  // ---- G.ui API surface (§18) ------------------------------------------------------------------
  const uiRes = await h.evalG(async (G) => {
    const ui = G.ui;
    const res = {};
    const fns = ['notify', 'banner', 'objective', 'prompt', 'speechBubble', 'floatText', 'dialog', 'openPanel', 'closePanel',
      'listPanel', 'registerPhoneApp', 'setHudMode', 'fade', 'registerPanel', 'icon', 'layer'];
    res.missing = fns.filter((f) => typeof ui[f] !== 'function');
    for (const f of ['addBlip', 'removeBlip', 'setWaypoint', 'setSearchArea']) if (typeof ui.minimap[f] !== 'function') res.missing.push('minimap.' + f);
    for (const f of ['add', 'remove']) if (typeof ui.marker[f] !== 'function') res.missing.push('marker.' + f);
    if (typeof ui.hud.setVisible !== 'function') res.missing.push('hud.setVisible');
    ui.notify('スモークテスト', { type: 'good' });
    ui.banner('ムゲンシティ', 'テスト地区', { style: 'area' });
    ui.objective('テストを完了する');
    ui.prompt('調べる', { icon: 'interact' });
    ui.minimap.addBlip({ id: 'smoke', pos: { x: 20, y: 0, z: 30 }, color: '#ff4fa3', edge: true });
    ui.minimap.setWaypoint(40, 60);
    ui.minimap.setSearchArea(-30, 20, 40);
    ui.marker.add({ id: 'smoke', pos: { x: 0, y: 0, z: 8 }, label: '目的地', icon: 'flag', color: '#ffd24a', beam: true });
    const ent = G.testscene.boxes[0];
    ui.speechBubble(ent, 'こんにちは!', 5);
    ui.floatText({ x: 1, y: 1.5, z: 4 }, '+¥500', { color: '#86f7a4' });
    ui.setHudMode('vehicle');
    res.hudMode = ui.hudMode === 'vehicle';
    ui.setHudMode('foot');
    ui.registerPhoneApp({ id: 'smoke', name: 'テスト', icon: 'gear', order: 1, render: (c) => (c.textContent = 'ok') });
    res.phoneApps = ui.phoneApps.length >= 1;
    G.debug.advance(2 / 60);
    res.toast = !!document.querySelector('.mg-toast');
    res.banner = document.querySelector('.mg-banner').style.display !== 'none';
    res.marker = !!document.querySelector('.mg-marker') && document.querySelector('.mg-marker').style.display !== 'none';
    res.bubble = !!document.querySelector('.mg-bubble');
    // list panel switches the input context to menu and back
    let picked = '';
    let closed = 0;
    const handle = ui.listPanel({
      title: 'テストショップ',
      items: [{ label: 'おにぎり', sub: '体力を少し回復', price: 150, icon: 'cart', action: (it) => (picked = it.label) }, { label: '売り切れ', disabled: true }],
      onClose: () => closed++,
    });
    res.panelOpen = ui.panelOpen === 'list' && G.input.context === 'menu';
    document.querySelector('.mg-row').click();
    res.picked = picked === 'おにぎり';
    handle.close();
    res.panelClosed = ui.panelOpen === null && G.input.context === 'foot' && closed === 1;
    // dialog resolves with the chosen index
    let acted = false;
    const p = ui.dialog({ title: '確認', text: 'テストしますか?', speaker: 'テスター', choices: [{ label: 'はい', action: () => (acted = true) }, { label: 'いいえ' }] });
    res.dialogOpen = ui.panelOpen === 'dialog';
    ui.activeDialog.choose(0);
    res.dialog = (await p) === 0 && acted && ui.panelOpen === null;
    // fade is instant in test mode
    await ui.fade(true, 0.3);
    res.faded = ui.faded === true;
    await ui.fade(false, 0.3);
    // pause / resume through the pause button
    G.input.press('pause');
    G.debug.advance(1 / 60, { render: false });
    res.paused = G.time.paused === true;
    const gameBefore = G.time.game;
    G.debug.advance(0.2, { render: false });
    res.frozen = G.time.game === gameBefore;
    G.input.press('pause');
    G.debug.advance(2 / 60, { render: false });
    res.resumed = G.time.paused === false;
    return res;
  });
  h.assert(uiRes.missing.length === 0, 'G.ui implements the whole §18 API (missing: ' + uiRes.missing.join(', ') + ')');
  for (const k of ['hudMode', 'phoneApps', 'toast', 'banner', 'marker', 'bubble', 'panelOpen', 'picked', 'panelClosed', 'dialogOpen', 'dialog', 'faded', 'paused', 'frozen', 'resumed']) {
    h.assert(uiRes[k] === true, 'ui: ' + k);
  }
  await h.shot('smoke-ui');
  await h.evalG((G) => {
    G.ui.objective(null);
    G.ui.prompt(null);
    G.ui.minimap.removeBlip('smoke');
    G.ui.minimap.setWaypoint(null);
    G.ui.minimap.setSearchArea(null);
    G.ui.marker.remove('smoke');
  });

  // ---- save registry (storage is disabled in test mode; the registry still round-trips) -------
  const save = await h.evalG((G) => {
    let state = { coins: 7 };
    G.save.register('smoke', { save: () => state, load: (d) => (state = d) });
    const snap = G.save.collect();
    state = { coins: 0 };
    G.save.apply(JSON.parse(JSON.stringify(snap)));
    const ok = state.coins === 7 && G.save.now() === false && G.save.hasSave() === false;
    G.save.unregister('smoke');
    return ok;
  });
  h.assert(save, 'save registry collects and applies handler data; no storage writes in test mode');

  // ---- steady state ----------------------------------------------------------------------------
  const steady = await h.evalG((G) => {
    // steady state: a few seconds of simulation must not produce errors or job backlog
    const before = G.debug.errors.length;
    G.debug.advance(3, { render: false });
    return { errors: G.debug.errors.length - before, jobs: G.jobs.pending };
  });
  h.assert(steady.errors === 0 && steady.jobs === 0, 'steady state is clean (' + JSON.stringify(steady) + ')');
};
