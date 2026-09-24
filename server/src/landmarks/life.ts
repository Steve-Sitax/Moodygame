import type { DB } from "../db.ts";
import { clock } from "../day.ts";
import { activityAt } from "../town/schedule.ts";
import { resident, town } from "../town/store.ts";
import type { Resident } from "../town/population.ts";
import { isAwayVisitor } from "../town/visitors.ts";
import {
  civilWeddingAt,
  civilWeddingDay,
  confessionOpen,
  isSunday,
  LANDMARK_DOORS,
  LANDMARK_LABEL,
  landmarkOpen,
  massAt,
  organPractice,
  theatreAt,
  type LandmarkId,
  type Service,
} from "../../../shared/landmarks.ts";
import { LANDMARK_PLACE, newcomerLandmark } from "./town.ts";

// Who is inside a landmark now, and what goes on there (M6 landmark interiors). ENGINE only:
// everything follows from the residents' schedules, the clock and the town's events; no model
// is asked. The client asks every few seconds and walks the people to their places.
//
// - Staff come from their own hours: the curate, the organist, the beadle and the chair woman
//   (new), the town's own priest and sexton at the big services; the clerks of the town hall
//   (the town's two and the new ones); Peyrot's cellar master and cellarmen; the painter; the
//   museum's attendant; the storekeeper and the natie men of the Oostershuis.
// - Those who come and go are townspeople whose schedule has them indoors at home now (so the
//   street never shows them twice), picked by a hash of the hour, never one busy with an action
//   or an event: the pious at mass and at prayer, callers at the registry, visitors at the
//   museum, the theatre society's members in the evening. On Sunday the whole "church" crowd.
// - The M4 wedding: while a wedding at the cathedral's west door is gathering, the couple, the
//   priest and the guests stand inside at the altar (read-only: town_event).

export interface InPerson {
  id: string;
  name: string;
  first: string;
  kind: string;
  sex: "m" | "f";
  age: number;
  /** What they do here (the client has a place and a routine for each). */
  role: string;
  /** For the talk window ("the curate"). */
  title?: string;
}

export interface WeddingInside {
  event: number;
  title: string;
  groom: string;
  bride: string;
  /** "vows" while the party gathers at the church; "leaving" when the procession has begun. */
  stage: "vows" | "leaving";
}

export interface LandmarkNow {
  id: LandmarkId;
  label: string;
  open: boolean;
  day: number;
  hour: number;
  people: InPerson[];
  /** The cathedral: the service now, the organ, the confessional, a wedding inside. */
  service: Service | null;
  organ: boolean;
  confession: { open: boolean; priest: string | null };
  wedding: WeddingInside | null;
  /** The town hall: a civil wedding in the wedding hall now, today's register, the bills on the board. */
  civil: { groom: string; bride: string } | null;
  register: string[];
  posters: Array<{ kind: string; heading: string; body: string; footer: string }>;
  /** The Vleeshuis: the theatre society upstairs. */
  theatre: { kind: "rehearsal" | "performance" } | null;
}

/** How many of each come in, at most (the draw calls inside stay low). */
export const CAP = { congregation: 44, weekdayMass: 12, prayers: 5, guests: 30, callers: 3, visitors: 6, audience: 16, cast: 5 };

export const TITLES: Record<string, string> = {
  lm_curate: "the curate",
  lm_organist: "the organist",
  lm_beadle: "the beadle",
  lm_chairs: "the chair woman",
  lm_registrar: "the registrar",
  lm_alderman: "the alderman",
  lm_copyclerk: "a clerk",
  lm_concierge: "the porter",
  lm_cellarmaster: "Peyrot's cellar master",
  lm_painter: "the painter",
  lm_custodian: "the attendant",
  lm_storekeeper: "the storekeeper",
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The same few for the same seed: a hash order. */
function pickFew<T extends { id: string }>(list: T[], n: number, seed: string): T[] {
  return list
    .map((r) => ({ r, k: hash(r.id + seed) }))
    .sort((a, b) => a.k - b.k)
    .slice(0, n)
    .map((o) => o.r);
}

const person = (r: Resident, role: string, title?: string): InPerson => ({ id: r.id, name: r.name, first: r.first, kind: r.kind, sex: r.sex, age: r.age, role, title: title ?? TITLES[r.id] });

const at = (r: Resident, day: number, hour: number) => activityAt(r.sched, day, hour);
const atWork = (r: Resident | undefined, day: number, hour: number) => !!r && at(r, day, hour).act === "work";

/** Townspeople busy elsewhere: in an action (M4) or in a running event. */
export function busyIds(db: DB): Set<string> {
  const out = new Set<string>();
  try {
    for (const r of db.prepare("SELECT npc_id FROM npc_action WHERE status = 'active'").all() as Array<{ npc_id: string }>) out.add(r.npc_id);
    for (const r of db.prepare("SELECT people_json FROM town_event WHERE status = 'running'").all() as Array<{ people_json: string }>)
      for (const id of JSON.parse(r.people_json || "[]") as string[]) out.add(id);
  } catch {
    /* an old save without the M4 tables */
  }
  return out;
}

/** Indoors at home now by their schedule, a grown-up of the town, not busy: free to walk in somewhere. */
function freeAtHome(db: DB, day: number, hour: number, busy: Set<string>): Resident[] {
  return town(db).town.residents.filter((r) => {
    if (r.age < 16 || busy.has(r.id) || isAwayVisitor(r)) return false;
    if (r.work.kind === "wait" || r.trade === "infant" || r.id === "fortune") return false;
    if (newcomerLandmark(r.id)) return false;
    return at(r, day, hour).act === "home";
  });
}

const works = (r: Resident, lm: LandmarkId) => r.work.place === LANDMARK_PLACE[lm];

// ------------------------------------------------------------------ the M4 wedding (read only)

interface WeddingRow {
  id: number;
  title: string;
  template: string;
  place: string;
  stage: number;
  stages_json: string;
  people_json: string;
  leads_json: string;
  status: string;
  day: number;
}
interface LeadRow {
  role: string;
  id: string;
  name: string;
}

/**
 * A wedding at the cathedral that runs now, with its couple cast (M4b leads). "vows" while the
 * party gathers at the west door (the stages before the procession); "leaving" once it walks.
 */
export function weddingNow(db: DB): { row: WeddingRow; leads: LeadRow[]; stage: "vows" | "leaving" } | null {
  let rows: WeddingRow[] = [];
  try {
    rows = db.prepare("SELECT id, title, template, place, stage, stages_json, people_json, leads_json, status, day FROM town_event WHERE status = 'running' ORDER BY id DESC").all() as WeddingRow[];
  } catch {
    return null;
  }
  for (const row of rows) {
    const leads = JSON.parse(row.leads_json || "[]") as LeadRow[];
    if (!leads.some((l) => l.role === "bride") || !leads.some((l) => l.role === "groom")) continue;
    const stages = JSON.parse(row.stages_json || "[]") as Array<{ op: string; place?: string }>;
    const atChurch = row.place === "cathedral_west" || stages.some((s) => s.place === "cathedral_west");
    if (!atChurch) continue;
    const firstWalk = stages.findIndex((s) => s.op === "procession");
    const stage = firstWalk >= 0 && row.stage >= firstWalk ? "leaving" : "vows";
    return { row, leads, stage };
  }
  return null;
}

/** Couples married in the town's events today (the civil register records them too). */
function eventCouplesToday(db: DB, day: number): Array<{ groom: string; bride: string }> {
  let rows: Array<{ leads_json: string }> = [];
  try {
    rows = db.prepare("SELECT leads_json FROM town_event WHERE day = ? AND status IN ('running', 'done')").all(day) as Array<{ leads_json: string }>;
  } catch {
    return [];
  }
  const out: Array<{ groom: string; bride: string }> = [];
  for (const r of rows) {
    const leads = JSON.parse(r.leads_json || "[]") as LeadRow[];
    const g = leads.find((l) => l.role === "groom");
    const b = leads.find((l) => l.role === "bride");
    if (g && b) out.push({ groom: g.name, bride: b.name });
  }
  return out;
}

// ------------------------------------------------------------------ the cathedral

function cathedralPeople(db: DB, day: number, hour: number, busy: Set<string>): Pick<LandmarkNow, "people" | "service" | "organ" | "confession" | "wedding"> {
  const t = town(db).town;
  const people: InPerson[] = [];
  const seen = new Set<string>();
  const add = (r: Resident | undefined, role: string, title?: string) => {
    if (!r || seen.has(r.id)) return;
    seen.add(r.id);
    people.push(person(r, role, title));
  };
  const service = massAt(day, hour);
  const curate = resident(db, "lm_curate");
  const parish = t.residents.find((r) => r.trade === "priest" && r.id !== "lm_curate");
  const sexton = t.residents.find((r) => r.trade === "sexton");
  const organist = resident(db, "lm_organist");
  const beadle = resident(db, "lm_beadle");
  const chairs = resident(db, "lm_chairs");
  const wed = weddingNow(db);
  const wedding: WeddingInside | null = wed
    ? { event: wed.row.id, title: wed.row.title, groom: wed.leads.find((l) => l.role === "groom")!.name, bride: wed.leads.find((l) => l.role === "bride")!.name, stage: wed.stage }
    : null;

  // the wedding (M4): the couple before the altar, the priest facing them, the guests in the chairs
  if (wed && wed.stage === "vows") {
    const leadPriest = wed.leads.find((l) => l.role === "priest");
    add(resident(db, wed.leads.find((l) => l.role === "groom")!.id), "groom");
    add(resident(db, wed.leads.find((l) => l.role === "bride")!.id), "bride");
    add(resident(db, leadPriest?.id ?? "") ?? parish ?? curate, "wedding_priest", "the priest");
    add(sexton, "sexton", "the sexton");
    if (organist && at(organist, day, hour).act !== "church") add(organist, "organist");
    const leadIds = new Set(wed.leads.map((l) => l.id));
    const guests = (JSON.parse(wed.row.people_json || "[]") as string[])
      .filter((id) => !leadIds.has(id))
      .map((id) => resident(db, id))
      .filter((r): r is Resident => !!r && r.age >= 6)
      .slice(0, CAP.guests);
    for (const g of guests) add(g, "guest");
  }

  // the service: the celebrant at the altar, the sexton serving, the beadle, the chair woman, the organist
  if (service && !(wed && wed.stage === "vows")) {
    const celebrant = service.celebrant === "parish" && atWork(parish, day, hour) ? parish : atWork(curate, day, hour) ? curate : parish;
    add(celebrant, "celebrant", "the priest");
    if (service.kind !== "low" || atWork(sexton, day, hour)) add(sexton, "sexton", "the sexton");
    if (atWork(beadle, day, hour)) add(beadle, "beadle_mass");
    if (atWork(chairs, day, hour)) add(chairs, "chairs_collect");
    if (service.organ && organist && at(organist, day, hour).act === "work") add(organist, "organist");
    // the faithful: on Sunday all whose day says church now; on weekdays a few of the pious at home
    const flock = isSunday(day)
      ? t.residents.filter((r) => at(r, day, hour).act === "church" && !busy.has(r.id)).sort((a, b) => hash(a.id) - hash(b.id)).slice(0, CAP.congregation)
      : pickFew(
          freeAtHome(db, day, hour, busy).filter((r) => r.stats.piety >= 6),
          CAP.weekdayMass,
          `mass:${day}:${service.from}`,
        );
    for (const r of flock) add(r, "worshipper");
  } else if (!(wed && wed.stage === "vows")) {
    // between services: the curate in the confessional, the beadle about the aisles, the chair woman by her chairs
    if (atWork(curate, day, hour)) add(curate, confessionOpen(day, hour) ? "confessor" : "sacristy");
    if (atWork(beadle, day, hour)) add(beadle, "beadle");
    if (atWork(chairs, day, hour)) add(chairs, "chairs");
    if (organist && atWork(organist, day, hour) && organPractice(day, hour)) add(organist, "organist");
    // a few at prayer: a candle at the Lady altar, a prayer in the chairs, a side chapel (a new lot every half hour)
    const slot = Math.floor(hour * 2);
    const praying = pickFew(
      freeAtHome(db, day, hour, busy).filter((r) => r.stats.piety >= 5),
      2 + (hash(`n:${day}:${slot}`) % (CAP.prayers - 1)),
      `pray:${day}:${slot}`,
    );
    const roles = ["candle", "prayer", "chapel", "prayer", "candle"];
    praying.forEach((r, i) => add(r, roles[i % roles.length]));
  }
  const organ = people.some((p) => p.role === "organist");
  const inBox = people.find((p) => p.role === "confessor");
  return { people, service: wed && wed.stage === "vows" ? { kind: "wedding", from: hour, to: hour + 1, celebrant: "parish", organ } : service, organ, confession: { open: !!inBox, priest: inBox?.id ?? null }, wedding };
}

// ------------------------------------------------------------------ the town hall

/** Today's civil couple (Tuesday, Thursday, Saturday): a courting pair of the town, the engine's pick. */
export function civilCouple(db: DB, day: number): { groom: Resident; bride: Resident } | null {
  if (!civilWeddingDay(day)) return null;
  const t = town(db).town;
  // free to marry this morning: at home, or at work indoors (a maid, a clerk: out of sight of the street, and given the morning off); not the garrison
  const home = (r: Resident) => {
    const a = at(r, day, 11.5);
    return (a.act === "home" || (a.act === "work" && r.work.kind === "inside")) && !["soldier", "sentry", "corporal", "priest"].includes(r.trade) && !isAwayVisitor(r) && r.work.kind !== "wait" && !newcomerLandmark(r.id);
  };
  const men = t.residents.filter((r) => r.sex === "m" && r.age >= 21 && r.age <= 40 && ["son", "single", "lodger", "widower"].includes(r.family_role) && home(r));
  const women = t.residents.filter((r) => r.sex === "f" && r.age >= 18 && r.age <= 36 && ["daughter", "single", "lodger", "widow"].includes(r.family_role) && home(r));
  const groom = pickFew(men, 1, `civil:${day}`)[0];
  if (!groom) return null;
  const bride = women
    .filter((w) => w.household !== groom.household && Math.abs(w.age - groom.age) <= 10)
    .sort((a, b) => Math.hypot(a.home.sx - groom.home.sx, a.home.sz - groom.home.sz) - Math.hypot(b.home.sx - groom.home.sx, b.home.sz - groom.home.sz))[0];
  return bride ? { groom, bride } : null;
}

/** The register of the civil state for today: the town hall's weddings, and those of the town's events (M4). */
export function registerToday(db: DB, day: number, hour: number): string[] {
  const out: string[] = [];
  const c = civilCouple(db, day);
  if (c && hour >= 11.5) out.push(`Married at the town hall before the alderman: ${c.groom.name} and ${c.bride.name}.`);
  for (const e of eventCouplesToday(db, day)) out.push(`Married at the town hall this morning, and after in the cathedral: ${e.groom} and ${e.bride}.`);
  return out;
}

/** The bills pasted up in the town (M6 ideas, read only): the newest few, for the notice board inside. */
export function boardPosters(db: DB): LandmarkNow["posters"] {
  try {
    const rows = db.prepare("SELECT kind, text_json FROM poster WHERE status = 'up' ORDER BY id DESC LIMIT 6").all() as Array<{ kind: string; text_json: string }>;
    return rows
      .map((r) => {
        const t = JSON.parse(r.text_json || "{}") as { heading?: string; body?: string; footer?: string };
        return { kind: r.kind, heading: String(t.heading ?? ""), body: String(t.body ?? ""), footer: String(t.footer ?? "") };
      })
      .filter((p) => p.heading || p.body);
  } catch {
    return [];
  }
}

function townhallPeople(db: DB, day: number, hour: number, busy: Set<string>): Pick<LandmarkNow, "people" | "civil" | "register" | "posters"> {
  const t = town(db).town;
  const people: InPerson[] = [];
  const seen = new Set<string>();
  const add = (r: Resident | undefined, role: string, title?: string) => {
    if (!r || seen.has(r.id)) return;
    seen.add(r.id);
    people.push(person(r, role, title));
  };
  const civilNow = civilWeddingAt(day, hour);
  const couple = civilNow ? civilCouple(db, day) : null;
  const registrar = resident(db, "lm_registrar");
  const alderman = resident(db, "lm_alderman");
  if (couple && !busy.has(couple.groom.id) && !busy.has(couple.bride.id)) {
    add(couple.groom, "c_groom");
    add(couple.bride, "c_bride");
    add(alderman, "alderman_wed");
    add(registrar, "registrar_wed");
    // two witnesses and the families: the couple's households, and neighbours at home
    const fam = t.residents.filter((r) => (r.household === couple.groom.household || r.household === couple.bride.household) && r.id !== couple.groom.id && r.id !== couple.bride.id && at(r, day, hour).act === "home" && !busy.has(r.id));
    const witnesses = pickFew(freeAtHome(db, day, hour, busy).filter((r) => r.sex === "m" && r.age >= 21 && !fam.includes(r) && r.id !== couple.groom.id), 2, `wit:${day}`);
    for (const w of witnesses) add(w, "witness");
    for (const f of fam.slice(0, 5)) add(f, "c_guest");
  }
  for (const r of t.residents) if ((r.work.place === "town_hall" || works(r, "townhall")) && at(r, day, hour).act === "work") add(r, r.id === "lm_registrar" ? "registrar" : r.id === "lm_alderman" ? "alderman" : r.id === "lm_concierge" ? "concierge" : "clerk", r.trade === "clerk" && !TITLES[r.id] ? "a clerk" : undefined);
  // callers at the registry: a birth, a death, a certificate (a new lot every half hour)
  const slot = Math.floor(hour * 2);
  const callers = pickFew(freeAtHome(db, day, hour, busy).filter((r) => !seen.has(r.id)), 1 + (hash(`c:${day}:${slot}`) % CAP.callers), `caller:${day}:${slot}`);
  callers.forEach((r, i) => add(r, i === 0 ? "caller" : "waiting"));
  return { people, civil: couple ? { groom: couple.groom.name, bride: couple.bride.name } : null, register: registerToday(db, day, hour), posters: boardPosters(db) };
}

// ------------------------------------------------------------------ the Vleeshuis, the Steen, the Oostershuis

/** The theatre society: a fixed dozen of the town (by the town's hash), who come when they are free. */
function society(db: DB): Resident[] {
  return pickFew(
    town(db).town.residents.filter((r) => r.age >= 18 && r.age <= 60 && r.stats.wealth >= 2 && !newcomerLandmark(r.id) && r.work.kind !== "wait" && !isAwayVisitor(r)),
    14,
    "liefde-en-eendragt",
  );
}

function vleeshuisPeople(db: DB, day: number, hour: number, busy: Set<string>): Pick<LandmarkNow, "people" | "theatre"> {
  const t = town(db).town;
  const people: InPerson[] = [];
  const seen = new Set<string>();
  const add = (r: Resident | undefined, role: string, title?: string) => {
    if (!r || seen.has(r.id)) return;
    seen.add(r.id);
    people.push(person(r, role, title));
  };
  for (const r of t.residents) {
    if (!works(r, "vleeshuis") || at(r, day, hour).act !== "work") continue;
    add(r, r.trade === "cellar_master" ? "cellarmaster" : r.trade === "painter" ? "painter" : "cellarman", r.trade === "cellarman" ? "a cellarman" : undefined);
  }
  const th = theatreAt(day, hour);
  if (th) {
    const free = society(db).filter((r) => at(r, day, hour).act === "home" && !busy.has(r.id));
    const cast = free.slice(0, CAP.cast + 1);
    cast.forEach((r, i) => add(r, i === 0 ? "prompter" : "actor", i === 0 ? "the society's prompter" : "a player of the society"));
    if (th.kind === "performance") for (const r of pickFew(freeAtHome(db, day, hour, busy).filter((r) => !seen.has(r.id)), CAP.audience, `aud:${day}`)) add(r, "audience");
  }
  return { people, theatre: th ? { kind: th.kind } : null };
}

function steenPeople(db: DB, day: number, hour: number, busy: Set<string>): InPerson[] {
  const people: InPerson[] = [];
  const cust = resident(db, "lm_custodian");
  if (atWork(cust, day, hour)) people.push(person(cust!, "custodian"));
  // visitors who walk slowly and look: a new few each game hour, fewer at the start of the day
  const slot = Math.floor(hour);
  const n = Math.min(CAP.visitors, 2 + (hash(`v:${day}:${slot}`) % 5) - (hour < 11 ? 1 : 0));
  for (const r of pickFew(freeAtHome(db, day, hour, busy).filter((r) => r.stats.wealth >= 2 || r.stats.gossip >= 6), n, `museum:${day}:${slot}`)) people.push(person(r, "visitor"));
  return people;
}

function oostershuisPeople(db: DB, day: number, hour: number): InPerson[] {
  return town(db)
    .town.residents.filter((r) => works(r, "oostershuis") && at(r, day, hour).act === "work")
    .map((r) => person(r, r.trade === "storekeeper" ? "storekeeper" : "porter", r.trade === "natie" ? "a natie man" : undefined));
}

// ------------------------------------------------------------------ now

export function landmarkNow(db: DB, id: LandmarkId): LandmarkNow {
  const c = clock(db);
  const hour = c.hour + c.minute / 60;
  const open = landmarkOpen(id, c.day, hour);
  const base: LandmarkNow = {
    id,
    label: LANDMARK_LABEL[id],
    open,
    day: c.day,
    hour,
    people: [],
    service: null,
    organ: false,
    confession: { open: false, priest: null },
    wedding: null,
    civil: null,
    register: [],
    posters: [],
    theatre: null,
  };
  const busy = busyIds(db);
  switch (id) {
    case "cathedral": {
      const r = cathedralPeople(db, c.day, hour, busy);
      // the wedding keeps the church open whatever the hour
      return { ...base, ...r, open: open || !!r.wedding, people: open || r.wedding ? r.people : [] };
    }
    case "townhall":
      return open ? { ...base, ...townhallPeople(db, c.day, hour, busy) } : { ...base, register: registerToday(db, c.day, hour) };
    case "vleeshuis":
      return open ? { ...base, ...vleeshuisPeople(db, c.day, hour, busy) } : base;
    case "steen":
      return open ? { ...base, people: steenPeople(db, c.day, hour, busy) } : base;
    case "oostershuis":
      return open ? { ...base, people: oostershuisPeople(db, c.day, hour) } : base;
  }
}

/** Every landmark's doors and whether they are open now (the street's keys). */
export function landmarkDoors(db: DB) {
  const c = clock(db);
  const hour = c.hour + c.minute / 60;
  const wed = weddingNow(db);
  return LANDMARK_DOORS.map((d) => ({ ...d, open: landmarkOpen(d.landmark, c.day, hour) || (d.landmark === "cathedral" && !!wed) }));
}

// ------------------------------------------------------------------ talk: where they are (talkExtras.context)

/** Which landmark Jef is in (the client says so as he goes in and out); null in the street. */
let jefIn: LandmarkId | null = null;
export function setJefIn(id: LandmarkId | null): void {
  jefIn = id;
}
export function jefInside(): LandmarkId | null {
  return jefIn;
}

const ROLE_WORDS: Record<string, string> = {
  celebrant: "saying mass at the high altar",
  confessor: "hearing confession in your confessional in the south aisle",
  sacristy: "about the sacristy and the altars between masses",
  sexton: "serving at the altar as the sexton",
  beadle: "keeping order in the aisles with your staff",
  beadle_mass: "standing at the head of the nave with your staff during mass",
  chairs: "minding the chairs you let at mass",
  chairs_collect: "going along the rows for the chair money during mass",
  organist: "up in the organ loft at the keys",
  worshipper: "at mass, on a chair in the nave",
  prayer: "praying on a chair in the nave",
  candle: "lighting a candle at the Lady altar",
  chapel: "praying at a side altar",
  groom: "at the altar rail, being married",
  bride: "at the altar rail, being married",
  wedding_priest: "marrying a couple at the high altar",
  guest: "a guest at a wedding in the nave",
  clerk: "at your desk in the clerks' office, with the ledgers",
  registrar: "at the counter of the civil registry, writing in the registers",
  alderman: "in your office upstairs",
  alderman_wed: "marrying a couple in the wedding hall, in your sash",
  registrar_wed: "at the table in the wedding hall with the register",
  concierge: "in your lodge by the door",
  caller: "at the registry counter, on business with the clerk",
  waiting: "waiting on the bench for the clerk",
  c_groom: "being married in the wedding hall",
  c_bride: "being married in the wedding hall",
  witness: "a witness at a wedding in the wedding hall",
  c_guest: "at a wedding in the wedding hall",
  cellarmaster: "at your desk among the barrels, with the cellar book",
  cellarman: "rolling barrels in the cellar hall",
  painter: "at your easel in your studio upstairs",
  prompter: "with the book at the front of the stage, at the society's rehearsal",
  actor: "on the stage upstairs, rehearsing with the theatre society",
  audience: "in the theatre hall upstairs, watching the society's play",
  custodian: "keeping the halls of the museum",
  visitor: "looking at the old things in the glass cases",
  storekeeper: "at your desk by the gate with the warehouse books",
  porter: "carrying sacks in the great hall",
};

/** For the talk prompt: when Jef talks to someone inside the landmark he is in, where they are and what they do. */
export function landmarkTalkContext(db: DB, r: Resident): string {
  if (!jefIn) return "";
  const now = landmarkNow(db, jefIn);
  const me = now.people.find((p) => p.id === r.id);
  if (!me) return "";
  const what = ROLE_WORDS[me.role] ?? "inside";
  const quiet = jefIn === "cathedral" ? " Speak low: it is a church." : "";
  return `WHERE YOU ARE: inside ${LANDMARK_LABEL[jefIn]}, ${what}. Jef has come in and speaks to you here.${quiet}`;
}
