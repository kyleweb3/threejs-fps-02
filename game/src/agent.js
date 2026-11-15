// DUSTLINE — threejs-fps-02
import * as THREE from 'three';

// Ukuran tubuh dan gerak agen (meter, detik). Semua angka di sini adalah
// data tetap desain DUSTLINE dan dipakai apa adanya oleh file lain.
const RADIUS = 0.34;
const HEIGHT_STAND = 1.72;
const HEIGHT_CROUCH = 1.12;
const EYE_STAND = 1.6;
const EYE_CROUCH = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const ACCEL_GROUND = 42;
const ACCEL_AIR = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;
const STEP_UP = 0.45;
const MAX_FALL = 30;
const PITCH_LIMIT = 1.45;

// Vektor kerja sekali pakai supaya step() tidak mengalokasi tiap frame.
const _wish = new THREE.Vector3();
const _target = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _eyeOut = new THREE.Vector3();

function clampNum(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Apakah kotak agen (pusat px/pz, kaki di py, tinggi height) bersentuhan
// dengan collider kotak c (c.min / c.max berupa Vector3 atau Box3).
function overlapsBox(px, py, pz, height, c) {
  const mn = c.min;
  const mx = c.max;
  return (
    px + RADIUS > mn.x && px - RADIUS < mx.x &&
    py + height > mn.y && py < mx.y &&
    pz + RADIUS > mn.z && pz - RADIUS < mx.z
  );
}

// Geser sepanjang satu sumbu (x atau z) lalu selesaikan tabrakan terhadap
// semua collider. Bila terhalang saat di tanah dan rintangannya setinggi
// STEP_UP atau kurang, agen naik ke atas rintangan itu (anak tangga).
function slideAxis(state, colliders, axis, amount) {
  const p = state.position;
  const h = state.height;
  if (amount === 0) return;
  p[axis] += amount;
  for (const c of colliders) {
    if (!overlapsBox(p.x, p.y, p.z, h, c)) continue;
    if (state.onGround) {
      const rise = c.max.y - p.y;
      if (rise > 0 && rise <= STEP_UP) {
        let clearAbove = true;
        for (const other of colliders) {
          if (other === c) continue;
          if (overlapsBox(p.x, p.y + rise, p.z, h, other)) {
            clearAbove = false;
            break;
          }
        }
        if (clearAbove) {
          p.y += rise;
          continue;
        }
      }
    }
    if (amount > 0) {
      p[axis] = c.min[axis] - RADIUS;
    } else {
      p[axis] = c.max[axis] + RADIUS;
    }
    if (axis === 'x') state.velocity.x = 0;
    else state.velocity.z = 0;
  }
}

// Gerak vertikal: lantai y = 0, mendarat di atas collider saat jatuh,
// mentok di bawah collider saat melompat ke atas.
function moveVertical(state, colliders, amount) {
  const p = state.position;
  const h = state.height;
  p.y += amount;
  state.onGround = false;
  if (p.y <= 0) {
    p.y = 0;
    if (state.velocity.y <= 0) state.velocity.y = 0;
    state.onGround = true;
    return;
  }
  for (const c of colliders) {
    if (!overlapsBox(p.x, p.y, p.z, h, c)) continue;
    if (state.velocity.y <= 0) {
      p.y = c.max.y;
      state.velocity.y = 0;
      state.onGround = true;
    } else {
      p.y = c.min.y - h;
      state.velocity.y = 0;
    }
  }
}

function stepAgent(state, colliders, dt, move, speedScale) {
  const m = move || {};
  const fwdIn = clampNum(m.forward || 0, -1, 1);
  const strIn = clampNum(m.strafe || 0, -1, 1);
  state.crouching = !!m.crouch;

  state.height = state.crouching ? HEIGHT_CROUCH : HEIGHT_STAND;
  state.eye = state.crouching ? EYE_CROUCH : EYE_STAND;

  // Arah hadap: yaw 0 menghadap -Z. Maju = (-sin yaw, 0, -cos yaw),
  // kanan = (cos yaw, 0, -sin yaw).
  const sin = Math.sin(state.yaw);
  const cos = Math.cos(state.yaw);
  _wish.set(
    -sin * fwdIn + cos * strIn,
    0,
    -cos * fwdIn - sin * strIn,
  );
  const wishLen = _wish.length();
  if (wishLen > 1) _wish.multiplyScalar(1 / wishLen);

  const topSpeed = (state.crouching ? CROUCH_SPEED : WALK_SPEED) * speedScale;
  _target.copy(_wish).multiplyScalar(topSpeed);

  // Akselerasi menuju kecepatan target; saat diam di tanah, gesekan
  // (FRICTION) yang mengerem. Di udara akselerasi jauh lebih kecil.
  const accel = state.onGround
    ? (wishLen > 0.01 ? ACCEL_GROUND : FRICTION)
    : ACCEL_AIR;
  _delta.copy(_target).sub(state.velocity);
  _delta.y = 0;
  const maxStep = accel * dt;
  const dLen = _delta.length();
  if (dLen > maxStep) _delta.multiplyScalar(maxStep / dLen);
  state.velocity.x += _delta.x;
  state.velocity.z += _delta.z;

  if (m.jump && state.onGround) {
    state.velocity.y = JUMP_SPEED;
    state.onGround = false;
  }

  state.velocity.y -= GRAVITY * dt;
  if (state.velocity.y < -MAX_FALL) state.velocity.y = -MAX_FALL;

  slideAxis(state, colliders, 'x', state.velocity.x * dt);
  slideAxis(state, colliders, 'z', state.velocity.z * dt);
  moveVertical(state, colliders, state.velocity.y * dt);
}

export function createAgent(colliders, spawn) {
  const s = spawn || {};
  const state = {
    position: new THREE.Vector3(s.x || 0, 0, s.z || 0),
    velocity: new THREE.Vector3(),
    yaw: s.yaw || 0,
    pitch: 0,
    eye: EYE_STAND,
    onGround: true,
    crouching: false,
    height: HEIGHT_STAND,
  };
  const walls = Array.isArray(colliders) ? colliders : [];

  return {
    state,

    step(dt, move, speedScale = 1) {
      stepAgent(state, walls, dt, move, speedScale);
    },

    look(dx, dy, sensitivity = 0.0022) {
      state.yaw -= dx * sensitivity;
      state.pitch = clampNum(state.pitch - dy * sensitivity, -PITCH_LIMIT, PITCH_LIMIT);
    },

    recoil(pitchKick, yawKick) {
      state.pitch = Math.min(PITCH_LIMIT, state.pitch + (pitchKick || 0));
      state.yaw += yawKick || 0;
    },

    groundSpeed() {
      return Math.hypot(state.velocity.x, state.velocity.z);
    },

    eyePosition(out) {
      const target = out || _eyeOut;
      target.set(state.position.x, state.position.y + state.eye, state.position.z);
      return target;
    },

    teleport(x, z, yaw) {
      state.position.set(x, 0, z);
      state.velocity.set(0, 0, 0);
      state.yaw = yaw || 0;
      state.pitch = 0;
      state.crouching = false;
      state.height = HEIGHT_STAND;
      state.eye = EYE_STAND;
      state.onGround = true;
    },
  };
}
