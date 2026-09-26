import * as THREE from "three";
import { bootMark, bootNote } from "./probe";
import type { InWorld } from "../world/inworld";

// The loading screen (2026-09-26, Steve: "make game start smoother ... a calculating shaders screen
// with a nice graphic and progress bar"). index.html shows it from the first paint; this module drives
// it and does the heavy work up front, so the first walk has no hitches:
//   1. Loading the town: every file the game asks for (models, pictures, the town's data), counted as
//      they come in, until the page has gone quiet (no file in flight, no long task).
//   2. Loading the people: the town's residents from the server.
//   3. Unpacking the pictures: every texture sent to the GPU (renderer.initTexture), a few at a time.
//   4. Preparing the shaders: every material of the street and of every room built (world/warmup.ts,
//      compileAsync with KHR_parallel_shader_compile), counted by the programs that are ready.
//   5. Warming the lights: one draw of the whole street, nothing culled and nothing hidden (the rain,
//      the night's lanterns and lamps), with the lantern's shadow cube drawn once for every kind of
//      body that can throw a shadow (the depth shaders a first dusk would build).
//   6. Opening the doors: every room in the world (halls, churches, taverns, homes) drawn once.
// Then the screen fades into the menu. docs/rendering.md, "Build before you show".
//
// Imported at the top of main.ts (after the pause clock): from then on files are counted. Keys and
// clicks wait until the menu is up (held by index.html's first script, let go here).

const $ = <T extends Element>(sel: string) => document.querySelector<T>(`#boot ${sel}`);
const bootEl = document.getElementById("boot");

/** Loading, until the screen fades (keys and clicks wait; main.ts does not draw the game meanwhile). */
let busy = !!bootEl;
export const booting = (): boolean => busy;

// ---------------------------------------------------------------- the screen

let shown = 0.02;
function show(step: string, count = "", progress?: number, now?: string): void {
  if (!bootEl) return;
  const what = $<HTMLElement>(".step .what");
  const c = $<HTMLElement>(".step .count");
  const pct = $<HTMLElement>(".step .pct");
  if (what && what.textContent !== step) what.textContent = step;
  if (c) c.textContent = count;
  if (progress !== undefined) {
    // the bar never goes back
    shown = Math.max(shown, Math.min(1, progress));
    const fill = $<HTMLElement>(".fill");
    if (fill) fill.style.transform = `scaleX(${Math.max(0.02, shown).toFixed(4)})`;
    if (pct) pct.textContent = `${Math.round(shown * 100)}%`;
  }
  if (now !== undefined) {
    const n = $<HTMLElement>(".now");
    if (n && n.textContent !== now) n.textContent = now;
  }
  if (bootEl) bootEl.dataset.step = `${step} ${count}`.trim();
}

// the module runs before main.ts builds the town: that takes some seconds in one go
show("Building the streets", "", 0.05, "The game lays out the quays, the houses and the river.");

// ---------------------------------------------------------------- keys and clicks wait

// index.html holds them (its first script: before every listener of the game's); let go in finishBoot
const hold = (on: boolean) => ((window as unknown as { __bootHold?: boolean }).__bootHold = on);
if (!bootEl) hold(false);
else {
  // the game entered before the loading is done (the dev kit's free(true), the probe): the screen
  // goes at once; the work goes on behind the game
  const menu = document.getElementById("start");
  if (menu)
    new MutationObserver(() => {
      if (busy && menu.classList.contains("hidden")) void finishBoot(null, true);
    }).observe(menu, { attributes: true, attributeFilter: ["class"] });
}

// ---------------------------------------------------------------- files in flight

type FileState = { url: string; start: number; end: number };
const fileList: FileState[] = [];
let lastFileEvent = 0;
const skip = (url: string) => /^(data:|blob:)/.test(url) || url.includes("/@vite/") || url.includes("/@fs/") || url.endsWith(".ts");
function begin(url: string): FileState {
  const f = { url, start: performance.now(), end: 0 };
  fileList.push(f);
  lastFileEvent = f.start;
  return f;
}
function end(f: FileState | undefined): void {
  if (!f || f.end) return;
  f.end = performance.now();
  lastFileEvent = f.end;
}
{
  // three's loaders (GLTFLoader, TextureLoader, FileLoader) report to the default manager: an item
  // ends when its model is parsed, its picture decoded
  const m = THREE.DefaultLoadingManager;
  const open = new Map<string, FileState[]>();
  const start0 = m.itemStart.bind(m);
  const end0 = m.itemEnd.bind(m);
  const err0 = m.itemError.bind(m);
  const close = (url: string) => {
    const q = open.get(url);
    end(q?.shift());
    if (q && !q.length) open.delete(url);
  };
  m.itemStart = (url: string) => {
    if (busy && !skip(url)) {
      const q = open.get(url) ?? [];
      q.push(begin(url));
      open.set(url, q);
    }
    start0(url);
  };
  m.itemEnd = (url: string) => {
    close(url);
    end0(url);
  };
  m.itemError = (url: string) => {
    close(url);
    err0(url);
  };
  // the game's own fetches (the town's data, a model's JSON part): ended when the body is read.
  // three's FileLoader passes a Request and is counted by the manager above.
  const fetch0 = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : null;
    if (!busy || url === null || skip(url) || url.includes("/api/dev/")) return fetch0(input, init);
    const f = begin(url);
    // a body nobody reads (a POST's answer) ends the file after a moment
    const late = () => setTimeout(() => end(f), 1500);
    return fetch0(input, init).then(
      (r) => {
        for (const k of ["arrayBuffer", "json", "text", "blob"] as const) {
          const read = r[k].bind(r) as () => Promise<unknown>;
          (r as unknown as Record<string, () => Promise<unknown>>)[k] = () => read().finally(() => end(f));
        }
        late();
        return r;
      },
      (e) => {
        end(f);
        throw e;
      },
    );
  };
}

// dev: the files as counted (__scheldemistBoot.files())
{
  const probe = (window as unknown as { __scheldemistBoot?: Record<string, unknown> }).__scheldemistBoot;
  if (probe) probe.files = () => fileList.map((f) => ({ url: f.url.replace(location.origin, ""), start: Math.round(f.start), end: Math.round(f.end) }));
}

// the main thread busy building: a task over 150 ms (a model built, a town laid out) ends here. (The game's
// frames go on meanwhile; on a busy machine they alone can pass 50 ms, so short ones do not count.)
let lastLong = 0;
try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (e.duration > 150) lastLong = Math.max(lastLong, e.startTime + e.duration);
  }).observe({ type: "longtask", buffered: true });
} catch {
  /* no long task timing: files alone decide */
}

// ---------------------------------------------------------------- helpers

/** A turn of the event loop that no hidden tab slows down (its timers wait a second there). */
const channel = new MessageChannel();
const turns: Array<() => void> = [];
channel.port1.onmessage = () => turns.shift()?.();
/** A moment for the screen to be drawn (a frame, or a short timer; in a hidden tab only a turn of the loop). */
function breathe(ms = 0): Promise<void> {
  if (document.hidden) return new Promise((r) => (turns.push(r), channel.port2.postMessage(0)));
  return new Promise((r) => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      r();
    };
    requestAnimationFrame(() => (ms ? setTimeout(go, ms) : go()));
    setTimeout(go, Math.max(60, ms + 40));
  });
}

type Drawn = THREE.Mesh | THREE.Points | THREE.Line | THREE.Sprite;
const isDrawn = (o: THREE.Object3D): o is Drawn =>
  ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite) && !!(o as Drawn).material;

/** Every texture on a material (its maps and its shader's uniforms). */
function texturesOf(m: THREE.Material, out: Set<THREE.Texture>): void {
  for (const v of Object.values(m)) if ((v as THREE.Texture)?.isTexture) out.add(v as THREE.Texture);
  const u = (m as THREE.ShaderMaterial).uniforms;
  if (u) for (const x of Object.values(u)) if ((x?.value as THREE.Texture)?.isTexture) out.add(x.value as THREE.Texture);
}

/**
 * Draw a scene once with everything in it: hidden things shown, nothing culled (by three or by the
 * game's culler), so every object is drawn with its real shader into the real target; then as it was.
 */
function drawAll(scene: THREE.Scene, draw: () => void, extra?: (on: boolean) => void): void {
  const hidden: THREE.Object3D[] = [];
  const culled: Array<[THREE.Object3D, boolean]> = [];
  // lights stay as they are, and so does anything that holds one: the number of lights is the
  // shaders' key (docs/rendering.md); a hidden group with a lamp in it stays hidden
  const holdsLight = new Set<THREE.Object3D>();
  scene.traverse((o) => {
    if (!(o as THREE.Light).isLight) return;
    for (let q: THREE.Object3D | null = o; q && !holdsLight.has(q); q = q.parent) holdsLight.add(q);
  });
  scene.traverse((o) => {
    if (!isDrawn(o) && !(o as THREE.Group).isGroup && o.type !== "Object3D") return;
    if (holdsLight.has(o)) return;
    if (!o.visible) {
      hidden.push(o);
      o.visible = true;
    }
    if (isDrawn(o)) {
      culled.push([o, o.frustumCulled]);
      o.frustumCulled = false;
    }
  });
  extra?.(true);
  try {
    draw();
  } finally {
    extra?.(false);
    for (const [o, f] of culled) o.frustumCulled = f;
    for (const o of hidden) o.visible = false;
  }
}

// ---------------------------------------------------------------- the run

export type BootParts = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** The target the game draws into (retro/retroPass.ts). */
  target: () => THREE.WebGLRenderTarget;
  inWorld: InWorld;
  /** The shader warmer (world/warmup.ts): builds what is not built yet; resolves when ready. */
  warm: () => Promise<unknown>;
  /** One frame of the game as it is drawn (retro pass, rooms, mirrors). */
  draw: () => void;
  /** The game's own culler on or off (world/cull.ts). */
  culling: (on?: boolean) => boolean;
  cityReady: Promise<unknown>;
  townReady: () => boolean;
};

const LAST = "scheldemist.boot";
function lastRun(): { files: number; programs: number } {
  try {
    return { files: 0, programs: 0, ...JSON.parse(localStorage.getItem(LAST) ?? "{}") };
  } catch {
    return { files: 0, programs: 0 };
  }
}

/**
 * A returning player: the game they will continue, named as the menu's Continue names it (game/saves.ts),
 * so they know it is there while the town loads.
 */
function showSave(): void {
  const el = $<HTMLElement>(".save");
  if (!el) return;
  type Save = { weekday: string; hour: number; minute: number; day: number; place: string };
  fetch("/api/saves")
    .then((r) => (r.ok ? (r.json() as Promise<{ saves?: Save[] }>) : null))
    .then((r) => {
      const s = r?.saves?.[0];
      if (!s || !busy) return;
      el.textContent = `Your game waits: ${s.weekday} ${s.hour}:${String(s.minute).padStart(2, "0")}, day ${s.day}, ${s.place}. Continue is on the menu.`;
      el.hidden = false;
    })
    .catch(() => {
      /* the server is away: the menu says so */
    });
}

/** Load, build and warm everything, showing how far it is; resolves when the menu is up. */
export async function runBoot(p: BootParts): Promise<void> {
  if (!bootEl) return;
  const t0 = performance.now();
  const last = lastRun();
  const { renderer } = p;
  bootMark("boot:run");
  showSave();

  // 1 and 2: the files, the town, the people, until the page is quiet
  let city = false;
  let cityFailed = false;
  p.cityReady.then(
    () => (city = true),
    () => (cityFailed = true),
  );
  const QUIET = 800;
  let settleFrom = 0;
  let inAt = 0;
  for (;;) {
    const now = performance.now();
    const done = fileList.filter((f) => f.end).length;
    const open = fileList.length - done;
    const total = Math.max(fileList.length, last.files);
    const town = p.townReady();
    const quiet = open === 0 && now - lastFileEvent > QUIET && now - lastLong > QUIET;
    if ((city || cityFailed) && (town || now - t0 > 45_000) && quiet) break;
    // the town in and still no quiet after half a minute (a slow machine, a part that keeps loading): on
    if ((city || cityFailed) && town && (inAt ||= now) && now - inAt > 30_000) {
      console.warn("[boot] the page did not go quiet: on to the shaders", { open: fileList.filter((f) => !f.end).map((f) => f.url) });
      break;
    }
    if (now - t0 > 120_000) {
      console.warn("[boot] still loading after 2 minutes: on to the menu", { open: fileList.filter((f) => !f.end).map((f) => f.url) });
      break;
    }
    const k = total ? done / total : 0;
    const files = open ? `(${done} of ${total} files)` : "";
    if (!city) show("Loading the town", files, 0.08 + 0.42 * k, "Reading the houses, the boats, the quays and the people from the disk.");
    else {
      // the last building work has no count of its own: the bar creeps on towards the next step
      settleFrom ||= now;
      const creep = Math.max(0.08 + 0.42 * k, 0.5 + 0.045 * (1 - Math.exp(-(now - settleFrom) / 5000)));
      if (!town) show("Loading the people", files, creep, "The townsfolk wake: homes, trades and the day ahead.");
      else show("Setting out the streets", files, creep, "The market stalls, the goods on the quays, the back lanes.");
    }
    await breathe(100);
  }
  const files = fileList.length;
  bootMark("boot:files");
  bootNote(`boot: ${files} files`);

  // 3: the pictures to the GPU, a few at a time
  const scenes = [p.scene, ...p.inWorld.all.map((r) => r.scene)];
  const tex = new Set<THREE.Texture>();
  for (const s of scenes)
    s.traverse((o) => {
      if (!isDrawn(o)) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) texturesOf(m, tex);
    });
  const list = [...tex].filter((t) => (t.image || (t as THREE.DataTexture).isDataTexture) && !(t as THREE.VideoTexture).isVideoTexture && !(t as unknown as { isRenderTargetTexture?: boolean }).isRenderTargetTexture);
  let n = 0;
  let slice = performance.now();
  for (const t of list) {
    try {
      renderer.initTexture(t);
    } catch (e) {
      console.warn("[boot] texture", t.name, e);
    }
    n++;
    if (performance.now() - slice > 40) {
      show("Unpacking the pictures", `(${n} of ${list.length})`, 0.53 + 0.07 * (n / list.length), "Every wall, roof and sign painted onto the graphics card.");
      await breathe();
      slice = performance.now();
    }
  }
  bootMark("boot:textures");

  // 4: the shaders: whatever is not built yet, in the street and in every room; counted by programs ready
  const warming = p.warm();
  let settled = false;
  void warming.finally(() => (settled = true));
  for (;;) {
    const progs = (renderer.info.programs ?? []) as Array<{ isReady?: () => boolean }>;
    const ready = progs.filter((q) => !q.isReady || q.isReady()).length;
    const total = Math.max(progs.length, 1);
    show("Preparing the shaders", `(${ready} of ${total})`, 0.6 + 0.26 * (ready / Math.max(total, last.programs || total)), "Building every picture program once, now, so the first walk does not stutter.");
    if (settled && ready >= progs.length) break;
    await breathe(80);
  }
  bootMark("boot:shaders");

  // 5: the whole street drawn once, the night's things and the rain too, and the lantern's shadow
  show("Warming the lights", "", 0.88, "The lamps, the lanterns and their shadows tried once, so the first dusk does not stutter.");
  await breathe(30);
  const culling = p.culling();
  p.culling(false);
  try {
    p.scene.updateMatrixWorld(true);
    drawAll(p.scene, p.draw, (on) => shadowCasters(p, on));
    // what that draw built (the lantern's depth shaders): wait for it
    await p.warm();
  } catch (e) {
    console.warn("[boot] warming the street", e);
  } finally {
    p.culling(culling);
  }
  bootMark("boot:lights");

  // 6: every room drawn once, in its own light
  const rooms = p.inWorld.all;
  const keep = renderer.getRenderTarget();
  slice = 0;
  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i];
    if (performance.now() - slice > 40) {
      show("Opening the doors", `(${i + 1} of ${rooms.length})`, 0.9 + 0.09 * (i / Math.max(1, rooms.length)), "Every hall, church, tavern and home drawn once, so the doors open at once.");
      await breathe();
      slice = performance.now();
    }
    try {
      p.inWorld.evenLights(r);
      r.scene.updateMatrixWorld(true);
      renderer.setRenderTarget(p.target());
      drawAll(r.scene, () => renderer.render(r.scene, p.camera));
    } catch (e) {
      console.warn("[boot] room", e);
    } finally {
      renderer.setRenderTarget(keep);
    }
  }
  await p.warm();
  bootMark("boot:doors");

  const programs = renderer.info.programs?.length ?? 0;
  try {
    localStorage.setItem(LAST, JSON.stringify({ files, programs, ms: Math.round(performance.now() - t0) }));
  } catch {
    /* private window */
  }
  bootNote(`boot: ${programs} programs, ${Math.round(performance.now() - t0)} ms`);
  show("Ready", "", 1, "The town is ready.");
  await breathe(250);
}

/**
 * The lantern's shadow (world/lanternLights.ts): one shadow-casting point light that people near a lit
 * lantern throw their shadows with. Its depth shaders are built the first time a body throws one; so for
 * the warm-up draw one body of every kind (skinned, instanced, with a cut-out texture ...) casts, the
 * light stands at the eye, and its cube map is drawn with that frame.
 */
function shadowCasters(p: BootParts, on: boolean): void {
  const s = shadowState;
  if (on) {
    const light = p.scene.getObjectByName("lantern_pool_0") as THREE.PointLight | undefined;
    if (!light?.castShadow) return;
    const kinds = new Map<string, THREE.Mesh>();
    p.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.material) return;
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
      const k = [
        (m as THREE.SkinnedMesh).isSkinnedMesh ? "s" : "",
        (m as THREE.InstancedMesh).isInstancedMesh ? "i" : "",
        (m as unknown as { isBatchedMesh?: boolean }).isBatchedMesh ? "b" : "",
        m.geometry?.morphAttributes?.position ? "m" : "",
        mat.alphaTest > 0 && (mat.map || mat.alphaMap) ? "a" : "",
        mat.displacementMap ? "d" : "",
      ].join("");
      if (!kinds.has(k)) kinds.set(k, m);
    });
    s.casters = [...kinds.values()].map((m) => [m, m.castShadow] as [THREE.Mesh, boolean]);
    for (const [m] of s.casters) m.castShadow = true;
    s.light = light;
    s.pos = light.position.clone();
    s.power = light.intensity;
    s.auto = light.shadow.autoUpdate;
    light.position.copy(p.camera.position);
    light.updateMatrixWorld();
    light.intensity = Math.max(light.intensity, 0.001);
    light.shadow.needsUpdate = true;
    s.global = p.renderer.shadowMap.needsUpdate;
    p.renderer.shadowMap.needsUpdate = true;
  } else if (s.light) {
    for (const [m, c] of s.casters) m.castShadow = c;
    s.light.position.copy(s.pos);
    s.light.updateMatrixWorld();
    s.light.intensity = s.power;
    s.light.shadow.autoUpdate = s.auto;
    p.renderer.shadowMap.needsUpdate = s.global;
    s.light = null;
    s.casters = [];
  }
}
const shadowState = {
  light: null as THREE.PointLight | null,
  casters: [] as Array<[THREE.Mesh, boolean]>,
  pos: new THREE.Vector3(),
  power: 0,
  auto: false,
  global: false,
};

/** Fade the loading screen into the menu (the menu comes up under it; keys and clicks go to it after). */
let finished = false;
export function finishBoot(menu: HTMLElement | null, early = false): Promise<void> {
  busy = false;
  hold(false);
  if (!bootEl || finished) return Promise.resolve();
  finished = true;
  bootMark(early ? "boot:skipped" : "menu");
  if (early) bootEl.style.transitionDuration = "0.2s";
  menu?.classList.add("boot-reveal");
  bootEl.setAttribute("aria-busy", "false");
  bootEl.classList.add("gone");
  return new Promise((r) =>
    setTimeout(() => {
      clearInterval((window as unknown as { __bootTips?: number }).__bootTips);
      bootEl.remove();
      menu?.classList.remove("boot-reveal");
      r();
    }, 1200),
  );
}
