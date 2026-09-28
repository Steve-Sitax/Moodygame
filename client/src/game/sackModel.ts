import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { psx } from "../retro/psx";
import { SACK_LIE } from "../../../shared/goods";
import { pickSack, SACK_GOODS, sackOf, type SackLabel, type SackLook } from "../../../shared/goodsCatalog";

// A filled sack lying down, as a docker drops it (Steve 2026-09-28: "sacks that stack but seem like balloons just
// stacked while in reality sacks stack differently. Always use high details and text what it is or where it is
// from"). A 50 kg sack of grain or flour lies flat, not round: a rounded brick with a flat bottom, the sewn end full,
// the mouth gathered and tied with a cord into a tuft; the hessian woven, with the merchant's stencil on top (what is
// in it, where from, the weight, his mark). Stacked they lie in rows, each upper sack pressed into the dip between two
// below (shared/goods.ts sackPileSpot).
//
// Lying or standing (Steve 2026-09-28, "when do we use standing and lying?"): LYING wherever sacks are stored or moved
// (piles, stacks, pallets, carts, drays, wagons, across a man's shoulder, one put down): they stack and travel that
// way. STANDING only for one sack set down by itself to be worked at: at the scale, sampled, opened at a shop to show
// what is in it, waiting against crates or by a door; never in a pile or a load. Both are this one model
// (CLAUDE.md: one model per thing, changed everywhere).
//
// One shape for every sack (made once); one material per stencil, made on first use: the same shader as every
// hessian of the town (psx Lambert with a map), so no new shader kind (docs/rendering.md); its bump comes from its own
// picture in the warm-up (world/bumps.ts: "sack" reads as fibre).

/** The sack as it lies (m, shared/goods.ts SACK_LIE): length along x, height, width along z. Sewn end -x, tied mouth +x. */
export const SACK_L = SACK_LIE.l;
export const SACK_H = SACK_LIE.h;
export const SACK_W = SACK_LIE.w;
/** An upper sack sinks this far into the dip between the two below it. */
export const SACK_NEST = SACK_LIE.nest;

/** What a sack is and says (shared/goodsCatalog.ts): its goods (for its look), the words, the mark, the ink. */
export type { SackLabel };
export { pickSack, sackOf };

/** The look of a sack of these goods (the goods list; plain grain when unknown). */
const lookOf = (goods?: string): SackLook => (SACK_GOODS[goods ?? ""] ?? SACK_GOODS.rye).look;

const geos = new Map<string, THREE.BufferGeometry>();

/** A small fixed noise for the lumps of the filling (the same on every PC). */
function lump(x: number, y: number, z: number): number {
  return Math.sin(x * 7.1 + z * 3.3) * 0.5 + Math.sin(y * 9.7 + x * 2.9) * 0.3 + Math.sin(z * 11.3 - y * 5.1) * 0.2;
}

/**
 * The sack's shape for these goods: a superellipsoid on a lat-long sphere, poles on the length (seamless around, tied
 * at +x), as full, lumpy and slack as the goods make it (coffee's beans show, flour sags, salt stands hard).
 */
export function sackGeometry(goods?: string): THREE.BufferGeometry {
  const look = lookOf(goods);
  const key = `${look.fullness}|${look.lump}|${look.slump}`;
  const hit = geos.get(key);
  if (hit) return hit;
  // poles on x; the sphere's seam (u = 0) at the bottom, out of sight
  // (24 round, 14 along: the sag, the lumps and the neck read in the PS1 look; hundreds lie about, merged: goods.ts drawSacks)
  const body = new THREE.SphereGeometry(1, 24, 14).rotateZ(Math.PI / 2);
  const pos = body.getAttribute("position") as THREE.BufferAttribute;
  const uv = body.getAttribute("uv") as THREE.BufferAttribute;
  const sgnPow = (v: number, e: number) => Math.sign(v) * Math.pow(Math.abs(v), e);
  for (let i = 0; i < pos.count; i++) {
    const nx = pos.getX(i);
    const ny = pos.getY(i);
    const nz = pos.getZ(i);
    // round across (boxy, a filled sack's section), full at the sewn end, gathered toward the mouth
    const ex = nx < 0 ? 0.5 : 0.62;
    let x = sgnPow(nx, ex);
    let y = sgnPow(ny, 0.42);
    let z = sgnPow(nz, 0.42);
    // toward the mouth the filling gives out: lower and narrower, the cloth pulled in to the neck
    const t = Math.max(0, x);
    // (a sack keeps its fill nearly to the end; the last hand's breadth is gathered into the tied neck)
    // (a slack sack gathers sooner and sags more; a hard full one keeps its fill to the neck)
    const pe = 7 - 3 * look.slump;
    const pinch = 1 - (0.5 + 0.15 * look.slump) * Math.pow(t, pe);
    y *= pinch;
    z *= 1 - 0.6 * Math.pow(t, pe);
    // the filling settles: the top a little domed, the bottom flat on the ground, the sides bulging low
    if (y < 0) y *= 0.8;
    else y *= 1 - (0.06 + 0.12 * look.slump) * x * x;
    z *= 1 + (0.03 + 0.08 * look.slump) * (1 - Math.abs(y));
    // lumps (the beans of coffee show through, grain lies smooth), and creases in the loose cloth by the mouth
    const k = (0.012 + 0.04 * look.lump) * lump(x * (1 + look.lump), y, z * (1 + look.lump)) + (t > 0.55 ? 0.05 * Math.sin(z * 24 + y * 9) * (t - 0.55) : 0);
    x = x * (SACK_L / 2 - 0.05) + (nx < 0 ? -0.004 * lump(y, z, x) : 0);
    y = y * (SACK_H / 1.8) * look.fullness * (1 + k);
    z = z * (SACK_W / 2) * (0.96 + 0.04 * look.fullness) * (1 + k * 0.6);
    pos.setXYZ(i, x, y, z);
    // the picture goes on along the length (u) and round it (v: 0.5 on top), so the stencil sits on the top
    const u0 = uv.getX(i);
    const v0 = uv.getY(i);
    uv.setXY(i, v0, u0);
  }
  // flat on the ground: the lowest point at y = 0
  body.computeBoundingBox();
  body.translate(0, -body.boundingBox!.min.y, 0);
  // the neck: the gathered mouth, tied with a cord, and the tuft beyond it
  const neckX = SACK_L / 2 - 0.06;
  const neckY = SACK_H * 0.42;
  const neck = new THREE.CylinderGeometry(0.035, 0.055, 0.1, 10, 1, true).rotateZ(-Math.PI / 2).translate(neckX + 0.04, neckY, 0);
  const cord = new THREE.TorusGeometry(0.04, 0.012, 5, 12).rotateY(Math.PI / 2).translate(neckX + 0.07, neckY, 0);
  const tuft = new THREE.ConeGeometry(0.075, 0.09, 10, 1, true).rotateZ(Math.PI / 2).translate(neckX + 0.12, neckY, 0);
  // (the neck's cloth on the plain hessian at the picture's edge; the cord dark)
  for (const g of [neck, tuft]) {
    const a = g.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) a.setXY(i, 0.93 + a.getX(i) * 0.05, 0.05 + a.getY(i) * 0.2);
  }
  {
    const a = cord.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) a.setXY(i, 0.985, 0.985);
  }
  // (the body's normals smooth over its lumps, worked out on the shared vertices; the small parts keep their own)
  body.computeVertexNormals();
  // (indexed: about 520 points a sack; the piles merge hundreds of them, game/goods.ts drawSacks)
  const parts = [body, neck, cord, tuft];
  for (const p of parts) for (const k of Object.keys(p.attributes)) if (!["position", "normal", "uv"].includes(k)) p.deleteAttribute(k);
  const merged = mergeGeometries(parts)!;
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  merged.name = `sack ${goods ?? ""}`;
  geos.set(key, merged);
  return merged;
}

const standGeos = new Map<string, THREE.BufferGeometry>();

/**
 * The same sack stood on its sewn end, the tied mouth up (at the scale for weighing, against a stack of crates, a
 * sampler's spike in it): the lying shape turned up and let out to a rounder section, as a standing sack sags; the
 * stencil on its front (-x). 0.88 m high, about 0.5 m across.
 */
export function standingSackGeometry(goods?: string): THREE.BufferGeometry {
  const hit = standGeos.get(goods ?? "");
  if (hit) return hit;
  const g = sackGeometry(goods).clone().rotateZ(Math.PI / 2);
  g.computeBoundingBox();
  const b = g.boundingBox!;
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  g.scale(SACK_W / Math.max(0.01, b.max.x - b.min.x), 1, 1);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  g.name = `sack standing ${goods ?? ""}`;
  standGeos.set(goods ?? "", g);
  return g;
}

/**
 * A sack as a mesh: lying or standing, with its stencil; with `fit` scaled to that size (x, y, z in its own frame: the
 * old models' places on the quays' heaps keep their sizes, so nothing floats or sinks). One model for every sack.
 */
export function sackMesh(label: SackLabel, opts: { standing?: boolean; fit?: [number, number, number] } = {}): THREE.Mesh {
  const g = opts.standing ? standingSackGeometry(label.goods) : sackGeometry(label.goods);
  const m = new THREE.Mesh(g, sackMaterial(label));
  m.name = "sack";
  if (opts.fit) {
    const b = g.boundingBox!;
    m.scale.set(opts.fit[0] / (b.max.x - b.min.x), opts.fit[1] / (b.max.y - b.min.y), opts.fit[2] / (b.max.z - b.min.z));
  }
  return m;
}

// ------------------------------------------------------------------ the hessian and the stencil

const mats = new Map<string, THREE.Material>();

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hashStr = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/**
 * The picture: woven hessian (warp and weft, slubs, the odd dark thread, grime low down and at the ends, the side
 * seam), and the stencil on top: the goods in big letters, where from, the weight and the merchant's mark in a
 * diamond. x runs along the sack (0 the sewn end, 1 the mouth), y round it (the middle row is the top).
 */
function paint(label: SackLabel): HTMLCanvasElement {
  const W = 256;
  const H = 256;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const r = rng(hashStr(label.goods + label.what + label.from + label.mark));
  const look = lookOf(label.goods);
  // the cloth of these goods (shared/goodsCatalog.ts), each lot a little its own
  const base = look.cloth.map((v) => v - 8 + r() * 16);
  g.fillStyle = `rgb(${base[0] | 0},${base[1] | 0},${base[2] | 0})`;
  g.fillRect(0, 0, W, H);
  if (look.weave === "mat") {
    // plaited matting (a sugar kranjang): broad strips over and under, on the slant
    for (let y = 0; y < H; y += 2)
      for (let x = 0; x < W; x += 2) {
        const a = Math.floor((x + y) / 14);
        const b = Math.floor((x - y + 512) / 14);
        const over = (a + b) % 2 === 0;
        const edge = (x + y) % 14 < 2 || (x - y + 512) % 14 < 2;
        const v = (over ? 22 : -18) + (edge ? -26 : 0) + (r() - 0.5) * 10;
        g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 240 : 0},${v > 0 ? 190 : 0},${Math.abs(v) / 110})`;
        g.fillRect(x, y, 2, 2);
      }
  } else {
    // the weave: every other thread over, every other under; jute coarse, hessian tight, gunny light, linen fine
    const t = look.weave === "jute" ? 3 : look.weave === "linen" ? 1 : 2;
    const amp = look.weave === "linen" ? 0.45 : look.weave === "gunny" ? 0.8 : look.weave === "jute" ? 1.25 : 1;
    for (let y = 0; y < H; y += t)
      for (let x = 0; x < W; x += t) {
        const over = (Math.floor(x / t) + Math.floor(y / t)) % 2 === 0;
        const v = ((over ? 18 : -22) + (r() - 0.5) * 14) * amp;
        g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 235 : 0},${v > 0 ? 200 : 0},${Math.abs(v) / 110})`;
        g.fillRect(x, y, over ? t : Math.max(1, t - 1), over ? Math.max(1, t - 1) : t);
      }
  }
  // slubs (thick bits in the yarn) and dark threads: many in jute, few in linen
  const slubs = look.weave === "jute" ? 160 : look.weave === "linen" ? 20 : look.weave === "mat" ? 0 : 90;
  for (let i = 0; i < slubs; i++) {
    const y = (r() * H) | 0;
    const x = (r() * W) | 0;
    g.fillStyle = r() < 0.7 ? "rgba(214,188,140,0.55)" : "rgba(70,52,30,0.5)";
    g.fillRect(x, y, 3 + ((r() * 8) | 0), 1);
  }
  for (let i = 0; i < 4; i++) {
    const x = (r() * W) | 0;
    g.fillStyle = "rgba(60,44,26,0.35)";
    g.fillRect(x, 0, 1, H);
  }
  // grime: the underside (the rows at the top and bottom of the picture) and both ends, from the quay's stones
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "rgba(40,30,20,0.5)");
  grad.addColorStop(0.22, "rgba(40,30,20,0)");
  grad.addColorStop(0.78, "rgba(40,30,20,0)");
  grad.addColorStop(1, "rgba(40,30,20,0.5)");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  const ends = g.createLinearGradient(0, 0, W, 0);
  ends.addColorStop(0, "rgba(50,36,22,0.35)");
  ends.addColorStop(0.12, "rgba(50,36,22,0)");
  ends.addColorStop(0.86, "rgba(50,36,22,0)");
  ends.addColorStop(1, "rgba(50,36,22,0.3)");
  g.fillStyle = ends;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(30,22,12,${r() * 0.25})`;
    g.fillRect((r() * W) | 0, (r() * H) | 0, 1 + ((r() * 3) | 0), 1 + ((r() * 2) | 0));
  }
  // the side seam, sewn with a coarse twine (along the side of the sack)
  for (const y of [H * 0.25, H * 0.75]) {
    g.fillStyle = "rgba(80,58,34,0.6)";
    g.fillRect(0, y - 1, W, 2);
    for (let x = 4; x < W; x += 7) {
      g.fillStyle = "rgba(210,190,150,0.8)";
      g.fillRect(x, y - 2, 3, 1);
      g.fillRect(x + 1, y + 1, 3, 1);
    }
  }
  // the stencil: worn ink, letters broken by the stencil's bridges, the weave showing through
  const ink = label.ink ?? "#1e1a18";
  g.save();
  g.globalAlpha = 0.86;
  g.fillStyle = ink;
  g.strokeStyle = ink;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const cx = W * 0.47;
  const cy = H * 0.5;
  // the merchant's mark: a diamond with his letters, on the sewn-end side
  g.lineWidth = 3;
  g.beginPath();
  const mx = W * 0.16;
  g.moveTo(mx, cy - 20);
  g.lineTo(mx + 20, cy);
  g.lineTo(mx, cy + 20);
  g.lineTo(mx - 20, cy);
  g.closePath();
  g.stroke();
  g.font = `bold 13px Georgia, 'Times New Roman', serif`;
  g.fillText(label.mark, mx, cy + 1);
  // the goods, big; where from and the weight below, smaller
  g.font = `bold 27px 'Scheldemist Print', Georgia, 'Times New Roman', serif`;
  fitText(g, label.what, cx + 18, cy - 12, W * 0.5);
  g.font = `bold 17px 'Scheldemist Print', Georgia, 'Times New Roman', serif`;
  fitText(g, label.from, cx + 18, cy + 12, W * 0.5);
  g.font = `bold 11px Georgia, 'Times New Roman', serif`;
  g.fillText(`${look.kg} KIL.`, cx + 18, cy + 27);
  g.restore();
  // dust: flour white over it all, thickest at the seams and ends; salt as a white crust low down and on the seams
  if (look.dust) {
    const n = look.dust === "flour" ? 900 : 500;
    for (let i = 0; i < n; i++) {
      const low = look.dust === "salt";
      const y = low ? (r() < 0.5 ? r() * H * 0.25 : H - r() * H * 0.25) : r() * H;
      const x = r() < 0.3 ? (r() < 0.5 ? r() * W * 0.12 : W - r() * W * 0.12) : r() * W;
      g.fillStyle = `rgba(245,242,232,${(low ? 0.25 : 0.12) + r() * 0.3})`;
      g.fillRect(x | 0, y | 0, 1 + ((r() * (low ? 4 : 3)) | 0), 1 + ((r() * 2) | 0));
    }
  }
  // the stencil's bridges and the wear: thin gaps of cloth through the letters, and patches rubbed off
  for (let i = 0; i < 26; i++) {
    const x = cx - W * 0.3 + r() * W * 0.72;
    const y = cy - 30 + r() * 64;
    g.fillStyle = `rgba(${base[0] | 0},${base[1] | 0},${base[2] | 0},${0.35 + r() * 0.4})`;
    g.fillRect(x, y, 1 + ((r() * 2) | 0), 4 + ((r() * 10) | 0));
  }
  return c;
}

/** Text squeezed to a width if it is too long. */
function fitText(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number): void {
  const w = g.measureText(text).width;
  if (w <= max) return g.fillText(text, x, y);
  g.save();
  g.translate(x, y);
  g.scale(max / w, 1);
  g.fillText(text, 0, 0);
  g.restore();
}

/** The material of a sack with this stencil (made once per stencil). */
export function sackMaterial(label: SackLabel): THREE.Material {
  const key = `${label.goods}|${label.what}|${label.from}|${label.mark}|${label.ink ?? ""}`;
  let m = mats.get(key);
  if (m) return m;
  const tex = new THREE.CanvasTexture(paint(label));
  // (the bump audit: named for what it is: "sack" reads as fibre, world/bumps.ts)
  tex.name = "sack hessian";
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  m = psx(new THREE.MeshLambertMaterial({ map: tex, color: 0xffffff }));
  m.name = "sack";
  mats.set(key, m);
  return m;
}

// ------------------------------------------------------------------ what is in them

/** The mills' own: their flour, and the grain their cart fetches from the dock (a lot of rye or wheat). */
export const MILL_LABELS: Record<string, { flour: SackLabel; grain: SackLabel }> = {
  mill_mid: { flour: { goods: "flour", what: "FLOUR", from: "KIPDORP MILL", mark: "KM" }, grain: pickSack("mill:mill_mid:grain", [["rye", 2], ["wheat", 1]]) },
  mill_ne: { flour: { goods: "flour", what: "FLOUR", from: "NORTH MILL", mark: "NM", ink: "#1c2a4a" }, grain: pickSack("mill:mill_ne:grain", [["wheat", 2], ["rye", 1]]) },
};

/** The route places of the dockers' piles (shared/hauls.ts route ids: rk-, hn-, en-, bs-, wf-, vm-, ca-). */
const ROUTE_PLACE: Record<string, string> = { rk: "rijnkaai", hn: "hessenatie", en: "entrepot", bs: "bassin_south", wf: "werf", vm: "vismarkt", ca: "canal" };

/**
 * What a sack is and says, by its item id (haul:rk-m:a:2, sack:0:3, qg:21:4, job:12:0 ...) and where it lies: picked from
 * the goods list (shared/goodsCatalog.ts pickSack) by its lot, so a pile or a heap is one lot and every lot its own,
 * the same on every PC. A sack keeps it wherever it goes (pile, hands, cart, ground): the id does not change.
 */
export function sackLabelFor(id: string | null | undefined, place?: string | Array<[string, number]>): SackLabel {
  const s = id ?? "";
  const haul = /^haul:([a-z]+)-/.exec(s);
  const where = place ?? (haul ? ROUTE_PLACE[haul[1]] : s.startsWith("sack:") ? "rijnkaai" : "quay");
  // (a pile, a heap, a job's goods: one lot; the last number is the sack in it)
  const lot = /^(haul:|sack:|qg:|job:|pile:|own:)/.test(s) ? s.replace(/:\d+$/, "") : s;
  return pickSack(lot, where);
}

// ------------------------------------------------------------------ a load of sacks on a bed (drays, carts)

const loadGeos = new Map<string, THREE.BufferGeometry>();

/**
 * Sacks laid on a bed (a dray's, a cart's): the box is the space the load may fill, in the bed's own frame. They lie
 * across it side by side (end to end where two fit across), the next layer in the dips between them, up to `count`
 * (bottom layer first) or as many as fit. One merged geometry, the one sack model (CLAUDE.md: one model per thing).
 */
export function sackLoadGeometry(box: THREE.Box3, count = Infinity, goods?: string): THREE.BufferGeometry {
  const key = `${box.min.toArray().map((v) => v.toFixed(2))}|${box.max.toArray().map((v) => v.toFixed(2))}|${count}|${goods ?? ""}`;
  const hit = loadGeos.get(key);
  if (hit) return hit;
  const sx = box.max.x - box.min.x;
  const sz = box.max.z - box.min.z;
  const alongZ = sz >= sx; // rows run along the bed's length; each sack lies across it
  const across = alongZ ? sx : sz;
  const along = alongZ ? sz : sx;
  const perRow = Math.max(1, Math.floor(across / (SACK_L * 0.95)));
  const rows = Math.max(1, Math.floor(along / SACK_W));
  const height = box.max.y - box.min.y;
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const base = sackGeometry(goods);
  const geos: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  outer: for (let layer = 0; ; layer++) {
    const y = box.min.y + layer * (SACK_H - SACK_NEST);
    const n = rows - layer;
    if (n < 1 || (layer > 0 && y + SACK_H > box.min.y + height + 0.12)) break;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < perRow; c++) {
        if (geos.length >= count) break outer;
        const a = (r - (n - 1) / 2) * SACK_W; // along the bed
        const b = (c - (perRow - 1) / 2) * (across / perRow); // across it
        // (the mouths out to either side, a little askew each)
        const turn = (c % 2 ? Math.PI : 0) + (((r * 7 + c * 3 + layer * 5) % 5) - 2) * 0.03;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (alongZ ? 0 : Math.PI / 2) + turn);
        m.compose(new THREE.Vector3(alongZ ? cx + b : cx + a, y, alongZ ? cz + a : cz + b), q, one);
        geos.push(base.clone().applyMatrix4(m));
      }
    }
  }
  const g = geos.length ? mergeGeometries(geos)! : new THREE.BufferGeometry();
  for (const q2 of geos) if (q2 !== g) q2.dispose();
  g.computeBoundingSphere();
  g.name = "sack load";
  loadGeos.set(key, g);
  return g;
}

// ------------------------------------------------------------------ a sack on a figure (people.glb)

/** Where the one sack hangs on a figure (tools/blender/build_people.py writes people_sockets.json): model space at rest. */
export interface SackSocket {
  bone: string;
  /** The sack's two ends and its half thickness. */
  a: number[];
  b: number[];
  r: number;
  /** Which way its top faces (else up). */
  up?: number[];
}

/**
 * The one sack model hung on a figure's bone where people.glb's own sack was (a docker's shoulder, a porter's sack
 * truck): placed in the figure's space at rest and attached to the bone, so it goes with the clip. Returns the mesh.
 */
export function hangSack(root: THREE.Object3D, socket: SackSocket, label: SackLabel): THREE.Mesh | null {
  const bone = root.getObjectByName(socket.bone);
  if (!bone) return null;
  const a = new THREE.Vector3(...(socket.a as [number, number, number]));
  const b = new THREE.Vector3(...(socket.b as [number, number, number]));
  const len = a.distanceTo(b);
  const x = b.clone().sub(a).normalize();
  const upHint = socket.up ? new THREE.Vector3(...(socket.up as [number, number, number])) : new THREE.Vector3(0, 1, 0);
  const y = upHint.sub(x.clone().multiplyScalar(upHint.dot(x))).normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  const m = sackMesh(label, { fit: [len * 1.08, socket.r * 2, socket.r * 2.3] });
  // the sack's middle at the ends' middle; its own origin is on its underside, half its thickness below
  const mid = a.clone().add(b).multiplyScalar(0.5).sub(y.clone().multiplyScalar(socket.r));
  m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  m.position.copy(mid);
  root.updateWorldMatrix(true, true);
  bone.attach(m);
  m.name = "sack";
  return m;
}

// ------------------------------------------------------------------ an open sack (shops, stalls)

const openGeos = new Map<string, THREE.BufferGeometry>();
/** Where the goods heap sits in an open sack (its height and radius), for the callers that heap goods in it. */
export const OPEN_SACK = { top: 0.6, r: 0.2 };

/**
 * The same sack stood up and opened, its top rolled down into a thick rim (a shop's or a stall's potatoes, beans,
 * flour, chestnuts heaped in it: the caller puts the goods at OPEN_SACK.top). The standing sack cut at the rim's height
 * and the rolled cloth round it; one model (CLAUDE.md).
 */
export function openSackGeometry(goods?: string): THREE.BufferGeometry {
  const hit = openGeos.get(goods ?? "");
  if (hit) return hit;
  const g = standingSackGeometry(goods).clone();
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const top = OPEN_SACK.top;
  // everything above the rim pressed down onto it: the neck and tuft go, the top is open (the goods cover it)
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > top) pos.setY(i, top - 0.0015 * (i % 7));
  g.computeVertexNormals();
  // the rolled-down cloth: a fat ring round the mouth, on the plain cloth at the picture's edge
  const b = new THREE.Box3().setFromBufferAttribute(pos);
  const rx = (b.max.x - b.min.x) / 2;
  const rz = (b.max.z - b.min.z) / 2;
  const rim = new THREE.TorusGeometry(1, 0.05, 6, 18).rotateX(Math.PI / 2);
  const rp = rim.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < rp.count; i++) rp.setXYZ(i, rp.getX(i) * rx * 0.92, rp.getY(i) + top - 0.02, rp.getZ(i) * rz * 0.92);
  const ru = rim.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < ru.count; i++) ru.setXY(i, 0.9 + ru.getX(i) * 0.08, 0.1 + ru.getY(i) * 0.2);
  rim.computeVertexNormals();
  const parts = [g, rim];
  for (const p of parts) for (const k of Object.keys(p.attributes)) if (!["position", "normal", "uv"].includes(k)) p.deleteAttribute(k);
  const merged = mergeGeometries(parts)!;
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  merged.name = `sack open ${goods ?? ""}`;
  openGeos.set(goods ?? "", merged);
  return merged;
}
