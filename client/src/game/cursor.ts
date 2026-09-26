// The mouse in the dialogs (Steve 2026-09-26: "dialogs in game should be clickable by mouse, not selecting
// numbers, also in inventory or any place where we can use a mouse ... Maybe in game sort of mouse cursor
// that cannot go off screen?").
//
// While a dialog is up (game/dialogs.ts) the game keeps the mouse lock, and the mouse moves an ink cursor
// drawn in the page instead of the look: it cannot leave the window, so the pause works as ever (leaving
// the window is still Alt-Tab or Esc). Releasing the lock and showing the real cursor was the other way:
// then every dialog would pause the game (the pause is "the game does not have the mouse"), the mouse could
// wander off the window, and taking the lock back after the dialog needs a click (the browser refuses it
// from a timer, e.g. the talk closing itself after a goodbye).
//
// What can be clicked is found in each dialog as it is drawn, no dialog needs to know: a line with a number
// badge (<li><span class="n">2</span> ...) is the key 2; a key named in the keys line ("T  say it your way",
// "E or Esc to step away", "R: run") is that key. A click sends the dialog that key, so the keys and the
// mouse do the same thing. A click on a dialog's input puts the cursor in it. Without the lock (the dev's
// free input, or the browser refused it) the real mouse clicks the same lines.

import type { FirstPerson } from "../player/firstPerson";
import { dialogs } from "./dialogs";
import { pause } from "./pause";

/** A key named at the start of a keys line's part: the key, then a colon, two spaces, " or " or " to ". */
const KEY_RE = /^(Esc|Enter|[A-Z]|[1-9])(?=:|\s{2,}|\s+or\s|\s+to\s)/;
/** Never decorated: the menu, the settings and save panels, the pause card and hint. */
const NOT_DIALOG = "#start, .settings, .pause-ui, .ink-cursor, canvas, script, style";

function codeOf(k: string): string {
  if (k === "Esc") return "Escape";
  if (k === "Enter") return "Enter";
  if (/^[1-9]$/.test(k)) return `Digit${k}`;
  return `Key${k}`;
}
function keyOf(code: string): string {
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Key")) return code.slice(3).toLowerCase();
  return code;
}

/** Send a key to the game as the keyboard does (to the focused input, else the page), down and up. */
export function sendKey(code: string): void {
  const a = document.activeElement;
  const target = a instanceof HTMLElement && a !== document.body ? a : document.body;
  const init = { code, key: keyOf(code), bubbles: true, cancelable: true };
  target.dispatchEvent(new KeyboardEvent("keydown", init));
  target.dispatchEvent(new KeyboardEvent("keyup", init));
}

/** A keys line's text: its parts split at the dots; a part that starts with a key becomes a clickable span. */
function splitText(t: Text): void {
  const parts = t.data.split("·");
  const norm = (s: string) => s.replace(/ /g, " ");
  if (!parts.some((p) => KEY_RE.test(norm(p).trim()))) return;
  const frag = document.createDocumentFragment();
  parts.forEach((p, i) => {
    if (i) frag.append("·");
    const lead = /^[\s ]*/.exec(p)![0];
    const trail = /[\s ]*$/.exec(p.slice(lead.length))![0];
    const body = p.slice(lead.length, p.length - trail.length);
    const m = KEY_RE.exec(norm(body));
    frag.append(lead);
    if (m && body) {
      const s = document.createElement("span");
      s.className = "ink-click ink-key";
      s.dataset.key = codeOf(m[1]);
      s.textContent = body;
      frag.append(s);
    } else frag.append(body);
    frag.append(trail);
  });
  t.replaceWith(frag);
}

/** Mark what can be clicked in one of the page's panels (again after each redraw: the marks go with the old nodes). */
export function decorate(root: Element): void {
  if (root.matches(NOT_DIALOG)) return;
  for (const li of Array.from(root.querySelectorAll<HTMLElement>("li"))) {
    if (li.dataset.key || li.classList.contains("gone") || li.classList.contains("empty")) continue;
    const n = Number(li.querySelector(".n")?.textContent?.trim());
    if (n >= 1 && n <= 9) {
      li.dataset.key = `Digit${n}`;
      li.classList.add("ink-click");
    }
  }
  for (const k of Array.from(root.querySelectorAll<HTMLElement>(".keys:not([data-inked])"))) {
    k.dataset.inked = "1";
    for (const node of Array.from(k.childNodes)) if (node.nodeType === Node.TEXT_NODE) splitText(node as Text);
  }
  for (const i of Array.from(root.querySelectorAll<HTMLElement>("input:not(.ink-click), textarea:not(.ink-click)"))) i.classList.add("ink-click");
}

const QUILL = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 30 30">
  <path d="M1.5 1.5 C6 3 10 5.5 14 9 C19 13.5 24 20 28.5 28.5 C21 25 13.5 19.5 8.5 14 C5 10.2 2.8 6 1.5 1.5 Z" fill="#efe6cf" stroke="#2a241c" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M1.5 1.5 L21 21" stroke="#2a241c" stroke-width="1.1" stroke-linecap="round"/>
  <path d="M9 7.5 L6.8 11 M13.2 11.2 L10.8 15 M17.2 15.2 L14.8 19 M21 19.6 L18.8 23" stroke="#2a241c" stroke-width="0.8" opacity="0.55"/>
  <path d="M1.5 1.5 L5.2 2.9 L2.9 5.2 Z" fill="#2a241c"/>
</svg>`;

const CSS = `
.ink-click { pointer-events: auto; cursor: pointer; border-radius: 3px; transition: background-color 0.08s, box-shadow 0.08s; }
input.ink-click, textarea.ink-click { cursor: text; }
.ink-click:not(input):not(textarea):hover, .ink-click.ink-hot { background-color: rgba(122, 88, 40, 0.16); box-shadow: 0 0 0 2px rgba(122, 88, 40, 0.16); }
input.ink-click.ink-hot, textarea.ink-click.ink-hot { box-shadow: 0 0 0 2px rgba(122, 88, 40, 0.3); }
.ink-key { text-decoration: underline dotted rgba(42, 36, 28, 0.5); text-underline-offset: 3px; }
.ink-cursor { position: fixed; left: 0; top: 0; width: 36px; height: 36px; margin: -2px 0 0 -2px; pointer-events: none; z-index: 45; display: none; filter: drop-shadow(1px 2px 1px rgba(0, 0, 0, 0.45)); transform-origin: 2px 2px; }
.ink-cursor.on { display: block; }
`;

/** The ink cursor: shown while a dialog is up and the game has the mouse lock; the mouse moves it, a click clicks there. */
export class InkCursor {
  private readonly el: HTMLDivElement;
  private x = 0;
  private y = 0;
  private shown = false;
  private hot: HTMLElement | null = null;

  /**
   * @param goOn back into the game from the quiet pause (main.ts start()): a click on a dialog's line
   *   after coming back to the window goes on and does what it says at once
   */
  constructor(
    private readonly player: FirstPerson,
    private readonly goOn: () => void,
  ) {
    const st = document.createElement("style");
    st.textContent = CSS;
    document.head.appendChild(st);
    this.el = document.createElement("div");
    this.el.className = "ink-cursor";
    this.el.innerHTML = QUILL;
    document.body.appendChild(this.el);

    // each panel marked as it is drawn
    new MutationObserver((muts) => {
      const roots = new Set<Element>();
      for (const m of muts) {
        let n: Node | null = m.target;
        while (n && n.parentNode && n.parentNode !== document.body) n = n.parentNode;
        if (n instanceof Element && n.parentNode === document.body) roots.add(n);
        for (const a of Array.from(m.addedNodes)) if (a instanceof Element && a.parentNode === document.body) roots.add(a);
      }
      for (const r of roots) decorate(r);
    }).observe(document.body, { childList: true, subtree: true });

    document.addEventListener("mousemove", (e) => {
      if (!this.active) return;
      this.x = Math.max(0, Math.min(window.innerWidth - 2, this.x + e.movementX));
      this.y = Math.max(0, Math.min(window.innerHeight - 2, this.y + e.movementY));
      this.place();
    });
    // with the lock every click lands on the picture: it is the ink cursor's, at its place
    window.addEventListener(
      "click",
      (e) => {
        if (!this.active) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        this.act(this.at());
      },
      true,
    );
    // without the lock (free input, the lock refused, the quiet pause): the real mouse on a line or key
    document.addEventListener("click", (e) => {
      if (this.active || !dialogs.any()) return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      const k = el?.closest<HTMLElement>("[data-key]");
      if (!k || k.closest(NOT_DIALOG)) return;
      if (pause.paused) this.goOn();
      sendKey(k.dataset.key!);
    });
    const loop = () => {
      requestAnimationFrame(loop);
      this.sync();
    };
    requestAnimationFrame(loop);
  }

  /** The mouse works the dialog: a dialog up, the lock held, the game playing. */
  get active(): boolean {
    return this.player.locked && !pause.paused && dialogs.cursor();
  }

  /** Dev: where it is, whether it shows, what it is over. */
  info(): { shown: boolean; x: number; y: number; over: string | null } {
    return { shown: this.shown, x: Math.round(this.x), y: Math.round(this.y), over: this.hot ? (this.hot.dataset.key ?? this.hot.tagName) : null };
  }

  /** Dev: move it by (dx, dy) as the locked mouse does, and click there. */
  devMove(dx: number, dy: number): void {
    document.dispatchEvent(new MouseEvent("mousemove", { movementX: dx, movementY: dy } as MouseEventInit));
  }

  private sync(): void {
    const on = this.active;
    if (on === this.shown) {
      if (on) this.hover();
      return;
    }
    this.shown = on;
    this.el.classList.toggle("on", on);
    if (on) {
      // it comes up in the middle of the window, on the dialog
      this.x = window.innerWidth / 2;
      this.y = window.innerHeight / 2;
      this.place();
    } else this.setHot(null);
  }

  private place(): void {
    this.hover();
    this.draw();
  }

  /** Where it is; over something to click, the nib dips a little. */
  private draw(): void {
    this.el.style.transform = `translate(${this.x}px, ${this.y}px)${this.hot ? " rotate(-8deg) scale(1.06)" : ""}`;
  }

  private at(): HTMLElement | null {
    const el = document.elementFromPoint(this.x, this.y);
    return el instanceof HTMLElement && !el.closest(NOT_DIALOG) ? el : null;
  }

  private hover(): void {
    this.setHot(this.at()?.closest<HTMLElement>(".ink-click") ?? null);
  }

  private setHot(h: HTMLElement | null): void {
    if (h === this.hot) return;
    this.hot?.classList.remove("ink-hot");
    this.hot = h;
    h?.classList.add("ink-hot");
    this.draw();
  }

  private act(el: HTMLElement | null): void {
    if (!el) return;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.focus();
      return;
    }
    const k = el.closest<HTMLElement>("[data-key]");
    if (k) return sendKey(k.dataset.key!);
    el.closest<HTMLElement>("button, a, [role=button]")?.click();
  }
}
