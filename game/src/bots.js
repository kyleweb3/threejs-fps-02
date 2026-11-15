// DUSTLINE — threejs-fps-02 — bots: waypoint walkers with a small state
// machine — go to a site, hold an angle, engage what they see, investigate
// noise, plant or defuse the bomb. Perception is honest: distance + field
// of view + line of sight, blocked by smoke, with a reaction delay before
// the first shot. Aim error grows with distance, target speed and own
// movement, so fights are winnable.
import * as THREE from 'three';
import { createAgent } from './agent.js';
import { createWeapon } from './weapons.js';
import { losClear, nearestNode, findPath } from './map.js';
import { PALETTE } from './palette.js';

const FOV_COS = Math.cos((110 / 2) * Math.PI / 180);
const SIGHT_RANGE = 42;

// Per-round bot loadout (threejs-fps-02). Weapon keys are the exact keys of
// weapons.js: P9 (P9 sidearm), VK9 (VK-9 smg), AR77 (AR-77 rifle), LR90
// (LR-90 marksman). Rounds 1–2 are pistol/SMG rounds (P9 or VK-9). From
// round 3 on, most bots carry the AR-77 rifle and one designated sniper per
// team carries the LR-90. A team that lost the previous round falls back to
// the cheap guns (P9 / VK-9) instead. The player economy and buy menu are
// untouched — this only picks what bots spawn with.
export function pickBotWeaponKey(round, { lostLastRound = false, isSniper = false, rng = null } = {}) {
  const cheap = () => (rng && rng.random() < 0.5 ? 'P9' : 'VK9');
  if (lostLastRound) return cheap();
  if (round <= 2) return cheap();
  if (isSniper) return 'LR90';
  return 'AR77';
}

export function canSee(ax, az, bx, bz, walls, smokes, eyeY = 1.5) {
  if (!losClear(ax, az, bx, bz, walls, eyeY)) return false;
  for (const smoke of smokes) {
    // Segment vs sphere: does the sight line pass through the cloud?
    const dx = bx - ax;
    const dz = bz - az;
    const lenSq = dx * dx + dz * dz;
    if (lenSq < 1e-6) continue;
    let t = ((smoke.x - ax) * dx + (smoke.z - az) * dz) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + dx * t;
    const cz = az + dz * t;
    const d2 = (cx - smoke.x) * (cx - smoke.x) + (cz - smoke.z) * (cz - smoke.z);
    if (d2 < smoke.radius * smoke.radius) return false;
  }
  return true;
}

function nameSprite(name, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 48;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(name, 128, 24);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(1.5, 0.28, 1);
  return sprite;
}

function buildBody(scene, team) {
  const group = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: new THREE.Color(team === 'attackers' ? PALETTE.friend : PALETTE.enemy), roughness: 0.85, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.dark), roughness: 0.9, metalness: 0.05 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), suit);
  torso.position.y = 1.15;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), suit);
  head.position.y = 1.62;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.72, 0.28), dark);
  legs.position.y = 0.42;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.55), dark);
  gun.position.set(0.28, 1.2, -0.2);
  group.add(torso, head, legs, gun);
  group.traverse((mesh) => { if (mesh.isMesh) mesh.castShadow = true; });
  scene.add(group);
  return { group, head, torso, legs };
}

export function createBot(scene, opts, world) {
  const { name, team, spawn, weaponKey, rng, site } = opts;
  const agent = createAgent(world.map.colliders, spawn);
  let weapon = createWeapon(null, weaponKey);
  const body = buildBody(scene, team);
  const label = nameSprite(name, team === 'attackers' ? PALETTE.friend : PALETTE.enemy);
  label.position.y = 2.05;
  body.group.add(label);

  const bot = {
    name,
    team,
    isBot: true,
    alive: true,
    hp: 100,
    armor: 0,
    money: 800,
    weapon,
    agent,
    body,
    state: team === 'attackers' ? 'toSite' : 'hold',
    site,
    path: [],
    pathIndex: 0,
    repathIn: 0,
    thinkIn: rng.range(0, 0.15),
    target: null,
    reactUntil: 0,
    burstLeft: 0,
    burstPause: 0,
    strafeDir: 1,
    strafeIn: 0,
    holdNode: null,
    investigatePos: null,
    investigateUntil: 0,
    smokeLeft: team === 'attackers' ? 1 : 0,
    smokeThrown: false,
    aimError: 0,
    blindUntil: 0,
    flash: 0,
    // Per-round loadout (threejs-fps-02): the bot whose starting weapon is
    // the LR-90 is the team's designated sniper (opts.sniper can mark one
    // explicitly); `round` counts resets so the loadout follows the match
    // even when no round info is passed in.
    isSniper: weaponKey === 'LR90' || opts.sniper === true,
    round: 1,
  };

  function eye(out) {
    return agent.eyePosition(out);
  }

  function perceive(now, enemies, smokes) {
    const from = eye(new THREE.Vector3());
    const forward = new THREE.Vector3(-Math.sin(agent.state.yaw), 0, -Math.cos(agent.state.yaw));
    let best = null;
    let bestD = Infinity;
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const dx = enemy.agent.state.position.x - from.x;
      const dz = enemy.agent.state.position.z - from.z;
      const dist = Math.hypot(dx, dz);
      if (dist > SIGHT_RANGE || dist >= bestD) continue;
      const dir = new THREE.Vector3(dx / dist, 0, dz / dist);
      if (forward.dot(dir) < FOV_COS && dist > 3) continue;
      if (!canSee(from.x, from.z, enemy.agent.state.position.x, enemy.agent.state.position.z, world.map.walls, smokes)) continue;
      best = enemy;
      bestD = dist;
    }
    if (best && bot.target !== best) {
      bot.reactUntil = now + rng.range(0.4, 0.7);
      bot.burstLeft = rng.int(2, 4);
    }
    bot.target = best;
    return best;
  }

  function moveToward(dt, tx, tz, speedScale = 1) {
    const pos = agent.state.position;
    const dx = tx - pos.x;
    const dz = tz - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.35) return true;
    const desired = Math.atan2(-dx, -dz);
    let dyaw = desired - agent.state.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    agent.state.yaw += Math.max(-3.2 * dt, Math.min(3.2 * dt, dyaw));
    const forward = Math.cos(dyaw);
    const strafe = Math.sin(dyaw);
    agent.step(dt, { forward: Math.max(0, forward), strafe, crouch: false, jump: false }, speedScale);
    return false;
  }

  function followPath(dt) {
    if (bot.pathIndex >= bot.path.length) return true;
    const node = world.map.waypoints[bot.path[bot.pathIndex]];
    if (moveToward(dt, node.x, node.z)) bot.pathIndex += 1;
    return bot.pathIndex >= bot.path.length;
  }

  function setPathTo(nodeIndex) {
    const from = nearestNode(world.map.waypoints, agent.state.position.x, agent.state.position.z);
    bot.path = findPath(world.map.edges, from, nodeIndex);
    bot.pathIndex = 0;
  }

  function aimAt(target, dt, now) {
    const from = eye(new THREE.Vector3());
    const chestY = target.agent.state.position.y + 1.25;
    const dx = target.agent.state.position.x - from.x;
    const dy = chestY - from.y;
    const dz = target.agent.state.position.z - from.z;
    const dist = Math.hypot(dx, dy, dz);
    const speed = Math.hypot(target.agent.state.velocity.x, target.agent.state.velocity.z);
    const ownSpeed = agent.groundSpeed();
    const err = 0.02 + dist * 0.002 + speed * 0.006 + ownSpeed * 0.004;
    bot.aimError = err;
    const desiredYaw = Math.atan2(-dx, -dz) + rng.gauss() * err * 0.4;
    const desiredPitch = Math.atan2(dy, Math.hypot(dx, dz)) + rng.gauss() * err * 0.4;
    let dyaw = desiredYaw - agent.state.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    agent.state.yaw += Math.max(-6 * dt, Math.min(6 * dt, dyaw));
    agent.state.pitch += Math.max(-6 * dt, Math.min(6 * dt, desiredPitch - agent.state.pitch));
    return dist;
  }

  function step(dt, now, ctx) {
    // ctx: { enemies, smokes, noise, bomb, rng, time }
    if (!bot.alive) return { shoot: false };
    weapon.step(dt);
    bot.thinkIn -= dt;
    const blind = now < bot.blindUntil;
    if (bot.thinkIn <= 0) {
      bot.thinkIn = 0.15;
      perceive(now, ctx.enemies, ctx.smokes);
      // Hear the nearest recent shot.
      if (!bot.target) {
        for (const noise of ctx.noise) {
          const d = Math.hypot(noise.x - agent.state.position.x, noise.z - agent.state.position.z);
          if (d < 30 && rng.random() < 0.35) {
            bot.investigatePos = { x: noise.x, z: noise.z };
            bot.investigateUntil = now + 4;
            bot.state = 'investigate';
            break;
          }
        }
      }
    }

    const intent = { shoot: false, throwGrenade: null, wantsPlant: false, wantsDefuse: false };
    const pos = agent.state.position;

    // Defenders rush a planted bomb; attackers defend the carrier's plant.
    if (world.bomb.state.mode === 'planted' && bot.team === 'defenders') bot.state = 'toSite';
    if (world.bomb.state.mode === 'planted' && bot.team === 'attackers') bot.state = 'hold';

    if (bot.target && !blind && now >= bot.reactUntil) {
      // Engage: aim, burst fire, strafe.
      const dist = aimAt(bot.target, dt, now);
      bot.strafeIn -= dt;
      if (bot.strafeIn <= 0) {
        bot.strafeIn = rng.range(0.5, 1.2);
        bot.strafeDir = rng.random() < 0.5 ? -1 : 1;
      }
      if (dist > 5) {
        agent.step(dt, { forward: dist > 22 ? 0.7 : 0, strafe: bot.strafeDir * 0.6, crouch: false, jump: false }, 0.8);
      } else {
        agent.step(dt, { forward: -0.5, strafe: bot.strafeDir * 0.5, crouch: false, jump: false }, 0.8);
      }
      if (bot.burstPause > 0) {
        bot.burstPause -= dt;
      } else if (bot.burstLeft > 0 && weapon.ready()) {
        intent.shoot = true;
        bot.burstLeft -= 1;
        if (bot.burstLeft === 0) {
          bot.burstPause = rng.range(0.7, 1.4);
          bot.burstLeft = rng.int(2, 4);
        }
      }
      if (weapon.state.mag === 0) weapon.reload();
      return intent;
    }

    // No target: follow the role.
    if (bot.state === 'investigate' && bot.investigatePos) {
      if (now > bot.investigateUntil) {
        bot.state = bot.team === 'attackers' ? 'toSite' : 'hold';
        bot.investigatePos = null;
      } else if (moveToward(dt, bot.investigatePos.x, bot.investigatePos.z)) {
        bot.state = bot.team === 'attackers' ? 'toSite' : 'hold';
        bot.investigatePos = null;
      }
      return intent;
    }

    if (bot.team === 'attackers') {
      const siteDef = world.sites[bot.site];
      // A dropped bomb is the priority: go fetch it before pushing the site.
      if (world.bomb.state.mode === 'dropped') {
        const bp = world.bomb.state.pos;
        const distBomb = Math.hypot(bp.x - pos.x, bp.z - pos.z);
        if (distBomb > 1.4) {
          bot.repathIn -= dt;
          if (bot.repathIn <= 0 || bot.pathIndex >= bot.path.length) {
            bot.repathIn = 1;
            setPathTo(nearestNode(world.map.waypoints, bp.x, bp.z));
          }
          followPath(dt);
        }
        return intent;
      }
      const distSite = Math.hypot(siteDef.x - pos.x, siteDef.z - pos.z);
      if (bot.state === 'toSite') {
        if (distSite < 3.4) {
          bot.state = 'hold';
          if (world.bomb.state.carrier === bot && world.bomb.state.mode === 'carried') intent.wantsPlant = true;
        } else {
          // Smoke the site approach once, from ~14 m out.
          if (bot.smokeLeft > 0 && !bot.smokeThrown && distSite < 14 && distSite > 8) {
            intent.throwGrenade = 'smoke';
            bot.smokeLeft -= 1;
            bot.smokeThrown = true;
          }
          bot.repathIn -= dt;
          if (bot.repathIn <= 0 || bot.pathIndex >= bot.path.length) {
            bot.repathIn = 2;
            setPathTo(nearestNode(world.map.waypoints, siteDef.x, siteDef.z));
          }
          followPath(dt);
        }
      } else if (bot.state === 'hold') {
        // Hold the site, face the main approach.
        const approach = world.map.waypoints[nearestNode(world.map.waypoints, siteDef.x, siteDef.z + 6)];
        const desired = Math.atan2(-(approach.x - pos.x), -(approach.z - pos.z));
        let dyaw = desired - agent.state.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        agent.state.yaw += Math.max(-2 * dt, Math.min(2 * dt, dyaw));
        if (world.bomb.state.carrier === bot && world.bomb.state.mode === 'carried') intent.wantsPlant = true;
      }
    } else {
      // Defenders: hold their site, or rush the planted bomb.
      const bombPlanted = world.bomb.state.mode === 'planted';
      const goal = bombPlanted ? world.bomb.state.site : world.sites[bot.site];
      const distGoal = Math.hypot(goal.x - pos.x, goal.z - pos.z);
      if (bombPlanted && distGoal < 2.2) {
        intent.wantsDefuse = true;
      } else if (distGoal > 4) {
        bot.repathIn -= dt;
        if (bot.repathIn <= 0 || bot.pathIndex >= bot.path.length) {
          bot.repathIn = 2;
          setPathTo(nearestNode(world.map.waypoints, goal.x, goal.z));
        }
        followPath(dt);
      } else {
        // Hold an angle: face the site approach, occasionally crouch.
        const approach = world.map.waypoints[nearestNode(world.map.waypoints, goal.x, goal.z + 6)];
        const desired = Math.atan2(-(approach.x - pos.x), -(approach.z - pos.z));
        let dyaw = desired - agent.state.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        agent.state.yaw += Math.max(-2 * dt, Math.min(2 * dt, dyaw));
      }
    }

    if (weapon.state.mag === 0) weapon.reload();
    return intent;
  }

  function damage(amount, zone) {
    let dmg = amount;
    if (zone === 'head') dmg *= 3.5;
    else if (zone === 'legs') dmg *= 0.75;
    if (bot.armor > 0) {
      const absorbed = Math.min(bot.armor, dmg * 0.5);
      bot.armor -= absorbed;
      dmg -= absorbed;
    }
    bot.hp -= dmg;
    if (bot.hp <= 0) {
      bot.hp = 0;
      bot.alive = false;
      body.group.rotation.x = -Math.PI / 2;
      body.group.position.y = 0.25;
      label.visible = false;
      return true;
    }
    return false;
  }

  function reset(spawn, newSite, roundInfo) {
    // Per-round loadout (threejs-fps-02): re-pick the bot's weapon for the
    // round that is starting. roundInfo is optional — { round,
    // lostLastRound } — and game.js may pass it later; without it the bot
    // counts its own resets (one reset per round) and assumes the team did
    // not lose the previous round.
    const round = roundInfo && typeof roundInfo.round === 'number' ? roundInfo.round : bot.round;
    const lostLastRound = !!(roundInfo && roundInfo.lostLastRound);
    const key = pickBotWeaponKey(round, { lostLastRound, isSniper: bot.isSniper, rng });
    if (key !== weapon.state.key) {
      weapon = createWeapon(null, key);
      bot.weapon = weapon;
    }
    bot.round = round + 1;
    bot.alive = true;
    bot.hp = 100;
    bot.armor = 0;
    bot.site = newSite;
    bot.state = team === 'attackers' ? 'toSite' : 'hold';
    bot.path = [];
    bot.pathIndex = 0;
    bot.target = null;
    bot.smokeLeft = team === 'attackers' ? 1 : 0;
    bot.smokeThrown = false;
    bot.blindUntil = 0;
    agent.teleport(spawn.x, spawn.z, spawn.yaw);
    weapon.refill();
    body.group.rotation.x = 0;
    body.group.position.y = 0;
    label.visible = true;
  }

  function syncVisual() {
    if (!bot.alive) return;
    body.group.position.set(agent.state.position.x, agent.state.position.y, agent.state.position.z);
    body.group.rotation.y = agent.state.yaw + Math.PI;
  }

  return { ...bot, step, damage, reset, syncVisual, agent, get weapon() { return weapon; }, body };
}
