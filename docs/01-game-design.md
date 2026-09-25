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
| Sleep | 0-10 | 1 per 3 hours awake | Bed, or a bad sleep on the quay. At 2 or less Jef is slow and his sight swims; at 0 he drops where he stands and sleeps there (M7 night) |

Money is in centimes. 100 centimes = 1 franc. A day of dock work pays 2 to 3 francs.

## The day loop
1. Dawn. Go to the hiring spot. The job board shows 3 to 7 jobs. Claude wrote them at midnight.
2. Take a job. Do it. Jobs are short 3D tasks (carry, watch, deliver, row, find, talk).
3. Claude narrates the outcome and updates memory. Money and trust change.
4. Evening. Spend money: food, clothing, medicine, rent. Or a drink and a rumour.
5. Night. The town goes home; the shady men come out with night work; gangs work the dark streets.
6. Sleep when Jef chooses. Memory is consolidated at midnight, when the date turns and the next board goes up.

## The day and the night (M7 night, Steve 2026-09-25)
Steve: "Do not do the wake-at-dawn forcing. We must be able to work through the night." The clock
runs on through the night; nobody is sent to bed. Details and numbers: `milestones/M7-night.md`.
- **Midnight** turns the date: the day counter and the weekday, the new job board, the rent of a
  room, the memories fading, a night of talk in the taverns, the weather. After Sunday there is no
  day 8: the week ends at Sunday's midnight (asleep or awake), and the epilogue is written.
- **Sleep** is Jef's choice: the doss house bed (18:00 until dawn, rent due by Sunday), his own room,
  or rough anywhere (G, late at night or dead tired). He sleeps seven to eight game hours from when
  he lies down (longer the more tired) and wakes on his own, where he lay. Dead tired (sleep 0) he
  drops where he stands. Asleep rough at night, a gang may go through his coat.
- **The day's employers go home.** Sooi 5:00 to 20:00, the widow 7:00 to 19:00, Fientje 6:00 to
  18:00, Tuur 7:00 to 2:00, the town's employers by their schedule (6:00 to 22:00). Each has a
  **quest box** on a post by his door, with a lamp he leaves burning: a job finished while he is
  abed is paid from the box at once when Jef drops the proof in it; a parcel to deliver waits in
  it. By day it goes to the person as before. The employer remembers it.
- **A job in hand stays in hand** through the night; only its own deadline counts.
- **Night work.** From 21:00 to 5:00 four shady men stand in dark corners (a fence behind De Vliet,
  a night lighterman on the Werf, a carter on the west canal quay, a man by the Petit Bassin who
  wants a lookout). They offer the night's work in talk: the model proposes it, the engine checks
  and clamps it; it pays half again to twice the day's, must be done by 5:00, and at the settling
  the engine rolls the watch (the pay is lost) and rivals (half of it).
- **Gangs.** At night in dark streets and on the quays three men may step out and rob Jef: more
  likely alone, carrying goods, drunk, with a full purse; much less by a lit lamp, with the police
  near or people about. He can run, fight them off, shout for the watch, or pay; the engine rolls
  each. Robbed, he loses most of his purse (500 c at most), a thing from his pockets, and a job's
  parcel. No combat system: it is narrated (docs/08 #10).
- **The director's night**: from 22:00 to 5:00 only night events, small (the honest town is
  abed): a burglary, smugglers landing goods, a scuffle at a tavern at closing time, the night
  watch's round, a fire. The townspeople sleep at home by their schedules; about are the night
  police, the lamplighters at dawn, the publicans till two, sailors and the tavern crowd.

The clock (M7, Steve 2026-09-24): one game hour is two real minutes, a game minute two real seconds.
A day from 6:00 to midnight is 36 minutes of play, a whole day and night 48; the week of seven days
about four hours awake and more if Jef keeps the nights. The rate lives in one place,
`shared/clock.ts`; see `milestones/M7-clock.md`. The night's hours live in `shared/night.ts`.

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
