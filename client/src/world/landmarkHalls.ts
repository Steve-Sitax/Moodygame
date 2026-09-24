import * as THREE from "three";
import { canvasTex, flicker, frameRoom, rand, tex, type Seat } from "./rooms";
import { signTexture } from "./textures";
import { createFires } from "./fire";
import {
  ashlar,
  billTex,
  Flames,
  goldLeather,
  Kit,
  Levels,
  lightShaft,
  lmBasic,
  lmMat,
  matOf,
  shaftMaterial,
  slabs,
  spines,
  stairSteps,
  whitewash,
  type Rect,
  type Stair,
} from "./landmarkKit";
import { freeFn, glassMat, M, paintMat, walkGraph, type LandmarkRoom, type Lookable, type Mark } from "./landmarkRooms";

// The town hall, the Vleeshuis, the Steen and the Oostershuis (M6 landmark interiors), built in
// code like the cathedral (world/landmarkRooms.ts). Research and sources in
// docs/milestones/M6-landmark-interiors.md. Each hall's frame: its main door at the origin,
// x across, z into the building; storeys over each other are walked with Levels (landmarkKit).

const H = {
  plaster: lmMat("lm_plaster", { map: whitewash(21, [196, 186, 162]), color: 0xd0c4a8 }, 0.1),
  panel: lmMat("lm_panel", { map: tex().planks, color: 0x9a6a44 }, 0.15),
  boards: lmMat("lm_boards", { map: tex().planks, color: 0xd0a878 }, 0.1),
  brick: lmMat("lm_brick", { map: tex().brick, color: 0xe0b098 }, 0.1),
  vaultBrick: lmMat("lm_vault_brick", { map: tex().brick, color: 0xe0b098, side: THREE.DoubleSide }, 0.1),
  vaultStone: lmMat("lm_vault_stone", { map: ashlar(31, [110, 110, 116]), color: 0xb8b8c0, side: THREE.DoubleSide }, 0.1),
  stoneGrey: lmMat("lm_stone_grey", { map: ashlar(31, [110, 110, 116]), color: 0xa8a8b0 }, 0.1),
  leather: lmMat("lm_leather", { map: goldLeather(), color: 0xc0a070 }, 0.1),
  green: lmMat("lm_green", { color: 0x2a4a2a }),
  books: lmMat("lm_books", { map: spines(), color: 0xc0b8a8 }, 0),
  paper: lmMat("lm_paper", { color: 0xe0d8c0 }),
  sack: lmMat("lm_sack", { map: tex().sack, color: 0xf0d8b0 }, 0.2),
  bale: lmMat("lm_bale", { map: tex().sack, color: 0xffffff }, 0.2),
  crate: lmMat("lm_crate", { map: tex().crate, color: 0xb09070 }, 0.2),
  rope: lmMat("lm_rope", { map: tex().rope, color: 0xb0a080 }, 0.2),
  timber: lmMat("lm_timber", { map: tex().planks, color: 0xb08860 }, 0.15),
  cloth: lmMat("lm_curtain", { color: 0x6a1814 }),
  backdrop: lmMat("lm_backdrop", { map: canvasTex(64, 32, (g) => {
    const sky = g.createLinearGradient(0, 0, 0, 20);
    sky.addColorStop(0, "#3a4a6a");
    sky.addColorStop(1, "#8a8a7a");
    g.fillStyle = sky;
    g.fillRect(0, 0, 64, 32);
    g.fillStyle = "#4a4038";
    // a painted castle and town, the stock scene of a Flemish history drama
    g.fillRect(6, 10, 14, 16);
    g.fillRect(8, 6, 4, 6);
    g.fillRect(16, 7, 4, 5);
    for (let x = 22; x < 64; x += 7) g.fillRect(x, 16 + ((x * 3) % 5), 6, 14);
    g.fillStyle = "#2a3a2a";
    g.fillRect(0, 26, 64, 6);
  }, false), color: 0xa89878 }, 0),
  glassCase: { key: "lm_glasscase", make: () => new THREE.MeshLambertMaterial({ color: 0xb8c8d0, transparent: true, opacity: 0.22, depthWrite: false, vertexColors: true }) },
  bronze: lmMat("lm_bronze", { color: 0x5a4a2a, emissive: 0x100a02 }),
  pot: lmMat("lm_pot", { color: 0x8a5a3a }),
  alabaster: lmMat("lm_alabaster", { color: 0xe8e0d0, emissive: 0x141210 }),
  steel: lmMat("lm_steel", { color: 0x8a8e94, emissive: 0x0a0a0c }),
  straw: lmMat("lm_straw", { map: tex().sack, color: 0xc8b070 }, 0.2),
};
const billMats = [0, 1, 2, 3].map((i) => lmMat(`lm_bill${i}`, { map: billTex(i), color: 0xd8d0c0 }, 0));
const sign = (text: string, key: string) => lmBasic(key, { map: signTexture(text), color: 0xb8ab8a });

function lights(scene: THREE.Scene, sky: number, ground: number, amb: number): { hemi: THREE.HemisphereLight; amb: THREE.AmbientLight } {
  const hemi = new THREE.HemisphereLight(sky, ground, 1.1);
  const a = new THREE.AmbientLight(amb, 0.9);
  scene.add(hemi, a);
  return { hemi, amb: a };
}

function point(group: THREE.Group, color: number, x: number, y: number, z: number, dist: number): THREE.PointLight {
  const l = new THREE.PointLight(color, 0, dist, 1.5);
  l.position.set(x, y, z);
  group.add(l);
  return l;
}

/** A chair of the grand rooms (leather seat, carved back), facing yaw. */
function chair(k: Kit, x: number, y: number, z: number, yaw: number, big = false): void {
  const s = big ? 1.25 : 1;
  const bx = -Math.sin(yaw) * 0.22;
  const bz = -Math.cos(yaw) * 0.22;
  k.box(0.46 * s, 0.07, 0.44, x, y + 0.46, z, H.leather, { ry: yaw });
  k.box(0.44 * s, 0.44, 0.4, x, y + 0.22, z, H.panel, { ry: yaw });
  k.box(0.46 * s, (big ? 0.9 : 0.6) , 0.05, x + bx, y + 0.5 + (big ? 0.45 : 0.3), z + bz, H.panel, { ry: yaw });
}

/** A desk with a ledger open and an inkstand. */
function desk(k: Kit, x: number, y: number, z: number, w = 1.4, yaw = 0): void {
  k.box(w, 0.06, 0.8, x, y + 0.78, z, H.panel, { ry: yaw });
  k.box(w, 0.74, 0.7, x, y + 0.37, z, H.panel, { ry: yaw, solid: true });
  k.box(0.5, 0.03, 0.36, x, y + 0.83, z, H.paper, { ry: yaw });
  k.box(0.08, 0.08, 0.08, x + w * 0.35, y + 0.85, z, M.black, { ry: yaw });
}

function looksAdd(list: Lookable[], id: string, x: number, z: number, r: number, label: string, text: string): void {
  list.push({ id, x, z, r, label, text });
}

// ================================================================ the town hall

/**
 * The Stadhuis (Cornelis Floris, 1561-65), as its offices were in 1873: the porter's lodge in
 * the entrance, the old inner courtyard roofed with glass and made into the great staircase hall
 * (Bourla's work, earlier in the century), the civil registry's counter and the clerks' office
 * with their ledgers, and upstairs the wedding hall (the Floris chimneypiece with its two
 * alabaster caryatids), the aldermen's room and the Leys hall (Hendrik Leys's history paintings,
 * inaugurated in 1870). A notice board by the door shows the bills pasted up in the town.
 */
export function buildTownhall(opts: { origin: { x: number; z: number }; yaw: number }): LandmarkRoom {
  const { scene, group, toWorld } = frameRoom(opts.origin, opts.yaw, 0x2e2a22);
  const fog = scene.fog as THREE.Fog;
  fog.near = 16;
  fog.far = 75;
  const k = new Kit(group);
  k.shadeTop = 12;
  const UP = 5.4;
  const floorM = lmMat("lm_th_floor", { map: slabs(7), color: 0xd0ccc4 }, 0.1);

  // ground: the vestibule, the staircase hall, the clerks' office
  k.box(10, 0.1, 8, 0, -0.05, 4, floorM, { tile: 1.6, flat: true });
  k.box(16, 0.1, 14, 0, -0.05, 15, floorM, { tile: 1.6, flat: true });
  k.box(12, 0.1, 14, 14, -0.05, 15, H.boards, { tile: 1.4, flat: true });
  const wall = (w: number, h: number, d: number, x: number, y: number, z: number, m = H.plaster) => k.box(w, h, d, x, y + h / 2, z, m, { tile: 2 });
  // vestibule
  wall(0.4, 6, 8, -5.2, 0, 4);
  wall(0.4, 6, 8, 5.2, 0, 4);
  wall(4, 6, 0.4, -3.2, 0, -0.2);
  wall(4, 6, 0.4, 3.2, 0, -0.2);
  wall(2.4, 2.2, 0.4, 0, 3.8, -0.2);
  k.box(2.4, 3.8, 0.1, 0, 1.9, -0.05, M.oakDark, { tile: 1 });
  k.box(10.4, 0.3, 8, 0, 6.15, 4, H.panel, { tile: 1.2 });
  // the porter's lodge: a glazed booth on the left
  k.box(2.6, 1.1, 0.1, -3.7, 0.55, 5, H.panel, { tile: 0.8 });
  k.box(0.1, 1.1, 4, -2.4, 0.55, 3, H.panel, { tile: 0.8 });
  k.box(0.08, 1.4, 4, -2.4, 1.8, 3, H.glassCase);
  k.box(2.6, 0.1, 4.2, -3.7, 2.55, 3, H.panel);
  k.solids.push({ minX: -5, maxX: -2.35, minZ: 0.9, maxZ: 5.1 });
  desk(k, -4.3, 0, 3, 1.0, Math.PI / 2);
  // the notice board on the right wall, bills pasted on it
  k.box(0.08, 1.6, 2.6, 4.95, 1.9, 4, H.panel);
  for (let i = 0; i < 6; i++) k.plane(0.55, 0.8, 4.9, 1.45 + (i % 2) * 0.85, 3.05 + Math.floor(i / 2) * 0.9, billMats[i % 4], { ry: -Math.PI / 2 });
  // the staircase hall: the old courtyard under a glass roof, Floris's arcades round it
  wall(0.5, 16, 14, -8.25, 0, 15, M.stone);
  wall(3, 16, 0.5, -6.5, 0, 7.75, M.stone);
  wall(3, 16, 0.5, 6.5, 0, 7.75, M.stone);
  wall(10, 10, 0.5, 0, 6, 7.75, M.stone);
  // the right wall: an opening into the clerks' office below, the gallery above
  wall(0.5, 5, 4, 8.25, 0, 10, M.stone);
  wall(0.5, 5, 4.5, 8.25, 0, 19.75, M.stone);
  wall(0.5, 11, 14, 8.25, 5, 15, M.stone);
  k.solids.push({ minX: 8, maxX: 8.5, minZ: 8, maxZ: 12 }, { minX: 8, maxX: 8.5, minZ: 17.5, maxZ: 22 });
  // arcade shafts and string courses round the court
  for (const x of [-7.7, 7.7]) for (let z = 9; z < 22; z += 3.2) k.cyl(0.18, 0.2, 5.3, x, 0, z, M.stoneDark, { seg: 6 });
  for (const y of [5.3, 10.6]) {
    k.box(16, 0.3, 0.5, 0, y, 8.1, M.stoneDark);
    for (const s of [-1, 1]) k.box(0.5, 0.3, 14, s * 7.9, y, 15, M.stoneDark);
  }
  // the glass roof
  const sky = glassMat("grisaille", 41);
  for (let x = -6; x <= 6; x += 3) k.plane(2.9, 13.6, x, 16, 15, sky.def, { rx: Math.PI / 2 });
  for (let x = -7.5; x <= 7.5; x += 3) k.box(0.12, 0.2, 14, x, 15.95, 15, M.iron);
  // the grand staircase: white stone steps, balustrades; up to the landing and the gallery
  const stair: Stair = { rect: { minX: -2, maxX: 2, minZ: 12, maxZ: 21.6 }, along: "z", foot: 12, head: 21.6, lo: 0, hi: 1, y0: 0, y1: UP, rise: 0.18 };
  stairSteps(k, stair, M.marbleW, M.marbleB);
  for (const x of [-2, 2]) k.cyl(0.14, 0.18, 1.1, x, 0, 11.9, M.marbleB, { seg: 6 });
  // under the landing: the wall on the ground, the landing's slab and balustrade above
  wall(6, UP, 0.4, -5, 0, 21.8, M.stone);
  wall(6, UP, 0.4, 5, 0, 21.8, M.stone);
  k.solids.push({ minX: -8, maxX: -2, minZ: 21.4, maxZ: 22.2 }, { minX: 2, maxX: 8, minZ: 21.4, maxZ: 22.2 });
  k.box(16, 0.3, 4.6, 0, UP - 0.15, 24, M.marbleW, { tile: 1.2 });
  for (const s of [-1, 1]) k.box(5.8, 1.0, 0.18, s * 5.1, UP + 0.5, 21.75, M.marbleW);
  for (let x = -7.8; x <= 7.8; x += 0.45) if (Math.abs(x) > 2.1) k.cyl(0.05, 0.07, 0.9, x, UP, 21.75, M.marbleW, { seg: 4 });
  // the clerks' office: the civil registry's counter, desks, shelves of registers
  k.box(12, 0.3, 14, 14, 5.15, 15, H.panel, { tile: 1.2 });
  wall(0.4, 5, 14, 20.2, 0, 15);
  wall(12, 5, 0.4, 14, 0, 7.8);
  wall(12, 5, 0.4, 14, 0, 22.2);
  k.box(0.6, 1.05, 14, 12.8, 0.52, 15, H.panel, { tile: 1, solid: true });
  k.box(0.8, 0.06, 14, 12.8, 1.07, 15, M.oakDark);
  k.box(0.3, 0.05, 0.4, 12.7, 1.12, 16, H.paper);
  for (const [x, z] of [[15.5, 10.5], [15.5, 14.5], [15.5, 18.5], [18.2, 10.5], [18.2, 14.5]] as Array<[number, number]>) {
    desk(k, x, 0, z, 1.3);
    chair(k, x, 0, z - 0.75, 0);
  }
  for (let z = 9; z < 21; z += 2.2) k.box(0.4, 2.6, 2.0, 19.8, 1.3, z, H.books, { tile: 1 });
  k.box(3.2, 0.45, 0.5, 10, 0.25, 21.6, H.panel, { solid: true }); // the bench for callers
  const bench: Mark[] = [9.0, 10.0, 11.0].map((x) => ({ x, z: 21.45, yaw: Math.PI }));

  const groundSolids = [...k.solids];
  // upstairs: the gallery, the wedding hall, the aldermen's room, the Leys hall
  k.box(16, 0.3, 14, 0, UP - 0.15, 33, H.boards, { tile: 1.2, flat: true });
  k.box(10, 0.3, 12.5, -13, UP - 0.15, 27.75, H.boards, { tile: 1.2, flat: true });
  k.box(10, 0.3, 10.5, 13, UP - 0.15, 26.75, H.boards, { tile: 1.2, flat: true });
  // the wedding hall's walls: gilded leather over oak panelling, the doorway from the landing
  const up = (w: number, h: number, d: number, x: number, z: number, m = H.leather) => k.box(w, h, d, x, UP + h / 2, z, m, { tile: 1.2 });
  up(6.5, 5.6, 0.3, -4.75, 26);
  up(6.5, 5.6, 0.3, 4.75, 26);
  up(3, 2.2, 0.3, 0, 26, H.plaster);
  up(16, 5.6, 0.3, 0, 40.1);
  up(0.3, 5.6, 14, -8.1, 33);
  up(0.3, 5.6, 14, 8.1, 33);
  k.box(16, 0.3, 14, 0, UP + 5.75, 33, H.panel, { tile: 1.2 });
  for (let z = 27.5; z < 40; z += 2.5) k.box(16, 0.35, 0.3, 0, UP + 5.4, z, M.oakDark);
  for (const s of [-1, 1]) k.box(0.1, 1.2, 14, s * 7.92, UP + 0.6, 33, H.panel, { tile: 1 });
  // the Floris chimneypiece on the east wall: two alabaster caryatids carry the mantel; a fire burns
  const FX = 7.6;
  const FZ = 33;
  k.box(0.9, 1.4, 2.6, FX, UP + 0.7, FZ, M.black, { solid: true });
  for (const w of [-1.15, 1.15]) {
    k.cyl(0.16, 0.2, 1.3, FX - 0.35, UP, FZ + w, H.alabaster, { seg: 6 });
    k.cyl(0.13, 0.13, 0.25, FX - 0.35, UP + 1.3, FZ + w, H.alabaster, { seg: 6 });
  }
  k.box(1.0, 0.35, 3.2, FX - 0.1, UP + 1.75, FZ, M.marbleB);
  k.box(0.4, 2.2, 2.6, FX + 0.1, UP + 3.0, FZ, M.marbleW);
  k.plane(1.9, 1.6, FX - 0.11, UP + 3.0, FZ, paintMat("history", 3), { ry: -Math.PI / 2 });
  const fireW = toWorld(FX - 0.3, FZ, UP + 0.1);
  const fires = createFires(scene, [{ x: fireW.x, y: fireW.y, z: fireW.z, size: 0.5 }]);
  // windows on the west wall, portraits, the table with its green cloth, chairs
  const win = glassMat("grisaille", 42);
  for (const z of [29, 33, 37]) k.plane(1.6, 3.2, -7.93, UP + 2.4, z, win.def, { ry: Math.PI / 2 });
  for (const z of [29, 37]) {
    k.box(0.08, 1.8, 1.4, 7.93, UP + 3.0, z, M.gilt);
    k.plane(1.2, 1.6, 7.88, UP + 3.0, z, paintMat("portrait", z), { ry: -Math.PI / 2 });
  }
  k.box(4.4, 0.8, 1.4, 0, UP + 0.4, 39.3 - 0.9, H.green, { solid: true });
  k.box(4.5, 0.05, 1.5, 0, UP + 0.82, 38.4, H.green);
  k.box(0.6, 0.03, 0.42, 1.4, UP + 0.86, 38.4, H.paper);
  k.box(0.9, 0.08, 0.6, 1.4, UP + 0.92, 38.5, M.oakDark); // the register
  chair(k, 0, UP, 39.4, Math.PI, true);
  chair(k, 2.6, UP, 39.4, Math.PI);
  for (const x of [-2.6, -0.55, 0.55, 2.6]) chair(k, x, UP, 36.9, 0);
  const wChairs: Mark[] = [];
  for (const z of [34.0, 32.7, 31.4])
    for (const x of [-2.8, -2.0, -1.2, 1.2, 2.0, 2.8]) {
      chair(k, x, UP, z, 0);
      wChairs.push({ x, z: z + 0.02, yaw: 0, y: UP });
    }
  // a crown of candles
  k.cyl(0.02, 0.02, 2.4, 0, UP + 3.2, 33, M.iron, { seg: 3 });
  k.cyl(0.8, 0.8, 0.07, 0, UP + 3.1, 33, M.brass, { seg: 10, open: true });
  // the Leys hall: history paintings round the walls (1870), a long table
  up(0.3, 5.6, 12.5, -18.1, 27.75, H.plaster);
  up(10, 5.6, 0.3, -13, 34.1, H.plaster);
  up(10, 5.6, 0.3, -13, 21.4, H.plaster);
  k.box(10, 0.3, 12.5, -13, UP + 5.75, 27.75, H.panel);
  for (const [x, z, ry] of [[-17.93, 25, Math.PI / 2], [-17.93, 30.5, Math.PI / 2], [-13, 33.93, Math.PI], [-10, 33.93, Math.PI]] as Array<[number, number, number]>) {
    k.plane(ry === Math.PI ? 2.6 : 4.4, 3.0, x, UP + 2.6, z, paintMat("history", Math.round(x * 3 + z)), { ry });
  }
  k.box(1.2, 0.8, 5, -13, UP + 0.4, 28, M.oakDark, { solid: true });
  // the aldermen's room: a desk, a portrait of the King, shelves
  up(0.3, 5.6, 10.5, 18.1, 26.75, H.plaster);
  up(10, 5.6, 0.3, 13, 32.1, H.plaster);
  up(10, 5.6, 0.3, 13, 21.4, H.plaster);
  k.box(10, 0.3, 10.5, 13, UP + 5.75, 26.75, H.panel);
  desk(k, 13, UP, 28.3, 1.8);
  chair(k, 13, UP, 29.1, Math.PI, true);
  k.box(0.08, 1.8, 1.4, 17.93, UP + 2.8, 27, M.gilt);
  k.plane(1.2, 1.6, 17.88, UP + 2.8, 27, paintMat("portrait", 99), { ry: -Math.PI / 2 });
  for (let z = 23; z < 31; z += 2.2) k.box(0.4, 2.4, 2.0, 17.7, UP + 1.2, z, H.books);
  // doorway walls between the gallery and the side rooms (gaps at z 22.4..25.6)
  for (const s of [-1, 1]) {
    k.box(0.3, 5.6, 1.1, s * 8.1, UP + 2.8, 21.95, s < 0 ? H.plaster : H.plaster);
    k.box(0.3, 2.0, 3.2, s * 8.1, UP + 4.6, 24, H.plaster);
  }

  k.finish();

  // light: the day from the glass roof and the windows; lamps and candles at dusk
  const L = lights(scene, 0xd8d8e0, 0x3a3228, 0x4a4034);
  const lampHall = point(group, 0xffb070, 0, 4, 15, 22);
  const lampUp = point(group, 0xffb070, 0, UP + 2.8, 33, 14);
  const lampOffice = point(group, 0xffb070, 15, 3, 14, 12);
  const fireL = point(group, 0xff8a40, FX - 0.8, UP + 0.6, FZ, 8);
  const candles = new Flames(group, 12, 0.15);
  for (let i = 0; i < 10; i++) candles.addFlame(Math.cos((i / 10) * Math.PI * 2) * 0.8, UP + 3.25, 33 + Math.sin((i / 10) * Math.PI * 2) * 0.8);
  const shaftMat = shaftMaterial();
  lightShaft(group, new THREE.Vector3(-2, 15.8, 13), new THREE.Vector3(1, 0, 17), 3, shaftMat);
  lightShaft(group, new THREE.Vector3(3, 15.8, 18), new THREE.Vector3(4.5, 0, 20.5), 2.2, shaftMat);

  // walking: two storeys and the stair
  const lv = new Levels(
    [
      {
        y: 0,
        floors: [
          { minX: -5, maxX: 5, minZ: 0.3, maxZ: 8.4 },
          { minX: -8, maxX: 8, minZ: 8, maxZ: 22 },
          { minX: 8, maxX: 20, minZ: 12, maxZ: 17.5 },
          { minX: 8.4, maxX: 20, minZ: 8, maxZ: 22 },
        ],
        solids: [...groundSolids, { minX: -2.2, maxX: 2.2, minZ: 12, maxZ: 21.6 }],
      },
      {
        y: UP,
        floors: [
          { minX: -8, maxX: 8, minZ: 21.6, maxZ: 26.4 },
          { minX: -1.4, maxX: 1.4, minZ: 25, maxZ: 27 },
          { minX: -7.9, maxX: 7.9, minZ: 26.2, maxZ: 39.9 },
          { minX: -18, maxX: -8, minZ: 21.6, maxZ: 34 },
          { minX: -9, maxX: -7, minZ: 22.5, maxZ: 25.5 },
          { minX: 8, maxX: 18, minZ: 21.6, maxZ: 32 },
          { minX: 7, maxX: 9, minZ: 22.5, maxZ: 25.5 },
        ],
        solids: [
          { minX: -8, maxX: -1.5, minZ: 25.8, maxZ: 26.2 },
          { minX: 1.5, maxX: 8, minZ: 25.8, maxZ: 26.2 },
          { minX: -2.3, maxX: 2.3, minZ: 37.6, maxZ: 40 },
          { minX: FX - 0.5, maxX: 8.2, minZ: FZ - 1.4, maxZ: FZ + 1.4 },
          { minX: -13.7, maxX: -12.3, minZ: 25.4, maxZ: 30.6 },
          { minX: 12, maxX: 14, minZ: 27.8, maxZ: 28.9 },
          { minX: -8.3, maxX: -7.9, minZ: 25.6, maxZ: 34 },
          { minX: 7.9, maxX: 8.3, minZ: 25.6, maxZ: 32 },
        ],
      },
    ],
    [stair],
  );
  const free = freeFn(lv.levels[0].floors, lv.levels[0].solids);
  const path = walkGraph(
    [[0, 1.5], [0, 6], [-4, 9.5], [4, 9.5], [5, 14], [6.5, 16], [10, 14.5], [10, 19.5], [11.5, 11], [-5, 16], [-5, 20.5], [5, 20.5]],
    free,
  );
  const marks: Record<string, Mark> = {
    lodge: { x: -3.7, z: 3.0, yaw: Math.PI / 2 },
    registrar: { x: 13.6, z: 14, yaw: -Math.PI / 2 },
    counter: { x: 11.9, z: 14, yaw: Math.PI / 2 },
    alderman: { x: 13, z: 29.1, yaw: Math.PI, y: UP },
    weddingTable: { x: 0, z: 39.3, yaw: Math.PI, y: UP },
    weddingClerk: { x: 2.6, z: 39.3, yaw: Math.PI, y: UP },
    cGroom: { x: 0.55, z: 36.4, yaw: 0, y: UP },
    cBride: { x: -0.55, z: 36.4, yaw: 0, y: UP },
    board: { x: 4.2, z: 4, yaw: Math.PI / 2 },
  };
  const deskMarks: Mark[] = [[15.5, 10.5], [15.5, 14.5], [15.5, 18.5], [18.2, 10.5], [18.2, 14.5]].map(([x, z]) => ({ x, z: z - 0.75, yaw: 0 }));
  const sets: Record<string, Mark[]> = {
    desks: deskMarks,
    bench,
    witnesses: [
      { x: -2.6, z: 36.4, yaw: 0, y: UP },
      { x: 2.6, z: 36.4, yaw: 0, y: UP },
    ],
    weddingChairs: wChairs,
  };
  const looks: Lookable[] = [];
  looksAdd(looks, "board", 4.2, 4, 1.5, "read the notice board", "The notice board by the door: a proclamation of the College of Burgomaster and Aldermen about dogs without muzzles, and the militia lists. Nothing new pasted up today.");
  looksAdd(looks, "register", 11.9, 16.2, 1.4, "look at the register on the counter", "The register of the civil state lies open on the counter: births, deaths and marriages in a clerk's copperplate. Nothing written in it yet today.");
  looksAdd(looks, "stair", 0, 10.8, 1.6, "look up the staircase", "The old courtyard of the town hall, roofed over with glass, and a great stair of white stone going up to the fine floor. Floris's arcades look down on it.");
  looksAdd(looks, "chimney", FX - 1.4, FZ, 1.8, "look at the chimneypiece", "The chimneypiece of the wedding hall: two women carved in alabaster carry the mantel on their heads, three hundred years old and scorched by the fire of the Spanish Fury. A fire burns under them.");
  looksAdd(looks, "leys", -13, 32.5, 2.5, "look at the paintings", "The Leys hall: Hendrik Leys painted the town's old privileges and its burghers on these walls, finished only three years ago. Dark, stiff, splendid figures in black and red.");
  // Jef may sit on the callers' bench and in the wedding hall
  const seats: Seat[] = [
    ...bench.map((b, i) => ({ x: b.x, z: b.z, yaw: Math.PI, table: 30 + i, h: 0.45, via: [] })),
    ...wChairs.filter((c) => Math.abs(c.x) === 2.8).map((c, i) => ({ x: c.x, z: c.z, yaw: 0, table: 40 + i, h: 0.46, via: [] })),
  ];
  let day = 1;
  const glasses = [sky, win];
  const room: LandmarkRoom = {
    kind: "landmark",
    landmark: "townhall",
    scene,
    group,
    walk: lv.walk,
    floor: lv.floor,
    seats,
    stands: [],
    exit: { x: 0, z: 0.9, yaw: Math.PI },
    entry: { x: 0, z: 1.4, yaw: 0 },
    entries: { main: { x: 0, z: 1.4, yaw: 0 } },
    exits: { main: { x: 0, z: 0.9, yaw: Math.PI } },
    lamps: [],
    toWorld,
    pace: 1.3,
    eye: 1.62,
    surface: "stone",
    sound: "hall",
    marks,
    sets,
    looks,
    path,
    setDaylight(kd) {
      day = kd;
      L.hemi.intensity = 1.8 + 1.8 * kd;
      L.amb.intensity = 0.8 + 0.3 * kd;
      for (const g of glasses) g.mat().color.setScalar(0.15 + 0.9 * kd);
      shaftMat.opacity = Math.max(0, kd - 0.3) * 0.22;
      candles.showFirst(kd < 0.4 ? 12 : 0);
    },
    update(t) {
      fires.update(t);
      candles.update(t);
      const f = flicker(t, 3.1);
      const dusk = day < 0.4 ? 1 : 0.25;
      lampHall.intensity = 5 * dusk * f;
      lampUp.intensity = 4 * dusk * f;
      lampOffice.intensity = 4 * dusk * flicker(t, 1.3);
      fireL.intensity = 6 * flicker(t * 1.6, 9);
      room.lamps = [{ p: fireW, w: 0.35 * f }];
    },
  };
  room.levels = lv;
  room.update(0, 0);
  room.setDaylight(1);
  return room;
}

// ================================================================ the Vleeshuis

/**
 * The Vleeshuis in 1873: not the butchers' hall any more but the wine merchant Peyrot's
 * warehouse (he bought it in 1841). The ground floor's three aisles under brick vaults on stone
 * columns, full of barrels in racks and rows; cellarmen roll them along the floor; the cellar
 * master's desk by the door. Upstairs, over the vaults: the theatre hall that the society
 * Liefde en Eendragt used (a small stage with a painted backcloth, curtains, footlights, benches)
 * and a painter's studio with easels under a tall window (painters rented studios there).
 */
export function buildVleeshuis(opts: { origin: { x: number; z: number }; yaw: number }): LandmarkRoom {
  const { scene, group, toWorld } = frameRoom(opts.origin, opts.yaw, 0x241a12);
  const fog = scene.fog as THREE.Fog;
  fog.near = 12;
  fog.far = 55;
  const k = new Kit(group);
  k.shadeTop = 7;
  const X0 = -14;
  const X1 = 20;
  const D = 18.2;
  const UP = 6.2;
  const r = rand(77);
  // ground: floor, walls (brick and white sandstone bands, as outside), three aisles of vaults on columns
  k.box(X1 - X0, 0.1, D, (X0 + X1) / 2, -0.05, D / 2, lmMat("lm_vh_floor", { map: slabs(8), color: 0xd8d0c4 }, 0.1), { tile: 1.8, flat: true });
  // inside the walls are brick below and whitewashed above the vaults; doors in the south and the north walls
  const vw = (w: number, d: number, x: number, z: number, y0 = 0, h = UP + 5.5) => {
    const lo = Math.max(0, Math.min(h, UP - y0));
    if (lo > 0) k.box(w, lo, d, x, y0 + lo / 2, z, H.brick, { tile: 1.2 });
    if (h - lo > 0) k.box(w, h - lo, d, x, y0 + lo + (h - lo) / 2, z, H.plaster, { tile: 2 });
  };
  vw(0.6, D, X0 - 0.3, D / 2);
  vw(0.6, D, X1 + 0.3, D / 2);
  vw(5.3 - X0, 0.6, (X0 + 5.3) / 2, D + 0.3);
  vw(X1 - 7.3, 0.6, (X1 + 7.3) / 2, D + 0.3);
  vw(2, 0.6, 6.3, D + 0.3, 3, UP + 2.5);
  k.box(2, 3, 0.1, 6.3, 1.5, D + 0.02, M.oakDark);
  vw(-1.3 - X0, 0.6, (X0 - 1.3) / 2, -0.3);
  vw(X1 - 1.3, 0.6, (X1 + 1.3) / 2, -0.3);
  vw(2.6, 0.6, 0, -0.3, 3.2, UP + 2.3);
  k.box(2.6, 3.2, 0.1, 0, 1.6, -0.05, M.oakDark);
  for (const zc of [3, 9.1, 15.15]) k.vault(6.05, 3.4, 2.5, X1 - X0, X0, zc, H.vaultBrick, { tile: 1.2, ry: Math.PI / 2 });
  for (const z of [6.05, 12.15]) {
    for (let x = X0 + 4; x < X1 - 1; x += 5) {
      k.cyl(0.36, 0.42, 3.4, x, 0, z, H.stoneGrey, { seg: 8, solid: true });
      k.box(1.0, 0.3, 1.0, x, 3.55, z, M.stone);
    }
    k.box(X1 - X0, 0.5, 0.5, (X0 + X1) / 2, 3.65, z, M.stone, { tile: 1.5 });
  }
  // racks of barrels, two high, along both long walls; rows of standing barrels in the middle aisle
  const wood = lmMat("lm_cask", { map: tex().planks, color: 0xd8a870 }, 0.2);
  const hoop = lmMat("lm_hoop", { color: 0x2a2622, side: THREE.DoubleSide });
  const rack = (z: number, x0: number, x1: number, zDir: number) => {
    k.box(x1 - x0, 0.25, 1.1, (x0 + x1) / 2, 0.125, z, H.timber, { solid: true });
    for (let x = x0 + 0.45; x < x1 - 0.3; x += 0.82) {
      k.barrel(x, 0.62, z, wood, hoop, { lying: true, ry: Math.PI / 2, tint: 0.85 + r() * 0.3 });
      if (r() < 0.8) k.barrel(x + 0.41, 1.26, z + zDir * 0.05, wood, hoop, { lying: true, ry: Math.PI / 2, tint: 0.8 + r() * 0.3 });
    }
  };
  rack(0.95, X0 + 0.5, -2.4, 1);
  rack(0.95, 2.4, X1 - 0.5, 1);
  rack(D - 0.95, X0 + 0.5, 4.8, -1);
  rack(D - 3.6, X0 + 0.5, -5, -1);
  for (let x = -12; x < 8; x += 2.3) {
    if (Math.abs(x) < 2) continue;
    k.barrel(x, 0.48, 7.4 + r() * 0.4, wood, hoop, { tint: 0.8 + r() * 0.3, solid: true });
    if (r() < 0.5) k.barrel(x + 0.8, 0.48, 10.9 + r() * 0.4, wood, hoop, { tint: 0.8 + r() * 0.3, solid: true });
  }
  // the great windows of the old meat hall, their lower lights shuttered (a warehouse now)
  const vwin = glassMat("grisaille", 52);
  for (const x of [-11, -6.5, 6.5, 11, 15.5]) {
    k.plane(1.6, 1.6, x, 2.6, 0.02, vwin.def);
    k.box(1.7, 1.2, 0.08, x, 1.2, 0.04, M.oakDark);
    if (x < 9 && Math.abs(x + 0.5 - 6.3) > 2) {
      k.plane(1.6, 1.6, x + 0.5, 2.6, D - 0.02, vwin.def, { ry: Math.PI });
      k.box(1.7, 1.2, 0.08, x + 0.5, 1.2, D - 0.04, M.oakDark);
    }
  }
  // the cellar master's high desk by the door, a lantern on it
  k.box(1.2, 1.15, 0.6, 4, 0.58, 2.6, M.oakDark, { solid: true });
  k.box(1.3, 0.05, 0.7, 4, 1.2, 2.6, M.oak, { rx: -0.15 });
  k.box(0.5, 0.03, 0.35, 4, 1.25, 2.6, H.paper, { rx: -0.15 });
  // the stair up along the north wall, rising toward the west
  const stair: Stair = { rect: { minX: 10.2, maxX: 18.6, minZ: 15.4, maxZ: 17.6 }, along: "x", foot: 18.6, head: 10.2, lo: 0, hi: 1, y0: 0, y1: UP, rise: 0.2 };
  stairSteps(k, stair, H.timber, M.oakDark);
  k.box(8.6, UP, 0.2, 14.4, UP / 2, 15.3, H.timber, { tile: 1 });
  const groundSolids = [...k.solids];
  // the upper floor over the vaults
  k.box(X1 - X0, 0.3, D, (X0 + X1) / 2, UP - 0.15 + 0.001, D / 2, H.boards, { tile: 1.2, flat: true });
  // the theatre hall: a small stage with a painted backcloth, a proscenium, curtains, footlights; benches
  const SX = -8.4;
  k.box(SX - X0, 0.8, D - 1, (X0 + SX) / 2, UP + 0.4, D / 2, H.boards, { tile: 1, flat: true });
  k.plane(D - 2, 4.4, X0 + 0.1, UP + 3, D / 2, H.backdrop, { ry: Math.PI / 2 });
  for (const z of [1.5, D - 1.5]) k.box(0.5, 5, 2.6, SX, UP + 2.5, z, H.panel);
  k.box(0.5, 1.2, D, SX, UP + 4.9, D / 2, H.panel);
  for (const s of [-1, 1]) k.box(0.1, 3.9, 1.9, SX - 0.1, UP + 2.75, D / 2 + s * 6.2, H.cloth);
  k.box(0.1, 0.8, D - 5.4, SX - 0.1, UP + 4.1, D / 2, H.cloth);
  const benches: Mark[] = [];
  const bseats: Seat[] = [];
  for (let x = -6.2; x <= 5.2; x += 1.25) {
    for (const [z0, z1] of [[2, 8.2], [10.2, 16.4]]) {
      k.box(0.32, 0.05, z1 - z0, x, UP + 0.45, (z0 + z1) / 2, H.panel);
      for (const z of [z0 + 0.2, z1 - 0.2]) k.box(0.28, 0.43, 0.06, x, UP + 0.215, z, H.panel);
      for (let z = z0 + 0.35; z < z1 - 0.2; z += 0.62) benches.push({ x, z, yaw: -Math.PI / 2, y: UP });
    }
    bseats.push({ x, z: 8.0, yaw: -Math.PI / 2, table: 60 + Math.round(x), h: 0.47, via: [] }, { x, z: 10.4, yaw: -Math.PI / 2, table: 80 + Math.round(x), h: 0.47, via: [] });
  }
  // the wall between the theatre and the landing, and between the landing and the studio (doorways)
  k.box(0.3, 5.3, 7, 8.1, UP + 2.65, 3.5, H.plaster);
  k.box(0.3, 5.3, 7.2, 8.1, UP + 2.65, 14.6, H.plaster);
  k.box(0.3, 5.3, 2.6, 10.2, UP + 2.65, 1.7, H.plaster);
  k.box(0.3, 5.3, 9.2, 10.2, UP + 2.65, 10.8, H.plaster);
  k.box(9.8, 1.0, 0.1, 15.1, UP + 0.5, 15.3, M.oakDark); // the rail round the stairwell
  // roof trusses over the upper floor, the ceiling
  k.box(X1 - X0, 0.2, D, (X0 + X1) / 2, UP + 5.4, D / 2, H.plaster, { tile: 2 });
  for (let x = X0 + 2; x < X1; x += 3.2) k.box(0.3, 0.35, D, x, UP + 5.1, D / 2, H.timber);
  // the painter's studio: a tall window, easels with canvases, the model's dais, a table of pots, a stove
  const win = glassMat("grisaille", 51);
  k.plane(3.6, 4.4, X1 - 0.05, UP + 2.8, 7.5, win.def, { ry: -Math.PI / 2 });
  const easel = (x: number, z: number, yaw: number, kind: "portrait" | "landscape", seed: number) => {
    for (const w of [-0.35, 0.35]) k.box(0.05, 2.0, 0.05, x + Math.cos(yaw) * w, UP + 1.0, z - Math.sin(yaw) * w, H.timber, { ry: yaw, rx: 0.12 });
    k.box(0.05, 1.9, 0.05, x - Math.sin(yaw) * 0.35, UP + 0.95, z - Math.cos(yaw) * 0.35, H.timber, { ry: yaw, rx: -0.3 });
    k.box(0.9, 0.05, 0.12, x, UP + 0.9, z, H.timber, { ry: yaw });
    k.box(0.9, 1.1, 0.04, x + Math.sin(yaw) * 0.06, UP + 1.5, z + Math.cos(yaw) * 0.06, H.paper, { ry: yaw, rx: -0.1 });
    k.plane(0.84, 1.04, x + Math.sin(yaw) * 0.09, UP + 1.5, z + Math.cos(yaw) * 0.09, paintMat(kind, seed), { ry: yaw, rx: -0.1 });
  };
  easel(15, 6.2, Math.PI, "portrait", 61);
  easel(12.4, 11.5, Math.PI * 0.8, "landscape", 62);
  easel(18.2, 12.3, -Math.PI * 0.7, "landscape", 63);
  k.box(2.4, 0.35, 2, 16.5, UP + 0.175, 3.2, H.panel, { solid: true });
  chair(k, 16.5, UP + 0.35, 3.2, 0);
  k.box(2.4, 1.8, 0.05, 16.5, UP + 1.3, 2.1, H.cloth);
  k.box(1.6, 0.8, 0.8, 12.2, UP + 0.4, 2.2, M.oakDark, { solid: true });
  for (let i = 0; i < 6; i++) k.cyl(0.05, 0.05, 0.12, 11.7 + i * 0.18, UP + 0.8, 2.2 + (i % 2) * 0.2, H.pot, { seg: 5 });
  for (let i = 0; i < 5; i++) k.box(0.9, 1.1, 0.04, 19.6, UP + 0.55, 10 + i * 0.15, H.paper, { ry: -Math.PI / 2 + 0.2 });
  k.finish();

  // light: lanterns in the cellar, the studio window, the footlights when they play
  const L = lights(scene, 0x9a8a78, 0x2a1e14, 0x3a2c20);
  const lanternA = point(group, 0xffa860, -6, 2.6, 9, 12);
  const lanternB = point(group, 0xffa860, 8, 2.6, 9, 12);
  const deskL = point(group, 0xffb070, 4, 1.6, 2.4, 5);
  const stageL = point(group, 0xffc070, SX + 0.6, UP + 1.2, D / 2, 12);
  const hallL = point(group, 0xffb070, 0, UP + 4, D / 2, 18);
  const dayFill = point(group, 0xd0d4dc, 2, 2.8, 9, 30);
  const flames = new Flames(group, 20, 0.16);
  for (const [x, z] of [[-6, 9], [8, 9], [4, 2.4], [-11, 3], [14, 9]] as Array<[number, number]>) flames.addFlame(x, x === 4 ? 1.45 : 2.6, z);
  const foot = new Flames(group, 12, 0.13);
  for (let z = 2.6; z < D - 2; z += 1.3) foot.addFlame(SX + 0.35, UP + 0.9, z);
  const shaftMat = shaftMaterial();
  lightShaft(group, new THREE.Vector3(X1 - 0.3, UP + 3.5, 7.5), new THREE.Vector3(14.5, UP, 7.8), 2.6, shaftMat);
  let playing = false;
  let day = 1;

  // walking: the wine hall below, the theatre, the landing and the studio above
  const lv = new Levels(
    [
      {
        y: 0,
        floors: [{ minX: X0, maxX: X1, minZ: 0.3, maxZ: D - 0.2 }],
        solids: [...groundSolids, { minX: 10, maxX: 18.6, minZ: 15.2, maxZ: 17.8 }],
      },
      {
        y: UP,
        floors: [
          { minX: SX + 0.3, maxX: 8, minZ: 0.3, maxZ: D - 0.3 },
          { minX: 7.8, maxX: 10.4, minZ: 7, maxZ: 11 },
          { minX: 8.2, maxX: 10.2, minZ: 0.3, maxZ: D - 0.3 },
          { minX: 10, maxX: 10.4, minZ: 3.2, maxZ: 6 },
          { minX: 10.2, maxX: X1, minZ: 0.3, maxZ: 15.1 },
        ],
        solids: [
          { minX: 7.9, maxX: 8.3, minZ: 0, maxZ: 7 },
          { minX: 7.9, maxX: 8.3, minZ: 11, maxZ: D },
          { minX: 10, maxX: 10.4, minZ: 0, maxZ: 3.2 },
          { minX: 10, maxX: 10.4, minZ: 6, maxZ: 15.4 },
          { minX: 15.3, maxX: 17.7, minZ: 2.2, maxZ: 4.2 },
          { minX: 11.4, maxX: 13, minZ: 1.8, maxZ: 2.6 },
          ...Array.from({ length: 10 }, (_, i) => -6.2 + i * 1.25).flatMap((x) => [
            { minX: x - 0.16, maxX: x + 0.16, minZ: 2, maxZ: 8.2 },
            { minX: x - 0.16, maxX: x + 0.16, minZ: 10.2, maxZ: 16.4 },
          ]),
        ],
      },
    ],
    [stair],
  );
  const free = freeFn(lv.levels[0].floors, lv.levels[0].solids);
  const path = walkGraph(
    [[0, 1.5], [0, 4.5], [-10, 4.5], [10, 4.5], [17, 4.5], [-12, 9.2], [-4, 9.2], [4, 9.2], [12, 9.2], [18, 9.2], [-10, 13.8], [0, 13.8], [8, 13.8], [6.3, 16.8], [19.2, 13]],
    free,
  );
  const marks: Record<string, Mark> = {
    cellarDesk: { x: 4, z: 1.95, yaw: 0 },
    easel: { x: 15, z: 7.1, yaw: Math.PI },
    prompter: { x: SX + 0.9, z: D / 2, yaw: -Math.PI / 2, y: UP },
  };
  const sets: Record<string, Mark[]> = {
    barrelRun: [
      { x: -11, z: 9.2, yaw: -Math.PI / 2 },
      { x: 17, z: 9.2, yaw: Math.PI / 2 },
      { x: 1.2, z: 3.8, yaw: Math.PI },
      { x: -8, z: 13.8, yaw: 0 },
      { x: 12, z: 4.4, yaw: Math.PI },
    ],
    stage: [
      { x: -10.2, z: 6.4, yaw: Math.PI / 2, y: UP + 0.8 },
      { x: -10.6, z: 9.1, yaw: Math.PI / 2, y: UP + 0.8 },
      { x: -10.2, z: 11.8, yaw: Math.PI / 2, y: UP + 0.8 },
      { x: -12, z: 7.8, yaw: Math.PI / 2, y: UP + 0.8 },
      { x: -12, z: 10.4, yaw: Math.PI / 2, y: UP + 0.8 },
      { x: -9.4, z: 9.1, yaw: Math.PI / 2, y: UP + 0.8 },
    ],
    theatreSeats: benches.sort((a, b) => b.x - a.x),
  };
  const looks: Lookable[] = [];
  looksAdd(looks, "barrels", -4, 4.2, 1.8, "look at the barrels", "Barrels of wine in racks two high, stencilled with the names of Bordeaux houses and Rhine towns. The old meat hall smells of oak and must now, not of blood.");
  looksAdd(looks, "vaults", 8, 9.2, 1.6, "look up at the vaults", "Brick vaults on stone columns, three aisles of them, built for the butchers' guild in 1504. Soot from lanterns streaks the brick.");
  looksAdd(looks, "stage", SX + 1.6, D / 2, 2.2, "look at the stage", "A small stage with a painted castle and town on the backcloth, red curtains looped back, a row of candle footlights. The society Liefde en Eendragt plays here.");
  looksAdd(looks, "studio", 14.5, 8.8, 1.8, "look at the canvases", "A studio: canvases turned to the wall, one on each easel half done, a model's platform with a draped chair. The north light falls in a grey sheet from the tall window.");
  const seats: Seat[] = [...bseats];
  const room: LandmarkRoom = {
    kind: "landmark",
    landmark: "vleeshuis",
    scene,
    group,
    walk: lv.walk,
    floor: lv.floor,
    seats,
    stands: [],
    exit: { x: 0, z: 0.9, yaw: Math.PI },
    entry: { x: 0, z: 1.4, yaw: 0 },
    entries: { main: { x: 0, z: 1.4, yaw: 0 }, north: { x: 6.3, z: D - 0.9, yaw: Math.PI } },
    exits: { main: { x: 0, z: 0.9, yaw: Math.PI }, north: { x: 6.3, z: D - 0.6, yaw: 0 } },
    lamps: [],
    toWorld,
    pace: 1.25,
    eye: 1.6,
    surface: "stone",
    sound: "vault",
    marks,
    sets,
    looks,
    path,
    setLit(on) {
      playing = on;
      foot.showFirst(on ? 12 : 0);
    },
    setDaylight(kd) {
      day = kd;
      L.hemi.intensity = 2.2 + 0.8 * kd;
      win.mat().color.setScalar(0.12 + 0.9 * kd);
      vwin.mat().color.setScalar(0.12 + 0.8 * kd);
      dayFill.intensity = 6 * kd;
      shaftMat.opacity = Math.max(0, kd - 0.3) * 0.2;
    },
    update(t) {
      flames.update(t);
      foot.update(t);
      const f = flicker(t, 4.4);
      lanternA.intensity = 10 * f;
      lanternB.intensity = 10 * flicker(t, 1.9);
      deskL.intensity = 2.5 * flicker(t, 6.6);
      stageL.intensity = playing ? 6 * f : 0;
      hallL.intensity = playing ? 3 : day < 0.4 ? 1.5 : 0.8;
      room.lamps = [
        { p: toWorld(-6, 9, 2.6), w: 0.3 * f },
        { p: toWorld(8, 9, 2.6), w: 0.3 * f },
      ];
    },
  };
  room.levels = lv;
  room.update(0, 0);
  room.setDaylight(1);
  return room;
}

// ================================================================ the Steen

/**
 * Het Steen as the Museum of Antiquities (opened 1864 in the old castle and prison): a hall of
 * glass cases on tables (finds from the soil and the river: Roman pots and coins, medieval jugs,
 * seals, fossils), old carved stones along the walls; a second hall of arms and armour in racks
 * and cases (for looking only), a suit of armour on a stand, a small bronze gun; and down a stair
 * the old prison cell, shown as the last stop.
 */
export function buildSteen(opts: { origin: { x: number; z: number }; yaw: number }): LandmarkRoom {
  const { scene, group, toWorld } = frameRoom(opts.origin, opts.yaw, 0x26221c);
  const fog = scene.fog as THREE.Fog;
  fog.near = 12;
  fog.far = 50;
  const k = new Kit(group);
  k.shadeTop = 5;
  const DOWN = -2.4;
  const r = rand(91);
  const floor = lmMat("lm_st_floor", { map: slabs(9), color: 0xd0c8bc }, 0.1);
  // hall 1 (x -6..6, z 0..15) and hall 2 (x -5..5, z 15..26): Tournai stone walls, oak beams
  k.box(12, 0.1, 15, 0, -0.05, 7.5, floor, { tile: 1.4, flat: true });
  k.box(7.6, 0.1, 11, -1.2, -0.05, 20.5, floor, { tile: 1.4, flat: true });
  k.box(2.4, 0.1, 6.2, 3.8, -0.05, 18.1, floor, { tile: 1.4, flat: true });
  k.box(0.4, 0.1, 4.8, 4.8, -0.05, 23.6, floor, { tile: 1.4, flat: true });
  const w = (ww: number, h: number, d: number, x: number, y: number, z: number) => k.box(ww, h, d, x, y + h / 2, z, H.stoneGrey, { tile: 1.6 });
  w(0.8, 5.4, 15, -6.4, 0, 7.5);
  w(0.8, 5.4, 15, 6.4, 0, 7.5);
  w(5, 5.4, 0.8, -3.5, 0, -0.4);
  w(5, 5.4, 0.8, 3.5, 0, -0.4);
  w(2, 2.4, 0.8, 0, 3, -0.4);
  k.box(2, 3, 0.1, 0, 1.5, -0.03, M.oakDark);
  w(1.4, 5.4, 0.8, -5.3, 0, 15);
  w(1.4, 5.4, 0.8, 5.3, 0, 15);
  k.archWall(7.2, 5.4, 0.8, 4.2, 2.4, 3.8, 0, 0, 15, H.stoneGrey, { tile: 1.6 });
  w(0.8, 4.6, 11, -5.4, 0, 20.5);
  w(0.8, 4.6, 11, 5.4, 0, 20.5);
  w(10.8, 4.6, 0.8, 0, 0, 26.4);
  k.box(12.8, 0.3, 15, 0, 5.55, 7.5, M.oakDark, { tile: 1.2 });
  k.box(10.8, 0.3, 11, 0, 4.75, 20.5, M.oakDark, { tile: 1.2 });
  for (let z = 1.5; z < 15; z += 1.8) k.box(12, 0.32, 0.3, 0, 5.25, z, H.timber);
  for (let z = 16.5; z < 26; z += 1.8) k.box(10, 0.3, 0.28, 0, 4.45, z, H.timber);
  k.solids.push({ minX: -6, maxX: -3.6, minZ: 14.5, maxZ: 15.5 }, { minX: 3.6, maxX: 6, minZ: 14.5, maxZ: 15.5 });
  // small barred windows high in the thick walls
  const win = glassMat("grisaille", 71);
  for (const s of [-1, 1])
    for (const z of [4, 11]) {
      k.plane(0.9, 1.3, s * 5.98, 3.6, z, win.def, { ry: -s * Math.PI / 2 });
      for (let i = -1; i <= 1; i++) k.box(0.05, 1.3, 0.05, s * 5.95, 3.6, z + i * 0.3, M.iron);
    }
  // glass cases on tables along the walls; standing cabinets in the middle
  const caseAt = (x: number, z: number, along: boolean) => {
    const [cw, cd] = along ? [0.9, 2.2] : [2.2, 0.9];
    k.box(cw, 0.8, cd, x, 0.4, z, M.oakDark, { solid: true, tile: 0.8 });
    k.box(cw, 0.45, cd, x, 1.03, z, H.glassCase);
    // what lies inside: pots, coins, a lamp, a seal, a fossil
    for (let i = 0; i < 6; i++) {
      const ox = along ? (r() - 0.5) * 0.5 : (i - 2.5) * 0.32;
      const oz = along ? (i - 2.5) * 0.32 : (r() - 0.5) * 0.5;
      const kind = i % 3;
      if (kind === 0) k.cyl(0.06, 0.09, 0.2, x + ox, 0.82, z + oz, H.pot, { seg: 6 });
      else if (kind === 1) k.cyl(0.05, 0.05, 0.02, x + ox, 0.82, z + oz, H.bronze, { seg: 6 });
      else k.box(0.14, 0.05, 0.1, x + ox, 0.83, z + oz, i === 2 ? M.stoneDark : H.bronze);
    }
  };
  const casePts: Mark[] = [];
  for (const s of [-1, 1])
    for (const z of [3.2, 7.4, 11.6]) {
      caseAt(s * 5.2, z, true);
      casePts.push({ x: s * 4.1, z: z + (r() - 0.5) * 0.6, yaw: s < 0 ? -Math.PI / 2 : Math.PI / 2 });
    }
  for (const z of [5.3, 10]) {
    k.box(1.2, 2.2, 0.8, 0, 1.1, z, H.glassCase, { solid: true });
    k.box(1.3, 0.1, 0.9, 0, 0.05, z, M.oakDark);
    k.box(1.3, 0.1, 0.9, 0, 2.25, z, M.oakDark);
    for (const y of [0.7, 1.5]) {
      k.box(1.1, 0.03, 0.7, 0, y, z, M.oakDark);
      k.cyl(0.08, 0.1, 0.3, -0.3, y + 0.02, z, M.statue, { seg: 6 });
      k.cyl(0.07, 0.07, 0.35, 0.25, y + 0.02, z, H.bronze, { seg: 6 });
    }
    casePts.push({ x: 1.3, z, yaw: -Math.PI / 2 }, { x: -1.3, z, yaw: Math.PI / 2 });
  }
  // old carved stones along the walls: tombstones, a capital on a plinth, a Roman altar, a coat of arms
  for (const [x, z, kind] of [[-5.6, 1.4, 0], [5.6, 1.4, 1], [-5.6, 13.6, 2], [5.6, 13.6, 0], [-1.8, 13.9, 3], [1.8, 13.9, 1]] as Array<[number, number, number]>) {
    if (kind === 0) k.box(0.18, 1.8, 0.9, x, 0.9, z, M.stoneDark, { rz: x < 0 ? 0.08 : -0.08, tile: 0.8 });
    else if (kind === 1) {
      k.box(0.7, 0.9, 0.7, x, 0.45, z, M.stone, { solid: true });
      k.box(0.8, 0.5, 0.8, x, 1.15, z, M.stoneDark);
    } else if (kind === 2) {
      k.box(0.7, 1.1, 0.5, x, 0.55, z, M.stone, { solid: true });
      k.box(0.8, 0.12, 0.6, x, 1.16, z, M.stone);
    } else {
      k.box(1.0, 1.2, 0.2, x, 1.4, z, M.stoneDark);
      k.cyl(0.35, 0.35, 0.08, x, 1.3, z - 0.12, M.stone, { seg: 8, rx: Math.PI / 2 });
    }
  }
  // hall 2: arms and armour, for looking at only
  const armour = (x: number, z: number, yaw: number) => {
    k.box(0.5, 0.1, 0.5, x, 0.05, z, M.oakDark, { solid: true });
    for (const s of [-0.12, 0.12]) k.cyl(0.07, 0.08, 0.85, x + Math.cos(yaw) * s, 0.1, z - Math.sin(yaw) * s, H.steel, { seg: 6 });
    k.cyl(0.2, 0.16, 0.6, x, 0.95, z, H.steel, { seg: 8 });
    k.cyl(0.22, 0.18, 0.12, x, 0.9, z, H.steel, { seg: 8 });
    for (const s of [-0.28, 0.28]) k.cyl(0.06, 0.07, 0.62, x + Math.cos(yaw) * s, 0.9, z - Math.sin(yaw) * s, H.steel, { seg: 5 });
    k.cyl(0.12, 0.14, 0.26, x, 1.6, z, H.steel, { seg: 7 });
    k.box(0.1, 0.04, 0.14, x + Math.sin(yaw) * 0.12, 1.72, z + Math.cos(yaw) * 0.12, M.black, { ry: yaw });
  };
  armour(-3.8, 18, Math.PI / 2);
  armour(3.8, 18, -Math.PI / 2);
  for (const s of [-1, 1]) {
    // a rack of halberds and pikes against each wall
    k.box(0.2, 0.15, 3.6, s * 4.9, 0.3, 22.2, M.oakDark);
    k.box(0.2, 0.15, 3.6, s * 4.9, 2.2, 22.2, M.oakDark);
    k.solids.push({ minX: s > 0 ? 4.6 : -5.2, maxX: s > 0 ? 5.2 : -4.6, minZ: 20.4, maxZ: 24 });
    for (let i = 0; i < 7; i++) {
      const z = 20.6 + i * 0.52;
      k.cyl(0.025, 0.025, 3.2, s * 4.85, 0, z, H.timber, { seg: 4 });
      k.box(0.04, 0.35, i % 2 ? 0.25 : 0.08, s * 4.85, 3.35, z, H.steel);
    }
    // round shields on the wall
    k.cyl(0.4, 0.4, 0.06, s * 5.0, 3.2, 17.5, H.bronze, { seg: 10, rz: Math.PI / 2 });
  }
  // a case of swords, and a small bronze gun on its carriage
  k.box(2.4, 0.8, 0.9, 0, 0.4, 18.6, M.oakDark, { solid: true, tile: 0.8 });
  k.box(2.4, 0.3, 0.9, 0, 0.95, 18.6, H.glassCase);
  for (let i = 0; i < 4; i++) k.box(1.8, 0.02, 0.06, 0, 0.82, 18.3 + i * 0.2, H.steel, { ry: (r() - 0.5) * 0.1 });
  k.box(0.9, 0.35, 1.6, -1.6, 0.35, 23.3, H.timber, { solid: true });
  k.cyl(0.16, 0.2, 1.7, -1.6, 0.6, 22.5, H.bronze, { seg: 8, rx: Math.PI / 2 - 0.1 });
  for (const s of [-1, 1]) k.cyl(0.35, 0.35, 0.08, -1.6 + s * 0.5, 0.35, 23.5, H.timber, { seg: 10, rz: Math.PI / 2 });
  // the stair down to the old prison, and the cell: a low vault, rings and chains, straw, a slit of light
  const stair: Stair = { rect: { minX: 2.6, maxX: 4.6, minZ: 21.2, maxZ: 26.6 }, along: "z", foot: 26.6, head: 21.2, lo: 1, hi: 0, y0: DOWN, y1: 0, rise: 0.2 };
  stairSteps(k, stair, M.stoneDark);
  k.box(0.1, 1.0, 5.4, 2.5, 0.5, 23.9, M.iron);
  k.box(2.2, 1.0, 0.1, 3.6, 0.5, 21.1, M.iron);
  k.box(7, 0.1, 6, 1.5, DOWN - 0.05, 29.6, floor, { tile: 1.2, flat: true });
  k.box(7, 0.1, 6, 1.5, DOWN - 0.05, 29.6, H.straw, { tile: 0.8, flat: true });
  w(0.6, 2.8, 6, -2.3, DOWN, 29.6);
  w(0.6, 2.8, 6, 5.3, DOWN, 29.6);
  w(7.6, 2.8, 0.6, 1.5, DOWN, 32.9);
  w(5, 2.8, 0.6, -0.1, DOWN, 26.3);
  w(0.8, 2.8, 0.6, 5.2, DOWN, 26.3);
  for (const x of [2.45, 4.75]) k.box(0.3, -DOWN, 5.4, x, DOWN / 2, 23.9, H.stoneGrey, { tile: 1.2 });
  k.vault(7.2, DOWN + 1.7, 0.9, 6.2, 1.5, 26.5, H.vaultStone, { tile: 1.2 });
  for (const [x, z] of [[-1.95, 28.4], [-1.95, 30.8], [4.95, 30]] as Array<[number, number]>) {
    k.cyl(0.12, 0.12, 0.04, x, DOWN + 1.3, z, M.iron, { seg: 6, rz: Math.PI / 2 });
    for (let i = 0; i < 5; i++) k.box(0.05, 0.12, 0.04, x + (x < 0 ? 0.05 : -0.05), DOWN + 1.15 - i * 0.12, z, M.iron);
  }
  k.box(1.6, 0.45, 0.45, 1.5, DOWN + 0.22, 32.3, H.timber, { solid: true });
  k.plane(0.12, 0.7, 1.5, DOWN + 2.1, 32.58, win.def, { ry: Math.PI });
  k.finish();

  // light: lamps in the halls, the thin light in the cell
  const L = lights(scene, 0xb8b8b0, 0x2a2620, 0x3a342a);
  const lampA = point(group, 0xffb070, 0, 3.8, 7.5, 13);
  const lampB = point(group, 0xffb070, 0, 3.2, 20.5, 11);
  const cellL = point(group, 0xc8d0d8, 1.5, DOWN + 1.8, 31, 6);
  const shaftMat = shaftMaterial();
  lightShaft(group, new THREE.Vector3(1.5, DOWN + 2.1, 32.4), new THREE.Vector3(1.2, DOWN, 29.8), 0.5, shaftMat);

  const lv = new Levels(
    [
      {
        y: 0,
        floors: [
          { minX: -6, maxX: 6, minZ: 0.3, maxZ: 15.4 },
          { minX: -2, maxX: 2, minZ: 14.4, maxZ: 15.8 },
          { minX: -5, maxX: 5, minZ: 15, maxZ: 26 },
        ],
        solids: [...k.solids, { minX: 2.4, maxX: 4.8, minZ: 21.1, maxZ: 26.6 }],
      },
      { y: DOWN, floors: [{ minX: -2, maxX: 5, minZ: 26.3, maxZ: 32.6 }, { minX: 2.6, maxX: 4.6, minZ: 26, maxZ: 27 }], solids: [{ minX: 0.6, maxX: 2.4, minZ: 32, maxZ: 32.6 }] },
    ],
    [stair],
  );
  const free = freeFn(lv.levels[0].floors, lv.levels[0].solids);
  const path = walkGraph([[0, 1.5], [0, 7.5], [-3, 3], [3, 3], [-3, 12.5], [3, 12.5], [0, 14.6], [0, 16.5], [-2.5, 20.5], [1.2, 21], [0, 24.5]], free);
  const marks: Record<string, Mark> = {};
  const sets: Record<string, Mark[]> = {
    cases: [...casePts, { x: -2.6, z: 18.5, yaw: -Math.PI / 2 }, { x: 2.6, z: 18.4, yaw: Math.PI / 2 }, { x: 0, z: 19.7, yaw: Math.PI }, { x: -3.6, z: 22.2, yaw: -Math.PI / 2 }, { x: -0.4, z: 23.4, yaw: -Math.PI / 2 }],
    custodianRound: [
      { x: 0, z: 2.2, yaw: 0 },
      { x: 0, z: 13.8, yaw: Math.PI },
      { x: 0, z: 21.4, yaw: Math.PI },
      { x: -2.6, z: 7.6, yaw: Math.PI / 2 },
    ],
  };
  const looks: Lookable[] = [];
  looksAdd(looks, "cases", -3.6, 7.4, 1.6, "look into the cases", "Under the glass: Roman pots and coins dug out of the old Burcht and the river mud, green bronze pins, a clay lamp, a medieval jug, wax seals of the guilds, a fossil shell as big as a hand. Each has a small card in careful French and Flemish.");
  looksAdd(looks, "cabinet", 1.4, 5.3, 1.3, "look into the cabinet", "A tall cabinet: small carved saints from demolished churches, a bronze mortar, a pewter jug with the town's arms.");
  looksAdd(looks, "stones", -4.8, 13.4, 1.5, "look at the old stones", "Carved stones along the wall: a tombstone with a knight worn almost smooth, the capital of a column from a church that is gone, a Roman altar stone, the arms of the town cut in stone.");
  looksAdd(looks, "armour", -2.8, 18, 1.4, "look at the armour", "A suit of armour on a stand, empty and patient, and racks of halberds and pikes of the town's old militia. For looking at only: the attendant watches your hands.");
  looksAdd(looks, "gun", -1.6, 21.8, 1.5, "look at the bronze gun", "A small bronze gun on a wooden carriage, green with age, the maker's name and a date cast on the barrel.");
  looksAdd(looks, "cell", 1.4, 29.8, 2.2, "look round the cell", "The old prison of the Steen. Until fifty years ago men waited here for the judges: a low vault, iron rings in the wall, a bench, a slit of grey light. Names and crosses are scratched into the stone.");
  looksAdd(looks, "stairdown", 3.6, 20.4, 1.2, "look down the stair", "A worn stair goes down into the dark: the old prison cells under the castle. The last stop of the museum.");
  let day = 1;
  const room: LandmarkRoom = {
    kind: "landmark",
    landmark: "steen",
    scene,
    group,
    walk: lv.walk,
    floor: lv.floor,
    seats: [],
    stands: [],
    exit: { x: 0, z: 0.9, yaw: Math.PI },
    entry: { x: 0, z: 1.4, yaw: 0 },
    entries: { main: { x: 0, z: 1.4, yaw: 0 } },
    exits: { main: { x: 0, z: 0.9, yaw: Math.PI } },
    lamps: [],
    toWorld,
    pace: 1.2,
    eye: 1.6,
    surface: "stone",
    sound: "museum",
    marks,
    sets,
    looks,
    path,
    setDaylight(kd) {
      day = kd;
      L.hemi.intensity = 2.0 + 1.2 * kd;
      win.mat().color.setScalar(0.12 + 0.9 * kd);
      shaftMat.opacity = Math.max(0, kd - 0.3) * 0.1;
    },
    update(t) {
      lampA.intensity = (day < 0.5 ? 5 : 3) * flicker(t, 2.3);
      lampB.intensity = (day < 0.5 ? 4 : 2.5) * flicker(t, 4.1);
      cellL.intensity = 0.6 + 1.2 * day;
      room.lamps = [{ p: toWorld(0, 7.5, 3.8), w: 0.25 * flicker(t, 2.3) }];
    },
  };
  room.levels = lv;
  room.update(0, 0);
  room.setDaylight(1);
  return room;
}

// ================================================================ the Oostershuis

/**
 * The Oostershuis, the house of the Hanse's merchants (Cornelis Floris, 1564-68). The Hanse left
 * long ago; from 1815 the building served as warehouses, and in 1863 the Hanseatic cities ceded
 * it to the Belgian State. Here: the vaulted gate passage, then a great hall of timber posts and
 * beams stacked with sacks, bales, crates and casks in the State's keeping, a weighing scale, the
 * storekeeper's desk, a hoist through a hatch in the ceiling; natie men carry sacks.
 */
export function buildOostershuis(opts: { origin: { x: number; z: number }; yaw: number }): LandmarkRoom {
  const { scene, group, toWorld } = frameRoom(opts.origin, opts.yaw, 0x2e281e);
  const fog = scene.fog as THREE.Fog;
  fog.near = 16;
  fog.far = 75;
  const k = new Kit(group);
  k.shadeTop = 8;
  const r = rand(123);
  const X = 13;
  const Z0 = 6;
  const Z1 = 38;
  const HT = 8;
  k.box(5, 0.1, Z0, 0, -0.05, Z0 / 2, lmMat("lm_oh_cobble", { map: tex().cobble, color: 0x9a948c }, 0.1), { tile: 1.4, flat: true });
  k.box(X * 2, 0.1, Z1 - Z0, 0, -0.05, (Z0 + Z1) / 2, H.boards, { tile: 1.6, flat: true });
  // the gate passage: a brick barrel vault, the gate behind you
  for (const s of [-1, 1]) k.box(0.6, 4.2, Z0, s * 2.8, 2.1, Z0 / 2, H.brick, { tile: 1.2 });
  k.vault(5, 2.8, 1.6, Z0, 0, 0, H.vaultBrick, { tile: 1.2 });
  k.box(5.2, 4.4, 0.2, 0, 2.2, -0.1, M.oakDark, { tile: 1 });
  // the hall's walls: brick with stone dressings, tall windows with small panes
  const wall = (w: number, h: number, d: number, x: number, z: number) => k.box(w, h, d, x, h / 2, z, H.brick, { tile: 1.6 });
  wall(0.8, HT, Z1 - Z0, -X - 0.4, (Z0 + Z1) / 2);
  wall(0.8, HT, Z1 - Z0, X + 0.4, (Z0 + Z1) / 2);
  wall(X * 2 + 1.6, HT, 0.8, 0, Z1 + 0.4);
  wall(X - 2.5, HT, 0.8, -(X + 2.5) / 2, Z0 - 0.4);
  wall(X - 2.5, HT, 0.8, (X + 2.5) / 2, Z0 - 0.4);
  k.box(5, HT - 4.4, 0.8, 0, 4.4 + (HT - 4.4) / 2, Z0 - 0.4, H.brick, { tile: 1.6 });
  // the ceiling: joists and planks, the hatch with its hoist
  k.box(X * 2, 0.3, Z1 - Z0, 0, HT + 0.15, (Z0 + Z1) / 2, H.timber, { tile: 1.2 });
  for (let z = Z0 + 1; z < Z1; z += 1.2) k.box(X * 2, 0.25, 0.22, 0, HT - 0.12, z, H.timber);
  // posts and beams, with braces
  for (const s of [-1, 1]) {
    k.box(0.4, 0.45, Z1 - Z0, s * 4.5, HT - 0.45, (Z0 + Z1) / 2, H.timber, { tile: 1 });
    for (let z = Z0 + 4; z < Z1 - 1; z += 5) {
      k.box(0.4, HT - 0.7, 0.4, s * 4.5, (HT - 0.7) / 2, z, H.timber, { solid: true, tile: 1 });
      for (const d of [-1, 1]) k.box(0.18, 1.6, 0.18, s * 4.5, HT - 1.35, z + d * 0.55, H.timber, { rx: d * 0.75 });
    }
  }
  const win = glassMat("grisaille", 81);
  for (const s of [-1, 1])
    for (let z = Z0 + 3.5; z < Z1 - 1; z += 5) {
      k.plane(1.6, 3.6, s * (X - 0.02), 4.6, z, win.def, { ry: -s * Math.PI / 2 });
      k.box(0.3, 0.2, 1.9, s * (X - 0.1), 6.5, z, M.stone);
      k.box(0.3, 0.2, 1.9, s * (X - 0.1), 2.75, z, M.stone);
      if (r() < 0.4) k.box(0.06, 3.6, 0.8, s * (X - 0.08), 4.6, z - 0.4, M.oakDark);
    }
  // stacks: sacks in pyramids, bales corded, crates, casks
  const sackStack = (x: number, z: number, n: number, m = H.sack) => {
    for (let lvl = 0; lvl < 4; lvl++)
      for (let i = 0; i < n - lvl; i++)
        for (let j = 0; j < 2; j++) k.box(0.95, 0.42, 0.6, x + (i - (n - lvl - 1) / 2) * 0.97, 0.21 + lvl * 0.4, z + (j - 0.5) * 0.62, m, { ry: (r() - 0.5) * 0.15, tint: 0.85 + r() * 0.25 });
    k.solid(n * 0.97 + 0.2, 1.4, x, z);
  };
  const bales = (x: number, z: number, n: number) => {
    for (let i = 0; i < n; i++)
      for (let lvl = 0; lvl < 2; lvl++) {
        const bx = x + (i % 3) * 1.25;
        const bz = z + Math.floor(i / 3) * 1.05;
        k.box(1.15, 0.9, 0.95, bx, 0.45 + lvl * 0.92, bz, H.bale, { tint: 0.85 + r() * 0.2 });
        for (const d of [-0.3, 0.3]) k.box(0.04, 0.92, 0.97, bx + d, 0.45 + lvl * 0.92, bz, H.rope);
      }
    k.solid(3 * 1.25 + 0.2, Math.ceil(n / 3) * 1.05 + 0.2, x + 1.25, z + ((Math.ceil(n / 3) - 1) * 1.05) / 2);
  };
  sackStack(-9, 12, 5);
  sackStack(-9, 18, 5, H.bale);
  sackStack(9, 25, 5);
  sackStack(9, 31, 4);
  sackStack(-1.5, 30, 3);
  bales(5.5, 17, 3);
  for (let i = 0; i < 4; i++) k.box(1.1, 0.8, 0.9, -8 + i * 1.15, 0.4, 7.4, H.crate, { tint: 0.9 + r() * 0.2 });
  k.solid(4.8, 1.1, -6.3, 7.4);
  bales(6.5, 11, 6);
  bales(-10.5, 24, 9);
  for (let i = 0; i < 6; i++) k.box(1.1, 0.8, 0.9, -10 + (i % 3) * 1.15, 0.4 + Math.floor(i / 3) * 0.82, 33, H.crate, { tint: 0.9 + r() * 0.2 });
  k.solid(3.6, 1.1, -8.9, 33);
  const wood = lmMat("lm_cask", { map: tex().planks, color: 0xd8a870 }, 0.2);
  const hoop = lmMat("lm_hoop", { color: 0x2a2622, side: THREE.DoubleSide });
  for (let i = 0; i < 5; i++) k.barrel(2 + i * 0.8, 0.48, 35.4, wood, hoop, { tint: 0.85 + r() * 0.3, solid: true });
  // the decimal scale and the storekeeper's desk by the gate
  k.box(1.2, 0.12, 1.2, 3.2, 0.06, 9.6, M.iron, { solid: true });
  k.box(0.12, 1.4, 0.12, 3.2, 0.8, 9.0, M.iron);
  k.box(0.9, 0.08, 0.08, 3.2, 1.5, 9.0, M.iron);
  k.box(0.6, 0.4, 0.6, 3.2, 0.32, 9.7, H.sack);
  desk(k, 6, 0, 7.6, 1.6);
  k.box(0.4, 0.03, 0.3, 6.4, 0.84, 7.6, H.books);
  // the hatch and the hoist rope with a hook and a sack
  k.box(2, 0.1, 2, 0, HT - 0.05, 22, M.black);
  k.box(4, 0.35, 0.35, 0, HT + 0.4, 22, H.timber);
  k.finish();
  const hoist = new THREE.Group();
  const ropeM = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 4), matOf(H.rope));
  const sackM = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.6), matOf(H.sack));
  const col = (n: number) => new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3);
  ropeM.geometry.setAttribute("color", col(ropeM.geometry.getAttribute("position").count));
  sackM.geometry.setAttribute("color", col(sackM.geometry.getAttribute("position").count));
  hoist.add(ropeM, sackM);
  hoist.position.set(0, 0, 22);
  group.add(hoist);
  // a board over the desk
  k.plane(2.2, 0.35, 6, 2.6, 7.2, sign("OOSTERSHUIS", "lm_oh_sign"), {});
  k.finish();

  const L = lights(scene, 0xc8c0b0, 0x2e2418, 0x3a3024);
  const lampA = point(group, 0xffb070, 5.8, 2.2, 8, 10);
  const lampB = point(group, 0xffb070, 0, 5, 24, 20);
  const dayFill = point(group, 0xd8d8e0, 0, 6, 18, 40);
  const shaftMat = shaftMaterial();
  for (let z = Z0 + 8.5; z < Z1 - 1; z += 10) lightShaft(group, new THREE.Vector3(X - 0.2, 5.5, z), new THREE.Vector3(X - 6, 0, z + 2), 1.8, shaftMat);
  const flames = new Flames(group, 4, 0.16);
  flames.addFlame(5.8, 1.1, 7.6);
  let day = 1;
  const floors: Rect[] = [
    { minX: -2.2, maxX: 2.2, minZ: 0.3, maxZ: Z0 + 0.5 },
    { minX: -X + 0.2, maxX: X - 0.2, minZ: Z0, maxZ: Z1 - 0.2 },
  ];
  const lv = new Levels([{ y: 0, floors, solids: k.solids }], []);
  const free = freeFn(floors, k.solids);
  const path = walkGraph([[0, 1.5], [0, 7], [-6.5, 9], [0, 15], [-6, 15], [6.5, 15], [2, 22], [-6, 28], [6, 28], [0, 34], [-6.5, 21]], free);
  const marks: Record<string, Mark> = {
    storeDesk: { x: 6, z: 6.85, yaw: 0 },
  };
  const sets: Record<string, Mark[]> = {
    sackRun: [
      { x: -6.4, z: 12, yaw: -Math.PI / 2 },
      { x: 2.1, z: 9.6, yaw: Math.PI / 2 },
      { x: 6.3, z: 25, yaw: Math.PI / 2 },
      { x: 0.8, z: 21.2, yaw: 0 },
      { x: 6.3, z: 31, yaw: Math.PI / 2 },
      { x: -6.4, z: 18, yaw: -Math.PI / 2 },
    ],
  };
  const looks: Lookable[] = [];
  looksAdd(looks, "stacks", -5.8, 15, 1.8, "look at the stacks", "Sacks of coffee and grain in pyramids, bales of wool and cotton corded tight, crates and casks, each marked in chalk with a number from the storekeeper's book. It smells of jute, tar and old timber.");
  looksAdd(looks, "scale", 2.2, 10.4, 1.4, "look at the scale", "A decimal scale on the floor: a sack goes on the platform, the storekeeper slides a weight along the beam and writes the figure down.");
  looksAdd(looks, "hall", 0, 16, 1.4, "look round the hall", "The house of the Hanse's merchants, three hundred years old: once their counting rooms and chambers, now a warehouse of the Belgian State. Forty windows, a great tower outside, and in here only dust and goods.");
  looksAdd(looks, "hoist", 0, 20.6, 1.5, "look up at the hoist", "A rope comes down through a hatch in the ceiling with a hook on it: goods go up and down between the floors on it.");
  const room: LandmarkRoom = {
    kind: "landmark",
    landmark: "oostershuis",
    scene,
    group,
    walk: lv.walk,
    floor: lv.floor,
    seats: [],
    stands: [],
    exit: { x: 0, z: 0.9, yaw: Math.PI },
    entry: { x: 0, z: 1.4, yaw: 0 },
    entries: { main: { x: 0, z: 1.4, yaw: 0 } },
    exits: { main: { x: 0, z: 0.9, yaw: Math.PI } },
    lamps: [],
    toWorld,
    pace: 1.35,
    eye: 1.6,
    surface: "wood",
    sound: "store",
    marks,
    sets,
    looks,
    path,
    animate(t) {
      // the hoist goes up and down, slowly
      const y = 3.2 + Math.sin(t * 0.18) * 2.4;
      sackM.position.y = y;
      ropeM.scale.y = HT - y;
      ropeM.position.y = (HT + y) / 2 + 0.25;
    },
    setDaylight(kd) {
      day = kd;
      L.hemi.intensity = 2.0 + 1.8 * kd;
      win.mat().color.setScalar(0.12 + 0.9 * kd);
      shaftMat.opacity = Math.max(0, kd - 0.3) * 0.25;
    },
    update(t) {
      flames.update(t);
      lampA.intensity = 2.5 * flicker(t, 3.3);
      lampB.intensity = (day < 0.4 ? 8 : 3) * flicker(t, 1.7);
      dayFill.intensity = 14 * day;
      room.lamps = [{ p: toWorld(5.8, 7.6, 1.1), w: 0.2 * flicker(t, 3.3) }];
    },
  };
  room.levels = lv;
  room.update(0, 0);
  room.setDaylight(1);
  return room;
}

