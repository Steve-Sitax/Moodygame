import * as THREE from "three";
import { addMovingSource, isSteam, loadBoats, loadModelSet, newShipId, ropeMaterial, signal, type BoatName, type Boats, type ModelSet, type MovingShip } from "./boats";
import type { Lock, LockRect } from "./lock";
import type { Rect } from "./geom";
import { Route, placeTrain, rng, type TrainPart } from "./route";
import type { NetMover } from "../net/mp/world";

// The opening bridges over the Canal des Brasseurs and the Sint-Pietersvliet (1873): timber
// lifting bridges with a balance on a gallows frame (the "hamei"). Their leaves rise in place,
// so nothing sweeps over the quay, its coping or its railings (a swing bridge would); the ones
// the quay railway crosses (canal_mouth, vliet_mouth, and the lock bridge in world/lock.ts)
// carry its rails on the leaves and on the fixed decks, flush with the quay. Double leaves over
// the 12 m canal, one leaf over the 8 m vliet. Models: tools/blender/build_bridges.py
// -> /models/bridges.glb. Now and then a punt, a rowing boat or a lighter comes in from the
// river and goes up the canal or the vliet, or back out; each bridge opens as it comes and
// shuts behind it. No bridge starts to open while the player stands on it.
//
// One list for walkability: `list` holds every opening bridge (the lock bridge too, when you
// pass the lock): walk on a bridge's rect only while it is closed().
//
// M8b: played together, the world PC runs the bridges and the passages; the others take its state
// (netApply: the leaves, the boats, and the hail as a boat asks for a bridge).

export interface OpeningBridge {
  key: string;
  kind: "swing" | "draw";
  rect: LockRect;
  /** True while the deck lies shut and can be walked on. */
  closed(): boolean;
  /** 0 = shut, 1 = fully open. */
  open(): number;
  /** Wants to open or is not yet shut again: people wait at the ends and do not step on. */
  opening(): boolean;
}

export interface BridgesOptions {
  /** The lock (world/lock.ts): its bridge joins the list. */
  lock?: Lock | null;
  /** Where the player stands (feet on the ground plan); a bridge never starts to open under him. */
  player?: () => { x: number; z: number } | null;
  /** Something else on (or at) a bridge's deck: the goods train, the omnibus (M3g). It does not open under them. */
  busy?: (rect: LockRect) => boolean;
  /** Colliders for the gallows posts on the quay. */
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

export interface Bridges extends NetMover<BridgesNet> {
  list: OpeningBridge[];
  update(t: number, dt: number, camera?: THREE.Camera): void;
  /** Send a boat up (or down, if one is up there) the canal or the vliet now (dev). */
  passNow(where: "canal" | "vliet"): void;
  group: THREE.Group;
  /**
   * M3j: a rowing boat that does not fit under a bridge asks it to open (`on`), or lets it go.
   * The bridge opens by the same rules as for the canal boats (never while anyone is on its
   * deck: the boat waits) and stays open while anyone asks. `who` names the asker.
   */
  request(key: string, who: string, on: boolean): void;
  /** M3j: world height of the underside of the bridge over (x, z) as it stands now, or null if none is over it. */
  undersideAt(x: number, z: number): number | null;
}

/**
 * M8b: the bridges as the world PC sends them. Per bridge (in DEFS order): how far open, and (not
 * eased) the passages asking and the rowing boats asking there. Per passage: where it is (index in
 * PASSAGE_STATES), the boat's kind, its place and speed, the wait, the bridges it has asked (bits
 * in DEFS order).
 */
export interface BridgesNet {
  am: number[];
  _w: number[];
  _r: number[];
  p: Record<"canal" | "vliet", { _st: number; _k: string; s: number; v: number; sp: number; w: number; _a: number }>;
}
const PASSAGE_STATES = ["river", "in", "up", "out"] as const;
const q3 = (x: number) => Math.round(x * 1000) / 1000;

/** The underside of a leaf below its deck top (bridges.glb: stringers and cross beams, measured 0.42 m). */
export const DECK_UNDER = 0.42;

/**
 * Height of a lifting leaf's underside over a point, or null if the leaf is not over it.
 * `amount` 0 (down) .. 1 (lifted to DRAW_MAX). The leaf turns about its hinge at the quay edge.
 */
export function leafUnderside(l: DrawLeaf, amount: number, x: number, z: number): number | null {
  const dx = x - l.hinge[0];
  const dz = z - l.hinge[1];
  const lx = dx * Math.cos(l.yaw) - dz * Math.sin(l.yaw);
  const lz = dx * Math.sin(l.yaw) + dz * Math.cos(l.yaw);
  if (Math.abs(lz) > l.half || lx < 0) return null;
  const a = DRAW_MAX * amount;
  if (lx > l.L * Math.cos(a) + DECK_UNDER * Math.sin(a)) return null;
  return lx * Math.tan(a) - DECK_UNDER / Math.cos(a);
}

/** One leaf of a lifting bridge: where it hinges, which way it points, its models. */
export interface DrawLeaf {
  /** Hinge at the channel edge (x, z); the leaf points along yaw (0 = toward +x) over the water. */
  hinge: [number, number];
  yaw: number;
  /** Leaf length and half width (m). */
  L: number;
  half: number;
  leaf: string;
  beam: string;
  frame: string;
}

interface Def {
  key: string;
  kind: "swing" | "draw";
  rect: LockRect;
  leaves: DrawLeaf[];
  /** Fixed decks without gallows (the far side of a single leaf): model, x, z, yaw. */
  decks?: Array<[string, number, number, number]>;
}

const R = (minX: number, maxX: number, minZ: number, maxZ: number): LockRect => ({ minX, maxX, minZ, maxZ });
const leaf = (hx: number, hz: number, yaw: number, L: number, half: number, lf: string, bm: string, fr: string): DrawLeaf => ({
  hinge: [hx, hz],
  yaw,
  L,
  half,
  leaf: lf,
  beam: bm,
  frame: fr,
});

/** tools/city/design.py BRIDGES, with their leaves. The rails of the quay railway (z 4.0) are
 * built into the canal_mouth and vliet_mouth models. */
const DEFS: Def[] = [
  {
    key: "canal_mouth",
    kind: "draw",
    rect: R(-84, -68, 2, 10),
    leaves: [
      leaf(-82, 6, 0, 6, 4, "draw_leaf_cm_w", "draw_beam_6w", "draw_frame_cm_w"),
      leaf(-70, 6, Math.PI, 6, 4, "draw_leaf_cm_e", "draw_beam_6w", "draw_frame_cm_e"),
    ],
  },
  {
    key: "vliet_mouth",
    kind: "draw",
    rect: R(-152, -140, 2, 9),
    leaves: [leaf(-142, 5.5, Math.PI, 8, 3.5, "draw_leaf_vm", "draw_beam_8", "draw_frame_vm")],
    decks: [["deck_vm_w", -150, 5.5, 0]],
  },
  {
    key: "canal_mid",
    kind: "draw",
    rect: R(-84, -68, 66, 73),
    leaves: [
      leaf(-82, 69.5, 0, 6, 3.5, "draw_leaf_6", "draw_beam_6", "draw_frame"),
      leaf(-70, 69.5, Math.PI, 6, 3.5, "draw_leaf_6", "draw_beam_6", "draw_frame"),
    ],
  },
  {
    key: "canal_high",
    kind: "draw",
    rect: R(-84, -68, 150, 157),
    leaves: [
      leaf(-82, 153.5, 0, 6, 3.5, "draw_leaf_6", "draw_beam_6", "draw_frame"),
      leaf(-70, 153.5, Math.PI, 6, 3.5, "draw_leaf_6", "draw_beam_6", "draw_frame"),
    ],
  },
  { key: "vliet_mid", kind: "draw", rect: R(-152, -140, 40, 47), leaves: [leaf(-142, 43.5, Math.PI, 8, 3.5, "draw_leaf_8", "draw_beam_8", "draw_frame")] },
];

const DRAW_MAX = 1.36; // a lifted leaf stands at 78 degrees
const PIVOT: [number, number] = [-1.2, 5.9]; // balance pivot from the hinge (back, up)

export interface DrawBridge {
  /** Lift the leaves: 0 = down (walkable), 1 = up at 78 degrees. */
  set(amount: number): void;
}

/**
 * Build a lifting bridge from bridges.glb models: for each leaf the leaf, its balance and its
 * gallows with the fixed deck; chains from the balance to the leaf's nose. The gallows posts
 * become colliders. Used by createBridges and by world/lock.ts.
 */
export function createDrawBridge(
  set: ModelSet,
  parent: THREE.Object3D,
  leaves: DrawLeaf[],
  decks: Array<[string, number, number, number]> = [],
  world?: { addCollider(r: Rect): void },
): DrawBridge {
  const at = (hx: number, hz: number, yaw: number, lx: number, lz: number): [number, number] => [
    hx + lx * Math.cos(yaw) + lz * Math.sin(yaw),
    hz - lx * Math.sin(yaw) + lz * Math.cos(yaw),
  ];
  const parts: Array<{ spec: DrawLeaf; leaf: THREE.Object3D; beam: THREE.Object3D }> = [];
  for (const spec of leaves) {
    const lf = set.protos.get(spec.leaf)?.clone();
    const bm = set.protos.get(spec.beam)?.clone();
    const fr = set.protos.get(spec.frame)?.clone();
    if (!lf || !bm || !fr) continue;
    const [hx, hz] = spec.hinge;
    lf.position.set(hx, 0, hz);
    lf.rotation.set(0, spec.yaw, 0, "YZX");
    const [bx, bz] = at(hx, hz, spec.yaw, PIVOT[0], 0);
    bm.position.set(bx, PIVOT[1], bz);
    bm.rotation.set(0, spec.yaw, 0, "YZX");
    fr.position.set(hx, 0, hz);
    fr.rotation.y = spec.yaw;
    parent.add(lf, bm, fr);
    parts.push({ spec, leaf: lf, beam: bm });
    for (const side of [-1, 1]) {
      const [px, pz] = at(hx, hz, spec.yaw, PIVOT[0], side * (spec.half + 0.45));
      world?.addCollider({ minX: px - 0.25, maxX: px + 0.25, minZ: pz - 0.25, maxZ: pz + 0.25 });
    }
  }
  for (const [name, x, z, yaw] of decks) {
    const d = set.protos.get(name)?.clone();
    if (!d) continue;
    d.position.set(x, 0, z);
    d.rotation.y = yaw;
    parent.add(d);
  }
  const pos = new THREE.BufferAttribute(new Float32Array(Math.max(1, parts.length) * 4 * 3), 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", pos);
  const chains = new THREE.LineSegments(geo, ropeMaterial());
  chains.frustumCulled = false;
  parent.add(chains);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  function lift(amount: number): void {
    const ang = DRAW_MAX * amount;
    let i = 0;
    for (const p of parts) {
      p.leaf.rotation.set(0, p.spec.yaw, ang, "YZX");
      p.beam.rotation.set(0, p.spec.yaw, ang, "YZX");
      p.leaf.updateMatrixWorld();
      p.beam.updateMatrixWorld();
      for (const side of [-1, 1]) {
        a.set(p.spec.L, 0, side * (p.spec.half + 0.05)).applyMatrix4(p.beam.matrixWorld);
        b.set(p.spec.L - 0.3, 0.1, side * (p.spec.half + 0.02)).applyMatrix4(p.leaf.matrixWorld);
        pos.setXYZ(i++, a.x, a.y - 0.15, a.z);
        pos.setXYZ(i++, b.x, b.y, b.z);
      }
    }
    pos.needsUpdate = true;
  }
  lift(0);
  return { set: lift };
}

interface Ctl extends OpeningBridge {
  def: Def;
  /** M3j: rowing boats asking it to open. */
  boats: Set<string>;
  /** M8b: rowing boats asking it on the world PC (while run by another PC). */
  far: number;
  amount: number;
  want: number;
  speed: number;
  draw: DrawBridge | null;
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
      boats: new Set(),
      far: 0,
      speed: 1 / 20,
      draw: null,
      closed: () => c.amount <= 1e-4,
      open: () => smooth(c.amount),
      opening: () => c.want + c.boats.size + c.far > 0 || c.amount > 1e-4,
    };
    return c;
  });
  const list: OpeningBridge[] = ctls.map((c) => ({ key: c.key, kind: c.kind, rect: c.rect, closed: c.closed, open: c.open, opening: c.opening }));
  if (opts.lock) {
    const lock = opts.lock;
    list.push({ key: "lock_bridge", kind: "draw", rect: lock.bridgeRect, closed: () => lock.bridgeClosed(), open: () => (lock.bridgeClosed() ? 0 : 1), opening: () => !lock.bridgeClosed() });
  }

  loadModelSet("/models/bridges.glb")
    .then((set) => {
      for (const c of ctls) c.draw = createDrawBridge(set, group, c.def.leaves, c.def.decks, opts.world);
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

  /** A passage's boat where it is now (river: hidden at the start; up: at the head of the water). */
  function placePassage(p: Passage): void {
    if (!p.part) return;
    const obj = p.part.obj;
    if (p.state === "river" || p.state === "up") {
      placeTrain(p.route, p.state === "river" ? 0 : p.route.length, 1, [p.part], 0);
      obj.visible = p.state === "up";
      return;
    }
    obj.visible = true;
    placeTrain(p.route, p.s, p.state === "in" ? 1 : -1, [p.part], 0);
    p.ship.x = obj.position.x;
    p.ship.z = obj.position.z;
    p.ship.heading = obj.rotation.y;
    p.ship.speed = p.v;
  }

  let remote = false;
  /** M8b: the first state after the world went to another PC sounds nothing (no edges to go by yet). */
  let fresh = true;
  function netApply(st: BridgesNet): void {
    ctls.forEach((c, i) => {
      c.amount = THREE.MathUtils.clamp(st.am[i] ?? 0, 0, 1);
      c.want = st._w[i] ?? 0;
      c.far = st._r[i] ?? 0;
      c.draw?.set(smooth(c.amount));
    });
    for (const key of ["canal", "vliet"] as const) {
      const p = passages[key];
      const x = st.p[key];
      if (!x) continue;
      const was = p.state;
      const state = PASSAGE_STATES[x._st] ?? "river";
      if (x._k && fleet && (!p.part || p.ship.kind !== x._k)) {
        for (const b of p.boats.values()) b.obj.visible = false;
        p.part = boatFor(p, x._k as BoatName);
        p.ship.kind = x._k as BoatName;
        p.ship.steam = isSteam(p.ship.kind);
      }
      // a new passage (in from the river, or out from the head of the water): a new ship for the sound
      if ((state === "in" || state === "out") && state !== was) p.ship.id = newShipId();
      p.state = state;
      p.s = x.s;
      p.v = x.v;
      p.speed = x.sp;
      p.wait = x.w;
      // the bridges it asks for now: a hail or a horn for each new one
      ctls.forEach((c, i) => {
        const on = (x._a & (1 << i)) !== 0;
        if (on && !p.asked.has(c.key)) {
          p.asked.add(c.key);
          if (!fresh) signal(p.ship, "bridge");
        } else if (!on) p.asked.delete(c.key);
      });
      placePassage(p);
    }
    fresh = false;
  }

  function update(_t: number, dt: number, camera?: THREE.Camera): void {
    // M8b: run by another PC: netApply moves the leaves and the boats
    if (remote) return;
    const pl = opts.player?.() ?? null;
    for (const c of ctls) {
      const occupied = (!!pl && pl.x > c.rect.minX && pl.x < c.rect.maxX && pl.z > c.rect.minZ && pl.z < c.rect.maxZ) || !!opts.busy?.(c.rect);
      const ease = 0.25 + 0.75 * Math.sin(Math.PI * THREE.MathUtils.clamp(c.amount, 0, 1));
      if (c.want + c.boats.size > 0) {
        if (c.amount > 0 || !occupied) c.amount = Math.min(1, c.amount + c.speed * ease * dt);
      } else c.amount = Math.max(0, c.amount - c.speed * ease * dt);
      c.draw?.set(smooth(c.amount));
    }
    movePassage(passages.canal, dt, camera);
    movePassage(passages.vliet, dt, camera);
  }

  addMovingSource((out) => {
    for (const p of Object.values(passages)) if (p.part && (p.state === "in" || p.state === "out")) out.push(p.ship);
  });

  const netPassage = (p: Passage) => {
    let a = 0;
    ctls.forEach((c, i) => {
      if (p.asked.has(c.key)) a |= 1 << i;
    });
    return { _st: PASSAGE_STATES.indexOf(p.state), _k: p.part ? p.ship.kind : "", s: q3(p.s), v: q3(p.v), sp: q3(p.speed), w: q3(p.wait), _a: a };
  };

  return {
    list,
    update,
    get netRemote() {
      return remote;
    },
    set netRemote(on: boolean) {
      if (on === remote) return;
      remote = on;
      fresh = true;
      // back to running here: the other PC's rowing boats no longer ask (this PC's own still do)
      if (!on) for (const c of ctls) c.far = 0;
    },
    netState: () => ({
      am: ctls.map((c) => q3(c.amount)),
      _w: ctls.map((c) => c.want),
      _r: ctls.map((c) => c.boats.size),
      p: { canal: netPassage(passages.canal), vliet: netPassage(passages.vliet) },
    }),
    netApply,
    passNow(where) {
      const p = passages[where];
      if (p.state === "up") start(p, "out");
      else {
        if (!p.part) p.wait = 0;
        start(p, "in");
      }
    },
    group,
    request(key, who, on) {
      const c = ctls.find((q) => q.key === key);
      if (c) {
        if (on) c.boats.add(who);
        else c.boats.delete(who);
      } else if (key === "lock_bridge") opts.lock?.request?.(on);
    },
    undersideAt(x, z) {
      let best: number | null = null;
      const take = (y: number | null) => {
        if (y !== null && (best === null || y < best)) best = y;
      };
      for (const c of ctls) {
        const r = c.rect;
        if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
        for (const l of c.def.leaves) take(leafUnderside(l, smooth(c.amount), x, z));
      }
      const lk = opts.lock;
      if (lk) {
        const r = lk.bridgeRect;
        if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) {
          const mid = (r.minZ + r.maxZ) / 2;
          const L = (r.maxX - r.minX - 4) / 2;
          const amt = lk.lift?.() ?? (lk.bridgeClosed() ? 0 : 1);
          take(leafUnderside({ hinge: [r.minX + 2, mid], yaw: 0, L, half: 3.5, leaf: "", beam: "", frame: "" }, amt, x, z));
          take(leafUnderside({ hinge: [r.maxX - 2, mid], yaw: Math.PI, L, half: 3.5, leaf: "", beam: "", frame: "" }, amt, x, z));
        }
      }
      return best;
    },
  };
}
