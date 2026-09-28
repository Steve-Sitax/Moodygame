import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { psx } from "../retro/psx";

// T3 trade (docs/milestones/T3-trade.md): a box of fish from the Vliet at dawn, as the dockers carry them to the back
// of the fish banks (shared/hauls.ts vm-1, vm-2) and a player in the foreman's book too. A low open box of rough
// boards, packed with herring head to tail, a little straw at the ends. One model wherever a fish box shows (CLAUDE.md:
// one model per thing): on the pile at the Vliet, in a docker's arms, in the player's hands. Two meshes: the boards
// (the crate's wood) and the fish (one shared silver material: the same psx Lambert as everything, no new shader).

/** The box: 0.62 long, 0.42 wide, 0.24 high (m); it stands on its base. */
export const FISHBOX = { l: 0.62, w: 0.42, h: 0.24 };

let wood: THREE.BufferGeometry | null = null;
let fish: THREE.BufferGeometry | null = null;
let fishMat: THREE.Material | null = null;

function boards(): THREE.BufferGeometry {
  const { l, w, h } = FISHBOX;
  const t = 0.022;
  const parts: THREE.BufferGeometry[] = [];
  // the bottom: three boards along, with gaps
  for (const z of [-w / 3, 0, w / 3]) parts.push(new THREE.BoxGeometry(l, t, w / 3 - 0.012).translate(0, t / 2, z));
  // the sides: two boards high on the long sides, one on the ends (a handle hole left as a gap between them)
  for (const s of [-1, 1]) {
    parts.push(new THREE.BoxGeometry(l, h * 0.45, t).translate(0, h * 0.25, s * (w / 2 - t / 2)));
    parts.push(new THREE.BoxGeometry(l, h * 0.35, t).translate(0, h * 0.78, s * (w / 2 - t / 2)));
    parts.push(new THREE.BoxGeometry(t, h, w).translate(s * (l / 2 - t / 2), h / 2, 0));
  }
  // the corner posts inside
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(new THREE.BoxGeometry(0.03, h, 0.03).translate(sx * (l / 2 - 0.035), h / 2, sz * (w / 2 - 0.035)));
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()), false)!;
  for (const p of parts) p.dispose();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  g.name = "fish box";
  return g;
}

/** One herring: a slim smooth body along x (head at +x), flat on its side, a forked tail; dark blue-grey back, silver belly. */
function herring(len: number): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(1, 10, 6).toNonIndexed();
  body.scale(len * 0.4, len * 0.055, len * 0.085);
  body.translate(len * 0.08, 0, 0);
  // the tail: two flat triangles, forked, a little up from the body's line
  const t = len * 0.12;
  const x0 = -len * 0.3;
  const tail = new THREE.BufferGeometry();
  tail.setAttribute("position", new THREE.Float32BufferAttribute([x0, 0, 0, x0 - t, 0.004, t * 0.7, x0 - t * 0.6, 0, 0, x0, 0, 0, x0 - t * 0.6, 0, 0, x0 - t, 0.004, -t * 0.7, x0, 0, 0, x0 - t * 0.6, 0, 0, x0 - t, 0.004, t * 0.7, x0, 0, 0, x0 - t, 0.004, -t * 0.7, x0 - t * 0.6, 0, 0], 3));
  tail.setAttribute("uv", new THREE.Float32BufferAttribute(new Array(24).fill(0), 2));
  // (the same attributes on both: position only; the normals are worked out after the merge)
  body.deleteAttribute("uv");
  body.deleteAttribute("normal");
  tail.deleteAttribute("uv");
  const g = mergeGeometries([body, tail], false)!;
  g.computeVertexNormals();
  // the colours: the back (up, y > 0) dark blue-grey, the belly silver
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const col: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const k = THREE.MathUtils.clamp(pos.getY(i) / (len * 0.05) * 0.5 + 0.5, 0, 1);
    col.push(0.78 - 0.5 * k, 0.8 - 0.44 * k, 0.82 - 0.36 * k);
  }
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
}

function packed(): THREE.BufferGeometry {
  const { l, w, h } = FISHBOX;
  const parts: THREE.BufferGeometry[] = [];
  // two layers of herring head to tail across the box, the top one showing
  let k = 0;
  for (let layer = 0; layer < 2; layer++) {
    const rows = 5;
    for (let i = 0; i < rows; i++) {
      const z = -w / 2 + 0.05 + (i + 0.5) * ((w - 0.1) / rows);
      const head = (i + layer) % 2 === 0 ? 1 : -1;
      const f = herring(l * 0.46).rotateY(head > 0 ? 0 : Math.PI);
      const jitter = ((k * 37) % 7) / 100 - 0.03;
      for (const x of [-l * 0.23, l * 0.23]) {
        const g = f.clone().translate(x + jitter, h * (0.45 + layer * 0.28), z);
        parts.push(g);
        k++;
      }
      f.dispose();
    }
  }
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  g.name = "fish box fish";
  return g;
}

/** A fish box as an object (its base at y 0), with the boards in the given wood material (the crate's). */
export function fishBoxMesh(woodMat: THREE.Material): THREE.Group {
  wood ??= boards();
  fish ??= packed();
  fishMat ??= psx(new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xffffff }));
  fishMat.name = "herring";
  const g = new THREE.Group();
  g.name = "fish box";
  const b = new THREE.Mesh(wood, woodMat);
  b.name = "fish box boards";
  const f = new THREE.Mesh(fish, fishMat);
  f.name = "fish box fish";
  g.add(b, f);
  return g;
}

/** Is this item a box of fish (a load of the Vismarkt's routes)? */
export const isFishBox = (id: string | null | undefined): boolean => !!id && /^haul:vm-\d+[ab]:/.test(id);
