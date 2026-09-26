import type { Hono } from "hono";
import type { DB } from "../db.ts";
import { GameError } from "../game.ts";
import { town } from "../town/store.ts";
import { atWork, waresOf } from "../trade.ts";
import { shopNow } from "./state.ts";
import { shopsRecord } from "./town.ts";
import { shopTrade } from "../../../shared/shops.ts";

// M7 shops: the HTTP side (mounted by index.ts). Where the shops are and which are open; who is inside one.
// Buying goes through the ordinary trade route (/api/npc/:id/buy) at the keeper, as before.

export interface ShopDeps {
  db: DB;
}

export function mountShops(app: Hono, deps: ShopDeps): void {
  const { db } = deps;

  app.get("/api/shops", (c) => {
    const t = town(db).town;
    const shops = t.shops.map((s) => {
      const keeper = t.residents.find((r) => r.id === s.keeper);
      return {
        place: s.id,
        label: s.label,
        trade: shopTrade(s.id),
        door: s.door,
        wall: s.wall,
        out: s.out,
        goods: s.goods,
        open: !!keeper && atWork(db, keeper.id),
        keeper: keeper ? { id: keeper.id, name: keeper.name, first: keeper.first, kind: keeper.kind, sex: keeper.sex } : null,
        wares: keeper ? waresOf(db, keeper.id) : [],
      };
    });
    return c.json({ shops, record: shopsRecord(db) });
  });

  app.get("/api/shop/:place", (c) => {
    const now = shopNow(db, c.req.param("place"));
    if (!now) throw new GameError("no such shop", 404);
    return c.json(now);
  });
}
