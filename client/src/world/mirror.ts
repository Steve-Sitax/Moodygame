import * as THREE from "three";
import { psxUniforms } from "../retro/psx";

// Planar reflections on the graphics card: the scene is rendered a second time from
// a camera mirrored in a flat plane (y = planeY), into a small texture (PS1-coarse),
// and a surface on that plane looks the picture up with `matrix`. The approach of
// three.js' Reflector (examples/jsm/objects/Reflector.js, MIT): the mirrored camera,
// an oblique near plane on the mirror plane so nothing below it shows, and the same
// projection to look the picture up.
//
// Use (a surface on the plane):
//   const m = createMirror(0.02);
//   material.uniforms.uMirror = { value: m.texture }; material.uniforms.uMirrorMat = { value: m.matrix };
//   m.attach(mesh);
// In the shader: vec4 r = uMirrorMat * vec4(worldPos, 1.0); vec3 c = texture2DProj(uMirror, r).rgb;
// (offset r.xy by ripples times r.w to shake the picture).

export interface Mirror {
  readonly texture: THREE.Texture;
  /** World position -> projective uv in the mirror picture (updated before every draw). */
  readonly matrix: THREE.Matrix4;
  /** Render the mirror just before this mesh is drawn (once per frame, whatever the mesh count). */
  attach(mesh: THREE.Object3D): void;
  /** Things never to show in this mirror (the surface itself is always hidden). */
  hide(...objs: THREE.Object3D[]): void;
  /** Move the mirror plane (M6 tides: the river rises and falls). */
  setPlane(y: number): void;
  dispose(): void;
}

export interface MirrorOptions {
  /** Picture size (default 320 x 180: coarse, like the rest). */
  width?: number;
  height?: number;
  /** How far the mirror sees (default 160 m; the fog hides the rest). */
  far?: number;
  /** Render only while this says yes (nothing to mirror: save the frame time). */
  /** Draw the mirror at all? Given the camera when it renders; the culler asks without one. */
  enabled?: (camera?: THREE.Camera) => boolean;
  /** A name for the culler and the dev view (world/cull.ts: "puddles" gets its own occlusion). */
  name?: string;
  /**
   * Drawn every frame it is seen, outside the mirrors' budget, as big as before and with no margin (Steve,
   * 2026-09-28: the puddles at his feet showed an older picture lagging behind; the river's far water does not).
   */
  everyFrame?: boolean;
  /** Its own smallest thing, in pixels of its picture across (default mirrorBudget.minPx). */
  minPx?: number;
  /**
   * Things further than this (m) from its mirrored eye are left out by the culler (world/cull.ts). Its `far` alone
   * does not do it: the oblique near plane on the mirror's plane tilts the far plane away too.
   */
  reach?: number;
}

/**
 * M7 rendering: each mirror's pass, for the culler (world/cull.ts). Its camera is known once it
 * has drawn; `willRender` says whether it may draw this frame for an eye there.
 */
export interface MirrorPass {
  readonly name: string;
  readonly index: number;
  readonly planeY: number;
  readonly camera: THREE.Camera;
  /** How far it sees (m). */
  readonly far: number;
  /** One pixel of its picture, as a slope (2 tan(fov / 2) / height). */
  readonly pixel: number;
  /** Things under this many pixels of its picture across are left out (world/cull.ts). */
  readonly minPx: number;
  /** Things further than this from its mirrored eye are left out (world/cull.ts; Infinity: no limit). */
  readonly reach: number;
  willRender(eye: THREE.Vector3): boolean;
}
export const mirrorPasses: MirrorPass[] = [];

/** Dev: every mirror made, with the renderer that drew it last (read its picture in the console). */
export const mirrorsForDev: Array<{ planeY: number; rt: THREE.WebGLRenderTarget; renderer: THREE.WebGLRenderer | null; renders: number; calls: number; error: string; why: string; baseW: number; baseH: number; grow: number }> = [];
if (import.meta.env.DEV) Object.assign(window, { __mirrors: mirrorsForDev, __psx: psxUniforms });

/** The mirrors' own cameras: a mirror is not drawn again inside another mirror's picture. */
const mirrorCams = new WeakSet<THREE.Camera>();

/**
 * Mirrors drawn before the main pass, not inside it (2026-09-27, the quay stutter). three.js keeps one light setup
 * per nesting level of render(); a mirror drawn from its surface's onBeforeRender is one level down, so every lit
 * material met a "new" light setup twice a frame and looked its program up again (getParameters for each object:
 * 30+ ms a frame facing the quays). Drawn first at the top level, the mirror shares the main pass's light setup.
 * The picture is the same: the same cameras, the same frame (`mirrorsFirst` off draws them the old way, for a diff).
 */
export const mirrorsFirst = { on: true };
if (import.meta.env.DEV) Object.assign(window, { __mirrorsFirst: mirrorsFirst });
/**
 * Mirrors take turns (Steve, 2026-09-27, "1 for the mirror effects"): facing the river on the Rijnkaai the two
 * mirrors (the river, the puddles) each drew the town again every frame, 26 frames a second against 52 with them off.
 * Now each is drawn every second frame, one on the even frames, the other on the odd ones; in between the water reads
 * the picture of the frame before (with that frame's matrix, so the reflection stays where it was in the world). A
 * mirror is drawn at once when it was not drawn the frame before (it just came into view), when the eye moved more
 * than half a metre or turned more than 4 degrees, or when the plane moved more than 5 mm (the tide moves it a hair
 * every frame) or the lens changed: no stale picture after a
 * jump, and no edge of the old picture showing in a quick turn. `mirrorTurns.on` off draws every mirror every frame.
 */
export const mirrorTurns = { on: true };
if (import.meta.env.DEV) Object.assign(window, { __mirrorTurns: mirrorTurns });
const TURN_COS = Math.cos(THREE.MathUtils.degToRad(4));
/** Frames drawn with the mirrors first (drawMirrorsFirst): the mirrors' turns count them. */
let mirrorFrame = 0;
const firstPasses: Array<{ wish(camera: THREE.PerspectiveCamera, view: THREE.Frustum): number; draw(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void }> = [];
const viewFrustum = new THREE.Frustum();
const viewMatrix = new THREE.Matrix4();

/**
 * The mirrors' budget (2026-09-28, the slow frames; Steve: "do both", the picture may change a little). A mirror drew
 * the town a second time: ~10 ms a frame, and both mirrors in one frame whenever the eye turned. Now:
 *  - at most one mirror every `every` frames: the one waiting longest (a mirror seen for the first time, or after a
 *    jump, at once);
 *  - a mirror is drawn again when the eye moved or turned (as before) or after `maxAge` frames (moving people and
 *    boats in the water, at 15 pictures a second);
 *  - its picture is `margin` wider on every side than the view, so a picture a few frames old still covers the
 *    water after a turn (it is drawn `grow` times bigger, so its pixels stay as fine as before);
 *  - the culler leaves out of a mirror what is under `minPx` pixels of its picture across (world/cull.ts; was 0.25).
 * The puddles' mirror is not in the budget (MirrorOptions.everyFrame): Steve saw its older pictures lag at his feet.
 */
export const mirrorBudget = { maxAge: 4, every: 2, margin: THREE.MathUtils.degToRad(12), grow: 1.5, minPx: 2, everyFrame: true, everyMinPx: 2, reachOn: true };
if (import.meta.env.DEV) Object.assign(window, { __mirrorBudget: mirrorBudget });
/**
 * The culler's answer for the main view this frame (world/cull.ts sets it): a surface it hides there shows no
 * reflection, so a mirror whose every surface is hidden is not drawn (2026-09-28: the river mirror drew the whole
 * town on squares where the houses hide all water).
 */
export const mirrorView: { hiddenInMain: ((o: THREE.Object3D) => boolean) | null } = { hiddenInMain: null };
if (import.meta.env.DEV) Object.assign(window, { __mirrorView: mirrorView });
/** A mirror's wish to be drawn this frame: 0 not needed, else how urgent (MUST: now, whatever the others do). */
const MUST = 1000;
/** A mirror drawn every frame, outside the budget (MirrorOptions.everyFrame). */
const FREE = 2000;
const wishes: number[] = [];

/** Draw the mirror whose surface is in this camera's view and whose turn it is, before its main pass (retro/retroPass.ts). */
export function drawMirrorsFirst(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
  if (!mirrorsFirst.on || !(camera instanceof THREE.PerspectiveCamera) || mirrorCams.has(camera)) return;
  camera.updateWorldMatrix(true, false);
  viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  viewFrustum.setFromProjectionMatrix(viewMatrix);
  mirrorFrame++;
  let best = -1;
  let must = false;
  for (let i = 0; i < firstPasses.length; i++) {
    wishes[i] = firstPasses[i].wish(camera, viewFrustum);
    if (wishes[i] >= FREE) firstPasses[i].draw(renderer, scene, camera);
    else if (wishes[i] >= MUST) {
      firstPasses[i].draw(renderer, scene, camera);
      must = true;
    } else if (wishes[i] > 0 && (best < 0 || wishes[i] > wishes[best])) best = i;
  }
  if (must) lastBudgetDraw = mirrorFrame;
  else if (best >= 0 && mirrorFrame - lastBudgetDraw >= mirrorBudget.every) {
    firstPasses[best].draw(renderer, scene, camera);
    lastBudgetDraw = mirrorFrame;
  }
}
let lastBudgetDraw = -10;

/** Is this object shown (it and every parent visible)? */
function shown(o: THREE.Object3D): boolean {
  for (let x: THREE.Object3D | null = o; x; x = x.parent) if (!x.visible) return false;
  return true;
}
/** M7 character: is this camera a mirror's (the player's own body draws only there: player/body.ts)? */
export const isMirrorCamera = (cam: THREE.Camera): boolean => mirrorCams.has(cam);

/** Mirror pictures grow with the render height (settings): 1 = 320 x 180 at 270 lines. */
let mirrorScale = 1;
export function setMirrorScale(k: number): void {
  mirrorScale = Math.max(1, Math.min(4, k));
  for (const d of mirrorsForDev) d.rt.setSize(Math.round(d.baseW * mirrorScale * mirrorQuality * d.grow), Math.round(d.baseH * mirrorScale * mirrorQuality * d.grow));
}
/**
 * Menus (2026-09-26, graphics for weaker computers): "full" as before, "coarse" half the picture's size
 * each way, "off" no second drawing of the scene at all: the surfaces show the air's colour (the fog).
 */
let mirrorQuality = 1;
let mirrorsOff = false;
export function setMirrorQuality(q: "off" | "coarse" | "full"): void {
  mirrorsOff = q === "off";
  // (the puddles: dark water with reflections off, not a sheet of the air's colour)
  psxUniforms.uMirrorOn.value = mirrorsOff ? 0 : 1;
  mirrorQuality = q === "coarse" ? 0.5 : 1;
  setMirrorScale(mirrorScale);
}
if (import.meta.env.DEV) Object.assign(window, { __mirrorQuality: (q: "off" | "coarse" | "full") => setMirrorQuality(q) });
const offColour = new THREE.Color();

export function createMirror(plane0: number, opts: MirrorOptions = {}): Mirror {
  let planeY = plane0;
  const baseW = opts.width ?? 320;
  const baseH = opts.height ?? 180;
  // (drawn with a margin round the view: that much bigger, so its pixels stay as fine; mirrorBudget)
  const grow = opts.everyFrame ? 1 : mirrorBudget.grow;
  const rt = new THREE.WebGLRenderTarget(Math.round(baseW * mirrorScale * mirrorQuality * grow), Math.round(baseH * mirrorScale * mirrorQuality * grow), {
    magFilter: THREE.NearestFilter,
    minFilter: THREE.NearestFilter,
    depthBuffer: true,
    // the boats' hull caps write stencil here too (world/boats.ts), so mirrored water stays out of hulls
    stencilBuffer: true,
  });
  const cam = new THREE.PerspectiveCamera(75);
  cam.userData.pass = `mirror ${opts.name ?? mirrorPasses.length}`; // (dev: the draw audit's pass name)
  mirrorCams.add(cam);
  const index = mirrorPasses.length;
  mirrorPasses.push({
    name: opts.name ?? `mirror${index}`,
    index,
    get planeY() {
      return planeY;
    },
    camera: cam,
    get far() {
      return opts.far ?? 160;
    },
    get pixel() {
      return (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) / rt.height;
    },
    get reach() {
      return mirrorBudget.reachOn ? (opts.reach ?? Infinity) : Infinity;
    },
    get minPx() {
      return opts.minPx ?? (opts.everyFrame ? mirrorBudget.everyMinPx : mirrorBudget.minPx);
    },
    // (the great storm, uSea past 5.6: the water and the puddles mirror nothing (retro/psx.ts): no second drawing of the town)
    willRender: (eye) => !mirrorsOff && psxUniforms.uSea.value < 5.6 && (!opts.enabled || opts.enabled()) && eye.y > planeY + 0.02,
  });
  const matrix = new THREE.Matrix4();
  const plane = new THREE.Plane();
  const clip = new THREE.Vector4();
  const q = new THREE.Vector4();
  const eye = new THREE.Vector3();
  const look = new THREE.Vector3();
  const up = new THREE.Vector3();
  const rot = new THREE.Matrix4();
  const hidden: THREE.Object3D[] = [];
  const surfaces: THREE.Object3D[] = [];
  let busy = false;
  let drawn = false;
  /** The frame the first pass judged this mirror (mirrorBudget): its surfaces then keep the picture it has. */
  let judged = -1;
  // the last picture drawn: its frame, and the eye, look, plane and lens it was drawn for (mirrorTurns)
  let lastFrame = -10;
  let lastPlane = NaN;
  let lastFov = 0;
  const lastEye = new THREE.Vector3();
  const lastLook = new THREE.Vector3();
  const lookNow = new THREE.Vector3();
  const dev = { planeY, rt, baseW, baseH, grow, renderer: null as THREE.WebGLRenderer | null, renders: 0, calls: 0, error: "", why: "" };
  mirrorsForDev.push(dev);

  function render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, decided = false): void {
    dev.calls++;
    if (busy) return void (dev.why = "busy");
    if (!(camera instanceof THREE.PerspectiveCamera)) return void (dev.why = "camera " + camera.type);
    if (mirrorCams.has(camera)) return void (dev.why = "inside another mirror");
    if (opts.enabled && !opts.enabled(camera)) return void (dev.why = "disabled");
    if (mirrorsOff) {
      // menus: reflections off; the picture is the air's colour, once a frame (cheap: no scene drawn)
      if (drawn) return void (dev.why = "off");
      drawn = true;
      queueMicrotask(() => (drawn = false));
      const before = renderer.getRenderTarget();
      const alpha = renderer.getClearAlpha();
      renderer.getClearColor(offColour);
      const keep = offColour.getHex();
      const fog = (scene.fog as THREE.Fog | null)?.color;
      renderer.setClearColor(fog ?? offColour, 1);
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.setRenderTarget(before);
      renderer.setClearColor(keep, alpha);
      return void (dev.why = "off");
    }
    eye.setFromMatrixPosition(camera.matrixWorld);
    if (eye.y <= planeY + 0.02) return void (dev.why = "eye below " + eye.y.toFixed(2));
    // once per frame, however many surfaces use this mirror: a whole frame is drawn in
    // one go (one task), so the flag clears before the next frame
    if (drawn) return void (dev.why = "drawn this frame");
    drawn = true;
    queueMicrotask(() => (drawn = false));
    // its turn? (mirrorTurns) the other frame keeps the picture drawn the frame before
    lookNow.set(0, 0, -1).transformDirection(camera.matrixWorld);
    if (
      !decided &&
      mirrorTurns.on &&
      lastFrame === mirrorFrame - 1 &&
      (mirrorFrame + index) % 2 === 1 &&
      Math.abs(lastPlane - planeY) < 0.005 &&
      lastFov === camera.fov &&
      lastEye.distanceToSquared(eye) < 0.25 &&
      lastLook.dot(lookNow) > TURN_COS
    )
      return void (dev.why = "its turn next frame");
    lastFrame = mirrorFrame;
    lastPlane = planeY;
    lastFov = camera.fov;
    lastEye.copy(eye);
    lastLook.copy(lookNow);
    busy = true;
    // mirror the eye, the point it looks at, and its up in the plane
    rot.extractRotation(camera.matrixWorld);
    look.set(0, 0, -1).applyMatrix4(rot).add(eye);
    up.set(0, 1, 0).applyMatrix4(rot);
    cam.position.set(eye.x, 2 * planeY - eye.y, eye.z);
    cam.up.set(up.x, -up.y, up.z);
    cam.lookAt(look.x, 2 * planeY - look.y, look.z);
    cam.near = camera.near;
    cam.far = Math.min(camera.far, opts.far ?? 160);
    // wider than the view by the margin on every side (mirrorBudget): an older picture still covers a turn
    {
      const vh = THREE.MathUtils.degToRad(camera.fov / 2);
      const hh = Math.atan(Math.tan(vh) * camera.aspect);
      const m = decided && !opts.everyFrame ? mirrorBudget.margin : 0;
      cam.fov = THREE.MathUtils.radToDeg(2 * Math.min(1.45, vh + m));
      cam.aspect = Math.tan(Math.min(1.45, hh + m)) / Math.tan(Math.min(1.45, vh + m));
    }
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    // world point -> uv in the picture
    matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    matrix.multiply(cam.projectionMatrix);
    matrix.multiply(cam.matrixWorldInverse);
    // oblique near plane on the mirror plane
    plane.set(new THREE.Vector3(0, 1, 0), -planeY);
    plane.applyMatrix4(cam.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = cam.projectionMatrix.elements;
    q.x = (Math.sign(clip.x) + pm[8]) / pm[0];
    q.y = (Math.sign(clip.y) + pm[9]) / pm[5];
    q.z = -1.0;
    q.w = (1.0 + pm[10]) / pm[14];
    clip.multiplyScalar(2.0 / clip.dot(q));
    pm[2] = clip.x;
    pm[6] = clip.y;
    pm[10] = clip.z + 1.0;
    pm[14] = clip.w;

    const was = [...surfaces, ...hidden].map((o) => o.visible);
    for (const o of surfaces) o.visible = false;
    for (const o of hidden) o.visible = false;
    const before = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(scene, cam);
      dev.renderer = renderer;
      dev.renders++;
    } finally {
      renderer.setRenderTarget(before);
      [...surfaces, ...hidden].forEach((o, i) => (o.visible = was[i]));
      busy = false;
    }
  }

  // drawn first (see mirrorsFirst): when a surface of it is in the view; its surface's own call then finds it drawn
  // (mirrorBudget: each frame the mirrors say how much they want to be drawn; drawMirrorsFirst picks)
  firstPasses.push({
    wish(camera, view) {
      judged = mirrorFrame;
      if (drawn || busy) return 0;
      const hid = mirrorView.hiddenInMain;
      if (!surfaces.some((o) => shown(o) && !hid?.(o) && (o.frustumCulled === false || view.intersectsObject(o)))) return 0;
      if (opts.enabled && !opts.enabled(camera)) return 0;
      if (mirrorsOff || !mirrorTurns.on) return MUST;
      if (opts.everyFrame && mirrorBudget.everyFrame) return FREE;
      eye.setFromMatrixPosition(camera.matrixWorld);
      if (eye.y <= planeY + 0.02) return 0;
      const age = mirrorFrame - lastFrame;
      // never drawn, not for a while, a jump or a tide step: at once
      if (lastFrame < 0 || age > 12 || lastEye.distanceToSquared(eye) > 16 || Math.abs(lastPlane - planeY) > 0.05) return MUST;
      lookNow.set(0, 0, -1).transformDirection(camera.matrixWorld);
      const moved = Math.abs(lastPlane - planeY) >= 0.005 || lastFov !== camera.fov || lastEye.distanceToSquared(eye) >= 0.25 || lastLook.dot(lookNow) <= TURN_COS;
      return moved || age >= mirrorBudget.maxAge ? age : 0;
    },
    draw(renderer, scene, camera) {
      try {
        render(renderer, scene, camera, true);
      } catch (e) {
        dev.error = String((e as Error)?.stack ?? e).slice(0, 400);
        busy = false;
      }
    },
  });

  return {
    texture: rt.texture,
    matrix,
    attach(mesh) {
      surfaces.push(mesh);
      const prev = mesh.onBeforeRender;
      mesh.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
        try {
          if (!(mirrorsFirst.on && judged === mirrorFrame)) render(renderer, scene, camera);
        } catch (e) {
          dev.error = String((e as Error)?.stack ?? e).slice(0, 400);
          busy = false;
        }
        prev.call(this, renderer, scene, camera, geometry, material, group);
      };
    },
    hide(...objs) {
      hidden.push(...objs);
    },
    setPlane(y) {
      planeY = y;
      dev.planeY = y;
    },
    dispose() {
      rt.dispose();
    },
  };
}
