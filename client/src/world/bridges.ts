import * as THREE from "three";
import { addMovingSource, isSteam, loadBoats, loadModelSet, newShipId, ropeMaterial, signal, type BoatName, type Boats, type MovingShip } from "./boats";
import type { Lock, LockRect } from "./lock";
import type { Rect } from "./geom";
import { Route, placeTrain, rng, type TrainPart } from "./route";

// The opening bridges over the Canal des Brasseurs and the Sint-Pietersvliet (1873): iron
// swing bridges where the quay railway crosses (canal_mouth, vliet_mouth; the Brouwersvliet
// had one from 1864-65), timber lifting bridges with a balance on a gallows frame further in
// (canal_mid, canal_high: double; vliet_mid: single). Models: tools/blender/build_bridges.py
// -> /models/bridges.glb. Now and then a punt, a rowing boat or a lighter comes in from the
// river and goes up the canal or the vliet, or back out; each bridge opens as it comes and
// shuts behind it. No bridge starts to open while the player stands on it.
//
// One list for walkability: `list` holds every opening bridge (the lock bridge too, when you
// pass the lock): walk on a bridge's rect only while it is closed().

export interface OpeningBridge {
  key: string;
  kind: "swing" | "draw";
  rect: LockRect;
  /** True while the deck lies shut and can be walked on. */
  closed(): boolean;
  /** 0 = shut, 1 = fully open. */
  open(): number;
}

export interface BridgesOptions {
  /** The lock (world/lock.ts): its bridge joins the list. */
  lock?: Lock | null;
  /** Where the player stands (feet on the ground plan); a bridge never starts to open under him. */
  player?: () => { x: number; z: number } | null;
  /** For the swing bridges lying open on the quay, and the gallows posts. */
  world?: { addCollider(r: Rect): void; removeCollider(r: Rect): void };
  /** Seconds of game time between passages up the canal, min and max. Default 100..220. */
  canalInterval?: [number, number];
  /** The same for the vliet. Default 140..280. */
  vlietInterval?: [number, number];
  /** Boats that go up the canal. Default punts and rowing boats (the fairway between the moored rows is narrow). */
  canalKinds?: BoatName[];
  /** x of the canal fairway. Default -75.9, between the moored rows of rijnkaai.ts. */
  canalX?: number;
  vlietKinds?: BoatName[];
  seed?: number;
}

export interface Bridges {
  list: OpeningBridge[];
  update(t: number, dt: number, camera?: THREE.Camera): void;
  /** Send a boat up (or down, if one is up there) the canal or the vliet now (dev). */
  passNow(where: "canal" | "vliet"): void;
  group: THREE.Group;
}

type Leaf = [number, number, number, number]; // hinge x, hinge z, yaw (0: leaf toward +x), length

interface Def {
  key: string;
  kind: "swing" | "draw";
  rect: LockRect;
  model?: string;
  pivot?: [number, number];
  closedYaw?: number;
  openYaw?: number;
  /** Where a swing bridge lies when open (on the quay): kept clear while it is not shut. */
  openRect?: LockRect;
  leaves?: Leaf[];
}

const R = (minX: number, maxX: number, minZ: number, maxZ: number): LockRect => ({ minX, maxX, minZ, maxZ });

/** tools/city/design.py BRIDGES, with the way each one opens. */
const DEFS: Def[] = [
  {
    key: "canal_mouth",
    kind: "swing",
    rect: R(-84, -68, 2, 10),
    model: "swing_canal",
    pivot: [-86.5, 6],
    closedYaw: 0,
    openYaw: -Math.PI / 2, // swings north to lie along the west quay of the canal
    openRect: R(-90.7, -82.3, -0.2, 24.8),
  },
  {
    key: "vliet_mouth",
    kind: "swing",
    rect: R(-152, -140, 2, 9),
    model: "swing_vliet",
    pivot: [-137, 5.5],
    closedYaw: Math.PI,
    openYaw: 1.5 * Math.PI, // north, along the east quay of the vliet
    openRect: R(-140.7, -133.3, 0.3, 20.7),
  },
  { key: "canal_mid", kind: "draw", rect: R(-84, -68, 66, 73), leaves: [[-82, 69.5, 0, 6], [-70, 69.5, Math.PI, 6]] },
  { key: "canal_high", kind: "draw", rect: R(-84, -68, 150, 157), leaves: [[-82, 153.5, 0, 6], [-70, 153.5, Math.PI, 6]] },
  { key: "vliet_mid", kind: "draw", rect: R(-152, -140, 40, 47), leaves: [[-142, 43.5, Math.PI, 8]] },
];

const DRAW_MAX = 1.36; // a lifted leaf stands at 78 degrees
const PIVOT: [number, number] = [-1.2, 5.9]; // balance pivot from the hinge (back, up)

interface Ctl extends OpeningBridge {
  def: Def;
  amount: number;
  want: number;
  speed: number;
  swing?: THREE.Object3D;
  leaves: Array<{ leaf: THREE.Object3D; beam: THREE.Object3D; yaw: number; L: number }>;
  collider: Rect | null;
}

const smooth = (x: number) => {
  const k = THREE.MathUtils.clamp(x, 0, 1);
  return k * k * (3 - 2 * k);
};

export function createBridges(scene: THREE.Object3D, boats?: Boats | Promise<Boats>, opts: BridgesOptions = {}): Bridges {
  const group = new THREE.Group();
  group.name = "opening_bridges";
  scene.add(group);
  const r = rng(opts.seed ?? 1865);

  const ctls: Ctl[] = DEFS.map((def) => {
    const c: Ctl = {
      key: def.key,
      kind: def.kind,
      rect: def.rect,
      def,
      amount: 0,
      want: 0,
      speed: def.kind === "swing" ? 1 / 26 : 1 / 20,
      leaves: [],
      collider: null,
      closed: () => c.amount <= 1e-4,
      open: () => smooth(c.amount),
    };
    return c;
  });
  const list: OpeningBridge[] = ctls.map((c) => ({ key: c.key, kind: c.kind, rect: c.rect, closed: c.closed, open: c.open }));
  if (opts.lock) {
    const lock = opts.lock;
    list.push({ key: "lock_bridge", kind: "swing", rect: lock.bridgeRect, closed: () => lock.bridgeClosed(), open: () => (lock.bridgeClosed() ? 0 : 1) });
  }

  // --- chains of the lifting bridges: two per leaf, from the balance to the leaf's nose
  const chainPos = new THREE.BufferAttribute(new Float32Array(2 * 2 * 3 * 5 * 3), 3);
  const chainGeo = new THREE.BufferGeometry();
  chainGeo.setAttribute("position", chainPos);
  chainGeo.setDrawRange(0, 0);
  const chains = new THREE.LineSegments(chainGeo, ropeMaterial());
  chains.frustumCulled = false;
  group.add(chains);

  const at = (hx: number, hz: number, yaw: number, lx: number, lz: number): [number, number] => [
    hx + lx * Math.cos(yaw) + lz * Math.sin(yaw),
    hz - lx * Math.sin(yaw) + lz * Math.cos(yaw),
  ];

  loadModelSet("/models/bridges.glb")
    .then((set) => {
      const get = (n: string) => set.protos.get(n)?.clone();
      for (const c of ctls) {
        const d = c.def;
        if (d.kind === "swing" && d.pivot) {
          const b = get(d.model!);
          const pier = get("swing_pier");
          if (b) {
            b.position.set(d.pivot[0], 0, d.pivot[1]);
            b.rotation.y = d.closedYaw ?? 0;
            group.add(b);
            c.swing = b;
          }
          if (pier) {
            pier.position.set(d.pivot[0], 0, d.pivot[1]);
            pier.rotation.y = d.closedYaw ?? 0;
            group.add(pier);
            const [cx, cz] = at(d.pivot[0], d.pivot[1], d.closedYaw ?? 0, -2.2, -5.1);
            opts.world?.addCollider({ minX: cx - 0.5, maxX: cx + 0.5, minZ: cz - 0.5, maxZ: cz + 0.5 });
          }
        } else if (d.leaves) {
          for (const [hx, hz, yaw, L] of d.leaves) {
            const leaf = get(L > 7 ? "draw_leaf_8" : "draw_leaf_6");
            const beam = get(L > 7 ? "draw_beam_8" : "draw_beam_6");
            const frame = get("draw_frame");
            if (!leaf || !beam || !frame) continue;
            leaf.position.set(hx, 0, hz);
            leaf.rotation.set(0, yaw, 0, "YZX");
            const [bx, bz] = at(hx, hz, yaw, PIVOT[0], 0);
            beam.position.set(bx, PIVOT[1], bz);
            beam.rotation.set(0, yaw, 0, "YZX");
            frame.position.set(hx, 0, hz);
            frame.rotation.y = yaw;
            group.add(leaf, beam, frame);
            c.leaves.push({ leaf, beam, yaw, L });
            // the gallows posts stand on the quay: walk round them
            for (const side of [-1, 1]) {
              const [px, pz] = at(hx, hz, yaw, PIVOT[0], side * 3.95);
              opts.world?.addCollider({ minX: px - 0.25, maxX: px + 0.25, minZ: pz - 0.25, maxZ: pz + 0.25 });
            }
          }
        }
      }
      chainGeo.setDrawRange(0, ctls.reduce((a, c) => a + c.leaves.length * 4, 0));
    })
    .catch((e) => console.warn("bridges.glb did not load", e));

  // --- passages: a boat from the river up the canal or the vliet, and later back out
  const canalX = opts.canalX ?? -75.9;
  const routes = {
    // from the harbour lane off the quays (z -21, out of the fog to the east) into the canal,
    // under all three bridges, to the head of the canal
    canal: new Route([
      [250, -21], [60, -21], [-40, -21], [-62, -19], [canalX, -8], [canalX, 4], [canalX, 40], [canalX, 110], [canalX, 175],
      [canalX, 196],
    ]),
    // the same lane, then north up the vliet between its moored punts
    vliet: new Route([[250, -21], [40, -21], [-100, -21], [-132, -19], [-146, -8], [-146, 4], [-146, 30], [-147, 52], [-147, 62]]),
  };
  interface Passage {
    route: Route;
    kinds: BoatName[];
    interval: [number, number];
    gates: Array<{ ctl: Ctl; span: [number, number] }>;
    /** Bridges this boat has asked to open (and not yet let shut). */
    asked: Set<string>;
    /** The boat under way, for Boats.moving(). */
    ship: MovingShip;
    v: number;
    boats: Map<BoatName, TrainPart>;
    part: TrainPart | null;
    state: "river" | "in" | "up" | "out";
    s: number;
    wait: number;
    speed: number;
  }
  const passages: Record<"canal" | "vliet", Passage> = {
    canal: {
      route: routes.canal,
      kinds: opts.canalKinds ?? ["punt", "rowboat", "punt"],
      interval: opts.canalInterval ?? [100, 220],
      gates: [],
      asked: new Set(),
      ship: { id: 0, kind: "punt", x: 0, z: 0, heading: 0, speed: 0, steam: false },
      v: 0,
      boats: new Map(),
      part: null,
      state: "river",
      s: 0,
      wait: 20 + r() * 60,
      speed: 1,
    },
    vliet: {
      route: routes.vliet,
      kinds: opts.vlietKinds ?? ["punt", "rowboat"],
      interval: opts.vlietInterval ?? [140, 280],
      gates: [],
      asked: new Set(),
      ship: { id: 0, kind: "punt", x: 0, z: 0, heading: 0, speed: 0, steam: false },
      v: 0,
      boats: new Map(),
      part: null,
      state: "river",
      s: 0,
      wait: 70 + r() * 80,
      speed: 1,
    },
  };
  for (const [name, p] of Object.entries(passages)) {
    for (const c of ctls) {
      if (!c.key.startsWith(name)) continue;
      const sp = p.route.span(c.rect, 1.5);
      if (sp) p.gates.push({ ctl: c, span: sp });
    }
  }
  let fleet: Boats | null = null;
  Promise.resolve(boats ?? loadBoats())
    .then((b) => {
      fleet = b;
    })
    .catch((e) => console.warn("no boats for the canal", e));

  const SPEED: Partial<Record<BoatName, number>> = { punt: 0.8, rowboat: 1.1, lighter: 0.7, lighter_loaded: 0.6, hengst: 0.8 };
  function boatFor(p: Passage, kind: BoatName): TrainPart | null {
    if (!fleet) return null;
    let b = p.boats.get(kind);
    if (!b) {
      const obj = fleet.place(kind, 400, -200, 0, group);
      b = { obj, len: fleet.dims(kind).length };
      p.boats.set(kind, b);
    }
    return b;
  }

  function start(p: Passage, dir: "in" | "out"): void {
    if (p.state === "in" || p.state === "out") return;
    if (dir === "in") {
      if (p.state !== "river") return;
      for (const b of p.boats.values()) b.obj.visible = false;
      const kind = p.kinds[Math.floor(r() * p.kinds.length)];
      p.part = boatFor(p, kind);
      if (!p.part) return;
      p.part.obj.visible = true;
      p.speed = SPEED[kind] ?? 0.9;
      p.s = 0;
      p.ship.kind = kind;
      p.ship.steam = isSteam(kind);
    } else {
      if (p.state !== "up" || !p.part) return;
      p.s = p.route.length;
    }
    p.state = dir;
    p.ship.id = newShipId();
  }

  function movePassage(p: Passage, dt: number, camera?: THREE.Camera): void {
    if (!p.part) {
      p.wait -= dt;
      if (p.wait <= 0) start(p, "in");
      return;
    }
    const obj = p.part.obj;
    if (p.state === "river" || p.state === "up") {
      p.wait -= dt;
      // a boat that went up turns round at the head of the water: only while nobody is close
      const head = p.route.curve.points[p.route.curve.points.length - 1];
      const seen = p.state === "up" && camera && camera.position.distanceTo(new THREE.Vector3(head.x, camera.position.y, head.z)) < 35;
      if (p.wait <= 0 && !seen) start(p, p.state === "river" ? "in" : "out");
      if (p.state === "river" || p.state === "up") {
        placeTrain(p.route, p.state === "river" ? 0 : p.route.length, 1, [p.part], 0);
        if (p.state === "river") obj.visible = false;
        return;
      }
    }
    const dir = p.state === "in" ? 1 : -1;
    const half = p.part.len / 2;
    const bow = p.s + dir * half;
    const stern = p.s - dir * half;
    let v = p.speed;
    for (const g of p.gates) {
      const [a, b] = g.span;
      const ahead = dir > 0 ? a - bow : bow - b; // distance from the bow to this bridge
      const behind = dir > 0 ? stern > b + 2 : stern < a - 2; // the stern is clear of it
      const need = ahead < 45 && !behind;
      // each boat asks each bridge once; the bridge opens while anyone asks
      const asked = p.asked.has(g.ctl.key);
      if (need && !asked) {
        g.ctl.want++;
        p.asked.add(g.ctl.key);
        signal(p.ship, "bridge"); // a hail or a horn to ask for the bridge
      } else if (!need && asked) {
        g.ctl.want = Math.max(0, g.ctl.want - 1);
        p.asked.delete(g.ctl.key);
      }
      if (need && ahead > -1 && g.ctl.open() < 0.97) v = Math.min(v, THREE.MathUtils.clamp((ahead - 4) * 0.25, 0, p.speed));
    }
    const fromEnd = Math.min(p.s, p.route.length - p.s);
    v *= THREE.MathUtils.clamp(0.3 + fromEnd / 15, 0.3, 1);
    p.s = THREE.MathUtils.clamp(p.s + dir * v * dt, 0, p.route.length);
    placeTrain(p.route, p.s, dir, [p.part], 0);
    p.v = v;
    p.ship.x = obj.position.x;
    p.ship.z = obj.position.z;
    p.ship.heading = obj.rotation.y;
    p.ship.speed = v;
    if ((dir > 0 && p.s >= p.route.length) || (dir < 0 && p.s <= 0)) {
      p.state = dir > 0 ? "up" : "river";
      p.wait = p.interval[0] + r() * (p.interval[1] - p.interval[0]);
    }
  }

  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  function update(_t: number, dt: number, camera?: THREE.Camera): void {
    const pl = opts.player?.() ?? null;
    let ci = 0;
    for (const c of ctls) {
      const occupied = !!pl && pl.x > c.rect.minX && pl.x < c.rect.maxX && pl.z > c.rect.minZ && pl.z < c.rect.maxZ;
      const ease = 0.25 + 0.75 * Math.sin(Math.PI * THREE.MathUtils.clamp(c.amount, 0, 1));
      if (c.want > 0) {
        if (c.amount > 0 || !occupied) c.amount = Math.min(1, c.amount + c.speed * ease * dt);
      } else c.amount = Math.max(0, c.amount - c.speed * ease * dt);
      const d = c.def;
      if (c.swing) c.swing.rotation.y = (d.closedYaw ?? 0) + ((d.openYaw ?? 0) - (d.closedYaw ?? 0)) * smooth(c.amount);
      for (const lf of c.leaves) {
        const a = DRAW_MAX * smooth(c.amount);
        lf.leaf.rotation.set(0, lf.yaw, a, "YZX");
        lf.beam.rotation.set(0, lf.yaw, a, "YZX");
        lf.leaf.updateMatrixWorld();
        lf.beam.updateMatrixWorld();
        for (const side of [-1, 1]) {
          tmpA.set(lf.L, 0, side * 3.55).applyMatrix4(lf.beam.matrixWorld);
          tmpB.set(lf.L - 0.3, 0.1, side * 3.52).applyMatrix4(lf.leaf.matrixWorld);
          chainPos.setXYZ(ci++, tmpA.x, tmpA.y - 0.15, tmpA.z);
          chainPos.setXYZ(ci++, tmpB.x, tmpB.y, tmpB.z);
        }
      }
      // a swing bridge lying open on the quay is in the way
      if (d.openRect && opts.world) {
        const open = c.amount > 0.02;
        if (open && !c.collider) {
          c.collider = { ...d.openRect };
          opts.world.addCollider(c.collider);
        } else if (!open && c.collider) {
          opts.world.removeCollider(c.collider);
          c.collider = null;
        }
      }
    }
    chainPos.needsUpdate = true;
    movePassage(passages.canal, dt, camera);
    movePassage(passages.vliet, dt, camera);
  }

  addMovingSource((out) => {
    for (const p of Object.values(passages)) if (p.part && (p.state === "in" || p.state === "out")) out.push(p.ship);
  });

  return {
    list,
    update,
    passNow(where) {
      const p = passages[where];
      if (p.state === "up") start(p, "out");
      else {
        if (!p.part) p.wait = 0;
        start(p, "in");
      }
    },
    group,
  };
}
