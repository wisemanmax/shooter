/**
 * Bot AI behavior — extracted from v6-heroes.html tickBot (line 520).
 * Handles patrol, combat, revive, ring awareness, and ability usage.
 */

import * as THREE from 'three';
import { SIM, COMBAT } from '@shared/protocol';
import { CollisionSystem } from '../core/collision';
import { WEAPON_DEFS, applyRarity } from '../combat/weapons';
import { AMMO_TYPES } from '../combat/weapons';
import { AbilSys } from '../combat/abilities';
import { LootTable } from '../world/loot';
import type { Entity } from './entity';
import type { Ring } from '../world/ring';
import type { JumpPad } from '../world/traversal';

/* ── Bot config constants matching v6 C.* ── */

/** Bot fire cooldown base (seconds) */
const BOT_FIRE_CD = 0.35;
/** Bot fire accuracy chance */
const BOT_ACCURACY = 0.4;
/** Bot engagement range */
const BOT_ENGAGE_RANGE = 35;
/** Bot revive priority range */
const BOT_REVIVE_RANGE = 15;
/** Drop speed */
const DROP_SPEED = 18;
/** Drop height */
const DROP_HEIGHT = 60;

/**
 * Tick a bot entity for one frame.
 * Handles: dropping, downed, patrol, combat, revive, ring, abilities, physics.
 * @param e - The bot entity
 * @param dt - Frame delta time
 * @param allEnts - All entities in the match
 * @param time - Current game time in seconds
 * @param ring - Ring system
 * @param pads - Jump pads
 * @param col - Collision system
 * @param scene - THREE scene (for ability visuals)
 */
export function tickBot(
  e: Entity,
  dt: number,
  allEnts: Entity[],
  time: number,
  ring: Ring,
  pads: JumpPad[],
  col: CollisionSystem,
  scene: THREE.Scene,
): void {
  // ── Drop phase ──
  if (e.dropping) {
    e.dropY -= DROP_SPEED * dt;
    if (e.dropY <= 1) {
      e.dropping = false;
      e.pos.y = 0;
      // Auto-equip weapons
      const weaponKeys = Object.keys(WEAPON_DEFS);
      e.inv.pickup(
        applyRarity(WEAPON_DEFS[weaponKeys[Math.floor(Math.random() * weaponKeys.length)]], LootTable.rollRarity()),
        0,
      );
      e.inv.pickup(applyRarity(WEAPON_DEFS.ps, 'common'), 1);
      for (const k of Object.keys(AMMO_TYPES)) e.inv.addAmmo(k, 60);
      e.sh = 50;
    } else {
      e.pos.y = e.dropY;
      return;
    }
  }

  // ── Downed ──
  if (e.life === 1) {
    e.tickDowned(dt);
    return;
  }
  if (e.life !== 0) return;

  // ── Standard ticks ──
  e.tickShield(dt, time);
  e.abil.tick(dt);
  AbilSys.tickEffects(e, dt, allEnts, time);
  const w = e.activeWeapon;
  if (w) w.tick(dt);

  // ── Jump pads ──
  e._padCd = Math.max(0, (e._padCd || 0) - dt);
  if (e._padCd! <= 0) {
    for (const p of pads) {
      if (p.check(e as any)) {
        e._padCd = 1;
        break;
      }
    }
  }

  // ── Find targets ──
  const enemies = allEnts.filter(x => x.squadId !== e.squadId && x.life === 0 && !x.dropping);
  const downedAllies = allEnts.filter(x => x.squadId === e.squadId && x.life === 1 && x !== e);

  let nearestEnemy: Entity | null = null;
  let nearestEnemyDist = Infinity;
  for (const x of enemies) {
    const d = e.pos.distanceTo(x.pos);
    if (d < nearestEnemyDist) { nearestEnemyDist = d; nearestEnemy = x; }
  }

  let nearestDowned: Entity | null = null;
  let nearestDownedDist = Infinity;
  for (const x of downedAllies) {
    const d = e.pos.distanceTo(x.pos);
    if (d < nearestDownedDist) { nearestDownedDist = d; nearestDowned = x; }
  }

  // ── Choose target position ──
  const outsideRing = ring.isOutside(e.pos);
  let target: THREE.Vector3 | null = null;

  if (outsideRing) {
    // Move toward ring center
    target = new THREE.Vector3(ring.cx, 0, ring.cz);
  } else if (nearestDowned && nearestDownedDist < BOT_REVIVE_RANGE && (!nearestEnemy || nearestEnemyDist > 12)) {
    // Revive downed ally
    target = nearestDowned.pos;
    if (nearestDownedDist < COMBAT.REVIVE_DIST && !nearestDowned.beingRevived) {
      nearestDowned.beingRevived = true;
      nearestDowned.reviver = e;
    }
  } else if (nearestEnemy && nearestEnemyDist < BOT_ENGAGE_RANGE) {
    // Engage enemy
    target = nearestEnemy.pos;
  } else {
    // Patrol
    if (!(e as any)._pt || time - ((e as any)._ptT || 0) > 5) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * ring.currentR * 0.5;
      (e as any)._pt = new THREE.Vector3(ring.cx + Math.cos(a) * d, 0, ring.cz + Math.sin(a) * d);
      (e as any)._ptT = time;
    }
    target = (e as any)._pt;
  }

  // ── Move toward target ──
  if (target) {
    const dx = target.x - e.pos.x;
    const dz = target.z - e.pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > 1.5) {
      e.yaw = Math.atan2(-dx, -dz);
      const spd = (outsideRing ? SIM.SPRINT_SPEED : SIM.WALK_SPEED) * AbilSys.getSpeedMult(e);
      const fd = e.fwd;
      e.vel.x += (fd.x * spd - e.vel.x) * Math.min(dt * 8, 1);
      e.vel.z += (fd.z * spd - e.vel.z) * Math.min(dt * 8, 1);
    } else {
      e.vel.x *= 0.9;
      e.vel.z *= 0.9;
    }
  }

  // ── Combat ──
  if (nearestEnemy && nearestEnemyDist < BOT_ENGAGE_RANGE && w?.canFire) {
    (e as any)._ft = ((e as any)._ft || 0) - dt;
    if ((e as any)._ft <= 0 && col.lineOfSight(e.eye, nearestEnemy.eye)) {
      w.fire(false);
      (e as any)._ft = BOT_FIRE_CD + Math.random() * 0.3;
      if (Math.random() < BOT_ACCURACY) {
        const isHead = Math.random() < 0.1;
        nearestEnemy.takeDmg(isHead ? w.def.damage.head : w.def.damage.body, e, isHead);
      }
    }
    // Auto-reload
    if (w.ammo <= 0) w.ammo = w.def.magSize;
  }

  // ── Ability usage ──
  if (e.abil.tacReady && nearestEnemy && nearestEnemyDist < 20) {
    AbilSys.activate(e, 'tac', allEnts, scene, col);
  }
  if (e.abil.ultReady && nearestEnemy && nearestEnemyDist < 25) {
    AbilSys.activate(e, 'ult', allEnts, scene, col);
  }

  // ── Physics ──
  e.vel.y -= SIM.GRAVITY * dt;
  e.pos.x += e.vel.x * dt;
  e.pos.y += e.vel.y * dt;
  e.pos.z += e.vel.z * dt;

  const g = col.groundCheck(e.pos);
  if (g.hit && e.pos.y <= g.height + 0.05) {
    e.pos.y = g.height;
    if (e.vel.y < 0) e.vel.y = 0;
  }

  col.resolveHorizontal(e.pos, SIM.PLAYER_RADIUS, e.height);
  e.pos.x = THREE.MathUtils.clamp(e.pos.x, -SIM.MAP_RADIUS, SIM.MAP_RADIUS);
  e.pos.z = THREE.MathUtils.clamp(e.pos.z, -SIM.MAP_RADIUS, SIM.MAP_RADIUS);
}
