import * as THREE from "three";
import { psx } from "../retro/psx";
import { quayStoneMaterials } from "./city";
import { rectAround, type Rect } from "./geom";
import { railings, placesRailMaterial } from "./townplaces";
import { buildTrees3D } from "./trees3d";

// The liberty tree of the Grote Markt (look survey, Codex's period point 3: it stood on the square until 1882). The
// young state planted its liberty trees after the revolution of 1830; this one is a lime of some forty years, in a
// bed of earth inside a ring of bluestone kerbs and a low iron railing, as the town's greens have them. The tree is
// the town's own lime (trees.glb, world/trees3d.ts), the railing the places' railing (world/townplaces.ts), the kerb
// the quays' coping stone: no new model and no new shader. Off the cart ruts, the stall rows and the town's stalls.

export const LIBERTY_TREE: [number, number] = [-262, 86];
const R_RAIL = 1.3;
const R_KERB = 1.45;

/** Plant it; its colliders (the railing's ring, for Jef, the crowd and the market's layout). */
export function loadLibertyTree(scene: THREE.Scene, ready: Promise<unknown>): Rect[] {
  const [cx, cz] = LIBERTY_TREE;
  const g = new THREE.Group();
  g.name = "liberty_tree";
  scene.add(g);
  // the railing: an octagon of the places' low railing, on the kerb
  const ring: Array<[number, number]> = [];
  for (let i = 0; i <= 8; i++) {
    const a = (Math.PI * 2 * i) / 8 + Math.PI / 8;
    ring.push([cx + Math.cos(a) * R_RAIL, cz + Math.sin(a) * R_RAIL]);
  }
  const rg = railings([ring]);
  if (rg) {
    rg.translate(0, 0.18, 0);
    const m = new THREE.Mesh(rg, placesRailMaterial());
    m.name = "liberty_tree_railing";
    g.add(m);
  }
  // the bed: a kerb of bluestone round it, the earth inside a little under the kerb's top
  ready
    .then(() => {
      const kerbMat = quayStoneMaterials()?.coping;
      // (one ring of stone, so no two kerb stones' tops lie in one plane)
      const oct = (r: number) => Array.from({ length: 8 }, (_, i) => new THREE.Vector2(Math.cos((Math.PI * 2 * i) / 8 + Math.PI / 8) * r, Math.sin((Math.PI * 2 * i) / 8 + Math.PI / 8) * r));
      const shape = new THREE.Shape(oct(R_KERB));
      shape.holes.push(new THREE.Path(oct(R_KERB - 0.24).reverse()));
      const ringGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false });
      ringGeo.rotateX(-Math.PI / 2);
      ringGeo.translate(cx, 0, cz);
      const kerb = new THREE.Mesh(ringGeo, kerbMat ?? psx(new THREE.MeshLambertMaterial({ color: 0x5a5e62 }), { affine: 0 }));
      kerb.name = "liberty_tree_kerb";
      g.add(kerb);
      const earth = new THREE.Mesh(new THREE.CircleGeometry(R_KERB - 0.22, 8, Math.PI / 8).rotateX(-Math.PI / 2).translate(cx, 0.12, cz),
        psx(new THREE.MeshLambertMaterial({ color: 0x2e261d }), { affine: 0 }));
      earth.name = "liberty_tree_earth";
      g.add(earth);
      return buildTrees3D(scene, [LIBERTY_TREE], { kindAt: () => "tree_lime", scale: 1.45 });
    })
    .catch((e) => console.warn("the liberty tree did not grow", e));
  return [rectAround(cx, cz, R_KERB, R_KERB, 1.0)];
}
