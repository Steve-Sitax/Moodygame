import * as THREE from "three";

// The bump audit (dev, `__scheldemist.bumpaudit()`; Steve, 2026-09-26: "textures from the wall are not bump-mapped
// and still flat. Run through all textures in the game"). It walks every material drawn in the street scene and in
// every room and hall of the world (world/inworld.ts), and says per material: where it is used (the objects, a world
// point), its picture, and what relief it has: three.js's bump map (and how strong: its bumpScale tilts the normal by
// the height's change from one screen pixel to the next, so well under 0.3 does not show up close), a normal map,
// the ground's relief light (retro/psx.ts `relief`, `slabs`), or the house walls' height maps (`wallRelief`).
//
// verdict:
//   relief   the psx relief light, the slabs or the wall relief: stands out
//   bump     a bump or normal map strong enough to see
//   faint    a faint bump on purpose (cloth, polished stone and metal, plants, food: world/bumps.ts)
//   weak     a bump map too weak to see (bumpScale < 0.3)
//   flat     a picture and no relief at all
//   smooth   a picture on a surface that is smooth on purpose (glass, paper, bills, cloth, sky, water, glow, skin)
//   plain    no picture (one colour, vertex colours): nothing to follow
//   unlit    a basic, sprite, line or points material (glows, halos, the sky)
// The sources are the scene's top groups (city, town_wall, streetlife ...), a room by its id.

export interface BumpAuditRow {
  source: string;
  material: string;
  type: string;
  verdict: "relief" | "bump" | "faint" | "weak" | "flat" | "smooth" | "plain" | "unlit";
  /** The picture: a file, a canvas's size, or the glb's image name. */
  map: string;
  bump: number | null;
  normal: number | null;
  /** psx relief, slabs, wall relief, prop surface (from the program key). */
  relief: string;
  meshes: number;
  objects: string[];
  at: [number, number, number];
}

export interface BumpAuditResult {
  rows: BumpAuditRow[];
  /** By source: how many materials of each verdict. */
  bySource: Record<string, Partial<Record<BumpAuditRow["verdict"], number>>>;
  totals: Partial<Record<BumpAuditRow["verdict"], number>>;
  /** The flat and weak ones, as `source / material (map) at x,y,z`. */
  flat: string[];
}

/** Smooth on purpose: a surface a bump would spoil (named by material, object or picture). */
const SMOOTH = /glass|window|\bpane|paper|poster|\bbill|letter|\bsign|board_text|label|cloth|linen|wall_canvas|\bsail|flag|banner|awning|curtain|skin|\bface\b|hair|\beye|\bsky|cloud|water|river|mirror|glow|halo|flame|fire|smoke|steam|_light\b|lamp_glass|shadow|decal|paint_|painting|\barms\b|print|\bink\b|screen|chart|wallpaper|gilt|gold|brass|polish|marble|silk|velvet|shirt|coat|dress|skirt|apron|trousers|\bhat\b|\bcap\b|bonnet|shawl|\bbody|people|human|person|horse|\bdog|\bcat\b|bird|gull|pigeon|sparrow|\brat\b|\bpig\b|goat|\bcow\b|\bfish\b|foam|wake|rain|snow|mist|\bfog|spill|pool/i;

function mapName(t: THREE.Texture | null | undefined): string {
  if (!t) return "";
  const img = t.image as { src?: string; width?: number; height?: number; data?: unknown; constructor?: { name?: string } } | undefined;
  if (!img) return t.name || "texture (no image)";
  if (typeof img.src === "string" && img.src) {
    const s = img.src;
    if (s.startsWith("data:")) return `data url ${img.width ?? "?"}x${img.height ?? "?"}`;
    if (s.startsWith("blob:")) return `${t.name || "glb image"} ${img.width ?? "?"}x${img.height ?? "?"}`;
    return s.replace(/^https?:\/\/[^/]+/, "");
  }
  if (typeof HTMLCanvasElement !== "undefined" && img instanceof HTMLCanvasElement) return `${t.name ? t.name + " " : ""}canvas ${img.width}x${img.height}`;
  if (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) return `${t.name || "glb image"} ${img.width}x${img.height}`;
  if (img.data) return `${t.name ? t.name + " " : ""}data ${img.width}x${img.height}`;
  return `${t.name || img.constructor?.name || "image"} ${img.width ?? "?"}x${img.height ?? "?"}`;
}

/** The scene's top group a mesh belongs to (its name, else the mesh's own). */
function sourceOf(o: THREE.Object3D, scene: THREE.Object3D, prefix: string): string {
  let top: THREE.Object3D = o;
  const names: string[] = [];
  let p: THREE.Object3D | null = o;
  while (p && p !== scene) {
    if (p.name) names.push(p.name);
    top = p;
    p = p.parent;
  }
  const n = top.name || names[names.length - 1] || o.name || "(unnamed)";
  return prefix + n;
}

const tmpV = new THREE.Vector3();
const tmpM = new THREE.Matrix4();

function worldPoint(m: THREE.Mesh): [number, number, number] {
  const g = m.geometry;
  if (!g.boundingSphere) g.computeBoundingSphere();
  tmpV.copy(g.boundingSphere?.center ?? tmpV.set(0, 0, 0));
  const inst = m as THREE.InstancedMesh;
  if (inst.isInstancedMesh && inst.count > 0) {
    inst.getMatrixAt(0, tmpM);
    tmpV.applyMatrix4(tmpM);
  }
  m.updateWorldMatrix(true, false);
  tmpV.applyMatrix4(m.matrixWorld);
  return [+tmpV.x.toFixed(1), +tmpV.y.toFixed(1), +tmpV.z.toFixed(1)];
}

function reliefOf(mat: THREE.Material): string {
  let key = "";
  try {
    key = mat.customProgramCacheKey?.() ?? "";
  } catch {
    key = "";
  }
  const out: string[] = [];
  if (/-rel[\d.]/.test(key)) out.push("relief");
  if (/-slab/.test(key)) out.push("slabs");
  if (/-wallrelief/.test(key)) out.push("wall relief");
  if (/-prop-surface/.test(key)) out.push("prop surface");
  if (/-townwall-h/.test(key)) out.push("town wall height");
  const ud = mat.userData as { bumpKind?: string };
  if (ud.bumpKind) out.push(ud.bumpKind);
  return out.join(", ");
}

/** Materials whose relief is drawn by their own shader (not a three.js map): the audit trusts these. */
const OWN_RELIEF = /relief|slabs|wall relief|town wall height/;

export function bumpAudit(scenes: Array<{ scene: THREE.Object3D; prefix?: string }>, opts: { list?: number } = {}): BumpAuditResult {
  const rows = new Map<THREE.Material, BumpAuditRow>();
  for (const { scene, prefix = "" } of scenes) {
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!(m as { isMesh?: boolean }).isMesh && !(o as THREE.Sprite).isSprite && !(o as THREE.Points).isPoints && !(o as THREE.Line).isLine) return;
      const list = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of list) {
        if (!mat) continue;
        let r = rows.get(mat);
        if (!r) {
          const mm = mat as THREE.MeshLambertMaterial & { normalMap?: THREE.Texture | null; normalScale?: THREE.Vector2 };
          const relief = reliefOf(mat);
          const map = mapName(mm.map);
          const bump = mm.bumpMap ? mm.bumpScale : null;
          const normal = mm.normalMap ? mm.normalScale?.x ?? 1 : null;
          const unlit = !["MeshLambertMaterial", "MeshPhongMaterial", "MeshStandardMaterial", "MeshPhysicalMaterial", "MeshToonMaterial"].includes(mat.type);
          const src = sourceOf(o, scene, prefix);
          let verdict: BumpAuditRow["verdict"];
          if (unlit) verdict = "unlit";
          else if (OWN_RELIEF.test(relief)) verdict = "relief";
          else if ((bump !== null && bump >= 0.3) || (normal !== null && normal >= 0.3)) verdict = "bump";
          else if (!mm.map) verdict = "plain";
          else if (SMOOTH.test(`${mat.name} ${mm.map?.name ?? ""} ${/^\//.test(map) ? map : ""}`) || (o as THREE.SkinnedMesh).isSkinnedMesh || mat.transparent) verdict = bump !== null || normal !== null ? "bump" : "smooth";
          else verdict = bump !== null || normal !== null ? "weak" : "flat";
          // world/bumps.ts decided: smooth on purpose, or faint on purpose (cloth, polished, plants, food)
          const kind = (mat.userData as { bumpKind?: string }).bumpKind ?? "";
          if (!unlit && kind === "auto none") verdict = "smooth";
          else if (!unlit && verdict === "weak" && /^auto (cloth|polished|plant|food)$/.test(kind)) verdict = "faint";
          r = { source: src, material: mat.name || `(${mat.type.replace("Mesh", "").replace("Material", "").toLowerCase()} #${(mat as { id?: number }).id})`, type: mat.type, verdict, map, bump, normal, relief, meshes: 0, objects: [], at: [0, 0, 0] };
          if ((m as { isMesh?: boolean }).isMesh) r.at = worldPoint(m);
          rows.set(mat, r);
        }
        r.meshes++;
        if (r.objects.length < 4 && o.name && !r.objects.includes(o.name)) r.objects.push(o.name);
      }
    });
  }
  const all = [...rows.values()].sort((a, b) => a.source.localeCompare(b.source) || a.verdict.localeCompare(b.verdict) || a.material.localeCompare(b.material));
  const bySource: BumpAuditResult["bySource"] = {};
  const totals: BumpAuditResult["totals"] = {};
  for (const r of all) {
    const s = (bySource[r.source] ??= {});
    s[r.verdict] = (s[r.verdict] ?? 0) + 1;
    totals[r.verdict] = (totals[r.verdict] ?? 0) + 1;
  }
  const flat = all
    .filter((r) => r.verdict === "flat" || r.verdict === "weak")
    .slice(0, opts.list ?? 10000)
    .map((r) => `${r.source} / ${r.material} [${r.verdict}${r.bump !== null ? ` ${r.bump}` : ""}] (${r.map}) at ${r.at.join(",")} ${r.objects.slice(0, 2).join(" ")}`);
  return { rows: all, bySource, totals, flat };
}

/** The audit as plain text (one line a material, grouped by source), for a file. */
export function bumpAuditText(a: BumpAuditResult): string {
  const out: string[] = [];
  out.push(`totals: ${JSON.stringify(a.totals)}`);
  let src = "";
  for (const r of a.rows) {
    if (r.source !== src) {
      src = r.source;
      out.push("", `== ${src}  ${JSON.stringify(a.bySource[src])}`);
    }
    const b = r.bump !== null ? ` bump ${r.bump}` : "";
    const n = r.normal !== null ? ` normal ${r.normal}` : "";
    out.push(`  ${r.verdict.padEnd(6)} ${r.material}  [${r.type.replace("Material", "")}${b}${n}${r.relief ? ` ${r.relief}` : ""}]  map: ${r.map || "-"}  x${r.meshes} at ${r.at.join(",")}  ${r.objects.join(" | ")}`);
  }
  return out.join("\n");
}
