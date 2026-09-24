import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { FirstPerson } from "../player/firstPerson";
import type { World } from "../world/rijnkaai";
import type { JobsPayload } from "../net/api";
import { homesApi, type HomeItem, type HomesInfo } from "../net/homesApi";
import { buildHome } from "../world/homeRooms";
import { makePiece } from "../world/furniture";
import type { Room } from "../world/rooms";
import { canPlace, CELL, CLASSES, FURNITURE, footprint, grid, type HomeClass, type Placed } from "../../../shared/homes";
import type { Interiors } from "./interiors";
import type { Jobs } from "./jobs";
import type { Action } from "./runs";

// Homes to rent (M6 homes). Five doors in the town that nobody lives behind (and the widow's
// own door) carry a notice: read it, take the key for a night or to Sunday, pay the rent.
// Inside (the interiors' way in: game/interiors.ts enterOwn) the room of its class, and the
// pieces Jef bought at the second-hand dealer's: a small piece comes out of a pocket, a big
// one is carried there in both arms. Pick a piece up, move it over the grid, R turns it, E
// sets it down: the server checks the place and keeps the layout. Bed, stove and hearth by
// the server's numbers. Now and then the landlady or a neighbour looks in and says a line.

const REACH_DOOR = 1.8;
const AHEAD = 1.1;
const HOLD: [number, number, number] = [0.05, -0.62, -1.05];

export class Homes {
  info: HomesInfo | null = null;
  private rooms = new Map<string, Room>();
  private infoT = 0;
  private busy = false;
  /** The piece in both arms (shown before the camera), if any. */
  private carried: { id: number; obj: THREE.Object3D } | null = null;
  /** Moving a piece inside: which, from where, and the ghost's place. */
  private moving: { item: HomeItem; rot: number; gx: number; gz: number; ok: boolean; why: string | null } | null = null;
  private dealerShow: THREE.Group | null = null;
  private remarkAsked = "";
  private visitT = 0;
  say: (t: string) => void = () => {};

  constructor(
    private readonly world: World,
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
    const room = this.room();
    if (room && !this.moving) room.home!.setPlaced(this.placed());
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
      if (mine) {
        options.push([d, { key: "KeyE", text: arms ? `carry ${FURNITURE[arms.kind].name} into your room` : `go into your room`, run: () => void this.enter(h.id) }]);
        const l = this.lease!;
        if (!arms && l.owed_c > 0) extra.push({ key: "KeyF", text: `pay the rent you owe (${l.owed_c} c)`, run: () => void this.pay("day") });
        else if (!arms && l.to_sunday_c > 0) extra.push({ key: "KeyF", text: `pay the rent to Sunday (${l.to_sunday_c} c)`, run: () => void this.pay("week") });
      } else if (!arms) {
        const lord = h.landlord ? `, ${h.cls === "widow" ? "the widow" : "landlord"} ${h.landlord.name}` : "";
        options.push([d, { key: "KeyE", text: `read the notice: ${CLASSES[h.cls].label} to let`, run: () => this.say(`"${h.notice}" ${h.week_c} c a week, ${h.day_c} c a night${lord}.`) }]);
        const moving = this.lease ? " (and give up your room)" : "";
        extra.push({ key: "KeyF", text: `take the key to Sunday (${h.to_sunday_c} c)${moving}`, run: () => void this.take(h.id, "week") });
        extra.push({ key: "KeyG", text: `take it for tonight (${h.day_c} c)`, run: () => void this.take(h.id, "day") });
      }
    }
    if (arms) {
      const only: Action[] = options.length ? [options.sort((a, b) => a[0] - b[0])[0][1]] : [];
      only.push({ key: "KeyG", text: `leave ${FURNITURE[arms.kind].name} here`, run: () => void this.abandon() });
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
    this.world.scene.add(mergeByMaterial(g));
    this.dealerShow = g;
  }

  // ------------------------------------------------------------------ in and out

  async enter(home: string, quiet = false): Promise<void> {
    await this.load();
    const h = this.info?.homes.find((q) => q.id === home);
    if (!h || this.lease?.home !== home) return;
    let room = this.rooms.get(home);
    if (!room) {
      const f = this.interiors.frameOf(h.step, h.out, h.wall);
      room = buildHome({ origin: f.origin, yaw: f.yaw, cls: h.cls, seed: h.step[0] * 7 + h.step[1] * 13 });
      this.rooms.set(home, room);
    }
    const r = room;
    r.home!.setPlaced(this.placed());
    const ok = await this.interiors.enterOwn(r, { place: home, label: h.label, step: h.step, out: h.out, wall: h.wall }, undefined, false);
    if (!ok) return;
    if (quiet) this.say(`Morning, in ${h.label}.`);
    else {
      const l = this.lease!;
      this.say(`${h.label[0].toUpperCase()}${h.label.slice(1)}. It feels ${l.words.join(", ")}.${this.carrying ? " Set the piece down where you want it: E." : ""}`);
    }
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
          ? { key: "KeyE", text: `set ${name} down here (R turns it)`, run: () => void this.putDown() }
          : { key: "KeyE", text: `${mv.why ?? "it will not go there"} (R turns it)`, run: () => this.say(`It will not go there: ${mv.why ?? "no room"}.`) },
      ]);
      if (mv.item.state === "placed") extra.push({ key: "KeyG", text: "leave it where it was", run: () => this.cancelMove() });
      return { options, extra };
    }
    const bd = Math.hypot(hr.bed.x - x, hr.bed.z - z);
    if (bd < hr.bed.r)
      options.push([
        bd - 0.5,
        this.jobs.day.bedOpen
          ? { key: "KeyE", text: "go to bed", run: () => void this.jobs.day.sleep(() => homesApi.sleep()) }
          : { key: "KeyE", text: "lie down on the bed", run: () => this.say("Too early for bed. From six in the evening, or when you are dead tired.") },
      ]);
    for (const f of hr.fires()) {
      const d = Math.hypot(f.x - x, f.z - z);
      if (d < 1.3) options.push([d - 0.2, { key: "KeyE", text: "warm yourself at the fire", run: () => void this.warm() }]);
    }
    // the next thing to put up: from the pocket, the pile by the door
    const next = (this.info?.items ?? []).find((i) => i.state === "pocket" || i.state === "stored" || i.state === "arms");
    if (next) extra.push({ key: "KeyF", text: `put up ${next.name}`, run: () => this.startMove(next) });
    // a piece in front of Jef to move
    const piece = this.pieceAhead(room, x, z);
    if (piece) {
      const it = this.info!.items.find((i) => i.id === piece.id);
      if (it) extra.push({ key: "KeyG", text: `move ${it.name}`, run: () => this.startMove(it) });
    }
    return { options, extra };
  }

  /** Jef's facing in the room's frame. */
  private facing(room: Room): [number, number] {
    const v = new THREE.Vector3(-Math.sin(this.player.yaw), 0, -Math.cos(this.player.yaw));
    v.applyAxisAngle(new THREE.Vector3(0, 1, 0), -room.group.rotation.y);
    return [v.x, v.z];
  }

  private pieceAhead(room: Room, x: number, z: number): { id: number } | null {
    const [fx, fz] = this.facing(room);
    let best: { id: number } | null = null;
    let bs = -Infinity;
    for (const p of room.home!.pieces()) {
      const dx = p.x - x;
      const dz = p.z - z;
      const d = Math.hypot(dx, dz);
      if (d > 1.7 || d < 0.05) continue;
      const along = (dx * fx + dz * fz) / d;
      if (along < 0.5) continue;
      const s = along - d * 0.3;
      if (s > bs) [best, bs] = [{ id: p.id }, s];
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
    const room = this.room();
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
    const w = this.player.rideWalk;
    if (!mv || !room || !w) return;
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
    this.infoT -= dt;
    if (this.infoT <= 0) {
      this.infoT = 15;
      void this.load();
    }
    if (this.dealerShow) {
      const h = this.jobs.day.hourF;
      this.dealerShow.visible = h >= 8 && h < 18 && this.jobs.day.dayNum % 7 !== 0;
    }
    if (!this.room()) {
      if (this.moving) this.moving = null;
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
      moving: this.moving ? { kind: this.moving.item.kind, gx: this.moving.gx, gz: this.moving.gz, rot: this.moving.rot, ok: this.moving.ok, why: this.moving.why } : null,
      items: this.info?.items.map((i) => `${i.id} ${i.kind} ${i.state}${i.state === "placed" ? ` ${i.gx},${i.gz} r${i.rot}` : ""}`) ?? [],
      carrying: this.carrying?.kind ?? null,
      doors: this.info?.homes.map((h) => ({ id: h.id, label: h.label, step: h.step })) ?? [],
    };
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
  /** Dev: look round any home's room (bare, as it is let), without the key: for pictures. */
  async devView(id: string): Promise<string> {
    const h = this.info?.homes.find((q) => q.id === id);
    if (!h) return `no home ${id}`;
    if (this.interiors.inside) this.interiors.leave(true);
    const f = this.interiors.frameOf(h.step, h.out, h.wall);
    const room = buildHome({ origin: f.origin, yaw: f.yaw, cls: h.cls, seed: h.step[0] * 7 + h.step[1] * 13 });
    const ok = await this.interiors.enterOwn(room, { place: `view:${id}`, label: h.label, step: h.step, out: h.out, wall: h.wall }, undefined, true);
    return ok ? `viewing ${h.label}` : "busy";
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
