import * as THREE from "three";
import { psx } from "../retro/psx";

// Street musicians' instruments (Steve: "people gather for musicians, but no musicians
// visible"). A barrel organ on its handcart (the crank turns), a fiddle under the chin (the
// bow saws), an accordion at the chest (the bellows breathe). Made in code from a few boxes
// and cylinders, in the puppet's own frame (+z is where he faces, y up, feet at 0), so
// they go where he goes and leave with him.

export type InstrumentKind = "organ" | "fiddle" | "accordion";

let mats: Record<string, THREE.Material> | null = null;
function m(): Record<string, THREE.Material> {
  mats ??= {
    wood: psx(new THREE.MeshLambertMaterial({ color: 0x6a3f22 })),
    dark: psx(new THREE.MeshLambertMaterial({ color: 0x2a1c14 })),
    red: psx(new THREE.MeshLambertMaterial({ color: 0x8a2a24 })),
    gilt: psx(new THREE.MeshLambertMaterial({ color: 0xb89a4a })),
    iron: psx(new THREE.MeshLambertMaterial({ color: 0x3a3a3c })),
    bellows: psx(new THREE.MeshLambertMaterial({ color: 0xd8cfb8 })),
  };
  return mats;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  o.position.set(x, y, z);
  return o;
}

export interface Instrument {
  kind: InstrumentKind;
  root: THREE.Group;
  /** The part that moves: the crank, the bow, the bellows. */
  moving: THREE.Object3D;
  phase: number;
}

export function makeInstrument(kind: InstrumentKind): Instrument {
  const k = m();
  const root = new THREE.Group();
  root.name = `instrument_${kind}`;
  let moving: THREE.Object3D;
  if (kind === "organ") {
    // a barrel organ on a two-wheeled handcart in front of him, its painted front toward the crowd
    const cart = new THREE.Group();
    cart.position.set(0, 0, 0.75);
    cart.add(box(0.9, 0.06, 0.55, k.wood, 0, 0.5, 0));
    cart.add(box(0.72, 0.5, 0.42, k.red, 0, 0.8, 0));
    cart.add(box(0.74, 0.06, 0.44, k.gilt, 0, 1.07, 0));
    cart.add(box(0.5, 0.26, 0.02, k.gilt, 0, 0.82, 0.22)); // the pipes' front
    for (const s of [-1, 1]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.05, 10), k.dark);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(s * 0.48, 0.28, 0);
      cart.add(wheel);
    }
    cart.add(box(0.05, 0.05, 0.6, k.dark, 0.35, 0.5, -0.5)); // the shafts back to him
    cart.add(box(0.05, 0.05, 0.6, k.dark, -0.35, 0.5, -0.5));
    // the crank on his side of the case, turning
    const crank = new THREE.Group();
    crank.position.set(0.38, 0.85, -0.12);
    crank.add(box(0.03, 0.03, 0.2, k.iron, 0, 0, -0.1));
    crank.add(box(0.03, 0.12, 0.03, k.iron, 0, 0.06, -0.2));
    cart.add(crank);
    root.add(cart);
    moving = crank;
  } else if (kind === "fiddle") {
    // under the chin on his left shoulder, the bow in the right hand
    const fiddle = new THREE.Group();
    fiddle.position.set(-0.12, 1.42, 0.22);
    fiddle.rotation.set(0.25, 0.5, 0.35);
    fiddle.add(box(0.2, 0.05, 0.34, k.wood, 0, 0, 0));
    fiddle.add(box(0.04, 0.03, 0.26, k.dark, 0, 0.02, 0.28));
    root.add(fiddle);
    const bow = new THREE.Group();
    bow.position.set(0.12, 1.36, 0.28);
    bow.add(box(0.6, 0.012, 0.012, k.dark, -0.1, 0, 0));
    root.add(bow);
    moving = bow;
  } else {
    // at the chest, both hands on it, the bellows pulled in and out
    const acc = new THREE.Group();
    acc.position.set(0, 1.12, 0.26);
    acc.add(box(0.1, 0.3, 0.16, k.dark, -0.2, 0, 0));
    acc.add(box(0.1, 0.3, 0.16, k.dark, 0.2, 0, 0));
    const bellows = box(0.3, 0.28, 0.14, k.bellows, 0, 0, 0);
    acc.add(bellows);
    root.add(acc);
    moving = bellows;
  }
  return { kind, root, moving, phase: Math.random() * 6 };
}

/** Play: the crank turns, the bow saws, the bellows breathe. */
export function playInstrument(i: Instrument, t: number): void {
  const p = t + i.phase;
  if (i.kind === "organ") i.moving.rotation.x = p * 5;
  else if (i.kind === "fiddle") i.moving.position.x = 0.12 + Math.sin(p * 4.2) * 0.14;
  else i.moving.scale.x = 0.7 + 0.45 * (0.5 + 0.5 * Math.sin(p * 2.1));
}

export const INSTRUMENTS: InstrumentKind[] = ["organ", "fiddle", "accordion"];
