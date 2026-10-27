# Sanctuary lamps and gas brackets · 27 October 2026

Issue #227: the churches had no sanctuary lamp (the red lamp that burns by the high altar day and night) and no gas
lighting. Antwerp had town gas from the 1840s; its churches had gas brackets by the 1870s.

## What is there (`build-church-lamps.gd`, faces by the candle crowns' builder `crown_mesh.gd`)

| Model | Where | Triangles |
|---|---|---|
| `sanctuary-lamp` | one by each high altar: Sint-Paulus, Sint-Jacob, Sint-Carolus, the cathedral | 16 840 |
| `sanctuary-cord-<church>` | its cord to the vault (15.4 to 24.7 m) | 596 to 824 |
| `gas-bracket` | four on the nave's pillars in each church | 3 524 |

- The sanctuary lamp: a turned brass bowl 236 mm across with a knop and finial under it, a rolled rim and a band of
  cast beads; a turned lid with a round opening, the ruby glass (#650F20) standing in it on a ring and rising 60 mm clear
  of the lid so its red shows from the floor; three brass chains of real links (6-sided
  wire, 6 segments an end) from lugs on the rim to a turned canopy with an eye, 0.75 m over the rim; a tarred cord from
  the eye to an iron hook under a plate in the vault (it lowers the lamp to fill its oil). The bowl's rim hangs 2.75 m
  over the floor, 5 to 6 m in front of the high altar and off its axis.
- The gas bracket: a cast-iron round wall plate (136 mm, rolled edge, a boss), the gas pipe out 0.38 m and bent up
  into a turned brass gallery with three screws, a fishtail burner, an opal globe 160 mm across (2.5 mm glass, open at
  the top, lips rounded), a brass plug cock with its lever on the pipe, a cast scroll under it to the plate. The plate
  sits 2.85 m over the floor on the pillar's nave face, 5 mm into the stone (a round pillar meets the flat plate at its
  edge).

Edges: cast iron 2 to 3 mm rounds; turned brass in its profile; the glass lips rounded. Materials: the crowns' aged
brass (`crown-brass.tres`) and iron (`crown-iron.tres`); `ruby-glass.tres` (ruby #650F20, a glow of its own day and
night) and `opal-glass.tres` (milk white, its glow set by ChurchLight.cs after dark, shaped by `opal-glow-texture.res`), both on the cathedral fittings'
shader kind (r000557): no new shader kind. No collision: everything hangs or stands above reach.

## Placing and light

ChurchLight.cs (`Fittings`) hangs them in each church's room at places measured from the church's own faces (the
floor, the vault over the lamp, the pillar's face at 2.8 m; `D:/Code/ScheldemistWork/crowns2/tools/probe.gd`). The
sanctuary lamp's ruby glass glows day and night (its own emission and a small red halo at the glass top, drawn 3 cm
toward the eye only so the brass bowl hides it from below: a halo drawn in front spread red over the brass, Codex
2026-10-27); the brackets' globes glow after dark with the crowns (their opal glass's emission, brightest on the lower
belly by a glow picture along the glass's section, and a halo 34 cm across each). Glows only: no light more, each church keeps its ten.

## Reproduce

```
godot --headless --path native-godot --script res://../art-source/church-lamps-20261027/build-church-lamps.gd -- --install
godot --path native-godot --script res://../art-source/church-lamps-20261027/build-church-lamps.gd -- --preview <dir>
```
