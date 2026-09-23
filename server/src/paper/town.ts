import type { DB } from "../db.ts";
import { dropTownCache, town } from "../town/store.ts";
import { houseDoors, walkMap, type HouseDoor } from "../town/walkmap.ts";
import { PLAY, TRADES } from "../town/places.ts";
import { rngFrom, type Resident } from "../town/population.ts";
import type { Seg } from "../town/schedule.ts";

// The press in the town (M6): three newsboys at busy corners in the morning,
// the post and telegraph office with its clerk, and the Berg van Barmhartigheid's
// counter (the pawnbroker's shop by the Vleeshuis, its keeper the Berg's clerk).
//
// Runs on every start and after a new game. For an older save it works in place,
// once: three boys of 10 to 14 from existing households become newsboys (their
// trade, work and day change; name, family, home, memories and relationships stay),
// one resident is ADDED (the post clerk, living above the office), and Jef has his
// mother's silver medal sewn into his coat (no pocket slot; the Berg will lend on it).
// Nothing else is touched. The record is world_state 'press'.

export interface Corner {
  id: string;
  label: string;
  x: number;
  z: number;
  /** Facing (sin, cos) as the client's yaw. */
  yaw: number;
  boy: string;
}

export interface PostOffice {
  house: number;
  /** The door step, the door in the wall, and out of the house. */
  step: [number, number];
  wall: [number, number];
  out: [number, number];
  label: string;
  clerk: string;
}

export interface PressTown {
  v: 1;
  newsboys: string[];
  corners: Corner[];
  post: PostOffice | null;
  /** The Berg's counter: the pawnbroker's shop and its keeper. */
  berg: { shop: string; clerk: string; label: string; door: [number, number]; wall: [number, number]; out: [number, number] } | null;
  /** Jef's mother's medal, sewn into his coat: his, at the Berg, or sold at the Berg's sale. */
  medal: "owned" | "pawned" | "sold";
}

/** Busy corners in the morning (world metres; snapped to open ground). Face: toward the square. */
const CORNERS: Array<{ id: string; label: string; x: number; z: number; look: [number, number] }> = [
  { id: "rijnkaai", label: "the Rijnkaai, by the hiring board", x: 3, z: 36, look: [0, 18] },
  { id: "vismarkt", label: "the corner of the Vismarkt", x: -103, z: 44, look: [-116, 26] },
  { id: "grote_markt", label: "the Grote Markt", x: -238, z: 110, look: [-254, 94] },
];

/** Where the post office should stand: a free house between the Grote Markt and the Vleeshuis. */
const POST_ANCHOR: [number, number] = [-210, 112];
export const POST_LABEL = "the post and telegraph office";
export const BERG_LABEL = "the Berg van Barmhartigheid";
export const POST_CLERK_ID = "postclerk";

/** Office hours of the post and the Berg (the clerks' "work"); Sunday the post is shut. */
export const POST_HOURS: [number, number] = [8, 19];

export function pressTown(db: DB): PressTown | null {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'press'").get() as { value_json: string } | undefined;
  return row ? (JSON.parse(row.value_json) as PressTown) : null;
}

function savePress(db: DB, p: PressTown): void {
  db.prepare("INSERT INTO world_state (key, value_json) VALUES ('press', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(p));
}

const hashStr = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** A newsboy's day: the corner from 6:15 to 11:30, the afternoon at play; Sunday too (the paper comes out every day). */
function newsboySched(r: Resident): { day: Seg[]; sunday: Seg[] } {
  const play = nearestPlay(r);
  const day: Seg[] = [[6.25, 11.5, "work"], [13.5, 17.5, "play", play]];
  return { day, sunday: day.slice() };
}

function nearestPlay(r: Resident): string {
  const t = town_places;
  let best = `play:${PLAY[0]}`;
  let bd = Infinity;
  for (const p of PLAY) {
    const pl = t?.[`play:${p}`];
    if (!pl) continue;
    const d = Math.hypot(pl.x - r.home.sx, pl.z - r.home.sz);
    if (d < bd) {
      bd = d;
      best = `play:${p}`;
    }
  }
  return best;
}
let town_places: Record<string, { x: number; z: number }> | null = null;

/** Make sure the press exists in this town. Idempotent; returns what it added. */
export function ensurePressTown(db: DB): { newsboys: number; clerk: boolean } {
  const has = (db.prepare("SELECT COUNT(*) AS n FROM resident").get() as { n: number }).n;
  if (has === 0) return { newsboys: 0, clerk: false };
  const before = pressTown(db);
  if (before?.v === 1 && before.post && before.newsboys.length) return { newsboys: 0, clerk: false };

  const t = town(db).town;
  town_places = t.places;
  const wm = walkMap();
  const snap = (x: number, z: number): [number, number] => {
    const q = wm.nearestOpen(x, z, 8) ?? { x, z };
    return [q.x, q.z];
  };
  const rng = rngFrom((t.seed ^ 0x5eed_0873) >>> 0);
  const upd = db.prepare("UPDATE resident SET trade = ?, data_json = ? WHERE id = ?");
  const role = db.prepare("UPDATE npc SET role = ? WHERE id = ?");
  const press: PressTown = before ?? { v: 1, newsboys: [], corners: [], post: null, berg: null, medal: "owned" };
  let boys = 0;
  let clerk = false;

  db.transaction(() => {
    // 1. the newsboys: boys of 10 to 14, one per household, the nearest home to each corner
    if (!press.newsboys.length) {
      const pool = t.residents
        .filter((r) => r.sex === "m" && r.age >= 10 && r.age <= 14 && ["child", "errand_boy", "street_child"].includes(r.trade))
        .sort((a, b) => hashStr(a.id + t.seed) - hashStr(b.id + t.seed));
      const usedHh = new Set<number>();
      for (const c of CORNERS) {
        const [x, z] = snap(c.x, c.z);
        const boy = pool
          .filter((r) => !usedHh.has(r.household))
          .sort((a, b) => Math.hypot(a.home.sx - x, a.home.sz - z) - Math.hypot(b.home.sx - x, b.home.sz - z))[0];
        if (!boy) continue;
        usedHh.add(boy.household);
        const yaw = Math.atan2(c.look[0] - x, c.look[1] - z);
        boy.trade = "newsboy";
        boy.faction = TRADES.newsboy.faction;
        boy.work = { place: c.id, kind: "post", at: [x, z, yaw] };
        boy.sched = newsboySched(boy);
        upd.run("newsboy", JSON.stringify(boy), boy.id);
        role.run(TRADES.newsboy.label, boy.id);
        press.newsboys.push(boy.id);
        press.corners.push({ id: c.id, label: c.label, x, z, yaw, boy: boy.id });
        boys++;
      }
    }

    // 2. the post office: a house nobody lives or works in, near the anchor; the clerk lives above it
    if (!press.post) {
      const door = freeDoor(t.residents, t.places, POST_ANCHOR);
      if (door) {
        const at = snap(door.sx + door.out[0] * 0.6, door.sz + door.out[1] * 0.6);
        const hh = Math.max(0, ...t.residents.map((r) => r.household)) + 1;
        const first = pick(rng, ["Prosper", "Emiel", "Isidoor", "Florimond", "Gommaar"]);
        const used = new Set(t.residents.map((r) => r.surname));
        const surname = ["Van Laer", "Moens", "Verbist", "Schuermans", "Dockx", "Van Geel"].find((s) => !used.has(s)) ?? "Van Laer";
        const c: Resident = {
          id: POST_CLERK_ID,
          first,
          surname,
          name: `${first} ${surname}`,
          age: 44 + Math.floor(rng() * 14),
          sex: "m",
          household: hh,
          family_role: "single",
          trade: "post_clerk",
          faction: TRADES.post_clerk.faction,
          kind: "clerk",
          home: { house: door.house, x: door.x, z: door.z, sx: door.sx, sz: door.sz },
          work: { place: "post_office", kind: "post", at: [at[0], at[1], Math.atan2(door.out[0], door.out[1])] },
          sched: {
            day: [[POST_HOURS[0], 12.5, "work"], [13.5, POST_HOURS[1], "work"]],
            sunday: [[8.75, 11, "church", "church"]],
          },
          stats: { honesty: 7, temper: 4, piety: 6, warmth: 4, greed: 3, courage: 3, gossip: 6, wealth: 4 },
          dog: null,
        };
        const hasNpc = db.prepare("SELECT 1 FROM npc WHERE id = ?").get(c.id);
        if (!hasNpc) {
          db.prepare("INSERT INTO npc (id, name, role, district, faction, persona_json, spot_id, active) VALUES (?, ?, ?, 'grote-markt', ?, '{}', NULL, 1)").run(c.id, c.name, TRADES.post_clerk.label, c.faction);
          db.prepare("INSERT OR IGNORE INTO npc_relationship (npc_id) VALUES (?)").run(c.id);
          db.prepare("INSERT OR IGNORE INTO resident (id, household, trade, data_json) VALUES (?, ?, ?, ?)").run(c.id, hh, c.trade, JSON.stringify(c));
          clerk = true;
        }
        press.post = { house: door.house, step: [door.sx, door.sz], wall: [door.x, door.z], out: door.out, label: POST_LABEL, clerk: c.id };
      }
    }

    // 3. the Berg's counter: the pawnbroker's shop (a place label only; the keeper is its clerk)
    if (!press.berg) {
      const shop = t.shops.find((s) => s.id === "pawn_vis");
      if (shop) {
        press.berg = { shop: shop.id, clerk: shop.keeper, label: BERG_LABEL, door: shop.door, wall: shop.wall, out: shop.out };
      }
    }

    // the town's own record: the post office as a place, the Berg's label on the pawnshop
    const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'town'").get() as { value_json: string } | undefined;
    if (row) {
      const rest = JSON.parse(row.value_json) as { places: Record<string, unknown>; shops: Array<{ id: string; label: string }> };
      if (press.post) {
        rest.places.post_office = { label: POST_LABEL, x: press.post.step[0], z: press.post.step[1], r: 3, district: "grote-markt", door: press.post.step, out: press.post.out };
      }
      for (const s of rest.shops) if (s.id === "pawn_vis") s.label = `${BERG_LABEL} by the Vleeshuis`;
      const pv = rest.places.pawn_vis as { label?: string } | undefined;
      if (pv) pv.label = `${BERG_LABEL} by the Vleeshuis`;
      db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'town'").run(JSON.stringify(rest));
    }
    savePress(db, press);
  })();
  dropTownCache(db);
  town_places = null;
  return { newsboys: boys, clerk };
}

/** Jef's medal changes hands at the Berg (paper/pawn.ts). */
export function setMedal(db: DB, m: PressTown["medal"]): void {
  const p = pressTown(db);
  if (!p) return;
  savePress(db, { ...p, medal: m });
}

function pick<T>(rng: () => number, xs: T[]): T {
  return xs[Math.floor(rng() * xs.length)];
}

/** The nearest house door to `anchor` that no resident lives or works at, and no shop, tavern or place uses. */
function freeDoor(residents: Resident[], places: Record<string, { x: number; z: number; door?: [number, number] }>, anchor: [number, number]): HouseDoor | null {
  const houses = new Set(residents.map((r) => r.home.house));
  const taken: Array<[number, number]> = [];
  for (const r of residents) {
    taken.push([r.home.sx, r.home.sz]);
    if (r.work.door) taken.push(r.work.door);
  }
  for (const p of Object.values(places)) if (p.door) taken.push(p.door);
  const free = houseDoors().filter((d) => !houses.has(d.house) && !taken.some(([x, z]) => Math.hypot(x - d.sx, z - d.sz) < 4));
  free.sort((a, b) => Math.hypot(a.sx - anchor[0], a.sz - anchor[1]) - Math.hypot(b.sx - anchor[0], b.sz - anchor[1]));
  return free[0] ?? null;
}
