import type { Rect } from "./geom";

/** Actual model triangles, before render batching. Indexed geometry must be expanded by the caller. */
type Points = ArrayLike<number>;
type V = [number, number, number];
const EPS = 1e-6;
const CELL = 0.75;

/** Shared by all copies of a prototype; only placement transforms differ. */
export class ModelCollision {
  readonly bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  private triangles: V[][] = [];
  private cells = new Map<string, number[]>();
  private scaled = new Map<string, ModelCollision>();

  atScale(sx: number, sy: number, sz: number): ModelCollision {
    if (sx === 1 && sy === 1 && sz === 1) return this;
    const key = `${sx},${sy},${sz}`;
    let shape = this.scaled.get(key);
    if (!shape) {
      const points: number[] = [];
      for (const t of this.triangles) for (const v of sx * sy * sz < 0 ? [t[0], t[2], t[1]] : t)
        points.push(v[0] * sx, v[1] * sy, v[2] * sz);
      shape = new ModelCollision([points]);
      this.scaled.set(key, shape);
    }
    return shape;
  }

  constructor(parts: Points[]) {
    for (const p of parts) for (let i = 0; i + 8 < p.length; i += 9) {
      const t: V[] = [[p[i], p[i + 1], p[i + 2]], [p[i + 3], p[i + 4], p[i + 5]], [p[i + 6], p[i + 7], p[i + 8]]];
      if (!t.every(v => v.every(Number.isFinite))) continue;
      const id = this.triangles.push(t) - 1;
      for (const v of t) for (let k = 0; k < 3; k++) {
        this.bounds[k] = Math.min(this.bounds[k], v[k]);
        this.bounds[k + 3] = Math.max(this.bounds[k + 3], v[k]);
      }
      const x0 = Math.floor(Math.min(...t.map(v => v[0])) / CELL), x1 = Math.floor(Math.max(...t.map(v => v[0])) / CELL);
      const z0 = Math.floor(Math.min(...t.map(v => v[2])) / CELL), z1 = Math.floor(Math.max(...t.map(v => v[2])) / CELL);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const key = `${x},${z}`, list = this.cells.get(key);
        if (list) list.push(id); else this.cells.set(key, [id]);
      }
    }
  }

  /** The exact highest point of a triangle inside a horizontal disk. */
  private height(t: V[], x: number, z: number, r: number): number {
    let h = -Infinity;
    const rr = r * r;
    for (let i = 0; i < t.length; i++) {
      const a = t[i], b = t[(i + 1) % t.length];
      const ax = a[0] - x, az = a[2] - z;
      if (ax * ax + az * az <= rr + EPS) h = Math.max(h, a[1]);
      const dx = b[0] - a[0], dz = b[2] - a[2];
      const A = dx * dx + dz * dz, B = ax * dx + az * dz;
      const D = B * B - A * (ax * ax + az * az - rr);
      if (A > EPS && D >= -EPS) for (const sign of [-1, 1]) {
        const u = (-B + sign * Math.sqrt(Math.max(0, D))) / A;
        if (u >= 0 && u <= 1) h = Math.max(h, a[1] + u * (b[1] - a[1]));
      }
    }
    // A whole disk can be inside a broad face without touching any edge. Height is linear
    // across its plane: its maximum lies at the disk's edge in the gradient direction.
    const a = t[0], b = t[1], c = t[2];
    const dx = b[0] - a[0], dz = b[2] - a[2], ex = c[0] - a[0], ez = c[2] - a[2];
    const det = dx * ez - dz * ex;
    if (Math.abs(det) > EPS) {
      const gx = ((b[1] - a[1]) * ez - (c[1] - a[1]) * dz) / det;
      const gz = (dx * (c[1] - a[1]) - ex * (b[1] - a[1])) / det;
      const len = Math.hypot(gx, gz);
      const px = x + (len > EPS ? r * gx / len : 0), pz = z + (len > EPS ? r * gz / len : 0);
      if (inside(t, px, pz)) h = Math.max(h, a[1] + gx * (px - a[0]) + gz * (pz - a[2]));
      if (inside(t, x, z)) h = Math.max(h, a[1] + gx * (x - a[0]) + gz * (z - a[2]));
    }
    return h;
  }

  private candidates(x: number, z: number, r: number): Set<number> {
    const ids = new Set<number>();
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++)
      for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++)
        for (const id of this.cells.get(`${i},${j}`) ?? []) ids.add(id);
    return ids;
  }

  blocks(x: number, z: number, r: number, low: number, high: number): boolean {
    for (const id of this.candidates(x, z, r)) {
      const t = this.triangles[id];
      if (Math.max(...t.map(v => v[1])) <= low + EPS || Math.min(...t.map(v => v[1])) >= high) continue;
      const polygon = clip(clip(t, low + EPS, true), high, false);
      if (polygon.length >= 3 && diskHits(polygon, x, z, r)) return true;
    }
    return false;
  }

  topAt(x: number, z: number, r: number, ceiling: number): number {
    let top = -Infinity;
    for (const id of this.candidates(x, z, r)) {
      const t = this.triangles[id];
      // Only upward-facing surfaces support feet; walls and undersides are not steps.
      const a = t[0], b = t[1], c = t[2];
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      if (ny <= EPS) continue;
      const h = this.height(t, x, z, r);
      if (h <= ceiling + EPS) top = Math.max(top, h);
    }
    return top;
  }
}

function clip(poly: V[], y: number, above: boolean): V[] {
  const out: V[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ai = above ? a[1] >= y : a[1] <= y, bi = above ? b[1] >= y : b[1] <= y;
    if (ai) out.push(a);
    if (ai !== bi) {
      const u = (y - a[1]) / (b[1] - a[1]);
      out.push([a[0] + u * (b[0] - a[0]), y, a[2] + u * (b[2] - a[2])]);
    }
  }
  return out;
}

function inside(poly: V[], x: number, z: number): boolean {
  let positive = false, negative = false, area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const cross = (b[0] - a[0]) * (z - a[2]) - (b[2] - a[2]) * (x - a[0]);
    positive ||= cross > EPS; negative ||= cross < -EPS;
    area += a[0] * b[2] - b[0] * a[2];
  }
  return Math.abs(area) > EPS && !(positive && negative);
}

function diskHits(poly: V[], x: number, z: number, r: number): boolean {
  if (inside(poly, x, z)) return true;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dz = b[2] - a[2];
    const u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz || 1)));
    if ((a[0] + u * dx - x) ** 2 + (a[2] + u * dz - z) ** 2 <= r * r + EPS) return true;
  }
  return false;
}

const cache = new WeakMap<object, ModelCollision>();
export function modelShape(key: object, parts: () => Points[]): ModelCollision {
  let shape = cache.get(key);
  if (!shape) { shape = new ModelCollision(parts()); cache.set(key, shape); }
  return shape;
}

/** Keep an AABB for the world's broad phase and placement checks, exact triangles for movement. */
export function modelCollider(shape: ModelCollision, x: number, z: number, yaw: number, y = 0, sx = 1, sy = 1, sz = 1): Rect {
  // Uniformly scaled instances (trees in particular) can share their triangle grid exactly.
  if (!(sx > 0 && sx === sy && sy === sz)) return modelCollider(shape.atScale(sx, sy, sz), x, z, yaw, y);
  const c = Math.cos(yaw), s = Math.sin(yaw), b = shape.bounds;
  const xs: number[] = [], zs: number[] = [];
  for (const lx of [b[0] * sx, b[3] * sx]) for (const lz of [b[2] * sz, b[5] * sz]) {
    xs.push(x + lx * c + lz * s); zs.push(z - lx * s + lz * c);
  }
  const local = (px: number, pz: number): [number, number] => [((px - x) * c - (pz - z) * s) / sx, ((px - x) * s + (pz - z) * c) / sx];
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), top: y + b[4] * sy,
    surface: {
      blocks(px, pz, r, feet, step) { const [lx, lz] = local(px, pz); return shape.blocks(lx, lz, r / sx, (feet + step - y) / sx, (feet + 1.75 - y) / sx); },
      topAt(px, pz, r, ceiling) { const [lx, lz] = local(px, pz); return y + sx * shape.topAt(lx, lz, r / sx, (ceiling - y) / sx); },
    },
  };
}
