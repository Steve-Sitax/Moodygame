import * as THREE from "three";
import type { InWorld } from "../world/inworld";
import { PUNCH, PUNCH_MARK } from "../world/houseInWorld";

// The punch check (dev, issue #29; __scheldemist.punchcheck()): does the city houses' punch (world/houseInWorld.ts) clear
// the depth behind their doors and windows, and do the lining and the paving never cover a house's room from the street?
// For the view as it is now:
//  - `cleared`: the pixels the punch sets to the far plane (drawn once with every room's own things hidden and the punch
//    writing a colour: a fragment count of the punch);
//  - `area`: the same with the new punch, whatever the mode: where the facade's plane shows through an opening and
//    nothing stands before it (the pixels a room must own);
//  - `covered`: of those, the pixels where a room is drawn once the houses' linings and the paving (ground_*) are
//    hidden, and not with them: the lining or the paving covering a room. Must be 0;
//  - `changed`: of those, the pixels whose colour changes with the linings and the paving hidden (a view through a room
//    and out of another of its windows or doors onto the street beyond counts here, and is right).
// `old: true` runs it with the punch as it was before issue #29 (gl_FragDepth = 1.0 under the normal depth test, no
// stencil): `cleared` 0, and `covered` > 0 wherever the lining or the paving stands before a room.

export interface PunchCtx {
  renderer: THREE.WebGLRenderer;
  target: THREE.WebGLRenderTarget;
  draw: () => void;
  scene: THREE.Scene;
  inWorld: InWorld;
  /** Called after each picture is drawn (the canvas holds it): "view", "mask", "bare" (no linings, no paving). */
  grab?: (what: "view" | "mask" | "bare") => void;
}

export interface PunchReport {
  mode: "new" | "old";
  w: number;
  h: number;
  rooms: string[];
  cleared: number;
  area: number;
  covered: number;
  coveredBox: number[] | null;
  changed: number;
  /** The pixels a room is drawn on in the view, with the linings and the paving and without (both must be > 0). */
  roomPx: number[];
}

function read(ctx: PunchCtx): Float32Array {
  const { renderer, target } = ctx;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const px = new Float32Array(target.width * target.height * 4);
  const keep = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.FLOAT, px);
  renderer.setRenderTarget(keep);
  return px;
}

const isPunch = (m: THREE.Material | THREE.Material[]) => m === PUNCH || m === PUNCH_MARK;

/** Set the punch as it was before issue #29 (old) or as it is now. */
function mode(old: boolean): void {
  PUNCH.depthFunc = old ? THREE.LessEqualDepth : THREE.AlwaysDepth;
  PUNCH.stencilWrite = !old;
  PUNCH_MARK.visible = !old;
}

/** The punch drawn in a colour, every room's own things hidden: the mask of what it clears. */
/** Every room's own things hidden (the punches stay) while `fn` runs. */
function withoutRooms<T>(ctx: PunchCtx, fn: () => T): T {
  const hidden: THREE.Object3D[] = [];
  for (const r of ctx.inWorld.all)
    r.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !isPunch(m.material) && m.visible) {
        m.visible = false;
        hidden.push(m);
      }
    });
  try {
    return fn();
  } finally {
    for (const o of hidden) o.visible = true;
  }
}

/** The punch drawn in a colour, every room's own things hidden: the mask of what it clears. */
function mask(ctx: PunchCtx, old: boolean, grab = false): Uint8Array {
  mode(old);
  PUNCH.colorWrite = true;
  PUNCH.uniforms.uShow.value.set(1, 0, 1, 1);
  try {
    return withoutRooms(ctx, () => {
      ctx.draw();
      if (grab) ctx.grab?.("mask");
      const px = read(ctx);
      const out = new Uint8Array(px.length / 4);
      for (let i = 0; i < out.length; i++) out[i] = px[i * 4] > 0.99 && px[i * 4 + 1] < 0.01 && px[i * 4 + 2] > 0.99 ? 1 : 0;
      return out;
    });
  } finally {
    PUNCH.colorWrite = false;
    PUNCH.uniforms.uShow.value.set(0, 0, 0, 0);
    mode(false);
  }
}

/**
 * Where a room is seen in a picture: the pixels that change when every room's own things are hidden (the rooms' pass
 * then draws only the punches: the street shows there). A material swapped in for the test would be held back by the
 * warm-up (world/warmup.ts) until its shader is built, and show nothing; hiding needs no shader.
 */
function roomMask(ctx: PunchCtx, view: Float32Array): Uint8Array {
  const bare = withoutRooms(ctx, () => {
    ctx.draw();
    return read(ctx);
  });
  const out = new Uint8Array(view.length / 4);
  for (let i = 0; i < out.length; i++) {
    const j = i * 4;
    out[i] = Math.max(Math.abs(view[j] - bare[j]), Math.abs(view[j + 1] - bare[j + 1]), Math.abs(view[j + 2] - bare[j + 2])) > 1e-4 ? 1 : 0;
  }
  return out;
}

export function punchCheck(ctx: PunchCtx, opts: { old?: boolean } = {}): PunchReport {
  const old = !!opts.old;
  const w = ctx.target.width;
  const h = ctx.target.height;
  // once to settle the plan (which rooms are drawn), then the masks
  ctx.draw();
  const vis = ctx.inWorld.visibility().rooms;
  const rooms = Object.keys(vis).filter((k) => vis[k]);
  const area = mask(ctx, false, !old);
  const cl = old ? mask(ctx, true, true) : area;
  // the pictures (and where the rooms are drawn) with and without the linings and the paving
  const off: THREE.Object3D[] = [];
  ctx.scene.traverse((o) => {
    if (o.visible && (/^house_lining_/.test(o.name) || /^ground_/.test(o.name))) off.push(o);
  });
  // (the rooms' glass lies over everything behind a window: where the room itself is seen is judged without it)
  const glass: THREE.Object3D[] = [];
  for (const r of ctx.inWorld.all)
    r.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.visible && !isPunch(m.material) && (m.material as THREE.Material).transparent) glass.push(m);
    });
  const unglazed = (): Uint8Array => {
    for (const g of glass) g.visible = false;
    try {
      ctx.draw();
      return roomMask(ctx, read(ctx));
    } finally {
      for (const g of glass) g.visible = true;
    }
  };
  let a: Float32Array;
  let b: Float32Array;
  let ra: Uint8Array;
  let rb: Uint8Array;
  mode(old);
  try {
    ctx.draw();
    ctx.grab?.("view");
    a = read(ctx);
    ra = unglazed();
    for (const o of off) o.visible = false;
    ctx.draw();
    ctx.grab?.("bare");
    b = read(ctx);
    rb = unglazed();
  } finally {
    for (const o of off) o.visible = true;
    mode(false);
  }
  let cleared = 0;
  let inArea = 0;
  let covered = 0;
  let changed = 0;
  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -1;
  let by1 = -1;
  for (let i = 0; i < area.length; i++) {
    cleared += cl[i];
    if (!area[i]) continue;
    inArea++;
    const j = i * 4;
    if (Math.max(Math.abs(a[j] - b[j]), Math.abs(a[j + 1] - b[j + 1]), Math.abs(a[j + 2] - b[j + 2])) > 1e-4) changed++;
    if (rb[i] && !ra[i]) {
      covered++;
      const x = i % w;
      const y = h - 1 - Math.floor(i / w);
      bx0 = Math.min(bx0, x);
      by0 = Math.min(by0, y);
      bx1 = Math.max(bx1, x);
      by1 = Math.max(by1, y);
    }
  }
  ctx.draw();
  const roomPx = [ra.reduce((a2, v) => a2 + v, 0), rb.reduce((a2, v) => a2 + v, 0)];
  return { mode: old ? "old" : "new", w, h, rooms, cleared, area: inArea, covered, coveredBox: covered ? [bx0, by0, bx1, by1] : null, changed, roomPx };
}
