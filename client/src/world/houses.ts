import { housePlan, type CityHouse, type HousePlan, type InworldEntry } from "../../../shared/housePlan";
import { CLASSES, type HomeClass } from "../../../shared/homes";
import LIST from "../../../shared/inworld_houses.json";

// M7 taverns and homes in the world: the plans of the city houses whose insides stand in the world
// (shared/inworld_houses.json, shared/housePlan.ts), by id ("tavern:ankere", "poesje", "home:garret").
// The city plan is loaded on its own (world/occlusion.ts loads the same chunk).

export async function loadHousePlans(): Promise<Map<string, HousePlan>> {
  const build = (await import("../../../shared/city_build.json")).default as unknown as { houses: CityHouse[]; ground_h: number; storey_h: number };
  const out = new Map<string, HousePlan>();
  for (const e of (LIST as unknown as { houses: InworldEntry[] }).houses) {
    const h = build.houses[e.house];
    if (!h) continue;
    if (h.gone) {
      console.warn(`in-world house ${e.id}: house ${e.house} is pulled down (city_build.json "gone")`);
      continue;
    }
    try {
      out.set(e.id, housePlan(e, h, build.ground_h, build.storey_h, e.cls ? CLASSES[e.cls as HomeClass] : undefined));
    } catch (err) {
      console.warn(`in-world house ${e.id}:`, err);
    }
  }
  return out;
}
