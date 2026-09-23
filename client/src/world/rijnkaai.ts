import * as THREE from "three";
import { psx, psxUniforms, MAX_LAMPS } from "../retro/psx";
import { makeTextures, signTexture, glowTexture, type Textures } from "./textures";
import { box, cyl, rod, rectAround, inRect, type Rect } from "./geom";
import SPOT_TABLE from "../../../shared/spots.json";
import { buildCity, doorSpot, edgeZ, WALL, WATER, OUTSIDE, type CityWorld } from "./city";
import { dressCity, loadProps } from "./props3d";

// The Rijnkaai in the real 1873 city (world/city.ts). Water is at z < 0, the
// quay edge runs along x (the world is turned 19 deg so it does). Quay top is
// y = 0. Here: the game's own things on the quay (pier, crane, ship, lamps,
// goods) and the rules for walking; the city itself comes from Blender.

export const WATER_Y = -1.8;
/** Before the walk map is loaded, only the open quay by the start counts as ground. */
const QUAY = { minX: -50, maxX: 60, minZ: 0.8, maxZ: 40 };
const PIER = { minX: 5.4, maxX: 8.6, minZ: -11.6, maxZ: 0.6 };
/** Ship A (the Anna Maria) lies at x -60..-20, z -11.7..-2.7, off the Quai Tavernier; its deck is at y 2.4. */
const SHIP_X = -60;
export const DECK = { minX: SHIP_X + 2, maxX: SHIP_X + 28.5, minZ: -11.2, maxZ: -3.1, y: 2.4 };
/** The gangway: a plank from the quay (y 0) up to the deck (z -3.1, y 2.4). */
export const RAMP = { x: SHIP_X + 18, halfW: 0.45, zLow: 3.8, zHigh: -3.1 };

export type Surface = "stone" | "wood";

/** Named places for jobs, shared with the server (shared/spots.json). */
export interface Spot {
  label: string;
  desc: string;
  x: number;
  z: number;
  /** Direction goods stack away from the spot, as a unit vector on the ground. */
  dir: [number, number];
}
export const SPOTS = Object.fromEntries(
  Object.entries(SPOT_TABLE).filter(([k]) => !k.startsWith("_")),
) as unknown as Record<string, Spot>;

/** The hiring spot: a notice board by the Hessenatie's door. */
const boardAt = doorSpot("hessenatie", 3.2, 5);
export const BOARD_POS = { x: boardAt.x, z: boardAt.z };
/** The doss house door (M5), on the canal side of the Quai Ste-Aldegonde row. */
const dossAt = doorSpot("doss", 1.2);
export const DOSS_POS = { x: dossAt.x, z: dossAt.z };

/** Light through the day (M5). Hour, fog colour, sky light, fog far, gas lamps lit 0-1. */
const DAYLIGHT: Array<[number, number, number, number, number]> = [
  [0, 0x171b21, 0.38, 19, 1],
  [5.5, 0x1a1e25, 0.42, 19, 1],
  [7, 0x343a42, 1.0, 22, 0.7],
  [9, 0x5e6870, 2.1, 30, 0],
  [15, 0x5e6870, 2.1, 30, 0],
  [17, 0x4b4540, 1.3, 25, 0.4],
  [18.5, 0x2c2e34, 0.65, 21, 1],
  [21, 0x1a1e25, 0.42, 19, 1],
  [24, 0x171b21, 0.38, 19, 1],
];

export interface Lamp {
  pos: THREE.Vector3;
  light: THREE.PointLight;
  glass: THREE.Mesh;
  halo: THREE.Sprite;
  seed: number;
  broken: boolean;
  level: number;
}

export interface World {
  scene: THREE.Scene;
  lamps: Lamp[];
  shipPositions: THREE.Vector3[];
  /** Try to move from (x,z) by (dx,dz); returns the allowed position (slides on walls). */
  move(x: number, z: number, dx: number, dz: number, radius: number, feet?: number): [number, number];
  /** Height of what you stand on at (x, z), given your feet height. */
  groundAt(x: number, z: number, radius: number, feet: number): number;
  /** Colliders that come and go (job crates). */
  addCollider(r: Rect): void;
  removeCollider(r: Rect): void;
  /** Can something of radius r stand here? */
  isFree(x: number, z: number, r: number, feet?: number): boolean;
  /** Open water (off the quay edge, off the pier)? */
  isWater(x: number, z: number): boolean;
  /** Height of the walkable surface (quay 0, gangway slope, ship deck). */
  baseAt(x: number, z: number): number;
  /** Path check from a start point; see CLAUDE.md. */
  reachFrom(x: number, z: number): (x: number, z: number, reach: number) => boolean;
  /** Thick fog for a job twist; eases in and out. */
  setThickFog(on: boolean): void;
  /** The city of 1873: houses, walk map. */
  city: CityWorld;
  /** Hour of the day, 0-24 with fractions: fog, sky light and gas lamps follow (M5). */
  setTimeOfDay(hour: number): void;
  /** The day's weather: how far you see and how much the lamps glow in the air. */
  setWeather(w: "fog" | "mist" | "clear"): void;
  /** Dev: no fog, noon light, every chunk shown (fly mode). */
  setDevView(on: boolean): void;
  mats: Mats;
  surfaceAt(x: number, z: number): Surface;
  update(t: number, dt: number, camera?: THREE.Camera): void;
}

// Thin details that sit on a wall or the ground (windows, doors, rails, planks).
// Vertex snap moves close surfaces by different amounts, so they would flicker
// through each other. A depth offset makes the detail always win.
const DECAL = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };

function mats(tex: Textures) {
  const lambert = (map: THREE.Texture, color = 0xffffff) => psx(new THREE.MeshLambertMaterial({ map, color }));
  const decal = (map: THREE.Texture, color = 0xffffff) =>
    psx(new THREE.MeshLambertMaterial({ map, color, ...DECAL }));
  return {
    wallDecal: decal(tex.quayWall),
    chalk: psx(new THREE.MeshLambertMaterial({ color: 0xbdb6a0, ...DECAL })),
    woodDecal: decal(tex.planks, 0x5a5048),
    ironDecal: decal(tex.iron),
    planksDecal: psx(
      new THREE.MeshPhongMaterial({ map: tex.planks, color: 0xb0b0b0, specular: 0x1a1a1a, shininess: 10, ...DECAL }),
    ),
    cobble: psx(
      new THREE.MeshPhongMaterial({ map: tex.cobble, color: 0xffffff, specular: 0x2a2a2a, shininess: 18 }),
      { affine: 0.75 },
    ),
    quayWall: lambert(tex.quayWall),
    brick: lambert(tex.brick),
    brickDark: lambert(tex.brick, 0x8a8a8a),
    planks: psx(new THREE.MeshPhongMaterial({ map: tex.planks, color: 0xb0b0b0, specular: 0x1a1a1a, shininess: 10 })),
    darkWood: lambert(tex.planks, 0x5a5048),
    iron: lambert(tex.iron),
    hull: lambert(tex.hull),
    crate: lambert(tex.crate),
    slate: lambert(tex.slate),
    sack: lambert(tex.sack),
    rope: lambert(tex.rope),
    window: psx(new THREE.MeshLambertMaterial({ color: 0x0b0d10, ...DECAL })),
    litWindow: psx(new THREE.MeshBasicMaterial({ color: 0x6a4a22, ...DECAL })),
    rigging: psx(new THREE.MeshLambertMaterial({ color: 0x1a1816 })),
    water: psx(
      new THREE.MeshPhongMaterial({
        map: tex.water,
        color: 0xa8b8aa,
        specular: 0x605440,
        shininess: 90,
      }),
      { water: true, affine: 0.6 },
    ),
    lampGlass: new THREE.MeshBasicMaterial({ color: 0xffc070, fog: false }),
    sky: psx(new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide }), { noSnap: true }),
  };
}

export type Mats = ReturnType<typeof mats>;

export function buildRijnkaai(): World {
  const scene = new THREE.Scene();
  const fogColor = new THREE.Color(0x3e464d);
  scene.fog = new THREE.Fog(fogColor, 3, 25);
  scene.background = fogColor;

  const tex = makeTextures();
  const m = mats(tex);
  const colliders: Rect[] = [];

  // cold light from a sky nobody can see
  const skyLight = new THREE.HemisphereLight(0x8494a6, 0x2a2822, 1.1);
  scene.add(skyLight);
  // a low sun from the south-west, weak through fog, gives walls and roofs their form
  const sun = new THREE.DirectionalLight(0xfff0d8, 0);
  sun.position.set(-0.75, 0.9, 0.55);
  scene.add(sun);
  scene.add(sun.target);
  let sunDay = 0;

  // --- sky dome: takes the fog colour and the lamp glow in the air
  const sky = new THREE.Mesh(new THREE.SphereGeometry(460, 16, 8), m.sky);
  scene.add(sky);

  // --- the city: ground, quay walls, houses (world/city.ts)
  const city = buildCity(scene, m, WATER_Y);
  // carts, barrels and sacks along the quays and on the squares (Blender models, props3d.ts)
  city.ready.then(() => dressCity(scene, city.flags)).then((d) => colliders.push(...d.colliders)).catch(() => {});

  // --- water: one sheet that goes where you go, under the land; it moves in
  // whole texture tiles (4 m), so the ripples stay put on the water
  const WATER_SIZE = 720;
  const WATER_TILE = 4;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE, 180, 180), m.water);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, WATER_Y, 0);
  const wuv = water.geometry.getAttribute("uv");
  for (let i = 0; i < wuv.count; i++) wuv.setXY(i, wuv.getX(i) * (WATER_SIZE / WATER_TILE), wuv.getY(i) * (WATER_SIZE / WATER_TILE));
  scene.add(water);
  const waterTex = tex.water;

  // --- wooden pier (flush with the quay)
  const pierDeck = box(4, 0.25, 11, m.planks, 7, -0.125, -6.5, 3); // z -12..-1, wall top covers -1..0
  scene.add(pierDeck);
  for (let z = -11.5; z <= -0.5; z += 2.75) {
    for (const x of [5.2, 8.8]) scene.add(cyl(0.16, 0.18, 3.2, 6, m.darkWood, x, -1.7, z));
  }
  scene.add(cyl(0.2, 0.22, 1.0, 6, m.darkWood, 5.4, 0.4, -11.4));
  scene.add(cyl(0.2, 0.22, 1.0, 6, m.darkWood, 8.6, 0.4, -11.4));

  // --- signs on the real houses where the game's people work
  doorSign(scene, "hessenatie", "HESSENATIE");
  doorSign(scene, "peeters", "WED. PEETERS");
  doorSign(scene, "entrepot", "ENTREPOT");

  // --- crane
  crane(scene, m, colliders, -24, 1.6);

  // --- props
  crateStack(scene, m, colliders, -20, 14, 3);
  crateStack(scene, m, colliders, -14.6, 15.2, 2);
  crateStack(scene, m, colliders, 3, 3.4, 2);
  crateStack(scene, m, colliders, 36, 18, 3);
  crateStack(scene, m, colliders, 41, 16.5, 1);
  crateStack(scene, m, colliders, -52, 12, 2);
  barrels(scene, m, colliders, -44, 18, 5);
  barrels(scene, m, colliders, 30, 5, 3);
  barrels(scene, m, colliders, -6, 4.2, 2);
  sacks(scene, m, colliders, 14, 19.5);
  sacks(scene, m, colliders, -34, 17);
  // on the Rijnkaai: a loaded handcart by the cart stand and a dray with its horse
  loadProps()
    .then((p) => {
      for (const [name, x, z, yaw] of [["handcart_loaded", 47, 12, 0.5], ["dray_horse", 58, 30, 1.9]] as const) {
        p.place(name, x, z, yaw, scene);
        colliders.push(...p.colliders(name, x, z, yaw));
      }
    })
    .catch(() => cart(scene, m, colliders, 47, 11));
  for (let x = -54; x <= 54; x += 9) {
    if (x > 3 && x < 11) continue; // pier root
    if (Math.abs(x - RAMP.x) < 2) continue; // gangway foot
    const ez = edgeZ(x);
    if (ez > 6) continue; // the canal mouth
    bollard(scene, m, colliders, x, ez + 0.9);
    if (Math.abs(x - (SHIP_X + 4)) < 5 || Math.abs(x - (SHIP_X + 32)) < 5) ropeCoil(scene, m, x + 1.1, ez + 1.5);
  }

  // --- ships: dark walls in the fog
  const shipA = ship(scene, m, SHIP_X, -7.2, 40, 9, false, RAMP.x - SHIP_X);
  const shipB = ship(scene, m, -56, -26, 44, 10, true);
  // on ship A's deck: the deckhouse and the masts are in the way
  colliders.push({ minX: SHIP_X + 5.2, maxX: SHIP_X + 12.4, minZ: -9.2, maxZ: -5.2 });
  colliders.push(rectAround(SHIP_X + 19.2, -7.2, 0.3, 0.3));
  // gangway: a plank ramp from the quay up to ship A's rail
  {
    const ramp = rod(new THREE.Vector3(RAMP.x, 0.03, RAMP.zLow), new THREE.Vector3(RAMP.x, DECK.y + 0.03, RAMP.zHigh), 0.02, m.planks);
    ramp.scale.set(45, 1, 1); // a flat plank, 0.9 m wide
    scene.add(ramp);
    for (const s of [-0.5, 0.5]) {
      scene.add(rod(new THREE.Vector3(RAMP.x + s, 1.0, RAMP.zLow), new THREE.Vector3(RAMP.x + s, DECK.y + 1.0, RAMP.zHigh), 0.025, m.rope));
    }
  }
  // mooring lines from ship A to two bollards
  scene.add(rod(new THREE.Vector3(SHIP_X + 4, 2.3, -2.9), new THREE.Vector3(SHIP_X + 4, 0.5, edgeZ(SHIP_X + 4) + 0.9), 0.04, m.rope));
  scene.add(rod(new THREE.Vector3(SHIP_X + 36, 2.3, -2.9), new THREE.Vector3(SHIP_X + 32, 0.5, edgeZ(SHIP_X + 32) + 0.9), 0.04, m.rope));

  // --- gas lamps (6)
  const glow = glowTexture();
  const lampSpots: Array<[number, number, boolean]> = [
    [-48, 2.2, false],
    [-30, 2.2, false],
    [-10, 20.4, false],
    [4, 1.4, true], // the one that sputters
    [24, 2.2, false],
    [44, 19.8, false],
  ];
  // lamps on the quay stand a step back from the edge
  const lamps: Lamp[] = lampSpots.map(([x, z, broken], i) => gasLamp(scene, m, colliders, glow, x, z < 6 ? Math.max(z, edgeZ(x) + 1.6) : z, i, broken));
  const lantern = dossLantern(scene, m, glow);

  // --- movement rules
  const onRamp = (x: number, z: number) => Math.abs(x - RAMP.x) < RAMP.halfW && z < RAMP.zLow && z > RAMP.zHigh - 0.2;
  const onDeck = (x: number, z: number) => x > DECK.minX && x < DECK.maxX && z > DECK.minZ && z < DECK.maxZ;
  /** Height of the walkable surface itself: 0 on the quay and pier, a slope on the gangway, the deck on the ship. */
  const baseAt = (x: number, z: number) => {
    if (onDeck(x, z)) return DECK.y;
    if (onRamp(x, z)) return THREE.MathUtils.clamp((RAMP.zLow - z) / (RAMP.zLow - RAMP.zHigh), 0, 1) * DECK.y;
    return 0;
  };
  const onPier = (x: number, z: number) => x > PIER.minX && x < PIER.maxX && z > PIER.minZ && z < PIER.maxZ;
  const isWalkable = (x: number, z: number) => {
    if (onPier(x, z) || onRamp(x, z) || onDeck(x, z)) return true;
    const f = city.flags(x, z);
    if (f === undefined) return x > QUAY.minX && x < QUAY.maxX && z > QUAY.minZ && z < QUAY.maxZ;
    return f === 0;
  };
  const dynamic = new Set<Rect>();
  /** Things with a top lower than feet + STEP can be walked onto. */
  const STEP = 0.36;
  const blocks = (c: Rect, feet: number) => (c.top ?? Infinity) > feet + STEP;
  /** A house or landmark wall within m metres (8 points on a ring): keeps the eye out of walls. */
  const wallNear = (x: number, z: number, m: number) => {
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const f = city.flags(x + Math.cos(a) * m, z + Math.sin(a) * m);
      if (f !== undefined && (f & WALL) !== 0) return true;
    }
    return false;
  };
  const isFree = (x: number, z: number, r: number, feet = 0) => {
    if (!isWalkable(x, z)) return false;
    if (wallNear(x, z, r + 0.15)) return false;
    for (const c of colliders) if (inRect(c, x, z, r) && blocks(c, feet)) return false;
    for (const c of dynamic) if (inRect(c, x, z, r) && blocks(c, feet)) return false;
    return true;
  };

  /** Height to stand on at (x, z): the highest top you are over and could reach. */
  function groundAt(x: number, z: number, r: number, feet: number): number {
    let g = baseAt(x, z);
    const consider = (c: Rect) => {
      if (c.top !== undefined && c.top <= feet + STEP && inRect(c, x, z, r * 0.6)) g = Math.max(g, c.top);
    };
    colliders.forEach(consider);
    dynamic.forEach(consider);
    return g;
  }

  function move(x: number, z: number, dx: number, dz: number, r: number, feet = 0): [number, number] {
    let nx = x + dx;
    if (!isFree(nx, z, r, feet)) nx = x;
    let nz = z + dz;
    if (!isFree(nx, nz, r, feet)) nz = z;
    return [nx, nz];
  }

  const onPierDeck = (x: number, z: number) => x > 5 && x < 9 && z > -12 && z < 0;
  const isWater = (x: number, z: number) => {
    if (onPierDeck(x, z) || onRamp(x, z) || onDeck(x, z)) return false;
    const f = city.flags(x, z);
    if (f === undefined) return z < 0;
    return (f & (WATER | OUTSIDE)) !== 0 && (f & WALL) === 0;
  };

  /**
   * Path check (CLAUDE.md: always make sure there is a path). Flood-fills the
   * walkable ground from a start point on a 0.5 m grid, with the colliders
   * as they are now. Returns a test: can you get within `reach` of (x, z)?
   */
  function reachFrom(sx: number, sz: number): (x: number, z: number, reach: number) => boolean {
    // a 0.5 m grid over the whole city; walls and water from the walk map, then
    // the quay's own obstacles (colliders, grown by the body radius) on top
    const C = 0.5;
    const X0 = -1100;
    const Z0 = -440;
    const W = Math.ceil(1600 / C);
    const H = Math.ceil(1260 / C);
    const pass = new Uint8Array(W * H);
    const seen = new Uint8Array(W * H);
    const at = (i: number, j: number): [number, number] => [X0 + i * C, Z0 + j * C];
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const [x, z] = at(i, j);
        pass[j * W + i] = isWalkable(x, z) && !wallNear(x, z, 0.45) ? 1 : 0;
      }
    const R = 0.3;
    for (const c of [...colliders, ...dynamic]) {
      if (c.top !== undefined && c.top <= STEP) continue;
      const i0 = Math.max(0, Math.floor((c.minX - R - X0) / C));
      const i1 = Math.min(W - 1, Math.ceil((c.maxX + R - X0) / C));
      const j0 = Math.max(0, Math.floor((c.minZ - R - Z0) / C));
      const j1 = Math.min(H - 1, Math.ceil((c.maxZ + R - Z0) / C));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const [x, z] = at(i, j);
          // a collider with a top you could stand on only blocks you from below
          if (c.top !== undefined && baseAt(x, z) + STEP >= c.top) continue;
          if (inRect(c, x, z, R)) pass[j * W + i] = 0;
        }
    }
    const si = Math.round((sx - X0) / C);
    const sj = Math.round((sz - Z0) / C);
    const queue: number[] = [];
    if (pass[sj * W + si]) {
      seen[sj * W + si] = 1;
      queue.push(sj * W + si);
    }
    while (queue.length) {
      const k = queue.pop()!;
      const i = k % W;
      const j = (k - i) / W;
      const [x, z] = at(i, j);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const n = nj * W + ni;
        if (seen[n] || !pass[n]) continue;
        const [nx, nz] = at(ni, nj);
        if (Math.abs(baseAt(nx, nz) - baseAt(x, z)) > STEP) continue;
        seen[n] = 1;
        queue.push(n);
      }
    }
    return (x, z, reach) => {
      const r = Math.ceil(reach / C);
      const ci = Math.round((x - X0) / C);
      const cj = Math.round((z - Z0) / C);
      for (let j = cj - r; j <= cj + r; j++)
        for (let i = ci - r; i <= ci + r; i++) {
          if (i < 0 || j < 0 || i >= W || j >= H || !seen[j * W + i]) continue;
          const [px, pz] = at(i, j);
          if (Math.hypot(px - x, pz - z) <= reach) return true;
        }
      return false;
    };
  }

  let fogTarget = 0;
  let fogMix = 0;
  const fog = scene.fog as THREE.Fog;

  function surfaceAt(x: number, z: number): Surface {
    if (x > PIER.minX && x < PIER.maxX && z < -1) return "wood";
    return "stone";
  }

  const lampUniforms = psxUniforms.uLamps.value;
  const litGlass = new THREE.Color();
  const shipABase = shipA.position.clone();
  const shipBBase = shipB.position.clone();

  // time of day: eases toward the target so a jump (after sleep) fades in
  let dayTarget = 8;
  let dayNow = 8;
  let lampsLit = 0;
  let dayFar = 25;
  // weather: near/far multipliers and lamp in-scatter; eased like the clock
  const WEATHER = { fog: [1, 1, 1], mist: [1.6, 1.5, 0.7], clear: [3, 2.3, 0.3] } as const;
  let wTarget: readonly number[] = WEATHER.fog;
  const wNow = [1, 1, 1];
  const SCATTER = psxUniforms.uScatter.value;
  const fogFrom = new THREE.Color();
  const fogTo = new THREE.Color();
  function applyDaylight(h: number): void {
    let i = 0;
    while (i < DAYLIGHT.length - 2 && h >= DAYLIGHT[i + 1][0]) i++;
    const [h0, c0, s0, f0, l0] = DAYLIGHT[i];
    const [h1, c1, s1, f1, l1] = DAYLIGHT[i + 1];
    const k = THREE.MathUtils.smoothstep(h, h0, h1);
    fog.color.copy(fogFrom.setHex(c0)).lerp(fogTo.setHex(c1), k);
    (scene.background as THREE.Color).copy(fog.color);
    skyLight.intensity = THREE.MathUtils.lerp(s0, s1, k);
    sunDay = Math.max(0, (skyLight.intensity - 0.55) / 1.55);
    dayFar = THREE.MathUtils.lerp(f0, f1, k);
    lampsLit = THREE.MathUtils.lerp(l0, l1, k);
  }
  applyDaylight(dayNow);

  let camera: THREE.Camera | null = null;
  let devView = false;
  function update(t: number, dt: number, cam?: THREE.Camera): void {
    if (cam) camera = cam;
    // the sky dome and the water sheet go where you go
    if (camera) {
      sky.position.set(camera.position.x, 0, camera.position.z);
      water.position.x = Math.round(camera.position.x / WATER_TILE) * WATER_TILE;
      water.position.z = Math.round(camera.position.z / WATER_TILE) * WATER_TILE;
    }
    psxUniforms.uTime.value = t;
    fogMix += (fogTarget - fogMix) * Math.min(1, dt * 0.4);
    // ease along the clock, the short way round midnight
    let dh = dayTarget - dayNow;
    if (dh > 12) dh -= 24;
    if (dh < -12) dh += 24;
    if (Math.abs(dh) > 0.001) {
      dayNow = (dayNow + dh * Math.min(1, dt * 0.8) + 24) % 24;
      applyDaylight(dayNow);
    }
    for (let i = 0; i < 3; i++) wNow[i] += (wTarget[i] - wNow[i]) * Math.min(1, dt * 0.5);
    // the sun: nothing at night, a glow through fog, real light on a clear day
    sun.intensity = sunDay * (1.35 - wNow[2]) * 2.6;
    psxUniforms.uScatter.value = SCATTER * wNow[2];
    // the job twist "thick fog" always closes in, whatever the weather
    fog.near = THREE.MathUtils.lerp(3 * wNow[0], 1.5, fogMix);
    fog.far = THREE.MathUtils.lerp(dayFar * wNow[1], 11, fogMix);
    sky.visible = !devView;
    if (devView) {
      // look at everything: no fog, bright day
      fog.near = 1500;
      fog.far = 4000;
      skyLight.intensity = 2.1;
      sun.intensity = 2.2;
      fog.color.setHex(0x8a98a4);
      (scene.background as THREE.Color).copy(fog.color);
    }
    if (camera) city.update(camera, fog.far);
    lantern.intensity = 7 * (0.92 + Math.sin(t * 5.1) * 0.04 + Math.sin(t * 13.7) * 0.03);
    waterTex.offset.x = t * 0.004;
    waterTex.offset.y = t * 0.011;

    // ships breathe on the tide
    shipA.rotation.x = Math.sin(t * 0.37) * 0.012;
    shipA.position.y = shipABase.y + Math.sin(t * 0.5) * 0.08;
    shipB.rotation.x = Math.sin(t * 0.29 + 1.3) * 0.018;
    shipB.position.y = shipBBase.y + Math.sin(t * 0.41 + 2) * 0.1;

    for (let i = 0; i < lamps.length; i++) {
      const l = lamps[i];
      const target = flicker(t, l.seed, l.broken) * lampsLit;
      l.level += (target - l.level) * Math.min(1, dt * 18);
      l.light.intensity = 26 * l.level;
      // unlit glass takes the colour of the air around it, so it never shows as a black box
      (l.glass.material as THREE.MeshBasicMaterial).color
        .copy(fog.color)
        .multiplyScalar(0.8 * (1 - Math.min(1, l.level)))
        .add(litGlass.setRGB(1.0 * l.level, 0.72 * l.level, 0.38 * l.level));
      l.halo.material.opacity = 0.55 * l.level;
      if (i < MAX_LAMPS) lampUniforms[i].set(l.pos.x, l.pos.y, l.pos.z, l.level);
    }
  }

  noticeBoard(scene, m, colliders, BOARD_POS.x, BOARD_POS.z);

  return {
    scene,
    mats: m,
    groundAt,
    addCollider: (r) => dynamic.add(r),
    removeCollider: (r) => dynamic.delete(r),
    isFree,
    isWater,
    baseAt,
    reachFrom,
    setThickFog: (on) => (fogTarget = on ? 1 : 0),
    setTimeOfDay: (h) => (dayTarget = ((h % 24) + 24) % 24),
    city,
    setWeather: (w) => (wTarget = WEATHER[w] ?? WEATHER.fog),
    setDevView: (on) => {
      devView = on;
      if (!on) applyDaylight(dayNow);
    },
    lamps,
    shipPositions: [new THREE.Vector3(SHIP_X + 20, 1, -3), new THREE.Vector3(-34, 1, -21)],
    move,
    surfaceAt,
    update,
  };
}

// -------------------------------------------------------------------------


/** Gas flame: slow breathing, small fast noise, now and then a dip. */
function flicker(t: number, seed: number, broken: boolean): number {
  let v =
    0.9 +
    Math.sin(t * 1.3 + seed * 2.1) * 0.04 +
    Math.sin(t * 7.7 + seed * 5.3) * 0.03 +
    Math.sin(t * 17.3 + seed * 1.7) * 0.02;
  const dip = Math.sin(t * 0.61 + seed * 3.3) * Math.sin(t * 2.3 + seed);
  if (dip > 0.93) v *= 0.6;
  if (broken) {
    const s = Math.sin(t * 0.9 + 1.1) + Math.sin(t * 3.7) * 0.5;
    if (s > 1.05) v *= 0.15 + 0.3 * Math.abs(Math.sin(t * 31));
    else if (s > 0.8) v *= 0.6;
  }
  return v;
}

function gasLamp(
  scene: THREE.Scene,
  m: Mats,
  colliders: Rect[],
  glow: THREE.Texture,
  x: number,
  z: number,
  seed: number,
  broken: boolean,
): Lamp {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.add(cyl(0.18, 0.22, 0.5, 6, m.iron, 0, 0.25, 0));
  g.add(cyl(0.06, 0.09, 3.0, 6, m.iron, 0, 1.9, 0));
  g.add(box(0.5, 0.05, 0.08, m.iron, 0, 3.2, 0, 1)); // ladder bar
  const glassMat = m.lampGlass.clone();
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.16, 0.5, 4), glassMat);
  glass.position.set(0, 3.65, 0);
  glass.rotation.y = Math.PI / 4;
  g.add(glass);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.32, 4), m.iron);
  cap.position.set(0, 4.05, 0);
  cap.rotation.y = Math.PI / 4;
  g.add(cap);
  scene.add(g);

  const pos = new THREE.Vector3(x, 3.65, z);
  const light = new THREE.PointLight(0xffa048, 26, 18, 1.7);
  light.position.copy(pos);
  scene.add(light);

  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glow,
      color: 0xffb060,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.55,
      fog: false,
    }),
  );
  halo.position.copy(pos);
  halo.scale.set(1.8, 1.8, 1);
  scene.add(halo);

  colliders.push(rectAround(x, z, 0.25, 0.25));
  return { pos, light, glass, halo, seed: seed * 1.37 + 0.5, broken, level: 1 };
}

/** A lantern on a bracket over the doss house door (M5). Returns its light. */
function dossLantern(scene: THREE.Scene, m: Mats, glow: THREE.Texture): THREE.PointLight {
  const d = doorSpot("doss", 0.5);
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.09, 0.26, 4), m.lampGlass);
  glass.position.set(d.x, 3.1, d.z);
  scene.add(glass);
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glow, color: 0xffb060, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5, fog: false }),
  );
  halo.position.copy(glass.position);
  halo.scale.set(1.1, 1.1, 1);
  scene.add(halo);
  doorSign(scene, "doss", "BEDS");
  const light = new THREE.PointLight(0xffa048, 7, 10, 1.7);
  light.position.set(d.x, 2.9, d.z);
  scene.add(light);
  return light;
}

/** A painted board over a door of the city, flat on the wall. */
function doorSign(scene: THREE.Scene, door: string, text: string): void {
  const d = doorSpot(door, 0.08);
  const signMat = psx(new THREE.MeshLambertMaterial({ map: signTexture(text), ...DECAL }), { affine: 0.5 });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.36, 3, 1), signMat);
  plate.position.set(d.x, 4.15, d.z);
  // the plane's front (+z local) looks out of the wall, away from the house
  plate.lookAt(d.x - d.face[0], 4.15, d.z - d.face[1]);
  scene.add(plate);
}

/** Hiring board: two posts, a plank face with pinned papers, a little roof. */
function noticeBoard(scene: THREE.Scene, m: Mats, colliders: Rect[], x: number, z: number): void {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  for (const s of [-1, 1]) g.add(box(0.12, 2.3, 0.12, m.darkWood, s * 0.85, 1.15, 0, 1));
  g.add(box(1.9, 1.1, 0.08, m.darkWood, 0, 1.55, 0, 1.5));
  g.add(box(2.1, 0.08, 0.4, m.darkWood, 0, 2.3, -0.05, 1));
  const paper = psx(new THREE.MeshLambertMaterial({ color: 0x9a927c, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  const spots: Array<[number, number, number, number]> = [
    [-0.55, 1.7, 0.42, 0.52],
    [0.0, 1.62, 0.36, 0.46],
    [0.5, 1.72, 0.4, 0.5],
    [-0.2, 1.25, 0.5, 0.3],
  ];
  for (const [px, py, w, h] of spots) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), paper);
    p.position.set(px, py, -0.045);
    p.rotation.set(0, Math.PI, (px * 7) % 0.12);
    g.add(p);
  }
  scene.add(g);
  colliders.push(rectAround(x, z, 1.0, 0.2));
}

function crane(scene: THREE.Scene, m: Mats, colliders: Rect[], x: number, z: number): void {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = 0.35;
  g.add(cyl(1.3, 1.5, 0.9, 8, m.quayWall, 0, 0.45, 0));
  g.add(cyl(1.0, 1.0, 0.4, 8, m.iron, 0, 1.1, 0));
  // cab / machinery house
  g.add(box(2.2, 2.2, 2.4, m.darkWood, 0, 2.4, 0.5, 1.5));
  g.add(box(2.5, 0.2, 2.8, m.iron, 0, 3.6, 0.5, 1));
  g.add(box(1.4, 1.2, 1.2, m.iron, 0, 1.9, 2.0, 1)); // counterweight
  // post
  g.add(box(0.5, 6.5, 0.5, m.iron, 0, 4.4, -0.8, 1));
  // jib reaching over the water
  const base = new THREE.Vector3(0, 1.4, -0.8);
  const tip = new THREE.Vector3(0, 10.5, -8.5);
  g.add(rod(base, tip, 0.22, m.iron));
  g.add(rod(base.clone().setX(0.35), tip.clone().setX(0.1), 0.08, m.iron));
  g.add(rod(new THREE.Vector3(0, 7.6, -0.8), tip, 0.06, m.iron)); // tie
  g.add(rod(new THREE.Vector3(0, 7.6, -0.8), new THREE.Vector3(0, 3.8, 2.0), 0.06, m.iron));
  // rope and hook
  g.add(rod(tip, new THREE.Vector3(0, 2.4, -8.5), 0.03, m.rope));
  g.add(box(0.2, 0.5, 0.08, m.iron, 0, 2.2, -8.5, 1));
  g.add(box(0.8, 0.8, 0.8, m.crate, 0, 1.55, -8.5, 1));
  scene.add(g);
  colliders.push(rectAround(x, z + 0.3, 1.7, 1.9));
}

function crateStack(scene: THREE.Scene, m: Mats, colliders: Rect[], x: number, z: number, n: number): void {
  const s = 1.1;
  let placed = 0;
  for (let i = 0; i < n; i++) {
    const cx = x + (i % 2) * (s + 0.04);
    const cz = z + Math.floor(i / 2) * (s + 0.04);
    const c = box(s, s, s, m.crate, cx, s / 2, cz, 1.1);
    c.rotation.y = Math.sin(x * 3 + i) * 0.08;
    scene.add(c);
    placed++;
  }
  if (n >= 2) {
    const top = box(s, s, s, m.crate, x + s / 2, s * 1.5, z, 1.1);
    top.rotation.y = 0.2;
    scene.add(top);
  }
  const w = placed > 1 ? s * 2 + 0.04 : s;
  const d = Math.ceil(placed / 2) * (s + 0.04);
  colliders.push({ minX: x - s / 2, maxX: x - s / 2 + w, minZ: z - s / 2, maxZ: z - s / 2 + d, top: n >= 2 ? s * 2 : s });
}

function barrels(scene: THREE.Scene, m: Mats, colliders: Rect[], x: number, z: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const bx = x + (i % 3) * 0.75;
    const bz = z + Math.floor(i / 3) * 0.75;
    scene.add(cyl(0.3, 0.3, 0.95, 8, m.darkWood, bx, 0.475, bz));
    scene.add(cyl(0.335, 0.335, 0.06, 8, m.ironDecal, bx, 0.2, bz));
    scene.add(cyl(0.335, 0.335, 0.06, 8, m.ironDecal, bx, 0.75, bz));
  }
  const cols = Math.min(n, 3);
  const rows = Math.ceil(n / 3);
  colliders.push({ minX: x - 0.35, maxX: x + (cols - 1) * 0.75 + 0.35, minZ: z - 0.35, maxZ: z + (rows - 1) * 0.75 + 0.35, top: 0.95 });
}

function sacks(scene: THREE.Scene, m: Mats, colliders: Rect[], x: number, z: number): void {
  for (let i = 0; i < 6; i++) {
    const s = box(0.9, 0.35, 0.55, m.sack, x + (i % 3) * 0.92, 0.18 + Math.floor(i / 3) * 0.35, z, 0.9);
    s.rotation.y = Math.sin(i * 4.1) * 0.12;
    scene.add(s);
  }
  colliders.push({ minX: x - 0.5, maxX: x + 2.3, minZ: z - 0.35, maxZ: z + 0.35, top: 0.7 });
}

function cart(scene: THREE.Scene, m: Mats, colliders: Rect[], x: number, z: number): void {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = 0.5;
  g.add(box(1.4, 0.1, 2.4, m.darkWood, 0, 0.7, 0, 1));
  g.add(box(1.4, 0.4, 0.06, m.darkWood, 0, 0.95, -1.2, 1));
  g.add(box(1.4, 0.4, 0.06, m.darkWood, 0, 0.95, 1.2, 1));
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.08, 10), m.darkWood);
    w.rotation.z = Math.PI / 2;
    w.position.set(s * 0.78, 0.55, 0);
    g.add(w);
  }
  g.add(rod(new THREE.Vector3(-0.5, 0.7, 1.2), new THREE.Vector3(-0.5, 0.35, 2.8), 0.05, m.darkWood));
  g.add(rod(new THREE.Vector3(0.5, 0.7, 1.2), new THREE.Vector3(0.5, 0.35, 2.8), 0.05, m.darkWood));
  g.add(box(0.7, 0.35, 0.5, m.sack, 0.1, 0.93, 0.3, 0.9));
  scene.add(g);
  colliders.push(rectAround(x + 0.4, z + 0.6, 1.3, 1.6));
}

function bollard(scene: THREE.Scene, m: Mats, colliders: Rect[], x: number, z: number): void {
  scene.add(cyl(0.2, 0.24, 0.7, 7, m.iron, x, 0.35, z));
  scene.add(cyl(0.3, 0.2, 0.12, 7, m.iron, x, 0.74, z));
  colliders.push(rectAround(x, z, 0.28, 0.28, 0.8));
}

function ropeCoil(scene: THREE.Scene, m: Mats, x: number, z: number): void {
  for (let i = 0; i < 3; i++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.34 - i * 0.04, 0.06, 4, 8), m.rope);
    t.rotation.x = Math.PI / 2;
    t.position.set(x, 0.06 + i * 0.1, z);
    scene.add(t);
  }
}

function ship(
  scene: THREE.Scene,
  m: Mats,
  x: number,
  zc: number,
  len: number,
  beam: number,
  steamer: boolean,
  /** Local x of a gap in the quay-side rail, for a gangway. */
  gapX?: number,
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, zc);

  const hw = beam / 2;
  const shape = new THREE.Shape();
  shape.moveTo(1.5, -hw);
  shape.lineTo(len * 0.72, -hw);
  shape.quadraticCurveTo(len * 0.95, -hw * 0.8, len, 0);
  shape.quadraticCurveTo(len * 0.95, hw * 0.8, len * 0.72, hw);
  shape.lineTo(1.5, hw);
  shape.quadraticCurveTo(0, hw * 0.9, 0, 0);
  shape.quadraticCurveTo(0, -hw * 0.9, 1.5, -hw);
  const hullTop = 2.4;
  const hullBot = -4.5;
  const hullGeo = new THREE.ExtrudeGeometry(shape, { depth: hullTop - hullBot, bevelEnabled: false, curveSegments: 6 });
  hullGeo.rotateX(-Math.PI / 2);
  hullGeo.translate(0, hullBot, 0);
  const huv = hullGeo.getAttribute("uv");
  for (let i = 0; i < huv.count; i++) huv.setXY(i, huv.getX(i) * 0.25, huv.getY(i) * 0.25);
  g.add(new THREE.Mesh(hullGeo, m.hull));

  // bulwark rail and deckhouse
  g.add(box(len * 0.7, 0.9, 0.2, m.hull, len * 0.4, hullTop + 0.45, -hw + 0.1, 2));
  if (gapX === undefined) g.add(box(len * 0.7, 0.9, 0.2, m.hull, len * 0.4, hullTop + 0.45, hw - 0.1, 2));
  else {
    const a0 = len * 0.05;
    const a1 = gapX - 0.6;
    const b0 = gapX + 0.6;
    const b1 = len * 0.75;
    g.add(box(a1 - a0, 0.9, 0.2, m.hull, (a0 + a1) / 2, hullTop + 0.45, hw - 0.1, 2));
    g.add(box(b1 - b0, 0.9, 0.2, m.hull, (b0 + b1) / 2, hullTop + 0.45, hw - 0.1, 2));
  }
  g.add(box(len * 0.18, 2.4, beam * 0.45, m.darkWood, len * 0.22, hullTop + 1.2, 0, 2));

  const masts = steamer ? [0.3, 0.72] : [0.22, 0.48, 0.74];
  const tops: THREE.Vector3[] = [];
  for (const f of masts) {
    const mx = len * f;
    const h = steamer ? 16 : 24;
    g.add(cyl(0.18, 0.3, h, 6, m.rigging, mx, hullTop + h / 2, 0));
    tops.push(new THREE.Vector3(mx, hullTop + h, 0));
    const yards = steamer ? 1 : 3;
    for (let y = 0; y < yards; y++) {
      const yh = hullTop + h * (0.45 + y * 0.2);
      const yw = beam * (1.5 - y * 0.35);
      g.add(rod(new THREE.Vector3(mx, yh, -yw / 2), new THREE.Vector3(mx, yh, yw / 2), 0.1, m.rigging));
    }
  }
  // stays: bow, stern, between masts
  const bow = new THREE.Vector3(len + 5, hullTop + 2.5, 0);
  g.add(rod(new THREE.Vector3(len - 1, hullTop + 0.5, 0), bow, 0.14, m.rigging)); // bowsprit
  g.add(rod(tops[tops.length - 1], bow, 0.04, m.rigging));
  g.add(rod(tops[0], new THREE.Vector3(0.5, hullTop + 0.5, 0), 0.04, m.rigging));
  for (let i = 0; i < tops.length - 1; i++) g.add(rod(tops[i], tops[i + 1], 0.04, m.rigging));
  for (const t of tops) {
    for (const s of [-1, 1]) g.add(rod(t, new THREE.Vector3(t.x - 1.5, hullTop + 0.4, s * hw), 0.03, m.rigging));
  }

  if (steamer) {
    const f = cyl(1.1, 1.2, 7, 8, m.iron, len * 0.5, hullTop + 3.5, 0);
    f.rotation.z = 0.12;
    g.add(f);
    g.add(box(4, 2.2, beam * 0.7, m.darkWood, len * 0.58, hullTop + 1.1, 0, 2));
  }
  scene.add(g);
  return g;
}
