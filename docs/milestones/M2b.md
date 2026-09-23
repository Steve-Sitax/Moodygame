# M2b - Job depth, 2026-09-23

Why: after M2, Steve found every job the same: fetch crates. Claude wrote varied jobs, but the game played only one kind, the same way each time. Steve chose to fix this before M3 (docs/09-backlog).

Goal (docs/06): Claude picks goods, places, time limit and one twist per job from engine lists. Watch and deliver jobs play. Goods can be set down anywhere or lost in the Schelde. job_outcome narrates each job and writes an employer memory. A subtle pointer shows where to go.

## How to run
Same as M2: `npm run dev` in the repo root, then http://localhost:5173. Delete `data/game.sqlite` to start over.

## What is in
| Part | Where | Notes |
|---|---|---|
| Shared places | `shared/spots.json` | 8 named spots on the Rijnkaai. Server offers the ids to Claude; the client places things there. One source for both. |
| Board schema | `server/src/hooks/jobBoard.ts` | Per job Claude picks: employer (Sooi, Widow Peeters, Tuur), task type, goods, from, to, twist, urgent, recipient, pay, risk, pitch. Enums only. `taskFor()` fixes what does not fit (twist not valid for the type, same place twice) and sets count, time limit and watch length. Pay still clamped to the tier band. |
| Twists | server + `client/src/game/runs.ts` | Carry: broken goods (fill your pockets), stranger buys one, foreman watches, thick fog, heavy load. Watch: thief in the fog (shout at him), bribe (take coin, look away), foreman checks your post, thick fog. Deliver: stranger buys the parcel, thick fog. |
| Engine rules | `server/src/game.ts` `settle()` | Pure function, tested. Share of pay per item delivered; late -25 %; selling or pocketing pays coin but 35 % chance to be caught (100 % if the foreman watches), caught = no pay and trust -2; a lost item = trust -1; a clean job = trust +1. Watch: away from post or goods stolen halves pay; chasing the thief = 15 c tip. |
| Progress | `POST /api/jobs/:id/progress` | Delivered, lost and sold are saved after each item. A reload continues the job. |
| job_outcome hook | `server/src/hooks/jobOutcome.ts` | After the engine has paid, Claude writes 1-2 lines in the employer's voice and one memory sentence. Stored in `job.outcome_text` and `npc_memory` (weight clamped 3-8). Arrives by WebSocket; the game never waits. Hand-written fallback. |
| Board refill | `server/src/index.ts` | When no playable job is left, Claude writes a new board. Stand-in until the M5 day loop. |
| Goods props | `client/src/game/props.ts` | Crates, sacks, barrels, hides, rope coils, parcel. Each has its own carrying speed and set-down sound. |
| Figures | `client/src/game/figures.ts` | Grey-box people (coat, head, hat) for the stranger, thief, foreman, recipient. Real NPCs come in M3. |
| Set down anywhere | `runs.ts` | E sets the item down in front of you, E lifts it again. Facing open water: "let it fall into the Schelde" (splash, it sinks, counts as lost). |
| Pointer | `client/src/game/jobs.ts` | A faint warm glow over the current goal, and a small ink mark at the top edge that slides toward it. Both fade out when you are close. |
| Gangway | `client/src/world/rijnkaai.ts` | Plank ramp from the quay to the three-master, for the `ship_gangway` spot. |
| Sounds | `assets/ATTRIBUTION.md` | Recorded, CC0: splash and bell (BigSoundBank), set-down thuds (Kenney). |

## Checks done (2026-09-23)
- `npm test`: 18 of 18 (board picks, fixes, clamps, fallback, timeout; carry, watch, deliver rules; caught and not caught; progress; outcome storage).
- Real Claude board, 8-12 s. Hints hide the twists well: "Mind your count, somebody will be counting after you" (foreman), "In this mist a coil walks off easy" (thief), Tuur's "no questions" parcel (stranger).
- First real board failed: the bigger schema needs the CLI to correct its JSON, which takes a second turn. `maxTurns` raised from 1 to 3. The fallback board covered the failure.
- In the browser, by script:
  - Watch with thief: thief came at about 30 s, pointer turned to him, "shout at him" chased him off. Paid 70 c + 15 c tip.
  - Carry with foreman: set a sack down on the quay, lifted it again, let one fall into the Schelde, delivered the rest. Paid 55 c of 80 (2 of 3).
  - Deliver with stranger: sold Tuur's parcel for 60 c; Tuur found out. Job failed, no pay.
  - Claude's outcome notes arrived after each job, in voice.
- Fixed during checks: the job's start message covered the twist message; finished jobs piled up on the board (now the last two only).
- `npm run build` passes.

## Open
- Row, find and talk jobs; cart and transport upgrades; letters, eavesdropping (docs/09-backlog).
- Figures are silhouettes and walk through props. M3 brings real NPCs.
- Trust moves per faction only. Per-NPC relationship rows start in M3.
