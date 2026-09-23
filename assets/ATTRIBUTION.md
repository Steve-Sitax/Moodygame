# Attribution and licences

Every third-party asset and package in Scheldemist is listed here with its licence.
Nothing enters the repo without a clear licence. See CLAUDE.md.

## Sound

| Asset | Where in repo | Source | Licence | Checked |
|---|---|---|---|---|
| Footsteps: `footstep_concrete_000-004.ogg` (stone), `footstep_wood_000-004.ogg` (wood) | `client/public/audio/kenney-impact/` | Kenney, "Impact Sounds" 1.0, https://kenney.nl/assets/impact-sounds | CC0 1.0 (public domain). Licence file shipped next to the files: `License.txt` | 2026-09-23. Zip SHA-256 `029d734af1582474edf3a694d1b0cebc97c1c152f2f39fa34d4c2bafc5de77f8`. Licence read from `License.txt` inside the zip. |
| Gulls: "Gulls on the Harbor" (small fishing port, Brittany), by Joseph Sardin. Converted to mono OGG as `gulls-harbor-2573-mono.ogg`. The game plays short slices from 0-42 s and 106-114 s. | `client/public/audio/bigsoundbank/` | BigSoundBank, https://bigsoundbank.com/gulls-on-the-harbor-s2573.html | CC0 1.0 (public domain). Terms: https://bigsoundbank.com/droit.html. Credit is asked for, not required: "Joseph SARDIN - BigSoundBank.com". | 2026-09-23. Original OGG SHA-256 `356913aa0ffcbaa5860436981b4193aa73c168730f2b1b29c53735d1f60e7073`. |
| Job sounds, set-down: `impactWood_heavy_000-002`, `impactSoft_heavy_000-002`, `impactPlank_medium_000-002` (also used, pitched up, for lifting and coins) | `client/public/audio/kenney-impact/` | Same Kenney "Impact Sounds" 1.0 pack as the footsteps | CC0 1.0, `License.txt` in the folder | 2026-09-23, same zip, same SHA-256 as above. |
| Splash: "Splash, Big #1" (a big stone into a water tank), mono OGG `splash-big-1519.ogg` | `client/public/audio/bigsoundbank/` | BigSoundBank, https://bigsoundbank.com/splash-big-1-s1519.html | CC0 1.0. Page reads "CC0 (public domain): Free and royalty-free". | 2026-09-23. Original OGG SHA-256 `ca877585c65d7c2f744eef0260f7897626fcc19c84b441ec1e676d2d919de50f`. |
| Bell: "Bell 5 O'clock" (distant church tower), mono OGG `bell-5-oclock-3445.ogg`. Rings at the end of a watch and when a job runs late. | `client/public/audio/bigsoundbank/` | BigSoundBank, https://bigsoundbank.com/bell-5-o-clock-s3445.html | CC0 1.0. Page reads "CC0 (public domain): Free and royalty-free". | 2026-09-23. Original OGG SHA-256 `b68447d740eb3198bbf00d30421e6877d6820661280cb4733ed65088c1e670bd`. |

Made in code (our own work, no third-party source): water bed and lapping, wind, gas-lamp hiss,
foghorn, rope and timber creak, reverb. See `client/src/audio/soundscape.ts`.

## Textures and models

All textures are painted in code at 64x64 (`client/src/world/textures.ts`,
`client/src/world/cityTextures.ts`). All models are our own: built in code or by our
Blender scripts (`tools/blender/`). Blender (GPL) is a tool; the GPL does not cover what
it makes.
Street and quay props (`client/public/models/props.glb`: carts, dray, horse, barrows, crates, casks, sacks, rope, bollard, gas lamp, crane) are our own models and 64x64 textures, made by script in `tools/blender/build_props.py`; no third-party models or images.

People (`client/public/models/people.glb`): our own models, made by script. Bodies, clothes,
rig, animations and the 128x128 textures (faces and clothes painted pixel by pixel in code) all
come from `tools/blender/build_people.py`. No downloaded models, textures or assets.

## Map data (M3c, the city of 1873)

| Data | Where in repo | Source | Licence | Checked |
|---|---|---|---|---|
| The 1873 city plan, traced: blocks, public buildings, water (`shared/city.json`, `shared/city_build.json`, `client/public/city/walk.png`, `client/public/models/city.glb`) | derived data only; the scan itself is not in git | "1853/1873: Vuillaume (1/5000)", FelixArchief 12#487, via Wikimedia Commons: https://commons.wikimedia.org/wiki/File:1853-1873-_Vuillaume_(1-5000),_Vuillaume,_Felixarchief,_12_487_recto.jpg | CC0 1.0 (Commons file page) | 2026-09-23. Full-res JPEG SHA-256 `55f3c7c039dcea733b0b55d18d74dc7f5dadda7149e16efa2ffaf1f9ed27b096`. |
| Landmark outlines (cathedral, town hall, Vleeshuis, Steen, St. Paul's, St. Charles Borromeo, St. James) and the points that fit the old map to metres (`shared/city.json` landmarks) | derived data | OpenStreetMap, Overpass API export 2026-09-23 | ODbL 1.0. Credit: "(c) OpenStreetMap contributors". The repo is private; if the derived data is ever shared publicly, it must be under ODbL. | 2026-09-23 |

Not used: a stock photo of an 1830s map that Steve sent (Alamy watermark); OpenHistoricalMap (looked at, too coarse).

## Runtime libraries copied at build time

| File | Where | Source | Licence |
|---|---|---|---|
| Draco decoder: `draco_decoder.js`, `draco_decoder.wasm`, `draco_wasm_wrapper.js` | `client/public/draco/` (copied from `node_modules/three/examples/jsm/libs/draco/` by `client/scripts/copy-draco.mjs`; not in git) | Google Draco, shipped inside the three package | Apache-2.0 |

## Dev tools (not shipped)

Blender 5.2 (GPL-3.0), Python packages numpy (BSD-3), opencv-python-headless (Apache-2.0), shapely (BSD-3), Pillow (MIT-CMU).

## npm packages (client)

| Package | Version | Licence |
|---|---|---|
| three | 0.186.0 | MIT |
| @types/three | 0.186.x | MIT |
| vite | 7.x | MIT |
| typescript | 7.x | Apache-2.0 |

## npm packages (server, M2)

| Package | Version | Licence |
|---|---|---|
| hono | 4.13.8 | MIT |
| @hono/node-server | 2.1.1 | MIT |
| ws | 8.21.3 | MIT |
| better-sqlite3 | 13.0.3 | MIT |
| zod | 4.6.5 | MIT |
| @anthropic-ai/claude-agent-sdk | 0.3.280 | Proprietary, (c) Anthropic PBC. Use under Anthropic's legal agreements (https://code.claude.com/docs/en/legal-and-compliance). Declared dependency, not copied into our source. Chosen in docs/02. |
| vitest | 5.0.1 | MIT |
| typescript | 7.0.2 | Apache-2.0 |
| @types/node, @types/ws, @types/better-sqlite3 | 24.x, 8.x, 9.x | MIT |

## npm packages (repo root)

| Package | Version | Licence |
|---|---|---|
| concurrently | 10.0.5 | MIT |
