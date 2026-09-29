import CITY from "../../../shared/city.json";
import type { FirstPerson } from "../player/firstPerson";
import { keyLabel } from "../menu/keys";
import { dialogs } from "./dialogs";
import { settings } from "./prefs";

// The paper map (M). Drawn from the traced 1873 city (shared/city.json) in the
// colours of the Vuillaume map: red blocks, blue-grey water, ink names.
// North is up, so the map turns the game world back by its 19-24 degrees.
// Marks come from the game: you, the job's goal, people with work, the town's
// events, the board, the doss house, the shops.
//
// 2026-09-27 (Steve: "better ingame map, make option to show map in a circle on the
// screen in settings, but no default on. Quests show on the map"): the big map pans
// (WASD, arrows, drag) and zooms (+ -, the wheel), lists the work beside it with
// numbers and distances (a number key finds it), has a key to its marks, and shows
// the shop names only where there is room. The round map in the corner (setting
// "Map in the corner", off by default) turns with Jef and shows the same work.

export interface MapMark {
  x: number;
  z: number;
  label: string;
  kind: "goal" | "work" | "event" | "place" | "shop" | "bed";
  /** For the list beside the map: what the work is (the job's title, the event's place). */
  detail?: string;
}

/** The marks that are work to go to: listed beside the map, numbered, and kept on the corner map's rim. */
const QUEST_KINDS: ReadonlySet<MapMark["kind"]> = new Set(["goal", "work", "event"]);
const INK: Record<MapMark["kind"], string> = { goal: "#8a1a10", work: "#1a3a6a", event: "#4a2a5a", place: "#2a2420", shop: "#2a2420", bed: "#2a2420" };
const HAND = "'Scheldemist Hand', 'Segoe Print', 'Bradley Hand', cursive";
const PRINT = "'Scheldemist Print', Georgia, serif";

interface CityData {
  frame: { thetaDeg: number };
  area: number[][];
  blocks: Array<{ outer: number[][] }>;
  water: Array<{ outer: number[][] }>;
  landmarks: Record<string, { fp: number[][] }>;
}

const data = CITY as unknown as CityData;
const TH = (data.frame.thetaDeg * Math.PI) / 180;
const SIN = Math.sin(TH);
const COS = Math.cos(TH);

/** World (x, z) -> map metres, east and north of the Rijnkaai. */
function en(x: number, z: number): [number, number] {
  return [x * SIN + z * COS, x * COS - z * SIN];
}

const LANDMARK_NAMES: Record<string, string> = {
  cathedral: "Cathedral of Our Lady",
  stadhuis: "Town Hall",
  vleeshuis: "Vleeshuis",
  steen: "Het Steen",
  carolus: "St. Charles Borromeo",
  stpaul: "St. Paul's",
  stjacob: "St. James",
  hanzehuis: "Hanseatic House",
};

/** Names of places, in world metres, from the map design (shared/city.json places). */
const PLACES = ((CITY as unknown as { places?: Record<string, { x: number; z: number; kind: string }> }).places ?? {}) as Record<string, { x: number; z: number; kind: string }>;
const PLACE_NAMES: Array<[string, number, number, number]> = Object.entries(PLACES)
  .filter(([, p]) => p.kind !== "building")
  .map(([name, p]) => [p.kind === "water" || p.kind === "quay" || p.kind === "gate" || p.kind === "rampart" ? name : name.toUpperCase(), p.x, p.z, 0]);

/** The way from Jef in plain words: "north-east". */
function way(dx: number, dz: number): string {
  const [e, n] = en(dx, dz);
  const i = Math.round(Math.atan2(e, n) / (Math.PI / 4));
  return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][(i + 8) % 8];
}
/** A distance the way the arrow and the list show it: 5 m steps near, 10 m steps far. */
export function metres(d: number): string {
  return `${d < 100 ? Math.max(5, Math.round(d / 5) * 5) : Math.round(d / 10) * 10} m`;
}
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ESC[c]);

/** One mark, drawn at (u, v) on a 2D canvas, `s` times its size on the big map; `n` its number in the list. */
function drawMark(g: CanvasRenderingContext2D, m: MapMark, u: number, v: number, s: number, n?: number): void {
  g.strokeStyle = g.fillStyle = INK[m.kind];
  g.lineWidth = 3 * s;
  if (m.kind === "goal") {
    const r = 8 * s;
    g.beginPath();
    g.moveTo(u - r, v - r);
    g.lineTo(u + r, v + r);
    g.moveTo(u + r, v - r);
    g.lineTo(u - r, v + r);
    g.stroke();
    g.lineWidth = 1.5 * s;
    g.beginPath();
    g.arc(u, v, r * 1.55, 0, Math.PI * 2);
    g.stroke();
  } else if (m.kind === "work" || m.kind === "event") {
    const r = 9 * s;
    g.fillStyle = "#efe6cc";
    g.beginPath();
    if (m.kind === "work") g.arc(u, v, r, 0, Math.PI * 2);
    else {
      g.moveTo(u, v - r * 1.2);
      g.lineTo(u + r * 1.2, v);
      g.lineTo(u, v + r * 1.2);
      g.lineTo(u - r * 1.2, v);
      g.closePath();
    }
    g.fill();
    g.lineWidth = 2.5 * s;
    g.stroke();
    g.fillStyle = INK[m.kind];
    g.font = `bold ${Math.round(14 * s)}px ${PRINT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(m.kind === "work" ? "!" : "?", u, v + 1 * s);
    g.textBaseline = "alphabetic";
  } else if (m.kind === "bed") {
    const r = 6 * s;
    g.beginPath();
    g.moveTo(u - r, v + r * 0.7);
    g.lineTo(u - r, v - r * 0.1);
    g.lineTo(u, v - r);
    g.lineTo(u + r, v - r * 0.1);
    g.lineTo(u + r, v + r * 0.7);
    g.closePath();
    g.fill();
  } else if (m.kind === "place") {
    const r = 5 * s;
    g.fillRect(u - r, v - r, r * 2, r * 2);
  } else {
    g.beginPath();
    g.arc(u, v, 4 * s, 0, Math.PI * 2);
    g.fill();
  }
  if (n !== undefined) {
    g.font = `bold ${Math.round(12 * s)}px ${PRINT}`;
    g.textAlign = "center";
    g.fillStyle = INK[m.kind];
    g.fillText(String(n), u + 13 * s, v - 10 * s);
  }
}

const SCALE = 2; // px per metre on the stored map
/** The key to the marks in the big map's corner: its size (seven rows). */
const KEY_W = 180;
const KEY_H = 8 * 20 + 10;
/** The corner map: metres from Jef to its rim. */
const MINI_REACH_M = 110;

export class CityMap {
  open = false;
  private readonly el: HTMLDivElement;
  private readonly cv: HTMLCanvasElement;
  private readonly side: HTMLDivElement;
  private readonly keysLine: HTMLParagraphElement;
  private readonly base: HTMLCanvasElement;
  private readonly box: { e0: number; n0: number; e1: number; n1: number };
  private zoom = 1;
  /** Where the big map looks, in stored px from Jef (moved with WASD, the arrows, a drag). */
  private pan = { u: 0, v: 0 };
  private readonly held = new Set<string>();
  private dragging = false;
  private redrawT = 0;
  /** The work as listed beside the map (a number key finds one). */
  private listed: MapMark[] = [];
  /** Set by Jobs: the marks to draw. */
  marks: () => MapMark[] = () => [];
  /** T4 (docs/trade-plan.md, the quest book): where the followed job goes now; the map draws the way on foot to it. */
  wayGoal: () => { x: number; z: number } | null = () => null;
  /** Set by Jobs: a way on foot from the server's walk map (POST /api/town/ways), by key "x,z>x,z", or null. */
  askWay: ((key: string) => Promise<Array<[number, number]> | null>) | null = null;
  /** The way drawn now: asked from where Jef stood to the goal then; asked again when either moved on. */
  private way: { pts: Array<[number, number]> | null; gx: number; gz: number; ax: number; az: number } | null = null;
  private wayBusy = false;
  private wayAt = 0;

  // the corner map
  private readonly mini: HTMLDivElement;
  private readonly miniCv: HTMLCanvasElement;
  private readonly miniLast = { x: NaN, z: NaN, yaw: NaN, t: 0, since: 0 };
  private miniSizeT = 0;
  /** The city at the corner map's own scale, made once per size (a small picture to turn is cheap to draw). */
  private miniBase: HTMLCanvasElement | null = null;
  private miniBaseK = 0;

  constructor(private readonly player: FirstPerson) {
    this.el = document.createElement("div");
    this.el.className = "citymap paper";
    this.el.style.display = "none";
    const row = document.createElement("div");
    row.className = "citymap-row";
    this.cv = document.createElement("canvas");
    row.appendChild(this.cv);
    this.side = document.createElement("div");
    this.side.className = "citymap-side";
    row.appendChild(this.side);
    this.el.appendChild(row);
    this.keysLine = document.createElement("p");
    this.keysLine.className = "keys";
    this.el.appendChild(this.keysLine);
    document.body.appendChild(this.el);

    this.mini = document.createElement("div");
    this.mini.className = "minimap";
    this.mini.style.display = "none";
    this.miniCv = document.createElement("canvas");
    this.mini.appendChild(this.miniCv);
    document.body.appendChild(this.mini);

    const pts = data.area.map(([x, z]) => en(x, z));
    this.box = {
      e0: Math.min(...pts.map((p) => p[0])),
      e1: Math.max(...pts.map((p) => p[0])),
      n0: Math.min(...pts.map((p) => p[1])),
      n1: Math.max(...pts.map((p) => p[1])),
    };
    this.base = this.drawBase();
    window.addEventListener("keydown", (e) => this.onKey(e));
    window.addEventListener("keyup", (e) => this.held.delete(e.code));
    window.addEventListener("blur", () => this.held.clear());
    // the mouse on the big map: a drag moves it, the wheel zooms (the ink cursor keeps the lock: game/cursor.ts)
    window.addEventListener("mousedown", (e) => {
      if (this.open && e.button === 0) this.dragging = true;
    });
    window.addEventListener("mouseup", () => (this.dragging = false));
    document.addEventListener("mousemove", (e) => {
      if (!this.open || !this.dragging) return;
      const k = this.zoom * 0.5;
      this.pan.u -= e.movementX / k;
      this.pan.v -= e.movementY / k;
      this.render();
    });
    window.addEventListener(
      "wheel",
      (e) => {
        if (this.open) this.zoomBy(e.deltaY < 0 ? 1.25 : 1 / 1.25);
      },
      { passive: true },
    );
    settings.onChange((_p, changed) => {
      if (changed.includes("miniMap") || changed.includes("showFps") || changed.includes("textSize")) this.miniSizeT = 0;
    });
    dialogs.register("map", () => this.open); // focus fix: the pause knows it is up (game/dialogs.ts)
  }

  private px(x: number, z: number): [number, number] {
    const [e, n] = en(x, z);
    return [(e - this.box.e0) * SCALE, (this.box.n1 - n) * SCALE];
  }

  /** The city itself, drawn once. */
  private drawBase(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = Math.ceil((this.box.e1 - this.box.e0) * SCALE);
    c.height = Math.ceil((this.box.n1 - this.box.n0) * SCALE);
    const g = c.getContext("2d")!;
    g.fillStyle = "#e0d4b8";
    g.fillRect(0, 0, c.width, c.height);
    const path = (ring: number[][]) => {
      g.beginPath();
      ring.forEach(([x, z], i) => {
        const [u, v] = this.px(x, z);
        if (i) g.lineTo(u, v);
        else g.moveTo(u, v);
      });
      g.closePath();
    };
    // the river beyond the traced map, then the water inside it
    g.fillStyle = "#9fb4b2";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#e0d4b8";
    path(data.area);
    g.fill();
    g.fillStyle = "#9fb4b2";
    for (const w of data.water) {
      path(w.outer);
      g.fill();
    }
    // the grass round the town wall (tools/city/rampart.py)
    const extra = CITY as unknown as {
      decor?: { grass?: Array<{ outer: number[][] }>; rampart?: { tops: number[][][]; gates: Array<{ house: number[][]; passage: number[][]; bridge: number[][] }> } };
      alleys?: { lanes: number[][][]; yards: number[][][]; gardens: number[][][] };
    };
    g.fillStyle = "#b9c294";
    for (const gr of extra.decor?.grass ?? []) {
      path(gr.outer);
      g.fill();
    }
    g.fillStyle = "#e0d4b8";
    for (const w of data.water) {
      g.fillStyle = "#9fb4b2";
      path(w.outer);
      g.fill();
    }
    g.fillStyle = "#b8604a";
    g.strokeStyle = "#7a3a2c";
    g.lineWidth = 1;
    for (const b of data.blocks) {
      if (b.outer.length < 3) continue;
      path(b.outer);
      g.fill();
      g.stroke();
    }
    // the back alleys (tools/city/alleys.py): lanes and yards in the paper's colour, gardens green
    g.fillStyle = "#e0d4b8";
    for (const r of [...(extra.alleys?.lanes ?? []), ...(extra.alleys?.yards ?? [])]) {
      path(r);
      g.fill();
    }
    g.fillStyle = "#b9c294";
    for (const r of extra.alleys?.gardens ?? []) {
      path(r);
      g.fill();
    }
    // the town wall: the walk and the bastions, the gate houses, the bridges over the moat
    g.fillStyle = "#8a4a3a";
    g.strokeStyle = "#4a2418";
    for (const r of extra.decor?.rampart?.tops ?? []) {
      path(r);
      g.fill();
      g.stroke();
    }
    for (const gt of extra.decor?.rampart?.gates ?? []) {
      g.fillStyle = "#5a3024";
      path(gt.house);
      g.fill();
      for (const r of [gt.passage, gt.bridge]) {
        g.fillStyle = "#e0d4b8";
        path(r);
        g.fill();
      }
    }
    g.fillStyle = "#d8a45a";
    g.strokeStyle = "#5a3a1a";
    for (const [name, l] of Object.entries(data.landmarks)) {
      path(l.fp);
      g.fill();
      g.stroke();
      const cx = l.fp.reduce((a, p) => a + p[0], 0) / l.fp.length;
      const cz = l.fp.reduce((a, p) => a + p[1], 0) / l.fp.length;
      const [u, v] = this.px(cx, cz);
      g.fillStyle = "#2a2420";
      g.font = "bold 22px 'Scheldemist Print', Georgia, serif";
      g.textAlign = "center";
      g.fillText(LANDMARK_NAMES[name] ?? name, u, v + 7);
      g.fillStyle = "#d8a45a";
    }
    g.fillStyle = "#2a2420";
    for (const [name, x, z, rot] of PLACE_NAMES) {
      const [u, v] = this.px(x, z);
      g.save();
      g.translate(u, v);
      g.rotate(rot);
      g.font = name === name.toUpperCase() ? "bold 30px 'Scheldemist Print', Georgia, serif" : "italic 24px 'Scheldemist Print', Georgia, serif";
      g.textAlign = "center";
      g.fillText(name, 0, 0);
      g.restore();
    }
    // the paper: a faint grain
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(60,40,20,${Math.random() * 0.05})`;
      g.fillRect(Math.random() * c.width, Math.random() * c.height, 2, 2);
    }
    return c;
  }

  toggle(): void {
    this.open = !this.open;
    this.el.style.display = this.open ? "block" : "none";
    this.player.frozen = this.open;
    this.held.clear();
    this.dragging = false;
    if (this.open) {
      this.pan = { u: 0, v: 0 };
      this.keysLine.innerHTML = `${esc(keyLabel("KeyM"))} or Esc  close &middot; WASD, the arrows or a drag  move &middot; + and - or the wheel  zoom &middot; ${esc(keyLabel("KeyC"))}  back to you &middot; 1 to 9  find`;
      this.render();
    }
  }

  private zoomBy(f: number): void {
    this.zoom = Math.max(0.25, Math.min(4, this.zoom * f));
    this.render();
  }

  /** Every frame (Jobs.update): the big map's keys held down and its people moving, and the corner map. */
  update(dt: number): void {
    if (this.open) {
      let du = 0;
      let dv = 0;
      const h = this.held;
      if (h.has("KeyW") || h.has("ArrowUp")) dv -= 1;
      if (h.has("KeyS") || h.has("ArrowDown")) dv += 1;
      if (h.has("KeyA") || h.has("ArrowLeft")) du -= 1;
      if (h.has("KeyD") || h.has("ArrowRight")) du += 1;
      this.redrawT -= dt;
      if (du || dv) {
        const k = this.zoom * 0.5;
        this.pan.u += (du * 420 * dt) / k;
        this.pan.v += (dv * 420 * dt) / k;
        this.render();
      } else if (this.redrawT <= 0) this.render(); // the people with work walk about
    }
    this.updateMini(dt);
  }

  render(): void {
    this.redrawT = 0.5;
    const sideW = window.innerWidth > 900 ? 250 : 0;
    this.side.style.display = sideW ? "block" : "none";
    const W = Math.round(Math.max(320, Math.min(window.innerWidth * 0.86 - sideW - 30, 1000)));
    const H = Math.round(Math.min(window.innerHeight * 0.76, 760));
    if (this.cv.width !== W) this.cv.width = W;
    if (this.cv.height !== H) this.cv.height = H;
    this.side.style.height = `${H}px`;
    const g = this.cv.getContext("2d")!;
    const [ju, jv] = this.px(this.player.x, this.player.z);
    const pu = ju + this.pan.u;
    const pv = jv + this.pan.v;
    const k = this.zoom * 0.5; // screen px per stored px
    // off the traced map: the river to the west, blank paper elsewhere
    g.fillStyle = "#d6cbb0";
    g.fillRect(0, 0, W, H);
    g.fillStyle = "#9fb4b2";
    g.fillRect(0, 0, Math.max(0, W / 2 - pu * k), H);
    g.save();
    g.translate(W / 2, H / 2);
    g.scale(k, k);
    g.translate(-pu, -pv);
    g.drawImage(this.base, 0, 0);
    g.restore();
    const S = (x: number, z: number): [number, number] => {
      const [u, v] = this.px(x, z);
      return [W / 2 + (u - pu) * k, H / 2 + (v - pv) * k];
    };
    const marks = this.marks();
    const dist = (m: MapMark) => Math.hypot(m.x - this.player.x, m.z - this.player.z);
    // T4: the way on foot to the followed job, under the marks
    const wp = this.wayNow();
    if (wp) this.drawWay(g, wp, S, 3.5);
    // the list's order: your job first, then the nearest work, then what goes on in town
    const rank: Record<string, number> = { goal: 0, work: 1, event: 2 };
    const quests = marks.filter((m) => QUEST_KINDS.has(m.kind)).sort((a, b) => rank[a.kind] - rank[b.kind] || dist(a) - dist(b));
    this.listed = quests.slice(0, 9);
    const rest = marks.filter((m) => !QUEST_KINDS.has(m.kind));
    // labels never on top of each other: the work's first, then the places; the shops' only where there is room
    // (the key in the corner, the compass and the scale bar take their room first)
    const taken: Array<[number, number, number, number]> = [
      [W - KEY_W - 10, H - KEY_H - 10, W, H],
      [W - 50, 0, W, 34],
      [0, H - 44, 130, H],
    ];
    const room = (x: number, y: number, w: number, h: number) => !taken.some(([a, b, c, e]) => x < c && x + w > a && y < e && y + h > b);
    const label = (text: string, u: number, v: number, font: string, must: boolean) => {
      g.font = font;
      g.textAlign = "left";
      const w = g.measureText(text).width;
      // right of the mark, else left, above, below; the work's own name goes on the right when none has room
      const gap = must ? 17 : 10; // clear of the mark itself (the work's marks are in `taken`)
      const spots: Array<[number, number]> = [
        [u + gap, v - 9],
        [u - gap - w, v - 9],
        [u - w / 2, v - gap - 17],
        [u - w / 2, v + gap],
      ];
      let at = spots.find(([x, y]) => room(x, y, w, 17) && x > 2 && x + w < W - 2 && y > 2 && y + 17 < H - 2);
      if (!at) {
        if (!must) return;
        at = spots[u + gap + w < W - 2 ? 0 : 1];
      }
      const [x, y] = at;
      taken.push([x, y, x + w, y + 17]);
      // a pale edge so the ink reads on the red blocks
      const ink = g.fillStyle;
      g.lineWidth = 3;
      g.strokeStyle = "rgba(230, 220, 196, 0.85)";
      g.strokeText(text, x, y + 14);
      g.fillStyle = ink;
      g.fillText(text, x, y + 14);
    };
    const inside = (u: number, v: number) => u > 0 && u < W && v > 0 && v < H;
    // the places and shops under the work
    for (const m of rest) {
      const [u, v] = S(m.x, m.z);
      if (inside(u, v)) drawMark(g, m, u, v, m.kind === "shop" ? 0.9 : 1);
    }
    for (const m of quests.slice(9)) {
      const [u, v] = S(m.x, m.z);
      if (inside(u, v)) drawMark(g, m, u, v, 1);
    }
    // the work: kept at the edge with a pointer when it is off the paper
    for (let i = this.listed.length - 1; i >= 0; i--) {
      const m = this.listed[i];
      const [u, v] = S(m.x, m.z);
      const cu = Math.max(22, Math.min(W - 22, u));
      const cv = Math.max(22, Math.min(H - 22, v));
      drawMark(g, m, cu, cv, 1.2, i + 1);
      taken.push([cu - 14, cv - 14, cu + 14, cv + 14]);
      if (cu !== u || cv !== v) {
        const a = Math.atan2(v - cv, u - cu);
        g.save();
        g.translate(cu + Math.cos(a) * 18, cv + Math.sin(a) * 18);
        g.rotate(a);
        g.fillStyle = INK[m.kind];
        g.beginPath();
        g.moveTo(7, 0);
        g.lineTo(-4, -6);
        g.lineTo(-4, 6);
        g.closePath();
        g.fill();
        g.restore();
      }
    }
    for (let i = 0; i < this.listed.length; i++) {
      const m = this.listed[i];
      const [u, v] = S(m.x, m.z);
      g.fillStyle = INK[m.kind];
      label(m.label, Math.max(22, Math.min(W - 22, u)), Math.max(22, Math.min(H - 22, v)), `bold 16px ${HAND}`, true);
    }
    for (const m of rest) {
      const [u, v] = S(m.x, m.z);
      if (!inside(u, v) || (m.kind === "shop" && k < 0.7)) continue;
      g.fillStyle = INK[m.kind];
      label(m.label, u, v, `15px ${HAND}`, false);
    }
    // you: an arrow pointing where you look
    const [ux, uy] = S(this.player.x, this.player.z);
    if (inside(ux, uy)) {
      g.save();
      g.translate(ux, uy);
      g.rotate(this.lookAngle());
      g.fillStyle = "#101010";
      g.strokeStyle = "#efe6cc";
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(15, 0);
      g.lineTo(-10, -9);
      g.lineTo(-5, 0);
      g.lineTo(-10, 9);
      g.closePath();
      g.stroke();
      g.fill();
      g.restore();
    }
    // compass and scale
    g.fillStyle = "#2a2420";
    g.textAlign = "left";
    g.font = `bold 16px ${PRINT}`;
    g.fillText("N ↑", W - 44, 26);
    const bar = 100 * SCALE * k;
    g.fillRect(16, H - 22, bar, 4);
    g.font = `13px ${PRINT}`;
    g.fillText("100 m", 16, H - 28);
    this.drawKey(g, W, H);
    this.drawSide(dist);
  }

  /**
   * T4: the way on foot to the followed job's goal, as the server's walk map finds it (the townspeople's ways): asked
   * when the goal changes or Jef is 12 m from where it was asked, at most every 1.5 s. The points Jef has passed are
   * left out (the way from the nearest point on).
   */
  private wayNow(): Array<[number, number]> | null {
    const g = this.wayGoal();
    if (!g || !this.askWay) {
      this.way = null;
      return null;
    }
    const { x, z } = this.player;
    const w = this.way;
    const same = !!w && Math.hypot(w.gx - g.x, w.gz - g.z) < 2;
    if ((!same || Math.hypot(w!.ax - x, w!.az - z) > 12) && !this.wayBusy && performance.now() - this.wayAt > 1500) {
      this.wayBusy = true;
      this.wayAt = performance.now();
      const ask = { gx: g.x, gz: g.z, ax: x, az: z };
      this.askWay(`${Math.round(x)},${Math.round(z)}>${Math.round(g.x)},${Math.round(g.z)}`)
        .then((pts) => {
          this.way = { pts: pts && pts.length > 1 ? pts : null, ...ask };
          if (this.open) this.render();
        })
        .catch(() => {})
        .finally(() => (this.wayBusy = false));
    }
    if (!same || !w?.pts) return null;
    // from the nearest point on (what is behind him is walked)
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < w.pts.length; i++) {
      const d = Math.hypot(w.pts[i][0] - x, w.pts[i][1] - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return [[x, z], ...w.pts.slice(Math.min(best + 1, w.pts.length - 1))];
  }

  /** The way drawn in dotted ink, with a pale edge so it reads on the red blocks. */
  private drawWay(g: CanvasRenderingContext2D, pts: Array<[number, number]>, to: (x: number, z: number) => [number, number], w: number): void {
    g.save();
    g.lineJoin = "round";
    g.lineCap = "round";
    for (const [style, width, dash] of [
      ["rgba(230, 220, 196, 0.8)", w + 3, [] as number[]],
      [INK.goal, w, [w * 2.2, w * 1.8]],
    ] as const) {
      g.strokeStyle = style;
      g.lineWidth = width;
      g.setLineDash(dash as number[]);
      g.beginPath();
      pts.forEach(([x, z], i) => {
        const [u, v] = to(x, z);
        if (i) g.lineTo(u, v);
        else g.moveTo(u, v);
      });
      g.stroke();
    }
    g.restore();
  }

  /** The key to the marks, in the bottom right corner of the paper. */
  private drawKey(g: CanvasRenderingContext2D, W: number, H: number): void {
    const rows: Array<[MapMark["kind"] | "you" | "way", string]> = [
      ["you", "you"],
      ["goal", "your job: go here"],
      ["way", "the way there on foot"],
      ["work", "work offered"],
      ["event", "going on in town"],
      ["place", "hiring board, a box"],
      ["shop", "shop or tavern"],
      ["bed", "a bed for the night"],
    ];
    const w = KEY_W;
    const h = KEY_H;
    const x0 = W - w - 10;
    const y0 = H - h - 10;
    g.fillStyle = "rgba(230, 220, 196, 0.92)";
    g.fillRect(x0, y0, w, h);
    g.strokeStyle = "#5a4a3a";
    g.lineWidth = 1;
    g.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
    rows.forEach(([kind, text], i) => {
      const u = x0 + 18;
      const v = y0 + 15 + i * 20;
      if (kind === "you") {
        g.fillStyle = "#101010";
        g.beginPath();
        g.moveTo(u + 8, v);
        g.lineTo(u - 6, v - 5);
        g.lineTo(u - 3, v);
        g.lineTo(u - 6, v + 5);
        g.closePath();
        g.fill();
      } else if (kind === "way") this.drawWay(g, [[0, 0], [1, 0]], (x) => [u - 9 + x * 20, v], 2.5);
      else drawMark(g, { x: 0, z: 0, label: "", kind }, u, v, 0.7);
      g.fillStyle = "#2a2420";
      g.font = `14px ${HAND}`;
      g.textAlign = "left";
      g.fillText(text, x0 + 36, v + 5);
    });
  }

  /** The work beside the map, numbered as on it, with how far and which way. */
  private drawSide(dist: (m: MapMark) => number): void {
    if (this.side.style.display === "none") return;
    const part = (title: string, kind: MapMark["kind"]) => {
      const items = this.listed.map((m, i) => [m, i] as const).filter(([m]) => m.kind === kind);
      if (!items.length) return "";
      const li = items.map(
        ([m, i]) =>
          `<li style="color:${INK[m.kind]}"><span class="n">${i + 1}</span> ${esc(m.label)}${m.detail ? `<i>${esc(m.detail)}</i>` : ""}<small>${metres(dist(m))} ${way(m.x - this.player.x, m.z - this.player.z)}</small></li>`,
      );
      return `<h3>${title}</h3><ol>${li.join("")}</ol>`;
    };
    const html = part("Your job", "goal") + part("Work offered", "work") + part("Going on in town", "event") || `<p class="none">No work in hand and none offered near. Try the hiring board.</p>`;
    if (this.side.innerHTML !== html) this.side.innerHTML = html;
  }

  /** The screen angle (0 = east, y down) of where Jef looks, on a north-up map. */
  private lookAngle(): number {
    const fx = -Math.sin(this.player.yaw);
    const fz = -Math.cos(this.player.yaw);
    const [ae, an] = [fx * SIN + fz * COS, fx * COS - fz * SIN];
    return Math.atan2(-an, ae);
  }

  // ------------------------------------------------------------------ the corner map

  /** The corner map's width on screen now (0 when it is off), for the ink tick to keep clear of it. */
  miniWidth(): number {
    return this.mini.style.display === "none" ? 0 : this.mini.offsetWidth;
  }

  private updateMini(dt: number): void {
    const size = settings.get("miniMap");
    const show = size !== "off" && !dialogs.any();
    if ((this.mini.style.display !== "none") !== show) {
      this.mini.style.display = show ? "block" : "none";
      this.miniSizeT = 0;
      this.miniLast.x = NaN;
    }
    if (!show) return;
    // its size: the setting times the UI scale (style.css); looked up now and then, not every frame
    this.miniSizeT -= dt;
    if (this.miniSizeT <= 0) {
      this.miniSizeT = 1;
      this.mini.classList.toggle("large", size === "large");
      this.mini.classList.toggle("below-fps", settings.get("showFps"));
      const px = Math.round(this.mini.clientWidth * Math.min(2, window.devicePixelRatio || 1));
      if (px > 0 && this.miniCv.width !== px) {
        this.miniCv.width = this.miniCv.height = px;
        this.miniLast.x = NaN;
      }
    }
    // drawn again when Jef moves or turns, at most 30 times a second, and twice a second for the people with work
    const L = this.miniLast;
    L.since += dt;
    L.t -= dt;
    const moved = Number.isNaN(L.x) || Math.hypot(this.player.x - L.x, this.player.z - L.z) > 0.03 || Math.abs(this.player.yaw - L.yaw) > 0.004;
    if (L.since < 1 / 30 || (!moved && L.t > 0)) return;
    L.x = this.player.x;
    L.z = this.player.z;
    L.yaw = this.player.yaw;
    L.t = 0.5;
    L.since = 0;
    this.drawMini();
  }

  private drawMini(): void {
    const c = this.miniCv;
    const g = c.getContext("2d")!;
    const D = c.width;
    if (!D) return;
    const R = D / 2;
    const s = D / 200; // the marks' size
    const r = R - 2 * s;
    const [pu, pv] = this.px(this.player.x, this.player.z);
    const k = r / (MINI_REACH_M * SCALE); // canvas px per stored px
    // turned so that where Jef looks is up
    const rot = -Math.PI / 2 - this.lookAngle();
    g.clearRect(0, 0, D, D);
    g.save();
    g.beginPath();
    g.arc(R, R, r, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = "#d6cbb0";
    g.fillRect(0, 0, D, D);
    g.translate(R, R);
    g.rotate(rot);
    if (this.miniBaseK !== k || !this.miniBase) {
      const mb = document.createElement("canvas");
      mb.width = Math.ceil(this.base.width * k);
      mb.height = Math.ceil(this.base.height * k);
      const mg = mb.getContext("2d")!;
      mg.imageSmoothingQuality = "high";
      mg.drawImage(this.base, 0, 0, mb.width, mb.height);
      this.miniBase = mb;
      this.miniBaseK = k;
    }
    const mb = this.miniBase;
    // only the part of the city under the circle (in the small picture's px)
    const cu = pu * k;
    const cv = pv * k;
    const q = r + 2;
    if (cu - q < 0) {
      // the river west of the traced map
      g.fillStyle = "#9fb4b2";
      g.fillRect(-q, -q, q - cu, 2 * q);
    }
    const sx = Math.max(0, Math.floor(cu - q));
    const sy = Math.max(0, Math.floor(cv - q));
    const sw = Math.min(mb.width, Math.ceil(cu + q)) - sx;
    const sh = Math.min(mb.height, Math.ceil(cv + q)) - sy;
    if (sw > 0 && sh > 0) g.drawImage(mb, sx, sy, sw, sh, sx - cu, sy - cv, sw, sh);
    g.restore();
    // the marks: the work stays on the rim when it is further than the map reaches
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    const at = (x: number, z: number): [number, number, number] => {
      const [u, v] = this.px(x, z);
      const du = (u - pu) * k;
      const dv = (v - pv) * k;
      const a = du * cs - dv * sn;
      const b = du * sn + dv * cs;
      return [R + a, R + b, Math.hypot(a, b)];
    };
    // T4: the way on foot to the followed job (inside the circle)
    const wp = this.wayNow();
    if (wp) {
      g.save();
      g.beginPath();
      g.arc(R, R, r, 0, Math.PI * 2);
      g.clip();
      this.drawWay(g, wp, (x, z) => at(x, z) as unknown as [number, number], 2.5 * s);
      g.restore();
    }
    const marks = this.marks();
    for (const m of marks) {
      if (QUEST_KINDS.has(m.kind)) continue;
      const [u, v, dd] = at(m.x, m.z);
      if (dd < r - 5 * s) drawMark(g, m, u, v, (m.kind === "shop" ? 0.55 : 0.7) * s);
    }
    const order: Record<string, number> = { event: 0, work: 1, goal: 2 };
    for (const m of marks.filter((q2) => QUEST_KINDS.has(q2.kind)).sort((a, b) => order[a.kind] - order[b.kind])) {
      let [u, v, dd] = at(m.x, m.z);
      const edge = r - 12 * s;
      if (dd > edge) {
        if (m.kind === "event" && dd > r * 3) continue; // an event far off: the big map lists it
        u = R + ((u - R) / dd) * edge;
        v = R + ((v - R) / dd) * edge;
      }
      drawMark(g, m, u, v, 0.8 * s);
    }
    // north on the rim
    const na = rot - Math.PI / 2;
    const nx = R + Math.cos(na) * (r - 10 * s);
    const ny = R + Math.sin(na) * (r - 10 * s);
    g.fillStyle = "#2a2420";
    g.beginPath();
    g.arc(nx, ny, 8 * s, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#efe6cc";
    g.font = `bold ${Math.round(11 * s)}px ${PRINT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("N", nx, ny + 0.5 * s);
    g.textBaseline = "alphabetic";
    // you, in the middle, looking up
    g.fillStyle = "#101010";
    g.strokeStyle = "#efe6cc";
    g.lineWidth = 2 * s;
    g.beginPath();
    g.moveTo(R, R - 10 * s);
    g.lineTo(R - 7 * s, R + 7 * s);
    g.lineTo(R, R + 3 * s);
    g.lineTo(R + 7 * s, R + 7 * s);
    g.closePath();
    g.stroke();
    g.fill();
    // the rim
    g.strokeStyle = "#4a3424";
    g.lineWidth = 3 * s;
    g.beginPath();
    g.arc(R, R, r, 0, Math.PI * 2);
    g.stroke();
  }

  /** Dev (the browser check): what the maps show now. */
  info(): { open: boolean; zoom: number; pan: { u: number; v: number }; listed: string[]; mini: { on: boolean; px: number } } {
    return {
      open: this.open,
      zoom: this.zoom,
      pan: { ...this.pan },
      listed: this.listed.map((m) => `${m.kind}: ${m.label}`),
      mini: { on: this.mini.style.display !== "none", px: this.miniCv.width },
    };
  }

  private onKey(e: KeyboardEvent): void {
    if (document.activeElement instanceof HTMLInputElement) return;
    if (this.open && /^(Key[WASD]|Arrow(Up|Down|Left|Right))$/.test(e.code)) {
      this.held.add(e.code);
      return;
    }
    if (e.repeat) return;
    if (e.code === "KeyM") {
      if (this.open || !this.player.frozen) this.toggle();
      return;
    }
    if (!this.open) return;
    if (e.code === "Escape") return this.toggle();
    if (e.key === "+" || e.key === "=") return this.zoomBy(1.5);
    if (e.key === "-") return this.zoomBy(1 / 1.5);
    if (e.code === "KeyC") {
      this.pan = { u: 0, v: 0 };
      return this.render();
    }
    const n = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    const m = n ? this.listed[Number(n[1]) - 1] : undefined;
    if (m) {
      const [u, v] = this.px(m.x, m.z);
      const [ju, jv] = this.px(this.player.x, this.player.z);
      this.pan = { u: u - ju, v: v - jv };
      this.render();
    }
  }
}
