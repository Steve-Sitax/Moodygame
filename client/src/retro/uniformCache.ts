import type * as THREE from "three";
import { psxUniforms } from "./psx";

// Array uniforms sent only when they change (2026-09-28, the slow frames). three.js r186 sends an array uniform
// (vec4 u[48]: the light spill's four lists, the lamps) again every time a material is set up, with no check
// whether that program has it already: ~3,000 uniform4fv calls a frame, each list copied first. A program keeps
// its uniforms, so an upload of the values it already holds changes nothing: this keeps a copy per program and
// uniform and sends only when a value differs. The picture is the same to the bit.

const VEC3 = 0x8b51;
const VEC4 = 0x8b52;

interface ArrayUniform {
  id: string;
  addr: WebGLUniformLocation;
  size: number;
  type: number;
  setValue: (gl: WebGL2RenderingContext, v: unknown, textures?: unknown) => void;
}

const patched = new WeakSet<object>();
/**
 * Dev: `on` off, every array uniform goes the three.js way again; `globals` off, the shared psx uniforms are sent at
 * every material switch again (the pixel diff); `ready` off, a program still being built is patched at once (the
 * frames of issue #7, to compare).
 */
export const uniformCache = { on: true, globals: true, ready: true };
if (import.meta.env.DEV) Object.assign(window, { __uniformCache: uniformCache });

/** Patch the array uniforms of every program not seen yet (cheap: call it once a frame). */
export function cacheArrayUniforms(renderer: THREE.WebGLRenderer): void {
  const progs = renderer.info.programs as unknown as Array<{ getUniforms(): { seq: object[] }; isReady(): boolean }> | null;
  if (!progs) return;
  if (!installed && progs.length && (!uniformCache.ready || progs[0].isReady())) installGlobals(renderer, progs[0].getUniforms().constructor as unknown as UniformsClass);
  for (const p of progs) {
    if (patched.has(p)) continue;
    // (issue #7: a program the warm-up is still building waits here. Asking for its uniforms waits for the driver's
    // link: 0.3 to 1.2 s frames after a jump, in every frame that came before the build was done. isReady() asks
    // without waiting; the program is patched in the first frame after it is ready. A draw that uses it earlier
    // sends its lists the three.js way: the same picture)
    if (uniformCache.ready && !p.isReady()) continue;
    patched.add(p);
    for (const s of p.getUniforms().seq) {
      const u = s as ArrayUniform;
      if (typeof u.size === "number" && u.size > 1 && (u.type === VEC4 || u.type === VEC3)) patch(u);
    }
  }
}

function patch(u: ArrayUniform): void {
  const comps = u.type === VEC4 ? 4 : 3;
  const n = u.size * comps;
  let snap: Float32Array | null = null;
  const orig = u.setValue;
  u.setValue = function (gl: WebGL2RenderingContext, v: unknown, textures?: unknown) {
    // (a list of something else than numbers or vectors, a Color list: three.js's own way, for good)
    const e0 = (v as ArrayLike<unknown>)[0];
    if (typeof e0 !== "number" && (typeof e0 !== "object" || e0 === null || !("x" in e0))) {
      u.setValue = orig;
      return orig.call(this, gl, v, textures);
    }
    if (!uniformCache.on) {
      snap = null;
      return orig.call(this, gl, v, textures);
    }
    const first = !snap;
    if (!snap) snap = new Float32Array(n);
    let same = !first;
    const a = v as ArrayLike<number> & ArrayLike<{ x: number; y: number; z: number; w?: number }>;
    if (typeof a[0] === "number") {
      const m = Math.min(n, a.length);
      for (let i = 0; i < m; i++) {
        const x = Math.fround(a[i] as number);
        if (snap[i] !== x) {
          snap[i] = x;
          same = false;
        }
      }
    } else {
      const m = Math.min(u.size, a.length);
      for (let k = 0, o = 0; k < m; k++, o += comps) {
        const e = a[k] as { x: number; y: number; z: number; w?: number };
        const x = Math.fround(e.x);
        const y = Math.fround(e.y);
        const z = Math.fround(e.z);
        if (snap[o] !== x || snap[o + 1] !== y || snap[o + 2] !== z) {
          snap[o] = x;
          snap[o + 1] = y;
          snap[o + 2] = z;
          same = false;
        }
        if (comps === 4) {
          const w = Math.fround(e.w ?? 0);
          if (snap[o + 3] !== w) {
            snap[o + 3] = w;
            same = false;
          }
        }
      }
    }
    if (same) return;
    if (comps === 4) gl.uniform4fv(u.addr, snap);
    else gl.uniform3fv(u.addr, snap);
  };
}

// ---- the shared psx uniforms once per program and render call (2026-09-28, the slow frames)
// three.js sends every uniform of a material again at each material switch (~630 a frame, ~40 uniforms each). About
// half of a psx material's are the same objects for every material (psxUniforms: the lamps, the rain, the fog's
// glow, the time ...), set before a render call and not during it. A program keeps its uniforms, so within one render
// call each program needs them once: this counts the render calls and sends a shared uniform to a program only when
// that program has not had that very object in this call. Textures always go (they bind a texture unit, not a
// program's state). The picture is the same to the bit (pixelDiff("globals")).

interface UniformsClass {
  upload(gl: WebGL2RenderingContext, seq: Uploaded[], values: Record<string, { value: unknown; needsUpdate?: boolean }>, textures: unknown): void;
}
interface Uploaded {
  id: string;
  type?: number;
  setValue(gl: WebGL2RenderingContext, v: unknown, textures: unknown): void;
  __gv?: number;
  __go?: object;
}
/** Uniform types that only set a program's value (no texture unit): floats, ints, bools, vectors, matrices. */
const PLAIN = new Set([0x1406, 0x8b50, 0x8b51, 0x8b52, 0x8b5a, 0x8b5b, 0x8b5c, 0x1404, 0x8b56, 0x8b53, 0x8b54, 0x8b55, 0x8b57, 0x8b58, 0x8b59, 0x1405, 0x8dc6, 0x8dc7, 0x8dc8]);
const globals = new Set<object>(Object.values(psxUniforms));
let installed = false;
let call = 0;

function installGlobals(renderer: THREE.WebGLRenderer, U: UniformsClass): void {
  installed = true;
  const render = renderer.render.bind(renderer);
  renderer.render = (scene, camera) => {
    call++;
    render(scene, camera);
    call++;
  };
  const upload = U.upload;
  U.upload = function (gl, seq, values, textures) {
    if (!uniformCache.globals) return upload.call(this, gl, seq, values, textures);
    for (let i = 0, n = seq.length; i !== n; ++i) {
      const u = seq[i];
      const v = values[u.id];
      if (v.needsUpdate === false) continue;
      if (globals.has(v) && u.type !== undefined && PLAIN.has(u.type)) {
        if (u.__gv === call && u.__go === v) continue;
        u.__gv = call;
        u.__go = v;
      }
      u.setValue(gl, v.value, textures);
    }
  };
}
