import * as THREE from "three";
import { psx } from "../retro/psx";

// The bier of a requiem (M7 funeral), built in code: a low catafalque of two trestles under a black
// pall that falls to the floor, on a step, with four tall wooden candlesticks at its corners, each
// with a thick wax candle and a small flame. The coffin (game/wardrobe.ts makeCoffin) is set on it by
// the bearers. Local frame: the coffin lies along z, the bier's top centre at (0, TOP, 0).

/** Height of the pall's top: the coffin's underside rests here. */
export const BIER_TOP = 0.62;

let mats: Record<string, THREE.Material> | null = null;
function m(): Record<string, THREE.Material> {
  mats ??= {
    pall: psx(new THREE.MeshLambertMaterial({ color: 0x131115, emissive: 0x050406 })),
    trim: psx(new THREE.MeshLambertMaterial({ color: 0xb8b0a0, emissive: 0x1c1a16 })),
    wood: psx(new THREE.MeshLambertMaterial({ color: 0x3a2618 })),
    wax: psx(new THREE.MeshLambertMaterial({ color: 0xece2c8, emissive: 0x3a3226 })),
    flame: new THREE.MeshBasicMaterial({ color: 0xffc860 }),
    step: psx(new THREE.MeshLambertMaterial({ color: 0x242024 })),
  };
  return mats;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  o.position.set(x, y, z);
  return o;
}

export interface Bier {
  group: THREE.Group;
  /** The flames flicker a little. */
  update(t: number): void;
  dispose(): void;
}

export function makeBier(): Bier {
  const k = m();
  const g = new THREE.Group();
  g.name = "bier";
  g.add(box(1.5, 0.08, 2.9, k.step, 0, 0.04, 0));
  // the pall over the trestles, falling to the step, with a pale border and a pale cross on each side
  g.add(box(0.78, BIER_TOP - 0.08, 2.2, k.pall, 0, 0.08 + (BIER_TOP - 0.08) / 2, 0));
  g.add(box(0.8, 0.03, 2.22, k.trim, 0, BIER_TOP - 0.05, 0));
  for (const side of [-1, 1]) {
    g.add(box(0.01, 0.3, 0.05, k.trim, side * 0.395, 0.34, 0));
    g.add(box(0.01, 0.05, 0.22, k.trim, side * 0.395, 0.4, 0));
  }
  // four tall candlesticks at the corners
  const flames: THREE.Mesh[] = [];
  for (const [x, z] of [[-0.66, -1.35], [0.66, -1.35], [-0.66, 1.35], [0.66, 1.35]] as const) {
    g.add(box(0.26, 0.06, 0.26, k.wood, x, 0.11, z));
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.15, 6), k.wood);
    shaft.position.set(x, 0.7, z);
    g.add(shaft);
    g.add(box(0.14, 0.03, 0.14, k.wood, x, 1.29, z));
    const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.34, 6), k.wax);
    candle.position.set(x, 1.47, z);
    g.add(candle);
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.07, 5), k.flame);
    f.position.set(x, 1.68, z);
    g.add(f);
    flames.push(f);
  }
  return {
    group: g,
    update(t) {
      flames.forEach((f, i) => (f.scale.y = 0.85 + 0.25 * Math.abs(Math.sin(t * 7.3 + i * 1.7))));
    },
    dispose() {
      g.removeFromParent();
      g.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    },
  };
}
