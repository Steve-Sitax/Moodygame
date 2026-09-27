// A try of the town map with no game running (docs/mapview.md): a new game's save in memory (never
// data/game.sqlite), a made-up feed (two players, twenty townspeople walked live, omnibuses, boats, a
// train, cranes, drays and the lock bridge), on port 8799. It stops by itself.
//
//   node src/mapview/demo.ts            (from server/; MAP_DEMO_PORT, MAP_DEMO_SECONDS to change)
import { openDb } from "../db.ts";
import { town } from "../town/store.ts";
import { MapModel, mountMapView, type PuppetIn } from "./index.ts";
import { plannedSpot } from "./model.ts";

const port = Number(process.env.MAP_DEMO_PORT) || 8799;
const seconds = Number(process.env.MAP_DEMO_SECONDS) || 300;
const db = openDb(":memory:");
const model = new MapModel();
// the game's clock at 14:00, clear, so the town is out and about
db.prepare("UPDATE player SET hour = 14, minute = 0 WHERE id = 1").run();
const view = mountMapView({ model, db, port });
const t0 = Date.now();

const tw = town(db).town;
const walked = tw.residents.filter((_r, i) => i % 9 === 0).slice(0, 20);
const clockNow = () => {
  const m = 14 * 60 + Math.floor((Date.now() - t0) / 1000); // a game minute a second
  return { day: 1, hour: Math.floor(m / 60) % 24, minute: m % 60 };
};

const tick = setInterval(() => {
  const s = (Date.now() - t0) / 1000;
  const c = clockNow();
  db.prepare("UPDATE player SET hour = ?, minute = ? WHERE id = 1").run(c.hour, c.minute);
  model.players([
    { id: 1, name: "Steve", host: true, x: 20 + Math.sin(s / 20) * 40, y: 1.7, z: 12 + Math.cos(s / 20) * 6, yaw: s / 5, mode: "walk", away: false, online: true, vx: 1.2, vz: 0 },
    { id: 2, name: "Piet", host: false, x: -250 + Math.cos(s / 15) * 15, y: 1.7, z: 100 + Math.sin(s / 15) * 15, yaw: -s / 3, mode: "walk", away: s % 60 > 50, online: true },
  ]);
  const mine: PuppetIn[] = [];
  const his: PuppetIn[] = [];
  walked.forEach((r, i) => {
    const p = plannedSpot(r, tw, c);
    const a = s / 6 + i;
    const e: PuppetIn = {
      id: r.id,
      x: p.x + Math.cos(a) * 4,
      z: p.z + Math.sin(a) * 4,
      yaw: a + Math.PI / 2,
      speed: 0.7,
      motion: i % 5 === 0 ? "sit" : "walk",
      sit: i % 5 === 0,
      lantern: false,
      sack: i % 4 === 0,
      bought: null,
      vehicle: i % 7 === 3 ? "cart" : null,
    };
    (i % 2 ? his : mine).push(e);
  });
  model.puppets(1, mine);
  model.puppets(2, his);
  model.owners([...mine.map((e) => ({ id: e.id, owner: 1 })), ...his.map((e) => ({ id: e.id, owner: 2 }))], true);
  /** Back and forth between a and b at v m/s. */
  const lane = (a: number, b: number, v: number) => {
    const L = b - a;
    const u = (((s * v) % (2 * L)) + 2 * L) % (2 * L);
    return a + (u > L ? 2 * L - u : u);
  };
  model.world(Date.now(), {
    buses: [
      { id: "A", line: "Grote Markt - Entrepot", x: lane(-250, 150, 3), z: 60, yaw: Math.PI / 2, stop: "Vismarkt", load: 7 },
      { id: "B", line: "Steen - Keizerspoort", x: 0, z: lane(40, 330, 2.5), yaw: 0, stop: "Sint-Jansplein", load: 3 },
    ],
    boats: [
      { id: "anna_maria", name: "Anna Maria", kind: "brig", x: -42, z: -8, yaw: Math.PI / 2, moored: true },
      { id: "lighter1", name: "De Hoop", kind: "lighter", x: lane(-400, 200, 2), z: -40, yaw: Math.PI / 2, cargo: "coffee" },
      { id: "liner", name: "Vaderland", kind: "liner", x: 150 - lane(0, 500, 1), z: -65, yaw: -Math.PI / 2, tide: "high" },
    ],
    train: [{ id: "goods", x: lane(-300, 80, 4), z: 4, yaw: Math.PI / 2, wagons: 6 }],
    cranes: [
      { id: "crane1", x: -18, z: 4, turn: s % 360 },
      { id: "crane2", x: 66, z: 70, turn: 0 },
    ],
    drays: [{ id: "d1", x: lane(-200, 60, 1.5), z: 9, yaw: Math.PI / 2, loaded: true }],
    bridges: { lock_bridge: { open: s % 40 > 20 ? 1 : 0 }, canal_mouth: { open: 0 } },
    lock: { level: Math.round((Math.sin(s / 10) + 1) * 50) / 100, gates: "closed" },
  });
}, 100);

void view.ready.then((url) => console.log(`[map demo] ${url} for ${seconds} s`));
setTimeout(() => {
  clearInterval(tick);
  void view.close().then(() => {
    db.close();
    console.log("[map demo] stopped");
    process.exit(0);
  });
}, seconds * 1000);
