// The Godot port's check of "where everyone is" (godot/src/Town/Whereabouts.cs is a port of
// server/src/town/whereabouts.ts): this asks a running server for the town and its ways, runs the server's own
// sum for every resident at a few hours, and writes the answers. The Godot self-test (`-- --peopletest dir`)
// reads them from <dir>/where_expected.json and compares its own.
//
//   node tools/godot/wherecheck.mjs --server http://127.0.0.1:8960 --out <dir>/where_expected.json [--day 1] [--hours 6.5,8,10.5,13.5,18,22]

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { whereAt } from "../../server/src/town/whereabouts.ts";
import { wayKey } from "../../server/src/town/wayfind.ts";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const server = opt("server", "http://127.0.0.1:8960").replace(/\/$/, "");
const out = path.resolve(opt("out", "where_expected.json"));
const day = Number(opt("day", "1"));
const hours = opt("hours", "6.5,8,10.5,13.5,18,22").split(",").map(Number);
const get = async (p, body) => {
  const r = await fetch(server + p, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) } : { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return r.json();
};

const town = await get("/api/town");
const ways = new Map(Object.entries((await get("/api/town/ways")).ways));
const ask = new Set();
const way = (ax, az, bx, bz) => {
  const k = wayKey(ax, az, bx, bz);
  const w = ways.get(k);
  if (w === undefined) ask.add(k);
  return w;
};
const people = town.residents;
const all = () => hours.flatMap((hour) => people.map((r) => ({ r, hour, w: whereAt(r, town, day, hour, way) })));
// ways the plan did not have: asked for by key until none is missing (as the game does)
for (let turn = 0; turn < 40; turn++) {
  ask.clear();
  all();
  if (!ask.size) break;
  const keys = [...ask];
  for (let i = 0; i < keys.length; i += 60) {
    const part = keys.slice(i, i + 60);
    const got = (await get("/api/town/ways", { keys: part })).ways;
    for (const k of part) ways.set(k, got[k] ?? null);
  }
}
const rows = all().map(({ r, hour, w }) => ({ id: r.id, hour, x: w.x, z: w.z, indoor: w.indoor, moving: w.moving, act: w.act, place: w.place, stop: w.stop, leg: w.leg ?? null, cart: !!w.cart }));
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ day, hours, residents: people.length, rows }));
console.log(`${rows.length} answers for ${people.length} residents at ${hours.length} hours (day ${day}) -> ${out}; out in the street: ${hours.map((h) => `${h}: ${rows.filter((q) => q.hour === h && !q.indoor).length}`).join(", ")}`);
