// The town's runs now (the trade plan, docs/trade-plan.md part A: "a run is a timetable on a real way"): the carts
// that take goods from one place to another by the clock, with no player near. Pure, like whereabouts.ts: the
// server's town map lists and draws them, the game's test kit (`__scheldemist.runs()`) checks its carts against them.
//
// Two kinds today: the mills' carts (shared/mills.ts: the flour to the bakery at dawn, the grain from a dock after
// dinner; the mill's man leads the dray or pushes the handcart) and the carts with a whole pile of the quay's goods
// (shared/goods.ts CART_RUNS: the Hessenatie's dray with the casks, the handcart with the Rijnkaai's sacks). Where
// each is follows from the clock alone: the same sums the game draws them by (whereabouts.ts millRun for the mill's
// man, shared/cartRuns.ts for the quay's carts).

import { CART_RUNS, PILES, type CartRun } from "../../../shared/goods.ts";
import { along, CART_LEG_NAMES, cartAt, dayPlan, type CartLeg } from "../../../shared/cartRuns.ts";
import { CART_SACKS, GRAIN_SACKS, MILLS, runNow, type MillDef } from "../../../shared/mills.ts";
import { pointAlong, wayLength, type Pt } from "./wayfind.ts";
import { runAt, wayPoint, type TradeRun } from "../../../shared/trade.ts";

export type Chain = "flour" | "grain" | "casks" | "sacks" | "bread" | "meat" | "fish";

export interface RunNow {
  /** "mill_mid:flour", "cart:casks". */
  id: string;
  chain: Chain;
  /** "the Kipdorp mill's dray". */
  label: string;
  vehicle: "dray" | "handcart" | "baskets";
  /** The townsperson who leads it (the mill's man), or null (the quay's carters are not townspeople). */
  man: string | null;
  /** Where the goods come from and go to. */
  from: string;
  to: string;
  /** The part of the run now: go, load, unload, back, store (a mill's cart); out, deliver, back, fetch, bring, home, wait (a quay cart). */
  phase: string;
  /** What he is doing, in plain words, with the load and the metres to go. */
  doing: string;
  x: number;
  z: number;
  yaw: number;
  moving: boolean;
  /** The goods on it now, and what they are ("sacks of flour"). */
  load: number;
  goods: string;
  /** Metres to go on this leg (0: standing), and game minutes left of this part. */
  left: number;
  minLeft: number;
  /** The rest of the way (moving only). */
  way: Pt[] | null;
  /** The places of the trade it links: a mill, a bakery (its shop id), a pile. */
  posts: string[];
}

export interface RunsOpts {
  /** The mill's man of each mill (server town/mills.ts MILL_PEOPLE). */
  men?: Record<string, string>;
  /** Sacks on each mill's cart now (the engine's stocks: server town/mills.ts millStocks().carts). */
  sacks?: Record<string, number>;
  /** Places' names (town.places / shops): a bakery's shop id to "the bakery on the Steenplein". */
  names?: Record<string, string>;
  /** T3: the dispatcher's runs (trade/ledger.ts), placed by their own clock. */
  trade?: TradeRun[];
}

const GOODS_WORDS: Record<string, [string, string]> = { bread: ["loaf", "loaves"], meat: ["portion of meat", "portions of meat"], fish: ["fish", "fish"] };

/** T3: a dispatcher's run on foot now (its man with baskets), or null when it is over. */
function tradeRunNow(r: TradeRun, day: number, hour: number, o: RunsOpts): RunNow | null {
  const t = (day - 1) * 1440 + hour * 60;
  const at = runAt(r, t);
  if (at.phase === "over") return null;
  const [x, z] = wayPoint(r.way, at.f);
  const from = o.names?.[r.from] ?? r.from;
  const to = o.names?.[r.to] ?? r.to;
  const [one, many] = GOODS_WORDS[r.good] ?? [r.good, r.good];
  const goods = plural(r.n, one, many);
  const moving = at.phase === "go" || at.phase === "back";
  const togoM = at.phase === "go" ? r.len * (1 - at.f) : at.phase === "back" ? r.len * at.f : 0;
  const doing =
    at.phase === "load" ? `Filling two baskets with ${goods} at ${from}, for ${to}`
      : at.phase === "go" ? `Taking ${goods} from ${from} to ${to}${togo(togoM)}`
        : at.phase === "unload" ? `Setting ${goods} out at ${to}`
          : `Walking back to ${from} with the empty baskets${togo(togoM)}`;
  // (the heading along the way here)
  const [x2, z2] = wayPoint(r.way, Math.min(1, at.f + 0.01));
  const yaw = at.phase === "back" ? Math.atan2(x - x2, z - z2) : Math.atan2(x2 - x, z2 - z);
  return {
    id: r.id,
    chain: r.good,
    label: `a run of ${r.good} from ${from}`,
    vehicle: "baskets",
    man: r.man,
    from,
    to,
    phase: at.phase,
    doing,
    x: Math.round(x * 10) / 10,
    z: Math.round(z * 10) / 10,
    yaw,
    moving,
    load: at.phase === "back" ? 0 : r.n,
    goods: many,
    left: Math.round(togoM),
    minLeft: Math.round(at.minLeft),
    way: moving ? (at.phase === "go" ? r.way.slice(Math.floor(at.f * (r.way.length - 1))) : r.way.slice(0, Math.ceil(at.f * (r.way.length - 1)) + 1).reverse()) : null,
    posts: [r.from, r.to],
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const togo = (m: number) => (m >= 1 ? ` (${Math.round(m)} m to go)` : "");

/** A mill's name for a sentence ("the Kipdorp mill"), its store and the grain's quay. */
const MILL_WORDS: Record<string, { store: string; quay: string; bakery: string }> = {
  mill_mid: { store: "the Kipdorp mill's sack store", quay: "the canal quay", bakery: "the bakery on the Steenplein" },
  mill_ne: { store: "the north mill's sack store", quay: "the south quay of the Petit Bassin", bakery: "the bakery behind the Rijnkaai" },
};

function millRunNow(m: MillDef, day: number, hour: number, o: RunsOpts): RunNow | null {
  const run = runNow(m, day, hour);
  if (!run) return null;
  const kind = run.run.kind;
  const words = MILL_WORDS[m.id] ?? { store: `${m.label}'s store`, quay: "the quay", bakery: o.names?.[m.bakery] ?? "the bakery" };
  const bakery = o.names?.[m.bakery] ?? words.bakery;
  const sacksNow = o.sacks?.[m.id];
  // (the cart's load: the engine's count while it is out; by the phase when the stocks are not given)
  const loaded = kind === "flour" ? run.phase === "go" || run.phase === "unload" : run.phase === "back" || run.phase === "store";
  const load = loaded ? (sacksNow ?? (kind === "flour" ? CART_SACKS : GRAIN_SACKS)) : run.phase === "load" ? (sacksNow ?? 0) : 0;
  const goods = kind === "flour" ? "sacks of flour" : "sacks of grain";
  const sacks = (n: number) => plural(n, `sack of ${kind}`, goods);
  const vehicle = m.cart;
  const cartWord = vehicle === "dray" ? "dray" : "handcart";
  let x: number;
  let z: number;
  let yaw = 0;
  let moving = false;
  let left = 0;
  let way: Pt[] | null = null;
  if (run.phase === "go" || run.phase === "back") {
    const route = m.routes[kind === "flour" ? "bakery" : "dock"] as Pt[];
    const pts = run.phase === "back" ? route.slice().reverse() : route;
    const total = wayLength(pts);
    const f = run.since / Math.max(1e-6, run.since + run.left);
    const p = pointAlong(pts, f * total);
    x = p.x;
    z = p.z;
    yaw = p.yaw;
    moving = true;
    left = total * (1 - f);
    // the rest of the way: from him to its end
    let acc = 0;
    let i = 1;
    for (; i < pts.length; i++) {
      acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (acc >= f * total) break;
    }
    way = [[x, z], ...pts.slice(i)];
  } else {
    const at = (kind === "flour" && run.phase === "load") || (kind === "grain" && run.phase === "store") ? m.park : kind === "flour" ? m.stops.bakery : m.stops.dock;
    x = at[0];
    z = at[1];
  }
  const from = kind === "flour" ? words.store : words.quay;
  const to = kind === "flour" ? bakery : words.store;
  let doing: string;
  if (kind === "flour") {
    if (run.phase === "load") doing = `Loading ${sacks(Math.max(load, sacksNow ?? CART_SACKS))} onto the ${cartWord} at ${words.store}`;
    else if (run.phase === "go") doing = `Taking ${sacks(load)} from ${m.label} to ${bakery}${togo(left)}`;
    else if (run.phase === "unload") doing = `Carrying ${sacks(load)} in at ${bakery}`;
    else doing = `Back to ${m.label} with the empty ${cartWord}${togo(left)}`;
  } else {
    if (run.phase === "go") doing = `Going to ${words.quay} for ${sacks(GRAIN_SACKS)} with the ${cartWord}${togo(left)}`;
    else if (run.phase === "load") doing = `Loading ${sacks(GRAIN_SACKS)} at ${words.quay}`;
    else if (run.phase === "back") doing = `Taking ${sacks(load)} from ${words.quay} to ${m.label}${togo(left)}`;
    else doing = `Stacking ${sacks(load)} in ${words.store}`;
  }
  return {
    id: `${m.id}:${kind}`,
    chain: kind,
    label: `${m.label}'s ${cartWord}`,
    vehicle,
    man: o.men?.[m.id] ?? null,
    from,
    to,
    phase: run.phase,
    doing,
    x,
    z,
    yaw,
    moving,
    load,
    goods,
    left: Math.round(left),
    minLeft: Math.round(run.left * 60),
    way,
    posts: [m.id, m.bakery],
  };
}

const planMemo = new Map<string, CartLeg[]>();
const legsOf = (r: CartRun) => {
  let l = planMemo.get(r.id);
  if (!l) planMemo.set(r.id, (l = dayPlan(r)));
  return l;
};

/** A quay cart's words: where its pile lies and where it takes it. */
const CART_WORDS: Record<string, { label: string; home: string; to: string; one: string; many: string }> = {
  casks: { label: "the Hessenatie's dray", home: "the Hessenatie's pile", to: "the lighter berth", one: "cask", many: "casks" },
  sacks: { label: "the Rijnkaai's handcart", home: "the Rijnkaai's sack pile", to: "the lighter berth", one: "sack", many: "sacks" },
};

function cartRunNow(r: CartRun, day: number, hour: number): RunNow | null {
  if (day % 7 === 0) return null;
  const legs = legsOf(r);
  const t = hour * 60;
  // out from the first leg's start to the last one's end; standing between legs counts (waiting at the pile, the berth)
  if (t < legs[0].t0 || t >= legs[legs.length - 1].t1) return null;
  const w = cartAt(legs, t, false);
  const L = legs[w.leg];
  const name = CART_LEG_NAMES[w.leg] ?? "out";
  const words = CART_WORDS[r.id] ?? { label: r.label, home: "the pile", to: "the berth", one: "load", many: "loads" };
  const n = r.items.length;
  const loaded = name === "deliver" || name === "bring";
  const goods = words.many;
  const things = plural(n, words.one, words.many);
  const total = L.cum[L.cum.length - 1];
  const left = w.moving ? Math.max(0, total - w.s) : 0;
  const o = { x: 0, z: 0, yaw: 0 };
  along(L, w.s, o);
  let way: Pt[] | null = null;
  if (w.moving) {
    let i = 1;
    while (i < L.cum.length && L.cum[i] <= w.s) i++;
    way = [[o.x, o.z], ...L.pts.slice(i)];
  }
  const cart = r.vehicle === "dray" ? "dray" : "handcart";
  let doing: string;
  if (!w.moving) {
    const next = legs[w.leg + 1];
    const wait = next ? ` till ${hhmm(next.t0 / 60)}` : "";
    doing = name === "deliver" ? `Setting ${things} down at ${words.to}${wait}` : name === "bring" ? `Setting ${things} down at ${words.home}${wait}` : name === "out" ? `Taking ${things} up at ${words.home}${wait}` : name === "fetch" ? `Taking ${things} up again at ${words.to}${wait}` : `Waiting with the ${cart}${wait}`;
  } else if (name === "deliver") doing = `Taking ${things} from ${words.home} to ${words.to}${togo(left)}`;
  else if (name === "bring") doing = `Bringing ${things} back from ${words.to} to ${words.home}${togo(left)}`;
  else if (name === "out") doing = `Going for ${things} at ${words.home}${togo(left)}`;
  else if (name === "fetch") doing = `Going for ${things} at ${words.to}${togo(left)}`;
  else doing = `Taking the empty ${cart} to its yard${togo(left)}`;
  const minLeft = w.moving ? L.t1 - t : Math.max(0, (legs[w.leg + 1]?.t0 ?? t) - t);
  const pile = PILES.find((p) => r.items[0]?.startsWith(`pile:${p.id}:`));
  return {
    id: `cart:${r.id}`,
    chain: r.id === "casks" ? "casks" : "sacks",
    label: words.label,
    vehicle: r.vehicle,
    man: null,
    from: words.home,
    to: words.to,
    phase: w.moving ? name : "wait",
    doing,
    x: o.x,
    z: o.z,
    yaw: o.yaw,
    moving: w.moving,
    load: loaded || (!w.moving && (name === "out" || name === "fetch")) ? n : 0,
    goods,
    left: Math.round(left),
    minLeft: Math.round(minLeft),
    way,
    posts: [pile ? `pile:${pile.id}` : r.cart],
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
function hhmm(h: number): string {
  const m = Math.round((((h % 24) + 24) % 24) * 60);
  return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
}

/** Every run out now (day 1 = Monday, hour with its fraction). */
export function runsNow(day: number, hour: number, o: RunsOpts = {}): RunNow[] {
  const out: RunNow[] = [];
  for (const m of MILLS) {
    const r = millRunNow(m, day, hour, o);
    if (r) out.push(r);
  }
  for (const r of CART_RUNS) {
    const c = cartRunNow(r, day, hour);
    if (c) out.push(c);
  }
  for (const r of o.trade ?? []) {
    const c = tradeRunNow(r, day, hour, o);
    if (c) out.push(c);
  }
  return out;
}
