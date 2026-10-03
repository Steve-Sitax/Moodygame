// The Godot port's models (docs/godot-port.md): Godot 4.7 cannot read Draco, and every glb in
// client/public/models/ is Draco-compressed. This writes each one again without it, into godot/baked/models/
// (not in git). Names, skins, animations and extras stay as they are.
//
//   node tools/godot/models.mjs [--out godot/baked/models] [--only people,animals]

import { mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";

const here = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const src = path.join(here, "client/public/models");
const out = path.resolve(here, opt("out", "godot/baked/models"));
const only = opt("only", "") ? opt("only", "").split(",") : null;
mkdirSync(out, { recursive: true });

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() });

let failed = 0;
for (const f of readdirSync(src).filter((f) => f.endsWith(".glb")).sort()) {
  if (only && !only.includes(f.slice(0, -4))) continue;
  try {
    const doc = await io.read(path.join(src, f));
    // reading has decoded the meshes; without the extension the writer leaves them plain
    for (const e of doc.getRoot().listExtensionsUsed()) if (e instanceof KHRDracoMeshCompression) e.dispose();
    const r = doc.getRoot();
    await io.write(path.join(out, f), doc);
    const mb = (n) => (n / 1048576).toFixed(2);
    console.log(`${f}: ${mb(statSync(path.join(src, f)).size)} MB -> ${mb(statSync(path.join(out, f)).size)} MB, ${r.listNodes().length} nodes, ${r.listMeshes().length} meshes, ${r.listSkins().length} skins, ${r.listAnimations().length} clips, other extensions: ${r.listExtensionsUsed().map((e) => e.extensionName).join(" ") || "none"}`);
  } catch (err) {
    failed++;
    console.log(`${f}: FAILED ${err?.message ?? err}`);
  }
}
if (failed) process.exit(1);
