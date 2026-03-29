/**
 * Weapon system — typed weapon definitions and runtime state.
 * Extracted from v6-heroes.html lines 472-478 (AMMO, RARITY, WD, apR, Wep).
 *
 * All numeric values match the v6 minified source exactly.
 */

import * as THREE from 'three';

/* ═══════════════════════════════════════════════════════════════
   Ammo Types
   ═══════════════════════════════════════════════════════════════ */

/** Ammo type definitions — color used for HUD display */
export const AMMO_TYPES: Record<string, { color: string }> = {
  light:   { color: '#c9b458' },
  heavy:   { color: '#5ab855' },
  energy:  { color: '#58b8c9' },
  shells:  { color: '#c96058' },
};

/* ═══════════════════════════════════════════════════════════════
   Rarity
   ═══════════════════════════════════════════════════════════════ */

/** Rarity multipliers — applied to base damage and magazine size */
export const RARITY: Record<string, { mult: number; color: string }> = {
  common:    { mult: 1,    color: '#b4b4b4' },
  rare:      { mult: 1.08, color: '#3c8cff' },
  epic:      { mult: 1.15, color: '#a03cdc' },
  legendary: { mult: 1.22, color: '#e8c547' },
};

/* ═══════════════════════════════════════════════════════════════
   Weapon Definition Interface
   ═══════════════════════════════════════════════════════════════ */

/** Base weapon definition — immutable template */
export interface WeaponDef {
  /** Internal identifier (e.g. 'ar', 'smg') */
  id: string;
  /** Display name (e.g. 'R-301') */
  name: string;
  /** Ammo type key into AMMO_TYPES */
  ammoType: string;
  /** Fire mode — 'auto' holds to fire, 'semi' requires re-click */
  mode: 'auto' | 'semi';
  /** Damage values per hit */
  damage: { body: number; head: number };
  /** Rounds per second */
  fireRate: number;
  /** Magazine capacity (base, before rarity) */
  magSize: number;
  /** Reload duration in seconds */
  reloadTime: number;
  /** Spread parameters in degrees */
  spread: { base: number; bloom: number; max: number; recovery: number };
  /** Recoil parameters */
  recoil: { vertical: number; horizontal: number; recovery: number };
  /** Maximum effective range in metres */
  range: number;
  /** Pellets per shot (>1 for shotguns) */
  pellets: number;
  /** Viewmodel box dimensions and colour */
  viewmodel: { w: number; h: number; d: number; color: number };
}

/* ═══════════════════════════════════════════════════════════════
   Weapon Definitions — exact values from v6 WD object
   ═══════════════════════════════════════════════════════════════ */

/** All base weapon definitions, keyed by short id */
export const WEAPON_DEFS: Record<string, WeaponDef> = {
  ar: {
    id: 'ar', name: 'R-301', ammoType: 'light', mode: 'auto',
    damage: { body: 18, head: 36 },
    fireRate: 11, magSize: 28, reloadTime: 1.8,
    spread: { base: 0.3, bloom: 0.12, max: 2.8, recovery: 4.5 },
    recoil: { vertical: 0.9, horizontal: 0.25, recovery: 6 },
    range: 120, pellets: 1,
    viewmodel: { w: 0.06, h: 0.06, d: 0.5, color: 0x556677 },
  },
  smg: {
    id: 'smg', name: 'R-99', ammoType: 'light', mode: 'auto',
    damage: { body: 12, head: 18 },
    fireRate: 18, magSize: 20, reloadTime: 1.4,
    spread: { base: 0.6, bloom: 0.2, max: 4, recovery: 5.5 },
    recoil: { vertical: 0.5, horizontal: 0.45, recovery: 7 },
    range: 60, pellets: 1,
    viewmodel: { w: 0.05, h: 0.05, d: 0.38, color: 0x667755 },
  },
  sg: {
    id: 'sg', name: 'EVA-8', ammoType: 'shells', mode: 'semi',
    damage: { body: 11, head: 16 },
    fireRate: 2, magSize: 8, reloadTime: 2.6,
    spread: { base: 3.5, bloom: 0, max: 3.5, recovery: 0 },
    recoil: { vertical: 2.5, horizontal: 0.5, recovery: 3 },
    range: 25, pellets: 8,
    viewmodel: { w: 0.07, h: 0.07, d: 0.55, color: 0x775544 },
  },
  mk: {
    id: 'mk', name: 'G7 Scout', ammoType: 'heavy', mode: 'semi',
    damage: { body: 36, head: 72 },
    fireRate: 3.5, magSize: 10, reloadTime: 2.4,
    spread: { base: 0.15, bloom: 0.6, max: 2, recovery: 3 },
    recoil: { vertical: 1.8, horizontal: 0.15, recovery: 4 },
    range: 180, pellets: 1,
    viewmodel: { w: 0.05, h: 0.06, d: 0.6, color: 0x445566 },
  },
  ps: {
    id: 'ps', name: 'P2020', ammoType: 'light', mode: 'semi',
    damage: { body: 21, head: 32 },
    fireRate: 6.5, magSize: 14, reloadTime: 1.1,
    spread: { base: 0.25, bloom: 0.3, max: 2.5, recovery: 5 },
    recoil: { vertical: 1, horizontal: 0.2, recovery: 5.5 },
    range: 50, pellets: 1,
    viewmodel: { w: 0.04, h: 0.07, d: 0.22, color: 0x888877 },
  },
  lmg: {
    id: 'lmg', name: 'Devotion', ammoType: 'energy', mode: 'auto',
    damage: { body: 16, head: 28 },
    fireRate: 13, magSize: 36, reloadTime: 2.8,
    spread: { base: 0.5, bloom: 0.1, max: 3, recovery: 3.5 },
    recoil: { vertical: 0.7, horizontal: 0.35, recovery: 5 },
    range: 90, pellets: 1,
    viewmodel: { w: 0.07, h: 0.07, d: 0.52, color: 0x556655 },
  },
};

/* ═══════════════════════════════════════════════════════════════
   Rarity Application
   ═══════════════════════════════════════════════════════════════ */

/** Rarity-augmented weapon definition */
export type RarityWeaponDef = WeaponDef & { rarity: string };

/**
 * Apply a rarity tier to a base weapon definition.
 * Returns a new WeaponDef with scaled damage and magazine size.
 * Matches v6 `apR` exactly:
 *   damage = round(base * mult)
 *   magSize = round(base * (1 + (mult-1)*2))
 */
export function applyRarity(base: WeaponDef, rarity: string): RarityWeaponDef {
  const r = RARITY[rarity];
  return {
    ...base,
    rarity,
    damage: {
      body: Math.round(base.damage.body * r.mult),
      head: Math.round(base.damage.head * r.mult),
    },
    magSize: Math.round(base.magSize * (1 + (r.mult - 1) * 2)),
  };
}

/* ═══════════════════════════════════════════════════════════════
   Weapon Runtime State
   ═══════════════════════════════════════════════════════════════ */

/**
 * Runtime weapon instance — tracks ammo, bloom, recoil, reload progress.
 * Translated from the v6 minified `Wep` class (line 478).
 */
export class Weapon {
  /** The (possibly rarity-augmented) definition this weapon was created from */
  def: RarityWeaponDef;
  /** Current ammo in magazine */
  ammo: number;
  /** Current bloom accumulation */
  bloom: number;
  /** Remaining fire cooldown in seconds */
  fireCooldown: number;
  /** Whether the weapon is currently reloading */
  reloading: boolean;
  /** Remaining reload time in seconds */
  reloadTimer: number;
  /** Current vertical recoil offset */
  recoilPitch: number;
  /** Current horizontal recoil offset */
  recoilYaw: number;
  /** Whether fire was held last frame (for semi-auto blocking) */
  lastFired: boolean;
  /** Pending ammo to add when reload completes */
  private pendingAmmo: number;

  constructor(def: RarityWeaponDef) {
    this.def = def;
    this.ammo = def.magSize;
    this.bloom = 0;
    this.fireCooldown = 0;
    this.reloading = false;
    this.reloadTimer = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.lastFired = false;
    this.pendingAmmo = 0;
  }

  /** Current total spread in degrees (base + bloom) */
  get spread(): number {
    return this.def.spread.base + this.bloom;
  }

  /** Whether the weapon can fire right now */
  get canFire(): boolean {
    return !this.reloading && this.ammo > 0 && this.fireCooldown <= 0;
  }

  /**
   * Advance weapon state by `dt` seconds.
   * Decays fire cooldown, bloom, recoil, and processes reload completion.
   */
  tick(dt: number): void {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);

    // Bloom recovery — only when not actively firing or cooldown expired
    if (this.fireCooldown <= 0 || !this.lastFired) {
      this.bloom = Math.max(0, this.bloom - this.def.spread.recovery * dt);
    }

    // Recoil recovery
    const r = this.def.recoil.recovery * dt;
    this.recoilPitch = Math.max(0, this.recoilPitch - r);
    this.recoilYaw *= Math.max(0, 1 - r * 0.5);

    // Reload completion
    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.ammo = Math.min(this.ammo + this.pendingAmmo, this.def.magSize);
        this.pendingAmmo = 0;
        this.reloading = false;
      }
    }
  }

  /**
   * Attempt to fire the weapon.
   * @param semiBlock - If true, block fire (used for semi-auto weapons when trigger is held).
   * @returns true if a round was fired
   */
  fire(semiBlock: boolean): boolean {
    if (!this.canFire) return false;
    if (this.def.mode === 'semi' && semiBlock) return false;

    this.ammo--;
    this.fireCooldown = 1 / this.def.fireRate;
    this.bloom = Math.min(
      this.bloom + this.def.spread.bloom,
      this.def.spread.max - this.def.spread.base
    );
    this.recoilPitch += this.def.recoil.vertical;
    this.recoilYaw += (Math.random() - 0.5) * this.def.recoil.horizontal * 2;
    this.lastFired = true;
    return true;
  }

  /**
   * Begin reloading the weapon.
   * @param ammoAvailable - Ammo available from inventory for this weapon's ammo type
   */
  startReload(ammoAvailable: number): void {
    if (this.reloading || this.ammo >= this.def.magSize || ammoAvailable <= 0) return;
    this.reloading = true;
    this.reloadTimer = this.def.reloadTime;
    this.pendingAmmo = ammoAvailable;
  }

  /** Reset weapon to full magazine, zero bloom/recoil, cancel reload */
  refill(): void {
    this.ammo = this.def.magSize;
    this.bloom = 0;
    this.fireCooldown = 0;
    this.reloading = false;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.pendingAmmo = 0;
  }
}
