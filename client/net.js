/**
 * client/net.js
 * ═══════════════════════════════════════════════════════════════════════
 * Client-side networking module for Drop Zone multiplayer.
 *
 * Responsibilities:
 *   1. WebSocket connection lifecycle (connect, reconnect, heartbeat)
 *   2. Input packing and sending at render rate (~60Hz)
 *   3. Snapshot receiving and buffering for interpolation
 *   4. Client-side prediction for local player movement
 *   5. Server reconciliation on correction or snapshot ack
 *   6. Entity interpolation for remote players (100ms buffer)
 *
 * Usage in the game client:
 *   const net = new NetClient('ws://localhost:8080');
 *   net.connect('PlayerName');
 *   net.onSnapshot = (snapshot) => { ... };
 *   net.onEvent = (type, data) => { ... };
 *   // Each frame:
 *   net.sendInput(keys, yaw, pitch, dt, seq);
 *   const interpState = net.getInterpolatedEntity(entityId);
 * ═══════════════════════════════════════════════════════════════════════
 */

class NetClient {
  constructor(serverUrl) {
    this.url = serverUrl;
    this.ws = null;
    this.connected = false;
    this.sessionId = null;
    this.playerId = null;
    this.matchId = null;

    // ── Snapshot buffer (for interpolation) ──
    // We maintain the last N snapshots. Remote entities are rendered
    // at (currentTime - INTERP_DELAY), interpolated between the two
    // snapshots that bracket that time.
    this.snapshotBuffer = [];   // [{ serverTime, tick, entities, ring, ... }]
    this.maxSnapshots = 30;     // ~1.5 seconds at 20Hz
    this.interpDelayMs = 100;   // render remote entities 100ms behind
    this.serverTimeOffset = 0;  // estimated offset: localTime - serverTime

    // ── Client prediction state ──
    // We store every input we send. When the server acknowledges an
    // input seq via snapshot.lastAck, we discard all inputs up to that
    // seq. Remaining inputs are replayed on top of the server position
    // to produce the predicted local position.
    this.pendingInputs = [];    // [{ seq, keys, yaw, pitch, dt }]
    this.inputSeq = 0;

    // ── Callbacks ──
    this.onSnapshot = null;     // (snapshot) => {}
    this.onEvent = null;        // (type, data) => {}
    this.onMatchFound = null;   // (matchInfo) => {}
    this.onAuthOk = null;       // (sessionId, playerId) => {}
    this.onReconnected = null;  // (fullState) => {}
    this.onDisconnect = null;   // () => {}

    // ── Reconnect state ──
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 5;
    this._reconnectDelay = 1000;

    // ── Latency tracking ──
    this.rtt = 0;               // round-trip time (ms)
    this.serverTickRate = 20;
  }

  /* ═══════════════════════════════════════════════════════════════
     CONNECTION LIFECYCLE
     ═══════════════════════════════════════════════════════════════ */

  /** Connect and authenticate with a display name */
  connect(displayName) {
    this._displayName = displayName;
    this._openSocket();
  }

  _openSocket() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.connected = true;
      this._reconnectAttempts = 0;

      if (this.sessionId) {
        // Reconnect with existing session
        this._send({ type: 'c:reconnect', sessionId: this.sessionId });
      } else {
        // Fresh auth
        this._send({ type: 'c:auth', displayName: this._displayName });
      }
    };

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      this._handleMessage(msg);
    };

    this.ws.onclose = () => {
      this.connected = false;
      if (this.onDisconnect) this.onDisconnect();
      this._attemptReconnect();
    };

    this.ws.onerror = (err) => {
      console.error('[NetClient] WebSocket error:', err);
    };
  }

  _attemptReconnect() {
    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      console.warn('[NetClient] Max reconnect attempts reached');
      return;
    }
    this._reconnectAttempts++;
    const delay = this._reconnectDelay * this._reconnectAttempts;
    console.log(`[NetClient] Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts})`);
    setTimeout(() => this._openSocket(), delay);
  }

  _send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     MESSAGE HANDLING
     ═══════════════════════════════════════════════════════════════ */

  _handleMessage(msg) {
    switch (msg.type) {
      case 's:auth_ok':
        this.sessionId = msg.sessionId;
        this.playerId = msg.playerId;
        if (this.onAuthOk) this.onAuthOk(msg.sessionId, msg.playerId);
        break;

      case 's:match_found':
        this.matchId = msg.matchId;
        if (this.onMatchFound) this.onMatchFound(msg);
        break;

      case 's:reconnect_ok':
        if (this.onReconnected) this.onReconnected(msg.fullState);
        break;

      case 's:snapshot':
        this._handleSnapshot(msg);
        break;

      case 's:correction':
        this._handleCorrection(msg);
        break;

      // All game events: damage, downed, eliminated, loot, ring, etc.
      default:
        if (this.onEvent) this.onEvent(msg.type, msg);
        break;
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     SNAPSHOT PROCESSING + INTERPOLATION
     ═══════════════════════════════════════════════════════════════ */

  _handleSnapshot(snapshot) {
    // Estimate server-to-client time offset
    const now = Date.now();
    this.serverTimeOffset = now - snapshot.serverTime;

    // Buffer the snapshot for interpolation
    this.snapshotBuffer.push(snapshot);
    while (this.snapshotBuffer.length > this.maxSnapshots) {
      this.snapshotBuffer.shift();
    }

    // Discard acknowledged inputs for prediction
    this.pendingInputs = this.pendingInputs.filter(
      input => input.seq > snapshot.lastAck
    );

    // Pass to game layer
    if (this.onSnapshot) this.onSnapshot(snapshot);
  }

  /**
   * Get interpolated state for a remote entity.
   * Uses the two snapshots that bracket (now - interpDelay).
   *
   * Returns { pos, vel, yaw, pitch, life, hp, sh, ... } or null.
   */
  getInterpolatedEntity(entityId) {
    if (this.snapshotBuffer.length < 2) {
      // Not enough data — return latest if available
      const latest = this.snapshotBuffer[this.snapshotBuffer.length - 1];
      return latest?.entities.find(e => e.id === entityId) || null;
    }

    // Calculate the render time (current time minus interpolation delay)
    const renderTime = Date.now() - this.serverTimeOffset - this.interpDelayMs;

    // Find the two snapshots that bracket renderTime
    let before = null, after = null;
    for (let i = 0; i < this.snapshotBuffer.length - 1; i++) {
      if (this.snapshotBuffer[i].serverTime <= renderTime &&
          this.snapshotBuffer[i + 1].serverTime >= renderTime) {
        before = this.snapshotBuffer[i];
        after = this.snapshotBuffer[i + 1];
        break;
      }
    }

    // If renderTime is before all snapshots, use oldest
    if (!before) {
      before = this.snapshotBuffer[0];
      after = this.snapshotBuffer[1];
    }

    const entBefore = before.entities.find(e => e.id === entityId);
    const entAfter = after.entities.find(e => e.id === entityId);
    if (!entBefore || !entAfter) return entAfter || entBefore || null;

    // Interpolation factor (0 = before, 1 = after)
    const range = after.serverTime - before.serverTime;
    const t = range > 0 ? Math.max(0, Math.min(1, (renderTime - before.serverTime) / range)) : 0;

    // Lerp position and angles
    return {
      ...entAfter,  // carry non-interpolated fields from latest
      pos: [
        entBefore.pos[0] + (entAfter.pos[0] - entBefore.pos[0]) * t,
        entBefore.pos[1] + (entAfter.pos[1] - entBefore.pos[1]) * t,
        entBefore.pos[2] + (entAfter.pos[2] - entBefore.pos[2]) * t,
      ],
      yaw: this._lerpAngle(entBefore.yaw, entAfter.yaw, t),
      pitch: entBefore.pitch + (entAfter.pitch - entBefore.pitch) * t,
    };
  }

  _lerpAngle(a, b, t) {
    let diff = b - a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }

  /* ═══════════════════════════════════════════════════════════════
     CLIENT PREDICTION + SERVER RECONCILIATION
     ═══════════════════════════════════════════════════════════════ */

  /**
   * Get the predicted position for the local player.
   *
   * Strategy:
   * 1. Start from the last server-acknowledged position
   * 2. Replay all unacknowledged inputs on top of it
   * 3. Result = where the client should render the local player
   *
   * This runs every frame AFTER sendInput().
   *
   * @param {Function} simulate - (pos, vel, input, dt) => {pos, vel}
   *   The same physics function used for movement.
   *   MUST be deterministic and match the server implementation.
   */
  getPredictedPosition(lastServerPos, lastServerVel, simulate) {
    let pos = { ...lastServerPos };
    let vel = { ...lastServerVel };

    for (const input of this.pendingInputs) {
      const result = simulate(pos, vel, input, input.dt);
      pos = result.pos;
      vel = result.vel;
    }

    return { pos, vel };
  }

  /** Handle server position correction */
  _handleCorrection(msg) {
    // The server has overridden our position.
    // We could either:
    // A) Snap to the correction (jarring but simple)
    // B) Smoothly blend toward it over a few frames
    // C) Accept the correction as the new base and replay pending inputs
    //
    // Option C is the correct approach for production.
    // The game layer should call getPredictedPosition() with the
    // corrected pos/vel as the base.

    if (this.onEvent) {
      this.onEvent('s:correction', msg);
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     INPUT SENDING
     ═══════════════════════════════════════════════════════════════ */

  /**
   * Send an input packet to the server.
   * Called every client frame (~60Hz).
   *
   * @param {number} keyBits - bitmask from Protocol.encodeKeys()
   * @param {number} yaw - current look yaw
   * @param {number} pitch - current look pitch
   * @param {number} dt - frame delta time
   */
  sendInput(keyBits, yaw, pitch, dt) {
    this.inputSeq++;
    const input = {
      type: 'c:input',
      seq: this.inputSeq,
      keys: keyBits,
      yaw: Math.round(yaw * 1000) / 1000,
      pitch: Math.round(pitch * 1000) / 1000,
      dt: Math.round(dt * 10000) / 10000,
    };

    // Store for prediction replay
    this.pendingInputs.push(input);

    // Send to server
    this._send(input);

    return this.inputSeq;
  }

  /** Send a fire action */
  sendFire(dir, spread, weaponId, pellets) {
    this._send({
      type: 'c:fire',
      seq: this.inputSeq,
      dir: { x: +dir.x.toFixed(4), y: +dir.y.toFixed(4), z: +dir.z.toFixed(4) },
      spread, weaponId, pellets,
    });
  }

  /** Send an interact action */
  sendInteract(targetType, targetId) {
    this._send({ type: 'c:interact', seq: this.inputSeq, targetType, targetId });
  }

  /** Send ability use */
  sendAbility(slot) {
    this._send({ type: 'c:use_ability', seq: this.inputSeq, slot });
  }

  /** Send reload */
  sendReload(slot) {
    this._send({ type: 'c:reload', seq: this.inputSeq, weaponSlot: slot });
  }

  /** Send weapon swap */
  sendSwapWeapon(slotIndex) {
    this._send({ type: 'c:swap_weapon', seq: this.inputSeq, slotIndex });
  }

  /** Send consumable use */
  sendUseConsumable(consumableId) {
    this._send({ type: 'c:use_consumable', seq: this.inputSeq, consumableId });
  }

  /** Send map ping */
  sendPing(pingType, position) {
    this._send({ type: 'c:ping', seq: this.inputSeq, pingType, position });
  }

  /** Join the matchmaking queue */
  joinQueue(heroId) {
    this._send({ type: 'c:join_queue', heroId });
  }

  /** Leave the matchmaking queue */
  leaveQueue() {
    this._send({ type: 'c:leave_queue' });
  }

  /* ═══════════════════════════════════════════════════════════════
     DIAGNOSTICS
     ═══════════════════════════════════════════════════════════════ */

  getNetStats() {
    return {
      connected: this.connected,
      rtt: this.rtt,
      pendingInputs: this.pendingInputs.length,
      snapshotBuffer: this.snapshotBuffer.length,
      serverTimeOffset: this.serverTimeOffset,
      inputSeq: this.inputSeq,
    };
  }
}

// Export for both module and browser contexts
if (typeof module !== 'undefined') module.exports = NetClient;
else window.NetClient = NetClient;
