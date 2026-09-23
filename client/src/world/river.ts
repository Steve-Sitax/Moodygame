import * as THREE from "three";
import { addMovingSource, isSteam, loadBoats, newShipId, ropeMaterial, type BoatName, type Boats, type MovingShip } from "./boats";
import { Route, placeTrain, rng, trainLength, type TrainPart } from "./route";
import { createAnchorage, type Anchorage } from "./anchorage";

// Shipping on the Schelde, 1873: always something on the move. Big ships in the fairway (a
// barque under sail or towed by a tug, a screw steamer, a paddle steamer, a topsail schooner)
// and small craft (Scheldt sloops and hengsten under tanned sails, rowing boats, a tug with a
// string of lighters). They come out of the fog at one end of the river and go into it at the
// other, along lanes that keep clear of the moored rows, the ships at anchor, the Steen's
// bastion (x -218..-160, down to z -41) and the ferry pontoon (x -251..-247, z -58..0).
// At most `maxShips` trains move at once (default 8); boats are pooled and reused.
// Out beyond the fairway an ocean steamer lies at anchor, and two tows of lighters work her
// cargo to the Rijnkaai and back (world/anchorage.ts); the ships here give way to them.

export interface RiverOptions {
  /** Trains (a ship, or a tug and its tows) moving at once. Default 8. */
  maxShips?: number;
  seed?: number;
  /** Seconds between new arrivals, min and max. Default 16..40. */
  interval?: [number, number];
}

export interface River {
  update(t: number, dt: number): void;
  /** Trains now moving. */
  count(): number;
  group: THREE.Group;
}

/**
 * Lanes, as (x, z) points; x runs along the river, water at z < 0. The fairway lanes run the
 * whole map below the ships at anchor (z -84 up river, z -100 down river); the near lane
 * brings small craft up river close under the quays (z -36), leaving the fairway west of the
 * Rijnkaai where the ships at anchor and the Steen leave room.
 */
const LANES: Record<string, Array<[number, number]>> = {
  down: [[280, -100], [-430, -100]],
  up: [[-430, -84], [280, -84]],
  near: [[-430, -84], [-150, -84], [-116, -80], [-100, -56], [-84, -41], [-55, -36], [280, -36]],
};

type Kind = { parts: BoatName[]; speed: number; scale?: number };
/** What sails where, with weights. Speeds in m/s: slow, heavy, and in fog. */
const BIG: Array<[Kind, number]> = [
  [{ parts: ["tug", "barque"], speed: 1.7 }, 2],
  [{ parts: ["barque_sail"], speed: 2.4 }, 2],
  [{ parts: ["steamer"], speed: 3.4 }, 2],
  [{ parts: ["paddle_tug"], speed: 3.0, scale: 1.4 }, 1.5],
  [{ parts: ["schooner"], speed: 2.6 }, 1.5],
];
const SMALL: Array<[Kind, number]> = [
  [{ parts: ["sloop_sail"], speed: 2.2 }, 3],
  [{ parts: ["hengst_sail"], speed: 1.8 }, 2],
  [{ parts: ["rowboat"], speed: 1.1 }, 1.5],
  [{ parts: ["tug", "lighter_loaded", "lighter"], speed: 1.8 }, 2],
  [{ parts: ["schooner"], speed: 2.4 }, 1],
];
const GAP = 8; // hawser between a tug and its tow, and between tows

interface Mover {
  route: Route;
  lane: string;
  parts: TrainPart[];
  names: BoatName[];
  s: number;
  v: number;
  speed: number;
  len: number;
  beam: number;
  x: number;
  z: number;
  hx: number;
  hz: number;
  ship: MovingShip;
}

function pick<T>(r: () => number, table: Array<[T, number]>): T {
  let sum = 0;
  for (const [, w] of table) sum += w;
  let x = r() * sum;
  for (const [v, w] of table) if ((x -= w) <= 0) return v;
  return table[table.length - 1][0];
}

export function createRiver(scene: THREE.Object3D, boats?: Boats | Promise<Boats>, opts: RiverOptions = {}): River {
  const group = new THREE.Group();
  group.name = "river_traffic";
  scene.add(group);
  const r = rng(opts.seed ?? 1873);
  const maxShips = opts.maxShips ?? 8;
  const interval = opts.interval ?? [16, 40];
  const routes: Record<string, Route> = {};
  for (const [k, pts] of Object.entries(LANES)) routes[k] = new Route(pts);

  const movers: Mover[] = [];
  const pool = new Map<string, TrainPart[]>();
  let fleet: Boats | null = null;
  let anchorage: Anchorage | null = null;
  let wait = 3;

  // hawsers of all tows in one line set
  const hawser = new THREE.BufferAttribute(new Float32Array(maxShips * 4 * 2 * 3), 3);
  const hg = new THREE.BufferGeometry();
  hg.setAttribute("position", hawser);
  hg.setDrawRange(0, 0);
  const lines = new THREE.LineSegments(hg, ropeMaterial(0x2a2218));
  lines.frustumCulled = false;
  group.add(lines);

  function take(name: BoatName, scale = 1): TrainPart | null {
    if (!fleet) return null;
    const key = `${name}@${scale}`;
    const free = pool.get(key);
    const p = free?.pop();
    if (p) {
      p.obj.visible = true;
      return p;
    }
    const obj = fleet.place(name, 600, -400, 0, group);
    obj.scale.setScalar(scale);
    obj.userData.poolKey = key;
    return { obj, len: fleet.dims(name).length * scale };
  }
  function give(p: TrainPart): void {
    p.obj.visible = false;
    p.obj.position.set(600, p.obj.position.y, -400);
    const key = p.obj.userData.poolKey as string;
    let l = pool.get(key);
    if (!l) pool.set(key, (l = []));
    l.push(p);
  }

  function spawn(atStart: boolean): boolean {
    if (!fleet || movers.length >= maxShips) return false;
    const roll = r();
    const lane = roll < 0.4 ? "near" : roll < 0.7 ? "down" : "up";
    const kind = lane === "near" || r() < 0.45 ? pick(r, SMALL) : pick(r, BIG);
    const route = routes[lane];
    const parts: TrainPart[] = [];
    for (const n of kind.parts) {
      const p = take(n, kind.scale ?? 1);
      if (!p) return false;
      parts.push(p);
    }
    const len = trainLength(parts, GAP);
    // a new arrival waits till the start of its lane is clear; others start anywhere (at load)
    const s = atStart ? parts[0].len / 2 : len + r() * (route.length - len - 40);
    for (const m of movers) {
      if (m.route === route && Math.abs(m.s - s) < m.len + len + 30) {
        parts.forEach(give);
        return false;
      }
    }
    const beam = Math.max(...kind.parts.map((n) => fleet!.dims(n).beam)) * (kind.scale ?? 1);
    const lead = kind.parts[0];
    const ship: MovingShip = { id: newShipId(), kind: lead, x: 0, z: 0, heading: 0, speed: kind.speed, steam: isSteam(lead) };
    const m: Mover = { route, lane, parts, names: kind.parts, s, v: kind.speed, speed: kind.speed * (0.9 + r() * 0.2), len, beam, x: 0, z: 0, hx: 0, hz: 1, ship };
    movers.push(m);
    return true;
  }

  Promise.resolve(boats ?? loadBoats())
    .then((b) => {
      fleet = b;
      anchorage = createAnchorage(group, b, scene, opts.seed ?? 1873);
      // the river is never empty: a few ships already under way
      for (let i = 0, n = 0; i < 20 && n < Math.min(5, maxShips); i++) if (spawn(false)) n++;
    })
    .catch((e) => console.warn("no boats for the river", e));

  const pose = { x: 0, z: 0, yaw: 0 };
  function update(t: number, dt: number): void {
    if (!fleet) return;
    wait -= dt;
    if (wait <= 0) {
      spawn(true);
      wait = interval[0] + r() * (interval[1] - interval[0]);
    }
    // where each train's head is and which way it goes
    for (const m of movers) {
      m.route.pose(m.s, 1, pose);
      m.x = pose.x;
      m.z = pose.z;
      m.hx = Math.sin(pose.yaw);
      m.hz = Math.cos(pose.yaw);
      m.ship.x = pose.x;
      m.ship.z = pose.z;
      m.ship.heading = pose.yaw;
      m.ship.speed = m.v;
    }
    // keep station: never run into the stern of a slower ship ahead, on any lane
    for (const m of movers) {
      let v = m.speed;
      for (const o of movers) {
        if (o === m) continue;
        const dx = o.x - m.x;
        const dz = o.z - m.z;
        const along = dx * m.hx + dz * m.hz;
        const side = Math.abs(dx * m.hz - dz * m.hx);
        if (along <= 0 || side > (m.beam + o.beam) / 2 + 4) continue;
        const room = along - (m.parts[0].len / 2 + (o.len - o.parts[0].len / 2)) - 12;
        if (room < 40) v = Math.min(v, Math.max(0, o.v * THREE.MathUtils.clamp(room / 40, 0, 1)));
      }
      // the lighters' tows crossing the lanes (world/anchorage.ts): hold back till they are past
      for (const o of anchorage?.obstacles() ?? []) {
        const dx = o.x - m.x;
        const dz = o.z - m.z;
        const along = dx * m.hx + dz * m.hz;
        const side = Math.abs(dx * m.hz - dz * m.hx);
        if (along <= 0 || side > (m.beam + o.len) / 2 + 4) continue;
        const room = along - m.parts[0].len / 2 - o.beam / 2 - 12;
        const vAlong = Math.max(0, o.v * (Math.sin(o.yaw) * m.hx + Math.cos(o.yaw) * m.hz));
        if (room < 40) v = Math.min(v, Math.max(0, vAlong * THREE.MathUtils.clamp(room / 40, 0, 1)));
      }
      m.v += (v - m.v) * Math.min(1, dt * 0.5);
    }
    let at = 0;
    for (let i = movers.length - 1; i >= 0; i--) {
      const m = movers[i];
      m.s += m.v * dt;
      if (m.s - m.len > m.route.length) {
        m.parts.forEach(give);
        movers.splice(i, 1);
        continue;
      }
      at = placeTrain(m.route, m.s, 1, m.parts, GAP, hawser, at);
    }
    hg.setDrawRange(0, at);
    hawser.needsUpdate = true;
    anchorage?.update(t, dt, movers);
  }

  addMovingSource((out) => {
    for (const m of movers) out.push(m.ship);
  });
  return { update, count: () => movers.length, group };
}
