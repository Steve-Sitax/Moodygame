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

None from third parties yet. All M1 textures are painted in code at 64x64
(`client/src/world/textures.ts`). Geometry is grey-box, built in code.

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
