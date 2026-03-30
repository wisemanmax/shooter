/**
 * src/shell/particles.ts
 * GPU-friendly particle system using instanced meshes.
 * Pools particles to avoid GC pressure. Supports multiple emitter types:
 * muzzle flash sparks, bullet impact, blood/shield hits, explosions.
 */

import * as THREE from 'three';

/* ─── Single particle state ───────────────────────────────────── */

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
  /** Gravity multiplier (1 = normal, 0 = none) */
  gravity: number;
}

/* ─── Constants ───────────────────────────────────────────────── */

const MAX_PARTICLES = 300;
const GRAVITY = -9.8;
const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

/* ─── Particle System ─────────────────────────────────────────── */

export class ParticleSystem {
  private particles: Particle[] = [];
  private mesh!: THREE.InstancedMesh;
  private scene: THREE.Scene | null = null;

  init(scene: THREE.Scene): void {
    this.scene = scene;

    // Small sphere geometry shared by all particles
    const geo = new THREE.SphereGeometry(0.03, 4, 3);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: false,
      transparent: true,
      depthWrite: false,
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_PARTICLES);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Per-instance color
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_PARTICLES * 3), 3
    );
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** Spawn N particles with the given config */
  private spawn(
    count: number,
    origin: THREE.Vector3,
    opts: {
      speed: number;
      spread: number;
      dir?: THREE.Vector3;
      life: number;
      lifeVariance?: number;
      size: number;
      sizeVariance?: number;
      color: THREE.Color;
      colorVariance?: number;
      gravity?: number;
    }
  ): void {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) break;

      const lifeVar = opts.lifeVariance ?? 0;
      const sizeVar = opts.sizeVariance ?? 0;
      const colorVar = opts.colorVariance ?? 0;

      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * opts.spread,
        (Math.random() - 0.5) * opts.spread,
        (Math.random() - 0.5) * opts.spread,
      );
      if (opts.dir) {
        vel.add(opts.dir.clone().multiplyScalar(opts.speed * (0.5 + Math.random() * 0.5)));
      } else {
        vel.normalize().multiplyScalar(opts.speed * (0.5 + Math.random() * 0.5));
      }

      const c = opts.color.clone();
      if (colorVar > 0) {
        c.r = Math.min(1, c.r + (Math.random() - 0.5) * colorVar);
        c.g = Math.min(1, c.g + (Math.random() - 0.5) * colorVar);
        c.b = Math.min(1, c.b + (Math.random() - 0.5) * colorVar);
      }

      this.particles.push({
        pos: origin.clone().add(new THREE.Vector3(
          (Math.random() - 0.5) * 0.1,
          (Math.random() - 0.5) * 0.1,
          (Math.random() - 0.5) * 0.1,
        )),
        vel,
        life: opts.life + (Math.random() - 0.5) * lifeVar,
        maxLife: opts.life,
        size: opts.size + (Math.random() - 0.5) * sizeVar,
        color: c,
        gravity: opts.gravity ?? 1,
      });
    }
  }

  /* ─── Emitter presets ─────────────────────────────────────── */

  /** Orange/yellow sparks from muzzle */
  emitMuzzleFlash(origin: THREE.Vector3, dir: THREE.Vector3): void {
    this.spawn(6, origin, {
      speed: 8,
      spread: 3,
      dir,
      life: 0.12,
      lifeVariance: 0.06,
      size: 0.025,
      color: new THREE.Color(1.0, 0.7, 0.2),
      colorVariance: 0.2,
      gravity: 0.3,
    });
  }

  /** Dust/sparks at bullet impact point on walls */
  emitWallImpact(point: THREE.Vector3, normal: THREE.Vector3): void {
    this.spawn(8, point, {
      speed: 3,
      spread: 2,
      dir: normal,
      life: 0.3,
      lifeVariance: 0.15,
      size: 0.02,
      color: new THREE.Color(0.7, 0.65, 0.5),
      colorVariance: 0.15,
      gravity: 1,
    });
  }

  /** Red particles for health damage */
  emitBloodHit(point: THREE.Vector3): void {
    this.spawn(5, point, {
      speed: 2.5,
      spread: 2,
      life: 0.25,
      lifeVariance: 0.1,
      size: 0.02,
      color: new THREE.Color(0.8, 0.1, 0.05),
      colorVariance: 0.1,
      gravity: 1.5,
    });
  }

  /** Blue/cyan particles for shield damage */
  emitShieldHit(point: THREE.Vector3): void {
    this.spawn(6, point, {
      speed: 3,
      spread: 3,
      life: 0.2,
      lifeVariance: 0.08,
      size: 0.025,
      color: new THREE.Color(0.3, 0.6, 1.0),
      colorVariance: 0.15,
      gravity: 0.2,
    });
  }

  /** Large explosion burst (Forge ult, etc.) */
  emitExplosion(center: THREE.Vector3): void {
    // Fire core
    this.spawn(20, center, {
      speed: 8,
      spread: 6,
      life: 0.4,
      lifeVariance: 0.2,
      size: 0.06,
      sizeVariance: 0.03,
      color: new THREE.Color(1.0, 0.5, 0.1),
      colorVariance: 0.3,
      gravity: 0.5,
    });
    // Debris
    this.spawn(12, center, {
      speed: 6,
      spread: 5,
      life: 0.6,
      lifeVariance: 0.3,
      size: 0.03,
      color: new THREE.Color(0.4, 0.35, 0.3),
      colorVariance: 0.1,
      gravity: 2,
    });
  }

  /** Update all particles, write to instanced mesh */
  tick(dt: number): void {
    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        // Swap-remove
        this.particles[i] = this.particles[this.particles.length - 1];
        this.particles.pop();
        continue;
      }
      // Physics
      p.vel.y += GRAVITY * p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
    }

    // Write to instanced mesh
    const count = this.particles.length;
    this.mesh.count = count;

    for (let i = 0; i < count; i++) {
      const p = this.particles[i];
      const t = p.life / p.maxLife; // 1 at spawn, 0 at death
      const scale = p.size * t; // Shrink over lifetime

      _dummy.position.copy(p.pos);
      _dummy.scale.setScalar(scale / 0.03); // Normalize to geometry radius
      _dummy.updateMatrix();
      this.mesh.setMatrixAt(i, _dummy.matrix);

      // Fade color toward dark
      _color.copy(p.color).multiplyScalar(t);
      this.mesh.setColorAt(i, _color);
    }

    if (count > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }
}

export const particles = new ParticleSystem();
