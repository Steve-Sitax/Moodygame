import type * as THREE from "three";

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
/** Dev: off, every array uniform goes the three.js way again (the pixel diff). */
export const uniformCache = { on: true };
if (import.meta.env.DEV) Object.assign(window, { __uniformCache: uniformCache });

/** Patch the array uniforms of every program not seen yet (cheap: call it once a frame). */
export function cacheArrayUniforms(renderer: THREE.WebGLRenderer): void {
  const progs = renderer.info.programs as unknown as Array<{ getUniforms(): { seq: object[] } }> | null;
  if (!progs) return;
  for (const p of progs) {
    if (patched.has(p)) continue;
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
