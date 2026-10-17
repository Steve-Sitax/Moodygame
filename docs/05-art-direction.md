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

## Atmospheric city construction and acceptance

Standing direction from Steve, 2026-10-13: the city must have high geometric and material detail. A sharper photograph
on a flat, sharp-edged shape is unfinished. These rules apply to new work and repairs of existing native assets.

- **Construction before surface detail.** Model thickness, projecting caps, joints, laps, fixings and material-appropriate
  rounded edges where the player can see them. Follow the dimensions and sharp-edge exceptions in `AGENTS.md`.
  Stone stair noses and caps need worn silhouettes; railings need believable sections, connections and mounting bases.
  Normal smoothing, painted highlights and bump maps cannot substitute for these shapes.
- **Wear follows use.** Soften travelled tread edges and contact areas; vary chips, broken corners and mortar loss by
  exposure and maintenance. Wood damage follows grain. Hand contact can polish metal while sheltered joints corrode.
  Avoid identical damage on every repeat and uniform rounding of every edge. Preserve intentional construction seams.
- **Connected ground geometry.** Fit paving to actual foundations, stair feet, thresholds, walls and drains. Cut, turn or
  terminate kerbs at the correct junction; no kerb through a wall, floating pavement, open seam or buried stair edge.
  Paving courses, borders, levels and slopes must make construction sense. Collision must follow repaired walkable geometry.
- **Follow the water.** Where appropriate, connect roof falls and eaves to gutters, hoppers, bracketed downpipes, outlet
  shoes and a plausible ground channel, drain or collection vessel. Check joins, corners, end caps and clearance from
  openings. Walls without roof gutters still need credible coping and runoff. Use period-appropriate construction.
  Check existing native drainage before adding replacements: source presence alone does not prove successful conversion.
  Roof and surface drainage must lead to gullies with reserved connections to the planned **Ruien** underground sewage
  and water network. Record inlet position, invert, pipe diameter and connection ID; do not invent a completed network.
- **Wall and pavement weather together.** Use uneven dirt accumulation at the wall foot, splash marks, rising damp,
  leakage and runoff streaks where their causes exist. Carry corresponding damp, sediment and stains onto nearby paving,
  joints and drains. Match scale and location across surfaces; do not apply one uniform black strip or independent decals.
  Protected recesses, exposed faces and regularly swept routes must differ.
- **Vegetation has a cause.** Place moss and algae around persistent damp, shaded joints, leaking outlets and water traps.
  Small weeds, grasses or occasional ferns may root in soil-filled cracks and failed mortar in neglected areas. Roots must
  meet real crevices; give visible tufts thickness and varied silhouettes. Keep maintained and dry surfaces cleaner.
  Avoid random green overlays, evenly spaced plants, or growth through intact stone and metal.
- **Surface scale and relief.** Check texture detail at the closest playable view, including narrow atlas cells and oblique
  angles, small returns, tops, ends and undersides. Recess backing faces behind added relief; coincident faces cause
  striped depth conflicts even with correct UVs. Match brick, slab, slate, grain and corrosion scale to the object. Rotate and scale colour, normal, height and
  roughness consistently; laps shed water downhill and wood grain follows construction. Dirt colour is not automatically
  raised relief. Give near-visible joints and chips actual depth where their silhouettes or shadows require it.
- **Break repetition deliberately.** Combine fine material grain, individual block or tile variation, and larger weather
  patterns caused by water and use. Preserve bond patterns, joints and grain direction when varying tiles. Inspect long
  walls and broad roofs for repeated stains, diagonal motifs, mirrored grain, seams, mip bleeding and scale changes.
- **Light reveals the work.** Dry surfaces, wet patches and corrosion need distinct responses to light, without baked
  glare or shadows that contradict the scene. Contact shading must follow actual geometry, stay local and have no solid
  plate beneath it. Damp and moss must remain coherent in rain and night; shaded surfaces must not glow.
- **Acceptance is contextual.** Inspect the asset and its neighbouring surfaces in native Godot at walking distance and
  close, low and grazing angles, including backs, tops, ends and undersides. Capture dry daylight, rain and lamp-lit night.
  A neutral material preview is useful but cannot replace a final view in the game's atmosphere and surrounding geometry.
  Geometry, junctions, drainage, wear, vegetation placement, texture scale and relief each need explicit review.
  Automated checks and Claude/Codex scores cannot overrule visible defects or the user's rejection. Rework failed items
  and show new pictures. Keep partial improvements labelled unfinished until the complete local scene meets these rules.

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
