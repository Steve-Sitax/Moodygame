import * as THREE from "three";
import "./press.css";
import type { Convo, Job, JobsPayload, LettersTask, PocketItem, PushMsg } from "../net/api";
import type { FirstPerson } from "../player/firstPerson";
import type { World } from "../world/rijnkaai";
import { psx } from "../retro/psx";
import { esc, RUN_MAKERS, type Action, type Run, type RunCtx } from "./runs";
import { chest, type Target } from "./facing";
import type { Bubbles } from "./bubbles";
import type { Jobs } from "./jobs";
import type { Town } from "./town";
import { dialogs } from "./dialogs";

// The paper, the post and the pawn office on the client (M6). The server owns
// every fact and number (server/src/paper/); this side shows them: the newsboys'
// cries as bubbles, the paper page, letters and pawn tickets to read from the
// pockets, the Berg's counter and the post counter (F by the clerk), the signs
// over the two doors, and the round of letters as a job to walk.

interface Corner {
  id: string;
  label: string;
  x: number;
  z: number;
  yaw: number;
  boy: string;
}
interface PressInfo {
  paper: { day: number; name: string; price_c: number; printed: boolean; cry: string | null; headline: string | null };
  corners: Corner[];
  post: { step: [number, number]; wall: [number, number]; out: [number, number]; label: string; clerk: string; at: { x: number; z: number } | null } | null;
  berg: { shop: string; clerk: string; label: string; door: [number, number]; wall: [number, number]; out: [number, number] } | null;
  medal: string;
}
interface Paper {
  day: number;
  name: string;
  date: string;
  price_c: number;
  cry: string;
  headline: string;
  articles: Array<{ fact: number; kind: string; headline: string; text: string }>;
  shipping: Array<{ ship: number; dir: "in" | "out"; line: string }>;
  /** The day's work, in the engine's words (the server adds them). */
  notices?: string[];
  source: string;
}
interface LetterView {
  id: number;
  date: string;
  from: string;
  salutation: string;
  body: string;
  closing: string;
  signature: string;
  telegram: string;
  offer: { kind: string; pay_c: number; fee_c: number; to_name?: string; city?: string };
  job: { id: number; status: string; title: string; pay_c: number; today: boolean } | null;
}
interface BergView {
  label: string;
  clerk: string | null;
  clerk_name: string | null;
  open: boolean;
  day: number;
  offers: Array<{ item: number; kind: string; name: string; loan_c: number }>;
  tickets: Array<{ id: number; name: string; loan_c: number; rate_c: number; due_day: number; redeem_c: number }>;
  terms: string;
}
interface PostView {
  label: string;
  clerk: string | null;
  clerk_name: string | null;
  open: boolean;
  waiting: number;
  telegram_fee_c: number;
  telegram_words: number;
  round: Job | null;
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

const REACH_COUNTER = 3.2;
const REACH_DOOR = 2.4;
const SHOUT_M = 28;
const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export class Press {
  info: PressInfo | null = null;
  private shoutT = new Map<string, number>();
  private convoId = -1;
  private readonly page: HTMLDivElement;
  private pageOpen: null | { kind: "paper" | "letter" | "ticket" | "berg" | "post"; keys: Record<string, () => void> } = null;
  private signs: THREE.Object3D[] = [];
  /** Dev: the cries shown. */
  readonly cries: string[] = [];

  constructor(
    private readonly world: World,
    private readonly player: FirstPerson,
    private readonly jobs: Jobs,
    private readonly town: Town,
    private readonly bubbles: Bubbles,
  ) {
    this.page = document.createElement("div");
    this.page.className = "press-page";
    this.page.style.display = "none";
    document.body.appendChild(this.page);
    window.addEventListener("keydown", (e) => this.onKey(e), true);
    dialogs.register("press page", () => this.isOpen); // focus fix: the pause knows it is up (game/dialogs.ts)

    // reading from the pockets
    jobs.pockets.onRead = (it) => setTimeout(() => void this.read(it), 0);
    // F at the Berg's counter or the post counter
    jobs.extraActions.push((x, z) => ({ extra: this.counterActions(x, z) }));
    // the round of letters plays as its own job
    RUN_MAKERS.letters = (job, ctx) => new LettersRun(job, job.task as LettersTask, ctx);
    void this.load();
  }

  async load(): Promise<void> {
    try {
      this.info = await call<PressInfo>("GET", "/api/press");
      this.buildSigns();
    } catch {
      setTimeout(() => void this.load(), 4000);
    }
  }

  handlePush(m: PushMsg): void {
    if (m.type === "paper" && this.info) {
      this.info.paper = { ...this.info.paper, day: Number(m.day), printed: true, cry: String(m.cry ?? ""), headline: String(m.headline ?? "") };
    } else if (m.type === "press" && typeof m.text === "string") {
      this.jobs.say(m.text);
    } else if (m.type === "clerk" && typeof m.who === "string" && typeof m.text === "string") {
      this.say(m.who, String(m.name ?? "The clerk"), m.text);
    }
  }

  /** A line over someone's head, through the M4 bubbles (with the made voice). */
  say(who: string, name: string, text: string): void {
    const c: Convo = { id: this.convoId--, a: who, b: who, a_name: name, b_name: name, purpose: "chat", lines: [{ who, name, text }], source: "engine", outcome: "", at: Date.now(), event_id: null };
    this.bubbles.show(c);
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number): void {
    const inf = this.info;
    if (!inf?.paper.printed || !inf.paper.cry) return;
    for (const c of inf.corners) {
      let t = (this.shoutT.get(c.boy) ?? 1 + Math.random() * 3) - dt;
      if (t <= 0) {
        t = 8 + Math.random() * 6;
        const at = this.town.position(c.boy);
        if (at && dist(at.x, at.z, this.player.x, this.player.z) < SHOUT_M && this.town.isAtWork(c.boy) && !this.town.held(c.boy)) {
          const who = this.town.info(c.boy);
          const cry = Math.random() < 0.7 ? inf.paper.cry : `${inf.paper.name}, ${inf.paper.price_c} centimes! ${cap(inf.paper.headline?.toLowerCase() ?? "")}!`;
          this.say(c.boy, who?.first ?? "Newsboy", cry);
          this.town.gesture(c.boy, this.player.x, this.player.z, 2.5);
          this.cries.push(cry);
          if (this.cries.length > 20) this.cries.shift();
        }
      }
      this.shoutT.set(c.boy, t);
    }
  }

  // ------------------------------------------------------------------ signs over the doors

  private buildSigns(): void {
    for (const s of this.signs) s.removeFromParent();
    this.signs = [];
    const inf = this.info;
    if (!inf) return;
    if (inf.post) this.signs.push(this.sign(inf.post.wall, inf.post.out, ["POST OFFICE", "TELEGRAPH"], "#2c3b2a", 3.25));
    if (inf.berg) this.signs.push(this.sign(inf.berg.wall, inf.berg.out, ["BERG VAN", "BARMHARTIGHEID"], "#3a2320", 3.9));
  }

  private sign(wall: [number, number], out: [number, number], lines: string[], bg: string, y: number): THREE.Object3D {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 128;
    const g = c.getContext("2d")!;
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 128);
    g.strokeStyle = "#c9b27a";
    g.lineWidth = 6;
    g.strokeRect(8, 8, 496, 112);
    g.fillStyle = "#e3cf94";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "bold 44px 'Scheldemist Print', Georgia, 'Times New Roman', serif";
    lines.forEach((l, i) => g.fillText(l, 256, 64 + (i - (lines.length - 1) / 2) * 48));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), psx(new THREE.MeshLambertMaterial({ map: tex }), { affine: 0.5 }));
    m.position.set(wall[0] + out[0] * 0.42, y, wall[1] + out[1] * 0.42);
    m.rotation.y = Math.atan2(out[0], out[1]);
    this.world.scene.add(m);
    return m;
  }

  // ------------------------------------------------------------------ counters

  /** The clerk in reach: where to look (their chest; game/facing.ts), or null. */
  private clerkNear(id: string | undefined, x: number, z: number): Target | null {
    if (!id) return null;
    const at = this.town.position(id);
    if (!at || dist(at.x, at.z, x, z) >= REACH_COUNTER) return null;
    const pup = this.town.puppet(id);
    return pup ? chest(pup.group, 1.3 * pup.size) : { x: at.x, z: at.z };
  }

  private counterActions(x: number, z: number): Action[] {
    const out: Action[] = [];
    const inf = this.info;
    if (!inf || this.jobs.talk.isOpen) return out;
    const berg = this.clerkNear(inf.berg?.clerk, x, z);
    const post = berg ? null : this.clerkNear(inf.post?.clerk, x, z);
    if (berg) out.push({ key: "KeyF", text: "the Berg's counter: pawn or redeem", run: () => void this.openBerg(), at: berg });
    else if (post) out.push({ key: "KeyF", text: "the post office counter", run: () => void this.openPost(), at: post });
    return out;
  }

  /** M7 shops: the Berg's counter from inside the pawn office (game/interiors.ts, E at the counter). */
  openBergCounter(): void {
    void this.openBerg();
  }

  private async openBerg(msg = ""): Promise<void> {
    let v: BergView;
    try {
      v = await call<BergView>("GET", "/api/berg");
    } catch (e) {
      return this.jobs.say((e as Error).message);
    }
    const keys: Record<string, () => void> = {};
    let n = 0;
    const rows: string[] = [];
    if (!v.open) rows.push(`<p class="shut">The counter is shut. The Berg opens in the morning.</p>`);
    else {
      rows.push(`<h4>Lend on it</h4>`);
      if (!v.offers.length) rows.push(`<p class="none">You have nothing the Berg will lend on.</p>`);
      for (const o of v.offers) {
        const k = String(++n);
        rows.push(`<li><span class="n">${k}</span><span class="what">${esc(cap(o.name))}${o.item === 0 ? " <i>(sewn in your coat)</i>" : ""}</span><span class="price">${o.loan_c} c</span></li>`);
        keys[`Digit${k}`] = () => void this.act("/api/berg/pawn", { item: o.item }, () => this.openBerg());
      }
      rows.push(`<h4>Your tickets</h4>`);
      if (!v.tickets.length) rows.push(`<p class="none">No pledges here.</p>`);
      for (const t of v.tickets) {
        const k = String(++n);
        rows.push(`<li><span class="n">${k}</span><span class="what">No. ${1000 + t.id}: ${esc(t.name)}<i class="sub">lent ${t.loan_c} c at ${t.rate_c} c a day; redeem by ${DAYS[(t.due_day - 1) % 7]} night</i></span><span class="price">redeem ${t.redeem_c} c</span></li>`);
        keys[`Digit${k}`] = () => void this.act("/api/berg/redeem", { pawn: t.id }, () => this.openBerg());
      }
    }
    const money = this.jobs.debug().money;
    this.show(
      "berg",
      `<div class="counter"><h2>${esc(cap(v.label))}</h2><p class="sub">${v.clerk_name ? `${esc(v.clerk_name)} behind the grille` : "The counter"}${money !== undefined ? ` &middot; you have ${money} c` : ""}</p>
       <ol>${rows.join("")}</ol><p class="terms">${esc(v.terms)}</p>${msg ? `<p class="msg">${esc(msg)}</p>` : ""}
       <p class="keys">${n ? `${n > 1 ? `1-${n}` : "1"} choose &middot; ` : ""}E or Esc to step away</p></div>`,
      keys,
    );
  }

  private async openPost(msg = ""): Promise<void> {
    let v: PostView;
    try {
      v = await call<PostView>("GET", "/api/post");
    } catch (e) {
      return this.jobs.say((e as Error).message);
    }
    const keys: Record<string, () => void> = {};
    const rows: string[] = [];
    if (!v.open) rows.push(`<p class="shut">The office is shut. Open from eight in the morning till seven at night, not on Sunday.</p>`);
    else {
      // the choices are numbered from 1 in the order shown (QA 2026-09-24: the round alone showed as "2")
      let k = 0;
      if (v.waiting) {
        const n = ++k;
        rows.push(`<li><span class="n">${n}</span> ${v.waiting === 1 ? "A letter waits" : `${v.waiting} letters wait`} for you in the pigeonholes</li>`);
        keys[`Digit${n}`] = () => void this.act("/api/post/collect", {}, () => this.openPost());
      } else rows.push(`<p class="none">"Nothing for you in the pigeonholes."</p>`);
      if (v.round) {
        const n = ++k;
        rows.push(`<li><span class="n">${n}</span> ${esc(v.round.title)}: ${esc(v.round.pitch)}<span class="price">${v.round.pay_c} c</span></li>`);
        keys[`Digit${n}`] = () => void this.takeJob(v.round!);
      } else rows.push(`<p class="none">No round of letters to give out today.</p>`);
    }
    rows.push(`<p class="terms">Telegrams: ${v.telegram_fee_c} centimes for ${v.telegram_words} words, anywhere in the kingdom.</p>`);
    this.show(
      "post",
      `<div class="counter"><h2>${esc(cap(v.label))}</h2><p class="sub">${v.clerk_name ? `${esc(v.clerk_name)} at the counter` : ""}</p>
       <ol>${rows.join("")}</ol>${msg ? `<p class="msg">${esc(msg)}</p>` : ""}<p class="keys">${Object.keys(keys).length > 1 ? "1-2 choose &middot; " : Object.keys(keys).length ? "1 choose &middot; " : ""}E or Esc to step away</p></div>`,
      keys,
    );
  }

  /** One counter request at a time: 1 then 2 pressed quickly does not buy, pawn or take twice. */
  private acting = false;

  private async takeJob(j: Job): Promise<void> {
    if (this.acting) return;
    this.acting = true;
    try {
      await call("POST", `/api/jobs/${j.id}/take`);
      this.close();
      this.jobs.say(`You take the work: ${j.title}.`);
    } catch (e) {
      this.jobs.say((e as Error).message);
    } finally {
      this.acting = false;
    }
  }

  private async act(url: string, body: unknown, again: () => Promise<void>): Promise<void> {
    if (this.acting) return;
    this.acting = true;
    try {
      const r = await call<JobsPayload & { text: string }>("POST", url, body);
      this.jobs.refresh(r);
      this.jobs.say(r.text);
      await again();
    } catch (e) {
      this.jobs.say((e as Error).message);
    } finally {
      this.acting = false;
    }
  }

  // ------------------------------------------------------------------ reading

  private async read(it: PocketItem): Promise<void> {
    try {
      if (it.kind === "newspaper") return this.showPaper(await call<Paper>("GET", `/api/paper/${it.ref}`), it);
      if (it.kind === "letter" && it.ref) return this.showLetter(await call<LetterView>("GET", `/api/letter/${it.ref}`), it);
      if (it.kind === "letter") return this.jobs.say("A letter for someone else. Not yours to open.");
      if (it.kind === "pawn_ticket") return this.showTicket(await call("GET", `/api/ticket/${it.ref}`));
    } catch (e) {
      this.jobs.say((e as Error).message);
    }
  }

  showPaper(p: Paper, it?: PocketItem): void {
    const [lead, ...rest] = p.articles;
    const art = (a: Paper["articles"][number], big = false) => `<article class="${big ? "lead" : ""}"><h3>${esc(a.headline)}</h3><p>${esc(a.text)}</p></article>`;
    const ins = p.shipping.filter((s) => s.dir === "in");
    const outs = p.shipping.filter((s) => s.dir === "out");
    const keys: Record<string, () => void> = {};
    if (it) keys.KeyD = () => void this.discard(it);
    this.show(
      "paper",
      `<div class="newspaper">
        <div class="mast"><span class="ear">No. ${9000 + p.day}</span><h1>${esc(p.name)}</h1><span class="ear">${p.price_c} centimes</span></div>
        <div class="dateline">van Antwerpen &middot; ${esc(p.date)} &middot; commerce, shipping and the town</div>
        ${lead ? art(lead, true) : ""}
        <div class="cols">${rest.map((a) => art(a)).join("")}
          <article class="ships"><h3>SHIPPING INTELLIGENCE</h3>
            ${ins.length ? `<h4>Arrived</h4>${ins.map((s) => `<p>${esc(s.line)}</p>`).join("")}` : ""}
            ${outs.length ? `<h4>Sailed</h4>${outs.map((s) => `<p>${esc(s.line)}</p>`).join("")}` : ""}
          </article>
          ${p.notices?.length ? `<article class="ships"><h3>WANTED</h3>${p.notices.map((n) => `<p>${esc(n)}</p>`).join("")}</article>` : ""}
        </div>
        <p class="keys">E or Esc to fold it${it ? " &middot; D to leave it on a bench" : ""}</p>
      </div>`,
      keys,
    );
  }

  private showLetter(l: LetterView, it: PocketItem): void {
    const keys: Record<string, () => void> = { KeyD: () => void this.discard(it) };
    let offer = "";
    if (l.job) {
      if (l.job.status === "offered" && l.job.today) {
        offer = `<p class="offer">${esc(l.job.title)}${l.job.pay_c ? `, ${l.job.pay_c} centimes` : ", no pay"}. <b>T</b> to take it on.</p>`;
        keys.KeyT = () => void this.takeJob({ id: l.job!.id, title: l.job!.title } as Job);
      } else if (l.job.status === "taken") offer = `<p class="offer">You have taken this on.</p>`;
      else if (l.job.status === "done") offer = `<p class="offer">Done.</p>`;
      else offer = `<p class="offer">Too late for that now.</p>`;
    }
    this.show(
      "letter",
      `<div class="letter"><p class="date">Antwerp, ${esc(l.date)}</p><p>${esc(l.salutation)}</p><p class="body">${esc(l.body)}</p>
       ${l.telegram ? `<p class="wire">To be wired${l.offer.city ? ` to ${esc(l.offer.city)}` : ""}: <b>${esc(l.telegram)}</b></p>` : ""}
       <p class="close">${esc(l.closing)}<br>${esc(l.signature)}</p>${offer}
       <p class="keys">E or Esc to fold it &middot; D to throw it away</p></div>`,
      keys,
    );
  }

  private showTicket(t: { no: number; name: string; loan_c: number; rate_c: number; day: number; due: string; redeem_c: number; status: string }): void {
    this.show(
      "ticket",
      `<div class="ticket"><p class="head">BERG VAN BARMHARTIGHEID &middot; ANTWERPEN</p><p class="no">No. ${t.no}</p>
       <p>Pledge: ${esc(t.name)}</p><p>Lent: ${t.loan_c} centimes, on ${DAYS[(t.day - 1) % 7]}.</p>
       <p>Interest: ${t.rate_c} centimes for each day begun.</p><p>To redeem today: <b>${t.redeem_c} centimes</b>.</p>
       <p class="due">Redeem by ${esc(t.due)}, or the pledge is sold.</p><p class="keys">E or Esc to put it away</p></div>`,
      {},
    );
  }

  private async discard(it: PocketItem): Promise<void> {
    try {
      const r = await call<JobsPayload>("POST", "/api/pockets/discard", { id: it.id });
      this.jobs.refresh(r);
      this.close();
    } catch (e) {
      this.jobs.say((e as Error).message);
    }
  }

  // ------------------------------------------------------------------ the page

  private show(kind: NonNullable<Press["pageOpen"]>["kind"], html: string, keys: Record<string, () => void>): void {
    this.page.innerHTML = html;
    this.page.className = `press-page ${kind}`;
    this.page.style.display = "block";
    this.pageOpen = { kind, keys };
    this.player.frozen = true;
  }

  get isOpen(): boolean {
    return this.pageOpen !== null;
  }

  close(): void {
    if (!this.pageOpen) return;
    this.pageOpen = null;
    this.page.style.display = "none";
    this.player.frozen = false;
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.pageOpen) return;
    e.stopPropagation();
    if (e.repeat) return;
    if (e.code === "KeyE" || e.code === "Escape" || e.code === "KeyF") return this.close();
    const k = this.pageOpen.keys[e.code];
    if (k) k();
  }

  // ------------------------------------------------------------------ checks

  /** For the path check: every corner, the post office door and counter, the Berg's door. */
  pathPoints(): Array<{ label: string; x: number; z: number; reach: number }> {
    const out: Array<{ label: string; x: number; z: number; reach: number }> = [];
    const inf = this.info;
    if (!inf) return out;
    for (const c of inf.corners) out.push({ label: `newsboy's corner ${c.label}`, x: c.x, z: c.z, reach: 2.4 });
    if (inf.post) {
      out.push({ label: "the post office door", x: inf.post.step[0], z: inf.post.step[1], reach: 1.8 });
      if (inf.post.at) out.push({ label: "the post office counter", x: inf.post.at.x, z: inf.post.at.z, reach: 2.4 });
    }
    if (inf.berg) out.push({ label: "the Berg van Barmhartigheid door", x: inf.berg.door[0], z: inf.berg.door[1], reach: 1.8 });
    return out;
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ------------------------------------------------------------------ the round of letters

/**
 * A round of letters (or a telegram to send): fetch them where the job starts (E),
 * then E at each door (a letter under it) or at the telegraph counter (pay the fee,
 * the clerk sends it). The server checks each stop and counts them; when all are
 * done the job is reported and the server pays by its own count.
 */
class LettersRun implements Run {
  private picked: boolean;
  private done: boolean[];
  private busy = false;
  private finished = false;

  constructor(
    private readonly job: Job,
    private task: LettersTask,
    private readonly ctx: RunCtx,
  ) {
    this.picked = !!task.picked;
    this.done = task.stops.map((s) => !!s.done);
    if (!this.picked) ctx.toast(this.tele ? `Fetch the words for the wire at ${task.from.label}.` : `Fetch the ${task.stops.length === 1 ? "letter" : "letters"} at ${task.from.label}.`);
    if (this.picked && this.done.every(Boolean)) this.finish();
  }

  private get tele(): boolean {
    return this.task.stops.some((s) => s.what === "telegraph");
  }

  private next(): number {
    return this.done.findIndex((d) => !d);
  }

  update(): void {}

  actions(): Action[] {
    if (this.busy || this.finished) return [];
    const { x, z } = this.ctx.player;
    if (!this.picked) {
      if (dist(x, z, this.task.from.x, this.task.from.z) < REACH_DOOR + 0.8)
        return [{ key: "KeyE", text: this.tele ? "take the words for the telegram" : this.task.stops.length === 1 ? "take the letter" : "take the letters", run: () => void this.call("/api/post/pickup"), at: { x: this.task.from.x, z: this.task.from.z } }];
      return [];
    }
    const out: Action[] = [];
    this.task.stops.forEach((s, i) => {
      if (this.done[i] || out.length) return;
      const reach = s.what === "telegraph" ? REACH_COUNTER : REACH_DOOR;
      if (dist(x, z, s.x, s.z) > reach) return;
      if (s.what === "door") out.push({ key: "KeyE", text: `put the letter under the door of ${s.name}`, run: () => void this.call("/api/post/deliver", i), at: { x: s.x, z: s.z } });
      else out.push({ key: "KeyE", text: `send the telegram (${this.task.fee_c} c)`, run: () => void this.call("/api/post/telegram"), at: { x: s.x, z: s.z } });
    });
    return out;
  }

  private async call(url: string, index?: number): Promise<void> {
    this.busy = true;
    try {
      const r = await call<JobsPayload & { text: string }>("POST", url, { job: this.job.id, index, x: this.ctx.player.x, z: this.ctx.player.z });
      this.ctx.refresh(r);
      const j = r.jobs.find((x) => x.id === this.job.id);
      if (j?.task?.kind === "letters") {
        this.task = j.task;
        this.picked = !!j.task.picked;
        this.done = j.task.stops.map((s) => !!s.done);
      }
      this.ctx.toast(r.text);
      if (this.picked && this.done.every(Boolean)) this.finish();
    } catch (e) {
      this.ctx.toast((e as Error).message);
    } finally {
      this.busy = false;
    }
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    const n = this.done.filter(Boolean).length;
    this.ctx.progress({ delivered: n, lost: 0, sold: 0 });
    this.ctx.finish({ delivered: n });
  }

  carryActions(): Action[] {
    return [];
  }
  placeLabel(): string | null {
    return null;
  }
  onPlaced(): void {}
  onLost(): void {}

  goal(): THREE.Vector3 | null {
    if (this.finished) return null;
    if (!this.picked) return new THREE.Vector3(this.task.from.x, 0, this.task.from.z);
    const i = this.next();
    if (i < 0) return null;
    const s = this.task.stops[i];
    return new THREE.Vector3(s.x, 0, s.z);
  }

  hud(): string {
    const n = this.task.stops.length;
    const left = this.done.filter((d) => !d).length;
    if (!this.picked) return `<b>${esc(this.job.title)}</b><br>Fetch ${this.tele ? "the words" : n === 1 ? "the letter" : "the letters"} at ${esc(this.task.from.label)}`;
    const i = this.next();
    if (i < 0) return `<b>${esc(this.job.title)}</b><br>All done.`;
    const s = this.task.stops[i];
    return `<b>${esc(this.job.title)}</b><br>${s.what === "telegraph" ? `Send it at the telegraph counter (${this.task.fee_c} c)` : `Next: the door of ${esc(s.name)}`}${n > 1 ? `<br>${n - left} of ${n} delivered` : ""}`;
  }

  dispose(): void {}
}
