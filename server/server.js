/**
 * server/server.js
 * ═══════════════════════════════════════════════════════════════════════
 * Authoritative game server for Drop Zone battle royale.
 *
 * Run: node server/server.js
 * Requires: npm install ws uuid
 *
 * Architecture:
 *   SessionManager  — player identity, auth, reconnect tokens
 *   Matchmaker      — queue management, squad formation, lobby fill
 *   GameInstance     — one match: world state, tick loop, validation
 *   LagCompensator  — snapshot history ring buffer for hit rewind
 *   Validator        — server-side checks for movement, damage, loot
 *
 * All game logic runs server-side. Clients are INPUT devices and
 * RENDER devices only. The server never trusts the client about
 * positions, damage, or state transitions.
 * ═══════════════════════════════════════════════════════════════════════
 */

const { WebSocketServer } = require('ws');
const { randomUUID } = require('crypto');
const P = require('../shared/protocol');

const PORT = process.env.PORT || 8080;

/* ═══════════════════════════════════════════════════════════════════════
   SESSION MANAGER
   Player identity persists across connections. Survives disconnects
   within RECONNECT_WINDOW seconds. Session = authenticated identity.
   ═══════════════════════════════════════════════════════════════════════ */
class SessionManager {
  constructor() {
    this.sessions = new Map();   // sessionId → { playerId, name, ws, matchId, lastSeen, heroId }
    this.playerToSession = new Map(); // playerId → sessionId
  }

  /** Create a new session for an authenticated player */
  create(ws, displayName) {
    const sessionId = randomUUID();
    const playerId = randomUUID().slice(0, 8);
    const session = {
      sessionId, playerId, name: displayName || `Player-${playerId.slice(0,4)}`,
      ws, matchId: null, lastSeen: Date.now(), heroId: null,
      connected: true,
    };
    this.sessions.set(sessionId, session);
    this.playerToSession.set(playerId, sessionId);
    return session;
  }

  /** Reconnect: rebind a WebSocket to an existing session */
  reconnect(ws, sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (Date.now() - session.lastSeen > P.RECONNECT_WINDOW * 1000) {
      this.sessions.delete(sessionId);
      this.playerToSession.delete(session.playerId);
      return null;
    }
    session.ws = ws;
    session.connected = true;
    session.lastSeen = Date.now();
    return session;
  }

  /** Mark session as disconnected (start reconnect timer) */
  disconnect(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.connected = false;
      session.lastSeen = Date.now();
      session.ws = null;
    }
  }

  /** Get session by playerId */
  getByPlayer(playerId) {
    const sid = this.playerToSession.get(playerId);
    return sid ? this.sessions.get(sid) : null;
  }

  /** Clean expired sessions */
  cleanup() {
    const now = Date.now();
    for (const [sid, s] of this.sessions) {
      if (!s.connected && now - s.lastSeen > P.SESSION_TTL * 1000) {
        this.sessions.delete(sid);
        this.playerToSession.delete(s.playerId);
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   MATCHMAKER
   Queue players, form squads, create GameInstances when full.
   ═══════════════════════════════════════════════════════════════════════ */
class Matchmaker {
  constructor(sessions, onMatchReady) {
    this.sessions = sessions;
    this.queue = [];          // [{ session, heroId }]
    this.onMatchReady = onMatchReady;
  }

  /** Add player to queue */
  enqueue(session, heroId) {
    if (this.queue.find(q => q.session.playerId === session.playerId)) return;
    session.heroId = heroId;
    this.queue.push({ session, heroId });
    this._tryForm();
  }

  /** Remove player from queue */
  dequeue(session) {
    this.queue = this.queue.filter(q => q.session.playerId !== session.playerId);
  }

  /** Attempt to form a match */
  _tryForm() {
    if (this.queue.length < P.MAX_PLAYERS) {
      // In development: fill remaining slots with bots
      // For now, start match when we have at least one player (fill rest with bots)
      if (this.queue.length >= 1) {
        const players = this.queue.splice(0, Math.min(this.queue.length, P.MAX_PLAYERS));
        this.onMatchReady(players);
      }
      return;
    }
    const players = this.queue.splice(0, P.MAX_PLAYERS);
    this.onMatchReady(players);
  }

  /** Send queue status to all waiting players */
  broadcastStatus() {
    for (let i = 0; i < this.queue.length; i++) {
      const q = this.queue[i];
      if (q.session.ws) {
        send(q.session.ws, { type: P.S2C.QUEUE_STATUS, position: i + 1, estimatedWait: 5 });
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   LAG COMPENSATOR
   Stores a ring buffer of world snapshots for hit validation rewind.
   When a client claims a hit at time T, we rewind entity positions
   to where they were at T and validate the shot geometry.
   ═══════════════════════════════════════════════════════════════════════ */
class LagCompensator {
  constructor(maxHistoryMs = P.MAX_REWIND_MS) {
    this.history = [];        // [{ tick, time, positions: Map<entityId, {x,y,z}> }]
    this.maxHistory = Math.ceil(maxHistoryMs / P.TICK_MS) + 2;
  }

  /** Store current positions as a snapshot */
  store(tick, serverTime, entities) {
    const positions = new Map();
    for (const e of entities) {
      positions.set(e.id, { x: e.pos.x, y: e.pos.y, z: e.pos.z });
    }
    this.history.push({ tick, time: serverTime, positions });
    while (this.history.length > this.maxHistory) this.history.shift();
  }

  /** Get entity positions at a past time (for hit validation) */
  getPositionsAt(targetTime) {
    if (this.history.length === 0) return null;
    // Find the two snapshots bracketing the target time
    let before = this.history[0], after = this.history[0];
    for (const snap of this.history) {
      if (snap.time <= targetTime) before = snap;
      else { after = snap; break; }
    }
    // If target is older than our history, clamp to oldest
    if (targetTime < this.history[0].time) return this.history[0].positions;
    // Interpolate between before and after
    if (before === after) return before.positions;
    const t = (targetTime - before.time) / (after.time - before.time);
    const result = new Map();
    for (const [id, posB] of before.positions) {
      const posA = after.positions.get(id);
      if (!posA) { result.set(id, posB); continue; }
      result.set(id, {
        x: posB.x + (posA.x - posB.x) * t,
        y: posB.y + (posA.y - posB.y) * t,
        z: posB.z + (posA.z - posB.z) * t,
      });
    }
    return result;
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   VALIDATOR
   Server-side validation for all client-claimed actions.
   Returns true if the action is legal, false to reject.
   ═══════════════════════════════════════════════════════════════════════ */
const Validator = {
  /** Validate that a movement input produces a legal position */
  movement(entity, newPos, dt) {
    const maxMove = P.SIM.MAX_SPEED * P.VALIDATION.SPEED_TOLERANCE * dt;
    const dx = newPos.x - entity.pos.x;
    const dy = newPos.y - entity.pos.y;
    const dz = newPos.z - entity.pos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > maxMove + P.VALIDATION.POS_TOLERANCE) return false;
    // Bounds check
    if (Math.abs(newPos.x) > P.SIM.MAP_RADIUS + 1) return false;
    if (Math.abs(newPos.z) > P.SIM.MAP_RADIUS + 1) return false;
    if (newPos.y > P.SIM.MAP_RADIUS || newPos.y < -20) return false;
    return true;
  },

  /** Validate a fire action — check weapon state, ammo, cooldown */
  fire(entity, weaponId, serverTime) {
    const w = entity.activeWeapon;
    if (!w || w.id !== weaponId) return false;
    if (w.ammo <= 0 || w.reloading) return false;
    if (w.fireCooldown > 0) return false;
    return true;
  },

  /** Validate hit registration using lag-compensated positions */
  hit(shooterPos, shooterDir, targetId, claimTime, lagComp, entities) {
    const positions = lagComp.getPositionsAt(claimTime);
    if (!positions) return false;
    const targetPos = positions.get(targetId);
    if (!targetPos) return false;
    // Check if the shot direction vector passes near the target
    const toTarget = {
      x: targetPos.x - shooterPos.x,
      y: targetPos.y - shooterPos.y,
      z: targetPos.z - shooterPos.z,
    };
    const dist = Math.sqrt(toTarget.x ** 2 + toTarget.y ** 2 + toTarget.z ** 2);
    if (dist <= 0 || dist > 200) return false;
    // Dot product check: is the target roughly in the direction we fired?
    const dot = (shooterDir.x * toTarget.x + shooterDir.y * toTarget.y + shooterDir.z * toTarget.z) / dist;
    // Allow generous angle tolerance for latency
    const angleTol = Math.cos(P.VALIDATION.SHOT_ANGLE_TOL * Math.PI / 180);
    return dot >= angleTol;
  },

  /** Validate loot pickup — check proximity and loot exists */
  loot(entity, lootNode) {
    if (!lootNode || !lootNode.active) return false;
    const dist = Math.sqrt(
      (entity.pos.x - lootNode.pos.x) ** 2 +
      (entity.pos.z - lootNode.pos.z) ** 2
    );
    return dist <= P.VALIDATION.LOOT_DIST;
  },

  /** Validate ability use — check cooldown, alive state */
  ability(entity, slot) {
    if (entity.life !== P.LIFE.ALIVE) return false;
    const cd = slot === 'tactical' ? entity.tacCd : entity.ultCd;
    return cd <= 0;
  },
};

/* ═══════════════════════════════════════════════════════════════════════
   SERVER ENTITY
   Authoritative representation of a player or bot in a match.
   All game state lives here. Clients receive serialized snapshots.
   ═══════════════════════════════════════════════════════════════════════ */
class ServerEntity {
  constructor(id, name, squadId, heroId, isBot = false) {
    this.id = id;
    this.name = name;
    this.squadId = squadId;
    this.heroId = heroId;
    this.isBot = isBot;
    this.life = P.LIFE.ALIVE;
    this.pos = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.pitch = 0;
    this.hp = P.COMBAT.MAX_HP;
    this.sh = 0;
    this.isSprint = false;
    this.isCrouch = false;
    this.dropping = true;
    this.dropY = P.SIM.MAP_RADIUS;
    this.onZip = false;
    this.lastDamageTime = -999;
    this.lastAttacker = null;
    this.bleedTimer = 0;
    this.beingRevived = false;
    this.reviveProgress = 0;
    // Weapons (simplified for server)
    this.weapons = [null, null];
    this.activeSlot = 0;
    this.activeWeapon = null;
    // Abilities
    this.tacCd = 0;
    this.ultCd = 0;
    this.tacActive = false;
    this.ultActive = false;
    this.tacTimer = 0;
    this.ultTimer = 0;
    // Input buffer
    this.inputBuffer = [];
    this.lastProcessedSeq = 0;
    // Session link
    this.sessionId = null;
  }

  /** Serialize to EntityState for network transmission */
  serialize() {
    return {
      id: this.id,
      pos: P.packVec3(this.pos),
      vel: P.packVec3(this.vel),
      yaw: Math.round(this.yaw * 1000) / 1000,
      pitch: Math.round(this.pitch * 1000) / 1000,
      life: this.life,
      hp: Math.round(this.hp),
      sh: Math.round(this.sh),
      heroId: this.heroId,
      squadId: this.squadId,
      name: this.name,
      weapon: this.activeWeapon?.id || null,
      isSprint: this.isSprint,
      isCrouch: this.isCrouch,
      onZip: this.onZip,
      dropping: this.dropping,
      tacCd: Math.round(this.tacCd * 10) / 10,
      ultCd: Math.round(this.ultCd * 10) / 10,
      tacActive: this.tacActive,
      ultActive: this.ultActive,
    };
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   GAME INSTANCE
   One running match. Owns all entities, world state, ring, loot.
   Runs the authoritative tick loop at TICK_RATE Hz.
   ═══════════════════════════════════════════════════════════════════════ */
class GameInstance {
  constructor(matchId, playerEntries, sessions) {
    this.matchId = matchId;
    this.sessions = sessions;
    this.tick = 0;
    this.startTime = Date.now();
    this.matchState = P.MATCH.DROP;
    this.entities = new Map();    // entityId → ServerEntity
    this.lagComp = new LagCompensator();
    this.squadsAlive = P.MAX_SQUADS;

    // Ring state
    this.ring = {
      stage: 0, cx: 0, cz: 0,
      currentR: P.SIM.MAP_RADIUS, targetR: P.SIM.MAP_RADIUS * 0.7,
      timer: 45, shrinking: false, dps: 1,
    };

    // Loot nodes (server-authoritative)
    this.lootNodes = new Map();
    this._generateLoot();

    // Create entities for players
    let squadIdx = 0, memberIdx = 0;
    for (const entry of playerEntries) {
      const ent = new ServerEntity(
        entry.session.playerId,
        entry.session.name,
        squadIdx,
        entry.heroId
      );
      ent.sessionId = entry.session.sessionId;
      entry.session.matchId = matchId;
      this.entities.set(ent.id, ent);
      memberIdx++;
      if (memberIdx >= P.SQUAD_SIZE) { squadIdx++; memberIdx = 0; }
    }

    // Fill remaining slots with bots
    const botNames = ['Alpha','Bravo','Charlie','Delta','Echo','Foxtrot','Golf',
      'Hotel','India','Juliet','Kilo','Lima','Mike','November','Oscar'];
    let botIdx = playerEntries.length;
    while (this.entities.size < P.MAX_PLAYERS) {
      if (memberIdx >= P.SQUAD_SIZE) { squadIdx++; memberIdx = 0; }
      const heroId = P.HERO_IDS[botIdx % P.HERO_IDS.length];
      const bot = new ServerEntity(
        `bot-${botIdx}`,
        botNames[botIdx % botNames.length],
        squadIdx, heroId, true
      );
      this.entities.set(bot.id, bot);
      botIdx++;
      memberIdx++;
    }

    // Assign spawn positions
    this._assignSpawns();

    // Start tick loop
    this._interval = setInterval(() => this._tick(), P.TICK_MS);

    console.log(`[GameInstance ${matchId}] Started with ${playerEntries.length} players, ${this.entities.size - playerEntries.length} bots`);
  }

  _generateLoot() {
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 10 + Math.random() * 72;
      this.lootNodes.set(`loot-${i}`, {
        id: `loot-${i}`,
        pos: { x: Math.cos(a) * d, y: 0, z: Math.sin(a) * d },
        active: true,
        items: this._randomLootItems(),
      });
    }
  }

  _randomLootItems() {
    const items = [];
    const count = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const r = Math.random();
      if (r < 0.3) items.push({ type: 'weapon', weaponId: ['ar','smg','sg','mk','ps','lmg'][Math.floor(Math.random()*6)], rarity: 'common' });
      else if (r < 0.65) items.push({ type: 'ammo', ammoType: ['light','heavy','energy','shells'][Math.floor(Math.random()*4)], amount: 40 });
      else items.push({ type: 'consumable', id: ['syringe','cell','medkit','battery'][Math.floor(Math.random()*4)], amount: 1 });
    }
    return items;
  }

  _assignSpawns() {
    const angles = [0, Math.PI * 0.4, Math.PI * 0.8, Math.PI * 1.2, Math.PI * 1.6];
    const squads = new Map();
    for (const e of this.entities.values()) {
      if (!squads.has(e.squadId)) squads.set(e.squadId, []);
      squads.get(e.squadId).push(e);
    }
    let si = 0;
    for (const [, members] of squads) {
      const angle = angles[si % 5];
      const dist = 40 + Math.random() * 30;
      const bx = Math.cos(angle) * dist;
      const bz = Math.sin(angle) * dist;
      for (let i = 0; i < members.length; i++) {
        members[i].pos = { x: bx + (i - 1) * 3, y: 60, z: bz };
        members[i].dropping = true;
        members[i].dropY = 60;
      }
      si++;
    }
  }

  /* ── AUTHORITATIVE TICK ────────────────────────────────────────── */
  _tick() {
    this.tick++;
    const dt = P.TICK_MS / 1000;
    const now = Date.now();

    // ── Process player inputs ──
    for (const ent of this.entities.values()) {
      if (ent.isBot) continue;
      this._processInputs(ent, dt);
    }

    // ── Tick bots ──
    for (const ent of this.entities.values()) {
      if (!ent.isBot) continue;
      this._tickBot(ent, dt);
    }

    // ── Drop phase ──
    for (const ent of this.entities.values()) {
      if (!ent.dropping) continue;
      ent.dropY -= 18 * dt;
      ent.pos.y = ent.dropY;
      if (ent.dropY <= 1) {
        ent.dropping = false;
        ent.pos.y = 0;
        // Auto-equip starter weapon
        ent.weapons[0] = { id: 'ps', ammo: 14, reloading: false, fireCooldown: 0 };
        ent.activeWeapon = ent.weapons[0];
      }
    }

    // ── Ring tick ──
    if (this.matchState === P.MATCH.PLAYING) {
      this._tickRing(dt);
    }

    // ── Shield regen ──
    for (const ent of this.entities.values()) {
      if (ent.life !== P.LIFE.ALIVE) continue;
      const elapsed = (now / 1000) - ent.lastDamageTime;
      if (elapsed >= P.COMBAT.SHIELD_REGEN_DELAY && ent.sh < P.COMBAT.MAX_SHIELD) {
        ent.sh = Math.min(ent.sh + P.COMBAT.SHIELD_REGEN_RATE * dt, P.COMBAT.MAX_SHIELD);
      }
    }

    // ── Downed bleed-out ──
    for (const ent of this.entities.values()) {
      if (ent.life !== P.LIFE.DOWNED) continue;
      ent.bleedTimer -= dt;
      if (ent.beingRevived) {
        ent.reviveProgress += dt / P.COMBAT.REVIVE_TIME;
        if (ent.reviveProgress >= 1) this._reviveEntity(ent);
      }
      if (ent.bleedTimer <= 0) this._eliminateEntity(ent);
    }

    // ── Ability cooldown ticks ──
    for (const ent of this.entities.values()) {
      ent.tacCd = Math.max(0, ent.tacCd - dt);
      ent.ultCd = Math.max(0, ent.ultCd - dt);
      if (ent.tacActive) { ent.tacTimer -= dt; if (ent.tacTimer <= 0) ent.tacActive = false; }
      if (ent.ultActive) { ent.ultTimer -= dt; if (ent.ultTimer <= 0) ent.ultActive = false; }
    }

    // ── Match state transitions ──
    if (this.matchState === P.MATCH.DROP) {
      const allLanded = [...this.entities.values()].every(e => !e.dropping);
      if (allLanded) this.matchState = P.MATCH.PLAYING;
    }
    if (this.matchState === P.MATCH.PLAYING) {
      this._checkSquadWipes();
    }

    // ── Store snapshot for lag compensation ──
    this.lagComp.store(this.tick, now, [...this.entities.values()]);

    // ── Broadcast snapshot to all connected players ──
    this._broadcastSnapshots(now);
  }

  /** Process buffered inputs for a player entity */
  _processInputs(ent, dt) {
    if (ent.life !== P.LIFE.ALIVE || ent.dropping) {
      ent.inputBuffer = [];
      return;
    }

    // Process all buffered inputs
    for (const input of ent.inputBuffer) {
      const keys = P.decodeKeys(input.keys);
      ent.yaw = input.yaw;
      ent.pitch = input.pitch;
      ent.isSprint = keys.sprint;
      ent.isCrouch = keys.crouch;

      // Server-side movement simulation (simplified — matches client physics)
      const fwd = { x: -Math.sin(ent.yaw), z: -Math.cos(ent.yaw) };
      const rgt = { x: -Math.cos(ent.yaw), z: Math.sin(ent.yaw) };
      let wx = 0, wz = 0;
      if (keys.forward)  { wx += fwd.x; wz += fwd.z; }
      if (keys.backward) { wx -= fwd.x; wz -= fwd.z; }
      if (keys.right)    { wx += rgt.x; wz += rgt.z; }
      if (keys.left)     { wx -= rgt.x; wz -= rgt.z; }
      const wLen = Math.sqrt(wx * wx + wz * wz);
      if (wLen > 0) { wx /= wLen; wz /= wLen; }

      const maxSpd = keys.sprint ? P.SIM.SPRINT_SPEED : P.SIM.WALK_SPEED;
      const accel = P.SIM.GROUND_ACCEL;
      const inputDt = Math.min(input.dt || dt, 0.05);

      // Quake-style acceleration
      const curSpd = ent.vel.x * wx + ent.vel.z * wz;
      let addSpd = maxSpd - curSpd;
      if (addSpd > 0) {
        let accelSpd = accel * inputDt * maxSpd;
        if (accelSpd > addSpd) accelSpd = addSpd;
        ent.vel.x += accelSpd * wx;
        ent.vel.z += accelSpd * wz;
      }

      // Friction
      const spd = Math.sqrt(ent.vel.x ** 2 + ent.vel.z ** 2);
      if (spd > 0.1) {
        const drop = spd * P.SIM.GROUND_FRICTION * inputDt;
        const factor = Math.max(spd - drop, 0) / spd;
        ent.vel.x *= factor;
        ent.vel.z *= factor;
      } else {
        ent.vel.x = 0;
        ent.vel.z = 0;
      }

      // Gravity
      ent.vel.y -= P.SIM.GRAVITY * inputDt;

      // Jump (simplified ground check)
      if (keys.jump && ent.pos.y <= 0.1) {
        ent.vel.y = P.SIM.JUMP_FORCE;
      }

      // Apply velocity
      const newPos = {
        x: ent.pos.x + ent.vel.x * inputDt,
        y: ent.pos.y + ent.vel.y * inputDt,
        z: ent.pos.z + ent.vel.z * inputDt,
      };

      // Server-side validation
      if (Validator.movement(ent, newPos, inputDt)) {
        ent.pos = newPos;
      } else {
        // Reject — send correction
        this._sendCorrection(ent, input.seq);
      }

      // Ground clamp (simplified — full collision would use server-side spatial hash)
      if (ent.pos.y < 0) { ent.pos.y = 0; ent.vel.y = 0; }

      // Bounds
      ent.pos.x = Math.max(-P.SIM.MAP_RADIUS, Math.min(P.SIM.MAP_RADIUS, ent.pos.x));
      ent.pos.z = Math.max(-P.SIM.MAP_RADIUS, Math.min(P.SIM.MAP_RADIUS, ent.pos.z));

      ent.lastProcessedSeq = input.seq;
    }
    ent.inputBuffer = [];
  }

  /** Minimal bot AI for match pacing */
  _tickBot(ent, dt) {
    if (ent.life !== P.LIFE.ALIVE || ent.dropping) return;
    // Wander + gravity (same as v5-v6 bot but server-authoritative)
    if (!ent._patrolTarget || Math.random() < 0.005) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * this.ring.currentR * 0.6;
      ent._patrolTarget = { x: this.ring.cx + Math.cos(a) * d, z: this.ring.cz + Math.sin(a) * d };
    }
    const tx = ent._patrolTarget.x - ent.pos.x;
    const tz = ent._patrolTarget.z - ent.pos.z;
    const td = Math.sqrt(tx * tx + tz * tz);
    if (td > 2) {
      ent.yaw = Math.atan2(-tx, -tz);
      const fd = { x: -Math.sin(ent.yaw), z: -Math.cos(ent.yaw) };
      ent.vel.x += (fd.x * P.SIM.WALK_SPEED - ent.vel.x) * Math.min(dt * 8, 1);
      ent.vel.z += (fd.z * P.SIM.WALK_SPEED - ent.vel.z) * Math.min(dt * 8, 1);
    }
    ent.vel.y -= P.SIM.GRAVITY * dt;
    ent.pos.x += ent.vel.x * dt;
    ent.pos.y += ent.vel.y * dt;
    ent.pos.z += ent.vel.z * dt;
    if (ent.pos.y < 0) { ent.pos.y = 0; ent.vel.y = 0; }
    ent.pos.x = Math.max(-P.SIM.MAP_RADIUS, Math.min(P.SIM.MAP_RADIUS, ent.pos.x));
    ent.pos.z = Math.max(-P.SIM.MAP_RADIUS, Math.min(P.SIM.MAP_RADIUS, ent.pos.z));

    // Ring damage
    const distFromRing = Math.sqrt((ent.pos.x - this.ring.cx) ** 2 + (ent.pos.z - this.ring.cz) ** 2);
    if (distFromRing > this.ring.currentR) {
      this._damageEntity(ent, this.ring.dps * dt, null, false);
    }
  }

  _tickRing(dt) {
    // Simplified ring logic (same stages as client)
    this.ring.timer -= dt;
    if (!this.ring.shrinking && this.ring.timer <= 0) {
      this.ring.shrinking = true;
      this.ring.timer = 25; // shrink duration
      this.ring._startR = this.ring.currentR;
    }
    if (this.ring.shrinking) {
      if (this.ring.timer <= 0) {
        this.ring.currentR = this.ring.targetR;
        this.ring.shrinking = false;
        this.ring.stage++;
        // Advance to next ring stage...
        this.ring.timer = 30;
        this.ring.targetR = Math.max(this.ring.currentR * 0.6, 5);
        this.ring.dps = Math.min(this.ring.dps + 2, 15);
      } else {
        const t = 1 - this.ring.timer / 25;
        this.ring.currentR = this.ring._startR + (this.ring.targetR - this.ring._startR) * t;
      }
    }
    // Apply ring damage to all entities
    for (const ent of this.entities.values()) {
      if (ent.life !== P.LIFE.ALIVE || ent.dropping) continue;
      const dist = Math.sqrt((ent.pos.x - this.ring.cx) ** 2 + (ent.pos.z - this.ring.cz) ** 2);
      if (dist > this.ring.currentR) {
        this._damageEntity(ent, this.ring.dps * dt, null, false);
      }
    }
  }

  /* ── COMBAT RESOLUTION (server-authoritative) ────────────────── */

  /** Process a fire action from a player */
  handleFire(session, msg) {
    const ent = this.entities.get(session.playerId);
    if (!ent || ent.life !== P.LIFE.ALIVE) return;
    if (!Validator.fire(ent, msg.weaponId, Date.now())) return;

    // Deduct ammo server-side
    ent.activeWeapon.ammo--;
    ent.activeWeapon.fireCooldown = 0.1; // will tick down

    // Lag-compensated hit detection
    const shooterPos = { ...ent.pos };
    const shooterDir = msg.dir;
    const claimTime = Date.now() - (session._latency || 50);

    // Check all enemies for hits
    for (const target of this.entities.values()) {
      if (target.id === ent.id || target.squadId === ent.squadId) continue;
      if (target.life !== P.LIFE.ALIVE) continue;

      if (Validator.hit(shooterPos, shooterDir, target.id, claimTime, this.lagComp, this.entities)) {
        const isHead = Math.random() < 0.15; // simplified headshot check
        const baseDmg = isHead ? (ent.activeWeapon.dmg?.h || 36) : (ent.activeWeapon.dmg?.b || 18);
        this._damageEntity(target, baseDmg, ent, isHead);
        break; // first hit only per shot
      }
    }
  }

  /** Apply damage to an entity (server-authoritative) */
  _damageEntity(target, amount, attacker, isHead) {
    if (target.life !== P.LIFE.ALIVE) return;
    let sd = 0, hd = 0, sb = false;
    if (target.sh > 0) {
      sd = Math.min(amount, target.sh);
      target.sh -= sd;
      if (target.sh <= 0) sb = true;
    }
    const rem = amount - sd;
    if (rem > 0) {
      hd = Math.min(rem, target.hp);
      target.hp -= hd;
    }
    target.lastDamageTime = Date.now() / 1000;
    target.lastAttacker = attacker;

    // Broadcast damage event
    this._broadcastEvent(P.S2C.ENTITY_DAMAGED, {
      entityId: target.id,
      attackerId: attacker?.id || null,
      damage: amount, isHead, shieldDmg: sd, healthDmg: hd, shieldBroken: sb,
    });

    if (target.hp <= 0) {
      target.life = P.LIFE.DOWNED;
      target.bleedTimer = P.COMBAT.BLEED_TIME;
      target.vel = { x: 0, y: 0, z: 0 };
      this._broadcastEvent(P.S2C.ENTITY_DOWNED, { entityId: target.id });
    }
  }

  _reviveEntity(ent) {
    ent.life = P.LIFE.ALIVE;
    ent.hp = 30;
    ent.sh = 0;
    ent.beingRevived = false;
    ent.reviveProgress = 0;
    this._broadcastEvent(P.S2C.ENTITY_REVIVED, { entityId: ent.id });
  }

  _eliminateEntity(ent) {
    ent.life = P.LIFE.ELIMINATED;
    this._broadcastEvent(P.S2C.ENTITY_ELIMINATED, {
      entityId: ent.id,
      killerId: ent.lastAttacker?.id || null,
    });
    this._broadcastEvent(P.S2C.KILL_FEED, {
      victimId: ent.id, victimName: ent.name,
      killerId: ent.lastAttacker?.id || null,
      killerName: ent.lastAttacker?.name || 'Ring',
    });
  }

  _checkSquadWipes() {
    const squads = new Map();
    for (const e of this.entities.values()) {
      if (!squads.has(e.squadId)) squads.set(e.squadId, []);
      squads.get(e.squadId).push(e);
    }
    let alive = 0;
    let lastAlive = -1;
    for (const [sid, members] of squads) {
      if (members.some(e => e.life !== P.LIFE.ELIMINATED)) {
        alive++;
        lastAlive = sid;
      }
    }
    this.squadsAlive = alive;
    if (alive <= 1 && this.matchState === P.MATCH.PLAYING) {
      this.matchState = P.MATCH.ENDED;
      this._broadcastEvent(P.S2C.MATCH_END, { winnerSquadId: lastAlive });
      // Clean up after delay
      setTimeout(() => this.shutdown(), 10000);
    }
  }

  /* ── ACTION HANDLERS ──────────────────────────────────────────── */

  handleInteract(session, msg) {
    const ent = this.entities.get(session.playerId);
    if (!ent || ent.life !== P.LIFE.ALIVE) return;

    switch (msg.targetType) {
      case P.INTERACT.LOOT_NODE: {
        const loot = this.lootNodes.get(msg.targetId);
        if (!Validator.loot(ent, loot)) return;
        loot.active = false;
        this._broadcastEvent(P.S2C.LOOT_COLLECTED, {
          lootId: loot.id, collectorId: ent.id, items: loot.items,
        });
        break;
      }
      case P.INTERACT.REVIVE: {
        const target = this.entities.get(msg.targetId);
        if (!target || target.life !== P.LIFE.DOWNED) return;
        if (target.squadId !== ent.squadId) return;
        const dist = Math.sqrt((ent.pos.x - target.pos.x) ** 2 + (ent.pos.z - target.pos.z) ** 2);
        if (dist > P.COMBAT.REVIVE_DIST) return;
        target.beingRevived = true;
        break;
      }
    }
  }

  handleAbility(session, msg) {
    const ent = this.entities.get(session.playerId);
    if (!ent || !Validator.ability(ent, msg.slot)) return;

    // Set cooldown (server authoritative)
    if (msg.slot === 'tactical') {
      ent.tacCd = 16; // hero-specific; would look up from HEROES config
      ent.tacActive = true;
      ent.tacTimer = 6;
    } else {
      ent.ultCd = 120;
      ent.ultActive = true;
      ent.ultTimer = 10;
    }

    this._broadcastEvent(P.S2C.ABILITY_EVENT, {
      entityId: ent.id,
      abilityId: msg.slot,
      heroId: ent.heroId,
      data: {}, // ability-specific payload
    });
  }

  /* ── SNAPSHOT BROADCAST ───────────────────────────────────────── */

  _broadcastSnapshots(now) {
    const entities = [...this.entities.values()].map(e => e.serialize());

    for (const ent of this.entities.values()) {
      if (ent.isBot) continue;
      const session = this.sessions.getByPlayer(ent.id);
      if (!session?.connected || !session.ws) continue;

      const snapshot = {
        type: P.S2C.SNAPSHOT,
        tick: this.tick,
        serverTime: now,
        lastAck: ent.lastProcessedSeq,
        entities,
        ring: { ...this.ring },
        squadsAlive: this.squadsAlive,
        matchState: this.matchState,
      };

      send(session.ws, snapshot);
    }
  }

  _broadcastEvent(type, data) {
    for (const ent of this.entities.values()) {
      if (ent.isBot) continue;
      const session = this.sessions.getByPlayer(ent.id);
      if (session?.connected && session.ws) {
        send(session.ws, { type, ...data });
      }
    }
  }

  _sendCorrection(ent, seq) {
    const session = this.sessions.getByPlayer(ent.id);
    if (!session?.ws) return;
    send(session.ws, {
      type: P.S2C.SERVER_CORRECTION,
      entityId: ent.id,
      position: P.packVec3(ent.pos),
      velocity: P.packVec3(ent.vel),
      seq,
    });
  }

  /** Handle incoming message for this match */
  handleMessage(session, msg) {
    const ent = this.entities.get(session.playerId);
    if (!ent) return;

    switch (msg.type) {
      case P.C2S.INPUT:
        ent.inputBuffer.push(msg);
        break;
      case P.C2S.FIRE:
        this.handleFire(session, msg);
        break;
      case P.C2S.INTERACT:
        this.handleInteract(session, msg);
        break;
      case P.C2S.USE_ABILITY:
        this.handleAbility(session, msg);
        break;
      case P.C2S.RELOAD:
        if (ent.activeWeapon) {
          ent.activeWeapon.reloading = true;
          // Server would track reload timer and complete it
        }
        break;
      case P.C2S.SWAP_WEAPON:
        if (msg.slotIndex >= 0 && msg.slotIndex < 2 && ent.weapons[msg.slotIndex]) {
          ent.activeSlot = msg.slotIndex;
          ent.activeWeapon = ent.weapons[msg.slotIndex];
        }
        break;
      case P.C2S.PING_MAP:
        this._broadcastEvent(P.S2C.PING_EVENT, {
          playerId: ent.id, type: msg.pingType, position: msg.position,
        });
        break;
    }
  }

  /** Get full state for reconnecting player */
  getFullState(playerId) {
    return {
      matchId: this.matchId,
      tick: this.tick,
      matchState: this.matchState,
      entities: [...this.entities.values()].map(e => e.serialize()),
      ring: { ...this.ring },
      squadsAlive: this.squadsAlive,
      lootNodes: [...this.lootNodes.values()].filter(l => l.active).map(l => ({
        id: l.id, pos: l.pos, items: l.items,
      })),
    };
  }

  shutdown() {
    clearInterval(this._interval);
    console.log(`[GameInstance ${this.matchId}] Shutdown`);
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN SERVER — WebSocket listener, message routing
   ═══════════════════════════════════════════════════════════════════════ */

function send(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

const sessions = new SessionManager();
const games = new Map();  // matchId → GameInstance

const matchmaker = new Matchmaker(sessions, (players) => {
  const matchId = randomUUID().slice(0, 8);
  const game = new GameInstance(matchId, players, sessions);
  games.set(matchId, game);

  // Notify all players
  for (const p of players) {
    send(p.session.ws, {
      type: P.S2C.MATCH_FOUND,
      matchId,
      squad: game.entities.get(p.session.playerId)?.squadId,
      allPlayers: [...game.entities.values()].map(e => ({
        id: e.id, name: e.name, squadId: e.squadId, heroId: e.heroId, isBot: e.isBot,
      })),
    });
  }
});

const wss = new WebSocketServer({ port: PORT });
console.log(`[Server] Listening on ws://localhost:${PORT}`);

wss.on('connection', (ws) => {
  let session = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      // ── Auth ──
      case P.C2S.AUTH:
        session = sessions.create(ws, msg.displayName);
        send(ws, { type: P.S2C.AUTH_OK, sessionId: session.sessionId, playerId: session.playerId });
        break;

      // ── Reconnect ──
      case P.C2S.RECONNECT: {
        const s = sessions.reconnect(ws, msg.sessionId);
        if (s) {
          session = s;
          const game = games.get(s.matchId);
          if (game) {
            send(ws, { type: P.S2C.RECONNECT_OK, fullState: game.getFullState(s.playerId) });
          } else {
            send(ws, { type: P.S2C.RECONNECT_OK, fullState: null });
          }
        } else {
          send(ws, { type: P.S2C.RECONNECT_FAIL, reason: 'Session expired' });
        }
        break;
      }

      // ── Queue ──
      case P.C2S.JOIN_QUEUE:
        if (!session) return;
        matchmaker.enqueue(session, msg.heroId || 'forge');
        break;

      case P.C2S.LEAVE_QUEUE:
        if (!session) return;
        matchmaker.dequeue(session);
        break;

      // ── Game messages ──
      default:
        if (!session?.matchId) return;
        const game = games.get(session.matchId);
        if (game) game.handleMessage(session, msg);
        break;
    }
  });

  ws.on('close', () => {
    if (session) {
      sessions.disconnect(session.sessionId);
      console.log(`[Session] Disconnected: ${session.name} (${session.playerId})`);
    }
  });

  // Latency measurement (simple ping/pong)
  ws._latencyInterval = setInterval(() => {
    if (ws.readyState === 1) {
      ws._pingSent = Date.now();
      ws.ping();
    }
  }, 2000);

  ws.on('pong', () => {
    if (session && ws._pingSent) {
      session._latency = Date.now() - ws._pingSent;
    }
  });

  ws.on('close', () => clearInterval(ws._latencyInterval));
});

// Periodic cleanup
setInterval(() => sessions.cleanup(), 60000);
