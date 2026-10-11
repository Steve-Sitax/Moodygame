# 05 - Art direction

Reference: Foghorns Drown (Studio Laaya, 2026). We copy the mood and the technique. Not the assets, not the story.

## The look in one line
Antwerp in 1873, made in high detail and good looking. Thick fog, gas light and a fine film grain carry the mood.

Steve, 2026-10-11: "remove the ps1 references, always make things high detail and good looking, we just use fog and
grain for mood. But the PS1 low poly and misaligned textures should not be used." The PS1 look of the first months
(270 lines, nearest pixels, vertex wobble, affine texture warp, 5-bit colour with a dither) is gone from both games.

## Rules
| Rule | How |
|---|---|
| Detail | Every new or changed model is high detail: real shapes with bevels and enough segments, period-right. No deliberate low poly. Inside the frame budget (docs/performance.md): share geometry, instance copies, drop what nobody sees. |
| Textures | Clean, properly aligned, at a sensible resolution, smooth (linear, mipmapped) filtering. No swimming or warped textures, no blocky pixels up close. Wet stone, tar, rope, rust. |
| Picture | Godot: the full window by default (High quality) with smooth edges (4x multisampling), full colour. The browser demo draws 720 lines by default, smoothly scaled, without multisampling (it cost 6 ms a frame there). |
| Grain | A fine film grain over the picture, a little stronger in the shadows; with the grade and the vignette. |
| Fog | Dense linear fog, 3 m to 25 m. Colour shifts with time: grey-blue at dawn, brown-yellow under gas lamps, near black at night. |
| Light | Few lights. Gas lamps are the only warm light. Everything else is cold. Flicker on lamps. |
| Palette | Grey-green water, brown brick, black iron, one yellow (lamps), one red (Red Star Line flag, blood). |
| Camera | First person. Slight head bob. Slow turn. Low field of view (60) in alleys, wider (75) on the quay. |
| UI | Paper and ink. A pencil font. Needs as small drawings, not bars. Money as coins in a hand. |

## Sound (half of the mood)
- Foghorn, far, every 40 to 90 seconds when foggy.
- Cathedral bells on the hour. Softer in the fog.
- Water against stone. Rope creak. Gulls by day. Rats by night.
- Footsteps change: stone, wood, mud, water.
- No music in the world. One slow accordion or organ line on the sleep screen and in the epilogue.

## Places, what they must feel like
- Rijnkaai: wide, wet, ropes and crates, one crane. Ships as dark walls in the fog.
- Vismarkt: crowded, loud, lamps, fish crates, the Steen as a black shape.
- Sint-Andries: narrow, leaning walls, one lamp per street, washing lines, a church door with light.
- Grote Markt: open, cold, guild houses as tall dark shapes, the cathedral spire lost in the fog.
- The ferry: a rowing boat on a chain. Halfway across, nothing is visible. Only sound.

## Asset plan for the demo
- One modular kit: 10 wall pieces, 4 roofs, 6 street props, 3 boat parts, 2 lamp types.
- 8 NPC models from 2 base bodies with texture swaps. (The first plan's 32x32 faces were the old PS1 style; new work is high detail.)
- 6 job props: sack, crate, lantern, letter, barrel, rope.
- Made in Blender or in code, or bought packs with a clear licence. No copied assets. Licence noted per pack.
