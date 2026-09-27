import type { Context, Hono } from "hono";
import type { DB } from "../db.ts";
import { job } from "../game.ts";
import { DEV } from "../config.ts";
import { remember } from "../npcs.ts";
import { pid } from "../player/current.ts";
import { writeEvent } from "../director/eventlog.ts";
import { resident } from "./store.ts";
import { NIGHT_GIVERS } from "./places.ts";
import { callTrouble, maybeTrouble, troubleOf } from "../ideas/trouble.ts";
import {
  CALL_ROLES,
  CALL_WHYS,
  callResponder,
  comings,
  endCall,
  mayShadow,
  policeWithin,
  shadowFacts,
  shadowStep,
  type CallRole,
  type CallWhy,
} from "./walkup.ts";

// M7 walk-up, the routes (town/walkup.ts has the rules). The client asks when a job needs someone
// (the run's own clock says when a twist is due); the ENGINE says who comes, whether they run, or
// "wait". The client walks them up from where they are and says when it is done with them.

interface Deps {
  db: DB;
}

async function body(c: Context): Promise<Record<string, unknown>> {
  try {
    const b = (await c.req.json()) as unknown;
    return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
const at = (b: Record<string, unknown>) => {
  const x = Number(b.x);
  const z = Number(b.z);
  return Number.isFinite(x) && Number.isFinite(z) ? { x: Math.max(-2000, Math.min(2000, x)), z: Math.max(-2000, Math.min(2000, z)) } : null;
};

/** A load no honest man carries (Tuur's "no questions" parcels, the night's work). */
export function shadyJob(j: { employer_npc: string; source: string }): boolean {
  return j.employer_npc === "tuur" || j.source === "night" || NIGHT_GIVERS.some((g) => g.id === j.employer_npc);
}

export function mountWalkup(app: Hono, deps: Deps): void {
  const { db } = deps;

  app.get("/api/walkup", (c) =>
    c.json({
      coming: comings(db).map((a) => ({ id: a.id, npc: a.npc_id, name: resident(db, a.npc_id)?.name ?? a.npc_id, phase: a.phase, x: a.target_x, z: a.target_z, data: JSON.parse(a.data_json) as unknown })),
    }),
  );

  // someone for a job: the nearest fitting person, or wait
  app.post("/api/walkup/call", async (c) => {
    const b = await body(c);
    const p = at(b);
    const role = String(b.role) as CallRole;
    const why = String(b.why) as CallWhy;
    if (!p || !CALL_ROLES.includes(role) || !CALL_WHYS.includes(why)) return c.json({ ok: false, wait: true, why: "bad call" }, 400);
    const ref = String(b.ref ?? "").slice(0, 60);
    if (!/^(job|gang|quest):[\w:-]+$/.test(ref)) return c.json({ ok: false, wait: true, why: "bad ref" }, 400);
    return c.json(callResponder(db, { role, why, ref, at: p }));
  });

  // the trouble on a job is due: the one it is about comes
  app.post("/api/walkup/trouble/:id", async (c) => {
    const p = at(await body(c));
    if (!p) return c.json({ ok: false, wait: true, why: "bad place" }, 400);
    return c.json(callTrouble(db, Number(c.req.param("id")), p));
  });

  // Jef took a load: does anyone start following him? (the engine rolls, once a job)
  app.post("/api/walkup/shadow", async (c) => {
    const b = await body(c);
    const p = at(b);
    const id = Number(b.job_id);
    if (!p || !Number.isInteger(id)) return c.json({ ok: false }, 400);
    const j = job(db, id);
    // (M8c: his own job in hand)
    if (j.status !== "taken" || (j.taken_by ?? 1) !== pid() || !j.task) return c.json({ ok: false });
    const goods = (j.task as { goods?: string }).goods ?? "";
    const r = mayShadow(db, { ref: `job:${id}`, goods, shady: shadyJob(j), at: p });
    return c.json(r ?? { ok: false });
  });

  // a follower's step: the engine's rule (keep, linger, close in, break off)
  app.post("/api/walkup/shadow/:id/step", async (c) => {
    const b = await body(c);
    const id = Number(c.req.param("id"));
    const f = shadowFacts(db, id, { moving: b.moving === true, carrying: b.carrying === true });
    if (!f) return c.json({ move: { kind: "break_off", why: "lost him" } });
    const move = shadowStep(f);
    let trouble: number | null = null;
    // a customs man closing in stops the load: the customs trouble of the job, with him in it
    if (move.kind === "close_in" && f.role === "customs") {
      const a = comings(db).find((x) => x.id === id);
      const jobId = Number(/^job:(\d+):/.exec((JSON.parse(a?.data_json ?? "{}") as { ref?: string }).ref ?? "")?.[1]);
      const r = a ? resident(db, a.npc_id) : null;
      if (a && r && Number.isInteger(jobId) && !troubleOf(db, jobId)) {
        void maybeTrouble(db, jobId, { force: "customs", who: { id: r.id, name: r.name }, afterS: 0 }).catch((e) => console.error("[walkup] trouble", e));
      }
      trouble = Number.isInteger(jobId) ? (troubleOf(db, jobId)?.id ?? null) : null;
    }
    return c.json({ move, facts: f, trouble });
  });

  // the thief who closed in reaches Jef: does he get the load? (the engine: never with an agent in sight,
  // never a parcel in an inside pocket; goods in the hands, yes)
  app.post("/api/walkup/shadow/:id/snatch", async (c) => {
    const b = await body(c);
    const id = Number(c.req.param("id"));
    const a = comings(db).find((x) => x.id === id);
    const p = at(b);
    if (!a || !p) return c.json({ taken: false, why: "gone" });
    const r = resident(db, a.npc_id);
    const police = policeWithin(db, p);
    const inHands = b.hands === true;
    const taken = !police && inHands && b.shouted !== true;
    if (r) {
      writeEvent(db, { kind: "theft", verb: taken ? "load_snatched" : "load_tried", actor: r.id, target: "player", x: p.x, z: p.z, text: taken ? `${r.name} followed Jef and snatched the load from his hands in a quiet street.` : `${r.name} followed Jef with an eye on his load, and thought better of it.`, weight: taken ? 5 : 3, who: [r.id] });
      if (taken) {
        remember(db, r.id, "I followed the new day labourer and had his load off him in a quiet street.", 5);
      }
    }
    return c.json({ taken, why: police ? "police" : !inHands ? "pocket" : b.shouted === true ? "shouted" : "taken" });
  });

  if (DEV) {
    /** Dev: someone follows Jef for this job now (the roll skipped; `shady` as for a night load: a customs man at night). */
    app.post("/api/dev/walkup/shadow", async (c) => {
      const b = await body(c);
      const p = at(b);
      const id = Number(b.job_id);
      if (!p || !Number.isInteger(id)) return c.json({ ok: false }, 400);
      const j = job(db, id);
      const goods = (j.task as { goods?: string } | null)?.goods ?? "parcel";
      const r = mayShadow(db, { ref: `job:${id}`, goods: "parcel", shady: b.shady === true || shadyJob(j), at: p, seeM: Math.min(300, Number(b.see) || 40) }, () => 0);
      return c.json(r ?? { ok: false, why: `nobody near to follow (${goods})` });
    });
  }

  // the job is done with them
  app.post("/api/walkup/:id/done", async (c) => {
    const b = await body(c);
    return c.json({ ok: endCall(db, Number(c.req.param("id")), String(b.outcome ?? "done")) });
  });
}
