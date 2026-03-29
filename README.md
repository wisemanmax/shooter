# Drop Zone

A hero-based battle royale prototype built from scratch across 9 iterative builds. Playable in the browser. Includes an authoritative multiplayer server, progression systems, and a production audit.

## Quick Start — Play Now

Every build in `client/builds/` is a **standalone HTML file**. No install, no build step, no server needed. Open any of them in a modern browser:

```bash
# Option 1: Double-click any HTML file in client/builds/

# Option 2: Use a local server (avoids CORS issues with ES modules)
npx serve client/builds
# Then open http://localhost:3000/v6-heroes.html
```

| File | What it is |
|---|---|
| `v6-heroes.html` | **Latest full build** — 5 heroes, BR mechanics, traversal, all systems |
| `v5-traversal.html` | BR with ziplines, jump pads, doors, loot bins, callout zones |
| `v4-battle-royale.html` | Core BR: ring, loot, squads, banners, respawn beacons |
| `v3-arena.html` | 3v3 arena: rounds, downed/revive, hero classes, pings |
| `v2-combat.html` | Combat sandbox: 6 weapons, recoil, bloom, shield/health |
| `v1-movement.html` | Movement lab: sprint, slide, mantle, jump, debug overlay |
| `firing-range.html` | Practice mode with guided tutorial and accuracy tracking |

### Controls (all builds)

| Key | Action |
|---|---|
| WASD | Move |
| Shift | Sprint |
| Ctrl | Slide (while sprinting) |
| Space | Jump |
| LMB | Fire |
| R | Reload |
| 1–2 / Scroll | Swap weapons |
| E | Interact (loot, revive, ziplines, banners) |
| F | Toggle doors |
| Q | Tactical ability |
| Z | Ultimate ability |
| 3–6 | Use consumables (syringe, medkit, cell, battery) |

---

## Start the Multiplayer Server

```bash
npm install
npm start
# Server listens on ws://localhost:8080
```

The server is a standalone Node.js WebSocket application. It handles matchmaking, authoritative game state, lag-compensated hit detection, and session management. Clients connect via the `NetClient` class in `client/net.js`.

See `docs/MULTIPLAYER_ARCHITECTURE.md` for the full server/client responsibility split, data contracts, and scaling notes.

---

## Project Structure

```
dropzone/
├── client/
│   ├── builds/              7 playable HTML builds (open directly)
│   │   ├── v1-movement.html      Movement physics prototype
│   │   ├── v2-combat.html        Weapon + combat sandbox
│   │   ├── v3-arena.html         3v3 arena with heroes
│   │   ├── v4-battle-royale.html Full BR: ring, loot, squads
│   │   ├── v5-traversal.html     BR + ziplines, doors, jump pads
│   │   ├── v6-heroes.html        BR + 5 hero classes, abilities
│   │   └── firing-range.html     Practice mode with tutorial
│   ├── net.js               Client networking (prediction, interpolation)
│   └── shell.js             Production shell (audio, settings, accessibility)
│
├── server/
│   ├── server.js            Authoritative game server
│   └── lobbies.js           Private lobby system
│
├── shared/
│   └── protocol.js          Message types, data contracts, constants
│
├── progression/
│   ├── config/              Admin-tunable JSON (edit + restart)
│   │   ├── seasons.json         XP curve, level cap, match rewards
│   │   ├── challenges.json      Daily/weekly challenge pools
│   │   ├── battlepass.json      100-tier battle pass with rewards
│   │   └── ranked.json          Divisions, RP scoring, decay rules
│   ├── data/
│   │   └── store.js             Persistence layer (in-memory → Redis)
│   ├── services/
│   │   ├── accounts.js          Profiles, XP, levels, stats, history
│   │   ├── challenges.js        Daily/weekly generation + tracking
│   │   ├── battlepass.js        Tier progression, reward claims
│   │   ├── ranked.js            RP scoring, divisions, matchmaking
│   │   └── cosmetics.js         Item registry, unlock state
│   └── integration.js          Orchestrates all services post-match
│
├── docs/
│   ├── MULTIPLAYER_ARCHITECTURE.md
│   ├── PROGRESSION_ARCHITECTURE.md
│   ├── PRODUCTION_AUDIT.md
│   ├── HERO_GUIDE.md
│   └── tuning/              Per-build tuning variable reference
│
├── package.json
├── .gitignore
└── README.md
```

---

## How Each Piece Connects

```
Player opens v6-heroes.html in browser
    │
    ├── Standalone mode: plays against bots locally (no server needed)
    │
    └── Online mode: import net.js → connect to server.js via WebSocket
            │
            ├── server.js validates all inputs, runs authoritative physics
            ├── server.js calls progression/integration.js on match end
            │       ├── accounts.js records stats + awards XP
            │       ├── challenges.js tracks daily/weekly progress
            │       ├── battlepass.js advances tiers
            │       └── ranked.js updates RP + division
            │
            └── lobbies.js handles private match creation (join codes)
```

---

## The Five Heroes

| Hero | Role | Tactical (Q) | Ultimate (Z) | Passive |
|---|---|---|---|---|
| Forge | Assault | Stim — +30% speed, −recoil, 6s | Orbital Strike — 50 dmg, 8m radius | Faster reload after knocks |
| Wraith | Skirmisher | Phase Walk — invuln dash, 0.25s | Portal — two-way teleport, 10s | Danger warning |
| Seer | Recon | Focus Scan — reveal cone, 4s | Exhibit — 25m reveal dome, 12s | Heartbeat sensor |
| Lifeline | Support | D.O.C. — heal drone, 8 HP/s, 8s | Care Package — epic+ loot drop | 40% faster revive |
| Catalyst | Controller | Spikes — 40% slow zone, 8s | Ferro Wall — 12m blocking wall, 20s | Door reinforcement |

See `docs/HERO_GUIDE.md` for full ability details, balance philosophy, and how to add new heroes.

---

## Tuning Without Code Changes

All gameplay variables live in config objects at the top of each build (search for `const C=` or `const CFG=`). For the progression backend, edit the JSON files in `progression/config/` and restart the server.

| What to tune | Where |
|---|---|
| Movement (speed, jump, slide) | Top of any HTML build, `C` object |
| Weapons (damage, fire rate, recoil) | `WD` or `WEAP` object in HTML builds |
| Ring stages | `C.RING` array in HTML builds |
| XP curve / level cap | `progression/config/seasons.json` |
| Challenge pool | `progression/config/challenges.json` |
| Battle pass tiers | `progression/config/battlepass.json` |
| Ranked divisions / scoring | `progression/config/ranked.json` |

Each tuning guide in `docs/tuning/` explains every variable for its build.

---

## Adding Content

### New hero
1. Add entry to `HEROES` object in the game client
2. Add `case` blocks in `AbilSys.activate()` for tactical + ultimate
3. Add default skin to `progression/services/cosmetics.js` registry
4. Add hero-specific challenges to `progression/config/challenges.json`

### New weapon
1. Add entry to `WD` object in the game client
2. Add to `LT.wp` loot pool array
3. No server changes needed (weapon defs are shared constants)

### New map POI
1. Add geometry calls in the `World` class constructor
2. Place loot nodes, bins, ziplines, doors, and jump pads
3. Add a `CalloutZone` entry for minimap labeling

### New battle pass season
1. Edit `progression/config/battlepass.json` — new tier rewards
2. Add cosmetic IDs to `progression/services/cosmetics.js`
3. Update `progression/config/seasons.json` — new dates + season number

---

## Production Readiness

`docs/PRODUCTION_AUDIT.md` contains a complete codebase audit with 21 prioritized issues across 4 severity levels, from P0 blockers (shared physics module, server-side collision, Redis migration) to P3 polish (GLTF models, localization). A phased remediation roadmap breaks work into three 2-3 week sprints.

`client/shell.js` provides production-ready Audio, Settings, Accessibility, Performance monitoring, Error logging, Tutorial, VFX, and Transitions — all wired through a single `Shell.init()` call.

---

## Tech Stack

| Component | Technology |
|---|---|
| Rendering | Three.js r163 (ES module import) |
| Networking | WebSocket (ws library on server) |
| Server | Node.js |
| Persistence | In-memory (swap to Redis/Postgres) |
| Audio | Web Audio API (synthesized, no files) |
| Build | None required (raw HTML + ES modules) |

---

## License

Prototype / educational use. Not licensed for commercial distribution.
