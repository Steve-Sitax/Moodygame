import type { DB } from "../db.ts";
import { houseDoors, walkMap, type HouseDoor } from "./walkmap.ts";
import type { Resident, Town } from "./population.ts";
import { inworldHouse } from "./kept.ts";

// The save audit (2026-09-26): every stored spot of a save held against the current city map.
// A save keeps house numbers and door steps from the map it was made on; when the map changes
// (169942f re-cut the streets, 6c7c642 opened the gangs, houses marked "gone") those can point at
// open street with no door, into a block, or at another house. This lists each one, by kind:
//   - a door record (a home, a shop, a home to let, the Logement ...) whose house has no door at
//     its step now, or whose step is at no house door at all;
//   - a place a body must stand at (a post, a round, a stall, a lamp's stand, a parked cart, an
//     event's place, a meeting) that no walk from the start reaches.
// It reads the raw rows (not the town cache), so it can run on any save file. Used by
// server/scripts/audit-save.ts, the dev route /api/dev/audit and server/test/audit.test.ts.

export interface Finding {
  /** What kind of record: "home", "work door", "shop door", "home to let" ... */
  kind: string;
  /** Whose or which record, in words (a name, a place label). */
  label: string;
  /** What is wrong. */
  why: string;
  x: number;
  z: number;
}

type Pt = [number, number];

/** A door step matches a house door when it lies within this many metres of it. */
const DOOR_TOL = 1;
/** A standing point is fine when walkable ground is this near (the client's path check allows 1.6 to 3 m). */
const STAND_REACH = 1.6;

function stateOf<T>(db: DB, key: string): T | null {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(key) as { value_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return null;
  }
}

function hasTable(db: DB, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPt = (v: unknown): v is Pt => Array.isArray(v) && v.length >= 2 && num(v[0]) && num(v[1]);

/** List every stored spot of this save that does not fit the current map. Empty: the save is clean. */
export function auditSave(db: DB): Finding[] {
  const wm = walkMap();
  const doors = houseDoors();
  const byHouse = new Map<number, HouseDoor>(doors.map((d) => [d.house, d]));
  const out: Finding[] = [];
  const add = (kind: string, label: string, why: string, x: number, z: number) => out.push({ kind, label, why, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 });

  /** The house door whose step is at this point, if any. */
  const doorAt = (x: number, z: number): HouseDoor | undefined => doors.find((d) => Math.hypot(d.sx - x, d.sz - z) <= DOOR_TOL);
  const walkable = (x: number, z: number, reach = STAND_REACH) => !!wm.nearestOpen(x, z, reach);
  /** Where a stand point lies when it is off the walk: in a wall, on the water, or just out of reach. */
  const offWhy = (x: number, z: number): string => {
    const f = wm.flags(x, z);
    if (f & 2) return "on the water";
    if (f & 1) return "inside a wall or a house";
    if (f & 4) return "outside the town";
    return "on ground no walk from the start reaches";
  };
  const stand = (kind: string, label: string, p: Pt | undefined | null, reach = STAND_REACH) => {
    if (!p || !isPt(p)) return;
    if (!walkable(p[0], p[1], reach)) add(kind, label, offWhy(p[0], p[1]), p[0], p[1]);
  };
  /** A door record with its house number: the house must have its door at this step now. */
  const houseDoor = (kind: string, label: string, house: number, step: Pt) => {
    const d = byHouse.get(house);
    if (!d) {
      const other = doorAt(step[0], step[1]);
      add(kind, label, other ? `house ${house} has no door now (the step is at house ${other.house}'s door)` : `house ${house} has no door now`, step[0], step[1]);
    } else if (Math.hypot(d.sx - step[0], d.sz - step[1]) > DOOR_TOL) {
      const other = doorAt(step[0], step[1]);
      const where = walkable(step[0], step[1]) ? "in the open street" : offWhy(step[0], step[1]);
      add(kind, label, other ? `the step is at house ${other.house}'s door, not its own (house ${house})` : `no door at the step (${where}); house ${house}'s door is ${Math.round(Math.hypot(d.sx - step[0], d.sz - step[1]))} m off`, step[0], step[1]);
    }
    stand(kind, label, step);
  };
  /** A door record by its step only: some house door must be there. */
  const anyDoor = (kind: string, label: string, step: Pt | undefined | null) => {
    if (!step || !isPt(step)) return;
    if (!doorAt(step[0], step[1])) {
      const where = walkable(step[0], step[1]) ? "in the open street" : offWhy(step[0], step[1]);
      add(kind, label, `no house door at the step (${where})`, step[0], step[1]);
    } else stand(kind, label, step);
  };

  // ---------------------------------------------------------------- the town's record
  const t = stateOf<Omit<Town, "residents">>(db, "town");
  const places = t?.places ?? {};
  const placeDoors: Pt[] = Object.values(places)
    .map((p) => p.door)
    .filter(isPt);
  /** A step at a place's door (a tavern, a landmark): a publican's home, a lodger at the Logement. */
  const atPlaceDoor = (p: Pt) => placeDoors.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= DOOR_TOL);
  // landmark doors are the great buildings' own (spots.json), not house doors
  const notHouse = (id: string) => id.startsWith("landmark:");
  for (const [id, p] of Object.entries(places)) {
    stand("place", `${id} (${p.label})`, [p.x, p.z], Math.max(3, Math.min(p.r ?? 3, 6)));
    if (p.door && !notHouse(id)) anyDoor("place door", `${id} (${p.label})`, p.door);
  }
  for (const s of t?.shops ?? []) anyDoor("shop door", `${s.id} (${s.label})`, s.door);
  (t?.stalls ?? []).forEach((s, i) => stand("stall", `stall ${i} at ${s.place} (${s.goods})`, [s.x, s.z], 2.4));

  // ---------------------------------------------------------------- the residents
  const rows = db.prepare("SELECT id, data_json FROM resident").all() as Array<{ id: string; data_json: string }>;
  for (const row of rows) {
    let r: Resident;
    try {
      r = JSON.parse(row.data_json) as Resident;
    } catch {
      add("resident", row.id, "the record does not parse", 0, 0);
      continue;
    }
    const who = `${r.name} (${r.id}, ${r.trade})`;
    const h = r.home;
    if (h && num(h.sx) && num(h.sz)) {
      if (h.house >= 0) houseDoor("home", who, h.house, [h.sx, h.sz]);
      else stand("home", who, [h.sx, h.sz]);
    }
    const w = r.work;
    if (!w) continue;
    if (w.door) {
      if (!doorAt(w.door[0], w.door[1]) && !atPlaceDoor(w.door)) {
        const where = walkable(w.door[0], w.door[1]) ? "in the open street" : offWhy(w.door[0], w.door[1]);
        add("work door", who, `no door at the step (${where})`, w.door[0], w.door[1]);
      } else stand("work door", who, w.door);
    }
    if (w.at && w.kind !== "wait") stand(`work ${w.kind}`, who, [w.at[0], w.at[1]], 2.4);
    if (w.a) stand("haul end", `${who}: quay end`, w.a, 2);
    if (w.b) stand("haul end", `${who}: door end`, w.b, 2);
    (w.route ?? []).forEach((p, i) => stand(`work ${w.kind} round`, `${who}: point ${i + 1}`, p, 2.4));
  }

  // ---------------------------------------------------------------- the parts added in place (M6, M7)
  const homes = stateOf<{ homes?: Array<{ id: string; label: string; house: number; step: Pt }>; dealer?: { label: string; step: Pt; at: [number, number, number] } | null }>(db, "homes");
  for (const hm of homes?.homes ?? []) houseDoor("home to let", `${hm.id} (${hm.label})`, hm.house, hm.step);
  if (homes?.dealer) {
    anyDoor("dealer's shop", homes.dealer.label, homes.dealer.step);
    stand("dealer's shop", `${homes.dealer.label}: where he stands`, [homes.dealer.at[0], homes.dealer.at[1]], 2);
  }

  const press = stateOf<{ corners?: Array<{ id: string; label: string; x: number; z: number }>; post?: { house: number; step: Pt; label: string } | null; berg?: { label: string; door: Pt } | null }>(db, "press");
  for (const c of press?.corners ?? []) stand("newsboy corner", c.label, [c.x, c.z], 2.4);
  if (press?.post) houseDoor("post office", press.post.label, press.post.house, press.post.step);
  if (press?.berg) anyDoor("the Berg", press.berg.label, press.berg.door);

  const em = stateOf<{
    logement?: { house: number; step: Pt; label: string };
    runner_home?: Pt;
    families?: Array<{ surname: string; status: string; props?: Array<{ kind: string; x: number; z: number }> }>;
  }>(db, "emigrants");
  if (em?.logement) houseDoor("Logement", em.logement.label, em.logement.house, em.logement.step);
  if (em?.runner_home) anyDoor("runner's lodging", "the runner's lodging", em.runner_home);
  for (const f of em?.families ?? []) if (f.status === "here") for (const p of f.props ?? []) stand("emigrants' luggage", `the ${f.surname} family's ${p.kind}`, [p.x, p.z], 2.4);

  const poesje = stateOf<{ house: number; sx: number; sz: number }>(db, "poesje:door");
  if (poesje && num(poesje.house)) houseDoor("the Poesje", "the Poesje's cellar door", poesje.house, [poesje.sx, poesje.sz]);

  for (const key of ["veloshop", "cartshop"]) {
    const s = stateOf<{ label: string; step: Pt; at?: [number, number, number]; show?: Array<[number, number, number]> }>(db, key);
    if (!s) continue;
    anyDoor(key === "veloshop" ? "velocipede shop" : "wheelwright", s.label, s.step);
    if (s.at) stand(key === "veloshop" ? "velocipede shop" : "wheelwright", `${s.label}: where he stands`, [s.at[0], s.at[1]], 2);
  }

  const lamps = stateOf<{ rounds?: Array<{ id: string; lamps: Array<{ id: string; sx: number; sz: number }> }> }>(db, "townlife_lamps");
  for (const rd of lamps?.rounds ?? []) for (const l of rd.lamps ?? []) stand("lamp stand", `lamp ${l.id} (${rd.id} round)`, [l.sx, l.sz], 2);

  const tr = stateOf<{ vehicles?: Array<{ id: string; kind: string; label: string; parks?: Record<string, [number, number, number]>; boat?: { landing: Pt } }> }>(db, "transport");
  for (const v of tr?.vehicles ?? []) {
    // a boat lies on the water: its landing is where the owner steps in
    if (v.kind === "boat") {
      if (v.boat?.landing) stand("boat landing", v.label, v.boat.landing, 2.4);
      continue;
    }
    for (const [k, p] of Object.entries(v.parks ?? {})) stand("parked vehicle", `${v.label} (${k})`, [p[0], p[1]], 2.4);
  }

  for (const v of tr?.vehicles ?? []) if (v.kind !== "boat" && isPt((v as { home?: unknown }).home)) stand("parked vehicle", `${v.label} (home)`, (v as unknown as { home: Pt }).home, 2.4);
  for (const v of (stateOf<{ extraVelos?: Array<{ id: string; owner: string; x: number; z: number }> }>(db, "transport")?.extraVelos ?? [])) stand("parked vehicle", `${v.id} of ${v.owner}`, [v.x, v.z], 2.4);
  // where velocipedes and Jef's carts were left (deeds.ts 'velos', handcart.ts 'jef_carts')
  for (const [id, v] of Object.entries(stateOf<Record<string, { x: number; z: number }>>(db, "velos") ?? {})) stand("left velocipede", id, [v.x, v.z], 2.4);
  const carts = stateOf<{ list?: Array<{ id: string; x: number; z: number }>; dropped?: Array<{ x: number; z: number }> }>(db, "jef_carts");
  for (const c of carts?.list ?? []) stand("left handcart", c.id, [c.x, c.z], 2.4);
  (carts?.dropped ?? []).forEach((d, i) => stand("dropped goods", `heap ${i + 1}`, [d.x, d.z], 2.4));
  // soot on a burnt front: the house must still have its door there
  for (const s of stateOf<Array<{ house: number; door: Pt; event: number }>>(db, "fire_soot") ?? []) {
    const d = byHouse.get(s.house);
    if (!d || Math.hypot(d.x - s.door[0], d.z - s.door[1]) > DOOR_TOL) add("burnt front", `house ${s.house} (event #${s.event})`, d ? "its door is elsewhere now" : `house ${s.house} has no door now`, s.door[0], s.door[1]);
  }

  // ---------------------------------------------------------------- doors kept for one use
  // A home to let, a shop, the dealer, the velocipede maker, the wheelwright, the post office: nobody
  // else lives behind that door (a household moved in over it is a record of another map, or a picker
  // that did not look at the other records).
  const homeOf = new Map<number, Set<number>>(); // house -> households living there
  const hhOf = new Map<string, number>();
  for (const row of rows) {
    try {
      const r = JSON.parse(row.data_json) as Resident;
      hhOf.set(r.id, r.household);
      if (r.home?.house >= 0) homeOf.set(r.home.house, (homeOf.get(r.home.house) ?? new Set()).add(r.household));
    } catch {
      /* listed above */
    }
  }
  const houseAt = (step: Pt): number | undefined => doorAt(step[0], step[1])?.house;
  const exclusive = (kind: string, label: string, house: number | undefined, owners: string[]) => {
    if (house === undefined) return;
    const allowed = new Set(owners.map((id) => hhOf.get(id)).filter((h): h is number => h !== undefined));
    const others = [...(homeOf.get(house) ?? [])].filter((h) => !allowed.has(h));
    if (others.length) add(kind, label, `${others.length} other household(s) live in house ${house}`, byHouse.get(house)?.sx ?? 0, byHouse.get(house)?.sz ?? 0);
  };
  for (const hm of homes?.homes ?? []) exclusive("home to let taken", `${hm.id} (${hm.label})`, hm.house, hm.id === "widow" ? [(homes as { widow?: string }).widow ?? "widow_landlady"] : []);
  if (homes?.dealer) exclusive("shop taken", homes.dealer.label, houseAt(homes.dealer.step), ["dealer"]);
  for (const s of t?.shops ?? []) exclusive("shop taken", `${s.id} (${s.label})`, houseAt(s.door), [s.keeper]);
  const velo = stateOf<{ id: string; label: string; step: Pt }>(db, "veloshop");
  if (velo) exclusive("shop taken", velo.label, houseAt(velo.step), [velo.id]);
  const cart = stateOf<{ id: string; label: string; step: Pt }>(db, "cartshop");
  if (cart) exclusive("shop taken", cart.label, houseAt(cart.step), [cart.id]);
  const post = press?.post as { house: number; label: string; clerk?: string } | null | undefined;
  if (post) exclusive("shop taken", post.label, post.house, post.clerk ? [post.clerk] : []);

  // ---------------------------------------------------------------- the insides that stand in the world
  // The client draws a tavern's, the Poesje's and each home to let's rooms in its own house
  // (shared/inworld_houses.json, by id); the door Jef uses is the saved step. Both must be one house.
  const sameHouse = (kind: string, label: string, id: string, step: Pt | undefined) => {
    const want = inworldHouse(id);
    if (want === undefined || !step) return;
    const d = byHouse.get(want);
    if (!d) add(kind, label, `its house in the world (${want}) has no door now`, step[0], step[1]);
    else if (Math.hypot(d.sx - step[0], d.sz - step[1]) > DOOR_TOL) add(kind, label, `its rooms are drawn in house ${want}, ${Math.round(Math.hypot(d.sx - step[0], d.sz - step[1]))} m from the door it uses`, step[0], step[1]);
  };
  for (const hm of homes?.homes ?? []) sameHouse("inside elsewhere", `home to let ${hm.id}`, `home:${hm.id}`, hm.step);
  for (const [id, p] of Object.entries(places)) if (id.startsWith("tavern:")) sameHouse("inside elsewhere", `${id} (${p.label})`, id, p.door);
  if (poesje && num(poesje.house)) sameHouse("inside elsewhere", "the Poesje", "poesje", [poesje.sx, poesje.sz]);

  // ---------------------------------------------------------------- the tables with places in them
  if (hasTable(db, "poster")) {
    const ps = db.prepare("SELECT id, owner, thing_json FROM poster WHERE status = 'up' AND kind = 'lost'").all() as Array<{ id: number; owner: string | null; thing_json: string }>;
    for (const p of ps) {
      try {
        const th = JSON.parse(p.thing_json) as { what?: string; x?: number; z?: number; state?: string };
        if (th.state === "lying" && num(th.x) && num(th.z)) stand("lost thing", `${th.what ?? "a thing"} of ${p.owner ?? "?"} (bill #${p.id})`, [th.x, th.z], 2.4);
      } catch {
        /* a bill without a thing */
      }
    }
  }
  if (hasTable(db, "town_event")) {
    const evs = db.prepare("SELECT id, title, place, x, z, r FROM town_event WHERE status IN ('planned', 'running')").all() as Array<{ id: number; title: string; place: string; x: number; z: number; r: number }>;
    for (const e of evs) stand("town event", `${e.title} (#${e.id}, ${e.place})`, [e.x, e.z], Math.max(2.4, Math.min(e.r, 8)));
  }
  if (hasTable(db, "npc_action")) {
    const acts = db.prepare("SELECT id, npc_id, kind, target_x, target_z FROM npc_action WHERE status = 'active' AND target_x IS NOT NULL AND target_z IS NOT NULL").all() as Array<{ id: number; npc_id: string; kind: string; target_x: number; target_z: number }>;
    for (const a of acts) stand("townsperson's errand", `${a.npc_id} ${a.kind} (#${a.id})`, [a.target_x, a.target_z], 2.4);
  }
  if (hasTable(db, "diary")) {
    const ds = db.prepare("SELECT id, owner, x, z FROM diary WHERE status IN ('writing', 'lying')").all() as Array<{ id: number; owner: string; x: number; z: number }>;
    for (const d of ds) stand("lost notebook", `${d.owner}'s notebook (#${d.id})`, [d.x, d.z], 2.4);
  }
  if (hasTable(db, "meeting")) {
    const ms = db.prepare("SELECT id, who, label, x, z FROM meeting WHERE status = 'open'").all() as Array<{ id: number; who: string; label: string; x: number; z: number }>;
    for (const m of ms) stand("meeting", `${m.who} at ${m.label} (#${m.id})`, [m.x, m.z], 2.4);
  }
  return out;
}

/** The findings counted by kind, most first. */
export function auditCounts(fs: Finding[]): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const f of fs) m.set(f.kind, (m.get(f.kind) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
