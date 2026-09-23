import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { psx } from "../retro/psx";

// Dogs and cats (M3e), from client/public/models/animals.glb
// (tools/blender/build_animals.py): four dogs and four cats, rigged, with
// idle, walk, run, sit, lie (and sniff for dogs). Stray dogs trot about near
// Jef; some townspeople's dogs follow them; cats sit on doorsteps and at the
// quay edge and run when a dog comes near. Nobody owns a number here: animals
// are scenery. Every step is checked against the walk map and colliders.

export type AnimalKind = "dog_brown" | "dog_black" | "dog_spotted" | "dog_grey" | "cat_tabby" | "cat_black" | "cat_ginger" | "cat_white";
export type AnimalMotion = "idle" | "walk" | "run" | "sit" | "lie" | "sniff";
const DOGS: AnimalKind[] = ["dog_brown", "dog_black", "dog_spotted", "dog_grey"];
const CATS: AnimalKind[] = ["cat_tabby", "cat_black", "cat_ginger", "cat_white"];

/** How far to lower the root so the body rests on the ground (build_animals.py report). */
const DROP: Record<string, { sit: number; lie: number }> = { dog: { sit: 0.261, lie: 0.23 }, dog_grey: { sit: 0.288, lie: 0.253 }, cat: { sit: 0.131, lie: 0.139 } };
/** Metres per loop of walk and run. */
const STRIDE: Record<string, { walk: number; run: number }> = { dog: { walk: 0.452, run: 1.125 }, dog_grey: { walk: 0.497, run: 1.24 }, cat: { walk: 0.21, run: 0.531 } };

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
  readonly species: "dog" | "cat";
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<AnimalMotion, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  motion: AnimalMotion | null = null;
  private drop = 0;
  private readonly key: string;

  constructor(readonly kind: AnimalKind, src: THREE.Object3D, clips: Map<string, THREE.AnimationClip>) {
    this.species = kind.startsWith("dog") ? "dog" : "cat";
    this.key = kind === "dog_grey" ? "dog_grey" : this.species;
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

  play(m: AnimalMotion, fade = 0.25): void {
    if (this.motion === m) return;
    const next = this.actions.get(m) ?? this.actions.get("idle");
    if (!next) return;
    this.motion = m;
    next.reset().setEffectiveWeight(1).play();
    if (this.current && this.current !== next && fade > 0) this.current.crossFadeTo(next, fade, false);
    else if (this.current !== next) this.current?.stop();
    this.current = next;
  }

  /** Match the feet to the ground speed. */
  setPace(speed: number): void {
    const s = STRIDE[this.key];
    const loop = (m: AnimalMotion, stride: number) => this.actions.get(m)?.setEffectiveTimeScale(Math.max(0.3, speed / stride));
    if (this.motion === "run") loop("run", s.run);
    else loop("walk", s.walk);
  }

  update(dt: number): void {
    this.mixer.update(dt);
    const want = this.motion === "sit" ? -DROP[this.key].sit : this.motion === "lie" ? -DROP[this.key].lie : 0;
    this.drop += (want - this.drop) * Math.min(1, dt * 5);
    this.root.position.y = this.drop;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.group.removeFromParent();
  }
}

export function makeAnimal(kind: AnimalKind): Animal | null {
  if (!template) {
    void load();
    return null;
  }
  const src = template.roots.get(kind);
  return src ? new Animal(kind, src, template.clips) : null;
}

// ------------------------------------------------------------------ the animals of the town

export interface AnimalGround {
  isFree(x: number, z: number, r: number): boolean;
}

interface Beast {
  a: Animal;
  x: number;
  z: number;
  yaw: number;
  /** A person to follow (their dog), by a getter; null = a stray or a cat. */
  owner: (() => { x: number; z: number; yaw: number; walking: boolean } | null) | null;
  ownerId: string | null;
  goal: { x: number; z: number } | null;
  speed: number;
  timer: number;
  /** Cats: running from something until this runs out. */
  scared: number;
  stuck: number;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export class Animals {
  private beasts: Beast[] = [];
  private ready = false;
  private readonly frustum = new THREE.Frustum();
  private readonly m4 = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  /** Doorsteps and quay spots where cats like to sit (the town gives its doors). */
  catSpots: Array<{ x: number; z: number }> = [];
  strays = 3;
  cats = 6;
  private spawnT = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly ground: AnimalGround,
  ) {
    void load().then((t) => (this.ready = !!t));
  }

  get list(): ReadonlyArray<{ x: number; z: number; species: string; kind: string; motion: string | null; owner: string | null }> {
    return this.beasts.map((b) => ({ x: b.x, z: b.z, species: b.a.species, kind: b.a.kind, motion: b.a.motion, owner: b.ownerId }));
  }

  /** A townsperson's dog: it follows them while they are out. */
  addDog(ownerId: string, look: string, at: { x: number; z: number }, owner: Beast["owner"]): void {
    if (!this.ready || this.beasts.some((b) => b.ownerId === ownerId)) return;
    const kind = (DOGS.includes(look as AnimalKind) ? look : "dog_brown") as AnimalKind;
    const a = makeAnimal(kind);
    if (!a) return;
    this.scene.add(a.group);
    this.beasts.push({ a, x: at.x + 0.8, z: at.z + 0.8, yaw: 0, owner, ownerId, goal: null, speed: 0, timer: 0, scared: 0, stuck: 0 });
  }

  removeDog(ownerId: string): void {
    const b = this.beasts.find((x) => x.ownerId === ownerId);
    if (b) this.drop(b);
  }

  private drop(b: Beast): void {
    b.a.dispose();
    this.beasts.splice(this.beasts.indexOf(b), 1);
  }

  update(dt: number, player: { x: number; z: number }, camera: THREE.Camera, fogFar: number, night: boolean): void {
    if (!this.ready) return;
    camera.updateMatrixWorld();
    this.m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m4);
    const hidden = (x: number, z: number) => {
      const d = Math.hypot(x - player.x, z - player.z);
      if (d < 8) return false;
      if (d > fogFar + 3) return true;
      this.sphere.center.set(x, 0.4, z);
      this.sphere.radius = 1;
      return !this.frustum.intersectsSphere(this.sphere);
    };
    // keep a few strays and cats about, out of sight
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 1.5;
      const strays = this.beasts.filter((b) => !b.ownerId && b.a.species === "dog").length;
      const cats = this.beasts.filter((b) => b.a.species === "cat").length;
      if (strays < (night ? this.strays + 1 : this.strays)) this.spawnStray(player, hidden);
      else if (cats < this.cats) this.spawnCat(player, hidden);
    }
    const dogs = this.beasts.filter((b) => b.a.species === "dog");
    for (const b of [...this.beasts]) {
      const d = Math.hypot(b.x - player.x, b.z - player.z);
      if (!b.ownerId && d > 75) {
        this.drop(b);
        continue;
      }
      if (b.owner) this.follow(b, dt, hidden);
      else if (b.a.species === "dog") this.stray(b, dt, player);
      else this.cat(b, dt, dogs, player);
      const show = d < fogFar + 5;
      b.a.group.visible = show;
      if (show) b.a.update(dt);
      b.a.group.position.set(b.x, 0, b.z);
      b.a.group.rotation.y = b.yaw;
    }
  }

  // ---- moving

  /** One step toward (tx, tz) at speed; false if the way is shut. */
  private step(b: Beast, tx: number, tz: number, speed: number, dt: number): boolean {
    const dx = tx - b.x;
    const dz = tz - b.z;
    const L = Math.hypot(dx, dz);
    if (L < 0.05) return true;
    const s = Math.min(L, speed * dt);
    const r = b.a.species === "dog" ? 0.22 : 0.12;
    let nx = b.x + (dx / L) * s;
    let nz = b.z + (dz / L) * s;
    if (!this.ground.isFree(nx, nz, r)) {
      // slide along what is in the way
      if (this.ground.isFree(nx, b.z, r)) nz = b.z;
      else if (this.ground.isFree(b.x, nz, r)) nx = b.x;
      else {
        b.stuck += dt;
        return false;
      }
    }
    b.stuck = 0;
    b.yaw += angDiff(Math.atan2(nx - b.x, nz - b.z), b.yaw) * Math.min(1, dt * 8);
    b.x = nx;
    b.z = nz;
    return true;
  }

  private moveTo(b: Beast, tx: number, tz: number, speed: number, dt: number): void {
    b.a.play(speed > 1.6 ? "run" : "walk");
    b.a.setPace(speed);
    this.step(b, tx, tz, speed, dt);
  }

  private follow(b: Beast, dt: number, hidden: (x: number, z: number) => boolean): void {
    const o = b.owner!();
    if (!o) return;
    // at heel: a little behind and to the left
    const tx = o.x - Math.sin(o.yaw) * 1.1 + Math.cos(o.yaw) * 0.6;
    const tz = o.z - Math.cos(o.yaw) * 1.1 - Math.sin(o.yaw) * 0.6;
    const d = Math.hypot(tx - b.x, tz - b.z);
    if (d > 12 || b.stuck > 2) {
      // lost the way round a corner: catch up where nobody sees it
      if (hidden(b.x, b.z) && hidden(tx, tz)) {
        b.x = tx;
        b.z = tz;
        b.stuck = 0;
      }
    }
    if (d > 0.5) {
      this.moveTo(b, tx, tz, d > 3 ? 2.6 : Math.max(0.8, Math.min(1.6, d)), dt);
      b.timer = rnd(2, 6);
    } else {
      b.yaw += angDiff(o.yaw, b.yaw) * Math.min(1, dt * 3);
      if ((b.timer -= dt) <= 0) {
        b.a.play(o.walking ? "idle" : pick(["sit", "sit", "sniff", "lie", "idle"]));
        b.timer = rnd(4, 10);
      }
    }
  }

  private stray(b: Beast, dt: number, player: { x: number; z: number }): void {
    if (b.goal) {
      this.moveTo(b, b.goal.x, b.goal.z, b.speed, dt);
      if (Math.hypot(b.goal.x - b.x, b.goal.z - b.z) < 0.4 || b.stuck > 0.6) {
        b.goal = null;
        b.a.play(pick(["sniff", "sniff", "idle", "sit", "lie"]));
        b.timer = rnd(2, 9);
      }
      return;
    }
    if ((b.timer -= dt) > 0) return;
    // trot off somewhere, now and then over to Jef for a sniff
    const toJef = Math.random() < 0.15 && Math.hypot(player.x - b.x, player.z - b.z) < 20;
    const a = Math.random() * Math.PI * 2;
    const r = rnd(4, 14);
    b.goal = toJef ? { x: player.x + rnd(-1, 1), z: player.z + rnd(-1, 1) } : { x: b.x + Math.cos(a) * r, z: b.z + Math.sin(a) * r };
    b.speed = Math.random() < 0.25 ? rnd(2.2, 3.2) : rnd(0.8, 1.3);
  }

  private cat(b: Beast, dt: number, dogs: Beast[], player: { x: number; z: number }): void {
    // what frightens a cat: a dog near, or Jef right on top of it
    let tx = 0;
    let tz = 0;
    let fear = 0;
    for (const d of dogs) {
      const dd = Math.hypot(d.x - b.x, d.z - b.z);
      if (dd < 5) {
        tx += (b.x - d.x) / dd;
        tz += (b.z - d.z) / dd;
        fear++;
      }
    }
    const pd = Math.hypot(player.x - b.x, player.z - b.z);
    if (pd < 1.6) {
      tx += (b.x - player.x) / pd;
      tz += (b.z - player.z) / pd;
      fear++;
    }
    if (fear) {
      const L = Math.hypot(tx, tz) || 1;
      b.goal = { x: b.x + (tx / L) * 8, z: b.z + (tz / L) * 8 };
      b.scared = rnd(2, 3.5);
    }
    if (b.scared > 0) {
      b.scared -= dt;
      if (b.goal) this.moveTo(b, b.goal.x, b.goal.z, 3.2, dt);
      if (b.stuck > 0.4 && b.goal) {
        // cornered: try another way
        const a = Math.random() * Math.PI * 2;
        b.goal = { x: b.x + Math.cos(a) * 6, z: b.z + Math.sin(a) * 6 };
        b.stuck = 0;
      }
      if (b.scared <= 0) {
        b.goal = null;
        b.a.play("sit");
        b.timer = rnd(5, 20);
      }
      return;
    }
    if (b.goal) {
      this.moveTo(b, b.goal.x, b.goal.z, 0.45, dt);
      if (Math.hypot(b.goal.x - b.x, b.goal.z - b.z) < 0.3 || b.stuck > 1) {
        b.goal = null;
        b.a.play(pick(["sit", "lie", "sit"]));
        b.timer = rnd(8, 25);
      }
      return;
    }
    if ((b.timer -= dt) <= 0) {
      const a = Math.random() * Math.PI * 2;
      b.goal = { x: b.x + Math.cos(a) * rnd(2, 5), z: b.z + Math.sin(a) * rnd(2, 5) };
    }
  }

  // ---- spawning

  private free(x: number, z: number, r: number): boolean {
    return this.ground.isFree(x, z, r) && !this.beasts.some((b) => Math.hypot(b.x - x, b.z - z) < 1.5);
  }

  private spawnStray(player: { x: number; z: number }, hidden: (x: number, z: number) => boolean): void {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = rnd(18, 55);
      const x = player.x + Math.cos(a) * d;
      const z = player.z + Math.sin(a) * d;
      if (!hidden(x, z) || !this.free(x, z, 0.4)) continue;
      const an = makeAnimal(pick(DOGS));
      if (!an) return;
      this.scene.add(an.group);
      this.beasts.push({ a: an, x, z, yaw: Math.random() * 6.28, owner: null, ownerId: null, goal: null, speed: 1, timer: rnd(0, 3), scared: 0, stuck: 0 });
      return;
    }
  }

  private spawnCat(player: { x: number; z: number }, hidden: (x: number, z: number) => boolean): void {
    const near = this.catSpots.filter((s) => {
      const d = Math.hypot(s.x - player.x, s.z - player.z);
      return d > 10 && d < 55;
    });
    for (let i = 0; i < 10 && near.length; i++) {
      const s = pick(near);
      const x = s.x + rnd(-0.6, 0.6);
      const z = s.z + rnd(-0.6, 0.6);
      if (!hidden(x, z) || !this.free(x, z, 0.2)) continue;
      const an = makeAnimal(pick(CATS));
      if (!an) return;
      this.scene.add(an.group);
      an.play(pick(["sit", "lie", "sit"]), 0);
      this.beasts.push({ a: an, x, z, yaw: Math.random() * 6.28, owner: null, ownerId: null, goal: null, speed: 0, timer: rnd(5, 20), scared: 0, stuck: 0 });
      return;
    }
  }
}
