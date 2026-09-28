import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Still parts drawn as one (2026-09-28, draw calls). Code-made models are often many small meshes with the same
// material under one parent: the six iron straps of a door leaf, the frame of a lantern, the legs of a bench. Each
// is a draw call of its own (~2 us of CPU each in three.js, in the main view and again in every mirror), and a node
// the culler and three.js walk every frame. mergeParts() bakes such siblings into one mesh per material, in the
// parent's frame, so a door leaf still turns on its hinge and a bench still stands where its group stands.
// Only for parts that never move, hide or change on their own: the caller says which (pick). The material is the
// same object, so nothing about the shaders changes (no new shader kinds). Checked with
// __scheldemist.pixelDiff("merge") (the same moment drawn with the parts and with the merged meshes).
// The same parts in the same places (every bollard, every lantern, the sacks of every cart of a kind) share one
// merged geometry: no new buffers for each copy. (Rooms have their own merge of their still things: rooms.ts.)

/**
 * Off until Steve says yes (2026-09-28): the pixel diff, once it read the picture right, showed merged parts do not draw
 * to the bit (a corner snapped to the PS1 grid through a slightly different sum lands a pixel over now and then:
 * ~370 pixels at the Rijnkaai, 1-pixel edges on the bollards). ~0.4 ms a frame. `?merge` in the URL turns it on (dev).
 */
const MERGE_AT_BUILD = import.meta.env.DEV && typeof location !== "undefined" && new URLSearchParams(location.search).has("merge");

/** Merged geometries by their parts (geometries and places): copies share one. */
const cache = new Map<string, THREE.BufferGeometry>();

/** Dev: the parts each merged geometry was made of (a merged mesh may be cloned: a boat's sacks, a lamp). */
const partsOf = new WeakMap<THREE.BufferGeometry, THREE.Mesh[]>();
/** Merges made, and the draws they save per copy. */
let merges = 0;
let savedEach = 0;
let mergedOn = true;
/** Dev: the merged meshes swapped for their parts while `on` is false. */
const swapped: Array<{ parent: THREE.Object3D; merged: THREE.Mesh; parts: THREE.Mesh[] }> = [];

export const staticMerge = {
  /** The scenes the dev switch looks in (main.ts: the street and the rooms). */
  roots: (): THREE.Object3D[] => [],
  get on(): boolean {
    return mergedOn;
  },
  /**
   * Dev: false puts the separate parts back in place of every merged mesh in `roots` (copies too), true merges
   * again: the A/B timing and the pixel diff.
   */
  set on(v: boolean) {
    if (v === mergedOn || !import.meta.env.DEV) return;
    mergedOn = v;
    if (!v) {
      const found: THREE.Mesh[] = [];
      for (const r of this.roots()) r.traverse((o) => void ((o as THREE.Mesh).isMesh && partsOf.has((o as THREE.Mesh).geometry) && found.push(o as THREE.Mesh)));
      for (const m of found) {
        const parent = m.parent!;
        // (a shared merged geometry: its parts with this mesh's own material)
        const parts = partsOf.get(m.geometry)!.map((p) => {
          const c = p.clone();
          c.material = m.material;
          return c;
        });
        parent.remove(m);
        for (const p of parts) parent.add(p);
        swapped.push({ parent, merged: m, parts });
      }
    } else {
      for (const e of swapped) {
        for (const p of e.parts) e.parent.remove(p);
        e.parent.add(e.merged);
      }
      swapped.length = 0;
    }
  },
  info(): { merges: number; savedPerCopy: number; on: boolean; swapped: number } {
    return { merges, savedPerCopy: savedEach, on: mergedOn, swapped: swapped.length };
  },
};
if (import.meta.env.DEV && typeof window !== "undefined") Object.assign(window, { __staticMerge: staticMerge });

/** Dev: materials made shared (one for many things that each had their own with the same settings). */
const sharedMats = new WeakSet<THREE.Material>();
let shareOn = true;
const unshared: Array<{ mesh: THREE.Mesh; mat: THREE.Material }> = [];

/** Mark a material as shared by many things (returns it): the dev switch below can give each its own copy again. */
export function sharedMaterial<T extends THREE.Material>(m: T): T {
  if (import.meta.env.DEV) sharedMats.add(m);
  return m;
}

export const materialShare = {
  get on(): boolean {
    return shareOn;
  },
  /** Dev: false gives every mesh of a shared material its own copy (as before the sharing): the A/B and the pixel diff. */
  set on(v: boolean) {
    if (v === shareOn || !import.meta.env.DEV) return;
    shareOn = v;
    if (!v) {
      for (const r of staticMerge.roots())
        r.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh || Array.isArray(m.material) || !sharedMats.has(m.material)) return;
          const orig = m.material;
          const c = orig.clone();
          c.onBeforeCompile = orig.onBeforeCompile;
          c.customProgramCacheKey = orig.customProgramCacheKey;
          m.material = c;
          unshared.push({ mesh: m, mat: orig });
        });
    } else {
      for (const u of unshared) {
        (u.mesh.material as THREE.Material).dispose();
        u.mesh.material = u.mat;
      }
      unshared.length = 0;
    }
  },
};
if (import.meta.env.DEV && typeof window !== "undefined") Object.assign(window, { __materialShare: materialShare });

const defaultBeforeRender = THREE.Object3D.prototype.onBeforeRender;

/** The attributes' layout: only geometries with the same one merge. */
function layout(g: THREE.BufferGeometry): string {
  const a = g.attributes;
  let s = g.index ? "i" : "n";
  for (const k of Object.keys(a).sort()) {
    const b = a[k] as THREE.BufferAttribute;
    if ((b as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) return "";
    s += `|${k}:${b.itemSize}:${b.normalized ? 1 : 0}:${(b.array as ArrayLike<number>).constructor.name}`;
  }
  return s;
}

function eligible(o: THREE.Object3D, tagged: boolean): o is THREE.Mesh {
  const m = o as THREE.Mesh & { isSkinnedMesh?: boolean; isInstancedMesh?: boolean; isBatchedMesh?: boolean };
  if (!m.isMesh || m.isSkinnedMesh || m.isInstancedMesh || m.isBatchedMesh) return false;
  if (m.children.length || !m.visible || Array.isArray(m.material)) return false;
  if (m.onBeforeRender !== defaultBeforeRender || m.layers.mask !== 1) return false;
  // a tagged mesh is looked for by something (a clock's live hands, a sign for the sign check): left alone unless asked
  if (m.userData.liveClock || (!tagged && Object.keys(m.userData).length)) return false;
  const g = m.geometry;
  // (a geometry's groups count only with a material list: one material draws it whole)
  if (!g || g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return false;
  if (Object.keys(g.morphAttributes).length) return false;
  if (!g.attributes.position) return false;
  // a mirrored part turns its faces inside out once baked (three.js flips the winding by the matrix)
  m.updateMatrix();
  if (m.matrix.determinant() <= 0) return false;
  return true;
}

/**
 * Merge the still meshes among `parent`'s own children that share a material (and the rest of their draw settings)
 * into one mesh each. `pick` says which children may be merged (default: every eligible one). Returns the draws
 * saved. Call it when the parent is built, before its first frame.
 */
export function mergeParts(parent: THREE.Object3D, pick: (m: THREE.Mesh) => boolean = () => true, opts: { tagged?: boolean } = {}): number {
  if (!MERGE_AT_BUILD) return 0;
  const groups = new Map<string, THREE.Mesh[]>();
  for (const c of parent.children) {
    if (!eligible(c, !!opts.tagged) || !pick(c)) continue;
    const lay = layout(c.geometry);
    if (!lay) continue;
    const mat = c.material as THREE.Material;
    const key = `${mat.uuid}|${lay}|${c.castShadow ? 1 : 0}${c.receiveShadow ? 1 : 0}${c.frustumCulled ? 1 : 0}|${c.renderOrder}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(c);
  }
  let saved = 0;
  for (const parts of groups.values()) {
    if (parts.length < 2) continue;
    const ck = parts.map((p) => `${p.geometry.uuid}@${p.matrix.elements.join(",")}`).join(";");
    let merged = cache.get(ck) ?? null;
    if (!merged) {
      const geos = parts.map((p) => {
        const g = p.geometry.clone();
        g.applyMatrix4(p.matrix);
        return g;
      });
      merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      cache.set(ck, merged);
      if (import.meta.env.DEV) partsOf.set(merged, parts);
    }
    const first = parts[0];
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.name = `${first.name || parent.name || "parts"}:merged`;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.frustumCulled = first.frustumCulled;
    mesh.renderOrder = first.renderOrder;
    for (const p of parts) parent.remove(p);
    parent.add(mesh);
    merges++;
    savedEach += parts.length - 1;
    saved += parts.length - 1;
  }
  return saved;
}

/** mergeParts on `root` and every group under it (not into meshes' children). */
export function mergePartsTree(root: THREE.Object3D, pick: (m: THREE.Mesh) => boolean = () => true): number {
  let saved = 0;
  const parents: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh && o.children.length > 1) parents.push(o);
  });
  for (const p of parents) saved += mergeParts(p, pick);
  return saved;
}
