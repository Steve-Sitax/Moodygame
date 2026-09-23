import * as THREE from "three";
import { psx } from "../retro/psx";
import { box, cyl } from "../world/geom";
import type { Mats } from "../world/rijnkaai";

// Job goods. Claude picks one of these names; the game builds the prop.
// Placeholders until the Blender kit (docs/05).

export type Goods = "crates" | "sacks" | "barrels" | "hides" | "rope" | "parcel";

interface GoodsInfo {
  /** One item, for text: "lift the crate". */
  one: string;
  /** Height when stacked. */
  h: number;
  /** Walking speed factor while carrying one. */
  speed: number;
  /** Which set-down sound. */
  thud: "wood" | "soft" | "plank";
  /** Where it sits in front of the camera while carried. */
  hold: [number, number, number];
  /** Text when the goods break open (broken_goods twist). */
  broken: string;
}

export const GOODS: Record<Goods, GoodsInfo> = {
  crates: {
    one: "crate",
    h: 0.7,
    speed: 0.62,
    thud: "wood",
    hold: [0, -0.72, -0.86],
    broken: "The crate splits along a seam. Coffee beans rattle out onto the stones.",
  },
  sacks: {
    one: "sack",
    h: 0.4,
    speed: 0.6,
    thud: "soft",
    hold: [0, -0.62, -0.8],
    broken: "A seam gives. Grain runs out of the sack in a thin stream.",
  },
  barrels: {
    one: "barrel",
    h: 0.9,
    speed: 0.55,
    thud: "wood",
    hold: [0, -0.8, -0.85],
    broken: "A stave cracks. It smells sharp and sweet: jenever, leaking into your sleeve.",
  },
  hides: {
    one: "bundle of hides",
    h: 0.28,
    speed: 0.66,
    thud: "soft",
    hold: [0, -0.6, -0.8],
    broken: "The cord snaps. One of the hides is fine soft leather, the kind a man could sell.",
  },
  rope: {
    one: "coil of rope",
    h: 0.3,
    speed: 0.75,
    thud: "soft",
    hold: [0, -0.62, -0.78],
    broken: "The coil comes loose. Nobody would miss a length of good tarred rope.",
  },
  parcel: {
    one: "parcel",
    h: 0.3,
    speed: 0.95,
    thud: "plank",
    hold: [0.18, -0.5, -0.62],
    broken: "The paper tears. Inside, something wrapped in oilcloth, heavier than it looks.",
  },
};

let extra: { hides: THREE.Material; parcel: THREE.Material } | null = null;

export function makeGoods(kind: Goods, m: Mats): THREE.Object3D {
  extra ??= {
    hides: psx(new THREE.MeshLambertMaterial({ map: (m.sack as THREE.MeshLambertMaterial).map, color: 0x6a4a34 })),
    parcel: psx(new THREE.MeshLambertMaterial({ map: (m.sack as THREE.MeshLambertMaterial).map, color: 0xb8a888 })),
  };
  const g = new THREE.Group();
  switch (kind) {
    case "crates":
      g.add(box(0.7, 0.7, 0.7, m.crate, 0, 0.35, 0, 0.7));
      break;
    case "sacks": {
      const s = box(0.8, 0.4, 0.5, m.sack, 0, 0.2, 0, 0.8);
      s.scale.set(1, 1, 1);
      g.add(s);
      g.add(box(0.12, 0.3, 0.3, m.sack, 0.44, 0.2, 0, 0.3)); // tied end
      break;
    }
    case "barrels":
      g.add(cyl(0.3, 0.3, 0.9, 8, m.darkWood, 0, 0.45, 0));
      g.add(cyl(0.335, 0.335, 0.06, 8, m.ironDecal, 0, 0.18, 0));
      g.add(cyl(0.335, 0.335, 0.06, 8, m.ironDecal, 0, 0.72, 0));
      break;
    case "hides":
      g.add(box(0.9, 0.28, 0.7, extra.hides, 0, 0.14, 0, 0.9));
      g.add(box(0.06, 0.3, 0.72, m.rope, 0.2, 0.14, 0, 0.3));
      break;
    case "rope":
      for (let i = 0; i < 3; i++) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(0.32 - i * 0.03, 0.06, 4, 8), m.rope);
        t.rotation.x = Math.PI / 2;
        t.position.y = 0.06 + i * 0.1;
        g.add(t);
      }
      break;
    case "parcel":
      g.add(box(0.45, 0.3, 0.35, extra.parcel, 0, 0.15, 0, 0.45));
      g.add(box(0.47, 0.02, 0.04, m.rope, 0, 0.3, 0, 0.3));
      break;
  }
  return g;
}
