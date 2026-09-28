# The great storm (2026-09-28)

Steve: "implement an extremely heavy storm event. All shops close, no work for deliveries, people running for
shelter to cafe, home, somewhere under. Make it have nice sounds, effects."

An event of the director (`tempest`), played by the engine. It sits on top of the storm weather: every storm
effect the game had stays, and a level 0..1 makes it heavier.

## How it goes

| Part | Game minutes | What happens |
|---|---|---|
| `tempest_coming` | 20 | The weather turns to storm now. Every shop and stall shuts (`m4_closed`, with the event's id). The day's other events are called off. The sky goes black, the wind rises. People run for shelter. |
| `tempest_peak` | 90 | Full strength. No job can be taken ("Nobody sends anything out in this storm"). |
| `tempest_easing` | 30 | It blows itself out. The shops stay shut. |
| The end | | The weather is rain for the rest of the day. The shops open by their own hours. Work comes back. |

When: 8:00 to 18:00, weight 0.25, once a day, not again within 4 days. The director may also ask for it by
name ("tempest", "storm", "gale"). Nothing else is planned while it blows. Nobody is hurt.

## Who does what

| Part | File | What |
|---|---|---|
| Shelter rule | `shared/tempest.ts` `shelterFor` | The same for server and client, and the same for one person all through one storm. At home, in church, indoor work, a sentry: stays. Children: home. Publicans and their people: to their own tavern, which opens whatever the hour. Drinkers at a tavern door: in. Others: about 4 in 10 home, a third to the nearest tavern (within 260 m), the rest "under". |
| The event | `server/src/director/tempest.ts`, `templates.ts`, `scheduler.ts` | The acts, the end hook, `publicEvent().tempest = { phase }`, the take check. |
| State | `server/src/director/state.ts` `tempestPhase` | world_state `tempest` = `{ event, phase }`. |
| Taverns | `server/src/trade.ts` `atWork`, `interiors/state.ts` `patronsIn` | Tavern keepers at work in the storm; those who ran in drink there (at most 24 a room). |
| Client level | `client/src/world/tempest.ts` | Phase from the event list; `level` eases 0.12 to 0.55 while it comes, 1 at the height, down to 0.25 as it goes. `tempest.hold` for the dev. |
| People | `client/src/game/town.ts` `stormGoal`, `underDoor` | Home; into the tavern (or pressed under its door if its room is not in); "under": into the cathedral within 80 m, else the nearest front door within 70 m, under the lintel either side of the door, arms folded, leaning on the wall, hands in pockets or behind the back. Everyone out in it runs (2.3 m/s). No errands, no shop calls, no door life, park or mill work. |
| Market | `client/src/game/market.ts` | Shoppers leave. Sellers stay by their goods, huddled under the stall's awning. |
| Rain | `client/src/world/ambient.ts` | 4000 streaks (an ordinary full rain still draws 1600), faster, longer, laid over by the wind, seen up to 13 m, brighter. It never lets up. |
| Air, sea, sky | `client/src/world/rijnkaai.ts`, `sky.ts` | Fog near x0.55, far x0.68; the air darker and slate-blue; the sun down to 30 %; the river's waves up to 6.2 (storm 3.6); the clouds race 2.6 times as fast. |
| Wind | `client/src/world/alive/wind.ts` | Base wind x1.9, gusts x1.8. |
| Lightning | `client/src/world/alive/air.ts` | Strikes 5 times as often; at the height one in three 0.25 to 1.2 km off, with a tearing crack before the blast (`aliveSounds.ts thunder`). |
| Leaves and paper | `client/src/world/alive/leaves.ts` | Torn off the wet stones and held up in the air. |
| Storm noises | `client/src/world/alive/gale.ts`, `audio/aliveSounds.ts` | Made in code: a roar with a howl in it as each gust reaches Jef (from upwind); shutters and loose doors slamming on the house fronts; slates sliding off and breaking on the stones; shop signs squealing on their brackets; an empty cask rolling. More often the harder it blows. |
| Soundscape | `client/src/audio/soundscape.ts` `setTempest` | The wind bed up to x2.6; a howl bed (a low roar and two narrow bands whose pitch bends with the gusts); rain on roofs x2.4, in the street x1.7. |
| Jef | `client/src/player/firstPerson.ts` `buffet` | Outside, the gusts shove his view a little (scaled by the head-bob setting). |
| Words | `client/src/main.ts`, `game/interiors.ts` | A line as it comes, breaks, eases and ends; a tavern entered in it is "packed to the door". |

## Pass 2 (Steve 2026-09-28: "it must be scary")

Steve's notes: higher winds in gusts; stuff flying; more lightning sound, far a rumble, near sharper and faster; the
water must react, splashing up the walls; the rain seemed to go backwards; rain gusts, rolling past in cloudy waves;
the rain sounded like a roof while outside, and far too loud indoors; not much to mirror in a tempest; trees bend.

| What | File | How |
|---|---|---|
| Rain that falls | `world/ambient.ts` | A streak is its drop's fall in one frame (`uExpo`, the eased frame time): this frame's streak meets the last one's, so the eye follows the drop down. Before, fixed short streaks (1/40-1/25 s) shorter than a frame's fall, thousands alike, were matched to the wrong drop and read as rising. The head of a streak is bright, the tail faint. |
| Rain gusts | `world/ambient.ts`, `alive/wind.ts fronts` | Each gust front brings a veil: the rain thicker where the front is, sweeping across with it at the gust's speed; slower curtains between. Two open cylinders of falling streaks 9 and 17 m out (ATI ToyShop's rain layers, Tatarchuk 2006), the far one with soft billows of grey rain-haze: the "cloudy waves". As a veil passes Jef the fog closes in by a third and greys, then opens. The rain lays over and straightens with the gust at Jef. |
| Wind | `alive/wind.ts`, `firstPerson.ts windPush` | Gusts up to 3 times as strong as a storm's (about 5 times the base wind). The hardest gusts push Jef up to 0.6 m/s along with them; the walls stop him. |
| Flying things | `alive/leaves.ts` | 110 flyers (leaves, torn paper, dark scraps: straw, rag, slate chips) carried through the air at up to 24 m/s, tossed up and down, over the roofs, slapping into house fronts and dropping. Same material as the leaves: no new shader. |
| Trees | `trees3d.ts`, `rampartNature.ts`, `psx.ts uGale` | They lean downwind (a storm day a little, the great storm hard) and whip further in the gusts; the leaves flutter. |
| Thunder | `audio/thunderSynth.ts`, `thunder.worker.ts` | Built as it happens (Ribner and Roy, 1982): a crooked channel with branches and a run in the cloud; every piece sends a shock and a burst of crackle, arriving by its distance. Near (0.25 km): a bright crack loudest in the first second, over in 2. 1 km: crack and rolling claps. 3 and 8 km: dark (about 150 and 80 Hz), rolling for 10 s, with echoes off the land. Levelled by the loudest half second. Built ahead in a worker (20 to 60 ms each), kept by distance. |
| Lightning | `alive/air.ts` | At the height strikes every 1.5 to 5.5 s (about 18 a minute), dim flickers inside the clouds every 1 to 4 s, nearly half within 1.1 km; a near one flickers 5 times, lights the sky twice as hard, and shows its bolt (a jagged line from the cloud, with branches, one draw call). Far thunder rolls in between with no flash. |
| Water | `retro/psx.ts`, `rijnkaai.ts` | Short steep seas over the swell (`waveAt` the same, so the boats ride them); whitecaps breaking on the crests; the surf at the walls reaches 4 times as far out; the surge lifts the river up to 1 m (never over a spring high water). No mirror in the river or the puddles in it; past uSea 5.6 the mirrors are not drawn at all. |
| Surf up the walls | `alive/gale.ts createSurf` | Seas burst up the quay walls round Jef (within 40 m) every half second to 2 s: 110 to 260 drops of spray thrown over the edge and blown onto the stones, with a slam (thump, roar, falling hiss). The breath's mist material: no new shader. |
| Rain sound | `audio/soundscape.ts` | The roofs' drumming by how much house is round Jef (loud in a lane or a doorway, far off on open ground); in the open a broad downpour roar; the river pounding the quays heard 35 m back; indoors the storm much duller and quieter. |
| Fix | `game/interiors.ts` | The tipsy sway's NaN (a refused answer) made the camera's height NaN: a blank screen. Guarded (closes #18). |

## Checks (2026-09-28, test stack)
- `server/test/tempest.test.ts`: shops 0 open in it and open again after; the weather storm then rain; no job
  taken; taverns open and full; other events called off, none planned; the shelter rule stable; the director's
  words map to it.
- Browser: Vismarkt, Grote Markt, the Rijnkaai, Het Bassin. The weather turned, 20 places shut, 18 of 18 shops
  shut, 5 of 5 taverns open (24 to 25 in Het Bassin), the job refused with the line, everyone near running,
  people under a door's lintel, the market sellers under their awnings, rain in sheets. At the end: rain,
  18 of 18 shops open, work back. `shaders()` problems empty (no new shader kind: the rain's own shader
  got a uniform).
- Dev: `await t.tempest({ start: true })` then `t.skip(10)`; `t.tempest()` shows the phase, the level, the
  shelters, who is still out near Jef and running, the storm noises heard; `t.tempest({ hold: 1 })` holds the
  look. The Dev menu has "Event: tempest".

Not in the web demo: the demo has no server and no director events, so the storm cannot start there. The rain fix (streaks as long as a frame's fall, bright heads) is in every rain, the demo's too.
