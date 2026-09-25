import type { DB } from "../db.ts";
import CITY from "../../../shared/city.json" with { type: "json" };
import { clock } from "../day.ts";
import { log } from "../game.ts";
import { remember } from "../npcs.ts";
import { walkPath } from "../town/lamplighters.ts";
import type { Resident } from "../town/population.ts";
import { resident, town, TOWN_EMPLOYER_IDS } from "../town/store.ts";
import { activityAt } from "../town/schedule.ts";
import { actionOf } from "./actions.ts";
import { houseDoors, walkMap, WATER, type HouseDoor } from "../town/walkmap.ts";
import { gameMinute } from "../town/deeds.ts";
import { notify } from "./bus.ts";
import { writeEvent } from "./eventlog.ts";
import { castEngineLead, eventRow, freeResidents, leadsOf, liveEvents, placeAt, type EventRow, type StoredStage } from "./scheduler.ts";
import { setState, state } from "./state.ts";

// M6 town life: a house on fire (Steve, 2026-09-24: "the fire brigade"). The ENGINE does all of
// it; a model at most names the event (the director may call it by kind "house_fire").
//
// - The house: a resident household's own house, near enough to water for a bucket chain;
//   never Jef's bed (the doss house), a room he may rent (homes), an employer's post; rare
//   (not within three days of the last fire).
// - fire_start: the alarm bell rings (the client: the cathedral's bell, fast), smoke and flames
//   at the windows and the roof; the household comes out and stands across the street.
// - fire_brigade: the pompiers' pump comes from the fire post, drawn by two horses (the client
//   drives it along the engine's path); four firemen in helmets (leads the engine casts) man it.
// - fire_chain: a bucket chain from the water to the door: full buckets up one line, empty
//   ones back down the other, 20 to 60 people (the onlookers step in first). Jef may stand in
//   it (E at the line): the engine's numbers decide what it earns him.
// - fire_down: the flames die, the smoke thins; Jef's part is settled.
// - The end: the front stays black (a soot mark the client fades over three days), the town
//   talks about it. Nobody is hurt: this game has no combat and no deaths.

export type P2 = [number, number];

export interface FireScene {
  owner: string;
  owner_name: string;
  household: number;
  family: string[];
  house: number;
  /** The door in the front wall, out of the house, the step in the street. */
  door: P2;
  out: P2;
  step: P2;
  /** Width of the front (m) and how high (storeys). */
  width: number;
  storeys: number;
  /** Where the buckets are filled, and the chain's places: full line (water to door), then the empty line back. */
  water: P2;
  chain: P2[];
  full: number;
  /** The pump's way from the fire post, and where it stands (with the way it faces). */
  station: P2;
  pumpPath: P2[];
  pumpAt: [number, number, number];
  firemen: string[];
  chainIds: string[];
  jef: { joined: number; left: number | null; slot: number } | null;
  settled: { minutes: number; paid_c: number; trust: number; text: string } | null;
  place: string;
  started: number;
}

/** Engine numbers. */
export const FIRE_GAP_DAYS = 3;
export const CHAIN_STEP_M = 1.25;
export const CHAIN_LINE_GAP_M = 1.3;
export const CHAIN_MIN = 20;
export const CHAIN_MAX = 60;
/** The water must be this near the door on foot (the full line is at most 32 people). */
export const WATER_PATH_MIN_M = 14;
export const WATER_PATH_MAX_M = 40;
export const FIREMEN = 4;
/** Jef in the chain: at least this long counts; the household pays if it can (wealth), else it owes him. */
export const CHAIN_COUNTS_MIN = 20;
/** M7 clock: 5 -> 10 a half hour; the chain stage is an hour now (was 150 game minutes), so a whole chain still pays 20 c. */
export const CHAIN_PAY_PER_30_MIN_C = 10;
export const CHAIN_PAY_MAX_C = 30;
export const CHAIN_PAY_MIN_C = 5;
export const FIRE_PAY_WEALTH = 5;
/** Jef must stand this near a place in the chain to join it. */
export const CHAIN_JOIN_M = 3;

/**
 * Where the pump comes from. Antwerp's fire station stood on the Kipdorp (no. 6, the old House of
 * Portugal, the brigade's post from 1816; Inventaris Onroerend Erfgoed, object 5167), beyond the
 * edge of the game's map; the pump comes in by the street that leads there, north of the Grote Markt.
 */
export const FIRE_POST = { x: -175, z: 210, label: "the fire post on the Kipdorp" };

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};
const plen = (p: P2[]) => p.reduce((a, q, i) => (i ? a + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);

// ------------------------------------------------------------------ the house

/** Why a fire may not be planned now (the last one too recent), or null. */
export function fireGapWhy(db: DB, gapDays = FIRE_GAP_DAYS): string | null {
  const row = db.prepare("SELECT MAX(day) AS d FROM town_event WHERE template = 'house_fire' AND status <> 'cancelled'").get() as { d: number | null };
  const day = clock(db).day;
  if (row.d !== null && row.d > day - gapDays) return `a house burned on day ${row.d}; not another so soon`;
  return null;
}

/** Houses the fire never takes: the doss house (Jef's bed), homes to let (Jef may rent one), and the widow's. */
function spared(db: DB): { houses: Set<number>; points: P2[] } {
  const houses = new Set<number>();
  const points: P2[] = [];
  const doss = (CITY as unknown as { doors?: Record<string, { x: number; z: number }> }).doors?.doss;
  if (doss) points.push([doss.x, doss.z]);
  const homes = state<{ homes?: Array<{ house: number; step?: P2 }>; widow?: string | null }>(db, "homes", {});
  for (const h of homes.homes ?? []) {
    houses.add(h.house);
    if (h.step) points.push(h.step);
  }
  if (homes.widow) {
    const w = resident(db, homes.widow);
    if (w) houses.add(w.home.house);
  }
  return { houses, points };
}

/** The nearest place by the water a bucket can be filled from, and the way from it to the door. */
function waterFor(step: P2): { water: P2; path: P2[] } | null {
  const wm = walkMap();
  const byWater = (x: number, z: number) => {
    for (const d of [1.0, 1.6, 2.2])
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        if (wm.flags(x + Math.cos(a) * d, z + Math.sin(a) * d) & WATER) return true;
      }
    return false;
  };
  const cands: Array<{ p: P2; d: number }> = [];
  for (let r = 3; r <= WATER_PATH_MAX_M; r += 1.5) {
    const k = Math.ceil((2 * Math.PI * r) / 1.5);
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2;
      const x = Math.round((step[0] + Math.cos(a) * r) * 10) / 10;
      const z = Math.round((step[1] + Math.sin(a) * r) * 10) / 10;
      if (wm.reachable(x, z) && wm.open(x, z, 0.4) && byWater(x, z)) cands.push({ p: [x, z], d: r });
    }
    if (cands.length >= 6) break;
  }
  cands.sort((a, b) => a.d - b.d);
  for (const c of cands.slice(0, 6)) {
    const path = walkPath(c.p[0], c.p[1], step[0], step[1], 120_000);
    if (!path) continue;
    const L = plen(path);
    if (L >= WATER_PATH_MIN_M && L <= WATER_PATH_MAX_M) return { water: c.p, path };
  }
  return null;
}

let doorsByHouse: Map<number, HouseDoor> | null = null;
function doorOf(house: number): HouseDoor | null {
  doorsByHouse ??= new Map(houseDoors().map((d) => [d.house, d]));
  return doorsByHouse.get(house) ?? null;
}

/**
 * The engine's choice of a house to burn: a household's own house with water near enough for
 * a chain, not spared, not near an event that runs; a different one each day. Returns the
 * resident whose house it is (the head of the household), or null.
 */
export function pickFireHouse(db: DB, salt = ""): string | null {
  const t = town(db).town;
  const sp = spared(db);
  const live = liveEvents(db);
  const day = clock(db).day;
  const byHouse = new Map<number, Resident[]>();
  for (const r of t.residents) {
    if (r.home.house < 0 || TOWN_EMPLOYER_IDS.includes(r.id)) continue;
    const list = byHouse.get(r.home.house) ?? [];
    list.push(r);
    byHouse.set(r.home.house, list);
  }
  const houses = [...byHouse.entries()]
    .filter(([h, rs]) => {
      if (sp.houses.has(h)) return false;
      const d = doorOf(h);
      if (!d || d.storeys < 2) return false;
      if (sp.points.some(([x, z]) => Math.hypot(x - d.sx, z - d.sz) < 15)) return false;
      if (live.some((e) => Math.hypot(e.x - d.sx, e.z - d.sz) < 70)) return false;
      // the house of a tavern keeper, a shop or a post: not these
      return !rs.some((r) => r.work.kind === "tavern" || r.work.kind === "shop" || r.trade === "police" || r.trade === "priest");
    })
    .sort((a, b) => hash(`${a[0]}:${day}${salt}`) - hash(`${b[0]}:${day}${salt}`));
  let tries = 0;
  for (const [h, rs] of houses) {
    const d = doorOf(h)!;
    if (tries++ > 40) break;
    if (!waterFor([d.sx, d.sz])) continue;
    const head = rs.find((r) => r.family_role === "head" || r.family_role === "widow" || r.family_role === "widower") ?? rs.sort((a, b) => b.age - a.age)[0];
    return head.id;
  }
  return null;
}

// ------------------------------------------------------------------ the acts

function fireOf(ev: EventRow): FireScene | null {
  const stages = JSON.parse(ev.stages_json) as StoredStage[];
  return stages[0]?.fire ?? null;
}

function saveFire(db: DB, ev: EventRow, f: FireScene): void {
  const cur = eventRow(db, ev.id) ?? ev;
  const stages = JSON.parse(cur.stages_json) as StoredStage[];
  if (!stages[0]) return;
  stages[0].fire = f;
  db.prepare("UPDATE town_event SET stages_json = ? WHERE id = ?").run(JSON.stringify(stages), ev.id);
}

/** The chain's places: the full line from the water to the door, then the empty line back beside it. */
export function chainSlots(path: P2[]): { slots: P2[]; full: number } {
  const wm = walkMap();
  const L = plen(path);
  const n = Math.min(32, Math.floor((L - 1.5) / CHAIN_STEP_M) + 1);
  const at = (d: number): { p: P2; side: P2 } => {
    let left = d;
    for (let i = 1; i < path.length; i++) {
      const [ax, az] = path[i - 1];
      const [bx, bz] = path[i];
      const s = Math.hypot(bx - ax, bz - az);
      if (left <= s || i === path.length - 1) {
        const k = s > 0 ? Math.min(1, left / s) : 0;
        const ux = s > 0 ? (bx - ax) / s : 1;
        const uz = s > 0 ? (bz - az) / s : 0;
        return { p: [ax + (bx - ax) * k, az + (bz - az) * k], side: [-uz, ux] };
      }
      left -= s;
    }
    return { p: path[path.length - 1], side: [1, 0] };
  };
  const full: P2[] = [];
  const empty: P2[] = [];
  for (let i = 0; i < n; i++) {
    const { p, side } = at(i * CHAIN_STEP_M);
    const r2 = (v: number) => Math.round(v * 100) / 100;
    full.push([r2(p[0]), r2(p[1])]);
    for (const s of [1, -1]) {
      const q: P2 = [r2(p[0] + side[0] * CHAIN_LINE_GAP_M * s), r2(p[1] + side[1] * CHAIN_LINE_GAP_M * s)];
      if (wm.reachable(q[0], q[1])) {
        empty.push(q);
        break;
      }
    }
  }
  const room = Math.max(0, CHAIN_MAX - full.length);
  return { slots: [...full, ...empty.slice(0, room)], full: full.length };
}

/** Set the fire up at the event's start: the house, the water, the chain's places, the pump's way. */
export function setupFire(db: DB, ev: EventRow): FireScene | null {
  const owner = ev.place.startsWith("house:") ? resident(db, ev.place.slice(6)) : null;
  if (!owner) return null;
  const d = doorOf(owner.home.house);
  if (!d) return null;
  const step: P2 = [d.sx, d.sz];
  const w = waterFor(step);
  if (!w) return null;
  const { slots, full } = chainSlots(w.path);
  // the pump stands in the street a few metres along the front from the door, clear of the chain
  const wm = walkMap();
  const side: P2 = [-d.out[1], d.out[0]];
  const chainSide = (w.path[Math.max(0, w.path.length - 3)][0] - step[0]) * side[0] + (w.path[Math.max(0, w.path.length - 3)][1] - step[1]) * side[1] > 0 ? 1 : -1;
  // (fixes 2026-09-24: in a narrow lane it stood jammed in the dark against the far wall among
  // the people; now the place along the front with the most room round it, where the lane is
  // widest, and clear of the chain: seen from along the street)
  let pumpAt: P2 | null = null;
  let best = -1;
  for (const along of [6, 8, 10, 12, 4])
    for (const outM of [2.4, 3.2, 4.2, 5.2]) {
      const x = d.sx + d.out[0] * outM - side[0] * along * chainSide;
      const z = d.sz + d.out[1] * outM - side[1] * along * chainSide;
      if (!wm.reachable(x, z) || !wm.open(x, z, 1.1)) continue;
      if (slots.some(([cx, cz]) => Math.hypot(cx - x, cz - z) < 2.2)) continue;
      let room = 1.1;
      for (const rr of [1.4, 1.8, 2.2, 2.8]) if (wm.open(x, z, rr)) room = rr;
      // most room first; then nearer the door (it is the house's pump)
      const score = room * 10 - along * 0.3;
      if (score > best) {
        best = score;
        pumpAt = [Math.round(x * 10) / 10, Math.round(z * 10) / 10];
      }
    }
  pumpAt ??= [step[0] + d.out[0] * 3, step[1] + d.out[1] * 3];
  const st = wm.nearestOpen(FIRE_POST.x, FIRE_POST.z, 10) ?? { x: FIRE_POST.x, z: FIRE_POST.z };
  const pumpPath = walkPath(st.x, st.z, pumpAt[0], pumpAt[1], 600_000, 1.1) ?? walkPath(st.x, st.z, pumpAt[0], pumpAt[1], 600_000, 0.6) ?? walkPath(st.x, st.z, pumpAt[0], pumpAt[1]) ?? [[st.x, st.z], pumpAt];
  const last = pumpPath.length >= 2 ? pumpPath[pumpPath.length - 2] : [st.x, st.z];
  const yaw = Math.atan2(pumpAt[0] - last[0], pumpAt[1] - last[1]);
  const family = town(db).town.residents.filter((r) => r.household === owner.household && r.home.house === owner.home.house).map((r) => r.id);
  const place = `the house of ${owner.name}`;
  const started = writeEvent(db, {
    kind: "event",
    verb: "fire",
    actor: null,
    target: owner.id,
    place: ev.place,
    x: step[0],
    z: step[1],
    text: `Fire broke out in ${place}. The alarm bell rang from the cathedral tower.`,
    ref_type: "town_event",
    ref_id: ev.id,
    weight: 7,
    who: family,
  });
  const f: FireScene = {
    owner: owner.id,
    owner_name: owner.name,
    household: owner.household,
    family,
    house: owner.home.house,
    door: [d.x, d.z],
    out: d.out,
    step,
    width: 6,
    storeys: d.storeys,
    water: w.water,
    chain: slots,
    full,
    station: [st.x, st.z],
    pumpPath,
    pumpAt: [pumpAt[0], pumpAt[1], yaw],
    firemen: [],
    chainIds: [],
    jef: null,
    settled: null,
    place,
    started,
  };
  saveFire(db, ev, f);
  return f;
}

const STRONG = new Set(["docker", "natie", "porter", "carter", "boatman", "brewer", "sailor", "cobbler"]);

/** The engine's act for a stage of the fire. */
export function runFireAct(db: DB, ev: EventRow, s: StoredStage, _i: number): void {
  let f = fireOf(eventRow(db, ev.id) ?? ev);
  switch (s.act) {
    case "fire_start": {
      f = setupFire(db, ev);
      if (!f) {
        writeEvent(db, { kind: "event", verb: "scene_skipped", text: `${ev.title}: no house to burn after all.`, ref_type: "town_event", ref_id: ev.id, weight: 1 });
        return;
      }
      // the household out in the street, across from the door
      const fam = freeResidents(db, ev, (r) => f!.family.includes(r.id) && r.age >= 3, { evenAtWork: true });
      const across = fam.map((_r, k): P2 => {
        const wm = walkMap();
        const side: P2 = [-f!.out[1], f!.out[0]];
        const x = f!.step[0] + f!.out[0] * 6 + side[0] * (k - fam.length / 2) * 0.9;
        const z = f!.step[1] + f!.out[1] * 6 + side[1] * (k - fam.length / 2) * 0.9;
        const q = wm.nearestOpen(x, z, 4) ?? { x: f!.step[0], z: f!.step[1] };
        return [q.x, q.z];
      });
      placeAt(db, ev, fam.map((r) => r.id), across.map(([x, z]) => ({ x, z })), "family");
      for (const id of f.family) remember(db, id, `Our house caught fire. We got out into the street and watched the smoke come out of the windows.`, 7);
      notify("events");
      return;
    }
    case "fire_brigade": {
      if (!f) return;
      const [px, pz, yaw] = f.pumpAt;
      const men = freeResidents(db, ev, (r) => r.sex === "m" && r.age >= 20 && r.age <= 52 && STRONG.has(r.trade) && !f!.family.includes(r.id))
        .sort((a, b) => Math.hypot(a.home.sx - FIRE_POST.x, a.home.sz - FIRE_POST.z) + hash(a.id + ev.id) * 60 - (Math.hypot(b.home.sx - FIRE_POST.x, b.home.sz - FIRE_POST.z) + hash(b.id + ev.id) * 60))
        .slice(0, FIREMEN);
      // two at each side of the pump, at its brakes (the long handles); the cart points along yaw
      const cx = Math.cos(yaw);
      const sx = Math.sin(yaw);
      men.forEach((r, k) => {
        const side = k % 2 ? 1 : -1;
        const fore = k < 2 ? 0.55 : -0.55;
        // local x (across) = (cos yaw, -sin yaw), local z (along) = (sin yaw, cos yaw)
        const spot = { x: px + cx * side * 1.15 + sx * fore, z: pz - sx * side * 1.15 + cx * fore };
        if (castEngineLead(db, ev, r.id, "fireman", spot, k)) f!.firemen.push(r.id);
      });
      saveFire(db, ev, f);
      // the street lines up while the pump comes (QA 2026-09-24: a chain called only at its own
      // stage was still walking in when the fire was out): the chain forms now, and passes buckets
      // from the next stage
      formChain(db, ev, f);
      writeEvent(db, {
        kind: "event",
        verb: "fire_brigade",
        text: `The pompiers came with the pump from ${FIRE_POST.label}${f.firemen.length ? `: ${f.firemen.map((id) => resident(db, id)?.name ?? id).join(", ")}` : ""}.`,
        place: ev.place,
        x: px,
        z: pz,
        ref_type: "town_event",
        ref_id: ev.id,
        weight: 5,
        who: f.firemen,
      });
      return;
    }
    case "fire_chain": {
      if (!f) return;
      // the line stands already (formChain at the brigade); gaps are filled now
      formChain(db, ev, f);
      writeEvent(db, { kind: "event", verb: "bucket_chain", text: `${f.chainIds.length} people stood in a bucket chain from the water to ${f.place}.`, place: ev.place, x: f.water[0], z: f.water[1], ref_type: "town_event", ref_id: ev.id, weight: 4 });
      return;
    }
    case "fire_down": {
      if (!f) return;
      settleJef(db, eventRow(db, ev.id)!, f);
      writeEvent(db, { kind: "event", verb: "fire_out", text: `The fire in ${f.place} was put out. The front is black with soot.`, place: ev.place, x: f.step[0], z: f.step[1], ref_type: "town_event", ref_id: ev.id, weight: 5, who: f.family });
      return;
    }
  }
}

/** Where a resident is now by the clock: at the work place when working, else at home (for who is near a fire). */
function whereNow(db: DB, r: Resident): P2 {
  const c = clock(db);
  const now = activityAt(r.sched, c.day, c.hour + c.minute / 60);
  if (now.act === "work" && r.work.at) return [r.work.at[0], r.work.at[1]];
  if (now.act !== "home") {
    const pl = town(db).town.places[now.act === "work" ? r.work.place : now.place];
    if (pl) return [pl.x, pl.z];
  }
  return [r.home.sx, r.home.sz];
}

/** How far off the chain takes people who are not there already: nobody walks in from across the town. */
export const CHAIN_FROM_M = 140;

/**
 * The bucket chain's people: the onlookers step in first (the nearest to the water first), then
 * free residents who are near now; each to a place in the line. Called when the pump comes (so
 * the line stands when the buckets start) and again at the chain's stage (to fill gaps). Nobody
 * already in it is moved.
 */
export function formChain(db: DB, ev: EventRow, f: FireScene): string[] {
  const cur = eventRow(db, ev.id)!;
  const leads = new Set(leadsOf(cur).map((l) => l.id));
  const people = JSON.parse(cur.people_json) as string[];
  const able = (r: Resident) => r.age >= 14 && r.age <= 66 && !["police", "priest", "lamplighter", "soldier", "sentry", "corporal"].includes(r.trade) && !leads.has(r.id) && !f.family.includes(r.id);
  const water = f.water;
  const near = (r: Resident) => {
    const [x, z] = whereNow(db, r);
    return Math.hypot(x - water[0], z - water[1]);
  };
  const have = new Set(f.chainIds.filter((id) => people.includes(id)));
  const taken = new Set<number>();
  // who already has a place keeps it
  const slotOf = new Map<string, number>();
  for (const id of [...have]) {
    // the place is the one their action walks to
    const a = actionOf(db, id);
    const k = a && a.event_id === ev.id && a.target_x !== null && a.target_z !== null ? f.chain.findIndex(([x, z]) => Math.abs(x - a.target_x!) < 0.05 && Math.abs(z - a.target_z!) < 0.05) : -1;
    if (k >= 0 && !taken.has(k)) {
      slotOf.set(id, k);
      taken.add(k);
    } else have.delete(id);
  }
  const onlookers = people.map((id) => resident(db, id)).filter((r): r is Resident => !!r && able(r) && !have.has(r.id));
  const fresh = freeResidents(db, ev, (r) => able(r) && !people.includes(r.id) && near(r) <= CHAIN_FROM_M).sort((a, b) => near(a) - near(b));
  const want = Math.max(CHAIN_MIN, Math.min(CHAIN_MAX, f.chain.length));
  const free = [...Array(f.chain.length).keys()].filter((k) => !taken.has(k));
  const room = Math.max(0, Math.min(want, f.chain.length) - have.size);
  const add = [...onlookers, ...fresh].slice(0, Math.min(room, free.length));
  // the free places in order from the water (the full line first), the newcomers in the order found
  const ids: string[] = [];
  const slots: Array<{ x: number; z: number }> = [];
  add.forEach((r, i) => {
    ids.push(r.id);
    const k = free[i];
    slots.push({ x: f.chain[k][0], z: f.chain[k][1] });
    slotOf.set(r.id, k);
  });
  const placed = placeAt(db, ev, ids, slots, "chain", (i) => ({ line: free[i] < f.full ? "full" : "empty" }));
  const byslot: string[] = new Array(f.chain.length).fill("");
  for (const [id, k] of slotOf) if (have.has(id) || placed.includes(id)) byslot[k] = id;
  f.chainIds = byslot.filter(Boolean);
  // chainIds in slot order, with the slot kept: the client matches people to places by their action's target
  saveFire(db, ev, f);
  return placed;
}

/** The game minute the chain stage ends. */
function chainEnd(ev: EventRow): number {
  const stages = JSON.parse(ev.stages_json) as StoredStage[];
  let m = ev.start_m;
  for (const s of stages) {
    m += s.minutes;
    if (s.act === "fire_chain") return m;
  }
  return ev.end_m;
}

// ------------------------------------------------------------------ Jef in the chain

export type ChainResult = { ok: true; text: string; slot: number } | { ok: false; why: string };

/** The fire whose chain stands now, if any. */
export function chainNow(db: DB): { ev: EventRow; fire: FireScene } | null {
  for (const ev of liveEvents(db)) {
    if (ev.template !== "house_fire" || ev.status !== "running") continue;
    const stages = JSON.parse(ev.stages_json) as StoredStage[];
    if (stages[ev.stage]?.act !== "fire_chain") continue;
    const f = stages[0]?.fire;
    if (f) return { ev, fire: f };
  }
  return null;
}

/** Jef steps into the chain at (x, z): the engine checks there is a chain and he stands in it. */
export function joinChain(db: DB, x: number, z: number): ChainResult {
  const c = chainNow(db);
  if (!c) return { ok: false, why: "There is no bucket chain to stand in." };
  const f = c.fire;
  if (f.jef && f.jef.left === null) return { ok: false, why: "You are in the chain already." };
  if (f.settled) return { ok: false, why: "That's done with." };
  let best = -1;
  let bd = CHAIN_JOIN_M;
  f.chain.forEach(([cx, cz], k) => {
    const d = Math.hypot(cx - x, cz - z);
    if (d < bd) {
      bd = d;
      best = k;
    }
  });
  if (best < 0) return { ok: false, why: "Stand by the line to take a bucket." };
  // back in after stepping out: the time already done counts on
  const before = f.jef && f.jef.left !== null ? f.jef.left - f.jef.joined : 0;
  f.jef = { joined: gameMinute(db) - before, left: null, slot: best };
  saveFire(db, c.ev, f);
  writeEvent(db, { kind: "deed", verb: "chain_join", actor: "player", target: f.owner, text: `Jef took a place in the bucket chain at ${f.place}.`, place: c.ev.place, x, z, ref_type: "town_event", ref_id: c.ev.id, weight: 3, who: f.family });
  notify("events");
  return { ok: true, text: "You take a bucket. Pass it on.", slot: best };
}

/** Jef steps out of the chain (walked away, or pressed E again). */
export function leaveChain(db: DB): ChainResult {
  const c = chainNow(db);
  const ev = c?.ev ?? null;
  const f = c?.fire ?? null;
  if (!ev || !f || !f.jef || f.jef.left !== null) return { ok: false, why: "You are not in a chain." };
  f.jef.left = gameMinute(db);
  saveFire(db, ev, f);
  notify("events");
  return { ok: true, text: "You step out of the chain.", slot: f.jef.slot };
}

/**
 * The engine settles Jef's time in the chain: at least CHAIN_COUNTS_MIN game minutes count.
 * A household with means pays 10 centimes a half hour (5 to 30); a poor one cannot, and owes
 * him instead: trust from every one of them, and the street talks well of him.
 */
export function settleJef(db: DB, ev: EventRow, f: FireScene): FireScene["settled"] {
  if (!f.jef || f.settled) return f.settled;
  const end = Math.min(chainEnd(ev), gameMinute(db));
  const minutes = Math.max(0, Math.min(f.jef.left ?? end, end) - f.jef.joined);
  const owner = resident(db, f.owner);
  const fam = f.family.map((id) => resident(db, id)).filter((r): r is Resident => !!r);
  const wealth = Math.max(0, ...fam.map((r) => r.stats.wealth));
  let paid = 0;
  let trust = 0;
  let text: string;
  if (minutes < CHAIN_COUNTS_MIN) {
    text = "You were hardly in the chain long enough to count.";
  } else if (wealth >= FIRE_PAY_WEALTH) {
    paid = Math.max(CHAIN_PAY_MIN_C, Math.min(CHAIN_PAY_MAX_C, Math.round((minutes / 30) * CHAIN_PAY_PER_30_MIN_C / 5) * 5));
    db.prepare("UPDATE player SET money_c = money_c + ? WHERE id = 1").run(paid);
    text = `${owner?.first ?? "The owner"} presses ${paid} centimes into your black hand. "For the buckets."`;
    log(db, "fire_chain_paid", f.owner, `Jef stood in the bucket chain at ${f.place} and was paid ${paid} centimes.`);
    remember(db, f.owner, `Jef stood in the bucket chain when our house burned. I paid him ${paid} centimes for it.`, 6, "seen", null, { gist: `Jef stood in the bucket chain when ${owner?.name ?? "a house"} burned`, tone: 1 });
  } else {
    trust = 1;
    for (const r of fam) db.prepare("UPDATE npc_relationship SET trust = MIN(10, trust + 1) WHERE npc_id = ?").run(r.id);
    text = `${owner?.first ?? "The owner"} has nothing to give. "We won't forget it, Jef."`;
    log(db, "fire_chain_helped", f.owner, `Jef stood in the bucket chain at ${f.place}; the family could not pay and owe him.`);
    for (const r of fam.filter((x) => x.age >= 12))
      remember(db, r.id, `Jef stood in the bucket chain when our house burned, and asked nothing for it.`, 7, "seen", null, r.id === f.owner ? { gist: `Jef stood in the bucket chain when ${owner?.name ?? "a house"} burned, and took nothing for it`, tone: 2 } : null);
  }
  f.settled = { minutes, paid_c: paid, trust, text };
  saveFire(db, ev, f);
  writeEvent(db, { kind: "deed", verb: "chain_settled", actor: "player", target: f.owner, text: `Jef's time in the bucket chain at ${f.place}: ${minutes} minutes; ${paid ? `paid ${paid} centimes` : trust ? "the family owes him" : "it did not count"}.`, ref_type: "town_event", ref_id: ev.id, weight: paid || trust ? 5 : 2, who: f.family, data: { minutes, paid_c: paid, trust } });
  notify("events", { jobs: true, fire_settled: text });
  return f.settled;
}

// ------------------------------------------------------------------ the end

export interface Soot {
  house: number;
  door: P2;
  out: P2;
  storeys: number;
  day: number;
  event: number;
}
/** The soot on a burned front fades over this many days (the client draws it). */
export const SOOT_DAYS = 3;

export function sootList(db: DB): Soot[] {
  const day = clock(db).day;
  return state<Soot[]>(db, "fire_soot", []).filter((s) => day - s.day <= SOOT_DAYS);
}

/** The event ends: Jef's part settled, the soot on the front, the town's talk. */
export function fireEnd(db: DB, ev: EventRow, status: "done" | "cancelled"): void {
  const f = fireOf(ev);
  if (!f) return;
  settleJef(db, ev, f);
  if (status !== "done") return;
  const list = state<Soot[]>(db, "fire_soot", []).filter((s) => s.event !== ev.id);
  list.push({ house: f.house, door: f.door, out: f.out, storeys: f.storeys, day: clock(db).day, event: ev.id });
  setState(db, "fire_soot", list.slice(-6));
  const firemen = f.firemen.map((id) => resident(db, id)?.first).filter(Boolean);
  const jef = f.settled && (f.settled.paid_c || f.settled.trust) ? " Jef stood in the chain with them." : "";
  const text = `Fire in ${f.place}: the pompiers came with the pump${firemen.length ? ` (${firemen.join(", ")})` : ""}, and the street stood in a bucket chain till it was out. Nobody was hurt; the front is black.${jef}`;
  db.prepare("INSERT INTO world_fact (text, weight, day, tags) VALUES (?, 6, ?, ?)").run(text, clock(db).day, `rumour,event:${ev.id}`);
  for (const id of [...f.firemen, ...f.chainIds.slice(0, 10)]) remember(db, id, `I helped put out the fire in ${f.place}.`, 4);
}

/** What the client needs: the house, the water, the chain, the pump's way, Jef's place. */
export function fireForClient(stages: StoredStage[]) {
  const f = stages[0]?.fire;
  if (!f) return null;
  return {
    owner: f.owner,
    owner_name: f.owner_name,
    door: f.door,
    out: f.out,
    step: f.step,
    storeys: f.storeys,
    water: f.water,
    chain: f.chain,
    full: f.full,
    chain_ids: f.chainIds,
    station: f.station,
    pump_path: f.pumpPath,
    pump_at: f.pumpAt,
    firemen: f.firemen,
    jef: f.jef ? { slot: f.jef.slot, in: f.jef.left === null } : null,
    settled: f.settled?.text ?? null,
  };
}
