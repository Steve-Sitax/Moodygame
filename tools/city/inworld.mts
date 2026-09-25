// M7 taverns and homes in the world: write shared/inworld_build.json (what tools/blender/build_city.py
// cuts in each listed house: the door without its leaf, the window holes) from shared/inworld_houses.json
// and shared/housePlan.ts, so the Blender build and the game work from the same numbers.
//
//   node tools/city/inworld.mts           write shared/inworld_build.json
//   node tools/city/inworld.mts --check   only check: every listed door is its house's door (after plan.py)
//   node tools/city/inworld.mts --repick  move each entry to the nearest house that fits (after a redesign)
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

// --repick (after the map is redesigned, 2026-09-25): each entry moves to the nearest house that fits, by its old
// door: a front on a street, not a storehouse, no covered passage; a tavern at least 5.8 m wide and 10 m deep, a
// home room's class with room to spare; the alley home in an alley house (tools/city/alleys.py)
if (process.argv.includes("--repick")) {
  const taken = new Set<number>();
  for (const e of list.houses) {
    const cls = e.cls ? (CLASSES as Record<string, { W: number; D: number }>)[e.cls] : undefined;
    const needL = e.kind === "tavern" ? 5.8 : e.kind === "cellar" ? 5.0 : (cls?.W ?? 3.5) + (e.cls === "alley" ? 0.3 : 1.0);
    // (a home up or down a flight needs the stair behind its room: the merchant's floor, the garret, the cellar)
    const needD = e.kind === "tavern" ? 10 : e.kind === "cellar" ? 10 : e.cls === "alley" ? (cls?.D ?? 5) + 0.2 : e.cls === "widow" ? (cls?.D ?? 4.5) + 4 : 13;
    let best: [number, number] | null = null;
    build.houses.forEach((h, i) => {
      const hh = h as CityHouse & { store?: string; poort?: unknown; alley?: boolean; street?: number[]; gone?: boolean };
      if (taken.has(i) || hh.store || hh.poort || hh.gone || !hh.rect || !hh.street?.[0]) return;
      if ((e.cls === "alley") !== !!hh.alley) return;
      const f = houseFrame(h);
      if (f.L < needL || f.depth < needD) return;
      try {
        housePlan(e, h, build.ground_h, build.storey_h, cls as never);
      } catch {
        return;
      }
      const d = Math.hypot(f.origin.x - e.door[0], f.origin.z - e.door[1]);
      if (!best || d < best[1]) best = [i, d];
    });
    if (!best) {
      console.error(`${e.id}: no house fits`);
      continue;
    }
    const [i, d] = best as [number, number];
    const f = houseFrame(build.houses[i]);
    console.log(`${e.id}: house ${e.house} -> ${i}, ${d.toFixed(1)} m from the old door`);
    taken.add(i);
    e.house = i;
    e.door = [Math.round(f.origin.x * 10) / 10, Math.round(f.origin.z * 10) / 10];
  }
  const file = path.join(root, "shared", "inworld_houses.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  raw.houses = list.houses;
  fs.writeFileSync(file, JSON.stringify(raw, null, 1) + "\n");
}

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
