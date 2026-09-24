import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { psx } from "../retro/psx";
import { levelAt, water } from "./tide";
import { addMovingSource, isSteam, loadBoats, loadModelSet, newShipId, ropeMaterial, signal, type BoatName, type Boats, type MovingShip } from "./boats";
import { createDrawBridge, type DrawBridge } from "./bridges";
import type { Rect } from "./geom";

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
// The chamber between the gates now matters. A tow does not fit the chamber: it waits off the lock
// till river and dock stand within LEVEL_WINDOW of each other (round high water) and goes through
// with both pairs open (the water in the chamber then slopes gently from one level to the other). A rowing boat is locked through: the
// keeper shuts the far pair, lets the water in or out through the sluices till the chamber stands at
// the boat's level, opens the near pair; once the boat is in, the other way round.

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
}

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
  /** Send a tow through now (dev): "in" from the river, "out" from the dock. */
  passNow(dir?: "in" | "out"): void;
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
  let want = false; // the traffic wants the lock open
  let boatWant = false; // M3j: a rowing boat wants it open
  let boatWhere: (() => { x: number; z: number }) | null = null;
  /** M6 tides: the side the boat came from, once it is in the chamber (it goes out the other side). */
  let boatFrom: 0 | 1 | null = null;
  /** The chamber's water when both pairs are shut (and the level it is making for). */
  let flat = water.dock;
  /** River and dock may differ this much for a tow to set out (it goes through with both pairs open). */
  const LEVEL_WINDOW = 0.6;
  /** The sluices fill or empty the chamber this fast (m/s). */
  const SLUICE = 0.25;
  const sideLevel = (i: 0 | 1) => (i === 0 ? water.river : water.dock);

  loadModelSet("/models/bridges.glb")
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

  loadLockModels()
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

  // --- the tow: a tug and a lighter or barge on a line
  const route = opts.route ?? DEFAULT_ROUTE;
  const curve = new THREE.CatmullRomCurve3(
    route.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    false,
    "centripetal",
  );
  const LEN = curve.getLength();
  // where the lock zone starts and ends along the route (the tug's bow must wait before it)
  let sIn = 0;
  let sOut = LEN;
  {
    const N = 400;
    const p = new THREE.Vector3();
    let found = false;
    for (let i = 0; i <= N; i++) {
      curve.getPointAt(i / N, p);
      const inside = p.x > channel.minX - 2 && p.x < channel.maxX + 2 && p.z > channel.minZ - 3 && p.z < channel.maxZ + 3;
      if (inside && !found) {
        sIn = (i / N) * LEN;
        found = true;
      }
      if (inside) sOut = (i / N) * LEN;
    }
  }
  const TOWS: BoatName[] = ["lighter_loaded", "rhine_barge", "lighter", "hengst"];
  interface Tow {
    tug: THREE.Object3D;
    tugLen: number;
    tows: Array<{ o: THREE.Object3D; len: number }>;
    line: THREE.Line;
  }
  let tow: Tow | null = null;
  // the tow as a boat under way (Boats.moving), and whether it has sounded for the lock yet
  const ship: MovingShip = { id: newShipId(), kind: "tug", x: 0, z: 0, heading: 0, speed: 0, steam: true };
  let signalled = false;
  let lastV = 0;
  const pending = boats ?? loadBoats();
  Promise.resolve(pending)
    .then((b) => {
      const tugKind: BoatName = r() < 0.5 ? "tug" : "paddle_tug";
      ship.kind = tugKind;
      ship.steam = isSteam(tugKind);
      const tug = b.place(tugKind, route[0][0], route[0][1], 0, group);
      const tows = TOWS.map((n) => {
        const o = b.place(n, route[0][0], route[0][1], 0, group);
        o.visible = false;
        return { o, len: b.dims(n).length };
      });
      const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(lg, ropeMaterial(0x2a2218));
      line.frustumCulled = false;
      group.add(line);
      tow = { tug, tugLen: b.dims("tug").length, tows, line };
      tows[towIdx].o.visible = true;
      place(gapOf(), 1, 0);
    })
    .catch((e) => console.warn("no boats for the lock", e));

  // traffic state: "river" (parked out in the fog), "in" (going in), "dock" (moored in the dock), "out"
  let state: "river" | "in" | "dock" | "out" = "river";
  let s = 0; // tug position along the route, from the river end
  let wait = interval[0] * 0.3 + r() * interval[0] * 0.4;
  let towIdx = 0;
  const SPEED = 1.6;

  const pt = new THREE.Vector3();
  const tg = new THREE.Vector3();
  /** Put the tug at route position s, facing dir (+1 toward the dock, -1 toward the river). */
  function place(sTug: number, dir: number, _dt: number): void {
    if (!tow) return;
    const tw = tow.tows[towIdx];
    const gap = tow.tugLen / 2 + 9 + tw.len / 2;
    const sTow = sTug - dir * gap;
    const set = (o: THREE.Object3D, sp: number) => {
      const u = THREE.MathUtils.clamp(sp / LEN, 0, 1);
      curve.getPointAt(u, pt);
      curve.getTangentAt(u, tg);
      o.position.set(pt.x, levelAt(pt.x, pt.z), pt.z);
      o.rotation.y = Math.atan2(tg.x * dir, tg.z * dir);
    };
    set(tow.tug, sTug);
    set(tw.o, sTow);
    // the towing hawser from the tug's stern to the tow's bow, sagging a little
    const ta = tow.tug.rotation.y;
    const wa = tw.o.rotation.y;
    const a = new THREE.Vector3(
      tow.tug.position.x - Math.sin(ta) * (tow.tugLen / 2 - 1.5),
      tow.tug.position.y + 1.3,
      tow.tug.position.z - Math.cos(ta) * (tow.tugLen / 2 - 1.5),
    );
    const c = new THREE.Vector3(
      tw.o.position.x + Math.sin(wa) * (tw.len / 2 - 0.5),
      tw.o.position.y + 1.1,
      tw.o.position.z + Math.cos(wa) * (tw.len / 2 - 0.5),
    );
    const m = a.clone().lerp(c, 0.5);
    m.y = Math.min(a.y, c.y) - 0.7;
    const pos = tow.line.geometry.getAttribute("position") as THREE.BufferAttribute;
    pos.setXYZ(0, a.x, a.y, a.z);
    pos.setXYZ(1, m.x, m.y, m.z);
    pos.setXYZ(2, c.x, c.y, c.z);
    pos.needsUpdate = true;
  }

  function lockOpen(): boolean {
    return bridgeAngle <= OPEN_BRIDGE + 0.02 && gateOpen[0] >= 0.98 && gateOpen[1] >= 0.98;
  }

  const gapOf = () => (tow ? tow.tugLen / 2 + 9 + tow.tows[towIdx].len / 2 : 30);

  function start(dir: "in" | "out"): void {
    if (!tow || state === "in" || state === "out") return;
    if (dir === "in") {
      tow.tows.forEach((t) => (t.o.visible = false));
      towIdx = Math.floor(r() * tow.tows.length);
      tow.tows[towIdx].o.visible = true;
      s = gapOf(); // tow at the river end of the route, tug ahead of it
    } else {
      s = LEN - gapOf(); // the tug has gone round to the lock side of its tow
    }
    state = dir;
    want = true;
    ship.id = newShipId();
    signalled = false;
  }

  const berth = new THREE.Vector3(route[route.length - 1][0], 0, route[route.length - 1][1]);
  function update(_t: number, dt: number, camera?: THREE.Camera): void {
    // --- bridge and gates follow the wish, one after the other: open = bridge first, then gates
    const occupied = opts.occupied?.() ?? false;
    const bridgeSpeed = 0.07; // rad/s: some men at a capstan
    const gateSpeed = 0.05; // of the full swing, per second
    // slow at both ends of the swing, as when men start and stop a capstan
    const ease = 0.25 + 0.75 * Math.sin(Math.PI * THREE.MathUtils.clamp(bridgeAngle / OPEN_BRIDGE, 0, 1));
    // M6 tides: which pairs should stand open. A tow: both, on the level (round high water).
    // A rowing boat: the pair on its side; in the chamber, the pair it did not come in by.
    const wantGate: [boolean, boolean] = [false, false];
    let target: 0 | 1 | null = null;
    // a tow goes through only on the level (it does not fit the chamber); once both pairs are open
    // they stay open till it is clear. Until then it waits at the lock for the tide.
    const atLevel = Math.abs(water.river - water.dock) < LEVEL_WINDOW;
    const towGo = want && (atLevel || (gateOpen[0] > 0.5 && gateOpen[1] > 0.5));
    if (towGo) wantGate[0] = wantGate[1] = true;
    else if (boatWant) {
      const b = boatWhere?.();
      if (b) {
        const inside = b.z > gz0 + 1.5 && b.z < gz1 - 1.5;
        if (!inside) boatFrom = null;
        else if (boatFrom === null) boatFrom = gateOpen[0] >= gateOpen[1] ? 0 : 1;
        target = inside ? (boatFrom === 0 ? 1 : 0) : b.z <= gz0 + 1.5 ? 0 : 1;
      } else target = Math.abs(flat - water.river) < Math.abs(flat - water.dock) ? 0 : 1;
      wantGate[target] = true;
    }
    // the bridge goes up for a boat, or for a tow once the water is on the level (it does not stand
    // open for hours while a tow waits for the tide: the railway and the people cross here)
    if (towGo || boatWant) {
      if (bridgeAngle > OPEN_BRIDGE && (bridgeAngle < -0.001 || !occupied)) bridgeAngle = Math.max(OPEN_BRIDGE, bridgeAngle - bridgeSpeed * ease * dt);
    } else if (gateOpen[0] < 0.3 && gateOpen[1] < 0.3) bridgeAngle = Math.min(0, bridgeAngle + bridgeSpeed * ease * dt);
    const bridgeUp = bridgeAngle < -0.3;
    for (const i of [0, 1] as const) {
      const other = i === 0 ? 1 : 0;
      // a pair opens only with the bridge up, the other pair shut (unless a tow wants both), and
      // the chamber at this side's level (a tow: near enough; the water then runs through)
      const level = towGo || Math.abs(flat - sideLevel(i)) < 0.04;
      const mayOpen = wantGate[i] && bridgeUp && (towGo || gateOpen[other] < 0.01) && level;
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
    else if (target !== null || towGo) {
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
    if (!tow) return;
    if (state === "river" || state === "dock") {
      wait -= dt;
      // in the dock the tug turns round to lead out: only while nobody is near enough to see it
      const seen = state === "dock" && camera && camera.position.distanceTo(berth) < 45;
      if (wait <= 0 && !seen) start(state === "river" ? "in" : "out");
      else if (state === "dock") place(LEN, 1, dt);
      else place(gapOf(), 1, dt);
      if (state === "river" || state === "dock") return;
    }
    const dir = state === "in" ? 1 : -1;
    const tw = tow.tows[towIdx];
    const gap = gapOf();
    const bow = s + dir * (tow.tugLen / 2);
    const stern = s - dir * (gap + tw.len / 2);
    // hold short of the lock until the bridge and gates are open
    const holdAt = dir > 0 ? sIn - 14 : sOut + 14;
    const beforeLock = dir > 0 ? bow < sIn : bow > sOut;
    let v = SPEED;
    if (!lockOpen() && beforeLock) {
      const room = dir > 0 ? holdAt - bow : bow - holdAt;
      v = THREE.MathUtils.clamp(room * 0.3, 0, SPEED);
    }
    // ease at both ends of the route
    const fromEnd = Math.min(s, LEN - s);
    v *= THREE.MathUtils.clamp(0.25 + fromEnd / 20, 0.25, 1);
    s = THREE.MathUtils.clamp(s + dir * v * dt, dir > 0 ? gap : 0, dir > 0 ? LEN : LEN - gap);
    lastV = v;
    // the tug sounds its whistle to ask for the lock as it comes up
    const toLock = dir > 0 ? sIn - bow : bow - sOut;
    if (!signalled && toLock < 70) {
      signalled = true;
      signal(ship, "lock");
    }
    // once the tow's stern is clear of the lock, let it close
    const clear = dir > 0 ? stern > sOut + 4 : stern < sIn - 4;
    if (clear) want = false;
    place(s, dir, dt);
    if ((dir > 0 && s >= LEN) || (dir < 0 && s <= 0)) {
      state = dir > 0 ? "dock" : "river";
      wait = interval[0] + r() * (interval[1] - interval[0]);
      want = false;
    }
  }

  addMovingSource((out) => {
    if (!tow || (state !== "in" && state !== "out")) return;
    ship.x = tow.tug.position.x;
    ship.z = tow.tug.position.z;
    ship.heading = tow.tug.rotation.y;
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
    passNow(dir = "in") {
      start(dir);
    },
    group,
  };
}
