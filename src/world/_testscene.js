// =================================================================================================
// TEMPORARY FOUNDATION TEST SCENE — delete this file (and its manifest line) once the real world
// modules (sky, world, chunks, terrain ...) exist. It only gives the smoke test and the
// screenshot tool something to render / collide with: a ground plane with a grid, a sun, a few
// static and dynamic boxes built from the shared material library.
// =================================================================================================

import * as THREE from 'three';
import { G, registerSystem } from '../core/game.js';

function gridTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#5d646b';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 10; i++) {
    const p = (i / 10) * size;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(40, 40); // one tile = 10 m
  tex.anisotropy = 4;
  return tex;
}

export const testscene = registerSystem({
  name: 'testscene',
  order: 45,

  /** root group of everything this scene created */
  group: null,
  /** dynamic box entities */
  boxes: [],

  init() {
    const scene = G.scene;
    const RAPIER = G.physics.RAPIER;
    const M = G.materials;
    const group = new THREE.Group();
    group.name = 'testscene';
    this.group = group;
    scene.add(group);

    scene.background = new THREE.Color(0x86b4e6);
    scene.fog = new THREE.Fog(0x9cc0e8, 200, 900);
    scene.environment = G.renderer.getDefaultEnvironment();

    group.add(new THREE.HemisphereLight(0xcfe4ff, 0x6d675c, 0.9));
    const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
    sun.position.set(40, 70, -30);
    const shadowSize = G.quality.get('shadowMapSize');
    if (shadowSize > 0) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(shadowSize, shadowSize);
      const cam = sun.shadow.camera;
      cam.left = -30;
      cam.right = 30;
      cam.top = 30;
      cam.bottom = -30;
      cam.near = 1;
      cam.far = 200;
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.03;
    }
    group.add(sun);

    // ground (visual + collider)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: gridTexture(), roughness: 0.9, metalness: 0 })
    );
    ground.receiveShadow = true;
    group.add(ground);
    this.groundCollider = G.physics.addStatic(RAPIER.ColliderDesc.cuboid(200, 0.5, 200), {
      pos: { x: 0, y: -0.5, z: 0 },
      groups: 'TERRAIN',
    });

    const addStaticBox = (w, h, d, x, z, material, yaw = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, h / 2, z);
      mesh.rotation.y = yaw;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      G.physics.addStatic(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2), { pos: mesh.position, rot: yaw });
      return mesh;
    };
    // a small "street corner" made from library materials (framed for a portrait camera)
    addStaticBox(8, 12.8, 6, -8.2, 15, M.get('facade_office_1', { repeat: [0.66, 1] }), 0.12);
    addStaticBox(6, 6.8, 6, 0, 17, M.get('facade_shop_2', { repeat: [0.75, 1] }));
    addStaticBox(7, 11.6, 6, 7.8, 15, M.get('facade_apartment_1', { repeat: [0.55, 1] }), -0.12);
    addStaticBox(1.2, 1, 1.2, -2.6, 6.5, M.get('concrete'));
    addStaticBox(1.2, 1.6, 1.2, 2.6, 6.5, M.get('brick'));
    addStaticBox(1.2, 2.4, 2.4, 4.6, 9.5, M.get('container', { color: 0xc0392b }), 0.3);

    // bloom + reflection probes
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 14), M.glow(0xff4fa3, 5));
    lamp.position.set(-2.6, 1.3, 6.5);
    group.add(lamp);
    const lamp2 = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 14), M.glow(0x36e0ff, 5));
    lamp2.position.set(2.6, 1.9, 6.5);
    group.add(lamp2);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.7, 32, 20), M.get('chrome'));
    ball.position.set(2.1, 0.7, 1.2);
    ball.castShadow = true;
    group.add(ball);
    G.physics.addStatic(RAPIER.ColliderDesc.ball(0.7), { pos: ball.position });
    const paint = new THREE.Mesh(new THREE.SphereGeometry(0.7, 32, 20), M.get('car_paint', { color: 0x1565c0 }));
    paint.position.set(-2.1, 0.7, 1.2);
    paint.castShadow = true;
    group.add(paint);
    G.physics.addStatic(RAPIER.ColliderDesc.ball(0.7), { pos: paint.position });

    // dynamic boxes (entities with bound bodies)
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const mats = [M.get('wood'), M.get('metal_painted', { color: 0xf2c41d }), M.get('plastic', { color: 0x2e9e6b }), M.get('wood_dark')];
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(boxGeo, mats[i % mats.length]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      const entity = {
        type: 'prop',
        name: 'testbox' + i,
        pos: mesh.position,
        radius: 0.87,
        alive: true,
        mesh,
        body: null,
      };
      const col = i % 3;
      const row = Math.floor(i / 3);
      entity.body = G.physics.addBody({
        type: 'dynamic',
        pos: { x: (col - 1) * 1.02, y: 0.5 + row * 1.001, z: 4 },
        colliders: [RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setFriction(0.8)],
        mass: 40,
        entity,
      });
      G.physics.bind(entity.body, mesh);
      G.entities.add(entity);
      this.boxes.push(entity);
    }

    const cam = G.camera;
    cam.position.set(0, 3.4, -8.5);
    cam.lookAt(0, 2.4, 6);
  },
});

export default testscene;
