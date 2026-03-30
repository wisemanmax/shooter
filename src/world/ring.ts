/**
 * Ring / zone system — shrinking play area with damage.
 * Extracted from v6-heroes.html line 515 (Ring class) and line 141 (C.RING config).
 *
 * All stage values and shrink/lerp logic match the v6 minified source exactly.
 */

import * as THREE from 'three';

/* ═══════════════════════════════════════════════════════════════
   Minimal entity interface — avoids circular dependency with
   the full Entity class.
   ═══════════════════════════════════════════════════════════════ */

/**
 * The minimal shape the Ring requires from an entity in order to
 * apply out-of-ring damage.  The full Entity class must satisfy this.
 */
export interface RingDamageable {
  /** World position */
  pos: THREE.Vector3;
  /** Life state — 0 = alive, 1 = downed, 2 = eliminated (mirrors v6 Life.A) */
  life: number;
  /** Whether the entity is currently in the drop phase */
  dropping: boolean;
  /**
   * Apply raw damage to this entity.
   * @param amount - Damage amount
   * @param attacker - Attacking entity (null for environmental)
   * @param isHeadshot - Whether the hit was a headshot
   */
  takeDmg(amount: number, attacker: null, isHeadshot: boolean): void;
}

/* ═══════════════════════════════════════════════════════════════
   Ring Stage Config
   ═══════════════════════════════════════════════════════════════ */

/** Configuration for a single ring stage */
export interface RingStage {
  /** Wait time in seconds before the ring starts moving */
  delay: number;
  /** Duration in seconds for the ring to finish shrinking */
  shrink: number;
  /** Fraction of mapRadius the ring shrinks to (e.g. 0.7 = 70 %) */
  endR: number;
  /** Damage per second applied to players outside the ring */
  dps: number;
}

/**
 * All ring stages — matches `C.RING` from v6 exactly (line 141).
 * Each stage: wait `delay` seconds, then shrink to `endR * mapRadius` over
 * `shrink` seconds, dealing `dps` damage per second to anyone outside.
 */
export const RING_STAGES: RingStage[] = [
  { delay: 45, shrink: 30, endR: 0.70, dps:  1 },
  { delay: 30, shrink: 25, endR: 0.45, dps:  3 },
  { delay: 20, shrink: 20, endR: 0.22, dps:  8 },
  { delay: 15, shrink: 15, endR: 0.05, dps: 15 },
];

/* ═══════════════════════════════════════════════════════════════
   Ring Class
   ═══════════════════════════════════════════════════════════════ */

/**
 * Manages the shrinking battle-ring cycle and its THREE.js visual mesh.
 *
 * Usage:
 * ```ts
 * const ring = new Ring(scene, 95);
 * ring.start();          // call once at match start
 * // each frame:
 * ring.tick(dt);
 * ring.applyDamage(player, dt);
 * hud.setText(ring.getText());
 * ```
 *
 * Translated from v6 `Ring` class (line 515). All numeric constants and
 * interpolation logic match the minified source exactly.
 */
export class Ring {
  /** Current stage index (-1 = not yet started) */
  stage: number;

  /** Current ring centre X */
  cx: number;
  /** Current ring centre Z */
  cz: number;

  /** Current ring radius */
  currentR: number;
  /** Target ring radius for the active shrink */
  targetR: number;

  /** Countdown timer — counts down to 0 to trigger next phase */
  timer: number;

  /** Whether the ring is currently shrinking */
  shrinking: boolean;

  /** Active damage-per-second value */
  dps: number;

  /** True once all stages are complete */
  done: boolean;

  /** The THREE.js cylinder mesh used to render the ring wall */
  visual: THREE.Mesh;

  // ── Interpolation snapshots (captured at shrink start) ──────────────────
  private _shrinkStartR: number;
  private _shrinkStartCx: number;
  private _shrinkStartCz: number;

  // ── Next centre position (chosen when the stage is set up) ──────────────
  private nextCx: number;
  private nextCz: number;

  private readonly mapRadius: number;

  /**
   * @param scene - THREE.js scene to add the ring visual to
   * @param mapRadius - Outer boundary radius of the map (v6 C.MAP_R = 95)
   */
  constructor(scene: THREE.Scene, mapRadius: number) {
    this.mapRadius = mapRadius;

    this.stage = -1;
    this.cx = 0;
    this.cz = 0;
    this.currentR = mapRadius;
    this.targetR = mapRadius;
    this.nextCx = 0;
    this.nextCz = 0;
    this.timer = 0;
    this.shrinking = false;
    this.dps = 0;
    this.done = false;

    this._shrinkStartR = mapRadius;
    this._shrinkStartCx = 0;
    this._shrinkStartCz = 0;

    // Cylinder wall: height 40, radius driven by scale.x/z each tick
    this.visual = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 40, 48, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xff4422,
        transparent: true,
        opacity: 0.08,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.visual.position.y = 20;
    scene.add(this.visual);
  }

  /**
   * Reset and start the ring sequence from stage 0.
   * Call once when the match begins.
   */
  start(): void {
    this.stage = -1;
    this.currentR = this.mapRadius;
    this.cx = 0;
    this.cz = 0;
    this.advance();
  }

  /**
   * Advance to the next ring stage.
   * Sets up the delay timer and picks the next centre position.
   * Matches v6 `Ring.adv()` exactly.
   */
  advance(): void {
    this.stage++;

    if (this.stage >= RING_STAGES.length) {
      this.done = true;
      this.dps = RING_STAGES[RING_STAGES.length - 1].dps;
      return;
    }

    const s = RING_STAGES[this.stage];
    this.timer = s.delay;
    this.shrinking = false;
    this.targetR = this.mapRadius * s.endR;
    this.dps = s.dps;

    // Pick a new centre slightly offset from current centre
    const offset = this.currentR * 0.2;
    this.nextCx = this.cx + (Math.random() - 0.5) * offset;
    this.nextCz = this.cz + (Math.random() - 0.5) * offset;
  }

  /**
   * Advance ring state by `dt` seconds.
   * Handles delay countdown, shrink interpolation, and mesh updates.
   * Matches v6 `Ring.tick(dt)` exactly.
   * @param dt - Delta time in seconds
   */
  tick(dt: number): void {
    if (this.done) return;

    this.timer -= dt;

    // Transition from delay phase to shrink phase
    if (!this.shrinking && this.timer <= 0) {
      this.shrinking = true;
      this.timer = RING_STAGES[this.stage].shrink;
      this._shrinkStartR = this.currentR;
      this._shrinkStartCx = this.cx;
      this._shrinkStartCz = this.cz;
    }

    if (this.shrinking) {
      if (this.timer <= 0) {
        // Shrink complete — snap to target and move to next stage
        this.currentR = this.targetR;
        this.cx = this.nextCx;
        this.cz = this.nextCz;
        this.shrinking = false;
        this.advance();
      } else {
        // Lerp towards target
        const t = 1 - this.timer / RING_STAGES[this.stage].shrink;
        this.currentR = THREE.MathUtils.lerp(this._shrinkStartR, this.targetR, t);
        this.cx = THREE.MathUtils.lerp(this._shrinkStartCx, this.nextCx, t);
        this.cz = THREE.MathUtils.lerp(this._shrinkStartCz, this.nextCz, t);
      }
    }

    // Update visual mesh
    this.visual.scale.set(this.currentR, 1, this.currentR);
    this.visual.position.x = this.cx;
    this.visual.position.z = this.cz;
  }

  /**
   * Check whether a world position is outside the current ring.
   * @param pos - Position to test
   * @returns true if the position is outside the ring boundary
   */
  isOutside(pos: THREE.Vector3): boolean {
    const dx = pos.x - this.cx;
    const dz = pos.z - this.cz;
    return Math.sqrt(dx * dx + dz * dz) > this.currentR;
  }

  /**
   * Apply ring damage to an entity if it is outside the ring.
   * Only damages entities that are alive and not in the drop phase.
   * Matches v6 `Ring.dmg(e, dt)` exactly.
   * @param entity - The entity to potentially damage
   * @param dt - Delta time in seconds
   */
  applyDamage(entity: RingDamageable, dt: number): void {
    if (this.isOutside(entity.pos) && entity.life === 0 && !entity.dropping) {
      entity.takeDmg(this.dps * dt, null, false);
    }
  }

  /**
   * Return a HUD-ready status string describing the ring's current phase.
   * Matches v6 `Ring.txt()` exactly.
   * @returns Status string, e.g. "Ring 2 in 18s", "Ring closing 12s", "Final ring"
   */
  getText(): string {
    if (this.done) return 'Final ring';
    if (this.shrinking) return `Ring closing ${Math.ceil(this.timer)}s`;
    return `Ring ${this.stage + 2} in ${Math.ceil(this.timer)}s`;
  }
}
