import * as THREE from "three";
import { psxUniforms, MAX_LAMPS } from "../retro/psx";

// Interiors in the world (M7, docs/milestones/M7-cathedral-inworld.md). A building's inside is
// built at its real place inside its shell, in a scene of its own (its lights, its fog), and
// drawn over the street's picture with the street's depth kept: so it shows only where the
// shell has a hole, through its openings. Portal culling keeps it cheap:
//  - outside, a room is drawn only when one of its open openings is near enough and in view,
//    and then only in the part of the screen that opening covers;
//  - inside, the street is drawn only through the open openings in view (in the screen part they
//    cover), and not at all when none is in view.
// Walking inside is the walk map's override (World.addWalkArea); the fog and the ambient light
// blend over the threshold by how far in the eye is (0 on the step .. 1 in the room).
//
// The reusable part is here: a building gives an InWorldRoom (world/cathedralInWorld.ts is the
// first). Windows are openings too (kind "window"): the lit room shows through them from the
// street and the street through them from inside; they are not walked through.

/** A part of the view, 0..1 from the bottom left. */
export type ViewRect = { x: number; y: number; w: number; h: number };

export interface Opening {
  kind: "door" | "window";
  label: string;
  /**
   * A box (world) round the opening and everything that shows through it at the threshold (the
   * porch, open leaves, the reveal): the screen part it covers is where the other side is drawn.
   */
  box: THREE.Box3;
  /**
   * From inside, the part through which the street shows (the doorway with its open leaves), if
   * smaller than `box`: the street is drawn only in the screen part this covers.
   */
  inBox?: THREE.Box3;
  /** Its middle and the way out of the building (world, unit, horizontal). */
  centre: THREE.Vector3;
  out: THREE.Vector3;
  /** Shut doors show nothing through. */
  open(): boolean;
  /**
   * M7 prison real: for an eye inside the room, can this opening be seen from there at all (a cell's window is not
   * seen from the corridor)? Only those that can count for drawing the street from inside. Unset: always.
   */
  seen?(eye: THREE.Vector3): boolean;
}

export interface InWorldRoom {
  id: string;
  /** The room's own scene: its group in world place, its lights and fog, no background. */
  scene: THREE.Scene;
  openings: Opening[];
  /** How far in the eye is: 0 outside .. 1 inside (the threshold blend). */
  insideness(eye: THREE.Vector3): number;
  /** Beyond this distance (m) from an opening the room is not drawn from outside. */
  reach: number;
  /** Set the room's air for this frame: k = insideness, the street's fog to blend from. */
  air(k: number, street: THREE.Fog): void;
  /** Its lamps for the psx glow in the air (world points, weight). */
  lamps(): Array<{ p: THREE.Vector3; w: number }>;
  /** The psx in-scatter inside (the street's weather value outside). */
  scatter: number;
  /**
   * M7 taverns and homes: one of many small rooms (a city house). From outside it is drawn only within its
   * `reach` (not out to the fog's end, as a hall is) and only among the nearest `InWorld.budget` of them;
   * past that its openings show the house's dark lining (world/houseInWorld.ts).
   */
  budgeted?: boolean;
  /**
   * M7 prison real: from inside, windows farther than this (m) from the eye do not bring the street in (a high
   * window far up a hall shows the room's clear colour, near enough the sky's, not the whole town behind it). Unset: all.
   */
  insideReach?: number;
}

export interface RoomPass {
  room: InWorldRoom;
  rect: ViewRect | null;
  before: () => void;
  after: () => void;
}

export interface InWorldPlan {
  /** The street: drawn or not, and in which part of the view (null: all of it). */
  world: { draw: boolean; rect: ViewRect | null };
  rooms: RoomPass[];
}

/** What the renderer (world/cull.ts) may ask: is the street seen at all, and where; which rooms show. */
export interface InWorldVisibility {
  outdoors: boolean;
  outdoorsRect: ViewRect | null;
  inside: string | null;
  rooms: Record<string, boolean>;
}

/**
 * Every room is drawn with this many point lights (2026-09-26, the stutter): three.js builds a shader
 * set for each light count, and with rooms of 2 to 9 lamps that was 7 sets, each built the first time
 * its room came into view (up to 2 s of frozen game on Windows). The lamps a room does not have are
 * filled up with lights at intensity 0: they add nothing to any pixel, so every room looks exactly as
 * before, and all rooms share one set. A room may have at most this many lamps (docs/rendering.md).
 */
export const ROOM_POINT_LIGHTS = 10;

/** A light is drawn when it and every parent up to its scene are visible. */
function shownIn(o: THREE.Object3D, scene: THREE.Scene): boolean {
  let p: THREE.Object3D | null = o;
  while (p && p !== scene) {
    if (!p.visible) return false;
    p = p.parent;
  }
  return p === scene;
}

const corners = Array.from({ length: 8 }, () => new THREE.Vector3());
const tmp = new THREE.Vector3();
const frustum = new THREE.Frustum();
const projView = new THREE.Matrix4();

/**
 * The part of the view a box covers (clamped), null when the eye is at or in it (a corner behind
 * the eye: all of the view), or "none" when it is off the view.
 */
export function screenRect(box: THREE.Box3, camera: THREE.PerspectiveCamera): ViewRect | null | "none" {
  const { min, max } = box;
  let i = 0;
  for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) corners[i++].set(x, y, z);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of corners) {
    tmp.copy(c).applyMatrix4(camera.matrixWorldInverse);
    // in front of the eye is -z; a corner at or behind the near plane: the box wraps the eye
    if (tmp.z > -camera.near * 1.5) return null;
    tmp.applyMatrix4(camera.projectionMatrix);
    x0 = Math.min(x0, tmp.x);
    x1 = Math.max(x1, tmp.x);
    y0 = Math.min(y0, tmp.y);
    y1 = Math.max(y1, tmp.y);
  }
  x0 = Math.max(-1, x0);
  y0 = Math.max(-1, y0);
  x1 = Math.min(1, x1);
  y1 = Math.min(1, y1);
  if (x1 <= x0 || y1 <= y0) return "none";
  return { x: (x0 + 1) / 2, y: (y0 + 1) / 2, w: (x1 - x0) / 2, h: (y1 - y0) / 2 };
}

function union(a: ViewRect | null | undefined, b: ViewRect | null): ViewRect | null {
  if (a === undefined) return b;
  if (a === null || b === null) return null;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export class InWorld {
  private readonly rooms: InWorldRoom[] = [];
  /** The room the eye is in now (insideness over a half), and how far in. */
  here: InWorldRoom | null = null;
  k = 0;
  private last: InWorldVisibility = { outdoors: true, outdoorsRect: null, inside: null, rooms: {} };
  private readonly keepLamps = Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4());
  private keepScatter = 0;
  /** Off: nothing of this is drawn (dev comparisons). */
  enabled = true;
  /** M7 taverns and homes: at most this many small rooms drawn from outside at once, the nearest first. */
  budget = 4;
  /** The last frame's small rooms seen from outside and how many were left out over the budget (dev). */
  lastBudget = { seen: 0, drawn: 0 };

  constructor(
    /** The street's scene: the plan applies when it is drawn. */
    readonly scene: THREE.Scene,
  ) {}

  add(room: InWorldRoom): void {
    this.rooms.push(room);
    this.evenLights(room, true);
  }

  /** Every room (the shader warm-up in main.ts builds their shaders before they are seen). */
  get all(): readonly InWorldRoom[] {
    return this.rooms;
  }

  private readonly pads = new Map<InWorldRoom, { pads: THREE.PointLight[]; lamps: THREE.PointLight[]; scanned: number; warned: boolean }>();

  /**
   * Fill the room's point lights up to ROOM_POINT_LIGHTS with dark ones (see there). Its own lamps are
   * looked for again at most once a second (a room may add or hide a lamp as it loads or by the hour).
   */
  evenLights(room: InWorldRoom, rescan = false): void {
    let e = this.pads.get(room);
    if (!e) {
      const group = new THREE.Group();
      group.name = "room light pads";
      const pads: THREE.PointLight[] = [];
      for (let i = 0; i < ROOM_POINT_LIGHTS; i++) {
        const l = new THREE.PointLight(0x000000, 0, 1, 2);
        l.position.set(0, -999, 0);
        pads.push(l);
        group.add(l);
      }
      room.scene.add(group);
      e = { pads, lamps: [], scanned: -Infinity, warned: false };
      this.pads.set(room, e);
    }
    const now = performance.now();
    if (rescan || now - e.scanned > 1000) {
      e.scanned = now;
      e.lamps.length = 0;
      const pads = e.pads;
      room.scene.traverse((o) => {
        if ((o as THREE.PointLight).isPointLight && !pads.includes(o as THREE.PointLight)) e.lamps.push(o as THREE.PointLight);
      });
    }
    let n = 0;
    for (const l of e.lamps) if (shownIn(l, room.scene)) n++;
    if (n > ROOM_POINT_LIGHTS && !e.warned) {
      e.warned = true;
      console.warn(`[inworld] ${room.id} has ${n} lamps, more than ROOM_POINT_LIGHTS (${ROOM_POINT_LIGHTS}): its shaders are built apart`);
    }
    for (let i = 0; i < e.pads.length; i++) e.pads[i].visible = i < ROOM_POINT_LIGHTS - n;
  }

  /** Where the eye is (called each frame before drawing and by the game: the room Jef is in). */
  locate(eye: THREE.Vector3): { room: InWorldRoom | null; k: number } {
    let best: InWorldRoom | null = null;
    let bk = 0;
    for (const r of this.rooms) {
      const k = r.insideness(eye);
      if (k > bk) [best, bk] = [r, k];
    }
    return { room: best, k: bk };
  }

  /** What to draw for this eye (the renderer calls it once a frame, retro/retroPass.ts). */
  plan(camera: THREE.PerspectiveCamera): InWorldPlan | null {
    if (!this.enabled || !this.rooms.length) return null;
    camera.updateMatrixWorld();
    projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const { room: at, k } = this.locate(eye);
    const inside = at && k >= 0.5 ? at : null;
    this.here = inside;
    this.k = k;
    const street = this.scene.fog as THREE.Fog;
    const vis: InWorldVisibility = { outdoors: true, outdoorsRect: null, inside: inside?.id ?? null, rooms: {} };
    const plan: InWorldPlan = { world: { draw: true, rect: null }, rooms: [] };
    const small: Array<{ r: InWorldRoom; rect: ViewRect | null; d: number }> = [];
    for (const r of this.rooms) {
      let rect: ViewRect | null | undefined = undefined;
      let near = Infinity;
      for (const o of r.openings) {
        const box = r === inside ? (o.inBox ?? o.box) : o.box;
        if (!o.open() || !frustum.intersectsBox(box)) continue;
        if (r === inside && o.seen && !o.seen(eye)) continue;
        if (r === inside && r.insideReach !== undefined && o.kind === "window" && o.box.distanceToPoint(eye) > r.insideReach) continue;
        if (r !== inside) {
          // outside: on the opening's outer side (or in it), and not beyond the street's fog (M7 fix:
          // no reach of its own, so nothing of the room loads in at a distance; the fog fades it).
          // M7 taverns and homes: a small room within its own reach too
          const dist = o.box.distanceToPoint(eye);
          if (dist > (r.budgeted ? Math.min(r.reach, street.far * 1.05) : Math.max(r.reach, street.far * 1.05))) continue;
          tmp.copy(eye).sub(o.centre);
          if (tmp.dot(o.out) < -1.5 && !o.box.containsPoint(eye)) continue;
          near = Math.min(near, dist);
        }
        const s = screenRect(box, camera);
        if (s === "none") continue;
        // outside and far: under a few pixels of the 270-line picture, the opening shows nothing yet
        if (r !== inside && s && s.w * 480 < 4 && s.h * 270 < 4) continue;
        rect = union(rect, s);
      }
      if (r === inside) {
        // inside: the street only through the openings in view
        plan.world = { draw: rect !== undefined, rect: rect ?? null };
        vis.outdoors = rect !== undefined;
        vis.outdoorsRect = rect ?? null;
        plan.rooms.push(this.pass(r, null, k, street));
        vis.rooms[r.id] = true;
      } else if (rect !== undefined && r.budgeted) {
        small.push({ r, rect, d: near });
      } else if (rect !== undefined) {
        plan.rooms.push(this.pass(r, rect, at === r ? k : 0, street));
        vis.rooms[r.id] = true;
      } else vis.rooms[r.id] = false;
    }
    // the small rooms seen from outside: the nearest within the budget
    small.sort((a, b) => a.d - b.d);
    small.forEach((q, i) => {
      const draw = i < this.budget;
      vis.rooms[q.r.id] = draw;
      if (draw) plan.rooms.push(this.pass(q.r, q.rect, at === q.r ? k : 0, street));
    });
    this.lastBudget = { seen: small.length, drawn: Math.min(small.length, this.budget) };
    this.last = vis;
    return plan;
  }

  /** For the renderer's own culling (world/cull.ts): last frame's answer. */
  visibility(): InWorldVisibility {
    return this.last;
  }

  private pass(room: InWorldRoom, rect: ViewRect | null, k: number, street: THREE.Fog): RoomPass {
    return {
      room,
      rect,
      before: () => {
        room.air(k, street);
        this.evenLights(room);
        // the room's lamps glow in its air. Seen from the street the street's air lies between the eye and the
        // window, so the gas lamps' glow in it stays; they fade as the eye goes in (2026-09-27, Steve: "indoor
        // places show dark in the fog": at night every room seen from outside lost the lamps' glow and stood as a
        // dark block in the lit fog). Inside, the room's lamps take the slots first; from outside, the street's.
        const slots = psxUniforms.uLamps.value;
        const lamps = room.lamps();
        for (let i = 0; i < MAX_LAMPS; i++) {
          this.keepLamps[i].copy(slots[i]);
          slots[i].set(0, -999, 0, 0);
        }
        let n = 0;
        const putRoom = () => {
          for (const l of lamps) if (n < MAX_LAMPS && l.w > 0.002) slots[n++].set(l.p.x, l.p.y, l.p.z, l.w);
        };
        const putStreet = () => {
          for (const s of this.keepLamps) if (n < MAX_LAMPS && s.w * (1 - k) > 0.002) slots[n++].set(s.x, s.y, s.z, s.w * (1 - k));
        };
        if (k >= 0.5) {
          putRoom();
          putStreet();
        } else {
          putStreet();
          putRoom();
        }
        this.keepScatter = psxUniforms.uScatter.value;
        psxUniforms.uScatter.value = THREE.MathUtils.lerp(this.keepScatter, room.scatter, k);
      },
      after: () => {
        const slots = psxUniforms.uLamps.value;
        for (let i = 0; i < MAX_LAMPS; i++) slots[i].copy(this.keepLamps[i]);
        psxUniforms.uScatter.value = this.keepScatter;
      },
    };
  }
}

/**
 * Draw a plan into the current render target (retro/retroPass.ts): clear, the street (whole, in
 * a part of the view, or not at all), then each room over it with the street's depth kept.
 * A part of the view is drawn with the camera's view offset and a scissor, so the renderer's own
 * frustum culling leaves out what the opening cannot show.
 */
export function drawPlan(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, plan: InWorldPlan, scene: THREE.Scene, camera: THREE.PerspectiveCamera, afterWorld?: () => void): void {
  const W = target.width;
  const H = target.height;
  const sub = (rect: ViewRect | null, draw: () => void) => {
    if (!rect) return draw();
    const px = Math.max(0, Math.floor(rect.x * W));
    const py = Math.max(0, Math.floor(rect.y * H));
    const pw = Math.min(W, Math.ceil((rect.x + rect.w) * W)) - px;
    const ph = Math.min(H, Math.ceil((rect.y + rect.h) * H)) - py;
    if (pw <= 0 || ph <= 0) return;
    camera.setViewOffset(W, H, px, H - py - ph, pw, ph);
    target.viewport.set(px, py, pw, ph);
    target.scissor.set(px, py, pw, ph);
    target.scissorTest = true;
    renderer.setRenderTarget(target);
    try {
      draw();
    } finally {
      camera.clearViewOffset();
      target.viewport.set(0, 0, W, H);
      target.scissor.set(0, 0, W, H);
      target.scissorTest = false;
      renderer.setRenderTarget(target);
    }
  };
  const keepAuto = renderer.autoClear;
  renderer.setRenderTarget(target);
  if (!plan.world.draw || plan.world.rect) {
    // the part of the view the street does not fill: the room's walls cover it; clear it anyway
    const bg = scene.background as THREE.Color | null;
    if (bg?.isColor) renderer.setClearColor(bg, 1);
    renderer.clear();
  }
  if (plan.world.draw) {
    sub(plan.world.rect, () => renderer.render(scene, camera));
    afterWorld?.();
  }
  renderer.autoClear = false;
  try {
    for (const r of plan.rooms) {
      r.before();
      try {
        sub(r.rect, () => renderer.render(r.room.scene, camera));
      } finally {
        r.after();
      }
    }
  } finally {
    renderer.autoClear = keepAuto;
  }
}
