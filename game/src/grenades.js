// DUSTLINE — threejs-fps-02
import * as THREE from 'three';
import { losClear } from './map.js';

// Data tetap lemparan dan ledakan.
const THROW_SPEED = 11;
const THROW_UP = 3.2;
const GRAVITY = 14;
const FUSE = { flash: 1.0, frag: 2.2, smoke: 2.2 };
const FRAG_RADIUS = 7;
const FLASH_RADIUS = 26;
const SMOKE_RADIUS = 3.2;
const SMOKE_TIME = 12;
const POOL_SIZE = 8;
const FLOOR_Y = 0.1;
const BOUNCE_KEEP = 0.45;

const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _face = new THREE.Vector3();
const _dir = new THREE.Vector3();

// Agen game punya badan di .agent.state (posisi Vector3, yaw); bentuk lain
// dicoba sesudahnya supaya tetap jalan.
function agentPos(agent, out) {
  const body = agent.agent && agent.agent.state ? agent.agent.state.position : null;
  const p = body || agent.pos || agent.position || null;
  if (p) out.set(p.x, p.y, p.z);
  else out.set(agent.x || 0, agent.y || 0, agent.z || 0);
  return out;
}

function agentTeam(agent) {
  if (agent.team !== undefined) return agent.team;
  if (agent.side !== undefined) return agent.side;
  return null;
}

function agentAlive(agent) {
  if (agent.alive !== undefined) return agent.alive;
  if (agent.health !== undefined) return agent.health > 0;
  if (agent.hp !== undefined) return agent.hp > 0;
  return true;
}

// Arah hadap agen: pakai vektor forward bila ada, kalau tidak dari yaw.
function agentFacing(agent, out) {
  const f = agent.forward || agent.dir || null;
  if (f) {
    out.set(f.x, 0, f.z);
    if (out.lengthSq() < 0.0001) out.set(0, 0, 1);
    return out.normalize();
  }
  const body = agent.agent && agent.agent.state ? agent.agent.state : null;
  const yaw = body && body.yaw !== undefined ? body.yaw : (agent.yaw !== undefined ? agent.yaw : (agent.heading || 0));
  out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  return out;
}

// Dinding bisa berupa Box3 ({min,max} Vector3) atau kotak datar
// {minX,maxX,minY,maxY,minZ,maxZ}. Kembalikan batasnya atau null.
function wallBounds(wall, out) {
  if (!wall) return null;
  if (wall.min && wall.max) {
    out.minX = wall.min.x; out.maxX = wall.max.x;
    out.minY = wall.min.y; out.maxY = wall.max.y;
    out.minZ = wall.min.z; out.maxZ = wall.max.z;
    return out;
  }
  if (wall.minX !== undefined) {
    out.minX = wall.minX; out.maxX = wall.maxX;
    out.minY = wall.minY !== undefined ? wall.minY : 0;
    out.maxY = wall.maxY !== undefined ? wall.maxY : 4;
    out.minZ = wall.minZ; out.maxZ = wall.maxZ;
    return out;
  }
  return null;
}

export function createGrenades(scene, effects) {
  const geo = new THREE.SphereGeometry(0.09, 10, 8);
  const mats = {
    frag: new THREE.MeshStandardMaterial({ color: 0xd84a2b, roughness: 0.5 }),
    smoke: new THREE.MeshStandardMaterial({ color: 0xa89a80, roughness: 0.8 }),
    flash: new THREE.MeshStandardMaterial({ color: 0xf2e8d5, roughness: 0.3 }),
  };
  const bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };

  const pool = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const mesh = new THREE.Mesh(geo, mats.frag);
    mesh.visible = false;
    scene.add(mesh);
    pool.push({
      alive: false, type: 'frag', thrower: null,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      fuse: 0, bounced: false, mesh,
    });
  }

  function throwGrenade(type, from, dir, thrower) {
    let slot = null;
    for (const g of pool) {
      if (!g.alive) { slot = g; break; }
    }
    if (!slot) return false;
    _dir.copy(dir);
    if (_dir.lengthSq() < 0.0001) _dir.set(0, 0, 1);
    _dir.normalize();
    slot.type = type;
    slot.thrower = thrower || null;
    slot.pos.set(from.x, from.y, from.z);
    slot.vel.set(_dir.x * THROW_SPEED, _dir.y * THROW_SPEED + THROW_UP, _dir.z * THROW_SPEED);
    slot.fuse = FUSE[type] !== undefined ? FUSE[type] : 2.2;
    slot.bounced = false;
    slot.alive = true;
    slot.mesh.material = mats[type] || mats.frag;
    slot.mesh.position.copy(slot.pos);
    slot.mesh.visible = true;
    return true;
  }

  // Pantulkan granat pada satu dinding kotak; kembalikan true bila memantul.
  function bounceWall(slot, wall) {
    const b = wallBounds(wall, bounds);
    if (!b) return false;
    const r = 0.12;
    const p = slot.pos;
    if (p.x < b.minX - r || p.x > b.maxX + r) return false;
    if (p.y < b.minY - r || p.y > b.maxY + r) return false;
    if (p.z < b.minZ - r || p.z > b.maxZ + r) return false;
    const dxMin = p.x - (b.minX - r);
    const dxMax = (b.maxX + r) - p.x;
    const dyMin = p.y - (b.minY - r);
    const dyMax = (b.maxY + r) - p.y;
    const dzMin = p.z - (b.minZ - r);
    const dzMax = (b.maxZ + r) - p.z;
    const m = Math.min(dxMin, dxMax, dyMin, dyMax, dzMin, dzMax);
    if (m === dxMin) { p.x = b.minX - r; slot.vel.x = -Math.abs(slot.vel.x) * BOUNCE_KEEP; }
    else if (m === dxMax) { p.x = b.maxX + r; slot.vel.x = Math.abs(slot.vel.x) * BOUNCE_KEEP; }
    else if (m === dyMin) { p.y = b.minY - r; slot.vel.y = -Math.abs(slot.vel.y) * BOUNCE_KEEP; }
    else if (m === dyMax) { p.y = b.maxY + r; slot.vel.y = Math.abs(slot.vel.y) * BOUNCE_KEEP; }
    else if (m === dzMin) { p.z = b.minZ - r; slot.vel.z = -Math.abs(slot.vel.z) * BOUNCE_KEEP; }
    else { p.z = b.maxZ + r; slot.vel.z = Math.abs(slot.vel.z) * BOUNCE_KEEP; }
    slot.vel.x *= 0.85;
    slot.vel.z *= 0.85;
    return true;
  }

  function step(dt, walls, agents, now) {
    const events = [];
    for (const slot of pool) {
      if (!slot.alive) continue;
      slot.fuse -= dt;
      slot.vel.y -= GRAVITY * dt;
      slot.pos.x += slot.vel.x * dt;
      slot.pos.y += slot.vel.y * dt;
      slot.pos.z += slot.vel.z * dt;

      // Pantul lantai dengan redaman.
      if (slot.pos.y < FLOOR_Y) {
        slot.pos.y = FLOOR_Y;
        if (Math.abs(slot.vel.y) > 0.6) {
          slot.vel.y = -slot.vel.y * BOUNCE_KEEP;
          slot.vel.x *= 0.7;
          slot.vel.z *= 0.7;
          slot.bounced = true;
        } else {
          slot.vel.y = 0;
          slot.vel.x *= 0.7;
          slot.vel.z *= 0.7;
          slot.bounced = true;
        }
      }

      // Pantul dinding.
      if (walls) {
        for (const wall of walls) {
          if (bounceWall(slot, wall)) slot.bounced = true;
        }
      }
      slot.mesh.position.copy(slot.pos);

      const fragEarly = slot.type === 'frag' && slot.bounced && slot.fuse <= 0.6;
      if (slot.fuse > 0 && !fragEarly) continue;

      // Granat meledak: matikan slot dulu, lalu hitung efeknya.
      slot.alive = false;
      slot.mesh.visible = false;
      const px = slot.pos.x;
      const py = slot.pos.y;
      const pz = slot.pos.z;

      if (slot.type === 'frag') {
        effects.spawnExplosion(slot.pos);
        const victims = [];
        const myTeam = slot.thrower ? agentTeam(slot.thrower) : null;
        for (const agent of agents || []) {
          if (!agentAlive(agent)) continue;
          if (myTeam !== null && agentTeam(agent) === myTeam) continue;
          agentPos(agent, _to);
          _to.y += 1.1;
          _from.set(px, py, pz);
          const dist = _from.distanceTo(_to);
          if (dist > FRAG_RADIUS) continue;
          if (!losClear(_from.x, _from.z, _to.x, _to.z, walls, 1.0)) continue;
          const dmg = Math.max(20, Math.round(100 - (80 * dist) / FRAG_RADIUS));
          victims.push({ agent, dmg });
        }
        events.push({ type: 'frag', x: px, y: py, z: pz, victims });
      } else if (slot.type === 'smoke') {
        const handle = effects.spawnSmoke(slot.pos, SMOKE_RADIUS, SMOKE_TIME);
        if (handle) handle.until = now + SMOKE_TIME;
        events.push({ type: 'smoke', handle });
      } else if (slot.type === 'flash') {
        const victims = [];
        const myTeam = slot.thrower ? agentTeam(slot.thrower) : null;
        for (const agent of agents || []) {
          if (!agentAlive(agent)) continue;
          if (myTeam !== null && agentTeam(agent) === myTeam) continue;
          agentPos(agent, _to);
          _eye.copy(_to);
          _eye.y += 1.5;
          _to.y += 1.1;
          _from.set(px, py, pz);
          const dist = _from.distanceTo(_to);
          if (dist > FLASH_RADIUS) continue;
          if (!losClear(_from.x, _from.z, _eye.x, _eye.z, walls, 1.2)) continue;
          // Makin menghadap granat, makin lama butanya; makin jauh makin singkat.
          agentFacing(agent, _face);
          _dir.copy(_from).sub(_eye).normalize();
          const facing = Math.max(0, _face.dot(_dir));
          const base = facing > 0.5 ? 3.2 : (facing > 0 ? 2.0 : 0.9);
          const duration = base * (1 - (0.5 * dist) / FLASH_RADIUS);
          victims.push({ agent, duration });
        }
        events.push({ type: 'flash', victims });
      }
    }
    return events;
  }

  return { throwGrenade, step, active: pool };
}
