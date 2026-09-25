import type { Hono } from "hono";
import type { DB } from "../db.ts";
import { GameError } from "../game.ts";
import { ackDropped, cartAt, cartHour, cartSeen, cartView, holdCart, loadCart, placeLent, unloadJob, unloadOne, type CartItem } from "./handcart.ts";

// The HTTP side of Jef's handcart (M6): what carts he has and what is on them, taking hold and
// letting go, loading and unloading, and the hour's work (a hire run out, a cart wheeled off).
// A household's cart is taken through the theft route (POST /api/deed, ref "cart:<household>").

export interface CartDeps {
  db: DB;
  payload: () => Record<string, unknown>;
  broadcast: (msg: unknown) => void;
}

export function mountHandcart(app: Hono, deps: CartDeps): void {
  const { db, payload, broadcast } = deps;
  app.use("/api/tick", async (_c, next) => {
    await next();
    try {
      if (cartHour(db).length) broadcast({ type: "jobs", ...payload() });
    } catch (e) {
      console.error("[handcart] tick", e);
    }
  });

  const body = async (c: { req: { json: () => Promise<unknown> } }) => ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const id = (raw: string) => {
    const v = `cart:${raw}`;
    if (!/^cart:[a-z0-9]{1,16}$/.test(v)) throw new GameError("bad cart", 400);
    return v;
  };
  const view = () => ({ ...payload(), carts: cartView(db) });

  app.get("/api/cart", (c) => c.json(cartView(db)));

  /** Where Jef is (every few seconds while he has a cart): a cart he stands by is watched. */
  app.post("/api/cart/seen", async (c) => {
    const b = await body(c);
    cartSeen(db, Number(b.x), Number(b.z));
    return c.json({ ok: true });
  });

  app.post("/api/cart/:id/hold", async (c) => {
    const b = await body(c);
    holdCart(db, id(c.req.param("id")), Number(b.x), Number(b.z));
    return c.json(view());
  });

  /** Where the pushed cart is now (held true), or where he let go of it (held false). */
  app.post("/api/cart/:id/at", async (c) => {
    const b = await body(c);
    cartAt(db, id(c.req.param("id")), Number(b.x), Number(b.z), Number(b.yaw), b.held === true);
    return c.json(b.held === true ? { ok: true } : view());
  });

  /** M7 short jobs: the lent cart moved once to where the client sees it fits (placeLent). */
  app.post("/api/cart/:id/place", async (c) => {
    const b = await body(c);
    placeLent(db, id(c.req.param("id")), Number(b.x), Number(b.z), Number(b.yaw));
    return c.json(view());
  });

  app.post("/api/cart/:id/load", async (c) => {
    const b = await body(c);
    const r = loadCart(db, id(c.req.param("id")), (b.item ?? {}) as Partial<CartItem>, Number(b.x), Number(b.z));
    return c.json({ ...view(), item: r.item });
  });

  app.post("/api/cart/:id/unload", async (c) => {
    const b = await body(c);
    if (b.job !== undefined && b.job !== null) {
      const r = unloadJob(db, id(c.req.param("id")), Number(b.job), Number(b.x), Number(b.z));
      return c.json({ ...view(), items: r.items });
    }
    const r = unloadOne(db, id(c.req.param("id")), Number(b.x), Number(b.z), b.index === undefined ? undefined : Number(b.index));
    return c.json({ ...view(), item: r.item });
  });

  app.post("/api/cart/dropped", async (c) => {
    const b = await body(c);
    const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Number.isFinite) : [];
    ackDropped(db, ids);
    return c.json({ ok: true });
  });
}
