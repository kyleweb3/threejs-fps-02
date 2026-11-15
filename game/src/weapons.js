// DUSTLINE — threejs-fps-02
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Tabel senjata DUSTLINE. Data tetap desain — harga, damage, dan angka
// tembak di bawah ini dipakai apa adanya oleh ekonomi dan simulasi game.
// fireDelay = jeda antar tembakan (detik); mag = isi magasin;
// reserve = peluru cadangan; spreadStand = sebaran saat diam;
// spreadMove = tambahan sebaran saat bergerak penuh;
// moveSpeed = pengali kecepatan gerak saat senjata dipegang.
export const WEAPONS = {
  P9: {
    name: 'P9', price: 300, damage: 26, headMult: 3.5,
    fireDelay: 0.14, mag: 15, reserve: 45, reloadTime: 1.4,
    spreadStand: 0.004, spreadMove: 0.02, recoil: 0.006,
    auto: false, moveSpeed: 1.0,
  },
  VK9: {
    name: 'VK-9', price: 1500, damage: 24, headMult: 3.5,
    fireDelay: 0.075, mag: 28, reserve: 84, reloadTime: 1.7,
    spreadStand: 0.006, spreadMove: 0.026, recoil: 0.005,
    auto: true, moveSpeed: 0.97,
  },
  AR77: {
    name: 'AR-77', price: 2700, damage: 33, headMult: 3.5,
    fireDelay: 0.1, mag: 30, reserve: 90, reloadTime: 1.9,
    spreadStand: 0.0025, spreadMove: 0.024, recoil: 0.009,
    auto: true, moveSpeed: 0.94,
  },
  LR90: {
    name: 'LR-90', price: 4750, damage: 88, headMult: 4,
    fireDelay: 1.1, mag: 5, reserve: 15, reloadTime: 2.6,
    spreadStand: 0.0008, spreadMove: 0.03, recoil: 0.03,
    auto: false, moveSpeed: 0.9,
  },
};

export const GRENADE_PRICES = { frag: 300, smoke: 300, flash: 200 };
export const ARMOR_PRICE = 650;

// Panjang laras tiap senjata, menentukan bentuk view model.
const BARREL_LEN = { P9: 0.16, VK9: 0.3, AR77: 0.42, LR90: 0.55 };
// Posisi dasar view model di ruang kamera (kanan bawah).
const BASE_POS = new THREE.Vector3(0.26, -0.25, -0.5);
const KICK_MAX = 0.12;

function box(w, h, d, mat, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

// Bangun model senjata kecil dari kotak-kotak + flash moncong + lampu.
// Mengembalikan { group, flashMesh, flashLight, muzzleZ }.
function buildViewModel(key) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: PALETTE.dark, roughness: 0.55, metalness: 0.6,
  });
  const gripMat = new THREE.MeshStandardMaterial({
    color: PALETTE.surface, roughness: 0.85, metalness: 0.1,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: PALETTE.accent, roughness: 0.4, metalness: 0.6,
  });
  const barrelLen = BARREL_LEN[key] || 0.3;

  group.add(box(0.07, 0.09, 0.3, bodyMat, 0, 0, -0.05));
  group.add(box(0.045, 0.045, barrelLen, bodyMat, 0, 0.012, -0.2 - barrelLen / 2));
  const grip = box(0.06, 0.14, 0.07, gripMat, 0, -0.1, 0.06);
  grip.rotation.x = 0.35;
  group.add(grip);
  const mag = box(0.05, 0.12, 0.08, gripMat, 0, -0.1, -0.08);
  mag.rotation.x = -0.08;
  group.add(mag);
  group.add(box(0.075, 0.02, 0.05, trimMat, 0, 0.055, -0.12));

  if (key !== 'P9') {
    // Popor untuk senjata laras panjang.
    group.add(box(0.06, 0.08, 0.16, gripMat, 0, -0.01, 0.16));
  }
  if (key === 'LR90') {
    // Teropong silinder di atas receiver.
    const scope = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.028, 0.22, 12),
      trimMat,
    );
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.075, -0.08);
    group.add(scope);
    group.add(box(0.04, 0.03, 0.06, bodyMat, 0, 0.05, -0.08));
  }

  const muzzleZ = -0.2 - barrelLen;
  const flashMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.22),
    new THREE.MeshBasicMaterial({
      color: 0xffc46b, transparent: true, opacity: 0.95,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  flashMesh.position.set(0, 0.012, muzzleZ - 0.02);
  flashMesh.visible = false;
  group.add(flashMesh);

  const flashLight = new THREE.PointLight(0xffa040, 0, 3);
  flashLight.position.set(0, 0.02, muzzleZ);
  group.add(flashLight);

  group.position.copy(BASE_POS);
  return { group, flashMesh, flashLight };
}

export function createWeapon(camera, key) {
  const def = WEAPONS[key];
  const state = {
    key,
    mag: def.mag,
    reserve: def.reserve,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
  };

  // Bila camera null, pakai view tiruan (posisi + rotasi saja, tanpa mesh)
  // supaya step() tetap bisa jalan di mode headless.
  let view = {
    position: BASE_POS.clone(),
    rotation: new THREE.Euler(),
  };
  let group = null;
  let flashMesh = null;
  let flashLight = null;
  if (camera) {
    const built = buildViewModel(key);
    group = built.group;
    flashMesh = built.flashMesh;
    flashLight = built.flashLight;
    view = group;
    camera.add(group);
  }

  function step(dt) {
    if (state.cooldown > 0) state.cooldown = Math.max(0, state.cooldown - dt);
    if (state.flash > 0) state.flash = Math.max(0, state.flash - dt);
    if (state.kick > 0) state.kick = Math.max(0, state.kick - dt * 0.25);

    if (state.reloadLeft > 0) {
      state.reloadLeft -= dt;
      if (state.reloadLeft <= 0) {
        state.reloadLeft = 0;
        const need = def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }

    // Animasi view model: tendangan ke belakang saat menembak,
    // miring ke bawah saat reload, flash moncong + cahaya saat menembak.
    view.position.z = BASE_POS.z + state.kick * 0.8;
    if (state.reloadLeft > 0) {
      const p = 1 - state.reloadLeft / def.reloadTime;
      const dip = Math.sin(p * Math.PI);
      view.rotation.x = -dip * 0.45;
      view.position.y = BASE_POS.y - dip * 0.08;
    } else {
      view.rotation.x = state.kick * 1.2;
      view.position.y = BASE_POS.y;
    }

    if (flashMesh) {
      flashMesh.visible = state.flash > 0;
      if (state.flash > 0) {
        flashMesh.rotation.z = Math.random() * Math.PI * 2;
        const s = 0.8 + Math.random() * 0.5;
        flashMesh.scale.set(s, s, 1);
      }
    }
    if (flashLight) flashLight.intensity = state.flash > 0 ? 6 : 0;
  }

  return {
    def,
    state,

    step,

    ready() {
      return state.mag > 0 && state.cooldown <= 0 && state.reloadLeft <= 0;
    },

    pullTrigger() {
      state.cooldown = def.fireDelay;
      state.flash = 0.06;
      state.kick = Math.min(KICK_MAX, state.kick + def.recoil);
    },

    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },

    reload() {
      if (state.mag >= def.mag || state.reserve <= 0 || state.reloadLeft > 0) {
        return false;
      }
      state.reloadLeft = def.reloadTime;
      return true;
    },

    spread(speed) {
      return def.spreadStand + Math.min(1, speed / 5.2) * def.spreadMove;
    },

    refill() {
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },

    dispose(cam) {
      const parent = cam || camera;
      if (group && parent) parent.remove(group);
      if (group) {
        group.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) obj.material.dispose();
        });
      }
    },
  };
}
