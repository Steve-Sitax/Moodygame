# M7 - Sint-Carolus Borromeus, 2026-09-26

Steve, 2026-09-26, with a picture of the real front on the Conscienceplein: "change this church, make it look
like the image. add details/textures. also search online for the inside, make codex generate reference images
and create a detailed interior. we must be able to walk in and out."

Part 1 (this note so far): the front and the sides. Part 2 (the interior, walking in and out) follows.

## What the church was like (reference only, nothing copied)
- The front is about 32 m wide and 33 m high without the cross, as broad as tall. It has seven bays in two full
  storeys, and a crown over the middle three with a triangular pediment and a great volute each side. Bays 1 and
  7 are stair towers, set back, each with a small stone-domed lantern and a gilded pineapple.
- Doric below, Ionic in the middle, Corinthian on the crown. The wall and the sculpture are cream sandstone
  (Balegem stone). The columns, pilasters, cornices and frames are grey-blue hardstone (bluestone). The cross,
  the pineapples, the fire-pots and the dates are gilded.
- One big round-arched main door; its wooden soffit is carved with a radiant sun. A smaller side door in each
  aisle bay with a triangular pediment. St Peter and St Paul in niches beside the main door (new statues in
  1868). The Evangelists above. The IHS medallion with angels and a gilded winged crown in the middle storey.
  The bust of St Ignatius on the crown. A Madonna relief in the pediment.
- F. Berckmans restored the front, finished in 1865: in 1873 it was newly restored.
- Steps led up to the doors (seven at first; the square was raised later).
- Inside (for part 2): a basilica of nine bays with no transept, about 60 m long. Doric columns below, Ionic on
  the galleries over the aisles. In 1873 the columns were grey stone (the white marble ones burned in 1718). After
  the 1718 fire the nave has a wide barrel vault with broad transverse arches; the 39 Rubens ceilings are gone.
  The aisles and galleries have flat stucco ceilings. The choir apse has a stone half dome. There are 8 windows
  each side at gallery height. The high altar is marble with a black frame, and behind it a case with four
  grooves and a pulley to change the painting. The Lady Chapel (south) is in coloured marble with mirrored
  veining and has a white marble rail. Oak confessionals with angel herms stand in the aisles' panelling (Van
  Baurscheit, about 1720). The oak pulpit is by Van Baurscheit II. The organ on the west gallery dates from about
  1720. The floor is black and white marble in a maze-like pattern.
- Pages read: https://en.wikipedia.org/wiki/St._Charles_Borromeo_Church,_Antwerp ,
  https://nl.wikipedia.org/wiki/Sint-Carolus_Borromeuskerk_(Antwerpen) ,
  https://inventaris.onroerenderfgoed.be/erfgoedobjecten/4118 ,
  https://topa.be/en/sint-carolus-borromeus/beschrijving/voorgevel/ (and its pages on the history of the front,
  the interior, the high altar, the confessionals, the pulpit, the Lady Chapel, the tower, the galleries, the
  Xavier chapel and the organ), https://mkantwerpen.be/en/churches/st-charles-borromeo-church/ ,
  https://aviewoncities.com/antwerp/st-charles-borromeos-church ,
  https://www.okv.be/archief/aguillon-huyssens-en-rubens-sint-carolus-borromeuskerk .

## Codex pictures
Made with gpt-6-sol through the locked-down Codex command (no names, paths or code in the prompts).
- Concept pictures, kept out of the repo (the scratch folder of this session): the nave toward the high altar,
  the side aisle with the confessionals, the Lady Chapel, and the front at street level in the rain.
- Textures, in the repo with a row each in `assets/ATTRIBUTION.md`: `carolus_sandstone.jpg`,
  `carolus_bluestone.jpg` (client/public/textures), and the pediment's relief and the IHS medallion
  (`tools/blender/art/`, built into the church's atlas). Made but kept for part 2: black and white marble floor,
  marble panels, dark carved oak, plaster vault.

## The front (part 1)
| Part | What | Where |
|---|---|---|
| The front | A slab 1 m thick, 25.6 m wide between the stair towers, 33 m to the pediment's apex. The ground and middle storeys run the full width; the crown stands over the nave. | `tools/blender/build_churches.py` `carolus()`, numbers in `CF` |
| Orders | Free bluestone columns on pedestals (8 Doric, 8 Ionic with volutes, 4 Corinthian with leaves), pilasters, entablatures that break forward over them (architrave, sandstone frieze, cornice in two steps) | `column`, `pilaster`, `pedestal`, `stack` |
| Between the storeys | Pedestals and turned balustrades | `balustrade` |
| Doors | The main door 3.4 x 7.2 m in a 1 m deep bluestone reveal, a moulded arch, a keystone, a segmental pediment on consoles; the carved door with the radiant sun over it (painted). Side doors with eared frames, a cartouche and a pediment, a round window over each. | `door_main`, `door_side` in the atlas |
| Sculpture | 10 saints in niches with shell heads (Peter and Paul, the Evangelists and two more), the bust of Ignatius under a gilded wreath, the IHS medallion (Codex picture) in 24 gilded rays, two kneeling angels, a gilded winged crown | `statue`, `angel`, `disc` |
| Crown | The two volutes (a plate with a rolled rim and two eyes), the pediment with the Codex relief, the raking cornice, two gilded fire-pots, the gilded cross | `volute` |
| Stair towers | Set back 0.5 m, pilasters and bands, three windows; an octagonal lantern with louvres, a stone dome, a gilded pineapple | |
| Sides | The nave 13 m wide (eaves 20.8 m, ridge 25.2 m, 8 m under the pediment's apex), the aisles 6.3 m with 5 or 6 tall round-headed gallery windows each side, the apse, the tower behind the choir (as before), the Jesuit house and the Lady Chapel narrower beside the towers, low ranges behind the towers | |
| Terrace | Bluestone slabs 0.6 m over the square before the front, three flights of four 0.15 m steps to the three doors, an iron railing on a stone kerb with piers between the flights and along the ends | `carolus_terrace`, `shared/carolusPlan.ts` |
| Weathering | Soot washed down under each cornice (the walls darken over 2.4 m under them), damp at the foot, dark reveals and niches; the textures have their own stains | `carolus_grime` (vertex colours) |
| Materials | `carolus_sand` and `carolus_blue` take the Codex pictures in the game; `carolus_art` is the front's own 512 px atlas (the relief, the medallion, the doors, the niches' backs, the cross windows); `church_gilt` is drawn with a little light of its own | `world/churches.ts` |

Colour pass (after the lead's review, same day): Steve's picture is a pale honey front, so the sandstone rules
now. Bluestone only on the column shafts and capitals, the pedestals, the plinths, the terrace and one thin bed
moulding in each cornice; frames, pilasters, balustrades and pediments are sandstone. The statues and angels
are a pale stone of their own (`carolus_pale`), the gilding is brighter, the soot and damp are halved. The
pictures were made lighter and warmer, and the game lifts the Carolus's stone with a tint over 1
(`CAROLUS_TINT` in `world/churches.ts`: it acts on daylight only, so nothing glows at night). The volutes got a
deeper rim, an inner line, leaves and stepped eyes; the pediment's clouds, angels and sun stand out of the
tympanum with the relief on their faces. Pair: `carolus_colour_pair.jpg` (mist above, clear below, before
left); best single shot `carolus_colour_after_high.jpg`.

The walk: the terrace and its steps have their heights (`frontFloor`, used by `world/rijnkaai.ts baseAt`), the
railing and its piers are colliders (`frontSolids`), and nothing the town sets down stands on the terrace or 2.5 m
before it (`frontKeepOut`, in `world/doorKeep.ts`). Everything else stays inside the landmark's rectangle: the
columns' pedestals start at its edge.

The model: `church_carolus` 28.9k triangles (the whole `churches.glb` 55k), 10 materials. The glb's texture
coordinates are now kept at 16 bits (the pictures are 1024 px a repeat). The plane check on the exported file
finds no faces in one plane and none within 5 cm. St Paul, St James, the park and the pump are unchanged.

## Checks (part 1)
- Blender: `build_churches.py` builds, the plane check reports 0 and 0, nothing flat at y 0.
- In the browser on a test copy (`node tools/teststack.mjs start carolus --server 8948 --vite 5348`), 13:00 clear:
  Jef walked from the square up the middle flight (eye 1.6 to 2.2 m, feet 0.6) to the front, and stopped at the
  landmark's edge (z 167.5). The railing stops him (z 165.7 before it); the end railings close the terrace's
  ends. `paths()` lists nothing.
- `zfight({list: 300000})`: nothing from the churches round the Carolus (the 28 pairs near it are the houses'
  own, known ones).
- `perf(30)` on the square facing the front (hidden pane on a loaded machine, so about 48 ms a frame either
  way): the churches' model costs 28 draw calls and 47k triangles there, and no time one can measure
  (48.8 ms without it, 48.4 ms with it).
- `npm run build`: the client builds. The server's typecheck stops on `auditSave` and `auditCounts` in
  `server/src/index.ts`, another helper's work in progress (not touched here).
- Pictures (`data/shots/`): before `carolus_before_above`, `carolus_before_close`; after `carolus_after_square`,
  `carolus_after_high`, `carolus_after_door`, `carolus_after_terrace`, `carolus_after_above`; Blender's own
  `churches_carolus_above.png`, `churches_carolus_square.png`.
