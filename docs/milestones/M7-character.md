# M7 character

Steve (2026-09-26): "some character customisation in the menu before start of a new game. Gender, age,
some clothes and colours, name. This in preparation for multiplayer."

## What is in

| Part | What | Where |
|---|---|---|
| The profile | Name (first, and a family name that may stay empty), sex (man or woman), the exact age (16 to 60; the band 16-20, 21-30, 31-45, 46-60 follows from it), build (slight, middling, stout), skin, hair colour and style (a man: short, long to the collar, thinning; a woman: in a bun, in plaits, plaits pinned round), facial hair for a man (clean-shaven, a few days' growth, stubble, moustache, side whiskers, short beard, walrus moustache), and the clothes by slot: head (a man: flat cap, knitted cap, round hat, tall hat; a woman: bonnet, white cap, headscarf; or bare-headed), coat (a man: shirt and waistcoat, short jacket, long coat, the blue smock; a woman: no shawl, shawl, check shawl), shirt or blouse, a man's waistcoat, trousers or skirt, apron, boots or clogs, each with a colour from the period palette (worn indigo, faded blue, blue-grey, brown, dark brown, grey, charcoal, black, faded red, bottle green, undyed linen, white linen, ochre; leather or wood for the feet) and a Sunday best flag. | `shared/character.ts` (one file for server and client: the lists, the palette, the clamp, the code, the look in words, the words) |
| Kept by player id | Table `player_profile (player_id, profile_json, code, updated_at)`, in the save file like every table. No row is today's Jef, so an old save loads as it was. A new week (`resetDb`) keeps the row: the creator writes it just before. The player row's `name` follows it (the job board's prompt reads it). | `server/src/player/profile.ts`, `db.ts` (migrate, seed) |
| The door | `GET /api/player/profile` (the profile, its code, the look in words, the words), `PUT /api/player/profile` (zod at the door, then the clamp: every field checked, an option the sex may not wear or a colour not in the palette goes back to the sex's default, a man's long apron never under a long coat or smock; the answer says what was put back), `GET /api/player/:id/look` (another player's look as a code and a name; 404 for any id but 1 today). | `server/src/player/routes.ts` |
| Names | Letters (accents too), spaces, hyphens and apostrophes only; anything else (digits, markup, quotes, control or invisible characters) and the whole name is refused; at most three words, 20 and 24 characters; not a common English word ("You", "The", "Sir"), not a town person's name (Sooi, Fientje ...), nothing the free-text gate would stop ("ignore previous", "system", "Claude"). A refused name becomes the sex's default (Jef, Mie) and the creator says so. The name is data: it only ever goes into the prompts as a name. | `shared/character.ts cleanName` |

## One place for the player in every prompt

The engine keeps writing "Jef" (the rumours must start with "Jef", the ballad guard looks for him, the
memories and the log say "Jef ..."). The profile goes in at the edges only, so none of those checks moved:

- **Every model call** passes `callClaude`; with a profile made, `player/prompt.ts playerIn` turns "Jef"
  into the name ("Jef, a young man" into "Anna, a young woman", "the farm boy" into "the farm girl",
  "a young man on the quays" by sex and age) and puts THE PLAYER at the end of the system prompt: the full
  name, sex, age and pronouns, the look in one line ("a woman of about 27, weathered skin, dark brown hair in
  a bun; in a white cap, a faded red check shawl over a blue-grey blouse, a brown skirt, an undyed linen
  apron and clogs"), how 1873 speaks to her ("missus", "lass", "girl"; never "lad", "mister", "sir") or to
  him ("lad" and "young man" only up to 30), that a "he" or "lad" in the notes means her, that a townsperson
  of the same first name is somebody else, and for a woman what 1873 thinks of a woman at dock work, in a
  dockers' tavern or out alone at night (words and looks only: the engine's rules are the same).
- **Every answer** comes back through `playerOut`: the name (the full name, then the first name when no
  capitalised word follows it, so "Anna Maes" the townswoman stays) becomes "Jef" again, and "a young woman
  on the quays" or "the farm girl" the engine's own phrases (`shared phrasesBack`), so the sermon's hint and
  the ballad's title checks hold.
- **What the browser reads**: every `/api` answer and every push (index.ts: one middleware, `broadcast`,
  the first push) goes through `shownJson`: "Jef" is the name, and the phrases that always mean the player
  ("the farm boy", "a young man on the quays", "that lad Jef", "let him look to his conduct") follow the
  profile. Without a profile all three are the identity: not a character changes, and the cache holds.
- **Hand-written lines said to the player** go through `sexed(db, line)` (server) or `toMe(line)` (client):
  "lad" "lass", "mister" and "sir" "missus", "my son" "my daughter", "young man" "young woman" (or "woman"
  past 30; "man" for a man past 30), "farm boy" "farm girl", "a better man" "a better woman".

Files touched for the lines (small, marked "M7 character"): server `day.ts` (the rent), `director/families.ts`
(a gift), `director/hiring.ts` (the foreman to Jef), `director/routines.ts` and `director/actions.ts` (a
child's refusal), `director/surprises.ts` (the stranger's greeting is to "Jef, a young man"), `hooks/dialogue.ts`
(the fallback and the canned line; a choice shown with the name still counts as offered), `interiors/tavern.ts`
("Sorry, friend"), `landmarks/confession.ts` (the opening, the advice, a woman's advice on love, "A young woman
speaks"), `landmarks/hush.ts` (the beadle), `night/gangs.ts`, `town/emigrants.ts`, `town/gifts.ts`, `town/hire.ts`,
`town/talk.ts` (the greetings, a child's "You talk funny, missus"; the shown choice), `town/treat.ts`,
`town/prison.ts`, `ideas/trouble.ts` (the stowaway without "mister"); client `game/jobs.ts`, `game/landmarks.ts`,
`game/runs.ts`, `game/backlife.ts` (the old man, the drunk, the corner lads), `game/day.ts` ("The end of Anna",
"what became of her").

## The body

- **The kit**: `tools/blender/build_player.py` builds the player from `build_people.py` (imported: the same
  lofted bodies, clothes, hats and painter, the same skeleton and rest pose, so people.glb's clips drive it):
  ten cuts of clothes (a man in shirt and waistcoat, jacket, long coat, smock, with an apron, jacket and apron;
  a woman plain, with apron, with shawl, both), seven hats and four hair pieces as meshes for the head bone,
  and the texture's parts (the face by sex, facial hair, age and thinning hair; each hat; the plain and the
  check shawl). A townsperson's colours are painted in; the player's are the game's: the painter runs once
  with every slot in grey and once per slot in white, and a pixel that changes belongs to that slot. Written:
  `player.glb` (194 KB), `player_base.png`, `player_slot.png`, `player_shade.png`, `player_atlas.json`.
  Rebuild: `"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P tools/blender/build_player.py`
  (about 5 s). people.glb is not touched.
- **The figure**: `client/src/player/look.ts PlayerFigure`: the cut, a 128 x 128 canvas painted colour x shade
  per pixel, the hat and hair hung on the head bone (a bun or pinned plaits go under a cap, bonnet or scarf),
  the build as the body's width, the townspeople's clips (a woman's own where there are: `idle_f`, `walk_f`).
- **In the world**: `client/src/player/body.ts PlayerBody` stands where Jef stands and walks as he walks. It
  draws only for the mirrors' cameras (the river, the puddles) and throws its shadow from a lantern; the eye
  never sees it (it is in its head). Hidden while swimming, climbing, riding, rowing, on a velocipede.
- **First person**: the forearm and hand are cut out of the same body by bone (`forearm`), so the sleeve, the
  cuff and the hand are as dressed: a woman's blouse sleeve with its cuff, a man's jacket with the shirt cuff.
  The gift (hands.ts) holds the thing on the palm; the lantern (lantern.ts) hangs from the hand by its ring.
  The old box arm stays as the stand-in until the figure is in.

## The screen

"Your character" (`client/src/menu/character.ts`, one export `openCharacterCreator(onDone)`): a sheet in the
menus' paper (their `.menu-sheet`, `.seg`, `.btn`, `--f-print`, `--f-hand`, the paper and ink variables, the
printer's rule), with the name fields, sex, the age by band and slider, build, and a picker with colour swatches
for each slot; the look in words under a turning figure (drag to turn); Random (a Flemish or Walloon name and a
look of the period), Sunday best, Back, Start. Start saves through the server; a name the server would not take
is shown and the sheet stays. **The hook**: the menu's New game (`menu/menu.ts newGame`, the menu helper's
`import.meta.glob("./character.ts")`) calls `openCharacterCreator(() => startNewWeek())`; the epilogue's
"N start a new week" (`game/day.ts newWeek`) goes through it too.

## Multiplayer

- The profile is per player id on the server; `/api/player/:id/look` is the only way to another player's look.
- The appearance code (`shared appearanceCode`, 20 characters, e.g. `ABLBDEDAGLGICGDBKBAA`): "A" for the version,
  then one character per field, an index into its list (the lists only grow at the end). No name in it.
  `fromAppearanceCode` gives back a whole clamped profile; a network message carries the code and the name.
- Still one player in the engine's own text: "Jef" in the memories, the rumours and the log means player 1.
  With more players each needs its own token (the player's id) in that text, and the edges map per player.

## Checks

- `npx vitest run test/character.test.ts`: 11 tests: a missing profile is Jef (and nothing changes); the limits
  (names capped, the age clamped, options by sex, colours from the palette, clogs in wood, no apron under a long
  coat, extra fields dropped, not-an-object refused); the 30 hostile lines and markup, SQL and invisible
  characters as names (all refused, the default name instead); the code round trip for 60 random characters;
  the routes; a woman's prompt (her name, she and her, "missus", "lass", the look; the answer's name back to
  Jef, a townswoman "Anna Maes" kept); a man past 30 (no "lad"); no profile: the prompt untouched; the dialogue
  hook's prompt and its fallback "Not now, lass."; the rent line; lines said to her; an old save (no table)
  loads as Jef, a save with her loads with her, the old file opens in this build, a new week keeps her; a
  tampered row goes through the clamp.
- Browser, test stack `character` (8983 / 5383), a copy of the save, headless Chrome (the preview pane was full),
  sound silent, stopped after. Shots in the session scratchpad, `character/`:
  `creator_jef.png` (the sheet on today's Jef), `creator_woman.png` (Woman), `creator_anna.png` (Anna Claes,
  27, facing), `creator_random1..4.png` (Leonie Smets, Emiel Bosmans, Mon Laenen, Seppe Verbruggen before the
  names were trimmed), `menu_newgame_creator.png` (the menu's New game, then the sheet), `menu_after_back.png`,
  `body_world_anna.png` (a dev camera: Anna in the world), `reflection_river.png` and `_close` (the river at high
  water from a low camera: her reflection, while the body itself is not drawn for that camera),
  `reflection_river_body_hidden.png` (the same with the body hidden: the reflection goes),
  `reflection_river_body_drawn_for_all.png` (dev: the body drawn for every camera), `fp_lantern_anna.png` /
  `_close` (her blouse sleeve and cuff, the hand on the lantern's ring), `fp_lantern_karel.png` / `_close`
  (a brown jacket, the linen cuff), `fp_gift_anna.png` / `_close`, `fp_gift_karel.png` / `_close` (a loaf on
  the palm), `talk_child_missus.png` (a boy: "What do you want, missus?").
- No console errors in the frame while the body walks and the arms show. No model call was made for these
  checks except what the test copy's town made on its own (the Poesje's show).

## Ideas for later

- A woman at the naties' hiring: the foreman passes her by (or sends her to the sack-menders); the dockers'
  taverns serve her at the door; the gang goes for her purse, not a fight; the police agent calls her "missus"
  and asks whose she is. Today only people's words differ.
- Women's work of 1873 on the board: washing, sewing, the fish market, domestic service, lace, the emigrant
  lodging houses.
- The player's own family (docs/01: alone, or a wife and children): for a woman, a husband.
- Choosing where one comes from (the Kempen, the Waasland, a Walloon town): the engine says "the Kempen".
- The player's shadow from gas lamps; the body in the rowing boat and on the velocipede (the clips exist).
- A mirror in the rooms (a vertical mirror: `world/mirror.ts` only does level planes).
- The client's first person with both hands for the handcart and a carried crate.
- Townspeople who share the player's first name: the town could skip it when a new week is made.

## Open

- Choices shown with the name are matched back to the offered ones in the two talk hooks; other places where
  the browser sends back text it was shown (haggling, the police talk) would take a line with the name as
  typed text (the gate and a model call) instead. Rare: those choices seldom name the player.
- The menu's own New game sheet still says "Jef back at the doss house with his fifty centimes"
  (menu/menu.ts, the menu helper's file): `aboutMe()` from `player/profile.ts` would give the name and "her".
- Engine text stored before a profile existed says "he" of the player (memories, the log); the models are told
  to read it as "she".
- The reflection is small and dark at the river's scale (the water's tint); a puddle at the feet only shows the
  body from below, as a real one would.
