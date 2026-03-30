/**
 * World geometry builder — extracted from v6-heroes.html World class (line 524).
 * Constructs all map POIs, lighting, and populates traversal/loot objects.
 */

import * as THREE from 'three';
import { Zipline, JumpPad, Door } from './traversal';
import { LootBin } from './loot';
import { CollisionSystem } from '../core/collision';

/* ── Zone definitions for callout names ── */

interface Zone {
  name: string;
  min: [number, number];
  max: [number, number];
}

const ZONES: Zone[] = [
  { name: 'The Spire',     min: [-10, -10], max: [10, 10] },
  { name: 'North Bunker',  min: [-12, -65], max: [12, -45] },
  { name: 'Cargo Yard',    min: [40, -20],  max: [65, 18] },
  { name: 'West Ruins',    min: [-70, -18], max: [-45, 25] },
  { name: 'South Ridge',   min: [-15, 42],  max: [15, 68] },
];

/**
 * Get the named zone at a world position.
 * @returns Zone name or 'Open Ground' if outside all named zones
 */
export function getZone(pos: THREE.Vector3): string {
  for (const z of ZONES) {
    if (pos.x >= z.min[0] && pos.x <= z.max[0] && pos.z >= z.min[1] && pos.z <= z.max[1]) {
      return z.name;
    }
  }
  return 'Open Ground';
}

/** All traversal/interactable objects created by the world builder */
export interface WorldObjects {
  ziplines: Zipline[];
  jumpPads: JumpPad[];
  doors: Door[];
  lootBins: LootBin[];
}

/**
 * Build the entire game world: ground, POIs, cover, lighting.
 * Populates the collision system with wall and ground meshes.
 * @param scene - THREE.Scene to add geometry to
 * @param col - Collision system to register walls/ground with
 * @returns All traversal and interactable objects
 */
export function buildWorld(scene: THREE.Scene, col: CollisionSystem): WorldObjects {
  const walls: THREE.Mesh[] = [];
  const grounds: THREE.Mesh[] = [];
  const ziplines: Zipline[] = [];
  const jumpPads: JumpPad[] = [];
  const doors: Door[] = [];
  const lootBins: LootBin[] = [];

  // ── Materials ──
  const mFloor = new THREE.MeshStandardMaterial({ color: 0x12121c, roughness: 0.92 });
  const mWall  = new THREE.MeshStandardMaterial({ color: 0x202033, roughness: 0.7 });
  const mPlat  = new THREE.MeshStandardMaterial({ color: 0x1a1a2a, roughness: 0.7 });
  const mRamp  = new THREE.MeshStandardMaterial({ color: 0x222240, roughness: 0.8 });
  const mMetal = new THREE.MeshStandardMaterial({ color: 0x302818, roughness: 0.6 });
  const mCrate = new THREE.MeshStandardMaterial({ color: 0x2c2820, roughness: 0.6 });
  const mAccent = new THREE.MeshStandardMaterial({
    color: 0xe8c547, roughness: 0.3, metalness: 0.4,
    emissive: 0xe8c547, emissiveIntensity: 0.15,
  });

  // Add emissive accent strips to walls and platforms
  const mWallAccent = new THREE.MeshStandardMaterial({
    color: 0xe8c547, roughness: 0.3, metalness: 0.5,
    emissive: 0xe8c547, emissiveIntensity: 0.4,
  });
  const mPlatAccent = new THREE.MeshStandardMaterial({
    color: 0x5ab8f5, roughness: 0.3, metalness: 0.5,
    emissive: 0x5ab8f5, emissiveIntensity: 0.3,
  });

  /** Helper: place a box and register with collision */
  const box = (
    w: number, h: number, d: number,
    mat: THREE.MeshStandardMaterial,
    pos: [number, number, number],
    collide = true,
  ): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(pos[0], pos[1], pos[2]);
    m.receiveShadow = true;
    m.castShadow = true;
    scene.add(m);
    if (collide) {
      walls.push(m);
      grounds.push(m);
    }
    return m;
  };

  /** Helper: place a ramp (extruded triangle) */
  const ramp = (
    length: number, h: number, w: number,
    mat: THREE.MeshStandardMaterial,
    pos: [number, number, number],
    ry = 0,
  ): void => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(length, 0);
    shape.lineTo(length, h);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
    geo.translate(0, 0, -w / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos[0], pos[1], pos[2]);
    m.rotation.y = ry;
    m.receiveShadow = true;
    m.castShadow = true;
    scene.add(m);
    walls.push(m);
    grounds.push(m);
  };

  // ── Ground plane with grid + bump texture ──
  const gridCanvas = document.createElement('canvas');
  gridCanvas.width = 512;
  gridCanvas.height = 512;
  const gCtx = gridCanvas.getContext('2d')!;
  gCtx.fillStyle = '#12121c';
  gCtx.fillRect(0, 0, 512, 512);
  gCtx.strokeStyle = 'rgba(232, 197, 71, 0.04)';
  gCtx.lineWidth = 1;
  for (let i = 0; i <= 512; i += 512 / 22) {
    gCtx.beginPath(); gCtx.moveTo(i, 0); gCtx.lineTo(i, 512); gCtx.stroke();
    gCtx.beginPath(); gCtx.moveTo(0, i); gCtx.lineTo(512, i); gCtx.stroke();
  }
  const gridTex = new THREE.CanvasTexture(gridCanvas);
  gridTex.wrapS = gridTex.wrapT = THREE.RepeatWrapping;
  gridTex.repeat.set(22, 22);

  // Procedural bump map for ground surface detail
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = 256;
  bumpCanvas.height = 256;
  const bCtx = bumpCanvas.getContext('2d')!;
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, 256, 256);
  // Subtle noise pattern
  for (let y = 0; y < 256; y += 2) {
    for (let x = 0; x < 256; x += 2) {
      const v = 120 + Math.random() * 16;
      bCtx.fillStyle = `rgb(${v},${v},${v})`;
      bCtx.fillRect(x, y, 2, 2);
    }
  }
  const bumpTex = new THREE.CanvasTexture(bumpCanvas);
  bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping;
  bumpTex.repeat.set(22, 22);

  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x12121c, roughness: 0.92, map: gridTex,
    bumpMap: bumpTex, bumpScale: 0.02,
  });
  const ground = new THREE.Mesh(new THREE.BoxGeometry(200, 0.5, 200), groundMat);
  ground.position.set(0, -0.25, 0);
  ground.receiveShadow = true;
  scene.add(ground);
  walls.push(ground);
  grounds.push(ground);

  // ── The Spire (center) ──
  box(16, 0.3, 16, mPlat, [0, 0.15, 0]);
  box(12, 0.3, 12, mPlat, [0, 4.5, 0]);
  box(7, 0.3, 7, mPlat, [0, 8, 0]);
  for (const [x, z] of [[-7, -7], [7, -7], [-7, 7], [7, 7]] as [number, number][]) {
    box(0.5, 4.5, 0.5, mWall, [x, 2.25, z]);
    // Gold accent strip on pillars
    box(0.08, 4.5, 0.55, mWallAccent, [x + 0.28, 2.25, z], false);
  }
  ramp(9, 4.5, 3.5, mRamp, [0, 0, 11], 0);
  ramp(7, 3.5, 2.5, mRamp, [0, 4.5, -7], Math.PI);
  box(5, 1, 0.3, mMetal, [-3, 5, 5]);
  box(5, 1, 0.3, mMetal, [3, 5, -5]);
  // Platform edge accent strips
  box(16, 0.06, 0.06, mWallAccent, [0, 0.32, 8], false);
  box(16, 0.06, 0.06, mWallAccent, [0, 0.32, -8], false);
  box(12, 0.06, 0.06, mPlatAccent, [0, 4.62, 6], false);
  box(12, 0.06, 0.06, mPlatAccent, [0, 4.62, -6], false);
  ziplines.push(new Zipline(scene, new THREE.Vector3(0, 8.5, 0), new THREE.Vector3(35, 2, 15)));
  ziplines.push(new Zipline(scene, new THREE.Vector3(-3, 8.5, -3), new THREE.Vector3(-5, 1, -45)));
  jumpPads.push(new JumpPad(scene, new THREE.Vector3(7, 0, 0), new THREE.Vector3(1, 0.5, 0)));

  // ── North Bunker ──
  box(18, 0.3, 14, mPlat, [0, 0.15, -55]);
  box(0.3, 3.5, 14, mWall, [-9, 1.75, -55]);
  box(0.3, 3.5, 14, mWall, [9, 1.75, -55]);
  box(18, 0.3, 14, mPlat, [0, 3.5, -55]);
  // Bunker wall accent strips
  box(0.08, 0.06, 14, mPlatAccent, [-9.18, 1.75, -55], false);
  box(0.08, 0.06, 14, mPlatAccent, [9.18, 1.75, -55], false);
  box(3, 1.3, 0.3, mMetal, [0, 0.65, -52]);
  box(3, 1.3, 0.3, mMetal, [-4, 0.65, -58]);
  doors.push(new Door(scene, new THREE.Vector3(-4, 0, -48), 2.5, 2.8, 'z', { w: walls, g: grounds, rebuild: () => {} }));
  doors.push(new Door(scene, new THREE.Vector3(4, 0, -48), 2.5, 2.8, 'z', { w: walls, g: grounds, rebuild: () => {} }));
  lootBins.push(new LootBin(scene, new THREE.Vector3(-6, 0, -53)));
  lootBins.push(new LootBin(scene, new THREE.Vector3(6, 0, -57)));

  // ── Cargo Yard ──
  for (const [x, z] of [[50, -8], [53, -4], [50, 2], [55, 6], [52, 10]] as [number, number][]) {
    box(2, 2, 2, mCrate, [x, 1, z]);
  }
  box(2, 2, 2, mCrate, [50, 3, -8]);
  box(8, 0.3, 6, mPlat, [52, 4, 8]);
  ramp(5, 4, 3, mRamp, [47, 0, 8], 0);
  ziplines.push(new Zipline(scene, new THREE.Vector3(50, 5.5, -8), new THREE.Vector3(52, 4.5, 14)));
  lootBins.push(new LootBin(scene, new THREE.Vector3(48, 0, 0)));

  // ── West Ruins ──
  box(0.4, 3, 12, mWall, [-58, 1.5, -5]);
  box(0.4, 3, 12, mWall, [-52, 1.5, -5]);
  box(6, 0.3, 12, mPlat, [-55, 3, -5]);
  doors.push(new Door(scene, new THREE.Vector3(-55, 0, 1), 2.5, 2.5, 'x', { w: walls, g: grounds, rebuild: () => {} }));
  box(10, 0.3, 10, mPlat, [-62, 0.15, 18]);
  box(10, 0.3, 10, mPlat, [-62, 3.5, 18]);
  for (const [x, z] of [[-67, 13], [-57, 13], [-67, 23], [-57, 23]] as [number, number][]) {
    box(0.4, 3.5, 0.4, mWall, [x, 1.75, z]);
  }
  doors.push(new Door(scene, new THREE.Vector3(-62, 0, 13), 3, 3, 'z', { w: walls, g: grounds, rebuild: () => {} }));
  ziplines.push(new Zipline(scene, new THREE.Vector3(-55, 3.5, -3), new THREE.Vector3(-62, 4, 18)));
  lootBins.push(new LootBin(scene, new THREE.Vector3(-56, 0, -8)));

  // ── South Ridge ──
  ramp(22, 6, 14, mRamp, [0, 0, 48], 0);
  box(12, 0.4, 8, mPlat, [0, 6, 62]);
  box(12, 1.2, 0.25, mWall, [0, 6.8, 58]);
  jumpPads.push(new JumpPad(scene, new THREE.Vector3(0, 6.1, 64), new THREE.Vector3(0, 1, -1)));

  // ── Scattered cover ──
  for (const [x, z] of [
    [-30, -30], [30, -30], [-30, 30], [30, 30],
    [-18, 0], [18, 0], [0, -22], [0, 22],
    [-42, -38], [42, -38],
  ] as [number, number][]) {
    const w = 1.2 + Math.random() * 1.5;
    box(w, 1.2, 0.3, mMetal, [x, 0.6, z]);
  }

  // ── Lighting ──
  scene.add(new THREE.AmbientLight(0x3a3a55, 0.45));
  const dl = new THREE.DirectionalLight(0xffeedd, 0.8);
  dl.position.set(30, 45, 15);
  dl.castShadow = true;
  dl.shadow.mapSize.set(1024, 1024);
  dl.shadow.camera.near = 1;
  dl.shadow.camera.far = 120;
  dl.shadow.camera.left = -60;
  dl.shadow.camera.right = 60;
  dl.shadow.camera.top = 60;
  dl.shadow.camera.bottom = -60;
  scene.add(dl);
  scene.add(new THREE.HemisphereLight(0x5577aa, 0x222244, 0.2));
  const spireLight = new THREE.PointLight(0xe8c547, 0.35, 16);
  spireLight.position.set(0, 8, 0);
  scene.add(spireLight);

  // Exponential fog for atmospheric depth
  scene.fog = new THREE.FogExp2(0x07070d, 0.008);

  // ── Register with collision system ──
  col.walls = walls;
  col.ground = grounds;
  col.rebuild();

  // Patch door collision refs to use the real arrays + rebuild
  for (const door of doors) {
    (door as any).col = { w: walls, g: grounds, rebuild: () => col.rebuild() };
  }

  return { ziplines, jumpPads, doors, lootBins };
}
