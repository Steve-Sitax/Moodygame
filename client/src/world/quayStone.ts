import * as THREE from "three";

// Quays pass 2 (Steve, 2026-09-25: "make the kaaien with better graphics and more detail"): the quay walls
// and their edge stones, painted by script at 64 px a metre. The wall is dressed bluestone in courses, with
// recessed mortar, chisel pitting, lime and rust running down from the joints and moss in them; the slime
// and the wet band by the water come on top from the wall's vertex colours (city.ts). The coping is a row
// of long granite stones, worn light on top and rounded at the water's edge.

function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function finish(c: HTMLCanvasElement, wrapT: THREE.Wrapping): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = wrapT;
  return t;
}

/**
 * A painted texture now, swapped for a picture from client/public/textures when that has loaded (the pictures
 * were made with Codex image generation, assets/ATTRIBUTION.md). If it fails, the painted one stays.
 */
export function withPicture(tex: THREE.Texture, url: string): THREE.Texture {
  const img = new Image();
  img.onload = () => {
    tex.image = img;
    tex.needsUpdate = true;
  };
  img.onerror = () => console.warn("texture picture did not load", url);
  img.src = url;
  return tex;
}

/** The quay wall face: one tile is 4 x 4 m (256 px), u along the wall, v up. Tiles both ways. */
export function quayWallTexture(): THREE.CanvasTexture {
  const n = 256;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d")!;
  const img = g.createImageData(n, n);
  const r = rand(1880);
  const put = (x: number, y: number, rgb: [number, number, number]) => {
    const i = ((((y % n) + n) % n) * n + (((x % n) + n) % n)) * 4;
    img.data[i] = Math.max(0, Math.min(255, rgb[0]));
    img.data[i + 1] = Math.max(0, Math.min(255, rgb[1]));
    img.data[i + 2] = Math.max(0, Math.min(255, rgb[2]));
    img.data[i + 3] = 255;
  };
  // mortar everywhere first: dark, a little green
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) put(x, y, [34 + r() * 8, 37 + r() * 8, 33 + r() * 6]);
  // courses of 0.4 to 0.6 m (they add up to the tile), each with its own bond
  const courses = [32, 36, 28, 34, 30, 36, 28, 32];
  let y0 = 0;
  for (const ch of courses) {
    let x = Math.floor(r() * 80);
    const xEnd = x + n;
    while (x < xEnd) {
      const w = Math.min(xEnd - x, 56 + Math.floor(r() * 56));
      // no sliver at the end of the course: the last stone takes the rest
      const last = xEnd - x - w < 30;
      const sw = (last ? xEnd - x : w) - 2;
      const sh = ch - 2;
      // bluestone, now and then a browner stone (repairs, another quarry)
      const k = r();
      const v = 78 + r() * 34;
      const base: [number, number, number] = k < 0.7 ? [v * 0.9, v * 0.95, v] : k < 0.9 ? [v * 1.02, v * 0.96, v * 0.86] : [v * 0.7, v * 0.72, v * 0.74];
      const pitSeed = r() * 1000;
      for (let py = 0; py < sh; py++) {
        for (let px = 0; px < sw; px++) {
          // light from above: the top edge of a stone lighter, the bottom edge and the right a shade darker
          let f = 1;
          if (py < 2) f *= 1.16;
          else if (py > sh - 3) f *= 0.74;
          if (px < 1) f *= 1.06;
          else if (px > sw - 2) f *= 0.85;
          // the face bulges a little (rock-faced): darker toward the edges
          const ex = Math.min(px, sw - px) / 10;
          const ey = Math.min(py, sh - py) / 7;
          f *= 0.86 + 0.14 * Math.min(1, Math.min(ex, ey));
          // chisel pitting, and weathered blotches across the face
          const pit = Math.sin((px + pitSeed) * 1.7) * Math.sin((py + pitSeed) * 2.3) > 0.82 ? 0.78 : 1;
          const blotch = 0.88 + 0.24 * (0.5 + 0.25 * Math.sin((px + pitSeed) * 0.21) + 0.25 * Math.sin((py - pitSeed) * 0.33 + px * 0.07));
          f *= blotch;
          const grain = (r() - 0.5) * 26;
          put(x + 1 + px, y0 + 1 + py, [base[0] * f * pit + grain, base[1] * f * pit + grain, base[2] * f * pit + grain]);
        }
      }
      x += last ? xEnd - x : w;
    }
    y0 += ch;
  }
  g.putImageData(img, 0, 0);
  // runs down the face from the joints: lime (white), rust and wet (dark); moss in the joints
  const streak = (x: number, y: number, len: number, col: string, wide: number) => {
    const gr = g.createLinearGradient(0, y, 0, y + len);
    gr.addColorStop(0, col);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    // (the canvas' top row is the top of the tile: a run down the wall is down the canvas)
    g.fillRect(x, y, wide, len);
  };
  for (let i = 0; i < 34; i++) streak(Math.floor(r() * (n - 3)), Math.floor(r() * n * 0.6), 20 + r() * 70, "rgba(215,218,205,0.38)", 1 + Math.floor(r() * 3));
  for (let i = 0; i < 40; i++) streak(Math.floor(r() * (n - 3)), Math.floor(r() * n * 0.7), 30 + r() * 110, "rgba(10,12,10,0.45)", 1 + Math.floor(r() * 5));
  for (let i = 0; i < 12; i++) streak(Math.floor(r() * (n - 3)), Math.floor(r() * n * 0.6), 20 + r() * 60, "rgba(125,60,26,0.42)", 1 + Math.floor(r() * 2));
  // moss and weeds in the joints, more low down
  y0 = 0;
  for (const ch of courses) {
    const jy = y0; // the mortar joint over this course
    for (let i = 0; i < 60; i++) {
      const low = y0 / n;
      if (r() > 0.3 + low * 0.6) continue;
      const x = Math.floor(r() * n);
      const w = 2 + Math.floor(r() * 10);
      g.fillStyle = `rgba(${40 + r() * 22},${62 + r() * 30},${26 + r() * 12},${0.6 + r() * 0.35})`;
      g.fillRect(x, (jy + n - 1) % n, w, 2 + Math.floor(r() * 3));
      // a tuft hangs down over the stone below
      if (r() < 0.3) g.fillRect(x + Math.floor(w / 3), (jy + n + 1) % n, Math.max(1, Math.floor(w / 3)), 2 + Math.floor(r() * 4));
    }
    y0 += ch;
  }
  return finish(c, THREE.RepeatWrapping);
}

/** The coping: u along the quay (one tile = 4 m, 256 px), v across the stone (0 = the land side, 1 = the water's edge). */
export function copingTexture(): THREE.CanvasTexture {
  const n = 256;
  const h = 32;
  const c = document.createElement("canvas");
  c.width = n;
  c.height = h;
  const g = c.getContext("2d")!;
  const img = g.createImageData(n, h);
  const r = rand(1881);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = 30;
    img.data[i + 1] = 29;
    img.data[i + 2] = 27;
    img.data[i + 3] = 255;
  }
  let x = 0;
  while (x < n) {
    const w = Math.min(n - x, 58 + Math.floor(r() * 44));
    const last = n - x - w < 40;
    const sw = (last ? n - x : w) - 2;
    const v = 90 + r() * 30;
    const warm = r() * 8;
    for (let py = 0; py < h; py++) {
      // v = 0 at the canvas bottom (the land side), 1 at the top (the edge): worn and rounded there
      const across = 1 - py / (h - 1);
      let f = 1;
      if (across > 0.86) f *= 0.72 + (1 - across) * 1.2; // the rounded nose falls away into shade
      else if (across > 0.55) f *= 1.08; // polished where the ropes and feet go
      if (across < 0.06) f *= 0.8;
      for (let px = 0; px < sw; px++) {
        let e = 1;
        if (px < 1) e = 1.08;
        else if (px > sw - 2) e = 0.8;
        const grain = (r() - 0.5) * 18;
        const i = (py * n + x + 1 + px) * 4;
        img.data[i] = Math.max(0, Math.min(255, (v + warm) * f * e + grain));
        img.data[i + 1] = Math.max(0, Math.min(255, (v + warm * 0.5) * f * e + grain));
        img.data[i + 2] = Math.max(0, Math.min(255, (v - 4) * f * e + grain));
      }
    }
    x += last ? n - x : w;
  }
  g.putImageData(img, 0, 0);
  // rope wear and chips along the edge, a few dark wet spots
  for (let i = 0; i < 40; i++) {
    g.fillStyle = r() < 0.5 ? "rgba(20,18,16,0.35)" : "rgba(220,215,200,0.18)";
    g.fillRect(Math.floor(r() * n), Math.floor(r() * 6), 1 + Math.floor(r() * 4), 1 + Math.floor(r() * 2));
  }
  for (let i = 0; i < 8; i++) {
    const cx = r() * n;
    const cy = 8 + r() * 20;
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, 5 + r() * 8);
    gr.addColorStop(0, "rgba(16,16,14,0.35)");
    gr.addColorStop(1, "rgba(16,16,14,0)");
    g.fillStyle = gr;
    g.fillRect(cx - 14, cy - 14, 28, 28);
  }
  return finish(c, THREE.ClampToEdgeWrapping);
}
