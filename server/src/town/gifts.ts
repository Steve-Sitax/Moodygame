import type { DB } from "../db.ts";
import { log } from "../game.ts";
import { relationship, remember, TRUST_MAX, TRUST_MIN } from "../npcs.ts";
import { ITEMS } from "../trade.ts";
import { FURNITURE } from "../../../shared/homes.ts";
import { LIVELY_WARES } from "./livelyWares.ts";
import { clock } from "../day.ts";
import { deedRow, hasDeeds, returnThing, type DeedRow } from "./deeds.ts";
import { resident } from "./store.ts";
import type { Resident } from "./population.ts";
import { nowOf } from "./talk.ts";
import { stepGive } from "../director/steps.ts";
import { getState, setState } from "../interiors/state.ts";

// Giving from Jef's pockets (M6, Steve 2026-09-24): "If I say I want to give you a fish, and I have
// a fish in my inventory, make the AI take it out of my inventory ... In reality, remove the fish
// and add extra trust. Make sure we can't max out trust with the cheapest items."
//
// The model only proposes ("receive_gift", an item) in its talk reply. The ENGINE decides:
// - Jef really has it (pockets, or the piece in his arms), and it is his to give;
// - they take it: by what it is worth to THEM (value against their wealth, a hungry man values
//   food), pride, trust, their trade (an agent on duty takes nothing), a gift that smells of a
//   bribe to an honest person, and never a thing they know was stolen;
// - the trust: from the worth, with diminishing returns per person and day, a weekly cap per
//   person, and a ceiling gifts alone never pass. The rest of the trust must be earned by deeds.

/** What a thing is worth (centimes, the engine's prices); furniture by the dealer's price. */
export const GIFT_VALUE_C: Record<string, number> = {
  herring: 5,
  eel: 12,
  biscuit: 4,
  bread: 6,
  apple: 2,
  beer: 5,
  jenever: 10,
  lantern: 40,
  newspaper: 5,
  ballad: 2,
};
/** Things that are not Jef's to give away (a job's parcel is caught by job_id). */
const NOT_GIFTS = new Set(["parcel", "letters", "letter", "pawn_ticket", "diary", "found", "velocipede_new", "velocipede_used", "velocipede_hire"]);
/** Food: what is eaten (a pocket herring, a roll off the baker's boy's cart). */
const FOOD = { has: (k: string) => ITEMS[k]?.use === "eat" && !ITEMS[k]?.atCounter };

/** Gifts a person takes from Jef in one game day; after that they refuse ("you'll leave yourself with nothing"). */
export const GIFTS_PER_DAY = 3;
/** The share of a gift's trust worth that counts: the first gift of the day to a person, the second, the third. */
export const DIMINISH = [1, 0.4, 0.15];
/** Worth (after their wealth and needs) under this: "kind of you", no trust at all. */
export const MIN_FELT = 3;
/** Worth per trust point (a felt 6 centimes gives one point of credit, at most 2 a gift). */
export const FELT_PER_POINT = 6;
/** Trust from gifts per person in a game week (the game is one week), and the ceiling gifts never pass. */
export const GIFT_TRUST_WEEK = 2;
export const GIFT_TRUST_CEILING = 6;

export type GiftReason = "accepted" | "no_item" | "not_giftable" | "money" | "medal" | "stolen" | "own_back" | "on_duty" | "dislike" | "bribe" | "pride" | "enough_today";

export interface Held {
  /** "pocket": a row of `item`; "arms": the dealer's piece carried in both arms (home_item). */
  from: "pocket" | "arms";
  id: number;
  kind: string;
  name: string;
  job_id: number | null;
  /** M6 homes: a small piece of furniture in the pocket carries its home_item id. */
  ref: number | null;
}

/** What Jef has on him that could be given: his pockets and the piece in his arms. */
export function heldThings(db: DB): Held[] {
  const rows = db.prepare("SELECT id, kind, job_id, ref FROM item ORDER BY id").all() as Array<{ id: number; kind: string; job_id: number | null; ref: number | null }>;
  const out: Held[] = rows.map((r) => ({ from: "pocket", id: r.id, kind: r.kind, name: ITEMS[r.kind]?.name ?? FURNITURE[r.kind]?.name ?? r.kind, job_id: r.job_id, ref: r.ref }));
  const hasHomes = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'home_item'").get();
  if (hasHomes) {
    const arms = db.prepare("SELECT id, kind FROM home_item WHERE state = 'arms'").get() as { id: number; kind: string } | undefined;
    if (arms) out.push({ from: "arms", id: arms.id, kind: arms.kind, name: FURNITURE[arms.kind]?.name ?? arms.kind, job_id: null, ref: arms.id });
  }
  return out;
}

/** The street sellers' prices (M6 lively): the cheapest seller's. */
function livelyPrice(kind: string): number | undefined {
  let best: number | undefined;
  for (const list of Object.values(LIVELY_WARES)) for (const w of list) if (w.kind === kind && (best === undefined || w.price_c < best)) best = w.price_c;
  return best;
}

/** What a thing is worth, or undefined when it is nothing anyone would count as a gift. */
export function giftValue(kind: string): number | undefined {
  return GIFT_VALUE_C[kind] ?? livelyPrice(kind) ?? FURNITURE[kind]?.price_c;
}

// ------------------------------------------------------------------ words

/** Jef means to give something: the words must show it (the model may not invent a gift). */
export const GIVE_RE =
  /\b(give|giving|gift|present|(?<!\b(do|did|can|could|would|will) you |you |i )have (this|it|my|a|an|the|some|another|one|these|more)|(?<!\b(can|may|could|shall) i |let me |i'?ll |i will |i )take (this|it|my|a|an|the|some|another|one|these|more)|(would you like|do you want|you want) (a|an|some|my|this)|for you|brought you|here'?s|here is|keep (it|this)|yours|a little something|spare you)\b/i;
/** Money in the offer: never a gift in talk (money moves only by the engine's own rules). */
const MONEY_RE = /\b(money|coins?|centimes?|francs?|sous?|purse|cash|silver|gold)\b/i;
/** A gift that asks for something back. */
export const BRIBE_RE = /\b(in return|for a favou?r|so that you|so you('ll| will| can)|if you (tell|say|let|keep|forget|look|help|do)|keep (quiet|mum|your mouth)|say nothing|look the other way|won'?t tell|not a word|bribe|between us)\b/i;
export const FLATTERY_RE = /\b(beautiful|lovely|handsome|finest|best (man|woman|lady|fellow|seller) in|so (kind|wise|clever|pretty)|my (dear|friend|darling))\b/i;

const WORDS: Array<[RegExp, string[]]> = [
  [/\bherrings?\b/i, ["herring"]],
  [/\beels?\b/i, ["eel"]],
  [/\b(fish|fishes)\b/i, ["herring", "eel"]],
  [/\b(bread|loaf|loaves|rye)\b/i, ["bread"]],
  [/\bapples?\b/i, ["apple"]],
  [/\bbiscuits?\b/i, ["biscuit"]],
  [/\b(lantern|lamp|light)\b/i, ["lantern", "lamp"]],
  [/\b(newspaper|paper|handelsblad)\b/i, ["newspaper"]],
  [/\b(ballad|song ?sheet|sheet)\b/i, ["ballad"]],
  [/\b(jenever|gin|genever)\b/i, ["jenever"]],
  [/\bbeer\b/i, ["beer"]],
  [/\b(food|something to eat|a bite|a meal|eat)\b/i, ["bread", "eel", "herring", "mussels", "biscuit", "roll", "apple"]],
  [/\b(rolls?|bun)\b/i, ["roll"]],
  [/\bmussels?\b/i, ["mussels"]],
  [/\bbroom\b/i, ["broom"]],
  [/\b(scarf|muffler)\b/i, ["scarf"]],
  [/\b(knife|clasp ?knife)\b/i, ["knife"]],
  [/\bcoal\b/i, ["coal"]],
  [/\bcandle\b/i, ["candle"]],
  [/\b(rosary|beads)\b/i, ["rosary"]],
  [/\b(holy picture|holy card|saint'?s picture)\b/i, ["holy_picture"]],
  [/\bchair\b/i, ["chair"]],
  [/\btable\b/i, ["table"]],
  [/\brug\b/i, ["rug"]],
  [/\bstove\b/i, ["stove"]],
  [/\b(geranium|plant|flower)\b/i, ["plant"]],
  [/\b(finch|bird|birdcage|cage)\b/i, ["birdcage"]],
  [/\b(picture|print)\b/i, ["picture"]],
  [/\bclock\b/i, ["clock"]],
  [/\bcurtains?\b/i, ["curtains"]],
];

/** The kinds a line of words (or the model's item) can mean, most specific first. */
export function kindsIn(words: string): string[] {
  const out: string[] = [];
  for (const [re, kinds] of WORDS) if (re.test(words)) for (const k of kinds) if (!out.includes(k)) out.push(k);
  return out;
}

export interface GiftPick {
  held: Held | null;
  /** Why nothing: money, the medal, nothing like it on him. */
  why?: "money" | "medal" | "no_item";
}

/**
 * Which of his things Jef means. It must show in HIS words (the model's `item` only narrows it):
 * "a fish" with a herring and an eel in his pockets is the herring (the first named kind he has).
 */
export function pickGift(db: DB, jefWords: string, modelItem: string): GiftPick {
  const said = kindsIn(jefWords);
  const narrowed = kindsIn(modelItem).filter((k) => said.includes(k));
  const want = narrowed.length ? narrowed : said;
  const held = heldThings(db);
  for (const k of want) {
    const h = held.find((x) => x.kind === k);
    if (h) return { held: h };
  }
  if (!want.length && MONEY_RE.test(jefWords)) return { held: null, why: "money" };
  if (/\bmedal\b/i.test(jefWords)) return { held: null, why: "medal" };
  if (!want.length && MONEY_RE.test(modelItem)) return { held: null, why: "money" };
  return { held: null, why: "no_item" };
}

// ------------------------------------------------------------------ what it is worth to them

/** How much a hungry person values food: the poorest most; a gift of food already today halves it. */
export function hungerOf(r: Resident, foodToday: number): number {
  const base = r.trade === "beggar" || r.trade === "street_child" ? 2.5 : r.stats.wealth <= 1 ? 1.8 : r.stats.wealth <= 3 ? 1.3 : r.stats.wealth <= 6 ? 1 : 0.6;
  return base * Math.pow(0.5, foodToday);
}

const NIGHT_TRADES = new Set(["lamplighter", "police", "water_bailiff", "docker", "boatman", "natie", "sailor", "customs"]);

/** The gift's worth to this person: its value, their need of it, against their wealth. */
export function feltWorth(r: Resident, kind: string, foodToday = 0): number {
  let need = 1;
  if (FOOD.has(kind)) need = hungerOf(r, foodToday);
  else if (kind === "lantern") need = NIGHT_TRADES.has(r.trade) ? 1.5 : r.age < 13 ? 0.5 : 1;
  else if (kind === "jenever" || kind === "beer") need = r.stats.piety >= 8 ? 0.2 : 1;
  else if (kind === "rosary" || kind === "candle" || kind === "holy_picture") need = r.stats.piety >= 7 ? 1.5 : r.stats.piety <= 2 ? 0.4 : 1;
  else if (kind === "coal" || kind === "scarf") need = r.stats.wealth <= 2 ? 1.5 : 0.8;
  const div = 1 + r.stats.wealth * 0.35;
  return ((giftValue(kind) ?? 0) * need) / div;
}

/** Pride: the well-off do not take a poor lad's food or trinkets. */
export function proud(r: Resident): boolean {
  return r.stats.wealth >= 6 || (r.stats.wealth >= 4 && r.stats.temper >= 7);
}

// ------------------------------------------------------------------ the ledger (anti-farming)

interface GiftDay {
  n: number;
  food: number;
}
interface GiftLedger {
  /** Trust points from gifts this game week, per person. */
  gained: Record<string, number>;
  /** Fractions of a point not yet a point, per person. */
  credit: Record<string, number>;
  /** Gifts per person per day ("day:npc"). */
  days: Record<string, GiftDay>;
  week: number;
}
const LEDGER = "gifts:ledger";
const weekOf = (day: number) => Math.floor((day - 1) / 7);

export function ledger(db: DB): GiftLedger {
  const day = clock(db).day;
  const l = getState<GiftLedger>(db, LEDGER, { gained: {}, credit: {}, days: {}, week: weekOf(day) });
  if (l.week !== weekOf(day)) return { gained: {}, credit: {}, days: {}, week: weekOf(day) };
  // keep the day rows of the last two days only
  for (const k of Object.keys(l.days)) if (Number(k.split(":")[0]) < day - 1) delete l.days[k];
  return l;
}

export function giftsToday(db: DB, npc: string): GiftDay {
  return ledger(db).days[`${clock(db).day}:${npc}`] ?? { n: 0, food: 0 };
}

/**
 * The trust a gift (or a treat) earns, by the engine: the worth becomes credit (none under
 * MIN_FELT), cut by the day's count for this person; whole points of credit become trust,
 * never past the week's cap from gifts or the gifts' ceiling. `mood` scales it (a person who
 * dislikes Jef takes it coldly: half). Writes the ledger; returns the points given.
 */
export function giftTrust(db: DB, r: Resident, felt: number, food: boolean, mood = 1): number {
  const l = ledger(db);
  const day = clock(db).day;
  const key = `${day}:${r.id}`;
  const d = l.days[key] ?? { n: 0, food: 0 };
  const dim = DIMINISH[d.n] ?? 0;
  d.n++;
  if (food) d.food++;
  l.days[key] = d;
  let points = 0;
  if (felt >= MIN_FELT && dim > 0) {
    const credit = (l.credit[r.id] ?? 0) + Math.min(2, felt / FELT_PER_POINT) * dim * mood;
    const whole = Math.floor(credit + 1e-9);
    const trust = relationship(db, r.id)?.trust ?? 0;
    const room = Math.max(0, Math.min(GIFT_TRUST_WEEK - (l.gained[r.id] ?? 0), GIFT_TRUST_CEILING - trust));
    points = Math.max(0, Math.min(whole, room));
    // credit past the cap is not kept for later: the cap is the cap
    l.credit[r.id] = points < whole ? 0 : credit - whole;
    if (points) {
      l.gained[r.id] = (l.gained[r.id] ?? 0) + points;
      db.prepare(`UPDATE npc_relationship SET trust = MAX(${TRUST_MIN}, MIN(${TRUST_MAX}, trust + ?)) WHERE npc_id = ?`).run(points, r.id);
    }
  }
  setState(db, LEDGER, l);
  return points;
}

/** Trust lost over a gift (a bribe to an honest man, a stolen thing, an insult): the engine's, at most 1. */
function trustDown(db: DB, id: string): number {
  db.prepare(`UPDATE npc_relationship SET trust = MAX(${TRUST_MIN}, trust - 1) WHERE npc_id = ?`).run(id);
  return -1;
}

// ------------------------------------------------------------------ the verdict

export interface GiftVerdict {
  ok: boolean;
  reason: GiftReason;
  /** The engine's line: the whole line on a refusal; on acceptance only used when the model is silent. */
  line: string;
  /** The small note under the line (no numbers): how it went down. */
  note: string;
  trust: number;
  eaten: boolean;
  held: Held | null;
  felt: number;
}

const she = (r: Resident) => (r.sex === "f" ? "She" : "He");
const her = (r: Resident) => (r.sex === "f" ? "her" : "his");

/** The open deed (a theft of Jef's) this pocket row is, if any. */
function stolenDeed(db: DB, h: Held): DeedRow | null {
  if (h.from !== "pocket" || !hasDeeds(db)) return null;
  const d = db.prepare("SELECT id FROM deed WHERE item_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1").get(h.id) as { id: number } | undefined;
  return d ? (deedRow(db, d.id) ?? null) : null;
}

/** Does this person know the thing was stolen? The owner who saw it go, or a witness. */
function knowsStolen(_db: DB, r: Resident, d: DeedRow): boolean {
  if (d.owner === r.id && d.owner_saw) return true;
  try {
    const w = JSON.parse(d.witnesses || "[]") as Array<string | { id?: string }>;
    if (w.some((x) => (typeof x === "string" ? x : x?.id) === r.id)) return true;
  } catch {
    /* no witnesses */
  }
  return false;
}

/**
 * Would this person take this thing from Jef now? Engine only; no side effects. The order: what
 * it is, whose it is, their trade, how they feel about Jef, what the words ask back, pride, the
 * day's count, and last the worth.
 */
export function judgeGift(db: DB, r: Resident, pick: GiftPick, jefWords: string): GiftVerdict {
  const base = { trust: 0, eaten: false, held: pick.held, felt: 0 };
  const no = (reason: GiftReason, line: string, note = ""): GiftVerdict => ({ ok: false, reason, line, note, ...base });
  if (!pick.held) {
    if (pick.why === "money") return no("money", r.stats.greed >= 7 ? "Money? Keep it. I don't take coin from a lad in the street, whatever I look like." : "Keep your money. You've little enough of it.");
    if (pick.why === "medal") return no("medal", "That's your mother's medal. Put it away and keep it.");
    return no("no_item", "What gift? You've nothing like that on you.");
  }
  const h = pick.held;
  if (h.job_id !== null || NOT_GIFTS.has(h.kind) || giftValue(h.kind) === undefined) return no("not_giftable", "That's not yours to give away.");
  const deed = stolenDeed(db, h);
  if (deed && knowsStolen(db, r, deed)) {
    if (deed.owner === r.id) return no("own_back", "That's mine. You took it off me. I'll have it back, thank you.");
    return no("stolen", "That's stolen. I saw you take it. Keep your thieving away from me.", `${she(r)} knows where that came from.`);
  }
  const now = nowOf(db, r);
  const onDuty = (r.trade === "police" || r.trade === "water_bailiff" || r.trade === "customs" || r.trade === "sentry" || r.trade === "corporal") && now.act === "work";
  if (onDuty) return no("on_duty", "Put that away. I'm on duty, and I take nothing from anyone.");
  const trust = relationship(db, r.id)?.trust ?? 0;
  const bribe = BRIBE_RE.test(jefWords);
  const flattery = FLATTERY_RE.test(jefWords);
  if (trust < 0 && (r.stats.temper >= 6 || trust <= -3 || bribe || flattery)) {
    return no("dislike", bribe || flattery ? "You think a present buys me? Take it and clear off." : "I want nothing from you.", bribe || flattery ? `${she(r)} is annoyed, not flattered.` : `${she(r)} will not take it from you.`);
  }
  if (bribe && r.stats.honesty >= 7) return no("bribe", "I'll not be bought, not with that nor with anything else.", `${she(r)} takes it as a bribe.`);
  const today = giftsToday(db, r.id);
  const felt = feltWorth(r, h.kind, today.food);
  if (proud(r) && felt < MIN_FELT) return no("pride", "Keep it, lad. You need it more than I do.", `${she(r)} is too proud to take it.`);
  if (today.n >= GIFTS_PER_DAY) return no("enough_today", "No more, you'll leave yourself with nothing. You've given me plenty today.", `${she(r)} will not take more today.`);
  // eaten on the spot by the truly hungry (a beggar, a street child) and by children; the rest keep it for later
  const eaten = FOOD.has(h.kind) && (hungerOf(r, today.food) >= 2 || r.age < 13);
  return { ok: true, reason: "accepted", line: "", note: "", trust: 0, eaten, held: h, felt };
}

/**
 * The gift happens: the thing leaves Jef (the pockets or his arms), the trust by the ledger, the
 * memory, the rumour, the log. A person who dislikes Jef takes it coldly (half the credit).
 */
export function applyGift(db: DB, r: Resident, v: GiftVerdict): GiftVerdict {
  // one transaction: the thing handed over and the trust it earns, or neither
  return db.transaction(() => applyGiftNow(db, r, v))();
}

function applyGiftNow(db: DB, r: Resident, v: GiftVerdict): GiftVerdict {
  const h = v.held!;
  if (h.from === "pocket") {
    stepGive(db, r.id, h.kind, h.id);
    if (FURNITURE[h.kind] && h.ref !== null) db.prepare("UPDATE home_item SET state = 'gone' WHERE id = ?").run(h.ref);
  } else {
    db.prepare("UPDATE home_item SET state = 'gone' WHERE id = ?").run(h.id);
    log(db, "gave", r.id, `Jef gave ${r.name} ${h.name}.`);
  }
  const trust = relationship(db, r.id)?.trust ?? 0;
  const points = giftTrust(db, r, v.felt, FOOD.has(h.kind), trust < 0 ? 0.5 : 1);
  const what = h.name.replace(/^(a|an|the) /, "");
  const worth = v.felt >= MIN_FELT;
  remember(
    db,
    r.id,
    `Jef gave me ${h.name}${v.eaten ? ", and I ate it there and then" : ""}.${worth ? (r.stats.warmth >= 6 ? " A kind lad." : " Not bad of him.") : " A small thing."}`,
    worth ? Math.min(6, 3 + points) : 2,
    "seen",
    null,
    worth ? { gist: `Jef gave ${r.name} ${h.name}`, tone: 1 } : null,
  );
  const note =
    points > 0
      ? `${she(r)} seems touched.`
      : !worth
        ? `Kind of you, ${she(r).toLowerCase()} says, but it means little to ${r.sex === "f" ? "her" : "him"}.`
        : `${she(r)} takes it gladly enough.`;
  const line = v.eaten
    ? r.age < 13
      ? `For me? Thank you, mister!`
      : `${what[0].toUpperCase() + what.slice(1)}. God bless you, I've not eaten since this morning.`
    : worth
      ? r.stats.warmth >= 6
        ? "That's good of you. Thank you."
        : "Hm. Thank you, then."
      : "Kind of you.";
  return { ...v, trust: points, note: `${note}${v.eaten ? ` ${she(r)} eats it on the spot.` : ` It goes into ${her(r)} ${r.sex === "f" ? "apron" : "coat"}.`}`, line };
}

/** A refusal with a cost: a bribe to an honest man, a stolen thing shown to a witness, a present to one who can't stand Jef. */
export function refuseGift(db: DB, r: Resident, v: GiftVerdict, jefWords: string): GiftVerdict {
  let trust = 0;
  if (v.reason === "bribe") {
    trust = trustDown(db, r.id);
    remember(db, r.id, "Jef tried to buy me with a present. I'll not be bought.", 5, "seen", null, { gist: `Jef tried to bribe ${r.name} with a present`, tone: -1 });
  } else if (v.reason === "stolen") {
    trust = trustDown(db, r.id);
    remember(db, r.id, "Jef offered me a thing I saw him steal. The nerve of him.", 5, "seen", null, { gist: `Jef tried to give ${r.name} something he had stolen`, tone: -2 });
  } else if (v.reason === "dislike" && (BRIBE_RE.test(jefWords) || FLATTERY_RE.test(jefWords))) {
    trust = trustDown(db, r.id);
    remember(db, r.id, "Jef tried to sweeten me with a present, as if I'd forget.", 4);
  } else if (v.reason === "own_back" && v.held) {
    // the owner's own thing: it goes back to them, the M3h way (the deed closes, their memory)
    const d = stolenDeed(db, v.held);
    if (d) {
      try {
        returnThing(db, d.id, "gave");
      } catch {
        /* already back */
      }
    }
    return { ...v, note: `${she(r)} takes back what was ${her(r)}s.` };
  }
  return { ...v, trust };
}

/** The whole gift in one go: pick, judge, apply or refuse. What talk and the free words call. */
export function giveInTalk(db: DB, r: Resident, jefWords: string, modelItem: string): GiftVerdict {
  const pick = pickGift(db, jefWords, modelItem);
  const v = judgeGift(db, r, pick, jefWords);
  return v.ok ? applyGift(db, r, v) : refuseGift(db, r, v, jefWords);
}

/** Does this line of Jef's offer a gift (the words must show it)? */
export function offersGift(words: string): boolean {
  return GIVE_RE.test(words) && (kindsIn(words).length > 0 || MONEY_RE.test(words) || /\bmedal\b/i.test(words));
}

export { resident };
