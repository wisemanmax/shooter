/**
 * Damage resolution utilities — extracted from v6 Entity.takeDmg() (line 497)
 * and consumable definitions from CONS (line 479).
 *
 * Resolves damage against shield+health, emits events, and handles
 * the downed state transition.
 */

import { Ev } from '../utils/events';

/* ═══════════════════════════════════════════════════════════════
   Types — minimal entity interface to avoid circular imports.
   These match the fields used by takeDmg in v6.
   ═══════════════════════════════════════════════════════════════ */

/** Life state enum — mirrors v6 `Life` */
export const LifeState = { ALIVE: 0, DOWNED: 1, ELIMINATED: 2 } as const;
export type LifeStateValue = (typeof LifeState)[keyof typeof LifeState];

/**
 * Minimal entity shape required by the damage system.
 * The full Entity class (in entities/entity.ts) should satisfy this interface.
 */
export interface DamageableEntity {
  life: LifeStateValue;
  hp: number;
  sh: number;
  dropping: boolean;
  lastDT: number;
  lastAtk: DamageableEntity | null;
  bleedT: number;
  vel: { set(x: number, y: number, z: number): void };
  banner: string | null;
  onZip: boolean;
  abil?: { hero: { tactical: { id: string } }; tac: { active: boolean; data: Record<string, any> } };
}

/* ═══════════════════════════════════════════════════════════════
   Config constants used by damage resolution (from v6 C object)
   ═══════════════════════════════════════════════════════════════ */

/** Headshot damage multiplier — v6 C.HSM = 2 */
const HEADSHOT_MULT = 2;

/** Bleedout timer in seconds — v6 C.BLEED = 30 */
const BLEED_TIME = 30;

/* ═══════════════════════════════════════════════════════════════
   Damage Result
   ═══════════════════════════════════════════════════════════════ */

/** Result of a damage resolution */
export interface DamageResult {
  /** Damage absorbed by shield */
  shieldDamage: number;
  /** Damage applied to health */
  healthDamage: number;
  /** Whether the shield was broken (went to 0) */
  shieldBroken: boolean;
}

/* ═══════════════════════════════════════════════════════════════
   Invulnerability Check
   ═══════════════════════════════════════════════════════════════ */

/**
 * Check if an entity is invulnerable (e.g. Wraith phase walk).
 * Mirrors v6 AbilSys.isInvuln logic (line 461-463).
 */
function isInvulnerable(entity: DamageableEntity): boolean {
  return !!(
    entity.abil?.tac.active &&
    entity.abil.hero.tactical.id === 'phase'
  );
}

/* ═══════════════════════════════════════════════════════════════
   Damage Resolution
   ═══════════════════════════════════════════════════════════════ */

/**
 * Resolve damage against an entity's shield and health.
 *
 * Matches v6 `Ent.takeDmg` exactly:
 * 1. Check life state — must be ALIVE and not dropping
 * 2. Check invulnerability (phase walk)
 * 3. Apply headshot multiplier if applicable
 * 4. Drain shield first, then health
 * 5. Emit 'entity:damaged' event
 * 6. If hp <= 0, transition to DOWNED and emit 'entity:downed'
 *
 * @param target - The entity taking damage
 * @param amount - Raw damage amount (before headshot mult)
 * @param attacker - The attacking entity, or null for environmental damage
 * @param isHeadshot - Whether the hit was a headshot
 * @returns DamageResult, or null if damage was not applied
 */
export function resolveDamage(
  target: DamageableEntity,
  amount: number,
  attacker: DamageableEntity | null,
  isHeadshot: boolean
): DamageResult | null {
  // Must be alive and not in drop phase
  if (target.life !== LifeState.ALIVE || target.dropping) return null;

  // Invulnerability check (e.g. Wraith phase)
  if (isInvulnerable(target)) return null;

  // Apply headshot multiplier
  const totalDamage = isHeadshot ? amount * HEADSHOT_MULT : amount;

  // Drain shield first
  let shieldDamage = 0;
  let shieldBroken = false;
  if (target.sh > 0) {
    shieldDamage = Math.min(totalDamage, target.sh);
    target.sh -= shieldDamage;
    if (target.sh <= 0) shieldBroken = true;
  }

  // Remaining damage to health
  let healthDamage = 0;
  const remaining = totalDamage - shieldDamage;
  if (remaining > 0) {
    healthDamage = Math.min(remaining, target.hp);
    target.hp -= healthDamage;
  }

  // Track last damage time and attacker
  target.lastDT = performance.now() / 1000;
  target.lastAtk = attacker;

  // Downed transition
  if (target.hp <= 0) {
    target.life = LifeState.DOWNED;
    target.bleedT = BLEED_TIME;
    target.vel.set(0, 0, 0);
    target.banner = 'available';
    target.onZip = false;
    Ev.emit('entity:downed', { entity: target });
  }

  // Emit damage event
  Ev.emit('entity:damaged', {
    entity: target,
    damage: totalDamage,
    attacker,
    isHead: isHeadshot,
    sd: shieldDamage,
    hd: healthDamage,
    sb: shieldBroken,
  });

  return { shieldDamage, healthDamage, shieldBroken };
}

/* ═══════════════════════════════════════════════════════════════
   Consumable Definitions
   ═══════════════════════════════════════════════════════════════ */

/** Consumable item definition */
export interface ConsumableDef {
  /** Internal identifier */
  id: string;
  /** Display name */
  name: string;
  /** Emoji icon for HUD display */
  icon: string;
  /** Which stat this consumable restores */
  effect: 'hp' | 'sh';
  /** Amount restored */
  amount: number;
}

/** All consumable definitions — matches v6 CONS object (line 479) */
export const CONSUMABLES: Record<string, ConsumableDef> = {
  syringe: { id: 'syringe', name: 'Syringe',      icon: '💉', effect: 'hp', amount: 25  },
  medkit:  { id: 'medkit',  name: 'Med Kit',       icon: '🏥', effect: 'hp', amount: 100 },
  cell:    { id: 'cell',    name: 'Shield Cell',   icon: '🔋', effect: 'sh', amount: 25  },
  battery: { id: 'battery', name: 'Battery',        icon: '⚡', effect: 'sh', amount: 100 },
};
