// DUSTLINE — threejs-fps-02 — game: one state store, one fixed-step
// simulation. Rounds, economy, the bomb, shooting, grenades and bots all
// live here; rendering only reads the store. No wall clock, no Math.random
// in the sim — only the seeded rng.
import * as THREE from 'three';
import { createAgent } from './agent.js';
import { createWeapon, WEAPONS, GRENADE_PRICES, ARMOR_PRICE } from './weapons.js';
import { createBot } from './bots.js';
import { createBomb, PLANT_TIME, DEFUSE_TIME } from './bomb.js';
import { createGrenades } from './grenades.js';
import { createEffects } from './effects.js';
import { sfx } from './audio.js';
import { createMap, SITES, SPAWNS } from './map.js';
import { makeRng } from './rng.js';

export const ROUND_TIME = 100;
export const FREEZE_TIME = 8;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;

const ATTACKER_NAMES = ['Vex', 'Mara'];
const DEFENDER_NAMES = ['Rook', 'Sable', 'Ivy', 'Dune', 'Pike'];
const DEFENDER_WEAPONS = ['AR77', 'AR77', 'VK9', 'AR77', 'LR90'];

export function createGame({ scene, camera, hud, input, seed = 1337 }) {
  const rng = makeRng(seed);
  const mapData = createMap(scene);
  const effects = createEffects(scene);
  const grenades = createGrenades(scene, effects);
  const bomb = createBomb(scene);
  const raycaster = new THREE.Raycaster();
  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();

  const world = { map: mapData, sites: SITES, bomb };

  const playerAgent = createAgent(mapData.colliders, SPAWNS.attackers[1]);
  const pistol = createWeapon(camera, 'P9');
  const primary = createWeapon(camera, 'AR77');
  const player = {
    name: 'You', team: 'attackers', isBot: false, alive: true,
    hp: 100, armor: 0, money: 800,
    agent: playerAgent, pistol, primary,
    current: primary,
    grenades: { frag: 1, smoke: 1, flash: 1 },
    grenadeSelected: 'frag',
    blindUntil: 0, blind: 0,
  };

  const bots = [];
  ATTACKER_NAMES.forEach((name, i) => {
    bots.push(createBot(scene, {
      name, team: 'attackers',
      spawn: SPAWNS.attackers[i === 0 ? 0 : 2],
      weaponKey: i === 0 ? 'VK9' : 'AR77',
      rng, site: 'A',
    }, world));
  });
  DEFENDER_NAMES.forEach((name, i) => {
    bots.push(createBot(scene, {
      name, team: 'defenders',
      spawn: SPAWNS.defenders[i],
      weaponKey: DEFENDER_WEAPONS[i],
      rng, site: i < 2 ? 'A' : i < 4 ? 'B' : 'A',
    }, world));
  });
  const agents = [player, ...bots];

  const state = {
    phase: 'menu', // menu | freeze | live | roundEnd | matchEnd
    round: 1,
    scoreAtk: 0,
    scoreDef: 0,
    timeLeft: ROUND_TIME,
    freezeLeft: FREEZE_TIME,
    endTimer: 0,
    time: 0,
    winner: null,
    matchWinner: null,
    noise: [],
    shotMode: false,
    spectate: null,
  };

  // ---- shooting ---------------------------------------------------------
  function rayHit(shooter, from, dir, maxDist = 60) {
    raycaster.set(from, dir);
    raycaster.far = maxDist;
    const wallHits = raycaster.intersectObjects(mapData.shootables, false);
    const wallDist = wallHits.length > 0 ? wallHits[0].distance : maxDist;
    let best = null;
    for (const agent of agents) {
      if (agent === shooter || !agent.alive || agent.team === shooter.team) continue;
      const cx = agent.agent.state.position.x;
      const cz = agent.agent.state.position.z;
      const feet = agent.agent.state.position.y;
      // Ray vs vertical cylinder in the XZ plane.
      const ox = from.x - cx;
      const oz = from.z - cz;
      const a = dir.x * dir.x + dir.z * dir.z;
      if (a < 1e-8) continue;
      const b = 2 * (ox * dir.x + oz * dir.z);
      const c = ox * ox + oz * oz - 0.34 * 0.34;
      const disc = b * b - 4 * a * c;
      if (disc < 0) continue;
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t < 0 || t > wallDist) continue;
      const hitY = from.y + dir.y * t;
      if (hitY < feet || hitY > feet + 1.72) continue;
      const zone = hitY > feet + 1.45 ? 'head' : hitY < feet + 0.6 ? 'legs' : 'torso';
      if (!best || t < best.dist) {
        best = { type: 'agent', agent, zone, dist: t, point: from.clone().addScaledVector(dir, t) };
      }
    }
    if (best) return best;
    if (wallHits.length > 0) return { type: 'wall', dist: wallDist, point: wallHits[0].point.clone(), normal: wallHits[0].face?.normal ?? null };
    return { type: 'wall', dist: maxDist, point: from.clone().addScaledVector(dir, maxDist) };
  }

  function applyDamage(target, amount, zone, attacker) {
    let dmg = amount;
    if (zone === 'head') dmg *= 3.5;
    else if (zone === 'legs') dmg *= 0.75;
    if (target.armor > 0) {
      const absorbed = Math.min(target.armor, dmg * 0.5);
      target.armor -= absorbed;
      dmg -= absorbed;
    }
    target.hp -= dmg;
    if (target === player) {
      hud.damageFlash();
      sfx.hurt();
    }
    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      if (target.isBot) {
        target.damage(0, 'torso'); // visual fall is in damage(); hp already 0
      } else {
        state.spectate = bots.find((b) => b.alive && b.team === 'attackers') ?? bots.find((b) => b.alive) ?? null;
      }
      if (attacker && attacker.team === 'attackers') attacker.money += 300;
      // Only a carried (or planting) bomb drops on death — a planted bomb
      // stays planted.
      if (bomb.state.carrier === target && (bomb.state.mode === 'carried' || bomb.state.mode === 'planting')) {
        bomb.dropAt(target.agent.state.position.x, target.agent.state.position.y, target.agent.state.position.z);
      }
      hud.killfeed(attacker ? attacker.name : '—', target.name, zone === 'head', attacker ? attacker.team : 'attackers');
      if (attacker === player) sfx.kill();
      return true;
    }
    return false;
  }

  function shoot(shooter, from, yaw, pitch, weapon) {
    if (!weapon.takeRound()) {
      weapon.reload();
      sfx.dryFire();
      return;
    }
    weapon.pullTrigger();
    const spread = weapon.spread(shooter.agent.groundSpeed()) * (shooter === player && input.aiming ? 0.7 : 1);
    const dir = new THREE.Vector3(
      -Math.sin(yaw) + rng.gauss() * spread,
      Math.tan(pitch) + rng.gauss() * spread,
      -Math.cos(yaw) + rng.gauss() * spread,
    ).normalize();
    const hit = rayHit(shooter, from, dir);
    const muzzle = from.clone().addScaledVector(dir, 0.6);
    muzzle.y -= 0.08;
    effects.spawnTracer(muzzle, hit.point);
    state.noise.push({ x: from.x, z: from.z, t: state.time });
    if (shooter === player) {
      player.agent.recoil(weapon.def.recoil, rng.gauss() * weapon.def.recoil * 0.5);
      sfx.shot(weapon.def === WEAPONS.AR77 ? 'AR77' : weapon.def === WEAPONS.LR90 ? 'LR90' : weapon.def === WEAPONS.VK9 ? 'VK9' : 'P9');
    }
    if (hit.type === 'agent') {
      applyDamage(hit.agent, weapon.def.damage, hit.zone, shooter);
      effects.spawnImpact(hit.point, 4);
      if (shooter === player) {
        hud.hitmark(!hit.agent.alive);
        sfx.hit();
      }
    } else {
      effects.spawnImpact(hit.point, 6);
    }
  }

  // ---- economy / buy ----------------------------------------------------
  function buy(item) {
    if (state.phase !== 'freeze') return false;
    const price = item.kind === 'weapon' ? WEAPONS[item.key].price
      : item.kind === 'grenade' ? GRENADE_PRICES[item.key]
      : ARMOR_PRICE;
    if (player.money < price) return false;
    player.money -= price;
    if (item.kind === 'weapon') {
      player.current.dispose(camera);
      player.primary = createWeapon(camera, item.key);
      player.current = player.primary;
    } else if (item.kind === 'grenade') {
      player.grenades[item.key] += 1;
    } else {
      player.armor = 100;
    }
    sfx.buy();
    return true;
  }

  // ---- rounds ------------------------------------------------------------
  function startRound() {
    const sitePick = rng.random() < 0.6 ? 'A' : 'B';
    player.alive = true;
    player.hp = 100;
    player.agent.teleport(SPAWNS.attackers[1].x, SPAWNS.attackers[1].z, 0);
    player.current.refill();
    player.pistol.refill();
    player.grenades = { frag: Math.max(player.grenades.frag, 1), smoke: Math.max(player.grenades.smoke, 1), flash: Math.max(player.grenades.flash, 1) };
    player.blindUntil = 0;
    state.spectate = null;
    bots.forEach((bot, i) => {
      const spawn = bot.team === 'attackers'
        ? SPAWNS.attackers[i === 0 ? 0 : 2]
        : SPAWNS.defenders[i - 2];
      const site = bot.team === 'attackers' ? sitePick : (i - 2 < 2 ? 'A' : i - 2 < 4 ? 'B' : sitePick);
      // Per-round loadout (threejs-fps-02): tell each bot the round number and
      // whether its team lost the previous round, so the losing team falls
      // back to the cheap guns. Round 1 has no previous winner (null).
      bot.reset(spawn, site, { round: state.round, lostLastRound: state.winner !== null && state.winner !== bot.team });
    });
    bomb.setCarrier(player);
    state.phase = 'freeze';
    state.freezeLeft = FREEZE_TIME;
    state.timeLeft = ROUND_TIME;
    state.noise = [];
    hud.showBanner(`ROUND ${state.round}`, sitePick === 'A' ? 'Attack Site A — Relay Dome' : 'Attack Site B — Pump House', 2.6);
    hud.showBuy(player.money);
  }

  function endRound(winner, reason) {
    state.phase = 'roundEnd';
    state.endTimer = 4;
    state.winner = winner;
    if (winner === 'attackers') {
      state.scoreAtk += 1;
      player.money += 325;
      for (const bot of bots) if (bot.team === 'attackers' && bot.alive) bot.money += 325;
    } else {
      state.scoreDef += 1;
      player.money += 190;
      for (const bot of bots) if (bot.team === 'attackers' && bot.alive) bot.money += 190;
    }
    hud.hideBuy();
    hud.showBanner(winner === 'attackers' ? 'ROUND WON' : 'ROUND LOST', reason, 3.5);
    if (winner === 'attackers') sfx.roundWin();
    else sfx.roundLose();
  }

  function endMatch(winner) {
    state.phase = 'matchEnd';
    state.matchWinner = winner;
    hud.showBanner(winner === 'attackers' ? 'VICTORY' : 'DEFEAT', `Final score ${state.scoreAtk} — ${state.scoreDef}. Click to play again.`, 10);
  }

  function checkRoundEnd() {
    const atkAlive = agents.some((a) => a.team === 'attackers' && a.alive);
    const defAlive = agents.some((a) => a.team === 'defenders' && a.alive);
    const planted = bomb.state.mode === 'planted' || bomb.state.mode === 'defusing';
    if (!atkAlive && !planted) return endRound('defenders', 'Your team was eliminated');
    if (!defAlive && !planted) return endRound('attackers', 'Enemy team eliminated');
    if (!atkAlive && planted) return; // bomb decides it
    if (planted && !defAlive) {
      // Site is clear and the bomb is ticking: skip the wait, detonate now.
      effects.spawnExplosion(new THREE.Vector3(bomb.state.site.x, 0.5, bomb.state.site.z));
      sfx.explosion();
      return endRound('attackers', 'Bomb planted — site clear');
    }
    if (state.timeLeft <= 0 && !planted) return endRound('defenders', 'Time expired — bomb not planted');
  }

  // ---- per-tick ----------------------------------------------------------
  let prevFiring = false;

  function step(dt) {
    state.time += dt;
    state.noise = state.noise.filter((n) => state.time - n.t < 2);

    if (state.phase === 'menu') return;
    if (state.phase === 'roundEnd') {
      state.endTimer -= dt;
      if (state.endTimer <= 0) {
        if (state.scoreAtk >= WIN_ROUNDS || state.scoreDef >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
          endMatch(state.scoreAtk > state.scoreDef ? 'attackers' : 'defenders');
        } else {
          state.round += 1;
          startRound();
        }
      }
      return;
    }
    if (state.phase === 'matchEnd') return;

    if (state.phase === 'freeze') {
      state.freezeLeft -= dt;
      if (state.freezeLeft <= 0) {
        state.phase = 'live';
        hud.hideBuy();
        hud.showBanner('GO', 'Plant the bomb at the marked site', 1.4);
      }
      // Bots hold still; the player can look around but not move.
      const look = input.consumeLook();
      player.agent.look(look.dx, look.dy);
      return;
    }

    // Live phase.
    state.timeLeft -= dt;
    const now = state.time;
    const blind = now < player.blindUntil;

    // Player.
    if (player.alive && !blind) {
      const look = input.consumeLook();
      player.agent.look(look.dx, look.dy);
      const move = input.move();
      const speedScale = input.walkHeld() ? 0.5 : 1;
      player.agent.step(dt, move, player.current.def.moveSpeed * speedScale);
      const firing = input.firing && !hud.buyVisible();
      const rising = firing && !prevFiring;
      prevFiring = firing;
      if (firing && (player.current.def.auto || rising) && player.current.ready()) {
        player.agent.eyePosition(tmpV);
        shoot(player, tmpV, player.agent.state.yaw, player.agent.state.pitch, player.current);
      }
      // Bomb pickup.
      if (bomb.state.mode === 'dropped') {
        const d = Math.hypot(bomb.state.pos.x - player.agent.state.position.x, bomb.state.pos.z - player.agent.state.position.z);
        if (d < 1.4) {
          bomb.setCarrier(player);
          hud.showBanner('BOMB PICKED UP', 'Plant it at Site A or B', 1.6);
        }
      }
      // Planting: hold E inside a site while carrying.
      if (bomb.state.mode === 'carried' && bomb.state.carrier === player && input.keys.has('KeyE')) {
        for (const site of Object.values(SITES)) {
          const d = Math.hypot(site.x - player.agent.state.position.x, site.z - player.agent.state.position.z);
          if (d < site.r && bomb.startPlant(site)) {
            sfx.beep();
            break;
          }
        }
      }
      if (bomb.state.mode === 'planting' && bomb.state.planter === player && !input.keys.has('KeyE')) bomb.cancel();
    } else if (player.alive && blind) {
      input.consumeLook();
    } else if (!player.alive) {
      input.consumeLook();
    }

    // Bots.
    const smokes = effects.smokes.filter((s) => now < s.until);
    for (const bot of bots) {
      if (!bot.alive) continue;
      const enemies = agents.filter((a) => a.team !== bot.team && a.alive);
      const intent = bot.step(dt, now, { enemies, smokes, noise: state.noise, bomb, rng, time: now });
      bot.syncVisual();
      if (intent.shoot && bot.weapon.ready()) {
        bot.agent.eyePosition(tmpV);
        shoot(bot, tmpV, bot.agent.state.yaw, bot.agent.state.pitch, bot.weapon);
      }
      if (intent.throwGrenade) {
        bot.agent.eyePosition(tmpV);
        tmpV2.set(-Math.sin(bot.agent.state.yaw), 0.35, -Math.cos(bot.agent.state.yaw)).normalize();
        grenades.throwGrenade(intent.throwGrenade, tmpV, tmpV2, bot);
      }
      if (intent.wantsPlant && bomb.state.mode === 'carried' && bomb.state.carrier === bot) {
        bomb.startPlant(SITES[bot.site]);
      }
      if (intent.wantsDefuse && bomb.state.mode === 'planted') {
        bomb.startDefuse(bot);
      }
      // Bot bomb pickup: attackers only — defenders never carry the bomb.
      if (bomb.state.mode === 'dropped' && bot.team === 'attackers') {
        const d = Math.hypot(bomb.state.pos.x - bot.agent.state.position.x, bomb.state.pos.z - bot.agent.state.position.z);
        if (d < 1.4) bomb.setCarrier(bot);
      }
    }

    // Grenades.
    const events = grenades.step(dt, mapData.walls, agents, now);
    for (const event of events) {
      if (event.type === 'frag') {
        sfx.explosion();
        for (const { agent, dmg } of event.victims) {
          if (agent === player) applyDamage(player, dmg, 'torso', null);
          else if (agent.isBot) {
            const died = agent.damage(dmg, 'torso');
            if (died) {
              if (bomb.state.carrier === agent) bomb.dropAt(agent.agent.state.position.x, agent.agent.state.position.y, agent.agent.state.position.z);
              hud.killfeed('Frag', agent.name, false, 'attackers');
            }
          }
        }
      } else if (event.type === 'flash') {
        for (const { agent, duration } of event.victims) {
          if (agent === player) {
            player.blindUntil = now + duration;
            hud.flashBlind(duration);
          } else {
            agent.blindUntil = now + duration;
          }
        }
      }
    }

    // Bomb.
    for (const event of bomb.step(dt)) {
      if (event.type === 'planted') {
        sfx.plant();
        if (event.planter) event.planter.money += 300;
        hud.showBanner('BOMB PLANTED', `Site ${event.site.letter} — defend it`, 2.4);
      } else if (event.type === 'detonated') {
        effects.spawnExplosion(new THREE.Vector3(event.site.x, 0.5, event.site.z));
        sfx.explosion();
        endRound('attackers', 'Bomb detonated');
        return;
      } else if (event.type === 'defused') {
        const defuser = bomb.state.defuser;
        if (defuser) defuser.money += 300;
        endRound('defenders', 'Bomb defused');
        return;
      }
    }
    if (bomb.state.mode === 'defusing') {
      // A defender holding defuse: cancel if they die or leave.
      const defuser = bomb.state.defuser;
      if (!defuser || !defuser.alive) bomb.cancel();
    }

    effects.update(dt, now);
    checkRoundEnd();
  }

  // ---- input keys --------------------------------------------------------
  function onKey(code) {
    if (state.phase === 'menu') return;
    if (code === 'KeyB' && state.phase === 'freeze') {
      if (hud.buyVisible()) hud.hideBuy();
      else hud.showBuy(player.money);
    }
    if (code === 'Escape' && hud.buyVisible()) hud.hideBuy();
    if (state.phase !== 'live' && state.phase !== 'freeze') return;
    if (code === 'Digit1' && player.current !== player.primary) {
      player.current = player.primary;
    } else if (code === 'Digit2' && player.current !== player.pistol) {
      player.current = player.pistol;
    } else if (code === 'Digit3') player.grenadeSelected = 'frag';
    else if (code === 'Digit4') player.grenadeSelected = 'smoke';
    else if (code === 'Digit5') player.grenadeSelected = 'flash';
    else if (code === 'KeyR') {
      player.current.reload();
      sfx.reload();
    } else if (code === 'KeyG' && state.phase === 'live' && player.alive) {
      const type = player.grenadeSelected;
      if (player.grenades[type] > 0) {
        player.agent.eyePosition(tmpV);
        tmpV2.set(-Math.sin(player.agent.state.yaw), 0.35, -Math.cos(player.agent.state.yaw)).normalize();
        if (grenades.throwGrenade(type, tmpV, tmpV2, player)) player.grenades[type] -= 1;
      }
    }
    // Buy-menu number keys.
    if (hud.buyVisible() && code.startsWith('Digit')) {
      const n = Number(code.slice(5));
      const items = [
        { kind: 'weapon', key: 'VK9' },
        { kind: 'weapon', key: 'AR77' },
        { kind: 'weapon', key: 'LR90' },
        { kind: 'weapon', key: 'P9' },
        { kind: 'grenade', key: 'frag' },
        { kind: 'grenade', key: 'smoke' },
        { kind: 'grenade', key: 'flash' },
        { kind: 'armor' },
      ];
      if (n >= 1 && n <= 8 && buy(items[n - 1])) hud.showBuy(player.money);
    }
  }

  // ---- camera + HUD snapshot ---------------------------------------------
  const BASE_FOV = 75;
  function syncCamera(dt) {
    let fovTarget = BASE_FOV;
    if (player.alive) {
      player.agent.eyePosition(tmpV);
      camera.position.copy(tmpV);
      camera.rotation.order = 'YXZ';
      camera.rotation.y = player.agent.state.yaw;
      camera.rotation.x = player.agent.state.pitch;
      camera.rotation.z = 0;
      if (input.aiming) fovTarget = 55;
    } else if (state.spectate) {
      state.spectate.agent.eyePosition(tmpV);
      camera.position.copy(tmpV);
      camera.rotation.order = 'YXZ';
      camera.rotation.y = state.spectate.agent.state.yaw;
      camera.rotation.x = state.spectate.agent.state.pitch;
      camera.rotation.z = 0;
    }
    if (Math.abs(camera.fov - fovTarget) > 0.1) {
      camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 10);
      camera.updateProjectionMatrix();
    }
  }

  function hudSnapshot() {
    const planted = bomb.state.mode === 'planted' || bomb.state.mode === 'defusing';
    let bombText = '';
    if (bomb.state.mode === 'planting') bombText = `PLANTING ${Math.max(0, PLANT_TIME - bomb.state.progress).toFixed(1)}s`;
    else if (planted) bombText = `BOMB ${bomb.state.site.letter} · ${Math.max(0, Math.ceil(bomb.state.fuse))}s${bomb.state.mode === 'defusing' ? ' — DEFUSING!' : ''}`;
    else if (state.phase === 'freeze') bombText = `FREEZE ${Math.max(0, Math.ceil(state.freezeLeft))}s — press B to buy`;
    else if (bomb.state.mode === 'dropped') bombText = 'BOMB DROPPED — pick it up';
    return {
      round: state.round,
      timeLeft: state.phase === 'freeze' ? state.freezeLeft : state.timeLeft,
      scoreAtk: state.scoreAtk,
      scoreDef: state.scoreDef,
      bombText,
      hp: player.hp,
      armor: player.armor,
      money: player.money,
      mag: player.current.state.mag,
      reserve: player.current.state.reserve,
      weaponName: player.current.def.name,
      grenades: player.grenades,
      grenadeSelected: player.grenadeSelected,
      aliveAtk: agents.filter((a) => a.team === 'attackers' && a.alive).length,
      aliveDef: agents.filter((a) => a.team === 'defenders' && a.alive).length,
    };
  }

  function startMatch() {
    state.round = 1;
    state.scoreAtk = 0;
    state.scoreDef = 0;
    state.matchWinner = null;
    for (const bot of bots) bot.money = 800;
    player.money = 800;
    startRound();
  }

  return {
    state, player, bots, agents, mapData, bomb, effects, rng,
    step, onKey, buy, startMatch, syncCamera,
    updateHud(dt) {
      hud.update(dt, hudSnapshot());
      const gap = player.current.spread(player.agent.groundSpeed()) * 900 * (input.aiming ? 0.7 : 1);
      hud.setCrosshairGap(2 + gap);
    },
    // Shot mode (deterministic captures): skip pointer lock and menus.
    setShotMode(on) {
      state.shotMode = on;
      if (on) state.phase = 'live';
    },
    // Fire one player shot from the current aim (used by ?shot= captures).
    debugShoot() {
      if (!player.alive || !player.current.ready()) return;
      player.agent.eyePosition(tmpV);
      shoot(player, tmpV, player.agent.state.yaw, player.agent.state.pitch, player.current);
    },
    resetForShot(seedValue) {
      // Re-seed and restart round 1 in a known state.
      rng.reseed(seedValue);
      startMatch();
      state.phase = 'live';
      state.freezeLeft = 0;
      state.timeLeft = ROUND_TIME;
      hud.hideBuy();
    },
  };
}
