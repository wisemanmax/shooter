/**
 * src/world/supplydrop.ts
 * Mid-match supply drop system — spawns high-tier loot at ring transitions.
 */

import * as THREE from 'three';
import { LootNode, LootTable } from './loot';
import { Ev } from '../utils/events';

const DROP_DESCENT_SPEED = 8;
const DROP_HEIGHT = 40;
const BEAM_HEIGHT = 30;

interface ActiveDrop {
  group: THREE.Group;
  beam: THREE.Mesh;
  targetY: number;
  descending: boolean;
  lootNode: LootNode | null;
  pos: THREE.Vector3;
}

export class SupplyDropSystem {
  private drops: ActiveDrop[] = [];
  private scene: THREE.Scene | null = null;

  init(scene: THREE.Scene): void {
    this.scene = scene;
  }

  /**
   * Spawn a supply drop at a position inside the ring.
   * @param ringCx Ring center X
   * @param ringCz Ring center Z
   * @param ringR Ring current radius
   * @param lootNodes The loot node array to push the spawned node into
   */
  spawn(ringCx: number, ringCz: number, ringR: number, lootNodes: LootNode[]): void {
    if (!this.scene) return;

    // Random position inside the next ring
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * ringR * 0.6;
    const x = ringCx + Math.cos(angle) * dist;
    const z = ringCz + Math.sin(angle) * dist;
    const pos = new THREE.Vector3(x, DROP_HEIGHT, z);

    // Build supply drop mesh: a crate with a light beam
    const group = new THREE.Group();
    group.position.copy(pos);

    // Crate body
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.6, 0.8),
      new THREE.MeshStandardMaterial({
        color: 0xe8c547,
        roughness: 0.3,
        metalness: 0.4,
        emissive: 0xe8c547,
        emissiveIntensity: 0.3,
      }),
    );
    group.add(crate);

    // Accent stripes
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.82, 0.08, 0.82),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.5,
        emissive: 0xffffff,
        emissiveIntensity: 0.1,
      }),
    );
    stripe.position.y = 0.1;
    group.add(stripe);

    // Glow light
    const light = new THREE.PointLight(0xe8c547, 1.5, 15);
    light.position.y = 1;
    group.add(light);

    this.scene.add(group);

    // Light beam from sky
    const beamGeo = new THREE.CylinderGeometry(0.15, 0.4, BEAM_HEIGHT, 8, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xe8c547,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(x, BEAM_HEIGHT / 2, z);
    this.scene.add(beam);

    const drop: ActiveDrop = {
      group,
      beam,
      targetY: 0.3,
      descending: true,
      lootNode: null,
      pos: new THREE.Vector3(x, 0, z),
    };
    this.drops.push(drop);

    Ev.emit('supply:incoming', { pos: new THREE.Vector3(x, 0, z) });
    showBannerFn?.('SUPPLY DROP', 'High-tier loot incoming!', 3);
  }

  /** Update all active drops */
  tick(dt: number, lootNodes: LootNode[]): void {
    if (!this.scene) return;

    for (const drop of this.drops) {
      if (drop.descending) {
        drop.group.position.y -= DROP_DESCENT_SPEED * dt;

        if (drop.group.position.y <= drop.targetY) {
          drop.group.position.y = drop.targetY;
          drop.descending = false;

          // Spawn high-tier loot node at landing position
          const items = LootTable.generate(3).map(item => {
            // Force epic+ rarity for weapons
            if (item.t === 'w') {
              item.r = Math.random() < 0.4 ? 'legendary' : 'epic';
            }
            return item;
          });
          drop.lootNode = new LootNode(this.scene!, drop.pos, items);
          lootNodes.push(drop.lootNode);

          Ev.emit('supply:landed', { pos: drop.pos.clone() });

          // Fade out beam over 3 seconds
          setTimeout(() => {
            if (this.scene && drop.beam.parent) {
              this.scene.remove(drop.beam);
              drop.beam.geometry.dispose();
              (drop.beam.material as THREE.Material).dispose();
            }
          }, 3000);
        }
      }

      // Beam pulse
      if (drop.beam.parent) {
        (drop.beam.material as THREE.MeshBasicMaterial).opacity =
          0.06 + Math.sin(performance.now() / 300) * 0.03;
      }
    }
  }

  /** Get positions of active drops for minimap */
  getActive(): THREE.Vector3[] {
    return this.drops.map(d => d.pos);
  }

  clear(): void {
    if (!this.scene) return;
    for (const d of this.drops) {
      this.scene.remove(d.group);
      if (d.beam.parent) this.scene.remove(d.beam);
    }
    this.drops = [];
  }
}

/** Optional banner callback — set externally */
let showBannerFn: ((title: string, sub: string, dur: number) => void) | null = null;

export function setSupplyDropBanner(fn: (title: string, sub: string, dur: number) => void): void {
  showBannerFn = fn;
}

export const supplyDrops = new SupplyDropSystem();
