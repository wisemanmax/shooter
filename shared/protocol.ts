/**
 * shared/protocol.ts
 * ═══════════════════════════════════════════════════════════════════════
 * Data contracts and constants shared between server and client.
 * This is the SINGLE SOURCE OF TRUTH for all network communication.
 *
 * Typed TypeScript conversion of protocol.js.
 * ═══════════════════════════════════════════════════════════════════════
 */

/* ─── SERVER CONFIGURATION ────────────────────────────────────── */
export const TICK_RATE        = 20;
export const TICK_MS          = 1000 / 20;  // 50ms per tick
export const SNAPSHOT_RATE    = 20;
export const MAX_PLAYERS      = 15;         // 5 squads × 3
export const SQUAD_SIZE       = 3;
export const MAX_SQUADS       = 5;
export const INTERP_DELAY_MS  = 100;
export const MAX_REWIND_MS    = 300;
export const RECONNECT_WINDOW = 60;
export const SESSION_TTL      = 3600;

/* ─── SHARED GAME CONSTANTS ───────────────────────────────────── */

export interface SimConstants {
  WALK_SPEED: number;
  SPRINT_SPEED: number;
  CROUCH_SPEED: number;
  GROUND_ACCEL: number;
  GROUND_FRICTION: number;
  AIR_ACCEL: number;
  AIR_SPEED_CAP: number;
  AIR_FRICTION: number;
  JUMP_FORCE: number;
  GRAVITY: number;
  PLAYER_HEIGHT: number;
  CROUCH_HEIGHT: number;
  PLAYER_RADIUS: number;
  STEP_HEIGHT: number;
  MAX_SPEED: number;
  SLIDE_BOOST: number;
  SLIDE_FRICTION: number;
  MAP_RADIUS: number;
}

export const SIM: SimConstants = {
  WALK_SPEED: 6,
  SPRINT_SPEED: 10.5,
  CROUCH_SPEED: 3,
  GROUND_ACCEL: 55,
  GROUND_FRICTION: 9,
  AIR_ACCEL: 12,
  AIR_SPEED_CAP: 2.5,
  AIR_FRICTION: 0.2,
  JUMP_FORCE: 8.5,
  GRAVITY: 23,
  PLAYER_HEIGHT: 1.8,
  CROUCH_HEIGHT: 1.0,
  PLAYER_RADIUS: 0.35,
  STEP_HEIGHT: 0.35,
  MAX_SPEED: 25,
  SLIDE_BOOST: 1.15,
  SLIDE_FRICTION: 2.2,
  MAP_RADIUS: 95,
};

export interface CombatConstants {
  MAX_HP: number;
  MAX_SHIELD: number;
  HEADSHOT_MULT: number;
  SHIELD_REGEN_DELAY: number;
  SHIELD_REGEN_RATE: number;
  BLEED_TIME: number;
  REVIVE_TIME: number;
  REVIVE_DIST: number;
}

export const COMBAT: CombatConstants = {
  MAX_HP: 100,
  MAX_SHIELD: 100,
  HEADSHOT_MULT: 2.0,
  SHIELD_REGEN_DELAY: 5,
  SHIELD_REGEN_RATE: 15,
  BLEED_TIME: 30,
  REVIVE_TIME: 5,
  REVIVE_DIST: 2.5,
};

export interface ValidationConstants {
  POS_TOLERANCE: number;
  SPEED_TOLERANCE: number;
  SHOT_ANGLE_TOL: number;
  DAMAGE_WINDOW: number;
  LOOT_DIST: number;
  ABILITY_DIST: number;
}

export const VALIDATION: ValidationConstants = {
  POS_TOLERANCE: 2.0,
  SPEED_TOLERANCE: 1.3,
  SHOT_ANGLE_TOL: 5.0,
  DAMAGE_WINDOW: 0.5,
  LOOT_DIST: 4.0,
  ABILITY_DIST: 50.0,
};

/* ─── MESSAGE TYPES ───────────────────────────────────────────── */

/** Client → Server message types */
export const C2S = {
  // Session / lobby
  AUTH:            'c:auth',
  JOIN_QUEUE:      'c:join_queue',
  LEAVE_QUEUE:     'c:leave_queue',
  RECONNECT:       'c:reconnect',

  // Gameplay input (sent every client frame, ~60Hz)
  INPUT:           'c:input',

  // Actions (sent on event, not per-frame)
  FIRE:            'c:fire',
  RELOAD:          'c:reload',
  SWAP_WEAPON:     'c:swap_weapon',
  USE_CONSUMABLE:  'c:use_consumable',
  INTERACT:        'c:interact',
  USE_ABILITY:     'c:use_ability',
  DOOR_TOGGLE:     'c:door_toggle',

  // Social / ping
  PING_MAP:        'c:ping',
} as const;

/** Server → Client message types */
export const S2C = {
  // Session / lobby
  AUTH_OK:         's:auth_ok',
  AUTH_FAIL:       's:auth_fail',
  QUEUE_STATUS:    's:queue_status',
  MATCH_FOUND:     's:match_found',
  RECONNECT_OK:    's:reconnect_ok',
  RECONNECT_FAIL:  's:reconnect_fail',

  // Game state (sent at SNAPSHOT_RATE Hz)
  SNAPSHOT:        's:snapshot',

  // Events (sent immediately on occurrence)
  ENTITY_DAMAGED:  's:entity_damaged',
  ENTITY_DOWNED:   's:entity_downed',
  ENTITY_ELIMINATED: 's:entity_eliminated',
  ENTITY_REVIVED:  's:entity_revived',
  LOOT_SPAWNED:    's:loot_spawned',
  LOOT_COLLECTED:  's:loot_collected',
  DOOR_TOGGLED:    's:door_toggled',
  RING_UPDATE:     's:ring_update',
  ABILITY_EVENT:   's:ability_event',
  PING_EVENT:      's:ping_event',
  KILL_FEED:       's:kill_feed',
  SQUAD_WIPE:      's:squad_wipe',
  MATCH_END:       's:match_end',
  SERVER_CORRECTION: 's:correction',
} as const;

/* ─── DATA SCHEMAS ────────────────────────────────────────────── */

/** InputPacket — sent by client every frame (~60Hz). */
export interface InputPacket {
  seq: number;
  dt: number;
  keys: number;
  yaw: number;
  pitch: number;
}

/** EntityState — per-entity snapshot data replicated every tick. */
export interface EntityState {
  id: string;
  pos: [number, number, number];
  vel: [number, number, number];
  yaw: number;
  pitch: number;
  life: number;       // 0=alive, 1=downed, 2=eliminated
  hp: number;
  sh: number;
  heroId: string;
  squadId: number;
  name: string;
  weapon: string;
  isSprint: boolean;
  isCrouch: boolean;
  onZip: boolean;
  dropping: boolean;
  tacCd: number;
  ultCd: number;
  tacActive: boolean;
  ultActive: boolean;
}

/** Ring state within a WorldSnapshot. */
export interface RingState {
  cx: number;
  cz: number;
  currentR: number;
  targetR: number;
  stage: number;
  timer: number;
  shrinking: boolean;
  dps: number;
}

/** WorldSnapshot — full game state sent at SNAPSHOT_RATE. */
export interface WorldSnapshot {
  tick: number;
  serverTime: number;
  lastAck: number;
  entities: EntityState[];
  ring: RingState;
  squadsAlive: number;
  matchState: number;  // 0=lobby, 1=drop, 2=playing, 3=ended
}

/* ─── KEY BITMASK ──────────────────────────────────────────────── */

export const KEY = {
  FORWARD:  1 << 0,  // W
  BACKWARD: 1 << 1,  // S
  LEFT:     1 << 2,  // A
  RIGHT:    1 << 3,  // D
  SPRINT:   1 << 4,  // Shift
  CROUCH:   1 << 5,  // Ctrl
  JUMP:     1 << 6,  // Space
} as const;

/* ─── ENTITY LIFECYCLE STATES ─────────────────────────────────── */

export const LIFE = { ALIVE: 0, DOWNED: 1, ELIMINATED: 2 } as const;

/* ─── MATCH STATES ────────────────────────────────────────────── */

export const MATCH = { LOBBY: 0, DROP: 1, PLAYING: 2, ENDED: 3 } as const;

/* ─── INTERACT TARGET TYPES ───────────────────────────────────── */

export const INTERACT = {
  LOOT_NODE:   'loot_node',
  LOOT_BIN:    'loot_bin',
  DOOR:        'door',
  ZIPLINE:     'zipline',
  REVIVE:      'revive',
  DEATH_BOX:   'death_box',
  RESP_BEACON: 'respawn_beacon',
} as const;

/* ─── HERO IDS (canonical list) ───────────────────────────────── */

export const HERO_IDS = ['forge', 'wraith', 'seer', 'lifeline', 'catalyst'] as const;

/* ─── KEY STATE INTERFACE ─────────────────────────────────────── */

export interface KeyState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  crouch: boolean;
  jump: boolean;
}

/* ─── SERIALIZATION HELPERS ───────────────────────────────────── */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Pack a Vec3 as a 3-element array with fixed precision */
export function packVec3(v: Vec3): [number, number, number] {
  return [
    Math.round(v.x * 100) / 100,
    Math.round(v.y * 100) / 100,
    Math.round(v.z * 100) / 100,
  ];
}

/** Unpack a 3-element array to {x,y,z} */
export function unpackVec3(a: [number, number, number]): Vec3 {
  return { x: a[0], y: a[1], z: a[2] };
}

/** Encode a key state object into a bitmask */
export function encodeKeys(keys: KeyState): number {
  let bits = 0;
  if (keys.forward)  bits |= KEY.FORWARD;
  if (keys.backward) bits |= KEY.BACKWARD;
  if (keys.left)     bits |= KEY.LEFT;
  if (keys.right)    bits |= KEY.RIGHT;
  if (keys.sprint)   bits |= KEY.SPRINT;
  if (keys.crouch)   bits |= KEY.CROUCH;
  if (keys.jump)     bits |= KEY.JUMP;
  return bits;
}

/** Decode a bitmask back to a key state object */
export function decodeKeys(bits: number): KeyState {
  return {
    forward:  !!(bits & KEY.FORWARD),
    backward: !!(bits & KEY.BACKWARD),
    left:     !!(bits & KEY.LEFT),
    right:    !!(bits & KEY.RIGHT),
    sprint:   !!(bits & KEY.SPRINT),
    crouch:   !!(bits & KEY.CROUCH),
    jump:     !!(bits & KEY.JUMP),
  };
}
