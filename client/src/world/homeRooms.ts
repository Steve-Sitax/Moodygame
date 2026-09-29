import * as THREE from "three";
import { psx } from "../retro/psx";
import { Builder, canvasTex, flicker, frameRoom, lambert, mat, mergeStatic, plaster, rand, tex, wallFace, type FaceHole, type Room, type Spot } from "./rooms";
import type { Rect } from "../../../shared/hallPlan";
import { homeWindowY, ROOM_DOOR, roomToLocal, SILL, UNDER_ROOF, type HousePlan } from "../../../shared/housePlan";
import { makePiece, type Piece } from "./furniture";
import { createFires, type Fires } from "./fire";
import { CELL, CLASSES, footprint, FURNITURE, wallOf, type HomeClass, type Placed } from "../../../shared/homes";

// The rented rooms (M6 homes): one per class, sized and furnished by shared/homes.ts (the
// server's numbers), built in code like the taproom (world/rooms.ts). M7: each inside its own
// house in the world (shared/housePlan.ts), up or down the house's stair where it is not on the
// ground floor. The room frame has its front wall (the street's side) at z 0, x across, z into the house. The room keeps its pieces on the engine's
// grid: `setPlaced` redraws what the server says stands where, `ghost` shows the piece Jef
// is moving, green where it may go and red where not.

export interface HomeRoom {
  cls: HomeClass;
  /** Redraw the pieces Jef owns (the server's list). */
  setPlaced(list: Placed[]): void;
  /** The piece Jef is moving (null: none), and whether it may go there. */
  ghost(g: { kind: string; gx: number; gz: number; rot: number; ok: boolean } | null): void;
  /** Where each placed piece is in the room frame (for "pick it up"). */
  pieces(): Array<{ id: number; kind: string; x: number; z: number; y: number }>;
  /** The bed's middle, and a point by it (for "go to bed"). */
  bed: { x: number; z: number; r: number };
  /** Fires Jef may warm himself at (the hearth, a stove), room frame. */
  fires(): Spot[];
  /** Is this floor point covered by a piece or the room's own furniture? */
  blocked(x: number, z: number, r: number): boolean;
}

/** Room frame centre of a footprint (floor pieces, rugs, the fixed furniture). */
export function footCentre(cls: HomeClass, gx: number, gz: number, w: number, d: number): { x: number; z: number } {
  const c = CLASSES[cls];
  return { x: -c.W / 2 + (gx + w / 2) * CELL, z: (gz + d / 2) * CELL };
}

/** Where a piece stands and how it is turned (room frame). */
export function pieceFrame(cls: HomeClass, kind: string, gx: number, gz: number, rot: number): { x: number; z: number; yaw: number } {
  const c = CLASSES[cls];
  const def = FURNITURE[kind];
  if (def?.layer === "wall") {
    const wall = wallOf(rot);
    const along = (wall === 0 || wall === 2 ? gx : gz) + def.w / 2;
    if (wall === 0) return { x: -c.W / 2 + along * CELL, z: c.D - 0.01, yaw: Math.PI };
    if (wall === 2) return { x: -c.W / 2 + along * CELL, z: 0.01, yaw: 0 };
    if (wall === 1) return { x: c.W / 2 - 0.01, z: along * CELL, yaw: -Math.PI / 2 };
    return { x: -c.W / 2 + 0.01, z: along * CELL, yaw: Math.PI / 2 };
  }
  if (def?.layer === "ceiling") return { ...footCentre(cls, gx, gz, 1, 1), yaw: 0 };
  const fp = footprint(def?.w ?? 1, def?.d ?? 1, rot);
  return { ...footCentre(cls, gx, gz, fp.w, fp.d), yaw: (rot * Math.PI) / 2 };
}

/** The painted street through the window: the houses opposite, a gas lamp, cobbles. */
function streetView(cls: HomeClass): THREE.CanvasTexture {
  const r = rand(cls.length * 131);
  return canvasTex(64, 64, (g) => {
    const sky = g.createLinearGradient(0, 0, 0, 40);
    sky.addColorStop(0, "#8a929a");
    sky.addColorStop(1, "#b0aca0");
    g.fillStyle = sky;
    g.fillRect(0, 0, 64, 64);
    // (issue #28: the cellar's window is real, onto its light well under the pavement: no painted view of its own)
    const low = cls === "garret" ? 10 : 22;
    for (let x = -4; x < 64; x += 14) {
      const h = 30 + r() * 20;
      g.fillStyle = ["#6a5446", "#5a4a40", "#7a6250", "#4e443c"][Math.floor(r() * 4)];
      g.fillRect(x, 64 - h - low, 13, h + low);
      g.beginPath();
      g.moveTo(x, 64 - h - low);
      g.lineTo(x + 6.5, 64 - h - low - 8);
      g.lineTo(x + 13, 64 - h - low);
      g.fill();
      for (let wy = 64 - h - low + 4; wy < 60; wy += 9) {
        g.fillStyle = r() < 0.3 ? "#d8b060" : "#2a2a30";
        g.fillRect(x + 3, wy, 3, 5);
        g.fillRect(x + 8, wy, 3, 5);
      }
    }
    if (cls === "garret") {
      // over the roofs: the cathedral spire in the haze
      g.fillStyle = "#6e7278";
      g.fillRect(44, 4, 5, 30);
      g.beginPath();
      g.moveTo(44, 4);
      g.lineTo(46.5, -6);
      g.lineTo(49, 4);
      g.fill();
    } else if (cls === "merchant") {
      // the river under the windows, a mast
      g.fillStyle = "#4a5a60";
      g.fillRect(0, 50, 64, 14);
      g.fillStyle = "#2a2218";
      g.fillRect(20, 10, 2, 42);
      g.fillRect(10, 46, 26, 5);
    } else {
      g.fillStyle = "#3a3a38";
      g.fillRect(0, 58, 64, 6);
      g.fillStyle = "#1a1816";
      g.fillRect(30, 30, 2, 28);
      g.fillStyle = "#e8c070";
      g.fillRect(28, 27, 6, 5);
    }
  }, false);
}

function wallpaper(): THREE.CanvasTexture {
  return canvasTex(32, 32, (g) => {
    g.fillStyle = "#b8ae90";
    g.fillRect(0, 0, 32, 32);
    for (let x = 0; x < 32; x += 8) {
      g.fillStyle = "#a89e7e";
      g.fillRect(x, 0, 3, 32);
      g.fillStyle = "#8a6a5a";
      for (let y = 4; y < 32; y += 8) g.fillRect(x + 5, y, 2, 2);
    }
    g.fillStyle = "rgba(40,30,20,0.18)";
    g.fillRect(0, 0, 32, 5);
  });
}

interface Look {
  floor: THREE.Material;
  wall: THREE.Material;
  ceil: THREE.Material;
  beam: THREE.Material;
  fog: number;
  fill: [number, number];
  /** Metres of wall to one repeat of its texture. */
  tile: number;
}

function looks(cls: HomeClass, seed: number): Look {
  const beam = lambert("h_beam", { map: tex().planks, color: 0x4a3626 });
  const planks = lambert("h_planks", { map: tex().planks, color: 0x8a7058 });
  switch (cls) {
    case "cellar":
      return {
        floor: lambert("h_flags", { map: tex().cobble, color: 0x8a8278 }),
        wall: lambert("h_cellarbrick", { map: tex().brick, color: 0x8a6e60 }),
        ceil: lambert("h_ceilplank", { map: tex().planks, color: 0x4a3a2c }),
        beam,
        fog: 0x120e0a,
        fill: [0.8, 1.0],
        tile: 2.4,
      };
    case "garret":
      return {
        floor: planks,
        wall: mat(`h_plaster_g${seed}`, () => psx(new THREE.MeshLambertMaterial({ map: plaster(seed, [150, 138, 112]) }), { affine: 0.3 })),
        ceil: lambert("h_roofboards", { map: tex().planks, color: 0x6a5240 }),
        beam,
        fog: 0x16120e,
        fill: [1.0, 0.8],
        tile: 2.4,
      };
    case "widow":
      return {
        floor: lambert("h_scrubbed", { map: tex().planks, color: 0x9a8268 }),
        wall: mat("h_wallpaper", () => psx(new THREE.MeshLambertMaterial({ map: wallpaper() }), { affine: 0.3 })),
        ceil: lambert("h_ceilwhite", { color: 0xc8c0aa }),
        beam,
        fog: 0x18140f,
        fill: [1.1, 0.9],
        tile: 2.4,
      };
    case "alley":
      return {
        floor: lambert("h_redtile", { map: tex().brick, color: 0xb07058 }),
        wall: mat(`h_white${seed}`, () => psx(new THREE.MeshLambertMaterial({ map: plaster(seed, [196, 190, 172]) }), { affine: 0.3 })),
        ceil: lambert("h_ceilplank2", { map: tex().planks, color: 0x5a4432 }),
        beam,
        fog: 0x16120e,
        fill: [1.0, 0.85],
        tile: 2.4,
      };
    case "merchant":
      return {
        floor: lambert("h_polished", { map: tex().planks, color: 0x6a4a32 }),
        wall: mat("h_damask", () => psx(new THREE.MeshLambertMaterial({ map: damask() }), { affine: 0.3 })),
        ceil: lambert("h_ceilplaster", { color: 0xd8d0bc }),
        beam: lambert("h_cornice", { color: 0xcfc6ae }),
        fog: 0x1a1612,
        fill: [1.2, 1.0],
        tile: 0.8,
      };
  }
}

/**
 * M7: a rented room of its class inside its own house (shared/housePlan.ts; world/houseInWorld.ts puts it in the
 * world). On the ground floor (the widow's front room, the alley house) the room's door is the house's street
 * door and its window is cut through the front (mirrored across when the window would fall outside the house);
 * up or down the house's stair (the garret, the merchant's floor, the cellar) its door is in the back wall onto
 * the landing, the windows stay on the street: the merchant's cut through the painted ones, the garret's its dormer's,
 * the cellar's under the pavement onto its light well (issue #28). Walls, floor, ceiling (a garret's roof slopes down to
 * knee walls), the room's own furniture (shared/homes.ts), its light, and the pieces Jef owns. The room's frame
 * (x across from its middle, z in from its front wall) is the grid's; the stair, the landings and the corridor
 * from the street door are built in the house's frame.
 */
export function buildHome(opts: { plan: HousePlan; cls: HomeClass; seed: number }): Room {
  const plan = opts.plan;
  const rf = plan.roomFrame!;
  const cls = opts.cls;
  const c = CLASSES[cls];
  const { W, D } = c;
  const doorWall = c.doorWall ?? 2;
  // a ground-floor room is at least as high as the street door with its transom
  const H = doorWall === 2 ? Math.max(c.H, plan.door.yt - SILL + 0.12) : c.H;
  const L = looks(cls, opts.seed % 997);
  const { scene, group: house } = frameRoom(plan.origin, plan.yaw, L.fog);
  scene.background = null;
  (scene.fog as THREE.Fog).near = 6;
  (scene.fog as THREE.Fog).far = 24;
  // the room's own frame inside the house's
  const group = new THREE.Group();
  group.position.set(rf.x, rf.y, rf.z);
  group.scale.x = rf.mirror;
  house.add(group);
  house.updateMatrixWorld(true);
  const toWorld = (x: number, z: number, y = 0) => group.localToWorld(new THREE.Vector3(x, y, z));
  const toLocal = (wx: number, wz: number): [number, number] => {
    const v = group.worldToLocal(new THREE.Vector3(wx, 0, wz));
    return [v.x, v.z];
  };
  // everything that never moves is built into `stat` and drawn merged by material at the end
  const stat = new THREE.Group();
  group.add(stat);
  const b = new Builder(stat);
  const garret = cls === "garret";
  const knee = 1.0;
  // issue #10: a garret behind a dormer of the house's front slope (plan.dormer): its walls, ceilings and the dormer's
  // bay are built in the house's frame under the house's own roof (garretUnderRoof), its window the dormer's
  const underRoof = garret && !!plan.dormer && !!plan.roof;

  // the windows: cut through the house (the plan's holes, in the room's frame), else painted on the front wall
  const holes = plan.windows.filter((w) => w.kind === "hole");
  const cut = holes.length > 0;
  const [wyA, wyB] = homeWindowY(cls, H);
  const win = cut
    ? holes.map((w) => {
        const xa = (w.a[0] - rf.x) * rf.mirror;
        const xb = (w.b[0] - rf.x) * rf.mirror;
        return { x0: Math.min(xa, xb), x1: Math.max(xa, xb), y0: w.y0 - rf.y, y1: w.y1 - rf.y };
      })
    : c.windows.map(([a, z]) => ({ x0: -W / 2 + a * CELL + 0.05, x1: -W / 2 + (z + 1) * CELL - 0.05, y0: wyA, y1: wyB }));
  const wy0 = win[0]?.y0 ?? wyA;
  const wy1 = win[0]?.y1 ?? wyB;

  // floor and ceiling
  if (!underRoof) b.box(W, 0.1, D, 0, -0.05, D / 2, L.floor, { tile: cls === "alley" ? 0.8 : 1.4 });
  const doorHole: FaceHole = { s0: W / 2 - plan.door.w / 2, s1: W / 2 + plan.door.w / 2, y0: -1, y1: plan.door.yt - SILL };
  const backDoor: FaceHole = { s0: W / 2 - ROOM_DOOR / 2, s1: W / 2 + ROOM_DOOR / 2, y0: -1, y1: 2.1 };
  const frontHoles: FaceHole[] = [...(doorWall === 2 ? [doorHole] : []), ...(cut ? win.map((w) => ({ s0: w.x0 + W / 2, s1: w.x1 + W / 2, y0: w.y0, y1: w.y1 })) : [])];
  if (underRoof) {
    // (the floor, the walls, the ceilings and the dormer's bay: garretUnderRoof, below, in the house's frame)
  } else if (garret) {
    // the roof slopes from the knee walls up to the ridge
    const run = W / 2;
    const rise = H - knee;
    const len = Math.hypot(run, rise);
    const ang = Math.atan2(rise, run);
    for (const s of [-1, 1]) {
      const m = b.box(len, 0.06, D, (s * run) / 2, knee + rise / 2, D / 2, L.ceil, { tile: 1.2 });
      m.rotation.z = -s * ang;
      wallFace(stat, s < 0 ? [-W / 2, D] : [W / 2, 0], s < 0 ? [-W / 2, 0] : [W / 2, D], 0, knee, [-s, 0], [], L.wall, 2.2);
      for (let z = 0.6; z < D; z += 1.1) {
        const raf = b.box(len, 0.1, 0.08, (s * run) / 2, knee + rise / 2 - 0.06, z, L.beam);
        raf.rotation.z = -s * ang;
      }
    }
    b.box(0.14, 0.14, D, 0, H - 0.08, D / 2, L.beam);
  } else {
    b.box(W, 0.1, D, 0, H + 0.05, D / 2, L.ceil, { tile: 1.6 });
    wallFace(stat, [-W / 2, D], [-W / 2, 0], 0, H, [1, 0], [], L.wall, L.tile);
    wallFace(stat, [W / 2, 0], [W / 2, D], 0, H, [-1, 0], [], L.wall, L.tile);
    if (cls !== "merchant") for (let z = 1.0; z < D; z += 1.4) b.box(W, 0.18, 0.16, 0, H - 0.09, z, L.beam, { tile: 1.2 });
    else for (const s of [-1, 1]) b.box(0.12, 0.12, D, s * (W / 2 - 0.06), H - 0.06, D / 2, L.beam);
  }
  // the front wall (the street's side) and the back wall (a gable in the garret: up to the ridge; the slopes hide its corners)
  if (!underRoof) {
    wallFace(stat, [-W / 2, 0], [W / 2, 0], 0, H, [0, 1], frontHoles, L.wall, L.tile);
    wallFace(stat, [W / 2, D], [-W / 2, D], 0, H, [0, -1], doorWall === 0 ? [backDoor] : [], L.wall, L.tile);
  }
  if (doorWall === 0) {
    // the doorway through the back wall onto the landing: its reveal, a threshold board
    const dm = lambert("h_doorframe", { map: tex().planks, color: 0x4a3626 });
    for (const s of [-1, 1]) b.box(0.06, 2.1, 0.24, s * (ROOM_DOOR / 2 + 0.03), 1.05, D + 0.1, dm);
    b.box(ROOM_DOOR + 0.12, 0.08, 0.24, 0, 2.14, D + 0.1, dm);
    b.box(ROOM_DOOR, 0.1, 0.3, 0, -0.05, D + 0.1, dm);
  }
  if (cls === "merchant") {
    // panelling below the dado rail on three walls
    const panel = lambert("h_panel", { map: tex().planks, color: 0x4a3222 });
    b.box(W / 2 - 0.5, 0.9, 0.04, -W / 4 - 0.25, 0.45, D - 0.02, panel);
    b.box(W / 2 - 0.5, 0.9, 0.04, W / 4 + 0.25, 0.45, D - 0.02, panel);
    for (const s of [-1, 1]) b.box(0.04, 0.9, D, s * (W / 2 - 0.02), 0.45, D / 2, panel);
  }
  // the windows: a painted view of the street where none is cut; sills and bars on the painted ones
  const view = new THREE.MeshBasicMaterial({ map: streetView(cls), color: 0x404040 });
  for (const w of win) {
    if (underRoof) continue; // (the dormer's sill: garretUnderRoof)
    if (cut) {
      b.box(w.x1 - w.x0 + 0.08, 0.05, 0.14, (w.x0 + w.x1) / 2, w.y0 - 0.02, 0.05, L.beam);
      continue;
    }
    b.plane(w.x1 - w.x0, w.y1 - w.y0, (w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2, 0.02, 0, view);
    b.box(w.x1 - w.x0 + 0.08, 0.05, 0.14, (w.x0 + w.x1) / 2, w.y0 - 0.02, 0.07, L.beam);
    b.box(0.04, w.y1 - w.y0, 0.05, (w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2, 0.04, L.beam);
    b.box(w.x1 - w.x0, 0.04, 0.05, (w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2, 0.04, L.beam);
  }
  if (cls === "merchant") merchantDress(b, W, D, H, win, wy0, wy1);
  if (cls === "widow") {
    // her crucifix on the back wall, a palm sprig behind it
    const dark = lambert("f_dark", { map: tex().planks, color: 0x4a3424 });
    b.box(0.04, 0.34, 0.03, -W / 2 + 3.5 * CELL, 1.75, D - 0.02, dark);
    b.box(0.2, 0.04, 0.03, -W / 2 + 3.5 * CELL, 1.82, D - 0.02, dark);
  }

  // light: daylight at the windows, a low fill, and the pieces' own lights
  const hemi = new THREE.HemisphereLight(0xa0a4a8, 0x6a5a48, 0.4);
  const amb = new THREE.AmbientLight(0x6a543c, 1.25);
  scene.add(hemi, amb);
  let ambK = 1;
  const winLight = new THREE.PointLight(0xb8c0c8, 0, 6, 1.4);
  winLight.position.set(win.length ? (win[0].x0 + win[0].x1) / 2 : 0, (wy0 + wy1) / 2, 0.6);
  group.add(winLight);

  // the room's own furniture
  type Lit = { light: THREE.PointLight; power: number; glow?: THREE.Sprite; seed: number; p: THREE.Vector3 };
  const lit: Lit[] = [];
  const fixedBlocks: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> = [];
  let fires: Fires | null = null;
  const fireSpots: Spot[] = [];
  const addLight = (pc: Piece, at: THREE.Object3D, into: Lit[]) => {
    if (!pc.light) return;
    const l = new THREE.PointLight(pc.light.color, pc.light.power, 6, 1.5);
    l.position.set(pc.light.x, pc.light.y, pc.light.z);
    at.add(l);
    into.push({ light: l, power: pc.light.power, glow: pc.light.glow, seed: into.length * 3.7 + 1, p: new THREE.Vector3() });
  };
  let bed = { x: 0, z: D - 1, r: 1 };
  for (const f of c.fixed) {
    const pc = makePiece(f.kind, H);
    const at = footCentre(cls, f.gx, f.gz, f.w, f.d);
    pc.group.position.set(at.x, 0, at.z);
    pc.group.rotation.y = (f.rot * Math.PI) / 2;
    stat.add(pc.group);
    addLight(pc, pc.group, lit);
    fixedBlocks.push({ minX: -W / 2 + f.gx * CELL, maxX: -W / 2 + (f.gx + f.w) * CELL, minZ: f.gz * CELL, maxZ: (f.gz + f.d) * CELL });
    if (f.kind.startsWith("bed")) bed = { x: at.x, z: at.z, r: Math.max(f.w, f.d) * CELL * 0.5 + 0.55 };
    if (f.kind === "hearth" || f.kind === "stove_tile" || f.kind === "mantel") {
      const dir = (f.rot * Math.PI) / 2;
      fireSpots.push({ x: at.x + Math.sin(dir) * 0.9, z: at.z + Math.cos(dir) * 0.9, yaw: dir + Math.PI });
      if (f.kind !== "stove_tile") {
        const back = f.kind === "mantel" ? -0.05 : 0.05;
        const fw = toWorld(at.x + Math.sin(dir) * back, at.z + Math.cos(dir) * back, 0.1);
        fires = createFires(scene, [{ x: fw.x, y: fw.y, z: fw.z, size: f.kind === "mantel" ? 0.4 : 0.35 }]);
      }
    }
  }
  if (cls === "merchant") {
    // a brass chandelier over the table
    const table = c.fixed.find((f) => f.kind === "table_fine");
    const pc = makePiece("chandelier", H);
    const at = table ? footCentre(cls, table.gx, table.gz, table.w, table.d) : { x: 0, z: D / 2 };
    pc.group.position.set(at.x, 0, at.z);
    stat.add(pc.group);
    addLight(pc, pc.group, lit);
  }
  mergeStatic(stat, group);
  if (underRoof) {
    const env = new THREE.Group();
    house.add(env);
    garretUnderRoof(new Builder(env), plan, W, D, H, L);
    mergeStatic(env, house);
  }
  // the stair, the landings and the corridor from the street door (the house's frame)
  if (doorWall === 0) {
    const sw = new THREE.Group();
    house.add(sw);
    buildStairwell(new Builder(sw), plan, L);
    mergeStatic(sw, house);
    // a candle on the landing at the room's door, so the last flight is seen
    const land = new THREE.PointLight(0xffa860, 1.6, 7, 1.5);
    land.position.set(rf.x, rf.y + 1.9, rf.z + D + 0.8);
    house.add(land);
  }

  // the pieces Jef owns
  const own = new THREE.Group();
  group.add(own);
  let ownLit: Lit[] = [];
  let placed: Array<{ p: Placed; x: number; z: number; y: number }> = [];
  let ownBlocks: typeof fixedBlocks = [];

  const ghostGroup = new THREE.Group();
  group.add(ghostGroup);
  const okMat = new THREE.MeshBasicMaterial({ color: 0x3a8a3a, transparent: true, opacity: 0.35, depthWrite: false });
  const badMat = new THREE.MeshBasicMaterial({ color: 0x9a2a22, transparent: true, opacity: 0.4, depthWrite: false });
  let ghostKey = "";
  let ghostPiece: Piece | null = null;
  const marker = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), okMat);
  ghostGroup.add(marker);
  ghostGroup.visible = false;

  const blocked = (px: number, pz: number, r: number) =>
    [...fixedBlocks, ...ownBlocks].some((q) => px > q.minX - r && px < q.maxX + r && pz > q.minZ - r && pz < q.maxZ + r);

  // the furniture as solids for walking, in the house's frame (World.addWalkArea by the plan)
  const solids: Rect[] = [];
  const toPlan = (q: { minX: number; maxX: number; minZ: number; maxZ: number }): Rect => {
    const [xa, za] = roomToLocal(rf, q.minX, q.minZ);
    const [xb, zb] = roomToLocal(rf, q.maxX, q.maxZ);
    return { minX: Math.min(xa, xb), maxX: Math.max(xa, xb), minZ: Math.min(za, zb), maxZ: Math.max(za, zb) };
  };
  const setSolids = () => {
    solids.length = 0;
    // the bed and the big pieces stop Jef; the rest he steps round as ever
    for (const q of [...fixedBlocks, ...ownBlocks]) solids.push(toPlan({ minX: q.minX + 0.05, maxX: q.maxX - 0.05, minZ: q.minZ + 0.05, maxZ: q.maxZ - 0.05 }));
  };
  setSolids();

  const home: HomeRoom = {
    cls,
    bed,
    setPlaced(list) {
      for (const o of [...own.children]) own.remove(o);
      ownLit = [];
      ownBlocks = [];
      placed = [];
      for (const p of list) {
        const def = FURNITURE[p.kind];
        if (!def) continue;
        const pc = makePiece(p.kind, H);
        const f = pieceFrame(cls, p.kind, p.gx, p.gz, p.rot);
        pc.group.position.set(f.x, 0, f.z);
        pc.group.rotation.y = f.yaw;
        own.add(pc.group);
        addLight(pc, pc.group, ownLit);
        placed.push({ p, x: f.x, z: f.z, y: def.layer === "wall" ? 1.6 : def.layer === "ceiling" ? H - 0.6 : 0.4 });
        if (def.layer === "floor") {
          const fp = footprint(def.w, def.d, p.rot);
          ownBlocks.push({ minX: -W / 2 + p.gx * CELL + 0.05, maxX: -W / 2 + (p.gx + fp.w) * CELL - 0.05, minZ: p.gz * CELL + 0.05, maxZ: (p.gz + fp.d) * CELL - 0.05 });
        }
      }
      setSolids();
    },
    ghost(gh) {
      if (!gh) {
        ghostGroup.visible = false;
        return;
      }
      const def = FURNITURE[gh.kind];
      if (!def) return;
      if (ghostKey !== gh.kind) {
        if (ghostPiece) ghostGroup.remove(ghostPiece.group);
        ghostPiece = makePiece(gh.kind, H);
        ghostGroup.add(ghostPiece.group);
        ghostKey = gh.kind;
      }
      const f = pieceFrame(cls, gh.kind, gh.gx, gh.gz, gh.rot);
      ghostPiece!.group.position.set(f.x, 0, f.z);
      ghostPiece!.group.rotation.y = f.yaw;
      marker.material = gh.ok ? okMat : badMat;
      if (def.layer === "wall") {
        marker.scale.set(def.w * CELL, 0.9, 1);
        marker.position.set(f.x + Math.sin(f.yaw) * 0.02, 1.6, f.z + Math.cos(f.yaw) * 0.02);
        marker.rotation.set(0, f.yaw, 0);
      } else {
        const fp = def.layer === "ceiling" ? { w: 1, d: 1 } : footprint(def.w, def.d, gh.rot);
        marker.scale.set(fp.w * CELL, fp.d * CELL, 1);
        marker.position.set(f.x, 0.02, f.z);
        marker.rotation.set(-Math.PI / 2, 0, 0);
      }
      ghostGroup.visible = true;
    },
    pieces() {
      return placed.map((q) => ({ id: q.p.id, kind: q.p.kind, x: q.x, z: q.z, y: q.y }));
    },
    fires() {
      const out = [...fireSpots];
      for (const q of placed) if (q.p.kind === "stove") out.push({ x: q.x, z: q.z, yaw: 0 });
      return out;
    },
    blocked,
  };

  const inDoor = doorWall === 0 ? D : 0;
  const inward = doorWall === 0 ? -1 : 1;
  const stands: Spot[] = [
    { x: 0.55, z: inDoor + inward * 0.75, yaw: inward > 0 ? 0 : Math.PI },
    { x: -0.55, z: inDoor + inward * 0.8, yaw: inward > 0 ? 0.2 : Math.PI - 0.2 },
  ];
  const winPt = new THREE.Vector3();
  let day = 0;
  const room: Room = {
    kind: "home",
    scene,
    group,
    walk: (fx, fz) => [fx, fz],
    seats: [],
    stands,
    exit: { x: 0, z: inDoor + inward * 0.35, yaw: inward > 0 ? Math.PI : 0 },
    entry: { x: 0, z: inDoor + inward * 0.95, yaw: inward > 0 ? 0 : Math.PI },
    lamps: [],
    toWorld,
    toLocal,
    floor: () => 0,
    home,
    solids,
    level: plan.levels.length - 1,
    setAmbient(k) {
      ambK = k;
      room.setDaylight(day);
    },
    setDaylight(k) {
      day = k;
      view.color.setScalar(0.12 + 0.88 * k);
      hemi.intensity = (L.fill[1] + L.fill[0] * k) * ambK;
      amb.intensity = 1.25 * ambK;
      winLight.intensity = 2.5 * k * win.length;
    },
    update(t) {
      fires?.update(t);
      const all = [...lit, ...ownLit];
      room.lamps = [];
      all.forEach((q) => {
        const f = flicker(t, q.seed);
        q.light.intensity = q.power * f;
        if (q.glow) q.glow.material.opacity = 0.75 * f;
        if (room.lamps.length < 4) room.lamps.push({ p: q.light.getWorldPosition(q.p), w: 0.3 * f });
      });
      if (win.length && day > 0.2 && room.lamps.length < 4) room.lamps.push({ p: winLight.getWorldPosition(winPt), w: 0.12 * day });
    },
  };
  room.update(0, 0);
  return room;
}

/**
 * M7: the way up (or down) to a room with its door in the back wall, in the house's frame: the corridor from
 * the street door under the room, the stairwell behind it with its switchback flights in two lanes, the
 * landings, the rails, walls round it all and a ceiling. Solid enough to be seen from the street through
 * the door and walked in the dark.
 */
function buildStairwell(b: Builder, plan: HousePlan, L: Look): void {
  const well = plan.well!;
  const wr = well.rect;
  const rf = plan.roomFrame!;
  const D = CLASSES[plan.entry.cls as HomeClass].D;
  const cor = plan.landings[0].rect;
  const g = b.group;
  const plaster2 = L.wall;
  const boards = lambert("h_stairboards", { map: tex().planks, color: 0x6a5240 });
  const dark = lambert("h_stairdark", { map: tex().planks, color: 0x3a2a1e });
  const flags = lambert("h_hallflags", { map: tex().slate, color: 0x8a847a });
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: THREE.Material, tile = 1) =>
    b.box(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, m, { tile });
  // the corridor from the street door: its floor, walls, ceiling (under the room when the room is upstairs)
  const corTop = plan.room.y > SILL ? plan.room.y - 0.12 : SILL + 2.9;
  box(cor.minX, cor.maxX, SILL - 0.1, SILL, cor.minZ, cor.maxZ, flags, 1.2);
  box(cor.minX, cor.maxX, corTop, corTop + 0.1, cor.minZ, cor.maxZ, boards, 1.2);
  wallFace(g, [cor.minX, cor.maxZ], [cor.minX, cor.minZ], SILL, corTop, [1, 0], [], plaster2, 2.4);
  wallFace(g, [cor.maxX, cor.minZ], [cor.maxX, cor.maxZ], SILL, corTop, [-1, 0], [], plaster2, 2.4);
  wallFace(g, [cor.minX, cor.minZ], [cor.maxX, cor.minZ], SILL, corTop, [0, 1], [{ s0: -plan.door.w / 2 - cor.minX, s1: plan.door.w / 2 - cor.minX, y0: -1, y1: plan.door.yt }], plaster2, 2.4);
  // the well's walls, from its floor to its ceiling: in front the corridor's way in and the room's door
  const y0 = well.y0 - 0.1;
  const y1 = well.y1;
  const front: FaceHole[] = [
    { s0: cor.minX - wr.minX, s1: cor.maxX - wr.minX, y0: SILL - 0.1, y1: Math.min(corTop, SILL + 2.4) },
    { s0: rf.x - ROOM_DOOR / 2 - wr.minX, s1: rf.x + ROOM_DOOR / 2 - wr.minX, y0: rf.y - 0.05, y1: rf.y + 2.1 },
  ];
  wallFace(g, [wr.minX, wr.minZ], [wr.maxX, wr.minZ], y0, y1, [0, 1], front, plaster2, 2.4);
  wallFace(g, [wr.maxX, wr.maxZ], [wr.minX, wr.maxZ], y0, y1, [0, -1], [], plaster2, 2.4);
  wallFace(g, [wr.minX, wr.maxZ], [wr.minX, wr.minZ], y0, y1, [1, 0], [], plaster2, 2.4);
  wallFace(g, [wr.maxX, wr.minZ], [wr.maxX, wr.maxZ], y0, y1, [-1, 0], [], plaster2, 2.4);
  box(wr.minX, wr.maxX, y1, y1 + 0.1, wr.minZ, wr.maxZ, boards, 1.2);
  // the landings and the floor at the well's foot
  box(wr.minX, wr.maxX, well.y0 - 0.1, well.y0, wr.minZ, wr.maxZ, well.y0 < 0 ? flags : boards, 1.2);
  for (const l of plan.landings.slice(1)) if (l.y > well.y0 + 0.01) box(l.rect.minX, l.rect.maxX, l.y - 0.15, l.y, l.rect.minZ, l.rect.maxZ, boards, 1.2);
  // the flights: thick treads, a soffit under, a rail on the lanes' middle line
  const mid = (Math.min(...plan.flights.map((f) => f.rect.maxX)) + Math.max(...plan.flights.map((f) => f.rect.minX))) / 2;
  for (const f of plan.flights) {
    const n = f.steps;
    for (let i = 0; i < n; i++) {
      const za = f.foot + ((f.head - f.foot) * i) / n;
      const zb = f.foot + ((f.head - f.foot) * (i + 1)) / n;
      const top = f.y0 + ((f.y1 - f.y0) * (i + 1)) / n;
      box(f.rect.minX, f.rect.maxX, top - 0.3, top, Math.min(za, zb), Math.max(za, zb), boards, 0.6);
    }
    const run = Math.abs(f.head - f.foot);
    const sof = new THREE.Mesh(new THREE.PlaneGeometry(f.rect.maxX - f.rect.minX, Math.hypot(run, f.y1 - f.y0)), dark);
    sof.position.set((f.rect.minX + f.rect.maxX) / 2, (f.y0 + f.y1) / 2 - 0.3, (f.foot + f.head) / 2);
    sof.rotation.x = Math.PI / 2 - Math.sign(f.head - f.foot) * Math.atan2(f.y1 - f.y0, run);
    (sof.material as THREE.Material).side = THREE.DoubleSide;
    g.add(sof);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, Math.hypot(run, f.y1 - f.y0)), dark);
    rail.position.set(mid, (f.y0 + f.y1) / 2 + 0.95, (f.foot + f.head) / 2);
    rail.rotation.x = -Math.sign(f.head - f.foot) * Math.atan2(f.y1 - f.y0, run);
    g.add(rail);
  }
  void D;
}

/**
 * A flat convex face (a fan of triangles) facing the point `toward` (house frame), textured in metres along its
 * first edge and across it.
 */
function flatFace(g: THREE.Group, pts: Array<[number, number, number]>, toward: [number, number, number], m: THREE.Material, tile: number): void {
  const v = pts.map((p) => new THREE.Vector3(...p));
  const n = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0]));
  if (n.lengthSq() < 1e-10) return;
  if (n.dot(new THREE.Vector3(...toward).sub(v[0])) < 0) v.reverse();
  const e1 = new THREE.Vector3().subVectors(v[1], v[0]).normalize();
  const e2 = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0])).cross(e1).normalize();
  const pos: number[] = [];
  const uv: number[] = [];
  for (let i = 1; i + 1 < v.length; i++)
    for (const p of [v[0], v[i], v[i + 1]]) {
      pos.push(p.x, p.y, p.z);
      const d = new THREE.Vector3().subVectors(p, v[0]);
      uv.push(d.dot(e1) / tile, d.dot(e2) / tile);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, m));
}

/**
 * Issue #10: a garret under the house's own front slope, in the house's frame (shared/housePlan.ts: the plan's roof and
 * dormer, tools/blender/build_city.py dormer_new). The ceiling follows the roof UNDER_ROOF under it from the knee
 * wall at the front up to the room's height, then runs flat to the back wall; the side walls follow it. Where the
 * dormer stands, the slope is open into the dormer's bay: its front wall at the back of the dormer window's reveal
 * (the room's own reveal, houseInWorld.ts, runs from the dormer's front to there), cut at the window, its cheeks and
 * its flat ceiling a little inside the dormer's. Nothing of the room stands out of the roof or in front of the
 * dormer: from the street the room shows only through the dormer's window.
 */
function garretUnderRoof(b: Builder, plan: HousePlan, W: number, D: number, H: number, L: Look): void {
  const g = b.group;
  const rf = plan.roomFrame!;
  const roof = plan.roof!;
  const dm = plan.dormer!;
  const F = rf.y;
  const xa = rf.x - W / 2;
  const xb = rf.x + W / 2;
  const z0 = rf.z;
  const z1 = rf.z + D;
  const top = F + H;
  const ceil = (z: number) => roof.eave + roof.k * z - UNDER_ROOF;
  const zOf = (y: number) => (y + UNDER_ROOF - roof.eave) / roof.k;
  const zc = Math.min(z1, zOf(top));
  // the dormer's bay: a little inside its cheeks and under its eaves; its front at the back of the window's reveal
  const aw = dm.w / 2 - 0.04;
  const ax0 = dm.x - aw;
  const ax1 = dm.x + aw;
  const zA = dm.inset + dm.win.R;
  const ya = Math.min(dm.ye - 0.08, top);
  const zm = Math.min(zc, zOf(ya));
  const hw = dm.win.w / 2;
  const mid: [number, number, number] = [rf.x, F + 1.2, (z0 + z1) / 2];
  // the floor
  b.box(W, 0.1, D, rf.x, F - 0.05, (z0 + z1) / 2, L.floor, { tile: 1.4 });
  // the knee wall at the front, as high as the slope leaves it
  if (ceil(z0) > F + 0.01) flatFace(g, [[xa, F, z0], [xb, F, z0], [xb, ceil(z0), z0], [xa, ceil(z0), z0]], mid, L.wall, L.tile);
  // the sloping ceiling: open where the dormer's bay rises out of it
  const slope = (x0: number, x1: number, za: number, zb: number) => {
    if (x1 - x0 > 1e-3 && zb - za > 1e-3) flatFace(g, [[x0, ceil(za), za], [x1, ceil(za), za], [x1, ceil(zb), zb], [x0, ceil(zb), zb]], [(x0 + x1) / 2, F, (za + zb) / 2], L.ceil, 1.2);
  };
  slope(xa, ax0, z0, zc);
  slope(ax1, xb, z0, zc);
  slope(ax0, ax1, z0, zA);
  slope(ax0, ax1, zm, zc);
  // the flat ceiling to the back wall
  if (z1 - zc > 1e-3) flatFace(g, [[xa, top, zc], [xb, top, zc], [xb, top, z1], [xa, top, z1]], [rf.x, F, (zc + z1) / 2], L.ceil, 1.2);
  // the side walls, their tops along the slope and the flat ceiling
  for (const [x, s] of [[xa, 1], [xb, -1]] as const) {
    const to: [number, number, number] = [x + s, F + 1, (z0 + z1) / 2];
    flatFace(g, [[x, F, z0], [x, F, zc], [x, top, zc], [x, ceil(z0), z0]], to, L.wall, L.tile);
    if (z1 - zc > 1e-3) flatFace(g, [[x, F, zc], [x, F, z1], [x, top, z1], [x, top, zc]], to, L.wall, L.tile);
  }
  // the back wall, with the doorway onto the landing
  wallFace(g, [xb, z1], [xa, z1], F, top, [0, -1], [{ s0: W / 2 - ROOM_DOOR / 2, s1: W / 2 + ROOM_DOOR / 2, y0: F - 1, y1: F + 2.1 }], L.wall, L.tile);
  // the dormer's bay: its front wall cut at the window (the window's reveal ends here), its cheeks, its ceiling
  if (zm > zA + 1e-3) {
    wallFace(g, [ax0, zA], [ax1, zA], ceil(zA), ya, [0, 1], [{ s0: dm.x - hw - ax0, s1: dm.x + hw - ax0, y0: dm.win.y0, y1: dm.win.y1 }], L.wall, L.tile);
    for (const [x, s] of [[ax0, 1], [ax1, -1]] as const) flatFace(g, [[x, ceil(zA), zA], [x, ya, zA], [x, ya, zm]], [x + s, ya - 0.3, (zA + zm) / 2], L.wall, L.tile);
    flatFace(g, [[ax0, ya, zA], [ax1, ya, zA], [ax1, ya, zm], [ax0, ya, zm]], [dm.x, F, (zA + zm) / 2], L.ceil, 1.2);
    // a board for a sill inside the window
    b.box(2 * hw + 0.08, 0.05, 0.14, dm.x, dm.win.y0 - 0.025, zA + 0.07, L.beam);
  }
  // rafters under the slope, clear of the dormer's bay, and the collar beam where the slope meets the flat ceiling
  const run = zc - z0;
  const len = Math.hypot(run, ceil(zc) - ceil(z0));
  const ang = Math.atan2(ceil(zc) - ceil(z0), run);
  for (let x = xa + 0.35; x < xb - 0.2; x += 0.85) {
    if (x > ax0 - 0.12 && x < ax1 + 0.12) continue;
    const r = b.box(0.08, 0.1, len, x, (ceil(z0) + ceil(zc)) / 2 - 0.06, (z0 + zc) / 2, L.beam);
    r.rotation.x = -ang;
  }
  b.box(W - 0.02, 0.12, 0.12, rf.x, top - 0.06, zc + 0.06, L.beam, { tile: 1.2 });
}

/** A dark red damask paper with a gold figure, for the merchant's walls. */
function damask(): THREE.CanvasTexture {
  return canvasTex(32, 32, (g) => {
    g.fillStyle = "#5a2420";
    g.fillRect(0, 0, 32, 32);
    g.fillStyle = "rgba(190,150,80,0.45)";
    for (const [cx, cy] of [[8, 8], [24, 24]]) {
      g.beginPath();
      g.moveTo(cx, cy - 6);
      g.quadraticCurveTo(cx + 5, cy, cx, cy + 6);
      g.quadraticCurveTo(cx - 5, cy, cx, cy - 6);
      g.fill();
      g.fillRect(cx - 1, cy - 8, 2, 16);
    }
    g.fillStyle = "rgba(0,0,0,0.12)";
    g.fillRect(0, 0, 32, 3);
  });
}

/** The painted frieze under the ceiling: a band of scrolls on cream. */
function frieze(): THREE.CanvasTexture {
  return canvasTex(64, 16, (g) => {
    g.fillStyle = "#d8ccb0";
    g.fillRect(0, 0, 64, 16);
    g.fillStyle = "#8a6a2a";
    g.fillRect(0, 0, 64, 2);
    g.fillRect(0, 14, 64, 2);
    g.strokeStyle = "#5a6a4a";
    g.lineWidth = 1.5;
    for (let x = 0; x < 64; x += 16) {
      g.beginPath();
      g.arc(x + 8, 8, 4, Math.PI * 0.2, Math.PI * 1.8);
      g.stroke();
      g.fillStyle = "#9a3a2a";
      g.fillRect(x + 7, 7, 2, 2);
    }
  });
}

/** A Turkey carpet: a red field, a blue border, gold lozenges. */
function turkey(): THREE.CanvasTexture {
  return canvasTex(64, 48, (g) => {
    g.fillStyle = "#6a1c18";
    g.fillRect(0, 0, 64, 48);
    g.fillStyle = "#1e2a44";
    g.fillRect(4, 4, 56, 40);
    g.fillStyle = "#7a2a1e";
    g.fillRect(8, 8, 48, 32);
    g.fillStyle = "#c8a050";
    for (const [x, y] of [[32, 24], [18, 16], [46, 16], [18, 32], [46, 32]]) {
      g.beginPath();
      g.moveTo(x, y - 6);
      g.lineTo(x + 6, y);
      g.lineTo(x, y + 6);
      g.lineTo(x - 6, y);
      g.fill();
    }
    g.fillStyle = "#1e2a44";
    g.fillRect(31, 23, 2, 2);
    g.fillStyle = "#d8c8a0";
    for (let x = 0; x < 64; x += 4) {
      g.fillRect(x, 1, 2, 2);
      g.fillRect(x, 45, 2, 2);
    }
  }, false);
}

/** A small oil painting of a ship on the Schelde. */
function seascape(seed: number): THREE.CanvasTexture {
  const r = rand(seed);
  return canvasTex(32, 24, (g) => {
    const sky = g.createLinearGradient(0, 0, 0, 16);
    sky.addColorStop(0, "#6a7a8a");
    sky.addColorStop(1, "#c8b890");
    g.fillStyle = sky;
    g.fillRect(0, 0, 32, 24);
    g.fillStyle = "#3a4a4a";
    g.fillRect(0, 16, 32, 8);
    g.fillStyle = "#2a2018";
    const x = 8 + r() * 14;
    g.fillRect(x, 5, 1, 12);
    g.fillStyle = "#e0d8c0";
    g.beginPath();
    g.moveTo(x + 1, 6);
    g.lineTo(x + 7, 14);
    g.lineTo(x + 1, 14);
    g.fill();
    g.fillStyle = "#1a1410";
    g.fillRect(x - 4, 16, 14, 2);
  }, false);
}

/**
 * The merchant's floor dressed as a well-off man's rooms: a painted frieze under the
 * ceiling, a gilt dado rail, a Turkey carpet, heavy drapes with a pelmet at the tall
 * windows, two seascapes in gilt frames. Looks only: the grid, the fixed furniture and the
 * numbers are shared/homes.ts.
 */
function merchantDress(b: Builder, W: number, D: number, H: number, win: Array<{ x0: number; x1: number }>, wy0: number, wy1: number): void {
  const fr = mat("h_frieze", () => psx(new THREE.MeshLambertMaterial({ map: frieze() }), { affine: 0 }));
  const gilt = lambert("f_gilt", { color: 0xb08a3a });
  const band = 0.34;
  const y = H - band / 2 - 0.08;
  b.box(W - 0.02, band, 0.02, 0, y, D - 0.02, fr, { tile: 1.3 });
  for (const s of [-1, 1]) b.box(0.02, band, D - 0.02, s * (W / 2 - 0.02), y, D / 2, fr, { tile: 1.3 });
  b.box(W - 0.02, band, 0.02, 0, y, 0.02, fr, { tile: 1.3 });
  // the dado rail over the panelling
  b.box(W, 0.05, 0.06, 0, 0.92, D - 0.04, gilt);
  for (const s of [-1, 1]) b.box(0.06, 0.05, D, s * (W / 2 - 0.04), 0.92, D / 2, gilt);
  // the carpet under the table
  b.box(3.0, 0.01, 2.3, 0, 0.005, 3.0, mat("h_turkey", () => psx(new THREE.MeshLambertMaterial({ map: turkey() }), { affine: 0 })));
  // the drapes: two heavy panels either side of each window, a pelmet above, a gilt sill
  const drape = mat("h_drape", () => {
    const t = canvasTex(16, 32, (g) => {
      g.fillStyle = "#5a1614";
      g.fillRect(0, 0, 16, 32);
      for (let x = 0; x < 16; x += 4) {
        g.fillStyle = "rgba(0,0,0,0.3)";
        g.fillRect(x, 0, 1, 32);
        g.fillStyle = "rgba(255,200,160,0.1)";
        g.fillRect(x + 2, 0, 1, 32);
      }
      g.fillStyle = "#b08a3a";
      g.fillRect(0, 29, 16, 2);
    });
    return psx(new THREE.MeshLambertMaterial({ map: t }), { affine: 0.2 });
  });
  for (const w of win) {
    const top = Math.min(H - 0.45, wy1 + 0.25);
    for (const side of [w.x0 - 0.12, w.x1 + 0.12]) b.box(0.36, top - 0.02, 0.08, side, top / 2, 0.08, drape);
    b.box(w.x1 - w.x0 + 0.7, 0.26, 0.12, (w.x0 + w.x1) / 2, top + 0.1, 0.07, drape);
    b.box(w.x1 - w.x0 + 0.1, 0.04, 0.3, (w.x0 + w.x1) / 2, wy0 - 0.02, 0.1, gilt);
  }
  // two seascapes in gilt frames on the left wall
  [1.3, 2.45].forEach((z, i) => {
    b.box(0.05, 0.62, 0.8, -W / 2 + 0.03, 1.75, z, gilt);
    b.plane(0.7, 0.52, -W / 2 + 0.06, 1.75, z, Math.PI / 2, mat(`h_sea${i}`, () => psx(new THREE.MeshLambertMaterial({ map: seascape(17 + i * 31) }), { affine: 0 })));
  });
}
