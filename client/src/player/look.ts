import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { psx } from "../retro/psx";
import { real } from "../game/pause";
import { peopleClips, whenHumans } from "../game/humans";
import { CLOTH, HAIR, LEATHER, SKIN, WOOD, type Profile } from "../../../shared/character";

// M7 character: the player's figure, dressed from the townspeople's kit (tools/blender/build_player.py:
// the same lofted bodies, clothes, hats and painter as people.glb) in the profile's colours. The
// Blender side leaves every pixel's colour slot and shade (player_slot.png, player_shade.png); this
// side paints colour x shade into a 128 x 128 canvas per figure, hangs the hat and the hair on the
// head bone, and drives the body with people.glb's clips (the same skeleton and rest pose).
// Used for the body in the world (player/body.ts: the shadow, the reflections, other players later),
// the first-person forearms, and the creator's turning preview (menu/character.ts).

interface Atlas {
  slots: string[];
  tex: number;
  cells: Record<string, [number, number, number, number]>;
  tiles: Record<string, [number, number, number, number]>;
  heights: { m: number; w: number };
}

export interface Kit {
  roots: Map<string, THREE.Object3D>;
  atlas: Atlas;
  base: ImageData;
  slot: ImageData;
  shade: ImageData;
}

let kit: Kit | null = null;
let loading: Promise<Kit | null> | null = null;

const baseName = (n: string) => n.replace(/_\d+$/, "");

function image(url: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      resolve(g.getImageData(0, 0, img.width, img.height));
    };
    img.onerror = () => reject(new Error(`${url} did not load`));
    img.src = url;
  });
}

/** Load the figures, the atlas and people.glb's clips (once). Null if anything fails: no body then. */
export function loadKit(): Promise<Kit | null> {
  if (loading) return loading;
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const clips = new Promise<void>((r) => whenHumans(() => r()));
  loading = Promise.all([
    loader.loadAsync("/models/player.glb"),
    real.fetch("/models/player_atlas.json").then((r) => r.json() as Promise<Atlas>),
    image("/models/player_base.png"),
    image("/models/player_slot.png"),
    image("/models/player_shade.png"),
    clips,
  ])
    .then(([gltf, atlas, base, slot, shade]) => {
      const roots = new Map<string, THREE.Object3D>();
      for (const root of [...gltf.scene.children]) {
        root.traverse((o) => {
          if ((o as THREE.Bone).isBone) o.name = baseName(o.name);
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            (m.material as THREE.Material).dispose();
            m.frustumCulled = false;
          }
        });
        root.removeFromParent();
        roots.set(root.name, root);
      }
      draco.dispose();
      kit = { roots, atlas, base, slot, shade };
      return kit;
    })
    .catch((e: unknown) => {
      console.warn("[player] the figure did not load; no body", e);
      draco.dispose();
      return null;
    });
  return loading;
}

export const kitNow = (): Kit | null => kit;

// ------------------------------------------------------------------ the pieces a profile wears

const hexOf = (list: Array<{ id: string; hex: number }>, id: string, dflt = 0x808080) => list.find((x) => x.id === id)?.hex ?? dflt;

/** Which body (cut of clothes), which face, hat, shawl and hair piece. */
export function pieces(p: Profile) {
  const c = p.clothes;
  const woman = p.sex === "woman";
  const apron = c.apron.kind === "apron";
  let fig: string;
  if (woman) {
    const shawl = c.coat.kind !== "no_shawl";
    fig = `w_${shawl ? "shawl" : "plain"}${apron ? "_apron" : ""}`.replace("w_plain_apron", "w_apron");
  } else {
    fig = c.coat.kind === "jacket" ? (apron ? "m_jacket_apron" : "m_jacket") : c.coat.kind === "coat" ? "m_coat" : c.coat.kind === "smock" ? "m_smock" : apron ? "m_apron" : "m_shirt";
  }
  const ageKey = p.age <= 30 ? "y" : p.age <= 45 ? "m" : "o";
  const head = woman ? `w_none_${ageKey}` : `m_${p.face}_${ageKey}${p.hair.style === "balding" ? "_bald" : ""}`;
  const hat = c.head.kind === "none" ? null : c.head.kind;
  const shawl = woman && c.coat.kind !== "no_shawl" ? (c.coat.kind === "check_shawl" ? "check" : "plain") : null;
  // hair beyond the painted head: a bun or pinned plaits go under a cap, a bonnet or a scarf
  const covered = hat === "bonnet" || hat === "whitecap" || hat === "headscarf";
  const hair = woman ? (p.hair.style === "plaits" ? "plaits" : covered ? null : p.hair.style) : p.hair.style === "long" ? "long" : null;
  return { fig, head, hat, shawl, hair, sex: woman ? "w" : "m" };
}

/** The slot colours, in the slot order of player_atlas.json. */
function slotColours(p: Profile): Record<string, number> {
  const c = p.clothes;
  return {
    skin: hexOf(SKIN, p.skin),
    hair: hexOf(HAIR, p.hair.colour),
    hat: hexOf(CLOTH, c.head.colour),
    coat: hexOf(CLOTH, c.coat.colour),
    shirt: hexOf(CLOTH, c.shirt.colour),
    vest: hexOf(CLOTH, c.vest.colour),
    lower: hexOf(CLOTH, c.lower.colour),
    apron: hexOf(CLOTH, c.apron.colour),
    boots: c.feet.kind === "clogs" ? hexOf(WOOD, c.feet.colour) : hexOf(LEATHER, c.feet.colour),
  };
}

/** The figure's texture for this profile: colour x shade in every slot pixel, the fixed pixels as painted. */
export function paintTexture(k: Kit, p: Profile): HTMLCanvasElement {
  const T = k.atlas.tex;
  const pc = pieces(p);
  const canvas = document.createElement("canvas");
  canvas.width = T;
  canvas.height = T;
  const g = canvas.getContext("2d")!;
  const out = g.createImageData(T, T);
  const src = { base: new Uint8ClampedArray(T * T * 4), slot: new Uint8ClampedArray(T * T * 4), shade: new Uint8ClampedArray(T * T * 4) };
  // copy a tile of the atlas into the 128 x 128 planes at (dx, dy)
  const put = (key: string, dx: number, dy: number) => {
    const r = k.atlas.tiles[key];
    if (!r) return;
    const [sx, sy, w, h] = r;
    const W = k.base.width;
    for (const plane of ["base", "slot", "shade"] as const) {
      const from = k[plane].data;
      const to = src[plane];
      for (let y = 0; y < h; y++) {
        const a = ((sy + y) * W + sx) * 4;
        to.set(from.subarray(a, a + w * 4), ((dy + y) * T + dx) * 4);
      }
    }
  };
  put(`fig:${pc.fig}`, 0, 0);
  const cell = (n: string) => k.atlas.cells[n];
  put(`head:${pc.head}`, cell("head")[0], cell("head")[1]);
  if (pc.hat) put(`hat:${pc.hat}`, cell("hat")[0], cell("hat")[1]);
  if (pc.shawl) put(`shawl:${pc.shawl}`, cell("shawl")[0], cell("shawl")[1]);
  const cols = slotColours(p);
  const rgb = [[0, 0, 0], ...k.atlas.slots.map((s) => {
    const h = cols[s] ?? 0x808080;
    return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
  })];
  const d = out.data;
  for (let i = 0; i < T * T * 4; i += 4) {
    const s = Math.round(src.slot[i] / 20);
    if (s > 0 && s < rgb.length) {
      const c = rgb[s];
      d[i] = (c[0] * src.shade[i]) / 127.5;
      d[i + 1] = (c[1] * src.shade[i + 1]) / 127.5;
      d[i + 2] = (c[2] * src.shade[i + 2]) / 127.5;
    } else {
      d[i] = src.base[i];
      d[i + 1] = src.base[i + 1];
      d[i + 2] = src.base[i + 2];
    }
    d[i + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  return canvas;
}

function textureOf(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.flipY = false; // glTF UVs
  return t;
}

/** The body's width by build (the skeleton's height stays: the clips fit it). */
const BUILD: Record<string, [number, number]> = { slight: [0.93, 0.94], middling: [1, 1], stout: [1.1, 1.12] };

export type PlayerMotion = "idle" | "walk" | "talk" | "row" | "ride" | "crouch";

/**
 * One player's figure: the body of its cut in its colours, the hat and the hair on the head bone, a
 * mixer with people.glb's clips (a woman's own where there are). Feet at y = 0, facing +z.
 */
export class PlayerFigure {
  readonly root = new THREE.Group();
  readonly body: THREE.Object3D;
  readonly material: THREE.Material;
  readonly texture: THREE.CanvasTexture;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<PlayerMotion, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  motion: PlayerMotion | null = null;
  readonly woman: boolean;

  constructor(
    k: Kit,
    readonly profile: Profile,
    opts: { plain?: boolean } = {},
  ) {
    const pc = pieces(profile);
    this.woman = pc.sex === "w";
    this.texture = textureOf(paintTexture(k, profile));
    // (plain: the creator's own little scene, without the town's lamps and fog in the shader)
    const mat = new THREE.MeshLambertMaterial({ map: this.texture, side: THREE.DoubleSide });
    this.material = opts.plain ? mat : psx(mat);
    const src = k.roots.get(`fig_${pc.fig}`)!;
    this.body = cloneSkinned(src);
    this.body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = this.material;
    });
    const [wx, wz] = BUILD[profile.build] ?? [1, 1];
    this.body.scale.set(wx, 1, wz);
    this.root.add(this.body);
    this.root.name = "player_figure";
    // the hat and the hair: placed in the figure's rest pose, then carried by the head bone
    const head = this.body.getObjectByName("head");
    this.body.updateWorldMatrix(true, true);
    for (const part of [pc.hat ? `hat_${pc.hat}` : null, pc.hair ? `hair_${pc.hair}` : null]) {
      const m = part ? k.roots.get(part) : null;
      if (!m || !head) continue;
      const c = m.clone() as THREE.Mesh;
      c.material = this.material;
      c.frustumCulled = false;
      this.body.add(c);
      c.updateWorldMatrix(true, false);
      head.attach(c);
    }
    this.mixer = new THREE.AnimationMixer(this.body);
    const clips = peopleClips();
    const pick = (m: PlayerMotion): string[] => (this.woman ? [`${m}_f`, m] : [m]);
    for (const m of ["idle", "walk", "talk", "row", "ride", "crouch"] as PlayerMotion[]) {
      const clip = pick(m).map((n) => clips?.get(n)).find(Boolean);
      if (clip) this.actions.set(m, this.mixer.clipAction(clip));
    }
    this.play("idle", 0);
  }

  play(m: PlayerMotion, fade = 0.25): void {
    if (this.motion === m) return;
    const next = this.actions.get(m) ?? this.actions.get("idle");
    if (!next) return;
    this.motion = m;
    if (next === this.current) return;
    next.reset().setEffectiveWeight(1).play();
    if (this.current && fade > 0) this.current.crossFadeTo(next, fade, false);
    else this.current?.stop();
    this.current = next;
  }

  /** The walk clip covers 1.2 m a loop: the feet keep to the ground's speed. */
  setPace(speed: number): void {
    this.actions.get("walk")?.setEffectiveTimeScale(Math.max(0.3, speed / 1.2));
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.body);
    this.root.removeFromParent();
    this.texture.dispose();
    this.material.dispose();
  }
}

// ------------------------------------------------------------------ the first-person forearm

/**
 * The forearm and hand of this figure's cut (the sleeve, the cuff, the hand in its skin), cut out of
 * the skinned body by bone and set free of the skeleton. In the returned group the grip (the middle of
 * the hand) is at the origin, the forearm runs up +y to the elbow, the fingers point down -y, and the
 * figure's front is +z. `side` "R" is the right arm.
 */
export function forearm(f: PlayerFigure, side: "R" | "L" = "R"): THREE.Group {
  const g = new THREE.Group();
  g.name = `forearm_${side}`;
  let mesh: THREE.SkinnedMesh | null = null;
  f.body.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = o as THREE.SkinnedMesh;
  });
  if (!mesh) return g;
  const sm = mesh as THREE.SkinnedMesh;
  const want = new Set([`armLow${side}`, `hand${side}`]);
  const bones = sm.skeleton.bones.map((b) => baseName(b.name));
  const geo = sm.geometry;
  const pos = geo.getAttribute("position");
  const nor = geo.getAttribute("normal");
  const uv = geo.getAttribute("uv");
  const si = geo.getAttribute("skinIndex");
  const sw = geo.getAttribute("skinWeight");
  const idx = geo.getIndex();
  const n = idx ? idx.count : pos.count;
  const boneOf = (v: number) => {
    let best = 0;
    let w = -1;
    for (let c = 0; c < 4; c++) {
      const ww = sw.getComponent(v, c);
      if (ww > w) {
        w = ww;
        best = si.getComponent(v, c);
      }
    }
    return bones[best];
  };
  const P: number[] = [];
  const N: number[] = [];
  const U: number[] = [];
  const v3 = new THREE.Vector3();
  const bind = sm.bindMatrix;
  const nm = new THREE.Matrix3().getNormalMatrix(bind);
  let minY = Infinity;
  let sx = 0;
  let sz = 0;
  let cnt = 0;
  for (let t = 0; t < n; t += 3) {
    const vs = [0, 1, 2].map((k) => (idx ? idx.getX(t + k) : t + k));
    if (!vs.every((v) => want.has(boneOf(v)))) continue;
    for (const v of vs) {
      v3.fromBufferAttribute(pos, v).applyMatrix4(bind);
      P.push(v3.x, v3.y, v3.z);
      if (boneOf(v) === `hand${side}`) {
        minY = Math.min(minY, v3.y);
        sx += v3.x;
        sz += v3.z;
        cnt++;
      }
      v3.fromBufferAttribute(nor, v).applyMatrix3(nm).normalize();
      N.push(v3.x, v3.y, v3.z);
      U.push(uv.getX(v), uv.getY(v));
    }
  }
  if (!P.length) return g;
  // the grip: the middle of the hand, a third up from the fingertips
  // (the hand bone's joint in the bind pose: its inverse bind matrix turned back)
  const hi = bones.indexOf(`hand${side}`);
  const gy = hi >= 0 ? new THREE.Vector3().setFromMatrixPosition(sm.skeleton.boneInverses[hi].clone().invert()).y : minY + 0.12;
  const grip = new THREE.Vector3(sx / Math.max(1, cnt), minY + (gy - minY) * 0.45, sz / Math.max(1, cnt));
  for (let i = 0; i < P.length; i += 3) {
    P[i] -= grip.x;
    P[i + 1] -= grip.y;
    P[i + 2] -= grip.z;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
  out.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
  const m = new THREE.Mesh(out, f.material);
  m.frustumCulled = false;
  m.name = "forearm";
  g.add(m);
  return g;
}
