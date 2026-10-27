# Church candle crowns · 27 October 2026

Steve: "Candle rings also seem not to have visible texture everywhere; do a close-up look and detail pass."

## What was wrong

The 35 hanging candle crowns in the four churches came from the browser bake as plain shapes in flat colours, with no
picture on any face (shader kinds r001181/r000576, `tex` empty):

- St James (12 in the aisles, `room-stjacob-source-9909-289`..`300`) and St Paul (7 separate, `9822-212`..`218`, and 3
  merged into `9814-3`): a 2.4 m band 0.3 m high as one flat strip (r006187), a 2.5 m flat lip, 8 square white sticks as
  candles (r006578) and 3 thin dark rods as chains (r006153). 228 triangles a crown.
- The choirs of St James (3 in `9899-7`, their bosses and rods partly in `9899-9`) and St Paul (3 in `9814-3`, `9814-5`)
  and St Charles's nave (3, `9398-147`..`149`, their bosses and rods in `9384-2`/`-4`): a 1.6 m flat disc ring, 8
  sticks, a bell-shaped boss and one rod up to 15 m.
- The cathedral (3 in `8904-9`, 1 in `8904-19`): two flat rings (2.1 m and 1.2 m, r005840), 20 sticks (r005929), a
  bell boss, a 19.6 m rod (r005834) and, in its own piece under each crown (`8921-117`..`120`), a coarse 0.42 m bowl.

## What replaced them (`crown_mesh.gd`, `build-crowns.gd`, `make_textures.py`)

One design in the three sizes the churches had; each is one model used for every crown of its size:

| Model | Where | Lights | Triangles (old) |
|---|---|---|---|
| `crown-large` | St James and St Paul aisles, 2.5 m | 12 | 25 464 (228) |
| `crown-small` | choirs and St Charles, 1.6 m | 8 | 20 232 (about 250) |
| `crown-tiered` | cathedral nave, 2.1 m under 1.2 m | 12 + 8 | 42 380 (about 400) |

The iron hoists add 1 244 to 13 628 triangles by length (1.5 m to 18.5 m). Every model carries Godot's generated LODs
(the brass surface drops to about a sixth, then a fourteenth, with distance).

- The ring: a foot rail (a 12 mm bead under a stepped fillet with 2 mm rounds) and a cornice (cove, flat ledge,
  rounded lips) turned on moulded sections. Between them a brass band (4 mm, 3 mm on the small rings) pierced with
  quatrefoils, 100 mm wide on the large crown, 92 mm on the cathedral's lower ring, 72 and 68 mm on the small rings
  (four circles through the cell's centre, a corner at every lobe tip and cusp), the sheet's cut walls modelled. Cast
  straps with eased edges inside and out at every segment joint, a rosette on each outer strap. A cresting of narrow
  fleur cusps (42 mm on a 10 mm strip, every 140 mm) cut from 3 mm sheet on the ledge's outer lip.
- Each light: a turned stem with a knop, a dished drip pan with a rolled rim, a turned socket with a bead and a lip, a
  slightly tapering wax candle (28 mm, 25 mm on the small crown) burnt down to 180, 230, 280 or 310 mm (0.84 of that
  on the small crown), one to three runs of wax down its side ending in a blob, a 4 mm melted cup with a 1.5 mm lip,
  a 2 mm charred wick standing 6 mm and bent at the tip.
- The hanging: the large crown on three brass chains of real oval links (alternating a quarter turn) from eyes on the
  ledge to a cast ball boss with an eye for each chain. The small and two-tier crowns hang on a turned brass stem
  (pendant, collars, top eye) with four spokes to each ring and four chains up to eyes under a collar (40 to 48
  degrees); the two-tier crown's lower ring hangs from eyes under the upper ring's foot bead. Every chain end is seated
  through an 8 mm eye with an 18 mm bore. The cathedral's pendant is a turned teardrop 180 mm across. An iron hoist
  chain of real links runs from the top eye to an iron hook under a vault plate at the old rod's top
  (`hoist-<kind>-<cm>.res`, one per length).
- Places, hanging heights and permanent object ids are the old ones: each crown goes into the room piece that held its
  ring, at the ring's foot. `promotion.json` lists every crown, its old top and every old part taken out; pieces whose
  only content was old crown parts keep their id and collision box.

Materials (`native-godot/assets/materials/candle-crowns-20261027`) use the cathedral fittings' textured shader kind
(r000557, picture and height); no new shader kind. `brass-texture`: 0.4 m of aged cast brass, body (151, 119, 65), soft
tarnish (114, 89, 50) in 30 to 100 mm patches over a fifth of it, rubbed bright (188, 155, 91) on a few, casting grain
and pits, short fine scratches, a few verdigris specks. `wax-texture`: 0.2 m of yellowed wax (239, 227, 194) with older
runs (222, 207, 171) and dust. Each has its own height picture; the hoists and hooks use the town's iron. Every part has
its own UVs at true scale: turned parts around and along their section (the round repeats rounded to whole tiles on
the rings; true scale with a seam at the back on small parts), the band and straps flat on their face. Vertex colour
carries the cast recesses (moulding roots about 0.82, joints about 0.7, the cut walls 0.91) and soot: brass that faces
up near a flame or hangs above one darkens, more the closer it is.

Edges: cast mouldings are rounded 1 to 4 mm in their sections, strap edges eased 1.2 mm. The pierced band's and the
cresting's cut edges stay sharp (thin sheet lips, the AGENTS.md exception), as do the hidden backs of the straps.

Collision: FurnitureVisual's geometry collision would take every face. Each crown carries a hidden `Hull` (a plain
16-sided band where each ring is, meta `furniture_collision_hull`) and its holder is a hulled part, so the collision
is that band. The hoist chains have none (the old 2 cm rods had theirs; nobody reaches them).

## For the lighting

No light, emission or flame was added or changed. Each crown scene (`assets/props/candle-crowns/candle-crown-*.tscn`)
has `Flames/FlameNN` Marker3D nodes at the wick tips (group `candle_flame`, meta `candle_flame`); its root carries
`candle_flames` (PackedVector3Array, crown space). In a room piece the crown sits under `CandleCrownN` (meta
`candle_crown` = large, small or tiered). (First pass: the old crowns' flat glow triangles r006515, r006873, r006992,
r005876 stayed where they were; the second pass cut them.) The cathedral's existing room light sits next to the new
pendant and glares orange on it at night.

## Review

Codex (gpt-6-astra, high) made period references and judged the in-game close-ups twice. Acted on: brass palette and
softer recess shading; candle sizes, burnt heights, cup, lip and wick; chain ends seated in eyes, higher collars; round
quatrefoil lobes at the stated sizes; narrow cresting cusps and the beaded foot rail; the cathedral's turned pendant,
and the old bowls under it taken out. Left: easing the pierced sheet's cut edges (sheet-lip exception) and the flame
clearance, which waits for the lighting.

## Second pass (27 October, evening)

Codex's final review of the first pass said "rework" (brass, wax, tops, chains, burn-down, small edges); after the
lighting merge the flames read as round blobs, and some floated beside the candles.

- Brass (`make_textures.py`): the 30 to 100 mm tarnish islands that repeated as brown blots are gone. A muted body
  #9B824F with a gentle broad ageing at a third of the old contrast toward tarnish #756344, rarely rubbed #B69A62;
  fine casting grain of one to two pixels, sparse 3 to 15 mm marks, short scratches, a few verdigris specks only in the
  tarnish. The darker accumulation stays in the vertex colour (recesses, joints, socket roots, soot over the flames).
  The shader kind has no roughness (specular off), so the variation is in colour only. Every turned part, strap, link
  and run now takes its own random offset into the pictures, so no two pans or sockets show the same patch.
- Wax: warm ivory #E5D8B5 with older runs toward #D8C79D (picture); 14-sided candles; 0 to 3 runs a candle, more on
  the older (shorter) ones, 3 to 5 mm wide, 10 to 45 mm long, 1.5 to 2.2 mm proud, from the rim's low side mostly, half of
  them ending in a bead; old wax 1 to 3 mm thick in about half the pans (more under old candles), in two to four
  uneven lobes with brass between them.
- Candle tops: the rim burnt lower on one side (1.5 to 5 mm), rounded 1.5 mm, a melted pool 3.5 to 6 mm deep in
  #CBB98D, a charred wick (#29231E) 1.6 mm across standing 5 to 7 mm and bent over at its glowing tip.
- Chains: the brass links' ends in 8 segments, the wire 8-sided; the eyes 16 by 8; the iron hoists 5 segments an end,
  6-sided.
- Burn-down: about 55, 70, 85 and 100 % of the longest candle (unchanged) shared out in a shuffled order with 10 to
  25 mm more or less each, one or two burnt down to 40 to 80 mm on each large ring, none or one on each small one. Each
  model has a second variant (`-b`, its own seed) and `vary-crowns.py` gives every hung crown its variant and a turn by
  whole light spacings (and turns its hoist with it), so no two neighbours repeat.
- Edges: the quatrefoils' cut edges a 45-degree bevel of a fifth of the sheet (0.8 mm on the 4 mm band, 0.6 on the 3
  mm), the cresting's shoulders rounded 1.5 mm and its cut edge bevelled 0.6 mm to each face (the tips stay pointed),
  the drip pans' rolled lips rounded about 0.5 mm.
- The old crowns' flat glow triangles were cut from their pieces (`--cut-glows`, 42 triangles in 23 pieces).

Triangles (variant a / b): large 66 114 / 66 620, small 49 724 / 49 508, tiered 96 742 / 96 142 (most of the rise is
the round chains and the candles' runs, pools and tops); the hoists 19 388 to 40 412. Every mesh keeps its generated
LODs.

Flames (ChurchLight.cs): each lit crown candle's flame stands on its wick marker, a small teardrop (3 cm tall) with a
white-yellow heart, a dim blue root and a soft halo 10 cm across, swaying and flickering a little; it is drawn by the
gas lamps' halo shader (a shape mode, no new kind). The first bake's crown candles are still in the town bake, hidden
in the new band: nothing in a crown's ring is taken for a bake candle any more.

## Reproduce

```
python art-source/candle-crowns-20261027/make_textures.py <png dir>
godot --headless --path native-godot --script art-source/candle-crowns-20261027/build-crowns.gd -- --install --textures <png dir> --record <dir>
```

The second pass, on the pieces as they are now:

```
python art-source/candle-crowns-20261027/make_textures.py <png dir>
godot --headless --path native-godot --script res://../art-source/candle-crowns-20261027/build-crowns.gd -- --rebuild --textures <png dir>
godot --headless --path native-godot --script res://../art-source/candle-crowns-20261027/build-crowns.gd -- --cut-glows
python art-source/candle-crowns-20261027/vary-crowns.py
```

Run the first pass's install on the room pieces as they were before this change (the install finds the old rings by material and size).
`--preview <dir>` (windowed) photographs the three models alone; `--textures-only` rewrites only pictures and materials.
