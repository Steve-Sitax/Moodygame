import type { DB } from "../db.ts";
import { writeEvent } from "../director/eventlog.ts";
import { ITEMS, WARES, waresOf } from "../trade.ts";
import { rngFrom, type Resident } from "../town/population.ts";
import { town } from "../town/store.ts";
import { clamp } from "./common.ts";

// News from abroad moves prices (M6 AI ideas). Ships bring the foreign papers; now
// and then the ENGINE picks one piece of news from a fixed table, with its effect on
// named goods: 10 to 30 in the hundred up or down, for 1 to 3 days (the table's
// ranges, rolled once). It goes into the harbour master's list in the log, so the
// morning paper's model writes the article from the engine's fact (no extra call);
// the shops take the new prices through trade.waresOf (ideas/prices.ts); the traders
// and dockers know it in talk (routes.ts adds a line to the talk context).

export interface NewsDef {
  key: string;
  /** Where the news comes from, and what it is, in the engine's words. */
  from: string;
  what: string;
  /** What a trader or a docker would say about it. */
  talk: string;
  /** Percent change per item: [lo, hi], within -30..-10 or 10..30. */
  prices: Record<string, [number, number]>;
  days: [number, number];
}

export const NEWS_TABLE: NewsDef[] = [
  {
    key: "baltic_grain",
    from: "the Riga and Danzig papers",
    what: "a poor harvest and early ice in the Baltic; grain is short at Riga and Danzig",
    talk: "grain is short in the Baltic, so the bakers have put up the bread",
    prices: { bread: [15, 30], biscuit: [10, 25], beer: [10, 15] },
    days: [2, 3],
  },
  {
    key: "herring_season",
    from: "the Vlaardingen and Leith papers",
    what: "a good herring season: the Dutch and Scotch boats come home low in the water",
    talk: "the herring boats did well this year, so herring is cheap at the Vismarkt",
    prices: { herring: [-30, -15], eel: [-15, -10] },
    days: [1, 3],
  },
  {
    key: "war_scare",
    from: "the Paris and Madrid papers",
    what: "talk of war: fighting in the north of Spain, and the shipowners are laying in stores",
    talk: "there is talk of war in Spain, and the ships are buying up biscuit and gin",
    prices: { biscuit: [15, 30], jenever: [10, 20], bread: [10, 10] },
    days: [1, 2],
  },
  {
    key: "rhine_apples",
    from: "the Cologne papers",
    what: "a heavy apple crop along the Rhine; the barges come down full",
    talk: "the Rhine barges came down full of apples, so apples are cheap",
    prices: { apple: [-30, -20] },
    days: [2, 3],
  },
  {
    key: "hop_failure",
    from: "the London papers",
    what: "the hops failed in Kent and in Bohemia",
    talk: "the hops failed in England and Bohemia, so the beer is dearer",
    prices: { beer: [15, 25] },
    days: [2, 3],
  },
  {
    key: "schiedam_grain",
    from: "the Rotterdam papers",
    what: "the Schiedam distillers are short of grain",
    talk: "the Schiedam distillers are short of grain, so a nip of jenever costs more",
    prices: { jenever: [15, 30] },
    days: [1, 2],
  },
];

export interface NewsRow {
  day: number;
  key: string;
  text: string;
  talk: string;
  prices_json: string;
  until_day: number;
}

export interface PriceMove {
  factor: number;
  pct: number;
  before_c: number;
  after_c: number;
}

/** The lowest price of an item among the town's sellers (engine prices, with every factor). */
export function lowestPrice(db: DB, item: string): number | null {
  let best = Infinity;
  for (const id of Object.keys(WARES)) for (const w of waresOf(db, id)) if (w.kind === item) best = Math.min(best, w.price_c);
  for (const r of town(db).town.residents as Resident[]) {
    if (r.work.stall === undefined && !r.work.shop && r.trade !== "publican" && r.trade !== "chandler") continue;
    for (const w of waresOf(db, r.id)) if (w.kind === item) best = Math.min(best, w.price_c);
  }
  return Number.isFinite(best) ? best : null;
}

const plainName = (item: string) => (ITEMS[item]?.name ?? item).replace(/^(a|an) (pot of |loaf of |nip of |salt |smoked )?/, "");

/**
 * Roll today's news from abroad (once a day, from day 2, about half the days). The engine
 * picks the news and its numbers; returns the row, or null. `ship`: the first ship in today.
 */
export function rollNews(db: DB, day: number, ship: { name: string; type: string } | null, rng?: () => number, force?: string): NewsRow | null {
  if (db.prepare("SELECT 1 FROM news_abroad WHERE day = ?").get(day)) return null;
  const r = rng ?? rngFrom(((town(db).town.seed || 1873) * 7 + day * 4099) >>> 0);
  if (!force && (day < 2 || r() > 0.55)) return null;
  const yesterday = db.prepare("SELECT key FROM news_abroad WHERE day = ?").get(day - 1) as { key: string } | undefined;
  const pool = NEWS_TABLE.filter((n) => (force ? n.key === force : n.key !== yesterday?.key));
  const def = pool[Math.floor(r() * pool.length)];
  if (!def) return null;
  const days = clamp(def.days[0] + Math.floor(r() * (def.days[1] - def.days[0] + 1)), 1, 3);
  const before: Record<string, number | null> = {};
  for (const item of Object.keys(def.prices)) before[item] = lowestPrice(db, item);
  const prices: Record<string, PriceMove> = {};
  for (const [item, [lo, hi]] of Object.entries(def.prices)) {
    // the engine's clamp: 10 to 30 in the hundred, up or down, whatever the table says
    let pct = Math.round(lo + r() * (hi - lo));
    const sign = pct < 0 ? -1 : 1;
    pct = sign * clamp(Math.abs(pct), 10, 30);
    const b = before[item];
    if (b === null) continue;
    const after = Math.max(1, Math.round(b * (1 + pct / 100)));
    if (after === b) continue; // a cheap thing whose price cannot move a whole centime: no news for it
    prices[item] = { factor: 1 + pct / 100, pct, before_c: b, after_c: after };
  }
  if (!Object.keys(prices).length) return null;
  const until = day + days - 1;
  const moves = Object.entries(prices)
    .map(([item, p]) => `${plainName(item)} ${p.pct > 0 ? "up" : "down"} from ${p.before_c} to ${p.after_c} centimes`)
    .join(", ");
  const lasting = days === 1 ? "for today" : `for ${days} days`;
  const by = ship ? `The ${ship.type} ${ship.name} brought ${def.from}` : `The mail brought ${def.from}`;
  const text = `${by}: ${def.what}. In the town, ${moves}, ${lasting}.`;
  const talk = `${def.talk} (${moves}, ${lasting})`;
  db.prepare("INSERT INTO news_abroad (day, key, text, talk, prices_json, until_day) VALUES (?, ?, ?, ?, ?, ?)").run(day, def.key, text, talk, JSON.stringify(prices), until);
  writeEvent(db, { kind: "log", verb: "news_abroad", text, weight: 6, data: { key: def.key, prices, until_day: until } });
  db.prepare("INSERT INTO world_fact (text, weight, day, tags) VALUES (?, 5, ?, 'news_abroad')").run(`News from abroad: ${talk}.`, day);
  return newsRow(db, day);
}

export function newsRow(db: DB, day: number): NewsRow | null {
  return (db.prepare("SELECT * FROM news_abroad WHERE day = ?").get(day) as NewsRow | undefined) ?? null;
}

/** The news that moves prices today (it may have come on an earlier day). */
export function newsToday(db: DB): NewsRow[] {
  const day = (db.prepare("SELECT day FROM player WHERE id = 1").get() as { day: number }).day;
  return db.prepare("SELECT * FROM news_abroad WHERE day <= ? AND until_day >= ? ORDER BY day").all(day, day) as NewsRow[];
}

/** Who knows the news in talk: the people of the quays and the counters. */
export const NEWS_TRADES = new Set([
  "docker", "natie", "porter", "carter", "boatman", "sailor", "fishwife", "market_woman", "baker", "grocer", "chandler", "tobacconist",
  "pawnbroker", "publican", "clerk", "merchant", "foreman", "fish_merchant", "brewer", "customs", "newsboy", "post_clerk", "dealer", "shopwife",
]);

/** A line for the talk context of a trader or a docker (routes.ts wraps the talk hooks with it). */
export function newsTalkLine(db: DB, trade: string): string {
  if (!NEWS_TRADES.has(trade)) return "";
  const rows = newsToday(db);
  if (!rows.length) return "";
  return `\nNEWS FROM ABROAD (in the paper, and you know it from your trade; mention it if talk turns to prices or the ships): ${rows.map((r) => r.talk).join("; ")}.`;
}
