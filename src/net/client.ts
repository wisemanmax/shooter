/**
 * src/net/client.ts
 * ═══════════════════════════════════════════════════════════════════════
 * Client-side networking module for Drop Zone multiplayer.
 * TypeScript conversion of client/net.js.
 *
 * Responsibilities:
 *   1. WebSocket connection lifecycle (connect, reconnect, heartbeat)
 *   2. Input packing and sending at render rate (~60Hz)
 *   3. Snapshot receiving and buffering for interpolation
 *   4. Client-side prediction for local player movement
 *   5. Server reconciliation on correction or snapshot ack
 *   6. Entity interpolation for remote players (100ms buffer)
 *
 * Usage:
 *   const net = new NetClient('ws://localhost:8080');
 *   net.connect('PlayerName');
 *   net.onSnapshot = (snapshot) => { ... };
 *   net.onEvent = (type, data) => { ... };
 *   // Each frame:
 *   net.sendInput(keys, yaw, pitch, dt);
 * ═══════════════════════════════════════════════════════════════════════
 */

import {
  C2S,
  S2C,
  type WorldSnapshot,
  type InputPacket,
  type EntityState,
  type KeyState,
  INTERP_DELAY_MS,
  encodeKeys,
} from '@shared/protocol';

/* ─── INTERNAL TYPES ──────────────────────────────────────────────── */

/** Shape stored in pendingInputs for prediction replay. */
interface PendingInput extends InputPacket {
  seq: number;
}

/** Vec3-like object used for fire direction. */
interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Map ping position (XZ or full XYZ depending on context). */
interface PingPosition {
  x: number;
  y?: number;
  z: number;
}

/** Return value of getNetStats(). */
export interface NetStats {
  connected: boolean;
  rtt: number;
  pendingInputs: number;
  snapshotBuffer: number;
  serverTimeOffset: number;
  inputSeq: number;
}

/** Simulate function signature expected by getPredictedPosition(). */
export type SimulateFn = (
  pos: { x: number; y: number; z: number },
  vel: { x: number; y: number; z: number },
  input: PendingInput,
  dt: number,
) => {
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
};

/* ─── NET CLIENT ──────────────────────────────────────────────────── */

export class NetClient {
  // ── Connection ──
  readonly url: string;
  ws: WebSocket | null = null;
  connected: boolean = false;
  sessionId: string | null = null;
  playerId: string | null = null;
  matchId: string | null = null;

  // ── Snapshot buffer ──
  /** Ordered list of received WorldSnapshots; used for interpolation. */
  snapshotBuffer: WorldSnapshot[] = [];
  /** Maximum number of snapshots to retain (~1.5s at 20 Hz). */
  maxSnapshots: number = 30;
  /**
   * Estimated offset between local clock and server clock (ms).
   * Computed as `Date.now() - snapshot.serverTime` on each snapshot.
   */
  serverTimeOffset: number = 0;

  // ── Client prediction ──
  /** Unacknowledged inputs waiting for server ack. */
  pendingInputs: PendingInput[] = [];
  /** Monotonically-increasing sequence number for input packets. */
  inputSeq: number = 0;

  // ── Callbacks ──
  /** Called with each incoming WorldSnapshot. */
  onSnapshot: ((snapshot: WorldSnapshot) => void) | null = null;
  /** Called for any message type not explicitly handled (game events). */
  onEvent: ((type: string, data: Record<string, unknown>) => void) | null = null;
  /** Called when the server confirms a match was found. */
  onMatchFound: ((matchInfo: Record<string, unknown>) => void) | null = null;
  /** Called when initial auth succeeds. */
  onAuthOk: ((sessionId: string, playerId: string) => void) | null = null;
  /** Called when a reconnect handshake completes. */
  onReconnected: ((fullState: unknown) => void) | null = null;
  /** Called when the WebSocket closes (before any reconnect attempt). */
  onDisconnect: (() => void) | null = null;

  // ── Reconnect ──
  private _displayName: string = '';
  private _reconnectAttempts: number = 0;
  private readonly _maxReconnectAttempts: number = 5;
  private readonly _reconnectDelay: number = 1000;

  // ── Diagnostics ──
  /** Latest round-trip time in milliseconds. */
  rtt: number = 0;
  readonly serverTickRate: number = 20;

  constructor(serverUrl: string) {
    this.url = serverUrl;
  }

  /* ═══════════════════════════════════════════════════════════════
     CONNECTION LIFECYCLE
     ═══════════════════════════════════════════════════════════════ */

  /**
   * Open a WebSocket connection and authenticate with the given display name.
   * If a session already exists the client will attempt a seamless reconnect.
   *
   * @param displayName - The player's visible name sent to the server on auth.
   */
  connect(displayName: string): void {
    this._displayName = displayName;
    this._openSocket();
  }

  /** @internal Open (or re-open) the underlying WebSocket. */
  private _openSocket(): void {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.connected = true;
      this._reconnectAttempts = 0;

      if (this.sessionId) {
        // Resume an existing session
        this._send({ type: C2S.RECONNECT, sessionId: this.sessionId });
      } else {
        // Fresh authentication
        this._send({ type: C2S.AUTH, displayName: this._displayName });
      }
    };

    this.ws.onmessage = (event: MessageEvent<string>) => {
      const msg = JSON.parse(event.data) as Record<string, unknown>;
      this._handleMessage(msg);
    };

    this.ws.onclose = () => {
      this.connected = false;
      if (this.onDisconnect) this.onDisconnect();
      this._attemptReconnect();
    };

    this.ws.onerror = (err: Event) => {
      console.error('[NetClient] WebSocket error:', err);
    };
  }

  /** @internal Exponential-backoff reconnection loop. */
  private _attemptReconnect(): void {
    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      console.warn('[NetClient] Max reconnect attempts reached');
      return;
    }
    this._reconnectAttempts++;
    const delay = this._reconnectDelay * this._reconnectAttempts;
    console.log(
      `[NetClient] Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts})`,
    );
    setTimeout(() => this._openSocket(), delay);
  }

  /** @internal Serialize and transmit a message if the socket is open. */
  private _send(data: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     MESSAGE HANDLING
     ═══════════════════════════════════════════════════════════════ */

  /** @internal Route an incoming server message to the appropriate handler. */
  private _handleMessage(msg: Record<string, unknown>): void {
    switch (msg.type as string) {
      case S2C.AUTH_OK:
        this.sessionId = msg.sessionId as string;
        this.playerId  = msg.playerId as string;
        if (this.onAuthOk) this.onAuthOk(this.sessionId, this.playerId);
        break;

      case S2C.MATCH_FOUND:
        this.matchId = msg.matchId as string;
        if (this.onMatchFound) this.onMatchFound(msg);
        break;

      case S2C.RECONNECT_OK:
        if (this.onReconnected) this.onReconnected(msg.fullState);
        break;

      case S2C.SNAPSHOT:
        this._handleSnapshot(msg as unknown as WorldSnapshot);
        break;

      case S2C.SERVER_CORRECTION:
        this._handleCorrection(msg);
        break;

      // All other game events (damage, downed, eliminated, loot, ring, …)
      default:
        if (this.onEvent) this.onEvent(msg.type as string, msg);
        break;
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     SNAPSHOT PROCESSING
     ═══════════════════════════════════════════════════════════════ */

  /** @internal Buffer a snapshot and advance prediction reconciliation. */
  private _handleSnapshot(snapshot: WorldSnapshot): void {
    // Keep server-time offset up to date
    this.serverTimeOffset = Date.now() - snapshot.serverTime;

    // Buffer snapshot for interpolation
    this.snapshotBuffer.push(snapshot);
    while (this.snapshotBuffer.length > this.maxSnapshots) {
      this.snapshotBuffer.shift();
    }

    // Discard inputs the server has already processed
    this.pendingInputs = this.pendingInputs.filter(
      (input) => input.seq > snapshot.lastAck,
    );

    if (this.onSnapshot) this.onSnapshot(snapshot);
  }

  /* ═══════════════════════════════════════════════════════════════
     CLIENT PREDICTION + SERVER RECONCILIATION
     ═══════════════════════════════════════════════════════════════ */

  /**
   * Compute the predicted position for the local player.
   *
   * Strategy:
   *   1. Start from the last server-acknowledged position.
   *   2. Replay all unacknowledged inputs on top of it.
   *   3. The result is where the client should render the local player.
   *
   * Call this every frame after `sendInput()`.
   *
   * @param lastServerPos - Server-authoritative position (x, y, z object).
   * @param lastServerVel - Server-authoritative velocity (x, y, z object).
   * @param simulate      - Deterministic physics function that MUST match the
   *                        server implementation exactly.
   * @returns Predicted `{ pos, vel }` after replaying pending inputs.
   */
  getPredictedPosition(
    lastServerPos: { x: number; y: number; z: number },
    lastServerVel: { x: number; y: number; z: number },
    simulate: SimulateFn,
  ): {
    pos: { x: number; y: number; z: number };
    vel: { x: number; y: number; z: number };
  } {
    let pos = { ...lastServerPos };
    let vel = { ...lastServerVel };

    for (const input of this.pendingInputs) {
      const result = simulate(pos, vel, input, input.dt);
      pos = result.pos;
      vel = result.vel;
    }

    return { pos, vel };
  }

  /** @internal Broadcast a server correction to the game layer. */
  private _handleCorrection(msg: Record<string, unknown>): void {
    // The server has overridden our position.
    // The game layer should call getPredictedPosition() with the corrected
    // pos/vel as the base to replay remaining pending inputs from there.
    if (this.onEvent) {
      this.onEvent(S2C.SERVER_CORRECTION, msg);
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     INPUT SENDING
     ═══════════════════════════════════════════════════════════════ */

  /**
   * Pack and send a movement input packet to the server.
   * Called every client frame (~60 Hz).
   * The packet is also stored locally for client-side prediction replay.
   *
   * @param keyBits - Bitmask produced by `encodeKeys()`.
   * @param yaw     - Current look yaw in radians.
   * @param pitch   - Current look pitch in radians.
   * @param dt      - Frame delta time in seconds.
   * @returns The sequence number assigned to this input.
   */
  sendInput(keyBits: number, yaw: number, pitch: number, dt: number): number {
    this.inputSeq++;
    const input: PendingInput = {
      seq:   this.inputSeq,
      keys:  keyBits,
      yaw:   Math.round(yaw   * 1000) / 1000,
      pitch: Math.round(pitch * 1000) / 1000,
      dt:    Math.round(dt    * 10000) / 10000,
    };

    // Store for prediction replay
    this.pendingInputs.push(input);

    // Transmit
    this._send({ type: C2S.INPUT, ...input });

    return this.inputSeq;
  }

  /**
   * Send a fire action to the server.
   *
   * @param dir      - Normalised direction vector.
   * @param spread   - Spread radius applied by the weapon.
   * @param weaponId - Canonical weapon identifier string.
   * @param pellets  - Number of projectiles (1 for single-fire weapons).
   */
  sendFire(dir: Vec3Like, spread: number, weaponId: string, pellets: number): void {
    this._send({
      type: C2S.FIRE,
      seq: this.inputSeq,
      dir: {
        x: +dir.x.toFixed(4),
        y: +dir.y.toFixed(4),
        z: +dir.z.toFixed(4),
      },
      spread,
      weaponId,
      pellets,
    });
  }

  /**
   * Send an interact action.
   *
   * @param targetType - One of the `INTERACT` constants from protocol.
   * @param targetId   - ID of the interactable entity or node.
   */
  sendInteract(targetType: string, targetId: string): void {
    this._send({ type: C2S.INTERACT, seq: this.inputSeq, targetType, targetId });
  }

  /**
   * Send a hero ability activation.
   *
   * @param slot - Ability slot index (e.g. 0 = tactical, 1 = ultimate).
   */
  sendAbility(slot: number): void {
    this._send({ type: C2S.USE_ABILITY, seq: this.inputSeq, slot });
  }

  /**
   * Send a reload request for a weapon slot.
   *
   * @param slot - Weapon slot index to reload.
   */
  sendReload(slot: number): void {
    this._send({ type: C2S.RELOAD, seq: this.inputSeq, weaponSlot: slot });
  }

  /**
   * Send a weapon-swap request.
   *
   * @param slotIndex - Target weapon slot to swap to.
   */
  sendSwapWeapon(slotIndex: number): void {
    this._send({ type: C2S.SWAP_WEAPON, seq: this.inputSeq, slotIndex });
  }

  /**
   * Send a consumable use request.
   *
   * @param consumableId - Identifier of the consumable item to use.
   */
  sendUseConsumable(consumableId: string): void {
    this._send({ type: C2S.USE_CONSUMABLE, seq: this.inputSeq, consumableId });
  }

  /**
   * Send a map ping.
   *
   * @param pingType - Ping category (e.g. 'go', 'enemy', 'loot').
   * @param position - World-space position of the ping.
   */
  sendPing(pingType: string, position: PingPosition): void {
    this._send({ type: C2S.PING_MAP, seq: this.inputSeq, pingType, position });
  }

  /**
   * Join the matchmaking queue.
   *
   * @param heroId - The hero the player intends to play.
   */
  joinQueue(heroId: string): void {
    this._send({ type: C2S.JOIN_QUEUE, heroId });
  }

  /** Leave the matchmaking queue. */
  leaveQueue(): void {
    this._send({ type: C2S.LEAVE_QUEUE });
  }

  /* ═══════════════════════════════════════════════════════════════
     DIAGNOSTICS
     ═══════════════════════════════════════════════════════════════ */

  /**
   * Return a snapshot of current network statistics.
   *
   * @returns Object containing connection status, RTT, buffer depths, and
   *          the current input sequence number.
   */
  getNetStats(): NetStats {
    return {
      connected:        this.connected,
      rtt:              this.rtt,
      pendingInputs:    this.pendingInputs.length,
      snapshotBuffer:   this.snapshotBuffer.length,
      serverTimeOffset: this.serverTimeOffset,
      inputSeq:         this.inputSeq,
    };
  }
}
