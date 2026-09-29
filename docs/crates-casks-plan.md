# Crates and casks: one model each (plan)

T3 (`docs/milestones/T3-trade.md`, "the goods kit for crates and casks") and the rule "one model per thing, changed
everywhere" (CLAUDE.md, Steve 2026-09-28). The sacks were done first (`docs/sacks.md`: one sack model, a label sheet).
This note is the survey of 2026-09-29 and a plan; the town-wide change waits for Steve's eye (it changes how most of the
quay looks).

## Done now (2026-09-29)

- The dockers' pile crates (`shared/goods.ts haulPileItem`, the Rijnkaai's and the Petit Bassin's routes) were a plain
  0.7 m box on the pile and the props' crate (`crate_seat`) once a docker lifted it: one thing, two looks. They are the
  props' crate everywhere now: on the pile, in a docker's arms (now at its own size, not 82%), in Jef's hands. An older
  save's piles are laid out again at the first dawn tick (`goods/store.ts haulDawn`).
- The keg: one model already (`game/kegModel.ts`: clutter.glb's keg, by the back doors, at the brewery, carried).

## What there is today

Crates, 13 looks: props.glb `crate_detail` (crate, crate_small/open/broken/seat/big, crates_stack; stencil "K,
ANTWERPEN, N.127" the same on all); quaygoods.glb framed crates a, b, c, s (stencils "ANTWERPEN NO 17", "LIVERPOOL 23",
"H&V RIO", "NO 7" and marks); clutter.glb box crates; wagons.glb `goods_crates` ("N.12"); boats and ferry `crate_lo`;
build_trades.py `crate()`; `game/props.ts makeGoods` 0.7 m box (job goods, owned goods); backlife and figures boxes; the
residents' handcart box (`world/traffic.ts`); the crane hook box (`world/rijnkaai.ts`); the Oostershuis crates; the
furniture crate. Open produce crates and fish boxes besides.

Casks, 12 looks: props.glb `barrel_body` (barrel, barrel_lying: the `look: "cask"` goods) and `cask_lo` (casks rows,
petrol, the drays' load); quaygoods.glb `cask_geo` (cask, dark, blue, the hogshead, keg; heads "H&V ANTWERPEN NO 17",
"M & CO ANTWERPEN NO 40", "H&V PETROLEUM NO 23", "BORDEAUX VIN NO 12"); clutter.glb barrel/keg/rain butt; the lively
wine casks; wagons `goods_casks`; the railway fallback; boats `barrel_lo` and the gin keg; the cooper's cask; `makeGoods`
cylinder; the rooms' and landmark halls' barrels (the Vleeshuis stillages).

Nothing says what is inside a given crate or cask; the stencils are baked, the same on every copy of a part.

## Plan (for Steve's go-ahead)

1. **One crate, one cask, one hogshead, one keg**, built in one Blender builder (the quaygoods ones are the most detailed:
   framed crate, 12-sided cask with raised hoops), size classes by scale, not by new models.
2. **A label sheet** as the sacks': the stencil on the crate's side and the cask's head from the goods list
   (`shared/goodsCatalog.ts`: what, where from, a mark and a number), one material for all, each copy's cell by its id.
3. **Switch every place** above to them, in the sack pattern (`sackPuts`-like hooks in clutter, quay furniture, lively,
   rooms and halls; the goods items' looks; the carried loads; carts, drays, wagons, boats), with pictures of each.
4. **Frame budget**: one material each (the label atlas), merged or instanced as now; A/B at the Rijnkaai and the
   Vleeshuis.

Open question for Steve: the whole town at once (a big change of the quay's look), or the goods that move first (piles,
carts, hands, wagons) and the still scenery after?
