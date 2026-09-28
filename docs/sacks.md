# Sacks: one model everywhere

Steve, 2026-09-28: "If a model changes change it everywhere you use it", "text on sacks loaded should also be that
text in cart and also if unloaded and dropped on the ground", "all must be variable/dynamic". The CLAUDE.md rule
"One model per thing, changed everywhere" came from this work.

## The parts

- `shared/goodsCatalog.ts`: the goods (coffee, rye, wheat, oats, barley, malt, beans, rice, sugar, salt, potatoes,
  chestnuts, onions, coal, flour). Each has a look (fullness, lumps, sag, cloth colour, weave, dust, kg) and origins
  with merchants' marks. `SACK_BY_PLACE` says which goods lie where. `pickSack(seed, place)` and `sackOf(goods, seed)`
  pick the label, the same on every PC; one lot, one label.
- `client/src/game/sackModel.ts`: the one sack model. Lying (the default: piles, carts, boats, pallets), standing (by
  a scale, against a wall, under a stall, coal), open (a market sack with its goods heaped in the mouth). The canvas
  texture has the weave, the dust and the stencil (what, from, kg, mark). Materials are psx Lambert with a map: no
  new shader kind.
- To add a product: add an entry to `SACK_GOODS` (pick a cloth, weave and dust) and name it in `SACK_BY_PLACE` or
  give it to a run. Nothing else changes.

## Sacks inside Blender models ("sockets + _bare")

A builder records every sack it would draw (its matrix in glTF axes, its size, lying/standing/open, and its goods
when fixed) into a `*_sack_sockets.json` next to the game code, and builds a `<name>_bare` copy without them. The
game draws the bare model and puts the one sack model in each recorded place (`swapSacks` for loaded model sets,
`sackPuts` for merged scatter, per 64 m chunk and material). A model without a bare copy is sacks only.

| Builder | Sockets file | Models |
|---|---|---|
| build_people.py | game/people_sockets.json | carried sacks |
| build_props.py | world/props_sack_sockets.json | handcart, scale, sack truck, piles |
| build_quaygoods.py | world/quaygoods_sack_sockets.json | handcart_loaded, sack_truck, weigh_scale |
| build_stalls.py | game/stalls_sack_sockets.json | open and standing market sacks |
| build_boats.py | world/boats_sack_sockets.json | lighter_loaded, bumboat |
| build_ferry.py | game/ferry_sack_sockets.json | ferry, landing_stage |
| build_clutter.py | world/clutter_sack_sockets.json | sacks against the wall |
| build_lively.py | game/lively_sack_sockets.json | spill_sacks (open), spill_coal (standing coal) |
| build_quayfurniture.py | world/quayfurniture_sack_sockets.json | grain_pallet |

Standing sacks have their stencil on local -x. Record them turned so -x faces the model's front (the street).

Code-built sacks use the model directly: goods items and piles (`goods.ts`), cart and dray loads (`traffic.ts`),
puppets and carried sacks (`crowd.ts`, `humans.ts`), train wagons (`railway.ts`), hall storerooms
(`landmarkHalls.ts`), rooms (`interiorKit.ts`), mill sacks (`mills.ts`).

## Checks

- `__scheldemist.shaders()`: `problems` empty.
- `__scheldemist.propcheck()`, `stallcheck()`, `paths()`.
- Pictures: `shotFrom` does not run street life's fog cull; `t.go` near the spot first, or far sacks stay hidden.
