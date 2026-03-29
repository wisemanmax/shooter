# Drop Zone — Progression & Retention Architecture

## Quick Start

```bash
# These services integrate into the existing multiplayer server.
# The integration layer connects game events → progression services.
const Progression = require('./integration');

// On player connect:
const snapshot = await Progression.onPlayerConnect(playerId, displayName);
// Send snapshot to client for UI hydration

// On match end (for each player):
const results = await Progression.onMatchEnd(playerId, matchData, isRanked);
// Send results to client for post-match screen
```

---

## Project Structure

```
prog/
├── config/                    ← Admin-tunable JSON (edit and restart)
│   ├── seasons.json           XP curve, level cap, match rewards
│   ├── challenges.json        Daily/weekly challenge pools
│   ├── battlepass.json        Tier rewards, premium track
│   └── ranked.json            Divisions, RP scoring, decay, matchmaking
├── data/
│   └── store.js               Persistence abstraction (in-memory → Redis/Postgres)
├── services/
│   ├── accounts.js            Profiles, XP, levels, stats, match history
│   ├── challenges.js          Daily/weekly challenge generation + progress
│   ├── battlepass.js          Tier progression, reward claims
│   ├── ranked.js              RP scoring, divisions, decay, split resets
│   └── cosmetics.js           Item registry, unlock state, equip validation
└── integration.js             Orchestrator — connects game events → services
```

---

## Data Flow: Post-Match

```
Match Ends
    │
    ▼
Progression.onMatchEnd(playerId, matchData, isRanked)
    │
    ├── 1. Accounts.recordMatchResult()
    │       ├── Accumulate lifetime + season stats
    │       ├── Calculate XP from match performance
    │       ├── Apply first-match-of-day bonus
    │       ├── Apply premium multiplier
    │       ├── Level up (possibly multiple)
    │       └── Append to match history
    │
    ├── 2. Challenges.onMatchComplete()
    │       ├── Check all active dailies + weeklies
    │       ├── Increment progress for matching stats
    │       ├── Mark completed challenges
    │       └── Auto-claim completed → award XP
    │
    ├── 3. BattlePass.addXP(matchXP + challengeXP)
    │       ├── Advance tiers
    │       ├── Collect pending rewards
    │       └── Grant rewards (cosmetics, currency, items)
    │
    ├── 4. Ranked.recordMatch() [if ranked]
    │       ├── Deduct entry cost
    │       ├── Award placement RP
    │       ├── Award kill RP (capped)
    │       ├── Award participation RP (uncapped)
    │       ├── Apply win streak bonus
    │       ├── Check promotion / demotion
    │       └── Update peak division
    │
    └── Return complete post-match summary to client
```

---

## Config Tuning Reference

### Changing XP Curve (config/seasons.json)

| Field | Default | Effect |
|---|---|---|
| `xp.baseXP` | 1000 | XP required for level 2 |
| `xp.xpPerLevel` | 250 | Additional XP per subsequent level |
| `xp.maxLevel` | 500 | Level cap before prestige |
| `xp.matchRewards.killXP` | 60 | XP per kill |
| `xp.matchRewards.winXP` | 300 | XP for winning |
| `xp.bonuses.firstMatchOfDay` | 200 | Daily bonus XP |
| `xp.bonuses.premiumMultiplier` | 1.5 | XP multiplier for pass holders |

**Formula**: `xpForLevel(n) = baseXP + (n-1) × xpPerLevel`

Level 1→2: 1000 XP. Level 50→51: 13,250 XP. Level 100→101: 25,750 XP.

### Changing Challenge Pool (config/challenges.json)

Add a new daily challenge:
```json
{ "id": "daily_new",  "name": "New Challenge",  "desc": "Do something",
  "stat": "kills",  "target": 10,  "xp": 800 }
```

The `stat` field must match a key that the match result provides. Available stat keys: `kills`, `damageDealt`, `wins`, `top3Finishes`, `top5Finishes`, `revives`, `headshotKnocks`, `matchesPlayed`, `itemsLooted`, `tacticalUses`, `ultimateUses`, `longestSurvivalMinutes`, `matchesAsForge` (and other heroes), `uniqueHeroes`.

### Changing Battle Pass (config/battlepass.json)

Add a tier reward:
```json
"55": { "rewardType": "skin", "rewardId": "skin_new_item" }
```

`rewardId` must exist in the cosmetics registry (`services/cosmetics.js`). The battle pass service automatically grants the reward when the tier is reached and claimed.

### Changing Ranked Rules (config/ranked.json)

| Field | Default | Effect |
|---|---|---|
| `divisions[n].entryCost` | 0-75 | RP deducted per match at this rank |
| `scoring.placement["1"]` | 125 | RP for 1st place |
| `scoring.kills.rpPerKill` | 10 | RP per kill |
| `scoring.kills.killCap` | 6 | Max kill+assist RP per match |
| `decay.rpPerDay` | 50 | RP lost per day of inactivity (Diamond+) |
| `splitReset.retainFraction` | 0.5 | RP kept between splits |

---

## Ranked Division Table

| Division | RP Range | Entry Cost | Tiers | Demotion Shield |
|---|---|---|---|---|
| Bronze | 0 – 999 | 0 | IV–I | Yes |
| Silver | 1000 – 2799 | 12 | IV–I | Yes |
| Gold | 2800 – 4999 | 24 | IV–I | No |
| Platinum | 5000 – 7499 | 36 | IV–I | No |
| Diamond | 7500 – 9999 | 48 | IV–I | No |
| Master | 10000 – 14999 | 60 | — | No |
| Predator | 15000+ | 75 | — | No |

**Predator** is the top 750 players by RP. The threshold is dynamic.

### RP Scoring Example

Gold II player, Placement 3rd, 4 kills, 1 assist, 2 revives:

```
Entry cost:        -24
Placement (top 3): +70
Kills (4 × 10):   +40
Assists (1 × 5):   +5
Revives (2 × 5):  +10
────────────────────────
Net RP:            +101
```

---

## Persistence Layer

`data/store.js` provides a simple async key-value interface:

```js
await store.get(namespace, key)        → value or null
await store.set(namespace, key, value) → true
await store.delete(namespace, key)     → boolean
await store.list(namespace, prefix)    → string[]
await store.increment(namespace, key, field, amount)
```

**To switch to production storage**: Replace the `Store` class implementation. The Map-based store uses the same interface as Redis (`GET`/`SET`/`DEL`/`KEYS`) or a Postgres row-per-key pattern. No service code changes needed.

**Namespaces used**: `accounts`, `stats`, `match_history`, `challenges`, `battlepass`, `ranked`.

---

## Service Boundaries

| Service | Owns | Does NOT own |
|---|---|---|
| **Accounts** | Profile, XP, level, stats, history, currency, unlocks | Challenge logic, ranked scoring |
| **Challenges** | Challenge pools, daily/weekly rotation, progress tracking | XP calculation, item grants |
| **BattlePass** | Tier state, reward claims, premium status | Cosmetic definitions, currency balance |
| **Ranked** | RP, divisions, decay, matchmaking brackets | Match resolution, damage validation |
| **Cosmetics** | Item registry, equip validation, unlock checks | How items are earned (that's BP/Ranked/Accounts) |
| **Integration** | Orchestration, reward routing | Game logic, networking |

Each service is independently testable. None imports another service directly — the integration layer is the only multi-service coordinator.

---

## Live Operations Playbook

### Changing season (every ~3 months)

1. Update `config/seasons.json`: increment `currentSeason`, set new dates
2. Update `config/battlepass.json`: new season number, new tier rewards
3. Update `config/ranked.json`: new season, call `splitReset()` for all players
4. Update `config/challenges.json`: add seasonal challenges if desired
5. Add new cosmetics to `services/cosmetics.js` REGISTRY
6. Restart server

### Adding a new hero

1. Add hero to the game server's hero definitions
2. Add default skin to cosmetics REGISTRY: `skin_newhero_default: { type:'skin', hero:'newhero', ... defaultUnlocked:true }`
3. Add hero-specific challenges to `config/challenges.json`
4. Add hero skins to battle pass tiers if desired
5. No service code changes needed

### Adjusting ranked balance mid-season

1. Edit `config/ranked.json` scoring values
2. Restart server
3. New values apply to all future matches immediately
4. Existing RP is not retroactively adjusted

### Adding a new challenge type

1. Add a `stat` key to the match result data flowing through `Accounts.recordMatchResult()`
2. Add challenge entries to `config/challenges.json` using the new stat key
3. The `Challenges.onMatchComplete()` method automatically looks up the stat key

### Running a double-XP weekend

1. In `config/seasons.json`, set `xp.bonuses.premiumMultiplier` to 2.0 (or create a new `doubleXPMultiplier` field and read it in `Accounts.recordMatchResult`)
2. Restart server
3. Revert after the event

---

## Scaling Notes

- **Store layer**: Swap to Redis for sub-millisecond reads. Use Postgres for match history (append-only, queryable). Redis handles all hot-path data (accounts, challenges, ranked, battlepass).
- **Leaderboards**: Use Redis sorted sets (`ZADD`/`ZRANGE`) for ranked leaderboards with O(log N) updates.
- **Challenge rotation**: Currently picks from a static pool. For live events, add a `featured` array to `challenges.json` that overrides normal rotation during event periods.
- **Battle pass prestige tiers**: After tier 100, cycle through `prestige_1`, `prestige_2` rewards. The service already handles tier > maxTier gracefully.
- **Analytics hooks**: Add telemetry emission points in `integration.js` where match results and challenge completions are processed. Forward to your analytics pipeline (Segment, Amplitude, custom).
