# Attribution and licences

Every third-party asset and package in Scheldemist is listed here with its licence.
Nothing enters the repo without a clear licence. See CLAUDE.md.

## Sound

| Asset | Where in repo | Source | Licence | Checked |
|---|---|---|---|---|
| Footsteps: `footstep_concrete_000-004.ogg` (stone), `footstep_wood_000-004.ogg` (wood) | `client/public/audio/kenney-impact/` | Kenney, "Impact Sounds" 1.0, https://kenney.nl/assets/impact-sounds | CC0 1.0 (public domain). Licence file shipped next to the files: `License.txt` | 2026-09-23. Zip SHA-256 `029d734af1582474edf3a694d1b0cebc97c1c152f2f39fa34d4c2bafc5de77f8`. Licence read from `License.txt` inside the zip. |
| Gulls: "Gulls on the Harbor" (small fishing port, Brittany), by Joseph Sardin. Converted to mono OGG as `gulls-harbor-2573-mono.ogg`. The game plays short slices from 0-42 s and 106-114 s. | `client/public/audio/bigsoundbank/` | BigSoundBank, https://bigsoundbank.com/gulls-on-the-harbor-s2573.html | CC0 1.0 (public domain). Terms: https://bigsoundbank.com/droit.html. Credit is asked for, not required: "Joseph SARDIN - BigSoundBank.com". | 2026-09-23. Original OGG SHA-256 `356913aa0ffcbaa5860436981b4193aa73c168730f2b1b29c53735d1f60e7073`. |

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
