import * as THREE from "three";
import { api, connectPush, type Job, type JobsPayload, type OutcomeMsg, type Progress, type Report } from "../net/api";
import { BOARD_POS, SPOTS, type World } from "../world/rijnkaai";
import type { FirstPerson } from "../player/firstPerson";
import { glowTexture } from "../world/textures";
import { GOODS } from "./props";
import { esc, makeRun, type Action, type Run, type RunCtx, type Sfx } from "./runs";

// Job board and the running job (M2, M2b). The server decides pay, task and
// trust. This file shows the board, plays the task in 3D, and reports back.

const REACH_BOARD = 2.6;

export class Jobs {
  private payload: JobsPayload | null = null;
  private active: Job | null = null;
  private run: Run | null = null;
  private acts: Action[] = [];
  private boardOpen = false;
  private finishing = false;
  sfx: (name: Sfx, at?: THREE.Vector3) => void = () => {};

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
    // pick up a job that is already taken (reload in the middle of a job)
    const taken = p.jobs.find((j) => j.status === "taken") ?? null;
    if (taken && !this.active) this.start(taken);
    if (this.boardOpen) this.renderBoard();
  }

  // ------------------------------------------------------------- per frame

  update(dt: number): void {
    this.run?.update(dt);
    this.acts = this.findActions();
    const text = this.boardOpen ? "" : this.acts.map((a) => `${a.key.slice(3)}  ${a.text}`).join("     ");
    if (this.el.prompt.textContent !== text) this.el.prompt.textContent = text;
    this.el.prompt.style.display = text ? "block" : "none";
    this.renderTask();
    this.updatePointer(dt);
  }

  private findActions(): Action[] {
    if (this.boardOpen) return [];
    const acts = this.run?.actions() ?? [];
    const busy = new Set(acts.map((a) => a.key));
    if (!busy.has("KeyE") && Math.hypot(BOARD_POS.x - this.player.x, BOARD_POS.z - this.player.z) < REACH_BOARD) {
      acts.push({ key: "KeyE", text: "read the hiring board", run: () => this.openBoard() });
    }
    return acts;
  }

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
    this.glow.position.set(goal.x, 1.1 + Math.sin(this.pulse * 1.3) * 0.05, goal.z);
    this.glow.material.opacity = 0.35 * near * (0.85 + Math.sin(this.pulse * 2.1) * 0.15);
    this.glowLight.position.set(goal.x, 1.2, goal.z);
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
    if (e.repeat) return;
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

  /** Open work and your job, plus the last two finished ones. Number keys index this list. */
  private visibleJobs(): Job[] {
    const all = this.payload?.jobs ?? [];
    const finished = all.filter((j) => j.status === "done" || j.status === "failed").slice(-2);
    return all.filter((j) => j.status === "offered" || j.status === "taken" || finished.includes(j));
  }

  private async take(index: number): Promise<void> {
    const j = this.visibleJobs()[index];
    if (!j || j.status !== "offered") return;
    if (!j.playable) return this.toastMsg("That work is not in this build yet.");
    if (this.active) return this.toastMsg("Finish the job you have first.");
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
      sfx: (n, at) => this.sfx(n, at),
      toast: (t) => this.toastMsg(t),
      progress: (p) => this.saveProgress(job.id, p),
      finish: (r) => void this.finish(job, r),
    };
    // the job line first; a twist may say something right after (the run toasts in its constructor)
    const t = job.task;
    if (t.kind === "carry") this.toastMsg(`${job.employer_name}: ${t.count} ${t.goods} from ${SPOTS[t.from].label} to ${SPOTS[t.to].label}.`);
    if (t.kind === "deliver") this.toastMsg(`${job.employer_name} hands you a ${GOODS[t.goods].one} for ${t.recipient}.`);
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
      this.el.note.textContent = "…";
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
      jobs: this.payload?.jobs.map((j) => ({ id: j.id, title: j.title, type: j.task_type, status: j.status, playable: j.playable, task: j.task })),
      active: this.active?.id ?? null,
      actions: this.acts.map((a) => `${a.key}:${a.text}`),
      goal: this.run?.goal()?.toArray().map((v) => +v.toFixed(2)) ?? null,
      hud: this.el.task.innerText,
      money: this.payload?.player.money_c,
      toast: this.el.toast.innerText,
      note: this.el.note.innerText,
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
