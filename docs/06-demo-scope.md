# 06 - Demo scope and milestones

## The demo
- Runs on localhost in Chrome or Edge. One command to start client and server.
- 7 in-game days. About 30 to 45 minutes of play. Ends with an AI epilogue.
- 4 districts. 8 town NPCs plus up to 5 family NPCs. 6 job task types. 10 event templates.
- Start screen: name, family (wife yes/no, 0-4 kids). Early end on health 0, arrest, or a family death.
- One save. Auto-save at sleep. Delete the DB file to restart.
- All jobs, events, dialogue and rumours come from the models. Nothing is hand-written except fallback lines.

## Job task types (the 3D part)
| Type | What you do | Time |
|---|---|---|
| carry | Move N crates or sacks from A to B. Heavy items slow you. | 2-3 min |
| watch | Stand at a spot until the bell. Things happen in the fog. React or not. | 2 min |
| deliver | Take an item across town. Streets may be closed. | 2 min |
| row | Row the ferry across with a passenger. The passenger talks (dialogue hook). | 2 min |
| find | Find a person or item by asking NPCs. Uses memory. | 3 min |
| talk | Persuade or report. Pure dialogue with a goal. | 2 min |

## Not in the demo
- Combat. Danger is narrated and costs health or money. No fighting system.
- Inventory beyond 6 slots.
- Multiple saves, cloud hosting, mobile, gamepad.
- Voice acting. Text only.

## Milestones
| # | Name | Done when |
|---|---|---|
| M0 | Docs | This folder. Steve has answered 08-open-questions. |
| M1 | Fog walk | You can walk the Rijnkaai in first person with the retro look and sound. No AI. |
| M2 | Server and job board | Server runs. Claude writes a job board. It shows in the game. One carry job works. |
| M2b | Job depth | Claude picks goods, spots, time limit and one twist per job from engine lists. Watch and deliver jobs play. Crates can be set down anywhere or lost in the Schelde. job_outcome narrates each job and writes an employer memory. Subtle pointer to the goal. Added 2026-09-23 on Steve's call, see 09-backlog. |
| M3 | Talk and remember | Dialogue with Sooi and Fientje. Memory in SQLite. Fientje repeats what Sooi saw. |
| M4 | Events and world ops | Night events fire. Fog closes the docks. Prices move. |
| M5 | Needs and week | Needs, money, rent, sleep, 7 days, epilogue. |
| M6 | Codex mix | Router sends rumours and newspaper to GPT-6. Only after approval. |
| M7 | Polish and playtest | Audio pass, fallbacks, timeouts, three playtests, fixes. |

Each milestone ends with a run in the browser and a short note in this folder. Not a backend check.

## Tests per milestone
- Schema tests: every hook output validates. Bad output is rejected and retried.
- Latency tests: p95 per hook under 12 seconds, or the fallback fires.
- Memory tests: after a scripted day, the right memories reach the right NPCs and no others.
- Clamp tests: trust, pay, price, trait drift never leave their ranges.
- Cache tests: cache_read tokens above 0 on the second call of each hook.
- Injection tests: 30 hostile typed lines. All answered in character, schema valid, no side effects, no tool calls.
