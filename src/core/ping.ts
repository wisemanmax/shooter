/**
 * src/core/ping.ts
 * Squad ping system — place world-space markers for team communication.
 * Supports location, enemy, and loot ping types.
 */

import * as THREE from 'three';
import { Ev } from '../utils/events';

/* ─── Ping types ──────────────────────────────────────────────── */

export const enum PingType {
  LOCATION = 0,
  ENEMY = 1,
  LOOT = 2,
}

/* ─── Ping marker ─────────────────────────────────────────────── */

interface PingMarker {
  type: PingType;
  pos: THREE.Vector3;
  life: number;
  maxLife: number;
  mesh: THREE.Group;
  label: string;
}

/* ─── Colors per ping type ────────────────────────────────────── */

const PING_COLORS: Record<number, number> = {
  [PingType.LOCATION]: 0x5ab8f5,
  [PingType.ENEMY]: 0xff4444,
  [PingType.LOOT]: 0xe8c547,
};

const PING_LABELS: Record<number, string> = {
  [PingType.LOCATION]: 'HERE',
  [PingType.ENEMY]: 'ENEMY',
  [PingType.LOOT]: 'LOOT',
};

const PING_LIFETIME = 5; // seconds
const MAX_PINGS = 5;

/* ─── Ping System ─────────────────────────────────────────────── */

export class PingSystem {
  private pings: PingMarker[] = [];
  private scene: THREE.Scene | null = null;
  private lastPingTime = 0;

  init(scene: THREE.Scene): void {
    this.scene = scene;
  }

  /** Place a ping at a world position */
  place(pos: THREE.Vector3, type: PingType = PingType.LOCATION): void {
    if (!this.scene) return;

    // Rate limit: 0.5s between pings
    const now = performance.now() / 1000;
    if (now - this.lastPingTime < 0.5) return;
    this.lastPingTime = now;

    // Remove oldest if at limit
    if (this.pings.length >= MAX_PINGS) {
      this.remove(0);
    }

    const color = PING_COLORS[type] ?? 0x5ab8f5;
    const label = PING_LABELS[type] ?? 'PING';

    // Build ping mesh: diamond + vertical line
    const group = new THREE.Group();
    group.position.copy(pos);

    // Diamond marker
    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.3),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      }),
    );
    diamond.position.y = 2.5;
    group.add(diamond);

    // Vertical line from ground to marker
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 2.2, 0),
    ]);
    const lineMat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.4,
      depthTest: false,
    });
    group.add(new THREE.Line(lineGeo, lineMat));

    // Base ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.45, 16),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    group.add(ring);

    group.renderOrder = 999;
    this.scene.add(group);

    this.pings.push({
      type,
      pos: pos.clone(),
      life: PING_LIFETIME,
      maxLife: PING_LIFETIME,
      mesh: group,
      label,
    });

    Ev.emit('ping:placed', { type, pos: pos.clone(), label });
  }

  /** Remove a ping by index */
  private remove(idx: number): void {
    const p = this.pings[idx];
    if (p && this.scene) {
      this.scene.remove(p.mesh);
      // Dispose geometry/materials
      p.mesh.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          (obj as THREE.Mesh).geometry.dispose();
          ((obj as THREE.Mesh).material as THREE.Material).dispose();
        }
      });
    }
    this.pings.splice(idx, 1);
  }

  /** Update all pings — animate and expire */
  tick(dt: number, camera: THREE.Camera): void {
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      p.life -= dt;

      if (p.life <= 0) {
        this.remove(i);
        continue;
      }

      // Fade out in last second
      const alpha = p.life < 1 ? p.life : 1;
      p.mesh.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          ((obj as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity =
            alpha * 0.9;
        }
      });

      // Billboard the diamond toward camera
      const diamond = p.mesh.children[0];
      if (diamond) {
        diamond.rotation.y += dt * 2;
        // Gentle bob
        diamond.position.y = 2.5 + Math.sin(performance.now() / 500) * 0.1;
      }
    }
  }

  /** Get active pings for minimap rendering */
  getActive(): { pos: THREE.Vector3; type: PingType; label: string }[] {
    return this.pings.map(p => ({ pos: p.pos, type: p.type, label: p.label }));
  }

  /** Clear all pings */
  clear(): void {
    while (this.pings.length > 0) this.remove(0);
  }
}

export const pingSystem = new PingSystem();
