import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { psx } from "../retro/psx";
import { registerBoatMud } from "./boatGround";
import { CANAL_BED, TOE_TOP, BRIG_FLOOR, regionAt } from "./tide";
import { attachToMirror } from "./mirror";
import { OUTFALLS, buildOutfalls } from "./outfalls";
import { HULLS, MOORINGS } from "../../../shared/smallBoats";

// M6 tides: the mud the ebb lays bare. Along the foot of every river wall a bank of mud slopes away under the
// water (world/tide.ts TOE_TOP), so at low water a strip of wet mud shows under the slimy stone.
//
// D1 (docs/plans/next-update.md, 2026-10-11): the beds of the canal and the vliet as dark wet Scheldt silt instead of
// a flat grey floor. A sculpted bed in cells of a third of a metre: a trickle's channel winding down the middle from the outfall at
// the head (CHANNEL_DEPTH under CANAL_BED), flats at CANAL_BED (never above it: the boats take the ground there),
// pools in fixed hollows that keep their water at low tide, and a bank at the walls' foot up to TOE_TOP, never above
// the straight slope the small boats know (game/boatMoorings.ts mudAt). Its picture and height map
// (tools/textures/mud_maps.py) carry the ripple marks, casts, shells and straw; the vertex colour the wet hollows,
// the slime at the walls and the black stain under each sewer outfall (world/outfalls.ts). Darker where the ebb has
// just left it (the shared tideWet), matte when dry, wet in the rain.
//
// The low water: the river's sheet rides a swell of a quarter metre, which in a canal a hand deep came up through
// the mud in moving blobs. While the river stands below TOE_TOP the beds have a calm sheet of their own at its level
// (the trickle in the channel, the shallows), the river's sheet is kept off the bed's pixels (a stencil bit), and the
// pools have a sheet of their own at POOL_Y. Both sheets use the river's mirror (attach), no new mirror.
// Still meshes, built once; `update` each frame from rijnkaai.ts updateTide.

/** How far out from the wall the bank runs, and how far it falls over that distance (game/boatMoorings.ts the same). */
const TOE_OUT = 3.6;
const TOE_DROP = 1.4;

/** The mud's picture: one tile is this many metres (tools/textures/mud_maps.py TILE_M). */
export const MUD_TILE = 4;
/** The channel's bottom under CANAL_BED along its middle (m). */
export const CHANNEL_DEPTH = 0.3;
/** The pools' bottoms under the flats (m). */
export const POOL_DEPTH = 0.17;
/**
 * The pools' water at low tide (m, quay top 0): under the flats by more than its own ripples (the ponds' psx water
 * rises and falls about 3 cm), so it shows only in its hollow.
 */
export const POOL_Y = CANAL_BED - 0.075;
/** Below this river level the beds have their calm sheet (and the river's sheet stays off the bed). */
export const CALM_TOP = TOE_TOP;
/** The calm sheet never lies lower than this: the trickle always runs a little in the channel. */
const TRICKLE_Y = CANAL_BED - 0.22;

/** The canal and the vliet: the rectangles of their beds (tools/city/design.py water, inside the walls). */
interface Bed {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  seed: number;
  /** The channel: its meanders' amplitudes (m) and lengths (m), its half width (m) from .. to. */
  amp: [number, number];
  len: [number, number];
  hw: [number, number];
  /** Where the trickle starts at the head (the head outfall's x). */
  headX: number;
  pools: Pool[];
}
interface Pool {
  x: number;
  z: number;
  rx: number;
  rz: number;
  rot: number;
}

const BEDS: Bed[] = [
  { minX: -82, maxX: -70, minZ: 0.5, maxZ: 205, seed: 11, amp: [2.0, 0.9], len: [47, 19], hw: [0.36, 0.62], headX: -76, pools: [] },
  { minX: -150, maxX: -142, minZ: 0.5, maxZ: 72, seed: 23, amp: [0.85, 0.4], len: [31, 13], hw: [0.26, 0.42], headX: -146, pools: [] },
];
/** The bank at the walls' foot rises over this many metres from the flats to TOE_TOP. */
const BANK = 0.45;
/** The mouth: the bed runs on this far into the river, falling away (seen from the river at low water). */
const LIP = 3.5;

function hash2(i: number, j: number, s: number): number {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Smooth value noise 0..1. */
function vnoise(x: number, z: number, s: number): number {
  const i = Math.floor(x);
  const j = Math.floor(z);
  const fx = x - i;
  const fz = z - j;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash2(i, j, s);
  const b = hash2(i + 1, j, s);
  const c = hash2(i, j + 1, s);
  const d = hash2(i + 1, j + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The channel's middle at z (it starts under the head outfall and winds to the mouth). */
function channelX(b: Bed, z: number): number {
  const mid = (b.minX + b.maxX) / 2;
  const s = b.seed;
  let x = mid + b.amp[0] * Math.sin((z / b.len[0]) * 2 * Math.PI + s) + b.amp[1] * Math.sin((z / b.len[1]) * 2 * Math.PI + s * 1.7);
  // at the head it comes from the outfall
  const head = smooth(b.maxZ - 2, b.maxZ - 18, z);
  x = b.headX + (x - b.headX) * head;
  const margin = b.hw[1] * 1.7 + 0.9;
  return Math.min(b.maxX - margin, Math.max(b.minX + margin, x));
}
function channelHalf(b: Bed, z: number): number {
  return b.hw[0] + (b.hw[1] - b.hw[0]) * vnoise(z / 9, 0.5, b.seed + 3);
}

// the pools: fixed hollows on the flats, clear of the channel and of the bank at the walls
for (const b of BEDS) {
  const r = rng(b.seed * 97);
  const want = Math.round((b.maxZ - b.minZ) / 9);
  for (let tries = 0; tries < 400 && b.pools.length < want; tries++) {
    const z = b.minZ + 4 + r() * (b.maxZ - b.minZ - 8);
    const w = b.maxX - b.minX;
    const rx = (w > 10 ? 0.55 : 0.4) + r() * (w > 10 ? 0.8 : 0.45);
    const rz = rx * (1.2 + r() * 0.8);
    const x = b.minX + 1.4 + rx + r() * (w - 2.8 - 2 * rx);
    if (Math.abs(x - channelX(b, z)) < channelHalf(b, z) * 1.7 + rx + 0.4) continue;
    if (b.pools.some((p) => Math.hypot((p.x - x) / (p.rx + rx + 0.8), (p.z - z) / (p.rz + rz + 0.8)) < 1)) continue;
    // (not under a boat at her mooring: she would lie over the water's edge)
    if (MOORINGS.some((m) => Math.abs(m.x - x) < rx * 1.25 + 1.2 && Math.abs(m.z - z) < rz * 1.25 + HULLS[m.kind].half + 0.6)) continue;
    b.pools.push({ x, z, rx, rz, rot: (r() - 0.5) * 0.5 });
  }
}

function bedOf(x: number, z: number): Bed | null {
  for (const b of BEDS) if (x >= b.minX && x <= b.maxX && z >= b.minZ - LIP && z <= b.maxZ) return b;
  return null;
}

/** How deep a pool is under the flats at (x, z) (m, 0 outside every pool). */
function poolDepth(b: Bed, x: number, z: number): number {
  let d = 0;
  for (const p of b.pools) {
    const dx = x - p.x;
    const dz = z - p.z;
    if (Math.abs(dx) > p.rx * 1.3 || Math.abs(dz) > p.rz * 1.3) continue;
    const c = Math.cos(p.rot);
    const s = Math.sin(p.rot);
    const u = (dx * c - dz * s) / p.rx;
    const v = (dx * s + dz * c) / p.rz;
    // a ragged edge, a flat bottom
    const r = Math.hypot(u, v) * (1 + 0.36 * (vnoise(x * 1.3, z * 1.3, b.seed + 9) - 0.5) + 0.22 * (vnoise(x * 3.7, z * 3.7, b.seed + 10) - 0.5));
    d = Math.max(d, POOL_DEPTH * smooth(1, 0.5, r));
  }
  return d;
}

/**
 * The drawn bed under (x, z) in the canal or the vliet (m, quay top 0), or null outside them. Never above
 * max(CANAL_BED, the wall's bank as boatMoorings.ts mudAt has it), so no boat lying on what the game counts as
 * the bottom cuts into it; the channel and the pools lie lower.
 */
export function bedHeightAt(x: number, z: number): number | null {
  const b = bedOf(x, z);
  if (!b) return null;
  const B = CANAL_BED;
  // the flats: soft swells a few centimetres down
  let y = B - 0.009 * vnoise(x / 2.3, z / 2.3, b.seed) - 0.005 * vnoise(x / 0.8, z / 0.8, b.seed + 1);
  // the channel: deepest along its middle, a soft shoulder each side; shallower at the head
  const cx = channelX(b, z);
  const t = Math.abs(x - cx) / (channelHalf(b, z) * 1.7);
  if (t < 1) {
    const k = 1 - t * t;
    const atHead = 0.55 + 0.45 * smooth(b.maxZ - 1, b.maxZ - 22, z);
    y = Math.min(y, B - CHANNEL_DEPTH * atHead * k * k * (0.92 + 0.08 * vnoise(z / 3, x, b.seed + 5)));
  }
  y -= poolDepth(b, x, z);
  // the bank at the foot of the walls (the mouth at minZ is open): up to TOE_TOP at the face in the last BANK metres,
  // under boatMoorings.ts mudAt's straight slope everywhere, so the boats' bilges at the walls clear it
  const d = Math.min(x - b.minX, b.maxX - x, b.maxZ - z);
  if (d < BANK) y = Math.max(y, B + (TOE_TOP - B) * Math.pow(1 - d / BANK, 1.6) - 0.02 * vnoise(x * 1.7, z * 1.7, b.seed + 2));
  // past the mouth the bed falls away into the river
  if (z < b.minZ + 1) y -= (b.minZ + 1 - z) * 0.55;
  return y;
}

export interface MudOptions {
  /** Quay wall lines [x0, z0, x1, z1] (shared/city.json quays). */
  quays: number[][];
  /** Inside the water polygons? (to find the water side of a wall) */
  inWater(x: number, z: number): boolean;
  /** The outfalls' stones (the quay coping's material: dressed bluestone). */
  stone: THREE.Material | null;
}

export interface TideMud {
  mesh: THREE.Mesh;
  /** Every frame (rijnkaai.ts updateTide): the river's level now. */
  update(river: number): void;
}

/** The stencil bits (world/boats.ts): 1 the hull caps, 2 the basins' water; ours: 4 the bed, 8 the pools. */
const BED_BIT = 4;
const POOL_BIT = 8;

function loadTex(url: string, srgb: boolean): THREE.Texture {
  const t = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}${url}`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.name = srgb ? "mud_bed" : "mud_bed_h";
  return t;
}

export function buildTideMud(scene: THREE.Object3D, o: MudOptions): TideMud {
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const r = rng(1873);
  const vert = (x: number, y: number, z: number, cr: number, cg: number, cb: number) => {
    pos.push(x, y, z);
    col.push(cr, cg, cb);
    uv.push(x / MUD_TILE, z / MUD_TILE);
    return pos.length / 3 - 1;
  };
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    // two triangles facing up (a, b, c, d round the edge, either way)
    const ux = b[0] - a[0];
    const uz = b[2] - a[2];
    const vx = d[0] - a[0];
    const vz = d[2] - a[2];
    const up = uz * vx - ux * vz > 0;
    const ids = [a, b, c, d].map((p) => vert(p[0], p[1], p[2], p[3], p[3] * 0.97, p[3] * 0.92));
    if (up) index.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
    else index.push(ids[0], ids[3], ids[2], ids[0], ids[2], ids[1]);
  };
  // the bank at the foot of each river wall (not in the Petit Bassin: its water never goes down; not in the canal
  // and the vliet: their beds below carry their own bank)
  const inBed = (x: number, z: number) => BEDS.some((b) => x > b.minX - 0.5 && x < b.maxX + 0.5 && z > b.minZ - 0.5 && z < b.maxZ + 0.5);
  for (const [ax, az, bx, bz] of o.quays) {
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1) continue;
    if (regionAt((ax + bx) / 2, (az + bz) / 2) !== 0) continue;
    const tx = (bx - ax) / L;
    const tz = (bz - az) / L;
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const [nx, nz] = o.inWater(mx - tz, mz + tx) ? [-tz, tx] : [tz, -tx];
    if (inBed(mx + nx * 1.5, mz + nz * 1.5)) continue;
    const n = Math.max(1, Math.ceil(L / 4));
    const lump = Array.from({ length: n + 1 }, () => (r() - 0.5) * 0.3);
    const tone = Array.from({ length: n + 1 }, () => 0.8 + r() * 0.3);
    for (let i = 0; i < n; i++) {
      const s0 = (L * i) / n;
      const s1 = (L * (i + 1)) / n;
      const P = (s: number, u: number, y: number, k: number) => [ax + tx * s + nx * u, y, az + tz * s + nz * u, k];
      // against the wall (a hand out, so it never fights the wall face), then out and down
      quad(
        P(s0, 0.02, TOE_TOP + lump[i] * 0.4, tone[i] * 0.8),
        P(s1, 0.02, TOE_TOP + lump[i + 1] * 0.4, tone[i + 1] * 0.8),
        P(s1, TOE_OUT * 0.45, TOE_TOP - TOE_DROP * 0.35 + lump[i + 1], tone[i + 1] * 0.9),
        P(s0, TOE_OUT * 0.45, TOE_TOP - TOE_DROP * 0.35 + lump[i], tone[i] * 0.9),
      );
      quad(
        P(s0, TOE_OUT * 0.45, TOE_TOP - TOE_DROP * 0.35 + lump[i], tone[i] * 0.9),
        P(s1, TOE_OUT * 0.45, TOE_TOP - TOE_DROP * 0.35 + lump[i + 1], tone[i + 1] * 0.9),
        P(s1, TOE_OUT, TOE_TOP - TOE_DROP, 0.75),
        P(s0, TOE_OUT, TOE_TOP - TOE_DROP, 0.75),
      );
    }
  }
  // The brig's shallow berth: her three-metre keel rests here below -4.40.
  quad([-60, BRIG_FLOOR - 3, -11.7, 0.75], [-20, BRIG_FLOOR - 3, -11.7, 0.75],
    [-20, BRIG_FLOOR - 3, -3, 0.75], [-60, BRIG_FLOOR - 3, -3, 0.75]);
  const bedFrom = index.length;
  // the canal and vliet beds: a third of a metre a cell, one vertex each, smooth
  const CELL = 1 / 3;
  let calmGeo: THREE.BufferGeometry[] = [];
  const poolGeo: THREE.BufferGeometry[] = [];
  for (const b of BEDS) {
    const z0 = b.minZ - LIP;
    const nx = Math.round((b.maxX - b.minX) / CELL);
    const nz = Math.ceil((b.maxZ - z0) / CELL);
    const base = pos.length / 3;
    const outfalls = OUTFALLS.filter((f) => f.x >= b.minX - 0.1 && f.x <= b.maxX + 0.1 && f.z >= b.minZ - 0.1 && f.z <= b.maxZ + 0.1);
    for (let j = 0; j <= nz; j++) {
      const z = Math.min(b.maxZ, z0 + j * CELL);
      for (let i = 0; i <= nx; i++) {
        // (a hand in from the walls: never fights the wall face)
        const x = Math.min(b.maxX - 0.02, Math.max(b.minX + 0.02, b.minX + i * CELL));
        const y = bedHeightAt(x, Math.min(z, b.maxZ - 0.02))!;
        // the tone: the mud's own patches; wet and darker in the hollows; slime and weed at the walls' foot
        const below = CANAL_BED - y;
        let k = 0.95 + 0.25 * vnoise(x / 3.1, z / 3.1, b.seed + 31) + 0.1 * vnoise(x / 0.9, z / 0.9, b.seed + 32);
        k *= 1 - 0.22 * smooth(0.0, 0.2, below);
        const dWall = Math.min(x - b.minX, b.maxX - x, b.maxZ - z);
        const foot = 1 - smooth(0.1, 1.1, dWall);
        let cr = k * (1 - 0.3 * foot);
        let cg = k * (1 - 0.18 * foot);
        let cb = k * (1 - 0.32 * foot);
        // the sewers' stain: black and a little green, a fan out from the wall and on down the flow
        for (const f of outfalls) {
          const along = (x - f.x) * f.nx + (z - f.z) * f.nz; // out from the wall
          const side = (x - f.x) * -f.nz + (z - f.z) * f.nx;
          const flow = f.nz !== 0 ? 0 : -Math.min(0, z - f.z) * 0.25; // (spreads toward the mouth, -z)
          const w = 0.9 + along * 0.45 + flow;
          const reach = 4.5 + flow * 2;
          const s = Math.max(0, 1 - Math.abs(side) / w) * smooth(reach, 0.3, along) * (0.75 + 0.25 * vnoise(x * 2, z * 2, 77));
          const e = Math.min(1, s * 1.4);
          cr *= 1 - 0.78 * e;
          cg *= 1 - 0.7 * e;
          cb *= 1 - 0.8 * e;
        }
        // (the vertex colour carries the mud's tone, the picture its grain: sRGB-ish factors)
        vert(x, y, z, Math.min(1, cr * 0.82), Math.min(1, cg * 0.79), Math.min(1, cb * 0.73));
      }
    }
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const a = base + j * (nx + 1) + i;
        const c = a + nx + 1;
        // the diagonal along the slope's fall, so the channel's edge does not zigzag
        if ((i + j) % 2) index.push(a, c, a + 1, a + 1, c, c + 1);
        else index.push(a, c, c + 1, a, c + 1, a + 1);
      }
    // the calm sheet over this bed (low water: the trickle and the shallows), 2 m cells
    const sheet = new THREE.PlaneGeometry(b.maxX - b.minX, b.maxZ - z0, Math.ceil((b.maxX - b.minX) / 2), Math.ceil((b.maxZ - z0) / 2));
    sheet.rotateX(-Math.PI / 2);
    sheet.translate((b.minX + b.maxX) / 2, 0, (z0 + b.maxZ) / 2);
    calmGeo.push(sheet);
    // the pools' water: a disc a little bigger than each hollow (the mud round it hides its edge)
    for (const p of b.pools) {
      const g = new THREE.CircleGeometry(1.25, 24);
      g.rotateX(-Math.PI / 2);
      g.scale(p.rx, 1, p.rz);
      g.rotateY(p.rot);
      g.translate(p.x, 0, p.z);
      poolGeo.push(g);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  // the river's banks and the beds: one picture, two materials (the beds take the stencil bit at low water)
  g.addGroup(0, bedFrom, 0);
  g.addGroup(bedFrom, index.length - bedFrom, 1);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const map = loadTex("textures/mud_bed.jpg", true);
  const height = loadTex("textures/mud_bed_h.png", false);
  const mudMat = () => {
    // dark wet silt, matte (the water in its channel and pools is what shines), darker where the ebb has just been.
    // (No `wet` and no puddles: the rain's sheen and puddles spread over the flats in wide sky-white sheets, the
    // "snow" of survey 15; the pools are the mud's standing water.)
    const m = psx(new THREE.MeshLambertMaterial({ map, vertexColors: true }), {
      noSnap: true,
      affine: 0,
      vary: 0.6,
      tideWet: 0.3,
      relief: { height, depth: 0.03, tile: MUD_TILE, bump: 2.4 },
    });
    return m;
  };
  const bankMat = mudMat();
  bankMat.name = "tide_mud";
  const bedMat = mudMat();
  bedMat.name = "tide_bed";
  // (the stencil bit while the beds have their calm sheet: the river's sheet keeps off the bed, world/boats.ts
  // waterStencil draws only where the stencil is 0)
  bedMat.stencilRef = BED_BIT;
  bedMat.stencilWriteMask = BED_BIT;
  bedMat.stencilFunc = THREE.AlwaysStencilFunc;
  bedMat.stencilZPass = THREE.ReplaceStencilOp;
  bedMat.stencilWrite = false;
  const mesh = new THREE.Mesh(g, [bankMat, bedMat]);
  mesh.name = "tide_mud";
  mesh.userData.bedFrom = bedFrom;
  registerBoatMud(mesh);
  scene.add(mesh);

  // the low water's sheets: still water (the ponds' kind of the psx water: short ripples, no swell)
  const sheetMat = (bits: { ref: number; test: number; write: number }) => {
    const m = psx(new THREE.MeshPhongMaterial({ color: 0x3a4436, specular: 0x202b23, shininess: 60 }), { water: true, affine: 0, waterCalm: true });
    m.stencilWrite = true;
    m.stencilRef = bits.ref;
    m.stencilFunc = THREE.EqualStencilFunc;
    m.stencilFuncMask = bits.test;
    m.stencilWriteMask = bits.write;
    m.stencilZPass = THREE.ReplaceStencilOp;
    return m;
  };
  // the pools first: not on a hull cap (bit 1); they mark bit 8
  const pools = new THREE.Mesh(mergeGeometries(poolGeo, false)!, sheetMat({ ref: POOL_BIT, test: 1, write: POOL_BIT }));
  pools.name = "tide_pools";
  pools.renderOrder = 1.45;
  pools.position.y = POOL_Y;
  pools.visible = false;
  // the calm sheet: not on a cap nor a pool (bits 1 and 8); it marks bit 2, so the river's sheet skips it too
  const calm = new THREE.Mesh(mergeGeometries(calmGeo, false)!, sheetMat({ ref: 2, test: 1 | POOL_BIT, write: 2 }));
  calm.name = "tide_calm";
  calm.renderOrder = 1.5;
  calm.visible = false;
  calmGeo = [];
  scene.add(pools, calm);
  attachToMirror("water", pools, calm);

  // the outfalls in the walls, and what the water has left on the mud
  const debrisMat = psx(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { noSnap: true, affine: 0, tideWet: 0.3 });
  debrisMat.name = "tide_debris";
  if (o.stone) buildOutfalls(scene, o.stone, debrisMat);
  const debris = new THREE.Mesh(debrisGeometry(), debrisMat);
  debris.name = "tide_debris";
  scene.add(debris);

  let calmOn = false;
  return {
    mesh,
    update(river: number) {
      const on = river < CALM_TOP;
      if (on !== calmOn) {
        calmOn = on;
        bedMat.stencilWrite = on;
        calm.visible = on;
      }
      calm.position.y = Math.max(river, TRICKLE_Y);
      pools.visible = on && river < POOL_Y - 0.004;
    },
  };
}

// ---------------------------------------------------------------- what the water has left on the mud

type V3 = [number, number, number];

function colour(g: THREE.BufferGeometry, c: V3, vary = 0, seed = 1): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const n = ng.getAttribute("position").count;
  const a = new Float32Array(n * 3);
  const r = rng(seed);
  for (let i = 0; i < n; i += 3) {
    const k = 1 + (r() - 0.5) * vary;
    for (let j = 0; j < 3 && i + j < n; j++) a.set([c[0] * k, c[1] * k, c[2] * k], (i + j) * 3);
  }
  ng.setAttribute("color", new THREE.BufferAttribute(a, 3));
  ng.deleteAttribute("uv");
  if (ng.getAttribute("uv1")) ng.deleteAttribute("uv1");
  return ng;
}

/**
 * A thing laid on the mud at (x, z): turned `yaw`, tipped `tilt` about its own x, sunk `sink` m under the bed. Moved
 * out of the channel onto the flats unless `inChannel`.
 */
function lay(g: THREE.BufferGeometry, x: number, z: number, yaw: number, tilt: number, sink: number, roll = 0, inChannel = false): THREE.BufferGeometry {
  const b = bedOf(x, z);
  if (b && !inChannel) {
    const cx = channelX(b, z);
    const clear = channelHalf(b, z) * 1.7 + 0.6;
    if (Math.abs(x - cx) < clear) x = cx + Math.sign(x - cx || 1) * clear;
  }
  const y = (bedHeightAt(x, z) ?? CANAL_BED) - sink;
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, yaw, roll, "YXZ")), new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  return g;
}

const IRON: V3 = [0.075, 0.05, 0.038];
const RUST: V3 = [0.2, 0.1, 0.05];
const WOOD: V3 = [0.16, 0.12, 0.08];
const WET_WOOD: V3 = [0.09, 0.07, 0.05];

/** A cart wheel, lying flat (its axle up): an iron tyre, a felloe, twelve spokes (two gone), the hub. */
function cartWheel(seed: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const R = 0.55;
  const tyre = new THREE.TorusGeometry(R, 0.028, 6, 40);
  tyre.rotateX(Math.PI / 2);
  parts.push(colour(tyre, RUST, 0.4, seed));
  const felloe = new THREE.TorusGeometry(R - 0.06, 0.045, 5, 36);
  felloe.rotateX(Math.PI / 2);
  felloe.scale(1, 0.8, 1);
  parts.push(colour(felloe, WET_WOOD, 0.3, seed + 1));
  const hub = new THREE.CylinderGeometry(0.08, 0.1, 0.24, 14);
  parts.push(colour(hub, WET_WOOD, 0.2, seed + 2));
  const hubBand = new THREE.CylinderGeometry(0.102, 0.102, 0.03, 14);
  hubBand.translate(0, 0.05, 0);
  parts.push(colour(hubBand, IRON, 0.2, seed + 3));
  for (let i = 0; i < 12; i++) {
    if (i === 4 || i === 9) continue; // broken out
    const a = (i / 12) * Math.PI * 2;
    const len = i === 7 ? 0.25 : R - 0.16; // one snapped short
    const sp = new THREE.CylinderGeometry(0.018, 0.026, len, 6);
    sp.rotateZ(Math.PI / 2);
    sp.translate(0.09 + len / 2, 0, 0);
    sp.rotateY(a);
    parts.push(colour(sp, WOOD, 0.3, seed + 10 + i));
  }
  return mergeGeometries(parts, false)!;
}

/** A broken wicker basket on its side: woven bands, a torn hole, crushed. */
function brokenBasket(seed: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push(new THREE.Vector2(0.19 + 0.07 * Math.sin(t * Math.PI) + 0.03 * t, t * 0.36));
  }
  const g = new THREE.LatheGeometry(pts, 22).toNonIndexed();
  const p = g.getAttribute("position");
  const n = p.count;
  const c = new Float32Array(n * 3);
  const keep: number[] = [];
  const r = rng(seed);
  for (let t = 0; t < n; t += 3) {
    // the hole: faces gone on one side, ragged
    const x = (p.getX(t) + p.getX(t + 1) + p.getX(t + 2)) / 3;
    const y = (p.getY(t) + p.getY(t + 1) + p.getY(t + 2)) / 3;
    const zz = (p.getZ(t) + p.getZ(t + 1) + p.getZ(t + 2)) / 3;
    if (x > 0.08 && y > 0.1 && y < 0.3 && zz > -0.12 + r() * 0.08) continue;
    keep.push(t);
  }
  const out = new Float32Array(keep.length * 9);
  keep.forEach((t, k) => {
    for (let j = 0; j < 3; j++) {
      let x = p.getX(t + j);
      let y = p.getY(t + j);
      let zz = p.getZ(t + j);
      // crushed: flattened toward one side, bulged
      zz *= 0.72;
      x *= 1.08;
      y += 0.02 * Math.sin(x * 20 + zz * 13);
      out.set([x, y, zz], (k * 3 + j) * 3);
      // the weave: willow bands, wet and dark
      const band = Math.floor(y / 0.022) % 2 === 0 ? 1 : 0.72;
      const strand = 0.85 + 0.15 * Math.sin(Math.atan2(zz, x) * 44);
      const k2 = band * strand;
      c.set([0.3 * k2, 0.23 * k2, 0.12 * k2], (k * 3 + j) * 3);
    }
  });
  const og = new THREE.BufferGeometry();
  og.setAttribute("position", new THREE.BufferAttribute(out, 3));
  og.setAttribute("color", new THREE.BufferAttribute(c.slice(0, keep.length * 9), 3));
  og.computeVertexNormals();
  // on its side, its lower flank in the mud
  og.rotateZ(Math.PI / 2 - 0.15);
  og.translate(0, 0.17, 0);
  return og;
}

/** A length of chain lying in a loose curve (links turned in turn), from a rusted ring. */
function chain(seed: number, links: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const r = rng(seed);
  let a = r() * Math.PI;
  let x = 0;
  let z = 0;
  const step = 0.078;
  for (let i = 0; i < links; i++) {
    const l = new THREE.TorusGeometry(0.038, 0.011, 5, 10);
    l.scale(1.45, 1, 1);
    if (i % 2) l.rotateX(Math.PI / 2);
    else l.rotateX(0.25);
    l.rotateY(-a);
    l.translate(x, 0.012, z);
    parts.push(colour(l, i % 3 ? RUST : IRON, 0.5, seed + i));
    a += (r() - 0.5) * 0.5;
    x += Math.cos(a) * step;
    z += Math.sin(a) * step;
  }
  const ring = new THREE.TorusGeometry(0.11, 0.018, 6, 18);
  ring.rotateX(Math.PI / 2 - 0.2);
  ring.translate(-0.13, 0.01, 0);
  parts.push(colour(ring, IRON, 0.3, seed + 99));
  return mergeGeometries(parts, false)!;
}

/** A bottle lying on its side: dark green or brown glass. */
function bottle(seed: number): THREE.BufferGeometry {
  const prof = [
    [0.0, 0.0],
    [0.036, 0.0],
    [0.038, 0.02],
    [0.038, 0.16],
    [0.03, 0.19],
    [0.014, 0.215],
    [0.013, 0.26],
    [0.017, 0.268],
    [0.011, 0.275],
  ].map(([a, b]) => new THREE.Vector2(a, b));
  const g = new THREE.LatheGeometry(prof, 12);
  g.rotateZ(Math.PI / 2);
  g.translate(0.13, 0.03, 0);
  const r = rng(seed);
  const glass: V3 = r() < 0.6 ? [0.07, 0.15, 0.07] : [0.2, 0.11, 0.04];
  return colour(g, glass, 0.15, seed);
}

/** An old grapnel: the shank, the ring, four curved flukes with their points, rusted. */
function grapnel(seed: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const shank = new THREE.CylinderGeometry(0.022, 0.026, 0.62, 8);
  shank.translate(0, 0.31, 0);
  parts.push(colour(shank, RUST, 0.4, seed));
  const ring = new THREE.TorusGeometry(0.055, 0.012, 6, 14);
  ring.translate(0, 0.66, 0);
  parts.push(colour(ring, IRON, 0.3, seed + 1));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(0.2, -0.02, 0), new THREE.Vector3(0.27, 0.2, 0));
    const f = new THREE.TubeGeometry(curve, 8, 0.016, 6, false);
    const tip = new THREE.ConeGeometry(0.03, 0.07, 6);
    tip.translate(0.27, 0.23, 0);
    f.rotateY(a);
    tip.rotateY(a);
    parts.push(colour(f, RUST, 0.4, seed + 2 + i), colour(tip, IRON, 0.3, seed + 8 + i));
  }
  return mergeGeometries(parts, false)!;
}

/** A broken stave or plank, half in the mud. */
function plank(seed: number, len: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(len, 0.03, 0.13, 6, 1, 1);
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + 0.02 * Math.sin(p.getX(i) * 3.1));
  return colour(g, WET_WOOD, 0.35, seed);
}

/**
 * The debris on the beds (fixed spots on the flats and in the channel, clear of the boats' moorings at the walls):
 * cart wheels, a broken basket, chains, bottles, an old grapnel, staves.
 */
function debrisGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // the canal (walls at x -82 and -70; the small boats lie a metre off them)
  parts.push(lay(cartWheel(1), -75.2, 57.5, 0.4, 0.2, 0.025, 0.05, true));
  parts.push(lay(brokenBasket(2), -77.4, 91.5, 1.1, 0, 0.06));
  parts.push(lay(chain(3, 18), -74.6, 121.0, 0.3, 0, 0.012));
  parts.push(lay(bottle(4), -76.6, 74.8, 0.5, 0, 0.012), lay(bottle(5), -76.2, 75.3, 2.1, 0, 0.018), lay(bottle(6), -77.1, 76.1, 4.0, 0.1, 0.03));
  parts.push(lay(grapnel(7), -73.6, 140.5, 0.7, 1.25, 0.05));
  parts.push(lay(cartWheel(8), -77.8, 177.0, 2.2, -0.3, 0.06, 0.1));
  parts.push(lay(bottle(9), -74.3, 31.0, 1.2, 0, 0.015), lay(bottle(10), -73.9, 30.4, 5.2, 0, 0.02));
  parts.push(lay(plank(11, 1.4), -78.3, 46.0, 0.6, 0.06, 0.02), lay(plank(12, 0.9), -73.5, 100.0, 2.4, -0.05, 0.015));
  parts.push(lay(chain(13, 11), -77.0, 160.0, 1.9, 0, 0.012));
  // the vliet (walls at x -150 and -142)
  parts.push(lay(brokenBasket(21), -145.0, 18.5, 2.6, 0, 0.07));
  parts.push(lay(bottle(22), -147.2, 49.0, 0.9, 0, 0.015), lay(bottle(23), -146.7, 49.6, 3.0, 0, 0.02));
  parts.push(lay(chain(24, 9), -144.3, 60.0, 0.2, 0, 0.012));
  parts.push(lay(plank(25, 1.1), -146.4, 37.0, 1.4, 0.04, 0.02));
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}
