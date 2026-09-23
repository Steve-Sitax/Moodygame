# M3d - The compact city, 2026-09-23

Why: Steve, after flying over the real-scale city (M3c): "it is way too big. We should keep historic buildings and locations but closer together and cut heavily on streets in between. It takes very long to walk around and that is not fun. Edges are completely jagged, bridges are now just land. Do a map redesign. No detail in boats, no people, cranes, storage houses. Look for images of that time." He sent period photos (the Steen quay, the Schipperskwartier, the Vlaamse Kaai, the Quai Godefroid) and a link to a scan of the Steen.

## The design (`tools/city/design.py`)
A designed map, not a trace. The real places stay, in their real order along the river and at their real size; the ordinary streets between them are cut short. North to south:

| Place | Notes |
|---|---|
| Eilandje | The Petit Bassin (Bonapartedok, 100 x 64 m) with its lock and a timber swing bridge; the Entrepot along the dock; storehouses; the Hanseatic House (Oostershuis, burned 1893) with its tower. |
| Rijnkaai | The game's quay as before: pier, the Anna Maria, the widow Peeters, the Hessenatie (doors on real houses, `DOORS`). |
| Canal des Brasseurs | 12 m wide, quays on both sides, three stone arch bridges. |
| Vismarkt quarter | The fish market by the river, the Sint-Pietersvliet (8 m) with two bridges, the Vleeshuis. |
| Steenplein | Het Steen on its bastion in the river, rows of trees, a railing along the water, gas lamps; the doss house faces the square. |
| Werf | The river quay, the ferry pontoon on barges. |
| Grote Markt | The town hall on its west side, guild houses on the north and south sides, then the Handschoenmarkt and the cathedral. |

From the start on the Rijnkaai to the Grote Markt: about 275 m, 80 s hurrying (was about 800 m). Every edge is straight; bridges are decks over water (the water shows under them, the deck is walkable).

## Blocks and buildings (`tools/city/plan.py`, `tools/blender/build_city.py`)
- Block kinds: houses (plots as before), warehouse and entrepot (one long storehouse: loading doors up the front, hoist beams, a loading gate), guild (tall narrow houses with stepped or bell gables).
- Bridges: stone (arch, parapets with coping) and swing (timber deck, iron railings). The pontoon comes from `boats.ts`.
- Street furniture after the photos: trees in autumn leaves on the Steenplein and the Werf, iron railings along the water, gas lamp models along quays and squares (design `DECOR`).
- Landmarks (`build_landmarks.py`): the Steen rebuilt after Steve's photo (tall slim tower with a spire and weathervane, the main hall with two stepped gables and dormers, two round towers with pointed roofs, a battlemented gallery, a squat round tower); the Hanseatic House (four wings round a court, a tower with an open lantern and a spire).
- The Sketchfab scan of the Steen: not downloadable, no licence (all rights reserved), and the Steen of today (after the 1889-90 restoration). Not used; looked at for shapes only.

## Helpers (agents, in parallel)
| What | Where | Notes |
|---|---|---|
| Ships and cranes | `tools/blender/build_boats.py` -> `boats.glb`, `client/src/world/boats.ts` | Barque, steamer, Rhine barge, hengst (Flemish sailing barge), lighter (empty, loaded), tug, paddle tug, sloop, rowboat, punt, pontoon section, portal crane (swinging jib), hand crane. `mooreAlong` lines a quay with boats (instanced), `pontoon` lays the ferry walkway. Boats bob and roll. |
| Townspeople | `tools/blender/build_people.py` (15 new: dockers, docker with a sack, porter, carter, fishwives, maid, boy, girl, gentleman, priest, police agent, sailor in oilskins), `client/src/game/crowd.ts` | About 32 people by day, 8 at night with lanterns: strollers in pairs, groups talking, people at the water's edge, dockers carrying sacks, carters with handcarts. They keep clear of the player. Dev test page `client/crowd-test.html`. |

In the game (`rijnkaai.ts`): ten portal cranes on the quays; boats moored along the Werf, the north Rijnkaai, both walls of the canal and the vliet, and all four quays of the Petit Bassin; a steamer, two barques, a paddle tug and a sloop on the river; the ferry pontoon.

## Also fixed
- House and landmark textures: no affine warp (big faces swirled).
- Autumn tree colours in linear light.

## Checks (2026-09-23)
- `npm run build` passes, `npm test` 58 of 58, path check lists nothing.
- Browser, by script, sound off: the city, landmarks, boats, cranes and crowd load; views of the Steenplein, the canal, the Petit Bassin, the Steen; the crowd walks (19 people at 11:00 round the Steenplein). Frame time with the GPU finished: 5.4 ms on the Rijnkaai, about 500 draw calls, 158k triangles.
- Steve's save was not touched by the checks.

## Next
- Draw calls: merge the boats per type, and the crowd's parts.
- The Anna Maria is still the old code ship; swap it for the barque model with a walkable deck.
- More detail after the photos: rails in the quay cobbles, barrel stacks, awnings and shop signs, chimneys smoking.
