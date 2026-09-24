import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { psx } from "../retro/psx";
import { smoothLine, type TrackLine } from "../world/tracks";
import type { Rect } from "../world/geom";
import type { World } from "../world/rijnkaai";
import type { BikeGround, FirstPerson } from "../player/firstPerson";
import CITY from "../../../shared/city.json";

// The velocipedes of 1873 (M3h): a handful of "boneshakers" by the doors of the
// well-off, a café and the Entrepot office, each with an owner (the server's
// town/deeds.ts says where, and whose). client/public/models/velocipede.glb comes
// from tools/blender/build_velocipede.py: the frame, the steering fork, and the
// two wheels, so the bar turns and the wheels and pedals go round. The ridden one
// follows the rider (player/firstPerson.ts bike*); this file also says what is
// under the wheels: cobbles, flagstones, earth, a rail head, the ruts.

export interface VeloInfo {
  id: string;
  owner: string;
  owner_name: string;
  x: number;
  z: number;
  /** The model's yaw (rotation.y: the machine points along (sin, cos)). */
  yaw: number;
  ridden: boolean;
  mine: boolean;
  down?: boolean;
}

interface Bike {
  info: VeloInfo;
  root: THREE.Object3D;
  steer: THREE.Object3D | null;
  front: THREE.Object3D | null;
  rear: THREE.Object3D | null;
  collider: Rect | null;
}

const RF = 0.46;
const RR = 0.38;

let loading: Promise<THREE.Object3D | null> | null = null;
/** M6 transport: the machine for a rider of the town (game/crowd.ts clones it). */
export function loadVelocipede(): Promise<THREE.Object3D | null> {
  return loadModel();
}
/** The front and rear wheel radii (velocipede.glb). */
export const WHEEL_R = { front: 0.46, rear: 0.38 };
function loadModel(): Promise<THREE.Object3D | null> {
  if (loading) return loading;
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  loading = new GLTFLoader()
    .setDRACOLoader(draco)
    .loadAsync("/models/velocipede.glb")
    .then((gltf) => {
      draco.dispose();
      const mats: Record<string, THREE.Material> = {};
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const swap = (src: THREE.Material) => {
          const name = src.name || "iron";
          if (mats[name]) return mats[name];
          const map = (src as THREE.MeshStandardMaterial).map ?? null;
          if (map) {
            map.magFilter = THREE.NearestFilter;
            map.minFilter = THREE.NearestFilter;
            map.generateMipmaps = false;
            map.colorSpace = THREE.SRGBColorSpace;
            map.wrapS = map.wrapT = THREE.RepeatWrapping;
            map.needsUpdate = true;
          }
          const mat = new THREE.MeshLambertMaterial({ map, vertexColors: true });
          mat.color.setScalar(1.6); // dark iron and oiled wood: lift them a little, or they vanish in the fog
          return (mats[name] = psx(mat, { affine: 0.5 }));
        };
        m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
      });
      const root = gltf.scene.getObjectByName("velocipede");
      if (root) root.removeFromParent();
      return root ?? null;
    })
    .catch((e: unknown) => {
      console.warn("velocipede.glb did not load; no velocipedes", e);
      draco.dispose();
      return null;
    });
  return loading;
}

// ------------------------------------------------------------------ what is under the wheels

type Tri = [number, number, number, number, number, number];
const CELL = 4;

/** City ground kinds (tools/city/plan.py ground_zones) in a coarse grid, for point look-ups. */
class GroundIndex {
  private cells = new Map<number, Array<{ kind: "earth" | "flags"; t: Tri }>>();
  constructor() {
    const g = (CITY as unknown as { ground?: Record<string, number[][]> }).ground ?? {};
    for (const kind of ["earth", "flags"] as const) {
      for (const t of g[kind] ?? []) {
        if (t.length < 6) continue;
        const tri = t.slice(0, 6) as Tri;
        const x0 = Math.floor(Math.min(tri[0], tri[2], tri[4]) / CELL);
        const x1 = Math.floor(Math.max(tri[0], tri[2], tri[4]) / CELL);
        const z0 = Math.floor(Math.min(tri[1], tri[3], tri[5]) / CELL);
        const z1 = Math.floor(Math.max(tri[1], tri[3], tri[5]) / CELL);
        for (let i = x0; i <= x1; i++)
          for (let j = z0; j <= z1; j++) {
            const k = i * 100000 + j;
            let c = this.cells.get(k);
            if (!c) this.cells.set(k, (c = []));
            c.push({ kind, t: tri });
          }
      }
    }
  }
  at(x: number, z: number): "earth" | "flags" | "cobble" {
    const c = this.cells.get(Math.floor(x / CELL) * 100000 + Math.floor(z / CELL));
    if (c) for (const e of c) if (inTri(x, z, e.t)) return e.kind;
    return "cobble";
  }
}

function inTri(x: number, z: number, t: Tri): boolean {
  const [ax, az, bx, bz, cx, cz] = t;
  const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz);
  const d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz);
  const d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** The quay railway (both rails of each line) and the crane runways, as short segments. */
function railSegments(): Array<{ ax: number; az: number; bx: number; bz: number; ux: number; uz: number; len: number; off: number }> {
  const decor = (CITY as unknown as { decor?: { tracks?: TrackLine[]; crane_rails?: Array<[number, number, number, number]> } }).decor ?? {};
  const out: Array<{ ax: number; az: number; bx: number; bz: number; ux: number; uz: number; len: number; off: number }> = [];
  const add = (ax: number, az: number, bx: number, bz: number, off: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-3) return;
    out.push({ ax, az, bx, bz, ux: (bx - ax) / len, uz: (bz - az) / len, len, off });
  };
  for (const t of decor.tracks ?? []) {
    const line = smoothLine(t);
    for (let i = 0; i < line.length - 1; i++) add(line[i][0], line[i][1], line[i + 1][0], line[i + 1][1], 1.435 / 2);
  }
  for (const [x0, z0, x1, z1] of decor.crane_rails ?? []) add(x0, z0, x1, z1, 0);
  return out;
}

// ------------------------------------------------------------------ the machines

export class Velocipedes {
  private proto: THREE.Object3D | null = null;
  private bikes = new Map<string, Bike>();
  private ground = new GroundIndex();
  private rails = railSegments();
  private ruts: Set<number> | null = null;
  private rutTry = 0;
  /** The one being ridden. */
  ridden: Bike | null = null;
  /** M6 transport: machines their owners are riding now (game/journeys.ts): not standing anywhere. */
  private inUse = new Set<string>();
  /** M6: where an owner left his machine, until the server's list says so too. */
  private placed = new Map<string, { x: number; z: number; yaw: number; t: number }>();

  constructor(
    private readonly world: World,
    private readonly player: FirstPerson,
  ) {
    player.bikeGround = (x, z) => this.groundAt(x, z);
    void loadModel().then((p) => {
      this.proto = p;
      for (const b of this.bikes.values()) this.dress(b);
    });
  }

  /** The server's list: add, move and drop machines to match. */
  sync(list: VeloInfo[]): void {
    // a hiccup on the line can bring no list at all: keep what stands
    if (!Array.isArray(list)) return;
    const seen = new Set<string>();
    for (const info of list) {
      seen.add(info.id);
      let b = this.bikes.get(info.id);
      if (!b) {
        b = { info, root: new THREE.Group(), steer: null, front: null, rear: null, collider: null };
        this.bikes.set(info.id, b);
        this.world.scene.add(b.root);
        this.dress(b);
      }
      if (this.ridden === b) {
        b.info = { ...info, ridden: true };
        continue;
      }
      // M6: an owner put it down here a moment ago; the server's list catches up within a minute
      const put = this.placed.get(info.id);
      b.info = put && performance.now() - put.t < 60_000 && !info.mine ? { ...info, x: put.x, z: put.z, yaw: put.yaw } : info;
      this.stand(b);
    }
    for (const [id, b] of this.bikes) if (!seen.has(id) && b !== this.ridden) this.drop(id);
  }

  private dress(b: Bike): void {
    if (!this.proto || b.root.children.length) return;
    const m = this.proto.clone(true);
    b.root.add(m);
    b.steer = m.getObjectByName("velocipede_steer") ?? null;
    b.front = m.getObjectByName("velocipede_front") ?? null;
    b.rear = m.getObjectByName("velocipede_rear") ?? null;
    m.rotation.order = "YXZ";
  }

  private drop(id: string): void {
    const b = this.bikes.get(id);
    if (!b) return;
    if (b.collider) this.world.removeCollider(b.collider);
    this.world.scene.remove(b.root);
    this.bikes.delete(id);
  }

  /** Parked: upright, leaning a touch, or lying on its side after a fall; in the way of walkers. */
  private stand(b: Bike): void {
    const i = b.info;
    b.root.position.set(i.x, this.world.groundAt(i.x, i.z, 0.2, 0), i.z);
    b.root.rotation.set(0, 0, 0);
    b.root.rotation.order = "YXZ";
    b.root.rotation.y = i.yaw;
    b.root.rotation.z = i.down ? -1.42 : 0.06;
    if (i.down) b.root.position.y += 0.33;
    if (b.steer) b.steer.rotation.y = i.down ? 0.3 : 0.12;
    const away = this.inUse.has(i.id);
    b.root.visible = !i.ridden && !away;
    if (b.collider) this.world.removeCollider(b.collider);
    b.collider = null;
    if (!i.ridden && !away) {
      // 1.7 m long, 0.5 m wide (a lying one a little wider), turned by its yaw
      const c = Math.abs(Math.cos(i.yaw));
      const s = Math.abs(Math.sin(i.yaw));
      const hl = 0.8;
      const hw = i.down ? 0.45 : 0.25;
      const ex = s * hl + c * hw;
      const ez = c * hl + s * hw;
      b.collider = { minX: i.x - ex, maxX: i.x + ex, minZ: i.z - ez, maxZ: i.z + ez, top: i.down ? 0.4 : undefined };
      this.world.addCollider(b.collider);
    }
  }

  /** The nearest machine nobody rides, within reach. */
  nearest(x: number, z: number, reach = 1.7): Bike | null {
    let best: Bike | null = null;
    let bd = reach;
    for (const b of this.bikes.values()) {
      if (b === this.ridden || b.info.ridden || this.inUse.has(b.info.id)) continue;
      const d = Math.hypot(b.info.x - x, b.info.z - z);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  get(id: string): Bike | undefined {
    return this.bikes.get(id);
  }

  /** Up you get (the server has said yes). */
  mount(b: Bike): void {
    if (b.collider) this.world.removeCollider(b.collider);
    b.collider = null;
    b.info = { ...b.info, ridden: true, down: false };
    this.ridden = b;
    b.root.visible = true;
    this.player.bikeMount(b.info.x, b.info.z, b.info.yaw + Math.PI);
  }

  /** Off (E), or thrown off (a fall): the machine stays where it is. Returns where. */
  leave(down = false): { id: string; x: number; z: number; yaw: number; down: boolean } | null {
    const b = this.ridden;
    if (!b) return null;
    const at = this.player.bikeRiding ? this.player.bikeDismount() : { x: b.root.position.x, z: b.root.position.z, yaw: this.player.bikeHeading };
    this.ridden = null;
    b.info = { ...b.info, x: at.x, z: at.z, yaw: at.yaw - Math.PI, ridden: false, down };
    this.stand(b);
    return { id: b.info.id, x: at.x, z: at.z, yaw: b.info.yaw, down };
  }

  /** Taken off him (the owner caught him, or the police): back home, per the server. */
  forget(): void {
    const b = this.ridden;
    if (!b) return;
    if (this.player.bikeRiding) this.player.bikeDismount();
    this.ridden = null;
  }

  update(dt: number): void {
    const b = this.ridden;
    if (b) {
      const p = this.player;
      b.root.position.set(p.x, p.y, p.z);
      b.root.rotation.order = "YXZ";
      b.root.rotation.y = p.bikeHeading + Math.PI;
      b.root.rotation.z = p.bikeLean;
      if (b.steer) b.steer.rotation.y = p.bikeSteer;
      if (b.front) b.front.rotation.x = p.bikeDist / RF;
      if (b.rear) b.rear.rotation.x = p.bikeDist / RR;
    }
    // parked ones far off are not drawn (10 draw calls each)
    for (const o of this.bikes.values()) if (o !== b && !o.info.ridden) o.root.visible = !this.inUse.has(o.info.id) && Math.hypot(o.info.x - this.player.x, o.info.z - this.player.z) < 70;
    if (!this.ruts && (this.rutTry -= dt) <= 0) {
      this.rutTry = 2;
      this.findRuts();
    }
  }

  /** The cart-road ruts (world/ruts.ts paints them once the walk map is in): cells of 1 m they cover. */
  private findRuts(): void {
    const mesh = this.world.scene.getObjectByName("ruts") as THREE.Mesh | undefined;
    if (!mesh?.isMesh) return;
    const pos = mesh.geometry.getAttribute("position");
    const col = mesh.geometry.getAttribute("color");
    const cells = new Set<number>();
    for (let i = 0; i + 2 < pos.count; i += 3) {
      // faded ends do not count
      if (col && col.itemSize === 4 && col.getW(i) + col.getW(i + 1) + col.getW(i + 2) < 1.2) continue;
      const xs = [pos.getX(i), pos.getX(i + 1), pos.getX(i + 2)];
      const zs = [pos.getZ(i), pos.getZ(i + 1), pos.getZ(i + 2)];
      const tri: Tri = [xs[0], zs[0], xs[1], zs[1], xs[2], zs[2]];
      for (let x = Math.floor(Math.min(...xs)); x <= Math.floor(Math.max(...xs)); x++)
        for (let z = Math.floor(Math.min(...zs)); z <= Math.floor(Math.max(...zs)); z++) if (inTri(x + 0.5, z + 0.5, tri)) cells.add(x * 100000 + z);
    }
    this.ruts = cells;
  }

  /** What is under the wheels at (x, z). */
  groundAt(x: number, z: number): BikeGround {
    const kind = this.world.surfaceAt(x, z) === "wood" ? "wood" : this.ground.at(x, z);
    let rail: [number, number] | null = null;
    for (const r of this.rails) {
      // quick box test, then the distance to the line and to its rails
      if (x < Math.min(r.ax, r.bx) - 2 || x > Math.max(r.ax, r.bx) + 2 || z < Math.min(r.az, r.bz) - 2 || z > Math.max(r.az, r.bz) + 2) continue;
      const t = (x - r.ax) * r.ux + (z - r.az) * r.uz;
      if (t < -0.05 || t > r.len + 0.05) continue;
      const d = Math.abs((x - r.ax) * -r.uz + (z - r.az) * r.ux);
      if (Math.abs(d - r.off) < 0.09) {
        rail = [r.ux, r.uz];
        break;
      }
    }
    const rut = !!this.ruts?.has(Math.floor(x) * 100000 + Math.floor(z));
    return { kind, rail, rut };
  }

  /** The ridden machine's rattle for the soundscape (as a handcart: iron tyres on stone). */
  sounds(): Array<{ kind: "handcart"; x: number; z: number; state: string }> {
    if (!this.ridden || Math.abs(this.player.bikeSpeed) < 0.6) return [];
    return [{ kind: "handcart", x: this.player.x, z: this.player.z, state: "go" }];
  }

  /**
   * M6 transport: an owner takes his machine (on) or puts it down at `at` (off). While in use it
   * stands nowhere (not drawn, not solid, not to be taken).
   */
  use(id: string, on: boolean, at?: { x: number; z: number; yaw: number }): void {
    const b = this.bikes.get(id);
    if (on) this.inUse.add(id);
    else {
      this.inUse.delete(id);
      if (at) this.placed.set(id, { ...at, t: performance.now() });
    }
    if (!b || b === this.ridden) return;
    if (!on && at && !b.info.mine) b.info = { ...b.info, x: at.x, z: at.z, yaw: at.yaw };
    this.stand(b);
  }

  /** M6: is this machine standing where it can be used (not Jef's, not ridden, not in use)? */
  standing(id: string): VeloInfo | null {
    const b = this.bikes.get(id);
    if (!b || b === this.ridden || b.info.ridden || b.info.mine || this.inUse.has(id)) return null;
    return b.info;
  }

  /** Dev: where they are. */
  list(): VeloInfo[] {
    return [...this.bikes.values()].map((b) => b.info);
  }
}
