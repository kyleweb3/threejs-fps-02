# DUSTLINE — Tactical FPS

A tactical first-person shooter built with Three.js for make.fun's
threejs-fps-02 bounty (48-hour window, $1,000 prize table).

## The game

- Bomb mode: you play as an attacker with two AI teammates against
  five AI defenders. Plant the bomb at Site A (Relay Dome) or Site B
  (Pump House); defenders defuse it. First team to 5 rounds wins;
  each round lasts 100 seconds. Planting takes 3 seconds, defusing 5.
- Economy: each match starts with $800, and kills pay $300. Weapons:
  P9 pistol ($300), VK-9 SMG ($1,500), AR-77 rifle ($2,700), LR-90
  sniper ($4,750). Armor and frag, smoke, and flash grenades are
  available.
- AI teammates and opponents follow waypoints and adjust their
  loadout by round — from later rounds, most enemies carry rifles,
  with one designated sniper.
- HUD: minimap, crosshair, hitmarker, kill feed, health and armor
  bars, money, and ammo. Sound effects are synthesized with WebAudio;
  no audio files are needed.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080. Node 22, standard library only, no
build step. `node serve.ts --port 8090` uses a different port.

## Entry packaging

`main.ts` copies `game/` and `screenshots/` into `/output` and writes
`dossier.json`, the summary the judge reads.

## Status

The competition has ended. The entry finished 955th and did not place.
