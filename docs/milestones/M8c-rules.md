# M8c: the rules for making the server's code per player

M8c ("each his own man", `docs/multiplayer-plan.md` 9 and 10) gives every player his own money, needs, pockets,
job, trust, standing with the townspeople, room, deeds and letters. These are the rules every file follows, so the
work can be done file by file and the whole server suite stays green all along.

## The player a piece of work is for: `pid()`

`server/src/player/current.ts`: `pid()` is the player the work is for. Every `/api` request runs inside its
player's context (mp/index.ts sets it from the token: the host is 1, a guest his mp_player id), and so does
everything it calls and awaits. Outside any context (the server's own work for the world, the tests' plain calls)
`pid()` is 1. So: **no new parameters**; a query of the player's own things asks `pid()` instead of a fixed 1.
`asPlayer(id, fn)` runs `fn` as that player (for the server's own work per player, like the hour's hunger).
Played alone, everything is player 1 exactly as before: behaviour must not change for player 1.

## Table by table

| What | Rule |
|---|---|
| `player` row: money, needs, name, district, rent | `WHERE id = 1` becomes `WHERE id = ?` with `pid()`. `player(db)` (game.ts) already does this and gives the world's day and hour. |
| `player` row: only `day`, `hour`, `minute` | The world clock: leave `WHERE id = 1` (player 1's row keeps the world clock's copy) or use `worldClock(db)` / `clock(db)`. Never read the clock from a guest's row. Clock writes stay as they are. |
| `item` (pockets) | Insert with `player_id = pid()`; every select, update and delete of pockets adds `AND player_id = ?` with `pid()`. |
| `job`: the job in hand | "The taken job" is `status = 'taken' AND taken_by = ?` with `pid()` (takeJob in game.ts sets taken_by). The board (offered jobs) is the world's. A job by its id is fine as it is. |
| `faction_trust` | Key (player_id, faction): `WHERE player_id = ? AND faction = ?`; inserts give `player_id`; reading all factions filters `player_id = pid()`. |
| `npc_relationship` | Key (npc_id, player_id): add `AND player_id = ?` to every select and update by npc_id; insert `(npc_id, player_id)` with `INSERT OR IGNORE`. An update of a row that is not there changes nothing: make the row first (`relationship(db, id)` in npcs.ts does). |
| `npc_memory` | Use `remember()` (npcs.ts: sets `about_player`, keeps a guest's words with his name). A direct insert adds `about_player = pid()` and `storeText(db, text)`. Words read from it for the player's prompt or screen go through `readText(db, text)` (player/names.ts). |
| `log` | Use `log()` (game.ts). A direct insert adds `player_id = pid()` and `storeText(db, text)`. The player's own lines: `WHERE player_id = ?`. |
| `home_lease`, `home_item`, `deed`, `letter`, `jef_letter`, `pawn`, `diary`, `meeting` | `player_id = pid()` on insert, `AND player_id = ?` on select, update, delete of the player's own rows. The world's rows (a letter for a townsperson, a poster) stay the world's. |
| `world_state` keys that were the one player's | `pstate(db, key)`, `setPstate(db, key, value)`, `dropPstate(db, key)` (player/multi.ts), which read the host's older world_state key until it is written. The keys: `ending`, `day_start_money`, `nights_slept`, `swam_at`, `ride`, `police`, `haggle`, `gang`, `jef_carts`, `jef_velos`, `row`, `row_boats`, `row_missed`, `boat_asked`, `boat_home_trust`, `deed_trust_back`, `arrival`, `errand_queue`, `fortune_promise`, `dream`; in `families`, only the player's part (`supperDay`). Every other key is the world's. |
| In-memory maps by townsperson | A map that holds one player's talk or visit with a townsperson (hooks/dialogue.ts `talks`, town/talk.ts `sessions`, `lastFreeAt` and the like) is keyed by `${pid()}:${npc}`. |

## Words: "Jef"

The engine writes "Jef" for "the player" (player/prompt.ts puts the name in at the edges). Keep writing "Jef" in
fresh words. Words kept in shared tables go through `log()`, `remember()` or `storeText()`; words read from them
for a player go through `readText()` where they end in his prompt or on his screen.

## What each worker does

- Only the files of his part. A change another file needs: write it in the report, exactly.
- For player 1 nothing changes: the whole suite (`npx vitest run` in `server/`) passes, and `npm run typecheck`.
- A new test file for the part, `server/test/m8c-<part>.test.ts`: a blank save (`test/blank-save.ts`), a guest row
  (`ensurePlayerRow(db, 2, "Anna")`), and `asPlayer(2, () => ...)` doing that part's things: the host's money,
  pockets, trust, job, room are untouched, and the guest's are his own.
- Tests' own `WHERE id = 1` may stay.
