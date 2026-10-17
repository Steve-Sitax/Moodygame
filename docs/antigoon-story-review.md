# Antigoon story review

Review date: 2026-10-16. Claude Opus 5.5 at high effort and GPT-6 Astra independently reviewed the
original outline against the native Godot source. Both were read-only reviews, not gameplay tests.
The resulting design is in [Antigoon story and quests](antigoon-story.md).

## Claude Opus opinion

The setting and escalation work, but the giant needs a motive the player can investigate. Claude
favoured the recovered hand: his route towards its keeper makes the mystery playable. It recommended
reusing the lamp round as the opening, market hunger as bait, his height for the window encounter,
and one underground chamber for reconnaissance and the finale. Short authored reactions would make
the town's response reliable despite the existing AI violence filters.

Claude's strongest concerns were the lantern/strike exploit, lethal damage without a retry plan,
the seven-day limit, absent underground gameplay and missing permanent casualty/wound persistence.
It proposed a lantern that must be held up, a pole weapon, an automatic story knockout, four encounter
nights, and two endings after fighting: return the hand or finish the giant.

## GPT 6 Astra opinion

Astra favoured a worker's week gradually contaminated by horror. The lamplighter's practical knowledge
should become useful to Jef. It found the early investigations too similar and the final victory
condition undefined. It recommended distinct actions in each chapter, three principal dangerous
outings, daylight investigation, supplied essentials and no occupation of the three wage-job slots.

Astra stressed that light must retain its promised protection, missed sights must not block progress,
and the story needs alternate clues, coherent saves and a late-start outcome. It favoured one clear
physical victory over multiple ritual/bargain branches, with a small everyday aftermath. Neither
the Ruien nor a permanently wounded giant could be treated as existing campaign support.

## Decisions in the refined draft

| Finding or proposal | Decision and reason |
|---|---|
| Give the giant a motive | Adopt a relic in a merchant's store as a draft motive; routes provide evidence. Jef's unloading involvement stays optional, never invented retrospectively. |
| Six similar investigations | Give each a distinct task: finish lamps, learn safety/help a witness, fetch help during danger, map the refuge, prepare and wound, finish the hunt. |
| Fixed night per chapter | Use flexible opportunities and three dangerous outings. Keep daylight work, quiet nights and spare Sunday time. |
| Lantern plus free strikes | Require a combat prototype with active lantern handling, meaningful armed openings and movement away from safe pools. No arbitrary permission to attack Jef in strong light. |
| Reduced shielding damage | Use readable guarding/contact and exposed-limb opportunities; do not grant unexplained invulnerability because of an animation state. Numbers remain untuned. |
| Random lamp failure during ambush | Reject. Use the already visible stone attack, teach it earlier and retain hard shelter. |
| Automatic knockout and wake at dawn | Do not adopt in this draft: it changes the existing death rule and moves Jef/time. Specify a full-world recovery save and voluntary retry instead. |
| One-handed model | Defer. It conflicts with the requested two-handed shielding and would require model/animation changes. The relic need not be his current anatomical hand. |
| Forced day-one unloading and theft finale | Avoid mandatory guilt or crime. Records establish the origin if Jef never unloaded it; surrender of the relic follows victory rather than gating it. |
| Two endings and hand ritual | Use one draft ending with an actual fight and defeat. Dispose of the relic in the aftermath; defer mercy and bargain branches. |
| Guaranteed retreat after Q5 | Permit an early legitimate kill and adapt Q6. Never resurrect a defeated giant or hide that his health is locked for the script. |
| Mandatory companions and machinery | Start with supplied equipment, bait and authored helper setup. Defer escort AI, boats blocking exits and hoist machinery. |
| Unknown underground scope | Build one reusable chamber/tunnel and a correctly sized outlet; small drain inlets are not giant entrances. |

## Source evidence and limits

| Current source | What the review established |
|---|---|
| [NativeCoreClock](../native-godot/src/Services/NativeCoreClock.cs) | `TurnDay` ends the week at Sunday midnight. `Tick` adds five game minutes no sooner than nine real seconds; do not treat the older two-minutes-per-hour estimate as an exact implementation fact. Health zero ends a run; sleep and warmth still constrain outings. |
| [NativeCoreJobs](../native-godot/src/Services/NativeCoreJobs.cs) and [quest UI](../godot/src/Play/Jobs.cs) | Three taken wage jobs maximum; supported job types do not supply an authored investigation campaign. Reusing UI and lamp work still needs story-state integration. |
| [World Antigoon integration](../native-godot/src/World/NativeTownGame.Antigoon.cs) | `Light` gives a usable portable lantern up to .85 contribution; `Sight` uses geometry. Current above-ground giant routing includes roughly 5.5 m crown clearance. |
| [AntigoonBrain](../native-godot/src/Services/AntigoonBrain.cs) | Safe-light threshold .45; strikes do 15 damage against 120 health with a .8 s cooldown. Jef can damage him while he shields. Kicks do 3 health damage; throws can do 5 against a wall. Current constants are not accepted campaign balance. |
| [NativeCoreClock](../native-godot/src/Services/NativeCoreClock.cs) | `Where` disables carried-lantern benefit in rain/storm or for 120 game minutes after swimming. Story presentation needs to make loss of protection legible. |
| [AntigoonNightEvent](../native-godot/src/Services/AntigoonNightEvent.cs) and [NativeStreetLighting](../native-godot/src/Services/NativeStreetLighting.cs) | Rocks can extinguish lamps until the next night. NPC victims currently fall, recover and flee; this is not permanent death. Relighting a broken story lamp is not automatically supplied by ordinary lamp-job support. |
| [NativeAntigoon](../native-godot/src/Services/NativeAntigoon.cs) | DEV gating remains. `Save` writes position/home/health, while `Reset` on load discards the encounter. Chapter, casualty and injury continuity need explicit implementation. |
| [AntigoonBrain](../native-godot/src/Services/AntigoonBrain.cs) and [world integration](../native-godot/src/World/NativeTownGame.Antigoon.cs) | Dawn hiding at the home point is not verified underground retreat. DEV spawn visibility checks target the initiating player, not all multiplayer observers. |
| [Ruien inlet records](../native-godot/world/town/drainage/ruien-inlets.json) | Modelled drainage inlets reserve underground connections. They do not establish a traversable Ruien location. |
| [NativeCoreRumours](../native-godot/src/Services/NativeCoreRumours.cs), [NativeCoreNight](../native-godot/src/Services/NativeCoreNight.cs), [NativeFamilies](../native-godot/src/Services/NativeFamilies.Async.cs) | Generated-text prompts and filters reject various violent terms. Approved authored horror reactions need a deliberate delivery path. |
| [NativeAntigoonClient](../native-godot/src/Characters/NativeAntigoonClient.cs) | DEV hints already reveal light protection and the client exposes a simple strike action. That is not a complete equipped-weapon combat system. |

The revised origin, supplied weapon, lantern handling, recovery saves and authored aftermath are design
choices, not changes to these systems. No build, gameplay test or environment acceptance was performed
for this documentation revision. The main unresolved balance work is whether lighting, weapon reach
and giant movement can produce fair fights without violating the protection rule. Prototype that before
committing to the complete campaign's content.
