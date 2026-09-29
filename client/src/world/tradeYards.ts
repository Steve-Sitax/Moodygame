import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { psx } from "../retro/psx";
import type { TownData } from "../net/api";
import type { Rect } from "./geom";
import { SPOTS } from "./rijnkaai";
import { onKegModel } from "../game/kegModel";

// T5 beer and coal (docs/milestones/T5-beer-coal.md): what the runs of chains 5 and 6 go to and from, in the world.
// - A cellar hatch before every tavern: two oak flaps with iron rings, flush in the pavement a step to the right of
//   the door (where server trade/ledger.ts postDoor has the brewery's man set the kegs down).
// - The coal yard on the canal's west quay (the barge's coal): a heap of lumps and a few wicker baskets.
// - The brewery's kegs by its door on the Canal des Brasseurs.
// Merged: one mesh per material for all of it (four draws: wood, iron, coal, and the kegs in the clutter's material),
// shared materials, no new shader kind (docs/rendering.md).

interface Host {
  scene: THREE.Scene;
  groundAt(x: number, z: number, radius: number, feet: number): number;
  addCollider(r: Rect): void;
  /** Open ground to set things on: land, no wall or prop, off the rails (with room for a wagon). */
  free(x: number, z: number): boolean;
  /** Something solid on land here (a house wall), not water. */
  wall(x: number, z: number): boolean;
}

/**
 * Where to set a few things down by a door: open ground within 4 m, not before the door (1.6 m clear), off the
 * rails, near the door, against a wall where there is one (the brewery's door on the canal quay: its spot's dir is
 * only rough). Uses the world's own walk test (not the crowd's grid: that is only kept round the player).
 */
function byTheWall(host: Host, x0: number, z0: number): [number, number] | null {
  let best: [number, number] | null = null;
  let score = -Infinity;
  for (let dx = -4; dx <= 4; dx += 0.25)
    for (let dz = -4; dz <= 4; dz += 0.25) {
      const x = x0 + dx;
      const z = z0 + dz;
      const d = Math.hypot(dx, dz);
      if (d < 1.6 || d > 4) continue;
      // room for the three kegs (0.9 m square) all on open ground
      if (![-0.45, 0, 0.45].every((a) => [-0.45, 0, 0.45].every((b) => host.free(x + a, z + b)))) continue;
      // a wall within 0.9 m (in one of eight directions) counts for it
      let near = 0;
      for (let k = 0; k < 8; k++) if (host.wall(x + Math.cos((k * Math.PI) / 4) * 0.9, z + Math.sin((k * Math.PI) / 4) * 0.9)) near++;
      const sc = near * 2 - d;
      if (sc > score) {
        score = sc;
        best = [x, z];
      }
    }
  return best;
}

const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, yaw: number) =>
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1)));

const plain = (g: THREE.BufferGeometry) => {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (k !== "position" && k !== "normal") n.deleteAttribute(k);
  return n;
};

/** A cellar hatch: a frame and two flaps (1.1 by 0.9 m), a ring on each, its top a hand above the stones. */
function hatch(): { wood: THREE.BufferGeometry[]; iron: THREE.BufferGeometry[] } {
  const wood: THREE.BufferGeometry[] = [];
  const iron: THREE.BufferGeometry[] = [];
  wood.push(new THREE.BoxGeometry(1.2, 0.03, 0.06).translate(0, 0.015, 0.47), new THREE.BoxGeometry(1.2, 0.03, 0.06).translate(0, 0.015, -0.47));
  wood.push(new THREE.BoxGeometry(0.06, 0.03, 0.9).translate(0.57, 0.015, 0), new THREE.BoxGeometry(0.06, 0.03, 0.9).translate(-0.57, 0.015, 0));
  for (const s of [-1, 1]) {
    wood.push(new THREE.BoxGeometry(0.53, 0.025, 0.86).translate(s * 0.275, 0.0125, 0));
    // the flap's battens, and a ring to lift it by
    wood.push(new THREE.BoxGeometry(0.5, 0.012, 0.07).translate(s * 0.275, 0.03, 0.25), new THREE.BoxGeometry(0.5, 0.012, 0.07).translate(s * 0.275, 0.03, -0.25));
    iron.push(new THREE.TorusGeometry(0.045, 0.009, 4, 10).rotateX(Math.PI / 2).translate(s * 0.08, 0.03, 0));
  }
  return { wood, iron };
}


/** A rough lump of coal (radius r): a squashed, knocked-about icosahedron (non-indexed: flat faces catch the light, no flatShading shader). */
function lump(r: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, 0);
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const k = 0.75 + 0.5 * Math.abs(Math.sin(seed * 12.9898 + i * 78.233));
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

/** The coal heap: a low faceted mound (1.8 by 1.4 m, 0.6 high) with lumps lying on it and round its foot. */
function heap(): THREE.BufferGeometry[] {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const bump = 1 + 0.1 * Math.sin(x * 9.1 + z * 5.3) * Math.cos(y * 7.7 - x * 3.1);
    p.setXYZ(i, x * 0.9 * bump, Math.max(0, y) * 0.6 * bump, z * 0.7 * bump);
  }
  g.computeVertexNormals();
  const out: THREE.BufferGeometry[] = [g];
  // lumps: on the mound's skin (its height there) and a scatter at its foot
  for (let i = 0; i < 70; i++) {
    const a = i * 2.39996;
    const f = Math.sqrt((i + 0.5) / 70) * 1.08;
    const x = Math.cos(a) * 0.9 * f;
    const z = Math.sin(a) * 0.7 * f;
    const y = f < 1 ? 0.6 * Math.sqrt(Math.max(0, 1 - f * f)) : 0;
    out.push(lump(0.05 + 0.05 * Math.abs(Math.sin(i * 3.7)), i).rotateY(i).translate(x, y + 0.01, z));
  }
  return out;
}

/** Build the hatches, the coal yard and the brewery's kegs once the town's places are known. */
export function buildTradeYards(host: Host, data: TownData): THREE.Group {
  const woodMat = psx(new THREE.MeshLambertMaterial({ color: 0x4e3a26 }));
  woodMat.name = "trade yard wood";
  const ironMat = psx(new THREE.MeshLambertMaterial({ color: 0x2c2a28 }));
  ironMat.name = "trade yard iron";
  const coalMat = psx(new THREE.MeshLambertMaterial({ color: 0x2b2926 }));
  coalMat.name = "coal";
  const group = new THREE.Group();
  group.name = "trade yards";
  const wood: THREE.BufferGeometry[] = [];
  const iron: THREE.BufferGeometry[] = [];
  const coal: THREE.BufferGeometry[] = [];
  // the cellar hatches before the taverns (as the server's postDoor: 1.6 out, 1.1 to the right of the door)
  for (const [id, t] of Object.entries(data.places)) {
    if (!id.startsWith("tavern:")) continue;
    const [ox, oz] = t.out ?? [0, -1];
    const x = t.x + ox * 1.6 - oz * 1.1;
    const z = t.z + oz * 1.6 + ox * 1.1;
    const y = host.groundAt(x, z, 0.3, 0);
    const yaw = Math.atan2(ox, oz);
    const h = hatch();
    for (const g of h.wood) wood.push(at(plain(g), x, y, z, yaw));
    for (const g of h.iron) iron.push(at(plain(g), x, y, z, yaw));
  }
  // the coal yard: the heap and three baskets beside it
  const cw = SPOTS.canal_west as { x: number; z: number } | undefined;
  if (cw) {
    // (against the quay's west side, clear of the walking line down the middle: the drove of pigs and the town walk
    // it, M7 check 2026-09-29; first placed on it)
    const [x, z] = [cw.x - 5.2, cw.z - 0.6];
    const y = host.groundAt(x, z, 0.3, 0);
    for (const g of heap()) coal.push(at(plain(g), x, y, z, 0.4));
    for (const [dx, dz] of [
      [1.5, 0.6],
      [1.6, -0.3],
      [1.1, 1.3],
    ]) {
      wood.push(at(plain(new THREE.CylinderGeometry(0.26, 0.2, 0.36, 8, 1, true).translate(0, 0.18, 0)), x + dx, y, z + dz, 0));
      for (let i = 0; i < 7; i++) coal.push(at(plain(lump(0.07, i + dx * 10).translate(Math.cos(i * 0.9) * (i ? 0.13 : 0), 0.37, Math.sin(i * 0.9) * (i ? 0.13 : 0))), x + dx, y, z + dz, 0));
    }
    host.addCollider({ minX: x - 1.2, maxX: x + 1.9, minZ: z - 0.9, maxZ: z + 1.6, top: 0.6 });
  }
  // the brewery's kegs: three by its door, against its wall, off the quay rails and out of the door's way
  const by = SPOTS.brewery_yard as { x: number; z: number; dir?: [number, number] } | undefined;
  const kegAt = by ? byTheWall(host, by.x, by.z) : null;
  if (kegAt) {
    const [bx, bz] = kegAt;
    const y = host.groundAt(bx, bz, 0.3, 0);
    // (the one keg model, game/kegModel.ts: clutter.glb's keg, three copies merged into one mesh)
    onKegModel((g, m) => {
      const three = [
        [-0.22, -0.2],
        [0.24, -0.15],
        [0, 0.24],
      ].map(([ax, az]) => at(g.clone(), bx + ax, y, bz + az, ax * 3));
      const k = mergeGeometries(three, false);
      for (const q of three) q.dispose();
      if (!k) return;
      k.computeBoundingSphere();
      const mesh = new THREE.Mesh(k, m);
      mesh.name = "trade yards kegs";
      group.add(mesh);
    });
    host.addCollider({ minX: bx - 0.45, maxX: bx + 0.45, minZ: bz - 0.45, maxZ: bz + 0.45, top: 0.6 });
  }
  for (const [list, mat] of [
    [wood, woodMat],
    [iron, ironMat],
    [coal, coalMat],
  ] as const) {
    if (!list.length) continue;
    const g = mergeGeometries(list, false);
    for (const q of list) q.dispose();
    if (!g) continue;
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.name = `trade yards ${mat.name}`;
    group.add(m);
  }
  host.scene.add(group);
  return group;
}
