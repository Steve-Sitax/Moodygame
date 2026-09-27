import * as THREE from "three";
import { bumpFromMap } from "../retro/psx";

// Bumps on every textured surface (the bump audit, 2026-09-26; Steve: "Run through all textures in the game and take
// pictures where used if they seem flat and make them appropriate"). The big surfaces have height maps of their own
// (the house walls: houseGrime.ts and tools/textures/wall_heights.py; the town wall: world/townWallBumps.ts; the
// landmarks: tools/textures/*_maps.py; the floors: retro/psx.ts relief and slabs). Everything else that is still flat,
// the props, the market, the boats, the rooms' furniture and walls, gets a bump map from its own picture here
// (retro/psx.ts bumpFromMap: light stone high, dark joints low, so the bumps are always the picture's own), with a
// strength by what the surface is: stone and brick most, wood and slate, rope and straw, iron and leather less,
// cloth, plaster and marble faint, glass, paper, paint and gilt none.
//
// It runs in the shader warm-up (world/warmup.ts) on every object before its shader is first built, in the street
// and in every room, so a material has its bump from its first frame on (no shader built twice: docs/rendering.md).
// One height map per picture (bumpFromMap caches it), one bump per material.

/** three.js bumpScale by kind: it tilts the normal by the height's change from one screen pixel to the next. */
export const BUMP_KIND = {
  stone: 1.4,
  roof: 1.2,
  tile: 0.7,
  earth: 1.0,
  wood: 1.1,
  bark: 1.4,
  fibre: 1.0,
  mixed: 1.0,
  iron: 0.6,
  leather: 0.6,
  food: 0.45,
  plant: 0.4,
  plaster: 0.4,
  cloth: 0.28,
  polished: 0.18,
  none: 0,
} as const;
export type BumpKind = keyof typeof BUMP_KIND;

/**
 * What a surface is, from its material's name, its picture's name or file and, last, its object's name, as words
 * (the names' "_", digits and dots are spaces: "lm_oak_dark" reads "lm oak dark"). The first rule that matches wins,
 * so the smooth ones and the exceptions come first.
 */
const RULES: Array<[RegExp, BumpKind]> = [
  // smooth on purpose: glass, mirrors, paper, print, paint, pictures, lettering, light, water, skin, animals
  [/glass|mirror|\bpanes?\b|lampshade|bottle|paper|poster|\bbills?\b|letter|\bsigns?\b|numbers|notice|label|print|ledger|\brules\b|chart|music|\bmaps?\b|\bdials?\b|clock|portrait|saint|history|paint|picture|sketch|\barms\b|\bink\b|screen|gilt|gold|glow|flame|ember|candle|smoke|steam|\bsky\b|cloud|water|river|\bskin\b|\bface\b|forearm|\bhair\b|shadow|decal|grime|halo|\bsea\b|rosary|\b[pj] (altar|lady|side|chapel)\b|vogelpik|\bhorse\b|\bdog\b|\bcat\b|\bbird|gull|pigeon|sparrow|\brat\b|\bfish\b|\bpress\b|\bboard text\b|backdrop|\bbooth\b/, "none"],
  // polished: marble, brass, copper, pewter, tin, glazed tiles and delft, jars
  [/marble|alabaster|brass|copper|pewter|\btins?\b|delft|\bjugs?\b|\bjars?\b|jarsrow|polished|lacquer|porcelain|glaze|\bglobe\b|\bbronze\b/, "polished"],
  // floor and wall tiles: glazed, but the joints between them sunk
  [/whitetiles|encaustic|checker|\btiles?\b|redtile/, "tile"],
  // brick and dressed stone, whatever else the name says (a brick vault, a brick oven, a cellar's brick)
  [/brick|ashlar|masonry|\bvault stone\b/, "stone"],
  // cloth and soft goods (faint)
  [/cloth|linen|curtain|drape|velvet|plush|damask|baize|silk|blanket|\bsheet\b|skirt|shawl|canvas|\bsails?\b|tarpaulin|oilskin|awning|carpet|turkey|\brags?\b|felt|wool|\bbolts?\b|display|hatbox|bunting|flagcloth/, "cloth"],
  // leaves and plants: faint (cut-out cards)
  [/leaves|foliage|\bplants?\b|reed|\bivy\b|moss|fern|grass|hedge|flower|lilies|lily|parsley|onions|herb|vegetation|\bweeds?\b/, "plant"],
  // bark
  [/\bbark\b|trunk/, "bark"],
  // food and goods that are neither (a faint grain)
  [/\bloaf|bread|biscuit|\bmeat\b|sausage|\bapples?\b|cheese|\bfat\b|peperkoek|\btarts?\b|\bcakes?\b|candy|\bbeans\b|sugar|cigar|tobacco|coffee|mussel|\bbuns?\b/, "food"],
  // rope, straw, rush, wicker, sacking, books on a shelf (their spines)
  [/rope|wicker|basket|straw|\brush\b|\bhay\b|thatch|\bbales?\b|\bsacks?\b|sacking|hessian|bundle|\bnets?\b|broom|cordage|\bbooks?\b/, "fibre"],
  // leather
  [/leather|\bhides?\b|\bboots?\b|saddle|harness|\blasts?\b|\bshoes?\b/, "leather"],
  // iron, steel, lead, zinc and the other dull metals, tar
  [/iron|steel|\bzinc\b|\blead\b|metal|\brails?\b|hoop|chain|anchor|\bbars\b|\bknob\b|\bwire\b|\bpump\b|\bbells?\b|cannon|stove|\bgrate\b|rivet|\btar\b/, "iron"],
  // plaster, whitewash, render, ceilings, clay pots, lime
  [/plaster|\bwash\b|whitewash|render|\bcream\b|ceil|\bdado\b|cornice|frieze|\bwhite\b|\blime\b|\bclay\b|\bpots?\b|chalk|\bsoot\b|\bvault\b|stucco|wallpaper|office wall|brownplaster/, "plaster"],
  // slate and tiles
  [/slate|pantile|\btiles?\b|redtile|\broof\b|roofing|shingle/, "roof"],
  // masonry and paving
  [/brick|stone|ashlar|granite|tournai|\bflags\b|hallflags|flagstone|\bslabs?\b|cobble|\bsetts?\b|plinth|quoin|coping|\bkerbs?\b|\bsteps?\b|hearth|masonry|quaywall|quay wall|backwalls?|\brock\b|cellar|\bbank\b|statue|\breveal\b|\bgravel\b|\bvh blue\b|\bvault (brick|stone)\b/, "stone"],
  // earth, mud, sand
  [/earth|\bmud\b|dirt|\bsand\b|\bruts\b|ground/, "earth"],
  // wood of every kind
  [/wood|plank|board|\boak\b|\bdeal\b|\bpine\b|mahogany|timber|\bbeams?\b|crate|\bcasks?\b|barrel|\btubs?\b|shutter|\bdoors?\b|\bleaf\b|\bpanels?\b|wainscot|\bframes?\b|\bdecks?\b|\bhull\b|drawers|counter|bench|chair|table|\bcarts?\b|wagon|wheel|\bstalls?\b|\bpiles?\b|\bmasts?\b|ladder|\bspars?\b|\boars?\b|\bchests?\b|\bbox(es)?\b|\bblock\b|typecase|\bform\b|shel(f|ves)|cabinet|wardrobe|\bbed\b|stool|dresser|joist|rafter|\blath\b|fence|\bposts?\b|\bgates?\b|stairdark|\bdark\b|darkwood|\bhoops\b/, "wood"],
  // the mixed atlases of the town's props (a barrel next to a crate next to a sack): all from their own picture
  [/\bsolid\b|atlas|\bgoods\b|clutter|litter|lively|streetlife|quayfurniture|\btrades\b|\bboats\b|\bprops\b|\bthin\b|market|velocipede|omnibus|railway/, "mixed"],
];

const words = (s: string) => ` ${s.toLowerCase().replace(/[^a-z]+/g, " ").trim()} `;

/** The kind a label (names joined) falls under, or null when no rule knows it. */
export function bumpKindOf(label: string): BumpKind | null {
  const w = words(label);
  for (const [re, k] of RULES) if (re.test(w)) return k;
  return null;
}

/** An atlas cell with lettering: a sign, a shop's name board, a bill, a notice, a ship's name, a house number. */
const LETTERED = /\b(names?|signs?|boards?|plates?|numbers?|letters?|notices?|posters?|bills?|labels?|placards?)\b/;

/**
 * Keep the lettered cells of an atlas flat (Steve, 2026-09-27: "text/posters should not be bump-mapped, they are
 * flat"). A whole atlas gets one bump from its picture (a "mixed" kind), so the letters of a notice or a name board
 * stood out as relief; the cells named here are left level in its height map (retro/psx.ts heightFromColour reads
 * `flatCells`). `cells`: name to [x, y, w, h] in pixels from the picture's top left, on a W x H picture.
 */
export function flatLettering(tex: THREE.Texture, cells: Iterable<[string, readonly number[]]>, W: number, H: number): void {
  const flat: Array<[number, number, number, number]> = [];
  for (const [name, [x, y, w, h]] of cells) if (LETTERED.test(words(name))) flat.push([x / W, y / H, w / W, h / H]);
  if (flat.length) tex.userData.flatCells = flat;
}

/** Tag a painted texture with what it shows, for a material that has no telling name. */
export function bumpTag<T extends THREE.Texture>(t: T, kind: BumpKind): T {
  t.userData.bumpKind = kind;
  return t;
}

function fileOf(t: THREE.Texture): string {
  const src = (t.image as { src?: string } | undefined)?.src;
  const own = (t.userData as { picture?: string }).picture;
  return own ?? (typeof src === "string" && !src.startsWith("data:") && !src.startsWith("blob:") ? src.replace(/^.*\//, "") : "");
}

/** The shaders that draw their own relief (psx relief and slabs, the house walls): not touched. */
function ownRelief(m: THREE.Material): boolean {
  let key = "";
  try {
    key = m.customProgramCacheKey?.() ?? "";
  } catch {
    return false;
  }
  return /-rel[\d.]|-slab|-wallrelief/.test(key);
}

const LIT = new Set(["MeshLambertMaterial", "MeshPhongMaterial", "MeshStandardMaterial", "MeshPhysicalMaterial", "MeshToonMaterial"]);
/** A bump scale under this was meant as metres (1 cm = 1.0): three.js r186 counts it per screen pixel. */
const METRES = 0.05;
const decided = new WeakSet<THREE.Material>();
export const bumpStats = { given: 0, lifted: 0, smooth: 0, unknown: [] as string[] };

/**
 * Decide the bump of a material the first time it is seen (the warm-up calls this for every new object). A material
 * that has a bump map keeps it (a scale meant as metres is made visible); one with a picture and none gets one from
 * its picture, as strong as its kind; the rest are left as they are.
 */
export function autoBump(mat: THREE.Material, obj?: THREE.Object3D): void {
  if (decided.has(mat)) {
    // (a material given its picture later makes its height again with bumpFromMap, which may set a scale in metres)
    const m = mat as THREE.MeshLambertMaterial;
    if (m.bumpMap && m.bumpScale > 0 && m.bumpScale < METRES && m.userData.bumpLift) m.bumpScale = m.userData.bumpLift as number;
    return;
  }
  if (!LIT.has(mat.type)) {
    decided.add(mat);
    return;
  }
  const m = mat as THREE.MeshLambertMaterial & { normalMap?: THREE.Texture | null };
  // (a material given its picture later is decided then: the warm-up sees it again with its new version)
  if (!m.map && !m.bumpMap) return;
  decided.add(mat);
  if (m.bumpMap) {
    if (m.bumpScale > 0 && m.bumpScale < METRES) {
      // (the prop surface maps, world/propSurface.ts: 2 mm meant; as strong as the kind, else the metres read as 1 cm = 1)
      const kind = (m.name ? bumpKindOf(m.name) : null) ?? bumpKindOf(m.map?.name ?? "");
      m.userData.bumpBefore = m.bumpScale;
      m.bumpScale = kind && BUMP_KIND[kind] > 0 ? BUMP_KIND[kind] : m.bumpScale * 100;
      m.userData.bumpLift = m.bumpScale;
      bumpStats.lifted++;
    }
    return;
  }
  // (an atlas material, psx `atlas`: its bump is read in its cell, as its colour is: retro/psx.ts atlasBumpGlsl)
  if (!m.map || m.normalMap || ownRelief(m)) return;
  if ((obj as THREE.SkinnedMesh | undefined)?.isSkinnedMesh) return;
  if (m.transparent && m.opacity < 0.95) return;
  const tag = m.map.userData?.bumpKind as BumpKind | undefined;
  const label = [m.name, m.map.name, fileOf(m.map)].filter(Boolean).join(" ");
  // (the material's own name first: "h_hallflags" on the slate picture is flagstones)
  const kind =
    tag ??
    (m.name ? bumpKindOf(m.name) : null) ??
    bumpKindOf([m.map.name, fileOf(m.map)].join(" ")) ??
    (obj?.name ? bumpKindOf(`${obj.name} ${obj.parent?.name ?? ""}`) : null);
  if (!kind) {
    if (bumpStats.unknown.length < 200) bumpStats.unknown.push(`${label || "(unnamed)"} @ ${obj?.name ?? ""}`);
    return;
  }
  const k = BUMP_KIND[kind];
  m.userData.bumpKind = `auto ${kind}`;
  if (k <= 0) {
    bumpStats.smooth++;
    return;
  }
  // (only a picture the canvas can read: an image, a canvas, a bitmap; not a data texture)
  const img = m.map.image as unknown;
  const drawable =
    (typeof HTMLImageElement !== "undefined" && img instanceof HTMLImageElement) ||
    (typeof HTMLCanvasElement !== "undefined" && img instanceof HTMLCanvasElement) ||
    (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) ||
    (typeof OffscreenCanvas !== "undefined" && img instanceof OffscreenCanvas);
  if (img && !drawable) {
    if (bumpStats.unknown.length < 200) bumpStats.unknown.push(`${label || "(unnamed)"} @ ${obj?.name ?? ""}: not a picture`);
    return;
  }
  const map = m.map;
  m.userData.bumpBefore = 0;
  bumpFromMap(m, k, true);
  bumpStats.given++;
  if (!img) {
    // a picture still loading (three's TextureLoader sets the image when it is in): the height is made when it is
    // first sent to the GPU (bumpFromMap's own hook on the map, userData.onPicture)
    const prev = map.onUpdate;
    map.onUpdate = (t: THREE.Texture) => {
      prev?.call(map, t);
      if (map.image && !map.userData.bumpFilled) {
        map.userData.bumpFilled = true;
        (map.userData.onPicture as (() => void) | undefined)?.();
      }
    };
  }
}

/** Every material of an object (the warm-up's hook). */
export function autoBumpObject(o: THREE.Object3D): void {
  const d = o as THREE.Mesh;
  const list = Array.isArray(d.material) ? d.material : d.material ? [d.material] : [];
  for (const m of list) {
    try {
      autoBump(m, o);
    } catch (e) {
      // (a bump is never worth a shader not built)
      console.warn("bumps: skipped", m.name, e);
    }
  }
}
