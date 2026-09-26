import * as THREE from "three";

// Every solid prop the town sets down in its streets, yards and quays (barrels, crates, casks, sacks,
// baskets, benches, carts, pumps, troughs, heaps, tubs, chairs ...), as a list the dev prop check reads
// (dev/propcheck.ts, `await __scheldemist.propcheck()`). The places that build them (world/clutter.ts,
// streetlife.ts, quaygoods.ts, quayfurniture.ts, litter.ts, trades.ts, townplaces.ts, game/backlife.ts ...)
// add each copy here with where it stands and its model's points; nothing is computed until the check
// runs. Stalls, shop tables and the goods set out before shops are the stall check's (game/stallSpots.ts).

/** A model's points in its own frame (x along, y up, z out of its front). */
export type Pts = ArrayLike<number>;

export interface PropThing {
  /** The layer that set it down ("clutter", "quay goods", "litter" ...). */
  src: string;
  /** The model. */
  name: string;
  x: number;
  y: number;
  z: number;
  /** three.js yaw: the model's +z looks along (sin yaw, cos yaw). */
  yaw: number;
  /** Scale along the model's x, y, z. */
  s?: [number, number, number];
  /** The model's points (every part), in its own frame. */
  pts: Pts[];
  /** Things of one heap, one stack or one set (a cart and its load): they may touch and stand on each other. */
  set?: string;
  /** It stands on another thing of its set (not on the ground). */
  onTop?: boolean;
}

export const propThings: PropThing[] = [];

export function addProp(t: PropThing): void {
  propThings.push(t);
}

/** Forget what a layer put in before (a rebuild). */
export function dropProps(src: string): void {
  for (let i = propThings.length - 1; i >= 0; i--) if (propThings[i].src === src) propThings.splice(i, 1);
}

const boxCache = new WeakMap<object, number[]>();
/** A model's bounds in its own frame [x0, y0, z0, x1, y1, z1] (cached per point array). */
export function ptsBox(pts: Pts[]): number[] {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    let c = boxCache.get(p as object);
    if (!c) {
      c = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let i = 0; i + 2 < p.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          c[k] = Math.min(c[k], p[i + k]);
          c[k + 3] = Math.max(c[k + 3], p[i + k]);
        }
      }
      boxCache.set(p as object, c);
    }
    for (let k = 0; k < 3; k++) {
      b[k] = Math.min(b[k], c[k]);
      b[k + 3] = Math.max(b[k + 3], c[k + 3]);
    }
  }
  return b;
}

const objCache = new Map<string, Float32Array>();
const v3 = new THREE.Vector3();
/** A model's points in its own frame (its meshes under it, the object's own place and turn left out): cached by `key`. */
export function objectPts(o: THREE.Object3D, key = o.name): Float32Array {
  let out = key ? objCache.get(key) : undefined;
  if (out) return out;
  o.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(o.matrixWorld).invert();
  const M = new THREE.Matrix4();
  const pts: number[] = [];
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const P = m.geometry.getAttribute("position");
    if (!P) return;
    M.multiplyMatrices(inv, m.matrixWorld);
    for (let i = 0; i < P.count; i++) {
      v3.fromBufferAttribute(P, i).applyMatrix4(M);
      pts.push(v3.x, v3.y, v3.z);
    }
  });
  out = new Float32Array(pts);
  if (key) objCache.set(key, out);
  return out;
}

/** Put a placed object (a clone of a model, its own place and turn) on the list; `name` when the object has none of its own. */
export function addPropObject(src: string, o: THREE.Object3D, set?: string, name = o.name): void {
  const s = o.scale;
  addProp({ src, name, x: o.position.x, y: o.position.y, z: o.position.z, yaw: o.rotation.y, s: [s.x, s.y, s.z], pts: [objectPts(o, name)], set, onTop: o.position.y > 0.05 });
}

/** A prop's footprint on the ground plan as a turned box: centre, axes, half sizes, and its height span. */
export interface PropBox {
  t: PropThing;
  cx: number;
  cz: number;
  ux: number;
  uz: number;
  nx: number;
  nz: number;
  hu: number;
  hn: number;
  y0: number;
  y1: number;
}

/** The turned box of a prop as placed. */
export function propBox(t: PropThing): PropBox | null {
  const b = ptsBox(t.pts);
  if (!Number.isFinite(b[0])) return null;
  const [sx, sy, sz] = t.s ?? [1, 1, 1];
  const u0 = Math.min(b[0] * sx, b[3] * sx), u1 = Math.max(b[0] * sx, b[3] * sx);
  const v0 = Math.min(b[2] * sz, b[5] * sz), v1 = Math.max(b[2] * sz, b[5] * sz);
  const c = Math.cos(t.yaw), s = Math.sin(t.yaw);
  const mu = (u0 + u1) / 2, mv = (v0 + v1) / 2;
  return { t, cx: t.x + mu * c + mv * s, cz: t.z - mu * s + mv * c, ux: c, uz: -s, nx: s, nz: c, hu: (u1 - u0) / 2, hn: (v1 - v0) / 2, y0: t.y + Math.min(b[1] * sy, b[4] * sy), y1: t.y + Math.max(b[1] * sy, b[4] * sy) };
}

/** Do two turned boxes overlap on the ground plan and in height (by more than `pad`)? */
export function boxHit(a: Omit<PropBox, "t">, b: Omit<PropBox, "t">, pad = 0.02): boolean {
  if (a.y0 >= b.y1 - pad || b.y0 >= a.y1 - pad) return false;
  const dx = b.cx - a.cx, dz = b.cz - a.cz;
  for (const [kx, kz] of [[a.ux, a.uz], [a.nx, a.nz], [b.ux, b.uz], [b.nx, b.nz]]) {
    const ra = a.hu * Math.abs(a.ux * kx + a.uz * kz) + a.hn * Math.abs(a.nx * kx + a.nz * kz);
    const rb = b.hu * Math.abs(b.ux * kx + b.uz * kz) + b.hn * Math.abs(b.nx * kx + b.nz * kz);
    if (Math.abs(dx * kx + dz * kz) >= ra + rb - pad) return false;
  }
  return true;
}

/**
 * The props on the list now (of other layers than `except`), in a grid: `hit(box)` gives the first one a new
 * thing's box would go into, or null. For a layer placed after others: nothing of its own into theirs.
 * Very small things (a crust, a shard) and things standing on others do not count.
 */
export function propIndex(except: string): { hit(b: Omit<PropBox, "t">, pad?: number): PropThing | null } {
  const G = 4;
  const grid = new Map<string, PropBox[]>();
  for (const t of propThings) {
    if (t.src === except || t.onTop) continue;
    const b = propBox(t);
    if (!b || b.y1 - b.y0 < 0.2 || 4 * b.hu * b.hn < 0.04) continue;
    const k = `${Math.floor(b.cx / G)},${Math.floor(b.cz / G)}`;
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push(b);
  }
  return {
    hit(b, pad = 0.02) {
      const gx = Math.floor(b.cx / G), gz = Math.floor(b.cz / G);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const o of grid.get(`${gx + i},${gz + j}`) ?? []) if (boxHit(b, o, pad)) return o.t;
      return null;
    },
  };
}
