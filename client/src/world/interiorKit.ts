import * as THREE from "three";
import { psx, bumpFromMap } from "../retro/psx";
import { withPicture } from "./quayStone";
import { Builder, canvasTex, lambert, mat, rand, tex } from "./rooms";
import { glowTexture } from "./textures";
import { addDial } from "./clockHands";

// M7 shops and cafes (docs/milestones/M7-shops.md): the pieces the shops (world/shopRooms.ts) and the cafes
// (world/cafeRooms.ts) are built from, in the PS1 way: boxes and low cylinders, painted 64-256 px textures and
// Codex pictures (assets/ATTRIBUTION.md) with a painted stand-in until they load. Everything here is built into a
// Builder's group, which the room merges by material (rooms.ts mergeStatic).

export type V3 = [number, number, number];

// ------------------------------------------------------------------ pictures and paint

/** A Codex picture (client/public/textures), with a painted stand-in until it loads; `bump` gives it relief after. */
export function picture(url: string, fallback: THREE.Texture, onLoad?: () => void): THREE.Texture {
  fallback.wrapS = fallback.wrapT = THREE.RepeatWrapping;
  fallback.magFilter = THREE.NearestFilter;
  fallback.minFilter = THREE.LinearMipmapLinearFilter;
  fallback.generateMipmaps = true;
  fallback.anisotropy = 4;
  if (onLoad) fallback.userData.onPicture = onLoad;
  return withPicture(fallback, url);
}

/** A psx material on a Codex picture; floors get their relief from the picture once it is in (bump metres). */
export function picMat(key: string, url: string, fallback: () => THREE.Texture, color = 0xffffff, bump = 0, affine = 0.2): THREE.Material {
  return mat(key, () => {
    const m = psx(new THREE.MeshLambertMaterial({ color }), { affine }) as THREE.MeshLambertMaterial;
    m.map = picture(url, fallback(), bump > 0 ? () => bumpFromMap(m, bump) : undefined);
    return m;
  });
}

/** A psx material on a painted texture; a floor gets its relief from it (bump metres). */
export function paintMat(key: string, paint: () => THREE.Texture, color = 0xffffff, bump = 0, affine = 0.2, side: THREE.Side = THREE.FrontSide): THREE.Material {
  return mat(key, () => {
    const m = psx(new THREE.MeshLambertMaterial({ map: paint(), color, side }), { affine });
    return bump > 0 ? bumpFromMap(m, bump) : m;
  });
}

export const flatTex = (c: string) =>
  canvasTex(8, 8, (g) => {
    g.fillStyle = c;
    g.fillRect(0, 0, 8, 8);
  });

/** Square floor tiles: a checker of two colours, worn, with dirty joints (and sawdust if asked). */
export function checkerTex(a: string, b: string, n = 6, seed = 1, sawdust = 0): THREE.CanvasTexture {
  const r = rand(seed);
  return canvasTex(128, 128, (g) => {
    const s = 128 / n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        g.fillStyle = (x + y) % 2 ? a : b;
        g.fillRect(x * s, y * s, s, s);
        g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.15})`;
        g.fillRect(x * s, y * s, s, s);
        g.fillStyle = "rgba(255,240,220,0.06)";
        g.fillRect(x * s + 1, y * s + 1, s - 3, 2);
      }
    g.fillStyle = "rgba(20,14,10,0.7)";
    for (let i = 0; i <= n; i++) {
      g.fillRect(i * s - 1, 0, 2, 128);
      g.fillRect(0, i * s - 1, 128, 2);
    }
    for (let i = 0; i < sawdust; i++) {
      g.fillStyle = `rgba(${200 + r() * 40},${160 + r() * 40},${90 + r() * 40},${0.5 + r() * 0.4})`;
      g.fillRect(r() * 128, r() * 128, 1 + r() * 2, 1);
    }
  });
}

/** White glazed wall tiles (the butcher, the barber's wash corner). */
export function whiteTilesTex(): THREE.CanvasTexture {
  const r = rand(77);
  return canvasTex(64, 64, (g) => {
    g.fillStyle = "#d8d4c8";
    g.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        const v = 205 + r() * 25;
        g.fillStyle = `rgb(${v},${v - 3},${v - 12})`;
        g.fillRect(x * 16 + 1, y * 16 + 1, 14, 14);
        g.fillStyle = "rgba(255,255,255,0.35)";
        g.fillRect(x * 16 + 2, y * 16 + 2, 5, 2);
      }
    g.fillStyle = "rgba(90,70,50,0.25)";
    for (let i = 0; i < 20; i++) g.fillRect(r() * 64, 40 + r() * 24, 1, 2 + r() * 6);
  });
}

/** Marble, white or grey, a few veins. */
export function marbleTex(base = "#dcd8d0", vein = "rgba(90,90,96,0.35)", seed = 5): THREE.CanvasTexture {
  const r = rand(seed);
  return canvasTex(64, 64, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(255,255,255,${r() * 0.12})`;
      g.fillRect(r() * 64, r() * 64, 4 + r() * 8, 3 + r() * 6);
    }
    g.strokeStyle = vein;
    for (let k = 0; k < 5; k++) {
      g.beginPath();
      let x = r() * 64;
      let y = 0;
      g.moveTo(x, y);
      while (y < 64) {
        x += (r() - 0.5) * 10;
        y += 3 + r() * 6;
        g.lineTo(x, y);
      }
      g.lineWidth = 0.5 + r();
      g.stroke();
    }
  });
}

/** A shelf row of bottles, jars or tins as a flat picture (cheap: one plane per shelf). */
export function rowTex(kind: "bottles" | "jars" | "tins" | "books" | "boxes" | "bolts" | "hatboxes", seed = 3): THREE.CanvasTexture {
  const r = rand(seed * 31 + kind.length);
  return canvasTex(128, 32, (g) => {
    g.clearRect(0, 0, 128, 32);
    let x = 1;
    while (x < 126) {
      const w =
        kind === "books" ? 3 + r() * 4 : kind === "bolts" ? 10 + r() * 6 : kind === "hatboxes" ? 16 + r() * 8 : kind === "bottles" ? 5 + r() * 3 : kind === "jars" ? 9 + r() * 5 : 8 + r() * 6;
      const h = kind === "books" ? 22 + r() * 9 : kind === "bolts" ? 26 : kind === "hatboxes" ? 14 + r() * 12 : kind === "bottles" ? 18 + r() * 12 : kind === "jars" ? 16 + r() * 12 : 12 + r() * 12;
      const y = 32 - h;
      const pal: Record<string, string[]> = {
        bottles: ["#1f3a22", "#4a2a12", "#2a2a30", "#5a4a2a", "#1a2a3a"],
        jars: ["#e0dccf", "#d8d4c8", "#c8d0d8", "#e8e2d0"],
        tins: ["#7a2a1a", "#1a3a2a", "#8a6a2a", "#2a2a4a", "#5a1a1a"],
        books: ["#5a2a1a", "#2a3a2a", "#1a2a3a", "#4a3a22", "#6a4a2a", "#3a1a1a"],
        boxes: ["#6a4a2a", "#8a5a30", "#4a3020", "#a07040"],
        bolts: ["#3a4a5a", "#6a2a2a", "#4a5a3a", "#8a7a5a", "#2a2a3a", "#a09070", "#5a3a4a"],
        hatboxes: ["#8a7a60", "#3a2a22", "#a08a6a", "#4a3a30"],
      };
      const c = pal[kind][Math.floor(r() * pal[kind].length)];
      g.fillStyle = c;
      if (kind === "bottles") {
        g.fillRect(x, y + 6, w, h - 6);
        g.fillRect(x + w / 2 - 1, y, 2, 7);
        g.fillStyle = "rgba(230,220,190,0.7)";
        g.fillRect(x, y + 12, w, 4);
      } else if (kind === "jars") {
        g.fillRect(x, y + 3, w, h - 3);
        g.fillStyle = "#2a3a6a";
        g.fillRect(x + 1, y + 8, w - 2, 5);
        g.fillStyle = c;
        g.fillRect(x + 2, y, w - 4, 3);
      } else if (kind === "bolts") {
        g.fillRect(x, y, w, h);
        g.fillStyle = "rgba(0,0,0,0.25)";
        for (let k = 2; k < h; k += 3) g.fillRect(x, y + k, w, 1);
      } else {
        g.fillRect(x, y, w, h);
        g.fillStyle = "rgba(210,180,90,0.55)";
        if (kind === "books") {
          g.fillRect(x, y + 3, w, 1);
          g.fillRect(x, y + h - 5, w, 1);
        } else if (kind === "tins") g.fillRect(x + 1, y + h / 3, w - 2, h / 4);
        else g.fillRect(x + 1, y + 2, w - 2, 1);
      }
      g.fillStyle = "rgba(255,255,255,0.12)";
      g.fillRect(x, y, 1, h);
      x += w + (kind === "books" ? 0 : 1 + r() * 2);
    }
  }, true);
}

/** A printed poster: a coloured ground, two to four lines of type, a border, a simple emblem. */
export function posterTex(lines: string[], bg: string, fg: string, emblem: "lion" | "glass" | "lyre" | "ship" | "none" = "none", seed = 1): THREE.CanvasTexture {
  const r = rand(seed);
  return canvasTex(64, 96, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, 64, 96);
    g.strokeStyle = fg;
    g.lineWidth = 1.5;
    g.strokeRect(3, 3, 58, 90);
    g.fillStyle = fg;
    g.textAlign = "center";
    let y = 17;
    lines.forEach((l, i) => {
      g.font = `${i === 0 ? "bold " : ""}${i === 0 ? 11 : 8}px Georgia, serif`;
      g.fillText(l, 32, y, 56);
      y += i === 0 ? 13 : 10;
      if (i === 0 && emblem !== "none") y += 34;
    });
    const cy = 36;
    g.fillStyle = fg;
    if (emblem === "lion") {
      g.beginPath();
      g.ellipse(32, cy + 8, 11, 7, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(24, cy - 2, 6, 0, Math.PI * 2);
      g.fill();
      g.fillRect(36, cy + 12, 3, 10);
      g.fillRect(26, cy + 12, 3, 10);
      g.fillRect(41, cy, 7, 2);
    } else if (emblem === "glass") {
      g.fillRect(27, cy - 8, 10, 20);
      g.fillStyle = bg;
      g.fillRect(29, cy - 6, 6, 4);
      g.fillStyle = fg;
      g.fillRect(29, cy + 12, 6, 6);
      g.fillRect(24, cy + 18, 16, 2);
    } else if (emblem === "lyre") {
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(22, cy - 10);
      g.quadraticCurveTo(20, cy + 14, 32, cy + 16);
      g.quadraticCurveTo(44, cy + 14, 42, cy - 10);
      g.stroke();
      for (let k = 0; k < 4; k++) g.fillRect(28 + k * 3, cy - 6, 1, 20);
    } else if (emblem === "ship") {
      g.fillRect(18, cy + 10, 28, 5);
      g.fillRect(31, cy - 12, 2, 22);
      g.beginPath();
      g.moveTo(33, cy - 10);
      g.lineTo(44, cy + 6);
      g.lineTo(33, cy + 6);
      g.fill();
    }
    for (let i = 0; i < 120; i++) {
      g.fillStyle = `rgba(40,30,20,${r() * 0.25})`;
      g.fillRect(r() * 64, r() * 96, 1 + r() * 3, 1);
    }
    g.fillStyle = "rgba(60,40,20,0.25)";
    g.fillRect(0, 0, 64, 4);
    g.fillRect(0, 90, 64, 6);
  }, false);
}

/** A mirror's glass: dark silvering, a soft light band, spots where the silver has gone. */
export function mirrorTex(seed = 2): THREE.CanvasTexture {
  const r = rand(seed);
  return canvasTex(64, 64, (g) => {
    const gr = g.createLinearGradient(0, 0, 64, 64);
    gr.addColorStop(0, "#4a4a44");
    gr.addColorStop(0.45, "#7a7668");
    gr.addColorStop(0.55, "#8a8474");
    gr.addColorStop(1, "#3a3a36");
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(20,18,14,${r() * 0.3})`;
      g.beginPath();
      g.arc(r() * 64, r() * 64, 0.5 + r() * 2.5, 0, Math.PI * 2);
      g.fill();
    }
    // the room behind, blurred: warm lamps and dark shapes
    for (let i = 0; i < 6; i++) {
      g.fillStyle = `rgba(255,200,120,${0.2 + r() * 0.2})`;
      g.fillRect(r() * 60, 8 + r() * 20, 2, 2);
    }
    g.fillStyle = "rgba(20,14,10,0.35)";
    g.fillRect(0, 44, 64, 20);
  }, false);
}

/**
 * A clock's face: the ring and the hour marks, no hands (every clock shows the game's time: the hands are
 * live, world/clockHands.ts; Kit.clock). `seed` varies the face a little (paper, enamel, the marks).
 * The face's own circle is 14/16 of the picture's half width.
 */
export function clockFaceTex(seed = 1): THREE.CanvasTexture {
  const faces = ["#e8e0c8", "#ece6d6", "#e0d4b4", "#efe8d8"];
  return canvasTex(32, 32, (g) => {
    g.fillStyle = "#1a140c";
    g.fillRect(0, 0, 32, 32);
    g.fillStyle = faces[((seed % 4) + 4) % 4];
    g.beginPath();
    g.arc(16, 16, 14, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#2a2018";
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const big = i % 3 === 0 && seed % 2 === 0;
      g.fillRect(16 + Math.sin(a) * 11 - (big ? 0.8 : 0.5), 16 - Math.cos(a) * 11 - 1, big ? 1.6 : 1.2, 2);
    }
  }, false);
}

/** A board of lettering (a shop's name inside, a price list, a chalkboard). */
export function boardTex(lines: string[], bg: string, fg: string, w = 256, h = 64, font = "Georgia, serif"): THREE.CanvasTexture {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const n = lines.length;
    lines.forEach((l, i) => {
      const size = Math.floor((h / (n + 0.6)) * (i === 0 ? 0.8 : 0.62));
      g.font = `${i === 0 ? "bold " : ""}${size}px ${font}`;
      g.fillText(l, w / 2, (h * (i + 0.8)) / (n + 0.6), w - 12);
    });
    const r = rand(lines.join("").length * 13);
    for (let i = 0; i < (w * h) / 60; i++) {
      g.fillStyle = `rgba(0,0,0,${r() * 0.25})`;
      g.fillRect(r() * w, r() * h, 2, 1);
    }
  }, false);
}

/** A small painting (a ship, a landscape, a portrait) in muted oils, for a frame on the wall. */
export function paintingTex(kind: "ship" | "land" | "portrait" | "saint", seed = 1): THREE.CanvasTexture {
  const r = rand(seed);
  return canvasTex(48, 36, (g) => {
    const sky = g.createLinearGradient(0, 0, 0, 36);
    sky.addColorStop(0, kind === "portrait" || kind === "saint" ? "#2a2218" : "#6a6a60");
    sky.addColorStop(1, kind === "portrait" || kind === "saint" ? "#1a140e" : "#3a3a34");
    g.fillStyle = sky;
    g.fillRect(0, 0, 48, 36);
    if (kind === "ship") {
      g.fillStyle = "#3a4440";
      g.fillRect(0, 24, 48, 12);
      g.fillStyle = "#1e1a16";
      g.fillRect(12, 22, 24, 4);
      for (const x of [17, 24, 31]) g.fillRect(x, 8, 1, 15);
      g.fillStyle = "#b8b0a0";
      for (const x of [17, 24, 31]) g.fillRect(x - 4, 10 + r() * 2, 8, 5);
    } else if (kind === "land") {
      g.fillStyle = "#4a5236";
      g.fillRect(0, 22, 48, 14);
      g.fillStyle = "#2a3020";
      g.beginPath();
      g.arc(34, 20, 7, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#6a5a40";
      g.fillRect(8, 16, 8, 7);
    } else {
      g.fillStyle = kind === "saint" ? "#6a3a2a" : "#2a2a2e";
      g.fillRect(16, 18, 16, 18);
      g.fillStyle = "#b89878";
      g.beginPath();
      g.arc(24, 13, 5, 0, Math.PI * 2);
      g.fill();
      if (kind === "saint") {
        g.strokeStyle = "#c8a850";
        g.beginPath();
        g.arc(24, 12, 8, 0, Math.PI * 2);
        g.stroke();
      }
    }
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(0,0,0,${r() * 0.2})`;
      g.fillRect(r() * 48, r() * 36, 2, 1);
    }
  }, false);
}

// ------------------------------------------------------------------ materials used again and again

export const M = {
  oak: () => lambert("ik_oak", { map: tex().planks, color: 0x6a4a30 }),
  darkOak: () => lambert("ik_darkoak", { map: tex().planks, color: 0x3a2618 }),
  mahogany: () => lambert("ik_mahogany", { map: tex().planks, color: 0x5a2a1a }),
  pine: () => lambert("ik_pine", { map: tex().planks, color: 0x9a7a52 }),
  brass: () => lambert("ik_brass", { color: 0xb08a3a }, 0),
  copper: () => lambert("ik_copper", { color: 0xb0603a }, 0),
  iron: () => lambert("ik_iron", { color: 0x1c1a18 }, 0),
  zinc: () => lambert("ik_zinc", { color: 0x9a9a92 }, 0),
  white: () => lambert("ik_white", { color: 0xe0dccf }, 0),
  cloth: (c: number) => lambert(`ik_cloth_${c.toString(16)}`, { color: c }, 0.1),
  paint: (c: number) => lambert(`ik_paint_${c.toString(16)}`, { color: c }, 0.1),
  marble: () => paintMat("ik_marble", () => marbleTex(), 0xffffff, 0, 0.1),
  glass: () => mat("ik_glass", () => new THREE.MeshBasicMaterial({ color: 0x6a7470, transparent: true, opacity: 0.18, depthWrite: false })),
  glow: (c: number) => mat(`ik_glow_${c.toString(16)}`, () => new THREE.MeshBasicMaterial({ color: c })),
  basic: (key: string, t: () => THREE.Texture, color = 0xffffff) => mat(key, () => new THREE.MeshBasicMaterial({ map: t(), color, transparent: true, alphaTest: 0.4 })),
  cutout: (key: string, t: () => THREE.Texture, color = 0xffffff) => mat(key, () => psx(new THREE.MeshLambertMaterial({ map: t(), color, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }), { affine: 0 })),
};

// ------------------------------------------------------------------ pieces

/** The pieces, built into one group (the room's still things). Local frame of the room, y up from its floor. */
export class Kit {
  constructor(readonly b: Builder) {}

  /** An axis box by its min/max corners (x, z) and a floor height y + height h. */
  bx(xa: number, xb: number, y: number, h: number, za: number, zb: number, m: THREE.Material, solid = false, tile = 1): THREE.Mesh {
    const [a, c] = [Math.min(xa, xb), Math.max(xa, xb)];
    const [d, e] = [Math.min(za, zb), Math.max(za, zb)];
    return this.b.box(Math.max(0.005, c - a), h, Math.max(0.005, e - d), (a + c) / 2, y + h / 2, (d + e) / 2, m, { solid, tile });
  }

  /** A bentwood chair (Thonet): a round seat, the legs, the bent loop of the back, facing yaw (the way a sitter looks). */
  chair(x: number, z: number, y: number, yaw: number, seat: THREE.Material = M.darkOak()): void {
    const wood = M.darkOak();
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 8), seat);
    s.position.y = 0.46;
    g.add(s);
    for (const [dx, dz] of [[-0.14, -0.14], [0.14, -0.14], [-0.14, 0.14], [0.14, 0.14]]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.46, 4), wood);
      l.position.set(dx, 0.23, dz);
      g.add(l);
    }
    // the back: two uprights and the loop
    for (const dx of [-0.15, 0.15]) {
      const u = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.45, 4), wood);
      u.position.set(dx, 0.7, -0.17);
      g.add(u);
    }
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.016, 4, 10, Math.PI), wood);
    loop.position.set(0, 0.9, -0.17);
    g.add(loop);
    this.b.group.add(g);
  }

  /** A round cafe table: a marble (or wood) top on a cast-iron foot. */
  roundTable(x: number, z: number, y: number, r = 0.35, top: THREE.Material = M.marble()): void {
    this.b.cyl(r, 0.04, x, y + 0.74, z, top, false, 12);
    this.b.cyl(0.035, 0.7, x, y + 0.37, z, M.iron(), false, 5);
    this.b.box(0.5, 0.04, 0.08, x, y + 0.02, z, M.iron());
    this.b.box(0.08, 0.04, 0.5, x, y + 0.02, z, M.iron());
    this.b.boxes.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r });
  }

  /** A square wooden table on four legs. */
  squareTable(x: number, z: number, y: number, w = 0.75, d = 0.75, top: THREE.Material = M.oak()): void {
    this.b.box(w, 0.05, d, x, y + 0.745, z, top, { tile: 0.8 });
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.b.box(0.06, 0.72, 0.06, x + dx * (w / 2 - 0.06), y + 0.36, z + dz * (d / 2 - 0.06), M.darkOak());
    this.b.boxes.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
  }

  /** A bottle standing (x, y of its foot, z). */
  bottle(x: number, y: number, z: number, c = 0x2c4a2a, h = 0.26): void {
    this.b.cyl(0.035, h * 0.72, x, y + h * 0.36, z, lambert(`ik_bottle_${c.toString(16)}`, { color: c }, 0), false, 6);
    this.b.cyl(0.013, h * 0.28, x, y + h * 0.86, z, lambert(`ik_bottle_${c.toString(16)}`, { color: c }, 0), false, 4);
  }

  /** A jar with a lid (glass or earthenware). */
  jar(x: number, y: number, z: number, r: number, h: number, body: THREE.Material, lid: THREE.Material = M.brass()): void {
    this.b.cyl(r, h, x, y + h / 2, z, body, false, 8);
    this.b.cyl(r * 0.8, 0.03, x, y + h + 0.015, z, lid, false, 8);
  }

  /** A loaf of bread (a squashed, rounded box). */
  loaf(x: number, y: number, z: number, yaw = 0, s = 1, c = 0x8a5a2a): void {
    const g = new THREE.SphereGeometry(0.13 * s, 6, 4);
    g.scale(1.3, 0.6, 0.85);
    const m = new THREE.Mesh(g, lambert(`ik_loaf_${c.toString(16)}`, { color: c }, 0));
    m.position.set(x, y + 0.07 * s, z);
    m.rotation.y = yaw;
    this.b.group.add(m);
  }

  /** A sack standing on the floor, open at the top with its goods showing. */
  sack(x: number, z: number, y: number, goods = 0x5a3a20, solid = true): void {
    const g = new THREE.CylinderGeometry(0.22, 0.27, 0.62, 7);
    const m = new THREE.Mesh(g, lambert("ik_sack", { map: tex().sack, color: 0xc8b89a }));
    m.position.set(x, y + 0.31, z);
    this.b.group.add(m);
    this.b.cyl(0.2, 0.04, x, y + 0.62, z, lambert(`ik_goods_${goods.toString(16)}`, { color: goods }, 0), false, 7);
    if (solid) this.b.boxes.push({ minX: x - 0.28, maxX: x + 0.28, minZ: z - 0.28, maxZ: z + 0.28 });
  }

  /** An open crate of goods (apples, potatoes, onions), tipped a little toward the aisle. */
  crate(x: number, z: number, y: number, goods: number, yaw = 0, solid = true): void {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    const wood = lambert("ik_crate", { map: tex().crate, color: 0xa08060 });
    const add = (w: number, h: number, d: number, px: number, py: number, pz: number, m: THREE.Material) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      b.position.set(px, py, pz);
      g.add(b);
    };
    add(0.55, 0.28, 0.4, 0, 0.14, 0, wood);
    const gm = lambert(`ik_goods_${goods.toString(16)}`, { color: goods }, 0);
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 3), gm);
      s.position.set(-0.18 + (i % 3) * 0.18, 0.3, -0.08 + Math.floor(i / 3) * 0.16);
      g.add(s);
    }
    add(0.5, 0.02, 0.35, 0, 0.27, 0, gm);
    this.b.group.add(g);
    if (solid) this.b.boxes.push({ minX: x - 0.32, maxX: x + 0.32, minZ: z - 0.32, maxZ: z + 0.32 });
  }

  /** A shelf picture (bottles, jars, books ...) standing on a shelf board along x or z. */
  shelfRow(a: V3, b: V3, h: number, kind: Parameters<typeof rowTex>[0], seed: number, face: number): void {
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const m = M.cutout(`ik_row_${kind}_${seed % 4}`, () => rowTex(kind, seed % 4));
    const pl = new THREE.PlaneGeometry(len, h);
    const uv = pl.getAttribute("uv") as THREE.BufferAttribute;
    const rep = len / (h * 4);
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * rep);
    const mesh = new THREE.Mesh(pl, m);
    mesh.position.set((a[0] + b[0]) / 2, a[1] + h / 2, (a[2] + b[2]) / 2);
    mesh.rotation.y = face;
    this.b.group.add(mesh);
  }

  /** A hanging oil lamp or a gas globe (a brass font, a glass that glows), with its light; returns the light. */
  lamp(x: number, y: number, z: number, top: number, kind: "oil" | "globe" | "lantern" | "green", lights: THREE.PointLight[], glows: THREE.Sprite[], power = 8): void {
    this.b.cyl(0.012, Math.max(0.05, top - y - 0.15), x, (top + y + 0.15) / 2, z, M.iron(), false, 4);
    if (kind === "green") {
      // a billiard lamp: a wide green shade over the table
      const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.45, 0.2, 10, 1, true), lambert("ik_green_shade", { color: 0x2a5a3a, side: THREE.DoubleSide }, 0));
      sh.position.set(x, y + 0.1, z);
      this.b.group.add(sh);
    } else if (kind === "lantern") {
      this.b.box(0.18, 0.26, 0.18, x, y + 0.1, z, M.iron());
    } else this.b.cyl(0.08, 0.08, x, y, z, M.brass(), false, 8);
    // a gas flame behind etched glass glows amber, not white (picture round 2026-09-26: the globes read as flat white discs)
    const glass = new THREE.Mesh(kind === "globe" ? new THREE.SphereGeometry(0.12, 8, 6) : new THREE.CylinderGeometry(0.05, 0.06, 0.18, 6), mat(`ik_lampglass_${kind}`, () => new THREE.MeshBasicMaterial({ color: kind === "globe" ? 0xffc47a : 0xffd490 })));
    glass.position.set(x, y + (kind === "globe" ? 0.16 : kind === "green" ? 0.05 : 0.14), z);
    this.b.group.add(glass);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: kind === "globe" ? 0xffc27c : 0xffb060, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 }));
    glow.scale.set(kind === "globe" ? 1.1 : 0.9, kind === "globe" ? 1.1 : 0.9, 1);
    glow.position.copy(glass.position);
    this.b.group.add(glow);
    glows.push(glow);
    const l = new THREE.PointLight(kind === "globe" ? 0xffd8a8 : 0xffb070, power, 10, 1.5);
    l.position.set(x, y + 0.1, z);
    this.b.group.add(l);
    lights.push(l);
  }

  /** A cast-iron stove with a pipe up to the ceiling (and its glow). */
  stove(x: number, z: number, y: number, top: number): THREE.Vector3 {
    this.b.cyl(0.26, 0.75, x, y + 0.5, z, M.iron(), false, 10);
    this.b.box(0.62, 0.12, 0.62, x, y + 0.06, z, M.iron());
    this.b.cyl(0.29, 0.06, x, y + 0.9, z, M.iron(), false, 10);
    this.b.cyl(0.06, top - y - 0.9, x, (top + y + 0.9) / 2, z, M.iron(), false, 6);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.12), M.glow(0xff8a30));
    door.position.set(x, y + 0.42, z + 0.262);
    this.b.group.add(door);
    this.b.boxes.push({ minX: x - 0.4, maxX: x + 0.4, minZ: z - 0.4, maxZ: z + 0.4 });
    return new THREE.Vector3(x, y + 0.45, z + 0.3);
  }

  /** A flat picture on a wall (poster, painting, chart), with a frame if asked. ry: the way it faces. */
  wallPic(x: number, y: number, z: number, w: number, h: number, ry: number, m: THREE.Material, frame?: THREE.Material): void {
    const out = 0.012;
    const nx = Math.sin(ry);
    const nz = Math.cos(ry);
    this.b.plane(w, h, x + nx * out, y, z + nz * out, ry, m);
    if (frame) {
      const f = 0.05;
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.y = ry;
      for (const [bw, bh, px, py] of [[w + 2 * f, f, 0, h / 2 + f / 2], [w + 2 * f, f, 0, -h / 2 - f / 2], [f, h, -w / 2 - f / 2, 0], [f, h, w / 2 + f / 2, 0]] as Array<[number, number, number, number]>) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.04), frame);
        b.position.set(px, py, 0.02);
        g.add(b);
      }
      this.b.group.add(g);
    }
  }

  /**
   * A wall clock: its face as a wall picture (clockFaceTex, no painted hands) and live hands on it that
   * show the game's time (world/clockHands.ts). w: the picture's size; the face is 14/16 of its half.
   */
  clock(x: number, y: number, z: number, w: number, ry: number, face: THREE.Material, kind: string, frame?: THREE.Material): void {
    this.wallPic(x, y, z, w, w, ry, face, frame);
    const nx = Math.sin(ry);
    const nz = Math.cos(ry);
    const R = (w / 2) * 0.875;
    addDial(this.b.group, { at: [x + nx * 0.012, y, z + nz * 0.012], ry, radius: R, lift: 0.004, mat: M.iron(), minute: 0.76, hour: 0.5, width: 0.16, kind });
  }
}
