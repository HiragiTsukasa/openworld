# MUGEN CITY(ムゲンシティ) — Architecture & Module Contract

This file is the **binding contract** between all modules. Source JSDoc is the ground truth for
exact signatures; `docs/api/<module>.md` holds per-module API notes written by each module owner.
If you must deviate from this contract, keep backwards compatibility and document it in your
`docs/api/<module>.md`.

---------------------------------------------------------------------------------------------------

## 0. Product

**MUGEN CITY** is an original 3D open-world "anything goes" sandbox game set on the fictional
Japanese island **無限島 (Mugen-jima)**. The player can go anywhere, drive / fly / sail anything,
interact with (and wreck) everything, and the world visibly **reacts to every action**.

Hard requirements:

* **Portrait orientation only.** Designed for phones held vertically (reference 390x844 CSS px,
  must work 360x640 .. 430x932 and tablets in portrait). On desktop the game renders inside a
  centered portrait frame and also supports keyboard + mouse.
* **Single self-contained HTML file** (`dist/index.html`). No network requests at runtime. No
  external fonts/images/scripts. Everything (models, textures, audio, music) is **procedural**.
* **Release quality**: polished look (PBR, bloom, shadows, day/night, weather, particles), polished
  UI (Japanese), stable 60 fps target on recent phones, no runtime errors.
* **Original IP only**: never reference real brands, real people or existing game franchises
  (names, characters, logos, map layouts, music). Invent fictional names (Japanese flavored).
* All user-facing text is **Japanese**. Code identifiers/comments are English.
* Must also run inside a sandboxed iframe viewer: no `alert/confirm/prompt`, no file downloads,
  no reliance on URL query strings in production, `localStorage` may throw (always try/catch),
  fullscreen / pointer-lock / wake-lock are optional (handle rejection), audio only after a user
  gesture.

Fiction: left-hand traffic (Japan style), right-hand-drive vehicles, yen currency (`¥`).

---------------------------------------------------------------------------------------------------

## 1. Stack, build, tooling

* Plain ES modules (no TypeScript, no framework). `three@0.170.0`,
  `@dimforge/rapier3d-compat` (WASM inlined as base64), `esbuild`.
  Read the installed package sources / `.d.ts` instead of guessing APIs
  (`node_modules/@dimforge/rapier3d-compat/*.d.ts`, `node_modules/three/src`, `three/examples/jsm`).
* `npm run build` → `dist/index.html` (minified, release) **and** `dist/dev.html` (unminified,
  readable stack traces) **and** `dist/artifact.html` (fragment variant: no doctype/html/head/body
  tags, starts with `<title>` + `<style>`, for iframe hosting).
* `npm run smoke` → builds dev, runs `tools/smoke.mjs` (headless Chromium via Playwright, portrait
  390x844, software WebGL). Fails on any console error / uncaught exception / failed assertion.
* `node tools/shot.mjs ...` → scripted screenshots for visual verification (see §19).
* Playwright is preinstalled globally: in tool scripts use
  `createRequire('/opt/node-tools/node_modules/')('playwright')`. Never `npm install playwright`.
* Headless rendering is **slow software WebGL** (often 1–5 fps). Tests must never depend on
  wall-clock frame rate: drive the sim with `G.debug.advance(seconds)` / `G.debug.settle()`.

Coordinates: **Y up, meters**, right-handed (three.js default). `+X = east`, `+Z = south`,
north is `-Z`. **Yaw convention: an object with yaw θ (three.js `rotation.y = θ`) has forward
vector `(sin θ, 0, cos θ)`**, so yaw 0 faces +Z. All vehicle and character models are authored
facing **+Z**, up +Y, origin at ground center (feet / bottom of wheels at y = 0).

---------------------------------------------------------------------------------------------------

## 2. Source tree & ownership

Owner tags: `F` = foundation, others are module ids (see §20). **Only edit files you own.**
Cross-module needs go through `G.*` APIs / events. If you need a small additive change in a file
you do not own, make the minimal edit and list it in your final report.

```
build.mjs                     F
tools/smoke.mjs, tools/shot.mjs, tools/lib.mjs   F
src/index.html                F  (template)
src/main.js                   F  (boot)
src/manifest.js               F  (one `import './path.js';` line per system module; union-merged)
src/core/
  game.js        F  G singleton, registerSystem, main loop
  events.js      F  EventBus
  config.js      F  constants + quality presets
  rng.js         F  seeded RNG, hashes, value/simplex noise, fbm
  mathx.js       F  math helpers, temp-object pools
  jobs.js        F  time-sliced job scheduler (generators)
  input.js       F  unified input (touch + keyboard/mouse) → action state
  save.js        F  localStorage save registry
  quality.js     F  quality presets + dynamic resolution
  entities.js    F  entity registry + spatial hash
  debug.js       F  debug/test API (window.__game)
  stubs.js       F  minimal default implementations of gameplay APIs (economy, police level ...)
src/render/
  renderer.js    F→render   WebGLRenderer, scene, camera, post pipeline, portrait resize
  textures.js    F→tex      procedural texture library (keys in §7)
  materials.js   F→tex      shared material library
  sky.js         render     atmosphere, sun/moon/stars/clouds, lighting, fog, env map
  weather.js     render     weather state machine, rain/snow/storm/fog, wetness, wind
  water.js       render     ocean / lakes / rivers surface, underwater
  particles.js   fx         GPU particle system + presets
  decals.js      fx         decals, skid marks
  fx.js          fx         composite effects (explosion, impacts), camera shake, screen fx
  camerarig.js   player     camera modes
src/physics/
  physics.js     F          Rapier wrapper
src/world/
  worldmap.js    world      island layout, heights, biomes, districts, POIs, lots, map image
  roads.js       world      road graph, lanes, sidewalks, signals, pathfinding
  chunks.js      F→world    chunk streaming + provider registry
  terrain.js     world      terrain meshes/LOD/colliders
  roadmesh.js    world      road/sidewalk/intersection/bridge meshes + colliders
  buildings.js   buildings  procedural buildings, LOD, skyline, colliders
  props.js       props      street furniture (static instanced → dynamic on impact)
  vegetation.js  props      trees, bushes, grass, rocks
  landmarks.js   landmarks  unique POI structures (airport, port, shrine, ferris wheel ...)
  interiors.js   landmarks  seamless enterable shop interiors
src/entities/
  character.js   character  procedural humanoid model + animator
  player.js      player     player controller / state machine
  interaction.js player     interaction prompts, tap targeting, carry/throw
  npc.js         npc        pedestrians: population, behaviours, reactions
  animals.js     npc        animals
  traffic.js     traffic    ambient traffic, parked cars, signals obeying
  aidriver.js    traffic    reusable AI driver (cruise/flee/pursue/goto/race)
  police.js      police     wanted system + responders
  vehicles/
    defs.js          vmodel   vehicle definitions (data)
    models.js        vmodel   createVehicleModel dispatcher
    models_road.js   vmodel   cars, trucks, bikes
    models_special.js vspecial-model boats, aircraft, tank, special
    vehicle.js       vphys    Vehicle base + G.vehicles manager
    car.js           vphys    wheeled vehicle physics
    bike.js          vphys    two-wheelers
    boat.js, heli.js, plane.js, tank.js   vspecial
src/gameplay/
  combat.js, weapons.js, inventory.js   combat
  fire.js, destruction.js               combat
  economy.js, shops.js, stats.js        economy
  missions.js, activities.js, worldevents.js, news.js   missions
  sandbox.js, gadgets.js, photomode.js  sandbox
src/ui/
  theme.js       F→ui   CSS variables, base components, SVG icon set
  hud.js         F→ui   HUD
  touch.js       F→ui   on-screen controls (portrait)
  minimap.js     ui     minimap + full map
  phone.js       ui     in-game phone (apps registry)
  menus.js       ui     title, pause, settings, dialogs, generic list/shop panels
  markers.js     ui     3D world markers, speech bubbles, floating text
src/audio/
  audio.js       audio  WebAudio engine, synthesized SFX, spatial, engine sounds, ambience
  radio.js       audio  procedural music radio stations
docs/api/<module>.md           each module owner
```

`F→x` means: foundation ships a working basic version, module `x` later owns and upgrades it
(keeping the API).

---------------------------------------------------------------------------------------------------

## 3. Core runtime

### 3.1 `G` singleton and systems

```js
import { G, registerSystem } from '../core/game.js';

registerSystem({
  name: 'traffic',        // G.traffic === this object (set immediately at registration)
  order: 72,              // init/update order (table in §3.4)
  init() {},              // may be async; world/scene exist; called once in order
  start() {},             // after all inits + save load
  fixedUpdate(dt) {},     // fixed 1/60 s tick, BEFORE physics step
  postPhysics(dt) {},     // same tick, AFTER physics step
  update(dt) {},          // every rendered frame (dt clamped to 0.1, already time-scaled)
  lateUpdate(dt) {},      // after all update() (camera, HUD)
  onPause(paused) {},     // optional
});
```

* A system module **self-registers at import time** and is listed with one line in
  `src/manifest.js`. The system object *is* its public API (`G.<name>`).
* **Never import another gameplay system's module directly** — always go through `G.<name>` at
  call time (so stubs can be replaced and load order never matters). Importing pure
  helpers/data (`core/*`, `vehicles/defs.js`, `ui/theme.js`) is fine.
* Every lifecycle call is wrapped in try/catch by the core; errors are recorded in
  `G.debug.errors` (and fail the smoke test) but never freeze the loop.
* Hot loops must not allocate (reuse temp vectors from `mathx.js`).

### 3.2 Loop

```
frame:
  input.poll()
  acc += realDt * time.scale        (max 3 fixed steps per frame; drop the rest)
  repeat fixed steps: fixedUpdate(all) → physics.step() → postPhysics(all) → entities.rehash
  update(all) → lateUpdate(all) → renderer.render()
  jobs.run(budgetMs)                (time-sliced generation; ~3 ms/frame, more while loading)
```

`G.time = { now, game, dt, fixedDt: 1/60, scale, paused, hour (0..24 float), day, dayLengthSec,
setHour(h), frame }`. Default `dayLengthSec = 1440` (1 game hour = 60 real seconds). Game starts
08:00.

### 3.3 Events (`G.events.on(name, fn)`, `.off`, `.emit(name, payload)`, `.once`)

Canonical events (payload fields). Emit them when relevant; listen freely.

| event | payload |
|---|---|
| `game:ready` / `game:start` / `game:pause` | `{}` / `{newGame}` / `{paused}` |
| `chunk:lod` | `{chunk, lod, prevLod}` |
| `chunk:physics` | `{chunk, active}` |
| `time:hour` / `time:day` | `{hour}` / `{day}` |
| `weather:change` | `{weather, prev}` |
| `player:state` | `{state, prev}` |
| `player:enterVehicle` / `player:exitVehicle` | `{vehicle, seat}` |
| `player:died` / `player:respawn` / `player:busted` | `{info}` / `{pos}` / `{}` |
| `player:districtEnter` | `{district}` |
| `damage` | `{target, amount, info}` (info: see §11) |
| `death` | `{entity, info}` |
| `explosion` | `{pos, radius, damage, instigator}` |
| `stimulus` | `{kind, pos, radius, intensity, source}` (see §13) |
| `crime` | `{type, pos, severity, victim, instigator}` (see §15) |
| `wanted:change` | `{level, prev}` |
| `vehicle:spawn` / `vehicle:destroyed` / `vehicle:collision` | `{vehicle}` / `{vehicle, info}` / `{vehicle, other, impulse, point}` |
| `vehicle:stolen` | `{vehicle, from}` |
| `npc:spawn` / `npc:despawn` | `{npc}` |
| `prop:break` | `{prop, kind, pos, info}` |
| `fire:start` / `fire:out` | `{fire, pos}` |
| `money:change` | `{money, delta, reason}` |
| `item:pickup` / `weapon:change` / `weapon:fire` | `{item}` / `{weapon}` / `{weapon, shooter, origin, dir}` |
| `mission:start` / `mission:complete` / `mission:fail` | `{mission}` |
| `interaction` | `{entity, id}` |
| `tap:world` | `{point, entity, screen:{x,y}}` |
| `ui:open` / `ui:close` | `{panel}` |
| `save:before` / `save:loaded` | `{}` |
| `news` | `{text, category}` |

### 3.4 System order

```
10 renderer   12 physics   14 entities   15 textures   16 materials   20 audio   21 radio
24 ui(theme)  25 hud  26 touch  27 minimap  28 phone  29 menus  29.5 markers
30 sky  32 weather  34 water  36 particles  37 decals  38 fx
40 world  42 roads  44 chunks  46 terrain  48 roadmesh
50 buildings  52 props  54 vegetation  56 landmarks  58 interiors
62 vehicles  64 player  65 cameraRig  66 interaction  68 npcs  70 animals  72 traffic  73 aiDrivers
74 police  76 combat  77 inventory  78 fire  79 destruction
80 economy  82 shops  83 stats  84 missions  86 activities  87 worldEvents  87.5 news
88 sandbox  89 gadgets  90 photo  95 save  99 debug
```

### 3.5 Jobs (`G.jobs`)

`G.jobs.add(generatorFn | generator, {priority, key})` → handle `{cancel(), done}`. Generators
`yield` often (every ~0.5 ms of work); the scheduler runs them within the frame budget, highest
priority first. `G.jobs.flush(maxMs)` runs everything synchronously (loading screens, tests).
All chunk generation and any work > 1 ms must go through jobs.

### 3.6 Entities (`G.entities`)

Anything other systems may need to find, damage, tap or interact with is an **entity** (duck
typed plain object or class instance):

```js
{
  type,            // 'player'|'npc'|'animal'|'vehicle'|'prop'|'pickup'|'marker'|'shop'|'projectile'|'fire'|'structure'
  pos,             // THREE.Vector3, live (owner updates it)
  radius,          // meters, for queries
  alive,           // bool
  // optional:
  name, health, maxHealth, velocity (Vector3), body (Rapier RigidBody), faction,
  flammable, onFire, ignite(info), extinguish(),
  takeDamage(amount, info),              // §11
  getInteractions(player),               // §12 → [{id,label,icon,priority,hold,action()}]
  onTap(hit),                            // tapped on screen
  carryable, onCarry(by), onThrow(by, velocity),
}
```

`G.entities.add(e)` (assigns `e.id`), `.remove(e)`, `.query(pos, radius, typeOrFilter, out?)`,
`.nearest(pos, radius, typeOrFilter)`, `.byType(type)` (Set), `.all`. Spatial hash cell 32 m,
rehashed every fixed tick for entities with `dynamic !== false`.

### 3.7 Save (`G.save`)

`G.save.register(key, { save: () => plainData, load: (data) => void })`. Core persists to
`localStorage['mugencity.save.v1']` (try/catch), autosaves every 60 s and on `G.save.now()`.
`G.save.hasSave()`, `G.save.reset()`. Disabled in test mode.

### 3.8 Config & quality

`src/core/config.js` exports `CONFIG`: `WORLD_SIZE=16384`, `WORLD_HALF=8192`, `CHUNK=256`,
`SEA_LEVEL=0`, `GRAVITY=-14.7`, `DRIVE_SIDE='left'`, streaming radii, population caps, etc.
`G.quality.level` ∈ `low|medium|high|ultra`, `G.quality.get(key)` (shadowMapSize, shadowDistance,
bloom, msaa, maxPixelRatio, lodBias, npcCap, trafficCap, particleCap, grassDensity, viewDistance,
reflections...). `auto` mode adapts render scale (0.55..1 × min(devicePixelRatio, cap)) to hold
frame time; emits `quality:change`.

Mobile budgets at `high`: ≤ 250 draw calls, ≤ 600k triangles, ≤ 160 active dynamic bodies,
NPC cap ~32, traffic cap ~24, chunk generation ≤ 3 ms per frame, no GC spikes in steady state.

---------------------------------------------------------------------------------------------------

## 4. Input (`G.input`)

Unified action state, identical for touch and keyboard/mouse:

```js
G.input.move        // {x, y}  -1..1 (y = forward)
G.input.look        // {dx, dy} radians accumulated this frame (consumed by camera)
G.input.steer, G.input.throttle, G.input.brake      // -1..1 / 0..1 / 0..1 (vehicle contexts)
G.input.pitch, G.input.roll, G.input.yaw, G.input.lift   // aircraft contexts
G.input.btn(name)   // {down, pressed, released, heldTime}
G.input.setContext(ctx)   // 'foot'|'car'|'bike'|'boat'|'heli'|'plane'|'tank'|'menu'|'photo'
G.input.context
G.input.isTouch
G.input.setActionLabel(buttonName, {label, icon, visible, enabled})   // contextual button text
G.input.simulate({move, look, buttons:{name:true}, taps:[{x,y}]})     // tests
G.input.vibrate(ms)                                                   // optional haptics
```

Button names: `jump, sprint, crouch, attack, aim, interact, enterExit, reload, weaponNext,
weaponPrev, weaponWheel, handbrake, horn, lights, radio, camera, phone, map, pause, emote,
gadget, special1, special2`.

Portrait touch layout (owned by `ui/touch.js`):

* bottom-left zone: floating virtual joystick (move / steer).
* bottom-right cluster: large primary button (foot: 攻撃, vehicles: アクセル), secondary (foot:
  ジャンプ, vehicles: ブレーキ/バック), plus smaller context buttons (dash/handbrake, interact,
  enter/exit, aim, weapon, crouch, horn, camera, gadget ...). Layout changes per context.
* everything else on screen: drag = camera look; short tap = **tap-interact** (raycast into the
  world → `tap:world` event → `entity.onTap` / interaction menu / lock-on).
* top: HUD (minimap top-left, money / wanted / clock top-right, phone + pause buttons).
* All controls respect `env(safe-area-inset-*)`; minimum hit size 44 px; multi-touch safe
  (each control tracks its own `pointerId`).

Desktop: WASD move, mouse look (pointer lock on canvas click, optional), Space jump, Shift
sprint, C crouch, E interact, F enter/exit, LMB attack, RMB aim, R reload, Q/E-wheel weapons,
Tab phone, M map, Esc pause, H horn, L lights, V camera, G gadget, B emote, X handbrake.
Vehicles: W/S throttle/brake, A/D steer, Space handbrake. Aircraft: W/S pitch, A/D roll, Q/E yaw,
Shift/Ctrl throttle.

---------------------------------------------------------------------------------------------------

## 5. Rendering (`G.renderer`)

* `G.renderer.three` (WebGLRenderer), `G.scene`, `G.camera` (PerspectiveCamera), also
  `G.renderer.scene/.camera`. Canvas lives in `#game` portrait frame; `G.renderer.width/height`.
* HDR pipeline: scene → half-float target (MSAA on high) → bloom (threshold + mip chain) →
  composite pass: ACES tone mapping, color grading (per time-of-day / weather / underwater),
  vignette, optional FXAA, screen effects. `G.renderer.post.set(key, value)` for
  `exposure, saturation, contrast, tint, vignette, damageFlash, underwater, blur, speedLines`.
* `G.renderer.addPassHook(fn)` optional. `G.renderer.info()` → draw calls, tris, programs.
* Shadows: one directional light (sun/moon, owned by `sky`) with shadow camera following the
  view (texel-snapped). Objects opt in with `castShadow/receiveShadow`.
* Emissive conventions for bloom: emissive intensity > 1 blooms (neon, headlights, fire).
* Layers: `0` default, `1` no-shadow/transparent fx, `2` UI-3D markers.
* Night lights: real `PointLight/SpotLight` count must stay tiny (≤ 6 active: player
  flashlight, player vehicle headlights, nearest explosions). All other lights are faked with
  emissive materials, light-cone meshes, ground glow sprites and bloom.

---------------------------------------------------------------------------------------------------

## 6. Physics (`G.physics`) — Rapier wrapper

```js
G.physics.RAPIER, G.physics.world
G.physics.GROUPS = { TERRAIN, STATIC, VEHICLE, CHARACTER, PROP, DEBRIS, PROJECTILE, SENSOR, RAGDOLL, PLAYER }
G.physics.mask(memberships[], filter[])            // → collision groups u32
G.physics.addStatic(colliderDesc, {pos, rot, entity, groups}) → collider
G.physics.addBody({type:'dynamic'|'kinematic'|'fixed', pos, rot, colliders:[desc...], mass,
                   linearDamping, angularDamping, ccd, canSleep, entity, groups}) → RigidBody
G.physics.remove(bodyOrCollider)
G.physics.tag(colliderOrBody, entity) / G.physics.entityOf(collider)
G.physics.raycast(origin, dir, maxDist, {groups, excludeBody, excludeCollider}) → hit | null
      hit = {point, normal, distance, collider, body, entity}
G.physics.spherecast(origin, dir, radius, maxDist, opts) → hit | null
G.physics.overlapSphere(pos, radius, cb(collider, entity), opts)
G.physics.applyExplosion(pos, radius, impulse)     // impulses on dynamic bodies only
G.physics.onContact(bodyOrCollider, cb(otherEntity, {impulse, point, normal, otherCollider}))
G.physics.bind(body, object3d, {interpolate})      // auto transform sync each frame
G.physics.unbind(body)
G.physics.setGravityScale(s)                       // sandbox
G.physics.step()                                   // called by core only
G.physics.stats() → {bodies, colliders, active}
```

Static world colliders exist only for chunks inside the **physics radius** (`chunk:physics`
event / provider `setPhysics`). Dynamic bodies far from the player must be removed or put to
sleep by their owners. Use collision groups consistently:

| group | collides with |
|---|---|
| TERRAIN (ground, roads, water bed) | everything |
| STATIC (buildings, fixed props) | everything |
| VEHICLE | TERRAIN, STATIC, VEHICLE, CHARACTER, PROP, DEBRIS, RAGDOLL |
| CHARACTER (kinematic capsules) | TERRAIN, STATIC, VEHICLE, PROP |
| PROP (dynamic props) | TERRAIN, STATIC, VEHICLE, CHARACTER, PROP, RAGDOLL |
| DEBRIS (small cosmetic) | TERRAIN, STATIC, VEHICLE(optional) |
| RAGDOLL | TERRAIN, STATIC, VEHICLE, PROP |
| PROJECTILE | queried by raycast/overlap only |
| SENSOR | triggers |

---------------------------------------------------------------------------------------------------

## 7. Textures & materials (`G.textures`, `G.materials`)

`G.textures.get(key, opts?)` → cached `THREE.Texture` (CanvasTexture / DataTexture, correct
color space, mipmaps, repeat wrapping, anisotropy from quality). `G.textures.getSet(key)` →
`{map, normalMap, roughnessMap, emissiveMap?}`. `G.materials.get(key, opts?)` → cached shared
material. Unknown key → magenta-free neutral fallback + one console warning (never throw).

Required keys (foundation ships simple versions; `tex` module makes them beautiful):

```
ground:  asphalt, asphalt_worn, concrete, sidewalk, curb, road_markings(atlas), crosswalk,
         grass, grass_dry, dirt, mud, sand, rock, cliff, snow, gravel, farmland, forest_floor
build:   facade_office_[1..4], facade_glass_[1..3], facade_apartment_[1..4], facade_house_[1..4],
         facade_shop_[1..4], facade_industrial_[1..3], facade_old_[1..2], roof_flat, roof_tile,
         roof_metal, brick, plaster, wood, wood_dark, metal, metal_rust, metal_painted, glass,
         corrugated, tiles, shoji, container
props:   bark, leaves_[1..4], hedge, sign_atlas, neon_atlas, billboard_[1..8], graffiti_[1..4],
         plate, fabric, rubber, plastic, chrome, car_paint(flake normal), light_glow, sprite_atlas
fx:      noise, particle_atlas, water_normal, cloud, flare, smoke, fire, caustics
```

Facade textures come as tiling sets with **emissive night-window maps** (random lit windows).
Signage generators create fictional Japanese shop names / neon signs / billboards.
`G.textures.makeSign(text, style)` → texture. All generation is lazy + cached; generating a
texture must take < 30 ms (or be chunked via jobs) and use ≤ 1024² (most 256–512²).

---------------------------------------------------------------------------------------------------

## 8. World (`G.world`, `G.roads`, `G.chunks`)

### 8.1 Layout (designed by `world` module, deterministic from `CONFIG.WORLD_SEED`)

World = 16384 m square centered on origin, ocean everywhere outside the main island
(~11 × 9 km, ≥ 90 km² of land) plus several small islands. Required content:

* **ムゲンシティ** (main city, ≥ 3 × 3 km): セントラル (downtown skyscrapers), ネオン街
  (entertainment / neon), 住宅街 (dense Japanese residential), ヒルズ (wealthy hillside), 旧市街
  (old town with shrine/temple), 工業地帯 + 港 (industrial + container port), ビーチリゾート
  (beach, pier, ferris wheel), 大学 / スタジアム area, 空港 (airport with ≥ 1.5 km runway).
* Towns: 北の港町 (fishing town), 山の温泉町 (hot-spring mountain town), 砂漠の町 (dusty desert
  town), 農村 (farming village).
* Nature: central mountain range with peak 無限岳 (≥ 650 m, snow cap, observatory, radio tower),
  forests, a lake with a dam and river(s) to the sea, desert + canyon, farmland plains,
  cliffs, wetlands, beaches, offshore islands (lighthouse island, military base island,
  volcano island with crater), a big suspension bridge.
* Roads: ring expressway + cross-island expressways (bridges where needed, no tunnels),
  arterials, dense street grids in urban districts (irregular, not one monotone grid), rural
  roads, mountain switchbacks, dirt tracks.

### 8.2 Queries (`G.world`)

```js
G.world.heightAt(x, z)            // final ground height (terrain, already road-flattened)
G.world.normalAt(x, z, out?)
G.world.groundAt(x, z)            // walkable surface height: terrain + roads + sidewalks + bridge decks (no buildings)
G.world.isWater(x, z)             // ground below sea level (or lake/river surface) → true
G.world.waterLevelAt(x, z)        // sea = 0, lake = lake level, else -Infinity
G.world.biomeAt(x, z)             // 'ocean'|'beach'|'urban'|'suburb'|'industrial'|'farmland'|'forest'|'mountain'|'snow'|'desert'|'wetland'|'park'|'airport'
G.world.districtAt(x, z)          // {id, name, type, wealth 0..1, density 0..1, ...} | null
G.world.surfaceAt(x, z)           // 'road'|'sidewalk'|'grass'|'dirt'|'sand'|'rock'|'snow'|'mud'|'water'|'concrete'|'wood'
G.world.districts                 // array
G.world.pois                      // array of {id, type, name, x, y, z, yaw, lot?, district, data}
G.world.poisNear(x, z, radius, type?)
G.world.nearestPoi(x, z, type)
G.world.lotsInChunk(cx, cz)       // building lots (see below)
G.world.randomLandPoint(rng, {biome, district, nearRoad})
G.world.spawnPoint                // {x, y, z, yaw} new-game start (near first safehouse)
G.world.mapImage                  // HTMLCanvasElement (≥1024²) top-down map: land/sea/roads/districts
G.world.worldToMap(x, z) / mapToWorld(u, v)
G.world.inBounds(x, z)
```

**Lots**: `{id, cx, cz (center x,z), y, w, d, yaw, district, zone, frontYaw, poi?, seed, kind}`
with `zone` ∈ `commercial|office|residential|house|industrial|park|plaza|parking|special|farm`.
Lots never overlap roads/sidewalks/each other; `y` is the flattened lot elevation (`heightAt`
inside a lot is ≈ `y`). `poi` marks lots reserved for POI buildings.

**POI types** (generated globally at startup so gameplay can reference them before the chunk
loads): `safehouse, hospital, police_station, fire_station, gun_shop, clothing_shop,
convenience_store, restaurant, bar, car_dealer, mod_garage, paint_shop, gas_station, barber,
bank, atm, casino, gym, pawn_shop, arcade, hotel, airport_terminal, hangar, helipad, marina,
boat_dock, bus_stop, taxi_stand, train_station, stadium, shrine, temple, onsen, lighthouse,
observatory, radio_tower, military_base, prison, farm, lumber_mill, dam, ferris_wheel, pier,
viewpoint, stunt_jump, race_start, mission_giver, collectible, parking`.
Every urban district has the basic services; `safehouse` ≥ 8 across the world.

### 8.3 Roads (`G.roads`)

Graph of **nodes** (intersections / ends) and **segments** (polyline with heights), each segment
has a `type` ∈ `expressway|arterial|street|alley|rural|dirt|bridge|runway|taxiway` with `lanes`
per direction, `width`, `speedLimit` (m/s), `sidewalk` (bool), `oneWay`.

```js
G.roads.nodes, G.roads.segments
G.roads.lanes                         // array of lane objects
// lane: {id, segment, dir, index, width, speedLimit, length, points:[{x,y,z}], next:[laneId], prev:[laneId], left, right, type}
G.roads.lanePoint(lane, s, out)       // → {x,y,z, dx,dz} at arc-length s
G.roads.nearestLane(x, z, maxDist)    // → {lane, s, dist, x, y, z} | null
G.roads.randomLaneNear(x, z, minR, maxR, rng)   // spawn helper
G.roads.nearestSegment(x, z, maxDist) // → {segment, t, dist, x, y, z}
G.roads.isOnRoad(x, z)  /  G.roads.roadInfoAt(x, z)   // {segment, type, lateral} | null
G.roads.findPath(ax, az, bx, bz)      // A* on the road graph → {points:[{x,y,z}], lanes:[lane], length} | null
G.roads.signalState(node, segment)    // 'green'|'yellow'|'red'|'none' (time-based cycle)
G.roads.intersections                 // nodes with ≥3 segments, with `signal` flag + crosswalks
// pedestrians
G.roads.sidewalkGraph                 // nodes/edges for walking
G.roads.nearestSidewalk(x, z, maxDist) → {edge, t, x, y, z}
G.roads.randomSidewalkNear(x, z, minR, maxR, rng)
G.roads.walkPath(ax, az, bx, bz)      // sidewalk + crosswalk path
G.roads.parkingSpots(cx, cz)          // roadside / lot parking transforms in a chunk
```

Left-hand traffic: lanes with `dir=+1` run along the segment direction on the **left** side.
Lane connections (`next`) must be valid at every intersection (left turn, straight, right turn).

### 8.4 Chunks (`G.chunks`)

Chunk = 256 m square, index `cx = floor((x + 8192) / 256)`, 64 × 64 chunks.
`chunk = {cx, cz, x0, z0, x1, z1, centerX, centerZ, seed, lod, physics, group (THREE.Group), data:{}}`.

LOD rings around the camera target (radii from quality): `0` near (full detail, ≤ ~320 m),
`1` mid (≤ ~1100 m), `2` far (≤ ~4500 m), `-1` unloaded. Physics radius ~200 m.

```js
G.chunks.registerProvider({
  name: 'buildings',
  order: 50,
  *setLOD(chunk, lod, prevLod) {},     // generator (time-sliced). Build/replace/dispose content.
  setPhysics(chunk, active) {},        // create/destroy static colliders for this chunk
});
G.chunks.get(cx, cz), G.chunks.at(x, z), G.chunks.forEachLoaded(fn), G.chunks.loadedCount
G.chunks.ensureLoadedAround(x, z)     // sync (uses jobs.flush) — teleports, spawn, tests
G.chunks.isReady(x, z)                // near chunk fully generated + physics active
```

Providers must dispose geometries/textures they created when a chunk unloads, must be
deterministic for a given chunk seed, and must keep per-chunk draw calls low (merge / instance).

---------------------------------------------------------------------------------------------------

## 9. Characters (`createCharacter`)

`src/entities/character.js` exports (also on `G.characters`):

```js
createCharacter({ seed, gender, build, height, skin, hair:{style,color}, outfit:{top,bottom,shoes,hat,glasses,bag,...}, preset, lod })
  → {
    group,                       // Object3D, feet at origin, facing +Z
    height, radius,
    setState(name, params),      // animation state with cross-fade
    state,
    setParams({speed, turn, lean, aimPitch, aimYaw, lookAt}),
    update(dt),
    playOneShot(name, {onDone}), // punch, kick, throw, reload, wave, ...
    bone(name),                  // 'head','chest','hips','handR','handL','footR','footL','spine' → Object3D
    attach(obj, boneName), detach(obj),
    setOutfit(partial), setAppearance(partial), getAppearance(),
    setLOD(level), setVisible(v),
    ragdollPose(t) / setPoseFromRagdoll(...)   // optional
    dispose(),
  }
```

States: `idle, walk, run, sprint, crouch, crouchWalk, jump, fall, land, climb, vault, swim,
swimIdle, dive, sit, drive, ride, punch, kick, aim1h, aim2h, shoot, reload, throw, carry, push,
hit, stagger, die, lie, getUp, handsUp, cower, flee, talk, phone, smoke, lean, cheer, wave, point,
dance1, dance2, dance3, parachute, glide, skydive, jetpack, grapple`. Unknown state → `idle`.
≤ 3 draw calls per character, ≤ ~2.5k tris at LOD0; LOD1 ≤ 800 tris.
`CHARACTER_PRESETS` (civilians by district/wealth/time, police, swat, soldier, medic,
firefighter, gang A/B, clerk, worker, beachgoer, tourist, business ...).

---------------------------------------------------------------------------------------------------

## 10. Vehicles

### 10.1 Definitions & models (`vehicles/defs.js`, `models*.js`)

`VEHICLE_DEFS[id] = { id, name (JP fictional), class, dims:{length,width,height,wheelbase,track,
wheelRadius,groundClearance}, mass, maxSpeed (m/s), accel, braking, grip, driveType
('fwd'|'rwd'|'awd'), seats:[{x,y,z,role}], doors, price, rarity, districts, colors, flags }`
with `class` ∈ `car|truck|bus|bike|bicycle|boat|heli|plane|tank|special`.

Required ids (fictional names in JP): `compact, sedan, wagon, kei_car, kei_truck, sports,
supercar, muscle, suv, offroad, pickup, van, minivan, taxi, police, police_suv, swat_van,
ambulance, fire_truck, bus, box_truck, semi, garbage_truck, tow_truck, limo, monster_truck,
buggy, go_kart, tractor, forklift, motorcycle, scooter, dirt_bike, bicycle, speedboat, jetski,
fishing_boat, yacht, helicopter, police_heli, news_heli, prop_plane, jet, seaplane, tank, apc,
hover_car, ufo`.

```js
createVehicleModel(id, {color, seed, lod})
  → { group, def,
      wheels:[{pivot (steer), spin (mesh), radius, pos:{x,y,z}, front, left}],
      doors:[{pivot, open (0..1 setter)}],
      setLights({head, tail, brake, reverse, indL, indR, siren, interior}),
      setDamage(zone, amount),      // zone: 'front'|'rear'|'left'|'right'|'roof'|'all' → visual deformation / detached parts
      setColor(hex), setDirt(0..1),
      breakGlass(which), popTire(i),
      parts:{body, glass[], rotor, tailRotor, propeller, turret, barrel, hook, ...},
      seats:[{pos, role}], exhausts:[Vector3], headlightPos:[Vector3], enginePos,
      colliders:[{shape:'box'|'cylinder'|'capsule'|'hull', half:[x,y,z], offset:[x,y,z], points?}],
      dispose() }
```

Models are procedural, PBR, with proper silhouettes (curved bodies, wheel arches, glass,
bumpers, lights, mirrors, plates, interiors visible through glass), ≤ ~6 draw calls and
≤ ~5k tris each at LOD0; LOD1 ≤ 1 draw call ~600 tris.

### 10.2 Runtime (`G.vehicles`)

```js
G.vehicles.spawn(id, {pos, yaw, color, seed, locked, damaged, parked}) → Vehicle
G.vehicles.despawn(v), G.vehicles.list, G.vehicles.nearest(pos, radius, filter)
Vehicle (entity type 'vehicle'): {
  def, model, body, pos, yaw, velocity, speed (m/s, signed forward), health, engineHealth,
  driver, passengers[], seatsFree(), locked, alarm, onFire, wrecked, inWater, upsideDown,
  setControls({throttle, brake, steer, handbrake, boost, pitch, roll, yaw, lift}),
  setMode('physics'|'rail'|'frozen'),     // 'rail' = cheap kinematic movement for far AI traffic
  setRailTransform(x, y, z, yaw, speed),
  enter(characterEntity, seatIndex, {instant}), exit(characterEntity, {eject}),
  takeDamage(amount, info), repair(), explode(info), ignite(),
  horn(on), siren(on), setLights(mode), popTire(i),
  getInteractions(player), onTap(hit),
}
```

Class controllers: `car.js` (Rapier `DynamicRayCastVehicleController`: suspension, engine/gears,
drift/handbrake, surface grip from `world.surfaceAt`, wheel visuals, skids/tire smoke, damage
from impacts, flip recovery), `bike.js`, `boat.js` (buoyancy), `heli.js`, `plane.js` (lift/drag,
stall, landing gear), `tank.js` (skid steer, turret, cannon). Destroyed vehicles: smoke → fire →
explosion → burnt wreck (stays for minutes).

---------------------------------------------------------------------------------------------------

## 11. Damage & combat (`G.combat`)

```js
G.combat.dealDamage(target, amount, info) → actual damage
// info: {type:'bullet'|'melee'|'explosion'|'fire'|'collision'|'fall'|'drown'|'crush'|'electric',
//        source (entity that physically hit), instigator (responsible character, e.g. driver),
//        point, dir, impulse, weapon}
G.combat.explode(pos, {radius, damage, force, instigator, fire, size})
G.combat.melee(attacker, {range, arc, damage, impulse})
G.combat.fire(shooter, weaponId, origin, dir, {spread})      // hitscan / projectile spawn
G.combat.lockOnTarget(fromEntity, opts) → entity | null
```

`dealDamage` calls `target.takeDamage(amount, info)` (target owns its health and death), then
emits `damage`; the target emits `death` when it dies. Explosions = physics impulse + damage
falloff + particles + audio + decal + camera shake + `stimulus` + optional fire.

`G.inventory`: `give(itemId, n)`, `has(id)`, `remove(id, n)`, `weapons`, `current`, `equip(id)`,
`ammo(id)`, `addAmmo(id, n)`. Weapon ids: `fist, bat, knife, katana, pistol, smg, shotgun,
rifle, sniper, minigun, rpg, grenade, molotov, flamethrower, taser, gravity_gun, paint_gun,
water_gun, fire_extinguisher`.

`G.fire.ignite(pos | entity, {size, instigator})`, fire spreads over flammable entities/vegetation
and is put out by rain, water, extinguishers and fire trucks. `G.destruction.break(target, info)`.

---------------------------------------------------------------------------------------------------

## 12. Interaction (`G.interaction`)

Every frame the interaction system collects `getInteractions(player)` from entities near the
player (and the entity under the crosshair / last tapped) and shows the best one on the
`interact` button (`G.input.setActionLabel`) + HUD prompt. Tap on an entity → `onTap` or a
radial/list menu of all its interactions. Interactions: `{id, label (JP), icon, priority,
hold (seconds), enabled, action(player)}`.

Player can pick up / carry / throw any entity with `carryable`, push dynamic bodies, climb,
and use emotes (`G.player.emote(name)` → `stimulus`).

---------------------------------------------------------------------------------------------------

## 13. The reactive world — stimuli

"The world responds to everything the player does" is implemented with **stimuli**:
`G.events.emit('stimulus', {kind, pos, radius, intensity (0..1), source})`.

Kinds: `gunfire, explosion, aim, melee, crash, honk, siren, engineRev, speeding, scream, fire,
corpse, theft, vandalism, alarm, dance, emote, bump, jumpOnCar, nudge, throw, flash, music,
money, stunt, weatherShelter`.

Emitters: player, combat, vehicles, props, fire. Consumers: NPCs (look / comment / film / flee /
cower / fight / call police / applaud), animals, traffic drivers (brake, honk, road rage, panic),
police (investigate), news feed (`news` event → phone ticker), HUD (subtle feedback).
NPC speech uses `G.ui.speechBubble(entity, text)` + synthesized voice blips.

---------------------------------------------------------------------------------------------------

## 14. Player (`G.player`) & camera (`G.cameraRig`)

```js
G.player: entity {type:'player', pos, yaw, velocity, health, maxHealth, armor, stamina, oxygen,
  state,            // 'foot'|'vehicle'|'swim'|'climb'|'ragdoll'|'dead'|'busted'|'parachute'|'glide'|'jetpack'|'grapple'|'cutscene'
  character, vehicle, seat, grounded, aiming, carrying,
  teleport(x, y, z, yaw), setControlEnabled(b), enterVehicle(v, seat?, opts), exitVehicle(opts),
  ragdoll({impulse, duration}), heal(n), addArmor(n), takeDamage(n, info), kill(info), respawn(pos?),
  emote(name), setInvincible(b), abilities:{superJump, superSpeed, explosivePunch, ...}, scale }
G.cameraRig: { mode ('follow'|'aim'|'first'|'vehicle'|'cinematic'|'free'|'photo'), yaw, pitch, distance,
  setMode(m), shake(amount, duration), kick(pitch), setTarget(entity|null), getForward(out), fov }
```

On-foot: analog walk/run/sprint (stamina), jump, crouch, auto-vault / ledge-climb, ladder-free
climbing of low obstacles, swim/dive (oxygen), fall damage, ragdoll on big hits, melee & guns
(via combat), carry/throw. Death → 「WASTED」style original banner (use 「ダウン」) → respawn at
nearest hospital, lose some cash. Arrest → 「逮捕」 → respawn at police station.
Camera: third person orbit with collision, over-shoulder aim, first person, vehicle chase cam
with speed FOV, look-back; tuned for **portrait** (vertical FOV ~70–78, target framed in lower
third so the road/horizon ahead is visible).

---------------------------------------------------------------------------------------------------

## 15. NPCs, traffic, police

```js
G.npcs.spawn({pos, yaw, preset, seed, behavior, faction}) → Npc (entity 'npc')
Npc: {character, state, faction, mood, target, vehicle, setBehavior(name, params), say(textOrCategory),
      takeDamage, ragdoll(impulse), isWitness, flee(from), attack(target), follow(target), enterVehicle(v, seat)}
G.npcs.list, G.npcs.setDensity(0..1), G.npcs.riot(on)
G.traffic.setDensity(0..1), G.traffic.list
G.aiDrivers.attach(vehicle, {mode:'cruise'|'flee'|'pursue'|'goto'|'park'|'race'|'ram'|'escort', target, speedFactor, aggression}) → driver {setMode, setTarget, detach}
G.police.level (0..6), G.police.reportCrime(type, pos, {severity, victim, instigator}), G.police.setLevel(n),
G.police.clear(), G.police.state ('none'|'pursuit'|'search'), G.police.bribe(), G.police.isCop(entity)
```

Crime types: `assault, murder, copAssault, copKill, gunfire, carjack, vehicleTheft, hitAndRun,
propertyDamage, explosion, robbery, trespass, recklessDriving, arson, aircraftViolation`.
Wanted: 1 foot patrol / cruiser investigates; 2 pursuit cars; 3 + roadblocks, police heli;
4 SWAT; 5 army, APCs; 6 tanks + attack helis. Losing sight → search cone on minimap → cooldown.
Factions: `civilian, police, medic, fire, army, gang_a, gang_b, worker, animal`.

---------------------------------------------------------------------------------------------------

## 16. Economy, missions, sandbox

```js
G.economy.money, G.economy.add(n, reason), G.economy.spend(n, reason) → bool, G.economy.canAfford(n)
G.shops.open(poiOrType), G.shops.register({type, name, items, onBuy})
G.stats.inc(key, n), G.stats.get(key), G.stats.unlock(achievementId)
G.missions.register(def), G.missions.start(id), G.missions.active, G.missions.fail(reason), G.missions.complete()
G.activities.register(def), G.worldEvents.register(def)
G.news.post(text, category)
G.sandbox.spawn(kind, id, opts), G.sandbox.setCheat(name, on), G.sandbox.cheats
G.gadgets.equip(id)   // jetpack, grapple, glider, parachute, gravity_gun ...
G.photo.enter()/exit()
```

---------------------------------------------------------------------------------------------------

## 17. Effects & audio

```js
G.particles.emit(preset, pos, opts)        // one-shot burst; opts: {dir, velocity, count, scale, color, normal}
G.particles.emitter(preset, opts) → {pos (Vector3), dir, rate, scale, active, stop()}   // continuous
G.decals.add(kind, pos, normal, size, opts)        // 'bullet','scorch','blood','oil','crack','paint','water'
G.decals.skid(key, pos, width, intensity)          // continuous strips keyed per wheel; end with G.decals.skidEnd(key)
G.fx.explosion(pos, size), G.fx.impact(kind, pos, normal), G.fx.shake(amount, pos?), G.fx.flash(color, a),
G.fx.slowmo(scale, duration), G.fx.trail(...), G.fx.lightFlash(pos, color, intensity, duration)
```

Particle presets: `smoke, smoke_black, fire, spark, dust, dirt, debris, glass, splash, spray,
ripple, blood, muzzle, explosion, tire_smoke, exhaust, steam, leaf, money, confetti, snow_puff,
bubbles, water_jet, flame_jet, ember, shell, feather, paint, heal, electric, wood, concrete,
sand, rain_splash`. Unknown preset/sound names are ignored with one warning — never throw.

```js
G.audio.play(name, {pos, volume, pitch, loop, bus}) → handle {stop(fade), setPos(v), setPitch(p), setVolume(v)} (always returns a handle)
G.audio.engine(kind) → {update({rpm, load, speed}), setPos(v), stop()}
G.audio.setListener(pos, forward), G.audio.setVolumes({master, sfx, music, ambient})
G.audio.unlocked, G.audio.duck(amount, time)
G.radio.stations, G.radio.setStation(i|null), G.radio.next(), G.radio.current
```

Sound names: `ui_tap, ui_open, ui_close, ui_error, ui_buy, ui_notify, footstep_<surface>, jump,
land, punch, hit_body, hit_metal, hit_wood, hit_glass, gun_pistol, gun_smg, gun_shotgun,
gun_rifle, gun_sniper, gun_minigun, rocket, tank_fire, explosion, explosion_big, glass_break,
crash_small, crash_big, scrape(loop), tire_screech(loop), horn, horn_truck, horn_bike,
siren(loop), door_open, door_close, engine_start, splash, swim, pickup, money, wanted_up,
wanted_clear, mission_start, mission_pass, mission_fail, phone_open, shutter, fire(loop),
rain(loop), wind(loop), ocean(loop), city(loop), forest(loop), night(loop), thunder,
voice_m_<mood>, voice_f_<mood>, scream_m, scream_f, dog, cat, bird, seagull, crow, cow, reload,
empty, ricochet, whoosh, heli(loop), jet(loop), prop(loop), boat(loop), grapple, jetpack(loop),
parachute, vending, atm, register, bell, train, alarm(loop), taser, flame(loop), bubble,
level_up, camera_zoom`.

---------------------------------------------------------------------------------------------------

## 18. UI (`G.ui`)

DOM overlay (`#ui`) over the canvas, styled by `ui/theme.js` (CSS variables, glassy dark
panels with neon accents, system Japanese fonts `"Hiragino Sans","Noto Sans JP","Yu Gothic",
system-ui,sans-serif`, inline SVG icons — **no emoji as icons**). `pointer-events:none` on the
overlay, enabled on controls only.

```js
G.ui.notify(text, {icon, type:'info'|'good'|'bad'|'money', duration})
G.ui.banner(title, subtitle, {style:'area'|'mission'|'pass'|'fail'|'down'|'busted', duration})
G.ui.objective(text | null)
G.ui.prompt(text | null, {icon})
G.ui.speechBubble(entity, text, duration)
G.ui.floatText(pos, text, {color})
G.ui.dialog({title, text, speaker, choices:[{label, action}]}) → Promise
G.ui.openPanel(name, data), G.ui.closePanel(), G.ui.panelOpen
G.ui.listPanel({title, items:[{label, sub, price, icon, disabled, action}], tabs, onClose})   // generic shop/menu list
G.ui.registerPhoneApp({id, name, icon, order, render(container), onOpen, onClose, badge})
G.ui.minimap.addBlip({id, pos|entity, icon, color, label, edge:true}) / removeBlip(id) / setWaypoint(x, z | null) / setSearchArea(...)
G.ui.marker.add({id, pos|entity, icon, color, label, beam, radius}) / remove(id)
G.ui.hud.setVisible(b), G.ui.setHudMode('foot'|'vehicle'|'aircraft'|...)
G.ui.fade(toBlack, seconds) → Promise
```

Screens: title (new game / continue / settings), loading with progress, pause, settings
(quality, sensitivity, volumes, control options, language is JP only), phone (map, missions,
news, garage, contacts, creative/spawn, photo, radio, stats, settings), full map with waypoint
+ fast-travel-to-safehouse, shops, dialogs, weapon wheel, radio wheel, emote wheel.

---------------------------------------------------------------------------------------------------

## 19. Debug / test API (`G.debug`, `window.__game = G`)

```js
G.debug.errors                       // [{msg, stack, system, t}] — any entry fails smoke
G.debug.advance(seconds, {render})   // run fixed ticks + updates synchronously (no wall clock)
G.debug.settle(maxMs)                // flush jobs (chunk generation) around the camera target
G.debug.teleport(x, z, y?)           // + ensureLoadedAround
G.debug.setTime(hour), G.debug.setWeather(name), G.debug.setQuality(level)
G.debug.cam(px,py,pz, tx,ty,tz) / G.debug.camRelease()     // free camera override for screenshots
G.debug.spawnVehicle(id, opts), G.debug.enterVehicle(v), G.debug.spawnNpc(opts), G.debug.give(item, n)
G.debug.showcase(object3d | null, {distance, yaw, pitch, bg})   // isolated model viewer
G.debug.stats()                      // {fps, frameMs, drawCalls, tris, bodies, entities, npcs, vehicles, chunks, jobs, heapMB}
G.debug.register(name, fn)           // modules add their own helpers: G.debug.<name>
```

URL params (dev/test only; production never requires them): `?test=1` (skip title, no audio,
no save, fixed pixel ratio 1, deterministic), `&q=low|medium|high|ultra`, `&seed=N`,
`&pos=x,z`, `&time=h`, `&weather=w`.

`tools/shot.mjs`:
`node tools/shot.mjs --out /abs/path.png [--w 390 --h 844] [--q high] [--pos x,z] [--time 18]
 [--weather rain] [--eval "<js run in page before capture; has G; may be async>"]
 [--advance 2] [--frames 3] [--script file.mjs]` → saves PNG, prints console errors + stats JSON.
`--script` modules export `default async (page, helpers) => {}` for multi-shot sequences.

**Visual work must be verified with screenshots you actually look at** (Read the PNG), iterating
until it looks good — not just "no errors".

---------------------------------------------------------------------------------------------------

## 20. Modules (owners)

| id | scope |
|---|---|
| `F` foundation | build, tools, core, input, physics wrapper, basic renderer, stubs for every API above |
| `world` | worldmap, roads, chunks, terrain, roadmesh |
| `render` | sky, weather, water, post pipeline upgrade |
| `fx` | particles, decals, fx |
| `tex` | textures, materials |
| `character` | character model + animation |
| `vmodel` / `vspecial-model` | vehicle defs + models (road) / special vehicle models |
| `audio` | audio engine + radio |
| `ui` | theme, hud, touch, minimap, phone, menus, markers |
| `player` | player, camerarig, interaction |
| `vphys` | vehicle base, car, bike |
| `buildings` | buildings |
| `props` | props, vegetation |
| `landmarks` | landmarks, interiors |
| `npc` | npc, animals |
| `traffic` | traffic, aidriver |
| `vspecial` | boat, heli, plane, tank |
| `combat` | combat, weapons, inventory, fire, destruction |
| `police` | police |
| `economy` | economy, shops, stats |
| `missions` | missions, activities, worldevents, news |
| `sandbox` | sandbox, gadgets, photomode |

## 21. Coding rules

* Deterministic world generation: seeded RNG only (`core/rng.js`), never `Math.random()` in
  world/chunk generation. Gameplay randomness may use `Math.random()`.
* Dispose what you create (geometries, materials you own, textures you own, bodies, listeners).
* No per-frame allocations in `update/fixedUpdate` (reuse temps), no `console.log` spam
  (use `G.debug.log(tag, ...)` which is silent in release).
* Guard against missing optional systems: `G.audio?.play(...)` is unnecessary (stubs always
  exist) but never assume another module's *internal* fields.
* Everything user-facing in Japanese. No emoji in UI.
* Keep each file focused; split helpers into extra files inside your own directory if a file
  exceeds ~1500 lines (add them to your docs/api notes; only system modules go in manifest.js).
* Before finishing: `npm run build && npm run smoke` must pass, and you must have looked at
  screenshots of your work.
