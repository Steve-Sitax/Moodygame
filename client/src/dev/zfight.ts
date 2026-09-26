import * as THREE from "three";
import { WALL } from "../world/city";

// The z-fight check (dev, `await __scheldemist.zfight()`): every pair of faces in the static world, as
// placed in the game, that lie in one plane and overlap, so the depth buffer cannot tell which is in
// front and the two flicker and zig-zag (Steve, 2026-09-24: a white plaster front over a brick one on
// the Rijnkaai). It reads the scene itself: the houses (city.glb), the landmarks, the ground, quay
// furniture, clutter, street life, bridges, the lock, stalls and the rest, each where the game put it
// (instances too). Moving things (people, boats, carts, cranes, traffic) and the water are left out.
//
// A pair: normals parallel within `angle` degrees (either way round), overlap above `minArea` m2, and
// nothing in the materials to settle it (a polygonOffset on one of the two; two see-through decals
// that write no depth blend and never fight). Two back-to-back faces only fight when the one facing
// away is drawn double-sided. By the distance between the planes over the overlap:
//   fights: within `one` (5 mm): one plane, they flicker at any distance (Steve's houses);
//   thin:   a layer over a surface facing the same way, within `gap` (2 cm): plates, planks, bills;
//   close:  the same within `near` (5 cm).
// Why thin and close matter: with the PS1 wobble (vertices jump to the pixel grid, settings "wobble")
// a face's depth moves by up to half a pixel of its depth slope, 0.5 * d * 0.0049 m at d metres seen at
// 45 degrees: 1 cm at 4 m, 7 cm at 30 m, so two separate faces that near fight when seen askew. The
// depth buffer itself (24 bit, near 0.08 m) is good to 0.7 mm at 30 m. polygonOffset (slope-scaled)
// is the cure for layers; for one plane the fix is not to build two faces there.
// Hidden (counted apart): from every side where both are drawn the overlap is inside a house (the walk
// map's walls, 0.8 m off) or covered by something within 1.5 m in front of it.
// Goal: `fights` 0. On 2026-09-25 the houses are down to 4 small pairs; the other models still have
// their own (docs/milestones/M3c.md, pass 5).

export interface ZFightOpts {
  /** Normals parallel within this many degrees. */
  angle?: number;
  /** Planes nearer than this (m) over the overlap are one plane: they fight from any distance. */
  one?: number;
  /** A layer nearer than this (m) to its surface is "thin": the wobble makes it fight past a few metres. */
  gap?: number;
  /** Layers nearer than this (m) are "close". */
  near?: number;
  /** Overlaps smaller than this (m2) are ignored. */
  minArea?: number;
  /** How many of each list to return. */
  list?: number;
  /** Surfaces whose label matches count as if they had no polygonOffset (to see what a material fix
   * settles: `zfight({ noOffset: "streetlife|quay_steps" })`). */
  noOffset?: string;
  /** Surfaces whose label matches count as if they wrote depth. */
  writeDepth?: string;
  /** Dev: details of the pairs at this point. */
  debugAt?: Array<[number, number, number]>;
  /** Also list the hidden ones. */
  hidden?: boolean;
}

export interface ZFightItem {
  cause: string;
  x: number;
  y: number;
  z: number;
  area: number;
  gap: number;
  a: string;
  b: string;
  houses?: string;
  hidden?: boolean;
}

interface Src {
  label: string;
  kind: string;
  mat: THREE.Material;
  double: boolean;
  depthWrite: boolean;
  offset: number; // polygonOffset factor + units, 0 when off
}

/** Roots of the scene that move or are not world geometry. */
const MOVING_MESH = /^(ambient_birds|.*_flag|.*smoke.*)$/;
const MOVING = /^(river_traffic|moored|brig|barque|steamer|paddle_tug|sloop|tug|rhine_barge|lighter|lighter_loaded|hengst|rowboat|punt|portal_crane|hand_crane|horses|omnibuses|traffic|emigrants|handcart.*|dray.*|pushcart|wheelbarrow|fires|lively|chain_buckets|gas_lamp_halos|lantern_.*|trees_falling|velocipede.*)$/;

interface Wall {
  house: number;
  ax: number;
  az: number;
  ux: number;
  uz: number;
  ox: number;
  oz: number;
  L: number;
  H: number;
  style: string;
}

let wallCache: Wall[] | null = null;
async function houseWalls(): Promise<Wall[]> {
  if (wallCache) return wallCache;
  type H = { rect: boolean; fp: number[][]; o?: number[]; u?: number[]; n?: number[]; s?: number[]; t?: number[]; h: number; style: string; gone?: boolean };
  const plan = (await import("../../../shared/city_build.json")).default as unknown as { houses: H[] };
  const out: Wall[] = [];
  plan.houses.forEach((h, hi) => {
    if (h.gone) return; // (pulled down: not built)
    let ring: number[][];
    if (h.rect && h.o && h.u && h.n && h.s && h.t) {
      const [ox, oz] = h.o, [ux, uz] = h.u, [nx, nz] = h.n;
      const P = (s: number, t: number) => [ox + ux * s + nx * t, oz + uz * s + nz * t];
      ring = [P(h.s[0], h.t[0]), P(h.s[1], h.t[0]), P(h.s[1], h.t[1]), P(h.s[0], h.t[1])];
    } else ring = h.fp;
    const n = ring.length;
    let area = 0;
    for (let i = 0; i < n; i++) area += ring[i][0] * ring[(i + 1) % n][1] - ring[(i + 1) % n][0] * ring[i][1];
    for (let i = 0; i < n; i++) {
      const [ax, az] = ring[i];
      const [bx, bz] = ring[(i + 1) % n];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      let ox = uz, oz = -ux;
      if (area < 0) (ox = -ox), (oz = -oz);
      out.push({ house: hi, ax, az, ux, uz, ox, oz, L, H: h.h, style: h.style });
    }
  });
  wallCache = out;
  return out;
}

/** The plan's houses whose walls run through a point in this direction (for the report). */
function housesAt(walls: Wall[], x: number, z: number, nx: number, nz: number): string {
  const hit = new Set<string>();
  for (const w of walls) {
    if (Math.abs(w.ox * nx + w.oz * nz) < 0.999) continue;
    const d = (x - w.ax) * w.ox + (z - w.az) * w.oz;
    const s = (x - w.ax) * w.ux + (z - w.az) * w.uz;
    if (Math.abs(d) < 0.03 && s > -0.05 && s < w.L + 0.05) hit.add(`#${w.house} ${w.style}`);
  }
  return [...hit].join(", ");
}

function kindOf(o: THREE.Object3D, root: THREE.Object3D): string {
  if (/^city_-?\d+_-?\d+/.test(o.name)) return "houses";
  if (o.name.startsWith("landmark_")) return "landmark " + o.name.replace(/^landmark_/, "").replace(/_\d+$/, "");
  if (o.name.startsWith("ground_")) return "ground";
  if (root.name === "city" && !o.name) return "quay walls";
  return root.name || o.name || root.type;
}

export async function checkZFight(scene: THREE.Scene, flags: (x: number, z: number) => number | undefined, opts: ZFightOpts = {}) {
  const t0 = performance.now();
  const ANG = Math.cos(((opts.angle ?? 1) * Math.PI) / 180);
  const COMP = Math.sin(((opts.angle ?? 1) * Math.PI) / 180) * 1.5; // a component may differ this much
  const ONE = opts.one ?? 0.005;
  const GAP = opts.gap ?? 0.02;
  const NEAR = opts.near ?? 0.05;
  const MINA = opts.minArea ?? 0.01;
  const LIST = opts.list ?? 40;
  const noOffset = opts.noOffset ? new RegExp(opts.noOffset) : null;
  const writeDepth = opts.writeDepth ? new RegExp(opts.writeDepth) : null;
  const walls = await houseWalls();

  // --- 1. the triangles, in world space
  const srcs: Src[] = [];
  const srcOf = new Map<string, number>();
  let cap = 1 << 18;
  let pos = new Float64Array(cap * 9);
  let tsrc = new Int32Array(cap);
  let nT = 0;
  const grow = () => {
    cap *= 2;
    const p = new Float64Array(cap * 9);
    p.set(pos);
    pos = p;
    const s = new Int32Array(cap);
    s.set(tsrc);
    tsrc = s;
  };
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  const im = new THREE.Matrix4(), wm = new THREE.Matrix4();
  scene.updateMatrixWorld(true);
  for (const root of scene.children) {
    if (MOVING.test(root.name) || (root as THREE.Camera).isCamera) continue;
    // a person (a skinned body) and everything in its group moves
    let person = false;
    root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) person = true;
    });
    if (person) continue;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh || MOVING_MESH.test(m.name)) return;
      // switched off by the game (stand-ins, hidden props); the city chunks are switched by distance
      if (!/^city_/.test(m.name)) {
        for (let p: THREE.Object3D | null = m; p; p = p.parent) if (!p.visible) return;
      }
      const g = m.geometry as THREE.BufferGeometry;
      const P = g.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (!P) return;
      const idx = g.index;
      const nIdx = idx ? idx.count : P.count;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const groups = g.groups.length ? g.groups : [{ start: 0, count: nIdx, materialIndex: 0 }];
      const inst = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh) : null;
      const count = inst ? inst.count : 1;
      const kind = kindOf(m, root);
      for (const gr of groups) {
        const mat = mats[gr.materialIndex ?? 0] ?? mats[0];
        if (!mat || !mat.visible || mat.colorWrite === false) continue;
        if ((mat.userData?.psx as { water?: boolean } | undefined)?.water) continue;
        if (mat.transparent && mat.opacity < 0.02) continue;
        for (let k = 0; k < count; k++) {
          const key = `${m.uuid}:${gr.materialIndex ?? 0}:${k}`;
          let si = srcOf.get(key);
          if (si === undefined) {
            si = srcs.length;
            srcOf.set(key, si);
            const mname = (m.name || m.parent?.name || "").slice(0, 40);
            const label = `${root.name || root.type}/${mname}${mats.length > 1 ? `[${gr.materialIndex}]` : ""}${inst ? `#${k}` : ""}`;
            const noOff = !!noOffset && noOffset.test(label);
            const wd = !!writeDepth && writeDepth.test(label);
            srcs.push({
              label,
              kind,
              mat,
              double: mat.side === THREE.DoubleSide,
              depthWrite: wd || (mat.depthWrite && mat.depthTest),
              offset: !noOff && mat.polygonOffset ? mat.polygonOffsetFactor + mat.polygonOffsetUnits : 0,
            });
          }
          if (inst) {
            inst.getMatrixAt(k, im);
            wm.multiplyMatrices(m.matrixWorld, im);
          } else wm.copy(m.matrixWorld);
          const end = Math.min(nIdx, gr.start + gr.count);
          for (let i = gr.start; i + 2 < end; i += 3) {
            const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
            va.fromBufferAttribute(P, i0).applyMatrix4(wm);
            vb.fromBufferAttribute(P, i1).applyMatrix4(wm);
            vc.fromBufferAttribute(P, i2).applyMatrix4(wm);
            if (nT >= cap) grow();
            const o9 = nT * 9;
            pos[o9] = va.x; pos[o9 + 1] = va.y; pos[o9 + 2] = va.z;
            pos[o9 + 3] = vb.x; pos[o9 + 4] = vb.y; pos[o9 + 5] = vb.z;
            pos[o9 + 6] = vc.x; pos[o9 + 7] = vc.y; pos[o9 + 8] = vc.z;
            tsrc[nT++] = si;
          }
        }
      }
    });
  }

  // --- 2. normals, areas, bounds; drop slivers
  const nrm = new Float64Array(nT * 3);
  const box = new Float64Array(nT * 6);
  const keep = new Uint8Array(nT);
  for (let t = 0; t < nT; t++) {
    const o = t * 9;
    const e1x = pos[o + 3] - pos[o], e1y = pos[o + 4] - pos[o + 1], e1z = pos[o + 5] - pos[o + 2];
    const e2x = pos[o + 6] - pos[o], e2y = pos[o + 7] - pos[o + 1], e2z = pos[o + 8] - pos[o + 2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz);
    if (l / 2 < 2e-4) continue;
    nx /= l; ny /= l; nz /= l;
    nrm[t * 3] = nx; nrm[t * 3 + 1] = ny; nrm[t * 3 + 2] = nz;
    const b = t * 6;
    for (let a = 0; a < 3; a++) {
      const v0 = pos[o + a], v1 = pos[o + 3 + a], v2 = pos[o + 6 + a];
      box[b + a] = Math.min(v0, v1, v2) - NEAR;
      box[b + 3 + a] = Math.max(v0, v1, v2) + NEAR;
    }
    keep[t] = 1;
  }

  // --- 3. a grid of 2 m cells; a pair is looked at in the one cell holding the low corner of the
  // overlap of their bounds, so each pair once. Big triangles (the ground, the far bank, the sky)
  // go into a coarse grid of 32 m and are met from there.
  const C = 2, CB = 32;
  const cellKey = (ix: number, iy: number, iz: number) => ((ix + 2048) * 4096 + (iy + 2048)) * 4096 + (iz + 2048);
  const grid = new Map<number, number[]>();
  const coarse = new Map<number, number[]>();
  const cellsOf = (t: number, c: number, fn: (k: number) => void) => {
    const b = t * 6;
    const x0 = Math.floor(box[b] / c), y0 = Math.floor(box[b + 1] / c), z0 = Math.floor(box[b + 2] / c);
    const x1 = Math.floor(box[b + 3] / c), y1 = Math.floor(box[b + 4] / c), z1 = Math.floor(box[b + 5] / c);
    for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) for (let iz = z0; iz <= z1; iz++) fn(cellKey(ix, iy, iz));
  };
  const nCells = (t: number, c: number) => {
    const b = t * 6;
    return (Math.floor(box[b + 3] / c) - Math.floor(box[b] / c) + 1) * (Math.floor(box[b + 4] / c) - Math.floor(box[b + 1] / c) + 1) * (Math.floor(box[b + 5] / c) - Math.floor(box[b + 2] / c) + 1);
  };
  const add = (g: Map<number, number[]>, t: number) => (k: number) => {
    const l = g.get(k);
    if (l) l.push(t);
    else g.set(k, [t]);
  };
  const big = new Uint8Array(nT);
  for (let t = 0; t < nT; t++) {
    if (!keep[t]) continue;
    if (nCells(t, C) > 2048) {
      if (nCells(t, CB) > 20000) continue; // the sky dome
      big[t] = 1;
      cellsOf(t, CB, add(coarse, t));
    } else cellsOf(t, C, add(grid, t));
  }
  // every small triangle meets the big ones in its coarse cells too
  const coarseAll = new Map<number, number[]>(coarse);
  for (let t = 0; t < nT; t++) {
    if (!keep[t] || big[t]) continue;
    cellsOf(t, CB, (k) => {
      const l = coarseAll.get(k);
      if (l) {
        if (l === coarse.get(k)) coarseAll.set(k, [...l, t]);
        else l.push(t);
      }
    });
  }

  /** Does anything cut the segment from (x, y, z) along n for len metres? */
  const blocked = (x: number, y: number, z: number, nx: number, ny: number, nz: number, len: number): boolean => {
    const ex = x + nx * len, ey = y + ny * len, ez = z + nz * len;
    const seen = new Set<number>();
    const test = (t: number) => {
      if (seen.has(t)) return false;
      seen.add(t);
      return segTri(x, y, z, ex, ey, ez, pos, t * 9);
    };
    // walk the ray in quarter-cell steps (every triangle sits in each cell its grown bounds touch)
    const cells = new Set<number>();
    const steps = Math.ceil(len / (C * 0.25));
    for (let i = 0; i <= steps; i++) {
      const f = Math.min(1, i / steps);
      const k = cellKey(Math.floor((x + (ex - x) * f) / C), Math.floor((y + (ey - y) * f) / C), Math.floor((z + (ez - z) * f) / C));
      if (cells.has(k)) continue;
      cells.add(k);
      for (const t of grid.get(k) ?? []) if (test(t)) return true;
    }
    const csteps = Math.ceil(len / (CB * 0.5));
    for (let i = 0; i <= csteps; i++) {
      const f = Math.min(1, i / csteps);
      const k = cellKey(Math.floor((x + (ex - x) * f) / CB), Math.floor((y + (ey - y) * f) / CB), Math.floor((z + (ez - z) * f) / CB));
      if (cells.has(-k)) continue;
      cells.add(-k);
      for (const t of coarse.get(k) ?? []) if (test(t)) return true;
    }
    return false;
  };

  /** Is a point closed in: inside a box or behind a board (out along n something within 1.5 m, and
   * three of four rays across n meet something), or inside a long box (out along n something within
   * 30 m, across n three of four within 1.5 m: a box may have no bottom)? */
  const enclosed = (x: number, y: number, z: number, nx: number, ny: number, nz: number): boolean => {
    // two directions across n
    let tx = -nz, ty = 0, tz = nx;
    if (Math.hypot(tx, tz) < 0.3) (tx = 1), (ty = 0), (tz = 0);
    const tl = Math.hypot(tx, ty, tz);
    tx /= tl; ty /= tl; tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    const dirs = [[nx, ny, nz], [tx, ty, tz], [-tx, -ty, -tz], [bx, by, bz], [-bx, -by, -bz]];
    // straight out: something within 1.5 m (the box's own far side, a board's face); across: anything
    // within 30 m (a long kerb's ends, the ground under it)
    if (blocked(x, y, z, nx, ny, nz, 1.5)) {
      let n = 0;
      for (let i = 1; i < 5; i++) if (blocked(x, y, z, dirs[i][0], dirs[i][1], dirs[i][2], 30)) n++;
      if (n >= 3) return true; // in a box (a kerb, a board), one side may be open (no bottom, the map's edge)
    }
    // in a tube: the far end of a long box (two cornices meeting end to end) and its sides all round
    return blocked(x, y, z, nx, ny, nz, 30) && dirs.slice(1).filter(([dx, dy, dz]) => blocked(x, y, z, dx, dy, dz, 1.5)).length >= 3;

  };

  // --- 4. pairs: parallel, one plane, overlapping
  const fights: ZFightItem[] = [];
  const close: ZFightItem[] = [];
  const thin: ZFightItem[] = [];
  const debug: unknown[] = [];
  let handled = 0;
  let pairs = 0;
  const A2: number[][] = [], B2: number[][] = [];
  for (const [G, Cg] of [[grid, C], [coarseAll, CB]] as Array<[Map<number, number[]>, number]>)
  for (const [key, list] of G) {
    if (list.length < 2) continue;
    const iz = (key % 4096) - 2048;
    const iy = (Math.floor(key / 4096) % 4096) - 2048;
    const ix = Math.floor(key / 4096 / 4096) - 2048;
    list.sort((p, q) => Math.abs(nrm[p * 3]) - Math.abs(nrm[q * 3]));
    for (let ia = 0; ia < list.length; ia++) {
      const a = list[ia];
      const anx = nrm[a * 3], any = nrm[a * 3 + 1], anz = nrm[a * 3 + 2];
      for (let ib = ia + 1; ib < list.length; ib++) {
        const b = list[ib];
        const bnx = nrm[b * 3], bny = nrm[b * 3 + 1], bnz = nrm[b * 3 + 2];
        if (Math.abs(bnx) - Math.abs(anx) > COMP) break;
        if (Math.abs(Math.abs(bny) - Math.abs(any)) > COMP || Math.abs(Math.abs(bnz) - Math.abs(anz)) > COMP) continue;
        const dot = anx * bnx + any * bny + anz * bnz;
        if (Math.abs(dot) < ANG) continue;
        // in the coarse grid only pairs with a big one; the pair's own cell
        if (Cg === CB && !big[a] && !big[b]) continue;
        const ba = a * 6, bb = b * 6;
        if (Math.floor(Math.max(box[ba], box[bb]) / Cg) !== ix || Math.floor(Math.max(box[ba + 1], box[bb + 1]) / Cg) !== iy || Math.floor(Math.max(box[ba + 2], box[bb + 2]) / Cg) !== iz) continue;
        let skip = false;
        for (let k = 0; k < 3 && !skip; k++) if (box[ba + k] > box[bb + 3 + k] || box[bb + k] > box[ba + 3 + k]) skip = true;
        if (skip) continue;
        const sa = srcs[tsrc[a]], sb = srcs[tsrc[b]];
        // back to back and both drawn one-sided: each is seen only from its own side
        if (dot < 0 && !sa.double && !sb.double) continue;
        // neither writes depth (see-through decals): they blend, they do not fight
        if (!sa.depthWrite && !sb.depthWrite) continue;
        pairs++;
        // plane of a: origin, u, w
        const oa = a * 9, ob = b * 9;
        const px = pos[oa], py = pos[oa + 1], pz = pos[oa + 2];
        let ux = pos[oa + 3] - px, uy = pos[oa + 4] - py, uz = pos[oa + 5] - pz;
        const ul = Math.hypot(ux, uy, uz);
        ux /= ul; uy /= ul; uz /= ul;
        const wx = any * uz - anz * uy, wy = anz * ux - anx * uz, wz = anx * uy - any * ux;
        A2.length = 0;
        B2.length = 0;
        for (let v = 0; v < 3; v++) {
          const ax_ = pos[oa + v * 3] - px, ay_ = pos[oa + v * 3 + 1] - py, az_ = pos[oa + v * 3 + 2] - pz;
          A2.push([ax_ * ux + ay_ * uy + az_ * uz, ax_ * wx + ay_ * wy + az_ * wz]);
          const bx_ = pos[ob + v * 3] - px, by_ = pos[ob + v * 3 + 1] - py, bz_ = pos[ob + v * 3 + 2] - pz;
          B2.push([bx_ * ux + by_ * uy + bz_ * uz, bx_ * wx + by_ * wy + bz_ * wz]);
        }
        const poly = clip(ccw(B2), ccw(A2));
        const area = polyArea(poly);
        if (area < MINA) continue;
        // how far b's plane lies from a's over the overlap (along a's normal)
        const dB = bnx * pos[ob] + bny * pos[ob + 1] + bnz * pos[ob + 2];
        let gmin = Infinity, gmax = -Infinity, cx = 0, cw = 0;
        for (const [s, w] of poly) {
          const qx = px + ux * s + wx * w, qy = py + uy * s + wy * w, qz = pz + uz * s + wz * w;
          const h = (dB - (bnx * qx + bny * qy + bnz * qz)) / dot;
          gmin = Math.min(gmin, h);
          gmax = Math.max(gmax, h);
          cx += s;
          cw += w;
        }
        cx /= poly.length;
        cw /= poly.length;
        const g = Math.max(Math.abs(gmin), Math.abs(gmax));
        // one plane: g <= ONE. A layer over a surface facing the same way: thin up to GAP, close up to NEAR
        const tier = g <= ONE ? 0 : dot > 0 && Math.sign(gmin) === Math.sign(gmax) ? (g <= GAP ? 1 : g <= NEAR ? 2 : 3) : 3;
        if (tier === 3) continue;
        const layered = tier > 0;
        if (sa.offset !== sb.offset) {
          handled++;
          continue;
        }
        const x = px + ux * cx + wx * cw, y = py + uy * cx + wy * cw, z = pz + uz * cx + wz * cw;
        // hidden: from every side where both faces are drawn, the overlap is inside a house (the walk
        // map's walls) or covered by something right in front of it
        const sides: number[] = [];
        if (dot > 0) {
          sides.push(1);
          if (sa.double && sb.double) sides.push(-1);
        } else {
          if (sb.double) sides.push(1);
          if (sa.double) sides.push(-1);
        }
        const samples = [[x, y, z]];
        for (let k = 0; k < poly.length; k += Math.max(1, Math.floor(poly.length / 3))) {
          const [s, w] = poly[k];
          const sx = px + ux * s + wx * w, sy = py + uy * s + wy * w, sz = pz + uz * s + wz * w;
          samples.push([x + (sx - x) * 0.5, y + (sy - y) * 0.5, z + (sz - z) * 0.5]);
        }
        const start = (layered ? Math.max(gmax, -gmin) : ONE) + 0.002;
        const hidden = !sides.some((sd) => {
          const nx = anx * sd, ny = any * sd, nz = anz * sd;
          if (Math.abs(ny) < 0.3) {
            const f = flags(x + nx * 0.8, z + nz * 0.8) ?? 0;
            if (f & WALL && y < 30) return false;
          } else if (ny > 0 && y < 0.3 && (flags(x, z) ?? 0) & WALL) return false;
          if (ny < -0.9 && y < 0.05) return false; // the underside of the ground
          return samples.some(([qx, qy, qz]) => !enclosed(qx + nx * start, qy + ny * start, qz + nz * start, nx, ny, nz));
        });
        if (opts.debugAt?.some((d) => Math.hypot(x - d[0], y - d[1], z - d[2]) < 0.05))
          debug.push({ at: [x, y, z], n: [anx, any, anz], sides, a: sa.label, b: sb.label, dot, samples, start, res: sides.map((sd) => samples.map(([qx, qy, qz]) => enclosed(qx + anx * sd * start, qy + any * sd * start, qz + anz * sd * start, anx * sd, any * sd, anz * sd))) });
        const item: ZFightItem = {
          cause: cause(sa, sb, anx, any, anz, dot, y, layered),
          x: +x.toFixed(2),
          y: +y.toFixed(2),
          z: +z.toFixed(2),
          area: +area.toFixed(3),
          gap: +(g * 100).toFixed(1), // cm
          a: sa.label,
          b: sb.label,
        };
        if (sa.kind === "houses" || sb.kind === "houses") item.houses = housesAt(walls, x, z, anx, anz);
        if (hidden) item.hidden = true;
        (tier === 0 ? fights : tier === 1 ? thin : close).push(item);
      }
    }
  }

  const sum = (items: ZFightItem[]) => {
    const by: Record<string, { n: number; area: number; hidden: number }> = {};
    for (const f of items) {
      const k = by[f.cause] ?? (by[f.cause] = { n: 0, area: 0, hidden: 0 });
      k.n++;
      k.area = +(k.area + f.area).toFixed(2);
      if (f.hidden) k.hidden++;
    }
    return by;
  };
  const order = (items: ZFightItem[]) =>
    items
      .filter((f) => opts.hidden || !f.hidden)
      .sort((p, q) => q.area - p.area)
      .slice(0, LIST);
  const seen = fights.filter((f) => !f.hidden).length;
  return {
    ms: Math.round(performance.now() - t0),
    triangles: nT,
    surfaces: srcs.length,
    pairsLooked: pairs,
    /** Fights a camera can see: must be 0. */
    fights: seen,
    hidden: fights.length - seen,
    thin: thin.filter((f) => !f.hidden).length,
    close: close.filter((f) => !f.hidden).length,
    handledByPolygonOffset: handled,
    byCause: sum(fights),
    thinByCause: sum(thin),
    closeByCause: sum(close),
    list: order(fights),
    thinList: order(thin),
    debug,
    closeList: order(close),
  };
}

function cause(a: Src, b: Src, nx: number, ny: number, nz: number, dot: number, y: number, layered: boolean): string {
  void nx;
  void nz;
  const vert = Math.abs(ny) < 0.05, flat = Math.abs(ny) > 0.95;
  if (a.kind === "houses" && b.kind === "houses") {
    if (vert) {
      if (dot < 0) return "houses: walls back to back (party walls)";
      return y < 4.2 ? "houses: ground storey faces in one plane (doors, sills, kerbs)" : "houses: fronts in one plane (plots overlap)";
    }
    return flat ? "houses: flat tops, copings" : "houses: roofs";
  }
  const [p, q] = [a.kind, b.kind].sort();
  if (p === "ground" || q === "ground") return `ground layers: ground + ${p === "ground" ? q : p}`;
  const what = layered ? "layer on" : dot < 0 ? "back to back" : vert ? "walls" : flat ? "flat" : "sloped";
  return p === q ? `${p}: ${what} (own parts)` : `${p} + ${q}: ${what}`;
}

/** Segment p..q against triangle o (9 numbers in pos): Moller-Trumbore. */
function segTri(px: number, py: number, pz: number, qx: number, qy: number, qz: number, pos: Float64Array, o: number): boolean {
  const dx = qx - px, dy = qy - py, dz = qz - pz;
  const e1x = pos[o + 3] - pos[o], e1y = pos[o + 4] - pos[o + 1], e1z = pos[o + 5] - pos[o + 2];
  const e2x = pos[o + 6] - pos[o], e2y = pos[o + 7] - pos[o + 1], e2z = pos[o + 8] - pos[o + 2];
  const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
  const a = e1x * hx + e1y * hy + e1z * hz;
  if (Math.abs(a) < 1e-12) return false;
  const f = 1 / a;
  const sx = px - pos[o], sy = py - pos[o + 1], sz = pz - pos[o + 2];
  const u = f * (sx * hx + sy * hy + sz * hz);
  if (u < 0 || u > 1) return false;
  const qx2 = sy * e1z - sz * e1y, qy2 = sz * e1x - sx * e1z, qz2 = sx * e1y - sy * e1x;
  const v = f * (dx * qx2 + dy * qy2 + dz * qz2);
  if (v < 0 || u + v > 1) return false;
  const t = f * (e2x * qx2 + e2y * qy2 + e2z * qz2);
  return t >= 0 && t <= 1;
}

function ccw(p: number[][]): number[][] {
  return polyArea2(p) < 0 ? [p[0], p[2], p[1]] : p;
}

function polyArea2(p: number[][]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length];
    s += x0 * y1 - x1 * y0;
  }
  return s;
}

function polyArea(p: number[][]): number {
  return p.length < 3 ? 0 : Math.abs(polyArea2(p)) / 2;
}

/** Sutherland-Hodgman: subject clipped by a convex counter-clockwise clip polygon. */
function clip(subject: number[][], clipper: number[][]): number[][] {
  let out = subject;
  for (let i = 0; i < clipper.length && out.length; i++) {
    const [ax, ay] = clipper[i], [bx, by] = clipper[(i + 1) % clipper.length];
    const side = (p: number[]) => (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax);
    const inp = out;
    out = [];
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j], q = inp[(j + 1) % inp.length];
      const sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return out;
}
