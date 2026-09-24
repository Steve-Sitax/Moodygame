# 08 - Decisions (was: open questions)

All answered by Steve on 2026-09-23.

| # | Question | Decision |
|---|---|---|
| 1 | 3D engine | Three.js. Blender for assets. Unity allowed but not needed. |
| 2 | Trust model | Per faction, five numbers. |
| 2b | Trust shown? | Hidden. Felt through dialogue, jobs and rumours. No bars. |
| 3 | Demo length | One in-game week, then an AI epilogue. |
| 3b | Early end? | Yes. Health 0 or arrest ends the run with a short bad-ending epilogue. |
| 4 | Player voice | Three generated choices plus a free text box. Free text is guarded (see 03). |
| 5 | Family | Player picks the family at start: none, a wife, up to 4 kids. Every family member is a full NPC with persona and memory. |
| 5b | Child labour | Yes, as a hard choice. Kids 10+ can work for small pay. Health, wife and priest react. |
| 6 | Second model | Codex with `gpt-6-luna` and `gpt-6-sol`, medium; Steve's standing OK for this project (2026-09-24, `.claude/rule-overrides.md`). Router (M6-models.md): GPT Luna writes the paper, the wall bills, rumour twists, dreams, street conversations and family news; Opus 5.5 everything else and all player text, and is the fallback. No Sonnet or Haiku (Steve: "use luna instead"). |
| 7 | Title | Scheldemist. |
| 8 | Language | Plain English. Dutch only in names of people, places, firms and ships (and jenever). No Dutch forms of address or exclamations (jongen, maat, schat, goed...). Steve, 2026-09-23: "the dutch words are weird". Prompts carry the rule; `server/src/text.ts` filters what slips through. |
| 9 | Camera | First person. |
| 10 | Combat (asked again 2026-09-23 after M2b) | No combat in the demo. Thieves and gangs may appear, but danger is narrated, chased off, or costs money and trust. |
| 11 | Trust range (2026-09-24) | Trust (personal and per faction) runs from -5 to 10. Below 0 people turn cold; at -3 a seller refuses. "We can later implement hate and fights then" (docs/09-backlog.md); until then #10 stands. |
| 12 | AI budget (2026-09-24) | 120 model calls a game day, 15 in reserve; each feature has a share in `server/src/config.ts` and falls back to engine words when it is used up. |

## Family rules that follow from 5 and 5b
- Start screen: pick wife yes/no, kids 0-4 with names and ages 2-14. More mouths, harder game. Rent and food scale.
- Each family member: persona, relationship row, memories. Same tables as other NPCs. Flag `is_family = 1`.
- Home scene at night is one model call. It gets all family personas and memories and returns one line per person. This keeps the wait at one call, not five.
- Kids 10+ can be sent to a job by the player in the morning. Pay is 20-40 centimes. Each working day lowers the kid's health by 1 and raises a "schooling lost" counter. The wife and Pastoor Cools get a "seen" memory of it.
- Sick family members need medicine. Untreated, health falls each day. A family death is an early end.
