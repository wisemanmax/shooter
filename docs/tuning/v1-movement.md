# Movement Lab — Tuning Guide

All movement variables live in the `CONFIG` object at the top of the `<script type="module">` block in `index.html` (search for `MODULE 1: CONFIG`). Change any value and refresh — no build step needed.

---

## Ground Movement

| Variable | Default | Effect |
|---|---|---|
| `WALK_SPEED` | 6.0 | Base walk cap (units/sec). Raise for faster pace, lower for tactical feel. |
| `SPRINT_SPEED` | 10.5 | Sprint cap. The ratio to walk speed determines how impactful sprint feels. |
| `CROUCH_SPEED` | 3.0 | Movement cap while crouching (not sliding). |
| `GROUND_ACCEL` | 55.0 | How quickly you reach max speed. Higher = snappier, lower = ice-skating. |
| `GROUND_FRICTION` | 9.0 | Deceleration when releasing keys. Higher = tighter stops. |

**Tuning tip:** If movement feels sluggish, raise `GROUND_ACCEL`. If stops feel floaty, raise `GROUND_FRICTION`. The `SPRINT_SPEED / WALK_SPEED` ratio controls how rewarding sprinting feels — Apex-like games use ~1.5-1.7x.

---

## Air Movement

| Variable | Default | Effect |
|---|---|---|
| `AIR_ACCEL` | 12.0 | Strafe acceleration in air. |
| `AIR_SPEED_CAP` | 2.5 | Max speed you can *add* per tick while airborne. This is the air-strafe cap — the key to Quake-style movement. |
| `AIR_FRICTION` | 0.2 | Minimal drag in air. Keep very low for momentum preservation. |

**Tuning tip:** `AIR_SPEED_CAP` is the most important air control variable. Higher values = more air authority (arena shooter feel). Lower = more committed jumps (tactical shooter feel). Set to 0 for zero air control.

---

## Slide

| Variable | Default | Effect |
|---|---|---|
| `SLIDE_ENTRY_SPEED` | 5.0 | Minimum horizontal speed to initiate a slide (must be sprinting + crouch). |
| `SLIDE_BOOST` | 1.15 | Speed multiplier applied on slide entry. 1.0 = pure momentum carry, >1.0 = burst. |
| `SLIDE_FRICTION` | 2.2 | Friction during slide. Lower = longer slides. |
| `SLIDE_MIN_SPEED` | 2.0 | Speed at which slide auto-ends. |
| `SLIDE_COOLDOWN` | 0.4 | Seconds before you can slide again after one ends. |
| `SLIDE_GRAVITY_MULT` | 1.5 | Extra downhill acceleration on slopes during slide. |

**Tuning tip:** For Apex-style long slides, lower `SLIDE_FRICTION` to ~1.5 and raise `SLIDE_BOOST` to ~1.25. For shorter tactical slides (Warzone-style), raise friction to ~4.0 and set boost to 1.0.

---

## Jump & Gravity

| Variable | Default | Effect |
|---|---|---|
| `JUMP_FORCE` | 8.5 | Initial upward velocity. Determines jump height. |
| `GRAVITY` | 23.0 | Downward acceleration. Higher = snappier falls. |
| `COYOTE_TIME` | 0.1 | Grace period (seconds) after walking off a ledge where jump still works. |
| `JUMP_BUFFER_TIME` | 0.1 | If you press jump this many seconds before landing, it fires on contact. |

**Tuning tip:** Jump height ≈ `JUMP_FORCE² / (2 × GRAVITY)`. Default = ~1.57 units. Both coyote time and jump buffer are quality-of-life features — higher values feel more forgiving, lower values reward precision.

---

## Mantle

| Variable | Default | Effect |
|---|---|---|
| `MANTLE_MAX_HEIGHT` | 2.2 | Tallest obstacle the player can vault over. |
| `MANTLE_MIN_HEIGHT` | 0.4 | Below this, step-up handles it instead. |
| `MANTLE_REACH` | 1.0 | How far forward the mantle raycast checks. |
| `MANTLE_DURATION` | 0.25 | Seconds for the mantle animation. Shorter = snappier. |

**Tuning tip:** The mantle triggers when you're airborne, moving forward, and past jump apex. If mantling feels unresponsive, increase `MANTLE_REACH`. If it triggers on things it shouldn't, lower `MANTLE_MAX_HEIGHT`.

---

## Camera & Feel

| Variable | Default | Effect |
|---|---|---|
| `BASE_SENSITIVITY` | 0.002 | Mouse sensitivity multiplier (also adjustable via in-game slider). |
| `BASE_FOV` | 90 | Base field of view (also adjustable via slider). |
| `FOV_SPRINT_ADD` | 5 | FOV increase while sprinting. Sells speed. |
| `FOV_SLIDE_ADD` | 10 | FOV increase during slide. Bigger = more dramatic. |
| `FOV_LERP_SPEED` | 8.0 | How quickly FOV transitions. |
| `TILT_SLIDE_DEG` | 4 | Camera roll (degrees) during slide for cinematic feel. |
| `HEAD_BOB_SPEED` | 10.0 | Walk bobbing frequency. |
| `HEAD_BOB_AMOUNT` | 0.03 | Walk bobbing amplitude. Set to 0 to disable. |

---

## Player Dimensions

| Variable | Default | Effect |
|---|---|---|
| `PLAYER_HEIGHT` | 1.8 | Standing height. Affects eye position and collision. |
| `PLAYER_CROUCH_HEIGHT` | 1.0 | Crouching/sliding height. |
| `PLAYER_RADIUS` | 0.35 | Horizontal collision radius. |
| `EYE_OFFSET_RATIO` | 0.85 | Eye height as fraction of body height. |
| `STEP_HEIGHT` | 0.35 | Max height the player can step up without jumping. |

---

## Architecture Map

```
index.html
├── STYLES .................. UI styling (CSS)
├── HTML .................... Overlay, HUD, debug panel, settings
└── SCRIPT (ES module)
    ├── MODULE 1: CONFIG .... ← All tunable variables (search this)
    ├── MODULE 2: INPUT ..... Keyboard/mouse/pointer lock
    ├── MODULE 3: COLLISION . Raycasting, AABB resolution
    ├── MODULE 4: PLAYER .... State machine, physics, mantle
    ├── MODULE 5: WORLD ..... Arena geometry, targets, lighting
    ├── MODULE 6: UI ........ Debug overlay, settings, HUD
    └── MODULE 7: MAIN ...... Init, game loop, camera, shooting
```

Each module is clearly labeled with a comment banner. Search for `MODULE N:` to jump between them.
