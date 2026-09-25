import type { DB } from "../db.ts";
import { clock } from "../day.ts";
import { remember, applyTrust } from "../npcs.ts";
import { listJobs } from "../hooks/jobBoard.ts";
import { actionOf, endAction } from "../director/actions.ts";
import { dropTownCache, town } from "./store.ts";
import { houseDoors, walkMap, type HouseDoor } from "./walkmap.ts";
import { STATS, TAVERNS, TRADES, type Stat, type TradeId } from "./places.ts";
import { rngFrom, type Pt, type Resident, type Stats } from "./population.ts";
import type { Seg } from "./schedule.ts";
import { policePost } from "./police.ts";
import { talkExtras, type ExtraTopic } from "./talk.ts";
import { HAND_MAX } from "../hooks/loads.ts";

// Emigrants on the Rijnkaai (M6, Steve 2026-09-24: "Families with bundles wait on the quay and in
// cheap lodging houses for the new Red Star Line ship"). Research and sources:
// docs/milestones/M6-emigrants.md.
//
// Families from south-west Germany, Switzerland, the Low Countries and a few from Bohemia and
// Upper Hungary come to Antwerp by train, lodge a few days at the Logement near the Rijnkaai,
// and wait by the berth with their chests and bundles. On the ship's day the lighters take them
// out to the liner Kempenland at anchor (client: game/emigrants.ts watches the lighters of
// world/anchorage.ts and reports each family aboard). New families come on a fixed timetable.
//
// Everything here is the ENGINE's: who comes, when, from where and why, the ship's days, the
// errands and their pay, the runner's swindle and what warning or reporting him does. The model
// only words the families' talk (talk.ts), with their story in its prompt.
//
// A family is a set of ordinary residents (npc rows, resident rows) while it is in town: talk,
// memories and rumours work as for everyone. Before it comes it does not exist; when it has gone
// out to the ship its resident rows are removed (the npc rows, memories and the family record
// stay, npc.active = 0). The record lives in world_state 'emigrants'.

// ------------------------------------------------------------------ where and when

/** The families' places on the Rijnkaai: clear of the rails, the omnibus lane, the berth and the jetty (z 21-34). */
export const CAMPS: Pt[] = [
  [20, 24.5],
  [27.5, 27],
  [35, 24.5],
  [42.5, 27],
  [31, 32],
];
/** Facing the river (-z): yaw as the client's (facing (sin, cos)). */
export const CAMP_YAW = Math.PI;
/** Where a family comes in from the station road, at the town end of the Rijnkaai. */
export const ARRIVAL: Pt = [-56, 24];
/** Where the Logement is looked for: a free house facing the Rijnkaai near the berth. */
const LOGEMENT_ANCHOR: Pt = [20, 46];
/** Where the runner lodges: the back lanes behind the Rijnkaai. */
const RUNNER_ANCHOR: Pt = [-40, 62];
/** The lighters take emigrants from this hour to this hour on a ship's day; the last ones go at the end. */
export const BOARD_FROM = 7;
export const BOARD_TO = 19;
/** Errand pay, centimes (engine numbers; the board's tier 0 pays 50-150). */
export const PAY = { lost_chest: 60, per_chest: 15, luggage_base: 10, watch: 45 } as const;
/** The runner works a family this long (game hours) before they pay him. */
export const SCAM_HOURS = 4;
/** The chance the runner comes to the quay on a day with a fresh family there. */
export const SCAM_CHANCE = 0.7;
export const KEEPER_ID = "em_keeper";
export const RUNNER_ID = "em_runner";
export const LOGEMENT_LABEL = "the Logement, the emigrants' lodging house";
const HH_BASE = 9000;

export const abs = (day: number, hour: number) => (day - 1) * 24 + hour;

/** Ship's days: the Kempenland takes emigrants every other day, never on a Sunday. */
export function isShipDay(day: number): boolean {
  return day >= 2 && day % 2 === 0 && day % 7 !== 0;
}
export function nextShipDay(after: number): number {
  let d = after + 1;
  while (!isShipDay(d)) d++;
  return d;
}
function shipDayNo(w: number): number {
  let d = 1;
  for (let i = 0; i <= w; i++) d = nextShipDay(d);
  return d;
}

/**
 * When family n comes (absolute game hour, (day - 1) * 24 + hour). The first three are in town
 * when the game starts; after that, on every ship's day two come in the afternoon and one the
 * next morning, so the quay is empty only for the hours after the boarding.
 */
export function arrivalOf(n: number): number {
  if (n < 3) return -6 + n;
  const k = n - 3;
  const B = shipDayNo(Math.floor(k / 3));
  return [abs(B, 13), abs(B, 16.5), abs(B + 1, 10.5)][k % 3];
}
/** The ship's day a family arriving at `arrive` goes out on: the first after the day they come. */
export function boardDayOf(arrive: number): number {
  const day = Math.floor(arrive / 24) + 1;
  return nextShipDay(Math.max(0, day));
}

// ------------------------------------------------------------------ who

export type Country = "german" | "swiss" | "dutch" | "belgian" | "bohemian" | "hungarian";

interface Origin {
  label: string;
  weight: number;
  regions: Array<[string, string[]]>;
  men: string[];
  women: string[];
  surnames: string[];
  bound: string[];
  why: string[];
  faith: Array<[string, number]>;
  speech: string;
  greet: string[];
}

const ORIGINS: Record<Country, Origin> = {
  german: {
    label: "Germany",
    weight: 0.42,
    regions: [
      ["Hesse", ["Alsfeld", "Lauterbach", "Schotten", "Grebenhain"]],
      ["Wurttemberg", ["Heilbronn", "Balingen", "Nagold", "Calw"]],
      ["Baden", ["Mosbach", "Bretten", "Sinsheim"]],
      ["the Palatinate", ["Kusel", "Kirchheimbolanden", "Zweibrucken"]],
      ["the Hunsruck, in the Rhineland", ["Simmern", "Kirn", "Kastellaun"]],
    ],
    men: ["Johann", "Heinrich", "Friedrich", "Wilhelm", "Karl", "Georg", "Jakob", "Peter", "Konrad", "Philipp", "Adam", "Ludwig"],
    women: ["Anna", "Maria", "Katharina", "Elisabeth", "Margaretha", "Christina", "Sophie", "Barbara", "Luise", "Magdalena"],
    surnames: ["Weber", "Schmidt", "Becker", "Hoffmann", "Wagner", "Schneider", "Fischer", "Bauer", "Koch", "Richter", "Keller", "Vogel", "Hartmann", "Zimmermann", "Krause", "Seitz", "Roth", "Hahn"],
    bound: ["Cincinnati in Ohio, where a brother keeps a bakery", "Milwaukee in Wisconsin", "a farm in Iowa, bought on paper", "Philadelphia, and then west into Pennsylvania", "Kansas, where the railway sells land cheap", "Saint Louis on the Mississippi"],
    why: [
      "the farm was too small to split among four sons",
      "two bad harvests, and a debt at the savings bank",
      "since the war the eldest would serve seven years in the army and five more in the reserve",
      "a brother in Ohio writes that there is land for anyone who works",
      "the weaving in the village went to the factories, and the wages with it",
    ],
    faith: [["Lutheran", 0.55], ["Catholic", 0.45]],
    speech: "You speak English as a German farmer who learned a little from a phrasebook on the train: short careful sentences, now and then the verb at the end ('Tomorrow we to the ship go'), many pleases and thank-yous.",
    greet: ["Good day, good day. You are from this city, yes?", "Ah, a young man. Please, it is here the boats to the big ship come?", "Good day. We wait for the ship. Always we wait."],
  },
  swiss: {
    label: "Switzerland",
    weight: 0.25,
    regions: [
      ["the canton of Glarus", ["Elm", "Schwanden", "Matt", "Linthal"]],
      ["the Emmental, in the canton of Bern", ["Langnau", "Trub", "Eggiwil", "Sumiswald"]],
      ["the Zurich uplands", ["Wald", "Fischenthal", "Bauma"]],
    ],
    men: ["Fridolin", "Kaspar", "Ulrich", "Jakob", "Hans", "Niklaus", "Heinrich", "Rudolf", "Melchior"],
    women: ["Verena", "Regula", "Anna", "Barbara", "Magdalena", "Elsbeth", "Rosina"],
    surnames: ["Tschudi", "Zwicky", "Blumer", "Streiff", "Hefti", "Aebi", "Gerber", "Zbinden", "Luethi", "Baumgartner", "Kundert", "Stauffer"],
    bound: ["New Glarus in Wisconsin, where cousins keep cows", "Highland in Illinois", "Ohio, to a cheese maker from the next valley", "Missouri, where the land is cheap"],
    why: [
      "the cheese fell in price and the farm went with it",
      "the parish paid half the fare, to have one family less on the poor box",
      "the spinning mill in the valley shut its doors",
      "cousins in Wisconsin write that the grass is good and nobody owns it yet",
    ],
    faith: [["Reformed", 0.7], ["Catholic", 0.3]],
    speech: "You speak English slowly, a word at a time, and apologise for it; you are proud, tidy and careful with money.",
    greet: ["Good day to you. Please speak slow, my English is from a little book.", "Good day. It is very flat here. At home the mountains stand up to the sky.", "Good day. We are the family from the mountains, you see."],
  },
  dutch: {
    label: "the Netherlands",
    weight: 0.12,
    regions: [
      ["Zeeland", ["Axel", "Goes", "Zierikzee", "Tholen"]],
      ["the Achterhoek, in Gelderland", ["Winterswijk", "Aalten", "Varsseveld"]],
      ["Groningen", ["Ulrum", "Uithuizen", "Leens"]],
    ],
    men: ["Hendrik", "Jan", "Klaas", "Dirk", "Pieter", "Gerrit", "Arie", "Cornelis"],
    women: ["Geertje", "Jantje", "Aaltje", "Neeltje", "Trijntje", "Maartje", "Grietje"],
    surnames: ["de Vries", "Bakker", "Visser", "van der Meulen", "Kuiper", "Dijkstra", "Mulder", "Hoekstra", "de Boer", "Brouwer"],
    bound: ["Holland in Michigan", "Pella in Iowa", "Grand Rapids in Michigan", "Sheboygan in Wisconsin"],
    why: [
      "the landlord raised the rent after the potato rot",
      "our church stands apart from the old one, and the village never forgave us",
      "an uncle in Michigan sent the fare in a letter",
      "there is no land to buy at home, not for money we will ever have",
    ],
    faith: [["Reformed", 1]],
    speech: "You speak plain careful English with a Dutch tongue, and are glad a Fleming half understands you; you say 'yes, yes' when you are thinking.",
    greet: ["Good day. Yes, yes, we are for America.", "Good day, young man. You are a Fleming? Then we almost understand each other.", "Good day. The quay is big, the ship is bigger."],
  },
  belgian: {
    label: "Belgium",
    weight: 0.09,
    regions: [
      ["the country round Wavre, in Brabant", ["Grez-Doiceau", "Chaumont", "Tourinnes"]],
      ["the province of Luxembourg", ["Bastogne", "Neufchateau", "Houffalize"]],
      ["West Flanders", ["Tielt", "Ardooie", "Pittem"]],
    ],
    men: ["Joseph", "Jean", "Francois", "Pierre", "Lambert", "Desire"],
    women: ["Marie", "Josephine", "Catherine", "Anne", "Rosalie", "Sidonie"],
    surnames: ["Delfosse", "Lefebvre", "Collignon", "Thiry", "Detienne", "Gigot", "Vandewalle", "Verhaeghe", "Vanneste", "Callewaert"],
    bound: ["Green Bay in Wisconsin, where the Walloons are", "Detroit in Michigan", "Moline in Illinois"],
    why: [
      "the flax work is gone, and the linen with it",
      "letters from Wisconsin were read out at the church door, and half the parish talks of nothing else",
      "the farm goes to the eldest brother, and there is nothing for the rest of us",
    ],
    faith: [["Catholic", 1]],
    speech: "You are a country person from the far side of Belgium: slow, shy of the big city, better at French than at Flemish; plain words.",
    greet: ["Good day. We are from the country, you see. This city is too big.", "Good day. You are from the Kempen? No, we are from further off.", "Good day, young man. Is it always so loud here?"],
  },
  bohemian: {
    label: "Bohemia",
    weight: 0.06,
    regions: [
      ["southern Bohemia", ["Pisek", "Tabor", "Strakonice"]],
      ["the Chodsko, near Domazlice", ["Domazlice", "Kdyne", "Klenci"]],
    ],
    men: ["Josef", "Vaclav", "Frantisek", "Jan", "Karel", "Matej"],
    women: ["Marie", "Anna", "Katerina", "Barbora", "Josefa", "Terezie"],
    surnames: ["Novak", "Dvorak", "Svoboda", "Prochazka", "Kucera", "Vesely", "Horak", "Cerny"],
    bound: ["Chicago, to the Bohemians on the west side", "Racine in Wisconsin", "Cedar Rapids in Iowa", "the prairie of Nebraska"],
    why: ["no land of our own, only day work on the estate", "the army wanted the eldest son", "a man from the next village came back from America with a gold watch"],
    faith: [["Catholic", 1]],
    speech: "You know only a handful of English words and use them bravely, with long pauses and your hands.",
    greet: ["Good day. You know, please, when the ship goes?", "Good day. Sorry, my words are few.", "Good... good day. America, yes. Soon."],
  },
  hungarian: {
    label: "Upper Hungary",
    weight: 0.06,
    regions: [
      ["Saros county, in Upper Hungary", ["Bartfeld", "Eperjes", "Kisszeben"]],
      ["Zemplen county, in Upper Hungary", ["Homonna", "Varanno", "Sztropko"]],
    ],
    men: ["Janos", "Istvan", "Ferenc", "Mihaly", "Andras", "Jozsef"],
    women: ["Erzsebet", "Maria", "Julianna", "Katalin", "Borbala", "Zsuzsanna"],
    surnames: ["Kovacs", "Toth", "Nagy", "Horvath", "Szabo", "Varga", "Molnar"],
    bound: ["the coal mines of Pennsylvania", "Cleveland in Ohio", "the iron works of Pittsburgh"],
    why: ["the land gives nothing, and a man back from the mines had money in his pockets", "the lord's steward took the best field", "the eldest must go for a soldier, and we would rather go all together to America"],
    faith: [["Catholic", 0.8], ["Reformed", 0.2]],
    speech: "You have very little English: short words, many pauses, a smile when you are lost; you understand more than you can say.",
    greet: ["Good... good day. English, a little. Very little.", "Day, sir. The ship? Today? No? Tomorrow.", "Good day. We go far, far. America."],
  },
};

const FEARS = [
  "the sea, and the weeks below deck",
  "sickness on board: they say the ship fever takes the little ones first",
  "being cheated before we even leave; everybody here wants our money",
  "that the money runs out before the land is found",
  "that the children forget their prayers and their mother tongue",
  "not understanding a word over there",
  "that the brother's letters were too kind about America",
];

/** Where a lost chest was put down by the carter (a spot of the Rijnkaai, shared/spots.json). */
const LOST_AT: Array<[string, string]> = [
  ["hessenatie_door", "by the door of the Hessenatie"],
  ["peeters_dock", "by the widow's shop door"],
  ["east_carts", "at the cart stand"],
  ["crane_foot", "at the foot of the crane"],
];

export type Kind = "chest" | "bundle" | "featherbed" | "basket";
export interface CampProp {
  kind: Kind;
  x: number;
  z: number;
  yaw: number;
}

export interface Family {
  n: number;
  household: number;
  surname: string;
  country: Country;
  from: string;
  region: string;
  why: string;
  bound: string;
  fear: string;
  faith: string;
  arrive: number;
  board_day: number;
  slot: number;
  members: string[];
  names: string[];
  head: string;
  /** The mother with the baby in her arms (the client puts a bundle in them). */
  baby: { mother: string; child: string } | null;
  props: CampProp[];
  chests: number;
  lost_chest: { spot: string; where: string } | null;
  status: "coming" | "here" | "boarded";
  boarded?: { day: number; hour: number; by: "lighter" | "engine" };
  scammed?: boolean;
  warned?: boolean;
  lost_c?: number;
  returned?: boolean;
  /** Errands done or failed (never offered again). */
  done: string[];
}

export type ErrandKind = "lost_chest" | "luggage" | "watch";

export interface Scam {
  day: number;
  family: number;
  start: number;
  until: number;
  state: "working" | "warned" | "sold" | "reported";
  by?: string;
}

export interface EmigrantTown {
  v: 1;
  seed: number;
  logement: { house: number; step: Pt; wall: Pt; out: Pt; label: string; shared: boolean };
  keeper: string;
  runner: string;
  runner_home: Pt;
  families: Family[];
  scam: Scam | null;
  scam_days: number[];
  runner_jailed: boolean;
  notices: number[];
  errands: Array<{ family: number; kind: ErrandKind; job: number; day: number }>;
}

// ------------------------------------------------------------------ the record

export function emigrantTown(db: DB): EmigrantTown | null {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'emigrants'").get() as { value_json: string } | undefined;
  return row ? (JSON.parse(row.value_json) as EmigrantTown) : null;
}

function save(db: DB, e: EmigrantTown): void {
  db.prepare("INSERT INTO world_state (key, value_json) VALUES ('emigrants', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(e));
}

const hashStr = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** Dev (routes): families let in before their train is due, for browser checks on a test save. */
export const devEarly = new Set<number>();

export const isEmigrant = (r: Resident): boolean => typeof r.emigrant === "number";
export const campPlace = (slot: number) => `emigrant_camp:${slot}`;

// ------------------------------------------------------------------ making a family (pure)

export interface Made {
  family: Omit<Family, "slot" | "props" | "status" | "done">;
  residents: Resident[];
}

/**
 * Family n of the town with this seed: always the same people. `slot` is their place on the quay,
 * `home` the Logement's door. Pure: the engine owns every number; no model is asked.
 */
export function makeFamily(seed: number, n: number, slot: number, home: { house: number; x: number; z: number; sx: number; sz: number }, avoid: string[] = []): Made & { props: CampProp[] } {
  const rng = rngFrom((seed ^ 0xe1a9 ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0);
  const rnd = (a: number, b: number) => a + rng() * (b - a);
  const int = (a: number, b: number) => Math.floor(rnd(a, b + 1));
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];
  const chance = (p: number) => rng() < p;
  // the first family is always German, the second Swiss: the two peoples who came most (docs)
  let country: Country;
  if (n === 0) country = "german";
  else if (n === 1) country = "swiss";
  else {
    let roll = rng();
    country = "german";
    for (const [c, o] of Object.entries(ORIGINS) as Array<[Country, Origin]>) {
      roll -= o.weight;
      if (roll <= 0) {
        country = c;
        break;
      }
    }
  }
  const O = ORIGINS[country];
  const [region, towns] = pick(O.regions);
  let faithRoll = rng();
  let faith = O.faith[0][0];
  for (const [f, w] of O.faith) {
    faithRoll -= w;
    if (faithRoll <= 0) {
      faith = f;
      break;
    }
  }
  // Walloon names for the Walloon regions, Flemish for West Flanders
  const flemish = country === "belgian" && region.startsWith("West");
  const men = flemish ? ["Pieter", "Karel", "Desire", "Ivo", "Cyriel"] : country === "belgian" ? O.men.slice(0, 5) : O.men;
  const women = flemish ? ["Rosalie", "Sidonie", "Romanie", "Zulma"] : country === "belgian" ? O.women.slice(0, 4) : O.women;
  const surnames = country === "belgian" ? (flemish ? O.surnames.slice(6) : O.surnames.slice(0, 6)) : O.surnames;
  // no two families of one name in the week (the families before this one are passed in `avoid`)
  const free = surnames.filter((s) => !avoid.includes(s));
  const surname = pick(free.length ? free : surnames);
  const hh = HH_BASE + n;
  const used = new Set<string>();
  const first = (sex: "m" | "f") => {
    for (let i = 0; i < 20; i++) {
      const f = pick(sex === "m" ? men : women);
      if (!used.has(f)) {
        used.add(f);
        return f;
      }
    }
    return pick(sex === "m" ? men : women);
  };

  // who travels: a couple with children (most), a widow with hers, two brothers, three generations
  type P = { sex: "m" | "f"; age: number; role: string };
  const people: P[] = [];
  const shape = n === 0 ? "couple" : pick(["couple", "couple", "couple", "couple", "widow", "brothers", "three", "young"] as const);
  const kids = (mother: number, k: number) => {
    let age = Math.min(mother - 19, int(9, 15));
    for (let i = 0; i < k && age >= 0; i++) {
      people.push({ sex: chance(0.5) ? "m" : "f", age: Math.max(0, age), role: "" });
      age -= int(2, 4);
    }
  };
  if (shape === "couple") {
    const h = int(27, 44);
    people.push({ sex: "m", age: h, role: "head" }, { sex: "f", age: Math.max(21, h - int(0, 6)), role: "wife" });
    kids(people[1].age, n === 0 ? 3 : int(1, 4));
  } else if (shape === "widow") {
    people.push({ sex: "f", age: int(30, 42), role: "widow" });
    kids(people[0].age, int(2, 3));
  } else if (shape === "brothers") {
    const a = int(19, 26);
    people.push({ sex: "m", age: a, role: "head" }, { sex: "m", age: a - int(1, 3), role: "brother" });
  } else if (shape === "three") {
    const g = int(58, 66);
    people.push({ sex: "m", age: g, role: "grandfather" }, { sex: "m", age: g - int(26, 30), role: "head" }, { sex: "f", age: g - int(28, 33), role: "wife" });
    kids(people[2].age, int(1, 2));
  } else {
    const h = int(22, 27);
    people.push({ sex: "m", age: h, role: "head" }, { sex: "f", age: h - int(0, 3), role: "wife" });
    if (chance(0.6)) people.push({ sex: chance(0.5) ? "m" : "f", age: 0, role: "" });
  }
  // a baby in arms for about half the families with a mother under 38
  const mother = people.find((p) => p.role === "wife" || p.role === "widow");
  if (mother && mother.age < 38 && !people.some((p) => p.age < 2) && people.length < 6 && chance(0.5)) people.push({ sex: chance(0.5) ? "m" : "f", age: int(0, 1), role: "" });
  people.splice(6);
  for (const p of people) if (!p.role) p.role = p.sex === "m" ? "son" : "daughter";

  const chests = Math.min(3, Math.max(1, Math.round(people.filter((p) => p.age >= 13).length * 0.7 + rng())));
  const bundles = int(1, 3);
  const [cx, cz] = CAMPS[slot % CAMPS.length];
  const place = campPlace(slot);
  const props: CampProp[] = [];
  const chestX = (i: number) => +(cx + (i - (chests - 1) / 2) * 1.05).toFixed(2);
  for (let i = 0; i < chests; i++) props.push({ kind: "chest", x: chestX(i), z: cz, yaw: rnd(-0.12, 0.12) });
  for (let i = 0; i < bundles; i++) props.push({ kind: "bundle", x: +(cx - 0.9 + i * 0.8 + rnd(-0.2, 0.2)).toFixed(2), z: +(cz + 1.05 + rnd(-0.15, 0.15)).toFixed(2), yaw: rnd(-0.6, 0.6) });
  if (chance(0.75)) props.push({ kind: "featherbed", x: +(cx + 1.3).toFixed(2), z: +(cz + 1.1).toFixed(2), yaw: rnd(-0.3, 0.3) });
  if (chance(0.7)) props.push({ kind: "basket", x: +(cx - 1.6 - chests * 0.25).toFixed(2), z: +(cz + 0.3).toFixed(2), yaw: rnd(0, 6.28) });

  const catholic = faith === "Catholic";
  const j = (h: number, s = 0.25) => Math.round((h + (rng() * 2 - 1) * s) * 4) / 4;
  const residents: Resident[] = [];
  let seat = 0;
  let stand = 0;
  const kindFor = (p: P): string => {
    if (p.age < 15) return p.sex === "m" ? "boy" : pick(["girl", "girl_b"]);
    if (p.sex === "f") return p.age >= 55 ? "old_woman" : pick(["wife_a", "wife_b"]);
    if (p.age >= 55) return "old_man";
    return pick(["docker_a", "docker_b", "docker_c", "stranger"]);
  };
  const statsFor = (trade: TradeId, age: number): Stats => {
    const s = {} as Stats;
    for (const k of STATS) {
      let v = 5 + (rng() + rng() + rng() - 1.5) * 4 + (TRADES[trade].bias?.[k as Stat] ?? 0);
      if (k === "honesty") v += 1.5;
      if (k === "piety") v += 1;
      if (age < 15 && k === "gossip") v -= 2;
      s[k as Stat] = Math.max(0, Math.min(10, Math.round(v)));
    }
    s.wealth = int(1, 3);
    return s;
  };
  let baby: Family["baby"] = null;
  people.forEach((p, i) => {
    const id = `em${String(n).padStart(2, "0")}${String.fromCharCode(97 + i)}`;
    const trade: TradeId = p.age < 3 ? "infant" : p.age < 13 ? "child" : "emigrant";
    const name = first(p.sex);
    const r: Resident = {
      id,
      first: name,
      surname,
      name: `${name} ${surname}`,
      age: p.age,
      sex: p.sex,
      household: hh,
      family_role: p.role,
      trade,
      faction: null,
      kind: kindFor(p),
      home: { ...home },
      work: { place, kind: "inside", door: [home.sx, home.sz] },
      sched: { day: [], sunday: [] },
      stats: statsFor(trade === "emigrant" ? "emigrant" : "child", p.age),
      dog: null,
      origin: `${pick(towns)}, ${region}`,
      emigrant: n,
    };
    if (trade === "emigrant") {
      // men and big boys sit on the chests, facing the river; the women stand beside them
      if (p.sex === "m" && seat < chests) {
        r.work = { place, kind: "wait", at: [chestX(seat++), +(cz - 0.1).toFixed(2), CAMP_YAW], seat: true };
      } else {
        const side = stand % 2 === 0 ? -1 : 1;
        const k = Math.floor(stand++ / 2);
        const x = cx + side * ((chests - 1) / 2 * 1.05 + 1.15 + k * 0.8);
        r.work = { place, kind: "wait", at: [+x.toFixed(2), +(cz - 0.55 - k * 0.3).toFixed(2), CAMP_YAW - side * 0.35] };
      }
      const day: Seg[] = [[j(7.5), j(18), "work"]];
      const sunday: Seg[] = catholic ? [[8.75, 11, "church", "church"], [11.5, j(17.75), "work"]] : [[j(8.5), j(17.75), "work"]];
      r.sched = { day, sunday };
    } else if (trade === "child") {
      r.work = { place, kind: "roam" };
      const day: Seg[] = [[j(8), j(17.5), "play", place]];
      r.sched = { day, sunday: catholic ? [[8.75, 11, "church", "church"], [11.5, j(17.5), "play", place]] : day.map((s) => [...s] as Seg) };
    } else {
      // a baby in arms: never in the street on its own; the mother carries it (client)
      r.work = { place: "home", kind: "inside", door: [home.sx, home.sz] };
      if (!baby && mother) baby = { mother: "", child: id };
    }
    residents.push(r);
  });
  if (baby) {
    const m = residents.find((r) => r.family_role === "wife" || r.family_role === "widow");
    if (m) (baby as { mother: string; child: string }).mother = m.id;
    else baby = null;
  }
  const head = residents.find((r) => r.family_role === "head") ?? residents.find((r) => r.family_role === "widow") ?? residents[0];
  const lost = n !== 0 && chance(0.4) ? pick(LOST_AT) : n === 0 ? LOST_AT[0] : null;
  const arrive = arrivalOf(n);
  return {
    family: {
      n,
      household: hh,
      surname,
      country,
      from: pick(towns),
      region,
      why: pick(O.why),
      bound: pick(O.bound),
      fear: pick(FEARS),
      faith,
      arrive,
      board_day: boardDayOf(arrive),
      members: residents.map((r) => r.id),
      names: residents.map((r) => `${r.first} (${r.age})`),
      head: head.id,
      baby,
      chests,
      lost_chest: lost ? { spot: lost[0], where: lost[1] } : null,
    },
    residents,
    props,
  };
}

// ------------------------------------------------------------------ the migration

/** A door nobody lives or works behind, that no place, shop or other record uses. */
function freeDoors(db: DB): HouseDoor[] {
  const t = town(db).town;
  const houses = new Set(t.residents.map((r) => r.home.house));
  const taken: Pt[] = [];
  for (const r of t.residents) {
    taken.push([r.home.sx, r.home.sz]);
    if (r.work.door) taken.push(r.work.door);
  }
  for (const p of Object.values(t.places)) if (p.door) taken.push(p.door);
  for (const s of t.shops) taken.push(s.door);
  // other M6 records that hold houses of their own (homes to let, the Poesje, the post office)
  for (const key of ["homes", "poesje:door", "press"]) {
    const row = db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(key) as { value_json: string } | undefined;
    if (!row) continue;
    const v = JSON.parse(row.value_json) as { homes?: Array<{ house?: number; step?: Pt }>; sx?: number; sz?: number; post?: { step: Pt } | null };
    for (const h of v.homes ?? []) {
      if (typeof h.house === "number") houses.add(h.house);
      if (h.step) taken.push(h.step);
    }
    if (typeof v.sx === "number" && typeof v.sz === "number") taken.push([v.sx, v.sz]);
    if (v.post) taken.push(v.post.step);
  }
  return houseDoors().filter((d) => !houses.has(d.house) && !taken.some(([x, z]) => Math.hypot(x - d.sx, z - d.sz) < 4));
}

function stepAt(d: HouseDoor): { house: number; x: number; z: number; sx: number; sz: number } {
  return { house: d.house, x: d.x, z: d.z, sx: d.sx, sz: d.sz };
}

/**
 * Give this save its emigrants, in place and once: the Logement (a free house near the Rijnkaai),
 * its keeper and the runner (two new residents), the families' places on the quay (town places),
 * and the record. Then the families the clock says are in town now come in. Everyone and
 * everything already in the save stays as it was. Returns what it added.
 */
export function ensureEmigrants(db: DB): { made: boolean; keeper: boolean; runner: boolean } {
  const has = (db.prepare("SELECT COUNT(*) AS n FROM resident").get() as { n: number }).n;
  if (has === 0) return { made: false, keeper: false, runner: false };
  if (emigrantTown(db)?.v === 1) {
    emigrantsTick(db, Math.random, true);
    return { made: false, keeper: false, runner: false };
  }
  const t = town(db).town;
  const wm = walkMap();
  const snap = (x: number, z: number, max = 6): Pt => {
    const q = wm.nearestOpen(x, z, max) ?? { x, z };
    return [q.x, q.z];
  };
  const free = freeDoors(db);
  const score = (d: HouseDoor) => Math.hypot(d.sx - LOGEMENT_ANCHOR[0], d.sz - LOGEMENT_ANCHOR[1]) + (d.out[1] < -0.7 ? 0 : 25) + (d.storeys >= 3 ? 0 : 10);
  let door = free.filter((d) => Math.hypot(d.sx - LOGEMENT_ANCHOR[0], d.sz - LOGEMENT_ANCHOR[1]) < 90).sort((a, b) => score(a) - score(b))[0];
  let shared = false;
  if (!door) {
    // no free house near the quay: the keeper lets rooms in a house others live in too
    door = houseDoors().sort((a, b) => score(a) - score(b))[0];
    shared = true;
  }
  const home = stepAt(door);
  const rdoor = free.filter((d) => d.house !== door.house).sort((a, b) => Math.hypot(a.sx - RUNNER_ANCHOR[0], a.sz - RUNNER_ANCHOR[1]) - Math.hypot(b.sx - RUNNER_ANCHOR[0], b.sz - RUNNER_ANCHOR[1]))[0] ?? door;
  const rng = rngFrom((t.seed ^ 0x1873e) >>> 0);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];
  let hh = Math.max(0, ...t.residents.filter((r) => r.household < HH_BASE).map((r) => r.household)) + 1;
  const tavern = (TAVERNS.map((x) => `tavern:${x.id}`).filter((k) => t.places[k]) as string[]).sort(
    (a, b) => Math.hypot(t.places[a].x - rdoor.sx, t.places[a].z - rdoor.sz) - Math.hypot(t.places[b].x - rdoor.sx, t.places[b].z - rdoor.sz),
  )[0];
  const at = snap(door.sx + door.out[0] * 0.6, door.sz + door.out[1] * 0.6);
  const keeperFirst = pick(["Wilhelmina", "Gertrud", "Dorothea", "Henriette"]);
  const keeper: Resident = {
    id: KEEPER_ID,
    first: keeperFirst,
    surname: "Kruger",
    name: `${keeperFirst} Kruger`,
    age: 46 + Math.floor(rng() * 12),
    sex: "f",
    household: hh++,
    family_role: "widow",
    trade: "lodging_keeper",
    faction: null,
    kind: "wife_b",
    home: { ...home },
    work: { place: "logement", kind: "post", at: [at[0], at[1], Math.atan2(door.out[0], door.out[1])] },
    sched: { day: [[6.5, 12.5, "work"], [13.25, 21.5, "work"]], sunday: [[6.5, 8.5, "work"], [8.75, 11, "church", "church"], [11.5, 21.5, "work"]] },
    stats: { honesty: 6, temper: 5, piety: 6, warmth: 5, greed: 6, courage: 6, gossip: 8, wealth: 4 },
    dog: null,
    origin: "Aachen, in the Rhineland",
  };
  const runnerFirst = pick(["Staf", "Door", "Rik", "Miel"]);
  const runner: Resident = {
    id: RUNNER_ID,
    first: runnerFirst,
    surname: "Verbiest",
    name: `${runnerFirst} Verbiest`,
    age: 29 + Math.floor(rng() * 12),
    sex: "m",
    household: hh++,
    family_role: "single",
    trade: "runner",
    faction: TRADES.runner.faction,
    kind: "gentleman",
    home: stepAt(rdoor),
    work: { place: "rijnkaai", kind: "roam", route: CAMPS.slice(0, 4).map(([x, z]) => snap(x, z + 4)) },
    sched: {
      day: [[9.5, 15.5, "loiter", "rijnkaai"], ...(tavern ? [[18, 22.5, "tavern", tavern] as Seg] : [])],
      sunday: [[10, 15, "loiter", "rijnkaai"], ...(tavern ? [[17, 22.5, "tavern", tavern] as Seg] : [])],
    },
    stats: { honesty: 1, temper: 4, piety: 2, warmth: 7, greed: 9, courage: 5, gossip: 7, wealth: 3 },
    dog: null,
    origin: "Antwerp, the Sint-Andries quarter",
  };
  const e: EmigrantTown = {
    v: 1,
    seed: t.seed,
    logement: { house: door.house, step: [door.sx, door.sz], wall: [door.x, door.z], out: door.out, label: LOGEMENT_LABEL, shared },
    keeper: KEEPER_ID,
    runner: RUNNER_ID,
    runner_home: [rdoor.sx, rdoor.sz],
    families: [],
    scam: null,
    scam_days: [],
    runner_jailed: false,
    notices: [],
    errands: [],
  };
  let addedKeeper = false;
  let addedRunner = false;
  db.transaction(() => {
    for (const r of [keeper, runner]) {
      if (db.prepare("SELECT 1 FROM npc WHERE id = ?").get(r.id)) continue; // an id taken: never overwrite
      insertResident(db, r, "rijnkaai");
      if (r.id === KEEPER_ID) addedKeeper = true;
      else addedRunner = true;
    }
    const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'town'").get() as { value_json: string } | undefined;
    if (row) {
      const rest = JSON.parse(row.value_json) as { places: Record<string, unknown> };
      rest.places.logement = { label: LOGEMENT_LABEL, x: door.sx, z: door.sz, r: 3, district: "rijnkaai", door: [door.sx, door.sz], out: door.out };
      CAMPS.forEach(([x, z], i) => {
        rest.places[campPlace(i)] = { label: "the emigrants' place on the Rijnkaai", x, z, r: 5, district: "rijnkaai" };
      });
      db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'town'").run(JSON.stringify(rest));
    }
    save(db, e);
  })();
  dropTownCache(db);
  emigrantsTick(db, Math.random, true);
  return { made: true, keeper: addedKeeper, runner: addedRunner };
}

function insertResident(db: DB, r: Resident, district: string): void {
  db.prepare("INSERT OR IGNORE INTO npc (id, name, role, district, faction, persona_json, spot_id, active) VALUES (?, ?, ?, ?, ?, '{}', NULL, 1)").run(r.id, r.name, TRADES[r.trade].label, district, r.faction);
  db.prepare("UPDATE npc SET active = 1 WHERE id = ?").run(r.id);
  db.prepare("INSERT OR IGNORE INTO npc_relationship (npc_id) VALUES (?)").run(r.id);
  db.prepare("INSERT OR REPLACE INTO resident (id, household, trade, data_json, persona) VALUES (?, ?, ?, ?, COALESCE((SELECT persona FROM resident WHERE id = ?), ''))").run(r.id, r.household, r.trade, JSON.stringify(r), r.id);
}

// ------------------------------------------------------------------ the clock

export interface TickResult {
  changed: boolean;
  arrived: number[];
  boarded: number[];
  scam: string | null;
}

function logRow(db: DB, actor: string, verb: string, object: string | null, text: string): void {
  const c = clock(db);
  db.prepare("INSERT INTO log (day, hour, place, actor, verb, object, text) VALUES (?, ?, 'rijnkaai', ?, ?, ?, ?)").run(c.day, c.hour, actor, verb, object, text);
}

/** Bring a family into town: its people become residents, at the Logement. */
function arrive(db: DB, e: EmigrantTown, n: number, quiet = false): Family {
  const busy = new Set(e.families.filter((f) => f.status === "here").map((f) => f.slot));
  let slot = 0;
  while (busy.has(slot) && slot < CAMPS.length - 1) slot++;
  if (busy.has(slot)) slot = n % CAMPS.length;
  const lg = e.logement;
  const home = { house: lg.house, x: lg.wall[0], z: lg.wall[1], sx: lg.step[0], sz: lg.step[1] };
  const m = makeFamily(e.seed, n, slot, home, e.families.map((f) => f.surname));
  const fam: Family = { ...m.family, slot, props: m.props, status: "here", done: [] };
  db.transaction(() => {
    for (const r of m.residents) insertResident(db, r, "rijnkaai");
  })();
  if (quiet) return fam;
  const who = fam.members.length === 2 ? "two" : `${fam.members.length}`;
  logRow(db, fam.head, "emigrants_arrived", String(fam.household), `The ${fam.surname} family, ${who} of them from ${fam.from} in ${fam.region}, came to the Logement on the Rijnkaai to wait for the Kempenland, bound for ${fam.bound.split(",")[0]}.`);
  remember(db, e.keeper, `The ${fam.surname} family from ${ORIGINS[fam.country].label} took beds at my house; they go out on the ship's day.`, 3);
  return fam;
}

/** A family goes out to the ship: its people leave the town (their npc rows and memories stay). */
function board(db: DB, e: EmigrantTown, fam: Family, by: "lighter" | "engine"): void {
  const c = clock(db);
  fam.status = "boarded";
  fam.boarded = { day: c.day, hour: c.hour, by };
  db.transaction(() => {
    for (const id of fam.members) {
      const a = actionOf(db, id);
      if (a) endAction(db, a.id, "stopped", "went out to the ship");
      db.prepare("DELETE FROM resident WHERE id = ?").run(id);
      db.prepare("UPDATE npc SET active = 0 WHERE id = ?").run(id);
    }
    for (const er of e.errands.filter((x) => x.family === fam.n)) {
      db.prepare("UPDATE job SET status = 'expired' WHERE id = ? AND status = 'offered'").run(er.job);
      // an errand still in Jef's hands when the ship took them: it comes to nothing (no job left orphaned)
      const j = db.prepare("SELECT title FROM job WHERE id = ? AND status = 'taken'").get(er.job) as { title: string } | undefined;
      if (!j) continue;
      db.prepare("UPDATE job SET status = 'failed' WHERE id = ?").run(er.job);
      db.prepare("DELETE FROM item WHERE job_id = ?").run(er.job);
      logRow(db, "player", "abandoned_job", String(er.job), `The ${fam.surname} family went out to the ship before Jef finished "${j.title}".`);
    }
  })();
  if (e.scam?.family === fam.n && e.scam.state === "working") e.scam.state = "sold"; // they went with his paper in their pocket
  logRow(db, fam.head, "emigrants_boarded", String(fam.household), `The ${fam.surname} family went out by lighter to the Kempenland at anchor, bound for ${fam.bound.split(",")[0]}.`);
  remember(db, e.keeper, `The ${fam.surname} family left my house for the ship today.`, 2);
}

/**
 * The engine's hour for the emigrants: families come and go by the timetable, a ship's day
 * notice goes up, the runner tries his luck, errands are offered. Idempotent for a given clock.
 */
export function emigrantsTick(db: DB, rng: () => number = Math.random, quiet = false): TickResult {
  const e = emigrantTown(db);
  const out: TickResult = { changed: false, arrived: [], boarded: [], scam: null };
  if (!e) return out;
  const c = clock(db);
  const now = abs(c.day, c.hour + c.minute / 60);
  let townChanged = false;

  // 1. arrivals up to now, and families whose ship has gone (on an old save some never showed)
  for (let n = 0; n < 200; n++) {
    const a = arrivalOf(n);
    if (a > now && !devEarly.has(n)) break;
    if (e.families.some((f) => f.n === n)) continue;
    const bd = boardDayOf(a);
    const gone = c.day > bd || (c.day === bd && c.hour >= BOARD_TO);
    if (gone) {
      // it came and went while nobody was looking: kept as a record only
      const lg = e.logement;
      const m = makeFamily(e.seed, n, 0, { house: lg.house, x: lg.wall[0], z: lg.wall[1], sx: lg.step[0], sz: lg.step[1] }, e.families.map((f) => f.surname));
      e.families.push({ ...m.family, slot: 0, props: m.props, status: "boarded", boarded: { day: bd, hour: BOARD_TO, by: "engine" }, done: [] });
      continue;
    }
    e.families.push(arrive(db, e, n, quiet));
    out.arrived.push(n);
    townChanged = true;
  }
  // 2. the last lighter of a ship's day takes whoever is still waiting
  for (const f of e.families) {
    if (f.status !== "here") continue;
    if (c.day > f.board_day || (c.day === f.board_day && c.hour >= BOARD_TO)) {
      board(db, e, f, "engine");
      out.boarded.push(f.n);
      townChanged = true;
    }
  }
  if (quiet) {
    // the migration itself (a new game, an older save): the families only; notices, the runner and
    // errands come with the first tick of the clock
    save(db, e);
    if (townChanged) dropTownCache(db);
    out.changed = townChanged;
    return out;
  }
  // 3. the ship's day notice (the talk of the town and the prompts read world_fact)
  if (isShipDay(c.day) && c.hour >= 6 && !e.notices.includes(c.day)) {
    e.notices.push(c.day);
    db.prepare("INSERT INTO world_fact (text, weight, day, tags) VALUES (?, 5, ?, 'notice,emigrants')").run(
      "Red Star Line: the Kempenland at anchor off the Rijnkaai takes her emigrants on board today. Lighters from the quay from seven in the morning.",
      c.day,
    );
    out.changed = true;
  }
  // 4. the runner
  out.scam = runnerTick(db, e, now, rng);
  if (out.scam) out.changed = true;
  // 5. errands
  if (errandsTick(db, e)) out.changed = true;

  save(db, e);
  if (townChanged) dropTownCache(db);
  out.changed ||= townChanged;
  return out;
}

// ------------------------------------------------------------------ the runner

function runnerTick(db: DB, e: EmigrantTown, now: number, rng: () => number): string | null {
  const c = clock(db);
  const s = e.scam;
  if (s && s.state === "working" && now >= s.until) {
    s.state = "sold";
    const f = e.families.find((x) => x.n === s.family);
    if (f && f.status === "here") {
      f.scammed = true;
      f.lost_c = 1500 + Math.floor(rng() * 16) * 100;
      for (const id of adultsOf(f)) remember(db, id, `A kind man on the quay sold us railway tickets for the journey on from Philadelphia, ${Math.round(f.lost_c / 100)} francs. The keeper says they are worthless paper.`, 6);
      remember(db, e.runner, `I sold the ${f.surname} family a fine set of railway tickets. Good day's work.`, 4);
      logRow(db, e.runner, "runner_sold", String(f.household), `A runner on the Rijnkaai sold the ${f.surname} family false railway tickets for ${Math.round(f.lost_c / 100)} francs.`);
    }
    return "sold";
  }
  if (s && s.day === c.day) return null;
  if (e.runner_jailed || e.scam_days.includes(c.day)) return null;
  // he comes once a day, late in the morning, if there is a fresh family to work
  const at = 10 + (hashStr(`${e.seed}:${c.day}`) % 100) / 100 * 1.5;
  if (c.hour + c.minute / 60 < at || c.hour >= 15) return null;
  e.scam_days.push(c.day);
  if (rng() >= SCAM_CHANCE) return null;
  const target = e.families
    .filter((f) => f.status === "here" && f.board_day !== c.day && !f.scammed && !f.warned && now - f.arrive >= 2 && adultsOf(f).length)
    .sort((a, b) => b.arrive - a.arrive)[0];
  if (!target) return null;
  e.scam = { day: c.day, family: target.n, start: now, until: Math.min(now + SCAM_HOURS, abs(c.day, 15.5)), state: "working" };
  logRow(db, e.runner, "runner_working", String(target.household), `A smooth-talking man was seen with the ${target.surname} family on the Rijnkaai, showing them papers.`);
  return "working";
}

function adultsOf(f: Family): string[] {
  return f.members.filter((id) => {
    const i = f.members.indexOf(id);
    const age = Number(/\((\d+)\)/.exec(f.names[i] ?? "")?.[1] ?? 0);
    return age >= 13;
  });
}

/** Jef warns the family the runner works: the engine applies it (never the model). */
export function warnFamily(db: DB, by: string): { ok: boolean; text: string; trust: number } {
  const e = emigrantTown(db);
  const s = e?.scam;
  const f = s ? e!.families.find((x) => x.n === s.family) : undefined;
  if (!e || !s || !f || s.state !== "working" || f.status !== "here" || !f.members.includes(by)) return { ok: false, text: "", trust: 0 };
  s.state = "warned";
  s.by = by;
  f.warned = true;
  for (const id of adultsOf(f)) {
    if (id === by) continue;
    applyTrust(db, id, 1, 0);
    remember(db, id, "Jef, a young man of the quay, warned us that the man's tickets were false. He saved our money.", 6);
  }
  remember(db, by, "Jef warned me the smooth man's railway tickets were false. He saved our money.", 7, "seen", null, { gist: "Jef warned the emigrants off a runner's false tickets", tone: 2 });
  remember(db, e.runner, "That lad Jef spoiled my sale to the emigrants on the quay.", 5, "seen", null, { gist: "Jef sticks his nose in other men's business on the Rijnkaai", tone: -1 });
  logRow(db, "player", "warned_emigrants", String(f.household), `Jef warned the ${f.surname} family that the runner's tickets were false.`);
  // they ask him at once to watch their things while they go to the real office (M6-emigrants.md;
  // QA 2026-09-24: the watch was only made on a later tick and only said if he spoke to the head again)
  errandsTick(db, e);
  save(db, e);
  const er = openErrand(db, f);
  const head = by === f.head ? null : town(db).byId.get(f.head);
  const ask =
    er && er.kind === "watch" && er.status === "offered"
      ? ` Please, will you watch our things while we go to the office to ask about the tickets? ${er.pay_c} centimes, we pay.${head ? ` ${head.first} will tell you.` : ""}`
      : "";
  return { ok: true, text: ask, trust: 2 };
}

/** Jef reports the runner to a police agent: he is taken off the quays; money the family paid comes back. */
export function reportRunner(db: DB, agent: string): { ok: boolean; returned: boolean } {
  const e = emigrantTown(db);
  const c = clock(db);
  const s = e?.scam;
  if (!e || !s || e.runner_jailed || s.day !== c.day || (s.state !== "working" && s.state !== "sold")) return { ok: false, returned: false };
  const f = e.families.find((x) => x.n === s.family);
  const returned = s.state === "sold" && !!f && f.status === "here";
  s.state = "reported";
  s.by = agent;
  e.runner_jailed = true;
  db.prepare("UPDATE faction_trust SET trust = MAX(-5, MIN(10, trust + 1)) WHERE faction = 'politie'").run();
  remember(db, agent, "Jef told me a runner was selling false tickets to the emigrants on the Rijnkaai. We took the man in.", 6, "seen", null, { gist: "Jef reported the ticket runner on the Rijnkaai to the police", tone: 1 });
  remember(db, e.runner, "The police took me in off the Rijnkaai. Somebody talked: that lad Jef.", 7, "seen", null, { gist: "Jef went to the police about honest men's business on the quay", tone: -2 });
  if (f && f.status === "here") {
    if (returned) f.returned = true;
    for (const id of adultsOf(f)) remember(db, id, returned ? "The police made the smooth man give back our money. Jef went to them for us." : "The police took away the man with the papers. Jef went to them.", 6);
  }
  // off the quays for the rest of the week: he lives in the cell at the police post now
  const r = town(db).byId.get(e.runner);
  if (r) {
    const pp = policePost();
    r.home = { house: -1, x: pp.door[0], z: pp.door[1], sx: pp.x, sz: pp.z };
    r.sched = { day: [], sunday: [] };
    db.prepare("UPDATE resident SET data_json = ? WHERE id = ?").run(JSON.stringify(r), r.id);
    dropTownCache(db);
  }
  logRow(db, "player", "reported_runner", e.runner, `Jef reported the runner who sold false tickets to the emigrants; the police took him in${returned ? " and made him give the money back" : ""}.`);
  save(db, e);
  return { ok: true, returned };
}

// ------------------------------------------------------------------ errands (engine-built jobs)

const ERRAND_ORDER: ErrandKind[] = ["luggage", "watch", "lost_chest"];

function wanted(e: EmigrantTown, f: Family, day: number, hour: number): ErrandKind | null {
  for (const k of ERRAND_ORDER) {
    if (f.done.includes(k)) continue;
    if (k === "luggage" && f.board_day === day && hour >= 6) return k;
    if (k === "watch" && f.warned && f.board_day !== day) return k;
    if (k === "lost_chest" && f.lost_chest && f.board_day !== day) return k;
  }
  void e;
  return null;
}

function errandJob(f: Family, kind: ErrandKind): { title: string; type: string; pay: number; pitch: string; task: unknown } {
  const S = f.surname;
  if (kind === "luggage") {
    // M7 short jobs (Steve 2026-09-25): by hand at most two things; a family with three carries the small one itself
    const n = Math.min(f.chests, HAND_MAX);
    const pay = PAY.luggage_base + PAY.per_chest * n;
    return {
      title: n === 1 ? `The ${S} family's chest to the lighter` : `The ${S} family's chests to the lighter`,
      type: "carry",
      pay,
      pitch: `${n === 1 ? "Our chest" : "Our two big chests"}, from our place on the quay across the rails to the lighter berth${f.chests > n ? "; we carry the small one ourselves" : ""}. The lighter takes us out to the ship today.`,
      task: { kind: "carry", goods: "chests", count: n, from: "emigrant_quay", to: "lighter_berth", twist: "none", limit_s: null },
    };
  }
  if (kind === "watch") {
    return {
      title: `Watch the ${S} family's things`,
      type: "watch",
      pay: PAY.watch,
      pitch: "Please watch our chests while we go to the agent's office to see our tickets are good. There are thieves about.",
      task: { kind: "watch", goods: "chests", post: "emigrant_quay", duration_s: 90, twist: "thief" },
    };
  }
  const lc = f.lost_chest!;
  return {
    title: `Find the ${S} family's lost chest`,
    type: "carry",
    pay: PAY.lost_chest,
    pitch: `Our small chest never came to the quay. The carter says he put it down ${lc.where}. Please bring it to our place on the quay.`,
    task: { kind: "carry", goods: "chests", count: 1, from: lc.spot, to: "emigrant_quay", twist: "none", limit_s: null },
  };
}

/** Offer each family's errand for today (one at a time, the most pressing first). Returns true if a job row changed. */
function errandsTick(db: DB, e: EmigrantTown): boolean {
  const c = clock(db);
  let changed = false;
  const status = (id: number) => (db.prepare("SELECT status FROM job WHERE id = ?").get(id) as { status: string } | undefined)?.status ?? "expired";
  // finished errands are never offered again
  for (const er of e.errands) {
    const f = e.families.find((x) => x.n === er.family);
    const st = status(er.job);
    if (f && (st === "done" || st === "failed") && !f.done.includes(er.kind)) f.done.push(er.kind);
  }
  for (const f of e.families) {
    if (f.status !== "here") continue;
    const want = wanted(e, f, c.day, c.hour);
    const mine = e.errands.filter((x) => x.family === f.n);
    const live = mine.filter((x) => ["offered", "taken"].includes(status(x.job)) && x.day === c.day);
    // a more pressing errand takes the place of one still only offered
    for (const x of live) {
      if (x.kind !== want && status(x.job) === "offered") {
        db.prepare("UPDATE job SET status = 'expired' WHERE id = ?").run(x.job);
        changed = true;
      }
    }
    if (!want || live.some((x) => x.kind === want) || live.some((x) => status(x.job) === "taken")) continue;
    const j = errandJob(f, want);
    const res = db
      .prepare(
        `INSERT INTO job (day, title, employer_npc, district, task_type, pay_c, risk, tier, required_faction, pitch, task_json, source, status)
         VALUES (?, ?, ?, 'rijnkaai', ?, ?, 'low', 0, NULL, ?, ?, 'emigrant', 'offered')`,
      )
      .run(c.day, j.title, f.head, j.type, j.pay, j.pitch, JSON.stringify(j.task));
    e.errands.push({ family: f.n, kind: want, job: Number(res.lastInsertRowid), day: c.day });
    changed = true;
  }
  return changed;
}

// ------------------------------------------------------------------ boarding (the client saw the lighter)

/** The client reports a family gone down into a lighter at the berth. The engine checks it may be so. */
export function boardByLighter(db: DB, household: number, dev = false): { ok: boolean; why?: string } {
  const e = emigrantTown(db);
  if (!e) return { ok: false, why: "no emigrants in this town" };
  const f = e.families.find((x) => x.household === household);
  const c = clock(db);
  if (!f || f.status !== "here") return { ok: false, why: "no such family waiting" };
  if (!dev && (f.board_day !== c.day || c.hour < BOARD_FROM || c.hour >= BOARD_TO + 1)) return { ok: false, why: "their ship does not take them now" };
  // they do not go down to the lighter without their chests (the errand in Jef's hands)
  if (!dev && waitingForJef(db, e, f)) return { ok: false, why: "they are waiting for Jef" };
  board(db, e, f, "lighter");
  save(db, e);
  dropTownCache(db);
  return { ok: true };
}

/** Is a family waiting for Jef (an errand of theirs in his hands)? They do not go down to the lighter without their chests. */
function waitingForJef(db: DB, e: EmigrantTown, f: Family): boolean {
  return e.errands.some((x) => x.family === f.n && (db.prepare("SELECT status FROM job WHERE id = ?").get(x.job) as { status: string } | undefined)?.status === "taken");
}

// ------------------------------------------------------------------ the hook for the director (M4 emigrant_ship)

/**
 * For the director (read only): is it a ship's day, may the lighters take emigrants now, which
 * households go today, where they wait and where they board. See docs/milestones/M6-emigrants.md
 * for the changes to director/templates.ts and scheduler.ts main may make.
 */
export function emigrantShip(db: DB): { shipDay: boolean; boardingNow: boolean; nextShipDay: number; households: number[]; camp: { x: number; z: number }; berth: { x: number; z: number } } {
  const c = clock(db);
  const e = emigrantTown(db);
  const due = (e?.families ?? []).filter((f) => f.status === "here" && f.board_day === c.day);
  return {
    shipDay: isShipDay(c.day),
    boardingNow: isShipDay(c.day) && c.hour >= BOARD_FROM && c.hour < BOARD_TO,
    nextShipDay: isShipDay(c.day) && c.hour < BOARD_TO ? c.day : nextShipDay(c.day),
    households: due.map((f) => f.household),
    camp: { x: 31, z: 27 },
    berth: { x: 28, z: 1 },
  };
}

// ------------------------------------------------------------------ what the client sees

export function emigrantsView(db: DB) {
  const e = emigrantTown(db);
  const c = clock(db);
  if (!e) return null;
  const s = e.scam && e.scam.day === c.day ? e.scam : null;
  return {
    day: c.day,
    hour: c.hour + c.minute / 60,
    ship: { today: isShipDay(c.day), from: BOARD_FROM, to: BOARD_TO, next: isShipDay(c.day) && c.hour < BOARD_TO ? c.day : nextShipDay(c.day) },
    logement: e.logement,
    keeper: e.keeper,
    arrival: ARRIVAL,
    camps: CAMPS.map(([x, z], slot) => ({ slot, x, z, yaw: CAMP_YAW })),
    families: e.families
      .filter((f) => f.status === "here")
      .map((f) => ({
        n: f.n,
        household: f.household,
        surname: f.surname,
        from: `${f.from}, ${f.region}`,
        country: ORIGINS[f.country].label,
        slot: f.slot,
        members: f.members,
        head: f.head,
        baby: f.baby,
        props: f.props,
        board_day: f.board_day,
        boarding_today: f.board_day === c.day && isShipDay(c.day),
        waiting_for_jef: waitingForJef(db, e, f),
        arrived_at: f.arrive,
      })),
    boarded: e.families.filter((f) => f.status === "boarded" && f.boarded?.day === c.day).map((f) => ({ household: f.household, surname: f.surname, by: f.boarded!.by })),
    runner: { id: e.runner, jailed: e.runner_jailed, working: s?.state === "working" ? e.families.find((f) => f.n === s.family)?.household ?? null : null, state: s?.state ?? null },
  };
}

// ------------------------------------------------------------------ talk (talk.ts extension points)

function familyOf(db: DB, r: Resident): Family | undefined {
  if (!isEmigrant(r)) return undefined;
  return emigrantTown(db)?.families.find((f) => f.n === r.emigrant);
}

function openErrand(db: DB, f: Family): { title: string; pay_c: number; status: string; kind: ErrandKind; pitch: string } | null {
  const e = emigrantTown(db);
  const c = clock(db);
  if (!e) return null;
  const jobs = listJobs(db, c.day);
  for (const er of e.errands.filter((x) => x.family === f.n && x.day === c.day)) {
    const j = jobs.find((x) => x.id === er.job);
    if (j && (j.status === "offered" || j.status === "taken")) return { title: j.title, pay_c: j.pay_c, status: j.status, kind: er.kind, pitch: j.pitch };
  }
  return null;
}

const pickBy = <T>(seed: string, xs: T[]): T => xs[hashStr(seed) % xs.length];
const dayName = (d: number) => ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][(d - 1) % 7];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function whenShip(db: DB, f: Family): string {
  const c = clock(db);
  if (f.board_day === c.day) return "Today! The little boats take us out to the ship today.";
  if (f.board_day === c.day + 1) return "Tomorrow the ship takes us. One more night in the Logement.";
  return `On ${dayName(f.board_day)} the ship takes us.`;
}

let installed = false;
/** Register the emigrants' talk with talk.ts (idempotent). */
export function installEmigrantTalk(): void {
  if (installed) return;
  installed = true;
  talkExtras.greet.push((db, r, _mood, met) => {
    if (r.id === RUNNER_ID) {
      const e = emigrantTown(db);
      return e?.runner_jailed ? null : pickBy(`${r.id}:${met}`, ["Good day, friend! You look like a man who knows the quays. Me, I help the poor emigrants with their papers.", "Ah, a local lad. Good. These foreigners need a friend who speaks their tongue, and I am that friend."]);
    }
    if (r.id === KEEPER_ID) return pickBy(`${r.id}:${met}:${clock(db).day}`, ["Good day. The beds are for emigrants, a franc a night with the soup. You are no emigrant.", "Yes? If you want a bed, try the doss house. Mine are for the people going to America."]);
    const f = familyOf(db, r);
    if (!f) return null;
    const c = clock(db);
    const seed = `${r.id}:${met}:${c.day}:${c.hour}`;
    if (r.age < 13) return pickBy(seed, ["We go on the big ship!", "Are you from America? No? Then from where?", "My mother says do not talk to strangers. But you look kind.", "The ship is so big, bigger than our church."]);
    const e = emigrantTown(db)!;
    let line = pickBy(seed, ORIGINS[f.country].greet);
    const s = e.scam;
    if (s && s.family === f.n && s.day === c.day && s.state === "working") line += " A kind man from the agent helps us. He sells us the railway tickets for over there, very cheap.";
    else if (f.warned) line += " You are the one who warned us! Thank you, thank you.";
    else if (f.returned) line += " The police gave us back our money. Because of you.";
    else if (f.scammed) line += " Now the keeper says our railway paper is worth nothing. Nothing!";
    const er = openErrand(db, f);
    if (er && er.status === "offered" && r.id === f.head) {
      line += er.kind === "luggage" ? ` Please, can you carry our chests to the boat? ${er.pay_c} centimes, we pay.` : er.kind === "watch" ? ` Please, can you watch our things while we go to the office? ${er.pay_c} centimes.` : ` Please, our chest is lost. ${cap(f.lost_chest!.where)}, the carter says. If you bring it, we pay ${er.pay_c} centimes.`;
    } else if (er && er.status === "offered") {
      const head = town(db).byId.get(f.head);
      if (head) line += ` My ${head.sex === "m" ? (r.family_role === "wife" ? "husband" : "father") : "mother"} ${head.first} looks for a helper; ask ${head.sex === "m" ? "him" : "her"}.`;
    }
    return line;
  });
  talkExtras.choice.push((r, t) => {
    if (!isEmigrant(r) || r.age < 13) return null;
    if (t === "self") return "Where are you bound?";
    if (t === "family") return "Who travels with you?";
    if (t === "work") return "Do you need a hand with anything?";
    if (t === "town") return "When does your ship go?";
    return null;
  });
  talkExtras.reply.push((db, r, t, seed) => {
    if (r.id === RUNNER_ID && t === "self") return "I work for an agent. Tickets, exchange, advice: whatever the poor souls need. For a small fee, naturally.";
    if (r.id === KEEPER_ID && t === "self") return "I keep the Logement, the lodging house for the emigrants. German people mostly, like me; I came from Aachen twenty years ago. A franc a night, soup and bread, and no drinking in the rooms.";
    const f = familyOf(db, r);
    if (!f) return null;
    if (r.age < 13) {
      if (t === "self") return pickBy(seed, ["We play tag round the chests. Then we go on the ship to America.", "My brother says the sea takes forty days. He lies, I think."]);
      if (t === "family") return `With my family, the ${f.surname}s. We sleep at the Logement, all in one room.`;
      return null;
    }
    const town_ = town(db);
    switch (t) {
      case "self":
        return `We come from ${f.from}, in ${f.region}. ${cap(f.why)}. Now we go to ${f.bound}.${r.stats.warmth >= 5 ? ` What I fear most? ${cap(f.fear)}.` : ""}`;
      case "family": {
        const others = f.members.filter((id) => id !== r.id).map((id) => town_.byId.get(id)).filter((x): x is Resident => !!x);
        return others.length ? `All of us together: ${others.map((o) => `${o.first}, ${o.age}`).join("; ")}. ${f.faith === "Catholic" ? "God keep us on the water." : "The Lord goes with us."}` : "Only me. The others go later, when I send the money.";
      }
      case "work": {
        const er = openErrand(db, f);
        if (!er) return "No, no, thank you. We only wait. Always waiting.";
        if (er.status === "taken") return "You help us already. Thank you, thank you.";
        if (r.id !== f.head) return `Ask ${town_.byId.get(f.head)?.first ?? "the head of our family"}. It is about ${er.title.toLowerCase()}.`;
        return `${er.pitch} ${er.pay_c} centimes, we pay.`;
      }
      case "town":
        return whenShip(db, f);
      default:
        return null;
    }
  });
  talkExtras.topics.push((db, r) => {
    const e = emigrantTown(db);
    const c = clock(db);
    const s = e?.scam;
    if (!e || !s || s.day !== c.day) return [];
    const f = e.families.find((x) => x.n === s.family);
    const out: ExtraTopic[] = [];
    if (s.state === "working" && f && f.members.includes(r.id) && r.age >= 13) {
      out.push({
        choice: "That man's tickets are false. Don't give him your money.",
        answer: (db2, r2) => {
          const w = warnFamily(db2, r2.id);
          if (!w.ok) return { text: "Which man? He is gone already." };
          return { text: pickBy(r2.id, ["False? But he has a stamp, and a paper with an eagle... No. You are right, the price was too good. Thank you, thank you. We keep our money.", "Oh. Oh, God. We almost paid him everything. Thank you, young man. We ask at the real office.", "False? Then he is a thief with a nice coat. Thank you. We do not forget this."]) + w.text, trust: w.trust };
        },
      });
    }
    if ((s.state === "working" || s.state === "sold") && !e.runner_jailed && (r.trade === "police" || r.trade === "water_bailiff")) {
      out.push({
        choice: "A man on the Rijnkaai is selling false tickets to the emigrants.",
        answer: (db2, r2) => {
          const rep = reportRunner(db2, r2.id);
          if (!rep.ok) return { text: "I'll keep my eyes open on the quay." };
          const runner = town(db2).byId.get(e.runner);
          return {
            text: `False tickets? That'll be ${runner?.first ?? "one of the runners"} ${runner?.surname ?? ""}, he works the lodging houses. We'll have him in the cell tonight${rep.returned ? ", and the family's money back out of his pockets" : ""}. Good lad.`.replace(/\s+,/g, ","),
            trust: 1,
          };
        },
      });
    }
    return out;
  });
  talkExtras.context.push((db, r) => {
    if (r.id === KEEPER_ID)
      return "YOUR STORY: you keep the Logement, the lodging house for emigrants by the Rijnkaai: a franc a night with soup and bread. German-born (from Aachen), a widow, twenty years in Antwerp; you speak German to your lodgers. You mind your money but you are not cruel. You hate the runners who meet the trains and cheat your lodgers: they give the houses a bad name.";
    if (r.id === RUNNER_ID) {
      const e = emigrantTown(db);
      return `YOUR STORY: you are a runner. You call yourself an agent's man. You meet the emigrants at the station and on the quay, speak a little German to them, and sell them worthless railway tickets for America and bad money exchange. You never admit this to Jef or anyone; you are charming and smooth.${e?.runner_jailed ? " The police have taken you in because of Jef; you are sour about it." : ""}`;
    }
    const f = familyOf(db, r);
    if (!f) return "";
    const c = clock(db);
    const s = emigrantTown(db)?.scam;
    const scam = s && s.family === f.n && s.day === c.day ? (s.state === "working" ? "A friendly man who calls himself an agent's man is selling you railway tickets for the journey on from Philadelphia; you think he is kind. " : s.state === "warned" ? "Jef warned you that the friendly man's tickets were false; you are grateful to him. " : "") : "";
    return `EMIGRANT: you and your family (${f.names.join(", ")}) come from ${f.from}, in ${f.region} (${ORIGINS[f.country].label}), and wait in Antwerp for the Red Star Line's liner Kempenland, at anchor in the Schelde; the lighters take you out to her on ${dayName(f.board_day)}${f.board_day === c.day ? " (today)" : ""}. You sleep at the Logement by the Rijnkaai and wait by your chests on the quay by day. Why you left: ${f.why}. Where you go: ${f.bound}. Your faith: ${f.faith}. What you fear: ${f.fear}. ${f.scammed ? "A runner sold you worthless railway tickets; you are ashamed and angry. " : ""}${scam}
HOW YOU SPEAK: ${ORIGINS[f.country].speech} Plain English words only: never words of your own language, except names. You may ask Jef for help only with the work listed as YOUR OWN WORK; never offer other pay or other work.`;
  });
}
installEmigrantTalk();
