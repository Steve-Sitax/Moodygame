import * as THREE from "three";

// Placeholder textures, painted in code at 64x64. Crushed and dirty on purpose.
// No third-party images. Replace with the Blender kit later (docs/05).

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

type Painter = (g: CanvasRenderingContext2D, r: () => number, s: number) => void;

function make(size: number, seed: number, paint: Painter): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  paint(g, rng(seed), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function rgb(r: number, g: number, b: number, a = 1): string {
  return `rgba(${r | 0},${g | 0},${b | 0},${a})`;
}

/** Speckle noise over the whole canvas. */
function grime(g: CanvasRenderingContext2D, r: () => number, s: number, amount: number, dark = true): void {
  for (let i = 0; i < s * s * amount; i++) {
    const v = dark ? 0 : 255;
    g.fillStyle = rgb(v, v, v, r() * 0.18);
    g.fillRect((r() * s) | 0, (r() * s) | 0, 1 + ((r() * 2) | 0), 1);
  }
}

export function makeTextures() {
  const cobble = make(64, 11, (g, r, s) => {
    g.fillStyle = rgb(22, 22, 22);
    g.fillRect(0, 0, s, s);
    const rows = 8;
    const h = s / rows;
    for (let y = 0; y < rows; y++) {
      let x = y % 2 ? -4 : 0;
      while (x < s) {
        const w = 6 + ((r() * 5) | 0);
        const v = 58 + r() * 30;
        g.fillStyle = rgb(v, v * 0.98, v * 0.93);
        g.fillRect(x + 1, y * h + 1, w - 1, h - 1);
        // relief painted in (the PS1 way: it reads in any light): a lit top and left edge,
        // a shaded lower and right edge, a darker joint below
        g.fillStyle = rgb(v + 22, v + 21, v + 17);
        g.fillRect(x + 1, y * h + 1, w - 2, 1);
        g.fillRect(x + 1, y * h + 1, 1, h - 2);
        g.fillStyle = rgb(v * 0.62, v * 0.6, v * 0.57);
        g.fillRect(x + 1, y * h + h - 1, w - 1, 1);
        g.fillRect(x + w - 1, y * h + 1, 1, h - 1);
        x += w;
      }
    }
    grime(g, r, s, 0.5);
  });

  const quayWall = make(64, 12, (g, r, s) => {
    g.fillStyle = rgb(28, 30, 28);
    g.fillRect(0, 0, s, s);
    for (let y = 0; y < 4; y++) {
      for (let x = -1; x < 3; x++) {
        const ox = x * 24 + (y % 2) * 12;
        const v = 60 + r() * 22;
        g.fillStyle = rgb(v * 0.92, v, v * 0.9);
        g.fillRect(ox + 1, y * 16 + 1, 22, 14);
      }
    }
    // green slime toward the bottom
    for (let i = 0; i < 260; i++) {
      const y = s - Math.pow(r(), 2) * s * 0.6;
      g.fillStyle = rgb(30, 48 + r() * 20, 30, 0.5);
      g.fillRect((r() * s) | 0, y | 0, 2, 2);
    }
    grime(g, r, s, 0.4);
  });

  const brick = make(64, 13, (g, r, s) => {
    g.fillStyle = rgb(48, 40, 34);
    g.fillRect(0, 0, s, s);
    const bh = 8;
    for (let y = 0; y < s / bh; y++) {
      for (let x = -1; x < 5; x++) {
        const ox = x * 16 + (y % 2) * 8;
        const v = 70 + r() * 30;
        g.fillStyle = rgb(v * 1.15, v * 0.62, v * 0.45);
        g.fillRect(ox + 1, y * bh + 1, 15, bh - 1);
      }
    }
    // soot streaks down from the top
    for (let i = 0; i < 18; i++) {
      const x = (r() * s) | 0;
      const len = (r() * s * 0.7) | 0;
      g.fillStyle = rgb(10, 10, 10, 0.25);
      g.fillRect(x, 0, 1 + ((r() * 2) | 0), len);
    }
    grime(g, r, s, 0.5);
  });

  const planks = make(64, 14, (g, r, s) => {
    const n = 5;
    const w = s / n;
    for (let i = 0; i < n; i++) {
      const v = 55 + r() * 25;
      g.fillStyle = rgb(v * 1.05, v * 0.9, v * 0.72);
      g.fillRect(i * w, 0, w, s);
      g.fillStyle = rgb(14, 12, 10);
      g.fillRect(i * w, 0, 1, s);
      // grain
      for (let k = 0; k < 10; k++) {
        g.fillStyle = rgb(20, 16, 12, 0.3);
        g.fillRect(i * w + 2 + ((r() * (w - 3)) | 0), (r() * s) | 0, 1, 4 + ((r() * 14) | 0));
      }
      // seam across the plank
      const sy = (r() * s) | 0;
      g.fillStyle = rgb(14, 12, 10);
      g.fillRect(i * w, sy, w, 1);
      g.fillStyle = rgb(30, 30, 30);
      g.fillRect(i * w + 2, sy + 2, 1, 1);
    }
    grime(g, r, s, 0.4);
  });

  const water = make(64, 15, (g, r, s) => {
    g.fillStyle = rgb(58, 70, 62);
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 140; i++) {
      const v = r() < 0.5 ? 40 : 88;
      g.fillStyle = rgb(v * 0.9, v * 1.05, v, 0.6);
      g.fillRect((r() * s) | 0, (r() * s) | 0, 3 + ((r() * 8) | 0), 1);
    }
  });

  const iron = make(64, 16, (g, r, s) => {
    g.fillStyle = rgb(26, 26, 28);
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 120; i++) {
      g.fillStyle = rgb(80 + r() * 30, 40, 22, 0.35);
      g.fillRect((r() * s) | 0, (r() * s) | 0, 1 + ((r() * 3) | 0), 1 + ((r() * 3) | 0));
    }
    // rivets
    for (let y = 4; y < s; y += 16)
      for (let x = 4; x < s; x += 16) {
        g.fillStyle = rgb(50, 50, 50);
        g.fillRect(x, y, 2, 2);
      }
    grime(g, r, s, 0.3);
  });

  const hull = make(64, 17, (g, r, s) => {
    g.fillStyle = rgb(30, 27, 24);
    g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 6) {
      g.fillStyle = rgb(8, 8, 8);
      g.fillRect(0, y, s, 1);
      g.fillStyle = rgb(30, 26, 22, 0.6);
      g.fillRect(0, y + 1, s, 1);
    }
    for (let i = 0; i < 80; i++) {
      g.fillStyle = rgb(60, 50, 40, 0.25);
      g.fillRect((r() * s) | 0, (r() * s) | 0, 4, 1);
    }
  });

  const crate = make(64, 18, (g, r, s) => {
    g.fillStyle = rgb(78, 62, 42);
    g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 12) {
      g.fillStyle = rgb(30, 22, 14);
      g.fillRect(0, y, s, 1);
    }
    g.fillStyle = rgb(58, 44, 28);
    g.fillRect(0, 0, s, 6);
    g.fillRect(0, s - 6, s, 6);
    g.fillRect(0, 0, 6, s);
    g.fillRect(s - 6, 0, 6, s);
    // diagonal brace
    for (let i = 0; i < s; i++) g.fillRect(i, i, 5, 1);
    grime(g, r, s, 0.5);
  });

  const slate = make(64, 19, (g, r, s) => {
    g.fillStyle = rgb(20, 22, 26);
    g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 8)
      for (let x = (y / 8) % 2 ? -4 : 0; x < s; x += 8) {
        const v = 36 + r() * 16;
        g.fillStyle = rgb(v * 0.9, v * 0.95, v * 1.05);
        g.fillRect(x + 1, y + 1, 7, 6);
      }
    grime(g, r, s, 0.3);
  });

  const sack = make(64, 20, (g, r, s) => {
    g.fillStyle = rgb(96, 84, 62);
    g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 2)
      for (let x = (y / 2) % 2; x < s; x += 2) {
        g.fillStyle = rgb(70, 60, 44, 0.5);
        g.fillRect(x, y, 1, 1);
      }
    grime(g, r, s, 0.6);
  });

  const rope = make(32, 21, (g, _r, s) => {
    g.fillStyle = rgb(90, 76, 52);
    g.fillRect(0, 0, s, s);
    for (let i = -s; i < s; i += 4) {
      g.fillStyle = rgb(48, 40, 26);
      for (let k = 0; k < s; k++) g.fillRect(i + k, k, 1, 1);
    }
  });

  // (the bump audit, 2026-09-26: each named for what it shows, for its bump from its own picture: world/bumps.ts)
  const all = { cobble, quayWall, brick, planks, water, iron, hull, crate, slate, sack, rope };
  for (const [k, t] of Object.entries(all)) t.name = k;
  return all;
}

export type Textures = ReturnType<typeof makeTextures>;

/** Painted sign on a warehouse, e.g. HESSENATIE. */
export function signTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 32;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1a1714";
  g.fillRect(0, 0, 256, 32);
  g.fillStyle = "#b8ab8a";
  g.font = "bold 22px 'Scheldemist Print', Georgia, serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 128, 17);
  // flaking paint
  const r = rng(text.length * 97);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = "rgba(26,23,20,0.8)";
    g.fillRect((r() * 256) | 0, (r() * 32) | 0, 2, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.name = "sign"; // (the bump audit: lettering stays flat, world/bumps.ts)
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

/**
 * Soft round glow for the lamp glass (additive sprite). 2026-09-30 (Steve: "big orange glow circles ... Make it more
 * realistic"): a bright small core that falls off smoothly to nothing, filtered smooth: no hard orange disc.
 */
export function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,232,180,1)");
  grad.addColorStop(0.12, "rgba(255,200,120,0.75)");
  grad.addColorStop(0.35, "rgba(255,160,70,0.22)");
  grad.addColorStop(0.7, "rgba(255,140,60,0.05)");
  grad.addColorStop(1, "rgba(255,140,60,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}
