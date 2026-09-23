import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { resetTalks } from "../src/hooks/dialogue.ts";
import { remember, topMemories } from "../src/npcs.ts";
import { BARRACKS, GUARD_POSTS, generateGarrison, isGarrison } from "../src/town/garrison.ts";
import { generateTown, type Resident } from "../src/town/population.ts";
import { activityAt } from "../src/town/schedule.ts";
import { ensureGarrison, personaLine, setPersonaLine, town } from "../src/town/store.ts";
import { engineReply, residentChoice, residentOpen, residentPrompt } from "../src/town/talk.ts";
import { policeDispatch } from "../src/town/police.ts";
import { seeChance } from "../src/town/deeds.ts";
import { walkMap } from "../src/town/walkmap.ts";
import { validateProposal } from "../src/director/actions.ts";
import { gather, planEvent, stage } from "../src/director/scheduler.ts";

// The garrison and the customs (garrison.ts, Steve 2026-09-24): sentries in pairs at the
// railway gate, soldiers off duty in pairs, customs officers on the quays. They walk, stand
// and talk; they never fight or arrest.

const T = generateTown(1873);
const G = T.residents.filter((r) => isGarrison(r.trade));
const of = (t: string) => G.filter((r) => r.trade === t);
const at = (r: Resident, day: number, h: number) => activityAt(r.sched, day, h);
const setClock = (db: ReturnType<typeof openDb>, day: number, hour: number, minute = 0) =>
  db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);

beforeEach(() => resetTalks());

describe("the garrison and the customs", () => {
  it("are made by the engine from the town's seed, after the town, without changing it", () => {
    const again = generateTown(1873);
    expect(again.residents.map((r) => r.name)).toEqual(T.residents.map((r) => r.name));
    // the rest of the town comes first and keeps its ids; the garrison follows the last of them
    const firstG = T.residents.findIndex((r) => isGarrison(r.trade));
    const before = T.residents.slice(0, firstG);
    expect(before.some((r) => isGarrison(r.trade))).toBe(false);
    const maxBefore = Math.max(...before.filter((r) => /^r\d+$/.test(r.id)).map((r) => Number(r.id.slice(1))));
    for (const r of G) expect(Number(r.id.slice(1))).toBeGreaterThan(maxBefore);
    // unique names across the whole town, ids unique
    expect(new Set(T.residents.map((r) => r.name)).size).toBe(T.residents.length);
    expect(new Set(T.residents.map((r) => r.id)).size).toBe(T.residents.length);
  });

  it("three reliefs of two sentries and a corporal at each post; four pairs off duty; four customs officers", () => {
    expect(of("sentry").length).toBe(6 * GUARD_POSTS.length);
    expect(of("corporal").length).toBe(GUARD_POSTS.length);
    expect(of("soldier").length).toBe(8);
    expect(of("customs").length).toBe(4);
    for (const r of [...of("sentry"), ...of("soldier")]) {
      const mate = G.find((o) => o.id === r.mate)!;
      expect(mate, r.name).toBeTruthy();
      expect(mate.mate).toBe(r.id);
      expect(mate.trade).toBe(r.trade);
      expect(mate.sched).toEqual(r.sched); // a pair keeps one day
    }
    for (const r of G) {
      expect(r.age).toBeGreaterThanOrEqual(20);
      expect(r.origin, r.name).toBeTruthy();
      expect(r.faction).toBeNull();
      expect(["sentry", "soldier", "soldier_b", "customs"]).toContain(r.kind);
    }
  });

  it("sentries: always a pair at the post, relieved every two hours, the corporal out with each relief", () => {
    const sentries = of("sentry");
    const corporal = of("corporal")[0];
    for (const day of [2, 7]) {
      for (let h = 0; h < 24; h += 0.25) {
        const on = sentries.filter((r) => at(r, day, h).act === "work");
        expect(on.length, `day ${day} ${h}:00`).toBeGreaterThanOrEqual(2);
        expect(on.length).toBeLessThanOrEqual(4);
        // the rest are in the guard room: "home" is the guard room door
        for (const r of sentries.filter((r) => !on.includes(r))) expect(at(r, day, h).act).toBe("home");
      }
    }
    // a change of the guard: at 7:45 the old pair and the new pair are both out, and the corporal
    expect(sentries.filter((r) => at(r, 3, 7.75).act === "work").length).toBe(4);
    expect(at(corporal, 3, 7.75).act).toBe("work");
    // at 9:00 one pair stands, the corporal is in
    expect(sentries.filter((r) => at(r, 3, 9).act === "work").length).toBe(2);
    expect(at(corporal, 3, 9).act).toBe("home");
    // two on, four off: each man stands 8 hours in 4 tours (plus the half hour of each relief)
    for (const r of sentries) {
      let hours = 0;
      for (let h = 0; h < 24; h += 0.25) if (at(r, 4, h).act === "work") hours += 0.25;
      expect(hours).toBe(10);
    }
  });

  it("sentries stand at reachable spots, clear of the rails and the gate leaves, and face down the quay", () => {
    const wm = walkMap();
    for (const gp of GUARD_POSTS) {
      for (const [x, z] of [...gp.posts, gp.front]) {
        expect(wm.reachable(x, z), `${gp.id} ${x},${z}`).toBe(true);
        expect(wm.open(x, z, 0.4)).toBe(true);
        // the quay railway runs at z 4 into the gate: keep 2.4 m off its middle (a wagon is about 3 m wide)
        expect(Math.abs(z - 4)).toBeGreaterThan(2.4);
        // the gate leaves sweep x -311..-308.4, z 1.5..6.5 (world/railgate.ts)
        expect(x > -308.4 || z > 6.9).toBe(true);
      }
    }
    for (const r of of("sentry")) {
      expect(r.work.kind).toBe("guard");
      const [x, z, yaw] = r.work.at!;
      expect(GUARD_POSTS.some((g) => g.posts.some((p) => p[0] === x && p[1] === z))).toBe(true);
      expect(Math.sin(yaw)).toBeGreaterThan(0.9); // facing +x: down the Werf, away from the gate
      // the guard room is a real door, near the post, reachable
      expect(wm.reachable(r.home.sx, r.home.sz)).toBe(true);
      expect(Math.hypot(r.home.sx - x, r.home.sz - z)).toBeLessThan(20);
      expect(r.work.door).toEqual([r.home.sx, r.home.sz]);
    }
    expect(T.places["guardroom:railgate"]).toBeTruthy();
    expect(T.places["post:railgate"].label).toMatch(/railway gate/);
  });

  it("soldiers: drill in the barracks, walk out in pairs, a tavern in the evening, in by the tattoo", () => {
    const wm = walkMap();
    const soldiers = of("soldier");
    const b = T.places.barracks;
    expect(b.label).toBe(BARRACKS.label);
    expect(wm.reachable(b.x, b.z)).toBe(true);
    for (const r of soldiers) {
      expect([r.home.sx, r.home.sz]).toEqual([b.x, b.z]);
      expect(at(r, 2, 9).act).toBe("work"); // inside, at drill
      expect(r.work.kind).toBe("inside");
      expect(at(r, 2, 21.5).act).toBe("home");
      expect(at(r, 7, 21.5).act).toBe("home");
      expect(at(r, 2, 3).act).toBe("home");
      for (const [x, z] of r.work.route!) expect(wm.reachable(x, z)).toBe(true);
      expect(r.work.route!.length).toBeGreaterThanOrEqual(3);
    }
    // in the afternoon most pairs are out walking; in the evening they are at taverns
    expect(soldiers.filter((r) => at(r, 2, 15.75).act === "stroll").length).toBeGreaterThanOrEqual(4);
    const evening = soldiers.filter((r) => at(r, 2, 19.5).act === "tavern");
    expect(evening.length).toBe(8);
    for (const r of evening) expect(at(r, 2, 19.5).place).toBe(at(G.find((o) => o.id === r.mate)!, 2, 19.5).place);
    // Sunday: a walk in the afternoon
    expect(soldiers.filter((r) => at(r, 7, 14).act === "stroll").length).toBe(8);
  });

  it("customs officers: on their quay by day, landing to landing, facing the goods; home at night", () => {
    const wm = walkMap();
    for (const r of of("customs")) {
      expect(r.work.kind).toBe("inspect");
      expect(["rijnkaai", "werf", "bassin", "bassin_south"]).toContain(r.work.place);
      expect(r.work.route!.length).toBe(4);
      expect(r.work.faces!.length).toBe(4);
      for (const [x, z] of r.work.route!) expect(wm.reachable(x, z), `${r.name} ${x},${z}`).toBe(true);
      expect(at(r, 2, 10).act).toBe("work");
      expect(at(r, 2, 15).act).toBe("work");
      expect(at(r, 2, 23).act).toBe("home");
      expect(wm.reachable(r.home.sx, r.home.sz)).toBe(true);
    }
  });

  it("an older save gets the same garrison in place: nothing else changes, and only once", () => {
    const db = openDb(":memory:");
    // make it an older save: take the garrison (and the customs' wives) out again
    const all = town(db).town;
    // (the save lists residents by id; the generator's order has the garrison and the customs' wives last)
    const drop = T.residents.slice(T.residents.findIndex((r) => isGarrison(r.trade))).map((r) => r.id);
    const keepPlaces = Object.fromEntries(Object.entries(all.places).filter(([k]) => !/^(barracks|guardroom:|post:)/.test(k)));
    db.transaction(() => {
      for (const id of drop) {
        db.prepare("DELETE FROM resident WHERE id = ?").run(id);
        db.prepare("DELETE FROM npc_relationship WHERE npc_id = ?").run(id);
        db.prepare("DELETE FROM npc WHERE id = ?").run(id);
      }
      const { residents: _r, ...rest } = all;
      db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'town'").run(JSON.stringify({ ...rest, places: keepPlaces }));
    })();
    const someone = all.residents[3].id;
    remember(db, someone, "Jef carried a sack for me.", 6);
    setPersonaLine(db, someone, "A docker who hums.");
    db.prepare("UPDATE player SET money_c = 123 WHERE id = 1").run();
    const before = (db.prepare("SELECT id, data_json FROM resident ORDER BY id").all() as Array<{ id: string; data_json: string }>);
    // the town cache is stale after the raw deletes: ensureGarrison reads the rows itself
    const added = ensureGarrison(db);
    expect(added).toBe(drop.length);
    const t = town(db).town;
    expect(t.residents.filter((r) => isGarrison(r.trade)).map((r) => [r.id, r.name, r.trade])).toEqual(
      T.residents.filter((r) => isGarrison(r.trade)).map((r) => [r.id, r.name, r.trade]),
    );
    expect(t.places.barracks).toBeTruthy();
    expect(t.places["guardroom:railgate"]).toBeTruthy();
    const after = new Map((db.prepare("SELECT id, data_json FROM resident").all() as Array<{ id: string; data_json: string }>).map((r) => [r.id, r.data_json]));
    for (const b of before) expect(after.get(b.id)).toBe(b.data_json);
    expect(topMemories(db, someone, 8).some((m) => m.text === "Jef carried a sack for me.")).toBe(true);
    expect(personaLine(db, someone)).toBe("A docker who hums.");
    expect((db.prepare("SELECT money_c FROM player WHERE id = 1").get() as { money_c: number }).money_c).toBe(123);
    // every new man has his npc row and relationship, like any resident
    for (const r of t.residents.filter((r) => isGarrison(r.trade))) {
      expect(db.prepare("SELECT 1 FROM npc WHERE id = ?").get(r.id)).toBeTruthy();
      expect(db.prepare("SELECT 1 FROM npc_relationship WHERE npc_id = ?").get(r.id)).toBeTruthy();
    }
    expect(ensureGarrison(db)).toBe(0);
  });

  it("a new game has them from the start (ensureGarrison adds nothing)", () => {
    const db = openDb(":memory:");
    expect(town(db).town.residents.filter((r) => isGarrison(r.trade)).length).toBe(G.length);
    expect(ensureGarrison(db)).toBe(0);
  });
});

describe("they talk, and send Jef to the police", () => {
  it("a sentry opens with an engine line and offers the theft question; he sends Jef to the police post", async () => {
    const db = openDb(":memory:");
    setClock(db, 2, 10);
    const s = town(db).town.residents.find((r) => r.trade === "sentry" && activityAt(r.sched, 2, 10).act === "work")!;
    const open = residentOpen(db, s.id);
    expect(open.npc_line.length).toBeGreaterThan(0);
    expect(open.choices).toContain("I've been robbed. Will you help me?");
    // the engine answers the topic when the model is not called (budget or late): a runner that returns junk
    const junk = async () => ({ output: { nonsense: true } });
    const first = await residentChoice(db, s.id, "What are you guarding here?", junk);
    expect(first.npc_line).toMatch(/railway gate/);
    const r = await residentChoice(db, s.id, "I've been robbed. Will you help me?", junk);
    expect(r.npc_line).toMatch(/police post on the Grote Markt/);
    expect(r.npc_line).not.toMatch(/arrest|shoot|fight/i);
  });

  it("soldiers and customs officers answer the same: theft is for the police", () => {
    const db = openDb(":memory:");
    const t = town(db).town;
    for (const trade of ["soldier", "corporal", "customs"]) {
      const r = t.residents.find((o) => o.trade === trade)!;
      expect(engineReply(db, r, "theft", "x"), trade).toMatch(/police/);
    }
  });

  it("the prompt tells the model their duty, and that they never arrest or fight", () => {
    const db = openDb(":memory:");
    const t = town(db).town;
    const soldier = t.residents.find((o) => o.trade === "soldier")!;
    const p = residentPrompt(db, soldier, "Jef says hello.", []);
    expect(p).toMatch(/DUTY: a soldier of the line infantry/);
    expect(p).toMatch(/never fight and never arrest/);
    expect(p).toMatch(/police post on the Grote Markt/);
    expect(p).toContain(`From ${soldier.origin}.`);
    const customs = t.residents.find((o) => o.trade === "customs")!;
    expect(residentPrompt(db, customs, "Jef says hello.", [])).toMatch(/DUTY: a customs officer/);
    const docker = t.residents.find((o) => o.trade === "docker")!;
    expect(residentPrompt(db, docker, "Jef says hello.", [])).not.toMatch(/DUTY:/);
  });

  it("the police stay the only ones who come for a thief; a sentry is a sharp witness", () => {
    const db = openDb(":memory:");
    setClock(db, 2, 10);
    const gate = GUARD_POSTS[0].posts[0];
    const agent = policeDispatch(db, { x: gate[0], z: gate[1] });
    expect(agent).toBeTruthy();
    expect(town(db).byId.get(agent!)?.trade).toBe("police");
    const w = { id: "x", d: 10, los: true, facing: 1, owner: false };
    const ctx = { weather: "clear" as const, hour: 12, lantern: false, crouch: false };
    expect(seeChance(w, ctx, "sentry")).toBeGreaterThan(seeChance(w, ctx, "docker"));
    expect(seeChance(w, ctx, "sentry")).toBeLessThan(seeChance(w, ctx, "police"));
  });
});

describe("generateGarrison on its own", () => {
  it("gives the same men for the same town and seed", () => {
    const base = T.residents.slice(0, T.residents.findIndex((r) => isGarrison(r.trade)));
    const a = generateGarrison(1873, T.places, base);
    const b = generateGarrison(1873, T.places, base);
    expect(a.residents.map((r) => r.name)).toEqual(b.residents.map((r) => r.name));
    expect(a.residents.map((r) => r.id)).toEqual(T.residents.slice(base.length).map((r) => r.id));
  });
});

describe("M4: the guard stays at its post", () => {
  it("a sentry asked to go somewhere or follow Jef refuses: he cannot leave his post; a soldier off duty may", () => {
    const db = openDb(":memory:");
    setClock(db, 2, 10);
    const t = town(db).town;
    const prop = (kind: string, target = "") => ({ kind, target, minutes: 30, item: "", amount_c: 0, reason: "Jef was robbed" });
    for (const r of t.residents.filter((o) => o.trade === "sentry" || o.trade === "corporal")) {
      for (const kind of ["follow", "go_to", "fetch_police", "wait"]) {
        const v = validateProposal(db, r, prop(kind, kind === "go_to" ? "the Werf" : ""));
        expect(v.ok, `${r.trade} ${kind}`).toBe(false);
        if (!v.ok) expect(v.reason).toBe("post");
      }
    }
    const soldier = t.residents.find((o) => o.trade === "soldier")!;
    const v = validateProposal(db, soldier, prop("fetch_police"));
    if (!v.ok) expect(v.reason).not.toBe("post");
  });

  it("a gathering of onlookers never pulls a sentry or the corporal off guard", () => {
    const db = openDb(":memory:");
    setClock(db, 2, 10);
    const p = planEvent(db, { title: "A crowd at the gate", template: "quarrel", place: "werf", start_in_min: 0, stages: [stage({ op: "gather", minutes: 20, role: "crowd", count: 20 })], source: "engine" });
    expect(p.ok).toBe(true);
    const ev = p.ok ? p.event : null;
    const gp = GUARD_POSTS[0].posts[0];
    const picked = gather(db, ev!, "crowd", 20, { x: gp[0], z: gp[1] }, "the railway gate");
    expect(picked.length).toBeGreaterThan(0);
    for (const id of picked) expect(["sentry", "corporal"]).not.toContain(town(db).byId.get(id)!.trade);
  });
});
