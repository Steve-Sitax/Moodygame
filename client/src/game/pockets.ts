import { api, type JobsPayload, type PocketItem } from "../net/api";
import type { FirstPerson } from "../player/firstPerson";
import { esc } from "./runs";

// Pockets and needs on screen (M3b). Paper and ink, docs/05: needs as small
// drawings, not bars. Six slots always in view; I opens them to eat or look.

const INK = "#2a2420";
const SLOTS = 6;

type Draw = (g: CanvasRenderingContext2D) => void;

const ICON: Record<string, Draw> = {
  herring: (g) => {
    g.beginPath();
    g.ellipse(14, 16, 10, 4.5, -0.2, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(23, 13.5);
    g.lineTo(29, 9);
    g.lineTo(28, 20);
    g.closePath();
    g.stroke();
    g.fillRect(8, 14, 2, 2);
  },
  eel: (g) => {
    g.beginPath();
    g.moveTo(3, 18);
    for (let x = 3; x <= 29; x += 2) g.lineTo(x, 16 + Math.sin(x / 3) * 4);
    g.lineWidth = 3;
    g.stroke();
    g.lineWidth = 1.5;
  },
  biscuit: (g) => {
    g.strokeRect(7, 8, 18, 16);
    for (const [x, y] of [[11, 12], [16, 12], [21, 12], [11, 19], [16, 19], [21, 19]]) g.fillRect(x, y, 1.5, 1.5);
  },
  jenever: (g) => {
    g.strokeRect(11, 11, 10, 16);
    g.strokeRect(14, 5, 4, 6);
  },
  // M3e: the town's shops
  bread: (g) => {
    g.beginPath();
    g.ellipse(16, 18, 12, 7, 0, Math.PI, 0);
    g.lineTo(28, 22);
    g.lineTo(4, 22);
    g.closePath();
    g.stroke();
    for (const x of [10, 16, 22]) {
      g.beginPath();
      g.moveTo(x - 2, 14);
      g.lineTo(x + 2, 12);
      g.stroke();
    }
  },
  apple: (g) => {
    g.beginPath();
    g.arc(16, 18, 8, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(16, 10);
    g.lineTo(17, 5);
    g.moveTo(17, 7);
    g.quadraticCurveTo(22, 4, 23, 8);
    g.stroke();
  },
  // M6: the paper (folded, lines of print), a letter (an envelope, a seal), a pawn ticket (a numbered card)
  newspaper: (g) => {
    g.strokeRect(5, 7, 22, 18);
    g.fillRect(8, 9, 16, 2.5);
    for (const y of [14, 17, 20, 23]) {
      g.fillRect(8, y, 7, 0.9);
      g.fillRect(17, y, 7, 0.9);
    }
  },
  letter: (g) => {
    g.strokeRect(5, 9, 22, 15);
    g.beginPath();
    g.moveTo(5, 9);
    g.lineTo(16, 18);
    g.lineTo(27, 9);
    g.stroke();
    g.beginPath();
    g.arc(16, 18, 2.2, 0, Math.PI * 2);
    g.fill();
  },
  letters: (g) => {
    for (const o of [0, 3, 6]) g.strokeRect(4 + o, 6 + o, 18, 12);
    g.beginPath();
    g.moveTo(17, 6);
    g.lineTo(17, 30);
    g.stroke();
  },
  pawn_ticket: (g) => {
    g.strokeRect(6, 8, 20, 16);
    g.beginPath();
    g.arc(10, 12, 1.6, 0, Math.PI * 2);
    g.stroke();
    g.font = "bold 8px Georgia, serif";
    g.fillText("No.", 13, 15);
    g.fillRect(9, 19, 14, 1);
  },
  parcel: (g) => {
    g.strokeRect(6, 9, 20, 15);
    g.beginPath();
    g.moveTo(16, 9);
    g.lineTo(16, 24);
    g.moveTo(6, 16);
    g.lineTo(26, 16);
    g.stroke();
  },
};

function icon(kind: string): string {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  g.strokeStyle = INK;
  g.fillStyle = INK;
  g.lineWidth = 1.5;
  (ICON[kind] ?? ICON.parcel)(g);
  return c.toDataURL();
}

const cache = new Map<string, string>();
const iconUrl = (kind: string) => {
  let u = cache.get(kind);
  if (!u) cache.set(kind, (u = icon(kind)));
  return u;
};

/**
 * Needs, one row each with its name (Steve: "these icons I have no idea what they
 * mean"): a word, then five small drawings, full or hollow (one per 2 points):
 * loaves (food), flames (warmth), moons (sleep), hearts (health). A low need is red.
 */
function needsDrawing(food: number, warmth: number, sleep: number, health: number): string {
  const S = 2; // drawn at twice the size, shown at half: crisp on big screens
  const c = document.createElement("canvas");
  c.width = 200 * S;
  c.height = 92 * S;
  const g = c.getContext("2d")!;
  g.scale(S, S);
  g.lineWidth = 1.3;
  const loaf = (x: number, y: number) => {
    g.ellipse(x + 5, y + 1, 5, 3.4, 0, Math.PI, 0);
    g.lineTo(x + 10, y + 3.5);
    g.lineTo(x, y + 3.5);
    g.closePath();
  };
  const flame = (x: number, y: number) => {
    g.moveTo(x + 5, y - 6);
    g.quadraticCurveTo(x + 11, y + 1, x + 5, y + 6);
    g.quadraticCurveTo(x - 1, y + 1, x + 5, y - 6);
  };
  const moon = (x: number, y: number) => {
    g.arc(x + 5, y, 5, Math.PI * 0.35, Math.PI * 1.65);
    g.arc(x + 7.5, y, 4, Math.PI * 1.45, Math.PI * 0.55, true);
    g.closePath();
  };
  const heart = (x: number, y: number) => {
    g.moveTo(x + 5, y + 6);
    g.bezierCurveTo(x - 3, y, x + 1, y - 7, x + 5, y - 2);
    g.bezierCurveTo(x + 9, y - 7, x + 13, y, x + 5, y + 6);
  };
  const rows: Array<[string, number, (x: number, y: number) => void]> = [
    ["Food", food, loaf],
    ["Warmth", warmth, flame],
    ["Sleep", sleep, moon],
    ["Health", health, heart],
  ];
  g.font = "bold 14px Georgia, 'Palatino Linotype', serif";
  g.textBaseline = "middle";
  rows.forEach(([label, v, draw], r) => {
    const y = 12 + r * 22;
    const col = v <= 2 ? "#8a1c10" : INK;
    g.fillStyle = col;
    g.strokeStyle = col;
    g.fillText(label, 4, y);
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      draw(76 + i * 17, y);
      if (v >= (i + 1) * 2) g.fill();
      else g.stroke();
    }
  });
  return c.toDataURL();
}

export class Pockets {
  items: PocketItem[] = [];
  open = false;
  private readonly bar: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly needsImg: HTMLImageElement;
  private lastNeeds = "";
  toast: (t: string) => void = () => {};
  onChange: (p: JobsPayload) => void = () => {};
  /** M6 (game/press.ts): a paper, a letter or a pawn ticket to read. */
  onRead: (it: PocketItem) => void = () => {};

  constructor(
    private readonly player: FirstPerson,
    hud: HTMLElement,
  ) {
    this.bar = document.createElement("div");
    this.bar.className = "pockets";
    document.body.appendChild(this.bar);
    this.panel = document.createElement("div");
    this.panel.className = "pocket-panel paper";
    this.panel.style.display = "none";
    document.body.appendChild(this.panel);
    this.needsImg = document.createElement("img");
    this.needsImg.className = "needs";
    hud.after(this.needsImg);
    window.addEventListener("keydown", (e) => this.onKey(e));
  }

  apply(p: JobsPayload): void {
    this.items = p.pockets ?? [];
    const { food, warmth, sleep, health } = p.player;
    const key = `${food}/${warmth}/${sleep}/${health}`;
    if (key !== this.lastNeeds) {
      this.lastNeeds = key;
      this.needsImg.src = needsDrawing(food, warmth, sleep, health);
      this.needsImg.title = `food ${food}/10, warmth ${warmth}/10, sleep ${sleep}/10, health ${health}/10`;
    }
    this.render();
  }

  hasJobParcel(jobId: number): boolean {
    return this.items.some((i) => i.job_id === jobId);
  }

  private render(): void {
    const cells = Array.from({ length: SLOTS }, (_, i) => {
      const it = this.items[i];
      return `<div class="slot">${it ? `<img src="${iconUrl(it.kind)}" alt="${esc(it.name)}">` : ""}</div>`;
    }).join("");
    this.bar.innerHTML = `${cells}<span class="key">I</span>`;
    if (this.open) this.renderPanel();
  }

  private renderPanel(): void {
    const rows = this.items.length
      ? this.items
          .map(
            (it, i) =>
              `<li><span class="n">${i + 1}</span><img src="${iconUrl(it.kind)}" alt=""> ${esc(it.name)}` +
              `<span class="what">${it.use ? esc(it.use) : it.note ? esc(it.note) : ""}</span></li>`,
          )
          .join("")
      : `<li class="empty">Your pockets are empty. Lint, and a button.</li>`;
    this.panel.innerHTML = `<h3>Pockets</h3><ol>${rows}</ol><p class="keys">1-6 eat, drink or read &middot; I to close</p>`;
  }

  toggle(): void {
    this.open = !this.open;
    this.panel.style.display = this.open ? "block" : "none";
    this.player.frozen = this.open;
    if (this.open) this.renderPanel();
  }

  private async use(index: number): Promise<void> {
    const it = this.items[index];
    if (!it) return;
    if (it.use === "read") return this.onRead(it);
    if (!it.use) return this.toast(it.note ?? "Not yours to use.");
    try {
      const r = await api.use(it.id);
      this.toast(r.text);
      this.onChange(r);
    } catch (e) {
      this.toast((e as Error).message);
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (e.repeat) return;
    if (document.activeElement instanceof HTMLInputElement) return;
    if (e.code === "KeyI") {
      // only when no other paper is up (board, talk) or when pockets are the one open
      if (this.open || !this.player.frozen) this.toggle();
      return;
    }
    if (!this.open) return;
    if (e.code === "Escape") return this.toggle();
    const n = Number(e.key);
    if (n >= 1 && n <= SLOTS) {
      // use it and close the pockets (Steve: "when pressed I and a number, close I")
      void this.use(n - 1);
      this.toggle();
    }
  }
}
