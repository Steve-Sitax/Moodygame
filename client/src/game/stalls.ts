import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { psx } from "../retro/psx";
import type { Rect } from "../world/geom";
import type { TownShop, TownStall } from "../net/api";

// Market stalls and shop fronts (M3e), from client/public/models/stalls.glb
// (tools/blender/build_stalls.py). By day: the awning out and the goods on the
// table. At night the sellers go home: the awning is rolled up and a tarred
// tarpaulin is tied over the table. The stalls stand where the town put them
// (server town/places.ts STALLS; shop fronts beside a shopkeeper's door).

interface Parts {
  protos: Map<string, THREE.Object3D>;
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
        const mat = psx(new THREE.MeshLambertMaterial({ map, vertexColors: true }), { affine: 0.6 });
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
      return { protos };
    })
    .catch((e: unknown) => {
      console.warn("stalls.glb did not load; no market stalls", e);
      draco.dispose();
      return null;
    });
  return loading;
}

/** Footprints from the build report (local frame, customer side +z). */
const STALL_RECT = { minX: -1.4, maxX: 1.4, minZ: -0.71, maxZ: 0.71 };
const SHOP_RECT = { minX: -0.8, maxX: 0.8, minZ: 0.25, maxZ: 0.95 };

interface Placed {
  keeper: string | null;
  open: boolean | null;
  day: THREE.Object3D[];
  night: THREE.Object3D[];
  group: THREE.Group;
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
  private night: boolean | null = null;
  /** Where the sellers stand: behind each stall, beside each shop table. */
  readonly sellerSpots = new Map<string, { x: number; z: number; yaw: number }>();
  /** Places a path must reach (the customer side), for the path check. */
  readonly fronts: Array<{ label: string; x: number; z: number }> = [];

  constructor(private readonly world: StallWorld) {}

  async build(stalls: TownStall[], shops: TownShop[]): Promise<void> {
    const parts = await load();
    if (!parts) return;
    const get = (n: string) => parts.protos.get(n)?.clone() ?? null;
    stalls.forEach((s, i) => {
      const yaw = Math.atan2(s.face[0], s.face[1]);
      const g = new THREE.Group();
      g.position.set(s.x, 0, s.z);
      g.rotation.y = yaw;
      const frame = get("stall_frame");
      if (!frame) return;
      g.add(frame);
      const day = [get("stall_awning"), get(`stall_goods_${s.goods}`)].filter(Boolean) as THREE.Object3D[];
      const night = [get("stall_awning_rolled"), get("stall_tarp")].filter(Boolean) as THREE.Object3D[];
      for (const o of [...day, ...night]) g.add(o);
      this.world.scene.add(g);
      this.world.addCollider(worldRect(STALL_RECT, s.x, s.z, yaw));
      this.placed.push({ keeper: s.keeper, open: null, day, night, group: g });
      if (s.keeper) this.sellerSpots.set(s.keeper, { x: s.x - s.face[0] * 1.15, z: s.z - s.face[1] * 1.15, yaw });
      this.fronts.push({ label: `stall ${i} (${s.goods})`, x: s.x + s.face[0] * 1.3, z: s.z + s.face[1] * 1.3 });
    });
    for (const sh of shops) {
      if (!sh.goods) continue;
      const [ox, oz] = sh.out;
      const yaw = Math.atan2(ox, oz);
      // the table stands beside the door (as the server put the keeper), its back to the wall
      const side: [number, number] = [-oz, ox];
      const x = sh.wall[0] + side[0] * 1.9;
      const z = sh.wall[1] + side[1] * 1.9;
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.rotation.y = yaw;
      const table = get("shop_table");
      if (!table) continue;
      g.add(table);
      const goods = sh.goods === "cloth" ? "wares" : sh.goods;
      const day = [get("shop_awning"), get(`shop_goods_${goods}`)].filter(Boolean) as THREE.Object3D[];
      const night = [get("shop_awning_rolled"), get("shop_tarp")].filter(Boolean) as THREE.Object3D[];
      for (const o of [...day, ...night]) g.add(o);
      this.world.scene.add(g);
      this.world.addCollider(worldRect(SHOP_RECT, x, z, yaw));
      this.placed.push({ keeper: sh.keeper, open: null, day, night, group: g });
      // the keeper stands at the end of the table nearest the door, facing the street
      this.sellerSpots.set(sh.keeper, { x: sh.wall[0] + side[0] * 0.75 + ox * 0.9, z: sh.wall[1] + side[1] * 0.75 + oz * 0.9, yaw });
      this.fronts.push({ label: sh.label, x: x + ox * 1.6, z: z + oz * 1.6 });
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
    for (const o of p.day) o.visible = open;
    for (const o of p.night) o.visible = !open;
  }

  /** Dev: which stalls are open now. */
  get states(): Array<{ keeper: string | null; open: boolean | null }> {
    return this.placed.map((p) => ({ keeper: p.keeper, open: p.open }));
  }

  /** Hide what is far off (cheap: whole stalls). */
  update(cx: number, cz: number, far: number): void {
    for (const p of this.placed) p.group.visible = Math.hypot(p.group.position.x - cx, p.group.position.z - cz) < far + 10;
  }
}
