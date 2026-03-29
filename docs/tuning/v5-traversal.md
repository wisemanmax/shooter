# Drop Zone Traversal Update — Systems & Tuning Guide

---

## New Systems

### Ziplines (M11: `Zipline` class)

Cables connecting two anchor points. Press **E** near an anchor to board. Ride at `ZIP_SPEED` (18 u/s) toward the opposite end. Jump (**Space**) to detach early with an exit velocity boost. Mouse look remains active while riding.

```
ZIP_SPEED: 18      ← ride speed (units/sec)
ZIP_ATTACH_DIST: 2.5 ← proximity to board
ZIP_EXIT_BOOST: 6    ← horizontal velocity on jump-off
```

**Placement**: `new Zipline(scene, pointA, pointB)` — the system renders the cable, anchor poles, and glowing endpoints automatically. Ziplines appear on the minimap as cyan lines.

**Reusability**: Ziplines work with any Entity. Bots can ride them (architecture ready, currently patrol-only). An ability system could call `zipline.attach(entity, 0)` to create ability-driven zip traversal.

### Jump Pads (M11: `JumpPad` class)

Circular trigger pads that launch entities upward on contact. Configurable with an optional directional push vector.

```
PAD_FORCE_V: 16     ← vertical launch velocity
PAD_FORCE_H: 8      ← horizontal push (directional pads)
PAD_RADIUS: 1.2     ← trigger area radius
```

**Placement**: `new JumpPad(scene, position, optionalForwardDir)` — passing `null` for direction creates a vertical-only pad. Passing a normalized `Vector3` adds horizontal push in that direction. The pad renders a glowing disc, ring, and pulsing point light.

**Cooldown**: 0.5-0.6s per entity to prevent re-triggering on landing.

### Interactive Doors (M12: `Door` class)

Press **F** to toggle open/closed. When closed, the door mesh is part of the collision system. When opened, it's removed from collision, allowing passage. Opening a door affects all entities equally.

```
DOOR_INTERACT: 2.5   ← max interaction distance
```

**Placement**: `new Door(scene, position, width, height, axis)` — `axis` is `'z'` or `'x'` determining which wall plane the door occupies. Door frames are rendered automatically. The door calls `Col.rebuild()` on toggle to update the AABB cache.

**Architecture note**: Doors modify the shared `Col.w` and `Col.g` arrays directly, then rebuild. This means all pathfinding and LOS checks immediately reflect the new state.

### Loot Bins (M13: `LootBin` class)

Openable containers placed at POIs. Press **E** to open — the lid animates up and all items transfer to your inventory. Each bin generates 1-3 items from the standard loot table on map creation.

```
BIN_INTERACT: 2      ← interaction distance
```

Bins have a pulsing blue glow when closed, which turns off once opened. Unlike ground loot nodes (which despawn), bins stay open as visual markers.

### Callout Zones (M15: `CalloutZone` class)

Named map regions defined as axis-aligned bounding boxes. The current zone name displays faintly above the speed bar. Zones appear in the debug overlay.

**Current zones**: The Spire, North Bunker, Cargo Yard, West Ruins, South Ridge, East Overlook, Vault Alley, Launchpad Field, and "Open Ground" as fallback.

**Adding a zone**: `ZONES.push(new CalloutZone('Name', minX, minZ, maxX, maxZ))`

---

## Map Layout (200×200, 8 named POIs)

```
                    NORTH BUNKER
                    (enclosed, 2 doors)
                         │
    WEST RUINS ──────── THE SPIRE ──────── CARGO YARD
    (2 buildings,        (3-tier            (stacked crates,
     zipline link)        tower,             elevated platform)
                          zips to E+N)
                         │
    VAULT ALLEY     LAUNCHPAD FIELD      EAST OVERLOOK
    (narrow corridor,  (jump pads,       (elevated sniper
     2 doors)           open area)        platform, zip down)
                         │
                    SOUTH RIDGE
                    (long ramp, jump
                     pad on top)
```

**Traversal network**:
- Spire top → Cargo Yard (zipline, drops from 8.5 to 2)
- Spire top → North Bunker approach (zipline, drops from 8.5 to 1)
- Cargo Yard triple-stack → platform (zipline, short horizontal)
- West Ruins Building A roof → Building B (zipline, rises slightly)
- East Overlook → South area (zipline, drops from 5.5 to 1)
- Spire base (jump pad, directional east push)
- South Ridge top (jump pad, launches back toward center)
- Launchpad Field (2 jump pads, one vertical, one directional)

**Sightline design**: The Spire provides 360° vision from the top but is exposed. East Overlook has a front railing for cover but limited retreat. North Bunker is enclosed with pillar-broken interior sightlines and two entry doors that can be closed. Vault Alley is a chokepoint with doors at both ends.

---

## Architecture Map (22 Modules)

```
M1:  C .................. Config (movement, combat, traversal, ring)
M2:  Ev ................. Event bus
M3:  AMMO/RARITY/WD ..... Ammo types, rarity tiers, 6 weapons
M4:  I .................. Input (now includes F for doors)
M5:  Col ................ Collision (rebuild on door toggle)
M6:  Wep ................ Weapon state
M7:  LT ................. Loot tables + generation
M8:  Inv ................ Inventory (weapons, ammo, consumables)
M9:  Ent ................ Entity (+ onZip, zipLine, zipT traversal state)
M10: tickPM ............. Player movement (skips when onZip)
M11: Zipline + JumpPad .. ★ NEW — Reusable traversal tools
M12: Door ............... ★ NEW — Toggle open/closed, modifies collision
M13: LootBin ............ ★ NEW — Openable containers with loot
M14: LootNode ........... Ground loot pickups
M15: CalloutZone ........ ★ NEW — Named map regions
M16: Ring ............... Shrinking circle (4 stages)
M17: DBox + RBeacon ..... Death boxes + respawn beacons
M18: Match .............. Match flow (LOBBY → DROP → PLAY → END)
M19: tickBot ............ Bot AI (ring-aware, uses jump pads)
M20: World .............. ★ REBUILT — 8 POIs with traversal integration
M21: Dmg + KF + MM + Bnr. Damage numbers, kill feed, minimap, banners
M22: Main ............... Game loop with all system integration
```

---

## Traversal Reusability for Abilities

The `Zipline` and `JumpPad` classes are entity-agnostic. Any system can call them:

```js
// Ability-triggered zipline (e.g., Pathfinder grapple)
const tempZip = new Zipline(scene, entity.pos, targetPos);
tempZip.attach(entity, 0);

// Ability-triggered launch (e.g., Octane pad)
const tempPad = new JumpPad(scene, entity.pos);
tempPad.checkLaunch(entity);
```

The `Door.toggle()` method could be called by abilities that breach walls. `Col.rebuild()` handles the collision state change automatically.

---

## Controls

| Key | Action |
|---|---|
| WASD | Move |
| Shift | Sprint |
| Ctrl | Slide |
| Space | Jump / Detach from zipline |
| LMB | Fire |
| R | Reload |
| 1-2 / Scroll | Swap weapons |
| 3-6 | Use consumables |
| E | Interact (loot, revive, banner, beacon, zipline) |
| F | Toggle door |
