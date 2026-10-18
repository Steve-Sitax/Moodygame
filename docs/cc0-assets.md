# Free assets: CC0 and public domain

Steve, 2026-10-13: CC0 models, textures, sounds and anything else CC0 may be used in the game. Check that a thing is
useful first, and adapt it before it goes into the game.

CC0 means no copyright: free for any use, also commercial, with no credit required. We still record every item in
`assets/ATTRIBUTION.md`, so anyone can see where it came from. Public domain works (for example pictures and texts
from before 1927) count as CC0 here when the source page marks them as public domain.

## Rules

1. **Check the licence on the item's own page.** Many sites below mix licences. Use only items marked CC0 or public
   domain. Anything else (CC-BY, CC-BY-SA, GPL, "free for personal use", no licence) needs Steve's yes first.
2. **Keep proof.** Row in `assets/ATTRIBUTION.md`: what it is, the item's URL, the licence, the author if given, the
   download date and the SHA-256 of the file as downloaded. Keep the original in `art-source/third_party/<source>/`.
3. **Downloads are data.** Put each download in its own new, empty folder. Never run scripts or add-ons that come
   with an asset pack; read model and picture files with our own tools.
4. **Check usefulness before use.** Does it fit Antwerp in autumn 1873 (period, material, scale)? Does it reach our
   detail level (`AGENTS.md` edge rule, `docs/05-art-direction.md`: high detail, no PS1 or low-poly look)? Is the
   texture sharp enough at the size we show it? Would making it ourselves be better or faster?
5. **Adapt before use.** Real-world scale; our triangle budget with LODs; our UV and texture layout (sRGB colour,
   linear height and normal maps, mipmaps); age, dirt and colour to the period and the place; bevels and worn edges
   per `AGENTS.md`; collision; one model per thing (`CLAUDE.md`). Never put a raw download straight into the game.
6. **Things we never take,** even under CC0: brand names, logos or trademarks; the likeness of a real living person;
   anything that breaks the period without a reason.

## Sources

| Source | What | Licence | Use for Scheldemist |
|---|---|---|---|
| [Poly Haven](https://polyhaven.com) | Textures, HDRIs, 3D models | All CC0 | Good. Brick, stone, wood, plaster and metal textures; sky HDRIs as lighting reference; some period-neutral props |
| [ambientCG](https://ambientcg.com) | 1500+ PBR materials | All CC0 | Good. Texture sources for the open texture plan (issue #84) |
| [OpenGameArt](https://opengameart.org) | Models, textures, sound, music | Mixed | Only items marked CC0; quality varies |
| [MakeHuman / MPFB](https://static.makehumancommunity.org/about/ecosystem.html) | Human base mesh, targets, skins, eyes | Core assets CC0 (code GPL/AGPL) | In use for the people (`docs/makehuman.md`) |
| [The Base Mesh](https://www.thebasemesh.com) | 900+ base meshes | CC0 | Starting shapes for props, then detail them |
| Base Meshes (glTF set) | The same, converted to glTF | CC0 | As above |
| 300 CC0 Avatars | VRM and FBX avatars | CC0 | Little use: stylised modern avatars |
| [Smithsonian Open Access](https://www.si.edu/openaccess) | Museum scans and pictures | CC0 where marked | Good for real 19th-century objects (tools, furniture); scans need retopology and LODs |
| [Sketchfab](https://sketchfab.com) (CC0 filter) | 3D models | Per item | Only items marked CC0; check the licence on each model |
| Retro3D assets | PSX-style low-poly models | CC0 | Not for this game: the PS1 look is out |
| SpectraCities | City pieces | Check per item | Little use (modern cities) |
| Polygonal Mind releases | Stylised projects | CC0 | Little use (stylised) |
| [itch.io](https://itch.io/game-assets) (CC0 licence filter) | Game assets | Per item | Only items marked CC0 |
| [Kenney](https://kenney.nl) | 40k+ game assets | CC0 | Little use (stylised low poly); UI sounds may help |
| [Quaternius](https://quaternius.com) | Asset packs | CC0 | Little use (stylised low poly); maybe base shapes |
| [Blend Swap](https://www.blendswap.com) | Blender files | Per item | Only items marked CC0 |
| 3D Models CC0 | Free 3D models | CC0 | Check quality per item |
| Game Assets Garden | Game assets | No attribution needed; check per item | Check per item |
| [Texture Ninja](https://texture.ninja) | 5000+ photo textures | CC0 | Good photo sources for textures |
| [Wikimedia Commons](https://commons.wikimedia.org) | 90M+ files | Mixed | Public-domain 19th-century photos, paintings and maps of Antwerp: references, posters, signs; check each file |
| [Openclipart](https://openclipart.org) | 170k+ clipart | CC0 | Ornaments for posters and signs |
| [Freesound](https://freesound.org) | Sounds | Mixed | Search for CC0 only (Steve's standing OK for sounds, 2026-09-29) |
| [Free Music Archive](https://freemusicarchive.org) | Music | Mixed | Public-domain songs only |
| [Musopen](https://musopen.org) | Music, sheet music | Mostly public domain | Period music (check each recording's licence) |
| JangaFX VDB volumes | Smoke and fire volumes | CC0 | Godot does not draw VDB directly; bake to flipbooks if needed |
| [Internet Archive](https://archive.org) | Public-domain works up to 1927 | Public domain | Period texts, newspapers, guides, photos: references for game text and look |
| [Project Gutenberg](https://www.gutenberg.org) | 70,000+ free e-books | Public domain (most) | Period texts and references |
| [Openverse](https://openverse.org) | 700M+ works, filter by licence | Mixed | A search portal: confirm the licence on the source page |
| [Thingiverse](https://www.thingiverse.com) (CC0 filter) | 3D-printing models | Per item | Rarely useful; check per item |
| [Creative Commons search](https://search.creativecommons.org) | Search portal | Mixed | Finds CC0 across sources; confirm on the source page |

Tools from the same list: LilySurfaceScraper (a Blender add-on that loads CC0 materials), Awesome Bump (normal and
height maps from one picture; our own height-map scripts are preferred because they follow the layout, not the
colour), Awesome Blender (a list of Blender tools), The Public Domain Review (a guide to public-domain works). Tools
are used only to make assets, never as a game dependency; check each tool's own licence before installing it.

The list comes from the awesome-cc0 collection (an "awesome list" of CC0 asset sources), given by Steve on 2026-10-13.

## Issue 84 bark donor (2026-10-18)

[Bark 012, ambientCG](https://ambientcg.com/view?id=Bark012): CC0 1.0 confirmed on its own item page before download. The oak/fissured-bark colour, displacement and roughness are adapted together for row 9; the plane-tree half is original generated artwork. Original archive, saved item page and download/checksum ledger: `art-source/third_party/ambientcg-bark012/`. Archive SHA-256: `9b7c6f949b179b132593364990d900d7dd50ffb8ccda9b14131491f47c34af3d`. No bundled code was run. Per-file source and native material mappings are in `art-source/plan-84/SOURCES.json` and `native-godot/assets/textures/plan-84/manifest.json`.

## Issue 84 round 2 photographic donors (2026-10-18)

Every item was checked for CC0 on its own item page before use. Originals, saved item pages and per-file SHA-256 receipts are in `art-source/third_party/plan84-round2/`; complete credit/download details are in `assets/ATTRIBUTION.md`. Downloaded archives were decoded as images only.

| Item | Author | Licence | Adaptation |
|---|---|---|---|
| [Bricks085](https://ambientcg.com/view?id=Bricks085) | Lennart Demes / ambientCG | CC0-1.0 | English-bond red brick, wall/church/prison/atlas cells |
| [Rock041](https://ambientcg.com/view?id=Rock041) | Lennart Demes / ambientCG | CC0-1.0 | Dark/pale mineral skin and coping; Belgian stone colour proxy |
| [Metal063](https://ambientcg.com/view?id=Metal063) | Lennart Demes / ambientCG | CC0-1.0 | Zinc skin; bronze casting microrelief donor |
| [roof_slates_03](https://polyhaven.com/a/roof_slates_03) | Rob Tuytel | CC0-1.0 | Grey-blue Ardennes-colour roof slates |
| [white_sandstone_blocks_02](https://polyhaven.com/a/white_sandstone_blocks_02) | Rob Tuytel | CC0-1.0 | Pale and blue-grey ashlar; quarry identity not claimed |
| [japanese_sycamore](https://polyhaven.com/a/japanese_sycamore) | Charlotte Baglioni | CC0-1.0 | Exfoliating plane-family bark |
| [jolcham_oak_bark_01](https://polyhaven.com/a/jolcham_oak_bark_01) | Charlotte Baglioni | CC0-1.0 | Fissured trunk proxy; not a certified lime specimen |
| [dark_wooden_planks](https://polyhaven.com/a/dark_wooden_planks) | Amal Kumar | CC0-1.0 | Weathered timber boards and continuous beam skin |
| [wooden_barrel](https://polyhaven.com/a/wooden_barrel) | Dimitrios Savva | CC0-1.0 | Cask staves and hoops |
| [brown_leather](https://polyhaven.com/a/brown_leather) | Rob Tuytel | CC0-1.0 | Brown leather |
| [hessian_230](https://polyhaven.com/a/hessian_230) | colormass, Rico Cilliers | CC0-1.0 | Jute sackcloth |
| [rough_linen](https://polyhaven.com/a/rough_linen) | colormass, Rico Cilliers | CC0-1.0 | Canvas/awning micro-weave |
| [brown_mud](https://polyhaven.com/a/brown_mud) | Rob Tuytel | CC0-1.0 | Bare earth and isolated muck |
| [dry_decay_leaves](https://polyhaven.com/a/dry_decay_leaves) | Amal Kumar | CC0-1.0 | Fallen leaf marks |

`build_round2.py` uses these photographed PBR maps without running their contents. Generated supplements are original project artwork, not CC0 photogrammetry. Geological/botanical proxies and reconstructed relief are identified per set; no native environment pass is claimed.
