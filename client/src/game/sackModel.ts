import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { psx } from "../retro/psx";
import { SACK_LIE } from "../../../shared/goods";

// A filled sack lying down, as a docker drops it (Steve 2026-09-28: "sacks that stack but seem like balloons just
// stacked while in reality sacks stack differently. Always use high details and text what it is or where it is
// from"). A 50 kg sack of grain or flour lies flat, not round: a rounded brick with a flat bottom, the sewn end full,
// the mouth gathered and tied with a cord into a tuft; the hessian woven, with the merchant's stencil on top (what is
// in it, where from, the weight, his mark). Stacked they lie in rows, each upper sack pressed into the dip between two
// below (shared/goods.ts sackPileSpot).
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

/** What a sack says: the goods and where from (a line each), and the merchant's mark (two or three letters). */
export interface SackLabel {
  what: string;
  from: string;
  mark: string;
  /** The ink: most are black, some blue or red. */
  ink?: string;
}

let geo: THREE.BufferGeometry | null = null;

/** A small fixed noise for the lumps of the filling (the same on every PC). */
function lump(x: number, y: number, z: number): number {
  return Math.sin(x * 7.1 + z * 3.3) * 0.5 + Math.sin(y * 9.7 + x * 2.9) * 0.3 + Math.sin(z * 11.3 - y * 5.1) * 0.2;
}

/** The sack's shape: a superellipsoid on a lat-long sphere, poles on the length (seamless around, tied at +x). */
export function sackGeometry(): THREE.BufferGeometry {
  if (geo) return geo;
  // poles on x; the sphere's seam (u = 0) at the bottom, out of sight
  const body = new THREE.SphereGeometry(1, 36, 22).rotateZ(Math.PI / 2);
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
    const pinch = 1 - 0.55 * Math.pow(t, 7);
    y *= pinch;
    z *= 1 - 0.6 * Math.pow(t, 7);
    // the filling settles: the top a little domed, the bottom flat on the ground, the sides bulging low
    if (y < 0) y *= 0.8;
    else y *= 1 - 0.1 * x * x;
    z *= 1 + 0.06 * (1 - Math.abs(y));
    // lumps, and creases in the loose cloth by the mouth
    const k = 0.035 * lump(x, y, z) + (t > 0.55 ? 0.05 * Math.sin(z * 24 + y * 9) * (t - 0.55) : 0);
    x = x * (SACK_L / 2 - 0.05) + (nx < 0 ? -0.004 * lump(y, z, x) : 0);
    y = y * (SACK_H / 1.8) * (1 + k);
    z = z * (SACK_W / 2) * (1 + k * 0.6);
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
  const parts = [body, neck, cord, tuft].map((g) => (g.index ? g.toNonIndexed() : g));
  for (const p of parts) for (const k of Object.keys(p.attributes)) if (!["position", "normal", "uv"].includes(k)) p.deleteAttribute(k);
  const merged = mergeGeometries(parts)!;
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  merged.name = "sack";
  geo = merged;
  return geo;
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
  const r = rng(hashStr(label.what + label.from + label.mark));
  // the cloth: a warm hessian, each sack a little its own
  const base = [152 + r() * 18, 124 + r() * 14, 84 + r() * 12];
  g.fillStyle = `rgb(${base[0] | 0},${base[1] | 0},${base[2] | 0})`;
  g.fillRect(0, 0, W, H);
  // the weave: every other thread over, every other under, two pixels a thread
  for (let y = 0; y < H; y += 2)
    for (let x = 0; x < W; x += 2) {
      const over = ((x >> 1) + (y >> 1)) % 2 === 0;
      const v = (over ? 18 : -22) + (r() - 0.5) * 14;
      g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 235 : 0},${v > 0 ? 200 : 0},${Math.abs(v) / 110})`;
      g.fillRect(x, y, over ? 2 : 1, over ? 1 : 2);
    }
  // slubs (thick bits in the yarn) and dark threads
  for (let i = 0; i < 90; i++) {
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
  g.fillText("50 KIL.", cx + 18, cy + 27);
  g.restore();
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
  const key = `${label.what}|${label.from}|${label.mark}|${label.ink ?? ""}`;
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

/**
 * Antwerp's sacked imports of the 1870s by quay (the grain of the Baltic and the Black Sea, coffee from Brazil and
 * Java, rice from Rangoon, sugar, salt for the fish market, malt and barley for the brewers' canal), and the mills'
 * flour. The mark is the merchant's or the natie's.
 */
const BY_PLACE: Record<string, SackLabel[]> = {
  rijnkaai: [
    { what: "COFFEE", from: "SANTOS", mark: "JVR" },
    { what: "COFFEE", from: "RIO DE JANEIRO", mark: "KB", ink: "#1c2a4a" },
  ],
  hessenatie: [
    { what: "RYE", from: "ODESSA", mark: "HN" },
    { what: "WHEAT", from: "DANZIG", mark: "HN" },
  ],
  entrepot: [
    { what: "RICE", from: "RANGOON", mark: "E&C", ink: "#5a1c14" },
    { what: "SUGAR", from: "JAVA", mark: "NHM" },
  ],
  bassin_south: [
    { what: "COFFEE", from: "JAVA", mark: "NHM" },
    { what: "WHEAT", from: "NEW YORK", mark: "RS", ink: "#1c2a4a" },
  ],
  werf: [
    { what: "OATS", from: "RIGA", mark: "VD" },
    { what: "BARLEY", from: "ZEELAND", mark: "MV" },
  ],
  vismarkt: [{ what: "SALT", from: "SETUBAL", mark: "PC" }],
  canal: [
    { what: "MALT", from: "ANTWERP", mark: "BR" },
    { what: "BARLEY", from: "ZEELAND", mark: "BR" },
  ],
};
const ANY: SackLabel[] = [
  { what: "RYE", from: "ODESSA", mark: "HN" },
  { what: "COFFEE", from: "SANTOS", mark: "JVR" },
  { what: "WHEAT", from: "DANZIG", mark: "VL" },
  { what: "RICE", from: "RANGOON", mark: "E&C", ink: "#5a1c14" },
  { what: "BEANS", from: "SMYRNA", mark: "AS" },
];
/** The mills' own: flour to the bakery, grain from the dock. */
export const MILL_LABELS: Record<string, { flour: SackLabel; grain: SackLabel }> = {
  mill_mid: { flour: { what: "FLOUR", from: "KIPDORP MILL", mark: "KM" }, grain: { what: "RYE", from: "ODESSA", mark: "HN" } },
  mill_ne: { flour: { what: "FLOUR", from: "NORTH MILL", mark: "NM", ink: "#1c2a4a" }, grain: { what: "WHEAT", from: "DANZIG", mark: "VL" } },
};

/** The route places of the dockers' piles (shared/hauls.ts route ids: rk-, hn-, en-, bs-, wf-, vm-, ca-). */
const ROUTE_PLACE: Record<string, string> = { rk: "rijnkaai", hn: "hessenatie", en: "entrepot", bs: "bassin_south", wf: "werf", vm: "vismarkt", ca: "canal" };

/** What a sack says, by its item id (haul:rk-m:a:2, sack:0:3, job:12:0 ...) or a place; the same on every PC. */
export function sackLabelFor(id: string | null | undefined, place?: string): SackLabel {
  const s = id ?? "";
  const h = hashStr(s);
  const haul = /^haul:([a-z]+)-/.exec(s);
  const where = place ?? (haul ? ROUTE_PLACE[haul[1]] : s.startsWith("sack:") ? "rijnkaai" : undefined);
  const list = (where && BY_PLACE[where]) || ANY;
  // (a pile is one lot: its sacks say the same; a job's goods, one lot per job)
  const lot = haul ? hashStr(s.replace(/:\d+$/, "")) : s.startsWith("sack:") ? hashStr(s.replace(/:\d+$/, "")) : /^job:(\d+):/.test(s) ? hashStr(s.replace(/:\d+$/, "")) : h;
  return list[lot % list.length];
}
