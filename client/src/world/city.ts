import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import CITY from "../../../shared/city.json";
import { bumpFromMap, psx, psxUniforms } from "../retro/psx";
import { createMirror } from "./mirror";
import { setPuddleScale } from "./puddlemask";
import { TOWN } from "./townBox";
import { cobblePaving, earthPaving, edgeStoneTexture, flagPaving, grassPaving, quayPaving, withPictures } from "./paving";
import { copingTexture, quayWallTexture, withPicture } from "./quayStone";
import { grimeDecalMaterial, houseGrime } from "./houseGrime";
import { brickBandTexture, facadeAtlas, grimeDecals, glassTexture, leafTexture, roofAtlas, slateTexture, stoneTexture } from "./cityTextures";
import { makeTextures } from "./textures";
import { slimeCuts, slimeShade, tideCuts, tideShade } from "./quaysteps";
import { DOCK_Y, LW_MIN, regionAt } from "./tide";

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

export function buildCity(scene: THREE.Scene, mats: { cobble: THREE.Material; quayWall: THREE.Material; wallDecal: THREE.Material }, waterY: number): CityWorld {
  const group = new THREE.Group();
  group.name = "city";
  scene.add(group);

  // the street mirrored in the puddles (world/mirror.ts), drawn only while there are puddles.
  // M7 rendering: 320 x 180 like the river's (was 480 x 270, as many pixels as the whole view)
  const groundMirror = createMirror(0, { width: 320, height: 180, name: "puddles", enabled: () => psxUniforms.uPuddle.value > 0.01 });
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
    // "not too clean, as it was then" (Steve, 2026-09-25): the street cobbles a Codex picture of muddy setts with
    // dung and straw (3 m a tile: stones of about 15 cm), its height from its own light and dark (the joints are too muddy to find the
    // stones in): so no stone map, every stone rolls no dice of its own; the painted one shows until they load.
    // (bump maps checked, 2026-09-26: colour and height swap in together, never one without the other)
    withPictures(cobPave, { map: "/textures/street_cobble.jpg", height: "/textures/street_cobble_h.png", id: null });
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
      flags: [psx(new THREE.MeshPhongMaterial({ map: flagPave.map, specular: 0x1a1a1a, shininess: 12 }), { noSnap: true, affine: 0, wet: true, puddles: 0.75, vary: 0.8, relief: { height: flagPave.height, id: flagPave.id, holes: 0, depth: 0.025, tile: 4, bump: 1.6 } }), 4],
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
        new THREE.MeshLambertMaterial({ map: edgeStoneTexture(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8, depthWrite: false }),
        { noSnap: true, affine: 0, wet: true },
      );
      // bump maps on every floor (2026-09-26): the edge stones' joints and worn tops, from their own colour
      bumpFromMap(mat, 0.012);
      const seam = new THREE.Mesh(g, mat);
      seam.name = "ground_seams";
      group.add(seam);
    }
  }

  // --- quay walls and edge stones along every water edge
  {
    const wall: number[] = [];
    const wallUv: number[] = [];
    const wallCol: number[] = [];
    const cope: number[] = [];
    const copeUv: number[] = [];
    const face: number[] = [];
    const faceUv: number[] = [];
    let copeRun = 0;
    // the wall in bands, coloured by height: green slime at the waterline, a dark wet band above it.
    // M6 tides: on the river the whole tide range is slimy up to the high-water mark and the wall
    // goes down below the lowest spring tide; the Petit Bassin keeps one level (world/tide.ts)
    const y0 = LW_MIN - 1.2;
    const riverShade = tideShade();
    const riverBands = [y0, ...tideCuts().filter((y) => y > y0 && y < 0), 0];
    const dockShade = slimeShade(DOCK_Y);
    const dockBands = [y0, ...slimeCuts(DOCK_Y).filter((y) => y > y0 && y < 0), 0];
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
    for (const [ax, az, bx, bz] of data.quays) {
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      const inDock = regionAt((ax + bx) / 2, (az + bz) / 2) === 1;
      const shade = inDock ? dockShade : riverShade;
      const bands = inDock ? dockBands : riverBands;
      for (let i = 0; i < bands.length - 1; i++) {
        const [ya, yb] = [bands[i], bands[i + 1]];
        const [va, vb] = [(ya - y0) / 4, (yb - y0) / 4];
        wall.push(ax, ya, az, bx, ya, bz, bx, yb, bz, ax, ya, az, bx, yb, bz, ax, yb, az);
        wallUv.push(0, va, L / 4, va, L / 4, vb, 0, va, L / 4, vb, 0, vb);
        for (const y of [ya, ya, yb, ya, yb, yb]) wallCol.push(...shade(y));
      }
      // edge stones: a flat band on top, 0.5 m wide, slightly raised
      const w = 0.25;
      const n = unitN([ax, az, bx, bz]);
      const prev = ends.get(keyOf(ax, az));
      const next = starts.get(keyOf(bx, bz));
      const mp = prev ? unitN(prev) : null;
      const mn = next ? unitN(next) : null;
      const A0 = mitre(ax, az, n, mp, -w);
      const A1 = mitre(ax, az, n, mp, w);
      const B0 = mitre(bx, bz, n, mn, -w);
      const B1 = mitre(bx, bz, n, mn, w);
      // quays pass 2: v runs from the land side (0) to the water's edge (1), u 3 m a tile along the quay
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      const waterOnPlus = inWaterPoly(mx + n[0] * 0.8, mz + n[1] * 0.8) && !inWaterPoly(mx - n[0] * 0.8, mz - n[1] * 0.8);
      const u0 = copeRun;
      const u1 = copeRun + L / 3;
      copeRun = u1 % 64;
      const [vA0, vA1] = waterOnPlus ? [0, 1] : [1, 0];
      cope.push(A0[0], 0.06, A0[1], B0[0], 0.06, B0[1], B1[0], 0.06, B1[1], A0[0], 0.06, A0[1], B1[0], 0.06, B1[1], A1[0], 0.06, A1[1]);
      copeUv.push(u0, vA0, u1, vA0, u1, vA1, u0, vA0, u1, vA1, u0, vA1);
      // quays pass 2: the coping's front over the water, 34 cm deep (was a flat band with nothing under
      // its outer edge), and its underside back to the wall. 15 mm behind quayfurniture's iron edge (0.25).
      const [Fa, Fb] = waterOnPlus ? [mitre(ax, az, n, mp, w - 0.015), mitre(bx, bz, n, mn, w - 0.015)] : [mitre(ax, az, n, mp, -w + 0.015), mitre(bx, bz, n, mn, -w + 0.015)];
      const yb = -0.28;
      face.push(Fa[0], yb, Fa[1], Fb[0], yb, Fb[1], Fb[0], 0.06, Fb[1], Fa[0], yb, Fa[1], Fb[0], 0.06, Fb[1], Fa[0], 0.06, Fa[1]);
      faceUv.push(u0, 0.2, u1, 0.2, u1, 0.62, u0, 0.2, u1, 0.62, u0, 0.62);
      face.push(ax, yb, az, bx, yb, bz, Fb[0], yb, Fb[1], ax, yb, az, Fb[0], yb, Fb[1], Fa[0], yb, Fa[1]);
      faceUv.push(u0, 0.1, u1, 0.1, u1, 0.2, u0, 0.1, u1, 0.2, u0, 0.2);
    }
    const mk = (pos: number[], uv: number[], mat: THREE.Material) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      group.add(m);
      return m;
    };
    const wallMat = (mats.quayWall as THREE.MeshLambertMaterial).clone();
    // quays pass 2: dressed bluestone, a picture at 256 px a metre (world/quayStone.ts; was the 64 px placeholder for 4 m)
    wallMat.map = withPicture(quayWallTexture(), "/textures/quay_wall.jpg");
    wallMat.side = THREE.DoubleSide;
    wallMat.vertexColors = true;
    // the river walls face away from the sun: a little light off the water, or at low tide they fill the view nearly black
    wallMat.emissive = new THREE.Color(0x62645a);
    wallMat.emissiveMap = wallMat.map; // the glow carries the stones, so the face keeps its courses
    const copeMat = (mats.wallDecal as THREE.MeshLambertMaterial).clone();
    copeMat.map = withPicture(copingTexture(), "/textures/quay_coping.jpg");
    copeMat.color = new THREE.Color(0xb4b0a8);
    copeMat.side = THREE.DoubleSide;
    mk(wall, wallUv, psx(wallMat, { noSnap: true, affine: 0 })).geometry.setAttribute("color", new THREE.Float32BufferAttribute(wallCol, 3));
    mk(cope, copeUv, psx(copeMat, { noSnap: true, affine: 0, wet: true }));
    const faceMat = new THREE.MeshLambertMaterial({ map: copeMat.map, color: 0x9a968c, side: THREE.DoubleSide });
    mk(face, faceUv, psx(faceMat, { noSnap: true, affine: 0 })).name = "quay_coping_face";
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
  const trim = psx(new THREE.MeshLambertMaterial({ map: stoneTexture(), vertexColors: true, side: DS }), { affine: 0.2, slabs: { map: slabPave.map, height: slabPave.height, tile: 2.6, yMax: 0.8 }, foot: { amount: 1.0, vertexWear: true } });
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
