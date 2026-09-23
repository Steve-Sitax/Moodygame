import * as THREE from "three";
import { psx } from "../retro/psx";
import { makeHuman, type Human } from "../game/humans";
import type { Rect } from "./geom";
import { Kit, type RGB } from "./kit";

// The railway gate of the Werf store (M3g; Steve: "the goods train clips out of a building;
// make nice opening gates where it enters and leaves the city; the player must not get
// through"). The quay railway runs west into the Werf store (tools/city/design.py: the
// store at x -340..-318). A gatehouse of the State Railways stands against the store's east
// wall: brick, stone piers and lintel, a cornice, a painted board, a keeper's lodge beside
// the gate. Two big timber leaves on iron straps swing out when the train comes and shut
// behind the last wagon; the keeper rings his hand bell. Behind the leaves is a short covered
// way that ends in darkness: the train is never seen to appear or vanish.
//
// Belgium's town tolls (octrois) were abolished in 1860, so by 1873 no customs gate stood
// on the town's railway: this is a goods-shed door of the railway, not an octroi gate.
//
// The gatehouse is one solid collider, opening and all: nobody walks in, open or shut.
// The leaves do not move while the player stands in their sweep; open, they are solid too.

export interface RailGate {
  /** x of the facade (the leaves hang there), and the track's z. */
  readonly x: number;
  readonly z: number;
  /** How far the open leaves reach out from the facade (m). */
  readonly reach: number;
  /** 0 = shut, 1 = open. */
  amount(): number;
  /** The train asks for the gate (true) or is through (false). */
  want(open: boolean): void;
  update(dt: number, player: { x: number; z: number } | null, camera?: THREE.Camera): void;
  /** Static colliders: the gatehouse. Add them once. */
  colliders: Rect[];
  /** The keeper rings as the leaves start to open (soundscape.gateBell). */
  onBell?: (x: number, z: number) => void;
  group: THREE.Group;
}

export interface RailGateOptions {
  /** Brick, stone, slate and planks textures. */
  tex: { brick: THREE.Texture; stone: THREE.Texture; slate: THREE.Texture; planks: THREE.Texture };
  /** For the open leaves' colliders. */
  addCollider: (r: Rect) => void;
  removeCollider: (r: Rect) => void;
}

// the gatehouse on the store's east wall (x -318), round the track at z 4
const BACK = -318;
const FACE = -311;
const Z_S = 1.3; // south side (a bollard stands at z 0.5..1.2 on the quay edge)
const Z_N = 9.1; // north side (a gas lamp at (-310, 9.5))
const OPEN_S = 1.9;
const OPEN_N = 6.1;
const OPEN_H = 4.5;
const TOP = 6.3;
const LEAF_W = (OPEN_N - OPEN_S) / 2;
const LEAF_H = OPEN_H - 0.1;
const SWING = Math.PI * 0.53; // open: a little past square to the facade

const LEAF: RGB = [0.46, 0.5, 0.4]; // dark green paint on oak
const LEAF_DARK: RGB = [0.3, 0.33, 0.27];
const IRON: RGB = [0.16, 0.15, 0.14];

function leafGeometry(): THREE.BufferGeometry {
  // hinge on the local y axis at z 0; the leaf runs along +z, its outside toward +x
  const k = new Kit();
  const w = LEAF_W;
  const c = w / 2;
  for (let i = 0; i < 7; i++) k.box(0.1, LEAF_H, w / 7 - 0.01, 0, LEAF_H / 2, (i + 0.5) * (w / 7), i % 2 ? LEAF : LEAF_DARK);
  // frame and Z brace on the outside
  for (const y of [0.35, LEAF_H / 2, LEAF_H - 0.35]) k.box(0.06, 0.2, w - 0.1, 0.07, y, c, LEAF_DARK);
  const brace = Math.atan2(LEAF_H / 2 - 0.7, w - 0.3);
  k.box(0.05, 0.16, Math.hypot(LEAF_H / 2 - 0.7, w - 0.3), 0.09, LEAF_H * 0.25 + 0.17, c, LEAF_DARK, 0, -brace);
  k.box(0.05, 0.16, Math.hypot(LEAF_H / 2 - 0.7, w - 0.3), 0.09, LEAF_H * 0.75 - 0.17, c, LEAF_DARK, 0, -brace);
  // iron strap hinges and their pins
  for (const y of [0.55, LEAF_H / 2, LEAF_H - 0.55]) {
    k.box(0.03, 0.09, w * 0.7, 0.115, y, w * 0.35, IRON);
    k.cyl(0.05, 0.05, 0.22, 6, 0, y, 0, IRON);
  }
  // a wicket door's outline and a ring handle on the north leaf (drawn on both: nobody minds)
  k.box(0.03, 0.05, 0.9, 0.12, 2.0, w - 0.7, IRON);
  k.cyl(0.07, 0.07, 0.03, 8, 0.13, 1.3, w - 0.25, IRON, 0, 0, Math.PI / 2);
  return k.build();
}

function boardTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 32;
  const g = c.getContext("2d")!;
  g.fillStyle = "#2c3a30";
  g.fillRect(0, 0, 256, 32);
  g.strokeStyle = "#c8b47a";
  g.strokeRect(2.5, 2.5, 251, 27);
  g.fillStyle = "#e4d49c";
  g.font = "bold 17px Georgia, serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("STAATSSPOORWEGEN", 128, 17, 240);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createRailGate(scene: THREE.Scene, opts: RailGateOptions): RailGate {
  const group = new THREE.Group();
  group.name = "railway_gate";
  scene.add(group);
  const lam = (map: THREE.Texture, vc = true) => psx(new THREE.MeshLambertMaterial({ map, vertexColors: vc }));

  // --- brick: the side wall, the lodge, the mass over the opening
  const brick = new Kit();
  const d = FACE - BACK;
  const cx = (FACE + BACK) / 2;
  const W: RGB = [1, 1, 1];
  brick.box(d, TOP, OPEN_S - Z_S, cx, TOP / 2, (Z_S + OPEN_S) / 2, W);
  brick.box(d, TOP, Z_N - OPEN_N, cx, TOP / 2, (OPEN_N + Z_N) / 2, W);
  brick.box(d, TOP - OPEN_H, OPEN_N - OPEN_S, cx, (TOP + OPEN_H) / 2, (OPEN_S + OPEN_N) / 2, W);
  group.add(new THREE.Mesh(brick.build(), lam(opts.tex.brick)));

  // --- stone: plinth, piers, lintel with a keystone, cornice, the lodge's window and door frames
  const stone = new Kit();
  const S: RGB = [0.95, 0.93, 0.88];
  const F = FACE + 0.12;
  stone.box(0.3, 0.55, Z_N - Z_S + 0.3, FACE + 0.1, 0.27, (Z_S + Z_N) / 2, S);
  for (const z of [OPEN_S - 0.25, OPEN_N + 0.25]) stone.box(0.3, OPEN_H + 0.2, 0.5, F, (OPEN_H + 0.2) / 2, z, S);
  stone.box(0.34, 0.6, OPEN_N - OPEN_S + 1.0, F + 0.02, OPEN_H + 0.3, (OPEN_S + OPEN_N) / 2, S);
  stone.box(0.4, 0.75, 0.5, F + 0.05, OPEN_H + 0.35, (OPEN_S + OPEN_N) / 2, [1, 0.98, 0.94]);
  stone.box(0.45, 0.28, Z_N - Z_S + 0.5, FACE + 0.12, TOP - 0.05, (Z_S + Z_N) / 2, S);
  for (const z of [Z_S - 0.05, Z_N + 0.05]) stone.box(d + 0.3, 0.28, 0.2, cx + 0.1, TOP - 0.05, z, S);
  // the lodge: a window and a small door on the facade
  stone.box(0.16, 1.4, 1.1, F, 3.0, 7.6, S);
  stone.box(0.16, 2.3, 1.0, F, 1.15, 8.45, S);
  group.add(new THREE.Mesh(stone.build(), lam(opts.tex.stone)));

  // --- the roof: slate, a low hip behind the cornice
  const roof = new Kit();
  roof.box(d + 0.4, 0.14, Z_N - Z_S + 0.4, cx, TOP + 0.12, (Z_S + Z_N) / 2, [0.9, 0.9, 0.95]);
  roof.box(d - 1.2, 0.8, Z_N - Z_S - 1.6, cx - 0.4, TOP + 0.55, (Z_S + Z_N) / 2, [0.85, 0.85, 0.9]);
  group.add(new THREE.Mesh(roof.build(), lam(opts.tex.slate)));

  // --- dark: the covered way behind the leaves (its sides, its ceiling, the end in the dark),
  // the lodge's glass and door; a black that takes the fog like everything else
  const dark = new Kit();
  const BL: RGB = [1, 1, 1];
  const DEEP = BACK + 2; // the end of the light: nothing is seen beyond
  dark.box(FACE - DEEP, OPEN_H, 0.02, (FACE + DEEP) / 2, OPEN_H / 2, OPEN_S + 0.01, BL);
  dark.box(FACE - DEEP, OPEN_H, 0.02, (FACE + DEEP) / 2, OPEN_H / 2, OPEN_N - 0.01, BL);
  dark.box(FACE - DEEP, 0.02, OPEN_N - OPEN_S, (FACE + DEEP) / 2, OPEN_H - 0.01, (OPEN_S + OPEN_N) / 2, BL);
  dark.box(0.02, OPEN_H, OPEN_N - OPEN_S, DEEP, OPEN_H / 2, (OPEN_S + OPEN_N) / 2, BL);
  dark.box(0.04, 1.15, 0.85, F + 0.06, 3.0, 7.6, BL);
  dark.box(0.04, 2.1, 0.8, F + 0.06, 1.1, 8.45, [0.35, 0.3, 0.25]);
  const darkMat = psx(new THREE.MeshBasicMaterial({ color: 0x07080a, vertexColors: true }), { noSnap: true });
  group.add(new THREE.Mesh(dark.build(), darkMat));

  // --- iron: the keeper's bell on its bracket, the lamp bracket over the gate
  const iron = new Kit();
  iron.box(0.05, 0.05, 0.6, FACE + 0.35, 4.1, OPEN_N + 0.7, IRON);
  iron.lathe([[0, 0.3], [0.1, 0.28], [0.14, 0.12], [0.18, 0], [0, 0]], 8, FACE + 0.35, 3.8, OPEN_N + 0.95, [0.55, 0.45, 0.25]);
  iron.box(0.02, 1.4, 0.02, FACE + 0.35, 3.1, OPEN_N + 0.95, [0.5, 0.45, 0.35]); // the bell rope
  group.add(new THREE.Mesh(iron.build(), lam(opts.tex.planks)));

  // --- the board over the gate
  const board = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.45), psx(new THREE.MeshLambertMaterial({ map: boardTexture() })));
  board.position.set(FACE + 0.33, TOP - 0.62, (OPEN_S + OPEN_N) / 2);
  board.rotation.y = Math.PI / 2;
  group.add(board);

  // --- the leaves: one InstancedMesh for both
  const leaves = new THREE.InstancedMesh(leafGeometry(), lam(opts.tex.planks), 2);
  leaves.name = "railway_gate_leaves";
  group.add(leaves);
  const M = new THREE.Matrix4();
  const Q = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);
  const S1 = new THREE.Vector3(1, 1, 1);
  const P = new THREE.Vector3();
  const place = (amount: number) => {
    const a = SWING * amount;
    // south leaf: hinge at OPEN_S, runs +z when shut, swings out to +x
    Q.setFromAxisAngle(Y, a);
    M.compose(P.set(FACE + 0.08, 0.05, OPEN_S), Q, S1);
    leaves.setMatrixAt(0, M);
    // north leaf: hinge at OPEN_N, runs -z when shut (turned half round), swings out to +x
    Q.setFromAxisAngle(Y, Math.PI - a);
    M.compose(P.set(FACE + 0.08, 0.05, OPEN_N), Q, S1);
    leaves.setMatrixAt(1, M);
    leaves.instanceMatrix.needsUpdate = true;
  };
  place(0);

  // --- the keeper at his lodge door
  let keeper: Human | null = null;
  const keeperG = new THREE.Group();
  keeperG.position.set(FACE + 1.3, 0, 8.0);
  keeperG.rotation.y = -2.2; // toward the gate
  group.add(keeperG);

  // --- colliders: the whole gatehouse (opening and all); the leaves while they stand open
  const house: Rect = { minX: BACK - 0.5, maxX: FACE + 0.3, minZ: Z_S, maxZ: Z_N };
  const reach = LEAF_W + 0.1;
  const leafRects: Rect[] = [
    { minX: FACE, maxX: FACE + reach, minZ: OPEN_S - 0.15, maxZ: OPEN_S + 0.15 },
    { minX: FACE, maxX: FACE + reach, minZ: OPEN_N - 0.15, maxZ: OPEN_N + 0.15 },
  ];
  let leafOn = false;
  /** Where the leaves sweep: nobody may stand there while they move. */
  const sweep = { minX: FACE, maxX: FACE + reach + 0.4, minZ: OPEN_S - 0.4, maxZ: OPEN_N + 0.4 };

  let amount = 0;
  let wantOpen = false;
  const api: RailGate = {
    x: FACE,
    z: 4,
    reach,
    amount: () => amount,
    want(open) {
      wantOpen = open;
    },
    update(dt, player, camera) {
      const target = wantOpen ? 1 : 0;
      const inSweep = !!player && player.x > sweep.minX - 0.3 && player.x < sweep.maxX && player.z > sweep.minZ && player.z < sweep.maxZ;
      if (target !== amount && !inSweep) {
        if (amount === 0 && target === 1) api.onBell?.(FACE + 0.35, OPEN_N + 0.95);
        // heavy leaves: slow at both ends, as when a man walks them round
        const ease = 0.3 + 0.7 * Math.sin(Math.PI * THREE.MathUtils.clamp(amount, 0.05, 0.95));
        const step = 0.22 * ease * Math.min(dt, 0.1);
        amount = target > amount ? Math.min(1, amount + step) : Math.max(0, amount - step);
        place(amount);
      }
      const on = amount > 0.4;
      if (on !== leafOn) {
        for (const r of leafRects) (on ? opts.addCollider : opts.removeCollider)(r);
        leafOn = on;
      }
      if (!keeper) {
        keeper = makeHuman("porter");
        if (keeper) {
          keeperG.add(keeper.root);
          keeper.play("behind", 0);
        }
      }
      const far = ((scene.fog as THREE.Fog | null)?.far ?? 40) + 30;
      const near = !camera || Math.hypot(camera.position.x - FACE, camera.position.z - 4) < far;
      group.visible = near;
      if (near) keeper?.update(Math.min(dt, 0.1));
    },
    colliders: [house],
    group,
  };
  return api;
}
