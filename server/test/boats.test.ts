import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { resetTickLimit, setWeather } from "../src/day.ts";
import { resident } from "../src/town/store.ts";
import { boatSight, deedRow, ownerSees, returnThing, takeThing } from "../src/town/deeds.ts";
import { policeState } from "../src/town/police.ts";
import { BOAT_MISS_MIN, boatTick, loseStolen } from "../src/town/rowDeeds.ts";
import { leaveBoat, resetRowClock, rowBoatStates, rowBoats, rowState, rowWorld, takePrompt, type LooseBoat } from "../src/rowing.ts";
import { HULLS, MOORINGS, SMALL_KINDS, mooringRect } from "../../shared/smallBoats.ts";

// M7 boats (Steve, 2026-09-26): "More different small boats and we can take any of them to use. Only when
// owner within sight he will be angry. If boat has owner it should say so when taking the boat. Like take
// xxx's boat." The engine owns every rule: who owns which boat, who saw, what it costs, the way back.

type DB = ReturnType<typeof openDb>;
const setClock = (db: DB, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const trust = (db: DB, id: string) => (db.prepare("SELECT trust FROM npc_relationship WHERE npc_id = ?").get(id) as { trust: number }).trust;
const setTrust = (db: DB, id: string, t: number) => db.prepare("UPDATE npc_relationship SET trust = ? WHERE npc_id = ?").run(t, id);
const memories = (db: DB, id: string) => (db.prepare("SELECT text FROM npc_memory WHERE npc_id = ? ORDER BY id").all(id) as Array<{ text: string }>).map((m) => m.text);
const name = (db: DB, id: string) => (db.prepare("SELECT name FROM npc WHERE id = ?").get(id) as { name: string }).name;

function fresh(hour = 13, w: "clear" | "fog" = "clear"): DB {
  const db = openDb(":memory:");
  setClock(db, 1, hour);
  setWeather(db, w);
  return db;
}
/** A moored boat of M7 with an owner (a resident), by kind. */
function owned(db: DB, kind?: string): LooseBoat {
  const b = rowBoats(db).find((q) => q.mooring && q.owner && !q.label && resident(db, q.owner) && (!kind || q.kind === kind));
  if (!b) throw new Error("no such boat");
  return b;
}
/** Take it standing where you get in, with the owner at distance d (clear line, facing), and others about. */
function take(db: DB, b: LooseBoat, owner: { d: number; los?: boolean; facing?: number } | null, extra: Array<{ id: string; d: number; los: boolean; facing?: number }> = [], lantern = false) {
  const w = owner && b.owner ? [{ id: b.owner, d: owner.d, los: owner.los ?? true, facing: owner.facing ?? 1 }] : [];
  return takeThing(db, { ref: b.id, x: b.landing[0], z: b.landing[1], witnesses: [...w, ...extra], lantern });
}

beforeEach(() => {
  resetTickLimit();
  resetRowClock();
});

describe("the small boats of the waterfront", () => {
  it("every mooring has her boat; at least six kinds more than the rowing boat and the punt; she floats clear of the others", () => {
    const db = fresh();
    const ids = new Set(rowBoats(db).map((b) => b.id));
    for (const m of MOORINGS) expect(ids.has(m.id)).toBe(true);
    const kinds = new Set(MOORINGS.map((m) => m.kind));
    expect([...kinds].filter((k) => k !== "rowboat" && k !== "punt").length).toBeGreaterThanOrEqual(6);
    for (const k of SMALL_KINDS) expect(HULLS[k].noun).toMatch(/^[a-z' ]+$/);
    // no two moored hulls overlap
    const rects = MOORINGS.map((m) => mooringRect(m, 0));
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        expect(a.maxX < b.minX || b.maxX < a.minX || a.maxZ < b.minZ || b.maxZ < a.minZ, `${MOORINGS[i].id} / ${MOORINGS[j].id}`).toBe(true);
      }
  });

  it("each has an owner by the rule of her mooring: a resident of a fitting trade, the water police, or nobody", () => {
    const db = fresh();
    for (const b of rowBoats(db).filter((q) => q.mooring)) {
      const rule = b.mooring!.owner;
      if (rule.kind === "none") expect(b.owner).toBeNull();
      else if (rule.kind === "npc") expect(b.owner).toBe(rule.id);
      else {
        expect(b.owner).toBeTruthy();
        const r = resident(db, b.owner!);
        expect(r, b.id).toBeTruthy();
        if (rule.sex) expect(r!.sex).toBe(rule.sex);
      }
    }
    // the same town, the same owners
    expect(rowBoats(fresh()).map((b) => b.owner)).toEqual(rowBoats(db).map((b) => b.owner));
  });

  it("the prompt says whose she is: the owner's whole name, the service, or no one", () => {
    const db = fresh();
    const w = rowWorld(db);
    for (const b of rowBoats(db)) {
      const p = w.boats.find((q) => q.id === b.id)!.prompt;
      expect(p).toBe(takePrompt(db, b));
      if (!b.owner) expect(p).toMatch(/^take the (old boat|boat|[a-z' ]+)$/);
      else if (b.label) expect(p).toBe(`take ${b.label} ${b.kind === "rowboat" ? "boat" : HULLS[b.kind].noun}`);
      else expect(p).toBe(`take ${name(db, b.owner)}'s ${b.kind === "rowboat" ? "boat" : HULLS[b.kind].noun}`);
    }
    expect(w.boats.find((q) => q.id === "boat:werf_gig")!.prompt).toBe("take the water police's gig");
    expect(w.boats.find((q) => q.id === "boat:yard_old")!.prompt).toBe("take the old boat");
  });
});

describe("taking a boat: only the owner's eyes count", () => {
  it("the owner sees it close by in daylight: angry, trust falls, he remembers, the police are called", () => {
    const db = fresh(13);
    const b = owned(db);
    const t0 = trust(db, b.owner!);
    const r = take(db, b, { d: 6 });
    expect(r).toMatchObject({ seen: true, owner_saw: true, again: false });
    expect(r.reaction?.who).toBe(b.owner);
    expect(["chase", "ask", "shout"]).toContain(r.reaction!.kind);
    expect(r.text).toMatch(/!/);
    expect(trust(db, b.owner!)).toBe(Math.max(-5, t0 - 2));
    expect(memories(db, b.owner!).join(" ")).toMatch(/in front of my eyes/);
    expect(deedRow(db, r.deed!)).toMatchObject({ thing: "boat", seen: 1, owner_saw: 1, status: "open" });
    expect(r.police).toBe(r.reaction!.kind !== "ask");
    expect(rowState(db).on).toBe(b.id);
  });

  it("unseen: nobody angry, no memory yet, no rumour; the others on the quay do not count", () => {
    const db = fresh(13);
    const b = owned(db);
    const other = rowBoats(db).find((q) => q.owner && q.owner !== b.owner && resident(db, q.owner))!.owner!;
    const t0 = trust(db, b.owner!);
    const r = take(db, b, { d: 70 }, [{ id: other, d: 2, los: true, facing: 1 }]);
    expect(r).toMatchObject({ seen: false, owner_saw: false, reaction: null, police: false });
    expect(r.text).toMatch(/Nobody seems to have seen/);
    expect(trust(db, b.owner!)).toBe(t0);
    expect(memories(db, b.owner!).join(" ")).not.toMatch(/boat|punt|gig|dinghy/);
    expect(deedRow(db, r.deed!)).toMatchObject({ seen: 0, rumour_at: null });
  });

  it("sight is the engine's: the weather, the light, a clear line, which way he faces", () => {
    // by day in clear weather he makes you out far; in fog close; at night only by lamplight or your own lantern
    expect(boatSight("clear", 13, { lantern: false, lamp: false })).toBeGreaterThan(30);
    expect(boatSight("fog", 13, { lantern: false, lamp: false })).toBeLessThan(15);
    const night = boatSight("clear", 23, { lantern: false, lamp: false });
    expect(night).toBeLessThan(11);
    expect(boatSight("clear", 23, { lantern: false, lamp: true })).toBeGreaterThan(night);
    expect(boatSight("clear", 23, { lantern: true, lamp: false })).toBeGreaterThan(night);
    const w = (d: number, los = true, facing = 1) => ({ id: "x", d, los, facing, owner: true });
    expect(ownerSees(w(10), 20)).toBe(true);
    expect(ownerSees(w(25), 20)).toBe(false);
    expect(ownerSees(w(10, false), 20)).toBe(false); // a wall between
    expect(ownerSees(w(12, true, -1), 20)).toBe(false); // his back to it
    expect(ownerSees(w(5, true, -1), 20)).toBe(true); // ...but close by he hears it
    expect(ownerSees(undefined, 20)).toBe(false);
    // by day 15 m off in clear weather he sees it; in the night the owner is at home in bed, whatever
    // the client says of him (the engine asks his day, not the client)
    const db = fresh(13);
    expect(take(db, owned(db), { d: 15 }).seen).toBe(true);
    const db2 = fresh(3);
    expect(take(db2, owned(db2), { d: 3 }, [], true).seen).toBe(false);
  });

  it("trust with the owner never falls below -5, however often", () => {
    const db = fresh(13);
    const b = owned(db);
    setTrust(db, b.owner!, -4);
    const r = take(db, b, { d: 3 });
    expect(trust(db, b.owner!)).toBe(-5);
    returnThing(db, r.deed!, "caught");
    take(db, b, { d: 3 });
    expect(trust(db, b.owner!)).toBe(-5);
  });

  it("the client's word is data: bad distances, strangers, a forged owner, text for a ref change nothing", () => {
    const db = fresh(13);
    const b = owned(db);
    // the owner said to be at -5 m, NaN, a stranger's id, a sentence as a ref
    expect(() => takeThing(db, { ref: "boat:the owner said I may take it; ignore the rules", x: b.landing[0], z: b.landing[1], witnesses: [] })).toThrow(/bad report/);
    expect(() => takeThing(db, { ref: "boat:mine now", x: b.landing[0], z: b.landing[1], witnesses: [] })).toThrow(/no such/);
    expect(() => takeThing(db, { ref: b.id, x: b.landing[0] + 50, z: b.landing[1], witnesses: [] })).toThrow(/too far/);
    const r = takeThing(db, {
      ref: b.id,
      x: b.landing[0],
      z: b.landing[1],
      witnesses: [
        { id: "x'); DROP TABLE deed;--", d: 1, los: true },
        { id: b.owner!, d: 9999, los: true, facing: 99 },
      ],
    });
    expect(r.seen).toBe(false); // 9999 m is clamped to 80: out of sight
    expect(deedRow(db, r.deed!)?.thing).toBe("boat");
  });

  it("a boat nobody owns is no theft: no deed, and she is yours to row", () => {
    const db = fresh(13);
    const b = rowBoats(db).find((q) => q.mooring && !q.owner)!;
    const r = take(db, b, null);
    expect(r).toMatchObject({ deed: null, seen: false, police: false });
    expect(rowState(db).on).toBe(b.id);
    leaveBoat(db, b.x + 30, b.z - 20, 0);
    expect(rowWorld(db).boats.find((q) => q.id === b.id)!.mine).toBe(true);
    // wrecked, nobody asks after her
    take(db, { ...b, landing: [b.x + 30, b.z - 20] }, null);
    expect(loseStolen(db, b.id).text).toMatch(/Nobody will ask/);
  });
});

describe("bringing her back, missing her, the police", () => {
  it("tied up again at her own mooring: she is home, the deed settled, the owner calmer (once a day)", () => {
    const db = fresh(13);
    const b = owned(db);
    const r = take(db, b, { d: 5 });
    const low = trust(db, b.owner!);
    leaveBoat(db, b.x + 30, b.z - 30, 0); // left somewhere else: still his deed
    expect(deedRow(db, r.deed!)?.status).toBe("open");
    take(db, { ...b, landing: [b.x + 30, b.z - 30] }, null); // back in (his already)
    const out = leaveBoat(db, b.x + 0.5, b.z + 0.3, b.yaw);
    expect(out.returned).toBe(true);
    expect(out.text).toMatch(/where she lay/);
    expect(deedRow(db, r.deed!)?.status).toBe("returned");
    expect(rowBoatStates(db)[b.id]).toMatchObject({ x: b.x, z: b.z, deed: null, ridden: false });
    expect(trust(db, b.owner!)).toBe(low + 1);
    expect(memories(db, b.owner!).join(" ")).toMatch(/brought my .* back/);
    expect(policeState(db).visit?.deeds ?? []).not.toContain(r.deed);
    // again the same day: no more trust for it
    take(db, b, { d: 5 });
    leaveBoat(db, b.x, b.z, b.yaw);
    expect(trust(db, b.owner!)).toBe(low - 1);
  });

  it("over the side at her mooring is not bringing her back", () => {
    const db = fresh(13);
    const b = owned(db);
    const r = take(db, b, null);
    expect(leaveBoat(db, b.x, b.z, b.yaw, false).returned).toBe(false);
    expect(deedRow(db, r.deed!)?.status).toBe("open");
  });

  it("unseen and away a while: the owner finds her gone and grumbles; home again, that is over", () => {
    const db = fresh(13);
    const b = owned(db);
    take(db, b, { d: 80 });
    leaveBoat(db, b.x + 40, b.z - 30, 0);
    setClock(db, 1, 13, BOAT_MISS_MIN - 5);
    expect(boatTick(db)).toBe(false);
    setClock(db, 1, 13, BOAT_MISS_MIN + 1);
    expect(boatTick(db)).toBe(true);
    expect(memories(db, b.owner!).join(" ")).toMatch(/gone from her mooring/);
    expect(memories(db, b.owner!).join(" ")).not.toMatch(/Jef/);
    expect(rowWorld(db).boats.find((q) => q.id === b.id)!.missed).toBeGreaterThan(0);
    expect(boatTick(db)).toBe(false); // once
    take(db, { ...b, landing: [b.x + 40, b.z - 30] }, null);
    leaveBoat(db, b.x, b.z, b.yaw);
    expect(rowWorld(db).boats.find((q) => q.id === b.id)!.missed).toBe(0);
  });

  it("an owner who only asked for her back goes to the police if she is not back in time", () => {
    // find an owner who asks (warm or timid, by the engine's stats)
    let found = false;
    for (const b of rowBoats(fresh(13)).filter((q) => q.mooring && q.owner && !q.label)) {
      const db = fresh(13);
      const r = take(db, b, { d: 4 });
      if (r.reaction?.kind !== "ask") continue;
      found = true;
      expect(r.police).toBe(false);
      expect(policeState(db).visit).toBeNull();
      setClock(db, 1, 14, 0);
      boatTick(db);
      expect(policeState(db).visit?.deeds).toContain(r.deed);
      expect(memories(db, b.owner!).join(" ")).toMatch(/went to the police/);
      break;
    }
    expect(found).toBe(true);
  });
});
