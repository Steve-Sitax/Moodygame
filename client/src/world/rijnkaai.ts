import * as THREE from "three";
import { psx, psxUniforms, MAX_LAMPS } from "../retro/psx";
import { makeTextures, signTexture, glowTexture, type Textures } from "./textures";
import { box, cyl, rod, rectAround, inRect, type Rect } from "./geom";
import SPOT_TABLE from "../../../shared/spots.json";
import { steenHeightAt, steenKeepOut } from "./steenramp";
import CITY_DATA from "../../../shared/city.json";
import { buildCity, doorSpot, edgeZ, WALL, WATER, OUTSIDE, type CityWorld } from "./city";
import { dressCity, loadProps } from "./props3d";
import { dockWaterStencil, loadBoats, waterStencil, type Boats } from "./boats";
import { createAmbient, type Ambient } from "./ambient";
import { createLock, type Lock } from "./lock";
import { createBridges, type Bridges } from "./bridges";
import { createRiver, type River } from "./river";
import { buildTracks, trackKeepOut, type TrackData } from "./tracks";
import { buildRuts } from "./ruts";
import { buildFarBank } from "./farbank";
import { buildVegetation } from "./vegetation";
import { buildTrees3D } from "./trees3d";
import { applyDirt } from "./dirt";
import { createFires, type Fires } from "./fire";
import { createGasLamps, type GasLamps } from "./gaslamps";
import { createLitter, type Litter } from "./litter";
import { createStreetLife, type StreetLife } from "./streetlife";
import { tradeKeepOut } from "./trades";
import { marketKeepOut } from "../game/market";
import { createQuayFurniture, type QuayFurniture } from "./quayfurniture";
import { createTraffic, type Traffic } from "./traffic";
import { createRailway, type CraneSite, type RaisedDeck, type Railway } from "./railway";
import { createRailGate, type RailGate } from "./railgate";
import { createOmnibuses, OMNIBUS_HORSES, omnibusKeepOut, STOPS as OMNIBUS_STOPS, type Omnibuses } from "./omnibus";
import { quaySteps, shoreTexture, frameAt, type Exit } from "./quaysteps";
import { buildPier, PIER_BOLLARD } from "./pier";
import { waveAt } from "../retro/psx";
import { createMirror } from "./mirror";
import { BRIG_FLOOR, CHAMBER, DOCK, HW_MAX, LW_MIN, MID_Y, gateLine, levelAt, tideAt, tideDev, tideInfo, water as tideWater } from "./tide";
import { buildTideMud } from "./tidemud";

// The Rijnkaai in the real 1873 city (world/city.ts). Water is at z < 0, the
// quay edge runs along x (the world is turned 19 deg so it does). Quay top is
// y = 0. Here: the game's own things on the quay (pier, crane, ship, lamps,
// goods) and the rules for walking; the city itself comes from Blender.

/**
 * The river at half tide, well below the quay top (y 0), as in the period photos (Steve, 2026-09-23;
 * was -1.8). M6 tides: the water now rises and falls about 2.15 m either side of it (world/tide.ts);
 * the live level is tide.ts `water.river` / levelAt(x, z), and World.waterLevel with the waves.
 */
export const WATER_Y = MID_Y;
/** Before the walk map is loaded, only the open quay by the start counts as ground. */
const QUAY = { minX: -50, maxX: 60, minZ: 0.8, maxZ: 40 };
const PIER = { minX: 5.4, maxX: 8.6, minZ: -11.6, maxZ: 0.6 };
/** The Anna Maria's berth runs from x -60 to -20 off the Quai Tavernier (bollards, ropes, swim blockers). */
const SHIP_X = -60;
// the Anna Maria: a brig from Blender (build_boats.py "brig"); its deck sits a little below the quay
// at half tide. M6 tides: `y` is live (the deck rises and falls with the tide; at low water she sits
// on the bottom, BRIG_FLOOR); read it when you need it.
export const DECK = { minX: -51.0, maxX: -29.0, minZ: -11.4, maxZ: -3.0, y: WATER_Y + 2.4 };
/** The brig's deck over her waterline. */
const DECK_OVER_WATER = 2.4;
/** The ferry pontoon at the Werf (boats.ts), and the gangway (m) that slopes down to its deck. */
const PONTOON = { x: -249, minX: -251, maxX: -247, minZ: -58, maxZ: 0, gangway: 6 };
/** Stone steps down to the water (world/quaysteps.ts): top of the flight on the quay line, and the way down. */
const FLIGHTS: Array<[number, number, number, number]> = [
  [-320, 0, -1, 0], // the Werf, west of the railing
  [-110, 0, -1, 0], // the Vismarkt quay
  [-70, 38, 0, 1], // the Canal des Brasseurs, east wall
  [-4, 0, -1, 0], // the Rijnkaai, by the start
  [50, 0, 1, 0], // the Rijnkaai, by the cart stand
  [186, 0, 1, 0], // the river quay north of the lock
  [90, 46, 1, 0], // the Petit Bassin, south quay
  [116, 110, 1, 0], // the Petit Bassin, north quay
];
/**
 * The gangway: a plank from the quay (y 0) up to the deck (z -3.1, y DECK.y). M6 tides: it hangs
 * from the brig's rail (zHigh) and its foot rolls on the quay, so zLow is live (RAMP_LEN of plank).
 */
export const RAMP = { x: -42, halfW: 0.45, zLow: 0.3, zHigh: -3.0 };
const RAMP_LEN = 4.0;
/** The ferry pontoon's gangway: a plank this long, hinged at the quay edge (M6 tides). */
const PONTOON_PLANK = 7.0;

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

/** M7: a building's inside in the world, walked by its own plan (World.addWalkArea). */
export interface WalkArea {
  /** A box round it (world): nothing outside is asked. */
  box: Rect;
  /** Is (x, z) the building's to answer (its porch, doorway and halls with their walls)? */
  has(x: number, z: number): boolean;
  /** Floor there (not a wall)? */
  walkable(x: number, z: number): boolean;
  /** The floor's height (world). */
  floor(x: number, z: number): number;
  /** A body of radius r at (x, z) touches one of its solids (piers, chairs, altars)? */
  hits(x: number, z: number, r: number): boolean;
}

export interface World {
  scene: THREE.Scene;
  lamps: Lamp[];
  /** M6 town life: every gas lamp's own lit state, set by the lamplighters (world/gaslamps.ts). */
  gasLamps: GasLamps;
  shipPositions: THREE.Vector3[];
  /**
   * The player walks from (x,z) by (dx,dz); returns the allowed position (slides on walls).
   * He may step off an open quay edge into the water, unless he carries something (laden).
   */
  move(x: number, z: number, dx: number, dz: number, radius: number, feet?: number, laden?: boolean): [number, number];
  /** May the player stand at (x, z) with his feet at `feet`? */
  standFree(x: number, z: number, radius: number, feet: number): boolean;
  /** Height of what you stand on at (x, z), given your feet height; far below the water over open water. */
  groundAt(x: number, z: number, radius: number, feet: number): number;
  /** Open water a swimmer of radius r fits in (not a wall, hull, pile or flight of steps). */
  swimFree(x: number, z: number, r: number): boolean;
  /** Can the player drop into the water here? (open water, room to swim nearby) */
  swimmable(x: number, z: number): boolean;
  /** A swimmer moves; slides along walls and hulls. */
  swimMove(x: number, z: number, dx: number, dz: number, radius: number): [number, number];
  /** The nearest spot within 1 m where a swimmer fits, or null. */
  nearestSwim(x: number, z: number, radius: number): [number, number] | null;
  /** Height of the water surface at (x, z) now, waves included (as drawn). */
  waterLevel(x: number, z: number): number;
  /** A ladder or a landing to climb out on, within reach of a swimmer. */
  exitNear(x: number, z: number, reach: number): Exit | null;
  /**
   * M3j rowing (game/rowing.ts): open water for a boat's hull of radius r. As swimFree, but water
   * under an opening bridge counts whatever the bridge does (the rower's own rules decide there),
   * and `pass` may let a solid through (the boat itself; the lock while its gates stand open).
   */
  boatFree(x: number, z: number, r: number, pass?: (c: Rect) => boolean): boolean;
  /** Things in the water that come and go (boats left lying): solid for swimmers and boats. */
  addWaterSolid(r: Rect): void;
  removeWaterSolid(r: Rect): void;
  /** The lock's water (gates, tows): a solid for swimmers; boats pass while its gates stand open. */
  lockWater: Rect;
  /** Dev: where the stone steps and the ladders are. */
  quayInfo(): { flights: Array<{ top: [number, number]; end: [number, number] }>; ladders: Array<{ x: number; z: number; top: number }> };
  /** Colliders that come and go (job crates). */
  addCollider(r: Rect): void;
  /**
   * M7 interiors in the world (world/inworld.ts): inside a building's area its own floor, walls and
   * solids count instead of the walk map (which marks the footprint as wall). For Jef, the crowd
   * and the path check alike.
   */
  addWalkArea(a: WalkArea): void;
  removeCollider(r: Rect): void;
  /**
   * M6 handcart: things that move with a walker (a pushed cart, a led horse and dray). Solid for
   * Jef and for the drays, the train and the omnibus; not for the crowd's own paths (their pusher
   * would bump into his own cart). Moved in place: add once.
   */
  addMover(r: Rect): void;
  removeMover(r: Rect): void;
  moverAt(x: number, z: number, r: number): boolean;
  /** M6 handcart: on the quay railway's band or a crane runway (the train and the cranes run here)? */
  onRails(x: number, z: number, r?: number): boolean;
  /** Can something of radius r stand here? */
  isFree(x: number, z: number, r: number, feet?: number): boolean;
  /** Everything solid on the ground now (crates, carts, cranes, lamps, trees): for path finding. */
  solids(): Rect[];
  /** Changes whenever a solid is put down or taken away (the crowd rebuilds its paths' grid then). */
  solidsVersion(): number;
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
  setWeather(w: "fog" | "mist" | "clear" | "rain" | "storm"): void;
  /** Chimney smoke, birds, rain and puddles, lit windows (world/ambient.ts). */
  ambient: Ambient;
  /** M6 lively: street life once it is placed (the corner Madonnas, the shop fronts); null until then. */
  streetLife(): StreetLife | null;
  /** The boats (moving ships for the sound, signals at bridges); null until loaded. */
  boats(): Boats | null;
  /** The drays and handcarts (for the sound); null until loaded. */
  traffic(): Traffic | null;
  /** M3j: the opening bridges and the lock (rowing boats ask them to open); null until loaded. */
  bridges(): Bridges | null;
  lock(): Lock | null;
  /** The goods train and the cranes at work (M3g); null until loaded. */
  railway(): Railway | null;
  /** The railway gate of the Werf store, where the goods train comes and goes (M3g). */
  railGate(): RailGate;
  /** The horse omnibuses, quay and town lines (M3g); null until loaded. */
  omnibus(): Omnibuses | null;
  /** Where the people walking are (the crowd and the town): bridges never open under them. */
  setPeople(fn: () => Iterable<{ x: number; z: number }>): void;
  /** Fixes 2026-09-24: where the handcarts stand (main.ts: game/handcart.ts), for the lock gates. */
  setCarts(fn: () => Iterable<{ x: number; z: number }>): void;
  /** Does a lock gate's balance beam swing over (x, z)? No cart is left standing there. */
  lockSweep(x: number, z: number, r: number): boolean;
  /** Must someone at (x, z) wait? True on (or right at) an opening bridge that is opening, open or shutting. */
  bridgeWait(x: number, z: number): boolean;
  /** Dev menu: things to set off now (a lock passage, a boat up the canal, fog, rain). */
  devEvents(): Array<{ label: string; run: () => void }>;
  /** Dev: no fog, noon light, every chunk shown (fly mode). */
  setDevView(on: boolean): void;
  mats: Mats;
  surfaceAt(x: number, z: number): Surface;
  update(t: number, dt: number, camera?: THREE.Camera): void;
  /** M6 tides: the game clock the river follows (day 1 = Monday, hour with fractions). */
  setTideClock(fn: () => { day: number; hour: number }): void;
  /** M6 tides, dev: the tide now in words, and hold the river at high or low water (null: the clock). */
  tideDev: { read(): string; hold(v: "high" | "low" | null): void };
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
        color: 0x8a9a92, // the deep Schelde: dark, a little green
        specular: 0x3a342a,
        shininess: 120,
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
  /** The ferry pontoon's deck height (it floats: the river + its deck), live (M6 tides). */
  let pontoonDeck = 1.8;
  let pontoonY = WATER_Y + pontoonDeck;
  /** How far out from the quay edge the pontoon's gangway reaches now (it is hinged at the edge). */
  let pontoonReach = Math.sqrt(PONTOON_PLANK ** 2 - pontoonY ** 2);
  let pontoonPivot: THREE.Object3D | null = null;

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
  const sky = new THREE.Mesh(new THREE.SphereGeometry(560, 16, 8), m.sky);
  scene.add(sky);

  // --- the city: ground, quay walls, houses (world/city.ts)
  const city = buildCity(scene, m, WATER_Y);
  // carts, barrels and sacks along the quays and on the squares (Blender models, props3d.ts)
  const ambient = createAmbient(scene, city);
  // the quay railway and the crane runways (world/tracks.ts); carts and crates keep off them
  const trackData = (CITY_DATA as unknown as { decor?: TrackData }).decor ?? {};
  const bridgeRects = Object.values((CITY_DATA as unknown as { bridges?: Record<string, number[]> }).bridges ?? {});
  buildTracks(scene, trackData, bridgeRects.map((b) => ({ minX: Math.min(b[0], b[2]), maxX: Math.max(b[0], b[2]), minZ: Math.min(b[1], b[3]), maxZ: Math.max(b[1], b[3]) })));
  // the horse omnibus's lane round the quays (world/omnibus.ts): props, pumps and troughs keep off it
  const omnibusLane = omnibusKeepOut();
  // the portal cranes travel along their runways (world/railway.ts): nothing stands on them
  // M6 handcart: the rails' band and the crane runways (a cart is never left standing there)
  const railBand = trackKeepOut(trackData);
  const craneRunways: Rect[] = (trackData.crane_rails ?? []).map(([x0, z0, x1, z1]) => ({
    minX: Math.min(x0, x1) - 0.9,
    maxX: Math.max(x0, x1) + 0.9,
    minZ: Math.min(z0, z1) - 0.9,
    maxZ: Math.max(z0, z1) + 0.9,
  }));
  // M3i: the market squares and the trades' workshops (game/market.ts, world/trades.ts): nothing else put there
  const workplaces = [...marketKeepOut(), ...tradeKeepOut(), ...steenKeepOut()];
  // the railway gate of the Werf store (world/railgate.ts): built now, so its collider is there
  // before the train looks along its line
  const railGate = createRailGate(scene, {
    tex: { brick: tex.brick, stone: tex.quayWall, slate: tex.slate, planks: tex.planks },
    addCollider: (r) => dynamic.add(r),
    removeCollider: (r) => dynamic.delete(r),
  });
  colliders.push(...railGate.colliders);
  const propsKeepOut: Rect[] = [
    ...railGate.colliders.map((r) => ({ minX: r.minX - 1, maxX: r.maxX + 4, minZ: r.minZ - 1, maxZ: r.maxZ + 1 })),
    { minX: -72, maxX: 66, minZ: -30, maxZ: 27 },
    ...bridgeRects.map((b) => ({ minX: Math.min(b[0], b[2]) - 4, maxX: Math.max(b[0], b[2]) + 4, minZ: Math.min(b[1], b[3]) - 4, maxZ: Math.max(b[1], b[3]) + 4 })),
    ...trackKeepOut(trackData),
    ...omnibusLane,
    ...workplaces,
  ];
  // shop signs, awnings, corner Madonnas, pumps, washing lines, grime (world/streetlife.ts),
  // set after the carts and crates so the pumps keep off them
  let street: StreetLife | null = null;
  // bollards, rings, fenders, huts, nets, signs along the quays (world/quayfurniture.ts)
  let quayKit: QuayFurniture | null = null;
  // the fires in the tar barrels on the quays (world/fire.ts)
  let fires: Fires | null = null;
  // the filth of 1873: dung, straw, gutters, ash, fish waste, heaps, rats (world/litter.ts)
  let litter: Litter | null = null;
  city.ready
    .then(() => dressCity(scene, city.flags, { keepOut: propsKeepOut }))
    .then((d) => {
      colliders.push(...d.colliders);
      return createStreetLife(scene, city.flags, { avoid: [...d.colliders, ...omnibusLane, ...workplaces] });
    })
    .then((sl) => {
      street = sl;
      colliders.push(...sl.colliders);
      return createQuayFurniture(scene, city.flags, {
        avoid: [...colliders, ...dynamic, ...omnibusLane, ...craneRunways, ...workplaces], // M3g: nothing on the omnibus lanes or crane runways; M3i: markets, trades
        quayInfo: () => ({ flights: steps.flights, ladders: steps.ladders }),
      });
    })
    .then((qf) => {
      quayKit = qf;
      colliders.push(...qf.colliders);
      fires = createFires(
        scene,
        qf.sites.filter((q) => q.kind.startsWith("tar_fire")).map((q) => ({ x: q.x, y: 0.12 + 0.6, z: q.z, size: 0.9 })),
      );
      return createLitter(scene, city.flags, {
        avoid: [...colliders, ...craneRunways, ...steenKeepOut()],
        quaySites: qf.sites,
        quayInfo: () => ({ flights: steps.flights, ladders: steps.ladders }),
        swimFree,
        waterY: WATER_Y,
      }).then((l) => {
        litter = l;
        colliders.push(...l.colliders);
      });
    })
    .catch((e) => console.warn("props, streetlife or quay furniture did not load", e));
  // drays and handcarts going round the quays (world/traffic.ts); they stop for you
  let traffic: Traffic | null = null;
  city.ready
    .then(() => loadProps())
    .then((p) => {
      traffic = createTraffic(scene, city.flags, p, { isFree: freeOfMovers });
      for (const r of traffic.colliders()) dynamic.add(r); // added once: the rects move in place
    })
    .catch((e) => console.warn("traffic did not start", e));
  // grime in the gutters and mud on the paving (world/dirt.ts)
  city.ready.then(() => applyDirt(city.flags)).catch((e) => console.warn("dirt did not load", e));
  // the trees of the Steenplein and the Werf (world/trees3d.ts, tools/blender/build_trees.py)
  city.ready
    .then(() => buildTrees3D(scene, (CITY_DATA as unknown as { decor?: { trees?: Array<[number, number]> } }).decor?.trees ?? []))
    .catch((e) => console.warn("trees did not load", e));
  // tree pits, grass and weeds at the foot of walls, late flowers, bare bushes (world/vegetation.ts)
  city.ready
    .then(() =>
      buildVegetation(scene, city.flags, {
        trees: (CITY_DATA as unknown as { decor?: { trees?: Array<[number, number]> } }).decor?.trees ?? [],
        avoid: [...trackKeepOut(trackData), ...omnibusLane, ...steenKeepOut()],
      }),
    )
    .catch((e) => console.warn("vegetation did not load", e));
  // the far bank of the Schelde, seen on clear days (world/farbank.ts)
  buildFarBank(scene, WATER_Y);
  // wheel ruts down the cart roads (world/ruts.ts)
  city.ready.then(() => buildRuts(scene, city.flags)).catch(() => {});
  // tree trunks on the squares and quays (tools/city/design.py decor)
  for (const [x, z] of (CITY_DATA as unknown as { decor?: { trees?: Array<[number, number]> } }).decor?.trees ?? []) {
    colliders.push(rectAround(x, z, 0.22, 0.22));
  }

  // --- water: one sheet that goes where you go, under the land; it moves in
  // whole texture tiles (4 m), so the ripples stay put on the water
  const WATER_SIZE = 1200;
  const WATER_TILE = 4;
  waterStencil(m.water);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE, 240, 240), m.water);
  water.renderOrder = 2;
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, WATER_Y, 0);
  const wuv = water.geometry.getAttribute("uv");
  for (let i = 0; i < wuv.count; i++) wuv.setXY(i, wuv.getX(i) * (WATER_SIZE / WATER_TILE), wuv.getY(i) * (WATER_SIZE / WATER_TILE));
  scene.add(water);
  const waterTex = tex.water;
  // M6 tides: the Petit Bassin and the lock chamber have water of their own at their own levels
  // (world/tide.ts); drawn before the river sheet, which the stencil keeps out from under them
  const dockMat = psx(new THREE.MeshPhongMaterial({ map: tex.water, color: 0x8a9a92, specular: 0x3a342a, shininess: 120 }), { water: true, affine: 0.6 });
  dockWaterStencil(dockMat);
  /**
   * A sheet of still water over a rectangle. `ends` (fixes 2026-09-24): the near and far edges in z
   * follow a line of x instead (the closed lock gates' V), so the water stops at the gate leaves.
   */
  const basinSheet = (
    r: { minX: number; maxX: number; minZ: number; maxZ: number },
    ends?: { min?: (x: number) => number; max?: (x: number) => number },
  ): THREE.Mesh => {
    const w = r.maxX - r.minX;
    const h = r.maxZ - r.minZ;
    // a V needs a vertex at its point: 1 m columns when an edge bends
    const cols = ends ? Math.max(1, Math.ceil(w)) : Math.max(1, Math.ceil(w / WATER_TILE));
    const g = new THREE.PlaneGeometry(w, h, cols, Math.max(1, Math.ceil(h / WATER_TILE)));
    const cx = (r.minX + r.maxX) / 2;
    const cz = (r.minZ + r.maxZ) / 2;
    // the same texture tiles as the river sheet: uv = world / 4 m (plane y is -world z)
    const pa = g.getAttribute("position");
    const ua = g.getAttribute("uv");
    if (ends) {
      for (let i = 0; i < pa.count; i++) {
        const x = cx + pa.getX(i);
        const t = (cz - pa.getY(i) - r.minZ) / h; // 0 at minZ, 1 at maxZ
        const z0 = ends.min ? ends.min(x) : r.minZ;
        const z1 = ends.max ? ends.max(x) : r.maxZ;
        pa.setY(i, cz - (z0 + (z1 - z0) * t));
      }
      pa.needsUpdate = true;
      g.computeBoundingBox();
      g.computeBoundingSphere();
    }
    for (let i = 0; i < pa.count; i++) ua.setXY(i, (cx + pa.getX(i)) / WATER_TILE, -(cz - pa.getY(i)) / WATER_TILE);
    const m = new THREE.Mesh(g, dockMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(cx, tideWater.dock, cz);
    m.renderOrder = 1.5;
    scene.add(m);
    return m;
  };
  // the dock (its walls: x 70..170, z 46..110, and the lock's dock end up to the gates at z 42)
  const dockSheet = basinSheet({ minX: 70, maxX: 170, minZ: 46, maxZ: 110 });
  // fixes 2026-09-24: each sheet ends on the V of the closed gates (tide.ts gateLine), not on the hinge line
  const dockMouth = basinSheet({ minX: 104, maxX: 116, minZ: CHAMBER.maxZ, maxZ: 46 }, { min: (x) => gateLine(CHAMBER.maxZ, x) });
  const chamberSheet = basinSheet({ minX: 104, maxX: 116, minZ: CHAMBER.minZ, maxZ: CHAMBER.maxZ }, { min: (x) => gateLine(CHAMBER.minZ, x), max: (x) => gateLine(CHAMBER.maxZ, x) });
  // real reflections: the scene mirrored in the still water level (world/mirror.ts); M6 tides: the
  // plane follows the level of the water nearest the camera
  // (only while some water lies inside the fog: beyond it the water is all fog colour; sampled
  // every 4 m of the walk map, twice a second, and at once after a jump)
  let waterNear = true;
  let waterNearAt = -1e9;
  const eyeAt = new THREE.Vector3();
  const eyeWas = new THREE.Vector3(1e9, 0, 1e9);
  const mirror = createMirror(WATER_Y, {
    enabled: (camera) => {
      // the culler asks without a camera: the last answer
      if (!camera) return waterNear;
      const now = performance.now();
      eyeAt.setFromMatrixPosition(camera.matrixWorld);
      if (now - waterNearAt < 500 && Math.abs(eyeAt.x - eyeWas.x) + Math.abs(eyeAt.z - eyeWas.z) < 6) return waterNear;
      waterNearAt = now;
      eyeWas.copy(eyeAt);
      const fog = scene.fog as THREE.Fog | null;
      const r = Math.min(172, (fog?.isFog ? fog.far : 160) + 12);
      waterNear = false;
      for (let dx = -r; dx <= r && !waterNear; dx += 4) {
        for (let dz = -r; dz <= r; dz += 4) {
          if (dx * dx + dz * dz > r * r) continue;
          const f = city.flags(eyeAt.x + dx, eyeAt.z + dz);
          if (f === undefined || (f & WATER) !== 0) {
            waterNear = true;
            break;
          }
        }
      }
      return waterNear;
    },
  });
  mirror.attach(water);
  mirror.attach(dockSheet);
  mirror.attach(dockMouth);
  mirror.attach(chamberSheet);
  psxUniforms.uWaterMirror.value = mirror.texture;
  psxUniforms.uWaterMirrorMat.value = mirror.matrix;
  psxUniforms.uWaterMirrorOn.value = 1;

  // M6 tides: the mud at the foot of the walls and in the canal and vliet beds, bare at low water
  buildTideMud(scene, {
    quays: (CITY_DATA as unknown as { quays: number[][] }).quays,
    inWater,
    beds: [
      { minX: -82, maxX: -70, minZ: 0.5, maxZ: 205 },
      { minX: -150, maxX: -142, minZ: 0.5, maxZ: 72 },
    ],
  });

  // --- stone steps down to the water and iron ladders to climb out (world/quaysteps.ts)
  const steps = quaySteps(WATER_Y, { stone: tex.quayWall, iron: tex.iron });
  for (const [x, z, tx, tz] of FLIGHTS) {
    // the water side of the wall: the normal whose point a metre out lies in the river polygon
    const [nx, nz] = inWater(x - tz + tx * 2, z + tx + tz * 2) ? [-tz, tx] : [tz, -tx];
    steps.addFlight(x, z, tx, tz, nx, nz);
  }
  // --- the timber jetty (world/pier.ts): level with the quay, deck under the edge stones
  const pier = buildPier(scene, WATER_Y, tex.planks, steps);
  colliders.push(...pier.colliders, ...steps.colliders);
  bollard(scene, m, colliders, PIER_BOLLARD.x, PIER_BOLLARD.z);
  steps.flush(scene);
  /** Things in the water a swimmer bumps into: piles, hulls, the pontoon and its barges. */
  const swimSolids: Rect[] = [...pier.piles];
  // foam and lighter water along every wall and flight of steps (psx water, uShore)
  psxUniforms.uShore.value = shoreTexture([...(CITY_DATA as unknown as { quays: number[][] }).quays, ...steps.outlines], [-340, -80, 540, 380]);
  psxUniforms.uShoreBox.value.set(-340, -80, 540, 380);

  // --- signs on the real houses where the game's people work
  doorSign(scene, "hessenatie", "HESSENATIE");
  doorSign(scene, "peeters", "WED. PEETERS");
  doorSign(scene, "entrepot", "ENTREPOT");

  // --- crane
  // --- boats and cranes (Blender models, world/boats.ts): the quays full of shipping,
  // as in the period photos. The Anna Maria stays the game's own ship (its deck is walkable).
  let boats: Boats | null = null;
  // the lock of the Petit Bassin: a swing bridge and mitre gates that let tows through (world/lock.ts)
  let lock: Lock | null = null;
  // the opening bridges over the canal, the vliet and the lock (world/bridges.ts) and the
  // ships always on the move on the Schelde (world/river.ts)
  let bridges: Bridges | null = null;
  let riverTraffic: River | null = null;
  let railway: Railway | null = null;
  let omnibus: Omnibuses | null = null;
  const LOCK_DECK = (() => {
    const b = (CITY_DATA as unknown as { bridges: Record<string, number[]> }).bridges.lock_bridge;
    return { minX: b[0], minZ: b[1], maxX: b[2], maxZ: b[3] };
  })();
  const onOpening = (x: number, z: number) =>
    bridges?.list.find((b) => x > b.rect.minX && x < b.rect.maxX && z > b.rect.minZ && z < b.rect.maxZ) ?? null;
  // people walking: a bridge does not open while anyone is on its deck
  let peopleFn: (() => Iterable<{ x: number; z: number }>) | null = null;
  /** Fixes 2026-09-24: where the handcarts stand (parked or pushed): the lock gates' beams keep off them. */
  let cartsFn: (() => Iterable<{ x: number; z: number }>) | null = null;
  const peopleOn = (r: { minX: number; maxX: number; minZ: number; maxZ: number }) => {
    if (!peopleFn) return false;
    // on the deck itself only: people waiting at the ends (bridgeWait) must not hold it shut
    for (const p of peopleFn()) if (p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ) return true;
    return false;
  };
  loadBoats()
    .then((b) => {
      boats = b;
      lock = createLock(scene, b, {
        world: { addCollider: (r) => dynamic.add(r), removeCollider: (r) => dynamic.delete(r) },
        occupied: () =>
          (!!camera && !!onOpening(camera.position.x, camera.position.z)) || !!railway?.busy(LOCK_DECK) || !!omnibus?.busy(LOCK_DECK) || peopleOn(LOCK_DECK),
        // fixes 2026-09-24: a gate waits while Jef or a cart stands where its balance beam swings
        sweepBusy: (inSweep) => {
          if (camera && inSweep(camera.position.x, camera.position.z, 0.32)) return true;
          for (const c of cartsFn?.() ?? []) if (inSweep(c.x, c.z, 0.6)) return true;
          for (const m of movers) if (inSweep((m.minX + m.maxX) / 2, (m.minZ + m.maxZ) / 2, Math.max(m.maxX - m.minX, m.maxZ - m.minZ) / 2)) return true;
          return false;
        },
      });
      bridges = createBridges(scene, b, {
        lock,
        player: () => (camera ? { x: camera.position.x, z: camera.position.z } : null),
        busy: (r) => !!railway?.busy(r) || !!omnibus?.busy(r) || peopleOn(r),
        world: { addCollider: (r) => dynamic.add(r), removeCollider: (r) => dynamic.delete(r) },
      });
      riverTraffic = createRiver(scene, b);
      // the tall things on the moored ships (masts, rigging, funnels): the cranes' jibs keep off them
      // (world/railway.ts, M6 cranes): [x, z, top over the waterline, the level she sits on below]
      const tallThings: Array<[number, number, number, number]> = [];
      const addTall = (name: Parameters<Boats["tall"]>[0], x: number, z: number, yaw: number, floor = -Infinity) => {
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        for (const [lx, lz, top] of b.tall(name)) tallThings.push([x + lx * c + lz * s, z - lx * s + lz * c, top, floor]);
      };
      // the Anna Maria at the Rijnkaai, her gangway at RAMP; a barque lies outside her
      // M6 tides: at low water she sits on the bottom at her berth (tide.ts BRIG_FLOOR)
      b.place("brig", -40, -7.2, Math.PI / 2, scene).userData.floor = BRIG_FLOOR;
      addTall("brig", -40, -7.2, Math.PI / 2, BRIG_FLOOR);
      const d = b.deck("brig", -40, -7.2, Math.PI / 2);
      if (d) for (const o of d.obstacles) colliders.push(o);
      b.place("barque", -34, -26, Math.PI / 2, scene);
      addTall("barque", -34, -26, Math.PI / 2);
      // portal cranes on the quays; the jib rests along +z, yaw turns it over the water
      const cranes: Array<[number, number, number]> = [
        [-24, 4.0, Math.PI], [0, 4.0, Math.PI], [60, 4.0, Math.PI], // 17 m apart at least (M6 cranes)
        [66, 62, Math.PI / 2], [66, 92, Math.PI / 2], [173, 66, -Math.PI / 2], [173, 100, -Math.PI / 2],
        [-280, 4.0, Math.PI], [-240, 4.0, Math.PI], [-300, 4.0, Math.PI],
      ];
      const craneSites: CraneSite[] = [];
      for (const [x, z, yaw] of cranes) {
        // (their legs' colliders move with them: world/railway.ts, M3g travelling cranes)
        craneSites.push({ x, z, yaw, obj: b.crane(x, z, yaw, scene) });
      }
      // every hull is an obstacle for a swimmer (its footprint on the water, a little short of bow and stern)
      const hull = (name: Parameters<Boats["dims"]>[0], x: number, z: number, yaw: number) => {
        const d = b.dims(name);
        const s = Math.abs(Math.sin(yaw));
        const c = Math.abs(Math.cos(yaw));
        const hl = d.length * 0.45;
        const hb = d.beam * 0.5;
        swimSolids.push({ minX: x - s * hl - c * hb, maxX: x + s * hl + c * hb, minZ: z - c * hl - s * hb, maxZ: z + c * hl + s * hb });
      };
      const moor = (...a: Parameters<Boats["mooreAlong"]>) => {
        for (const p of b.mooreAlong(...a).placed) {
          hull(p.name, p.x, p.z, p.yaw);
          addTall(p.name, p.x, p.z, p.yaw);
        }
      };
      const put = (...a: Parameters<Boats["place"]>) => {
        b.place(...a);
        hull(a[0], a[1], a[2], a[3]);
        addTall(a[0], a[1], a[2], a[3]);
      };
      // the river: moored along the Werf and the north Rijnkaai, ships at anchor further out
      // (gaps left for the stone steps, FLIGHTS)
      const river = { x: 0, z: -40 };
      moor(scene, -316, 0, -258, 0, river, ["rhine_barge", "hengst", "lighter_loaded", "sloop", "lighter"], { rows: 2, seed: 3 });
      moor(scene, -240, 0, -216, 0, river, ["hengst", "lighter", "rowboat"], { seed: 4 });
      moor(scene, -140, 0, -119, 0, river, ["hengst", "lighter_loaded", "sloop", "punt"], { rows: 2, seed: 5 });
      moor(scene, -107, 0, -90, 0, river, ["hengst", "lighter_loaded", "sloop", "punt"], { rows: 2, seed: 8 });
      moor(scene, 60, 0, 100, 0, river, ["tug", "lighter", "hengst"], { seed: 6 });
      moor(scene, 120, 0, 176, 0, river, ["rhine_barge", "lighter_loaded", "sloop"], { rows: 2, seed: 7 });
      put("steamer", -150, -62, Math.PI / 2, scene);
      put("barque", -40, -48, Math.PI / 2, scene);
      put("barque", 110, -44, -Math.PI / 2, scene);
      put("paddle_tug", -205, -64, Math.PI / 2 + 0.3, scene);
      put("sloop", 30, -70, 1.2, scene);
      // the Canal des Brasseurs and the Sint-Pietersvliet: narrow boats against both walls
      const canal = { x: -76, z: 100 };
      for (const [z0, z1] of [[12, 64], [76, 148], [160, 202]]) {
        moor(scene, -82, z0, -82, z1, canal, ["hengst", "lighter", "punt", "rowboat", "lighter_loaded"], { maxBeam: 4.5, seed: z0 });
        if (z0 === 12) {
          // the steps on the east wall at z 38..44
          moor(scene, -70, 12, -70, 35, canal, ["lighter", "punt", "rowboat"], { maxBeam: 4.5, seed: 13 });
          moor(scene, -70, 47, -70, 64, canal, ["lighter", "punt", "rowboat"], { maxBeam: 4.5, seed: 14 });
        } else moor(scene, -70, z0, -70, z1, canal, ["lighter", "punt", "rowboat"], { maxBeam: 4.5, seed: z0 + 1 });
      }
      const vliet = { x: -146, z: 30 };
      moor(scene, -150, 11, -150, 38, vliet, ["punt", "rowboat"], { maxBeam: 3, seed: 21 });
      moor(scene, -142, 49, -142, 70, vliet, ["punt", "rowboat"], { maxBeam: 3, seed: 22 });
      // the Petit Bassin: barges and lighters along all four quays, a barque in the middle
      const dock = { x: 120, z: 78 };
      moor(scene, 70, 50, 70, 106, dock, ["rhine_barge", "lighter_loaded", "hengst"], { rows: 2, seed: 31 });
      moor(scene, 170, 50, 170, 106, dock, ["rhine_barge", "lighter_loaded", "tug"], { rows: 2, seed: 32 });
      moor(scene, 76, 110, 164, 110, dock, ["hengst", "lighter", "rhine_barge"], { seed: 33 });
      moor(scene, 120, 46, 164, 46, dock, ["lighter_loaded", "hengst"], { seed: 34 });
      put("barque", 125, 80, 0, scene);
      // the ferry pontoon at the Werf (its deck is walkable, see tools/city/design.py); it floats
      // below the quay now, so a gangway slopes down onto it
      const deckRect = b.pontoon(scene, PONTOON.x, PONTOON.maxZ, PONTOON.minZ)[0];
      if (deckRect) pontoonDeck = deckRect.y - levelAt(PONTOON.x, (PONTOON.minZ + PONTOON.maxZ) / 2);
      pontoonPivot = pontoonGangway(scene, m);
      // ladders on the free stretches of wall, now that the boats lie where they lie
      city.ready.then(placeLadders).catch((e) => console.warn("ladders", e));
      // the goods train on the quay railway, the cranes at work (world/railway.ts, M3g)
      Promise.all([city.ready, loadProps()])
        .then(([, p]) => {
          railway = createRailway(scene, {
            tracks: trackData,
            cranes: craneSites,
            props: p,
            tex: { planks: m.planks.map!, sack: m.sack.map!, crate: m.crate.map! },
            bridges: () => bridges?.list ?? [],
            isFree: freeOfMovers,
            hullAt: (x, z) => swimSolids.some((c) => inRect(c, x, z)),
            tall: tallThings,
            addCollider: (r) => dynamic.add(r),
            removeCollider: (r) => dynamic.delete(r),
            waterY: WATER_Y,
            spareHorses: OMNIBUS_HORSES,
            gate: railGate,
            raised: {
              add: (d) => {
                raised.add(d);
                raisedLow = Math.min(raisedLow, d.y);
              },
            },
          });
          for (const r of railway.colliders()) dynamic.add(r); // added once: the rects move in place
          // the horse omnibuses, quay and town lines (world/omnibus.ts), their horses from the same pool
          omnibus = createOmnibuses(scene, {
            horses: railway.horses,
            horseIndex: 2,
            tex: { planks: m.planks.map! },
            bridges: () => bridges?.list ?? [],
            isFree: freeOfMovers,
            lit: () => lampsLit,
            // M6 handcart: where its round crosses the rails the goods train has the right of way
            onRails: (x: number, z: number) => railBand.some((r) => inRect(r, x, z, 1.0)),
            trainBusy: (r) => !!railway?.busy(r),
          });
          for (const r of omnibus.colliders()) dynamic.add(r);
          for (const st of OMNIBUS_STOPS) colliders.push(rectAround(st.post[0], st.post[1], 0.12, 0.12));
        })
        .catch((e) => console.warn("the quay railway did not start", e));
    })
    .catch((e) => {
      console.warn("boats.glb did not load", e);
      crane(scene, m, colliders, -24, 1.6);
      city.ready.then(placeLadders).catch(() => {});
    });

  // --- props
  crateStack(scene, m, colliders, -20, 14, 3);
  crateStack(scene, m, colliders, -14.6, 15.2, 2);
  crateStack(scene, m, colliders, 12, 12.8, 2);
  crateStack(scene, m, colliders, 36, 18, 3);
  crateStack(scene, m, colliders, 41, 16.5, 1);
  crateStack(scene, m, colliders, -52, 12, 2);
  barrels(scene, m, colliders, -44, 18, 5);
  barrels(scene, m, colliders, 30, 13, 3);
  barrels(scene, m, colliders, -6, 12.8, 2);
  sacks(scene, m, colliders, 14, 19.5);
  sacks(scene, m, colliders, -34, 17);
  // on the Rijnkaai: a loaded handcart by the cart stand and a dray with its horse
  loadProps()
    .then((p) => {
      for (const [name, x, z, yaw] of [["handcart_loaded", 47, 12, 0.5], ["dray_horse", 58, 30, 1.9]] as const) {
        p.place(name, x, z, yaw, scene);
        colliders.push(...p.colliders(name, x, z, yaw));
      }
      // gas lamps along the Werf, the Steenplein and the squares (tools/city/design.py decor)
      const decor = (CITY_DATA as unknown as { decor?: { lamps?: Array<[number, number]> } }).decor;
      (decor?.lamps ?? []).forEach(([x, z], i) => {
        // M6: each lit by the lamplighter on his round (world/gaslamps.ts)
        gasLamps.addDecor(i, p.place("gas_lamp", x, z, 0, scene), x, z);
        colliders.push(rectAround(x, z, 0.2, 0.2));
      });
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
  // the Anna Maria (a brig) and a barque outside her come from boats.glb (loadBoats below);
  // their hulls stop a swimmer
  swimSolids.push({ minX: SHIP_X, maxX: SHIP_X + 40, minZ: -11.7, maxZ: -2.7 }, { minX: -56, maxX: -12, minZ: -31, maxZ: -21 });
  // the pontoon's barges, and the lock (its gates and the tows): no swimming there
  swimSolids.push({ minX: PONTOON.minX - 9.5, maxX: PONTOON.maxX + 9.5, minZ: PONTOON.minZ - 2, maxZ: -2.5 });
  const lockWater: Rect = { minX: 103.5, maxX: 116.5, minZ: -3, maxZ: 47 };
  swimSolids.push(lockWater);
  /** Boats left lying on the water (M3j): they move, so they are kept apart from the fixed solids. */
  const waterDynamic = new Set<Rect>();
  // gangway: a plank from the brig's rail down (or up) to the quay. M6 tides: it hangs from the rail
  // and its foot rolls on the quay, so it tilts with the tide (a pivot at the rail end)
  const rampPivot = new THREE.Group();
  {
    const plank = box(0.9, 0.05, RAMP_LEN, m.planks, 0, 0.03, RAMP_LEN / 2, 1);
    rampPivot.add(plank);
    for (let i = 1; i < 8; i++) rampPivot.add(box(0.8, 0.04, 0.06, m.darkWood, 0, 0.07, (RAMP_LEN * i) / 8, 1));
    for (const s of [-0.5, 0.5]) {
      rampPivot.add(rod(new THREE.Vector3(s, 1.0, 0), new THREE.Vector3(s, 1.0, RAMP_LEN), 0.025, m.rope));
      for (const k of [0.05, 0.5, 0.95]) rampPivot.add(rod(new THREE.Vector3(s, 0.05, RAMP_LEN * k), new THREE.Vector3(s, 1.0, RAMP_LEN * k), 0.02, m.darkWood));
    }
    scene.add(rampPivot);
  }
  // mooring lines from the brig to two bollards: unit rods stretched each time the deck moves
  const unitRope = new THREE.CylinderGeometry(0.04, 0.04, 1, 4, 1).translate(0, 0.5, 0);
  const brigLines = [
    { from: new THREE.Vector3(-56, 0.9, -3.2), to: new THREE.Vector3(SHIP_X + 4, 0.5, edgeZ(SHIP_X + 4) + 0.9), mesh: new THREE.Mesh(unitRope, m.rope) },
    { from: new THREE.Vector3(-24, 0.9, -3.2), to: new THREE.Vector3(SHIP_X + 32, 0.5, edgeZ(SHIP_X + 32) + 0.9), mesh: new THREE.Mesh(unitRope, m.rope) },
  ];
  for (const l of brigLines) scene.add(l.mesh);
  const lineA = new THREE.Vector3();
  const lineD = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  let placedDeck = NaN;
  /** Put the brig's gangway and lines where her deck is now (DECK.y). */
  function placeBrigKit(): void {
    if (Math.abs(DECK.y - placedDeck) < 0.005) return;
    placedDeck = DECK.y;
    const sin = THREE.MathUtils.clamp(DECK.y / RAMP_LEN, -0.95, 0.95);
    RAMP.zLow = RAMP.zHigh + RAMP_LEN * Math.sqrt(1 - sin * sin);
    rampPivot.position.set(RAMP.x, DECK.y, RAMP.zHigh);
    rampPivot.rotation.x = Math.asin(sin);
    for (const l of brigLines) {
      lineA.copy(l.from);
      lineA.y += DECK.y;
      lineD.subVectors(l.to, lineA);
      l.mesh.position.copy(lineA);
      l.mesh.scale.set(1, lineD.length(), 1);
      l.mesh.quaternion.setFromUnitVectors(UP, lineD.normalize());
    }
  }
  placeBrigKit();

  // --- gas lamps (6)
  const glow = glowTexture();
  const lampSpots: Array<[number, number, boolean]> = [
    [-48, 2.2, false],
    [-30, 2.2, false],
    [-10, 20.4, false],
    [4, 2.2, true], // the one that sputters (off the crane runway at z 1.4, M3g)
    [24, 2.2, false],
    [44, 19.8, false],
  ];
  // lamps on the quay stand a step back from the edge
  const lamps: Lamp[] = lampSpots.map(([x, z, broken], i) => gasLamp(scene, m, colliders, glow, x, z < 6 ? Math.max(z, edgeZ(x) + 1.6) : z, i, broken));
  const lantern = dossLantern(scene, m, glow);
  const gasLamps = createGasLamps(scene, lamps.map((l) => ({ x: l.pos.x, z: l.pos.z })));

  // --- movement rules
  const onRamp = (x: number, z: number) => Math.abs(x - RAMP.x) < RAMP.halfW && z < RAMP.zLow && z > RAMP.zHigh - 0.2;
  const onDeck = (x: number, z: number) => x > DECK.minX && x < DECK.maxX && z > DECK.minZ && z < DECK.maxZ;
  const onPontoon = (x: number, z: number) => x > PONTOON.minX && x < PONTOON.maxX && z > PONTOON.minZ && z < PONTOON.maxZ;
  /**
   * Height of the walkable surface itself: 0 on the quay and pier, a slope on the gangway, the deck
   * on the ship, the steps down to the water, the pontoon and the gangway down onto it.
   */
  // M7 interiors in the world: their areas (World.addWalkArea)
  const walkAreas: WalkArea[] = [];
  const areaAt = (x: number, z: number): WalkArea | null => {
    for (const a of walkAreas) if (x > a.box.minX && x < a.box.maxX && z > a.box.minZ && z < a.box.maxZ && a.has(x, z)) return a;
    return null;
  };
  const areaHits = (x: number, z: number, r: number) => {
    for (const a of walkAreas) if (x > a.box.minX - r && x < a.box.maxX + r && z > a.box.minZ - r && z < a.box.maxZ + r && a.hits(x, z, r)) return true;
    return false;
  };
  const baseAt = (x: number, z: number) => {
    if (onDeck(x, z)) return DECK.y;
    if (onRamp(x, z)) return THREE.MathUtils.clamp((RAMP.zLow - z) / (RAMP.zLow - RAMP.zHigh), 0, 1) * DECK.y;
    if (onPontoon(x, z)) return pontoonY * THREE.MathUtils.clamp(-z / pontoonReach, 0, 1);
    const st = steps.heightAt(x, z);
    if (st) return st.y;
    const wa = areaAt(x, z); // M7: a building's inside in the world
    if (wa) return wa.floor(x, z);
    const sh = steenHeightAt(x, z); // Het Steen's courtyard and ramp (M3i)
    if (sh !== null) return sh;
    return 0;
  };
  const onPier = (x: number, z: number) => x > PIER.minX && x < PIER.maxX && z > PIER.minZ && z < PIER.maxZ;
  const isWalkable = (x: number, z: number) => {
    {
      const wa = areaAt(x, z);
      if (wa) return wa.walkable(x, z);
    }
    {
      const ob = onOpening(x, z);
      if (ob) return ob.closed();
    }
    if (onPier(x, z) || onRamp(x, z) || onDeck(x, z)) return true;
    const f = city.flags(x, z);
    if (f === undefined) return x > QUAY.minX && x < QUAY.maxX && z > QUAY.minZ && z < QUAY.maxZ;
    return f === 0;
  };
  /** Counts every real add and delete of the colliders that come and go (World.solidsVersion). */
  let dynamicVersion = 0;
  const dynamic = new (class extends Set<Rect> {
    add(r: Rect): this {
      if (!this.has(r)) dynamicVersion++;
      return super.add(r);
    }
    delete(r: Rect): boolean {
      const had = super.delete(r);
      if (had) dynamicVersion++;
      return had;
    }
  })();
  /** Things with a top lower than feet + STEP can be walked onto. */
  const STEP = 0.36;
  const blocks = (c: Rect, feet: number) => (c.top ?? Infinity) > feet + STEP;
  // the fixed colliders filed in 4 m cells, so a question looks at the few near it, not all of
  // them; the list only grows (the new ones are filed at the next question)
  const CELL = 4;
  const cells = new Map<number, Rect[]>();
  const bigSolids: Rect[] = [];
  let filed = 0;
  const cellKey = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);
  const fileSolids = () => {
    if (colliders.length < filed) {
      cells.clear();
      bigSolids.length = 0;
      filed = 0;
    }
    for (; filed < colliders.length; filed++) {
      const c = colliders[filed];
      const i0 = Math.floor(c.minX / CELL);
      const i1 = Math.floor(c.maxX / CELL);
      const j0 = Math.floor(c.minZ / CELL);
      const j1 = Math.floor(c.maxZ / CELL);
      // (a long one, or odd numbers: looked at every time)
      if (!(i1 - i0 <= 16 && j1 - j0 <= 16 && Math.abs(i0) < 30000 && Math.abs(j0) < 30000)) {
        bigSolids.push(c);
        continue;
      }
      for (let i = i0; i <= i1; i++)
        for (let j = j0; j <= j1; j++) {
          const k = cellKey(i, j);
          const l = cells.get(k);
          if (l) l.push(c);
          else cells.set(k, [c]);
        }
    }
  };
  /** A fixed collider within r of (x, z) that stops feet at this height (the same answer as trying them all). */
  const staticHit = (x: number, z: number, r: number, feet: number) => {
    fileSolids();
    for (const c of bigSolids) if (inRect(c, x, z, r) && blocks(c, feet)) return true;
    // a hair wider than r, so rounding never leaves out a cell inRect would reach
    const e = Math.abs(r) + 1e-6;
    const i0 = Math.floor((x - e) / CELL);
    const i1 = Math.floor((x + e) / CELL);
    const j0 = Math.floor((z - e) / CELL);
    const j1 = Math.floor((z + e) / CELL);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const l = cells.get(cellKey(i, j));
        if (l) for (const c of l) if (inRect(c, x, z, r) && blocks(c, feet)) return true;
      }
    return false;
  };
  const RING_COS = Array.from({ length: 8 }, (_, i) => Math.cos((i * Math.PI) / 4));
  const RING_SIN = Array.from({ length: 8 }, (_, i) => Math.sin((i * Math.PI) / 4));
  /** A house or landmark wall within m metres (8 points on a ring): keeps the eye out of walls. */
  const wallNear = (x: number, z: number, m: number) => {
    for (let i = 0; i < 8; i++) {
      const px = x + RING_COS[i] * m;
      const pz = z + RING_SIN[i] * m;
      // M7: inside a building in the world, its own walls
      const wa = areaAt(px, pz);
      if (wa) {
        if (!wa.walkable(px, pz)) return true;
        continue;
      }
      const f = city.flags(px, pz);
      if (f !== undefined && (f & WALL) !== 0) return true;
    }
    return false;
  };
  const isFree = (x: number, z: number, r: number, feet = 0) => {
    if (!isWalkable(x, z)) return false;
    if (wallNear(x, z, r + 0.15)) return false;
    if (areaHits(x, z, r)) return false;
    if (staticHit(x, z, r, feet)) return false;
    for (const c of dynamic) if (inRect(c, x, z, r) && blocks(c, feet)) return false;
    return true;
  };
  /** M6 handcart: carts pushed by walkers and led drays (World.addMover): solid for Jef and the vehicles. */
  const movers = new Set<Rect>();
  const moverAt = (x: number, z: number, r: number) => {
    for (const c of movers) if (inRect(c, x, z, r)) return true;
    return false;
  };
  /** Free for a dray, the train or the omnibus: as isFree, and no pushed cart or led horse in the way. */
  const freeOfMovers = (x: number, z: number, r: number) => isFree(x, z, r) && !moverAt(x, z, r);

  // --- the player's own rules: stone steps, falling in, swimming (the crowd and the path
  // check keep to isWalkable/isFree above: water and steps are never a path)
  /** What the player may stand on here: a height, or null for open water or a wall. */
  const floorAt = (x: number, z: number): number | null => {
    if (steps.heightAt(x, z) || isWalkable(x, z)) return baseAt(x, z);
    // the last half metre of stone that the coarse walk map counts as water: you fall at the true edge
    const f = city.flags(x, z);
    if (f !== undefined && (f & WATER) !== 0 && (f & (WALL | OUTSIDE)) === 0 && !inWater(x, z)) return baseAt(x, z);
    // the edge's lip: your body stands out a hand over the edge before you go (Steve: you fell
    // while the stone still showed at your feet); you fall once your middle is well past it
    if (f !== undefined && (f & WALL) === 0) {
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const px = x + Math.cos(a) * EDGE_LIP;
        const pz = z + Math.sin(a) * EDGE_LIP;
        if (!inWater(px, pz) && isWalkable(px, pz)) return baseAt(px, pz);
      }
    }
    return null;
  };
  const EDGE_LIP = 0.28;
  /** Railings along the water (tools/city/design.py decor rails): only drawn in the city model, so they stop the player here. Gap at the pontoon. */
  const railings: Rect[] = [];
  for (const [x0, z0, x1, z1] of (CITY_DATA as unknown as { decor?: { rails?: number[][] } }).decor?.rails ?? []) {
    const L = Math.hypot(x1 - x0, z1 - z0);
    for (let s = 0; s < L; s += 0.5) {
      const x = x0 + ((x1 - x0) * s) / L;
      const z = z0 + ((z1 - z0) * s) / L;
      if (Math.abs(x - PONTOON.x) < 2.2 && Math.abs(z) < 1.5) continue;
      railings.push(rectAround(x, z, 0.3, 0.3));
    }
  }
  /** Open water by the walk map: not a wall, not beyond the map, not the lock (its gates and tows). */
  const openWater = (x: number, z: number) => {
    {
      const ob = onOpening(x, z);
      if (ob && !ob.closed()) return false;
    }
    const f = city.flags(x, z);
    return f !== undefined && (f & WATER) !== 0 && (f & (WALL | OUTSIDE)) === 0;
  };
  /** A quay wall face within r (exact, from the quay lines: the walk map is only 0.5 m fine). */
  const QUAY_LINES = (CITY_DATA as unknown as { quays: number[][] }).quays;
  const wallWithin = (x: number, z: number, r: number) => {
    for (const [ax, az, bx, bz] of QUAY_LINES) {
      if (x < Math.min(ax, bx) - r || x > Math.max(ax, bx) + r || z < Math.min(az, bz) - r || z > Math.max(az, bz) + r) continue;
      const L2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L2));
      if (Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t) < r) return true;
    }
    return false;
  };
  function swimFree(x: number, z: number, r: number): boolean {
    if (!openWater(x, z) || wallWithin(x, z, r)) return false;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      if (!openWater(x + Math.cos(a) * r, z + Math.sin(a) * r)) return false;
    }
    if (steps.solidAt(x, z, r, stepsStatic ? undefined : levelAt(x, z))) return false;
    for (const c of swimSolids) if (inRect(c, x, z, r)) return false;
    for (const c of waterDynamic) if (inRect(c, x, z, r)) return false;
    return true;
  }
  /** While the ladders are placed: the flights count as solid whatever the tide (M6 tides). */
  let stepsStatic = false;
  /** M3j: open water for a boat (see World.boatFree). */
  function boatFree(x: number, z: number, r: number, pass?: (c: Rect) => boolean): boolean {
    // the walk map has the decks of the opening bridges as ground, a little past their rects: there, the water polygon says
    const nearOpening = (px: number, pz: number) =>
      !!bridges?.list.some((b) => px > b.rect.minX - 1 && px < b.rect.maxX + 1 && pz > b.rect.minZ - 1 && pz < b.rect.maxZ + 1);
    const water = (px: number, pz: number) => {
      if (nearOpening(px, pz)) return inWater(px, pz);
      const f = city.flags(px, pz);
      return f !== undefined && (f & WATER) !== 0 && (f & (WALL | OUTSIDE)) === 0;
    };
    if (!water(x, z) || wallWithin(x, z, r)) return false;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      if (!water(x + Math.cos(a) * r, z + Math.sin(a) * r)) return false;
    }
    if (steps.solidAt(x, z, r, levelAt(x, z))) return false;
    for (const c of swimSolids) if (inRect(c, x, z, r) && !pass?.(c)) return false;
    for (const c of waterDynamic) if (inRect(c, x, z, r) && !pass?.(c)) return false;
    return true;
  }
  const SWIM_R = 0.32;
  function nearestSwim(x: number, z: number, r = SWIM_R): [number, number] | null {
    if (swimFree(x, z, r)) return [x, z];
    for (let d = 0.15; d <= 1.0; d += 0.15)
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6;
        const px = x + Math.cos(a) * d;
        const pz = z + Math.sin(a) * d;
        if (swimFree(px, pz, r)) return [px, pz];
      }
    return null;
  }
  /** Can you drop into the water at (x, z)? Open water, not onto a hull or a pile, with room to swim close by. */
  const swimmable = (x: number, z: number) => openWater(x, z) && !steps.solidAt(x, z, 0, levelAt(x, z)) && !swimSolids.some((c) => inRect(c, x, z)) && nearestSwim(x, z) !== null;
  /** Rails, bulwarks and parapets: you do not fall off a ship, a gangway, a bridge, the pontoon or a flight of steps. */
  const railedFrom = (x: number, z: number) => {
    if (onDeck(x, z) || onRamp(x, z) || onPontoon(x, z)) return true;
    const st = steps.heightAt(x, z);
    if (st && !st.landing) return true;
    for (const b of bridgeRects) if (x > Math.min(b[0], b[2]) && x < Math.max(b[0], b[2]) && z > Math.min(b[1], b[3]) && z < Math.max(b[1], b[3])) return true;
    return false;
  };
  /**
   * Walkable areas up in the air (M3g: the cranes' galleries, doorways and cabins; moved in place).
   * Overlapping areas make one place; its edges are rails and walls. Where two overlap, the higher
   * floor counts (the cabin a step up from the gallery).
   */
  const raised = new Set<RaisedDeck>();
  /** The lowest of them: anyone walking below it (everyone on the ground) skips them all. */
  let raisedLow = Infinity;
  const raisedAt = (x: number, z: number, feet: number): RaisedDeck | null => {
    if (feet < raisedLow - 0.8) return null;
    let best: RaisedDeck | null = null;
    for (const d of raised) {
      if (Math.abs(feet - d.y) < 0.8 && x > d.minX && x < d.maxX && z > d.minZ && z < d.maxZ && (!best || d.y > best.y)) best = d;
    }
    return best;
  };
  /** Up there: may you stand at (x, z)? Well inside one of the areas, a step up or down at most. */
  const raisedFree = (x: number, z: number, r: number, feet: number) => {
    const m = r * 0.5;
    for (const d of raised) {
      if (Math.abs(feet - d.y) <= STEP && x > d.minX + m && x < d.maxX - m && z > d.minZ + m && z < d.maxZ - m) return true;
    }
    return false;
  };
  const hits = (x: number, z: number, r: number, feet: number) => {
    if (areaHits(x, z, r)) return true;
    const hit = (c: Rect) => inRect(c, x, z, r) && !inside?.has(c);
    // the grid cannot leave out the colliders Jef stands inside: then the plain loop
    if (inside?.size) {
      for (const c of colliders) if (hit(c) && blocks(c, feet)) return true;
    } else if (staticHit(x, z, r, feet)) return true;
    for (const c of dynamic) if (hit(c) && blocks(c, feet)) return true;
    for (const c of railings) if (hit(c)) return true;
    for (const c of movers) if (hit(c) && blocks(c, feet)) return true;
    return false;
  };
  function walkFree(fx: number, fz: number, x: number, z: number, r: number, feet: number, laden: boolean): boolean {
    // up on a raised deck (a crane's gallery and cabin): railed and walled all round, nothing else counts
    if (raisedAt(fx, fz, feet)) return raisedFree(x, z, r, feet);
    const f = floorAt(x, z);
    if (f === null) {
      // off the edge, into the Schelde: never with goods in your arms, never over a rail
      if (laden || railedFrom(fx, fz) || !swimmable(x, z)) return false;
      return !hits(x, z, r, feet);
    }
    if (f > feet + STEP) return false; // a wall face: the quay from the steps, the pier from the landing
    // fixes 2026-09-24 (Steve: "the quay wall is partly see through"): on the quay steps the body, not
    // only its centre, keeps off the wall face. The centre could reach the wall line, the eye came within
    // the camera's near plane (8 cm) of the wall sheet, and the wall was cut away round it.
    if (steps.heightAt(x, z) && faceNear(x, z, r + 0.1, feet)) return false;
    if (wallNear(x, z, r + 0.15)) return false;
    return !hits(x, z, r, feet);
  }

  /** Is there stone higher than a step within m of (x, z) (a wall face beside the quay steps)? */
  function faceNear(x: number, z: number, m: number, feet: number): boolean {
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const g = floorAt(x + Math.cos(a) * m, z + Math.sin(a) * m);
      if (g !== null && g > feet + STEP) return true;
    }
    return false;
  }

  /** Height to stand on at (x, z): the highest top you are over and could reach. Open water: the river bed. */
  function groundAt(x: number, z: number, r: number, feet: number): number {
    const up = raisedAt(x, z, feet);
    if (up) return up.y;
    const f = floorAt(x, z);
    let g = f ?? LW_MIN - 3;
    const consider = (c: Rect) => {
      if (c.top !== undefined && c.top <= feet + STEP && inRect(c, x, z, r * 0.6)) g = Math.max(g, c.top);
    };
    colliders.forEach(consider);
    dynamic.forEach(consider);
    return g;
  }

  function move(x: number, z: number, dx: number, dz: number, r: number, feet = 0, laden = false): [number, number] {
    let nx = x + dx;
    if (!walkFree(x, z, nx, z, r, feet, laden)) nx = x;
    let nz = z + dz;
    if (!walkFree(nx, z, nx, nz, r, feet, laden)) nz = z;
    if (nx === x && nz === z && (dx || dz)) return moveOut(x, z, dx, dz, r, feet, laden);
    return [nx, nz];
  }

  /**
   * Fixes 2026-09-24 (Steve: stuck at the top of a ladder out of the water): a crane's leg or a wagon
   * stood on the spot, and every step from inside it was refused. What you already stand in does not
   * hold you: you walk out of it (everything else still counts).
   */
  let inside: Set<Rect> | null = null;
  function moveOut(x: number, z: number, dx: number, dz: number, r: number, feet: number, laden: boolean): [number, number] {
    const got = new Set<Rect>();
    for (const set of [colliders, dynamic, movers] as Iterable<Rect>[]) for (const c of set) if (inRect(c, x, z, r) && blocks(c, feet)) got.add(c);
    for (const c of railings) if (inRect(c, x, z, r)) got.add(c);
    if (!got.size) return [x, z];
    inside = got;
    try {
      let nx = x + dx;
      if (!walkFree(x, z, nx, z, r, feet, laden)) nx = x;
      let nz = z + dz;
      if (!walkFree(nx, z, nx, nz, r, feet, laden)) nz = z;
      return [nx, nz];
    } finally {
      inside = null;
    }
  }

  /** May the player stand at (x, z) with his feet at `feet`? (Climbing out of the water: a free spot at the top.) */
  const standFree = (x: number, z: number, r: number, feet: number) => {
    const f = raisedAt(x, z, feet)?.y ?? floorAt(x, z);
    return f !== null && Math.abs(f - feet) <= STEP && walkFree(x, z, x, z, r, feet, false);
  };

  function swimMove(x: number, z: number, dx: number, dz: number, r: number): [number, number] {
    let nx = x + dx;
    if (!swimFree(nx, z, r)) nx = x;
    let nz = z + dz;
    if (!swimFree(nx, nz, r)) nz = z;
    return [nx, nz];
  }

  /** The water surface as drawn: the wave sampled on the sheet's 4 m grid, cut into the same triangles. */
  function waterLevel(x: number, z: number): number {
    const t = psxUniforms.uTime.value;
    const x0 = Math.floor(x / WATER_TILE) * WATER_TILE;
    const z0 = Math.floor(z / WATER_TILE) * WATER_TILE;
    const fx = (x - x0) / WATER_TILE;
    const fz = (z - z0) / WATER_TILE;
    const ha = waveAt(x0, z0, t);
    const hb = waveAt(x0, z0 + WATER_TILE, t);
    const hc = waveAt(x0 + WATER_TILE, z0 + WATER_TILE, t);
    const hd = waveAt(x0 + WATER_TILE, z0, t);
    const h = fx + fz <= 1 ? ha + (hd - ha) * fx + (hb - ha) * fz : hc + (hb - hc) * (1 - fx) + (hd - hc) * (1 - fz);
    return levelAt(x, z) + h;
  }

  const onPierDeck = (x: number, z: number) => x > 5 && x < 9 && z > -12 && z < 0;
  const isWater = (x: number, z: number) => {
    {
      const ob = onOpening(x, z);
      if (ob) return !ob.closed();
    }
    if (onPierDeck(x, z) || onRamp(x, z) || onDeck(x, z) || steps.heightAt(x, z)) return false;
    const f = city.flags(x, z);
    if (f === undefined) return z < 0;
    return (f & (WATER | OUTSIDE)) !== 0 && (f & WALL) === 0;
  };

  /**
   * Iron ladders every 30-50 m on the free stretches of every quay wall: not behind a moored
   * boat, not at a railing, a bridge, the pier, the pontoon, the lock or a flight of steps,
   * and not where something stands on the quay edge. Run once the boats are in.
   */
  function placeLadders(): void {
    stepsStatic = true;
    try {
      placeLaddersNow();
    } finally {
      stepsStatic = false;
    }
  }
  function placeLaddersNow(): void {
    const quays = (CITY_DATA as unknown as { quays: number[][] }).quays;
    const blocked = (x: number, z: number, nx: number, nz: number) => {
      const wx = x + nx * 0.8;
      const wz = z + nz * 0.8;
      if (!swimFree(wx, wz, 0.45)) return true; // a hull, a pile, the steps, a bridge
      if (steps.solidAt(x, z, 3)) return true;
      if (Math.hypot(x - 7, z) < 5) return true; // the pier root
      if (Math.abs(x - PONTOON.x) < 12 && z > -1 && z < 1) return true;
      for (const c of railings) if (inRect(c, x - nx * 0.3, z - nz * 0.3, 1.5)) return true;
      for (const b of bridgeRects) if (x > Math.min(b[0], b[2]) - 3 && x < Math.max(b[0], b[2]) + 3 && z > Math.min(b[1], b[3]) - 3 && z < Math.max(b[1], b[3]) + 3) return true;
      for (const c of colliders) if (inRect(c, x - nx * 0.4, z - nz * 0.4, 0.6)) return true;
      return false;
    };
    for (const [ax, az, bx, bz] of quays) {
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 12) continue;
      const tx = (bx - ax) / L;
      const tz = (bz - az) / L;
      const [nx, nz] = inWater((ax + bx) / 2 - tz, (az + bz) / 2 + tx) ? [-tz, tx] : [tz, -tx];
      const f = frameAt(ax, az, tx, tz, nx, nz);
      let last = -20;
      for (let s = 4; s <= L - 4; s += 2) {
        if (s - last < 40) continue;
        const x = ax + tx * s;
        const z = az + tz * s;
        if (blocked(x, z, nx, nz)) continue;
        steps.addLadder(f, s, 0);
        last = s;
      }
    }
    steps.flush(scene);
  }

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
        pass[j * W + i] = isWalkable(x, z) && !wallNear(x, z, 0.45) && !areaHits(x, z, 0.3) ? 1 : 0;
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
    if (onPontoon(x, z) || onRamp(x, z) || onDeck(x, z)) return "wood";
    return "stone";
  }

  const lampUniforms = psxUniforms.uLamps.value;
  const litGlass = new THREE.Color();

  // time of day: eases toward the target so a jump (after sleep) fades in
  let dayTarget = 8;
  let dayNow = 8;
  let lampsLit = 0;
  let dayFar = 25;
  // weather: near/far multipliers and lamp in-scatter; eased like the clock
  // [fog near x, fog far x, lamp glow in the air]; far x 14 on a clear day is about 420 m
  // (Steve: "even clear weather has too much fog, we should be able to look far")
  // [fog near x, fog far x, lamp glow in the air, clear sky]; far x 14 on a clear day is about 420 m
  const WEATHER = { fog: [1, 1, 1, 0], mist: [2.5, 3.5, 0.6, 0.25], clear: [40, 16, 0.2, 1], rain: [1.8, 2.5, 0.8, 0], storm: [1.3, 1.6, 0.9, 0] } as const;
  /** The air of a clear autumn noon: lighter and bluer than the grey of a fog day. */
  const CLEAR_SKY = new THREE.Color(0x9db0c2);
  /**
   * Fixes 2026-09-24 (shot 4: a clear 16:40-17:00 stayed grey): the golden hour of a clear day.
   * The low sun goes warm and the air gold toward evening, a little at sunrise too; fog, mist and
   * rain days stay grey (it follows the clear-sky weight). 0..1 by the hour.
   */
  const GOLD_AIR = new THREE.Color(0xdca868);
  const SUN_WHITE = new THREE.Color(0xfff0d8);
  const SUN_GOLD = new THREE.Color(0xffa24a);
  const SKY_COLD = new THREE.Color(0x8494a6);
  const SKY_WARM = new THREE.Color(0xb49a7c);
  const SUN_HIGH = new THREE.Vector3(-0.75, 0.9, 0.55);
  const SUN_LOW = new THREE.Vector3(-0.95, 0.38, 0.35);
  const sunDir = new THREE.Vector3();
  function goldenAt(h: number): number {
    const bump = (h: number, a: number, peak0: number, peak1: number, b: number) =>
      h <= a || h >= b ? 0 : h < peak0 ? THREE.MathUtils.smoothstep(h, a, peak0) : h <= peak1 ? 1 : 1 - THREE.MathUtils.smoothstep(h, peak1, b);
    return Math.max(bump(h, 15.1, 16.4, 17.3, 18.3), 0.45 * bump(h, 6.9, 7.6, 8.0, 9.0));
  }
  const baseFog = new THREE.Color();
  let weatherNow: keyof typeof WEATHER = "fog";
  let wTarget: readonly number[] = WEATHER.fog;
  const wNow = [1, 1, 1, 0];
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
    baseFog.copy(fog.color);
    (scene.background as THREE.Color).copy(fog.color);
    skyLight.intensity = THREE.MathUtils.lerp(s0, s1, k);
    sunDay = Math.max(0, (skyLight.intensity - 0.55) / 1.55);
    dayFar = THREE.MathUtils.lerp(f0, f1, k);
    lampsLit = THREE.MathUtils.lerp(l0, l1, k);
  }
  applyDaylight(dayNow);

  // --- M6 tides: the river follows the game clock (world/tide.ts); everything that floats reads it
  let tideClock: (() => { day: number; hour: number }) | null = null;
  let tideSeen = false;
  function tideTarget(): number {
    if (tideDev.hold === "high") return HW_MAX;
    if (tideDev.hold === "low") return LW_MIN;
    if (!tideClock) return tideWater.river;
    const c = tideClock();
    return tideAt(c.day, c.hour);
  }
  function updateTide(dt: number): void {
    const target = tideTarget();
    // a jump of the clock (sleep, the dev menu) or the first clock: the water goes there in a few seconds
    const d = target - tideWater.river;
    tideWater.river += tideSeen ? THREE.MathUtils.clamp(d, -0.6 * dt, 0.6 * dt) : d;
    if (tideClock) tideSeen = true;
    water.position.y = tideWater.river;
    dockSheet.position.y = tideWater.dock;
    dockMouth.position.y = tideWater.dock;
    // the chamber: level, or sloping from the river gates to the dock gates while both pairs stand open
    chamberSheet.position.y = (tideWater.chamberA + tideWater.chamberB) / 2;
    chamberSheet.rotation.x = -Math.PI / 2 - Math.atan((tideWater.chamberB - tideWater.chamberA) / (CHAMBER.maxZ - CHAMBER.minZ));
    // the brig (on the bottom below BRIG_FLOOR), her gangway and lines; the ferry pontoon and its gangway
    DECK.y = Math.max(levelAt(-40, -7.2), BRIG_FLOOR) + DECK_OVER_WATER;
    placeBrigKit();
    pontoonY = levelAt(PONTOON.x, -30) + pontoonDeck;
    const ps = THREE.MathUtils.clamp(pontoonY / PONTOON_PLANK, -0.95, 0.95);
    pontoonReach = PONTOON_PLANK * Math.sqrt(1 - ps * ps);
    if (pontoonPivot) pontoonPivot.rotation.x = Math.asin(ps);
  }

  let camera: THREE.Camera | null = null;
  let devView = false;
  function update(t: number, dt: number, cam?: THREE.Camera): void {
    updateTide(dt);
    // the sea: a storm raises the waves, the boats roll (psx water, waveAt, boats.ts)
    {
      const sea = weatherNow === "storm" ? 3.6 : weatherNow === "rain" ? 1.5 : weatherNow === "clear" ? 1.1 : 0.85;
      psxUniforms.uSea.value += (sea - psxUniforms.uSea.value) * Math.min(1, dt * 0.05);
    }
    boats?.update(t, dt);
    if (cam) camera = cam;
    lock?.update(t, dt, camera ?? undefined);
    bridges?.update(t, dt, camera ?? undefined);
    riverTraffic?.update(t, dt);
    if (camera) traffic?.update(t, dt, camera.position);
    if (camera) railway?.update(t, dt, { x: camera.position.x, z: camera.position.z }, camera);
    if (camera) railGate.update(dt, { x: camera.position.x, z: camera.position.z }, camera);
    if (camera) omnibus?.update(t, dt, { x: camera.position.x, z: camera.position.z }, camera);
    // the sky dome and the water sheet go where you go
    if (camera) {
      sky.position.set(camera.position.x, 0, camera.position.z);
      water.position.x = Math.round(camera.position.x / WATER_TILE) * WATER_TILE;
      water.position.z = Math.round(camera.position.z / WATER_TILE) * WATER_TILE;
      // the mirror lies in the water nearest the eye (the river, the dock or the lock)
      const cx = camera.position.x;
      const cz = camera.position.z;
      const inLock = cx > CHAMBER.minX - 6 && cx < CHAMBER.maxX + 6 && cz > CHAMBER.minZ - 4 && cz < CHAMBER.maxZ;
      const nearDock = cx > DOCK.minX - 25 && cx < DOCK.maxX + 25 && cz > DOCK.minZ - 10 && cz < DOCK.maxZ + 25;
      mirror.setPlane(inLock ? tideWater.chamber : nearDock ? tideWater.dock : tideWater.river);
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
    for (let i = 0; i < 4; i++) wNow[i] += (wTarget[i] - wNow[i]) * Math.min(1, dt * 0.5);
    // a clear day: the air lighter and bluer (by day only)
    fog.color.copy(baseFog).lerp(CLEAR_SKY, wNow[3] * sunDay * 0.6);
    // the golden hour of a clear day: warm air, a low warm sun from the west (fog days stay grey)
    const gold = goldenAt(dayNow) * wNow[3];
    fog.color.lerp(GOLD_AIR, gold * 0.55);
    (scene.background as THREE.Color).copy(fog.color);
    sun.color.copy(SUN_WHITE).lerp(SUN_GOLD, gold);
    skyLight.color.copy(SKY_COLD).lerp(SKY_WARM, gold * 0.55);
    sun.position.copy(sunDir.copy(SUN_HIGH).lerp(SUN_LOW, gold));
    // the sun: nothing at night, a glow through fog, real light on a clear day (warmer and a
    // little stronger in the golden hour: the low light is what shows)
    sun.intensity = sunDay * (1.35 - wNow[2]) * 2.6 * (1 + 0.8 * gold);
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
    if (camera && !devView) ambient.update(t, dt, camera, dayNow, weatherNow);
    street?.update(t, dt, lampsLit, camera ?? undefined);
    quayKit?.update(t, dt, lampsLit, camera ?? undefined);
    litter?.update(t, dt, camera ?? undefined);
    fires?.update(t);
    lantern.intensity = 7 * (0.92 + Math.sin(t * 5.1) * 0.04 + Math.sin(t * 13.7) * 0.03);
    waterTex.offset.x = t * 0.004;
    waterTex.offset.y = t * 0.011;


    gasLamps.update(dt, lampsLit, fog.color);
    for (let i = 0; i < lamps.length; i++) {
      const l = lamps[i];
      const target = flicker(t, l.seed, l.broken) * lampsLit * gasLamps.quay(i);
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
    addWalkArea: (a) => void walkAreas.push(a),
    addMover: (r) => movers.add(r),
    removeMover: (r) => movers.delete(r),
    moverAt,
    onRails: (x, z, r = 0) => railBand.some((c) => inRect(c, x, z, r)),
    isFree,
    solids: () => [...colliders, ...dynamic].filter((c) => blocks(c, 0)),
    // (the fixed list only grows: its length and the count of changes to the others)
    solidsVersion: () => colliders.length + dynamicVersion,
    isWater,
    baseAt,
    reachFrom,
    setThickFog: (on) => (fogTarget = on ? 1 : 0),
    setTimeOfDay: (h) => (dayTarget = ((h % 24) + 24) % 24),
    city,
    setWeather: (w) => {
      weatherNow = w in WEATHER ? w : "fog";
      wTarget = WEATHER[weatherNow];
    },
    ambient,
    streetLife: () => street,
    setPeople: (fn) => (peopleFn = fn),
    setCarts: (fn) => (cartsFn = fn),
    lockSweep: (x, z, r) => !!lock?.inSweep?.(x, z, r),
    bridgeWait: (x, z) => {
      const b = bridges?.list.find((q) => x > q.rect.minX - 0.4 && x < q.rect.maxX + 0.4 && z > q.rect.minZ - 0.4 && z < q.rect.maxZ + 0.4);
      return !!b && b.opening();
    },
    boats: () => boats,
    traffic: () => traffic,
    bridges: () => bridges,
    lock: () => lock,
    railway: () => railway,
    railGate: () => railGate,
    omnibus: () => omnibus,
    devEvents: () => {
      let fog = false;
      let rain = false;
      return [
        { label: "ship into the dock", run: () => lock?.passNow("in") },
        { label: "ship out of the dock", run: () => lock?.passNow("out") },
        { label: "boat up the canal", run: () => bridges?.passNow("canal") },
        { label: "boat up the vliet", run: () => bridges?.passNow("vliet") },
        { label: "thick fog on/off", run: () => { fog = !fog; fogTarget = fog ? 1 : 0; } },
        { label: "rain shower on/off", run: () => { rain = !rain; ambient.setRain(rain ? 1 : 0); } },
      ];
    },
    setDevView: (on) => {
      devView = on;
      if (!on) applyDaylight(dayNow);
    },
    lamps,
    gasLamps,
    shipPositions: [new THREE.Vector3(SHIP_X + 20, 1, -3), new THREE.Vector3(-34, 1, -21)],
    move,
    standFree,
    swimFree,
    swimmable,
    swimMove,
    nearestSwim,
    waterLevel,
    exitNear: (x, z, reach) => steps.exitNear(x, z, reach),
    boatFree,
    addWaterSolid: (r) => waterDynamic.add(r),
    removeWaterSolid: (r) => waterDynamic.delete(r),
    lockWater,
    quayInfo: () => ({ flights: steps.flights, ladders: steps.ladders }),
    surfaceAt,
    update,
    setTideClock: (fn) => (tideClock = fn),
    tideDev: {
      read: () => {
        const f = (y: number) => `${y >= 0 ? "+" : ""}${y.toFixed(2)}`;
        const hm = (h: number) => `${Math.floor(h)}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;
        const c = tideClock?.();
        const hold = tideDev.hold ? ` (held at ${tideDev.hold} water)` : "";
        if (!c) return `river ${f(tideWater.river)} m${hold}`;
        const i = tideInfo(c.day, c.hour);
        return (
          `river ${f(tideWater.river)} m (quay top 0; ${f(i.fromMid)} m from half tide), ${i.rising ? "rising" : "falling"}, range ${i.range.toFixed(2)} m today${hold}. ` +
          `High water day ${i.nextHigh.day} ${hm(i.nextHigh.hour)} (${f(i.nextHigh.y)}), low water day ${i.nextLow.day} ${hm(i.nextLow.hour)} (${f(i.nextLow.y)}). ` +
          `Dock ${f(tideWater.dock)}, lock ${f(tideWater.chamberA)} / ${f(tideWater.chamberB)}.`
        );
      },
      hold: (v) => (tideDev.hold = v),
    },
  };
}

// -------------------------------------------------------------------------

const WATER_RING = (CITY_DATA as unknown as { water: Array<{ outer: number[][] }> }).water.map((w) => w.outer);
/** Inside the river, the docks or a canal (the water polygons of shared/city.json)? */
function inWater(x: number, z: number): boolean {
  let inside = false;
  for (const ring of WATER_RING)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i];
      const [xj, zj] = ring[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
  return inside;
}

/**
 * A timber gangway from the Werf down onto the ferry pontoon's deck (it floats below the quay).
 * M6 tides: a plank of PONTOON_PLANK metres hinged at the quay edge; the returned pivot's rotation.x
 * tilts it (sin = deck height / length), its far end rolling on the pontoon.
 */
function pontoonGangway(scene: THREE.Scene, m: Mats): THREE.Object3D {
  const L = PONTOON_PLANK;
  const w = PONTOON.maxX - PONTOON.minX - 0.5;
  const g = new THREE.Group();
  g.position.set(PONTOON.x, 0, 0);
  // the plank runs out along -z from the hinge
  g.add(box(w, 0.1, L + 0.3, m.planks, 0, -0.02, -L / 2, 1.5));
  // cleats across, for the feet, and a hand rail on each side (posts square to the plank)
  for (let i = 1; i < 11; i++) g.add(box(w - 0.2, 0.05, 0.08, m.darkWood, 0, 0.04, (-L * i) / 11, 1));
  for (const s of [-1, 1]) {
    const x = s * (w / 2 - 0.05);
    g.add(rod(new THREE.Vector3(x, 1.0, 0.2), new THREE.Vector3(x, 1.0, -L), 0.04, m.darkWood));
    for (const k of [0, 0.5, 1]) g.add(box(0.08, 1.0, 0.08, m.darkWood, x, 0.5, -L * k + (k === 0 ? 0.2 : 0), 1));
  }
  scene.add(g);
  return g;
}


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
  const spots: Array<[number, number, number, number]> = []; // x, z, yaw, lift
  for (let i = 0; i < n; i++) {
    const cx = x + (i % 2) * (s + 0.04);
    const cz = z + Math.floor(i / 2) * (s + 0.04);
    spots.push([cx, cz, Math.sin(x * 3 + i) * 0.08, 0]);
    placed++;
  }
  if (n >= 2) spots.push([x + s / 2, z, 0.2, s]);
  // the packing crates of props.glb (all merged into one draw call); plain boxes if it will not load
  loadProps()
    .then((p) => spots.forEach(([cx, cz, yaw, y], i) => p.batch(scene, n === 1 ? "crate_open" : n === 3 && i === 2 ? "crate_broken" : "crate_big", cx, cz, yaw, y, s)))
    .catch(() => {
      for (const [cx, cz, yaw, y] of spots) {
        const c = box(s, s, s, m.crate, cx, y + s / 2, cz, 1.1);
        c.rotation.y = yaw;
        scene.add(c);
      }
    });
  const w = placed > 1 ? s * 2 + 0.04 : s;
  const d = Math.ceil(placed / 2) * (s + 0.04);
  colliders.push({ minX: x - s / 2, maxX: x - s / 2 + w, minZ: z - s / 2, maxZ: z - s / 2 + d, top: n >= 2 ? s * 2 : s });
}

function barrels(scene: THREE.Scene, m: Mats, colliders: Rect[], x: number, z: number, n: number): void {
  const at = (i: number): [number, number] => [x + (i % 3) * 0.75, z + Math.floor(i / 3) * 0.75];
  // the casks of props.glb (merged); plain cylinders if it will not load
  loadProps()
    .then((p) => {
      for (let i = 0; i < n; i++) p.batch(scene, "barrel", ...at(i), i * 1.7);
    })
    .catch(() => {
      for (let i = 0; i < n; i++) {
        const [bx, bz] = at(i);
        scene.add(cyl(0.3, 0.3, 0.95, 8, m.darkWood, bx, 0.475, bz));
        scene.add(cyl(0.335, 0.335, 0.06, 8, m.ironDecal, bx, 0.2, bz));
        scene.add(cyl(0.335, 0.335, 0.06, 8, m.ironDecal, bx, 0.75, bz));
      }
    });
  const cols = Math.min(n, 3);
  const rows = Math.ceil(n / 3);
  colliders.push({ minX: x - 0.35, maxX: x + (cols - 1) * 0.75 + 0.35, minZ: z - 0.35, maxZ: z + (rows - 1) * 0.75 + 0.35, top: 0.95 });
}

function sacks(scene: THREE.Scene, m: Mats, colliders: Rect[], x: number, z: number): void {
  // jute sacks of props.glb, two layers (merged); plain boxes if it will not load
  loadProps()
    .then((p) => {
      for (let i = 0; i < 6; i++) p.batch(scene, "sack", x + (i % 3) * 0.92, z, Math.sin(i * 4.1) * 0.12, Math.floor(i / 3) * 0.25);
    })
    .catch(() => {
      for (let i = 0; i < 6; i++) {
        const s = box(0.9, 0.35, 0.55, m.sack, x + (i % 3) * 0.92, 0.18 + Math.floor(i / 3) * 0.35, z, 0.9);
        s.rotation.y = Math.sin(i * 4.1) * 0.12;
        scene.add(s);
      }
    });
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

