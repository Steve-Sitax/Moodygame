# M9: stealing, caught at it, and picking pockets

Built 2026-09-27 on branch `claude/stealing-interactions-mechanics-5944aa` (worktree). Steve's brief, in short:
witnesses need to see it, not only be near; brave ones confront, others fetch the police; sorry and the thing back
may settle it (or they want money); breaking off means the police and the paper; his good name matters; the police
fine, the thing goes back, no escape once spoken to; the prison takes all; light and dark matter; picking pockets.

## Steve's choices (2026-09-27)
- The good name ("charisma") is **no new number**: it is read from what the town keeps (trust of those who know him,
  the talk of his thieving, his police record). `server/src/town/charisma.ts`.
- **The prison**: he wakes at the prison gate in the Begijnenstraat at dawn; all his money and pocket goods are gone;
  the town talks of it and trusts him less.
- **Running from the police**: possible before an agent speaks to him; once spoken to, never.
- Typed answers to one who caught him are **read by the AI** (hook `resident_confront`, Claude only): kind words may
  earn a pass, rude ones make it worse. **No AI, no typed answer**: the choices only (also at the police).
- The extra ideas: use them all.

## What happens now

**Sight** (`town/deeds.ts`). Light at the spot: the day, a burning gas lamp (lamplighters' rounds; full at its foot,
gone at 13 m), his own lit lantern. In the dark (light 0.1) sight is a few metres and only a face turned his way
sees. Under a lamp a clear line sees from 20-30 m. Fog, rain and distance as before.

**Half seen.** A roll just over the chance makes a suspect: "X looks your way. Walk, don't run." Running within
their sight in the next 20 s makes them sure (`/api/deed/:id/noticed`).

**Who does what** (`roleOf`). Brave (courage 6, the owner 5): comes to have it out with him. Otherwise the owner
or an honest one runs for the nearest agent, shouting (the agent comes in 6 game minutes); a child runs too; the
old and the sentries shout; the rest keep quiet and remember. An agent who sees it comes at once.

**The confront** (`town/confront.ts`, the ordinary talk window). While it lasts nothing is told: no rumour, no
police. The choices: *sorry, here it is* / *here's money, forget it* / *mind your own business*.
- Sorry: the thing leaves his pockets or goes home (velocipede, boat, handcart, lantern back on its hook, food back
  on the table). They forgive by warmth, temper, trust, his good name, how bad it was, whether he did it to them
  before. Forgiven: no thief's name, no paper, no police; trust -1 with them. Not forgiven: a greedy one names a
  price to say no more (pay: settled); else the police.
- Money offered: the greedy take it (the owner wants his thing back too); the honest are insulted: police.
- Mind your own business, walking off, closing the talk, or not coming back in 30 game minutes: the police, the
  paper (`caught_stealing`), and the talk goes round.
- Good name too low (charisma 2 or less): sorry is not enough; police and paper whatever he says.

**Faces stick.** Someone who saw him steal (not settled) and meets him again, near, in good light, may point him
out: the police come sooner (`/api/deed/recognise`, once a deed each).

**Pickpocketing** (`town/pickpocket.ts`). G when walking (not running) up to someone in the street. The mark feels
it: young more than old, a face turned to him more, a drinker or a shopper less, a crowd hides the hand, practice
helps, a thief or an agent knows the trick. Onlookers see it by the light like any theft (a hand is small: 0.6 of
the chance). Got away: coins by the mark's wealth, sometimes a silver watch or a handkerchief; the mark finds the
pocket light 30-90 s later and knows if Jef is still near and visible. Seen or felt: a deed like any theft.

**Hot goods.** The Berg lends half on a stolen thing, and the clerk remembers.

**The police** (`town/police.ts`). A theft someone saw is at least a fine (only the town's talk alone can be a
warning). "I won't pay you a centime": the prison. Twice before (fines and arrests): the prison. Can't pay: the
prison. Spoken to and runs: more agents cut him off: the prison (`/api/police/seize`).

## Checks
- Server: `test/m9-theft.test.ts` (31 tests: light, roles, confront paths, AI-read words with hostile lines,
  no-AI gate, suspects, faces, pickpocket, prison), older theft tests brought up to the new rules. Full suite
  1288/1289; the one left is the known flake #4.
- Browser (test stack, a copy of Steve's save): his save is a known thief (two fines, ~70 people talking), so the
  good name read "had enough" and every theft went to the police at once, as it should. With that history cleared
  in the copy: a witness confronted, a typed polite sorry was read by the AI and forgiven; "mind your own
  business" sent the owner running to an agent, who came; the agent spoke, the prison sheet (all 71 c and both
  things taken), out at the prison gate at dawn; G picked a pocket on the Grote Markt (10 c and a handkerchief), an
  onlooker saw and came; a rude, threatening typed answer sent him for the police. `paths()` empty.

## Fixed on the way
- `game/hands.ts` replaced the talk's reply hook instead of chaining it.
- A confronter out of view was frozen where she stood (hidden puppets do not walk): she now steps out round a corner
  near Jef.

## Not yet
- The client never tells the server a mark is busy (talking, watching a show): `busy` is always false.
- A suspect looking his way does not turn their head while walking (`town.gesture` works only for someone standing).
- Not yet checked with two players (the confront and the runners are per player on the server; the walking is the host's).
