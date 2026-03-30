/**
 * Entity system — typed Inventory and Entity classes.
 * Extracted and typed from v6-heroes.html lines 481-503 (Inv, Life, Ent).
 *
 * Matches v6 minified behaviour exactly.
 */

import * as THREE from 'three';
import { Weapon, RarityWeaponDef } from '../combat/weapons';
import { LifeState, LifeStateValue, resolveDamage, DamageResult } from '../combat/damage';
import { Ev } from '../utils/events';
import { Col } from '../core/collision';
import { COMBAT, SIM } from '../../shared/protocol';
import { AbilState, type HeroDef, type AbilSlotState } from '../combat/abilities';

// Re-export for convenience
export { AbilState, type HeroDef };

/** @deprecated Use AbilSlotState from abilities.ts */
export type AbilSlot = AbilSlotState;

/**
 * REMOVED: Local AbilState / HeroDef / AbilSlot definitions.
 * Now imported from ../combat/abilities.ts to ensure type compatibility.
 */

/* ═══════════════════════════════════════════════════════════════
   Ammo pool type
   ═══════════════════════════════════════════════════════════════ */

/** Per-ammo-type pool used by Inventory */
export type AmmoPool = { light: number; heavy: number; energy: number; shells: number };

/* ═══════════════════════════════════════════════════════════════
   Inventory
   ═══════════════════════════════════════════════════════════════ */

/**
 * Entity inventory — weapon slots, ammo pool, and consumables.
 * Translated from v6 `Inv` class (line 481).
 */
export class Inventory {
  /** Two weapon slots — null means empty */
  slots: [Weapon | null, Weapon | null];

  /** Index of the currently active weapon slot (0 or 1) */
  activeIndex: 0 | 1;

  /** Available ammo per type */
  ammo: AmmoPool;

  /** Consumable counts keyed by consumable id */
  consumables: Record<string, number>;

  constructor() {
    this.slots = [null, null];
    this.activeIndex = 0;
    this.ammo = { light: 0, heavy: 0, energy: 0, shells: 0 };
    this.consumables = {};
  }

  /**
   * Returns the currently active Weapon instance, or null if the slot is empty.
   * Mirrors v6 `Inv.aw` getter.
   */
  get activeWeapon(): Weapon | null {
    return this.slots[this.activeIndex];
  }

  /**
   * Equip a weapon definition into the given slot index.
   * Initialises a new Weapon from the definition, seeds the ammo pool with
   * one full magazine, and returns whatever was previously in that slot.
   *
   * Mirrors v6 `Inv.pickup` exactly:
   *   - creates `new Wep(d)` in slot `si`
   *   - adds `d.mg` rounds to the corresponding ammo pool
   *   - returns the old weapon (or null)
   *
   * @param weaponDef - Rarity-augmented weapon definition to equip
   * @param slotIndex - Slot to place the weapon in (0 or 1)
   * @returns The weapon that was previously in the slot, or null
   */
  pickup(weaponDef: RarityWeaponDef, slotIndex: 0 | 1): Weapon | null {
    const old = this.slots[slotIndex];
    this.slots[slotIndex] = new Weapon(weaponDef);
    const type = weaponDef.ammoType as keyof AmmoPool;
    this.ammo[type] = (this.ammo[type] ?? 0) + weaponDef.magSize;
    return old;
  }

  /**
   * Add ammo to the pool for the given type.
   * Mirrors v6 `Inv.addA`.
   *
   * @param type - Ammo type key (e.g. 'light', 'heavy')
   * @param amount - Number of rounds to add
   */
  addAmmo(type: string, amount: number): void {
    const pool = this.ammo as Record<string, number>;
    pool[type] = (pool[type] ?? 0) + amount;
  }

  /**
   * Add consumable items of the given id to the inventory.
   * Mirrors v6 `Inv.addC`.
   *
   * @param id - Consumable definition id (e.g. 'syringe', 'medkit')
   * @param amount - Number of items to add
   */
  addConsumable(id: string, amount: number): void {
    this.consumables[id] = (this.consumables[id] ?? 0) + amount;
  }

  /**
   * Reload the active weapon using ammo from the pool.
   *
   * Matches v6 `Inv.rldActive` exactly:
   * - Does nothing if no active weapon, already reloading, or mag is full
   * - Deducts exactly `min(need, available)` rounds from the pool
   * - Calls `weapon.startReload(n)` with the deducted amount
   *
   * The caller is responsible for ticking the weapon each frame so the
   * reload timer counts down.
   */
  reloadActive(): void {
    const w = this.activeWeapon;
    if (!w || w.reloading || w.ammo >= w.def.magSize) return;
    const type = w.def.ammoType as keyof AmmoPool;
    const available = this.ammo[type] ?? 0;
    if (available <= 0) return;
    const needed = Math.min(w.def.magSize - w.ammo, available);
    this.ammo[type] -= needed;
    w.startReload(needed);
  }
}

/* ═══════════════════════════════════════════════════════════════
   Move-state enum (mirrors v6 MS object used inside tickPM)
   ═══════════════════════════════════════════════════════════════ */

/** Internal movement FSM states — matches v6 `MS` object */
export const MoveState = { GROUND: 0, AIR: 1, SLIDE: 2, MANTLE: 3 } as const;
export type MoveStateValue = (typeof MoveState)[keyof typeof MoveState];

/* ═══════════════════════════════════════════════════════════════
   Squad colour palette (matches v6 Ent constructor)
   ═══════════════════════════════════════════════════════════════ */

const SQUAD_COLORS: number[] = [
  0x5ab8f5, // squad 0 — blue
  0xf55a5a, // squad 1 — red
  0x5af5a6, // squad 2 — green
  0xf5a623, // squad 3 — orange
  0xd55af5, // squad 4 — purple
];

/** Eye-height fraction of total entity height — v6 C.EY = 0.85 */
const EYE_HEIGHT_FRAC = 0.85;

/* ═══════════════════════════════════════════════════════════════
   Entity
   ═══════════════════════════════════════════════════════════════ */

/**
 * Full game entity — player or bot.
 * Translated from v6 `Ent` class (lines 483-503).
 *
 * All property names are expanded from v6 minified names for readability,
 * with the original names noted in comments.
 */
export class Entity {
  // ── Identity ──────────────────────────────────────────────────
  /** Display name */
  name: string;
  /** Squad index (0-4) — v6 `sqId` */
  squadId: number;
  /** True if this entity represents the local human player — v6 `isP` */
  isPlayer: boolean;

  // ── Life state ────────────────────────────────────────────────
  /** Current life state — v6 `life` */
  life: LifeStateValue;

  // ── Physics ───────────────────────────────────────────────────
  /** World-space position — v6 `pos` */
  pos: THREE.Vector3;
  /** World-space velocity in m/s — v6 `vel` */
  vel: THREE.Vector3;
  /** Horizontal look angle in radians — v6 `yaw` */
  yaw: number;
  /** Vertical look angle in radians — v6 `pitch` */
  pitch: number;
  /** Current collider height (changes when crouched) — v6 `height` */
  height: number;

  // ── Locomotion flags ─────────────────────────────────────────
  /** Whether the entity is sprinting — v6 `isSpr` */
  isSprint: boolean;
  /** Whether the entity is crouching — v6 `isCrc` */
  isCrouch: boolean;

  // ── Health / Shield ───────────────────────────────────────────
  /** Current health points — v6 `hp` */
  hp: number;
  /** Current shield points — v6 `sh` */
  sh: number;
  /**
   * Server time of last damage taken (seconds) — v6 `lastDT`.
   * Also accessible as `lastDT` for compatibility with the DamageableEntity interface.
   */
  lastDamageTime: number;
  /** Entity that most recently damaged this one — v6 `lastAtk` */
  lastAttacker: Entity | null;

  // ── Downed state ──────────────────────────────────────────────
  /**
   * Remaining bleed-out time when downed — v6 `bleedT`.
   * Also accessible as `bleedT` for compatibility with the DamageableEntity interface.
   */
  bleedTimer: number;
  /** Whether a squadmate is currently reviving this entity — v6 `beingRev` */
  beingRevived: boolean;
  /** Revive progress in [0, 1] — v6 `revProg` */
  reviveProgress: number;
  /** The entity performing the revive — v6 `reviver` */
  reviver: Entity | null;
  /** Banner state ('available' when downed, null otherwise) — v6 `banner` */
  banner: string | null;
  /** Entity currently carrying this entity's banner — v6 `bannerH` */
  bannerHolder: Entity | null;

  // ── Drop / spawn ──────────────────────────────────────────────
  /** Whether the entity is in the dropping-in phase — v6 `dropping` */
  dropping: boolean;
  /** Current altitude during drop — v6 `dropY` */
  dropY: number;

  // ── Zipline ───────────────────────────────────────────────────
  /** Whether the entity is riding a zipline — v6 `onZip` */
  onZip: boolean;
  /** The zipline being ridden, or null — v6 `zipLine` */
  zipLine: any | null;
  /** Normalised position along the zipline [0,1] — v6 `zipT` */
  zipT: number;

  // ── Inventory ────────────────────────────────────────────────
  /** Weapon and item inventory — v6 `inv` */
  inventory: Inventory;

  // ── Hero / abilities ─────────────────────────────────────────
  /** Hero id string (e.g. 'wraith') — v6 `heroId` */
  heroId: string;
  /** Ability state tracker — v6 `abil` */
  abil: AbilState;

  // ── Status effects ────────────────────────────────────────────
  /** Whether this entity is revealed to all (e.g. Seer scan) — v6 `_revealed` */
  _revealed: boolean;
  /** Timer for reveal effect — v6 `_revealTimer` */
  _revealTimer: number;
  /** Speed multiplier from slow effects (1 = normal) — v6 `_slowMult` */
  _slowMult: number;
  /** Portal cooldown timer — v6 `_portalCd` */
  _portalCd: number;

  // ── Movement FSM ─────────────────────────────────────────────
  /** Current movement state — v6 `_ms` */
  _ms: MoveStateValue;
  /** Slide cooldown timer — v6 `_scd` */
  _scd: number;
  /** Coyote-time timer (grace period after walking off a ledge) — v6 `_coy` */
  _coy: number;
  /** Jump buffer timer — v6 `_jb` */
  _jb: number;
  /** Jump pad cooldown — v6 `_padCd` */
  _padCd: number;
  /** Zipline direction (+1 or -1) — v6 `_zd` */
  _zd: number;

  // ── 3-D model ─────────────────────────────────────────────────
  /** Root group added to the scene — v6 `mdl` */
  mdl: THREE.Group;
  /** Body cylinder mesh — v6 `bodyM` */
  bodyM: THREE.Mesh;
  /** Head sphere mesh — v6 `headM` */
  headM: THREE.Mesh;

  /** Cached body material (shared between resets) */
  private bMat: THREE.MeshStandardMaterial;
  /** Cached head material (shared between resets) */
  private hMat: THREE.MeshStandardMaterial;

  /**
   * Construct a new entity and add its 3-D model to `scene`.
   * Mirrors v6 `Ent` constructor exactly:
   *   - Colours body/head by squad index (palette wraps mod 5)
   *   - Registers body/head meshes with the collision target list
   *
   * @param name - Display name
   * @param squadId - Squad index (0-4, wraps via mod 5)
   * @param scene - THREE.Scene (or any Object3D) to add the model to
   * @param heroId - Hero id string — must exist in the HEROES table
   * @param heroDef - Hero definition loaded from HEROES[heroId]
   */
  constructor(
    name: string,
    squadId: number,
    scene: THREE.Object3D,
    heroId: string,
    heroDef: HeroDef,
  ) {
    // Identity
    this.name = name;
    this.squadId = squadId;
    this.isPlayer = false;

    // Life
    this.life = LifeState.ALIVE;

    // Physics
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.height = SIM.PLAYER_HEIGHT;

    // Locomotion
    this.isSprint = false;
    this.isCrouch = false;

    // Health
    this.hp = COMBAT.MAX_HP;
    this.sh = 0;
    this.lastDamageTime = -999;
    this.lastAttacker = null;

    // Downed
    this.bleedTimer = 0;
    this.beingRevived = false;
    this.reviveProgress = 0;
    this.reviver = null;
    this.banner = null;
    this.bannerHolder = null;

    // Drop
    this.dropping = true;
    this.dropY = 60; // v6 C.DROP_H

    // Zipline
    this.onZip = false;
    this.zipLine = null;
    this.zipT = 0;

    // Inventory
    this.inventory = new Inventory();

    // Hero / abilities
    this.heroId = heroId;
    this.abil = new AbilState(heroDef);

    // Status effects
    this._revealed = false;
    this._revealTimer = 0;
    this._slowMult = 1;
    this._portalCd = 0;

    // Movement FSM
    this._ms = MoveState.AIR;
    this._scd = 0;
    this._coy = 0;
    this._jb = 0;
    this._padCd = 0;
    this._zd = 1;

    // ── Build 3-D model ──────────────────────────────────────────
    const teamColor = SQUAD_COLORS[squadId % 5];
    this.bMat = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.5 });
    this.hMat = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.4 });

    const g = new THREE.Group();

    // Torso — main body
    const torso = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.65, 0.3),
      this.bMat,
    );
    torso.position.y = 0.85;
    torso.castShadow = true;
    g.add(torso);

    // Legs — two thin boxes
    const legMat = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.6 });
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.16), legMat);
    legL.position.set(-0.1, 0.25, 0);
    legL.castShadow = true;
    g.add(legL);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.16), legMat);
    legR.position.set(0.1, 0.25, 0);
    legR.castShadow = true;
    g.add(legR);

    // Shoulders
    const shoulderL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.18), this.bMat);
    shoulderL.position.set(-0.29, 1.1, 0);
    g.add(shoulderL);
    const shoulderR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.18), this.bMat);
    shoulderR.position.set(0.29, 1.1, 0);
    g.add(shoulderR);

    // Head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 8, 6),
      this.hMat,
    );
    head.position.y = 1.42;
    head.castShadow = true;
    g.add(head);

    // Hero-specific accent (visor/detail on head)
    const HERO_ACCENT_COLORS: Record<string, number> = {
      forge: 0xff6622, wraith: 0x9b59b6, seer: 0x5ab8f5,
      lifeline: 0x5af5a6, catalyst: 0xf55a5a,
    };
    const accentColor = HERO_ACCENT_COLORS[heroId] ?? 0xe8c547;
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.06, 0.2),
      new THREE.MeshStandardMaterial({
        color: accentColor, emissive: accentColor,
        emissiveIntensity: 0.6, roughness: 0.2, metalness: 0.5,
      }),
    );
    visor.position.set(0, 1.44, 0.08);
    g.add(visor);

    // Use torso as the body hit target (largest mesh for raycasting)
    torso.userData = { entity: this, isHead: false };
    head.userData = { entity: this, isHead: true };

    this.bodyM = torso;
    this.headM = head;
    this.mdl = g;

    scene.add(g);

    // Register meshes as collision targets
    Col.targets.push(this.bodyM, this.headM);
  }

  // ── Back-compat alias ────────────────────────────────────────
  /**
   * Alias for `inventory` — matches the v6 `Ent.inv` property name.
   * Allows existing call-sites (e.g. bot.ts) to use `entity.inv` unchanged.
   */
  get inv(): Inventory { return this.inventory; }

  // ── DamageableEntity interface aliases ───────────────────────
  // damage.ts uses the v6 shorthand field names; these getters/setters
  // bridge the expanded names to the shorthand so Entity satisfies
  // DamageableEntity structurally without an `any` cast.

  /** Alias for lastDamageTime — satisfies DamageableEntity.lastDT */
  get lastDT(): number { return this.lastDamageTime; }
  set lastDT(v: number) { this.lastDamageTime = v; }

  /** Alias for lastAttacker — satisfies DamageableEntity.lastAtk */
  get lastAtk(): Entity | null { return this.lastAttacker; }
  set lastAtk(v: Entity | null) { this.lastAttacker = v; }

  /** Alias for bleedTimer — satisfies DamageableEntity.bleedT */
  get bleedT(): number { return this.bleedTimer; }
  set bleedT(v: number) { this.bleedTimer = v; }

  // ── Computed getters ─────────────────────────────────────────

  /**
   * Returns the currently active weapon from the inventory, or null.
   * Mirrors v6 `Ent.aw` getter.
   */
  get activeWeapon(): Weapon | null {
    return this.inventory.activeWeapon;
  }

  /**
   * Returns the world-space eye position (used for raycast origins).
   * Mirrors v6 `Ent.eye` getter: `pos + (height * C.EY)` on the Y axis.
   */
  get eye(): THREE.Vector3 {
    return new THREE.Vector3(
      this.pos.x,
      this.pos.y + this.height * EYE_HEIGHT_FRAC,
      this.pos.z,
    );
  }

  /**
   * Returns the horizontal forward direction vector based on current yaw.
   * Mirrors v6 `Ent.fwd` getter: `(-sin(yaw), 0, -cos(yaw))`.
   */
  get fwd(): THREE.Vector3 {
    return new THREE.Vector3(
      -Math.sin(this.yaw),
      0,
      -Math.cos(this.yaw),
    ).normalize();
  }

  /**
   * Returns the horizontal speed (XZ plane magnitude of velocity).
   * Mirrors v6 `Ent.hSpd` getter: `sqrt(vx^2 + vz^2)`.
   */
  get hSpd(): number {
    return Math.sqrt(this.vel.x ** 2 + this.vel.z ** 2);
  }

  // ── Model sync ───────────────────────────────────────────────

  /**
   * Update the 3-D model transform and visibility to match the entity state.
   *
   * Matches v6 `Ent.syncMdl` exactly:
   * - Local player model is always hidden (first-person)
   * - Eliminated and dropping entities are hidden
   * - Downed entities are tilted 1.1 rad on the Z axis
   * - Revealed entities get a blue emissive highlight on the head material
   */
  syncModel(): void {
    if (this.isPlayer) {
      this.mdl.visible = false;
      return;
    }

    const wasVisible = this.mdl.visible;
    const shouldShow = this.life !== LifeState.ELIMINATED && !this.dropping;

    // Death animation: scale down and fade when transitioning to eliminated
    if (wasVisible && !shouldShow && this.life === LifeState.ELIMINATED) {
      // Start death shrink (handled over next few frames via _deathAnim)
      (this as any)._deathAnim = 1.0;
    }

    if ((this as any)._deathAnim > 0) {
      (this as any)._deathAnim -= 0.05;
      const s = Math.max(0, (this as any)._deathAnim);
      this.mdl.scale.setScalar(s);
      this.bMat.opacity = s;
      this.bMat.transparent = true;
      this.hMat.opacity = s;
      this.hMat.transparent = true;
      if (s <= 0) {
        this.mdl.visible = false;
        this.mdl.scale.setScalar(1);
        this.bMat.transparent = false;
        this.bMat.opacity = 1;
        this.hMat.transparent = false;
        this.hMat.opacity = 1;
        (this as any)._deathAnim = 0;
      }
    } else {
      this.mdl.visible = shouldShow;
      this.mdl.scale.setScalar(1);
    }

    this.mdl.position.copy(this.pos);
    this.mdl.rotation.y = this.yaw;

    // Downed: tilt and shrink slightly
    if (this.life === LifeState.DOWNED) {
      this.mdl.rotation.z = 1.1;
      this.mdl.scale.setScalar(0.85);
    } else if ((this as any)._deathAnim <= 0) {
      this.mdl.rotation.z = 0;
    }

    // Revealed highlight (Seer scan etc.)
    this.hMat.emissive.setHex(this._revealed ? 0x5ab8f5 : 0);
    this.hMat.emissiveIntensity = this._revealed ? 0.5 : 0;
  }

  // ── Combat ───────────────────────────────────────────────────

  /**
   * Apply damage to this entity.
   *
   * Delegates to `resolveDamage` from damage.ts which implements the exact
   * v6 `Ent.takeDmg` logic (shield drain → health drain → downed transition).
   *
   * @param amount - Raw damage amount (before headshot multiplier)
   * @param attacker - The attacking entity, or null for environmental damage
   * @param isHeadshot - Whether the hit was a headshot
   * @returns DamageResult or null if damage was not applied
   */
  takeDmg(
    amount: number,
    attacker: Entity | null,
    isHeadshot: boolean,
  ): DamageResult | null {
    // Entity satisfies DamageableEntity structurally via the lastDT/lastAtk/bleedT
    // getter aliases defined above.
    return resolveDamage(this as any, amount, attacker as any, isHeadshot);
  }

  /**
   * Transition the entity to the eliminated state.
   *
   * Matches v6 `Ent.eliminate` exactly:
   * - Sets life to ELIMINATED
   * - Hides the model
   * - Removes body and head meshes from the collision target list
   * - Emits 'kill' event with victim and killer
   */
  eliminate(): void {
    this.life = LifeState.ELIMINATED;
    this.mdl.visible = false;
    Col.targets = Col.targets.filter(m => m.userData['entity'] !== this);
    Ev.emit('kill', { victim: this, killer: this.lastAttacker });
  }

  /**
   * Revive this entity from the downed state.
   *
   * Matches v6 `Ent.revive` exactly:
   * - Restores life to ALIVE
   * - Full revive sets hp to MAX_HP; partial revive sets hp to 30
   * - Clears shield, revive tracking state, and banner
   * - Makes model visible and resets Z tilt
   * - Re-adds body/head to the collision target list if not already present
   * - Emits 'entity:revived' event
   *
   * @param full - If true, restore to full health; otherwise restore to 30 HP
   */
  revive(full: boolean = false): void {
    this.life = LifeState.ALIVE;
    this.hp = full ? COMBAT.MAX_HP : 30;
    this.sh = 0;
    this.beingRevived = false;
    this.reviveProgress = 0;
    this.reviver = null;
    this.banner = null;
    this.bannerHolder = null;
    this.mdl.visible = true;
    this.mdl.rotation.z = 0;
    if (!Col.targets.includes(this.bodyM)) {
      Col.targets.push(this.bodyM, this.headM);
    }
    Ev.emit('entity:revived', { entity: this });
  }

  /**
   * Advance downed-state timers by `dt` seconds.
   *
   * Matches v6 `Ent.tickDown` exactly:
   * - Does nothing unless life is DOWNED
   * - Counts down the bleed-out timer
   * - If being revived, advances reviveProgress (scaled by reviver ability mult)
   * - Triggers revive() when progress reaches 1
   * - Triggers eliminate() when bleed timer reaches 0
   *
   * Note: The ability-system revive-time multiplier (AbilSys.getRevTimeMult)
   * is not yet extracted; this implementation defaults the multiplier to 1
   * until abilities.ts is available.
   *
   * @param dt - Delta time in seconds
   */
  tickDowned(dt: number): void {
    if (this.life !== LifeState.DOWNED) return;
    this.bleedTimer -= dt;
    if (this.beingRevived) {
      // TODO: apply AbilSys.getRevTimeMult(this.reviver) when abilities.ts exists
      const mult = 1;
      this.reviveProgress += dt / (COMBAT.REVIVE_TIME * mult);
      if (this.reviveProgress >= 1) this.revive();
    }
    if (this.bleedTimer <= 0) this.eliminate();
  }

  /**
   * Advance shield regeneration by `dt` seconds at server time `time`.
   *
   * Matches v6 `Ent.tickSh` exactly:
   * - Does nothing unless life is ALIVE
   * - Regeneration only starts after SHIELD_REGEN_DELAY seconds without damage
   * - Regenerates at SHIELD_REGEN_RATE per second up to MAX_SHIELD
   *
   * @param dt - Delta time in seconds
   * @param time - Current server time in seconds (compared against lastDamageTime)
   */
  tickShield(dt: number, time: number): void {
    if (this.life !== LifeState.ALIVE) return;
    if (
      time - this.lastDamageTime >= COMBAT.SHIELD_REGEN_DELAY &&
      this.sh < COMBAT.MAX_SHIELD
    ) {
      this.sh = Math.min(this.sh + COMBAT.SHIELD_REGEN_RATE * dt, COMBAT.MAX_SHIELD);
    }
  }

  /**
   * Fully reset the entity for a new match round, spawning at `spawnPos`.
   *
   * Matches v6 `Ent.reset` exactly:
   * - Restores full HP, clears shield and all downed/revive state
   * - Teleports to spawn position, zeroes velocity
   * - Resets banner, dropping flag, drop altitude
   * - Creates a fresh Inventory and AbilState
   * - Clears reveal and slow-effect state
   * - Makes model visible and resets Z tilt
   * - Re-adds body/head to the collision target list if not already present
   *
   * @param spawnPos - World-space position to spawn at
   */
  reset(spawnPos: THREE.Vector3): void {
    this.life = LifeState.ALIVE;
    this.hp = COMBAT.MAX_HP;
    this.sh = 0;
    this.pos.copy(spawnPos);
    this.vel.set(0, 0, 0);
    this.bleedTimer = 0;
    this.beingRevived = false;
    this.reviveProgress = 0;
    this.banner = null;
    this.bannerHolder = null;
    this.dropping = true;
    this.dropY = 60; // v6 C.DROP_H
    this.onZip = false;
    this.inventory = new Inventory();
    this.abil = new AbilState(this.abil.hero);
    this._revealed = false;
    this._slowMult = 1;
    this.mdl.visible = true;
    this.mdl.rotation.z = 0;
    if (!Col.targets.includes(this.bodyM)) {
      Col.targets.push(this.bodyM, this.headM);
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   Re-exports for convenience
   ═══════════════════════════════════════════════════════════════ */

export { LifeState };
export type { LifeStateValue };
