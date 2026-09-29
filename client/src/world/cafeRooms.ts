import * as THREE from "three";
import { psx } from "../retro/psx";
import type { HousePlan } from "../../../shared/housePlan";
import { createFires, type Fires } from "./fire";
import { signTexture } from "./textures";
import { ambientOf, Builder, flicker, frameRoom, holesOn, lambert, mat, mergeStatic, plaster, rand, rectsOf, tex, wallFace, type Room, type Seat, type Spot } from "./rooms";
import { cornice } from "./shopRooms";
import { boardTex, checkerTex, clockFaceTex, flatTex, Kit, M, mirrorTex, paintingTex, paintMat, picMat, posterTex } from "./interiorKit";

// M7 shops (docs/milestones/M7-shops.md): the five taverns made over from Codex concept paintings of 1873
// Antwerp cafes (scratch only; the textures that entered the repo are in assets/ATTRIBUTION.md). The same house
// plan and the same life as before (rooms.ts buildTavern: the counter along the side wall nearer the door, the
// keeper behind it, seats and stands, the fire, the stools; game/interiors.ts runs the people); four styles:
//  - "sailors": a sailors' tavern by the docks: low heavy beams, limewash gone grey, a plank counter with the
//    barrels on their rack behind, jenever and stone jugs, a ship model, a sea chart, a lifebuoy and coils of
//    rope, long tables with benches, a brick hearth with a fire, lanterns on chains, sand on the boards;
//  - "brown": a brown cafe: dark oak wainscot, smoke-brown plaster, a panelled bar with a zinc top and brass
//    beer pumps, a big gilt mirror and shelves of bottles behind, a cast-iron stove, small square tables with
//    bentwood chairs, red and black tiles with sawdust, beer posters, globe gas lamps, a clock, a slate;
//  - "coffee": a coffee house: cream walls over a wainscot, a copper coffee urn and a glass case of cakes on
//    the counter, marble tables on iron feet with bentwood chairs, papers on sticks in a rack, ship paintings,
//    a billiard table under a green lamp at the back, patterned cement tiles;
//  - "grand": the better cafe on the market: red damask wallpaper, tall gilt mirrors, a mahogany bar with a
//    brass rail and pumps, marble tables, a red plush banquette, an upright piano, concert posters,
//    patterned tiles, gas chandeliers.

export type CafeStyle = "sailors" | "brown" | "coffee" | "grand";

/** Which tavern is which (by place). */
export const CAFE_STYLE: Record<string, CafeStyle> = {
  "tavern:ankere": "sailors",
  "tavern:schipke": "sailors",
  "tavern:vliet": "brown",
  "tavern:engel": "grand",
  "tavern:bassin": "coffee",
  "tavern:linde": "brown",
  "tavern:zwarte_kat": "sailors",
};

const face = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);

export function buildCafe(opts: { plan: HousePlan; label: string; seed: number; style: CafeStyle }): Room {
  const p = opts.plan;
  const style = opts.style;
  const I = p.room.rect;
  const F = p.room.y;
  const H = style === "sailors" ? 2.9 : style === "grand" ? 3.5 : 3.25;
  const fogC = style === "sailors" ? 0x1a130d : style === "brown" ? 0x1c140c : style === "coffee" ? 0x201a14 : 0x1e1410;
  const { scene, group, toWorld, toLocal } = frameRoom(p.origin, p.yaw, fogC);
  scene.background = null;
  const stat = new THREE.Group();
  group.add(stat);
  const b = new Builder(stat);
  const k = new Kit(b);
  const r = rand(opts.seed);
  const { minX: x0, maxX: x1, minZ: z0, maxZ: z1 } = I;
  const ns = x1 < -x0 ? 1 : -1;
  const nearW = ns > 0 ? x1 : x0;
  const farW = ns > 0 ? x0 : x1;
  const X = (d: number) => nearW - ns * d;
  const XF = (d: number) => farW + ns * d;
  const ryNear = ns > 0 ? -Math.PI / 2 : Math.PI / 2; // a picture on the near wall faces into the room
  const ryFar = -ryNear;
  const box = (xa: number, xb: number, y: number, h: number, za: number, zb: number, m: THREE.Material, solid = false, tile = 1) => k.bx(xa, xb, y, h, za, zb, m, solid, tile);
  const nearHoles = holesOn(p, ns > 0 ? "maxX" : "minX", 0, false).map((h) => [h.s0, h.s1] as [number, number]);
  const farHoles = holesOn(p, ns > 0 ? "minX" : "maxX", 0, false).map((h) => [h.s0, h.s1] as [number, number]);
  const clear = (holes: Array<[number, number]>, z: number, m = 0.5) => !holes.some(([a, c]) => z > a - m && z < c + m);

  // ---------------------------------------------------------------- materials by style
  const floor =
    style === "sailors"
      ? paintMat("cf_sandboards", () => tex().planks, 0x9a8466, 0.005, 0.3)
      : style === "brown"
        ? picMat("cf_checker", "/textures/cafe_tiles_checker.jpg", () => checkerTex("#7a2a1e", "#1e1a18", 6, 3, 200), 0xd0c8c0, 0.004, 0.1)
        : picMat("cf_encaustic", "/textures/cafe_tiles_encaustic.jpg", () => checkerTex("#8a6a50", "#c8bca0", 8, 4, 0), 0xd8d0c8, 0.003, 0.1);
  const floorTile = style === "sailors" ? 1.4 : style === "brown" ? 1.8 : 0.9;
  const wallM =
    style === "sailors"
      ? mat(`cf_lime_${opts.seed}`, () => psx(new THREE.MeshLambertMaterial({ map: plaster(opts.seed, [168 + r() * 16, 164 + r() * 12, 150]) }), { affine: 0.3 }))
      : style === "brown"
        ? mat("cf_brownplaster", () => psx(new THREE.MeshLambertMaterial({ map: plaster(611, [150, 120, 84]) }), { affine: 0.3 }))
        : style === "coffee"
          ? mat("cf_cream", () => psx(new THREE.MeshLambertMaterial({ map: plaster(612, [206, 192, 160]) }), { affine: 0.3 }))
          : picMat("cf_damask", "/textures/cafe_wallpaper_red.jpg", () => flatTex("#5a1a18"), 0xc8b8b0, 0, 0.05);
  const wallTile = style === "grand" ? 1.4 : H + 0.2;
  const wainscot = picMat("cf_wainscot", "/textures/cafe_wainscot.jpg", () => flatTex("#2a1a10"), style === "coffee" ? 0xc8a888 : 0xb89880, 0, 0.05);
  const beam = lambert("cf_beam", { map: tex().planks, color: style === "sailors" ? 0x3a2a1c : 0x4a3626 });
  const ceilM = style === "grand" || style === "coffee" ? M.paint(style === "grand" ? 0xb8a888 : 0xa89878) : M.darkOak();

  // ---------------------------------------------------------------- floor, ceiling, walls, dado, beams
  box(x0, x1, F - 0.1, 0.1, z0, z1, floor, false, floorTile);
  box(x0, x1, F + H, 0.1, z0, z1, ceilM, false, 1.6);
  wallFace(stat, [x0, z0], [x1, z0], F, F + H, [0, 1], holesOn(p, "front", x0, true), wallM, wallTile);
  wallFace(stat, [x0, z1], [x0, z0], F, F + H, [1, 0], holesOn(p, "minX", z1, false).map((h) => ({ ...h, s0: -h.s1, s1: -h.s0 })), wallM, wallTile);
  wallFace(stat, [x1, z0], [x1, z1], F, F + H, [-1, 0], holesOn(p, "maxX", z0, false), wallM, wallTile);
  wallFace(stat, [x1, z1], [x0, z1], F, F + H, [0, -1], [], wallM, wallTile);
  if (style !== "sailors") {
    // the wainscot (a Codex picture): three panels a tile, up to 1.25 m, a rail on it
    const dh = style === "grand" ? 1.0 : 1.25;
    const inset = 0.02;
    const dt = dh * 2; // one picture (2:1) per 2 x dh metres
    wallFace(stat, [x0 + inset, z1 - inset], [x0 + inset, z0 + inset], F, F + dh, [1, 0], holesOn(p, "minX", z1, false).map((h) => ({ ...h, s0: -h.s1, s1: -h.s0 })), wainscot, dt);
    wallFace(stat, [x1 - inset, z0 + inset], [x1 - inset, z1 - inset], F, F + dh, [-1, 0], holesOn(p, "maxX", z0, false), wainscot, dt);
    wallFace(stat, [x1, z1 - inset], [x0, z1 - inset], F, F + dh, [0, -1], [], wainscot, dt);
    wallFace(stat, [x0, z0 + inset], [x1, z0 + inset], F, F + Math.min(dh, 0.64), [0, 1], holesOn(p, "front", x0, true), wainscot, dt);
    for (const [xa, xb, za, zb] of [[x0, x0 + 0.05, z0, z1], [x1 - 0.05, x1, z0, z1], [x0, x1, z1 - 0.05, z1]] as Array<[number, number, number, number]>) box(xa, xb, F + dh, 0.05, za, zb, M.darkOak());
  }
  // a straight cornice where every wall meets the ceiling (the plaster rooms paint it, the better rooms below)
  if (style === "sailors" || style === "brown") cornice(k, x0, x1, z0, z1, F + H, style === "sailors" ? beam : M.darkOak());
  if (style === "sailors") {
    // heavy dark beams across, close together, and joists
    for (let z = z0 + 0.9; z < z1 - 0.3; z += 1.1) box(x0, x1, F + H - 0.26, 0.26, z - 0.13, z + 0.13, beam, false, 1.2);
  } else if (style === "brown") {
    for (let z = z0 + 1.2; z < z1 - 0.3; z += 1.6) box(x0, x1, F + H - 0.2, 0.2, z - 0.1, z + 0.1, beam, false, 1.2);
  } else {
    // a plaster cornice and a rosette over each lamp (the better rooms)
    const corn = M.paint(0xd8ccb0);
    for (const [xa, xb, za, zb] of [[x0, x0 + 0.12, z0, z1], [x1 - 0.12, x1, z0, z1], [x0, x1, z1 - 0.12, z1], [x0, x1, z0, z0 + 0.12]] as Array<[number, number, number, number]>) box(xa, xb, F + H - 0.14, 0.14, za, zb, corn);
  }

  // ---------------------------------------------------------------- the bar along the near wall
  const zc0 = z0 + 2.1;
  const zc1 = Math.max(zc0 + 2.6, Math.min(zc0 + 3.8, z1 - 2.8));
  const zcm = (zc0 + zc1) / 2;
  const barBody = style === "sailors" ? M.pine() : style === "grand" ? M.mahogany() : M.darkOak();
  const barTop = style === "sailors" ? M.oak() : style === "brown" ? M.zinc() : style === "coffee" ? M.marble() : M.mahogany();
  box(X(1.35), X(0.75), F, 1.02, zc0, zc1, barBody, true, 0.9);
  box(X(1.45), X(0.65), F + 1.02, 0.06, zc0 - 0.1, zc1 + 0.1, barTop, false, 0.9);
  box(X(0.75), nearW, F, 1.02, zc0, zc0 + 0.08, barBody, true);
  if (style !== "sailors") {
    // raised panels on the bar's front, a brass foot rail
    for (let z = zc0 + 0.15; z < zc1 - 0.5; z += 0.72) box(X(1.37), X(1.35) - ns * 0.02, F + 0.2, 0.6, z + 0.06, z + 0.62, style === "grand" ? M.oak() : M.mahogany());
    box(X(1.6), X(1.56), F + 0.18, 0.04, zc0, zc1, M.brass());
  } else for (let z = zc0 + 0.3; z < zc1; z += 0.35) box(X(1.37), X(1.35) - ns * 0.01, F + 0.05, 0.95, z, z + 0.02, M.darkOak());
  const jefOnly = [{ minX: Math.min(X(0.75), nearW), maxX: Math.max(X(0.75), nearW), minZ: zc0 - 0.1, maxZ: zc1 + 0.9 }];

  // behind the bar: shelves of bottles, and (the brown and the grand) a gilt mirror; the sailors' barrels on a rack
  const shelfRuns: Array<[number, number]> = [];
  {
    let s = zc0 - 0.1;
    for (const [a, c] of [...nearHoles].sort((q, w) => q[0] - w[0])) {
      if (c < s || a > zc1 + 0.1) continue;
      if (a - 0.15 > s + 0.5) shelfRuns.push([s, a - 0.15]);
      s = Math.max(s, c + 0.15);
    }
    if (zc1 + 0.1 > s + 0.5) shelfRuns.push([s, zc1 + 0.1]);
  }
  for (const [a, c] of shelfRuns) {
    const ys = style === "sailors" ? [1.25, 1.7] : [1.15, 1.55, 2.0];
    for (const y of ys) {
      box(X(0.3), X(0.01), F + y - 0.03, 0.03, a, c, M.darkOak());
      k.shelfRow([X(0.14), F + y, a + 0.05], [X(0.14), F + y, c - 0.05], 0.3, style === "coffee" && y > 1.5 ? "jars" : "bottles", Math.floor(y * 10), ryNear);
    }
    if (style === "brown" || style === "grand") {
      const mh = style === "grand" ? 1.3 : 0.9;
      k.wallPic(X(0.02), F + 2.2 + mh / 2 - 0.35, (a + c) / 2, Math.min(2.2, c - a - 0.3), mh, ryNear, mat("cf_mirror", () => new THREE.MeshBasicMaterial({ map: mirrorTex(9) })), lambert("cf_gilt", { color: 0xa88838 }, 0));
    }
  }
  // the sign with the house's name on the bar's wall (or the front wall if there is no room)
  const signM = new THREE.MeshBasicMaterial({ map: signTexture(opts.label.toUpperCase()), color: 0xb0a080 });
  const longest = [...shelfRuns].sort((q, w) => w[1] - w[0] - (q[1] - q[0]))[0];
  if (style === "sailors" && longest && longest[1] - longest[0] > 2.0) b.plane(Math.min(2.6, longest[1] - longest[0] - 0.2), 0.33, X(0.02), F + 2.25, (longest[0] + longest[1]) / 2, ryNear, signM);
  else b.plane(1.8, 0.28, 0, F + H - 0.35, z0 + 0.02, 0, signM);

  // on the bar: beer pumps (brass columns, black handles), glasses; the coffee house: the copper urn and the cake case
  const glassM = lambert("cf_glass", { color: 0xb8c4b8 }, 0);
  if (style === "brown" || style === "grand") {
    for (let i = 0; i < 3; i++) {
      const z = zc0 + 0.5 + i * 0.35;
      b.cyl(0.035, 0.34, X(1.15), F + 1.25, z, M.brass(), false, 6);
      b.cyl(0.05, 0.05, X(1.15), F + 1.44, z, M.brass(), false, 6);
      const h = b.cyl(0.018, 0.26, X(1.15), F + 1.58, z, M.iron(), false, 4);
      h.rotation.x = -0.25;
    }
    for (let i = 0; i < 6; i++) b.cyl(0.035, 0.12, X(0.95), F + 1.14, zc1 - 0.25 - i * 0.12, glassM, false, 6);
  } else if (style === "coffee") {
    b.cyl(0.18, 0.6, X(1.05), F + 1.38, zc0 + 0.55, M.copper(), false, 10);
    b.cyl(0.1, 0.15, X(1.05), F + 1.75, zc0 + 0.55, M.copper(), false, 8);
    b.cyl(0.03, 0.05, X(1.05), F + 1.86, zc0 + 0.55, M.brass(), false, 6);
    box(X(1.3), X(0.8), F + 1.08, 0.36, zc1 - 1.0, zc1 - 0.2, M.glass());
    for (let i = 0; i < 4; i++) b.cyl(0.1, 0.07, X(1.05), F + 1.15 + (i % 2) * 0.18, zc1 - 0.85 + Math.floor(i / 2) * 0.4, lambert(`cf_cake_${i}`, { color: [0x8a5a2a, 0xd8c8a0, 0x6a3a1a, 0xc0903a][i] }, 0), false, 10);
    for (let i = 0; i < 5; i++) b.cyl(0.04, 0.06, X(1.2), F + 1.11, zcm - 0.3 + i * 0.13, M.white(), false, 6);
  } else {
    // stone jenever jugs and pewter pots on the plank counter
    for (let i = 0; i < 3; i++) b.cyl(0.07, 0.24, X(1.05), F + 1.2, zc0 + 0.4 + i * 0.3, lambert("cf_jug", { color: 0x9a8a70 }, 0), false, 7);
    for (let i = 0; i < 4; i++) b.cyl(0.045, 0.13, X(1.2), F + 1.14, zc1 - 0.3 - i * 0.18, M.zinc(), false, 6);
  }

  // barrels: the sailors' rack in the back corner, a barrel or two by the bar's end in the others
  if (style === "sailors") {
    box(X(1.3), nearW, F, 0.3, z1 - 1.9, z1, M.darkOak(), true);
    for (const z of [z1 - 1.5, z1 - 0.75]) b.barrel(X(0.65), F + 0.62, z, true, false);
    b.barrel(X(0.65), F + 1.22, z1 - 1.12, true, false);
  } else if (style === "brown") {
    b.barrel(X(0.5), F + 0.4, zc1 + 0.55, false, true);
  }

  // ---------------------------------------------------------------- the fire: the sailors' hearth, a stove in the others
  let fires: Fires | null = null;
  let firePt: THREE.Vector3;
  let fireSpot: Spot;
  let fireLight: THREE.PointLight;
  if (style === "sailors") {
    const brick = lambert("brick", { map: tex().brick, color: 0xb08a78 });
    const fx = THREE.MathUtils.clamp((XF(0) + X(1.3)) / 2, Math.min(XF(1.1), X(2.4)), Math.max(XF(1.1), X(2.4)));
    for (const sgn of [-1, 1]) b.box(0.5, 0.95, 0.7, fx + sgn * 0.8, F + 0.475, z1 - 0.35, brick, { tile: 0.8 });
    b.box(2.1, 0.3, 0.7, fx, F + 1.1, z1 - 0.35, brick, { tile: 0.8 });
    b.plane(1.1, 0.95, fx, F + 0.475, z1 - 0.04, Math.PI, M.glow(0x0c0806));
    b.box(2.4, 0.1, 0.85, fx, F + 1.3, z1 - 0.4, M.darkOak());
    b.box(1.5, H - 1.35, 0.5, fx, F + 1.35 + (H - 1.35) / 2, z1 - 0.25, brick, { tile: 0.8 });
    b.boxes.push({ minX: fx - 1.05, maxX: fx + 1.05, minZ: z1 - 0.75, maxZ: z1 });
    // pots on the mantel, a kettle on a hook
    for (let i = 0; i < 3; i++) b.cyl(0.06, 0.16, fx - 0.7 + i * 0.7, F + 1.43, z1 - 0.4, lambert("cf_pewter", { color: 0x7a7a74 }, 0), false, 6);
    b.cyl(0.12, 0.16, fx + 0.25, F + 0.55, z1 - 0.45, M.iron(), false, 8);
    const fw = toWorld(fx, z1 - 0.45, F + 0.12);
    fires = createFires(scene, [{ x: fw.x, y: fw.y, z: fw.z, size: 0.55 }]);
    fireLight = new THREE.PointLight(0xff8a40, 9, 8, 1.4);
    fireLight.position.set(fx, F + 0.8, z1 - 1.0);
    firePt = toWorld(fx, z1 - 0.6, F + 0.6);
    fireSpot = { x: fx, z: z1 - 1.3, yaw: 0 };
  } else {
    // the stove: toward the back, off the far wall, in the aisle's line (not where the billiards stand)
    const sx = style === "coffee" ? XF(0.6) : (X(2.2) + XF(1.5)) / 2;
    const sz = style === "coffee" ? z0 + 2.2 : z1 - (style === "grand" ? 3.2 : 1.4);
    const door = k.stove(sx, sz, F, F + H);
    fireLight = new THREE.PointLight(0xff8a40, 4, 5, 1.5);
    fireLight.position.copy(door);
    firePt = toWorld(door.x, door.z, door.y);
    fireSpot = { x: sx, z: sz + (sz < zcm ? 0.9 : -0.9), yaw: 0 };
    fireSpot.yaw = face(fireSpot.x, fireSpot.z, sx, sz);
  }
  group.add(fireLight);

  // ---------------------------------------------------------------- seats: tables with benches or chairs
  const seats: Seat[] = [];
  const XA = (XF(2.2) + X(1.8)) / 2; // the aisle between the tables and the bar
  let tid = 0;
  const chairSeat = (cx: number, cz: number, tx: number, tz: number, via: Array<[number, number]>, seatM?: THREE.Material) => {
    const yaw = face(cx, cz, tx, tz);
    k.chair(cx, cz, F, yaw, seatM);
    seats.push({ x: cx, z: cz, yaw, table: tid, h: 0.47, via });
  };
  // how far back the tables may go (the hearth, the billiards, the piano)
  const billiards = style === "coffee" && (x1 - x0) > 4.9;
  const tablesEnd = style === "sailors" ? z1 - 1.5 : billiards ? z1 - 3.9 : style === "grand" ? z1 - 1.4 : z1 - 0.8;
  if (style === "sailors") {
    const tx = XF(1.25);
    for (let z = z0 + 1.45; z + 0.85 < tablesEnd; z += 3.0) {
      const [tw, td] = [0.8, 1.6];
      b.box(tw, 0.07, td, tx, F + 0.76, z, M.oak(), { tile: 0.8 });
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(0.09, 0.74, 0.09, tx + dx * (tw / 2 - 0.1), F + 0.37, z + dz * (td / 2 - 0.1), M.darkOak());
      b.boxes.push({ minX: tx - tw / 2, maxX: tx + tw / 2, minZ: z - td / 2, maxZ: z + td / 2 });
      for (const sgn of [-1, 1]) {
        const bx = tx + sgn * 0.72;
        b.box(0.3, 0.06, 1.7, bx, F + 0.45, z, M.oak(), { tile: 0.8 });
        b.box(0.25, 0.43, 0.07, bx, F + 0.215, z - 0.7, M.darkOak());
        b.box(0.25, 0.43, 0.07, bx, F + 0.215, z + 0.7, M.darkOak());
        for (const o of [-0.42, 0.42]) {
          const zEnd = z + Math.sign(o) * 1.25 < z0 + 0.6 ? z + 1.25 : z + Math.sign(o) * 1.25;
          seats.push({ x: bx, z: z + o, yaw: Math.atan2(tx - bx, 0), table: tid, h: 0.47, via: [[XA, zEnd], [bx, zEnd]] });
        }
      }
      // a candle in a bottle and a pewter pot on the table
      k.bottle(tx, F + 0.795, z - 0.3, 0x2a3a2a, 0.22);
      b.cyl(0.04, 0.12, tx, F + 0.855, z + 0.35, M.zinc(), false, 6);
      tid++;
    }
  } else {
    // small tables along the far wall, two chairs each (on the aisle side and toward the front); the grand
    // has a red banquette on the far wall instead of the wall-side chairs
    const round = style !== "brown";
    const tx = XF(style === "grand" ? 0.95 : 0.85);
    const plush = style === "grand" ? lambert("cf_plush", { color: 0x6a1a1a }, 0.1) : undefined;
    if (style === "grand") {
      // the banquette: seat, back, buttons of shadow
      box(XF(0), XF(0.5), F, 0.45, z0 + 0.6, tablesEnd, plush!, true);
      box(XF(0), XF(0.14), F + 0.45, 0.6, z0 + 0.6, tablesEnd, plush!);
    }
    for (let z = z0 + 1.2; z + 0.4 < tablesEnd; z += 1.55) {
      if (round) k.roundTable(tx, z, F, 0.34, M.marble());
      else k.squareTable(tx, z, F, 0.7, 0.7, M.oak());
      // the aisle-side chair, facing the table
      const ax = tx - ns * 0.62;
      chairSeat(ax, z, tx, z, [[XA, z]], plush);
      if (style === "grand") {
        // on the banquette, facing the table
        const bx = XF(0.3);
        seats.push({ x: bx, z, yaw: face(bx, z, tx, z), table: tid, h: 0.47, via: [[XA, z + 0.62], [tx, z + 0.62], [bx + ns * 0.2, z]] });
      } else {
        // a chair on the front side of the table
        const cz = z - 0.6;
        chairSeat(tx, cz, tx, z, [[XA, cz], [tx - ns * 0.5, cz]]);
      }
      // what is on the table: a glass, a cup, a paper
      if (style === "coffee") {
        b.cyl(0.05, 0.06, tx + 0.1 * ns, F + 0.79, z, M.white(), false, 6);
        box(tx - 0.15, tx + 0.05, F + 0.765, 0.005, z - 0.2, z + 0.05, lambert("cf_paper", { color: 0xd8d0b8 }, 0));
      } else b.cyl(0.035, 0.12, tx, F + 0.82, z + 0.1, glassM, false, 6);
      tid++;
    }
    // the middle row (a wide room): a table in the aisle's far half, chairs either side
    if (x1 - x0 > 6.2 && style === "brown") {
      const mx = (X(2.6) + XF(1.8)) / 2;
      for (let z = z0 + 3.2; z + 0.6 < tablesEnd; z += 2.4) {
        k.squareTable(mx, z, F, 0.7, 0.7, M.oak());
        chairSeat(mx, z - 0.6, mx, z, [[mx, z - 1.1]]);
        chairSeat(mx, z + 0.6, mx, z, [[mx, z + 1.1]]);
        tid++;
      }
    }
  }
  // stools at the bar (table 9)
  const stoolZ = zc1 - zc0 > 3.2 ? [zc0 + 0.6, zcm, zc1 - 0.6] : [zc0 + 0.6, zc1 - 0.6];
  for (const z of stoolZ) {
    b.cyl(0.18, 0.05, X(1.8), F + 0.66, z, style === "sailors" ? M.oak() : M.darkOak(), false, 8);
    b.cyl(0.03, 0.64, X(1.8), F + 0.32, z, M.darkOak(), false, 4);
    seats.push({ x: X(1.8), z, yaw: Math.atan2(ns, 0), table: 9, h: 0.68, via: [[XA, z]] });
  }

  // ---------------------------------------------------------------- what makes each room its own
  const stands: Spot[] = [
    { x: X(1.85), z: zc0 + 1.1, yaw: face(X(1.85), 0, nearW, 0) },
    { x: X(1.85), z: zc1 - 1.1, yaw: face(X(1.85), 0, nearW, 0) },
    { x: XA, z: z0 + 1.0, yaw: face(XA, z0 + 1.0, XF(0.5), z1) },
    { x: XA + ns * 0.3, z: zcm + 0.5, yaw: face(0, 0, ns, 0) },
    { x: fireSpot.x + ns * 0.4, z: fireSpot.z, yaw: fireSpot.yaw },
    { x: XA - ns * 0.3, z: Math.min(z1 - 2.0, zc1 + 1.2), yaw: face(0, 0, -ns, 0) },
    { x: XA, z: zc1 + 0.6, yaw: face(XA, zc1 + 0.6, X(1), zcm) },
    { x: X(1.9), z: zc0 - 0.5, yaw: face(0, 0, 0, 1) },
  ];
  const farPic = (z: number, y: number, w: number, h: number, m: THREE.Material, frame?: THREE.Material) => {
    if (clear(farHoles, z, w / 2 + 0.1)) k.wallPic(XF(0.02), F + y, z, w, h, ryFar, m, frame);
  };
  const lights: THREE.PointLight[] = [];
  const glows: THREE.Sprite[] = [];
  const top = F + H;
  if (style === "sailors") {
    // the ship model on a shelf over the tables, the sea chart, the lifebuoy, rope, a net; lanterns on chains
    const sz = z0 + 2.6;
    if (clear(farHoles, sz, 0.8)) {
      box(XF(0), XF(0.28), F + 1.78, 0.04, sz - 0.6, sz + 0.6, M.darkOak());
      const hull = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.95), lambert("cf_hull", { color: 0x2a1c14 }, 0));
      hull.position.set(XF(0.14), F + 1.9, sz);
      b.group.add(hull);
      for (const [dz, h] of [[-0.25, 0.6], [0.05, 0.75], [0.33, 0.55]]) {
        b.cyl(0.008, h, XF(0.14), F + 1.97 + h / 2, sz + dz, M.darkOak(), false, 3);
        b.box(0.01, h * 0.55, 0.28, XF(0.14), F + 2.05 + h * 0.4, sz + dz, lambert("cf_sail", { color: 0xd8ccb0, side: THREE.DoubleSide }, 0));
      }
    }
    farPic(z0 + 4.4, 1.7, 1.1, 0.75, picMat("cf_chart", "/textures/cafe_sea_chart.jpg", () => flatTex("#b8a070"), 0xffffff, 0, 0), M.darkOak());
    const buoyZ = z0 + 5.8;
    if (clear(farHoles, buoyZ, 0.5)) {
      const buoy = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.07, 6, 12), lambert("cf_buoy", { color: 0xd8d0c0 }, 0));
      buoy.position.set(XF(0.08), F + 1.75, buoyZ);
      buoy.rotation.y = Math.PI / 2;
      b.group.add(buoy);
      for (let i = 0; i < 4; i++) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.16), lambert("cf_buoyred", { color: 0xa02a1a }, 0));
        const a = (i / 4) * Math.PI * 2;
        band.position.set(XF(0.08), F + 1.75 + Math.sin(a) * 0.26, buoyZ + Math.cos(a) * 0.26);
        band.rotation.x = -a;
        b.group.add(band);
      }
    }
    const rope = lambert("cf_rope", { map: tex().rope, color: 0xb09a70 });
    for (const z of [z0 + 0.8, z1 - 2.2]) {
      if (!clear(farHoles, z, 0.4)) continue;
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.06, 5, 10), rope);
      coil.position.set(XF(0.08), F + 1.55, z);
      coil.rotation.y = Math.PI / 2;
      b.group.add(coil);
    }
    const coilFloor = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.09, 5, 10), rope);
    coilFloor.rotation.x = Math.PI / 2;
    coilFloor.position.set(X(1.7), F + 0.09, z1 - 2.4);
    b.group.add(coilFloor);
    b.boxes.push({ minX: X(1.7) - 0.4, maxX: X(1.7) + 0.4, minZ: z1 - 2.8, maxZ: z1 - 2.0 });
    k.lamp(XA, F + 2.15, z0 + (z1 - z0) * 0.3, top, "lantern", lights, glows, 7);
    k.lamp(XA, F + 2.15, z0 + (z1 - z0) * 0.68, top, "lantern", lights, glows, 7);
    // vogelpik on the far wall at the back
    const vz = z1 - 1.0;
    if (clear(farHoles, vz)) {
      k.wallPic(XF(0.02), F + 1.65, vz, 0.5, 0.5, ryFar, mat("vogelpik_cf", () => psx(new THREE.MeshLambertMaterial({ map: vogelpikTex() }), { affine: 0 })));
      box(XF(2.3), XF(2.34), F, 0.01, vz - 0.6, vz + 0.6, M.glow(0x6a665c));
    }
  } else if (style === "brown") {
    farPic(z0 + 2.0, 1.95, 0.55, 0.82, M.basic("cf_poster_beer", () => posterTex(["BRASSERIE", "BIERES FINES", "DE BELGIQUE"], "#e0d0a0", "#5a1a12", "glass", 11)));
    farPic(z0 + 3.7, 1.95, 0.55, 0.82, M.basic("cf_poster_lion", () => posterTex(["BIERE", "DE GAND", "PURE ET NATURELLE"], "#e8dcc0", "#8a1a12", "lion", 12)));
    farPic(z0 + 5.4, 1.9, 0.5, 0.38, M.basic("cf_saint", () => paintingTex("saint", 3)), lambert("cf_gilt", { color: 0xa88838 }, 0));
    // the slate with the day's beers, a clock over the bar's end, coat pegs by the door
    k.wallPic(XF(0.02), F + 1.55, z1 - 0.9, 0.5, 0.65, ryFar, M.basic("cf_slate", () => boardTex(["TODAY", "BRUIN 5", "JENEVER 10", "SOEP 8"], "#1e2220", "#d8d4c8", 128, 160, "'Scheldemist Print', Georgia, serif")));
    k.clock(X(0.02), F + 2.75, zc1 + 0.5, 0.3, ryNear, M.basic("cf_clock", () => clockFaceTex(3)), "cafe clock over the bar", M.darkOak());
    for (let i = 0; i < 4; i++) b.box(0.03, 0.03, 0.12, XF(0.06), F + 1.75, z0 + 0.5 + i * 0.25, M.brass());
    k.lamp(XA, F + H - 0.8, z0 + (z1 - z0) * 0.3, top, "globe", lights, glows, 7);
    k.lamp(XA, F + H - 0.8, z0 + (z1 - z0) * 0.7, top, "globe", lights, glows, 7);
  } else if (style === "coffee") {
    farPic(z0 + 1.9, 2.1, 0.95, 0.8, picMat("cf_ship", "/textures/cafe_ship_painting.jpg", () => paintingTex("ship", 4), 0xffffff, 0, 0), lambert("cf_gilt", { color: 0xa88838 }, 0));
    farPic(z0 + 4.1, 2.1, 0.7, 0.9, mat("cf_mirror", () => new THREE.MeshBasicMaterial({ map: mirrorTex(9) })), lambert("cf_gilt", { color: 0xa88838 }, 0));
    // the papers on their sticks in a rack
    const rz = Math.min(z1 - 4.2, z0 + 5.8);
    if (clear(farHoles, rz, 0.5)) {
      box(XF(0), XF(0.08), F + 1.9, 0.08, rz - 0.45, rz + 0.45, M.darkOak());
      for (let i = 0; i < 4; i++) {
        b.cyl(0.012, 0.36, XF(0.1), F + 1.72, rz - 0.33 + i * 0.22, M.darkOak(), false, 4);
        box(XF(0.09), XF(0.11), F + 1.25, 0.46, rz - 0.4 + i * 0.22, rz - 0.26 + i * 0.22, lambert("cf_paper", { color: 0xd8d0b8 }, 0));
      }
    }
    k.lamp(XA, F + H - 0.8, z0 + (z1 - z0) * 0.25, top, "globe", lights, glows, 7);
    k.lamp(XA, F + H - 0.8, z0 + (z1 - z0) * 0.5, top, "globe", lights, glows, 6);
  } else {
    // the grand: tall gilt mirrors between posters on the far wall over the banquette, chandeliers
    farPic(z0 + 1.6, 2.35, 0.8, 1.5, mat("cf_mirror", () => new THREE.MeshBasicMaterial({ map: mirrorTex(9) })), lambert("cf_gilt", { color: 0xa88838 }, 0));
    farPic(z0 + 3.1, 2.25, 0.62, 0.95, M.basic("cf_poster_concert", () => posterTex(["GRAND CONCERT", "AU PARC", "HARMONIE", "D'ANVERS", "EVERY THURSDAY"], "#e8dcc0", "#3a1a2a", "lyre", 13)));
    farPic(z0 + 4.6, 2.35, 0.8, 1.5, mat("cf_mirror", () => new THREE.MeshBasicMaterial({ map: mirrorTex(9) })), lambert("cf_gilt", { color: 0xa88838 }, 0));
    farPic(z0 + 6.1, 2.25, 0.62, 0.95, M.basic("cf_poster_theatre", () => posterTex(["THEATRE ROYAL", "LA FILLE DE", "MADAME ANGOT", "OPERA BOUFFE"], "#d8c8a0", "#1a2a4a", "none", 14)));
    // chandeliers: a brass stem, three globes, one light each
    for (const zf of [0.25, 0.55]) {
      const cz = z0 + (z1 - z0) * zf;
      k.lamp(XA, F + H - 0.95, cz, top, "globe", lights, glows, 8);
      for (const [dx, dz] of [[0.3, 0], [-0.15, 0.26], [-0.15, -0.26]]) {
        b.cyl(0.01, 0.3, XA + dx / 2, F + H - 0.9, cz + dz / 2, M.brass(), false, 3).rotation.z = dx * 1.5;
        const g = new THREE.Mesh(new THREE.SphereGeometry(0.09, 7, 5), M.glow(0xffc47a)); // amber, as interiorKit's globe
        g.position.set(XA + dx, F + H - 0.78, cz + dz);
        b.group.add(g);
      }
    }
  }

  // the billiard table (the coffee house) under its green lamp, the cues on the wall
  if (billiards) {
    const bz = z1 - 2.0;
    const bxc = (X(1.9) + XF(0.4)) / 2 + ns * 0.1;
    const cloth = lambert("cf_baize", { color: 0x1e5a32 }, 0.05);
    const wood = M.mahogany();
    box(bxc - 0.72, bxc + 0.72, F + 0.72, 0.06, bz - 1.3, bz + 1.3, cloth, false);
    for (const [xa, xb, za, zb] of [[bxc - 0.82, bxc - 0.72, bz - 1.4, bz + 1.4], [bxc + 0.72, bxc + 0.82, bz - 1.4, bz + 1.4], [bxc - 0.82, bxc + 0.82, bz - 1.4, bz - 1.3], [bxc - 0.82, bxc + 0.82, bz + 1.3, bz + 1.4]] as Array<[number, number, number, number]>) box(xa, xb, F + 0.68, 0.14, za, zb, wood);
    box(bxc - 0.75, bxc + 0.75, F + 0.5, 0.2, bz - 1.33, bz + 1.33, wood, true);
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.cyl(0.07, 0.5, bxc + dx * 0.6, F + 0.25, bz + dz * 1.15, wood, false, 6);
    const ballM = [M.white(), lambert("cf_ball_red", { color: 0xa01a12 }, 0), lambert("cf_ball_yel", { color: 0xd8b840 }, 0)];
    [[0.2, -0.6], [-0.3, 0.2], [0.1, 0.7]].forEach(([dx, dz], i) => {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), ballM[i]);
      s.position.set(bxc + dx, F + 0.81, bz + dz);
      b.group.add(s);
    });
    k.lamp(bxc, F + 1.75, bz, top, "green", lights, glows, 6);
    if (clear(farHoles, bz, 0.5)) for (let i = 0; i < 4; i++) b.cyl(0.012, 1.4, XF(0.05), F + 1.1, bz - 0.3 + i * 0.12, M.darkOak(), false, 4);
    stands.push({ x: bxc - ns * 1.05, z: bz - 0.4, yaw: face(bxc - ns * 1.05, bz - 0.4, bxc, bz) }, { x: bxc + ns * 0.2, z: bz + 1.75, yaw: face(0, bz + 1.75, 0, bz) });
  }
  // the piano (the grand): an upright against the back wall, its stool, a candle holder
  if (style === "grand") {
    const px = (X(2.0) + XF(0.8)) / 2;
    const pz = z1 - 0.4;
    box(px - 0.75, px + 0.75, F, 1.3, pz - 0.3, pz + 0.3, M.mahogany(), true);
    box(px - 0.72, px + 0.72, F + 0.72, 0.05, pz - 0.55, pz - 0.3, M.mahogany());
    box(px - 0.66, px + 0.66, F + 0.765, 0.015, pz - 0.54, pz - 0.36, M.white());
    for (let i = 0; i < 18; i++) box(px - 0.62 + i * 0.072, px - 0.6 + i * 0.072, F + 0.78, 0.012, pz - 0.44, pz - 0.36, M.iron());
    box(px - 0.3, px + 0.3, F + 1.0, 0.25, pz - 0.33, pz - 0.31, lambert("cf_music", { color: 0xe0d8c0 }, 0));
    b.cyl(0.18, 0.06, px, F + 0.5, pz - 0.95, M.darkOak(), true, 8);
    b.cyl(0.03, 0.47, px, F + 0.24, pz - 0.95, M.darkOak(), false, 4);
    for (const sgn of [-1, 1]) {
      b.cyl(0.012, 0.12, px + sgn * 0.55, F + 1.36, pz - 0.2, M.brass(), false, 4);
      b.cyl(0.02, 0.1, px + sgn * 0.55, F + 1.46, pz - 0.2, M.white(), false, 5);
    }
    // someone may sit at it (the stool faces the keys)
    seats.push({ x: px, z: pz - 0.95, yaw: 0, table: 8, h: 0.52, via: [[px, pz - 1.6]] });
    stands.push({ x: px + 0.9, z: pz - 1.0, yaw: face(px + 0.9, pz - 1.0, px, pz) });
  }

  const hemi = new THREE.HemisphereLight(style === "sailors" ? 0x7a5a44 : 0x8a6a50, 0x241810, style === "grand" ? 1.6 : 1.4);
  const amb = new THREE.AmbientLight(0x4a3624, 0.75);
  scene.add(hemi, amb);
  const solids = rectsOf(b.boxes);
  mergeStatic(stat, group);
  let litK = 1;
  const lampPts = lights.map((l) => ({ l, p: new THREE.Vector3() }));
  const fireBase = fireLight.intensity;
  const room: Room = {
    kind: "tavern",
    scene,
    group,
    walk: (fx0, fz0) => [fx0, fz0],
    seats,
    stands,
    keeper: { x: X(0.4), z: zcm, yaw: face(0, 0, -ns, 0) },
    counter: { x: X(1.85), z: zcm, yaw: face(0, 0, ns, 0) },
    fire: fireSpot,
    exit: { x: 0, z: z0 + 0.3, yaw: Math.PI },
    entry: { x: 0, z: z0 + 0.8, yaw: 0 },
    lamps: [],
    toWorld,
    toLocal,
    floor: () => F,
    solids,
    level: 0,
    jefOnly,
    setAmbient: ambientOf(hemi, amb),
    setLamps(v) {
      litK = v;
    },
    setDaylight() {},
    update(t) {
      fires?.update(t);
      lights.forEach((l, i) => {
        const f = flicker(t, i * 5.1) * litK;
        l.intensity = (style === "sailors" ? 7 : 6.5) * f;
        glows[i].material.opacity = (style === "sailors" ? 0.7 : 0.5) * f;
      });
      const ff = flicker(t * 1.7, 9) * (0.85 + Math.sin(t * 11) * 0.08) * (0.15 + 0.85 * litK);
      fireLight.intensity = fireBase * ff;
      room.lamps = [...lampPts.map(({ l, p: v }, i) => ({ p: l.getWorldPosition(v), w: 0.42 * flicker(t, i * 5.1) * litK })), { p: firePt, w: (style === "sailors" ? 0.55 : 0.25) * ff }];
    },
  };
  room.update(0, 0);
  return room;
}

/** The vogelpik board (Flemish darts). */
function vogelpikTex(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#2a2018";
  g.fillRect(0, 0, 64, 64);
  ["#e0d6c0", "#1a1a1a", "#b0302a", "#e0d6c0", "#1a1a1a", "#b0302a"].forEach((col, i) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(32, 32, 28 - i * 4.5, 0, Math.PI * 2);
    g.fill();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}
