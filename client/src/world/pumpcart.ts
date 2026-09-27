import * as THREE from "three";
import { psx } from "../retro/psx";
import { HorsePool } from "./horses";
import { WALK_STRIDE } from "./horseGait";
import type { Props } from "./props3d";

// The pompiers' fire pump (M6 town life), built in code: a hand pump of the 1860s-70s on a
// four-wheeled carriage, as Belgian and Dutch brigades had them (a "brandspuit"): the pump box
// with its brass air vessel, long brakes (handles) along both sides that the men work up and
// down, a hose reel at the back, and a pole with two horses in front (world/horses.ts, the dray
// horse of props.glb). Local frame: +z is where it goes, y up, the carriage centre at 0.

export interface PumpCart {
  group: THREE.Group;
  /** Put it at (x, z) facing yaw; `trot` 0 standing .. 1 at a trot; `pumping` the men at the brakes; `y` the ground there. */
  set(x: number, z: number, yaw: number, trot: number, t: number, pumping: boolean, y?: number): void;
  /** A hose from the pump to this point (null: rolled up). */
  hoseTo(p: { x: number; z: number } | null): void;
  dispose(): void;
}

let mats: Record<string, THREE.Material> | null = null;
function m(): Record<string, THREE.Material> {
  mats ??= {
    // (fixes 2026-09-24: the pump was hard to see in a lane at dusk: a brighter red, and a lantern)
    // (a little light of their own: at a fire by night it stands in the glow of the flames)
    red: psx(new THREE.MeshLambertMaterial({ color: 0xb03a2c, emissive: 0x3a0c06 })),
    wood: psx(new THREE.MeshLambertMaterial({ color: 0x6a4a2c, emissive: 0x160c04 })),
    dark: psx(new THREE.MeshLambertMaterial({ color: 0x2a2420 })),
    iron: psx(new THREE.MeshLambertMaterial({ color: 0x2c2c2e })),
    brass: psx(new THREE.MeshLambertMaterial({ color: 0xd8aa48, emissive: 0x3a2a08 })),
    lamp: new THREE.MeshBasicMaterial({ color: 0xffc27a }),
    hose: psx(new THREE.MeshLambertMaterial({ color: 0x4a3222 })),
  };
  return mats;
}

/** A pole from its heel (y, z) up to its head between the horses' collars (the kidney links, build_props.py KIDNEY:
 * 1.385 m up, 1.2 m ahead of the horses' middles). */
function pole(mat: THREE.Material, y0: number, z0: number, y1: number, z1: number): THREE.Mesh {
  const len = Math.hypot(y1 - y0, z1 - z0);
  const m = box(0.07, 0.07, len, mat, 0, (y0 + y1) / 2, (z0 + z1) / 2);
  m.rotation.x = -Math.atan2(y1 - y0, z1 - z0);
  return m;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  o.position.set(x, y, z);
  return o;
}
function cyl(r: number, h: number, mat: THREE.Material, x: number, y: number, z: number, seg = 8): THREE.Mesh {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  o.position.set(x, y, z);
  return o;
}

let glowTex: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, "rgba(255,200,120,0.9)");
  grd.addColorStop(0.45, "rgba(255,150,60,0.3)");
  grd.addColorStop(1, "rgba(255,120,40,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  return (glowTex = new THREE.CanvasTexture(c));
}

/** A spoked wheel lying in the y-z plane (its axle along x). */
function wheel(r: number, k: Record<string, THREE.Material>): THREE.Group {
  const g = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 4, 14), k.iron);
  rim.rotation.y = Math.PI / 2;
  g.add(rim);
  const hub = cyl(0.07, 0.16, k.wood, 0, 0, 0, 6);
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  for (let i = 0; i < 6; i++) {
    const s = box(0.03, r * 2, 0.03, k.wood, 0, 0, 0);
    s.rotation.x = (i / 6) * Math.PI;
    g.add(s);
  }
  return g;
}

export function createPumpCart(scene: THREE.Scene, props: Props | null): PumpCart {
  const k = m();
  const group = new THREE.Group();
  group.name = "fire_pump";
  const body = new THREE.Group();
  group.add(body);
  // the carriage and the wheels (big at the back, small in front)
  body.add(box(1.0, 0.1, 2.5, k.wood, 0, 0.72, 0));
  const wheels: Array<{ w: THREE.Group; r: number }> = [];
  for (const [x, z, r] of [[-0.62, -0.8, 0.5], [0.62, -0.8, 0.5], [-0.58, 0.85, 0.38], [0.58, 0.85, 0.38]] as const) {
    const w = wheel(r, k);
    w.position.set(x, r, z);
    body.add(w);
    wheels.push({ w, r });
  }
  // the pump box, the brass air vessel with its dome, the delivery branch
  body.add(box(0.8, 0.62, 1.05, k.red, 0, 1.08, -0.1));
  body.add(cyl(0.13, 0.62, k.brass, 0, 1.62, -0.1, 10));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), k.brass);
  dome.position.set(0, 1.93, -0.1);
  body.add(dome);
  // (the brass cylinder turned, not the body: add() gives back the parent, and the pump lay on its side)
  const outlet = cyl(0.04, 0.3, k.brass, 0.45, 1.0, -0.4, 6);
  outlet.rotation.z = Math.PI / 2;
  body.add(outlet);
  // the brakes: a long handle each side on a rocking beam over the pump
  const brakes: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const b = new THREE.Group();
    b.position.set(side * 0.62, 1.42, -0.1);
    b.add(box(0.06, 0.06, 2.9, k.wood, 0, 0, 0));
    for (const z of [-1.4, 1.4]) b.add(box(0.05, 0.05, 0.05, k.iron, 0, 0, z));
    body.add(b);
    brakes.push(b);
  }
  body.add(box(1.3, 0.06, 0.06, k.iron, 0, 1.42, -0.1)); // the rocking shaft
  // the hose reel at the back, the coil wound on it
  const reel = new THREE.Group();
  reel.position.set(0, 1.02, -1.15);
  const drum = cyl(0.22, 0.7, k.hose, 0, 0, 0, 10);
  drum.rotation.z = Math.PI / 2;
  reel.add(drum);
  for (const x of [-0.37, 0.37]) {
    const d = cyl(0.3, 0.04, k.wood, x, 0, 0, 10);
    d.rotation.z = Math.PI / 2;
    reel.add(d);
  }
  body.add(reel);
  // the pole and the bar the horses pull on
  body.add(pole(k.wood, 0.72, 1.15, 1.33, 4.75));
  body.add(box(1.3, 0.06, 0.06, k.wood, 0, 0.72, 2.0));
  // the brigade's lantern on an iron stalk at the front corner, and its glow
  body.add(box(0.04, 0.9, 0.04, k.iron, 0.42, 1.2, 0.55));
  body.add(box(0.2, 0.26, 0.2, k.lamp, 0.42, 1.72, 0.55));
  body.add(box(0.26, 0.05, 0.26, k.iron, 0.42, 1.87, 0.55));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55, fog: true }));
  glow.scale.set(2.4, 2.4, 1);
  glow.position.set(0.42, 1.72, 0.55);
  body.add(glow);
  scene.add(group);

  // two horses side by side in front
  const horses = props ? new HorsePool(scene, props, 2, "chestnut") : null;
  let hose: THREE.Mesh | null = null;
  let gait = 0;
  let lastX = NaN;
  let lastZ = NaN;

  return {
    group,
    set(x, z, yaw, trot, t, pumping, y = 0) {
      group.position.set(x, y, z);
      group.rotation.y = yaw;
      const moved = Number.isFinite(lastX) ? Math.hypot(x - lastX, z - lastZ) : 0;
      lastX = x;
      lastZ = z;
      // a step cycle every 2.6 m at the trot, WALK_STRIDE at the walk (the hooves stay put: horseGait.ts)
      const trotting = trot > 0.3;
      const stride = trotting ? 2.6 : WALK_STRIDE;
      gait = (gait + moved / stride) % 1;
      for (const w of wheels) w.w.rotation.x += moved / w.r;
      // the men work the brakes up and down, about once a second
      const rock = pumping ? Math.sin(t * 6.3) * 0.2 : 0;
      brakes.forEach((b, i) => (b.rotation.x = i ? rock : rock));
      if (horses) {
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        for (let i = 0; i < 2; i++) {
          const lx = i ? 0.55 : -0.55;
          const lz = 3.6;
          // local (x across, z along) to world: x' = x cos + z sin, z' = -x sin + z cos
          horses.set(i, x + lx * c + lz * s, z - lx * s + lz * c, yaw, gait, Math.min(1, trot), trotting, stride);
        }
        horses.show("pump", true);
        horses.commit();
      }
    },
    hoseTo(p) {
      if (hose) {
        hose.removeFromParent();
        hose.geometry.dispose();
        hose = null;
      }
      if (!p) return;
      group.updateMatrixWorld(true);
      // from the delivery branch along the ground to the house
      const a = new THREE.Vector3(0.6, 0.9, -0.4).applyMatrix4(group.matrixWorld);
      const b = new THREE.Vector3(p.x, 0.08, p.z);
      const mid = new THREE.Vector3((a.x + b.x) / 2, 0.08, (a.z + b.z) / 2);
      const curve = new THREE.CatmullRomCurve3([a, new THREE.Vector3(a.x, 0.1, a.z), mid, b]);
      hose = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.035, 4), k.hose);
      scene.add(hose);
    },
    dispose() {
      group.removeFromParent();
      if (hose) hose.removeFromParent();
      if (horses) {
        horses.group.removeFromParent();
      }
    },
  };
}
