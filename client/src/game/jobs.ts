import * as THREE from "three";
import { api, connectPush, type Job, type JobsPayload } from "../net/api";
import { BOARD_POS, SPOTS, type World } from "../world/rijnkaai";
import { box, rectAround, type Rect } from "../world/geom";
import type { FirstPerson } from "../player/firstPerson";

// Job board and the carry job (M2). The server decides pay and task.
// This file only plays the task in 3D and reports the result.

const CRATE = 0.7;
const REACH_BOARD = 2.6;
const REACH_CRATE = 1.7;
const REACH_DROP = 2.2;
const CARRY_SPEED = 0.62; // docs/06: heavy items slow you

interface LooseCrate {
  mesh: THREE.Mesh;
  rect: Rect;
}

type Target = { kind: "board" } | { kind: "crate"; crate: LooseCrate } | { kind: "drop" } | null;

export class Jobs {
  private payload: JobsPayload | null = null;
  private active: Job | null = null;
  private loose: LooseCrate[] = [];
  private stacked: THREE.Mesh[] = [];
  private carried: THREE.Mesh | null = null;
  private delivered = 0;
  private dropMark: THREE.Mesh | null = null;
  private target: Target = null;
  private boardOpen = false;
  private finishing = false;

  private readonly el = {
    prompt: div("prompt"),
    hud: div("hud"),
    task: div("task"),
    toast: div("toast"),
    board: div("board paper"),
  };

  constructor(
    private readonly world: World,
    private readonly player: FirstPerson,
  ) {
    for (const e of Object.values(this.el)) document.body.appendChild(e);
    this.el.board.style.display = "none";
    // the carried crate hangs in front of the camera, so the camera joins the scene
    world.scene.add(player.camera);

    window.addEventListener("keydown", (e) => this.onKey(e));
    connectPush((p) => this.apply(p));
    api.jobs().then((p) => this.apply(p)).catch(() => this.toastMsg("The hiring board is not reachable. Is the server running?"));
  }

  // ------------------------------------------------------------- server data

  private apply(p: JobsPayload): void {
    this.payload = p;
    this.el.hud.textContent = `${p.player.money_c} c`;
    // pick up a job that is already taken (reload in the middle of a job)
    const taken = p.jobs.find((j) => j.status === "taken") ?? null;
    if (taken && !this.active) this.start(taken);
    if (this.boardOpen) this.renderBoard();
    this.renderTask();
  }

  // ------------------------------------------------------------- per frame

  update(): void {
    this.target = this.findTarget();
    const t = this.target;
    const text =
      this.boardOpen ? "" :
      t?.kind === "board" ? "E  read the hiring board" :
      t?.kind === "crate" ? "E  lift the crate" :
      t?.kind === "drop" ? "E  set it down" :
      "";
    if (this.el.prompt.textContent !== text) this.el.prompt.textContent = text;
    this.el.prompt.style.display = text ? "block" : "none";
  }

  private findTarget(): Target {
    const { x, z } = this.player;
    const d = (px: number, pz: number) => Math.hypot(px - x, pz - z);
    if (this.carried && this.active?.task) {
      const to = SPOTS[this.active.task.to];
      if (d(to.x, to.z) < REACH_DROP) return { kind: "drop" };
      return null;
    }
    if (!this.carried) {
      let best: LooseCrate | null = null;
      let bestD = REACH_CRATE;
      for (const c of this.loose) {
        const dd = d(c.mesh.position.x, c.mesh.position.z);
        if (dd < bestD) {
          best = c;
          bestD = dd;
        }
      }
      if (best) return { kind: "crate", crate: best };
    }
    if (d(BOARD_POS.x, BOARD_POS.z) < REACH_BOARD) return { kind: "board" };
    return null;
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
    if (e.code !== "KeyE") return;
    const t = this.target;
    if (t?.kind === "board") this.openBoard();
    else if (t?.kind === "crate") this.lift(t.crate);
    else if (t?.kind === "drop") this.drop();
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
      b.innerHTML = `<h2>Werk</h2><p class="note">The board is bare. Nobody has come by yet.</p>`;
      return;
    }
    if (p.board.state === "writing" && p.jobs.length === 0) {
      b.innerHTML = `<h2>Werk</h2><p class="note">A clerk is still chalking the board. Wait a moment.</p>`;
      return;
    }
    const rows = p.jobs
      .map((j, i) => {
        const cls = j.status !== "offered" ? "gone" : j.playable ? "" : "later";
        const tag =
          j.status === "taken" ? "yours" :
          j.status === "done" ? "done" :
          !j.playable ? "not in this build yet" : "";
        return `<li class="${cls}">
          <div class="head"><span class="n">${i + 1}</span><span class="t">${esc(j.title)}</span><span class="pay">${j.pay_c} c</span></div>
          <div class="who">${esc(j.employer_name)} &middot; ${esc(j.task_type)} &middot; risk ${esc(j.risk)}${tag ? ` &middot; <b>${tag}</b>` : ""}</div>
          <div class="pitch">${esc(j.pitch)}</div>
        </li>`;
      })
      .join("");
    b.innerHTML = `<h2>Werk &mdash; Rijnkaai</h2><ol>${rows}</ol>
      <p class="keys">Press a number to take a job &middot; E to step back</p>`;
  }

  private async take(index: number): Promise<void> {
    const j = this.payload?.jobs[index];
    if (!j || j.status !== "offered") return;
    if (!j.playable) return this.toastMsg("That work is not in this build yet.");
    if (this.active) return this.toastMsg("Finish the job you have first.");
    try {
      const { job } = await api.take(j.id);
      this.closeBoard();
      this.start(job);
      const t = job.task!;
      this.toastMsg(`${job.employer_name}: ${t.crates} crates from ${SPOTS[t.from].label} to ${SPOTS[t.to].label}.`);
    } catch (e) {
      this.toastMsg(String((e as Error).message));
    }
  }

  // ------------------------------------------------------------- carry job

  private start(job: Job): void {
    // the push message and the HTTP reply can both bring the same job
    if (!job.task || this.active) return;
    this.active = job;
    this.delivered = 0;
    const from = SPOTS[job.task.from];
    const to = SPOTS[job.task.to];
    const [dx, dz] = from.dir;
    // two columns, stacking away from the spot
    for (let i = 0; i < job.task.crates; i++) {
      const side = (i % 2 ? 1 : -1) * 0.5;
      const along = Math.floor(i / 2) * 0.95;
      const x = from.x + dx * along + -dz * side;
      const z = from.z + dz * along + dx * side;
      const mesh = box(CRATE, CRATE, CRATE, this.world.mats.crate, x, CRATE / 2, z, 0.7);
      mesh.rotation.y = (i * 0.37) % 0.3;
      this.world.scene.add(mesh);
      const rect = rectAround(x, z, CRATE / 2, CRATE / 2);
      this.world.addCollider(rect);
      this.loose.push({ mesh, rect });
    }
    // chalk mark where the crates go
    const mark = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 12), this.world.mats.chalk);
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(to.x, 0.02, to.z);
    this.world.scene.add(mark);
    this.dropMark = mark;
    this.renderTask();
  }

  private lift(c: LooseCrate): void {
    this.loose = this.loose.filter((l) => l !== c);
    this.world.removeCollider(c.rect);
    this.world.scene.remove(c.mesh);
    // held low in both arms, in front of the eyes
    c.mesh.position.set(0, -0.72, -0.86);
    c.mesh.rotation.set(0.05, 0.08, 0);
    this.player.camera.add(c.mesh);
    this.carried = c.mesh;
    this.player.speedFactor = CARRY_SPEED;
    this.renderTask();
  }

  private drop(): void {
    const job = this.active;
    if (!this.carried || !job?.task) return;
    const to = SPOTS[job.task.to];
    const mesh = this.carried;
    this.player.camera.remove(mesh);
    const n = this.delivered;
    const [dx, dz] = to.dir;
    const layer = Math.floor(n / 3);
    const slot = n % 3;
    const off = (slot - 1) * (CRATE + 0.05);
    mesh.position.set(to.x + dx * off, CRATE / 2 + layer * CRATE, to.z + dz * off);
    mesh.rotation.set(0, (n * 0.23) % 0.2, 0);
    this.world.scene.add(mesh);
    this.stacked.push(mesh);
    this.carried = null;
    this.player.speedFactor = 1;
    this.delivered++;
    this.renderTask();
    if (this.delivered >= job.task.crates) void this.finish();
  }

  private async finish(): Promise<void> {
    const job = this.active;
    if (!job || this.finishing) return;
    this.finishing = true;
    try {
      const r = await api.done(job.id, this.delivered);
      this.toastMsg(`${job.employer_name} counts the crates. Paid ${r.paid_c} centimes.`);
      this.el.hud.textContent = `${r.money_c} c`;
      this.clearJob();
    } catch (e) {
      this.toastMsg(`Not paid: ${(e as Error).message}`);
    } finally {
      this.finishing = false;
    }
  }

  private clearJob(): void {
    this.active = null;
    if (this.dropMark) this.world.scene.remove(this.dropMark);
    this.dropMark = null;
    // delivered crates stay a while, then the natie takes them in
    const old = this.stacked;
    this.stacked = [];
    setTimeout(() => old.forEach((m) => this.world.scene.remove(m)), 60_000);
    this.renderTask();
  }

  // ------------------------------------------------------------- HUD

  private renderTask(): void {
    const j = this.active;
    if (!j?.task) {
      this.el.task.style.display = "none";
      return;
    }
    const t = j.task;
    const step = this.carried ? `Bring it to ${SPOTS[t.to].label}` : `Fetch a crate at ${SPOTS[t.from].label}`;
    this.el.task.innerHTML = `<b>${esc(j.title)}</b><br>${step}<br>Crates ${this.delivered} / ${t.crates} &middot; ${j.pay_c} c`;
    this.el.task.style.display = "block";
  }

  private toastTimer = 0;
  private toastMsg(text: string): void {
    this.el.toast.textContent = text;
    this.el.toast.style.opacity = "1";
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.el.toast.style.opacity = "0"), 5000);
  }

  /** Dev hook: state for scripted checks. */
  debug() {
    return {
      board: this.payload?.board,
      jobs: this.payload?.jobs.map((j) => ({ id: j.id, title: j.title, status: j.status, playable: j.playable, task: j.task })),
      active: this.active?.id ?? null,
      loose: this.loose.map((c) => [+c.mesh.position.x.toFixed(2), +c.mesh.position.z.toFixed(2)]),
      carrying: !!this.carried,
      delivered: this.delivered,
      money: this.payload?.player.money_c,
      target: this.target?.kind ?? null,
    };
  }
}

function div(cls: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = cls;
  return d;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
