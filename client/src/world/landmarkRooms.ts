import * as THREE from "three";
import type { LandmarkId } from "../../../shared/landmarks";
import { canvasTex, flicker, frameRoom, type Room, type Seat, type Spot } from "./rooms";
import { glowTexture } from "./textures";
import {
  ashlar,
  Flames,
  glass,
  Kit,
  lightShaft,
  lmBasic,
  lmMat,
  marble,
  matOf,
  painting,
  pointedProfile,
  shaftMaterial,
  slabs,
  whitewash,
  type MatDef,
  type Rect,
} from "./landmarkKit";
import { tex } from "./rooms";
import * as P from "../../../shared/cathedralPlan";

// The landmark halls (M6 landmark interiors), built in code in the PS1 way (world/landmarkKit.ts):
// the cathedral here; the town hall, the Vleeshuis, the Steen and the Oostershuis in
// world/landmarkHalls.ts. Each is a room of the interiors (game/interiors.ts): its frame has
// the door at the origin, x across, z into the building. Nothing here is the server's: who is
// inside and what goes on comes from the town (game/landmarks.ts).

export interface Mark extends Spot {
  /** Floor height there (a loft, a stage, upstairs). */
  y?: number;
}

/** Something to look at or use: E near it (the paintings, a case, the register). */
export interface Lookable {
  id: string;
  x: number;
  z: number;
  r: number;
  label: string;
  text: string;
  /** M7 halls: its storey's floor (local y); only there (a hall in the world has floors over each other). */
  y?: number;
}

export interface LandmarkRoom extends Room {
  landmark: LandmarkId;
  /** Named places people go to (the altar, the pulpit, a desk, the stage). */
  marks: Record<string, Mark>;
  /** Named lists of places (the chairs, the benches, the cases, the barrel racks). */
  sets: Record<string, Mark[]>;
  /** Things to look at. */
  looks: Lookable[];
  /** Where Jef comes in by each door, and where E takes him out by it. */
  entries: Record<string, Spot>;
  exits: Record<string, Spot>;
  /** A way on foot between two points of the room (round the pillars, chairs and cases). */
  path(from: [number, number], to: [number, number]): Array<[number, number]>;
  /** The service's look: the altar candles lit, and so on (the cathedral). */
  setLit?(on: boolean): void;
  /** Daylight at the glass (0 night .. 1 noon) and how much of it the weather lets through (1 clear .. about 0.5 storm). */
  setDaylight(k: number, sky?: number): void;
  /** M7 in the world: the hall's own ambient light scaled (the eye coming in from the bright square). */
  setAmbient?(k: number): void;
  /** M7 halls: how brightly its windows glow to the street at night (0 dark .. 1: the theatre plays). */
  nightGlow?(): number;
  /** A candle lit at the Lady altar (the cathedral). */
  addCandle?(): void;
  /** Per-room moving things (the Vleeshuis's rolling barrels, the Oostershuis's hoist). */
  animate?(t: number, dt: number): void;
  /** The floor under people walking (the choir's steps); halls of more storeys walk them on the ground. */
  peopleFloor?(x: number, z: number): number;
  /** Storeys and stairs (world/landmarkKit.ts Levels), if the hall has more than one. */
  levels?: { reset(level?: number): void; level: number };
}

// ---------------------------------------------------------------- the way on foot

/** A graph of floor points joined where a body can walk straight (built once per room). */
export function walkGraph(nodes: Array<[number, number]>, free: (x: number, z: number) => boolean, maxLink = 32) {
  const clear = (a: [number, number], b: [number, number]) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(L / 0.3));
    for (let i = 1; i < n; i++) if (!free(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n)) return false;
    return true;
  };
  const adj: Array<Array<[number, number]>> = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const d = Math.hypot(nodes[i][0] - nodes[j][0], nodes[i][1] - nodes[j][1]);
      if (d <= maxLink && clear(nodes[i], nodes[j])) {
        adj[i].push([j, d]);
        adj[j].push([i, d]);
      }
    }
  const nearestSeen = (p: [number, number]) => {
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const d = Math.hypot(nodes[i][0] - p[0], nodes[i][1] - p[1]);
      if (d < bd && (d < 0.5 || clear(p, nodes[i]))) [best, bd] = [i, d];
    }
    if (best < 0)
      for (let i = 0; i < nodes.length; i++) {
        const d = Math.hypot(nodes[i][0] - p[0], nodes[i][1] - p[1]);
        if (d < bd) [best, bd] = [i, d];
      }
    return best;
  };
  return (from: [number, number], to: [number, number]): Array<[number, number]> => {
    if (clear(from, to)) return [to];
    const s = nearestSeen(from);
    const t = nearestSeen(to);
    const dist = nodes.map(() => Infinity);
    const prev = nodes.map(() => -1);
    const done = nodes.map(() => false);
    dist[s] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || u === t) break;
      done[u] = true;
      for (const [v, w] of adj[u]) if (dist[u] + w < dist[v]) [dist[v], prev[v]] = [dist[u] + w, u];
    }
    const out: Array<[number, number]> = [];
    for (let k = t; k >= 0; k = prev[k]) out.unshift(nodes[k]);
    out.push(to);
    // drop a first node that lies behind (straight on to the next one if we can)
    while (out.length > 1 && clear(from, out[1])) out.shift();
    return out;
  };
}

/** Floors and blocks for people (they may walk where Jef may not: through the choir's gate). */
export function freeFn(floors: Rect[], solids: Rect[], r = 0.25): (x: number, z: number) => boolean {
  return (x, z) => floors.some((f) => x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ) && !solids.some((b) => x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r);
}

// ---------------------------------------------------------------- materials

export const M = {
  stone: lmMat("lm_stone", { map: ashlar(1), color: 0xd8ccb4 }, 0.1),
  stoneDark: lmMat("lm_stone_dark", { map: ashlar(2, [120, 112, 100]), color: 0xb0a898 }, 0.1),
  vault: lmMat("lm_vault", { map: whitewash(3), color: 0xd8d0bc, side: THREE.DoubleSide }, 0.05),
  floor: lmMat("lm_slabs", { map: slabs(2), color: 0xe0dcd4 }, 0.1),
  oak: lmMat("lm_oak", { map: tex().planks, color: 0x6a4a30 }, 0.2),
  oakDark: lmMat("lm_oak_dark", { map: tex().planks, color: 0x5e4028 }, 0.2),
  rush: lmMat("lm_rush", { map: tex().sack, color: 0xb09a60 }, 0.2),
  marbleW: lmMat("lm_marble_w", { map: marble(false), color: 0xe8e4dc }, 0.1),
  marbleB: lmMat("lm_marble_b", { map: marble(true), color: 0x9a9a9a }, 0.1),
  gilt: lmMat("lm_gilt", { color: 0xb08a3a, emissive: 0x2a1a04 }),
  linen: lmMat("lm_linen", { color: 0xe8e2d0 }),
  red: lmMat("lm_red", { color: 0x7a1a14 }),
  iron: lmMat("lm_iron", { color: 0x26221e }),
  brass: lmMat("lm_brass", { color: 0x9a7a3a, emissive: 0x1a1004 }),
  wax: lmBasic("lm_wax", { color: 0xe8e0c8 }),
  tin: lmMat("lm_tin", { color: 0xa8a8a8, emissive: 0x101010 }),
  statue: lmMat("lm_statue", { color: 0xd8ccb0 }),
  blue: lmMat("lm_blue", { color: 0x2a3a6a }),
  black: lmMat("lm_black", { color: 0x141210 }),
};

export const glassMat = (kind: "colour" | "grisaille", seed: number): { def: MatDef; mat: () => THREE.MeshBasicMaterial } => {
  const def = lmBasic(`lm_glass_${kind}_${seed}`, { map: glass(kind, seed), color: 0x606060, side: THREE.DoubleSide, fog: false });
  return { def, mat: () => matOf(def) as THREE.MeshBasicMaterial };
};
/** A painting: dark, but it reads in the gloom (a faint glow of its own, as varnish catches the candles). */
export const paintMat = (kind: Parameters<typeof painting>[0], seed = 1) => lmMat(`lm_paint_${kind}_${seed}`, { map: painting(kind, seed), emissiveMap: painting(kind, seed), emissive: 0x6a5a48, color: 0xc8c0b0 }, 0);

/** A ladder-back chair's back: two uprights and three rails, the gaps see-through. */
const chairBack = lmMat(
  "lm_chairback",
  {
    map: canvasTex(16, 32, (g) => {
      g.clearRect(0, 0, 16, 32);
      g.fillStyle = "#8a6440";
      g.fillRect(0, 0, 3, 32);
      g.fillRect(13, 0, 3, 32);
      for (const y of [1, 9, 17]) g.fillRect(0, y, 16, 4);
    }, false),
    color: 0xb08a60,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  },
  0,
);

// ---------------------------------------------------------------- the cathedral

/**
 * Onze-Lieve-Vrouwekathedraal as it stood in 1873, standing in the world inside its Blender shell
 * (M7: the plan is shared/cathedralPlan.ts; the frame is the shell's, the floor 0.3 m over the
 * square). A nave 12 m wide and 28.5 m high under a pointed vault, three aisles either side on
 * clustered piers (the outer ones start behind the towers), the transept with Rubens's two great
 * triptychs on the east walls of its arms (the Elevation of the Cross on the north, the Descent
 * from the Cross on the south), the raised choir behind the marble communion rail with the high
 * altar and Rubens's Assumption in the five-sided apse, the ambulatory round it. Rush chairs (let
 * at mass by the chair woman) in rows in the nave; Van der Voort's carved oak pulpit of 1713 on a
 * pier; baroque confessionals along the aisle walls; the Lady altar with its stand of candles; the
 * organ's case of 1657 on the west gallery over the door; the west door open by day between its
 * jambs, the side portals and the transept portals shut where the shell has them; clear and
 * coloured glass, light falling through in the day. Paintings are dark shapes painted in code,
 * never copies.
 */
export function buildCathedral(opts: { origin: { x: number; z: number }; yaw: number }): LandmarkRoom {
  const { scene, group, toWorld } = frameRoom(opts.origin, opts.yaw, 0x1a1712);
  // in the world the hall is drawn over the street (world/inworld.ts): no background of its own
  scene.background = null;
  group.position.y = P.FLOOR_Y;
  group.updateMatrixWorld(true);
  const fog = scene.fog as THREE.Fog;
  fog.near = 16;
  fog.far = 105;
  const k = new Kit(group);
  k.shadeTop = 22;
  const { NAVE, A2, A3, OUT, W0, WO, TR, CROSS0, CROSS1, CHOIR_E, AC, H, SPRING, AH, ASPRING, BAYS, CHOIR_BAYS, RAILZ, AZ, NORTH } = P;
  const XMID = (CROSS0 + CROSS1) / 2;
  const D = P.SHELL.door;
  const DH = D.top - P.FLOOR_Y; // the doorway's height over the nave floor

  // ---- floors
  const floor = (x0: number, x1: number, z0: number, z1: number) => k.box(x1 - x0, 0.1, z1 - z0, (x0 + x1) / 2, -0.05, (z0 + z1) / 2, M.floor, { tile: 2.2, flat: true });
  floor(-(A3 - 0.4), A3 - 0.4, W0, WO);
  floor(-OUT, OUT, WO, CROSS0);
  floor(-TR, TR, CROSS0, CROSS1);
  floor(-A3, A3, CROSS1, CHOIR_E + 0.6);
  floor(-P.AMB_IN, P.AMB_IN, CHOIR_E + 0.6, AC);
  floor(-D.hw - 0.7, D.hw + 0.7, D.z + 0.05, W0); // the doorway, from the door to the nave
  {
    // the ambulatory and the apse: a half disc round the apse's centre, cut as the shell's ten faces
    const r = P.AMB_OUT / Math.cos(Math.PI / 20);
    const g = new THREE.CircleGeometry(r, 10, Math.PI, Math.PI);
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 2.2, pos.getY(i) / 2.2);
    k.add(g, M.floor, 0, 0, AC, { rx: -Math.PI / 2, flat: true });
  }
  // the choir two steps up (the apse's floor too), and the step at its mouth
  k.box(NAVE * 2, 0.36, AC - CROSS1 - 0.3, 0, 0.18, (CROSS1 + 0.3 + AC) / 2, M.marbleW, { tile: 1.2, flat: true });
  {
    const g = new THREE.CylinderGeometry(P.APSE_IN / Math.cos(Math.PI / 10), P.APSE_IN / Math.cos(Math.PI / 10), 0.36, 5, 1, false, -Math.PI / 2, Math.PI);
    k.add(g, M.marbleW, 0, 0.18, AC, { flat: true });
  }
  k.box(NAVE * 2, 0.18, 0.3, 0, 0.09, CROSS1 + 0.45, M.marbleW, { tile: 1.2, flat: true });

  // ---- walls (each at least 0.2 m inside the shell's faces: shared/cathedralPlan.ts)
  const wall = (w: number, h: number, d: number, x: number, z: number, y0 = 0) => k.box(w, h, d, x, y0 + h / 2, z, M.stone, { tile: 2.4 });
  // the west wall: the nave's part with the doorway under a pointed relieving arch; the aisles' parts plain
  k.archWall(NAVE * 2, H, 0.8, D.hw * 2, DH, DH + 3.4, 0, 0, W0 - 0.4, M.stone, { tile: 2.4 });
  for (const s of [-1, 1]) wall(A3 - 0.4 - NAVE, AH, 0.8, (s * (NAVE + A3 - 0.4)) / 2, W0 - 0.4);
  // the doorway's reveal, from the doors to the wall's inner face, and the back of the tympanum over the doors
  for (const s of [-1, 1]) k.box(0.65, DH, W0 - 0.8 - D.z, s * (D.hw + 0.325), DH / 2, (D.z + W0 - 0.8) / 2 + 0.03, M.stoneDark, { tile: 1.2 });
  k.box(D.hw * 2 + 1.3, 3.6, 0.4, 0, DH + 1.8, D.z + 0.25, M.stoneDark, { tile: 1.2 });
  k.box(D.hw * 2 + 1.3, 0.35, W0 - 0.8 - D.z, 0, DH + 0.17, (D.z + W0 - 0.8) / 2 + 0.03, M.stoneDark, { tile: 1.2 });
  for (const s of [-1, 1]) {
    // the towers' inner sides (to the towers' east faces: the towers' own faces stand inside this wall), and the outer aisles' west walls behind the towers
    wall(0.4, AH, WO - W0, s * (A3 - 0.2), (W0 + WO) / 2);
    wall(0.7, AH, P.TOWER_E - WO + 0.8, s * (A3 - 0.05), (WO - 0.8 + P.TOWER_E) / 2);
    wall(OUT + 0.5 - A3, AH, 0.8, (s * (A3 + OUT + 0.5)) / 2, WO - 0.4);
    // the outer aisle walls
    wall(0.5, AH, CROSS0 - WO + 0.8, s * (OUT + 0.25), (WO - 0.8 + CROSS0) / 2);
    // the transept's west and east walls beyond the aisles (the outer aisle ends here), and its end walls
    wall(TR + 0.35 - A3, H, 0.6, (s * (A3 + TR + 0.35)) / 2, CROSS0 - 0.3);
    wall(TR + 0.35 - A3, H, 0.6, (s * (A3 + TR + 0.35)) / 2, CROSS1 + 0.3);
    wall(0.35, H, CROSS1 - CROSS0 + 1.2, s * (TR + 0.175), XMID);
    // the inner and middle aisles open into the transept under arches, both sides of the crossing
    for (const z of [CROSS0 - 0.3, CROSS1 + 0.3]) {
      k.archWall(A2 - NAVE, H, 0.6, A2 - NAVE - 1.6, 6.5, 9.2, (s * (NAVE + A2)) / 2, 0, z, M.stone, { tile: 2.4 });
      k.archWall(A3 - A2, H, 0.6, A3 - A2 - 1.6, 6.5, 9.2, (s * (A2 + A3)) / 2, 0, z, M.stone, { tile: 2.4 });
    }
    // the choir aisles: their outer walls and the middle one's east end
    wall(0.6, AH, CHOIR_E + 0.6 - CROSS1, s * (A3 + 0.3), (CROSS1 + CHOIR_E + 0.6) / 2);
    wall(A3 + 0.6 - A2, AH, 0.6, (s * (A2 + A3 + 0.6)) / 2, CHOIR_E + 0.3);
    // the nave's and the choir's clerestory walls over the arcades
    k.box(0.9, H - AH, CROSS0 - W0, s * NAVE, AH + (H - AH) / 2, (W0 + CROSS0) / 2, M.stone, { tile: 2.4 });
    k.box(0.9, H - AH, AC - CROSS1, s * NAVE, AH + (H - AH) / 2, (CROSS1 + AC) / 2, M.stone, { tile: 2.4 });
    // the walls between the aisles over their arcades (up to the aisles' vaults)
    k.box(0.7, AH - ASPRING, CROSS0 - W0, s * A2, ASPRING + (AH - ASPRING) / 2, (W0 + CROSS0) / 2, M.stone, { tile: 2.4 });
    k.box(0.7, AH - ASPRING, CROSS0 - P.TOWER_E, s * A3, ASPRING + (AH - ASPRING) / 2, (P.TOWER_E + CROSS0) / 2, M.stone, { tile: 2.4 });
    k.box(0.7, AH - ASPRING, CHOIR_E - CROSS1, s * A2, ASPRING + (AH - ASPRING) / 2, (CROSS1 + CHOIR_E) / 2, M.stone, { tile: 2.4 });
  }
  // the apse: five faces up to the vault's springing
  const facetWidth = (a: number, sides: number) => 2 * a * Math.tan(Math.PI / (2 * sides)) + 0.12;
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (Math.PI / 5) * (i + 0.5);
    const r = (P.APSE_IN + P.APSE_OUT) / 2;
    k.box(facetWidth(r, 5), SPRING + 0.4, P.APSE_OUT - P.APSE_IN, Math.sin(a) * r, (SPRING + 0.4) / 2, AC + Math.cos(a) * r, M.stone, { tile: 2.4, ry: a });
  }
  // the ambulatory's outer wall: ten faces, as the shell's
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (Math.PI / 10) * (i + 0.5);
    const r = (P.AMB_IN + P.AMB_OUT) / 2;
    k.box(facetWidth(r, 10), AH, P.AMB_OUT - P.AMB_IN, Math.sin(a) * r, AH / 2, AC + Math.cos(a) * r, M.stone, { tile: 2.4, ry: a });
  }

  // ---- the vaults: the nave and choir in one, the apse's half dome, the transept across, the aisles, the ambulatory
  k.vault(NAVE * 2 + 0.2, SPRING, H - SPRING, AC - W0, 0, W0, M.vault, { tile: 3 });
  {
    const prof = pointedProfile(NAVE + 0.1, H - SPRING, 6).slice(0, 7);
    const g = new THREE.LatheGeometry(prof.map(([px, py]) => new THREE.Vector2(-px, SPRING + py)), 5, -Math.PI / 2, Math.PI);
    k.add(g, M.vault, 0, 0, AC, { flat: true });
  }
  k.vault(CROSS1 - CROSS0, SPRING, H - SPRING, TR * 2, -TR, XMID, M.vault, { tile: 3, ry: Math.PI / 2 });
  for (const s of [-1, 1]) {
    k.vault(A2 - NAVE, ASPRING, AH - ASPRING, CROSS0 - W0, (s * (NAVE + A2)) / 2, W0, M.vault, { tile: 3 });
    k.vault(A3 - A2, ASPRING, AH - ASPRING, CROSS0 - W0, (s * (A2 + A3)) / 2, W0, M.vault, { tile: 3 });
    k.vault(OUT - A3, ASPRING, AH - ASPRING, CROSS0 - WO, (s * (A3 + OUT)) / 2, WO, M.vault, { tile: 3 });
    k.vault(A2 - NAVE, ASPRING, AH - ASPRING, AC - CROSS1, (s * (NAVE + A2)) / 2, CROSS1, M.vault, { tile: 3 });
    k.vault(A3 - A2, ASPRING, AH - ASPRING, CHOIR_E - CROSS1, (s * (A2 + A3)) / 2, CROSS1, M.vault, { tile: 3 });
    // a lid over the transept arms' vault (hidden seams at its crown)
    k.box(TR - NAVE, 0.3, CROSS1 - CROSS0, (s * (TR + NAVE)) / 2, H + 0.15, XMID, M.vault, { tile: 3, flat: true });
  }
  {
    // the ambulatory's ceiling, flat at the aisles' height
    const g = new THREE.RingGeometry(P.APSE_IN, P.AMB_OUT / Math.cos(Math.PI / 20), 10, 1, Math.PI, Math.PI);
    k.add(g, M.vault, 0, AH, AC, { rx: -Math.PI / 2, flat: true });
  }

  // ribs: transverse arches across the nave at each pier (thin stone bands on the vault)
  for (const z of [...BAYS, ...CHOIR_BAYS]) {
    for (let i = 0; i < 6; i++) {
      const px = (a: number) => -NAVE + a * NAVE * 2;
      const py = (a: number) => SPRING + (H - SPRING) * Math.sin(a * Math.PI) ** 0.8;
      const x0 = px(i / 6);
      const x1 = px((i + 1) / 6);
      const y0 = py(i / 6);
      const y1 = py((i + 1) / 6);
      k.box(Math.hypot(x1 - x0, y1 - y0), 0.35, 0.35, (x0 + x1) / 2, (y0 + y1) / 2 - 0.1, z, M.stoneDark, { rz: Math.atan2(y1 - y0, x1 - x0), flat: true });
    }
  }

  // ---- the piers and arcades
  const pier = (x: number, z: number, top: number, r: number) => {
    k.cyl(r + 0.15, r + 0.2, 0.6, x, 0, z, M.stoneDark, { seg: 8 });
    k.cyl(r, r, top - 0.6, x, 0.6, z, M.stone, { seg: 8, tile: 2 });
    // two shafts of the cluster, on the sides that face the walks
    for (const a of [0, Math.PI]) k.cyl(0.2, 0.2, top - 0.6, x + Math.cos(a) * r, 0.6, z, M.stone, { seg: 5, tile: 2 });
    k.box(r * 2 + 0.6, 0.5, r * 2 + 0.6, x, top + 0.25, z, M.stoneDark, { tile: 1 });
  };
  const arcade = (x: number, z0: number, z1: number, h: number, t: number, spring: number, apex: number) =>
    k.archWall(z1 - z0, h, t, z1 - z0 - 1.8, spring, apex, x, 0, (z0 + z1) / 2, M.stone, { ry: Math.PI / 2, tile: 2.4 });
  const between = (list: number[]) => list.slice(0, -1).map((a, i) => [a, list[i + 1]] as const);
  for (const s of [-1, 1]) {
    for (const z of BAYS) {
      pier(s * NAVE, z, 8, 0.72);
      pier(s * A2, z, 6, 0.5);
      if (z > P.TOWER_E) pier(s * A3, z, 6, 0.5);
      // vaulting shafts up the nave wall to the vault's springing
      k.cyl(0.22, 0.22, SPRING - 8.5, s * (NAVE - 0.55), 8.5, z, M.stone, { seg: 5, tile: 2 });
    }
    for (const z of CHOIR_BAYS) {
      pier(s * NAVE, z, 8, 0.72);
      pier(s * A2, z, 6, 0.5);
    }
    // the crossing's four great piers
    pier(s * NAVE, CROSS0, 13, 1.1);
    pier(s * NAVE, CROSS1, 13, 1.1);
    for (const [a, b] of between([W0, ...BAYS, CROSS0 - 1.1])) arcade(s * NAVE, a, b, AH, 0.8, 8, 12.2);
    for (const [a, b] of between([W0, ...BAYS, CROSS0 - 0.6])) arcade(s * A2, a, b, ASPRING, 0.6, 8, 11.8);
    for (const [a, b] of between([P.TOWER_E, ...BAYS.filter((z) => z > P.TOWER_E), CROSS0 - 0.6])) arcade(s * A3, a, b, ASPRING, 0.6, 8, 11.8);
    for (const [a, b] of between([CROSS1 + 1.1, ...CHOIR_BAYS, AC])) arcade(s * NAVE, a, b, AH, 0.8, 8, 11.4);
    for (const [a, b] of between([CROSS1 + 0.6, ...CHOIR_BAYS, CHOIR_E])) arcade(s * A2, a, b, ASPRING, 0.6, 8, 11.8);
    // the crossing arches into the transept arms
    k.archWall(CROSS1 - CROSS0, H, 0.9, CROSS1 - CROSS0 - 2.2, 13, 21.5, s * NAVE, 0, XMID, M.stone, { ry: Math.PI / 2, tile: 2.4 });
  }
  // the crossing arches over the nave (toward the west and into the choir)
  k.archWall(NAVE * 2, H, 0.9, NAVE * 2 - 2.2, 13, 21.5, 0, 0, CROSS0, M.stone, { tile: 2.4 });
  k.archWall(NAVE * 2, H, 0.9, NAVE * 2 - 2.2, 13, 21.5, 0, 0, CROSS1, M.stone, { tile: 2.4 });

  // ---- windows: the aisles' tall lancets, the clerestory, the transept ends, the choir, the apse, the ambulatory
  const glassDefs: Array<ReturnType<typeof glassMat>> = [glassMat("grisaille", 11), glassMat("colour", 12), glassMat("grisaille", 13), glassMat("colour", 14)];
  const shaftFrom: THREE.Vector3[] = [];
  const mid = (list: number[]) => between(list).map(([a, b]) => (a + b) / 2);
  for (const s of [-1, 1]) {
    mid([WO, ...BAYS, CROSS0]).forEach((z, i) => k.plane(2.4, 8, s * (OUT - 0.02), 6.8, z, glassDefs[(i + (s > 0 ? 1 : 0)) % 2 === 0 ? 0 : i % 3 === 1 ? 1 : 2].def, { ry: (-s * Math.PI) / 2 }));
    mid([W0, ...BAYS, CROSS0]).forEach((z, i) => {
      k.plane(3.2, 4.4, s * (NAVE - 0.47), 18.3, z, glassDefs[i % 4 === 2 ? 3 : 2].def, { ry: (-s * Math.PI) / 2 });
      if (s > 0 && i >= 1 && i <= 6) shaftFrom.push(new THREE.Vector3(NAVE - 0.5, 18.3, z));
    });
    k.plane(6, 10, s * (TR - 0.02), 16, XMID, glassDefs[1].def, { ry: (-s * Math.PI) / 2 });
    mid([CROSS1, ...CHOIR_BAYS, AC]).forEach((z) => k.plane(2.4, 4.0, s * (NAVE - 0.47), 18.3, z, glassDefs[3].def, { ry: (-s * Math.PI) / 2 }));
    mid([CROSS1, ...CHOIR_BAYS, CHOIR_E]).forEach((z) => k.plane(2.2, 7.6, s * (A3 - 0.02), 6.8, z, glassDefs[0].def, { ry: (-s * Math.PI) / 2 }));
  }
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (Math.PI / 5) * (i + 0.5);
    const r = P.APSE_IN - 0.02;
    k.plane(1.8, 7.5, Math.sin(a) * r, 15.5, AC + Math.cos(a) * r, glassDefs[i === 2 ? 1 : 3].def, { ry: a + Math.PI });
  }
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (Math.PI / 10) * (i + 0.5);
    const r = P.AMB_IN - 0.02;
    k.plane(2.0, 6.4, Math.sin(a) * r, 7, AC + Math.cos(a) * r, glassDefs[i % 2 ? 0 : 2].def, { ry: a + Math.PI });
  }

  // ---- the doors that stay shut: the side portals in the towers' bases, the transept portals
  const door = (w: number, h: number, x: number, z: number, ry: number) => {
    k.box(w, h, 0.1, x, h / 2, z, M.oakDark, { ry, tile: 1 });
    k.box(w + 0.5, 0.3, 0.14, x, h + 0.15, z, M.stoneDark, { ry, tile: 1 });
    for (const y of [h * 0.2, h * 0.55, h * 0.85]) k.box(w * 0.92, 0.08, 0.13, x, y, z, M.iron, { ry, flat: true });
  };
  for (const s of [-1, 1]) {
    door(P.SHELL.sidePortals.hw * 2, P.SHELL.sidePortals.top - P.FLOOR_Y, s * P.SHELL.sidePortals.v, W0 + 0.06, 0);
    door(P.SHELL.transeptPortals.hw * 2, P.SHELL.transeptPortals.top - P.FLOOR_Y, s * (TR - 0.06), P.SHELL.transeptPortals.u, Math.PI / 2);
  }

  // ---- the west gallery over the door and the organ's case (1657), pipes in flats
  const OZ = P.ORGAN.z0;
  k.box(NAVE * 2, 0.5, 4.6, 0, P.ORGAN.y, OZ + 2.3, M.stoneDark, { tile: 1.6 });
  k.box(NAVE * 2, 1.1, 0.25, 0, P.ORGAN.y + 0.8, OZ + 4.55, M.oakDark, { tile: 1 });
  for (const x of [-4.4, 4.4]) k.cyl(0.35, 0.35, P.ORGAN.y - 0.25, x, 0, OZ + 4.2, M.stone, { seg: 8 });
  k.box(9, 9.5, 1.8, 0, 12.2, OZ + 1.3, M.oakDark, { tile: 1.4 });
  for (const x of [-3.9, 0, 3.9]) k.box(2.2, 11, 2.1, x, 12.9, OZ + 1.5, M.oak, { tile: 1.4 });
  for (const x of [-3.9, 0, 3.9]) k.box(2.6, 0.5, 2.3, x, 18.6, OZ + 1.5, M.gilt);
  for (let i = 0; i < 27; i++) {
    const x = -4.6 + (i * 9.2) / 26;
    const flat = Math.abs(((i % 9) - 4) / 4);
    const h = 2.4 + (1 - flat) * 2.4;
    k.cyl(0.1, 0.1, h, x, 8.6 + (1 - flat) * 0.4, OZ + 2.62, M.tin, { seg: 5 });
  }

  // ---- the high altar: three steps, the table, the tabernacle, six candlesticks; the marble retable with the Assumption
  for (let i = 0; i < 3; i++) k.box(7 - i * 1.2, 0.18, 4.6 - i * 1.1, 0, 0.36 + 0.09 + i * 0.18, AZ - 0.2 + i * 0.55, M.marbleW, { tile: 1, flat: true });
  k.box(3.4, 1.0, 1.1, 0, 0.9 + 0.5, AZ + 0.6, M.marbleB, { tile: 0.8 });
  k.box(3.6, 0.06, 1.2, 0, 1.93, AZ + 0.6, M.linen);
  k.box(0.9, 1.2, 0.6, 0, 2.55, AZ + 0.85, M.gilt);
  const altarFlames: Array<[number, number, number]> = [];
  for (const x of [-1.5, -1.0, -0.55, 0.55, 1.0, 1.5]) {
    k.cyl(0.05, 0.1, 0.9, x, 1.96, AZ + 0.95, M.brass, { seg: 6 });
    k.cyl(0.035, 0.035, 0.35, x, 2.86, AZ + 0.95, M.wax, { seg: 5 });
    altarFlames.push([x, 3.28, AZ + 0.95]);
  }
  const RZ = P.RETABLE_Z;
  for (const x of [-3.6, -2.8, 2.8, 3.6]) {
    k.cyl(0.3, 0.3, 8.5, x, 1.2, RZ, M.marbleB, { seg: 8, tile: 1 });
    k.box(0.8, 0.5, 0.8, x, 9.95, RZ, M.gilt);
  }
  k.box(8.6, 1.2, 1.4, 0, 10.8, RZ, M.marbleB, { tile: 1 });
  k.box(8.8, 0.3, 1.6, 0, 11.55, RZ, M.gilt);
  k.box(5, 2.2, 0.8, 0, 12.8, RZ + 0.2, M.marbleW, { tile: 1 });
  k.box(1.2, 1.4, 0.5, 0, 14.6, RZ + 0.3, M.gilt);
  k.box(4.9, 7.4, 0.3, 0, 6.2, RZ + 0.35, M.gilt); // the painting's gilt frame
  k.plane(4.5, 7.0, 0, 6.2, RZ + 0.18, paintMat("assumption"), { ry: Math.PI });
  k.box(8.6, 1.2, 1.2, 0, 0.96, RZ + 0.1, M.marbleB, { tile: 1 });
  // the communion rail across the choir's mouth (white marble balusters, a black top), and oak screens along the choir
  k.box(NAVE * 2 - 0.2, 0.12, 0.4, 0, 0.98, RAILZ, M.marbleB, { tile: 0.8 });
  for (let x = -5.7; x <= 5.7; x += 0.3) k.cyl(0.06, 0.08, 0.9, x, 0.04, RAILZ, M.marbleW, { seg: 5 });
  for (const s of [-1, 1]) {
    const runs: Array<[number, number]> = s * NORTH > 0 ? [[CROSS1 + 0.6, P.GATE.z0], [P.GATE.z1, AC]] : [[CROSS1 + 0.6, AC]];
    for (const [z0, z1] of runs) k.box(0.3, 1.5, z1 - z0, s * NAVE, 0.75, (z0 + z1) / 2, M.oakDark, { tile: 1 });
  }
  // the sanctuary lamp, red, hanging before the altar
  const redGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff4020, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9 }));
  redGlow.scale.set(0.6, 0.6, 1);
  redGlow.position.set(0, 5, AZ - 4);
  group.add(redGlow);
  k.cyl(0.015, 0.015, H - 5.2, 0, 5.2, AZ - 4, M.iron, { seg: 3 });
  k.cyl(0.18, 0.08, 0.3, 0, 4.85, AZ - 4, M.brass, { seg: 6 });

  // ---- Rubens's two triptychs on the transept arms' east walls, wings open, over their altars:
  // the Elevation (north arm), the Descent (south arm)
  const triptych = (s: number, kind: "elevation" | "descent") => {
    const x = s * P.TRIPTYCH_X;
    const z = CROSS1 - 0.3;
    k.box(3.4, 1.1, 0.5, x, 0.55, CROSS1 - 0.55, M.marbleB, { tile: 1 });
    k.box(3.6, 0.06, 0.6, x, 1.13, CROSS1 - 0.55, M.linen);
    k.box(5.6, 7.4, 0.25, x, 5.6, z, M.black, { tile: 1 });
    k.box(5.8, 0.25, 0.3, x, 9.35, z - 0.05, M.gilt);
    k.box(5.8, 0.25, 0.3, x, 1.85, z - 0.05, M.gilt);
    k.plane(4.6, 6.8, x, 5.6, z - 0.14, paintMat(kind), { ry: Math.PI });
    // the wings, open and angled toward the room
    for (const w of [-1, 1]) {
      const wx = x + w * 3.75;
      k.box(2.1, 6.8, 0.15, wx, 5.6, z - 0.5, M.black, { ry: w * 0.35 });
      k.plane(1.9, 6.4, wx - w * 0.03, 5.6, z - 0.6, paintMat("saint", kind === "elevation" ? 2 + w : 5 + w), { ry: Math.PI + w * 0.35 });
    }
    k.box(6.6, 1.4, 0.6, x, 10.3, z - 0.1, M.marbleB, { tile: 1 });
    k.box(1.4, 0.9, 0.5, x, 11.4, z - 0.1, M.gilt);
  };
  triptych(NORTH, "elevation");
  triptych(-NORTH, "descent");

  // ---- the pulpit (Van der Voort, 1713): an oak tree trunk, a tub among branches, birds, a sounding board, the stair round a pier
  const PX = P.PULPIT.x;
  const PZ = P.PULPIT.z;
  k.cyl(0.32, 0.45, 2.3, PX, 0, PZ, M.oakDark, { seg: 7 });
  k.cyl(0.95, 0.7, 1.15, PX, 2.3, PZ, M.oak, { seg: 8 });
  k.box(1.9, 0.12, 1.9, PX, 3.5, PZ, M.oakDark);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    k.box(0.08, 1.3, 0.08, PX + Math.cos(a) * 0.8, 1.5, PZ + Math.sin(a) * 0.8, M.oakDark, { rz: Math.cos(a) * 0.6, rx: -Math.sin(a) * 0.6 });
    k.box(0.14, 0.09, 0.26, PX + Math.cos(a) * 1.05, 3.62, PZ + Math.sin(a) * 1.05, M.oak, { ry: a }); // a bird on a branch
  }
  k.cyl(1.4, 1.3, 0.25, PX, 5.9, PZ, M.oakDark, { seg: 8 });
  k.cyl(0.05, 0.5, 1.2, PX, 6.15, PZ, M.oak, { seg: 6 });
  for (let i = 0; i < 8; i++) k.box(0.9, 0.12, 0.5, PX - 0.5 + i * 0.02, 0.2 + i * 0.3, PZ - 1.2 + i * 0.2, M.oakDark, { ry: -0.4 - i * 0.18 });

  // ---- confessionals (baroque, carved oak) along the aisle walls; the curate's is the middle one on the north wall
  const confessional = (x: number, z: number) => {
    const s = Math.sign(x);
    k.box(1.4, 3.1, 3.6, x, 1.55, z, M.oakDark, { tile: 1 });
    k.box(0.1, 0.5, 3.8, x - s * 0.72, 3.25, z, M.oak);
    // the priest's door (upper half a dark grille) and the penitents' kneeling places either side, curtains
    k.box(0.06, 1.1, 0.9, x - s * 0.72, 0.9, z, M.oak);
    k.box(0.04, 0.8, 0.8, x - s * 0.72, 1.95, z, M.black);
    for (const w of [-1, 1]) {
      k.box(0.04, 2.2, 0.9, x - s * 0.73, 1.2, z + w * 1.25, M.red);
      // an apostle carved at each partition
      k.box(0.25, 1.0, 0.25, x - s * 0.78, 2.2, z + w * 0.65, M.statue);
      k.cyl(0.1, 0.1, 0.25, x - s * 0.78, 2.7, z + w * 0.65, M.statue, { seg: 5 });
    }
  };
  for (const c of P.CONFESSIONALS) confessional(c.x, c.z);

  // ---- the Lady altar at the east end of the north outer aisle, with its statue and the stand of candles
  const LX = P.LADY.x;
  const LZ = P.LADY.z;
  k.box(3, 1.0, 1.0, LX, 0.5, LZ, M.marbleW);
  k.box(3.2, 0.06, 1.1, LX, 1.03, LZ, M.linen);
  k.box(1.6, 0.9, 0.6, LX, 1.5, LZ + 0.2, M.gilt);
  k.cyl(0.2, 0.42, 1.3, LX, 1.95, LZ + 0.2, M.blue, { seg: 7 });
  k.cyl(0.13, 0.13, 0.28, LX, 3.25, LZ + 0.2, M.statue, { seg: 6 });
  k.cyl(0.25, 0.25, 0.04, LX, 3.6, LZ + 0.2, M.gilt, { seg: 8 });
  const STAND: Mark = { x: P.STAND.x, z: P.STAND.z, yaw: 0 };
  k.box(1.8, 0.05, 0.5, LX, 0.95, STAND.z, M.iron);
  k.box(1.6, 0.05, 0.4, LX, 1.2, STAND.z + 0.1, M.iron);
  k.box(1.4, 0.05, 0.3, LX, 1.45, STAND.z + 0.2, M.iron);
  for (const x of [-0.8, 0.8]) k.cyl(0.03, 0.03, 1.45, LX + x, 0, STAND.z, M.iron, { seg: 3 });
  // the altar of the Sacrament at the east end of the south outer aisle
  const sideAltar = (x: number, z: number, ry: number, paintSeed: number) => {
    k.box(2.6, 1.0, 0.9, x, 0.5, z, M.marbleB, { ry });
    k.box(2.8, 0.06, 1.0, x, 1.03, z, M.linen, { ry });
    const dz = Math.cos(ry) * 0.5;
    const dx = Math.sin(ry) * 0.5;
    k.box(2.4, 3.4, 0.2, x + dx, 2.9, z + dz, M.gilt, { ry });
    k.plane(2.1, 3.1, x + dx - Math.sin(ry) * 0.12, 2.9, z + dz - Math.cos(ry) * 0.12, paintMat("saint", paintSeed), { ry: ry + Math.PI });
    for (const w of [-0.9, 0.9]) {
      k.cyl(0.03, 0.06, 0.5, x + Math.cos(ry) * w, 1.06, z - Math.sin(ry) * w, M.brass, { seg: 5 });
      k.cyl(0.025, 0.025, 0.25, x + Math.cos(ry) * w, 1.56, z - Math.sin(ry) * w, M.wax, { seg: 4 });
    }
  };
  sideAltar(P.SACRAMENT.x, P.SACRAMENT.z, 0, 7);
  // paintings in black frames on the aisle walls, between the confessionals
  for (const s of [-1, 1])
    for (const [i, z] of BAYS.entries()) {
      if (P.CONFESSIONALS.some((c) => Math.sign(c.x) === s && Math.abs(c.z - z) < 1)) continue;
      k.box(0.12, 2.6, 2.0, s * (OUT - 0.08), 3.4, z, M.black);
      k.plane(1.7, 2.3, s * (OUT - 0.16), 3.4, z, paintMat(i % 3 ? "saint" : "portrait", 10 + i), { ry: (-s * Math.PI) / 2 });
    }

  // ---- the chairs in the nave: rush seats, rows either side of the middle walk
  const chairs = P.SETS.chairs.map((c) => ({ ...c }));
  const seats: Seat[] = [];
  for (let r = 0; r < P.ROWS; r++) {
    const z = P.ROW0 + r * P.ROWD;
    for (const s of [-1, 1]) {
      for (const cx of P.CHAIR_X) {
        if (P.chairSkipped(s, cx, z)) continue;
        const x = s * cx;
        k.box(0.44, 0.05, 0.42, x, 0.45, z, M.rush, { tile: 0.4 });
        k.plane(0.42, 0.95, x, 0.48, z - 0.21, chairBack, { flat: false });
        k.plane(0.42, 0.44, x, 0.22, z + 0.19, chairBack, { flat: false });
      }
      // the chair at the aisle end: Jef may sit there
      seats.push({ x: s * P.CHAIR_X[0], z: z + 0.1, yaw: 0, table: r, h: 0.46, via: [] });
    }
  }
  // brass chandeliers over the nave (lit at dusk), on chains from the vault
  const chandeliers: Array<[number, number]> = [[0, 24], [0, 36], [0, 48]];
  for (const [x, z] of chandeliers) {
    k.cyl(0.02, 0.02, H - 9.6, x, 9.6, z, M.iron, { seg: 3 });
    k.cyl(0.9, 0.9, 0.08, x, 9.2, z, M.brass, { seg: 10, open: true });
    k.cyl(0.12, 0.12, 0.7, x, 8.9, z, M.brass, { seg: 6 });
  }

  // the font by the west door
  k.cyl(0.55, 0.3, 1.0, P.FONT.x, 0, P.FONT.z, M.marbleB, { seg: 8 });
  k.cyl(0.62, 0.62, 0.12, P.FONT.x, 1.0, P.FONT.z, M.marbleW, { seg: 8 });

  k.finish();

  // flames: the altar's six (lit at mass), the Lady altar's stand (grows as candles are lit), the chandeliers (dusk)
  const altarLights = new Flames(group, 8, 0.22);
  for (const [x, y, z] of altarFlames) altarLights.addFlame(x, y, z);
  altarLights.showFirst(0);
  const stand = new Flames(group, 40, 0.14);
  const standSpots: Array<[number, number, number]> = [];
  for (let tier = 0; tier < 3; tier++) for (let i = 0; i < 9; i++) standSpots.push([LX - 0.7 + i * 0.175 + (tier % 2) * 0.08, 1.08 + tier * 0.25, STAND.z + tier * 0.1]);
  for (let i = 0; i < 11; i++) stand.addFlame(...standSpots[(i * 7) % standSpots.length]);
  const chand = new Flames(group, 36, 0.2);
  for (const [x, z] of chandeliers) for (let i = 0; i < 10; i++) chand.addFlame(x + Math.cos((i / 10) * Math.PI * 2) * 0.9, 9.35, z + Math.sin((i / 10) * Math.PI * 2) * 0.9);

  // light: the day through the glass (a sky fill), the altar and the Lady altar's candles, the chandeliers at dusk
  const hemi = new THREE.HemisphereLight(0xd0ccc8, 0x5a4a38, 1.2);
  scene.add(hemi);
  const amb = new THREE.AmbientLight(0x4a4034, 0.6);
  scene.add(amb);
  const altarL = new THREE.PointLight(0xffb070, 0, 14, 1.5);
  altarL.position.set(0, 3.5, AZ - 0.5);
  group.add(altarL);
  const ladyL = new THREE.PointLight(0xffa860, 6, 9, 1.5);
  ladyL.position.set(LX, 1.8, STAND.z - 0.6);
  group.add(ladyL);
  const naveL = new THREE.PointLight(0xffb070, 0, 30, 1.2);
  naveL.position.set(0, 8, 36);
  group.add(naveL);
  const shaftMat = shaftMaterial();
  for (const f of shaftFrom) lightShaft(group, f, new THREE.Vector3(1.2 + (f.z % 2), 0, f.z + 3), 1.5, shaftMat);

  // walking: Jef (sitting and kneeling go through the room frame) and the people, by the plan
  const jefFree = (x: number, z: number) => P.freeAt(x, z, 0.3, true);
  const walkJef = (fx: number, fz: number, x: number, z: number): [number, number] => (jefFree(x, z) ? [x, z] : jefFree(x, fz) ? [x, fz] : jefFree(fx, z) ? [fx, z] : [fx, fz]);
  const path = walkGraph(P.nodes(), (x, z) => P.freeAt(x, z, 0.25, false));

  const marks: Record<string, Mark> = { ...P.MARKS, stand: STAND };
  const sets: Record<string, Mark[]> = { ...P.SETS, chairs };
  const looks: Lookable[] = [
    { id: "elevation", x: NORTH * P.TRIPTYCH_X, z: CROSS1 - 3.2, r: 3.5, label: "look at the Elevation of the Cross", text: "Rubens's Elevation of the Cross, the great triptych, back in Antwerp since 1815. In the gloom you make out the cross going up on a slant and the men straining at its foot; the wings stand open, dark with old varnish." },
    { id: "descent", x: -NORTH * P.TRIPTYCH_X, z: CROSS1 - 3.2, r: 3.5, label: "look at the Descent from the Cross", text: "Rubens's Descent from the Cross. A pale body slides down a white sheet into many hands; a red cloak catches what light there is. Men of the guild of arquebusiers paid for it, two hundred and sixty years ago." },
    { id: "assumption", x: 0, z: RAILZ - 1.0, r: 2.2, label: "look at the high altar", text: "Over the high altar, in black and white marble and gold, Our Lady rises into a golden light: Rubens again, his Assumption. The red lamp before the tabernacle never goes out." },
    { id: "pulpit", x: PX + 1.6, z: PZ, r: 1.8, label: "look at the pulpit", text: "The pulpit is carved oak, all of it: tree trunks and branches, birds on the twigs, the preacher's tub among the leaves. It came from the abbey at Hemiksem when the French closed it." },
    { id: "organ", x: 0, z: W0 + 6.5, r: 2.2, label: "look up at the organ", text: "Up on the west gallery over the door the organ's carved case, black with age, fills the end of the nave to the vault. Tin pipes in their flats catch the light." },
    { id: "font", x: P.FONT.x, z: P.FONT.z + 1.4, r: 1.6, label: "look at the font", text: "The font by the door, black marble with a white rim. A drop of holy water on your fingers is cold as the Schelde." },
    { id: "slab", x: 9, z: 24, r: 1.4, label: "read a grave slab", text: "A worn slab in the floor: a merchant, his wife and a date two hundred years gone. Ten thousand boots have walked his name smooth." },
  ];

  const lampPts = { altar: toWorld(0, AZ, 3.3), lady: toWorld(LX, STAND.z, 1.4), chand: toWorld(0, 36, 9.3) };
  let lit = false;
  let day = 1;
  let ambK = 1;
  let sky = 1;
  const glassLight = () => {
    // the glass glows with the daylight outside, dimmer in fog and rain
    for (const g of glassDefs) g.mat().color.setScalar(0.1 + 0.95 * day * sky);
    shaftMat.opacity = Math.max(0, day - 0.25) * 0.13 * Math.max(0, sky - 0.55) * 2.2;
    // at night the candles and the chandeliers light it, the fill goes low
    hemi.intensity = (0.45 + 1.95 * day * (0.55 + 0.45 * sky)) * ambK;
    amb.intensity = (0.45 + 0.55 * day) * ambK;
  };
  const room: LandmarkRoom = {
    kind: "landmark",
    landmark: "cathedral",
    scene,
    group,
    walk: walkJef,
    seats,
    stands: [],
    exit: { ...P.MARKS.door, yaw: Math.PI },
    entry: { ...P.MARKS.door },
    entries: { main: { ...P.MARKS.door } },
    exits: { main: { ...P.MARKS.door, yaw: Math.PI } },
    lamps: [],
    toWorld,
    floor: (x, z) => P.floorAt(x, z),
    peopleFloor: (x, z) => P.floorAt(x, z),
    pace: 1.45,
    eye: 1.62,
    surface: "stone",
    sound: "church",
    marks,
    sets,
    looks,
    path,
    setLit(on) {
      lit = on;
      altarLights.showFirst(on ? 6 : 0);
    },
    addCandle() {
      if (stand.count < standSpots.length) stand.addFlame(...standSpots[(stand.count * 7) % standSpots.length]);
    },
    setDaylight(kd, weather = 1) {
      day = kd;
      sky = weather;
      glassLight();
      chand.showFirst(kd < 0.35 ? 36 : 0);
    },
    setAmbient(k) {
      ambK = k;
      glassLight();
    },
    update(t) {
      altarLights.update(t);
      stand.update(t);
      chand.update(t);
      const f = flicker(t, 2.2);
      altarL.intensity = lit ? 9 * f : 0;
      ladyL.intensity = (3 + stand.count * 0.3) * flicker(t, 5.1);
      naveL.intensity = day < 0.35 ? 5 * flicker(t, 7.7) : 0;
      redGlow.material.opacity = 0.75 + Math.sin(t * 3.1) * 0.08;
      room.lamps = [
        ...(lit ? [{ p: lampPts.altar, w: 0.4 * f }] : []),
        { p: lampPts.lady, w: 0.3 * flicker(t, 5.1) },
        ...(day < 0.35 ? [{ p: lampPts.chand, w: 0.35 }] : []),
      ];
    },
  };
  room.update(0, 0);
  room.setDaylight(1);
  return room;
}
