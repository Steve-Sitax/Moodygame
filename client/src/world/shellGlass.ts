import * as THREE from "three";

// Issue #10 (interiors are real): the painted glass of a shell's real windows handed to the room behind it. A shell
// whose windows are painted in an atlas (the cathedral, the churches) keeps its old panes, with their atlas uv, in a
// mesh of their own ("<name>_lit_glass", material "<atlas>_lit") that the street never draws (world/landmarkWindows.ts
// lights a copy of it at night). The shell's loader publishes that mesh here; the room (built earlier, at the start)
// takes a copy of its geometry as its own glass: the same picture, see-through a little, drawn in the room's scene, so
// the room shows from the street and the street from inside. World coordinates: add the glass to the room's scene,
// not to its turned group.

const meshes = new Map<string, THREE.Mesh>();
const waiting = new Map<string, Array<(m: THREE.Mesh) => void>>();

/** A shell's loader: its lit glass is in (world coordinates, its matrix applied). */
export function publishShellGlass(key: string, mesh: THREE.Mesh): void {
  meshes.set(key, mesh);
  for (const cb of waiting.get(key) ?? []) cb(mesh);
  waiting.delete(key);
}

/** A room: call back when the shell's lit glass is in (at once if it is). */
export function whenShellGlass(key: string, cb: (mesh: THREE.Mesh) => void): void {
  const m = meshes.get(key);
  if (m) cb(m);
  else waiting.set(key, [...(waiting.get(key) ?? []), cb]);
}

/**
 * The room's glass from the shell's lit glass: the same triangles and uv (world coordinates) with a see-through copy
 * of its picture. The material is one the prison's chapel already draws with (MeshBasic, a map, see-through, both
 * sides): no new shader kind. The panes lie where the shell's reveals end, behind its tracery: the room's lining
 * starts there (world/realOpenings.ts lining).
 */
export function roomGlassFrom(src: THREE.Mesh, opts: { name: string; opacity?: number; color?: number }): THREE.Mesh {
  const g = src.geometry.clone();
  src.updateWorldMatrix(true, false);
  g.applyMatrix4(src.matrixWorld);
  for (const n of Object.keys(g.attributes)) if (!["position", "uv", "normal"].includes(n)) g.deleteAttribute(n);
  const srcMat = (Array.isArray(src.material) ? src.material[0] : src.material) as THREE.MeshBasicMaterial | THREE.MeshLambertMaterial;
  const mat = new THREE.MeshBasicMaterial({ map: srcMat.map ?? null, color: opts.color ?? 0x9a9e98, transparent: true, opacity: opts.opacity ?? 0.85, depthWrite: false, side: THREE.DoubleSide });
  mat.name = `${opts.name}_glass`;
  const m = new THREE.Mesh(g, mat);
  m.name = `${opts.name}_glass`;
  m.userData.glass = true;
  m.renderOrder = 5;
  g.computeBoundingSphere();
  return m;
}
