import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { psx } from "../retro/psx";
import { levelAt, water } from "./tide";
import { addMovingSource, isSteam, loadBoats, loadModelSet, newShipId, ropeMaterial, signal, VESSELS, type BoatName, type Boats, type MovingShip } from "./boats";
import { createDrawBridge, type DrawBridge } from "./bridges";
import type { Rect } from "./geom";
import { chamberSpan, lockFit, trainOffsets, TOW_LINE, type LockFit } from "../../../shared/lockfit";

// The lock of the Petit Bassin (Bonapartedok), as in 1873: a lifting bridge over the lock
// (it was a swing bridge; a lifting bridge clears the quays and carries the railway), and two pairs of wooden mitre gates ("puntdeuren") that
// point toward the dock. Now and then a tug tows a lighter or a barge from the river
// through the lock into the dock, or back out; the bridge swings open and the gates open
// for it, and close after. Models: tools/blender/build_lock.py -> /models/lock.glb.
//
// The player may walk on the bridge only while bridgeClosed(). The bridge will not start
// to open while opts.occupied() says someone stands on it; the tow waits.
//
// M6 tides (world/tide.ts): the river rises and falls some 4.3 m; the dock stays near high water.
// The chamber between the gates now matters. A boat is locked through: the keeper shuts the far
// pair, lets the water in or out through the sluices till the chamber stands at the boat's level,
// opens the near pair; once the boat is in, the other way round. When river and dock stand level
// (round high water) he opens both pairs and it goes straight through.
//
// Steve 2026-09-24 ("Do not send bigger boats or combinations through a lock, so they never need to
// wait until high tide"): the traffic sends only a vessel or tow that fits the chamber with room to
// spare (shared/lockfit.ts): a tug running light, a sailing hengst or sloop. The old tows (a tug with
// a lighter or a Rhine barge on its line, 45 m and more) never fit the 35 m chamber and waited off the
// gates for high water; they no longer come. A boat asks for the lock early enough that the gates
// stand open when it gets there, and one that no longer qualifies (too big, or kept waiting) turns away.

export interface LockRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface LockOptions {
  /** The lock channel (water). Default x 104..116, z 0..46 (tools/city/design.py "lock"). */
  channel?: LockRect;
  /** The bridge deck over the channel. Default x 102..118, z 14..21 ("lock_bridge"). */
  bridgeRect?: LockRect;

  /** Where the two pairs of gates stand. Default z 7 (river side) and 42 (dock side). */
  gatesZ?: [number, number];
  /** Is someone on the bridge deck? Then it waits before it opens. */
  occupied?: () => boolean;
  /** Colliders for the bridge's gallows posts (World.addCollider / removeCollider). */
  world?: { addCollider(r: Rect): void; removeCollider(r: Rect): void };
  /**
   * Fixes 2026-09-24 (Steve: "cart lodged in lock boom"): is anything the keeper must not swing a
   * balance beam into (Jef, a cart) where `inSweep` says a beam passes? Then that pair waits.
   */
  sweepBusy?: (inSweep: (x: number, z: number, r: number) => boolean) => boolean;
  /** Seconds of game time between passages, min and max. Default 150..330. */
  interval?: [number, number];
  /** The route of a tow, river end first (x, z): out of the fog, through the lock, to a berth in the dock. */
  route?: Array<[number, number]>;
  seed?: number;
  /** Load the bridge and gate models (default true; the tests run without them). */
  models?: boolean;
}

/** One passage of the lock's traffic (Lock.traffic(): the log the check reads). */
export interface LockTrip {
  names: string[];
  dir: "in" | "out";
  /** "locked": gates shut behind it and the chamber levelled; "level": both pairs open at high water. */
  mode: "locked" | "level" | "none";
  /** Seconds the boat stood (or crept, under 0.2 m/s) off the gates it came to. */
  waitOutside: number;
  /** Seconds it stood in the chamber while the keeper levelled it (the lock's own cycle). */
  waitInside: number;
  turnedAway: boolean;
  /** Why it turned away. */
  why: string;
  /** Seconds of play when it set off, and the river then. */
  at: number;
  river: number;
}

/** A row of Lock.fitTable(): a vessel or tow against the chamber. */
export interface LockFitRow extends LockFit {
  /** It is one of the lock's own traffic and fits: it gets lock trips. */
  lockTrips: boolean;
}

/**
 * What the lock's traffic may send, if it fits (shared/lockfit.ts, with the models' own sizes):
 * the old tows stay listed so the check shows they do not fit. A lone lighter or barge has no way
 * of its own and is not listed.
 */
export const LOCK_CANDIDATES: BoatName[][] = [
  ["tug", "lighter_loaded"],
  ["tug", "lighter"],
  ["tug", "hengst"],
  ["tug", "rhine_barge"],
  ["paddle_tug", "lighter_loaded"],
  ["paddle_tug", "rhine_barge"],
  ["tug"],
  ["paddle_tug"],
  ["hengst_sail"],
  ["sloop_sail"],
  ["schooner"],
];

export interface Lock {
  /** Every frame. With the camera, the tug turns round in the dock only when nobody is near to see it. */
  update(t: number, dt: number, camera?: THREE.Camera): void;
  /** True when the bridge lies across the lock and can be walked on. */
  bridgeClosed(): boolean;
  bridgeRect: LockRect;
  /** 0 = gates shut, 1 = gates wide open (the less open of the two pairs). */
  gatesOpen(): number;
  /** M6 tides: one pair, 0 = the river gates (z 7), 1 = the dock gates (z 42): 0 shut .. 1 open. */
  gateOpen?(which: 0 | 1): number;
  /**
   * Send a boat through now (dev): "in" from the river, "out" from the dock. `names` forces that
   * vessel or tow (one that does not fit turns away when it asks for the lock).
   */
  passNow(dir?: "in" | "out", names?: BoatName[]): void;
  /** The traffic now and the log of its passages (the lock check reads it). */
  traffic?(): { state: string; names: string[]; mode: string; inside: boolean; log: LockTrip[] };
  /** Every vessel and the lock's candidates against the chamber, with the models' sizes (dev). */
  fitTable?(): LockFitRow[];
  /**
   * M3j: a rowing boat asks for the lock (bridge up, gates open) or lets it go. It stays open while
   * asked. M6 tides: `where` tells the keeper where the boat is, so he can level the chamber for it.
   */
  request?(on: boolean, where?: () => { x: number; z: number }): void;
  /** M3j: how far the bridge's leaves are lifted, 0 (down) .. 1 (up). */
  lift?(): number;
  /** Fixes 2026-09-24: does a gate's balance beam swing over (x, z) (radius r)? Keep carts out of there. */
  inSweep?(x: number, z: number, r: number): boolean;
  group: THREE.Group;
}

// the river end runs along the harbour lane z -27, between the canal boats' lane (z -21, world/bridges.ts)
// and the small craft coming up river (z -36, world/river.ts); it starts out of the map in the fog
const DEFAULT_ROUTE: Array<[number, number]> = [
  [250, -27], [160, -27], [128, -26], [114, -16], [110, -6], [110, 10], [110, 30], [110, 46], [108, 55], [101, 63],
  [98, 74], [98, 94],
];

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

const smooth = (x: number) => {
  const k = THREE.MathUtils.clamp(x, 0, 1);
  return k * k * (3 - 2 * k);
};

let lockModels: Promise<Map<string, THREE.Object3D>> | null = null;

function loadLockModels(): Promise<Map<string, THREE.Object3D>> {
  if (lockModels) return lockModels;
  lockModels = (async () => {
    const draco = new DRACOLoader().setDecoderPath("/draco/");
    const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync("/models/lock.glb");
    draco.dispose();
    const mats = new Map<string, THREE.Material>();
    const thin = new Set(["lattice", "flag", "canvas"]);
    const out = new Map<string, THREE.Object3D>();
    for (const node of [...gltf.scene.children]) {
      node.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const swap = (src: THREE.Material) => {
          let mat = mats.get(src.name);
          if (!mat) {
            const map = (src as THREE.MeshStandardMaterial).map ?? null;
            if (map) {
              map.magFilter = THREE.NearestFilter;
              map.minFilter = THREE.NearestFilter;
              map.generateMipmaps = false;
              map.colorSpace = THREE.SRGBColorSpace;
              map.wrapS = map.wrapT = THREE.RepeatWrapping;
              map.needsUpdate = true;
            }
            mat =
              src.name === "glass"
                ? new THREE.MeshBasicMaterial({ map, color: 0xffc070 })
                : psx(
                    new THREE.MeshLambertMaterial({
                      map,
                      vertexColors: true,
                      side: thin.has(src.name) ? THREE.DoubleSide : THREE.FrontSide,
                      alphaTest: src.name === "lattice" ? 0.5 : 0,
                    }),
                    { affine: 0.5 },
                  );
            mat.name = src.name;
            mats.set(src.name, mat);
          }
          return mat;
        };
        m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
      });
      // rigging-like lines (the gate chains) stored as extras, as in boats.glb
      const rig = node.userData.rig as string | undefined;
      if (rig) {
        const f = JSON.parse(rig) as number[];
        const pos = new Float32Array(f.length);
        for (let i = 0; i < f.length; i += 3) {
          pos[i] = f[i];
          pos[i + 1] = f[i + 2];
          pos[i + 2] = -f[i + 1];
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        node.add(new THREE.LineSegments(g, ropeMaterial()));
      }
      node.removeFromParent();
      node.position.set(0, 0, 0);
      node.rotation.set(0, 0, 0);
      out.set(node.name, node);
    }
    return out;
  })();
  return lockModels;
}

/**
 * Build the lock into `scene`: bridge, gates, capstans, and the tow traffic. Models load in
 * the background; until then the bridge counts as closed (it starts closed).
 */
export function createLock(scene: THREE.Object3D, boats?: Boats | Promise<Boats>, opts: LockOptions = {}): Lock {
  const channel = opts.channel ?? { minX: 104, maxX: 116, minZ: 0, maxZ: 46 };
  const bridgeRect = opts.bridgeRect ?? { minX: 102, maxX: 118, minZ: 14, maxZ: 21 };
  const midZ = (bridgeRect.minZ + bridgeRect.maxZ) / 2;
  const [gz0, gz1] = opts.gatesZ ?? [7, 42];
  const interval = opts.interval ?? [150, 330];
  const r = rng(opts.seed ?? 1811);
  const group = new THREE.Group();
  group.name = "lock";
  scene.add(group);

  // --- moving parts. The bridge is a double lifting bridge (world/bridges.ts): its leaves rise in
  // place over the channel, carrying the quay railway's rails. bridgeAngle runs 0 (down) to
  // OPEN_BRIDGE (lifted); gates 0..1.
  const OPEN_BRIDGE = -Math.PI / 2;
  const GATE_OPEN = (75 * Math.PI) / 180;
  let bridge: DrawBridge | null = null;
  const gates: Array<{ obj: THREE.Object3D; closed: number; dir: number; pair: 0 | 1; rects: Rect[]; at: number }> = [];
  /**
   * The balance beam of a leaf (tools/blender/build_lock.py gate_leaf): from the heel post back along
   * the leaf's -X over the quay, 5.6 m (times the leaf's x scale), its top about 1.2 m up. Its
   * direction on the ground for a leaf turned to `yaw` (three.js turns local +x to (cos, -sin)).
   */
  const BEAM_LEN = 5.6;
  const BEAM_HALF = 0.3;
  const beamDir = (yaw: number): [number, number] => [-Math.cos(yaw), Math.sin(yaw)];
  const beamLen = (gt: (typeof gates)[number]) => BEAM_LEN * gt.obj.scale.x;
  /** Solid squares along the beam where it lies now (Jef, the townspeople and the carts go round it). */
  const beamRects = (gt: (typeof gates)[number]): Rect[] => {
    const [dx, dz] = beamDir(gt.obj.rotation.y);
    const out: Rect[] = [];
    for (let d = 0.3; d <= beamLen(gt) + 0.01; d += 0.55) {
      const x = gt.obj.position.x + dx * d;
      const z = gt.obj.position.z + dz * d;
      out.push({ minX: x - BEAM_HALF, maxX: x + BEAM_HALF, minZ: z - BEAM_HALF, maxZ: z + BEAM_HALF, top: 1.25 });
    }
    return out;
  };
  const setBeam = (gt: (typeof gates)[number]) => {
    if (Math.abs(gt.obj.rotation.y - gt.at) < 0.01 && gt.rects.length) return;
    for (const r of gt.rects) opts.world?.removeCollider(r);
    gt.rects = beamRects(gt);
    for (const r of gt.rects) opts.world?.addCollider(r);
    gt.at = gt.obj.rotation.y;
  };
  /** Does the beam of a pair (or of any pair) pass over (x, z) somewhere between shut and open? */
  const inSweep = (x: number, z: number, r: number, pair?: 0 | 1): boolean => {
    for (const gt of gates) {
      if (pair !== undefined && gt.pair !== pair) continue;
      const hx = gt.obj.position.x;
      const hz = gt.obj.position.z;
      const L = beamLen(gt);
      if (Math.hypot(x - hx, z - hz) > L + r + BEAM_HALF + 0.2) continue;
      for (let k = 0; k <= 12; k++) {
        const [dx, dz] = beamDir(gt.closed + gt.dir * GATE_OPEN * (k / 12));
        // the distance from (x, z) to the beam's line segment
        const t = Math.max(0, Math.min(L, (x - hx) * dx + (z - hz) * dz));
        if (Math.hypot(x - (hx + dx * t), z - (hz + dz * t)) < r + BEAM_HALF + 0.15) return true;
      }
    }
    return false;
  };
  let bridgeAngle = 0; // current
  const gateOpen: [number, number] = [0, 0]; // river pair, dock pair: 0..1
  let want = false; // the traffic has asked for the lock
  let boatWant = false; // M3j: a rowing boat wants it open
  let boatWhere: (() => { x: number; z: number }) | null = null;
  /** M6 tides: the side the boat came from, once it is in the chamber (it goes out the other side). */
  let boatFrom: 0 | 1 | null = null;
  /** The chamber's water when both pairs are shut (and the level it is making for). */
  let flat = water.dock;
  /** River and dock differ less than this when a boat asks: the keeper opens both pairs (high water). */
  const LEVEL_WINDOW = 0.3;
  /** The sluices fill or empty the chamber this fast (m/s). */
  const SLUICE = 0.25;
  const sideLevel = (i: 0 | 1) => (i === 0 ? water.river : water.dock);

  if (opts.models !== false) loadModelSet("/models/bridges.glb")
    .then((set) => {
      const L = (channel.maxX - channel.minX) / 2;
      bridge = createDrawBridge(
        set,
        group,
        [
          { hinge: [channel.minX, midZ], yaw: 0, L, half: 3.5, leaf: "draw_leaf_lock", beam: "draw_beam_6", frame: "draw_frame_lock" },
          { hinge: [channel.maxX, midZ], yaw: Math.PI, L, half: 3.5, leaf: "draw_leaf_lock", beam: "draw_beam_6", frame: "draw_frame_lock" },
        ],
        [],
        opts.world,
      );
    })
    .catch((e) => console.warn("bridges.glb did not load", e));

  if (opts.models !== false) loadLockModels()
    .then((models) => {
      const leaf = models.get("gate_leaf");
      const cap = models.get("gate_capstan");
      const half = (channel.maxX - channel.minX) / 2 - 0.3;
      const len = half / Math.cos((15 * Math.PI) / 180);
      for (const [pair, z] of [[0, gz0], [1, gz1]] as const) {
        for (const side of [0, 1]) {
          if (!leaf) continue;
          const o = leaf.clone();
          const x = side === 0 ? channel.minX + 0.3 : channel.maxX - 0.3;
          o.position.set(x, 0, z);
          o.scale.x = len / 6.0;
          // closed: each leaf 15 deg off square, pointing toward the dock (+z); open: along the wall
          const closed = side === 0 ? -(15 * Math.PI) / 180 : Math.PI + (15 * Math.PI) / 180;
          o.rotation.y = closed;
          group.add(o);
          gates.push({ obj: o, closed, dir: side === 0 ? -1 : 1, pair, rects: [], at: NaN });
          if (cap) {
            const c = cap.clone();
            c.position.set(side === 0 ? channel.minX - 3.2 : channel.maxX + 3.2, 0, z - 3.5);
            group.add(c);
          }
        }
      }
    })
    .catch((e) => console.warn("lock.glb did not load", e));

  // --- the traffic: a vessel (or a tow that fits) from the river into the dock, or back out
  const route = opts.route ?? DEFAULT_ROUTE;
  const curve = new THREE.CatmullRomCurve3(
    route.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    false,
    "centripetal",
  );
  const LEN = curve.getLength();
  // the route through the chamber runs along the channel (x 110): where along it lies each z there
  const zAlong: Array<[number, number]> = []; // [s, z] inside the channel
  {
    const N = 800;
    const p = new THREE.Vector3();
    for (let i = 0; i <= N; i++) {
      curve.getPointAt(i / N, p);
      if (p.x > channel.minX && p.x < channel.maxX && p.z > channel.minZ - 8 && p.z < channel.maxZ + 8) zAlong.push([(i / N) * LEN, p.z]);
    }
  }
  /** Route position where the route crosses z in the channel. */
  const sAtZ = (z: number): number => {
    for (let i = 1; i < zAlong.length; i++) {
      const [s0, z0] = zAlong[i - 1];
      const [s1, z1] = zAlong[i];
      if ((z0 - z) * (z1 - z) <= 0 && z1 !== z0) return s0 + ((z - z0) / (z1 - z0)) * (s1 - s0);
    }
    return z <= (zAlong[0]?.[1] ?? 0) ? (zAlong[0]?.[0] ?? 0) : (zAlong[zAlong.length - 1]?.[0] ?? LEN);
  };
  const sG0 = sAtZ(gz0);
  const sG1 = sAtZ(gz1);
  /** The bow waits this far off the gates it comes to (clear of the leaves that open toward it). */
  const HOLD = 8;
  /** A boat asks for the lock this far (m) before it gets there: bridge up, chamber levelled, gates open as it comes. */
  const ASK_M = 100;
  /** Kept waiting off the gates this long (s), a boat turns away and tries again later. */
  const HOLD_MAX = 45;
  const SPEED = 1.6;

  interface Train {
    names: BoatName[];
    objs: THREE.Object3D[];
    lens: number[];
    /** Centre of each part behind the lead (shared/lockfit.ts trainOffsets). */
    offs: number[];
    /** Lead's centre to the train's stern. */
    rear: number;
    beam: number;
    fit: LockFit;
    lines: THREE.Line[];
  }
  let boatsReady: Boats | null = null;
  const trains = new Map<string, Train>();
  const partsOf = (b: Boats, names: BoatName[]) => names.map((n) => ({ name: n, length: b.dims(n).length, beam: b.dims(n).beam }));
  /** The models for a vessel or tow, placed once and kept hidden till it sails. */
  function trainFor(names: BoatName[]): Train | null {
    const b = boatsReady;
    if (!b) return null;
    const key = names.join("+");
    let t = trains.get(key);
    if (t) return t;
    const parts = partsOf(b, names);
    const offs = trainOffsets(parts, TOW_LINE);
    const objs = names.map((n) => {
      const o = b.place(n, route[0][0], route[0][1], 0, group);
      o.visible = false;
      return o;
    });
    const lines = names.slice(1).map(() => {
      const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(lg, ropeMaterial(0x2a2218));
      line.frustumCulled = false;
      line.visible = false;
      group.add(line);
      return line;
    });
    t = {
      names,
      objs,
      lens: parts.map((p) => p.length),
      offs,
      rear: offs[offs.length - 1] + parts[parts.length - 1].length / 2,
      beam: parts.reduce((m, p) => Math.max(m, p.beam), 0),
      fit: lockFit(parts, TOW_LINE),
      lines,
    };
    trains.set(key, t);
    return t;
  }
  /** The candidates that fit the chamber (with the models' own sizes). */
  let fitting: BoatName[][] = [];
  let cur: Train | null = null;
  // the boat under way (Boats.moving), and whether it has asked for the lock yet
  const ship: MovingShip = { id: newShipId(), kind: "tug", x: 0, z: 0, heading: 0, speed: 0, steam: true };
  let lastV = 0;
  const pending = boats ?? loadBoats();
  Promise.resolve(pending)
    .then((b) => {
      boatsReady = b;
      fitting = LOCK_CANDIDATES.filter((names) => lockFit(partsOf(b, names), TOW_LINE).fits);
      if (!fitting.length) return;
      const first = trainFor(fitting[Math.floor(r() * fitting.length)]);
      if (!first) return;
      cur = first;
      show(first);
      place(first.offs[first.offs.length - 1], 1);
    })
    .catch((e) => console.warn("no boats for the lock", e));

  function show(t: Train | null): void {
    for (const tr of trains.values()) {
      const on = tr === t;
      tr.objs.forEach((o) => (o.visible = on));
      tr.lines.forEach((l) => (l.visible = on));
    }
    if (t) {
      ship.kind = t.names[0];
      ship.steam = isSteam(t.names[0]);
    }
  }

  // traffic state: "river" (lying out in the fog), "in" (going in), "dock" (moored in the dock), "out",
  // "turn" (turning away from the lock), "back" (going back where it came from)
  let state: "river" | "in" | "dock" | "out" | "turn" | "back" = "river";
  let s = 0; // the lead's position along the route, from the river end
  let dir = 1; // +1 toward the dock, -1 toward the river (the trip's way)
  let wait = interval[0] * 0.3 + r() * interval[0] * 0.4;
  let mode: "locked" | "level" | null = null; // latched when the boat asks
  let inside = false; // locked through: the whole boat lies in the chamber (the keeper turns to the far pair)
  let held = 0; // seconds kept waiting off the gates
  let turnT = 0; // seconds into turning round
  let backFace = 1; // "back": the way the hulls face
  let clock = 0;
  let trip: LockTrip | null = null;
  const log: LockTrip[] = [];

  const pt = new THREE.Vector3();
  const tg = new THREE.Vector3();
  /** Put the lead at route position sLead, the others behind it, all facing `face` (+1 dock, -1 river); `yaw` turns a lone boat. */
  function place(sLead: number, face: number, yaw = 0): void {
    const t = cur;
    if (!t) return;
    const set = (o: THREE.Object3D, sp: number) => {
      const u = THREE.MathUtils.clamp(sp / LEN, 0, 1);
      curve.getPointAt(u, pt);
      curve.getTangentAt(u, tg);
      o.position.set(pt.x, levelAt(pt.x, pt.z), pt.z);
      o.rotation.y = Math.atan2(tg.x * face, tg.z * face) + yaw;
    };
    t.objs.forEach((o, i) => set(o, sLead - face * t.offs[i]));
    // the towing hawsers from each stern to the next bow, sagging a little
    t.lines.forEach((line, i) => {
      const a0 = t.objs[i];
      const b0 = t.objs[i + 1];
      const ta = a0.rotation.y;
      const wa = b0.rotation.y;
      const a = new THREE.Vector3(a0.position.x - Math.sin(ta) * (t.lens[i] / 2 - 1.5), a0.position.y + 1.3, a0.position.z - Math.cos(ta) * (t.lens[i] / 2 - 1.5));
      const c = new THREE.Vector3(b0.position.x + Math.sin(wa) * (t.lens[i + 1] / 2 - 0.5), b0.position.y + 1.1, b0.position.z + Math.cos(wa) * (t.lens[i + 1] / 2 - 0.5));
      const m = a.clone().lerp(c, 0.5);
      m.y = Math.min(a.y, c.y) - 0.7;
      const pos = line.geometry.getAttribute("position") as THREE.BufferAttribute;
      pos.setXYZ(0, a.x, a.y, a.z);
      pos.setXYZ(1, m.x, m.y, m.z);
      pos.setXYZ(2, c.x, c.y, c.z);
      pos.needsUpdate = true;
    });
  }
  const tailOff = () => (cur ? cur.offs[cur.offs.length - 1] : 0);

  /** Set off: "in" from the river with a new boat, "out" from the dock with the one lying there. */
  function start(d: "in" | "out", names?: BoatName[]): void {
    if (state === "in" || state === "out" || state === "turn" || state === "back") return;
    // (one forced from the dev menu that turned away is not sent again: a boat that fits goes instead)
    if (d === "in" || names || (cur && !cur.fit.fits)) {
      const pick = names ?? (fitting.length ? fitting[Math.floor(r() * fitting.length)] : null);
      const t = pick ? trainFor(pick) : null;
      if (!t) return;
      cur = t;
      show(cur);
    }
    if (!cur) return;
    dir = d === "in" ? 1 : -1;
    // in: the lead at the river end, the rest behind it; out: the lead goes round to the lock side of the rest
    s = d === "in" ? tailOff() : LEN - tailOff();
    state = d;
    want = false;
    mode = null;
    inside = false;
    held = 0;
    ship.id = newShipId();
    trip = { names: [...cur.names], dir: d, mode: "none", waitOutside: 0, waitInside: 0, turnedAway: false, why: "", at: +clock.toFixed(1), river: +water.river.toFixed(2) };
    log.push(trip);
    if (log.length > 60) log.shift();
  }

  /** The boat gives up the lock and goes back where it came from. */
  function turnAway(why: string): void {
    if (trip) {
      trip.turnedAway = true;
      trip.why = why;
    }
    want = false;
    mode = null;
    // a lone boat turns round where it is; a tow cannot, it goes astern
    state = cur && cur.objs.length === 1 ? "turn" : "back";
    backFace = dir;
    turnT = 0;
  }

  const berth = new THREE.Vector3(route[route.length - 1][0], 0, route[route.length - 1][1]);
  function update(_t: number, dt: number, camera?: THREE.Camera): void {
    clock += dt;
    // --- bridge and gates follow the wish, one after the other: open = bridge first, then gates
    const occupied = opts.occupied?.() ?? false;
    const bridgeSpeed = 0.07; // rad/s: some men at a capstan
    const gateSpeed = 0.05; // of the full swing, per second
    // slow at both ends of the swing, as when men start and stop a capstan
    const ease = 0.25 + 0.75 * Math.sin(Math.PI * THREE.MathUtils.clamp(bridgeAngle / OPEN_BRIDGE, 0, 1));
    // M6 tides: which pairs should stand open. The traffic's boat: the pair on its side; once it lies
    // in the chamber, the far pair (on the level: both at once). A rowing boat the same by its place.
    const wantGate: [boolean, boolean] = [false, false];
    let target: 0 | 1 | null = null;
    const near: 0 | 1 = dir > 0 ? 0 : 1;
    const levelGo = want && mode === "level";
    if (levelGo) wantGate[0] = wantGate[1] = true;
    else if (want) {
      target = inside ? (near === 0 ? 1 : 0) : near;
      wantGate[target] = true;
    } else if (boatWant) {
      const b = boatWhere?.();
      if (b) {
        const inCh = b.z > gz0 + 1.5 && b.z < gz1 - 1.5;
        if (!inCh) boatFrom = null;
        else if (boatFrom === null) boatFrom = gateOpen[0] >= gateOpen[1] ? 0 : 1;
        target = inCh ? (boatFrom === 0 ? 1 : 0) : b.z <= gz0 + 1.5 ? 0 : 1;
      } else target = Math.abs(flat - water.river) < Math.abs(flat - water.dock) ? 0 : 1;
      wantGate[target] = true;
    }
    // the bridge goes up when a boat has asked (it asks only as it comes near: the railway and the
    // people cross here)
    if (want || boatWant) {
      if (bridgeAngle > OPEN_BRIDGE && (bridgeAngle < -0.001 || !occupied)) bridgeAngle = Math.max(OPEN_BRIDGE, bridgeAngle - bridgeSpeed * ease * dt);
    } else if (gateOpen[0] < 0.3 && gateOpen[1] < 0.3) bridgeAngle = Math.min(0, bridgeAngle + bridgeSpeed * ease * dt);
    const bridgeUp = bridgeAngle < -0.3;
    for (const i of [0, 1] as const) {
      const other = i === 0 ? 1 : 0;
      // a pair opens only with the bridge up, the other pair shut (unless both are wanted on the
      // level), and the chamber at this side's level (on the level: near enough, the water runs through)
      const level = levelGo || Math.abs(flat - sideLevel(i)) < 0.04;
      const mayOpen = wantGate[i] && bridgeUp && (levelGo || gateOpen[other] < 0.01) && level;
      // the keeper does not swing a balance beam into Jef or a cart standing in its way
      const moving = (mayOpen && gateOpen[i] < 1) || (!wantGate[i] && gateOpen[i] > 0);
      if (moving && opts.sweepBusy?.((x, z, r) => inSweep(x, z, r, i))) continue;
      if (mayOpen) gateOpen[i] = Math.min(1, gateOpen[i] + gateSpeed * dt);
      else if (!wantGate[i]) gateOpen[i] = Math.max(0, gateOpen[i] - gateSpeed * dt);
    }
    // the chamber: with a pair open it stands at that side's level (both open: between them);
    // both shut: the sluices bring it to the level of the side the boat wants
    if (gateOpen[0] > 0.02 && gateOpen[1] > 0.02) flat = (water.river + water.dock) / 2;
    else if (gateOpen[0] > 0.02) flat = water.river;
    else if (gateOpen[1] > 0.02) flat = water.dock;
    else if (target !== null || levelGo) {
      const to = sideLevel(target ?? 0);
      flat += THREE.MathUtils.clamp(to - flat, -SLUICE * dt, SLUICE * dt);
    }
    // the ends of the chamber (tide.ts levelAt reads them): each end follows its open pair
    const ends: [number, number] = [gateOpen[0] > 0.02 ? water.river : flat, gateOpen[1] > 0.02 ? water.dock : flat];
    const k = Math.min(1, dt * 2);
    water.chamberA += (ends[0] - water.chamberA) * k;
    water.chamberB += (ends[1] - water.chamberB) * k;
    water.chamber = (water.chamberA + water.chamberB) / 2;
    bridge?.set(smooth(bridgeAngle / OPEN_BRIDGE));
    for (const gt of gates) {
      gt.obj.rotation.y = gt.closed + gt.dir * GATE_OPEN * smooth(gateOpen[gt.pair]);
      setBeam(gt);
    }

    // --- traffic
    if (!cur) return;
    const t = cur;
    if (state === "river" || state === "dock") {
      wait -= dt;
      // in the dock the boat turns round to lead out: only while nobody is near enough to see it.
      // It sets off only while the lock is free (no rowing boat in it), so it is never kept waiting.
      const seen = state === "dock" && camera && camera.position.distanceTo(berth) < 45;
      if (wait <= 0 && !seen && !boatWant) start(state === "river" ? "in" : "out");
      else if (state === "dock") place(LEN, 1);
      else place(tailOff(), 1);
      if (state === "river" || state === "dock") return;
    }
    // turning away: a lone boat turns round on the spot, then goes back
    if (state === "turn") {
      turnT += dt;
      const TURN_S = 14;
      place(s, backFace, Math.PI * smooth(turnT / TURN_S));
      lastV = 0.3;
      if (turnT >= TURN_S) {
        state = "back";
        backFace = -dir;
      }
      return;
    }
    if (state === "back") {
      // toward where it came from: the river end (it came in) or its berth in the dock (it came out)
      const v = backFace === dir ? 0.8 : SPEED; // a tow goes astern, slowly
      s -= dir * v * dt;
      lastV = v;
      place(s, backFace);
      if ((dir > 0 && s <= tailOff()) || (dir < 0 && s >= LEN - tailOff())) {
        state = dir > 0 ? "river" : "dock";
        s = dir > 0 ? tailOff() : LEN;
        wait = interval[0] + r() * (interval[1] - interval[0]);
        place(s, 1);
      }
      return;
    }

    const bow = s + dir * (t.lens[0] / 2);
    const stern = s - dir * t.rear;
    const nearGate = dir > 0 ? sG0 : sG1;
    const farGate = dir > 0 ? sG1 : sG0;
    const span = chamberSpan(t.beam);
    const spanFrom = sAtZ(span.from);
    const spanTo = sAtZ(span.to);
    const holdAt = nearGate - dir * HOLD; // the bow waits here till the gates stand open
    const stopAt = dir > 0 ? spanTo : spanFrom; // locked through: the bow stops here till the far pair opens
    const toHold = dir > 0 ? holdAt - bow : bow - holdAt;
    const pastNear = toHold < -0.5;
    // ask for the lock early enough that it stands open on arrival (the out-bound boat asks at its berth)
    if (!want && !pastNear && toHold < ASK_M) {
      if (!t.fit.fits) {
        turnAway(`does not fit the lock: ${t.fit.why}`);
        return;
      }
      want = true;
      mode = Math.abs(water.river - water.dock) < LEVEL_WINDOW ? "level" : "locked";
      if (trip) trip.mode = mode;
      signal(ship, "lock");
    }
    const nearOpen = bridgeAngle <= OPEN_BRIDGE + 0.02 && (mode === "level" ? gateOpen[0] >= 0.98 && gateOpen[1] >= 0.98 : gateOpen[near] >= 0.98);
    const farOpen = gateOpen[near === 0 ? 1 : 0] >= 0.98;
    let v = SPEED;
    // off the lock: hold short of the gates till they stand open (an out-bound boat does not leave its
    // berth before the gates start to open: it waits there, not off the gates)
    if (!pastNear && !nearOpen) {
      if (dir < 0 && gateOpen[near] < 0.05 && Math.abs(s - (LEN - tailOff())) < 0.5) v = 0;
      else v = THREE.MathUtils.clamp(Math.max(0, toHold) * 0.3, 0, SPEED);
    }
    // locked through: stop in the chamber till the keeper has levelled it and the far pair is open
    if (pastNear && mode === "locked" && !farOpen) {
      const room = dir > 0 ? stopAt - bow : bow - stopAt;
      v = Math.min(v, THREE.MathUtils.clamp(room * 0.3, 0, SPEED));
    }
    // ease at both ends of the route
    const fromEnd = Math.min(s, LEN - s);
    v *= THREE.MathUtils.clamp(0.25 + fromEnd / 20, 0.25, 1);
    const lo = dir > 0 ? tailOff() : 0;
    const hi = dir > 0 ? LEN : LEN - tailOff();
    s = THREE.MathUtils.clamp(s + dir * v * dt, lo, hi);
    lastV = v;
    // the waits: off the gates, and in the chamber while it is levelled
    const atBerth = dir < 0 && Math.abs(s - hi) < 0.5;
    if (v < 0.2 && trip && !atBerth) {
      if (!pastNear) trip.waitOutside += dt;
      else if (mode === "locked") trip.waitInside += dt;
    }
    // kept waiting off the gates (a rowing boat in the lock, the bridge held down): turn away
    if (!pastNear && v < 0.2 && !atBerth) {
      held += dt;
      if (held > HOLD_MAX) {
        turnAway(`kept waiting ${HOLD_MAX} s off the gates`);
        return;
      }
    } else held = 0;
    // locked through: once the whole boat lies in the chamber the keeper shuts the gates behind it
    if (want && mode === "locked" && !inside && (dir > 0 ? stern >= spanFrom : stern <= spanTo)) inside = true;
    // once the stern is clear of the lock, let it close
    const clear = dir > 0 ? stern > farGate + HOLD : stern < farGate - 3;
    if (clear && want) {
      want = false;
      mode = null;
    }
    place(s, dir);
    if ((dir > 0 && s >= LEN) || (dir < 0 && s <= 0)) {
      state = dir > 0 ? "dock" : "river";
      wait = interval[0] + r() * (interval[1] - interval[0]);
      want = false;
      mode = null;
      trip = null;
    }
  }

  addMovingSource((out) => {
    if (!cur || state === "river" || state === "dock") return;
    ship.x = cur.objs[0].position.x;
    ship.z = cur.objs[0].position.z;
    ship.heading = cur.objs[0].rotation.y;
    ship.speed = lastV;
    out.push(ship);
  });

  return {
    update,
    bridgeClosed: () => bridgeAngle >= -0.001,
    bridgeRect,
    gatesOpen: () => smooth(Math.min(gateOpen[0], gateOpen[1])),
    gateOpen: (which) => smooth(gateOpen[which]),
    request: (on, where) => {
      boatWant = on;
      if (where) boatWhere = where;
      if (!on) {
        boatWhere = null;
        boatFrom = null;
      }
    },
    lift: () => smooth(bridgeAngle / OPEN_BRIDGE),
    inSweep: (x, z, r) => inSweep(x, z, r),
    passNow(d = "in", names) {
      start(d, names);
    },
    traffic: () => ({ state, names: cur ? [...cur.names] : [], mode: mode ?? "", inside, log: [...log] }),
    fitTable: () => {
      const b = boatsReady;
      if (!b) return [];
      const rows: BoatName[][] = [...VESSELS.filter((n) => n !== "pontoon_section").map((n) => [n]), ...LOCK_CANDIDATES.filter((c) => c.length > 1)];
      return rows.map((names) => {
        const f = lockFit(partsOf(b, names), TOW_LINE);
        return { ...f, lockTrips: f.fits && LOCK_CANDIDATES.some((c) => c.join("+") === names.join("+")) };
      });
    },
    group,
  };
}
