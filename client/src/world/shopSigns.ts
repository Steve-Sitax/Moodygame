import * as THREE from "three";
import { addDial } from "./clockHands";
import { psx } from "../retro/psx";
import { SHOP_LOOK, type ShopTrade } from "../../../shared/shops";

// M7 shops (docs/milestones/M7-shops.md): each shop's board over its door, flat on the wall in the band between
// the ground storey and the first floor's windows (where street life hangs its boards, streetlife.ts BOARD_BAND),
// and a wrought-iron bracket beside the door with the trade's sign hanging from it: a gilt pretzel for the baker,
// a hat, a brass basin for the barber, a boot, a clock, a book, a pestle and mortar, a bull's head, a cup, an anchor.
// Tagged for the sign check (dev/signcheck.ts, userData.wallSign).

interface ShopDoor {
  place: string;
  label: string;
  trade: ShopTrade | null;
  wall: [number, number];
  out: [number, number];
}

function boardCanvas(lines: string[], bg: string, fg: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 96;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 96);
  g.strokeStyle = fg;
  g.globalAlpha = 0.6;
  g.lineWidth = 3;
  g.strokeRect(6, 6, 500, 84);
  g.globalAlpha = 1;
  g.fillStyle = fg;
  g.textAlign = "center";
  g.textBaseline = "middle";
  if (lines.length === 1) {
    g.font = "bold 50px Georgia, 'Times New Roman', serif";
    g.fillText(lines[0], 256, 50, 480);
  } else {
    g.font = "bold 38px Georgia, 'Times New Roman', serif";
    g.fillText(lines[0], 256, 34, 480);
    g.font = "24px Georgia, 'Times New Roman', serif";
    g.fillText(lines[1], 256, 72, 480);
  }
  // weather on the paint
  let s = lines.join("").length * 131;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(0,0,0,${r() * 0.35})`;
    g.fillRect(r() * 512, r() * 96, 2 + r() * 3, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

const gilt = () => psx(new THREE.MeshLambertMaterial({ color: 0xb08a3a }), { affine: 0 });
const ironM = () => psx(new THREE.MeshLambertMaterial({ color: 0x161412 }), { affine: 0 });

/** The trade's sign, hanging from the bracket's end (local: hanging down from the origin, facing along x). */
function symbol(kind: NonNullable<(typeof SHOP_LOOK)[ShopTrade]["hang"]>): THREE.Object3D {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    g.add(mesh);
  };
  const gm = gilt();
  const im = ironM();
  add(new THREE.CylinderGeometry(0.01, 0.01, 0.18, 3), im, 0, -0.09, 0);
  switch (kind) {
    case "pretzel":
      add(new THREE.TorusGeometry(0.16, 0.035, 5, 12), gm, 0, -0.34, 0, 0, Math.PI / 2);
      add(new THREE.TorusGeometry(0.09, 0.03, 5, 10), gm, 0, -0.3, -0.07, 0, Math.PI / 2);
      add(new THREE.TorusGeometry(0.09, 0.03, 5, 10), gm, 0, -0.3, 0.07, 0, Math.PI / 2);
      break;
    case "hat":
      add(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 12), im, 0, -0.45, 0);
      add(new THREE.CylinderGeometry(0.12, 0.12, 0.26, 12), im, 0, -0.32, 0);
      break;
    case "basin":
      add(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 14), gm, 0, -0.38, 0, 0, 0, Math.PI / 2);
      add(new THREE.BoxGeometry(0.02, 0.1, 0.14), im, 0, -0.2, 0);
      break;
    case "boot":
      add(new THREE.BoxGeometry(0.06, 0.34, 0.14), im, 0, -0.35, 0.04);
      add(new THREE.BoxGeometry(0.06, 0.1, 0.3), im, 0, -0.47, -0.04);
      break;
    case "clock":
      add(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 14), im, 0, -0.38, 0, 0, 0, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.17, 0.17, 0.07, 14), psx(new THREE.MeshLambertMaterial({ color: 0xe8e0c8 }), { affine: 0 }), 0, -0.38, 0, 0, 0, Math.PI / 2);
      // live hands on both faces (world/clockHands.ts): the clockmaker's sign shows the game's time
      for (const sx of [1, -1]) addDial(g, { at: [sx * 0.035, -0.38, 0], normal: [sx, 0, 0], radius: 0.17, lift: 0.004, mat: im, minute: 0.78, hour: 0.52, width: 0.12, kind: "clockmaker's hanging sign" });
      break;
    case "book":
      add(new THREE.BoxGeometry(0.06, 0.34, 0.26), psx(new THREE.MeshLambertMaterial({ color: 0x5a1a12 }), { affine: 0 }), 0, -0.36, 0);
      add(new THREE.BoxGeometry(0.065, 0.3, 0.02), gm, 0, -0.36, 0.1);
      break;
    case "pestle":
      add(new THREE.CylinderGeometry(0.14, 0.09, 0.2, 10), gm, 0, -0.42, 0);
      add(new THREE.CylinderGeometry(0.025, 0.02, 0.32, 5), gm, 0, -0.3, 0.05, 0.4, 0, 0);
      break;
    case "bull": {
      const red = psx(new THREE.MeshLambertMaterial({ color: 0x8a2a1a }), { affine: 0 });
      add(new THREE.BoxGeometry(0.1, 0.28, 0.24), red, 0, -0.38, 0);
      add(new THREE.ConeGeometry(0.03, 0.18, 5), gm, 0, -0.22, -0.14, 0, 0, Math.PI / 2 + 0.6);
      add(new THREE.ConeGeometry(0.03, 0.18, 5), gm, 0, -0.22, 0.14, 0, 0, -Math.PI / 2 - 0.6);
      break;
    }
    case "cup":
      add(new THREE.CylinderGeometry(0.14, 0.1, 0.18, 12), gm, 0, -0.36, 0);
      add(new THREE.TorusGeometry(0.06, 0.015, 4, 8), gm, 0, -0.35, 0.15, 0, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.2, 0.2, 0.015, 12), gm, 0, -0.46, 0);
      break;
    case "anchor":
      add(new THREE.BoxGeometry(0.04, 0.4, 0.04), im, 0, -0.38, 0);
      add(new THREE.TorusGeometry(0.16, 0.025, 4, 10, Math.PI), im, 0, -0.5, 0, 0, Math.PI / 2, Math.PI);
      add(new THREE.BoxGeometry(0.04, 0.03, 0.26), im, 0, -0.24, 0);
      break;
    case "key":
      add(new THREE.TorusGeometry(0.08, 0.025, 4, 10), gm, 0, -0.26, 0, 0, Math.PI / 2);
      add(new THREE.BoxGeometry(0.04, 0.3, 0.04), gm, 0, -0.48, 0);
      break;
    case "balls":
      for (const [y, z] of [[-0.3, -0.1], [-0.3, 0.1], [-0.45, 0]]) add(new THREE.SphereGeometry(0.07, 8, 6), gm, 0, y, z);
      break;
  }
  return g;
}

/** A shop's front as its house plan has it: the door on the front face, and how far the front runs either side of it (m). */
export interface FrontSpan {
  /** Metres of front to the right of the door (seen from the street) and to the left. */
  right: number;
  left: number;
  /** The front's own door point and outward normal (the house plan's frame: the town's door step is rounded). */
  wall: [number, number];
  out: [number, number];
}

/** Hang a board and a bracket sign on every shop's front (once, when the shops are known). `fronts`: by place, from the house plans. */
export function hangShopSigns(scene: THREE.Scene, shops: ShopDoor[], fronts: Map<string, FrontSpan> = new Map()): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const s of shops) {
    if (!s.trade) continue;
    const look = SHOP_LOOK[s.trade];
    const fr = fronts.get(s.place) ?? { right: 1.4, left: 1.4, wall: s.wall, out: s.out };
    const [ox, oz] = fr.out;
    const yaw = Math.atan2(ox, oz);
    const side: [number, number] = [oz, -ox]; // along the front (to the right, seen from the street)
    // an odd number of bays: over the middle one (the door's). An even number: the door is in a bay beside the middle,
    // and its stone head stands out of the wall in the board's band, so over the next bay's window instead
    const L = fr.right + fr.left;
    const bays = Math.max(1, Math.round(L / 3));
    const bw = L / bays;
    const mid = bays % 2 === 0 ? (fr.right - fr.left) / 2 + (Math.sign(fr.right - fr.left) * bw) / 2 : (fr.right - fr.left) / 2;
    const boardW = Math.min(1.9, L - 1.4, L / bays - (bays % 2 === 0 ? 1.25 : 0.6));
    const [wx, wz] = [fr.wall[0] + side[0] * mid, fr.wall[1] + side[1] * mid];
    // the Berg has its own board (game/press.ts); every other shop its name board over the door
    if (s.trade !== "pawnbroker") {
      const lines = look.sign.split("|");
      const board = new THREE.Mesh(new THREE.PlaneGeometry(boardW, 0.44), psx(new THREE.MeshLambertMaterial({ map: boardCanvas(lines, look.board[0], look.board[1]) }), { affine: 0.3 }));
      board.position.set(wx + ox * 0.014, 3.93, wz + oz * 0.014);
      board.rotation.y = yaw;
      board.userData.wallSign = { kind: "shop board", name: lines[0], flat: true };
      scene.add(board);
      out.push(board);
    }
    if (!look.hang) continue;
    // the bracket: an iron arm 1 m out, first-floor height, beside the door on the side with more front, a scroll under it
    const off = fr.right >= fr.left ? Math.min(0.95, fr.right - 0.3) : -Math.min(0.95, fr.left - 0.3);
    const bx = fr.wall[0] + side[0] * off;
    const bz = fr.wall[1] + side[1] * off;
    const g = new THREE.Group();
    g.position.set(bx, 3.28, bz);
    g.rotation.y = yaw;
    const im = ironM();
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 1.0), im);
    arm.position.set(0, 0, 0.52);
    g.add(arm);
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.62), im);
    brace.position.set(0, -0.2, 0.28);
    brace.rotation.x = 0.62;
    g.add(brace);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.02), im);
    plate.position.set(0, -0.12, 0.01);
    g.add(plate);
    const sym = symbol(look.hang);
    sym.position.set(0, 0, 0.9);
    g.add(sym);
    // the whole hanging sign in one mesh per material, and tagged for the sign check as a bracket sign
    scene.add(g);
    g.updateMatrixWorld(true);
    plate.userData.wallSign = { kind: "shop bracket", name: s.trade, flat: false };
    out.push(g);
  }
  return out;
}
