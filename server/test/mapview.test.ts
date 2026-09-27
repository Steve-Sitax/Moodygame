import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { allowedMapHost, allowedMapOrigin, mapPortFromEnv, mountMapView, type MapView } from "../src/mapview/index.ts";
import { LIVE_STALE_MS, MapModel, plannedSpot, Ring, TRAIL_CAP, TRAIL_KEEP_MS, type PuppetIn } from "../src/mapview/model.ts";
import { detail, history, homesOf, peopleJson, snapshot, workplaceOf } from "../src/mapview/views.ts";
import { town } from "../src/town/store.ts";
import { blankSave } from "./blank-save.ts";

// The town map (docs/mapview.md): the model's history, the day plan's places, the Host check and the feed.

const puppet = (id: string, x: number, z: number, extra: Partial<PuppetIn> = {}): PuppetIn => ({
  id,
  x,
  z,
  yaw: 0,
  speed: 1,
  motion: "walk",
  sit: false,
  lantern: false,
  sack: false,
  bought: null,
  vehicle: null,
  ...extra,
});

describe("the trail ring", () => {
  it("keeps the newest points, oldest first, and reads from a time on", () => {
    const r = new Ring(3);
    for (let i = 1; i <= 5; i++) r.push(i * 1000, i, -i);
    expect(r.size).toBe(3);
    expect(r.points().map((p) => p[0])).toEqual([3000, 4000, 5000]);
    expect(r.points(4000).map((p) => p[1])).toEqual([4, 5]);
    expect(r.last()).toEqual([5000, 5, -5]);
  });

  it("holds 15 minutes at one point a second", () => {
    expect(TRAIL_CAP).toBe(900);
    expect(TRAIL_KEEP_MS).toBe(15 * 60_000);
  });
});

describe("the model", () => {
  it("samples a trail once a second at most, and forgets past 15 minutes", () => {
    let now = 1_000_000;
    const m = new MapModel({ now: () => now });
    for (let i = 0; i < 40; i++) {
      m.puppets(1, [puppet("r001", i, 0)]);
      now += 250; // four batches a second
    }
    const t = m.trail("resident", "r001");
    expect(t.length).toBe(10);
    expect(t[1][0] - t[0][0]).toBe(1000);
    now += TRAIL_KEEP_MS;
    expect(m.trail("resident", "r001").length).toBe(0);
  });

  it("the ring never grows past its cap", () => {
    let now = 0;
    const m = new MapModel({ now: () => now });
    for (let i = 0; i < TRAIL_CAP + 50; i++) {
      m.puppets(1, [puppet("r002", i, i)]);
      now += 1000;
    }
    const t = m.trail("resident", "r002", -Infinity);
    expect(t.length).toBe(TRAIL_CAP);
    expect(t[t.length - 1][1]).toBe(TRAIL_CAP + 49);
  });

  it("notes who walks whom, an owner going quiet, players coming and going", () => {
    let now = 5000;
    const m = new MapModel({ now: () => now });
    m.players([{ id: 1, name: "Jef", host: true, x: 0, y: 0, z: 0, yaw: 0, mode: "walk", away: false, online: true }]);
    m.players([
      { id: 1, name: "Jef", host: true, x: 0, y: 0, z: 0, yaw: 0, mode: "walk", away: false, online: true },
      { id: 2, name: "Piet", host: false, x: 5, y: 0, z: 5, yaw: 0, mode: "swim", away: false, online: true },
    ]);
    m.owners([[1, "r003", 2]], true);
    m.puppets(2, [puppet("r003", 1, 1)]);
    expect(m.liveList().map((p) => p.id)).toEqual(["r003"]);
    expect(m.walkCounts().get(2)).toBe(1);
    now += LIVE_STALE_MS + 100;
    expect(m.liveList()).toEqual([]);
    m.sweep(null, null);
    const ch = m.changes("resident", "r003").map((c) => c.text);
    expect(ch[0]).toMatch(/not seen live any more \(last walked by Piet's PC\)/);
    expect(ch).toContain("walked by Piet's PC");
    m.players([{ id: 1, name: "Jef", host: true, x: 0, y: 0, z: 0, yaw: 0, mode: "walk", away: false, online: true }]);
    expect(m.changes("player", 2)[0].text).toBe("Piet left the town");
    m.owners([[1, "r003", 0]]);
    expect(m.changes("resident", "r003")[0].text).toBe("walked by nobody now");
  });

  it("keeps the moving world as it came and samples its movers", () => {
    const m = new MapModel({ now: () => 1000 });
    m.world(999, { boats: [{ id: "anna", x: -40, z: -8 }], lock: { level: 0.4 } });
    expect(m.worldState()?.d.lock).toEqual({ level: 0.4 });
    expect(m.trail("world", "boats:anna").map((p) => [p[1], p[2]])).toEqual([[-40, -8]]);
  });
});

describe("the day plan's places", () => {
  it("a resident nobody walks stands where his plan puts him; one walked live is live", () => {
    const db = blankSave();
    const tw = town(db).town;
    const r = tw.residents.find((q) => q.work.place !== "home" && q.sched.day.some((s) => s[2] === "work" && s[0] <= 11 && s[1] > 11))!;
    expect(r).toBeTruthy();
    // at 3 in the night he is at home, indoors, at the step before his door (the trade plan: ways start there)
    const night = plannedSpot(r, tw, { day: 2, hour: 3, minute: 0 });
    expect(night.act).toBe("home");
    expect(night.indoor).toBe(true);
    expect([night.x, night.z]).toEqual([r.home.sx, r.home.sz]);
    // at 11 he works (somewhere else than his door)
    const day = plannedSpot(r, tw, { day: 2, hour: 11, minute: 0 });
    expect(day.act).toBe("work");
    expect(Number.isFinite(day.x) && Number.isFinite(day.z)).toBe(true);
    // in the snapshot: planned (live 0) until a PC walks him, then live where the PC says
    const m = new MapModel();
    const clock = { day: 2, hour: 11, minute: 0 };
    const a = snapshot(m, tw, clock, null) as { people: Array<{ id: string; live: number; x: number; z: number }> };
    expect(a.people.length).toBe(tw.residents.length);
    expect(a.people.find((p) => p.id === r.id)).toMatchObject({ live: 0, x: Math.round(day.x * 10) / 10 });
    m.puppets(1, [puppet(r.id, 12.34, 56.78)]);
    const b = snapshot(m, tw, clock, null) as typeof a;
    expect(b.people.filter((p) => p.id === r.id)).toEqual([expect.objectContaining({ live: 1, x: 12.3, z: 56.8 })]);
    expect(b.people.length).toBe(tw.residents.length);
    db.close();
  });
});

describe("homes, households and workplaces", () => {
  it("/people gives every resident a home that exists, with its outline, and one home per household", () => {
    const db = blankSave();
    const tw = town(db).town;
    const p = JSON.parse(peopleJson(tw)) as {
      residents: Array<{ id: string; household: number; home: string | null; work: [number, number] | null; wl: string | null; wp: string | null; mate: string | null }>;
      homes: Array<{ id: string; fp: Array<[number, number]> | null; door: [number, number]; n: number; name: string; near: string | null; hh: number[] }>;
    };
    const homes = new Map(p.homes.map((h) => [h.id, h]));
    expect(p.homes.length).toBeGreaterThan(50);
    for (const r of p.residents) expect(homes.has(r.home ?? "")).toBe(true);
    // the people counted in each home are the residents that name it
    const counted = new Map<string, number>();
    for (const r of p.residents) counted.set(r.home!, (counted.get(r.home!) ?? 0) + 1);
    for (const h of p.homes) expect(h.n).toBe(counted.get(h.id));
    // a household lives under one roof
    const hhHome = new Map<number, string>();
    for (const r of p.residents) {
      if (hhHome.has(r.household)) expect(r.home).toBe(hhHome.get(r.household));
      else hhHome.set(r.household, r.home!);
    }
    // nearly every home is a house of the map with an outline, a name and a place it is near
    const drawn = p.homes.filter((h) => h.fp && h.fp.length >= 3);
    expect(drawn.length / p.homes.length).toBeGreaterThan(0.9);
    const family = p.homes.find((h) => h.n >= 3 && h.hh.length === 1)!;
    expect(family.name).toMatch(/^the \S.* family$/);
    expect(p.homes.filter((h) => h.near).length / p.homes.length).toBeGreaterThan(0.8);
    // a shopkeeper's workplace is his shop, pinnable; work at home is no workplace
    const keeper = tw.residents.find((r) => r.work.kind === "shop" && r.work.shop)!;
    const kw = p.residents.find((r) => r.id === keeper.id)!;
    expect(kw.wp).toBe(keeper.work.shop);
    expect(kw.work).toEqual([expect.any(Number), expect.any(Number)]);
    const athome = tw.residents.find((r) => r.work.place === "home")!;
    expect(workplaceOf(athome, tw)).toBe(null);
    expect(p.residents.find((r) => r.id === athome.id)!.work).toBe(null);
    db.close();
  });

  it("a resident's card links his home and workplace; the house card lists who lives there and who is inside", () => {
    const db = blankSave();
    const tw = town(db).town;
    const hs = homesOf(tw);
    const home = [...hs.byId.values()].find((h) => h.members.length >= 3 && h.households.length === 1 && h.fp)!;
    const head = home.members.find((r) => r.family_role === "head") ?? home.members[0];
    const model = new MapModel();
    const night = { day: 2, hour: 3, minute: 0 };
    const v = { model, db, town: tw, clock: night };

    const d = detail(v, "resident", head.id)!;
    const homeLink = d.links.find((l) => l.kind === "house")!;
    expect(homeLink).toMatchObject({ id: home.id, name: "Home", group: "Home and work", at: { x: home.step[0], z: home.step[1] } });
    const family = d.links.filter((l) => l.group === "Family" && l.kind === "resident").map((l) => l.id);
    for (const r of home.members) if (r.id !== head.id && r.household === head.household) expect(family).toContain(r.id);

    const keeper = tw.residents.find((r) => r.work.kind === "shop" && r.work.shop)!;
    const kd = detail(v, "resident", keeper.id)!;
    expect(kd.links.find((l) => l.name === "Workplace")).toMatchObject({ kind: "place", id: keeper.work.shop, group: "Home and work" });

    // at 3 in the night the household is at home, inside
    const hd = detail(v, "house", home.id)!;
    expect(hd.title).toBe(`Home of ${home.name}`);
    expect(hd.at).toEqual({ x: home.step[0], z: home.step[1] });
    const living = hd.links.filter((l) => l.group === "Living here");
    expect(living.map((l) => l.id).sort()).toEqual(home.members.map((r) => r.id).sort());
    const inside = hd.links.filter((l) => l.group === "Inside now, by the day plan").map((l) => l.id);
    expect(inside.filter((id) => home.members.some((r) => r.id === id)).length).toBeGreaterThanOrEqual(home.members.length - 1);
    // one walked live is in the street, not inside
    model.puppets(1, [puppet(head.id, home.step[0] + 5, home.step[1])]);
    const hd2 = detail(v, "house", home.id)!;
    expect(hd2.links.find((l) => l.id === head.id && l.group === "Living here")?.why).toMatch(/seen live/);
    expect(hd2.links.some((l) => l.id === head.id && l.group === "Inside now, by the day plan")).toBe(false);
    expect(detail(v, "house", "h-nothing")).toBe(null);
    db.close();
  });

  it("the house's history holds its people's family news and events from the save, read only", () => {
    const db = blankSave();
    const tw = town(db).town;
    const home = [...homesOf(tw).byId.values()].find((h) => h.members.length >= 2 && h.households.length === 1)!;
    const [a, b] = home.members;
    db.prepare("INSERT INTO family_news (day, minute, teller, listener, memory_id, origin, gist, tone, status) VALUES (3, 600, ?, ?, 1, 1, 'the baker cheated her', -2, 'heard')").run(a.id, b.id);
    const ev = db.prepare("INSERT INTO world_event (day, hour, minute, kind, verb, text) VALUES (3, 11, 0, 'talk', 'talked', 'a quarrel at the door')").run();
    db.prepare("INSERT INTO world_event_who (event_id, who) VALUES (?, ?)").run(ev.lastInsertRowid, b.id);
    const other = tw.residents.find((r) => homesOf(tw).byResident.get(r.id) !== home.id)!;
    db.prepare("INSERT INTO family_news (day, minute, teller, listener, memory_id, origin, gist, tone, status) VALUES (3, 610, ?, ?, 1, 1, 'none of this house', 0, 'heard')").run(other.id, other.id);
    const hist = history({ model: new MapModel(), db, town: tw, clock: { day: 3, hour: 12, minute: 0 } }, "house", home.id);
    const texts = hist.db.map((e) => e.text);
    expect(texts).toContain(`${a.name} to ${b.name}: the baker cheated her`);
    expect(texts).toContain("a quarrel at the door");
    expect(texts.some((t) => t.includes("none of this house"))).toBe(false);
    expect(hist.trail).toEqual([]);
    db.close();
  });
});

describe("the map's server", () => {
  let view: MapView | null = null;
  afterEach(async () => {
    await view?.close();
    view = null;
  });

  it("the port: 8790 unless the env says otherwise; 0 is off", () => {
    expect(mapPortFromEnv({})).toBe(8790);
    expect(mapPortFromEnv({ SCHELDEMIST_MAP_PORT: "0" })).toBe(null);
    expect(mapPortFromEnv({ SCHELDEMIST_MAP_PORT: "8801" })).toBe(8801);
    expect(mountMapView({ model: new MapModel(), db: blankSave(), port: null }).url).toBe("");
  });

  it("answers only a Host that names this PC and the map's port (DNS rebinding)", async () => {
    expect(allowedMapHost("127.0.0.1:8790", 8790)).toBe(true);
    expect(allowedMapHost("localhost:8790", 8790)).toBe(true);
    expect(allowedMapHost("evil.example:8790", 8790)).toBe(false);
    expect(allowedMapHost("127.0.0.1:8787", 8790)).toBe(false);
    expect(allowedMapHost("192.168.1.20:8790", 8790)).toBe(false);
    expect(allowedMapHost(undefined, 8790)).toBe(false);
    expect(allowedMapOrigin("http://evil.example:8790", 8790)).toBe(false);
    expect(allowedMapOrigin("http://127.0.0.1:8790", 8790)).toBe(true);

    const db = blankSave();
    view = mountMapView({ model: new MapModel(), db, port: 0 });
    const url = await view.ready;
    const port = Number(new URL(url).port);
    expect(new URL(url).hostname).toBe("127.0.0.1");
    const get = (path: string, host: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port, path, headers: { host }, timeout: 5000 }, (res) => {
          let body = "";
          res.on("data", (c: Buffer) => (body += c.toString()));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        });
        req.on("error", reject);
        req.on("timeout", () => req.destroy(new Error("timeout")));
        req.end();
      });
    expect((await get("/city", `evil.example:${port}`)).status).toBe(403);
    expect((await get("/", `attacker.test:${port}`)).status).toBe(403);
    const ok = await get("/city", `127.0.0.1:${port}`);
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body).houses.length).toBeGreaterThan(100);
    const page = await get("/", `localhost:${port}`);
    expect(page.status).toBe(200);
    expect(page.body).toContain("map.js");
    db.close();
  });

  it("the feed sends snapshots four times a second, with what the model was fed", async () => {
    const db = blankSave();
    const model = new MapModel();
    model.players([{ id: 1, name: "Jef", host: true, x: 10, y: 1.7, z: 20, yaw: 0, mode: "walk", away: false, online: true }]);
    view = mountMapView({ model, db, port: 0, clock: () => ({ day: 1, hour: 12, minute: 0, weekday: "Monday", weather: "clear" }) });
    const port = Number(new URL(await view.ready).port);

    // another page's Origin is refused
    const refused = await new Promise<boolean>((resolve) => {
      const bad = new WebSocket(`ws://127.0.0.1:${port}/feed`, { origin: "http://evil.example" });
      bad.on("open", () => resolve(false));
      bad.on("error", () => resolve(true));
    });
    expect(refused).toBe(true);

    const got: Array<{ type: string; t: number; players: Array<{ name: string; x: number }>; people: unknown[]; clock: { weather: string } }> = [];
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/feed`);
      const stop = setTimeout(() => {
        ws.close();
        reject(new Error(`only ${got.length} snapshots`));
      }, 4000);
      ws.on("message", (d) => {
        got.push(JSON.parse(String(d)));
        if (got.length >= 3) {
          clearTimeout(stop);
          ws.close();
          resolve();
        }
      });
      ws.on("error", reject);
    });
    expect(got[0].type).toBe("snap");
    expect(got[0].players).toEqual([expect.objectContaining({ name: "Jef", x: 10 })]);
    expect(got[0].people.length).toBe(town(db).town.residents.length);
    expect(got[0].clock.weather).toBe("clear");
    // 250 ms apart (the first comes at once on connecting)
    expect(got[2].t - got[1].t).toBeGreaterThanOrEqual(150);
    expect(got[2].t - got[1].t).toBeLessThan(1000);
    db.close();
  });
});
