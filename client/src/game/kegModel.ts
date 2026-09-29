import * as THREE from "three";

// T5 beer (docs/milestones/T5-beer-coal.md): a keg of beer, 60 pints. One model wherever a keg shows (CLAUDE.md: one
// model per thing): the keg of clutter.glb (tools/blender/build_clutter.py keg(): the kegs by the back doors), and the
// same model by the brewery's door (world/tradeYards.ts) and in the arms of the brewery's man on a run (game/crowd.ts).
// world/clutter.ts hands the model over once clutter.glb is in (its geometry, its shared material: no new shader kind).

/** The keg: 0.52 m high, 0.2 m round (build_clutter.py barrel_at(0.2, 0.52)); it stands on its end, its foot at y = 0. */
export const KEG = { h: 0.52, r: 0.2 };

let geo: THREE.BufferGeometry | null = null;
let mat: THREE.Material | null = null;
const waiting: Array<() => void> = [];

/** world/clutter.ts: the keg of clutter.glb (its solid parts, foot at y = 0) and the clutter's solid material. */
export function setKegModel(g: THREE.BufferGeometry, m: THREE.Material): void {
  geo = g;
  mat = m;
  for (const f of waiting.splice(0)) f();
}

/** Call `f` with the keg model once it is in (at once when it is). */
export function onKegModel(f: (g: THREE.BufferGeometry, m: THREE.Material) => void): void {
  if (geo && mat) f(geo, mat);
  else waiting.push(() => f(geo!, mat!));
}

/** One keg to carry: a group (its foot at the origin) that holds the keg model as soon as it is in. */
export function kegMesh(): THREE.Group {
  const k = new THREE.Group();
  k.name = "keg";
  onKegModel((g, m) => k.add(new THREE.Mesh(g, m)));
  return k;
}
