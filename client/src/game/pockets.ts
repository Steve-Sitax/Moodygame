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

/** Five small loaves (food) and five small flames (warmth), full or hollow. */
function needsDrawing(food: number, warmth: number): string {
  const c = document.createElement("canvas");
  c.width = 110;
  c.height = 30;
  const g = c.getContext("2d")!;
  g.strokeStyle = INK;
  g.fillStyle = INK;
  g.lineWidth = 1.2;
  for (let i = 0; i < 5; i++) {
    const x = 4 + i * 10;
    g.beginPath();
    g.ellipse(x + 4, 10, 4, 2.6, 0, Math.PI, 0);
    g.lineTo(x + 8, 12);
    g.lineTo(x, 12);
    g.closePath();
    if (food >= (i + 1) * 2) g.fill();
    else g.stroke();
  }
  for (let i = 0; i < 5; i++) {
    const x = 58 + i * 10;
    g.beginPath();
    g.moveTo(x + 4, 16);
    g.quadraticCurveTo(x + 9, 22, x + 4, 28);
    g.quadraticCurveTo(x - 1, 22, x + 4, 16);
    if (warmth >= (i + 1) * 2) g.fill();
    else g.stroke();
  }
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
    const key = `${p.player.food}/${p.player.warmth}`;
    if (key !== this.lastNeeds) {
      this.lastNeeds = key;
      this.needsImg.src = needsDrawing(p.player.food, p.player.warmth);
      this.needsImg.title = `belly ${p.player.food}/10, warmth ${p.player.warmth}/10`;
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
    this.panel.innerHTML = `<h3>Pockets</h3><ol>${rows}</ol><p class="keys">1-6 eat or drink &middot; I to close</p>`;
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
    if (n >= 1 && n <= SLOTS) void this.use(n - 1);
  }
}
