# The Ruien: 2D plan, second draft (2026-10-18)

Steve redrew the network for gameplay (`steve-plan-2026-10-18.png`): red is a giant gallery, blue a rui, thick
patches are halls, rooms and gates. This folder works that drawing out. Nothing in the game changes yet.

- `ruien-plan.html`: the plan over the town map. Layers switch on and off; hover anything for details. It also has
  the sections to scale and tables of the halls and lines. `ruien-plan.png` is the same as one flat picture.
- `concepts/`: ten mood pictures, one per kind of space (made with Codex image generation, 2026-10-18).
- `references.md`: what the real Ruien and the sewers of Paris, London, Brussels and Hamburg of the time were like, with
  sizes and links to pictures.
- `ruien-network.json`: sizes, levels, names, the spacing of ladders, stairs and lamps. Edit this.
- `ruien-traced.json`: the lines, rooms and gates read from Steve's picture by `tools/ruien/trace.py`.
- `ruien-routes.json`: the result. Rebuild with `python -I tools/ruien/plan.py .` from the repo root (5 s).
  After a new drawing: `python -I tools/ruien/trace.py <drawing.png> docs/plans/ruien/ruien-traced.json
  native-godot/world/data/shared/city.json native-godot/world/data/public/city/walk.png` first. A drawing must keep
  `ruien-plan.png`'s frame (2 px per metre, top edge x 340, left edge z -80) and its red and blue.

## Sizes (Steve, 2026-10-18)

Antigoon becomes 4.4 m tall (1 m less; not yet changed in the game).

| Kind | Inside | Floor, water, walkway | Antigoon |
|---|---|---|---|
| Giant gallery (red) | 6 m wide, 5.2 m from the floor to the roof | Floor -6.1 m. Water 1.5 m deep as a rule, 2.4 m at most (his waist). A 1.5 m ledge on each side at -3.6 m. | Upright, 0.8 m to spare |
| Hall (red patch) | As wide as drawn, same depth as the galleries | Brick piers carry the vaults. Big by its area, not its height. | Upright |
| Rui (blue) | 3.6 m wide, 4 m from the water's bottom to the roof | Floor -4.9 m. Water about 0.5 m deep. A 0.8 m walkway at -3.9 m, above the water. | Bends about 0.6 m |
| Junction room (blue patch) | As drawn, rui depth | Where ruien meet; a stair down from the street. | Bends |
| Side drain (green) | 1 m wide, 1.6 m high, egg shape | Carries the street gullies to the ruien. | Does not fit |

Why the giant galleries are not higher: the roof must stay 0.9 m under the street, and the river at low tide lets
the water inside go down to about -4.6 m and no lower. A floor deeper than that always has water on it. A 6.5 m
gallery would have 2.8 m of water; a 5.2 m one keeps it at his waist.

All sizes sit inside the real range: Antwerp's vaults run from about 3 x 2 m to 9 x 6 m; the main Paris collectors of
the time were 5 to 6 m wide with a 3.5 m water channel (`references.md`).

## The network

- 2.2 km of giant gallery, 3.6 km of rui, 6.5 km of side drain. 892 of the 904 street gullies are within 40 m of a rui.
- Three halls: under the Grote Markt (C1, 30 x 28 m, Antigoon's refuge), by the Vleeshuis (C2, 19 x 28 m) and by the
  north rampart (C3, 16 x 14 m). Eight junction rooms.
- Where a vault is wider than the street above, it runs under the house fronts, as the real Ruien do (490 m of
  gallery, 1.2 km of rui). The 3D work must keep cellars and foundations clear of the vaults.

## Gates

- Giant size: Steen gate (O1), vliet sluice (O2), Brouwers sluice (O4), canal head (O6), Jans gate (O7), Noorder gate (O10).
- Normal: Rijnkaai (O8), Paulus (O9). The Kipdorp flush sluice (F1) lets moat water in to flush the ruien.
- Bassin boat door (P1), Steve drew it on the Petit Bassin's wall. The lock holds the Bassin at -0.7 m, so it can never
  take water out of the ruien. The plan makes it a closed door for boats. (Steve to confirm.)
- Each gate is a pair of tidal doors: the rising river pushes them shut; they open when the river falls below the
  water inside. Deeper waterways are not needed.

## Ways in and out, and light

- 148 ladders up through street grates: about one every 45 m along every gallery and rui, and one over every
  junction, always under a street. A grate lets daylight in by day and lamp light at night.
- 18 stairs: one into every hall and room, the named ones (Steenplein, Stadhuis cellar, Jesuit stair, Kipdorp sluice
  house, Rode Poort), and more until no point is farther than 110 m from a stair.
- Hatches at the Vismarkt and the Vleeshuis, an inn's cellar door, air shafts, and the fallen vault (X1) as an option.
- 45 dim lamps where no grate, room, gate or stair lights the way, so no point is more than 20 m from some light.
  Period fact: men were told to carry safety lamps, not open flames, because of sewer gas (`references.md`).
- For the 3D work: the shader-kind and light-count rules still hold. Most lamps and grates will be glow and painted
  light, with only the nearest few as real lights. Measure before choosing.

## Open questions for Steve

1. Antigoon bends about 0.6 m in a rui. That needs a bent-over walk. Or he becomes 3.85 m and walks upright.
2. Confirm the Bassin boat door (P1).
3. The names are a first guess (`ruiNames` in the network file); change any.
