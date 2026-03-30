/**
 * src/net/prediction.ts
 * ═══════════════════════════════════════════════════════════════════════
 * Client-side prediction wrapper around the shared physics simulation.
 *
 * The game sends an input to the server and simultaneously applies it
 * locally via simulateMovement. Unacknowledged inputs are stored here.
 * When the server sends a corrected state (via snapshot.lastAck or a
 * correction message), predict() replays all still-pending inputs on top
 * of that authoritative base to re-derive the local player's position.
 *
 * Usage:
 *   const pred = new ClientPrediction();
 *   // each frame before sendInput():
 *   pred.addInput(seq, input, dt);
 *   // on snapshot:
 *   pred.acknowledgeUpTo(snapshot.lastAck);
 *   const predicted = pred.predict(serverState, speedMult, collision);
 *   rendered = pred.getSmoothedState(predicted, currentVisual, 0.3);
 * ═══════════════════════════════════════════════════════════════════════
 */

import {
  simulateMovement,
  type MovementState,
  type MovementInput,
  type CollisionQuery,
} from '@shared/physics';

import { encodeKeys, decodeKeys, type KeyState } from '@shared/protocol';

/* ─── EXPORTED TYPES ──────────────────────────────────────────────── */

/** A single unacknowledged input together with its timing. */
export interface PendingInput {
  /** Monotonically-increasing sequence number matching the network packet. */
  seq: number;
  /** The decoded movement input for this frame. */
  input: MovementInput;
  /** Frame delta time in seconds (capped at 0.05 by simulateMovement). */
  dt: number;
}

/* ─── CLIENT PREDICTION ───────────────────────────────────────────── */

export class ClientPrediction {
  /**
   * Ring-buffer of inputs that have been sent to the server but not yet
   * acknowledged. Oldest entries are at index 0.
   */
  pendingInputs: PendingInput[] = [];

  /**
   * The most recent authoritative state received from the server.
   * Null until the first snapshot arrives.
   */
  lastServerState: MovementState | null = null;

  /* ── INPUT MANAGEMENT ─────────────────────────────────────────── */

  /**
   * Store an input for later replay.
   * Call this immediately before (or after) sending the input packet
   * so the sequence number matches the network layer.
   *
   * @param seq   - Sequence number that was sent to the server.
   * @param input - The MovementInput applied this frame.
   * @param dt    - Frame delta time in seconds.
   */
  addInput(seq: number, input: MovementInput, dt: number): void {
    this.pendingInputs.push({ seq, input, dt });
  }

  /**
   * Discard all inputs that the server has already processed.
   * Call this whenever a snapshot with a valid `lastAck` is received.
   *
   * @param seq - The sequence number acknowledged by the server; all inputs
   *              with `seq <= seq` are removed.
   */
  acknowledgeUpTo(seq: number): void {
    this.pendingInputs = this.pendingInputs.filter((p) => p.seq > seq);
  }

  /* ── PREDICTION ───────────────────────────────────────────────── */

  /**
   * Replay all pending (unacknowledged) inputs on top of the given server
   * state to produce the authoritative predicted local position.
   *
   * This is the core reconciliation step: we accept the server's position
   * and re-simulate every input the server has not yet seen.
   *
   * @param serverState - The latest authoritative state from the server.
   * @param speedMult   - Speed multiplier forwarded to simulateMovement
   *                      (e.g. ability modifiers).
   * @param collision   - Collision query callbacks (must match server geometry).
   * @returns The predicted MovementState after replaying all pending inputs.
   */
  predict(
    serverState: MovementState,
    speedMult: number,
    collision: CollisionQuery,
  ): MovementState {
    this.lastServerState = serverState;

    let state = serverState;
    for (const pending of this.pendingInputs) {
      state = simulateMovement(state, pending.input, pending.dt, speedMult, collision);
    }
    return state;
  }

  /* ── SMOOTHING ────────────────────────────────────────────────── */

  /**
   * Linearly interpolate between the current visual state and the newly
   * predicted state to avoid jarring pops during server corrections.
   *
   * Positional components (posX/Y/Z and velX/Y/Z) are lerped; all other
   * fields (flags, timers, angles) are taken directly from `predicted`
   * so game logic stays in sync.
   *
   * @param predicted   - The output of `predict()` this frame.
   * @param current     - The state currently being rendered.
   * @param lerpFactor  - Blend weight in [0, 1]. A value of 1 snaps
   *                      immediately to predicted; 0.1–0.3 is typical for
   *                      smooth corrections.
   * @returns Smoothed MovementState to feed the renderer.
   */
  getSmoothedState(
    predicted: MovementState,
    current: MovementState,
    lerpFactor: number,
  ): MovementState {
    const t = Math.max(0, Math.min(1, lerpFactor));

    return {
      ...predicted,
      posX: current.posX + (predicted.posX - current.posX) * t,
      posY: current.posY + (predicted.posY - current.posY) * t,
      posZ: current.posZ + (predicted.posZ - current.posZ) * t,
      velX: current.velX + (predicted.velX - current.velX) * t,
      velY: current.velY + (predicted.velY - current.velY) * t,
      velZ: current.velZ + (predicted.velZ - current.velZ) * t,
    };
  }
}
