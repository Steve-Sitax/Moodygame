# 09 - Backlog: ideas not yet in a milestone

Newest on top. Each item says who raised it and when.

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
