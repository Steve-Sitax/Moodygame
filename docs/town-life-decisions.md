# Town life decisions (fix-all run, 2026-10-18, bundle F)

Open points the issues left "to work out later", decided so the work could be done. Steve can change any of them;
the numbers live in the engine files named here.

## Warmth at a fire (#162) — `native-godot/src/Services/NativeCoreClock.Warmth.cs`

- Heat comes from where the player stands, from each presence report, counted per game minute: 1 point a minute in
  an open tavern that has a hearth or a stove (anywhere in the room), 2 within 2 m of it; 1 within 3.2 m of a burning
  fire basket outdoors, 2 within 1.6 m. 120 points are one warmth, at most one a game hour, up to 7 (as a heated home).
  Half an hour of heat in an hour also stops that hour's chill.
- A tavern's fire burns while the tavern is open (its keeper at work); a shut tavern's hearth is cold and its fire
  is drawn out. The four tar-barrel fire baskets on the quays burn from 17:00 to 08:00 (the dockers' and the night
  watch's hours) and are drawn out by day.
- A seat by the fire costs nothing. Rain does not put a basket out. The rule is the same for every player: each one's
  own reports, the world's fires.

## The hiring board (#153) — `native-godot/src/Services/NativeCoreJobs.Board.cs`, `godot/src/Play/WorkBoard.cs`

- Eight places (two rows of four). Today's open jobs take them first posted, first placed; the night's whispered
  work and an emigrant family's errand are never on the board. A note keeps its place while it hangs.
- A full board posts no more: newer jobs wait off the board and off its list, and go up in the place a taken or
  expired job leaves. They can still be offered in talk or the newspaper.
- Pick a job by looking at its note and pressing E, or open the list with E on the board elsewhere (mouse or keys).
- A note: about 19-22 by 24-27 cm, the poster's own paper colour, size, printed or handwritten hand and ink. Title
  letters are about 3 cm high, the giver and the pay about 2.5 cm: readable from a metre.

## Benches (#165) — `native-godot/src/World/NativeBenches.cs`, the district object scenes

- Two kinds, each with a fine and a worn finish of the same shape: the cast-iron park bench (the Sint-Jansplein,
  the Lijnwaadmarkt green, the Stadspark, the cathedral and town-hall fronts, the Groenplaats, the Handschoenmarkt,
  the Conscienceplein; worn at St James's churchyard) and the plank bench (fine at the stops of the good streets, Den
  Engel, In de Linde and Sint-Paulus; worn on the quays, the wall walk, the Steen, the court green, the poor
  quarters' stops and the other taverns).
- 103 benches: the bake's 76 (new models in their places) and 24 new ones, plus the two cast-iron benches in the
  Stadspark and the razed corner's bench. Every one can be slept on and sat on.
- The sleep rules are unchanged (`fine` benches are where the police move sleepers on; robbery as before). A new
  bench is `fine` when its model's finish is fine.

## The Vismarkt sellers (#150) — `native-godot/services/data/native-extras.json` (the vismarkt field's `pitches`), `native-godot/src/Services/NativeTownMarketPopulation.cs`, `godot/src/People/NativeMarket.Pitches.cs`

- Fixed stalls: the six fish stalls that stand on the Vismarkt every day (under their tarpaulins at night) keep their
  own fishwives, as before. Temporary stalls: sixteen market-day pitches (fourteen of fish, two of them barrows, one of
  vegetables and one of bread), Monday to Saturday. The market's other stalls, kept by nameless sellers, are gone:
  every seller on the square is now a person who lives in the town.
- Each pitch has its own seller: a woman with a home near the market and her family's handcart. Her cart stands by
  her door at night; she pushes it to her pitch with her goods (two or three crates), parks it beside the stall, and
  pushes it home again after the market.
- Hours (the engine's, in the data): she is at her pitch by 5:30-5:45. Set-up 5:30-7:00: first the frame or table,
  then the awning or cloth, then the goods. Selling 7:00-12:30. Packing up 12:30-13:00: goods first, then the
  awning; the frame comes down when she leaves with her cart. No market on Sunday.
- Talk to a seller with E at any hour she is there; F buys from her while she sells. Before seven she says she is
  still setting up, after half past twelve that she is packing up, and on Sunday there is no market. A seller is
  talked to across her stall (a little further off than other people).
- Stock: the fish sellers sell from the Vismarkt's one stock of fish (the trade ledger's `vismarkt` post, 14 to start,
  room for 80). The quay porters' crates from the boats bring 6 portions each (the two dawn routes from the quay),
  and the town's own buying takes from it. When it is gone the fish sellers say "Sold out. The boats bring more at
  dawn." and sell nothing; a seller who sells out stays at her pitch until packing time. The bread seller sells
  from the Steen bakery's stock; vegetables are not counted.
