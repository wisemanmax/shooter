/**
 * server/lobbies.js — Private Lobby System
 * ═══════════════════════════════════════════════════════════════════════
 * Custom match creation with join codes, host controls, and bot backfill.
 *
 * Flow:
 *   1. Host creates a lobby → gets a 6-char join code
 *   2. Friends join via code → added to lobby roster
 *   3. Host can: set team assignments, toggle ranked rules, kick players
 *   4. Host starts match → lobby transitions to GameInstance
 *   5. Empty slots are filled with bots
 *
 * Integration:
 *   const Lobbies = require('./lobbies');
 *   Lobbies.init(sessions, gameFactory);
 *   // In WebSocket message handler:
 *   case 'c:lobby_create': Lobbies.create(session, msg); break;
 *   case 'c:lobby_join':   Lobbies.join(session, msg); break;
 *   case 'c:lobby_start':  Lobbies.start(session); break;
 * ═══════════════════════════════════════════════════════════════════════
 */

const { randomUUID } = require('crypto');

class PrivateLobby {
  constructor(hostSession, settings) {
    this.id = randomUUID().slice(0, 8);
    this.code = this._generateCode();
    this.hostId = hostSession.playerId;
    this.createdAt = Date.now();
    this.state = 'waiting';  // waiting | starting | in_game | closed

    // Settings (host-configurable)
    this.settings = {
      maxPlayers:   settings.maxPlayers || 15,
      squadSize:    settings.squadSize || 3,
      ranked:       settings.ranked || false,
      fillBots:     settings.fillBots !== false, // default true
      ringSpeed:    settings.ringSpeed || 'normal', // slow | normal | fast
      startingGear: settings.startingGear || 'none', // none | pistol | full
      heroLocking:  settings.heroLocking || 'unique_per_squad', // any | unique_per_squad | unique_global
    };

    // Roster: [{ session, heroId, squadId, ready }]
    this.roster = [];
    this.addPlayer(hostSession);
  }

  _generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  addPlayer(session, heroId = null) {
    if (this.roster.length >= this.settings.maxPlayers) return { success: false, reason: 'Lobby full' };
    if (this.state !== 'waiting') return { success: false, reason: 'Match already started' };
    if (this.roster.find(r => r.session.playerId === session.playerId)) return { success: false, reason: 'Already in lobby' };

    // Auto-assign squad
    const squadId = Math.floor(this.roster.length / this.settings.squadSize);

    this.roster.push({
      session,
      heroId: heroId || 'forge',
      squadId,
      ready: false,
      isHost: session.playerId === this.hostId,
    });

    return { success: true };
  }

  removePlayer(playerId) {
    this.roster = this.roster.filter(r => r.session.playerId !== playerId);
    // If host leaves, transfer host to next player
    if (playerId === this.hostId && this.roster.length > 0) {
      this.hostId = this.roster[0].session.playerId;
      this.roster[0].isHost = true;
    }
  }

  setHero(playerId, heroId) {
    const entry = this.roster.find(r => r.session.playerId === playerId);
    if (!entry) return false;

    // Validate hero locking rules
    if (this.settings.heroLocking === 'unique_per_squad') {
      const squadMates = this.roster.filter(r => r.squadId === entry.squadId && r.session.playerId !== playerId);
      if (squadMates.some(r => r.heroId === heroId)) return false;
    } else if (this.settings.heroLocking === 'unique_global') {
      if (this.roster.some(r => r.session.playerId !== playerId && r.heroId === heroId)) return false;
    }

    entry.heroId = heroId;
    return true;
  }

  setReady(playerId, ready) {
    const entry = this.roster.find(r => r.session.playerId === playerId);
    if (entry) entry.ready = ready;
  }

  /** Host-only: change a player's squad assignment */
  setSquad(hostId, targetId, newSquadId) {
    if (hostId !== this.hostId) return false;
    const entry = this.roster.find(r => r.session.playerId === targetId);
    if (entry) { entry.squadId = newSquadId; return true; }
    return false;
  }

  /** Host-only: kick a player */
  kick(hostId, targetId) {
    if (hostId !== this.hostId) return false;
    if (targetId === this.hostId) return false; // can't kick yourself
    this.removePlayer(targetId);
    return true;
  }

  /** Host-only: update lobby settings */
  updateSettings(hostId, newSettings) {
    if (hostId !== this.hostId) return false;
    Object.assign(this.settings, newSettings);
    return true;
  }

  /** Check if the lobby can start */
  canStart(requesterId) {
    if (requesterId !== this.hostId) return { ok: false, reason: 'Only host can start' };
    if (this.roster.length < 1) return { ok: false, reason: 'Need at least 1 player' };
    if (this.state !== 'waiting') return { ok: false, reason: 'Already started' };
    return { ok: true };
  }

  /** Prepare player entries for GameInstance creation */
  toPlayerEntries() {
    return this.roster.map(r => ({
      session: r.session,
      heroId: r.heroId,
      squadId: r.squadId,
    }));
  }

  /** Serialize for client display */
  serialize() {
    return {
      id: this.id,
      code: this.code,
      hostId: this.hostId,
      state: this.state,
      settings: this.settings,
      players: this.roster.map(r => ({
        playerId: r.session.playerId,
        name: r.session.name,
        heroId: r.heroId,
        squadId: r.squadId,
        ready: r.ready,
        isHost: r.isHost,
      })),
    };
  }
}

/**
 * Lobby Manager — handles creation, lookup, lifecycle.
 */
class LobbyManager {
  constructor() {
    this.lobbies = new Map();       // lobbyId → PrivateLobby
    this.codeIndex = new Map();     // code → lobbyId
    this.playerLobby = new Map();   // playerId → lobbyId
    this.gameFactory = null;        // (playerEntries, settings) → GameInstance
  }

  /** Set the game instance factory function */
  init(gameFactory) {
    this.gameFactory = gameFactory;
  }

  /** Create a new private lobby */
  create(session, settings = {}) {
    // Remove player from existing lobby
    this.leave(session.playerId);

    const lobby = new PrivateLobby(session, settings);
    this.lobbies.set(lobby.id, lobby);
    this.codeIndex.set(lobby.code, lobby.id);
    this.playerLobby.set(session.playerId, lobby.id);

    return lobby;
  }

  /** Join a lobby by code */
  join(session, code, heroId = null) {
    const lobbyId = this.codeIndex.get(code.toUpperCase());
    if (!lobbyId) return { success: false, reason: 'Invalid code' };

    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return { success: false, reason: 'Lobby not found' };

    // Remove from existing lobby first
    this.leave(session.playerId);

    const result = lobby.addPlayer(session, heroId);
    if (result.success) {
      this.playerLobby.set(session.playerId, lobby.id);
    }
    return { ...result, lobby: result.success ? lobby.serialize() : null };
  }

  /** Leave current lobby */
  leave(playerId) {
    const lobbyId = this.playerLobby.get(playerId);
    if (!lobbyId) return;

    const lobby = this.lobbies.get(lobbyId);
    if (lobby) {
      lobby.removePlayer(playerId);
      // Clean up empty lobbies
      if (lobby.roster.length === 0) {
        this.lobbies.delete(lobbyId);
        this.codeIndex.delete(lobby.code);
      }
    }
    this.playerLobby.delete(playerId);
  }

  /** Start the match (host only) */
  start(session) {
    const lobbyId = this.playerLobby.get(session.playerId);
    if (!lobbyId) return { success: false, reason: 'Not in a lobby' };

    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return { success: false, reason: 'Lobby not found' };

    const check = lobby.canStart(session.playerId);
    if (!check.ok) return { success: false, reason: check.reason };

    lobby.state = 'starting';

    // Create game instance
    const entries = lobby.toPlayerEntries();
    const game = this.gameFactory(entries, lobby.settings);

    lobby.state = 'in_game';

    // Broadcast match_found to all lobby players
    const matchInfo = {
      matchId: game.matchId,
      isPrivate: true,
      lobbyCode: lobby.code,
      settings: lobby.settings,
    };

    return { success: true, game, matchInfo, lobby };
  }

  /** Get a player's current lobby */
  getPlayerLobby(playerId) {
    const lobbyId = this.playerLobby.get(playerId);
    return lobbyId ? this.lobbies.get(lobbyId) : null;
  }

  /** Clean up stale lobbies (call periodically) */
  cleanup() {
    const maxAge = 30 * 60 * 1000; // 30 minutes
    const now = Date.now();
    for (const [id, lobby] of this.lobbies) {
      if (now - lobby.createdAt > maxAge && lobby.state === 'waiting') {
        for (const r of lobby.roster) this.playerLobby.delete(r.session.playerId);
        this.codeIndex.delete(lobby.code);
        this.lobbies.delete(id);
      }
    }
  }
}

// ── WebSocket message types for lobbies ──
const LOBBY_MSGS = {
  // Client → Server
  C_CREATE:     'c:lobby_create',     // { settings }
  C_JOIN:       'c:lobby_join',       // { code, heroId }
  C_LEAVE:      'c:lobby_leave',      // {}
  C_SET_HERO:   'c:lobby_hero',       // { heroId }
  C_SET_READY:  'c:lobby_ready',      // { ready }
  C_KICK:       'c:lobby_kick',       // { targetId }
  C_SETTINGS:   'c:lobby_settings',   // { settings }
  C_START:      'c:lobby_start',      // {}

  // Server → Client
  S_CREATED:    's:lobby_created',    // { lobby }
  S_JOINED:     's:lobby_joined',     // { lobby }
  S_UPDATED:    's:lobby_updated',    // { lobby }
  S_KICKED:     's:lobby_kicked',     // { reason }
  S_ERROR:      's:lobby_error',      // { reason }
};

module.exports = { LobbyManager, LOBBY_MSGS };
