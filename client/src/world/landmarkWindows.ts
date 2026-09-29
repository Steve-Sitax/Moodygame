import * as THREE from "three";
import { psx } from "../retro/psx";
import { addSpill, type SpillSource } from "./spill";

// The landmarks' windows lit all night (Steve, 2026-09-27: "the special buildings need ... light coming through
// windows. Those buildings will keep having lights on all night, even when they are closed. Make it moody and cool").
//
// The cathedral, the three churches, the town hall, the Vleeshuis, the Steen and the Hanseatic House keep lamps and
// candles burning inside after dark (world/cathedralHall.ts, landmarkHalls.ts, carolusHall.ts, gothicHall.ts). From
// the street their windows glow with it (Steve, the same evening: "too many lights on ... not all on"; "churches have
// less light at night inside than is coming out ... in towers, not all rooms there will be lit"). A church glows dim,
// as its candles light it, brightest at the foot of a window, its towers dark. A building of rooms lights room by
// room by the clock: clerks going home through the evening, a meeting or two lighting a room and its neighbours until
// 0:00 or 1:00, the porter's lodge, a watchman's lamp going round, the first clerks before seven (NIGHTS). Its
// windows: every face of the shells' glass (sh_glass, vh_glass, steen_glass, the
// stand-ins' landmark_glass) and every face of the atlases that shows a window's glass (the churches' church_atlas,
// the cathedral's cath_atlas) gets a copy 3 cm out, drawn additive with the glass's own picture: the leads and the
// tracery stay dark, the stained panes keep their colour, amber lamplight in the plain ones. Each window its own
// strength (one lamp nearer than another), a slow breath of the flames. The lowest windows throw their light on
// the street (world/spill.ts, kind "hall"). No light is added (docs/rendering.md); one material per picture.

/** A window's glass inside an atlas: cells in pixels of the picture (x, y from the top, w, h). */
type Cell = [number, number, number, number];

interface Rule {
  /** the shell's material */
  mat: RegExp;
  /** the glass's cells in its atlas (none: the whole material is glass); the picture's size */
  cells?: Cell[];
  size?: [number, number];
  /** stained glass (keeps the pane's hue) or plain (amber lamplight) */
  stained: boolean;
  /** lead a lattice of small panes into a flat painted glass (the cathedral's atlas) */
  lattice?: boolean;
  /** strength at night */
  power: number;
  /** cells that are a tower's windows (dark at night: nobody lives up there) */
  towerCells?: number[];
}

// build_churches.py CELL (y from the bottom of a 256 x 256 atlas; here from the top): goth4, goth2, round, rose, hwin
const CH = 256;
const churchCell = (x: number, y: number, w: number, h: number): Cell => [x, CH - y - h, w, h];
// build_landmarks.py CELL (y from the top of 512 x 1024): the tower lancets, the great west window, the aisle lancets;
// the stand-ins' town hall bays, cross windows, the Hanseatic House's bays, the Vleeshuis's upper windows, the Steen's
const RULES: Rule[] = [
  // (issue #10: "_lit", the old panes of the real windows, never drawn themselves: their glass is the room's)
  { mat: /^(sh_glass|vh_glass|steen_glass|landmark_glass|cath_glass)(_lit)?$/, stained: false, power: 1 },
  {
    mat: /^church_atlas$/,
    size: [256, 256],
    cells: [churchCell(0, 0, 64, 128), churchCell(0, 128, 32, 96), churchCell(32, 128, 32, 80), churchCell(192, 64, 64, 64), churchCell(96, 96, 32, 48)],
    stained: true,
    power: 1,
  },
  {
    mat: /^cath_atlas$/,
    size: [512, 1024],
    cells: [
      [0, 0, 128, 256],
      [256, 0, 128, 256],
      [384, 0, 64, 128],
      [0, 512, 64, 128],
      [192, 512, 64, 64],
      [288, 512, 64, 128],
      [416, 512, 64, 128],
      [352, 576, 64, 64],
    ],
    stained: true,
    lattice: true,
    towerCells: [0],
    power: 1,
  },
];

/** Amber lamplight through plain glass, and the stained panes' hues lifted to their own light. */
const AMBER = new THREE.Color(1.0, 0.56, 0.22);

/** The glass of an atlas as light: black where it is stone, lead or paint, lamplight where it is glass. */
function glowPicture(src: THREE.Texture, rule: Rule): THREE.Texture | null {
  const img = src.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img || !img.width) return null;
  const W = img.width;
  const H = img.height;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, W, H);
  const out = g.createImageData(W, H);
  const sx = W / (rule.size?.[0] ?? W);
  const sy = H / (rule.size?.[1] ?? H);
  const inCell = new Uint8Array(W * H);
  for (const [x, y, w, h] of rule.cells ?? [[0, 0, W, H]]) {
    for (let j = Math.floor(y * sy); j < Math.min(H, Math.ceil((y + h) * sy)); j++) for (let i = Math.floor(x * sx); i < Math.min(W, Math.ceil((x + w) * sx)); i++) inCell[j * W + i] = 1;
  }
  for (let p = 0; p < W * H; p++) {
    if (!inCell[p]) continue;
    const r = d.data[p * 4] / 255;
    const gg = d.data[p * 4 + 1] / 255;
    const b = d.data[p * 4 + 2] / 255;
    const mx = Math.max(r, gg, b);
    const mn = Math.min(r, gg, b);
    const lum = 0.3 * r + 0.55 * gg + 0.15 * b;
    const sat = mx > 0 ? (mx - mn) / mx : 0;
    // the glass: dark and bluish, or a stained pane; not the pale stone of the tracery nor the black lead
    const glassy = lum > 0.045 && (lum < 0.3 || (sat > 0.45 && lum < 0.5));
    if (!glassy) continue;
    // plain glass: lamplight, a little stronger where the pane is lighter; a stained pane: its own hue
    let R = AMBER.r;
    let G = AMBER.g;
    let B = AMBER.b;
    if (rule.stained && sat > 0.6 && mx > 0.12) {
      const k = 1 / mx;
      R = THREE.MathUtils.lerp(R, r * k, 0.8);
      G = THREE.MathUtils.lerp(G, gg * k * 0.9, 0.8);
      B = THREE.MathUtils.lerp(B, b * k, 0.8);
    }
    let v = THREE.MathUtils.clamp(0.55 + lum * 2.2, 0.55, 1.2);
    if (rule.lattice) {
      // small diamond panes in lead (5 px), each pane a little lighter or darker than the next (old uneven glass)
      const i = p % W;
      const j = (p / W) | 0;
      const lead = (i + j) % 5 === 0 || (i - j + 5000) % 5 === 0;
      v *= lead ? 0.18 : 0.72 + 0.4 * hash(Math.floor((i + j) / 5), Math.floor((i - j + 5000) / 5), 1.7);
    }
    out.data[p * 4] = Math.min(255, R * v * 255);
    out.data[p * 4 + 1] = Math.min(255, G * v * 255);
    out.data[p * 4 + 2] = Math.min(255, B * v * 255);
    out.data[p * 4 + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = src.flipY;
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.wrapS = src.wrapS;
  t.wrapT = src.wrapT;
  t.name = `${src.name || "atlas"}_window_light`;
  return t;
}

/**
 * Who works late in a building of rooms (Steve, 2026-09-27: "some lights can go out and on, but not all on ... more
 * lights until 0:00 or 1:00 for meetings, and then lights would be on in all windows adjacent to meeting rooms"):
 * shares of its rooms.
 */
interface Rooms {
  /** clerks after dark, each going home between 19:00 and 23:30 */
  evening: number;
  /** meetings a night (not on Sunday): a room and its neighbours on the storey, lit until 0:00 or 1:00 */
  meetings: number;
  /** a watchman's or a caretaker's lamp going round: on and off by the half hour */
  watch: number;
  /** the porter's lodge on the ground floor: all night */
  porter: number;
  /** the first clerks and the cleaners before 7:00 */
  dawn: number;
  /** over this height (world y) a tower or the attics: only a watchman's lamp now and then */
  roof: number;
}

/** A building's night: rooms by the clock, or a church (one hall, dim, its towers dark above `roof`). */
type Night = { rooms: Rooms } | { church: true; roof: number };

const NIGHTS: Array<{ test: RegExp; night: Night }> = [
  { test: /stadhuis/, night: { rooms: { evening: 0.3, meetings: 2, watch: 0.06, porter: 0.08, dawn: 0.18, roof: 19 } } },
  { test: /hanzehuis|oostershuis/, night: { rooms: { evening: 0.2, meetings: 1, watch: 0.05, porter: 0.06, dawn: 0.12, roof: 15 } } },
  { test: /vleeshuis/, night: { rooms: { evening: 0.12, meetings: 0, watch: 0.05, porter: 0.05, dawn: 0.08, roof: 17 } } },
  { test: /steen/, night: { rooms: { evening: 0.1, meetings: 0, watch: 0.07, porter: 0.06, dawn: 0.05, roof: 16 } } },
  { test: /cathedral/, night: { church: true, roof: 29 } },
  { test: /./, night: { church: true, roof: 21 } },
];

/** A window of a building of rooms: the room it lights, where that room is, its strength when lit. */
interface Win {
  /** the first vertex of each of its triangles in the light mesh */
  tris: number[];
  k: number;
  lvl: number;
  room: number;
  storey: number;
  /** in a tower or the attics */
  high: boolean;
  facade: string;
  cell: number;
  spill: SpillSource | null;
}

interface Built {
  building: string;
  mesh: THREE.Mesh;
  night: Night;
  windows: Win[];
  /** the colours at full light, per vertex (the mesh's colour is this times the window's level) */
  full: Float32Array;
  spills: Array<{ s: SpillSource; w: Win }>;
  /** drawn (its model not hidden) */
  shown: boolean;
  /** the evening the meetings were chosen for, and their rooms */
  meetDay: number;
  meet: Set<number>;
  meetEnd: number;
}

export interface LandmarkWindows {
  /** Each frame: the dark outside (day 1 .. 0), the time for the flames' breath, the frame's seconds, the clock. */
  update(day: number, t: number, dt: number, hour: number, dayNum: number): void;
  /** Dev: what glows, per building, and how many of its windows are lit now. */
  info(): Array<{ building: string; material: string; shown: boolean; windows: number; lit: number; spills: number; triangles: number }>;
}

const hash = (a: number, b: number, c: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

export function createLandmarkWindows(scene: THREE.Scene): LandmarkWindows {
  const built: Built[] = [];
  const done = new WeakSet<THREE.Mesh>();
  const pics = new Map<THREE.Texture, THREE.Texture>();
  const pending = new Set<THREE.Mesh>();
  let level = 0;
  let scanT = 0;
  let scans = 0;
  let clockT = 0;
  let lastMin = -1;

  // (the stand-ins of landmarks.glb share the cathedral's atlas under a material without a name)
  const ruleOf = (m: THREE.Material) => {
    const name = m.name || ((m as THREE.MeshLambertMaterial).map?.name ?? "");
    return RULES.find((r) => r.mat.test(name));
  };
  /** Each light material's colour at full night: the atlases carry their own; plain glass pictures lamplight. */
  const tint = new Map<THREE.Material, THREE.Color>();
  // one material per building (all one shader): each fades by its own distance in the fog (onBeforeRender below).
  // No three.js fog on it: fog would add its grey to an additive light; a lit window far in the mist is a soft
  // glow that goes, not a grey pane.
  const matFor = (src: THREE.MeshBasicMaterial | THREE.MeshLambertMaterial, rule: Rule): THREE.MeshBasicMaterial | null => {
    const map = src.map;
    if (!map) return null;
    const pic = pics.get(map) ?? (rule.cells ? glowPicture(map, rule) : map);
    if (!pic) return null;
    pics.set(map, pic);
    const m = psx(
      new THREE.MeshBasicMaterial({ map: pic, vertexColors: true, transparent: true, color: 0x000000, fog: false, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      { affine: 0 },
    );
    m.name = "landmark_window_light";
    tint.set(m, rule.cells ? new THREE.Color(1, 1, 1) : new THREE.Color(1.7, 0.72, 0.2));
    return m;
  };
  const base = new Map<THREE.Material, THREE.Color>();
  const mid = new THREE.Vector3();
  /** Before each draw (any camera: the eye, a mirror, a picture): the building's light fades with the fog's reach. */
  const fade = (o: THREE.Mesh) => (_r: THREE.WebGLRenderer, sc: THREE.Scene, cam: THREE.Camera) => {
    const m = o.material as THREE.MeshBasicMaterial;
    const b = base.get(m);
    if (!b) return;
    const fog = sc.fog as THREE.Fog | null;
    mid.copy(o.geometry.boundingSphere!.center).applyMatrix4(o.matrixWorld);
    const dist = Math.max(0, cam.position.distanceTo(mid) - o.geometry.boundingSphere!.radius * 0.5);
    // (a light carries further through fog than the stone round it: seen to about twice the fog's far)
    const k = fog && fog.isFog ? 1 - THREE.MathUtils.smoothstep(dist, fog.near, fog.far * 2.0) : 1;
    m.color.copy(b).multiplyScalar(k);
  };

  /** The building a shell mesh belongs to (its top group's name), for the dev list. */
  const buildingOf = (o: THREE.Object3D) => {
    let top = o;
    while (top.parent && top.parent !== scene) top = top.parent;
    return top.name || o.name || "?";
  };

  function build(mesh: THREE.Mesh): boolean {
    const g = mesh.geometry;
    const P = g.getAttribute("position") as THREE.BufferAttribute | undefined;
    const UV = g.getAttribute("uv") as THREE.BufferAttribute | undefined;
    if (!P || !UV) return true;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const idx = g.index;
    const tri = idx ? idx.count / 3 : P.count / 3;
    const groups = g.groups.length ? g.groups : [{ start: 0, count: tri * 3, materialIndex: 0 }];
    const vi = (k: number) => (idx ? idx.getX(k) : k);
    const building = buildingOf(mesh);
    const night = NIGHTS.find((n) => n.test.test(`${building} ${mesh.name}`))!.night;
    for (let mi = 0; mi < list.length; mi++) {
      const src = list[mi] as THREE.MeshLambertMaterial;
      const rule = ruleOf(src);
      if (!rule) continue;
      if (!src.map || !(src.map.image as { width?: number } | undefined)?.width) return false; // its picture not in yet
      const mat = matFor(src, rule);
      if (!mat) return false;
      const size = rule.size ?? [1, 1];
      const cellOf = (u: number, v: number) =>
        !rule.cells ? 0 : rule.cells.findIndex(([x, y, w, h]) => u * size[0] >= x && u * size[0] <= x + w && v * size[1] >= y && v * size[1] <= y + h);
      // the glass's triangles (and the atlas cell each shows)
      const tris: number[] = [];
      const cells: number[] = [];
      for (const gr of groups) {
        if ((gr.materialIndex ?? 0) !== mi) continue;
        for (let k = gr.start; k < gr.start + gr.count; k += 3) {
          const a = vi(k);
          const b = vi(k + 1);
          const c = vi(k + 2);
          const cell = cellOf((UV.getX(a) + UV.getX(b) + UV.getX(c)) / 3, (UV.getY(a) + UV.getY(b) + UV.getY(c)) / 3);
          if (cell < 0) continue;
          tris.push(a, b, c);
          cells.push(cell);
        }
      }
      if (!tris.length) continue;
      // the windows: triangles that share a corner are one (a window's lights and its head)
      const key = (i: number) => `${Math.round(P.getX(i) * 50)},${Math.round(P.getY(i) * 50)},${Math.round(P.getZ(i) * 50)}`;
      const ids = new Map<string, number>();
      const parent: number[] = [];
      const find = (i: number): number => {
        while (parent[i] !== i) i = parent[i] = parent[parent[i]];
        return i;
      };
      const node = (i: number) => {
        const k = key(i);
        let n = ids.get(k);
        if (n === undefined) {
          n = parent.length;
          parent.push(n);
          ids.set(k, n);
        }
        return n;
      };
      const tn: number[] = tris.map(node);
      for (let t = 0; t < tn.length; t += 3) {
        const a = find(tn[t]);
        for (const q of [tn[t + 1], tn[t + 2]]) {
          const b = find(q);
          if (a !== b) parent[b] = a;
        }
      }
      const pos = new Float32Array(tris.length * 3);
      const uv = new Float32Array(tris.length * 2);
      const A = new THREE.Vector3();
      const B = new THREE.Vector3();
      const C = new THREE.Vector3();
      const N = new THREE.Vector3();
      type W0 = { box: THREE.Box3; n: THREE.Vector3; area: number; tower: boolean; tris: number[] };
      const win = new Map<number, W0>();
      const NRM = g.getAttribute("normal") as THREE.BufferAttribute | undefined;
      mesh.updateWorldMatrix(true, false);
      const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
      for (let t = 0; t < tris.length; t += 3) {
        A.fromBufferAttribute(P, tris[t]);
        B.fromBufferAttribute(P, tris[t + 1]);
        C.fromBufferAttribute(P, tris[t + 2]);
        // out of the glass: the model's own normal where it has one, else the winding's
        N.subVectors(B, A).cross(C.clone().sub(A));
        const area = N.length() / 2;
        N.normalize();
        if (NRM) N.fromBufferAttribute(NRM, tris[t]).normalize();
        const r = find(tn[t]);
        let w = win.get(r);
        if (!w) win.set(r, (w = { box: new THREE.Box3(), n: new THREE.Vector3(), area: 0, tower: false, tris: [] }));
        w.area += area;
        w.n.addScaledVector(N, area);
        w.tris.push(t);
        if (rule.towerCells?.includes(cells[t / 3])) w.tower = true;
        for (const [j, V] of [A, B, C].entries()) {
          // 3 cm out of the glass, toward the street
          const o = V.clone().addScaledVector(N, 0.03);
          pos.set([o.x, o.y, o.z], (t + j) * 3);
          uv.set([UV.getX(tris[t + j]), UV.getY(tris[t + j])], (t + j) * 2);
          w.box.expandByPoint(V.clone().applyMatrix4(mesh.matrixWorld));
        }
      }
      // each window: its room (a building of rooms: about 2.8 m of front on a storey of one face), its strength
      const Wv = new THREE.Vector3();
      // whole windows (Steve: "a window is a complete window ... always completely off or on"): the panes of one
      // window are not always joined (a cross window's four lights, the sashes): panes in one face's plane whose
      // outlines meet within 0.3 m are one window, lit and dark together
      const panes = [...win.values()];
      const pn = panes.map((w) => {
        const n = w.n.clone().applyMatrix3(nm);
        n.y = 0;
        if (n.lengthSq() > 1e-6) n.normalize();
        const c = w.box.getCenter(new THREE.Vector3());
        const sz = w.box.getSize(new THREE.Vector3());
        const along = c.x * -n.z + c.z * n.x;
        const half = Math.abs(sz.x * n.z) / 2 + Math.abs(sz.z * n.x) / 2;
        return { n, d: c.x * n.x + c.z * n.z, s0: along - half, s1: along + half, y0: w.box.min.y, y1: w.box.max.y };
      });
      const up = panes.map((_, i) => i);
      const top = (i: number): number => {
        while (up[i] !== i) i = up[i] = up[up[i]];
        return i;
      };
      for (let i = 0; i < panes.length; i++)
        for (let j = i + 1; j < panes.length; j++) {
          const a = pn[i];
          const b = pn[j];
          if (a.n.dot(b.n) < 0.9 || Math.abs(a.d - b.d) > 0.4) continue;
          if (a.s0 > b.s1 + 0.3 || b.s0 > a.s1 + 0.3 || a.y0 > b.y1 + 0.3 || b.y0 > a.y1 + 0.3) continue;
          const ra = top(i);
          const rb = top(j);
          if (ra !== rb) up[rb] = ra;
        }
      const whole = new Map<number, W0>();
      panes.forEach((w, i) => {
        const r = top(i);
        const m = whole.get(r);
        if (!m) whole.set(r, { box: w.box.clone(), n: w.n.clone(), area: w.area, tower: w.tower, tris: [...w.tris] });
        else {
          m.box.union(w.box);
          m.n.add(w.n);
          m.area += w.area;
          m.tower ||= w.tower;
          m.tris.push(...w.tris);
        }
      });
      win.clear();
      for (const [k, w] of whole) win.set(k, w);
      const minY = Math.min(...[...win.values()].map((w) => w.box.min.y));
      const windows: Win[] = [];
      const full = new Float32Array(tris.length * 3);
      for (const w of win.values()) {
        const c = w.box.getCenter(new THREE.Vector3());
        const n = w.n.clone().applyMatrix3(nm);
        n.y = 0;
        if (n.lengthSq() > 1e-6) n.normalize();
        const storey = Math.floor((c.y - minY + 0.5) / 3.8);
        const facade = `${Math.round(Math.atan2(n.x, n.z) / (Math.PI / 8))}:${Math.round((c.x * n.x + c.z * n.z) / 1.5)}`;
        const cell = Math.floor((c.x * -n.z + c.z * n.x) / 2.8);
        const room = Math.floor(hash(cell, storey, facade.length * 13 + Math.round(c.x * n.x + c.z * n.z)) * 1e6);
        const h = hash(Math.round(c.x * 2), Math.round(c.y * 2), Math.round(c.z * 2));
        let k: number;
        if ("rooms" in night) k = 0.6 + 0.4 * h;
        // a church: one hall lit by its candles and a few lamps, dim through the glass; the towers dark over the roof
        else k = w.tower || c.y > night.roof ? 0 : 0.24 + 0.08 * h;
        const high = "rooms" in night && c.y > night.rooms.roof;
        const ww: Win = { tris: w.tris, k, lvl: "rooms" in night ? 0 : 1, room, storey, high, facade, cell, spill: null };
        windows.push(ww);
        const warm = 0.92 + 0.16 * hash(w.box.min.x, w.box.min.z, 7);
        const hgt = Math.max(0.5, w.box.max.y - w.box.min.y);
        for (const t of w.tris)
          for (let j = 0; j < 3; j++) {
            // the lamps stand low in the room: the foot of a window brighter than its head (in a church much more)
            Wv.fromBufferAttribute(P, tris[t + j]).applyMatrix4(mesh.matrixWorld);
            const f = THREE.MathUtils.clamp((Wv.y - w.box.min.y) / hgt, 0, 1);
            const kk = k * ("rooms" in night ? 1.15 - 0.55 * f : 1.45 - 1.15 * f);
            full.set([kk * warm, kk, kk * (2 - warm)], (t + j) * 3);
          }
      }
      const col = new Float32Array(full.length);
      if (!("rooms" in night)) col.set(full);
      const og = new THREE.BufferGeometry();
      og.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      og.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      og.setAttribute("color", new THREE.BufferAttribute(col, 3));
      og.computeBoundingSphere();
      const o = new THREE.Mesh(og, mat);
      o.onBeforeRender = fade(o);
      o.name = `${mesh.name}_window_light`;
      o.renderOrder = 2;
      // (the glass's own light: the interior check looks through it, dev/interiorcheck.ts)
      o.userData.glass = true;
      // (always drawn, black by day: its shader is built with the town's, not at the first dusk)
      mesh.add(o);
      // the light on the street: the biggest low windows of the building (up to 14 a mesh). Only the ground floor's
      // and a church's low glass: an upper window's light, thrown per pixel, lit the pilasters beside it in bright
      // streaks (Steve's picture of the town hall, 2026-09-27)
      const spills: Built["spills"] = [];
      const ws = [...win.values()];
      const cand = ws
        .map((w, i) => ({ w, ww: windows[i] }))
        .filter(({ w, ww }) => w.area > 0.5 && w.box.min.y < ("rooms" in night ? minY + 3 : 14) && ww.k > 0)
        .sort((a, b) => a.w.box.min.y - b.w.box.min.y || b.w.area - a.w.area)
        .slice(0, 14);
      for (const { w, ww } of cand) {
        const n = w.n.clone().applyMatrix3(nm);
        n.y = 0;
        if (n.lengthSq() < 1e-6) continue;
        n.normalize();
        const c = w.box.getCenter(new THREE.Vector3());
        const s = w.box.getSize(new THREE.Vector3());
        const s0 = addSpill({ kind: "hall", label: `${building} window`, x: c.x, y: c.y, z: c.z, nx: n.x, nz: n.z, hw: Math.max(0.3, Math.hypot(s.x, s.z) / 2), hh: Math.max(0.3, s.y / 2), power: 70 * ww.k * rule.power, range: 11, bars: 0 });
        ww.spill = s0;
        spills.push({ s: s0, w: ww });
      }
      let shown = true;
      for (let q: THREE.Object3D | null = mesh; q; q = q.parent) if (!q.visible) shown = false;
      built.push({ building, mesh: o, night, windows, full, spills, shown, meetDay: -1, meet: new Set(), meetEnd: 12 });
    }
    return true;
  }

  function scan() {
    scans++;
    for (const b of built) {
      let o: THREE.Object3D | null = b.mesh;
      b.shown = true;
      for (; o; o = o.parent) if (!o.visible) b.shown = false;
    }
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || done.has(m) || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
      const list = Array.isArray(m.material) ? m.material : [m.material];
      if (!list.some((q) => q && ruleOf(q))) {
        done.add(m);
        return;
      }
      pending.add(m);
    });
    for (const m of pending) {
      if (build(m)) {
        pending.delete(m);
        done.add(m);
      }
    }
  }

  /**
   * A room's lamp now (0 dark .. 1.2 a meeting's chandelier): n hours from noon (6 = 18:00, 12 = midnight), `eve` the
   * evening's day (the day before after midnight), its building's rooms and tonight's meetings.
   */
  function roomLevel(b: Built, R: Rooms, w: Win, n: number, eve: number): number {
    const r = w.room;
    // a tower's or an attic's window: dark but for a watchman's lamp going by now and then
    if (w.high) return hash(r, Math.floor((n * 60) / 40), eve) < 0.04 ? 0.35 : 0;
    if (w.storey === 0 && hash(r, 1, 5) < R.porter) return 0.5;
    if (b.meet.has(r) && n < b.meetEnd) return 1.2;
    if (hash(r, eve, 1) < R.evening && n < 7 + 4.5 * hash(r, eve, 2)) return w.k;
    if (hash(r, 3, 3) < R.watch) {
      const slot = Math.floor((n * 60) / 25 + hash(r, 4, 4) * 7);
      if (hash(r, slot, eve) < 0.4) return 0.42;
    }
    if (n > 17.5 + 1.2 * hash(r, eve, 6) && n < 19.5 && hash(r, eve, 4) < R.dawn) return w.k * 0.9;
    return 0;
  }

  /** Tonight's meetings in a building: a room off the ground floor and its neighbours along the storey (not on Sunday). */
  function chooseMeetings(b: Built, R: Rooms, eve: number) {
    b.meetDay = eve;
    b.meet.clear();
    b.meetEnd = hash(eve, b.windows.length, 8) < 0.5 ? 12 : 13;
    if (eve % 7 === 0 || !R.meetings) return;
    const upper = b.windows.filter((w) => w.storey > 0 && !w.high);
    const pool = upper.length ? upper : b.windows;
    const seeds = [...pool].sort((a, c) => hash(a.room, eve, 9) - hash(c.room, eve, 9)).slice(0, R.meetings);
    for (const s of seeds) for (const w of b.windows) if (!w.high && w.facade === s.facade && w.storey === s.storey && Math.abs(w.cell - s.cell) <= 2) b.meet.add(w.room);
  }

  return {
    update(day, t, dt, hour, dayNum) {
      scanT -= dt;
      // the models come in over the first minute: look again every so often until the last one is in
      if (scanT <= 0) {
        scanT = scans < 30 ? 2 : 20;
        scan();
      }
      level = THREE.MathUtils.clamp((0.5 - day) / 0.3, 0, 1);
      // the rooms by the clock: looked at twice a second, the mesh's colours written only when a lamp changes
      clockT -= dt;
      const min = Math.floor(hour * 60);
      if (clockT <= 0 || min !== lastMin) {
        clockT = 0.5;
        lastMin = min;
        const n = (hour - 12 + 24) % 24;
        const eve = hour < 12 ? dayNum - 1 : dayNum;
        for (const b of built) {
          if (!("rooms" in b.night)) continue;
          const R = b.night.rooms;
          if (b.meetDay !== eve) chooseMeetings(b, R, eve);
          const col = b.mesh.geometry.getAttribute("color") as THREE.BufferAttribute;
          let changed = false;
          for (const w of b.windows) {
            const lvl = roomLevel(b, R, w, n, eve);
            if (lvl === w.lvl) continue;
            w.lvl = lvl;
            changed = true;
            const arr = col.array as Float32Array;
            for (const tt of w.tris) for (let q = tt * 3; q < tt * 3 + 9; q++) arr[q] = b.full[q] * (lvl / Math.max(0.01, w.k));
          }
          if (changed) col.needsUpdate = true;
        }
      }
      const breath = 0.94 + 0.04 * Math.sin(t * 1.3) + 0.02 * Math.sin(t * 3.7);
      for (const b of built) {
        const m = b.mesh.material as THREE.MeshBasicMaterial;
        let c = base.get(m);
        if (!c) base.set(m, (c = new THREE.Color()));
        c.copy(tint.get(m) ?? m.color).multiplyScalar(level * 1.35 * breath);
        m.color.copy(c);
        // a stand-in hidden by its detailed model throws no light
        const on = b.shown ? level : 0;
        for (const { s, w } of b.spills) {
          const k = "rooms" in b.night ? w.lvl / Math.max(0.01, w.k) : 1;
          s.level = on * k;
          s.glow = () => on * k;
        }
      }
    },
    info() {
      return built.map((b) => ({
        building: b.building,
        material: b.mesh.name,
        shown: b.shown,
        windows: b.windows.length,
        lit: b.windows.filter((w) => w.lvl > 0 && w.k > 0).length,
        spills: b.spills.length,
        triangles: (b.mesh.geometry.getAttribute("position").count / 3) | 0,
      }));
    },
  };
}
