/**
 * Ability system — typed hero definitions and per-entity ability state.
 * Extracted from v6-heroes.html lines 154–469 (HEROES, AbilState, AbilFX, AbilSys).
 *
 * All cooldowns, durations, damage values, and effect logic match v6 exactly.
 */

import * as THREE from 'three';
import { Ev } from '../utils/events';
import { LifeState } from './damage';

/* ═══════════════════════════════════════════════════════════════
   HERO DEFINITION INTERFACES
   ═══════════════════════════════════════════════════════════════ */

/** Base shape for all passive ability definitions */
export interface PassiveDef {
  id: string;
  name: string;
  desc: string;
}

/** Passive with optional extra fields used by individual heroes */
export interface PassiveWithRange extends PassiveDef {
  range: number;
}

/** Tactical ability definition — all fields optional beyond the base set */
export interface TacticalDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  cooldown: number;
  duration?: number;
  // Forge stim
  hpCost?: number;
  speedMult?: number;
  recoilMult?: number;
  // Wraith phase
  speed?: number;
  // Seer focus
  range?: number;
  angle?: number;
  // Lifeline drone
  hps?: number;
  radius?: number;
  // Catalyst spikes
  slowMult?: number;
}

/** Ultimate ability definition */
export interface UltimateDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  cooldown: number;
  duration?: number;
  // Forge airstrike
  delay?: number;
  radius?: number;
  damage?: number;
  // Catalyst wall
  width?: number;
  height?: number;
}

/** Full hero definition */
export interface HeroDef {
  id: string;
  name: string;
  role: string;
  icon: string;
  color: number;
  desc: string;
  passive: PassiveDef | PassiveWithRange;
  tactical: TacticalDef;
  ultimate: UltimateDef;
}

/* ═══════════════════════════════════════════════════════════════
   HEROES CONSTANT — all 5 heroes, values match v6 exactly
   ═══════════════════════════════════════════════════════════════ */

export const HEROES: Record<string, HeroDef> = {
  forge: {
    id: 'forge', name: 'Forge', role: 'Assault', icon: '🔥', color: 0xf57a3a,
    desc: 'Aggressive frontline fighter',
    passive: {
      id: 'hot_reload', name: 'Hot Reload',
      desc: 'Reload 25% faster after a knock',
      // Applied reactively via event listener — no tick needed
    },
    tactical: {
      id: 'stim', name: 'Stim', icon: '💉',
      desc: '+30% speed, −recoil for 6s. Costs 10 HP',
      cooldown: 16, duration: 6, hpCost: 10, speedMult: 1.3, recoilMult: .5,
    },
    ultimate: {
      id: 'airstrike', name: 'Orbital Strike', icon: '☄️',
      desc: 'Area damage (50) after 2s delay in 8m radius',
      cooldown: 120, delay: 2, radius: 8, damage: 50,
    },
  },

  wraith: {
    id: 'wraith', name: 'Wraith', role: 'Skirmisher', icon: '👻', color: 0x9b59b6,
    desc: 'Elusive repositioner with phase tech',
    passive: {
      id: 'voices', name: 'Voices',
      desc: 'Warning flash when an enemy aims at you',
    },
    tactical: {
      id: 'phase', name: 'Phase Walk', icon: '🌀',
      desc: 'Invulnerable dash for 0.25s',
      cooldown: 15, duration: .25, speed: 30,
    },
    ultimate: {
      id: 'portal', name: 'Dimensional Rift', icon: '🌌',
      desc: 'Place a two-way portal for your squad (10s)',
      cooldown: 150, duration: 10,
    },
  },

  seer: {
    id: 'seer', name: 'Seer', role: 'Recon', icon: '👁', color: 0x5ab8f5,
    desc: 'Micro-drone intel specialist',
    passive: {
      id: 'heartbeat', name: 'Heartbeat Sensor',
      desc: 'Nearby enemies (<20m) pulse on HUD edge',
      range: 20,
    } as PassiveWithRange,
    tactical: {
      id: 'focus', name: 'Focus Scan', icon: '📡',
      desc: 'Reveal enemies in 30m cone for 4s',
      cooldown: 25, duration: 4, range: 30, angle: 45,
    },
    ultimate: {
      id: 'exhibit', name: 'Exhibit', icon: '🔮',
      desc: '25m dome — enemies firing or moving inside are revealed for 12s',
      cooldown: 120, radius: 25, duration: 12,
    },
  },

  lifeline: {
    id: 'lifeline', name: 'Lifeline', role: 'Support', icon: '✚', color: 0x5af5a6,
    desc: 'Combat medic with healing tech',
    passive: {
      id: 'fast_rev', name: 'Combat Revive',
      desc: 'Revive 40% faster (3s base)',
    },
    tactical: {
      id: 'drone', name: 'D.O.C. Drone', icon: '💊',
      desc: 'Heal drone: 8 HP/s to allies in 6m for 8s',
      cooldown: 30, duration: 8, hps: 8, radius: 6,
    },
    ultimate: {
      id: 'care_pkg', name: 'Care Package', icon: '📦',
      desc: 'Call supply drop with epic+ loot after 4s',
      cooldown: 180, delay: 4,
    },
  },

  catalyst: {
    id: 'catalyst', name: 'Catalyst', role: 'Controller', icon: '🛡', color: 0xf5c842,
    desc: 'Area denial with ferrofluid tech',
    passive: {
      id: 'barricade', name: 'Barricade',
      desc: 'Reinforced doors take longer to break',
    },
    tactical: {
      id: 'spikes', name: 'Piercing Spikes', icon: '⬥',
      desc: 'Slow zone: enemies −40% speed for 8s in 5m radius',
      cooldown: 22, duration: 8, radius: 5, slowMult: .6,
    },
    ultimate: {
      id: 'wall', name: 'Ferro Wall', icon: '🧱',
      desc: 'Deploy cover wall (12m wide) that blocks sight for 20s',
      cooldown: 120, duration: 20, width: 12, height: 3,
    },
  },
} as const;

/* ═══════════════════════════════════════════════════════════════
   ABILITY SLOT STATE — per-slot (tac / ult) runtime tracking
   ═══════════════════════════════════════════════════════════════ */

export interface AbilSlotState {
  cd: number;
  active: boolean;
  timer: number;
  data: Record<string, any>;
}

/* ═══════════════════════════════════════════════════════════════
   ABILITY STATE CLASS — per-entity ability tracker (v6 AbilState)
   ═══════════════════════════════════════════════════════════════ */

export class AbilState {
  hero: HeroDef;
  tac: AbilSlotState;
  ult: AbilSlotState;
  /** Hero-specific passive runtime data */
  passiveData: Record<string, any>;

  constructor(heroDef: HeroDef) {
    this.hero = heroDef;
    this.tac = { cd: 0, active: false, timer: 0, data: {} };
    this.ult = { cd: 0, active: false, timer: 0, data: {} };
    this.passiveData = {};
  }

  /** True when the tactical is off cooldown and not currently active */
  get tacReady(): boolean {
    return this.tac.cd <= 0 && !this.tac.active;
  }

  /** True when the ultimate is off cooldown and not currently active */
  get ultReady(): boolean {
    return this.ult.cd <= 0 && !this.ult.active;
  }

  /** Advance cooldowns and active timers by dt seconds */
  tick(dt: number): void {
    this.tac.cd = Math.max(0, this.tac.cd - dt);
    this.ult.cd = Math.max(0, this.ult.cd - dt);
    if (this.tac.active) {
      this.tac.timer -= dt;
      if (this.tac.timer <= 0) this.tac.active = false;
    }
    if (this.ult.active) {
      this.ult.timer -= dt;
      if (this.ult.timer <= 0) this.ult.active = false;
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   ABIL ENTITY INTERFACE — minimal entity shape required by AbilSys
   (avoids circular imports with the full Entity class)
   ═══════════════════════════════════════════════════════════════ */

/** Max health constant — v6 C.MHP = 100 */
const MAX_HP = 100;

export interface AbilEntity {
  /** Which squad this entity belongs to */
  squadId: number;
  /** Life state — use LifeState.ALIVE etc. */
  life: number;
  /** Current health */
  hp: number;
  /** Current shield */
  sh: number;
  /** World position */
  pos: THREE.Vector3;
  /** Velocity vector */
  vel: THREE.Vector3;
  /** Yaw angle in radians */
  yaw: number;
  /** Forward direction unit vector */
  fwd: THREE.Vector3;
  /** Horizontal speed (magnitude of XZ velocity) */
  hSpd: number;
  /** Ability state — may be absent on non-hero entities */
  abil?: AbilState;
  /** Apply damage — signature matches v6 Ent.takeDmg */
  takeDmg(amount: number, attacker: AbilEntity | null, isHeadshot: boolean): any;
  /** Revealed by Seer abilities */
  _revealed: boolean;
  _revealTimer: number;
  /** Speed slow multiplier applied externally each frame */
  _slowMult: number;
  /** Portal teleport cooldown */
  _portalCd: number;
}

/* ═══════════════════════════════════════════════════════════════
   COLLISION SYSTEM INTERFACE — passed as parameter to avoid
   importing Col directly (matches v6 Col shape used by abilities)
   ═══════════════════════════════════════════════════════════════ */

export interface ColSystem {
  walls: THREE.Mesh[];
  ground: THREE.Mesh[];
  rebuild(): void;
}

/* ═══════════════════════════════════════════════════════════════
   ABIL FX — array of managed 3D ability objects (v6 AbilFX)
   ═══════════════════════════════════════════════════════════════ */

export interface AbilFXEntry {
  /** The 3D object (mesh or light) to remove from scene when expired */
  mesh: THREE.Object3D;
  /** Remaining lifetime in seconds */
  timer: number;
  /** Optional callback when the FX is removed (e.g. remove wall from collision) */
  removeCb?: () => void;
}

/** Managed list of ability-spawned 3D objects */
export const AbilFX: { objects: AbilFXEntry[] } = { objects: [] };

/* ═══════════════════════════════════════════════════════════════
   ABILITY DISPATCH SYSTEM (v6 AbilSys)
   ═══════════════════════════════════════════════════════════════ */

export const AbilSys = {

  /**
   * Activate the given ability slot ('tac' or 'ult') on an entity.
   * Checks cooldown and life state, then dispatches by ability id.
   *
   * @param ent    - The activating entity
   * @param slot   - Which slot: 'tac' or 'ult'
   * @param allEnts - All entities in the match (for AoE effects)
   * @param scene  - Three.js scene for spawning FX meshes
   * @param col    - Collision system (needed for catalyst wall)
   * @returns true if the ability fired, false if on cooldown / inactive
   */
  activate(
    ent: AbilEntity,
    slot: 'tac' | 'ult',
    allEnts: AbilEntity[],
    scene: THREE.Scene,
    col: ColSystem,
  ): boolean {
    const as = ent.abil;
    if (!as) return false;

    const tacDef = as.hero.tactical;
    const ultDef = as.hero.ultimate;
    const def    = slot === 'tac' ? tacDef : ultDef;
    const st     = slot === 'tac' ? as.tac : as.ult;

    if (st.cd > 0 || st.active) return false;
    if (ent.life !== LifeState.ALIVE) return false;

    st.cd = def.cooldown;
    if (def.duration) { st.active = true; st.timer = def.duration; }
    st.data = {};

    switch (def.id) {

      // ── FORGE ──────────────────────────────────────────────────
      case 'stim': {
        const d = tacDef;
        ent.hp = Math.max(1, ent.hp - (d.hpCost ?? 0));
        st.data.speedMult  = d.speedMult;
        st.data.recoilMult = d.recoilMult;
        Ev.emit('ability:used', { ent, id: 'stim' });
        break;
      }

      case 'airstrike': {
        const d   = ultDef;
        const dir = ent.fwd;
        const target = new THREE.Vector3(ent.pos.x + dir.x * 20, 0, ent.pos.z + dir.z * 20);
        st.data.target    = target;
        st.data.delay     = d.delay;
        st.data.detonated = false;
        st.data.radius    = d.radius;
        st.data.damage    = d.damage;

        const marker = new THREE.Mesh(
          new THREE.RingGeometry((d.radius ?? 8) - .3, d.radius ?? 8, 24),
          new THREE.MeshBasicMaterial({ color: 0xff4422, transparent: true, opacity: .25, side: THREE.DoubleSide }),
        );
        marker.rotation.x = -Math.PI / 2;
        marker.position.copy(target);
        marker.position.y = .1;
        scene.add(marker);
        st.data.marker = marker;
        AbilFX.objects.push({ mesh: marker, timer: (d.delay ?? 2) + 1 });
        Ev.emit('ability:used', { ent, id: 'airstrike' });
        break;
      }

      // ── WRAITH ─────────────────────────────────────────────────
      case 'phase': {
        const d = tacDef;
        st.data.speed  = d.speed;
        st.data.invuln = true;
        ent.vel.copy(ent.fwd.clone().multiplyScalar(d.speed ?? 30));
        Ev.emit('ability:used', { ent, id: 'phase' });
        break;
      }

      case 'portal': {
        const d     = ultDef;
        const entry = ent.pos.clone();
        st.data.entry  = entry;
        st.data.exit   = null;
        st.data.placed = false;

        const p = new THREE.Mesh(
          new THREE.TorusGeometry(.8, .08, 8, 16),
          new THREE.MeshStandardMaterial({ color: 0x9b59b6, emissive: 0x9b59b6, emissiveIntensity: .4 }),
        );
        p.position.copy(entry);
        p.position.y += 1;
        p.rotation.x = Math.PI / 2;
        scene.add(p);
        st.data.entryMesh = p;
        AbilFX.objects.push({ mesh: p, timer: (d.duration ?? 10) + 5 });
        Ev.emit('ability:used', { ent, id: 'portal' });
        break;
      }

      // ── SEER ───────────────────────────────────────────────────
      case 'focus': {
        const d   = tacDef;
        const dir = ent.fwd;
        for (const e of allEnts) {
          if (e.squadId === ent.squadId || e.life !== LifeState.ALIVE) continue;
          const toE  = e.pos.clone().sub(ent.pos).normalize();
          const dot  = dir.x * toE.x + dir.z * toE.z;
          const dist = ent.pos.distanceTo(e.pos);
          if (dot > Math.cos(THREE.MathUtils.degToRad(d.angle ?? 45)) && dist < (d.range ?? 30)) {
            e._revealed    = true;
            e._revealTimer = d.duration ?? 4;
          }
        }
        Ev.emit('ability:used', { ent, id: 'focus' });
        break;
      }

      case 'exhibit': {
        const d = ultDef;
        st.data.center = ent.pos.clone();
        st.data.radius = d.radius;

        const dome = new THREE.Mesh(
          new THREE.SphereGeometry(d.radius ?? 25, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: 0x5ab8f5, transparent: true, opacity: .06, side: THREE.DoubleSide, depthWrite: false }),
        );
        dome.position.copy(ent.pos);
        scene.add(dome);
        st.data.dome = dome;
        AbilFX.objects.push({ mesh: dome, timer: (d.duration ?? 12) + 1 });
        Ev.emit('ability:used', { ent, id: 'exhibit' });
        break;
      }

      // ── LIFELINE ───────────────────────────────────────────────
      case 'drone': {
        const d = tacDef;
        st.data.pos    = ent.pos.clone();
        st.data.hps    = d.hps;
        st.data.radius = d.radius;

        const drone = new THREE.Mesh(
          new THREE.OctahedronGeometry(.3),
          new THREE.MeshStandardMaterial({ color: 0x5af5a6, emissive: 0x5af5a6, emissiveIntensity: .4 }),
        );
        drone.position.copy(ent.pos);
        drone.position.y += 1.5;
        scene.add(drone);
        st.data.mesh = drone;

        const light = new THREE.PointLight(0x5af5a6, .5, d.radius ?? 6);
        light.position.copy(drone.position);
        scene.add(light);
        st.data.light = light;

        AbilFX.objects.push(
          { mesh: drone, timer: (d.duration ?? 8) + 1 },
          { mesh: light, timer: (d.duration ?? 8) + 1 },
        );
        Ev.emit('ability:used', { ent, id: 'drone' });
        break;
      }

      case 'care_pkg': {
        const d = ultDef;
        st.data.pos     = ent.pos.clone();
        st.data.delay   = d.delay;
        st.data.dropped = false;
        Ev.emit('ability:used', { ent, id: 'care_pkg' });
        break;
      }

      // ── CATALYST ───────────────────────────────────────────────
      case 'spikes': {
        const d   = tacDef;
        const pos = ent.pos.clone().add(ent.fwd.clone().multiplyScalar(5));
        st.data.center   = pos;
        st.data.radius   = d.radius;
        st.data.slowMult = d.slowMult;

        const zone = new THREE.Mesh(
          new THREE.CylinderGeometry(d.radius ?? 5, d.radius ?? 5, .05, 16),
          new THREE.MeshBasicMaterial({ color: 0xf5c842, transparent: true, opacity: .15 }),
        );
        zone.position.copy(pos);
        zone.position.y += .03;
        scene.add(zone);
        st.data.mesh = zone;
        AbilFX.objects.push({ mesh: zone, timer: (d.duration ?? 8) + 1 });
        Ev.emit('ability:used', { ent, id: 'spikes' });
        break;
      }

      case 'wall': {
        const wallDef = ultDef as UltimateDef & { width: number; height: number };
        const pos      = ent.pos.clone().add(ent.fwd.clone().multiplyScalar(6));
        st.data.center = pos;

        const geo  = new THREE.BoxGeometry(wallDef.width, wallDef.height, .4);
        const mat  = new THREE.MeshStandardMaterial({ color: 0xf5c842, transparent: true, opacity: .7, roughness: .4, metalness: .3 });
        const wall = new THREE.Mesh(geo, mat);
        wall.position.copy(pos);
        wall.position.y = wallDef.height / 2;
        wall.rotation.y = ent.yaw;
        wall.castShadow = true;
        scene.add(wall);

        col.walls.push(wall);
        col.ground.push(wall);
        col.rebuild();
        st.data.mesh = wall;

        AbilFX.objects.push({
          mesh: wall,
          timer: (def.duration ?? 20) + 1,
          removeCb: () => {
            col.walls = col.walls.filter(m => m !== wall);
            col.ground = col.ground.filter(m => m !== wall);
            col.rebuild();
          },
        });
        Ev.emit('ability:used', { ent, id: 'wall' });
        break;
      }
    }

    return true;
  },

  /**
   * Per-frame tick for active ability effects (drone heals, spikes slow,
   * airstrike countdown, exhibit reveal, portal teleport, wall pulse, etc.).
   *
   * @param ent     - The entity whose abilities are being ticked
   * @param dt      - Delta time in seconds
   * @param allEnts - All entities in the match
   * @param time    - Current game time in seconds (used for animations)
   */
  tickEffects(ent: AbilEntity, dt: number, allEnts: AbilEntity[], time: number): void {
    const as = ent.abil;
    if (!as) return;

    // ── Tactical active effects ──
    if (as.tac.active) {
      const def = as.hero.tactical;
      switch (def.id) {

        case 'drone':
          if (as.tac.data.mesh) {
            as.tac.data.mesh.rotation.y = time * 3;
            as.tac.data.mesh.position.y = as.tac.data.pos.y + 1.5 + Math.sin(time * 2) * .15;
            if (as.tac.data.light) {
              (as.tac.data.light as THREE.Object3D).position.copy(as.tac.data.mesh.position);
            }
          }
          for (const e of allEnts) {
            if (e.squadId === ent.squadId && e.life === LifeState.ALIVE && e.pos.distanceTo(as.tac.data.pos) < as.tac.data.radius) {
              e.hp = Math.min(e.hp + as.tac.data.hps * dt, MAX_HP);
            }
          }
          break;

        case 'spikes':
          for (const e of allEnts) {
            if (e.squadId !== ent.squadId && e.life === LifeState.ALIVE && e.pos.distanceTo(as.tac.data.center) < as.tac.data.radius) {
              e._slowMult = as.tac.data.slowMult;
            }
          }
          break;
      }
    }

    // ── Ultimate active effects ──
    if (as.ult.active) {
      const def = as.hero.ultimate;
      switch (def.id) {

        case 'airstrike':
          if (!as.ult.data.detonated) {
            as.ult.data.delay -= dt;
            if (as.ult.data.delay <= 0) {
              as.ult.data.detonated = true;
              for (const e of allEnts) {
                if (e.squadId !== ent.squadId && e.life === LifeState.ALIVE && e.pos.distanceTo(as.ult.data.target) < as.ult.data.radius) {
                  e.takeDmg(as.ult.data.damage, ent, false);
                }
              }
              Ev.emit('ability:explosion', { pos: as.ult.data.target.clone() });
            }
          }
          break;

        case 'exhibit':
          for (const e of allEnts) {
            if (e.squadId !== ent.squadId && e.life === LifeState.ALIVE && e.pos.distanceTo(as.ult.data.center) < as.ult.data.radius && e.hSpd > .5) {
              e._revealed    = true;
              e._revealTimer = Math.max(e._revealTimer || 0, 1);
            }
          }
          if (as.ult.data.dome) {
            (as.ult.data.dome as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>).material.opacity = .04 + Math.sin(time * 3) * .02;
          }
          break;

        case 'care_pkg':
          if (!as.ult.data.dropped) {
            as.ult.data.delay -= dt;
            if (as.ult.data.delay <= 0) {
              as.ult.data.dropped = true;
              // Spawn notification — callers should listen to 'ability:care_pkg_ready'
              // and handle loot node creation (avoids dependency on loot system here).
              Ev.emit('ability:care_pkg_ready', { ent, pos: as.ult.data.pos.clone() });
            }
          }
          break;

        case 'portal':
          // Place exit portal 0.5s after activation (first movement away from entry)
          if (!as.ult.data.placed && as.ult.timer < (as.hero.ultimate.duration ?? 10) - .5) {
            as.ult.data.exit   = ent.pos.clone();
            as.ult.data.placed = true;

            const p2 = new THREE.Mesh(
              new THREE.TorusGeometry(.8, .08, 8, 16),
              new THREE.MeshStandardMaterial({ color: 0x9b59b6, emissive: 0x9b59b6, emissiveIntensity: .4 }),
            );
            p2.position.copy(as.ult.data.exit);
            p2.position.y += 1;
            p2.rotation.x = Math.PI / 2;
            // NOTE: portal exit mesh is added via scene passed to activate();
            // here we emit an event so callers can add it to the scene if needed.
            Ev.emit('ability:portal_exit', { ent, mesh: p2, timer: as.ult.timer + 1 });
            AbilFX.objects.push({ mesh: p2, timer: as.ult.timer + 1 });
          }

          // Teleport allies near entry ↔ exit
          if (as.ult.data.placed && as.ult.data.entry && as.ult.data.exit) {
            for (const e of allEnts) {
              if (e.squadId === ent.squadId && e.life === LifeState.ALIVE) {
                if (e.pos.distanceTo(as.ult.data.entry) < 1.5 && !e._portalCd) {
                  e.pos.copy(as.ult.data.exit);
                  e._portalCd = 2;
                } else if (e.pos.distanceTo(as.ult.data.exit) < 1.5 && !e._portalCd) {
                  e.pos.copy(as.ult.data.entry);
                  e._portalCd = 2;
                }
                if (e._portalCd) {
                  e._portalCd -= dt;
                  if (e._portalCd <= 0) e._portalCd = 0;
                }
              }
            }
          }
          break;

        case 'wall':
          if (as.ult.data.mesh) {
            (as.ult.data.mesh as THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>).material.opacity = .5 + Math.sin(time * 2) * .15;
          }
          break;
      }
    }

    // Reveal timer decay — used by Seer scan and exhibit
    for (const e of allEnts) {
      if (e._revealTimer > 0) {
        e._revealTimer -= dt;
        if (e._revealTimer <= 0) {
          e._revealed    = false;
          e._revealTimer = 0;
        }
      }
    }

    // _slowMult is cleared each frame and reapplied by spikes tick above
    // (no-op here — matches the v6 comment at line 434)
  },

  /**
   * Remove expired FX objects from the scene and call their removeCb if present.
   * Call once per frame after tickEffects.
   *
   * @param dt    - Delta time in seconds
   * @param scene - Three.js scene to remove objects from
   */
  tickFX(dt: number, scene: THREE.Scene): void {
    for (let i = AbilFX.objects.length - 1; i >= 0; i--) {
      const o = AbilFX.objects[i];
      o.timer -= dt;
      if (o.timer <= 0) {
        scene.remove(o.mesh);
        if (o.removeCb) o.removeCb();
        AbilFX.objects.splice(i, 1);
      }
    }
  },

  /**
   * Get the combined speed multiplier for an entity from active abilities.
   * Applies stim boost and catalyst spikes slow.
   * Resets _slowMult to 1 after reading (must be called once per frame).
   *
   * @param ent - The entity to query
   * @returns Multiplier (1.0 = normal speed)
   */
  getSpeedMult(ent: AbilEntity): number {
    let m = 1;
    if (ent.abil?.tac.active && ent.abil.hero.tactical.id === 'stim') {
      m *= ent.abil.tac.data.speedMult || 1;
    }
    if (ent._slowMult && ent._slowMult < 1) {
      m *= ent._slowMult;
    }
    ent._slowMult = 1; // reset each frame
    return m;
  },

  /**
   * Get the recoil multiplier from active stim (Forge tactical).
   *
   * @param ent - The entity to query
   * @returns Multiplier (1.0 = normal recoil, 0.5 during stim)
   */
  getRecoilMult(ent: AbilEntity): number {
    if (ent.abil?.tac.active && ent.abil.hero.tactical.id === 'stim') {
      return ent.abil.tac.data.recoilMult || 1;
    }
    return 1;
  },

  /**
   * Check if an entity is currently invulnerable (Wraith phase walk).
   *
   * @param ent - The entity to check
   * @returns true if the entity cannot take damage right now
   */
  isInvuln(ent: AbilEntity): boolean {
    return !!(ent.abil?.tac.active && ent.abil.hero.tactical.id === 'phase');
  },

  /**
   * Get the revive time multiplier for an entity.
   * Lifeline's Combat Revive passive reduces revive time to 60% (3s → ~1.8s).
   *
   * @param ent - The entity performing or receiving the revive
   * @returns 0.6 for Lifeline, 1.0 for everyone else
   */
  getRevTimeMult(ent: AbilEntity): number {
    return ent.abil?.hero.passive.id === 'fast_rev' ? .6 : 1;
  },
};
