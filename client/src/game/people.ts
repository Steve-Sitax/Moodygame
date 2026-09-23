import * as THREE from "three";
import { doorSpot } from "../world/city";
import { psx } from "../retro/psx";
import { box, cyl, rectAround } from "../world/geom";
import type { World } from "../world/rijnkaai";
import type { FirstPerson } from "../player/firstPerson";
import { api } from "../net/api";
import { Human, makeHuman, whenHumans, type HumanKind } from "./humans";

// The people of the Rijnkaai (M3), standing where their work is. They turn to
// face you when you come near and move their hands when you stand close.
// Bodies are the rigged models from people.glb (humans.ts); the grey-box
// shapes below stand in until the models load, or for good if they fail.
// What they say comes from the server (dialogue hook).

export interface NpcDef {
  id: string;
  name: string;
  x: number;
  z: number;
  /** Height they stand at (the sailor stands on the ship's deck). */
  y?: number;
  yaw: number;
  talks: boolean;
  /** Which model from people.glb (default: the id). */
  model?: HumanKind;
  /** Grey-box stand-in, used until (or if not) the model loads. */
  build: (m: Mat) => THREE.Object3D[];
}

type Mat = (hex: number) => THREE.Material;

const coat = (m: Mat, c: number, r0 = 0.2, r1 = 0.34, h = 1.3) => {
  const b = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, 6), m(c));
  b.position.y = h / 2 + 0.07;
  return b;
};
const head = (m: Mat, y = 1.5, c = 0x7a6454) => {
  const h = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), m(c));
  h.position.y = y;
  return h;
};

export const NPCS: NpcDef[] = [
  {
    id: "sooi",
    name: "Sooi",
    x: doorSpot("hessenatie", 1.6, -2.2).x,
    z: doorSpot("hessenatie", 1.6, -2.2).z,
    yaw: Math.PI,
    talks: true,
    build: (m) => {
      const b = coat(m, 0x4a4036, 0.24, 0.38, 1.3);
      b.scale.x = 1.15;
      const cap = cyl(0.15, 0.15, 0.07, 8, m(0x1a1a1a), 0, 1.63, 0);
      const peak = box(0.18, 0.02, 0.14, m(0x1a1a1a), 0, 1.6, 0.13, 1);
      return [b, head(m, 1.5, 0x80624e), cap, peak];
    },
  },
  {
    id: "peeters",
    name: "Widow Peeters",
    x: doorSpot("peeters", 1.3, -2.0).x,
    z: doorSpot("peeters", 1.3, -2.0).z,
    yaw: Math.PI,
    talks: true,
    build: (m) => {
      const b = coat(m, 0x141414, 0.16, 0.42, 1.25);
      const bonnet = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), m(0x101010));
      bonnet.position.set(0, 1.46, -0.03);
      bonnet.scale.set(1, 1.05, 1.1);
      const ledger = box(0.22, 0.28, 0.04, m(0x3a2a1a), 0.22, 0.95, 0.12, 1);
      return [b, head(m, 1.42, 0x8a7060), bonnet, ledger];
    },
  },
  {
    id: "tuur",
    name: "Tuur",
    x: 8.0,
    z: -7.4,
    yaw: 0,
    talks: true,
    build: (m) => {
      const b = coat(m, 0x1e2a3a, 0.2, 0.3, 1.3);
      const knit = cyl(0.12, 0.14, 0.12, 8, m(0x3a2020), 0, 1.64, 0);
      const pipe = box(0.03, 0.03, 0.12, m(0x2a1a10), 0.05, 1.46, 0.14, 1);
      return [b, head(m, 1.52, 0x7a5a44), knit, pipe];
    },
  },
  {
    id: "fientje",
    name: "Fientje",
    x: 45.2,
    z: 10.2,
    yaw: -Math.PI / 2,
    talks: true,
    build: (m) => {
      const skirt = coat(m, 0x5a2e24, 0.2, 0.44, 1.2);
      const shawl = cyl(0.26, 0.3, 0.3, 6, m(0x6a6a60), 0, 1.15, 0);
      const cap = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), m(0xc8c0b0));
      cap.position.set(0, 1.48, -0.02);
      const basket = box(0.4, 0.22, 0.3, m(0x6a5a3a), 0.36, 0.85, 0, 0.5);
      return [skirt, shawl, head(m, 1.42, 0x9a7060), cap, basket];
    },
  },
  {
    id: "sailor",
    name: "a sailor",
    x: -38.5,
    z: -4.6,
    y: 2.4,
    yaw: 0,
    talks: false,
    build: (m) => {
      const b = coat(m, 0x2a3440, 0.2, 0.3, 1.3);
      const cap = cyl(0.13, 0.13, 0.06, 8, m(0x1a2030), 0, 1.63, 0);
      return [b, head(m, 1.5, 0x7a5a44), cap];
    },
  },
];

const mats = new Map<number, THREE.Material>();
const mat: Mat = (c) => {
  let m = mats.get(c);
  if (!m) mats.set(c, (m = psx(new THREE.MeshLambertMaterial({ color: c }))));
  return m;
};

export class Npc {
  readonly group = new THREE.Group();
  readonly pos: THREE.Vector3;
  private facing: number;
  private lastNear = -Infinity;
  private body = new THREE.Group();
  private human: Human | null = null;
  /** Seconds left of a hand gesture, and the pause before the next one. */
  private gesture = 0;
  private gestureWait = 1 + Math.random() * 2;

  constructor(readonly def: NpcDef, world: World) {
    this.pos = new THREE.Vector3(def.x, def.y ?? 0, def.z);
    this.facing = def.yaw;
    for (const o of def.build(mat)) this.body.add(o);
    this.group.add(this.body);
    this.group.position.copy(this.pos);
    this.group.rotation.y = def.yaw;
    world.scene.add(this.group);
    if (!def.y) world.addCollider(rectAround(def.x, def.z, 0.35, 0.35));
    whenHumans(() => {
      const h = makeHuman(def.model ?? (def.id as HumanKind));
      if (!h) return;
      this.human = h;
      this.group.remove(this.body);
      this.group.add(h.root);
    });
  }

  get id(): string {
    return this.def.id;
  }

  distTo(x: number, z: number): number {
    return Math.hypot(this.pos.x - x, this.pos.z - z);
  }

  /** Look at a point (eased). */
  lookAt(x: number, z: number): void {
    this.facing = Math.atan2(x - this.pos.x, z - this.pos.z);
  }

  update(dt: number, player: FirstPerson, now: number): void {
    const d = this.distTo(player.x, player.z);
    if (d < 6) this.lookAt(player.x, player.z);
    else this.facing = this.def.yaw;
    const cur = this.group.rotation.y;
    const diff = Math.atan2(Math.sin(this.facing - cur), Math.cos(this.facing - cur));
    this.group.rotation.y = cur + diff * Math.min(1, dt * 3);
    if (this.human) this.animate(dt, d);
    // prefetch the opening line while Jef walks up (docs/03 pacing)
    if (this.def.talks && d < 10 && now - this.lastNear > 60_000) {
      this.lastNear = now;
      api.near(this.id).catch(() => {});
    }
  }

  /** Idle; when you stand close, now and then a few words with the hands. */
  private animate(dt: number, d: number): void {
    const h = this.human!;
    if (this.def.talks && d < 3.2) {
      if (this.gesture > 0) {
        this.gesture -= dt;
        if (this.gesture <= 0) {
          h.play("idle", 0.5);
          this.gestureWait = 3 + Math.random() * 5;
        }
      } else if ((this.gestureWait -= dt) <= 0) {
        h.play("talk", 0.4);
        this.gesture = h.loopTime * (1 + Math.floor(Math.random() * 2));
      }
    } else if (h.motion !== "idle") {
      this.gesture = 0;
      h.play("idle", 0.5);
    }
    h.update(dt);
  }
}

export class People {
  readonly list: Npc[];

  constructor(world: World) {
    this.list = NPCS.map((d) => new Npc(d, world));
    rowingBoat(world);
  }

  get(id: string): Npc | undefined {
    return this.list.find((n) => n.id === id);
  }

  /** Nearest person you could talk to, within reach. */
  nearestTalker(x: number, z: number, reach = 2.6): Npc | null {
    let best: Npc | null = null;
    let bestD = reach;
    for (const n of this.list) {
      if (!n.def.talks) continue;
      const d = n.distTo(x, z);
      if (d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  }

  update(dt: number, player: FirstPerson): void {
    const now = performance.now();
    for (const n of this.list) n.update(dt, player, now);
  }
}

/** Tuur's rowing boat, tied up beside the pier. */
function rowingBoat(world: World): void {
  const m = world.mats;
  const g = new THREE.Group();
  g.position.set(10.1, -1.75, -8);
  g.add(box(1.1, 0.35, 3.4, m.hull, 0, 0.1, 0, 1));
  g.add(box(0.9, 0.05, 0.25, m.darkWood, 0, 0.3, -0.4, 1)); // thwart
  g.add(box(0.9, 0.05, 0.25, m.darkWood, 0, 0.3, 0.8, 1));
  const bow = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.8, 4), m.hull);
  bow.rotation.set(Math.PI / 2, Math.PI / 4, 0);
  bow.scale.set(1, 1, 0.4);
  bow.position.set(0, 0.1, -2.05);
  g.add(bow);
  for (const s of [-1, 1]) {
    const oar = box(0.05, 0.03, 2.6, m.darkWood, s * 0.35, 0.36, 0.3, 1);
    oar.rotation.y = s * 0.08;
    g.add(oar);
  }
  world.scene.add(g);
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.2, 4), m.rope);
  rope.position.set(9.4, -0.8, -7.2);
  rope.rotation.z = 1.1;
  world.scene.add(rope);
}
