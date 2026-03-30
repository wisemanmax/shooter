/**
 * Player controller — camera, movement, firing, interaction.
 * Extracted from v6-heroes.html game loop player logic.
 */

import * as THREE from 'three';
import { SIM, COMBAT } from '@shared/protocol';
import { Input } from '../core/input';
import { CollisionSystem } from '../core/collision';
import { AbilSys } from '../combat/abilities';
import { WEAPON_DEFS, applyRarity, AMMO_TYPES } from '../combat/weapons';
import { CONSUMABLES } from '../combat/damage';
import { Ev } from '../utils/events';
import type { Entity, MoveStateValue } from './entity';
import type { Zipline, JumpPad, Door } from '../world/traversal';
import type { LootNode, LootBin } from '../world/loot';

/* ── Movement state enum ── */
const MS = { GROUND: 0, AIR: 1, SLIDE: 2, MANTLE: 3 } as const;

/* ── Config from v6 ── */
const SENS = 0.002;
const FOV_BASE = 90;
const FOV_SPRINT = 5;
const FOV_LERP = 8;
const DROP_SPEED = 18;
const LINT = 2.5; // loot interact distance
const BIN_INT = 2;
const DOOR_INT = 2.5;

/**
 * Process player camera look input.
 * @param player - Player entity
 * @param sensitivity - Mouse sensitivity multiplier
 */
export function updatePlayerLook(player: Entity, sensitivity: number): void {
  if (!Input.locked || player.life !== 0) {
    Input.consumeMouse();
    return;
  }
  const m = Input.consumeMouse();
  player.yaw -= m.dx * sensitivity * Input.sensitivity;
  player.pitch -= m.dy * sensitivity * Input.sensitivity;
  player.pitch = THREE.MathUtils.clamp(player.pitch, -Math.PI * 0.49, Math.PI * 0.49);
}

/**
 * Tick player movement using the inline v6 physics (tickPM).
 * This is the client-side movement for offline/firing range mode.
 * In networked mode, use client prediction with shared/physics.ts instead.
 */
export function tickPlayerMovement(player: Entity, dt: number, col: CollisionSystem): void {
  if (player.life !== 0 || player.dropping || player.onZip) return;
  dt = Math.min(dt, 0.05);

  player._scd = Math.max(0, (player._scd || 0) - dt);
  player._coy = Math.max(0, (player._coy || 0) - dt);
  player._jb = Math.max(0, (player._jb || 0) - dt);
  if (Input.jump) player._jb = 0.1;

  const fwd = player.fwd;
  const right = new THREE.Vector3(-Math.cos(player.yaw), 0, Math.sin(player.yaw));
  const wd = new THREE.Vector3();
  if (Input.forward) wd.add(fwd);
  if (Input.backward) wd.sub(fwd);
  if (Input.right) wd.add(right);
  if (Input.left) wd.sub(right);
  if (wd.lengthSq() > 0) wd.normalize();

  const ms = player._ms ?? MS.AIR;
  const sm = AbilSys.getSpeedMult(player);

  const acc = (w: THREE.Vector3, s: number, a: number, d2: number): void => {
    if (w.lengthSq() === 0) return;
    s *= sm;
    const c = player.vel.x * w.x + player.vel.z * w.z;
    let addSpd = s - c;
    if (addSpd <= 0) return;
    let v = a * d2 * s;
    if (v > addSpd) v = addSpd;
    player.vel.x += v * w.x;
    player.vel.z += v * w.z;
  };

  const frc = (friction: number, d2: number): void => {
    const spd = player.hSpd;
    if (spd < 0.1) { player.vel.x = 0; player.vel.z = 0; return; }
    const drop = spd * friction * d2;
    const factor = Math.max(spd - drop, 0) / spd;
    player.vel.x *= factor;
    player.vel.z *= factor;
  };

  const enterState = (s: MoveStateValue): void => {
    const prev = player._ms;
    player._ms = s;
    if (s === MS.SLIDE) {
      player.height = SIM.CROUCH_HEIGHT;
      player.isCrouch = true;
      const spd = player.hSpd;
      const dir = new THREE.Vector3(player.vel.x, 0, player.vel.z).normalize();
      player.vel.x = dir.x * spd * SIM.SLIDE_BOOST;
      player.vel.z = dir.z * spd * SIM.SLIDE_BOOST;
    }
    if (prev === MS.SLIDE && s !== MS.SLIDE) player._scd = 0.4;
    if (s === MS.GROUND) player._coy = 0;
  };

  if (ms === MS.GROUND) {
    player.isSprint = Input.sprint && !player.isCrouch;
    if (Input.crouch && !player.isCrouch) {
      if (player.isSprint && player.hSpd >= 5 && (player._scd || 0) <= 0) {
        enterState(MS.SLIDE);
        return;
      }
      player.isCrouch = true;
      player.height = SIM.CROUCH_HEIGHT;
    } else if (!Input.crouch && player.isCrouch) {
      player.isCrouch = false;
      player.height = SIM.PLAYER_HEIGHT;
    }
    if (player._jb! > 0) {
      player.vel.y = SIM.JUMP_FORCE;
      player._jb = 0;
      enterState(MS.AIR);
      return;
    }
    const targetSpd = player.isCrouch ? SIM.CROUCH_SPEED : (player.isSprint ? SIM.SPRINT_SPEED : SIM.WALK_SPEED);
    acc(wd, targetSpd, SIM.GROUND_ACCEL, dt);
    frc(SIM.GROUND_FRICTION, dt);
  } else if (ms === MS.AIR) {
    player.vel.y -= SIM.GRAVITY * dt;
    if (player._jb! > 0 && (player._coy || 0) > 0) {
      player.vel.y = SIM.JUMP_FORCE;
      player._jb = 0;
      player._coy = 0;
    }
    acc(wd, SIM.AIR_SPEED_CAP, SIM.AIR_ACCEL, dt);
    if (SIM.AIR_FRICTION > 0) frc(SIM.AIR_FRICTION, dt);
  } else if (ms === MS.SLIDE) {
    player.isCrouch = true;
    player.height = SIM.CROUCH_HEIGHT;
    frc(SIM.SLIDE_FRICTION, dt);
    if (player.hSpd < 2) { enterState(MS.GROUND); return; }
    if (!Input.crouch) { player.isCrouch = false; player.height = SIM.PLAYER_HEIGHT; enterState(MS.GROUND); return; }
    if (player._jb! > 0) {
      player.vel.y = SIM.JUMP_FORCE;
      player._jb = 0;
      player.isCrouch = false;
      player.height = SIM.PLAYER_HEIGHT;
      enterState(MS.AIR);
    }
  }

  // Position integration
  player.pos.x += player.vel.x * dt;
  player.pos.y += player.vel.y * dt;
  player.pos.z += player.vel.z * dt;

  // Ground collision
  const g = col.groundCheck(player.pos);
  if (g.hit) {
    if (ms === MS.AIR && player.vel.y <= 0 && player.pos.y <= g.height + 0.05) {
      player.pos.y = g.height;
      player.vel.y = 0;
      enterState(MS.GROUND);
    } else if (ms === MS.GROUND || ms === MS.SLIDE) {
      if (player.pos.y - g.height < SIM.STEP_HEIGHT && player.pos.y >= g.height - 0.5) {
        player.pos.y = g.height;
        if (player.vel.y < 0) player.vel.y = 0;
      } else if (player.pos.y > g.height + 0.2) {
        player._coy = 0.1;
        enterState(MS.AIR);
      }
    }
  } else if (ms === MS.GROUND || ms === MS.SLIDE) {
    player._coy = 0.1;
    enterState(MS.AIR);
  }

  col.resolveHorizontal(player.pos, SIM.PLAYER_RADIUS, player.height);
  player.pos.x = THREE.MathUtils.clamp(player.pos.x, -SIM.MAP_RADIUS, SIM.MAP_RADIUS);
  player.pos.z = THREE.MathUtils.clamp(player.pos.z, -SIM.MAP_RADIUS, SIM.MAP_RADIUS);
  if (player.pos.y < -10) { player.pos.set(0, 5, 0); player.vel.set(0, 0, 0); }
}

/**
 * Process player drop phase.
 * @returns true if still dropping
 */
export function tickPlayerDrop(player: Entity, dt: number): boolean {
  if (!player.dropping) return false;
  player.dropY -= DROP_SPEED * dt;
  player.pos.y = player.dropY;
  if (player.dropY <= 1) {
    player.dropping = false;
    player.pos.y = 0;
    player._ms = MS.AIR;
    player.inv.pickup(applyRarity(WEAPON_DEFS.ps, 'common'), 0);
    player.inv.addAmmo('light', 60);
    return false;
  }
  return true;
}

/**
 * Handle player weapon firing.
 * @returns true if a shot was fired this frame
 */
export function tickPlayerFire(
  player: Entity,
  cam: THREE.Camera,
  col: CollisionSystem,
): boolean {
  const aw = player.activeWeapon;
  if (!aw || player.life !== 0 || player.onZip) return false;

  if (Input.fire) {
    if (aw.ammo <= 0 && !aw.reloading) {
      player.inv.reloadActive();
      return false;
    }
    const semiBlock = aw.def.mode === 'semi' && aw.lastFired;
    if (aw.fire(semiBlock)) {
      const recoilMult = AbilSys.getRecoilMult(player);
      const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const origin = cam.position.clone();

      player.pitch += aw.recoilPitch * 0.012 * recoilMult;
      player.yaw += aw.recoilYaw * 0.006 * recoilMult;

      // Fire pellets
      for (let p = 0; p < aw.def.pellets; p++) {
        const spreadRad = THREE.MathUtils.degToRad(aw.spread);
        const dir = camDir.clone();
        dir.x += (Math.random() - 0.5) * spreadRad;
        dir.y += (Math.random() - 0.5) * spreadRad;
        dir.normalize();

        const hit = col.ray(origin, dir, aw.def.range);
        const end = hit ? hit.point.clone() : origin.clone().add(dir.multiplyScalar(aw.def.range));

        Ev.emit('weapon:fire', { weaponId: aw.def.id, origin, end });

        if (hit?.object.userData.entity) {
          const target = hit.object.userData.entity as Entity;
          if (target.squadId !== player.squadId) {
            const isHead = hit.object.userData.isHead as boolean;
            target.takeDmg(isHead ? aw.def.damage.head : aw.def.damage.body, player, isHead);
          }
        }
      }
      return true;
    }
  }
  if (!Input.fire && aw) aw.lastFired = false;
  return false;
}

/** Interact result with display text and whether something was found */
export interface InteractResult {
  text: string;
  active: boolean;
  reviveTarget: Entity | null;
  reviveActive: boolean;
}

/**
 * Process player interactions: loot, bins, doors, ziplines, revive, death boxes, beacons.
 */
export function tickPlayerInteract(
  player: Entity,
  allEnts: Entity[],
  ziplines: Zipline[],
  lNodes: LootNode[],
  lBins: LootBin[],
  doors: Door[],
  deathBoxes: any[],
  beacons: any[],
): InteractResult {
  const result: InteractResult = { text: '', active: false, reviveTarget: null, reviveActive: false };
  if (player.life !== 0 || player.dropping || player.onZip) return result;

  // Ziplines
  for (const z of ziplines) {
    const { dist, t } = z.nearestAnchor(player.pos);
    if (dist < 2.5) {
      result.text = 'Ride Zipline'; result.active = true;
      if (Input.interactJustPressed) {
        z.attach(player as any, t);
        Ev.emit('zip:start', {});
        break;
      }
    }
  }

  // Loot nodes
  let nearestLoot: LootNode | null = null;
  let nearestLootDist = Infinity;
  for (const l of lNodes) {
    if (!l.active) continue;
    const d = l.pos.distanceTo(player.pos);
    if (d < LINT && d < nearestLootDist) { nearestLootDist = d; nearestLoot = l; }
  }
  if (nearestLoot) {
    result.text = nearestLoot.getLabel();
    result.active = true;
    if (Input.interactJustPressed) {
      for (const item of nearestLoot.items) {
        if (item.t === 'w') {
          player.inv.pickup(applyRarity(WEAPON_DEFS[item.wid], item.r), player.inv.activeIndex);
          Ev.emit('weapon:swap', {});
        } else if (item.t === 'a') {
          player.inv.addAmmo(item.at, item.am);
        } else if (item.t === 'c') {
          player.inv.addConsumable(item.cid, item.am);
        }
      }
      nearestLoot.collect();
      Ev.emit('loot:pickup', {});
    }
  }

  // Loot bins
  for (const b of lBins) {
    if (b.open) continue;
    const d = b.pos.distanceTo(player.pos);
    if (d < BIN_INT) {
      result.text = b.getLabel();
      result.active = true;
      if (Input.interactJustPressed) {
        for (const item of b.openBin()) {
          if (item.t === 'w') {
            player.inv.pickup(applyRarity(WEAPON_DEFS[item.wid], item.r), player.inv.activeIndex);
            Ev.emit('weapon:swap', {});
          } else if (item.t === 'a') {
            player.inv.addAmmo(item.at, item.am);
          } else if (item.t === 'c') {
            player.inv.addConsumable(item.cid, item.am);
          }
        }
        Ev.emit('loot:pickup', {});
      }
      break;
    }
  }

  // Doors
  if (Input.door) {
    for (const d of doors) {
      if (d.distanceTo(player.pos) < DOOR_INT) { d.toggle(); break; }
    }
  }

  // Revive
  let nearestDowned: Entity | null = null;
  let nearestDownedDist = Infinity;
  for (const e of allEnts) {
    if (e.squadId === player.squadId && e.life === 1 && e !== player) {
      const d = player.pos.distanceTo(e.pos);
      if (d < nearestDownedDist) { nearestDownedDist = d; nearestDowned = e; }
    }
  }
  if (nearestDowned && nearestDownedDist < COMBAT.REVIVE_DIST) {
    result.text = 'Revive ' + nearestDowned.name;
    result.active = true;
    if (Input.interact) {
      if (!nearestDowned.beingRevived) {
        nearestDowned.beingRevived = true;
        nearestDowned.reviver = player;
      }
      result.reviveTarget = nearestDowned;
      result.reviveActive = true;
    } else {
      if (nearestDowned.reviver === player) {
        nearestDowned.beingRevived = false;
        nearestDowned.reviveProgress = 0;
        nearestDowned.reviver = null;
      }
    }
  }

  // Death boxes (banner pickup)
  for (const db of deathBoxes) {
    if (!db.hasBnr) continue;
    const d = db.pos.distanceTo(player.pos);
    if (d < LINT && db.ent.squadId === player.squadId) {
      result.text = 'Grab banner';
      result.active = true;
      if (Input.interactJustPressed) {
        db.grab();
        db.ent.banner = 'held';
        db.ent.bannerHolder = player;
        Ev.emit('banner:grabbed', { entity: db.ent });
      }
    }
  }

  // Respawn beacons
  for (const b of beacons) {
    if (!b.ok) continue;
    const d = b.pos.distanceTo(player.pos);
    if (d < 3) {
      const held = allEnts.filter(e => e.bannerHolder === player && e.life === 2);
      if (held.length > 0) {
        result.text = 'Respawn ' + held[0].name;
        result.active = true;
        if (Input.interactJustPressed) {
          held[0].pos.set(b.pos.x + 2, 1, b.pos.z);
          held[0].revive(true);
          held[0].banner = null;
          held[0].bannerHolder = null;
          b.ok = false;
          Ev.emit('entity:respawned', { entity: held[0] });
        }
      }
    }
  }

  return result;
}

/**
 * Process consumable use from inventory keys (3-6).
 */
export function tickPlayerConsumables(player: Entity): void {
  if (player.life !== 0) return;
  const keyMap: Record<string, string> = {
    useConsumable3: 'syringe', useConsumable4: 'medkit',
    useConsumable5: 'cell', useConsumable6: 'battery',
  };
  for (const [key, id] of Object.entries(keyMap)) {
    if ((Input as any)[key] && player.inv.consumables[id] && player.life === 0) {
      const c = CONSUMABLES[id];
      player.inv.consumables[id]--;
      if (player.inv.consumables[id] <= 0) delete player.inv.consumables[id];
      if (c.effect === 'hp') player.hp = Math.min(player.hp + c.amount, COMBAT.MAX_HP);
      else player.sh = Math.min(player.sh + c.amount, COMBAT.MAX_SHIELD);
      Ev.emit('consumable:used', { id });
    }
  }
}

/**
 * Process weapon swapping via keys 1, 2, or scroll wheel.
 * @returns true if a swap occurred
 */
export function tickPlayerWeaponSwap(player: Entity): boolean {
  const scroll = Input.consumeScroll();
  if (Input.swap1 && player.inv.activeIndex !== 0) {
    player.inv.activeIndex = 0;
    Ev.emit('weapon:swap', {});
    return true;
  }
  if (Input.swap2 && player.inv.activeIndex !== 1 && player.inv.slots[1]) {
    player.inv.activeIndex = 1;
    Ev.emit('weapon:swap', {});
    return true;
  }
  if (scroll !== 0 && player.inv.slots[1]) {
    player.inv.activeIndex = player.inv.activeIndex === 0 ? 1 : 0;
    Ev.emit('weapon:swap', {});
    return true;
  }
  if (Input.reload) {
    player.inv.reloadActive();
    Ev.emit('weapon:reload_start', {});
  }
  return false;
}

/**
 * Get the target FOV based on player state.
 */
export function getTargetFOV(player: Entity, baseFov: number): number {
  let fov = baseFov;
  if (player.isSprint && player.hSpd > SIM.WALK_SPEED) fov += FOV_SPRINT;
  if (player.onZip) fov += 8;
  return fov;
}
