import type { HousePlan, InworldEntry } from "../../../shared/housePlan";
import { shopTrade } from "../../../shared/shops";
import type { HomeClass } from "../../../shared/homes";
import LIST from "../../../shared/inworld_houses.json";
import BUILD from "../../../shared/inworld_build.json";
import { buildCellar, buildTavern, type Room } from "./rooms";
import { buildShop } from "./shopRooms";
import { buildHome } from "./homeRooms";
import { createHouseInWorld, type HouseInWorld } from "./houseInWorld";
import { allShutters, makeShutters, shutterDaylight, shutUp, type Shutters } from "./shopShutters";
import type { InWorld } from "./inworld";
import type { World } from "./rijnkaai";

// Empty fronts (2026-09-26, docs/milestones/M7-empty-fronts.md). Every house listed in shared/inworld_houses.json is cut
// open in city.glb (shared/inworld_build.json: its door has no leaf, its windows no painted glass), whatever the save
// says. Its room is built by its own use: the shop, the tavern, the Poesje (game/interiors.ts) or the home to let
// (game/homes.ts), and only when that use's door is this house's. When it is not (an older save put the shop at
// another door: Steve's "empty glitchy shop next to the bakery"), the doorway showed a grey void and the windows
// nothing. The server now moves each use into its own house (server shops/town.ts moveIntoOwnHouse, town/emigrants.ts),
// and this is the net under it: once both owners have heard from the server, every listed house still without a
// room gets its own kind of room, shut: the leaf in the door, the lamps out, and on a shop the shutters up at night.
// `emptyFrontsReport` is the check (`__scheldemist.emptyfronts()`): it must list no problems.

type Entry = InworldEntry & { id: string; kind: string; house: number };
const ENTRIES = (LIST as unknown as { houses: Entry[] }).houses;
const CUT = new Set((BUILD as unknown as { houses: Array<{ id: string }> }).houses.map((h) => h.id));

interface StandIn {
  house: HouseInWorld;
  shutters: Shutters | null;
}

const standIns = new Map<string, StandIn>();
let ctx: { world: World; inWorld: InWorld; plans: Map<string, HousePlan> } | null = null;
let filled = false;

/** A stand-in room already stands in this listed house (an owner that turns up later leaves it be). */
export function standInHas(id: string): boolean {
  return standIns.has(id);
}

const seedOf = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 9973;
};

function shutRoom(e: Entry, plan: HousePlan): { room: Room; air: { color: number; near: number; far: number }; scatter: number } {
  const seed = seedOf(e.id);
  if (plan.kind === "shop") return { room: buildShop({ plan, trade: shopTrade(e.id.replace(/^shop:/, "")) ?? "grocer", label: "", seed }), air: { color: 0x1c1610, near: 3.5, far: 16 }, scatter: 0.35 };
  if (plan.kind === "tavern") return { room: buildTavern({ plan, label: "", seed }), air: { color: 0x1a130d, near: 3.5, far: 20 }, scatter: 0.4 };
  if (plan.kind === "cellar") return { room: buildCellar({ plan }), air: { color: 0x1a130e, near: 3.5, far: 18 }, scatter: 0.5 };
  return { room: buildHome({ plan, cls: (e.cls ?? "widow") as HomeClass, seed }), air: { color: 0x16120e, near: 6, far: 24 }, scatter: 0.35 };
}

function fill(): void {
  if (!ctx || filled) return;
  filled = true;
  const built = new Set(ctx.inWorld.all.map((r) => r.id));
  for (const e of ENTRIES) {
    const plan = ctx.plans.get(e.id);
    if (!plan || built.has(e.id)) continue;
    const { room, air, scatter } = shutRoom(e, plan);
    const house = createHouseInWorld(ctx.world, ctx.inWorld, plan, room, air, scatter);
    house.doorOpen = false;
    room.setLamps?.(0);
    room.update(0, 0);
    const shutters = plan.kind === "shop" ? makeShutters(plan, ctx.world.scene, room.scene) : null;
    standIns.set(e.id, { house, shutters });
    console.warn(`[fronts] ${e.id} (house ${e.house}): its own use has its door elsewhere in this town; a shut room stands in the house`);
  }
}

/**
 * Start the net (game/homes.ts attachWorld, once): `ready` says both owners have their first answer from the server
 * (game/interiors.ts and game/homes.ts built what they build). Then every listed house without a room gets a shut one.
 */
export function watchEmptyFronts(world: World, inWorld: InWorld, plans: Map<string, HousePlan>, ready: () => boolean): void {
  ctx = { world, inWorld, plans };
  const tick = () => {
    if (filled) return;
    if (ready()) fill();
    else window.setTimeout(tick, 1500);
  };
  tick();
}

/** Each frame from game/interiors.ts: the stand-ins' shutters by the clock (a shut shop: up but in the midday break), the chinks' light. */
export function updateStandIns(hour: number): void {
  shutterDaylight(hour);
  for (const s of standIns.values()) s.shutters?.set(shutUp(false, hour));
}

export interface FrontRow {
  id: string;
  house: number;
  kind: string;
  /** Cut open in city.glb (shared/inworld_build.json). */
  cut: boolean;
  /** Who built its room: its own use, the net's shut stand-in, or nothing. */
  room: "own" | "stand-in" | "none";
  windows: number;
  shutters: "none" | "up" | "down";
}

/**
 * The check (`__scheldemist.emptyfronts()`): every house cut open in the city and what stands behind its door and
 * windows. A problem is a listed or cut house with no plan or no room (a void at every hour), a cut house not in the
 * list, or a shop room whose windows have no shutters (a dark hole at night). `hours` walks the day: for each hour,
 * how many fronts show their room (open, or a shut room seen through its panes) and how many are shut behind shutters.
 */
export function emptyFrontsReport(): { fronts: number; rooms: number; standIns: number; problems: string[]; rows: FrontRow[]; hours: Array<{ h: number; void: number; shutters: number }> } | string {
  if (!ctx) return "the houses are not built yet";
  const built = new Set(ctx.inWorld.all.map((r) => r.id));
  const sh = allShutters();
  const problems: string[] = [];
  const rows: FrontRow[] = [];
  for (const e of ENTRIES) {
    const plan = ctx.plans.get(e.id);
    const room: FrontRow["room"] = standIns.has(e.id) ? "stand-in" : built.has(e.id) ? "own" : "none";
    const windows = plan ? plan.windows.filter((w) => w.kind === "hole").length : 0;
    const s = sh.get(e.id);
    const row: FrontRow = { id: e.id, house: e.house, kind: e.kind, cut: CUT.has(e.id), room, windows, shutters: s ? (s.up ? "up" : "down") : "none" };
    rows.push(row);
    const where = `${e.id} (house ${e.house})`;
    if (!plan) problems.push(`${where}: listed but no plan (pulled down or an odd footprint): cut open with nothing behind it`);
    else if (room === "none") problems.push(`${where}: cut open, no room behind its door and ${windows} window(s)${filled ? "" : " (the owners have not heard from the server yet)"}`);
    if (plan && e.kind === "shop" && windows > 0 && !s) problems.push(`${where}: a shop's ${windows} window(s) without shutters: a dark hole when it is shut at night`);
  }
  for (const id of CUT) if (!ENTRIES.some((e) => e.id === id)) problems.push(`${id}: cut open in city.glb (inworld_build.json) but not in inworld_houses.json: nothing builds its room`);
  // the day through: a front with no room shows a void at every hour; a shut shop at night shows its shutters
  const hours = Array.from({ length: 24 }, (_, h) => ({
    h,
    void: rows.filter((r) => r.room === "none").length,
    shutters: rows.filter((r) => r.kind === "shop" && r.room !== "none" && r.windows > 0 && sh.has(r.id) && (r.room === "stand-in" ? shutUp(false, h + 0.5) : h + 0.5 < 5 || h + 0.5 >= 20)).length,
  }));
  return { fronts: rows.length, rooms: rows.filter((r) => r.room !== "none").length, standIns: standIns.size, problems, rows, hours };
}
