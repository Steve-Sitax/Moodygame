import * as THREE from "three";
import type { Convo } from "../net/api";
import type { Town } from "./town";
import { esc } from "./runs";

// Speech bubbles (M4): a conversation between two townspeople the server made
// (director/convo.ts) shows as paper tags over their heads, one line at a time,
// taking turns, 2.5 to 4 s a line by its length, with a murmur of speech from
// the soundscape (no words: noise through formants). At most six tags at once;
// hidden beyond 30 m or behind the camera. The lines are the server's; this
// side only shows them.

const MAX_TAGS = 6;
const SHOW_M = 30;
const HEAD_M = 1.75;
const CHILD_HEAD_M = 1.3;

interface Play {
  c: Convo;
  i: number;
  /** Seconds left on the current line. */
  t: number;
  el: HTMLDivElement;
  who: string;
  started: boolean;
}

export class Bubbles {
  private plays: Play[] = [];
  private seen = new Set<number>();
  private v = new THREE.Vector3();
  /** Set by main: a voice from the soundscape at a point for some seconds. */
  speak: (at: { x: number; z: number }, voice: { sex: "m" | "f"; age: number }, seconds: number) => void = () => {};
  /** Dev: the lines shown so far. */
  readonly shown: string[] = [];

  constructor(private readonly town: Town) {}

  /** A conversation to show (once; the same id again is ignored). */
  show(c: Convo): void {
    if (this.seen.has(c.id) || !c.lines.length) return;
    this.seen.add(c.id);
    if (this.seen.size > 200) this.seen = new Set([...this.seen].slice(-100));
    const el = document.createElement("div");
    el.className = "bubble";
    document.body.appendChild(el);
    this.plays.push({ c, i: -1, t: 0, el, who: "", started: false });
  }

  get active(): number {
    return this.plays.length;
  }

  private secondsFor(text: string): number {
    return Math.min(4, 2.5 + text.length / 90);
  }

  update(dt: number, camera: THREE.Camera): void {
    for (const p of [...this.plays]) {
      p.t -= dt;
      if (p.t <= 0) {
        p.i++;
        if (p.i >= p.c.lines.length) {
          p.el.remove();
          this.plays.splice(this.plays.indexOf(p), 1);
          continue;
        }
        const l = p.c.lines[p.i];
        p.who = l.who;
        p.t = this.secondsFor(l.text);
        p.el.innerHTML = `<b>${esc(l.name)}</b>${esc(l.text)}`;
        this.shown.push(`${l.name}: ${l.text}`);
        if (this.shown.length > 40) this.shown.shift();
        const at = this.town.position(l.who);
        const info = this.town.info(l.who);
        if (at && info && Math.hypot(at.x - camera.position.x, at.z - camera.position.z) < SHOW_M) {
          this.speak(at, { sex: info.sex, age: info.age }, Math.min(p.t - 0.3, 3.5));
        }
      }
      this.place(p, camera);
    }
    // the oldest tags give way when there are too many
    let n = 0;
    for (const p of this.plays) {
      if (++n > MAX_TAGS) p.el.classList.remove("on");
    }
  }

  private place(p: Play, camera: THREE.Camera): void {
    const at = this.town.position(p.who);
    const info = this.town.info(p.who);
    if (!at) return void p.el.classList.remove("on");
    const d = Math.hypot(at.x - camera.position.x, at.z - camera.position.z);
    if (d > SHOW_M) return void p.el.classList.remove("on");
    const head = info && info.age < 13 ? CHILD_HEAD_M : HEAD_M;
    this.v.set(at.x, head + 0.15, at.z).project(camera);
    if (this.v.z > 1 || this.v.z < -1 || Math.abs(this.v.x) > 1.2 || Math.abs(this.v.y) > 1.2) return void p.el.classList.remove("on");
    const x = ((this.v.x + 1) / 2) * window.innerWidth;
    const y = ((1 - this.v.y) / 2) * window.innerHeight;
    p.el.style.left = `${x.toFixed(0)}px`;
    p.el.style.top = `${y.toFixed(0)}px`;
    p.el.classList.add("on");
  }

  /** Dev: what is up now. */
  info() {
    return this.plays.map((p) => ({ id: p.c.id, who: p.who, line: p.i, of: p.c.lines.length, on: p.el.classList.contains("on") }));
  }
}
