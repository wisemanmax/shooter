/**
 * shared/protocol.js
 * ═══════════════════════════════════════════════════════════════════════
 * Data contracts and constants shared between server and client.
 * This is the SINGLE SOURCE OF TRUTH for all network communication.
 *
 * Import on server:  const P = require('./shared/protocol');
 * Import on client:  <script src="shared/protocol.js"> (exposes window.Protocol)
 * ═══════════════════════════════════════════════════════════════════════
 */
(function (exports) {
  'use strict';

  /* ─── SERVER CONFIGURATION ────────────────────────────────────── */
  exports.TICK_RATE       = 20;         // Server ticks per second
  exports.TICK_MS         = 1000 / 20;  // 50ms per tick
  exports.SNAPSHOT_RATE   = 20;         // Snapshots sent per second (= tick rate)
  exports.MAX_PLAYERS     = 15;         // 5 squads × 3
  exports.SQUAD_SIZE      = 3;
  exports.MAX_SQUADS      = 5;
  exports.INTERP_DELAY_MS = 100;        // Client interpolation buffer (ms)
  exports.MAX_REWIND_MS   = 300;        // Max lag compensation rewind (ms)
  exports.RECONNECT_WINDOW= 60;         // Seconds to allow reconnect
  exports.SESSION_TTL     = 3600;       // Session lifetime (seconds)

  /* ─── SHARED GAME CONSTANTS ───────────────────────────────────── */
  // Movement (must match client physics exactly)
  exports.SIM = {
    WALK_SPEED:6, SPRINT_SPEED:10.5, CROUCH_SPEED:3,
    GROUND_ACCEL:55, GROUND_FRICTION:9,
    AIR_ACCEL:12, AIR_SPEED_CAP:2.5, AIR_FRICTION:0.2,
    JUMP_FORCE:8.5, GRAVITY:23,
    PLAYER_HEIGHT:1.8, CROUCH_HEIGHT:1.0, PLAYER_RADIUS:0.35,
    STEP_HEIGHT:0.35, MAX_SPEED:25,  // absolute max for validation
    SLIDE_BOOST:1.15, SLIDE_FRICTION:2.2,
    MAP_RADIUS:95,
  };

  // Combat
  exports.COMBAT = {
    MAX_HP:100, MAX_SHIELD:100, HEADSHOT_MULT:2.0,
    SHIELD_REGEN_DELAY:5, SHIELD_REGEN_RATE:15,
    BLEED_TIME:30, REVIVE_TIME:5, REVIVE_DIST:2.5,
  };

  // Hit validation tolerances
  exports.VALIDATION = {
    POS_TOLERANCE:   2.0,   // Max allowed position deviation per tick (units)
    SPEED_TOLERANCE: 1.3,   // Speed can exceed max by this factor (latency grace)
    SHOT_ANGLE_TOL:  5.0,   // Max angle deviation for shot validation (degrees)
    DAMAGE_WINDOW:   0.5,   // Seconds of tolerance for damage timing
    LOOT_DIST:       4.0,   // Max loot pickup distance (with tolerance)
    ABILITY_DIST:    50.0,  // Max ability effect distance
  };

  /* ─── MESSAGE TYPES ───────────────────────────────────────────── */
  /**
   * Every WebSocket message is a JSON object with shape:
   * { type: string, seq?: number, ...payload }
   *
   * 'seq' is a monotonic sequence number used for input acknowledgement
   * and snapshot ordering. The client tags every input message with its
   * local seq. The server echoes it back in snapshots so the client
   * knows which inputs have been processed.
   */

  // ── Client → Server ──────────────────────────────────────────
  exports.C2S = {
    // Session / lobby
    AUTH:           'c:auth',          // { token, displayName }
    JOIN_QUEUE:     'c:join_queue',    // { heroId }
    LEAVE_QUEUE:    'c:leave_queue',   // {}
    RECONNECT:      'c:reconnect',     // { sessionId }

    // Gameplay input (sent every client frame, ~60Hz)
    INPUT:          'c:input',         // InputPacket (see schema below)

    // Actions (sent on event, not per-frame)
    FIRE:           'c:fire',          // { seq, dir:{x,y,z}, spread, weaponId, pellets }
    RELOAD:         'c:reload',        // { seq, weaponSlot }
    SWAP_WEAPON:    'c:swap_weapon',   // { seq, slotIndex }
    USE_CONSUMABLE: 'c:use_consumable',// { seq, consumableId }
    INTERACT:       'c:interact',      // { seq, targetType, targetId }
    USE_ABILITY:    'c:use_ability',   // { seq, slot:'tactical'|'ultimate' }
    DOOR_TOGGLE:    'c:door_toggle',   // { seq, doorId }

    // Social / ping
    PING_MAP:       'c:ping',         // { seq, type, position:{x,y,z} }
  };

  // ── Server → Client ──────────────────────────────────────────
  exports.S2C = {
    // Session / lobby
    AUTH_OK:        's:auth_ok',       // { sessionId, playerId }
    AUTH_FAIL:      's:auth_fail',     // { reason }
    QUEUE_STATUS:   's:queue_status',  // { position, estimatedWait }
    MATCH_FOUND:    's:match_found',   // { matchId, squad, allPlayers }
    RECONNECT_OK:   's:reconnect_ok',  // { fullState }
    RECONNECT_FAIL: 's:reconnect_fail',// { reason }

    // Game state (sent at SNAPSHOT_RATE Hz)
    SNAPSHOT:       's:snapshot',       // WorldSnapshot (see schema below)

    // Events (sent immediately on occurrence)
    ENTITY_DAMAGED: 's:entity_damaged',// { entityId, damage, attackerId, isHead, shieldDmg, healthDmg, shieldBroken }
    ENTITY_DOWNED:  's:entity_downed', // { entityId }
    ENTITY_ELIMINATED:'s:entity_eliminated', // { entityId, killerId }
    ENTITY_REVIVED: 's:entity_revived',// { entityId }
    LOOT_SPAWNED:   's:loot_spawned',  // { lootId, position, items }
    LOOT_COLLECTED: 's:loot_collected',// { lootId, collectorId }
    DOOR_TOGGLED:   's:door_toggled',  // { doorId, open }
    RING_UPDATE:    's:ring_update',   // { stage, centerX, centerZ, currentRadius, targetRadius, timer, shrinking }
    ABILITY_EVENT:  's:ability_event', // { entityId, abilityId, slot, data }
    PING_EVENT:     's:ping_event',    // { playerId, type, position }
    KILL_FEED:      's:kill_feed',     // { victimId, victimName, killerId, killerName }
    SQUAD_WIPE:     's:squad_wipe',    // { squadId }
    MATCH_END:      's:match_end',     // { winnerSquadId }
    SERVER_CORRECTION:'s:correction',  // { entityId, position, velocity, seq }
  };

  /* ─── DATA SCHEMAS ────────────────────────────────────────────── */

  /**
   * InputPacket — sent by client every frame (~60Hz).
   * The server buffers these and processes them at TICK_RATE.
   * {
   *   seq:      number,   // monotonic input sequence number
   *   dt:       number,   // client delta time for this input
   *   keys:     number,   // bitmask of pressed keys (see KEY_BITS)
   *   yaw:      number,   // current look yaw (radians)
   *   pitch:    number,   // current look pitch (radians)
   * }
   */

  // Key bitmask encoding — compact and deterministic
  exports.KEY = {
    FORWARD:  1 << 0,  // W
    BACKWARD: 1 << 1,  // S
    LEFT:     1 << 2,  // A
    RIGHT:    1 << 3,  // D
    SPRINT:   1 << 4,  // Shift
    CROUCH:   1 << 5,  // Ctrl
    JUMP:     1 << 6,  // Space
  };

  /**
   * EntityState — per-entity snapshot data replicated every tick.
   * {
   *   id:       string,   // unique entity ID
   *   pos:      [x,y,z],  // position (3 floats)
   *   vel:      [x,y,z],  // velocity (3 floats)
   *   yaw:      number,   // look direction
   *   pitch:    number,
   *   life:     number,   // 0=alive, 1=downed, 2=eliminated
   *   hp:       number,   // current health (0-100)
   *   sh:       number,   // current shield (0-100)
   *   heroId:   string,   // hero class id
   *   squadId:  number,   // squad index
   *   name:     string,   // display name
   *   weapon:   string,   // active weapon id (for viewmodel)
   *   isSprint: boolean,
   *   isCrouch: boolean,
   *   onZip:    boolean,
   *   dropping: boolean,
   *   tacCd:    number,   // tactical cooldown remaining
   *   ultCd:    number,   // ultimate cooldown remaining
   *   tacActive:boolean,
   *   ultActive:boolean,
   * }
   */

  /**
   * WorldSnapshot — full game state sent at SNAPSHOT_RATE.
   * {
   *   tick:       number,      // server tick number
   *   serverTime: number,      // server timestamp (ms)
   *   lastAck:    number,      // last processed client input seq for this player
   *   entities:   EntityState[],
   *   ring:       { cx, cz, currentR, targetR, stage, timer, shrinking, dps },
   *   squadsAlive:number,
   *   matchState: number,      // 0=lobby, 1=drop, 2=playing, 3=ended
   * }
   *
   * BANDWIDTH NOTE: Full snapshots at 20Hz for 15 entities ≈ 8-12 KB/s.
   * For scaling to 60 players, switch to delta compression:
   * only send fields that changed since the last acknowledged snapshot.
   */

  /* ─── ENTITY LIFECYCLE STATES ─────────────────────────────────── */
  exports.LIFE = { ALIVE: 0, DOWNED: 1, ELIMINATED: 2 };

  /* ─── MATCH STATES ────────────────────────────────────────────── */
  exports.MATCH = { LOBBY: 0, DROP: 1, PLAYING: 2, ENDED: 3 };

  /* ─── INTERACT TARGET TYPES ───────────────────────────────────── */
  exports.INTERACT = {
    LOOT_NODE:  'loot_node',
    LOOT_BIN:   'loot_bin',
    DOOR:       'door',
    ZIPLINE:    'zipline',
    REVIVE:     'revive',
    DEATH_BOX:  'death_box',
    RESP_BEACON:'respawn_beacon',
  };

  /* ─── HERO IDS (canonical list) ───────────────────────────────── */
  exports.HERO_IDS = ['forge','wraith','seer','lifeline','catalyst'];

  /* ─── SERIALIZATION HELPERS ───────────────────────────────────── */

  /** Pack a Vec3 as a 3-element array with fixed precision */
  exports.packVec3 = (v) => [
    Math.round(v.x * 100) / 100,
    Math.round(v.y * 100) / 100,
    Math.round(v.z * 100) / 100,
  ];

  /** Unpack a 3-element array to {x,y,z} */
  exports.unpackVec3 = (a) => ({ x: a[0], y: a[1], z: a[2] });

  /** Encode a key state object into a bitmask */
  exports.encodeKeys = (keys) => {
    let bits = 0;
    if (keys.forward)  bits |= exports.KEY.FORWARD;
    if (keys.backward) bits |= exports.KEY.BACKWARD;
    if (keys.left)     bits |= exports.KEY.LEFT;
    if (keys.right)    bits |= exports.KEY.RIGHT;
    if (keys.sprint)   bits |= exports.KEY.SPRINT;
    if (keys.crouch)   bits |= exports.KEY.CROUCH;
    if (keys.jump)     bits |= exports.KEY.JUMP;
    return bits;
  };

  /** Decode a bitmask back to a key state object */
  exports.decodeKeys = (bits) => ({
    forward:  !!(bits & exports.KEY.FORWARD),
    backward: !!(bits & exports.KEY.BACKWARD),
    left:     !!(bits & exports.KEY.LEFT),
    right:    !!(bits & exports.KEY.RIGHT),
    sprint:   !!(bits & exports.KEY.SPRINT),
    crouch:   !!(bits & exports.KEY.CROUCH),
    jump:     !!(bits & exports.KEY.JUMP),
  });

})(typeof module !== 'undefined' ? module.exports : (window.Protocol = {}));
