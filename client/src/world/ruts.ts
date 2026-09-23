import * as THREE from "three";
import { psx } from "../retro/psx";
import { dirtAlong } from "./dirt";

// Wheel ruts (Steve, 2026-09-23: "wheel ruts should be painted on top so they flow and
// seem to create roads"). The carts of the city wear the same lines every day: from the
// Werf along the quays, up to the Grote Markt, round the Petit Bassin. Each road is
// found on the walk map, down the middle of the streets (a path search that pays more
// near walls), smoothed into a flowing curve, and painted on the ground as two ruts
// with the trodden line of the horse between them.

type Flags = (x: number, z: number) => number | undefined;
type P = [number, number];

/** Roads the carts take: waypoints, in order (world x, z). */
const ROADS: P[][] = [
  // the quay road behind the railway: the Werf, the Steenplein, the Vismarkt, the Rijnkaai
  // (over the Vismarkt it keeps to the omnibus lane at z 8.3, clear of the market and its lamps)
  [[-336, 11], [-262, 10], [-205, 8.5], [-160, 12], [-140, 8.3], [-132, 8.3], [-124, 8.3], [-116, 8.3], [-108, 8.3], [-100, 8.3], [-92, 8.3], [-60, 17], [0, 18], [60, 24], [96, 27]],
  // from the quays up to the Grote Markt
  [[-270, 10], [-254, 60], [-254, 94]],
  [[-180, 20], [-230, 40], [-254, 94]],
  [[-118, 30], [-118, 70], [-190, 90], [-254, 94]],
  // the Grote Markt, the Handschoenmarkt, the cathedral front
  [[-254, 94], [-262, 130], [-262, 170]],
  // along the east quay of the canal
  [[-60, 17], [-64, 80], [-64, 160]],
  // the Rijnkaai to the Petit Bassin and round to the Entrepot
  [[40, 22], [74, 118], [120, 119], [172, 118], [173, 60]],
];

const X0 = -340;
const Z0 = -80;
const W = 540;
const H = 380;

function rutTexture(): THREE.CanvasTexture {
  const S = 64;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  let seed = 77;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  g.clearRect(0, 0, S, S);
  // canvas x runs along the road (one tile = 4 m), y across it (2.4 m)
  const line = (y: number, w: number, a: number, col: string) => {
    for (let x = 0; x < S; x++) {
      const wob = Math.sin((x / S) * Math.PI * 2) * 0.8 + (r() - 0.5) * 0.6;
      const k = 0.75 + r() * 0.5;
      g.fillStyle = `rgba(${col},${(a * k).toFixed(3)})`;
      g.fillRect(x, Math.round(y + wob - w / 2), 1, w);
    }
  };
  // the horse's line in the middle: a wide faint trodden band
  line(S / 2, 16, 0.16, "30,24,16");
  for (const y of [S * 0.19, S * 0.81]) {
    line(y - 4, 2, 0.2, "120,104,80"); // the mud pushed up beside the rut
    line(y + 4, 2, 0.2, "120,104,80");
    line(y, 6, 0.5, "28,22,15");
    line(y, 3, 0.6, "12,10,8");
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Metres to the nearest wall or water, per 1 m cell (0 = not open). */
function clearance(flags: Flags): Float32Array {
  const d = new Float32Array(W * H).fill(1e9);
  const q: number[] = [];
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      if (flags(X0 + i + 0.5, Z0 + j + 0.5) !== 0) {
        d[j * W + i] = 0;
        q.push(j * W + i);
      }
    }
  // breadth first from every closed cell (4 neighbours: a city-block distance, fine here)
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    const i = c % W;
    const j = (c / W) | 0;
    const n = d[c] + 1;
    if (i > 0 && d[c - 1] > n) (d[c - 1] = n), q.push(c - 1);
    if (i < W - 1 && d[c + 1] > n) (d[c + 1] = n), q.push(c + 1);
    if (j > 0 && d[c - W] > n) (d[c - W] = n), q.push(c - W);
    if (j < H - 1 && d[c + W] > n) (d[c + W] = n), q.push(c + W);
  }
  return d;
}

/** A path down the middle of the streets from a to b, as cell centres; null if none. */
function route(clear: Float32Array, a: P, b: P): P[] | null {
  const N = W * H;
  const g = new Float32Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const heap: number[] = [];
  const f = new Float32Array(N);
  const cell = (p: P) => Math.floor(p[1] - Z0) * W + Math.floor(p[0] - X0);
  const s = cell(a);
  const t = cell(b);
  if (s < 0 || t < 0 || s >= N || t >= N) return null;
  const ti = t % W;
  const tj = (t / W) | 0;
  const hfun = (c: number) => Math.hypot((c % W) - ti, ((c / W) | 0) - tj);
  const push = (c: number) => {
    heap.push(c);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (f[heap[p]] <= f[heap[i]]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l;
        if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  // the cost of a step: dear near walls, cheap in the middle of a street or square
  const cost = (c: number) => 1 + 3 / Math.max(0.5, clear[c] - 1);
  g[s] = 0;
  f[s] = hfun(s);
  push(s);
  const done = new Uint8Array(N);
  while (heap.length) {
    const c = pop();
    if (done[c]) continue;
    done[c] = 1;
    if (c === t) break;
    const i = c % W;
    const j = (c / W) | 0;
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const n = nj * W + ni;
        if (done[n] || clear[n] < 1.5) continue;
        const ng = g[c] + (di && dj ? 1.414 : 1) * cost(n);
        if (ng < g[n]) {
          g[n] = ng;
          f[n] = ng + hfun(n);
          from[n] = c;
          push(n);
        }
      }
  }
  if (from[t] < 0) return null;
  const out: P[] = [];
  for (let c = t; c !== -1; c = from[c]) out.push([X0 + (c % W) + 0.5, Z0 + ((c / W) | 0) + 0.5]);
  return out.reverse();
}

/** Every k-th point, then corner cutting: a flowing line. */
function smooth(pts: P[]): P[] {
  let p: P[] = pts.filter((_, i) => i % 5 === 0 || i === pts.length - 1);
  for (let it = 0; it < 3; it++) {
    const q: P[] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az] = p[i];
      const [bx, bz] = p[i + 1];
      q.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

/** The ruts as one ribbon along the line, faded in and out at the ends. */
function ribbon(line: P[], width: number, pos: number[], uv: number[], col: number[]): void {
  const n = line.length;
  if (n < 2) return;
  let total = 0;
  const along: number[] = [0];
  for (let i = 1; i < n; i++) along.push((total += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1])));
  const side = (i: number): P => {
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(n - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
  };
  const fade = (s: number) => Math.min(1, s / 6, (total - s) / 6);
  for (let i = 0; i < n - 1; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const [nax, naz] = side(i);
    const [nbx, nbz] = side(i + 1);
    const h = width / 2;
    const A0: P = [ax - nax * h, az - naz * h];
    const A1: P = [ax + nax * h, az + naz * h];
    const B0: P = [bx - nbx * h, bz - nbz * h];
    const B1: P = [bx + nbx * h, bz + nbz * h];
    const ua = along[i] / 4;
    const ub = along[i + 1] / 4;
    const fa = fade(along[i]);
    const fb = fade(along[i + 1]);
    const tri = (p: P, u: number, v: number, a: number) => {
      pos.push(p[0], 0, p[1]);
      uv.push(u, v);
      col.push(1, 1, 1, a);
    };
    // wound to face up
    tri(A0, ua, 0, fa);
    tri(B1, ub, 1, fb);
    tri(B0, ub, 0, fb);
    tri(A0, ua, 0, fa);
    tri(A1, ua, 1, fa);
    tri(B1, ub, 1, fb);
  }
}

/**
 * Find the cart roads on the walk map and paint the ruts. Runs a road at a time
 * between frames, so loading does not stall.
 */
export function buildRuts(scene: THREE.Scene, flags: Flags): Promise<THREE.Mesh> {
  return new Promise((resolve) => {
    const clear = clearance(flags);
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const legs: Array<[P, P]> = [];
    for (const road of ROADS) for (let i = 0; i < road.length - 1; i++) legs.push([road[i], road[i + 1]]);
    const lines: P[][] = [];
    let k = 0;
    const next = () => {
      if (k < legs.length) {
        const [a, b] = legs[k++];
        const p = route(clear, a, b);
        // a road is one flowing line: join its legs before smoothing
        if (p) {
          const last = lines[lines.length - 1];
          if (last && last[last.length - 1][0] === p[0][0] && last[last.length - 1][1] === p[0][1]) last.push(...p.slice(1));
          else lines.push(p);
        }
        setTimeout(next, 0);
        return;
      }
      const smoothLines = lines.map(smooth);
      for (const l of smoothLines) ribbon(l, 2.4, pos, uv, col);
      // mud and dung along the same roads, in the paving itself
      dirtAlong(smoothLines);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
      g.computeVertexNormals();
      const mat = psx(
        new THREE.MeshLambertMaterial({
          map: rutTexture(),
          vertexColors: true,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -3,
        }),
        { noSnap: true, affine: 0 },
      );
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = "ruts";
      mesh.renderOrder = 1;
      scene.add(mesh);
      resolve(mesh);
    };
    next();
  });
}
