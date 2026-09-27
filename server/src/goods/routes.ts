import type { Hono } from "hono";
import type { DB } from "../db.ts";
import { GOODS_BODY_MAX, GOODS_OPS, type GoodsAsk } from "../../../shared/goods.ts";
import { clock } from "../day.ts";
import { pid, positionOf } from "../player/current.ts";
import { RESET_HOOKS } from "../player/multi.ts";
import { Bucket } from "../mp/limits.ts";
import { gameMinute } from "../town/deeds.ts";
import { carryBackTick, installCarryBack, pickHand, startBack } from "./carryBack.ts";
import { goods, goodsHooks } from "./store.ts";

// M8f shared goods (docs/milestones/M8f.md): the PCs' requests. HTTP, not the movement socket: played alone there is
// no movement socket, and one path alone and together is the point (the server is the authority either way); a
// request carries the player's token already (M8c), and its answer (yes, or no with the item as it is) is what the
// PC needs to keep or undo what it showed at once. Goods change a few times a minute; the LAN answers in 1-10 ms.
// Every change goes to every PC over the push channel (index.ts broadcast: {type: "goods"}).

/** Requests a player may make (each PC): a lift and a put down are two; a hired crew's reports come a few at once. */
export const GOODS_RATE = { rate: 10, burst: 30 } as const;

export interface GoodsDeps {
  db: DB;
  broadcast: (m: unknown) => void;
}

export function mountGoods(app: Hono, d: GoodsDeps) {
  const { db } = d;
  goods.onPush((m) => d.broadcast(m));
  installCarryBack();
  // a new man on the ferry (M8d resetPlayer): what the old one held is set down where he was
  RESET_HOOKS.push((hdb, id) => void goods.playerLeft(id, positionOf(id), hdb));
  // after each tick of the world (alone the tab's; together the server's own: mp/index.ts answers a tab's tick itself)
  app.use("/api/tick", async (_c, next) => {
    await next();
    api.tick();
  });
  const limits = new Map<number, Bucket>();
  const limited = { n: 0 };

  app.get("/api/goods", (c) => c.json({ v: goods.v, you: pid(), items: goods.list() }));

  app.post("/api/goods", async (c) => {
    const me = pid();
    const now = Date.now();
    let b = limits.get(me);
    if (!b) limits.set(me, (b = new Bucket(GOODS_RATE.rate, GOODS_RATE.burst, now)));
    if (!b.take(now)) {
      limited.n++;
      return c.json({ ok: false, error: "Too many requests from this PC at once. Wait a moment and try again.", items: [] }, 429, { "retry-after": "1" });
    }
    const text = await c.req.text();
    if (text.length > GOODS_BODY_MAX) return c.json({ ok: false, error: "too large", items: [] }, 413);
    let ask: GoodsAsk;
    try {
      ask = JSON.parse(text) as GoodsAsk;
    } catch {
      return c.json({ ok: false, error: "bad request", items: [] }, 400);
    }
    if (!ask || typeof ask !== "object" || !(GOODS_OPS as readonly string[]).includes((ask as { op?: string }).op ?? "")) return c.json({ ok: false, error: "bad request", items: [] }, 400);
    const r = goods.ask(db, me, ask);
    if (!r.ok) return c.json({ ok: false, error: r.why, why: r.why, v: goods.v, items: r.items }, 409);
    return c.json({ ok: true, v: goods.v, items: r.items, gone: r.gone });
  });

  // dev (the test kit): the dray's next stage now, a man for the goods off their place now, the town's goods afresh
  app.post("/api/dev/goods", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { dray?: unknown; back?: unknown; reset?: unknown; move?: unknown };
    const out: Record<string, unknown> = {};
    if (b.reset === true) {
      goods.reset();
      out.reset = true;
    }
    if (typeof b.dray === "string") {
      if (!["out", "down", "back", "home"].includes(b.dray)) return c.json({ error: "dray: out, down, back or home" }, 400);
      out.dray = goods.drayStage(b.dray as "out" | "down" | "back" | "home", clock(db).day, db);
      out.state = goods.dray.state;
    }
    if (Array.isArray(b.move) && typeof b.move[0] === "string") {
      // an owned item off its place (as a player would leave it), for the carry-back
      out.moved = goods.moveGoods({ world: true }, String(b.move[0]), Number(b.move[1]), Number(b.move[2]), db);
    }
    if (typeof b.back === "string") {
      const it = goods.get(b.back);
      const npc = it ? pickHand(db, it.x, it.z) : null;
      out.back = npc ? startBack(db, npc, b.back) : null;
    }
    return c.json({ ...out, v: goods.v, items: goods.list() });
  });

  const api = {
    /** Each tick of the world (index.ts /api/tick): the ends of jobs, the dray's day, the men who carry goods back. */
    tick(): void {
      try {
        goods.sweep(db, Date.now(), (cart, id) => goodsHooks.cartHas(db, cart, id));
        const c = clock(db);
        goods.drayTick(c.day, c.hour * 60 + c.minute, db);
        carryBackTick(db);
      } catch (e) {
        console.warn("[goods] tick", e);
      }
    },
    stats: () => ({ v: goods.v, items: goods.list().length, ...goods.stats, limited: limited.n, minute: gameMinute(db) }),
  };
  return api;
}
