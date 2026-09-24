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
  enabled?: () => boolean;
  /** A name for the culler and the dev view (world/cull.ts: "puddles" gets its own occlusion). */
  name?: string;
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
  willRender(eye: THREE.Vector3): boolean;
}
export const mirrorPasses: MirrorPass[] = [];

/** Dev: every mirror made, with the renderer that drew it last (read its picture in the console). */
export const mirrorsForDev: Array<{ planeY: number; rt: THREE.WebGLRenderTarget; renderer: THREE.WebGLRenderer | null; renders: number; calls: number; error: string; why: string; baseW: number; baseH: number }> = [];
if (import.meta.env.DEV) Object.assign(window, { __mirrors: mirrorsForDev, __psx: psxUniforms });

/** The mirrors' own cameras: a mirror is not drawn again inside another mirror's picture. */
const mirrorCams = new WeakSet<THREE.Camera>();

/** Mirror pictures grow with the render height (settings): 1 = 320 x 180 at 270 lines. */
let mirrorScale = 1;
export function setMirrorScale(k: number): void {
  mirrorScale = Math.max(1, Math.min(4, k));
  for (const d of mirrorsForDev) d.rt.setSize(Math.round(d.baseW * mirrorScale), Math.round(d.baseH * mirrorScale));
}

export function createMirror(plane0: number, opts: MirrorOptions = {}): Mirror {
  let planeY = plane0;
  const baseW = opts.width ?? 320;
  const baseH = opts.height ?? 180;
  const rt = new THREE.WebGLRenderTarget(Math.round(baseW * mirrorScale), Math.round(baseH * mirrorScale), {
    magFilter: THREE.NearestFilter,
    minFilter: THREE.NearestFilter,
    depthBuffer: true,
    // the boats' hull caps write stencil here too (world/boats.ts), so mirrored water stays out of hulls
    stencilBuffer: true,
  });
  const cam = new THREE.PerspectiveCamera(75);
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
    willRender: (eye) => (!opts.enabled || opts.enabled()) && eye.y > planeY + 0.02,
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
  const dev = { planeY, rt, baseW, baseH, renderer: null as THREE.WebGLRenderer | null, renders: 0, calls: 0, error: "", why: "" };
  mirrorsForDev.push(dev);

  function render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    dev.calls++;
    if (busy) return void (dev.why = "busy");
    if (!(camera instanceof THREE.PerspectiveCamera)) return void (dev.why = "camera " + camera.type);
    if (mirrorCams.has(camera)) return void (dev.why = "inside another mirror");
    if (opts.enabled && !opts.enabled()) return void (dev.why = "disabled");
    eye.setFromMatrixPosition(camera.matrixWorld);
    if (eye.y <= planeY + 0.02) return void (dev.why = "eye below " + eye.y.toFixed(2));
    // once per frame, however many surfaces use this mirror: a whole frame is drawn in
    // one go (one task), so the flag clears before the next frame
    if (drawn) return void (dev.why = "drawn this frame");
    drawn = true;
    queueMicrotask(() => (drawn = false));
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
    cam.fov = camera.fov;
    cam.aspect = camera.aspect;
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

  return {
    texture: rt.texture,
    matrix,
    attach(mesh) {
      surfaces.push(mesh);
      const prev = mesh.onBeforeRender;
      mesh.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
        try {
          render(renderer, scene, camera);
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
