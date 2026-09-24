import * as THREE from "three";
import type { JobsPayload, PushMsg } from "../net/api";
import type { FirstPerson } from "../player/firstPerson";
import type { World } from "../world/rijnkaai";
import type { Jobs } from "./jobs";
import type { Town } from "./town";
import { esc } from "./runs";

// M6 families and surprises, the client side. The server decides everything
// (director/families.ts, surprises.ts); this side only shows it:
// - a visit: someone came to find Jef; the talk window opens with them;
// - a menace: a man with a grudge has his say (bubbles); a small panel says what Jef can do:
//   run (walk away: the server hears "ran" beyond 12 m), T talk him down in his own words,
//   P pay; else when the time is up the server narrates it: the screen dims and a line tells it;
// - a supper, a lost coin, the cards' promise kept: a line, the screen dimmed for a supper;
// - a dream at night, on the night sheet;
// - strangers who arrive and leave: their name and day patched into the town the client loaded;
// - Madame Zelie's little table and cards on the Grote Markt.

const RAN_M = 12;
const MENACE_S = 12;
const TYPE_MAX_S = 45;
const VEIL_S = 6;

interface MenaceView {
  action: number;
  npc: string;
  name: string;
  kind: "knock_down" | "mug";
  demand_c: number;
  line: string;
}
interface VisitorView {
  id: string;
  name: string;
  first: string;
  label: string;
  here: boolean;
  sched: unknown;
}
interface State {
  fortune: { id: string; at: [number, number, number] | null } | null;
  visitors: VisitorView[];
  dream: { day: number; text: string } | null;
  menace: MenaceView | null;
  visit: { npc: string; name: string; title: string } | null;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const d = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
  return d;
}

const CSS = `
.fam-panel{position:fixed;left:50%;bottom:16%;transform:translateX(-50%);max-width:460px;padding:10px 14px;z-index:30;display:none;font-size:14px;line-height:1.35}
.fam-panel .who{font-weight:bold}
.fam-panel .keys{margin-top:6px;opacity:.85;font-size:13px}
.fam-panel .bar{height:3px;background:#6b2a1a;margin-top:6px;transition:width .2s linear}
.fam-panel input{width:100%;margin-top:6px;font:inherit;padding:3px 5px;box-sizing:border-box}
.fam-veil{position:fixed;inset:0;background:rgba(8,6,4,.78);z-index:40;display:none;align-items:center;justify-content:center;pointer-events:none}
.fam-veil p{max-width:520px;color:#e8dcc4;font-size:17px;line-height:1.5;text-align:center;padding:0 24px;font-style:italic}
.night .dream{font-style:italic;opacity:.9;border-top:1px solid rgba(0,0,0,.2);padding-top:8px}
`;

export class Families {
  private panel: HTMLDivElement;
  private veil: HTMLDivElement;
  private input: HTMLInputElement;
  private menace: MenaceView | null = null;
  private menaceT = 0;
  private typing = false;
  private typeT = 0;
  private sent = false;
  private veilT = 0;
  private visit: { npc: string; name: string; title: string; t: number } | null = null;
  private table: THREE.Group | null = null;
  private lastDream = "";
  /** Dev: what was shown. */
  readonly log: string[] = [];

  constructor(
    private readonly world: World,
    private readonly player: FirstPerson,
    private readonly jobs: Jobs,
    private readonly town: Town,
  ) {
    const st = document.createElement("style");
    st.textContent = CSS;
    document.head.appendChild(st);
    this.panel = document.createElement("div");
    this.panel.className = "fam-panel paper";
    document.body.appendChild(this.panel);
    this.veil = document.createElement("div");
    this.veil.className = "fam-veil";
    document.body.appendChild(this.veil);
    this.input = document.createElement("input");
    this.input.maxLength = 300;
    this.input.placeholder = "Your own words, then Enter (Esc: never mind)";
    window.addEventListener("keydown", (e) => this.onKey(e), true);
  }

  /** After the town loaded: the strangers' names and days, the fortune teller's table, a menace in progress. */
  async load(): Promise<void> {
    try {
      const r = await fetch("/api/families/state");
      const s = (await r.json()) as State;
      for (const v of s.visitors) this.patchVisitor(v);
      if (s.fortune?.at) this.buildTable(s.fortune.at);
      if (s.menace) this.showMenace(s.menace);
      if (s.visit) this.visit = { ...s.visit, t: 25 };
      if (s.dream) this.lastDream = s.dream.text;
    } catch {
      // the server is away: nothing of this shows
    }
  }

  handlePush(m: PushMsg): void {
    if (m.type !== "families") return;
    const v = m.visitor as VisitorView | undefined;
    if (v) this.patchVisitor(v);
    const visit = m.visit as { npc: string; name: string; title: string } | undefined;
    if (visit) this.visit = { ...visit, t: 25 };
    const men = m.menace as MenaceView | undefined;
    if (men) this.showMenace(men);
    const end = m.menace_end as { outcome: string; text: string } | undefined;
    if (end) this.endMenace(end.outcome, end.text);
    if (typeof m.veil === "string") this.showVeil(m.veil);
    if (typeof m.say === "string") this.jobs.say(m.say);
    if (typeof m.dream === "string") this.showDream(m.dream);
  }

  // ---- strangers: the client loaded the town once; a stranger's name and day change in place

  private patchVisitor(v: VisitorView): void {
    const r = this.town.data?.residents.find((x) => x.id === v.id) as (Record<string, unknown> & { name: string }) | undefined;
    if (!r) return;
    r.name = v.name;
    r.first = v.first;
    r.label = v.label;
    r.sched = v.sched;
    this.log.push(`visitor ${v.name} ${v.here ? "here" : "away"}`);
  }

  // ---- visits: the talk window opens with them (once Jef is free)

  private openVisit(dt: number): void {
    const v = this.visit;
    if (!v) return;
    v.t -= dt;
    if (v.t <= 0) return void (this.visit = null);
    if (this.jobs.talk.isOpen || this.jobs.day.sheetOpen) return;
    const at = this.town.position(v.npc);
    if (at && Math.hypot(at.x - this.player.x, at.z - this.player.z) > 8) return;
    this.visit = null;
    this.jobs.talk.open({ id: v.npc, def: { name: v.name, title: v.title } });
    this.log.push(`visit ${v.name}`);
  }

  // ---- the menace

  private showMenace(m: MenaceView): void {
    this.menace = m;
    this.menaceT = MENACE_S;
    this.sent = false;
    this.typing = false;
    this.render();
    this.panel.style.display = "block";
    this.log.push(`menace ${m.name} ${m.kind} ${m.demand_c}`);
  }

  private render(): void {
    const m = this.menace;
    if (!m) return;
    const pay = m.demand_c > 0 ? `P: pay him ${m.demand_c} centimes` : "";
    const keys = ["Walk away fast: run", "T: talk him down", pay].filter(Boolean).join(" &nbsp;&middot;&nbsp; ");
    this.panel.innerHTML = `<div><span class="who">${esc(m.name.split(" ")[0])}</span> means you harm. Nobody fights here; get clear of him, talk, or pay. People about, or an agent near, would stop him.</div><div class="keys">${keys}</div><div class="bar" style="width:${Math.max(0, (this.menaceT / MENACE_S) * 100).toFixed(0)}%"></div>`;
    if (this.typing) {
      this.panel.appendChild(this.input);
      this.input.focus();
    }
  }

  private async answer(how: "ran" | "pay" | "stand"): Promise<void> {
    const m = this.menace;
    if (!m || this.sent) return;
    this.sent = true;
    try {
      const r = await post<JobsPayload & { result: { outcome: string; text: string } | null }>(`/api/families/menace/${m.action}`, { how });
      this.jobs.refresh(r);
      if (r.result) this.endMenace(r.result.outcome, r.result.text);
      else this.endMenace("", "");
    } catch {
      this.sent = false;
    }
  }

  private async talk(text: string): Promise<void> {
    const m = this.menace;
    if (!m || this.sent) return;
    this.sent = true;
    this.typing = false;
    this.input.value = "";
    this.input.blur();
    this.render();
    try {
      const r = await post<JobsPayload & { gated?: string; result?: { outcome: string; text: string } | null }>(`/api/families/menace/${m.action}/talk`, { text });
      this.jobs.refresh(r);
      if (r.gated) {
        this.sent = false;
        this.jobs.say(r.gated === "too fast" ? "Catch your breath first." : "Too many words at once.");
        return;
      }
      if (r.result) this.endMenace(r.result.outcome, r.result.text);
    } catch {
      this.sent = false;
    }
  }

  private endMenace(outcome: string, text: string): void {
    if (!this.menace) return;
    this.menace = null;
    this.typing = false;
    this.panel.style.display = "none";
    this.log.push(`menace end ${outcome}`);
    if (!text) return;
    if (outcome === "mugged" || outcome === "knocked_down") this.showVeil(text);
    else this.jobs.say(text);
  }

  private tickMenace(dt: number): void {
    const m = this.menace;
    if (!m || this.sent) return;
    const at = this.town.position(m.npc);
    if (at && Math.hypot(at.x - this.player.x, at.z - this.player.z) > RAN_M) return void this.answer("ran");
    if (this.typing) {
      this.typeT += dt;
      if (this.typeT > TYPE_MAX_S) {
        this.typing = false;
        this.render();
      }
      return;
    }
    if (this.jobs.talk.isOpen || this.jobs.day.sheetOpen) return;
    this.menaceT -= dt;
    const bar = this.panel.querySelector(".bar") as HTMLDivElement | null;
    if (bar) bar.style.width = `${Math.max(0, (this.menaceT / MENACE_S) * 100).toFixed(0)}%`;
    if (this.menaceT <= 0) void this.answer("stand");
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.menace || this.jobs.talk.isOpen || this.jobs.day.sheetOpen) return;
    if (this.typing) {
      e.stopPropagation();
      if (e.code === "Enter") {
        e.preventDefault();
        const t = this.input.value.trim();
        if (t) void this.talk(t);
      } else if (e.code === "Escape") {
        e.preventDefault();
        this.typing = false;
        this.render();
      }
      return;
    }
    if (e.repeat) return;
    if (e.code === "KeyT") {
      e.preventDefault();
      e.stopPropagation();
      this.typing = true;
      this.typeT = 0;
      this.render();
    } else if (e.code === "KeyP" && this.menace.demand_c > 0) {
      e.preventDefault();
      e.stopPropagation();
      void this.answer("pay");
    }
  }

  // ---- the dimmed screen with a line; the dream

  private showVeil(text: string): void {
    this.veil.innerHTML = `<p>${esc(text)}</p>`;
    this.veil.style.display = "flex";
    this.veilT = VEIL_S + text.length / 40;
    this.log.push(`veil ${text.slice(0, 60)}`);
  }

  private showDream(text: string): void {
    this.lastDream = text;
    const sheet = document.querySelector(".night.paper") as HTMLDivElement | null;
    if (sheet && sheet.style.display !== "none") {
      sheet.querySelector(".dream")?.remove();
      const p = document.createElement("p");
      p.className = "dream";
      p.textContent = `You dream. ${text}`;
      const keys = sheet.querySelector(".keys");
      sheet.insertBefore(p, keys);
    } else this.jobs.say(`You dreamt: ${text}`);
    this.log.push(`dream ${text.slice(0, 60)}`);
  }

  // ---- Madame Zelie's table: a folding table with a red cloth, the cards laid out, a stool

  private buildTable(at: [number, number, number]): void {
    const [x, z, yaw] = at;
    const g = new THREE.Group();
    const wood = new THREE.MeshLambertMaterial({ color: 0x4a3322 });
    const cloth = new THREE.MeshLambertMaterial({ color: 0x6e1f1c });
    const card = new THREE.MeshLambertMaterial({ color: 0xe8e0c8 });
    const back = new THREE.MeshLambertMaterial({ color: 0x23304a });
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.04, 0.52), cloth);
    top.position.y = 0.74;
    g.add(top);
    const drape = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.3, 0.54), cloth);
    drape.position.y = 0.6;
    g.add(drape);
    for (const [lx, lz] of [[-0.3, -0.2], [0.3, -0.2], [-0.3, 0.2], [0.3, 0.2]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.46, 0.04), wood);
      leg.position.set(lx, 0.23, lz);
      g.add(leg);
    }
    // five cards in a cross, and the pack
    const cards: Array<[number, number, number, boolean]> = [[0, 0, 0, true], [-0.12, 0, 0.1, true], [0.12, 0, -0.1, true], [0, -0.13, 0.05, false], [0, 0.13, -0.05, true]];
    for (const [cx, cz, rot, face] of cards) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.004, 0.09), face ? card : back);
      c.position.set(cx, 0.765, cz);
      c.rotation.y = rot;
      g.add(c);
    }
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.09), back);
    pack.position.set(0.26, 0.775, 0.16);
    g.add(pack);
    const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 8), wood);
    stool.position.set(0, 0.45, 0.62);
    g.add(stool);
    const sl = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.43, 0.05), wood);
    sl.position.set(0, 0.215, 0.62);
    g.add(sl);
    // the table stands in front of her, the stool (for the one whose cards are read) beyond it
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const tx = x + fx * 0.75;
    const tz = z + fz * 0.75;
    g.position.set(tx, this.world.groundAt(tx, tz, 0.3, 0), tz);
    g.rotation.y = yaw;
    this.world.scene.add(g);
    this.world.addCollider({ minX: tx - 0.36, maxX: tx + 0.36, minZ: tz - 0.36, maxZ: tz + 0.36 });
    this.table = g;
  }

  update(dt: number): void {
    this.openVisit(dt);
    this.tickMenace(dt);
    if (this.veilT > 0) {
      this.veilT -= dt;
      if (this.veilT <= 0) this.veil.style.display = "none";
    }
  }

  /** Dev: what is up now. */
  info() {
    return { menace: this.menace, typing: this.typing, t: +this.menaceT.toFixed(1), visit: this.visit, veil: this.veil.style.display === "flex", table: !!this.table, dream: this.lastDream, log: this.log.slice(-12) };
  }
}
