// Life at the front doors and the children's games (M6 lively, Steve 2026-09-24). Pure code:
// the server makes each resident's week of door life (doorPlan, from their day, trade and
// stats) and the client imports this file to read it by the clock (doorAt) and to know which
// game the children of a square play now (gamesAt). The ENGINE decides who, when and what;
// the client only shows it.
//
// - Scrubbing the step and the pavement in the morning (a Low Countries habit; Saturday is the
//   big scrub): women at home, and a maid at her master's door. Not in rain.
// - Lace at the door: on a dry afternoon, a woman sits on a chair by her door with her lace
//   pillow and bobbins (a seamstress, an old woman, some wives); others knit. Belgium had well
//   over a hundred thousand lace-makers in the 1860s, working at home between their chores.
// - At the window: the gossips lean out of the first-floor window over their door for a while.
// - Flowers: a pious woman takes flowers to the Madonna at the nearest corner (or to Our Lady in
//   the cathedral when she lives near it), after her errands.
//
// Every segment falls in time the person's own day has them at home (or, for a maid, at her
// work); the schedule itself never changes.

// (no imports: the client bundles this file; the schedule's reader is passed in)

export type DoorAct = "scrub" | "lace" | "knit" | "window" | "flowers" | "flowers_church";
/** [day of the week 1-7, from hour, to hour, what, where: "home" or "work" (a maid's master's door)] */
export type DoorSeg = [number, number, number, DoorAct, "home" | "work"];
export type Weather = "fog" | "mist" | "clear" | "rain" | "storm";

export interface DoorPerson {
  id: string;
  sex: "m" | "f";
  age: number;
  trade: string;
  /** What their own day has them doing (schedule.ts activityAt(...).act). */
  act: (day: number, hour: number) => string;
  home: { sx: number; sz: number };
  stats: { piety: number; gossip: number; warmth: number };
}

/** A stable number in 0..1 for a string (the same person, the same day: the same answer). */
export function h01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const q4 = (h: number) => Math.round(h * 4) / 4;
/** The cathedral's west door: women who live near it take their flowers to Our Lady inside. */
const CHURCH_DOOR = { x: -262, z: 144 };

/** Who may do what at the door. */
function kinds(r: DoorPerson): { scrub: boolean; lace: "lace" | "knit" | null; window: boolean; flowers: boolean } {
  const woman = r.sex === "f" && r.age >= 16;
  const athome = ["housewife", "seamstress", "retired", "shopwife", "laundress"].includes(r.trade) || (woman && r.age >= 55);
  const lace = !woman ? null : r.trade === "seamstress" || (r.age >= 50 && athome) ? "lace" : athome && h01(`${r.id}:lace`) < 0.35 ? "knit" : null;
  return {
    scrub: woman && r.age < 70 && (athome || r.trade === "maid"),
    lace,
    window: r.age >= 14 && r.stats.gossip >= 6,
    flowers: woman && r.stats.piety >= 7,
  };
}

/** Is the person at home (or, `where` = work, at her work) the whole of [a, b) on this day? */
function freeFor(r: DoorPerson, day: number, a: number, b: number, where: "home" | "work"): boolean {
  for (let t = a; t < b; t += 0.25) {
    const now = r.act(day, t);
    if (where === "home" ? now !== "home" : now !== "work") return false;
  }
  return true;
}

/**
 * The week of door life for one resident (engine; server side, it needs the stats). Empty for
 * most men, children, and anyone whose day never leaves them at home at the right hours.
 */
export function doorPlan(r: DoorPerson): DoorSeg[] {
  const k = kinds(r);
  const out: DoorSeg[] = [];
  const add = (day: number, a0: number, b0: number, act: DoorAct, where: "home" | "work") => {
    const a = q4(a0);
    const b = q4(b0);
    if (b - a < 0.5) return;
    if (!freeFor(r, day, a, b, where)) return;
    if (out.some((s) => s[0] === day && s[1] < b && a < s[2])) return;
    out.push([day, a, b, act, where]);
  };
  for (let day = 1; day <= 7; day++) {
    const rnd = (tag: string) => h01(`${r.id}:${day}:${tag}`);
    if (day === 7) {
      // Sunday: no work at the door; a pious woman may take flowers after mass
      if (k.flowers && rnd("fl") < 0.35) add(day, 11.5 + rnd("flh") * 0.75, 13 + rnd("flh") * 0.75, near(r) ? "flowers_church" : "flowers", "home");
      continue;
    }
    if (k.scrub) {
      const sat = day === 6;
      const maid = r.trade === "maid";
      if (rnd("sc") < (sat ? 0.85 : 0.22)) {
        const a = maid ? 6.75 + rnd("sca") * 0.75 : 7 + rnd("sca") * 2.25;
        add(day, a, a + (sat ? 1.25 : 1) + rnd("scb") * 0.5, "scrub", maid ? "work" : "home");
      }
    }
    if (k.lace && rnd("la") < (r.trade === "seamstress" ? 0.8 : 0.5)) {
      const a = 13.25 + rnd("laa") * 1.25;
      add(day, a, a + 1.5 + rnd("lab") * 1.5, k.lace, "home");
    }
    if (k.window && rnd("wi") < 0.45) {
      const a = rnd("wit") < 0.5 ? 10.25 + rnd("wia") * 1.25 : 17 + rnd("wia") * 1.5;
      add(day, a, a + 0.5 + rnd("wib") * 0.75, "window", "home");
    }
    if (k.flowers && (rnd("fl") < 0.18 || (day === 6 && r.stats.piety >= 9))) {
      // an hour and a half: the walk to the corner and back is part of it (a game hour is 20 real seconds)
      const a = 11 + rnd("fla") * 0.75;
      add(day, a, a + 1.5, near(r) ? "flowers_church" : "flowers", "home");
    }
  }
  return out;
}

const near = (r: DoorPerson) => Math.hypot(r.home.sx - CHURCH_DOOR.x, r.home.sz - CHURCH_DOOR.z) < 110;

/** Rain drives the work at the door indoors (the window stays, and the flowers go anyway). */
const DRY_ONLY: ReadonlySet<DoorAct> = new Set(["scrub", "lace", "knit"]);

/** What this person does at the door now, by the plan and the weather; null: nothing (the schedule stands). */
export function doorAt(plan: readonly DoorSeg[] | undefined, day: number, hour: number, weather: Weather | null): { act: DoorAct; where: "home" | "work"; since: number; left: number } | null {
  if (!plan?.length) return null;
  const d = ((day - 1) % 7) + 1;
  const h = ((hour % 24) + 24) % 24;
  for (const [sd, a, b, act, where] of plan) {
    if (sd !== d || h < a || h >= b) continue;
    if ((weather === "rain" || weather === "storm") && DRY_ONLY.has(act)) return null;
    return { act, where, since: h - a, left: b - h };
  }
  return null;
}

// ------------------------------------------------------------------ the children's games

export type ChildGame = "tag" | "hoops" | "tops" | "marbles" | "hopscotch" | "rope";
/** What the boys and the girls of a square play now; the game changes every two game hours (40 real seconds). */
export function gamesAt(place: string, day: number, hour: number): { boys: ChildGame; girls: ChildGame } {
  const slot = Math.floor(hour / 2);
  const u = h01(`${place}:${day}:${slot}`);
  const v = h01(`${place}:${day}:${slot}:g`);
  const boys: ChildGame[] = ["tag", "hoops", "tops", "marbles", "hoops", "tag"];
  const girls: ChildGame[] = ["rope", "hopscotch", "tag", "rope", "hopscotch", "hoops"];
  return { boys: boys[Math.floor(u * boys.length)], girls: girls[Math.floor(v * girls.length)] };
}
