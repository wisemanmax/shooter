/**
 * shared/physics.ts
 * ═══════════════════════════════════════════════════════════════════════
 * Pure deterministic movement simulation, usable by both client and server.
 * Extracted from v6-heroes.html tickPM() into a framework-agnostic form.
 * No Three.js dependency — uses plain number math for all vectors.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { SIM } from './protocol';

/* ─── MOVEMENT STATES ─────────────────────────────────────────── */

export const enum MoveState {
  Ground = 0,
  Air    = 1,
  Slide  = 2,
  Mantle = 3,
}

/* ─── LOCAL PHYSICS CONSTANTS (not in protocol SIM) ───────────── */

/** Minimum speed before slide ends */
const SLIDE_MIN_SPEED   = 2;
/** Cooldown after exiting slide before another slide can start (seconds) */
const SLIDE_COOLDOWN    = 0.4;
/** Minimum horizontal speed to enter a slide */
const SLIDE_ENTRY_SPEED = 5;
/** Coyote time window after leaving ground (seconds) */
const COYOTE_TIME       = 0.1;
/** Jump buffer window (seconds) */
const JUMP_BUFFER       = 0.1;

/* ─── INTERFACES ──────────────────────────────────────────────── */

/** Input for physics simulation */
export interface MovementInput {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  crouch: boolean;
  jump: boolean;
  yaw: number;
  pitch: number;
}

/** State that physics operates on */
export interface MovementState {
  posX: number;
  posY: number;
  posZ: number;
  velX: number;
  velY: number;
  velZ: number;
  yaw: number;
  pitch: number;
  height: number;
  isSprint: boolean;
  isCrouch: boolean;
  moveState: MoveState;
  coyoteTimer: number;
  jumpBuffer: number;
  slideCooldown: number;
}

/** Ground query result (decoupled from Three.js) */
export interface GroundInfo {
  hit: boolean;
  height: number;
}

/** Collision query interface */
export interface CollisionQuery {
  ground(x: number, y: number, z: number): GroundInfo;
  resolveHorizontal(
    x: number,
    z: number,
    y: number,
    radius: number,
    height: number,
  ): { x: number; z: number };
}

/* ─── HELPERS ─────────────────────────────────────────────────── */

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function hSpeed(vx: number, vz: number): number {
  return Math.sqrt(vx * vx + vz * vz);
}

/* ─── MAIN SIMULATION ─────────────────────────────────────────── */

/**
 * Pure function: given current state, input, dt, speed multiplier, and
 * collision queries, returns the next MovementState.
 */
export function simulateMovement(
  state: MovementState,
  input: MovementInput,
  dt: number,
  speedMult: number,
  collision: CollisionQuery,
): MovementState {
  // Clone state so we don't mutate the original
  let posX          = state.posX;
  let posY          = state.posY;
  let posZ          = state.posZ;
  let velX          = state.velX;
  let velY          = state.velY;
  let velZ          = state.velZ;
  const yaw         = input.yaw;
  const pitch       = input.pitch;
  let height        = state.height;
  let isSprint      = state.isSprint;
  let isCrouch      = state.isCrouch;
  let moveState     = state.moveState;
  let coyoteTimer   = state.coyoteTimer;
  let jumpBuffer    = state.jumpBuffer;
  let slideCooldown = state.slideCooldown;

  // Cap dt at 0.05 to prevent physics explosions
  dt = Math.min(dt, 0.05);

  // Decrement timers
  slideCooldown = Math.max(0, slideCooldown - dt);
  coyoteTimer   = Math.max(0, coyoteTimer - dt);
  jumpBuffer    = Math.max(0, jumpBuffer - dt);

  // Buffer jump input
  if (input.jump) {
    jumpBuffer = JUMP_BUFFER;
  }

  // ── Forward and right vectors from yaw ──
  // Forward: (-sin(yaw), 0, -cos(yaw))   matches v6 e.fwd
  const fwdX = -Math.sin(yaw);
  const fwdZ = -Math.cos(yaw);
  // Right: (-cos(yaw), 0, sin(yaw))
  const rgtX = -Math.cos(yaw);
  const rgtZ =  Math.sin(yaw);

  // ── Compute wish direction ──
  let wdX = 0;
  let wdZ = 0;
  if (input.forward)  { wdX += fwdX; wdZ += fwdZ; }
  if (input.backward) { wdX -= fwdX; wdZ -= fwdZ; }
  if (input.right)    { wdX += rgtX; wdZ += rgtZ; }
  if (input.left)     { wdX -= rgtX; wdZ -= rgtZ; }
  const wdLen = Math.sqrt(wdX * wdX + wdZ * wdZ);
  if (wdLen > 0) {
    wdX /= wdLen;
    wdZ /= wdLen;
  }

  // ── Quake-style acceleration ──
  const acc = (wx: number, wz: number, speed: number, accel: number, d: number): void => {
    if (wx === 0 && wz === 0) return;
    speed *= speedMult;
    const currentProj = velX * wx + velZ * wz;
    let addSpeed = speed - currentProj;
    if (addSpeed <= 0) return;
    let accelSpeed = accel * d * speed;
    if (accelSpeed > addSpeed) accelSpeed = addSpeed;
    velX += accelSpeed * wx;
    velZ += accelSpeed * wz;
  };

  // ── Friction ──
  const frc = (friction: number, d: number): void => {
    const spd = hSpeed(velX, velZ);
    if (spd < 0.1) {
      velX = 0;
      velZ = 0;
      return;
    }
    const drop = spd * friction * d;
    const factor = Math.max(spd - drop, 0) / spd;
    velX *= factor;
    velZ *= factor;
  };

  // ── State transition helper ──
  const enterState = (newState: MoveState): void => {
    const prev = moveState;
    moveState = newState;

    if (newState === MoveState.Slide) {
      height = SIM.CROUCH_HEIGHT;
      isCrouch = true;
      // Slide boost: normalize horizontal velocity direction, multiply speed by SB
      const spd = hSpeed(velX, velZ);
      if (spd > 0) {
        const nx = velX / spd;
        const nz = velZ / spd;
        velX = nx * spd * SIM.SLIDE_BOOST;
        velZ = nz * spd * SIM.SLIDE_BOOST;
      }
    }

    if (prev === MoveState.Slide && newState !== MoveState.Slide) {
      slideCooldown = SLIDE_COOLDOWN;
    }

    if (newState === MoveState.Ground) {
      coyoteTimer = 0;
    }
  };

  // ── State machine ──
  if (moveState === MoveState.Ground) {
    isSprint = input.sprint && !isCrouch;

    if (input.crouch && !isCrouch) {
      // Entering crouch: check if we should slide
      if (isSprint && hSpeed(velX, velZ) >= SLIDE_ENTRY_SPEED && slideCooldown <= 0) {
        enterState(MoveState.Slide);
        // Return early after entering slide (matches v6 behavior)
        return buildResult();
      }
      isCrouch = true;
      height = SIM.CROUCH_HEIGHT;
    } else if (!input.crouch && isCrouch) {
      isCrouch = false;
      height = SIM.PLAYER_HEIGHT;
    }

    // Jump
    if (jumpBuffer > 0) {
      velY = SIM.JUMP_FORCE;
      jumpBuffer = 0;
      enterState(MoveState.Air);
      return buildResult();
    }

    // Ground movement
    const targetSpeed = isCrouch ? SIM.CROUCH_SPEED : (isSprint ? SIM.SPRINT_SPEED : SIM.WALK_SPEED);
    acc(wdX, wdZ, targetSpeed, SIM.GROUND_ACCEL, dt);
    frc(SIM.GROUND_FRICTION, dt);

  } else if (moveState === MoveState.Air) {
    // Gravity
    velY -= SIM.GRAVITY * dt;

    // Coyote time jump
    if (jumpBuffer > 0 && coyoteTimer > 0) {
      velY = SIM.JUMP_FORCE;
      jumpBuffer = 0;
      coyoteTimer = 0;
    }

    // Air strafing (Quake-style)
    acc(wdX, wdZ, SIM.AIR_SPEED_CAP, SIM.AIR_ACCEL, dt);
    if (SIM.AIR_FRICTION > 0) frc(SIM.AIR_FRICTION, dt);

  } else if (moveState === MoveState.Slide) {
    isCrouch = true;
    height = SIM.CROUCH_HEIGHT;

    frc(SIM.SLIDE_FRICTION, dt);

    // End slide if speed drops below minimum
    if (hSpeed(velX, velZ) < SLIDE_MIN_SPEED) {
      enterState(MoveState.Ground);
      return buildResult();
    }

    // End slide if player releases crouch
    if (!input.crouch) {
      isCrouch = false;
      height = SIM.PLAYER_HEIGHT;
      enterState(MoveState.Ground);
      return buildResult();
    }

    // Jump out of slide
    if (jumpBuffer > 0) {
      velY = SIM.JUMP_FORCE;
      jumpBuffer = 0;
      isCrouch = false;
      height = SIM.PLAYER_HEIGHT;
      enterState(MoveState.Air);
    }
  }

  // ── Position integration ──
  posX += velX * dt;
  posY += velY * dt;
  posZ += velZ * dt;

  // ── Ground collision ──
  const g = collision.ground(posX, posY, posZ);
  if (g.hit) {
    if (moveState === MoveState.Air && velY <= 0 && posY <= g.height + 0.05) {
      // Landing
      posY = g.height;
      velY = 0;
      enterState(MoveState.Ground);
    } else if (moveState === MoveState.Ground || moveState === MoveState.Slide) {
      // Ground snapping
      if (posY - g.height < SIM.STEP_HEIGHT && posY >= g.height - 0.5) {
        posY = g.height;
        if (velY < 0) velY = 0;
      } else if (posY > g.height + 0.2) {
        // Gap too big — fall off
        coyoteTimer = COYOTE_TIME;
        enterState(MoveState.Air);
      }
    }
  } else if (moveState === MoveState.Ground || moveState === MoveState.Slide) {
    // No ground beneath — transition to air
    coyoteTimer = COYOTE_TIME;
    enterState(MoveState.Air);
  }

  // ── Horizontal collision resolution ──
  const resolved = collision.resolveHorizontal(posX, posZ, posY, SIM.PLAYER_RADIUS, height);
  posX = resolved.x;
  posZ = resolved.z;

  // ── Map bounds clamping ──
  const B = SIM.MAP_RADIUS;
  posX = clamp(posX, -B, B);
  posZ = clamp(posZ, -B, B);

  // ── Death plane ──
  if (posY < -10) {
    posX = 0;
    posY = 5;
    posZ = 0;
    velX = 0;
    velY = 0;
    velZ = 0;
  }

  return buildResult();

  // ── Build immutable result ──
  function buildResult(): MovementState {
    return {
      posX,
      posY,
      posZ,
      velX,
      velY,
      velZ,
      yaw,
      pitch,
      height,
      isSprint,
      isCrouch,
      moveState,
      coyoteTimer,
      jumpBuffer,
      slideCooldown,
    };
  }
}
