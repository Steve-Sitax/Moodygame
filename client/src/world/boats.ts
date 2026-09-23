import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { psx, psxUniforms } from "../retro/psx";
import { WATER_Y } from "./rijnkaai";
import type { Rect } from "./geom";

// Boats, ships and quay cranes from Blender (tools/blender/build_boats.py ->
// /models/boats.glb). Our own models, made by script. A vessel's origin is the
// middle of its waterline and its bow looks along local +z; a crane stands on
// the quay at its origin with its jib toward local +z at rest. This module loads
// them once, gives them PS1 materials, floats the boats on the water (a gentle
// heave and roll, each on its own beat), swings the cranes now and then, lays
// pontoon walkways and lines quay edges with moored boats.
//
// WATER_Y is only read inside functions: rijnkaai.ts may import this module.

/** Every model in boats.glb. */
export const BOAT_NAMES = [
  "barque",
  "steamer",
  "rhine_barge",
  "hengst",
  "lighter",
  "lighter_loaded",
  "tug",
  "paddle_tug",
  "sloop",
  "barque_sail",
  "brig",
  "schooner",
  "sloop_sail",
  "hengst_sail",
  "rowboat",
  "punt",
  "pontoon_section",
  "portal_crane",
  "hand_crane",
] as const;
export type BoatName = (typeof BOAT_NAMES)[number];
export type CraneKind = "portal_crane" | "hand_crane";

/** Vessels that float (everything but the cranes). */
export const VESSELS: BoatName[] = BOAT_NAMES.filter((n) => n !== "portal_crane" && n !== "hand_crane");

/** A floor you can walk on: a box on the ground plan at height y. */
export interface WalkRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y: number;
}

/** Size of a model in its own frame: length along z (bow to stern, bowsprit included), beam along x. */
export interface Dims {
  length: number;
  beam: number;
  height: number;
}

export interface MooreOptions {
  /** Metres between the quay line and the first row of hulls (fenders). Default 0.4. */
  gap?: number;
  /** Free water between boats in a row, min and max metres. Default [0.8, 4]. */
  spacing?: [number, number];
  /** Leave this much of the line free at each end. Default 2. */
  margin?: number;
  /** Boats moored side by side, rows out from the quay. Default 1. */
  rows?: number;
  /** Skip kinds wider than this (an 8 m canal wants narrow boats). Default no limit. */
  maxBeam?: number;
  /** Same seed, same boats. Default 1873. */
  seed?: number;
  /** Heave and roll on the water. Default true. */
  bob?: boolean;
}

export interface Moored {
  group: THREE.Group;
  placed: Array<{ name: BoatName; x: number; z: number; yaw: number }>;
}

export interface PontoonOptions {
  /** Moor boats along both sides of the walkway. Default true. */
  barges?: boolean;
  /** Kinds to moor alongside. Default rhine_barge, lighter_loaded, hengst, lighter. */
  kinds?: BoatName[];
  /** Leave this much free water next to the quay wall before the first barge. Default 3. */
  start?: number;
  seed?: number;
}

export interface Boats {
  names: BoatName[];
  dims(name: BoatName): Dims;
  /**
   * A copy of a model at (x, z), turned by `yaw` about +y (0 = bow along +z). Vessels float
   * at WATER_Y and bob; cranes stand at y = 0 and keep still (use crane() for one that swings).
   */
  place(name: BoatName, x: number, z: number, yaw: number, parent?: THREE.Object3D): THREE.Object3D;
  /** A crane on the quay at (x, z) whose jib (and cabin) slowly swings now and then. Rest yaw: jib along +z. */
  crane(x: number, z: number, yaw: number, parent?: THREE.Object3D, kind?: CraneKind): THREE.Object3D;
  /** Walk colliders for a crane's legs (portal) or stone base (hand crane) placed at (x, z, yaw). */
  colliders(name: CraneKind, x: number, z: number, yaw: number): Rect[];
  /**
   * A ship's walkable deck placed at (x, z, yaw) (for now the brig, the Anna Maria): the flat
   * waist as a rectangle at world height y (WATER_Y + its deck height), the things on deck in the
   * way (masts, the open hatch, the cabin, casks) as colliders, and where the gangway port is.
   * Exact for yaws that are multiples of 90 degrees. Null for models without a deck.
   */
  deck(name: BoatName, x: number, z: number, yaw: number): { rect: Rect; y: number; obstacles: Rect[]; gangway: { x: number; z: number } } | null;
  /**
   * A floating walkway from the quay edge at z0 straight out to z1 at x, made of 10 m
   * pontoon sections (deck level with the quay), with barges moored along both sides.
   * Returns the walkable deck between the railings.
   */
  pontoon(scene: THREE.Object3D, x: number, z0: number, z1: number, opts?: PontoonOptions): WalkRect[];
  /**
   * Line a quay edge with moored boats: along the line (x0, z0) -> (x1, z1), boats lie on
   * side +1 = toward (-dz, dx) (for a line along +x that is the +z side), -1 = the other
   * side; or give a point in the water. Kinds are picked at random (repeat a name to make it
   * likelier). One InstancedMesh per model part and material: a whole quay costs a few
   * draw calls per kind.
   */
  mooreAlong(
    scene: THREE.Object3D,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    side: 1 | -1 | { x: number; z: number },
    kinds: BoatName[],
    opts?: MooreOptions,
  ): Moored;
  /** Bob the boats, swing the cranes. Call every frame with the game time. */
  update(t: number, dt: number): void;
  /** The PS1 materials by name. */
  materials: Record<string, THREE.Material>;
  /**
   * Every boat under way now (river traffic, tows through the lock, boats on the canal and the
   * vliet): one entry per boat or tow (its leading boat). The same array is refilled on each
   * call, so read it at once; cheap enough for every frame.
   */
  moving(): MovingShip[];
  /** Called when a boat sounds its signal to ask for the lock or an opening bridge. */
  onSignal: ((ship: MovingShip, where: "lock" | "bridge") => void) | null;
}

/** Heave (m), roll and pitch (rad), period (s): small boats move more and faster. */
const MOTION: Record<string, [number, number, number, number]> = {
  barque: [0.03, 0.006, 0.002, 8.5],
  steamer: [0.03, 0.005, 0.002, 8.0],
  rhine_barge: [0.025, 0.006, 0.002, 7.0],
  hengst: [0.03, 0.01, 0.004, 6.0],
  lighter: [0.03, 0.012, 0.005, 5.5],
  lighter_loaded: [0.025, 0.009, 0.004, 6.0],
  tug: [0.035, 0.015, 0.006, 4.5],
  paddle_tug: [0.035, 0.014, 0.006, 4.6],
  sloop: [0.04, 0.02, 0.008, 4.0],
  barque_sail: [0.03, 0.01, 0.004, 8.0],
  brig: [0.02, 0.004, 0.0015, 9.0],
  schooner: [0.04, 0.02, 0.008, 5.5],
  sloop_sail: [0.05, 0.03, 0.012, 4.0],
  hengst_sail: [0.04, 0.02, 0.008, 5.0],
  rowboat: [0.05, 0.035, 0.015, 3.0],
  punt: [0.045, 0.03, 0.012, 3.2],
  pontoon_section: [0.008, 0.002, 0.001, 7.0],
};

const DOUBLE = new Set(["shrouds", "lattice", "flag", "canvas", "canvas_tan", "tarp", "washing"]);
const JIB_NODES = ["jib", "hand_crane_jib"];

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A steady list to leeward under sail (the sails belly toward +x, so +x goes down). */
const HEEL: Record<string, number> = { barque_sail: -0.05, schooner: -0.07, sloop_sail: -0.09, hengst_sail: -0.06 };

interface Float {
  heel: number;
  inner: THREE.Object3D;
  m: [number, number, number, number];
  p: [number, number, number];
}

interface Swing {
  jib: THREE.Object3D;
  cur: number;
  target: number;
  wait: number;
  range: number;
  speed: number;
  r: () => number;
}

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix: THREE.Matrix4;
}

interface Fleet {
  meshes: THREE.InstancedMesh[];
  /** Rigging drawn once per boat: one instanced line set; matrices in four vec4 attributes. */
  lines: THREE.LineSegments | null;
  parts: Part[];
  boats: Array<{
    x: number;
    z: number;
    yaw: number;
    m: [number, number, number, number];
    p: [number, number, number];
    world: THREE.Matrix4;
  }>;
}

/** A small soft puff of coal smoke, 16 px, nearest filter: PS1 smoke. */
function puffTexture(): THREE.DataTexture {
  const n = 16;
  const d = new Uint8Array(n * n * 4);
  const r = rng(11);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5 - n / 2) / (n / 2);
      const dy = (y + 0.5 - n / 2) / (n / 2);
      const k = Math.max(0, 1 - Math.hypot(dx, dy));
      const i = (y * n + x) * 4;
      const v = 150 + Math.floor(r() * 60);
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = Math.floor(255 * Math.min(1, k * 1.6) * (0.75 + r() * 0.25));
    }
  const t = new THREE.DataTexture(d, n, n, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * Rope, chain and hawser lines: a plain line with the same PS1 fog as the hulls (psx: the gas
 * lamps' glow in the air included), so it takes exactly the colour of the misty air; and it is
 * lost in the fog by 60% of the fog distance, before the hull, so far rigging never draws dark
 * on the sky. `instanced`: for line sets drawn once per boat with the matrix in attributes i0..i3.
 */
/**
 * The water cap: every hull made by build_boats.py carries an invisible lid over its rail (a
 * child mesh named "<model>_cap"). Drawn after the hulls and before the water, it marks its
 * pixels in the stencil (1); the water (see waterStencil) is not drawn there, so it never shows
 * inside an open boat, a hold or over a low deck in a swell. From outside, the hull's sides hide
 * the lid, so the water still covers the hull below the waterline.
 */
export const capMaterial = psx(
  new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    stencilWrite: true,
    stencilRef: 1,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilZPass: THREE.ReplaceStencilOp,
  }),
);
capMaterial.name = "cap";

/** Make a water material skip the pixels the hull caps marked (and draw the water after them: renderOrder 2). */
export function waterStencil(mat: THREE.Material): void {
  mat.stencilWrite = true; // enables the stencil test; the mask keeps the water from writing it
  mat.stencilWriteMask = 0;
  mat.stencilRef = 1;
  mat.stencilFunc = THREE.NotEqualStencilFunc;
  mat.stencilFuncMask = 0xff;
}

export function ropeMaterial(color = 0x16130f, instanced = false): THREE.Material {
  const mat = psx(new THREE.LineBasicMaterial({ color, fog: true }), { fogReach: 0.6 });
  if (instanced) {
    const base = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, renderer) => {
      base.call(mat, shader, renderer);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec4 i0;\nattribute vec4 i1;\nattribute vec4 i2;\nattribute vec4 i3;")
        .replace("#include <begin_vertex>", "vec3 transformed = (mat4(i0, i1, i2, i3) * vec4(position, 1.0)).xyz;");
    };
    const key = mat.customProgramCacheKey.bind(mat);
    mat.customProgramCacheKey = () => `${key()}-inst`;
  }
  mat.name = instanced ? "rope_instanced" : "rope";
  return mat;
}

/** A boat under way, for sound and the like. */
export interface MovingShip {
  /** Stable while this passage lasts. */
  id: number;
  /** The leading boat (the tug of a tow). */
  kind: BoatName;
  x: number;
  z: number;
  /** Heading about +y: 0 = toward +z, as a yaw. */
  heading: number;
  /** Metres a second. */
  speed: number;
  /** Has a funnel and a steam whistle: steamer, paddle steamer, tug, paddle tug. */
  steam: boolean;
}

const STEAM = new Set<BoatName>(["steamer", "paddle_tug", "tug"]);
export const isSteam = (k: BoatName): boolean => STEAM.has(k);
const movingSources = new Set<(out: MovingShip[]) => void>();
const movingOut: MovingShip[] = [];
let signalHandler: ((ship: MovingShip, where: "lock" | "bridge") => void) | null = null;
let nextShipId = 1;

/** A new id for a boat setting out (world/river.ts, lock.ts, bridges.ts). */
export function newShipId(): number {
  return nextShipId++;
}

/** Register something that moves boats: it pushes its boats under way into `out`. Returns a remover. */
export function addMovingSource(fn: (out: MovingShip[]) => void): () => void {
  movingSources.add(fn);
  return () => movingSources.delete(fn);
}

/** A boat sounds its signal for the lock or a bridge (goes to Boats.onSignal). */
export function signal(ship: MovingShip, where: "lock" | "bridge"): void {
  signalHandler?.(ship, where);
}

let loading: Promise<Boats> | null = null;

/** Load boats.glb once; later calls get the same promise. */
export function loadBoats(): Promise<Boats> {
  if (!loading) loading = load();
  return loading;
}

export interface ModelSet {
  /** Each model merged into a solid and a thin mesh (plus its rigging lines), by node name. */
  protos: Map<string, THREE.Object3D>;
  /** The glTF extras of each model's node (rig, smoke, deck sizes...). */
  extras: Map<string, Record<string, unknown>>;
  materials: Record<string, THREE.Material>;
}

/**
 * Load a model file made by our Blender scripts (boats.glb, bridges.glb): every material's
 * picture goes into one texture atlas, and each model is merged into two meshes, solid and
 * thin (double-sided, cut-out), so a model costs two draw calls, three with its rigging lines.
 */
export async function loadModelSet(url: string): Promise<ModelSet> {
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync(url);
  draco.dispose();

  // One texture atlas for the whole file: every material's picture in a 128 px cell. Each
  // model (and a crane's turning jib) is merged into two meshes, solid and thin (double-sided,
  // cut-out), so a ship costs two draw calls, three with its rigging lines.
  const CELL = 128;
  const srcMats = new Map<string, THREE.MeshStandardMaterial>();
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mt of Array.isArray(m.material) ? m.material : [m.material]) {
      if (!srcMats.has(mt.name)) srcMats.set(mt.name, mt as THREE.MeshStandardMaterial);
    }
  });
  const matNames = [...srcMats.keys()].filter((n) => n !== "cap");
  const N = Math.max(1, Math.ceil(Math.sqrt(matNames.length)));
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = N * CELL;
  const g2 = canvas.getContext("2d")!;
  g2.imageSmoothingEnabled = false;
  const cellOf = new Map<string, [number, number]>();
  matNames.forEach((name, i) => {
    const c = i % N;
    const r = Math.floor(i / N);
    cellOf.set(name, [c, r]);
    const img = srcMats.get(name)!.map?.image as CanvasImageSource | undefined;
    if (img) g2.drawImage(img, c * CELL, r * CELL, CELL, CELL);
    else {
      g2.fillStyle = "#555";
      g2.fillRect(c * CELL, r * CELL, CELL, CELL);
    }
  });
  const atlas = new THREE.CanvasTexture(canvas);
  atlas.flipY = false; // glTF uv: v = 0 at the top of each picture, as in the canvas
  atlas.magFilter = THREE.NearestFilter;
  atlas.minFilter = THREE.NearestFilter;
  atlas.generateMipmaps = false;
  atlas.colorSpace = THREE.SRGBColorSpace;
  for (const m of srcMats.values()) {
    m.map?.dispose();
    m.dispose();
  }
  const solidMat = psx(new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true }), { affine: 0.6, atlas: N });
  const thinMat = psx(
    new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5 }),
    { affine: 0.6, atlas: N },
  );
  solidMat.name = "boats_solid";
  thinMat.name = "boats_thin";
  const lineMat = ropeMaterial();
  lineMat.name = "boats_rigging";
  const materials: Record<string, THREE.Material> = { solid: solidMat, thin: thinMat, rigging: lineMat };

  /** Merge a node's own meshes (not those of a child jib) into a solid and a thin mesh. */
  function atlasify(node: THREE.Object3D): void {
    node.updateMatrixWorld(true);
    const inv = node.matrixWorld.clone().invert();
    const meshes: THREE.Mesh[] = [];
    const visit = (o: THREE.Object3D) => {
      if (o !== node && JIB_NODES.includes(o.name)) return;
      const om = o as THREE.Mesh;
      if (om.isMesh && (om.material as THREE.Material).name === "cap") {
        // the hull's water cap stays its own mesh: drawn after the hulls, into the stencil
        om.material = capMaterial;
        om.renderOrder = 1;
        return;
      }
      if (om.isMesh) meshes.push(om);
      for (const c of o.children) visit(c);
    };
    visit(node);
    const solid: THREE.BufferGeometry[] = [];
    const thin: THREE.BufferGeometry[] = [];
    const rel = new THREE.Matrix4();
    for (const m of meshes) {
      const name = (m.material as THREE.Material).name;
      let g = m.geometry.clone();
      g.applyMatrix4(rel.multiplyMatrices(inv, m.matrixWorld));
      for (const a of Object.keys(g.attributes)) if (!["position", "normal", "uv", "color"].includes(a)) g.deleteAttribute(a);
      if (g.index) g = g.toNonIndexed();
      const n = g.getAttribute("position").count;
      if (!g.getAttribute("color")) g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
      if (!g.getAttribute("uv")) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
      const [c, r] = cellOf.get(name) ?? [0, 0];
      const cell = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        cell[i * 2] = c;
        cell[i * 2 + 1] = r;
      }
      g.setAttribute("cell", new THREE.Float32BufferAttribute(cell, 2));
      (DOUBLE.has(name) ? thin : solid).push(g);
      m.geometry.dispose();
    }
    const holder = node as THREE.Mesh;
    for (const m of meshes) if (m !== holder) m.removeFromParent();
    const add = (geos: THREE.BufferGeometry[], mat: THREE.Material, tag: string) => {
      if (!geos.length) return;
      const merged = mergeGeometries(geos, false) ?? geos[0];
      merged.computeBoundingSphere();
      if (holder.isMesh && holder.material !== solidMat && holder.material !== thinMat) {
        holder.geometry = merged;
        holder.material = mat;
      } else {
        const mesh = new THREE.Mesh(merged, mat);
        mesh.name = `${node.name}_${tag}`;
        node.add(mesh);
      }
    };
    add(solid, solidMat, "solid");
    add(thin, thinMat, "thin");
    // rigging: line segments in the node's frame (Blender x, y, z -> x, z, -y)
    const rig = node.userData.rig as string | undefined;
    if (rig) {
      const f = JSON.parse(rig) as number[];
      const pos = new Float32Array(f.length);
      for (let i = 0; i < f.length; i += 3) {
        pos[i] = f[i];
        pos[i + 1] = f[i + 2];
        pos[i + 2] = -f[i + 1];
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      lg.computeBoundingSphere();
      const lines = new THREE.LineSegments(lg, lineMat);
      lines.name = `${node.name}_rigging`;
      node.add(lines);
    }
  }

  const protos = new Map<string, THREE.Object3D>();
  const extras = new Map<string, Record<string, unknown>>();
  for (const node of [...gltf.scene.children]) {
    node.removeFromParent();
    node.position.set(0, 0, 0);
    node.rotation.set(0, 0, 0);
    node.updateMatrixWorld(true);
    atlasify(node);
    node.traverse((o) => {
      if (o !== node && JIB_NODES.includes(o.name)) atlasify(o);
    });
    node.updateMatrixWorld(true);
    protos.set(node.name, node);
    extras.set(node.name, node.userData ?? {});
  }
  return { protos, extras, materials };
}

async function load(): Promise<Boats> {
  const set = await loadModelSet("/models/boats.glb");
  const protos = set.protos as Map<BoatName, THREE.Object3D>;
  const extras = set.extras as Map<BoatName, Record<string, unknown>>;
  const materials = set.materials;
  const proto = (name: BoatName): THREE.Object3D => {
    const p = protos.get(name);
    if (!p) throw new Error(`no boat ${name}`);
    return p;
  };

  const dimCache = new Map<BoatName, Dims>();
  function dims(name: BoatName): Dims {
    let d = dimCache.get(name);
    if (!d) {
      // the hull's footprint: parts below 2.4 m (yards, bowsprits and booms up high do not count)
      const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
      const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
      let top = 0;
      const v = new THREE.Vector3();
      const root = proto(name);
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const pos = m.geometry.getAttribute("position");
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          top = Math.max(top, v.y);
          if (v.y > 2.4) continue;
          lo.min(v);
          hi.max(v);
        }
      });
      d = { length: hi.z - lo.z, beam: hi.x - lo.x, height: top };
      dimCache.set(name, d);
    }
    return d;
  }

  // parts of a model for instancing: geometry, material and matrix relative to the model root
  const partCache = new Map<BoatName, Part[]>();
  function parts(name: BoatName): Part[] {
    let ps = partCache.get(name);
    if (ps) return ps;
    ps = [];
    const root = proto(name);
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      ps!.push({ geometry: m.geometry, material: m.material as THREE.Material, matrix: m.matrixWorld.clone() });
    });
    partCache.set(name, ps);
    return ps;
  }

  /** The rigging lines of a model's root node (for instanced fleets), or null. */
  function rigLines(name: BoatName): THREE.BufferAttribute | null {
    const root = proto(name);
    const l = root.children.find((c) => (c as THREE.LineSegments).isLineSegments) as THREE.LineSegments | undefined;
    return l ? (l.geometry.getAttribute("position") as THREE.BufferAttribute) : null;
  }

  /** Funnel tops of a model in its own frame (game axes). */
  function smokePoints(name: BoatName): THREE.Vector3[] {
    const raw = extras.get(name)?.smoke as string | undefined;
    if (!raw) return [];
    const f = JSON.parse(raw) as number[];
    const out: THREE.Vector3[] = [];
    for (let i = 0; i + 2 < f.length; i += 3) out.push(new THREE.Vector3(f[i], f[i + 2], -f[i + 1]));
    return out;
  }

  // ---- smoke from the funnels: one Points object, a few puffs per funnel
  const PUFFS = 9;
  const LIFE = 8;
  const emitters: Array<{ at: (out: THREE.Vector3) => void; strength: number; phase: number; root: () => THREE.Object3D | null }> = [];
  let smoke: THREE.Points | null = null;
  const smokeMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { map: { value: puffTexture() }, color: { value: new THREE.Color(0x4a4744) }, scale: { value: 150 } },
    ]),
    vertexShader: /* glsl */ `
      attribute float size;
      attribute float alpha;
      uniform float scale;
      varying float vAlpha;
      #include <fog_pars_vertex>
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = size * scale / max(0.5, -mvPosition.z);
        vAlpha = alpha;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 color;
      varying float vAlpha;
      #include <fog_pars_fragment>
      void main() {
        vec4 t = texture2D(map, gl_PointCoord);
        float a = t.a * vAlpha;
        if (a < 0.03) discard;
        gl_FragColor = vec4(color * t.rgb, a);
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  function growSmoke(): void {
    const n = emitters.length * PUFFS;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("size", new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array(n), 1));
    if (!smoke) {
      smoke = new THREE.Points(g, smokeMat);
      smoke.name = "funnel_smoke";
      smoke.frustumCulled = false;
      smoke.renderOrder = 2;
      const sz = new THREE.Vector2();
      smoke.onBeforeRender = (renderer, _scene, camera) => {
        const rt = renderer.getRenderTarget();
        const h = rt ? rt.height : renderer.getDrawingBufferSize(sz).y;
        smokeMat.uniforms.scale.value = (h / 2) * camera.projectionMatrix.elements[5];
      };
    } else {
      smoke.geometry.dispose();
      smoke.geometry = g;
    }
  }
  function addEmitter(e: (typeof emitters)[number]): void {
    emitters.push(e);
    growSmoke();
  }
  const wind = new THREE.Vector3(0.75, 0, 0.3);
  const ep = new THREE.Vector3();
  function updateSmoke(t: number): void {
    if (!smoke || !emitters.length) return;
    if (!smoke.parent) {
      const r = emitters[0].root();
      if (r) r.add(smoke);
    }
    const pos = smoke.geometry.getAttribute("position") as THREE.BufferAttribute;
    const size = smoke.geometry.getAttribute("size") as THREE.BufferAttribute;
    const alpha = smoke.geometry.getAttribute("alpha") as THREE.BufferAttribute;
    for (let e = 0; e < emitters.length; e++) {
      const em = emitters[e];
      em.at(ep);
      for (let k = 0; k < PUFFS; k++) {
        const f = (t / LIFE + k / PUFFS + em.phase) % 1;
        const age = f * LIFE;
        const i = e * PUFFS + k;
        const wob = Math.sin(age * 1.7 + k * 2.1 + em.phase * 9) * 0.25;
        pos.setXYZ(i, ep.x + wind.x * age + wob, ep.y + age * 0.9 - age * age * 0.03, ep.z + wind.z * age - wob);
        size.setX(i, 1.0 + age * 0.75);
        alpha.setX(i, em.strength * Math.pow(1 - f, 1.4) * Math.min(1, age * 2.5));
      }
    }
    pos.needsUpdate = size.needsUpdate = alpha.needsUpdate = true;
  }
  const rootOf = (o: THREE.Object3D): THREE.Object3D | null => {
    let r = o;
    while (r.parent) r = r.parent;
    return r === o && !o.parent ? null : r;
  };

  const floats: Float[] = [];
  const swings: Swing[] = [];
  const fleets: Fleet[] = [];
  const motionRand = rng(7);
  const phases = (): [number, number, number] => [
    motionRand() * Math.PI * 2,
    motionRand() * Math.PI * 2,
    motionRand() * Math.PI * 2,
  ];

  function isCrane(name: BoatName): name is CraneKind {
    return name === "portal_crane" || name === "hand_crane";
  }

  function place(name: BoatName, x: number, z: number, yaw: number, parent?: THREE.Object3D): THREE.Object3D {
    const inner = proto(name).clone();
    if (isCrane(name)) {
      inner.name = name;
      inner.position.set(x, 0, z);
      inner.rotation.y = yaw;
      parent?.add(inner);
      return inner;
    }
    const outer = new THREE.Group();
    outer.name = name;
    outer.position.set(x, WATER_Y, z);
    outer.rotation.y = yaw;
    outer.add(inner);
    floats.push({ inner, m: MOTION[name] ?? MOTION.lighter, p: phases(), heel: HEEL[name] ?? 0 });
    for (const sp of smokePoints(name)) {
      const local = sp.clone();
      addEmitter({ at: (out) => void out.copy(local).applyMatrix4(inner.matrixWorld), strength: 0.55, phase: motionRand(), root: () => rootOf(outer) });
    }
    parent?.add(outer);
    return outer;
  }

  function crane(x: number, z: number, yaw: number, parent?: THREE.Object3D, kind: CraneKind = "portal_crane"): THREE.Object3D {
    const o = place(kind, x, z, yaw, parent);
    let jib: THREE.Object3D | undefined;
    o.traverse((c) => {
      if (!jib && JIB_NODES.includes(c.name)) jib = c;
    });
    if (jib) {
      const r = rng(Math.floor((x * 73856093) ^ (z * 19349663)) >>> 0);
      swings.push({
        jib,
        cur: 0,
        target: 0,
        wait: 2 + r() * 8,
        range: kind === "portal_crane" ? 1.3 : 1.0,
        speed: kind === "portal_crane" ? 0.16 : 0.24,
        r,
      });
    }
    return o;
  }

  /** Local boxes [cx, cz, halfX, halfZ] that block walking, in the crane's own frame. */
  const CRANE_FEET: Record<CraneKind, Array<[number, number, number, number]>> = {
    portal_crane: [
      [2.2, 2.6, 0.75, 0.3],
      [-2.2, 2.6, 0.75, 0.3],
      [2.2, -2.6, 0.75, 0.3],
      [-2.2, -2.6, 0.75, 0.3],
    ],
    hand_crane: [[0, 0, 0.95, 0.95]],
  };

  function colliders(name: CraneKind, x: number, z: number, yaw: number): Rect[] {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return (CRANE_FEET[name] ?? []).map(([lx, lz, hx, hz]) => {
      const wx = x + lx * c + lz * s;
      const wz = z - lx * s + lz * c;
      const ex = hx * Math.abs(c) + hz * Math.abs(s);
      const ez = hx * Math.abs(s) + hz * Math.abs(c);
      return { minX: wx - ex, maxX: wx + ex, minZ: wz - ez, maxZ: wz + ez };
    });
  }

  /** Pack boats along a line: centres, yaws. Line direction (tx, tz), water side (nx, nz). */
  function pack(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    nx: number,
    nz: number,
    kinds: BoatName[],
    o: Required<Omit<MooreOptions, "bob">>,
  ): Array<{ name: BoatName; x: number; z: number; yaw: number }> {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const out: Array<{ name: BoatName; x: number; z: number; yaw: number }> = [];
    if (L < 1) return out;
    const tx = (x1 - x0) / L;
    const tz = (z1 - z0) / L;
    const r = rng(o.seed);
    const pool = kinds.filter((k) => !isCrane(k) && k !== "pontoon_section" && dims(k).beam <= o.maxBeam);
    if (!pool.length) return out;
    let off = o.gap;
    for (let row = 0; row < o.rows; row++) {
      let s = o.margin + r() * o.spacing[1] * (row > 0 ? 2 : 0.5);
      let widest = 0;
      for (let tries = 0; tries < 400 && s < L - o.margin; tries++) {
        const name = pool[Math.floor(r() * pool.length)];
        const d = dims(name);
        if (s + d.length > L - o.margin) {
          // nothing long fits in what is left: try a shorter kind a few times, then stop
          if (pool.every((k) => s + dims(k).length > L - o.margin)) break;
          continue;
        }
        // outer rows are thinner: some gaps are left open
        if (row > 0 && r() < 0.35) {
          s += d.length * 0.6;
          continue;
        }
        const along = s + d.length / 2;
        const across = off + d.beam / 2;
        const flip = r() < 0.5 ? 0 : Math.PI;
        out.push({
          name,
          x: x0 + tx * along + nx * across,
          z: z0 + tz * along + nz * across,
          yaw: Math.atan2(tx, tz) + flip,
        });
        widest = Math.max(widest, d.beam);
        s += d.length + o.spacing[0] + r() * (o.spacing[1] - o.spacing[0]);
      }
      if (!widest) break;
      off += widest + 0.3;
    }
    return out;
  }

  function sideNormal(x0: number, z0: number, x1: number, z1: number, side: 1 | -1 | { x: number; z: number }): [number, number] {
    const L = Math.hypot(x1 - x0, z1 - z0) || 1;
    let nx = -(z1 - z0) / L;
    let nz = (x1 - x0) / L;
    const sgn = typeof side === "number" ? side : Math.sign((side.x - x0) * nx + (side.z - z0) * nz) || 1;
    nx *= sgn;
    nz *= sgn;
    return [nx, nz];
  }

  const tmpM = new THREE.Matrix4();
  const instancedLineMat = ropeMaterial(0x16130f, true);
  const tmpQ = new THREE.Quaternion();
  const tmpE = new THREE.Euler(0, 0, 0, "YXZ");
  const tmpP = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const _m = new THREE.Matrix4();

  function writeFleet(f: Fleet, t: number): void {
    for (let i = 0; i < f.boats.length; i++) {
      const b = f.boats[i];
      const sea = psxUniforms.uSea.value;
      const [h0, roll0, pitch0, period] = b.m;
      const h = h0 * sea;
      const roll = roll0 * Math.min(sea, 2.5);
      const pitch = pitch0 * Math.min(sea, 2.5);
      const w = (Math.PI * 2) / period;
      tmpP.set(b.x, WATER_Y + h * Math.sin(w * t + b.p[0]) + h * 0.4 * Math.sin(2.3 * w * t + b.p[0] * 1.7), b.z);
      tmpE.set(pitch * Math.sin(1.13 * w * t + b.p[2]), b.yaw, roll * Math.sin(0.83 * w * t + b.p[1]));
      tmpQ.setFromEuler(tmpE);
      tmpM.compose(tmpP, tmpQ, one);
      for (let k = 0; k < f.meshes.length; k++) {
        f.meshes[k].setMatrixAt(i, _m.multiplyMatrices(tmpM, f.parts[k].matrix));
      }
      if (f.lines) {
        const e = tmpM.elements;
        for (let c = 0; c < 4; c++) {
          const a = f.lines.geometry.getAttribute(`i${c}`) as THREE.InstancedBufferAttribute;
          a.setXYZW(i, e[c * 4], e[c * 4 + 1], e[c * 4 + 2], e[c * 4 + 3]);
        }
      }
      b.world.copy(tmpM);
    }
    for (const m of f.meshes) m.instanceMatrix.needsUpdate = true;
    if (f.lines) for (let c = 0; c < 4; c++) f.lines.geometry.getAttribute(`i${c}`).needsUpdate = true;
  }

  function mooreAlong(
    scene: THREE.Object3D,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    side: 1 | -1 | { x: number; z: number },
    kinds: BoatName[],
    opts: MooreOptions = {},
  ): Moored {
    const [nx, nz] = sideNormal(x0, z0, x1, z1, side);
    const o = {
      gap: opts.gap ?? 0.4,
      spacing: opts.spacing ?? ([0.8, 4] as [number, number]),
      margin: opts.margin ?? 2,
      rows: opts.rows ?? 1,
      maxBeam: opts.maxBeam ?? Infinity,
      seed: opts.seed ?? 1873,
    };
    const placed = pack(x0, z0, x1, z1, nx, nz, kinds, o);
    const group = new THREE.Group();
    group.name = "moored";
    const byKind = new Map<BoatName, typeof placed>();
    for (const p of placed) {
      let l = byKind.get(p.name);
      if (!l) byKind.set(p.name, (l = []));
      l.push(p);
    }
    const r = rng(o.seed ^ 0x5bd1e995);
    for (const [name, list] of byKind) {
      const ps = parts(name);
      const fleet: Fleet = {
        meshes: [],
        lines: null,
        parts: ps,
        boats: list.map((b) => ({
          x: b.x,
          z: b.z,
          yaw: b.yaw,
          m: MOTION[name] ?? MOTION.lighter,
          p: [r() * 6.283, r() * 6.283, r() * 6.283] as [number, number, number],
          world: new THREE.Matrix4(),
        })),
      };
      for (const part of ps) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        if (part.material === capMaterial) im.renderOrder = 1;
        im.name = `${name}_moored`;
        fleet.meshes.push(im);
        group.add(im);
      }
      const rl = rigLines(name);
      if (rl) {
        const ig = new THREE.InstancedBufferGeometry();
        ig.setAttribute("position", rl);
        for (let c = 0; c < 4; c++) ig.setAttribute(`i${c}`, new THREE.InstancedBufferAttribute(new Float32Array(list.length * 4), 4));
        ig.instanceCount = list.length;
        const ls = new THREE.LineSegments(ig, instancedLineMat);
        ls.frustumCulled = false;
        ls.name = `${name}_moored_rigging`;
        fleet.lines = ls;
        group.add(ls);
      }
      fleet.boats.forEach((b, i) => {
        for (const sp of smokePoints(name)) {
          const local = sp.clone();
          addEmitter({ at: (out) => void out.copy(local).applyMatrix4(b.world), strength: 0.3, phase: (i * 0.37) % 1, root: () => rootOf(group) });
        }
      });
      writeFleet(fleet, 0);
      for (const im of fleet.meshes) im.computeBoundingSphere();
      if (opts.bob ?? true) fleets.push(fleet);
    }
    scene.add(group);
    return { group, placed };
  }

  function pontoon(scene: THREE.Object3D, x: number, z0: number, z1: number, opts: PontoonOptions = {}): WalkRect[] {
    const ex = extras.get("pontoon_section") ?? {};
    const deckTop = typeof ex.deck_top === "number" ? ex.deck_top : 1.8;
    const half = typeof ex.half_width === "number" ? ex.half_width : 2.05;
    const len = typeof ex.length === "number" ? ex.length : 10;
    const dir = z1 >= z0 ? 1 : -1;
    const n = Math.max(1, Math.ceil(Math.abs(z1 - z0) / len - 0.05));
    for (let i = 0; i < n; i++) place("pontoon_section", x, z0 + dir * (i + 0.5) * len, 0, scene);
    const zEnd = z0 + dir * n * len;
    if (opts.barges ?? true) {
      const kinds = opts.kinds ?? ["rhine_barge", "lighter_loaded", "hengst", "lighter"];
      const start = opts.start ?? 3;
      const outer = 2.45;
      const seed = opts.seed ?? 1880;
      for (const sx of [1, -1]) {
        const list = pack(x + sx * outer, z0 + dir * start, x + sx * outer, zEnd, sx, 0, kinds, {
          gap: 0.3,
          spacing: [0.6, 2.5],
          margin: 0,
          rows: 1,
          maxBeam: Infinity,
          seed: seed + (sx > 0 ? 0 : 99),
        });
        for (const b of list) place(b.name, b.x, b.z, b.yaw, scene);
      }
    }
    return [{ minX: x - half, maxX: x + half, minZ: Math.min(z0, zEnd), maxZ: Math.max(z0, zEnd), y: WATER_Y + deckTop }];
  }

  function update(t: number, dt: number): void {
    const sea = psxUniforms.uSea.value;
    for (const f of floats) {
      const [h0, roll0, pitch0, period] = f.m;
      const h = h0 * sea;
      const roll = roll0 * Math.min(sea, 2.5);
      const pitch = pitch0 * Math.min(sea, 2.5);
      const w = (Math.PI * 2) / period;
      f.inner.position.y = h * Math.sin(w * t + f.p[0]) + h * 0.4 * Math.sin(2.3 * w * t + f.p[0] * 1.7);
      f.inner.rotation.z = f.heel + roll * Math.sin(0.83 * w * t + f.p[1]);
      f.inner.rotation.x = pitch * Math.sin(1.13 * w * t + f.p[2]);
    }
    for (const f of fleets) writeFleet(f, t);
    updateSmoke(t);
    for (const s of swings) {
      if (s.wait > 0) {
        s.wait -= dt;
        continue;
      }
      const d = s.target - s.cur;
      if (Math.abs(d) < 0.002) {
        s.cur = s.target;
        s.wait = 6 + s.r() * 16;
        s.target = (s.r() * 2 - 1) * s.range;
        continue;
      }
      // ease in and out: slow near the ends of the swing
      const ease = THREE.MathUtils.clamp(Math.abs(d) / 0.35, 0.2, 1);
      s.cur += Math.sign(d) * Math.min(Math.abs(d), s.speed * ease * dt);
      s.jib.rotation.y = s.cur;
    }
  }

  return {
    names: [...protos.keys()],
    dims,
    place,
    crane,
    colliders,
    deck(name, x, z, yaw) {
      const raw = extras.get(name)?.deck as string | undefined;
      if (!raw) return null;
      const d = JSON.parse(raw) as { y: number; rect: number[]; obstacles: number[][]; gangway: number[] };
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      // Blender (bx, by) is the model's own (x, -z); then turned by yaw and moved to (x, z)
      const at = (bx: number, by: number): [number, number] => [x + bx * c - by * s, z - bx * s - by * c];
      const box = (r: number[]): Rect => {
        const [ax, az] = at(r[0], r[2]);
        const [bx, bz] = at(r[1], r[3]);
        return { minX: Math.min(ax, bx), maxX: Math.max(ax, bx), minZ: Math.min(az, bz), maxZ: Math.max(az, bz) };
      };
      const [gx, gz] = at(d.gangway[0], d.gangway[1]);
      return { rect: box(d.rect), y: WATER_Y + d.y, obstacles: d.obstacles.map(box), gangway: { x: gx, z: gz } };
    },
    pontoon,
    mooreAlong,
    update,
    materials,
    moving() {
      movingOut.length = 0;
      for (const src of movingSources) src(movingOut);
      return movingOut;
    },
    get onSignal() {
      return signalHandler;
    },
    set onSignal(fn) {
      signalHandler = fn;
    },
  };
}
