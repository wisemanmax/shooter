# Drop Zone — Battle Royale Systems & Tuning Guide

All constants live in the `C` config object. Weapon data in `WDEF`, rarity modifiers in `RARITY`, ammo types in `AMMO`, consumables in `CONSUMABLES`, loot tables in `LOOT`.

---

## Architecture (20 Modules)

```
M1:  C .................. Config constants
M2:  Ev ................. Event bus (pub/sub)
M3:  AMMO/RARITY/WDEF ... Ammo types, rarity tiers, 6 weapon archetypes
M4:  I (Input) .......... All bindings including consumable keys
M5:  Col ................ Collision, raycasting, line-of-sight
M6:  Wep ................ Per-weapon state (ammo, bloom, recoil, reload)
M7:  LOOT ............... Loot tables, rarity weights, node generation
M8:  Inventory .......... 2 weapon slots, ammo counts, consumables
M9:  Entity ............. Shared player/bot state, lifecycle FSM, banner system
M10: tickPM ............. Player movement physics
M11: tickBot ............ Bot AI (ring-aware, revive, loot)
M12: Ring ............... Shrinking circle with staged timings + damage
M13: LootNode ........... World-placed loot pickups with rarity visuals
M14: DeathBox ........... Dropped on elimination, contains recovery banner
M15: RespawnBeacon ...... Fixed stations for teammate respawn
M16: Match .............. Match flow state machine
M17: World .............. Map geometry with 5 POIs
M18: Dmg ................ Floating damage numbers + kill feed
M19: drawMinimap ........ Real-time minimap with ring overlay
M20: Main ............... Init, viewmodel, tracers, game loop, full HUD
```

---

## Match Flow State Machine

```
LOBBY ──(click)──→ DROP ──(all landed)──→ PLAY ──(1 squad left)──→ END
                    │                      │
              entities fall from           ring ticks,
              DROP_H at DROP_SPD           damage + combat active
```

- **LOBBY**: Title screen. Click starts match.
- **DROP**: All 15 entities free-fall from height 60. Player gets a P2020 on landing. Bots auto-equip random loadouts.
- **PLAY**: Full gameplay — ring shrinks, combat active, loot available.
- **END**: Victory (your squad last standing) or Defeated. Shows banner indefinitely.

---

## Ring System (4 Stages)

| Stage | Delay | Shrink Time | End Radius | DPS Outside |
|---|---|---|---|---|
| 1 | 45s | 30s | 70% of map | 1/s |
| 2 | 30s | 25s | 45% | 3/s |
| 3 | 20s | 20s | 22% | 8/s |
| 4 | 15s | 15s | 5% | 15/s |

The ring center shifts slightly each stage (within 20% of current radius). Map radius is `C.MAP_R` (95 units).

Each stage has a **delay** phase (ring boundary displayed, no damage increase) followed by a **shrink** phase where the ring moves to its target radius. The orange ring vignette appears when the player is outside the safe zone.

The visual ring is a semi-transparent cylinder mesh that scales with `currentR`. A white preview ring shows the next target.

**Tuning**: Edit `C.RING` array entries. Add more stages by appending objects. Adjust `C.MAP_R` to change the total playable area.

---

## Loot System

### Rarity Tiers

| Tier | Damage Mult | Mag Bonus | Spawn Weight | Border Color |
|---|---|---|---|---|
| Common | 1.0x | +0% | 55% | Gray |
| Rare | 1.08x | +16% | 28% | Blue |
| Epic | 1.15x | +30% | 12% | Purple |
| Legendary | 1.22x | +44% | 5% | Gold |

`applyRarity(baseDef, rarity)` returns a modified weapon definition with scaled damage and magazine size.

### Loot Node Generation

Each of the 60 loot nodes spawns 1-3 items from weighted categories:

| Category | Weight | Contents |
|---|---|---|
| Weapon | 30% | Random weapon + rarity roll |
| Ammo | 35% | Random ammo type, quantity varies |
| Consumable | 35% | Syringe, Med Kit, Shield Cell, or Battery |

**Tuning**: Edit `LOOT.rarityWeights`, `LOOT.categories`, `LOOT.ammoPerDrop`, `LOOT.consumablePool`.

### Ammo Types

| Type | Color | Used By |
|---|---|---|
| Light | Gold | R-301, R-99, P2020 |
| Heavy | Green | G7 Scout |
| Energy | Cyan | Devotion |
| Shells | Red | EVA-8 |

Ammo is shared across weapons of the same type. Picking up a weapon grants one magazine worth of its ammo type.

---

## Inventory System

Each entity has:
- **2 weapon slots** (swap with 1/2/scroll)
- **Ammo pool** (per type, shared across weapons)
- **Consumable bag** (syringes, medkits, cells, batteries)

### Consumables

| Key | Item | Use Time | Effect |
|---|---|---|---|
| 3 | Syringe | 5s | +25 HP |
| 4 | Med Kit | 8s | +100 HP (full) |
| 5 | Shield Cell | 3s | +25 Shield |
| 6 | Shield Battery | 5s | +100 Shield (full) |

*Note: In this prototype, consumables apply instantly on key press for responsiveness. The `useTime` field is included for future animated-use implementation.*

### Reload Flow

Reload deducts ammo from inventory immediately and adds it to the magazine on completion. If the player cancels (swaps weapons), the pending ammo is lost.

---

## Downed / Banner / Respawn Flow

```
ALIVE ──(HP=0)──→ DOWNED ──(bleed-out 30s)──→ ELIMINATED
                     │                            │
                     ├──(teammate holds E)──→ REVIVED (30 HP)
                     │                            
                     └── drops banner ─── teammate grabs from death box
                                              │
                                              └── brings to Respawn Beacon
                                                       │
                                                       └── RESPAWNED (full HP)
```

**Death Boxes**: Created at the elimination point. Contain recovery banner (green glow). Teammate approaches and presses E to grab.

**Respawn Beacons**: 4 fixed locations on the map. Single-use. Holding a teammate's banner near a beacon + pressing E respawns them at full HP with empty inventory.

---

## Bot AI

5 squads of 3 bots (including the player's squad). Bot decision tree:

```
Is outside ring? ──→ Sprint toward ring center
Has downed ally nearby (< 15u)? ──→ Move to ally, start revive
Enemy within 35u + LOS? ──→ Engage (shoot, strafe)
Otherwise ──→ Patrol (wander within ring)
```

Key variables: `C.BFC` (fire cooldown 0.35s), `C.BAC` (accuracy 0.4), `C.BER` (engage range 35u), `C.BRP` (revive priority distance 15u).

Bots auto-equip random weapons on landing with full ammo. They reload instantly (simplified).

---

## Weapons (6 Archetypes)

| ID | Name | Ammo | Mode | Body | Head | RPM | Mag |
|---|---|---|---|---|---|---|---|
| `ar` | R-301 | Light | Auto | 18 | 36 | 660 | 28 |
| `smg` | R-99 | Light | Auto | 12 | 18 | 1080 | 20 |
| `sg` | EVA-8 | Shells | Semi | 11×8 | 16×8 | 120 | 8 |
| `mk` | G7 Scout | Heavy | Semi | 36 | 72 | 210 | 10 |
| `ps` | P2020 | Light | Semi | 21 | 32 | 390 | 14 |
| `lmg` | Devotion | Energy | Auto | 16 | 28 | 780 | 36 |

All stats shown at Common rarity. Higher rarities scale damage and magazine size.

### Adding a Weapon

```js
WDEF.newgun = {
  id:'newgun', name:'Havoc', ammo:'energy', mode:'auto',
  dmg:{b:20,h:38}, rate:10, mag:24, rld:2.0,
  spr:{base:.4,bloom:.15,max:3,rec:4}, rec:{v:1,h:.3,r:5},
  rng:100, pel:1,
  vm:{w:.06,h:.06,d:.48,c:0x665577}
};
```

Then add `'newgun'` to `LOOT.weaponPool`.

---

## Map Layout (200×200 units)

Five Points of Interest:
1. **Central Tower** (0,0) — 3-tier structure with ramps, cover walls
2. **North Compound** (0,-55) — Enclosed building with roof, pillars
3. **East Crate Yard** (50,0) — Stacked containers, elevation variety
4. **West Ruins** (-55,0) — Partial walls, two connected structures
5. **South Ridge** (0,55) — Long ramp to elevated platform with cover

20 scattered cover walls across the map. No hard boundary walls — the ring handles map boundaries.

---

## HUD Elements

- **Top-left**: Squad roster (name, HP/shield bars, alive/downed/eliminated status)
- **Top-center**: Squads alive count + ring timer
- **Top-right**: Minimap (140×140 canvas) showing ring, players, teammates
- **Bottom-left**: Health + shield bars
- **Bottom-center**: Inventory bar (2 weapon slots + 4 consumable slots with key hints)
- **Bottom-right**: Active weapon name + ammo count + ammo pool by type
- **Center**: Interact prompts, revive progress bar, downed overlay

---

## Future Expansion

**Attachments**: Add `attachments` array to weapon definitions. Spawn attachment loot nodes. Apply modifiers in `Wep.tick()` and `Wep.fire()`.

**More squads**: Increase the squad loop in main init. Map supports 20+ entities comfortably.

**Multiplayer**: `Entity` state is serializable: `pos`, `vel`, `life`, `hp`, `sh`, `inv.ammo`, `inv.weapons[n].ammo`. Ring state is deterministic from stage + timer. Use snapshot interpolation over WebSocket.

**Armor tiers**: Replace flat `MAX_SH` with tiered armor (white/blue/purple/gold) that sets shield ceiling + damage reduction.

**Care packages**: Spawn a `LootNode` mid-match at a random location with guaranteed legendary loot. Announce via `showBanner()`.
