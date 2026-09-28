import * as THREE from "three";
import "./interiors.css";
import { buildCellar, buildTavern, type Room, type Seat, type Spot } from "../world/rooms";
// M7 shops: every shop's ground floor in its own house (world/shopRooms.ts), its keeper and customers
import { buildShop } from "../world/shopRooms";
import { buildCafe, CAFE_STYLE } from "../world/cafeRooms";
import { hangShopSigns, type FrontSpan } from "../world/shopSigns";
// empty fronts (2026-09-26): shutters up on a shut shop; the net for listed houses left without a room
import { makeShutters, shutUp, type Shutters } from "../world/shopShutters";
import { standInHas, updateStandIns } from "../world/emptyFronts";
import { holdProp, shopProp } from "./shopProps";
import { SHOP_LOOK } from "../../../shared/shops";
import { signTexture, glowTexture } from "../world/textures";
import type { FirstPerson, RideAnchor, RideWalk } from "../player/firstPerson";
import type { JobsPayload, Pt } from "../net/api";
import { interiorApi, type InteriorsInfo, type Person, type PlayInfo, type PlayLine, type ShopInfo, type TalkLines } from "../net/interiorApi";
import { isHumanKind, makeHuman, type Human, type HumanKind } from "./humans";
import { makePuppet, type Puppet } from "./puppets";
import type { Action, Sfx } from "./runs";
import { best, pick, type Target } from "./facing";
import type { Jobs } from "./jobs";
import type { World } from "../world/rijnkaai";
import type { InWorld } from "../world/inworld";
import { createHouseInWorld, type HouseInWorld } from "../world/houseInWorld";
import type { HousePlan } from "../../../shared/housePlan";
import * as HP from "../../../shared/hallPlan";
import { dialogs } from "./dialogs";
import { tempest } from "../world/tempest";

// Inside (M6, M7 in the world): the taverns and the Poesje stand inside their own city houses
// (shared/housePlan.ts, world/houseInWorld.ts): their doors stand open in opening hours and you walk in;
// from the street you see the lit taproom, the keeper and the drinkers through the windows, and from inside
// the street. The Poesje's door opens in the evening onto a flight down into the cellar; you pay at the door
// as you go in. The keeper and the drinkers are the town's residents the schedule puts there (the server
// says who); they sit at the tables, talk in bubbles, and can be talked to as ever. Buying goes through the
// keeper's own wares (trade.ts). Pitjesbak at a table, gossip overheard, the fire, tipsy: the server's
// numbers, the client's show. In the cellar the audience fills the benches and three rod puppets play
// tonight's play, line by line. The life runs for the building nearest Jef (within 70 m) or the home he is
// in (game/homes.ts: setHome); sitting uses the player's carriage mode in the house's frame.

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

/** A building whose life can run: a tavern, the Poesje, or Jef's home (world/houseInWorld.ts). */
interface Here {
  kind: "tavern" | "cellar" | "home" | "shop";
  place: string;
  label: string;
  room: Room;
  house: HouseInWorld | null;
}

const HEAD_STAND = 1.78;
const HEAD_SIT = 1.32;
const WALK_IN = 1.1;
const REACH_DOOR = 1.8;
/** The life of a tavern or the Poesje runs this near its door (m); another takes over when nearer by 10 m. */
const LIFE_M = 70;

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
  /** The building whose life runs now (null: none near). */
  private here: Here | null = null;
  /** Jef is inside it (past the threshold). */
  private jefIn = false;
  /** The taverns and the Poesje in the world, by place ("tavern:ankere", "poesje"). */
  private houses = new Map<string, { kind: "tavern" | "cellar" | "shop"; house: HouseInWorld }>();
  /** M7 shops: the town's shops (server shops/routes.ts), by place; their rooms are keyed "shop:<id>" in houses. */
  private shops: ShopInfo[] = [];
  private shopsDecorated = false;
  /** Empty fronts: the shops' shutters (world/shopShutters.ts), by "shop:<id>"; and the shops' list has come in once. */
  private shutters = new Map<string, Shutters>();
  private shopsIn = false;
  /** M7 shops: who serves beside the keeper in the shop whose life runs (his wife, a helper). */
  private helperIds = new Set<string>();
  private world: { world: World; inWorld: InWorld; plans: Map<string, HousePlan> } | null = null;
  /** Jef's home while he is in it (game/homes.ts). */
  private home: Here | null = null;
  private occ = new Map<string, Occ>();
  private seatTaken = new Map<Seat, string>();
  private jefSeat: Seat | null = null;
  private busy = false;
  private t = 0;
  private syncT = 0;
  private syncing = false;
  private firstSync = true;
  private chatT = 20;
  private infoT = 0;
  private tipsyNow = 0;
  private tipsyTarget = 0;
  private tipsyT = 0;
  private swayT = 0;
  private script: { lines: Line[]; i: number; t: number; tag: HTMLDivElement | null; onLine?: (l: Line) => void; onEnd?: () => void; sung?: boolean } | null = null;
  private readonly caption = document.createElement("div");
  private readonly dice = new DicePanel();
  private decorated = false;
  private show: { play: PlayInfo | null; stage: "wait" | "opening" | "title" | "lines" | "closing" | "rest" | "over"; t: number; puppets: Puppet[]; writing: boolean } | null = null;
  private lampOut: Array<{ sprite: THREE.Sprite; light: THREE.Mesh }> = [];
  private paidAt = -1;

  /** Set by main. */
  say: (t: string) => void = () => {};
  sfx: (name: Sfx) => void = () => {};
  speak: (at: { x: number; z: number }, voice: { sex: "m" | "f"; age: number }, seconds: number) => void = () => {};
  /** The room's sound: "tavern", "cellar", "home", or null back in the street. */
  roomSound: (kind: string | null) => void = () => {};
  /** The day's light (0 night .. 1 noon), set by main. */
  daylight: () => number = () => 1;
  /** M6 homes (game/homes.ts): the keys inside a rented room, besides the door and the people. */
  homeKeys: ((x: number, z: number) => { options: Array<[number, Action]>; extra: Action[] }) | null = null;
  /** M6 ballads (game/ballads.ts): keys in a tavern besides the counter, the fire and the people (buy a ballad sheet). */
  tavernKeys: ((x: number, z: number) => { options: Array<[number, Action]>; extra: Action[] }) | null = null;
  /** M6 treat (game/hands.ts): keys while Jef sits at a table (talk to the one he stood a drink). */
  seatedKeys: (() => Action[]) | null = null;
  /** M7 shops: the Berg's counter inside the pawn office (game/press.ts), set by main. */
  bergCounter: (() => void) | null = null;

  constructor(
    private readonly player: FirstPerson,
    private readonly jobs: Jobs,
    private readonly worldScene: THREE.Scene,
  ) {
    this.caption.className = "poesje-caption";
    document.body.append(this.caption);
    this.dice.onPayload = (p) => this.jobs.refresh(p);
    this.dice.sfx = (n) => this.sfx(n);
    this.dice.player = player;
    // a drink bought anywhere: how tipsy now (the server counts it)
    const bought = jobs.talk.onBought;
    jobs.talk.onBought = (p, line) => {
      bought(p, line);
      this.refreshTipsy();
    };
    // the night sheet: up from the bench, the dice put away (Jef stays where he is: M7 night)
    const sheet = jobs.day.onSheet;
    jobs.day.onSheet = () => {
      sheet();
      if (this.jefSeat) this.standUp();
      this.dice.close();
    };
    void this.load();
  }

  /** Empty fronts (world/emptyFronts.ts): the shops, the taverns and the Poesje have been built from the server's answer. */
  get frontsLoaded(): boolean {
    return this.shopsIn && !!this.info && !!this.world;
  }

  /** Jef is inside a tavern, the Poesje or his home. */
  get inside(): boolean {
    return this.jefIn && this.here !== null;
  }

  /** M7: is this tavern open with its taproom standing in the world (its keeper and drinkers go in: game/town.ts)? */
  tavernOpen(place: string): boolean {
    const h = this.houses.get(place);
    // M7 shops: "shop:<id>" is open with its room in the world: the keeper and his wife serve inside
    return !!h && (h.kind === "tavern" || h.kind === "shop") && h.house.doorOpen;
  }

  /**
   * The building whose life runs now and how many people are in it (the keeper counts, Jef does not;
   * those walking out do not): the soundscape's talk follows it. Null: none runs, or Jef's home.
   */
  get people(): { place: string; n: number } | null {
    const h = this.here;
    if (!h || h.kind === "home") return null;
    let n = 0;
    for (const o of this.occ.values()) if (!o.gone && !o.leaving) n++;
    return { place: h.place, n };
  }

  /** The room Jef is in, or null in the street. */
  get room(): Room | null {
    return this.inside ? this.here!.room : null;
  }

  /**
   * M7: stand the taverns and the Poesje in their houses (main, once, after the world is built). `plans`: the
   * in-world houses' plans by id (shared/inworld_houses.json). The rooms are built once the server has said
   * which taverns there are (their names for the boards).
   */
  attachWorld(world: World, inWorld: InWorld, plans: Map<string, HousePlan>): void {
    this.world = { world, inWorld, plans };
    this.build();
  }

  private build(): void {
    const w = this.world;
    // (the shops may stand before the taverns: they are built as soon as their own list is in, buildShops)
    if (!w || !this.info || [...this.houses.values()].some((h) => h.kind !== "shop")) return;
    for (const t of this.info.taverns) {
      const plan = w.plans.get(t.place);
      if (!plan) continue;
      // M7 shops: the taverns made over as cafes of their kind (world/cafeRooms.ts); the old taproom otherwise
      const style = CAFE_STYLE[t.place];
      const room = style ? buildCafe({ plan, label: t.label, seed: hash(t.place) % 9973, style }) : buildTavern({ plan, label: t.label, seed: hash(t.place) % 9973 });
      const house = createHouseInWorld(w.world, w.inWorld, plan, room, { color: 0x1a130d, near: 3.5, far: 20 }, 0.4);
      house.doorOpen = t.open;
      this.houses.set(t.place, { kind: "tavern", house });
    }
    this.buildShops();
    const pl = w.plans.get("poesje");
    if (pl && this.info.poesje) {
      const room = buildCellar({ plan: pl });
      const house = createHouseInWorld(w.world, w.inWorld, pl, room, { color: 0x1a130e, near: 3.5, far: 18 }, 0.5);
      house.doorOpen = this.info.poesje.open;
      this.houses.set("poesje", { kind: "cellar", house });
    }
  }

  /** M7 shops: how far each shop's front runs either side of its door (its house plan), for the boards. */
  private shopFronts(): Map<string, FrontSpan> {
    const out = new Map<string, FrontSpan>();
    for (const s of this.shops) {
      const plan = this.world?.plans.get(`shop:${s.place}`);
      if (!plan || Math.hypot(plan.origin.x - s.wall[0], plan.origin.z - s.wall[1]) > 0.8) continue;
      const f = plan.frame;
      // which way local +x runs along the front, seen from the street (to the right or the left)
      const [bx, bz] = HP.toWorld(plan, 0, -1);
      const o: [number, number] = [bx - plan.origin.x, bz - plan.origin.z];
      const [rx, rz] = [o[1], -o[0]];
      const [ax, az] = HP.toWorld(plan, 1, 0);
      const sgn = Math.sign((ax - plan.origin.x) * rx + (az - plan.origin.z) * rz) || 1;
      const at = { wall: [plan.origin.x, plan.origin.z] as [number, number], out: o };
      out.set(s.place, sgn > 0 ? { right: f.x1, left: -f.x0, ...at } : { right: -f.x0, left: f.x1, ...at });
    }
    return out;
  }

  /** M7 shops: a room in its house for every shop whose door is its listed house's door (shared/inworld_houses.json). */
  private buildShops(): void {
    const w = this.world;
    if (!w) return;
    for (const s of this.shops) {
      const key = `shop:${s.place}`;
      // (empty fronts: a shut stand-in already stands in this house, world/emptyFronts.ts)
      if (this.houses.has(key) || !s.trade || standInHas(key)) continue;
      const plan = w.plans.get(key);
      // the town's door must be the listed house's (another save may have its shop elsewhere: then no room)
      if (!plan || Math.hypot(plan.origin.x - s.wall[0], plan.origin.z - s.wall[1]) > 0.8) continue;
      const room = buildShop({ plan, trade: s.trade, label: s.label, seed: hash(s.place) % 9973 });
      const house = createHouseInWorld(w.world, w.inWorld, plan, room, { color: 0x1c1610, near: 3.5, far: 16 }, 0.35);
      house.doorOpen = s.open;
      this.houses.set(key, { kind: "shop", house });
      this.shutters.set(key, makeShutters(plan, w.world.scene, room.scene));
    }
    // the boards and bracket signs over the doors, once (they want the fronts from the house plans)
    if (!this.shopsDecorated && this.shops.length) {
      this.shopsDecorated = true;
      hangShopSigns(this.worldScene, this.shops, this.shopFronts());
    }
  }

  async load(): Promise<void> {
    try {
      // M7 shops: the shops' doors and hours (their own route; a failure leaves the taverns be)
      try {
        this.shops = (await interiorApi.shops()).shops ?? this.shops; // a reply that did not parse keeps the list
        this.shopsIn = true;
        this.buildShops();
        for (const s of this.shops) {
          const h = this.houses.get(`shop:${s.place}`);
          if (h) h.house.doorOpen = s.open;
        }
      } catch {
        /* the server has no shops yet: again at the next refresh */
      }
      this.info = await interiorApi.info();
      if (Number.isFinite(this.info.tipsy)) this.tipsyTarget = this.info.tipsy;
      if (!this.decorated) this.decorate();
      this.build();
      for (const t of this.info.taverns) {
        const h = this.houses.get(t.place);
        if (h) h.house.doorOpen = t.open;
      }
      const p = this.houses.get("poesje");
      if (p && this.info.poesje) p.house.doorOpen = this.info.poesje.open;
    } catch {
      /* the server is not up yet: try again at the next refresh */
    }
  }

  private refreshTipsy(): void {
    interiorApi
      .tipsy()
      .then((r) => {
        // (a refused or odd answer keeps the last: never NaN, which made the camera's height NaN: a blank screen, #18)
        if (Number.isFinite(r?.tipsy)) this.tipsyTarget = r.tipsy;
      })
      .catch(() => {});
  }

  // ------------------------------------------------------------------ the doors in the street

  /** Where a door's step is and the wall behind it (1.2 m in, the town's door step). */
  private doors(): Array<{ kind: "tavern" | "cellar" | "shop"; place: string; label: string; step: Pt; out: Pt; wall: Pt; open: boolean }> {
    const out: ReturnType<Interiors["doors"]> = [];
    // M7 shops: the shops whose room stands in the world (keyed "shop:<id>")
    for (const s of this.shops) if (this.houses.has(`shop:${s.place}`)) out.push({ kind: "shop", place: `shop:${s.place}`, label: s.label, step: s.door, out: s.out, wall: s.wall, open: s.open });
    for (const t of this.info?.taverns ?? []) out.push({ kind: "tavern", place: t.place, label: t.label, step: t.door, out: t.out, wall: [t.door[0] - t.out[0] * 1.2, t.door[1] - t.out[1] * 1.2], open: t.open });
    const p = this.info?.poesje;
    if (p) out.push({ kind: "cellar", place: "poesje", label: "the Poesje", step: p.door, out: p.out, wall: p.wall, open: p.open });
    return out;
  }

  /** A painted board over each door, and a lantern at the Poesje's that is lit in the evening. */
  private decorate(): void {
    this.decorated = true;
    for (const d of this.doors()) {
      if (d.kind === "shop") continue; // M7 shops: their boards and bracket signs are world/shopSigns.ts
      const text = d.kind === "cellar" ? "POESJE" : d.label.toUpperCase();
      if (d.kind === "tavern") {
        // a tavern hangs its name out on an iron bracket, across the pavement, read from either way
        // (east walkthrough 2026-09-25: two faces back to back, each read the right way round; one
        // double-sided face showed the name in mirror writing from one side of the street)
        const board = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.42), new THREE.MeshBasicMaterial({ map: signTexture(text), color: 0x9a8a70 }));
        board.position.set(d.wall[0] + d.out[0] * 1.05, 2.95, d.wall[1] + d.out[1] * 1.05);
        board.rotation.y = Math.atan2(d.out[0], d.out[1]) + Math.PI / 2;
        const back = new THREE.Mesh(board.geometry, board.material);
        back.rotation.y = Math.PI;
        board.add(back);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 1.9), new THREE.MeshBasicMaterial({ color: 0x1a1816 }));
        arm.position.set(d.wall[0] + d.out[0] * 0.95, 3.2, d.wall[1] + d.out[1] * 0.95);
        arm.rotation.y = Math.atan2(d.out[0], d.out[1]);
        board.userData.wallSign = { kind: "tavern sign", name: text, flat: false }; // dev/signcheck.ts
        this.worldScene.add(board, arm);
      } else {
        const board = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.34), new THREE.MeshBasicMaterial({ map: signTexture(text), color: 0x9a8a70 }));
        board.position.set(d.wall[0] + d.out[0] * 0.012, 3.83, d.wall[1] + d.out[1] * 0.012); // flat on the wall, over the doorway (dev/signcheck.ts)
        board.rotation.y = Math.atan2(d.out[0], d.out[1]);
        board.userData.wallSign = { kind: "door sign", name: text, flat: true }; // dev/signcheck.ts
        this.worldScene.add(board);
      }
      if (d.kind === "cellar") {
        const side: Pt = [-d.out[1], d.out[0]];
        const lx = d.wall[0] + d.out[0] * 0.25 + side[0] * 0.9;
        const lz = d.wall[1] + d.out[1] * 0.25 + side[1] * 0.9;
        const light = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, 0.16), new THREE.MeshBasicMaterial({ color: 0x3a3228 }));
        light.position.set(lx, 2.2, lz);
        // (its light on the street: world/spill.ts reads the lantern's colour)
        light.userData.spillGlow = true;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffb060, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
        sprite.scale.set(1.1, 1.1, 1);
        sprite.position.set(lx, 2.2, lz);
        this.worldScene.add(light, sprite);
        this.lampOut.push({ sprite, light });
      }
    }
  }

  /** M7 quest tests: the street step of this place's door (a treat's guest walks to it), or null. */
  doorStep(place: string): { x: number; z: number } | null {
    const d = this.doors().find((x) => x.place === place);
    return d ? { x: d.step[0], z: d.step[1] } : null;
  }

  /** For the path check: every door must be reachable on foot (the world's grid). */
  pathPoints(): Array<{ label: string; x: number; z: number; reach: number }> {
    return this.doors().map((d) => ({ label: `door of ${d.label}`, x: d.step[0], z: d.step[1], reach: 1.6 }));
  }

  /**
   * M7: inside, through each open door, by the house's own plan (a finer grid than the city's: a 1.2 m door
   * is too narrow for its 0.5 m cells): the counter, the fire and a table in each tavern, the benches and the
   * booth's front in the Poesje. What cannot be reached, by name.
   */
  insidePathProblems(): string[] {
    const bad: string[] = [];
    for (const [place, h] of this.houses) {
      if (!h.house.doorOpen) continue;
      const room = h.house.room;
      const label = this.doors().find((d) => d.place === place)?.label ?? place;
      const reach = HP.flood(h.house.plan, [0, -0.45], 0.15, 0.3, () => true);
      const L = h.kind === "cellar" ? 1 : 0;
      const pts: Array<[string, number, number, number]> = [];
      if (room.counter) pts.push(["the counter", room.counter.x, room.counter.z, 0.6]);
      // M7 shops: where a customer stands at the shelves, and a bench where there is one
      if (h.kind === "shop" && room.stands[3]) pts.push(["the shelves", room.stands[3].x, room.stands[3].z, 0.6]);
      if (room.fire) pts.push(["the fire", room.fire.x, room.fire.z, 0.8]);
      const seat = room.seats.find((q) => q.table === 0);
      if (seat) pts.push([h.kind === "cellar" ? "the back bench" : "a table", ...(seat.via[seat.via.length - 1] as [number, number]), 0.6]);
      const front = room.seats.reduce<Seat | null>((a, q) => (!a || q.z > a.z ? q : a), null);
      if (h.kind === "cellar" && front) pts.push(["the front bench", ...(front.via[front.via.length - 1] as [number, number]), 0.6]);
      for (const [what, x, z, r] of pts) if (!reach(x, z, L, r)) bad.push(`in ${label}: ${what}`);
    }
    return bad;
  }

  // ------------------------------------------------------------------ keys (Jobs.extraActions)

  keys(x: number, z: number): { only?: Action[]; options?: Array<[number, Action]> } {
    if (this.busy) return { only: [] };
    if (this.inside) return { only: this.dice.open ? [] : this.insideKeys() };
    if (this.player.riding || this.player.swimming || this.player.climbing || this.player.bikeRiding) return {};
    const options: Array<[number, Action]> = [];
    for (const d of this.doors()) {
      if (d.open) continue; // an open door: walk in
      const dist = Math.hypot(d.step[0] - x, d.step[1] - z);
      if (dist > REACH_DOOR) continue;
      // the door itself, at chest height: Jef must look at it (game/facing.ts)
      const at = { x: d.wall[0], y: this.player.y + 1.1, z: d.wall[1] };
      if (d.kind === "shop") {
        const s = this.shops.find((q) => `shop:${q.place}` === d.place);
        options.push([dist - 0.2, { key: "KeyE", text: `try the door of ${d.label}`, run: () => this.say(`The shutters are up at ${d.label}. ${s?.keeper ? `${s.keeper.first} opens again in the morning.` : "Nobody answers."}`), at }]);
      } else if (d.kind === "tavern") {
        const keeper = this.info?.taverns.find((t) => t.place === d.place)?.keeper;
        options.push([dist - 0.2, { key: "KeyE", text: `try the door of ${d.label}`, run: () => this.say(`The door of ${d.label} is barred. ${keeper ? `${keeper.first} opens again later.` : "Nobody answers."}`), at }]);
      } else {
        const p = this.info!.poesje!;
        options.push([dist - 0.2, { key: "KeyE", text: "read the board by the cellar door", run: () => this.say(`A painted board: "POESJE. Every evening from seven. ${p.price_c} centimes." The door is shut.`), at }]);
      }
    }
    return { options };
  }

  /** Where Jef stands in the room's frame (seated: the seat). */
  private jefAt(): { x: number; z: number } | null {
    const room = this.room;
    if (!room) return null;
    const w = this.player.rideWalk;
    if (this.player.riding && w) return { x: w.x, z: w.z };
    const [x, z] = room.toLocal!(this.player.x, this.player.z);
    return { x, z };
  }

  private insideKeys(): Action[] {
    const room = this.room!;
    const w = this.jefAt();
    if (!w) return [];
    if (this.jefSeat) {
      const out: Action[] = [{ key: "KeyE", text: "stand up", run: () => this.standUp(), self: true }];
      const mate = this.dicePartner();
      if (mate) out.push({ key: "KeyG", text: `play pitjesbak with ${mate.p.first}`, run: () => void this.openDice(mate), at: this.occAt(mate) });
      if (this.seatedKeys) out.push(...this.seatedKeys());
      return out;
    }
    const near = (s: Spot | undefined, r: number) => (s ? Math.hypot(s.x - w.x, s.z - w.z) < r : false);
    const opts: Array<[number, Action]> = [];
    const extra: Action[] = [];
    const keeper = [...this.occ.values()].find((o) => o.keeper && !o.gone);
    if (keeper && room.kind === "shop" && near(room.counter, 1.4)) {
      // M7 shops: E buys at the counter (the talk window's ware list, the keeper's own prices), F talks
      const at = this.occAt(keeper);
      const berg = this.here?.place === "shop:pawn_vis" && this.bergCounter;
      if (berg) opts.push([0.2, { key: "KeyE", text: "the Berg's counter: pawn or redeem", run: () => this.bergCounter?.(), at }]);
      else opts.push([0.2, { key: "KeyE", text: `buy from ${keeper.p.first}`, run: () => this.jobs.talk.open({ id: keeper.p.id, def: { name: keeper.p.name, title: this.here?.label } }, true), at }]);
      extra.push({ key: "KeyF", text: `talk to ${keeper.p.first}`, run: () => this.talkTo(keeper), at });
    } else if (keeper && near(room.counter, 1.2)) {
      const at = this.occAt(keeper);
      opts.push([0.2, { key: "KeyE", text: `talk to ${keeper.p.first}, the keeper`, run: () => this.talkTo(keeper), at }]);
      extra.push({ key: "KeyF", text: `buy at the counter`, run: () => this.jobs.talk.open({ id: keeper.p.id, def: { name: keeper.p.name, title: "the keeper" } }, true), at });
    }
    if (near(room.fire, 1.4)) opts.push([0.3, { key: "KeyE", text: "warm yourself at the fire", run: () => void this.warm(), at: this.roomPoint(room.fire!.x, room.fire!.z, 0.5) }]);
    for (const o of this.occ.values()) {
      if (o.gone || o.leaving || o.keeper) continue;
      const d = Math.hypot(o.x - w.x, o.z - w.z);
      if (d < 1.5) opts.push([d, { key: "KeyE", text: `talk to ${o.p.name}`, run: () => this.talkTo(o), at: this.occAt(o) }]);
    }
    if (room.kind === "home" && this.homeKeys) {
      const hk = this.homeKeys(w.x, w.z);
      opts.push(...hk.options);
      extra.push(...hk.extra);
    }
    if (room.kind === "tavern" && this.tavernKeys) {
      const tk = this.tavernKeys(w.x, w.z);
      opts.push(...tk.options);
      extra.push(...tk.extra);
    }
    // the free seat Jef looks at (game/facing.ts)
    const seat = pick(room.seats, (s) => {
      if (this.seatTaken.has(s)) return null;
      const d = Math.hypot(s.x - w.x, s.z - w.z);
      return d < 1.05 ? { d, at: this.roomPoint(s.x, s.z, 0.45) } : null;
    });
    if (seat) {
      const s = seat.it;
      opts.push([seat.d + 0.1, { key: "KeyE", text: room.kind === "cellar" || room.kind === "shop" ? "sit down on the bench" : s.table === 9 ? "sit at the counter" : "sit down at the table", run: () => this.sitDown(s), at: seat.at }]);
    }
    const top = best(opts);
    return [...(top ? [top] : []), ...extra];
  }

  private talkTo(o: Occ): void {
    this.jobs.talk.open({ id: o.p.id, def: { name: o.p.name, title: o.keeper ? (this.here?.kind === "shop" ? this.here.label : "the keeper") : undefined } });
    // they turn to Jef
    const w = this.jefAt();
    if (w && !o.seat) o.yaw = Math.atan2(w.x - o.x, w.z - o.z);
  }

  // ------------------------------------------------------------------ whose life runs, in and out

  /** The place of the room Jef is in ("tavern:ankere", "poesje", a home's id), or null. */
  get placeId(): string | null {
    return this.inside ? this.here!.place : null;
  }

  /** M7 homes: Jef is in his home (game/homes.ts): its life here (a visitor at the door); null: out again. */
  setHome(h: { place: string; label: string; room: Room; house: HouseInWorld | null } | null): void {
    if (h && this.home?.place === h.place) return;
    if (!h && !this.home) return;
    this.home = h ? { kind: "home", ...h } : null;
    if (h) this.switchTo(this.home, true);
    else if (this.here?.kind === "home") {
      this.crossed(false);
      this.switchTo(null, false);
    }
  }

  /** M6 homes: someone at the door of the room (the widow, a neighbour) says a line; null sends them off. */
  visit(p: Person | null, line?: string): void {
    if (!this.inside) return;
    this.syncPeople(p ? [p] : [], null, false);
    if (p && line) this.play([{ who: p.id, name: p.first, text: line }]);
  }

  private switchTo(h: Here | null, jefIn: boolean): void {
    if (this.here === h) return;
    if (this.jefIn && this.here) this.crossed(false);
    this.clearPeople();
    this.here = h;
    this.firstSync = true;
    this.syncT = 0;
    if (h?.kind === "cellar") this.show = { play: null, stage: "wait", t: 4, puppets: [], writing: false };
    if (jefIn && h) this.crossed(true);
  }

  private clearPeople(): void {
    this.dice.close();
    this.endScript();
    this.clearShow();
    for (const o of this.occ.values()) o.human?.dispose();
    this.occ.clear();
    this.seatTaken.clear();
    if (this.jefSeat) this.standUp();
  }

  /** Which building's life should run: Jef's home when he is in it, else the tavern or the Poesje nearest him. */
  private choose(): void {
    if (this.home) {
      if (this.here !== this.home) this.switchTo(this.home, true);
      return;
    }
    const px = this.player.x;
    const pz = this.player.z;
    let best: { place: string; d: number } | null = null;
    for (const [place, h] of this.houses) {
      const d = h.house.near(px, pz);
      if (d < LIFE_M && (!best || d < best.d)) best = { place, d };
    }
    const cur = this.here && this.here.kind !== "home" ? this.here.place : null;
    if (cur && best && cur !== best.place) {
      const dc = this.houses.get(cur)!.house.near(px, pz);
      // (inside it still: it stays; put somewhere else by a jump, the new one takes over)
      const stillIn = this.jefIn && this.houses.get(cur)!.house.insideness(px, pz) > 0.3;
      if (stillIn || (!this.jefIn && dc < best.d + 10)) best = { place: cur, d: dc };
    }
    if (!best) {
      if (this.here) this.switchTo(null, false);
      return;
    }
    if (best.place === cur) return;
    const h = this.houses.get(best.place)!;
    const label = this.doors().find((d) => d.place === best!.place)?.label ?? best.place;
    this.switchTo({ kind: h.kind, place: best.place, label, room: h.house.room, house: h.house }, false);
  }

  /** Jef crossed the threshold of the building whose life runs (in or out). */
  private crossed(inNow: boolean): void {
    const h = this.here;
    this.jefIn = inNow;
    if (!h) return;
    if (!inNow) {
      if (this.jefSeat) this.standUp();
      this.dice.close();
      this.caption.classList.remove("on");
      this.roomSound(null);
      return;
    }
    this.roomSound(h.room.sound ?? h.kind);
    if (h.kind === "home") return;
    if (this.jobs.goods.carried) return this.putOut("Not with that in your arms. Set it down first.");
    if (h.kind === "shop") {
      // M7 shops: the smell of the trade, and who is there
      const s = this.shops.find((q) => `shop:${q.place}` === h.place);
      const k = [...this.occ.values()].find((o) => o.keeper && !o.gone);
      const n = [...this.occ.values()].filter((o) => !o.keeper && !o.gone && !o.leaving && !this.helperIds.has(o.p.id)).length;
      const smell = s?.trade ? SHOP_LOOK[s.trade].smell : "";
      this.say(`${h.label[0].toUpperCase()}${h.label.slice(1)}. ${smell}${k ? ` ${k.p.first} looks up from the counter.` : ""}${n ? ` ${n === 1 ? "One customer waits" : `${n} customers wait`}.` : ""}`);
      return;
    }
    if (h.kind === "tavern") {
      const n = [...this.occ.values()].filter((o) => !o.keeper && !o.gone && !o.leaving).length;
      // words for the hour (QA 2026-09-24: "Quiet tonight" at one in the afternoon)
      const hr = this.jobs.day.hourF;
      const quiet = hr >= 18 || hr < 4 ? "Quiet tonight." : hr < 12 ? "Quiet this morning." : "Quiet this afternoon.";
      // (the great storm, world/tempest.ts: the street came in out of it, dripping)
      if (tempest.phase) this.say(`${h.label}. Packed to the door with people come in out of the storm, steaming and dripping; the shutters rattle.`);
      else this.say(`${h.label}. Smoke, beer and wet wool. ${n ? `${n} at the tables.` : quiet}`);
      this.chatT = 6 + Math.random() * 6;
      return;
    }
    void this.payAtCellar();
  }

  /** Down the Poesje's steps: the woman at the door takes the money (once an evening), or turns Jef back. */
  private async payAtCellar(): Promise<void> {
    const p = this.info?.poesje;
    if (!p || this.busy) return;
    const day = this.jobs.day.dayNum;
    this.busy = true;
    try {
      const info = await interiorApi.poesje();
      const paid = await interiorApi.enter();
      this.jobs.refresh(paid);
      this.paidAt = day;
      if (this.here?.kind === "cellar") {
        this.syncPeople(info.audience, null, this.firstSync);
        this.firstSync = false;
        if (this.show && !this.show.play && info.play.state === "ready") this.show.play = info.play;
        if (this.show && !this.show.play) void this.fetchPlay();
      }
      this.say(paid.line);
    } catch (e) {
      const m = String((e as Error).message ?? e);
      this.putOut(/money/.test(m) ? `The woman at the door holds out her hand: ${p.price_c} centimes. You have not got it.` : /shut/.test(m) ? "The cellar door is shut. The Poesje plays from seven in the evening." : m);
    } finally {
      this.busy = false;
    }
  }

  /** Out onto the step before the door, facing the street, with a line. */
  private putOut(text: string): void {
    const h = this.here;
    if (text) this.say(text);
    if (this.jefSeat) this.standUp();
    this.dice.close();
    if (h?.house) {
      const [x, z] = h.house.world(0, -1.2);
      const [ox, oz] = h.house.world(0, -2.2);
      this.player.place(x, z, Math.atan2(-(ox - x), -(oz - z)), 0);
    }
    if (this.jefIn) this.crossed(false);
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

  /** Dev and the landmarks' old way out: put Jef out on the step of the building he is in. */
  leave(quiet = false, by?: { step: Pt; out: Pt }): void {
    if (!this.inside) return;
    if (by) {
      this.player.place(by.step[0] + by.out[0] * 0.3, by.step[1] + by.out[1] * 0.3, Math.atan2(-by.out[0], -by.out[1]), 0);
      this.crossed(false);
      return;
    }
    this.putOut(quiet ? "" : "");
  }

  // ------------------------------------------------------------------ people in the room

  private syncPeople(list: Person[], keeperId: string | null, first: boolean): void {
    const room = this.here?.room;
    if (!room) return;
    const want = new Set(list.map((p) => p.id));
    for (const o of this.occ.values()) {
      if (!want.has(o.p.id) && !o.leaving && !o.gone) {
        o.leaving = true;
        const via = o.seat ? [...o.seat.via].reverse() : [];
        this.free(o);
        o.path = [...via, [room.entry.x, room.entry.z], [room.exit.x, room.exit.z]];
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
      } else if (spot) o.path = [[room.entry.x, room.entry.z], ...(o.seat?.via ?? []), [spot.x, spot.z]];
      this.occ.set(p.id, o);
      this.dress(o);
    }
  }

  /** A seat for those who can sit (by id, so the same man takes the same place), else a place to stand. */
  private place(o: Occ): void {
    const room = this.here!.room;
    // M7 shops: the keeper's wife or helper behind the counter's front end; customers stand (or wait on a bench)
    if (room.kind === "shop") {
      if (this.helperIds.has(o.p.id) && room.serve?.length) {
        const used = new Set([...this.occ.values()].map((q) => q.stand));
        o.stand = room.serve.find((sp) => !used.has(sp)) ?? room.serve[0];
        return;
      }
      const free = room.seats.filter((q) => !this.seatTaken.has(q));
      if (free.length && !STANDERS.has(o.kind) && hash(o.p.id) % 3 !== 0) {
        const s = free[hash(o.p.id) % free.length];
        this.seatTaken.set(s, o.p.id);
        o.seat = s;
        return;
      }
      this.standFor(o);
      return;
    }
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
    const room = this.here!.room;
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
    const room = this.here?.room;
    if (o.human || !room) return;
    const h = makeHuman(o.kind);
    if (!h) return;
    o.human = h;
    room.group.add(h.root);
    // M7 shops: the keeper holds his trade's thing (game/shopProps.ts), on his hand's bone
    if (room.kind === "shop" && o.keeper) {
      const trade = this.shops.find((q) => `shop:${q.place}` === this.here?.place)?.trade;
      const prop = trade ? shopProp(trade) : null;
      if (prop) holdProp(h.root, prop);
    }
    // a seat of a kind that cannot sit after all (the model says): stand beside it instead
    if (o.seat && !h.canSit) {
      const was = o.seat;
      this.seatTaken.delete(was);
      o.seat = null;
      this.standFor(o);
      const spot = o.stand!;
      if (!o.path.length || o.path[o.path.length - 1][0] === was.x) {
        if (o.path.length) o.path = [[room.entry.x, room.entry.z], [spot.x, spot.z]];
        else [o.x, o.z, o.yaw] = [spot.x, spot.z, spot.yaw];
      }
    }
  }

  private updatePeople(dt: number): void {
    const room = this.here?.room;
    if (!room) return;
    const talkingTo = this.jobs.talk.isOpen;
    const speaking = this.script?.lines[this.script.i]?.who;
    // drawn only when the room is seen (M7: through its door or windows, or from inside)
    const seen = this.jefIn || !this.here?.house || this.here.house.drawn();
    for (const [id, o] of this.occ) {
      if (!o.human && seen) this.dress(o);
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
      h.root.visible = seen;
      if (!seen) continue;
      const walking = o.path.length > 0;
      const sitting = !walking && !!o.seat;
      if (walking) {
        h.play("walk");
        h.setPace(WALK_IN);
      } else if (sitting) h.play("sit");
      else h.play(speaking === id || (talkingTo && o.keeper) ? "talk" : o.keeper ? "idle" : "fold");
      const fy = room.floor?.(o.x, o.z) ?? 0;
      h.root.position.set(o.x, fy + (sitting ? h.sitDrop(o.seat!.h) : 0) + h.bob(), o.z);
      h.root.rotation.y = o.yaw;
      // M6 treat: a guest merry on Jef's rounds sways a little in the seat
      h.root.rotation.z = o.p.role === "guest_tipsy" ? Math.sin(this.t * 1.3 + (hash(id) % 7)) * 0.06 : 0;
      h.update(dt);
    }
  }

  // ------------------------------------------------------------------ Jef sits

  /** Carried in the house's frame on a seat (the player's carriage mode, standing still). */
  private sitDown(s: Seat): void {
    const room = this.room;
    const house = this.here?.house;
    if (!room || !house || this.seatTaken.has(s)) return;
    this.seatTaken.set(s, "jef");
    this.jefSeat = s;
    const plan = house.plan;
    const anchor: RideAnchor = { x: plan.origin.x, y: plan.floorY, z: plan.origin.z, yaw: plan.yaw, speed: 0 };
    const y = room.floor?.(s.x, s.z) ?? 0;
    const walk: RideWalk = { x: s.x, z: s.z, walk: (fx, fz) => [fx, fz], floor: () => y, surface: "wood" };
    this.player.rideStart(() => anchor, undefined, walk);
    this.player.rideSeat = { x: s.x, y, z: s.z, eye: s.h + 0.72 };
    // face the table (or the stage): the seat's own facing, turned into the player's yaw
    const f = room.toWorld(s.x + Math.sin(s.yaw), s.z + Math.cos(s.yaw));
    const p = room.toWorld(s.x, s.z);
    this.player.yaw = Math.atan2(-(f.x - p.x), -(f.z - p.z));
    this.player.pitch = room.kind === "cellar" ? 0.02 : -0.12;
    if (room.kind === "tavern" && s.table !== 9) void this.overhear();
  }

  private standUp(): void {
    const s = this.jefSeat;
    this.jefSeat = null;
    if (!s) return;
    this.seatTaken.delete(s);
    this.dice.close();
    const room = this.here?.room;
    const house = this.here?.house;
    if (!this.player.riding) return;
    const yaw = this.player.yaw;
    // step back from the table into the room: behind the seat, else beside it
    let at = room ? room.toWorld(s.x, s.z) : new THREE.Vector3(this.player.x, 0, this.player.z);
    if (room && house) {
      const fy = room.floor?.(s.x, s.z) ?? 0;
      for (const [f, side] of [[-0.55, 0], [0, 0.6], [0, -0.6], [-0.7, 0.5], [-0.7, -0.5], [0.6, 0]]) {
        const cx = s.x + Math.sin(s.yaw) * f + Math.cos(s.yaw) * side;
        const cz = s.z + Math.cos(s.yaw) * f - Math.sin(s.yaw) * side;
        const w = room.toWorld(cx, cz);
        if (house.free(w.x, w.z, house.plan.floorY + fy, 0.3)) {
          at = w;
          break;
        }
      }
    }
    this.player.rideEnd(at.x, at.z);
    this.player.yaw = yaw;
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
    const place = this.placeId;
    if (!place) return;
    try {
      const r = await interiorApi.sit(place, o.p.id);
      this.dice.show(place, o.p, r.line, r.stakes, r.left, this.jobs.talk.money);
    } catch (e) {
      this.say(String((e as Error).message ?? e));
    }
  }

  private async warm(): Promise<void> {
    const place = this.placeId;
    if (!place) return;
    try {
      const r = await interiorApi.fire(place);
      this.jobs.refresh(r);
      this.say(r.text);
    } catch (e) {
      this.say(String((e as Error).message ?? e));
    }
  }

  /** Jef sits near two drinkers: he overhears them (the server picks the facts; once a game hour). */
  private async overhear(): Promise<void> {
    const pair = this.pairNear();
    const place = this.placeId;
    if (!pair || !place || this.script) return;
    try {
      const g = await interiorApi.gossip(place, pair[0].p.id, pair[1].p.id);
      if (this.placeId === place) this.play(g.lines);
    } catch {
      // nothing new to say this hour: they only chat
      this.chatT = Math.min(this.chatT, 2);
    }
  }

  /** The two drinkers nearest Jef (at his table first). */
  private pairNear(): [Occ, Occ] | null {
    const w = this.jefAt();
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
    const place = this.placeId;
    if (!place || this.script || this.room?.kind !== "tavern") return;
    const seated = [...this.occ.values()].filter((o) => !o.keeper && !o.leaving && !o.path.length);
    const byTable = new Map<number, Occ[]>();
    for (const o of seated) if (o.seat) byTable.set(o.seat.table, [...(byTable.get(o.seat.table) ?? []), o]);
    const tables = [...byTable.values()].filter((l) => l.length >= 2);
    const pair = tables.length ? tables[Math.floor(Math.random() * tables.length)].slice(0, 2) : seated.length >= 2 ? seated.slice(0, 2) : null;
    if (!pair) return;
    try {
      const r: TalkLines = await interiorApi.chat(place, pair[0].p.id, pair[1].p.id);
      if (this.placeId === place && !this.script) this.play(r.lines);
    } catch {
      /* they drink in silence */
    }
  }

  /** A conversation the server pushed (M4): shown here if both are in this room and Jef with them. */
  convo(c: { lines: Line[]; a: string; b: string }): void {
    if (this.inside && this.occ.has(c.a) && this.occ.has(c.b) && !this.script) this.play(c.lines);
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
    if (!this.inside || !this.occ.has(who) || this.script) return false;
    this.play(lines, onLine, onEnd);
    this.script!.sung = true;
    return true;
  }

  /** M6 ballads: is someone singing or talking in the room now? */
  get scriptBusy(): boolean {
    return this.script !== null;
  }

  /** M6 ballads: where someone in the room stands (world metres) and their voice; null if not here. */
  personAt(who: string): { x: number; z: number; voice: { sex: "m" | "f"; age: number }; dist: number; at: Target } | null {
    const o = this.occ.get(who);
    const room = this.room;
    if (!o || !room || o.gone || o.leaving) return null;
    const at = room.toWorld(o.x, o.z);
    const w = this.jefAt();
    return { x: at.x, z: at.z, voice: { sex: o.p.sex, age: o.p.age }, dist: w ? Math.hypot(o.x - w.x, o.z - w.z) : 99, at: this.occAt(o) };
  }

  /** A point in the room (room frame, y over its floor) in the world, for looking at it (game/facing.ts). */
  roomPoint(x: number, z: number, y: number): Target {
    const room = this.room ?? this.here?.room;
    if (!room) return { x, z };
    const p = room.toWorld(x, z, (room.floor?.(x, z) ?? 0) + y);
    return { x: p.x, y: p.y, z: p.z };
  }

  /** Someone in the room: their chest, lower when they sit. */
  private occAt(o: Occ): Target {
    return this.roomPoint(o.x, o.z, o.seat ? 1.0 : 1.3);
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
    const fy = this.here?.room.floor?.(o.x, o.z) ?? 0;
    return { local: new THREE.Vector3(o.x, fy + (sitting ? HEAD_SIT : o.p.age < 13 ? 1.3 : HEAD_STAND), o.z), voice: { sex: o.p.sex, age: o.p.age } };
  }

  private updateScript(dt: number): void {
    const s = this.script;
    const room = this.here?.room;
    if (!s || !room) return;
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
        const at = room.toWorld(h.local.x, h.local.z);
        this.speak({ x: at.x, z: at.z }, h.voice, Math.min(s.t - 0.4, 4));
      }
    }
    if (s.tag && s.i >= 0) {
      const h = this.headOf(s.lines[s.i].who);
      const cam = this.player.camera;
      cam.updateMatrixWorld();
      const v = h && this.jefIn ? room.toWorld(h.local.x, h.local.z, h.local.y + 0.15).project(cam) : null;
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
    const room = this.here?.room;
    if (!sh || !room?.stage) return;
    for (const p of sh.puppets) p.update(dt);
    // the show plays while Jef is down in the cellar
    if (!this.jefIn) return;
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
    const room = this.here?.room;
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
      if (this.tipsyTarget > 0 || this.inside) this.refreshTipsy();
    }
    this.tipsyNow += (this.tipsyTarget - this.tipsyNow) * Math.min(1, dt * 0.25);
    if (!Number.isFinite(this.tipsyNow)) this.tipsyNow = Number.isFinite(this.tipsyTarget) ? this.tipsyTarget : 0;
    // the Poesje's lantern is lit from half past six
    const h = this.jobs.day.hourF;
    const lit = h >= 18.5 && h < 22.5 ? 1 : 0;
    for (const l of this.lampOut) {
      l.sprite.material.opacity = 0.8 * lit * (0.92 + Math.sin(this.t * 6) * 0.05);
      (l.light.material as THREE.MeshBasicMaterial).color.setHex(lit ? 0xffc070 : 0x3a3228);
    }
    // the houses: their leaves; the rooms' fires and lamps run while they are seen; warm transoms at night when open
    const day = this.daylight();
    for (const [, hw] of this.houses) {
      hw.house.glow = hw.house.doorOpen ? 1 : 0;
      // a tavern shut for the night: its lamps out, the fire down to embers (the Poesje's candles only in the evening)
      hw.house.room.setLamps?.(hw.house.doorOpen ? 1 : 0);
      hw.house.update(this.t, dt, day);
      // empty fronts: a shut shop's shutters are up (not in the midday break), once its door has swung to
      this.shutters.get(hw.house.id)?.set(shutUp(hw.house.doorOpen || hw.house.leaf > 0.05, h));
      if (hw.house.drawn() || this.here?.house === hw.house) hw.house.room.update(this.t, dt);
    }
    updateStandIns(h);
    // whose life runs, and Jef in or out (a little either way so it never flickers at the threshold)
    this.choose();
    const here = this.here;
    if (!here) return;
    if (here.house && here.kind !== "home") {
      const k = here.house.insideness(this.player.x, this.player.z);
      const inNow = this.jefIn ? k > 0.35 : k > 0.55;
      if (inNow !== this.jefIn) this.crossed(inNow);
    }
    if (here.kind === "home") here.room.update(this.t, dt);
    here.room.setDaylight(Math.max(0, Math.min(1, h < 12 ? (h - 6.5) / 3 : (18.5 - h) / 3)));
    this.updatePeople(dt);
    this.updateScript(dt);
    this.updateShow(dt);
    this.dice.update(dt);
    // who is here changes with the clock: ask the server every few seconds
    this.syncT -= dt;
    if (this.syncT <= 0 && !this.syncing) {
      this.syncT = here.kind === "tavern" || here.kind === "shop" ? 4 : 10;
      void this.sync(here);
    }
    if (here.kind === "tavern" && this.jefIn) {
      this.chatT -= dt;
      if (this.chatT <= 0) {
        this.chatT = 28 + Math.random() * 22;
        if (!this.dice.open && !this.jobs.talk.isOpen) void this.chat();
      }
    }
  }

  private async sync(here: Here): Promise<void> {
    if (here.kind === "home") return;
    this.syncing = true;
    try {
      if (here.kind === "shop") {
        // M7 shops: the keeper and his wife while the shop is open, the customers the engine's roll sent in
        const place = here.place.slice(5);
        const st = await interiorApi.shop(place);
        if (this.here !== here) return;
        const hw = this.houses.get(here.place);
        if (hw) hw.house.doorOpen = st.open;
        const info = this.shops.find((q) => q.place === place);
        if (info) info.open = st.open;
        if (!st.open) {
          if (this.jefIn) this.putOut(`${st.keeper?.first ?? "The shopkeeper"} is putting up the shutters. "We are closed. Come back in the morning."`);
          this.syncPeople([], null, false);
          return;
        }
        this.helperIds = new Set(st.helpers.map((q) => q.id));
        this.syncPeople([...(st.keeper ? [st.keeper] : []), ...st.helpers, ...st.customers], st.keeper?.id ?? null, this.firstSync);
        this.firstSync = false;
        return;
      }
      if (here.kind === "tavern") {
        const st = await interiorApi.tavern(here.place);
        if (this.here !== here) return;
        if (Number.isFinite(st.tipsy)) this.tipsyTarget = st.tipsy;
        const hw = this.houses.get(here.place);
        if (hw) hw.house.doorOpen = st.open;
        if (!st.open) {
          if (this.jefIn) this.putOut(`${st.keeper?.first ?? "The keeper"} puts the chairs on the tables. "Closing time. Out you go."`);
          this.syncPeople([], null, false);
          return;
        }
        this.syncPeople([...(st.keeper ? [{ ...st.keeper, sex: "m" as const, age: 45 }] : []), ...st.patrons], st.keeper?.id ?? null, this.firstSync);
        this.firstSync = false;
      } else {
        const p = this.info?.poesje;
        if (!p?.open && !this.jefIn) {
          this.syncPeople([], null, false);
          return;
        }
        const info = await interiorApi.poesje();
        if (this.here !== here) return;
        this.syncPeople(info.audience, null, this.firstSync);
        this.firstSync = false;
        if (this.show && !this.show.play && info.play.state === "ready") this.show.play = info.play;
      }
    } catch {
      /* the server is busy: again at the next sync */
    } finally {
      this.syncing = false;
    }
  }

  /** After the player's own camera work: a tipsy man's view sways, gently. */
  sway(dt: number): void {
    const k = Math.min(1, this.tipsyNow / 4);
    if (!(k >= 0.02)) return;
    this.swayT += dt;
    const t = this.swayT;
    const cam = this.player.camera;
    cam.rotation.z += (Math.sin(t * 0.83) * 0.03 + Math.sin(t * 1.9) * 0.006) * k;
    cam.rotation.x += Math.sin(t * 0.61 + 1.3) * 0.012 * k;
    cam.rotation.y += Math.sin(t * 0.47 + 0.4) * 0.018 * k;
    cam.position.y += Math.sin(t * 0.9) * 0.02 * k;
  }

  /** Dev: go straight in (a tavern id, or "poesje"): Jef just inside the door. */
  async devEnter(place: string): Promise<string> {
    await this.load();
    const key = this.houses.has(place) ? place : this.houses.has(`shop:${place}`) ? `shop:${place}` : `tavern:${place}`;
    const h = this.houses.get(key);
    if (!h) return `no such door: ${place}`;
    if (this.player.riding) this.player.rideEnd(this.player.x, this.player.z);
    const p = h.house.plan;
    const [x, z] = h.house.world(0, p.kind === "cellar" ? 0.7 : 1.4);
    const [fx, fz] = h.house.world(0, 3);
    this.player.place(x, z, Math.atan2(-(fx - x), -(fz - z)), 0);
    this.player.y = h.house.floor(x, z, 0.2);
    return h.house.doorOpen ? `inside ${this.doors().find((d) => d.place === key)?.label ?? key}` : "the door is shut";
  }

  /** Dev: walk Jef to a point of the room's frame (and stand up first). */
  devGo(x: number, z: number): void {
    const room = this.here?.room;
    if (!room) return;
    if (this.jefSeat) this.standUp();
    const w = room.toWorld(x, z);
    this.player.place(w.x, w.z, this.player.yaw, this.player.pitch);
    this.player.y = (this.here?.house?.plan.floorY ?? 0) + (room.floor?.(x, z) ?? 0);
  }

  /** Dev: the state for scripted checks. */
  debug() {
    const w = this.jefAt();
    return {
      here: this.here ? { kind: this.here.kind, place: this.here.place, drawn: this.here.house?.drawn() ?? null, leaf: this.here.house?.leaf ?? null } : null,
      inside: this.inside ? this.here!.label : null,
      kind: this.room?.kind ?? null,
      jef: w ? [+w.x.toFixed(2), +w.z.toFixed(2)] : null,
      seated: !!this.jefSeat,
      people: [...this.occ.values()].map((o) => ({ id: o.p.id, name: o.p.name, kind: o.kind, keeper: o.keeper, seat: o.seat ? o.seat.table : null, walking: o.path.length > 0, model: !!o.human })),
      keys: this.inside ? this.insideKeys().map((a) => `${a.key.slice(3)}: ${a.text}`) : [],
      script: this.script ? { at: this.script.i, of: this.script.lines.length, line: this.script.lines[this.script.i]?.text ?? null } : null,
      show: this.show ? { stage: this.show.stage, title: this.show.play?.title ?? null, third: this.show.play?.third ?? null, lines: this.show.play?.lines?.length ?? 0, puppets: this.show.puppets.length } : null,
      dice: this.dice.open,
      tipsy: +this.tipsyNow.toFixed(2),
      tipsyTarget: this.tipsyTarget,
      paidTonight: this.paidAt,
      doors: this.doors().map((d) => ({ label: d.label, open: d.open, step: d.step, leaf: this.houses.get(d.place)?.house.leaf ?? null })),
    };
  }

  /** M7: the in-world houses of the taverns and the Poesje (dev checks). */
  get inWorldHouses(): HouseInWorld[] {
    return [...this.houses.values()].map((h) => h.house);
  }

  /** Dev: a camera in the room's frame looking at a point of it (for pictures). */
  devCamera(cam: THREE.PerspectiveCamera, from: [number, number, number], to: [number, number, number]): boolean {
    const room = this.here?.room;
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
    dialogs.register("tavern dice", () => this.open); // focus fix: the pause knows it is up (game/dialogs.ts)
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
