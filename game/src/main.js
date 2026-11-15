// DUSTLINE — threejs-fps-02. Boot: renderer, fixed-step loop, pointer-lock
// flow, and the deterministic ?shot= captures (start / play / site / end)
// used for the entry screenshots. The simulation never reads the wall clock:
// every run with the same seed plays the same way.
import * as THREE from 'three';
import { createGame, FREEZE_TIME } from './game.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { unlockAudio } from './audio.js';
import { PALETTE } from './palette.js';
import { SITES } from './map.js';

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number(params.get('seed') ?? 1337);

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 24, 68);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 200);
camera.position.set(0, 1.6, 12.5);

const hud = createHud(app, (item) => game.buy(item));
const input = createInput(renderer.domElement, {
  onKey(code) {
    if (code === 'KeyB' && hud.buyVisible()) {
      hud.hideBuy();
      renderer.domElement.requestPointerLock();
    }
    game.onKey(code);
  },
  onLockChange(locked) {
    if (locked) {
      unlockAudio();
      hud.hideHelp();
      if (game.state.phase === 'menu') game.startMatch();
      else if (game.state.phase === 'matchEnd') game.startMatch();
    } else if (!shot) {
      if (game.state.phase !== 'menu' && !hud.buyVisible()) hud.showHelp();
    }
  },
});

const game = createGame({ scene, camera, hud, input, seed });
if (!shot) hud.showHelp();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Buy menu needs a free cursor: unlock the pointer while it is open.
const observer = new MutationObserver(() => {
  if (hud.buyVisible() && document.pointerLockElement) document.exitPointerLock();
});
observer.observe(document.querySelector('.buy-menu'), { attributes: true, attributeFilter: ['style'] });

window.__game = game;

const STEP = 1 / 60;
let accumulator = 0;
let lastTime = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const frameDt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  accumulator += frameDt;
  let steps = 0;
  const playing = input.locked || hud.buyVisible() || shot;
  while (accumulator >= STEP && steps < 5) {
    if (playing && game.state.phase !== 'menu') game.step(STEP);
    accumulator -= STEP;
    steps += 1;
  }
  if (steps === 5) accumulator = 0;
  game.syncCamera(frameDt);
  game.updateHud(frameDt);
  renderer.render(scene, camera);
}

// ---- deterministic captures ----------------------------------------------
function runSteps(n) {
  for (let i = 0; i < n; i += 1) game.step(STEP);
}

function aimPlayerAt(x, y, z) {
  const eye = game.player.agent.eyePosition(new THREE.Vector3());
  const dx = x - eye.x;
  const dy = y - eye.y;
  const dz = z - eye.z;
  game.player.agent.state.yaw = Math.atan2(-dx, -dz);
  game.player.agent.state.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}

function setupShot(kind) {
  game.setShotMode(true);
  game.resetForShot(seed);
  hud.hideHelp();
  if (kind !== 'start') hud.hideBanner();
  const player = game.player;
  if (kind === 'start') {
    // Spawn view down mid: teammates walking ahead, site letters ahead.
    runSteps(60);
    aimPlayerAt(0, 1.2, -6);
  } else if (kind === 'play') {
    // Mid-lane firefight: an enemy bot crossing mid, player firing first.
    // The player aims at the head: one AR-77 headshot (115 dmg) drops the
    // bot before its reaction delay is up, so the player survives the shot.
    const enemy = game.bots.find((b) => b.team === 'defenders');
    enemy.agent.teleport(0, -4, Math.PI);
    enemy.body.group.position.set(0, 0, -4);
    player.agent.teleport(0, 8, 0);
    runSteps(10);
    for (let i = 0; i < 3; i += 1) {
      const target = enemy.agent.state.position;
      aimPlayerAt(target.x, target.y + 1.62, target.z);
      game.debugShoot();
      runSteps(6);
    }
    runSteps(12);
  } else if (kind === 'site') {
    // Bomb planted at Site A, a defender pushing in to defuse. The player
    // stands south-east of the site, dome and ring in frame, rusher in view.
    player.agent.teleport(-7.5, -5.5, 0);
    game.bomb.forcePlant(SITES.A);
    const rusher = game.bots.find((b) => b.team === 'defenders' && b.site === 'A');
    rusher.agent.teleport(-9.5, -7.5, Math.PI);
    runSteps(20);
    aimPlayerAt(-11.5, 1.0, -9.5);
  } else if (kind === 'end') {
    // Round won: score 1-0, bomb site behind the banner. The explosion is
    // spawned last so it is still bright in the captured frame.
    game.state.scoreAtk = 1;
    game.state.round = 2;
    player.agent.teleport(-7.5, -5.5, 0);
    game.bomb.forcePlant(SITES.A);
    runSteps(30);
    game.effects.spawnExplosion(new THREE.Vector3(-11.5, 0.5, -9.5));
    runSteps(8);
    aimPlayerAt(-11.5, 1.2, -9.5);
    hud.showBanner('ROUND WON', 'Bomb detonated — Site A', 10);
  }
  // Two renders so the frame the screenshot sees is fully settled.
  game.syncCamera(STEP);
  game.updateHud(STEP);
  renderer.render(scene, camera);
  game.syncCamera(STEP);
  renderer.render(scene, camera);
  window.__shotReady = true;
}

if (shot) {
  setupShot(shot);
} else {
  requestAnimationFrame(frame);
}
