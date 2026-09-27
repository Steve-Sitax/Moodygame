import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { bumpFromMap, footDirt, psx } from "../retro/psx";
import { brickBandTexture, glassTexture, slateTexture } from "./cityTextures";
import { rand } from "./rooms";
import type { World } from "./rijnkaai";

// The cathedral outside (M7, 2026-09-26; Steve: "cathedral needs more detail, the other churches have 3d statues and
// cathedral not ... good textures", and the houses against it were flat painted fronts). Its own model,
// /models/cathedral.glb (tools/blender/build_landmarks.py cathedral()): the shell, and its small things (statues,
// crockets, finials, glazing bars, shutters) in pieces drawn near only. Each material takes a picture and a height
// map made from that picture (bump: the relief always follows the picture it lights):
//   - the stone: Codex pictures of weathered, sooted Brabant sandstone (walls, the low courses, the carved work), the
//     portal's tympanum and the oak of the doors (assets/ATTRIBUTION.md; heights by tools/textures/cathedral_maps.py);
//   - the houses against the church: the town's own wall pictures and their height maps (wall_*.jpg, wall_*_h.png,
//     tools/textures/wall_heights.py), painted by the model's vertex colour; trims, doors, shutters and roof tiles
//     painted here, their bump from their own colour (retro/psx.ts bumpFromMap).
// The stand-in block of the landmark (world/city.ts) is hidden once the model is in.

/** How far the small things are drawn (m from the eye to the piece's middle). */
const NEAR = 105;

type Pic = { map: string; h?: string; bump: number };
const PICTURES: Record<string, Pic> = {
  cath_ashlar: { map: "/textures/cathx_ashlar.jpg", h: "/textures/cathx_ashlar_h.png", bump: 1.6 },
  cath_plinth: { map: "/textures/cathx_plinth.jpg", h: "/textures/cathx_plinth_h.png", bump: 1.8 },
  cath_carved: { map: "/textures/cathx_carved.jpg", h: "/textures/cathx_carved_h.png", bump: 0.8 },
  cath_oak: { map: "/textures/cathx_door.jpg", h: "/textures/cathx_door_h.png", bump: 1.4 },
  cath_tymp: { map: "/textures/cathx_tympanum.jpg", h: "/textures/cathx_tympanum_h.png", bump: 1.6 },
  hs_brick: { map: "/textures/wall_brick.jpg", h: "/textures/wall_brick_h.png", bump: 1.4 },
  hs_plaster: { map: "/textures/wall_plaster.jpg", h: "/textures/wall_plaster_h.png", bump: 0.5 },
  hs_render: { map: "/textures/wall_render.jpg", h: "/textures/wall_render_h.png", bump: 0.5 },
  hs_brick_old: { map: "/textures/wall_brick_yellow_old.jpg", h: "/textures/wall_brick_yellow_old_h.png", bump: 1.4 },
};
/**
 * A lift over 1 for the stone (as the Carolus's, world/churches.ts): the grey daylight of the town leaves a big dark
 * stone mass nearly black, the houses round it are lit by their own shading. It acts on daylight only (no glow at night).
 */
const LIFT: Record<string, number> = { cath_ashlar: 1.05, cath_plinth: 1.05, cath_carved: 1.1, cath_tymp: 1.1, cath_oak: 1.3, cath_atlas: 1.3, cath_slate: 1.1 };
/**
 * The stone's share of the sky's light that reaches it everywhere (the game's sun never reaches the west front: the
 * front to the square would stand black in the grey day). Follows the hemisphere light, so it is gone at night.
 */
const SKY_FILL: Record<string, number> = { cath_ashlar: 0.34, cath_plinth: 0.3, cath_carved: 0.38, cath_tymp: 0.34, cath_atlas: 0.5, cath_oak: 0.35 };
const WARM = new THREE.Color(0.62, 0.6, 0.56);
/** The dirt band at the walls' foot (amount, mottle): retro/psx.ts footDirt. */
const FOOT: Record<string, [number, number]> = {
  cath_ashlar: [0.4, 0.3], cath_plinth: [0.3, 0.3], cath_carved: [0.35, 0.2], cath_oak: [0.3, 0],
  hs_brick: [0.5, 0.4], hs_plaster: [0.5, 0.4], hs_render: [0.5, 0.4], hs_brick_old: [0.5, 0.4],
};
/** Stand-in colours until a picture is in (and the colour of a material with none). */
const BASE: Record<string, number> = {
  cath_ashlar: 0x8a8272, cath_plinth: 0x5e5a52, cath_carved: 0x958c7a, cath_oak: 0x4a3526, cath_tymp: 0x857c6c, cath_iron: 0x26262a,
  cath_lead: 0x4a4e52, gilt: 0xc8a040, hs_brick: 0x8a4a38, hs_plaster: 0xd0c8b8, hs_render: 0xc0bab0, hs_brick_old: 0x9a8058,
};

function flip(t: THREE.Texture): THREE.Texture {
  // (the glTF's texture coordinates: v runs down the picture)
  t.flipY = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A plain canvas stand-in of a colour with a little grain (so the texture exists before the picture). */
function standIn(hex: number, seed: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 16;
  const g = c.getContext("2d")!;
  const r = rand(seed);
  const col = new THREE.Color(hex);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const k = 0.92 + r() * 0.16;
      g.fillStyle = `rgb(${Math.round(col.r * 255 * k)},${Math.round(col.g * 255 * k)},${Math.round(col.b * 255 * k)})`;
      g.fillRect(x, y, 1, 1);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return flip(t) as THREE.CanvasTexture;
}

/** A picture in place of the stand-in when it has loaded (it stays the stand-in if it fails). */
function picture(tex: THREE.Texture, url: string, then?: () => void): void {
  const img = new Image();
  img.onload = () => {
    tex.image = img;
    tex.dispose();
    tex.needsUpdate = true;
    then?.();
  };
  img.onerror = () => console.warn("cathedral: picture did not load", url);
  img.src = url;
}

/** A height map (bump) picture: grey, linear, mipmapped. */
function heightMap(url: string): THREE.Texture {
  const t = new THREE.Texture();
  flip(t);
  t.colorSpace = THREE.NoColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  picture(t, url);
  return t;
}

// ---- the painted materials of the houses (small canvases; the relief from their own colour)

function paint(w: number, h: number, seed: number, draw: (g: CanvasRenderingContext2D, r: () => number) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!, rand(seed));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return flip(t) as THREE.CanvasTexture;
}

/** Painted wood (window frames, sashes, cornices): white paint, grain showing, dirt in the grain. */
const trimTex = () =>
  paint(64, 64, 7, (g, r) => {
    g.fillStyle = "#e4e0d6";
    g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(${90 + r() * 40},${86 + r() * 30},${76 + r() * 20},${0.08 + r() * 0.12})`;
      g.fillRect(0, r() * 64, 64, 1);
    }
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(60,55,48,${r() * 0.18})`;
      g.fillRect(r() * 64, r() * 64, 2 + r() * 6, 1 + r() * 2);
    }
  });

/** Planks (doors, shop fronts, shutters): painted boards, their joints dark, the paint worn at the edges; pale, the model tints them. */
const plankTex = (seed: number, board: number) =>
  paint(64, 64, seed, (g, r) => {
    g.fillStyle = "#d8d2c6";
    g.fillRect(0, 0, 64, 64);
    for (let x = 0; x < 64; x += board) {
      const v = (r() - 0.5) * 18;
      g.fillStyle = `rgb(${210 + v},${204 + v},${192 + v})`;
      g.fillRect(x + 1, 0, board - 1, 64);
      g.fillStyle = "rgba(40,34,28,0.75)";
      g.fillRect(x, 0, 1, 64);
      for (let i = 0; i < 6; i++) {
        g.fillStyle = `rgba(90,80,66,${0.1 + r() * 0.15})`;
        g.fillRect(x + 1 + r() * (board - 2), r() * 64, 1, 6 + r() * 20);
      }
    }
    for (let i = 0; i < 24; i++) {
      g.fillStyle = `rgba(70,58,44,${0.15 + r() * 0.2})`;
      g.fillRect(r() * 64, r() * 64, 1 + r() * 3, 1 + r() * 2);
    }
  });

/** Red pantiles in rows: the rounded crowns lit, the troughs dark, a little moss and soot. */
const pantileTex = () =>
  paint(64, 64, 17, (g, r) => {
    g.fillStyle = "#8a4632";
    g.fillRect(0, 0, 64, 64);
    for (let row = 0; row < 64; row += 8) {
      for (let x = 0; x < 64; x += 8) {
        const grad = g.createLinearGradient(x, 0, x + 8, 0);
        const v = (r() - 0.5) * 24;
        grad.addColorStop(0, `rgb(${96 + v},${46 + v * 0.5},${34})`);
        grad.addColorStop(0.45, `rgb(${168 + v},${86 + v * 0.5},${60})`);
        grad.addColorStop(1, `rgb(${70 + v},${34},${26})`);
        g.fillStyle = grad;
        g.fillRect(x, row, 8, 7);
      }
      g.fillStyle = "rgba(30,18,12,0.8)";
      g.fillRect(0, row + 7, 64, 1);
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = r() < 0.5 ? `rgba(70,80,40,${r() * 0.35})` : `rgba(20,18,16,${r() * 0.3})`;
      g.fillRect(r() * 64, r() * 64, 2 + r() * 5, 1 + r() * 3);
    }
  });

/** Window glass of the houses: dark, a pale sky caught in it, uneven old panes. */
const houseGlassTex = () =>
  paint(32, 32, 23, (g, r) => {
    const grad = g.createLinearGradient(0, 0, 32, 32);
    grad.addColorStop(0, "#5a6670");
    grad.addColorStop(0.5, "#20262c");
    grad.addColorStop(1, "#141a20");
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    for (let i = 0; i < 12; i++) {
      g.fillStyle = `rgba(200,210,215,${r() * 0.12})`;
      g.fillRect(r() * 32, r() * 32, 1 + r() * 4, 1);
    }
  });

/**
 * three.js's bump works in screen space: far off, where one pixel covers many texels of the height map, every pixel
 * steps over a joint and the wall turns to noise (and pale: the tilted normals catch the sky). Fade the bump out as
 * the height map's texels get smaller than a pixel or two (as retro/psx.ts wallRelief does for the house walls).
 */
function tameBump<T extends THREE.Material>(m: T, texels = 512): T {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "vec2 dSTdy = dFdy( vBumpMapUv );",
        `vec2 dSTdy = dFdy( vBumpMapUv );
		float cathFp = max( length( dSTdx ), length( dSTdy ) ) * ${texels.toFixed(1)};
		float cathBf = 1.0 - smoothstep( 1.2, 3.5, cathFp );`,
      )
      // (retro/psx.ts puts three.js's bump chunk in place before this runs: its return scales the bump for the render
      // height; the fade goes in front of it. Before, the chunk was not yet in the shader and this did nothing.)
      .replace("return vec2( dBx, dBy )", "return cathBf * vec2( dBx, dBy )");
  };
  m.customProgramCacheKey = () => `${prevKey()}-tamebump${texels}`;
  return m;
}

export interface CathedralOutside {
  group: THREE.Group;
}

type WRect = [number, number, number, number];

/**
 * The ground round the cathedral (the houses' check, 2026-09-26): the walk map counts the landmark's whole rectangle as
 * church, so nobody could walk up to the houses built against it (3 to 7 m of cobbles before their doors). The model's
 * build lists those strips and what stands on them (/models/cathedral_walk.json, build_landmarks.py _open_ground):
 * walked like any street, with the stone and the houses as walls.
 */
function openGround(world: World): void {
  fetch("/models/cathedral_walk.json")
    .then((r) => (r.ok ? (r.json() as Promise<{ strips: WRect[]; blocks: WRect[] }>) : null))
    .then((w) => {
      if (!w?.strips.length) return;
      const inR = (q: WRect, x: number, z: number, m = 0) => x >= q[0] - m && x <= q[1] + m && z >= q[2] - m && z <= q[3] + m;
      const box = {
        minX: Math.min(...w.strips.map((q) => q[0])),
        maxX: Math.max(...w.strips.map((q) => q[1])),
        minZ: Math.min(...w.strips.map((q) => q[2])),
        maxZ: Math.max(...w.strips.map((q) => q[3])),
      };
      const has = (x: number, z: number) => w.strips.some((q) => inR(q, x, z));
      world.addWalkArea({
        box,
        has,
        walkable: (x, z) => has(x, z) && !w.blocks.some((q) => inR(q, x, z)),
        floor: () => 0,
        hits: (x, z, r) => has(x, z) && w.blocks.some((q) => inR(q, x, z, r)),
      });
    })
    .catch((e) => console.warn("cathedral_walk.json did not load", e));
}

/** Load the cathedral's model into the scene; hide the landmark's stand-in when it is in; open the ground round it. */
export function loadCathedralOutside(world: World): CathedralOutside {
  const scene = world.scene;
  openGround(world);
  const group = new THREE.Group();
  group.name = "cathedral_outside";
  scene.add(group);
  const mats = new Map<string, THREE.Material>();
  const filled: Array<[THREE.MeshLambertMaterial, number]> = [];
  const skyFill = (m: THREE.MeshLambertMaterial, k: number) => {
    m.emissiveMap = m.map;
    filled.push([m, k]);
    // (the fill is shaded by the model's vertex colour too: the reveals, the undersides and the niches stay dark)
    const prev = m.onBeforeCompile;
    const prevKey = m.customProgramCacheKey.bind(m);
    m.onBeforeCompile = (shader, renderer) => {
      prev.call(m, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\n#ifdef USE_COLOR\n  totalEmissiveRadiance *= vColor.rgb;\n#endif",
      );
    };
    m.customProgramCacheKey = () => `${prevKey()}-skyfill`;
  };
  let hemi: THREE.HemisphereLight | null = null;
  let lastFrame = -1;
  /** Each frame (the shell's first draw): the fill follows the sky light's colour and strength. */
  const fillNow = (renderer: THREE.WebGLRenderer) => {
    const f = renderer.info.render.frame;
    if (f === lastFrame) return;
    lastFrame = f;
    if (!hemi)
      scene.traverse((o) => {
        if ((o as THREE.HemisphereLight).isHemisphereLight) hemi = o as THREE.HemisphereLight;
      });
    const h = hemi as THREE.HemisphereLight | null;
    const s = h ? h.intensity / 1.8 : 1;
    // (the sky's colour, half-way to a warm grey: the fill is light off the town and the cloud, not the blue sky alone)
    for (const [m, k] of filled) (h ? m.emissive.copy(h.color).lerp(WARM, 0.6) : m.emissive.copy(WARM)).multiplyScalar(k * s);
  };
  const lambert = (o: THREE.MeshLambertMaterialParameters) =>
    psx(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, ...o }), { fogReach: 2.2, affine: 0 });
  const make = (name: string, src: THREE.MeshStandardMaterial): THREE.Material => {
    const pic = PICTURES[name];
    if (pic) {
      const map = standIn(BASE[name] ?? 0x888888, name.length * 31);
      map.magFilter = THREE.LinearFilter;
      map.minFilter = THREE.LinearMipmapLinearFilter;
      map.anisotropy = 4;
      picture(map, pic.map);
      const k = LIFT[name] ?? 1;
      const m = lambert({ map, color: new THREE.Color(k, k, k) });
      if (SKY_FILL[name]) skyFill(m, SKY_FILL[name]);
      if (pic.h) {
        m.bumpMap = heightMap(pic.h);
        m.bumpScale = pic.bump;
        tameBump(m);
      }
      // the town's dirt at the foot of the walls (retro/psx.ts footDirt): a little less on the church, its square is swept
      if (FOOT[name]) footDirt(m, FOOT[name][0], FOOT[name][1]);
      return m;
    }
    switch (name) {
      case "cath_atlas": {
        const map = src.map;
        if (map) {
          map.magFilter = THREE.NearestFilter;
          map.minFilter = THREE.NearestFilter;
          map.generateMipmaps = false;
        }
        const k = LIFT[name];
        const m = lambert({ map: map ?? null, color: new THREE.Color(k, k, k) });
        skyFill(m, SKY_FILL[name]);
        return m;
      }
      case "cath_slate":
      case "hs_slate":
        return mats.get("slate") ?? (mats.set("slate", tameBump(bumpFromMap(lambert({ map: flip(slateTexture()) }), 0.9), 64)), mats.get("slate")!);
      case "cath_glass":
        return lambert({ map: flip(glassTexture()) });
      case "brickband":
        return lambert({ map: flip(brickBandTexture()) });
      case "hs_trim":
        return tameBump(bumpFromMap(lambert({ map: trimTex() }), 0.5), 64);
      case "hs_door":
        return footDirt(tameBump(bumpFromMap(lambert({ map: plankTex(29, 8) }), 0.9), 64), 0.4, 0);
      case "hs_shutter":
        return tameBump(bumpFromMap(lambert({ map: plankTex(31, 6) }), 0.9), 64);
      case "hs_pantile":
        return tameBump(bumpFromMap(lambert({ map: pantileTex() }), 1.2), 64);
      case "hs_glass":
        return lambert({ map: houseGlassTex(), color: 0xffffff });
      case "gilt":
        return lambert({ color: 0xc8a040, emissive: 0x1a1206 });
      default:
        return lambert({ color: BASE[name] ?? 0x888888 });
    }
  };
  const matFor = (src: THREE.MeshStandardMaterial): THREE.Material => {
    let m = mats.get(src.name);
    if (!m) {
      m = make(src.name, src);
      m.name = src.name;
      mats.set(src.name, m);
    }
    return m;
  };
  const hideStandIn = () =>
    scene.traverse((o) => {
      if (o.name === "standin_cathedral") o.visible = false;
    });

  const draco = new DRACOLoader().setDecoderPath("/draco/");
  new GLTFLoader()
    .setDRACOLoader(draco)
    .loadAsync("/models/cathedral.glb")
    .then((gltf) => {
      const meshes: THREE.Mesh[] = [];
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if (!m.geometry.getAttribute("color")) {
          const n = m.geometry.getAttribute("position").count;
          m.geometry.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
        }
        m.material = matFor(m.material as THREE.MeshStandardMaterial);
        meshes.push(m);
      });
      for (const m of meshes) {
        // (bake the node's place into the geometry: a piece of the small things is moved to its own middle below)
        m.updateWorldMatrix(true, false);
        m.geometry.applyMatrix4(m.matrixWorld);
        m.position.set(0, 0, 0);
        m.quaternion.identity();
        m.scale.set(1, 1, 1);
        m.geometry.computeBoundingSphere();
        let near = false;
        for (let p: THREE.Object3D | null = m; p; p = p.parent) if (/_near_\d+$/.test(p.name)) near = true;
        // the model's own names for the dev checks (zfight: "landmark cathedral")
        m.name = m.name.startsWith("landmark_") ? m.name : `landmark_cathedral_${m.name}`;
        if (!near) {
          m.onBeforeRender = (r) => fillNow(r);
          group.add(m);
          continue;
        }
        // a piece of the small things: drawn only near (a LOD at the piece's middle, nothing beyond NEAR)
        const c = m.geometry.boundingSphere!.center.clone();
        m.geometry.translate(-c.x, -c.y, -c.z);
        m.geometry.computeBoundingSphere();
        const lod = new THREE.LOD();
        lod.name = "landmark_cathedral_near";
        lod.position.copy(c);
        lod.addLevel(m, 0);
        lod.addLevel(new THREE.Object3D(), NEAR + m.geometry.boundingSphere!.radius);
        group.add(lod);
      }
      hideStandIn();
      draco.dispose();
    })
    .catch((e) => console.warn("cathedral.glb did not load", e));
  return { group };
}
