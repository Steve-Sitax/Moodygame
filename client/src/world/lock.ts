import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { psx } from "../retro/psx";
import { WATER_Y } from "./rijnkaai";
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
  /** 0 = gates shut, 1 = gates wide open. */
  gatesOpen(): number;
  /** Send a tow through now (dev): "in" from the river, "out" from the dock. */
  passNow(dir?: "in" | "out"): void;
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
  const gates: Array<{ obj: THREE.Object3D; closed: number; dir: number }> = [];
  let bridgeAngle = 0; // current
  let gateOpen = 0; // 0..1
  let want = false; // the traffic wants the lock open

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
      for (const z of [gz0, gz1]) {
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
          gates.push({ obj: o, closed, dir: side === 0 ? -1 : 1 });
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
      o.position.set(pt.x, WATER_Y, pt.z);
      o.rotation.y = Math.atan2(tg.x * dir, tg.z * dir);
    };
    set(tow.tug, sTug);
    set(tw.o, sTow);
    // the towing hawser from the tug's stern to the tow's bow, sagging a little
    const ta = tow.tug.rotation.y;
    const wa = tw.o.rotation.y;
    const a = new THREE.Vector3(
      tow.tug.position.x - Math.sin(ta) * (tow.tugLen / 2 - 1.5),
      WATER_Y + 1.3,
      tow.tug.position.z - Math.cos(ta) * (tow.tugLen / 2 - 1.5),
    );
    const c = new THREE.Vector3(
      tw.o.position.x + Math.sin(wa) * (tw.len / 2 - 0.5),
      WATER_Y + 1.1,
      tw.o.position.z + Math.cos(wa) * (tw.len / 2 - 0.5),
    );
    const m = a.clone().lerp(c, 0.5);
    m.y = WATER_Y + 0.4;
    const pos = tow.line.geometry.getAttribute("position") as THREE.BufferAttribute;
    pos.setXYZ(0, a.x, a.y, a.z);
    pos.setXYZ(1, m.x, m.y, m.z);
    pos.setXYZ(2, c.x, c.y, c.z);
    pos.needsUpdate = true;
  }

  function lockOpen(): boolean {
    return bridgeAngle <= OPEN_BRIDGE + 0.02 && gateOpen >= 0.98;
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
    if (want) {
      if (bridgeAngle > OPEN_BRIDGE && (bridgeAngle < -0.001 || !occupied)) bridgeAngle = Math.max(OPEN_BRIDGE, bridgeAngle - bridgeSpeed * ease * dt);
      if (bridgeAngle < -0.3) gateOpen = Math.min(1, gateOpen + gateSpeed * dt);
    } else {
      gateOpen = Math.max(0, gateOpen - gateSpeed * dt);
      if (gateOpen < 0.3) bridgeAngle = Math.min(0, bridgeAngle + bridgeSpeed * ease * dt);
    }
    bridge?.set(smooth(bridgeAngle / OPEN_BRIDGE));
    const g = smooth(gateOpen);
    for (const gt of gates) gt.obj.rotation.y = gt.closed + gt.dir * GATE_OPEN * g;

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
    gatesOpen: () => smooth(gateOpen),
    passNow(dir = "in") {
      start(dir);
    },
    group,
  };
}
