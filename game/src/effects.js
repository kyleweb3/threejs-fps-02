// DUSTLINE — threejs-fps-02
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Durasi dan ukuran pool. Semua efek dibuat sekali di awal lalu dipakai
// ulang, supaya tidak ada alokasi geometri atau material di tengah frame.
const TRACER_LIFE = 0.07;
const TRACER_POOL = 24;
const SPARK_POOL = 96;
const BLAST_POOL = 4;
const SMOKE_POOL = 6;
const PUFFS_PER_CLOUD = 7;
const BLAST_LIFE = 0.6;
const SPARK_GRAVITY = 12;

// Tekstur asap digambar sekali ke canvas: lingkaran lembut yang memudar
// ke tepi, dipakai semua sprite asap.
function makeSmokeTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(
    size / 2, size / 2, 4, size / 2, size / 2, size / 2,
  );
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.38)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createEffects(scene) {
  const smokeTexture = makeSmokeTexture();
  const smokes = [];

  // ---- Pelacak tembakan: garis lurus singkat antara dua titik. ----
  const tracers = [];
  const tracerGeo = new THREE.BufferGeometry();
  for (let i = 0; i < TRACER_POOL; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(PALETTE.accent),
      transparent: true,
      opacity: 0.9,
    });
    const line = new THREE.Line(geo, mat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0, busy: false });
  }
  let tracerCursor = 0;

  // ---- Percikan benturan: kotak kecil yang terlontar lalu jatuh. ----
  const sparkGeo = new THREE.BoxGeometry(0.07, 0.07, 0.07);
  const sparkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.sand) });
  const sparks = [];
  for (let i = 0; i < SPARK_POOL; i++) {
    const mesh = new THREE.Mesh(sparkGeo, sparkMat);
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, vel: new THREE.Vector3(), life: 0, busy: false });
  }
  let sparkCursor = 0;

  // ---- Ledakan: bola transparan yang mengembang + cahaya titik. ----
  const blastGeo = new THREE.SphereGeometry(1, 14, 10);
  const blasts = [];
  for (let i = 0; i < BLAST_POOL; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(PALETTE.accent),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(blastGeo, mat);
    mesh.visible = false;
    const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 18, 1.6);
    light.visible = false;
    scene.add(mesh);
    scene.add(light);
    blasts.push({ mesh, mat, light, life: 0, busy: false });
  }
  let blastCursor = 0;

  // ---- Asap: tiap handle memegang beberapa sprite yang sudah dibuat. ----
  const smokeHandles = [];
  for (let i = 0; i < SMOKE_POOL; i++) {
    const puffs = [];
    for (let j = 0; j < PUFFS_PER_CLOUD; j++) {
      const mat = new THREE.SpriteMaterial({
        map: smokeTexture,
        color: new THREE.Color(PALETTE.muted),
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      scene.add(sprite);
      puffs.push(sprite);
    }
    smokeHandles.push({
      x: 0, y: 0, z: 0, radius: 3.2, until: 0, duration: 12,
      puffs, busy: false, seed: i * 1.7,
    });
  }

  function spawnTracer(from, to) {
    const slot = tracers[tracerCursor];
    tracerCursor = (tracerCursor + 1) % TRACER_POOL;
    const attr = slot.line.geometry.getAttribute('position');
    attr.setXYZ(0, from.x, from.y, from.z);
    attr.setXYZ(1, to.x, to.y, to.z);
    attr.needsUpdate = true;
    slot.line.material.opacity = 0.9;
    slot.line.visible = true;
    slot.life = TRACER_LIFE;
    slot.busy = true;
  }

  function spawnImpact(point, count = 6) {
    for (let n = 0; n < count; n++) {
      const slot = sparks[sparkCursor];
      sparkCursor = (sparkCursor + 1) % SPARK_POOL;
      slot.mesh.position.set(point.x, point.y, point.z);
      // Arah acak ke segala penjuru, condong ke atas.
      const a = Math.random() * Math.PI * 2;
      const up = 1.2 + Math.random() * 2.6;
      const out = 0.8 + Math.random() * 2.4;
      slot.vel.set(Math.cos(a) * out, up, Math.sin(a) * out);
      slot.life = 0.3 + Math.random() * 0.3;
      slot.mesh.visible = true;
      slot.busy = true;
    }
  }

  function spawnExplosion(point) {
    const slot = blasts[blastCursor];
    blastCursor = (blastCursor + 1) % BLAST_POOL;
    slot.mesh.position.set(point.x, point.y, point.z);
    slot.light.position.set(point.x, point.y + 0.6, point.z);
    slot.mesh.scale.setScalar(0.4);
    slot.mat.opacity = 0.55;
    slot.light.intensity = 7;
    slot.mesh.visible = true;
    slot.light.visible = true;
    slot.life = BLAST_LIFE;
    slot.busy = true;
  }

  function spawnSmoke(point, radius = 3.2, duration = 12) {
    let handle = null;
    for (const h of smokeHandles) {
      if (!h.busy) { handle = h; break; }
    }
    if (!handle) {
      // Pool penuh: pakai ulang awan tertua (yang pertama di daftar aktif).
      handle = smokes.length > 0 ? smokes[0] : smokeHandles[0];
      const at = smokes.indexOf(handle);
      if (at !== -1) smokes.splice(at, 1);
    }
    handle.x = point.x;
    handle.y = point.y;
    handle.z = point.z;
    handle.radius = radius;
    handle.duration = duration;
    handle.until = 0;
    handle.busy = true;
    for (let j = 0; j < handle.puffs.length; j++) {
      const puff = handle.puffs[j];
      const ang = (j / handle.puffs.length) * Math.PI * 2 + handle.seed;
      const dist = radius * (0.25 + Math.random() * 0.6);
      puff.position.set(
        point.x + Math.cos(ang) * dist,
        point.y + 0.4 + Math.random() * 1.1,
        point.z + Math.sin(ang) * dist,
      );
      const size = radius * (0.9 + Math.random() * 0.9);
      puff.scale.set(size, size * 0.75, 1);
      puff.material.opacity = 0.3;
      puff.visible = true;
    }
    smokes.push(handle);
    return handle;
  }

  function update(dt, time) {
    for (const slot of tracers) {
      if (!slot.busy) continue;
      slot.life -= dt;
      if (slot.life <= 0) {
        slot.busy = false;
        slot.line.visible = false;
      } else {
        slot.line.material.opacity = 0.9 * (slot.life / TRACER_LIFE);
      }
    }

    for (const slot of sparks) {
      if (!slot.busy) continue;
      slot.life -= dt;
      if (slot.life <= 0 || slot.mesh.position.y < 0.02) {
        slot.busy = false;
        slot.mesh.visible = false;
        continue;
      }
      slot.vel.y -= SPARK_GRAVITY * dt;
      slot.mesh.position.x += slot.vel.x * dt;
      slot.mesh.position.y += slot.vel.y * dt;
      slot.mesh.position.z += slot.vel.z * dt;
      const s = 0.5 + slot.life;
      slot.mesh.scale.setScalar(s);
    }

    for (const slot of blasts) {
      if (!slot.busy) continue;
      slot.life -= dt;
      if (slot.life <= 0) {
        slot.busy = false;
        slot.mesh.visible = false;
        slot.light.visible = false;
        continue;
      }
      const t = 1 - slot.life / BLAST_LIFE;
      slot.mesh.scale.setScalar(0.4 + t * 9.6);
      slot.mat.opacity = 0.55 * (1 - t);
      slot.light.intensity = 7 * (1 - t);
    }

    // Awan asap yang waktunya habis: sembunyikan sprite-nya, lepas handle.
    for (let i = smokes.length - 1; i >= 0; i--) {
      const handle = smokes[i];
      if (handle.until > 0 && time >= handle.until) {
        for (const puff of handle.puffs) puff.visible = false;
        handle.busy = false;
        smokes.splice(i, 1);
        continue;
      }
      // Selama hidup, gumpalan pelan-pelan mengembang dan menipis.
      const remain = handle.until > 0
        ? Math.max(0, handle.until - time)
        : handle.duration;
      const age = 1 - remain / Math.max(0.001, handle.duration);
      for (const puff of handle.puffs) {
        puff.material.opacity = 0.3 * (1 - age * 0.7);
        puff.position.y += dt * 0.12;
      }
    }
  }

  return { spawnTracer, spawnImpact, spawnExplosion, spawnSmoke, update, smokes };
}
