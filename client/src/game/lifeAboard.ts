import * as THREE from "three";
import type { Boats, BoatName } from "../world/boats";
import { makeHuman, type Human, type HumanKind, type Motion } from "./humans";

// Life aboard (M7 boats): the barges were homes. On a few of the Flemish and Rhine barges moored at the
// Werf, the north Rijnkaai and the Petit Bassin a family lives aboard: the skipper with his pipe at the
// stern, his wife at the wash tub on the after deck (her washing is on the line over the cabin, boats.glb),
// a child sitting on the hatch. They ride with the boat (her live matrix: the heave, the roll, the tide)
// and are drawn only near the eye. game/rowing.ts makes and updates this.

/** Where to look for a barge with a family (the nearest hengst or Rhine barge of a moored row to each point). */
const SPOTS: Array<[number, number]> = [
  [-287, -6],
  [-228, -4],
  [150, -6],
  [72, 78],
  [120, 108],
];
/** Drawn within this distance of the eye (m). */
const NEAR = 70;

interface Member {
  kind: HumanKind;
  motion: Motion;
  /** In the boat's frame (game axes: x across, y up from the waterline, z toward the bow), and the way she faces. */
  at: [number, number, number];
  yaw: number;
  /** Sitting on something this high over the deck (the hatch's coaming). */
  sit?: number;
}

/** The family's places on each kind of barge (from tools/blender/build_boats.py barge(): the cabin aft, the deck heights). */
const CREW: Partial<Record<BoatName, Member[]>> = {
  hengst: [
    { kind: "sailor_b", motion: "smoke", at: [0.55, 1.3, -9.75], yaw: 0.3 },
    { kind: "wife_a", motion: "wash", at: [-1.15, 0.74, -6.2], yaw: Math.PI / 2 },
    { kind: "boy", motion: "sit", at: [1.55, 0.74, -5.1], yaw: -Math.PI / 2, sit: 0.4 },
  ],
  rhine_barge: [
    { kind: "old_man", motion: "smoke", at: [0.7, 1.22, -16.1], yaw: 0.2 },
    { kind: "wife_b", motion: "wash", at: [-1.4, 0.8, -11.4], yaw: Math.PI / 2 },
    { kind: "girl", motion: "sit", at: [1.8, 0.8, -9.9], yaw: -Math.PI / 2, sit: 0.45 },
  ],
};

interface Family {
  world: THREE.Matrix4;
  x: number;
  z: number;
  members: Member[];
  group: THREE.Group | null;
  people: Human[];
}

export class LifeAboard {
  private families: Family[] = [];

  constructor(
    private readonly scene: THREE.Object3D,
    boats: Boats,
  ) {
    const rows = boats.placements().filter((p) => !p.single && p.world && CREW[p.name]);
    const used = new Set<THREE.Matrix4>();
    for (const [sx, sz] of SPOTS) {
      const best = rows.filter((p) => !used.has(p.world!)).sort((a, b) => Math.hypot(a.x - sx, a.z - sz) - Math.hypot(b.x - sx, b.z - sz))[0];
      if (!best || Math.hypot(best.x - sx, best.z - sz) > 30) continue;
      used.add(best.world!);
      this.families.push({ world: best.world!, x: best.x, z: best.z, members: CREW[best.name]!, group: null, people: [] });
    }
  }

  /** Families aboard now (dev, the boat check). */
  info() {
    return this.families.map((f) => ({ x: Math.round(f.x), z: Math.round(f.z), drawn: !!f.group?.visible, people: f.members.length }));
  }

  update(dt: number, eye: THREE.Vector3): void {
    for (const f of this.families) {
      const near = Math.hypot(f.x - eye.x, f.z - eye.z) < NEAR;
      if (!near) {
        if (f.group) f.group.visible = false;
        continue;
      }
      if (!f.group) {
        f.group = new THREE.Group();
        f.group.name = "life_aboard";
        f.group.matrixAutoUpdate = false;
        for (const m of f.members) {
          const h = makeHuman(m.kind);
          if (!h) continue;
          const g = new THREE.Group();
          g.position.set(m.at[0], m.at[1] + (m.sit && h.canSit ? h.sitDrop(m.sit) : 0), m.at[2]);
          g.rotation.y = m.yaw;
          g.add(h.root);
          h.play(m.sit && !h.canSit ? "idle" : m.motion, 0);
          f.group.add(g);
          f.people.push(h);
        }
        this.scene.add(f.group);
      }
      f.group.visible = true;
      f.group.matrix.copy(f.world);
      f.group.matrixWorldNeedsUpdate = true;
      for (const h of f.people) h.update(dt);
    }
  }
}
