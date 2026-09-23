import * as THREE from "three";
import { LW_MIN } from "./tide";
import { psx } from "../retro/psx";

// The far bank of the Schelde (the left bank, the Vlaams Hoofd), across the
// river from the quays: in 1873 low polder land behind a dyke, rows of trees, a few inns
// and houses at the ferry landing, the earthworks of the Tête de Flandre fort, a mill.
// Only seen on clear days (fog hides it otherwise), so it is a low, simple silhouette.
// World frame: x runs along the river, the water is at z < 0.

const BANK_Z = -290; // the waterline of the far bank (the river is wider; the fog needs it nearer)
const X0 = -1100;
const X1 = 900;

export function buildFarBank(scene: THREE.Scene, waterY: number): THREE.Group {
  const g = new THREE.Group();
  g.name = "far_bank";
  const pos: number[] = [];
  const col: number[] = [];
  let seed = 1873;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const tri = (a: number[], b: number[], c: number[], k: number[]) => {
    pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) col.push(...k);
  };
  const quad = (a: number[], b: number[], c: number[], d: number[], k: number[]) => {
    tri(a, b, c, k);
    tri(a, c, d, k);
  };
  /** A box, faces toward the town (+z) and up only: it is only ever seen from across the river. */
  const box = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, k: number[]) => {
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], k);
    quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], k.map((v) => v * 1.1));
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], k.map((v) => v * 0.8));
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], k.map((v) => v * 0.8));
  };
  const y = waterY;
  // the mud flat in front of the dyke, bare at low water (M6 tides: the river falls to LW_MIN)
  quad([X0, LW_MIN - 1.2, BANK_Z + 30], [X1, LW_MIN - 1.2, BANK_Z + 30], [X1, y - 1, BANK_Z], [X0, y - 1, BANK_Z], [0.3, 0.29, 0.26]);
  // the stone foot and the grassed dyke
  quad([X0, y - 1, BANK_Z], [X1, y - 1, BANK_Z], [X1, y + 1.2, BANK_Z - 3], [X0, y + 1.2, BANK_Z - 3], [0.34, 0.33, 0.3]);
  quad([X0, y + 1.2, BANK_Z - 3], [X1, y + 1.2, BANK_Z - 3], [X1, y + 5, BANK_Z - 12], [X0, y + 5, BANK_Z - 12], [0.3, 0.34, 0.24]);
  quad([X0, y + 5, BANK_Z - 12], [X1, y + 5, BANK_Z - 12], [X1, y + 5, BANK_Z - 16], [X0, y + 5, BANK_Z - 16], [0.36, 0.38, 0.28]);
  // the polder behind, a little lower, far back
  quad([X0, y + 3.5, BANK_Z - 16], [X1, y + 3.5, BANK_Z - 16], [X1, y + 3.5, BANK_Z - 260], [X0, y + 3.5, BANK_Z - 260], [0.32, 0.34, 0.26]);
  // rows of trees along the dyke: lumps of autumn crowns on trunks
  for (let x = X0 + 20; x < X1; x += 9 + r() * 14) {
    if (r() < 0.25) continue;
    const h = 7 + r() * 6;
    const w = 2.5 + r() * 2.5;
    const z = BANK_Z - 20 - r() * 20;
    const tone = [0.36 + r() * 0.1, 0.3 + r() * 0.08, 0.16 + r() * 0.05];
    box(x - 0.2, x + 0.2, z - 0.2, z + 0.2, y + 5, y + 5 + h * 0.4, [0.2, 0.17, 0.14]);
    box(x - w, x + w, z - w, z + w, y + 5 + h * 0.35, y + 5 + h, tone);
  }
  // the ferry landing: a cluster of inns and houses with steep roofs (the Vlaams Hoofd)
  for (let i = 0; i < 26; i++) {
    const x = -300 + r() * 180 + (i > 18 ? 250 + r() * 200 : 0);
    const z = BANK_Z - 18 - r() * 30;
    const w = 4 + r() * 5;
    const d = 6 + r() * 5;
    const h = 5 + r() * 5;
    const wall = r() < 0.5 ? [0.5, 0.33, 0.27] : [0.62, 0.6, 0.54];
    box(x - w / 2, x + w / 2, z - d / 2, z + d / 2, y + 5, y + 5 + h, wall);
    // a gable roof along x
    const top = y + 5 + h + w * 0.55;
    const roof = [0.3, 0.2, 0.17];
    quad([x - w / 2, y + 5 + h, z + d / 2], [x + w / 2, y + 5 + h, z + d / 2], [x + w / 2, top, z], [x - w / 2, top, z], roof);
    tri([x - w / 2, y + 5 + h, z + d / 2], [x - w / 2, top, z], [x - w / 2, y + 5 + h, z - d / 2], roof.map((v) => v * 0.8));
    tri([x + w / 2, y + 5 + h, z - d / 2], [x + w / 2, top, z], [x + w / 2, y + 5 + h, z + d / 2], roof.map((v) => v * 0.8));
  }
  // the earthworks of the fort (Tete de Flandre): long low grassed ramparts
  for (const [x, len] of [[80, 180], [300, 120]] as const) {
    box(x, x + len, BANK_Z - 60, BANK_Z - 48, y + 5, y + 11, [0.3, 0.35, 0.25]);
  }
  // a windmill on the dyke, sails set in a cross
  {
    const x = -520;
    const z = BANK_Z - 26;
    box(x - 2.5, x + 2.5, z - 2.5, z + 2.5, y + 5, y + 17, [0.55, 0.5, 0.42]);
    const hub = [x, y + 16, z + 2.8];
    for (const a of [0.3, 0.3 + Math.PI / 2, 0.3 + Math.PI, 0.3 + (3 * Math.PI) / 2]) {
      const ex = Math.cos(a) * 9;
      const ey = Math.sin(a) * 9;
      const px = -Math.sin(a) * 0.9;
      const py = Math.cos(a) * 0.9;
      quad(
        [hub[0], hub[1], hub[2]],
        [hub[0] + ex, hub[1] + ey, hub[2]],
        [hub[0] + ex + px, hub[1] + ey + py, hub[2]],
        [hub[0] + px, hub[1] + py, hub[2]],
        [0.8, 0.76, 0.66],
      );
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  // like the landmarks: a shape in the air from further off than the fog lets houses show
  const mat = psx(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { affine: 0, fogReach: 1.6 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  g.add(mesh);
  scene.add(g);
  return g;
}
