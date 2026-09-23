# 05 - Art direction

Reference: Foghorns Drown (Studio Laaya, 2026). We copy the mood and the technique. Not the assets, not the story.

## The look in one line
A PS1 game found in a wet cellar. Low poly. Thick fog. Gas light. Everything a little wrong.

## Rules
| Rule | How |
|---|---|
| Low resolution | Render to a 480x270 target. Upscale with nearest filter. |
| Vertex wobble | Snap vertex positions to a coarse grid in the vertex shader. Things jitter when you move. |
| Affine texture warp | Skip perspective correction on textures (noperspective trick in the shader). Textures swim. |
| Colour depth | Reduce to 5 bits per channel. Add an ordered dither (Bayer 4x4). |
| Fog | Dense linear fog, 3 m to 25 m. Colour shifts with time: grey-blue at dawn, brown-yellow under gas lamps, near black at night. |
| Light | Few lights. Gas lamps are the only warm light. Everything else is cold. Flicker on lamps. |
| Textures | 64x64 to 128x128. Hand-painted or photo-based, crushed. Wet stone, tar, rope, rust. |
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
- 8 NPC models from 2 base bodies with texture swaps. Faces are 32x32. That is the style.
- 6 job props: sack, crate, lantern, letter, barrel, rope.
- Made in Blender, or bought low-poly packs with a clear licence. No copied assets. Licence noted per pack.
