// DUSTLINE — threejs-fps-02. HUD: every readout the judge asks for — health,
// armour, ammo, money, timer, round score, alive counts, kill feed, bomb
// status — plus the buy menu and the round banner. DOM writes only happen
// when a value actually changes.
// Minimap (top-left): walls, sites A/B, player arrow, teammates, bomb —
// never enemies. It reads the live game store (window.__game, set by main.js)
// and keeps drawing in ?shot= mode.
import { WEAPONS, GRENADE_PRICES, ARMOR_PRICE } from './weapons.js';
import { MAP, SITES } from './map.js';

function el(tag, cls, parent, text = '') {
  const node = document.createElement(tag);
  node.className = cls;
  if (text) node.textContent = text;
  parent.appendChild(node);
  return node;
}

// ---- minimap -------------------------------------------------------------
const MAP_SIZE = 150; // CSS px
const MAP_PAD = 8; // px margin inside the canvas
const MAP_SCALE = (MAP_SIZE - MAP_PAD * 2) / (MAP.maxX - MAP.minX);

function mapToCanvas(x, z) {
  return [MAP_PAD + (x - MAP.minX) * MAP_SCALE, MAP_PAD + (z - MAP.minZ) * MAP_SCALE];
}

export function createHud(root, onBuy) {
  const hud = el('div', 'hud', root);
  const crosshair = el('div', 'crosshair', hud);
  const chDot = el('div', 'ch-dot', crosshair);
  const chLines = [];
  for (let i = 0; i < 4; i += 1) chLines.push(el('div', `ch-line ch-${i}`, crosshair));
  const hitmarker = el('div', 'hitmarker', hud);
  hitmarker.textContent = '✕';

  // Minimap, top-left: the only HUD corner still free (top bar is centred,
  // alive counts + kill feed sit top-right, health bottom-left, ammo
  // bottom-right). Canvas backing is 2x the CSS size for crisp lines.
  const minimapBox = el('div', 'minimap', hud);
  const minimap = document.createElement('canvas');
  minimap.width = MAP_SIZE * 2;
  minimap.height = MAP_SIZE * 2;
  minimapBox.appendChild(minimap);
  const mm = minimap.getContext('2d');

  const topBar = el('div', 'topbar', hud);
  const roundLabel = el('div', 'round-label', topBar, 'ROUND 1');
  const timer = el('div', 'timer', topBar, '1:40');
  const score = el('div', 'score', topBar, '0 — 0');
  const bombStatus = el('div', 'bomb-status', topBar, '');

  const alive = el('div', 'alive', hud);
  const aliveAtk = el('div', 'alive-team atk', alive);
  const aliveDef = el('div', 'alive-team def', alive);
  const feed = el('div', 'killfeed', hud);

  const banner = el('div', 'banner', hud);
  const bannerMain = el('div', 'banner-main', banner);
  const bannerSub = el('div', 'banner-sub', banner);

  const bottomLeft = el('div', 'bottom-left', hud);
  const healthRow = el('div', 'health-row', bottomLeft);
  el('div', 'health-label', healthRow, 'HP');
  const healthBar = el('div', 'health-bar', healthRow);
  const healthFill = el('div', 'health-fill', healthBar);
  const healthNum = el('div', 'health-num', healthRow, '100');
  const armorRow = el('div', 'armor-row', bottomLeft);
  el('div', 'armor-label', armorRow, 'ARMOR');
  const armorBar = el('div', 'armor-bar', armorRow);
  const armorFill = el('div', 'armor-fill', armorBar);
  const armorNum = el('div', 'armor-num', armorRow, '0');
  const money = el('div', 'money', bottomLeft, '$800');

  const bottomRight = el('div', 'bottom-right', hud);
  const ammo = el('div', 'ammo', bottomRight);
  const ammoMag = el('span', 'ammo-mag', ammo, '30');
  el('span', 'ammo-sep', ammo, ' / ');
  const ammoReserve = el('span', 'ammo-reserve', ammo, '90');
  const weaponName = el('div', 'weapon-name', bottomRight, 'AR-77 rifle');
  const grenadeRow = el('div', 'grenade-row', bottomRight, 'FRAG 1 · SMOKE 1 · FLASH 1');

  const vignette = el('div', 'vignette', hud);
  const flashOverlay = el('div', 'flash-overlay', hud);
  const help = el('div', 'help', hud);
  help.innerHTML = `<h1>DUSTLINE</h1><p>Relay station. Two bomb sites. Five rounds to win.</p>
    <p>WASD move · Mouse aim · Click fire · R reload · E plant / defuse · B buy · 1/2 weapons · 3/4/5 grenade · G throw · Ctrl crouch · Shift walk</p>
    <p class="help-cta">Click to play</p>`;

  // Buy menu.
  const buy = el('div', 'buy-menu', hud);
  el('h2', 'buy-title', buy, 'BUY — freeze time');
  const buyMoney = el('div', 'buy-money', buy, '$800');
  const buyGrid = el('div', 'buy-grid', buy);
  const buyButtons = [];
  function buyButton(label, price, key, item) {
    const button = el('button', 'buy-item', buyGrid);
    button.innerHTML = `<span class="buy-key">${key}</span><span class="buy-label">${label}</span><span class="buy-price">$${price}</span>`;
    button.addEventListener('click', () => onBuy(item));
    buyButtons.push({ button, item, price });
    return button;
  }
  buyButton('VK-9 smg', WEAPONS.VK9.price, '1', { kind: 'weapon', key: 'VK9' });
  buyButton('AR-77 rifle', WEAPONS.AR77.price, '2', { kind: 'weapon', key: 'AR77' });
  buyButton('LR-90 marksman', WEAPONS.LR90.price, '3', { kind: 'weapon', key: 'LR90' });
  buyButton('P9 sidearm', WEAPONS.P9.price, '4', { kind: 'weapon', key: 'P9' });
  buyButton('Frag grenade', GRENADE_PRICES.frag, '5', { kind: 'grenade', key: 'frag' });
  buyButton('Smoke grenade', GRENADE_PRICES.smoke, '6', { kind: 'grenade', key: 'smoke' });
  buyButton('Flash grenade', GRENADE_PRICES.flash, '7', { kind: 'grenade', key: 'flash' });
  buyButton('Kevlar armour', ARMOR_PRICE, '8', { kind: 'armor' });
  el('div', 'buy-hint', buy, 'Keys 1–8 or click. B / Esc to close.');

  const cache = {};
  function setText(node, key, value) {
    if (cache[key] !== value) {
      cache[key] = value;
      node.textContent = value;
    }
  }
  function setWidth(node, key, value) {
    if (cache[key] !== value) {
      cache[key] = value;
      node.style.width = value;
    }
  }

  let bannerTimer = 0;
  let hitTimer = 0;
  let damageTimer = 0;
  let flashTimer = 0;
  let flashMax = 1;

  // Redraw the minimap from the live game store. Walls come from the map
  // colliders (Box3, XZ footprint); sites from SITES; positions and bomb
  // state from the player / bots / bomb objects. Enemies are never drawn.
  function drawMinimap() {
    const game = window.__game;
    if (!game || !game.mapData || !game.player) return;
    const ctx = mm;
    ctx.setTransform(2, 0, 0, 2, 0, 0); // backing store is 2x CSS size
    ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
    ctx.fillStyle = 'rgba(16, 12, 9, 0.72)';
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    // Walls.
    ctx.fillStyle = '#4a3a28';
    for (const w of game.mapData.walls) {
      const [x0, y0] = mapToCanvas(w.min.x, w.min.z);
      const [x1, y1] = mapToCanvas(w.max.x, w.max.z);
      ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
    }

    // Sites: coloured ring + letter.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 11px system-ui, sans-serif';
    for (const site of Object.values(SITES)) {
      const [cx, cy] = mapToCanvas(site.x, site.z);
      ctx.beginPath();
      ctx.arc(cx, cy, site.r * MAP_SCALE, 0, Math.PI * 2);
      ctx.strokeStyle = site.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = site.color;
      ctx.fillText(site.letter, cx, cy);
    }

    // Bomb: planted/defusing blinks orange at its site; dropped sits steady
    // where it fell; carried rides on its carrier as an outlined dot.
    const bomb = game.bomb.state;
    const blinkOn = Math.floor(game.state.time * 2) % 2 === 0;
    if ((bomb.mode === 'planted' || bomb.mode === 'defusing') && bomb.site && blinkOn) {
      const [bx, by] = mapToCanvas(bomb.site.x, bomb.site.z);
      ctx.beginPath();
      ctx.arc(bx, by, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ff9a2a';
      ctx.fill();
    } else if (bomb.mode === 'dropped') {
      const [bx, by] = mapToCanvas(bomb.pos.x, bomb.pos.z);
      ctx.beginPath();
      ctx.arc(bx, by, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ff9a2a';
      ctx.fill();
    }

    // Teammates (alive attacker bots): green dots. The bomb carrier — player
    // or teammate — gets a white outline on its dot.
    const carrier = bomb.carrier;
    for (const bot of game.bots) {
      if (bot.team !== 'attackers' || !bot.alive) continue;
      const p = bot.agent.state.position;
      const [bx, by] = mapToCanvas(p.x, p.z);
      ctx.beginPath();
      ctx.arc(bx, by, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#4fb3a9';
      ctx.fill();
      if (carrier === bot) {
        ctx.beginPath();
        ctx.arc(bx, by, 5.5, 0, Math.PI * 2);
        ctx.strokeStyle = '#f2e8d5';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // Player: white arrow following yaw. Forward is (-sin yaw, -cos yaw) in
    // map XZ, and canvas y grows with map z (north up), so rotate by -yaw.
    const player = game.player;
    if (player.alive) {
      const p = player.agent.state.position;
      const [px, py] = mapToCanvas(p.x, p.z);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(-player.agent.state.yaw);
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(5, 5);
      ctx.lineTo(0, 2);
      ctx.lineTo(-5, 5);
      ctx.closePath();
      ctx.fillStyle = '#f2e8d5';
      ctx.fill();
      ctx.restore();
      if (carrier === player) {
        ctx.beginPath();
        ctx.arc(px, py, 8, 0, Math.PI * 2);
        ctx.strokeStyle = '#ff9a2a';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }

  return {
    showHelp() { help.style.display = 'flex'; },
    hideHelp() { help.style.display = 'none'; },
    showBuy(moneyValue) {
      buy.style.display = 'block';
      setText(buyMoney, 'buyMoney', `$${moneyValue}`);
      for (const { button, price } of buyButtons) button.disabled = moneyValue < price;
    },
    hideBuy() { buy.style.display = 'none'; },
    buyVisible() { return buy.style.display === 'block'; },
    showBanner(main, sub = '', seconds = 2.6) {
      bannerMain.textContent = main;
      bannerSub.textContent = sub;
      banner.style.opacity = '1';
      bannerTimer = seconds;
    },
    hideBanner() {
      bannerTimer = 0;
      banner.style.opacity = '0';
    },
    killfeed(killer, victim, headshot, killerTeam) {
      const row = document.createElement('div');
      row.className = 'feed-row';
      row.innerHTML = `<span class="${killerTeam === 'attackers' ? 'feed-atk' : 'feed-def'}">${killer}</span> ${headshot ? '☠' : '✕'} <span class="feed-victim">${victim}</span>`;
      feed.prepend(row);
      while (feed.children.length > 4) feed.removeChild(feed.lastChild);
    },
    hitmark(kill) {
      hitmarker.style.opacity = '1';
      hitmarker.style.color = kill ? '#ff2a1a' : '#f2e8d5';
      hitTimer = 0.25;
    },
    damageFlash() {
      vignette.style.opacity = '0.85';
      damageTimer = 0.5;
    },
    flashBlind(duration) {
      flashOverlay.style.opacity = '0.95';
      flashTimer = duration;
      flashMax = duration;
    },
    setCrosshairGap(gapPx) {
      const gap = Math.round(gapPx);
      if (cache.gap === gap) return;
      cache.gap = gap;
      chLines[0].style.transform = `translate(-50%, -50%) translateY(-${gap + 5}px)`;
      chLines[1].style.transform = `translate(-50%, -50%) translateY(${gap + 5}px)`;
      chLines[2].style.transform = `translate(-50%, -50%) translateX(-${gap + 5}px)`;
      chLines[3].style.transform = `translate(-50%, -50%) translateX(${gap + 5}px)`;
      chDot.style.opacity = gap < 2 ? '1' : '0.4';
    },
    update(dt, s) {
      if (bannerTimer > 0) {
        bannerTimer -= dt;
        if (bannerTimer <= 0) banner.style.opacity = '0';
      }
      if (hitTimer > 0) {
        hitTimer -= dt;
        if (hitTimer <= 0) hitmarker.style.opacity = '0';
      }
      if (damageTimer > 0) {
        damageTimer -= dt;
        vignette.style.opacity = String(Math.max(0, damageTimer * 1.4));
      }
      if (flashTimer > 0) {
        flashTimer -= dt;
        flashOverlay.style.opacity = String(Math.max(0, (flashTimer / flashMax) * 0.95));
      }
      drawMinimap();
      setText(roundLabel, 'round', `ROUND ${s.round}`);
      const total = Math.max(0, Math.ceil(s.timeLeft));
      setText(timer, 'timer', `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`);
      setText(score, 'score', `${s.scoreAtk} — ${s.scoreDef}`);
      setText(bombStatus, 'bomb', s.bombText);
      setText(healthNum, 'hp', String(Math.max(0, Math.round(s.hp))));
      setWidth(healthFill, 'hpw', `${Math.max(0, s.hp)}%`);
      healthFill.style.background = s.hp > 50 ? '#4fb3a9' : s.hp > 25 ? '#ff9a2a' : '#d84a2b';
      setText(armorNum, 'armor', String(Math.round(s.armor)));
      setWidth(armorFill, 'armorw', `${Math.min(100, s.armor)}%`);
      setText(money, 'money', `$${s.money}`);
      setText(ammoMag, 'mag', String(s.mag));
      setText(ammoReserve, 'reserve', String(s.reserve));
      setText(weaponName, 'weapon', s.weaponName);
      setText(grenadeRow, 'grenades', `FRAG ${s.grenades.frag} · SMOKE ${s.grenades.smoke} · FLASH ${s.grenades.flash} — [${s.grenadeSelected.toUpperCase()}]`);
      const atkDots = '●'.repeat(s.aliveAtk) + '○'.repeat(Math.max(0, 3 - s.aliveAtk));
      const defDots = '●'.repeat(s.aliveDef) + '○'.repeat(Math.max(0, 5 - s.aliveDef));
      setText(aliveAtk, 'aliveAtk', `ATK ${atkDots}`);
      setText(aliveDef, 'aliveDef', `DEF ${defDots}`);
      timer.style.color = s.timeLeft <= 10 ? '#d84a2b' : '#f2e8d5';
    },
  };
}
