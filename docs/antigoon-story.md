# Antigoon story and quests

Revised draft, 2026-10-16. The user requirements below remain fixed. The chapter script, origin,
combat proposals and ending are the refined design, not implemented gameplay. Independent opinions
and the reasons for the revisions are in [the story review](antigoon-story-review.md).

(The review file is not in this repository yet. What is built so far is listed at the end, under
"Implementation state".)

## Premise and motive

Jef arrives in Antwerp in autumn 1873 with little money and rent due. Work, food, sleep and familiar
people remain the centre of his week. A paid errand for a lamplighter draws him into disappearances
along the quay. What begins as finishing another man's round becomes an investigation and a hunt.

Draft story choice: a dredger recovered a huge hand-shaped relic, now held in a merchant's store near
the Steen. Antigoon is drawn towards it from his refuge in the Ruien. Hunger explains his detours
through the fish and meat markets; the relic explains why he keeps returning to this neighbourhood.
His routes become evidence the player can use. The exact supernatural origin can remain unsettling
without making his practical behaviour unknowable.

Jef may have helped unload that consignment through an optional ordinary job. Otherwise he learns
about it from the delivery record and a witness. Never tell the player he caused or witnessed an
incident he did not play. The relic connects to the severed-hand legend; it does not require changing
the current creature to a one-handed model. Keep his two-handed shielding.

## Fixed user requirements

- A slender giant 3.85 m tall, roughly twice human height, living in the Ruien and roaming streets at night.
- He runs faster than Jef, occasionally kills residents, and must be frightening to encounter.
- The player must be able to fight him. The campaign builds towards a substantial confrontation.
- He avoids strong light. He can cross it slowly while shielding his head with his hands, without
  acquiring targets or attacking while shielding.
- He walks with purpose or roams naturally; genuine pauses include breathing and looking around.
  Grounded feet and convincing whole-body attacks are acceptance requirements.
- Scripted sightings start and end behind real cover. No visible spawning or disappearance.
- The scripted story is single-player. Multiplayer may have one shared roaming giant in the Ruien
  and backstreets, with players cooperating to escape or hunt him.
- Until accepted for normal play, activation remains DEV-only, leaves Jef in place and uses a red
  locator with live distance. That locator must not appear in normal gameplay.

## Pacing and practical limits

Use one story entry with one current objective and retained clues, separate from the three wage-job
slots. Reuse the quest book and navigation UI, but do not treat six story chapters as six board jobs.
Normal quest directions may lead to a person or place; they never track the hidden giant.

Target 8-12 game hours of mandatory activity over the week, excluding ordinary work and travel.
These are playtest budgets, not measured durations. Keep hand-carried errands to one or two items.
Pay ordinary lamp work at its normal rate. Loan essential light and fighting equipment; accepting the
story must not consume the money needed to eat or make victory depend on an expensive purchase.

| Example day | Story activity | Space for ordinary life |
|---|---|---|
| 1 | Q1 and Q2: lamp round, clues and a safe first glimpse | Paid work; no compulsory chase |
| 2 | Witnesses and delivery records if still needed | Work, sleep and a quiet night |
| 3 | Q3: the house and first escape | Daytime work; recovery afterwards |
| 4 | Q4: a short underground reconnaissance | Resupply and a quiet night |
| 5 | Q5: prepare and fight the ambush | Preparation replaces a short work period |
| 6 | Q6: return to the refuge and finish the hunt | Rest before entry; aftermath afterwards |
| 7 | Spare time for delayed chapters and rent | The existing Sunday midnight ending remains |

These are opportunities, not fixed dates or appointments. Clues never require waiting an extra day.
Q2 can finish beside Q1 or before Q3; preparation can happen by daylight. Aim for three dangerous
outings: the house escape, ambush and finale. Later roaming must leave quiet periods between them.
Do not teleport Jef, advance the clock to force a scene, or punish him for sleeping through a trigger.

A late start may end with an unfinished investigation. Show the remaining week and next objective
honestly. Reserve three game hours for the finale; do not offer its final commitment after 21:00 on
Sunday. Investigation and retreat remain available. Sunday midnight still ends a delayed attempt;
never promise a secret extension or silently freeze needs. Include an unfinished-story epilogue.

## Light and fair danger

Teach two different facts: strong light prevents an attack, but an exposed lamp can be broken.
The first teaching lamp is dependable. Demonstrate a stone breaking a distant lamp while Jef has
shelter, before using that attack against his route. Show the pickup, wind-up, flight and impact.
No arbitrary failed flame or fleeing helper may remove the only escape route to force a fight.

Every dangerous scene has a verified hard refuge: a real accessible room or a passage too narrow
for the giant, plus a reachable exit. A single breakable lamp is not the only refuge. Staying safe is
allowed; it may delay the objective. He remains nonaggressive while shielding, even if Jef pursues him.

Portable light needs a combat design change. Proposed rule: Jef must raise and hold a lantern for
protection; he must lower or set it down to use the loaned two-handed weapon. Show the change before
he can be hit. Set-down light remains physical light. This equipment interaction is new work.
A rain-soaked or extinguished lantern needs visible/audio feedback before Jef leaves shelter; do not
spring the existing wet-weather loss of protection on him in a fight. Provide stationary shelter.

Combat should reward provoking a committed kick or charge, avoiding it and striking an exposed limb
in recovery. Guarded blows visibly glance off; fists cannot kill a giant in a few seconds. No unexplained
immunity solely because he entered a named state. He moves away from safe pools rather than standing
within weapon reach for repeated free hits. Test lamp-edge attacks and following him while shielding.
Exact reach, damage and vulnerability windows require the combat prototype, not story-only numbers.

Mist and darkness must affect detection consistently with what Jef can perceive. Sounds may warn
before sight, but a geometry-only ray must not give the giant perfect vision through dense fog.

## Chapter script

Names Lowie and Rosa are draft roles to bind to suitable residents with real homes and schedules.
Pieter is the missing lamplighter. Use the existing Fientje, Tuur and Verhulst where their roles fit.

### 1 The Missing Lamplighter

**Objective:** finish two nearby lamps on Pieter's route, inspect his last stop and report to Lowie.
**Budget:** about one game hour; ordinary lamp-work pay and a loaned pole.

> Lowie: "Pieter never brought the ladder back. His last two lamps are still dark."
> Jef: "Where did he finish?"
> Lowie: "The quay steps. Take my pole. I don't want anyone else walking that stretch blind."

At a validated night opportunity, a scrape draws attention to a junction 30-40 metres ahead.
Antigoon crosses the dark opening below the roofline and disappears behind the opposite building.
Footsteps continue towards a large river outlet. The camera stays under player control; there is no
attack on this introduction. Find the bent ladder and route book at the final lamp.

**Completion:** the book and inspected site establish the lead even if Jef misses the figure.
Record sight, sound and evidence separately; reporting offers only truthful variants. Searching by
daylight is valid and does not force a replay at night. An asleep Lowie can receive the work proof
through his box; the next lead is also written in the route book.

### 2 Beyond the Lamplight

**Objective:** speak to Rosa and recover her basket from the edge of the quay; learn a safe route.
**Budget:** about one game hour, adjoining Q1 if convenient; one carried item.

> Rosa: "I reached the lamp. It covered its face and went past me."
> Jef: "Then the lamps keep it away?"
> Rosa: "They stopped it touching me. That isn't the same thing."

Rosa identifies Pieter's final stop and a store receiving unusual dredged cargo. The basket contains
her belongings, not a magically necessary key. Beside it, a broken globe and a cobble suggest that
lamps can be attacked. If there is a suitable night opportunity, Jef can watch from hard shelter as
Antigoon shields through one pool of light and later throws a stone at a distant exposed lamp.
Keep this observation brief; do not require standing still until midnight or repeating a missed show.

**Completion:** testimony and inspected lamp damage suffice; observed events add accurate journal
detail. If Rosa is unavailable, her deposited statement and the physical clues supply the same lead.
The journal distinguishes what Jef saw from what Rosa said. Lowie's instruction explains the rock
warning and names the next refuge before a lethal encounter can begin.

### 3 The Man at the Window

**Objective:** take one lamp supply to Rosa's house, then reach the night-watch post for help.
**Budget:** about one to two game hours; first dangerous outing.

The errand reconnects Jef with someone he helped. Inside, Rosa points to the merchant's store across
the street. A moving shadow blocks an upper window. Antigoon pauses outside at that height, looking
past the house towards the store. He then picks up a stone; an exposed streetlamp breaks.

> Rosa: "He keeps looking across the street. That's where the crate went."
> Jef: "Stay inside. I'll fetch the watch."

The room remains safe. Jef chooses a longer route through lit streets or a shorter narrow passage
with one exposed crossing. Both must exist and be inspected before the scene is authored. A stare,
heavy step and committed turn precede pursuit; no guaranteed hit appears behind the player.
At the post, a short authored response secures help and lets the scene resolve without escort AI.

**Completion:** report at the post; return later for Rosa's statement and the consignment reference.
Retreating indoors preserves the lead and allows another attempt. Waiting until daylight is valid;
Rosa remembers that help came late, but the story continues. Her alternate written statement prevents
a missing resident from blocking the investigation. Suppress unrelated gang ambushes in this scene.

### 4 Under the Streets

**Objective:** inspect one short route below the quay, identify Pieter's belongings and map the refuge.
**Budget:** one to two game hours, preferably by daylight; supplied light and a clear return path.

> Tuur: "We stopped landing goods there. Something moves behind the old sluice."
> Jef: "Can I get out the way I go in?"
> Tuur: "The side stair. Learn it before you go any further."

Use one human maintenance stair, one short tunnel and one large chamber, reused in the finale.
The giant uses a separate opening sized for his body. Small street drains carry sound and water;
they cannot swallow a five-metre creature. No crawling animation is assumed to exist.

Pieter's badge and damaged gear establish his fate through authored evidence. Torn wrapping bears
the store's consignment mark. The delivery record and sightings along the store-refuge route support
the hypothesis that the hand-shaped relic draws him. Pastoor Cools can relate the legend without
claiming every superstition is a proven game rule. The journal records the refuge and exits.

**Completion:** identifying the belongings and route is enough; a sleeping-giant reveal is optional
pending animation support. Being underground in daylight is not automatically safe. Retreat remains
possible, collected information persists, and staying past dusk changes danger without sealing exits.
Report Pieter's death once; Lowie's unfinished round becomes the concrete reason to organise help.

The underground encounter needs its own presence rules: the current surface dawn retreat/hiding logic
cannot make him disappear from the chamber during a daytime visit. Ambient daylight above the city
must not illuminate the enclosed refuge or replace actual lamp checks below ground.

### 5 A Trap for a Giant

**Objective:** prepare a refuge and baited approach on the known route, then wound Antigoon in combat.
**Budget:** about two game hours split between daytime setup and an early-night fight.

> Lowie: "I'll keep this side lit. Don't chase him beyond the steps."
> Tuur: "He stops for the fish. That gives you time to choose where you stand."

Lowie provides light and loans an appropriate tool or weapon; Tuur supplies fish scraps and route
knowledge. Implement their help as agreed setup tasks, not a new general companion system. Verhulst
is an optional alternate contact, not a mandatory faction-reputation gate. Essential aid has a fallback.

Prepare only two things at one site: dependable refuge and the bait position. Choose between two
validated approaches, such as a longer lit retreat or a short narrow escape. Bait reuses his hunger
behaviour but needs a quest-controlled placement and completion check. A hoist trap is optional later.

Let Jef observe one attack and practise withdrawal before committing. Lure him into the approach,
evade a clearly telegraphed kick and strike the exposed leg. The injury must visibly affect his next
steps. A lamp may be targeted under the taught rules; no scripted random lamp failure forces exposure.

**Completion:** land the authored wound, then watch him retreat through the actual outlet. Save the
injury and preparation. Leaving early retains completed setup; lost bait has an inexpensive replacement.
A failed attempt does not secretly award the wound. If Jef defeats him outright, record that outcome
and turn Q6 into securing the refuge and resolving the relic; never resurrect him for a mandatory finale.

### 6 The Old Toll

**Objective:** return through the mapped route, confront the wounded giant and end his hunting.
**Budget:** two to three game hours, with resupply and a recoverable save before entry.

> Lowie: "You know where he turns. You know where the light ends. Come back by the stair."

Jef enters the same chamber with the wound and route knowledge earned earlier. Two distinct refuges
and a clear exit let him read the space. He must leave safety to create an opening and attack; carrying
a lantern is no automatic victory. Use a few distinct attack-and-recovery exchanges rather than a
large health pool. Existing wounds visibly constrain Antigoon's movement. No new weakness appears here.

**Draft ending:** Jef kills Antigoon through the fight. He returns with proof, and the merchant agrees
to surrender the relic for disposal in the river. This is a short aftermath, not an extra theft quest
or an unexplained ritual needed to make damage count. The relic's connection remains ominous; do not
undercut the player's victory with an automatic resurrection. If the owner refuses in a later branch,
that dispute must not undo the completed hunt. A mercy/bargain branch is deferred.

**Completion:** record defeat once and stop his hunting for this world's week. Lowie resumes the
round; Pieter stays dead; a familiar resident acknowledges what Jef did. Jef still needs food and rent.
Leaving the chamber preserves discovered clues and the Q5 wound. A pending final fight remains pending,
not failed merely because Jef chose to rest. An early Q5 victory skips this second fight honestly.

## Persistence and failure rules

- Persist accepted chapter, current objective, inspected clues, witnessed sights/sounds, completed
  preparation, rewards, named casualties and the giant's lasting wounds/defeat. Pay each reward once.
- Store critical evidence as journal facts. Losing a physical basket, book or prop must not erase
  knowledge or force a repeated scare. Every essential lead has testimony and a physical/record source.
- Before a dangerous outing, offer a full-world recovery save including time, needs, money, quest and
  giant state. Keep it until the outing resolves. Restoring it rolls all of those back together;
  it must not duplicate rewards, deaths or consumables. This recovery integration is new work.
- Ordinary saves must resume coherently. Pause both clock and encounter while loading; restore actual
  positions safely. Do not hide a visible giant or reset only the monster while keeping gained rewards.
- Health zero remains the existing run-ending rule. The recovery save provides a voluntary retry;
  there is no automatic invulnerability, rescue teleport or forced dawn time skip in this draft.
- If a critical speaker sleeps or dies, retain an explicit alternate clue or contact. Story casualties
  must not remove the only employer for an accepted job. Routine attacks exclude family and children
  in this draft; use a bounded adult cast and record actual lasting consequences once.
- Missing a sighting does not block progress. Missing an entire night postpones an opportunity while
  the week permits it. An ignored campaign does not secretly spawn story Antigoon or invent victories.

## Dialogue and town reaction

Essential dialogue, clues, acknowledgements and ending variants are authored and work with AI disabled.
AI may phrase reactions only from supplied known facts; it may not invent weaknesses, new victims or
future scenes. Current violence filters can reject horror-related lines, so approved story reactions
need their own authored path rather than relying on unrestricted generated rumours.

Unlock instructions through the investigation. Keep the existing blunt DEV hints in DEV testing;
story mode introduces the light rule in Q2, before its first lethal encounter. Give every conversation
a next action and record it in the quest book. Limit initial reaction writing to a few meaningful
variants: missing, feared, wounded, defeated and unfinished; expand only where the town needs it.

## Multiplayer

Keep the campaign state and staged scenes out of multiplayer. A separate shared roaming mode can use
the same movement, light and combat rules, permanent casualty handling and real entrances. Every player
must see the same positions, targets, injuries and defeat. Spawn/despawn checks consider all observers;
entering a multiplayer session must not start a private story reveal or silently consume solo progress.

## What exists and what must be built

Source findings and links are in [the review](antigoon-story-review.md). Existing native services cover
lamp rounds, ordinary jobs, dialogue, rooms, needs, save files and shared giant movement/attack checks.
Those components do not by themselves implement this campaign.

| Dependency | Needed before campaign acceptance |
|---|---|
| Story and journal | Independent chapter state, authored conversations, evidence and objective UI, alternate leads and once-only rewards |
| Light and fighting | Lantern hand-use, suitable weapon interaction, readable openings, fair fog detection, weather feedback and lamp-edge exploit checks |
| Ruien | One connected tunnel/chamber, human stair and giant-sized outlet; paths, collision, drainage, visibility and exits checked in the native scene |
| Wounds and casualties | Lasting injury/defeat restore, named death and downstream job/shop/memory consequences; knockdown is not death |
| Recovery | Coherent save/load and pre-outing recovery saves, including ordinary economy and time |
| Scene direction | Readable triggers, player-control preservation, sleeping NPC fallbacks, stage-specific panic/lamps and no visible popping |

Keep the stationary-roaming and weak-kick reports as unaccepted playtest feedback, even though newer
movement and attack code exists. Before normal activation, verify the actual walk/chase/kick in game,
then play the short Q1-Q3 sequence with no AI and a poor, tired Jef. Test missed sights, closed shops,
rain, retreat, reload and late starts. Only then build the full ambush and underground finale. Automated
checks and reviewer opinions do not establish that the giant feels alive or frightening.

## Implementation state

Chapter 1 is in the normal game (Steve, 2026-10-16: "the story can be put in normal game, the spawning via
event is pure for dev mode"). The developer Events spawn and its red locator stay DEV-only. Chapters 2 to 6
are not built.

- `NativeStory` (`native-godot/src/Services/NativeStory*.cs`) keeps the one story entry in `player_state`
  key `story:antigoon`, beside the three job slots. Lowie is the west round's lamplighter, Pieter's lamps
  are that round's last two, and Pieter's bent ladder and route book lie at the last one. The lamplighter
  is talked to with authored lines only; the report choices follow what Jef found, saw and heard.
- `NativeAntigoon.Story.cs` plays the one staged crossing at an authored junction (`NativeStory.Junction`),
  from cover to cover, with a scrape before and footsteps after. It never targets anyone and shows no
  locator. `scripts/antigoon-story-map.ps1` draws his walking map with candidate junctions.
- The client part is `godot/src/Play/Story.cs`; the quest book (J) shows the entry, S follows it.
- The sighting junction is candidate 1 of the 2026-10-16 map run: the mouth of the narrow lane behind the Werf
  quay houses (x -308, z 48), 39 m from Pieter's last lamp. Jef sees it from the lane, which is too narrow for
  the giant; the lamplit street beyond gives him a silhouette. A crossing stages when Jef is 26 to 44 m away with a
  clear view, after 18:00 and not in fog: a scrape first, then he crosses once Jef looks that way (or after 7 s).
- `scripts/check-story.ps1` plays chapter 1 in a disposable save with AI off (32 checks, pictures in `.scratch`).
  Automated checks do not show that the sighting is frightening; that needs Steve's own play.
