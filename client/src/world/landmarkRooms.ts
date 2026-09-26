import * as THREE from "three";
import type { LandmarkId } from "../../../shared/landmarks";
import { type Room, type Spot } from "./rooms";
import { ashlar, glass, lmBasic, lmMat, marble, matOf, painting, slabs, whitewash, type MatDef, type Rect } from "./landmarkKit";
import { tex } from "./rooms";

// The landmark halls (M6 landmark interiors), built in code in the PS1 way (world/landmarkKit.ts):
// the cathedral in world/cathedralHall.ts; the town hall, the Vleeshuis, the Steen and the Oostershuis in
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
  // (bump maps on every floor, 2026-09-26: the last number, metres of relief from the map's own colour)
  stone: lmMat("lm_stone", { map: ashlar(1), color: 0xd8ccb4 }, 0.1, 0.01),
  stoneDark: lmMat("lm_stone_dark", { map: ashlar(2, [120, 112, 100]), color: 0xb0a898 }, 0.1, 0.01),
  vault: lmMat("lm_vault", { map: whitewash(3), color: 0xd8d0bc, side: THREE.DoubleSide }, 0.05),
  floor: lmMat("lm_slabs", { map: slabs(2), color: 0xe0dcd4 }, 0.1, 0.01),
  oak: lmMat("lm_oak", { map: tex().planks, color: 0x6a4a30 }, 0.2, 0.005),
  oakDark: lmMat("lm_oak_dark", { map: tex().planks, color: 0x5e4028 }, 0.2, 0.005),
  rush: lmMat("lm_rush", { map: tex().sack, color: 0xb09a60 }, 0.2),
  marbleW: lmMat("lm_marble_w", { map: marble(false), color: 0xe8e4dc }, 0.1, 0.003),
  marbleB: lmMat("lm_marble_b", { map: marble(true), color: 0x9a9a9a }, 0.1, 0.003),
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

// The cathedral's hall is built in world/cathedralHall.ts (buildCathedral).
