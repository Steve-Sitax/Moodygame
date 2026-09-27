import * as THREE from "three";
import type { InWorld } from "./inworld";
import { autoBumpObject } from "./bumps";

// Shaders built before they are needed (2026-09-26, the stutter; docs/rendering.md).
//
// three.js builds a shader the first time it draws a material in a new setting (its lights, its
// fog, the colour space it draws into). On Windows (ANGLE on Direct3D 11) one build takes 0.1 to
// 0.4 s, and the game stood still for it: up to 2 s the first time a place came into view. So:
//  - every object is built in advance, in the setting it is drawn in: the street's scene with the
//    street's lights, each room's scene with the room's lights, and always into the retro target
//    (a render target draws in linear colour; the screen would be sRGB: a second, useless set);
//  - with compileAsync: the driver builds them side by side in the background, and the game does
//    not wait for them;
//  - again twice a second for whatever came since (the town, the market, the rooms of the houses,
//    a person gone indoors, a material given its texture late):
//    only the objects not seen before, so it costs next to nothing when nothing changed.

/** Something compile() can walk: a list of objects, without taking them out of their scene. */
function bag(list: THREE.Object3D[]): THREE.Object3D {
  const o = new THREE.Object3D();
  o.traverse = (fn) => {
    for (const x of list) fn(x);
  };
  return o;
}

type Drawn = THREE.Mesh | THREE.Points | THREE.Line | THREE.Sprite;

/**
 * What of an object its shader depends on and may change after it is made: its material (and that
 * material's version: needsUpdate after a new map), per-instance colours added later, vertex colours.
 */
/** A material's version as the warm-up sees it: its own compile's bump (three.js, two-sided see-through) is no change. */
const ownBump = new WeakMap<THREE.Material, { from: number; to: number }>();
function versionOf(m: THREE.Material): number {
  const b = ownBump.get(m);
  return b && b.from === m.version ? b.to : m.version;
}
const materialsOf = (o: Drawn): THREE.Material[] => (Array.isArray(o.material) ? o.material : [o.material]);

function signature(o: Drawn): number {
  let v = 0;
  for (const m of materialsOf(o)) v = v * 31 + versionOf(m);
  const im = o as unknown as THREE.InstancedMesh;
  return v * 4 + (im.isInstancedMesh && im.instanceColor ? 2 : 0) + (o.geometry?.attributes?.color ? 1 : 0);
}

/**
 * Flat decals (stains, marks, signs: materials named "...decal") drawn in one pass. three.js draws a see-through
 * two-sided material twice (back faces, then front) and marks it changed for each half, every frame: every object
 * with it had its program looked up again in every pass, and the warm-up built it again twice a second
 * (2026-09-27, the quay stutter). A flat decal's back and front never overlap on screen: the same picture (proven
 * with a pixel diff in four views).
 */
function singlePassDecals(o: Drawn): void {
  for (const m of materialsOf(o)) if (m.transparent && m.side === THREE.DoubleSide && !m.forceSinglePass && m.name.endsWith("decal")) m.forceSinglePass = true;
}

export class ShaderWarmer {
  /** What each object was built as, and in which scene (a person who goes indoors is built again for the room's lights). */
  private readonly seen = new WeakMap<THREE.Object3D, { scene: THREE.Scene; material: THREE.Material | THREE.Material[]; sig: number }>();
  /** Warm-ups whose shaders are still being built. */
  pending = 0;
  stats = { runs: 0, objects: 0, lastSyncMs: 0, lastReadyMs: 0 };

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    /** The target the game draws into (retro/retroPass.ts). */
    private readonly target: () => THREE.WebGLRenderTarget,
    private readonly inWorld: InWorld,
  ) {}

  private fresh(scene: THREE.Scene): THREE.Object3D[] {
    const list: THREE.Object3D[] = [];
    scene.traverse((o) => {
      const d = o as Drawn;
      if (!((d as THREE.Mesh).isMesh || (d as THREE.Points).isPoints || (d as THREE.Line).isLine || (d as THREE.Sprite).isSprite) || !d.material) return;
      const sig = signature(d);
      const was = this.seen.get(o);
      if (was && was.scene === scene && was.material === d.material && was.sig === sig) return;
      if (was) {
        was.scene = scene;
        was.material = d.material;
        was.sig = sig;
      } else this.seen.set(o, { scene, material: d.material, sig });
      // (the bump audit, 2026-09-26: a flat picture gets its bump before its shader is built, world/bumps.ts; the
      // signature again, as a bump map given here is part of it)
      autoBumpObject(o);
      singlePassDecals(d);
      this.seen.get(o)!.sig = signature(d);
      list.push(o);
    });
    return list;
  }

  /** Build the shaders of every object not built yet, in the street and in every room; resolves when they are ready. */
  warm(): Promise<void> {
    const t0 = performance.now();
    const jobs: Array<Promise<unknown>> = [];
    let objects = 0;
    const keep = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target());
    try {
      const add = (scene: THREE.Scene) => {
        const list = this.fresh(scene);
        if (!list.length) return;
        objects += list.length;
        const before = new Map<THREE.Material, number>();
        for (const o of list) for (const m of materialsOf(o as Drawn)) before.set(m, versionOf(m));
        jobs.push(this.renderer.compileAsync(bag(list), this.camera, scene));
        // compiling a see-through two-sided material bumps its version (three.js builds both sides: needsUpdate
        // twice). That bump is the warm-up's own, not a change: every object with the material (in this list or
        // not) keeps the version it was signed with, or the next run builds them again, twice a second, forever
        // (2026-09-27, the quay stutter: the decals' programs looked up again in every pass)
        for (const [m, v] of before) if (m.version !== v) ownBump.set(m, { from: m.version, to: v });
      };
      add(this.scene);
      for (const r of this.inWorld.all) {
        // the room's lights as it is drawn: its lamps filled up to the fixed count (world/inworld.ts)
        this.inWorld.evenLights(r);
        add(r.scene);
      }
    } finally {
      this.renderer.setRenderTarget(keep);
    }
    if (!jobs.length) return Promise.resolve();
    this.stats.runs++;
    this.stats.objects += objects;
    this.stats.lastSyncMs = +(performance.now() - t0).toFixed(1);
    this.pending++;
    return Promise.all(jobs)
      .then(() => {
        this.stats.lastReadyMs = +(performance.now() - t0).toFixed(0);
      })
      .finally(() => this.pending--);
  }
}
