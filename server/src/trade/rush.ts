import type { DB } from "../db.ts";
import { clock } from "../day.ts";
import { settleExtras, takeHooks } from "../game.ts";
import { boardExtras, maxTier, TIER_PAY, type CarryTask, type JobRow } from "../hooks/jobBoard.ts";
import { walkDist } from "../hooks/loads.ts";
import { town } from "../town/store.ts";
import { millPay } from "../../../shared/mills.ts";
import { POST_BY_ID, postOpen } from "../../../shared/trade.ts";
import { tradeLedger, writeLedger } from "./ledger.ts";

// T3 trade (docs/milestones/T3-trade.md): a rush job from a shortage. In the morning, a bakery sold out while the other
// has bread to spare: its baker puts up a job on the board, "a crate of loaves from the other bakery, quick". Taken, the
// loaves are set aside at the other bakery (off its shelf); brought, they go on his shelf (what reached him). The pay
// is the mills' by the way and the load; a rush has its time (late: a quarter less, as every job). The engine's words,
// no model call.

/** The bakeries and their doors (job spots, shared/spots.json). */
const BAKERIES: Array<{ post: string; door: CarryTask["from"] }> = [
  { post: "bakery_steen", door: "bakery_steen_door" },
  { post: "bakery_rijn", door: "bakery_rijn_door" },
];
/** Loaves in a crate (a baker's crate of bread, carried by hand). */
export const RUSH_LOAVES = 12;
/** The morning a rush is asked for (from 6 until 11). */
const RUSH_FROM_H = 6;
const RUSH_UNTIL_H = 11;
/** The time a rush allows (real seconds: eight minutes, four game hours). */
const RUSH_LIMIT_S = 480;

interface RushMeta {
  post: string;
  from: string;
  /** Loaves set aside at the source when taken. */
  reserved?: number;
}

const metaOf = (j: JobRow): RushMeta | null => (j.source === "rush" ? ((j.task as unknown as { rush?: RushMeta } | null)?.rush ?? null) : null);

/** Put up a rush for a bakery sold out in the morning, the other one with bread to spare (one a bakery a day). */
export function offerRushJobs(db: DB): number[] {
  const c = clock(db);
  const h = c.hour + c.minute / 60;
  if (h < RUSH_FROM_H || h >= RUSH_UNTIL_H) return [];
  const l = tradeLedger(db);
  const out: number[] = [];
  const today = db.prepare("SELECT task_json FROM job WHERE source = 'rush' AND (day = ? OR status = 'taken')").all(c.day) as Array<{ task_json: string }>;
  const had = new Set(today.map((r) => (JSON.parse(r.task_json) as { rush?: RushMeta }).rush?.post));
  for (const b of BAKERIES) {
    const p = POST_BY_ID[b.post];
    if (!p || had.has(b.post) || !postOpen(p, c.day, h)) continue;
    if ((l.stock[b.post] ?? p.start) > p.floor + 2) continue;
    const src = BAKERIES.find((q) => q.post !== b.post)!;
    const sp = POST_BY_ID[src.post];
    if (!sp || (l.stock[src.post] ?? sp.start) < sp.order + RUSH_LOAVES) continue;
    const shops = town(db).town.shops;
    const baker = shops.find((s) => s.id === b.post)?.keeper;
    if (!baker) continue;
    const band = TIER_PAY[maxTier(db)];
    const pay = millPay(1, walkDist(src.door, b.door), false, band);
    const task: CarryTask & { rush: RushMeta } = { kind: "carry", goods: "crates", count: 1, from: src.door, to: b.door, twist: "none", limit_s: RUSH_LIMIT_S, rush: { post: b.post, from: src.post } };
    const title = `A rush: bread from ${sp.label}`;
    const pitch = `My shelves are bare and the morning is not half gone. Run to ${sp.label}: they have a crate of loaves for me. Bring it to my door, and quick.`;
    const district = (db.prepare("SELECT district FROM npc WHERE id = ?").get(baker) as { district: string } | undefined)?.district ?? "town";
    const faction = (db.prepare("SELECT faction FROM npc WHERE id = ?").get(baker) as { faction: string | null } | undefined)?.faction ?? null;
    const r = db
      .prepare(
        `INSERT INTO job (day, title, employer_npc, district, task_type, pay_c, risk, tier, required_faction, pitch, task_json, source, status)
         VALUES (?, ?, ?, ?, 'carry', ?, 'low', ?, ?, ?, ?, 'rush', 'offered')`,
      )
      .run(c.day, title, baker, district, pay, maxTier(db), faction, pitch, JSON.stringify(task));
    out.push(Number(r.lastInsertRowid));
  }
  return out;
}

// taken: the loaves are set aside at the other bakery (off its shelf)
takeHooks.push((db, j) => {
  const meta = metaOf(j);
  if (!meta || j.task?.kind !== "carry") return;
  const l = tradeLedger(db);
  const have = l.stock[meta.from] ?? 0;
  const got = Math.min(RUSH_LOAVES, Math.max(0, Math.floor(have)));
  l.stock[meta.from] = have - got;
  writeLedger(db, l);
  db.prepare("UPDATE job SET task_json = ? WHERE id = ?").run(JSON.stringify({ ...j.task, rush: { ...meta, reserved: got } }), j.id);
});

// settled: what reached his door goes on his shelf (a crate lost or sold is bread gone)
settleExtras.push((db, j, s) => {
  const meta = metaOf(j);
  if (!meta || j.task?.kind !== "carry") return;
  const brought = Number(/brought (\d+) of/.exec(s.facts[0] ?? "")?.[1] ?? j.task.progress?.delivered ?? 0);
  if (!brought) return;
  const p = POST_BY_ID[meta.post];
  if (!p) return;
  const l = tradeLedger(db);
  l.stock[meta.post] = Math.min(p.room, (l.stock[meta.post] ?? 0) + (meta.reserved ?? RUSH_LOAVES) * brought);
  writeLedger(db, l);
});

// after a new board, a rush that fits goes up with it
boardExtras.push((db) => void offerRushJobs(db));
