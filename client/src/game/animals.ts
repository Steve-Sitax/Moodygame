import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { psx } from "../retro/psx";
import { disposeSkeletons } from "./humans";
import { dice, hash32, runsHere, share, type SharedAnimal } from "./share";
import { tempest } from "../world/tempest";

// Dogs and cats (M3e), from client/public/models/animals.glb
// (tools/blender/build_animals.py): four dogs and four cats, rigged, with
// idle, walk, run, sit, lie (and sniff for dogs). Stray dogs trot about near
// Jef; some townspeople's dogs follow them; cats sit on doorsteps and at the
// quay edge and run when a dog comes near. Nobody owns a number here: animals
// are scenery. Every step is checked against the walk map and colliders.

export type AnimalKind = "dog_brown" | "dog_black" | "dog_spotted" | "dog_grey" | "cat_tabby" | "cat_black" | "cat_ginger" | "cat_white" | "pig_pink" | "pig_spotted";
export type AnimalMotion = "idle" | "walk" | "run" | "sit" | "lie" | "sniff";
const DOGS: AnimalKind[] = ["dog_brown", "dog_black", "dog_spotted", "dog_grey"];
const CATS: AnimalKind[] = ["cat_tabby", "cat_black", "cat_ginger", "cat_white"];

/** How far to lower the root so the body rests on the ground (build_animals.py report). */
const DROP: Record<string, { sit: number; lie: number }> = { dog: { sit: 0.276, lie: 0.23 }, dog_grey: { sit: 0.304, lie: 0.253 }, cat: { sit: 0.131, lie: 0.139 }, pig: { sit: 0, lie: 0 }, pig_spotted: { sit: 0, lie: 0 } };
/** Metres per loop of walk and run (build_animals.py report: the paws stay planted at this). */
const STRIDE: Record<string, { walk: number; run: number }> = {
  dog: { walk: 0.452, run: 1.125 },
  dog_grey: { walk: 0.497, run: 1.24 },
  cat: { walk: 0.21, run: 0.531 },
  // T3 chain 3: the pigs (pig_spotted is built at 0.94)
  pig: { walk: 0.219, run: 0.429 },
  pig_spotted: { walk: 0.206, run: 0.403 },
};
/** Above this ground speed (m/s) the run clip reads better than a hurried walk. */
const RUN_FROM: Record<string, number> = { dog: 1.3, dog_grey: 1.4, cat: 0.8, pig: 1.2, pig_spotted: 1.2 };
/** The walk cycle shows from this measured speed (m/s) and stops below the lower one. */
const MOVE_ON = 0.2;
const MOVE_OFF = 0.15;

interface Template {
  roots: Map<string, THREE.Object3D>;
  clips: Map<string, THREE.AnimationClip>;
}
let template: Template | null = null;
let loading: Promise<Template | null> | null = null;
const baseName = (n: string) => n.replace(/_\d+$/, "");

function load(): Promise<Template | null> {
  if (loading) return loading;
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  const loader = new GLTFLoader().setDRACOLoader(draco);
  loading = loader
    .loadAsync("/models/animals.glb")
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
            mat = psx(new THREE.MeshLambertMaterial({ map, side: THREE.DoubleSide }));
            mats.set(old, mat);
            old.dispose();
          }
          m.material = mat;
          m.frustumCulled = false;
        });
        root.removeFromParent();
        root.position.set(0, 0, 0);
        roots.set(root.name, root);
      }
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
      console.warn("animals.glb did not load; no dogs or cats", err);
      draco.dispose();
      return null;
    });
  return loading;
}

export class Animal {
  readonly root: THREE.Object3D;
  readonly group = new THREE.Group();
  readonly species: "dog" | "cat" | "pig";
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<AnimalMotion, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  /** The clip that shows now (walk or run only while the animal really goes). */
  motion: AnimalMotion | null = null;
  /** Asked to go (walk or run): the clip follows the measured ground speed. Null = a still pose. */
  private gait: "walk" | "run" | null = null;
  /** Ground speed in m/s, measured from where the group really went (smoothed). */
  speed = 0;
  private readonly last = new THREE.Vector3();
  private hasLast = false;
  private drop = 0;
  private readonly key: string;

  constructor(readonly kind: AnimalKind, src: THREE.Object3D, clips: Map<string, THREE.AnimationClip>) {
    this.species = kind.startsWith("dog") ? "dog" : kind.startsWith("pig") ? "pig" : "cat";
    this.key = kind === "dog_grey" || kind === "pig_spotted" ? kind : this.species;
    this.root = cloneSkinned(src);
    this.group.add(this.root);
    this.mixer = new THREE.AnimationMixer(this.root);
    for (const m of ["idle", "walk", "run", "sit", "lie", "sniff"] as AnimalMotion[]) {
      const c = clips.get(`${this.species}_${m}`);
      if (c) this.actions.set(m, this.mixer.clipAction(c));
    }
    this.play("idle", 0);
    if (this.current) this.current.time = Math.random() * this.current.getClip().duration;
  }

  /**
   * Walk and run are a wish: the legs move only while the animal really goes, at the pace of
   * the ground it covers (update()). Held against a wall it stands. Any other motion shows now.
   */
  play(m: AnimalMotion, fade = 0.25): void {
    if (m === "walk" || m === "run") {
      this.gait = m;
      return;
    }
    this.gait = null;
    this.show(m, fade);
  }

  private show(m: AnimalMotion, fade = 0.25): void {
    if (this.motion === m) return;
    const next = this.actions.get(m) ?? this.actions.get("idle");
    if (!next) return;
    this.motion = m;
    next.reset().setEffectiveWeight(1).play();
    if (this.current && this.current !== next && fade > 0) this.current.crossFadeTo(next, fade, false);
    else if (this.current !== next) this.current?.stop();
    this.current = next;
  }

  /** Kept for callers from before 2026-09-24: the pace now follows the measured ground speed. */
  setPace(_speed: number): void {}

  update(dt: number): void {
    // how fast it really goes (a jump of more than 2 m is a placement, not a step)
    const p = this.group.getWorldPosition(tmp);
    if (this.hasLast && dt > 0.004) {
      const d = Math.hypot(p.x - this.last.x, p.z - this.last.z);
      const inst = d > 2 ? 0 : d / dt;
      this.speed += (inst - this.speed) * Math.min(1, dt * 10);
    }
    this.last.copy(p);
    this.hasLast = true;
    if (this.gait) {
      const going = this.motion === "walk" || this.motion === "run";
      if (this.speed > (going ? MOVE_OFF : MOVE_ON)) {
        const runFrom = RUN_FROM[this.key];
        const run = this.speed > (this.motion === "run" ? runFrom - 0.2 : runFrom);
        const m: AnimalMotion = run ? "run" : "walk";
        this.show(m, 0.2);
        // one loop of the clip is one stride: loops per second = speed / stride
        const act = this.actions.get(m);
        if (act) act.setEffectiveTimeScale((this.speed * act.getClip().duration) / STRIDE[this.key][m === "run" ? "run" : "walk"]);
      } else if (going || this.motion === null) this.show("idle", 0.2);
    }
    this.mixer.update(dt);
    const want = this.motion === "sit" ? -DROP[this.key].sit : this.motion === "lie" ? -DROP[this.key].lie : 0;
    this.drop += (want - this.drop) * Math.min(1, dt * 5);
    this.root.position.y = this.drop;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.group.removeFromParent();
    disposeSkeletons(this.group); // (its bone textures: game/humans.ts, issue #19)
  }
}
const tmp = new THREE.Vector3();

export function makeAnimal(kind: AnimalKind): Animal | null {
  if (!template) {
    void load();
    return null;
  }
  const src = template.roots.get(kind);
  return src ? new Animal(kind, src, template.clips) : null;
}

// ------------------------------------------------------------------ the animals of the town

type V = { x: number; z: number };

export interface AnimalGround {
  isFree(x: number, z: number, r: number): boolean;
  /** Open ground on the people's walk grid round Jef (crowd.ts) and free of colliders. */
  canStand?(x: number, z: number): boolean;
  /** The nearest open point of that grid, or null. */
  openNear?(x: number, z: number): V | null;
  /** A walk on that grid from a to b (corner points, the last one b), or null when there is no way. */
  path?(ax: number, az: number, bx: number, bz: number): V[] | null;
  /** The height of what an animal with its feet at `feet` stands on (the world's groundAt); far below over open water. */
  heightAt?(x: number, z: number, feet: number): number;
}

interface Beast {
  /** Height of the ground under it (the pontoon, steps, a raised courtyard), last frame. */
  y?: number;
  a: Animal;
  x: number;
  z: number;
  yaw: number;
  /** A person to follow (their dog), by a getter; null = a stray or a cat. `remote`: another PC walks the person. */
  owner: (() => { x: number; z: number; yaw: number; walking: boolean; remote?: boolean } | null) | null;
  ownerId: string | null;
  goal: V | null;
  /** The corners still to pass on the way to the goal (the last one is the goal). */
  route: V[];
  speed: number;
  timer: number;
  /** Cats: running from something until this runs out. */
  scared: number;
  /** Seconds on end that its steps got (almost) nowhere. */
  stuck: number;
  /** An owner's dog: how long it could not get to heel; when to look for the way again; a short wait after a dead end. */
  lost: number;
  repath: number;
  hold: number;
  /** M8f sync pass 3: its id among the players' PCs (a stray's or a cat's from the roster; a dog's `dog:<person>`). */
  id: string | null;
  /** Shown from the PC that runs it (not moved here). */
  remote: boolean;
  /** The great storm: 1 on its way to its doorstep, 2 cowering (there, or against a wall where it got stuck). */
  shelter?: number;
}

/** M8f sync pass 3: a stray or a cat of the town, fixed by its haunt (the same on every PC). */
interface Haunt {
  id: string;
  kind: AnimalKind;
  x: number;
  z: number;
  yaw: number;
  /** A stray out only at night; a cat's pose. */
  night: boolean;
  pose: "sit" | "lie";
}
/** Made within this of this player, dropped beyond DROP_R (they were made 18-55 m off, dropped at 75). */
const REACH_R = 60;
const DROP_R = 75;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const beast = (a: Animal, x: number, z: number, yaw: number, extra: Partial<Beast> = {}): Beast => ({
  a,
  x,
  z,
  yaw,
  owner: null,
  ownerId: null,
  goal: null,
  route: [],
  speed: 1,
  timer: 0,
  scared: 0,
  stuck: 0,
  lost: 0,
  repath: 0,
  hold: 0,
  id: null,
  remote: false,
  ...extra,
});

export class Animals {
  private beasts: Beast[] = [];
  private ready = false;
  private readonly frustum = new THREE.Frustum();
  private readonly m4 = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  /**
   * The doorsteps of the town (the town gives its doors). M8f sync pass 3: the town's strays and cats are fixed by
   * them, the same on every PC: a cat on about 9 doorsteps in 20 (its kind, pose and turn by the doorstep), a stray
   * haunting about 1 in 3 of the rest (1 in 3 of those only at night): about as many round a player as before. Each is made when a player comes within 60 m of it; the
   * PC of the nearest player runs it (game/share.ts), the others draw it from that PC's states.
   */
  set catSpots(spots: Array<{ x: number; z: number }>) {
    const out: Haunt[] = [];
    const seen = new Set<string>();
    spots.forEach((s) => {
      const key = `${Math.round(s.x * 10)},${Math.round(s.z * 10)}`;
      if (seen.has(key)) return; // (a family's one door)
      seen.add(key);
      const i = hash32(key) % 100000;
      if (dice("cat", i) < 0.45)
        out.push({ id: `a:cat:${key}`, kind: CATS[Math.floor(dice("catkind", i) * 4)], x: s.x + (dice("catx", i) - 0.5) * 1.2, z: s.z + (dice("catz", i) - 0.5) * 1.2, yaw: dice("catyaw", i) * 6.28, night: false, pose: dice("catpose", i) < 0.34 ? "lie" : "sit" });
      else if (dice("stray", i) < 0.6)
        out.push({ id: `a:dog:${key}`, kind: DOGS[Math.floor(dice("dogkind", i) * 4)], x: s.x, z: s.z, yaw: dice("dogyaw", i) * 6.28, night: dice("dognight", i) < 0.33, pose: "sit" });
    });
    this.haunts = out;
    this.hauntOf = new Map(out.map((h) => [h.id, h]));
  }
  private haunts: Haunt[] = [];
  private hauntOf = new Map<string, Haunt>();
  /** M3i: fish scraps on the market stones (game/market.ts): strays go and sniff at them. */
  scraps: Array<{ x: number; z: number }> = [];
  private spawnT = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly ground: AnimalGround,
  ) {
    void load().then((t) => (this.ready = !!t));
  }

  get list(): ReadonlyArray<{ x: number; z: number; species: string; kind: string; motion: string | null; owner: string | null; id: string | null; remote: boolean }> {
    return this.beasts.map((b) => ({ x: b.x, z: b.z, species: b.a.species, kind: b.a.kind, motion: b.a.motion, owner: b.ownerId, id: b.id, remote: b.remote }));
  }

  /** A townsperson's dog: it follows them while they are out. */
  addDog(ownerId: string, look: string, at: { x: number; z: number }, owner: Beast["owner"]): void {
    if (!this.ready || this.beasts.some((b) => b.ownerId === ownerId)) return;
    const kind = (DOGS.includes(look as AnimalKind) ? look : "dog_brown") as AnimalKind;
    const a = makeAnimal(kind);
    if (!a) return;
    this.scene.add(a.group);
    // at her side if there is room, else where she stands (it steps out from there)
    const side = this.ground.isFree(at.x + 0.8, at.z + 0.8, 0.22) ? { x: at.x + 0.8, z: at.z + 0.8 } : { x: at.x, z: at.z };
    this.beasts.push(beast(a, side.x, side.z, 0, { owner, ownerId, speed: 0, id: `dog:${ownerId}` }));
  }

  removeDog(ownerId: string): void {
    const b = this.beasts.find((x) => x.ownerId === ownerId);
    if (b) this.drop(b);
  }

  private drop(b: Beast): void {
    if (b.id && !b.ownerId && !b.remote) share.net?.release(b.id);
    b.a.dispose();
    this.beasts.splice(this.beasts.indexOf(b), 1);
  }

  update(dt: number, player: { x: number; z: number }, camera: THREE.Camera, fogFar: number, night: boolean): void {
    if (!this.ready) return;
    camera.updateMatrixWorld();
    this.m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m4);
    const inView = (x: number, z: number) => {
      this.sphere.center.set(x, 0.4, z);
      this.sphere.radius = 1;
      return this.frustum.intersectsSphere(this.sphere);
    };
    const hidden = (x: number, z: number) => {
      const d = Math.hypot(x - player.x, z - player.z);
      if (d < 8) return false;
      // (M8f: out of every player's sight)
      if (share.on && share.seenByOthers(x, z)) return false;
      if (d > fogFar + 3) return true;
      return !inView(x, z);
    };
    // M8f sync pass 3: every player (a cat runs from any of them; a stray trots over to any of them for a sniff)
    const people = share.on ? share.players() : [player];
    // the town's strays and cats near: made at their haunts (the PC of the nearest player runs each; another's are
    // made when its first state comes)
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 0.5;
      for (const h of this.haunts) {
        if (this.byId(h.id)) continue;
        if (Math.hypot(h.x - player.x, h.z - player.z) > REACH_R) continue;
        if (h.night && !night) continue;
        if (!runsHere(h.id, h.x, h.z, REACH_R)) continue;
        this.spawnHaunt(h, h.x, h.z, h.yaw, false);
      }
      if (share.on && share.net) {
        for (const id of share.net.animalsHeard()) {
          const h = this.hauntOf.get(id);
          if (!h || this.byId(id)) continue;
          const s = share.net.animal(id);
          if (!s || Math.hypot(s.x - player.x, s.z - player.z) > REACH_R) continue;
          if (share.net.owner(id) === share.me) continue;
          this.spawnHaunt(h, s.x, s.z, s.yaw, true);
        }
      }
    }
    const dogs = this.beasts.filter((b) => b.a.species === "dog");
    for (const b of [...this.beasts]) {
      const d = Math.hypot(b.x - player.x, b.z - player.z);
      if (!b.ownerId && d > DROP_R) {
        this.drop(b);
        continue;
      }
      // M8f sync pass 3: run here, or shown from the PC that runs it
      const o = b.owner?.() ?? null;
      const here = b.ownerId ? !o?.remote : runsHere(b.id!, b.x, b.z, DROP_R - 15);
      const got = !here && share.net && b.id ? share.net.animal(b.id) : null;
      b.remote = !here;
      if (got) this.show(b, got);
      else if (here || b.ownerId) {
        // (a townsperson's dog not sent yet: at his heel as before)
        if (b.owner) this.follow(b, dt, hidden);
        // the great storm (world/tempest.ts): strays and cats run for their doorstep and cower there, flat to the stone
        else if (tempest.phase && tempest.level > 0.3) this.storm(b, dt);
        else if (b.shelter) {
          b.shelter = 0;
          b.a.group.rotation.z = 0;
          b.goal = null;
          b.route = [];
          b.timer = rnd(1, 4);
          b.a.play(b.a.species === "cat" ? "sit" : "idle");
        } else if (b.a.species === "dog") this.stray(b, dt, people);
        else this.cat(b, dt, dogs, people);
      }
      if (here && share.on && b.id && share.net) {
        const m = b.a.motion ?? "idle";
        if (m !== "walk" && m !== "run" && !b.goal) {
          // (standing: on the batch's own grid, 2 cm and 1/256 of a turn, so the others have it exactly here)
          b.x = Math.round(b.x * 50) / 50;
          b.z = Math.round(b.z * 50) / 50;
          b.yaw = Math.round((((b.yaw % 6.283185307179586) + 6.283185307179586) % 6.283185307179586) * (256 / 6.283185307179586)) * (6.283185307179586 / 256);
          b.yaw = Math.atan2(Math.sin(b.yaw), Math.cos(b.yaw));
        }
        share.net.putAnimal(b.id, { x: b.x, z: b.z, yaw: b.yaw, motion: m === "run" || m === "walk" ? (b.a.speed > 1.4 ? "run" : "walk") : m }, b.ownerId ?? undefined);
      }
      // (shown within the fog and in view: fewer skinned draws than before, when every one near was drawn)
      const show = d < Math.min(fogFar + 5, 50) && (d < 4 || inView(b.x, b.z));
      b.a.group.visible = show;
      // placed first: the animal measures the ground it really covers and sets its legs by that
      // fixes 2026-09-25 (Steve: "dog walking in the air"): every animal stood at height 0, so on
      // the pontoon at low water (or any floor off 0) it hung in the air; it stands on the ground now
      let y = b.y ?? 0;
      if (this.ground.heightAt) {
        const h = this.ground.heightAt(b.x, b.z, y);
        if (h > -20) y = h;
      }
      b.y = y;
      b.a.group.position.set(b.x, y, b.z);
      b.a.group.rotation.y = b.yaw;
      if (show) b.a.update(dt);
    }
  }

  // ---- moving

  /** One step toward (tx, tz) at speed, sliding along what is in the way. */
  private step(b: Beast, tx: number, tz: number, speed: number, dt: number): void {
    const dx = tx - b.x;
    const dz = tz - b.z;
    const L = Math.hypot(dx, dz);
    if (L < 0.02) return;
    const s = Math.min(L, speed * dt);
    const r = b.a.species === "dog" ? 0.22 : 0.12;
    let nx = b.x + (dx / L) * s;
    let nz = b.z + (dz / L) * s;
    if (!this.ground.isFree(nx, nz, r)) {
      if (this.ground.isFree(nx, b.z, r)) nz = b.z;
      else if (this.ground.isFree(b.x, nz, r)) nx = b.x;
      else return;
    }
    if (Math.hypot(nx - b.x, nz - b.z) > 1e-4) b.yaw += angDiff(Math.atan2(nx - b.x, nz - b.z), b.yaw) * Math.min(1, dt * 8);
    b.x = nx;
    b.z = nz;
  }

  /**
   * Along the route to the goal: "there", "going", or "stuck" (0.4 s on end of getting almost
   * nowhere: a wall, a cart, a person in the way). The legs move only while it really goes (Animal).
   */
  private go(b: Beast, speed: number, dt: number): "there" | "going" | "stuck" {
    const next = b.route[0] ?? b.goal;
    if (!next) return "there";
    b.a.play(speed > 1.6 ? "run" : "walk");
    const L = Math.hypot(next.x - b.x, next.z - b.z);
    const x0 = b.x;
    const z0 = b.z;
    if (L > 0.25) this.step(b, next.x, next.z, speed, dt);
    if (Math.hypot(next.x - b.x, next.z - b.z) <= 0.25) {
      b.stuck = 0;
      if (b.route.length > 1) {
        b.route.shift();
        return "going";
      }
      b.route = [];
      return "there";
    }
    const moved = Math.hypot(b.x - x0, b.z - z0);
    if (moved < Math.min(L, speed * dt) * 0.35) b.stuck += dt;
    else b.stuck = Math.max(0, b.stuck - dt * 2);
    return b.stuck > 0.4 ? "stuck" : "going";
  }

  /** Is the straight way from a to b free for a body of radius r? */
  private lineFree(ax: number, az: number, bx: number, bz: number, r: number): boolean {
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(L / 0.25));
    for (let i = 1; i <= n; i++) if (!this.ground.isFree(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n, r)) return false;
    return true;
  }

  /**
   * Aim for (x, z) only if it can get there: straight when the way is free, else on the people's
   * walk grid (round the houses, at most maxLen long). False = no way; it stays where it is.
   */
  private aim(b: Beast, x: number, z: number, maxLen = 35): boolean {
    const g = this.ground;
    const r = b.a.species === "dog" ? 0.25 : 0.14;
    if (g.isFree(x, z, r) && this.lineFree(b.x, b.z, x, z, r)) {
      b.goal = { x, z };
      b.route = [b.goal];
      b.stuck = 0;
      return true;
    }
    if (!g.path || !g.openNear || !g.canStand) return false;
    const q = g.openNear(x, z);
    if (!q || !g.canStand(q.x, q.z)) return false;
    const way = g.path(b.x, b.z, q.x, q.z);
    if (!way?.length) return false;
    // the grid keeps half a metre off the walls: from a doorstep, first out onto it
    if (!g.canStand(b.x, b.z)) {
      const s = g.openNear(b.x, b.z);
      if (!s || !this.lineFree(b.x, b.z, s.x, s.z, r)) return false;
      way.unshift(s);
    }
    let len = 0;
    let px = b.x;
    let pz = b.z;
    for (const p of way) {
      len += Math.hypot(p.x - px, p.z - pz);
      px = p.x;
      pz = p.z;
    }
    if (len > maxLen) return false;
    b.goal = q;
    b.route = way;
    b.stuck = 0;
    return true;
  }

  private follow(b: Beast, dt: number, hidden: (x: number, z: number) => boolean): void {
    const o = b.owner!();
    if (!o) return;
    // at heel: a little behind and to the left; along a house front that spot is in the wall,
    // so then right behind, or the nearest open ground
    let tx = o.x - Math.sin(o.yaw) * 1.1 + Math.cos(o.yaw) * 0.6;
    let tz = o.z - Math.cos(o.yaw) * 1.1 - Math.sin(o.yaw) * 0.6;
    if (!this.ground.isFree(tx, tz, 0.25)) {
      const bx = o.x - Math.sin(o.yaw) * 0.9;
      const bz = o.z - Math.cos(o.yaw) * 0.9;
      const q = this.ground.isFree(bx, bz, 0.25) ? { x: bx, z: bz } : this.ground.openNear?.(tx, tz);
      if (q) {
        tx = q.x;
        tz = q.z;
      }
    }
    const d = Math.hypot(tx - b.x, tz - b.z);
    if ((d > 12 || b.lost > 2) && hidden(b.x, b.z) && hidden(tx, tz)) {
      // lost the way round a corner: catch up where nobody sees it
      b.x = tx;
      b.z = tz;
      b.lost = 0;
      b.route = [];
      b.stuck = 0;
      return;
    }
    if (b.hold > 0) {
      // a dead end: it stands and looks at her a moment, then tries again
      b.hold -= dt;
      b.yaw += angDiff(Math.atan2(o.x - b.x, o.z - b.z), b.yaw) * Math.min(1, dt * 3);
      return;
    }
    // off it goes when she is a metre off, and it stops within half a metre (no dithering at heel)
    if (d > (b.route.length ? 0.5 : 1.0)) {
      b.repath -= dt;
      if (b.repath <= 0 || !b.route.length) {
        b.repath = 0.7;
        if (!this.aim(b, tx, tz, 60)) {
          b.goal = { x: tx, z: tz };
          b.route = [b.goal];
        }
      } else if (b.route.length === 1) {
        // straight at her: keep up with where she is now
        b.goal = { x: tx, z: tz };
        b.route[0] = b.goal;
      }
      const r = this.go(b, d > 3 ? 2.6 : Math.max(0.8, Math.min(1.6, d)), dt);
      if (r === "there") b.route = [];
      else if (r === "stuck") {
        // as near as the wall lets it (that is heel), or a dead end: it waits a moment, then tries again
        const near = d < 1.6;
        if (!near) b.lost += 0.6;
        b.route = [];
        b.stuck = 0;
        b.hold = near ? 1.5 : 0.6;
        b.a.play(near ? pick(["sit", "idle"]) : "idle");
      } else b.lost = Math.max(0, b.lost - dt);
      b.timer = rnd(2, 6);
    } else {
      b.lost = 0;
      b.route = [];
      if (b.a.motion !== "sit" && b.a.motion !== "lie" && b.a.motion !== "sniff") b.a.play("idle");
      b.yaw += angDiff(o.yaw, b.yaw) * Math.min(1, dt * 3);
      if ((b.timer -= dt) <= 0) {
        b.a.play(o.walking ? "idle" : pick(["sit", "sit", "sniff", "lie", "idle"]));
        b.timer = rnd(4, 10);
      }
    }
  }

  private stray(b: Beast, dt: number, people: Array<{ x: number; z: number }>): void {
    if (b.goal) {
      const r = this.go(b, b.speed, dt);
      if (r !== "going") {
        b.goal = null;
        b.route = [];
        b.a.play(r === "there" ? pick(["sniff", "sniff", "idle", "sit", "lie"]) : pick(["sniff", "idle"]));
        b.timer = r === "there" ? rnd(2, 9) : rnd(0.5, 2);
      }
      return;
    }
    if ((b.timer -= dt) > 0) return;
    // trot off somewhere it can get to, now and then over to Jef (any player: M8f) for a sniff
    const player = people.reduce((a, q) => (Math.hypot(q.x - b.x, q.z - b.z) < Math.hypot(a.x - b.x, a.z - b.z) ? q : a), people[0] ?? { x: 1e9, z: 1e9 });
    const toJef = Math.random() < 0.15 && Math.hypot(player.x - b.x, player.z - b.z) < 20;
    // fish scraps nearby: over there, nose down (the stop plays sniff)
    const scrap = !toJef && Math.random() < 0.5 ? this.scraps.find((q) => Math.hypot(q.x - b.x, q.z - b.z) < 30 && Math.hypot(q.x - b.x, q.z - b.z) > 1) : undefined;
    b.speed = Math.random() < 0.25 ? rnd(2.2, 3.2) : rnd(0.8, 1.3);
    let ok = toJef ? this.aim(b, player.x + rnd(-1, 1), player.z + rnd(-1, 1)) : scrap ? this.aim(b, scrap.x + rnd(-0.4, 0.4), scrap.z + rnd(-0.4, 0.4)) : false;
    for (let i = 0; !ok && i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rnd(4, 14);
      ok = this.aim(b, b.x + Math.cos(a) * r, b.z + Math.sin(a) * r);
    }
    if (!ok) b.timer = rnd(1, 3);
  }

  /**
   * The great storm (Steve 2026-09-29: "animals scared, finding shelter or against the walls cowering"): back to its
   * doorstep at a run, then flat on the stone in the lee of the door, trembling. If the way is shut it cowers against
   * the wall where it is.
   */
  private storm(b: Beast, dt: number): void {
    const h = b.id ? this.hauntOf.get(b.id) : undefined;
    if (b.shelter !== 2 && h) {
      if (!b.shelter) {
        b.shelter = 1;
        b.goal = null;
        b.route = [];
        if (!this.aim(b, h.x, h.z, 80)) b.shelter = 2;
      }
      if (b.shelter === 1) {
        const r = b.goal ? this.go(b, b.a.species === "dog" ? 3.1 : 3.4, dt) : "stuck";
        if (r !== "going") {
          b.shelter = 2;
          b.goal = null;
          b.route = [];
        }
        return;
      }
    }
    b.shelter = 2;
    if (b.a.motion !== "lie") b.a.play("lie", 0.4);
    // trembling: a shiver of the whole body
    b.timer += dt;
    b.a.group.rotation.z = Math.sin(b.timer * 38) * 0.015;
  }

  /** A way out for a frightened cat: away from the fright, or as near that as the walls allow. */
  private flee(b: Beast, ux: number, uz: number): boolean {
    for (const turn of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9]) {
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      const dx = ux * c - uz * s;
      const dz = ux * s + uz * c;
      for (const dist of [7, 4]) if (this.aim(b, b.x + dx * dist, b.z + dz * dist, dist * 2.5)) return true;
    }
    return false;
  }

  private cat(b: Beast, dt: number, dogs: Beast[], people: Array<{ x: number; z: number }>): void {
    // what frightens a cat: a dog near, or Jef right on top of it
    let tx = 0;
    let tz = 0;
    let fear = 0;
    for (const d of dogs) {
      const dd = Math.hypot(d.x - b.x, d.z - b.z);
      if (dd < 5 && dd > 1e-3) {
        tx += (b.x - d.x) / dd;
        tz += (b.z - d.z) / dd;
        fear++;
      }
    }
    for (const player of people) {
      const pd = Math.hypot(player.x - b.x, player.z - b.z);
      if (pd < 1.6 && pd > 1e-3) {
        tx += (b.x - player.x) / pd;
        tz += (b.z - player.z) / pd;
        fear++;
      }
    }
    if (fear) {
      if (b.scared <= 0) {
        b.goal = null;
        b.route = [];
        b.timer = 0;
      }
      b.scared = Math.max(b.scared, rnd(2, 3.5));
    }
    if (b.scared > 0) {
      b.scared -= dt;
      b.timer -= dt;
      if (!b.goal && fear && b.timer <= 0) {
        const L = Math.hypot(tx, tz) || 1;
        // cornered: it crouches where it is and looks again in a moment
        if (!this.flee(b, tx / L, tz / L)) b.timer = 0.8;
      }
      if (b.goal) {
        const r = this.go(b, 3.2, dt);
        if (r !== "going") {
          b.goal = null;
          b.route = [];
          b.timer = r === "stuck" ? 0.3 : 0;
        }
      }
      if (!b.goal) b.a.play("idle");
      if (b.scared <= 0) {
        b.goal = null;
        b.route = [];
        b.a.play("sit");
        b.timer = rnd(5, 20);
      }
      return;
    }
    if (b.goal) {
      const r = this.go(b, 0.45, dt);
      if (r !== "going") {
        b.goal = null;
        b.route = [];
        b.a.play(pick(["sit", "lie", "sit"]));
        b.timer = r === "there" ? rnd(8, 25) : rnd(2, 6);
      }
      return;
    }
    if ((b.timer -= dt) <= 0) {
      const a = Math.random() * Math.PI * 2;
      const r = rnd(2, 5);
      if (!this.aim(b, b.x + Math.cos(a) * r, b.z + Math.sin(a) * r, 10)) b.timer = rnd(2, 6);
    }
  }

  // ---- spawning (M8f sync pass 3: at the town's haunts, not round one player: see catSpots)

  private byId(id: string): Beast | undefined {
    return this.beasts.find((b) => b.id === id);
  }

  /** A stray or a cat of the roster, at its haunt (or where the PC that runs it has it: `remote`). */
  private spawnHaunt(h: Haunt, x: number, z: number, yaw: number, remote: boolean): void {
    const an = makeAnimal(h.kind);
    if (!an) return;
    this.scene.add(an.group);
    if (an.species === "cat") {
      an.play(h.pose, 0);
      this.beasts.push(beast(an, x, z, yaw, { speed: 0, timer: 5 + dice("cattimer", x, z) * 15, id: h.id, remote }));
    } else this.beasts.push(beast(an, x, z, yaw, { timer: dice("dogtimer", x, z) * 3, id: h.id, remote }));
  }

  /** One the PC that runs it has here now (about 200 ms behind): the legs follow the ground it covers. */
  private show(b: Beast, s: SharedAnimal): void {
    const jump = Math.hypot(s.x - b.x, s.z - b.z) > 3;
    b.x = s.x;
    b.z = s.z;
    b.yaw = s.yaw;
    if (jump) b.y = undefined;
    b.goal = null;
    b.route = [];
    const m = s.motion === "peck" || s.motion === "graze" ? "idle" : s.motion;
    b.a.play(m, 0.25);
  }
}
