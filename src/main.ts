/**
 * src/main.ts — Entry point for Drop Zone.
 * Initializes Three.js, wires all game systems, runs the game loop.
 * Supports two modes: MATCH (with bots, offline) and FIRING_RANGE.
 */

import './ui/styles.css';
import * as THREE from 'three';
import { SIM, COMBAT } from '@shared/protocol';
import { Input } from './core/input';
import { Col } from './core/collision';
import { Ev } from './utils/events';
import { Audio } from './shell/audio';
import { postFX } from './shell/postprocessing';
import { particles } from './shell/particles';
import { screenShake } from './shell/screenshake';
import { HEROES, AbilSys } from './combat/abilities';
import { WEAPON_DEFS, applyRarity } from './combat/weapons';
import { Entity } from './entities/entity';
import { tickBot } from './entities/bot';
import {
  updatePlayerLook, tickPlayerMovement, tickPlayerDrop,
  tickPlayerFire, tickPlayerInteract, tickPlayerConsumables,
  tickPlayerWeaponSwap, getTargetFOV,
} from './entities/player';
import { buildWorld } from './world/map';
import { getZone } from './world/map';
import { LootNode } from './world/loot';
import { Ring } from './world/ring';
import {
  initHUD, updateHUD, hitTimers, showBanner, spawnDamageNumber,
  addKillFeed, updateDamageNumbers, drawMinimap,
  rebuildInventoryBar, rebuildAmmoHud, rebuildSquadHud,
  initScoreboard, setScoreboardVisible, renderScoreboard,
  type HUDState,
} from './ui/hud';
import {
  initMenus, showMainMenu, hideMainMenu, showHeroSelect, hideHeroSelect,
  showMatchResults,
} from './ui/menus';
import { pingSystem, PingType } from './core/ping';
import { supplyDrops, setSupplyDropBanner } from './world/supplydrop';

/* ═══════════════════════════════════════════════════════════════
   APP STATE
   ═══════════════════════════════════════════════════════════════ */

const enum AppState { MENU, HERO_SELECT, PLAYING, ENDED }

let appState = AppState.MENU;
let selectedHero = 'forge';
let isFiringRange = false;

/* ═══════════════════════════════════════════════════════════════
   THREE.JS SETUP
   ═══════════════════════════════════════════════════════════════ */

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07070d);

const camera = new THREE.PerspectiveCamera(90, innerWidth / innerHeight, 0.1, 300);
scene.add(camera);

// Post-processing
postFX.init(renderer, scene, camera);

// Particle system
particles.init(scene);

// Ping system
pingSystem.init(scene);

// Supply drops
supplyDrops.init(scene);
setSupplyDropBanner(showBanner);

// Viewmodel group (attached to camera)
const vmGroup = new THREE.Group();
vmGroup.position.set(0.3, -0.28, -0.55);
camera.add(vmGroup);
let vmMesh: THREE.Mesh | null = null;

function buildViewmodel(def: any): void {
  if (vmMesh) vmGroup.remove(vmMesh);
  if (!def) return;
  // Simple merged geometry: barrel + receiver
  const barrel = new THREE.BoxGeometry(def.viewmodel.w * 0.6, def.viewmodel.h * 0.6, def.viewmodel.d);
  const receiver = new THREE.BoxGeometry(def.viewmodel.w, def.viewmodel.h, def.viewmodel.d * 0.4);
  receiver.translate(0, 0, def.viewmodel.d * 0.15);
  const mat = new THREE.MeshStandardMaterial({ color: def.viewmodel.color, roughness: 0.4, metalness: 0.3 });
  // Use group for simple merged look
  const group = new THREE.Group();
  group.add(new THREE.Mesh(barrel, mat));
  group.add(new THREE.Mesh(receiver, mat));
  vmGroup.add(group);
  vmMesh = group as any;
}

// Muzzle flash light
const muzzleFlash = new THREE.PointLight(0xffaa33, 0, 5);
camera.add(muzzleFlash);
muzzleFlash.position.set(0.3, -0.1, -0.8);
let muzzleFlashTimer = 0;
let vmRecoilTimer = 0;

// Tracer pool
const tracerPool: { line: THREE.Line; timer: number }[] = [];
for (let i = 0; i < 30; i++) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const mat = new THREE.LineBasicMaterial({ color: 0xffdd66, transparent: true, opacity: 0 });
  const line = new THREE.Line(geo, mat);
  line.visible = false;
  scene.add(line);
  tracerPool.push({ line, timer: 0 });
}

function spawnTracer(start: THREE.Vector3, end: THREE.Vector3): void {
  for (const t of tracerPool) {
    if (t.timer <= 0) {
      const positions = t.line.geometry.attributes.position as THREE.BufferAttribute;
      positions.setXYZ(0, start.x, start.y, start.z);
      positions.setXYZ(1, end.x, end.y, end.z);
      positions.needsUpdate = true;
      (t.line.material as THREE.LineBasicMaterial).opacity = 0.4;
      t.line.visible = true;
      t.timer = 0.06;
      return;
    }
  }
}

function tickTracers(dt: number): void {
  for (const t of tracerPool) {
    if (t.timer <= 0) continue;
    t.timer -= dt;
    (t.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, t.timer / 0.06 * 0.4);
    if (t.timer <= 0) t.line.visible = false;
  }
}

/* ═══════════════════════════════════════════════════════════════
   GAME STATE
   ═══════════════════════════════════════════════════════════════ */

let allEntities: Entity[] = [];
let player: Entity | null = null;
let lootNodes: LootNode[] = [];
let ring: Ring | null = null;
let worldObjects: ReturnType<typeof buildWorld> | null = null;

// Match state
const MatchState = { LOBBY: 0, DROP: 1, PLAYING: 2, ENDED: 3 };
let matchState = MatchState.LOBBY;
let squadsAlive = 5;

// Death boxes / respawn beacons
let deathBoxes: any[] = [];
let respawnBeacons: any[] = [];

// Spectator
const Spec = {
  on: false, idx: 0, targets: [] as Entity[],
  enter(ents: Entity[]) { this.on = true; this.targets = ents.filter(e => e.life !== 2 && !e.isPlayer); this.idx = 0; },
  cycle() { this.targets = this.targets.filter(e => e.life !== 2); this.idx = (this.idx + 1) % Math.max(this.targets.length, 1); },
  get target() { return this.targets[this.idx] || null; },
  exit() { this.on = false; },
};

// FPS tracking
const fpsBuffer: number[] = [];

// Match stats tracking
const matchStats = {
  kills: new Map<Entity, number>(),
  damage: new Map<Entity, number>(),
  startTime: 0,
  lastRingStage: -1,
};

function trackKill(killer: Entity | null): void {
  if (killer) matchStats.kills.set(killer, (matchStats.kills.get(killer) || 0) + 1);
}

function trackDamage(attacker: Entity | null, amount: number): void {
  if (attacker) matchStats.damage.set(attacker, (matchStats.damage.get(attacker) || 0) + amount);
}

/* ═══════════════════════════════════════════════════════════════
   MATCH LOGIC
   ═══════════════════════════════════════════════════════════════ */

function checkSquadWipes(): void {
  const squads = new Map<number, Entity[]>();
  for (const e of allEntities) {
    if (!squads.has(e.squadId)) squads.set(e.squadId, []);
    squads.get(e.squadId)!.push(e);
  }
  let alive = 0;
  let lastAlive = -1;
  for (const [sid, members] of squads) {
    if (members.some(e => e.life !== 2)) { alive++; lastAlive = sid; }
  }
  squadsAlive = alive;
  if (alive <= 1 && matchState === MatchState.PLAYING) {
    matchState = MatchState.ENDED;
    const playerSquad = player?.squadId ?? -1;
    showBanner(lastAlive === playerSquad ? 'VICTORY' : 'DEFEATED',
      lastAlive === playerSquad ? 'Champion squad!' : 'Better luck next time', 999);
    appState = AppState.ENDED;
  }
}

/* ═══════════════════════════════════════════════════════════════
   START MATCH
   ═══════════════════════════════════════════════════════════════ */

const NAMES = 'You Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliet Kilo Lima Mike November Oscar'.split(' ');
const heroIds = Object.keys(HEROES);

function startMatch(playerHero: string): void {
  hideHeroSelect();
  hideMainMenu();
  appState = AppState.PLAYING;
  selectedHero = playerHero;

  // Clear previous
  allEntities = [];
  Col.targets = [];
  deathBoxes = [];
  lootNodes = [];
  pingSystem.clear();
  supplyDrops.clear();
  matchStats.kills.clear();
  matchStats.damage.clear();
  matchStats.startTime = performance.now() / 1000;
  matchStats.lastRingStage = -1;

  // Build world (only once — could optimize to reuse)
  worldObjects = buildWorld(scene, Col);

  // Create entities: 5 squads x 3
  for (let s = 0; s < 5; s++) {
    for (let i = 0; i < 3; i++) {
      const idx = s * 3 + i;
      const heroId = (s === 0 && i === 0) ? playerHero : heroIds[(s * 3 + i) % heroIds.length];
      const e = new Entity(NAMES[idx], s, scene, heroId, HEROES[heroId]);
      if (s === 0 && i === 0) e.isPlayer = true;
      allEntities.push(e);
      Col.targets.push(e.bodyM, e.headM);
    }
  }
  player = allEntities.find(e => e.isPlayer) || null;

  // Spawn loot nodes
  for (let i = 0; i < 50; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 10 + Math.random() * 72;
    lootNodes.push(new LootNode(scene, new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d)));
  }

  // Ring
  ring = new Ring(scene, SIM.MAP_RADIUS);
  ring.start();

  // Respawn beacons
  respawnBeacons = [
    new THREE.Vector3(0, 0, -30), new THREE.Vector3(38, 0, 18),
    new THREE.Vector3(-38, 0, 18), new THREE.Vector3(0, 0, 38),
  ].map(p => {
    const grp = new THREE.Group();
    grp.position.copy(p);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.6, 0.2, 8),
      new THREE.MeshStandardMaterial({ color: 0x44aa55 }),
    );
    base.position.y = 0.1;
    grp.add(base);
    const lt = new THREE.PointLight(0x44ff66, 0.4, 6);
    lt.position.y = 2;
    grp.add(lt);
    scene.add(grp);
    return { pos: p, ok: true, grp, lt };
  });

  // Start drop
  matchState = MatchState.DROP;
  Spec.exit();
  squadsAlive = 5;

  // Assign spawn positions
  const angles = [0, Math.PI * 0.4, Math.PI * 0.8, Math.PI * 1.2, Math.PI * 1.6];
  const squads = new Map<number, Entity[]>();
  for (const e of allEntities) {
    if (!squads.has(e.squadId)) squads.set(e.squadId, []);
    squads.get(e.squadId)!.push(e);
  }
  let si = 0;
  for (const [, members] of squads) {
    const angle = angles[si % 5];
    const dist = 40 + Math.random() * 30;
    const bx = Math.cos(angle) * dist;
    const bz = Math.sin(angle) * dist;
    for (let i = 0; i < members.length; i++) {
      members[i].reset(new THREE.Vector3(bx + (i - 1) * 3, 60, bz));
    }
    si++;
  }

  renderer.domElement.requestPointerLock();
  showBanner('DROPPING IN', `Playing as ${HEROES[playerHero].name}`, 3);
  Audio.init();
  Audio.play('match_start');
}

/* ═══════════════════════════════════════════════════════════════
   EVENT WIRING (Phase 5: Audio + HUD effects)
   ═══════════════════════════════════════════════════════════════ */

Ev.on('entity:damaged', (d: any) => {
  if (!player) return;
  if (d.entity === player) {
    hitTimers.damage = 0.2;
    postFX.onDamage();
    screenShake.addDamageShake();
    if (d.sb) {
      hitTimers.shieldBreak = 0.3;
      postFX.onShieldBreak();
    }
  }
  if (d.attacker === player) {
    hitTimers.hit = 0.12;
    if (d.sd > 0) {
      spawnDamageNumber(d.entity.pos, d.sd, 'sh');
      particles.emitShieldHit(d.entity.pos);
      trackDamage(d.attacker, d.sd);
    }
    if (d.hd > 0) {
      spawnDamageNumber(d.entity.pos, d.hd, d.isHead ? 'hd' : 'hp');
      particles.emitBloodHit(d.entity.pos);
      trackDamage(d.attacker, d.hd);
    }
    Audio.play(d.isHead ? 'hit_head' : d.sd > 0 ? 'hit_shield' : 'hit_flesh');
    if (d.sb) Audio.play('shield_break');
  }
});

Ev.on('entity:downed', (d: any) => {
  Audio.play('down');
  // Forge passive: faster reload on knock
  if (d.entity?.lastAttacker === player && player?.abil?.hero.passive.id === 'hot_reload') {
    const w = player.activeWeapon;
    if (w && w.reloading) w.reloadTimer *= 0.75;
  }
});

Ev.on('kill', (d: any) => {
  addKillFeed(d.victim.name, d.killer?.name || null);
  trackKill(d.killer);
  if (d.killer === player) { hitTimers.kill = 0.25; Audio.play('kill_confirm'); }
  // Death box
  const db = { pos: d.victim.pos.clone(), ent: d.victim, hasBnr: true,
    grab() { this.hasBnr = false; } };
  deathBoxes.push(db);
  checkSquadWipes();
});

Ev.on('weapon:fire', (d: any) => {
  Audio.play('fire_' + d.weaponId);
  spawnTracer(d.origin, d.end);
  muzzleFlash.intensity = 2.5;
  muzzleFlashTimer = 0.05;
  vmRecoilTimer = 0.1;
  // Muzzle flash particles
  const fireDir = d.end.clone().sub(d.origin).normalize();
  particles.emitMuzzleFlash(d.origin.clone().add(fireDir.clone().multiplyScalar(0.5)), fireDir);
  screenShake.addFireShake();
  // Wall impact particles (if hit wasn't an entity)
  if (d.hitWall && d.hitNormal) {
    particles.emitWallImpact(d.end, d.hitNormal);
  }
});

Ev.on('weapon:swap', () => {
  Audio.play('swap_weapon');
  if (player) buildViewmodel(player.activeWeapon?.def);
});

Ev.on('weapon:reload_start', () => Audio.play('reload_start'));
Ev.on('loot:pickup', () => Audio.play('pickup'));
Ev.on('zip:start', () => Audio.play('zip_start'));
Ev.on('pad:launch', () => Audio.play('pad_launch'));
Ev.on('ability:used', (d: any) => {
  Audio.play(d.slot === 'tac' ? 'ability_tac' : 'ability_ult');
});
Ev.on('consumable:used', () => Audio.play('consumable'));

Ev.on('ability:explosion', (d: any) => {
  particles.emitExplosion(d.pos);
  if (player) screenShake.addExplosionShake(player.pos.distanceTo(d.pos));
});

Ev.on('ping:placed', () => Audio.play('ui_click'));
Ev.on('supply:incoming', () => Audio.play('ring_warning'));

let ringWarned = false;
let lastPingTime = 0;

/* ═══════════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════════ */

Input.init(renderer.domElement);
initHUD();
initScoreboard();
initMenus({
  onHeroSelected: (heroId: string) => startMatch(heroId),
  onFiringRange: () => { isFiringRange = true; },
  onPlay: () => showHeroSelect(),
  onSettingsChanged: (settings: any) => {
    Input.sensitivity = settings.sensitivity || 0.002;
  },
});

window.addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  postFX.resize(innerWidth, innerHeight);
});

/* ═══════════════════════════════════════════════════════════════
   GAME LOOP
   ═══════════════════════════════════════════════════════════════ */

let lastTime = performance.now();

function gameLoop(now: number): void {
  requestAnimationFrame(gameLoop);
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  if (dt <= 0 || dt > 0.2 || appState !== AppState.PLAYING || !player) return;
  const time = now / 1000;

  // ── Ring ──
  if (matchState === MatchState.PLAYING && ring) ring.tick(dt);

  // ── Player camera ──
  if (Input.locked && player.life === 0 && !Spec.on) {
    updatePlayerLook(player, 1);
  } else {
    Input.consumeMouse();
  }

  // ── Player drop ──
  tickPlayerDrop(player, dt);

  // ── Player zipline ──
  if (player.onZip && player.zipLine) {
    (player.zipLine as any).tickRider(player, dt);
    if (Input.jump) (player.zipLine as any).detach(player);
  } else if (!player.dropping && player.life === 0) {
    tickPlayerMovement(player, dt, Col);
  }

  // ── Player downed ──
  if (player.life === 1) player.tickDowned(dt);
  player.tickShield(dt, time);

  // ── Abilities ──
  player.abil.tick(dt);
  AbilSys.tickEffects(player, dt, allEntities, time);
  AbilSys.tickFX(dt, scene);
  if (Input.abilQ) AbilSys.activate(player, 'tac', allEntities, scene, Col);
  if (Input.abilZ) AbilSys.activate(player, 'ult', allEntities, scene, Col);

  // ── Ping (middle mouse / V key) ──
  if (Input.justPressed('KeyV') && player.life === 0 && !player.dropping) {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const hit = Col.ray(camera.position, dir, 100);
    if (hit) {
      // Double-tap V within 0.5s = enemy ping
      const now = performance.now() / 1000;
      const pingType = (now - lastPingTime < 0.5) ? PingType.ENEMY : PingType.LOCATION;
      pingSystem.place(hit.point, pingType);
      lastPingTime = now;
    }
  }

  // ── Jump pads ──
  player._padCd = Math.max(0, (player._padCd || 0) - dt);
  if (player._padCd! <= 0 && player.life === 0 && !player.dropping && !player.onZip && worldObjects) {
    for (const p of worldObjects.jumpPads) {
      if (p.check(player as any)) {
        player._padCd = 0.6;
        Ev.emit('pad:launch', {});
        break;
      }
    }
  }

  // ── Weapons ──
  const aw = player.activeWeapon;
  if (aw) aw.tick(dt);
  tickPlayerWeaponSwap(player);
  tickPlayerConsumables(player);

  // ── Fire ──
  if (matchState >= MatchState.DROP && player.life === 0 && !player.onZip) {
    tickPlayerFire(player, camera, Col);
  }
  if (!Input.fire && aw) aw.lastFired = false;

  // Muzzle flash
  if (muzzleFlashTimer > 0) {
    muzzleFlashTimer -= dt;
    if (muzzleFlashTimer <= 0) muzzleFlash.intensity = 0;
  }

  // ── Interact ──
  const interact = tickPlayerInteract(
    player, allEntities,
    worldObjects?.ziplines || [], lootNodes,
    worldObjects?.lootBins || [], worldObjects?.doors || [],
    deathBoxes, respawnBeacons,
  );

  // ── Bots ──
  for (const e of allEntities) {
    if (e.isPlayer) continue;
    tickBot(e, dt, allEntities, time, ring!, worldObjects?.jumpPads || [], Col, scene, lootNodes);
    if (e.life === 1) e.tickDowned(dt);
  }

  // ── Ring damage ──
  if (matchState === MatchState.PLAYING && ring) {
    for (const e of allEntities) ring.applyDamage(e as any, dt);
    // Ring warning
    if (ring.isOutside(player.pos) && !ringWarned) {
      ringWarned = true;
      Audio.play('ring_warning');
    } else if (!ring.isOutside(player.pos)) {
      ringWarned = false;
    }
  }

  // ── Match state transitions ──
  if (matchState === MatchState.DROP && allEntities.every(e => !e.dropping)) {
    matchState = MatchState.PLAYING;
    showBanner('DROP ZONE', 'Fight to survive', 3);
  }
  if (matchState === MatchState.PLAYING) {
    checkSquadWipes();
    // Supply drop on ring stage change
    if (ring && ring.stage !== matchStats.lastRingStage && ring.stage >= 0) {
      matchStats.lastRingStage = ring.stage;
      if (ring.stage > 0) { // Don't drop on first stage
        supplyDrops.spawn(ring.cx, ring.cz, ring.currentR, lootNodes);
      }
    }
  }

  // ── World tick ──
  for (const l of lootNodes) l.tick(time);
  if (worldObjects) {
    for (const b of worldObjects.lootBins) b.tick(time);
    for (const p of worldObjects.jumpPads) p.tick(time);
  }
  for (const b of respawnBeacons) {
    b.lt.intensity = b.ok ? 0.3 + Math.sin(time * 2) * 0.1 : 0;
  }
  supplyDrops.tick(dt, lootNodes);
  pingSystem.tick(dt, camera);

  // ── Spectator ──
  if (player.life === 2 && !Spec.on) Spec.enter(allEntities.filter(e => e.squadId === player!.squadId));
  if (Spec.on && Input.justPressed('Digit1')) Spec.cycle();

  // ── Scoreboard (TAB) ──
  const tabHeld = Input.isDown('Tab');
  setScoreboardVisible(tabHeld);
  if (tabHeld) {
    const squads = new Map<number, Entity[]>();
    for (const e of allEntities) {
      if (!squads.has(e.squadId)) squads.set(e.squadId, []);
      squads.get(e.squadId)!.push(e);
    }
    const sbData = [...squads.entries()].map(([sid, members]) => ({
      squadId: sid,
      isPlayerSquad: sid === player!.squadId,
      members: members.map(e => ({
        name: e.name,
        heroName: e.abil.hero.name,
        kills: matchStats.kills.get(e) || 0,
        damage: Math.round(matchStats.damage.get(e) || 0),
        life: e.life,
        isPlayer: e.isPlayer,
      })),
    }));
    // Sort: player's squad first, then by total kills descending
    sbData.sort((a, b) => {
      if (a.isPlayerSquad) return -1;
      if (b.isPlayerSquad) return 1;
      const aKills = a.members.reduce((s, m) => s + m.kills, 0);
      const bKills = b.members.reduce((s, m) => s + m.kills, 0);
      return bKills - aKills;
    });
    renderScoreboard(sbData);
  }

  // ── Screen shake ──
  screenShake.tick(dt);
  postFX.tick(dt);

  // ── Camera ──
  if (!Spec.on) {
    camera.position.copy(player.eye).add(screenShake.offset);
    camera.quaternion.setFromEuler(new THREE.Euler(
      player.pitch, player.yaw, screenShake.rollOffset, 'YXZ',
    ));
  } else {
    const target = Spec.target;
    if (target) {
      camera.position.copy(target.eye).add(screenShake.offset);
      camera.quaternion.setFromEuler(new THREE.Euler(
        target.pitch, target.yaw, screenShake.rollOffset, 'YXZ',
      ));
    }
  }

  // FOV
  const targetFov = getTargetFOV(player, 90);
  camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 8 * dt);
  camera.updateProjectionMatrix();

  // ── Viewmodel animation ──
  vmGroup.visible = player.life === 0 && !Spec.on && !player.dropping && !player.onZip && !!player.activeWeapon;
  {
    // Base position
    let vx = 0.3, vy = -0.28, vz = -0.55;
    let rx = 0, ry = 0, rz = 0;

    // Idle sway — subtle sinusoidal movement
    const idleSwayX = Math.sin(time * 1.2) * 0.003;
    const idleSwayY = Math.cos(time * 0.9) * 0.002;
    vx += idleSwayX;
    vy += idleSwayY;

    // Sprint offset — weapon lowered and tilted
    if (player.isSprint && player.hSpd > 3) {
      vy -= 0.06;
      vz -= 0.04;
      rx = 0.15;
      rz = -0.08;
    }

    // Walk bob — based on horizontal speed
    if (player.hSpd > 0.5 && !player.isSprint) {
      const bobFreq = Math.min(player.hSpd * 1.5, 8);
      vx += Math.sin(time * bobFreq) * 0.004;
      vy += Math.abs(Math.sin(time * bobFreq * 2)) * 0.003;
    }

    // Fire recoil kick — snaps back over ~100ms
    if (vmRecoilTimer > 0) {
      vmRecoilTimer -= dt;
      const t = Math.max(0, vmRecoilTimer / 0.1);
      vy += t * 0.015;
      vz += t * 0.02;
      rx -= t * 0.06;
    }

    // Reload bob
    if (aw?.reloading) {
      const rp = 1 - aw.reloadTimer / aw.def.reloadTime;
      vy -= Math.sin(rp * Math.PI) * 0.07;
      rx += Math.sin(rp * Math.PI) * 0.1;
    }

    vmGroup.position.set(vx, vy, vz);
    vmGroup.rotation.set(rx, ry, rz);
  }

  // ── Sync models + tracers + particles ──
  for (const e of allEntities) e.syncModel();
  tickTracers(dt);
  particles.tick(dt);
  updateDamageNumbers(camera);

  // ── HUD ──
  fpsBuffer.push(1 / dt);
  if (fpsBuffer.length > 30) fpsBuffer.shift();
  const avgFps = fpsBuffer.reduce((a, b) => a + b, 0) / fpsBuffer.length;

  const hudState: HUDState = {
    playerHp: player.hp,
    playerSh: player.sh,
    playerLife: player.life,
    playerSpeed: player.hSpd,
    playerHeroName: player.abil.hero.name,
    playerPos: player.pos,
    playerDropping: player.dropping,
    playerOnZip: player.onZip,
    isSpectating: Spec.on,
    spectatingName: Spec.target?.name || '—',
    squadsAlive,
    ringText: ring?.getText() || '—',
    ringOutside: ring ? ring.isOutside(player.pos) : false,
    calloutZone: getZone(player.pos),
    weaponName: aw?.def.name || '—',
    weaponAmmo: aw?.ammo || 0,
    weaponReloading: aw?.reloading || false,
    weaponReloadProgress: aw ? 1 - aw.reloadTimer / aw.def.reloadTime : 0,
    tacIcon: player.abil.hero.tactical.icon,
    ultIcon: player.abil.hero.ultimate.icon,
    tacCd: player.abil.tac.cd,
    tacMaxCd: player.abil.hero.tactical.cooldown,
    tacActive: player.abil.tac.active,
    ultCd: player.abil.ult.cd,
    ultMaxCd: player.abil.hero.ultimate.cooldown,
    ultActive: player.abil.ult.active,
    passiveName: player.abil.hero.passive.name,
    activeSlot: player.inv.activeIndex,
    weaponSlots: [0, 1].map(i => {
      const w = player!.inv.slots[i];
      return { name: w?.def.name || '', rarity: w?.def.rarity || null, hasWeapon: !!w };
    }),
    consumables: player.inv.consumables,
    ammo: player.inv.ammo,
    squadMembers: allEntities.filter(e => e.squadId === player!.squadId).map(e => ({
      name: e.name, hp: e.hp, sh: e.sh, life: e.life,
    })),
    bleedPercent: player.bleedTimer / COMBAT.BLEED_TIME,
    beingRevived: player.beingRevived,
    interactText: interact.text,
    interactVisible: interact.active,
    reviveVisible: interact.reviveActive,
    reviveProgress: interact.reviveTarget?.reviveProgress || 0,
    fps: avgFps,
    ringStage: ring?.stage ?? 0,
    ringRadius: ring?.currentR ?? SIM.MAP_RADIUS,
    weaponBloom: aw?.bloom ?? 0,
    weaponMaxBloom: aw?.def.spread.max ?? 1,
  };

  updateHUD(hudState, dt);
  rebuildSquadHud(hudState.squadMembers);
  rebuildInventoryBar(hudState.activeSlot, hudState.weaponSlots, hudState.consumables);
  rebuildAmmoHud(hudState.ammo);
  drawMinimap(player.pos, player.squadId, allEntities, {
    cx: ring?.cx ?? 0, cz: ring?.cz ?? 0, currentR: ring?.currentR ?? SIM.MAP_RADIUS,
  }, SIM.MAP_RADIUS, pingSystem.getActive(), supplyDrops.getActive());

  // ── Render (post-processing pipeline) ──
  postFX.render();
  Input.endFrame();
}

requestAnimationFrame(gameLoop);
