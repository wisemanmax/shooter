/**
 * src/shell/vfx.ts
 * ═══════════════════════════════════════════════════════════════════════
 * Visual effects subsystems: viewmodel management, bullet tracers, and
 * muzzle flash. All objects are pre-allocated to avoid GC pressure during
 * gameplay.
 *
 * VFX reference extracted from client/builds/v6-heroes.html lines 556-559.
 * ═══════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';
import { ObjectPool } from '../utils/pool';

/* ─── Weapon definition types ─────────────────────────────────────── */

export interface ViewmodelDef {
  w: number;
  h: number;
  d: number;
  color: number;
}

export interface WeaponDef {
  viewmodel: ViewmodelDef;
}

/* ─── Tracer item tracked in the pool ─────────────────────────────── */

interface TracerItem {
  line: THREE.Line;
  /** Remaining lifetime in seconds */
  life: number;
  /** Total lifetime for opacity lerp */
  maxLife: number;
  active: boolean;
}

/* ═══════════════════════════════════════════════════════════════════
 * ViewmodelManager
 * ═══════════════════════════════════════════════════════════════════ */

class ViewmodelManager {
  /** The THREE.Group that holds all viewmodel meshes, attached to camera */
  group: THREE.Group = new THREE.Group();

  private meshGroup: THREE.Group | null = null;

  /**
   * Initialise the viewmodel system and attach its group to the camera.
   * Mirrors v6 line 556: `vmG.position.set(.3,-.28,-.55); cam.add(vmG)`.
   * @param camera - The player camera to attach the viewmodel to
   */
  init(camera: THREE.Camera): void {
    this.group.position.set(0.3, -0.28, -0.55);
    camera.add(this.group);
  }

  /**
   * Build a detailed viewmodel mesh from a weapon definition.
   * Uses a Group of three sub-meshes (barrel, receiver, stock) instead of
   * a single box so the silhouette reads correctly at low FOVs.
   * @param weaponDef - Weapon definition containing viewmodel dimensions and color
   */
  buildViewmodel(weaponDef: WeaponDef): void {
    if (this.meshGroup) {
      this.group.remove(this.meshGroup);
      this.meshGroup.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
        }
      });
    }

    const { w, h, d, color } = weaponDef.viewmodel;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 });

    // Barrel — thin long box projecting forward
    const barrelGeo = new THREE.BoxGeometry(w * 0.18, h * 0.18, d * 0.65);
    const barrel = new THREE.Mesh(barrelGeo, mat);
    barrel.position.set(0, h * 0.06, -d * 0.18);

    // Receiver — main body block
    const receiverGeo = new THREE.BoxGeometry(w, h, d * 0.55);
    const receiver = new THREE.Mesh(receiverGeo, mat);
    receiver.position.set(0, 0, d * 0.1);

    // Stock — short box behind the receiver
    const stockGeo = new THREE.BoxGeometry(w * 0.7, h * 0.75, d * 0.3);
    const stock = new THREE.Mesh(stockGeo, mat);
    stock.position.set(0, -h * 0.06, d * 0.42);

    this.meshGroup = new THREE.Group();
    this.meshGroup.add(barrel, receiver, stock);
    this.group.add(this.meshGroup);
  }

  /**
   * Show or hide the entire viewmodel group.
   * @param v - Visibility flag
   */
  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  /**
   * Apply a reload bob to the viewmodel based on animation progress.
   * Progress 0 = rest, 0.5 = peak bob downward, 1 = rest.
   * @param progress - Reload animation progress in [0, 1]
   */
  updateReload(progress: number): void {
    // Sinusoidal dip: down at mid-point, back at start/end
    const bob = Math.sin(progress * Math.PI) * 0.08;
    this.group.position.y = -0.28 - bob;
  }
}

/* ═══════════════════════════════════════════════════════════════════
 * TracerPool
 * ═══════════════════════════════════════════════════════════════════ */

/** Lifetime of each tracer in seconds (mirrors v6 line 558: t=0.06) */
const TRACER_LIFETIME = 0.06;
const TRACER_COUNT = 30;

class TracerPool {
  private scene: THREE.Scene | null = null;
  private items: TracerItem[] = [];
  private pool: ObjectPool<TracerItem>;

  constructor() {
    this.pool = new ObjectPool<TracerItem>(
      () => {
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(),
          new THREE.Vector3(),
        ]);
        const mat = new THREE.LineBasicMaterial({
          color: 0xffdd66,
          transparent: true,
          opacity: 0.4,
        });
        const line = new THREE.Line(geo, mat);
        line.visible = false;
        return { line, life: 0, maxLife: TRACER_LIFETIME, active: false };
      },
      (item) => {
        item.life = 0;
        item.active = false;
        item.line.visible = false;
        (item.line.material as THREE.LineBasicMaterial).opacity = 0.4;
      },
      TRACER_COUNT
    );
  }

  /**
   * Attach the tracer pool to a scene so lines can be added/removed.
   * Call once during game initialisation.
   * @param scene - The THREE.Scene to add tracer lines to
   */
  init(scene: THREE.Scene): void {
    this.scene = scene;
    // Pre-add all lines to the scene so add/remove is not needed per-shot
    for (let i = 0; i < TRACER_COUNT; i++) {
      const item = this.pool.acquire();
      scene.add(item.line);
      this.pool.release(item);
    }
  }

  /**
   * Activate a tracer line from a world-space start point to an end point.
   * @param start - Muzzle world position
   * @param end   - Impact world position
   */
  spawn(start: THREE.Vector3, end: THREE.Vector3): void {
    const item = this.pool.acquire();
    item.active = true;
    item.life = TRACER_LIFETIME;
    item.maxLife = TRACER_LIFETIME;

    const positions = item.line.geometry.attributes.position;
    if (positions) {
      positions.setXYZ(0, start.x, start.y, start.z);
      positions.setXYZ(1, end.x, end.y, end.z);
      positions.needsUpdate = true;
    } else {
      item.line.geometry.setFromPoints([start.clone(), end.clone()]);
    }

    item.line.visible = true;
    (item.line.material as THREE.LineBasicMaterial).opacity = 0.4;
    this.items.push(item);
  }

  /**
   * Update all active tracers: fade opacity and recycle expired ones.
   * Call once per frame with the delta-time in seconds.
   * @param dt - Delta time in seconds
   */
  tick(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      item.life -= dt;
      const t = Math.max(0, item.life / item.maxLife);
      (item.line.material as THREE.LineBasicMaterial).opacity = t * 0.4;

      if (item.life <= 0) {
        this.items.splice(i, 1);
        this.pool.release(item);
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════
 * MuzzleFlash
 * ═══════════════════════════════════════════════════════════════════ */

const FLASH_DURATION = 0.05; // 50 ms in seconds

class MuzzleFlashEffect {
  private light: THREE.PointLight = new THREE.PointLight(0xffaa33, 0, 5);
  private timer = 0;

  /**
   * Create and attach the muzzle flash point light to the camera.
   * Mirrors v6 line 559: `cam.add(mFl); mFl.position.set(.3,-.1,-.8)`.
   * @param camera - The player camera
   */
  init(camera: THREE.Camera): void {
    this.light.position.set(0.3, -0.1, -0.8);
    camera.add(this.light);
  }

  /**
   * Trigger a muzzle flash. Sets the light to full intensity and starts
   * the 50 ms decay timer.
   */
  fire(): void {
    this.light.intensity = 2.5;
    this.timer = FLASH_DURATION;
  }

  /**
   * Decay the muzzle flash timer. Call once per frame.
   * @param dt - Delta time in seconds
   */
  tick(dt: number): void {
    if (this.timer <= 0) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0;
      this.light.intensity = 0;
    }
  }
}

/* ─── Singletons ───────────────────────────────────────────────────── */

export const Viewmodel = new ViewmodelManager();
export const Tracers = new TracerPool();
export const MuzzleFlash = new MuzzleFlashEffect();
