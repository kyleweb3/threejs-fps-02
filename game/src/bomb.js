// DUSTLINE — threejs-fps-02
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;
export const FUSE_TIME = 35;

const _center = new THREE.Vector3();

// Situs bisa membawa titik tengah sebagai Vector3 (center/pos) atau
// koordinat datar (x/z, cx/cz). Ambil bentuk mana pun yang tersedia.
function siteCenter(site, out) {
  if (!site) return out.set(0, 0, 0);
  const c = site.center || site.pos || null;
  if (c) return out.set(c.x, c.y || 0, c.z);
  const x = site.x !== undefined ? site.x : (site.cx !== undefined ? site.cx : 0);
  const z = site.z !== undefined ? site.z : (site.cz !== undefined ? site.cz : 0);
  const y = site.y !== undefined ? site.y : 0;
  return out.set(x, y, z);
}

export function createBomb(scene) {
  const state = {
    mode: 'carried',
    carrier: null,
    planter: null,
    defuser: null,
    site: null,
    pos: new THREE.Vector3(),
    progress: 0,
    fuse: FUSE_TIME,
    blink: false,
  };

  // Model: kotak gelap kecil dengan bola lampu merah di atasnya.
  const group = new THREE.Group();
  const boxMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.dark),
    roughness: 0.6,
    metalness: 0.35,
  });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.26), boxMat);
  box.position.y = 0.11;
  group.add(box);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), lampMat);
  lamp.position.y = 0.28;
  group.add(lamp);
  group.visible = false;
  scene.add(group);

  let blinkTimer = 0;

  function setCarrier(agent) {
    state.mode = 'carried';
    state.carrier = agent;
    state.planter = null;
    state.defuser = null;
    state.progress = 0;
    group.visible = false;
  }

  function dropAt(x, y, z) {
    state.mode = 'dropped';
    state.carrier = null;
    state.planter = null;
    state.defuser = null;
    state.progress = 0;
    state.pos.set(x, y, z);
    group.position.set(x, y + 0.02, z);
    group.visible = true;
  }

  function startPlant(site) {
    if (state.mode !== 'carried') return false;
    state.mode = 'planting';
    state.site = site;
    state.planter = state.carrier;
    state.progress = 0;
    return true;
  }

  function startDefuse(agent) {
    if (state.mode !== 'planted') return false;
    state.mode = 'defusing';
    state.defuser = agent;
    state.progress = 0;
    return true;
  }

  function cancel() {
    if (state.mode === 'planting') {
      state.mode = 'carried';
      state.planter = null;
      state.progress = 0;
    } else if (state.mode === 'defusing') {
      state.mode = 'planted';
      state.defuser = null;
      state.progress = 0;
    }
  }

  function forcePlant(site) {
    siteCenter(site, _center);
    state.mode = 'planted';
    state.site = site;
    state.planter = null;
    state.defuser = null;
    state.fuse = FUSE_TIME;
    state.progress = 0;
    state.pos.copy(_center);
    group.position.set(_center.x, _center.y + 0.02, _center.z);
    group.visible = true;
  }

  function step(dt) {
    const events = [];

    // Lampu berkedip; di bawah 10 detik fuse, kedipnya jauh lebih cepat.
    if (state.mode === 'planted' || state.mode === 'defusing') {
      blinkTimer += dt;
      const interval = state.fuse < 10 ? 0.15 : 0.5;
      if (blinkTimer >= interval) {
        blinkTimer = 0;
        state.blink = !state.blink;
        lamp.visible = state.blink;
      }
    } else {
      state.blink = false;
      lamp.visible = true;
    }

    if (state.mode === 'planting') {
      state.progress += dt;
      if (state.progress >= PLANT_TIME) {
        siteCenter(state.site, _center);
        state.mode = 'planted';
        state.fuse = FUSE_TIME;
        state.progress = 0;
        state.pos.copy(_center);
        group.position.set(_center.x, _center.y + 0.02, _center.z);
        group.visible = true;
        events.push({ type: 'planted', site: state.site, planter: state.planter });
      }
    } else if (state.mode === 'planted') {
      state.fuse -= dt;
      if (state.fuse <= 0) {
        state.fuse = 0;
        state.mode = 'detonated';
        group.visible = false;
        events.push({ type: 'detonated', site: state.site });
      }
    } else if (state.mode === 'defusing') {
      state.progress += dt;
      if (state.progress >= DEFUSE_TIME) {
        state.mode = 'defused';
        state.progress = 0;
        group.visible = false;
        events.push({ type: 'defused' });
      }
    }
    return events;
  }

  return { state, setCarrier, dropAt, startPlant, startDefuse, cancel, step, group, forcePlant };
}
