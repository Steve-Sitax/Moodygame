# Dressed corner stones and door and window surrounds · 17-18 October 2026

Issue #157. Installed at Steve's request on 18 October 2026, after his review of Steenplein 1, the whole-town
candidate, the neighbourhood grime and the arched and double doors.

The town's 29 city chunks lost their stone boxes for dressed stones: quoins (L courses round a corner, or single
stones where the other face is a side wall), plinths in Belgian blue stone, door jambs and lintels, door hoods and
steps, arched door rings of voussoirs with skewbacks and keys, window sills with drip grooves, heads, keystones,
friezes and hoods, and stone frames round shop windows that only had a painted one. Each stone has a 6-12 mm
chamfer (two facets below 2.2 m, one above), a drafted margin and tooled field below 3 m, chips that grow with the
house's wear, and 10 mm mortar joints on its wall's brick bed joints (`brick-beds.json`, measured from the wall
pictures). Scene nodes, transforms, permanent ids and every other triangle are unchanged.

- `promotion.json`: the 73 meshes and the material, original and installed SHA-256, counts and collision stand-ins.
- `original-resources.zip`: the 73 original meshes. Restore them to undo; delete `dressed-stone.tres` too.
- `geometry-summary.json`: pieces built and kept by kind, triangles added and removed.
- `installed-*.jpg`: the installed game (real town, disposable save): day, rain, night; fine, middle and poor houses.

Material: `native-godot/assets/materials/stone-corners-20261017/dressed-stone.tres` and `.gdshader` (the house stone
shader with a dressed branch). Light stone is ramped from the 1.2 m stone scan of the 2026-10-13 pass; blue stone uses
it as it is. Weathering follows shelter and rain (baked per vertex), ground splash and rising damp, and the
neighbourhood: the house's wear (its class) and the street-dirt map; the fine squares stay washed.

Collision: `Solid` takes each mesh's `native_solid_stand_in` faces (the old boxes) for the surface named in
`native_solid_skip`, so the 2.17 million new triangles do not reach physics (9.71 M before, 9.78 M after; load 7.9 s).
Frame cost, real town: GPU +0.0-0.14 ms, frame time unchanged, video memory +178 MB; files +83 MB.

Rebuild: `audit-stone-corners.gd -- <folder> city_`, Blender `repair-stone-corners.py` per chunk with
`brick-beds.json`, `merge-stone-corners.py`, review with `check-stone-corners.ps1 -Candidate`, then
`stone-corners-promote.tscn -- --candidate --record` in Forward+. The promotion refuses changed sources and
existing backups. Never rebuild from installed meshes: start from `original-resources.zip`.

Pass 2 (18 October 2026, #173 and #171): ground-floor quoins beside shop fronts, arched window heads, pilasters,
bands and cornices, fanlight bars and every other town-house stone, and the walls' foot grime. Record and pictures:
`../town-fabric-20261018`. Still not dressed: stone outside the city chunks (churches, prison, town places).
