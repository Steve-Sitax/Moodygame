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

Not in the web demo: the demo has no server and no director events, so the storm cannot start there.
