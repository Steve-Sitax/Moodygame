// Dev check for the focus fix (Steve 2026-09-26: "going into another window ... and going back to the
// browser, a dialog in progress stays on screen and cannot be used anymore"). `__scheldemist.t.focusTest()`
// opens each kind of dialog, leaves the window (the lock lost, blur, no focus), comes back (focus, then a
// key the dialog uses) and checks that the game plays again and the dialog took the key. Also by the menu
// (Esc, Esc) and by P's pause. Test save only; a few server calls, one model call for the talk's opening
// line and one for a trouble card (only when `trouble: true`).
import { dialogs } from "../game/dialogs";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type How = "away" | "menu" | "pkey";
interface Result {
  dialog: string;
  how: How;
  key: string;
  pausedWhileAway: boolean;
  upWhileAway: boolean;
  playsAfter: boolean;
  reacted: boolean;
  ok: boolean;
  note?: string;
}

const S = () => (window as unknown as { __scheldemist: Any }).__scheldemist;
const wait = (ms: number) => new Promise<void>((r) => S().real.setTimeout(r, ms));
async function until(ok: () => boolean, ms: number): Promise<boolean> {
  const end = S().real.now() + ms;
  while (!ok()) {
    if (S().real.now() > end) return false;
    await wait(80);
  }
  return true;
}

/** A key as the browser sends it: to the focused element (the body, or a dialog's input), down then up. */
function press(code: string, key: string, up = true): void {
  const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { code, key, bubbles: true, cancelable: true }));
  if (up) target.dispatchEvent(new KeyboardEvent("keyup", { code, key, bubbles: true, cancelable: true }));
}

/** Leave the window as the browser does it: the mouse lock goes, the window loses focus. */
async function leave(how: How): Promise<void> {
  const s = S();
  s.player.freeInput = false; // as in play: the game has the mouse lock, not the dev's free input
  if (how === "pkey") {
    s.t.pause(true);
    await wait(100);
    return;
  }
  const away = how === "away";
  (document as Any).hasFocus = () => !away;
  if (away) window.dispatchEvent(new Event("blur"));
  document.dispatchEvent(new Event("pointerlockchange"));
  await wait(350); // main.ts looks again after 150 ms
  if (how === "menu") press("Escape", "Escape"); // the menu is up (Esc with the window in focus): Esc closes it
  await wait(100);
}

/** Come back: the window has focus again; P's pause is left with P. */
async function comeBack(how: How): Promise<void> {
  (document as Any).hasFocus = () => true;
  window.dispatchEvent(new Event("focus"));
  if (how === "pkey") press("KeyP", "p");
  await wait(60);
}

function restore(): void {
  delete (document as Any).hasFocus;
  S().free(true);
}

async function cycle(dialog: string, how: How, open: () => Promise<unknown> | unknown, isUp: () => boolean, key: [string, string], reacted: () => boolean, ms = 8000, before?: () => Promise<void>): Promise<Result> {
  const r: Result = { dialog, how, key: key[1], pausedWhileAway: false, upWhileAway: false, playsAfter: false, reacted: false, ok: false };
  try {
    restore();
    if (!isUp()) await open();
    if (!(await until(isUp, 10_000))) {
      r.note = "the dialog did not open";
      return r;
    }
    if (before) await before();
    await leave(how);
    r.pausedWhileAway = S().pause.paused;
    r.upWhileAway = isUp();
    await comeBack(how);
    press(key[0], key[1]);
    r.playsAfter = !S().pause.paused;
    r.reacted = await until(reacted, ms);
    r.ok = r.pausedWhileAway && r.upWhileAway && r.playsAfter && r.reacted;
  } catch (e) {
    r.note = String((e as Error)?.message ?? e);
  } finally {
    restore();
  }
  return r;
}

/** Close whatever dialog is up (between the checks). */
async function closeAll(): Promise<void> {
  const s = S();
  s.jobs.talk.close();
  s.ideas.close(true);
  s.press.close();
  (s.interiors as Any).dice?.close();
  await wait(50);
}

export async function focusTest(opts: { trouble?: boolean; only?: string[] } = {}): Promise<{ ok: boolean; dialogs: string[]; results: Result[] }> {
  const s = S();
  const t = s.t;
  t.guard("focusTest()");
  const talk = s.jobs.talk as Any;
  const want = (n: string) => !opts.only || opts.only.includes(n);
  const results: Result[] = [];
  const add = async (p: Promise<Result>) => {
    const r = await p;
    results.push(r);
    await closeAll();
  };
  await closeAll();

  // a townsperson near to talk with, and one who sells (the shop list)
  const residents = (s.town.data?.residents ?? []) as Array<{ id: string; name: string; trade: string }>;
  const near = t.find("").filter((p: Any) => p.shown && !["police", "customs", "soldier", "sentry", "priest"].includes(p.trade));
  const seller = residents.find((r) => talk.sells(r.id));

  // 1. the trouble card (a model call writes it): 1 chooses
  if (opts.trouble && want("trouble")) {
    for (const how of ["away", "menu", "pkey"] as How[]) {
      await add(
        cycle(
          "trouble card",
          how,
          async () => {
            await t.job({ type: "carry" });
            await fetch("/api/dev/ideas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trouble: "customs" }) });
            s.ideas.shownTrouble.clear(); // the server may give the new trouble an old one's id
            await s.ideas.load();
            // the card shows once the job has run its first seconds (real ones: the card's clock is performance.now)
            for (let i = 0; i < 8 && !s.ideas.isOpen; i++) {
              await wait(600);
              t.run(0.5);
            }
          },
          () => s.ideas.isOpen,
          ["Digit1", "1"],
          () => !s.ideas.isOpen,
          10_000,
        ),
      );
    }
  }

  // 2. a talk waiting on its reply (the opening line on its way when the window is left), then idle: T opens the input
  if (want("talk") && near[0]) {
    const who = near[0];
    const speaker = { id: who.id, def: { name: who.name, title: who.trade } };
    // waiting: a line of Jef's own on its way to the model when the window is left; back with a click on the
    // talk (T does nothing while it waits); the reply held by the pause must come, and the "..." go
    const r: Result = { dialog: "talk, reply on its way", how: "away", key: "click", pausedWhileAway: false, upWhileAway: false, playsAfter: false, reacted: false, ok: false };
    try {
      restore();
      talk.open(speaker);
      await until(() => talk.busy === false, 20_000);
      await wait(1500); // the gate's "too fast"
      const before = talk.lines.length;
      void talk.devSay("Good day. Is there any news on the quay today?");
      await wait(30);
      const busyAtLeave = talk.busy === true;
      await leave("away");
      r.pausedWhileAway = s.pause.paused;
      r.upWhileAway = talk.isOpen;
      // the model's line comes in meanwhile; the pause holds it (game/pause.ts)
      await wait(9000);
      const heldWhileAway = talk.busy === true;
      await comeBack("away");
      (document.querySelector(".talk") as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      r.playsAfter = !s.pause.paused;
      r.reacted = await until(() => talk.busy === false && talk.lines.length > before + 1, 25_000);
      r.note = `busy when left: ${busyAtLeave}, still waiting while away: ${heldWhileAway}, lines before ${before}, after ${talk.lines.length}: ${JSON.stringify(talk.lines.at(-1)?.text ?? "").slice(0, 80)}`;
      r.ok = busyAtLeave && heldWhileAway && r.pausedWhileAway && r.upWhileAway && r.playsAfter && r.reacted;
    } catch (e) {
      r.note = String((e as Error)?.message ?? e);
    } finally {
      restore();
    }
    results.push(r);
    // idle, the same talk: T opens his own words (no model call)
    for (const how of ["away", "menu", "pkey"] as How[]) {
      results.push(
        await cycle(
          "talk",
          how,
          () => talk.open(speaker),
          () => talk.isOpen && !talk.busy,
          ["KeyT", "t"],
          () => talk.typing === true,
          3000,
          async () => {
            talk.typing = false;
            talk.render();
          },
        ),
      );
    }
    // typing in the talk's own words when the window is left: back, Enter reaches the input (empty: no model
    // call, the input closes)
    results.push(
      await cycle(
        "talk, typing",
        "away",
        () => {
          if (!talk.isOpen) talk.open(speaker);
          talk.input.value = "";
          talk.typing = true;
          talk.render();
        },
        () => talk.isOpen && talk.typing === true && document.activeElement === talk.input,
        ["Enter", "Enter"],
        () => talk.typing === false,
        3000,
      ),
    );
    await closeAll();
  } else if (want("talk")) results.push({ dialog: "talk", how: "away", key: "-", pausedWhileAway: false, upWhileAway: false, playsAfter: false, reacted: false, ok: false, note: "nobody near to talk with: go('vismarkt') first" });

  // 3. the shop list (B's list, no model call): H opens the haggle (the list with one ware) or its picker
  if (want("shop") && seller) {
    const speaker = { id: seller.id, def: { name: seller.name, title: seller.trade } };
    for (const how of ["away", "menu", "pkey"] as How[]) {
      await add(
        cycle(
          "shop list",
          how,
          () => talk.open(speaker, true),
          () => talk.isOpen && talk.shopping && !talk.picking && !talk.typing,
          ["KeyH", "h"],
          () => talk.picking === true || talk.typing === true,
          3000,
        ),
      );
    }
  }

  // 4. a press page (the Berg's counter): E steps away
  if (want("press")) {
    for (const how of ["away", "menu", "pkey"] as How[]) {
      await add(cycle("press page (Berg counter)", how, () => s.press.openBergCounter(), () => s.press.isOpen, ["KeyE", "e"], () => !s.press.isOpen, 3000));
    }
  }

  // 5. the tavern dice: 1 throws for the first stake (the server answers; its word shows on the panel)
  if (want("dice")) {
    const dice = (s.interiors as Any).dice;
    const who = near[0] ?? { id: "nobody", name: "a docker" };
    for (const how of ["away", "menu", "pkey"] as How[]) {
      await add(
        cycle(
          "tavern dice",
          how,
          () => dice.show("tavern:focus", { id: who.id, name: who.name, first: String(who.name).split(" ")[0] }, "focus check", [5], { games: 3, loss_c: 50 }, 100),
          () => dice.open,
          ["Digit1", "1"],
          () => dice.line !== "focus check" && !dice.busy,
          5000,
        ),
      );
    }
  }

  // 6. the night gang's demand (a dev gang, no model call): R runs
  if (want("gang")) {
    const night = s.night as Any;
    await add(
      cycle(
        "gang",
        "away",
        () => t.gang(),
        () => !!night.gang && !night.sent,
        ["KeyR", "r"],
        () => night.sent === true || !night.gang,
        8000,
      ),
    );
  }

  const ok = results.length > 0 && results.every((r) => r.ok);
  return { ok, dialogs: dialogs.names(), results };
}

/** A picture of the tab as the player sees it: the game's picture with the papers on it (the dialog, the hint, the menu). */
export async function snap(name: string): Promise<string> {
  const s = S();
  const canvas = s.renderer.domElement as HTMLCanvasElement;
  s.retro.render(s.world.scene, s.player.camera, 0);
  const base = canvas.toDataURL("image/png");
  const W = window.innerWidth;
  const H = window.innerHeight;
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const g = out.getContext("2d")!;
  const load = (src: string) =>
    new Promise<HTMLImageElement>((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error("did not draw"));
      img.src = src;
    });
  g.drawImage(await load(base), 0, 0, W, H);
  let css = "";
  for (const sh of Array.from(document.styleSheets)) {
    try {
      for (const r of Array.from(sh.cssRules)) css += r.cssText + "\n";
    } catch {
      /* a sheet from elsewhere */
    }
  }
  // every paper on screen above the picture, as it stands (the body's own children that show)
  const shown = Array.from(document.body.children).filter((el) => {
    if (el === canvas || el.tagName === "SCRIPT" || el.tagName === "CANVAS") return false;
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && (el as HTMLElement).offsetWidth > 0;
  });
  const html = shown.map((el) => new XMLSerializer().serializeToString(el)).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" class="${document.body.className}" style="${(document.documentElement.getAttribute("style") ?? "").replace(/"/g, "'")}"><style>${css.replace(/<\/style/g, "")}</style>${html}</div></foreignObject></svg>`;
  try {
    g.drawImage(await load("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)), 0, 0);
  } catch {
    /* the papers did not draw: the picture alone */
  }
  // the drawn papers (the city map, the round map in the corner): an SVG picture leaves a canvas blank
  for (const el of shown) {
    for (const c of Array.from(el.querySelectorAll("canvas"))) {
      const r = c.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && c.width > 0) g.drawImage(c, r.left, r.top, r.width, r.height);
    }
  }
  const url = out.toDataURL("image/jpeg", 0.92);
  const r = await fetch("/api/dev/shot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, url }) });
  return r.ok ? `data/shots/${name}.jpg` : `failed ${r.status}`;
}

// ------------------------------------------------------------------ the mouse in the dialogs

interface MouseResult {
  dialog: string;
  target: string;
  hover: boolean;
  reacted: boolean;
  lookStill: boolean;
  ok: boolean;
  note?: string;
}

/** As in play: the game holds the mouse lock (faked: the preview pane refuses a real one). */
function fakeLock(on: boolean): void {
  const s = S();
  delete (document as Any).hasFocus;
  if (on) {
    s.free(true);
    s.player.freeInput = false;
    s.player.locked = true;
  } else {
    s.player.locked = false;
    s.free(true);
  }
}

/** Move the ink cursor onto an element as the locked mouse does; true when it shows it is over it. */
function moveOnto(el: Element): boolean {
  const ink = S().ink as Any;
  ink.sync();
  const r = el.getBoundingClientRect();
  const { x, y } = ink.info();
  ink.devMove(r.left + Math.min(r.width / 2, 40) - x, r.top + r.height / 2 - y);
  return el.classList.contains("ink-hot") || !!el.querySelector(".ink-hot") || el.closest(".ink-hot") !== null;
}

/** A click of the locked mouse: on the picture (the lock's element); the ink cursor takes it. */
function clickLocked(): void {
  (S().renderer.domElement as HTMLCanvasElement).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

async function mouseCase(dialog: string, target: string, open: () => Promise<unknown> | unknown, find: () => Element | null | undefined, reacted: () => boolean, ms = 5000): Promise<MouseResult> {
  const s = S();
  const r: MouseResult = { dialog, target, hover: false, reacted: false, lookStill: false, ok: false };
  try {
    fakeLock(false);
    await open();
    let el: Element | null | undefined = null;
    await until(() => !!(el = find()), 10_000);
    if (!el) {
      r.note = "not on screen";
      return r;
    }
    fakeLock(true);
    const yaw = s.player.yaw;
    const pitch = s.player.pitch;
    r.hover = moveOnto(el);
    r.lookStill = s.player.yaw === yaw && s.player.pitch === pitch;
    clickLocked();
    r.reacted = await until(reacted, ms);
    r.ok = r.hover && r.reacted && r.lookStill;
  } catch (e) {
    r.note = String((e as Error)?.message ?? e);
  } finally {
    fakeLock(false);
  }
  return r;
}

const q = (sel: string) => document.querySelector(sel);
const keyEl = (root: string, code: string) => q(`${root} [data-key="${code}"]`);

export async function mouseTest(opts: { trouble?: boolean; only?: string[] } = {}): Promise<{ ok: boolean; results: MouseResult[] }> {
  const s = S();
  const t = s.t;
  t.guard("mouseTest()");
  const talk = s.jobs.talk as Any;
  const want = (n: string) => !opts.only || opts.only.includes(n);
  const out: MouseResult[] = [];
  await closeAll();
  const near = t.find("").filter((p: Any) => p.shown && !["police", "customs", "soldier", "sentry", "priest"].includes(p.trade));
  const residents = (s.town.data?.residents ?? []) as Array<{ id: string; name: string; trade: string }>;
  const seller = residents.find((r) => talk.sells(r.id));

  if (want("talk") && near[0]) {
    const speaker = { id: near[0].id, def: { name: near[0].name, title: near[0].trade } };
    // T: say it your way (the key hint is a button), then a click in the input puts the cursor there
    out.push(await mouseCase("talk", "T  say it your way", () => talk.open(speaker), () => (talk.busy ? null : keyEl(".talk", "KeyT")), () => talk.typing === true, 3000));
    out.push(await mouseCase("talk", "the input", () => {}, () => (talk.typing ? talk.input : null), () => document.activeElement === talk.input, 2000));
    talk.typing = false;
    talk.render();
    // a choice: the line itself (one model call for the answer)
    const n0 = talk.lines.length;
    out.push(await mouseCase("talk", "choice 1", () => {}, () => (talk.choices.length ? keyEl(".talk", "Digit1") : null), () => talk.lines.length > n0, 4000));
    await until(() => !talk.busy, 20_000);
    out.push(await mouseCase("talk", "E  step away", () => {}, () => keyEl(".talk", "KeyE"), () => !talk.isOpen, 2000));
    await closeAll();
  }

  if (want("shop") && seller) {
    const speaker = { id: seller.id, def: { name: seller.name, title: seller.trade } };
    let m0 = 0;
    out.push(
      await mouseCase(
        "shop list",
        "ware 1 (buy)",
        () => {
          talk.open(speaker, true);
          m0 = talk.money;
        },
        () => keyEl(".talk", "Digit1"),
        () => talk.money !== m0 || talk.note !== "",
        5000,
      ),
    );
    out.push(await mouseCase("shop list", "H  argue a price", () => (talk.note = ""), () => keyEl(".talk", "KeyH"), () => talk.picking === true || talk.typing === true, 2000));
    talk.picking = false;
    talk.typing = false;
    talk.haggleKind = null;
    talk.render();
    out.push(await mouseCase("shop list", "B  back to talk", () => {}, () => keyEl(".talk", "KeyB"), () => talk.shopping === false, 2000));
    await closeAll();
  }

  if (opts.trouble && want("trouble")) {
    out.push(
      await mouseCase(
        "trouble card",
        "option 1",
        async () => {
          await t.job({ type: "carry" });
          await fetch("/api/dev/ideas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trouble: "customs" }) });
          s.ideas.shownTrouble.clear();
          await s.ideas.load();
          for (let i = 0; i < 8 && !s.ideas.isOpen; i++) {
            await wait(600);
            t.run(0.5);
          }
        },
        () => (s.ideas.isOpen ? keyEl(".ideas-page", "Digit1") : null),
        () => !s.ideas.isOpen,
        10_000,
      ),
    );
    await closeAll();
  }

  if (want("press")) {
    out.push(await mouseCase("press page (Berg counter)", "E or Esc to step away", () => s.press.openBergCounter(), () => (s.press.isOpen ? keyEl(".press-page", "KeyE") : null), () => !s.press.isOpen, 3000));
    await closeAll();
  }

  if (want("pockets")) {
    const pk = s.jobs.pockets as Any;
    out.push(
      await mouseCase(
        "pockets",
        "I to close",
        () => {
          if (!pk.open) pk.toggle();
        },
        () => (pk.open ? keyEl(".pocket-panel", "KeyI") : null),
        () => !pk.open,
        2000,
      ),
    );
    if (pk.open) pk.toggle();
  }

  if (want("board")) {
    const jobs = s.jobs as Any;
    // the first line of work (the board's own take is watched, not run: no job taken); the board's keys
    // line may stand below a small window's edge
    let took = -1;
    jobs.take = async (i: number) => void (took = i);
    try {
      out.push(await mouseCase("job board", "work 1", () => jobs.openBoard(), () => (jobs.boardOpen ? keyEl(".board", "Digit1") : null), () => took === 0, 2000));
    } finally {
      delete jobs.take; // the class's own again
    }
    if (jobs.boardOpen) jobs.closeBoard();
  }

  if (want("dice")) {
    const dice = (s.interiors as Any).dice;
    const who = near[0] ?? { id: "nobody", name: "a docker" };
    out.push(
      await mouseCase(
        "tavern dice",
        "1  throw for 5 c",
        () => dice.show("tavern:focus", { id: who.id, name: who.name, first: String(who.name).split(" ")[0] }, "focus check", [5], { games: 3, loss_c: 50 }, 100),
        () => keyEl(".dice-panel", "Digit1"),
        () => dice.line !== "focus check" && !dice.busy,
        5000,
      ),
    );
    out.push(await mouseCase("tavern dice", "E  stop", () => {}, () => keyEl(".dice-panel", "KeyE"), () => !dice.open, 2000));
    dice.close();
  }

  if (want("confessional")) {
    const panel = (s.landmarks as Any).panel;
    out.push(await mouseCase("confessional", "the input", () => panel.open("The curate waits behind the grille.", () => {}), () => (panel.openNow ? q(".confession input") : null), () => document.activeElement === panel.input, 2000));
    out.push(await mouseCase("confessional", "Esc  get up", () => {}, () => keyEl(".confession", "Escape"), () => !panel.openNow, 2000));
    panel.close(true);
  }

  if (want("gang")) {
    const night = s.night as Any;
    out.push(await mouseCase("gang", "R: run", () => t.gang(), () => (night.gang && !night.sent ? q('[data-key="KeyR"]') : null), () => night.sent === true || !night.gang, 8000));
  }

  await closeAll();
  const ok = out.length > 0 && out.every((r) => r.ok);
  return { ok, results: out };
}
