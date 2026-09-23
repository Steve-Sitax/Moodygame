import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { psx } from "../retro/psx";

// The people of 1873 as rigged, textured low-poly models (tools/blender/build_people.py,
// client/public/models/people.glb). Loaded once; each person is a clone with its own
// skeleton and animation mixer. If the file does not load, callers keep their
// grey-box stand-ins.

export type HumanKind = "sooi" | "peeters" | "tuur" | "fientje" | "sailor" | "stranger" | "thief" | "foreman" | "recipient";
export type Motion = "idle" | "walk" | "talk" | "fold" | "carry";

const WOMEN = new Set<HumanKind>(["peeters", "fientje"]);

interface Template {
  roots: Map<string, THREE.Object3D>;
  clips: Map<string, THREE.AnimationClip>;
}

let template: Template | null = null;
let loading: Promise<Template | null> | null = null;

/** glTF gives repeated node names a suffix ("hips_3"); every skeleton uses the same bone names. */
const baseName = (n: string) => n.replace(/_\d+$/, "");

function load(): Promise<Template | null> {
  if (loading) return loading;
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  const loader = new GLTFLoader().setDRACOLoader(draco);
  loading = loader
    .loadAsync("/models/people.glb")
    .then((gltf) => {
      const mats = new Map<THREE.Material, THREE.Material>();
      const roots = new Map<string, THREE.Object3D>();
      for (const root of [...gltf.scene.children]) {
        root.traverse((o) => {
          if ((o as THREE.Bone).isBone) o.name = baseName(o.name);
          const m = o as THREE.SkinnedMesh;
          if (!m.isMesh) return;
          const old = m.material as THREE.MeshStandardMaterial;
          let mat = mats.get(old);
          if (!mat) {
            const map = old.map;
            if (map) {
              map.colorSpace = THREE.SRGBColorSpace;
              map.magFilter = THREE.NearestFilter;
              map.minFilter = THREE.NearestFilter;
              map.generateMipmaps = false;
              map.needsUpdate = true;
            }
            // double-sided: skirts, coat tails and bonnets are open shells
            mat = psx(new THREE.MeshLambertMaterial({ map, side: THREE.DoubleSide }));
            mats.set(old, mat);
            old.dispose();
          }
          m.material = mat;
          m.frustumCulled = false; // bounds of a skinned mesh follow the pose, not the bind shape
        });
        root.removeFromParent();
        root.position.set(0, 0, 0);
        roots.set(root.name, root);
      }
      // rotations only: the skeletons differ in size, so bone positions stay each body's own
      const clips = new Map<string, THREE.AnimationClip>();
      for (const clip of gltf.animations) {
        const tracks = clip.tracks
          .filter((t) => t.name.endsWith(".quaternion"))
          .map((t) => {
            const c = t.clone();
            c.name = `${baseName(t.name.slice(0, -".quaternion".length))}.quaternion`;
            return c;
          });
        clips.set(clip.name, new THREE.AnimationClip(clip.name, -1, tracks));
      }
      draco.dispose();
      template = { roots, clips };
      return template;
    })
    .catch((err: unknown) => {
      console.warn("people.glb did not load; the grey-box people stay", err);
      draco.dispose();
      return null;
    });
  return loading;
}

/** Run `cb` once the models are in (right away if they already are). Never runs if loading failed. */
export function whenHumans(cb: () => void): void {
  if (template) cb();
  else
    load().then((t) => {
      if (t) cb();
    });
}

/** A new person of this kind, or null while the models are not loaded. */
export function makeHuman(kind: HumanKind): Human | null {
  if (!template) {
    load();
    return null;
  }
  const src = template.roots.get(kind);
  return src ? new Human(kind, src, template.clips) : null;
}

export class Human {
  readonly root: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<Motion, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  motion: Motion | null = null;

  constructor(
    readonly kind: HumanKind,
    src: THREE.Object3D,
    clips: Map<string, THREE.AnimationClip>,
  ) {
    this.root = cloneSkinned(src);
    this.mixer = new THREE.AnimationMixer(this.root);
    const woman = WOMEN.has(kind);
    for (const m of ["idle", "walk", "talk", "fold", "carry"] as Motion[]) {
      const clip = (woman && clips.get(`${m}_f`)) || clips.get(m);
      if (clip) this.actions.set(m, this.mixer.clipAction(clip));
    }
    this.play("idle", 0);
    // not everyone breathes in step
    if (this.current) this.current.time = Math.random() * this.current.getClip().duration;
  }

  play(m: Motion, fade = 0.3): void {
    if (this.motion === m) return;
    const next = this.actions.get(m) ?? this.actions.get("idle");
    if (!next) return;
    this.motion = m;
    if (next === this.current) return;
    next.reset().setEffectiveWeight(1).play();
    if (this.current && fade > 0) this.current.crossFadeTo(next, fade, false);
    else this.current?.stop();
    this.current = next;
  }

  /** Walk clips cover 1.2 m per loop; match the feet to the ground speed. */
  setPace(speed: number): void {
    for (const m of ["walk", "carry"] as Motion[]) this.actions.get(m)?.setEffectiveTimeScale(Math.max(0.3, speed / 1.2));
  }

  /** How far the hips dip below standing height right now (walking only). */
  bob(): number {
    if (this.motion !== "walk" && this.motion !== "carry") return 0;
    const a = this.current!;
    const p = (a.time / a.getClip().duration) * Math.PI * 2;
    return -(WOMEN.has(this.kind) ? 0.035 : 0.05) * Math.cos(p) ** 2;
  }

  /** Seconds in one loop of what is playing now. */
  get loopTime(): number {
    return this.current?.getClip().duration ?? 1;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.root.removeFromParent();
  }
}
