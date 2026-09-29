import * as THREE from "three";
import * as P from "../../../shared/cathedralPlan";
import { pointedAt } from "../../../shared/gothicPlan";
import { canvasTex, flicker, frameRoom, rand, type Seat } from "./rooms";
import { glowTexture } from "./textures";
import { Flames, glass, Kit, lmBasic, lmMat, marble, pointedProfile, type MatDef, type PieceOpts } from "./landmarkKit";
import { buildHallSun, type SunWindow } from "./hallSun";
import { walkGraph, type LandmarkRoom, type Lookable, type Mark } from "./landmarkRooms";
import { planarUV } from "./carolusHall";
import { SHELL_OPENINGS } from "../../../shared/cathedralShell";
import { inFrame, type ShellFace, type ShellOpening } from "../../../shared/shellOpening";
import { lining } from "./realOpenings";
import { roomGlassFrom, whenShellGlass } from "./shellGlass";

/**
 * Issue #10 (interiors are real): the shell's real openings (the windows over the hall and the west door), in the hall's
 * frame. The hall's walls are lined from the shell's reveals in, cut exactly there; its glass is the shell's old pane.
 */
export const WINDOWS: ShellOpening[] = inFrame(SHELL_OPENINGS, P.ORIGIN, 0);

// Onze-Lieve-Vrouwekathedraal inside, as it stood in 1873 (M7 cathedral interior pass, 2026-09-26; the plan in
// shared/cathedralPlan.ts, set in the world by world/cathedralInWorld.ts). The Brabant Gothic "stone forest": the
// nave and three aisles each side on pale clustered piers without capitals, their mouldings running on into the
// pointed arches, rib vaults bay by bay, tall lancets of 19th-century coloured glass and clear grisaille, the crossing
// open to its lantern with the painted Assumption in the dome (1647). Rubens's triptychs back from Paris on the
// transept arms' east walls, wings open: the Elevation of the Cross (north) and the Descent from the Cross (south);
// his Assumption in the neoclassical marble high altar of 1824 in the apse; the Resurrection triptych on the
// ambulatory's wall. Van der Voort's oak pulpit of 1713 (trees, birds, the four continents at its foot), the
// neo-Gothic choir stalls begun in 1840, the organ on the west gallery, baroque confessionals with carved figures,
// side altars with their paintings along the outer aisles, rush chairs in rows, candles and votive stands, a floor
// of bluestone and grave slabs. Every picture is a new Codex painting in the manner of the period (no copies;
// assets/ATTRIBUTION.md), and every stone, wood and floor surface takes its bump from its own picture
// (retro/psx.ts bumpFromMap).

// ---------------------------------------------------------------- pictures and materials

/** A picture from public/textures, drawn once it has loaded (a bump made from it waits for it as well). */
function picture(url: string, o: { clamp?: boolean; flip?: boolean } = {}): THREE.Texture {
  const img = new Image();
  const t = new THREE.Texture(img);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = o.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  if (o.flip) {
    t.repeat.x = -1;
    t.offset.x = 1;
  }
  img.onload = () => {
    t.needsUpdate = true;
  };
  img.onerror = () => console.warn("cathedral: a picture did not load", url);
  img.src = url;
  return t;
}

let pics: ReturnType<typeof makePics> | null = null;
function makePics() {
  const stone = picture("/textures/cath_stone.jpg");
  const wash = picture("/textures/pj_wash.jpg");
  const floor = picture("/textures/cath_floor.jpg");
  const oak = picture("/textures/carolus_oak.jpg");
  return { stone, wash, floor, oak };
}

/** Gilding: a warm gold with the scrolls of carved ornament in it (its bump comes from them). */
const giltTex = () =>
  canvasTex(64, 64, (g) => {
    const r = rand(1713);
    g.fillStyle = "#c89c48";
    g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = r() < 0.5 ? "rgba(90,58,16,0.75)" : "rgba(255,226,150,0.7)";
      g.lineWidth = 1 + r() * 2;
      g.beginPath();
      const x = r() * 64;
      const y = r() * 64;
      g.arc(x, y, 3 + r() * 7, r() * 6, r() * 6 + 3.5);
      g.stroke();
    }
  });

/** Carved oak in the round (figures, leaves, birds): brown with the grain running along it, tool marks. */
const carvedOakTex = () =>
  canvasTex(32, 64, (g) => {
    const r = rand(1667);
    g.fillStyle = "#6a4a30";
    g.fillRect(0, 0, 32, 64);
    for (let x = 0; x < 32; x++) {
      const v = (r() - 0.5) * 40;
      g.fillStyle = `rgba(${120 + v},${84 + v * 0.7},${52 + v * 0.5},0.5)`;
      g.fillRect(x, 0, 1, 64);
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = r() < 0.5 ? "rgba(40,24,12,0.45)" : "rgba(170,130,90,0.35)";
      g.fillRect(r() * 32, r() * 64, 2 + r() * 4, 1 + r() * 2);
    }
  });

/** The rush seats: woven rush, twisted strands in rows. */
const rushTex = () =>
  canvasTex(32, 32, (g) => {
    const r = rand(1873);
    g.fillStyle = "#8a7440";
    g.fillRect(0, 0, 32, 32);
    for (let y = 0; y < 32; y += 3)
      for (let x = 0; x < 32; x += 4) {
        g.fillStyle = `rgb(${150 + r() * 40},${126 + r() * 30},${70 + r() * 20})`;
        g.fillRect(x + (y % 6 ? 2 : 0), y, 3, 2);
      }
  });

/** A ladder-back chair: two uprights and three rails, the gaps see-through. */
const chairBackTex = () =>
  canvasTex(
    16,
    32,
    (g) => {
      g.clearRect(0, 0, 16, 32);
      g.fillStyle = "#a47a52";
      g.fillRect(0, 0, 3, 32);
      g.fillRect(13, 0, 3, 32);
      for (const y of [1, 8, 15]) g.fillRect(0, y, 16, 4);
    },
    false,
  );

let mats: ReturnType<typeof makeMats> | null = null;
function makeMats() {
  const p = (pics ??= makePics());
  const paint = (key: string, file: string, flip = false): MatDef => {
    const t = picture(`/textures/${file}`, { clamp: true, flip });
    return lmMat(key, { map: t, emissiveMap: t, emissive: 0x4e4234, color: 0xd0c8b8 }, 0, 0.15);
  };
  const gilt = giltTex();
  return {
    // (the last number: the bump's strength, from the picture's own light and dark (retro/psx.ts bumpFromMap). three.js
    // tilts the normal by the height's change per screen pixel, so a stone seen from 1-3 m needs about 1 to show its joints)
    stone: lmMat("ct_stone", { map: p.stone, color: 0xf2eee6 }, 0.05, 1.4),
    stoneDark: lmMat("ct_stone_d", { map: p.stone, color: 0xc2bcb2 }, 0.05, 1.4),
    wash: lmMat("ct_wash", { map: p.wash, color: 0xeee8dc }, 0.03, 0.55),
    vault: lmMat("ct_vault", { map: p.wash, color: 0xf2ece2, side: THREE.DoubleSide }, 0.03, 0.55),
    floor: lmMat("ct_floor", { map: p.floor, color: 0xdcdee2 }, 0.05, 1.2),
    oak: lmMat("ct_oak", { map: p.oak, color: new THREE.Color(2.1, 1.75, 1.4) }, 0.1, 1.1),
    oakDark: lmMat("ct_oak_d", { map: p.oak, color: new THREE.Color(1.35, 1.1, 0.9) }, 0.1, 1.1),
    carved: lmMat("ct_oak_carved", { map: carvedOakTex(), color: 0xf4e4d0 }, 0.1, 0.6),
    marbleW: lmMat("ct_marble_w", { map: marble(false), color: 0xf4f0e8 }, 0.05, 0.25),
    marbleB: lmMat("ct_marble_b", { map: marble(true), color: 0xa4a4a4 }, 0.05, 0.25),
    gilt: lmMat("ct_gilt", { map: gilt, color: 0xf0d090, emissive: 0x3a2808 }, 0, 0.5),
    statue: lmMat("ct_statue", { map: p.stone, color: 0xfffcf4, emissive: 0x121110 }, 0, 0.8),
    rush: lmMat("ct_rush", { map: rushTex(), color: 0xd8c898 }, 0.1, 0.5),
    chairBack: lmMat("ct_chairback", { map: chairBackTex(), color: 0xe8c8a0, alphaTest: 0.5, side: THREE.DoubleSide }, 0, 0.4),
    iron: lmMat("ct_iron", { color: 0x2a2622 }, 0),
    brass: lmMat("ct_brass", { color: 0xb08a40, emissive: 0x241604 }, 0),
    tin: lmMat("ct_tin", { color: 0xb8b8b8, emissive: 0x141414 }, 0),
    wax: lmBasic("ct_wax", { color: 0xf0e8d0 }),
    red: lmMat("ct_red", { color: 0x7a1a14 }, 0),
    blue: lmMat("ct_blue", { color: 0x2a3e78 }, 0),
    black: lmMat("ct_black", { color: 0x141210 }, 0),
    linen: lmMat("ct_linen", { color: 0xece6d4 }, 0),
    // the paintings (Codex, new pictures in the manner of the period)
    elevation: paint("ct_p_elev", "cath_paint_elevation.jpg"),
    elevL: paint("ct_p_elev_l", "cath_paint_elev_l.jpg"),
    elevR: paint("ct_p_elev_r", "cath_paint_elev_r.jpg"),
    descent: paint("ct_p_desc", "cath_paint_descent.jpg"),
    descL: paint("ct_p_desc_l", "cath_paint_desc_l.jpg"),
    descR: paint("ct_p_desc_r", "cath_paint_desc_r.jpg"),
    assumption: paint("ct_p_assum", "cath_paint_assumption.jpg"),
    resurrection: paint("ct_p_res", "cath_paint_resurrection.jpg"),
    resL: paint("ct_p_res_l", "cath_paint_res_l.jpg"),
    resR: paint("ct_p_res_r", "cath_paint_res_r.jpg"),
    supper: paint("ct_p_supper", "cath_paint_supper.jpg"),
    saints: paint("ct_p_saints", "cath_paint_saints.jpg"),
    nativity: paint("ct_p_nativity", "cath_paint_nativity.jpg"),
    christopher: paint("ct_p_christopher", "cath_paint_christopher.jpg"),
    // older pictures of the other churches, on the piers as epitaphs
    epiA: paint("ct_p_epi_a", "pj_paint_rosary_a.jpg"),
    epiB: paint("ct_p_epi_b", "pj_paint_rosary_b.jpg"),
    epiC: paint("ct_p_epi_c", "pj_paint_rosary_c.jpg"),
    dome: (() => {
      const t = picture("/textures/cath_dome.jpg", { clamp: true });
      return lmMat("ct_dome", { map: t, emissiveMap: t, emissive: 0x6a5a48, color: 0xd8d0c0, side: THREE.BackSide }, 0, 0.1);
    })(),
  };
}

// ---------------------------------------------------------------- a frame for furniture

/** A piece's own frame: u across (the viewer's right when facing it), v out toward the viewer, at (x, z) turned by ry. */
class Fr {
  constructor(
    readonly k: Kit,
    readonly x: number,
    readonly z: number,
    readonly ry: number,
  ) {}
  at(u: number, v: number): [number, number] {
    const c = Math.cos(this.ry);
    const s = Math.sin(this.ry);
    return [this.x + u * c + v * s, this.z - u * s + v * c];
  }
  sub(u: number, v: number, dry = 0): Fr {
    const [px, pz] = this.at(u, v);
    return new Fr(this.k, px, pz, this.ry + dry);
  }
  box(w: number, h: number, d: number, u: number, y: number, v: number, def: MatDef, o: PieceOpts = {}): void {
    const [px, pz] = this.at(u, v);
    this.k.box(w, h, d, px, y, pz, def, { tile: 1.2, ...o, ry: this.ry + (o.ry ?? 0) });
  }
  cyl(rt: number, rb: number, h: number, u: number, y: number, v: number, def: MatDef, o: PieceOpts & { seg?: number; open?: boolean } = {}): void {
    const [px, pz] = this.at(u, v);
    this.k.cyl(rt, rb, h, px, y, pz, def, { ...o, ry: this.ry + (o.ry ?? 0) });
  }
  plane(w: number, h: number, u: number, y: number, v: number, def: MatDef, o: PieceOpts = {}): void {
    const [px, pz] = this.at(u, v);
    this.k.plane(w, h, px, y, pz, def, { ...o, ry: this.ry + (o.ry ?? 0) });
  }
  add(g: THREE.BufferGeometry, def: MatDef, u: number, y: number, v: number, o: PieceOpts = {}): void {
    const [px, pz] = this.at(u, v);
    this.k.add(g, def, px, y, pz, { ...o, ry: this.ry + (o.ry ?? 0) });
  }
  /** A carved figure (a saint, an angel with wings) standing at (u, v) on y, facing the frame's front turned by dyaw. */
  fig(def: MatDef, u: number, y: number, v: number, h: number, dyaw = 0, wings = false): void {
    const f = this.sub(u, v, dyaw);
    // the robe falling in folds to the feet, the mantle over the shoulders, the head, the arms crossed or raised
    const robe = new THREE.CylinderGeometry(0.13 * h, 0.21 * h, 0.64 * h, 9, 2);
    const rp = robe.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < rp.count; i++) {
      const a = Math.atan2(rp.getZ(i), rp.getX(i));
      const k = 1 + 0.09 * Math.sin(a * 5) * (0.5 - rp.getY(i) / (0.64 * h));
      rp.setXYZ(i, rp.getX(i) * k, rp.getY(i), rp.getZ(i) * k * 0.85);
    }
    robe.computeVertexNormals();
    f.add(robe, def, 0, y + 0.32 * h, 0);
    f.cyl(0.11 * h, 0.15 * h, 0.2 * h, 0, y + 0.64 * h, 0, def, { seg: 8 });
    f.box(0.34 * h, 0.07 * h, 0.16 * h, 0, y + 0.8 * h, -0.01 * h, def);
    const head = new THREE.IcosahedronGeometry(0.075 * h, 0);
    head.scale(0.9, 1.12, 0.95);
    f.add(head, def, 0, y + 0.92 * h, 0.01 * h);
    f.cyl(0.035 * h, 0.04 * h, 0.06 * h, 0, y + 0.83 * h, 0, def, { seg: 6 });
    for (const s of [-1, 1]) {
      f.box(0.07 * h, 0.3 * h, 0.08 * h, s * 0.15 * h, y + 0.66 * h, 0.03 * h, def, { rx: -0.5, rz: s * 0.12 });
      f.box(0.06 * h, 0.2 * h, 0.07 * h, s * 0.07 * h, y + 0.6 * h, 0.12 * h, def, { rz: s * 1.25 });
      if (wings) f.box(0.04 * h, 0.52 * h, 0.3 * h, s * 0.17 * h, y + 0.72 * h, -0.17 * h, def, { ry: s * 0.45, rx: 0.25 });
    }
  }
}

// ---------------------------------------------------------------- the stone: piers, arches, vaults, windows

/**
 * A Brabant clustered pier: a round core with `lobes` rolls round it (no capitals: the mouldings run on up into the
 * arches), from y0 to y1, its mean radius R.
 */
function lobedShaft(k: Kit, def: MatDef, x: number, z: number, y0: number, y1: number, R: number, lobes: number, amp: number, tint?: number): void {
  const n = lobes * 4;
  const vs = Math.max(1, Math.ceil((y1 - y0) / 6));
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const rOf = (th: number) => R + amp * ((0.5 + 0.5 * Math.cos(lobes * th)) ** 0.6 - 0.5);
  let arc = 0;
  let prev: [number, number] | null = null;
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * Math.PI * 2;
    const r = rOf(th);
    const px = Math.cos(th) * r;
    const pz = Math.sin(th) * r;
    if (prev) arc += Math.hypot(px - prev[0], pz - prev[1]);
    prev = [px, pz];
    for (let j = 0; j <= vs; j++) {
      const y = y0 + ((y1 - y0) * j) / vs;
      pos.push(px, y, pz);
      uv.push(arc / 2.4, y / 2.4);
    }
  }
  for (let i = 0; i < n; i++)
    for (let j = 0; j < vs; j++) {
      const a = i * (vs + 1) + j;
      const b = (i + 1) * (vs + 1) + j;
      idx.push(a, b + 1, b, a, a + 1, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  k.add(g, def, x, 0, z, { tint });
}

/** A pier with its moulded base on an octagonal plinth, a thin ring at the arches' springing. */
function clusterPier(k: Kit, stone: MatDef, dark: MatDef, x: number, z: number, top: number, R: number, lobes = 12): void {
  k.cyl(R + 0.3, R + 0.34, 0.55, x, 0, z, dark, { seg: 8, tile: 1.2, ry: Math.PI / 8 });
  k.cyl(R + 0.14, R + 0.24, 0.32, x, 0.55, z, stone, { seg: 16, tile: 1.2 });
  lobedShaft(k, stone, x, z, 0.87, top, R, lobes, 0.2);
  k.cyl(R + 0.12, R + 0.06, 0.22, x, top - 0.22, z, stone, { seg: 16, tile: 1.2, tint: 0.92 });
}

/** A moulded ring round a pointed opening (the arch's orders), in the x-y plane `depth` thick: placed like k.archWall. */
function archRim(k: Kit, def: MatDef, ow: number, spring: number, apex: number, width: number, depth: number, x: number, z: number, ry: number, tint = 0.94): void {
  const half = ow / 2;
  const rise = apex - spring;
  const outer = pointedProfile(half + width, rise + width * 0.9, 8);
  // (its soffit 6 cm inside the opening's own: never in one face with it)
  const inner = pointedProfile(half - 0.06, rise - 0.06, 8);
  const s = new THREE.Shape();
  s.moveTo(outer[0][0], spring + outer[0][1]);
  for (const [px, py] of outer.slice(1)) s.lineTo(px, spring + py);
  for (let i = inner.length - 1; i >= 0; i--) s.lineTo(inner[i][0], spring + inner[i][1]);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  planarUV(g, 2.4);
  k.add(g, def, x, 0, z, { ry, tint, flat: true });
}

/** A rib's piece: a box open at its top and ends (they are never seen: the vault over it, the next piece at each end). */
function ribGeo(w: number, h: number, len: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, len);
  const idx = g.getIndex()!;
  const keep: number[] = [];
  // faces +x, -x, +y, -y, +z, -z (six indices each): keep the sides and the underside
  for (const f of [0, 1, 3]) for (let i = 0; i < 6; i++) keep.push(idx.getX(f * 6 + i));
  g.setIndex(keep);
  return g;
}

/** The rib vaults already drawn in this build (a rib shared by two bays once). */
const ribEdges = new Set<string>();

/** A rib vault over a rectangle: a groin (the higher of two pointed barrels), its diagonal ribs and the ribs on its edges. */
function groin(k: Kit, def: MatDef, rib: MatDef, x0: number, x1: number, z0: number, z1: number, spring: number, riseX: number, riseZ: number, n = 8): void {
  const hx = (x1 - x0) / 2;
  const hz = (z1 - z0) / 2;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const Y = (x: number, z: number) => spring + Math.max(pointedAt(x - cx, hx, riseX), pointedAt(z - cz, hz, riseZ));
  const pos: number[] = [];
  const at = (i: number, j: number): [number, number, number] => {
    const x = x0 + ((x1 - x0) * i) / n;
    const z = z0 + ((z1 - z0) * j) / n;
    return [x, Y(x, z), z];
  };
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const p00 = at(i, j);
      const p10 = at(i + 1, j);
      const p01 = at(i, j + 1);
      const p11 = at(i + 1, j + 1);
      pos.push(...p00, ...p10, ...p11, ...p00, ...p11, ...p01);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  planarUV(g, 2.6);
  k.add(g, def, 0, 0, 0, { flat: true, tint: 0.97 });
  const seg = (a: [number, number], b: [number, number], steps: number, w: number) => {
    for (let i = 0; i < steps; i++) {
      const pa = [a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps];
      const pb = [a[0] + ((b[0] - a[0]) * (i + 1)) / steps, a[1] + ((b[1] - a[1]) * (i + 1)) / steps];
      const ya = Y(pa[0], pa[1]) - 0.1;
      const yb = Y(pb[0], pb[1]) - 0.1;
      const len = Math.hypot(pb[0] - pa[0], yb - ya, pb[1] - pa[1]);
      const bx = ribGeo(w, 0.2, len + 0.04);
      const dir = new THREE.Vector3(pb[0] - pa[0], yb - ya, pb[1] - pa[1]).normalize();
      bx.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir));
      bx.translate((pa[0] + pb[0]) / 2, (ya + yb) / 2, (pa[1] + pb[1]) / 2);
      k.add(bx, rib, 0, 0, 0, { flat: true, tint: 0.93 });
    }
  };
  for (const [ex, ez] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] as Array<[number, number]>) seg([ex + (cx - ex) * 0.02, ez + (cz - ez) * 0.02], [cx, cz], 4, 0.22);
  for (const [a, b] of [[[x0, z0], [x1, z0]], [[x0, z1], [x1, z1]], [[x0, z0], [x0, z1]], [[x1, z0], [x1, z1]]] as Array<[[number, number], [number, number]]>) {
    const key = `${a[0].toFixed(2)},${a[1].toFixed(2)},${b[0].toFixed(2)},${b[1].toFixed(2)}`;
    if (ribEdges.has(key)) continue;
    ribEdges.add(key);
    seg(a, b, 4, 0.3);
  }
  // the boss at the crown
  const bs = new THREE.CylinderGeometry(0.28, 0.2, 0.25, 8);
  k.add(bs, rib, cx, Y(cx, cz) - 0.2, cz, { flat: true, tint: 0.9 });
}

/**
 * Issue #10: the hall's side of the shell's windows' glass. The shell's old painted pane (world/shellGlass.ts) is the
 * glass seen from the street (facing out, see-through); facing in, the same outlines carry the hall's own glass as its
 * old lancets had it: stained glass (cath_glass.jpg) in most, clear leaded grisaille in two of three clerestory windows,
 * the transept's high lancets, the outer aisles' west windows (the square behind them) and four of the lantern's, so
 * the windows glow inside by day and the sky shows through the clear ones. One-sided each: from either side one pane shows, the other side comes through it a little.
 * At night the hall's lamplight in the leaded panes, seen from the street (a third mesh, facing out, added over the
 * shell's pane in the hall's own pass: the street's glow of world/landmarkWindows.ts lies under the hall's pass there).
 * World coordinates (the room's scene). Returns the stained glass, the clear glass and the night's glow.
 */
function hallGlassFrom(src: THREE.Mesh, stained: THREE.Texture, clear: THREE.Texture): THREE.Mesh[] {
  const g = src.geometry.clone();
  src.updateWorldMatrix(true, false);
  g.applyMatrix4(src.matrixWorld);
  const ng = g.index ? g.toNonIndexed() : g;
  const pos = ng.getAttribute("position") as THREE.BufferAttribute;
  const uv = ng.getAttribute("uv") as THREE.BufferAttribute;
  // the atlas's cells (build_landmarks.py CELL, 512 x 1024; the glTF's v runs down): the great windows' and the lancets'
  const cells: Array<[number, number, number, number]> = [
    [256, 0, 128, 256],
    [384, 0, 64, 128],
  ];
  const wins = SHELL_OPENINGS.filter((o) => o.kind === "window");
  const isClear = (o: ShellOpening) => {
    const bay = +(/bay (\d+)/.exec(o.label)?.[1] ?? 0);
    if (/clerestory/.test(o.label)) return (bay - 1) % 3 !== 1;
    if (/over the aisles, lancet|west gable/.test(o.label)) return true;
    if (/lantern/.test(o.label)) return /lantern, the (north|south|east|west) face/.test(o.label);
    return false;
  };
  const out: Array<{ pos: number[]; uv: number[] }> = [
    { pos: [], uv: [] },
    { pos: [], uv: [] },
    { pos: [], uv: [] },
  ];
  const c = new THREE.Vector3();
  for (let t = 0; t + 2 < pos.count; t += 3) {
    let cu = 0;
    c.set(0, 0, 0);
    for (let j = 0; j < 3; j++) {
      cu += uv.getX(t + j) / 3;
      c.x += pos.getX(t + j) / 3;
      c.z += pos.getZ(t + j) / 3;
    }
    const [cx, cy, cw, ch] = cu < 0.75 ? cells[0] : cells[1];
    let wi = 0;
    let best = Infinity;
    wins.forEach((o, i) => {
      const dd = Math.hypot(o.x - c.x, o.z - c.z);
      if (dd < best) [best, wi] = [dd, i];
    });
    const o = out[isClear(wins[wi]) ? 1 : 0];
    // facing in: the triangle turned round; every other window its picture mirrored (not all the same glass)
    for (const j of [0, 2, 1]) {
      const x = (uv.getX(t + j) * 512 - cx - 0.5) / (cw - 1);
      const y = 1 - (uv.getY(t + j) * 1024 - cy - 0.5) / (ch - 1);
      o.pos.push(pos.getX(t + j), pos.getY(t + j), pos.getZ(t + j));
      o.uv.push(wi % 2 ? 1 - x : x, y);
    }
    // the night's glow: facing out, 1 cm out of the pane
    for (const j of [0, 1, 2]) {
      out[2].pos.push(pos.getX(t + j) + wins[wi].nx * 0.01, pos.getY(t + j), pos.getZ(t + j) + wins[wi].nz * 0.01);
      out[2].uv.push((uv.getX(t + j) * 512 - cx - 0.5) / (cw - 1), 1 - (uv.getY(t + j) * 1024 - cy - 0.5) / (ch - 1));
    }
  }
  g.dispose();
  if (ng !== g) ng.dispose();
  return out.map((q, i) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(q.pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(q.uv, 2));
    geo.computeBoundingSphere();
    const name = ["cathedral_stained_glass", "cathedral_clear_glass", "cathedral_window_glow"][i];
    const mat = new THREE.MeshBasicMaterial({ map: i ? clear : stained, color: i === 2 ? 0x000000 : 0x707070, transparent: true, opacity: [0.8, 0.6, 1][i], depthWrite: false, side: THREE.FrontSide });
    if (i === 2) mat.blending = THREE.AdditiveBlending;
    mat.name = name;
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.userData.glass = true;
    m.renderOrder = i === 2 ? 6 : 5;
    return m;
  });
}

// ---------------------------------------------------------------- the furniture

/** A gilded moulding round a picture w x h whose bottom is at y0, centred at u, standing at v. */
function giltFrame(f: Fr, gilt: MatDef, w: number, h: number, u: number, y0: number, v: number, t = 0.16): void {
  f.box(w + 2 * t, t, 0.12, u, y0 - t / 2, v, gilt);
  f.box(w + 2 * t, t, 0.12, u, y0 + h + t / 2, v, gilt);
  for (const s of [-1, 1]) f.box(t, h, 0.12, u + s * (w / 2 + t / 2), y0 + h / 2, v, gilt);
}

type Mats = ReturnType<typeof makeMats>;

/** Candlesticks on an altar's table: `n` in a row at height y, v; their flames. */
function candles(f: Fr, m: Mats, flames: Flames, n: number, width: number, y: number, v: number, tall = 0.55): void {
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0 : -width / 2 + (width * i) / (n - 1);
    f.cyl(0.05, 0.1, tall, u, y, v, m.brass, { seg: 6 });
    f.cyl(0.03, 0.03, 0.3, u, y + tall, v, m.wax, { seg: 5 });
    const [px, pz] = f.at(u, v);
    flames.addFlame(px, y + tall + 0.36, pz);
  }
}

/** A crucifix standing on an altar. */
function crucifix(f: Fr, m: Mats, u: number, y: number, v: number, h = 0.9): void {
  f.cyl(0.12, 0.16, 0.12, u, y, v, m.gilt, { seg: 6 });
  f.box(0.05, h, 0.05, u, y + 0.12 + h / 2, v, m.gilt);
  f.box(h * 0.5, 0.05, 0.05, u, y + 0.12 + h * 0.72, v, m.gilt);
  f.box(0.07, h * 0.4, 0.06, u, y + 0.12 + h * 0.52, v + 0.04, m.statue);
}

/** An altar's table on a step: marble front, a white top, a linen cloth; `w` wide, its back at v 0. */
function altarTable(f: Fr, m: Mats, w: number, d = 1.0): void {
  f.box(w + 0.8, 0.16, d + 0.9, 0, 0.08, d / 2 + 0.2, m.marbleW, { tile: 1 });
  f.box(w, 0.9, d, 0, 0.16 + 0.45, d / 2, m.marbleB, { tile: 1 });
  for (const s of [-1, 1]) f.box(0.12, 0.9, 0.1, s * (w / 2 - 0.25), 0.61, d + 0.02, m.marbleW);
  f.box(w + 0.1, 0.07, d + 0.08, 0, 1.1, d / 2, m.marbleW, { tile: 1 });
  f.box(w + 0.05, 0.02, d + 0.1, 0, 1.15, d / 2, m.linen);
  f.box(w + 0.06, 0.28, 0.02, 0, 1.02, d + 0.1, m.linen);
}

/**
 * A triptych over its altar against a wall, wings open: the centre panel cw x ch whose foot is at y0, the wings half
 * as wide opened `open` rad toward the room, each in its gilded frame; a black marble surround, an entablature with a
 * gilt crest and two white angels; the altar with six candles and a crucifix.
 */
function triptych(f: Fr, m: Mats, flames: Flames, cw: number, ch: number, y0: number, centre: MatDef, left: MatDef, right: MatDef, open = 0.62, altar = true): void {
  const ww = cw / 2 + 0.05;
  // the black marble surround and its white pilasters
  f.box(cw + 1.2, ch + 1.3, 0.22, 0, y0 + ch / 2 - 0.1, 0.11, m.marbleB, { tile: 1 });
  for (const s of [-1, 1]) {
    f.box(0.32, ch + 1.6, 0.36, s * (cw / 2 + 0.72), y0 + ch / 2 - 0.1, 0.18, m.marbleW, { tile: 1 });
    f.box(0.46, 0.3, 0.46, s * (cw / 2 + 0.72), y0 - 0.9, 0.2, m.marbleW, { tile: 1 });
  }
  f.plane(cw, ch, 0, y0 + ch / 2, 0.235, centre);
  giltFrame(f, m.gilt, cw, ch, 0, y0, 0.27, 0.18);
  // the wings on their hinges
  for (const s of [-1, 1]) {
    const hu = s * (cw / 2 + 0.2);
    const wf = f.sub(hu, 0.34, -s * open);
    const pic = s < 0 ? left : right;
    wf.box(ww + 0.12, ch + 0.2, 0.08, (s * ww) / 2, y0 + ch / 2, -0.03, m.oakDark, { tile: 1 });
    wf.plane(ww - 0.06, ch - 0.06, (s * ww) / 2, y0 + ch / 2, 0.02, pic);
    giltFrame(wf, m.gilt, ww - 0.06, ch - 0.06, (s * ww) / 2, y0 + 0.03, 0.04, 0.1);
  }
  // the entablature, the crest: a gilt cartouche in rays, two angels on the cornice
  f.box(cw + 1.8, 0.5, 0.6, 0, y0 + ch + 0.75, 0.2, m.marbleB, { tile: 1 });
  f.box(cw + 2.0, 0.16, 0.72, 0, y0 + ch + 1.08, 0.22, m.marbleW, { tile: 1 });
  const rays = new THREE.CircleGeometry(0.95, 14);
  f.add(rays, m.gilt, 0, y0 + ch + 2.1, 0.12, { flat: true });
  f.box(0.9, 1.1, 0.2, 0, y0 + ch + 1.75, 0.3, m.marbleW, { tile: 1 });
  f.box(0.62, 0.7, 0.06, 0, y0 + ch + 1.78, 0.42, m.gilt);
  for (const s of [-1, 1]) f.fig(m.statue, s * (cw / 2 + 0.6), y0 + ch + 1.16, 0.25, 1.3, -s * 0.4, true);
  if (!altar) return;
  // the predella under the picture, the altar before it
  f.box(cw + 1.2, y0 - 1.34, 0.4, 0, 1.3 + (y0 - 1.34) / 2, 0.2, m.marbleB, { tile: 1 });
  const af = f.sub(0, 0.2);
  altarTable(af, m, Math.min(3.4, cw + 0.4), 0.8);
  candles(af, m, flames, 6, Math.min(3.0, cw), 1.16, 0.3);
  crucifix(af, m, 0, 1.16, 0.25);
}

/** A side altar against a wall: a marble retable with columns, the painting in gilt, a broken pediment and a crest. */
function retable(f: Fr, m: Mats, flames: Flames, pic: MatDef, pw: number, ph: number, statues = true): void {
  altarTable(f.sub(0, 0.05), m, pw + 0.4, 0.85);
  const y0 = 1.9;
  f.box(pw + 1.9, ph + 1.8, 0.3, 0, y0 + ph / 2, 0.02, m.marbleB, { tile: 1 });
  f.plane(pw, ph, 0, y0 + ph / 2, 0.18, pic);
  giltFrame(f, m.gilt, pw, ph, 0, y0, 0.22, 0.14);
  for (const s of [-1, 1]) {
    f.box(0.5, 0.7, 0.5, s * (pw / 2 + 0.55), 1.55, 0.3, m.marbleW, { tile: 1 });
    f.cyl(0.15, 0.17, ph + 0.4, s * (pw / 2 + 0.55), 1.9, 0.3, m.marbleW, { seg: 10 });
    f.box(0.42, 0.3, 0.42, s * (pw / 2 + 0.55), 1.9 + ph + 0.4, 0.3, m.gilt);
    // the halves of the broken pediment
    f.box(pw / 2 + 0.2, 0.2, 0.5, s * (pw / 4 + 0.55), y0 + ph + 1.05 + 0.25, 0.25, m.marbleW, { rz: s * -0.35 });
    if (statues) {
      f.box(0.5, 0.95, 0.5, s * (pw / 2 + 1.25), 0.475, 0.35, m.marbleW, { tile: 1 });
      f.fig(m.statue, s * (pw / 2 + 1.25), 0.95, 0.35, 1.5, 0, false);
    }
  }
  f.box(pw + 1.6, 0.36, 0.6, 0, y0 + ph + 0.62, 0.26, m.marbleB, { tile: 1 });
  f.box(pw + 1.75, 0.12, 0.68, 0, y0 + ph + 0.86, 0.26, m.marbleW, { tile: 1 });
  f.box(0.5, 0.7, 0.3, 0, y0 + ph + 1.35, 0.28, m.gilt);
  const rays = new THREE.CircleGeometry(0.5, 12);
  f.add(rays, m.gilt, 0, y0 + ph + 1.45, 0.14, { flat: true });
  candles(f.sub(0, 0.05), m, flames, 4, pw * 0.8, 1.16, 0.28, 0.4);
  crucifix(f.sub(0, 0.05), m, 0, 1.16, 0.22, 0.7);
}

/** An iron stand of votive candles: tiers of small flames (`lit` of its places burning). */
function votiveStand(f: Fr, m: Mats, flames: Flames, w: number, lit: number, r: () => number): void {
  f.box(w, 0.04, 0.44, 0, 0.9, 0, m.iron);
  f.box(w - 0.1, 0.04, 0.34, 0, 1.08, 0.1, m.iron);
  f.box(w - 0.2, 0.04, 0.24, 0, 1.26, 0.2, m.iron);
  for (const s of [-1, 1]) f.cyl(0.025, 0.03, 1.26, (s * w) / 2, 0, 0.1, m.iron, { seg: 4 });
  f.box(0.3, 0.4, 0.2, 0, 0.45, 0.1, m.iron);
  let n = 0;
  for (let tier = 0; tier < 3; tier++)
    for (let i = 0; i < 7; i++) {
      if (n++ >= lit || r() < 0.25) continue;
      const u = -w / 2 + 0.12 + (i * (w - 0.24)) / 6;
      const y = 0.92 + tier * 0.18;
      f.cyl(0.018, 0.018, 0.08 + r() * 0.08, u, y, tier * 0.1, m.wax, { seg: 4 });
      const [px, pz] = f.at(u, tier * 0.1);
      flames.addFlame(px, y + 0.2, pz);
    }
}

/** A baroque confessional against a wall (the frame faces the aisle): the priest's booth, two kneeling booths, carved figures. */
function confessional(f: Fr, m: Mats): void {
  f.box(3.0, 0.15, 1.3, 0, 0.075, 0, m.oakDark);
  f.box(1.1, 2.6, 1.25, 0, 1.45, 0, m.oak, { tile: 1.2 });
  f.box(0.8, 1.7, 0.02, 0, 1.2, 0.635, m.black);
  f.box(0.84, 0.9, 0.05, 0, 0.62, 0.64, m.oak);
  for (const s of [-1, 1]) {
    f.box(0.9, 0.12, 1.2, s * 1.0, 2.65, 0, m.oak);
    f.box(0.1, 2.5, 1.2, s * 1.46, 1.35, 0, m.oak, { tile: 1.2 });
    f.box(0.9, 2.5, 0.1, s * 1.0, 1.35, -0.55, m.oak, { tile: 1.2 });
    f.box(0.8, 0.18, 0.5, s * 1.0, 0.3, 0.1, m.oakDark);
    f.box(0.02, 1.9, 0.9, s * 0.56, 1.3, 0.3, m.red);
    // the carved saints and angels at the partitions
    f.fig(m.carved, s * 1.58, 0.15, 0.55, 1.85, 0, s > 0);
    f.fig(m.carved, s * 0.6, 0.15, 0.64, 1.6, 0, true);
  }
  f.box(3.1, 0.3, 1.35, 0, 2.88, 0, m.oak);
  f.cyl(0.55, 0.55, 1.1, 0, 3.02, -0.05, m.oak, { seg: 8, rz: Math.PI / 2 });
  f.fig(m.gilt, 0, 3.55, 0.3, 0.9, 0, true);
  f.fig(m.carved, -1.0, 3.03, 0.1, 0.7, 0, true);
  f.fig(m.carved, 1.0, 3.03, 0.1, 0.7, 0, true);
}

/** A leafy clump of carved oak (the pulpit's trees): a few low-poly balls. */
function leaves(f: Fr, def: MatDef, u: number, y: number, v: number, r: number, rnd: () => number, n = 3): void {
  for (let i = 0; i < n; i++) {
    const g = new THREE.IcosahedronGeometry(r * (0.7 + rnd() * 0.5), 0);
    g.scale(1, 0.7, 1);
    f.add(g, def, u + (rnd() - 0.5) * r * 1.4, y + (rnd() - 0.5) * r * 0.8, v + (rnd() - 0.5) * r * 1.4, { ry: rnd() * 6 });
  }
}

/** A carved bird: body, head, tail, and wings open or folded. */
function bird(f: Fr, def: MatDef, u: number, y: number, v: number, s: number, yaw: number, spread = false): void {
  const b = f.sub(u, v, yaw);
  b.box(0.12 * s, 0.12 * s, 0.3 * s, 0, y, 0, def);
  b.box(0.09 * s, 0.1 * s, 0.1 * s, 0, y + 0.1 * s, 0.17 * s, def);
  b.box(0.05 * s, 0.03 * s, 0.08 * s, 0, y + 0.09 * s, 0.25 * s, def);
  b.box(0.1 * s, 0.03 * s, 0.22 * s, 0, y + 0.02 * s, -0.24 * s, def, { rx: 0.4 });
  for (const w of [-1, 1]) b.box(spread ? 0.34 * s : 0.04 * s, 0.03 * s, 0.2 * s, w * (spread ? 0.22 : 0.08) * s, y + 0.05 * s, 0, def, { rz: spread ? w * 0.35 : 0 });
}

/**
 * Van der Voort's pulpit (1713): at its foot the four continents with their beasts round two oak trunks, branches
 * spreading under the tub, birds in the leaves (an eagle, a peacock, a parrot, small birds), the carved tub, the stair
 * climbing to it along the pier with a railing of branches, the back board and the sounding board of foliage with
 * angels blowing trumpets and the dove under it. The frame faces the nave (v), the pier behind it (-v).
 */
function pulpit(f: Fr, m: Mats, rnd: () => number): void {
  const O = m.carved;
  const OD = m.oakDark;
  const T = m.oak;
  // the ground: a rocky mound of oak
  f.cyl(0.78, 0.92, 0.3, 0, 0, 0.1, OD, { seg: 9 });
  // the trunk, and four boughs curving out to carry the tub
  f.cyl(0.2, 0.3, 2.0, 0, 0.3, 0.05, OD, { seg: 8 });
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const du = Math.cos(a);
    const dv = Math.sin(a);
    f.cyl(0.07, 0.11, 0.9, du * 0.32, 1.65, dv * 0.32 + 0.05, OD, { seg: 6, rz: -du * 0.75, rx: dv * 0.75 });
    leaves(f, O, du * 0.66, 2.3, dv * 0.66 + 0.05, 0.2, rnd, 2);
  }
  // the four continents seated round the trunk, each with her beast: Europe's horse, Asia's camel, Africa's lion, America's crocodile
  const cont: Array<[number, number]> = [
    [-0.6, 0.62],
    [0.6, 0.62],
    [-0.66, -0.2],
    [0.66, -0.2],
  ];
  cont.forEach(([u, v], i) => {
    const yaw = Math.atan2(u, v);
    f.fig(O, u, 0.3, v, 1.3, yaw, false);
    f.box(0.36, 0.32, 0.3, u * 0.96, 0.46, v * 0.96 - 0.04, OD, { ry: yaw }); // her seat, a rock
    const bu = u * 1.28;
    const bv = v * 1.2 + 0.25;
    if (i === 0) {
      f.box(0.16, 0.26, 0.46, bu, 0.43, bv, O, { ry: 0.5 });
      f.box(0.1, 0.28, 0.12, bu - 0.08, 0.68, bv + 0.18, O, { ry: 0.5, rx: -0.4 });
    } else if (i === 1) {
      f.box(0.18, 0.24, 0.46, bu, 0.43, bv, O, { ry: -0.5 });
      f.box(0.14, 0.12, 0.16, bu, 0.61, bv, O, { ry: -0.5 });
      f.box(0.07, 0.3, 0.07, bu + 0.1, 0.66, bv + 0.18, O, { ry: -0.5, rx: -0.5 });
    } else if (i === 2) {
      f.box(0.2, 0.2, 0.42, bu, 0.4, bv - 0.1, O, { ry: 1.2 });
      f.box(0.2, 0.2, 0.16, bu - 0.2, 0.5, bv, O, { ry: 1.2 });
    } else {
      f.box(0.12, 0.07, 0.66, bu, 0.34, bv - 0.1, O, { ry: -1.1 });
    }
  });
  // the tub: eight carved panels with figures, a gilt rim, the book rest; the eagle with spread wings under its front
  f.cyl(0.98, 0.66, 1.2, 0, 2.3, 0, T, { seg: 8, tile: 1.2 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    if (Math.sin(a) < -0.4) continue;
    const pf = f.sub(Math.cos(a) * 0.86, Math.sin(a) * 0.86, Math.PI / 2 - a);
    pf.box(0.46, 0.66, 0.06, 0, 2.95, 0.02, OD, { rx: -0.24 });
    pf.fig(O, 0, 2.66, 0.07, 0.58, 0, false);
  }
  f.cyl(1.04, 1.04, 0.14, 0, 3.5, 0, OD, { seg: 8 });
  f.cyl(1.05, 1.05, 0.05, 0, 3.64, 0, m.gilt, { seg: 8 });
  f.box(0.62, 0.06, 0.42, 0, 3.78, 0.78, O, { rx: 0.35 });
  bird(f, O, 0, 2.05, 0.82, 1.5, 0, true);
  bird(f, O, -0.72, 2.0, 0.55, 1.0, -0.9, false);
  // the back board up the pier and the sounding board: its gilt rim, the dove under it, a crown of foliage with
  // angels blowing trumpets, and the risen Christ on top
  f.box(0.9, 2.5, 0.12, 0, 4.85, -0.52, T, { tile: 1.2 });
  f.box(1.05, 0.2, 0.2, 0, 3.7, -0.5, m.gilt);
  f.cyl(1.35, 1.2, 0.26, 0, 6.0, 0, T, { seg: 10 });
  f.cyl(1.4, 1.4, 0.1, 0, 6.26, 0, m.gilt, { seg: 10 });
  const dove = new THREE.CircleGeometry(0.4, 12);
  f.add(dove, m.gilt, 0, 5.98, 0, { rx: Math.PI / 2, flat: true });
  f.box(0.18, 0.05, 0.28, 0, 5.95, 0, m.statue);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    leaves(f, O, Math.cos(a) * 1.05, 6.45, Math.sin(a) * 1.05, 0.24, rnd, 1);
  }
  f.cyl(0.12, 0.4, 1.2, 0, 6.36, 0, OD, { seg: 8 });
  leaves(f, O, 0, 7.55, 0, 0.3, rnd, 2);
  for (const s of [-1, 1]) {
    f.fig(m.statue, s * 0.72, 6.36, 0.35, 1.1, s * -0.5, true);
    f.cyl(0.02, 0.07, 0.6, s * 0.98, 7.1, 0.6, m.gilt, { seg: 5, rx: -0.9 });
  }
  f.fig(m.gilt, 0, 7.8, 0.05, 1.0, 0, false);
  // the stair along the pier (toward +u): steps, a stringer, a panelled balustrade on the nave's side carved with leaves
  for (let i = 0; i < 10; i++) f.box(0.26, 0.1, 0.72, 2.2 - i * 0.14, 0.18 + i * 0.235, -0.2, T);
  f.box(2.7, 0.22, 0.08, 1.58, 1.15, 0.17, OD, { rz: -1.07 });
  f.box(2.62, 0.72, 0.06, 1.62, 1.62, 0.2, T, { rz: -1.07, tile: 1.2 });
  f.box(2.62, 0.09, 0.1, 1.44, 2.02, 0.2, OD, { rz: -1.07 });
  f.cyl(0.07, 0.07, 1.1, 2.25, 0, 0.2, OD, { seg: 6 });
  f.cyl(0.1, 0.02, 0.22, 2.25, 1.1, 0.2, m.gilt, { seg: 6 });
}

/** The west gallery's organ: an oak case of five towers and flats of tin pipes, carved and gilded, angels on the towers. */
function organ(f: Fr, m: Mats, y: number, width: number): void {
  f.box(width, 1.6, 1.6, 0, y + 0.8, 0, m.oakDark, { tile: 1.2 });
  f.box(width + 0.3, 0.16, 1.8, 0, y + 1.6, 0.05, m.gilt);
  const towers: Array<[number, number, number]> = [
    [-width * 0.42, width * 0.13, 5.4],
    [-width * 0.22, width * 0.15, 7.2],
    [0, width * 0.2, 9.0],
    [width * 0.22, width * 0.15, 7.2],
    [width * 0.42, width * 0.13, 5.4],
  ];
  towers.forEach(([u, w, h], ti) => {
    const yb = y + 1.76;
    f.box(w + 0.18, 0.3, 1.3, u, yb, 0.05, m.oak);
    f.box(w + 0.3, 0.5, 1.4, u, yb + h + 0.25, 0.05, m.oak, { tile: 1 });
    f.box(w + 0.4, 0.14, 1.5, u, yb + h + 0.55, 0.05, m.gilt);
    for (const s of [-1, 1]) f.box(0.14, h, 1.2, u + s * (w / 2 + 0.07), yb + h / 2, 0.05, m.oak, { tile: 1.2 });
    const n = Math.max(3, Math.round(w / 0.19));
    for (let i = 0; i < n; i++) {
      const pu = u - w / 2 + 0.09 + (i * (w - 0.18)) / Math.max(1, n - 1);
      const ph = h * (0.72 + 0.26 * Math.sin((i / Math.max(1, n - 1)) * Math.PI));
      f.cyl(0.08, 0.08, ph - 0.2, pu, yb + 0.35, 0.45, m.tin, { seg: 6 });
      f.cyl(0.02, 0.08, 0.2, pu, yb + 0.15, 0.45, m.tin, { seg: 6 });
    }
    // carved crests: a gilt vase, an angel with a trumpet on the tall ones
    f.cyl(0.18, 0.1, 0.4, u, yb + h + 0.62, 0.05, m.gilt, { seg: 6 });
    if (ti % 2 === 0) f.fig(m.statue, u, yb + h + 0.95, 0.2, ti === 2 ? 1.6 : 1.2, 0, true);
    // the flats between the towers
    if (ti < towers.length - 1) {
      const [u2, w2, h2] = towers[ti + 1];
      const a = u + w / 2 + 0.14;
      const b = u2 - w2 / 2 - 0.14;
      const fh = Math.min(h, h2) * 0.62;
      f.box(b - a, 0.3, 1.1, (a + b) / 2, yb + fh + 0.2, 0.0, m.oak, { tile: 1 });
      f.box(b - a, 0.5, 0.2, (a + b) / 2, yb + fh + 0.62, 0.4, m.gilt);
      const nf = Math.max(2, Math.round((b - a) / 0.17));
      for (let i = 0; i < nf; i++) {
        const pu = a + 0.08 + (i * (b - a - 0.16)) / Math.max(1, nf - 1);
        f.cyl(0.06, 0.06, fh - 0.2 - Math.abs(i - nf / 2) * 0.1, pu, yb + 0.25, 0.35, m.tin, { seg: 5 });
      }
    }
  });
  // the back case behind the pipes, dark
  f.box(width - 0.4, 10.5, 0.3, 0, y + 1.6 + 5.25, -0.6, m.oakDark, { tile: 1.4 });
}

/**
 * The neo-Gothic choir stalls (carving begun in 1840): a raised back row under a canopy of gables and pinnacles
 * with pointed panels in the back, a front row with its desk, between z0 and z1 on the side s (the screen's line).
 */
function stallRun(k: Kit, m: Mats, s: number, z0: number, z1: number): void {
  const O = m.oak;
  const OD = m.oakDark;
  const xb = s * (P.NAVE - 0.28); // the back panel, before the screen
  const len = z1 - z0;
  const zc = (z0 + z1) / 2;
  const f = new Fr(k, 0, 0, 0);
  // the platform, the back row's seats and arms, the back panel, the canopy
  f.box(1.45, 0.22, len, s * (P.NAVE - 1.0), 0.11 + 0.36, zc, OD, { tile: 1.2 });
  f.box(0.5, 0.45, len, s * (P.NAVE - 0.72), 0.58 + 0.23, zc, OD, { tile: 1.2 });
  f.box(0.14, 4.4, len, xb, 0.58 + 2.2, zc, O, { tile: 1.2 });
  f.box(0.62, 0.14, len, s * (P.NAVE - 0.55), 0.58 + 3.7, zc, O, { tile: 1.2 });
  f.box(0.66, 0.26, len + 0.1, s * (P.NAVE - 0.55), 0.58 + 3.9, zc, OD, { tile: 1.2 });
  // the front row's desk and seat
  f.box(0.1, 1.0, len, s * (P.NAVE - 1.72), 0.36 + 0.5, zc, O, { tile: 1.2 });
  f.box(0.34, 0.06, len, s * (P.NAVE - 1.6), 0.36 + 1.0, zc, O, { tile: 1.2, rz: s * 0.2 });
  const bay = 0.66;
  const nb = Math.floor(len / bay);
  const zA = zc - (nb * bay) / 2;
  for (let i = 0; i <= nb; i++) {
    const z = zA + i * bay;
    // the arms between the seats, the pinnacles over the canopy
    f.box(0.5, 0.5, 0.06, s * (P.NAVE - 0.72), 0.58 + 0.72, z, O);
    f.box(0.08, 0.08, 0.08, s * (P.NAVE - 0.5), 0.58 + 0.95, z, O);
    f.cyl(0.04, 0.05, 3.3, xb - s * 0.08, 0.58 + 0.45, z, O, { seg: 4 });
    f.cyl(0.0, 0.07, 0.7, s * (P.NAVE - 0.55), 0.58 + 4.03, z, O, { seg: 4 });
    if (i === nb) break;
    // the pointed panel in the back and the crocketed gable over each seat
    const zm = z + bay / 2;
    const arch = new THREE.Shape();
    const h = 0.29;
    arch.moveTo(-h, 0);
    arch.lineTo(-h, 1.6);
    for (const [px, py] of pointedProfile(h, 0.45, 4)) arch.lineTo(px, 1.6 + py);
    arch.lineTo(h, 0);
    arch.lineTo(h - 0.05, 0);
    arch.lineTo(h - 0.05, 1.6);
    for (const [px, py] of pointedProfile(h - 0.05, 0.4, 4).reverse()) arch.lineTo(px, 1.6 + py);
    arch.lineTo(-h + 0.05, 0);
    arch.lineTo(-h, 0);
    const ag = new THREE.ExtrudeGeometry(arch, { depth: 0.05, bevelEnabled: false, curveSegments: 1 });
    ag.computeVertexNormals();
    planarUV(ag, 1.2);
    k.add(ag, OD, xb - s * 0.06, 0.58 + 1.5, zm, { ry: -s * (Math.PI / 2), tint: 0.9 });
    const gab = new THREE.Shape();
    gab.moveTo(-0.3, 0);
    gab.lineTo(0.3, 0);
    gab.lineTo(0, 0.55);
    gab.lineTo(-0.3, 0);
    const gg = new THREE.ExtrudeGeometry(gab, { depth: 0.05, bevelEnabled: false, curveSegments: 1 });
    gg.computeVertexNormals();
    planarUV(gg, 1.2);
    k.add(gg, O, s * (P.NAVE - 0.86), 0.58 + 4.03, zm, { ry: -s * (Math.PI / 2) });
    f.cyl(0.0, 0.05, 0.22, s * (P.NAVE - 0.86), 0.58 + 4.56, zm, O, { seg: 4 });
  }
}

/** A brass chandelier of two tiers on its chain. */
function chandelier(f: Fr, m: Mats, flames: Flames, u: number, y: number, v: number, top: number): void {
  f.cyl(0.02, 0.02, top - y, u, y, v, m.iron, { seg: 3 });
  f.cyl(0.12, 0.22, 0.7, u, y - 0.6, v, m.brass, { seg: 8 });
  const sph = new THREE.SphereGeometry(0.22, 8, 5);
  f.add(sph, m.brass, u, y - 0.85, v);
  for (const [r, yy, n] of [[1.05, y - 0.5, 12], [0.6, y + 0.1, 8]] as Array<[number, number, number]>) {
    f.cyl(r, r, 0.05, u, yy, v, m.brass, { seg: 12, open: true });
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const cu = u + Math.cos(a) * r;
      const cv = v + Math.sin(a) * r;
      f.cyl(0.02, 0.02, 0.2, cu, yy + 0.05, cv, m.wax, { seg: 4 });
      const [px, pz] = f.at(cu, cv);
      flames.addFlame(px, yy + 0.3, pz);
    }
  }
}

// ---------------------------------------------------------------- the cathedral

/**
 * Onze-Lieve-Vrouwekathedraal as it stood in 1873, standing in the world inside its Blender shell (the plan is
 * shared/cathedralPlan.ts; the frame is the shell's, the floor 0.3 m over the square).
 */
export function buildCathedral(opts: { origin: { x: number; z: number }; yaw: number }): LandmarkRoom {
  const m = (mats ??= makeMats());
  const { scene, group, toWorld } = frameRoom(opts.origin, opts.yaw, 0x2a2620);
  scene.background = null;
  group.position.y = P.FLOOR_Y;
  group.updateMatrixWorld(true);
  const fog = scene.fog as THREE.Fog;
  fog.near = 22;
  fog.far = 120;
  const k = new Kit(group);
  k.shadeTop = 20;
  ribEdges.clear();
  const rnd = rand(1873);
  const { NAVE, A2, A3, OUT, W0, WO, TR, CROSS0, CROSS1, CHOIR_E, AC, H, SPRING, AH, ASPRING, BAYS, CHOIR_BAYS, RAILZ, AZ, NORTH } = P;
  const XMID = (CROSS0 + CROSS1) / 2;
  const D = P.SHELL.door;
  const DH = D.top - P.FLOOR_Y;
  const F0 = new Fr(k, 0, 0, 0);
  const ST = m.stone;
  const WL = m.wash;
  const flames = new Flames(group, 420, 0.13);
  // the high altar's candles burn at mass only; the chandeliers at dusk
  const altarLit = new Flames(group, 8, 0.2);
  const chand = new Flames(group, 90, 0.18);
  // (issue #10: the windows' glass, when the shell is in (below): world/shellGlass.ts; see hallGlassFrom)
  const glasses: { out: THREE.MeshBasicMaterial | null; in: THREE.MeshBasicMaterial[]; glow: THREE.MeshBasicMaterial | null } = { out: null, in: [], glow: null };
  const { VAULT, WEST_BAY: WB, TE, PORTAL_ZONE: PZ } = P;
  const HS = VAULT.spring;
  const HV = VAULT.crown;
  const FY = P.FLOOR_Y;

  // ================= floors: bluestone and grave slabs; the choir white and black marble
  const floor = (x0: number, x1: number, z0: number, z1: number) => k.box(x1 - x0, 0.1, z1 - z0, (x0 + x1) / 2, -0.05, (z0 + z1) / 2, m.floor, { tile: 3.2, flat: true });
  floor(-(A3 - 0.4), A3 - 0.4, W0, WO);
  floor(-OUT, OUT, WO, CROSS0);
  floor(-TE, TE, CROSS0, CROSS1);
  floor(-A3, A3, CROSS1, CHOIR_E + 0.6);
  floor(-P.AMB_IN, P.AMB_IN, CHOIR_E + 0.6, AC);
  floor(-D.hw - 0.7, D.hw + 0.7, D.z + 0.05, W0);
  {
    const r = P.AMB_OUT / Math.cos(Math.PI / 20);
    const g = new THREE.CircleGeometry(r, 10, Math.PI, Math.PI);
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 3.2, pos.getY(i) / 3.2);
    k.add(g, m.floor, 0, 0, AC, { rx: -Math.PI / 2, flat: true });
  }
  k.box(NAVE * 2, 0.36, AC - CROSS1 - 0.3, 0, 0.18, (CROSS1 + 0.3 + AC) / 2, m.marbleW, { tile: 1.0, flat: true });
  {
    // black marble lozenges in the choir's white floor
    for (let z = CROSS1 + 1.4; z < AZ - 2.6; z += 1.6)
      for (let x = -4.8; x <= 4.8; x += 1.6) {
        const g = new THREE.PlaneGeometry(0.62, 0.62);
        k.add(g, m.marbleB, x, 0.375, z, { rx: -Math.PI / 2, rz: Math.PI / 4, flat: true });
      }
    const g = new THREE.CylinderGeometry(P.APSE_IN / Math.cos(Math.PI / 10), P.APSE_IN / Math.cos(Math.PI / 10), 0.36, 5, 1, false, -Math.PI / 2, Math.PI);
    k.add(g, m.marbleW, 0, 0.18, AC, { flat: true });
  }
  k.box(NAVE * 2, 0.18, 0.3, 0, 0.09, CROSS1 + 0.3, m.marbleW, { tile: 1.2, flat: true });

  // ================= walls (each at least 0.2 m inside the shell's faces: shared/cathedralPlan.ts)
  const wall = (w: number, h: number, d: number, x: number, z: number, def: MatDef = WL, y0 = 0) => k.box(w, h, d, x, y0 + h / 2, z, def, { tile: 2.6 });
  /** A box from x0..x1, y0..y1, z0..z1 (the hall's frame). */
  const slab = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, def: MatDef = WL) => k.box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, def, { tile: 2.6 });
  // (issue #10, interiors are real: every face of the shell over the hall with windows in it is lined from its reveals'
  // back to the hall's inner face, cut exactly where the shell's windows are: world/realOpenings.ts lining. `face`: the
  // shell's outer face (a to c along its windows' way, n out of it); y in the hall's frame)
  const face = (a: [number, number], c: [number, number], n: [number, number]): ShellFace => ({ a, c, n });
  const line = (f: ShellFace, from: number, to: number, u0: number, u1: number, y0: number, y1: number) =>
    lining(k, WL, { face: f, from, to, u0, u1, y0: y0 + FY, y1: y1 + FY }, WINDOWS, FY, 2.6);
  // the west front: the wall over the doorway up to the great west window, lined from there to the tall west bay's vault
  const S = P.SHELL;
  k.archWall(NAVE * 2, WB.wall + 0.1, 0.8, D.hw * 2, DH, DH + 3.4, 0, 0, W0 - 0.4, WL, { tile: 2.6 });
  line(face([-S.westBay.half, S.portal.face], [S.westBay.half, S.portal.face], [0, -1]), 0.3, WB.z0 - S.portal.face, 0.25, 2 * S.westBay.half - 0.25, WB.wall, WB.top);
  // (the ledge over the portal, from the west window's wall to the wall over the doorway)
  slab(-(S.westBay.half - 0.05), S.westBay.half - 0.05, WB.wall, WB.wall + 0.1, WB.z0, W0 - 0.8, ST);
  archRim(k, ST, D.hw * 2, DH, DH + 3.4, 0.35, 0.95, 0, W0 - 0.4, 0);
  for (const s of [-1, 1]) wall(A3 - 0.4 - NAVE, AH, 0.8, (s * (NAVE + A3 - 0.4)) / 2, W0 - 0.4);
  for (const s of [-1, 1]) k.box(0.65, DH, W0 - 0.8 - D.z - 0.03, s * (D.hw + 0.325), DH / 2, (D.z + 0.03 + W0 - 0.8) / 2, m.stoneDark, { tile: 1.2 });
  k.box(D.hw * 2 + 1.3, 3.6, 0.4, 0, DH + 1.8, D.z + 0.25, m.stoneDark, { tile: 1.2 });
  k.box(D.hw * 2 + 1.24, 0.35, W0 - 0.8 - D.z, 0, DH + 0.17, (D.z + W0 - 0.8) / 2 + 0.03, m.stoneDark, { tile: 1.2 });
  for (const s of [-1, 1]) {
    wall(0.4, AH, WO - 0.8 - W0, s * (A3 - 0.2), (W0 + WO - 0.8) / 2);
    wall(0.7, AH, P.TOWER_E - WO + 0.8, s * (A3 - 0.05), (WO - 0.8 + P.TOWER_E) / 2);
    // the outer aisle: its west gable's wall and its long wall, lined (their windows real)
    const [ga, gc] = s > 0 ? [S.towerSide, S.aisleWall] : [-S.aisleWall, -S.towerSide];
    line(face([ga, S.outerGable], [gc, S.outerGable], [0, -1]), 0.3, WO - S.outerGable, s > 0 ? 0.1 : 0.25, S.aisleWall - S.towerSide - (s > 0 ? 0.25 : 0.1), -0.12, AH);
    line(face([s * S.aisleWall, S.outerGable], [s * S.aisleWall, S.transept[0]], [s, 0]), 0.3, S.aisleWall - OUT, 0.3, S.transept[0] - S.outerGable - 0.25, -0.12, AH);
    slab(s > 0 ? OUT : -OUT - 0.5, s > 0 ? OUT + 0.5 : -OUT, 0, AH, S.transept[0] - 0.27, CROSS0 - 0.6);
    {
      // the outer aisle's west bay beside the tower, under its gable's window, parted from the aisle by a transverse arch
      // (P.OUTER_ARCH) up to the vault's rib
      const A = P.OUTER_ARCH;
      const xa = A3 + 0.35;
      const hx = (OUT - xa) / 2;
      const cx = s * (xa + hx);
      const sh = new THREE.Shape();
      sh.moveTo(-hx, 0);
      sh.lineTo(-A.hw, 0);
      sh.lineTo(-A.hw, A.spring);
      for (const [px, py] of pointedProfile(A.hw, A.apex - A.spring, 6).slice(1, -1)) sh.lineTo(px, A.spring + py);
      sh.lineTo(A.hw, A.spring);
      sh.lineTo(A.hw, 0);
      sh.lineTo(hx, 0);
      for (let i = 0; i <= 12; i++) {
        const x = hx - (2 * hx * i) / 12;
        sh.lineTo(x, ASPRING + pointedAt(x, hx, AH - ASPRING) - 0.05);
      }
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.6, bevelEnabled: false, curveSegments: 1 });
      g.computeVertexNormals();
      planarUV(g, 2.4);
      k.add(g, ST, cx, 0, BAYS[0] - 0.3, { flat: true, tint: 0.94 });
      archRim(k, ST, A.hw * 2, A.spring, A.apex, 0.22, 0.72, cx, BAYS[0], 0);
    }
    // the transept's west and east walls: over the aisles' roofs lined with their high lancets, beyond the aisles lined
    // from the floor with the great windows (the shell's faces at T0 and T1); below the aisles' roofs the walls between
    // the outer aisle and the arm (the Lady altar's, the Sacrament's) and the choir's side
    const TA = S.aisleEaves - FY; // the aisles' roofs meet the transept's walls
    const [ta, tc] = s > 0 ? [S.halfNave, S.transeptEnd] : [-S.transeptEnd, -S.halfNave];
    const mid = S.aisleWall + 0.25;
    for (const [zf, n, zw] of [[S.transept[0], -1, CROSS0 - 0.3], [S.transept[1], 1, CROSS1 + 0.3]] as Array<[number, number, number]>) {
      const f = face([ta, zf], [tc, zf], [0, n]);
      const to = Math.abs(zf - (n < 0 ? CROSS0 : CROSS1));
      const uMid = s > 0 ? mid - ta : -mid - ta;
      if (s > 0) {
        line(f, 0.3, to, 0.25, uMid, TA, 30);
        line(f, 0.3, to, uMid, tc - ta - 0.25, -0.12, 30);
      } else {
        line(f, 0.3, to, uMid, tc - ta - 0.25, TA, 30);
        line(f, 0.3, to, 0.25, uMid, -0.12, 30);
      }
      wall(mid - A3, TA, 0.6, (s * (A3 + mid)) / 2, zw);
      // (the corner by the crossing, between the crossing's arch and the lining)
      slab(s > 0 ? S.halfNave - 0.2 : -S.halfNave - 0.3, s > 0 ? S.halfNave + 0.3 : -S.halfNave + 0.2, TA, 30, n < 0 ? zf + 0.25 : CROSS1 - 0.05, n < 0 ? CROSS0 + 0.05 : zf - 0.25);
    }
    // the transept's end: the portal's vestibule (TR) with a ledge over it, beside it the corners out to TE, over it the
    // front's great window; the front lined (its face at the transept's end, the portal's mouth left to the shell)
    {
      const x0 = s > 0 ? TR : -TE;
      const x1 = s > 0 ? TE : -TR;
      slab(s > 0 ? TR : -TR - 0.35, s > 0 ? TR + 0.35 : -TR, 0, PZ.top, PZ.z0, PZ.z1);
      slab(x0, x1, 0, PZ.top, PZ.z0, PZ.z0 + 0.3);
      slab(x0, x1, 0, PZ.top, PZ.z1 - 0.3, PZ.z1);
      slab(x0, x1, PZ.top - 0.1, PZ.top, PZ.z0, PZ.z1, ST);
      const f = face([s * S.transeptEnd, S.transept[0]], [s * S.transeptEnd, S.transept[1]], [s, 0]);
      const L = S.transept[1] - S.transept[0];
      const to = S.transeptEnd - TE;
      line(f, 0.3, to, 0.25, PZ.z0 + 0.15 - S.transept[0], -0.12, PZ.top);
      line(f, 0.3, to, PZ.z1 - 0.15 - S.transept[0], L - 0.25, -0.12, PZ.top);
      line(f, 0.3, to, 0.25, L - 0.25, PZ.top, 30);
    }
    for (const z of [CROSS0 - 0.3, CROSS1 + 0.3]) {
      k.archWall(A2 - NAVE, TA, 0.6, A2 - NAVE - 1.6, 6.5, 9.2, (s * (NAVE + A2)) / 2, 0, z, ST, { tile: 2.4 });
      k.archWall(A3 - A2, TA, 0.6, A3 - A2 - 1.6, 6.5, 9.2, (s * (A2 + A3)) / 2, 0, z, ST, { tile: 2.4 });
      archRim(k, ST, A2 - NAVE - 1.6, 6.5, 9.2, 0.25, 0.72, (s * (NAVE + A2)) / 2, z, 0);
      archRim(k, ST, A3 - A2 - 1.6, 6.5, 9.2, 0.25, 0.72, (s * (A2 + A3)) / 2, z, 0);
    }
    wall(0.6, AH, CHOIR_E + 0.6 - CROSS1 - 0.6, s * (A3 + 0.3), (CROSS1 + 0.6 + CHOIR_E + 0.6) / 2);
    wall(A3 - A2, AH, 0.6, (s * (A2 + A3)) / 2, CHOIR_E + 0.3);
    // the clerestory walls over the arcades (issue #10: lined, the shell's clerestory windows real), the tall west bay's
    // walls up under its roof; the walls between the aisles up to the aisles' vaults
    const NX = (x0: number, x1: number): [number, number] => (s > 0 ? [x0, x1] : [-x1, -x0]);
    const CB = S.choirBays;
    line(face([s * S.halfNave, P.BAYS[0]], [s * S.halfNave, S.transept[0]], [s, 0]), 0.3, S.halfNave - (NAVE - 0.45), 0.25, S.transept[0] - P.BAYS[0] - 0.25, AH, 30);
    line(face([s * S.halfNave, CB[0]], [s * S.halfNave, CB[3]], [s, 0]), 0.3, S.halfNave - (NAVE - 0.45), 0.25, CB[3] - CB[0] - 0.25, AH, 30);
    slab(...NX(NAVE - 0.45, S.westBay.half - 0.05), AH, WB.top, W0, P.BAYS[0]);
    slab(...NX(NAVE - 0.45, S.westBay.half - 0.05), WB.wall, WB.top, WB.z0, W0);
    slab(...NX(NAVE - 0.45, NAVE + 0.45), AH, 30, P.BAYS[0] - 0.02, P.BAYS[0] + 0.27);
    slab(...NX(NAVE - 0.45, NAVE + 0.45), AH, HV + 0.1, S.transept[0] - 0.27, CROSS0 - 0.45);
    slab(...NX(NAVE - 0.45, NAVE + 0.45), AH, 30, CROSS1 + 0.45, CB[0] + 0.27);
    slab(...NX(NAVE - 0.5, NAVE + 0.35), AH, 30, CB[3] - 0.2, AC + 0.1);
    k.box(0.7, AH - ASPRING, CROSS0 - 0.3 - W0, s * A2, ASPRING + (AH - ASPRING) / 2, (W0 + CROSS0 - 0.3) / 2, WL, { tile: 2.6 });
    k.box(0.7, AH - ASPRING, CROSS0 - 0.3 - P.TOWER_E, s * A3, ASPRING + (AH - ASPRING) / 2, (P.TOWER_E + CROSS0 - 0.3) / 2, WL, { tile: 2.6 });
    k.box(0.7, AH - ASPRING, CHOIR_E - CROSS1 - 0.3, s * A2, ASPRING + (AH - ASPRING) / 2, (CROSS1 + 0.3 + CHOIR_E) / 2, WL, { tile: 2.6 });
    // string courses: under the clerestory, at the vaults' springing; the triforium's openwork parapet
    for (const [z0, z1] of [[W0, CROSS0 - 1.3], [CROSS1 + 1.3, AC]] as Array<[number, number]>) {
      const xf = s * (NAVE - 0.5);
      k.box(0.24, 0.22, z1 - z0, xf, AH + 0.11, (z0 + z1) / 2, ST, { tile: 2.4, tint: 0.9 });
      k.box(0.2, 0.18, z1 - z0, xf, SPRING - 0.1, (z0 + z1) / 2, ST, { tile: 2.4, tint: 0.9 });
      k.box(0.14, 0.12, z1 - z0, xf - s * 0.02, AH + 1.15, (z0 + z1) / 2, ST, { tile: 2.4 });
      for (let z = z0 + 0.35; z < z1 - 0.2; z += 0.8) {
        const pb = new THREE.Shape();
        pb.moveTo(-0.2, 0);
        pb.lineTo(0.2, 0);
        pb.lineTo(0.2, 0.62);
        for (const [px, py] of pointedProfile(0.2, 0.28, 3)) pb.lineTo(-px, 0.62 + py);
        pb.lineTo(-0.2, 0);
        // (a blind arch of the triforium: a panel with a pointed head)
        const g = new THREE.ShapeGeometry(pb, 1);
        planarUV(g, 2.4);
        k.add(g, ST, xf - s * 0.13, AH + 0.24, z + 0.27, { ry: -s * (Math.PI / 2), tint: 0.78, flat: true });
      }
    }
  }
  // the apse: five faces up to the vault; the ambulatory's ten
  const facetWidth = (a: number, sides: number) => 2 * a * Math.tan(Math.PI / (2 * sides)) + 0.12;
  // (issue #10: the apse's walls over the ambulatory's roof lined, the shell's high windows real; the half dome over them)
  const APSE_Y = 20.5;
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (Math.PI / 5) * (i + 0.5);
    const r = (P.APSE_IN + P.APSE_OUT) / 2;
    k.box(facetWidth(r, 5), APSE_Y + 0.1, P.APSE_OUT - P.APSE_IN, Math.sin(a) * r, (APSE_Y + 0.1) / 2, AC + Math.cos(a) * r, WL, { tile: 2.6, ry: a });
    const corner = (j: number): [number, number] => {
      const t = -Math.PI / 2 + (Math.PI / 5) * j;
      return [Math.sin(t) * S.apseR, AC + Math.cos(t) * S.apseR];
    };
    const ln = 2 * S.apseR * Math.sin(Math.PI / 10);
    line(face(corner(i), corner(i + 1), [Math.sin(a), Math.cos(a)]), 0.3, S.apseR * Math.cos(Math.PI / 10) - P.APSE_IN, 0.02, ln - 0.02, APSE_Y, 30);
  }
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (Math.PI / 10) * (i + 0.5);
    const r = (P.AMB_IN + P.AMB_OUT) / 2;
    k.box(facetWidth(r, 10), AH, P.AMB_OUT - P.AMB_IN, Math.sin(a) * r, AH / 2, AC + Math.cos(a) * r, WL, { tile: 2.6, ry: a });
  }

  // ================= the piers and arcades
  const arcade = (x: number, z0: number, z1: number, h: number, t: number, spring: number, apex: number, pw = 1.8) => {
    k.archWall(z1 - z0, h, t, z1 - z0 - pw, spring, apex, x, 0, (z0 + z1) / 2, ST, { ry: Math.PI / 2, tile: 2.4 });
    archRim(k, ST, z1 - z0 - pw, spring, apex, 0.26, t + 0.16, x, (z0 + z1) / 2, Math.PI / 2);
  };
  const between = (list: number[]) => list.slice(0, -1).map((a, i) => [a, list[i + 1]] as const);
  for (const s of [-1, 1]) {
    for (const z of BAYS) {
      clusterPier(k, ST, m.stoneDark, s * NAVE, z, 8, 0.74, 14);
      clusterPier(k, ST, m.stoneDark, s * A2, z, 8, 0.52, 10);
      if (z > P.TOWER_E) clusterPier(k, ST, m.stoneDark, s * A3, z, 8, 0.52, 10);
      // the vaulting shafts up the nave wall to the springing (three rolls)
      for (const dz of [-0.28, 0, 0.28]) k.cyl(0.13, 0.13, HS - 8, s * (NAVE - 0.5), 8, z + dz, ST, { seg: 6, tile: 2.4 });
    }
    for (const z of CHOIR_BAYS) {
      clusterPier(k, ST, m.stoneDark, s * NAVE, z, 8, 0.74, 14);
      clusterPier(k, ST, m.stoneDark, s * A2, z, 8, 0.52, 10);
      for (const dz of [-0.28, 0, 0.28]) k.cyl(0.13, 0.13, HS - 8, s * (NAVE - 0.5), 8, z + dz, ST, { seg: 6, tile: 2.4 });
    }
    clusterPier(k, ST, m.stoneDark, s * NAVE, CROSS0, 13, 1.12, 20);
    clusterPier(k, ST, m.stoneDark, s * NAVE, CROSS1, 13, 1.12, 20);
    for (const z of [CROSS0, CROSS1]) k.cyl(0.18, 0.18, HS - 13, s * (NAVE - 0.7), 13, z, ST, { seg: 6 });
    for (const [a, b] of between([W0, ...BAYS, CROSS0 - 1.1])) arcade(s * NAVE, a, b, AH, 0.8, 8, 12.2);
    for (const [a, b] of between([W0, ...BAYS, CROSS0 - 0.6])) arcade(s * A2, a, b, ASPRING, 0.6, 8, 11.8, 1.25);
    for (const [a, b] of between([P.TOWER_E, ...BAYS.filter((z) => z > P.TOWER_E), CROSS0 - 0.6])) arcade(s * A3, a, b, ASPRING, 0.6, 8, 11.8, 1.25);
    for (const [a, b] of between([CROSS1 + 1.1, ...CHOIR_BAYS, AC])) arcade(s * NAVE, a, b, AH, 0.8, 8, 11.4);
    for (const [a, b] of between([CROSS1 + 0.6, ...CHOIR_BAYS, CHOIR_E])) arcade(s * A2, a, b, ASPRING, 0.6, 8, 11.8, 1.25);
    k.archWall(CROSS1 - CROSS0, HV + 0.1, 0.9, CROSS1 - CROSS0 - 2.2, 13, 21.5, s * NAVE, 0, XMID, ST, { ry: Math.PI / 2, tile: 2.4 });
    archRim(k, ST, CROSS1 - CROSS0 - 2.2, 13, 21.5, 0.45, 1.06, s * NAVE, XMID, Math.PI / 2);
  }
  for (const z of [CROSS0, CROSS1]) {
    k.archWall(NAVE * 2, HV + 0.1, 0.9, NAVE * 2 - 2.2, 13, 21.5, 0, 0, z, ST, { tile: 2.4 });
    archRim(k, ST, NAVE * 2 - 2.2, 13, 21.5, 0.45, 1.06, 0, z, 0);
  }

  // ================= the vaults: rib vaults bay by bay
  // (issue #10: the high vaults spring at HS and rise to HV over the shell's clerestory windows; the west bay's under the
  // west front's roof, over the great west window, a wall between it and the nave's first bay over the nave's vault)
  const NH = NAVE - 0.45;
  const naveZ = [BAYS[0], ...BAYS.slice(1), CROSS0 - 0.45];
  for (const [a, b] of between(naveZ)) groin(k, m.vault, ST, -NH, NH, a, b, HS, HV - HS, HV - HS);
  const choirZ = [CROSS1 + 0.45, ...CHOIR_BAYS, AC];
  for (const [a, b] of between(choirZ)) groin(k, m.vault, ST, -NH, NH, a, b, HS, HV - HS, HV - HS);
  groin(k, m.vault, ST, -NH, NH, WB.z0, WB.z1, WB.spring, WB.riseX, WB.riseZ);
  /** A wall across the nave from the vault's end at `z` (its pointed profile) up to `top`, `t` thick toward `dir`. */
  const overVault = (z: number, top: number, t: number, dir: 1 | -1) => {
    const sh = new THREE.Shape();
    sh.moveTo(-NH, HS);
    sh.lineTo(-NH, top);
    sh.lineTo(NH, top);
    sh.lineTo(NH, HS);
    for (let i = 1; i < 16; i++) {
      const x = NH - (2 * NH * i) / 16;
      sh.lineTo(x, HS + pointedAt(x, NH, HV - HS));
    }
    sh.lineTo(-NH, HS);
    const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false, curveSegments: 1 });
    g.computeVertexNormals();
    planarUV(g, 2.6);
    k.add(g, WL, 0, 0, dir > 0 ? z : z - t, { flat: true });
  };
  overVault(BAYS[0], WB.top, BAYS[0] - WB.z1, -1);
  overVault(AC, 30.8, 0.3, 1);
  const aisleZ = [W0, ...BAYS, CROSS0 - 0.6];
  const outerZ = [WO, ...BAYS, CROSS0 - 0.6];
  for (const s of [-1, 1]) {
    const cells: Array<[number, number, number[]]> = [
      [NAVE + 0.4, A2 - 0.35, aisleZ],
      [A2 + 0.35, A3 - 0.35, aisleZ],
      [A3 + 0.35, OUT, outerZ],
      [NAVE + 0.4, A2 - 0.35, [CROSS1 + 0.6, ...CHOIR_BAYS, AC]],
      [A2 + 0.35, A3, [CROSS1 + 0.6, ...CHOIR_BAYS, CHOIR_E]],
    ];
    for (const [xa, xb, zs] of cells) for (const [a, b] of between(zs)) groin(k, m.vault, ST, s > 0 ? xa : -xb, s > 0 ? xb : -xa, a, b, ASPRING, AH - ASPRING, AH - ASPRING, 6);
    // the transept's arms: four bays each (issue #10: each window of the shell's west and east walls in a bay of its own,
    // under the bay's lunette: the two lancets over the aisles, the great window at the arm's end)
    const xs = [NAVE + 0.45, 15.75, 22.45, 26.7, TE];
    for (const [a, b] of between(xs)) groin(k, m.vault, ST, s > 0 ? a : -b, s > 0 ? b : -a, CROSS0, CROSS1, HS, HV - HS, HV - HS);
  }
  {
    // the apse's half dome on five ribs (issue #10: over the shell's high windows, low)
    const RA = NAVE + 0.1;
    const AD = 29.2;
    const prof: Array<[number, number]> = Array.from({ length: 7 }, (_, j) => {
      const r = RA * (1 - j / 6);
      return [-r, pointedAt(r, RA, 1.4)];
    });
    const g = new THREE.LatheGeometry(prof.map(([px, py]) => new THREE.Vector2(-px, AD + py)), 5, -Math.PI / 2, Math.PI);
    planarUV(g, 2.6);
    k.add(g, m.vault, 0, 0, AC, { flat: true });
    for (let i = 0; i <= 5; i++) {
      const a = -Math.PI / 2 + (Math.PI * i) / 5;
      for (let j = 0; j + 1 < prof.length; j++) {
        const [r0, y0] = [-prof[j][0] * 0.97, AD + prof[j][1] - 0.1];
        const [r1, y1] = [-prof[j + 1][0] * 0.97, AD + prof[j + 1][1] - 0.1];
        const P0 = new THREE.Vector3(Math.sin(a) * r0, y0, AC + Math.cos(a) * r0);
        const P1 = new THREE.Vector3(Math.sin(a) * r1, y1, AC + Math.cos(a) * r1);
        const bx = ribGeo(0.22, 0.2, P0.distanceTo(P1) + 0.04);
        bx.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), P1.clone().sub(P0).normalize()));
        bx.translate((P0.x + P1.x) / 2, (P0.y + P1.y) / 2, (P0.z + P1.z) / 2);
        k.add(bx, ST, 0, 0, 0, { flat: true, tint: 0.93 });
      }
    }
    // the ambulatory's ceiling, flat at the aisles' height, with its ribs
    const rg = new THREE.RingGeometry(P.APSE_IN, P.AMB_OUT / Math.cos(Math.PI / 20), 10, 1, Math.PI, Math.PI);
    const pos = rg.getAttribute("position") as THREE.BufferAttribute;
    const uv = rg.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 2.6, pos.getY(i) / 2.6);
    k.add(rg, m.vault, 0, AH, AC, { rx: -Math.PI / 2, flat: true });
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 + (Math.PI * i) / 10;
      const r = (P.APSE_OUT + P.AMB_IN) / 2;
      k.box(0.24, 0.22, P.AMB_IN - P.APSE_OUT, Math.sin(a) * r, AH - 0.11, AC + Math.cos(a) * r, ST, { ry: a, flat: true, tint: 0.93 });
    }
  }

  // ================= the crossing: open to the lantern, the painted Assumption in its dome
  {
    const LA = 5.2; // the lantern's inner apothem (its outer face inside the shell's crossing tower)
    // (issue #10: the lantern's windows are the shell's, real, high in the crossing tower: the drum's walls rise to them,
    // lined round them; the painted dome over them, flat, under the tower's lead floor)
    const LN = S.lantern;
    const LW = LN.y0 - FY - 0.3; // the drum's walls up to the lining
    const LT = LN.y1 - FY - 0.1; // the dome's springing, over the windows' heads
    const cr = LA / Math.cos(Math.PI / 8);
    for (let i = 0; i < 8; i++) {
      const corner = (j: number): [number, number] => {
        const t = Math.PI / 8 + (j * Math.PI) / 4;
        return [Math.sin(t) * LN.r, LN.u + Math.cos(t) * LN.r];
      };
      const n = ((i + 1) * Math.PI) / 4;
      const ln = 2 * LN.r * Math.sin(Math.PI / 8);
      line(face(corner(i), corner(i + 1), [Math.sin(n), Math.cos(n)]), 0.2, LN.r * Math.cos(Math.PI / 8) - LA, 0.02, ln - 0.02, LW, LT + 0.45);
    }
    const plate = new THREE.Shape();
    plate.moveTo(-NAVE, CROSS0 - XMID);
    plate.lineTo(NAVE, CROSS0 - XMID);
    plate.lineTo(NAVE, CROSS1 - XMID);
    plate.lineTo(-NAVE, CROSS1 - XMID);
    plate.lineTo(-NAVE, CROSS0 - XMID);
    const hole = new THREE.Path();
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      if (i === 0) hole.moveTo(Math.cos(a) * cr, Math.sin(a) * cr);
      else hole.lineTo(Math.cos(a) * cr, Math.sin(a) * cr);
    }
    plate.holes.push(hole);
    const pg = new THREE.ShapeGeometry(plate, 1);
    pg.rotateX(Math.PI / 2);
    planarUV(pg, 2.6);
    k.add(pg, m.vault, 0, H - 0.2, XMID, { flat: true, tint: 0.9 });
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const r = LA + 0.15;
      const w = 2 * LA * Math.tan(Math.PI / 8) + 0.14;
      const px = Math.sin(a) * r;
      const pz = XMID + Math.cos(a) * r;
      k.box(w, LW + 0.1 - (H - 0.1), 0.3, px, (H - 0.1 + LW + 0.1) / 2, pz, WL, { ry: a, tile: 2.6 });
      // string courses: over the blind arcades, under the windows' sills
      k.box(w, 0.3, 0.3, Math.sin(a) * (LA - 0.1), H + 1.6, XMID + Math.cos(a) * (LA - 0.1), ST, { ry: a, tint: 0.9 });
      k.box(w, 0.3, 0.34, Math.sin(a) * (LA - 0.12), LW + 0.2, XMID + Math.cos(a) * (LA - 0.12), ST, { ry: a, tint: 0.9 });
      // blind arcades of the drum's lower storey
      for (const d of [-0.9, 0, 0.9]) {
        const ag = new THREE.Shape();
        ag.moveTo(-0.34, 0);
        ag.lineTo(0.34, 0);
        ag.lineTo(0.34, 2.6);
        for (const [qx, qy] of pointedProfile(0.34, 0.5, 3)) ag.lineTo(-qx, 2.6 + qy);
        ag.lineTo(-0.34, 0);
        const g = new THREE.ShapeGeometry(ag, 1);
        planarUV(g, 2.4);
        k.add(g, m.stoneDark, Math.sin(a) * (LA - 0.02) + Math.cos(a) * d, H + 2.2, XMID + Math.cos(a) * (LA - 0.02) - Math.sin(a) * d, { ry: a + Math.PI, flat: true });
      }
    }
    // the dome: a saucer painted from below (the picture laid flat over it, seen as a circle), low under the tower's floor
    const RD = cr * 0.99;
    const dg = new THREE.SphereGeometry(RD, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    dg.scale(1, 0.1, 1);
    const dpos = dg.getAttribute("position") as THREE.BufferAttribute;
    const duv = dg.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < dpos.count; i++) duv.setXY(i, 0.5 + dpos.getX(i) / (2 * RD), 0.5 - dpos.getZ(i) / (2 * RD));
    k.add(dg, m.dome, 0, LT, XMID, { flat: true });
    // a gilt band round its foot, on the walls over the windows' heads
    k.cyl((LA - 0.03) / Math.cos(Math.PI / 8), (LA - 0.03) / Math.cos(Math.PI / 8), 0.2, 0, LT, XMID, m.gilt, { seg: 8, open: true, ry: Math.PI / 8 });
  }

  // ================= windows (issue #10: the shell's, real: their glass the shell's old panes, above; no painted ones)
  // (the windows the sun and the moon come through: world/hallSun.ts)
  // (world/hallSun.ts takes the ones facing the sun; not the lantern's, whose light the crossing's ceiling and the high
  // vaults stop; no shaft from the transept's, whose light would run on through the arm's west wall into the aisles)
  const sunWins: SunWindow[] = WINDOWS.filter((o) => o.kind === "window" && o.yb < 40).map((o, i) => {
    const jamb = (o.poly ?? []).filter(([u]) => Math.abs(u) > o.hw - 0.02).reduce((t, [, y]) => Math.max(t, y), o.yb);
    return { x: o.x - o.nx * o.depth, z: o.z - o.nz * o.depth, nx: -o.nx, nz: -o.nz, hw: o.hw, y0: o.yb - FY, y1: o.yt - FY, spring: jamb - FY, lights: o.hw > 2.2 ? 6 : 2, colour: i % 3 !== 2, shaft: !/transept/.test(o.label) };
  });

  // ================= the doors that stay shut: the side portals in the towers' bases, the transept portals
  const door = (w: number, h: number, x: number, z: number, ry: number) => {
    k.box(w, h, 0.1, x, h / 2, z, m.oakDark, { ry, tile: 1 });
    k.box(w + 0.5, 0.3, 0.14, x, h + 0.15, z, m.stoneDark, { ry, tile: 1 });
    for (const y of [h * 0.2, h * 0.55, h * 0.85]) k.box(w * 0.92, 0.08, 0.13, x, y, z, m.iron, { ry, flat: true });
  };
  for (const s of [-1, 1]) {
    door(P.SHELL.sidePortals.hw * 2, P.SHELL.sidePortals.top - P.FLOOR_Y, s * P.SHELL.sidePortals.v, W0 + 0.06, 0);
    door(P.SHELL.transeptPortals.hw * 2, P.SHELL.transeptPortals.top - P.FLOOR_Y, s * (TR - 0.06), P.SHELL.transeptPortals.u, Math.PI / 2);
  }

  // ================= the west gallery over the door and the organ
  const OZ = P.ORGAN.z0;
  k.box(NAVE * 2 - 0.2, 0.5, 4.6, 0, P.ORGAN.y, OZ + 2.3, m.stoneDark, { tile: 1.6 });
  {
    // the gallery's front: an oak balustrade with gilt panels, carried on two clustered columns and three arches
    const gf = new Fr(k, 0, OZ + 4.55, 0);
    gf.box(NAVE * 2 - 0.2, 0.2, 0.3, 0, P.ORGAN.y + 0.3, 0, m.oak);
    gf.box(NAVE * 2 - 0.2, 0.16, 0.34, 0, P.ORGAN.y + 1.35, 0, m.oak);
    for (let u = -5.6; u <= 5.61; u += 0.35) gf.cyl(0.05, 0.06, 0.95, u, P.ORGAN.y + 0.4, 0, m.oakDark, { seg: 5 });
    for (const u of [-4.2, -1.4, 1.4, 4.2]) gf.box(1.8, 0.5, 0.05, u, P.ORGAN.y - 0.1, 0.12, m.gilt);
    for (const x of [-4.4, 4.4]) clusterPier(k, ST, m.stoneDark, x, OZ + 4.2, P.ORGAN.y - 0.25, 0.3, 8);
    gf.box(NAVE * 2 - 0.3, 0.5, 0.5, 0, P.ORGAN.y - 0.5, -0.3, ST, { tint: 0.92 });
    gf.box(NAVE * 2 - 0.3, 0.14, 0.62, 0, P.ORGAN.y - 0.2, -0.3, ST, { tint: 0.85 });
    organ(new Fr(k, 0, OZ + 1.3, 0), m, P.ORGAN.y + 0.25, 9.4);
  }

  // ================= the high altar (1822-24): steps, the table and tabernacle, candles; the marble portico with the Assumption
  const RZ = P.RETABLE_Z;
  for (let i = 0; i < 3; i++) k.box(7 - i * 1.2, 0.18, 4.6 - i * 1.1, 0, 0.36 + 0.09 + i * 0.18, AZ - 0.2 + i * 0.55, m.marbleW, { tile: 1, flat: true });
  {
    const af = new Fr(k, 0, AZ + 1.15, Math.PI); // its front toward the nave (-z)
    af.box(3.4, 1.0, 1.1, 0, 0.9 + 0.5, 0.55, m.marbleB, { tile: 0.8 });
    for (const u of [-1.2, 0, 1.2]) af.box(0.7, 0.6, 0.04, u, 1.4, 1.11, m.marbleW);
    af.box(3.6, 0.07, 1.2, 0, 1.93, 0.55, m.marbleW);
    af.box(3.62, 0.02, 1.22, 0, 1.97, 0.55, m.linen);
    // the tabernacle: a gilt temple with a little dome
    af.box(1.0, 0.9, 0.7, 0, 2.43, 0.3, m.gilt);
    af.cyl(0.42, 0.42, 0.25, 0, 2.88, 0.3, m.gilt, { seg: 8 });
    af.cyl(0.05, 0.42, 0.4, 0, 3.13, 0.3, m.gilt, { seg: 8 });
    crucifix(af, m, 0, 3.53, 0.3, 0.9);
    candles(af, m, altarLit, 6, 3.0, 1.98, 0.2, 0.9);
  }
  {
    // the portico before the apse's east face: pedestals, paired black columns, the painting in gilt, the entablature,
    // the attic with the glory, statues
    const pf = new Fr(k, 0, RZ + 0.3, Math.PI);
    const pw = 3.5;
    const ph = 5.3;
    const y0 = 2.9;
    pf.box(8.6, 1.2, 1.2, 0, 1.56, 0.1, m.marbleB, { tile: 1 });
    pf.box(pw + 1.2, ph + 1.4, 0.3, 0, y0 + ph / 2, 0.0, m.marbleB, { tile: 1 });
    pf.plane(pw, ph, 0, y0 + ph / 2, 0.17, m.assumption);
    giltFrame(pf, m.gilt, pw, ph, 0, y0, 0.24, 0.22);
    for (const s of [-1, 1])
      for (const d of [0, 0.95]) {
        const u = s * (pw / 2 + 0.7 + d);
        pf.box(0.8, 1.6, 0.8, u, 2.16 + 0.8, 0.4, m.marbleW, { tile: 1 });
        pf.cyl(0.3, 0.34, ph + 0.6, u, 2.96, 0.4, m.marbleB, { seg: 10 });
        pf.cyl(0.42, 0.3, 0.55, u, 2.96 + ph + 0.6, 0.4, m.gilt, { seg: 8 });
        pf.box(0.9, 0.2, 0.9, u, 2.96 + ph + 1.25, 0.4, m.marbleW);
      }
    const ye = 2.96 + ph + 1.35;
    pf.box(pw + 5.6, 0.7, 1.2, 0, ye + 0.35, 0.35, m.marbleB, { tile: 1 });
    pf.box(pw + 5.9, 0.22, 1.36, 0, ye + 0.81, 0.35, m.marbleW, { tile: 1 });
    pf.box(pw + 5.8, 0.12, 0.05, 0, ye + 0.1, 0.96, m.gilt);
    // the attic: a white panel with the glory of rays, God the Father's statue, angels on the cornice
    pf.box(pw + 0.8, 2.4, 0.6, 0, ye + 2.1, 0.2, m.marbleW, { tile: 1 });
    const rays = new THREE.CircleGeometry(1.25, 18);
    pf.add(rays, m.gilt, 0, ye + 2.2, 0.52, { flat: true });
    pf.fig(m.statue, 0, ye + 0.92, 0.55, 2.0, 0, false);
    for (const s of [-1, 1]) {
      pf.fig(m.statue, s * (pw / 2 + 1.6), ye + 0.92, 0.45, 1.7, -s * 0.3, true);
      pf.box(0.5, 0.9, 0.5, s * (pw / 2 + 2.9), ye + 1.37, 0.35, m.gilt);
      pf.cyl(0.0, 0.2, 0.6, s * (pw / 2 + 2.9), ye + 1.82, 0.35, m.gilt, { seg: 6 });
      // statues of saints beside the portico
      pf.box(0.9, 1.4, 0.9, s * (pw / 2 + 3.4), 1.06, 0.6, m.marbleW, { tile: 1 });
      pf.fig(m.statue, s * (pw / 2 + 3.4), 1.76, 0.6, 2.0, -s * 0.2, false);
    }
    pf.box(0.3, 1.2, 0.3, 0, ye + 3.9, 0.2, m.gilt);
    pf.box(0.9, 0.22, 0.3, 0, ye + 4.2, 0.2, m.gilt);
  }
  // the communion rail across the choir's mouth: white balusters, a black top with a brass gate
  {
    const rf = new Fr(k, 0, RAILZ, 0);
    rf.box(NAVE * 2 - 0.2, 0.12, 0.34, 0, 0.06, 0, m.marbleB, { tile: 0.8 });
    rf.box(NAVE * 2 - 0.2, 0.12, 0.42, 0, 0.98, 0, m.marbleB, { tile: 0.8 });
    for (let x = -5.7; x <= 5.7; x += 0.26) {
      if (Math.abs(x) < 0.55) continue;
      rf.cyl(0.05, 0.08, 0.86, x, 0.12, 0, m.marbleW, { seg: 6 });
    }
    for (const u of [-0.5, 0.5]) rf.box(0.06, 0.86, 0.06, u, 0.55, 0, m.brass);
    rf.box(0.9, 0.05, 0.03, 0, 0.8, 0, m.brass);
    // the oak screens along the choir under the stalls
    for (const s of [-1, 1]) {
      const runs: Array<[number, number]> = s * NORTH > 0 ? [[CROSS1 + 0.6, P.GATE.z0], [P.GATE.z1, AC]] : [[CROSS1 + 0.6, AC]];
      for (const [z0, z1] of runs) k.box(0.3, 1.5, z1 - z0, s * NAVE, 0.75, (z0 + z1) / 2, m.oakDark, { tile: 1.2 });
    }
  }
  // the neo-Gothic choir stalls
  for (const s of [-1, 1]) {
    const runs: Array<[number, number]> = s * NORTH > 0 ? [[P.STALLS.z0, P.GATE.z0 - 0.3], [P.GATE.z1 + 0.3, P.STALLS.z1]] : [[P.STALLS.z0, P.STALLS.z1]];
    for (const [z0, z1] of runs) stallRun(k, m, s, z0, z1);
  }
  // the bishop's throne on the south side by the altar steps, the lectern
  {
    const tf = new Fr(k, -NAVE + 1.3, 102.4, Math.PI / 2);
    tf.box(1.1, 0.3, 1.0, 0, 0.51, 0, m.oakDark);
    tf.box(0.8, 0.5, 0.6, 0, 0.91, 0.05, m.red);
    tf.box(1.0, 3.4, 0.12, 0, 2.06, -0.45, m.oak);
    tf.box(1.2, 0.14, 1.0, 0, 3.8, -0.05, m.oak);
    for (const s of [-1, 1]) tf.cyl(0.0, 0.06, 0.8, s * 0.5, 3.87, -0.05, m.oak, { seg: 4 });
    const lf = new Fr(k, 0, CROSS1 + 6, Math.PI);
    lf.cyl(0.26, 0.32, 0.12, 0, 0.36, 0, m.brass, { seg: 8 });
    lf.cyl(0.05, 0.07, 1.0, 0, 0.48, 0, m.brass, { seg: 6 });
    lf.box(0.6, 0.04, 0.42, 0, 1.52, 0.02, m.brass, { rx: 0.45 });
    lf.box(0.5, 0.05, 0.36, 0, 1.56, 0.03, m.red, { rx: 0.45 });
  }
  // the sanctuary lamp, red, hanging before the altar
  const redGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff4020, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9 }));
  redGlow.scale.set(0.6, 0.6, 1);
  redGlow.position.set(0, 5, AZ - 4);
  group.add(redGlow);
  k.cyl(0.015, 0.015, HV - 0.2 - 5.2, 0, 5.2, AZ - 4, m.iron, { seg: 3 });
  k.cyl(0.2, 0.08, 0.34, 0, 4.85, AZ - 4, m.brass, { seg: 8 });

  // ================= Rubens's triptychs on the transept arms' east walls: the Elevation (north), the Descent (south)
  for (const s of [NORTH, -NORTH]) {
    const f = new Fr(k, s * P.TRIPTYCH_X, CROSS1, Math.PI);
    const el = s === NORTH;
    triptych(f, m, flames, 3.6, 5.2, 2.6, el ? m.elevation : m.descent, el ? m.elevL : m.descL, el ? m.elevR : m.descR, 0.62);
  }
  for (const t of P.TRI_STANDS) votiveStand(new Fr(k, t.x, t.z, Math.PI), m, flames, 0.8, 16, rnd);
  // the Resurrection triptych on the ambulatory's wall, its small altar
  {
    const R = P.RESURRECTION;
    const f = new Fr(k, R.x + Math.sin(R.a) * 0.55, R.z + Math.cos(R.a) * 0.55, R.a + Math.PI);
    triptych(f, m, flames, 1.9, 2.7, 2.3, m.resurrection, m.resL, m.resR, 0.7);
  }

  // ================= the pulpit (Van der Voort, 1713), against the pier on the south side of the nave
  pulpit(new Fr(k, P.PULPIT.x + 0.3, P.PULPIT.z, Math.PI / 2), m, rnd);

  // ================= confessionals along the aisle walls; side altars between them; epitaphs on the piers
  for (const c of P.CONFESSIONALS) confessional(new Fr(k, c.x + Math.sign(c.x) * 0.1, c.z, (-Math.sign(c.x) * Math.PI) / 2), m);
  const sidePics = [m.nativity, m.christopher, m.saints, m.nativity, m.christopher];
  P.SIDE_ALTARS.forEach((a, i) => retable(new Fr(k, Math.sign(a.x) * (OUT - 0.01), a.z, (-Math.sign(a.x) * Math.PI) / 2), m, flames, sidePics[i % sidePics.length], 1.7, 2.5, true));
  for (const s of [-1, 1]) {
    // on the west bay's wall of each outer aisle: an epitaph painting in a black and white frame
    const f = new Fr(k, s * (OUT - 0.02), (WO + BAYS[0]) / 2, (-s * Math.PI) / 2);
    f.box(2.1, 2.9, 0.1, 0, 3.6, 0.05, m.marbleB);
    f.plane(1.6, 2.3, 0, 3.6, 0.11, s > 0 ? m.epiA : m.epiC);
    giltFrame(f, m.gilt, 1.6, 2.3, 0, 2.45, 0.13, 0.1);
    f.box(2.3, 0.3, 0.3, 0, 5.2, 0.12, m.marbleW);
    f.fig(m.statue, 0, 5.35, 0.12, 0.8, 0, true);
  }
  [BAYS[1], BAYS[3], BAYS[5]].forEach((z, i) => {
    // epitaphs on the middle arcade's piers, facing the inner aisles
    for (const s of [-1, 1]) {
      const f = new Fr(k, s * (A2 - 0.72), z, (-s * Math.PI) / 2);
      f.box(1.3, 1.8, 0.08, 0, 4.2, 0, m.black);
      f.plane(1.05, 1.5, 0, 4.2, 0.05, [m.epiA, m.epiB, m.epiC][(i + (s > 0 ? 1 : 0)) % 3]);
      giltFrame(f, m.gilt, 1.05, 1.5, 0, 3.45, 0.06, 0.08);
    }
  });

  // ================= the Lady altar (north outer aisle's east end) with its statue and the stand; the Sacrament altar (south)
  const LX = P.LADY.x;
  const LZ = P.LADY.z;
  {
    const f = new Fr(k, LX, LZ + 0.5, Math.PI);
    altarTable(f.sub(0, 0.0), m, 2.8, 0.9);
    f.box(3.5, 6.2, 0.3, 0, 3.1, -0.02, m.marbleB, { tile: 1 });
    f.box(1.8, 3.2, 0.2, 0, 3.4, 0.14, m.blue);
    // the niche's gilt rays and the Virgin crowned, in a blue mantle, the Child on her arm
    const rays = new THREE.CircleGeometry(1.1, 16);
    f.add(rays, m.gilt, 0, 3.3, 0.27, { flat: true });
    f.box(0.9, 0.5, 0.6, 0, 1.45, 0.45, m.gilt);
    // (dressed as the Antwerp Madonnas were: a stiff blue mantle, a white veil, a gilt crown, the Child on her arm)
    f.fig(m.blue, 0, 1.7, 0.5, 1.75, 0, false);
    f.cyl(0.13, 0.17, 0.26, 0, 3.12, 0.5, m.linen, { seg: 8 });
    f.cyl(0.16, 0.12, 0.2, 0, 3.4, 0.51, m.gilt, { seg: 8 });
    f.fig(m.statue, 0.22, 2.55, 0.66, 0.5, 0, false);
    f.cyl(0.07, 0.05, 0.08, 0.22, 3.05, 0.67, m.gilt, { seg: 6 });
    for (const s of [-1, 1]) {
      f.cyl(0.14, 0.16, 4.2, s * 1.35, 1.2, 0.2, m.marbleW, { seg: 10 });
      f.box(0.4, 0.3, 0.4, s * 1.35, 5.45, 0.2, m.gilt);
    }
    f.box(3.6, 0.5, 0.6, 0, 5.85, 0.2, m.marbleW);
    f.fig(m.statue, 0, 6.1, 0.2, 1.1, 0, true);
    candles(f, m, flames, 6, 2.4, 1.16, 0.3, 0.45);
  }
  const STAND: Mark = { x: P.STAND.x, z: P.STAND.z, yaw: 0 };
  {
    const sf = new Fr(k, LX, STAND.z, Math.PI);
    sf.box(1.8, 0.05, 0.5, 0, 0.95, 0, m.iron);
    sf.box(1.6, 0.05, 0.4, 0, 1.2, -0.1, m.iron);
    sf.box(1.4, 0.05, 0.3, 0, 1.45, -0.2, m.iron);
    for (const u of [-0.8, 0.8]) sf.cyl(0.03, 0.03, 1.45, u, 0, 0, m.iron, { seg: 3 });
    sf.box(0.4, 0.5, 0.3, 0, 0.45, 0, m.iron);
  }
  retable(new Fr(k, P.SACRAMENT.x, P.SACRAMENT.z + 0.5, Math.PI), m, flames, m.supper, 2.4, 1.6, true);
  // the font by the west door: black marble, a white bowl, an oak cover with a gilt finial
  k.cyl(0.24, 0.34, 0.85, P.FONT.x, 0, P.FONT.z, m.marbleB, { seg: 8 });
  k.cyl(0.56, 0.32, 0.34, P.FONT.x, 0.85, P.FONT.z, m.marbleW, { seg: 10 });
  k.cyl(0.08, 0.46, 0.9, P.FONT.x, 1.19, P.FONT.z, m.oak, { seg: 8 });
  k.cyl(0.0, 0.08, 0.3, P.FONT.x, 2.09, P.FONT.z, m.gilt, { seg: 6 });

  // ================= the chairs in the nave: rush seats, ladder backs, rows either side of the middle walk
  const chairs = P.SETS.chairs.map((c) => ({ ...c }));
  const seats: Seat[] = [];
  for (let r = 0; r < P.ROWS; r++) {
    const z = P.ROW0 + r * P.ROWD;
    for (const s of [-1, 1]) {
      for (const cx of P.CHAIR_X) {
        if (P.chairSkipped(s, cx, z)) continue;
        const x = s * cx + (rnd() - 0.5) * 0.04;
        const zz = z + (rnd() - 0.5) * 0.05;
        k.box(0.44, 0.05, 0.42, x, 0.45, zz, m.rush, { tile: 0.4, tint: 0.9 + rnd() * 0.15 });
        k.plane(0.42, 0.95, x, 0.48, zz - 0.21, m.chairBack, { flat: false });
        k.plane(0.42, 0.44, x, 0.22, zz + 0.19, m.chairBack, { flat: false });
      }
      seats.push({ x: s * P.CHAIR_X[0], z: z + 0.1, yaw: 0, table: r, h: 0.46, via: [] });
    }
  }
  // brass chandeliers over the nave and the crossing (lit at dusk)
  for (const z of [24, 36, 48, XMID]) chandelier(F0, m, chand, 0, 9.6, z, z === XMID ? H - 0.3 : HV - 0.3);

  k.finish();

  const altarN = altarLit.count;
  altarLit.showFirst(0);
  const chandN = chand.count;
  // the Lady altar's stand: grows as candles are lit (F)
  const stand = new Flames(group, 40, 0.14);
  const standSpots: Array<[number, number, number]> = [];
  for (let tier = 0; tier < 3; tier++) for (let i = 0; i < 9; i++) standSpots.push([LX - 0.7 + i * 0.175 + (tier % 2) * 0.08, 1.08 + tier * 0.25, STAND.z + tier * 0.1]);
  for (let i = 0; i < 11; i++) stand.addFlame(...standSpots[(i * 7) % standSpots.length]);

  // ================= light: the day through the glass, the candles, the chandeliers at dusk
  const hemi = new THREE.HemisphereLight(0xdcd8d0, 0x4a4036, 1.2);
  const amb = new THREE.AmbientLight(0x5a5048, 0.8);
  const HEMI_DAY = new THREE.Color(0xdcd8d0);
  const HEMI_NIGHT = new THREE.Color(0x5a6a90);
  const GROUND_DAY = new THREE.Color(0x4a4036);
  const GROUND_NIGHT = new THREE.Color(0x1a1612);
  const AMB_DAY = new THREE.Color(0x5a5048);
  const AMB_NIGHT = new THREE.Color(0x283044);
  scene.add(hemi, amb);
  const pt = (c: number, x: number, y: number, z: number, d: number, decay = 1.5) => {
    const l = new THREE.PointLight(c, 0, d, decay);
    l.position.set(x, y, z);
    group.add(l);
    return l;
  };
  const altarL = pt(0xffb070, 0, 3.5, AZ - 0.5, 14);
  const ladyL = pt(0xffa860, LX, 1.8, STAND.z - 0.6, 9);
  const naveL = pt(0xffb070, 0, 8, 36, 30, 1.2);
  const dayNave = pt(0xdce0e4, 0, 16, 36, 60, 1.0);
  const dayCross = pt(0xe4e2dc, 0, 30, XMID, 50, 1.0);
  const dayChoir = pt(0xe0dcd4, 0, 15, 96, 40, 1.0);
  const triL = [pt(0xffc890, NORTH * P.TRIPTYCH_X, 5, CROSS1 - 5, 12, 1.3), pt(0xffc890, -NORTH * P.TRIPTYCH_X, 5, CROSS1 - 5, 12, 1.3)];
  // the sun through the south glass: patches on the floor in the glass's colours, the piers' and arcades' shadows
  // across them, the shafts from the aisles' lancets and the clerestory (world/hallSun.ts); the moon by night
  const piers = [...BAYS, ...CHOIR_BAYS].flatMap((z) => [-1, 1].flatMap((s) => [{ x: s * NAVE, z, r: 0.74, h: 8 }, { x: s * A2, z, r: 0.52, h: 8 }, ...(z > P.TOWER_E && z < CROSS0 ? [{ x: s * A3, z, r: 0.52, h: 8 }] : [])]));
  for (const s of [-1, 1]) for (const z of [CROSS0, CROSS1]) piers.push({ x: s * NAVE, z, r: 1.12, h: 13 });
  const sunLight = buildHallSun(group, {
    floor: { minX: -TE, maxX: TE, minZ: W0, maxZ: CHOIR_E + 0.6 },
    floors: [
      { minX: -OUT, maxX: OUT, minZ: WO, maxZ: CROSS0 },
      { minX: -TE, maxX: TE, minZ: CROSS0, maxZ: CROSS1 },
      { minX: -(A3 - 0.4), maxX: A3 - 0.4, minZ: W0, maxZ: WO },
      { minX: -A3, maxX: A3, minZ: CROSS1, maxZ: CHOIR_E + 0.6 },
    ],
    windows: sunWins,
    piers,
    screens: [-1, 1].flatMap((s) => [
      { along: "z" as const, at: s * NAVE, from: W0, to: CROSS0, open: 10.5 },
      { along: "z" as const, at: s * NAVE, from: CROSS1, to: AC, open: 10 },
      { along: "z" as const, at: s * A2, from: W0, to: CROSS0, open: 10 },
      { along: "z" as const, at: s * A3, from: P.TOWER_E, to: CROSS0, open: 10 },
      { along: "z" as const, at: s * A2, from: CROSS1, to: CHOIR_E, open: 10 },
      // (issue #10: the transept's west wall: the aisles' arches into the arm, beyond them wall; the light of the
      // transept's front and east windows stops at it)
      { along: "x" as const, at: CROSS0 - 0.3, from: s > 0 ? NAVE : -A3, to: s > 0 ? A3 : -NAVE, open: 0, solid: [[9.2, 60]] as Array<[number, number]> },
      { along: "x" as const, at: CROSS0 - 0.3, from: s > 0 ? A3 : -TE, to: s > 0 ? TE : -A3, open: 0 },
    ]),
    // the nave arcades' walls over their arches, up to the clerestory: lit across the nave
    walls: [-1, 1].map((s) => ({ a: [s * (NAVE - 0.4), W0 + 0.3] as [number, number], b: [s * (NAVE - 0.4), CROSS0 - 1.3] as [number, number], y0: 12.35, y1: 16.2, n: [-s, 0] as [number, number] })),
    power: 1.1,
  });

  // walking: Jef (sitting and kneeling go through the room frame) and the people, by the plan
  const jefFree = (x: number, z: number) => P.freeAt(x, z, 0.3, true);
  const walkJef = (fx: number, fz: number, x: number, z: number): [number, number] => (jefFree(x, z) ? [x, z] : jefFree(x, fz) ? [x, fz] : jefFree(fx, z) ? [fx, z] : [fx, fz]);
  const path = walkGraph(P.nodes(), (x, z) => P.freeAt(x, z, 0.25, false));

  const marks: Record<string, Mark> = { ...P.MARKS, stand: STAND };
  const sets: Record<string, Mark[]> = { ...P.SETS, chairs };
  const RS = P.RESURRECTION;
  const looks: Lookable[] = [
    { id: "elevation", x: NORTH * P.TRIPTYCH_X, z: CROSS1 - 3.2, r: 3.5, label: "look at the Elevation of the Cross", text: "Rubens's Elevation of the Cross, the great triptych, back in Antwerp since the French gave it up in 1815. Men strain with ropes and shoulders to heave the cross upright on a slant; on the wings the mourners grieve and the Roman officer gives his orders from the saddle." },
    { id: "descent", x: -NORTH * P.TRIPTYCH_X, z: CROSS1 - 3.2, r: 3.5, label: "look at the Descent from the Cross", text: "Rubens's Descent from the Cross. A pale body slides down a white sheet into many hands; a young man in a red cloak takes its weight. On the wings the Visitation and the Presentation in the Temple. The arquebusiers' guild paid for it, two hundred and sixty years ago." },
    { id: "assumption", x: 0, z: RAILZ - 1.0, r: 2.2, label: "look at the high altar", text: "Over the high altar, in black and white marble and gold, Our Lady rises on clouds among the angels while the apostles stare into her empty tomb: Rubens again, his Assumption. The altar is new, fifty years old, built from the marble of a church the French pulled down. The red lamp before the tabernacle never goes out." },
    { id: "resurrection", x: RS.x * 0.8, z: AC + (RS.z - AC) * 0.8, r: 2.4, label: "look at the Resurrection", text: "A smaller triptych on the ambulatory wall: Christ bursts from the tomb with a red banner and the guards fall back from the light. A printer's widow had it painted for her husband's grave." },
    { id: "dome", x: 0, z: XMID, r: 3.0, label: "look up into the dome", text: "High over the crossing the lantern opens to a painted dome: rings of clouds and angels climbing toward the light, and Our Lady rising at the top. Painted two hundred years ago; from down here it swims in the dusk and the daylight of the lantern's windows." },
    { id: "pulpit", x: P.PULPIT.x + 1.9, z: P.PULPIT.z, r: 1.9, label: "look at the pulpit", text: "The pulpit is carved oak, all of it: at its foot four women for Europe, Asia, Africa and America with a horse, a camel, a lion and a crocodile; trees rise from them, their branches full of birds, an eagle and a peacock among them; angels blow trumpets on the sounding board. It came from the abbey at Hemiksem when the French closed it." },
    { id: "stalls", x: 0, z: RAILZ - 1.2, r: 1.4, label: "look at the choir stalls", text: "Behind the rail the canons' stalls run down both sides of the choir in new pale oak: pointed arches, gables and pinnacles, carved these thirty years and still not finished. The old stalls went to the fire in the French years." },
    { id: "organ", x: 0, z: W0 + 6.5, r: 2.2, label: "look up at the organ", text: "Up on the west gallery over the door the organ's carved case climbs toward the great west window: towers of tin pipes, gilt crests, angels with trumpets on top." },
    { id: "font", x: P.FONT.x, z: P.FONT.z + 1.4, r: 1.6, label: "look at the font", text: "The font by the door, black marble with a white bowl under an oak cover. A drop of holy water on your fingers is cold as the Schelde." },
    { id: "slab", x: 9, z: 24, r: 1.4, label: "read a grave slab", text: "A worn slab in the floor: a merchant, his wife, a coat of arms and a skull, and a date two hundred years gone. Ten thousand boots have walked his name smooth." },
  ];

  const lampPts = { altar: toWorld(0, AZ, 3.3), lady: toWorld(LX, STAND.z, 1.4), chand: toWorld(0, 36, 9.3) };
  let lit = false;
  let day = 1;
  let ambK = 1;
  let sky = 1;
  const glassLight = () => {
    // the glass glows with the daylight outside, dimmer in fog and rain
    // by night the glass holds the moon's cold blue; the air in the hall goes blue-black round the candles
    const night = 1 - THREE.MathUtils.smoothstep(day, 0, 0.35);
    const moon = night * THREE.MathUtils.clamp((sky - 0.55) * 2.2, 0.25, 1);
    const g0 = 0.95 * day * sky;
    // (issue #10: the stained glass inside as the old panes were; the shell's pane outside as its stone round it by day)
    for (const q of glasses.in) q.color.setRGB(0.07 + g0 + 0.05 * moon, 0.08 + g0 + 0.08 * moon, 0.1 + g0 + 0.17 * moon);
    glasses.out?.color.setScalar(0.3 + 1.3 * day * (0.55 + 0.45 * sky));
    // (the lamplight in the panes after dusk, amber, dim as a church by its candles: world/landmarkWindows.ts)
    glasses.glow?.color.setRGB(1.0, 0.56, 0.22).multiplyScalar(0.36 * THREE.MathUtils.clamp((0.5 - day) / 0.3, 0, 1));
    sunLight.set(day, sky);
    const d = day * (0.55 + 0.45 * sky);
    // (by day a little less flat fill than before: the sun's patches and the shafts carry the brightness, the far
    // sides of the piers and the aisles away from the sun keep their shade)
    hemi.intensity = (0.32 + 2.2 * d) * ambK;
    hemi.color.copy(HEMI_DAY).lerp(HEMI_NIGHT, night);
    hemi.groundColor.copy(GROUND_DAY).lerp(GROUND_NIGHT, night);
    amb.intensity = (0.22 + 0.4 * day) * ambK;
    amb.color.copy(AMB_DAY).lerp(AMB_NIGHT, night);
    dayNave.intensity = 13 * d * ambK;
    dayCross.intensity = 12 * d * ambK;
    dayChoir.intensity = 9 * d * ambK;
  };
  // issue #10: the windows' glass from the shell's old panes, when the shell is in (world/cathedralOutside.ts): the pane
  // seen from the street facing out, the hall's own glass facing in (see hallGlassFrom); world coordinates
  whenShellGlass("cathedral", (litGlass) => {
    // (from the street see-through enough for the hall to show behind the lead: the atlas paints plain leaded glass)
    const outer = roomGlassFrom(litGlass, { name: "cathedral", opacity: 0.5 });
    const om = outer.material as THREE.MeshBasicMaterial;
    om.side = THREE.FrontSide;
    const inner = hallGlassFrom(litGlass, picture("/textures/cath_glass.jpg", { clamp: true }), glass("grisaille", 31));
    glasses.out = om;
    glasses.in = inner.slice(0, 2).map((q) => q.material as THREE.MeshBasicMaterial);
    glasses.glow = inner[2].material as THREE.MeshBasicMaterial;
    scene.add(outer, ...inner);
    glassLight();
  });
  const room: LandmarkRoom = {
    kind: "landmark",
    landmark: "cathedral",
    scene,
    group,
    walk: walkJef,
    seats,
    stands: [],
    exit: { ...P.MARKS.door, yaw: Math.PI },
    entry: { ...P.MARKS.door },
    entries: { main: { ...P.MARKS.door } },
    exits: { main: { ...P.MARKS.door, yaw: Math.PI } },
    lamps: [],
    toWorld,
    floor: (x, z) => P.floorAt(x, z),
    peopleFloor: (x, z) => P.floorAt(x, z),
    pace: 1.45,
    eye: 1.62,
    surface: "stone",
    sound: "church",
    marks,
    sets,
    looks,
    path,
    setLit(on) {
      lit = on;
      altarLit.showFirst(on ? altarN : 0);
    },
    addCandle() {
      if (stand.count < standSpots.length) stand.addFlame(...standSpots[(stand.count * 7) % standSpots.length]);
    },
    setDaylight(kd, weather = 1) {
      day = kd;
      sky = weather;
      glassLight();
      chand.showFirst(kd < 0.35 ? chandN : 0);
    },
    setAmbient(a) {
      ambK = a;
      glassLight();
    },
    update(t) {
      flames.update(t);
      altarLit.update(t);
      stand.update(t);
      chand.update(t);
      const f = flicker(t, 2.2);
      // (all night, shut or not: the sanctuary lamp and two candles at the high altar, the nave's lamps, the Lady altar)
      const dark = 1 - THREE.MathUtils.smoothstep(day, 0.1, 0.4);
      altarL.intensity = lit ? 9 * f : 3.2 * dark * f;
      ladyL.intensity = (3 + stand.count * 0.3 + 1.5 * dark) * flicker(t, 5.1);
      naveL.intensity = 12 * dark * flicker(t, 7.7);
      for (const [i, l] of triL.entries()) l.intensity = 2.2 * flicker(t, 3.3 + i);
      redGlow.material.opacity = 0.75 + Math.sin(t * 3.1) * 0.08;
      room.lamps = [
        ...(lit ? [{ p: lampPts.altar, w: 0.4 * f }] : []),
        { p: lampPts.lady, w: 0.3 * flicker(t, 5.1) },
        ...(day < 0.35 ? [{ p: lampPts.chand, w: 0.35 }] : []),
      ];
    },
  };
  room.update(0, 0);
  room.setDaylight(1);
  return room;
}
