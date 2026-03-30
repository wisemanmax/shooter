/**
 * Loot system — typed loot table, item types, pickup nodes and bins.
 * Extracted from v6-heroes.html lines 480 (LT), 510 (LootNode), 511 (LootBin).
 *
 * All values match the v6 minified source exactly.
 */

import * as THREE from 'three';
import { WEAPON_DEFS, AMMO_TYPES } from '../combat/weapons';
import { CONSUMABLES } from '../combat/damage';

/* ═══════════════════════════════════════════════════════════════
   Loot Item Types
   ═══════════════════════════════════════════════════════════════ */

/** A weapon item drop */
export interface WeaponLootItem {
  t: 'w';
  /** Key into WEAPON_DEFS */
  wid: string;
  /** Rarity tier */
  r: string;
}

/** An ammo pack drop */
export interface AmmoLootItem {
  t: 'a';
  /** Key into AMMO_TYPES */
  at: string;
  /** Number of rounds in the pack */
  am: number;
}

/** A consumable item drop */
export interface ConsumableLootItem {
  t: 'c';
  /** Key into CONSUMABLES */
  cid: string;
  /** Stack size */
  am: number;
}

/** Union of all possible loot item shapes — matches v6 item objects exactly */
export type LootItem = WeaponLootItem | AmmoLootItem | ConsumableLootItem;

/* ═══════════════════════════════════════════════════════════════
   Loot Table
   ═══════════════════════════════════════════════════════════════ */

/**
 * Loot table — controls rarity weights, category weights, ammo pack sizes,
 * and the consumable pool.  Matches v6 `LT` object exactly (line 480).
 */
export const LootTable = {
  /** All weapon IDs available to drop */
  wp: Object.keys(WEAPON_DEFS),

  /** Rarity probability weights (sum = 100) */
  rw: { common: 55, rare: 28, epic: 12, legendary: 5 } as Record<string, number>,

  /** Category probability weights (sum = 100) */
  cat: { weapon: 30, ammo: 35, consumable: 35 } as Record<string, number>,

  /** Ammo pack sizes per ammo type — matches v6 LT.ap */
  ap: { light: 60, heavy: 40, energy: 40, shells: 16 } as Record<string, number>,

  /** Weighted consumable pool (duplicates increase probability) */
  cp: ['syringe', 'syringe', 'cell', 'cell', 'medkit', 'battery'] as string[],

  /**
   * Roll a random rarity tier using the configured rarity weights.
   * Matches v6 `LT.rollR()` exactly.
   * @returns A rarity key string (e.g. 'common', 'rare', 'epic', 'legendary')
   */
  rollRarity(): string {
    const r = Math.random() * 100;
    let acc = 0;
    for (const [k, w] of Object.entries(this.rw)) {
      acc += w;
      if (r < acc) return k;
    }
    return 'common';
  },

  /**
   * Generate a random array of loot items.
   * Matches v6 `LT.gen(n)` exactly.
   * @param maxItems - Maximum number of items to generate (actual count is 1..maxItems)
   * @returns Array of LootItem objects
   */
  generate(maxItems = 3): LootItem[] {
    const items: LootItem[] = [];
    const count = 1 + Math.floor(Math.random() * maxItems);
    const ammoKeys = Object.keys(AMMO_TYPES);

    for (let i = 0; i < count; i++) {
      const cr = Math.random() * 100;

      if (cr < this.cat.weapon) {
        // Weapon drop
        items.push({
          t: 'w',
          wid: this.wp[Math.floor(Math.random() * this.wp.length)],
          r: this.rollRarity(),
        });
      } else if (cr < this.cat.weapon + this.cat.ammo) {
        // Ammo drop — type and pack size each rolled independently (matches v6)
        const typeRoll = ammoKeys[Math.floor(Math.random() * ammoKeys.length)];
        const sizeRoll = ammoKeys[Math.floor(Math.random() * ammoKeys.length)];
        items.push({
          t: 'a',
          at: typeRoll,
          am: this.ap[sizeRoll],
        });
      } else {
        // Consumable drop
        items.push({
          t: 'c',
          cid: this.cp[Math.floor(Math.random() * this.cp.length)],
          am: 1 + Math.floor(Math.random() * 2),
        });
      }
    }

    return items;
  },
};

/* ═══════════════════════════════════════════════════════════════
   LootNode — floating pickup
   ═══════════════════════════════════════════════════════════════ */

/**
 * Floating loot pickup node.
 * Renders as a spinning, bobbing octahedron.
 * Extracted from v6 `LootNode` class (line 510).
 */
export class LootNode {
  /** World position of the node */
  pos: THREE.Vector3;
  /** Items available to collect */
  items: LootItem[];
  /** Whether this node is still collectible */
  active: boolean;

  private group: THREE.Group;
  private mesh: THREE.Mesh;

  /**
   * @param scene - THREE.js scene to add the visual to
   * @param position - World position
   * @param items - Optional pre-defined items; if omitted generates 2 random items
   */
  constructor(scene: THREE.Scene, position: THREE.Vector3, items: LootItem[] | null = null) {
    this.pos = position.clone();
    this.items = items ?? LootTable.generate(2);
    this.active = true;

    this.group = new THREE.Group();
    this.group.position.copy(position);

    const col = 0xb4b4b4;
    this.mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.14),
      new THREE.MeshStandardMaterial({
        color: col,
        roughness: 0.3,
        metalness: 0.5,
        emissive: col,
        emissiveIntensity: 0.2,
      })
    );
    this.mesh.position.y = 0.3;
    this.group.add(this.mesh);

    scene.add(this.group);
  }

  /**
   * Advance the node's animation.
   * @param t - Elapsed game time in seconds
   */
  tick(t: number): void {
    if (!this.active) return;
    this.mesh.position.y = 0.3 + Math.sin(t * 2) * 0.04;
    this.mesh.rotation.y = t;
  }

  /**
   * Mark this node as collected and hide its visual.
   * Does not remove the Group from the scene — caller is responsible for that.
   */
  collect(): void {
    this.active = false;
    this.group.visible = false;
  }

  /**
   * Return a short display label for the primary item in this node.
   * @returns Human-readable label string
   */
  getLabel(): string {
    const first = this.items[0];
    if (!first) return 'Loot';
    if (first.t === 'w') return WEAPON_DEFS[first.wid].name;
    if (first.t === 'a') return `${first.at} ammo`;
    return CONSUMABLES[first.cid]?.name ?? 'Item';
  }
}

/* ═══════════════════════════════════════════════════════════════
   LootBin — openable supply container
   ═══════════════════════════════════════════════════════════════ */

/**
 * Openable supply bin.
 * Renders as a box with a lid and a pulsing point-light glow.
 * Extracted from v6 `LootBin` class (line 511).
 */
export class LootBin {
  /** World position of the bin */
  pos: THREE.Vector3;
  /** Whether the bin has been opened */
  open: boolean;

  private items: LootItem[];
  private group: THREE.Group;
  private lid: THREE.Mesh;
  private glow: THREE.PointLight;

  /**
   * @param scene - THREE.js scene to add the visual to
   * @param position - World position
   */
  constructor(scene: THREE.Scene, position: THREE.Vector3) {
    this.pos = position.clone();
    this.open = false;
    this.items = LootTable.generate(3);

    this.group = new THREE.Group();
    this.group.position.copy(position);

    // Main body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.45, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.5 })
    );
    body.position.y = 0.22;
    this.group.add(body);

    // Lid
    const lid = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.05, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x5588aa })
    );
    lid.position.y = 0.47;
    this.group.add(lid);
    this.lid = lid;

    // Glow light
    this.glow = new THREE.PointLight(0x5588aa, 0.25, 3);
    this.glow.position.y = 0.5;
    this.group.add(this.glow);

    scene.add(this.group);
  }

  /**
   * Advance the bin's animation.
   * @param t - Elapsed game time in seconds
   */
  tick(t: number): void {
    if (!this.open) {
      this.glow.intensity = 0.15 + Math.sin(t * 3) * 0.08;
    } else {
      this.glow.intensity = 0;
      this.lid.position.y = 0.7;
      this.lid.rotation.x = -0.7;
    }
  }

  /**
   * Open the bin and return its items.
   * Subsequent calls to `tick` will show the open-lid pose with no glow.
   * @returns The items contained in the bin
   */
  openBin(): LootItem[] {
    this.open = true;
    return this.items;
  }

  /**
   * Return a short display label for this bin.
   * @returns 'Supply Bin' when closed, '(empty)' when open
   */
  getLabel(): string {
    return this.open ? '(empty)' : 'Supply Bin';
  }
}
