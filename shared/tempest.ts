// The great storm (Steve 2026-09-28: "an extremely heavy storm event. All shops close, no work for
// deliveries, people running for shelter to cafe, home, somewhere under"). Pure code with no imports:
// the server (director/tempest.ts: the shops, the jobs, who drinks in which tavern) and the client
// (game/town.ts: where each townsperson runs; world/tempest.ts: how hard it blows) use the same file,
// so the tavern a man runs to on the screen is the tavern the engine counts him in.

export const TEMPEST_TEMPLATE = "tempest";

/** The storm's parts: it comes on (the sky goes black, the shutters go up), it blows, it blows over. */
export type TempestPhase = "coming" | "peak" | "easing";
export const TEMPEST_PHASES: readonly TempestPhase[] = ["coming", "peak", "easing"];

/** How hard it blows at the end of each part, 0..1 (the client eases toward it; 0 is an ordinary storm day). */
export const TEMPEST_LEVEL: Record<TempestPhase, number> = { coming: 0.55, peak: 1, easing: 0.25 };

/** Where someone goes when it breaks. `stay`: where the day has him already is under a roof (home, a tavern, indoor work, a sentry's post). */
export type Shelter = { kind: "stay" } | { kind: "home" } | { kind: "tavern"; place: string } | { kind: "under" };

interface SheltRes {
  id: string;
  age: number;
  trade?: string;
  home: { sx: number; sz: number };
  work: { place: string; kind: string };
}
interface SheltPlace {
  x: number;
  z: number;
}

/** The work that goes on under a roof, or at a post nobody leaves in a storm. */
const STAY_WORK = new Set(["tavern", "inside", "guard"]);
/** A tavern farther off than this (m) is too far to run to: home, or the nearest door. */
const TAVERN_RUN_M = 260;

function hash01(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0) / 4294967296;
}

/** The taverns of the town (place ids "tavern:..."), for shelterFor. */
export function tavernIds(places: Record<string, SheltPlace>): string[] {
  return Object.keys(places).filter((id) => id.startsWith("tavern:"));
}

/**
 * Where this person runs to in the storm, from what the day has him doing (`act`, `place`). The same for the
 * same person all through one storm: children and about four in ten go home; a third run for the nearest
 * tavern (the cafe); the rest press into the nearest doorway or run into the cathedral (`under`: the client finds it).
 */
export function shelterFor(r: SheltRes, now: { act: string; place: string }, places: Record<string, SheltPlace>, taverns: readonly string[], storm = 0): Shelter {
  // the publican and his people open up whatever the hour: the town comes in out of it (server trade.ts atWork)
  if (r.work.kind === "tavern" && r.work.place.startsWith("tavern:") && r.age >= 14) return now.act === "work" ? { kind: "stay" } : { kind: "tavern", place: r.work.place };
  // (a drink at a tavern's door: in at the door now, or pressed under it)
  if (now.act === "tavern" && now.place.startsWith("tavern:")) return { kind: "tavern", place: now.place };
  if (now.act === "home" || now.act === "church" || now.act === "tavern") return { kind: "stay" };
  if (now.act === "work" && STAY_WORK.has(r.work.kind)) return { kind: "stay" };
  if (r.age < 14 || r.trade === "child" || r.trade === "street_child") return { kind: "home" };
  const h = hash01(`${r.id}:tempest:${storm}`);
  if (h < 0.42) return { kind: "home" };
  if (h < 0.74) {
    const from = places[now.act === "work" ? r.work.place : now.place] ?? { x: r.home.sx, z: r.home.sz };
    let best = "";
    let bd = TAVERN_RUN_M;
    for (const id of taverns) {
      const p = places[id];
      if (!p) continue;
      const d = Math.hypot(p.x - from.x, p.z - from.z);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return best ? { kind: "tavern", place: best } : { kind: "home" };
  }
  return { kind: "under" };
}
