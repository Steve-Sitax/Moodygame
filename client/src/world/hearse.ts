import * as THREE from "three";
import { psx } from "../retro/psx";
import { HorsePool } from "./horses";
import type { Props } from "./props3d";

// The hearse of a town funeral (M7 funeral), built in code: a black four-wheeled funeral carriage of
// the 1860s-70s as Belgian towns had them (a "lijkwagen"): a low bed for the coffin under a canopy on
// four turned posts, a black valance with a pale fringe round the roof, a black plume at each corner
// and a small cross on top; the coachman in black with a top hat on the box; two horses in front
// (world/horses.ts, the dray horse of props.glb). Local frame: +z is where it goes, y up, the bed's
// centre at x 0, z 0. The coffin (game/wardrobe.ts makeCoffin) rides on the bed once it is loaded.

export interface Hearse {
  group: THREE.Group;
  /** At (x, z) facing yaw; `walk` 0 standing .. 1 at a walk; `y` the ground there. */
  set(x: number, z: number, yaw: number, walk: number, y?: number): void;
  /** The coffin on the bed, or not. */
  coffin(on: boolean): void;
  dispose(): void;
}

let mats: Record<string, THREE.Material> | null = null;
function m(): Record<string, THREE.Material> {
  mats ??= {
    // (a little light of its own, so the black reads in the street's fog and the PS1 dither)
    black: psx(new THREE.MeshLambertMaterial({ color: 0x1a181c, emissive: 0x08070a })),
    wood: psx(new THREE.MeshLambertMaterial({ color: 0x241e1c })),
    fringe: psx(new THREE.MeshLambertMaterial({ color: 0xa8a49a, emissive: 0x1a1a18 })),
    iron: psx(new THREE.MeshLambertMaterial({ color: 0x2a2a2c })),
    skin: psx(new THREE.MeshLambertMaterial({ color: 0xc89a7a })),
    plume: psx(new THREE.MeshLambertMaterial({ color: 0x0e0d10 })),
  };
  return mats;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  o.position.set(x, y, z);
  return o;
}
function cyl(r0: number, r1: number, h: number, mat: THREE.Material, x: number, y: number, z: number, seg = 8): THREE.Mesh {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat);
  o.position.set(x, y, z);
  return o;
}

/** A spoked wheel lying in the y-z plane (its axle along x). */
function wheel(r: number, k: Record<string, THREE.Material>): THREE.Group {
  const g = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 4, 14), k.black);
  rim.rotation.y = Math.PI / 2;
  g.add(rim);
  const hub = cyl(0.07, 0.07, 0.16, k.iron, 0, 0, 0, 6);
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  for (let i = 0; i < 6; i++) {
    const s = box(0.03, r * 2, 0.03, k.black, 0, 0, 0);
    s.rotation.x = (i / 6) * Math.PI;
    g.add(s);
  }
  return g;
}

export function createHearse(scene: THREE.Scene, props: Props | null, coffin: THREE.Object3D): Hearse {
  const k = m();
  const group = new THREE.Group();
  group.name = "hearse";
  const body = new THREE.Group();
  group.add(body);
  // the running gear: big wheels behind, small in front, a perch between
  const wheels: Array<{ w: THREE.Group; r: number }> = [];
  for (const [x, z, r] of [[-0.66, -0.95, 0.56], [0.66, -0.95, 0.56], [-0.6, 1.05, 0.42], [0.6, 1.05, 0.42]] as const) {
    const w = wheel(r, k);
    w.position.set(x, r, z);
    body.add(w);
    wheels.push({ w, r });
  }
  body.add(box(0.12, 0.08, 2.3, k.iron, 0, 0.5, 0.05));
  // the bed with its black skirt to the ground's shadow
  body.add(box(1.12, 0.1, 2.6, k.black, 0, 0.92, -0.05));
  body.add(box(1.14, 0.34, 2.62, k.black, 0, 0.72, -0.05));
  body.add(box(1.16, 0.04, 2.64, k.fringe, 0, 0.56, -0.05));
  // the canopy on four turned posts; the roof with its valance and pale fringe
  for (const [x, z] of [[-0.5, -1.25], [0.5, -1.25], [-0.5, 1.15], [0.5, 1.15]] as const) {
    body.add(cyl(0.035, 0.045, 1.5, k.black, x, 1.72, z, 6));
    body.add(cyl(0.06, 0.06, 0.06, k.fringe, x, 1.1, z, 6));
  }
  body.add(box(1.22, 0.1, 2.72, k.black, 0, 2.5, -0.05));
  body.add(box(0.9, 0.16, 2.3, k.black, 0, 2.62, -0.05));
  for (const side of [-1, 1]) {
    body.add(box(0.03, 0.26, 2.72, k.black, side * 0.62, 2.33, -0.05));
    body.add(box(0.035, 0.04, 2.72, k.fringe, side * 0.62, 2.2, -0.05));
  }
  for (const end of [-1, 1]) {
    body.add(box(1.22, 0.26, 0.03, k.black, 0, 2.33, -0.05 + end * 1.36));
    body.add(box(1.22, 0.04, 0.035, k.fringe, 0, 2.2, -0.05 + end * 1.36));
  }
  // a black plume at each corner of the roof, a small cross in the middle
  for (const [x, z] of [[-0.55, -1.33], [0.55, -1.33], [-0.55, 1.23], [0.55, 1.23]] as const) {
    body.add(cyl(0.02, 0.02, 0.2, k.black, x, 2.65, z, 5));
    const p = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.42, 6), k.plume);
    p.position.set(x, 2.95, z);
    p.rotation.x = Math.PI;
    body.add(p);
    const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 4), k.plume);
    tuft.position.set(x, 3.12, z);
    body.add(tuft);
  }
  body.add(box(0.05, 0.36, 0.05, k.fringe, 0, 2.88, -0.05));
  body.add(box(0.2, 0.05, 0.05, k.fringe, 0, 2.95, -0.05));
  // the coachman's box in front of the canopy, and the coachman in black with his top hat
  body.add(box(0.9, 0.5, 0.5, k.black, 0, 1.2, 1.55));
  body.add(box(0.95, 0.06, 0.55, k.wood, 0, 1.48, 1.52));
  body.add(box(0.7, 0.05, 0.4, k.black, 0, 0.95, 1.95)); // the footboard
  const man = new THREE.Group();
  man.position.set(0, 1.5, 1.5);
  man.add(cyl(0.15, 0.2, 0.62, k.black, 0, 0.32, 0, 7)); // coat
  man.add(box(0.3, 0.12, 0.34, k.black, 0, 0.06, 0.16)); // thighs on the seat
  man.add(box(0.26, 0.4, 0.1, k.black, 0, -0.14, 0.36)); // shins to the footboard
  man.add(cyl(0.05, 0.05, 0.08, k.skin, 0, 0.66, 0, 6)); // neck
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 7, 5), k.skin);
  head.position.set(0, 0.78, 0);
  man.add(head);
  man.add(cyl(0.14, 0.14, 0.02, k.black, 0, 0.87, 0, 10)); // brim
  man.add(cyl(0.085, 0.09, 0.2, k.black, 0, 0.97, 0, 8)); // crown
  for (const side of [-1, 1]) {
    const arm = box(0.07, 0.07, 0.36, k.black, side * 0.17, 0.42, 0.16);
    arm.rotation.x = 0.35;
    man.add(arm);
  }
  body.add(man);
  // the pole and the bar the horses pull on
  body.add(box(0.07, 0.07, 2.4, k.wood, 0, 0.72, 2.9));
  body.add(box(1.3, 0.06, 0.06, k.wood, 0, 0.72, 2.2));
  // the coffin on the bed (foot forward), under the canopy
  coffin.position.set(0, 1.16, -0.1);
  coffin.visible = false;
  body.add(coffin);
  scene.add(group);

  const horses = props ? new HorsePool(scene, props, 2) : null;
  let gait = 0;
  let lastX = NaN;
  let lastZ = NaN;

  return {
    group,
    set(x, z, yaw, walk, y = 0) {
      group.position.set(x, y, z);
      group.rotation.y = yaw;
      const moved = Number.isFinite(lastX) ? Math.hypot(x - lastX, z - lastZ) : 0;
      lastX = x;
      lastZ = z;
      gait = (gait + moved / 1.9) % 1;
      for (const w of wheels) w.w.rotation.x += moved / w.r;
      // the reins: the coachman nods a little with the walk
      man.rotation.x = Math.sin(gait * Math.PI * 4) * 0.03 * walk;
      if (horses) {
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        for (let i = 0; i < 2; i++) {
          const lx = i ? 0.55 : -0.55;
          const lz = 4.0;
          horses.set(i, x + lx * c + lz * s, z - lx * s + lz * c, yaw, gait, Math.min(1, walk), false);
        }
        horses.show("hearse", true);
        horses.commit();
      }
    },
    coffin(on) {
      coffin.visible = on;
    },
    dispose() {
      group.removeFromParent();
      group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      if (horses) horses.group.removeFromParent();
    },
  };
}
