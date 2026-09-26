// M8a multiplayer (docs/multiplayer-plan.md 3.2): after `vite build`, list every file of the built game with
// its size and SHA-256 in client/dist/manifest.json. The server serves only these files, and each also at
// /a/<sha256> (the same bytes forever); a guest's browser keeps them under their hash and downloads only the
// hashes it does not have (client/src/boot/netboot.ts). Gzip copies (<file>.gz) are made here for the
// files that shrink, so the server never zips on the fly.
//
//   node tools/manifest.mjs [--dist client/dist]

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const i = process.argv.indexOf("--dist");
const dist = path.resolve(i >= 0 ? process.argv[i + 1] : path.join(root, "client", "dist"));
if (!existsSync(path.join(dist, "index.html"))) throw new Error(`${dist} has no index.html: build first (npm --prefix client run build)`);

const ZIP = new Set([".js", ".mjs", ".css", ".json", ".glb", ".gltf", ".bin", ".wasm", ".svg", ".html", ".txt"]);
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const rel = path.relative(dist, full).split(path.sep).join("/");
    if (statSync(full).isDirectory()) walk(full);
    else if (rel !== "manifest.json" && !rel.endsWith(".gz")) files.push({ full, rel });
  }
}
walk(dist);

let zipped = 0;
const out = [];
for (const f of files) {
  const buf = readFileSync(f.full);
  out.push({ path: f.rel, size: buf.length, sha256: createHash("sha256").update(buf).digest("hex") });
  const gz = `${f.full}.gz`;
  rmSync(gz, { force: true });
  if (ZIP.has(path.extname(f.rel).toLowerCase()) && buf.length > 1024) {
    const z = gzipSync(buf, { level: 9 });
    if (z.length < buf.length * 0.95) {
      writeFileSync(gz, z);
      zipped++;
    }
  }
}
const pkg = JSON.parse(readFileSync(path.join(root, "client", "package.json"), "utf8"));
const protocol = Number(/MP_PROTOCOL\s*=\s*(\d+)/.exec(readFileSync(path.join(root, "shared", "mpProtocol.ts"), "utf8"))?.[1] ?? 1);
const listHash = createHash("sha256").update(out.map((f) => `${f.path} ${f.sha256}`).join("\n")).digest("hex").slice(0, 6);
const total = out.reduce((n, f) => n + f.size, 0);
const manifest = { version: `${pkg.version}+${listHash}`, protocol, built: new Date().toISOString(), files: out, total };
writeFileSync(path.join(dist, "manifest.json"), JSON.stringify(manifest));
console.log(`[manifest] ${out.length} files, ${(total / 1048576).toFixed(1)} MB, version ${manifest.version}; ${zipped} gzip copies`);
