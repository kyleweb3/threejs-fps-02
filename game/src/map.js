// DUSTLINE — threejs-fps-02 — map: solar relay station in a dust valley at dusk.
// A walled yard, 34 by 28 metres, with a bomb site at each northern corner,
// three lanes running south to north, and a raised walkway down the middle.
// Attackers spawn along the southern fence, defenders near the sites.

import * as THREE from 'three';
import { PALETTE, makeMaterials } from './palette.js';

export const MAP = { minX: -17, maxX: 17, minZ: -14, maxZ: 14, wallH: 5 };

export const SITES = {
  A: { x: -11.5, z: -9.5, r: 3.4, letter: 'A', color: PALETTE.accent },
  B: { x: 11.5, z: -9.5, r: 3.4, letter: 'B', color: PALETTE.friend },
};

export const SPAWNS = {
  attackers: [
    { x: -6, z: 12, yaw: 0 },
    { x: 0, z: 12.5, yaw: 0 },
    { x: 6, z: 12, yaw: 0 },
  ],
  defenders: [
    { x: -11, z: -12, yaw: Math.PI },
    { x: -4, z: -12.5, yaw: Math.PI },
    { x: 4, z: -12.5, yaw: Math.PI },
    { x: 11, z: -12, yaw: Math.PI },
    { x: 0, z: -11, yaw: Math.PI },
  ],
};

// Waypoint nodes the bots walk: spawns, lane middles, site approaches,
// and the two sites themselves.
const WAYPOINT_DEFS = [
  [-6, 12], [0, 12.5], [6, 12],
  [-11, -12], [-4, -12.5], [4, -12.5], [11, -12], [0, -11],
  [-11.5, -9.5], [11.5, -9.5],
  [-13, 0], [0, 0], [13, 0],
  [-13, 8], [0, 6], [13, 8],
  [-8, -6], [8, -6],
  [-6, -4], [6, -4],
  [-9.5, -11], [9.5, -11],
];

// Normalise a wall entry (a THREE.Box3, or a plain min/max box) into a
// flat footprint plus its height.
function wallFootprint(wall) {
  if (wall.min && wall.max) {
    return {
      x0: wall.min.x, x1: wall.max.x,
      z0: wall.min.z, z1: wall.max.z,
      h: wall.max.y - wall.min.y,
    };
  }
  return {
    x0: wall.minX, x1: wall.maxX,
    z0: wall.minZ, z1: wall.maxZ,
    h: (wall.maxY ?? 0) - (wall.minY ?? 0),
  };
}

// Slab test: does the 2D segment cross this axis-aligned rectangle?
function segmentHitsRect(ax, az, bx, bz, r) {
  const dx = bx - ax;
  const dz = bz - az;
  let t0 = 0;
  let t1 = 1;
  if (Math.abs(dx) < 1e-9) {
    if (ax < r.x0 || ax > r.x1) return false;
  } else {
    let ta = (r.x0 - ax) / dx;
    let tb = (r.x1 - ax) / dx;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (az < r.z0 || az > r.z1) return false;
  } else {
    let ta = (r.z0 - az) / dz;
    let tb = (r.z1 - az) / dz;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

// True when the straight 2D line between two ground points is not blocked
// by any wall at least eyeY tall. Both ends are pulled in a little first,
// so a wall the shooter is leaning against does not count as blocking.
export function losClear(ax, az, bx, bz, walls, eyeY = 1.5) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return true;
  const inset = Math.min(0.4, len * 0.25);
  const ux = dx / len;
  const uz = dz / len;
  const sx = ax + ux * inset;
  const sz = az + uz * inset;
  const ex = bx - ux * inset;
  const ez = bz - uz * inset;
  for (const wall of walls) {
    const r = wallFootprint(wall);
    if (r.h < eyeY) continue;
    if (segmentHitsRect(sx, sz, ex, ez, r)) return false;
  }
  return true;
}

// Breadth-first search over the waypoint graph. Returns the list of node
// indices from start to goal, or an empty list when no route exists.
export function findPath(edges, start, goal) {
  if (start === goal) return [start];
  const adj = new Map();
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push(b);
  };
  for (const [a, b] of edges) {
    link(a, b);
    link(b, a);
  }
  const prev = new Map([[start, -1]]);
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === goal) break;
    for (const nb of adj.get(cur) ?? []) {
      if (!prev.has(nb)) {
        prev.set(nb, cur);
        queue.push(nb);
      }
    }
  }
  if (!prev.has(goal)) return [];
  const path = [];
  let cur = goal;
  while (cur !== -1) {
    path.push(cur);
    cur = prev.get(cur);
  }
  return path.reverse();
}

export function nearestNode(waypoints, x, z) {
  let best = 0;
  let bestD = Infinity;
  waypoints.forEach((w, i) => {
    const d = (w.x - x) * (w.x - x) + (w.z - z) * (w.z - z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

// Draw one capital letter on a canvas so it can float above a bomb site.
function makeLetterTexture(letter, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.font = 'bold 190px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 14;
  ctx.strokeStyle = 'rgba(20, 16, 12, 0.9)';
  ctx.strokeText(letter, 128, 138);
  ctx.fillStyle = color;
  ctx.fillText(letter, 128, 138);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createMap(scene) {
  const mats = makeMaterials(THREE);
  const group = new THREE.Group();
  const colliders = [];
  const shootables = [];
  const walls = [];

  // Place one solid box: mesh in the group, Box3 in the colliders, and —
  // when it stands taller than eye level — in the walls list as well.
  function addBox(cx, cz, w, d, h, mat, yBase = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[mat]);
    mesh.position.set(cx, yBase + h / 2, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const box = new THREE.Box3(
      new THREE.Vector3(cx - w / 2, yBase, cz - d / 2),
      new THREE.Vector3(cx + w / 2, yBase + h, cz + d / 2),
    );
    colliders.push(box);
    shootables.push(mesh);
    if (h > 1.5) walls.push(box);
    return mesh;
  }

  // A flat visual panel that bots walk over freely: no collider, no shadow.
  function addPanel(cx, cz, w, d, mat, rot = 0, y = 0.02) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mats[mat]);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = rot;
    mesh.position.set(cx, y, cz);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  // --- Ground and outer fence -------------------------------------------
  addBox(0, 0, 34, 28, 0.2, 'surface', -0.2);
  addBox(0, -14, 35.2, 0.6, MAP.wallH, 'surface');
  addBox(0, 14, 35.2, 0.6, MAP.wallH, 'surface');
  addBox(-17, 0, 0.6, 28.6, MAP.wallH, 'surface');
  addBox(17, 0, 0.6, 28.6, MAP.wallH, 'surface');

  // --- Lane dressing: pale walkway strips down west, mid and east -------
  addPanel(0, 0.5, 2.6, 23, 'hairline');
  addPanel(-13, 0, 2.6, 24, 'hairline');
  addPanel(13, 0, 2.6, 24, 'hairline');
  // Dark dust patches scattered on the open ground.
  addPanel(-5, 4, 3, 2, 'dark', 0.4, 0.012);
  addPanel(7, -3, 2.5, 2, 'dark', -0.7, 0.012);
  addPanel(0, -8, 4, 2, 'dark', 0.2, 0.012);

  // --- West lane: crates, a long low wall, and the site A container -----
  addBox(-14, -6, 2, 2, 1.2, 'sand');
  addBox(-8, -2, 0.6, 6, 1.1, 'hairline');
  addBox(-13.5, 3, 1.8, 1.8, 1.0, 'sand');
  addBox(-14.5, -11.5, 2.5, 2.2, 2.4, 'hairline');
  addBox(-9, 5, 1.5, 1.5, 1.0, 'sand');
  addBox(-10.5, 9.5, 1.8, 1.6, 1.0, 'sand');
  addBox(-15.2, -8, 0.6, 3.5, 3.2, 'surface');
  addBox(-8.2, -12.8, 3, 0.6, 3.0, 'surface');

  // --- East lane, mirrored: the pump house side -------------------------
  addBox(14, -6, 2, 2, 1.2, 'sand');
  addBox(8, -2, 0.6, 6, 1.1, 'hairline');
  addBox(13.5, 3, 1.8, 1.8, 1.0, 'sand');
  addBox(14.5, -11.5, 2.5, 2.2, 2.4, 'hairline');
  addBox(9, 5, 1.5, 1.5, 1.0, 'sand');
  addBox(10.5, 9.5, 1.8, 1.6, 1.0, 'sand');
  addBox(15.2, -8, 0.6, 3.5, 3.2, 'surface');
  addBox(8.2, -12.8, 3, 0.6, 3.0, 'surface');

  // --- Middle: twin pillars, low cover near each spawn, site guards -----
  addBox(-3.2, 0, 1, 1, 3.5, 'hairline');
  addBox(3.2, 0, 1, 1, 3.5, 'hairline');
  addBox(-5, 8, 2, 1.5, 1.2, 'sand');
  addBox(5, 8, 2, 1.5, 1.2, 'sand');
  addBox(-6, -8, 3, 0.6, 2.6, 'hairline');
  addBox(6, -8, 3, 0.6, 2.6, 'hairline');
  addBox(-3.2, -5.5, 1.6, 1.6, 1.0, 'sand');
  addBox(3.2, -5.5, 1.6, 1.6, 1.0, 'sand');

  // --- Site canopies: four slim posts each, dome over A, glass over B ---
  for (const s of Object.values(SITES)) {
    addBox(s.x - 2.6, s.z, 0.3, 0.3, 3.0, 'dark');
    addBox(s.x + 2.6, s.z, 0.3, 0.3, 3.0, 'dark');
    addBox(s.x, s.z - 2.6, 0.3, 0.3, 3.0, 'dark');
    addBox(s.x, s.z + 2.6, 0.3, 0.3, 3.0, 'dark');
  }
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(3.0, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    mats.sand,
  );
  dome.position.set(SITES.A.x, 3.0, SITES.A.z);
  dome.castShadow = true;
  group.add(dome);
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.18, 5.6), mats.glass);
  canopy.position.set(SITES.B.x, 3.3, SITES.B.z);
  canopy.castShadow = true;
  group.add(canopy);

  // A horizontal tank resting on the pump-house container.
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2.6, 16), mats.sand);
  tank.rotation.z = Math.PI / 2;
  tank.position.set(14.5, 3.3, -11.5);
  tank.castShadow = true;
  group.add(tank);

  // --- Site rings and floating letters -----------------------------------
  for (const s of Object.values(SITES)) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(s.r - 0.5, s.r, 48),
      new THREE.MeshBasicMaterial({ color: s.color, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.x, 0.03, s.z);
    group.add(ring);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeLetterTexture(s.letter, s.color),
      transparent: true,
      depthWrite: false,
    }));
    sprite.scale.set(2.4, 2.4, 1);
    sprite.position.set(s.x, 4.8, s.z);
    group.add(sprite);
  }

  // --- Dusk lighting: warm sun low in the west, cold fill from the east --
  const sun = new THREE.DirectionalLight(0xffb36b, 2.4);
  sun.position.set(-24, 22, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -20;
  sun.shadow.camera.right = 20;
  sun.shadow.camera.top = 20;
  sun.shadow.camera.bottom = -20;
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0015;
  sun.target.position.set(0, 0, 0);
  group.add(sun);
  group.add(sun.target);
  const fill = new THREE.DirectionalLight(0x86a8c8, 0.5);
  fill.position.set(18, 14, -8);
  group.add(fill);
  const hemi = new THREE.HemisphereLight(0xffd9a8, 0x241a12, 0.55);
  group.add(hemi);

  // --- Waypoints and their edges -----------------------------------------
  const waypoints = WAYPOINT_DEFS.map(([x, z]) => ({ x, z }));
  const edges = [];
  for (let i = 0; i < waypoints.length; i++) {
    for (let j = i + 1; j < waypoints.length; j++) {
      const a = waypoints[i];
      const b = waypoints[j];
      const dist = Math.hypot(b.x - a.x, b.z - a.z);
      if (dist <= 10 && losClear(a.x, a.z, b.x, b.z, walls)) {
        edges.push([i, j]);
      }
    }
  }

  scene.add(group);
  return { colliders, shootables, walls, waypoints, edges, group };
}
