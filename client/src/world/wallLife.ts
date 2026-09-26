import * as THREE from "three";
import CITY from "../../../shared/city.json";
import { psx } from "../retro/psx";
import type { WallDressing } from "./rampart";

// Small life on the town wall (the look pass, 2026-09-26; Steve: "make it better, also props, people, guards"):
//
// - crows: a few small flocks where the wall is half abandoned (on the breastwork's coping and the rubble by the
//   town's works, on a bastion's lawn, on the town parapet by the old guns). They peck, turn and hop; when Jef
//   comes within a few metres they fly up to another perch of their flock (or out over the fields and back a
//   while later). By night they are gone to roost. One instanced body and two instanced wings for all of them;
// - a kite: a child of the town at the kite place on the north-east bastion's lawn (server town/wallfolk.ts) flies
//   it downwind on its string, the tail of bows swinging. The child is a townsperson with a day; this only draws
//   the kite while one is there (the town's people near the place: setWallTown, main.ts).
//
// Nothing here is solid or on the walk map. Hidden past its reach.

interface Seg0 {
  name: string;
  o: [number, number];
  t: [number, number];
  n: [number, number];
  len: number;
}
const R = (CITY as unknown as { decor?: { rampart?: { h: number; t: number; segments: Seg0[] } } }).decor?.rampart ?? null;

type Near = (x: number, z: number, r: number) => Array<{ id: string; x: number; z: number; yaw: number; trade: string; age: number }>;
let townNear: Near | null = null;
/** main.ts: the town's drawn people near a point (Town.inStreet), for the kite's flier. */
export function setWallTown(fn: Near): void {
  townNear = fn;
}

/** The kite place (server town/wallfolk.ts KITE: the north-east bastion's lawn). */
export const KITE_PLACE = { x: 226, z: 333, r: 7 };

const TOWN_T = 0.42;
const BW_IN = 0.65;
const CROW_REACH = 90;
const FLEE = 6.5;

interface Perch {
  x: number;
  y: number;
  z: number;
}
interface Crow {
  g: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  state: "perch" | "fly" | "away";
  t: number;
  act: number;
  peck: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  dur: number;
  perch: number;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A box's 12 triangles into arrays (positions, normals), centred at c, half sizes h. */
function box(pos: number[], nor: number[], c: [number, number, number], h: [number, number, number]): void {
  const [cx, cy, cz] = c;
  const [hx, hy, hz] = h;
  const faces: Array<[number[], number[][]]> = [
    [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
    [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
    [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
    [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
  ];
  for (const [n, q] of faces) {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(cx + q[i][0] * hx, cy + q[i][1] * hy, cz + q[i][2] * hz);
      nor.push(n[0], n[1], n[2]);
    }
  }
}

function crowGeometry(): { body: THREE.BufferGeometry; wing: THREE.BufferGeometry } {
  // (+z forward, the feet at y 0)
  const p: number[] = [];
  const n: number[] = [];
  box(p, n, [0, 0.13, 0], [0.065, 0.06, 0.13]); // the body
  box(p, n, [0, 0.2, 0.13], [0.045, 0.045, 0.05]); // the head
  box(p, n, [0, 0.19, 0.2], [0.012, 0.014, 0.035]); // the beak
  box(p, n, [0, 0.12, -0.17], [0.05, 0.012, 0.07]); // the tail
  box(p, n, [0.025, 0.04, 0.0], [0.008, 0.04, 0.008]); // the legs
  box(p, n, [-0.025, 0.04, 0.0], [0.008, 0.04, 0.008]);
  const body = new THREE.BufferGeometry();
  body.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  body.setAttribute("normal", new THREE.Float32BufferAttribute(n, 3));
  // a wing: a thin slab out along +x from the shoulder (the left wing is the same, turned about y)
  const wp: number[] = [];
  const wn: number[] = [];
  box(wp, wn, [0.14, 0, 0], [0.14, 0.006, 0.075]);
  const wing = new THREE.BufferGeometry();
  wing.setAttribute("position", new THREE.Float32BufferAttribute(wp, 3));
  wing.setAttribute("normal", new THREE.Float32BufferAttribute(wn, 3));
  return { body, wing };
}

export interface WallLife {
  update(dt: number, camera: THREE.Camera, dark: number): void;
  info(): { crows: number; perched: number; flying: number; away: number; kite: boolean };
}

export function buildWallLife(scene: THREE.Scene, d: WallDressing): WallLife {
  const group = new THREE.Group();
  group.name = "wall_life";
  scene.add(group);
  if (!R) return { update() {}, info: () => ({ crows: 0, perched: 0, flying: 0, away: 0, kite: false }) };
  const h = R.h;
  const segs = Object.fromEntries(R.segments.map((s) => [s.name, s]));
  /** A point s along a segment, o out from the town face, at y. */
  const at = (name: string, s: number, o: number, y: number): Perch | null => {
    const g = segs[name];
    if (!g) return null;
    const off = R.t - o;
    return { x: g.o[0] + g.t[0] * s - g.n[0] * off, y, z: g.o[1] + g.t[1] * s - g.n[1] * off };
  };
  const r = rng(18737);

  // ---- the perches of each flock
  const groups: Perch[][] = [];
  const works = d.works ?? { seg: "seg7", s0: 70, s1: 80 };
  {
    const ps: Perch[] = [];
    for (let s = works.s0 - 12; s < works.s1 + 12; s += 1.6) {
      if (s > works.s0 - 0.5 && s < works.s1 + 0.5) continue;
      const p = at(works.seg, s, R.t - BW_IN - 0.2 + r() * 0.3, h + 1.3);
      if (p) ps.push(p);
    }
    for (const s of [works.s0 + 2.5, works.s0 + 3.4, works.s1 - 2.5, works.s1 - 1.7]) {
      const p = at(works.seg, s, R.t - BW_IN - 0.6, h + 0.5);
      if (p) ps.push(p);
    }
    groups.push(ps);
  }
  {
    // the lawn nearest the north-west bastion's salient
    const lw = (d.lawns ?? []).slice().sort((a, b) => Math.hypot(a.ring[0][0] + 380, a.ring[0][1] - 320) - Math.hypot(b.ring[0][0] + 380, b.ring[0][1] - 320))[0];
    if (lw) {
      const xs = lw.ring.map((p) => p[0]);
      const zs = lw.ring.map((p) => p[1]);
      const inPoly = (ring: number[][], x: number, z: number) => {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, zi] = ring[i];
          const [xj, zj] = ring[j];
          if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
        }
        return inside;
      };
      const inRing = (x: number, z: number) => inPoly(lw.ring, x, z) && !lw.paved.some((q) => inPoly(q, x, z));
      const ps: Perch[] = [];
      for (let k = 0; k < 40 && ps.length < 10; k++) {
        const x = Math.min(...xs) + r() * (Math.max(...xs) - Math.min(...xs));
        const z = Math.min(...zs) + r() * (Math.max(...zs) - Math.min(...zs));
        if (inRing(x, z)) ps.push({ x, y: h + 0.01, z });
      }
      groups.push(ps);
    }
  }
  {
    const ps: Perch[] = [];
    for (let s = 60; s < 95; s += 1.8) {
      const p = at("seg2", s, TOWN_T / 2, h + 1.0);
      if (p) ps.push(p);
    }
    groups.push(ps);
  }

  // ---- the crows
  const crows: Crow[] = [];
  groups.forEach((ps, gi) => {
    if (ps.length < 3) return;
    const n = gi === 0 ? 5 : gi === 1 ? 4 : 3;
    const used = new Set<number>();
    for (let k = 0; k < n; k++) {
      let i = Math.floor(r() * ps.length);
      for (let t = 0; t < 8 && used.has(i); t++) i = Math.floor(r() * ps.length);
      used.add(i);
      const p = ps[i];
      crows.push({ g: gi, x: p.x, y: p.y, z: p.z, yaw: r() * Math.PI * 2, state: "perch", t: 0, act: 1 + r() * 3, peck: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), dur: 1, perch: i });
    }
  });
  const { body, wing } = crowGeometry();
  const crowMat = psx(new THREE.MeshLambertMaterial({ color: 0x17181b }), { affine: 0, noSnap: true });
  crowMat.name = "wall_crow";
  const bodies = new THREE.InstancedMesh(body, crowMat, Math.max(1, crows.length));
  const wingsL = new THREE.InstancedMesh(wing, crowMat, Math.max(1, crows.length));
  const wingsR = new THREE.InstancedMesh(wing, crowMat, Math.max(1, crows.length));
  for (const m of [bodies, wingsL, wingsR]) {
    m.name = "wall_crows";
    m.frustumCulled = false;
    m.count = crows.length;
    group.add(m);
  }
  const M = new THREE.Matrix4();
  const Q = new THREE.Quaternion();
  const E = new THREE.Euler();
  const S = new THREE.Vector3();
  const P = new THREE.Vector3();
  const W = new THREE.Matrix4();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  const flyTo = (c: Crow, away: boolean) => {
    c.from.set(c.x, c.y, c.z);
    const ps = groups[c.g];
    if (away) {
      // out over the fields, high
      const a = r() * Math.PI * 2;
      c.to.set(c.x + Math.sin(a) * 60, c.y + 18 + r() * 10, c.z + Math.cos(a) * 60);
    } else {
      let best = c.perch;
      for (let t = 0; t < 10; t++) {
        const i = Math.floor(r() * ps.length);
        if (Math.hypot(ps[i].x - c.x, ps[i].z - c.z) > 8 && !crows.some((o) => o !== c && o.perch === i && o.g === c.g)) {
          best = i;
          break;
        }
      }
      c.perch = best;
      const p = ps[best];
      c.to.set(p.x, p.y, p.z);
    }
    c.dur = Math.max(1.2, c.from.distanceTo(c.to) / 7.5);
    c.t = 0;
    c.state = "fly";
    c.yaw = Math.atan2(c.to.x - c.from.x, c.to.z - c.from.z);
  };

  // ---- the kite: a paper diamond with a tail of bows on a string, drawn only while a child flies it
  const SEGS = 10;
  const kiteGeo = new THREE.BufferGeometry();
  const nTris = 2 + 5 * 2 + SEGS * 2 + 4;
  const kpos = new Float32Array(nTris * 9);
  const kcol = new Float32Array(nTris * 9);
  kiteGeo.setAttribute("position", new THREE.BufferAttribute(kpos, 3).setUsage(THREE.DynamicDrawUsage));
  kiteGeo.setAttribute("color", new THREE.BufferAttribute(kcol, 3));
  const kiteMat = psx(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { affine: 0, noSnap: true });
  kiteMat.name = "wall_kite";
  const kite = new THREE.Mesh(kiteGeo, kiteMat);
  kite.name = "wall_kite";
  kite.frustumCulled = false;
  kite.visible = false;
  group.add(kite);
  let kiteOn = false;
  const WIND = new THREE.Vector3(0.82, 0, -0.57).normalize(); // out over the fields to the north-east

  let clock = 0;
  return {
    update(dt, camera, dark) {
      clock += dt;
      const cp = camera.position;
      const night = dark > 0.62;
      // ---- crows
      crows.forEach((c, i) => {
        const far = Math.hypot(c.x - cp.x, c.z - cp.z) > CROW_REACH;
        if (c.state === "perch") {
          const near = Math.hypot(c.x - cp.x, c.z - cp.z) < FLEE && Math.abs(c.y - cp.y) < 4;
          if (near) flyTo(c, r() < 0.35);
          else if ((c.act -= dt) <= 0) {
            const k = r();
            if (k < 0.45) c.peck = 0.45;
            else if (k < 0.8) c.yaw += (r() - 0.5) * 2.4;
            else {
              // a hop
              const a = c.yaw + (r() - 0.5) * 1.5;
              const ps = groups[c.g][c.perch];
              const nx = c.x + Math.sin(a) * 0.18;
              const nz = c.z + Math.cos(a) * 0.18;
              if (Math.hypot(nx - ps.x, nz - ps.z) < 0.5) {
                c.x = nx;
                c.z = nz;
              }
            }
            c.act = 0.8 + r() * 2.6;
          }
          c.peck = Math.max(0, c.peck - dt);
        } else if (c.state === "fly") {
          c.t += dt;
          const f = Math.min(1, c.t / c.dur);
          const up = Math.sin(f * Math.PI) * Math.min(6, 1.5 + c.from.distanceTo(c.to) * 0.15);
          c.x = c.from.x + (c.to.x - c.from.x) * f;
          c.y = c.from.y + (c.to.y - c.from.y) * f + up;
          c.z = c.from.z + (c.to.z - c.from.z) * f;
          if (f >= 1) {
            if (c.to.y > c.from.y + 10) {
              c.state = "away";
              c.t = 20 + r() * 30;
            } else {
              c.state = "perch";
              c.act = 1 + r() * 2;
            }
          }
        } else if ((c.t -= dt) <= 0) {
          // back from the fields, to a perch of the flock away from Jef
          const ps = groups[c.g];
          const free = ps.map((p, k) => ({ p, k })).filter(({ p }) => Math.hypot(p.x - cp.x, p.z - cp.z) > FLEE * 2);
          if (free.length) {
            const pick = free[Math.floor(r() * free.length)];
            c.perch = pick.k;
            c.from.set(c.x, c.y, c.z);
            c.to.set(pick.p.x, pick.p.y, pick.p.z);
            c.dur = Math.max(1.2, c.from.distanceTo(c.to) / 7.5);
            c.t = 0;
            c.state = "fly";
            c.yaw = Math.atan2(c.to.x - c.from.x, c.to.z - c.from.z);
          } else c.t = 10;
        }
        if (night || far || c.state === "away") {
          bodies.setMatrixAt(i, hidden);
          wingsL.setMatrixAt(i, hidden);
          wingsR.setMatrixAt(i, hidden);
          return;
        }
        const flying = c.state === "fly";
        E.set(flying ? -0.12 : c.peck > 0 ? 0.55 : 0, c.yaw, 0, "YXZ");
        Q.setFromEuler(E);
        S.set(1, 1, 1);
        P.set(c.x, c.y, c.z);
        M.compose(P, Q, S);
        bodies.setMatrixAt(i, M);
        // wings: folded along the body when perched, beating in flight
        const beat = flying ? Math.sin(clock * 17 + i) * 0.9 : 0;
        for (const [im, sg] of [
          [wingsR, 1],
          [wingsL, -1],
        ] as const) {
          W.makeTranslation(0, 0.16, 0);
          if (flying) W.multiply(new THREE.Matrix4().makeRotationZ(sg * beat)).multiply(new THREE.Matrix4().makeScale(sg, 1, 1));
          else W.multiply(new THREE.Matrix4().makeRotationY(sg * 1.45)).multiply(new THREE.Matrix4().makeScale(sg * 0.8, 1, 0.8));
          im.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(M, W));
        }
      });
      for (const m of [bodies, wingsL, wingsR]) m.instanceMatrix.needsUpdate = true;

      // ---- the kite
      const flier = !night && townNear && Math.hypot(KITE_PLACE.x - cp.x, KITE_PLACE.z - cp.z) < 140
        ? townNear(KITE_PLACE.x, KITE_PLACE.z, KITE_PLACE.r + 4).find((q) => q.trade === "child" && q.age <= 14)
        : undefined;
      kiteOn = !!flier;
      kite.visible = kiteOn;
      if (!flier) return;
      const hand = new THREE.Vector3(flier.x + Math.sin(flier.yaw) * 0.3, h + 1.25, flier.z + Math.cos(flier.yaw) * 0.3);
      const sway = Math.sin(clock * 0.7) * 1.6 + Math.sin(clock * 1.9) * 0.5;
      const side = new THREE.Vector3(-WIND.z, 0, WIND.x);
      const kc = hand.clone().addScaledVector(WIND, 13).addScaledVector(side, sway).add(new THREE.Vector3(0, 11 + Math.sin(clock * 1.1) * 0.8, 0));
      let v = 0;
      const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, col: [number, number, number]) => {
        for (const p of [a, b, c]) {
          kpos[v * 3] = p.x;
          kpos[v * 3 + 1] = p.y;
          kpos[v * 3 + 2] = p.z;
          kcol[v * 3] = col[0];
          kcol[v * 3 + 1] = col[1];
          kcol[v * 3 + 2] = col[2];
          v++;
        }
      };
      // the diamond, facing back into the wind, leaning
      const up = new THREE.Vector3(0, 1, 0).addScaledVector(WIND, 0.45).normalize();
      const across = side.clone().multiplyScalar(Math.cos(sway * 0.2)).add(new THREE.Vector3(0, Math.sin(sway * 0.2) * 0.3, 0)).normalize();
      const top = kc.clone().addScaledVector(up, 0.75);
      const bot = kc.clone().addScaledVector(up, -0.6);
      const L = kc.clone().addScaledVector(across, -0.5).addScaledVector(up, 0.15);
      const Rt = kc.clone().addScaledVector(across, 0.5).addScaledVector(up, 0.15);
      tri(top, L, bot, [0.62, 0.12, 0.1]);
      tri(top, bot, Rt, [0.85, 0.72, 0.3]);
      // the tail: bows hanging down and downwind from the foot, swinging
      let prev = bot.clone();
      for (let k = 1; k <= 5; k++) {
        const q = bot.clone().add(new THREE.Vector3(0, -0.5 * k, 0)).addScaledVector(WIND, 0.25 * k).addScaledVector(side, Math.sin(clock * 3 + k * 0.9) * 0.18 * k);
        const w = 0.09;
        tri(q.clone().addScaledVector(across, -w), q.clone().addScaledVector(across, w), q.clone().add(new THREE.Vector3(0, 0.06, 0)), k % 2 ? [0.9, 0.88, 0.8] : [0.62, 0.12, 0.1]);
        tri(prev.clone().addScaledVector(across, -0.008), prev.clone().addScaledVector(across, 0.008), q, [0.2, 0.18, 0.15]);
        prev = q;
      }
      // the string: sagging from the hand to the kite's middle, a thin ribbon
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= SEGS; k++) {
        const f = k / SEGS;
        pts.push(hand.clone().lerp(kc, f).add(new THREE.Vector3(0, -Math.sin(f * Math.PI) * 1.4, 0)));
      }
      const wv = side.clone().multiplyScalar(0.012).add(new THREE.Vector3(0, 0.012, 0));
      for (let k = 0; k < SEGS; k++) {
        const a = pts[k];
        const b = pts[k + 1];
        tri(a.clone().sub(wv), b.clone().sub(wv), b.clone().add(wv), [0.14, 0.13, 0.12]);
        tri(a.clone().sub(wv), b.clone().add(wv), a.clone().add(wv), [0.14, 0.13, 0.12]);
      }
      kiteGeo.setDrawRange(0, v);
      kiteGeo.attributes.position.needsUpdate = true;
      kiteGeo.attributes.color.needsUpdate = true;
      kiteGeo.computeVertexNormals();
    },
    info() {
      return {
        crows: crows.length,
        perched: crows.filter((c) => c.state === "perch").length,
        flying: crows.filter((c) => c.state === "fly").length,
        away: crows.filter((c) => c.state === "away").length,
        kite: kiteOn,
      };
    },
  };
}
