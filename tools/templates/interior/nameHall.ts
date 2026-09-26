// TEMPLATE (docs/building-with-interior.md): copy to client/src/world/<name>Hall.ts and fill in. The prison's is the
// example (client/src/world/prisonHall.ts). The building in the world: its room with every window and door an opening
// (the street drawn through them from inside only where that part can see them), its courts, its life.

import * as THREE from "three";
import * as NP from "../../../shared/namePlan";
import type { ShellOpening } from "../../../shared/shellOpening";
import { buildName } from "./nameRooms";
import { createHallInWorld, type HallInWorld } from "./hallInWorld";
import { windowOpenings } from "./realOpenings";
import type { World } from "./rijnkaai";
import type { InWorld } from "./inworld";
import * as HP from "../../../shared/hallPlan";

/** Where paths() checks the building (the plan's frame; while it is open). */
export const NAME_POINTS: HallInWorld["points"] = [{ label: "the <name>, inside its door", x: 0, z: 1.5, reach: 1.0 }];

export function nameInWorld(world: World, inWorld: InWorld) {
  const built = buildName();
  // from inside, only the windows of the eye's part and the parts it sees bring the street in
  let at = new THREE.Vector3(NaN, 0, 0);
  let zone: NP.Zone | null = null;
  const seen = (o: ShellOpening) => {
    const zid = NP.zoneOf(o)?.id;
    if (!zid) return undefined;
    return (eye: THREE.Vector3) => {
      if (!eye.equals(at)) {
        at = eye.clone();
        const [lx, lz] = HP.toLocal(NP.PLAN, eye.x, eye.z);
        zone = NP.zoneAt(lx, eye.y, lz);
      }
      return !zone || NP.sees(zone.id, zid);
    };
  };
  const toW = (x: number, z: number) => HP.toWorld(NP.PLAN, x, z);
  const hall = createHallInWorld(world, inWorld, NP.PLAN, built.room, { color: 0x22201c, near: 12, far: 60 }, NAME_POINTS, [], 0.3, windowOpenings(built.windows, toW, seen));
  return {
    hall,
    update(t: number, dt: number, hour: number, daylight: number, sky: number) {
      hall.doorOpen = hour >= 7 && hour < 19; // TODO: the server's hours
      hall.update(t, dt, daylight, sky);
      built.night(NP.nameLights(hour), THREE.MathUtils.clamp((0.45 - daylight) / 0.25, 0, 1));
      built.glass.opacity = 0.12 + 0.28 * daylight * (1 - hall.insideness(at.x, at.z));
    },
    pathPoints: () => (hall.doorOpen ? NAME_POINTS.map((p) => ({ ...p, x: hall.world(p.x, p.z)[0], z: hall.world(p.x, p.z)[1] })) : []),
  };
}
