import * as THREE from "three";
import { OPEN_SACK, openSackGeometry, pickSack, SACK_W, sackMaterial, sackMesh } from "./sackModel";
import STALL_SACKS from "./stalls_sack_sockets.json";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { psx } from "../retro/psx";
import type { Rect } from "../world/geom";
import type { TownShop, TownStall } from "../net/api";
import { addStallThing, dropStallThings, type Pts } from "./stallSpots";
import BUILD from "../../../shared/city_build.json";
import { shopTableSpot, type FrontHouse } from "../../../shared/shopFront";

/** The houses of the town plan: a shop's table stays on its own house front (shared/shopFront.ts). */
const HOUSES = (BUILD as unknown as { houses: FrontHouse[] }).houses;

// Market stalls and shop fronts (M3e), from client/public/models/stalls.glb
// (tools/blender/build_stalls.py). By day: the awning out and the goods on the
// table. At night the sellers go home: the awning is rolled up and a tarred
// tarpaulin is tied over the table. The stalls stand where the town put them
// (server town/places.ts STALLS; shop fronts beside a shopkeeper's door).
//
// 2026-09-26 (Steve: "some shops are weirdly going over a corner"; "shop stalls and goods update"):
// a shop's table stands on its own house front, shorter on a short one (shared/shopFront.ts); the
// goods have volume (stall_more_*, shop_more_*: heaps, a slate, scales, a basket and a bucket under
// the table); rough places (the fish market, the quays, the back lanes) get patched canvas and mud,
// the main squares striped awnings. All the town's stalls and shop tables are merged: one mesh
// per material for the whole town, made again when a stall opens or shuts.

interface Parts {
  protos: Map<string, THREE.Object3D>;
  mats: Record<string, THREE.Material>;
}
let loading: Promise<Parts | null> | null = null;

function load(): Promise<Parts | null> {
  if (loading) return loading;
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  loading = new GLTFLoader()
    .setDRACOLoader(draco)
    .loadAsync("/models/stalls.glb")
    .then((gltf) => {
      draco.dispose();
      const materials: Record<string, THREE.Material> = {};
      const swap = (src: THREE.Material): THREE.Material => {
        const name = src.name || "wood";
        if (materials[name]) return materials[name];
        const map = (src as THREE.MeshStandardMaterial).map ?? null;
        if (map) {
          map.magFilter = THREE.NearestFilter;
          map.minFilter = THREE.NearestFilter;
          map.generateMipmaps = false;
          map.colorSpace = THREE.SRGBColorSpace;
          map.wrapS = map.wrapT = THREE.RepeatWrapping;
          map.needsUpdate = true;
        }
        // mud on the stones: a decal (its edge in the alpha), drawn over the ground without fighting it
        const mat =
          name === "market_mud"
            ? psx(
                new THREE.MeshLambertMaterial({ map, vertexColors: true, transparent: true, alphaTest: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
                { affine: 0 },
              )
            : psx(new THREE.MeshLambertMaterial({ map, vertexColors: true }), { affine: 0.6 });
        mat.name = name;
        materials[name] = mat;
        return mat;
      };
      const protos = new Map<string, THREE.Object3D>();
      for (const node of [...gltf.scene.children]) {
        node.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
        });
        node.removeFromParent();
        node.position.set(0, 0, 0);
        node.rotation.set(0, 0, 0);
        protos.set(node.name, node);
      }
      // 2026-09-28 (CLAUDE.md, one model per thing): a model with sacks is its "_bare" copy and the one sack model
      // (game/sackModel.ts) in each sack's place, lying, standing or open (stalls_sack_sockets.json, written by
      // tools/blender/build_stalls.py); the goods picked from the goods list, the open sacks' by what is heaped in them
      for (const [name, rows] of Object.entries(STALL_SACKS as Record<string, StallSackRow[]>)) {
        const bare = protos.get(`${name}_bare`);
        if (!protos.has(name) || !bare) continue;
        const g = new THREE.Group();
        g.name = name;
        g.add(bare.clone());
        rows.forEach((r, i) => {
          const lot = pickSack(`stall:${name}:${i}`, r.goods ? [[r.goods, 1]] : "market");
          let m: THREE.Mesh;
          if (r.k === "open") {
            m = new THREE.Mesh(openSackGeometry(lot.goods), sackMaterial(lot));
            const s = r.h! / (OPEN_SACK.top + 0.02);
            m.scale.set((r.r! * 2) / SACK_W, s, (r.r! * 2) / SACK_W);
          } else m = sackMesh(lot, { standing: r.k === "standing", fit: [r.L!, r.H!, r.W!] });
          const M = new THREE.Matrix4().fromArray(r.m);
          const pp = new THREE.Vector3();
          const q = new THREE.Quaternion();
          const sc = new THREE.Vector3();
          M.decompose(pp, q, sc);
          m.position.copy(pp);
          m.quaternion.copy(q);
          m.scale.multiply(sc);
          g.add(m);
        });
        g.updateMatrixWorld(true);
        protos.set(name, g);
      }
      return { protos, mats: materials };
    })
    .catch((e: unknown) => {
      console.warn("stalls.glb did not load; no market stalls", e);
      draco.dispose();
      return null;
    });
  return loading;
}

/** A sack of a stalls.glb model (tools/blender/build_stalls.py): lying, standing or open, its matrix and size. */
interface StallSackRow {
  k: "lying" | "standing" | "open";
  m: number[];
  L?: number;
  W?: number;
  H?: number;
  r?: number;
  h?: number;
  goods?: string;
}

/** M3i (game/market.ts): the stall parts of stalls.glb (frame, awnings, goods, tables, the mk2_* kinds), psx materials already on them. */
export async function stallProtos(): Promise<Map<string, THREE.Object3D> | null> {
  return (await load())?.protos ?? null;
}

/** A model's points in its own frame (for the stall check), once per model. */
const ptsCache = new Map<THREE.Object3D, Float32Array>();
function modelPts(o: THREE.Object3D): Pts {
  let p = ptsCache.get(o);
  if (p) return p;
  o.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(o.matrixWorld).invert();
  const out: number[] = [];
  const v = new THREE.Vector3();
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || (m.material as THREE.Material).name === "market_mud") return;
    const M = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    const P = m.geometry.getAttribute("position");
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(M);
      out.push(v.x, v.y, v.z);
    }
  });
  p = new Float32Array(out);
  ptsCache.set(o, p);
  return p;
}

/** A model's faces for one material, in the model's own frame (non-indexed; every attribute there). */
interface Chunk {
  mat: THREE.Material;
  pos: Float32Array;
  nor: Float32Array;
  uv: Float32Array;
  col: Float32Array;
}

const chunkCache = new Map<string, Chunk[]>();
/** A model split by material (the awning's cloth swapped for `awning`), once per model and cloth. */
function chunksOf(parts: Parts, name: string, awning: string | null): Chunk[] {
  const key = `${name}|${awning ?? ""}`;
  let out = chunkCache.get(key);
  if (out) return out;
  out = [];
  const o = parts.protos.get(name);
  if (o) {
    o.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(o.matrixWorld).invert();
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      let mat = m.material as THREE.Material;
      if (awning && (mat.name === "awning_red" || mat.name === "awning_blue")) mat = parts.mats[awning] ?? mat;
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      const n = g.getAttribute("position").count;
      if (!g.getAttribute("normal")) g.computeVertexNormals();
      const U = g.getAttribute("uv");
      const C = g.getAttribute("color");
      const ch: Chunk = { mat, pos: new Float32Array(n * 3), nor: new Float32Array(n * 3), uv: new Float32Array(n * 2), col: new Float32Array(n * 3).fill(1) };
      const P = g.getAttribute("position");
      const N = g.getAttribute("normal");
      for (let i = 0; i < n; i++) {
        ch.pos.set([P.getX(i), P.getY(i), P.getZ(i)], i * 3);
        ch.nor.set([N.getX(i), N.getY(i), N.getZ(i)], i * 3);
        if (U) ch.uv.set([U.getX(i), U.getY(i)], i * 2);
        if (C) ch.col.set([C.getX(i), C.getY(i), C.getZ(i)], i * 3);
      }
      g.dispose();
      out!.push(ch);
    });
  }
  chunkCache.set(key, out);
  return out;
}

/** A rough place (by the quays, the fish market, the back lanes): patched canvas and mud; else neat. */
function roughAt(where: string): boolean {
  return /vismarkt|werf|rijn|kaai|quay|canal|lane|steenplein/i.test(where);
}

/** Footprints from the build report (local frame, customer side +z). */
const STALL_RECT = { minX: -1.4, maxX: 1.4, minZ: -0.71, maxZ: 0.71 };
const SHOP_RECT = { minX: -0.8, maxX: 0.8, minZ: 0.25, maxZ: 0.95 };

interface Placed {
  keeper: string | null;
  open: boolean | null;
  x: number;
  z: number;
  yaw: number;
  /** Stretched along the table (a short shop front). */
  sx: number;
  awning: string | null;
  /** The models drawn while the keeper is at work, and while the stall is shut. */
  openNames: string[];
  shutNames: string[];
}

export interface StallWorld {
  scene: THREE.Scene;
  addCollider(r: Rect): void;
}

/** Axis-aligned box round a local rect turned by yaw and moved to (x, z). */
function worldRect(r: { minX: number; maxX: number; minZ: number; maxZ: number }, x: number, z: number, yaw: number, top?: number): Rect {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const xs: number[] = [];
  const zs: number[] = [];
  for (const [lx, lz] of [[r.minX, r.minZ], [r.maxX, r.minZ], [r.minX, r.maxZ], [r.maxX, r.maxZ]]) {
    // three.js turns by yaw about +y: x' = x cos + z sin, z' = -x sin + z cos
    xs.push(x + lx * c + lz * s);
    zs.push(z - lx * s + lz * c);
  }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), top };
}

export class Stalls {
  private placed: Placed[] = [];
  private parts: Parts | null = null;
  /** Every town stall and shop table in one mesh per material, made again when one opens or shuts. */
  private readonly group = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  private dirty = false;
  private builtAt = -1e9;
  private night: boolean | null = null;
  /** Where the sellers stand: behind each stall, beside each shop table. */
  readonly sellerSpots = new Map<string, { x: number; z: number; yaw: number }>();
  /** Places a path must reach (the customer side), for the path check. */
  readonly fronts: Array<{ label: string; x: number; z: number }> = [];

  constructor(private readonly world: StallWorld) {}

  async build(stalls: TownStall[], shops: TownShop[]): Promise<void> {
    const parts = await load();
    if (!parts) return;
    const has = (n: string) => parts.protos.has(n);
    /** The stall check's record of a thing (dev/stallcheck.ts): every model it can show, day and night. */
    const record = (kind: string, label: string, x: number, z: number, yaw: number, names: string[], sx = 1, wall = false) => {
      const ps = names.flatMap((n) => {
        const o = parts.protos.get(n);
        return o ? [{ pts: modelPts(o), u: 0, y: 0, v: 0, s: [sx, 1, 1] as [number, number, number] }] : [];
      });
      addStallThing({ kind, label, x, z, yaw, wall, parts: ps });
    };
    this.parts = parts;
    this.group.name = "town_stalls";
    this.world.scene.add(this.group);
    /** A stall: the models shown when open and when shut (always: its frame or table). */
    const put = (x: number, z: number, yaw: number, keeper: string | null, always: string[], day: string[], night: string[], sx: number, awning: string | null) => {
      this.placed.push({ keeper, open: null, x, z, yaw, sx, awning, openNames: [...always, ...day].filter(has), shutNames: [...always, ...night].filter(has) });
    };
    dropStallThings((k) => k === "town stall" || k === "shop table");
    stalls.forEach((s, i) => {
      const yaw = Math.atan2(s.face[0], s.face[1]);
      const rough = roughAt(s.place);
      // the fish banks of the fish market under patched canvas, the main square's under stripes
      const awning = rough ? (i % 3 === 0 ? "awning_blue" : "canvas_patched") : i % 2 ? "awning_blue" : null;
      const day = ["stall_awning", ...(rough || s.goods === "fish" ? [] : ["stall_cloth"]), `stall_goods_${s.goods}`, `stall_more_${s.goods}`];
      put(s.x, s.z, yaw, s.keeper, ["stall_frame"], day, ["stall_awning_rolled", "stall_tarp"], 1, awning);
      this.world.addCollider(worldRect(STALL_RECT, s.x, s.z, yaw));
      if (s.keeper) this.sellerSpots.set(s.keeper, { x: s.x - s.face[0] * 1.15, z: s.z - s.face[1] * 1.15, yaw });
      this.fronts.push({ label: `stall ${i} (${s.goods})`, x: s.x + s.face[0] * 1.3, z: s.z + s.face[1] * 1.3 });
      record("town stall", `stall ${i} at ${s.place} (${s.goods})`, s.x, s.z, yaw, ["stall_frame", ...day, "stall_awning_rolled", "stall_tarp"]);
    });
    for (const sh of shops) {
      if (!sh.goods) continue;
      const [ox, oz] = sh.out;
      const yaw = Math.atan2(ox, oz);
      // the table stands beside the door on its own house front, the door and the corner kept free
      // (shared/shopFront.ts: the server's keeper and food stand by the same sum)
      const spot = shopTableSpot(HOUSES, sh);
      if (!spot) {
        // no room beside the door: the keeper minds the shop from the step
        this.sellerSpots.set(sh.keeper, { x: sh.wall[0] + ox * 0.9, z: sh.wall[1] + oz * 0.9, yaw });
        continue;
      }
      const { x, z, sx } = spot;
      // (the cobbler sets out boots and clogs)
      const goods = sh.id.startsWith("cobbler") ? "boots" : sh.goods === "cloth" ? "wares" : sh.goods;
      const rough = roughAt(`${sh.id} ${sh.label}`);
      // a short front: a shorter table (the goods and the awning with it)
      const aw = spot.awning ? ["shop_awning"] : [];
      // a sack by the table's far end from the door (the model's +x looks toward the door when the table is on the `+` side)
      const far = spot.side[0] * -oz + spot.side[1] * ox > 0 ? "shop_sack_l" : "shop_sack_r";
      const day = [...aw, `shop_goods_${goods}`, `shop_more_${goods}`, ...(goods === "fish" ? [] : [far]), ...(rough ? ["shop_mud"] : [])];
      const night = [...(spot.awning ? ["shop_awning_rolled"] : []), "shop_tarp"];
      put(x, z, yaw, sh.keeper, ["shop_table"], day, night, sx, rough ? "canvas_patched" : null);
      this.world.addCollider(worldRect({ ...SHOP_RECT, minX: SHOP_RECT.minX * sx, maxX: SHOP_RECT.maxX * sx }, x, z, yaw));
      // the keeper stands between the door and the table, facing the street
      this.sellerSpots.set(sh.keeper, { x: spot.seller[0], z: spot.seller[1], yaw });
      this.fronts.push({ label: sh.label, x: x + ox * 1.6, z: z + oz * 1.6 });
      record("shop table", sh.label, x, z, yaw, ["shop_table", ...day, ...night], sx, true);
    }
    for (const p of this.placed) this.show(p, !(this.night ?? false));
  }

  /** Goods and awnings by day; rolled awnings and tarpaulins by night (for stalls nobody keeps). */
  setNight(night: boolean): void {
    this.night = night;
    for (const p of this.placed) if (!p.keeper) this.show(p, !night);
  }

  /** The keeper is at work (open) or gone home (the tarp goes over the goods). */
  setOpen(keeper: string, open: boolean): void {
    for (const p of this.placed) if (p.keeper === keeper) this.show(p, open);
  }

  private show(p: Placed, open: boolean): void {
    if (p.open === open) return;
    p.open = open;
    this.dirty = true;
  }

  /** All stalls into one mesh per material (a few ms; only when a stall opens or shuts). */
  private rebuild(): void {
    this.dirty = false;
    const parts = this.parts;
    if (!parts) return;
    const acc = new Map<THREE.Material, { n: number; list: Array<{ ch: Chunk; m: THREE.Matrix4; nm: THREE.Matrix3 }> }>();
    for (const p of this.placed) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x, 0, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw), new THREE.Vector3(p.sx, 1, 1));
      const nm = new THREE.Matrix3().getNormalMatrix(m);
      for (const name of p.open === false ? p.shutNames : p.openNames) {
        for (const ch of chunksOf(parts, name, p.awning)) {
          let a = acc.get(ch.mat);
          if (!a) acc.set(ch.mat, (a = { n: 0, list: [] }));
          a.n += ch.pos.length / 3;
          a.list.push({ ch, m, nm });
        }
      }
    }
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.removeFromParent();
    }
    this.meshes = [];
    for (const [mat, a] of acc) {
      const pos = new Float32Array(a.n * 3);
      const nor = new Float32Array(a.n * 3);
      const uv = new Float32Array(a.n * 2);
      const col = new Float32Array(a.n * 3);
      let k = 0;
      for (const { ch, m, nm } of a.list) {
        const n = ch.pos.length / 3;
        const e = m.elements;
        const f = nm.elements;
        for (let i = 0; i < n; i++) {
          const j = i * 3;
          const o = (k + i) * 3;
          const x = ch.pos[j], y = ch.pos[j + 1], z = ch.pos[j + 2];
          pos[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
          pos[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
          pos[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
          const nx = ch.nor[j], ny = ch.nor[j + 1], nz = ch.nor[j + 2];
          const ax = f[0] * nx + f[3] * ny + f[6] * nz, ay = f[1] * nx + f[4] * ny + f[7] * nz, az = f[2] * nx + f[5] * ny + f[8] * nz;
          const l = Math.hypot(ax, ay, az) || 1;
          nor[o] = ax / l;
          nor[o + 1] = ay / l;
          nor[o + 2] = az / l;
        }
        uv.set(ch.uv, k * 2);
        col.set(ch.col, k * 3);
        k += n;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = `town_stalls_${mat.name}`;
      this.group.add(mesh);
      this.meshes.push(mesh);
    }
  }

  /** Dev: which stalls are open now. */
  get states(): Array<{ keeper: string | null; open: boolean | null }> {
    return this.placed.map((p) => ({ keeper: p.keeper, open: p.open }));
  }

  /** Make the meshes again when a stall opened or shut (the whole town's stalls are a few thousand faces: no hiding by distance). */
  update(_cx: number, _cz: number, _far: number): void {
    // (keepers come and go in bunches at the hour: one rebuild for the bunch, at most one a second)
    const now = performance.now();
    if (this.dirty && now - this.builtAt > 1000) {
      this.builtAt = now;
      this.rebuild();
    }
  }
}
