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

## Not yet

- The dotted way line from the player to the followed goal and a legend on the paper map.
- "On your way" offers (a need near the followed job's way, 10% more).
- A mixed handcart load across jobs: each item already keeps its job; the cart's own rules still follow the
  followed job only.

## Checks

- `server/test/t4-book.test.ts`: three jobs taken, a fourth refused.
- Browser (test stack): three jobs taken from the board, the task card lists the other two with distances; the book
  shows three pages; 2 follows the second, G G gives it up, the first is followed again; a reload keeps the book.
