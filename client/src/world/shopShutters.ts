import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { HousePlan, HouseWindow } from "../../../shared/housePlan";
import { boxGeo, canvasTex, lambert, tex } from "./rooms";

// Empty fronts (2026-09-26, docs/milestones/M7-empty-fronts.md): the shop shutters. A shut shop at night showed its
// window as a dark hole beside a dark doorway (Steve: "empty glitchy shop"). In 1873 a shop put its shutters up at
// closing: planks set up before the window from the street, a bar across. Here each window cut through a shop's
// front (shared/housePlan.ts, kind "hole") gets them, 3 mm to 5 cm out from the house's face, in the street's scene
// only: out there the room's pass never draws over them (its punch lies in the face, behind them). From inside, the
// room's scene has their back: one plank face per window just out of the house's face, facing in (culled from the
// street): dark boards with the day's light in the chinks, unlit (lit backs read as a grey fog through the glass).
// Up while the shop is shut, except in the midday break (shutUp below); down (hidden) while it is open.
// No lights, and the materials are the door leaf's own (no new shader kind: docs/rendering.md).

export interface Shutters {
  id: string;
  /** How many windows they close. */
  windows: number;
  readonly up: boolean;
  set(up: boolean): void;
}

const all = new Map<string, Shutters>();

/** Every shop's shutters made so far, by the house plan's id (the empty-fronts check reads them). */
export function allShutters(): ReadonlyMap<string, Shutters> {
  return all;
}

/** The engine's rule for the boards: up while the shop is shut, but not in the midday break (11:30 to 14:30). */
export function shutUp(open: boolean, hour: number): boolean {
  return !open && !(hour >= 11.5 && hour < 14.5);
}

function windowBoards(w: HouseWindow, planks: THREE.BufferGeometry[], iron: THREE.BufferGeometry[], backs: THREE.BufferGeometry[]): void {
  const ax = w.a[0];
  const az = w.a[1];
  const L = Math.hypot(w.b[0] - ax, w.b[1] - az);
  const tx = (w.b[0] - ax) / L;
  const tz = (w.b[1] - az) / L;
  const [ox, oz] = w.out;
  const ry = Math.atan2(ox, oz);
  // s along the window, y up, d into the house from its face
  const put = (g: THREE.BufferGeometry, s: number, y: number, d: number, into: THREE.BufferGeometry[]) => {
    g.rotateY(ry);
    g.translate(ax + tx * s - ox * d, y, az + tz * s - oz * d);
    into.push(g);
  };
  const H = w.y1 - w.y0;
  // (d < 0: out in the street) the planks, upright and side by side, 3 to 23 mm out: just the opening, so no board
  // lies over the wall's face (dev/zfight.ts: a layer that near fights under the PS1 wobble)
  const n = Math.max(2, Math.round(L / 0.24));
  const pw = L / n;
  for (let i = 0; i < n; i++) put(boxGeo(pw, H, 0.02, 1), pw * (i + 0.5), w.y0 + H / 2, -0.013, planks);
  // two battens across and the iron bar, each 2.5 cm proud of the planks (a "close" layer, as the door leaf's panels)
  for (const k of [0.2, 0.8]) put(boxGeo(L - 0.04, 0.1, 0.025, 1), L / 2, w.y0 + H * k, -0.0355, planks);
  put(new THREE.BoxGeometry(L - 0.02, 0.05, 0.025), L / 2, w.y0 + H * 0.5, -0.0355, iron);
  // their back, seen from inside through the glass: facing in (turned from the outward normal), 2 mm out of the face
  const back = new THREE.PlaneGeometry(L, H);
  const uv = back.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * L, uv.getY(i) * H);
  back.rotateY(Math.PI);
  put(back, L / 2, w.y0 + H / 2, -0.002, backs);
}

let backMat: THREE.MeshBasicMaterial | null = null;
/** Their back from inside: dark planks, a hand wide, a line of daylight between (one texture, a metre square). */
function backMaterial(): THREE.MeshBasicMaterial {
  backMat ??= new THREE.MeshBasicMaterial({
    map: canvasTex(64, 64, (g) => {
      g.fillStyle = "#1c140e";
      g.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 5; i++) {
        const x = Math.round((i * 64) / 5);
        g.fillStyle = i % 2 ? "#241a12" : "#20160f";
        g.fillRect(x + 1, 0, 11, 64);
        g.fillStyle = "#8a8474";
        g.fillRect(x, 0, 1, 64);
      }
      g.fillStyle = "#2c2016";
      g.fillRect(0, 12, 64, 5);
      g.fillRect(0, 47, 64, 5);
    }),
  });
  return backMat;
}

/** The chinks carry the day's light (0 at night .. 1 by day; from the clock, as main.ts dayK). Each frame. */
export function shutterDaylight(hour: number): void {
  const k = Math.max(0, Math.min(1, hour < 12 ? (hour - 6.5) / 3 : (18.5 - hour) / 3));
  backMat?.color.setScalar(0.3 + 0.7 * k);
}

/** Shutters for a shop's cut windows, in the street's scene, placed in the house's frame (as world/houseInWorld.ts frames its leaf). Down at first. */
export function makeShutters(plan: HousePlan, streetScene: THREE.Object3D, roomScene: THREE.Object3D): Shutters {
  const holes = plan.windows.filter((w) => w.kind === "hole");
  const planks: THREE.BufferGeometry[] = [];
  const iron: THREE.BufferGeometry[] = [];
  const backs: THREE.BufferGeometry[] = [];
  for (const w of holes) windowBoards(w, planks, iron, backs);
  const wood = lambert("shop_shutter", { map: tex().planks, color: 0x8a9478 }, 0);
  const ironM = lambert("house_leaf_iron", { color: 0x2a2622 }, 0);
  const groups: THREE.Group[] = [];
  if (holes.length) {
    const woodG = mergeGeometries(planks, false)!;
    const ironG = mergeGeometries(iron, false)!;
    const backG = mergeGeometries(backs, false)!;
    for (const g of [...planks, ...iron, ...backs]) g.dispose();
    const backM = backMaterial();
    for (const parent of [streetScene, roomScene]) {
      const g = new THREE.Group();
      g.name = `shutters_${plan.id}`;
      g.position.set(plan.origin.x, plan.floorY, plan.origin.z);
      g.rotation.y = plan.yaw;
      if (parent === streetScene) g.add(new THREE.Mesh(woodG, wood), new THREE.Mesh(ironG, ironM));
      else g.add(new THREE.Mesh(backG, backM));
      g.visible = false;
      g.userData.shutters = plan.id; // (dev/zfight.ts, the empty-fronts check)
      parent.add(g);
      g.updateMatrixWorld(true);
      groups.push(g);
    }
  }
  let up = false;
  const s: Shutters = {
    id: plan.id,
    windows: holes.length,
    get up() {
      return up;
    },
    set(v) {
      if (v === up) return;
      up = v;
      for (const g of groups) g.visible = v;
    },
  };
  all.set(plan.id, s);
  return s;
}
