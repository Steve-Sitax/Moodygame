import * as THREE from "three";
import { Horizon, type Heightfield } from "./occlusion";
import { mirrorPasses, mirrorView, type MirrorPass } from "./mirror";
import { psxUniforms } from "../retro/psx";
import type { ViewRect } from "./inworld";

// M7 rendering (Steve, 2026-09-24: "Do you also render like in real games?"). Before each frame
// the culler decides, for the main view and for each mirror, what cannot be seen:
//  - beyond the fog: a thing whose nearest point is past the fog's far end (landmarks: 2.2 times
//    further, their fogReach) is the fog colour and nothing else;
//  - behind the houses: the occlusion horizon (world/occlusion.ts);
//  - in a mirror: under the mirror's plane, too small to make a pixel there, or (the puddles)
//    behind the houses from the mirrored eye;
//  - the river mirror and the water sheets as a whole when no water can be seen;
// Rooms in the world (the cathedral) are scenes of their own, drawn through their doors by
// world/inworld.ts; the culler only works on the street's scene, and only when it is drawn.
// It never touches `visible` (the game's own switch): for the length of each render it moves a
// hidden thing to a layer no camera looks at, and puts it back after the frame.
// Things three.js itself may not cull (frustumCulled false: their bounds are not trusted) and
// things drawn over everything (depthTest off) are never culled here either.

/** Layers no camera sees: why a thing is hidden in the main view (the dev view draws them). */
const L_FOG = 1 << 30;
const L_OCC = 1 << 29;
const L_OTHER = 1 << 28;

const H_FOG = 1;
const H_OCC = 2;
const H_WATER = 4;
const H_OUT = 16;

export interface CullStats {
  /** Renderables looked at this frame (visible ones). */
  things: number;
  /** Hidden in the main view: beyond the fog, behind houses, the water sheets. */
  fog: number;
  occluded: number;
  water: number;
  /** Hidden in each mirror pass (name: count), and whether the river mirror is drawn. */
  mirrors: Record<string, number>;
  waterSeen: boolean;
  /** CPU of the culler this frame (ms). */
  ms: number;
  /** Samples marched for the horizons. */
  samples: number;
  /** Where the culler's time went (ms): horizons, the walk, occlusion and mirrors, fog, the list. */
  parts: number[];
  /** This frame made a full evaluation (else it reused the last one). */
  fresh: boolean;
  /** Things beyond the fog at the last full evaluation (the fog step runs from Culler.fogMin). */
  far?: number;
}

interface Info {
  mat: THREE.Material | THREE.Material[];
  /** How many fog-fars this thing still shows (Infinity: not fogged). */
  reach: number;
  exempt: boolean;
  water: boolean;
  /** Plain three.js fog (not retro/psx.ts): no lamp glow in its fog, so it is darker than the sky near a lit lamp. */
  plain: boolean;
}

interface Item {
  obj: THREE.Object3D;
  orig: number;
  /** Where it stood when it was judged (world): moved more than MOVE_SLACK, it is drawn again. */
  px: number;
  py: number;
  pz: number;
  /** Bits: which passes hide it. Bit 0 main, then one per mirror (MIRROR_BIT). */
  hide: number;
  why: number;
}

interface Ent {
  obj: THREE.Object3D;
  info: Info;
  /** World bounding sphere, and its nearest point's distance from the eye. */
  x: number;
  y: number;
  z: number;
  r: number;
  dist: number;
  /** Highest world y (NaN until asked). */
  top: number;
  hide: number;
  why: number;
  /** Outside the view's left or right edge (three.js leaves it out anyway). */
  out: boolean;
}

/** How far the eye may move (m), and the view turn (rad), before a new full evaluation. */
const EYE_SLACK = 0.5;
const TURN = 0.3;
/** How far a hidden thing may move (m) before it is drawn again until the next evaluation. */
const MOVE_SLACK = 0.15;
/** A full evaluation at least this often (frames): new things, moving ones. */
const EVERY = 30;

const BUCKETS = 128;
/** The owner mark of a lit lamp's glow in the revealer list. */
const LAMP = -2;
const BUCKET = (2 * Math.PI) / BUCKETS;

export interface CullerOptions {
  /** The height map of the houses, once built (world/occlusion.ts). */
  heights: Promise<Heightfield>;
  /** The highest water surface now (river, dock, lock), waves not included. */
  waterTop(): number;
  /** Culling off (the dev fly mode looks at everything). */
  paused?(): boolean;
  /**
   * M7 taverns and homes: no occlusion by the houses now (the eye is inside a city house: the house's own
   * cells would hide the street seen out of its door and windows).
   */
  noOcclusion?(): boolean;
}

export class Culler {
  /** The switch (Dev menu, `__scheldemist.cull`): off draws everything, for comparison. */
  enabled = true;
  /** Occlusion by the houses (on its own switch, to compare). */
  occlusion = true;
  /** Dev view: the hidden things drawn through the walls in colour after the frame. */
  view = false;
  stats: CullStats = { things: 0, fog: 0, occluded: 0, water: 0, mirrors: {}, waterSeen: true, ms: 0, samples: 0, parts: [0, 0, 0, 0, 0], fresh: false };
  private hf: Heightfield | null = null;
  private readonly horizon = new Horizon(700, EYE_SLACK);
  private readonly mirrorHorizon = new Horizon(700, EYE_SLACK);
  /** Fewer things than this beyond the fog: the fog step is left out (see evaluate, part 3). */
  static fogMin = 60;
  private readonly infos = new WeakMap<THREE.Object3D, Info>();
  private items: Item[] = [];
  private active = false;
  private mainCam: THREE.Camera | null = null;
  private hook: ((...a: unknown[]) => void) | null = null;
  private readonly sph = new THREE.Sphere();
  private readonly eye = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly wire: Record<"occ" | "fog", THREE.MeshBasicMaterial>;
  /** This frame's things with bounds (pooled). */
  private readonly ents: Ent[] = [];
  /** Revealer spheres (x, y, z, r, and the thing that owns them, or -1 when always drawn). */
  private readonly rv = { n: 0, x: new Float64Array(256), y: new Float64Array(256), z: new Float64Array(256), r: new Float64Array(256), owner: new Int32Array(256) };
  /** Per eye (0 main, 1.. mirrors): each revealer's direction, angular radius and distance; azimuth buckets. */
  private readonly eyes: Array<{ ux: Float64Array; uy: Float64Array; uz: Float64Array; a: Float64Array; d: Float64Array; use: Uint8Array; all: number[]; buckets: number[][] }> = [];
  private readonly clusters = new WeakMap<THREE.Object3D, { geo: string; ver: number; m: Float32Array; s: number[] }>();
  /** This frame's things that show past the fog (pooled), turned into revealer spheres only when needed. */
  private readonly revObjs: Array<{ o: THREE.Object3D; has: boolean; x: number; y: number; z: number; r: number; owner: number; reach: number }> = [];

  constructor(
    readonly scene: THREE.Scene,
    private readonly opts: CullerOptions,
  ) {
    opts.heights.then((h) => (this.hf = h)).catch((e) => console.warn("occlusion: no height map", e));
    mirrorView.hiddenInMain = (o) => this.hiddenInMain(o);
    const mk = (color: number) => new THREE.MeshBasicMaterial({ color, wireframe: true, depthTest: false, depthWrite: false, transparent: true, opacity: 0.55, fog: false });
    this.wire = { occ: mk(0xff3030), fog: mk(0xffb020) };
  }

  /**
   * Decide what each pass draws this frame (call just before the frame's render). True when it ran:
   * the scene's matrices are then up to date for the whole frame (the passes need not redo them).
   * It never throws: on an error the frame is drawn whole and the culler rests (logged once).
   */
  prepare(camera: THREE.PerspectiveCamera, rect: ViewRect | null = null): boolean {
    this.active = false;
    this.passStack.length = 0;
    this.camStack.length = 0;
    if (!this.enabled || this.opts.paused?.()) {
      this.lastEval = null;
      return false;
    }
    try {
      return this.run(camera, rect);
    } catch (e) {
      for (const it of this.items) it.obj.layers.mask = it.orig;
      this.items.length = 0;
      this.active = false;
      this.lastEval = null;
      const msg = String((e as Error)?.message ?? e);
      if (!this.errors.has(msg)) {
        this.errors.add(msg);
        console.error("[cull] the frame is drawn whole:", e);
      }
      return false;
    }
  }
  private readonly errors = new Set<string>();
  /** The eye, view and weather the last full evaluation was made for (null: make one). */
  private lastEval: { x: number; y: number; z: number; az: number; pitch: number; fog: number; passes: string; lamps: number; frame: number; occ: boolean; rect: string } | null = null;
  private frameNo = 0;

  private run(camera: THREE.PerspectiveCamera, rect: ViewRect | null): boolean {
    const t0 = performance.now();
    const scene = this.scene;
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    const eye = this.eye.setFromMatrixPosition(camera.matrixWorld);
    this.mainCam = camera;
    this.frameNo++;
    const fog = scene.fog as THREE.Fog | null;
    const fogFar = fog ? fog.far : Infinity;
    this.fwd.set(0, 0, -1).transformDirection(camera.matrixWorld);
    const az = Math.atan2(this.fwd.z, this.fwd.x);
    const pitch = Math.asin(THREE.MathUtils.clamp(this.fwd.y, -1, 1));
    const passes = mirrorPasses.filter((p) => p.willRender(eye));
    const passKey = passes.map((p) => `${p.index}:${p.planeY.toFixed(2)}`).join(",");
    let lamps = 0;
    for (const l of psxUniforms.uLamps.value) lamps += l.w > 0.002 ? 1 + l.x * 0.001 : 0;
    // a full evaluation holds for any eye within EYE_SLACK of where it was made and a view turned
    // up to TURN: made again when the eye or the view leaves that, the fog or the mirrors change,
    // or after EVERY frames (things move); in between only what moved is let back in
    const L = this.lastEval;
    let turn = L ? Math.abs(az - L.az) : 0;
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    const rectKey = rect ? `${rect.x.toFixed(3)},${rect.w.toFixed(3)}` : "";
    const fresh =
      !L ||
      Math.hypot(eye.x - L.x, eye.y - L.y, eye.z - L.z) > EYE_SLACK ||
      turn > TURN ||
      Math.abs(pitch - L.pitch) > TURN ||
      Math.abs(fogFar - L.fog) > Math.max(0.5, L.fog * 0.02) ||
      passKey !== L.passes ||
      Math.abs(lamps - L.lamps) > 0.01 ||
      (this.occlusion && !this.opts.noOcclusion?.()) !== L.occ ||
      this.frameNo - L.frame >= EVERY ||
      rectKey !== L.rect;
    if (fresh) {
      this.evaluate(camera, eye, az, pitch, fogFar, passes, t0, rect);
      this.lastEval = { x: eye.x, y: eye.y, z: eye.z, az, pitch, fog: fogFar, passes: passKey, lamps, frame: this.frameNo, occ: this.occlusion && !this.opts.noOcclusion?.(), rect: rectKey };
    } else this.refresh();
    this.active = true;
    this.chainHook();
    this.stats.ms = performance.now() - t0;
    this.stats.fresh = fresh;
    return true;
  }

  /** Between evaluations: a hidden thing that has moved more than MOVE_SLACK is drawn again. */
  private refresh(): void {
    const items = this.items;
    let kept = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const e = it.obj.matrixWorld.elements;
      if (Math.abs(e[12] - it.px) + Math.abs(e[13] - it.py) + Math.abs(e[14] - it.pz) > MOVE_SLACK) continue;
      items[kept++] = it;
    }
    items.length = kept;
  }

  /** A full evaluation (see run()): every thing, every pass. */
  private evaluate(camera: THREE.PerspectiveCamera, eye: THREE.Vector3, azView: number, pitch: number, fogFar: number, passes: MirrorPass[], t0: number, rect: ViewRect | null): void {
    const scene = this.scene;
    const st = this.stats;
    st.fog = st.occluded = st.water = st.samples = 0;
    st.mirrors = {};

    // --- the occlusion horizons (main eye; the puddle mirror's eye below the ground)
    const hf = this.occlusion && !this.opts.noOcclusion?.() ? this.hf : null;
    const wTop = this.opts.waterTop() + 0.6;
    let waterSeen = true;
    const occMain = !!hf;
    let occMirror: MirrorPass | null = null;
    const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    // looking well up or down the view spreads round the eye: every direction counts then
    const wide = Math.abs(pitch) + vHalf + TURN > 1.2;
    // the street drawn only through a part of the view (a door, from inside a room: world/inworld.ts):
    // the directions of that part only. A mirror's picture is looked up where its surface shows,
    // which is in that part too (a puddle pixel reads the mirror at about its own place on screen)
    let az = azView;
    let half = wide ? Math.PI : hHalf + TURN + 0.1;
    const part = !!rect && !wide;
    if (rect && !wide) {
      const tH = Math.tan(hHalf);
      const a0 = Math.atan((2 * rect.x - 1) * tH);
      const a1 = Math.atan((2 * (rect.x + rect.w) - 1) * tH);
      az = azView + (a0 + a1) / 2;
      half = (a1 - a0) / 2 + TURN + 0.1;
    }
    let mirrorBits = 0;
    for (const p of passes) mirrorBits |= MIRROR_BIT << p.index;
    if (hf) {
      // only houses the game surely draws occlude: world/city.ts drops house chunks whose nearest
      // point is past the fog's far end + 10 m (unfogged lamp glass then shows through where they were)
      const maxR = Math.min(700, Number.isFinite(fogFar) ? fogFar + 10 - EYE_SLACK - 1 : 700);
      // from the eye raised by the slack (the houses shrunk by it in the horizon's windows)
      this.horizon.compute(hf, eye.x, eye.y + EYE_SLACK, eye.z, az, half, maxR, fogFar + 6 + EYE_SLACK, wTop);
      st.samples += this.horizon.work;
      waterSeen = this.horizon.waterSeen;
      // the puddles' mirror: exact while the eye is lower than the lowest house (M7 doc)
      // (the river's plane lies too low for it: the eye stands ~4 m over it, the lowest house is 3.8 m; 2026-09-28)
      const puddles = passes.find((p) => p.name === "puddles");
      if (puddles && eye.y + EYE_SLACK - puddles.planeY < hf.minHeight - 0.5) {
        this.mirrorHorizon.derive(this.horizon, 2 * puddles.planeY - eye.y + EYE_SLACK, Math.min(maxR, 170));
        occMirror = puddles;
      }
    }
    st.waterSeen = waterSeen;
    const t1 = performance.now();

    // --- 1. every visible thing: its bounds, and the "revealers": things that show past the fog
    // (unfogged lights, additive glows, landmarks with a longer fog reach). A fully fogged thing
    // still hides what stands behind it, so it is only left out where no revealer stands behind it.
    const items = this.items;
    items.length = 0;
    const ents = this.ents;
    let ne = 0;
    const rv = this.rv;
    rv.n = 0;
    const sph = this.sph;
    const revs = this.revObjs;
    let nr = 0;
    const walk = (o: THREE.Object3D): void => {
      if (!o.visible) return;
      const r = o as THREE.Mesh;
      if ((r.isMesh || (o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite) && o.layers.mask === 1) {
        st.things++;
        const info = this.info(o);
        const has = this.bounds(o, sph);
        let owner = -1;
        if (!info.exempt && has) {
          const e = ents[ne] ?? (ents[ne] = { obj: o, info, x: 0, y: 0, z: 0, r: 0, dist: 0, top: NaN, hide: 0, why: 0, out: false });
          e.obj = o;
          e.info = info;
          e.x = sph.center.x;
          e.y = sph.center.y;
          e.z = sph.center.z;
          // grown by the slack: the eye may move EYE_SLACK and the thing MOVE_SLACK before the next evaluation
          e.r = sph.radius + EYE_SLACK + MOVE_SLACK;
          e.dist = sph.center.distanceTo(eye) - e.r;
          e.top = NaN;
          e.hide = 0;
          e.why = 0;
          owner = ne++;
        }
        if (info.reach > 1 && (has || info.exempt)) {
          const q = revs[nr] ?? (revs[nr] = { o, has: false, x: 0, y: 0, z: 0, r: 0, owner: -1, reach: 1 });
          q.o = o;
          q.has = has;
          q.x = sph.center.x;
          q.y = sph.center.y;
          q.z = sph.center.z;
          q.r = sph.radius + EYE_SLACK + MOVE_SLACK;
          q.owner = owner;
          q.reach = info.reach;
          nr++;
        }
      }
      const ch = o.children;
      for (let i = 0; i < ch.length; i++) walk(ch[i]);
    };
    st.things = 0;
    walk(scene);
    const t2 = performance.now();

    // --- 2. water, behind the houses (main view); under the plane, too small, behind the houses (mirrors)
    const snapSlope = 0.022; // two PS1 snap cells up (the houses snap down, the thing up)
    const snapGrow = 0.021; // and sideways, as a share of the distance
    const fogPad = (reach: number) => fogFar * reach + 3 + fogFar * 0.03;
    // well outside the view's left or right edge (with the turn the evaluation allows) three.js leaves
    // a thing out itself, in the mirrors too (they look the same way; only up and down are mirrored)
    for (let i = 0; i < ne; i++) {
      const e = ents[i];
      const d = e.dist;
      e.out = false;
      if (!wide) {
        const hx = e.x - eye.x;
        const hz = e.z - eye.z;
        const D = Math.hypot(hx, hz);
        if (D > e.r + 1) {
          let off = Math.abs(Math.atan2(hz, hx) - az);
          if (off > Math.PI) off = 2 * Math.PI - off;
          e.out = off - Math.asin(Math.min(1, e.r / D)) > half;
        }
      }
      if (e.out) {
        // outside the part of the view the street shows in: no pass needs it
        if (part) {
          e.hide = 1 | mirrorBits;
          e.why = H_OUT;
        }
        continue;
      }
      if (e.info.water && !waterSeen) {
        e.hide |= 1;
        e.why = H_WATER;
      } else if (occMain && d > 1.5 && d < fogPad(e.info.reach) && this.horizon.hides(e.x, e.y + snapSlope * d, e.z, e.r + 0.25 + snapGrow * d)) {
        e.hide |= 1;
        e.why = H_OCC;
      }
      for (let k = 0; k < passes.length; k++) {
        const p = passes[k];
        const bit = MIRROR_BIT << p.index;
        // wholly under the mirror's plane: its near plane cuts it away (water: its waves reach up to 0.8 m)
        if (Number.isNaN(e.top)) e.top = this.top(e.obj, e);
        if (e.top < p.planeY + (e.info.water ? -0.8 : 0.002)) {
          e.hide |= bit;
          continue;
        }
        const my = 2 * p.planeY - eye.y;
        const md = Math.hypot(e.x - eye.x, e.y - my, e.z - eye.z) - e.r;
        // beyond the mirror's reach (the puddles': Steve 2026-09-28, "just what is within 50 m")
        if (md > p.reach) {
          e.hide |= bit;
          continue;
        }
        // its own size under minPx pixels of its picture across (mirrorBudget; was a quarter of the size with the slack; not the far plane: the oblique near plane skews it)
        if (e.r - EYE_SLACK - MOVE_SLACK < md * p.pixel * p.minPx * 0.5) {
          e.hide |= bit;
          continue;
        }
        if (p === occMirror && md > 1.5 && this.mirrorHorizon.hides(e.x, e.y + snapSlope * md, e.z, e.r + 0.25 + snapGrow * md)) e.hide |= bit;
      }
    }

    const t3 = performance.now();
    // --- 3. beyond the fog, where nothing that shows further stands behind it (per eye). The
    // revealers are only gathered when something is beyond the fog, and only those that can stand
    // behind it and still show (within their own fog reach)
    let minNear = Infinity;
    let slack = 0;
    for (const p of passes) slack = Math.max(slack, Math.abs(2 * (eye.y - p.planeY)));
    let far = 0;
    for (let i = 0; i < ne; i++) {
      const e = ents[i];
      if (!e.out && e.dist - slack > fogPad(e.info.reach)) {
        minNear = Math.min(minNear, e.dist - slack);
        far++;
      }
    }
    // (2026-09-28, the slow frames: this step costs ~3 ms a full evaluation, every ~8 frames on the move; with only a few
    // things beyond the fog (a clear day) drawing them costs less and keeps the frames even. Drawn, they look as the
    // culler would have them: this step only ever leaves out what cannot be seen)
    st.far = far;
    if (far < Culler.fogMin) minNear = Infinity;
    if (minNear === Infinity) nr = 0;
    for (let q = 0; q < nr; q++) {
      const R = revs[q];
      if (R.has) {
        const d = Math.hypot(R.x - eye.x, R.y - eye.y, R.z - eye.z);
        if (d + R.r + slack <= minNear) continue; // in front of everything beyond the fog
        if (d - R.r - slack > fogPad(R.reach)) continue; // past its own reach: shows nothing
      }
      this.revealers(R.o, R.has ? this.tmpS.set(this.tmpV.set(R.x, R.y, R.z), R.r) : null, R.owner);
    }
    // a lit lamp's glow in the fog is added along each ray up to the surface it meets (retro/psx.ts
    // lampScatter): a fogged thing in front of it still cuts the glow short, out to about 14 m round it
    if (nr) for (const l of psxUniforms.uLamps.value) if (l.w > 0.002) this.addRev(l.x, l.y, l.z, 15 + EYE_SLACK + MOVE_SLACK, LAMP);
    const px = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / 270;
    if (minNear < Infinity) this.indexRevealers(0, eye.x, eye.y, eye.z, px, ents, true);
    for (let i = 0; i < ne && minNear < Infinity; i++) {
      const e = ents[i];
      if (e.out || e.hide & 1 || e.dist <= fogPad(e.info.reach)) continue;
      if (!this.revealed(0, e, eye.x, eye.y, eye.z)) {
        e.hide |= 1;
        e.why = H_FOG;
      }
    }
    for (let k = 0; k < passes.length && minNear < Infinity; k++) {
      const p = passes[k];
      const bit = MIRROR_BIT << p.index;
      const my = 2 * p.planeY - eye.y;
      this.indexRevealers(k + 1, eye.x, my, eye.z, px, ents, false);
      for (let i = 0; i < ne; i++) {
        const e = ents[i];
        if (e.out || e.hide & bit) continue;
        const md = Math.hypot(e.x - eye.x, e.y - my, e.z - eye.z) - e.r;
        if (md > fogPad(e.info.reach) && !this.revealed(k + 1, e, eye.x, my, eye.z)) e.hide |= bit;
      }
    }

    const t4 = performance.now();
    // --- 4. the list the render hooks apply, and the numbers
    for (let i = 0; i < ne; i++) {
      const e = ents[i];
      if (!e.hide) continue;
      const me = e.obj.matrixWorld.elements;
      items.push({ obj: e.obj, orig: e.obj.layers.mask, hide: e.hide, why: e.why, px: me[12], py: me[13], pz: me[14] });
      if (e.hide & 1) {
        if (e.why === H_FOG) st.fog++;
        else if (e.why === H_OCC) st.occluded++;
        else if (e.why === H_WATER) st.water++;
      }
      for (const p of passes) if (e.hide & (MIRROR_BIT << p.index)) st.mirrors[p.name] = (st.mirrors[p.name] ?? 0) + 1;
    }
    for (let i = ne; i < ents.length; i++) ents[i].obj = scene; // no stale references
    const t5 = performance.now();
    st.parts = [t1 - t0, t2 - t1, t3 - t2, t4 - t3, t5 - t4].map((x) => +x.toFixed(3));
  }

  /** Dev: a full evaluation next frame (after a switch was flipped). */
  invalidate(): void {
    this.lastEval = null;
  }

  /** Is this thing hidden in the main view this frame (between prepare and finish)? The mirrors ask (mirror.ts mirrorView). */
  hiddenInMain(o: THREE.Object3D): boolean {
    if (!this.active) return false;
    for (const it of this.items) if (it.obj === o) return (it.hide & 1) !== 0;
    return false;
  }

  /** After the frame's render: every layer back as it was. */
  finish(): void {
    if (!this.active) return;
    for (const it of this.items) it.obj.layers.mask = it.orig;
    this.passStack.length = 0;
    this.camStack.length = 0;
    this.active = false;
  }

  /**
   * Dev view: after the frame, draw what was hidden in the main view through everything, in
   * wireframe: red behind the houses, amber beyond the fog. Call between prepare and finish.
   */
  drawHidden(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    if (!this.active || !this.view) return;
    const keepMask = camera.layers.mask;
    const keepClear = renderer.autoClear;
    const keepBg = this.scene.background;
    renderer.autoClear = false;
    this.scene.background = null;
    try {
      for (const [layer, mat] of [[L_OCC, this.wire.occ], [L_FOG, this.wire.fog]] as const) {
        camera.layers.mask = layer;
        this.scene.overrideMaterial = mat;
        renderer.render(this.scene, camera);
      }
    } finally {
      this.scene.overrideMaterial = null;
      this.scene.background = keepBg;
      camera.layers.mask = keepMask;
      renderer.autoClear = keepClear;
    }
  }

  /**
   * Put the culler's hook last on the scene's onBeforeRender chain (other parts hide far chunks
   * there), and on onAfterRender: a mirror is drawn inside the main pass (three.js tests the layers
   * again as it draws), so when it ends the main pass's layers go back.
   */
  private chainHook(): void {
    const sc = this.scene as unknown as { onBeforeRender: (...a: unknown[]) => void; onAfterRender: (...a: unknown[]) => void };
    const self = this;
    if (!this.hook || sc.onBeforeRender !== this.hook) {
      const before = sc.onBeforeRender;
      this.hook = function (this: unknown, ...a: unknown[]) {
        before?.apply(this, a);
        self.push(a[2] as THREE.Camera);
      };
      sc.onBeforeRender = this.hook;
    }
    if (!this.afterHook || sc.onAfterRender !== this.afterHook) {
      const after = sc.onAfterRender;
      this.afterHook = function (this: unknown, ...a: unknown[]) {
        self.pop();
        after?.apply(this, a);
      };
      sc.onAfterRender = this.afterHook;
    }
  }
  private afterHook: ((...a: unknown[]) => void) | null = null;
  /** The passes being drawn, outermost first (a mirror inside the main pass), and their cameras. */
  private readonly passStack: number[] = [];
  private readonly camStack: THREE.Camera[] = [];

  private push(camera: THREE.Camera): void {
    if (!this.active) return;
    // the hook can sit twice in the chain (other parts wrap it after the culler did): one render, one push
    if (this.camStack.length && this.camStack[this.camStack.length - 1] === camera) return;
    this.camStack.push(camera);
    let bit = 0;
    if (camera === this.mainCam) bit = 1;
    else {
      const p = mirrorPasses.find((m) => m.camera === camera);
      if (p) bit = MIRROR_BIT << p.index;
    }
    this.passStack.push(bit);
    this.apply(bit);
  }

  private pop(): void {
    if (!this.active || !this.passStack.length) return;
    this.passStack.pop();
    this.camStack.pop();
    if (this.passStack.length) this.apply(this.passStack[this.passStack.length - 1]);
  }

  /** Set the layers for one pass (bit 1 main, a mirror's bit, 0: nothing hidden). */
  private apply(bit: number): void {
    for (const it of this.items) {
      if (bit && it.hide & bit) {
        const main = bit === 1;
        it.obj.layers.mask = !main ? L_OTHER : it.why === H_OCC ? L_OCC : it.why === H_FOG && (it.obj as THREE.Mesh).isMesh && !(it.obj as THREE.SkinnedMesh).isSkinnedMesh ? L_FOG : L_OTHER;
      } else it.obj.layers.mask = it.orig;
    }
  }

  private info(o: THREE.Object3D): Info {
    const mat = (o as THREE.Mesh).material;
    let i = this.infos.get(o);
    if (i && i.mat === mat) return i;
    const mats = Array.isArray(mat) ? mat : [mat];
    let reach = 1;
    let exempt = o.frustumCulled === false;
    let water = false;
    let plain = false;
    for (const m of mats) {
      if (!m) continue;
      if (m.depthTest === false) exempt = true;
      const fogged = (m as THREE.MeshBasicMaterial).fog === true;
      // additive light (halos, flames) adds the fog colour itself: it still brightens past the fog;
      // a shader of its own (smoke, lit windows, halos) fogs its own way, often not all the way
      // (a shader may say how far it shows: userData.fogReach, in fog-fars; it does its own fog)
      const said = m.userData?.fogReach as number | undefined;
      const normal = m.blending === THREE.NormalBlending;
      if (said !== undefined && normal) reach = Math.max(reach, said);
      else if (!fogged || !normal || (m as THREE.ShaderMaterial).isShaderMaterial) reach = Infinity;
      else reach = Math.max(reach, (m.userData?.psx?.fogReach as number | undefined) ?? 1);
      if (m.userData?.psx?.water) water = true;
      if (!m.userData?.psx) plain = true;
    }
    i = { mat, reach, exempt, water, plain };
    this.infos.set(o, i);
    return i;
  }

  private addRev(x: number, y: number, z: number, r: number, owner: number): void {
    const v = this.rv;
    if (v.n === v.x.length) {
      const grow = (a: Float64Array) => {
        const b = new Float64Array(a.length * 2);
        b.set(a);
        return b;
      };
      v.x = grow(v.x);
      v.y = grow(v.y);
      v.z = grow(v.z);
      v.r = grow(v.r);
      const o = new Int32Array(v.owner.length * 2);
      o.set(v.owner);
      v.owner = o;
    }
    v.x[v.n] = x;
    v.y[v.n] = y;
    v.z[v.n] = z;
    v.r[v.n] = r;
    v.owner[v.n] = owner;
    v.n++;
  }

  /**
   * Register a thing that shows past the fog, as small spheres where its parts are: each point of a
   * point cloud, each instance, the vertices of a big merged mesh gathered in 4 m cells.
   */
  private revealers(o: THREE.Object3D, sph: THREE.Sphere | null, owner: number): void {
    const m = o as THREE.Mesh;
    const pos = m.geometry?.getAttribute?.("position") as THREE.BufferAttribute | undefined;
    const v = this.tmpV;
    if ((o as THREE.Points).isPoints && pos && pos.count <= 128) {
      const dr = m.geometry.drawRange;
      const end = Math.min(pos.count, dr.start + (Number.isFinite(dr.count) ? dr.count : pos.count));
      // a point cloud may name its per-point "lit" attribute (userData.litAttr): unlit points show nothing
      const litName = ((Array.isArray(m.material) ? m.material[0] : m.material)?.userData?.litAttr as string | undefined) ?? "";
      const lit = litName ? (m.geometry.getAttribute(litName) as THREE.BufferAttribute | undefined) : undefined;
      for (let i = dr.start; i < end; i++) {
        if (lit && lit.getX(i) < 0.01) continue;
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        this.addRev(v.x, v.y, v.z, 2.0, owner);
      }
      return;
    }
    if ((m as unknown as THREE.InstancedMesh).isInstancedMesh && m.geometry) {
      const im = m as unknown as THREE.InstancedMesh;
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      const gs = m.geometry.boundingSphere!;
      const mat = this.tmpM;
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, mat);
        mat.premultiply(o.matrixWorld);
        v.copy(gs.center).applyMatrix4(mat);
        this.addRev(v.x, v.y, v.z, gs.radius * mat.getMaxScaleOnAxis() + 0.3, owner);
      }
      return;
    }
    const big = sph ? sph.radius > 6 : true;
    if (big && pos && pos.count <= 60000) {
      // points (smoke, sparks) and small merges in 4 m cells, big ones (landmarks) in 8 m cells;
      // a point sprite reaches round its point: grow those cells by 2 m
      const pts = (o as THREE.Points).isPoints;
      const cell = !pts && sph && sph.radius > 30 ? 8 : 4;
      let c = this.clusters.get(o);
      const me = o.matrixWorld.elements;
      let same = !!c && c.geo === m.geometry.uuid && c.ver === pos.version;
      if (same) for (let k = 0; k < 16 && same; k++) same = c!.m[k] === Math.fround(me[k]);
      if (!c || !same) {
        const cells = new Map<string, number[]>();
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          const k = `${Math.floor(v.x / cell)},${Math.floor(v.y / cell)},${Math.floor(v.z / cell)}`;
          const b = cells.get(k);
          if (!b) cells.set(k, [v.x, v.y, v.z, v.x, v.y, v.z]);
          else {
            b[0] = Math.min(b[0], v.x);
            b[1] = Math.min(b[1], v.y);
            b[2] = Math.min(b[2], v.z);
            b[3] = Math.max(b[3], v.x);
            b[4] = Math.max(b[4], v.y);
            b[5] = Math.max(b[5], v.z);
          }
        }
        const out: number[] = [];
        for (const b of cells.values()) out.push((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2, Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2 + (pts ? 2.0 : 0.3));
        c = { geo: m.geometry.uuid, ver: pos.version, m: Float32Array.from(me), s: out };
        this.clusters.set(o, c);
      }
      for (let i = 0; i < c.s.length; i += 4) this.addRev(c.s[i], c.s[i + 1], c.s[i + 2], c.s[i + 3], owner);
      return;
    }
    if (sph) this.addRev(sph.center.x, sph.center.y, sph.center.z, sph.radius, owner);
    else if (m.geometry) {
      // no trusted bounds: the geometry's own, as it stands
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      const b = this.tmpS.copy(m.geometry.boundingSphere!).applyMatrix4(o.matrixWorld);
      this.addRev(b.center.x, b.center.y, b.center.z, b.radius + 1, owner);
    } else {
      v.setFromMatrixPosition(o.matrixWorld);
      this.addRev(v.x, v.y, v.z, 3, owner);
    }
  }
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpS = new THREE.Sphere();

  /** Directions and azimuth buckets of the revealers from one eye (main: those hidden in the main view do not count). */
  private indexRevealers(slot: number, ex: number, ey: number, ez: number, px: number, ents: Ent[], main: boolean): void {
    const v = this.rv;
    let E = this.eyes[slot];
    if (!E || E.ux.length < v.n) {
      const n = Math.max(256, v.n * 2);
      E = { ux: new Float64Array(n), uy: new Float64Array(n), uz: new Float64Array(n), a: new Float64Array(n), d: new Float64Array(n), use: new Uint8Array(n), all: [], buckets: Array.from({ length: BUCKETS }, () => []) };
      this.eyes[slot] = E;
    }
    E.all.length = 0;
    for (const b of E.buckets) b.length = 0;
    for (let j = 0; j < v.n; j++) {
      const own = v.owner[j];
      E.use[j] = main && own >= 0 && ents[own].hide & 1 ? 0 : 1;
      if (!E.use[j]) continue;
      const dx = v.x[j] - ex;
      const dy = v.y[j] - ey;
      const dz = v.z[j] - ez;
      const d = Math.hypot(dx, dy, dz);
      E.d[j] = d;
      if (d <= v.r[j] + 0.01) {
        E.a[j] = Math.PI;
        E.all.push(j);
        continue;
      }
      E.ux[j] = dx / d;
      E.uy[j] = dy / d;
      E.uz[j] = dz / d;
      const a = Math.asin(Math.min(1, v.r[j] / d)) + px;
      E.a[j] = a;
      const h = Math.hypot(dx, dz);
      // near the vertical, or wide: every direction
      if (a > 0.5 || h < v.r[j] + px * d + 0.5) {
        E.all.push(j);
        continue;
      }
      const az = Math.atan2(dz, dx);
      const ha = Math.asin(Math.min(1, (v.r[j] + px * d) / h));
      for (let b = Math.floor((az - ha) / BUCKET); b <= Math.floor((az + ha) / BUCKET); b++) E.buckets[((b % BUCKETS) + BUCKETS) % BUCKETS].push(j);
    }
  }

  /** Does a revealer stand behind this thing (in its outline, farther than its nearest point), seen from this eye? */
  private revealed(slot: number, e: Ent, ex: number, ey: number, ez: number): boolean {
    const E = this.eyes[slot];
    const v = this.rv;
    const dx = e.x - ex;
    const dy = e.y - ey;
    const dz = e.z - ez;
    const d = Math.hypot(dx, dy, dz);
    if (d <= e.r + 0.01) return true;
    const ux = dx / d;
    const uy = dy / d;
    const uz = dz / d;
    const a = Math.asin(Math.min(1, e.r / d));
    const near = d - e.r;
    // a lit lamp's glow is summed along the ray to each surface (plain three.js fog has none at all):
    // where a thing overlaps a glow, before or behind it, it is not quite the colour of the sky
    const test = (j: number): boolean => {
      if (!E.use[j] || (E.d[j] + v.r[j] <= near && v.owner[j] !== LAMP)) return false;
      if (E.a[j] >= Math.PI) return true;
      const dot = ux * E.ux[j] + uy * E.uy[j] + uz * E.uz[j];
      return Math.acos(Math.max(-1, Math.min(1, dot))) < a + E.a[j];
    };
    for (const j of E.all) if (test(j)) return true;
    const h = Math.hypot(dx, dz);
    if (a > 0.5 || h < e.r + 0.5) {
      for (let j = 0; j < v.n; j++) if (test(j)) return true;
      return false;
    }
    const az = Math.atan2(dz, dx);
    const ha = Math.asin(Math.min(1, e.r / h));
    for (let b = Math.floor((az - ha) / BUCKET); b <= Math.floor((az + ha) / BUCKET); b++) for (const j of E.buckets[((b % BUCKETS) + BUCKETS) % BUCKETS]) if (test(j)) return true;
    return false;
  }

  /**
   * A geometry with bounds that fit it now: its sphere (and box, if it has one) are made again when
   * its positions were written since (ropes, anything reshaped in place).
   */
  private fresh(g: THREE.BufferGeometry | undefined): THREE.BufferGeometry | null {
    if (!g) return null;
    const pos = g.getAttribute("position") as (THREE.BufferAttribute & { data?: { version: number } }) | undefined;
    if (!pos) return null;
    const ver = pos.version ?? pos.data?.version ?? 0;
    const seen = this.geoVer.get(g);
    // first sight: its own bounds as they are (no hitch when the culler starts); rewritten since: again
    if (!g.boundingSphere || (seen !== undefined && seen !== ver)) {
      g.computeBoundingSphere();
      if (g.boundingBox) g.computeBoundingBox();
    }
    if (seen !== ver) this.geoVer.set(g, ver);
    return g;
  }
  private readonly geoVer = new WeakMap<THREE.BufferGeometry, number>();
  private readonly instSph = new WeakMap<THREE.InstancedMesh, { ver: number; count: number; geo: THREE.Sphere; sph: THREE.Sphere }>();
  private readonly tmpB = new THREE.Box3();

  /** World bounding sphere of a renderable, or false when it has none to trust. */
  private bounds(o: THREE.Object3D, out: THREE.Sphere): boolean {
    const m = o as THREE.Mesh;
    if ((o as THREE.Sprite).isSprite) {
      out.center.setFromMatrixPosition(o.matrixWorld);
      const s = o.matrixWorld.getMaxScaleOnAxis();
      out.radius = Math.max(o.scale.x, o.scale.y) * 0.75 * (s / Math.max(1e-6, Math.max(o.scale.x, o.scale.y, o.scale.z)));
      return true;
    }
    let local: THREE.Sphere | null = null;
    let grow = 0;
    if ((m as unknown as THREE.InstancedMesh).isInstancedMesh) {
      // three.js works out an instanced mesh's sphere once; instances that move leave it behind.
      // The culler keeps its own, made again whenever the instances or their number change
      const im = m as unknown as THREE.InstancedMesh;
      if (im.count === 0) return false;
      const g = this.fresh(im.geometry);
      if (!g) return false;
      let c = this.instSph.get(im);
      if (!c || c.ver !== im.instanceMatrix.version || c.count !== im.count || c.geo !== g.boundingSphere) {
        const b = this.tmpB.makeEmpty();
        const gs = g.boundingSphere!;
        for (let i = 0; i < im.count; i++) {
          im.getMatrixAt(i, this.tmpM);
          this.tmpV.copy(gs.center).applyMatrix4(this.tmpM);
          const r = gs.radius * this.tmpM.getMaxScaleOnAxis();
          b.expandByPoint(this.tmpV.addScalar(r));
          b.expandByPoint(this.tmpV.subScalar(2 * r));
        }
        const sph = new THREE.Sphere();
        b.getBoundingSphere(sph);
        c = { ver: im.instanceMatrix.version, count: im.count, geo: gs, sph };
        this.instSph.set(im, c);
      }
      local = c.sph;
    } else if ((m as THREE.SkinnedMesh).isSkinnedMesh) {
      const sk = m as THREE.SkinnedMesh;
      if (!sk.boundingSphere) sk.computeBoundingSphere();
      local = sk.boundingSphere;
      grow = 0.5;
    } else {
      const g = this.fresh(m.geometry);
      if (!g) return false;
      local = g.boundingSphere;
    }
    if (!local || !Number.isFinite(local.radius)) return false;
    out.copy(local).applyMatrix4(o.matrixWorld);
    out.radius += grow;
    return true;
  }

  /** Highest world y of a renderable (its box where it has one, else the sphere's top). */
  private top(o: THREE.Object3D, sph: { y: number; r: number }): number {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || !m.geometry) return sph.y + sph.r;
    const g = m.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox!;
    const e = o.matrixWorld.elements;
    const cx = (b.min.x + b.max.x) / 2;
    const cy = (b.min.y + b.max.y) / 2;
    const cz = (b.min.z + b.max.z) / 2;
    const hx = (b.max.x - b.min.x) / 2;
    const hy = (b.max.y - b.min.y) / 2;
    const hz = (b.max.z - b.min.z) / 2;
    return e[1] * cx + e[5] * cy + e[9] * cz + e[13] + Math.abs(e[1]) * hx + Math.abs(e[5]) * hy + Math.abs(e[9]) * hz;
  }
}

/** The main view is bit 0; mirror pass k is bit MIRROR_BIT << k. */
const MIRROR_BIT = 2;

/** Dev: a line of numbers in the corner while the culling view is on. */
export function mountCullHud(cull: Culler): void {
  const el = document.createElement("div");
  el.className = "devfly";
  el.style.display = "none";
  el.style.top = "auto";
  el.style.bottom = "8px";
  document.body.appendChild(el);
  setInterval(() => {
    el.style.display = cull.view ? "block" : "none";
    if (!cull.view) return;
    const s = cull.stats;
    const m = Object.entries(s.mirrors)
      .map(([k, v]) => `${k} -${v}`)
      .join(", ");
    el.textContent = cull.enabled
      ? `CULLING  ${s.things} things; hidden: ${s.fog} beyond the fog (amber), ${s.occluded} behind houses (red); water ${s.waterSeen ? "seen" : "not seen: river mirror skipped"}; mirrors ${m || "none"}; ${s.ms.toFixed(2)} ms`
      : "CULLING OFF (Dev menu: Culling on/off)";
  }, 250);
}
if (import.meta.env.DEV) Object.assign(window, { __Culler: Culler });
