import * as THREE from "three";
import { psx } from "../retro/psx";
import type { ShopTrade } from "../../../shared/shops";

// M7 shops (docs/milestones/M7-shops.md): what a shopkeeper holds behind his counter, on his right hand's bone
// (so it goes where the hand goes: the testing rule, "hands hold what they hold"): the baker a loaf, the butcher
// his cleaver, the barber a razor, the roaster his coffee pot, the bookseller a book, the apothecary a bottle ...

const m = (c: number) => psx(new THREE.MeshLambertMaterial({ color: c }), { affine: 0 });
const cache = new Map<string, THREE.Material>();
const mat = (key: string, c: number) => {
  let x = cache.get(key);
  if (!x) cache.set(key, (x = m(c)));
  return x;
};

function box(w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material): THREE.Mesh {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  b.position.set(x, y, z);
  return b;
}

/** The thing, built round the point where the fingers close (y down the arm). Null: nothing in the hand. */
export function shopProp(trade: ShopTrade): THREE.Object3D | null {
  const g = new THREE.Group();
  switch (trade) {
    case "baker": {
      const loaf = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4), mat("sp_loaf", 0x8a5a2a));
      loaf.scale.set(0.9, 0.7, 1.4);
      loaf.position.set(0, -0.05, 0.03);
      g.add(loaf);
      break;
    }
    case "butcher":
      g.add(box(0.025, 0.11, 0.025, 0, 0, 0, mat("sp_wood", 0x4a3020)), box(0.01, 0.1, 0.16, 0, -0.08, 0.06, mat("sp_steel", 0x9a9a98)));
      break;
    case "barber":
      g.add(box(0.015, 0.08, 0.02, 0, 0, 0, mat("sp_horn", 0x2a2018)), box(0.006, 0.02, 0.07, 0, -0.05, 0.03, mat("sp_steel", 0x9a9a98)));
      break;
    case "roaster": {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.16, 8), mat("sp_copper", 0xb0603a));
      pot.position.set(0, -0.1, 0.04);
      g.add(pot, box(0.015, 0.06, 0.04, 0, -0.04, 0, mat("sp_wood", 0x4a3020)));
      break;
    }
    case "bookseller":
    case "printer":
      g.add(box(0.03, 0.2, 0.15, 0, -0.07, 0.03, mat(trade === "printer" ? "sp_paper" : "sp_book", trade === "printer" ? 0xe0d8c0 : 0x5a2a1a)));
      break;
    case "apothecary":
    case "colonial": {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.12, 6), mat(trade === "apothecary" ? "sp_bottle" : "sp_tin", trade === "apothecary" ? 0x2a3a4a : 0x8a2a1a));
      b.position.set(0, -0.06, 0.02);
      g.add(b);
      break;
    }
    case "grocer": {
      const a = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 4), mat("sp_apple", 0x9a3a22));
      a.position.set(0, -0.05, 0.02);
      g.add(a);
      break;
    }
    case "cobbler":
      g.add(box(0.05, 0.14, 0.06, 0, -0.08, 0.02, mat("sp_boot", 0x2a1a12)), box(0.05, 0.05, 0.14, 0, -0.14, 0.06, mat("sp_boot", 0x2a1a12)));
      break;
    case "draper":
      g.add(box(0.04, 0.1, 0.22, 0, -0.06, 0.05, mat("sp_cloth", 0x3a4a5a)));
      break;
    case "tobacconist":
      g.add(box(0.012, 0.012, 0.12, 0, -0.03, 0.05, mat("sp_clay", 0xe0dccf)), box(0.03, 0.04, 0.03, 0, -0.01, 0.11, mat("sp_clay", 0xe0dccf)));
      break;
    case "clockmaker": {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.01, 10), mat("sp_brass", 0xb08a3a));
      w.rotation.x = Math.PI / 2;
      w.position.set(0, -0.05, 0.02);
      g.add(w);
      break;
    }
    case "chandler":
      g.add(box(0.12, 0.03, 0.06, 0, -0.05, 0.04, mat("sp_biscuit", 0xc8a870)));
      break;
    default:
      return null;
  }
  g.name = "shop_prop";
  return g;
}

/** Put the prop on the figure's right hand (the bone carries it from then on). */
export function holdProp(body: THREE.Object3D, prop: THREE.Object3D): boolean {
  const hand = body.getObjectByName("handR");
  if (!hand) return false;
  body.updateWorldMatrix(true, true);
  const at = new THREE.Vector3();
  hand.getWorldPosition(at);
  const q = new THREE.Quaternion();
  body.getWorldQuaternion(q);
  prop.position.copy(at);
  prop.quaternion.copy(q);
  prop.updateMatrixWorld(true);
  hand.attach(prop);
  return true;
}
