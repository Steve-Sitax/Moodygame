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

## Second clearing · 27 October 2026

Steve marked more houses on top views of Sint-Paulus and Sint-Jacob. Cleared: Sint-Paulus 178, 179, 186, 190, 191, 193,
200, 202, 206, 207; Sint-Jacob 445, 446, 450 to 455 and 492 (`raze.json` now holds all 81). None held a named home,
shop or job. Removed with them: 36 poster walls and, in `street-furniture.json`, 4 cellar hatches, 2 wash poles and
11 washing lines. `squares.py` now plants on every razed plot within 20 m of a church (the Sint-Jacob ones lie 8 to
16 m off its plan): 27 trees and 13 benches at Sint-Paulus, 40 and 20 at Sint-Jacob.

Steve also saw a gutter floating over a cleared plot. `NativeRazedHouses.Cut` now also takes:
- triangles whose alpha is the house's less or more one, when nearer to it than to any standing house (the gutter
  repair's iron, #163, mostly carries its house's alpha less one);
- the drainage iron and the dressed stone by place alone (their alpha is often a neighbour's): near a razed house and
  nearer to it than to any standing one;
- anything above 0.5 m standing 0.3 m or more inside a razed outline (chimney caps with another house's alpha);
- house 454, a sliver outline with no triangle a full 0.4 m inside it: its alpha is then read from the triangles inside.
`Gutters` leaves out the broken-gutter stains and streams on a razed house's wall.

## Leftovers swept · 27 October 2026 (#224, #229)

`--razed-scan <file>` (`NativeRazedScan`, dev) lists every drawn triangle and copy 0.5 m or more up, within 1.5 m of a
razed outline and nearer to it than to a standing house; churches, trees, churchyard, square dressing and benches apart.
`--razed-scan-box x0,z0,x1,z1` lists a box instead, `--razed-scan-ray x,y,z,yaw,pitch,fx,fy` the triangles under a picture's
point. Outside the churches and their yards: 121 groups, 2379 triangles before; 25 groups, 72 after (the cart's two
barrels, moved there on purpose; single wall triangles of standing neighbours on the shared line; a low street piece). Causes:

- Street dressing went a triangle at a time, so a lean-to roof running into standing house 210's wall kept its half on
  that side and hung on the bared wall (the red-brown piece, #224), and a striped awning 1.4 m off razed house 459's back
  wall stayed (#229, the cut reached 1.2 m). Now a piece (triangles joined by their corners) goes whole when most of what
  shows of it is within 2.5 m of a razed house and nearer to it than to any standing one.
- The bake's grime decals (soot, rust, damp) carry their strength in the colour alpha, not a house's: they now go by place.
- Three razed chimneys still smoked (the dark bands in the Jacob south-west sky, #224): their smoke points go.
- House 495, razed but left as baked (its alpha shared), now counts as standing for what lies nearer to it.

Not in this lane: the Sint-Paulus north door's flat infill and the Jacob churchyard wall's sharp top are part of the church
models (`church_stpaul_4`, `church_stjacob_6`).
