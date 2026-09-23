# 01 - Game design

## One line
You are Jef, a farm boy from the Kempen, new in Antwerp in October 1873.
You have no money and no name. Work. Eat. Keep warm. Get known.

## Why 1873
- The Scheldt toll was bought out in 1863. The port explodes with trade.
- The Red Star Line starts sailing to America in 1873. Emigrants fill the quays.
- The "naties" (dock guilds: Hessenatie, Katoennatie, ...) hire day workers at dawn.
- Gas lamps, fog from the river, cholera still in living memory (1866).
- Sint-Andries is the slum ("de parochie van miserie"). The Eilandje has the new docks.
- A rowing ferry crosses to Sint-Anna on the left bank. This is our nod to Foghorns Drown.

## The player
- Name: Jef by default. The player can change it.
- Starts with 50 centimes, a thin coat, and a bed in a doss house in Sint-Andries.
- Rent is due every Sunday. No rent, no bed. No bed, you sleep on the quay and lose health.

## Needs (engine-driven, not AI)
| Need | Range | Falls by | Filled by |
|---|---|---|---|
| Food | 0-10 | 1 per 4 hours | Soup kitchen (free, costs trust with naties), bread, herring, cafe meal |
| Warmth | 0-10 | Weather and clothing | Coat, boots, a warm bed, jenever (short boost, later penalty) |
| Health | 0-10 | Cold, bad food, injury, sleeping outside | Pharmacy, doctor, rest |
| Sleep | 0-10 | 1 per 2 hours awake | Bed, or a bad sleep on the quay |

Money is in centimes. 100 centimes = 1 franc. A day of dock work pays 2 to 3 francs.

## The day loop
1. Dawn. Go to the hiring spot. The job board shows 3 to 5 jobs. Claude wrote them last night.
2. Take a job. Do it. Jobs are short 3D tasks (carry, watch, deliver, row, find, talk).
3. Claude narrates the outcome and updates memory. Money and trust change.
4. Evening. Spend money: food, clothing, medicine, rent. Or a drink and a rumour.
5. Night. A random event may fire (engine rolls, Claude writes it and picks world changes).
6. Sleep. Memory is consolidated. The next job board is generated.

## Trust and reputation
Trust is not one number. It is one number per faction, 0 to 10.

| Faction | Who | Likes | Dislikes |
|---|---|---|---|
| Naties | Dock foremen, porters | Hard work, loyalty | Theft, laziness, police talk |
| Kerk | Priest, soup kitchen | Charity, honesty | Drink, smuggling |
| Politie | The city police | Reporting crime | Smuggling, fights |
| Smokkelaars | Ferrymen, night lighters | Silence, night work | Talking to police |
| Burgerij | Merchants, chandlers, clerks | Reliability, manners | Dirt, drink, scandal |

Job tiers unlock by trust in the right faction:

| Tier | Trust | Example jobs | Pay per job |
|---|---|---|---|
| 0 Nobody | 0-2 | Carry sacks, sweep the quay, lantern watch | 50-150 c |
| 1 Known | 3-4 | Regular natie shift, row the ferry, run messages | 150-300 c |
| 2 Trusted | 5-6 | Night watch on a warehouse, chandler's delivery, guide emigrants | 300-600 c |
| 3 Respected | 7-8 | Courier for a diamond dealer, Red Star Line agent errands | 600-1500 c |
| 4 Connected | 9-10 | Errand for a merchant's house, a word at the city hall | 1500+ c |

A high tier in one faction can lower another. A smuggler's courier will not get police work.

## Districts in the demo (small, 5 minutes walk end to end)
- Rijnkaai and the Bonapartedok on the Eilandje. Ships, cranes, hiring spot, warehouses.
- Vismarkt and the Steen quay. Fishwives, rumours, the ferry pontoon.
- Sint-Andries alleys. The doss house, the pawn shop, the soup kitchen, the church.
- A slice of the Grote Markt with the cathedral spire in the fog. The rich side.

## Core NPCs (8)
| Name | Role | Faction | Note |
|---|---|---|---|
| Sooi | Foreman, Hessenatie | Naties | Gruff, fair. Gives the first jobs. |
| Widow Peeters | Ship chandler | Burgerij | Careful with money. Remembers favours. |
| Fientje | Fishwife, Vismarkt | none | The rumour hub. Repeats what the DB knows. |
| Pastoor Cools | Priest, Sint-Andries | Kerk | Soup and sermons. Judges the drink. |
| Agent Verhulst | Policeman | Politie | Wants informants. |
| Tuur | Ferryman, night lighter | Smokkelaars | Rows the Scheldt. Moves things at night. |
| Leentje | Soup kitchen helper | Kerk | Kind. Reports to the priest. |
| Meneer Van Dyck | Merchant, Grote Markt | Burgerij | Tier 3-4 jobs. Hard to reach. |

## Events (examples)
Engine picks a slot (night, dawn, on-the-job). Claude writes the content and picks world changes from a fixed list.
- Fog closes the docks. No natie jobs today. Tuur has a night job.
- A ship from Congo arrives. Extra hands needed. Pay doubles for one day.
- A strike. Sooi asks you to stand with the men, or to break it.
- Cholera scare in Sint-Andries. Soup kitchen closes. Medicine price rises.
- An emigrant family lost a child on the quay. Find her before the ship leaves.
- Police raid on the Vismarkt. Tuur wants his crate hidden.

## Family (decided 2026-09-23)
The player picks the family at the start: alone, or a wife, and 0 to 4 kids. This is the difficulty setting.
Every family member is a full NPC with a persona and memories. They live in the doss house room.
Kids of 10 and up can be sent to work. Small pay, real cost. See 08 for the rules.

## Ideas that are now in (decided 2026-09-23)
1. Rumours spread. What you do today is what Fientje tells everyone tomorrow. This is the memory DB made visible.
2. The newspaper. Each morning "Het Handelsblad" shows one headline. A model writes it from the log. Sometimes it is about you.
3. Weather drives jobs. Fog means smuggling. Storm means salvage. Sun means emigrant crowds.
4. The ferry as a calm moment. Rowing across in the fog with one passenger who talks. Pure atmosphere.
5. One week, then an epilogue. Day 7 ends. Claude writes what became of Jef from the whole log. Health 0, arrest, or a family death ends it early.
6. Trust is hidden. You feel it. Nobody shows you a number.
