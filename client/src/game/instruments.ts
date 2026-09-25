import * as THREE from "three";
import { psx } from "../retro/psx";
import { reachArm } from "./reach";

// Street musicians' instruments (Steve: "people gather for musicians, but no musicians
// visible"). A barrel organ on its handcart (the crank turns), a fiddle under the chin (the
// bow saws), an accordion at the chest (the bellows breathe). Made in code from a few boxes
// and cylinders, in the puppet's own frame (+z is where he faces, +x his left, y up, feet at 0),
// so they go where he goes and leave with him.
//
// Fix 2026-09-25 (docs/testing.md rule 5, "hands hold what they hold"): the hands were wherever
// the talk clip had them. Each instrument now has grips, points that move with it (the crank's
// handle, the fiddle's neck and the bow's frog, the accordion's two ends), and gripInstrument
// brings the wrists there every frame (game/reach.ts). The fiddle sat on the right shoulder: it
// is on the left now, under the chin, the bow in the right hand across the strings.

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
    hair: psx(new THREE.MeshLambertMaterial({ color: 0xd8d0b8 })),
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
  /** Where the wrists go (they move with the instrument), and which way each elbow bends (the body's frame). */
  grips: Partial<Record<"L" | "R", { at: THREE.Object3D; pole: THREE.Vector3 }>>;
  /** The fiddle: the bow's line (the bridge, and the way out to the frog), for playInstrument. */
  bow?: { bridge: THREE.Vector3; out: THREE.Vector3 };
  /** The accordion's two ends, pulled out and pushed in with the bellows. */
  ends?: [THREE.Object3D, THREE.Object3D];
}

const grip = (parent: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D => {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  parent.add(o);
  return o;
};

/** `s`: the player's body height over a 1.74 m man (Human.scale): the heights and reaches follow it. */
export function makeInstrument(kind: InstrumentKind, s = 1): Instrument {
  const k = m();
  const root = new THREE.Group();
  root.name = `instrument_${kind}`;
  let moving: THREE.Object3D;
  const grips: Instrument["grips"] = {};
  let bow: Instrument["bow"];
  let ends: Instrument["ends"];
  if (kind === "organ") {
    // a barrel organ on a two-wheeled handcart close in front of him, its back to him, the crank on
    // his right at the height of his hands, his left hand on the lid
    const cart = new THREE.Group();
    cart.position.set(0, 0, 0.5 * s);
    cart.add(box(0.9, 0.06, 0.46, k.wood, 0, 0.5 * s, 0));
    cart.add(box(0.72, 0.6 * s, 0.4, k.red, 0, 0.85 * s, 0));
    cart.add(box(0.74, 0.05, 0.42, k.gilt, 0, 1.17 * s, 0));
    cart.add(box(0.5, 0.3, 0.02, k.gilt, 0, 0.86 * s, 0.21)); // the pipes' front, to the crowd
    for (const side of [-1, 1]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.05, 10), k.dark);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * 0.48, 0.28, 0);
      cart.add(wheel);
    }
    // the crank: an axle out of the back, an arm, the handle toward him
    const crank = new THREE.Group();
    crank.position.set(-0.2 * s, 1.03 * s, -0.21);
    crank.add(box(0.03, 0.03, 0.05, k.iron, 0, 0, -0.025));
    const R = 0.08 * s;
    crank.add(box(0.025, R + 0.02, 0.02, k.iron, 0, R / 2, -0.05));
    crank.add(box(0.03, 0.03, 0.08, k.wood, 0, R, -0.09));
    cart.add(crank);
    root.add(cart);
    moving = crank;
    grips.R = { at: grip(crank, 0, R, -0.13), pole: new THREE.Vector3(-0.7, -1, -0.3) };
    grips.L = { at: grip(cart, 0.18 * s, 1.21 * s, -0.12), pole: new THREE.Vector3(0.7, -1, -0.3) };
  } else if (kind === "fiddle") {
    // under the chin on his left shoulder, the scroll forward and to the left, a little down
    const chin = new THREE.Vector3(0.04 * s, 1.37 * s, 0.1 * s);
    const along = new THREE.Vector3(0.55, -0.18, 0.8).normalize();
    const fiddle = new THREE.Group();
    fiddle.position.copy(chin);
    fiddle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), along);
    fiddle.rotateZ(-0.45); // the top tilted toward the bow
    const L = s * 0.9;
    fiddle.add(box(0.19 * L, 0.05 * L, 0.34 * L, k.wood, 0, 0, 0.17 * L));
    fiddle.add(box(0.04 * L, 0.03 * L, 0.24 * L, k.dark, 0, 0.02 * L, 0.46 * L)); // the neck
    fiddle.add(box(0.05 * L, 0.05 * L, 0.05 * L, k.dark, 0, 0.02 * L, 0.6 * L)); // the scroll
    root.add(fiddle);
    grips.L = { at: grip(fiddle, 0, -0.03 * L, 0.5 * L), pole: new THREE.Vector3(0.3, -1, 0) };
    // the bow: across the strings by the bridge, square to the fiddle, out to his right and a little down
    const bridge = new THREE.Vector3(0, 0.05 * L, 0.1 * L).applyMatrix4(new THREE.Matrix4().compose(fiddle.position, fiddle.quaternion, new THREE.Vector3(1, 1, 1)));
    const out = new THREE.Vector3().crossVectors(along, new THREE.Vector3(0, 1, 0)).normalize();
    out.y -= 0.35;
    out.normalize();
    const stick = new THREE.Group();
    // the stick runs from the frog (the group's origin, in his hand) back through the bridge to the tip
    const len = 0.62 * s;
    stick.add(box(len, 0.012, 0.012, k.dark, -len / 2, 0.008, 0));
    stick.add(box(len * 0.94, 0.006, 0.02, k.hair, -len / 2, -0.004, 0));
    stick.quaternion.setFromUnitVectors(new THREE.Vector3(-1, 0, 0), out.clone().negate());
    root.add(stick);
    moving = stick;
    bow = { bridge, out };
    grips.R = { at: grip(stick, 0.02, 0, 0), pole: new THREE.Vector3(-1, -0.7, -0.3) };
  } else {
    // at the chest, a hand at each end, the bellows pulled out and pushed in between them
    const acc = new THREE.Group();
    acc.position.set(0, 1.08 * s, 0.27 * s);
    const left = new THREE.Group();
    left.add(box(0.08, 0.3, 0.16, k.dark, 0, 0, 0));
    const right = new THREE.Group();
    right.add(box(0.08, 0.3, 0.16, k.dark, 0, 0, 0));
    acc.add(left, right);
    const bellows = box(0.3, 0.28, 0.14, k.bellows, 0, 0, 0);
    // the folds of the bellows, dark lines round it (they close up and open with it)
    for (let f = -2; f <= 2; f++) bellows.add(box(0.012, 0.29, 0.148, k.dark, f * 0.06, 0, 0));
    acc.add(bellows);
    root.add(acc);
    moving = bellows;
    ends = [left, right];
    grips.L = { at: grip(left, 0.06, 0.02, 0), pole: new THREE.Vector3(1, -0.8, -0.2) };
    grips.R = { at: grip(right, -0.06, 0.02, 0), pole: new THREE.Vector3(-1, -0.8, -0.2) };
  }
  const i: Instrument = { kind, root, moving, phase: Math.random() * 6, grips, bow, ends };
  playInstrument(i, 0);
  return i;
}

/** Play: the crank turns, the bow saws, the bellows breathe (the ends go with them). */
export function playInstrument(i: Instrument, t: number): void {
  const p = t + i.phase;
  if (i.kind === "organ") i.moving.rotation.z = -p * 5;
  else if (i.kind === "fiddle" && i.bow) {
    // the frog from close by the strings out to 0.5 m and back
    const u = 0.3 + Math.sin(p * 4.2) * 0.2;
    i.moving.position.copy(i.bow.bridge).addScaledVector(i.bow.out, u);
  } else if (i.ends) {
    const w = 0.3 * (0.7 + 0.45 * (0.5 + 0.5 * Math.sin(p * 2.1)));
    i.moving.scale.x = w / 0.3;
    i.ends[0].position.x = w / 2 + 0.04;
    i.ends[1].position.x = -w / 2 - 0.04;
  }
}

const AT = new THREE.Vector3();

/** The hands on the instrument: call after the figure's clip has run this frame (and after playInstrument). */
export function gripInstrument(i: Instrument, body: THREE.Object3D): void {
  i.root.updateWorldMatrix(true, true);
  for (const side of ["L", "R"] as const) {
    const g = i.grips[side];
    if (!g) continue;
    g.at.getWorldPosition(AT);
    reachArm(body, side, AT, g.pole);
  }
}

export const INSTRUMENTS: InstrumentKind[] = ["organ", "fiddle", "accordion"];
