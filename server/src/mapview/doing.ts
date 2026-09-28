import type { Resident, Town } from "../town/population.ts";
import type { RunNow } from "../town/runs.ts";
import type { Where } from "../town/whereabouts.ts";
import { placeLabel } from "./model.ts";

// What a townsperson is doing, in plain English, for the town map (the trade plan: "every dot on the town map says
// what he is doing"). The engine's own words from his day plan and the sum (town/whereabouts.ts), or the run he is
// on (town/runs.ts). No model call.

/** Hours of the night: someone at home is asleep. */
const asleep = (hour: number) => {
  const h = ((hour % 24) + 24) % 24;
  return h >= 22.5 || h < 5.5;
};

/** "Walking to work at the Hessenatie", "Walking home", "Going to mass at the cathedral". */
function goingTo(r: Resident, town: Town, act: string, place: string): string {
  const label = placeLabel(r, town, act, place);
  switch (act) {
    case "home":
      return "home";
    case "work":
      return r.work.place === "home" ? "home to work" : `work at ${label}`;
    case "tavern":
      return `the tavern (${label})`;
    case "church":
      return `mass at ${label}`;
    case "market":
      return `the market (${label})`;
    case "play":
      return `play at ${label}`;
    case "stroll":
      return `a walk at ${label}`;
    default:
      return label;
  }
}

/** At work: the trade's own line ("Selling fish at the Vismarkt", "On guard at the Kipdorp gate"). */
function atWork(r: Resident, town: Town): string {
  const w = r.work;
  const label = placeLabel(r, town, "work", "work");
  switch (w.kind) {
    case "stall": {
      const goods = typeof w.stall === "number" ? town.stalls[w.stall]?.goods : undefined;
      return goods ? `Selling ${goods} at ${label}` : `At the stall at ${label}`;
    }
    case "shop":
      return `Serving at ${label}`;
    case "tavern":
      return `Keeping ${label}`;
    case "inside":
      return w.place === "home" ? "Working at home" : `Working inside at ${label}`;
    case "guard":
      return `On guard at ${label}`;
    case "post":
      return `At the post at ${label}`;
    case "beg":
      return `Begging at ${label}`;
    case "wait":
      return `Waiting by the family's chests at ${label}`;
    case "haul":
      return `Carrying loads between the quay and the door at ${label}`;
    case "patrol":
      return `On the round (${label})`;
    case "inspect":
      return `Checking the landings (${label})`;
    case "round":
      return `On a round of the doors (${label})`;
    case "roam":
      return r.trade === "child" || r.trade === "street_child" ? `Playing at ${label}` : `About the work at ${label}`;
    default:
      return `At work at ${label}`;
  }
}

/**
 * The line for a resident the sum places (not seen live): on a run (the run's own words), on his way to the next part
 * of his day, on his round, or there.
 */
export function doingLine(r: Resident, town: Town, w: Where, hour: number, run: RunNow | null): string {
  if (run) return run.doing;
  if (w.moving && w.leg === undefined && w.total > 0) {
    const left = Math.max(0, Math.round(w.total - w.walked));
    const where = goingTo(r, town, w.act, w.place);
    return `${w.run ? "Running" : "Walking"} ${where === "home" ? "home" : `to ${where}`}${left >= 1 ? ` (${left} m to go)` : ""}`;
  }
  switch (w.act) {
    case "home":
      return asleep(hour) ? "Asleep at home" : "At home";
    case "work":
      return atWork(r, town);
    case "tavern":
      return `Drinking at ${placeLabel(r, town, w.act, w.place)}`;
    case "church":
      return `At mass at ${placeLabel(r, town, w.act, w.place)}`;
    case "market":
      return `At the market (${placeLabel(r, town, w.act, w.place)})`;
    case "play":
      return `Playing at ${placeLabel(r, town, w.act, w.place)}`;
    case "stroll":
      return `Out for a walk at ${placeLabel(r, town, w.act, w.place)}`;
    case "loiter":
      return `Hanging about at ${placeLabel(r, town, w.act, w.place)}`;
    default:
      return placeLabel(r, town, w.act, w.place);
  }
}
