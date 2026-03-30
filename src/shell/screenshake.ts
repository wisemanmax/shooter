/**
 * src/shell/screenshake.ts
 * Camera shake system using layered noise-based offsets.
 * Produces organic shake that decays over time.
 */

import * as THREE from 'three';

/* ─── Shake instance ──────────────────────────────────────────── */

interface ShakeInstance {
  intensity: number;
  decay: number;
  frequency: number;
  /** Elapsed time for this shake */
  t: number;
}

/* ─── Screen Shake Manager ────────────────────────────────────── */

export class ScreenShake {
  private shakes: ShakeInstance[] = [];
  /** Accumulated offset applied to camera position each frame */
  readonly offset = new THREE.Vector3();
  /** Accumulated rotation offset (roll) */
  rollOffset = 0;

  /** Add a weapon fire shake — small, fast */
  addFireShake(): void {
    this.shakes.push({ intensity: 0.008, decay: 15, frequency: 35, t: 0 });
  }

  /** Add a damage taken shake — medium */
  addDamageShake(): void {
    this.shakes.push({ intensity: 0.025, decay: 8, frequency: 20, t: 0 });
  }

  /** Add an explosion shake — large, slower */
  addExplosionShake(distance: number): void {
    // Fall off with distance
    const falloff = Math.max(0, 1 - distance / 30);
    if (falloff <= 0) return;
    this.shakes.push({ intensity: 0.06 * falloff, decay: 4, frequency: 12, t: 0 });
  }

  /** Add a landing impact shake */
  addLandShake(fallSpeed: number): void {
    const intensity = Math.min(0.03, Math.abs(fallSpeed) * 0.003);
    if (intensity < 0.005) return;
    this.shakes.push({ intensity, decay: 10, frequency: 18, t: 0 });
  }

  /** Update all shakes, compute combined offset */
  tick(dt: number): void {
    this.offset.set(0, 0, 0);
    this.rollOffset = 0;

    for (let i = this.shakes.length - 1; i >= 0; i--) {
      const s = this.shakes[i];
      s.t += dt;
      s.intensity *= Math.exp(-s.decay * dt);

      if (s.intensity < 0.0005) {
        this.shakes.splice(i, 1);
        continue;
      }

      // Pseudo-random oscillation using sin at different frequencies
      const px = Math.sin(s.t * s.frequency * 6.28) * s.intensity;
      const py = Math.cos(s.t * s.frequency * 4.17) * s.intensity * 0.7;
      const pz = Math.sin(s.t * s.frequency * 3.31) * s.intensity * 0.3;

      this.offset.x += px;
      this.offset.y += py;
      this.offset.z += pz;
      this.rollOffset += Math.sin(s.t * s.frequency * 2.73) * s.intensity * 0.5;
    }
  }
}

export const screenShake = new ScreenShake();
