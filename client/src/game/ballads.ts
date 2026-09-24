import * as THREE from "three";
import "./ballads.css";
import type { JobsPayload, PocketItem, PushMsg } from "../net/api";
import type { FirstPerson } from "../player/firstPerson";
import type { Note } from "../audio/ballad";
import { esc, type Action } from "./runs";
import type { Jobs } from "./jobs";
import type { Town } from "./town";
import type { Interiors } from "./interiors";

// The ballad singer on the client (M6). The server owns the singer, his corners and hours, the
// day's ballad and the price of a sheet (server/src/ballads/); this side plays it: line by line
// over his head as a paper tag, sung by a voice made in code (audio/ballad.ts) to a simple tune
// made here, a few notes to a syllable; a rest between rounds when he cries his sheets. In the
// street at his corner (an M4 gather brings the crowd), in the evening in a tavern through the
// interiors' own lines. G near him buys a sheet (a centime); the pockets read it (I).

interface Singing {
  kind: "street" | "tavern";
  event: number | null;
  place: string;
  label: string;
  x: number | null;
  z: number | null;
  from: number;
  to: number;
  status: string;
}
export interface BalladState {
  day: number;
  price_c: number;
  ballad: { title: string; verses: string[][]; chorus: string[]; source: string } | null;
  writing: boolean;
  singer: { id: string; name: string; first: string; sex: "m" | "f"; age: number; kind: string } | null;
  singing: Singing | null;
  have_sheet: boolean;
  corners: Array<{ id: string; label: string; x: number; z: number }>;
}
interface SungLine {
  text: string;
  chorus: boolean;
  notes: Note[];
  beat: number;
  secs: number;
}

async function call<T>(method: string, url: string, body?: unknown, timeoutMs = 8000): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

// ------------------------------------------------------------------ the tune (our own code)

/** Four phrases for the four lines of a verse, and four for the chorus: semitones over the home note. */
const VERSE: number[][] = [
  [0, 4, 7, 7, 9, 7, 4, 7],
  [7, 9, 12, 11, 9, 7, 5, 4],
  [0, 4, 7, 7, 9, 12, 11, 9],
  [7, 5, 4, 2, 4, 2, 0, 0],
];
const CHORUS: number[][] = [
  [12, 12, 11, 9, 7, 9, 11, 12],
  [9, 7, 5, 4, 2, 4, 2, 0],
  [7, 7, 9, 11, 12, 11, 9, 7],
  [5, 4, 2, 2, 4, 2, 0, 0],
];
const BEAT = 0.34;

/** Syllables, near enough: groups of vowels, a silent e at a word's end not counted. */
export function syllables(text: string): number {
  let n = 0;
  for (const w of text.toLowerCase().match(/[a-z']+/g) ?? []) n += Math.max(1, (w.replace(/e$/, "").match(/[aeiouy]+/g) ?? []).length);
  return Math.max(4, Math.min(12, n));
}

/** A line's notes: its phrase stretched over its syllables, the last note held; each day a little different. */
export function tuneFor(text: string, i: number, chorus: boolean, day: number): { notes: Note[]; beat: number; secs: number } {
  const phrase = (chorus ? CHORUS : VERSE)[i % 4];
  const n = syllables(text);
  const shift = [0, 2, -3, 5, -1][day % 5];
  const notes: Note[] = [];
  for (let k = 0; k < n; k++) {
    let semi = phrase[Math.min(7, Math.floor((k * 8) / n))];
    // a passing note now and then, by the day, so the tune is not the same every day
    if (k > 0 && k < n - 1 && (k + day) % 5 === 0) semi += semi >= 7 ? -2 : 2;
    const beats = k === n - 1 ? 2 : n > 9 && k % 2 ? 0.75 : 1;
    notes.push([semi + shift, beats]);
  }
  const secs = notes.reduce((a, [, b]) => a + b * BEAT, 0);
  return { notes, beat: BEAT, secs };
}

/** The song as he sings it: each verse, then the chorus. */
function songOf(b: NonNullable<BalladState["ballad"]>, day: number): SungLine[] {
  const out: SungLine[] = [];
  for (const v of b.verses) {
    v.forEach((text, i) => out.push({ text, chorus: false, ...tuneFor(text, i, false, day) }));
    b.chorus.forEach((text, i) => out.push({ text, chorus: true, ...tuneFor(text, i, true, day) }));
  }
  return out;
}

const CRIES = ["A new song! A true song! A centime the sheet!", "Sheets, a centime! All the news of the town, in rhyme!", "Buy the words, and sing along! A centime!"];
const HEAD_M = 1.85;
const HEAR_M = 30;
const EDGE_PX = 6;

export class Ballads {
  private st: BalladState | null = null;
  private loading = false;
  private asked = "";
  private song: SungLine[] = [];
  private songKey = "";
  private street: { i: number; t: number; rest: number } = { i: -1, t: 0, rest: 2 };
  private tavern: { t: number; busy: boolean } = { t: 4, busy: false };
  private tag: HTMLDivElement;
  private tagWho = "";
  private v = new THREE.Vector3();
  private page: HTMLDivElement;
  private pageOpen = false;
  /** Set by main: a sung line at a point (the soundscape; indoors through the room). Returns its seconds. */
  sing: (at: { x: number; z: number }, voice: { sex: "m" | "f"; age: number }, notes: Note[], beat: number, indoors: boolean) => number = () => 0;
  /** Dev: the lines sung so far. */
  readonly sung: string[] = [];

  constructor(
    private readonly player: FirstPerson,
    private readonly jobs: Jobs,
    private readonly town: Town,
    private readonly interiors: Interiors,
  ) {
    this.tag = document.createElement("div");
    this.tag.className = "bubble ballad";
    document.body.appendChild(this.tag);
    this.page = document.createElement("div");
    this.page.className = "ballad-sheet";
    this.page.style.display = "none";
    document.body.appendChild(this.page);
    window.addEventListener("keydown", (e) => this.onKey(e), true);
    // reading a sheet from the pockets; everything else stays with the others
    const prev = jobs.pockets.onRead;
    jobs.pockets.onRead = (it) => (it.kind === "ballad" ? setTimeout(() => void this.read(it), 0) : prev(it));
    jobs.extraActions.push((x, z) => this.keys(x, z));
    interiors.tavernKeys = () => this.tavernKeys();
    void this.load();
    setInterval(() => void this.load(), 10_000);
  }

  // ------------------------------------------------------------------ the server's word

  async load(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      this.st = await call<BalladState>("GET", "/api/ballad");
      const s = this.st;
      // he is out to sing and the words are not written yet (a late server): ask for them once
      if (s.singing && !s.ballad && !s.writing && this.asked !== `${s.day}`) {
        this.asked = `${s.day}`;
        void call<BalladState>("POST", "/api/ballad/today", {}, 25_000)
          .then((n) => (this.st = n))
          .catch(() => {});
      }
    } catch {
      /* the server may be starting */
    } finally {
      this.loading = false;
    }
  }

  handlePush(m: PushMsg): void {
    if (m.type === "events") void this.load();
  }

  /** Where the singer may stand: his corners must be reachable on foot. */
  pathPoints(): Array<{ label: string; x: number; z: number; reach: number }> {
    return (this.st?.corners ?? []).map((c) => ({ label: `the ballad singer's corner: ${c.label}`, x: c.x, z: c.z, reach: 8 }));
  }

  private get singer() {
    return this.st?.singer ?? null;
  }

  private ensureSong(): SungLine[] {
    const s = this.st;
    if (!s?.ballad) return [];
    const key = `${s.day}:${s.ballad.title}`;
    if (key !== this.songKey) {
      this.songKey = key;
      this.song = songOf(s.ballad, s.day);
      this.street = { i: -1, t: 0, rest: 2 };
    }
    return this.song;
  }

  // ------------------------------------------------------------------ keys

  private canBuy(): boolean {
    return !!this.st?.ballad && !this.st.have_sheet && this.st.singing?.status === "running";
  }

  private keys(x: number, z: number): { extra?: Action[] } {
    const s = this.st;
    if (!s?.singing || s.singing.kind !== "street" || !this.singer || this.pageOpen || this.interiors.inside) return {};
    const at = this.town.position(this.singer.id);
    if (!at || Math.hypot(at.x - x, at.z - z) > 2.6) return {};
    if (!this.canBuy()) return {};
    return { extra: [{ key: "KeyG", text: `buy a ballad sheet from ${this.singer.first} (${s.price_c} c)`, run: () => void this.buy() }] };
  }

  private tavernKeys(): { options: Array<[number, Action]>; extra: Action[] } {
    const s = this.st;
    const none = { options: [], extra: [] };
    if (!s?.singing || s.singing.kind !== "tavern" || !this.singer || this.interiors.placeId !== s.singing.place) return none;
    const p = this.interiors.personAt(this.singer.id);
    if (!p || p.dist > 2.2 || !this.canBuy()) return none;
    return { options: [], extra: [{ key: "KeyG", text: `buy a ballad sheet from ${this.singer.first} (${s.price_c} c)`, run: () => void this.buy() }] };
  }

  private async buy(): Promise<void> {
    try {
      const r = await call<JobsPayload & { text: string; paid_c: number }>("POST", "/api/ballad/buy", {});
      this.jobs.refresh(r);
      this.jobs.say(r.text);
      if (this.st) this.st.have_sheet = true;
    } catch (e) {
      this.jobs.say((e as Error).message);
    }
  }

  // ------------------------------------------------------------------ singing

  update(dt: number, camera: THREE.Camera): void {
    const s = this.st;
    const song = this.ensureSong();
    const who = this.singer;
    if (!s?.singing || !who || !song.length || s.singing.status !== "running") return this.hideTag();
    if (s.singing.kind === "tavern") {
      this.hideTag();
      return this.updateTavern(dt, s.singing, song);
    }
    if (this.interiors.inside) return this.hideTag();
    const at = this.town.position(who.id);
    // he sings where he stands at his corner, not on his way there
    const atCorner = !!at && s.singing.x !== null && Math.hypot(at.x - s.singing.x, at.z - (s.singing.z ?? 0)) < 7;
    const near = !!at && Math.hypot(at.x - camera.position.x, at.z - camera.position.z) < HEAR_M;
    if (!at || !atCorner || !near) {
      this.hideTag();
      return;
    }
    const st = this.street;
    st.t -= dt;
    if (st.t > 0) return this.placeTag(at, camera);
    if (st.rest > 0) {
      // a pause between rounds: he cries his sheets
      st.rest = 0;
      st.t = 4.5;
      this.showTag(who.first, CRIES[Math.floor(Math.random() * CRIES.length)], who.id);
      return this.placeTag(at, camera);
    }
    st.i++;
    if (st.i >= song.length) {
      st.i = -1;
      st.rest = 1;
      st.t = 6;
      this.hideTag();
      return;
    }
    const l = song[st.i];
    const secs = this.sing(at, { sex: who.sex, age: who.age }, l.notes, l.beat, false) || l.secs;
    st.t = secs + 0.4;
    this.showTag(who.first, l.text, who.id, l.chorus);
    this.sung.push(`${who.first}: ${l.text}`);
    if (this.sung.length > 40) this.sung.shift();
    this.placeTag(at, camera);
  }

  /** In the tavern: through the interiors' own lines over his head, the tune from here. */
  private updateTavern(dt: number, n: Singing, song: SungLine[]): void {
    const who = this.singer!;
    if (this.interiors.placeId !== n.place || !this.interiors.personAt(who.id)) return;
    if (this.tavern.busy) return;
    this.tavern.t -= dt;
    if (this.tavern.t > 0 || this.interiors.scriptBusy) return;
    const lines = song.map((l) => ({ who: who.id, name: who.first, text: l.text, secs: l.secs + 0.4 }));
    let k = 0;
    const ok = this.interiors.sing(
      who.id,
      lines,
      (line) => {
        const l = song[k++];
        const p = this.interiors.personAt(who.id);
        if (l && p) this.sing(p, p.voice, l.notes, l.beat, true);
        this.sung.push(`${who.first}: ${line.text}`);
        if (this.sung.length > 40) this.sung.shift();
      },
      () => {
        this.tavern.busy = false;
        this.tavern.t = 14;
      },
    );
    if (ok) this.tavern.busy = true;
    else this.tavern.t = 3;
  }

  private showTag(name: string, text: string, who: string, chorus = false): void {
    this.tag.innerHTML = `<b>${esc(name)}${chorus ? ", all together" : ""}</b>${esc(text)}`;
    this.tag.classList.toggle("chorus", chorus);
    this.tagWho = who;
  }

  private hideTag(): void {
    this.tag.classList.remove("on");
    this.tagWho = "";
  }

  private placeTag(at: { x: number; z: number }, camera: THREE.Camera): void {
    if (!this.tagWho) return;
    this.v.set(at.x, HEAD_M + 0.2, at.z).project(camera);
    if (this.v.z > 1 || this.v.z < -1 || Math.abs(this.v.x) > 1 || Math.abs(this.v.y) > 1) return void this.tag.classList.remove("on");
    const x = ((this.v.x + 1) / 2) * window.innerWidth;
    const y = ((1 - this.v.y) / 2) * window.innerHeight;
    const w = this.tag.offsetWidth;
    const h = this.tag.offsetHeight;
    const cx = Math.max(EDGE_PX + w / 2, Math.min(window.innerWidth - EDGE_PX - w / 2, x));
    const cy = Math.max(EDGE_PX + h, Math.min(window.innerHeight - EDGE_PX, y));
    this.tag.style.left = `${cx.toFixed(0)}px`;
    this.tag.style.top = `${cy.toFixed(0)}px`;
    this.tag.style.setProperty("--tail", `${Math.max(-w / 2 + 10, Math.min(w / 2 - 10, x - cx)).toFixed(0)}px`);
    this.tag.classList.add("on");
  }

  // ------------------------------------------------------------------ the sheet

  private async read(it: PocketItem): Promise<void> {
    try {
      const d = await call<{ day: number; title: string; verses: string[][]; chorus: string[]; weekday: string }>("GET", `/api/ballad/sheet/${it.ref}`);
      const chorus = `<p class="chorus">${d.chorus.map(esc).join("<br>")}</p>`;
      this.page.innerHTML = `<div class="woodcut"></div><h1>${esc(d.title)}</h1><p class="tune">A new song. To be sung to an old tune everybody knows.</p>
        ${d.verses.map((v, i) => `<p class="verse"><span class="n">${i + 1}.</span> ${v.map(esc).join("<br>")}</p>${chorus}`).join("")}
        <p class="printer">Printed for the singer, Antwerp, ${esc(d.weekday)}. One centime.</p><p class="keys">E or Esc to fold it away</p>`;
      this.page.style.display = "block";
      this.pageOpen = true;
      this.player.frozen = true;
    } catch (e) {
      this.jobs.say((e as Error).message);
    }
  }

  get isOpen(): boolean {
    return this.pageOpen;
  }

  close(): void {
    if (!this.pageOpen) return;
    this.pageOpen = false;
    this.page.style.display = "none";
    this.player.frozen = false;
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.pageOpen || e.repeat) return;
    if (e.code === "KeyE" || e.code === "Escape" || e.code === "KeyI") {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  }

  /** Dev: the state for scripted checks. */
  info() {
    const s = this.st;
    const at = s?.singer ? this.town.position(s.singer.id) : null;
    return {
      day: s?.day ?? null,
      title: s?.ballad?.title ?? null,
      source: s?.ballad?.source ?? null,
      singer: s?.singer?.name ?? null,
      singing: s?.singing ?? null,
      at: at ? [+at.x.toFixed(1), +at.z.toFixed(1)] : null,
      line: this.street.i,
      of: this.song.length,
      tag: this.tag.classList.contains("on") ? this.tag.textContent : null,
      sung: this.sung.slice(-6),
      have_sheet: s?.have_sheet ?? false,
    };
  }
}
