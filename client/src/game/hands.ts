import * as THREE from "three";
import type { FirstPerson } from "../player/firstPerson";
import type { JobsPayload, PushMsg, TalkLine } from "../net/api";
import type { Crowd } from "./crowd";
import type { Town } from "./town";
import type { Jobs } from "./jobs";
import type { Interiors } from "./interiors";
import type { Action } from "./runs";
import type { Steps } from "./steps";

// Gifts, the treat and hired hands on the client (M6, 2026-09-24). The server decides everything
// (town/gifts.ts, treat.ts, hire.ts); this side shows it:
// - a gift: Jef's hand comes into view holding the thing and gives it; the person takes it (it shows
//   in their hand, or they eat it), their thanks is the talk's line;
// - the treat: Jef going into a tavern and out again is told to the server (the guest comes in
//   behind him and sits; out again, they go back to their day); G at the counter stands a round;
//   seated at their table, T talks to them;
// - hired hands: their words in the street (asking for more, walking off, done) as toasts.

export interface Handover {
  item: string;
  name: string;
  eaten: boolean;
  warmed: boolean;
}

interface TreatInfo {
  id: number;
  npc: string;
  name: string;
  first: string;
  step: string | null;
  place: string | null;
  label: string | null;
  inside: string | null;
  rounds: number;
  tipsy: number;
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

const SKIN = 0xc89878;
const SLEEVE = 0x4a3a2a;

/** A small thing in the hand, by kind: fish, bread, an apple, a lantern; else a paper parcel. */
function thingMesh(kind: string): THREE.Object3D {
  const g = new THREE.Group();
  const mat = (c: number) => new THREE.MeshLambertMaterial({ color: c });
  if (kind === "herring" || kind === "eel") {
    // across the palm: a silver belly, a dark back, a forked tail
    const len = kind === "eel" ? 0.24 : 0.15;
    const body = new THREE.Mesh(new THREE.BoxGeometry(len, 0.026, 0.034), mat(kind === "eel" ? 0x6a5030 : 0xb8bcc0));
    const back = new THREE.Mesh(new THREE.BoxGeometry(len * 0.9, 0.012, 0.02), mat(kind === "eel" ? 0x3a2a18 : 0x44525c));
    back.position.y = 0.018;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.022, 0.05), mat(kind === "eel" ? 0x5a4028 : 0x8a949c));
    tail.position.x = len / 2 + 0.012;
    g.add(body, back, tail);
  } else if (kind === "apple") {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), mat(0x9a2a1a)));
  } else if (kind === "bread" || kind === "roll" || kind === "biscuit") {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(kind === "bread" ? 0.16 : 0.08, 0.07, kind === "bread" ? 0.1 : 0.08), mat(0x8a5a2a)));
  } else if (kind === "lantern") {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.1), mat(0x707060));
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.03), mat(0x505048));
    top.position.y = 0.1;
    g.add(b, top);
  } else {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.1), mat(0xb8a888)));
  }
  return g;
}

/** Jef's forearm and hand, before the camera, holding the thing. */
function makeArm(kind: string): { root: THREE.Group; thing: THREE.Object3D } {
  const root = new THREE.Group();
  // a coat sleeve with a cuff, the hand palm up, fingers and a thumb: held out from the lower right
  const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.07, 0.3), new THREE.MeshLambertMaterial({ color: SLEEVE }));
  sleeve.position.set(0, -0.01, 0.2);
  const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.075, 0.03), new THREE.MeshLambertMaterial({ color: 0x3a2e22 }));
  cuff.position.set(0, -0.01, 0.055);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.08), new THREE.MeshLambertMaterial({ color: SKIN }));
  hand.position.set(0, -0.012, -0.0);
  const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.066, 0.022, 0.05), new THREE.MeshLambertMaterial({ color: SKIN }));
  fingers.position.set(0, 0.0, -0.06);
  fingers.rotation.x = 0.5;
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.05), new THREE.MeshLambertMaterial({ color: SKIN }));
  thumb.position.set(-0.045, 0.008, -0.01);
  thumb.rotation.y = 0.5;
  const thing = thingMesh(kind);
  thing.position.set(0, 0.022, -0.02);
  root.add(sleeve, cuff, hand, fingers, thumb, thing);
  // the camera's near plane is close; keep it drawn over the scene's fog
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (m) {
      m.depthTest = true;
      (m as THREE.MeshLambertMaterial).fog = false;
    }
  });
  return { root, thing };
}

const CARRY_OF: Record<string, "parcel" | "fish" | "sack" | "basket"> = { herring: "fish", eel: "fish", mussels: "fish", bread: "parcel", roll: "parcel", biscuit: "parcel", apple: "parcel", lantern: "parcel", coal: "sack", scarf: "parcel" };

export class Hands {
  say: (t: string) => void = () => {};
  sfx: (name: "lift" | "coins") => void = () => {};
  /** The arm before the camera while a gift is handed over. */
  private arm: { root: THREE.Group; thing: THREE.Object3D; t: number; npc: string; h: Handover } | null = null;
  /** What a person holds after a gift, and until when (seconds of play). */
  private holding = new Map<string, number>();
  private treats: TreatInfo[] = [];
  private treatT = 0;
  private wasInside: string | null = null;
  private clock = 0;
  /** Dev: the hand-overs shown. */
  readonly shown: string[] = [];

  constructor(
    private readonly player: FirstPerson,
    private readonly jobs: Jobs,
    private readonly town: Town,
    private readonly crowd: Crowd,
    private readonly interiors: Interiors,
    readonly steps: Steps,
  ) {
    // the talk's reply: a thing handed over shows as Jef's hand and their take
    jobs.talk.onReply = (id, r) => this.onReply(id, r);
    // in and out of a room: the treat's guest follows Jef in (the server's word), and goes home after
    const room = interiors.roomSound;
    interiors.roomSound = (k) => {
      room(k);
      this.roomChanged(k);
    };
    // G at the counter stands the guest a round; the ballads' keys stay
    const tk = interiors.tavernKeys;
    interiors.tavernKeys = (x, z) => {
      const a = tk?.(x, z) ?? { options: [], extra: [] };
      return { options: a.options, extra: [...a.extra, ...this.roundKeys()] };
    };
    interiors.seatedKeys = () => this.seatedKeys();
    steps.inside = () => interiors.inside;
  }

  // ------------------------------------------------------------------ gifts

  private onReply(id: string, r: TalkLine): void {
    const h = (r as TalkLine & { handover?: Handover }).handover;
    if (!h) return;
    this.handOver(id, h);
  }

  /** Jef's hand gives the thing; a moment later it is in theirs (or eaten). */
  handOver(npc: string, h: Handover): void {
    if (this.arm) this.arm.root.removeFromParent();
    const a = makeArm(h.item);
    this.player.camera.add(a.root);
    this.arm = { ...a, t: 0, npc, h };
    this.shown.push(`${npc}:${h.item}${h.eaten ? ":eaten" : ""}`);
    this.sfx("lift");
  }

  private updateArm(dt: number): void {
    const a = this.arm;
    if (!a) return;
    a.t += dt;
    const t = a.t;
    // up from below the view and out toward them (0 .. 0.8 s), held out a moment, the thing taken, back
    const out = t < 0.8 ? THREE.MathUtils.smoothstep(t, 0, 0.8) : t < 1.3 ? 1 : 1 - THREE.MathUtils.smoothstep(t, 1.3, 1.9);
    a.root.position.set(0.24 - 0.12 * out, -0.46 + 0.2 * out, -0.36 - 0.24 * out);
    a.root.rotation.set(0.1 + 0.2 * out, 0.55 - 0.3 * out, -0.1);
    if (t >= 1.05 && a.thing.visible) {
      a.thing.visible = false;
      this.theyTake(a.npc, a.h);
    }
    if (t >= 1.9) {
      a.root.removeFromParent();
      this.arm = null;
    }
  }

  /** Their take: the thing in their hand, a nod; eaten on the spot, it is gone again soon. */
  private theyTake(npc: string, h: Handover): void {
    const p = this.town.puppet(npc);
    if (!p || !this.crowd.alive(p)) return;
    this.crowd.puppetCarry(p, CARRY_OF[h.item] ?? "parcel");
    this.crowd.puppetStand(p, "talk", Math.atan2(this.player.x - p.x, this.player.z - p.z));
    this.holding.set(npc, this.clock + (h.eaten ? 3 : 8));
  }

  private updateHolding(): void {
    for (const [npc, until] of this.holding) {
      if (this.clock < until) continue;
      this.holding.delete(npc);
      const p = this.town.puppet(npc);
      if (p && this.crowd.alive(p)) this.crowd.puppetCarry(p, null);
    }
  }

  // ------------------------------------------------------------------ the treat

  private roomChanged(k: string | null): void {
    const place = this.interiors.placeId;
    if (k && place && place.startsWith("tavern:")) {
      this.wasInside = place;
      void call<{ guests: Array<{ id: string; name: string }> }>("POST", "/api/treat/enter", { place })
        .then((r) => {
          if (r.guests.length) this.say(`${r.guests.map((g) => g.name.split(" ")[0]).join(" and ")} comes in behind you.`);
          this.steps.dirty = true;
          return this.loadTreats();
        })
        .catch(() => {});
    } else if (!k && this.wasInside) {
      this.wasInside = null;
      void call("POST", "/api/treat/leave", {})
        .then(() => {
          this.steps.dirty = true;
          return this.loadTreats();
        })
        .catch(() => {});
    }
  }

  private async loadTreats(): Promise<void> {
    try {
      const r = await call<{ treats: TreatInfo[] }>("GET", "/api/treat");
      this.treats = r.treats;
    } catch {
      /* next time */
    }
  }

  /** The guest drinking with Jef in this room, if any. */
  private guestHere(): TreatInfo | null {
    const place = this.interiors.placeId;
    return this.treats.find((t) => t.inside && t.inside === place) ?? null;
  }

  private roundKeys(): Action[] {
    const g = this.guestHere();
    const room = this.interiors.room;
    const w = this.player.rideWalk;
    if (!g || !room?.counter || !w || Math.hypot(room.counter.x - w.x, room.counter.z - w.z) > 1.6) return [];
    if (g.rounds >= 3) return [];
    return [{ key: "KeyG", text: g.rounds ? `another round for you and ${g.first} (beer)` : `stand ${g.first} a beer (a round for two)`, run: () => void this.round("beer") }];
  }

  private seatedKeys(): Action[] {
    const g = this.guestHere();
    if (!g) return [];
    const at = this.interiors.personAt(g.npc);
    if (!at || at.dist > 2.2) return [];
    return [{ key: "KeyF", text: `talk to ${g.first}`, run: () => this.jobs.talk.open({ id: g.npc, def: { name: g.name } }) }];
  }

  async round(kind: "beer" | "jenever"): Promise<string> {
    const place = this.interiors.placeId;
    if (!place) return "not inside";
    try {
      const r = await call<JobsPayload & { line: string; note: string; paid_c: number; rounds: number }>("POST", "/api/treat/round", { place, kind });
      this.jobs.refresh(r);
      if (r.paid_c) this.sfx("coins");
      this.say(`${r.paid_c ? `Paid ${r.paid_c} c. ` : ""}${r.line}${r.note ? ` ${r.note}` : ""}`);
      await this.loadTreats();
      return r.line;
    } catch (e) {
      const m = (e as Error).message;
      this.say(m);
      return m;
    }
  }

  // ------------------------------------------------------------------ hired hands

  handlePush(m: PushMsg): void {
    if (m.type === "actions") {
      this.steps.dirty = true;
      if (this.treats.length || (m.ended as { kind?: string } | undefined)?.kind === "routine") void this.loadTreats();
    }
    if (m.type !== "hands") return;
    const first = String(m.name ?? "").split(" ")[0];
    if (m.line) this.say(`${first}: "${String(m.line)}"${m.ask ? " (talk to him to answer)" : ""}`);
    else if (m.say) this.say(String(m.say));
    this.steps.dirty = true;
  }

  update(dt: number, hasRoutines: boolean): void {
    this.clock += dt;
    this.updateArm(dt);
    this.updateHolding();
    this.treatT -= dt;
    if (this.treatT <= 0) {
      this.treatT = this.treats.length || this.interiors.inside ? 3 : 12;
      if (hasRoutines || this.treats.length) void this.loadTreats();
    }
  }

  /** Dev: what runs. */
  info() {
    return { treats: this.treats, shown: this.shown, arm: !!this.arm, walks: this.steps.info() };
  }
}
