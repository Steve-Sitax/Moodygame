// The Godot port, the talk part: the browser's own pictures of each window, to set Godot's beside them
// (godot/src/Talk, godot/src/Ui/Dialogs). On the recipe of tools/godot/export-scene.mjs: a test stack of its own
// with no AI (walk-around mode: no model call is made), the game in headless Chrome over the debug port, each
// window opened by script, a picture of the tab.
//
//   node tools/godot/talk-refs.mjs --out godot/baked/talkref [--ports 8954,5354]
//
// Written: <out>/ref_<window>.png and <out>/refs.json (what each window showed). The stack is stopped and its save
// deleted at the end. Needs a save (data/game.sqlite: start the server once) and `node client/scripts/copy-draco.mjs`.

import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const out = path.resolve(root, opt("out", "godot/baked/talkref"));
const [SERVER, VITE] = String(opt("ports", "8954,5354")).split(",").map(Number);
for (const p of [SERVER, VITE]) if ([8787, 5173, 8080, 8088, 8090].includes(p)) throw new Error(`port ${p} is not for tests`);
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"].find((p) => existsSync(p));
if (!CHROME) throw new Error("no Chrome found");
mkdirSync(out, { recursive: true });
mkdirSync(path.join(root, "data"), { recursive: true });

// walk-around mode for the stack's server (docs/ai-setup.md): the settings file is the test's own
const aiConfig = path.join(root, "data", "talkref.ai-config.json");
writeFileSync(aiConfig, JSON.stringify({ version: 1, mode: "walk", typedLines: "same", callsPerDay: 120, default: { provider: "recommended" }, kinds: {}, connections: { anthropic_api: {}, openai_compat: { baseUrl: "https://api.openai.com/v1" }, ollama: { baseUrl: "http://127.0.0.1:11434" } } }));
const env = { ...process.env, SCHELDEMIST_AI_CONFIG: aiConfig };
const stack = (cmd) => execFileSync(process.execPath, [path.join(root, "tools/teststack.mjs"), cmd, `talkref${SERVER}`, "--server", String(SERVER), "--vite", String(VITE)], { stdio: "inherit", timeout: 180_000, env });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9400 + Math.floor(Math.random() * 400);
const profile = path.join(os.tmpdir(), `scheldemist-talkref-${PORT}`);
let chrome = null;
let ws = null;
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
async function ev(expr, timeoutMs = 60_000) {
  const r = await Promise.race([send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }), sleep(timeoutMs).then(() => null)]);
  if (!r) throw new Error(`timed out: ${expr.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result?.result?.value;
}

async function openGame() {
  chrome = spawn(CHROME, ["--headless=new", "--enable-gpu", "--ignore-gpu-blocklist", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--window-size=1600,900", "--mute-audio", "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 60 && !ws; i++) {
    try {
      const pg = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((p) => p.type === "page");
      if (pg) {
        ws = new WebSocket(pg.webSocketDebuggerUrl);
        await new Promise((r) => ws.addEventListener("open", r));
      }
    } catch {
      /* not up yet */
    }
    if (!ws) await sleep(300);
  }
  if (!ws) throw new Error("Chrome did not start");
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d);
      pending.delete(d.id);
    }
  });
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://127.0.0.1:${VITE}/` });
  for (let i = 0; i < 240; i++) {
    const ok = await ev(`!!(window.__scheldemist && __scheldemist.t) && !document.querySelector("#boot:not(.gone)")`, 10_000).catch(() => false);
    if (ok === true) return;
    await sleep(1000);
  }
  throw new Error("the game did not load");
}

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const shown = {};
/** A picture of the tab as it is, and the words on the papers now. */
async function shot(name, sel) {
  await ev(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))`).catch(() => 0);
  await sleep(250);
  const png = await send("Page.captureScreenshot", { format: "png" });
  if (png.result?.data) writeFileSync(path.join(out, `ref_${name}.png`), Buffer.from(png.result.data, "base64"));
  if (sel) shown[name] = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { text: e.innerText, box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }; })()`).catch((e) => String(e));
  log("picture", name);
}
const key = (code, k) => ev(`(window.dispatchEvent(new KeyboardEvent("keydown", { code: ${JSON.stringify(code)}, key: ${JSON.stringify(k)}, bubbles: true, cancelable: true })), window.dispatchEvent(new KeyboardEvent("keyup", { code: ${JSON.stringify(code)}, key: ${JSON.stringify(k)}, bubbles: true })), 1)`);
const until = async (expr, ms = 30_000) => {
  for (let t = 0; t < ms; t += 250) {
    if (await ev(expr).catch(() => false)) return true;
    await sleep(250);
  }
  return false;
};
/** One step: what goes wrong in it is written down and the next step still runs. */
const step = async (name, f) => {
  try {
    await f();
  } catch (e) {
    shown[`${name}_failed`] = String(e?.message ?? e);
    log(name, "failed:", String(e?.message ?? e).slice(0, 200));
  }
};

let code = 0;
let started = false;
try {
  stack("start");
  started = true;
  await openGame();
  await ev(`(__scheldemist.free(true), 1)`);
  await ev(`__scheldemist.t.light(13, "clear").then(() => 1)`);
  // a new game opens on the ferry: ashore first, so the windows are the ordinary ones
  await ev(`fetch("/api/arrival/ashore", { method: "POST" }).then(() => 1).catch(() => 1)`);
  await ev(`Promise.resolve(__scheldemist.t.go("vismarkt")).then(() => 1)`);
  await ev(`(__scheldemist.t.run(2), 1)`);
  await ev(`window.S = __scheldemist, window.talk = S.jobs.talk, 1`);

  // who sells: the first resident with wares; and Fientje of the quay
  const seller = await ev(`(() => { const r = (S.town.data?.residents ?? []).find((r) => talk.sells(r.id)); return r ? { id: r.id, name: r.name, trade: r.trade } : null; })()`);
  shown.seller = seller;
  const speaker = seller ? `{ id: ${JSON.stringify(seller.id)}, def: { name: ${JSON.stringify(seller.name)}, title: ${JSON.stringify(seller.trade)} } }` : `{ id: "fientje", def: { name: "Fientje" } }`;

  await step("talk", async () => {
    await ev(`(talk.open(${speaker}), 1)`);
    await shot("talk_wait", ".talk");
    await until(`talk.isOpen && !talk.busy`);
    await shot("talk", ".talk");
    await key("Digit1", "1");
    await until(`!talk.busy`);
    await shot("talk_choice", ".talk");
    await ev(`(talk.typing = true, talk.render(), 1)`);
    await shot("talk_typing", ".talk");
    await ev(`(talk.typing = false, talk.render(), 1)`);
    await key("KeyT", "t");
    await shot("talk_no_ai", ".talk");
    await ev(`(talk.close(), 1)`);
  });

  await step("work", async () => {
    await ev(`(talk.open({ id: "sooi", def: { name: "Sooi" } }), 1)`);
    await until(`talk.isOpen && !talk.busy`);
    await shot("talk_sooi", ".talk");
    await key("KeyW", "w");
    await shot("talk_work", ".talk");
    await ev(`(S.key && S.key("KeyW", false), talk.close(), 1)`);
  });

  await step("shop", async () => {
    await ev(`(talk.open(${speaker}, true), 1)`);
    await sleep(800);
    await shot("shop", ".talk");
    await key("Digit1", "1");
    await sleep(1200);
    await shot("shop_bought", ".talk");
    await key("KeyH", "h");
    await shot("shop_haggle", ".talk");
    await ev(`(talk.close(), 1)`);
    // a herring too, to have something to eat in the pockets
    await ev(`(talk.open({ id: "fientje", def: { name: "Fientje" } }, true), 1)`);
    await sleep(600);
    await key("Digit1", "1");
    await sleep(1000);
    await shot("shop_fientje", ".talk");
    await ev(`(talk.close(), 1)`);
  });

  await step("paper", async () => {
    await ev(`__scheldemist.t.light(9, "clear").then(() => 1)`); // the newsboys cry and the counters are open in the morning
    // the day's paper bought from a newsboy, then read from the pockets
    const boy = await ev(`fetch("/api/press").then((r) => r.json()).then((j) => j.corners[0].boy)`);
    await ev(`fetch("/api/buy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ npc: ${JSON.stringify(boy)}, kind: "newspaper" }) }).then((r) => r.text())`).then((r) => (shown.bought_paper = String(r).slice(0, 160)));
    const paper = await ev(`fetch("/api/jobs").then((r) => r.json()).then((j) => (S.jobs.refresh(j), j.pockets.find((p) => p.kind === "newspaper") || null))`);
    shown.paper_item = paper;
    if (paper) {
      await ev(`(S.jobs.pockets.onRead(${JSON.stringify(paper)}), 1)`);
      await until(`S.press.isOpen`, 5000);
      await shot("paper", ".press-page");
      await ev(`(S.press.close(), 1)`);
    }
  });

  await step("berg", async () => {
    await ev(`(S.press.openBergCounter(), 1)`);
    await until(`S.press.isOpen`, 5000);
    await shot("berg", ".press-page");
    await key("Digit1", "1"); // pawn the first thing
    await sleep(1500);
    await shot("berg_pawned", ".press-page");
    await ev(`(S.press.close(), 1)`);
    const ticket = await ev(`fetch("/api/jobs").then((r) => r.json()).then((j) => (j.pockets.find((p) => p.kind === "pawn_ticket") || {}).ref ?? null)`);
    if (ticket != null) {
      await ev(`fetch("/api/ticket/${ticket}").then((r) => r.json()).then((t) => (S.press.showTicket(t), 1))`);
      await shot("ticket", ".press-page");
      await ev(`(S.press.close(), 1)`);
    }
  });

  await step("post", async () => {
    await ev(`(S.press.openPost(), 1)`);
    await until(`S.press.isOpen`, 5000);
    await shot("post", ".press-page");
    await ev(`(S.press.close(), 1)`);
  });

  await step("letter", async () => {
    // a letter as the server writes them (dev route), fetched at the post counter
    await ev(`fetch("/api/dev/press", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ letter: true }) }).then((r) => r.text())`).then((r) => (shown.dev_press = String(r).slice(0, 300)));
    await ev(`fetch("/api/post/collect", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((r) => r.text())`).then((r) => (shown.collect = String(r).slice(0, 200)));
    const letter = await ev(`fetch("/api/jobs").then((r) => r.json()).then((j) => (S.jobs.refresh(j), j.pockets.find((p) => p.kind === "letter" && p.ref) || null))`);
    shown.letter_item = letter;
    if (letter) {
      await ev(`(S.jobs.pockets.onRead(${JSON.stringify(letter)}), 1)`);
      await until(`S.press.isOpen`, 5000);
      await shot("letter", ".press-page");
      await ev(`(S.press.close(), 1)`);
    }
  });

  await step("pockets", async () => {
    await ev(`fetch("/api/jobs").then((r) => r.json()).then((j) => (S.jobs.refresh(j), 1))`);
    await key("KeyI", "i");
    await shot("pockets", ".pocket-panel");
    await key("KeyI", "i");
  });

  await step("bill", async () => {
    const n = await ev(`S.ideas.load().then(() => (S.ideas.view?.posters ?? []).length).catch(() => -1)`);
    shown.posters = n;
    if (n > 0) {
      await ev(`(S.ideas.showBill(S.ideas.view.posters[0]), 1)`);
      await shot("bill", ".ideas-page");
      await ev(`(S.ideas.close(true), 1)`);
    }
  });

  await step("dice", async () => {
    await ev(`(S.interiors.dice.show("tavern:focus", { id: "r001", name: "Ward Cuypers", first: "Ward" }, "The cup is yours. What do you put down?", [5, 10, 25], { games: 3, loss_c: 50 }, 100), 1)`);
    await shot("dice", ".dice-panel");
    await ev(`(S.interiors.dice.close(), 1)`);
  });

  await step("book", async () => {
    await ev(`fetch("/api/jobs").then((r) => r.json()).then((j) => { const o = j.jobs.find((x) => x.status === "offered" && x.playable); return o ? S.jobs.devTake(o.id) : "none"; })`).then((r) => (shown.took = r));
    await key("KeyJ", "j");
    await shot("book", ".board.book, .book");
    await key("KeyJ", "j");
  });

  await step("bubble", async () => {
    const who = await ev(`(() => { const p = S.t.find("").find((p) => p.shown); return p ? { id: p.id, name: p.name } : null; })()`);
    shown.bubble_who = who;
    if (who) {
      await ev(`Promise.resolve(S.t.meet(${JSON.stringify(who.name)})).then(() => 1)`);
      await ev(`(S.press.say(${JSON.stringify(who.id)}, ${JSON.stringify(who.name.split(" ")[0])}, "Handelsblad, five centimes! Today in the town!"), S.t.run(0.5), 1)`);
      await shot("bubble", ".bubble.on");
    }
  });

  writeFileSync(path.join(out, "refs.json"), JSON.stringify(shown, null, 2));
  log("done:", out);
} catch (e) {
  console.error(e);
  writeFileSync(path.join(out, "refs.json"), JSON.stringify({ ...shown, failed: String(e?.stack ?? e) }, null, 2));
  code = 1;
} finally {
  try {
    await ev(`Promise.resolve(__scheldemist.t.done()).then(() => 1)`, 10_000);
  } catch {
    /* the page is gone */
  }
  try {
    ws?.close();
  } catch {
    /* closed */
  }
  chrome?.kill();
  if (started) {
    try {
      stack("stop");
    } catch (e) {
      console.error("stop failed:", e?.message ?? e);
    }
  }
  rmSync(aiConfig, { force: true });
  await sleep(500);
  rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
}
process.exit(code);
