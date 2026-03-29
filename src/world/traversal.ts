/**
 * World traversal systems — Zipline, JumpPad, Door, LootBin.
 * Extracted from v6-heroes.html lines 508-512.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Types used by traversal objects. These mirror the Entity / Col interfaces
// from the rest of the codebase but are kept lightweight so this module can
// be imported without pulling in everything.
// ---------------------------------------------------------------------------

/** Minimal entity interface required by traversal objects. */
export interface TraversableEntity {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  eye: THREE.Vector3;
  life: number;
  dropping: boolean;
  onZip: boolean;
  zipLine: Zipline | null;
  zipT: number;
  /** 1 = travelling a->b, -1 = b->a */
  _zd?: number;
  /** Movement-state enum (0=ground,1=air,2=slide,3=mantle) */
  _ms?: number;
  /** Pad cooldown timer */
  _padCd?: number;
  height: number;
}

/** Collision system interface expected by Door. */
export interface CollisionSystem {
  w: THREE.Mesh[];
  g: THREE.Mesh[];
  rebuild(): void;
}

// ---------------------------------------------------------------------------
// Constants — exactly as v6 C.*
// ---------------------------------------------------------------------------

/** Zipline travel speed (units/sec). */
export const ZIP_SPEED = 18;
/** Max distance to attach to a zipline anchor. */
export const ZIP_ATTACH = 2.5;
/** Horizontal exit boost when detaching from a zipline. */
export const ZIP_BOOST = 6;

/** Jump-pad vertical launch velocity. */
export const PAD_V = 16;
/** Jump-pad horizontal component when pad has a non-vertical direction. */
export const PAD_H = 8;
/** Jump-pad trigger radius. */
export const PAD_R = 1.2;

/** Movement-state: Airborne */
const MS_A = 1;

/** Life-state: Alive */
const LIFE_A = 0;

// ═══════════════════════════════════════════════════════════════
//  Zipline
// ═══════════════════════════════════════════════════════════════

/**
 * A rope-line between two anchor points that entities can ride along.
 *
 * Behaviour matches v6 exactly:
 * - Constant speed ZIP_SPEED (18 u/s)
 * - Rider hangs 1 unit below the line
 * - On detach, entity receives a horizontal boost of ZIP_BOOST (6) and a
 *   small vertical pop of 2.
 */
export class Zipline {
  /** Start anchor position. */
  a: THREE.Vector3;
  /** End anchor position. */
  b: THREE.Vector3;
  /** Normalised direction from a to b. */
  dir: THREE.Vector3;
  /** Length of the zipline in world units. */
  len: number;

  /**
   * Create a zipline between two points, adding visual meshes to the scene.
   * @param scene - THREE scene to add visuals to.
   * @param a - Start anchor world position.
   * @param b - End anchor world position.
   */
  constructor(scene: THREE.Scene, a: THREE.Vector3, b: THREE.Vector3) {
    this.a = a.clone();
    this.b = b.clone();
    this.dir = b.clone().sub(a).normalize();
    this.len = a.distanceTo(b);

    // Rope visual
    scene.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([a, b]),
        new THREE.LineBasicMaterial({ color: 0x58b8c9, transparent: true, opacity: 0.5 }),
      ),
    );

    // Anchor spheres
    for (const p of [a, b]) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 6, 4),
        new THREE.MeshStandardMaterial({
          color: 0x58b8c9,
          emissive: 0x58b8c9,
          emissiveIntensity: 0.2,
        }),
      );
      mesh.position.copy(p);
      scene.add(mesh);
    }
  }

  /**
   * Get a world-space point along the zipline at parameter `t` (0..1).
   * @param t - Normalised position along the line, clamped to [0,1].
   */
  pointAt(t: number): THREE.Vector3 {
    return this.a.clone().lerp(this.b, THREE.MathUtils.clamp(t, 0, 1));
  }

  /**
   * Find the nearest anchor (start or end) to a given position.
   * @param pos - Position to test against.
   * @returns Object with `dist` (distance to nearest anchor) and `t` (0 or 1).
   */
  nearestAnchor(pos: THREE.Vector3): { dist: number; t: number } {
    const da = pos.distanceTo(this.a);
    const db = pos.distanceTo(this.b);
    return da < db ? { dist: da, t: 0 } : { dist: db, t: 1 };
  }

  /**
   * Tick a rider along the zipline at constant speed.
   * Automatically detaches the entity when it reaches either end.
   * @param entity - The entity currently riding.
   * @param dt - Frame delta time in seconds.
   */
  tickRider(entity: TraversableEntity, dt: number): void {
    const s = ZIP_SPEED / this.len;
    entity.zipT += s * dt * (entity._zd || 1);
    entity.pos.copy(this.pointAt(entity.zipT));
    entity.pos.y -= 1;
    entity.vel.set(0, 0, 0);
    if (entity.zipT >= 1 || entity.zipT <= 0) this.detach(entity);
  }

  /**
   * Attach an entity to this zipline at parameter `t`.
   * @param entity - Entity to attach.
   * @param t - Starting parameter (0 = start anchor, 1 = end anchor).
   */
  attach(entity: TraversableEntity, t: number): void {
    entity.onZip = true;
    entity.zipLine = this;
    entity.zipT = t;
    entity._zd = t === 0 ? 1 : -1;
    entity.vel.set(0, 0, 0);
  }

  /**
   * Detach an entity from this zipline, applying an exit velocity boost.
   * @param entity - Entity to detach.
   */
  detach(entity: TraversableEntity): void {
    entity.onZip = false;
    entity.zipLine = null;
    entity.vel.set(
      this.dir.x * ZIP_BOOST * (entity._zd || 1),
      2,
      this.dir.z * ZIP_BOOST * (entity._zd || 1),
    );
    entity._ms = MS_A;
  }
}

// ═══════════════════════════════════════════════════════════════
//  JumpPad
// ═══════════════════════════════════════════════════════════════

/**
 * A launchpad that applies an impulse to entities that walk over it.
 *
 * Vertical component is always PAD_V (16). If the pad has a non-vertical
 * launch direction, PAD_H (8) is added along the horizontal component.
 */
export class JumpPad {
  /** World position of the pad center. */
  pos: THREE.Vector3;
  /** Normalised launch direction. */
  launchDir: THREE.Vector3;
  /** Animated point-light. */
  private light: THREE.PointLight;

  /**
   * Create a jump pad at the given position.
   * @param scene - THREE scene to add visuals to.
   * @param pos - World position of the pad center.
   * @param dir - Optional launch direction (defaults to straight up).
   */
  constructor(scene: THREE.Scene, pos: THREE.Vector3, dir?: THREE.Vector3) {
    this.pos = pos.clone();
    this.launchDir = dir ? dir.clone().normalize() : new THREE.Vector3(0, 1, 0);

    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(PAD_R, PAD_R, 0.08, 12),
      new THREE.MeshStandardMaterial({
        color: 0x44ddaa,
        emissive: 0x44ddaa,
        emissiveIntensity: 0.25,
      }),
    );
    mesh.position.copy(pos);
    mesh.position.y += 0.04;
    scene.add(mesh);

    this.light = new THREE.PointLight(0x44ddaa, 0.3, 5);
    this.light.position.copy(pos);
    this.light.position.y += 0.4;
    scene.add(this.light);
  }

  /**
   * Animate the pad's glow light.
   * @param time - Current elapsed game time in seconds.
   */
  tick(time: number): void {
    this.light.intensity = 0.2 + Math.sin(time * 4) * 0.1;
  }

  /**
   * Check if an entity is standing on this pad and, if so, launch it.
   * @param entity - Entity to test.
   * @returns `true` if the entity was launched.
   */
  check(entity: TraversableEntity): boolean {
    if (entity.life !== LIFE_A || entity.dropping || entity.onZip) return false;

    const dx = entity.pos.x - this.pos.x;
    const dz = entity.pos.z - this.pos.z;
    if (Math.sqrt(dx * dx + dz * dz) > PAD_R || Math.abs(entity.pos.y - this.pos.y) > 1) {
      return false;
    }

    entity.vel.y = PAD_V;
    if (this.launchDir.y < 0.99) {
      entity.vel.x += this.launchDir.x * PAD_H;
      entity.vel.z += this.launchDir.z * PAD_H;
    }
    entity._ms = MS_A;
    entity._padCd = 0.5;
    return true;
  }
}

// ═══════════════════════════════════════════════════════════════
//  Door
// ═══════════════════════════════════════════════════════════════

/**
 * A toggleable door that modifies the collision system when opened/closed.
 *
 * When open the mesh is moved off-screen (y = -10) and removed from
 * collision arrays. When closed it is restored.
 */
export class Door {
  /** World position of the door (base center). */
  pos: THREE.Vector3;
  /** Whether the door is currently open. */
  open: boolean;
  /** The door mesh. */
  mesh: THREE.Mesh;
  /** Door width (used for re-creation / collision). */
  private w: number;
  /** Door height (used for repositioning on close). */
  private h: number;
  /** Reference to the collision system that must be updated on toggle. */
  private col: CollisionSystem;

  /**
   * Create a door.
   * @param scene - THREE scene.
   * @param pos - Base-center position of the door.
   * @param width - Door width.
   * @param height - Door height.
   * @param axis - Axis the door spans along ('x' or 'z', default 'z').
   * @param col - Collision system to register/unregister the door with.
   */
  constructor(
    scene: THREE.Scene,
    pos: THREE.Vector3,
    width: number,
    height: number,
    axis: 'x' | 'z' = 'z',
    col: CollisionSystem,
  ) {
    this.pos = pos.clone();
    this.open = false;
    this.w = width;
    this.h = height;
    this.col = col;

    const gw = axis === 'z' ? width : 0.15;
    const gd = axis === 'z' ? 0.15 : width;

    this.mesh = new THREE.Mesh(
      new THREE.BoxGeometry(gw, height, gd),
      new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.5 }),
    );
    this.mesh.position.copy(pos);
    this.mesh.position.y = height / 2;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    col.w.push(this.mesh);
    col.g.push(this.mesh);
  }

  /**
   * Toggle the door between open and closed states and update collision.
   */
  toggle(): void {
    this.open = !this.open;
    if (this.open) {
      this.col.w = this.col.w.filter((m) => m !== this.mesh);
      this.col.g = this.col.g.filter((m) => m !== this.mesh);
      this.mesh.position.y = -10;
    } else {
      this.col.w.push(this.mesh);
      this.col.g.push(this.mesh);
      this.mesh.position.y = this.h / 2;
    }
    this.col.rebuild();
  }

  /**
   * Distance from a world position to the door base position.
   * @param pos - Position to measure from.
   */
  distanceTo(pos: THREE.Vector3): number {
    return this.pos.distanceTo(pos);
  }
}
