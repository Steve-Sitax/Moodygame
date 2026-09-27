import * as THREE from "three";
import type { JobsPayload } from "../net/api";
import type { FirstPerson, BikeEvent } from "../player/firstPerson";
import type { World } from "../world/rijnkaai";
import { identity } from "../net/mp/identity";
import { WALL } from "../world/city";
import type { Action, Sfx } from "./runs";
import type { Jobs } from "./jobs";
import type { Town } from "./town";
import type { Crowd, Puppet } from "./crowd";
import type { Stalls } from "./stalls";
import { Velocipedes, type VeloInfo } from "./velocipedes";
import { HandLantern } from "./lantern";
import { esc } from "./runs";
import { chest, pick } from "./facing";
import { dialogs } from "./dialogs";

// Theft, velocipedes, a lantern to carry, and the police (M3h), on the client.
// The server decides everything that counts (server/src/town/deeds.ts and
// police.ts): what can be taken, who saw it, what it costs, and what the police
// do. This side shows the things, offers the keys, reports the facts round Jef
// (who is near, how far, a clear line or not, which way they face), and plays
// what the server says: the owner shouts, gives chase or asks for it back; an
// agent walks up and talks (through the ordinary talk window); a night in the
// cell. Keys: E take a velocipede or a lantern, E again to get off; G take food
// off an open stall; L hold the lantern up or put it away.

interface Food {
  id: string;
  keeper: string;
  x: number;
  z: number;
  item: string;
  name: string;
}
interface Lamp {
  id: string;
  owner: string;
  x: number;
  z: number;
  y: number;
}
interface DeedsWorld {
  velos: VeloInfo[];
  lamps: Lamp[];
  food: Food[];
}
interface DeedReply extends JobsPayload {
  deed: number | null;
  again: boolean;
  seen: boolean;
  owner_saw: boolean;
  seen_by: Array<{ id: string; name: string }>;
  owner: { id: string; name: string };
  reaction: { who: string; name: string; kind: "shout" | "chase" | "ask"; line: string } | null;
  text: string;
}
interface PoliceView {
  visit: { id: number; agent: string; name: string; state: "coming" | "talking"; reason: string } | null;
  last: { visit: number; verdict: "let_off" | "warning" | "fine" | "arrest"; fine_c: number; paid_c: number; agent: string; text: string } | null;
  cell: boolean;
  post: { x: number; z: number; yaw: number; label: string };
}
interface CellNight {
  summary: string[];
  day: number;
  ended?: unknown;
  post: { x: number; z: number; yaw: number; label: string };
}

async function net<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(method === "GET" ? 6000 : 30_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

const WITNESS_R = 45;
const BIKE_SAY: Record<BikeEvent, string> = {
  wobble: "The front wheel bucks under you. You wobble and pull it straight.",
  fall: "The wheel catches and throws you. You land on the stones with the velocipede on top of you.",
  steps: "Not down steps on this. Not unless you want to break your neck.",
  edge: "You pull up hard at the edge of the quay.",
  bump: "You ride straight into it. The iron rings and your teeth rattle.",
};

/** Someone after Jef: an owner (chase or ask), or the police agent. */
interface Pursuer {
  id: string;
  name: string;
  p: Puppet;
  kind: "chase" | "ask" | "police" | "police_chase";
  deed: number | null;
  t: number;
  goT: number;
  called?: boolean;
}

export class Deeds {
  readonly velos: Velocipedes;
  readonly lantern: HandLantern;
  private food: Food[] = [];
  private busy = false;
  private pursuers = new Map<string, Pursuer>();
  private pollT = 0;
  private worldT = 0;
  private police: PoliceView | null = null;
  private lastVerdict = 0;
  private talking: string | null = null;
  /** The agent's talk closed before he had his answer: where Jef was then. */
  private walkedOff: { agent: string; x: number; z: number; t: number } | null = null;
  private sheet: HTMLDivElement;
  private cell: CellNight | null = null;
  sfx: (name: Sfx, at?: THREE.Vector3) => void = () => {};
  /**
   * Movement hook (M4's NPC action layer may replace it): send a claimed puppet toward
   * a point at a pace. Used for the police agent walking up, the police chase after Jef
   * runs, an owner's chase, an owner coming to ask for the thing back.
   */
  moveToward: (p: Puppet, x: number, z: number, pace: number) => void = (p, x, z, pace) => this.crowd.puppetGo(p, x, z, pace);
  /**
   * Police hook (M4 may take over the walk): an agent sets out for Jef. Return true to say
   * "I bring him"; then call policeAtJef(agent, name) when he stands before Jef, or
   * policeRanFrom(agent) when Jef gets away. Default null: this file walks him.
   */
  policeCome: ((agent: string, name: string) => boolean) | null = null;
  private handedOff = new Set<string>();

  constructor(
    private readonly world: World,
    private readonly player: FirstPerson,
    private readonly jobs: Jobs,
    private readonly town: Town,
    private readonly crowd: Crowd,
    private readonly stalls: Stalls,
  ) {
    this.velos = new Velocipedes(world, player);
    this.lantern = new HandLantern(world.scene, player);
    player.onBikeEvent = (e) => this.bikeEvent(e);
    jobs.extraActions.push((x, z) => this.actions(x, z));
    // every new payload: is there a lantern in the pockets?
    const apply = jobs.pockets.apply.bind(jobs.pockets);
    jobs.pockets.apply = (p: JobsPayload) => {
      apply(p);
      this.lantern.setOwned((p.pockets ?? []).some((i) => i.kind === "lantern"));
    };
    // the talk window: know when the agent is being talked to
    const open = jobs.talk.onOpen;
    jobs.talk.onOpen = (id) => {
      open(id);
      this.talking = id;
    };
    const close = jobs.talk.onClose;
    jobs.talk.onClose = (id) => {
      close(id);
      this.talking = null;
      void this.afterTalk(id);
    };
    window.addEventListener("keydown", (e) => this.onKey(e));
    this.sheet = document.createElement("div");
    this.sheet.className = "night paper";
    this.sheet.style.display = "none";
    document.body.appendChild(this.sheet);
    window.addEventListener("keydown", (e) => this.onSheetKey(e), true);
    dialogs.register("police cell", () => !!this.cell); // focus fix: the pause knows it is up (game/dialogs.ts)
    void this.load();
  }

  // ------------------------------------------------------------------ the world's things

  async load(): Promise<void> {
    try {
      const w = (await net<Partial<DeedsWorld> | null>("GET", "/api/deeds/world")) ?? {};
      // a bad or empty answer (QA 2026-09-24: "w.velos is not iterable"): keep what is shown, try again next time
      if (Array.isArray(w.food)) this.food = w.food;
      if (Array.isArray(w.velos)) {
        // a velocipede the server has as ridden by this player, but he is not on it here (a reload): leave it where
        // it was (M8c: another player's is his; `by` is the rider, missing from an older server: this player)
        for (const v of w.velos) {
          const by = (v as { by?: number | null }).by;
          const mine = by === undefined || by === null || by === identity.playerId;
          if (v && v.ridden && mine && this.velos.ridden?.info.id !== v.id) {
            await net("POST", `/api/velo/${v.id.split(":")[1]}/leave`, { x: v.x, z: v.z, yaw: v.yaw }).catch(() => {});
            v.ridden = false;
          }
        }
        this.velos.sync(w.velos);
      }
      if (Array.isArray(w.lamps)) this.lantern.syncStanding(w.lamps, (x, z) => this.world.groundAt(x, z, 0.2, 0));
    } catch (e) {
      console.warn("[deeds] the town's things did not load", e);
    }
  }

  // ------------------------------------------------------------------ keys

  private actions(x: number, z: number): { only?: Action[]; options?: Array<[number, Action]>; extra?: Action[] } {
    if (this.cell) return { only: [] };
    if (this.velos.ridden) {
      if (!this.player.bikeRiding) return { only: [] };
      return { only: [{ key: "KeyE", text: "get off the velocipede", run: () => void this.getOff(), self: true }] };
    }
    if (this.player.riding || this.player.swimming || this.player.climbing || this.player.bikeFallT > 0) return {};
    const options: Array<[number, Action]> = [];
    const extra: Action[] = [];
    // someone asks for their thing back
    for (const pu of this.pursuers.values()) {
      if (pu.kind !== "ask" || pu.deed === null) continue;
      if (Math.hypot(pu.p.x - x, pu.p.z - z) < 3.5) options.push([0, { key: "KeyE", text: `give it back to ${pu.name.split(" ")[0]}`, run: () => void this.giveBack(pu), at: chest(pu.p.group, 1.3 * pu.p.size) }]);
    }
    const nb = this.velos.nearest(x, z);
    if (nb) {
      const b = nb.bike;
      options.push([Math.hypot(b.info.x - x, b.info.z - z), { key: "KeyE", text: b.info.mine ? "get on the velocipede" : "take the velocipede", run: () => void this.take(b.info.id), at: nb.at }]);
    }
    const l = this.lantern.nearestStanding(x, z, 1.9);
    if (l) options.push([l.d, { key: "KeyE", text: "take the lantern", run: () => void this.take(l.id), at: l.at }]);
    // food off an open table (G: E stays for talking to the keeper)
    const open = new Set(this.stalls.states.filter((s) => s.open && s.keeper).map((s) => s.keeper));
    // the one Jef looks at (game/facing.ts), on the table top
    const food = pick(this.food, (f) => {
      const d = Math.hypot(f.x - x, f.z - z);
      return d < 2.3 && open.has(f.keeper) ? { d, at: { x: f.x, y: this.world.groundAt(f.x, f.z, 0.1, this.player.y) + 0.9, z: f.z } } : null;
    });
    if (food) {
      const f = food.it;
      extra.push({ key: "KeyG", text: `take ${f.name}`, run: () => void this.take(f.id), at: food.at });
    }
    return { options, extra };
  }

  private onKey(e: KeyboardEvent): void {
    if (e.repeat || e.code !== "KeyL") return;
    if (document.activeElement instanceof HTMLInputElement) return;
    if (this.jobs.talk.isOpen || this.jobs.day.sheetOpen || this.cell) return;
    this.jobs.say(this.lantern.toggle());
  }

  // ------------------------------------------------------------------ taking

  /** Who is about, as the server wants it: id, distance, a clear line or not, which way they face. */
  witnesses(x: number, z: number): Array<{ id: string; d: number; los: boolean; facing: number }> {
    const out: Array<{ id: string; d: number; los: boolean; facing: number }> = [];
    for (const r of this.town.inStreet(x, z, WITNESS_R)) {
      const d = Math.hypot(r.x - x, r.z - z);
      const facing = d > 0.05 ? (Math.sin(r.yaw) * (x - r.x) + Math.cos(r.yaw) * (z - r.z)) / d : 1;
      out.push({ id: r.id, d: +d.toFixed(2), los: this.los(r.x, r.z, x, z), facing: +facing.toFixed(2) });
    }
    for (const n of this.jobs.people.list) {
      if (!n.present) continue;
      const d = Math.hypot(n.pos.x - x, n.pos.z - z);
      if (d > WITNESS_R) continue;
      // the quay's people turn to face Jef when he is near (people.ts)
      out.push({ id: n.def.id, d: +d.toFixed(2), los: this.los(n.pos.x, n.pos.z, x, z), facing: d < 6 ? 1 : 0.3 });
    }
    return out.sort((a, b) => a.d - b.d).slice(0, 16);
  }

  /** A clear line between two points on the walk map (no house wall in between). */
  private los(ax: number, az: number, bx: number, bz: number): boolean {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(d / 0.5);
    for (let i = 1; i < n; i++) {
      const f = this.world.city.flags(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n);
      if (f !== undefined && f & WALL) return false;
    }
    return true;
  }

  /** M6 handcart: a household's cart was taken (the server said yes; `again`: his already). */
  onCart: ((ref: string, again: boolean) => void) | null = null;
  /** M6 handcart: what he took may have gone back (given back, caught, the police): reload. */
  onBack: (() => void) | null = null;
  /** M6 handcart: take a household's cart ("cart:<household>"), by the theft rules. */
  takeCart(ref: string): Promise<void> {
    return this.take(ref);
  }

  private async take(ref: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const { x, z } = this.player;
    try {
      const r = await net<DeedReply>("POST", "/api/deed", {
        ref,
        x: +x.toFixed(2),
        z: +z.toFixed(2),
        witnesses: this.witnesses(x, z),
        crouch: this.player.crouching,
        lantern: this.lantern.lit,
      });
      this.jobs.refresh(r);
      if (ref.startsWith("velo:")) {
        const b = this.velos.get(ref);
        if (b) this.velos.mount(b);
        if (!r.again) this.jobs.say(r.text || "You swing a leg over the saddle. W to pedal, S to brake, A and D or the mouse to steer, E to get off.");
        else this.jobs.say("You get back on. W pedal, S brake, E get off.");
      } else if (ref.startsWith("cart:")) {
        // M6 handcart: a household's cart; game/handcart.ts puts Jef's hands on the shafts
        this.onCart?.(ref, r.again);
        if (r.text) this.jobs.say(r.text);
      } else {
        if (ref.startsWith("lamp:")) this.lantern.removeStanding(ref);
        this.jobs.say(r.text);
      }
      if (r.reaction) this.react(r);
    } catch (e) {
      this.jobs.say(`${(e as Error).message[0].toUpperCase()}${(e as Error).message.slice(1)}.`);
    } finally {
      this.busy = false;
    }
  }

  /** The owner (or a witness) answers the theft, as the server said. M7 boats: game/rowing.ts calls it for a boat's owner. */
  react(r: DeedReply): void {
    const rc = r.reaction!;
    this.sfx("bell", new THREE.Vector3(this.player.x, 1.6, this.player.z));
    const n = this.jobs.people.get(rc.who);
    if (n) {
      n.lookAt(this.player.x, this.player.z);
      return; // the quay's own people keep their posts: they shout, and remember
    }
    if (rc.kind === "shout" || r.deed === null) return;
    const p = this.town.claim(rc.who);
    if (!p) return;
    const pu: Pursuer = { id: rc.who, name: rc.name, p, kind: rc.kind, deed: r.deed, t: rc.kind === "chase" ? 22 : 25, goT: 0 };
    this.pursuers.set(rc.who, pu);
  }

  private async giveBack(pu: Pursuer): Promise<void> {
    if (pu.deed === null) return;
    await this.settle(pu, "gave");
  }

  private async settle(pu: Pursuer, how: "gave" | "caught"): Promise<void> {
    const deed = pu.deed;
    pu.deed = null;
    this.release(pu.id);
    try {
      const r = await net<JobsPayload & { text: string }>("POST", `/api/deed/${deed}/return`, { how });
      this.jobs.refresh(r);
      this.jobs.say(r.text);
      if (this.velos.ridden) this.velos.forget();
      this.onBack?.();
      await this.load();
    } catch (e) {
      this.jobs.say((e as Error).message);
    }
  }

  private release(id: string): void {
    this.pursuers.delete(id);
    this.town.release(id);
  }

  // ------------------------------------------------------------------ riding

  private async getOff(down = false): Promise<void> {
    const at = this.velos.leave(down);
    if (!at) return;
    try {
      await net("POST", `/api/velo/${at.id.split(":")[1]}/leave`, { x: +at.x.toFixed(2), z: +at.z.toFixed(2), yaw: at.yaw, down });
    } catch (e) {
      console.warn("[deeds] leave", e);
    }
  }

  private bikeEvent(e: BikeEvent): void {
    this.jobs.say(BIKE_SAY[e]);
    if (e === "bump" || e === "fall") this.sfx("thud_plank", new THREE.Vector3(this.player.x, 0.3, this.player.z));
    if (e === "fall") void this.getOff(true);
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number, hour: number): void {
    this.velos.update(dt);
    const dark = hour >= 19.5 || hour < 5.5 ? 1 : hour >= 18 ? (hour - 18) / 1.5 : hour < 7 ? (7 - hour) / 1.5 : 0;
    this.lantern.dark = Math.max(0, Math.min(1, dark));
    this.lantern.busy = !!this.jobs.goods.carried || this.player.swimming || this.player.climbing;
    this.lantern.update(dt);
    this.pursue(dt);
    this.pollT -= dt;
    if (this.pollT <= 0) {
      this.pollT = 2;
      void this.poll();
    }
    this.worldT -= dt;
    if (this.worldT <= 0) {
      this.worldT = 15;
      if (!this.velos.ridden) void this.load();
    }
  }

  /** Owners after their things; the police agent coming for Jef. */
  private pursue(dt: number): void {
    const px = this.player.x;
    const pz = this.player.z;
    for (const pu of [...this.pursuers.values()]) {
      if (!this.crowd.alive(pu.p)) {
        if (pu.kind === "police") void this.fled(pu);
        this.release(pu.id);
        continue;
      }
      pu.t -= dt;
      pu.goT -= dt;
      const d = Math.hypot(pu.p.x - px, pu.p.z - pz);
      if (pu.kind === "chase" || pu.kind === "police_chase") {
        if (pu.kind === "chase" && d < 1.7 && pu.deed !== null && !this.jobs.talk.isOpen) {
          void this.settle(pu, "caught");
          continue;
        }
        if (pu.t <= 0 || d > 35) {
          this.jobs.say(pu.kind === "chase" ? `${pu.name.split(" ")[0]} gives up the chase, shouting after you.` : "The agent stops, out of breath. He knows your face now.");
          this.release(pu.id);
          continue;
        }
        if (pu.goT <= 0) {
          pu.goT = 0.4;
          this.moveToward(pu.p, px, pz, pu.kind === "chase" ? 2.7 : 2.9);
        }
        continue;
      }
      if (pu.kind === "ask") {
        if (pu.t <= 0 || d > 14) {
          this.jobs.say(`"Thief!" ${pu.name.split(" ")[0]} shouts after you. "Thief!"`);
          this.release(pu.id);
          continue;
        }
        if (pu.goT <= 0) {
          pu.goT = 0.8;
          if (d > 2.2) this.moveToward(pu.p, px + ((pu.p.x - px) / d) * 1.4, pz + ((pu.p.z - pz) / d) * 1.4, 1.3);
          else this.crowd.puppetStand(pu.p, "talk", Math.atan2(px - pu.p.x, pz - pu.p.z));
        }
        continue;
      }
      // the police: walk up to Jef, call out, and talk
      if (this.talking === pu.id) continue;
      if (!pu.called && (d < 6 || (d < 16 && this.los(pu.p.x, pu.p.z, px, pz)))) {
        pu.called = true;
        this.jobs.say(`${pu.name}: "You there! Police. Stay where you are, I want a word."`);
      }
      if (pu.called && d > 30) {
        void this.fled(pu);
        continue;
      }
      if (d < 2.4 && !this.jobs.talk.isOpen && !this.jobs.day.sheetOpen) {
        if (!this.arriving) void this.arrived(pu);
        continue;
      }
      if (pu.goT <= 0) {
        pu.goT = 0.7;
        this.moveToward(pu.p, px + ((pu.p.x - px) / (d || 1)) * 1.3, pz + ((pu.p.z - pz) / (d || 1)) * 1.3, d > 12 ? 1.9 : 1.4);
      }
    }
    // the talk window shut before the agent had his answer: walking off counts as running
    const w = this.walkedOff;
    if (w && !this.jobs.talk.isOpen) {
      if (Math.hypot(px - w.x, pz - w.z) > 8) {
        this.walkedOff = null;
        const pu = this.pursuers.get(w.agent) ?? { id: w.agent, name: "The agent", p: null as unknown as Puppet, kind: "police" as const, deed: null, t: 0, goT: 0 };
        void this.fled(pu);
      } else if ((w.t -= dt) <= 0) this.walkedOff = null;
    }
  }

  // ------------------------------------------------------------------ the police

  private async poll(): Promise<void> {
    let v: PoliceView;
    try {
      v = await net<PoliceView>("GET", "/api/police");
    } catch {
      return;
    }
    if (!v || typeof v !== "object") return;
    this.police = v;
    if (!this.postSign && v.post) this.postSign = this.signAt(v.post);
    if (v.last && v.last.visit !== this.lastVerdict) {
      const first = this.lastVerdict === 0;
      this.lastVerdict = v.last.visit;
      if (!first) this.verdict(v.last);
    }
    if (v.cell && !this.cell && !this.jobs.talk.isOpen) return void this.showCell();
    const visit = v.visit;
    // "talking" with nobody here (a reload in the middle of it): he comes up again
    if (!visit || this.pursuers.has(visit.agent) || this.cell || this.walkedOff) return;
    if (visit.state === "talking" && this.jobs.talk.isOpen) return;
    if (this.jobs.day.sheetOpen || !(this.player.locked || this.player.freeInput || this.player.testInput)) return;
    if (this.handedOff.has(`${visit.id}:${visit.agent}`)) return;
    if (this.policeCome?.(visit.agent, visit.name)) {
      this.handedOff.add(`${visit.id}:${visit.agent}`);
      return;
    }
    // the agent sets out: in the street already, or round a corner out of sight, 25-40 m off
    let from: { x: number; z: number } | undefined;
    for (let i = 0; i < 16 && !from; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 25 + Math.random() * 15;
      const q = this.crowd.openNear(this.player.x + Math.cos(a) * r, this.player.z + Math.sin(a) * r);
      if (q && this.crowd.isHidden(q.x, q.z)) from = q;
    }
    const p = this.town.claim(visit.agent, from);
    if (!p) return;
    this.pursuers.set(visit.agent, { id: visit.agent, name: visit.name, p, kind: "police", deed: null, t: 600, goT: 0 });
  }

  /** For a layer that walked the agent up itself (policeCome): he stands before Jef now. */
  policeAtJef(agent: string, name: string): void {
    const p = this.town.claim(agent);
    if (!p) return;
    const pu: Pursuer = { id: agent, name, p, kind: "police", deed: null, t: 600, goT: 0, called: true };
    this.pursuers.set(agent, pu);
    void this.arrived(pu);
  }

  /** For a layer that walked the agent up itself: Jef got away from him. */
  policeRanFrom(agent: string): void {
    const pu = this.pursuers.get(agent);
    void this.fled(pu ?? { id: agent, name: "The agent", p: null as unknown as Puppet, kind: "police", deed: null, t: 0, goT: 0 });
  }

  private postSign: THREE.Mesh | null = null;
  /** A board over the door of the police post, so it can be found. */
  private signAt(post: PoliceView["post"]): THREE.Mesh {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 32;
    const g = c.getContext("2d")!;
    g.fillStyle = "#1c2430";
    g.fillRect(0, 0, 128, 32);
    g.strokeStyle = "#b8a878";
    g.strokeRect(2, 2, 124, 28);
    g.fillStyle = "#e0d4a8";
    g.font = "bold 18px 'Scheldemist Print', Georgia, serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("POLICE", 64, 17);
    const tex = new THREE.CanvasTexture(c);
    tex.name = "sign"; // (the bump audit: lettering stays flat, world/bumps.ts)
    tex.magFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.46), new THREE.MeshLambertMaterial({ map: tex }));
    // over the door, facing out into the square (post.yaw is the look out of the door)
    const ox = -Math.sin(post.yaw);
    const oz = -Math.cos(post.yaw);
    const door = (post as { door?: [number, number] }).door ?? [post.x - ox, post.z - oz];
    m.position.set(door[0] + ox * 0.08, 2.95, door[1] + oz * 0.08);
    m.rotation.y = Math.atan2(ox, oz);
    this.world.scene.add(m);
    return m;
  }

  private arriving = false;
  private async arrived(pu: Pursuer): Promise<void> {
    this.arriving = true;
    try {
      await net("POST", "/api/police/arrived", { agent: pu.id });
    } catch {
      this.release(pu.id);
      return;
    } finally {
      this.arriving = false;
    }
    if (this.jobs.talk.isOpen) return;
    this.crowd.puppetStand(pu.p, "talk", Math.atan2(this.player.x - pu.p.x, this.player.z - pu.p.z));
    if (this.velos.ridden && this.player.bikeRiding) this.player.bikeSpeed = 0;
    this.jobs.talk.open({ id: pu.id, def: { name: pu.name, title: "police agent" } });
  }

  /** Jef ran from the agent (or walked off in the middle of it). */
  private async fled(pu: Pursuer): Promise<void> {
    try {
      const r = await net<{ text: string }>("POST", "/api/police/fled");
      this.jobs.say(r.text);
    } catch {
      // nobody was after him after all
    }
    if (pu.p && this.crowd.alive(pu.p)) {
      this.pursuers.set(pu.id, { ...pu, kind: "police_chase", t: 12, goT: 0 });
    } else this.release(pu.id);
  }

  /** The talk window closed. After the verdict: the night in the cell, if it came to that. */
  private async afterTalk(id: string): Promise<void> {
    const pu = this.pursuers.get(id);
    if (!pu || pu.kind !== "police") return;
    let v: PoliceView;
    try {
      v = await net<PoliceView>("GET", "/api/police");
    } catch {
      return;
    }
    if (v.visit && v.visit.agent === id) {
      // no answer yet: he stays, and walking off is running
      this.jobs.say(`${pu.name.split(" ")[0]}: "Where do you think you're going? I haven't finished with you."`);
      this.walkedOff = { agent: id, x: this.player.x, z: this.player.z, t: 20 };
      return;
    }
    this.release(id);
    if (v.last && v.last.visit !== this.lastVerdict) {
      this.lastVerdict = v.last.visit;
      this.verdict(v.last);
    }
    if (v.cell) await this.showCell();
  }

  private verdict(l: NonNullable<PoliceView["last"]>): void {
    if (this.velos.ridden) this.velos.forget();
    void this.load();
    this.onBack?.();
    if (l.verdict === "let_off") this.jobs.say("The agent believes you and lets you go. What you took goes back where it belongs, and that is the end of it.");
    else if (l.verdict === "warning") this.jobs.say("A warning from the police. What you took goes back.");
    else if (l.verdict === "fine") this.jobs.say(`You pay the police a fine of ${l.paid_c} centimes. What you took goes back.`);
    else this.jobs.say(`The agent takes you by the arm${l.paid_c ? ` and ${l.paid_c} centimes for the fine` : ""}. To the police post.`);
  }

  private async showCell(): Promise<void> {
    let r: { night: CellNight } & JobsPayload;
    try {
      r = await net<{ night: CellNight } & JobsPayload>("POST", "/api/police/cell");
    } catch {
      return;
    }
    this.jobs.refresh(r);
    this.cell = r.night;
    if (this.velos.ridden) this.velos.forget();
    this.jobs.day.hold = true;
    this.player.frozen = true;
    this.sheet.innerHTML = `<h2>Night</h2><p class="sub">${esc(r.night.post.label[0].toUpperCase() + r.night.post.label.slice(1))}</p>
      ${r.night.summary.map((l) => `<p>${esc(l)}</p>`).join("")}
      <p class="keys">E  out into the morning</p>`;
    this.sheet.style.display = "block";
  }

  private onSheetKey(e: KeyboardEvent): void {
    if (!this.cell) return;
    e.stopPropagation();
    if (e.repeat || (e.code !== "KeyE" && e.code !== "Enter")) return;
    const post = this.cell.post;
    const lost = this.cell.summary.some((l) => l.startsWith("Your job is lost"));
    this.cell = null;
    this.sheet.style.display = "none";
    this.jobs.day.hold = false;
    this.player.frozen = false;
    this.player.place(post.x, post.z, post.yaw);
    void net("POST", "/api/police/cell/done").catch(() => {});
    this.jobs.say(`The door of the police post shuts behind you. The Grote Markt is grey and cold${lost ? ", and your job is gone" : ""}.`);
  }

  /** For the path check (CLAUDE.md): every velocipede, lantern, food table and the police post. */
  pathPoints(): Array<{ label: string; x: number; z: number; reach: number }> {
    const out: Array<{ label: string; x: number; z: number; reach: number }> = [];
    for (const v of this.velos.list()) out.push({ label: `velocipede ${v.id} (${v.owner_name})`, x: v.x, z: v.z, reach: 1.6 });
    for (const l of this.lantern.standingList()) out.push({ label: `lantern ${l.id}`, x: l.x, z: l.z, reach: l.y > 0.5 ? 2.2 : 1.8 });
    for (const f of this.food) out.push({ label: `food ${f.id}`, x: f.x, z: f.z, reach: 2.2 });
    if (this.police?.post) out.push({ label: "the police post", x: this.police.post.x, z: this.police.post.z, reach: 1.5 });
    return out;
  }

  /** Dev: state for checks. */
  info() {
    return {
      riding: this.player.bikeRiding,
      speed: +this.player.bikeSpeed.toFixed(2),
      bike: this.velos.ridden?.info.id ?? null,
      ground: this.velos.groundAt(this.player.x, this.player.z),
      lantern: this.lantern.info(),
      pursuers: [...this.pursuers.values()].map((p) => ({ id: p.id, kind: p.kind, d: +Math.hypot(p.p.x - this.player.x, p.p.z - this.player.z).toFixed(1), called: !!p.called })),
      police: this.police,
      velos: this.velos.list(),
      food: this.food.length,
    };
  }
}
