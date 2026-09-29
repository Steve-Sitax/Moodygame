import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import * as HP from "../../../shared/hallPlan";
import type { Rect } from "../../../shared/hallPlan";
import type { HousePlan, HouseWindow } from "../../../shared/housePlan";
import { LINING_UNDER_ROOF, REVEAL } from "../../../shared/housePlan";
import { boxGeo, lambert, mergeStatic, tex, type Room } from "./rooms";
import type { World } from "./rijnkaai";
import type { InWorld, InWorldRoom, Opening } from "./inworld";
import { addSpill, type SpillKind, type SpillSource } from "./spill";
import { lampFog } from "./lampFog";

// The taverns, the Poesje and the homes in the world (M7, docs/milestones/M7-taverns-homes-inworld.md): the
// halls' way (world/hallInWorld.ts) for a city house. The room (world/rooms.ts, homeRooms.ts) is built from the
// house's plan (shared/housePlan.ts) at the house's own place; tools/blender/build_city.py leaves its door
// without a leaf and cuts its windows' painted glass out. Here:
//  - walking by the plan (World.addWalkArea: the room's floor, its furniture as solids, storeys by the feet);
//  - the door's leaf and transom, hung in the street's scene (and the same in the room's), open or shut;
//  - the panes in the room's scene (drawn after the street, so the room shows through them and the street
//    through them from inside), a little tinted and a little reflective by day;
//  - a "punch" for each opening, first in the room's pass seen from outside: it sets the depth behind the opening
//    to the far plane where the street drew something behind the facade (the paving runs under the houses, the
//    lining), never over what stands before it (issue #29: PUNCH_MARK and PUNCH, below), so that never hides the
//    room; the room draws the reveals, the sill, the leaf and the transom again itself;
//  - a dark lining just inside the house's faces (street scene): what an open door or a window shows when
//    the room itself is not drawn (too far, over the budget, a mirror's picture);
//  - warm panes at night over painted windows of a room upstairs (a garret with no dormer to stand behind; issue #10:
//    the garret's window is its dormer's, a hole whose face stands back from the wall line);
//  - the lit room's light on the street through its windows and its open door (world/spill.ts), as bright as the
//    kind of room (a shop, a taproom, a home's candle); the lining glows with it when the room itself is not drawn;
//  - the InWorldRoom (world/inworld.ts): the door and every window an opening; the air blends at the threshold.

export interface HouseAir {
  color: number;
  near: number;
  far: number;
}

export interface HouseInWorld {
  id: string;
  plan: HousePlan;
  room: Room;
  /** Open or shut (the leaf turns to it). */
  doorOpen: boolean;
  /** How far the leaf stands open now (0 shut .. 1). */
  readonly leaf: number;
  /** 0 on the street .. 1 inside (world point). */
  insideness(x: number, z: number): number;
  /** Metres from the door's step (world), or 0 inside. */
  near(x: number, z: number): number;
  /** World <-> the house's frame. */
  local(x: number, z: number): [number, number];
  world(x: number, z: number): [number, number];
  /** The floor under feet (world y) at a world point; the storey index there. */
  floor(x: number, z: number, feet: number): number;
  level(x: number, z: number, feet: number): number;
  /** Is a body free there (world; the feet pick the storey)? */
  free(x: number, z: number, feet: number, r?: number): boolean;
  /** Was the room drawn in the last frame (from outside or inside)? */
  drawn(): boolean;
  /** Warm light at night from the room (0 .. 1): the transom and the glow panes; set by the room's owner. */
  glow: number;
  update(t: number, dt: number, day: number): void;
}

// The punch (issue #29). Before, one material wrote gl_FragDepth = 1.0 with the depth test on: the test compares the
// written depth, so it passed only where the depth was already far, i.e. nowhere it was needed. With the test off (or
// ALWAYS) alone it would clear the depth over a passer-by, a lamp post or a shutter in front of the window too, and the
// room would be drawn over them. So two draws of the same quads, one shader program (uFar picks the depth written):
//  - PUNCH_MARK: the quad at its own depth, the normal test, no colour, no depth: stencil bit 4 set where the facade's
//    plane is in view, i.e. where what the street drew there lies behind the facade (the lining, the paving, a floor);
//  - PUNCH: depth ALWAYS, only where bit 4 is set: the depth there set to the far plane, the bit cleared again.
// Bits 1 and 2 of the stencil are the boats' and the dock water's (world/boats.ts); the write masks keep them.
export const PUNCH_BIT = 4;
const PUNCH_VERT = "void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";
const PUNCH_FRAG = "uniform float uFar; uniform vec4 uShow; void main() { gl_FragDepth = uFar > 0.5 ? 1.0 : gl_FragCoord.z; gl_FragColor = uShow; }";
export const PUNCH_MARK = new THREE.ShaderMaterial({
  name: "house_punch_mark",
  uniforms: { uFar: { value: 0 }, uShow: { value: new THREE.Vector4(0, 0, 0, 0) } },
  vertexShader: PUNCH_VERT,
  fragmentShader: PUNCH_FRAG,
  colorWrite: false,
  depthWrite: false,
  depthTest: true,
  side: THREE.DoubleSide,
  stencilWrite: true,
  stencilRef: PUNCH_BIT,
  stencilWriteMask: PUNCH_BIT,
  stencilFuncMask: PUNCH_BIT,
  stencilFunc: THREE.AlwaysStencilFunc,
  stencilZPass: THREE.ReplaceStencilOp,
});
export const PUNCH = new THREE.ShaderMaterial({
  name: "house_punch",
  // (uShow: the dev check colours what the punch clears, dev/punchcheck.ts; never in play)
  uniforms: { uFar: { value: 1 }, uShow: { value: new THREE.Vector4(0, 0, 0, 0) } },
  vertexShader: PUNCH_VERT,
  fragmentShader: PUNCH_FRAG,
  colorWrite: false,
  depthWrite: true,
  depthTest: true,
  depthFunc: THREE.AlwaysDepth,
  side: THREE.DoubleSide,
  stencilWrite: true,
  stencilRef: PUNCH_BIT,
  stencilWriteMask: PUNCH_BIT,
  stencilFuncMask: PUNCH_BIT,
  stencilFunc: THREE.EqualStencilFunc,
  stencilZPass: THREE.ZeroStencilOp,
});

/** A window's frame in local terms: along it (unit), its start, the outward normal. */
function winFrame(w: HouseWindow): { ax: number; az: number; tx: number; tz: number; len: number; ox: number; oz: number } {
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  return { ax: w.a[0], az: w.a[1], tx: (w.b[0] - w.a[0]) / len, tz: (w.b[1] - w.a[1]) / len, len, ox: w.out[0], oz: w.out[1] };
}

/** A quad from four local points (y up), into a list. */
function quad(list: THREE.BufferGeometry[], p: Array<[number, number, number]>, uvScale = 1): void {
  const g = new THREE.BufferGeometry();
  const pos = [p[0], p[1], p[2], p[0], p[2], p[3]].flat();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const L = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]) / uvScale;
  const H = Math.hypot(p[3][0] - p[0][0], p[3][1] - p[0][1], p[3][2] - p[0][2]) / uvScale;
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, L, 0, L, H, 0, 0, L, H, 0, H], 2));
  g.computeVertexNormals();
  list.push(g);
}

/**
 * A quad facing a point (issue #10: the reveals of a window or a door face into the opening, whichever way its wall
 * runs; before, a hole cut along -x had its room-side reveals facing into the wall, culled, so from the street the
 * room showed past the reveal where it turned).
 */
function quadToward(list: THREE.BufferGeometry[], p: Array<[number, number, number]>, toward: [number, number, number]): void {
  const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
  const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const v = [toward[0] - p[0][0], toward[1] - p[0][1], toward[2] - p[0][2]];
  quad(list, n[0] * v[0] + n[1] * v[1] + n[2] * v[2] >= 0 ? p : [p[3], p[2], p[1], p[0]]);
}

/**
 * A flat face [u0, u1] x [y0, y1] with rectangular holes ([ua, ub, ya, yb] each) left open, as quads into a list;
 * `pt(u, y)` gives the local point of face coordinates u (along) and y (up).
 */
function holedFace(list: THREE.BufferGeometry[], u0: number, u1: number, y0: number, y1: number, holes: Array<[number, number, number, number]>, pt: (u: number, y: number) => [number, number, number]): void {
  const us = [u0, u1, ...holes.flatMap((h) => [h[0], h[1]])].filter((u) => u >= u0 && u <= u1).sort((a, b) => a - b);
  for (let i = 0; i + 1 < us.length; i++) {
    const a = us[i];
    const b = us[i + 1];
    if (b - a < 1e-3) continue;
    const m = (a + b) / 2;
    const gaps = holes.filter((h) => h[0] < m && h[1] > m).map((h) => [h[2], h[3]] as [number, number]).sort((p, q) => p[0] - q[0]);
    let y = y0;
    for (const [c0, c1] of gaps) {
      if (c0 > y) quad(list, [pt(a, y), pt(b, y), pt(b, Math.min(c0, y1)), pt(a, Math.min(c0, y1))]);
      y = Math.max(y, c1);
    }
    if (y1 > y) quad(list, [pt(a, y), pt(b, y), pt(b, y1), pt(a, y1)]);
  }
}

/** The door's leaf with its panels, knob and straps, hinged at the group's origin, reaching toward `dir` (+1/-1 along x). */
function makeLeaf(w: number, h: number, dir: number): THREE.Group {
  const oak = lambert("house_leaf", { map: tex().planks, color: 0x5a4030 }, 0);
  const panelM = lambert("house_leaf_panel", { map: tex().planks, color: 0x463222 }, 0);
  const iron = lambert("house_leaf_iron", { color: 0x2a2622 }, 0);
  const g = new THREE.Group();
  const leaf = new THREE.Mesh(boxGeo(w - 0.02, h, 0.06, 1.2), oak);
  leaf.position.set(dir * (w / 2), h / 2, 0);
  g.add(leaf);
  for (const y of [h * 0.28, h * 0.7])
    for (const s of [-1, 1]) {
      // raised panels 4 cm proud of the leaf (their back inside it): no thin layer on its faces (dev/zfight.ts)
      const p = new THREE.Mesh(new THREE.BoxGeometry(w - 0.3, h * 0.3, 0.05), panelM);
      p.position.set(dir * (w / 2), y, s * 0.045);
      g.add(p);
    }
  const knob = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.12), lambert("house_knob", { color: 0x8a6a2a }, 0));
  knob.position.set(dir * (w - 0.12), 0.87, 0);
  g.add(knob);
  for (const y of [0.25, h - 0.25]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.13), iron);
    strap.position.set(dir * 0.15, y, 0);
    g.add(strap);
  }
  // one mesh per material: a leaf is a few draws, not a dozen
  const parts = new THREE.Group();
  for (const c of [...g.children]) parts.add(c);
  g.add(parts);
  mergeStatic(parts, g);
  return g;
}

export function createHouseInWorld(world: World, inWorld: InWorld, plan: HousePlan, room: Room, air: HouseAir, scatter = 0.4): HouseInWorld {
  const AIR = { color: new THREE.Color(air.color), near: air.near, far: air.far };
  const local = (x: number, z: number) => HP.toLocal(plan, x, z);
  const toW = (x: number, z: number) => HP.toWorld(plan, x, z);
  const d = plan.doors[0];
  const dp = plan.door;
  let open = 0;
  let want = false;
  let dayNow = 1;
  const isOpen = () => open > 0.08;

  // ---- walking: the porch, the doorway, the room and its stairs by the plan; the room's furniture as solids
  // the room's own array: a home's pieces change it as Jef puts them up (world/homeRooms.ts)
  if (room.solids) plan.levels[room.level ?? 0].solids = room.solids;
  if (room.jefOnly?.length) plan.jefOnly = [...(plan.jefOnly ?? []), ...room.jefOnly];
  const lf = (feet?: number) => (feet === undefined ? 0 : feet - plan.floorY);
  world.addWalkArea({
    box: HP.worldBox(plan),
    has: (x, z) => HP.answers(plan, ...local(x, z)),
    walkable: (x, z, feet) => HP.walkable(plan, ...local(x, z), lf(feet), isOpen),
    floor: (x, z, feet) => plan.floorY + HP.floorAt(plan, ...local(x, z), lf(feet)),
    hits: (x, z, r, feet) => HP.hits(plan, ...local(x, z), r, lf(feet), true),
    wood: plan.kind !== "cellar",
  });

  const inFrame = (g: THREE.Object3D) => {
    g.position.set(plan.origin.x, plan.floorY, plan.origin.z);
    g.rotation.y = plan.yaw;
    return g;
  };
  // ---- the street's side: the leaf, the transom, the lining, the glow panes (the house's frame)
  const street = inFrame(new THREE.Group());
  street.name = `house_${plan.id}`;
  world.scene.add(street);
  // ---- the room's side of the same: the leaf and transom again, the reveals, the sill, the panes, the punches
  const inHouse = inFrame(new THREE.Group());
  inHouse.name = `house_${plan.id}_in`;
  room.scene.add(inHouse);

  // hinged on the side toward the nearer side wall, turning into the house
  const hingeX = d.hw * (plan.room.rect.minX + plan.room.rect.maxX > 0 ? -1 : 1);
  const dir = -Math.sign(hingeX);
  const leafH = dp.yd - dp.hs;
  const hinges = [street, inHouse].map((parent) => {
    const g = makeLeaf(2 * d.hw, leafH, dir);
    g.position.set(hingeX, dp.hs, REVEAL - 0.04);
    parent.add(g);
    return g;
  });
  // the transom over the leaf: glass behind a glazing bar (warm from inside at night)
  const transomMat = new THREE.MeshBasicMaterial({ color: 0x1c2228 });
  const oak = lambert("house_leaf", { map: tex().planks, color: 0x5a4030 }, 0);
  for (const parent0 of [street, inHouse]) {
    const parent = new THREE.Group();
    parent0.add(parent);
    const t = new THREE.Mesh(new THREE.PlaneGeometry(2 * d.hw, dp.yt - dp.yd), transomMat);
    t.position.set(0, (dp.yd + dp.yt) / 2, REVEAL - 0.03);
    const t2 = t.clone();
    t2.rotation.y = Math.PI;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2 * d.hw, 0.06, 0.08), oak);
    bar.position.set(0, dp.yd + 0.03, REVEAL - 0.03);
    const mull = new THREE.Mesh(new THREE.BoxGeometry(0.04, dp.yt - dp.yd, 0.05), oak);
    mull.position.copy(t.position);
    parent.add(t, t2, bar, mull);
    mergeStatic(parent, parent);
  }

  // the lining: dark faces just inside the house's side, back, floor and top faces, open at the front (warm when the
  // room is lit at night: a window whose room is not drawn still glows as its light spills, world/spill.ts)
  const LINING = new THREE.Color(0x0e0b08);
  const LINING_LIT = new THREE.Color(0x8a5428);
  const liningMat = new THREE.MeshBasicMaterial({ color: LINING, side: THREE.DoubleSide });
  // night fog (2026-09-26): far off it fogs with the lamps' glow in the air, as the walls round it (world/lampFog.ts)
  lampFog(liningMat, 1);
  {
    const f = plan.frame;
    const x0 = f.x0 + 0.1;
    const x1 = f.x1 - 0.1;
    const z1 = f.depth - 0.1;
    const top = Math.max(3.6, plan.room.y + 3.4, plan.well ? plan.well.y1 : 0);
    const bot = 0.08;
    const geos: THREE.BufferGeometry[] = [];
    // East walkthrough 2026-09-25: the side and back faces are left open where a cut window is (a corner
    // tavern's side windows: Het Bassin, In de Ankere). The lining stood 0.1 m inside them, so from the street
    // the lit room showed as grey slats (the lining fighting the pane) and from inside the street was not seen.
    const cut = (onFace: (w: HouseWindow) => boolean, u: (p: [number, number]) => number): Array<[number, number, number, number]> =>
      plan.windows
        .filter((w) => w.kind === "hole" && onFace(w))
        .map((w) => [Math.min(u(w.a), u(w.b)) - 0.02, Math.max(u(w.a), u(w.b)) + 0.02, w.y0 - 0.02, w.y1 + 0.02]);
    const side = (w: HouseWindow) => Math.abs(w.out[0]) > 0.7;
    const nearX0 = (w: HouseWindow) => Math.abs(w.a[0] - f.x0) < Math.abs(w.a[0] - f.x1);
    const roof = plan.roof;
    if (roof) {
      // issue #10, the garret under a side roof: the lining stays just under the roof's two slopes (flat at `top`
      // between them), over the garret's ceiling; its box stood 3.4 m over the garret's floor, out of the front slope,
      // a dark slab over the roof. Where the dormer stands it rises into the dormer (a little inside its cheeks and
      // under its eaves), round the room's bay there: from inside, the dormer's window is never behind the lining.
      const m = LINING_UNDER_ROOF;
      const yTop = (z: number) => Math.min(top, roof.eave + roof.k * Math.min(z, f.depth - z) - m);
      const zf = (top + m - roof.eave) / roof.k;
      const dm = plan.dormer;
      const bump = dm ? { a: dm.x - dm.w / 2 + 0.02, b: dm.x + dm.w / 2 - 0.02, z0: dm.inset, y: dm.ye - 0.03, z1: (dm.ye - 0.03 + m - roof.eave) / roof.k } : null;
      const zs = [0.1, zf, f.depth - zf, z1, ...(bump ? [bump.z0, bump.z1] : [])].filter((z) => z >= 0.1 && z <= z1).sort((p, q) => p - q);
      const top3 = (xa: number, xb: number, za: number, zb: number) => quad(geos, [[xa, yTop(za), za], [xa, yTop(zb), zb], [xb, yTop(zb), zb], [xb, yTop(za), za]]);
      for (let i = 0; i + 1 < zs.length; i++) {
        const [za, zb] = [zs[i], zs[i + 1]];
        if (zb - za < 1e-3) continue;
        quad(geos, [[x0, bot, za], [x0, bot, zb], [x0, yTop(zb), zb], [x0, yTop(za), za]]);
        quad(geos, [[x1, bot, zb], [x1, bot, za], [x1, yTop(za), za], [x1, yTop(zb), zb]]);
        if (bump && za >= bump.z0 - 1e-6 && zb <= bump.z1 + 1e-6) {
          top3(x0, bump.a, za, zb);
          top3(bump.b, x1, za, zb);
        } else top3(x0, x1, za, zb);
      }
      if (bump) {
        for (const x of [bump.a, bump.b]) {
          const g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.Float32BufferAttribute([x, yTop(bump.z0), bump.z0, x, bump.y, bump.z0, x, bump.y, bump.z1], 3));
          g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1], 2));
          g.computeVertexNormals();
          geos.push(g);
        }
        quad(geos, [[bump.a, bump.y, bump.z0], [bump.b, bump.y, bump.z0], [bump.b, bump.y, bump.z1], [bump.a, bump.y, bump.z1]]);
      }
      quad(geos, [[x0, bot, z1], [x1, bot, z1], [x1, yTop(z1), z1], [x0, yTop(z1), z1]]);
    } else {
      holedFace(geos, x0, x1, bot, top, cut((w) => Math.abs(w.out[1]) > 0.7 && w.a[1] > f.depth / 2, (p) => p[0]), (u, y) => [u, y, z1]);
      holedFace(geos, 0.1, z1, bot, top, cut((w) => side(w) && nearX0(w), (p) => p[1]), (u, y) => [x0, y, u]);
      holedFace(geos, 0.1, z1, bot, top, cut((w) => side(w) && !nearX0(w), (p) => p[1]), (u, y) => [x1, y, u]);
      quad(geos, [[x0, top, z1], [x1, top, z1], [x1, top, 0.1], [x0, top, 0.1]]);
    }
    quad(geos, [[x0, bot, 0.1], [x1, bot, 0.1], [x1, bot, z1], [x0, bot, z1]]);
    const lining = new THREE.Mesh(mergeGeometries(geos, false)!, liningMat);
    for (const g of geos) g.dispose();
    lining.name = `house_lining_${plan.id}`;
    street.add(lining);
  }

  // warm panes at night over the painted windows of a room upstairs
  let glowMesh: THREE.Mesh | null = null;
  const glowWins = plan.windows.filter((w) => w.kind === "glow");
  if (glowWins.length) {
    const geos: THREE.BufferGeometry[] = [];
    for (const w of glowWins) {
      const wf = winFrame(w);
      const o = 0.03;
      const a: [number, number] = [wf.ax + wf.ox * o, wf.az + wf.oz * o];
      const b: [number, number] = [w.b[0] + wf.ox * o, w.b[1] + wf.oz * o];
      quad(geos, [[a[0], w.y0, a[1]], [b[0], w.y0, b[1]], [b[0], w.y1, b[1]], [a[0], w.y1, a[1]]]);
    }
    glowMesh = new THREE.Mesh(mergeGeometries(geos, false)!, new THREE.MeshBasicMaterial({ color: 0xffb468, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    for (const g of geos) g.dispose();
    glowMesh.visible = false;
    glowMesh.name = `house_glow_${plan.id}`;
    street.add(glowMesh);
  }

  // ---- in the room's scene: the reveals of the door and the windows, the sill, the panes and bars, the punches
  const stone = lambert("house_reveal", { map: tex().slate, color: 0x6a6660 }, 0);
  const revealGeos: THREE.BufferGeometry[] = [];
  const punchGeos: THREE.BufferGeometry[] = [];
  const glassGeos: THREE.BufferGeometry[] = [];
  const barGeos: THREE.BufferGeometry[] = [];
  const R = REVEAL;
  // the doorway: sides, the soffit, the sill's top; the punch in the face and at the reveal's back
  {
    const l = -d.hw;
    const r = d.hw;
    const mid: [number, number, number] = [0, dp.yt / 2, R / 2];
    quadToward(revealGeos, [[l, 0, 0], [l, 0, R], [l, dp.yt, R], [l, dp.yt, 0]], mid);
    quadToward(revealGeos, [[r, 0, R], [r, 0, 0], [r, dp.yt, 0], [r, dp.yt, R]], mid);
    quadToward(revealGeos, [[l, dp.yt, 0], [l, dp.yt, R], [r, dp.yt, R], [r, dp.yt, 0]], mid);
    quad(revealGeos, [[l, dp.hs, -0.1], [r, dp.hs, -0.1], [r, dp.hs, R + 0.02], [l, dp.hs, R + 0.02]]);
    quad(revealGeos, [[l, 0, -0.1], [r, 0, -0.1], [r, dp.hs, -0.1], [l, dp.hs, -0.1]]);
  }
  const doorPunch: THREE.BufferGeometry[] = [];
  quad(doorPunch, [[-d.hw + 0.01, dp.hs, 0], [d.hw - 0.01, dp.hs, 0], [d.hw - 0.01, dp.yt - 0.01, 0], [-d.hw + 0.01, dp.yt - 0.01, 0]]);
  quad(doorPunch, [[-d.hw + 0.01, dp.hs, R], [d.hw - 0.01, dp.hs, R], [d.hw - 0.01, dp.yt - 0.01, R], [-d.hw + 0.01, dp.yt - 0.01, R]]);
  const holes = plan.windows.filter((w) => w.kind === "hole");
  for (const w of holes) {
    // (issue #10: a dormer's window has its face back from the wall line, a and b on it, and a shallow reveal)
    const Rw = w.depth ?? R;
    const paneAt = Math.min(0.1, Rw - 0.02);
    const wf = winFrame(w);
    const P = (s: number, y: number, dd: number): [number, number, number] => [wf.ax + wf.tx * s - wf.ox * dd, y, wf.az + wf.tz * s - wf.oz * dd];
    const L = wf.len;
    const mid = P(L / 2, (w.y0 + w.y1) / 2, Rw / 2);
    quadToward(revealGeos, [P(0, w.y0, 0), P(0, w.y0, Rw), P(0, w.y1, Rw), P(0, w.y1, 0)], mid);
    quadToward(revealGeos, [P(L, w.y0, Rw), P(L, w.y0, 0), P(L, w.y1, 0), P(L, w.y1, Rw)], mid);
    quadToward(revealGeos, [P(0, w.y1, 0), P(0, w.y1, Rw), P(L, w.y1, Rw), P(L, w.y1, 0)], mid);
    quadToward(revealGeos, [P(0, w.y0, Rw), P(0, w.y0, 0), P(L, w.y0, 0), P(L, w.y0, Rw)], mid);
    quad(punchGeos, [P(0.01, w.y0 + 0.01, 0), P(L - 0.01, w.y0 + 0.01, 0), P(L - 0.01, w.y1 - 0.01, 0), P(0.01, w.y1 - 0.01, 0)]);
    // the pane, 0.1 in (a dormer's in its shallow reveal), and its bars: one upright, two across, a frame
    quad(glassGeos, [P(0, w.y0, paneAt), P(L, w.y0, paneAt), P(L, w.y1, paneAt), P(0, w.y1, paneAt)]);
    const ry = Math.atan2(wf.ox, wf.oz);
    const bar = (s0: number, s1: number, y0: number, y1: number, t: number) => {
      const g = boxGeo(Math.max(0.01, s1 - s0), y1 - y0, t, 1);
      g.rotateY(ry);
      const [x, , z] = P((s0 + s1) / 2, 0, paneAt);
      g.translate(x, (y0 + y1) / 2, z);
      barGeos.push(g);
    };
    bar(L / 2 - 0.025, L / 2 + 0.025, w.y0, w.y1, 0.05);
    for (const k of [1, 2]) bar(0, L, w.y0 + ((w.y1 - w.y0) * k) / 3 - 0.02, w.y0 + ((w.y1 - w.y0) * k) / 3 + 0.02, 0.05);
    bar(0, 0.05, w.y0, w.y1, 0.07);
    bar(L - 0.05, L, w.y0, w.y1, 0.07);
    bar(0, L, w.y0, w.y0 + 0.05, 0.07);
    bar(0, L, w.y1 - 0.05, w.y1, 0.07);
  }
  const reveals = new THREE.Mesh(mergeGeometries(revealGeos, false)!, stone);
  inHouse.add(reveals);
  const pane = new THREE.MeshBasicMaterial({ color: 0xa8b4bc, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  if (glassGeos.length) {
    const glass = new THREE.Mesh(mergeGeometries(glassGeos, false)!, pane);
    glass.renderOrder = 5;
    const bars = new THREE.Mesh(mergeGeometries(barGeos, false)!, lambert("house_bars", { map: tex().planks, color: 0x3a2c20 }, 0));
    inHouse.add(glass, bars);
  }
  // the punches: first of all in the room's pass (renderOrder: every mark, then every punch), the door's only while it
  // stands open; only from outside (issue #29: from inside, the street through a window is right as the street drew it,
  // and a punch there would let another house's room, drawn after, show through that house's own front)
  const punchPair = (g: THREE.BufferGeometry, name: string): THREE.Group => {
    const pair = new THREE.Group();
    pair.name = name;
    const mark = new THREE.Mesh(g, PUNCH_MARK);
    mark.renderOrder = -1001;
    const punch = new THREE.Mesh(g, PUNCH);
    punch.renderOrder = -1000;
    pair.add(mark, punch);
    inHouse.add(pair);
    return pair;
  };
  const doorPunchMesh = punchPair(mergeGeometries(doorPunch, false)!, `house_${plan.id}_door_punch`);
  const winPunch = punchGeos.length ? punchPair(mergeGeometries(punchGeos, false)!, `house_${plan.id}_window_punch`) : null;
  for (const g of [...revealGeos, ...punchGeos, ...doorPunch, ...glassGeos, ...barGeos]) g.dispose();
  street.updateMatrixWorld(true);
  inHouse.updateMatrixWorld(true);

  // ---- the openings: the door (the porch and the leaf from outside, the doorway from inside) and each window
  const wbox = (pts: Array<[number, number]>, y0: number, y1: number) => {
    const b = new THREE.Box3();
    for (const [x, z] of pts) {
      const [wx, wz] = toW(x, z);
      b.expandByPoint(new THREE.Vector3(wx, plan.floorY + y0, wz));
      b.expandByPoint(new THREE.Vector3(wx, plan.floorY + y1, wz));
    }
    return b;
  };
  const [cx, cz] = toW(0, 0);
  const [ox, oz] = toW(0, -1);
  const W2 = 2 * d.hw;
  const openings: Opening[] = [
    {
      kind: "door",
      label: `${plan.id} door`,
      box: wbox([[-d.hw - 0.3, -2.6], [d.hw + 0.3, -2.6], [-d.hw - 0.3, R + W2 + 0.2], [d.hw + 0.3, R + W2 + 0.2]], -0.3, dp.yt + 0.3),
      inBox: wbox([[-d.hw - 0.1, -0.25], [d.hw + 0.1, -0.25], [-d.hw - 0.1, R + W2 + 0.1], [d.hw + 0.1, R + W2 + 0.1]], -0.1, dp.yt + 0.1),
      centre: new THREE.Vector3(cx, plan.floorY + 1.2, cz),
      out: new THREE.Vector3(ox - cx, 0, oz - cz).normalize(),
      open: () => isOpen(),
    },
  ];
  for (const w of holes) {
    const wf = winFrame(w);
    const e = (s: number, dd: number): [number, number] => [wf.ax + wf.tx * s + wf.ox * dd, wf.az + wf.tz * s + wf.oz * dd];
    const box = wbox([e(-0.05, 0.3), e(wf.len + 0.05, 0.3), e(-0.05, -(w.depth ?? R) - 0.12), e(wf.len + 0.05, -(w.depth ?? R) - 0.12)], w.y0 - 0.05, w.y1 + 0.05);
    const [mx, mz] = toW(...e(wf.len / 2, 0));
    const [nx, nz] = toW(...e(wf.len / 2, 1));
    openings.push({ kind: "window", label: `${plan.id} window`, box, inBox: box, centre: new THREE.Vector3(mx, plan.floorY + (w.y0 + w.y1) / 2, mz), out: new THREE.Vector3(nx - mx, 0, nz - mz).normalize(), open: () => true });
  }
  // ---- issue #10: the shell's openings as markers for the interior check (dev/interiorcheck.ts), as a Blender shell
  // writes them (docs/building-with-interior.md). The city house's holes and its door are cut by
  // tools/blender/build_city.py from shared/inworld_build.json, which is this plan's (server/test/houses-inworld.test.ts:
  // "the Blender build's spec is the plan's"): the same numbers, written here; the check then looks through the city's
  // own mesh at each of them.
  {
    const mark = (id: string, kind: "door" | "window", label: string, a: [number, number], b: [number, number], out: [number, number], yb: number, yt: number, depth = R) => {
      const [ax, az] = toW(...a);
      const [bx, bz] = toW(...b);
      const [ox2, oz2] = toW(a[0] + out[0], a[1] + out[1]);
      const len = Math.hypot(bx - ax, bz - az);
      const e = new THREE.Object3D();
      e.name = `opening_${id}`;
      e.position.set((ax + bx) / 2, plan.floorY + (yb + yt) / 2, (az + bz) / 2);
      e.userData = { kind, label, glaze: kind === "window" ? "sash" : "", shape: "rect", hw: len / 2, yb: plan.floorY + yb, yt: plan.floorY + yt, tx: (bx - ax) / len, tz: (bz - az) / len, nx: ox2 - ax, nz: oz2 - az, depth, arch: 0 };
      markers.add(e);
    };
    const markers = new THREE.Group();
    markers.name = `house_${plan.id}_openings`;
    world.scene.add(markers);
    mark(`${plan.id}_door`, "door", `${plan.id}, the street door`, [-d.hw, 0], [d.hw, 0], [0, -1], 0, dp.yt);
    // (issue #10: a dormer's window is marked on the dormer's front, its depth the dormer's reveal)
    holes.forEach((w, i) => mark(`${plan.id}_w${i}`, "window", w.inset ? `${plan.id}, the dormer window` : `${plan.id}, window ${i + 1}`, w.a, w.b, w.out, w.y0, w.y1, w.depth ?? R));
  }
  // ---- the lit room's light on the street (world/spill.ts): each window, and the door while it stands open
  const litKind: SpillKind = plan.kind === "shop" ? "shop" : plan.kind === "tavern" ? "tavern" : "room";
  const spills: Array<{ s: SpillSource; door: boolean }> = [];
  for (const w of plan.windows) {
    const wf = winFrame(w);
    const e = (s: number, dd: number): [number, number] => [wf.ax + wf.tx * s + wf.ox * dd, wf.az + wf.tz * s + wf.oz * dd];
    const [mx, mz] = toW(...e(wf.len / 2, 0.02));
    const [nx, nz] = toW(...e(wf.len / 2, 1.02));
    const kind: SpillKind = w.kind === "glow" ? (plan.id.endsWith("garret") ? "garret" : "room") : litKind;
    const s = addSpill({
      kind,
      label: `${plan.id} window`,
      x: mx,
      y: plan.floorY + (w.y0 + w.y1) / 2,
      z: mz,
      nx: nx - mx,
      nz: nz - mz,
      hw: wf.len / 2,
      hh: (w.y1 - w.y0) / 2,
      bars: w.kind === "hole" ? 22 : 0,
      ...(w.y0 > 2.5 ? { depth: 0 } : {}),
    });
    spills.push({ s, door: false });
  }
  {
    const [mx, mz] = toW(0, -0.02);
    const [nx, nz] = toW(0, -1.02);
    const s = addSpill({
      kind: litKind === "room" ? "room" : "door",
      label: `${plan.id} door`,
      x: mx,
      y: plan.floorY + (dp.hs + dp.yd) / 2,
      z: mz,
      nx: nx - mx,
      nz: nz - mz,
      hw: d.hw,
      hh: (dp.yd - dp.hs) / 2,
    });
    spills.push({ s, door: true });
  }

  // someone at home at night (glow): a candle in the room, so its see-through window is lit from the street
  let candle: THREE.PointLight | null = null;
  if (plan.kind === "home") {
    candle = new THREE.PointLight(0xffb060, 0, 9, 1.2);
    const r = plan.room.rect;
    candle.position.set((r.minX + r.maxX) / 2, plan.room.y + 1.6, (r.minZ + r.maxZ) / 2);
    inHouse.add(candle);
  }
  const fogK = room.scene.fog as THREE.Fog;
  const iw: InWorldRoom = {
    id: plan.id,
    scene: room.scene,
    openings,
    insideness: (eye) => HP.insideness(plan, ...local(eye.x, eye.z)),
    reach: 90,
    budgeted: true,
    air(k, streetFog) {
      fogK.color.copy(streetFog.color).lerp(AIR.color, k);
      fogK.near = THREE.MathUtils.lerp(streetFog.near, AIR.near, k);
      fogK.far = THREE.MathUtils.lerp(streetFog.far, AIR.far, k);
      // from the bright street by day a room looks dim through its windows
      room.setAmbient?.(1 - 0.45 * (1 - k) * dayNow);
      // the glass: a little of the sky on it from outside, nearly clear from inside. (2026-09-27, Steve: "when looking
      // at windows, the shine is still there", "gone after some time": from 15:30 to 17:35 a fixed pale day grey lay
      // over the lit room while the street was already dim, then switched off at once.) Now the sky's own colour at
      // this hour (the street's air), fading with the square of the daylight: no sheet at dusk, no jump.
      const sheen = dayNow * dayNow;
      pane.opacity = 0.06 + 0.22 * sheen * (1 - k);
      pane.color.copy(streetFog.color).multiplyScalar(2.2);
      doorPunchMesh.visible = isOpen() && k < 0.5;
      if (winPunch) winPunch.visible = k < 0.5;
    },
    lamps: () => room.lamps,
    scatter,
  };
  inWorld.add(iw);

  const setLeaf = () => {
    for (const h of hinges) h.rotation.y = -dir * open * d.open;
  };
  setLeaf();
  const self: HouseInWorld = {
    id: plan.id,
    plan,
    room,
    get doorOpen() {
      return want;
    },
    set doorOpen(v: boolean) {
      want = v;
    },
    get leaf() {
      return open;
    },
    insideness: (x, z) => HP.insideness(plan, ...local(x, z)),
    near(x, z) {
      if (HP.insideness(plan, ...local(x, z)) > 0.3) return 0;
      const [sx, sz] = toW(0, -1.2);
      return Math.hypot(x - sx, z - sz);
    },
    local,
    world: toW,
    floor: (x, z, feet) => plan.floorY + HP.floorAt(plan, ...local(x, z), feet - plan.floorY),
    level: (x, z, feet) => HP.levelAt(plan, ...local(x, z), feet - plan.floorY),
    free: (x, z, feet, r = 0.3) => HP.freeAt(plan, ...local(x, z), r, true, isOpen, feet - plan.floorY),
    drawn: () => !!inWorld.visibility().rooms[plan.id],
    glow: 0,
    update(t, dt, day) {
      dayNow = day;
      const target = want ? 1 : 0;
      if (open !== target) {
        open += THREE.MathUtils.clamp(target - open, -dt * 0.9, dt * 0.9);
        setLeaf();
      }
      const lit = self.glow * THREE.MathUtils.clamp((0.45 - day) / 0.25, 0, 1);
      if (candle) candle.intensity = 7 * lit * (0.92 + 0.08 * Math.sin(t * 5.3) * Math.sin(t * 2.1));
      // (empty fronts, 2026-09-26: the unlit glass takes the sky's light; at night a grey pane glowed over a shut door)
      const sky = 0.06 + 0.94 * THREE.MathUtils.clamp(day, 0, 1);
      transomMat.color.setRGB(0.11 * sky + 0.5 * lit, 0.13 * sky + 0.34 * lit, 0.16 * sky + 0.12 * lit);
      if (glowMesh) {
        (glowMesh.material as THREE.MeshBasicMaterial).opacity = lit * (0.8 + 0.08 * Math.sin(t * 2.3) * Math.sin(t * 1.3));
        glowMesh.visible = lit > 0.01;
      }
      liningMat.color.copy(LINING).lerp(LINING_LIT, lit);
      // the light on the street: the windows while the room is lit, the door as far as it stands open
      const flick = 0.95 + 0.05 * Math.sin(t * 3.7) * Math.sin(t * 1.9);
      for (const { s, door } of spills) {
        s.level = lit * flick * (door ? THREE.MathUtils.smoothstep(open, 0.05, 0.6) : 1);
        s.glow = door ? () => lit * THREE.MathUtils.smoothstep(open, 0.05, 0.6) : () => lit;
      }
    },
  };
  return self;
}

/** Solid rects of a builder (world/rooms.ts Builder.boxes) as plan rects (local). */
export function rectsOf(boxes: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }>): Rect[] {
  return boxes.map((b) => ({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ }));
}
