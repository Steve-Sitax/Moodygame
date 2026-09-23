import CITY from "../../../shared/city.json";
import type { FirstPerson } from "../player/firstPerson";

// The paper map (M). Drawn from the traced 1873 city (shared/city.json) in the
// colours of the Vuillaume map: red blocks, blue-grey water, ink names.
// North is up, so the map turns the game world back by its 19-24 degrees.
// Marks come from the game: you, the job's goal, people with work, the board,
// the doss house, the shops.

export interface MapMark {
  x: number;
  z: number;
  label: string;
  kind: "goal" | "work" | "place" | "shop" | "bed";
}

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
  .map(([name, p]) => [p.kind === "water" || p.kind === "quay" ? name : name.toUpperCase(), p.x, p.z, 0]);

const SCALE = 2; // px per metre on the stored map

export class CityMap {
  open = false;
  private readonly el: HTMLDivElement;
  private readonly cv: HTMLCanvasElement;
  private readonly base: HTMLCanvasElement;
  private readonly box: { e0: number; n0: number; e1: number; n1: number };
  private zoom = 1;
  /** Set by Jobs: the marks to draw. */
  marks: () => MapMark[] = () => [];

  constructor(private readonly player: FirstPerson) {
    this.el = document.createElement("div");
    this.el.className = "citymap paper";
    this.el.style.display = "none";
    this.cv = document.createElement("canvas");
    this.el.appendChild(this.cv);
    const keys = document.createElement("p");
    keys.className = "keys";
    keys.innerHTML = "M or Esc  close &middot; + and -  zoom";
    this.el.appendChild(keys);
    document.body.appendChild(this.el);

    const pts = data.area.map(([x, z]) => en(x, z));
    this.box = {
      e0: Math.min(...pts.map((p) => p[0])),
      e1: Math.max(...pts.map((p) => p[0])),
      n0: Math.min(...pts.map((p) => p[1])),
      n1: Math.max(...pts.map((p) => p[1])),
    };
    this.base = this.drawBase();
    window.addEventListener("keydown", (e) => this.onKey(e));
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
    g.fillStyle = "#b8604a";
    g.strokeStyle = "#7a3a2c";
    g.lineWidth = 1;
    for (const b of data.blocks) {
      if (b.outer.length < 3) continue;
      path(b.outer);
      g.fill();
      g.stroke();
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
      g.font = "bold 22px Georgia, serif";
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
      g.font = name === name.toUpperCase() ? "bold 30px Georgia, serif" : "italic 24px Georgia, serif";
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
    if (this.open) this.render();
  }

  render(): void {
    const W = Math.min(window.innerWidth * 0.8, 1100);
    const H = Math.min(window.innerHeight * 0.78, 760);
    this.cv.width = W;
    this.cv.height = H;
    const g = this.cv.getContext("2d")!;
    const [pu, pv] = this.px(this.player.x, this.player.z);
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
    // marks
    g.font = "15px 'Segoe Print', 'Bradley Hand', cursive";
    g.textAlign = "left";
    for (const m of this.marks()) {
      const [u, v] = S(m.x, m.z);
      const clampedU = Math.max(14, Math.min(W - 14, u));
      const clampedV = Math.max(14, Math.min(H - 14, v));
      const off = clampedU !== u || clampedV !== v;
      g.strokeStyle = g.fillStyle = m.kind === "goal" ? "#8a1a10" : m.kind === "work" ? "#1a3a6a" : "#2a2420";
      g.lineWidth = 3;
      if (m.kind === "goal") {
        g.beginPath();
        g.moveTo(clampedU - 8, clampedV - 8);
        g.lineTo(clampedU + 8, clampedV + 8);
        g.moveTo(clampedU + 8, clampedV - 8);
        g.lineTo(clampedU - 8, clampedV + 8);
        g.stroke();
      } else {
        g.beginPath();
        g.arc(clampedU, clampedV, m.kind === "work" ? 7 : 5, 0, Math.PI * 2);
        if (m.kind === "work") g.stroke();
        else g.fill();
      }
      g.fillText(off ? `${m.label} →` : m.label, clampedU + 11, clampedV + 5);
    }
    // you: an arrow pointing where you look
    const [ux, uy] = [W / 2, H / 2];
    const fx = -Math.sin(this.player.yaw);
    const fz = -Math.cos(this.player.yaw);
    const [ae, an] = [fx * SIN + fz * COS, fx * COS - fz * SIN];
    const ang = Math.atan2(-an, ae);
    g.save();
    g.translate(ux, uy);
    g.rotate(ang);
    g.fillStyle = "#101010";
    g.beginPath();
    g.moveTo(12, 0);
    g.lineTo(-8, -7);
    g.lineTo(-4, 0);
    g.lineTo(-8, 7);
    g.closePath();
    g.fill();
    g.restore();
    // compass and scale
    g.fillStyle = "#2a2420";
    g.font = "bold 16px Georgia, serif";
    g.fillText("N ↑", W - 44, 26);
    const bar = 100 * SCALE * k;
    g.fillRect(16, H - 22, bar, 4);
    g.font = "13px Georgia, serif";
    g.fillText("100 m", 16, H - 28);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.repeat) return;
    if (document.activeElement instanceof HTMLInputElement) return;
    if (e.code === "KeyM") {
      if (this.open || !this.player.frozen) this.toggle();
      return;
    }
    if (!this.open) return;
    if (e.code === "Escape") this.toggle();
    if (e.key === "+" || e.key === "=") this.zoom = Math.min(4, this.zoom * 1.5);
    if (e.key === "-") this.zoom = Math.max(0.25, this.zoom / 1.5);
    this.render();
  }
}
