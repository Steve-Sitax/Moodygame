import * as THREE from "three";
import { psx } from "../retro/psx";

// M4b: the leads' wardrobe (Steve: "no groom, no bride"). Small props made in code from a few
// boxes and cylinders, like instruments.ts, in the puppet's own frame (+z is where they face,
// y up, feet at 0), scaled to the body's height, so they go where the person goes.
//
// A working-class Antwerp bride of 1873 did not wear white: her best dark dress (often worn
// again for years), a white veil and a wreath of orange blossom (real or wax), a small
// bouquet. The groom in his dark best coat, a top hat if he owned or borrowed one, a flower
// in the buttonhole. (Sources: Ohio State Historic Costume & Textiles Collection, "Wedding
// Traditions"; Modemuze, "Witte bruid, zwarte bruid"; Rijksmuseum, "Trouwjurk met
// oranjebloesem"; V&A, "A Romantic Frame of Mind".) So the bride keeps her own dress here.

export type WardrobeRole =
  | "bride"
  | "groom"
  | "priest"
  | "auctioneer"
  | "speaker"
  | "drunkard"
  | "pickpocket"
  | "widow"
  | "bearers"
  | "hawker"
  | "showman";

let mats: Record<string, THREE.Material> | null = null;
function m(): Record<string, THREE.Material> {
  mats ??= {
    veil: psx(new THREE.MeshLambertMaterial({ color: 0xece8dc, transparent: true, opacity: 0.82, side: THREE.DoubleSide })),
    blossom: psx(new THREE.MeshLambertMaterial({ color: 0xf4efe0 })),
    leaf: psx(new THREE.MeshLambertMaterial({ color: 0x3e5a2c })),
    hat: psx(new THREE.MeshLambertMaterial({ color: 0x151417 })),
    surplice: psx(new THREE.MeshLambertMaterial({ color: 0xe6e2d6 })),
    stole: psx(new THREE.MeshLambertMaterial({ color: 0x6a2a5a })),
    brass: psx(new THREE.MeshLambertMaterial({ color: 0xb8923a })),
    wood: psx(new THREE.MeshLambertMaterial({ color: 0x5a3a20 })),
    slate: psx(new THREE.MeshLambertMaterial({ color: 0x24262a })),
    chalk: psx(new THREE.MeshLambertMaterial({ color: 0xcfcfc6 })),
    paper: psx(new THREE.MeshLambertMaterial({ color: 0xd8cfb4 })),
    bottle: psx(new THREE.MeshLambertMaterial({ color: 0x24402a })),
    cap: psx(new THREE.MeshLambertMaterial({ color: 0x3a3430 })),
    purse: psx(new THREE.MeshLambertMaterial({ color: 0x5a3a24 })),
    black: psx(new THREE.MeshLambertMaterial({ color: 0x0e0d10, side: THREE.DoubleSide })),
    fur: psx(new THREE.MeshLambertMaterial({ color: 0x6a4a2a })),
    face: psx(new THREE.MeshLambertMaterial({ color: 0xb08a68 })),
    fez: psx(new THREE.MeshLambertMaterial({ color: 0xa02a24 })),
    goods: psx(new THREE.MeshLambertMaterial({ color: 0xc89a4a })),
    goods2: psx(new THREE.MeshLambertMaterial({ color: 0x8a3a2a })),
    strap: psx(new THREE.MeshLambertMaterial({ color: 0x4a3a2a })),
    coffin: psx(new THREE.MeshLambertMaterial({ color: 0x3a2616 })),
    pall: psx(new THREE.MeshLambertMaterial({ color: 0x121114 })),
    cross: psx(new THREE.MeshLambertMaterial({ color: 0xd8d4c8 })),
  };
  return mats;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  o.position.set(x, y, z);
  return o;
}
function cyl(rt: number, rb: number, h: number, mat: THREE.Material, x: number, y: number, z: number, seg = 8): THREE.Mesh {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  o.position.set(x, y, z);
  return o;
}
function tuft(r: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const o = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat);
  o.position.set(x, y, z);
  return o;
}

export interface Wear {
  role: WardrobeRole;
  root: THREE.Group;
  /** What moves (the handbell, the monkey, the purse that appears). */
  parts: Record<string, THREE.Object3D>;
  phase: number;
}

/** The top of the head for a body of this height factor (1: a 1.74 m man). */
const headTop = (s: number) => 1.7 * s;

function topHat(k: Record<string, THREE.Material>, top: number): THREE.Group {
  const g = new THREE.Group();
  g.add(cyl(0.155, 0.155, 0.015, k.hat, 0, top - 0.02, 0, 10));
  g.add(cyl(0.1, 0.095, 0.2, k.hat, 0, top + 0.08, 0, 10));
  return g;
}

/** A veil from the crown down the back, white for the bride, black for the widow. */
function veil(mat: THREE.Material, top: number, long: number): THREE.Group {
  const g = new THREE.Group();
  // from the crown, falling wider over the shoulders and down the back
  const back = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.3, long, 8, 1, true, Math.PI * 0.5, Math.PI), mat);
  back.position.set(0, top - long / 2 + 0.02, -0.04);
  g.add(back);
  g.add(box(0.24, 0.012, 0.24, mat, 0, top + 0.012, -0.01)); // over the crown
  return g;
}

export function makeWear(role: WardrobeRole, bodyScale = 1): Wear {
  const k = m();
  const s = bodyScale;
  const top = headTop(s);
  const root = new THREE.Group();
  root.name = `wardrobe_${role}`;
  const parts: Record<string, THREE.Object3D> = {};
  switch (role) {
    case "bride": {
      root.add(veil(k.veil, top, 0.95 * s));
      // the wreath of orange blossom round the crown
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        root.add(tuft(0.036, i % 3 === 2 ? k.leaf : k.blossom, Math.cos(a) * 0.1, top + 0.005, Math.sin(a) * 0.1 + 0.01));
      }
      // a small bouquet held at the waist
      const b = new THREE.Group();
      b.position.set(0.02, 1.0 * s, 0.24);
      b.add(cyl(0.012, 0.02, 0.16, k.leaf, 0, -0.07, 0, 5));
      for (let i = 0; i < 6; i++) b.add(tuft(0.035, i % 3 ? k.blossom : k.leaf, Math.cos(i) * 0.05, 0.03 + (i % 2) * 0.03, Math.sin(i) * 0.05));
      root.add(b);
      break;
    }
    case "groom": {
      root.add(topHat(k, top));
      root.add(tuft(0.03, k.blossom, 0.1, 1.38 * s, 0.13)); // the buttonhole
      root.add(tuft(0.018, k.leaf, 0.12, 1.35 * s, 0.13));
      break;
    }
    case "priest": {
      // a white surplice over the cassock, the stole down the front, the biretta
      // (the priest's own model has his hat and cassock; the surplice and the stole go over them)
      root.add(cyl(0.2, 0.25, 0.5 * s, k.surplice, 0, 0.98 * s, 0, 10));
      root.add(box(0.05, 0.62 * s, 0.02, k.stole, -0.07, 1.02 * s, 0.215));
      root.add(box(0.05, 0.62 * s, 0.02, k.stole, 0.07, 1.02 * s, 0.215));
      break;
    }
    case "auctioneer": {
      // the handbell in the right hand, swung; the board on its easel beside him
      const bell = new THREE.Group();
      bell.position.set(-0.3, 1.2 * s, 0.18);
      bell.add(cyl(0.012, 0.012, 0.14, k.wood, 0, 0.1, 0, 5));
      bell.add(cyl(0.035, 0.07, 0.09, k.brass, 0, 0, 0, 8));
      root.add(bell);
      parts.bell = bell;
      const board = new THREE.Group();
      board.position.set(0.75, 0, 0.35);
      board.rotation.y = -0.5;
      board.add(box(0.04, 1.3, 0.04, k.wood, -0.25, 0.65, 0));
      board.add(box(0.04, 1.3, 0.04, k.wood, 0.25, 0.65, 0));
      board.add(box(0.6, 0.45, 0.03, k.slate, 0, 1.05, 0.03));
      for (let i = 0; i < 3; i++) board.add(box(0.36 - i * 0.08, 0.02, 0.01, k.chalk, -0.05, 1.18 - i * 0.1, 0.05));
      root.add(board);
      break;
    }
    case "speaker": {
      root.add(topHat(k, top));
      const paper = box(0.2, 0.26, 0.01, k.paper, -0.18, 1.25 * s, 0.3);
      paper.rotation.x = -0.5;
      root.add(paper);
      parts.paper = paper;
      break;
    }
    case "drunkard": {
      const bottle = new THREE.Group();
      bottle.position.set(-0.26, 0.92 * s, 0.1);
      bottle.add(cyl(0.035, 0.035, 0.2, k.bottle, 0, 0, 0, 6));
      bottle.add(cyl(0.012, 0.03, 0.08, k.bottle, 0, 0.13, 0, 6));
      root.add(bottle);
      parts.bottle = bottle;
      break;
    }
    case "pickpocket": {
      // a flat cap pulled low; the purse shows in his hand once it is his
      root.add(cyl(0.12, 0.12, 0.05, k.cap, 0, top - 0.01, -0.01, 8));
      root.add(box(0.16, 0.012, 0.08, k.cap, 0, top - 0.035, 0.11));
      const purse = box(0.09, 0.07, 0.04, k.purse, -0.25, 0.95 * s, 0.14);
      purse.visible = false;
      root.add(purse);
      parts.purse = purse;
      break;
    }
    case "widow": {
      root.add(veil(k.black, top, 0.9 * s));
      root.add(box(0.1, 0.1, 0.01, k.blossom, 0.12, 1.08 * s, 0.24)); // a handkerchief
      break;
    }
    case "bearers": {
      // a black band round the left arm (the coffin itself is carried between them: coffinMesh)
      root.add(cyl(0.065, 0.065, 0.08, k.black, 0.24, 1.3 * s, 0, 8));
      break;
    }
    case "hawker": {
      // a tray on a strap round the neck, with small wares on it
      const tray = new THREE.Group();
      tray.position.set(0, 1.0 * s, 0.32);
      tray.add(box(0.52, 0.03, 0.3, k.wood, 0, 0, 0));
      tray.add(box(0.52, 0.06, 0.02, k.wood, 0, 0.03, 0.15));
      for (let i = 0; i < 6; i++) tray.add(box(0.07, 0.05, 0.07, i % 2 ? k.goods : k.goods2, -0.19 + (i % 3) * 0.19, 0.04, -0.07 + Math.floor(i / 3) * 0.13));
      root.add(tray);
      root.add(box(0.03, 0.02, 0.36, k.strap, -0.14, 1.28 * s, 0.14)).rotation.x = 0.8;
      root.add(box(0.03, 0.02, 0.36, k.strap, 0.14, 1.28 * s, 0.14)).rotation.x = 0.8;
      break;
    }
    case "showman": {
      root.add(topHat(k, top));
      // a monkey in a red cap on his right shoulder, its tail down his back
      const monkey = new THREE.Group();
      monkey.position.set(-0.2, 1.46 * s, -0.02);
      monkey.userData.y = 1.46 * s;
      monkey.add(box(0.11, 0.15, 0.1, k.fur, 0, 0.08, 0));
      const head = new THREE.Group();
      head.position.set(0, 0.2, 0.02);
      head.add(tuft(0.06, k.fur, 0, 0, 0));
      head.add(box(0.06, 0.04, 0.02, k.face, 0, -0.01, 0.05));
      head.add(cyl(0.028, 0.032, 0.04, k.fez, 0, 0.06, 0, 6));
      monkey.add(head);
      const tail = box(0.02, 0.3, 0.02, k.fur, 0.02, -0.08, -0.08);
      tail.rotation.x = 0.4;
      monkey.add(tail);
      root.add(monkey);
      parts.monkey = monkey;
      parts.monkeyHead = head;
      break;
    }
  }
  return { role, root, parts, phase: Math.random() * 6 };
}

/** Play: the bell swings, the monkey looks about, the drunk's bottle comes up now and then. */
export function playWear(w: Wear, t: number): void {
  const p = t + w.phase;
  if (w.parts.bell) w.parts.bell.rotation.z = Math.sin(p * 9) * 0.6 * (Math.sin(p * 0.7) > 0 ? 1 : 0.1);
  if (w.parts.monkeyHead) w.parts.monkeyHead.rotation.y = Math.sin(p * 1.3) * 0.9;
  if (w.parts.monkey) w.parts.monkey.position.y = (w.parts.monkey.userData.y as number) + Math.max(0, Math.sin(p * 3)) * 0.03;
  if (w.parts.bottle) w.parts.bottle.rotation.x = Math.max(0, Math.sin(p * 0.5)) > 0.95 ? -1.6 : 0;
}

/** The coffin with its black pall, carried on the bearers' shoulders (placed in world space). */
export function makeCoffin(): THREE.Group {
  const k = m();
  const g = new THREE.Group();
  g.name = "coffin";
  g.add(box(0.5, 0.36, 1.9, k.coffin, 0, 0, 0));
  g.add(box(0.62, 0.04, 2.0, k.pall, 0, 0.2, 0));
  g.add(box(0.64, 0.24, 0.02, k.pall, 0, 0.08, 1.0));
  g.add(box(0.64, 0.24, 0.02, k.pall, 0, 0.08, -1.0));
  g.add(box(0.08, 0.01, 0.4, k.cross, 0, 0.225, 0.1));
  g.add(box(0.26, 0.01, 0.08, k.cross, 0, 0.225, 0.2));
  return g;
}

export const WARDROBE_ROLES = new Set<string>(["bride", "groom", "priest", "auctioneer", "speaker", "drunkard", "pickpocket", "widow", "bearers", "hawker", "showman"]);
