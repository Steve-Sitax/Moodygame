import * as THREE from "three";
import "./ideas.css";
import type { JobsPayload, PocketItem, PushMsg } from "../net/api";
import type { FirstPerson } from "../player/firstPerson";
import type { World } from "../world/rijnkaai";
import { psx } from "../retro/psx";
import { AI_BILL } from "../../../shared/posterWalls";
import { esc, type Action } from "./runs";
import { chest } from "./facing";
import type { Jobs } from "./jobs";
import type { Town } from "./town";
import type { Press } from "./press";
import { Figure } from "./figures";
import { makeAnimal, type Animal, type AnimalKind } from "./animals";
import { dialogs } from "./dialogs";

const DOGS = ["dog_brown", "dog_black", "dog_spotted", "dog_grey"];
const dogKind = (look?: string): AnimalKind => (DOGS.includes(look ?? "") ? look : "dog_brown") as AnimalKind;

// The M6 AI ideas on the client. The server owns every fact and number (server/src/ideas/);
// this side shows them: printed bills on the walls (E reads one large), lost things and
// notebooks lying in the street (E picks up; E at the owner's door gives back; G squeezes),
// a letter of Jef's own at the post counter (G), a meeting at a door, and the trouble on a
// running job (a scene with 2 or 3 choices, and a place to walk to).

interface Spot {
  id: string;
  label: string;
  x: number;
  z: number;
  out: [number, number];
  at: [number, number];
}
interface PosterV {
  id: number;
  kind: string;
  spot: Spot;
  day: number;
  text: { heading: string; body: string; footer: string };
  names_jef: boolean;
  reward_c: number;
  source: string;
}
interface LostV {
  poster: number;
  what: string;
  dog: { name: string; look: string } | null;
  x: number;
  z: number;
  state: "lying" | "held";
  owner: string | null;
  owner_name: string | null;
  door: [number, number] | null;
  reward_c: number;
}
interface DiaryV {
  id: number;
  status: "lying" | "held";
  x: number;
  z: number;
  owner: string;
  owner_name: string;
  door: [number, number] | null;
}
interface MeetingV {
  id: number;
  who: string;
  name: string;
  from_h: number;
  to_h: number;
  x: number;
  z: number;
  label: string;
}
interface TroubleV {
  id: number;
  job_id: number;
  kind: string;
  after_s: number;
  status: "ready" | "chosen" | "settled";
  source: string;
  scene: string;
  lines: Array<{ name: string; who: string | null; text: string }>;
  options: Array<{ n: number; label: string; step: { x: number; z: number; label: string } | null }>;
  choice: number | null;
  result: string | null;
  step: { x: number; z: number; label: string } | null;
  step_done: boolean;
}
interface IdeasView {
  posters: PosterV[];
  lost: LostV[];
  diaries: DiaryV[];
  meetings: MeetingV[];
  trouble: TroubleV | null;
  news: { text: string } | null;
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
const REACH_READ = 2.4;
const REACH_THING = 1.9;
const REACH_DOOR = 2.6;
const REACH_COUNTER = 3.2;

/** M7 posters: the printer's woodcuts (world/posterArt.ts, public/textures/poster_cuts.png): a picture under the heading. */
const CUTS = typeof Image !== "undefined" ? new Image() : null;
if (CUTS) CUTS.src = "/textures/poster_cuts.png";
/** The cut on each kind of bill (the sheet's 4 x 4 cells, by row). */
const CUT_OF: Record<string, number> = { wanted: 13, sailing: 0, auction: 3, order: 7, lost: 3 };

/** A bill as a texture: a heading in big type, the body in small, the foot line. */
function billTexture(p: PosterV): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 176;
  const g = c.getContext("2d")!;
  // (M7 posters: the coloured papers of the town's bills, world/posterArt.ts: a wanted bill on yellow, a sailing on blue, a sale on pink)
  const paper = p.kind === "wanted" ? "#e6cf78" : p.kind === "lost" ? "#e9e4d3" : p.kind === "sailing" ? "#b9c9d6" : p.kind === "auction" ? "#e7b4ae" : "#e9e4d3";
  g.fillStyle = paper;
  g.fillRect(0, 0, 128, 176);
  g.fillStyle = "rgba(90,70,40,0.18)";
  for (let i = 0; i < 40; i++) g.fillRect(Math.random() * 128, Math.random() * 176, 2, 1);
  g.strokeStyle = "#2a2420";
  g.lineWidth = 2;
  g.strokeRect(4, 4, 120, 168);
  g.fillStyle = "#1e1a16";
  g.textAlign = "center";
  const words = p.text.heading.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  g.font = '900 19px "Scheldemist Slab", Impact, "Arial Black", sans-serif';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (g.measureText(t).width > 112 && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  let y = 26;
  for (const l of lines.slice(0, 3)) {
    g.fillText(l, 64, y);
    y += 19;
  }
  // the woodcut (a steamer on a sailing bill, a face on a wanted bill), when the sheet is loaded
  const cut = CUT_OF[p.kind];
  if (CUTS?.complete && CUTS.naturalWidth && cut !== undefined && y < 110) {
    const cs = CUTS.naturalWidth / 4;
    g.save();
    g.globalCompositeOperation = "multiply";
    g.drawImage(CUTS, (cut % 4) * cs, Math.floor(cut / 4) * cs, cs, cs, 64 - 22, y - 8, 44, 44);
    g.restore();
    y += 40;
  }
  // the body as rows of grey print: unreadable from afar, as a bill is
  g.fillStyle = "rgba(30,26,22,0.55)";
  for (let r = 0; r < 9 && y < 160; r++, y += 9) g.fillRect(14 + (r % 3) * 2, y, 100 - (r % 4) * 8, 3);
  if (p.reward_c) {
    g.fillStyle = "#1e1a16";
    g.font = "bold 13px 'Scheldemist Print', Georgia, serif";
    g.fillText(`${p.reward_c} c`, 64, 164);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

export class Ideas {
  view: IdeasView | null = null;
  private bills = new Map<number, THREE.Mesh>();
  private things = new Map<string, { obj: THREE.Object3D; animal?: Animal | null; dog?: boolean }>();
  private stepMark: THREE.Mesh;
  private readonly page: HTMLDivElement;
  private pageOpen: null | { kind: string; keys: Record<string, () => void>; typing?: boolean } = null;
  private jobSeen: { id: number; t: number } | null = null;
  private shownTrouble = new Set<number>();
  private cast: Figure | null = null;
  private castT = 0;
  private activeCheck = 0;
  private loading = false;
  private again = false;

  constructor(
    private readonly world: World,
    private readonly player: FirstPerson,
    private readonly jobs: Jobs,
    private readonly town: Town,
    private readonly press: Press,
  ) {
    this.page = document.createElement("div");
    this.page.className = "press-page ideas-page";
    this.page.style.display = "none";
    document.body.appendChild(this.page);
    window.addEventListener("keydown", (e) => this.onKey(e), true);
    dialogs.register("card", () => this.isOpen); // focus fix: the pause knows it is up (game/dialogs.ts)
    this.stepMark = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 14), psx(new THREE.MeshBasicMaterial({ color: 0xe8dcb0, transparent: true, opacity: 0.7 })));
    this.stepMark.rotation.x = -Math.PI / 2;
    this.stepMark.visible = false;
    world.scene.add(this.stepMark);
    // reading a notebook from the pockets; the paper, letters and tickets stay the press's
    const prev = jobs.pockets.onRead;
    jobs.pockets.onRead = (it) => (it.kind === "diary" ? setTimeout(() => void this.readDiary(it), 0) : prev(it));
    jobs.extraActions.push((x, z) => this.actions(x, z));
    void this.load();
    setInterval(() => void this.load(), 15000);
    // (M7 posters: the woodcuts came after the first bills were drawn: draw those again with them)
    CUTS?.addEventListener("load", () => {
      for (const m of this.bills.values()) {
        m.removeFromParent();
        this.free(m);
      }
      this.bills.clear();
      this.build();
    });
  }

  // ------------------------------------------------------------------ server data

  async load(): Promise<void> {
    if (this.loading) {
      this.again = true;
      return;
    }
    this.loading = true;
    try {
      const v = await call<IdeasView>("GET", "/api/ideas");
      // a reply without the lists (the server restarting, a cut-off body) keeps the last good view
      // (fixes 2026-09-25: "v.posters is not iterable" in actions())
      if (!Array.isArray(v?.posters) || !Array.isArray(v?.lost) || !Array.isArray(v?.diaries) || !Array.isArray(v?.meetings)) return;
      this.view = v;
      this.build();
    } catch {
      /* the server may be starting; the next push or interval tries again */
    } finally {
      this.loading = false;
      if (this.again) {
        this.again = false;
        void this.load();
      }
    }
  }

  handlePush(m: PushMsg): void {
    if (m.type === "ideas" || m.type === "trouble") void this.load();
  }

  /** Free what build() and makeThing() made for one thing alone: its geometry, material and texture. */
  private free(o: THREE.Object3D): void {
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      for (const mat of [m.material].flat()) {
        (mat as THREE.MeshLambertMaterial).map?.dispose();
        mat.dispose();
      }
    });
  }

  private build(): void {
    const v = this.view;
    if (!v) return;
    // bills
    const want = new Set(v.posters.map((p) => p.id));
    for (const [id, m] of this.bills) {
      if (want.has(id)) continue;
      m.removeFromParent();
      this.free(m);
      this.bills.delete(id);
    }
    for (const p of v.posters) {
      if (this.bills.has(p.id)) continue;
      // (M7 posters: the size and place the server's spots keep clear, shared/posterWalls.ts AI_BILL; flat on the wall)
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(AI_BILL.w, AI_BILL.h),
        psx(new THREE.MeshLambertMaterial({ map: billTexture(p), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), { affine: 0.5 }),
      );
      m.position.set(p.spot.x + p.spot.out[0] * 0.012, AI_BILL.y, p.spot.z + p.spot.out[1] * 0.012);
      m.rotation.y = Math.atan2(p.spot.out[0], p.spot.out[1]);
      m.rotation.z = (((p.id * 37) % 7) - 3) * 0.006; // pasted by hand
      this.world.scene.add(m);
      this.bills.set(p.id, m);
    }
    // things in the street: lost things, notebooks
    const keys = new Set<string>();
    for (const l of v.lost) {
      const k = `lost:${l.poster}`;
      keys.add(k);
      if (!this.things.has(k)) this.things.set(k, this.makeThing(l.dog ? "dog" : "bundle", l.x, l.z, l.dog?.look));
    }
    for (const d of v.diaries) {
      const k = `diary:${d.id}`;
      if (d.status !== "lying") continue;
      keys.add(k);
      if (!this.things.has(k)) this.things.set(k, this.makeThing("notebook", d.x, d.z));
    }
    for (const [k, t] of this.things) {
      if (keys.has(k)) continue;
      t.obj.removeFromParent();
      // an animal frees its own (its model's parts may be shared); a thing made here is freed here
      if (t.animal) t.animal.dispose();
      else this.free(t.obj);
      this.things.delete(k);
    }
  }

  private makeThing(kind: "dog" | "bundle" | "notebook", x: number, z: number, look?: string): { obj: THREE.Object3D; animal?: Animal | null; dog?: boolean } {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    if (kind === "dog") {
      const a = makeAnimal(dogKind(look));
      if (a) {
        a.play("sit", 0);
        g.add(a.group);
        this.world.scene.add(g);
        return { obj: g, animal: a, dog: true };
      }
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.25, 0.55), psx(new THREE.MeshLambertMaterial({ color: 0x6b4a2e })));
      body.position.y = 0.3;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.2), psx(new THREE.MeshLambertMaterial({ color: 0x5a3d25 })));
      head.position.set(0, 0.48, 0.3);
      g.add(body, head);
      this.world.scene.add(g);
      return { obj: g, animal: null, dog: true };
    }
    const size: [number, number, number] = kind === "notebook" ? [0.13, 0.03, 0.19] : [0.28, 0.1, 0.2];
    const m = new THREE.Mesh(new THREE.BoxGeometry(...size), psx(new THREE.MeshLambertMaterial({ color: kind === "notebook" ? 0x3b2c22 : 0x8a8272 })));
    m.position.y = size[1] / 2 + 0.01;
    m.rotation.y = Math.random() * Math.PI;
    g.add(m);
    if (kind === "notebook") {
      // a pale page edge, so it catches the eye on the stones
      const e = new THREE.Mesh(new THREE.BoxGeometry(size[0] * 0.92, 0.012, size[2] * 0.95), psx(new THREE.MeshLambertMaterial({ color: 0xe9e0c8 })));
      e.position.y = size[1] + 0.012;
      e.rotation.y = m.rotation.y;
      g.add(e);
    }
    this.world.scene.add(g);
    return { obj: g };
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number): void {
    const v = this.view;
    // a dog on Jef's belt trots along behind him
    for (const l of v?.lost ?? []) {
      const t = this.things.get(`lost:${l.poster}`);
      if (!t) continue;
      if (t.dog && t.animal === null) {
        const a = makeAnimal(dogKind(l.dog?.look));
        if (a) {
          t.obj.clear();
          t.obj.add(a.group);
          t.animal = a;
          a.play("sit", 0);
        }
      }
      if (l.state === "held" && t.dog) {
        const back = new THREE.Vector3(Math.sin(this.player.yaw), 0, Math.cos(this.player.yaw)).multiplyScalar(1.3);
        const tx = this.player.x + back.x;
        const tz = this.player.z + back.z;
        const d = dist(t.obj.position.x, t.obj.position.z, tx, tz);
        if (d > 0.25) {
          const k = Math.min(1, dt * 3);
          t.obj.position.x += (tx - t.obj.position.x) * k;
          t.obj.position.z += (tz - t.obj.position.z) * k;
          t.obj.rotation.y = Math.atan2(tx - t.obj.position.x, tz - t.obj.position.z);
          t.animal?.play(d > 2 ? "run" : "walk");
        } else t.animal?.play("sit");
      }
      t.animal?.update(dt);
    }
    // the trouble on the running job
    this.activeCheck -= dt;
    if (this.activeCheck <= 0) {
      this.activeCheck = 0.5;
      const active = this.jobs.devActive?.id ?? null; // not debug(): that reads the HUD's text (a layout) each time
      if (active === null) this.jobSeen = null;
      else if (this.jobSeen?.id !== active) {
        this.jobSeen = { id: active, t: performance.now() };
        void this.load();
      }
    }
    const tr = v?.trouble;
    if (tr && this.jobSeen?.id === tr.job_id && tr.status === "ready" && !this.shownTrouble.has(tr.id) && !this.pageOpen && !this.press.isOpen && !this.jobs.talk.isOpen) {
      if ((performance.now() - this.jobSeen.t) / 1000 >= tr.after_s) this.showTrouble(tr);
    }
    const step = tr && this.jobSeen?.id === tr.job_id ? tr.step : null;
    this.stepMark.visible = !!step;
    if (step) this.stepMark.position.set(step.x, 0.03, step.z);
    if (this.cast) {
      this.cast.update(dt);
      this.castT -= dt;
      if (this.castT <= 0 && !this.pageOpen) {
        this.cast.remove();
        this.cast = null;
      }
    }
  }

  // ------------------------------------------------------------------ keys in the street

  private actions(x: number, z: number): { options?: Array<[number, Action]>; extra?: Action[] } {
    const v = this.view;
    if (!v || this.pageOpen || this.jobs.talk.isOpen || this.press.isOpen) return {};
    const options: Array<[number, Action]> = [];
    const extra: Action[] = [];
    for (const p of v.posters) {
      const d = dist(x, z, p.spot.at[0], p.spot.at[1]);
      if (d < REACH_READ) options.push([d + 0.1, { key: "KeyE", text: `read the bill: ${p.text.heading.toLowerCase()}`, run: () => this.showBill(p), at: { x: p.spot.x, y: 1.62, z: p.spot.z } }]);
    }
    for (const l of v.lost) {
      if (l.state === "lying") {
        const d = dist(x, z, l.x, l.z);
        if (d < REACH_THING) options.push([d, { key: "KeyE", text: l.dog ? `take ${l.dog.name} by the collar` : `pick up ${l.what}`, run: () => void this.post(`/api/posters/${l.poster}/pick`), at: { x: l.x, y: l.dog ? 0.4 : 0.15, z: l.z } }]);
      } else if (l.door && dist(x, z, l.door[0], l.door[1]) < REACH_DOOR) {
        options.push([0.05, { key: "KeyE", text: `bring ${l.dog ? l.dog.name : l.what} back to ${l.owner_name}`, run: () => void this.post(`/api/posters/${l.poster}/return`), at: { x: l.door[0], y: this.player.y + 1.2, z: l.door[1] } }]);
      }
    }
    const berg = this.press.info?.berg;
    for (const d of v.diaries) {
      if (d.status === "lying") {
        const dd = dist(x, z, d.x, d.z);
        if (dd < REACH_THING) options.push([dd, { key: "KeyE", text: "pick up the notebook", run: () => void this.post(`/api/diary/${d.id}/pick`), at: { x: d.x, y: 0.1, z: d.z } }]);
        continue;
      }
      if (d.door && dist(x, z, d.door[0], d.door[1]) < REACH_DOOR) {
        const at = { x: d.door[0], y: this.player.y + 1.2, z: d.door[1] };
        options.push([0.05, { key: "KeyE", text: `give the notebook back to ${d.owner_name}`, run: () => void this.post(`/api/diary/${d.id}/return`), at }]);
        extra.push({ key: "KeyG", text: "hint at what you read in it (squeeze them)", run: () => void this.post(`/api/diary/${d.id}/squeeze`), at });
      } else if (berg && dist(x, z, berg.door[0], berg.door[1]) < 6) {
        extra.push({ key: "KeyG", text: "sell the notebook to the Berg's clerk", run: () => void this.post(`/api/diary/${d.id}/sell`), at: { x: berg.door[0], z: berg.door[1] } });
      }
    }
    const h = this.jobs.day.hourF;
    for (const m of v.meetings) {
      if (h < m.from_h || h >= m.to_h) continue;
      const d = dist(x, z, m.x, m.z);
      if (d < REACH_DOOR) options.push([d, { key: "KeyE", text: `knock: ${m.name.split(" ")[0]} asked you to come by`, run: () => void this.post(`/api/meet/${m.id}`), at: { x: m.x, y: this.player.y + 1.2, z: m.z } }]);
    }
    const tr = v.trouble;
    if (tr?.step && dist(x, z, tr.step.x, tr.step.z) < REACH_DOOR + 0.8) {
      options.push([0, { key: "KeyE", text: `see to it at ${tr.step.label}`, run: () => void this.post(`/api/trouble/${tr.id}/step`), at: { x: tr.step.x, z: tr.step.z } }]);
    }
    // the post counter: a letter of your own
    const post = this.press.info?.post;
    if (post) {
      const at = this.town.position(post.clerk);
      const pup = this.town.puppet(post.clerk);
      if (at && dist(at.x, at.z, x, z) < REACH_COUNTER) extra.push({ key: "KeyG", text: "write a letter (a stamp, 10 c)", run: () => void this.openWriting(), at: pup ? chest(pup.group, 1.3 * pup.size) : { x: at.x, z: at.z } });
    }
    return { options, extra };
  }

  /** One request at a time per kind: a key pressed twice does not pay or knock twice. */
  private posting = false;
  private choosing = false;
  private sending = false;

  private async post(url: string, body: Record<string, unknown> = {}): Promise<void> {
    if (this.posting) return;
    this.posting = true;
    try {
      const r = await call<Partial<JobsPayload> & { text: string }>("POST", url, { x: this.player.x, z: this.player.z, ...body });
      if (r.player) this.jobs.refresh(r as JobsPayload);
      this.jobs.say(r.text);
      await this.load();
    } catch (e) {
      this.jobs.say((e as Error).message);
    } finally {
      this.posting = false;
    }
  }

  // ------------------------------------------------------------------ pages

  private showBill(p: PosterV): void {
    this.show(
      `bill ${p.kind}`,
      `<div class="bill"><h1>${esc(p.text.heading)}</h1><p class="body">${esc(p.text.body)}</p>${p.text.footer ? `<p class="foot">${esc(p.text.footer)}</p>` : ""}
       <p class="printer">Printed by Buschmann, Antwerp</p><p class="keys">E or Esc to step back</p></div>`,
      {},
    );
  }

  private async readDiary(it: PocketItem): Promise<void> {
    try {
      const d = await call<{ owner: string; near: string; entries: Array<{ date: string; text: string }>; sell_c: number }>("GET", `/api/diary/${it.ref}`);
      this.show(
        "diary",
        `<div class="notebook"><p class="cover">${esc(d.owner)}<br><i>${esc(d.near)}</i></p>
          ${d.entries.map((e) => `<h4>${esc(e.date)}</h4><p>${esc(e.text)}</p>`).join("")}
          <p class="keys">Give it back at ${esc(d.owner.split(" ")[0])}'s door (E), keep it, or sell it to the Berg's clerk (G). E or Esc to close it.</p></div>`,
        {},
      );
    } catch (e) {
      this.jobs.say((e as Error).message);
    }
  }

  private showTrouble(t: TroubleV): void {
    this.shownTrouble.add(t.id);
    // the one it is about, before you (a figure made in code)
    this.cast?.remove();
    const fx = this.player.x + Math.sin(this.player.yaw) * -1.8;
    const fz = this.player.z + Math.cos(this.player.yaw) * -1.8;
    this.cast = new Figure(t.kind === "customs" ? "foreman" : t.kind === "stowaway" ? "thief" : "stranger", fx, fz, this.world.scene);
    this.cast.face(this.player.x, this.player.z);
    this.castT = 25;
    const keys: Record<string, () => void> = {};
    for (const o of t.options) keys[`Digit${o.n}`] = () => void this.choose(t, o.n);
    this.show(
      "trouble",
      `<div class="scene"><h2>Trouble on the job</h2><p class="what">${esc(t.scene)}</p>
        ${t.lines.map((l) => `<p class="line"><b>${esc(l.name.charAt(0).toUpperCase() + l.name.slice(1))}:</b> "${esc(l.text)}"</p>`).join("")}
        <ol>${t.options.map((o) => `<li><span class="n">${o.n}</span> ${esc(o.label)}${o.step ? ` <i>(go to ${esc(o.step.label)})</i>` : ""}</li>`).join("")}</ol>
        <p class="keys">1-${t.options.length} choose</p></div>`,
      keys,
      true,
    );
  }

  private async choose(t: TroubleV, n: number): Promise<void> {
    if (this.choosing) return;
    this.choosing = true;
    try {
      const r = await call<Partial<JobsPayload> & { text: string }>("POST", `/api/trouble/${t.id}/choose`, { n });
      if (r.player) this.jobs.refresh(r as JobsPayload);
      this.close(true);
      this.jobs.say(r.text);
      this.castT = 6;
      await this.load();
    } catch (e) {
      this.close(true);
      this.jobs.say((e as Error).message);
    } finally {
      this.choosing = false;
    }
  }

  private async openWriting(): Promise<void> {
    let w: { to: Array<{ id: string; name: string; trade: string; near: string }>; stamp_c: number; max_chars: number };
    try {
      w = await call("GET", "/api/post/write");
    } catch (e) {
      return this.jobs.say((e as Error).message);
    }
    if (!w.to.length) return this.jobs.say("You know nobody in the town well enough to write to yet.");
    const keys: Record<string, () => void> = {};
    w.to.forEach((p, i) => (keys[`Digit${i + 1}`] = () => this.writeTo(p, w.stamp_c, w.max_chars)));
    this.show(
      "counter post",
      `<div class="counter"><h2>A letter of your own</h2><p class="sub">A sheet, an envelope and a stamp: ${w.stamp_c} centimes. It goes out with the evening post; an answer, if any, comes in the morning.</p>
       <h4>To whom?</h4><ol>${w.to.map((p, i) => `<li><span class="n">${i + 1}</span><span class="what">${esc(p.name)}<i class="sub">${esc(p.trade)}, near ${esc(p.near)}</i></span></li>`).join("")}</ol>
       <p class="keys">1-${w.to.length} choose &middot; E or Esc to step away</p></div>`,
      keys,
    );
  }

  private writeTo(p: { id: string; name: string }, stamp: number, max: number): void {
    this.show(
      "letter writing",
      `<p class="date">Antwerp</p><p>To ${esc(p.name)},</p><textarea maxlength="${max}" rows="7" placeholder="Write it in your own words."></textarea>
       <p class="keys">Enter to seal it and pay ${stamp} c &middot; Esc to tear it up</p>`,
      {},
      false,
      true,
    );
    const ta = this.page.querySelector("textarea")!;
    ta.addEventListener("keydown", (e) => {
      e.stopPropagation(); // the letters go on the page, not to the game
      if (e.code === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (e.repeat) return;
        const text = ta.value.trim();
        if (!text) return;
        void this.send(p.id, text);
      } else if (e.code === "Escape") this.close();
    });
    setTimeout(() => ta.focus(), 0);
  }

  private async send(to: string, text: string): Promise<void> {
    if (this.sending) return; // one letter, one stamp
    this.sending = true;
    try {
      const r = await call<Partial<JobsPayload> & { text: string }>("POST", "/api/post/write", { to, text, x: this.player.x, z: this.player.z });
      if (r.player) this.jobs.refresh(r as JobsPayload);
      this.close();
      this.jobs.say(r.text);
    } catch (e) {
      this.jobs.say((e as Error).message);
    } finally {
      this.sending = false;
    }
  }

  private show(kind: string, html: string, keys: Record<string, () => void>, sticky = false, typing = false): void {
    this.page.innerHTML = html;
    this.page.className = `press-page ideas-page ${kind}`;
    this.page.style.display = "block";
    this.pageOpen = { kind: sticky ? "sticky" : kind, keys, typing };
    this.player.frozen = true;
  }

  get isOpen(): boolean {
    return this.pageOpen !== null;
  }

  close(force = false): void {
    if (!this.pageOpen || (this.pageOpen.kind === "sticky" && !force)) return;
    this.pageOpen = null;
    this.page.style.display = "none";
    this.player.frozen = false;
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.pageOpen || this.pageOpen.typing) return;
    e.stopPropagation();
    if (e.repeat) return;
    if (e.code === "KeyE" || e.code === "Escape") return this.close();
    const k = this.pageOpen.keys[e.code];
    if (k) k();
  }

  // ------------------------------------------------------------------ checks

  /** For the path check: every bill's reading place, lost things, notebooks, owners' doors, meetings, a trouble's step. */
  pathPoints(): Array<{ label: string; x: number; z: number; reach: number }> {
    const v = this.view;
    const out: Array<{ label: string; x: number; z: number; reach: number }> = [];
    if (!v) return out;
    for (const p of v.posters) out.push({ label: `the bill at ${p.spot.label} (${p.spot.id})`, x: p.spot.at[0], z: p.spot.at[1], reach: REACH_READ });
    for (const l of v.lost) {
      if (l.state === "lying") out.push({ label: `lost: ${l.what}`, x: l.x, z: l.z, reach: REACH_THING });
      if (l.door) out.push({ label: `the door of ${l.owner_name}`, x: l.door[0], z: l.door[1], reach: REACH_DOOR });
    }
    for (const d of v.diaries) {
      if (d.status === "lying") out.push({ label: `${d.owner_name}'s notebook`, x: d.x, z: d.z, reach: REACH_THING });
      if (d.door) out.push({ label: `the door of ${d.owner_name}`, x: d.door[0], z: d.door[1], reach: REACH_DOOR });
    }
    for (const m of v.meetings) out.push({ label: `meeting at ${m.label}`, x: m.x, z: m.z, reach: REACH_DOOR });
    for (const o of v.trouble?.options ?? []) if (o.step) out.push({ label: `trouble: ${o.step.label}`, x: o.step.x, z: o.step.z, reach: REACH_DOOR + 0.8 });
    return out;
  }

  /** Dev: the page on screen drawn over the game picture, saved as data/shots/<name>.jpg. */
  async pageShot(name: string, canvas: HTMLCanvasElement): Promise<string> {
    const el = document.querySelector(".press-page:not([style*='none'])") as HTMLElement | null;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const g = out.getContext("2d")!;
    g.drawImage(canvas, 0, 0, W, H);
    if (el) {
      let css = "";
      for (const s of Array.from(document.styleSheets)) {
        try {
          for (const r of Array.from(s.cssRules)) css += r.cssText + "\n";
        } catch {
          /* a sheet from elsewhere: skipped */
        }
      }
      const clone = el.cloneNode(true) as HTMLElement;
      for (const ta of Array.from(clone.querySelectorAll("textarea"))) ta.textContent = (el.querySelector("textarea") as HTMLTextAreaElement | null)?.value ?? "";
      const xml = new XMLSerializer().serializeToString(clone);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml"><style>${css.replace(/<\/style/g, "")}</style>${xml}</div></foreignObject></svg>`;
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("page did not draw"));
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      });
      g.drawImage(img, 0, 0);
    }
    const url = out.toDataURL("image/jpeg", 0.88);
    const r = await fetch("/api/dev/shot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, url }) });
    return r.ok ? `data/shots/${name}.jpg` : `failed ${r.status}`;
  }
}
