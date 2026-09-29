# T4: the quest book

The plan: `docs/trade-plan.md`, "The quest book: several jobs, a cart with several loads, clear goals". Decided
(Steve 2026-09-27): a player can hold several jobs at once, and where to go is clear.

## Done (2026-09-29)

- **Several jobs** (server `game.ts takeJob`, `MAX_JOBS_IN_HAND` = 3): a fourth is refused ("You have your hands full
  already..."). Each job keeps its own time, twists and pay: they are the jobs' own rows, as before.
- **One followed job** (client `game/jobs.ts`): it drives the task card, the glow and the tick, as the one job did.
  The others wait: their goods stay where they lie (the server's, tagged with their job), their clocks run on the
  server. Switching sets the followed job's run aside without ending it and picks the other up the way a reload
  picks a job up. The followed job is kept over a reload (`localStorage scheldemist.follow`). When it ends, the next
  one in the book is followed at once.
- **Taking work**: the board and the talk take a second and a third job ("In your book: ... J to follow it"). With
  three, the talk's offer waits ("later").
- **The book** (J, `menu/keys.ts` "book", paper as the board): a page per job with the pay, the employer, what and
  where, the distance from you, and the twists you were told of (only those: "The foreman is watching"; a thief or a
  broken crate stays a surprise). A number follows that job; G asks to give up the followed one and G again gives it
  up (no pay, the employer's trust as the engine settles a job with nothing done); M opens the map; J or Esc closes.
- **The task card**: the followed job as before, and one short line per other job with its distance ("and: Parcel
  to the Grote Markt - 160 m").
- **The paper map**: the other jobs' goals as numbered marks ("2: Parcel to the Grote Markt").

## Done (2026-09-29, the night's second pass)

- **Mixed loads, each job paid at its own goal**: goods of a job in hand that is not followed count for that job:
  set down within reach of its goal, tipped off the cart there (F offers the job whose goal is here, the followed
  one first), or lost (the Schelde, a gang, a cart wheeled off). Its progress is saved and, when all its goods are
  in, it is settled and paid at once ("\"Crates for Sooi\" is done. Sooi pays 90 c.") (`jobs.ts tally`,
  `tallyAside`; `handcart.ts unloadAllAction`, `unloadAll(d, job)`).
- **Switching keeps the goods** (found in this pass): following another job wiped the old job's goods from the
  world (loose ones and the one in his hands; only the cart's stayed). A set-aside run now keeps them
  (`Run.dispose(keepGoods)`).
- **Giving up works for every job** (found in this pass): the book sent an empty report as "done", which a carry job
  refuses ("goods not all accounted for"). Now `POST /api/jobs/:id/giveup` (server `game.ts giveUpJob`): no pay, the
  employer's trust one down, a plain fact and memory ("Jef took on ... and gave it up"), the job's goods gone.
- **The way on foot on the paper map**: a dotted red line from Jef along the streets to where the followed job goes
  now (the server's walk map, the townspeople's ways), on the big map and the round corner map; asked again when he
  has moved 12 m or the goal changed. The key in the corner has a row for it (the key itself was already there).

## Not yet

- "On your way" offers (a need near the followed job's way, 10% more).
- A job only in the book (never followed) has no goods laid out yet: follow it once to have them put out.

## Checks

- `server/test/t4-book.test.ts`: three jobs taken, a fourth refused.
- `server/test/t4-book.test.ts`: a carry job given up: no pay, trust one down, no longer in hand.
- `server/test/handcart.test.ts`: two jobs' crates on one cart, each unloaded and paid at its own goal.
- Browser (test stack, 2026-09-29): following job 99, job 100's two crates carried by hand to its goal: "1 of 2 in",
  then "done, Sooi pays 90 c" (money 50 -> 140), job 99 still followed; switching jobs keeps both jobs' crates; at the
  goal F offers the set-aside job's crates on the cart; the dotted way from the Vleeshuis to the pier head.
- Browser (test stack): three jobs taken from the board, the task card lists the other two with distances; the book
  shows three pages; 2 follows the second, G G gives it up, the first is followed again; a reload keeps the book.
