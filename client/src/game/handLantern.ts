import * as THREE from "three";
import { loadProps } from "../world/props3d";
import { lampFog } from "../world/lampFog";

// The lantern people carry, one model for every hand (2026-10-11, Steve: "make sure other lamp designs are all up to
// snuff"; CLAUDE.md: one model per thing): the town's oil lantern at a hand's size (props.glb lantern_hand,
// tools/blender/lantern_kit.py oil_lantern): a base pan, four horn panes in corner posts with wire guards, a hood, a
// chimney and a bail. Jef's own (game/lantern.ts, also the ones he sets down), the townspeople's and the police's
// (game/crowd.ts), the named people's (game/people.ts) and the night patrol's lead (game/nightlife.ts) all draw it.
//
// Its origin is where the hand holds it, the glass's middle HAND_GLASS_Y under it. The meshes exist at once (the
// callers make a lantern when they need one) and get the model's geometry and its iron when props.glb is in, which is
// long before the first dusk; until then they hold an empty speck. The glass is the caller's material (each tints its
// own: lit after dark, a dull horn by day), made with handLanternGlass so its picture and its fog are the same.

/** The glass's middle, metres under the lantern's origin (the hand). */
export const HAND_GLASS_Y = -0.08;
/** The foot of its base pan under the origin (a lantern set down stands on it). */
export const HAND_FOOT_Y = -0.1745;

let shared: { iron: THREE.BufferGeometry; glass: THREE.BufferGeometry; ironMat: THREE.Material } | null = null;
const waiting: Array<{ iron: THREE.Mesh; glass: THREE.Mesh }> = [];
const speck = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
const ironWait = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });

loadProps()
  .then((p) => {
    const parts = p.parts("lantern_hand");
    const iron = parts.find((q) => q.material.name !== "glass");
    const glass = parts.find((q) => q.material.name === "glass");
    if (!iron || !glass) return;
    shared = { iron: iron.geometry, glass: glass.geometry, ironMat: iron.material };
    for (const w of waiting.splice(0)) fill(w.iron, w.glass);
  })
  .catch((e) => console.warn("hand lantern did not load", e));

function fill(iron: THREE.Mesh, glass: THREE.Mesh): void {
  if (!shared) return;
  iron.geometry = shared.iron;
  iron.material = shared.ironMat;
  glass.geometry = shared.glass;
}

/** A hand lantern's two meshes (its iron, its glass in `glass`), origin at the hand. */
export function handLanternMeshes(glass: THREE.Material): { iron: THREE.Mesh; glass: THREE.Mesh } {
  const out = { iron: new THREE.Mesh(speck, ironWait), glass: new THREE.Mesh(speck, glass) };
  out.iron.name = "hand_lantern";
  out.glass.name = "hand_lantern_glass";
  if (shared) fill(out.iron, out.glass);
  else waiting.push(out);
  return out;
}

let pane: THREE.CanvasTexture | null = null;
/** The horn pane's picture, clean and soft (64 px): a small oil lamp's font and wick seen through it, the flame paler. */
function panePicture(): THREE.CanvasTexture {
  if (pane) return pane;
  const N = 64;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d")!;
  const grd = g.createLinearGradient(0, 0, 0, N);
  grd.addColorStop(0, "#a8916c");
  grd.addColorStop(0.45, "#d6c09a");
  grd.addColorStop(1, "#e4d0a8");
  g.fillStyle = grd;
  g.fillRect(0, 0, N, N);
  // the flame: a soft tall glow over the wick
  const fl = g.createRadialGradient(N / 2, N * 0.56, 1, N / 2, N * 0.56, N * 0.2);
  fl.addColorStop(0, "rgba(255,246,214,0.85)");
  fl.addColorStop(1, "rgba(255,236,190,0)");
  g.fillStyle = fl;
  g.beginPath();
  g.ellipse(N / 2, N * 0.56, N * 0.09, N * 0.17, 0, 0, Math.PI * 2);
  g.fill();
  // the font and the wick's holder
  g.fillStyle = "#3a3026";
  g.beginPath();
  g.ellipse(N / 2, N * 0.88, N * 0.2, N * 0.08, 0, 0, Math.PI * 2);
  g.fill();
  g.fillRect(N / 2 - N * 0.05, N * 0.72, N * 0.1, N * 0.12);
  // the frame
  g.strokeStyle = "#1e1a16";
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, N - 3, N - 3);
  pane = new THREE.CanvasTexture(c);
  pane.colorSpace = THREE.SRGBColorSpace;
  pane.anisotropy = 4;
  return pane;
}

/** A hand lantern's glass material: the pane's picture, tinted by its colour; it fogs with its carrier (lampFog). */
export function handLanternGlass(color: THREE.ColorRepresentation, reach = 1.2): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ map: panePicture(), color });
  m.name = "hand_lantern_glass";
  lampFog(m, reach);
  return m;
}
