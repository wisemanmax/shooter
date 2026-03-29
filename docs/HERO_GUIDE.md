# Drop Zone — Hero Roster Guide

## Hero Select → Match Flow

Select screen presents all 5 heroes as cards showing name, role, icon, description, and ability names. Click to lock in. Your squad teammates and all enemy squads receive randomized hero assignments from the pool. Match begins immediately with the drop phase.

## The Five Legends

### Forge (Assault) 🔥
| Ability | Key | Type | Cooldown | Details |
|---|---|---|---|---|
| Hot Reload | — | Passive | — | Current reload completes 25% faster when you knock an enemy |
| Stim | Q | Tactical | 16s | +30% move speed, 50% recoil reduction for 6s. Costs 10 HP |
| Orbital Strike | Z | Ultimate | 120s | Target a point 20m ahead. After 2s delay, deals 50 damage in 8m radius |

**Design intent**: Forge rewards aggression. Stim enhances gunfights without replacing them — you still need to aim, but your gun handles better and you move faster. The HP cost prevents spamming. Orbital Strike is area denial that forces repositioning, not an instant kill.

### Wraith (Skirmisher) 👻
| Ability | Key | Type | Cooldown | Details |
|---|---|---|---|---|
| Voices | — | Passive | — | (Architecture ready — warns when aimed at) |
| Phase Walk | Q | Tactical | 15s | 0.25s invulnerable dash at 30 u/s in look direction |
| Dimensional Rift | Z | Ultimate | 150s | Place entry portal, run to place exit. Squad can teleport between for 10s |

**Design intent**: Wraith is about repositioning, not damage. Phase Walk is a get-out-of-jail card with a long cooldown — use it to escape or push, not to fight. Portal enables squad-level rotations through dangerous ground.

### Seer (Recon) 👁
| Ability | Key | Type | Cooldown | Details |
|---|---|---|---|---|
| Heartbeat Sensor | — | Passive | — | Enemies within 20m appear on minimap (architecture ready) |
| Focus Scan | Q | Tactical | 25s | 45° cone, 30m range — reveals enemies through walls for 4s |
| Exhibit | Z | Ultimate | 120s | 25m dome centered on you. Enemies moving or firing inside are revealed for 12s |

**Design intent**: Seer provides intel that helps your squad take better fights, but never deals damage directly. Focus Scan is a commitment — you have to face the right direction. Exhibit is powerful but stationary, so repositioning counters it.

### Lifeline (Support) ✚
| Ability | Key | Type | Cooldown | Details |
|---|---|---|---|---|
| Combat Revive | — | Passive | — | Revive time reduced by 40% (3s instead of 5s) |
| D.O.C. Drone | Q | Tactical | 30s | Deploys at your position. Heals 8 HP/s to allies within 6m for 8s |
| Care Package | Z | Ultimate | 180s | After 4s delay, spawns a loot node with guaranteed epic+ weapon + battery + medkit |

**Design intent**: Lifeline keeps squads fighting longer without making them unkillable. The drone heals over time (not burst), so focused damage still wins fights. Care Package is a long-cooldown economy boost, not a combat ability.

### Catalyst (Controller) 🛡
| Ability | Key | Type | Cooldown | Details |
|---|---|---|---|---|
| Barricade | — | Passive | — | (Architecture ready — doors reinforced) |
| Piercing Spikes | Q | Tactical | 22s | Throw a slow zone 5m ahead. Enemies inside move at 60% speed for 8s |
| Ferro Wall | Z | Ultimate | 120s | Deploy a 12m wide, 3m tall wall that blocks movement and sight for 20s. Added to collision. |

**Design intent**: Catalyst controls space. Spikes don't deal damage — they punish bad positioning and create windows for your squad to push or rotate. Ferro Wall is a hard barrier that reshapes sightlines mid-fight.

---

## Data-Driven Architecture

### Adding a New Hero

Add an entry to `HEROES`:

```js
HEROES.nova = {
  id: 'nova', name: 'Nova', role: 'Assault', icon: '💥', color: 0xff6633,
  desc: 'Explosive specialist',
  passive: { id: 'blast_shield', name: 'Blast Shield', desc: 'Take 15% less explosive damage' },
  tactical: { id: 'frag', name: 'Frag Grenade', icon: '💣', desc: 'Throw grenade: 40 dmg in 6m',
    cooldown: 18, radius: 6, damage: 40, fuseTime: 1.5,
  },
  ultimate: { id: 'carpet_bomb', name: 'Carpet Bomb', icon: '✈️', desc: 'Line of explosions along look direction',
    cooldown: 180, damage: 60, width: 4, length: 30,
  },
};
```

Then add cases in `AbilSys.activate()`:

```js
case 'frag':
  // spawn grenade projectile, set fuse timer
  st.data.pos = ent.pos.clone().add(ent.fwd.multiplyScalar(8));
  st.data.fuseTimer = def.fuseTime;
  // ... create visual, set active
  break;
```

The hero select screen auto-generates cards from the `HEROES` object — no HTML changes needed.

### System Boundaries

Each module has clear responsibilities:

| Module | Does | Does NOT |
|---|---|---|
| `HEROES` | Defines ability data | Execute ability logic |
| `AbilState` | Tracks cooldowns and timers | Know what abilities do |
| `AbilSys.activate()` | Resolves one-shot effects | Know about HUD |
| `AbilSys.tickEffects()` | Applies per-frame effects | Handle input |
| `AbilFX` | Manages 3D visual objects | Know about game rules |
| Game loop | Routes input to systems | Know ability internals |

### Ability Properties Reference

Every tactical and ultimate can use these standard fields:

```
cooldown: number     // seconds before reuse
duration: number     // seconds the effect persists (optional)
radius: number       // area of effect (optional)
damage: number       // direct damage dealt (optional)
hpCost: number       // HP cost to activate (optional)
speedMult: number    // speed multiplier while active (optional)
recoilMult: number   // recoil multiplier while active (optional)
slowMult: number     // enemy slow factor in zone (optional)
delay: number        // seconds before effect triggers (optional)
```

The `AbilSys` dispatch table reads these generically. New abilities that combine existing properties work immediately.

---

## Balance Tuning Table

| Hero | Tactical CD | Ult CD | Combat Power | Utility | Survivability |
|---|---|---|---|---|---|
| Forge | 16s | 120s | ★★★★★ | ★★ | ★★★ |
| Wraith | 15s | 150s | ★★ | ★★★★ | ★★★★★ |
| Seer | 25s | 120s | ★★ | ★★★★★ | ★★ |
| Lifeline | 30s | 180s | ★★ | ★★★★ | ★★★★ |
| Catalyst | 22s | 120s | ★★ | ★★★★★ | ★★★ |

**Balance philosophy**: No ability should out-DPS a weapon. Abilities create opportunities — speed boosts, intel, healing, area denial — that make gunfights more favorable. The player who aims better should still win.

---

## Controls

| Key | Action |
|---|---|
| Q | Tactical ability |
| Z | Ultimate ability |
| WASD | Move |
| Shift | Sprint |
| Ctrl | Slide |
| Space | Jump / Detach zipline |
| LMB | Fire |
| R | Reload |
| 1-2 / Scroll | Swap weapons |
| 3-6 | Use consumables |
| E | Interact |
| F | Toggle door |
