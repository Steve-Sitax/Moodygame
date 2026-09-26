# M7 boats: every boat in detail, more small boats, and Jef can take any of them, 2026-09-26

Steve: "do a detail pass on all boats, barges, small personal use boats. More different small boats and we can
take any of them to use. Only when owner within sight he will be angry. If boat has owner it should say so when
taking the boat. Like take xxx's boat."

## The small boats (nine kinds, every one rowable)
Craft of the Antwerp waterfront of 1873 (the Scheldt hoogaars, hengst and schouw, the Dutch vlet and eel
schuit, the harbour's bumboats and ships' boats; sources in `assets/ATTRIBUTION.md`). Models in
`tools/blender/build_boats.py`, numbers for rowing in `shared/smallBoats.ts HULLS` (the model's glTF extra
"row" has the same numbers; the boat check compares them).

| Kind (model) | The player reads | Length | What she carries |
|---|---|---|---|
| rowboat | boat | 5.4 m | clinker, frames and knees, bottom boards, thole pins, bailer, basket, grapnel, painter |
| punt | punt | 5.2 m | flat, raked ends, cross frames, bucket, the quant pole, a washerwoman's basket |
| workboat (vlet) | work boat | 6.0 m | flat, heavy, green top strake, sculling chock, boat hook, coils of rope, home port on the stern |
| dinghy (jol) | dinghy | 4.3 m | beamy clinker, transom, rudder and tiller, the mast unstepped with the tanned spritsail rolled round it |
| shipsboat (sloep) | ship's boat | 6.3 m | white topsides, three thwarts, back board, rudder with a yoke, boat hook |
| gig | gig | 7.4 m | the water police's: black, varnished sheer strake, four thwarts, Belgian flag, lantern, POLITIE on the transom |
| bumboat | bumboat | 5.0 m | a canvas hood on hoops over bread, bottles, a keg, baskets of greens; a lantern |
| eelboat (aalschuit) | eel boat | 6.2 m | flat, tarred, a wet well with holes amidships, two fykes (eel traps), baskets, a net over the side |
| oldboat | old boat | 4.9 m | nobody's: worn grey, a tin patch, a cracked thwart, bilge water standing in her |

Her oars (and the dinghy's mast) are a child node `<kind>_stow`: laid in while she lies, hidden while she is rowed.

## Where they lie (`shared/smallBoats.ts MOORINGS`: 58, and the three family boats of M3j)
- Past the foot of each flight of steps (Vismarkt, Rijnkaai, the cart stand, north of the lock, the canal, the
  Petit Bassin's south and north steps): got into from the landing.
- At an iron ladder of her own, the ladder coming down at her thwart (51 ladders, `rijnkaai.ts placeLaddersNow`):
  the Werf's east wall by Het Steen (the gig) and west wall (the ferry's boat), the pier, under the Vismarkt and
  Rijnkaai quays, the Petit Bassin, before the boat repair yard, and all along the Canal des Brasseurs and the
  Vliet where the moored rows of M3f lay (their rows were small boats only: the lighters are too wide).
- Two lines each, bow and stern, to iron rings in the coping stones (`game/boatMoorings.ts`: the rings; the
  ropes sag at high water and draw taut at low). She rises and falls with the tide and heaves on the swell; at
  low water she sits on the mud (the canal and Vliet beds, the bank at the foot of a river wall) with a list.
- Drawn instanced by kind and quarter of the waterfront (`boats.ts fleetOf`, 3 draw calls a kind); a boat taken
  or left elsewhere becomes a copy of her own. The moored rows of barges keep clear of every mooring (`avoid`).

## Taking a boat (server: the engine owns the rules)
- Owner (`server/src/rowing.ts ownerOf`, from the town's residents by the mooring's rule): a resident of a fitting
  trade (fishwives and the fish merchant the eel boats, market women the bumboats, laundresses the punts, sailors
  the ships' boats, carters and dockers the work boats, clerks and merchants the dinghies), the water police
  (`waterschout`) the gig, the ferry (a Werf porter keeps it) its boat, nobody the old boats. Same town, same owners.
- The prompt is the engine's (`takePrompt`): "take Jozef Willems's boat", "take the water police's gig",
  "take the old boat". Hostile or silly text never reaches it: a boat is taken by its id, a sentence as a ref is
  refused.
- Only the owner's eyes count (`deeds.ts takeBoat`): he must be out (the engine asks his day: at home in bed he
  sees nothing, whatever the client says), within sight (the weather's range, by day; at night only by a quay gas
  lamp near the boat or Jef's lantern, else about 9 m), with a clear line and not with his back to it unless close.
  The client's distances are clamped (0-80 m), unknown ids dropped.
- Seen: he is angry. A shout ("Jozef shouts and runs for the quay: ..."), he runs for the quay (the chase of the
  theft system: if he reaches Jef before he is off, he takes the boat back), trust with him -2 (clamped at -5),
  his faction -1, a memory ("Jef took my boat ..., in front of my eyes"), and the police (at once; an owner who
  only asked for her back goes to them after 40 game minutes if she is not back).
- Unseen: nothing now, no rumour. After 45 game minutes away he finds her gone (`rowDeeds.ts boatTick`): a memory
  without Jef's name, and if Jef is within 45 m of her mooring he hears someone shout for his boat.
- Tied up again at her own mooring (within 4 m, stepping ashore): the deed is settled (`boatHome`): the police let
  it be, an owner who saw it gains 1 trust back (once a game day), one who found her gone finds her back.
- Nobody's boat: no deed; hers to row and to leave anywhere. A wrecked one goes to the bottom, nobody asks.
- Server tests: `server/test/boats.test.ts` (owner name in the prompt, seen vs unseen, sight by light and weather,
  trust clamp, the client's word as data, nobody's boat, the way back, the grumble, the police after a plea).

## The detail pass (every model of `boats.glb`)
- Every hull: green-brown slime at the waterline and weed below it (vertex colour), a weed-and-barnacle tar
  (`tar_weed`) on the bottoms that show when a boat takes the mud.
- Barges (hengst, Rhine barge): two heavy wales, rope fenders, rust runs under the hawse and the leeboard irons,
  the home port on the quarters (TEMSE, ANTWERPEN), a lantern on the cabin roof, the stove's smoke.
- Lighters: a wale, fenders, rust runs, port names, the forepeak stove smoking, a lantern on the mast stump; new
  loads: coal (a heap and a shovel), sand, timber (baulks in tiers, lashed).
- The hoogaars sloop: a wale, her name on the bow, port on the stern, fish baskets, a net hung from the boom to dry,
  the cuddy's stove, a lantern; under sail her red and green side lights.
- Tug: a masthead lantern. Brig, barque, schooner, steamer, liner: riding lights (the barque under sail: side
  lights). The paddle tug is left as it was (the arrival ferry reads its deck).
- The hulls' sizes did not change (a lantern or a wale more; `dims()` grew 0.07-0.14 m in beam for the barges).
- Life aboard (`game/lifeAboard.ts`): on four barges a family: the skipper with his pipe at the stern, his wife at
  the wash tub, a child on the hatch; they ride with the boat.

## Lamps
44 boat lanterns in the harbour (`boats.ts lamps()`: the barges, lighters, sloops, tugs, ships, the gig and the bumboats): a glow on the glass (one Points object for all) and a `lanternLights.ts
addLantern` source each (the pool lights the nearest; the light-spill system picks them up; no ground pools made
here). Lit with the gas lamps (`boats.update(t, dt, lampsLit)`). Kind 0 white-yellow, 1 red, 2 green.

## Checks
- `__scheldemist.rowing.boatCheck()`: every small boat on water clear of walls and land, at her height for the tide
  (or on the mud), inside no other hull; both lines reach their rings on the quay at high and low water; her ladder
  is there at her thwart (or her landing within a step); her numbers match her model; every other vessel set down
  floats on water at her height and clear of the others. Result at high water: 61 boats, 116 ropes, 51 ladders,
  28 other vessels, no problems; at low water the same, 55 of the small boats on the mud.
- `__scheldemist.paths()`: [] (every ladder head and flight top reachable on foot).
- `__scheldemist.rowing.life.info()`: the families aboard.


## Performance (`perf(25)`, 960 x 540, the same views before and after, on a copy of HEAD with and without this work)
| View | Before: ms / calls / triangles | After |
|---|---|---|
| Vismarkt quay, day | 27.7 / 220 / 988k | 20.7 / 252 / 1054k |
| Petit Bassin, day | 29.3 / 527 / 1420k | 27.8 / 545 / 1462k |
| Canal, day | 42.2 / 936 / 1807k | 26.6 / 933 / 1886k |
| Vismarkt quay, night | 29.9 / 217 / 968k | 16.6 / 240 / 1028k |
| Petit Bassin, night | 34.5 / 498 / 1354k | 22.1 / 516 / 1396k |
| Canal, night | 44.2 / 888 / 1591k | 26.5 / 889 / 1669k |

The milliseconds swing with the machine's load (other helpers ran Blender and tests); the calls are the
measure: +18 to +32 on the river and the dock, none in the canal (57 instanced meshes for 61 boats, where the
canal's rows had been one set per row and kind).

## Pictures (scratchpad of the helper, not in the repo)
Blender close-ups of every kind (`blender_<kind>_0/1.png`), in the game: each kind close from the water at high
water (`boats_kind_*`, `boats_kindup_*`), the prompt with the owner's name (`boats_prompt_owner`,
`boats_prompt_lowwater`), the angry owner (`boats_angry_owner_hud`), the family aboard (`boats_family_hengst2`),
night (`boats_night_*`), and the before/after contact sheets (`contact_before_after_day.png`, `..._night.png`).

## Open
- The client reports the 16 nearest people as witnesses (game/deeds.ts): an owner further off on a crowded quay
  may be left out and so not see it.
- A boat taken from the canal at low spring tide sits on the mud and cannot be rowed until the water comes back.
- The arrival ferry's paddle tug model was not touched (another helper's work on the ferry).
