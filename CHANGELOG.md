# Changelog

What changed in each version of Scheldemist, for players first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).
Each release on the [Releases page](https://github.com/Steve-Sitax/Moodygame/releases) carries its part of this file.
Bugs and loose ends are tracked as [issues](https://github.com/Steve-Sitax/Moodygame/issues).

## [Unreleased]

- Godot test runs started with `--hour` or `--weather` set the game's own clock and sky to them, so the HUD clock, the daylight and the townspeople show the same hour.

- Godot's sun shines with its own colour again: by day the town, the people, the carts and the omnibus were lit a dull orange and too dark on their sunny side; now they match the browser game. ([#42](https://github.com/Steve-Sitax/Moodygame/issues/42))

- Godot adds street deeds: police visits and prison release, pocket thieves, night gangs, lanterns, gifts and tavern rounds, hired helpers, lost property, notebooks, letters and meeting doors.

- Godot lamplighters put away their pole when another scene takes over and rebuild it when their street body returns.

- Godot event attendees keep up with a later destination across town, and an older hall reply cannot replace a newer ceremony roster.

- Godot event props find a nearby clear patch when a house or live fixture blocks their original spot; reserved street actors replace retained indoor figures.

- Godot tavern and cathedral seats keep Jef still and retain their seated camera height when the ride controls are loaded.

- Godot avoids needless pose updates to resting carts, closed puppet-show curtains and ferry fixtures while keeping the same picture.

- Godot events keep their townspeople reserved when lamplighter rounds stop; emigrant boarding uses the same reservations and waits for people busy in an event.

- In Godot, standing for hire and joining a bucket chain have one prompt owner; the hiring choice works while looking around among the men.

- Godot wedding guests, mourners and the sermon crowd walk into the cathedral's real nave, take their places and walk back out through the doorway.

- Godot event attendees board and leave the omnibus; the fire pump has working paired handles and a curved hose, and the same dream can appear on another night's paper.

- Godot event crowds can draw 100 people, and blocked attendees try four other ways before standing or continuing unseen.

- Godot lamplighters walk their rounds with a pole and ladder; bucket chains pass buckets both ways, and burned fronts keep soot that fades over three days.

- In Godot, family dreams appear on the night paper, including dreams that arrive before it opens.

- Godot has a bounded places self-test covering work, home sleep and furniture, counters and dice, songs, the cathedral, emigrant boarding and the Poesje, with server replies and close pictures.

- The Godot preacher stands inside the pulpit bowl at the browser's climb height, instead of adding the plan marker's height twice.

- Starting or loading a week refreshes Godot's song, counters, dock book, hiring stand and bucket-line state; a late reply from the previous week cannot restore those old choices.

- Cart jobs can be taken and followed in Godot, with the employer's server-owned cart loan returned when the job ends.

- Godot cathedral chairs charge the chair woman's centime once per service; the curate's confessional has a kneeling paper and an AI typing gate. At Sunday high mass the priest climbs the real pulpit and preaches before trust is awarded.

- The emigrant tender keeps its real hull visible as families board in Godot, even when the bake camera hid it.

- E inside Godot's five landmark halls describes the paintings, cases, casks, stairs, scale and other objects using the browser's own prompts.

- A parcel can be collected from its sleeping employer's named, lit work box in Godot, then delivered and paid through that box.

- Godot reports the real room to the server, so sleeping and waking in your rented home and shelter inside shops and halls use the same rules as the browser.

- Godot emigrants wait with their luggage at the camp, accept carry work and board the working lighter for the liner when the server allows it.

- In Godot the Poesje takes its evening ticket once a day, opens its real curtains and performs the server's play with puppets and spoken captions.

- Godot taverns have physical table seats and arrived patrons as dice partners; E stands up again.

- Godot players can buy at real shop and tavern counters, hear the ballad singer and keep his verse-and-chorus sheet in their pockets.
- Godot adds town-hall notices, cathedral candles and a timed Sunday sermon, plus joining the hiring stand and the fire bucket line.
- Godot dock piecework, lamplighting, mill turns and park cleaning pay through the server, and finished work can wait for an employer's night box.
- Godot homes have rent notices, numbered rent choices, an own key and bed, and furniture carried home and placed on the room grid with E and R.
- Godot restores the rampart's real walkways and mill floors, with distance culling instead of keeping the bake's distant wall hidden.
- In Godot, arrive on the St. Anna ferry, walk its gangway and landing stage into town, and receive the first work hint as the ferry leaves.

- In Godot, climb out of the water onto ship decks, ride their tide and travel, and walk Anna Maria's gangway from the quay and back.

- In Godot, hail lifting bridges and the lock keeper from a rowing boat, wait for clear gates, and survive a boat broken by a bridge or passing ship.

- In Godot, hire a rowing boat, pull and feather the oars, dock at steps or ladders, and climb or jump back into a boat left on the water.

- Buy or hire a velocipede in Godot, pedal and steer through town, brake at steps and water, and get up after a wheel catches in the rails.

- In Godot, buy or hire a handcart, push it by its shafts, load the real goods onto its bed, and unload a carry job at its goal for payment.
- In Godot, climb a working crane from the quay, walk its gallery into the cabin, ride its turns and travel, and climb back down.
- In Godot, board an omnibus at its back step, hop aboard a moving one, pay or refuse the conductor, sit inside or on the roof, and read the stop timetable.
- In Godot, falls onto stone now report their measured height to the server for injuries; water takes the fall.
- Godot's path check uses the same approach distance for a walking round and its daily-plan stop, avoiding a false blocked-route report ([#43](https://github.com/Steve-Sitax/Moodygame/issues/43)).
- Godot's interior check now tests the rooms actually in the town and their views out through the windows ([#45](https://github.com/Steve-Sitax/Moodygame/issues/45)).
- Godot keeps the same daylight and window light picture with less work per frame.
- Godot's cathedral and church windows now show their real rooms through the glass; old painted panes no longer cover them.
- Godot's lamp updates and idle job display avoid temporary allocations while walking; performance checks now report complete frames and their worst peaks.
- Godot clock hands follow the game's time on tower, church, town-hall, station, shop and room clocks, including the clockmaker's window ([#44](https://github.com/Steve-Sitax/Moodygame/issues/44)).
- Godot ships and lock boats are prepared before play, and moving traffic makes far less garbage, avoiding collection pauses while movers switch or spawn.
- In Godot, the post clerk gives out rounds of letters and telegram errands. Their door prompts, quest book, map and payments now work, including resuming a round.
- F at the post and Berg clerks opens their counters in Godot. Talking and haggling in walk-around mode now keep typing off when there is no AI.
- In Godot, typing a reply pauses the menace decision timer, and a peaceful outcome keeps the screen clear.

- A Windows Godot download now starts from its executable, with the town, models, sounds and game server included.

- Godot downloads can carry the compiled server and portable Node, with matching SQLite packages and no compiler needed to play.

- The Godot game keeps saves, AI settings and logs in your own user folder, and uses one set of paths in source runs and downloads.
- The Godot job arrow and its distance stay clear of the clock and job cards.

### New in the game
- In Godot, town events gather people, put out props, close stalls, play their sounds and leave when finished. Weddings, funerals, street quarrels, robbery, hiring, the storm and the fire have their visible actors.
- In Godot, visiting family members use the server's names and daily plans, and Zelie's fortune-telling table has its cloth, cards and stool.
- The Godot version has doorstep cats and stray dogs, dogs following their owners, and park birds that move away, then fly when pressed. Doorstep chores and children's games follow the town's daily plans.
- The Godot version draws the server's occupants in the five landmark halls, with their seats and shared floor plans, and provides room visitors for the homes part.
- In Godot, market stalls and shop tables put their goods out while their keepers work, then roll up the awning and cover the table. Shop tables fit beside the door without passing the house corner.
- The Godot quay train and travelling cranes yield to people, and crane jibs keep clear of ship masts and passing wagons.
- Godot omnibus passengers walk aboard and take their seats; people wait at the stops, and families move about their moored ships. Boat lanterns and omnibus lamps follow nightfall, and the town map follows the moving traffic.
- The Godot port has roaming horse drays and handcarts, and the Rijnkaai goods carts follow their working-day rounds. The horses step, the wheels roll and the carters walk with their loads.
- In the Godot port, six horse omnibuses follow their three lines, stop at their bays and wait for the morning timetable at night. Their wheels turn and their carriage lamps follow dusk.
- In the Godot port, jobs use the shared paper windows, people, pockets and map. The quest book follows work in hand, and sleep has its own chooser. Goods use the decoded models and survive a loaded save or new week. Trouble on a job offers the server's choices and extra errands.
- The Godot game has the harbour's soundscape, footsteps, made voices and room echoes. Its clock, rain, townspeople, speech bubbles and dice feed the sound, and the Sound settings control the mix.
- The Godot handbill has a Together paper for hosting, joining with an address and code, and going home.
- Godot players can host and join a shared town, see each other walking with names and gear, and return to their own game. Each player keeps their own money and needs.
- The back neighbourhoods have a bakery, grocer and cobbler, plus In de Linde and De Zwarte Kat. The latter welcomes players trusted by the smugglers; outsiders are warned to leave and refused service.
- Ivy and red autumn Virginia creeper climb the town wall's inner face, along the Stadspark and the streets behind the wall.
- Daylight has shadow play: the houses throw shadows into the streets and onto the squares, narrow lanes are dimmer at their foot, and people, carts and drays have a soft shadow under them. The sun follows its real October path, from the south-east in the morning to the west in the evening. On fog days the light stays soft.
- Jump onto a rolling omnibus: run up to its back step and press Space (or E). The conductor comes for the fare: pay, or he curses and puts you off.
- The town map shows places as small icons. Point at one to see its name, how far it is and which way. The key in the map's corner turns each kind on and off: your job, work, events, food and markets, taverns, shops, services, beds, churches and sights, water pumps, street names. Names no longer print on top of each other.
- Jump over railings, crates and low walls: hold Space at the obstacle, or jump and press Space again near the top. Over a railing by the water you land in the river and swim.
- Jump down into a small boat from the quay: face her and press Space (or E). You land on the seat, ready to row.
- A fall of more than 3 m hurts, more the higher you fall; a fall into water does not. Hold Space at a crane's gallery rail to jump off.
- Ducks, geese and swans swim or walk away when you come near. Keep coming and they fly: to another pond, or out to the Schelde and the docks. New flocks of ducks live on the Petit Bassin, the Entrepot dock, the canal and the river.
- Hold Space to climb onto reachable solid obstacles or vault over them when there is a clear landing. Tall walls, low ceilings and unsafe drops stop the climb.
- The Dev menu has an optional NPC stress-test toggle and a 1–100× population slider. Normal population stays unchanged; Reset or reloading returns to normal.
- The Stadspark has fuller autumn trees, hanging willows, a large old oak with squirrels and perching birds, more shrubs and flowers, and reflections in its pond.
- Ducks, geese and swans swim, graze, feed and fly to other water. Squirrels forage, stop to eat and climb; animals seek shelter, cats stalk unguarded prey, and mothers protect their young.
- Visitors feed birds and wealthy neighbours walk their dogs from home to the park and back. Dogs leave mess for the keeper; borrow his tools and clear ten droppings for 35 centimes.
- The Oostershuis has real windows and doors: look into its warehouse lofts, the tower rooms and the hall; the fanlights over the warehouse doors are glass ([#28](https://github.com/Steve-Sitax/Moodygame/issues/28)).
- The cellar room to let has a real window under the pavement, onto a light well with an iron grating, instead of a painted view ([#28](https://github.com/Steve-Sitax/Moodygame/issues/28)).
- The Vleeshuis attic is open: climb the new stair from the painter's studio and look out through its gable windows and dormers. Its turrets and stair tower show their stairs through the slits ([#28](https://github.com/Steve-Sitax/Moodygame/issues/28)).
- The town hall's 54 roof dormers are real windows, with the attic behind them ([#28](https://github.com/Steve-Sitax/Moodygame/issues/28)).
- The cathedral's towers are open: behind their lancets and louvres you see the chambers, the bell frames with their bells, and the carillon in the north tower ([#28](https://github.com/Steve-Sitax/Moodygame/issues/28)).
- The crossing tower and the dormers of the cathedral's great roof have real windows, with the timber frame and the roof space behind them ([#28](https://github.com/Steve-Sitax/Moodygame/issues/28)).
- Sunlight falls on the floors of the cathedral's chapels round the choir ([#28](https://github.com/Steve-Sitax/Moodygame/issues/28)).
- The towers, belfries, roof spaces, sacristies, the convent of St Paul's and the Jesuit house of the Carolus show real rooms behind their windows: bells and louvres, trusses, cells ([#28](https://github.com/Steve-Sitax/Moodygame/issues/28)).
- In the Carolus the round windows over the side doors and the front's middle windows show whole from inside the aisles ([#28](https://github.com/Steve-Sitax/Moodygame/issues/28)).

### Changed
- Godot townspeople and animals reuse their frame buffers and whereabouts answers, removing the crowd's steady garbage allocations; nearby bodies keep moving at the frame rate while bone animations run at a bounded rate.
- Godot collapse and week-ending papers have one owner: getting up closes the night completely, and chosen sleep says its wake lines once.
- Returning home from a Godot Together game clears the old resident and people-model caches before using fresh bodies. The reusable talk input is freed at shutdown, clearing the scripted tests' resource leaks ([#40](https://github.com/Steve-Sitax/Moodygame/issues/40)).
- The Godot job test now checks the quest book, map, restored goods, talk, drinking, trouble choices and extra errands, and records server state and goods replies beside its pictures.
- The Godot multiplayer check uses separate disposable host and guest saves, including when the guest returns home.
- Godot hosting opens to the home network by default, including the `--host` shortcut.
- Godot night, waking and week-ending papers use the shared game window stack alongside the menus.
- Lamps and lanterns no longer wear big orange circles: a small soft glow at the glass. The omnibus's carriage lamps now light the street and the house fronts as it drives by.
- Esc closes the map, the quest book, a talk or any other window, as E does, instead of opening the main menu. Click or press W to walk on.
- You can only pick a pocket from behind the person.
- The lower parts of the cathedral's aisle windows, behind the houses built against it, are walled up instead of painted ([#28](https://github.com/Steve-Sitax/Moodygame/issues/28)).

### Fixed
- In the Godot port, sound recordings, player pools and first-use audio work are prepared while the town loads, so a bell, voice, loop or storm does not hitch the first walk ([#41](https://github.com/Steve-Sitax/Moodygame/issues/41)).
- Townspeople no longer stand inside each other. Dockers waiting by Het Schipke stood in one another, sacks through the next man: a dock crane parked over their way counted as a solid block, so they found no path and waited on one spot. People now walk under the cranes, step apart when they meet on one spot, keep more room with a sack, and never appear inside someone else.
- Café chairs face their tables from the aisle side, with space to leave the long bench; standing customers also take walking breaks.
- Adding the backstreet businesses to an older town preserves occupied households and cannot prevent that save from opening.
- Boat families, bench sitters, shop and café staff, guards, workshop workers and people in landmark halls take local walking and working breaks. Seated people get up and return; prisoners pace inside their cells and window watchers go back indoors.
- The Stadspark's lamps light the paths round them at night, as the street's gas lamps do.
- You can climb the cranes again, also while they work: the crane does not stop for you. You ride its gallery as the jib turns and the crane rolls; at the top you wait on the ladder until the gallery swings round. The dock cranes' ladders can be reached from the quay again ([#37](https://github.com/Steve-Sitax/Moodygame/issues/37)).
- Stadspark droppings are scattered over reachable ground, including existing saves; piles reserved for a cleanup job stay put. Pond reflections update every frame and remain visible from all banks. The pond is deeper and you can swim through it, under the bridge, and climb onto its banks ([#34](https://github.com/Steve-Sitax/Moodygame/issues/34)).
- Carts, horses and omnibuses have more room beside the Eilandje lock, the Vliet post and the Vleeshuis steps. Employers keep out of bus lanes, and buses check obstructions throughout their routes ([#31](https://github.com/Steve-Sitax/Moodygame/issues/31)).
- Dock workers keep their spacing on shared rounds when a change to the streets alters their journey to work.
- House doors, their transom trim and window bars show their plank grain in daylight instead of looking nearly black ([#30](https://github.com/Steve-Sitax/Moodygame/issues/30)).
- Taverns, shops and homes: the rooms behind their windows and open doors are no longer partly hidden by the pavement or the dark inside of the house front ([#29](https://github.com/Steve-Sitax/Moodygame/issues/29)).

## [0.2.0] - 2026-09-29

### New in the game
- **The great storm.** Now and then a storm comes in off the sea. Every shop and stall shuts, nobody gives out
  work, and the townspeople run home, into the taverns or under a doorway. Thunder, lightning, rain in sheets,
  surf over the quay walls, slates and washing torn loose. After it, rain, and the town opens again.
- **The docks at work.** Cranes feed real piles of goods; dockers carry them and take their breaks. The foreman
  keeps a book, and dock work is paid by the piece.
- **A quest book.** Hold up to three jobs at once and follow one. The town map shows the way. A mixed load is
  paid per job, and you can give a job up.
- **A town that trades.** Bread runs from the bakeries, fish boxes to the stalls, kegs from the brewery to the
  taverns, coal to the ovens, grain from the mills. A market that sells out packs up early. When a bakery runs
  short, there is a rush job to fetch bread from the other one. The map card of a shop or tavern shows its shelf.
- **Pigs.** At dawn a farmer drives his pigs through the streets to the butcher.
- **The lamplighter's job.** Light the last lamps of a round at dusk, paid by the lamps you light and the way you
  walk. Five new rounds on the town wall and five new lamplighters: every one of the town's lamps is now lit by
  someone who walks to it.
- **Stealing.** Pickpocket, take what is left lying about, and face the owner when you are caught.
- **Real windows in the great buildings.** The cathedral, the town hall, the Vleeshuis, the Steen, St Paul's,
  St James's and the Carolus church: from the street you see into the halls, and from inside you see the street.
  The cathedral's choir aisles and its five chapels are built and open to walk.
- **Windows lit by the clock.** The landmarks light room by room in the evening; sun and moon shine into the
  churches.
- **Goods that look real.** One sack and one crate everywhere they show (piles, arms, carts, boats), with a
  stencil that says what is inside and where it comes from.
- **Play in the browser.** A web demo at https://steve-sitax.github.io/Moodygame/ to walk the town, with the
  time, the weather and every town event (the storm too) under F8. No talk, jobs or AI there.

### Changed
- Lamplighter pay counts the walk as well as the lamps (the west round 110 c to 125 c, the market round 100 c to
  115 c, the east round 80 c to 95 c).
- Gas lamps have a cap: their light no longer climbs the house fronts above the ground floor.
- New game no longer keeps a copy of the old week in `data/backups`. Your own saves stay.
- Falling leaves lie only near trees; in a storm they tear off the trees and the leaf heaps.
- The town wall's walk has new stones.
- Faster: fewer draw calls, mirrors on a budget, far people and trees updated in turns.

### Fixed
- The mills did not load, so their drays and sacks were missing ([#22](https://github.com/Steve-Sitax/Moodygame/issues/22)).
- Freezes of up to 3 s just after a jump across town ([#7](https://github.com/Steve-Sitax/Moodygame/issues/7)).
- A blank screen when the page loaded before the server ([#18](https://github.com/Steve-Sitax/Moodygame/issues/18)).
- The storm's far rain layer never showed ([#20](https://github.com/Steve-Sitax/Moodygame/issues/20)).
- Bright streaks up the town hall's front at night ([#11](https://github.com/Steve-Sitax/Moodygame/issues/11)).
- Memory crept up in long sessions ([#19](https://github.com/Steve-Sitax/Moodygame/issues/19)); too many server calls at once ([#15](https://github.com/Steve-Sitax/Moodygame/issues/15)); graphics warnings after load ([#23](https://github.com/Steve-Sitax/Moodygame/issues/23)).
- Mirrors were drawn every frame inside the cathedral, slowing it down ([#27](https://github.com/Steve-Sitax/Moodygame/issues/27)).
- A lamp went dark for a moment when its lamplighter came into view ([#24](https://github.com/Steve-Sitax/Moodygame/issues/24)).
- Crates, barrels and litter stood inside each other or inside walls ([#13](https://github.com/Steve-Sitax/Moodygame/issues/13)); a window's light fell under the ground ([#6](https://github.com/Steve-Sitax/Moodygame/issues/6)).
- Rooms in some houses and in the Poesje could not be reached on foot, and a garret had a painted window ([#10](https://github.com/Steve-Sitax/Moodygame/issues/10)).
- Madame Zelie's table did not match the look of the town ([#16](https://github.com/Steve-Sitax/Moodygame/issues/16)).
- Stones on the town wall's walk ran together ([#3](https://github.com/Steve-Sitax/Moodygame/issues/3)).
- The web demo's menu threw an error ([#12](https://github.com/Steve-Sitax/Moodygame/issues/12)).
- Townspeople no longer walk on the spot or lag after a clock jump; carts move smoothly and keep off the walls.

### For developers
- Flaky and failing tests fixed ([#4](https://github.com/Steve-Sitax/Moodygame/issues/4), [#5](https://github.com/Steve-Sitax/Moodygame/issues/5), [#9](https://github.com/Steve-Sitax/Moodygame/issues/9), [#17](https://github.com/Steve-Sitax/Moodygame/issues/17)); lock files carry the licence ([#2](https://github.com/Steve-Sitax/Moodygame/issues/2)).
- Test tools: `perfcheck` stops only its own stack ([#21](https://github.com/Steve-Sitax/Moodygame/issues/21)), `t.run` steps the ambient ([#8](https://github.com/Steve-Sitax/Moodygame/issues/8)), the interior check reaches the whole room ([#25](https://github.com/Steve-Sitax/Moodygame/issues/25)), the Steen's path points ([#1](https://github.com/Steve-Sitax/Moodygame/issues/1)).
- A pre-commit check keeps private data out of the public repo; frame budget rules in `docs/performance.md`.

## [0.1.0] - 2026-09-27

The first release: Antwerp in autumn 1873 to walk, work and talk in, with downloads for Windows, Mac and Linux.

[Unreleased]: https://github.com/Steve-Sitax/Moodygame/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Steve-Sitax/Moodygame/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Steve-Sitax/Moodygame/releases/tag/v0.1.0
