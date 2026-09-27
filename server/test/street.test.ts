import { describe, expect, it } from "vitest";
import { DRAWS_MS, HOST_BACK_MS, Owners, WORLD_HOLD_MS, WORLD_STALE_MS, WorldPc, type WorldSeat } from "../src/mp/street.ts";
import { MSG_PUPPETS, PUPPET_BYTES, puppetBatchOk, puppetKeep, puppetNums } from "../../shared/mpProtocol.ts";

// M8b multiplayer (docs/milestones/M8b.md): who walks which townsperson, and which PC runs the moving world.

const host = (pid: number) => pid === 1;

describe("the owners of the townspeople", () => {
  it("the first to ask walks them; another is told who has them", () => {
    const o = new Owners();
    const a = o.claim(2, ["r1", "r2"], false, host);
    expect(a.changes.map((c) => [c[1], c[2]])).toEqual([["r1", 2], ["r2", 2]]);
    const b = o.claim(3, ["r2", "r3"], false, host);
    expect(b.changes.map((c) => [c[1], c[2]])).toEqual([["r3", 3]]);
    expect(b.denied.map((c) => [c[1], c[2]])).toEqual([["r2", 2]]);
    expect(o.count(2)).toBe(2);
  });

  it("each resident keeps one small number; the batches carry it", () => {
    const o = new Owners();
    const n1 = o.numOf("r1");
    expect(o.numOf("r1")).toBe(n1);
    expect(o.numOf("r2")).not.toBe(n1);
    o.claim(2, ["r1"], false, host);
    expect(o.owns(2, n1!)).toBe(true);
    expect(o.owns(3, n1!)).toBe(false);
  });

  it("near the host the host takes them from a guest; a guest never takes them from the host or another guest", () => {
    const o = new Owners();
    o.claim(2, ["r1"], false, host);
    expect(o.claim(3, ["r1"], true, host).changes).toEqual([]);
    const h = o.claim(1, ["r1"], true, host);
    expect(h.changes.map((c) => c[2])).toEqual([1]);
    expect(o.claim(2, ["r1"], true, host).denied.map((c) => c[2])).toEqual([1]);
    // without asking to steal, the host waits like anyone
    const o2 = new Owners();
    o2.claim(2, ["r9"], false, host);
    expect(o2.claim(1, ["r9"], false, host).denied.map((c) => c[2])).toEqual([2]);
  });

  it("only the owner lets go; a player who leaves loses them all", () => {
    const o = new Owners();
    o.claim(2, ["r1", "r2"], false, host);
    expect(o.release(3, ["r1"])).toEqual([]);
    expect(o.release(2, ["r1"]).map((c) => c[2])).toEqual([0]);
    expect(o.dropAll(2).map((c) => [c[1], c[2]])).toEqual([["r2", 0]]);
    expect(o.list()).toEqual([]);
  });

  it("junk ids are ignored", () => {
    const o = new Owners();
    const r = o.claim(2, [42 as never, "", "x".repeat(65), "ok"], false, host);
    expect(r.changes.map((c) => c[1])).toEqual(["ok"]);
  });
});

describe("the puppet batches", () => {
  const batch = (nums: number[]) => {
    const b = new ArrayBuffer(10 + nums.length * PUPPET_BYTES);
    const v = new DataView(b);
    v.setUint8(0, MSG_PUPPETS);
    v.setUint8(1, nums.length);
    v.setFloat64(2, 1234.5, true);
    nums.forEach((n, i) => {
      v.setUint16(10 + i * PUPPET_BYTES, n, true);
      v.setUint8(10 + i * PUPPET_BYTES + 2, 100 + i);
    });
    return v;
  };

  it("a well-formed batch is read; a wrong length or type is not", () => {
    expect(puppetBatchOk(batch([5, 6]))).toBe(true);
    expect(puppetNums(batch([5, 6]))).toEqual([5, 6]);
    const short = new DataView(batch([5, 6]).buffer, 0, 10 + PUPPET_BYTES);
    expect(puppetBatchOk(short)).toBe(false);
    const wrong = batch([5]);
    wrong.setUint8(0, 1);
    expect(puppetBatchOk(wrong)).toBe(false);
  });

  it("only the entries the sender owns are passed on, each whole, with the batch's time", () => {
    const out = new DataView(puppetKeep(batch([5, 6, 7]), [0, 2]));
    expect(puppetBatchOk(out)).toBe(true);
    expect(puppetNums(out)).toEqual([5, 7]);
    expect(out.getFloat64(2, true)).toBe(1234.5);
    expect(out.getUint8(10 + PUPPET_BYTES + 2)).toBe(102);
  });
});

describe("the world PC", () => {
  const seat = (id: number, stateAt: number, online = true, rate?: number): WorldSeat => ({ id, host: id === 1, online, stateAt, rate });

  it("the host's PC while its tab draws; else the lowest player id whose tab draws", () => {
    const w = new WorldPc();
    expect(w.choose([seat(1, 1000), seat(2, 1000)], 1000)).toBe(1);
    const g = new WorldPc();
    expect(g.choose([seat(1, 0, true, 0), seat(3, 1000), seat(2, 1000)], 1000)).toBe(2);
  });

  it("keeps the world PC while its world comes; a hidden tab (no world) hands it on", () => {
    const w = new WorldPc();
    w.choose([seat(1, 1000), seat(2, 1000)], 1000);
    w.lastWorldAt = 1900;
    expect(w.choose([seat(1, 2000), seat(2, 2000)], 2000)).toBe(null);
    // the host's tab hidden: its state once a second, no world
    const t = 1900 + WORLD_STALE_MS + 1;
    expect(w.choose([seat(1, t - 900, true, 1), seat(2, t, true, 20)], t)).toBe(2);
  });

  it("the host takes the world back only after drawing a while (no flapping)", () => {
    const w = new WorldPc();
    w.choose([seat(1, 0, true, 0), seat(2, 1000)], 1000);
    expect(w.id).toBe(2);
    // the host draws from 1000 on, but the world stays at least WORLD_HOLD_MS with the PC it went to
    let now = 1000;
    for (; now < 1000 + Math.max(HOST_BACK_MS, WORLD_HOLD_MS) - 100; now += 50) {
      w.lastWorldAt = now;
      expect(w.choose([seat(1, now), seat(2, now)], now)).toBe(null);
    }
    now = 1000 + Math.max(HOST_BACK_MS, WORLD_HOLD_MS) + 100;
    w.lastWorldAt = now;
    expect(w.choose([seat(1, now), seat(2, now)], now)).toBe(1);
  });

  it("a slow host tab (a state every few hundred ms, 5 a second) keeps the world: no flapping", () => {
    const w = new WorldPc();
    w.choose([seat(1, 1000, true, 5), seat(2, 1000, true, 20)], 1000);
    expect(w.id).toBe(1);
    let changes = 0;
    for (let now = 1000; now < 60_000; now += 50) {
      if (now % 700 === 0) w.lastWorldAt = now; // (its world comes unevenly, but within the stale limit)
      const hostAt = now - (now % 400);
      if (w.choose([seat(1, hostAt, true, 5), seat(2, now, true, 20)], now) !== null) changes++;
    }
    expect(changes).toBe(0);
  });

  it("nobody draws: the current one keeps it while online (no flapping); gone, nobody; the first back takes it", () => {
    const w = new WorldPc();
    w.choose([seat(2, 1000)], 1000);
    const t = 1000 + WORLD_STALE_MS + DRAWS_MS + 1;
    expect(w.choose([seat(2, 1000), seat(3, 1000)], t)).toBe(null);
    expect(w.id).toBe(2);
    expect(w.choose([seat(2, 1000, false), seat(3, 1000)], t)).toBe(0);
    expect(w.choose([seat(3, t + 10)], t + 10)).toBe(3);
  });
});
