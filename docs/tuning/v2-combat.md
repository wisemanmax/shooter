# Combat Sandbox — Tuning Guide

All variables live in the `CFG` object and `WEAPONS` dictionary at the top of the `<script type="module">` block.

---

## Weapon Archetypes

Each weapon is a data object in `WEAPONS`. Add new weapons by copying an existing entry and changing values. The `WeaponManager` and firing loop are archetype-agnostic — they read from whatever `def` is in the active slot.

| Weapon | Name | Body DMG | Head DMG | RPM | Mag | Reload | Spread | Pellets |
|---|---|---|---|---|---|---|---|---|
| `assault_rifle` | R-301 | 18 | 36 | 660 | 28 | 1.8s | Low bloom | 1 |
| `smg` | R-99 | 12 | 18 | 1080 | 20 | 1.4s | Med bloom | 1 |
| `shotgun` | EVA-8 | 11 | 16 | 120 | 8 | 2.6s | Wide cone | 8 |
| `marksman` | G7 Scout | 36 | 72 | 210 | 10 | 2.4s | Tight, blooms on spam | 1 |
| `pistol` | P2020 | 21 | 32 | 390 | 14 | 1.1s | Low | 1 |

### Per-Weapon Tuning

Inside each `WEAPONS[id]` object:

```
damage:   { body, head }     ← raw damage numbers
fireRate: N                  ← rounds per second (RPM ÷ 60)
magSize:  N                  ← rounds per magazine
reserveMax: N                ← max reserve ammo
reloadTime: N                ← seconds to reload

spread: {
  base: N,       ← minimum spread (degrees) — always present
  bloom: N,      ← spread added per shot
  max: N,        ← ceiling for total spread (base + bloom)
  recovery: N,   ← degrees/sec bloom decays when not firing
}

recoil: {
  vertical: N,   ← pitch kick per shot (higher = more climb)
  horizontal: N, ← random yaw jitter range per shot
  recovery: N,   ← how fast recoil returns to center
}

range: N         ← max hitscan distance (units)
pellets: N       ← projectiles per shot (8 for shotgun)
```

### Adding a New Weapon

```js
WEAPONS.my_lmg = {
  id: 'my_lmg', name: 'Devotion', category: 'primary',
  fireMode: 'auto',
  damage: { body: 15, head: 22 },
  fireRate: 14, magSize: 44, reserveMax: 200, reloadTime: 2.8,
  spread: { base: 0.8, bloom: 0.08, max: 3.0, recovery: 3.5 },
  recoil: { vertical: 0.6, horizontal: 0.35, recovery: 5.0 },
  range: 100, pellets: 1,
  vm: { w:0.08, h:0.08, d:0.55, color:0x556655 },
  rarity: 'common',
  attachmentSlots: ['barrel','magazine','optic','stock'],
};
```

Then add a pickup: `new Pickup(scene, 'weapon', new THREE.Vector3(x,y,z), 'my_lmg')`

---

## Spread & Bloom System

Spread is measured in degrees. The total cone angle at any moment is `base + currentBloom`.

**Bloom lifecycle:**
1. Each shot adds `bloom` to the accumulator
2. Accumulator is capped at `max - base`
3. When not firing, bloom decays at `recovery` degrees/second
4. The crosshair arms visually expand/contract with bloom

**Tuning tips:**
- High `base` + zero `bloom` = consistent spread (shotgun model)
- Low `base` + high `bloom` = reward for burst-firing (AR/SMG model)
- High `recovery` = bloom resets fast between bursts (skill-rewarding)
- The crosshair gap is `6 + bloom * 4` pixels — adjust the `4` multiplier in HUD.update for feel

---

## Recoil System

Recoil is applied as camera pitch/yaw kick per shot, with automatic recovery.

- `vertical`: pitch added per shot (degrees equivalent — multiplied by 0.015 in the firing loop)
- `horizontal`: random yaw range per shot (multiplied by 0.008)
- `recovery`: how fast accumulated recoil decays (degrees/sec)

**Tuning tips:**
- High vertical + low horizontal = learnable pattern (marksman feel)
- Low vertical + high horizontal = chaotic spray (SMG feel)
- Recovery speed determines how much sustained fire punishes aim
- Scale the `0.015` / `0.008` multipliers in the firing section of the game loop for global recoil intensity

---

## Combat Variables

```
MAX_HEALTH: 100          ← hit points
MAX_SHIELD: 100          ← absorbs damage before health
SHIELD_REGEN_DELAY: 5.0  ← seconds after last damage before regen starts
SHIELD_REGEN_RATE: 15    ← shield/sec during regen
HEADSHOT_MULT: 2.0       ← damage multiplier for head hits
```

**Shield break** triggers a blue screen vignette + health bar shake when shield drops to 0. Controlled by `HUD.showShieldBreak()`.

---

## AI Dummies

```
DUMMY_FIRE_INTERVAL: 2.5  ← seconds between shots (± random variance)
DUMMY_DAMAGE: 8           ← damage per hit to player
DUMMY_ACCURACY: 0.6       ← probability each shot lands (0-1)
DUMMY_RESPAWN: 6.0        ← seconds to respawn after elimination
```

Each dummy has 50 shield + 100 health. Adjust in `AIDummy.constructor()` and `_respawn()`.

---

## Pickups

- **Weapon pickups**: Press E to swap with your current weapon
- **Ammo**: Press E — adds 60 rounds to active weapon's reserve
- **Shield Cell**: Press E — restores 50 shield
- **Health Kit**: Press E — restores 50 health

Respawn delay is `pickup.respawnDelay` (default 12 seconds). Pickup interaction range is `CFG.PICKUP_RADIUS` (2.0 units for prompt) and `CFG.PICKUP_INTERACT_DIST` (2.5 units for interaction).

---

## Future-Proofing: Rarity & Attachments

Each weapon definition includes placeholder fields:

```js
rarity: 'common',    // common | rare | epic | legendary
attachmentSlots: ['barrel', 'magazine', 'optic', 'stock'],
```

**Planned extension pattern:**

```js
// Rarity modifiers (apply as multipliers to base stats)
const RARITY_MODS = {
  common:    { damage: 1.0, magSize: 1.0, reloadTime: 1.0 },
  rare:      { damage: 1.05, magSize: 1.1, reloadTime: 0.95 },
  epic:      { damage: 1.1, magSize: 1.2, reloadTime: 0.9 },
  legendary: { damage: 1.15, magSize: 1.3, reloadTime: 0.85 },
};

// Attachment effects (modify weapon state on equip)
const ATTACHMENTS = {
  barrel_stabilizer:  { recoil: { vertical: 0.7 } },    // 30% less vertical recoil
  extended_mag:       { magSize: 1.5 },                  // 50% more ammo
  sniper_optic:       { spread: { base: 0.5 } },         // tighter ADS spread
};
```

**Multiplayer readiness:** The `WeaponState`, `CombatState`, and `AIDummy` classes are designed as serializable state containers. For netcode, snapshot `player.position`, `player.velocity`, `combat.health/shield`, and `weapons.active.ammo` and sync them.

---

## Architecture Map

```
<script type="module">
├── MODULE 1:  CFG ................. Movement + combat tuning constants
├── MODULE 2:  WEAPONS ............. Weapon data definitions (5 archetypes)
├── MODULE 3:  Input ............... Keyboard, mouse, pointer lock, justPressed
├── MODULE 4:  Col ................. Raycasting, AABB collision, hitscan
├── MODULE 5:  WeaponState/Mgr ..... Per-weapon ammo/bloom/recoil + 2-slot inventory
├── MODULE 6:  CombatState ......... Health, shield, damage processing, regen
├── MODULE 7:  DmgNumbers .......... Floating damage number projection
├── MODULE 8:  AIDummy ............. Stationary AI with tracking + shooting
├── MODULE 9:  Pickup .............. Weapon/ammo/heal items with interact
├── MODULE 10: Player .............. Movement state machine (from v1)
├── MODULE 11: World ............... Arena geometry, lighting, collision setup
├── MODULE 12: HUD ................. All UI updates, vignettes, kill feed
└── MODULE 13: Main ................ Init, viewmodel, tracers, game loop
```
