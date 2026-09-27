// M8f goods pass 2 (docs/milestones/M8f.md "Goods pass 2"): bake the quays' heaps into shared/quaycargo.json:
// every heap as laid (its models, where and how) for the PCs, and every cask, crate and sack of them (ids, places,
// turns, what rests on what) for the server's list. The heaps are searched for by the client (world/quaygoods.ts:
// the walk map, the props, the keep-outs; `?quaybake` searches afresh instead of laying the baked ones), so the
// list is read from a game tab once the heaps stand and the town's places have taken away the heaps too near them.
// Laid from the bake, the heaps stand the same on every PC. Run it again after a change to the heaps, the quays or
// what stands on them (a heap model gone makes the PCs search afresh and warn; the tab's check,
// `__scheldemist.jobs.goods.cargoCheck()`, lists cargo whose heap does not stand where the list has it).
//
//   node tools/teststack.mjs start bake --server 8970 --vite 5370
//   node tools/bake-quaycargo.mjs --base http://127.0.0.1:5370/ [--cdp 9222]
//   node tools/teststack.mjs stop bake --server 8970 --vite 5370
//
// Without --cdp it starts a headless Chrome of its own (--chrome <path>, default the usual Windows place) and
// stops it at the end. Never against Steve's game (5173).

import path from "node:path";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const base = opt("base", "http://127.0.0.1:5341/");
if (/:5173\b/.test(base)) throw new Error("5173 is Steve's own game: bake on a test stack");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const guard = setTimeout(() => {
  console.error("bake-quaycargo: timed out");
  process.exit(2);
}, 420_000);

let chrome = null;
let profile = null;
let port = Number(opt("cdp", 0));
if (!port) {
  port = 9380 + Math.floor(Math.random() * 40);
  profile = mkdtempSync(path.join(tmpdir(), "bake-quaycargo-"));
  const exe = opt("chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
  chrome = spawn(exe, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
      break;
    } catch {
      await sleep(500);
    }
  }
}

async function tab(url) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT", signal: AbortSignal.timeout(5000) })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  let id = 0;
  const wait = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wait.has(m.id)) (wait.get(m.id)(m), wait.delete(m.id));
  };
  const send = (method, params = {}) => new Promise((r) => {
    const i = ++id;
    wait.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send("Page.enable");
  await send("Page.navigate", { url });
  const ev = async (expression, ms = 60_000) => {
    const r = await Promise.race([send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => ({ timeout: true }))]);
    if (r.timeout) throw new Error("evaluate timed out");
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r.result?.result?.value;
  };
  const close = async () => {
    ws.close();
    await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`, { signal: AbortSignal.timeout(5000) }).catch(() => {});
    await sleep(300);
  };
  return { ev, close };
}

try {
  const t = await tab(base + (base.includes("?") ? "&" : "?") + "quaybake");
  // the game up, the heaps built, the town's places in (the heaps too near them taken away), steady for 20 s
  // (in the game, by the start, as a player would be: the search looks at what stands and moves round the quays then)
  await t.ev(`new Promise(r => { const i = setInterval(() => { if (window.__scheldemist?.t && window.__scheldemist.town?.data) { clearInterval(i); r(1); } }, 500); setTimeout(() => r(0), 240000); })`, 250_000);
  await t.ev(`__scheldemist.free?.(true); __scheldemist.t?.go?.([4.24, 10.48]); "ok"`);
  await t.ev(`new Promise(r => { const i = setInterval(() => { if (window.__scheldemist?.quayGoods?.info?.()) { clearInterval(i); r(1); } }, 500); setTimeout(() => r(0), 240000); })`, 250_000);
  // (read at one moment: the heaps and their cargo, once nothing has changed for 20 s and the town's places are in)
  const read = `import("/src/world/quaygoods.ts").then(m => JSON.stringify({ rows: m.quayCargo(), heaps: m.quayHeapsBake(), points: window.__scheldemist?.paths ? 1 : 0 }))`;
  let last = "";
  let got = null;
  for (let k = 0; k < 24; k++) {
    await sleep(5000);
    const now = await t.ev(read);
    if (now === last && k >= 4) {
      got = JSON.parse(now);
      break;
    }
    last = now;
  }
  if (!got) throw new Error("the heaps did not settle in two minutes");
  const { rows, heaps } = got;
  await t.ev(`__scheldemist.t?.done?.(); "d"`).catch(() => {});
  await t.close();
  if (!rows.length) throw new Error("no cargo: the heaps did not build");
  const out = path.join(root, "shared", "quaycargo.json");
  const body = [
    "{",
    `  "_": "M8f goods pass 2: the quays' heaps as laid (client world/quaygoods.ts: heaps, rng) and every cask, crate and sack of them, the server's items (items: [id, model, kind, x, y, z, turn, height, rests on, heavy]). Made by tools/bake-quaycargo.mjs; do not edit by hand.",`,
    `  "rng": ${heaps.rng},`,
    `  "heaps": [`,
    heaps.heaps.map((h) => "    " + JSON.stringify(h)).join(",\n"),
    "  ],",
    `  "items": [`,
    rows.map((r) => "    " + JSON.stringify(r)).join(",\n"),
    "  ]",
    "}",
    "",
  ].join("\n");
  writeFileSync(out, body);
  const kinds = {};
  for (const r of rows) kinds[r[2]] = (kinds[r[2]] ?? 0) + 1;
  console.log(`bake-quaycargo: ${heaps.heaps.length} heaps (${heaps.heaps.filter((h) => h.g).length} taken away), ${rows.length} items (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(", ")}) -> ${path.relative(root, out)}`);
} finally {
  clearTimeout(guard);
  if (chrome) {
    chrome.kill();
    await sleep(800);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // (Chrome may still hold a file a moment)
    }
  }
}
process.exit(0);
