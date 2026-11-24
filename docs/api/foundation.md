# Foundation (engine core) — API notes

Source JSDoc is the ground truth; this file lists what the foundation adds on top of
`docs/ARCHITECTURE.md` and the few places where behaviour is more specific than the contract.
Everything in the contract is implemented as written unless listed under **Deviations**.

## Boot, systems, loop (`core/game.js`, `main.js`)

* Boot: loading screen → `loadRapier()` → `import('./manifest.js')` → `G.initSystems()` (async
  inits awaited in `order`) → `G.save.load()` → `G.startSystems()` → first-load job flush →
  `G.finishBoot()` (`G.ready = true`, `game:ready`, `game:start {newGame}`) → `G.run()`.
* Core systems have orders outside the §3.4 table: `jobs 1`, `quality 5`, `input 11`
  (`entities 14`, `save 95`, `debug 99` as in the table). `ui/theme.js` registers `ui` (24),
  `ui/hud.js` registers `hud` (25) and fills `G.ui`, `ui/touch.js` registers `touch` (26).
* Extra optional system fields: `runWhenPaused: true` (system keeps receiving `update` /
  `lateUpdate` with the real dt while paused — UI, camera for photo mode), `critical: true`
  (an init error is fatal), `stub: true` (never replaces an already registered system; real
  modules registering the same name replace stubs regardless of load order).
* `G.setPaused(b)` (calls `onPause`, emits `game:pause`), `G.suspend(reason, on)` (loop off while
  rotated / context lost), `G.frame(realDt, render)` (one loop iteration), `G.perf`
  `{fps, frameMs, cpuMs, steps}`, `G.flags` (parsed URL params + `dev`), `G.newGame`.
* `G.time` extras: `realDt`, `tick` (fixed tick counter), `alpha` (interpolation factor between
  fixed ticks). `time.now` advances while paused; `time.game` does not.
* `G.settings.get(key, fallback)` / `.set(key, value)` — user settings persisted separately from
  the save (`mugencity.settings.v1`): `quality`, `dynamicResolution`, `lookSensitivity`,
  `invertY`, `haptics`, `pointerLock`, `volumeMaster|Sfx|Music|Ambient`, `leftHanded`, `showFps`.
  Emits `settings:change {key, value}`.
* `G.save.collect()` / `.apply(snapshot)` / `.load()` / `.unregister(key)` in addition to §3.7.
  A handler registered after a save was loaded receives its data immediately.
* Additional events: `input:context {context, prev}`, `input:label {name, label, icon, visible,
  enabled}`, `input:pointerlock {locked}`, `quality:change {level, prev, renderScale, pixelRatio,
  reason}`, `renderer:resize {width, height, pixelRatio}`, `renderer:contextlost`,
  `renderer:contextrestored`, `settings:change`, `ui:hudmode {mode}`, `ui:waypoint {x, z}`,
  `ui:phoneapp {app}`.

## Jobs, entities, rng, mathx

* `G.jobs.add()` returns a handle `{cancel(), done, cancelled, error, promise}`; a new job with
  the same `key` cancels the pending one. Also `G.jobs.cancel(key)`, `.has(key)`, `.pending`,
  `.loading` (larger budget), `.clear()`. A throwing job is reported and dropped.
* `G.entities.query()` tests sphere overlap in 3D (`dist ≤ radius + e.radius`); without `out` it
  returns a new array. Extras: `get(id)`, `has(e)`, `count`, `update(e)` (re-hash a static entity
  now), `raycast(origin, dir, maxDist, filter, maxRadius)` (ray vs. bounding spheres). `all` is
  an array (do not remove while iterating it); `byType()` returns a live `Set`.
* `core/rng.js`: `RNG` (sfc32: `next, range, int, irange, chance, sign, pick, weighted, shuffle,
  gauss, inCircle, fork, getState/setState`), `mulberry32`, `sfc32`, `hash1/2/3(+f)`,
  `hashString`, `valueNoise2/3`, `valueNoise2p` (tileable), `simplex2/3`, `fbm2/3`, `vfbm2`,
  `fbm2p`, `ridged2`, `warp2`, `warpedFbm2`, `worley2`, `worley2p`. Noise returns ~[-1, 1]
  (ridged / worley: [0, 1]).
* `core/mathx.js`: scalar helpers, angle helpers (yaw convention of §1), easing, `tmpVec3()`…
  ring pools (never store the returned objects), `formatYen(n)`.

## Input (`core/input.js`)

* Sign conventions: `move.x/steer/roll/yaw +1 = right`, `move.y +1 = forward`, `pitch +1 = nose
  up`, `lift +1 = up`, `look.dx > 0 = turn right`, `look.dy > 0 = look down` (radians per frame).
* `btn(name).pressed/released` are valid in `update()` **and** `fixedUpdate()` (each edge is
  delivered to exactly one fixed tick). Quick taps between two frames are never lost.
* Context `menu` suppresses all gameplay input (only `pause`, `phone`, `map` stay live).
  `pushContext(ctx)` returns a restore function.
* Device feeds used by `ui/touch.js`: `feedMove`, `feedButton`, `feedAxis`, `feedLook`,
  `press(name)` (one-frame tap), `tap(x, y)` (world tap → `tap:world`, payload also has `normal,
  distance, origin, dir, collider`; `point` is null when nothing was hit; entities without their
  own collider are found by a ray-vs-sphere fallback when they define `onTap` or
  `getInteractions`).
* `simulate(state)` **replaces** the simulated state (`move`, `buttons`, axes persist until the
  next call; `look`, `taps` are one-shot); `simulate(null)` clears it.
* Desktop keys: WASD / arrows, Space, Shift, C, E, F, R, Q (next weapon), Z (previous), T
  (weapon wheel), X, H, L, N (radio; also R in vehicles), V, Tab, M, Esc / P, B, G, 1 / 2
  (special1 / special2), J / K (attack / aim without pointer lock), mouse buttons while the
  pointer is locked, wheel = next / previous weapon. Aircraft: W/S pitch, A/D roll, Q/E yaw,
  Shift = up / throttle, Ctrl or C = down / brake.

## Physics (`physics/physics.js`, Rapier 0.21)

* `G.physics.MASKS.<GROUP>` holds the default interaction groups of the §6 table. `PLAYER`
  behaves like `CHARACTER` (everything that collides with characters collides with the player).
  `groups` arguments accept a group name (`'VEHICLE'`), a single `GROUPS` bit or a full value
  from `mask()`. Defaults: `addStatic` → STATIC, dynamic bodies → PROP, kinematic → CHARACTER.
* Rapier scene queries only see colliders after the next world step; the wrapper additionally
  tests colliders created since the last step, so add-then-raycast in one tick works.
* Query hits come from a ring of 16 reusable objects — copy what you keep. Query `groups` is a
  mask of `GROUPS` bits to hit (default: everything solid; sensors only with `sensors: true`);
  `filter(collider, entity)` is an optional predicate.
* `onContact(target, cb, {minImpulse})` fires on steps where the pair's contact impulse is at
  least `minImpulse` (default `0.5 × mass`, 40 for non-dynamic) — resting contacts are silent.
  `info = {impulse, force, point, normal, otherCollider, otherBody, collider}` (reused object).
  Returns an unsubscribe function.
* Extras: `onTrigger(target, cb(otherEntity, {entered, ...}))` for sensors, `addCollider(body,
  desc, opts)`, `setMass(body, kg)`, `syncBinding(body)` (after teleporting a bound body),
  `applyExplosion(pos, radius, impulse, cb?)` (returns the number of bodies pushed),
  `gravityScale`, `stats()` also returns `bindings`, `stepMs`.

## Renderer (`render/renderer.js`)

* `post.set(key, value)` keys: `exposure, saturation, contrast, tint, vignette, damageFlash,
  underwater, blur, speedLines, grain, fade, bloomStrength, bloomThreshold, bloomKnee,
  bloomRadius`; `post.get`, `post.reset`, `post.params`.
* `addPassHook(fn, stage)` with stages `beforeScene | afterScene | afterPost`; returns a remove
  function. `fn({three, scene, camera, target, width, height, dt, stage})`.
* `setOverride(scene, camera)`, `getDefaultEnvironment()` (neutral PMREM; `scene.environment`
  is free for the sky module), `useDepthTexture(on)` / `depthTexture`, `sceneTarget`,
  `worldToScreen(pos, out)`, `resize()`, `gpu`, `contextLost`, `frame` (the `#game` element),
  `canvas`, `THREE`.
* `info()` → `{drawCalls, tris, points, lines, postCalls, programs, geometries, textures, width,
  height, bufferWidth, bufferHeight, pixelRatio, hdr, msaa, frame}` (scene numbers exclude post).
* After a WebGL context restore, modules owning render targets must rebuild them on
  `renderer:contextrestored`.
* Quality keys beyond §3.8: `minRenderScale, shadowSoft, bloomLevels, fxaa, anisotropy,
  textureSize, lod0Radius, lod1Radius, lod2Radius, physicsRadius, parkedCap, animalCap, decalCap,
  debrisCap, vegetationDensity, propDensity, waterQuality, cloudQuality, dynamicLights,
  envMapSize`.

## Textures / materials (`render/textures.js`, `render/texgen.js`, `render/materials.js`)

* `G.textures.get(key, {type: 'map'|'normal'|'roughness'|'emissive', repeat})`, `getSet`,
  `has`, `keys`, `meta(key)`, `atlas(key)` / `atlasUV(key, cell, out)`, `makeSign(text, style)`
  (presets `shop, neon, road, billboard, plate, danger, wood, info`), `shopName(rngOrSeed,
  kind)`, `slogan(rngOrSeed)`.
* Facade sets: one tile = `meta.bays × meta.floors` windows covering `meta.tileW × meta.tileH`
  meters; all have normal / roughness / emissive maps.
* Atlases are 4 × 4: `road_markings` (line_solid, line_dashed, line_double, line_yellow,
  arrow_straight, arrow_left, arrow_right, arrow_straight_left, arrow_straight_right, stop_line,
  stop_text, speed_40, speed_60, diamond, zebra, bike), `particle_atlas` (soft, smoke1, smoke2,
  fire1, fire2, spark, debris, drop, ring, star, leaf, glass, flash, puff, line, dot),
  `sprite_atlas` (glow, cone, shadow, arrow, ring, cross, heart, yen, star, exclaim, question,
  dot, square, triangle, bolt, chevron), `sign_atlas`, `neon_atlas` (16 signs each).
* `G.materials.get(key, opts)` (variants cached per option set), `solid(color, opts)`,
  `glow(color, intensity, opts)`, `basic(color, opts)`, `setNight(f)` / `night` (drives facade
  window + billboard emission; follows the game clock until the sky module calls it).

## UI (`ui/theme.js`, `ui/hud.js`, `ui/touch.js`)

* `ui/theme.js` exports `ui, icon(name, size), el(tag, props, children), injectCSS(id, css),
  onTap(node, fn), ICONS` (≈ 65 stroke icons). `G.ui.layer(name)` returns a full-frame layer
  (`world 10, hud 20, controls 30, panel 40, overlay 50, top 60`). CSS variables `--mg-*` and
  safe-area variables `--sat/--sar/--sab/--sal` are defined on `#game`.
* Panels: `G.ui.registerPanel(name, {open(container, data, ctl), close(), modal})`;
  `openPanel` switches input to `menu`, `closePanel` restores it. `listPanel()` returns
  `{close(), setItems(items)}` (`closeOnSelect`, `empty` options); `dialog()` resolves with the
  chosen index (`G.ui.activeDialog.choose(i)` for scripts).
* The basic HUD handles the `pause` button while `G.menus` is absent and the `phone` button
  while `G.phone` is absent — the UI module takes over simply by registering those systems.
* `G.touch.layouts[context]` is editable (`G.touch.rebuild()`), `G.touch.setVisible(b)`,
  `G.touch.button(id)`.

## Debug & tools

* Test mode (`?test=1`): no realtime loop (add `&live=1` to keep it), pixel ratio 1, seeded
  `Math.random`, no storage writes, no CSS animations, instant fades, no pointer lock.
* `G.debug` extras: `render()`, `screenStats()`, `clearErrors(match?)`, `setOverlay(on)`,
  `camActive`, `log(tag, ...)`. `showcase()` hides the HUD unless `{ui: true}`.
* Bound objects (`G.physics.bind`) are interpolated: with exact 1/60 s frames (`advance`) they
  trail the body by one tick.
* `tools/lib.mjs` helpers passed to scenarios / scripts: `evalG, advance, settle, assert,
  assertNear, shot, stats, errors, simulate, reset, wait, expectProblem(regex), log`.
  `node tools/smoke.mjs [filter] [--q low] [--release]`; scenarios may
  `export const timeout = seconds`. All scenarios share one page: the harness calls `h.reset()`
  and restores the viewport after each one, and reloads the game after a timeout.

## Deviations / open points

* `src/core/stubs.js` (default gameplay API stubs) and `src/world/chunks.js` are not part of
  this slice (foundation part 1); `G.debug` / the HUD guard every optional system instead.
* `src/world/_testscene.js` is a temporary scene for the smoke test and must be removed (with
  its manifest line) when the real world modules land.
