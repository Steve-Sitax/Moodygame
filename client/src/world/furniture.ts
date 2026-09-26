import * as THREE from "three";
import { canvasTex, lambert, mat, tex } from "./rooms";
import { glowTexture } from "./textures";
import { addDial } from "./clockHands";

// Furniture for the rented rooms (M6 homes), made in code the PS1 way: a few boxes, painted
// 32-64 px textures. Every piece is a group with its origin at the middle of its footprint on
// the floor, its front toward +z. Wall pieces have their back at z = 0 (the wall) and hang at
// their own height; the hanging lamp hangs from `ceiling`. A piece that gives light or heat
// says where (`light`), so the room can light it.

export interface Piece {
  group: THREE.Group;
  /** A light the piece makes (a lamp, a stove's fire), in the piece's own frame. */
  light?: { x: number; y: number; z: number; color: number; power: number; glow?: THREE.Sprite };
}

const wood = () => lambert("f_wood", { map: tex().planks, color: 0x8a6446 });
const dark = () => lambert("f_dark", { map: tex().planks, color: 0x4a3424 });
const iron = () => lambert("f_iron", { color: 0x26221e });
const brass = () => lambert("f_brass", { color: 0x9a7a34 });

function flat(color: number): THREE.Material {
  return lambert(`f_col_${color.toString(16)}`, { color });
}

function clothTex(key: string, base: string, stripe: string, every = 6): THREE.Material {
  return mat(`f_cloth_${key}`, () => {
    const t = canvasTex(32, 32, (g) => {
      g.fillStyle = base;
      g.fillRect(0, 0, 32, 32);
      g.fillStyle = stripe;
      for (let y = 0; y < 32; y += every) g.fillRect(0, y, 32, 2);
      for (let i = 0; i < 60; i++) {
        g.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.08})`;
        g.fillRect(Math.random() * 32, Math.random() * 32, 2, 1);
      }
    });
    return new THREE.MeshLambertMaterial({ map: t });
  });
}

function straw(): THREE.Material {
  return mat("f_straw", () => {
    const t = canvasTex(32, 32, (g) => {
      g.fillStyle = "#9a8248";
      g.fillRect(0, 0, 32, 32);
      for (let i = 0; i < 120; i++) {
        const v = 110 + Math.random() * 80;
        g.fillStyle = `rgb(${v},${v * 0.84},${v * 0.45})`;
        g.fillRect(Math.random() * 32, Math.random() * 32, 3 + Math.random() * 5, 1);
      }
    });
    return new THREE.MeshLambertMaterial({ map: t });
  });
}

function rag(): THREE.Material {
  return mat("f_rag", () => {
    const cols = ["#6a3a2a", "#3a4a5a", "#7a6a4a", "#4a5a3a", "#5a2a2a", "#8a7a5a"];
    const t = canvasTex(32, 32, (g) => {
      for (let y = 0; y < 32; y += 2) {
        g.fillStyle = cols[(y / 2 + ((y * 7) % 3)) % cols.length];
        g.fillRect(0, y, 32, 2);
      }
      g.strokeStyle = "#2a1a12";
      g.strokeRect(1, 1, 30, 30);
    }, false);
    return new THREE.MeshLambertMaterial({ map: t });
  });
}

function printTex(): THREE.Material {
  return mat("f_print", () => {
    const t = canvasTex(32, 40, (g) => {
      g.fillStyle = "#1a1612";
      g.fillRect(0, 0, 32, 40);
      g.fillStyle = "#c8bc9a";
      g.fillRect(3, 3, 26, 34);
      g.fillStyle = "#6a6258";
      g.fillRect(14, 8, 4, 24);
      g.beginPath();
      g.moveTo(14, 8);
      g.lineTo(16, 2);
      g.lineTo(18, 8);
      g.fill();
      for (let x = 4; x < 28; x += 4) g.fillRect(x, 28 - ((x * 3) % 7), 3, 8 + ((x * 3) % 7));
    }, false);
    return new THREE.MeshLambertMaterial({ map: t });
  });
}

/** A clock's face: the ring and the marks, no hands (live hands: world/clockHands.ts). The face is 12/16 of the half width. */
function dialTex(): THREE.Material {
  return mat("f_dial", () => {
    const t = canvasTex(32, 32, (g) => {
      g.fillStyle = "#3a2618";
      g.fillRect(0, 0, 32, 32);
      g.fillStyle = "#e0d6bc";
      g.beginPath();
      g.arc(16, 16, 12, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#1a1612";
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        g.fillRect(16 + Math.sin(a) * 10 - 0.5, 16 - Math.cos(a) * 10 - 0.5, 1.5, 1.5);
      }
    }, false);
    return new THREE.MeshLambertMaterial({ map: t });
  });
}

function tiles(): THREE.Material {
  return mat("f_tiles", () => {
    const t = canvasTex(32, 32, (g) => {
      g.fillStyle = "#6a6258";
      g.fillRect(0, 0, 32, 32);
      for (let y = 0; y < 32; y += 8)
        for (let x = 0; x < 32; x += 8) {
          g.fillStyle = (x + y) % 16 ? "#d8d0bc" : "#ccc2aa";
          g.fillRect(x + 1, y + 1, 6, 6);
          g.fillStyle = "#3a5a7a";
          g.fillRect(x + 3, y + 3, 2, 2);
        }
    });
    return new THREE.MeshLambertMaterial({ map: t });
  });
}

function velvet(which: "red" | "green"): THREE.Material {
  return which === "red" ? clothTex("velvet_red", "#6a1a18", "#5a1210", 8) : clothTex("velvet_green", "#23402c", "#1a3222", 8);
}

function booksTex(): THREE.Material {
  return mat("f_books", () => {
    const cols = ["#5a2a1c", "#2a3a4a", "#3a4a2a", "#6a5a3a", "#4a2030", "#2a2a2a", "#7a4a2a"];
    const t = canvasTex(32, 64, (g) => {
      g.fillStyle = "#1e140e";
      g.fillRect(0, 0, 32, 64);
      for (let row = 0; row < 5; row++) {
        const y0 = row * 13 + 2;
        let x = 1;
        while (x < 31) {
          const w = 2 + Math.floor(Math.random() * 3);
          const h = 8 + Math.floor(Math.random() * 3);
          g.fillStyle = cols[Math.floor(Math.random() * cols.length)];
          g.fillRect(x, y0 + 11 - h, w, h);
          g.fillStyle = "rgba(210,170,80,0.7)";
          g.fillRect(x, y0 + 11 - h + 2, w, 1);
          x += w;
        }
        g.fillStyle = "#3a2618";
        g.fillRect(0, y0 + 11, 32, 2);
      }
    }, false);
    return new THREE.MeshLambertMaterial({ map: t });
  });
}

function mirrorTex(): THREE.Material {
  return mat("f_mirror", () => {
    const t = canvasTex(32, 32, (g) => {
      const gr = g.createLinearGradient(0, 0, 32, 32);
      gr.addColorStop(0, "#8a9aa0");
      gr.addColorStop(0.5, "#5a6a70");
      gr.addColorStop(1, "#3a4448");
      g.fillStyle = gr;
      g.fillRect(0, 0, 32, 32);
      g.fillStyle = "rgba(255,240,210,0.25)";
      g.fillRect(4, 3, 3, 24);
      g.fillRect(9, 5, 1, 18);
    }, false);
    return new THREE.MeshBasicMaterial({ map: t });
  });
}

class B {
  readonly group = new THREE.Group();
  box(w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    return mesh;
  }
  cyl(r0: number, r1: number, h: number, x: number, y: number, z: number, m: THREE.Material, seg = 8): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), m);
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    return mesh;
  }
  /** Four legs under a top of w by d at height h. */
  legs(w: number, d: number, h: number, t: number, m: THREE.Material): void {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.box(t, h, t, sx * (w / 2 - t / 2), h / 2, sz * (d / 2 - t / 2), m);
  }
}

function glow(color: number, size: number): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 }));
  s.scale.set(size, size, 1);
  return s;
}

/** Make a piece by its kind (the dealer's ten and the rooms' own furniture). */
export function makePiece(kind: string, ceiling = 2.6): Piece {
  const b = new B();
  const g = b.group;
  let light: Piece["light"];
  switch (kind) {
    case "bed_straw": {
      b.box(0.9, 0.14, 1.9, 0, 0.07, 0, straw());
      b.box(0.8, 0.05, 1.1, 0, 0.16, 0.3, clothTex("blanket_grey", "#5a5650", "#4a4640", 5));
      b.box(0.35, 0.08, 0.25, 0, 0.18, -0.75, clothTex("sack", "#8a7a5a", "#7a6a4a", 4));
      break;
    }
    case "bed_plank": {
      b.box(0.92, 0.1, 1.95, 0, 0.3, 0, wood());
      b.legs(0.92, 1.95, 0.25, 0.08, dark());
      b.box(0.85, 0.12, 1.85, 0, 0.41, 0, straw());
      b.box(0.8, 0.05, 1.1, 0, 0.49, 0.3, clothTex("blanket_brown", "#5a4432", "#4a3424", 5));
      b.box(0.4, 0.08, 0.25, 0, 0.51, -0.75, clothTex("sack", "#8a7a5a", "#7a6a4a", 4));
      break;
    }
    case "bed": {
      b.box(0.95, 0.12, 1.95, 0, 0.36, 0, wood());
      b.legs(0.95, 1.95, 0.3, 0.07, dark());
      b.box(0.95, 0.9, 0.06, 0, 0.45, -0.97, dark());
      b.box(0.95, 0.5, 0.06, 0, 0.25, 0.97, dark());
      b.box(0.88, 0.14, 1.85, 0, 0.49, 0, flat(0xd8d2c0));
      b.box(0.86, 0.06, 1.2, 0, 0.58, 0.3, clothTex("quilt_blue", "#3a4a6a", "#5a6a8a", 6));
      b.box(0.5, 0.1, 0.3, 0, 0.61, -0.72, flat(0xe8e2d0));
      break;
    }
    case "bed_fine": {
      b.box(1.4, 0.14, 1.95, 0, 0.42, 0, dark());
      for (const [x, z] of [[-0.67, -0.95], [0.67, -0.95], [-0.67, 0.95], [0.67, 0.95]]) b.box(0.08, z < 0 ? 1.7 : 1.1, 0.08, x, z < 0 ? 0.85 : 0.55, z, dark());
      b.box(1.4, 1.0, 0.05, 0, 0.9, -0.96, dark());
      b.box(1.32, 0.16, 1.85, 0, 0.57, 0, flat(0xe2dccc));
      b.box(1.3, 0.07, 1.25, 0, 0.67, 0.28, clothTex("quilt_red", "#7a2a22", "#9a4a32", 5));
      for (const x of [-0.33, 0.33]) b.box(0.5, 0.12, 0.3, x, 0.71, -0.72, flat(0xf0eadc));
      break;
    }
    case "bedstee": {
      // a Flemish box bed built into the back wall: a cupboard front with an opening and curtains
      const W = 1.95;
      const D = 0.95;
      const H = Math.min(2.2, ceiling - 0.05);
      b.box(W, H, 0.06, 0, H / 2, -D / 2, dark());
      b.box(0.06, H, D, -W / 2, H / 2, 0, dark());
      b.box(0.06, H, D, W / 2, H / 2, 0, dark());
      b.box(W, 0.06, D, 0, H - 0.03, 0, dark());
      // the front: a low board, the opening, a frieze
      b.box(W, 0.5, 0.05, 0, 0.25, D / 2, wood());
      b.box(W, H - 1.75, 0.05, 0, (H + 1.75) / 2, D / 2, wood());
      b.box(W - 0.1, 0.16, D - 0.1, 0, 0.55, 0, straw());
      b.box(W - 0.2, 0.06, D - 0.2, 0, 0.66, 0.05, clothTex("blanket_brown", "#5a4432", "#4a3424", 5));
      for (const s of [-1, 1]) b.box(0.5, 1.2, 0.03, s * 0.7, 1.15, D / 2 + 0.03, clothTex("bedcurtain", "#6a5a3a", "#5a4a2a", 3));
      break;
    }
    case "crate": {
      const m = lambert("f_crate", { map: tex().crate, color: 0xb09070 });
      b.box(0.46, 0.44, 0.46, 0, 0.22, 0, m);
      // a candle stub on it
      b.cyl(0.02, 0.02, 0.08, 0.1, 0.48, 0.05, flat(0xd8d0b8), 5);
      const s = glow(0xffb050, 0.28);
      s.position.set(0.1, 0.56, 0.05);
      g.add(s);
      light = { x: 0.1, y: 0.6, z: 0.05, color: 0xffa050, power: 3.2, glow: s };
      break;
    }
    case "chest": {
      b.box(0.46, 0.4, 0.4, 0, 0.2, 0, wood());
      for (const x of [-0.15, 0.15]) b.box(0.04, 0.42, 0.42, x, 0.2, 0, iron());
      break;
    }
    case "washstand": {
      b.box(0.46, 0.05, 0.4, 0, 0.78, 0, wood());
      b.legs(0.46, 0.4, 0.76, 0.05, dark());
      b.box(0.42, 0.04, 0.36, 0, 0.2, 0, wood());
      b.cyl(0.16, 0.1, 0.08, 0, 0.84, 0, flat(0xe8e4d8), 10);
      b.cyl(0.06, 0.07, 0.22, 0.12, 0.95, 0.08, flat(0xe0dccc), 8);
      break;
    }
    case "chair":
    case "chair_plain": {
      const m = kind === "chair" ? wood() : dark();
      b.box(0.42, 0.04, 0.4, 0, 0.44, 0, kind === "chair" ? straw() : m);
      b.legs(0.42, 0.4, 0.42, 0.04, m);
      for (const x of [-0.19, 0.19]) b.box(0.04, 0.5, 0.04, x, 0.7, -0.18, m);
      for (const y of [0.62, 0.8]) b.box(0.38, 0.05, 0.03, 0, y, -0.18, m);
      break;
    }
    case "table": {
      b.box(0.92, 0.05, 0.92, 0, 0.74, 0, lambert("f_deal", { map: tex().planks, color: 0xb09878 }));
      b.legs(0.86, 0.86, 0.72, 0.06, wood());
      b.cyl(0.07, 0.06, 0.1, 0.15, 0.81, -0.1, flat(0x5a4a3a), 8);
      break;
    }
    case "table_fine": {
      b.box(0.95, 0.05, 0.95, 0, 0.76, 0, dark());
      b.legs(0.88, 0.88, 0.74, 0.07, dark());
      b.box(0.98, 0.02, 0.98, 0, 0.79, 0, flat(0xdcd4c0));
      b.cyl(0.05, 0.07, 0.18, 0, 0.89, 0, brass(), 8);
      break;
    }
    case "rug": {
      b.box(1.4, 0.015, 0.95, 0, 0.008, 0, rag());
      break;
    }
    case "stove": {
      b.cyl(0.22, 0.24, 0.55, 0, 0.42, 0, iron(), 10);
      b.cyl(0.26, 0.26, 0.05, 0, 0.72, 0, iron(), 10);
      for (const [x, z] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) b.box(0.05, 0.16, 0.05, x, 0.08, z, iron());
      // the pipe, up to the ceiling
      const top = ceiling - 0.75;
      b.cyl(0.06, 0.06, top, 0, 0.75 + top / 2, -0.1, iron(), 6);
      // the fire behind the little door
      b.box(0.14, 0.1, 0.02, 0, 0.36, 0.235, mat("f_ember", () => new THREE.MeshBasicMaterial({ color: 0xff7a2a })));
      const s = glow(0xff8030, 0.5);
      s.position.set(0, 0.38, 0.3);
      g.add(s);
      light = { x: 0, y: 0.5, z: 0.4, color: 0xff8a40, power: 3.5, glow: s };
      break;
    }
    case "stove_tile": {
      b.box(0.8, 0.2, 0.8, 0, 0.1, 0, dark());
      b.box(0.72, 1.4, 0.72, 0, 0.9, 0, tiles());
      b.box(0.8, 0.08, 0.8, 0, 1.64, 0, flat(0xc8c0a8));
      b.box(0.2, 0.14, 0.02, 0, 0.45, 0.37, mat("f_ember", () => new THREE.MeshBasicMaterial({ color: 0xff7a2a })));
      const s = glow(0xff8030, 0.5);
      s.position.set(0, 0.46, 0.42);
      g.add(s);
      light = { x: 0, y: 0.6, z: 0.6, color: 0xff9a50, power: 3, glow: s };
      break;
    }
    case "hearth": {
      // a small brick fireplace against the wall behind it (-z), its hood up to the ceiling
      const brick = lambert("f_brick", { map: tex().brick, color: 0xa87a68 });
      for (const s of [-1, 1]) b.box(0.18, 0.8, 0.45, s * 0.36, 0.4, -0.02, brick);
      b.box(0.9, 0.18, 0.5, 0, 0.89, -0.02, brick);
      b.box(0.7, ceiling - 1.0, 0.35, 0, 1.0 + (ceiling - 1.0) / 2, -0.08, brick);
      b.box(1.0, 0.06, 0.55, 0, 1.0, 0.0, dark());
      b.box(0.54, 0.62, 0.02, 0, 0.31, -0.23, mat("f_soot", () => new THREE.MeshBasicMaterial({ color: 0x0c0806 })));
      b.box(0.3, 0.08, 0.2, 0, 0.05, -0.08, mat("f_ember", () => new THREE.MeshBasicMaterial({ color: 0xff7a2a })));
      const s = glow(0xff7a30, 0.7);
      s.position.set(0, 0.2, 0.0);
      g.add(s);
      light = { x: 0, y: 0.4, z: 0.3, color: 0xff8a40, power: 4, glow: s };
      break;
    }
    case "wardrobe": {
      b.box(1.0, 1.95, 0.5, 0, 0.98, 0, dark());
      b.box(1.06, 0.08, 0.54, 0, 1.99, 0, dark());
      b.box(0.02, 1.7, 0.02, 0, 0.98, 0.26, flat(0x1a1410));
      for (const x of [-0.06, 0.06]) b.box(0.03, 0.08, 0.03, x, 1.0, 0.27, brass());
      break;
    }
    case "plant": {
      b.cyl(0.13, 0.1, 0.22, 0, 0.11, 0, flat(0xa0583a), 8);
      b.cyl(0.03, 0.03, 0.2, 0, 0.3, 0, flat(0x3a5a2a), 5);
      for (let i = 0; i < 7; i++) {
        const a = i * 0.9;
        const leaf = b.box(0.1, 0.03, 0.1, Math.sin(a) * 0.1, 0.3 + (i % 3) * 0.06, Math.cos(a) * 0.1, flat(0x3a6a2a));
        leaf.rotation.y = a;
      }
      for (const [x, y, z] of [[0.04, 0.46, 0], [-0.06, 0.42, 0.05], [0.02, 0.44, -0.07]]) b.box(0.07, 0.06, 0.07, x, y, z, flat(0xc02a22));
      break;
    }
    case "birdcage": {
      b.cyl(0.18, 0.2, 0.03, 0, 0.015, 0, dark(), 8);
      b.cyl(0.02, 0.02, 1.1, 0, 0.57, 0, dark(), 5);
      b.cyl(0.16, 0.16, 0.02, 0, 1.12, 0, wood(), 10);
      const wire = mat("f_wire", () => new THREE.MeshLambertMaterial({ color: 0x8a7a50, wireframe: true }));
      const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 0.32, 10, 3, true), wire);
      cage.position.set(0, 1.29, 0);
      g.add(cage);
      b.cyl(0.02, 0.02, 0.05, 0, 1.47, 0, brass(), 5);
      // the finch
      b.box(0.05, 0.05, 0.09, 0, 1.2, 0, flat(0x9a5a3a));
      b.box(0.04, 0.04, 0.04, 0, 1.23, 0.05, flat(0x5a6a7a));
      break;
    }
    case "picture": {
      b.box(0.44, 0.54, 0.03, 0, 1.55, 0.015, dark());
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.48), printTex());
      pic.position.set(0, 1.55, 0.032);
      g.add(pic);
      break;
    }
    case "clock": {
      b.box(0.32, 0.42, 0.16, 0, 1.7, 0.08, dark());
      const roof = b.box(0.36, 0.05, 0.18, 0, 1.94, 0.08, dark());
      roof.rotation.z = 0;
      const dial = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24), dialTex());
      dial.position.set(0, 1.74, 0.162);
      g.add(dial);
      addDial(g, { at: [0, 1.74, 0.162], radius: 0.09, lift: 0.004, mat: iron(), minute: 0.84, hour: 0.56, width: 0.15, kind: "wall clock in a home" });
      b.box(0.015, 0.36, 0.015, 0, 1.33, 0.1, brass());
      b.cyl(0.05, 0.05, 0.015, 0, 1.15, 0.1, brass(), 8).rotation.x = Math.PI / 2;
      for (const x of [-0.07, 0.07]) b.cyl(0.02, 0.02, 0.12, x, 1.25, 0.12, iron(), 5);
      break;
    }
    case "curtains": {
      const m = clothTex("curtain_red", "#7a2a22", "#6a2018", 3);
      b.box(1.05, 0.03, 0.03, 0, 2.05, 0.06, iron());
      for (const s of [-1, 1]) b.box(0.3, 1.2, 0.03, s * 0.4, 1.45, 0.08, m);
      break;
    }
    case "lamp": {
      // hangs from the ceiling: a chain, a brass font, a glass chimney that glows
      const y = Math.min(ceiling - 0.55, 2.05);
      b.cyl(0.008, 0.008, ceiling - y - 0.1, 0, (ceiling + y + 0.1) / 2, 0, iron(), 4);
      b.cyl(0.08, 0.09, 0.09, 0, y, 0, brass(), 8);
      b.cyl(0.035, 0.045, 0.16, 0, y + 0.12, 0, mat("f_lampglass", () => new THREE.MeshBasicMaterial({ color: 0xffd490 })), 6);
      const s = glow(0xffb060, 0.8);
      s.position.set(0, y + 0.12, 0);
      g.add(s);
      light = { x: 0, y: y + 0.05, z: 0, color: 0xffb070, power: 6, glow: s };
      break;
    }
    case "alcove": {
      // a panelled partition, the bed behind it; a heavy curtain at the opening (natural -x end)
      const h = Math.min(2.55, ceiling - 0.45);
      const panel = lambert("f_panel", { map: tex().planks, color: 0x5a3a26 });
      b.box(1.95, h, 0.08, 0.02, h / 2, 0, panel);
      b.box(2.05, 0.12, 0.16, 0.02, h + 0.06, 0, dark());
      b.box(1.95, 0.06, 0.1, 0.02, 0.95, 0.02, dark());
      for (const x of [-0.5, 0.5]) b.box(0.6, 0.7, 0.02, x, 1.6, 0.05, dark());
      for (const x of [-0.5, 0.5]) b.box(0.6, 0.6, 0.02, x, 0.45, 0.05, dark());
      b.box(0.34, h - 0.1, 0.06, -1.0, (h - 0.1) / 2, 0.02, velvet("green"));
      break;
    }
    case "bookcase": {
      // tall glazed bookcase against the wall behind it (-z); the books are one painted plane
      b.box(1.0, 2.25, 0.4, 0, 1.125, -0.02, dark());
      b.box(1.08, 0.08, 0.46, 0, 2.29, -0.02, dark());
      const spines = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 1.9), booksTex());
      spines.position.set(0, 1.17, 0.185);
      g.add(spines);
      break;
    }
    case "desk": {
      // a writing desk at the back half (-z), its chair in front (+z), ledgers and an oil lamp
      b.box(1.0, 0.05, 0.55, 0, 0.77, -0.22, dark());
      for (const x of [-0.36, 0.36]) b.box(0.26, 0.74, 0.5, x, 0.37, -0.22, dark());
      b.box(0.44, 0.02, 0.5, 0, 0.79, -0.22, flat(0x2a4a32));
      b.box(0.34, 0.05, 0.25, -0.24, 0.82, -0.28, flat(0x5a2a1c));
      b.box(0.32, 0.05, 0.24, -0.23, 0.87, -0.28, flat(0x2a3a4a));
      b.box(0.36, 0.02, 0.26, 0.05, 0.805, -0.12, flat(0xe0d6bc));
      b.cyl(0.03, 0.03, 0.05, 0.25, 0.82, -0.32, flat(0x1a1612), 6);
      // the chair
      b.box(0.44, 0.05, 0.42, 0, 0.46, 0.25, flat(0x6a2a22));
      for (const [x, z] of [[-0.2, 0.06], [0.2, 0.06], [-0.2, 0.44], [0.2, 0.44]]) b.box(0.04, 0.44, 0.04, x, 0.22, z, dark());
      b.box(0.44, 0.5, 0.05, 0, 0.72, 0.45, dark());
      // the lamp: a brass font and a green shade
      b.cyl(0.05, 0.07, 0.22, 0.34, 0.9, -0.34, brass(), 8);
      b.cyl(0.07, 0.13, 0.1, 0.34, 1.07, -0.34, mat("f_lampshade", () => new THREE.MeshBasicMaterial({ color: 0x5a9a5a })), 8);
      const s = glow(0xffc070, 0.45);
      s.position.set(0.34, 1.02, -0.34);
      g.add(s);
      light = { x: 0.34, y: 1.0, z: -0.2, color: 0xffc070, power: 3, glow: s };
      break;
    }
    case "armchair": {
      const v = velvet("red");
      b.box(0.6, 0.18, 0.56, 0, 0.36, 0, v);
      b.box(0.6, 0.6, 0.14, 0, 0.72, -0.24, v);
      for (const x of [-0.27, 0.27]) b.box(0.08, 0.26, 0.5, x, 0.56, 0.02, v);
      for (const [x, z] of [[-0.25, -0.22], [0.25, -0.22], [-0.25, 0.22], [0.25, 0.22]]) b.box(0.05, 0.27, 0.05, x, 0.135, z, dark());
      break;
    }
    case "mantel": {
      // a grey marble chimneypiece against the wall behind it (-z): the fire, a gilt mirror, a clock
      const marble = lambert("f_marble", { color: 0xb8b2a6 });
      for (const s of [-1, 1]) b.box(0.24, 1.05, 0.34, s * 0.58, 0.525, -0.04, marble);
      b.box(1.5, 0.12, 0.44, 0, 1.11, -0.02, marble);
      b.box(1.4, 0.2, 0.3, 0, 0.95, -0.06, marble);
      b.box(0.92, 0.85, 0.02, 0, 0.43, -0.2, mat("f_soot", () => new THREE.MeshBasicMaterial({ color: 0x0c0806 })));
      b.box(0.5, 0.06, 0.2, 0, 0.05, -0.08, mat("f_ember", () => new THREE.MeshBasicMaterial({ color: 0xff7a2a })));
      b.box(1.5, 0.02, 0.6, 0, 0.01, 0.1, marble);
      // the mirror: a gilt frame and a pale, cloudy glass
      const gilt = lambert("f_gilt", { color: 0xb08a3a });
      b.box(1.14, 1.2, 0.04, 0, 1.9, -0.19, gilt);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.06), mirrorTex());
      glass.position.set(0, 1.9, -0.165);
      g.add(glass);
      // the clock on the shelf, two candlesticks
      b.box(0.3, 0.3, 0.14, 0, 1.32, -0.08, flat(0x1a1612));
      const dial = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), dialTex());
      dial.position.set(0, 1.35, -0.005);
      g.add(dial);
      addDial(g, { at: [0, 1.35, -0.005], radius: 0.06, lift: 0.003, mat: iron(), minute: 0.84, hour: 0.56, width: 0.15, kind: "mantel clock in a home" });
      for (const x of [-0.55, 0.55]) {
        b.cyl(0.03, 0.05, 0.22, x, 1.28, -0.06, brass(), 6);
        b.cyl(0.015, 0.015, 0.1, x, 1.44, -0.06, flat(0xe8e0cc), 5);
      }
      const s = glow(0xff7a30, 0.8);
      s.position.set(0, 0.25, 0.05);
      g.add(s);
      light = { x: 0, y: 0.45, z: 0.45, color: 0xff8a40, power: 4.5, glow: s };
      break;
    }
    case "chandelier": {
      // brass, six candles, over the table
      const y = ceiling - 0.85;
      b.cyl(0.01, 0.01, 0.7, 0, ceiling - 0.35, 0, iron(), 4);
      b.cyl(0.05, 0.08, 0.2, 0, y + 0.05, 0, brass(), 8);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.02, 4, 12), brass());
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, y, 0);
      g.add(ring);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        b.cyl(0.015, 0.015, 0.1, Math.cos(a) * 0.34, y + 0.07, Math.sin(a) * 0.34, flat(0xe8e0cc), 5);
      }
      const s = glow(0xffc070, 1.2);
      s.position.set(0, y + 0.14, 0);
      g.add(s);
      light = { x: 0, y: y + 0.1, z: 0, color: 0xffc080, power: 7, glow: s };
      break;
    }
    default:
      b.box(0.4, 0.4, 0.4, 0, 0.2, 0, wood());
  }
  return { group: g, light };
}
