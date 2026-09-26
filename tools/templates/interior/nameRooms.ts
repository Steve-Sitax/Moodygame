// TEMPLATE (docs/building-with-interior.md): copy to client/src/world/<name>Rooms.ts and fill in. The prison's is the
// example (client/src/world/prisonRooms.ts). The rooms at the shell's true size, in the plan's frame; every face of the
// shell lined, its openings cut through the lining; the glass the room's.

import * as THREE from "three";
import * as HP from "../../../shared/hallPlan";
import * as NP from "../../../shared/namePlan";
import { SHELL_OPENINGS } from "../../../shared/nameShell";
import type { ShellFace, ShellOpening } from "../../../shared/shellOpening";
import { Kit, lmMat } from "./landmarkKit";
import { walkGraph, type LandmarkRoom } from "./landmarkRooms";
import { frameRoom, plaster, tex } from "./rooms";
import { glassPanes, lining } from "./realOpenings";

const C = {
  wash: lmMat("name_wash", { map: plaster(7, [206, 198, 180]), color: 0xd0c8b8, emissive: 0x000000 }, 0.05),
  boards: lmMat("name_boards", { map: tex().planks, color: 0x8a6a4c }, 0.1),
};
const F = (a: [number, number], c: [number, number], n: [number, number]): ShellFace => ({ a, c, n });

export interface NameBuilt {
  room: LandmarkRoom;
  windows: ShellOpening[];
  glass: THREE.MeshBasicMaterial;
  night(lit: ReturnType<typeof NP.nameLights>, dusk: number): void;
}

export function buildName(): NameBuilt {
  const P = NP.PLAN;
  const { scene, group, toWorld } = frameRoom(P.origin, P.yaw, 0x22201c);
  scene.background = null;
  group.position.y = NP.FLOOR_Y;
  group.updateMatrixWorld(true);
  const k = new Kit(group); // one kit per part for a big building
  const windows = SHELL_OPENINGS.filter((o) => NP.zoneOf(o));
  const line = (L: Parameters<typeof lining>[2]) => lining(k, C.wash, L, windows, NP.FLOOR_Y);
  // TODO: every face of the shell: from its reveal's back (the openings' depth) to the room's inner face
  line({ face: F([-5.6, 0], [5.6, 0], [0, -1]), from: 0.3, to: 0.6, y0: NP.FLOOR_Y, y1: 7.0 });
  // floors, ceilings, partitions, stairs, the things in the rooms ...
  k.box(10, 0.05, 7.4, 0, -0.025, 4.3, C.boards, { tile: 1.2 });
  k.finish();
  const glass = new THREE.MeshBasicMaterial({ color: 0x56646e, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
  const gg = glassPanes(windows, NP.FLOOR_Y);
  if (gg) {
    const m = new THREE.Mesh(gg, glass);
    m.userData.glass = true;
    m.renderOrder = 5;
    group.add(m);
  }
  const hemi = new THREE.HemisphereLight(0xd0d0c8, 0x3a3630, 1.0);
  scene.add(hemi);
  let ambK = 1;
  let day = 1;
  const light = () => (hemi.intensity = (0.9 + 1.3 * day) * ambK);
  const free = (x: number, z: number) => HP.freeAt(P, x, z, 0.25, false);
  const room: LandmarkRoom = {
    kind: "landmark",
    landmark: "name" as unknown as LandmarkRoom["landmark"],
    scene,
    group,
    walk: (fx, fz, x, z) => (free(x, z) ? [x, z] : [fx, fz]),
    floor: (x, z) => HP.floorAt(P, x, z, 0),
    peopleFloor: () => 0,
    seats: [],
    stands: [],
    exit: { ...P.marks.door },
    entry: { ...P.marks.inside },
    entries: { main: { ...P.marks.inside } },
    exits: { main: { ...P.marks.door } },
    lamps: [],
    toWorld,
    pace: 1.2,
    eye: 1.6,
    surface: "wood",
    sound: "room",
    marks: { ...P.marks },
    sets: {},
    looks: [],
    path: walkGraph(P.nodes, free),
    setDaylight(kd) {
      day = kd;
      light();
    },
    setAmbient(a) {
      ambK = a;
      light();
    },
    update() {},
  };
  return {
    room,
    windows,
    glass,
    night(lit, dusk) {
      // a lit part glows through its windows at night: its own emissive, not a light more
      void lit;
      void dusk;
    },
  };
}
