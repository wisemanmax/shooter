# Drop Zone — Production Audit & Remediation Guide

This document is a comprehensive review of every module across the 8-build prototype history (v1 movement → v8 progression). It identifies prototype shortcuts that block scaling, missing production systems, and the exact remediation steps for each.

---

## Severity Legend

- **P0 BLOCKER** — Must fix before any real player traffic
- **P1 HIGH** — Fix before soft launch
- **P2 MEDIUM** — Fix before wider release
- **P3 LOW** — Quality of life, polish

---

## 1. Client-Side Codebase (HTML Game Builds)

### P0: Single-File Architecture

**Problem**: Every game build is a monolithic HTML file (600-900 lines). CSS, HTML, and JS are interleaved. No build tooling, no modules beyond the ES import map for Three.js.

**Impact**: Cannot lint, test, tree-shake, or code-split. No hot-reload. Collaboration impossible.

**Fix**: Migrate to Vite + TypeScript project structure.
```
client/
├── src/
│   ├── main.ts
│   ├── core/          (input, collision, physics)
│   ├── entities/      (player, bot, entity base)
│   ├── combat/        (weapons, damage, abilities)
│   ├── world/         (map builder, traversal, loot)
│   ├── ui/            (HUD components, settings, tutorial)
│   ├── net/           (NetClient, prediction, interpolation)
│   └── shell/         (audio, accessibility, logging)
├── public/
│   └── index.html
├── tsconfig.json
└── vite.config.ts
```

### P0: No Client-Side Validation Before Server Send

**Problem**: Client sends raw input without any local sanity checks. A modified client could send 999 inputs per frame or invalid key bitmasks.

**Fix**: Add client-side rate limiting (max 1 input per requestAnimationFrame), bitmask range validation (keys must be 0-127), and yaw/pitch range clamping before send.

### P1: Collision System Uses Brute-Force AABB Iteration

**Problem**: `Col.rH()` iterates every AABB for every entity every frame. At 60+ obstacles and 15 entities, this is ~900 checks per tick.

**Impact**: Performance degrades linearly with map complexity.

**Fix**: Implement spatial hashing (grid-based). Divide the map into 10×10 cells. Each cell stores references to overlapping AABBs. Entities only check AABBs in their current cell and neighbors (max 9 cells × ~5 AABBs = 45 checks).

### P1: Raycasting Checks All Objects Every Shot

**Problem**: `Col.ray()` concatenates `walls` and `targetParts` arrays and raycasts against every object. Three.js Raycaster is not optimized for large scenes.

**Fix**: Use Three.js `Octree` or a custom BVH (bounding volume hierarchy). Pre-build the BVH from static geometry at map load. Dynamic entities (players) use a separate fast list.

### P1: Ground Check Raycasts Every Frame For Every Entity

**Problem**: `Col.gnd()` fires a downward ray per entity per frame. With 15 entities at 60fps, that's 900 raycasts/sec.

**Fix**: Cache ground height per entity per cell. Only re-raycast when the entity moves to a new cell or after a door toggle / ability wall deployment.

### P2: Three.js Object Creation in Hot Path

**Problem**: `new THREE.Raycaster()` is called inside `Col.gnd()`, `Col.ray()`, etc. every frame. This creates garbage pressure.

**Fix**: Pre-allocate one Raycaster and reuse it by setting `origin`, `direction`, `near`, `far` before each use.

### P2: DOM Manipulation in Game Loop

**Problem**: Every frame, the HUD code reads/writes dozens of DOM elements (innerHTML, textContent, style, classList). This triggers layout recalculation.

**Fix**: Batch DOM reads at frame start, writes at frame end. Use a virtual DOM layer or canvas-based HUD for the game view. Keep DOM HUD for menus only.

### P2: No Object Pooling for Tracers / Damage Numbers

**Problem**: Each tracer creates a `new THREE.Line` and adds it to the scene. Each damage number creates a `new div` and appends to DOM. Both are garbage collected shortly after.

**Fix**: Pre-allocate a pool of 30 tracer lines and 20 damage number divs. Activate/deactivate from the pool instead of creating/destroying.

### P3: Viewmodel is a Plain Box

**Problem**: Every weapon viewmodel is a `BoxGeometry`. Acceptable for prototype, not for shipped product.

**Fix**: Replace with GLTF models loaded via `GLTFLoader`. The viewmodel attachment system (camera child group) already supports swapping meshes — just swap `BoxGeometry` for loaded models.

### P3: No Asset Loading / Progress Bar

**Problem**: The game starts immediately with no loading state. Three.js loads synchronously.

**Fix**: Add a loading manager that tracks texture, model, and audio loading. Show a progress bar. Defer `requestAnimationFrame(loop)` until all assets are ready.

---

## 2. Server Codebase (server.js)

### P0: Movement Simulation is Simplified

**Problem**: Server-side movement physics is a stripped-down version of the client physics. It lacks slide, mantle, and crouch height changes. This means the server will reject valid slide/mantle movements.

**Impact**: Players will experience constant corrections during advanced movement.

**Fix**: Extract the full movement physics into `shared/physics.js` (isomorphic). Both client and server import the same function. Run identical simulation on both sides.

### P0: No Server-Side Collision Against Map Geometry

**Problem**: The server does `if (pos.y < 0) pos.y = 0` as its only ground check. It has no knowledge of ramps, platforms, walls, or buildings.

**Impact**: Players can walk through walls from the server's perspective. All position validation is effectively disabled for vertical geometry.

**Fix**: Export map geometry as a simplified collision mesh (AABB list). Load it on the server. Run `Col.rH()` and `Col.gnd()` server-side with the same data.

### P0: Hit Detection is Oversimplified

**Problem**: Server hit detection checks direction dot product only — no actual hitbox intersection. It uses `Math.random() < 0.15` for headshots instead of checking which mesh was hit.

**Fix**: Implement capsule hitboxes (cylinder body + sphere head) for each entity on the server. On fire, raycast against the rewound capsule positions. Return which hitbox component was hit (body vs. head).

### P1: No Rate Limiting on Messages

**Problem**: A malicious client can flood the server with thousands of messages per second. The server processes all of them.

**Fix**: Implement per-connection message rate limiting. Cap at 70 inputs/sec, 20 actions/sec. Disconnect clients that exceed limits.

### P1: JSON Serialization for Snapshots

**Problem**: Full JSON snapshots at 20Hz for 15 entities. `JSON.stringify` / `JSON.parse` on every snapshot is slow and large.

**Fix**: Switch to MessagePack or FlatBuffers for binary serialization. Implement delta compression (only send changed fields since last acknowledged snapshot).

### P1: GameInstance Runs All Logic in One setInterval

**Problem**: One 50ms tick handles all entities, all validation, all ring logic, all broadcasts. If any entity's input processing is slow, all entities are delayed.

**Fix**: Separate input processing (dequeue and apply) from world simulation (ring, damage, state checks) from broadcast (snapshot assembly and send). Profile each phase independently.

### P2: Bot AI is Too Simple for Pacing

**Problem**: Bots wander randomly and shoot with fixed accuracy. They don't loot, don't use cover, don't rotate with the ring strategically, and don't prioritize targets.

**Fix**: Implement a behavior tree for bots. States: DROP → LOOT (move toward nearest loot node) → ROTATE (move toward ring center) → ENGAGE (seek cover, shoot nearest enemy) → REVIVE. Adjust accuracy by "rank" to create varied difficulty.

### P2: No Graceful Server Shutdown

**Problem**: Killing the server process drops all WebSocket connections without cleanup. Matches are lost.

**Fix**: Handle `SIGTERM` / `SIGINT`. Broadcast `s:server_shutdown` to all clients. Save match state for potential recovery. Close connections cleanly.

### P3: Single-Process Server

**Problem**: Node.js single thread limits to one CPU core. A busy match can't utilize multi-core machines.

**Fix**: Use `worker_threads` or cluster mode. One worker per GameInstance. The main thread handles WebSocket routing and session management only.

---

## 3. Progression Services

### P0: In-Memory Data Store

**Problem**: `data/store.js` uses `Map` objects. All data is lost on server restart.

**Fix**: Swap to Redis for session-hot data (accounts, challenges, ranked state) and PostgreSQL for cold storage (match history, cosmetics registry). The Store interface is already async and namespace-scoped — implementation swap is localized.

### P1: No Input Validation on Service Methods

**Problem**: Services trust all input parameters. `Accounts.recordMatchResult()` doesn't validate that kill counts are non-negative or that placement is 1-5.

**Fix**: Add a validation layer (Joi, Zod, or manual checks) at the integration boundary. Reject invalid match data before it reaches any service.

### P1: Challenge Progress is Not Atomic

**Problem**: If the server crashes between updating challenge progress and saving to store, progress is lost.

**Fix**: Wrap `Challenges.onMatchComplete()` in a transaction. Use Redis MULTI/EXEC or Postgres BEGIN/COMMIT.

### P2: No API Rate Limiting

**Problem**: No rate limits on cosmetic equip, challenge reroll, or battle pass claim endpoints. A bot could spam these.

**Fix**: Add per-player rate limiting: max 10 equip requests/min, 1 reroll/day (already enforced by config), max 1 BP claim per second.

### P2: Cosmetics Registry is Hardcoded

**Problem**: Adding cosmetics requires editing `services/cosmetics.js` and restarting the server.

**Fix**: Move the registry to a JSON file or database table. Load at startup. Implement a hot-reload mechanism for live content updates.

### P3: No Telemetry / Analytics Hooks

**Problem**: No structured data emission for analytics (player funnels, retention curves, economy health).

**Fix**: Add telemetry emission points in `integration.js` at match completion, challenge completion, battle pass tier advancement, and ranked division changes. Forward events to an analytics pipeline.

---

## 4. Networking

### P1: No Encryption / Authentication

**Problem**: WebSocket connection is plain `ws://`. Auth is a displayName string with no verification. Anyone can impersonate anyone.

**Fix**: Use `wss://` with TLS. Implement JWT-based authentication. Validate tokens on connection. Sign session IDs with a server secret.

### P1: No Bandwidth Throttling

**Problem**: If a client is on a slow connection, snapshot messages queue up and eventually cause memory pressure on the server.

**Fix**: Track send queue depth per connection. If a client falls behind by more than 500ms of snapshots, drop intermediate snapshots and send only the latest.

### P2: Reconnect Does Not Restore Full Client State

**Problem**: `RECONNECT_OK` sends the server's `fullState`, but the client has no code to rebuild the Three.js scene from a state snapshot. The client would show a blank screen.

**Fix**: Implement `client/sceneBuilder.js` that takes a `fullState` object and constructs all Three.js objects (entities, loot nodes, ring mesh, doors, ziplines) from it. Call this on reconnect before resuming the game loop.

### P2: Latency Measurement is Imprecise

**Problem**: RTT is measured via WebSocket ping/pong at 2-second intervals. This is coarse-grained and doesn't account for jitter.

**Fix**: Use a rolling window of the last 10 RTT measurements. Calculate median RTT (more stable than average). Send client timestamps in input packets for more precise server-side latency estimation.

---

## 5. Missing Production Systems

### P0: No Automated Testing

**Problem**: Zero unit tests, integration tests, or end-to-end tests across the entire codebase.

**Fix**: Add test suites for each service (Jest). Priority tests: movement physics determinism (client and server produce identical results), ranked RP calculations, challenge progress tracking, battle pass tier advancement. Add a CI pipeline that runs tests on every push.

### P1: No Health Check / Monitoring

**Problem**: No way to know if the server is healthy, how many matches are running, or what the average tick duration is.

**Fix**: Add a `/health` HTTP endpoint that reports: uptime, active matches, connected players, average tick duration, memory usage. Connect to Grafana/Datadog for dashboards and alerting.

### P1: No Configuration Management

**Problem**: Game constants are split between `shared/protocol.js` (movement) and the game client's inline `C` object. Changing a value requires editing multiple files.

**Fix**: Consolidate all shared constants into `shared/config.json`. Both server and client import from this single source. Add a `/config` endpoint that the client fetches at startup so constants can change without client updates.

### P2: No Versioning / Compatibility Checking

**Problem**: If the server updates its protocol and clients are running an old version, messages will be malformed. No version check occurs.

**Fix**: Add a `protocolVersion` field to the `AUTH` message. Server rejects clients with incompatible versions and sends a `FORCE_UPDATE` message with a download URL.

### P2: No Crash Reporting Pipeline

**Problem**: `Log.error()` writes to console. In production, console output is lost unless captured by a process manager.

**Fix**: Set `Log._remoteEndpoint` to a Sentry/Datadog/custom ingest URL. `navigator.sendBeacon` already handles fire-and-forget delivery. Add source maps for stack trace deobfuscation.

### P3: No Localization

**Problem**: All UI text is hardcoded in English.

**Fix**: Extract all player-facing strings to a `locales/en.json` file. Build a simple `i18n(key, params)` function. Support at minimum: English, Spanish, Portuguese, Japanese.

---

## 6. Production Shell Integration Checklist

The `client/shell.js` module provides: Audio, Settings, Accessibility, Performance monitoring, Error logging, Tutorial, VFX, and Transitions. Here is how to wire each into the existing game client:

| System | Integration Point | Code Change |
|---|---|---|
| **Audio** | After each `fire()` call → `Shell.Audio.play('fire_' + weaponId)` | 1 line per event |
| **Audio** | On `entity:damaged` event → `Shell.Audio.play('hit_shield')` or `'hit_flesh'` | In event listener |
| **Audio** | On reload, swap, pickup, ability → corresponding `Shell.Audio.play()` | 1 line each |
| **Settings** | At game init → `Shell.Settings.init()` | 1 line |
| **Settings** | Tab menu → render `Shell.Settings.buildPanel()` into settings div | Replace existing settings HTML |
| **Settings** | Read sensitivity → `Shell.Settings.get('controls').sensitivity` | Replace hardcoded I.sm |
| **Settings** | Read FOV → `Shell.Settings.get('controls').fov` | Replace hardcoded C.FOV |
| **Accessibility** | At init → `Shell.Accessibility.init()` | 1 line |
| **Accessibility** | On downed → `Shell.Accessibility.announce('You are downed')` | 1 line |
| **Accessibility** | On kill → `Shell.Accessibility.announce('Eliminated ' + name)` | 1 line |
| **Perf** | Top of game loop → `Shell.Perf.beginFrame()` | 1 line |
| **Perf** | Bottom of game loop → `Shell.Perf.endFrame(renderer)` | 1 line |
| **Perf** | Read quality → `Shell.Perf.getQuality()` for shadow/particle toggling | In render settings |
| **Log** | At init → `Shell.Log.installGlobalHandlers()` | 1 line |
| **Log** | On network error → `Shell.Log.error('Net', message)` | In NetClient error handler |
| **Tutorial** | On first match → `Shell.Tutorial.show('movement')` | After drop landing |
| **Tutorial** | On first fire → `Shell.Tutorial.show('shooting')` | In fire handler |
| **Tutorial** | On first loot → `Shell.Tutorial.show('interact')` | In loot pickup |
| **VFX** | At init → `Shell.VFX.init(scene)` | 1 line |
| **VFX** | On bullet impact → `Shell.VFX.spawnImpact(hitPoint, color)` | In fire hit handler |
| **VFX** | On ability use → `Shell.VFX.spawnRing(pos, heroColor)` | In ability activation |
| **Transitions** | On match start → `Shell.Transitions.fadeIn()` | After drop begins |
| **Transitions** | On match end → `Shell.Transitions.fadeThrough(showResults)` | In match end handler |

---

## Prioritized Remediation Roadmap

### Phase 1: Minimum Viable Online (2-3 weeks)
1. Shared physics module (P0)
2. Server-side map collision (P0)
3. Proper hitbox detection (P0)
4. Message rate limiting (P1)
5. Redis store swap (P0)
6. TLS + JWT auth (P1)
7. Basic automated tests (P0)

### Phase 2: Soft Launch Ready (2-3 weeks)
8. Vite + TypeScript migration (P0)
9. Binary protocol + delta compression (P1)
10. Spatial hashing for collision (P1)
11. Input validation on all services (P1)
12. Health check endpoint (P1)
13. Bot behavior tree (P2)
14. Reconnect scene rebuilding (P2)

### Phase 3: Public Launch Polish (2-3 weeks)
15. Object pooling (tracers, particles, damage numbers) (P2)
16. Canvas-based HUD (P2)
17. GLTF viewmodels (P3)
18. Localization framework (P3)
19. Telemetry pipeline (P3)
20. Crash reporting (P2)
21. Asset loading with progress bar (P3)
