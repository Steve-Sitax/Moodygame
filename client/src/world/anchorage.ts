import * as THREE from "three";
import { addMovingSource, newShipId, ropeMaterial, type BoatName, type Boats, type MovingShip } from "./boats";
import { WATER_Y } from "./rijnkaai";
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
// river is too narrow for that clear of the fairway, so she keeps her heading.) Two tugs, each with a loaded lighter, go
// round a fixed loop: alongside her on the town side under the derrick, to a berth at the
// Rijnkaai (x 1..49) and back. Before they cross a lane they wait until no ship on it will reach
// them while they cross; they stop for rowing boats in their way and for the other tow. The ships
// on the lanes also give way to them (river.ts reads obstacles()).
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
 * The tows' loop, (x, z) points in order. From alongside the liner (A, tug at x -10, heading -x)
 * it bears away from her bow, crosses the fairway at x -60, passes south of the barque at anchor
 * (-40, -48), crosses the near lane at x 2 (east of the barque outside the Anna Maria), comes in
 * to the Rijnkaai (Q, tug at x 38, 4.3 m off the wall, clear of the steps at x -4 and 50), goes
 * on east, turns out before the moored row at x 62, crosses both lanes at x 68..74 and comes up
 * her side from astern back to A.
 */
const LOOP: Array<[number, number]> = [
  [-10, -129.8],
  [-32, -127.5],
  [-50, -119],
  [-60, -104],
  [-62, -88],
  [-57, -73],
  [-44, -66.5],
  [-22, -65],
  [-5, -58],
  [2, -44],
  [2.5, -30],
  [3, -17],
  [8, -8],
  [16, -4.6],
  [26, -4.3],
  [38, -4.3],
  [46, -5.2],
  [53, -11.5],
  [58.5, -19],
  [65.5, -30],
  [70, -48],
  [73, -75],
  [74, -104],
  [69, -120],
  [56, -128.5],
  [36, -129.8],
  [14, -129.8],
];
const STOP_A: [number, number] = [-10, -129.8];
const STOP_Q: [number, number] = [38, -4.3];
/** Dwell at each stop, seconds (min, max). */
const DWELL_A: [number, number] = [100, 160];
const DWELL_Q: [number, number] = [80, 140];
const CRUISE = 1.8;
const GAP = 8; // hawser, tug stern to lighter bow
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
  parts: TrainPart[];
  names: BoatName[];
  beam: number;
  len: number;
  s: number;
  v: number;
  /** Where it stops next (A or Q) and how long it still waits there. */
  stop: 0 | 1;
  dwell: number;
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
  let sheer = 0;
  const linerShip: MovingShip = { id: newShipId(), kind: "liner", x: LINER.x, z: LINER.z, heading: LINER.yaw, speed: 0, steam: true, anchored: true };

  function placeLiner(t: number): void {
    sheer = 0;
    for (const [a, p, ph] of SHEER) sheer += a * Math.sin((2 * Math.PI * t) / p + ph);
    const yaw = LINER.yaw + sheer;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // the middle is the hawse minus the rotated hawse offset
    const x = H.x - (hx * c + hz * s);
    const z = H.z - (-hx * s + hz * c);
    liner.position.set(x, WATER_Y, z);
    liner.rotation.y = yaw;
    linerShip.x = x;
    linerShip.z = z;
    linerShip.heading = yaw;
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
  function weight(s: number, towLen: number): number {
    // the berth runs from 30 m astern of the tow's tail at A (past her stern) to 12 m ahead of its head
    const lo = wrap(sA - towLen - 30);
    const W = towLen + 42;
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
  const SETS: BoatName[][] = [
    ["tug", "lighter_loaded"],
    ["paddle_tug", "lighter_loaded"],
  ];
  SETS.forEach((names, i) => {
    const parts = names.map(take);
    const len = parts.reduce((a, p) => a + p.len, 0) + GAP * (parts.length - 1);
    const beam = Math.max(...names.map((n) => fleet.dims(n).beam));
    // one waits at the liner, the other at the quay, part way through its wait
    const stop = i === 0 ? 0 : 1;
    const [d0, d1] = stop === 0 ? DWELL_A : DWELL_Q;
    tows.push({
      parts,
      names,
      beam,
      len,
      s: stops[stop],
      v: 0,
      stop: stop as 0 | 1,
      dwell: (d0 + r() * (d1 - d0)) * (0.3 + 0.5 * r()),
      committed: -1,
      blocked: 0,
      ship: { id: newShipId(), kind: names[0], x: 0, z: 0, heading: 0, speed: 0, steam: true },
      why: "",
    });
  });

  // hawsers: one link per tow
  const hawser = new THREE.BufferAttribute(new Float32Array(tows.length * 2 * 3), 3);
  const hg = new THREE.BufferGeometry();
  hg.setAttribute("position", hawser);
  const lines = new THREE.LineSegments(hg, ropeMaterial(0x2a2218));
  lines.frustumCulled = false;
  lines.name = "anchorage_hawsers";
  group.add(lines);

  const obs: Obstacle[] = [];
  const p = new THREE.Vector3();
  const tg = new THREE.Vector3();

  /** Put a part's middle at loop distance s, turned with the liner by its weight there. */
  function placePart(obj: THREE.Object3D, s: number, towLen: number): void {
    const u = wrap(s) / LEN;
    curve.getPointAt(u, p);
    curve.getTangentAt(u, tg);
    let x = p.x;
    let z = p.z;
    let yaw = Math.atan2(tg.x, tg.z);
    const w = weight(wrap(s), towLen);
    if (w > 0) {
      const a = w * sheer;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const dx = x - H.x;
      const dz = z - H.z;
      x = H.x + dx * c + dz * sn;
      z = H.z - dx * sn + dz * c;
      yaw += a;
    }
    obj.position.set(x, WATER_Y, z);
    obj.rotation.y = yaw;
  }

  // rowing boats on the water (game/rowing.ts puts them straight in the scene): looked up now and then
  let rowers: THREE.Object3D[] = [];
  let rowersAt = -1;
  /** When each boat last moved: one left lying in the way stops a tow for a while, not for ever. */
  const moved = new WeakMap<THREE.Object3D, { x: number; z: number; at: number }>();

  /** Seconds for a tow now at speed v to go d metres (speeding up to CRUISE on the way). */
  function eta(d: number, v: number): number {
    const up = Math.max(0, CRUISE - v) / ACCEL;
    const dUp = ((v + CRUISE) / 2) * up;
    return d <= dUp ? d / Math.max(0.3, (v + CRUISE) / 2) : up + (d - dUp) / CRUISE;
  }

  /**
   * Can the tow cross zone z now? For each lane it crosses: the time it is in that lane (its bow
   * in to its stern out), against the time each ship on that lane is over the crossing point
   * (at its own speed, or at half of it if it is held up). They must not meet.
   */
  function clear(tow: Tow, z: Zone, traffic: readonly Traffic[]): boolean {
    const bow = tow.parts[0].len / 2;
    const pad = tow.beam / 2 + 6;
    for (const st of z.strips) {
      const tIn = eta(Math.max(0, ahead(tow.s, st.s0) - bow), tow.v) - 3;
      const tOut = eta(ahead(tow.s, st.s1) + tow.len - bow, tow.v) + 6;
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
      let target = CRUISE;
      tow.why = "";
      const head = tow.parts[0].obj;
      const fx = Math.sin(head.rotation.y);
      const fz = Math.cos(head.rotation.y);
      // at a stop: wait out the dwell, then set off for the other one
      let sStop = stops[tow.stop];
      let toStop = ahead(tow.s, sStop);
      let leaving = false;
      if (tow.dwell > 0) {
        tow.dwell -= dt;
        target = 0;
        tow.why = tow.stop === 0 ? "alongside" : "at the quay";
        if (tow.dwell <= 0) {
          tow.dwell = 0;
          tow.stop = tow.stop === 0 ? 1 : 0;
          sStop = stops[tow.stop];
          toStop = ahead(tow.s, sStop);
          leaving = true;
        }
      } else if (toStop < 60) {
        // brake for the stop ahead (a crawl for the last metre)
        target = Math.min(target, Math.sqrt(2 * 0.05 * Math.max(0, toStop - 0.2)) + 0.08);
      }
      // lanes: decide at the last braking point whether to cross; wait at the edge until the
      // lanes are clear (and there is room past them), then cross without stopping
      for (let zi = 0; zi < zones.length && tow.dwell <= 0; zi++) {
        const z = zones[zi];
        const toZone = ahead(tow.s, z.s0);
        const inZone = ahead(z.s0, tow.s) <= z.s1 - z.s0 + tow.len;
        if (inZone) continue;
        if (tow.committed === zi) {
          // stopped short of it after all (a rowing boat): think again
          if (toZone > 60 || (tow.v < 0.2 && toZone > 2)) tow.committed = -1;
          else continue;
        }
        const decide = (tow.v * tow.v) / (2 * 0.08) + 8;
        if (toZone > decide + 2) continue;
        // room on the far side: the other tow's stern must lie beyond the zone and a tow length
        let room = true;
        for (const o of tows) {
          if (o === tow) continue;
          if (ahead(tow.s, wrap(o.s - o.len)) < ahead(tow.s, z.s1) + tow.len + 20) room = false;
        }
        if (room && clear(tow, z, traffic)) tow.committed = zi;
        else {
          target = Math.min(target, Math.sqrt(2 * 0.08 * Math.max(0, toZone - 6)));
          tow.why = room ? "waits for the fairway" : "waits for room";
        }
      }
      // the other tow ahead on the loop: keep 25 m off its stern
      for (const o of tows) {
        if (o === tow) continue;
        const gap = ahead(tow.s, o.s) - o.len - tow.parts[0].len / 2;
        if (gap < 80) target = Math.min(target, Math.max(0, (gap - 25) * 0.06));
      }
      // rowing boats and ships under way in front of the tug
      const hxp = head.position.x;
      const hzp = head.position.z;
      // (a boat is in the way if it lies within a few metres of the loop in the next 40 m: one
      // lying at the steps beside the way out is not)
      let blocked = false;
      for (const b of rowers) {
        const bx = b.position.x;
        const bz = b.position.z;
        if (Math.abs(bx - hxp) > 60 || Math.abs(bz - hzp) > 60) continue;
        // a boat nobody has moved for a minute, after the tow has waited a minute and a half: the
        // tug's crew shove it off (it is let through)
        if (tow.blocked > 90 && t - (moved.get(b)?.at ?? t) > 60) continue;
        const i0 = Math.floor((tow.s / LEN) * N);
        for (let k = 0; k <= 40; k += 2) {
          const q = pts[(i0 + Math.round(tow.parts[0].len / 2) + k) % N];
          if ((q.x - bx) ** 2 + (q.z - bz) ** 2 < (tow.beam / 2 + 2.2) ** 2) {
            target = Math.min(target, Math.max(0, (k - 6) * 0.08));
            tow.why = "stops for a rowing boat";
            blocked = true;
            break;
          }
        }
      }
      tow.blocked = blocked ? tow.blocked + dt : 0;
      for (const m of traffic) {
        const dx = m.x - hxp;
        const dz = m.z - hzp;
        const along = dx * fx + dz * fz;
        const side = Math.abs(dx * fz - dz * fx);
        if (along > 0 && along < 60 && side < (tow.beam + m.beam) / 2 + 12) {
          target = Math.min(target, Math.max(0, (along - 30) * 0.06));
          tow.why = "gives way";
        }
      }
      const dv = target - tow.v;
      tow.v += THREE.MathUtils.clamp(dv, -BRAKE * dt, ACCEL * dt);
      tow.v = Math.max(0, tow.v);
      if (!leaving && tow.dwell <= 0 && toStop < 3 && tow.v * dt >= toStop - 0.02) {
        // made fast at the stop: wait there
        const [d0, d1] = tow.stop === 0 ? DWELL_A : DWELL_Q;
        tow.dwell = d0 + r() * (d1 - d0);
        tow.s = sStop;
        tow.v = 0;
      } else tow.s = wrap(tow.s + tow.v * dt);
    }
    // place the hulls and the hawsers
    obs.length = 0;
    let at = 0;
    for (const tow of tows) {
      let sp = tow.s;
      for (let i = 0; i < tow.parts.length; i++) {
        const part = tow.parts[i];
        if (i > 0) sp -= tow.parts[i - 1].len / 2 + GAP + part.len / 2;
        placePart(part.obj, sp, tow.len);
        obs.push({ x: part.obj.position.x, z: part.obj.position.z, yaw: part.obj.rotation.y, len: part.len, beam: tow.beam, v: tow.v });
      }
      const a = tow.parts[0];
      const b = tow.parts[1];
      const la = a.len / 2 - 1.2;
      const lb = b.len / 2 - 0.5;
      hawser.setXYZ(at++, a.obj.position.x - Math.sin(a.obj.rotation.y) * la, WATER_Y + 1.3, a.obj.position.z - Math.cos(a.obj.rotation.y) * la);
      hawser.setXYZ(at++, b.obj.position.x + Math.sin(b.obj.rotation.y) * lb, WATER_Y + 1.1, b.obj.position.z + Math.cos(b.obj.rotation.y) * lb);
      tow.ship.x = a.obj.position.x;
      tow.ship.z = a.obj.position.z;
      tow.ship.heading = a.obj.rotation.y;
      tow.ship.speed = tow.v;
    }
    hawser.needsUpdate = true;
  }

  addMovingSource((out) => {
    out.push(linerShip);
    for (const tow of tows) out.push(tow.ship);
  });

  // dev: where the tows are and why they wait
  (window as unknown as { __anchorage?: unknown }).__anchorage = {
    liner: () => ({ x: +liner.position.x.toFixed(1), z: +liner.position.z.toFixed(1), sheerDeg: +((sheer * 180) / Math.PI).toFixed(1), hawse: H }),
    tows: () => tows.map((t) => ({ kind: t.names.join("+"), s: +t.s.toFixed(1), v: +t.v.toFixed(2), x: +t.ship.x.toFixed(1), z: +t.ship.z.toFixed(1), to: t.stop === 0 ? "liner" : "quay", dwell: +t.dwell.toFixed(0), why: t.why })),
    zones: () => zones.map((z) => ({ s0: +z.s0.toFixed(0), s1: +z.s1.toFixed(0), strips: z.strips.map((q) => `${q.lane} ${q.s0.toFixed(0)}..${q.s1.toFixed(0)} x ${q.x.toFixed(0)}`) })),
    loop: () => ({ length: +LEN.toFixed(0), stops: stops.map((s) => +s.toFixed(0)) }),
    hulls: () => tows.flatMap((t) => t.parts.map((q) => q.obj)),
  };

  update(0, 0, []);
  return { update, obstacles: () => obs };
}
