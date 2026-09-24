import type { Hono } from "hono";
import type { DB } from "../db.ts";
import { plainEnglish } from "../text.ts";
import { haggle, installHaggle } from "./haggle.ts";
import { installStoryWord } from "./storyWord.ts";

// The HTTP side of haggling (M6). The haggle key in the shop list posts here; a price argued in the
// ordinary talk (talk.ts talkExtras.free) and a story told to an agent over a complaint go through
// /api/npc/:id/talk as before. Installing plugs both into buying and talk.

export interface HaggleDeps {
  db: DB;
  /** The payload every call returns (money, pockets, clock). */
  payload: () => Record<string, unknown>;
}

export function mountHaggle(app: Hono, deps: HaggleDeps): void {
  const { db, payload } = deps;
  installHaggle();
  installStoryWord();
  app.post("/api/npc/:id/haggle", async (c) => {
    const id = c.req.param("id");
    const b = (await c.req.json().catch(() => ({}))) as { kind?: unknown; text?: unknown };
    if (typeof b.kind !== "string" || typeof b.text !== "string") return c.json({ error: "kind and text wanted" }, 400);
    const r = await haggle(db, id, b.kind, b.text);
    if (!("npc_line" in r) || !r.npc_line) return c.json({ gated: r.gated ?? null });
    return c.json({
      npc_line: plainEnglish(r.npc_line),
      mood: r.mood,
      choices: (r.choices ?? []).map(plainEnglish),
      end: r.end_conversation,
      gated: r.gated ?? null,
      note: "note" in r ? r.note : undefined,
      wares: r.wares,
      ...payload(),
    });
  });
}
