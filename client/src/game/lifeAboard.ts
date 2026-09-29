import * as THREE from "three";
import type { Boats, BoatName } from "../world/boats";
import { makeHuman, type Human, type HumanKind, type Motion } from "./humans";
import { LocalRound, type WalkPoint } from "../../../shared/localRound";

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
  round: WalkPoint[];
}

/** The family's places on each kind of barge (from tools/blender/build_boats.py barge(): the cabin aft, the deck heights). */
const CREW: Partial<Record<BoatName, Member[]>> = {
  hengst: [
    { kind: "sailor_b", motion: "smoke", at: [0.55, 1.3, -9.75], yaw: 0.3, round: [[1.2, -9.75], [.85, -10]] },
    { kind: "wife_a", motion: "wash", at: [-1.15, 0.74, -6.2], yaw: Math.PI / 2, round: [[-.3, -6.2], [.6, -5.9]] },
    { kind: "boy", motion: "idle", at: [1.55, 0.74, -5.6], yaw: -Math.PI / 2, round: [[1.55, -6.1], [.85, -6.1]] },
  ],
  rhine_barge: [
    { kind: "old_man", motion: "smoke", at: [0.7, 1.22, -16.1], yaw: 0.2, round: [[1.3, -16.1], [1, -16.3]] },
    { kind: "wife_b", motion: "wash", at: [-1.4, 0.8, -11.4], yaw: Math.PI / 2, round: [[-.4, -11.4], [.7, -11.1]] },
    { kind: "girl", motion: "idle", at: [1.8, 0.8, -10.8], yaw: -Math.PI / 2, round: [[1.8, -11.5], [1.0, -11.5]] },
  ],
};

interface Family {
  kind: BoatName;
  world: THREE.Matrix4;
  x: number;
  z: number;
  members: Member[];
  group: THREE.Group | null;
  people: Array<{ human: Human; root: THREE.Group; member: Member; round: LocalRound }>;
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
      this.families.push({ kind: best.name, world: best.world!, x: best.x, z: best.z, members: CREW[best.name]!, group: null, people: [] });
    }
  }

  /** Families aboard now (dev, the boat check). */
  info() {
    return this.families.map((f) => ({ x: Math.round(f.x), z: Math.round(f.z), drawn: !!f.group?.visible, people: f.members.length,
      routines: f.people.map(p => ({ kind: p.member.kind, x: p.round.x, z: p.round.z, walking: p.round.walking })) }));
  }

  update(dt: number, eye: THREE.Vector3, hour = 12, storm = false): void {
    for (const f of this.families) {
      const near = hour >= 6.5 && hour < 21 && !storm && Math.hypot(f.x - eye.x, f.z - eye.z) < NEAR;
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
          f.people.push({ human: h, root: g, member: m, round: new LocalRound([m.at[0], m.at[2]], [m.round], f.people.length * 7 + Math.abs(f.x | 0), .5, 18) });
        }
        this.scene.add(f.group);
      }
      f.group.visible = true;
      f.group.matrix.copy(f.world);
      f.group.matrixWorldNeedsUpdate = true;
      for (const p of f.people) {
        const { human: h, root: g, member: m, round: r } = p;
        r.update(dt);
        const sitting = r.atHome && m.sit !== undefined && h.canSit;
        h.play(r.walking ? "walk" : r.atHome ? (m.sit && !h.canSit ? "idle" : m.motion) : m.kind === "boy" || m.kind === "girl" ? "idle" : "behind");
        h.setPace(r.speed);
        // Follow the barge's sheer instead of floating over its sloping deck.
        const rhine = f.kind === "rhine_barge", t = .5 + r.z / (rhine ? 34 : 21);
        const deck = (rhine ? .85 : .8) + (rhine ? .75 : .95) * Math.abs(2 * t - 1) ** 3 + (rhine ? .25 : .5) * Math.max(0, (t - .8) / .2) ** 2 - .28;
        g.position.set(r.x, deck + (sitting ? h.sitDrop(m.sit!) : 0), r.z);
        g.rotation.y = r.walking ? r.yaw : r.atHome ? m.yaw : r.yaw + Math.PI;
        h.update(dt);
      }
    }
  }
}
