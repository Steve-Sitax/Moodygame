# M7 walk-up: job and quest people come from the town, 2026-09-26

Why (Steve): "when doing fetching jobs, a person always pops out of nowhere. Now it is customs. Those people
should always be around and walk up, or run if they think it is urgent. Like this it is not realistic. So
customs, police or even thieves linger around and come up or follow when they know you do a quest."

## Where people popped in before
| Place | Before | Now |
|---|---|---|
| Trouble on a job (`game/ideas.ts showTrouble`) | a made figure 1.8 m in front of Jef (the customs man, the rival, the tally man) | the engine sends the one it is about from the town (`POST /api/walkup/trouble/:id`): the nearest customs officer on duty, a docker of another natie, a natie man; he walks up (runs for contraband: a load of Tuur's or the night's work) and the scene opens when he stands before Jef (or as near as the ground lets him). Nobody near in 40 s: a man walks in from out of sight. The stowaway climbs out of a crate of the job (`origin "crate"`). |
| Watch: thief, bribe, foreman (`game/runs.ts WatchRun`) | made figures 11 to 17 m off, often in view | a thief of the town (thief and bribe) and a natie man (foreman) called early, walking from where they are; the thief creeps the last 18 m to the nearest of the goods and bolts when the man at the post sees him (5.5 m); not there by 80 % of the watch: he does not come. Nobody near within the cap: a made one walks in from out of sight. |
| Carry and deliver: stranger, foreman (`HaulRun`) | made at job start beside the route and by the drop, in view | a thief of the town (as the fence) and a natie man walk to those places; the foreman's "arms folded, watching" toast comes when he is there. |
| Deliver: the recipient (`HaulRun`) | made at the drop at job start | put at the drop only while Jef cannot see it, else walks in from out of sight; the mate on the Anna Maria comes up on deck unseen (or after 8 s, `origin "hatch"`). |
| Night gang (`game/nightlife.ts`) | three made men 8 m in front of Jef | the town's thieves out near him (men, within 220 m, picked by the engine in `rollGang`, `gang.lads`) come at a run; one the town cannot give walks in from out of sight; the panel and its clock start when they stand round him. |
| The kit's `spawn()` | 5 m ahead | unchanged (a dev tool), marked `origin "dev"` so the popcheck lists it apart. |
| Not changed | | the M4 actions (`ensure`, `claimNear`: out of sight already), the police visit for Jef's deeds (`game/deeds.ts`: out of sight 25-40 m), events (`ensureAttend`), the town's own spawning (out of sight or at their door). |

## The engine decides (server `town/walkup.ts`, `town/walkupRoutes.ts`)
- `pickResponder(role, at)`: the nearest resident of the role's trades who is plausible now (customs and police at work; thieves out; natie men at work, loitering or at a tavern door), free (no action of their own, not reserved by an event, the police visit or a post), within 320 m, and on the walk map with the place Jef needs them on it too (always a path: the place may be 12 m off it, a pier's head).
- `callResponder`: an action row of kind `come` (source engine) reserves them; one per need (`ref`), a repeat gives the same person. Urgent (they run) only by the engine's rule: police to a crime, customs for contraband, a gang. Nobody near: `wait`, no row. The client says `done`; a settled job ends its calls; a row outliving the client ends by its time.
- Followers: `mayShadow` rolls once per job when Jef takes a valuable load (a parcel, chests, tobacco, coffee, hides, barrels) or a shady one: a thief within 40 m (35 % by day, 60 % in the dark), at night a customs man for a shady load. `shadowStep` every 2 s: no load, break off; a thief with an agent of the police or the night watch in sight (the client's sync only) breaks off; lost him (90 m), break off; dark or quiet (one or nobody within 15 m), close in; Jef standing, linger; else keep 12 to 25 m. A thief who reaches Jef gets goods in his hands (never with an agent in sight, never a parcel in the pocket; E "turn on him" sends him off first). A customs man closing in starts the job's customs trouble with himself in it.
- The model only words the scene, as before.

## The standing roles (server `town/standing.ts`, ids `wu01`...)
Added once to every town (a save keeps everyone it had; `db.ts ensureStanding`):
- customs: an officer at the Entrepot's gate, one at the lock bridges (both eat at another hour than the quays' four), and a night watch of the customs on the Rijnkaai (17:45 to 7:15): a customs man is at work at every hour;
- police: a day and a night agent on every beat, the quays, the town, the Werf and a new beat round the Petit Bassin (the day men eat at noon, the others at one): an agent is at work at every hour;
- thieves: one who loiters on the Rijnkaai and one on the Werf by day, drinks at the nearest tavern in the evening, and haunts the dark corners by the water at night.

## The client (`game/walkup.ts`, `game/follower.ts`, `dev/popcheck.ts`)
- `TownFigure`: a called resident. Unseen while far off they move toward the need at 3.5 m/s (6 when running), never nearer than 30 m to Jef unseen; within 50 m they step into the street out of Jef's sight (their own spot, or round a corner on their side, or the nearest hidden point with a way to him), then walk (or run) on the walk grid; a place off the grid is walked to as near as it goes. Done: back to their day from where they stand.
- `Summons`: asks every 3 s until the engine sends someone; after the job's cap, a made figure walks in from out of sight (`Walkup.walkIn`: 28 m or more, not in view, with a way to the goal), or nobody.
- `__scheldemist.popcheck()`: every frame, everyone drawn (the crowd's people, the residents held for jobs and actions, every made figure) that became visible within 20 m of Jef without walking in from beyond (made there in view, or one jump of more than 3 m in view). `pops` (job and quest people) must be empty; `emerged` lists the story's own (the crate, the hatch, the kit); `town` counts the town's own for information; 2 s of grace after Jef himself jumps. `popcheck(true)` resets.
- `__scheldemist.walkup.log()`, `.coming()`, `.come("police", "crime")` (someone of a role comes up to Jef now, as a job would call them), `.comers()`. Server dev: `POST /api/dev/walkup/shadow {job_id, x, z, see}` (a follower now, the roll skipped).

## Checks (2026-09-26)
- `cd server && npx vitest run test/walkup.test.ts`: 13 of 13 (the standing roles on every beat and at every hour, their rounds reachable, once only; nearest fitting, the busy and the off duty passed over, nobody sent from the open river; the call, the same person again, run only when urgent, done; no one near is wait with no row; a settled job ends its calls; the trouble sends the nearest officer and names him, the stowaway needs nobody; the planned officer busy by then: the next one is sent and his name replaces the other's in the model's scene; the follower's rules; a thief follows a parcel once a job, not sacks, not from afar; police notice only when really there; the gang are thieves of the town, men, reserved).
- Four older tests assumed no one after the back of town or the garrison: `backtown`, `garrison`, `population` (the size's promise counts without the standing roles), `transport` leave the `wu` ids out. `ensureGarrison` no longer mistakes the new customs men for the garrison.
- In the browser on a test stack (8975/5375, a copy of the save; the new people were added to it in place), every run with `popcheck()` = `pops: []`:
  - customs trouble on a carry job: Leon Van Tongel from his beat at 36 m, walked up, the scene opened at 2.6 m; option 1; back to his day (`wu_customs_*`);
  - watch with thief: Karel Thys from the Vismarkt crept up, bolted at 5.5 m, walked on with his day (`wu_thief_*`, `wu_thiefnear_*`, `wu_thiefbolt_*`);
  - police to a crime (`walkup.come`): agent Constant Mertens (a new patrol) ran from 81 m (`wu_police_*`);
  - a night gang of three of the town's thieves came at a run from 5, 36 and 37 m; panel when two stood round Jef; pay; they walked off and were let go (`wu_gang_*`);
  - deliver with stranger_offer: Staf Mertens (the new Rijnkaai thief) walked 33 m to his place and waited; sold him the parcel; off with it (`wu_fence_*`); the mate came up on deck unseen;
  - carry with foreman_watches: a porter from the quay walked to the pier's foot (the pier's head is off the walk grid);
  - the stowaway out of a crate of the job (`wu_stowaway`);
  - at 4:40 with every thief at home: the bribe's man walked in from out of sight, 27 m (`wu_walkin_*`);
  - followers: a thief kept 15 to 27 m while the market was busy, lingered when Jef stood, closed in on a quiet quay; twice an agent in sight made him break off, once he reached Jef and "thought better of it" (an agent had come near).
- Contact sheet: `walkup_contact_sheet.png` (in the helper's scratchpad, with the frames as PNG).

## Open
- The server ranks people by the client's sync or, for those not near Jef, by the schedule's guess (a round's first point); the client walks them from where its town has them, so one may take longer than the engine thought.
- The follower's pictures are poor (the carried crate hides the view from Jef's shoulder); the rules are shown by the logs and the tests.
- Distant frames are small at 960 x 540; the sheet marks the person in the middle of each.
- The deeds police visit (`game/deeds.ts`) still claims its agent 25 to 40 m off out of sight, not from his own round.
