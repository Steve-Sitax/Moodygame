import { doorKeepOut as cathedralKeep } from "../../../shared/cathedralPlan";
import { frontKeepOut as carolusKeep } from "../../../shared/carolusPlan";
import { gothicKeepOut } from "../../../shared/gothicPlan";
import { doorKeepOut, type Rect } from "../../../shared/hallPlan";
import { PLAN as OOSTERSHUIS } from "../../../shared/oostershuisPlan";
import { PLAN as STEEN } from "../../../shared/steenPlan";
import { PLAN as TOWNHALL } from "../../../shared/townhallPlan";
import { PLAN as VLEESHUIS } from "../../../shared/vleeshuisPlan";

// M7 doors (2026-09-25): the landmarks' street doors are walk-in doorways now, so nothing the town sets
// down (carts, crates, casks, stalls, benches, pumps, lamps, clutter) may stand on a porch's steps or
// before a door. One box per door and per porch step (shared/hallPlan.ts doorKeepOut); the placers take
// these with their other keep-outs (world/rijnkaai.ts).

/** Every landmark door's keep-out, in world boxes: the doorway's width and a metre each side, out over the steps and the street before them. */
export function landmarkDoorKeepOut(): Rect[] {
  return [...[TOWNHALL, VLEESHUIS, OOSTERSHUIS, STEEN].flatMap((p) => doorKeepOut(p)), ...cathedralKeep(), ...carolusKeep(), ...gothicKeepOut()];
}
