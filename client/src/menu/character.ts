import * as THREE from "three";
import { real } from "../game/pause";
import { loadKit, PlayerFigure, type Kit } from "../player/look";
import { loadProfile, madeCharacter, me, saveProfile } from "../player/profile";
import {
  AGE_BANDS,
  AGE_MAX,
  AGE_MIN,
  APRONS,
  BUILDS,
  CLOTH,
  COATS,
  FACES,
  FEET,
  HAIR,
  HAIR_STYLES,
  HEADS,
  JEF,
  MIE,
  NAME_MAX,
  SKIN,
  ageBand,
  apronAllowed,
  clampProfile,
  cleanName,
  lookLine,
  optionsFor,
  randomProfile,
  sundayBest,
  swatchesFor,
  type Choice,
  type Profile,
  type Sex,
  type Swatch,
} from "../../../shared/character";

// M7 character: "Your character", the step after New game (Steve 2026-09-26: "some character
// customisation in the menu before start of a new game. Gender, age, some clothes and colours, name.
// This in preparation for multiplayer."). A sheet in the menus' paper style (menu/menu.css: the
// families "Scheldemist Hand" and "Scheldemist Print", the paper and ink variables): the name, sex,
// age and build; a picker and colour swatches for each part of the look; a turning figure dressed from
// the townspeople's kit (player/look.ts); Random (Flemish and Walloon names, a look of the period);
// Sunday best; Start. The server checks and stores the profile (PUT /api/player/profile) before the
// new week begins; the menu's New game calls openCharacterCreator (menu/menu.ts newGame).

const STYLE = `
.char-sheet.settings.menu-sheet { width: 940px; }
.char-sheet .sheet-body { display: grid; grid-template-columns: 290px minmax(0, 1fr); gap: 18px; padding-top: 8px; }
.char-sheet .char-left { display: flex; flex-direction: column; align-items: center; gap: 6px; position: sticky; top: 0; align-self: start; }
.char-sheet canvas.char-view { width: 270px; height: 380px; image-rendering: pixelated; background: #2b2721; box-shadow: inset 0 0 0 1.5px var(--ink), 0 3px 12px rgba(0,0,0,0.35); cursor: grab; }
.char-sheet .char-look { margin: 2px 0 0; font: italic 13.5px/1.35 var(--f-print); color: var(--ink-soft); text-align: center; min-height: 4em; }
.char-sheet .char-btns { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.char-sheet .char-names { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 14px; }
.char-sheet .char-names label { display: flex; flex-direction: column; gap: 2px; margin: 0; font: 13px/1.2 var(--f-print); letter-spacing: 0.18em; text-transform: uppercase; color: var(--ink-soft); }
.char-sheet .char-names input[type="text"] { width: auto; font: 22px/1.2 var(--f-hand); padding: 2px 8px; letter-spacing: 0.02em; text-transform: none; }
.char-sheet .char-row { display: grid; grid-template-columns: 118px minmax(0, 1fr); align-items: center; gap: 4px 12px; padding: 5px 0; border-bottom: 1px dotted var(--ink-faint); }
.char-sheet .char-row > .lbl { font-size: 16px; line-height: 1.2; }
.char-sheet .char-row > .ctl { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.char-sheet .seg button { font-size: 14px; }
.char-sheet .swatches { display: flex; flex-wrap: wrap; gap: 4px; }
.char-sheet .sw { width: 22px; height: 22px; padding: 0; border: 1.5px solid rgba(34,27,21,0.55); border-radius: 2px; cursor: pointer; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12); }
.char-sheet .sw.on { outline: 2px solid var(--rust); outline-offset: 2px; }
.char-sheet .sw:focus-visible { outline: 2px dashed var(--rust); outline-offset: 2px; }
.char-sheet .swname { font: italic 13px var(--f-print); color: var(--ink-soft); min-width: 90px; }
.char-sheet .age-val { font: 20px var(--f-hand); min-width: 3.4em; }
.char-sheet .char-err { color: var(--bad); font: 14px var(--f-hand); }
.char-sheet .sheet-foot-row .msg { margin-right: auto; }
`;

/** The menus' printer's rule (menu/menu.ts), the same ornament. */
const RULE = `<svg class="rule-svg" viewBox="0 0 400 14" preserveAspectRatio="none" aria-hidden="true"><path d="M0 5.2H176M0 8.8H176M224 5.2H400M224 8.8H400" stroke="currentColor" stroke-width="1"/><path d="M200 1.5l7 5.5-7 5.5-7-5.5z" fill="currentColor"/><circle cx="184" cy="7" r="2" fill="currentColor"/><circle cx="216" cy="7" r="2" fill="currentColor"/></svg>`;

type Pick = { list: Choice[]; get: (p: Profile) => string; set: (p: Profile, v: string) => void };

let open: { close: () => void } | null = null;
let previewNow: Preview | null = null;

/**
 * Open "Your character". `onDone` runs once the server has the profile (the menu then starts the new
 * week); Back or Esc closes the sheet without it.
 */
export function openCharacterCreator(onDone: (p: Profile) => void, opts: { onCancel?: () => void } = {}): void {
  open?.close();
  if (!document.getElementById("char-style")) {
    const st = document.createElement("style");
    st.id = "char-style";
    st.textContent = STYLE;
    document.head.appendChild(st);
  }
  let draft: Profile = clampProfile(me()).profile;
  let busy = false;

  const sheet = document.createElement("div");
  sheet.className = "settings paper menu-sheet char-sheet pause-ui";
  sheet.style.display = "flex";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", "Your character");
  sheet.innerHTML = `
    <div class="sheet-head"><p class="kicker">A new week in Antwerp</p><h2>Your character</h2><div class="rule">${RULE}</div></div>
    <div class="sheet-body">
      <div class="char-left">
        <canvas class="char-view" width="180" height="253" title="Drag to turn"></canvas>
        <p class="char-look"></p>
        <div class="char-btns">
          <button class="btn small" data-act="random" title="A name and a look of 1873, Flemish or Walloon">Random</button>
          <button class="btn small" data-act="sunday" title="Black and white linen, a good hat">Sunday best</button>
        </div>
      </div>
      <div class="char-right">
        <div class="char-names">
          <label>First name<input type="text" name="first" maxlength="${NAME_MAX.first}" autocomplete="off" spellcheck="false"></label>
          <label>Family name<input type="text" name="last" maxlength="${NAME_MAX.last}" autocomplete="off" spellcheck="false"></label>
        </div>
        <p class="char-err" aria-live="polite"></p>
        <div class="char-rows"></div>
      </div>
    </div>
    <div class="sheet-foot-row"><span class="msg"></span><button class="btn" data-act="back">Back</button><button class="btn primary" data-act="start">Start</button></div>`;
  document.body.appendChild(sheet);

  const first = sheet.querySelector<HTMLInputElement>('input[name="first"]')!;
  const last = sheet.querySelector<HTMLInputElement>('input[name="last"]')!;
  const err = sheet.querySelector<HTMLElement>(".char-err")!;
  const msg = sheet.querySelector<HTMLElement>(".msg")!;
  const rows = sheet.querySelector<HTMLElement>(".char-rows")!;
  const lookEl = sheet.querySelector<HTMLElement>(".char-look")!;
  const view = sheet.querySelector<HTMLCanvasElement>("canvas.char-view")!;

  // ---- the turning figure
  const preview = new Preview(view);
  previewNow = preview;

  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
  const seg = (name: string, list: Choice[], value: string) =>
    `<span class="seg" data-seg="${name}">${list.map((c) => `<button type="button" data-v="${c.id}" class="${c.id === value ? "on" : ""}">${esc(c.label)}</button>`).join("")}</span>`;
  const sel = (name: string, list: Choice[], value: string) =>
    `<select data-sel="${name}">${list.map((c) => `<option value="${c.id}"${c.id === value ? " selected" : ""}>${esc(c.label)}</option>`).join("")}</select>`;
  const swatches = (name: string, list: Swatch[], value: string) =>
    `<span class="swatches" data-sw="${name}">${list
      .map((s) => `<button type="button" class="sw${s.id === value ? " on" : ""}" data-v="${s.id}" style="background:${hex(s.hex)}" title="${esc(s.label)}" aria-label="${esc(s.label)}"></button>`)
      .join("")}</span><span class="swname">${esc(list.find((s) => s.id === value)?.label ?? "")}</span>`;
  const row = (label: string, ctl: string) => `<div class="char-row"><span class="lbl">${label}</span><span class="ctl">${ctl}</span></div>`;

  // what each picker changes
  const picks: Record<string, Pick> = {
    sex: { list: [{ id: "man", label: "Man" }, { id: "woman", label: "Woman" }], get: (p) => p.sex, set: (p, v) => void (p.sex = v as Sex) },
    build: { list: BUILDS, get: (p) => p.build, set: (p, v) => void (p.build = v as Profile["build"]) },
    hairStyle: { list: HAIR_STYLES, get: (p) => p.hair.style, set: (p, v) => void (p.hair.style = v) },
    face: { list: FACES, get: (p) => p.face, set: (p, v) => void (p.face = v) },
    head: { list: HEADS, get: (p) => p.clothes.head.kind, set: (p, v) => void (p.clothes.head.kind = v) },
    coat: { list: COATS, get: (p) => p.clothes.coat.kind, set: (p, v) => void (p.clothes.coat.kind = v) },
    apron: { list: APRONS, get: (p) => p.clothes.apron.kind, set: (p, v) => void (p.clothes.apron.kind = v) },
    feet: { list: FEET, get: (p) => p.clothes.feet.kind, set: (p, v) => void (p.clothes.feet.kind = v) },
  };
  const colours: Record<string, { list: () => Swatch[]; get: (p: Profile) => string; set: (p: Profile, v: string) => void }> = {
    skin: { list: () => SKIN, get: (p) => p.skin, set: (p, v) => void (p.skin = v) },
    hair: { list: () => HAIR, get: (p) => p.hair.colour, set: (p, v) => void (p.hair.colour = v) },
    head: { list: () => CLOTH, get: (p) => p.clothes.head.colour, set: (p, v) => void (p.clothes.head.colour = v) },
    coat: { list: () => CLOTH, get: (p) => p.clothes.coat.colour, set: (p, v) => void (p.clothes.coat.colour = v) },
    shirt: { list: () => CLOTH, get: (p) => p.clothes.shirt.colour, set: (p, v) => void (p.clothes.shirt.colour = v) },
    vest: { list: () => CLOTH, get: (p) => p.clothes.vest.colour, set: (p, v) => void (p.clothes.vest.colour = v) },
    lower: { list: () => CLOTH, get: (p) => p.clothes.lower.colour, set: (p, v) => void (p.clothes.lower.colour = v) },
    apron: { list: () => CLOTH, get: (p) => p.clothes.apron.colour, set: (p, v) => void (p.clothes.apron.colour = v) },
    feet: { list: () => swatchesFor("feet", draft.clothes.feet.kind), get: (p) => p.clothes.feet.colour, set: (p, v) => void (p.clothes.feet.colour = v) },
  };

  function draw(): void {
    const p = draft;
    const w = p.sex === "woman";
    const c = p.clothes;
    const band = AGE_BANDS.find((b) => b.id === ageBand(p.age))!;
    const html: string[] = [];
    html.push(row("Sex", seg("sex", picks.sex.list, p.sex)));
    html.push(
      row(
        "Age",
        `<span class="seg" data-band>${AGE_BANDS.map((b) => `<button type="button" data-v="${b.id}" class="${b.id === band.id ? "on" : ""}">${b.id}</button>`).join("")}</span>
         <input type="range" data-age min="${AGE_MIN}" max="${AGE_MAX}" step="1" value="${p.age}" aria-label="Exact age"><span class="age-val">${p.age}</span>`,
      ),
    );
    html.push(row("Build", seg("build", BUILDS, p.build)));
    html.push(row("Skin", swatches("skin", SKIN, p.skin)));
    html.push(row("Hair", `${sel("hairStyle", optionsFor(HAIR_STYLES, p.sex), p.hair.style)} ${swatches("hair", HAIR, p.hair.colour)}`));
    if (!w) html.push(row("Face", sel("face", optionsFor(FACES, p.sex), p.face)));
    html.push(row(w ? "Head" : "Hat or cap", `${sel("head", optionsFor(HEADS, p.sex), c.head.kind)} ${c.head.kind !== "none" ? swatches("head", CLOTH, c.head.colour) : ""}`));
    html.push(row(w ? "Shawl" : "Coat", `${sel("coat", optionsFor(COATS, p.sex), c.coat.kind)} ${c.coat.kind !== "none" && c.coat.kind !== "no_shawl" ? swatches("coat", CLOTH, c.coat.colour) : ""}`));
    html.push(row(w ? "Blouse" : "Shirt", swatches("shirt", CLOTH, c.shirt.colour)));
    if (!w && c.coat.kind !== "smock" && c.coat.kind !== "coat") html.push(row("Waistcoat", swatches("vest", CLOTH, c.vest.colour)));
    html.push(row(w ? "Skirt" : "Trousers", swatches("lower", CLOTH, c.lower.colour)));
    if (apronAllowed(p)) html.push(row("Apron", `${seg("apron", APRONS, c.apron.kind)} ${c.apron.kind === "apron" ? swatches("apron", CLOTH, c.apron.colour) : ""}`));
    else html.push(row("Apron", `<span class="note">Not under a ${c.coat.kind === "smock" ? "smock" : "long coat"}.</span>`));
    html.push(row(w ? "Feet" : "Feet", `${seg("feet", FEET, c.feet.kind)} ${swatches("feet", swatchesFor("feet", c.feet.kind), c.feet.colour)}`));
    rows.innerHTML = html.join("");
    lookEl.textContent = cap(lookLine(p)) + ".";
    preview.show(p);
  }
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  /** Change the draft and put it through the same clamp as the server (a man's bonnet goes, and so on). */
  function change(f: (p: Profile) => void): void {
    const p = structuredClone(draft);
    f(p);
    const wasSex = draft.sex;
    if (p.sex !== wasSex) {
      // a new sex: that sex's clothes and face, the name, age and colours kept where they fit
      const d = p.sex === "woman" ? MIE : JEF;
      p.face = d.face;
      p.hair.style = d.hair.style;
      p.clothes = structuredClone(d.clothes);
      const typed = cleanName(first.value, NAME_MAX.first);
      if (!typed || typed === (wasSex === "woman" ? MIE.first : JEF.first)) p.first = d.first;
    }
    if (p.best && JSON.stringify(p.clothes) !== JSON.stringify(draft.clothes)) p.best = false;
    draft = clampProfile(p).profile;
    if (p.sex !== wasSex) names();
    draw();
  }
  function names(): void {
    first.value = draft.first;
    last.value = draft.last;
    err.textContent = "";
  }

  rows.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b) return;
    const v = b.dataset.v!;
    const segEl = b.closest<HTMLElement>("[data-seg]");
    const swEl = b.closest<HTMLElement>("[data-sw]");
    if (b.closest("[data-band]")) {
      const band = AGE_BANDS.find((x) => x.id === v)!;
      change((p) => void (p.age = Math.max(band.min, Math.min(band.max, p.age < band.min || p.age > band.max ? Math.round((band.min + band.max) / 2) : p.age))));
    } else if (segEl) change((p) => picks[segEl.dataset.seg!].set(p, v));
    else if (swEl) change((p) => colours[swEl.dataset.sw!].set(p, v));
  });
  rows.addEventListener("change", (e) => {
    const t = e.target as HTMLSelectElement | HTMLInputElement;
    if (t.dataset.sel) change((p) => picks[t.dataset.sel!].set(p, t.value));
  });
  rows.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.age === undefined) return;
    draft = clampProfile({ ...draft, age: Number(t.value) }).profile;
    rows.querySelector<HTMLElement>(".age-val")!.textContent = String(draft.age);
    rows.querySelectorAll<HTMLButtonElement>("[data-band] button").forEach((x) => x.classList.toggle("on", x.dataset.v === ageBand(draft.age)));
    lookEl.textContent = cap(lookLine(draft)) + ".";
    preview.show(draft);
  });
  const typedName = () => {
    const f = cleanName(first.value, NAME_MAX.first);
    const l = cleanName(last.value, NAME_MAX.last, true);
    err.textContent = !first.value.trim() ? "A first name, please." : f === null ? "That will not do for a name in 1873: letters only, and not a word of the street." : l === null ? "The family name: letters only." : "";
    if (f) draft = { ...draft, first: f };
    if (l !== null) draft = { ...draft, last: l };
  };
  first.addEventListener("input", typedName);
  last.addEventListener("input", typedName);

  sheet.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (!act) return;
    e.stopPropagation();
    if (act === "random") {
      draft = randomProfile();
      names();
      draw();
    } else if (act === "sunday") {
      draft = sundayBest(draft);
      draw();
    } else if (act === "back") {
      close();
      opts.onCancel?.();
    } else if (act === "start") void start();
  });

  async function start(): Promise<void> {
    if (busy) return;
    typedName();
    if (err.textContent) {
      first.focus();
      return;
    }
    busy = true;
    msg.textContent = "Writing your name in the book...";
    try {
      const r = await saveProfile(draft);
      if (r.fixed.includes("first") || r.fixed.includes("last")) {
        // the server would not take the name as typed: say so and let the player look again
        draft = r.profile;
        names();
        draw();
        err.textContent = `The clerk wrote "${r.profile.first}${r.profile.last ? " " + r.profile.last : ""}" instead. Change it, or press Start again.`;
        msg.textContent = "";
        busy = false;
        return;
      }
      msg.textContent = "";
      close();
      onDone(r.profile);
    } catch (e) {
      msg.textContent = `The server did not take it (${(e as Error).message}).`;
      busy = false;
    }
  }

  // Esc (the menus hide every open sheet) or Back: the sheet goes, and so does the figure
  const watch = new MutationObserver(() => {
    if (sheet.style.display === "none") close();
  });
  watch.observe(sheet, { attributes: true, attributeFilter: ["style"] });
  function close(): void {
    if (open?.close !== close) return;
    open = null;
    watch.disconnect();
    preview.dispose();
    sheet.remove();
  }
  open = { close };

  // the profile the server has now (a character made for an earlier week starts the sheet)
  names();
  draw();
  void loadProfile().then((p) => {
    if (open?.close !== close) return;
    draft = madeCharacter() ? clampProfile(p).profile : clampProfile(JEF).profile;
    names();
    draw();
  });
  first.focus();
  first.select();
}

// ------------------------------------------------------------------ the turning figure

class Preview {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 180 / 253, 0.1, 20);
  private figure: PlayerFigure | null = null;
  private kit: Kit | null = null;
  private want: Profile | null = null;
  turn = 0.5;
  spin = true;
  private drag: number | null = null;
  private last = real.now();
  private raf = 0;
  private dead = false;
  private dirty = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(canvas.width, canvas.height, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(0x2b2721);
    this.scene.fog = new THREE.Fog(0x2b2721, 4.5, 9);
    this.scene.add(new THREE.HemisphereLight(0xe8e0cc, 0x3a3228, 1.6));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
    sun.position.set(1.5, 3, 2.5);
    this.scene.add(sun);
    // the cobbles under the feet
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.7, 20), new THREE.MeshLambertMaterial({ color: 0x4a443a }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    this.camera.position.set(0, 1.05, 3.45);
    this.camera.lookAt(0, 0.9, 0);
    canvas.addEventListener("pointerdown", (e) => {
      this.drag = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (this.drag === null) return;
      this.turn += (e.clientX - this.drag) * 0.02;
      this.drag = e.clientX;
    });
    canvas.addEventListener("pointerup", () => (this.drag = null));
    void loadKit().then((k) => {
      this.kit = k;
      if (this.want) this.show(this.want);
    });
    this.loop();
  }

  show(p: Profile): void {
    this.want = structuredClone(p);
    if (!this.kit || this.dead) return;
    // at most one new figure a frame (the age slider drags through many)
    this.dirty++;
  }

  private rebuild(): void {
    if (!this.kit || !this.want) return;
    this.figure?.dispose();
    this.figure = new PlayerFigure(this.kit, this.want, { plain: true });
    this.figure.root.rotation.y = this.turn;
    this.scene.add(this.figure.root);
  }

  private loop = (): void => {
    if (this.dead) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = real.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.dirty) {
      this.dirty = 0;
      this.rebuild();
    }
    if (this.drag === null && this.spin) this.turn += dt * 0.5;
    if (this.figure) {
      this.figure.root.rotation.y = this.turn;
      this.figure.update(dt);
    }
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.figure?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

/** Dev (the browser checks' pictures): hold the turning figure at this angle (0: facing you), or let it turn again. */
export function devPreviewTurn(angle: number | null): void {
  if (!previewNow) return;
  previewNow.spin = angle === null;
  if (angle !== null) previewNow.turn = angle;
}

/** Dev and the test kit: the creator without a new week (the profile is still saved on Start). */
export function devCharacter(): void {
  openCharacterCreator(() => {});
}
