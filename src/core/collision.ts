/**
 * Collision System — extracted from v6 `Col` object (line 477).
 * Provides AABB-based wall collision, ground raycasting, and spatial hashing
 * for efficient broadphase lookups.
 *
 * Raycasting uses a merged static mesh with BVH acceleration via
 * Three.js computeBoundsTree for O(log N) intersection.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  computeBoundsTree, disposeBoundsTree, acceleratedRaycast,
} from 'three-mesh-bvh';

// Patch Three.js prototypes for BVH acceleration
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/** Axis-aligned bounding box stored as min/max vectors */
interface AABB {
  mn: THREE.Vector3;
  mx: THREE.Vector3;
}

export class CollisionSystem {
  /** Wall meshes used for horizontal collision and raycasting */
  walls: THREE.Mesh[] = [];
  /** Ground meshes used for vertical raycasting */
  ground: THREE.Mesh[] = [];
  /** Target meshes (entity body + head) for hit detection */
  targets: THREE.Mesh[] = [];

  /** Merged static geometry mesh with BVH for fast raycasting */
  private staticBVH: THREE.Mesh | null = null;

  /** Cached AABBs computed from wall meshes */
  private aabbs: AABB[] = [];
  /** Spatial hash grid: cell key -> list of AABBs */
  private gridCells: Map<number, AABB[]> = new Map();
  /** Size of each spatial hash cell (~MAP_R*2/8) */
  private cellSize = 24;

  // Pre-allocated raycasters for reuse
  private rcDown = new THREE.Raycaster();
  private rcFwd = new THREE.Raycaster();
  private rcRay = new THREE.Raycaster();
  private rcLos = new THREE.Raycaster();

  /** Compute spatial hash key from world x,z coordinates */
  private cellKey(x: number, z: number): number {
    return Math.floor(x / this.cellSize) + Math.floor(z / this.cellSize) * 1000;
  }

  /** Rebuild AABB cache, spatial hash grid, and BVH from current wall meshes */
  rebuild(): void {
    this.aabbs = this.walls.map(m => {
      const b = new THREE.Box3().setFromObject(m);
      return { mn: b.min, mx: b.max };
    });

    // Rebuild spatial hash
    this.gridCells.clear();
    for (const aabb of this.aabbs) {
      const minCX = Math.floor(aabb.mn.x / this.cellSize);
      const maxCX = Math.floor(aabb.mx.x / this.cellSize);
      const minCZ = Math.floor(aabb.mn.z / this.cellSize);
      const maxCZ = Math.floor(aabb.mx.z / this.cellSize);

      for (let cx = minCX; cx <= maxCX; cx++) {
        for (let cz = minCZ; cz <= maxCZ; cz++) {
          const key = cx + cz * 1000;
          let list = this.gridCells.get(key);
          if (!list) {
            list = [];
            this.gridCells.set(key, list);
          }
          list.push(aabb);
        }
      }
    }

    // Build merged BVH mesh from all static geometry (walls + ground)
    this.buildBVH();
  }

  /** Merge all walls + ground into a single geometry with BVH */
  private buildBVH(): void {
    if (this.staticBVH) {
      this.staticBVH.geometry.disposeBoundsTree();
      this.staticBVH.geometry.dispose();
      this.staticBVH = null;
    }

    const allStatic = [...this.walls, ...this.ground];
    if (allStatic.length === 0) return;

    // Collect world-space geometries
    const geometries: THREE.BufferGeometry[] = [];
    for (const mesh of allStatic) {
      const clone = mesh.geometry.clone();
      clone.applyMatrix4(mesh.matrixWorld);
      // Ensure all geometries are non-indexed or indexed consistently
      if (!clone.index) {
        geometries.push(clone);
      } else {
        geometries.push(clone.toNonIndexed());
      }
    }

    const merged = mergeGeometries(geometries, false);
    if (!merged) return;

    merged.computeBoundsTree();

    const mat = new THREE.MeshBasicMaterial({ visible: false });
    this.staticBVH = new THREE.Mesh(merged, mat);
    this.staticBVH.visible = false;

    // Clean up temp clones
    for (const g of geometries) g.dispose();
  }

  /** Get AABBs from the entity's cell and its 8 neighbors */
  private getNearbyAABBs(x: number, z: number): AABB[] {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    const result: AABB[] = [];
    const seen = new Set<AABB>();

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const key = (cx + dx) + (cz + dz) * 1000;
        const list = this.gridCells.get(key);
        if (list) {
          for (const aabb of list) {
            if (!seen.has(aabb)) {
              seen.add(aabb);
              result.push(aabb);
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * Resolve horizontal cylinder-vs-AABB collision.
   * Nudges the position out of any overlapping wall AABBs.
   * Uses spatial hash for broadphase when available, falls back to full list.
   */
  resolveHorizontal(pos: THREE.Vector3, radius: number, height: number): void {
    const nearby = this.gridCells.size > 0
      ? this.getNearbyAABBs(pos.x, pos.z)
      : this.aabbs;

    for (const a of nearby) {
      // Vertical overlap check
      if (pos.y + height <= a.mn.y || pos.y >= a.mx.y) continue;
      // Horizontal overlap check (cylinder approximated as square)
      if (pos.x + radius <= a.mn.x || pos.x - radius >= a.mx.x) continue;
      if (pos.z + radius <= a.mn.z || pos.z - radius >= a.mx.z) continue;

      // Compute overlap on each axis
      const ox1 = pos.x + radius - a.mn.x;
      const ox2 = a.mx.x - pos.x + radius;
      const oz1 = pos.z + radius - a.mn.z;
      const oz2 = a.mx.z - pos.z + radius;

      const mx = ox1 < ox2 ? -ox1 : ox2;
      const mz = oz1 < oz2 ? -oz1 : oz2;

      // Push out along the axis with smallest overlap
      if (Math.abs(mx) < Math.abs(mz)) {
        pos.x += mx;
      } else {
        pos.z += mz;
      }
    }
  }

  /**
   * Ground raycast — cast a ray downward to find the ground height.
   * Uses BVH-accelerated mesh when available.
   * @param pos - Position to check from
   * @param up - How far above pos to start the ray (default 2)
   * @param down - Maximum downward distance to check (default 4)
   * @returns Hit result with height and surface normal
   */
  groundCheck(
    pos: THREE.Vector3,
    up: number = 2,
    down: number = 4
  ): { hit: boolean; height: number; normal: THREE.Vector3 } {
    this.rcDown.set(
      new THREE.Vector3(pos.x, pos.y + up, pos.z),
      new THREE.Vector3(0, -1, 0)
    );
    this.rcDown.near = 0;
    this.rcDown.far = down;

    // Use BVH mesh for ground check (includes both walls and ground geometry)
    const targets = this.staticBVH ? [this.staticBVH] : this.ground;
    const hits = this.rcDown.intersectObjects(targets, false);
    if (hits.length > 0) {
      return {
        hit: true,
        height: hits[0].point.y,
        normal: hits[0].face?.normal.clone() ?? new THREE.Vector3(0, 1, 0)
      };
    }
    return {
      hit: false,
      height: -Infinity,
      normal: new THREE.Vector3(0, 1, 0)
    };
  }

  /**
   * Forward raycast against walls only. Uses BVH when available.
   * @param origin - Ray origin
   * @param dir - Ray direction (should be normalized)
   * @param maxDist - Maximum ray distance
   * @returns Hit point or null if no intersection
   */
  forwardCheck(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number
  ): { hit: boolean; point: THREE.Vector3 } | null {
    this.rcFwd.set(origin, dir);
    this.rcFwd.near = 0;
    this.rcFwd.far = maxDist;

    const targets = this.staticBVH ? [this.staticBVH] : this.walls;
    const hits = this.rcFwd.intersectObjects(targets, false);
    if (hits.length > 0) {
      return { hit: true, point: hits[0].point };
    }
    return null;
  }

  /**
   * Raycast against walls and hittable targets.
   * Uses BVH for static geometry, targets checked separately (only ~30 meshes).
   * @param origin - Ray origin
   * @param dir - Ray direction (should be normalized)
   * @param maxDist - Maximum ray distance (default 200)
   * @returns Closest intersection or null
   */
  ray(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number = 200
  ): THREE.Intersection | null {
    this.rcRay.set(origin, dir);
    this.rcRay.near = 0;
    this.rcRay.far = maxDist;

    // Check BVH static geometry + dynamic entity targets
    const objects = this.staticBVH
      ? [this.staticBVH, ...this.targets]
      : [...this.walls, ...this.targets];
    const results = this.rcRay.intersectObjects(objects, false);
    return results[0] || null;
  }

  /**
   * Line of sight check between two points. Uses BVH when available.
   * @returns true if there are no wall obstructions between a and b
   */
  lineOfSight(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dir = b.clone().sub(a).normalize();
    this.rcLos.set(a, dir);
    this.rcLos.near = 0;
    this.rcLos.far = a.distanceTo(b);

    const targets = this.staticBVH ? [this.staticBVH] : this.walls;
    return this.rcLos.intersectObjects(targets, false).length === 0;
  }
}

/** Global collision system singleton */
export const Col = new CollisionSystem();
