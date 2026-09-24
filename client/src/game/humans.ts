import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { psx } from "../retro/psx";

// The people of 1873 as rigged, textured low-poly models (tools/blender/build_people.py,
// client/public/models/people.glb). Loaded once; each person is a clone with its own
// skeleton and animation mixer. If the file does not load, callers keep their
// grey-box stand-ins.

export type HumanKind =
  | "sooi" | "peeters" | "tuur" | "fientje" | "sailor" | "stranger" | "thief" | "foreman" | "recipient"
  // the crowd (crowd.ts)
  | "docker_a" | "docker_b" | "docker_c" | "docker_sack" | "porter" | "carter" | "fishwife_a" | "fishwife_b" | "maid"
  | "boy" | "girl" | "gentleman" | "priest" | "police" | "sailor_b"
  // the town's residents (M3e)
  | "baker" | "shopkeeper" | "publican" | "clerk" | "old_man" | "beggar" | "wife_a" | "wife_b" | "shopwife" | "old_woman" | "urchin" | "girl_b"
  // the garrison and the customs (server town/garrison.ts): a soldier of the line walking out,
  // a corporal, a sentry with his rifle at the shoulder, a customs officer with his book
  | "soldier" | "soldier_b" | "sentry" | "customs"
  // M6 lively (server town/lively.ts): the milk woman, the baker's boy, the street sellers, a Black
  // Sister, a beguine, the English travellers
  | "milk_woman" | "baker_boy" | "grinder" | "ragman" | "coalman" | "sweep" | "sweep_boy" | "nun" | "beguine" | "tourist" | "tourist_lady";
/**
 * sit: on a crate (lower the body by sitDrop); behind: hands behind the back, looking out; lean: forearms on a rail;
 * write: the book open on the left forearm, writing (the customs; others stand idle).
 */
export type Motion = "idle" | "walk" | "talk" | "fold" | "carry" | "sit" | "behind" | "lean" | "write" | "ride" | "row" | "push"
  // M6 lively (game/lively.ts): kneeling to scrub the step, at the lace pillow, the sign of the cross, pointing
  // up at a spire, begging, a street cry, a child crouched at marbles, a hop, turning a rope, at the grinding
  // wheel, drawing water. Some lower or lift the body (motionLift).
  | "scrub" | "lace" | "cross" | "point" | "beg" | "call" | "crouch" | "hop" | "rope" | "grind" | "pull";
/**
 * M6 transport: ride (pedalling a velocipede: the body is raised by rideLift, the loop set from the
 * front wheel by setPhase), row (on a thwart facing the stern), push (behind a handcart, anyone).
 */
const MOTIONS: Motion[] = ["idle", "walk", "talk", "fold", "carry", "sit", "behind", "lean", "write", "ride", "row", "push", "scrub", "lace", "cross", "point", "beg", "call", "crouch", "hop", "rope", "grind", "pull"];
/** M6 lively: how far the hips come down (a 1.74 m body) kneeling or crouched (build_people.py KNEEL_DROP, CROUCH_DROP). */
const KNEEL_DROP = 0.44;
const CROUCH_DROP = 0.4;

const WOMEN = new Set<HumanKind>(["peeters", "fientje", "fishwife_a", "fishwife_b", "maid", "girl", "wife_a", "wife_b", "shopwife", "old_woman", "girl_b", "milk_woman", "nun", "beguine", "tourist_lady"]);
/** Long aprons are open shells: the thighs would show through in the sit clip. */
const NO_SIT = new Set<HumanKind>(["baker", "shopkeeper", "publican"]);
/** Every kind in people.glb (for a kind name that comes from the server). */
export function isHumanKind(k: string): k is HumanKind {
  return !!template?.roots.has(k);
}

/** People whose load decides their clips: the sack on the shoulder, the sack truck, the handcart. */
const SACK = { walk: "walk_sack", carry: "walk_sack", idle: "idle_sack", talk: "idle_sack", fold: "idle_sack", sit: "idle_sack", behind: "idle_sack", lean: "idle_sack" };
const PUSH = { walk: "push", carry: "push", idle: "push_idle", talk: "push_idle", fold: "push_idle", sit: "push_idle", behind: "push_idle", lean: "push_idle" };
/** A sentry: the rifle upright at the right shoulder, the right arm still ("portez armes"), whatever he does. */
const RIFLE = { walk: "rifle_walk", carry: "rifle_walk", idle: "rifle_idle", talk: "rifle_talk", fold: "rifle_idle", sit: "rifle_idle", behind: "rifle_idle", lean: "rifle_idle", write: "rifle_idle" };
const OWN_CLIPS: Partial<Record<HumanKind, Partial<Record<Motion, string>>>> = { docker_sack: SACK, porter: PUSH, carter: PUSH, sentry: RIFLE };
/** Women stand with their hands folded in front, and do not sit (the skirt). */
const WOMEN_CLIPS: Partial<Record<Motion, string>> = { sit: "idle_f", behind: "idle_f", fold: "idle_f", carry: "walk_f" };

/** Metres covered by one loop of a walking clip, for a 1.74 m body. */
const STRIDE: Record<string, number> = { push: 0.9, walk_sack: 1.05 };
/** The velocipede (tools/blender/build_velocipede.py): the saddle's top, and the rider's hips over it (build_people.py RIDE_BACK). */
export const SADDLE_Y = 0.97;
export const RIDE_BACK = 0.05;

interface Template {
  roots: Map<string, THREE.Object3D>;
  clips: Map<string, THREE.AnimationClip>;
  /** Body height over 1.74 m, read from the hips bone (children are about 0.72). */
  scale: Map<string, number>;
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
      const scale = new Map<string, number>();
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
        const hips = root.getObjectByName("hips");
        scale.set(root.name, hips ? hips.position.y / 0.95 : 1);
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
      template = { roots, clips, scale };
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
  return src ? new Human(kind, src, template.clips, template.scale.get(kind) ?? 1) : null;
}

export class Human {
  readonly root: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<Motion, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private readonly stride = new Map<Motion, number>();
  motion: Motion | null = null;

  constructor(
    readonly kind: HumanKind,
    src: THREE.Object3D,
    clips: Map<string, THREE.AnimationClip>,
    /** Body height over 1.74 m. */
    readonly scale = 1,
  ) {
    this.root = cloneSkinned(src);
    this.mixer = new THREE.AnimationMixer(this.root);
    const woman = WOMEN.has(kind);
    const own = OWN_CLIPS[kind] ?? (woman ? WOMEN_CLIPS : {});
    for (const m of MOTIONS) {
      const name = own[m];
      const clip = (name && clips.get(name)) || (woman && clips.get(`${m}_f`)) || clips.get(m);
      if (!clip) continue;
      this.actions.set(m, this.mixer.clipAction(clip));
      this.stride.set(m, (STRIDE[clip.name] ?? 1.2) * scale);
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

  /** Walk clips cover 1.2 m per loop (less for a child or a load); match the feet to the ground speed. */
  setPace(speed: number): void {
    for (const m of ["walk", "carry", "push"] as Motion[]) this.actions.get(m)?.setEffectiveTimeScale(Math.max(0.3, speed / (this.stride.get(m) ?? 1.2)));
  }

  /** M6: hold a clip at a point of its loop (0..1): the pedals follow the front wheel's turn. */
  setPhase(m: Motion, phase: number): void {
    const a = this.actions.get(m);
    if (!a) return;
    a.setEffectiveTimeScale(0);
    a.time = (((phase % 1) + 1) % 1) * a.getClip().duration;
  }

  /** M6: how far to raise the body so the hips sit on a velocipede's saddle (the ride clip). */
  rideLift(saddle = SADDLE_Y): number {
    return saddle + 0.07 * this.scale - 0.9 * this.scale;
  }

  /** M3i (world/trades.ts): play a clip at this speed; negative runs it backwards (the rope maker stepping back). */
  clipSpeed(m: Motion, k: number): void {
    this.actions.get(m)?.setEffectiveTimeScale(k);
  }

  /** A woman's clips (hands folded in front, shorter steps)? */
  get woman(): boolean {
    return WOMEN.has(this.kind);
  }

  /** Can this body sit (the men's sit clip; not under a skirt, not with a load)? */
  get canSit(): boolean {
    return !WOMEN.has(this.kind) && !OWN_CLIPS[this.kind] && !NO_SIT.has(this.kind);
  }

  /** How far to lower the body (negative) so it sits on a seat `seat` metres high (the sit clip). */
  sitDrop(seat = 0.45): number {
    return seat + 0.07 * this.scale - 0.9 * this.scale;
  }

  /**
   * M6 lively: how far to lower (negative) or lift the body for what it plays now: on the knees to
   * scrub, on a chair at the lace pillow (seat 0.45 m), crouched at marbles, off the ground in a hop.
   */
  motionLift(): number {
    switch (this.motion) {
      case "scrub":
        return -KNEEL_DROP * this.scale;
      case "crouch":
        return -CROUCH_DROP * this.scale;
      case "lace":
        return this.sitDrop(0.45);
      case "hop": {
        const a = this.current!;
        return 0.13 * this.scale * Math.max(0, Math.sin((a.time / a.getClip().duration) * Math.PI * 2));
      }
      default:
        return 0;
    }
  }

  /** How far the hips dip below standing height right now (walking only). */
  bob(): number {
    if (this.motion !== "walk" && this.motion !== "carry") return 0;
    const a = this.current!;
    const p = (a.time / a.getClip().duration) * Math.PI * 2;
    return -(WOMEN.has(this.kind) ? 0.035 : 0.05) * this.scale * Math.cos(p) ** 2;
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
