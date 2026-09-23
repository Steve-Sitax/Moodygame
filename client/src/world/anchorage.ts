import * as THREE from "three";
import { addMovingSource, newShipId, ropeMaterial, type BoatName, type Boats, type MovingShip } from "./boats";
import { water } from "./tide";
import { rng, type TrainPart } from "./route";

// The ocean steamer at anchor in the Schelde, and the lighters that work her cargo (2026-09-24).
//
// In 1873 the big ships mostly lay at anchor in the stream; lighters carried their cargo to the
// quays. In January of that year the Red Star Line began its Antwerp - Philadelphia service with
// the Vaderland and the Nederland, iron screw steamers of about 97 m. Our ship is one like them,
// with a name of our own (the "liner" in boats.glb, KEMPENLAND, tools/blender/build_boats.py).
//
// She rides to her port anchor well out beyond the fairway (lanes at z -84 and -100, river.ts),
// her bow up river (toward -x, lying to the ebb), and sheers a few degrees about her hawse with
// wind and tide. (A full swing at the turn of the tide would sweep a circle of some 130 m: the
// river is too narrow for that clear of the fairway, so she keeps her heading.)
//
// Two tugs each work a loaded lighter "on the hip" (lashed alongside, as harbour tugs did), round
// a fixed loop: alongside her on the town side under her derrick, then in to a berth on the
// Rijnkaai between the timber jetty (x 5..9) and the ladder at x 42, and back. At the quay the tug
// stops on the loop 10 m off the wall and walks the lighter in sideways against it, and out again.
// Before they cross a lane they wait until no ship on it will be over their crossing while they
// are in it; they stop for rowing boats in their way and keep off each other. The ships on the
// lanes give way to a tow that reaches into their way (river.ts reads obstacles()).
//
// World frame: x along the river (down river = +x), water at z < 0, the quay line at z 0.

/** The liner's middle at rest, and her heading (bow toward -x). */
const LINER = { x: 0, z: -140, yaw: -Math.PI / 2 };
/** Sheer about the hawse: two slow waves, radians and seconds. */
const SHEER: Array<[number, number, number]> = [
  [0.075, 190, 0.7],
  [0.03, 71, 2.1],
];

/**
 * The loop, (x, z) points in order: the line the lighter's middle follows (the tug lies on its
 * other side). A: alongside the liner, heading +x. It leaves past her stern, crosses both fairway
 * lanes and the near lane at x 74..76 heading up to the town, turns in before the moored row at
 * x 62 and runs along the Rijnkaai 13 m off the wall to Q (lighter at x 28), where it goes in to
 * the wall and out. On past the jetty head (z -12) with 5 m to spare, down across the near lane at
 * x 5 (east of the barque outside the Anna Maria), south-west past the barque at anchor at (-40, -48)
 * and across the fairway at x -30..-45, round ahead of the liner's bow and back to A.
 */
const LOOP: Array<[number, number]> = [
  [-25, -128.8],
  [-5, -130.8],
  [14, -130.8],
  [33, -130.8],
  [52, -129.5],
  [67, -122],
  [74.5, -107],
  [76, -80],
  [76, -50],
  [74.5, -33],
  [70, -22],
  [62, -15],
  [52, -13],
  [40, -13],
  [35, -13],
  [28, -13],
  [21, -13],
  [14.5, -17],
  [10.5, -23.5],
  [6.5, -31],
  [5.5, -38],
  [4.5, -46],
  [-1, -57],
  [-12, -67],
  [-26, -82],
  [-40, -98],
  [-52, -111],
  [-62, -119],
  [-60, -126],
  [-46, -128.5],
];
const STOP_A: [number, number] = [14, -130.8];
const STOP_Q: [number, number] = [28, -13];
/** At Q the lighter goes this far sideways, from the loop to 0.7 m off the wall, in CRAB_T s. */
const CRAB = 9.9;
const CRAB_T = 40;
/** Dwell at each stop, seconds (min, max). */
const DWELL_A: [number, number] = [100, 160];
const DWELL_Q: [number, number] = [80, 140];
const CRUISE = 1.8;
/** Between the lighter and the tug lashed alongside, m. */
const LASH = 0.4;
/**
 * The lanes of river.ts where the loop crosses them: the fairway (z -84 and -100, straight along
 * the whole river) and the near lane (z -36 east of x -55). A tow is "in" a lane within STRIP m of
 * its line (the widest ship's half beam, the tow's, and room between).
 */
const LANE_Z: Array<{ lane: string; z: number; xMin: number }> = [
  { lane: "up", z: -84, xMin: -Infinity },
  { lane: "down", z: -100, xMin: -Infinity },
  { lane: "near", z: -36, xMin: -55 },
];
const STRIP = 11;
/** Speed up and slow down, m/s per second. */
const ACCEL = 0.12;
const BRAKE = 0.35;

/** A train on the river (river.ts Mover): head position and heading, its speed, its whole length. */
export interface Traffic {
  x: number;
  z: number;
  hx: number;
  hz: number;
  v: number;
  speed: number;
  len: number;
  beam: number;
  lane: string;
}

/** A hull in the way, for river.ts: middle, heading, length, beam and speed. */
export interface Obstacle {
  x: number;
  z: number;
  yaw: number;
  len: number;
  beam: number;
  v: number;
}

export interface Anchorage {
  update(t: number, dt: number, traffic: readonly Traffic[]): void;
  /** The tows' hulls (tugs and lighters) as they are now. */
  obstacles(): readonly Obstacle[];
}

/** Where the loop runs through one lane: loop distances in and out, and the x of the crossing. */
interface Strip {
  lane: string;
  s0: number;
  s1: number;
  x: number;
}

/** Lane crossings close together, crossed in one go (a tow may not stop between them). */
interface Zone {
  s0: number;
  s1: number;
  strips: Strip[];
}

interface Tow {
  /** The lighter (on the loop) and the tug (alongside it, on the other side). */
  lighter: TrainPart;
  tug: TrainPart;
  names: BoatName[];
  lb: number;
  tb: number;
  /** Across both hulls, and the longer of the two. */
  width: number;
  len: number;
  /** The tug's middle from the loop, sideways (negative: away from the berth side). */
  tugOff: number;
  s: number;
  v: number;
  /** Where it goes next (0: the liner, 1: the quay). */
  stop: 0 | 1;
  phase: "run" | "in" | "dwell" | "out";
  dwell: number;
  /** 0 on the loop, 1 against the quay wall. */
  crab: number;
  /** A zone it has decided to cross (index), or -1. */
  committed: number;
  /** Seconds it has waited for a rowing boat in its way. */
  blocked: number;
  ship: MovingShip;
  why: string;
}

const smooth = (e0: number, e1: number, x: number) => {
  const k = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return k * k * (3 - 2 * k);
};

/** A test for open water (World.boatFree), and one for a ladder or landing within r (World.exitNear). */
export type FreeFn = (x: number, z: number, r: number) => boolean;
export type ExitFn = (x: number, z: number, r: number) => unknown;

export function createAnchorage(group: THREE.Group, fleet: Boats, scene: THREE.Object3D, seed = 1873): Anchorage {
  const r = rng(seed ^ 0x51ed);
  const d = fleet.dims("liner");
  const liner = fleet.place("liner", LINER.x, LINER.z, LINER.yaw, group);
  // the hawse: from the model (Blender x, y, z -> local x, z = -y), else the stem
  let hx = 0;
  let hz = d.length / 2 - 3;
  const raw = liner.children[0]?.userData?.hawse as string | undefined;
  if (raw) {
    try {
      const h = JSON.parse(raw) as number[];
      hx = h[0];
      hz = -h[1];
    } catch {
      /* keep the stem */
    }
  }
  const cy = Math.cos(LINER.yaw);
  const sy = Math.sin(LINER.yaw);
  // the pivot in the world (three.js yaw: local (x, z) -> (x cos + z sin, -x sin + z cos))
  const H = { x: LINER.x + hx * cy + hz * sy, z: LINER.z - hx * sy + hz * cy };
  const SHEER_MAX = SHEER.reduce((a, [amp]) => a + amp, 0);
  let sheer = 0;
  const linerShip: MovingShip = { id: newShipId(), kind: "liner", x: LINER.x, z: LINER.z, heading: LINER.yaw, speed: 0, steam: true, anchored: true };

  /** The liner's middle for a sheer angle a. */
  function linerAt(a: number): { x: number; z: number; yaw: number } {
    const yaw = LINER.yaw + a;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // the middle is the hawse minus the rotated hawse offset
    return { x: H.x - (hx * c + hz * s), z: H.z - (-hx * s + hz * c), yaw };
  }
  function placeLiner(t: number): void {
    sheer = 0;
    for (const [a, p, ph] of SHEER) sheer += a * Math.sin((2 * Math.PI * t) / p + ph);
    const at = linerAt(sheer);
    liner.position.set(at.x, water.river, at.z);
    liner.rotation.y = at.yaw;
    linerShip.x = at.x;
    linerShip.z = at.z;
    linerShip.heading = at.yaw;
  }
  placeLiner(0);

  // ---- the loop
  const curve = new THREE.CatmullRomCurve3(
    LOOP.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    true,
    "centripetal",
  );
  const LEN = curve.getLength();
  const N = Math.ceil(LEN);
  const pts: THREE.Vector3[] = curve.getSpacedPoints(N);
  const sAt = (px: number, pz: number) => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < N; i++) {
      const dd = (pts[i].x - px) ** 2 + (pts[i].z - pz) ** 2;
      if (dd < bd) {
        bd = dd;
        best = i;
      }
    }
    return (best / N) * LEN;
  };
  const stops = [sAt(...STOP_A), sAt(...STOP_Q)];
  const wrap = (s: number) => ((s % LEN) + LEN) % LEN;
  /** Distance along the loop from a to b, going forward. */
  const ahead = (a: number, b: number) => wrap(b - a);

  // lane crossings: runs of the loop inside each lane's strip, merged into one zone when too
  // close together to stop between
  const strips: Strip[] = [];
  for (const ln of LANE_Z) {
    let cur: Strip | null = null;
    let xs = 0;
    let n = 0;
    for (let i = 0; i <= N; i++) {
      const p = pts[i % N];
      const inside = Math.abs(p.z - ln.z) < STRIP && p.x > ln.xMin;
      const s = (i / N) * LEN;
      if (inside) {
        if (!cur) cur = { lane: ln.lane, s0: s, s1: s, x: 0 };
        cur.s1 = s;
        xs += p.x;
        n++;
      } else if (cur) {
        cur.x = xs / n;
        strips.push(cur);
        cur = null;
        xs = n = 0;
      }
    }
    if (cur) strips.push({ ...cur, x: xs / n });
  }
  strips.sort((a, b) => a.s0 - b.s0);
  const zones: Zone[] = [];
  for (const st of strips) {
    const last = zones[zones.length - 1];
    if (last && st.s0 - last.s1 < 60) {
      last.s1 = Math.max(last.s1, st.s1);
      last.strips.push(st);
    } else zones.push({ s0: st.s0, s1: st.s1, strips: [st] });
  }

  // near the liner the loop turns with her: full weight alongside, fading over 40 m
  const sA = stops[0];
  function weight(s: number): number {
    const lo = wrap(sA - 45);
    const W = 80;
    if (ahead(lo, s) <= W) return 1;
    const off = Math.min(ahead(s, lo), ahead(wrap(lo + W), s));
    return 1 - smooth(0, 40, off);
  }

  // ---- the tows
  const tows: Tow[] = [];
  function take(name: BoatName): TrainPart {
    const obj = fleet.place(name, LINER.x, LINER.z + 20, 0, group);
    return { obj, len: fleet.dims(name).length };
  }
  const SETS: Array<[BoatName, BoatName]> = [
    ["tug", "lighter_loaded"],
    ["paddle_tug", "lighter_loaded"],
  ];
  SETS.forEach(([tugName, lighterName], i) => {
    const tug = take(tugName);
    const lighter = take(lighterName);
    const tb = fleet.dims(tugName).beam;
    const lb = fleet.dims(lighterName).beam;
    // one waits at the liner, the other against the quay, part way through its wait
    const atQuay = i === 1;
    const [d0, d1] = atQuay ? DWELL_Q : DWELL_A;
    tows.push({
      lighter,
      tug,
      names: [tugName, lighterName],
      lb,
      tb,
      width: lb + LASH + tb,
      len: Math.max(tug.len, lighter.len),
      tugOff: -(lb / 2 + LASH + tb / 2),
      s: stops[atQuay ? 1 : 0],
      v: 0,
      stop: atQuay ? 1 : 0,
      phase: "dwell",
      dwell: (d0 + r() * (d1 - d0)) * (0.3 + 0.5 * r()),
      crab: atQuay ? 1 : 0,
      committed: -1,
      blocked: 0,
      ship: { id: newShipId(), kind: tugName, x: 0, z: 0, heading: 0, speed: 0, steam: true },
      why: "",
    });
  });

  // the lashings between each tug and its lighter: bow and stern lines
  const lash = new THREE.BufferAttribute(new Float32Array(tows.length * 4 * 3), 3);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute("position", lash);
  const lines = new THREE.LineSegments(lg, ropeMaterial(0x2a2218));
  lines.frustumCulled = false;
  lines.name = "anchorage_lashings";
  group.add(lines);

  const obs: Obstacle[] = [];
  const p = new THREE.Vector3();
  const tg = new THREE.Vector3();

  /**
   * A tow's two hulls at loop distance s, `crab` of the way in to the quay (Q only) with its bow
   * turned by `turn`: the lighter's and the tug's middles and the heading, turned with the liner
   * by the loop's weight there. Writes into out.
   */
  const pose = { lx: 0, lz: 0, tx: 0, tz: 0, yaw: 0 };
  function towPose(tow: Tow, s: number, crab: number, turn: number, out = pose): typeof pose {
    const u = wrap(s) / LEN;
    curve.getPointAt(u, p);
    curve.getTangentAt(u, tg);
    let yaw = Math.atan2(tg.x, tg.z);
    // sideways: the heading turned by +90 degrees (toward the quay at Q, toward the liner at A)
    const nx = Math.cos(yaw);
    const nz = -Math.sin(yaw);
    const side = crab * CRAB;
    let lx = p.x + nx * side;
    let lz = p.z + nz * side;
    let tx = lx + nx * tow.tugOff;
    let tz = lz + nz * tow.tugOff;
    yaw += turn;
    const w = weight(wrap(s));
    if (w > 0) {
      const a = w * sheer;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const rot = (x: number, z: number): [number, number] => [H.x + (x - H.x) * c + (z - H.z) * sn, H.z - (x - H.x) * sn + (z - H.z) * c];
      [lx, lz] = rot(lx, lz);
      [tx, tz] = rot(tx, tz);
      yaw += a;
    }
    out.lx = lx;
    out.lz = lz;
    out.tx = tx;
    out.tz = tz;
    out.yaw = yaw;
    return out;
  }

  // rowing boats on the water (game/rowing.ts puts them straight in the scene): looked up now and then
  let rowers: THREE.Object3D[] = [];
  let rowersAt = -1;
  /** When each boat last moved: one left lying in the way stops a tow for a while, not for ever. */
  const moved = new WeakMap<THREE.Object3D, { x: number; z: number; at: number }>();

  /** Seconds for a tow now at speed v to go d metres (speeding up to CRUISE on the way). */
  function eta(dist: number, v: number): number {
    const up = Math.max(0, CRUISE - v) / ACCEL;
    const dUp = ((v + CRUISE) / 2) * up;
    return dist <= dUp ? dist / Math.max(0.3, (v + CRUISE) / 2) : up + (dist - dUp) / CRUISE;
  }

  /**
   * Can the tow cross zone z now? For each lane it crosses: the time it is in that lane (its bow
   * in to its stern out), against the time each ship on that lane is over the crossing point
   * (at its own speed, or at half of it if it is held up). They must not meet.
   */
  function clear(tow: Tow, z: Zone, traffic: readonly Traffic[]): boolean {
    const half = tow.len / 2;
    const pad = tow.width / 2 + 6;
    for (const st of z.strips) {
      // (the tug alongside may lead into the lane by a few metres on a slant)
      const tIn = eta(Math.max(0, ahead(tow.s, st.s0) - half - 6), tow.v) - 3;
      const tOut = eta(ahead(tow.s, st.s1) + half, tow.v) + 6;
      for (const m of traffic) {
        if (m.lane !== st.lane) continue;
        const a = m.x + m.hx * 30; // its bow: half the longest lead ship ahead of its middle
        const b = m.x - m.hx * m.len;
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const u = m.hx * Math.max(m.speed, m.v);
        if (Math.abs(u) < 0.05) {
          if (hi > st.x - pad && lo < st.x + pad) return false;
          continue;
        }
        // over the crossing between t1 and t2, at full speed or at half
        let t1 = Infinity;
        let t2 = -Infinity;
        for (const k of [1, 0.5]) {
          const ta = (st.x - pad - hi) / (u * k);
          const tb = (st.x + pad - lo) / (u * k);
          t1 = Math.min(t1, ta, tb);
          t2 = Math.max(t2, ta, tb);
        }
        if (t2 > 0 && t1 < tOut && t2 > tIn) return false;
      }
    }
    return true;
  }

  function leave(tow: Tow): void {
    tow.phase = "run";
    tow.dwell = 0;
    tow.crab = 0;
    tow.stop = tow.stop === 0 ? 1 : 0;
  }

  function update(t: number, dt: number, traffic: readonly Traffic[]): void {
    placeLiner(t);
    if (t - rowersAt > 0.5 || rowersAt < 0 || t < rowersAt) {
      rowersAt = t;
      rowers = scene.children.filter((o) => o.visible && (o.name === "rowboat" || o.name === "punt"));
      for (const b of rowers) {
        const m = moved.get(b);
        if (!m || Math.hypot(m.x - b.position.x, m.z - b.position.z) > 0.3 || t < m.at) moved.set(b, { x: b.position.x, z: b.position.z, at: t });
      }
    }
    for (const tow of tows) {
      tow.why = "";
      // at a stop: in to the wall (Q), wait, out again, then off to the other stop
      if (tow.phase !== "run") {
        tow.v = 0;
        tow.why = tow.stop === 0 ? "alongside the liner" : "at the quay";
        if (tow.phase === "in") {
          tow.crab = Math.min(1, tow.crab + dt / CRAB_T);
          if (tow.crab >= 1) {
            tow.phase = "dwell";
            tow.dwell = DWELL_Q[0] + r() * (DWELL_Q[1] - DWELL_Q[0]);
          }
        } else if (tow.phase === "dwell") {
          tow.dwell -= dt;
          if (tow.dwell <= 0) {
            if (tow.stop === 1) tow.phase = "out";
            else leave(tow);
          }
        } else {
          tow.crab = Math.max(0, tow.crab - dt / CRAB_T);
          if (tow.crab <= 0) leave(tow);
        }
        continue;
      }
      let target = CRUISE;
      const sStop = stops[tow.stop];
      const toStop = ahead(tow.s, sStop);
      // brake for the stop ahead (a crawl for the last metre)
      if (toStop < 60) target = Math.min(target, Math.sqrt(2 * 0.05 * Math.max(0, toStop - 0.2)) + 0.08);
      // lanes: decide at the last braking point whether to cross; wait at the edge until the
      // lanes are clear (and there is room past them), then cross without stopping
      for (let zi = 0; zi < zones.length; zi++) {
        const z = zones[zi];
        const toZone = ahead(tow.s, z.s0);
        const inZone = ahead(z.s0, tow.s) <= z.s1 - z.s0 + tow.len;
        if (inZone) continue;
        if (tow.committed === zi) {
          // stopped short of it after all (a rowing boat): think again
          if (toZone > 60 || (tow.v < 0.2 && toZone > 2)) tow.committed = -1;
          else continue;
        }
        // (it waits well short of the lane's strip: even crossing at a slant, with the tug on the
        // lane side, no corner comes within 8 m of a ship on the lane, so they pass without a care)
        const hold = tow.len / 2 + 12;
        const decide = (tow.v * tow.v) / (2 * 0.08) + hold + 2;
        if (toZone > decide + 2) continue;
        // room on the far side: the other tow's stern must lie beyond the zone and a tow length
        let room = true;
        for (const o of tows) {
          if (o === tow) continue;
          if (ahead(tow.s, wrap(o.s - o.len / 2)) < ahead(tow.s, z.s1) + tow.len + 20) room = false;
        }
        if (room && clear(tow, z, traffic)) tow.committed = zi;
        else {
          target = Math.min(target, Math.sqrt(2 * 0.08 * Math.max(0, toZone - hold)));
          tow.why = room ? "waits for the fairway" : "waits for room";
        }
      }
      // the other tow ahead on the loop: keep 25 m off its stern
      for (const o of tows) {
        if (o === tow) continue;
        const gap = ahead(tow.s, o.s) - o.len / 2 - tow.len / 2;
        if (gap < 80) target = Math.min(target, Math.max(0, (gap - 25) * 0.06));
      }
      // rowing boats in the way: within reach of the loop in the next 40 m, measured from the
      // middle of the two hulls (one lying at the steps beside the way is not in the way)
      const mid = tow.tugOff / 2;
      let blocked = false;
      const i0 = Math.floor((tow.s / LEN) * N);
      for (const b of rowers) {
        const bx = b.position.x;
        const bz = b.position.z;
        if (Math.abs(bx - pts[i0].x) > 70 || Math.abs(bz - pts[i0].z) > 70) continue;
        // a boat nobody has moved for a minute, after the tow has waited a minute and a half: the
        // tug's crew shove it off (it is let through)
        if (tow.blocked > 90 && t - (moved.get(b)?.at ?? t) > 60) continue;
        for (let k = 0; k <= 40; k += 2) {
          const i = (i0 + Math.round(tow.len / 2) + k) % N;
          const q = pts[i];
          const q2 = pts[(i + 1) % N];
          const ex = q2.x - q.x;
          const ez = q2.z - q.z;
          const el = Math.hypot(ex, ez) || 1;
          // the middle of the tow here: the loop moved sideways by half the tug's offset
          const cx = q.x + (ez / el) * mid;
          const cz = q.z - (ex / el) * mid;
          if ((cx - bx) ** 2 + (cz - bz) ** 2 < (tow.width / 2 + 1.6) ** 2) {
            target = Math.min(target, Math.max(0, (k - 6) * 0.08));
            tow.why = "stops for a rowing boat";
            blocked = true;
            break;
          }
        }
      }
      tow.blocked = blocked ? tow.blocked + dt : 0;
      // a ship under way right in front
      const head = tow.lighter.obj;
      const fx = Math.sin(head.rotation.y);
      const fz = Math.cos(head.rotation.y);
      for (const m of traffic) {
        const dx = m.x - head.position.x;
        const dz = m.z - head.position.z;
        const along = dx * fx + dz * fz;
        const sideDist = Math.abs(dx * fz - dz * fx);
        if (along > 0 && along < 60 && sideDist < (tow.width + m.beam) / 2 + 12) {
          target = Math.min(target, Math.max(0, (along - 30) * 0.06));
          tow.why = "gives way";
        }
      }
      tow.v += THREE.MathUtils.clamp(target - tow.v, -BRAKE * dt, ACCEL * dt);
      tow.v = Math.max(0, tow.v);
      if (toStop < 3 && tow.v * dt >= toStop - 0.02) {
        // made fast at the stop
        tow.s = sStop;
        tow.v = 0;
        tow.committed = -1;
        if (tow.stop === 1) tow.phase = "in";
        else {
          tow.phase = "dwell";
          tow.dwell = DWELL_A[0] + r() * (DWELL_A[1] - DWELL_A[0]);
        }
      } else tow.s = wrap(tow.s + tow.v * dt);
    }
    // place the hulls and the lashings
    obs.length = 0;
    let at = 0;
    for (const tow of tows) {
      // walking in: the bow a little toward the wall; out: a little away
      const turn = tow.phase === "in" ? 0.06 * Math.sin(Math.PI * tow.crab) : tow.phase === "out" ? -0.06 * Math.sin(Math.PI * tow.crab) : 0;
      const q = towPose(tow, tow.s, tow.crab, turn);
      tow.lighter.obj.position.set(q.lx, water.river, q.lz);
      tow.lighter.obj.rotation.y = q.yaw;
      tow.tug.obj.position.set(q.tx, water.river, q.tz);
      tow.tug.obj.rotation.y = q.yaw;
      obs.push({ x: q.lx, z: q.lz, yaw: q.yaw, len: tow.lighter.len, beam: tow.lb, v: tow.v });
      obs.push({ x: q.tx, z: q.tz, yaw: q.yaw, len: tow.tug.len, beam: tow.tb, v: tow.v });
      const fx = Math.sin(q.yaw);
      const fz = Math.cos(q.yaw);
      for (const k of [0.4, -0.4]) {
        lash.setXYZ(at++, q.lx + fx * tow.lighter.len * k, water.river + 1.0, q.lz + fz * tow.lighter.len * k);
        lash.setXYZ(at++, q.tx + fx * tow.tug.len * k * 0.9, water.river + 1.3, q.tz + fz * tow.tug.len * k * 0.9);
      }
      tow.ship.x = q.tx;
      tow.ship.z = q.tz;
      tow.ship.heading = q.yaw;
      tow.ship.speed = tow.v;
    }
    lash.needsUpdate = true;
  }

  addMovingSource((out) => {
    out.push(linerShip);
    for (const tow of tows) out.push(tow.ship);
  });

  /**
   * Dev check: every hull of a tow, all round the loop (every 1.5 m, on the loop) and all the way
   * in to the quay and out, against open water (World.boatFree) with `transit` m to spare; at the
   * berth, `berth` m to spare and no ladder or landing within `berth` m. Only where the walk map
   * knows the water (z > -79); the liner's side and the fairway beyond are checked by numbers:
   * her swing and the tows at her side must stay clear of the fairway and the far bank.
   */
  function check(free: FreeFn, exit?: ExitFn, transit = 2.0, berth = 3.0): string[] {
    const bad: string[] = [];
    /**
     * A hull's outline grown by `need` on every side (but only 0.1 m on its wall side, +n, when
     * `wall`: a lighter goes in against the quay wall), tested point by point for open water
     * (0.3 m round each point); with `ladder`, no ladder or landing within `need` of its wall side.
     */
    const hull = (x: number, z: number, yaw: number, L: number, B: number, need: number, what: string, at: string, wall: boolean, ladder = false) => {
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const a0 = -L / 2 - need;
      const a1 = L / 2 + need;
      const b0 = -B / 2 - need;
      const b1 = B / 2 + (wall ? 0.1 : need);
      const probe = (a: number, b: number, lad: boolean): boolean => {
        const px = x + fx * a + fz * b;
        const pz = z + fz * a - fx * b;
        if (pz < -79 || px < -338 || px > 198) return true;
        if (free(px, pz, 0.3) && !(lad && Math.abs(a) <= L / 2 + 1e-6 && exit?.(px, pz, need))) return true;
        bad.push(`${what} ${at}: (${px.toFixed(1)}, ${pz.toFixed(1)}) is not ${need} m clear${lad ? " (or a ladder / steps within it)" : ""}`);
        return false;
      };
      const stepA = (a1 - a0) / Math.ceil((a1 - a0) / 1.5);
      const stepB = (b1 - b0) / Math.ceil((b1 - b0) / 1.5);
      for (let a = a0; a <= a1 + 1e-6; a += stepA) if (!probe(a, b0, false) || !probe(a, b1, ladder) || !probe(a, (b0 + b1) / 2, false)) return;
      for (let b = b0; b <= b1 + 1e-6; b += stepB) if (!probe(a0, b, false) || !probe(a1, b, false)) return;
    };
    const keep = sheer;
    sheer = 0;
    for (const tow of tows) {
      const name = tow.names.join("+");
      for (let s = 0; s < LEN; s += 1.5) {
        const q = towPose(tow, s, 0, 0, { lx: 0, lz: 0, tx: 0, tz: 0, yaw: 0 });
        hull(q.lx, q.lz, q.yaw, tow.lighter.len, tow.lb, transit, `${name} lighter`, `s ${s.toFixed(0)}`, false);
        hull(q.tx, q.tz, q.yaw, tow.tug.len, tow.tb, transit, `${name} tug`, `s ${s.toFixed(0)}`, false);
      }
      for (let c = 0; c <= 1.0001; c += 0.1) {
        for (const turn of [0.06 * Math.sin(Math.PI * c), -0.06 * Math.sin(Math.PI * c)]) {
          const q = towPose(tow, stops[1], c, turn, { lx: 0, lz: 0, tx: 0, tz: 0, yaw: 0 });
          const last = c > 0.999;
          const need = last ? berth : transit;
          hull(q.lx, q.lz, q.yaw, tow.lighter.len, tow.lb, need, `${name} lighter`, `berth ${Math.round(c * 100)}%`, true, last);
          hull(q.tx, q.tz, q.yaw, tow.tug.len, tow.tb, need, `${name} tug`, `berth ${Math.round(c * 100)}%`, true);
        }
      }
      // at the liner: the tug's outer side must stay 5 m off the down lane's ships (z -100 +- 5)
      for (const a of [-SHEER_MAX, 0, SHEER_MAX]) {
        sheer = a;
        const q = towPose(tow, stops[0], 0, 0, { lx: 0, lz: 0, tx: 0, tz: 0, yaw: 0 });
        const outer = q.tz + tow.len / 2 * Math.abs(Math.sin(a)) + tow.tb / 2;
        if (outer > -110) bad.push(`${name} at the liner reaches z ${outer.toFixed(1)} at sheer ${((a * 180) / Math.PI).toFixed(1)} deg (fairway at -105)`);
      }
      sheer = 0;
    }
    // the liner's swing: her hull (with bowsprit) against the fairway and the far bank (z -290)
    for (const a of [-SHEER_MAX, 0, SHEER_MAX]) {
      const at = linerAt(a);
      const fx = Math.sin(at.yaw);
      const fz = Math.cos(at.yaw);
      let zMax = -Infinity;
      let zMin = Infinity;
      for (const [al, ac] of [[d.length / 2 + 18, 0], [d.length / 2, d.beam / 2], [d.length / 2, -d.beam / 2], [-d.length / 2, d.beam / 2], [-d.length / 2, -d.beam / 2]]) {
        const z = at.z + fz * al - fx * ac;
        zMax = Math.max(zMax, z);
        zMin = Math.min(zMin, z);
      }
      if (zMax > -112) bad.push(`liner at sheer ${((a * 180) / Math.PI).toFixed(1)} deg reaches z ${zMax.toFixed(1)} (fairway at -105)`);
      if (zMin < -280) bad.push(`liner at sheer ${((a * 180) / Math.PI).toFixed(1)} deg reaches z ${zMin.toFixed(1)} (far bank at -290)`);
    }
    sheer = keep;
    return bad;
  }

  // dev: where the tows are and why they wait; the loop checked against the world once it is up
  const dev = {
    liner: () => ({ x: +liner.position.x.toFixed(1), z: +liner.position.z.toFixed(1), sheerDeg: +((sheer * 180) / Math.PI).toFixed(1), hawse: H }),
    tows: () =>
      tows.map((t) => ({ kind: t.names.join("+"), s: +t.s.toFixed(1), v: +t.v.toFixed(2), x: +t.lighter.obj.position.x.toFixed(1), z: +t.lighter.obj.position.z.toFixed(1), to: t.stop === 0 ? "liner" : "quay", phase: t.phase, crab: +t.crab.toFixed(2), dwell: +t.dwell.toFixed(0), why: t.why })),
    zones: () => zones.map((z) => ({ s0: +z.s0.toFixed(0), s1: +z.s1.toFixed(0), strips: z.strips.map((q) => `${q.lane} ${q.s0.toFixed(0)}..${q.s1.toFixed(0)} x ${q.x.toFixed(0)}`) })),
    loop: () => ({ length: +LEN.toFixed(0), stops: stops.map((s) => +s.toFixed(0)) }),
    hulls: () => tows.flatMap((t) => [t.lighter.obj, t.tug.obj]),
    check,
  };
  (window as unknown as { __anchorage?: unknown }).__anchorage = dev;
  if (import.meta.env.DEV) {
    const run = (tries: number) => {
      const w = (window as unknown as { __scheldemist?: { world?: { boatFree?: FreeFn; exitNear?: ExitFn } } }).__scheldemist?.world;
      if (!w?.boatFree) {
        if (tries > 0) setTimeout(() => run(tries - 1), 3000);
        return;
      }
      const bad = check(w.boatFree, w.exitNear);
      if (bad.length) console.warn(`[anchorage] the lighters' loop is not clear (${bad.length}):\n${bad.slice(0, 20).join("\n")}`);
      else console.info("[anchorage] the lighters' loop, the berth and the liner's swing are clear");
    };
    setTimeout(() => run(20), 6000);
  }

  update(0, 0, []);
  return { update, obstacles: () => obs };
}
