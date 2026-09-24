import type { DB } from "../db.ts";
import { clock } from "../day.ts";
import type { Resident } from "../town/population.ts";
import { activityAt } from "../town/schedule.ts";
import { town, TOWN_EMPLOYER_IDS } from "../town/store.ts";
import { activeActions, isReserved } from "./actions.ts";
import { isEmigrant } from "../town/emigrants.ts";
import { BEARERS, LEAD_LABEL, LEADS_PER_STAGE, type LeadRole } from "./vocab.ts";

// M4b: lead roles. A stage may name up to four leads (bride, groom, priest, the three
// musicians, an auctioneer, a pickpocket and his victim ...). The ENGINE picks the resident
// for each: sex, age and trade from a fixed table, free (not in another event, not on an
// errand, not reserved), near the place, and the bride and groom a courting pair (an
// unmarried man and woman, not of one family, close in age, living near each other). The
// client dresses them from a fixed wardrobe. Nothing here is the model's.

/**
 * M6 town life: leads the ENGINE casts itself, never named by the model (they are not in the
 * director's schema): the firemen at a house fire and the natie foreman at the dawn hiring.
 */
export type EngineLeadRole = "fireman" | "natie_foreman" | "ballad_singer";
export type AnyLeadRole = LeadRole | EngineLeadRole;
export const ENGINE_LEAD_LABEL: Record<EngineLeadRole, string> = { fireman: "the firemen", natie_foreman: "the natie foreman", ballad_singer: "the ballad singer" };
/** What a role is called in a line: the director's roles and the engine's own. */
export const labelOf = (role: AnyLeadRole): string => (role in ENGINE_LEAD_LABEL ? ENGINE_LEAD_LABEL[role as EngineLeadRole] : LEAD_LABEL[role as LeadRole]) ?? "someone";

export interface Lead {
  role: AnyLeadRole;
  id: string;
  name: string;
  /** The stage that first names them (where they walk to at the start). */
  stage: number;
  /** Bearers: which of the four (0, 1 carry the coffin in front). */
  n?: number;
}

const UNWED_MAN = new Set(["son", "single", "lodger", "widower"]);
const UNWED_WOMAN = new Set(["daughter", "single", "lodger", "widow"]);
const NOT_FOR_WEDDING = new Set(["police", "priest", "thief", "beggar", "soldier", "sentry", "corporal", "customs", "street_child", "child", "infant", "water_bailiff"]);
const MUSICIAN_TRADES = ["sailor", "retired", "beggar", "docker", "boatman", "carter"];
const STRONG = ["docker", "natie", "porter", "carter", "boatman", "sailor", "brewer"];

/** Does this resident fit this role (before the pairing and the distance)? */
export function fitsLead(r: Resident, role: LeadRole, keeperAtWork: boolean): boolean {
  if (r.trade === "infant" || r.work.kind === "guard") return false;
  switch (role) {
    case "bride":
      return r.sex === "f" && r.age >= 18 && r.age <= 34 && UNWED_WOMAN.has(r.family_role) && !NOT_FOR_WEDDING.has(r.trade) && !keeperAtWork;
    case "groom":
      return r.sex === "m" && r.age >= 20 && r.age <= 40 && UNWED_MAN.has(r.family_role) && !NOT_FOR_WEDDING.has(r.trade) && !keeperAtWork;
    case "priest":
      return r.trade === "priest";
    case "organ_grinder":
    case "fiddler":
    case "accordionist":
      return r.sex === "m" && r.age >= 16 && MUSICIAN_TRADES.includes(r.trade) && !keeperAtWork;
    case "auctioneer":
      // a man who sells for his living: at work is fine, the sale is his work
      return r.sex === "m" && r.age >= 28 && ["fish_merchant", "merchant", "foreman", "clerk", "grocer", "chandler"].includes(r.trade);
    case "speaker":
      return r.sex === "m" && r.age >= 25 && ["clerk", "merchant", "retired", "draper", "tobacconist", "sexton"].includes(r.trade) && !keeperAtWork;
    case "drunkard":
      return r.sex === "m" && r.age >= 20 && ["docker", "sailor", "boatman", "carter", "beggar", "retired", "natie", "porter"].includes(r.trade) && !keeperAtWork;
    case "pickpocket":
      return r.trade === "thief" && r.age >= 12;
    case "victim":
      return r.age >= 18 && !["police", "thief", "beggar", "priest", "water_bailiff", "soldier", "sentry", "corporal", "customs"].includes(r.trade) && !keeperAtWork;
    case "widow":
      return r.sex === "f" && r.age >= 38 && (r.family_role === "widow" || r.age >= 50) && !keeperAtWork;
    case "bearers":
      return r.sex === "m" && r.age >= 20 && r.age <= 55 && STRONG.includes(r.trade) && !keeperAtWork;
    case "hawker":
      return r.age >= 12 && ["market_woman", "street_child", "errand_boy", "beggar", "fishwife"].includes(r.trade);
    case "showman":
      return r.sex === "m" && r.age >= 20 && ["sailor", "retired", "beggar", "boatman"].includes(r.trade) && !keeperAtWork;
    case "quarreller":
      return r.age >= 18 && !["police", "priest", "water_bailiff", "soldier", "sentry", "corporal", "customs"].includes(r.trade) && !keeperAtWork;
    case "agent":
      return r.trade === "police";
    default:
      return false;
  }
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};

export interface LeadAsk {
  role: LeadRole;
  stage: number;
  at: { x: number; z: number };
}

/**
 * Pick the leads of an event: every role the stages name (in order, at most four per stage,
 * bearers bring four men). `taken`: people already in this or another event. Returns the
 * leads found and the roles nobody could fill.
 */
export function pickLeads(db: DB, asks: LeadAsk[], taken: Set<string>, salt: string): { leads: Lead[]; missing: LeadRole[] } {
  const c = clock(db);
  const busy = new Set(activeActions(db).map((a) => a.npc_id));
  const all = town(db).town.residents;
  // M6 emigrants: nobody waiting by the chests to board is cast in a part
  const free = (r: Resident) => !taken.has(r.id) && !busy.has(r.id) && !TOWN_EMPLOYER_IDS.includes(r.id) && !isReserved(db, r.id) && !isEmigrant(r);
  const keeper = (r: Resident) => (r.work.kind === "stall" || r.work.kind === "shop" || r.work.kind === "tavern") && activityAt(r.sched, c.day, c.hour + c.minute / 60).act === "work";
  const leads: Lead[] = [];
  const missing: LeadRole[] = [];
  const used = new Set<string>();
  const score = (r: Resident, at: { x: number; z: number }, role: LeadRole) =>
    Math.hypot(r.home.sx - at.x, r.home.sz - at.z) + hash(r.id + salt + role) * 80 - (role === "quarreller" || role === "drunkard" ? r.stats.temper * 12 - (r.sex === "f" ? 60 : 0) : 0);
  const pool = (role: LeadRole, at: { x: number; z: number }) =>
    all
      .filter((r) => !used.has(r.id) && free(r) && fitsLead(r, role, keeper(r)))
      .sort((a, b) => score(a, at, role) - score(b, at, role));
  const take = (r: Resident, role: LeadRole, stage: number, n?: number) => {
    used.add(r.id);
    leads.push({ role, id: r.id, name: r.name, stage, ...(n !== undefined ? { n } : {}) });
  };

  // a courting pair first: the groom, then the girl who lives nearest him, not his own family
  const groomAsk = asks.find((a) => a.role === "groom");
  const brideAsk = asks.find((a) => a.role === "bride");
  if (groomAsk && brideAsk) {
    let paired = false;
    for (const g of pool("groom", groomAsk.at).slice(0, 12)) {
      const b = pool("bride", brideAsk.at)
        .filter((w) => (w.household !== g.household || w.family_role === "lodger" || g.family_role === "lodger") && w.surname !== g.surname && Math.abs(w.age - g.age) <= 12 && w.age <= g.age + 4)
        .sort((x, y) => Math.hypot(x.home.sx - g.home.sx, x.home.sz - g.home.sz) - Math.hypot(y.home.sx - g.home.sx, y.home.sz - g.home.sz))[0];
      if (!b) continue;
      take(g, "groom", groomAsk.stage);
      take(b, "bride", brideAsk.stage);
      paired = true;
      break;
    }
    if (!paired) missing.push("groom", "bride");
  }

  for (const ask of asks) {
    if ((ask.role === "groom" || ask.role === "bride") && groomAsk && brideAsk) continue;
    // the same role twice in one stage (two quarrellers) is two people; a role already cast in an
    // earlier stage is the same person again
    const k = asks.filter((a) => a.stage === ask.stage && a.role === ask.role).indexOf(ask);
    const cast = leads.filter((l) => l.role === ask.role);
    if (ask.role === "bearers" ? cast.length > 0 : cast.length > k) continue;
    if (missing.includes(ask.role) && ask.role !== "quarreller") continue;
    if (ask.role === "bearers") {
      const men = pool("bearers", ask.at).slice(0, BEARERS);
      if (men.length < 2) missing.push("bearers");
      men.forEach((r, i) => take(r, "bearers", ask.stage, i));
      continue;
    }
    const r = pool(ask.role, ask.at)[0];
    if (r) take(r, ask.role, ask.stage);
    else missing.push(ask.role);
  }
  return { leads, missing };
}

/** A stage's roles, as the engine keeps them: known roles, at most four, bearers once. */
export function cleanLeads(roles: readonly string[] | undefined): LeadRole[] {
  const out: LeadRole[] = [];
  for (const r of roles ?? []) {
    if (!(r in LEAD_LABEL) || r === "agent") continue;
    const role = r as LeadRole;
    if (out.length >= LEADS_PER_STAGE) break;
    if (role === "bearers" && out.includes("bearers")) continue;
    if (role !== "quarreller" && out.includes(role)) continue;
    if (role === "quarreller" && out.filter((x) => x === "quarreller").length >= 2) continue;
    out.push(role);
  }
  return out;
}

/** The names of the leads for a notice or a rumour: "{bride}" becomes the bride's name. */
export function fillNames(text: string, leads: Lead[]): string {
  if (!text) return text;
  const nameOf = (role: string) => {
    const ls = leads.filter((l) => l.role === role);
    if (!ls.length) return null;
    if (role === "bearers" || role === "fireman") return ls.map((l) => l.name.split(" ")[0]).join(", ");
    return ls.map((l) => l.name).join(" and ");
  };
  const out = text.replace(/\{([a-z_]+)\}/g, (_m, role: string) => nameOf(role) ?? labelOf(role as AnyLeadRole));
  return out.replace(/\s{2,}/g, " ").trim();
}

/** "Anna Peeters (the bride) and Karel Janssens (the groom)": the leads in a line, for the log and the notice. */
export function leadLine(leads: Lead[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const l of leads) {
    if (l.role === "agent") continue;
    if (l.role === "bearers" || l.role === "fireman") {
      if (seen.has(l.role)) continue;
      seen.add(l.role);
      parts.push(`${leads.filter((x) => x.role === l.role).map((x) => x.name.split(" ")[0]).join(", ")} (${labelOf(l.role)})`);
      continue;
    }
    parts.push(`${l.name} (${labelOf(l.role).replace(/^one of the (\w+)s$/, "the $1").replace(/^a /, "the ")})`);
  }
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Does the text already carry one of the leads' names? */
export function namesIn(text: string, leads: Lead[]): boolean {
  return leads.some((l) => l.role !== "agent" && text.includes(l.name));
}

/**
 * Where each lead stands at their stage's place: musicians in a tight ring facing out, the
 * couple and the priest in a row, two quarrellers facing each other, the bearers two by two.
 */
export function leadSpot(lead: Lead, all: Lead[], at: { x: number; z: number }): { x: number; z: number } {
  const same = all.filter((l) => l.stage === lead.stage && l.role !== "agent");
  const i = Math.max(0, same.indexOf(lead));
  const n = same.length;
  const musicians = same.filter((l) => l.role === "organ_grinder" || l.role === "fiddler" || l.role === "accordionist");
  if (musicians.includes(lead)) {
    const k = musicians.indexOf(lead);
    const a = (k / Math.max(1, musicians.length)) * Math.PI * 2;
    return { x: at.x + Math.cos(a) * 0.9, z: at.z + Math.sin(a) * 0.9 };
  }
  if (lead.role === "bearers") {
    const k = lead.n ?? 0;
    return { x: at.x - 1.6 + (k % 2) * 0.7, z: at.z - 0.7 + Math.floor(k / 2) * 1.4 };
  }
  if (lead.role === "pickpocket") return { x: at.x + 7, z: at.z + 3 };
  // a row across the middle, 0.8 m apart
  return { x: at.x + (i - (n - 1) / 2) * 0.8, z: at.z };
}
