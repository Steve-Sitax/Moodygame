import { describe, expect, it, vi } from "vitest";
import { blankSave } from "./blank-save.ts";
import { setWeather } from "../src/day.ts";
import { finishJob, takeJob } from "../src/game.ts";
import { jobById, TIER_PAY, type LampsTask } from "../src/hooks/jobBoard.ts";
import { lampHelpNow, lampRounds } from "../src/town/lamplighters.ts";
import { lampLit, lampLitHelped, roundState, SEEN_PACE } from "../src/town/lampround.ts";
import { buildLampJob, DONE_BY_H, expireLampJobs, LAMP_JOB_MAX, LAMP_JOB_MIN, LIGHT_S, lightLamp, offerLampJob, STRETCH_MAX_S, stretchOf, TAKE_BY_H, takePole } from "../src/town/lampjob.ts";
import { lampLightAt } from "../src/town/deeds.ts";

// The lamplighter's help (Steve 2026-09-28: "add a job as lamp lighter for the player and get paid. But you can only
// start lighting when needed and need to be done in a manageable amount of time"). The ENGINE's side: the stretch, the
// hours, the checks at each lamp, the lamps that wait for Jef, the pay by the lamps lit, the deadline.

type DB = ReturnType<typeof blankSave>;
const setClock = (db: DB, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const setHour = (db: DB, day: number, h: number) => setClock(db, day, Math.floor(h), Math.round((h % 1) * 60) % 60);
const money = (db: DB) => (db.prepare("SELECT money_c FROM player WHERE id = 1").get() as { money_c: number }).money_c;
const trust = (db: DB, f: string) => (db.prepare("SELECT trust FROM faction_trust WHERE faction = ?").get(f) as { trust: number }).trust;
const faction = (db: DB, id: string) => (db.prepare("SELECT faction FROM npc WHERE id = ?").get(id) as { faction: string }).faction;
const noReport = { delivered: 0, lost: 0, sold: 0, pocketed: false, late: false, left_post_s: 0, thief: "none" as const, bribe_taken: false, seen_away: false };

vi.setConfig({ testTimeout: 60_000 });

/** The day's job put up and taken at 15:00, and its task. */
function taken(db: DB, day = 2) {
  setClock(db, day, 15);
  setWeather(db, "clear");
  const id = offerLampJob(db)!;
  expect(id).toBeTypeOf("number");
  takeJob(db, id);
  const j = jobById(db, id)!;
  return { id, j, t: j.task as LampsTask };
}

describe("the lamplighter's help: the stretch", () => {
  it("a round gives a stretch of 5 to 10 lamps at its end, walked and lit within two and a half real minutes, never more than half the round; a round whose end does not fit gives none", () => {
    const db = blankSave();
    const rounds = lampRounds(db)!.rounds;
    expect(rounds.length).toBeGreaterThanOrEqual(3);
    let fit = 0;
    for (const r of rounds) {
      const n = r.lamps.length;
      const from = stretchOf(r);
      const walkOf = (k: number) => ((r.at[n - 1] - r.at[n - k]) * 1.1) / SEEN_PACE + k * LIGHT_S;
      if (from < 0) {
        expect(walkOf(LAMP_JOB_MIN), r.id).toBeGreaterThan(STRETCH_MAX_S);
        expect(buildLampJob(db, r.id), r.id).toBeNull();
        continue;
      }
      fit++;
      const k = n - from;
      expect(k, r.id).toBeGreaterThanOrEqual(LAMP_JOB_MIN);
      expect(k, r.id).toBeLessThanOrEqual(Math.min(LAMP_JOB_MAX, Math.floor(n / 2)));
      expect(walkOf(k), r.id).toBeLessThanOrEqual(STRETCH_MAX_S);
    }
    // the west, market and east rounds (the north round ends on the far Sint-Jansplein)
    expect(fit).toBeGreaterThanOrEqual(3);
  });

  it("the job: the lamplighter's own, the round's last lamps, the pole at the first, lighting from the round's dusk, all by 2.25 h later; paid within the band", () => {
    const db = blankSave();
    setClock(db, 2, 9);
    const j = buildLampJob(db, "market")!;
    const r = lampRounds(db)!.rounds.find((x) => x.id === "market")!;
    expect(j.employer).toBe(r.lamplighter);
    expect(j.task.lamps.map((l) => l.id)).toEqual(r.lamps.slice(stretchOf(r)).map((l) => l.id));
    expect(j.task.pole).toEqual({ x: j.task.lamps[0].sx, z: j.task.lamps[0].sz });
    // on whole minutes: from the first minute of the round's dusk
    expect(j.task.open).toBeGreaterThanOrEqual(r.dusk);
    expect(j.task.open - r.dusk).toBeLessThan(1 / 60);
    expect(j.task.until).toBeCloseTo(j.task.open + DONE_BY_H, 1);
    expect(j.task.take_by).toBeCloseTo(j.task.open + TAKE_BY_H, 1);
    for (const h of [j.task.open, j.task.until, j.task.take_by]) expect(Math.abs(h * 60 - Math.round(h * 60))).toBeLessThan(1e-6);
    const [lo, hi] = TIER_PAY[0];
    expect(j.pay_c).toBeGreaterThanOrEqual(lo);
    expect(j.pay_c).toBeLessThanOrEqual(hi);
    expect(j.pitch).toMatch(/\d+:\d\d/);
  });
});

describe("the lamplighter's help: on the board", () => {
  it("once a day, from 5:00 until a quarter hour before it can no longer be taken; not on a day that began in fog", () => {
    const db = blankSave();
    setClock(db, 2, 4);
    expect(offerLampJob(db)).toBeNull();
    setClock(db, 2, 9);
    setWeather(db, "clear");
    const id = offerLampJob(db);
    expect(id).toBeTypeOf("number");
    expect(offerLampJob(db)).toBeNull(); // once a day
    expect(jobById(db, id!)!.playable).toBe(true);
    // late in the day: nothing new
    const db2 = blankSave();
    setClock(db2, 2, 17, 30);
    setWeather(db2, "clear");
    expect(offerLampJob(db2)).toBeNull();
    // fog from the morning: the lamps burn all day
    const db3 = blankSave();
    setClock(db3, 3, 9);
    setWeather(db3, "fog");
    expect(offerLampJob(db3)).toBeNull();
  });

  it("taken too late: refused; left on the board past its hour: taken off", () => {
    const db = blankSave();
    setClock(db, 2, 9);
    setWeather(db, "clear");
    const id = offerLampJob(db)!;
    const t = jobById(db, id)!.task as LampsTask;
    setHour(db, 2, t.take_by + 0.05);
    expect(() => takeJob(db, id)).toThrow(/too late/);
    expect(expireLampJobs(db)).toBe(1);
    expect(jobById(db, id)!.status).toBe("expired");
  });
});

describe("the lamplighter's help: lighting", () => {
  it("the pole first, then each lamp at its foot and only from dusk: the engine checks the hour, the place and the pole", () => {
    const db = blankSave();
    const { id, t } = taken(db);
    const a = t.lamps[0];
    const far = t.lamps[t.lamps.length - 1];
    expect(() => lightLamp(db, id, a.id, { x: a.sx, z: a.sz })).toThrow(/pole/);
    expect(() => takePole(db, id, { x: far.sx + 50, z: far.sz })).toThrow(/not here/);
    expect(takePole(db, id, t.pole).text).toMatch(/from \d+:\d\d/);
    // before dusk: too early
    expect(() => lightLamp(db, id, a.id, { x: a.sx, z: a.sz })).toThrow(/too early/);
    setHour(db, 2, t.open + 0.1);
    // from the wrong place, or a lamp not his
    expect(() => lightLamp(db, id, a.id, { x: a.sx + 6, z: a.sz })).toThrow(/reach/);
    expect(() => lightLamp(db, id, "d99999", { x: a.sx, z: a.sz })).toThrow(/not one of yours/);
    const r = lightLamp(db, id, a.id, { x: a.sx + 1, z: a.sz });
    expect(r.left).toBe(t.lamps.length - 1);
    expect(lightLamp(db, id, a.id, { x: a.sx, z: a.sz }).text).toMatch(/already/);
    expect(lampHelpNow(db)!.lit).toEqual([a.id]);
    // past the deadline: too late
    setHour(db, 2, t.until + 0.02);
    expect(() => lightLamp(db, id, t.lamps[1].id, { x: t.lamps[1].sx, z: t.lamps[1].sz })).toThrow(/too late/);
  });

  it("the stretch waits for Jef: dark until he lights it (the plan would have lit it), burning once lit; at the deadline the plan takes over", () => {
    const db = blankSave();
    const { id, t } = taken(db);
    const r = lampRounds(db)!.rounds.find((x) => x.id === t.round)!;
    const last = r.lamps.length - 1;
    const help = () => lampHelpNow(db);
    // late in the window the plan has every lamp lit; with the help, the stretch waits
    const late = t.until - 0.01;
    expect(lampLit(r, last, late + 3, null)).toBe(true);
    expect(lampLitHelped(r, last, late, null, help(), 2)).toBe(false);
    // his round's own lamps keep the plan
    expect(lampLitHelped(r, 0, late, null, help(), 2)).toBe(lampLit(r, 0, late, null));
    takePole(db, id, t.pole);
    setHour(db, 2, t.open + 0.05);
    const l = t.lamps[t.lamps.length - 1];
    lightLamp(db, id, l.id, { x: l.sx, z: l.sz });
    expect(lampLitHelped(r, last, t.open + 0.06, null, help(), 2)).toBe(true);
    // the light the witnesses see follows the lamps (lit: a burning lamp; not lit: none there)
    const hour = t.open + 1.8; // near dark
    const other = t.lamps[1];
    expect(lampLightAt(db, l.x, l.z, hour)).toBeGreaterThan(0);
    expect(lampLightAt(db, other.x, other.z, hour)).toBe(0);
    // after the deadline the plan lights what he left
    expect(lampLitHelped(r, stretchOf(r) + 1, 20.95, null, help(), 2)).toBe(lampLit(r, stretchOf(r) + 1, 20.95, null));
    // another day: the plan
    expect(lampLitHelped(r, last, t.open + 0.06, null, help(), 3)).toBe(lampLit(r, last, t.open + 0.06, null));
  });

  it("the lamplighter's plan ends before the stretch: the plan has him past it only after the deadline", () => {
    const db = blankSave();
    const { t } = taken(db);
    const r = lampRounds(db)!.rounds.find((x) => x.id === t.round)!;
    // (the client stops him at the stretch while the help holds: game/lamplighter.ts)
    const s = roundState(r, t.open + 0.1, null);
    expect(s.done).toBeLessThan(stretchOf(r));
  });
});

describe("the lamplighter's help: the pay", () => {
  it("every lamp lit: the full pay and trust with the lamplighters; some: pay by the lamps; none by the deadline: failed and remembered", () => {
    const db = blankSave();
    const { id, j, t } = taken(db);
    takePole(db, id, t.pole);
    setHour(db, 2, t.open + 0.1);
    for (const l of t.lamps) lightLamp(db, id, l.id, { x: l.sx, z: l.sz });
    const f = faction(db, j.employer_npc);
    const m0 = money(db);
    const tr0 = trust(db, f);
    const s = finishJob(db, id, { ...noReport, delivered: t.lamps.length }).settlement;
    expect(s.pay_c).toBe(j.pay_c);
    expect(s.status).toBe("done");
    expect(money(db)).toBe(m0 + j.pay_c);
    expect(trust(db, f)).toBe(tr0 + 1);

    // half lit: pay by the engine's count, whatever the client claims
    const db2 = blankSave();
    const b = taken(db2);
    takePole(db2, b.id, b.t.pole);
    setHour(db2, 2, b.t.open + 0.1);
    const half = Math.floor(b.t.lamps.length / 2);
    for (const l of b.t.lamps.slice(0, half)) lightLamp(db2, b.id, l.id, { x: l.sx, z: l.sz });
    const s2 = finishJob(db2, b.id, { ...noReport, delivered: 10 }).settlement;
    expect(s2.pay_c).toBe(Math.round((b.j.pay_c * half) / b.t.lamps.length / 5) * 5);

    // nothing lit by the deadline: the tick fails it, the lamplighter remembers, the stretch is the plan's again
    const db3 = blankSave();
    const c = taken(db3);
    setHour(db3, 2, c.t.until + 0.3);
    expect(expireLampJobs(db3)).toBe(1);
    expect(jobById(db3, c.id)!.status).toBe("failed");
    const mem = db3.prepare("SELECT text FROM npc_memory WHERE npc_id = ? ORDER BY id DESC LIMIT 1").get(c.j.employer_npc) as { text: string } | undefined;
    expect(mem?.text ?? "").toMatch(/lamps/);

    // some lit by the deadline and never reported: the tick settles it by the lamps lit
    const db4 = blankSave();
    const d = taken(db4);
    takePole(db4, d.id, d.t.pole);
    setHour(db4, 2, d.t.open + 0.1);
    const l0 = d.t.lamps[0];
    lightLamp(db4, d.id, l0.id, { x: l0.sx, z: l0.sz });
    const m4 = money(db4);
    setHour(db4, 2, d.t.until + 0.3);
    expect(expireLampJobs(db4)).toBe(1);
    expect(jobById(db4, d.id)!.status).toBe("done");
    expect(money(db4)).toBeGreaterThan(m4);
  });
});
