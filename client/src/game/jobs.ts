import * as THREE from "three";
import { doorSpot } from "../world/city";
import { api, connectPush, type Job, type JobsPayload, type OutcomeMsg, type Progress, type PushMsg, type Report } from "../net/api";
import { BOARD_POS, DOSS_POS, SPOTS, type World } from "../world/rijnkaai";
import type { FirstPerson } from "../player/firstPerson";
import { glowTexture } from "../world/textures";
import { GOODS, type Goods } from "./props";
import { GoodsWorld, ahead, type Item } from "./goods";
import { People } from "./people";
import { Talk } from "./talk";
import { Pockets } from "./pockets";
import { Day } from "./day";
import { CityMap, type MapMark } from "./map";
import { esc, HaulRun, makeRun, type Action, type Run, type RunCtx, type Sfx } from "./runs";
import type { Town } from "./town";
import { topLeft } from "./corner";
import { auditShown, best, bindView, inView, type Target } from "./facing";
import type { QuestBoxes } from "./questboxes";

// The hands and the job (M2, M2b, M3). Everything you do with E and F goes
// through here: lift, set down, stack, drop in the Schelde, talk, read the
// board, and the job's own actions. The server decides pay, task and trust.

const REACH_BOARD = 2.6;
const REACH_DOSS = 2.4;
const REACH_ITEM = 1.8;
const OWNER_SEES = 12;
/** The doss house door itself (DOSS_POS is the step 1.2 m out in the street), for looking at it. */
const DOSS_DOOR: Target = (() => {
  const p = doorSpot("doss", 0.1);
  return { x: p.x, z: p.z };
})();

/** A point by a door of the city, as [x, z]. */
function ds(door: string, out: number, side: number): [number, number] {
  const p = doorSpot(door, out, side);
  return [p.x, p.z];
}

/** Goods that belong to people, lying about the quay from the start. */
const OWNED: Array<{ kind: Goods; owner: string; at: Array<[number, number]> }> = [
  { kind: "crates", owner: "sooi", at: [ds("hessenatie", 3.5, -5), ds("hessenatie", 3.5, -6), ds("hessenatie", 3.5, -5), ds("hessenatie", 4.4, -5.5)] },
  { kind: "barrels", owner: "peeters", at: [ds("peeters", 3.2, 3.5), ds("peeters", 3.2, 4.3), ds("peeters", 4.0, 3.9)] },
  { kind: "barrels", owner: "tuur", at: [[7.7, -5.2], [6.9, -5.2]] },
  { kind: "sacks", owner: "fientje", at: [[44.3, 12.4], [44.3, 13.1]] },
];

/** What an owner shouts when Jef lifts their goods under their nose. */
const OWNER_SHOUT: Record<string, string> = {
  sooi: `Sooi: "Hey! That's natie goods, lad. Put it down or I'll put you down."`,
  peeters: `Widow Peeters: "Thief! Those are mine. Put it back this instant!"`,
  tuur: `Tuur: "Hands off, friend. That's not yours to carry."`,
  fientje: `Fientje: "Oi! Fingers off my baskets, you!"`,
};
const OWNER_CALM: Record<string, string> = {
  sooi: `Sooi grunts. "Right. Keep your hands to your own work."`,
  peeters: `The widow sniffs. "Hm. See that it stays there."`,
  tuur: `Tuur nods slowly. "Wise."`,
  fientje: `"That's better, love. I'd have told the whole Vismarkt."`,
};

export class Jobs {
  private payload: JobsPayload | null = null;
  private active: Job | null = null;
  private run: Run | null = null;
  private acts: Action[] = [];
  private boardOpen = false;
  private finishing = false;
  sfx: (name: Sfx, at?: THREE.Vector3) => void = () => {};
  /**
   * M4: pushes that are not the board (actions, events, a conversation); set by main, each part
   * wrapping the one before. Read back, the handler comes in its own try: a part that throws does
   * not stop the parts after it (each wrapper calls the one before through this getter).
   */
  private pushFn: (m: PushMsg) => void = () => {};
  get onPush(): (m: PushMsg) => void {
    const f = this.pushFn;
    return (m) => {
      try {
        f(m);
      } catch (e) {
        console.warn(`push "${m.type}" failed`, e);
      }
    };
  }
  set onPush(f: (m: PushMsg) => void) {
    this.pushFn = f;
  }

  readonly goods: GoodsWorld;
  readonly people: People;
  readonly talk: Talk;
  readonly pockets: Pockets;
  readonly day: Day;
  readonly map: CityMap;
  private sinking: Array<{ obj: THREE.Object3D; t: number; splashed: boolean }> = [];
  /** The townspeople (M3e), set by main. */
  town: Town | null = null;
  /**
   * M7 night: the employers' quest boxes (game/questboxes.ts), set by main. A job whose work is done
   * while its employer is at home asleep is held here until Jef drops the proof in the box by his door.
   */
  boxes: QuestBoxes | null = null;
  /** The job whose work is done, its proof for the box (the facts wait on the server: api.hold). */
  private held: Job | null = null;
  /** M3h (game/deeds.ts): more things the keys can do: only these (on a velocipede), or options by distance, or extra keys. */
  extraActions: Array<(x: number, z: number) => { only?: Action[]; options?: Array<[number, Action]>; extra?: Action[] }> = [];
  /** M6 handcart (game/handcart.ts): keys for the goods in Jef's hands (put it on the cart). */
  carryExtra: Array<(item: Item, x: number, z: number) => Action[]> = [];
  /** M6 handcart: the job in hand and how it plays, for the cart's loading and unloading. */
  get running(): { job: Job; run: Run } | null {
    return this.active && this.run ? { job: this.active, run: this.run } : null;
  }
  /** An owner saw you lift this; set it back near where it was and they calm down. */
  private watched: { item: Item; owner: string } | null = null;

  private readonly el = {
    prompt: div("prompt"),
    hud: div("hud"),
    task: div("task"),
    toast: div("toast"),
    note: div("note paper"),
    tick: div("tick"),
    board: div("board paper"),
  };

  // subtle pointer: a faint warm glow at the goal, and an ink tick at the top edge
  private readonly glow: THREE.Sprite;
  private readonly glowLight: THREE.PointLight;

  constructor(
    private readonly world: World,
    private readonly player: FirstPerson,
  ) {
    for (const e of Object.values(this.el)) document.body.appendChild(e);
    // the task card goes under the clock, in the top-left column (game/corner.ts)
    topLeft().appendChild(this.el.task);
    this.el.board.style.display = "none";
    this.el.tick.textContent = "▾";
    // carried goods hang in front of the camera, so the camera joins the scene
    world.scene.add(player.camera);
    bindView(player);

    this.goods = new GoodsWorld(world, player);
    this.people = new People(world);
    this.talk = new Talk(player);
    this.pockets = new Pockets(player, this.el.hud);
    this.pockets.toast = (t) => this.toastMsg(t);
    this.pockets.onChange = (p) => this.apply(p);
    this.talk.work = (id) =>
      this.active ? [] : (this.payload?.jobs ?? []).filter((j) => j.employer_npc === id && j.status === "offered" && j.playable);
    this.talk.workLater = (id) => !!this.active && (this.payload?.jobs ?? []).some((j) => j.employer_npc === id && j.status === "offered" && j.playable);
    this.talk.onTakeWork = (j) => {
      this.talk.close();
      void this.takeJob(j);
    };
    this.talk.onBought = (p, line) => {
      this.apply(p);
      this.toastMsg(line);
    };
    this.day = new Day(world, player);
    this.map = new CityMap(player);
    this.map.marks = () => this.mapMarks();
    this.day.apply = (p) => this.apply(p);
    this.day.toast = (t) => this.toastMsg(t);
    this.day.onSheet = () => {
      this.talk.close();
      if (this.boardOpen) this.closeBoard();
      if (this.pockets.open) this.pockets.toggle();
      if (this.map.open) this.map.toggle();
    };
    for (const o of OWNED) for (const [x, z] of o.at) this.goods.spawn(o.kind, x, z, { owner: o.owner });

    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: 0xffc080,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0,
      }),
    );
    this.glow.scale.set(1.1, 1.1, 1);
    world.scene.add(this.glow);
    // always in the scene so the light count never changes (no shader rebuild)
    this.glowLight = new THREE.PointLight(0xffb060, 0, 5, 2);
    world.scene.add(this.glowLight);

    window.addEventListener("keydown", (e) => this.onKey(e));
    connectPush(
      (p) => this.apply(p),
      (o) => this.showOutcome(o),
      (m) => this.onPush(m),
    );
    api
      .jobs()
      .then((p) => this.apply(p))
      .catch(() => this.toastMsg("The hiring board is not reachable. Is the server running?"));
  }

  // ------------------------------------------------------------- server data

  private apply(p: JobsPayload): void {
    this.payload = p;
    this.el.hud.textContent = `${p.player.money_c} c`;
    this.talk.money = p.player.money_c;
    this.pockets.apply(p);
    this.day.show(p);
    // who has work open: after dark they show a light (M3e)
    if (this.town) {
      this.town.openWork = new Set(p.jobs.filter((j) => j.status === "offered" && j.playable).map((j) => j.employer_npc));
      this.town.takenWork = new Set(p.jobs.filter((j) => j.status === "taken").map((j) => j.employer_npc));
    }
    // pick up a job that is already taken (reload in the middle of a job; M7 night: or its proof waiting for the box)
    const taken = p.jobs.find((j) => j.status === "taken") ?? null;
    if (taken && !this.active) {
      if ((taken.task as { held?: unknown } | null)?.held) this.holdFor(taken);
      else this.start(taken);
    }
    // the job ended on the server without us (its deadline, a gang, the cell): drop it here too
    if (this.active && !this.finishing && taken?.id !== this.active.id) {
      // M7 quest tests: the night's work gone at five vanished from the corner without a word
      const a = this.active;
      const h = p.clock?.hour ?? this.day.hour;
      if (a.source === "night" && h >= 5 && h < 21) this.toastMsg(`Five o'clock: ${a.employer_name} is gone, and "${a.title}" with him. Not done, not paid.`);
      this.dropRun();
    }
    if (this.boardOpen) this.renderBoard();
  }

  // ------------------------------------------------------------- per frame

  update(dt: number): void {
    this.run?.update(dt);
    this.people.update(dt, this.player);
    this.updateSinking(dt);
    // what E and F can do: ten times a second, or at once when Jef moved or turned, or his hands
    // or a window changed (findActions asks every part of the town; not needed each frame)
    this.actsT -= dt;
    const pl = this.player;
    const sig = this.goods.carried;
    const shut = this.boardOpen || this.talk.isOpen || this.pockets.open || this.day.sheetOpen || this.map.open;
    if (this.actsT <= 0 || Math.hypot(pl.x - this.actsAt.x, pl.z - this.actsAt.z) > 0.2 || Math.abs(pl.yaw - this.actsAt.yaw) > 0.15 || sig !== this.actsSig || shut !== this.actsShut || this.run !== this.actsRun) {
      this.actsT = 0.1;
      this.actsAt = { x: pl.x, z: pl.z, yaw: pl.yaw };
      this.actsSig = sig;
      this.actsShut = shut;
      this.actsRun = this.run;
      this.acts = this.findActions();
    }
    const text = this.boardOpen || this.talk.isOpen || this.pockets.open || this.day.sheetOpen || this.map.open ? "" : this.acts.map((a) => `${a.key.slice(3)}  ${a.text}`).join("     ");
    if (this.el.prompt.textContent !== text) this.el.prompt.textContent = text;
    this.el.prompt.style.display = text ? "block" : "none";
    this.renderTask();
    this.updatePointer(dt);
  }

  private actsT = 0;
  private actsAt = { x: NaN, z: NaN, yaw: NaN };
  private actsSig: unknown = null;
  private actsShut = false;
  private actsRun: Run | null = null;

  /**
   * Everything E and F can do right now, most specific first. A key about a thing or a person
   * (`at`) is offered only while Jef looks at it; of several, the one nearest the crosshair wins
   * (game/facing.ts). Keys about Jef himself or the spot ahead (`self`) need no looking.
   */
  private findActions(): Action[] {
    const list = this.findAll();
    if (import.meta.env.DEV) auditShown(list);
    return list;
  }

  private findAll(): Action[] {
    if (this.boardOpen || this.talk.isOpen || this.pockets.open || this.day.sheetOpen || this.map.open) return [];
    const { x, z } = this.player;
    const out: Action[] = [];
    const add = (a: Action) => {
      if (!out.some((o) => o.key === a.key) && inView(a)) out.push(a);
    };
    const carried = this.goods.carried;
    const more = carried ? [] : this.extraActions.map((f) => f(x, z));
    const only = more.find((m) => m.only)?.only;
    if (only) {
      for (const a of only) add(a);
      return out;
    }

    if (carried) {
      for (const a of this.run?.carryActions(carried) ?? []) add(a);
      // M6 handcart: put it on the cart
      for (const f of this.carryExtra) for (const a of f(carried, x, z)) add(a);
      const [px, pz] = ahead(this.player, 0.95);
      if (this.world.isWater(px, pz)) add({ key: "KeyE", text: "let it fall into the Schelde", run: () => this.drown(px, pz), self: true });
      else {
        const where = this.goods.canPlace(px, pz);
        if (where) {
          const label = this.run?.placeLabel(carried, px, pz) ?? (where === "stack" ? "stack it" : "set it down");
          add({ key: "KeyE", text: label, run: () => this.putDown(px, pz), self: true });
        }
      }
      return out;
    }

    for (const a of this.run?.actions() ?? []) add(a);
    // M7 night: the work is done; the proof goes in the employer's box, or into his hand if he is back
    const held = this.held;
    if (held && !this.finishing) {
      const boss = this.people.get(held.employer_npc);
      // M7 quest tests: back at his post in the morning he takes the proof in his hand (the box stands
      // a step from him, and "drop it in the box" was all that was offered); the box while he is away
      const box = this.heldBox() ? this.boxes!.near(x, z, held.employer_npc) : null;
      if (box) add({ key: "KeyE", text: `drop the proof in ${box.name}'s box and take your pay`, run: () => void this.finish(held, { box: true }), at: this.boxes!.target(box) });
      const bossNear = boss && boss.present && boss.distTo(x, z) < 2.6;
      if (bossNear && !box) add({ key: "KeyE", text: `give the proof to ${boss.def.name}`, run: () => void this.finish(held, {}), at: { x: boss.pos.x, y: 1.3, z: boss.pos.z } });
    }
    const item = this.goods.nearest(REACH_ITEM);
    const near = this.people.nearestTalker(x, z);
    const npc = near?.npc ?? null;
    const board = Math.hypot(BOARD_POS.x - x, BOARD_POS.z - z);
    // E goes to what Jef looks at, nearest the crosshair: goods, a person, the board, a door
    const options: Array<[number, Action]> = [];
    if (item) {
      const d = Math.hypot(item.obj.position.x - x, item.obj.position.z - z);
      options.push([d, { key: "KeyE", text: `lift the ${GOODS[item.kind].one}`, run: () => this.lift(item), at: this.goods.middle(item) }]);
    }
    if (near) options.push([near.d, { key: "KeyE", text: `talk to ${near.npc.def.name}`, run: () => this.talk.open(near.npc), at: near.at }]);
    // M3e: anyone in the street; a thief who just robbed you can be grabbed (a wide cone: 70 degrees, so it stays playable)
    const thief = this.town?.thiefInReach(x, z);
    if (thief) options.push([-20, { key: "KeyE", text: `grab ${thief.who.def.name.split(" ")[0]}!`, run: () => void this.town!.grab(thief.who.id), at: thief.at, cone: 70 }]);
    const res = this.town?.nearestTalker(x, z, undefined, thief?.who.id);
    if (res) {
      const who = res.who;
      options.push([res.d + 0.05, { key: "KeyE", text: `talk to ${who.def.name}`, run: () => this.talk.open(who), at: res.at }]);
      if (this.talk.sells(who.id) && !(npc && this.talk.sells(npc.id))) add({ key: "KeyF", text: `buy from ${who.def.name}`, run: () => this.talk.open(who, true), at: res.at });
    }
    if (board < REACH_BOARD) options.push([board, { key: "KeyE", text: "read the hiring board", run: () => this.openBoard(), at: { x: BOARD_POS.x, y: 1.55, z: BOARD_POS.z } }]);
    const doss = Math.hypot(DOSS_POS.x - x, DOSS_POS.z - z);
    if (doss < REACH_DOSS) {
      const bed: Action = this.day.bedOpen
        ? { key: "KeyE", text: "go to bed in the doss house", run: () => void this.day.sleep(), at: DOSS_DOOR }
        : {
            key: "KeyE",
            text: "knock at the doss house",
            run: () => this.toastMsg(`The landlady opens a crack. "Beds from six in the evening. Not before." It is ${this.day.hour}:00.`),
            at: DOSS_DOOR,
          };
      options.push([doss, bed]);
    }
    for (const m of more) options.push(...(m.options ?? []));
    const top = best(options);
    if (top) add(top);
    for (const m of more) for (const a of m.extra ?? []) add(a);
    // next to a seller, F opens the wares straight away
    if (near && this.talk.sells(near.npc.id)) add({ key: "KeyF", text: `buy from ${near.npc.def.name}`, run: () => this.talk.open(near.npc, true), at: near.at });
    if (doss < REACH_DOSS && !this.day.rentPaid) {
      const price = this.payload?.rent.price_c ?? 150;
      add({ key: "KeyF", text: `pay the week's rent (${price} c)`, run: () => void this.day.rent(), at: DOSS_DOOR });
    }
    // M7 night: lie down where he stands, late at night or dead tired (last: any other G key wins)
    const h = this.day.hour;
    const sleepNeed = this.payload?.player.sleep ?? 10;
    if ((h >= 22 || h < 5 || sleepNeed <= 3) && doss >= REACH_DOSS) {
      add({ key: "KeyG", text: "lie down here and sleep rough", run: () => void this.day.sleep(api.sleepRough), self: true });
    }
    return out;
  }

  // ------------------------------------------------------------- hands

  private lift(item: Item): void {
    this.goods.lift(item, GOODS[item.kind].hold);
    this.player.speedFactor = GOODS[item.kind].speed;
    this.sfx("lift");
    if (this.run instanceof HaulRun) this.run.onLifted(item);
    // someone else's goods, and they are watching?
    if (item.owner && item.jobId === null) {
      const owner = this.people.get(item.owner);
      if (owner && owner.distTo(this.player.x, this.player.z) < OWNER_SEES) {
        owner.lookAt(this.player.x, this.player.z);
        this.toastMsg(OWNER_SHOUT[item.owner] ?? `${owner.def.name} shouts at you.`);
        this.watched = { item, owner: item.owner };
        api.witness(item.owner, "took").catch(() => {});
      }
    }
  }

  private putDown(x: number, z: number): void {
    const item = this.goods.putDown(x, z);
    if (!item) return;
    this.sfx(`thud_${GOODS[item.kind].thud}`, new THREE.Vector3(x, item.y, z));
    this.run?.onPlaced(item);
    const w = this.watched;
    if (w?.item === item) {
      this.watched = null;
      const from = item.liftedFrom;
      if (from && Math.hypot(from.x - x, from.z - z) < 2.5 && performance.now() - from.t < 15_000) {
        this.toastMsg(OWNER_CALM[w.owner] ?? "They let it go.");
        api.witness(w.owner, "returned").catch(() => {});
      }
    }
  }

  /** M7 night (game/nightlife.ts): Jef ran and let go of what he held, or a gang took it from him. */
  dropCarried(taken: boolean): void {
    const item = this.goods.carried;
    if (!item) return;
    if (taken) {
      this.goods.release();
      item.obj.removeFromParent();
      const jobItem = item.jobId !== null && item.jobId === this.active?.id;
      this.run?.onLost(item, `The gang takes the ${GOODS[item.kind].one} too.`);
      if (!jobItem) this.toastMsg(`The gang takes the ${GOODS[item.kind].one} too.`);
      return;
    }
    const [px, pz] = ahead(this.player, 0.7);
    const at = this.goods.canPlace(px, pz) && !this.world.isWater(px, pz) ? [px, pz] : [this.player.x, this.player.z];
    this.putDown(at[0], at[1]);
  }

  private drown(x: number, z: number): void {
    const item = this.goods.release();
    if (!item) return;
    item.obj.position.set(x, 0.2, z);
    this.world.scene.add(item.obj);
    this.sinking.push({ obj: item.obj, t: 0, splashed: false });
    const jobItem = item.jobId !== null && item.jobId === this.active?.id;
    this.run?.onLost(item);
    if (!jobItem) this.toastMsg("It goes over the edge. The Schelde takes it.");
  }

  private updateSinking(dt: number): void {
    for (const s of this.sinking) {
      s.t += dt;
      s.obj.position.y = s.t < 0.5 ? 0.2 - s.t * s.t * 18 : -1.8 - (s.t - 0.5) * 0.35;
      if (!s.splashed && s.obj.position.y <= -1.8) {
        s.splashed = true;
        this.sfx("splash", s.obj.position.clone());
      }
      s.obj.rotation.z += dt * 0.6;
      if (s.t > 4) this.world.scene.remove(s.obj);
    }
    this.sinking = this.sinking.filter((s) => s.t <= 4);
  }

  // ------------------------------------------------------------- pointer

  /** M7 night: the box for the proof in hand while its man is away; null once he is back at his post (the proof goes into his hand). */
  private heldBox() {
    const h = this.held;
    if (!h) return null;
    const boss = this.people.get(h.employer_npc);
    if (boss && boss.present && !this.boxes?.away(h.employer_npc)) return null;
    return this.boxes?.get(h.employer_npc) ?? null;
  }

  private pulse = 0;
  private updatePointer(dt: number): void {
    const hb = this.heldBox();
    const boss = this.held && !hb ? this.people.get(this.held.employer_npc) : null;
    const goal = hb ? new THREE.Vector3(hb.x, 0.6, hb.z) : boss ? boss.pos.clone() : (this.run?.goal() ?? null);
    const cam = this.player.camera;
    const tick = this.el.tick;
    if (!goal) {
      this.glow.material.opacity = 0;
      this.glowLight.intensity = 0;
      tick.style.opacity = "0";
      return;
    }
    const d = Math.hypot(goal.x - this.player.x, goal.z - this.player.z);
    this.pulse += dt;
    // glow hangs just above the goal; fades out when you are there
    const near = THREE.MathUtils.smoothstep(d, 1.5, 4);
    this.glow.position.set(goal.x, goal.y + 1.1 + Math.sin(this.pulse * 1.3) * 0.05, goal.z);
    this.glow.material.opacity = 0.35 * near * (0.85 + Math.sin(this.pulse * 2.1) * 0.15);
    this.glowLight.position.set(goal.x, goal.y + 1.2, goal.z);
    this.glowLight.intensity = 2.5 * near;

    // ink tick: slides along the top edge toward the goal, only when it is far or off-screen
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    const ang = Math.atan2(goal.x - this.player.x, goal.z - this.player.z) - Math.atan2(fwd.x, fwd.z);
    const a = Math.atan2(Math.sin(ang), Math.cos(ang)); // -pi..pi, + is to the left
    const x = THREE.MathUtils.clamp(-a / (Math.PI / 2), -1, 1);
    tick.style.left = `${50 + x * 42}%`;
    tick.style.opacity = d > 6 ? String(0.28 + 0.2 * Math.min(1, Math.abs(a))) : "0";
    tick.style.transform = `translateX(-50%) rotate(${Math.abs(a) > Math.PI / 2 ? (a > 0 ? 90 : -90) : 0}deg)`;
  }

  // ------------------------------------------------------------- input

  private onKey(e: KeyboardEvent): void {
    if (e.repeat || this.talk.isOpen || this.pockets.open || this.day.sheetOpen || this.map.open) return;
    if (this.boardOpen) {
      if (e.code === "KeyE" || e.code === "Escape") this.closeBoard();
      const n = Number(e.key);
      if (n >= 1 && n <= 9) void this.take(n - 1);
      return;
    }
    // the list shown may be up to a tenth of a second old: asked afresh for the key pressed
    if (!this.acts.some((a) => a.key === e.code)) return;
    this.acts = this.findActions();
    const act = this.acts.find((a) => a.key === e.code);
    if (act) act.run();
  }

  // ------------------------------------------------------------- board

  private openBoard(): void {
    this.boardOpen = true;
    this.player.frozen = true;
    this.el.board.style.display = "block";
    this.renderBoard();
  }

  private closeBoard(): void {
    this.boardOpen = false;
    this.player.frozen = false;
    this.el.board.style.display = "none";
  }

  /** Open work and your job, plus the last two finished ones. Number keys index this list. */
  private visibleJobs(): Job[] {
    // M6: an emigrant family's errand is asked in talk, not chalked on the hiring board (unless Jef has it in hand)
    // M7 night: nor is the night's work; the men who give it offer it in a low voice
    const all = (this.payload?.jobs ?? []).filter((j) => (j.source !== "emigrant" && j.source !== "night") || j.status === "taken");
    const finished = all.filter((j) => j.status === "done" || j.status === "failed").slice(-2);
    return all.filter((j) => j.status === "offered" || j.status === "taken" || finished.includes(j));
  }

  private renderBoard(): void {
    const p = this.payload;
    const b = this.el.board;
    if (!p) {
      b.innerHTML = `<h2>Work</h2><p class="note-text">The board is bare. Nobody has come by yet.</p>`;
      return;
    }
    const open = p.jobs.filter((j) => j.status === "offered");
    if (p.board.state === "writing" && open.length === 0) {
      b.innerHTML = `<h2>Work</h2><p class="note-text">A clerk is chalking up new work. Wait a moment.</p>`;
      return;
    }
    const noMore = open.filter((j) => j.source !== "night").length === 0 ? `<p class="note-text">No more work today. New work goes up at midnight.</p>` : "";
    const rows = this.visibleJobs()
      .map((j, i) => {
        const cls = j.status !== "offered" ? "gone" : j.playable ? "" : "later";
        const tag =
          j.status === "taken" ? "yours" :
          j.status === "done" ? "done" :
          j.status === "failed" ? "failed" :
          !j.playable ? "not in this build yet" : "";
        return `<li class="${cls}">
          <div class="head"><span class="n">${i + 1}</span><span class="t">${esc(j.title)}</span><span class="pay">${j.pay_c} c</span></div>
          <div class="who">${esc(j.employer_name)} &middot; ${esc(summary(j))} &middot; risk ${esc(j.risk)}${tag ? ` &middot; <b>${tag}</b>` : ""}</div>
          <div class="pitch">${esc(j.pitch)}</div>
        </li>`;
      })
      .join("");
    b.innerHTML = `<h2>Work &mdash; Rijnkaai</h2>${noMore}<ol>${rows}</ol>
      <p class="keys">Press a number to take a job &middot; E to step back</p>`;
  }

  private async take(index: number): Promise<void> {
    const j = this.visibleJobs()[index];
    if (!j || j.status !== "offered") return;
    await this.takeJob(j);
  }

  /** Dev (dev/testkit.ts): take a job by id from anywhere, as if from the board. */
  async devTake(id: number): Promise<string> {
    const p = await api.jobs();
    this.refresh(p);
    const j = p.jobs.find((x) => x.id === id);
    if (!j) return `no job ${id} today`;
    await this.takeJob(j);
    return this.active?.id === id ? `took "${j.title}"` : "not taken (see the toast)";
  }

  /** Dev: the job now running, if any. */
  get devActive(): Job | null {
    return this.active;
  }

  private taking = false;
  /** Take a job, from the board or from the person who offers it. */
  private async takeJob(j: Job): Promise<void> {
    if (this.taking) return; // the first ask is still on its way (a second key press, the board and the talk window)
    if (!j.playable) return this.toastMsg("That work is not in this build yet.");
    if (this.active) return this.toastMsg("Finish the job you have first.");
    if (this.goods.carried) return this.toastMsg("Your hands are full. Set that down first.");
    this.taking = true;
    try {
      const { job } = await api.take(j.id);
      this.closeBoard();
      this.start(job);
    } catch (e) {
      // the server's words, as a sentence ("Too late for that one: ...")
      const m = String((e as Error).message);
      this.toastMsg(`${m.charAt(0).toUpperCase()}${m.slice(1)}${/[.!?]$/.test(m) ? "" : "."}`);
    } finally {
      this.taking = false;
    }
  }

  // ------------------------------------------------------------- the running job

  private start(job: Job): void {
    // the push message and the HTTP reply can both bring the same job
    if (!job.task || this.active) return;
    this.active = job;
    const ctx: RunCtx = {
      world: this.world,
      player: this.player,
      goods: this.goods,
      people: this.people,
      pockets: this.pockets,
      refresh: (p) => this.apply(p),
      sfx: (n, at) => this.sfx(n, at),
      toast: (t) => this.toastMsg(t),
      progress: (p) => this.saveProgress(job.id, p),
      finish: (r) => void this.finish(job, r),
      box: this.boxes,
      hour: () => this.day.hour,
    };
    // the job line first; a twist may say something right after (the run toasts in its constructor)
    const t = job.task;
    const who = this.people.get(job.employer_npc)?.def.name ?? job.employer_name;
    if (t.kind === "carry") {
      const from = t.from === "ship_gangway" ? "the Anna Maria (call up at the gangway)" : SPOTS[t.from].label;
      // (M7 quest tests: "1 chests" for an emigrant's lost chest)
      this.toastMsg(`${who}: ${t.count === 1 ? `a ${GOODS[t.goods].one}` : `${t.count} ${t.goods}`} from ${from} to ${SPOTS[t.to].label}.`);
    }
    if (t.kind === "deliver") this.toastMsg(`${who} has a ${GOODS[t.goods].one} for ${t.recipient}. Get it from ${who}.`);
    this.run = makeRun(job, ctx);
  }

  /** What the paper map marks: the job's goal, people with work, the board, bed and shops. */
  private mapMarks(): MapMark[] {
    const out: MapMark[] = [];
    const goal = this.run?.goal();
    if (goal && this.active) out.push({ x: goal.x, z: goal.z, label: `your job: ${this.active.title}`, kind: "goal" });
    const t = this.active?.task;
    if (t && "to" in t && SPOTS[t.to]) out.push({ x: SPOTS[t.to].x, z: SPOTS[t.to].z, label: SPOTS[t.to].label, kind: "goal" });
    const offered = new Set((this.payload?.jobs ?? []).filter((j) => j.status === "offered" && j.playable).map((j) => j.employer_npc));
    for (const id of offered) {
      const n = this.people.get(id);
      if (n) out.push({ x: n.pos.x, z: n.pos.z, label: `work: ${n.def.name}`, kind: "work" });
    }
    out.push({ x: BOARD_POS.x, z: BOARD_POS.z, label: "hiring board", kind: "place" });
    // M7 night: the employers' boxes; the one for the proof in hand is the goal
    for (const b of this.boxes?.list ?? []) out.push({ x: b.x, z: b.z, label: `${b.name}'s box`, kind: this.held?.employer_npc === b.employer ? "goal" : "place" });
    out.push({ x: DOSS_POS.x, z: DOSS_POS.z, label: "doss house", kind: "bed" });
    const shops: Array<[string, string]> = [["fientje", "Fientje's fish"], ["peeters", "the chandlery"], ["tuur", "Tuur's jenever"]];
    for (const [id, label] of shops) {
      const n = this.people.get(id);
      if (n && !offered.has(id)) out.push({ x: n.pos.x, z: n.pos.z, label, kind: "shop" });
    }
    // the town's shops and taverns (M3e)
    const d = this.town?.data;
    if (d) {
      for (const sh of d.shops) out.push({ x: sh.door[0], z: sh.door[1], label: sh.label, kind: "shop" });
      for (const [id, pl] of Object.entries(d.places)) if (id.startsWith("tavern:")) out.push({ x: pl.x, z: pl.z, label: pl.label, kind: "shop" });
    }
    return out;
  }

  /** Stop the running job without settling it (the server already closed it). */
  private dropRun(): void {
    const id = this.active?.id;
    this.run?.dispose();
    this.run = null;
    this.active = null;
    this.held = null;
    if (id !== undefined) this.goods.clearJob(id);
    if (!this.goods.carried) this.player.speedFactor = 1;
  }

  private saveProgress(id: number, p: Progress): void {
    api.progress(id, p).catch(() => {});
  }

  /** M7 night: may this job's pay wait for the employer's box (a day employer with a box, now at home)? */
  private boxFor(job: Job): boolean {
    const b = this.boxes;
    return !!b && job.source !== "night" && b.has(job.employer_npc) && b.away(job.employer_npc);
  }

  /** M7 night: the job's proof waits for the box (after a reload too): no run, the pointer on the box. */
  private holdFor(job: Job): void {
    this.run?.dispose();
    this.run = null;
    this.active = job;
    this.held = job;
  }

  private async finish(job: Job, report: Report): Promise<void> {
    if (this.finishing) return;
    // M7 night: the work is done but the employer has gone home: the proof for his box, the pay from it
    if (!this.held && !report.box && this.boxFor(job)) {
      this.finishing = true;
      try {
        await api.hold(job.id, report);
        this.holdFor(job);
        const b = this.boxes!.get(job.employer_npc)!;
        this.toastMsg(`The work is done. ${b.name} has gone home for the night: drop the proof in the box ${b.label}, and take your pay from it.`);
      } catch (e) {
        this.toastMsg(`Not settled: ${(e as Error).message}`);
      } finally {
        this.finishing = false;
      }
      return;
    }
    this.finishing = true;
    try {
      const r = await api.done(job.id, report);
      const s = r.settlement;
      const parts = report.box
        ? [s.pay_c ? `From ${job.employer_name}'s box: ${s.pay_c} c` : `${job.employer_name}'s box holds nothing for you`]
        : [s.pay_c ? `${job.employer_name} pays ${s.pay_c} c` : `${job.employer_name} pays nothing`];
      // (a sale, a bribe, a tip, or the pockets filled from a broken load: not all "from other hands")
      if (s.extra_c) parts.push(`and ${s.extra_c} c on the side`);
      this.toastMsg(parts.join(", ") + ".");
      this.el.hud.textContent = `${r.money_c} c`;
      this.el.note.classList.add("waiting");
    } catch (e) {
      this.toastMsg(`Not settled: ${(e as Error).message}`);
    } finally {
      this.finishing = false;
      this.run?.dispose();
      this.run = null;
      this.active = null;
      this.held = null;
    }
  }

  private noteTimer = 0;
  private showOutcome(o: OutcomeMsg): void {
    const n = this.el.note;
    n.classList.remove("waiting");
    n.innerHTML = `<span class="who">${esc(o.employer)}</span>${esc(o.text)}`;
    n.style.opacity = "1";
    clearTimeout(this.noteTimer);
    this.noteTimer = window.setTimeout(() => (n.style.opacity = "0"), 11000);
  }

  // ------------------------------------------------------------- HUD

  private lastTask = "";
  private renderTask(): void {
    const hb = this.heldBox();
    const html = this.held
      ? `<b>${esc(this.held.title)}</b><br>The work is done.<br>${hb ? `Drop the proof in ${esc(hb.name)}'s box ${esc(hb.label)}` : `Take the proof to ${esc(this.held.employer_name)}`}`
      : this.nightNote(this.run?.hud() ?? "");
    if (html === this.lastTask) return;
    this.lastTask = html;
    this.el.task.innerHTML = html;
    this.el.task.style.display = html ? "block" : "none";
  }

  /** M7 night: the night's work says when it must be done (the man who gave it is gone at 5:00). */
  private nightNote(html: string): string {
    if (!html || this.active?.source !== "night") return html;
    return `${html}<br>Done before five, or not at all`;
  }

  private toastTimer = 0;
  private toastMsg(text: string): void {
    this.el.toast.textContent = text;
    this.el.toast.style.opacity = "1";
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.el.toast.style.opacity = "0"), 5500);
  }

  /** Say something at the bottom of the screen (M3e: the town's thieves). */
  say(text: string): void {
    this.toastMsg(text);
  }

  /** New server state from elsewhere (M3e: a pocket picked, a thief caught). */
  refresh(p: JobsPayload): void {
    this.apply(p);
  }

  /** Dev hook: state for scripted checks. */
  debug() {
    return {
      board: this.payload?.board,
      jobs: this.payload?.jobs.map((j) => ({ id: j.id, title: j.title, type: j.task_type, employer: j.employer_npc, status: j.status, playable: j.playable, task: j.task })),
      active: this.active?.id ?? null,
      held: this.held?.id ?? null,
      actions: this.acts.map((a) => `${a.key}:${a.text}`),
      goal: this.run?.goal()?.toArray().map((v) => +v.toFixed(2)) ?? null,
      hud: this.el.task.innerText,
      money: this.payload?.player.money_c,
      toast: this.el.toast.innerText,
      note: this.el.note.innerText,
      carrying: this.goods.carried ? `${this.goods.carried.kind}${this.goods.carried.jobId ? " (job)" : ""}` : null,
      items: this.goods.items.length,
      playerY: +this.player.y.toFixed(2),
    };
  }
}

function summary(j: Job): string {
  const t = j.task;
  if (!t) return j.task_type;
  const urgent = "limit_s" in t && t.limit_s ? ", before the bell" : "";
  if (t.kind === "carry") return `carry ${t.count} ${t.goods}, ${SPOTS[t.from].label} to ${SPOTS[t.to].label}${urgent}`;
  if (t.kind === "deliver") return `deliver a ${GOODS[t.goods].one} to ${t.recipient}${urgent}`;
  if (t.kind === "letters") return t.stops.some((s) => s.what === "telegraph") ? `send a telegram${t.city ? ` to ${t.city}` : ""}` : `${t.stops.length === 1 ? "a letter" : `${t.stops.length} letters`} to doors about the town`;
  return `watch the ${t.goods} at ${SPOTS[t.post].label}`;
}

function div(cls: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = cls;
  return d;
}
