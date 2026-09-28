# 09 - Backlog: ideas not yet in a milestone

Newest on top. Each item says who raised it and when.

## The docks at work (Steve, 2026-09-28, during T1/T2; next after T1/T2)

- **Crane loads go somewhere real.** "Make sure if cranes are unloading grain or other stuff it also goes to stacks or in
  trains or straight to big carts, but make sure to not block trains or omnibus." Today (client/src/world/railway.ts) a
  crane only moves loads between a ship's hold and a wagon of the goods train while it stops; the loads are drawn by
  the client alone, never goods of the server's store, and the wagons are filled at random again in the shed. Wanted:
  each crane load becomes a real item (shared/goods.ts) set down on a quay stack, in a wagon, or on a dray that takes it
  away; every stack spot kept off the rails, the omnibus route and the traffic lanes (the keep-outs of
  world/quaygoods.ts), with a check.
- **Dock work for the player, with the foreman's book.** "Player should also be able to haul cargo if he gets a working
  permit from the foreman already there: 'den boek'." And: "earn money per delivered piece, but money is less than
  quests and depends on distance and type of good." The foreman at a quay writes him into his book; then he may carry
  from the piles like the dockers, paid by the piece (the engine's pay: distance and the good's weight, below a job's
  band).
- **Dockers eat and drink.** "Dockworkers are also getting hungry and thirsty so they are more likely to go to cafes
  nearby for some food and drink. Especially if no job or already a few jobs done." A docker's day gets breaks at the
  nearest tavern or coffee house, more of them when there is no ship to work or after a run of loads.
- **Goods look like what they are** (done for sacks, T1 round 4): crates, casks and bales next, with stencils.
- **A goods kit on the sacks' pattern** (Steve 2026-09-28: "can this also be a good base upon varying crates, baskets"):
  one model per container (crate, cask, bale, basket) with a look per kind of goods (size, shape, material, wear), a
  label or brand painted by one shared code (what and where from), the label kept with the item wherever it goes,
  Blender models recording where their containers stand so the game draws the one model there, merged drawing per
  area. Order: crates (tea chests, coffee and sugar crates, gin and wine cases, soap boxes), casks (brands burnt on the
  head: Schiedam jenever, Bordeaux wine, Philadelphia petroleum, herring), bales (New Orleans cotton, Buenos Aires wool,
  hides), baskets (fish, vegetables, peat, wicker bottles).
- **Sacks by what is in them** (Steve 2026-09-28: "are there visible differences in coffee sacks, grain sacks"): the one
  sack model with a look per goods: coffee coarse and lumpy, grain full and smooth, flour pale and dusted, rice light
  gunny, salt stiff with a white crust, sugar in matting.

## Multiplayer on the home network (Steve, 2026-09-26)
- **Planned, not built:** `docs/multiplayer-plan.md`. 2-6 players on the LAN, assets cached by SHA-256, own movement local and never pulled back, no pause, per-player saves, drop in and out. Phases M8a (walk together) to M8d (shared work); six open questions for Steve at the end.

## Engine (Steve, 2026-09-26)
- **Fight spike before any fight milestone.** Steve chose to stay in the browser (docs/08 #14). Before "hate and fights" is planned: build one street fight (two people, blended moves, hit checks, a server-owned outcome) in three.js and the same in Godot, 1 to 2 weeks. Compare feel, work and frame time, then decide on a port.

## Feedback after playing M2b (Steve, 2026-09-23)
M2b "works, that was more interesting". Ideas and wishes from that play:
- **More thieves, a gang, and combat.** Steve decided (2026-09-23): no combat in the demo (docs/08 #10). More thieves and a gang are welcome, without fighting: chase off, pay off, report, or lose goods.
- **Hate and fights (later).** Steve, 2026-09-24: trust may now go below 0 (-5 to 10), "we can later implement hate and fights then". Until that milestone the no-combat rule (docs/08 #10) stands: negative trust only makes people colder (refuse to sell or talk, warn others, call the police).
- **People hand things over.** (Taken into M3.) A parcel should come from a person (the employer or a clerk), not lie on the pier. Crates too, where it fits: you speak to someone on the ship and they lower crates from the boat with the crane or a rope. Needs M3 NPCs.
- **Better physics for goods:** (Stacking and lifting any goods taken into M3.) put a crate anywhere (also on top of other crates), pick up any crate, stack crates. Goods rest on what is under them.
- **Owners react:** (Taken into M3.) if you pick up a crate that belongs to someone and they are near, they get angry. Trust, memory and rumour follow (M3).
- **Movement:** jump and crouch. (Taken into M3.) Crouch also fits eavesdropping and hiding from a thief or the police.

## World and art: better models, true to 1873 Antwerp (question from Steve, 2026-09-23)
Plan already in docs/05 (asset plan); not yet in a milestone:
- A Blender kit: 10 wall pieces, 4 roofs, 6 street props, 3 boat parts, 2 lamp types; 8 NPC bodies with texture swaps. Low poly and PS1 style on purpose; "true to life" means right shapes, materials, signs, clothes and layout, not photo-real.
- Layout from public-domain sources: 1870s city plans of Antwerp, old photos and engravings of the Rijnkaai, the Steen, the Vismarkt, the cathedral. Only sources with a clear licence or public-domain status, noted in assets/ATTRIBUTION.md.
- The four districts of the demo (docs/01): Rijnkaai, Vismarkt with the Steen, Sint-Andries, a slice of the Grote Markt.

## Gameplay ideas (Steve, 2026-09-23, during M2b)
Stored for later. Not planned into a milestone yet.
- **Buy a cart, then upgrade it:** a handcart first, a better cart or a mule later. Carries more goods per trip and moves them faster. A money sink that makes carry jobs pay better over time. Needs: a seller (chandler or a natie yard), a cart prop you push, cart speed and capacity owned by the engine.
- **Better transport in general:** e.g. a borrowed lighter or rowing boat along the quay, a place on a wagon to the Grote Markt.
- **Letters and documents:** bring a letter or papers across town. Fits "deliver". The contents can matter (sealed, secret, for the police, for a smuggler). Choice: read it or not.
- **Eavesdrop:** stand near people in a café or on the quay and listen without being seen. What you hear becomes a memory and a rumour (M3 memory, docs/03). Can be a job ("find out what the Katoennatie pays") or a chance on the street.
- More of the same kind: follow someone in the fog, carry a message by word of mouth, count cargo for a clerk, guide emigrants to the Red Star Line office.

## More interaction in jobs (Steve, 2026-09-23, after M2)
Problem seen in M2: Claude writes varied jobs, but the game plays only "carry", and every carry job plays the same (crates from A to B). The words change, what you do does not.

What would make jobs interesting. Claude proposes, the engine plays and owns the numbers (docs/03):
- **Job parameters from Claude, picked from engine lists:** goods (crates, sacks, barrels, hides, rope coils: each its own prop and weight), source and drop spot from the spot table, count within a band, a time limit ("before the bell").
- **One twist per job, from a fixed list the engine can play:** a crate breaks open; a stranger offers coin for one crate; the foreman stands and watches; the fog thickens; a second job-giver asks you to hurry theirs; a crate is too heavy for one man, and you need to find help.
- **A crate in the Schelde:** dropping or throwing one off the quay is possible. It costs pay and trust with the employer, and people talk about it (memory, rumour).
- **Outcome narration:** the job_outcome hook (docs/03) writes 1-2 lines after each job from engine facts (time, crates, twist, choice). It also writes a memory note for the employer.
- **More task types on the Rijnkaai:** watch (stand by goods until the bell, things happen in the fog) and deliver (carry a thing to a ship or a door, meet someone). Row, find and talk come with the ferry and with M3 dialogue.
- **Choices with weight:** sell the loose crate or hand it in; tell Sooi about the stranger or keep quiet. These feed trust per faction and NPC memory (M3).

When: Steve chose (2026-09-23) to build this now as milestone M2b, before M3. Scope in docs/06. Still open after M2b: row, find and talk task types; choices that feed M3 dialogue.

## Velocipedes, theft and the police (Steve, 2026-09-23, during M3e)
Taken into M3h (`docs/milestones/M3h.md`), 2026-09-23. Still open: see "Not yet" there.
Steve: "bikes available that we can take. If owner in vicinity we get bad rep for stealing. When we do bad things police comes to talk to us or arrests us."
- **Bikes of 1873:** the velocipede ("boneshaker", iron tyres, pedals on the front wheel). Rare and costly in Antwerp then: a few stand by the houses of the well-off, a café, the Entrepot office. You can take one and ride it (faster than hurrying, noisy on the cobbles, falls over on the rails and in the ruts).
- **Theft:** each bike has an owner (a resident from the living city). Taking it while the owner or anyone else sees it gives bad reputation and a rumour ("the man who took the notary's velocipede"). The engine owns the numbers: who saw it, how much trust is lost.
- **Police:** a police agent comes to talk after a bad deed (theft, a crate in the Schelde, a fight), asks questions, and gives a warning or a fine; after repeated or serious deeds, arrest: a night in the cell of the Steen (it was a prison until 1823, later a museum; use the police post on the Grote Markt instead), the job lost. Free text to the agent is data, not orders (docs/03).
- **A lamp to carry** (Steve, same day): buy a hand lantern from a stall or a shop, or pick one up where people work (a dock gang's lantern, a stall's lamp). You carry it in your hand: a small warm light round you at night and in fog, other people see you coming. A lamp that is not yours is theft (same rules as the bikes).
- **Food theft:** food on a stall that is not covered (the tarps come on at night, M3e) can be taken. Seen by the stall keeper or others: theft, reputation, the police. Unseen: free food, and maybe a rumour later ("herring went missing from Fientje's stall").
- One system for all of this: what is taken, whose it was, who saw it (line of sight and distance, fog helps the thief), what it costs you with whom.
- Wait for the living-city work (residents, owners, rumours, M3e) to land first; it builds the people and reputation this needs.
