import * as THREE from "three";
import type { JobsPayload, PushMsg } from "../net/api";
import type { FirstPerson } from "../player/firstPerson";
import type { World } from "../world/rijnkaai";
import { addLantern, removeLantern, type LanternSource } from "../world/lanternLights";
import { lampFog } from "../world/lampFog";
import { TICK_EVERY_MS } from "../../../shared/clock";
import { GANG_HOURS, inSpan } from "../../../shared/night";
import { Figure } from "./figures";
import type { Jobs } from "./jobs";
import type { Town } from "./town";
import { esc } from "./runs";

// M7 night, the client side of the gangs (server night/gangs.ts decides everything). Once a tick at
// night Jef's position and what he sees go to the server (a lit lamp near, on a quay, goods in his
// hands, the people round him); the ENGINE rolls. When a gang comes, three men step out of the dark
// and close round him, and a small panel says what he can do: R run, F fight them off, H shout for
// the watch, P pay them. Nothing in time: they do not ask twice. The server's answer is shown: a
// line, or (robbed) the screen dimmed with what it cost. No combat: it is narrated (docs/08 #10).

interface GangView {
  id: number;
  demand_c: number;
  members: number;
  x: number;
  z: number;
}
interface GangResult {
  outcome: "escaped" | "fought_off" | "scattered" | "paid" | "robbed";
  text: string;
  money_c: number;
  health_lost: number;
  things: string[];
  hands: "keep" | "drop" | "taken";
  job_failed?: number;
}

/** Real seconds Jef has to answer before they take what they want. */
export const GANG_ANSWER_S = 14;
const LAMP_LIT_M = 8;
const VEIL_S = 7;

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  const d = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
  return d;
}

const CSS = `
.gang-panel{position:fixed;left:50%;bottom:16%;transform:translateX(-50%);max-width:480px;padding:10px 14px;z-index:30;display:none;font-size:14px;line-height:1.35}
.gang-panel .keys{margin-top:6px;opacity:.9;font-size:13px}
.gang-panel .bar{height:3px;background:#6b2a1a;margin-top:6px;transition:width .2s linear}
.gang-veil{position:fixed;inset:0;background:rgba(8,6,4,.8);z-index:40;display:none;align-items:center;justify-content:center;pointer-events:none}
.gang-veil p{max-width:520px;color:#e8dcc4;font-size:17px;line-height:1.5;text-align:center;padding:0 24px;font-style:italic}
`;

export class Nightlife {
  private gang: GangView | null = null;
  private figs: Figure[] = [];
  private lantern: LanternSource | null = null;
  private lanternMesh: THREE.Mesh | null = null;
  private answerT = 0;
  private sent = false;
  private rollT = TICK_EVERY_MS / 1000;
  private veilT = 0;
  private lampSpots: Array<{ x: number; z: number }> | null = null;
  private readonly panel: HTMLDivElement;
  private readonly veil: HTMLDivElement;
  /** Set by main: Jef is inside a room or a hall (no gang there). */
  indoors: () => boolean = () => false;
  /** Dev: what happened. */
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
    this.panel.className = "gang-panel paper";
    document.body.appendChild(this.panel);
    this.veil = document.createElement("div");
    this.veil.className = "gang-veil";
    document.body.appendChild(this.veil);
    window.addEventListener("keydown", (e) => this.onKey(e), true);
  }

  /** At a load: a gang already in the street (a reload in the middle of it). */
  async load(): Promise<void> {
    try {
      const r = await fetch("/api/night/state", { signal: AbortSignal.timeout(8000) });
      const s = (await r.json()) as { gang: GangView | null };
      if (s.gang) this.show(s.gang);
    } catch {
      // the server is away: nothing to show
    }
  }

  handlePush(m: PushMsg): void {
    if (m.type === "gang" && m.gang) this.show(m.gang as GangView);
  }

  /** What Jef sees now, for the engine's roll. */
  facts(): Record<string, unknown> {
    const { x, z } = this.player;
    const h = this.jobs.day.hourF;
    const litHours = h >= 18.5 || h < 6.2;
    this.lampSpots ??= this.world.gasLamps.lamps().map((l) => ({ x: l.x, z: l.z }));
    const lit = litHours && this.lampSpots.some((l) => Math.hypot(l.x - x, l.z - z) < LAMP_LIT_M);
    let quay = false;
    for (let a = 0; a < 8 && !quay; a++) quay = this.world.isWater(x + Math.cos(a * 0.785) * 6, z + Math.sin(a * 0.785) * 6);
    const people = this.town.inStreet(x, z, 60).map((s) => ({ id: s.id, x: +s.x.toFixed(1), z: +s.z.toFixed(1) }));
    return { x: +x.toFixed(1), z: +z.toFixed(1), lit, quay, indoors: this.indoors(), carrying: !!this.jobs.goods.carried, people };
  }

  update(dt: number): void {
    // once a tick, at night, while the game runs: the engine's roll
    this.rollT -= dt;
    if (this.rollT <= 0) {
      this.rollT = TICK_EVERY_MS / 1000;
      if (!this.gang && this.jobs.day.playing && inSpan(this.jobs.day.hourF, GANG_HOURS) && !this.indoors()) void this.roll();
    }
    for (const f of this.figs) if (!f.gone) f.update(dt);
    if (this.lantern && this.lanternMesh && this.figs[0] && !this.figs[0].gone) {
      this.lanternMesh.getWorldPosition(this.lantern.pos);
      this.lantern.ground = 0;
    }
    if (this.veilT > 0) {
      this.veilT -= dt;
      if (this.veilT <= 0) this.veil.style.display = "none";
    }
    const g = this.gang;
    if (!g) {
      // the men walk off into the dark, then they are gone
      if (this.figs.length && this.figs.every((f) => f.gone || !f.moving)) this.clearFigs();
      return;
    }
    const { x, z } = this.player;
    for (const f of this.figs) if (!f.moving) f.face(x, z);
    if (this.sent || this.jobs.talk.isOpen || this.jobs.day.sheetOpen) return;
    this.answerT -= dt;
    const bar = this.panel.querySelector(".bar") as HTMLDivElement | null;
    if (bar) bar.style.width = `${Math.max(0, (this.answerT / GANG_ANSWER_S) * 100).toFixed(0)}%`;
    if (this.answerT <= 0) void this.answer("stand");
  }

  private async roll(): Promise<void> {
    try {
      const r = await post<{ gang: GangView | null }>("/api/night/roll", this.facts());
      if (r.gang) this.show(r.gang);
    } catch {
      // next tick
    }
  }

  /** Three men step out of the dark and close round Jef. */
  show(g: GangView): void {
    if (this.gang?.id === g.id) return;
    this.clearFigs();
    this.gang = g;
    this.sent = false;
    this.answerT = GANG_ANSWER_S;
    const { x, z, yaw } = this.player;
    const n = Math.max(2, Math.min(4, g.members || 3));
    for (let i = 0; i < n; i++) {
      // from the dark ahead and to the sides, 7 to 9 m off, onto a ring of 2.2 m round him
      const a = -yaw + Math.PI + (i - (n - 1) / 2) * 0.9;
      const from = this.freeNear(x + Math.sin(a) * 8, z + Math.cos(a) * 8) ?? { x: x + Math.sin(a) * 4, z: z + Math.cos(a) * 4 };
      const f = new Figure(i === 0 ? "stranger" : "thief", from.x, from.z, this.world.scene);
      const to = this.freeNear(x + Math.sin(a) * 2.2, z + Math.cos(a) * 2.2) ?? { x, z };
      f.walkTo(to.x, to.z, 1.6);
      this.figs.push(f);
    }
    // the first carries a shaded lantern (you see them come)
    const lead = this.figs[0];
    const glass = new THREE.MeshBasicMaterial({ color: 0xffb060 });
    lampFog(glass, 1.2); // M7 fog lamps: it fogs with the man who carries it
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.14, 4), glass);
    mesh.position.set(0.28, 0.72, 0.12);
    lead.group.add(mesh);
    this.lanternMesh = mesh;
    this.lantern = addLantern({ power: 0.7 });
    this.lantern.on = 1;
    this.render();
    this.panel.style.display = "block";
    this.log.push(`gang ${g.id} demands ${g.demand_c}`);
    this.jobs.say(`Three men step out of the dark. "Evening, friend. That purse looks heavy. ${g.demand_c} centimes and you walk on."`);
  }

  private render(): void {
    const g = this.gang;
    if (!g) return;
    const keys = ["R: run", "F: fight them off", "H: shout for the watch", `P: pay them ${g.demand_c} c`].join(" &nbsp;&middot;&nbsp; ");
    this.panel.innerHTML = `<div><b>A gang</b> blocks your way: three men, hands in their coats. Nobody else about${this.facts().lit ? ", only the lamp" : ""}.</div><div class="keys">${keys}</div><div class="bar" style="width:100%"></div>`;
  }

  private freeNear(x: number, z: number): { x: number; z: number } | null {
    const w = this.world;
    for (let r = 0; r <= 4; r += 0.7)
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        if (w.isFree(px, pz, 0.35) && !w.isWater(px, pz)) return { x: px, z: pz };
        if (r === 0) break;
      }
    return null;
  }

  /** Jef's answer; the server rolls. Dev: `__scheldemist.night.answer("run")`. */
  async answer(how: "run" | "fight" | "shout" | "pay" | "stand"): Promise<string> {
    const g = this.gang;
    if (!g || this.sent) return "no gang";
    this.sent = true;
    try {
      const r = await post<JobsPayload & { result: GangResult }>(`/api/night/gang/${g.id}`, { how, ...this.facts() });
      this.jobs.refresh(r);
      this.end(r.result);
      return `${how}: ${r.result.outcome}`;
    } catch (e) {
      this.sent = false;
      // the gang is gone on the server (it went off into the dark): clear it here
      if (/nobody is stopping/.test(String((e as Error).message))) this.end(null);
      return `failed: ${(e as Error).message}`;
    }
  }

  private end(r: GangResult | null): void {
    this.gang = null;
    this.panel.style.display = "none";
    const { x, z } = this.player;
    // they go off into the dark, away from Jef
    for (const f of this.figs) {
      const dx = f.pos.x - x;
      const dz = f.pos.z - z;
      const len = Math.hypot(dx, dz) || 1;
      const to = this.freeNear(f.pos.x + (dx / len) * 22, f.pos.z + (dz / len) * 22) ?? { x: f.pos.x, z: f.pos.z };
      f.walkTo(to.x, to.z, r?.outcome === "scattered" || r?.outcome === "fought_off" ? 3.2 : 1.5);
    }
    if (!r) return;
    this.log.push(`gang end ${r.outcome} ${r.money_c} ${r.health_lost}`);
    if (r.hands !== "keep") this.jobs.dropCarried(r.hands === "taken");
    if (r.outcome === "robbed") {
      this.veil.innerHTML = `<p>${esc(r.text)}</p>`;
      this.veil.style.display = "flex";
      this.veilT = VEIL_S + r.text.length / 40;
    } else this.jobs.say(r.text);
  }

  private clearFigs(): void {
    for (const f of this.figs) if (!f.gone) f.remove();
    this.figs = [];
    removeLantern(this.lantern);
    this.lantern = null;
    this.lanternMesh = null;
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.gang || this.sent || e.repeat || this.jobs.talk.isOpen || this.jobs.day.sheetOpen) return;
    const how = e.code === "KeyR" ? "run" : e.code === "KeyF" ? "fight" : e.code === "KeyH" ? "shout" : e.code === "KeyP" ? "pay" : null;
    if (!how) return;
    e.preventDefault();
    e.stopPropagation();
    void this.answer(how);
  }

  /** Dev: the gang now, the figures, what was shown. */
  info() {
    return { gang: this.gang, figures: this.figs.filter((f) => !f.gone).map((f) => [+f.pos.x.toFixed(1), +f.pos.z.toFixed(1)]), t: +this.answerT.toFixed(1), veil: this.veil.style.display === "flex", log: this.log.slice(-12) };
  }

  /** Dev: the gang's first man (a shot's target). */
  get lead(): Figure | null {
    return this.figs.find((f) => !f.gone) ?? null;
  }
}
