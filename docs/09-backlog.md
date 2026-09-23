# 09 - Backlog: ideas not yet in a milestone

Newest on top. Each item says who raised it and when.

## Feedback after playing M2b (Steve, 2026-09-23)
M2b "works, that was more interesting". Ideas and wishes from that play:
- **More thieves, a gang, and combat.** Steve decided (2026-09-23): no combat in the demo (docs/08 #10). More thieves and a gang are welcome, without fighting: chase off, pay off, report, or lose goods.
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
