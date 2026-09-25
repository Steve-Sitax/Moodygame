import type { DB } from "../db.ts";
import SPOT_TABLE from "../../../shared/spots.json" with { type: "json" };
import { NIGHT_WORK } from "../../../shared/night.ts";
import { NIGHT_GIVERS, TRADES, type TownEmployer } from "../town/places.ts";
import { rngFrom, type Resident } from "../town/population.ts";
import { dropTownCache, town } from "../town/store.ts";
import { houseDoors, walkMap } from "../town/walkmap.ts";

// M7 night: the four givers of night work (town/places.ts NIGHT_GIVERS) as townspeople. Runs on
// every start and after a new game; an older save gets them once, added in place. Each lodges in
// a house near his dark corner, stands at his post from 21:00 to 5:00 (shared/night.ts NIGHT_WORK)
// and is at home the rest of the day. Nothing else in the town is touched.

const SPOTS = SPOT_TABLE as unknown as Record<string, { x: number; z: number; dir?: [number, number] }>;

/** Where each stands, from his spot: a step aside, in the dark (metres). */
const POST_OFFSET: Record<string, [number, number]> = {
  fence: [3, 3],
  smuggler: [-3, 2.5],
  nightcarter: [-3, -2],
  cracksman: [-3, 3],
};

const FIRST = ["Rik", "Door", "Lowie", "Nand", "Staf", "Miel", "Pier", "Warre"];
const SURNAMES = ["De Kat", "Van Hool", "Smet", "Verhaegen", "Luyckx", "Beirens", "Goossens", "De Bie"];
const KIND: Record<string, string> = { fence: "stranger", smuggler: "sailor_b", nightcarter: "carter", cracksman: "thief" };

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** The givers' post as the town has it (x, z, yaw), or null before the town is made. */
export function giverPost(db: DB, id: string): { x: number; z: number } | null {
  const r = town(db).byId.get(id);
  const at = r?.work.at;
  return at ? { x: at[0], z: at[1] } : null;
}

/** Make sure the night givers live in this town. Idempotent; returns how many it added. */
export function ensureNightTown(db: DB): number {
  const has = (db.prepare("SELECT COUNT(*) AS n FROM resident").get() as { n: number }).n;
  if (has === 0) return 0;
  const t = town(db).town;
  const missing = NIGHT_GIVERS.filter((g) => !t.residents.some((r) => r.id === g.id));
  if (!missing.length) return 0;
  const wm = walkMap();
  const doors = houseDoors();
  const rng = rngFrom((t.seed ^ 0x0007_4e17) >>> 0);
  const used = new Set(t.residents.map((r) => r.surname));
  let hh = Math.max(0, ...t.residents.map((r) => r.household));
  const add = db.prepare("INSERT OR IGNORE INTO resident (id, household, trade, data_json) VALUES (?, ?, ?, ?)");
  db.transaction(() => {
    for (const g of missing) {
      const r = makeGiver(g, rng, used, ++hh, wm, doors);
      if (!r) continue;
      if (!db.prepare("SELECT 1 FROM npc WHERE id = ?").get(r.id)) {
        db.prepare("INSERT INTO npc (id, name, role, district, faction, persona_json, spot_id, active) VALUES (?, ?, ?, 'town', ?, '{}', NULL, 1)").run(r.id, r.name, TRADES[r.trade].label, r.faction);
      }
      db.prepare("INSERT OR IGNORE INTO npc_relationship (npc_id) VALUES (?)").run(r.id);
      add.run(r.id, r.household, r.trade, JSON.stringify(r));
    }
  })();
  dropTownCache(db);
  return missing.length;
}

function makeGiver(
  g: TownEmployer,
  rng: () => number,
  used: Set<string>,
  household: number,
  wm: ReturnType<typeof walkMap>,
  doors: ReturnType<typeof houseDoors>,
): Resident | null {
  const sp = SPOTS[g.spot];
  if (!sp) return null;
  const [dx, dz] = POST_OFFSET[g.id] ?? [2, 2];
  const q = wm.nearestOpen(sp.x + dx, sp.z + dz, 8) ?? wm.nearestOpen(sp.x, sp.z, 12) ?? { x: sp.x, z: sp.z };
  const yaw = Math.atan2(sp.x - q.x, sp.z - q.z);
  const door = doors.slice().sort((a, b) => Math.hypot(a.sx - q.x, a.sz - q.z) - Math.hypot(b.sx - q.x, b.sz - q.z))[0];
  if (!door) return null;
  const first = FIRST[(hash(g.id) + Math.floor(rng() * FIRST.length)) % FIRST.length];
  const surname = SURNAMES.find((s) => !used.has(s)) ?? SURNAMES[hash(g.id) % SURNAMES.length];
  used.add(surname);
  const tr = TRADES[g.trade];
  const night: [number, number, "work"] = [NIGHT_WORK[0], NIGHT_WORK[1], "work"];
  return {
    id: g.id,
    first,
    surname,
    name: `${first} ${surname}`,
    age: 30 + Math.floor(rng() * 22),
    sex: g.sex,
    household,
    family_role: "lodger",
    trade: g.trade,
    faction: tr.faction,
    kind: KIND[g.id] ?? "stranger",
    home: { house: door.house, x: door.x, z: door.z, sx: door.sx, sz: door.sz },
    work: { place: g.spot, kind: "post", at: [q.x, q.z, yaw] },
    sched: { day: [night], sunday: [night] },
    stats: { honesty: 2, temper: 5, piety: 1, warmth: 4, greed: 7, courage: 6, gossip: 3, wealth: 3 },
    dog: null,
  };
}
