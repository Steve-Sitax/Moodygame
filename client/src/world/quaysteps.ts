import * as THREE from "three";
import { psx } from "../retro/psx";
import type { Rect } from "./geom";

// Stone steps down the quay walls to the water, and iron ladders to climb out
// (Steve, 2026-09-23: "stairs that go to water like in some sample images, also
// ladders to get out"). All built in code from the quay lines of shared/city.json:
// no Blender run needed. A flight runs down along the wall face, out over the
// water, with a stepped parapet on its open side, to a landing just above the
// water; an iron ladder hangs off the landing's end. Ladders on the walls have
// the usual hoop over the edge to grab.

type V3 = [number, number, number];

/** A frame on a quay wall: origin on the wall face, t along the wall, n out over the water. */
export interface Frame {
  ox: number;
  oz: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
}

export const frameAt = (ox: number, oz: number, tx: number, tz: number, nx: number, nz: number): Frame => ({ ox, oz, tx, tz, nx, nz });
/** World axes as a frame: s = x, u = z. */
export const WORLD: Frame = frameAt(0, 0, 1, 0, 0, 1);

const onFrame = (f: Frame, s: number, u: number): [number, number] => [f.ox + f.tx * s + f.nx * u, f.oz + f.tz * s + f.nz * u];
const toFrame = (f: Frame, x: number, z: number): [number, number] => {
  const dx = x - f.ox;
  const dz = z - f.oz;
  return [dx * f.tx + dz * f.tz, dx * f.nx + dz * f.nz];
};

/** Colour by height: green slime at the waterline, a wet dark band above it, dry stone higher up. */
export function slimeShade(waterY: number, dry: V3 = [1, 1, 1]): (y: number) => V3 {
  const stops: Array<[number, V3]> = [
    [waterY - 0.4, [0.24, 0.29, 0.2]],
    [waterY + 0.15, [0.3, 0.37, 0.24]],
    [waterY + 0.8, [0.52, 0.53, 0.47]],
    [waterY + 1.5, dry],
  ];
  return (y) => {
    if (y <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      const [y1, c1] = stops[i];
      if (y <= y1) {
        const [y0, c0] = stops[i - 1];
        const k = (y - y0) / (y1 - y0);
        return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
      }
    }
    return dry;
  };
}

/** Heights where the slime colours change: tall faces are cut there so the bands stay sharp. */
export const slimeCuts = (waterY: number) => [waterY - 0.4, waterY + 0.15, waterY + 0.8, waterY + 1.5];

/**
 * A merged mesh built from boxes and rods, with world-space UVs and a colour per
 * vertex from its height (slime at the waterline). One draw call per material.
 */
export class Geo {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];

  constructor(
    private readonly shade: (y: number) => V3 = () => [1, 1, 1],
    private readonly tile = 2,
    private readonly cuts: number[] = [],
  ) {}

  get empty(): boolean {
    return this.pos.length === 0;
  }

  private vert(p: V3, n: V3, tint?: V3): void {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    const ax = Math.abs(n[0]);
    const ay = Math.abs(n[1]);
    const az = Math.abs(n[2]);
    const t = this.tile;
    if (ay >= ax && ay >= az) this.uv.push(p[0] / t, p[2] / t);
    else if (ax >= az) this.uv.push(p[2] / t, p[1] / t);
    else this.uv.push(p[0] / t, p[1] / t);
    const c = this.shade(p[1]);
    const k = tint ?? [1, 1, 1];
    this.col.push(c[0] * k[0], c[1] * k[1], c[2] * k[2]);
  }

  /** A flat quad (corners in order round the edge) that faces along n. */
  quad(a: V3, b: V3, c: V3, d: V3, n: V3, tint?: V3): void {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1];
    const cy = e1[2] * e2[0] - e1[0] * e2[2];
    const cz = e1[0] * e2[1] - e1[1] * e2[0];
    const q = cx * n[0] + cy * n[1] + cz * n[2] >= 0 ? [a, b, c, d] : [a, d, c, b];
    for (const i of [0, 1, 2, 0, 2, 3]) this.vert(q[i], n, tint);
  }

  /** A box in a wall frame: s along the wall, u out over the water, y up. Tall sides are cut at the slime heights. */
  box(f: Frame, s0: number, s1: number, u0: number, u1: number, y0: number, y1: number, tint?: V3, bottom = true): void {
    const P = (s: number, u: number, y: number): V3 => {
      const [x, z] = onFrame(f, s, u);
      return [x, y, z];
    };
    const T: V3 = [f.tx, 0, f.tz];
    const N: V3 = [f.nx, 0, f.nz];
    const neg = (v: V3): V3 => [-v[0], -v[1], -v[2]];
    this.quad(P(s0, u0, y1), P(s1, u0, y1), P(s1, u1, y1), P(s0, u1, y1), [0, 1, 0], tint);
    if (bottom) this.quad(P(s0, u0, y0), P(s1, u0, y0), P(s1, u1, y0), P(s0, u1, y0), [0, -1, 0], tint);
    const ys = [y0, ...this.cuts.filter((c) => c > y0 + 0.01 && c < y1 - 0.01), y1];
    for (let i = 0; i < ys.length - 1; i++) {
      const a = ys[i];
      const b = ys[i + 1];
      this.quad(P(s0, u0, a), P(s0, u1, a), P(s0, u1, b), P(s0, u0, b), neg(T), tint);
      this.quad(P(s1, u0, a), P(s1, u1, a), P(s1, u1, b), P(s1, u0, b), T, tint);
      this.quad(P(s0, u0, a), P(s1, u0, a), P(s1, u0, b), P(s0, u0, b), neg(N), tint);
      this.quad(P(s0, u1, a), P(s1, u1, a), P(s1, u1, b), P(s0, u1, b), N, tint);
    }
  }

  /** Any three.js geometry (a pile, a brace), placed by a matrix. */
  add(g: THREE.BufferGeometry, m: THREE.Matrix4, tint?: V3): void {
    const flat = (g.index ? g.toNonIndexed() : g).clone().applyMatrix4(m);
    const p = flat.getAttribute("position");
    const n = flat.getAttribute("normal");
    for (let i = 0; i < p.count; i++) this.vert([p.getX(i), p.getY(i), p.getZ(i)], [n.getX(i), n.getY(i), n.getZ(i)], tint);
    flat.dispose();
  }

  /** A round post or beam from a to b. */
  rod(a: THREE.Vector3, b: THREE.Vector3, r: number, sides = 6, segs = 1, tint?: V3): void {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len, sides, segs);
    const m = new THREE.Matrix4().compose(
      a.clone().add(b).multiplyScalar(0.5),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()),
      new THREE.Vector3(1, 1, 1),
    );
    this.add(g, m, tint);
    g.dispose();
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** A place to climb out of the water: a ladder rung or the edge of a landing. */
export interface Exit {
  kind: "ladder" | "landing";
  /** Where the swimmer holds on (in the water, in front of the ladder or the landing edge). */
  gx: number;
  gz: number;
  /** Out of the wall, toward the swimmer. */
  nx: number;
  nz: number;
  /** Where you stand when you are out: the quay, the pier deck or the landing. */
  tx: number;
  tz: number;
  ty: number;
}

interface Stair {
  f: Frame;
  /** Length of the flight along the wall, then the landing. */
  flight: number;
  land: number;
  landY: number;
}

// sizes of a flight (metres)
const TREAD = 0.32;
const WIDTH = 1.3; // walkable width of the treads
const PARAPET = 0.32; // the low wall on the open side
const LANDING = 2.4;
const INTO_WALL = 0.4; // every block runs this far into the quay wall: no seam against it
const RAIL_H = 1.0;

export interface QuaySteps {
  /** Height of a step or landing under (x, z), or null when not on a flight. `landing` tells which. */
  heightAt(x: number, z: number): { y: number; landing: boolean } | null;
  /** Stone of a flight (steps, parapet, landing) within pad metres: solid for a swimmer. */
  solidAt(x: number, z: number, pad: number): boolean;
  /** The nearest place to climb out within reach, or null. */
  exitNear(x: number, z: number, reach: number): Exit | null;
  /** Rails and ladder hoops on the quay: they block walking. */
  colliders: Rect[];
  /** Every ladder's foot, for the report and the dev hook. */
  ladders: Array<{ x: number; z: number; top: number }>;
  /** Every flight: top of the steps, and the landing's far end. */
  flights: Array<{ top: [number, number]; end: [number, number] }>;
  /** Stone and iron outlines on the water, for the foam along the walls: [x0, z0, x1, z1]. */
  outlines: number[][];
  /** Add a flight of steps down a quay wall: top at (x, z) on the wall line, going down along t, water side n. */
  addFlight(x: number, z: number, tx: number, tz: number, nx: number, nz: number): void;
  /** Add an iron ladder on a wall face (frame f, at s), from under the water up to topY. Climbing out puts you `inset` metres in from the edge. */
  addLadder(f: Frame, s: number, topY: number, inset?: number): void;
  /** Build what was added since the last call into the scene (one mesh per material). */
  flush(scene: THREE.Object3D): void;
}

export function quaySteps(waterY: number, tex: { stone: THREE.Texture; iron: THREE.Texture }): QuaySteps {
  const bedY = waterY - 1.5;
  const landY = waterY + 0.4;
  const steps = Math.max(4, Math.round(-landY / 0.185));
  const rise = -landY / steps;
  const flightLen = steps * TREAD;
  const cuts = slimeCuts(waterY);

  const stoneMat = psx(new THREE.MeshLambertMaterial({ map: tex.stone, vertexColors: true }), { affine: 0.3 });
  const ironMat = psx(new THREE.MeshLambertMaterial({ map: tex.iron, vertexColors: true }), { affine: 0.3 });
  let stone = new Geo(slimeShade(waterY), 2, cuts);
  let iron = new Geo(slimeShade(waterY, [0.9, 0.86, 0.82]), 1, cuts);

  const stairs: Stair[] = [];
  const exits: Exit[] = [];
  const colliders: Rect[] = [];
  const ladders: QuaySteps["ladders"] = [];
  const flights: QuaySteps["flights"] = [];
  const outlines: number[][] = [];

  /** A rect on the ground for a stretch of a frame (frames here run along the world axes). */
  const rectOn = (f: Frame, s0: number, s1: number, u0: number, u1: number): Rect => {
    const [ax, az] = onFrame(f, s0, u0);
    const [bx, bz] = onFrame(f, s1, u1);
    return { minX: Math.min(ax, bx), maxX: Math.max(ax, bx), minZ: Math.min(az, bz), maxZ: Math.max(az, bz) };
  };

  function addLadder(f: Frame, s: number, topY: number, inset = 0.9): void {
    const half = 0.23;
    const u0 = 0.11; // stiles stand this far off the wall
    const u1 = 0.16;
    const foot = waterY - 1.1;
    const top = topY + 0.95; // the hoop over the edge, to grab
    for (const side of [-1, 1]) {
      const sc = s + side * half;
      iron.box(f, sc - 0.025, sc + 0.025, u0, u1, foot, top);
      iron.box(f, sc - 0.025, sc + 0.025, -0.36, u1, top - 0.05, top); // over the edge
      iron.box(f, sc - 0.025, sc + 0.025, -0.36, -0.31, topY, top - 0.05); // down into the stone
      for (let y = foot + 0.5; y < topY; y += 1.1) iron.box(f, sc - 0.02, sc + 0.02, 0, u0, y, y + 0.04); // wall brackets
      colliders.push(rectOn(f, sc - 0.05, sc + 0.05, -0.38, -0.29));
    }
    for (let y = foot + 0.25; y < topY - 0.1; y += 0.3) iron.box(f, s - half, s + half, 0.12, 0.15, y, y + 0.035);
    const [gx, gz] = onFrame(f, s, 0.55);
    const [tx, tz] = onFrame(f, s, -inset);
    exits.push({ kind: "ladder", gx, gz, nx: f.nx, nz: f.nz, tx, tz, ty: topY });
    const [lx, lz] = onFrame(f, s, 0);
    ladders.push({ x: +lx.toFixed(1), z: +lz.toFixed(1), top: topY });
  }

  function addFlight(x: number, z: number, tx: number, tz: number, nx: number, nz: number): void {
    const f = frameAt(x, z, tx, tz, nx, nz);
    const W = WIDTH + PARAPET;
    const end = flightLen + LANDING;
    const u0 = -INTO_WALL;
    // the steps: solid masonry from the river bed, bonded into the wall
    for (let i = 0; i < steps; i++) stone.box(f, i * TREAD, (i + 1) * TREAD, u0, WIDTH, bedY, -(i + 1) * rise, undefined, false);
    // the landing, just above the water: a floor of big slabs with a lighter edge stone
    stone.box(f, flightLen, end, u0, W, bedY, landY - 0.06, undefined, false);
    const slabs = 3;
    for (let k = 0; k < slabs; k++) {
      const a = flightLen + (LANDING * k) / slabs;
      const b = flightLen + (LANDING * (k + 1)) / slabs;
      const tone = k % 2 ? 0.93 : 1;
      stone.box(f, a + 0.01, b - 0.01, u0, W - 0.2, landY - 0.06, landY, [tone, tone * 0.98, tone * 0.95], false);
    }
    // the edge stones round the open side and the end: a low kerb you can still climb over
    stone.box(f, flightLen, end, W - 0.2, W, landY - 0.06, landY + 0.12, [1.08, 1.06, 1.0], false);
    stone.box(f, end - 0.2, end, u0, W - 0.2, landY - 0.06, landY + 0.12, [1.08, 1.06, 1.0], false);
    // the parapet on the open side: follows the steps, never higher than a kerb at the top
    for (let i = 0; i < steps; i++) {
      const top = Math.min(-(i + 1) * rise + 0.85, 0.3);
      stone.box(f, i * TREAD, (i + 1) * TREAD, WIDTH, W, bedY, top, undefined, false);
      stone.box(f, i * TREAD, (i + 1) * TREAD, WIDTH - 0.04, W + 0.04, top, top + 0.07, [0.9, 0.88, 0.84], false); // coping
    }
    // the parapet runs on past the last tread onto the landing, then ends in a squared pier
    {
      const top = landY + 0.85;
      const s1 = flightLen + 0.7;
      stone.box(f, flightLen, s1, WIDTH, W, bedY, top, undefined, false);
      stone.box(f, flightLen, s1 + 0.04, WIDTH - 0.04, W + 0.04, top, top + 0.07, [0.9, 0.88, 0.84], false);
    }
    // an iron rail along the quay edge over the flight, open at the top where you step down
    const r0 = 1.25;
    const r1 = end;
    const uR = -0.14;
    const n = Math.max(2, Math.round((r1 - r0) / 1.4));
    for (let i = 0; i <= n; i++) {
      const s = r0 + ((r1 - r0) * i) / n;
      iron.box(f, s - 0.03, s + 0.03, uR - 0.03, uR + 0.03, 0.05, RAIL_H);
    }
    for (const y of [0.55, RAIL_H - 0.04]) iron.box(f, r0, r1, uR - 0.025, uR + 0.025, y, y + 0.045);
    colliders.push(rectOn(f, r0 - 0.05, r1 + 0.05, uR - 0.08, uR + 0.08));
    // an iron ladder off the end of the landing
    const endFrame = frameAt(...onFrame(f, end, 0), f.nx, f.nz, f.tx, f.tz);
    addLadder(endFrame, W / 2, landY, 0.8);
    // swimmers climb onto the landing from its open side and its end
    for (const [s, u] of [[flightLen + 0.5, W], [flightLen + LANDING / 2, W], [end - 0.5, W]] as const) {
      const [gx, gz] = onFrame(f, s, u + 0.5);
      const [ttx, ttz] = onFrame(f, s, W - 0.6);
      exits.push({ kind: "landing", gx, gz, nx: f.nx, nz: f.nz, tx: ttx, tz: ttz, ty: landY });
    }
    stairs.push({ f, flight: flightLen, land: LANDING, landY });
    flights.push({ top: [x, z], end: onFrame(f, end, 0).map((v) => +v.toFixed(1)) as [number, number] });
    // the outline on the water (for the foam)
    const c = [onFrame(f, 0, 0), onFrame(f, 0, W), onFrame(f, end, W), onFrame(f, end, 0)];
    for (let i = 0; i < 3; i++) outlines.push([...c[i], ...c[i + 1]]);
  }

  function heightAt(x: number, z: number): { y: number; landing: boolean } | null {
    for (const st of stairs) {
      const [s, u] = toFrame(st.f, x, z);
      if (s < 0 || u < 0 || s > st.flight + st.land) continue;
      if (s <= st.flight) {
        // a smooth slope through the middle of the treads: the camera glides down
        if (u <= WIDTH) return { y: (st.landY * s) / st.flight, landing: false };
        continue;
      }
      // the parapet's end pier on the landing is stone, not floor (like the parapet along the steps)
      if (s <= st.flight + 0.7 && u > WIDTH) continue;
      if (u <= WIDTH + PARAPET) return { y: st.landY, landing: true };
    }
    return null;
  }

  function solidAt(x: number, z: number, pad: number): boolean {
    for (const st of stairs) {
      const [s, u] = toFrame(st.f, x, z);
      if (s > -pad && s < st.flight + st.land + pad && u > -0.5 && u < WIDTH + PARAPET + pad) return true;
    }
    return false;
  }

  function exitNear(x: number, z: number, reach: number): Exit | null {
    let best: Exit | null = null;
    let bd = reach;
    for (const e of exits) {
      const d = Math.hypot(e.gx - x, e.gz - z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  function flush(scene: THREE.Object3D): void {
    for (const [geo, mat, name] of [[stone, stoneMat, "quay_steps"], [iron, ironMat, "quay_iron"]] as const) {
      if (geo.empty) continue;
      const mesh = new THREE.Mesh(geo.build(), mat);
      mesh.name = name;
      scene.add(mesh);
    }
    stone = new Geo(slimeShade(waterY), 2, cuts);
    iron = new Geo(slimeShade(waterY, [0.9, 0.86, 0.82]), 1, cuts);
  }

  return { heightAt, solidAt, exitNear, colliders, ladders, flights, outlines, addFlight, addLadder, flush };
}

/**
 * Distance to the nearest wall on the water, as a texture (R: 0..8 m in 0..1),
 * for the foam and the lighter water along the quays. `box` = x0, z0, width, depth.
 */
export function shoreTexture(segments: number[][], box: [number, number, number, number], res = 0.5): THREE.DataTexture {
  const [x0, z0, w, h] = box;
  const W = Math.ceil(w / res);
  const H = Math.ceil(h / res);
  const MAX = 8;
  const d = new Float32Array(W * H).fill(MAX);
  for (const [ax, az, bx, bz] of segments) {
    const L2 = (bx - ax) ** 2 + (bz - az) ** 2;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - MAX - x0) / res));
    const i1 = Math.min(W - 1, Math.ceil((Math.max(ax, bx) + MAX - x0) / res));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - MAX - z0) / res));
    const j1 = Math.min(H - 1, Math.ceil((Math.max(az, bz) + MAX - z0) / res));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const px = x0 + (i + 0.5) * res;
        const pz = z0 + (j + 0.5) * res;
        const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / L2)) : 0;
        const dist = Math.hypot(px - (ax + (bx - ax) * t), pz - (az + (bz - az) * t));
        const k = j * W + i;
        if (dist < d[k]) d[k] = dist;
      }
  }
  const px = new Uint8Array(W * H);
  for (let k = 0; k < px.length; k++) px[k] = Math.round((d[k] / MAX) * 255);
  const t = new THREE.DataTexture(px, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}
