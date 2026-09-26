import * as THREE from "three";
import { psx } from "../retro/psx";
import { loadModelSet, type ModelSet } from "./boats";
import { glassColor } from "./gaslamps";
import { rectAround, type Rect } from "./geom";
import { addLantern, removeLantern, type LanternSource } from "./lanternLights";
import { Geo, WORLD, tideCuts, tideShade } from "./quaysteps";
import type { World } from "./rijnkaai";
import { HW_MAX, LW_MIN, MHW, MLW, levelAt } from "./tide";

// The Werf landing stage (Steve, 2026-09-26: "a high detail pass on the boat and pier"): the floating
// stage the left-bank ferry lands at, at the end of the Werf (rijnkaai.ts PONTOON: x -251..-247, z 0 to
// -58, its gangway from the quay hinged at z 0). Drawn from ferry.glb "landing_stage"
// (tools/blender/build_ferry.py): tarred floats with weed and a tide line, a railed deck of loose planks,
// a head with fenders and the gangway gap, bollards, cleats, a ladder, a waiting shelter with a ticket
// hatch and notice boards, oil lamps on posts, goods and luggage, puddles. It rides the tide as the
// old pontoon did (the same height: the river at x -249, z -30, plus its deck), and hides the old
// pontoon sections (boats.glb "pontoon_section", placed by rijnkaai.ts) under it. Its four guide
// piles stand in the river bed (built here, fixed, slimy up to the high-water mark); iron collars on
// the stage slide on them. The lamps are carried lanterns to world/lanternLights.ts (their light and
// its spill on the boards): the stage moves with the tide, so they are not fixed gas lamps.

/** The stage's quay end and centre line (rijnkaai.ts PONTOON), and where its height is read. */
export const STAGE_X = -249;
const LEVEL_AT: [number, number] = [STAGE_X, -30];
/** Lamp glass: the size of build_ferry.py's lantern (w 0.26, h 0.4), a hair larger to cover its panes. */
const GLOW = { w: 0.27, h: 0.41 };
/** A pier oil lamp's strength (1 = a townsman's lantern). */
const LAMP_POWER = 2.4;

let setP: Promise<ModelSet> | null = null;
/** ferry.glb (the arrival ferry and the landing stage), loaded once. */
export function loadFerrySet(): Promise<ModelSet> {
  if (!setP) setP = loadModelSet("/models/ferry.glb");
  return setP;
}

/** A glTF extra of a node: the Blender script writes each as JSON text. */
export function extra<T>(set: ModelSet, node: string, key: string, fallback: T): T {
  const raw = set.extras.get(node)?.[key];
  if (typeof raw !== "string") return (raw as T) ?? fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Blender (x, y, z) to the model's own game frame (x, z, -y). */
export function bl(p: number[]): THREE.Vector3 {
  return new THREE.Vector3(p[0], p[2], -p[1]);
}

let haloTex: THREE.Texture | null = null;
/** A soft round glow for a lamp's halo in the fog (one small canvas, shared). */
export function haloTexture(): THREE.Texture {
  if (haloTex) return haloTex;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.25, "rgba(255,255,255,0.45)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 32, 32);
  haloTex = new THREE.CanvasTexture(c);
  return haloTex;
}

/**
 * A lamp's lit glass and its halo, children of `parent` at `local` (the model's frame). `tint` the
 * flame's colour (warm, or a ship's red, green and white). Call set(v, fog) every frame, v 0..1.
 */
export class LampGlow {
  readonly glass: THREE.Mesh;
  readonly halo: THREE.Sprite;
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly tint: THREE.Color;
  constructor(parent: THREE.Object3D, local: THREE.Vector3, tint: number, size = GLOW, halo = 1.3) {
    this.tint = new THREE.Color(tint);
    this.mat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.glass = new THREE.Mesh(new THREE.BoxGeometry(size.w, size.h, size.w), this.mat);
    this.glass.position.copy(local);
    this.glass.name = "lamp_glow";
    this.glass.userData.fx = true;
    this.glass.visible = false;
    parent.add(this.glass);
    const sm = new THREE.SpriteMaterial({ map: haloTexture(), color: this.tint, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    this.halo = new THREE.Sprite(sm);
    this.halo.scale.setScalar(halo);
    this.halo.position.copy(local);
    this.halo.name = "lamp_halo";
    this.halo.userData.fx = true;
    this.halo.visible = false;
    this.halo.renderOrder = 3;
    parent.add(this.halo);
  }
  private readonly tmp = new THREE.Color();
  set(v: number, fog: THREE.Color): void {
    const on = v > 0.01;
    this.glass.visible = on;
    this.halo.visible = on;
    if (!on) return;
    // the gas lamps' glass colour (unlit: the air round it; lit: the flame), in this lamp's tint
    glassColor(this.tmp, fog, v);
    const k = Math.min(1, v);
    this.mat.color.setRGB(this.tmp.r * (1 - k) + this.tint.r * k, this.tmp.g * (1 - k) + this.tint.g * k, this.tmp.b * (1 - k) + this.tint.b * k);
    (this.halo.material as THREE.SpriteMaterial).opacity = 0.55 * k;
  }
  dispose(): void {
    this.glass.removeFromParent();
    this.halo.removeFromParent();
    this.glass.geometry.dispose();
    this.mat.dispose();
    (this.halo.material as THREE.SpriteMaterial).dispose();
  }
}

interface Lamp {
  local: THREE.Vector3;
  src: LanternSource;
  glow: LampGlow;
  seed: number;
}

export class LandingStage {
  /** The stage (its origin at the waterline, quay end, centre line), or null until ferry.glb is in. */
  root: THREE.Object3D | null = null;
  private set: ModelSet | null = null;
  private lamps: Lamp[] = [];
  private hidden = false;
  private readonly colliders: Rect[] = [];
  private readonly piles: Rect[] = [];
  private t = 0;
  private readonly v = new THREE.Vector3();

  constructor(private readonly world: World) {
    void loadFerrySet().then((s) => this.build(s)).catch(() => {});
  }

  /** The deck's top now (world y): the same as rijnkaai.ts's pontoon. */
  deckY(): number {
    return levelAt(LEVEL_AT[0], LEVEL_AT[1]) + (this.set ? extra(this.set, "landing_stage", "deck_top", 1.8) : 1.8);
  }

  private build(set: ModelSet): void {
    this.set = set;
    const proto = set.protos.get("landing_stage");
    if (!proto) return;
    const root = proto.clone();
    root.name = "landing_stage";
    root.position.set(STAGE_X, levelAt(LEVEL_AT[0], LEVEL_AT[1]), 0);
    this.world.scene.add(root);
    this.root = root;
    // things on the deck you walk into (Blender x0, x1, y0, y1 -> world rects), the bollards, the lamp
    // posts, the head rail each side of the gangway gap
    const W = (x: number) => STAGE_X + x;
    for (const [x0, x1, y0, y1] of extra<number[][]>(set, "landing_stage", "solids", [])) this.colliders.push({ minX: W(x0), maxX: W(x1), minZ: -y1, maxZ: -y0 });
    for (const [x, y] of extra<number[][]>(set, "landing_stage", "bollards", [])) this.colliders.push(rectAround(W(x), -y, 0.24, 0.24));
    const len = extra(set, "landing_stage", "length", 60);
    for (const [a, b] of extra<number[][]>(set, "landing_stage", "head_rail", [])) this.colliders.push({ minX: W(a), maxX: W(b), minZ: -len + 0.02, maxZ: -len + 0.22 });
    const lamps = extra<number[][]>(set, "landing_stage", "lamps", []);
    lamps.forEach((p, i) => {
      // the posts (the shelter's lamp hangs from its corner post)
      if (i > 0) {
        const sx = p[0] > 0 ? 1 : -1;
        this.colliders.push(rectAround(W(p[0] + sx * 0.45), -p[1], 0.1, 0.1));
      }
      const local = bl(p);
      const src = addLantern({ power: LAMP_POWER });
      src.on = 1;
      this.lamps.push({ local, src, glow: new LampGlow(root, local, 0xffb060), seed: i * 1.7 + 0.3 });
    });
    for (const r of this.colliders) this.world.addCollider(r);
    this.buildPiles(extra<number[][]>(set, "landing_stage", "collars", []));
  }

  /** The guide piles: driven into the river bed, through the stage's collars, slimy up to high water. */
  private buildPiles(collars: number[][]): void {
    const planks = (this.world.mats.planks as THREE.MeshPhongMaterial).map;
    const wood = new Geo(tideShade([0.5, 0.46, 0.42]), 1.5, tideCuts());
    const shells = new Geo(() => [0.78, 0.78, 0.72], 1);
    const iron = new Geo(() => [0.4, 0.4, 0.42], 1);
    const bed = LW_MIN - 1.6;
    const top = HW_MAX + 1.8 + 0.7;
    let seed = 7;
    const r = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    for (const [bx, by] of collars) {
      const x = STAGE_X + bx;
      const z = -by;
      wood.rod(V(x, bed, z), V(x, top, z), 0.2, 8, 14);
      iron.rod(V(x, top - 0.02, z), V(x, top + 0.06, z), 0.22, 8, 1);
      for (const h of [top - 0.6, MHW + 0.2]) iron.rod(V(x, h, z), V(x, h + 0.08, z), 0.215, 8, 1);
      // barnacles and mussels low between the tide marks, small and grey
      for (let k = 0; k < 12; k++) {
        const a = r() * Math.PI * 2;
        const y = MLW + r() * (MHW - 1.2 - MLW);
        const px = x + Math.cos(a) * 0.2;
        const pz = z + Math.sin(a) * 0.2;
        shells.box(WORLD, px - 0.022, px + 0.022, pz - 0.022, pz + 0.022, y, y + 0.03 + r() * 0.02);
      }
      const rect = rectAround(x, z, 0.24, 0.24);
      this.piles.push(rect);
      this.world.addWaterSolid(rect);
    }
    const woodMat = psx(new THREE.MeshLambertMaterial({ map: planks ?? null, vertexColors: true }), { affine: 0.3 });
    const shellMat = psx(new THREE.MeshLambertMaterial({ color: 0x8e8a7e, vertexColors: true }));
    const ironMat = psx(new THREE.MeshLambertMaterial({ color: 0x3a3836, vertexColors: true }));
    const g = new THREE.Group();
    g.name = "landing_stage_piles";
    for (const [geo, mat, name] of [[wood, woodMat, "piles"], [shells, shellMat, "pile_barnacles"], [iron, ironMat, "pile_bands"]] as const) {
      if (geo.empty) continue;
      const mesh = new THREE.Mesh(geo.build(), mat);
      mesh.name = `landing_stage_${name}`;
      g.add(mesh);
    }
    this.world.scene.add(g);
  }

  /** The old pontoon sections (boats.glb, placed by rijnkaai.ts) go under the new stage: hidden once they are in. */
  private hideOld(): void {
    if (this.hidden || !this.world.boats()) return;
    let n = 0;
    for (const o of this.world.scene.children) {
      if (o.name !== "pontoon_section") continue;
      if (Math.abs(o.position.x - STAGE_X) > 0.5 || o.position.z > 0.5 || o.position.z < -61) continue;
      o.visible = false;
      n++;
    }
    if (n) this.hidden = true;
  }

  /** Once a frame: the stage on the tide, the old sections hidden, the lamps (`dark` 0 day .. 1 night). */
  update(dt: number, dark: number): void {
    this.t += dt;
    this.hideOld();
    const root = this.root;
    if (!root) return;
    root.position.y = levelAt(LEVEL_AT[0], LEVEL_AT[1]);
    root.updateMatrixWorld();
    const fog = (this.world.scene.fog as THREE.Fog | null)?.color ?? new THREE.Color(0x808080);
    const deck = this.deckY();
    for (const l of this.lamps) {
      this.v.copy(l.local).applyMatrix4(root.matrixWorld);
      l.src.pos.copy(this.v);
      l.src.ground = deck;
      l.src.on = 1;
      const fl = 0.9 + Math.sin(this.t * 2.1 + l.seed * 3) * 0.05 + Math.sin(this.t * 9.7 + l.seed) * 0.04;
      l.glow.set(dark * fl, fog);
    }
  }

  /** The things on its deck you walk into, and the piles (world rects). */
  solids(): { colliders: Rect[]; piles: Rect[] } {
    return { colliders: this.colliders, piles: this.piles };
  }

  /** The bollards at the head, world, at their tops (where a ferry's lines go). */
  bollards(): THREE.Vector3[] {
    if (!this.set || !this.root) return [];
    return extra<number[][]>(this.set, "landing_stage", "bollards", []).map((p) => bl(p).applyMatrix4(this.root!.matrixWorld));
  }

  info(): Record<string, unknown> {
    return {
      built: !!this.root,
      oldHidden: this.hidden,
      deck: +this.deckY().toFixed(2),
      lamps: this.lamps.map((l) => `${l.src.pos.x.toFixed(1)},${l.src.pos.y.toFixed(1)},${l.src.pos.z.toFixed(1)} lit ${l.src.level.toFixed(2)}`),
      colliders: this.colliders.length,
      piles: this.piles.map((p) => `${((p.minX + p.maxX) / 2).toFixed(1)},${((p.minZ + p.maxZ) / 2).toFixed(1)}`),
    };
  }

  dispose(): void {
    for (const l of this.lamps) {
      removeLantern(l.src);
      l.glow.dispose();
    }
    this.lamps = [];
  }
}
