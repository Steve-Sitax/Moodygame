import * as THREE from "three";
import "./interiors.css";
import { psxUniforms, MAX_LAMPS } from "../retro/psx";
import { buildCellar, buildTavern, type Room, type Seat, type Spot } from "../world/rooms";
import { signTexture, glowTexture } from "../world/textures";
import type { FirstPerson, RideAnchor, RideWalk } from "../player/firstPerson";
import type { JobsPayload, Pt } from "../net/api";
import { interiorApi, type InteriorsInfo, type Person, type PlayInfo, type PlayLine, type TalkLines } from "../net/interiorApi";
import { isHumanKind, makeHuman, type Human, type HumanKind } from "./humans";
import { makePuppet, type Puppet } from "./puppets";
import type { Action, Sfx } from "./runs";
import type { Jobs } from "./jobs";

// Inside (M6): E at a tavern's door takes Jef into its taproom; E at the cellar door by the
// Vleeshuis (in the evening, 5 c) down into the Poesje. Each room is a small scene of its own
// (world/rooms.ts), rendered instead of the street while Jef is in it, put at the door it
// belongs to so the sounds and the town's clock stay where they are. Jef walks it in the
// player's carriage mode (the room frame), sits on a bench, stands at the counter.
// The keeper and the drinkers are the town's residents the schedule puts there (the server
// says who); they sit at the tables, talk in bubbles, and can be talked to as ever. Buying
// goes through the keeper's own wares (trade.ts). Pitjesbak at a table, gossip overheard,
// the fire, tipsy: the server's numbers, the client's show. In the cellar the audience fills
// the benches and three rod puppets play tonight's play, line by line.

type Occ = {
  p: Person;
  human: Human | null;
  kind: HumanKind;
  keeper: boolean;
  seat: Seat | null;
  stand: Spot | null;
  x: number;
  z: number;
  yaw: number;
  path: Pt[];
  leaving: boolean;
  gone: boolean;
};

interface Line {
  who: string;
  name: string;
  text: string;
  /** M6 ballads: how long this line stays up (a sung line lasts its tune). */
  secs?: number;
}

const HEAD_STAND = 1.78;
const HEAD_SIT = 1.32;
const WALK_IN = 1.1;
const REACH_DOOR = 1.8;

/** Human kinds that stand (skirts, aprons, loads); the rest may sit. */
const STANDERS = new Set(["peeters", "fientje", "fishwife_a", "fishwife_b", "maid", "girl", "wife_a", "wife_b", "shopwife", "old_woman", "girl_b", "baker", "shopkeeper", "publican", "docker_sack", "porter", "carter", "sentry"]);

const UNLOADED: Record<string, string> = { docker_sack: "docker_b", porter: "docker_c", carter: "docker_a", sentry: "soldier" };

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}

export class Interiors {
  info: InteriorsInfo | null = null;
  /** The room Jef is in, or null in the street. */
  room: Room | null = null;
  private here: { kind: "tavern" | "cellar" | "home" | "landmark"; place: string; label: string; step: Pt; out: Pt; origin: { x: number; z: number }; yaw: number } | null = null;
  private rooms = new Map<string, Room>();
  private occ = new Map<string, Occ>();
  private seatTaken = new Map<Seat, string>();
  private jefSeat: Seat | null = null;
  private busy = false;
  private t = 0;
  private syncT = 0;
  private chatT = 20;
  private infoT = 0;
  private tipsyNow = 0;
  private tipsyTarget = 0;
  private tipsyT = 0;
  private swayT = 0;
  private script: { lines: Line[]; i: number; t: number; tag: HTMLDivElement | null; onLine?: (l: Line) => void; onEnd?: () => void; sung?: boolean } | null = null;
  private readonly fadeEl = document.createElement("div");
  private readonly caption = document.createElement("div");
  private readonly dice = new DicePanel();
  private decorated = false;
  private show: { play: PlayInfo | null; stage: "wait" | "opening" | "title" | "lines" | "closing" | "rest" | "over"; t: number; puppets: Puppet[]; writing: boolean } | null = null;
  private lampOut: Array<{ sprite: THREE.Sprite; light: THREE.Mesh }> = [];

  /** Set by main. */
  say: (t: string) => void = () => {};
  sfx: (name: Sfx) => void = () => {};
  speak: (at: { x: number; z: number }, voice: { sex: "m" | "f"; age: number }, seconds: number) => void = () => {};
  /** The room's sound: "tavern", "cellar", "home", a landmark's hall ("church", "hall" ...), or null back in the street. */
  roomSound: (kind: string | null) => void = () => {};
  /** M6 homes (game/homes.ts): the keys inside a rented room, besides the door and the people. */
  homeKeys: ((x: number, z: number) => { options: Array<[number, Action]>; extra: Action[] }) | null = null;
  /** M6 landmark interiors (game/landmarks.ts): the keys inside a landmark, and which seats its people hold. */
  landmarkKeys: ((x: number, z: number) => { options: Array<[number, Action]>; extra: Action[] }) | null = null;
  seatBusy: ((s: Seat) => boolean) | null = null;
  /** M6 ballads (game/ballads.ts): keys in a tavern besides the counter, the fire and the people (buy a ballad sheet). */
  tavernKeys: ((x: number, z: number) => { options: Array<[number, Action]>; extra: Action[] }) | null = null;
  /** Jef sat down or stood up (the landmarks: the chair money at mass). */
  onSeat: (s: Seat | null) => void = () => {};
  /** M6 treat (game/hands.ts): keys while Jef sits at a table (talk to the one he stood a drink). */
  seatedKeys: (() => Action[]) | null = null;

  constructor(
    private readonly player: FirstPerson,
    private readonly jobs: Jobs,
    private readonly worldScene: THREE.Scene,
  ) {
    this.fadeEl.className = "room-fade";
    this.caption.className = "poesje-caption";
    document.body.append(this.fadeEl, this.caption);
    this.dice.onPayload = (p) => this.jobs.refresh(p);
    this.dice.sfx = (n) => this.sfx(n);
    this.dice.player = player;
    // a drink bought anywhere: how tipsy now (the server counts it)
    const bought = jobs.talk.onBought;
    jobs.talk.onBought = (p, line) => {
      bought(p, line);
      this.refreshTipsy();
    };
    // the night sheet (midnight, or bed) takes Jef out of any room, quietly
    const sheet = jobs.day.onSheet;
    jobs.day.onSheet = () => {
      sheet();
      if (this.room) this.leave(true);
    };
    void this.load();
  }

  get inside(): boolean {
    return this.room !== null;
  }

  async load(): Promise<void> {
    try {
      this.info = await interiorApi.info();
      this.tipsyTarget = this.info.tipsy;
      if (!this.decorated) this.decorate();
    } catch {
      /* the server is not up yet: try again at the next refresh */
    }
  }

  private refreshTipsy(): void {
    interiorApi
      .tipsy()
      .then((r) => (this.tipsyTarget = r.tipsy))
      .catch(() => {});
  }

  // ------------------------------------------------------------------ the doors in the street

  /** Where a door's step is and the wall behind it (1.2 m in, the town's door step). */
  private doors(): Array<{ kind: "tavern" | "cellar"; place: string; label: string; step: Pt; out: Pt; wall: Pt; open: boolean }> {
    const out: ReturnType<Interiors["doors"]> = [];
    for (const t of this.info?.taverns ?? []) out.push({ kind: "tavern", place: t.place, label: t.label, step: t.door, out: t.out, wall: [t.door[0] - t.out[0] * 1.2, t.door[1] - t.out[1] * 1.2], open: t.open });
    const p = this.info?.poesje;
    if (p) out.push({ kind: "cellar", place: "poesje", label: "the Poesje", step: p.door, out: p.out, wall: p.wall, open: p.open });
    return out;
  }

  /** A painted board over each door, and a lantern at the Poesje's that is lit in the evening. */
  private decorate(): void {
    this.decorated = true;
    for (const d of this.doors()) {
      const text = d.kind === "cellar" ? "POESJE" : d.label.toUpperCase();
      if (d.kind === "tavern") {
        // a tavern hangs its name out on an iron bracket, across the pavement, read from either way
        const board = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.42), new THREE.MeshBasicMaterial({ map: signTexture(text), color: 0x9a8a70, side: THREE.DoubleSide }));
        board.position.set(d.wall[0] + d.out[0] * 1.05, 2.95, d.wall[1] + d.out[1] * 1.05);
        board.rotation.y = Math.atan2(d.out[0], d.out[1]) + Math.PI / 2;
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 1.9), new THREE.MeshBasicMaterial({ color: 0x1a1816 }));
        arm.position.set(d.wall[0] + d.out[0] * 0.95, 3.2, d.wall[1] + d.out[1] * 0.95);
        arm.rotation.y = Math.atan2(d.out[0], d.out[1]);
        this.worldScene.add(board, arm);
      } else {
        const board = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.34), new THREE.MeshBasicMaterial({ map: signTexture(text), color: 0x9a8a70 }));
        board.position.set(d.wall[0] + d.out[0] * 0.2, 3.1, d.wall[1] + d.out[1] * 0.2);
        board.rotation.y = Math.atan2(d.out[0], d.out[1]);
        this.worldScene.add(board);
      }
      if (d.kind === "cellar") {
        const side: Pt = [-d.out[1], d.out[0]];
        const lx = d.wall[0] + d.out[0] * 0.25 + side[0] * 0.9;
        const lz = d.wall[1] + d.out[1] * 0.25 + side[1] * 0.9;
        const light = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, 0.16), new THREE.MeshBasicMaterial({ color: 0x3a3228 }));
        light.position.set(lx, 2.2, lz);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffb060, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
        sprite.scale.set(1.1, 1.1, 1);
        sprite.position.set(lx, 2.2, lz);
        this.worldScene.add(light, sprite);
        this.lampOut.push({ sprite, light });
      }
    }
  }

  /** For the path check: every door must be reachable on foot. */
  pathPoints(): Array<{ label: string; x: number; z: number; reach: number }> {
    return this.doors().map((d) => ({ label: `door of ${d.label}`, x: d.step[0], z: d.step[1], reach: 1.6 }));
  }

  // ------------------------------------------------------------------ keys (Jobs.extraActions)

  keys(x: number, z: number): { only?: Action[]; options?: Array<[number, Action]> } {
    if (this.busy) return { only: [] };
    if (this.room) return { only: this.dice.open ? [] : this.insideKeys() };
    if (this.player.riding || this.player.swimming || this.player.climbing || this.player.bikeRiding) return {};
    const options: Array<[number, Action]> = [];
    for (const d of this.doors()) {
      const dist = Math.hypot(d.step[0] - x, d.step[1] - z);
      if (dist > REACH_DOOR) continue;
      if (d.kind === "tavern") options.push([dist - 0.2, { key: "KeyE", text: `go into ${d.label}`, run: () => void this.enterTavern(d.place) }]);
      else {
        const p = this.info!.poesje!;
        options.push([dist - 0.2, d.open ? { key: "KeyE", text: `go down to the Poesje (${p.price_c} c)`, run: () => void this.enterCellar() } : { key: "KeyE", text: "read the board by the cellar door", run: () => this.say(`A painted board: "POESJE. Every evening from seven. ${p.price_c} centimes." The door is shut.`) }]);
      }
    }
    return { options };
  }

  private insideKeys(): Action[] {
    const room = this.room!;
    const w = this.player.rideWalk;
    if (!w) return [];
    if (this.jefSeat) {
      const out: Action[] = [{ key: "KeyE", text: "stand up", run: () => this.standUp() }];
      const mate = this.dicePartner();
      if (mate) out.push({ key: "KeyG", text: `play pitjesbak with ${mate.p.first}`, run: () => void this.openDice(mate) });
      if (this.seatedKeys) out.push(...this.seatedKeys());
      return out;
    }
    const near = (s: Spot | undefined, r: number) => (s ? Math.hypot(s.x - w.x, s.z - w.z) < r : false);
    const opts: Array<[number, Action]> = [];
    const extra: Action[] = [];
    if (near(room.exit, 1.0) && room.kind !== "landmark") opts.push([Math.hypot(room.exit.x - w.x, room.exit.z - w.z), { key: "KeyE", text: room.kind === "cellar" ? "go up the steps into the street" : "go out into the street", run: () => this.leave() }]);
    const keeper = [...this.occ.values()].find((o) => o.keeper && !o.gone);
    if (keeper && near(room.counter, 1.2)) {
      opts.push([0.2, { key: "KeyE", text: `talk to ${keeper.p.first}, the keeper`, run: () => this.talkTo(keeper) }]);
      extra.push({ key: "KeyF", text: `buy at the counter`, run: () => this.jobs.talk.open({ id: keeper.p.id, def: { name: keeper.p.name, title: "the keeper" } }, true) });
    }
    if (near(room.fire, 1.4)) opts.push([0.3, { key: "KeyE", text: "warm yourself at the fire", run: () => void this.warm() }]);
    for (const o of this.occ.values()) {
      if (o.gone || o.leaving || o.keeper) continue;
      const d = Math.hypot(o.x - w.x, o.z - w.z);
      if (d < 1.5) opts.push([d, { key: "KeyE", text: `talk to ${o.p.name}`, run: () => this.talkTo(o) }]);
    }
    if (room.kind === "home" && this.homeKeys) {
      const hk = this.homeKeys(w.x, w.z);
      opts.push(...hk.options);
      extra.push(...hk.extra);
    }
    if (room.kind === "landmark" && this.landmarkKeys) {
      const lk = this.landmarkKeys(w.x, w.z);
      opts.push(...lk.options);
      extra.push(...lk.extra);
    }
    if (room.kind === "tavern" && this.tavernKeys) {
      const tk = this.tavernKeys(w.x, w.z);
      opts.push(...tk.options);
      extra.push(...tk.extra);
    }
    let best: Seat | null = null;
    let bd = 0.85;
    for (const s of room.seats) {
      if (this.seatTaken.has(s) || this.seatBusy?.(s)) continue;
      const d = Math.hypot(s.x - w.x, s.z - w.z);
      if (d < bd) [best, bd] = [s, d];
    }
    if (best) {
      const s = best;
      opts.push([bd + 0.1, { key: "KeyE", text: room.kind === "cellar" ? "sit down on the bench" : room.kind === "landmark" ? "sit down" : s.table === 9 ? "sit at the counter" : "sit down at the table", run: () => this.sitDown(s) }]);
    }
    opts.sort((a, b) => a[0] - b[0]);
    return [...(opts.length ? [opts[0][1]] : []), ...extra];
  }

  private talkTo(o: Occ): void {
    this.jobs.talk.open({ id: o.p.id, def: { name: o.p.name, title: o.keeper ? "the keeper" : undefined } });
    // they turn to Jef
    const w = this.player.rideWalk;
    if (w && !o.seat) o.yaw = Math.atan2(w.x - o.x, w.z - o.z);
  }

  // ------------------------------------------------------------------ in and out

  private fade(then: () => void | Promise<void>): Promise<void> {
    this.fadeEl.classList.add("on");
    return new Promise((res) =>
      setTimeout(async () => {
        try {
          await then();
        } finally {
          setTimeout(() => this.fadeEl.classList.remove("on"), 60);
          res();
        }
      }, 360),
    );
  }

  /**
   * M6 homes: go into a room made elsewhere (a rented home, world/homeRooms.ts), at its door,
   * with the same fade, walk and sound as the taverns. `then` runs inside the fade.
   */
  async enterOwn(room: Room, d: { place: string; label: string; step: Pt; out: Pt; wall?: Pt }, then?: () => void, quiet = false, kind: "home" | "landmark" = "home"): Promise<boolean> {
    if (this.busy || this.room) return false;
    this.busy = true;
    try {
      const f = this.frame(d.step, d.out, d.wall);
      const go = () => {
        this.enterRoom(room, { kind, place: d.place, label: d.label, step: d.step, out: d.out, ...f });
        then?.();
      };
      if (quiet) go();
      else await this.fade(go);
      return true;
    } finally {
      this.busy = false;
    }
  }

  /** M6 homes: where a room made elsewhere must stand for its door (origin and turn of its frame). */
  frameOf(step: Pt, out: Pt, wall?: Pt): { origin: { x: number; z: number }; yaw: number } {
    return this.frame(step, out, wall);
  }

  /** The place of the room Jef is in ("tavern:ankere", "poesje", a home's id), or null. */
  get placeId(): string | null {
    return this.here?.place ?? null;
  }

  /** M6 homes: someone at the door of the room (the widow, a neighbour) says a line; null sends them off. */
  visit(p: Person | null, line?: string): void {
    if (!this.room) return;
    this.syncPeople(p ? [p] : [], null, false);
    if (p && line) this.play([{ who: p.id, name: p.first, text: line }]);
  }

  private frame(step: Pt, out: Pt, wall?: Pt): { origin: { x: number; z: number }; yaw: number } {
    const w = wall ?? [step[0] - out[0] * 1.2, step[1] - out[1] * 1.2];
    return { origin: { x: w[0], z: w[1] }, yaw: Math.atan2(-out[0], -out[1]) };
  }

  private enterRoom(room: Room, here: NonNullable<Interiors["here"]>): void {
    const anchor: RideAnchor = { x: here.origin.x, y: 0, z: here.origin.z, yaw: here.yaw, speed: 0 };
    const walk: RideWalk = { x: room.entry.x, z: room.entry.z, walk: room.walk, floor: room.floor ? (x, z) => room.floor!(x, z) : () => 0, pace: room.pace, eye: room.eye, surface: room.surface };
    // look into the room: its +z is the world's -out
    this.player.rideStart(() => anchor, Math.atan2(here.out[0], here.out[1]), walk);
    this.player.pitch = -0.05;
    this.room = room;
    this.here = here;
    this.jefSeat = null;
    this.seatTaken.clear();
    this.roomSound(room.sound ?? room.kind);
  }

  async enterTavern(place: string): Promise<void> {
    if (this.busy || this.room) return;
    if (this.jobs.goods.carried) {
      this.say("Not with that in your arms. Set it down first.");
      return;
    }
    const d = this.doors().find((q) => q.place === place);
    if (!d) return;
    this.busy = true;
    try {
      const st = await interiorApi.tavern(place);
      if (!st.open) {
        this.say(`The door of ${d.label} is barred. ${st.keeper ? `${st.keeper.first} opens again later.` : "Nobody answers."}`);
        return;
      }
      const f = this.frame(d.step, d.out);
      let room = this.rooms.get(place);
      if (!room) this.rooms.set(place, (room = buildTavern({ origin: f.origin, yaw: f.yaw, label: d.label, seed: hash(place) % 9973 })));
      const r = room;
      await this.fade(() => {
        this.enterRoom(r, { kind: "tavern", place, label: d.label, step: d.step, out: d.out, ...f });
        this.syncPeople([...(st.keeper ? [{ ...st.keeper, sex: "m" as const, age: 45 }] : []), ...st.patrons], st.keeper?.id ?? null, true);
        this.tipsyTarget = st.tipsy;
        this.chatT = 6 + Math.random() * 6;
      });
      // words for the hour (QA 2026-09-24: "Quiet tonight" at one in the afternoon)
      const h = this.jobs.day.hourF;
      const quiet = h >= 18 || h < 4 ? "Quiet tonight." : h < 12 ? "Quiet this morning." : "Quiet this afternoon.";
      this.say(`${d.label}. Smoke, beer and wet wool. ${st.patrons.length ? `${st.patrons.length} at the tables.` : quiet}`);
    } catch (e) {
      this.say(String((e as Error).message ?? e));
    } finally {
      this.busy = false;
    }
  }

  async enterCellar(): Promise<void> {
    if (this.busy || this.room) return;
    const d = this.doors().find((q) => q.kind === "cellar");
    const p = this.info?.poesje;
    if (!d || !p) return;
    if (this.jobs.goods.carried) {
      this.say("Not with that in your arms. Set it down first.");
      return;
    }
    this.busy = true;
    try {
      // what is on first (free), then pay: a failed look no longer costs Jef his entry money
      const info = await interiorApi.poesje();
      const paid = await interiorApi.enter();
      this.jobs.refresh(paid);
      const f = this.frame(d.step, d.out, p.wall);
      let room = this.rooms.get("poesje");
      if (!room) this.rooms.set("poesje", (room = buildCellar({ origin: f.origin, yaw: f.yaw })));
      const r = room;
      await this.fade(() => {
        this.enterRoom(r, { kind: "cellar", place: "poesje", label: "the Poesje", step: d.step, out: d.out, ...f });
        this.syncPeople(info.audience, null, true);
        this.show = { play: info.play.state === "ready" ? info.play : null, stage: "wait", t: 4, puppets: [], writing: false };
        if (!this.show.play) void this.fetchPlay();
      });
      this.say(paid.line);
    } catch (e) {
      const m = String((e as Error).message ?? e);
      this.say(/money/.test(m) ? `The woman at the door holds out her hand: ${p.price_c} centimes. You have not got it.` : /shut/.test(m) ? "The cellar door is shut. The Poesje plays from seven in the evening." : m);
    } finally {
      this.busy = false;
    }
  }

  private async fetchPlay(): Promise<void> {
    // this show's own fetch: a slow one from an earlier visit must not touch the show on now
    const show = this.show;
    if (!show) return;
    show.writing = true;
    try {
      const pl = await interiorApi.play();
      if (this.show === show) show.play = pl;
    } catch {
      /* the server's own play is written by then, or the evening is over */
    } finally {
      show.writing = false;
    }
  }

  leave(quiet = false, by?: { step: Pt; out: Pt }): void {
    if (!this.room || !this.here) return;
    const h = by ? { ...this.here, step: by.step, out: by.out } : this.here;
    const out = () => {
      this.dice.close();
      this.endScript();
      this.clearShow();
      for (const o of this.occ.values()) o.human?.dispose();
      this.occ.clear();
      this.seatTaken.clear();
      this.jefSeat = null;
      this.player.rideSeat = null;
      this.onSeat(null);
      this.player.rideEnd(h.step[0] + h.out[0] * 0.3, h.step[1] + h.out[1] * 0.3);
      this.player.yaw = Math.atan2(-h.out[0], -h.out[1]);
      this.room = null;
      this.here = null;
      this.roomSound(null);
    };
    if (quiet) out();
    else void this.fade(out);
  }

  // ------------------------------------------------------------------ people in the room

  private syncPeople(list: Person[], keeperId: string | null, first: boolean): void {
    const room = this.room!;
    const want = new Set(list.map((p) => p.id));
    for (const o of this.occ.values()) {
      if (!want.has(o.p.id) && !o.leaving && !o.gone) {
        o.leaving = true;
        const via = o.seat ? [...o.seat.via].reverse() : [];
        this.free(o);
        o.path = [...via, [room.entry.x - 0.3, room.entry.z + 1.2], [room.exit.x, room.exit.z - 0.3]];
      }
    }
    for (const p of list) {
      const had = this.occ.get(p.id);
      if (had) {
        // M6 treat: the guest's part changes as the rounds go (merry: guest_tipsy)
        if (had.p.role !== p.role) had.p = { ...had.p, role: p.role };
        continue;
      }
      const keeper = p.id === keeperId;
      // indoors nobody carries his load: the sack man, the porter and the carter come in empty-handed
      const k = UNLOADED[p.kind] ?? p.kind;
      const kind: HumanKind = isHumanKind(k) ? k : p.sex === "f" ? "wife_a" : p.age < 16 ? "boy" : "docker_a";
      const o: Occ = { p, human: null, kind, keeper, seat: null, stand: null, x: room.entry.x, z: room.entry.z, yaw: 0, path: [], leaving: false, gone: false };
      if (keeper && room.keeper) o.stand = room.keeper;
      else this.place(o);
      const spot = o.seat ?? o.stand;
      if (first || keeper) {
        if (spot) [o.x, o.z, o.yaw] = [spot.x, spot.z, spot.yaw];
      } else if (spot) o.path = [[room.entry.x, room.entry.z + 1.3], ...(o.seat?.via ?? []), [spot.x, spot.z]];
      this.occ.set(p.id, o);
      this.dress(o);
    }
  }

  /** A seat for those who can sit (by id, so the same man takes the same place), else a place to stand. */
  private place(o: Occ): void {
    const room = this.room!;
    // M6 ballads: a guest who stands to sing (the ballad singer) takes no seat
    const sitter = !o.p.stand && !STANDERS.has(o.kind) && (room.kind === "cellar" || o.p.age >= 16);
    const h = hash(o.p.id);
    if (sitter) {
      // in the cellar the children sit in front; M6 treat: Jef's guest takes a table with a free seat beside for him
      const guest = o.p.role?.startsWith("guest") && room.kind === "tavern";
      const freeAt = (tb: number) => room.seats.filter((q) => q.table === tb && !this.seatTaken.has(q)).length;
      const seats =
        room.kind === "cellar" && o.p.age < 16
          ? [...room.seats].sort((a, b) => b.z - a.z)
          : guest
            ? room.seats.filter((q) => q.table !== 9 && freeAt(q.table) >= 2)
            : room.seats;
      const start = (room.kind === "cellar" && o.p.age < 16) || !seats.length ? 0 : h % seats.length;
      for (let k = 0; k < seats.length; k++) {
        const s = seats[(start + k) % seats.length];
        if (!this.seatTaken.has(s)) {
          this.seatTaken.set(s, o.p.id);
          o.seat = s;
          return;
        }
      }
    }
    this.standFor(o);
  }

  private standFor(o: Occ): void {
    const room = this.room!;
    const used = new Set([...this.occ.values()].map((q) => q.stand));
    const free = room.stands.filter((s) => !used.has(s));
    const h = hash(o.p.id);
    o.stand = free.length ? free[h % free.length] : room.stands[h % room.stands.length];
  }

  private free(o: Occ): void {
    if (o.seat) this.seatTaken.delete(o.seat);
    o.seat = null;
    o.stand = null;
  }

  private dress(o: Occ): void {
    if (o.human || !this.room) return;
    const h = makeHuman(o.kind);
    if (!h) return;
    o.human = h;
    this.room.group.add(h.root);
    // a seat of a kind that cannot sit after all (the model says): stand beside it instead
    if (o.seat && !h.canSit) {
      const was = o.seat;
      this.seatTaken.delete(was);
      o.seat = null;
      this.standFor(o);
      const spot = o.stand!;
      if (!o.path.length || o.path[o.path.length - 1][0] === was.x) {
        if (o.path.length) o.path = [[this.room.entry.x, this.room.entry.z + 1.3], [spot.x, spot.z]];
        else [o.x, o.z, o.yaw] = [spot.x, spot.z, spot.yaw];
      }
    }
  }

  private updatePeople(dt: number): void {
    const talkingTo = this.jobs.talk.isOpen;
    const speaking = this.script?.lines[this.script.i]?.who;
    for (const [id, o] of this.occ) {
      if (!o.human) this.dress(o);
      const h = o.human;
      if (o.path.length) {
        const [tx, tz] = o.path[0];
        const dx = tx - o.x;
        const dz = tz - o.z;
        const d = Math.hypot(dx, dz);
        const step = WALK_IN * dt;
        if (d <= step) {
          o.x = tx;
          o.z = tz;
          o.path.shift();
          if (!o.path.length && o.leaving) {
            o.gone = true;
            h?.dispose();
            this.occ.delete(id);
            continue;
          }
          if (!o.path.length) {
            const spot = o.seat ?? o.stand;
            if (spot) o.yaw = spot.yaw;
          }
        } else {
          o.x += (dx / d) * step;
          o.z += (dz / d) * step;
          o.yaw = Math.atan2(dx, dz);
        }
      }
      if (!h) continue;
      const walking = o.path.length > 0;
      const sitting = !walking && !!o.seat;
      if (walking) {
        h.play("walk");
        h.setPace(WALK_IN);
      } else if (sitting) h.play("sit");
      else h.play(speaking === id || (talkingTo && o.keeper) ? "talk" : o.keeper ? "idle" : "fold");
      h.root.position.set(o.x, (sitting ? h.sitDrop(o.seat!.h) : 0) + h.bob(), o.z);
      h.root.rotation.y = o.yaw;
      // M6 treat: a guest merry on Jef's rounds sways a little in the seat
      h.root.rotation.z = o.p.role === "guest_tipsy" ? Math.sin(this.t * 1.3 + (hash(id) % 7)) * 0.06 : 0;
      h.update(dt);
    }
  }

  // ------------------------------------------------------------------ Jef sits

  private sitDown(s: Seat): void {
    const w = this.player.rideWalk;
    if (!w || this.seatTaken.has(s)) return;
    this.seatTaken.set(s, "jef");
    this.jefSeat = s;
    this.player.rideSeat = { x: s.x, y: this.room?.floor?.(s.x, s.z) ?? 0, z: s.z, eye: s.h + 0.72 };
    // face the table (or the stage): the seat's own facing, turned into the player's yaw
    const room = this.room!;
    const f = room.toWorld(s.x + Math.sin(s.yaw), s.z + Math.cos(s.yaw));
    const p = room.toWorld(s.x, s.z);
    this.player.yaw = Math.atan2(-(f.x - p.x), -(f.z - p.z));
    this.player.pitch = room.kind === "cellar" ? 0.02 : room.kind === "landmark" ? 0.05 : -0.12;
    this.onSeat(s);
    if (room.kind === "tavern" && s.table !== 9) void this.overhear();
  }

  private standUp(): void {
    const s = this.jefSeat;
    if (!s) return;
    this.seatTaken.delete(s);
    this.jefSeat = null;
    this.player.rideSeat = null;
    this.onSeat(null);
    const w = this.player.rideWalk;
    if (w) {
      // step back from the table into the room
      const [x, z] = this.room!.walk(w.x, w.z, s.x - Math.sin(s.yaw) * 0.45, s.z - Math.cos(s.yaw) * 0.45);
      w.x = x;
      w.z = z;
    }
    this.dice.close();
  }

  /** A drinker at Jef's table (or seated close by) to play dice with. */
  private dicePartner(): Occ | null {
    const s = this.jefSeat;
    if (!s || this.room?.kind !== "tavern") return null;
    let best: Occ | null = null;
    let bd = 2.6;
    for (const o of this.occ.values()) {
      if (o.keeper || o.leaving || o.path.length || !o.seat) continue;
      const d = o.seat.table === s.table ? 0 : Math.hypot(o.x - s.x, o.z - s.z);
      if (d < bd) [best, bd] = [o, d];
    }
    return best;
  }

  private async openDice(o: Occ): Promise<void> {
    if (!this.here) return;
    try {
      const r = await interiorApi.sit(this.here.place, o.p.id);
      this.dice.show(this.here.place, o.p, r.line, r.stakes, r.left, this.jobs.talk.money);
    } catch (e) {
      this.say(String((e as Error).message ?? e));
    }
  }

  private async warm(): Promise<void> {
    if (!this.here) return;
    try {
      const r = await interiorApi.fire(this.here.place);
      this.jobs.refresh(r);
      this.say(r.text);
    } catch (e) {
      this.say(String((e as Error).message ?? e));
    }
  }

  /** Jef sits near two drinkers: he overhears them (the server picks the facts; once a game hour). */
  private async overhear(): Promise<void> {
    const pair = this.pairNear();
    if (!pair || !this.here || this.script) return;
    const place = this.here.place;
    try {
      const g = await interiorApi.gossip(place, pair[0].p.id, pair[1].p.id);
      if (this.here?.place === place) this.play(g.lines);
    } catch {
      // nothing new to say this hour: they only chat
      this.chatT = Math.min(this.chatT, 2);
    }
  }

  /** The two drinkers nearest Jef (at his table first). */
  private pairNear(): [Occ, Occ] | null {
    const w = this.player.rideWalk;
    if (!w) return null;
    const s = this.jefSeat;
    const list = [...this.occ.values()]
      .filter((o) => !o.keeper && !o.leaving && !o.path.length)
      .map((o) => ({ o, d: Math.hypot(o.x - w.x, o.z - w.z) - (s && o.seat?.table === s.table ? 3 : 0) }))
      .sort((a, b) => a.d - b.d);
    return list.length >= 2 ? [list[0].o, list[1].o] : null;
  }

  /** Two at one table talk (the M4 conversation now and then, the engine's small talk between). */
  private async chat(): Promise<void> {
    if (!this.here || this.script || this.room?.kind !== "tavern") return;
    const seated = [...this.occ.values()].filter((o) => !o.keeper && !o.leaving && !o.path.length);
    const byTable = new Map<number, Occ[]>();
    for (const o of seated) if (o.seat) byTable.set(o.seat.table, [...(byTable.get(o.seat.table) ?? []), o]);
    const tables = [...byTable.values()].filter((l) => l.length >= 2);
    const pair = tables.length ? tables[Math.floor(Math.random() * tables.length)].slice(0, 2) : seated.length >= 2 ? seated.slice(0, 2) : null;
    if (!pair) return;
    const place = this.here.place;
    try {
      const r: TalkLines = await interiorApi.chat(place, pair[0].p.id, pair[1].p.id);
      if (this.here?.place === place && !this.script) this.play(r.lines);
    } catch {
      /* they drink in silence */
    }
  }

  /** A conversation the server pushed (M4): shown here if both are in this room. */
  convo(c: { lines: Line[]; a: string; b: string }): void {
    if (this.room && this.occ.has(c.a) && this.occ.has(c.b) && !this.script) this.play(c.lines);
  }

  // ------------------------------------------------------------------ lines over heads

  private play(lines: Line[], onLine?: (l: Line) => void, onEnd?: () => void): void {
    this.endScript();
    this.script = { lines, i: -1, t: 0, tag: null, onLine, onEnd };
  }

  /**
   * M6 ballads: someone in the room sings (game/ballads.ts): the lines over their head, each for
   * its own time; the tune is played by `onLine`, so no murmur of speech. False if they are not here.
   */
  sing(who: string, lines: Line[], onLine: (l: Line) => void, onEnd?: () => void): boolean {
    if (!this.room || !this.occ.has(who) || this.script) return false;
    this.play(lines, onLine, onEnd);
    this.script!.sung = true;
    return true;
  }

  /** M6 ballads: is someone singing or talking in the room now? */
  get scriptBusy(): boolean {
    return this.script !== null;
  }

  /** M6 ballads: where someone in the room stands (world metres) and their voice; null if not here. */
  personAt(who: string): { x: number; z: number; voice: { sex: "m" | "f"; age: number }; dist: number } | null {
    const o = this.occ.get(who);
    const room = this.room;
    if (!o || !room || o.gone || o.leaving) return null;
    const at = room.toWorld(o.x, o.z);
    const w = this.player.rideWalk;
    return { x: at.x, z: at.z, voice: { sex: o.p.sex, age: o.p.age }, dist: w ? Math.hypot(o.x - w.x, o.z - w.z) : 99 };
  }

  private endScript(): void {
    this.script?.tag?.remove();
    this.script = null;
  }

  private headOf(who: string): { local: THREE.Vector3; voice: { sex: "m" | "f"; age: number } } | null {
    const pup = this.show?.puppets.find((p) => p.role === who);
    if (pup) {
      const v = pup.group.position.clone();
      v.y += 0.72;
      const third = this.show?.play?.third ?? "";
      const voice = who === "neus" ? { sex: "m" as const, age: 10 } : who === "schele" ? { sex: "m" as const, age: 64 } : { sex: /bride|wife|widow|woman|maid|girl/i.test(third) ? ("f" as const) : ("m" as const), age: 35 };
      return { local: v, voice };
    }
    const o = this.occ.get(who);
    if (!o) return null;
    const sitting = !!o.seat && !o.path.length;
    return { local: new THREE.Vector3(o.x, sitting ? HEAD_SIT : o.p.age < 13 ? 1.3 : HEAD_STAND, o.z), voice: { sex: o.p.sex, age: o.p.age } };
  }

  private updateScript(dt: number): void {
    const s = this.script;
    if (!s || !this.room) return;
    s.t -= dt;
    if (s.t <= 0) {
      s.i++;
      if (s.i >= s.lines.length) {
        const end = s.onEnd;
        this.endScript();
        end?.();
        return;
      }
      const l = s.lines[s.i];
      s.t = l.secs ?? Math.min(5.5, 2.6 + l.text.length / 38);
      if (!s.tag) {
        s.tag = document.createElement("div");
        s.tag.className = "bubble";
        document.body.appendChild(s.tag);
      }
      s.tag.innerHTML = `<b>${esc(l.name)}</b>${esc(l.text)}`;
      s.onLine?.(l);
      const h = this.headOf(l.who);
      if (h && !s.sung) {
        const at = this.room.toWorld(h.local.x, h.local.z);
        this.speak({ x: at.x, z: at.z }, h.voice, Math.min(s.t - 0.4, 4));
      }
    }
    if (s.tag && s.i >= 0) {
      const h = this.headOf(s.lines[s.i].who);
      const cam = this.player.camera;
      cam.updateMatrixWorld();
      const v = h ? this.room.toWorld(h.local.x, h.local.z, h.local.y + 0.15).project(cam) : null;
      if (!v || v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) s.tag.classList.remove("on");
      else {
        s.tag.style.left = `${(((v.x + 1) / 2) * window.innerWidth).toFixed(0)}px`;
        s.tag.style.top = `${(((1 - v.y) / 2) * window.innerHeight).toFixed(0)}px`;
        s.tag.classList.add("on");
      }
    }
  }

  // ------------------------------------------------------------------ the Poesje's show

  private clearShow(): void {
    if (!this.show) return;
    for (const p of this.show.puppets) p.group.removeFromParent();
    this.show = null;
    this.caption.classList.remove("on");
  }

  private captionText(html: string, title = false): void {
    this.caption.innerHTML = html;
    this.caption.classList.toggle("title", title);
    this.caption.classList.add("on");
  }

  private updateShow(dt: number): void {
    const sh = this.show;
    const room = this.room;
    if (!sh || !room?.stage) return;
    for (const p of sh.puppets) p.update(dt);
    sh.t -= dt;
    const stage = room.stage;
    switch (sh.stage) {
      case "wait":
        if (sh.t > 0) return;
        if (!sh.play?.lines?.length) {
          if (!sh.writing && sh.t < -2) void this.fetchPlay();
          if (sh.t < -3 && sh.t > -3 - dt) this.say("The curtain stays shut. Behind it two voices argue about the words.");
          return;
        }
        this.makePuppets(sh.play);
        stage.setCurtain(1);
        this.sfx("thud_soft");
        sh.stage = "opening";
        sh.t = 1.6;
        return;
      case "opening":
        if (sh.t > 0) return;
        this.captionText(`Tonight: <b>${esc(sh.play!.title ?? "")}</b>`, true);
        sh.stage = "title";
        sh.t = 3.2;
        return;
      case "title":
        if (sh.t > 0) return;
        this.caption.classList.remove("on");
        sh.stage = "lines";
        this.play(
          (sh.play!.lines ?? []).map((l: PlayLine) => ({ who: l.who, name: l.who === "neus" ? "Neus" : l.who === "schele" ? "Schele" : (sh.play!.third ?? "The other"), text: l.text })),
          (l) => {
            for (const p of sh.puppets) p.speaking = p.role === l.who;
            const speaker = sh.puppets.find((p) => p.role === l.who);
            const other = sh.puppets.find((p) => p.role !== l.who && (l.who === "neus" ? p.role === "third" || p.role === "schele" : p.role === "neus"));
            for (const p of sh.puppets) p.faceTo(p === speaker && other ? other.home.x : p === other && speaker ? speaker.home.x : null, p === speaker && other ? other.home.z : speaker?.home.z ?? 0);
            if (speaker && /knock|whack|stick|thwack|bonk/i.test(l.text)) {
              speaker.knock();
              other?.hit();
              setTimeout(() => this.sfx("thud_wood"), 250);
            }
            this.captionText(`<b>${esc(l.name)}:</b> ${esc(l.text)}`);
          },
          () => {
            for (const p of sh.puppets) {
              p.speaking = false;
              p.faceTo(null);
            }
            this.caption.classList.remove("on");
            stage.setCurtain(0);
            sh.stage = "closing";
            sh.t = 2;
          },
        );
        return;
      case "lines":
        return;
      case "closing":
        if (sh.t > 0) return;
        this.say("The curtain drops. The children stamp and cheer; a docker whistles through his fingers.");
        sh.stage = "rest";
        sh.t = 25;
        return;
      case "rest":
        if (sh.t > 0) return;
        if (this.jobs.day.hourF >= 22.5 || this.jobs.day.hourF < 6) {
          sh.stage = "over";
          this.say("The lamp behind the curtain goes out. The Poesje is over for tonight.");
          return;
        }
        // the same play again for the next lot
        stage.setCurtain(1);
        sh.stage = "opening";
        sh.t = 1.6;
        return;
    }
  }

  private makePuppets(play: PlayInfo): void {
    const sh = this.show;
    const room = this.room;
    if (!sh || !room?.stage || sh.puppets.length) return;
    const [a, b, c] = room.stage.spots;
    const y = room.stage.feetY;
    sh.puppets = [makePuppet("neus", { x: a.x, z: a.z, y }), makePuppet("schele", { x: b.x, z: b.z, y }), makePuppet("third", { x: c.x, z: c.z, y }, play.third ?? "")];
    for (const p of sh.puppets) room.group.add(p.group);
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number): void {
    this.t += dt;
    // the doors' state and how tipsy: now and then
    this.infoT -= dt;
    if (this.infoT <= 0) {
      this.infoT = 15;
      void this.load();
    }
    this.tipsyT -= dt;
    if (this.tipsyT <= 0) {
      this.tipsyT = this.tipsyTarget > 0 ? 8 : 30;
      if (this.tipsyTarget > 0 || this.room) this.refreshTipsy();
    }
    this.tipsyNow += (this.tipsyTarget - this.tipsyNow) * Math.min(1, dt * 0.25);
    // the Poesje's lantern is lit from half past six
    const h = this.jobs.day.hourF;
    const lit = h >= 18.5 && h < 22.5 ? 1 : 0;
    for (const l of this.lampOut) {
      l.sprite.material.opacity = 0.8 * lit * (0.92 + Math.sin(this.t * 6) * 0.05);
      (l.light.material as THREE.MeshBasicMaterial).color.setHex(lit ? 0xffc070 : 0x3a3228);
    }
    const room = this.room;
    if (!room || !this.here) return;
    room.update(this.t, dt);
    room.setDaylight(Math.max(0, Math.min(1, h < 12 ? (h - 6.5) / 3 : (18.5 - h) / 3)));
    this.updatePeople(dt);
    this.updateScript(dt);
    this.updateShow(dt);
    this.dice.update(dt);
    // who is here changes with the clock: ask the server every few seconds
    if (room.kind === "tavern") {
      this.syncT -= dt;
      if (this.syncT <= 0) {
        this.syncT = 4;
        const place = this.here.place;
        interiorApi
          .tavern(place)
          .then((st) => {
            if (this.here?.place !== place) return;
            this.tipsyTarget = st.tipsy;
            if (!st.open) {
              this.say(`${st.keeper?.first ?? "The keeper"} puts the chairs on the tables. "Closing time. Out you go."`);
              this.leave();
              return;
            }
            this.syncPeople([...(st.keeper ? [{ ...st.keeper, sex: "m" as const, age: 45 }] : []), ...st.patrons], st.keeper?.id ?? null, false);
          })
          .catch(() => {});
      }
      this.chatT -= dt;
      if (this.chatT <= 0) {
        this.chatT = 28 + Math.random() * 22;
        if (!this.dice.open && !this.jobs.talk.isOpen) void this.chat();
      }
    }
  }

  /** After the player's own camera work: a tipsy man's view sways, gently. */
  sway(dt: number): void {
    const k = Math.min(1, this.tipsyNow / 4);
    if (k < 0.02) return;
    this.swayT += dt;
    const t = this.swayT;
    const cam = this.player.camera;
    cam.rotation.z += (Math.sin(t * 0.83) * 0.03 + Math.sin(t * 1.9) * 0.006) * k;
    cam.rotation.x += Math.sin(t * 0.61 + 1.3) * 0.012 * k;
    cam.rotation.y += Math.sin(t * 0.47 + 0.4) * 0.018 * k;
    cam.position.y += Math.sin(t * 0.9) * 0.02 * k;
  }

  /** Before the frame is drawn inside: the room's lamps and fire glow in its smoke. */
  prepareRender(camera: THREE.Camera): THREE.Scene | null {
    const room = this.room;
    if (!room) return null;
    camera.updateMatrixWorld();
    const slots = psxUniforms.uLamps.value;
    for (let i = 0; i < MAX_LAMPS; i++) {
      const l = room.lamps[i];
      if (l) slots[i].set(l.p.x, l.p.y, l.p.z, l.w);
      else slots[i].set(0, -999, 0, 0);
    }
    psxUniforms.uScatter.value = room.kind === "cellar" ? 0.5 : room.kind === "landmark" ? 0.3 : 0.4;
    return room.scene;
  }

  /** Dev: go straight in (a tavern id, or "poesje"), without walking to the door. */
  async devEnter(place: string): Promise<string> {
    if (this.room) this.leave(true);
    await this.load();
    const d = this.doors().find((q) => q.place === place || q.place === `tavern:${place}`);
    if (!d) return `no such door: ${place}`;
    this.player.rideEnd(d.step[0], d.step[1]);
    if (d.kind === "tavern") await this.enterTavern(d.place);
    else await this.enterCellar();
    return this.room ? `inside ${d.label}` : "not let in";
  }

  /** Dev: walk Jef to a point of the room frame (and sit if a seat is there). */
  devGo(x: number, z: number): void {
    const w = this.player.rideWalk;
    if (!w) return;
    if (this.jefSeat) this.standUp();
    w.x = x;
    w.z = z;
  }

  /** Dev: the state for scripted checks. */
  debug() {
    const w = this.player.rideWalk;
    return {
      inside: this.here?.label ?? null,
      kind: this.room?.kind ?? null,
      jef: w ? [+w.x.toFixed(2), +w.z.toFixed(2)] : null,
      seated: !!this.jefSeat,
      people: [...this.occ.values()].map((o) => ({ id: o.p.id, name: o.p.name, kind: o.kind, keeper: o.keeper, seat: o.seat ? o.seat.table : null, walking: o.path.length > 0, model: !!o.human })),
      keys: this.room ? this.insideKeys().map((a) => `${a.key.slice(3)}: ${a.text}`) : [],
      script: this.script ? { at: this.script.i, of: this.script.lines.length, line: this.script.lines[this.script.i]?.text ?? null } : null,
      show: this.show ? { stage: this.show.stage, title: this.show.play?.title ?? null, third: this.show.play?.third ?? null, lines: this.show.play?.lines?.length ?? 0, puppets: this.show.puppets.length } : null,
      dice: this.dice.open,
      tipsy: +this.tipsyNow.toFixed(2),
      tipsyTarget: this.tipsyTarget,
      doors: this.doors().map((d) => ({ label: d.label, open: d.open, step: d.step })),
    };
  }

  /** Dev: a camera in the room frame looking at a point of it (for pictures). */
  devCamera(cam: THREE.PerspectiveCamera, from: [number, number, number], to: [number, number, number]): boolean {
    const room = this.room;
    if (!room) return false;
    cam.position.copy(room.toWorld(from[0], from[2], from[1]));
    cam.lookAt(room.toWorld(to[0], to[2], to[1]));
    cam.updateMatrixWorld();
    return true;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

// ------------------------------------------------------------------ the dice panel

const FACES = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

class DicePanel {
  readonly el = document.createElement("div");
  open = false;
  private place = "";
  private who: Person | null = null;
  private stakes: number[] = [];
  private left = { games: 0, loss_c: 0 };
  private money = 0;
  private rolling = 0;
  private busy = false;
  private mine = "⚀⚀⚀";
  private theirs = "⚀⚀⚀";
  private scores = ["", ""];
  private line = "";
  private cls = "";
  onPayload: (p: JobsPayload) => void = () => {};
  sfx: (n: Sfx) => void = () => {};
  player: FirstPerson | null = null;

  constructor() {
    this.el.className = "dice-panel";
    this.el.style.display = "none";
    document.body.appendChild(this.el);
    window.addEventListener("keydown", (e) => this.onKey(e), true);
  }

  show(place: string, who: Person, line: string, stakes: number[], left: { games: number; loss_c: number }, money: number): void {
    this.place = place;
    this.who = who;
    this.stakes = stakes;
    this.left = left;
    this.money = money;
    this.line = line;
    this.cls = "";
    this.scores = ["", ""];
    this.open = true;
    if (this.player) this.player.frozen = true;
    this.el.style.display = "block";
    this.render();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    if (this.player) this.player.frozen = false;
    this.el.style.display = "none";
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.open) return;
    e.stopPropagation();
    if (e.repeat) return;
    if (e.code === "KeyE" || e.code === "Escape") return this.close();
    const n = Number(e.key);
    if (n >= 1 && n <= this.stakes.length) void this.throwFor(this.stakes[n - 1]);
  }

  private async throwFor(stake: number): Promise<void> {
    if (this.busy || !this.who) return;
    this.busy = true;
    this.rolling = 0.8;
    this.sfx("thud_plank");
    this.line = "The cup rattles...";
    this.cls = "";
    try {
      const r = await interiorApi.dice(this.place, this.who.id, stake);
      await new Promise((res) => setTimeout(res, Math.max(0, this.rolling * 1000)));
      this.rolling = 0;
      this.mine = r.jef.dice.map((d) => FACES[d]).join("");
      this.theirs = r.them.dice.map((d) => FACES[d]).join("");
      this.scores = [r.jef.name, r.them.name];
      this.left = r.left;
      this.money = r.player.money_c;
      this.cls = r.result > 0 ? "won" : r.result < 0 ? "lost" : "";
      const head = r.result > 0 ? `You win ${stake} c.` : r.result < 0 ? `You lose ${stake} c.` : "Even: nobody pays.";
      this.line = `${head} ${r.line}`;
      this.sfx(r.result ? "coins" : "thud_soft");
      this.onPayload(r);
    } catch (e) {
      this.rolling = 0;
      this.line = String((e as Error).message ?? e);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  update(dt: number): void {
    if (!this.open || this.rolling <= 0) return;
    this.rolling -= dt;
    const r = () => FACES[1 + Math.floor(Math.random() * 6)];
    this.mine = r() + r() + r();
    this.theirs = r() + r() + r();
    this.render();
  }

  private render(): void {
    const w = this.who;
    if (!w) return;
    const keys = this.stakes.map((s, i) => `${i + 1}  throw for ${s} c`).join(" &middot; ");
    this.el.innerHTML = `<h3>Pitjesbak with ${esc(w.first)}</h3>
      <div class="row"><span class="who">You</span><span class="faces">${this.mine}</span><span class="score">${esc(this.scores[0])}</span></div>
      <div class="row"><span class="who">${esc(w.first)}</span><span class="faces">${this.theirs}</span><span class="score">${esc(this.scores[1])}</span></div>
      <p class="line ${this.cls}">${esc(this.line)}</p>
      <p class="keys">${keys} &middot; E  stop<br>An ace counts 100, a six 60; six-five-four beats points; three alike beat all. You have ${this.money} c; ${this.left.games} throws left today, and you may lose ${this.left.loss_c} c more.</p>`;
  }
}
