/**
 * src/net/interpolation.ts
 * ═══════════════════════════════════════════════════════════════════════
 * Entity interpolation for remote players.
 *
 * Remote entities are rendered at (now - INTERP_DELAY_MS) to guarantee
 * that two bracketing snapshots are always available.  The SnapshotBuffer
 * class manages the snapshot ring-buffer and exposes a single
 * getInterpolatedEntity() call that returns a smoothly-blended EntityState
 * ready to hand straight to the renderer.
 *
 * Usage:
 *   const buf = new SnapshotBuffer();
 *   // on each incoming snapshot:
 *   buf.push(snapshot);
 *   // each render frame, for every remote entity:
 *   const state = buf.getInterpolatedEntity(entityId);
 *   if (state) renderEntity(state);
 * ═══════════════════════════════════════════════════════════════════════
 */

import { type WorldSnapshot, type EntityState, INTERP_DELAY_MS } from '@shared/protocol';

/* ─── SNAPSHOT BUFFER ─────────────────────────────────────────────── */

export class SnapshotBuffer {
  /**
   * Ordered ring-buffer of received WorldSnapshots.
   * Oldest snapshot is at index 0; most recent at `length - 1`.
   */
  buffer: WorldSnapshot[] = [];

  /**
   * Maximum number of snapshots to retain.
   * At 20 Hz this covers ~1.5 seconds of history.
   */
  maxSize: number = 30;

  /**
   * Estimated offset between the local clock and the server clock (ms).
   * Maintained as `Date.now() - snapshot.serverTime` on each push().
   * Used so that _getRenderTime() stays accurate across clock skew.
   */
  serverTimeOffset: number = 0;

  /* ── BUFFER MANAGEMENT ─────────────────────────────────────────── */

  /**
   * Add a new snapshot to the buffer and update the server-time offset.
   * Snapshots older than `maxSize` are automatically evicted.
   *
   * @param snapshot - The WorldSnapshot received from the server.
   */
  push(snapshot: WorldSnapshot): void {
    this.serverTimeOffset = Date.now() - snapshot.serverTime;

    this.buffer.push(snapshot);
    while (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  /* ── INTERPOLATION ─────────────────────────────────────────────── */

  /**
   * Return an interpolated EntityState for the given entity at the current
   * render time (i.e. `now - INTERP_DELAY_MS`).
   *
   * The method finds the two snapshots that bracket the render time and
   * linearly interpolates position and angles between them.  All other
   * fields (hp, sh, life, flags, …) are taken from the later snapshot.
   *
   * Falls back to the most recent available snapshot when fewer than two
   * snapshots exist or when render time is before all buffered snapshots.
   *
   * @param entityId - The `EntityState.id` of the entity to look up.
   * @returns Interpolated EntityState, or null if the entity is not present
   *          in any buffered snapshot.
   */
  getInterpolatedEntity(entityId: string): EntityState | null {
    if (this.buffer.length === 0) {
      return null;
    }

    if (this.buffer.length < 2) {
      return this.getLatestEntity(entityId);
    }

    const renderTime = this._getRenderTime();

    // Find the two snapshots that bracket renderTime
    let before: WorldSnapshot | null = null;
    let after:  WorldSnapshot | null = null;

    for (let i = 0; i < this.buffer.length - 1; i++) {
      if (
        this.buffer[i].serverTime     <= renderTime &&
        this.buffer[i + 1].serverTime >= renderTime
      ) {
        before = this.buffer[i];
        after  = this.buffer[i + 1];
        break;
      }
    }

    // renderTime is before all snapshots — use the oldest pair
    if (!before || !after) {
      before = this.buffer[0];
      after  = this.buffer[1];
    }

    const entBefore = before.entities.find((e) => e.id === entityId) ?? null;
    const entAfter  = after.entities.find((e) => e.id === entityId)  ?? null;

    // Entity missing from one or both snapshots
    if (!entBefore || !entAfter) {
      return entAfter ?? entBefore ?? null;
    }

    // Interpolation factor: 0 = fully at 'before', 1 = fully at 'after'
    const range = after.serverTime - before.serverTime;
    const t = range > 0
      ? Math.max(0, Math.min(1, (renderTime - before.serverTime) / range))
      : 0;

    return {
      // Non-interpolated fields from the later snapshot
      ...entAfter,
      // Lerp position components
      pos: [
        entBefore.pos[0] + (entAfter.pos[0] - entBefore.pos[0]) * t,
        entBefore.pos[1] + (entAfter.pos[1] - entBefore.pos[1]) * t,
        entBefore.pos[2] + (entAfter.pos[2] - entBefore.pos[2]) * t,
      ],
      // Shortest-path angle interpolation for yaw and linear for pitch
      yaw:   this._lerpAngle(entBefore.yaw,   entAfter.yaw,   t),
      pitch: entBefore.pitch + (entAfter.pitch - entBefore.pitch) * t,
    };
  }

  /**
   * Return the EntityState from the most recent snapshot, without any
   * interpolation.  Useful for the local player's own entity or when
   * only a single snapshot is available.
   *
   * @param entityId - The `EntityState.id` to look up.
   * @returns The raw EntityState from the latest snapshot, or null if not
   *          found.
   */
  getLatestEntity(entityId: string): EntityState | null {
    if (this.buffer.length === 0) return null;
    const latest = this.buffer[this.buffer.length - 1];
    return latest.entities.find((e) => e.id === entityId) ?? null;
  }

  /* ── PRIVATE HELPERS ───────────────────────────────────────────── */

  /**
   * Compute the server-time point at which remote entities should be
   * rendered.  This is the current local time, adjusted by the estimated
   * clock offset and pushed back by the interpolation delay.
   *
   * @returns Render time in milliseconds (server-clock domain).
   */
  private _getRenderTime(): number {
    return Date.now() - this.serverTimeOffset - INTERP_DELAY_MS;
  }

  /**
   * Interpolate between two angles along the shortest arc.
   *
   * Wraps the angular difference into (-π, π] before blending so that
   * a character rotating from 350° to 10° moves forward (20°) rather
   * than backward (340°).
   *
   * @param a - Start angle in radians.
   * @param b - End angle in radians.
   * @param t - Blend factor in [0, 1].
   * @returns Interpolated angle in radians.
   */
  private _lerpAngle(a: number, b: number, t: number): number {
    let diff = b - a;
    while (diff >  Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }
}
