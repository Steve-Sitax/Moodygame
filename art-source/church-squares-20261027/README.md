# Church squares · 27 October 2026

Steve: houses hug the churches (all but the cathedral); clearing them shows the churches and gives open squares for
little shops, trees, people gathering and events. Also: trees on the sandy patches.

## Cleared

`raze.json`: the 62 houses whose outline comes within 2.5 m of a church model's plan (`foot-<church>.json`, from the
church's triangles under 4 m: the landmarks' data outlines are much smaller than the models): Sint-Carolus 5,
Sint-Paulus 20, Sint-Jacob 37. The De Zwarte Kat tavern (house 440, a named café with an interior) stays.
Marked `"gone": true, "razed": true` in `world/data/shared/city_build.json`; `NativeRazedHouses.Cut` takes their
triangles, collision stand-ins, street dressing, copies, shop fronts and window light out at load. None held a named
home, shop, job or story place; their 34 generated homes go (a new game houses everyone at the remaining doors).
Removed with them: their 153 poster walls (`services/data/native-ideas.json`) and, in `street-furniture.json`, 6 cellar
hatches, 3 wash poles and 19 washing lines fixed to their walls. House 495 shares its wall's mark (alpha 213) with
standing house 441 and stays as baked.

## The squares

`world/town/squares.json` (`native-godot/scripts/paving/squares.py`), set by `NativeRazedHouses.Dress` from the town's own
tree copies (solid trunks, swaying, falling leaves): 45 limes and planes on the squares, 99 elms, limes, planes and bare
trees on the wide bare earth by the town wall, the cathedral corner's lime as before; 23 benches (the cathedral corner's
`razed-corner-bench` kept), most facing a church.
`NativeRazedHouses.Filter` now leaves a mesh whose every triangle is cut without surfaces (an empty surface could not be
built and shifted the materials of the surfaces after it).

## Checked

Game photos from above and at street level at the three churches; omnibus and traffic route audit 0 hits; ideas,
transport, shop, courtyard proofs pass; the homes/night proof fails on main before this change too (#220).

## Not yet

Market stalls, events and gathering on the new squares (the place lists), and the bared side walls of the neighbours.
