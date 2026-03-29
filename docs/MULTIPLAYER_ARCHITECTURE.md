# Drop Zone — Multiplayer Architecture

## Quick Start

```bash
cd mp/
npm install
npm start
# Server listens on ws://localhost:8080
# Client connects via NetClient in client/net.js
```

---

## Project Structure

```
mp/
├── package.json
├── shared/
│   └── protocol.js        ← Message types, schemas, constants (isomorphic)
├── server/
│   └── server.js           ← Authoritative game server (all game logic)
└── client/
    └── net.js              ← Client networking module (prediction, interpolation)
```

---

## Core Principle: Authoritative Server

The server owns all game state. The client is an input device and a renderer. The server never trusts the client about positions, damage, health, inventory, or state transitions.

```
┌─────────┐  inputs (60Hz)   ┌──────────┐
│  CLIENT  │ ───────────────→ │  SERVER  │
│          │                  │          │
│  renders │ ←─────────────── │  ticks   │
│  predicts│  snapshots (20Hz)│  validates│
└─────────┘                  └──────────┘
```

---

## Data Flow: One Game Frame

### Client Frame (~60Hz)

```
1. Read mouse/keyboard input
2. Encode keys into bitmask (Protocol.encodeKeys)
3. Run local movement physics (client prediction)
4. Render local player at PREDICTED position
5. Send InputPacket to server { seq, keys, yaw, pitch, dt }
6. Store input in pendingInputs[] for later replay
7. For remote entities: render at INTERPOLATED position
   (100ms behind real-time, lerped between two server snapshots)
```

### Server Tick (~20Hz / 50ms)

```
1. Drain input buffers for all connected players
2. For each input: run server-side movement simulation
3. Validate resulting position (speed check, bounds check)
4. If invalid: snap entity back, send SERVER_CORRECTION
5. Process queued actions: fire, reload, interact, ability
6. Validate each action (ammo check, distance check, cooldown check)
7. For fire actions: lag-compensated hit detection
   a. Look up shooter's claimed time
   b. Rewind entity positions to that time (LagCompensator)
   c. Check shot direction against target hitbox
   d. If valid: apply damage server-side, broadcast ENTITY_DAMAGED
8. Tick ring, shield regen, bleed-out, ability timers
9. Check squad wipes, match end conditions
10. Store current positions in LagCompensator history
11. Broadcast WorldSnapshot to all connected clients
```

---

## Server-Client Responsibility Split

| System | Server | Client |
|---|---|---|
| **Movement** | Simulate + validate every input. Correct if diverged. | Predict locally for responsiveness. Replay unacked inputs on correction. |
| **Shooting** | Validate fire (ammo, cooldown). Lag-compensated hit detection. Apply damage. | Send fire direction + timestamp. Play muzzle flash + tracer immediately. Wait for damage confirmation. |
| **Damage** | Calculate shield/health damage. Determine downed/eliminated. Broadcast events. | Display damage numbers + hit markers only after server confirmation. |
| **Loot** | Owns all loot state. Validates pickup distance. Broadcasts LOOT_COLLECTED. | Show loot visuals. Send interact request. Apply to inventory only after server confirms. |
| **Abilities** | Validate cooldown, alive state. Apply effects. Track timers. Broadcast events. | Send ability request. Play VFX on server confirmation. Cooldown UI driven by snapshot data. |
| **Ring** | Tick ring stages. Apply ring damage. Broadcast ring state. | Render ring visual from snapshot data. Display timer. |
| **Inventory** | Track all items server-side. Validate swaps, reloads, consumable use. | Display what the server says you have. Send requests for changes. |
| **Revive** | Track revive progress. Validate proximity. Complete revive. | Show revive UI. Send interact(revive, targetId) while holding E. |

---

## Hit Registration: Lag Compensation

### The Problem

Player A sees Player B at position X on their screen. Player A fires. By the time the server receives this, Player B has moved to position Y. Without compensation, the shot would miss even though it looked like a hit on A's screen.

### The Solution

```
1. Client A fires at time T_client
2. Message arrives at server at T_server (T_client + latency)
3. Server estimates T_claim = T_server - A's_RTT/2
4. Server rewinds all entity positions to T_claim
   using the LagCompensator snapshot history
5. Server checks: does A's shot direction intersect B's
   hitbox at the REWOUND position?
6. If yes → damage is applied
7. If no → shot is rejected silently
```

### Limits

- Maximum rewind: 300ms (`MAX_REWIND_MS`). Beyond this, the shot is rejected regardless. This prevents extreme lag abuse.
- Angle tolerance: 5° (`SHOT_ANGLE_TOL`). Accounts for floating-point precision and minor desync.
- The server stores snapshots for the last `MAX_REWIND_MS / TICK_MS + 2` ticks (~8 snapshots).

---

## Client Prediction + Reconciliation

### Why Predict?

Without prediction, the player would press W and see their character move only after a full round-trip to the server (~50-150ms later). This feels terrible. Prediction makes movement feel instant.

### How It Works

```
Client sends Input #5, #6, #7 to server
Client immediately runs physics for each input locally
Client stores each input in pendingInputs[]

Server processes Input #5, returns Snapshot with lastAck=5
Client removes Input #5 from pendingInputs[]
Client takes the server position from the snapshot
Client replays Inputs #6, #7 on top of the server position
Result = predicted position (very close to where client already was)

If server corrected our position (we hit a wall the client didn't know about):
  Client takes the corrected position as the new base
  Replays remaining unacked inputs
  Player sees a small "snap" to the correct position
```

### Key Requirement

The client and server MUST run the same physics simulation. `shared/protocol.js` contains `SIM` constants that both sides import. If they diverge, corrections will happen constantly and the game will feel jittery.

---

## Entity Interpolation (Remote Players)

Remote players are rendered 100ms behind real-time (`INTERP_DELAY_MS`). This buffer ensures smooth motion even with packet jitter.

```
Server sends snapshots at 20Hz (every 50ms)
Client buffers them
Client renders at (now - 100ms)

At render time, find the two snapshots that bracket the render time:
  Snapshot A (older) and Snapshot B (newer)
  Interpolation factor t = (renderTime - A.time) / (B.time - A.time)
  Rendered position = lerp(A.pos, B.pos, t)
```

If the buffer runs dry (extreme packet loss), the client extrapolates from the last known velocity. This looks worse but prevents freezing.

---

## Session + Reconnect Flow

```
CONNECT
  ├── First time: send AUTH { displayName }
  │   ← Receive AUTH_OK { sessionId, playerId }
  │   Store sessionId in localStorage
  │
  └── Returning: send RECONNECT { sessionId }
      ├── Session valid + match running
      │   ← Receive RECONNECT_OK { fullState }
      │   Client rebuilds world from fullState
      │
      └── Session expired
          ← Receive RECONNECT_FAIL
          Client falls back to fresh AUTH

DISCONNECT
  Server marks session as disconnected
  Session survives for RECONNECT_WINDOW (60s)
  Entity continues to exist in match (standing still, vulnerable)
  If player reconnects within window: resume seamlessly
  If not: entity eliminated, session eventually garbage collected
```

---

## Matchmaking Flow

```
1. Player authenticates (AUTH → AUTH_OK)
2. Player selects hero, sends JOIN_QUEUE { heroId }
3. Matchmaker accumulates players
4. When threshold reached (≥1 for dev, ≥15 for production):
   a. Form squads (round-robin assignment)
   b. Fill remaining slots with bots
   c. Create GameInstance
   d. Send MATCH_FOUND to all players
5. GameInstance starts tick loop
6. Players begin receiving snapshots
```

### Scaling Note

For larger lobbies (60 players), the matchmaker should:
- Wait for a full lobby or timeout after 30s (then fill with bots)
- Support party/pre-made squad queuing (group JOIN_QUEUE by party ID)
- Implement skill-based matching using a simple Elo/Glicko rating

---

## Bandwidth Budget

### Current (15 players, 20Hz snapshots)

| Direction | Data | Size | Rate | Total |
|---|---|---|---|---|
| S→C | WorldSnapshot | ~600 bytes | 20/s | ~12 KB/s |
| S→C | Events | ~50 bytes avg | ~5/s | ~0.25 KB/s |
| C→S | InputPacket | ~40 bytes | 60/s | ~2.4 KB/s |
| C→S | Actions | ~60 bytes avg | ~2/s | ~0.12 KB/s |
| **Total** | | | | **~15 KB/s per player** |

### Scaling to 60 Players

Full snapshots would grow to ~2.4 KB each × 20/s = 48 KB/s. Optimizations:

1. **Delta compression**: Only send fields that changed since the last acknowledged snapshot. Typical compression: 60-80% reduction.
2. **Spatial partitioning**: Only send entities within the player's interest area (e.g., 100m radius). Players outside the area get downgraded to position-only updates at 5Hz.
3. **Quantization**: Pack positions as 16-bit fixed-point (±327.67 range, 0.01 precision). Pack angles as 16-bit unsigned (0-65535 → 0-2π).
4. **Binary protocol**: Switch from JSON to a binary format (MessagePack or custom). ~40% size reduction.

**Target**: 15-20 KB/s per player at 60 players with all optimizations.

---

## Server-Side Validation Rules

### Movement

| Check | Threshold | Action |
|---|---|---|
| Speed exceeds MAX_SPEED × 1.3 | Per tick | Reject position, send correction |
| Teleportation (>2u per tick) | Per tick | Reject, flag for anti-cheat |
| Out of bounds (MAP_RADIUS + 1) | Per tick | Clamp to bounds |
| Below ground (y < -20) | Per tick | Reset to spawn |

### Combat

| Check | Condition | Action |
|---|---|---|
| Fire without ammo | ammo ≤ 0 | Reject silently |
| Fire during reload | reloading = true | Reject silently |
| Fire faster than weapon rate | fireCooldown > 0 | Reject silently |
| Hit at impossible angle | dot product < cos(5°) | Reject hit |
| Hit at impossible distance | > weapon range | Reject hit |
| Damage to teammate | same squadId | Reject (no friendly fire) |
| Damage while invulnerable | phase walk active | Reject |

### Loot

| Check | Condition | Action |
|---|---|---|
| Pickup at distance > 4u | Euclidean distance | Reject |
| Pickup already-collected loot | loot.active = false | Reject |
| Pickup during downed/eliminated | life ≠ ALIVE | Reject |

### Abilities

| Check | Condition | Action |
|---|---|---|
| Use on cooldown | cd > 0 | Reject |
| Use while downed | life ≠ ALIVE | Reject |
| Duplicate activation | already active | Reject |

---

## Anti-Cheat Considerations

This architecture provides the foundation for cheat prevention:

1. **Speed hacks**: Server validates all movement. Impossible positions are corrected.
2. **Damage hacks**: All damage is calculated server-side. Clients cannot claim arbitrary damage.
3. **Wallhacks**: Limited by sending only entity data within interest area (scaling optimization). Currently, all entities are sent — a known limitation for 15-player matches.
4. **Aimbot**: Lag compensation has a 300ms rewind cap and 5° angle tolerance. Extreme accuracy patterns can be detected statistically.
5. **Inventory manipulation**: Server tracks all inventory state. Clients cannot add items.

**Not addressed** (future work): encrypted protocol, client binary integrity checks, kernel-level anti-cheat.

---

## Scaling Architecture (Future)

```
                    ┌─────────────┐
                    │  MATCHMAKER  │  (stateless, scales horizontally)
                    │  SERVICE     │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │  GAME    │ │  GAME    │ │  GAME    │
        │  SERVER  │ │  SERVER  │ │  SERVER  │
        │  (1 match│ │  (1 match│ │  (1 match│
        │  per proc)│ │  per proc)│ │  per proc)│
        └──────────┘ └──────────┘ └──────────┘

Each GameInstance runs in its own process/container.
The matchmaker assigns players to game servers.
A lobby service handles auth, sessions, and social.
```

Key scaling decisions:
- **One match per process**: Prevents GC pauses in one match from affecting others. Node.js single-thread model makes this natural.
- **Stateless matchmaker**: Can be horizontally scaled behind a load balancer. Uses Redis for queue state.
- **Session service**: Separate from game servers. Survives match server restarts. Backed by Redis or Postgres.
- **60-player lobbies**: Increase `MAX_PLAYERS` to 60, `MAX_SQUADS` to 20. Server tick rate may need to drop to 15Hz to maintain performance. Delta compression becomes mandatory.

---

## Message Reference

### Client → Server

| Type | Frequency | Payload |
|---|---|---|
| `c:auth` | Once | `{ displayName }` |
| `c:reconnect` | Once | `{ sessionId }` |
| `c:join_queue` | Once | `{ heroId }` |
| `c:input` | 60/s | `{ seq, keys, yaw, pitch, dt }` |
| `c:fire` | On event | `{ seq, dir, spread, weaponId, pellets }` |
| `c:reload` | On event | `{ seq, weaponSlot }` |
| `c:swap_weapon` | On event | `{ seq, slotIndex }` |
| `c:use_consumable` | On event | `{ seq, consumableId }` |
| `c:interact` | On event | `{ seq, targetType, targetId }` |
| `c:use_ability` | On event | `{ seq, slot }` |
| `c:ping` | On event | `{ seq, pingType, position }` |

### Server → Client

| Type | Frequency | Payload |
|---|---|---|
| `s:snapshot` | 20/s | `{ tick, serverTime, lastAck, entities[], ring, squadsAlive, matchState }` |
| `s:correction` | Rare | `{ entityId, position, velocity, seq }` |
| `s:entity_damaged` | On event | `{ entityId, attackerId, damage, isHead, shieldDmg, healthDmg, shieldBroken }` |
| `s:entity_downed` | On event | `{ entityId }` |
| `s:entity_eliminated` | On event | `{ entityId, killerId }` |
| `s:loot_collected` | On event | `{ lootId, collectorId, items }` |
| `s:ring_update` | On change | `{ stage, cx, cz, currentR, targetR, timer, shrinking, dps }` |
| `s:ability_event` | On event | `{ entityId, abilityId, heroId, data }` |
| `s:match_end` | Once | `{ winnerSquadId }` |
