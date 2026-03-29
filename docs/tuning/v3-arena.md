# Arena Ops — Systems & Tuning Guide

All variables live in the `C` config object at the top of the script module. Weapon data lives in `WEAP`, hero definitions in `HEROES`.

---

## Architecture Overview

```
<script type="module">
├── M1:  C (Config).............. All tuning constants
├── M2:  Ev (Event Bus).......... Decoupled pub/sub for all game events
├── M3:  WEAP (Weapons).......... 5 weapon archetypes (data objects)
├── M4:  Inp (Input)............. Keyboard, mouse, ping/ability bindings
├── M5:  Col (Collision)......... Raycasting, AABB, line-of-sight checks
├── M6:  WepState (Weapon State). Per-instance ammo, bloom, recoil, reload
├── M7:  HEROES (Hero Defs)...... 3 hero classes with tactical abilities
├── M8:  Entity.................. Shared state for player + bots (lifecycle FSM)
├── M9:  tickPlayerMovement...... Full movement physics (from v1/v2)
├── M10: tickBot (Bot AI)........ State machine: PATROL → ENGAGE → REVIVE
├── M11: activateAbility......... Resolves ability activation per hero class
├── M12: Pings................... World-space ping markers with 4 types
├── M13: Round (Round Manager)... Score, squad wipe, round lifecycle FSM
├── M14: Spectator............... Camera follows teammates after elimination
├── M15: World................... Arena geometry and lighting
├── M16: DmgN (Damage Numbers).. Floating screen-projected numbers
├── M17: HUD..................... All UI updates
└── M18: Main.................... Init, viewmodel, tracers, game loop
```

---

## State Machines

### Entity Lifecycle (per round)

```
ALIVE ──→ DOWNED ──→ ELIMINATED
  │          │
  │          ├── (revived) → ALIVE (30 HP, 0 shield)
  │          └── (bleed-out expires) → ELIMINATED
  │
  └── takeDamage() when HP reaches 0
```

Key variables: `C.BLEED_TIME` (30s), `C.REVIVE_TIME` (5s base), `C.REVIVE_SUPPORT` (3s for Support class).

### Round Lifecycle

```
CLASS_SELECT → COUNTDOWN → ACTIVE → ROUND_END → (loop or MATCH_END)
                  3s          ↑         4s
                              │
                    squad wipe detected
```

Squad wipe = all 3 members of a team are DOWNED or ELIMINATED simultaneously. If at least one enemy is still ALIVE, that team wins the round.

Key variables: `C.ROUND_COUNTDOWN` (3s), `C.ROUND_END_DELAY` (4s), `C.ROUNDS_TO_WIN` (3).

### Bot AI States

```
PATROL ──→ ENGAGE (enemy within 35u + LOS)
  │   ←── (enemy lost / dead)
  │
  └──→ REVIVE (downed ally within 15u, no immediate threat)
```

Key variables: `C.BOT_ENGAGE_RANGE` (35u), `C.BOT_REVIVE_PRIORITY` (15u), `C.BOT_ACCURACY` (0.45), `C.BOT_FIRE_CD` (0.3s).

---

## Event System

The `Ev` bus decouples all systems. Any module can subscribe to or emit events without direct references to other modules.

| Event | Payload | Emitted by |
|---|---|---|
| `entity:damaged` | `{entity, damage, attacker, isHead, shieldDmg, healthDmg, shieldBroken}` | Entity.takeDamage |
| `entity:downed` | `{entity}` | Entity._enterDowned |
| `entity:eliminated` | `{entity, killer}` | Entity.eliminate |
| `entity:revived` | `{entity, reviver}` | Entity.revive |
| `kill` | `{victim, killer}` | Entity.eliminate |
| `round:start` | `{round}` | Round.startCountdown |
| `round:end` | `{winner, round}` | Round._endRound |
| `match:end` | `{winner}` | Round.tick |
| `ping:placed` | `{type, position, placer}` | Pings.place |
| `ability:used` | `{entity, abilityId}` | activateAbility |

To add new behavior on any event: `Ev.on('kill', data => { /* your logic */ })`.

---

## Hero Classes

### Recon
- **Passive**: Scanned enemies glow through geometry (visual highlight)
- **Tactical (Q)**: Scan — reveals all enemies for 4s, 25s cooldown
- **Start weapons**: R-301 + P2020

### Skirmisher
- **Passive**: +20% slide boost multiplier
- **Tactical (Q)**: Phase Dash — burst of speed (28 u/s) in look direction for 0.2s with invulnerability, 12s cooldown
- **Start weapons**: R-99 + P2020

### Support
- **Passive**: Revive time reduced to 3s (from 5s base)
- **Tactical (Q)**: Heal Pulse — heals all allies within 12u for 60 HP, 20s cooldown
- **Start weapons**: R-301 + EVA-8

### Adding a New Hero

```js
HEROES.sentinel = {
  id: 'sentinel',
  name: 'Sentinel',
  icon: '🛡',
  color: 0xaa66cc,
  passive: 'Description of passive',
  tactical: { id: 'barrier', name: 'Energy Barrier', cooldown: 18, icon: '🛡' },
  startWeapons: ['mk', 'ps'],
};
```

Then add a `case 'barrier':` block in `activateAbility()`.

---

## Ping System

| Key | Ping Type | Color | Use Case |
|---|---|---|---|
| Z | Move | Blue | Rally point, suggest rotation |
| X | Enemy | Red | Mark enemy position |
| V | Danger | Orange | Warn of threats |
| B | Loot | Green | Highlight items |

Pings raycast from camera center to the first wall hit (or 30u forward if nothing hit), spawn a 3D-projected marker that shows distance and auto-expires after `C.PING_DURATION` (6s).

---

## Downed & Revive

When an entity's HP reaches 0, they enter DOWNED state instead of dying instantly. In DOWNED state:

- Entity cannot move, shoot, or use abilities
- A bleed-out timer counts down from `C.BLEED_TIME` (30s)
- If timer reaches 0 → ELIMINATED (out for the round)
- Teammates can revive by holding E within `C.REVIVE_DIST` (2.5u)
- Revive takes `C.REVIVE_TIME` (5s), or `C.REVIVE_SUPPORT` (3s) for Support class
- Revived entity returns to ALIVE with 30 HP, 0 shield
- Interrupting the revive (releasing E or moving away) resets progress

---

## Spectator Camera

When the player is eliminated:
- Camera automatically follows the nearest alive teammate
- Press 1/2 or LMB to cycle between surviving teammates
- If all teammates are eliminated, the camera holds its last position
- Spectator mode exits automatically when a new round starts

---

## Tuning: Combat Balance

| Variable | Default | Notes |
|---|---|---|
| `MAX_HP` | 100 | Base health |
| `MAX_SH` | 100 | Shield (absorbs damage first) |
| `SH_REGEN_DLY` | 5s | Delay before shield starts regenerating |
| `SH_REGEN_RT` | 15/s | Shield regen rate |
| `HS_MULT` | 2.0 | Headshot damage multiplier |
| `BLEED_TIME` | 30s | Time before downed → eliminated |
| `REVIVE_TIME` | 5s | Base revive duration |
| `REVIVE_SUPPORT` | 3s | Support class revive duration |
| `HEAL_AMOUNT` | 60 | Support heal pulse amount |
| `HEAL_RADIUS` | 12u | Support heal radius |
| `SCAN_DURATION` | 4s | Recon scan reveal time |
| `DASH_SPEED` | 28 u/s | Skirmisher dash velocity |
| `DASH_INVULN` | true | Invulnerable during dash |

---

## Future Extensibility

**Loot rarity**: Each weapon in `WEAP` can receive a `rarity` field. Apply stat multipliers in `WepState.constructor()` based on rarity tier.

**Attachments**: Add an `attachments` array to `WepState`. In `tick()` and `fire()`, apply attachment modifiers to spread, recoil, mag size, etc.

**Multiplayer**: The `Entity` class is designed as a serializable state container. For netcode, snapshot and sync: `entity.pos`, `entity.vel`, `entity.life`, `entity.hp`, `entity.sh`, `entity.wep[n].ammo`, `entity.abilCd`. The `Ev` event bus can be extended to broadcast events over a WebSocket channel.

**New abilities**: Add a case to `activateAbility()`. The function receives the entity and full entity list, so any team-based or area-based effect is straightforward.

**More hero classes**: Copy a `HEROES` entry, assign unique `tactical.id`, implement the activation logic. The class select screen auto-renders from `HEROES` entries (currently hardcoded to 3 cards — extend the HTML or generate dynamically).
