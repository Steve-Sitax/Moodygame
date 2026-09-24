// Hash the parts of a .glb: every mesh primitive, skin, image and animation by name (M6 transport check).
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const file = process.argv[2];
const buf = readFileSync(file);
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
const binStart = 20 + jsonLen + 8;
const bin = buf.subarray(binStart);
const view = (i) => { const v = gltf.bufferViews[i]; return bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength); };
const acc = (i) => { const a = gltf.accessors[i]; if (a.bufferView === undefined) return Buffer.from(JSON.stringify(a)); const v = gltf.bufferViews[a.bufferView]; const sizes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }; const bytes = { 5126: 4, 5123: 2, 5125: 4, 5121: 1 }[a.componentType]; const n = a.count * sizes[a.type] * bytes; const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0); return Buffer.concat([Buffer.from(JSON.stringify({ t: a.type, c: a.componentType, n: a.count, min: a.min, max: a.max })), bin.subarray(off, off + n)]); };
const h = (b) => createHash("sha256").update(b).digest("hex").slice(0, 16);
const out = {};
gltf.meshes.forEach((m) => m.primitives.forEach((p, k) => { const d = p.extensions?.KHR_draco_mesh_compression; out[`mesh:${m.name}:${k}`] = h(d ? view(d.bufferView) : Buffer.concat(Object.values(p.attributes).map(acc))); }));
(gltf.skins ?? []).forEach((s, i) => { out[`skin:${s.name ?? i}`] = h(s.inverseBindMatrices !== undefined ? acc(s.inverseBindMatrices) : Buffer.alloc(0)); });
(gltf.images ?? []).forEach((im, i) => { out[`image:${im.name ?? i}`] = h(im.bufferView !== undefined ? view(im.bufferView) : Buffer.from(im.uri ?? "")); });
(gltf.animations ?? []).forEach((a) => { const parts = a.channels.map((c) => { const s = a.samplers[c.sampler]; return Buffer.concat([Buffer.from(`${gltf.nodes[c.target.node].name}.${c.target.path}`), acc(s.input), acc(s.output)]); }); out[`anim:${a.name}`] = h(Buffer.concat(parts)); });
console.log(JSON.stringify(out, null, 1));
