import * as THREE from "three";
import { psx } from "../retro/psx";
import { rectAround, type Rect } from "./geom";
import { Geo, WORLD, frameAt, tideCuts, tideShade, type QuaySteps } from "./quaysteps";
import { LW_MIN, MHW, MLW } from "./tide";

// The timber jetty on the Rijnkaai (x 5..9, out to z -12), as in the 1870s photos:
// a deck of loose planks on stringers and cap beams, rows of round piles with
// cross-bracing, green slime and barnacles at the waterline, a low rail along the
// sides, mooring posts and fender piles at the head, and an iron ladder down to
// the water. The deck is level with the quay and runs in under the edge stones,
// so there is no gap against the wall (Steve, 2026-09-23).

export interface Pier {
  /** Things you walk into on the deck (rails, posts, bollard). */
  colliders: Rect[];
  /** Piles and posts in the water: they stop a swimmer. */
  piles: Rect[];
}

const X0 = 5.0;
const X1 = 9.0;
const Z_HEAD = -12.0;
const PLANK = 0.26;
const GAP = 0.03;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildPier(scene: THREE.Object3D, waterY: number, planks: THREE.Texture, steps: QuaySteps): Pier {
  const r = rng(1873);
  // M6 tides: the piles stand in the mud below the lowest spring tide, slimy up to the high-water mark
  const bed = LW_MIN - 1.6;
  const cuts = tideCuts();
  const deck = new Geo(() => [0.72, 0.7, 0.66], 1.5);
  const wood = new Geo(tideShade([0.5, 0.46, 0.42]), 1.5, cuts);
  const shells = new Geo(() => [0.78, 0.78, 0.72], 1);
  const colliders: Rect[] = [];
  const piles: Rect[] = [];
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // --- deck planks, laid across; the first one runs in under the edge stones of the quay
  for (let z = 0.12; z - PLANK > Z_HEAD - 0.001; z -= PLANK + GAP) {
    const worn = r();
    const tint: [number, number, number] =
      worn < 0.14 ? [0.62, 0.6, 0.58] : worn > 0.9 ? [1.15, 1.1, 1.02] : [0.88 + r() * 0.2, 0.86 + r() * 0.18, 0.84 + r() * 0.16];
    const a = X0 - 0.06 + r() * 0.08;
    const b = X1 + 0.02 - r() * 0.08;
    const z1 = Math.max(z - PLANK, Z_HEAD);
    deck.box(WORLD, a, b, z1, z, -0.07, 0, tint);
  }
  // --- stringers along the pier, cap beams across on every row of piles
  for (const x of [5.3, 6.45, 7.55, 8.7]) wood.box(WORLD, x - 0.09, x + 0.09, Z_HEAD, 0.1, -0.3, -0.07, [1.1, 1.05, 1]);
  const bents = [-0.9, -3.65, -6.4, -9.15, -11.8];
  const pileX = [5.2, 6.4, 7.6, 8.8];
  const capLo = -0.56;
  for (const z of bents) {
    wood.box(WORLD, X0 - 0.15, X1 + 0.15, z - 0.16, z + 0.16, capLo, -0.3, [1.05, 1, 0.95]);
    // round piles, driven into the river bed
    for (const x of pileX) {
      wood.rod(V(x, bed, z), V(x, capLo, z), 0.14 + r() * 0.03, 7, 12);
      piles.push(rectAround(x, z, 0.2, 0.2));
      // barnacles and mussels between the tide marks
      for (let k = 0; k < 9; k++) {
        const a = r() * Math.PI * 2;
        const y = MLW + r() * (MHW - 0.4 - MLW);
        const px = x + Math.cos(a) * 0.15;
        const pz = z + Math.sin(a) * 0.15;
        shells.box(WORLD, px - 0.03, px + 0.03, pz - 0.03, pz + 0.03, y, y + 0.04 + r() * 0.03);
      }
    }
    // cross-bracing in the row, above the water
    wood.rod(V(pileX[0], capLo - 0.1, z + 0.17), V(pileX[3], waterY + 0.35, z + 0.17), 0.07, 5);
    wood.rod(V(pileX[3], capLo - 0.1, z - 0.17), V(pileX[0], waterY + 0.35, z - 0.17), 0.07, 5);
  }
  // bracing along both sides, bay by bay
  for (let i = 0; i < bents.length - 1; i++) {
    const za = bents[i];
    const zb = bents[i + 1];
    for (const x of [pileX[0] - 0.17, pileX[3] + 0.17]) {
      if (i % 2 === 0) wood.rod(V(x, capLo - 0.1, za), V(x, waterY + 0.35, zb), 0.065, 5);
      else wood.rod(V(x, waterY + 0.35, za), V(x, capLo - 0.1, zb), 0.065, 5);
    }
  }
  // a rubbing strake along each side, where the lighters lie
  for (const x of [X0 - 0.2, X1 + 0.2]) wood.box(WORLD, x - 0.09, x + 0.09, Z_HEAD + 0.2, -0.6, waterY + 0.55, waterY + 0.8, [1.1, 1.05, 1]);
  // fender piles at the head, standing proud of the deck
  for (const x of [5.75, 8.25]) {
    wood.rod(V(x, bed, Z_HEAD - 0.2), V(x, 0.35, Z_HEAD - 0.2), 0.15, 7, 12);
    piles.push(rectAround(x, Z_HEAD - 0.2, 0.2, 0.2));
  }
  // two mooring posts at the head corners, capped
  for (const x of [5.2, 8.8]) {
    wood.rod(V(x, bed, Z_HEAD + 0.25), V(x, 0.95, Z_HEAD + 0.25), 0.2, 8, 12, [1.1, 1.05, 1]);
    wood.box(WORLD, x - 0.22, x + 0.22, Z_HEAD + 0.03, Z_HEAD + 0.47, 0.95, 1.02, [0.8, 0.78, 0.74]);
    colliders.push(rectAround(x, Z_HEAD + 0.25, 0.24, 0.24));
    piles.push(rectAround(x, Z_HEAD + 0.25, 0.24, 0.24));
  }
  // a low rail along both sides: posts, a kerb and a top rail
  for (const [x, side] of [[X0 + 0.08, -1], [X1 - 0.08, 1]] as const) {
    const zs: number[] = [];
    for (let z = -0.45; z > Z_HEAD + 0.6; z -= 1.45) zs.push(z);
    for (const z of zs) wood.box(WORLD, x - 0.06, x + 0.06, z - 0.06, z + 0.06, 0, 0.92, [1.05, 1, 0.95]);
    wood.box(WORLD, x - 0.07, x + 0.07, Z_HEAD + 0.5, -0.3, 0, 0.12, [0.9, 0.88, 0.85]); // kerb
    wood.box(WORLD, x - 0.05 + side * 0.01, x + 0.05 + side * 0.01, Z_HEAD + 0.5, -0.3, 0.88, 0.97, [1.1, 1.05, 1]); // top rail
    colliders.push({ minX: x - 0.09, maxX: x + 0.09, minZ: Z_HEAD + 0.45, maxZ: -0.25 });
  }

  const planksMat = psx(new THREE.MeshLambertMaterial({ map: planks, vertexColors: true }), { affine: 0.4 });
  const woodMat = psx(new THREE.MeshLambertMaterial({ map: planks, vertexColors: true }), { affine: 0.3 });
  const shellMat = psx(new THREE.MeshLambertMaterial({ color: 0xc8c4b4, vertexColors: true }));
  for (const [g, m, name] of [[deck, planksMat, "pier_deck"], [wood, woodMat, "pier_timber"], [shells, shellMat, "pier_barnacles"]] as const) {
    const mesh = new THREE.Mesh(g.build(), m);
    mesh.name = name;
    scene.add(mesh);
  }

  // an iron bollard on the deck, and the ladder down from the head to the water
  steps.addLadder(frameAt(7.0, Z_HEAD, 1, 0, 0, -1), 0, 0, 0.9);
  return { colliders, piles };
}

/** The cast-iron bollard on the pier deck (drawn with the quay's own bollards in rijnkaai.ts). */
export const PIER_BOLLARD = { x: 8.35, z: -5.6 };
