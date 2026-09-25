import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { FirstPerson } from "../player/firstPerson";
import type { World } from "../world/rijnkaai";
import type { InWorld } from "../world/inworld";
import type { JobsPayload } from "../net/api";
import { homesApi, type HomeItem, type HomesInfo } from "../net/homesApi";
import { buildHome } from "../world/homeRooms";
import { makePiece } from "../world/furniture";
import type { Room } from "../world/rooms";
import { createHouseInWorld, type HouseInWorld } from "../world/houseInWorld";
import type { HousePlan } from "../../../shared/housePlan";
import * as HP from "../../../shared/hallPlan";
import { canPlace, CELL, CLASSES, FURNITURE, footprint, grid, type HomeClass, type Placed } from "../../../shared/homes";
import type { Interiors } from "./interiors";
import type { Jobs } from "./jobs";
import type { Action } from "./runs";
import { best } from "./facing";

// Homes to rent (M6 homes). Five doors in the town that nobody lives behind (and the widow's
// own door) carry a notice: read it, take the key for a night or to Sunday, pay the rent.
// M7: each home stands inside its own house in the world (shared/housePlan.ts, world/homeRooms.ts,
// world/houseInWorld.ts): your door opens as you come to it with the key, and you walk in (up the
// stair to the garret or the merchant's floor, down to the cellar). Inside, the room of its class
// and the pieces Jef bought at the second-hand dealer's: a small piece comes out of a pocket, a big
// one is carried in in both arms. Pick a piece up, move it over the grid, R turns it, E sets it
// down: the server checks the place and keeps the layout. Bed, stove and hearth by the server's
// numbers. Now and then the landlady or a neighbour looks in and says a line. At night the windows
// of a home glow where someone is home.

const REACH_DOOR = 1.8;
const AHEAD = 1.1;
const HOLD: [number, number, number] = [0.05, -0.62, -1.05];
/** Your door opens as you come this near with the key (m from its step). */
const OPEN_M = 4.5;

export class Homes {
  info: HomesInfo | null = null;
  /** The five homes in their houses, by home id (world/houseInWorld.ts). */
  private houses = new Map<string, HouseInWorld>();
  private world: { inWorld: InWorld; plans: Map<string, HousePlan> } | null = null;
  private infoT = 0;
  private busy = false;
  /** The piece in both arms (shown before the camera), if any. */
  private carried: { id: number; obj: THREE.Object3D } | null = null;
  /** Moving a piece inside: which, from where, and the ghost's place. */
  private moving: { item: HomeItem; rot: number; gx: number; gz: number; ok: boolean; why: string | null } | null = null;
  private dealerShow: THREE.Group | null = null;
  private remarkAsked = "";
  private visitT = 0;
  private t = 0;
  /** Jef is in his room now (by the threshold of its house and the room's own walls). */
  private inRoom = false;
  say: (t: string) => void = () => {};
  /** The day's light (0 night .. 1 noon), set by main. */
  daylight: () => number = () => 1;

  constructor(
    private readonly worldRef: World,
    private readonly player: FirstPerson,
    private readonly jobs: Jobs,
    private readonly interiors: Interiors,
  ) {
    interiors.homeKeys = (x, z) => this.insideKeys(x, z);
    const bought = jobs.talk.onBought;
    jobs.talk.onBought = (p, line) => {
      bought(p, line);
      void this.load();
    };
    jobs.day.onWakeHome = (home) => void this.enter(home, true);
    window.addEventListener("keydown", (e) => this.onKey(e), true);
    void this.load();
  }

  private get lease() {
    return this.info?.lease ?? null;
  }

  /** M7: stand the homes in their houses (main, once, after the world is built). */
  attachWorld(inWorld: InWorld, plans: Map<string, HousePlan>): void {
    this.world = { inWorld, plans };
    this.build();
  }

  private build(): void {
    const w = this.world;
    if (!w || !this.info || this.houses.size) return;
    for (const h of this.info.homes) {
      const plan = w.plans.get(`home:${h.id}`);
      if (!plan) continue;
      const room = buildHome({ plan, cls: h.cls, seed: h.step[0] * 7 + h.step[1] * 13 });
      const house = createHouseInWorld(this.worldRef, w.inWorld, plan, room, { color: 0x16120e, near: 6, far: 24 }, 0.35);
      this.houses.set(h.id, house);
    }
    const room = this.room();
    if (room && !this.moving) room.home!.setPlaced(this.placed());
    for (const [id, house] of this.houses) if (id === this.lease?.home) house.room.home!.setPlaced(this.placed());
  }

  async load(): Promise<void> {
    try {
      this.apply(await homesApi.info());
    } catch {
      /* the server is not up yet: again at the next refresh */
    }
  }

  private apply(info: HomesInfo): void {
    // a half answer (no items) must never throw in the frame loop (QA: the game froze for good)
    this.info = { ...info, homes: info.homes ?? [], items: info.items ?? [], dealer: info.dealer ?? null, lease: info.lease ?? null, widow: info.widow ?? null };
    this.showCarried();
    if (!this.dealerShow && info.dealer) this.buildDealerShow();
    this.build();
    // the pieces stand in Jef's home whether he is in it or not (seen through its door and windows)
    const mine = this.lease ? this.houses.get(this.lease.home) : null;
    if (mine && !this.moving) mine.room.home!.setPlaced(this.placed());
  }

  private refresh(r: JobsPayload & { homes: HomesInfo }): void {
    this.jobs.refresh(r);
    this.apply(r.homes);
  }

  private placed(except = -1): Placed[] {
    const home = this.lease?.home;
    return (this.info?.items ?? []).filter((i) => i.state === "placed" && i.home === home && i.id !== except).map((i) => ({ id: i.id, kind: i.kind, gx: i.gx!, gz: i.gz!, rot: i.rot }));
  }

  /** The room Jef is in, if it is his home. */
  private room(): Room | null {
    const r = this.interiors.room;
    return r?.kind === "home" && r.home && this.interiors.placeId === this.lease?.home ? r : null;
  }

  // ------------------------------------------------------------------ carrying

  private showCarried(): void {
    const it = this.info?.items.find((i) => i.state === "arms");
    if (this.carried && this.carried.id !== it?.id) {
      this.player.camera.remove(this.carried.obj);
      this.carried = null;
      this.player.laden = false;
      this.player.speedFactor = 1;
    }
    if (it && !this.carried) {
      const obj = it.kind === "rug" ? rolledRug() : makePiece(it.kind, 2.6).group;
      obj.scale.setScalar(it.kind === "stove" || it.kind === "table" ? 0.62 : 0.8);
      obj.position.set(...HOLD);
      obj.rotation.set(0.05, 0.3, 0);
      this.player.camera.add(obj);
      this.carried = { id: it.id, obj };
      this.player.laden = true;
      this.player.speedFactor = it.kind === "stove" ? 0.6 : 0.8;
    }
  }

  get carrying(): HomeItem | null {
    return this.info?.items.find((i) => i.state === "arms") ?? null;
  }

  // ------------------------------------------------------------------ in the street

  /** Keys at the doors in the street (Jobs.extraActions). Carrying a piece, only its keys. */
  keys(x: number, z: number): { only?: Action[]; options?: Array<[number, Action]>; extra?: Action[] } {
    if (this.interiors.inside || !this.info) return {};
    if (this.player.riding || this.player.swimming || this.player.climbing || this.player.bikeRiding) return {};
    const arms = this.carrying;
    const options: Array<[number, Action]> = [];
    const extra: Action[] = [];
    for (const h of this.info.homes) {
      const d = Math.hypot(h.step[0] - x, h.step[1] - z);
      if (d > REACH_DOOR) continue;
      const mine = this.lease?.home === h.id;
      // the door itself (its notice), at chest height: Jef must look at it (game/facing.ts)
      const at = { x: h.wall[0], y: this.player.y + 1.2, z: h.wall[1] };
      if (mine) {
        // M7: your door opens as you come; you walk in (with a piece in your arms too)
        const l = this.lease!;
        if (!arms && l.owed_c > 0) extra.push({ key: "KeyF", text: `pay the rent you owe (${l.owed_c} c)`, run: () => void this.pay("day"), at });
        else if (!arms && l.to_sunday_c > 0) extra.push({ key: "KeyF", text: `pay the rent to Sunday (${l.to_sunday_c} c)`, run: () => void this.pay("week"), at });
      } else if (!arms) {
        const lord = h.landlord ? `, ${h.cls === "widow" ? "the widow" : "landlord"} ${h.landlord.name}` : "";
        options.push([d, { key: "KeyE", text: `read the notice: ${CLASSES[h.cls].label} to let`, run: () => this.say(`"${h.notice}" ${h.week_c} c a week, ${h.day_c} c a night${lord}.`), at }]);
        const moving = this.lease ? " (and give up your room)" : "";
        extra.push({ key: "KeyF", text: `take the key to Sunday (${h.to_sunday_c} c)${moving}`, run: () => void this.take(h.id, "week"), at });
        extra.push({ key: "KeyG", text: `take it for tonight (${h.day_c} c)`, run: () => void this.take(h.id, "day"), at });
      }
    }
    if (arms) {
      const door = best(options);
      const only: Action[] = door ? [door] : [];
      only.push({ key: "KeyG", text: `leave ${FURNITURE[arms.kind].name} here`, run: () => void this.abandon(), self: true });
      return { only };
    }
    return { options, extra };
  }

  pathPoints(): Array<{ label: string; x: number; z: number; reach: number }> {
    const out = (this.info?.homes ?? []).map((h) => ({ label: `door of ${h.label}`, x: h.step[0], z: h.step[1], reach: 1.6 }));
    const d = this.info?.dealer;
    if (d) out.push({ label: d.label, x: d.at[0], z: d.at[1], reach: 2.0 });
    return out;
  }

  /**
   * M7: into Jef's own room (up or down its stair too), by the house's own plan with its furniture and his pieces
   * (a finer grid than the city's). What cannot be reached, by name.
   */
  insidePathProblems(): string[] {
    const mine = this.lease ? this.houses.get(this.lease.home) : null;
    if (!mine || !mine.doorOpen) return [];
    const plan = mine.plan;
    const reach = HP.flood(plan, [0, -0.45], 0.15, 0.3, () => true);
    const bed = mine.room.home!.bed;
    const c = CLASSES[plan.entry.cls as HomeClass];
    const inDoor = (c.doorWall ?? 2) === 0 ? c.D - 0.5 : 0.5;
    const out: string[] = [];
    // a point of the room's frame in the house's
    const at = (x: number, z: number): [number, number] => {
      const p = mine.room.toWorld(x, z);
      return HP.toLocal(plan, p.x, p.z);
    };
    const level = plan.levels.length - 1;
    if (!reach(...at(0, inDoor), level, 0.6)) out.push(`in your room: inside its door`);
    if (!reach(...at(bed.x, bed.z), level, bed.r + 0.2)) out.push(`in your room: by the bed`);
    return out;
  }

  private async take(home: string, plan: "day" | "week"): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const r = await homesApi.take(home, plan);
      this.refresh(r);
      this.say(r.text);
    } catch (e) {
      this.say(String((e as Error).message ?? e));
    } finally {
      this.busy = false;
    }
  }

  private async pay(plan: "day" | "week"): Promise<void> {
    try {
      const r = await homesApi.rent(plan);
      this.refresh(r);
      this.say(r.text);
    } catch (e) {
      this.say(String((e as Error).message ?? e));
    }
  }

  private async abandon(): Promise<void> {
    try {
      const r = await homesApi.abandon();
      this.refresh(r);
      this.say(r.text);
    } catch (e) {
      this.say(String((e as Error).message ?? e));
    }
  }

  /** The dealer's furniture out on the pavement by his door (in his hours). */
  private buildDealerShow(): void {
    const d = this.info!.dealer!;
    const g = new THREE.Group();
    const side: [number, number] = [-d.out[1], d.out[0]];
    // the pieces are drawn merged by material (a handful of draw calls, not fifty)
    const put = (kind: string, s: number, o: number, yaw: number) => {
      const pc = makePiece(kind, 3);
      // out on the pavement nothing burns
      if (pc.light?.glow) pc.light.glow.visible = false;
      const p = pc.group;
      p.position.set(d.wall[0] + side[0] * s + d.out[0] * o, 0, d.wall[1] + side[1] * s + d.out[1] * o);
      p.rotation.y = Math.atan2(d.out[0], d.out[1]) + yaw;
      g.add(p);
    };
    put("chair", 1.3, 0.55, 0.3);
    put("chair", 1.85, 0.5, -0.2);
    put("table", -1.6, 0.65, 0);
    put("birdcage", -2.5, 0.4, 0);
    put("stove", 2.8, 0.5, 0);
    put("plant", -1.3, 0.35, 0);
    this.worldRef.scene.add(mergeByMaterial(g));
    this.dealerShow = g;
  }

  // ------------------------------------------------------------------ in and out

  /** Jef's room frame position in his home's room, and whether he is in the room itself (its walls, its storey). */
  private inRoomNow(house: HouseInWorld): boolean {
    const plan = house.plan;
    const rf = plan.roomFrame!;
    const c = CLASSES[plan.entry.cls as HomeClass];
    const [x, z] = house.room.toLocal!(this.player.x, this.player.z);
    const feet = this.player.y - plan.floorY;
    return x > -c.W / 2 - 0.05 && x < c.W / 2 + 0.05 && z > -0.1 && z < c.D + 0.05 && Math.abs(feet - rf.y) < 0.6;
  }

  /**
   * Into the room: waking at home (M5 night) puts Jef by his bed; the dev and an old key put him just inside
   * the door. M7: otherwise Jef walks in by himself.
   */
  async enter(home: string, quiet = false): Promise<void> {
    await this.load();
    const h = this.info?.homes.find((q) => q.id === home);
    const house = this.houses.get(home);
    if (!h || !house || this.lease?.home !== home) return;
    const room = house.room;
    const hr = room.home!;
    const c = CLASSES[h.cls];
    // beside the bed, toward the room's middle, facing into the room
    const toward = (c.doorWall ?? 2) === 0 ? -1 : 1;
    const lx = THREE.MathUtils.clamp(hr.bed.x + (hr.bed.x < 0 ? 1 : -1) * (hr.bed.r + 0.1), -c.W / 2 + 0.4, c.W / 2 - 0.4);
    const lz = THREE.MathUtils.clamp(hr.bed.z, 0.5, c.D - 0.5);
    const at = room.toWorld(lx, lz);
    const look = room.toWorld(0, c.D / 2 + toward * 0.01);
    if (this.player.riding) this.player.rideEnd(at.x, at.z);
    this.player.place(at.x, at.z, Math.atan2(-(look.x - at.x), -(look.z - at.z)) || this.player.yaw, 0);
    this.player.y = house.plan.floorY + house.plan.roomFrame!.y;
    house.doorOpen = true;
    if (quiet) this.say(`Morning, in ${h.label}.`);
  }

  /** Jef came into his room: the words for it, a piece in his arms to put up, and now and then a visitor. */
  private cameIn(house: HouseInWorld): void {
    const h = this.info?.homes.find((q) => q.id === this.lease?.home);
    if (!h) return;
    this.interiors.setHome({ place: h.id, label: h.label, room: house.room, house });
    const l = this.lease!;
    this.say(`${h.label[0].toUpperCase()}${h.label.slice(1)}. It feels ${l.words.join(", ")}.${this.carrying ? " Set the piece down where you want it: E." : ""}`);
    // what Jef brought in his arms: straight to placing it
    const arms = this.carrying;
    if (arms) this.startMove(arms);
    void this.lookIn();
  }

  /** The landlady or a neighbour looks in (the server decides who, and once a day). */
  private async lookIn(): Promise<void> {
    const key = `${this.jobs.day.dayNum}:${this.lease?.home}`;
    if (this.remarkAsked === key) return;
    this.remarkAsked = key;
    try {
      const r = await homesApi.remark();
      if (!r.remark || !this.room()) return;
      this.interiors.visit(r.remark.who, r.remark.line);
      this.visitT = 14;
    } catch {
      /* nobody comes */
    }
  }

  // ------------------------------------------------------------------ inside

  private insideKeys(x: number, z: number): { options: Array<[number, Action]>; extra: Action[] } {
    const room = this.room();
    if (!room) return { options: [], extra: [] };
    const hr = room.home!;
    const options: Array<[number, Action]> = [];
    const extra: Action[] = [];
    const mv = this.moving;
    if (mv) {
      const name = FURNITURE[mv.item.kind].name;
      options.push([
        -1,
        mv.ok
          ? { key: "KeyE", text: `set ${name} down here (R turns it)`, run: () => void this.putDown(), self: true }
          : { key: "KeyE", text: `${mv.why ?? "it will not go there"} (R turns it)`, run: () => this.say(`It will not go there: ${mv.why ?? "no room"}.`), self: true },
      ]);
      if (mv.item.state === "placed") extra.push({ key: "KeyG", text: "leave it where it was", run: () => this.cancelMove(), self: true });
      return { options, extra };
    }
    const bd = Math.hypot(hr.bed.x - x, hr.bed.z - z);
    const bed = this.interiors.roomPoint(hr.bed.x, hr.bed.z, 0.5);
    if (bd < hr.bed.r)
      options.push([
        bd - 0.5,
        this.jobs.day.bedOpen
          ? { key: "KeyE", text: "go to bed", run: () => void this.jobs.day.sleep(() => homesApi.sleep()), at: bed }
          : { key: "KeyE", text: "lie down on the bed", run: () => this.say("Too early for bed. From six in the evening, or when you are dead tired."), at: bed },
      ]);
    for (const f of hr.fires()) {
      const d = Math.hypot(f.x - x, f.z - z);
      if (d < 1.3) options.push([d - 0.2, { key: "KeyE", text: "warm yourself at the fire", run: () => void this.warm(), at: this.interiors.roomPoint(f.x, f.z, 0.5) }]);
    }
    // the next thing to put up: from the pocket, the pile by the door
    const next = (this.info?.items ?? []).find((i) => i.state === "pocket" || i.state === "stored" || i.state === "arms");
    // (from his own pocket or the pile: about Jef, no looking needed)
    if (next) extra.push({ key: "KeyF", text: `put up ${next.name}`, run: () => this.startMove(next), self: true });
    // a piece in front of Jef to move
    const piece = this.pieceAhead(room, x, z);
    if (piece) {
      const it = this.info!.items.find((i) => i.id === piece.id);
      if (it) extra.push({ key: "KeyG", text: `move ${it.name}`, run: () => this.startMove(it), at: this.interiors.roomPoint(piece.x, piece.z, 0.5) });
    }
    return { options, extra };
  }

  /** Jef's facing in the room's frame. */
  private facing(room: Room): [number, number] {
    const px = this.player.x;
    const pz = this.player.z;
    const [ax, az] = room.toLocal!(px, pz);
    const [bx, bz] = room.toLocal!(px - Math.sin(this.player.yaw), pz - Math.cos(this.player.yaw));
    const l = Math.hypot(bx - ax, bz - az) || 1;
    return [(bx - ax) / l, (bz - az) / l];
  }

  /** Where Jef stands in the room's frame. */
  private jefLocal(room: Room): { x: number; z: number } {
    const [x, z] = room.toLocal!(this.player.x, this.player.z);
    return { x, z };
  }

  private pieceAhead(room: Room, x: number, z: number): { id: number; x: number; z: number } | null {
    const [fx, fz] = this.facing(room);
    let best: { id: number; x: number; z: number } | null = null;
    let bs = -Infinity;
    for (const p of room.home!.pieces()) {
      const dx = p.x - x;
      const dz = p.z - z;
      const d = Math.hypot(dx, dz);
      if (d > 1.7 || d < 0.05) continue;
      const along = (dx * fx + dz * fz) / d;
      if (along < 0.5) continue;
      const s = along - d * 0.3;
      if (s > bs) [best, bs] = [{ id: p.id, x: p.x, z: p.z }, s];
    }
    return best;
  }

  private startMove(item: HomeItem): void {
    const room = this.room();
    if (!room) return;
    this.moving = { item, rot: item.state === "placed" ? item.rot : 0, gx: 0, gz: 0, ok: false, why: null };
    if (item.state === "placed") room.home!.setPlaced(this.placed(item.id));
    if (this.carried && this.carried.id === item.id) this.carried.obj.visible = false;
    this.updateMove();
  }

  private cancelMove(): void {
    const room = this.room() ?? (this.lease ? this.houses.get(this.lease.home)?.room : null) ?? null;
    this.moving = null;
    room?.home!.ghost(null);
    room?.home!.setPlaced(this.placed());
    if (this.carried) this.carried.obj.visible = true;
  }

  private async putDown(): Promise<void> {
    const mv = this.moving;
    if (!mv || !mv.ok || this.busy) return;
    this.busy = true;
    try {
      const r = await homesApi.place(mv.item.id, mv.gx, mv.gz, mv.rot);
      this.moving = null;
      this.room()?.home!.ghost(null);
      this.refresh(r);
      const l = this.lease;
      this.say(`You set ${FURNITURE[mv.item.kind].name} down.${l ? ` The room feels ${l.words.join(", ")}.` : ""}`);
      this.interiors.sfx("thud_plank");
    } catch (e) {
      this.say(`It will not go there: ${String((e as Error).message ?? e)}.`);
    } finally {
      this.busy = false;
    }
  }

  private async warm(): Promise<void> {
    try {
      const r = await homesApi.stove();
      this.refresh(r);
      this.say(r.text);
    } catch (e) {
      this.say(String((e as Error).message ?? e));
    }
  }

  /** The ghost follows Jef's eyes over the grid; the same rule as the server's tints it. */
  private updateMove(): void {
    const mv = this.moving;
    const room = this.room();
    if (!mv || !room) return;
    const w = this.jefLocal(room);
    const cls = room.home!.cls as HomeClass;
    const c = CLASSES[cls];
    const def = FURNITURE[mv.item.kind];
    const [fx, fz] = this.facing(room);
    const tx = w.x + fx * AHEAD;
    const tz = w.z + fz * AHEAD;
    const { nx, nz } = grid(cls);
    let gx: number;
    let gz: number;
    let rot = mv.rot;
    if (def.layer === "wall") {
      // the wall nearest the point Jef looks at
      const dists: Array<[number, number]> = [
        [c.D - tz, 0],
        [c.W / 2 - tx, 1],
        [tz, 2],
        [tx + c.W / 2, 3],
      ];
      dists.sort((a, b) => a[0] - b[0]);
      rot = dists[0][1];
      if (rot === 0 || rot === 2) {
        gx = Math.round((tx + c.W / 2) / CELL - def.w / 2);
        gz = rot === 0 ? nz - 1 : 0;
      } else {
        gz = Math.round(tz / CELL - def.w / 2);
        gx = rot === 1 ? nx - 1 : 0;
      }
    } else {
      const fp = def.layer === "ceiling" ? { w: 1, d: 1 } : footprint(def.w, def.d, rot);
      gx = Math.round((tx + c.W / 2) / CELL - fp.w / 2);
      gz = Math.round(tz / CELL - fp.d / 2);
    }
    let why = canPlace(cls, this.placed(mv.item.id), mv.item.kind, gx, gz, rot, mv.item.id);
    if (!why && def.layer === "floor") {
      // never on the spot Jef stands on
      const fp = footprint(def.w, def.d, rot);
      const x0 = -c.W / 2 + gx * CELL;
      const z0 = gz * CELL;
      if (w.x > x0 - 0.3 && w.x < x0 + fp.w * CELL + 0.3 && w.z > z0 - 0.3 && w.z < z0 + fp.d * CELL + 0.3) why = "you are standing there";
    }
    mv.gx = gx;
    mv.gz = gz;
    if (def.layer === "wall") mv.rot = rot;
    mv.ok = !why;
    mv.why = why;
    room.home!.ghost({ kind: mv.item.kind, gx, gz, rot: mv.rot, ok: mv.ok });
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.moving || e.code !== "KeyR" || e.repeat) return;
    if (this.jobs.talk.isOpen || this.jobs.day.sheetOpen) return;
    const def = FURNITURE[this.moving.item.kind];
    if (def.layer === "wall" || def.layer === "ceiling") return;
    this.moving.rot = (this.moving.rot + 1) % 4;
    this.updateMove();
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number): void {
    this.t += dt;
    this.infoT -= dt;
    if (this.infoT <= 0) {
      this.infoT = 15;
      void this.load();
    }
    const hour = this.jobs.day.hourF;
    if (this.dealerShow) this.dealerShow.visible = hour >= 8 && hour < 18 && this.jobs.day.dayNum % 7 !== 0;
    // the houses: your door opens as you come with the key (and stays open while you are inside); the
    // windows glow at night where someone is home: you in your room, the widow in her house
    const day = this.daylight();
    const mineId = this.lease?.home ?? null;
    let inMine: HouseInWorld | null = null;
    for (const [id, house] of this.houses) {
      const mine = id === mineId;
      const inside = house.insideness(this.player.x, this.player.z) > 0.3;
      house.doorOpen = mine && (inside || house.near(this.player.x, this.player.z) < OPEN_M);
      if (mine && house.insideness(this.player.x, this.player.z) > 0.5) inMine = house;
      const widowHome = id === "widow" && !!this.info?.widow?.home;
      house.glow = (mine && this.inRoom) || widowHome ? 1 : 0;
      house.update(this.t, dt, day);
      if (house.drawn() && !(mine && this.inRoom)) house.room.update(this.t, dt);
    }
    // in the room itself (not the stair or the corridor): its keys, the visitor, the pieces
    const nowIn = !!inMine && this.inRoomNow(inMine);
    if (nowIn !== this.inRoom) {
      this.inRoom = nowIn;
      if (nowIn) this.cameIn(inMine!);
      else this.interiors.setHome(null);
    }
    if (!this.room()) {
      if (this.moving) this.cancelMove();
      if (this.carried) this.carried.obj.visible = true;
      return;
    }
    if (this.moving) this.updateMove();
    if (this.visitT > 0) {
      this.visitT -= dt;
      if (this.visitT <= 0) this.interiors.visit(null);
    }
  }

  // ------------------------------------------------------------------ dev

  /** Dev: the state for scripted checks. */
  debug() {
    const room = this.room();
    return {
      lease: this.lease,
      inside: room ? room.home!.cls : null,
      inRoom: this.inRoom,
      moving: this.moving ? { kind: this.moving.item.kind, gx: this.moving.gx, gz: this.moving.gz, rot: this.moving.rot, ok: this.moving.ok, why: this.moving.why } : null,
      items: this.info?.items.map((i) => `${i.id} ${i.kind} ${i.state}${i.state === "placed" ? ` ${i.gx},${i.gz} r${i.rot}` : ""}`) ?? [],
      carrying: this.carrying?.kind ?? null,
      doors: this.info?.homes.map((h) => ({ id: h.id, label: h.label, step: h.step, open: this.houses.get(h.id)?.doorOpen ?? null, leaf: this.houses.get(h.id)?.leaf ?? null })) ?? [],
    };
  }

  /** M7: the homes' houses in the world (dev checks). */
  get inWorldHouses(): HouseInWorld[] {
    return [...this.houses.values()];
  }

  /** Dev: stand at a home's door (or the dealer's). */
  devDoor(id: string): string {
    const h = id === "dealer" ? this.info?.dealer : this.info?.homes.find((q) => q.id === id);
    if (!h) return `no door ${id}`;
    const at = "at" in h ? [h.at[0] + h.out[0] * 0.8, h.at[1] + h.out[1] * 0.8] : h.step;
    this.player.place(at[0], at[1], Math.atan2(h.out[0], h.out[1]));
    return `at ${id}`;
  }

  devTake = (home: string, plan: "day" | "week" = "week") => this.take(home, plan);
  /** Dev: look round any home's room (as it is let, without the key): Jef in the middle of it, for pictures. */
  devView(id: string): string {
    const house = this.houses.get(id);
    if (!house) return `no home ${id}`;
    const c = CLASSES[house.plan.entry.cls as HomeClass];
    const room = house.room;
    const at = room.toWorld(0, c.D * 0.35);
    const look = room.toWorld(0, c.D);
    if (this.player.riding) this.player.rideEnd(at.x, at.z);
    this.player.place(at.x, at.z, Math.atan2(-(look.x - at.x), -(look.z - at.z)), 0);
    this.player.y = house.plan.floorY + house.plan.roomFrame!.y;
    return `viewing ${id}`;
  }
  devEnter = (home?: string) => this.enter(home ?? this.lease?.home ?? "");
  /** Dev: put up a piece at a cell and a turn, straight through the server. */
  async devPlace(id: number, gx: number, gz: number, rot = 0): Promise<string> {
    try {
      const r = await homesApi.place(id, gx, gz, rot);
      this.refresh(r);
      this.moving = null;
      this.room()?.home!.ghost(null);
      return "placed";
    } catch (e) {
      return String((e as Error).message ?? e);
    }
  }
  devMove(id: number): string {
    const it = this.info?.items.find((i) => i.id === id);
    if (!it) return "no such piece";
    this.startMove(it);
    return this.moving ? "moving" : "not inside";
  }
  devTurn(): void {
    this.onKey(new KeyboardEvent("keydown", { code: "KeyR" }));
  }
  devPut = () => this.putDown();
}

/** One mesh per material for a group of still pieces (in place: the group is emptied and refilled). */
function mergeByMaterial(g: THREE.Group): THREE.Group {
  g.updateMatrixWorld(true);
  const by = new Map<THREE.Material, THREE.BufferGeometry[]>();
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    // meshes only: the pavement pieces have no light of their own (sprites are dropped)
    if (!m.isMesh || Array.isArray(m.material)) return;
    const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
    const list = by.get(m.material) ?? [];
    list.push(geo.index ? geo.toNonIndexed() : geo);
    by.set(m.material, list);
  });
  for (const c of [...g.children]) g.remove(c);
  g.position.set(0, 0, 0);
  g.rotation.set(0, 0, 0);
  for (const [mat, geos] of by) {
    const merged = mergeGeometries(geos, false);
    if (merged) g.add(new THREE.Mesh(merged, mat));
  }
  return g;
}

function rolledRug(): THREE.Object3D {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.95, 8), new THREE.MeshLambertMaterial({ color: 0x6a4a3a }));
  m.rotation.z = Math.PI / 2;
  const g = new THREE.Group();
  g.add(m);
  return g;
}
