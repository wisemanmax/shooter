/**
 * HUD rendering — reactive DOM updates with dirty-flag optimization.
 * All DOM refs cached at init time. No innerHTML in the game loop.
 * Extracted from v6-heroes.html game loop HUD section.
 */

import * as THREE from 'three';
import { COMBAT, SIM } from '@shared/protocol';
import { AMMO_TYPES } from '../combat/weapons';
import { CONSUMABLES } from '../combat/damage';

/* ── Cached DOM refs ── */

interface HUDRefs {
  banner: HTMLElement;
  bannerText: HTMLElement;
  bannerSub: HTMLElement;
  callout: HTMLElement;
  downedOverlay: HTMLElement;
  bleedFill: HTMLElement;
  reviveInfo: HTMLElement;
  specBar: HTMLElement;
  specName: HTMLElement;
  squadHud: HTMLElement;
  squadsAlive: HTMLElement;
  ringText: HTMLElement;
  abilQ: HTMLElement;
  abilZ: HTMLElement;
  abilQIcon: HTMLElement;
  abilZIcon: HTMLElement;
  abilQCd: HTMLElement;
  abilZCd: HTMLElement;
  abilQTxt: HTMLElement;
  abilZTxt: HTMLElement;
  passiveInd: HTMLElement;
  invBar: HTMLElement;
  ammoHud: HTMLElement;
  weaponName: HTMLElement;
  weaponAmmo: HTMLElement;
  reloadFill: HTMLElement;
  shieldFill: HTMLElement;
  healthFill: HTMLElement;
  shieldVal: HTMLElement;
  healthVal: HTMLElement;
  interact: HTMLElement;
  revBar: HTMLElement;
  revFill: HTMLElement;
  crosshair: HTMLElement;
  hitMarker: HTMLElement;
  vigDamage: HTMLElement;
  vigShieldBreak: HTMLElement;
  vigRing: HTMLElement;
  dmgContainer: HTMLElement;
  killFeed: HTMLElement;
  minimap: HTMLCanvasElement;
  debugSpeed: HTMLElement;
  debugHero: HTMLElement;
  debugRing: HTMLElement;
  debugFps: HTMLElement;
  vitals: HTMLElement;
  weaponHud: HTMLElement;
  abilHud: HTMLElement;
}

let refs: HUDRefs | null = null;

/* ── Dirty tracking ── */

const prev: Record<string, any> = {};

/** Update a text element only if value changed */
function setText(el: HTMLElement, key: string, value: string): void {
  if (prev[key] !== value) {
    el.textContent = value;
    prev[key] = value;
  }
}

/** Update an element's style property only if changed */
function setStyle(el: HTMLElement, key: string, prop: string, value: string): void {
  const k = key + '.' + prop;
  if (prev[k] !== value) {
    (el.style as any)[prop] = value;
    prev[k] = value;
  }
}

/** Toggle a class only if changed */
function toggleClass(el: HTMLElement, key: string, cls: string, on: boolean): void {
  if (prev[key] !== on) {
    el.classList.toggle(cls, on);
    prev[key] = on;
  }
}

/* ── Public API ── */

/** Initialize HUD by caching all DOM refs. Call once after DOM ready. */
export function initHUD(): void {
  refs = {
    banner: document.getElementById('match-banner')!,
    bannerText: document.getElementById('mb-text')!,
    bannerSub: document.getElementById('mb-sub')!,
    callout: document.getElementById('callout')!,
    downedOverlay: document.getElementById('downed-ov')!,
    bleedFill: document.getElementById('bl-f')!,
    reviveInfo: document.getElementById('ri-t')!,
    specBar: document.getElementById('spec-bar')!,
    specName: document.getElementById('sp-n')!,
    squadHud: document.getElementById('squad-hud')!,
    squadsAlive: document.getElementById('sq-alive')!,
    ringText: document.getElementById('ring-t')!,
    abilQ: document.getElementById('ab-q')!,
    abilZ: document.getElementById('ab-z')!,
    abilQIcon: document.getElementById('ab-q')!.querySelector('.ab-ic')!,
    abilZIcon: document.getElementById('ab-z')!.querySelector('.ab-ic')!,
    abilQCd: document.getElementById('ab-q-cd')!,
    abilZCd: document.getElementById('ab-z-cd')!,
    abilQTxt: document.getElementById('ab-q-txt')!,
    abilZTxt: document.getElementById('ab-z-txt')!,
    passiveInd: document.getElementById('passive-ind')!,
    invBar: document.getElementById('inv-bar')!,
    ammoHud: document.getElementById('ammo-hud')!,
    weaponName: document.getElementById('w-n')!,
    weaponAmmo: document.getElementById('w-a')!,
    reloadFill: document.getElementById('w-rf')!,
    shieldFill: document.getElementById('sf')!,
    healthFill: document.getElementById('hf')!,
    shieldVal: document.getElementById('sv')!,
    healthVal: document.getElementById('hv')!,
    interact: document.getElementById('interact')!,
    revBar: document.getElementById('rev-bar')!,
    revFill: document.getElementById('rb-f')!,
    crosshair: document.getElementById('xh')!,
    hitMarker: document.getElementById('hitm')!,
    vigDamage: document.getElementById('vig-d')!,
    vigShieldBreak: document.getElementById('vig-sb')!,
    vigRing: document.getElementById('vig-ring')!,
    dmgContainer: document.getElementById('dmg-c')!,
    killFeed: document.getElementById('kf')!,
    minimap: document.getElementById('mm') as HTMLCanvasElement,
    debugSpeed: document.getElementById('d-s')!,
    debugHero: document.getElementById('d-h')!,
    debugRing: document.getElementById('d-r')!,
    debugFps: document.getElementById('d-f')!,
    vitals: document.getElementById('vitals')!,
    weaponHud: document.getElementById('wep-hud')!,
    abilHud: document.getElementById('abil-hud')!,
  };
}

/** Hit effect timers — set externally, decayed by updateHUD */
export const hitTimers = { hit: 0, kill: 0, damage: 0, shieldBreak: 0 };

/** Banner state */
let bannerTimer = 0;

/** Show a timed banner message */
export function showBanner(title: string, subtitle: string, duration = 3): void {
  if (!refs) return;
  refs.bannerText.textContent = title;
  refs.bannerSub.textContent = subtitle;
  refs.banner.classList.add('show');
  bannerTimer = duration;
}

/** Spawn a floating damage number at world position */
export function spawnDamageNumber(worldPos: THREE.Vector3, amount: number, type: 'hp' | 'sh' | 'hd'): void {
  if (!refs) return;
  const el = document.createElement('div');
  el.className = 'dn ' + type;
  el.textContent = String(Math.round(amount));
  el.dataset.wx = String(worldPos.x + (Math.random() - 0.5) * 0.3);
  el.dataset.wy = String(worldPos.y + 1.5 + Math.random() * 0.3);
  el.dataset.wz = String(worldPos.z + (Math.random() - 0.5) * 0.3);
  refs.dmgContainer.appendChild(el);
  setTimeout(() => el.remove(), 650);
}

/** Add a kill feed entry */
export function addKillFeed(victimName: string, killerName: string | null): void {
  if (!refs) return;
  const el = document.createElement('div');
  el.className = 'kfe';
  el.innerHTML = `<span class="kn">${killerName || 'Ring'}</span> → ${victimName}`;
  refs.killFeed.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/* ── Scoreboard ── */

let scoreboardEl: HTMLElement | null = null;
let scoreboardBody: HTMLElement | null = null;
let scoreboardVisible = false;

/** Initialize scoreboard refs (call after initHUD) */
export function initScoreboard(): void {
  scoreboardEl = document.getElementById('scoreboard');
  scoreboardBody = document.getElementById('sb-body');
}

/** Show/hide scoreboard */
export function setScoreboardVisible(visible: boolean): void {
  if (!scoreboardEl) return;
  if (visible !== scoreboardVisible) {
    scoreboardEl.classList.toggle('hidden', !visible);
    scoreboardVisible = visible;
  }
}

/** Render scoreboard content */
export function renderScoreboard(
  squads: {
    squadId: number;
    isPlayerSquad: boolean;
    members: {
      name: string;
      heroName: string;
      kills: number;
      damage: number;
      life: number;
      isPlayer: boolean;
    }[];
  }[],
): void {
  if (!scoreboardBody) return;
  let html = '<div class="sb-hdr"><span>Kills</span><span>Dmg</span></div>';
  for (const squad of squads) {
    const allElim = squad.members.every(m => m.life === 2);
    html += `<div class="sb-squad${squad.isPlayerSquad ? ' player-squad' : ''}">`;
    html += `<div class="sb-sh${allElim ? ' eliminated' : ''}">Squad ${squad.squadId + 1}</div>`;
    for (const m of squad.members) {
      const cls = m.isPlayer ? 'sb-row self' : m.life === 2 ? 'sb-row dead' : 'sb-row';
      html += `<div class="${cls}"><span class="sb-name">${m.name}</span><span class="sb-hero">${m.heroName}</span><span class="sb-val">${m.kills}</span><span class="sb-val">${m.damage}</span></div>`;
    }
    html += '</div>';
  }
  scoreboardBody.innerHTML = html;
}

/** State passed to updateHUD each frame */
export interface HUDState {
  playerHp: number;
  playerSh: number;
  playerLife: number;
  playerSpeed: number;
  playerHeroName: string;
  playerPos: THREE.Vector3;
  playerDropping: boolean;
  playerOnZip: boolean;
  isSpectating: boolean;
  spectatingName: string;
  squadsAlive: number;
  ringText: string;
  ringOutside: boolean;
  calloutZone: string;
  // Weapon
  weaponName: string;
  weaponAmmo: number;
  weaponReloading: boolean;
  weaponReloadProgress: number;
  // Abilities
  tacIcon: string;
  ultIcon: string;
  tacCd: number;
  tacMaxCd: number;
  tacActive: boolean;
  ultCd: number;
  ultMaxCd: number;
  ultActive: boolean;
  passiveName: string;
  // Inventory
  activeSlot: number;
  weaponSlots: { name: string; rarity: string | null; hasWeapon: boolean }[];
  consumables: Record<string, number>;
  ammo: Record<string, number>;
  // Squad
  squadMembers: { name: string; hp: number; sh: number; life: number }[];
  // Downed
  bleedPercent: number;
  beingRevived: boolean;
  // Interact
  interactText: string;
  interactVisible: boolean;
  // Revive bar
  reviveVisible: boolean;
  reviveProgress: number;
  // FPS
  fps: number;
  ringStage: number;
  ringRadius: number;
}

/**
 * Update all HUD elements. Call once per frame.
 * Uses dirty-flag pattern to minimize DOM writes.
 */
export function updateHUD(state: HUDState, dt: number): void {
  if (!refs) return;

  // Banner timer
  if (bannerTimer > 0) {
    bannerTimer -= dt;
    if (bannerTimer <= 0) refs.banner.classList.remove('show');
  }

  // Hit timers
  hitTimers.hit = Math.max(0, hitTimers.hit - dt);
  hitTimers.kill = Math.max(0, hitTimers.kill - dt);
  hitTimers.damage = Math.max(0, hitTimers.damage - dt);
  hitTimers.shieldBreak = Math.max(0, hitTimers.shieldBreak - dt);

  // Hit marker + crosshair
  if (hitTimers.kill > 0) {
    toggleClass(refs.hitMarker, 'hm-show', 'show', true);
    toggleClass(refs.hitMarker, 'hm-kill', 'kill', true);
    toggleClass(refs.crosshair, 'xh-kill', 'kill', true);
    toggleClass(refs.crosshair, 'xh-hit', 'hit', false);
  } else if (hitTimers.hit > 0) {
    toggleClass(refs.hitMarker, 'hm-show', 'show', true);
    toggleClass(refs.hitMarker, 'hm-kill', 'kill', false);
    toggleClass(refs.crosshair, 'xh-hit', 'hit', true);
    toggleClass(refs.crosshair, 'xh-kill', 'kill', false);
  } else {
    toggleClass(refs.hitMarker, 'hm-show', 'show', false);
    toggleClass(refs.hitMarker, 'hm-kill', 'kill', false);
    toggleClass(refs.crosshair, 'xh-hit', 'hit', false);
    toggleClass(refs.crosshair, 'xh-kill', 'kill', false);
  }

  // Vignettes
  setStyle(refs.vigDamage, 'vig-d', 'opacity', hitTimers.damage > 0 ? '0.5' : '0');
  setStyle(refs.vigShieldBreak, 'vig-sb', 'opacity', hitTimers.shieldBreak > 0 ? '0.6' : '0');
  setStyle(refs.vigRing, 'vig-ring', 'opacity', state.ringOutside && state.playerLife === 0 ? '0.4' : '0');

  // Vitals
  setStyle(refs.shieldFill, 'sf-w', 'width', (state.playerSh / COMBAT.MAX_SHIELD * 100) + '%');
  setStyle(refs.healthFill, 'hf-w', 'width', (state.playerHp / COMBAT.MAX_HP * 100) + '%');
  toggleClass(refs.healthFill, 'hf-low', 'low', state.playerHp < 30);
  setText(refs.shieldVal, 'sv', String(Math.ceil(state.playerSh)));
  setText(refs.healthVal, 'hv', String(Math.ceil(state.playerHp)));

  // Weapon
  setText(refs.weaponName, 'wn', state.weaponName);
  setText(refs.weaponAmmo, 'wa', String(state.weaponAmmo));
  toggleClass(refs.weaponAmmo, 'wa-emp', 'emp', state.weaponAmmo === 0);
  setStyle(refs.reloadFill, 'rf-w', 'width', state.weaponReloading ? (state.weaponReloadProgress * 100) + '%' : '0');

  // Abilities
  setText(refs.abilQIcon, 'aq-ic', state.tacIcon);
  setText(refs.abilZIcon, 'az-ic', state.ultIcon);
  const tCdPct = state.tacCd > 0 ? (state.tacCd / state.tacMaxCd * 100) + '%' : '0';
  setStyle(refs.abilQCd, 'aq-cd', 'height', tCdPct);
  setText(refs.abilQTxt, 'aq-txt', state.tacCd > 0 ? String(Math.ceil(state.tacCd)) : '');
  toggleClass(refs.abilQ, 'aq-rdy', 'ready', state.tacCd <= 0);
  toggleClass(refs.abilQ, 'aq-act', 'active', state.tacActive);

  const uCdPct = state.ultCd > 0 ? (state.ultCd / state.ultMaxCd * 100) + '%' : '0';
  setStyle(refs.abilZCd, 'az-cd', 'height', uCdPct);
  setText(refs.abilZTxt, 'az-txt', state.ultCd > 0 ? String(Math.ceil(state.ultCd)) : '');
  toggleClass(refs.abilZ, 'az-rdy', 'ready', state.ultCd <= 0);
  toggleClass(refs.abilZ, 'az-act', 'active', state.ultActive);

  setText(refs.passiveInd, 'pas', state.passiveName);
  toggleClass(refs.passiveInd, 'pas-act', 'active', state.tacActive || state.ultActive);

  // Match info
  setText(refs.squadsAlive, 'sqa', state.squadsAlive + ' Squads');
  setText(refs.ringText, 'rt', state.ringText);

  // Callout
  setText(refs.callout, 'co', state.calloutZone);

  // Interact
  setStyle(refs.interact, 'int-op', 'opacity', state.interactVisible ? '1' : '0');
  if (state.interactVisible) {
    const intHtml = `<span>[E]</span> ${state.interactText}`;
    if (prev['int-html'] !== intHtml) {
      refs.interact.innerHTML = intHtml;
      prev['int-html'] = intHtml;
    }
  }

  // Revive bar
  toggleClass(refs.revBar, 'rev-show', 'show', state.reviveVisible);
  if (state.reviveVisible) {
    setStyle(refs.revFill, 'rev-w', 'width', (state.reviveProgress * 100) + '%');
  }

  // Downed overlay
  toggleClass(refs.downedOverlay, 'dn-show', 'show', state.playerLife === 1);
  if (state.playerLife === 1) {
    setStyle(refs.bleedFill, 'bl-w', 'width', (state.bleedPercent * 100) + '%');
    setText(refs.reviveInfo, 'ri', state.beingRevived ? 'Being revived…' : 'Waiting…');
  }

  // Spectator
  toggleClass(refs.specBar, 'sp-show', 'show', state.isSpectating);
  if (state.isSpectating) setText(refs.specName, 'sp-n', state.spectatingName);

  // Visibility toggles
  const alive = state.playerLife === 0;
  const inGame = alive && !state.playerDropping && !state.playerOnZip;
  setStyle(refs.crosshair, 'xh-d', 'display', inGame && !state.isSpectating ? '' : 'none');
  setStyle(refs.vitals, 'vit-d', 'display', alive ? '' : 'none');
  setStyle(refs.weaponHud, 'wh-d', 'display', inGame ? '' : 'none');
  setStyle(refs.abilHud, 'ah-d', 'display', alive && !state.isSpectating ? '' : 'none');

  // Debug
  setText(refs.debugSpeed, 'ds', state.playerSpeed.toFixed(1));
  setText(refs.debugHero, 'dh', state.playerHeroName);
  setText(refs.debugRing, 'dr', `S${state.ringStage + 1} R${state.ringRadius.toFixed(0)}`);
  setText(refs.debugFps, 'df', state.fps.toFixed(0));
}

/**
 * Update damage number positions to follow world-space coordinates.
 * Call once per frame after camera update.
 */
export function updateDamageNumbers(cam: THREE.Camera): void {
  if (!refs) return;
  const w = innerWidth, h = innerHeight;
  for (const el of refs.dmgContainer.children as any) {
    const v = new THREE.Vector3(+el.dataset.wx, +el.dataset.wy, +el.dataset.wz);
    v.project(cam);
    if (v.z > 1) {
      el.style.display = 'none';
      continue;
    }
    el.style.display = '';
    el.style.left = ((v.x * 0.5 + 0.5) * w) + 'px';
    el.style.top = ((-v.y * 0.5 + 0.5) * h) + 'px';
  }
}

/**
 * Draw the minimap canvas.
 * @param playerPos - Local player position
 * @param playerSquadId - Local player's squad ID
 * @param entities - All entities to draw
 * @param ring - Ring state {cx, cz, currentR}
 * @param mapRadius - Map radius for scaling
 */
export function drawMinimap(
  playerPos: THREE.Vector3,
  playerSquadId: number,
  entities: { pos: THREE.Vector3; squadId: number; life: number; isPlayer: boolean; dropping: boolean; _revealed?: boolean }[],
  ring: { cx: number; cz: number; currentR: number },
  mapRadius: number,
  pings?: { pos: THREE.Vector3; type: number }[],
  supplyDrops?: THREE.Vector3[],
): void {
  if (!refs) return;
  const cv = refs.minimap;
  const ctx = cv.getContext('2d')!;
  const W = 130;
  const S = W / (mapRadius * 2);

  ctx.clearRect(0, 0, W, W);
  ctx.fillStyle = 'rgba(7,7,13,.7)';
  ctx.fillRect(0, 0, W, W);

  // Ring circle
  ctx.strokeStyle = 'rgba(255,68,34,.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(W / 2 + ring.cx * S, W / 2 + ring.cz * S, ring.currentR * S, 0, Math.PI * 2);
  ctx.stroke();

  // Supply drops (golden diamond)
  if (supplyDrops) {
    for (const d of supplyDrops) {
      const x = W / 2 + d.x * S;
      const y = W / 2 + d.z * S;
      ctx.fillStyle = '#e8c547';
      ctx.beginPath();
      ctx.moveTo(x, y - 3);
      ctx.lineTo(x + 2, y);
      ctx.lineTo(x, y + 3);
      ctx.lineTo(x - 2, y);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Pings
  if (pings) {
    const pingColors = ['#5ab8f5', '#ff4444', '#e8c547'];
    for (const p of pings) {
      const x = W / 2 + p.pos.x * S;
      const y = W / 2 + p.pos.z * S;
      ctx.strokeStyle = pingColors[p.type] || '#5ab8f5';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.stroke();
      // Center dot
      ctx.fillStyle = pingColors[p.type] || '#5ab8f5';
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }
  }

  // Entities
  for (const e of entities) {
    if (e.life === 2 || e.dropping) continue;
    const x = W / 2 + e.pos.x * S;
    const y = W / 2 + e.pos.z * S;
    if (e.isPlayer) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - 2, y - 2, 4, 4);
    } else if (e.squadId === playerSquadId) {
      ctx.fillStyle = '#5ab8f5';
      ctx.fillRect(x - 1, y - 1, 3, 3);
    } else if (e._revealed) {
      ctx.fillStyle = 'rgba(255,80,80,.7)';
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }
  }
}

/**
 * Rebuild the inventory bar. Called when inventory changes.
 * Uses innerHTML but only on inventory change, not every frame.
 */
export function rebuildInventoryBar(
  activeSlot: number,
  weaponSlots: { name: string; rarity: string | null; hasWeapon: boolean }[],
  consumables: Record<string, number>,
): void {
  if (!refs) return;
  let html = '';
  for (let i = 0; i < 2; i++) {
    const w = weaponSlots[i];
    const cls = 'is' + (i === activeSlot ? ' act' : '') + (w?.rarity ? ' r-' + w.rarity : '');
    html += `<div class="${cls}"><div class="ik">${i + 1}</div><div class="ii">${w?.hasWeapon ? '🔫' : '·'}</div><div class="ic">${w?.hasWeapon ? w.name.split(' ')[0] : ''}</div></div>`;
  }
  const consIds = ['syringe', 'medkit', 'cell', 'battery'] as const;
  for (let i = 0; i < consIds.length; i++) {
    const ct = consumables[consIds[i]] || 0;
    const c = CONSUMABLES[consIds[i]];
    html += `<div class="is"><div class="ik">${i + 3}</div><div class="ii">${c.icon}</div><div class="ic">${ct || ''}</div></div>`;
  }
  refs.invBar.innerHTML = html;
}

/**
 * Rebuild ammo display. Called when ammo changes.
 */
export function rebuildAmmoHud(ammo: Record<string, number>): void {
  if (!refs) return;
  let html = '';
  for (const [type, count] of Object.entries(ammo)) {
    const color = AMMO_TYPES[type]?.color || '#888';
    html += `<div class="ar"><span style="background:${color}"></span>${type}: ${count}</div>`;
  }
  refs.ammoHud.innerHTML = html;
}

/**
 * Rebuild squad HUD. Called when squad state changes.
 */
export function rebuildSquadHud(
  members: { name: string; hp: number; sh: number; life: number }[],
): void {
  if (!refs) return;
  let html = '';
  for (const m of members) {
    const cls = 'sqm' + (m.life === 1 ? ' dn' : '') + (m.life === 2 ? ' el' : '');
    const dotColor = m.life === 0 ? '#5ab8f5' : m.life === 1 ? '#c33' : '#333';
    html += `<div class="${cls}"><div class="sqd" style="background:${dotColor}"></div><div class="sqn">${m.name}</div><div class="sqhb"><div class="sqhf s" style="width:${m.sh / COMBAT.MAX_SHIELD * 100}%"></div></div><div class="sqhb"><div class="sqhf h" style="width:${m.hp / COMBAT.MAX_HP * 100}%"></div></div></div>`;
  }
  refs.squadHud.innerHTML = html;
}
