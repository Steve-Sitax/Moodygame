import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import CITY from "../../../shared/city.json";
import { bumpFromMap, psx, psxUniforms } from "../retro/psx";
import { createMirror } from "./mirror";
import { setPuddleScale } from "./puddlemask";
import { TOWN } from "./townBox";
import { cobblePaving, earthPaving, EDGE_BUMP, edgeStoneTextures, flagPaving, grassPaving, quayPaving, withPictures } from "./paving";
import { COPE, COPE_SECTION, QUAY_COPE_ALONG, QUAY_WALL_ALONG, QUAY_Y_LO, quayCopingMaps, quayWallMaps, wallV } from "./quayStone";
import { grimeDecalMaterial, houseGrime } from "./houseGrime";
import { brickBandTexture, facadeAtlas, grimeDecals, glassTexture, leafTexture, roofAtlas, slateTexture, stoneTexture } from "./cityTextures";
import { makeTextures } from "./textures";
import { masonryCuts, masonryShade } from "./quaysteps";
import { DOCK_Y, regionAt } from "./tide";

/** The quay walls' and copings' bump from their height maps (quay_maps.py; three.js per screen pixel, rendering.md). */
const QUAY_BUMP = 2;
/** The light off the water on the quay walls: how strong a share of the sky's light (cathedralOutside.ts skyFill). */
const WATER_FILL = 0.7;
/** Its colour: the sky's, drawn toward a warm grey (cathedralOutside.ts WARM; Godot's Daylight.cs FillWarm). */
const FILL_WARM = new THREE.Color(0.62, 0.6, 0.56);

// Antwerp, 1873, traced from the Vuillaume map (CC0) and built in Blender
// (tools/city, tools/blender). This module lays the ground and the quays, loads
// the houses, and answers "can I walk here?" from the walk map.

export interface Door {
  x: number;
  z: number;
  out: [number, number];
  width: number;
}

interface CityJson {
  area: number[][];
  land: number[][];
  quays: number[][];
  landmarks: Record<string, { fp: number[][] }>;
  doors: Record<string, Door>;
  bridges: Record<string, number[]>;
  walk: { x0: number; z0: number; res: number; w: number; h: number; file: string };
}

const data = CITY as unknown as CityJson;

const WATER_RINGS = (CITY as unknown as { water: Array<{ outer: number[][] }> }).water.map((w) => w.outer);
/** Is (x, z) on the water (the river, the dock, the canals, the moat)? Even-odd over the water outlines. */
function inWaterPoly(x: number, z: number): boolean {
  let inside = false;
  for (const ring of WATER_RINGS)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i];
      const [xj, zj] = ring[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
  return inside;
}

export const DOORS = data.doors;

const EDGE = (CITY as unknown as { rijnkaaiEdge: Array<[number, number]> }).rijnkaaiEdge;
/** The river edge of the Rijnkaai: first dry z at this x (x from -70 to 90). */
export function edgeZ(x: number): number {
  const i = Math.max(0, Math.min(EDGE.length - 2, Math.floor(x - EDGE[0][0])));
  const [x0, z0] = EDGE[i];
  const [, z1] = EDGE[i + 1];
  return z0 + (z1 - z0) * Math.max(0, Math.min(1, x - x0));
}

/** A point just outside a door, `d` metres out, `side` metres along the wall. */
export function doorSpot(name: string, d = 1.5, side = 0): { x: number; z: number; face: [number, number] } {
  const door = DOORS[name];
  const [ox, oz] = door.out;
  return { x: door.x + ox * d - oz * side, z: door.z + oz * d + ox * side, face: [-ox, -oz] };
}

export const WALL = 1;
export const WATER = 2;
export const OUTSIDE = 4;

export interface CityWorld {
  group: THREE.Group;
  /** Resolves when the houses and the walk map are loaded. */
  ready: Promise<void>;
  /** Flags at a point: WALL, WATER, OUTSIDE (0 = open ground). Undefined until the walk map is in. */
  flags(x: number, z: number): number | undefined;
  /** Hide house chunks beyond the fog. */
  update(camera: THREE.Camera, far: number): void;
  landmarks: CityJson["landmarks"];
  /**
   * Where build_city.py put openings the plan does not say (city.glb node "city_openings"), by house index: the alley
   * cottages' windows [wall, s_mid, width, y0, y1] (walls 0 front, 1 right, 2 back, 3 left; s from the wall's first
   * corner), the ground bays built as plain wall, the covered passages. Null until the houses are in.
   */
  openings(): CityOpenings | null;
}

export interface CityOpenings {
  cottages: Record<string, Array<[number, number, number, number, number]>>;
  plain_ground: Record<string, Array<[number, number, number]>>;
  poorts: Record<string, unknown>;
}

const LANDMARK_HEIGHT: Record<string, number> = {
  cathedral: 28,
  stadhuis: 20,
  vleeshuis: 22,
  steen: 12,
  carolus: 24,
  stpaul: 20,
  stjacob: 24,
  hanzehuis: 16,
};

/**
 * The landmarks' materials by the name their glb gives them (stone, slate, lead, gilt, brickband, glass; and each
 * "<building>_atlas" once landmarks.glb is in), for a landmark with a model of its own that keeps their look
 * (issue #28: world/oostershuisShell.ts). Null until the city is built.
 */
let landmarkMats: Record<string, THREE.Material> | null = null;
export function landmarkMaterials(): Readonly<Record<string, THREE.Material>> | null {
  return landmarkMats;
}

/**
 * The quay wall's stone and its coping (2026-10-11): the flights of steps down the walls (world/quaysteps.ts) are
 * built of the same stone, in the same material, so they read as part of the wall. Null until the city is built.
 */
let quayMats: { wall: THREE.Material; coping: THREE.Material } | null = null;
export function quayStoneMaterials(): { wall: THREE.Material; coping: THREE.Material } | null {
  return quayMats;
}

export function buildCity(scene: THREE.Scene, mats: { cobble: THREE.Material; quayWall: THREE.Material; wallDecal: THREE.Material }, waterY: number): CityWorld {
  const group = new THREE.Group();
  group.name = "city";
  scene.add(group);

  // the street mirrored in the puddles (world/mirror.ts), drawn only while there are puddles.
  // M7 rendering: 320 x 180 like the river's (was 480 x 270, as many pixels as the whole view)
  // (every frame, outside the mirrors' budget: an older picture lagged behind at Jef's feet; and only what stands
  // within 50 m, Steve 2026-09-28)
  const groundMirror = createMirror(0, { width: 320, height: 180, name: "puddles", enabled: () => psxUniforms.uPuddle.value > 0.01, everyFrame: true, reach: 50 });
  psxUniforms.uMirror.value = groundMirror.texture;
  psxUniforms.uMirrorMat.value = groundMirror.matrix;

  // --- ground: the kinds of paving (tools/city/plan.py ground_zones): granite setts on the
  // working quays (quays pass 2; was earth), earth in the yards and on the gate roads, flagstones
  // on the squares, cobbles in the streets, grass by the town wall. The land is a
  // few large triangles: no vertex snap and no affine warp on it, or it swirls (the
  // texture uses world coordinates, so it stays straight).
  {
    const cob = mats.cobble as THREE.MeshPhongMaterial;
    const zones = (data as unknown as { ground?: Record<string, number[][]> }).ground ?? { cobble: data.land };
    const earthPave = earthPaving();
    // cobbles and flagstones with height maps (world/paving.ts): they stand up (psx relief)
    const cobPave = cobblePaving();
    // "not too clean, as it was then" (Steve, 2026-09-25): the street cobbles, muddy setts with dung and straw (3 m a
    // tile). 2026-09-27 (Steve: "big strokes of stone that seem higher", "they repeat like texture mapping repeats"):
    // the stones laid again from the Codex picture's own stone and mud (tools/textures/street_cobble_synth.py), so the
    // height and the stone map are the same stones as the colour; each stone rolls its own dice (tone, sunk, gone) in
    // each tile. The painted one shows until they load; colour, height and stones swap in together.
    withPictures(cobPave, { map: "/textures/street_cobble.jpg", height: "/textures/street_cobble_h.png", id: "/textures/street_cobble_id.png" });
    const flagPave = flagPaving();
    const grassPave = grassPaving();
    const quayPave = quayPaving();
    // the pictures (Codex, 2026-09-25) with a height and stone map worked out from them (tools/textures/setts_maps.py)
    withPictures(quayPave, { map: "/textures/quay_setts.jpg", height: "/textures/quay_setts_h.png", id: "/textures/quay_setts_id.png" });
    const zoneMat: Record<string, [THREE.Material, number]> = {
      // bump maps from the texture itself: light stone stands up, dark joints sink, so the
      // sun and the gas lamps pick out every sett (Steve: "bump mapping?")
      cobble: [psx(new THREE.MeshPhongMaterial({ map: cobPave.map, color: 0xffffff, specular: cob.specular, shininess: cob.shininess }), { noSnap: true, affine: 0, wet: true, puddles: 1, vary: 1, relief: { height: cobPave.height, id: cobPave.id, holes: 1, depth: 0.025, tile: 3, bump: 2.6 } }), 3],
      // packed earth with its own height map: lumps, pebbles, hollows (world/paving.ts)
      earth: [psx(new THREE.MeshLambertMaterial({ map: earthPave.map }), { noSnap: true, affine: 0, wet: true, puddles: 1.3, vary: 1, detile: true, relief: { height: earthPave.height, depth: 0.045, tile: 4, bump: 3.2 } }), 4],
      flags: [psx(new THREE.MeshPhongMaterial({ map: flagPave.map, specular: 0x1a1a1a, shininess: 12 }), { noSnap: true, affine: 0, wet: true, puddles: 0.75, vary: 0.8, relief: { height: flagPave.height, id: flagPave.id, holes: 0, depth: 0.025, tile: 4, bump: 1.6, dome: 0 } }), 4],
      // quays pass 2 (2026-09-25): the working quays along the river and the dock in big granite setts with mud
      // in the joints (world/paving.ts quayPaving); more puddles than the streets, the stones rolled per stone.
      // No detile (bump maps checked, 2026-09-26): its copy turned 37 deg laid a second grid of setts across the
      // rows, on half the quay; the per-stone tones, the patches and the dirt keep the tile from showing
      quay: [psx(new THREE.MeshPhongMaterial({ map: quayPave.map, color: 0xffffff, specular: 0x363636, shininess: 22 }), { noSnap: true, affine: 0, wet: true, puddles: 1.15, vary: 1, relief: { height: quayPave.height, id: quayPave.id, holes: 0.07, depth: 0.06, tile: 2.5, bump: 3.2 } }), 2.5],
      // grass round the town wall and in the back alleys' gardens (tools/city/rampart.py, alleys.py)
      grass: [psx(new THREE.MeshLambertMaterial({ map: grassPave.map }), { noSnap: true, affine: 0, wet: true, puddles: 0.4, detile: true, relief: { height: grassPave.height, depth: 0.03, tile: 4, bump: 2.4 } }), 4],
    };
    // the puddles (2026-09-27): each kind's own puddle factor on a 1 m grid of the town, so a step splashes in the
    // puddles the ground shows there (world/puddlemask.ts); the same factors as the materials' `puddles` above
    const PUD: Record<string, number> = { cobble: 1, earth: 1.3, flags: 0.75, quay: 1.15, grass: 0.4 };
    const pudKinds = [0, ...Object.values(PUD)];
    const pudGrid = new Uint8Array(TOWN.w * TOWN.h);
    for (const [zone, tris] of Object.entries(zones)) {
      if (zone === "edges") continue;
      const k = Object.keys(PUD).indexOf(zone in PUD ? zone : "cobble") + 1;
      for (const [ax, az, bx, bz, cx, cz] of tris) {
        const i0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - TOWN.x0));
        const i1 = Math.min(TOWN.w - 1, Math.ceil(Math.max(ax, bx, cx) - TOWN.x0));
        const j0 = Math.max(0, Math.floor(Math.min(az, bz, cz) - TOWN.z0));
        const j1 = Math.min(TOWN.h - 1, Math.ceil(Math.max(az, bz, cz) - TOWN.z0));
        const side = (px: number, pz: number, qx: number, qz: number, x: number, z: number) => (qx - px) * (z - pz) - (qz - pz) * (x - px);
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const x = TOWN.x0 + i + 0.5;
            const z = TOWN.z0 + j + 0.5;
            const d0 = side(ax, az, bx, bz, x, z);
            const d1 = side(bx, bz, cx, cz, x, z);
            const d2 = side(cx, cz, ax, az, x, z);
            if ((d0 >= 0 && d1 >= 0 && d2 >= 0) || (d0 <= 0 && d1 <= 0 && d2 <= 0)) pudGrid[j * TOWN.w + i] = k;
          }
        }
      }
    }
    setPuddleScale((x, z) => {
      const i = Math.floor(x - TOWN.x0);
      const j = Math.floor(z - TOWN.z0);
      if (i < 0 || j < 0 || i >= TOWN.w || j >= TOWN.h) return undefined;
      return pudKinds[pudGrid[j * TOWN.w + i]] || undefined;
    });
    for (const [zone, tris] of Object.entries(zones)) {
      if (zone === "edges") continue;
      const [mat, tile] = zoneMat[zone] ?? zoneMat.cobble;
      const pos: number[] = [];
      const uv: number[] = [];
      for (const t of tris) {
        // wind every triangle upward (normal +y)
        let [ax, az, bx, bz, cx, cz] = t;
        if ((bx - ax) * (cz - az) - (bz - az) * (cx - ax) > 0) [bx, bz, cx, cz] = [cx, cz, bx, bz];
        for (const [x, z] of [[ax, az], [bx, bz], [cx, cz]]) {
          pos.push(x, 0, z);
          uv.push(x / tile, z / tile);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      const ground = new THREE.Mesh(g, mat);
      ground.name = `ground_${zone}`;
      groundMirror.attach(ground);
      group.add(ground);
    }
  }

  // --- edge stones along every seam where two pavings meet (tools/city/plan.py ground edges):
  // a row of long granite kerbs covers the cut, as in a real street
  {
    const edges = ((data as unknown as { ground?: { edges?: Array<Array<[number, number]>> } }).ground?.edges ?? []) as Array<Array<[number, number]>>;
    const W = 0.34;
    // (2026-09-27, Steve: the kerbs "should seem higher in bumpmapping") their own height map: slabs with rounded
    // edges falling into the joints, lit on the side toward a light (world/paving.ts edgeStoneTextures)
    const edge = edgeStoneTextures();
    const pos: number[] = [];
    const uv: number[] = [];
    for (const line of edges) {
      let dist = 0;
      const n = line.length;
      const side = (i: number): [number, number] => {
        const a = line[Math.max(0, i - 1)];
        const b = line[Math.min(n - 1, i + 1)];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
      };
      for (let i = 0; i < n - 1; i++) {
        const [ax, az] = line[i];
        const [bx, bz] = line[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        const [nax, naz] = side(i);
        const [nbx, nbz] = side(i + 1);
        const h = W / 2;
        const u0 = dist / 2;
        const u1 = (dist + L) / 2;
        dist += L;
        const A0 = [ax - nax * h, az - naz * h];
        const A1 = [ax + nax * h, az + naz * h];
        const B0 = [bx - nbx * h, bz - nbz * h];
        const B1 = [bx + nbx * h, bz + nbz * h];
        // two triangles, both wound to face up
        for (const [p, u, v] of [[A0, u0, 0], [B1, u1, 1], [B0, u1, 0], [A0, u0, 0], [A1, u0, 1], [B1, u1, 1]] as const) {
          pos.push(p[0], 0, p[1]);
          uv.push(u, v);
        }
      }
    }
    if (pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      const mat = psx(
        // no depth written: where two runs of edge stones cross they would fight each other (z-fight check)
        new THREE.MeshLambertMaterial({ map: edge.map, bumpMap: edge.height, bumpScale: EDGE_BUMP, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8, depthWrite: false }),
        { noSnap: true, affine: 0, wet: true },
      );
      const seam = new THREE.Mesh(g, mat);
      seam.name = "ground_seams";
      group.add(seam);
    }
  }

  // --- quay walls and edge stones along every water edge
  // (D2, 2026-10-11; Steve: "make docks look way better"): coursed bluestone with the tide's marks in its picture at
  // their true heights (world/quayStone.ts, tools/textures/quay_maps.py), u running on along each quay ring so the
  // courses never break at a corner, its own height map, and the tide's wet band (psx tideWet). The emissive wash is
  // gone: the stone takes the light as the paving does (Steve's night test: "the stairs and the quay walls look as if
  // they give light by themselves"). The coping is cut with its real section: a land face, the top, a rounded nose,
  // the face over the water and its underside, in one picture round it.
  {
    const wall: number[] = [];
    const wallUv: number[] = [];
    const wallCol: number[] = [];
    const cope: number[] = [];
    const copeUv: number[] = [];
    const copeNor: number[] = [];
    // the wall in bands, cut where its vertex colour changes (quaysteps.ts masonryShade): a little deeper toward the
    // water on the river's tidal walls; the Petit Bassin keeps one level (world/tide.ts). It stops under the coping.
    const y0 = QUAY_Y_LO;
    const riverShade = masonryShade(null);
    const riverBands = [y0, ...masonryCuts(null).filter((y) => y > y0 && y < COPE.foot), COPE.foot];
    const dockShade = masonryShade(DOCK_Y);
    const dockBands = [y0, ...masonryCuts(DOCK_Y).filter((y) => y > y0 && y < COPE.foot), COPE.foot];
    void waterY;
    // the edge stones meet their neighbours on the bisector (mitred), so two bands never lie over each
    // other at a corner (z-fight check, 2026-09-25: every corner of the quays and the town moat flickered)
    const keyOf = (x: number, z: number) => `${Math.round(x * 100)},${Math.round(z * 100)}`;
    const starts = new Map<string, number[]>();
    const ends = new Map<string, number[]>();
    for (const q of data.quays) {
      starts.set(keyOf(q[0], q[1]), q);
      ends.set(keyOf(q[2], q[3]), q);
    }
    const unitN = (q: number[]): [number, number] => {
      const L = Math.hypot(q[2] - q[0], q[3] - q[1]) || 1;
      return [-(q[3] - q[1]) / L, (q[2] - q[0]) / L];
    };
    /** The corner of the band at point (px, pz) on side `side` (+1 / -1), between normals n and m. */
    const mitre = (px: number, pz: number, n: [number, number], m: [number, number] | null, w: number): [number, number] => {
      if (!m) return [px + n[0] * w, pz + n[1] * w];
      const d = 1 + n[0] * m[0] + n[1] * m[1];
      if (d < 0.5) return [px + n[0] * w, pz + n[1] * w]; // a sharp turn: square ends
      return [px + ((n[0] + m[0]) / d) * w, pz + ((n[1] + m[1]) / d) * w];
    };
    // the quay lines as rings and runs: each segment's distance along its ring, so the picture runs on round every
    // corner; a closed ring is stretched a hair to a whole number of the picture's repeats (no seam where it closes)
    const along = new Map<number[], { d: number; scale: number; ring: number }>();
    {
      const seen = new Set<number[]>();
      let ring = 0;
      const walk = (q0: number[]) => {
        const chain: number[][] = [];
        for (let q: number[] | undefined = q0; q && !seen.has(q); q = starts.get(keyOf(q[2], q[3]))) {
          seen.add(q);
          chain.push(q);
        }
        const L = chain.reduce((a, q) => a + Math.hypot(q[2] - q[0], q[3] - q[1]), 0);
        const last = chain[chain.length - 1];
        const closed = keyOf(last[2], last[3]) === keyOf(q0[0], q0[1]);
        const scale = closed && L > QUAY_WALL_ALONG ? (Math.max(1, Math.round(L / QUAY_WALL_ALONG)) * QUAY_WALL_ALONG) / L : 1;
        let d = 0;
        for (const q of chain) {
          along.set(q, { d, scale, ring });
          d += Math.hypot(q[2] - q[0], q[3] - q[1]);
        }
        ring++;
      };
      for (const q of data.quays) if (!ends.has(keyOf(q[0], q[1]))) walk(q);
      for (const q of data.quays) if (!seen.has(q)) walk(q);
    }
    /** A soft change of shade along the wall every few metres (one stone's weathering to the next stretch's). */
    const shadeAlong = (ring: number, d: number) => {
      const h = (i: number) => {
        const x = Math.sin(i * 127.1 + ring * 311.7) * 43758.5453;
        return 0.92 + 0.12 * (x - Math.floor(x));
      };
      const i = Math.floor(d / 3.7);
      const t = d / 3.7 - i;
      return h(i) + (h(i + 1) - h(i)) * t * t * (3 - 2 * t);
    };
    // the coping's section, from the land side (quayStone.ts COPE_SECTION): offset toward the water, height, metres
    // round it, its normal across (toward the water) and up
    const S = COPE_SECTION;
    const r = COPE.nose;
    const sec: Array<[number, number, number, number, number]> = [
      [-COPE.half, 0, S[0], -1, 0],
      [-COPE.half, COPE.top, S[1], -1, 0],
      [-COPE.half, COPE.top, S[1], 0, 1],
      [COPE.front - r, COPE.top, S[2], 0, 1],
    ];
    for (let k = 1; k <= 4; k++) {
      const a = (k * Math.PI) / 8;
      sec.push([COPE.front - r + r * Math.sin(a), COPE.top - r + r * Math.cos(a), S[2] + r * a, Math.sin(a), Math.cos(a)]);
    }
    sec.push([COPE.front, COPE.foot, S[4], 1, 0], [COPE.front, COPE.foot, S[4], 0, -1], [0, COPE.foot, S[5], 0, -1]);
    /** Two triangles of a quad (corners round its edge), wound to face their normal (the material is double-sided). */
    const quad = (P: number[][], N: number[][], U: number[][]) => {
      const e1 = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]];
      const e2 = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
      const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const nn = [N[0][0] + N[2][0], N[0][1] + N[2][1], N[0][2] + N[2][2]];
      const order = c[0] * nn[0] + c[1] * nn[1] + c[2] * nn[2] >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      for (const i of order) {
        cope.push(...P[i]);
        copeNor.push(...N[i]);
        copeUv.push(...U[i]);
      }
    };
    for (const q of data.quays) {
      const [ax, az, bx, bz] = q;
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      const { d: d0, scale, ring } = along.get(q)!;
      const inDock = regionAt((ax + bx) / 2, (az + bz) / 2) === 1;
      const shade = inDock ? dockShade : riverShade;
      const bands = inDock ? dockBands : riverBands;
      // which side the water is: the wall faces it (its normal, and every psx light that reads it, the sky's shade and
      // the sun's), and the coping's nose leans over it
      const n = unitN(q);
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      const sgn = inWaterPoly(mx + n[0] * 0.8, mz + n[1] * 0.8) && !inWaterPoly(mx - n[0] * 0.8, mz - n[1] * 0.8) ? 1 : -1;
      // the wall face on the quay line, in stretches of a few metres (each its own shade), and bands up it
      const pieces = Math.max(1, Math.ceil(L / 3.7));
      for (let p = 0; p < pieces; p++) {
        const ta = p / pieces;
        const tb = (p + 1) / pieces;
        const [xa, za, xb, zb] = [ax + (bx - ax) * ta, az + (bz - az) * ta, ax + (bx - ax) * tb, az + (bz - az) * tb];
        const [da, db] = [d0 + L * ta, d0 + L * tb];
        const [ua, ub] = [(da * scale) / QUAY_WALL_ALONG, (db * scale) / QUAY_WALL_ALONG];
        const [ka, kb] = [shadeAlong(ring, da), shadeAlong(ring, db)];
        for (let i = 0; i < bands.length - 1; i++) {
          const [ya, yb] = [bands[i], bands[i + 1]];
          const [va, vb] = [wallV(ya), wallV(yb)];
          // (wound so its normal, +n along a to b, faces the water)
          const [ca, cb] = [shade(ya), shade(yb)];
          const corner = [
            [xa, ya, za, ua, va, ca, ka],
            [xb, ya, zb, ub, va, ca, kb],
            [xb, yb, zb, ub, vb, cb, kb],
            [xa, yb, za, ua, vb, cb, ka],
          ] as const;
          for (const j of sgn > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) {
            const [x, y, z, u, v, c, k] = corner[j];
            wall.push(x, y, z);
            wallUv.push(u, v);
            wallCol.push(c[0] * k, c[1] * k, c[2] * k);
          }
        }
      }
      // the coping: its section swept along the segment, mitred at both ends
      const prev = ends.get(keyOf(ax, az));
      const next = starts.get(keyOf(bx, bz));
      const mp = prev ? unitN(prev) : null;
      const mn = next ? unitN(next) : null;
      const [cu0, cu1] = [(d0 * scale) / QUAY_COPE_ALONG, ((d0 + L) * scale) / QUAY_COPE_ALONG];
      for (let i = 0; i < sec.length - 1; i++) {
        const A = sec[i];
        const B = sec[i + 1];
        if (Math.hypot(B[0] - A[0], B[1] - A[1]) < 1e-5) continue; // (a sharp edge: the next face turns)
        const pa0 = mitre(ax, az, n, mp, A[0] * sgn);
        const pb0 = mitre(bx, bz, n, mn, A[0] * sgn);
        const pa1 = mitre(ax, az, n, mp, B[0] * sgn);
        const pb1 = mitre(bx, bz, n, mn, B[0] * sgn);
        const nA = [n[0] * sgn * A[3], A[4], n[1] * sgn * A[3]];
        const nB = [n[0] * sgn * B[3], B[4], n[1] * sgn * B[3]];
        // (a flat face between two sharp edges keeps one normal: the second point's)
        const flatFace = A[3] * B[3] + A[4] * B[4] > 0.99;
        const n0 = flatFace ? nB : nA;
        const [va, vb] = [1 - A[2] / S[5], 1 - B[2] / S[5]];
        quad(
          [
            [pa0[0], A[1], pa0[1]],
            [pb0[0], A[1], pb0[1]],
            [pb1[0], B[1], pb1[1]],
            [pa1[0], B[1], pa1[1]],
          ],
          [n0, n0, nB, nB],
          [
            [cu0, va],
            [cu1, va],
            [cu1, vb],
            [cu0, vb],
          ],
        );
      }
    }
    const wallG = new THREE.BufferGeometry();
    wallG.setAttribute("position", new THREE.Float32BufferAttribute(wall, 3));
    wallG.setAttribute("uv", new THREE.Float32BufferAttribute(wallUv, 2));
    wallG.setAttribute("color", new THREE.Float32BufferAttribute(wallCol, 3));
    wallG.computeVertexNormals();
    const wm = quayWallMaps();
    const wallMat = new THREE.MeshLambertMaterial({ name: "quay_wall", map: wm.map, bumpMap: wm.height, bumpScale: QUAY_BUMP * 1.5, vertexColors: true, side: THREE.DoubleSide });
    // (the tide's wet band: the stone the ebb has just left goes darker and dries over the hours after; rendering.md)
    psx(wallMat, { noSnap: true, affine: 0, tideWet: 0.3 });
    // The light off the water: the river walls face north, away from the sun, and at low tide filled the view nearly
    // black. They take a fill that follows the sky's light (as the cathedral's stone does, cathedralOutside.ts): its
    // colour and strength each frame, shaded by the stone's picture and its vertex colour, so it is gone at night
    // (the old fixed glow lit the walls and the flights all night). Godot: the same, by the material's name
    // (World/Daylight.cs, `fill`).
    wallMat.emissiveMap = wallMat.map;
    {
      const prev = wallMat.onBeforeCompile;
      const prevKey = wallMat.customProgramCacheKey.bind(wallMat);
      wallMat.onBeforeCompile = (shader, renderer) => {
        prev.call(wallMat, shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n#ifdef USE_COLOR\n  totalEmissiveRadiance *= vColor.rgb;\n#endif");
      };
      wallMat.customProgramCacheKey = () => `${prevKey()}-skyfill`;
    }
    const wallMesh = new THREE.Mesh(wallG, wallMat);
    wallMesh.name = "quay_walls";
    let hemi: THREE.HemisphereLight | null | undefined;
    let fillFrame = -1;
    wallMesh.onBeforeRender = (renderer, scene) => {
      if (renderer.info.render.frame === fillFrame) return;
      fillFrame = renderer.info.render.frame;
      if (hemi === undefined) {
        hemi = null;
        scene.traverse((o) => {
          if (!hemi && (o as THREE.HemisphereLight).isHemisphereLight) hemi = o as THREE.HemisphereLight;
        });
      }
      const h = hemi as THREE.HemisphereLight | null;
      // (by the square of the sky's strength: the water gives back the day's light, hardly any of the night's)
      // (the colour as the cathedral's fill takes it, so Godot's psx_fill follows it the same way: World/Daylight.cs)
      if (h) wallMat.emissive.copy(h.color).lerp(FILL_WARM, 0.6).multiplyScalar(WATER_FILL * (h.intensity / 1.8) ** 2);
      else wallMat.emissive.copy(FILL_WARM).multiplyScalar(WATER_FILL);
    };
    group.add(wallMesh);
    const copeG = new THREE.BufferGeometry();
    copeG.setAttribute("position", new THREE.Float32BufferAttribute(cope, 3));
    copeG.setAttribute("normal", new THREE.Float32BufferAttribute(copeNor, 3));
    copeG.setAttribute("uv", new THREE.Float32BufferAttribute(copeUv, 2));
    const cm = quayCopingMaps();
    const copeMat = new THREE.MeshLambertMaterial({ name: "quay_coping", map: cm.map, bumpMap: cm.height, bumpScale: QUAY_BUMP, side: THREE.DoubleSide });
    psx(copeMat, { noSnap: true, affine: 0, wet: true });
    const copeMesh = new THREE.Mesh(copeG, copeMat);
    copeMesh.name = "quay_coping";
    group.add(copeMesh);
    quayMats = { wall: wallMat, coping: copeMat };
  }

  // --- landmarks: stand-in blocks until their Blender models are in
  const stone = psx(new THREE.MeshLambertMaterial({ map: stoneTexture(), color: 0xb0a898 }));
  for (const [name, l] of Object.entries(data.landmarks)) {
    const shape = new THREE.Shape(l.fp.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: LANDMARK_HEIGHT[name] ?? 20, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 3, uv.getY(i) / 3);
    const m = new THREE.Mesh(g, stone);
    m.name = `standin_${name}`;
    group.add(m);
  }

  // --- landmarks from Blender (tools/blender/build_landmarks.py) replace the stand-ins
  const lmMats: Record<string, THREE.Material> = {
    // (bump maps on every floor, 2026-09-26: the landmarks' steps, terraces and plinths, from their own colour)
    // (2026-09-26: the foot of the walls, mud and damp, and big soft patches so the stone's picture shows no grid:
    // retro/psx.ts foot and mottle; the cathedral too)
    stone: bumpFromMap(psx(new THREE.MeshLambertMaterial({ map: stoneTexture(), color: 0xd8d0c0, vertexColors: true, side: THREE.DoubleSide }), { fogReach: 2.2, affine: 0, foot: { amount: 0.5 }, mottle: 0.4 }), 0.01),
    slate: psx(new THREE.MeshLambertMaterial({ map: slateTexture(), vertexColors: true, side: THREE.DoubleSide }), { fogReach: 2.2, affine: 0 }),
    glass: psx(new THREE.MeshLambertMaterial({ map: glassTexture(), vertexColors: true, side: THREE.DoubleSide }), { fogReach: 2.2, affine: 0 }),
    brickband: psx(new THREE.MeshLambertMaterial({ map: brickBandTexture(), vertexColors: true, side: THREE.DoubleSide }), { fogReach: 2.2, affine: 0, foot: { amount: 0.5 }, mottle: 0.4 }),
    lead: psx(new THREE.MeshLambertMaterial({ color: 0x4a4e52, vertexColors: true, side: THREE.DoubleSide }), { fogReach: 2.2, affine: 0 }),
    // the gilt cross, ball and clock dials of the cathedral
    gilt: psx(new THREE.MeshLambertMaterial({ color: 0xc8a040, vertexColors: true, side: THREE.DoubleSide }), { fogReach: 2.2, affine: 0 }),
  };
  // (the bump audit, 2026-09-26: names that say what each is, for its bump from its own picture: world/bumps.ts)
  for (const [k, m] of Object.entries(lmMats)) if (!m.name) m.name = `landmark_${k}`;
  landmarkMats = lmMats;
  stone.name = "standin_stone";
  const lmLoader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath("/draco/"));
  const landmarks = lmLoader.loadAsync("/models/landmarks.glb").then((gltf) => {
    const meshes: THREE.Mesh[] = [];
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const name = (m.material as THREE.Material).name;
      // "<building>_atlas": windows, clock, statues painted into a texture in the glb
      if (name.endsWith("_atlas") && !lmMats[name]) {
        const map = (m.material as THREE.MeshStandardMaterial).map;
        if (map) {
          map.magFilter = THREE.NearestFilter;
          map.minFilter = THREE.NearestFilter;
          map.generateMipmaps = false;
          lmMats[name] = psx(new THREE.MeshLambertMaterial({ map, vertexColors: true, side: THREE.DoubleSide }), { fogReach: 2.2, affine: 0, foot: { amount: 0.5 } });
        }
      }
      m.material = lmMats[name] ?? lmMats.stone;
      meshes.push(m);
    });
    for (const m of meshes) {
      m.updateWorldMatrix(true, false);
      m.applyMatrix4(m.parent!.matrixWorld);
      const owner = m.name.startsWith("landmark_") ? m.name : (m.parent?.name ?? "");
      const standIn = group.getObjectByName(owner.replace(/_\d+$/, "").replace("landmark_", "standin_"));
      if (standIn) standIn.visible = false;
      group.add(m);
    }
  });

  // --- houses from Blender
  // both sides drawn: a wall seen from behind (a party wall, a gable back) is never a hole
  const DS = THREE.DoubleSide;
  // (the foot of the walls, 2026-09-26: mud, damp and its tide line, by the house's wear: retro/psx.ts foot)
  // (tuning 2026-09-26: the foot's dirt stronger, was 1 on the fronts and 0.8 on the trim)
  const facade = psx(new THREE.MeshLambertMaterial({ map: facadeAtlas(), vertexColors: true, side: DS }), { atlas: 8, affine: 0, foot: { amount: 1.25, vertexWear: true } });
  const roof = psx(new THREE.MeshLambertMaterial({ map: roofAtlas(), vertexColors: true, side: DS }), { atlas: 2, affine: 0 });
  const wood = psx(new THREE.MeshLambertMaterial({ map: makeTextures().planks, vertexColors: true, side: DS }), { affine: 0.2 });
  const leaves = psx(new THREE.MeshLambertMaterial({ map: leafTexture(), vertexColors: true, side: DS }), { affine: 0 });
  // --- bump maps on every floor (2026-09-26): the pavements, kerbs and door steps (flat, below 0.8 m) as bluestone slabs in
  // world metres with their own relief (retro/psx.ts slabs); their own uv there stretched the stone texture flat
  const slabPave = flagPaving();
  const trim = psx(new THREE.MeshLambertMaterial({ map: stoneTexture(), vertexColors: true, side: DS }), { affine: 0.2, slabs: { map: slabPave.map, height: slabPave.height, tile: 2.6, yMax: 0.8, dome: 0 }, foot: { amount: 1.0, vertexWear: true } });
  // (the bump audit, 2026-09-26: names that say what each is, for its bump from its own picture: world/bumps.ts)
  wood.name = "city_wood";
  leaves.name = "city_leaves";
  roof.name = "city_roof_atlas";
  // M7 the grime pass: the fronts old and dirty (world/houseGrime.ts: wall pictures, streaks, damp, soot, worn paint)
  houseGrime(facade, trim);
  // grime pass 2: rust runs, soot, damp and corner grime as decals (build_city.py MAT_GRIME): see-through, no
  // depth written, pulled forward so they never fight the wall
  const grimeDecal = grimeDecalMaterial(grimeDecals());
  const chunks: THREE.Mesh[] = [];
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  const loader = new GLTFLoader().setDRACOLoader(draco);
  let openings: CityOpenings | null = null;
  const houses = loader.loadAsync("/models/city.glb").then((gltf) => {
    try {
      const raw = gltf.scene.getObjectByName("city_openings")?.userData.openings;
      if (typeof raw === "string") openings = JSON.parse(raw) as CityOpenings;
    } catch {
      openings = null;
    }
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = m.geometry;
      // glTF flips v; turn it back so storeys count up the wall
      const uv = g.getAttribute("uv") as THREE.BufferAttribute | undefined;
      if (uv) for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
      // (grime pass 2: the exporter writes a blank white COLOR_0 and build_city.py's own "Col" layer as COLOR_1; the
      // tints, the shading of the reveals and the grime by height, and the house's wear in its alpha, were never used:
      // take COLOR_1 as the vertex colour)
      const col1 = g.getAttribute("color_1");
      if (col1) {
        g.setAttribute("color", col1);
        g.deleteAttribute("color_1");
      }
      // (the districts pass: the "Mat" uv, TEXCOORD_2: the house's wall picture and paint, houseGrime.ts)
      const mat2 = g.getAttribute("uv2");
      if (mat2) {
        g.setAttribute("gmat", mat2);
        g.deleteAttribute("uv2");
      }
      const cell = g.getAttribute("uv1") as THREE.BufferAttribute | undefined;
      if (cell) {
        for (let i = 0; i < cell.count; i++) cell.setXY(i, Math.round(cell.getX(i)), Math.round(1 - cell.getY(i)));
        g.setAttribute("cell", cell);
        g.deleteAttribute("uv1");
      }
      const name = (m.material as THREE.Material).name;
      m.material = name === "facade" ? facade : name === "roof" ? roof : name === "wood" ? wood : name === "leaves" ? leaves : name === "grime" ? grimeDecal : trim;
      g.computeBoundingSphere();
      chunks.push(m);
      // M7 quays pass 2: a chunk's near-only mesh (build_city.py "_d": sills, heads, shutters, pipes, pots)
      if (/_d(_\d+)?$/.test(m.name) || /_d$/.test(m.parent?.name ?? "")) m.userData.near = true;
    });
    // the whole scene graph is Y-up already; move the meshes under our group
    for (const m of chunks) {
      m.updateWorldMatrix(true, false);
      m.applyMatrix4(m.parent!.matrixWorld);
      group.add(m);
    }
    draco.dispose();
  });

  // --- the walk map: R wall, G water, B outside the traced map
  const W = data.walk;
  let walk: Uint8Array | null = null;
  const walkReady = new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = W.w;
      c.height = W.h;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, W.w, W.h).data;
      walk = new Uint8Array(W.w * W.h);
      for (let i = 0; i < walk.length; i++) {
        walk[i] = (px[i * 4] > 127 ? WALL : 0) | (px[i * 4 + 1] > 127 ? WATER : 0) | (px[i * 4 + 2] > 127 ? OUTSIDE : 0);
      }
      resolve();
    };
    img.onerror = () => reject(new Error("walk map missing"));
    img.src = W.file;
  });

  function flags(x: number, z: number): number | undefined {
    if (!walk) return undefined;
    const c = Math.floor((z - W.z0) / W.res);
    const r = Math.floor((x - W.x0) / W.res);
    if (c < 0 || r < 0 || c >= W.w || r >= W.h) return OUTSIDE | WATER;
    return walk[r * W.w + c];
  }

  const tmp = new THREE.Vector3();
  const DETAIL_NEAR = 60;
  function update(camera: THREE.Camera, far: number): void {
    const cp = camera.position;
    for (const m of chunks) {
      const s = m.geometry.boundingSphere!;
      tmp.copy(s.center);
      // (the small things on the fronts only near: past 60 m they are a pixel or two)
      m.visible = tmp.distanceTo(cp) - s.radius < (m.userData.near ? Math.min(far + 10, DETAIL_NEAR) : far + 10);
    }
  }

  return { group, ready: Promise.all([houses, walkReady, landmarks]).then(() => {}), flags, update, landmarks: data.landmarks, openings: () => openings };
}
