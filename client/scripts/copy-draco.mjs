// Copy the Draco decoder that ships with three (Apache-2.0, see assets/ATTRIBUTION.md)
// into public/draco, so the city model (Draco-compressed glTF) can load offline.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "node_modules", "three", "examples", "jsm", "libs", "draco");
const dst = join(here, "..", "public", "draco");
mkdirSync(dst, { recursive: true });
for (const f of ["draco_decoder.js", "draco_decoder.wasm", "draco_wasm_wrapper.js"]) {
  copyFileSync(join(src, f), join(dst, f));
}
