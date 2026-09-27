import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { DB } from "../src/db.ts";
import { blankSave } from "./blank-save.ts";
import { asPlayer, setOnlineIds } from "../src/player/current.ts";
import { ensurePlayerRow, resetPlayer, retiredMen } from "../src/player/multi.ts";
import { nameOf, readText } from "../src/player/names.ts";
import { saveProfile } from "../src/player/profile.ts";
import { defaultFor } from "../../shared/character.ts";
import { resetMpSettings } from "../src/mp/settings.ts";
import { setWorldClock } from "../src/mp/worldClock.ts";
import { clock, ENDING_HOOKS, ending, endGame, everyoneEnded, playerHour, resetTickLimit, worldTick, worldWeekOver, type Ending } from "../src/day.ts";
import { clearRests, collapseRest, restOf, takeWoke } from "../src/rest.ts";
import { arrivalCreator, arrivalStage, mountArrival, newMan } from "../src/arrival.ts";
import { remember } from "../src/npcs.ts";
import { log } from "../src/game.ts";
import { pockets } from "../src/trade.ts";
import { stealables, takeThing, veloStates } from "../src/town/deeds.ts";
import { policeState, scheduleVisit, theftTalk } from "../src/town/police.ts";
import { buildPrompt } from "../src/hooks/epilogue.ts";
import { TICK_EVERY_MS } from "../../shared/clock.ts";

// M8d: each player's end and a new man. The world's week ends for everyone with an epilogue each; a player whose
// body gives out gets his end (and his epilogue) while the world goes on, and may start a new man who comes by the
// ferry; his old man retires, and what the town remembers of him stays about him.

const GUEST = 2;
const as2 = <T>(fn: () => T): T => asPlayer(GUEST, fn);
const always = () => 0;
let db: DB;
let now = 1_000_000;
const tickOnce = () => {
  now += TICK_EVERY_MS;
  return asPlayer(1, () => worldTick(db, now));
};
const row = (id: number) => db.prepare("SELECT money_c, food, warmth, health, sleep, rent_paid_until, day, hour, minute FROM player WHERE id = ?").get(id) as Record<string, number>;
const ends: Array<{ id: number; e: Ending }> = [];
const hook = (_db: DB, id: number, e: Ending) => void ends.push({ id, e });

beforeEach(() => {
  db = blankSave();
  ensurePlayerRow(db, GUEST, "Anna");
  resetMpSettings({ multiplayer: true });
  setOnlineIds(() => [1, GUEST]);
  clearRests();
  resetTickLimit();
  setWorldClock(db, { day: 3, hour: 10, minute: 0 });
  ends.length = 0;
  ENDING_HOOKS.push(hook);
}, 60_000); // (the first blank save builds a town: slow on a busy machine)

afterEach(() => {
  ENDING_HOOKS.splice(ENDING_HOOKS.indexOf(hook), 1);
  resetMpSettings();
  setOnlineIds(null);
  clearRests();
});

describe("M8d each player's end", () => {
  it("a body that gives out: his end alone (the hook for his epilogue), and the world goes on", () => {
    db.prepare("UPDATE player SET health = 1, food = 0 WHERE id = ?").run(GUEST);
    const r = as2(() => playerHour(db, 12));
    expect(r.ended?.kind).toBe("health");
    expect(ends).toEqual([{ id: GUEST, e: expect.objectContaining({ kind: "health" }) }]);
    expect(ending(db)).toBeNull();
    expect(worldWeekOver(db)).toBe(false);
    expect(everyoneEnded(db)).toBe(false);
    // the world's clock goes on for the host; the guest's needs stand still
    const g0 = row(GUEST);
    const m0 = clock(db);
    for (let i = 0; i < 24; i++) tickOnce();
    expect(clock(db).hour).toBe(m0.hour + 2);
    expect(row(GUEST).food).toBe(g0.food);
    expect(row(GUEST).warmth).toBe(g0.warmth);
  });

  it("the world's week ends: every player in the game his end and his epilogue; the sleepers wake to it", () => {
    setWorldClock(db, { day: 7, hour: 23, minute: 55 });
    as2(() => collapseRest(db, GUEST));
    tickOnce();
    expect(ending(db)?.kind).toBe("week");
    expect(as2(() => ending(db))?.kind).toBe("week");
    expect(ends.map((x) => x.id).sort()).toEqual([1, GUEST]);
    expect(worldWeekOver(db)).toBe(true);
    expect(everyoneEnded(db)).toBe(true);
    expect(restOf(db, GUEST)).toBeNull();
    expect(takeWoke(GUEST)?.reason).toBe("ended");
  });

  it("played alone, the one player's end is everyone's (the paper's morning stops, as before)", () => {
    resetMpSettings();
    setOnlineIds(null);
    expect(everyoneEnded(db)).toBe(false);
    endGame(db, "health");
    expect(everyoneEnded(db)).toBe(true);
    expect(worldWeekOver(db)).toBe(false);
  });

  it("the epilogue is written from the player's own week", () => {
    as2(() => log(db, "worked", null, "Jef carried crates for the Hessenatie."));
    const p = as2(() => buildPrompt(db, { kind: "health", day: 3 }));
    expect(p).toMatch(/Anna carried crates/);
    expect(buildPrompt(db, { kind: "week", day: 7 })).not.toMatch(/Anna carried crates/);
  });
});

describe("M8d a new man on the ferry", () => {
  function guestWeek(): { deed: number; velo: string } {
    const v = stealables(db).velos[0];
    const r = as2(() => takeThing(db, { ref: v.id, x: v.x, z: v.z, witnesses: [{ id: v.owner, d: 3, los: true, facing: 1 }] }, always));
    as2(() => scheduleVisit(db, r.deed!));
    db.prepare("INSERT INTO item (kind, job_id, player_id) VALUES ('bread', NULL, ?)").run(GUEST);
    db.prepare("UPDATE player SET money_c = 7, food = 1, health = 0 WHERE id = ?").run(GUEST);
    db.prepare("UPDATE faction_trust SET trust = -3 WHERE player_id = ?").run(GUEST);
    as2(() => remember(db, "fientje", "Jef stole bread from my table.", 7, "seen", null, { gist: "Jef stole bread from Fientje", tone: -2 }));
    db.prepare("INSERT INTO job (day, title, employer_npc, district, task_type, pay_c, risk, tier, pitch, status, taken_by) VALUES (3, 'Carry crates', 'sooi', 'rijnkaai', 'carry', 50, 'low', 1, 'x', 'taken', ?)").run(GUEST);
    as2(() => endGame(db, "health"));
    return { deed: r.deed!, velo: v.id };
  }

  it("after his end, a guest starts a new man: fresh things, the old man retired with his name, the host untouched", () => {
    const host0 = row(1);
    const { velo } = guestWeek();
    expect(veloStates(db)[velo].deed).not.toBeNull();
    const r = as2(() => newMan(db));
    expect(r.stage).toBe("ferry");
    // his own things afresh (the clock's columns are the world's, untouched)
    expect(row(GUEST)).toMatchObject({ money_c: 50, food: 7, warmth: 7, health: 8, sleep: 7, rent_paid_until: 0 });
    expect(as2(() => pockets(db))).toEqual([]);
    expect(as2(() => ending(db))).toBeNull();
    expect((db.prepare("SELECT MIN(trust) AS lo, MAX(trust) AS hi FROM faction_trust WHERE player_id = ?").get(GUEST) as { lo: number; hi: number })).toEqual({ lo: 0, hi: 0 });
    expect((db.prepare("SELECT COUNT(*) AS n FROM npc_relationship WHERE player_id = ? AND (trust <> 0 OR times_met <> 0)").get(GUEST) as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM job WHERE status = 'taken' AND taken_by = ?").get(GUEST) as { n: number }).n).toBe(0);
    expect(as2(() => policeState(db))).toMatchObject({ visit: null, record: { warnings: 0, fines: 0, arrests: 0, fled: 0 } });
    expect(as2(() => theftTalk(db))).toBe(0);
    // what he took went back to its owner
    expect(veloStates(db)[velo].deed).toBeNull();
    // the old man is retired, with his name; the town still remembers him, by that name
    const [man] = retiredMen(db);
    expect(man).toMatchObject({ player: GUEST, name: "Anna" });
    expect(man.id).toBeLessThan(0);
    const mem = db.prepare("SELECT text, about_player FROM npc_memory WHERE npc_id = 'fientje' AND text LIKE '%stole bread%'").get() as { text: string; about_player: number };
    expect(mem).toEqual({ text: "Anna stole bread from my table.", about_player: man.id });
    expect((db.prepare("SELECT COUNT(*) AS n FROM log WHERE player_id = ?").get(GUEST) as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM log WHERE player_id = ?").get(man.id) as { n: number }).n).toBeGreaterThan(0);
    // the new man comes by the ferry, made in the character sheet first
    expect(as2(() => arrivalStage(db))).toBe("ferry");
    expect(as2(() => arrivalCreator(db))).toBe(true);
    // nothing of the host's moved, and no new week
    expect(row(1)).toEqual(host0);
    expect(ending(db)).toBeNull();
    expect(clock(db)).toMatchObject({ day: 3 });
    // a second retirement gets its own id
    as2(() => endGame(db, "health"));
    as2(() => newMan(db));
    expect(retiredMen(db).map((m) => m.id)).toEqual([man.id, man.id - 1]);
  });

  it("the host's own man retires too: his 'Jef' in the town's memory is the old man's, not the new one's", () => {
    remember(db, "fientje", "Jef bought a herring and paid in full.", 5, "seen", null, { gist: "Jef paid Fientje in full", tone: 1 });
    saveProfile(db, { ...defaultFor("man"), first: "Piet", last: "" } as ReturnType<typeof defaultFor>, 1);
    endGame(db, "health");
    const c0 = clock(db);
    const man = resetPlayer(db, 1, nameOf(db, 1));
    expect(man.name).toBe("Piet");
    const mem = db.prepare("SELECT text, gist, about_player FROM npc_memory WHERE npc_id = 'fientje' AND text LIKE '%herring%'").get() as { text: string; gist: string; about_player: number };
    expect(mem).toEqual({ text: "Piet bought a herring and paid in full.", gist: "Piet paid Fientje in full", about_player: man.id });
    // read by a guest the old man stays Piet, whatever the host calls his new man
    saveProfile(db, { ...defaultFor("man"), first: "Rik", last: "" } as ReturnType<typeof defaultFor>, 1);
    expect(as2(() => readText(db, mem.text))).toBe("Piet bought a herring and paid in full.");
    expect(clock(db)).toEqual(c0);
    expect(ending(db)).toBeNull();
    expect(arrivalStage(db)).toBe("ferry");
  });

  it("no new man while the man lives, when the world's week is over, or played alone", () => {
    expect(() => as2(() => newMan(db))).toThrow(/still in the town/);
    setWorldClock(db, { day: 7, hour: 23, minute: 55 });
    tickOnce();
    expect(() => as2(() => newMan(db))).toThrow(/host starts the next one/);
    resetMpSettings();
    expect(() => as2(() => newMan(db))).toThrow(/Played alone/);
  });

  it("the routes: a guest's first arrival asks for the character sheet, then the ferry; ashore writes his line", async () => {
    const app = new Hono();
    mountArrival(app, { db });
    const get = () => Promise.resolve(as2(() => app.request("/api/arrival"))).then((r) => r.json());
    const post = (p: string) => Promise.resolve(as2(() => app.request(p, { method: "POST" }))).then((r) => r.json());
    expect(await get()).toEqual({ stage: "ferry", creator: true });
    // the host's week in progress: ashore, no sheet
    expect(await Promise.resolve(app.request("/api/arrival")).then((r) => r.json())).toMatchObject({ creator: false });
    saveProfile(db, { ...defaultFor("woman"), first: "Mie", last: "" } as ReturnType<typeof defaultFor>, GUEST);
    expect(await post("/api/arrival/made")).toEqual({ stage: "ferry", creator: false });
    expect(await post("/api/arrival/ashore")).toEqual({ stage: "ashore" });
    const line = db.prepare("SELECT text FROM log WHERE player_id = ? AND verb = 'arrived'").get(GUEST) as { text: string };
    expect(line.text).toMatch(/^Mie came off the ferry/);
    // again is harmless: no second line
    await post("/api/arrival/ashore");
    expect((db.prepare("SELECT COUNT(*) AS n FROM log WHERE player_id = ? AND verb = 'arrived'").get(GUEST) as { n: number }).n).toBe(1);
    // a new man through the route
    as2(() => endGame(db, "health"));
    const r = (await post("/api/player/new-man")) as { stage: string };
    expect(r.stage).toBe("ferry");
    expect(await get()).toEqual({ stage: "ferry", creator: true });
  });
});
