# The Ruien: 2D plan, first draft (2026-10-18)

Steve asked for a plan of the Ruien under the town, as an overlay on the map, before any 3D work. This folder holds it.

- `ruien-plan.html`: the plan. Open it in a browser. Layers switch on and off; hover a line, gate or door for details.
  It also has sections drawn to scale and a table of the lines.
- `ruien-plan.png`: the same plan as a flat picture. `ruien-sections.svg`: the sections alone.
- `ruien-network.json`: the design input (sizes, levels, giant galleries, gates, hall, ways in and out). Edit this.
- `ruien-routes.json`: the routed result. Do not edit it; run `python -I tools/ruien/plan.py .` from the repo root (2 s).

Nothing in the game changes yet. The plan reads `city.json`, the walk mask and the 904 gully records in
`native-godot/world/town/drainage/ruien-inlets.json`.

## What the real Ruien were like

- About 8 km of canals and moats, the oldest from about 1250. Vaulting started in the 16th century. By 1835, 75% was
  covered. The Brouwersvliet was the last open one, vaulted in 1882. So in 1873 the game's open Canal des Brasseurs is right.
- Brick and stone vaults of about 200 kinds. A guide gives the range: the biggest are about 9 m wide and 6 m high, the
  smallest about 3 m wide and 2 m high. A drainage channel 15 to 50 cm deep runs along the tunnels.
- The town flushed them with sluices (schuiven): shut at high tide to hold the water, opened at low tide so the current
  carried the dirt to the Schelde. That is the same idea as Steve's gate.
- Visitors go in at the Ruihuis, Suikerrui 21, near the Grote Markt. The Jesuits had their own way in at the Carolus
  church. Large air shafts bring fresh air down.

Sources: [ruien.be](https://en.ruien.be/), [From Place to Place](https://fromplacetoplace.travel/belgium/antwerp/ruien/),
[Go Eat Do](https://go-eat-do.com/2026/08/antwerpen-ruien-underground-canals-in-antwerp/) (the 9 x 6 m and 3 x 2 m sizes
come from a guide, not a survey).

## The three sizes

| Kind | Inside | Who fits | Length in the plan |
|---|---|---|---|
| Giant gallery | 5 m wide, 6 m from the channel bed to the crown, a 2.4 m water channel, a 1.2 m ledge each side | Antigoon upright in the channel, people on the ledges | 389 m |
| Rui | 3 m wide, 3 m high, one 0.8 m ledge | People upright | 2.7 km |
| Side drain | 1 m wide, 1.6 m high, brick egg shape | People bent over; not walkable in the game at first | 10.5 km |

All three sit inside the real range (3 x 2 m to 9 x 6 m).

## Can Antigoon fit?

- He is 5.4 m tall; his collision capsule is 5.2 m and the town check wants 5.5 m of headroom.
- In a giant gallery he stands upright in the water channel with 0.6 m to spare. He does not bend.
- In a rui (3 m) he does not fit, even bent double (about 3.3 m; an estimate, not measured on the model).
  He has no crawl animation (`docs/antigoon-story.md`). So the ruien are a safe place for Jef.
- The real smallest vault (3 x 2 m) and the side drains are far too small for him.

## Levels (street and quay top are 0 m)

- The tide in the game (`Tide.cs`): high water about -0.65 m (-0.40 at most), low water about -4.95 m (-5.20 at spring,
  -4.71 at neap). The Petit Bassin is held at -0.7 m by the lock. The canal and vliet beds are at -5.05 m.
- Every crown is 0.9 m under the street (paving, fill and the brick vault).
- Giant gallery: crown -0.9, ledges -4.2, channel bed -6.9. The gate sill is -4.5, so 2.4 m of water always stays in
  the channel (the real Ruien also have a stretch deep enough for a boat). Antigoon wades in it to the thigh.
- Rui: bed -4.3 at the gate, rising 1:1000 upstream (-3.94 at the farthest head). It ends on a giant gallery's ledge
  or at its own gate.

## Gates and the tide

- Each gate is a pair of tidal doors. The rising river pushes them shut, so high water cannot get in. When the river
  falls below the water inside, they open and the ruien drain.
- Sills at -4.3 (rui) and -4.5 (giant) are above the lowest neap tide (-4.71), so every gate opens on every low tide.
- No gate opens into the Petit Bassin: it is held at -0.7 m and would never let the water out.
- The Kipdorp flush sluice (F1) lets moat water in at high tide, to flush the ruien at the next low tide.
- **Deeper waterways are not needed.** The sills sit above the canal and vliet beds (-5.05) and above the canal's still
  water at low tide (-4.75). Water can never drain below low tide anyway, so a deeper canal would not empty the
  galleries further. Check in 3D that the riverbed in front of the Steen gate is at least -5 m.

## How the network was made

1. The three giant galleries are drawn by hand: Suikerrui (the hall to the Steen gate), Vleeshuisrui (the hall past
   the Vleeshuis to the vliet sluice), Brouwersrui (to the canal's south wall). They link the Steen, the fish market
   and the meat hall, as the story wants.
2. The hall under the Grote Markt (30 x 28 m, 7 m high, brick piers) is the story's one large chamber.
3. Each of the 904 gullies flows along the streets to the nearest gate or giant gallery. A street that carries 12 or
   more gullies gets a rui; the rest get side drains. 848 gullies are within 40 m of a rui, all but one within 80 m.
4. Lines keep to the middle of the widest street. Where a street is narrower than the vault, the vault runs under the
   house fronts, as the real Ruien do: 19 m of giant gallery and 142 m of rui.

## Ways in and out

| Kind | Where |
|---|---|
| Giant size | Steen gate (O1, the story's "large river outlet"), vliet sluice (O2, by the fish market), Brouwers sluice (O4, by the Vleeshuis) |
| Stairs | Sluice keeper's stair at the Steenplein (the story's side stair), Stadhuis cellar, Jesuit stair at the Conscienceplein, Kipdorp sluice house, Rode Poort guard stair |
| Hatches | Vismarkt waste hatch, Vleeshuis cellar hatch |
| Cellar door | An inn in the Sint-Jacobs quarter (a story hook) |
| Manholes | 27, every 80 m along the galleries and ruien, plus named ones at the Lijnwaadmarkt, Sint-Jansplein and the cathedral |
| Air shafts | The hall's chimney, dressed as a pump at the Grote Markt; one by the Vismarkt |
| Option | A fallen vault in a yard behind the Steenplein: a dry way out for Antigoon |

## Open questions for Steve

1. Do the gates also lock Antigoon in? If yes, he can only go out while the river is under the sill: about 2.6 h around
   each low tide, every 12 h 25 min. An autumn night is long enough to hold one such window. The fallen vault (X1)
   would then be his only other way out.
2. Should the ruien stay too low for him (as now), or be 4 m high so he can follow Jef bent over? That needs a new
   bent-over walk animation.
3. The hall now also takes the drainage of the south of the town, so it stays wet and smells. Keep that, or give the
   south its own gate on the Schelde?
