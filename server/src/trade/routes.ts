import type { Hono } from "hono";
import type { DB } from "../db.ts";
import { boughtHooks, sellerPrice } from "../trade.ts";
import { millEventHooks } from "../town/mills.ts";
import { goodsHooks } from "../goods/store.ts";
import { HAUL_ROUTES } from "../../../shared/hauls.ts";
import { POST_BY_ID } from "../../../shared/trade.ts";
import { DEV } from "../config.ts";
import { townTalk } from "../hooks/dialogue.ts";
import { fishBoxIn, onMillEvents, tradeBought, tradeLedger, tradePrice, tradeView, writeLedger } from "./ledger.ts";

// T3 trade: the posts' ledger wired into the mills (the bake), the goods (the fish boxes), the prices and the buying;
// GET /api/trade for the map, the talk and the checks; stepped on every tick with the clock.

let installed = false;
export function installTrade(): void {
  if (installed) return;
  installed = true;
  sellerPrice.push(tradePrice);
  boughtHooks.push(tradeBought);
  millEventHooks.push(onMillEvents);
  // the talk: a shelf gone short is news (the baker complains, the fishwives shrug)
  townTalk.push((db) =>
    tradeView(db)
      .filter((p) => p.short)
      .map((p) => (p.stock <= p.floor ? `${p.label[0].toUpperCase()}${p.label.slice(1)} has hardly any ${p.good} left, and asks more for it.` : `${p.label[0].toUpperCase()}${p.label.slice(1)} is running low on ${p.good}.`)),
  );
  const prev = goodsHooks.hauledIn;
  goodsHooks.hauledIn = (db, route) => {
    prev(db, route);
    if (HAUL_ROUTES.find((r) => r.id === route)?.place === "vismarkt") fishBoxIn(db);
  };
}

export function mountTrade(app: Hono, deps: { db: DB }): void {
  const { db } = deps;
  installTrade();
  app.get("/api/trade", (c) => c.json({ posts: tradeView(db), runs: tradeLedger(db).runs ?? [] }));
  // dev (the test kit): set a post's shelf, and look again at the next read
  if (DEV)
    app.post("/api/dev/trade", async (c) => {
      const b = (await c.req.json().catch(() => ({}))) as { post?: string; stock?: number };
      const p = b.post ? POST_BY_ID[b.post] : null;
      if (!p || typeof b.stock !== "number" || !Number.isFinite(b.stock)) return c.json({ error: "post and stock" }, 400);
      const l = tradeLedger(db);
      l.stock[p.id] = Math.max(0, Math.min(p.room, b.stock));
      l.looked = undefined;
      writeLedger(db, l);
      return c.json({ posts: tradeView(db), runs: tradeLedger(db).runs ?? [] });
    });
  app.use("/api/tick", async (_c, next) => {
    await next();
    try {
      tradeLedger(db);
    } catch (e) {
      console.warn("[trade] tick", e);
    }
  });
}
