// M7 taverns and homes in the world: write shared/inworld_build.json (what tools/blender/build_city.py
// cuts in each listed house: the door without its leaf, the window holes) from shared/inworld_houses.json
// and shared/housePlan.ts, so the Blender build and the game work from the same numbers.
//
//   node tools/city/inworld.mts           write shared/inworld_build.json
//   node tools/city/inworld.mts --check   only check: every listed door is its house's door (after plan.py)
//
// Run it after tools/city/plan.py and before build_city.py.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { housePlan, houseFrame, type CityHouse, type InworldEntry } from "../../shared/housePlan.ts";
import { CLASSES } from "../../shared/homes.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const build = JSON.parse(fs.readFileSync(path.join(root, "shared", "city_build.json"), "utf8")) as { houses: CityHouse[]; ground_h: number; storey_h: number };
const list = JSON.parse(fs.readFileSync(path.join(root, "shared", "inworld_houses.json"), "utf8")) as { houses: InworldEntry[] };

let bad = 0;
const out: Array<Record<string, unknown>> = [];
for (const e of list.houses) {
  const h = build.houses[e.house];
  if (!h) {
    console.error(`${e.id}: no house ${e.house}`);
    bad++;
    continue;
  }
  const f = houseFrame(h);
  const off = Math.hypot(f.origin.x - e.door[0], f.origin.z - e.door[1]);
  if (off > 0.25) {
    console.error(`${e.id}: house ${e.house}'s door is at ${f.origin.x.toFixed(2)}, ${f.origin.z.toFixed(2)}, the list says ${e.door} (${off.toFixed(2)} m off): the plan changed, fix the list`);
    bad++;
  }
  const p = housePlan(e, h, build.ground_h, build.storey_h, e.cls ? CLASSES[e.cls as keyof typeof CLASSES] : undefined);
  out.push({ id: e.id, house: e.house, kind: e.kind, door: p.door, holes: p.holes });
  console.log(`${e.id.padEnd(16)} house ${String(e.house).padStart(3)}  ${f.L.toFixed(2)} x ${f.depth.toFixed(2)} m  door w ${p.door.w}  holes ${p.holes.length}  levels ${p.levels.length}  flights ${p.flights.length}`);
}
if (bad) process.exit(1);
if (!process.argv.includes("--check")) {
  const file = path.join(root, "shared", "inworld_build.json");
  fs.writeFileSync(file, JSON.stringify({ note: "Written by tools/city/inworld.mts; read by tools/blender/build_city.py. Do not edit.", houses: out }, null, 1) + "\n");
  console.log(`-> ${path.relative(root, file)}`);
}
