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
  rectWalker,
  shaftMaterial,
  slabs,
  whitewash,
  type MatDef,
  type Rect,
} from "./landmarkKit";
import { tex } from "./rooms";

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
 * Onze-Lieve-Vrouwekathedraal as it stood in 1873, shortened to fit a game: a nave 12 m wide
 * and 24 high under a pointed vault, two aisles either side on clustered piers (the real church
 * has three), the transept with Rubens's two great triptychs facing each other (the Elevation of
 * the Cross on the north arm, the Descent from the Cross on the south), the raised choir behind
 * the marble communion rail with the high altar and Rubens's Assumption, the ambulatory round
 * it. Rush chairs (let at mass by the chair woman) in rows in the nave; Van der Voort's carved
 * oak pulpit of 1713 on a pier; baroque confessionals along the aisle walls; the Lady altar with
 * its stand of candles; the organ's case of 1657 on the west gallery; clear and coloured glass,
 * light falling through in the day. Paintings are dark shapes painted in code, never copies.
 */
export function buildCathedral(opts: { origin: { x: number; z: number }; yaw: number }): LandmarkRoom {
  const { scene, group, toWorld } = frameRoom(opts.origin, opts.yaw, 0x1a1712);
  const fog = scene.fog as THREE.Fog;
  fog.near = 16;
  fog.far = 105;
  const k = new Kit(group);
  k.shadeTop = 22;
  const NAVE = 6; // half width
  const IN = 13; // inner aisle's outer edge
  const OUT = 20; // outer wall
  const TR = 28; // transept end
  const CROSS0 = 50;
  const CROSS1 = 62;
  const APSE = 84;
  const H = 24;
  const AH = 13;
  const BAY = 6.25;

  // floors
  k.box(OUT * 2, 0.1, CROSS0, 0, -0.05, CROSS0 / 2, M.floor, { tile: 2.2, flat: true });
  k.box(TR * 2, 0.1, CROSS1 - CROSS0, 0, -0.05, (CROSS0 + CROSS1) / 2, M.floor, { tile: 2.2, flat: true });
  k.box(IN * 2, 0.1, APSE - CROSS1, 0, -0.05, (CROSS1 + APSE) / 2, M.floor, { tile: 2.2, flat: true });
  k.box(NAVE * 2, 0.36, APSE - CROSS1 - 0.6, 0, 0.18, (CROSS1 + 0.6 + APSE) / 2, M.marbleW, { tile: 1.2, flat: true }); // the choir, two steps up
  k.box(NAVE * 2, 0.18, 0.3, 0, 0.09, CROSS1 + 0.45, M.marbleW, { tile: 1.2, flat: true });

  // outer walls (the aisles'), the west front with the door, the transept ends, the ambulatory and the apse
  const wall = (w: number, h: number, d: number, x: number, z: number, y0 = 0) => k.box(w, h, d, x, y0 + h / 2, z, M.stone, { tile: 2.4 });
  wall(0.8, AH, CROSS0, -OUT - 0.4, CROSS0 / 2);
  wall(0.8, AH, CROSS0, OUT + 0.4, CROSS0 / 2);
  wall(OUT - 1.5, 6, 0.8, -(OUT + 1.5) / 2, -0.4);
  wall(OUT - 1.5, 6, 0.8, (OUT + 1.5) / 2, -0.4);
  wall(OUT * 2, H - 6, 0.8, 0, -0.4, 6);
  wall(3, 1, 0.8, 0, -0.4, 5);
  k.box(3, 5, 0.12, 0, 2.5, -0.02, M.oakDark, { tile: 1 }); // the west door, shut behind you
  for (const s of [-1, 1]) {
    // the outer aisle ends in a wall (the Lady altar and the Sacrament altar stand against it); the inner aisle and the ambulatory open to the transept under arches
    wall(TR - IN, H, 0.8, s * (IN + TR) / 2, CROSS0 - 0.4);
    k.solids.push({ minX: s > 0 ? IN - 0.8 : -TR, maxX: s > 0 ? TR : -IN + 0.8, minZ: CROSS0 - 0.8, maxZ: CROSS0 });
    k.solids.push({ minX: s > 0 ? IN - 0.8 : -TR, maxX: s > 0 ? TR : -IN + 0.8, minZ: CROSS1, maxZ: CROSS1 + 0.8 });
    k.archWall(IN - NAVE, H, 0.8, IN - NAVE - 1.6, 6.5, 9.2, s * (NAVE + IN) / 2, 0, CROSS0 - 0.4, M.stone, { tile: 2.4 });
    k.archWall(IN - NAVE, H, 0.8, IN - NAVE - 1.6, 6.5, 9.2, s * (NAVE + IN) / 2, 0, CROSS1 + 0.4, M.stone, { tile: 2.4 });
    wall(0.8, H, CROSS1 - CROSS0 + 0.8, s * (TR + 0.4), (CROSS0 + CROSS1) / 2);
    wall(TR - IN, H, 0.8, s * (TR + IN) / 2, CROSS1 + 0.4);
    wall(0.8, AH, APSE - CROSS1, s * (IN + 0.4), (CROSS1 + APSE) / 2);
    // the nave's clerestory walls over the arcades, and the choir's
    k.box(0.9, H - AH, CROSS0, s * NAVE, AH + (H - AH) / 2, CROSS0 / 2, M.stone, { tile: 2.4 });
    k.box(0.9, H - AH, APSE - CROSS1, s * NAVE, AH + (H - AH) / 2, (CROSS1 + APSE) / 2, M.stone, { tile: 2.4 });
    // the wall between the aisles over their arcade (to the aisles' vault)
    k.box(0.7, AH - 9, CROSS0, s * IN, 9 + (AH - 9) / 2, CROSS0 / 2, M.stone, { tile: 2.4 });
  }
  wall(IN * 2, H, 0.8, 0, APSE + 0.4);

  // the vaults: the nave and choir in one, the transept across, the aisles and the ambulatory
  k.vault(NAVE * 2 + 0.2, 17, H - 17, APSE, 0, 0, M.vault, { tile: 3 });
  // (the transept's vault runs along x: turned, its near end at x = -TR, centred on the crossing)
  k.vault(NAVE * 2, 17, H - 17, TR * 2, -TR, (CROSS0 + CROSS1) / 2, M.vault, { tile: 3, ry: Math.PI / 2 });
  for (const s of [-1, 1]) {
    k.vault(IN - NAVE, 9, AH - 9, CROSS0, s * (NAVE + IN) / 2, 0, M.vault, { tile: 3 });
    k.vault(OUT - IN, 9, AH - 9, CROSS0, s * (IN + OUT) / 2, 0, M.vault, { tile: 3 });
    k.vault(IN - NAVE, 9, AH - 9, APSE - CROSS1, s * (NAVE + IN) / 2, CROSS1, M.vault, { tile: 3 });
  }
  // flat ceilings over the aisles' crowns and the transept's corners (hidden seams)
  for (const s of [-1, 1]) k.box(TR - NAVE, 0.3, CROSS1 - CROSS0, s * (TR + NAVE) / 2, H + 0.15, (CROSS0 + CROSS1) / 2, M.vault, { tile: 3, flat: true });

  // ribs: transverse arches across the nave at each bay (thin stone bands on the vault)
  for (let z = BAY; z < APSE; z += BAY) {
    if (z > CROSS0 - 1 && z < CROSS1 + 1) continue;
    for (let i = 0; i < 6; i++) {
      const a0 = i / 6;
      const a1 = (i + 1) / 6;
      const px = (a: number) => -NAVE + a * NAVE * 2;
      const py = (a: number) => 17 + (H - 17) * Math.sin(a * Math.PI) ** 0.8;
      const x0 = px(a0);
      const x1 = px(a1);
      const y0 = py(a0);
      const y1 = py(a1);
      const len = Math.hypot(x1 - x0, y1 - y0);
      k.box(len, 0.35, 0.35, (x0 + x1) / 2, (y0 + y1) / 2 - 0.1, z, M.stoneDark, { rz: Math.atan2(y1 - y0, x1 - x0), flat: true });
    }
  }

  // the piers and arcades: clustered piers on the nave's and the aisles' lines
  const pier = (x: number, z: number, top: number, big = false) => {
    const r = big ? 1.1 : 0.72;
    k.cyl(r + 0.15, r + 0.2, 0.6, x, 0, z, M.stoneDark, { seg: 8 });
    k.cyl(r, r, top - 0.6, x, 0.6, z, M.stone, { seg: 8, tile: 2, solid: true });
    // two shafts of the cluster, on the sides that face the walks
    for (const a of [0, Math.PI]) k.cyl(0.2, 0.2, top - 0.6, x + Math.cos(a) * r, 0.6, z, M.stone, { seg: 5, tile: 2 });
    k.box(r * 2 + 0.6, 0.5, r * 2 + 0.6, x, top + 0.25, z, M.stoneDark, { tile: 1 });
  };
  for (const s of [-1, 1]) {
    for (let i = 1; i * BAY < CROSS0 - 1; i++) {
      pier(s * NAVE, i * BAY, 8);
      pier(s * IN, i * BAY, 6);
      // vaulting shafts up the nave wall to the vault's springing
      k.cyl(0.22, 0.22, 17 - 8.5, s * (NAVE - 0.55), 8.5, i * BAY, M.stone, { seg: 5, tile: 2 });
    }
    for (let z = CROSS1 + 4.5; z < APSE - 1; z += 4.5) pier(s * NAVE, z, 8);
    // the crossing's four great piers
    pier(s * NAVE, CROSS0, 13, true);
    pier(s * NAVE, CROSS1, 13, true);
  }
  // arcade walls: pointed arches between the piers (turned to run along z)
  for (const s of [-1, 1]) {
    for (let i = 0; i * BAY < CROSS0 - 1; i++) {
      const z = i * BAY + BAY / 2;
      if (i === 0) continue; // the first bay opens under the west gallery
      k.archWall(BAY, AH, 0.8, BAY - 1.5, 8, 12.2, s * NAVE, 0, Math.min(z, CROSS0 - BAY / 2), M.stone, { ry: Math.PI / 2, tile: 2.4 });
      k.archWall(BAY, 9, 0.6, BAY - 1.3, 6, 8.6, s * IN, 0, Math.min(z, CROSS0 - BAY / 2), M.stone, { ry: Math.PI / 2, tile: 2.4 });
    }
    // the crossing arches into the transept arms, and the choir's arcade toward the ambulatory
    k.archWall(CROSS1 - CROSS0, H, 0.9, CROSS1 - CROSS0 - 2.2, 13, 21.5, s * NAVE, 0, (CROSS0 + CROSS1) / 2, M.stone, { ry: Math.PI / 2, tile: 2.4 });
    for (let z = CROSS1; z < APSE - 1; z += 4.5) k.archWall(4.5, AH, 0.8, 3.2, 8, 11.4, s * NAVE, 0, z + 2.25, M.stone, { ry: Math.PI / 2, tile: 2.4 });
  }
  // the crossing arches over the nave (toward the west and into the choir)
  k.archWall(NAVE * 2, H, 0.9, NAVE * 2 - 2.2, 13, 21.5, 0, 0, CROSS0, M.stone, { tile: 2.4 });
  k.archWall(NAVE * 2, H, 0.9, NAVE * 2 - 2.2, 13, 21.5, 0, 0, CROSS1, M.stone, { tile: 2.4 });

  // windows: the aisles' tall lancets, the clerestory, the transept ends, the apse
  const glassDefs: Array<ReturnType<typeof glassMat>> = [glassMat("grisaille", 11), glassMat("colour", 12), glassMat("grisaille", 13), glassMat("colour", 14)];
  const shaftFrom: THREE.Vector3[] = [];
  for (const s of [-1, 1]) {
    for (let i = 0; i * BAY < CROSS0 - 1; i++) {
      const z = i * BAY + BAY / 2;
      const gd = glassDefs[(i + (s > 0 ? 1 : 0)) % 2 === 0 ? 0 : i % 3 === 1 ? 1 : 2].def;
      if (i > 0) k.plane(2.4, 6.8, s * (OUT - 0.02), 6, z, gd, { ry: -s * Math.PI / 2 });
      k.plane(3.2, 3.4, s * (NAVE - 0.47), 15.1, z, glassDefs[i % 4 === 2 ? 3 : 2].def, { ry: -s * Math.PI / 2 });
      if (s > 0 && i >= 1 && i <= 5) shaftFrom.push(new THREE.Vector3(NAVE - 0.5, 15, z));
    }
    k.plane(6, 10, s * (TR - 0.02), 16, (CROSS0 + CROSS1) / 2, glassDefs[1].def, { ry: -s * Math.PI / 2 });
    for (let z = CROSS1 + 2.25; z < APSE - 1; z += 4.5) k.plane(2.2, 3.2, s * (NAVE - 0.47), 15.1, z, glassDefs[3].def, { ry: -s * Math.PI / 2 });
    for (let z = CROSS1 + 3; z < APSE - 1; z += 6) k.plane(2.2, 6.4, s * (IN - 0.02), 6, z, glassDefs[0].def, { ry: -s * Math.PI / 2 });
  }
  for (const x of [-3.2, 0, 3.2]) k.plane(2.2, 8, x, 18.5, APSE - 0.02, glassDefs[3].def, { ry: Math.PI });

  // the west gallery and the organ's case (1657), pipes in flats
  k.box(NAVE * 2, 0.5, 4.6, 0, 7, 2.3, M.stoneDark, { tile: 1.6 });
  k.box(NAVE * 2, 1.1, 0.25, 0, 7.8, 4.55, M.oakDark, { tile: 1 });
  for (const x of [-4.4, 4.4]) k.cyl(0.35, 0.35, 6.75, x, 0, 4.2, M.stone, { seg: 8, solid: true });
  k.box(9, 9.5, 1.8, 0, 12.2, 1.3, M.oakDark, { tile: 1.4 });
  for (const x of [-3.9, 0, 3.9]) k.box(2.2, 11, 2.1, x, 12.9, 1.5, M.oak, { tile: 1.4 });
  for (const x of [-3.9, 0, 3.9]) k.box(2.6, 0.5, 2.3, x, 18.6, 1.5, M.gilt);
  for (let i = 0; i < 27; i++) {
    const x = -4.6 + (i * 9.2) / 26;
    const flat = Math.abs(((i % 9) - 4) / 4);
    const h = 2.4 + (1 - flat) * 2.4;
    k.cyl(0.1, 0.1, h, x, 8.6 + (1 - flat) * 0.4, 2.62, M.tin, { seg: 5 });
  }
  const organist: Mark = { x: 0, z: 3.6, yaw: Math.PI, y: 7.25 };

  // the high altar: three steps, the table, the tabernacle, six candlesticks, the marble retable with the Assumption
  const AZ = APSE - 3.2;
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
  // the retable: black marble columns with gilt capitals, the painting between, the entablature and the crown
  for (const x of [-3.6, -2.8, 2.8, 3.6]) {
    k.cyl(0.3, 0.3, 8.5, x, 1.2, APSE - 0.9, M.marbleB, { seg: 8, tile: 1 });
    k.box(0.8, 0.5, 0.8, x, 9.95, APSE - 0.9, M.gilt);
  }
  k.box(9, 1.2, 1.4, 0, 10.8, APSE - 0.9, M.marbleB, { tile: 1 });
  k.box(9.4, 0.3, 1.6, 0, 11.55, APSE - 0.9, M.gilt);
  k.box(5, 2.2, 0.8, 0, 12.8, APSE - 0.7, M.marbleW, { tile: 1 });
  k.box(1.2, 1.4, 0.5, 0, 14.6, APSE - 0.6, M.gilt);
  k.box(4.9, 7.4, 0.3, 0, 6.2, APSE - 0.55, M.gilt); // the painting's gilt frame
  k.plane(4.5, 7.0, 0, 6.2, APSE - 0.39, paintMat("assumption"), { ry: Math.PI });
  k.box(12, 1.2, 1.2, 0, 1.2, APSE - 0.8, M.marbleB, { tile: 1 });
  // the communion rail across the choir's mouth (white marble balusters, a black top), and low screens along the choir
  const RAILZ = CROSS1 + 0.9;
  k.box(NAVE * 2 - 0.2, 0.12, 0.4, 0, 0.98, RAILZ, M.marbleB, { tile: 0.8 });
  for (let x = -5.7; x <= 5.7; x += 0.3) k.cyl(0.06, 0.08, 0.9, x, 0.04, RAILZ, M.marbleW, { seg: 5 });
  const jefOnly: Rect[] = [{ minX: -NAVE, maxX: NAVE, minZ: RAILZ - 0.25, maxZ: RAILZ + 0.25 }];
  for (const s of [-1, 1]) {
    for (let z = CROSS1 + 0.6; z < APSE - 0.5; z += 4.5) {
      const gate = s > 0 && z > 70 && z < 72.5;
      if (!gate) k.box(0.3, 1.5, 3.6, s * NAVE, 0.75, z + 2.25, M.oakDark, { tile: 1 });
    }
    jefOnly.push({ minX: s > 0 ? NAVE - 0.4 : -NAVE - 0.4, maxX: s > 0 ? NAVE + 0.4 : -NAVE + 0.4, minZ: CROSS1, maxZ: APSE });
  }
  // the sanctuary lamp, red, hanging before the altar
  const redGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff4020, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9 }));
  redGlow.scale.set(0.6, 0.6, 1);
  redGlow.position.set(0, 5, AZ - 4);
  group.add(redGlow);
  k.cyl(0.015, 0.015, H - 5.2, 0, 5.2, AZ - 4, M.iron, { seg: 3 });
  k.cyl(0.18, 0.08, 0.3, 0, 4.85, AZ - 4, M.brass, { seg: 6 });

  // Rubens's two triptychs in the transept: the Elevation (north arm, -x) and the Descent (south arm, +x), wings open, in marble frames over altars
  const triptych = (s: number, kind: "elevation" | "descent") => {
    const x = s * (TR - 0.3);
    const z = (CROSS0 + CROSS1) / 2;
    const ry = -s * Math.PI / 2;
    k.box(0.5, 1.1, 3.4, s * (TR - 0.8), 0.55, z, M.marbleB, { tile: 1, solid: true });
    k.box(0.6, 0.06, 3.6, s * (TR - 0.8), 1.13, z, M.linen);
    k.box(0.25, 7.4, 5.6, x, 5.6, z, M.black, { tile: 1 });
    k.box(0.3, 0.25, 5.8, x - s * 0.05, 9.35, z, M.gilt);
    k.box(0.3, 0.25, 5.8, x - s * 0.05, 1.85, z, M.gilt);
    k.plane(4.6, 6.8, x - s * 0.14, 5.6, z, paintMat(kind), { ry });
    // the wings, open and angled toward the room
    for (const w of [-1, 1]) {
      const wz = z + w * (2.8 + 1.0);
      k.box(0.15, 6.8, 2.1, x - s * 0.5, 5.6, wz, M.black, { ry: w * s * 0.35 });
      k.plane(1.9, 6.4, x - s * 0.6, 5.6, wz, paintMat("saint", kind === "elevation" ? 2 + w : 5 + w), { ry: ry + w * s * 0.35 });
    }
    k.box(0.6, 1.4, 6.6, x - s * 0.1, 10.3, z, M.marbleB, { tile: 1 });
    k.box(0.5, 0.9, 1.4, x - s * 0.1, 11.4, z, M.gilt);
  };
  triptych(-1, "elevation");
  triptych(1, "descent");

  // the pulpit (Van der Voort, 1713): an oak tree trunk, a tub among branches, birds, a sounding board, the stair round a pier
  const PX = -NAVE + 1.1;
  const PZ = 5 * BAY;
  k.cyl(0.32, 0.45, 2.3, PX, 0, PZ, M.oakDark, { seg: 7, solid: true });
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
  k.solid(1.2, 2.4, PX, PZ - 0.6);

  // confessionals (baroque, carved oak) along the aisle walls; the curate's is the middle one on the south wall
  const confessional = (s: number, z: number) => {
    const x = s * (OUT - 0.75);
    k.box(1.4, 3.1, 3.6, x, 1.55, z, M.oakDark, { tile: 1, solid: true });
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
  for (const z of [2 * BAY, 4 * BAY, 6 * BAY]) confessional(1, z);
  for (const z of [3 * BAY, 5 * BAY]) confessional(-1, z);
  const CONF_Z = 4 * BAY;
  const confessor: Mark = { x: OUT - 0.75, z: CONF_Z, yaw: -Math.PI / 2 };
  const penitent: Mark = { x: OUT - 1.75, z: CONF_Z - 1.25, yaw: Math.PI / 2 };

  // the Lady altar at the east end of the north outer aisle, with its statue and the stand of candles
  const LX = -(IN + OUT) / 2;
  const LZ = CROSS0 - 1.2;
  k.box(3, 1.0, 1.0, LX, 0.5, LZ, M.marbleW, { solid: true });
  k.box(3.2, 0.06, 1.1, LX, 1.03, LZ, M.linen);
  k.box(1.6, 0.9, 0.6, LX, 1.5, LZ + 0.2, M.gilt);
  k.cyl(0.2, 0.42, 1.3, LX, 1.95, LZ + 0.2, M.blue, { seg: 7 });
  k.cyl(0.13, 0.13, 0.28, LX, 3.25, LZ + 0.2, M.statue, { seg: 6 });
  k.cyl(0.25, 0.25, 0.04, LX, 3.6, LZ + 0.2, M.gilt, { seg: 8 });
  const STAND: Mark = { x: LX, z: LZ - 2.2, yaw: 0 };
  k.box(1.8, 0.05, 0.5, LX, 0.95, STAND.z, M.iron, { solid: true });
  k.box(1.6, 0.05, 0.4, LX, 1.2, STAND.z + 0.1, M.iron);
  k.box(1.4, 0.05, 0.3, LX, 1.45, STAND.z + 0.2, M.iron);
  for (const x of [-0.8, 0.8]) k.cyl(0.03, 0.03, 1.45, LX + x, 0, STAND.z, M.iron, { seg: 3 });
  // an altar of the Sacrament in the south outer aisle, and one in each transept arm's east wall
  const sideAltar = (x: number, z: number, ry: number, paintSeed: number) => {
    k.box(2.6, 1.0, 0.9, x, 0.5, z, M.marbleB, { ry, solid: true });
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
  sideAltar((IN + OUT) / 2, CROSS0 - 1.2, 0, 7);
  sideAltar(-21, CROSS1 - 0.9, 0, 8);
  sideAltar(21, CROSS1 - 0.9, 0, 9);
  // paintings in black frames on the aisle walls between the windows
  for (const s of [-1, 1])
    for (let i = 1; i * BAY < CROSS0 - 3; i += 2) {
      const z = i * BAY;
      k.box(0.12, 2.6, 2.0, s * (OUT - 0.08), 3.4, z, M.black);
      k.plane(1.7, 2.3, s * (OUT - 0.16), 3.4, z, paintMat(i % 3 ? "saint" : "portrait", 10 + i), { ry: -s * Math.PI / 2 });
    }

  // the chairs in the nave: rush seats, rows either side of the middle walk
  const chairs: Mark[] = [];
  const seats: Seat[] = [];
  const ROW0 = 10;
  const ROWS = 24;
  const ROWD = 1.4;
  const CX = [1.45, 2.2, 2.95, 3.7, 4.45];
  for (let r = 0; r < ROWS; r++) {
    const z = ROW0 + r * ROWD;
    for (const s of [-1, 1]) {
      for (const cx of CX) {
        const x = s * cx;
        k.box(0.44, 0.05, 0.42, x, 0.45, z, M.rush, { tile: 0.4 });
        k.plane(0.42, 0.95, x, 0.48, z - 0.21, chairBack, { flat: false });
        k.plane(0.42, 0.44, x, 0.22, z + 0.19, chairBack, { flat: false });
        chairs.push({ x, z: z + 0.02, yaw: 0, y: 0 });
      }
      k.solid(CX[CX.length - 1] - CX[0] + 0.5, 0.46, s * (CX[0] + CX[CX.length - 1]) / 2, z - 0.02);
      // the chair at the aisle end: Jef may sit there
      seats.push({ x: s * CX[0], z: z + 0.1, yaw: 0, table: r, h: 0.46, via: [] });
    }
  }
  // brass chandeliers over the nave (lit at dusk), on chains from the vault
  const chandeliers: Array<[number, number]> = [[0, 16], [0, 28], [0, 40]];
  for (const [x, z] of chandeliers) {
    k.cyl(0.02, 0.02, H - 9.6, x, 9.6, z, M.iron, { seg: 3 });
    k.cyl(0.9, 0.9, 0.08, x, 9.2, z, M.brass, { seg: 10, open: true });
    k.cyl(0.12, 0.12, 0.7, x, 8.9, z, M.brass, { seg: 6 });
  }

  // the font by the west door
  k.cyl(0.55, 0.3, 1.0, -9.5, 0, 3.2, M.marbleB, { seg: 8, solid: true });
  k.cyl(0.62, 0.62, 0.12, -9.5, 1.0, 3.2, M.marbleW, { seg: 8 });

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
  naveL.position.set(0, 8, 28);
  group.add(naveL);
  const shaftMat = shaftMaterial();
  for (const f of shaftFrom) lightShaft(group, f, new THREE.Vector3(1.2 + (f.z % 2), 0, f.z + 3), 1.5, shaftMat);

  // walking: the nave and aisles, the transept, the ambulatory; not into the choir (the rail and the screens)
  const floors: Rect[] = [
    { minX: -OUT + 0.3, maxX: OUT - 0.3, minZ: 0.4, maxZ: CROSS0 + 0.5 },
    { minX: -TR + 0.3, maxX: TR - 0.3, minZ: CROSS0, maxZ: CROSS1 - 0.2 },
    { minX: -IN + 0.3, maxX: -NAVE - 0.5, minZ: CROSS1 - 0.5, maxZ: APSE - 0.3 },
    { minX: NAVE + 0.5, maxX: IN - 0.3, minZ: CROSS1 - 0.5, maxZ: APSE - 0.3 },
    { minX: -NAVE + 0.2, maxX: NAVE - 0.2, minZ: CROSS1 - 0.5, maxZ: APSE - 0.3 },
  ];
  const walkJef = rectWalker(floors, [...k.solids, ...jefOnly]);
  const free = freeFn(floors, k.solids);
  const nodes: Array<[number, number]> = [];
  for (const x of [-16.5, -9.5, 0, 9.5, 16.5]) for (const z of [2.5, 7.5, 20, 33, 46.8]) nodes.push([x, z]);
  for (const x of [-25, -18, -9.5, 0, 9.5, 18, 25]) nodes.push([x, 56]);
  for (const s of [-1, 1]) for (const z of [64, 70.5, 77, 82]) nodes.push([s * 9.5, z]);
  nodes.push([4.5, 70.5], [2.2, 74.5], [0, 64.5], [0, 61.4], [-5.25, 7.5], [5.25, 7.5]);
  const path = walkGraph(nodes, free);

  const marks: Record<string, Mark> = {
    altar: { x: 0, z: AZ - 0.1, yaw: 0, y: 0.9 },
    server: { x: 1.7, z: AZ - 0.8, yaw: -Math.PI / 2, y: 0.72 },
    sacristy: { x: 9.5, z: 70.5, yaw: 0 },
    gate: { x: 4.5, z: 70.5, yaw: -Math.PI / 2, y: 0.36 },
    choirFront: { x: 0, z: RAILZ + 1.4, yaw: Math.PI, y: 0.36 },
    railN: { x: -0.45, z: RAILZ - 0.6, yaw: 0 },
    railS: { x: 0.45, z: RAILZ - 0.6, yaw: 0 },
    beadleMass: { x: -1.0, z: CROSS0 - 3.2, yaw: Math.PI },
    chairsPost: { x: -NAVE + 0.8, z: 7.6, yaw: Math.PI / 2 },
    organist,
    confessor,
    penitent,
    stand: STAND,
    pulpit: { x: PX, z: PZ, yaw: Math.PI / 2, y: 2.4 },
    // M6 sermon: the preacher waits at the foot of the pulpit's stair during high mass, then climbs
    preacherWait: { x: PX - 0.3, z: PZ - 2.3, yaw: Math.PI / 2 },
    pulpitFoot: { x: PX - 0.45, z: PZ - 1.35, yaw: 0 },
    door: { x: 0, z: 1.6, yaw: 0 },
  };
  const sets: Record<string, Mark[]> = {
    chairs,
    standAt: [
      { x: LX - 0.6, z: STAND.z - 0.75, yaw: 0 },
      { x: LX + 0.6, z: STAND.z - 0.75, yaw: 0 },
      { x: LX, z: STAND.z - 0.9, yaw: 0 },
    ],
    chapels: [
      { x: (IN + OUT) / 2, z: CROSS0 - 2.6, yaw: 0 },
      { x: -21, z: CROSS1 - 2.3, yaw: 0 },
      { x: 21, z: CROSS1 - 2.3, yaw: 0 },
      { x: -TR + 3.2, z: (CROSS0 + CROSS1) / 2 - 0.8, yaw: -Math.PI / 2 },
      { x: TR - 3.2, z: (CROSS0 + CROSS1) / 2 + 0.8, yaw: Math.PI / 2 },
    ],
    beadleRound: [
      { x: -9.5, z: 7.5, yaw: 0 },
      { x: -9.5, z: 46.8, yaw: 0 },
      { x: 9.5, z: 46.8, yaw: 0 },
      { x: 9.5, z: 7.5, yaw: 0 },
    ],
    chairsWalk: [
      { x: -0.75, z: 10, yaw: 0 },
      { x: -0.75, z: 43, yaw: 0 },
      { x: 0.75, z: 43, yaw: Math.PI },
      { x: 0.75, z: 10, yaw: Math.PI },
    ],
    curateWalk: [
      { x: 9.5, z: 70.5, yaw: 0 },
      { x: 9.5, z: 82, yaw: 0 },
      { x: -9.5, z: 82, yaw: 0 },
      { x: -9.5, z: 64, yaw: 0 },
      { x: 9.5, z: 64, yaw: 0 },
    ],
  };
  const looks: Lookable[] = [
    { id: "elevation", x: -TR + 3.2, z: (CROSS0 + CROSS1) / 2, r: 3.5, label: "look at the Elevation of the Cross", text: "Rubens's Elevation of the Cross, the great triptych, back in Antwerp since 1815. In the gloom you make out the cross going up on a slant and the men straining at its foot; the wings stand open, dark with old varnish." },
    { id: "descent", x: TR - 3.2, z: (CROSS0 + CROSS1) / 2, r: 3.5, label: "look at the Descent from the Cross", text: "Rubens's Descent from the Cross. A pale body slides down a white sheet into many hands; a red cloak catches what light there is. Men of the guild of arquebusiers paid for it, two hundred and sixty years ago." },
    { id: "assumption", x: 0, z: RAILZ - 1.0, r: 2.2, label: "look at the high altar", text: "Over the high altar, in black and white marble and gold, Our Lady rises into a golden light: Rubens again, his Assumption. The red lamp before the tabernacle never goes out." },
    { id: "pulpit", x: PX + 1.6, z: PZ, r: 1.8, label: "look at the pulpit", text: "The pulpit is carved oak, all of it: tree trunks and branches, birds on the twigs, the preacher's tub among the leaves. It came from the abbey at Hemiksem when the French closed it." },
    { id: "organ", x: 0, z: 6.2, r: 2.2, label: "look up at the organ", text: "Up on the west gallery the organ's carved case, black with age, fills the end of the nave to the vault. Tin pipes in their flats catch the light." },
    { id: "font", x: -9.5, z: 4.6, r: 1.6, label: "look at the font", text: "The font by the door, black marble with a white rim. A drop of holy water on your fingers is cold as the Schelde." },
    { id: "slab", x: 12, z: 20, r: 1.4, label: "read a grave slab", text: "A worn slab in the floor: a merchant, his wife and a date two hundred years gone. Ten thousand boots have walked his name smooth." },
  ];

  const lampPts = { altar: toWorld(0, AZ, 3.3), lady: toWorld(LX, STAND.z, 1.4), chand: toWorld(0, 28, 9.3) };
  let lit = false;
  let day = 1;
  const room: LandmarkRoom = {
    kind: "landmark",
    landmark: "cathedral",
    scene,
    group,
    walk: walkJef,
    seats,
    stands: [],
    exit: { x: 0, z: 1.0, yaw: Math.PI },
    entry: { x: 0, z: 1.6, yaw: 0 },
    entries: { main: { x: 0, z: 1.6, yaw: 0 } },
    exits: { main: { x: 0, z: 1.0, yaw: Math.PI } },
    lamps: [],
    toWorld,
    floor: (x, z) => (Math.abs(x) < NAVE && z > CROSS1 + 0.3 ? (Math.abs(x) < 3.5 && z > AZ - 2.3 ? 0.36 + Math.min(3, Math.floor((z - (AZ - 2.3)) / 0.55) + 1) * 0.18 : 0.36) : 0),
    peopleFloor: (x, z) => (Math.abs(x) < NAVE && z > CROSS1 + 0.3 ? (Math.abs(x) < 3.5 && z > AZ - 2.3 ? 0.36 + Math.min(3, Math.floor((z - (AZ - 2.3)) / 0.55) + 1) * 0.18 : 0.36) : 0),
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
    setDaylight(kd) {
      day = kd;
      hemi.intensity = 0.8 + 1.6 * kd;
      amb.intensity = 0.6 + 0.4 * kd;
      for (const g of glassDefs) {
        g.mat().color.setScalar(0.12 + 0.95 * kd);
      }
      shaftMat.opacity = Math.max(0, kd - 0.25) * 0.13;
      chand.showFirst(kd < 0.35 ? 36 : 0);
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
