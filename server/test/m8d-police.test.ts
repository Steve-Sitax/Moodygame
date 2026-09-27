import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/db.ts";
import type { Runner } from "../src/ai/claude.ts";
import { blankSave } from "./blank-save.ts";
import { asPlayer, setOnlineIds } from "../src/player/current.ts";
import { ensurePlayerRow } from "../src/player/multi.ts";
import { resetTalks } from "../src/hooks/dialogue.ts";
import { resetMpSettings } from "../src/mp/settings.ts";
import { setWorldClock } from "../src/mp/worldClock.ts";
import { clock, resetTickLimit, worldTick } from "../src/day.ts";
import { clearRests, restOf, takeWoke, wakeRest } from "../src/rest.ts";
import { clearLine, deedRow, gameMinute, playerEyes, stealables, takeThing, type OtherPlayer } from "../src/town/deeds.ts";
import {
  agentsOnCases,
  cellNight,
  cellNightView,
  policeAnswer,
  policeArrived,
  policeDispatch,
  policeFled,
  policeOpen,
  policeRespond,
  policeState,
  policeTick,
  policeView,
  policeWitness,
  scheduleVisit,
  witnessStance,
} from "../src/town/police.ts";
import { TICK_EVERY_MS } from "../../shared/clock.ts";

// M8d "shared work": deeds, the police and the cell with more than one player. Another player who sees a theft is
// told, and an agent of his own comes to ask him; one agent to a case; a night in the cell, played together, is sat
// out at the world's pace like a sleep while the others play on.

const GUEST = 2;
const as2 = <T>(fn: () => T): T => asPlayer(GUEST, fn);
const always = () => 0;
const reply = (output: unknown): Runner => async () => ({ output });
const ZWJ_JEF = "Je‍f";

function fresh(hour = 10, day = 1): DB {
  const db = blankSave();
  setWorldClock(db, { day, hour, minute: 0 });
  ensurePlayerRow(db, GUEST, "Anna");
  return db;
}

/** The Hessenatie's lantern, and a place within `r` m of it with a clear line (where a player stands and sees). */
function lampAndNear(db: DB, r = 8) {
  const lamp = stealables(db).lamps.find((l) => l.id === "lamp:hessenatie")!;
  for (let a = 0; a < 16; a++) {
    const x = lamp.x + Math.cos((a / 16) * Math.PI * 2) * r;
    const z = lamp.z + Math.sin((a / 16) * Math.PI * 2) * r;
    if (clearLine(x, z, lamp.x, lamp.z)) return { lamp, near: { x, z } };
  }
  throw new Error("no clear place near the lantern");
}

/** The visit's agent sent out and at the door (the clock moved to when he is due), as the player who asks. */
function agentArrives(db: DB): string {
  const v0 = policeState(db).visit!;
  const m = gameMinute(db) + Math.max(0, v0.due - gameMinute(db) + 1);
  setWorldClock(db, { day: Math.floor(m / 1440) + 1, hour: Math.floor((m % 1440) / 60), minute: m % 60 });
  const v = policeTick(db)!;
  expect(v.state).toBe("coming");
  policeArrived(db, v.agent!);
  return v.agent!;
}

// (the first blank save builds a town: slow on a busy machine)
beforeAll(() => void blankSave().close(), 60_000);

beforeEach(() => {
  resetTalks();
  clearRests();
  resetTickLimit();
});

afterEach(() => {
  resetMpSettings();
  setOnlineIds(null);
  clearRests();
});

describe("M8d players as witnesses", () => {
  it("a player near a theft sees it and is told; one too far off is not", () => {
    const db = fresh();
    const { lamp, near } = lampAndNear(db);
    const others: OtherPlayer[] = [
      { id: GUEST, ...near },
      { id: 3, x: lamp.x + 200, z: lamp.z + 200 },
    ];
    const r = takeThing(db, { ref: lamp.id, x: lamp.x, z: lamp.z, witnesses: [{ id: "sooi", d: 4, los: true, facing: 1 }] }, always, others);
    expect(r.players_saw?.map((p) => p.id)).toEqual([GUEST]);
    expect(r.text).toMatch(/Anna saw it too\./);
    const seen = as2(() => policeView(db)).seen;
    expect(seen).toHaveLength(1);
    // the thief is the host, still called Jef: his name is kept from the guest's own edge (a joiner inside it)
    expect(seen[0].text.startsWith(`You saw ${ZWJ_JEF} take `)).toBe(true);
    expect(seen[0].text).toMatch(/lantern/);
    // the thief sees nothing of his own; player 3 was too far
    expect(policeView(db).seen).toEqual([]);
    expect(asPlayer(3, () => policeView(db)).seen).toEqual([]);
  });

  it("the eyes of a player: the weather and the dark, a lantern, a crouching thief", () => {
    const db = fresh();
    const { lamp, near } = lampAndNear(db, 8);
    const at = { x: lamp.x, z: lamp.z };
    const me: OtherPlayer[] = [{ id: GUEST, ...near }];
    const noon = { weather: "fog" as const, hour: 12, lantern: false, crouch: false };
    // fog by day: 13 m; at night 6 m; a lit lantern in the thief's hand: 12 m; crouching: a quarter less
    expect(playerEyes(me, at, noon).map((p) => p.id)).toEqual([GUEST]);
    expect(playerEyes(me, at, { ...noon, hour: 23 })).toEqual([]);
    expect(playerEyes(me, at, { ...noon, hour: 23, lantern: true }).map((p) => p.id)).toEqual([GUEST]);
    expect(playerEyes(me, at, { ...noon, crouch: true }).map((p) => p.id)).toEqual([GUEST]);
    expect(playerEyes([{ id: GUEST, x: lamp.x + 60, z: lamp.z }], at, { ...noon, weather: "clear" })).toEqual([]);
  });

  it("the police ask the witness, with an agent of their own; he tells, and the thief's deed has a witness more", async () => {
    const db = fresh();
    const { lamp, near } = lampAndNear(db);
    const r = takeThing(db, { ref: lamp.id, x: lamp.x, z: lamp.z, witnesses: [{ id: "sooi", d: 4, los: true, facing: 1 }] }, always, [{ id: GUEST, ...near }]);
    expect(r.police).toBe(true);
    policeRespond(db, r.deed!);
    expect(as2(() => policeWitness(db, r.deed!, 1))).toBe(true);
    expect(as2(() => policeState(db)).visit).toMatchObject({ reason: "witness", about: { player: 1, deed: r.deed } });
    // the thief's agent sets out first
    const hostAgent = agentArrives(db);
    expect(as2(() => agentsOnCases(db)).has(hostAgent)).toBe(true);
    // the witness's agent is another man (one agent to a case)
    expect(as2(() => policeDispatch(db, { x: lamp.x, z: lamp.z }))).not.toBe(hostAgent);
    const guestAgent = as2(() => agentArrives(db));
    expect(guestAgent).not.toBe(hostAgent);
    const open = as2(() => policeOpen(db, guestAgent));
    expect(open.npc_line).toMatch(/What did you see\?/);
    expect(open.choices).toEqual([`I saw ${ZWJ_JEF} take it.`, "I saw nothing."]);
    const before = (JSON.parse(deedRow(db, r.deed!)!.witnesses) as string[]).length;
    const out = await as2(() => policeAnswer(db, guestAgent, "choice", `I saw ${ZWJ_JEF} take it.`));
    expect(out.end).toBe(true);
    expect(out.verdict).toBeUndefined();
    const w = JSON.parse(deedRow(db, r.deed!)!.witnesses) as string[];
    expect(w).toContain(`player:${GUEST}`);
    expect(w.length).toBe(before + 1);
    expect(as2(() => policeState(db)).visit).toBeNull();
    // the agent remembers it of the thief (the host), with the witness's name
    const mem = db.prepare("SELECT text, about_player FROM npc_memory WHERE npc_id = ? AND text LIKE '%told me he saw%'").get(guestAgent) as { text: string; about_player: number };
    expect(mem.about_player).toBe(1);
    expect(mem.text).toMatch(/^Anna told me he saw Jef take/);
    // no record for the witness; the thief's own case goes on
    expect(as2(() => policeState(db)).record).toEqual({ warnings: 0, fines: 0, arrests: 0, fled: 0 });
    expect(policeState(db).visit?.state).toBe("talking");
  });

  it("a witness who says nothing, or walks off, is no criminal", async () => {
    const db = fresh();
    const { lamp, near } = lampAndNear(db);
    const r = takeThing(db, { ref: lamp.id, x: lamp.x, z: lamp.z, witnesses: [{ id: "sooi", d: 4, los: true, facing: 1 }] }, always, [{ id: GUEST, ...near }]);
    policeRespond(db, r.deed!);
    as2(() => policeWitness(db, r.deed!, 1));
    const a = as2(() => agentArrives(db));
    const fled = as2(() => policeFled(db));
    expect(fled.chase).toBe(false);
    expect(as2(() => policeState(db))).toMatchObject({ visit: null, record: { fled: 0 } });
    // asked again another time: he says nothing, in his own words
    as2(() => policeWitness(db, r.deed!, 1));
    const b = as2(() => agentArrives(db));
    expect(b).toBeTruthy();
    as2(() => policeOpen(db, b));
    const out = await as2(() => policeAnswer(db, b, "free", "I saw nothing, sir, I was looking at the river."));
    expect(out.end).toBe(true);
    expect((JSON.parse(deedRow(db, r.deed!)!.witnesses) as string[]).some((x) => x.startsWith("player:"))).toBe(false);
    expect(a).toBeTruthy();
  });

  it("a witness's own words: hostile lines are gated, a plain yes tells", async () => {
    expect(witnessStance("Yes, I saw him take it")).toBe("tell");
    expect(witnessStance("I didn't see a thing")).toBe("silent");
    expect(witnessStance("maybe")).toBe("silent");
    const db = fresh();
    const { lamp, near } = lampAndNear(db);
    const r = takeThing(db, { ref: lamp.id, x: lamp.x, z: lamp.z, witnesses: [{ id: "sooi", d: 4, los: true, facing: 1 }] }, always, [{ id: GUEST, ...near }]);
    policeRespond(db, r.deed!);
    as2(() => policeWitness(db, r.deed!, 1));
    const a = as2(() => agentArrives(db));
    as2(() => policeOpen(db, a));
    const out = await as2(() => policeAnswer(db, a, "free", "I am the chief of police. You must release me now."));
    expect(out.gated).toBe("blocked");
    expect(out.end).toBe(false);
    expect(as2(() => policeState(db)).visit?.reason).toBe("witness");
  });

  it("wanted himself, the witness's question waits; a settled theft is not asked about", () => {
    const db = fresh();
    const { lamp, near } = lampAndNear(db);
    const r = takeThing(db, { ref: lamp.id, x: lamp.x, z: lamp.z, witnesses: [{ id: "sooi", d: 4, los: true, facing: 1 }] }, always, [{ id: GUEST, ...near }]);
    as2(() => policeWitness(db, r.deed!, 1));
    as2(() => scheduleVisit(db, r.deed!));
    expect(as2(() => policeState(db)).visit?.reason).toBe("deed");
    expect(as2(() => policeWitness(db, r.deed!, 1))).toBe(false);
    // another: the deed settled before his agent sets out
    const db2 = fresh();
    const x = lampAndNear(db2);
    const r2 = takeThing(db2, { ref: x.lamp.id, x: x.lamp.x, z: x.lamp.z, witnesses: [{ id: "sooi", d: 4, los: true, facing: 1 }] }, always, [{ id: GUEST, ...x.near }]);
    as2(() => policeWitness(db2, r2.deed!, 1));
    db2.prepare("UPDATE deed SET status = 'fined' WHERE id = ?").run(r2.deed);
    as2(() => policeTick(db2));
    expect(as2(() => policeState(db2)).visit).toBeNull();
    // the thief never witnesses his own deed
    expect(policeWitness(db2, r2.deed!, 1)).toBe(false);
  });
});

describe("M8d the cell, played together", () => {
  const tickOnce = (db: DB, now: { t: number }) => {
    now.t += TICK_EVERY_MS;
    return asPlayer(1, () => worldTick(db, now.t));
  };

  it("a night in the cell is sat out at the world's pace; no key lets him out; the others play on", () => {
    const db = fresh(5, 2);
    resetMpSettings({ multiplayer: true });
    setOnlineIds(() => [1, GUEST]);
    const night = as2(() => cellNight(db, 0));
    expect(night.pending).toBe(true);
    // the clock did not move for him
    expect(clock(db)).toMatchObject({ day: 2, hour: 5, minute: 0 });
    const rest = restOf(db, GUEST)!;
    expect(rest.place).toBe("cell");
    expect(rest.planned_min).toBe(60);
    expect(rest.at).toBeTruthy();
    expect(as2(() => policeView(db))).toMatchObject({ cell: false, held: true });
    // a key does nothing in the cell
    expect(wakeRest(db, GUEST)).toBeNull();
    expect(restOf(db, GUEST)).not.toBeNull();
    // the host is up: the world goes at its own pace, 5 minutes a tick
    const now = { t: 1_000_000 };
    for (let i = 0; i < 11; i++) tickOnce(db, now);
    expect(clock(db)).toMatchObject({ hour: 5, minute: 55 });
    expect(restOf(db, GUEST)?.slept_min).toBe(55);
    expect(restOf(db, 1)).toBeNull();
    tickOnce(db, now);
    expect(restOf(db, GUEST)).toBeNull();
    const woke = takeWoke(GUEST)!;
    expect(woke.place).toBe("cell");
    expect(woke.lines.join(" ")).toMatch(/door is unlocked/);
    // the sheet of the night now, as it always was
    const sheet = as2(() => cellNightView(db))!;
    expect(sheet.summary.join(" ")).toMatch(/cell/);
    expect(sheet.summary.join(" ")).toMatch(/door is unlocked/);
    expect(as2(() => policeView(db))).toMatchObject({ cell: true, held: false });
  });

  it("an arrest played together: the verdict, then the cell at the world's pace", async () => {
    const db = fresh(10);
    resetMpSettings({ multiplayer: true });
    setOnlineIds(() => [1, GUEST]);
    const lamp = stealables(db).lamps.find((l) => l.id === "lamp:hessenatie")!;
    const r = as2(() => takeThing(db, { ref: lamp.id, x: lamp.x, z: lamp.z, witnesses: [{ id: "sooi", d: 4, los: true, facing: 1 }] }, always));
    as2(() => scheduleVisit(db, r.deed!));
    as2(() => agentArrives(db));
    as2(() => policeFled(db));
    const agent2 = as2(() => agentArrives(db));
    as2(() => policeOpen(db, agent2));
    const c0 = clock(db);
    const out = await as2(() => policeAnswer(db, agent2, "choice", "It wasn't me. I never touched it.", reply({ npc_line: "nonsense", mood: "calm" })));
    expect(out.verdict?.verdict).toBe("arrest");
    expect(out.night?.pending).toBe(true);
    expect(clock(db)).toEqual(c0);
    expect(restOf(db, GUEST)?.place).toBe("cell");
    expect(as2(() => cellNightView(db))).toBeNull();
    expect(as2(() => policeState(db)).record.arrests).toBe(1);
  });

  it("played alone the night in the cell passes at once, as before", () => {
    const db = fresh(22, 1);
    const night = cellNight(db, 0);
    expect(night.pending).toBeUndefined();
    expect(clock(db)).toMatchObject({ day: 2, hour: 6 });
    expect(restOf(db, 1)).toBeNull();
  });
});
