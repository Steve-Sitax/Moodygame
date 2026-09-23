import * as THREE from "three";
import { api, connectPush, type Job, type JobsPayload, type OutcomeMsg, type Progress, type Report } from "../net/api";
import { BOARD_POS, SPOTS, type World } from "../world/rijnkaai";
import type { FirstPerson } from "../player/firstPerson";
import { glowTexture } from "../world/textures";
import { GOODS, type Goods } from "./props";
import { GoodsWorld, ahead, type Item } from "./goods";
import { People } from "./people";
import { Talk } from "./talk";
import { Pockets } from "./pockets";
import { esc, HaulRun, makeRun, type Action, type Run, type RunCtx, type Sfx } from "./runs";

// The hands and the job (M2, M2b, M3). Everything you do with E and F goes
// through here: lift, set down, stack, drop in the Schelde, talk, read the
// board, and the job's own actions. The server decides pay, task and trust.

const REACH_BOARD = 2.6;
const REACH_ITEM = 1.8;
const OWNER_SEES = 12;

/** Goods that belong to people, lying about the quay from the start. */
const OWNED: Array<{ kind: Goods; owner: string; at: Array<[number, number]> }> = [
  { kind: "crates", owner: "sooi", at: [[-19.2, 18.4], [-18.4, 18.4], [-19.2, 18.4], [-18.8, 17.5]] },
  { kind: "barrels", owner: "peeters", at: [[24.8, 17.6], [25.6, 17.6], [25.2, 16.8]] },
  { kind: "barrels", owner: "tuur", at: [[7.7, -5.2], [6.9, -5.2]] },
  { kind: "sacks", owner: "fientje", at: [[44.3, 12.4], [44.3, 13.1]] },
];

/** What an owner shouts when Jef lifts their goods under their nose. */
const OWNER_SHOUT: Record<string, string> = {
  sooi: `Sooi: "Hé! That's natie goods, jongen. Put it down or I'll put you down."`,
  peeters: `Widow Peeters: "Thief! Those are mine. Put it back this instant!"`,
  tuur: `Tuur: "Hands off, maat. That's not yours to carry."`,
  fientje: `Fientje: "Oi! Fingers off my baskets, manneke!"`,
};
const OWNER_CALM: Record<string, string> = {
  sooi: `Sooi grunts. "Goed. Keep your hands to your own work."`,
  peeters: `The widow sniffs. "Hm. See that it stays there."`,
  tuur: `Tuur nods slowly. "Wise."`,
  fientje: `"That's better, schat. I'd have told the whole Vismarkt."`,
};

export class Jobs {
  private payload: JobsPayload | null = null;
  private active: Job | null = null;
  private run: Run | null = null;
  private acts: Action[] = [];
  private boardOpen = false;
  private finishing = false;
  sfx: (name: Sfx, at?: THREE.Vector3) => void = () => {};

  readonly goods: GoodsWorld;
  readonly people: People;
  readonly talk: Talk;
  readonly pockets: Pockets;
  private sinking: Array<{ obj: THREE.Object3D; t: number; splashed: boolean }> = [];
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
    this.el.board.style.display = "none";
    this.el.tick.textContent = "▾";
    // carried goods hang in front of the camera, so the camera joins the scene
    world.scene.add(player.camera);

    this.goods = new GoodsWorld(world, player);
    this.people = new People(world);
    this.talk = new Talk(player);
    this.pockets = new Pockets(player, this.el.hud);
    this.pockets.toast = (t) => this.toastMsg(t);
    this.pockets.onChange = (p) => this.apply(p);
    this.talk.onBought = (p, line) => {
      this.apply(p);
      this.toastMsg(line);
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
    // pick up a job that is already taken (reload in the middle of a job)
    const taken = p.jobs.find((j) => j.status === "taken") ?? null;
    if (taken && !this.active) this.start(taken);
    if (this.boardOpen) this.renderBoard();
  }

  // ------------------------------------------------------------- per frame

  update(dt: number): void {
    this.run?.update(dt);
    this.people.update(dt, this.player);
    this.updateSinking(dt);
    this.acts = this.findActions();
    const text = this.boardOpen || this.talk.isOpen || this.pockets.open ? "" : this.acts.map((a) => `${a.key.slice(3)}  ${a.text}`).join("     ");
    if (this.el.prompt.textContent !== text) this.el.prompt.textContent = text;
    this.el.prompt.style.display = text ? "block" : "none";
    this.renderTask();
    this.updatePointer(dt);
  }

  /** Everything E and F can do right now, most specific first. */
  private findActions(): Action[] {
    if (this.boardOpen || this.talk.isOpen || this.pockets.open) return [];
    const { x, z } = this.player;
    const out: Action[] = [];
    const add = (a: Action) => {
      if (!out.some((o) => o.key === a.key)) out.push(a);
    };
    const carried = this.goods.carried;

    if (carried) {
      for (const a of this.run?.carryActions(carried) ?? []) add(a);
      const [px, pz] = ahead(this.player, 0.95);
      if (this.world.isWater(px, pz)) add({ key: "KeyE", text: "let it fall into the Schelde", run: () => this.drown(px, pz) });
      else {
        const where = this.goods.canPlace(px, pz);
        if (where) {
          const label = this.run?.placeLabel(carried, px, pz) ?? (where === "stack" ? "stack it" : "set it down");
          add({ key: "KeyE", text: label, run: () => this.putDown(px, pz) });
        }
      }
      return out;
    }

    for (const a of this.run?.actions() ?? []) add(a);
    const item = this.goods.nearest(REACH_ITEM);
    const npc = this.people.nearestTalker(x, z);
    const board = Math.hypot(BOARD_POS.x - x, BOARD_POS.z - z);
    // E goes to what is closest: goods, a person, or the board
    const options: Array<[number, Action]> = [];
    if (item) {
      const d = Math.hypot(item.obj.position.x - x, item.obj.position.z - z);
      options.push([d, { key: "KeyE", text: `lift the ${GOODS[item.kind].one}`, run: () => this.lift(item) }]);
    }
    if (npc) options.push([npc.distTo(x, z), { key: "KeyE", text: `talk to ${npc.def.name}`, run: () => this.talk.open(npc) }]);
    if (board < REACH_BOARD) options.push([board, { key: "KeyE", text: "read the hiring board", run: () => this.openBoard() }]);
    options.sort((a, b) => a[0] - b[0]);
    if (options.length) add(options[0][1]);
    // next to a seller, F opens the wares straight away
    if (npc && this.talk.sells(npc.id)) add({ key: "KeyF", text: `buy from ${npc.def.name}`, run: () => this.talk.open(npc, true) });
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

  private pulse = 0;
  private updatePointer(dt: number): void {
    const goal = this.run?.goal() ?? null;
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
    if (e.repeat || this.talk.isOpen || this.pockets.open) return;
    if (this.boardOpen) {
      if (e.code === "KeyE" || e.code === "Escape") this.closeBoard();
      const n = Number(e.key);
      if (n >= 1 && n <= 9) void this.take(n - 1);
      return;
    }
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
    const all = this.payload?.jobs ?? [];
    const finished = all.filter((j) => j.status === "done" || j.status === "failed").slice(-2);
    return all.filter((j) => j.status === "offered" || j.status === "taken" || finished.includes(j));
  }

  private renderBoard(): void {
    const p = this.payload;
    const b = this.el.board;
    if (!p) {
      b.innerHTML = `<h2>Werk</h2><p class="note-text">The board is bare. Nobody has come by yet.</p>`;
      return;
    }
    const open = p.jobs.filter((j) => j.status === "offered");
    if (p.board.state === "writing" && open.length === 0) {
      b.innerHTML = `<h2>Werk</h2><p class="note-text">A clerk is chalking up new work. Wait a moment.</p>`;
      return;
    }
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
    b.innerHTML = `<h2>Werk &mdash; Rijnkaai</h2><ol>${rows}</ol>
      <p class="keys">Press a number to take a job &middot; E to step back</p>`;
  }

  private async take(index: number): Promise<void> {
    const j = this.visibleJobs()[index];
    if (!j || j.status !== "offered") return;
    if (!j.playable) return this.toastMsg("That work is not in this build yet.");
    if (this.active) return this.toastMsg("Finish the job you have first.");
    if (this.goods.carried) return this.toastMsg("Your hands are full. Set that down first.");
    try {
      const { job } = await api.take(j.id);
      this.closeBoard();
      this.start(job);
    } catch (e) {
      this.toastMsg(String((e as Error).message));
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
    };
    // the job line first; a twist may say something right after (the run toasts in its constructor)
    const t = job.task;
    const who = this.people.get(job.employer_npc)?.def.name ?? job.employer_name;
    if (t.kind === "carry") {
      const from = t.from === "ship_gangway" ? "the Anna Maria (call up at the gangway)" : SPOTS[t.from].label;
      this.toastMsg(`${who}: ${t.count} ${t.goods} from ${from} to ${SPOTS[t.to].label}.`);
    }
    if (t.kind === "deliver") this.toastMsg(`${who} has a ${GOODS[t.goods].one} for ${t.recipient}. Get it from ${who}.`);
    this.run = makeRun(job, ctx);
  }

  private saveProgress(id: number, p: Progress): void {
    api.progress(id, p).catch(() => {});
  }

  private async finish(job: Job, report: Report): Promise<void> {
    if (this.finishing) return;
    this.finishing = true;
    try {
      const r = await api.done(job.id, report);
      const s = r.settlement;
      const parts = [s.pay_c ? `${job.employer_name} pays ${s.pay_c} c` : `${job.employer_name} pays nothing`];
      if (s.extra_c) parts.push(`${s.extra_c} c from other hands`);
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
    const html = this.run?.hud() ?? "";
    if (html === this.lastTask) return;
    this.lastTask = html;
    this.el.task.innerHTML = html;
    this.el.task.style.display = html ? "block" : "none";
  }

  private toastTimer = 0;
  private toastMsg(text: string): void {
    this.el.toast.textContent = text;
    this.el.toast.style.opacity = "1";
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.el.toast.style.opacity = "0"), 5500);
  }

  /** Dev hook: state for scripted checks. */
  debug() {
    return {
      board: this.payload?.board,
      jobs: this.payload?.jobs.map((j) => ({ id: j.id, title: j.title, type: j.task_type, employer: j.employer_npc, status: j.status, playable: j.playable, task: j.task })),
      active: this.active?.id ?? null,
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
  return `watch the ${t.goods} at ${SPOTS[t.post].label}`;
}

function div(cls: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = cls;
  return d;
}
