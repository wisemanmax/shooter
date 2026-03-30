/**
 * Bot AI behavior — enhanced with cover seeking, looting, squad cohesion,
 * and distance-based accuracy.
 */

import * as THREE from 'three';
import { SIM, COMBAT } from '@shared/protocol';
import { CollisionSystem } from '../core/collision';
import { WEAPON_DEFS, applyRarity } from '../combat/weapons';
import { AMMO_TYPES } from '../combat/weapons';
import { AbilSys } from '../combat/abilities';
import { LootTable } from '../world/loot';
import { Ev } from '../utils/events';
import type { Entity } from './entity';
import type { Ring } from '../world/ring';
import type { JumpPad } from '../world/traversal';
import type { LootNode } from '../world/loot';

/* ── Bot config constants ── */

const BOT_FIRE_CD = 0.35;
const BOT_ENGAGE_RANGE = 35;
const BOT_REVIVE_RANGE = 15;
const DROP_SPEED = 18;
const LOOT_RANGE = 12;
const SQUAD_FOLLOW_DIST = 18;
const COVER_SEARCH_DIST = 10;

/** Accuracy falls off with distance: high at close range, low at far */
function getAccuracy(dist: number): number {
  if (dist < 5) return 0.6;
  if (dist < 15) return 0.5;
  if (dist < 25) return 0.35;
  if (dist < 35) return 0.2;
  return 0.12;
}

/* ── Bot AI state enum ── */
const enum BotState {
  PATROL,
  ENGAGE,
  SEEK_COVER,
  LOOT,
  REVIVE,
  FLEE_RING,
  FOLLOW_SQUAD,
}

/* ── Per-bot persistent state (stored on entity via expando) ── */
interface BotAI {
  state: BotState;
  patrolTarget: THREE.Vector3 | null;
  patrolTime: number;
  fireCd: number;
  coverPos: THREE.Vector3 | null;
  coverTime: number;
  lootTarget: LootNode | null;
  stateTime: number;
  kills: number;
  damageDealt: number;
}

function getAI(e: Entity): BotAI {
  if (!(e as any)._ai) {
    (e as any)._ai = {
      state: BotState.PATROL,
      patrolTarget: null,
      patrolTime: 0,
      fireCd: 0,
      coverPos: null,
      coverTime: 0,
      lootTarget: null,
      stateTime: 0,
      kills: 0,
      damageDealt: 0,
    };
  }
  return (e as any)._ai;
}

/** Find a cover position behind a wall relative to the threat */
function findCover(
  e: Entity,
  threat: THREE.Vector3,
  col: CollisionSystem,
): THREE.Vector3 | null {
  const toThreat = threat.clone().sub(e.pos).normalize();
  // Try several directions away from threat
  for (let angle = Math.PI; angle > Math.PI * 0.5; angle -= 0.4) {
    for (const sign of [1, -1]) {
      const dir = toThreat.clone()
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), angle * sign)
        .multiplyScalar(COVER_SEARCH_DIST);
      const candidate = e.pos.clone().add(dir);

      // Check if this position has a wall between it and the threat
      if (!col.lineOfSight(candidate, threat)) {
        return candidate;
      }
    }
  }
  return null;
}

/** Find nearest squad leader (first alive member) for squad cohesion */
function findSquadLeader(e: Entity, allEnts: Entity[]): Entity | null {
  for (const other of allEnts) {
    if (other.squadId === e.squadId && other !== e && other.life === 0 && !other.dropping) {
      return other;
    }
  }
  return null;
}

/**
 * Tick a bot entity for one frame.
 * Enhanced with: cover seeking, looting, squad cohesion, distance-based accuracy.
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
  lootNodes?: LootNode[],
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

  const ai = getAI(e);
  ai.fireCd -= dt;
  ai.stateTime += dt;

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

  const outsideRing = ring.isOutside(e.pos);
  const lowHealth = e.hp < 30;

  // ── State transitions ──
  if (outsideRing) {
    ai.state = BotState.FLEE_RING;
  } else if (nearestDowned && nearestDownedDist < BOT_REVIVE_RANGE && (!nearestEnemy || nearestEnemyDist > 12)) {
    ai.state = BotState.REVIVE;
  } else if (nearestEnemy && nearestEnemyDist < BOT_ENGAGE_RANGE) {
    // Low health? Seek cover first
    if (lowHealth && ai.state !== BotState.SEEK_COVER) {
      const cover = findCover(e, nearestEnemy.pos, col);
      if (cover) {
        ai.coverPos = cover;
        ai.coverTime = 0;
        ai.state = BotState.SEEK_COVER;
      } else {
        ai.state = BotState.ENGAGE;
      }
    } else if (ai.state !== BotState.SEEK_COVER || ai.coverTime > 3) {
      ai.state = BotState.ENGAGE;
    }
  } else if (lootNodes && !w && ai.state !== BotState.LOOT) {
    // No weapon — try to loot
    const nearest = findNearestLoot(e, lootNodes);
    if (nearest) {
      ai.lootTarget = nearest;
      ai.state = BotState.LOOT;
    }
  } else if (lootNodes && ai.stateTime > 4 && ai.state === BotState.PATROL) {
    // Periodic loot check while patrolling
    const nearest = findNearestLoot(e, lootNodes);
    if (nearest && e.pos.distanceTo(nearest.pos) < LOOT_RANGE) {
      ai.lootTarget = nearest;
      ai.state = BotState.LOOT;
      ai.stateTime = 0;
    }
  } else {
    // Squad cohesion: if too far from leader, follow
    const leader = findSquadLeader(e, allEnts);
    if (leader && e.pos.distanceTo(leader.pos) > SQUAD_FOLLOW_DIST) {
      ai.state = BotState.FOLLOW_SQUAD;
    } else if (ai.state !== BotState.LOOT && ai.state !== BotState.FOLLOW_SQUAD) {
      ai.state = BotState.PATROL;
    }
  }

  // ── Execute state ──
  let target: THREE.Vector3 | null = null;
  let moveSpeed = SIM.WALK_SPEED;

  switch (ai.state) {
    case BotState.FLEE_RING:
      target = new THREE.Vector3(ring.cx, 0, ring.cz);
      moveSpeed = SIM.SPRINT_SPEED;
      break;

    case BotState.REVIVE:
      if (nearestDowned) {
        target = nearestDowned.pos;
        if (nearestDownedDist < COMBAT.REVIVE_DIST && !nearestDowned.beingRevived) {
          nearestDowned.beingRevived = true;
          nearestDowned.reviver = e;
        }
      }
      break;

    case BotState.ENGAGE:
      if (nearestEnemy) {
        target = nearestEnemy.pos;
        // Strafe slightly while engaging
        const perpAngle = Math.atan2(-(nearestEnemy.pos.x - e.pos.x), -(nearestEnemy.pos.z - e.pos.z));
        const strafeDir = Math.sin(time * 2 + e.squadId) > 0 ? 1 : -1;
        if (nearestEnemyDist < 15) {
          target = e.pos.clone().add(new THREE.Vector3(
            Math.cos(perpAngle + Math.PI * 0.5 * strafeDir) * 3,
            0,
            Math.sin(perpAngle + Math.PI * 0.5 * strafeDir) * 3,
          ));
        }
      }
      break;

    case BotState.SEEK_COVER:
      ai.coverTime += dt;
      target = ai.coverPos;
      moveSpeed = SIM.SPRINT_SPEED;
      if (ai.coverTime > 3) {
        ai.state = BotState.ENGAGE;
      }
      break;

    case BotState.LOOT:
      if (ai.lootTarget && ai.lootTarget.active) {
        target = ai.lootTarget.pos;
        if (e.pos.distanceTo(ai.lootTarget.pos) < 2.5) {
          // Pick up the loot
          pickupLoot(e, ai.lootTarget);
          ai.lootTarget = null;
          ai.state = BotState.PATROL;
          ai.stateTime = 0;
        }
      } else {
        ai.lootTarget = null;
        ai.state = BotState.PATROL;
      }
      break;

    case BotState.FOLLOW_SQUAD: {
      const leader = findSquadLeader(e, allEnts);
      if (leader) {
        target = leader.pos;
        if (e.pos.distanceTo(leader.pos) < 8) {
          ai.state = BotState.PATROL;
        }
      }
      break;
    }

    case BotState.PATROL:
    default:
      if (!ai.patrolTarget || time - ai.patrolTime > 5) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * ring.currentR * 0.5;
        ai.patrolTarget = new THREE.Vector3(ring.cx + Math.cos(a) * d, 0, ring.cz + Math.sin(a) * d);
        ai.patrolTime = time;
      }
      target = ai.patrolTarget;
      break;
  }

  // ── Move toward target ──
  if (target) {
    const dx = target.x - e.pos.x;
    const dz = target.z - e.pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > 1.5) {
      e.yaw = Math.atan2(-dx, -dz);
      const spd = moveSpeed * AbilSys.getSpeedMult(e);
      const fd = e.fwd;
      e.vel.x += (fd.x * spd - e.vel.x) * Math.min(dt * 8, 1);
      e.vel.z += (fd.z * spd - e.vel.z) * Math.min(dt * 8, 1);
    } else {
      e.vel.x *= 0.9;
      e.vel.z *= 0.9;
    }
  }

  // ── Combat (can fire in multiple states) ──
  if (nearestEnemy && nearestEnemyDist < BOT_ENGAGE_RANGE && w?.canFire) {
    if (ai.fireCd <= 0 && col.lineOfSight(e.eye, nearestEnemy.eye)) {
      // Face enemy when shooting
      const edx = nearestEnemy.pos.x - e.pos.x;
      const edz = nearestEnemy.pos.z - e.pos.z;
      e.yaw = Math.atan2(-edx, -edz);

      w.fire(false);
      ai.fireCd = BOT_FIRE_CD + Math.random() * 0.3;

      // Distance-based accuracy
      if (Math.random() < getAccuracy(nearestEnemyDist)) {
        const isHead = Math.random() < 0.1;
        const dmg = isHead ? w.def.damage.head : w.def.damage.body;
        nearestEnemy.takeDmg(dmg, e, isHead);
        ai.damageDealt += dmg;
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

/** Find nearest active loot node within range */
function findNearestLoot(e: Entity, nodes: LootNode[]): LootNode | null {
  let best: LootNode | null = null;
  let bestDist = LOOT_RANGE;
  for (const n of nodes) {
    if (!n.active) continue;
    const d = e.pos.distanceTo(n.pos);
    if (d < bestDist) { bestDist = d; best = n; }
  }
  return best;
}

/** Bot picks up loot from a node */
function pickupLoot(e: Entity, node: LootNode): void {
  for (const item of node.items) {
    if (item.t === 'w') {
      // Equip weapon if slot empty, otherwise skip
      if (!e.inv.slots[0]) {
        e.inv.pickup(applyRarity(WEAPON_DEFS[item.wid], item.r), 0);
      } else if (!e.inv.slots[1]) {
        e.inv.pickup(applyRarity(WEAPON_DEFS[item.wid], item.r), 1);
      }
    } else if (item.t === 'a') {
      e.inv.addAmmo(item.at, item.am);
    }
  }
  node.collect();
  Ev.emit('loot:pickup', {});
}

/** Get bot stats for scoreboard */
export function getBotStats(e: Entity): { kills: number; damageDealt: number } {
  const ai = getAI(e);
  return { kills: ai.kills, damageDealt: ai.damageDealt };
}
