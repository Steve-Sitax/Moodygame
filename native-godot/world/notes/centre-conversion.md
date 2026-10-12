# Central district recovery

`world/districts/centre-manifest.json` selects the Grote Markt, town hall, cathedral, Vleeshuis, central churches and associated homes, shops and rooms from the completed source town. The manifest holds permanent source indices/names and entrance-to-room associations; coordinates are in world space.

Run `python native-godot/recovery/full/centre_inventory.py D:\Code\MoodyGame-godot\godot\baked\next\town.glb --check native-godot/world/districts/centre-manifest.json` to verify the selection against the source. The inventory reads the GLB JSON hierarchy and transformed accessor bounds, without importing geometry or writing the source. It validates 574 name, door, room metadata and ownership checks.

The selection contains 63 direct roots, 21 rooms with 21 entrance associations and 342 church child references. Churches are under shared root 798; city-wide material/geometry chunks are shared once by the complete runtime. The editor may reference district subsets, but gameplay must retain original direct-child semantics and avoid instancing shared runtime chunks twice. Park children 1153–1160 belong to the outer district.

Use the manifest's `delegatedPlaces` for boundaries: the harbour owns Steen, Oostershuis, Vismarkt and the Poesje; the outer district owns the alley home, southern taverns and eastern/southern shops. Keep rooms with their semantic entrance even if their hidden geometry lies outside a district's visible bounds.

Preserve `ROOM_*` metadata, hidden/night-light tags, hinge nodes, opening markers and outward vectors. These drive interior visibility, working keepers and navigation; a decorative exterior alone does not restore the game.

Apply the edge rule in the repository `AGENTS.md` to every converted asset. Inspect tops, backs, ends and undersides in dry light, rain and darkness. Bevel visible stone/cast-metal/wood silhouettes appropriately; normal maps add small relief afterward. Record intentional sharp features in asset notes, and keep user placements and unsaved layouts intact.

The Grote Markt and Vismarkt intake groups remain editor references. At runtime `NativeMarketIntakeMask` hides those frozen pictures before navigation is built; `NativeMarket` supplies market-day layouts, live collision, sellers and shoppers from native models. Layout definitions are in `services/data/native-extras.json`. Keep runtime replacements separate from permanent authored objects, and remove their live collision when they pack up. Courtyard hens/goats follow the same replacement rule.

Steen museum visitors use the real crowd and doorway: outside approach, looking, entry, no street puppet while inside, then exit before departure. Opening hours come from the game clock. The disposable rendered test needs `--native-extras-proof <output> --db <output>/game.sqlite --prefs <output>/settings.json --author-root <output>/layouts --no-ai` and `SCHELDEMIST_USER_DATA=<output>/userdata`. Source comparisons passed; the rendered market/museum/courtyard test passed 37 checks with clean shutdown (`proof/native-extras-e06cc7887bef4255af0790c1c69c669f/native-extras.json`). Observe every frame for short visitor transitions. See `services/README.md` for the complete launch command, rule proofs and shared service lifecycle.

