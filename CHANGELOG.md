# Changelog

What changed in each version of Scheldemist, for players first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).
Each release on the [Releases page](https://github.com/Steve-Sitax/Moodygame/releases) carries its part of this file.
Bugs and loose ends are tracked as [issues](https://github.com/Steve-Sitax/Moodygame/issues).

## [Unreleased]

- Walking down the stone steps of the Petit Bassin into the dock water no longer makes the view jerk when you start to swim. The eye used to drop by up to 17 cm in one frame, and he could be shifted sideways at the same moment; now the view settles to swimming height in a moment (issue 88).
- The complete town now runs in Godot: eleven editable districts, the title menu, residents, interiors, jobs, weather and harbour traffic. The finished model and texture work described below has been imported into native resources. Playing and editing no longer need the web game or a bake.
- Place, move, rotate, copy and remove lamps and other library objects in the workshop, then test the saved layout in the full game. Existing object identities and saved district layouts are preserved. Exposed model edges now follow a material-specific bevel and wear rule.
- Multiplayer uses a native Godot host or a separate headless server, with authenticated players and LAN/VPN connections. Windows exports include their required runtime.
- Old game saves have been removed for the native migration, as requested. Start a new game; editor layouts, preferences and provider credentials are retained.
- The legless horse body that hung in the air at the Rijnkaai quay edge, at the middle of the map, is gone. It was a leftover model part of the horses; the working horses are unchanged.
- The stone steps down to the water at the Werf can be walked again. A strip of paving hung over the water there and covered the steps, so Jef walked along it above the treads and was pushed about when he stepped onto them. The paving is now cut away over the flight, and the treads show.
- Handcarts, drays and their loads, and the draught and hearse horses, no longer show a patchwork of mixed textures. Planks, iron, sacking and the bay coat with black mane, tail and harness now sit where they belong (issue 81).
- The racing pigeons of the lofts are alive: they sit by their board and on the hut roof with their wings folded, and in the morning (about 7:40 to 9:20) and the afternoon (about 14:50 to 16:30) of a dry day each loft's flock goes up, circles the roofs for half a game hour, then lands again. Before, they hung in the air with their wings spread flat (issue #66).
- Gas lamps, bollards and other placed quay objects now fade into mist, fog and rain like the rest of the town, instead of standing out as sharp black shapes far away. Lamp glass and flames fade with the air and still glow at night (issue #79).
- The sails of the windmills on the town wall are dark at night, like the brick round them, instead of staying pale as at noon. They follow the sky like the cathedral and the quay walls (issue #73).
- Things the game puts out while you play, such as barrels, crates, sacks, market stalls, carts, boats and the ferry, now have the same fine relief as the rest of the town: staves, planks, rope, sacking and iron bands catch the light at close range instead of looking like flat pictures (issue #78). Glass, paper, animals and people stay smooth.
- The cathedral's great west window and its side windows no longer glow amber by day in mist, rain and fog. They now stay dark stained glass that fades into the air, and still light up after dark (issue #70).
- The floor of the cathedral's nave, and of the other churches, shows its stone paving again instead of a flat black plane. The sun's coloured patches from the windows now light the floor by day in clear weather (issue #74).
- The beams of sunlight through the church windows now follow the sun, the weather and the hour. Before, those of the cathedral, Carolus and St Jacob were invisible and St Paul's never changed. Now all four show by day in clear weather, vanish in rain, fog and storm, and turn to a faint cold moon shaft on clear nights (issue #92).
- The cathedral's stained-glass windows are whole again: the top of each window no longer shows jagged notches of sky cut out of the picture (issue #93). The great west window no longer looks like an open gap showing sky in mist, rain and fog; it shows its stained glass, dark from the street, and lights up after dark as before (issue #90). The black patch on the ground right of the west portal and the garbled coloured object at the foot of the front were the sun-patch bug fixed under #74 and no longer appear.

- The loaded lighter at the Rijnkaai berth now lies 3.5 m further east, so its hull stays at least 4.5 m from the dinghy moored there (it came within 1.0 m) and at least 2 m clear all the way in. The boat check fails a berth closer than 2 m on the walk in or 3 m alongside (issue #35).
- Water from a broken gutter now lands on the pavement where the street has a raised pavement, and its wet patch shows there; before, the splash and the patch lay 12 cm under the paving stones (15 of the 50 broken gutters, issue 67).
- The iron quay ladders are new: flat-bar stiles, round rungs, wall brackets and grab hoops that rise over the coping and come down on the quay, with light rust where the tide reaches. They stand clear of the stone instead of running through the coping. Press E at the hoops to climb down into the water (or onto the mud at a low spring tide) and E at the foot to climb up again; the climb out of the water follows the new rungs at every tide (issue #85). The Rijnkaai test district now has the same ladders and climb instead of the old box ladders (issue #94), and the ladder at the pier head is strapped across to the piles beside it instead of hanging from one bracket (issue #95).

- Boats rest on the drawn mud at low water, rise with every tide and stay above water in the great storm. Ladder boarding and crane loads follow grounded hulls, and the pier has fenders for the full tide range. In Godot, boats stay with the water during clock jumps and the storm brings the same surge as in the browser.
- Boats carry their own readable names and home ports, upright on their bows, sterns and paddle boxes; the paper, map and harbour calls use the same names. Germania is a German grain barque and Stad Antwerpen a Belgian line steamer.

- The nine kinds of small boat are built again plank by plank, and no two kinds look alike. Clinker boats show their lapped strakes inside and out; the ship's boat and the police gig are smooth carvel. Inside each are steamed frames, risers, thwarts with knees, stern sheets, a breasthook, loose bottom boards (the after ones wet) and thole pins or iron crutches, with the oars laid in. The waterman's rowboat is oiled with a blue and a red strake. The dinghy is green and cream, with her mast and tanned sail laid in. The ship's boat is white with a black sheer strake, a backboard and a rudder on a yoke. The police gig is black and varnished, with a lantern and the Belgian flag. The bumboat is yellow and green, with her goods under the canvas hood, a gin keg, bread, cabbages and a steelyard. The old boat is grey and rotten, patched with tin and a new plank, her rubbing strake sprung and bilge water in her bottom. The punt has pale blue rails and a washerwoman's box and board. The work boat and the eel boat are tarred, one with a green top strake and one with an oxblood top strake; the eel boat also carries her shut well, fykes, a net and an eel spear. The rowing seats and rowlocks are where they were, and the river never shows inside them. Each boat has small boards for her name on both bows and the stern.
- The ocean ships are built again in high detail and no longer look alike. The brig Anna Maria has a white band of painted ports with a gilt line, green bulwarks with a varnished rail, deadeyes and channels under her shrouds, a woman's figure at the head, a capstan, pumps, a galley, a quarter boat in davits and a carved stern board, and keeps her gangway and her hold. The barques at anchor are Norwegian timber ships with a deck load of deals, a windmill pump and loading ports in their bows; the barque under sail is a German grain ship with painted ports and copper. The schooner is a dark green Baltic topsail schooner with a boat over her stern. The collier is all black with a short funnel and a white band, a raised forecastle, bridge deck and poop, steam winches and derricks at her hatches. The liner Kempenland has four masts, eight boats in davits, an open bridge, cowls and skylights, a gilt scroll at her clipper bow and her name round the counter. Each ship flies her own colours (Belgian, Norwegian, German, British red ensign, Danish), and every hull has boards ready for her own name.
- The harbour's own craft are built again in detail, each as she really was: the Rhine barges as German iron barges with timber rubbing wales, a long hold under arched hatch boards, the skipper's cabin aft with curtained windows and shutters, flower pots, a hen coop, the dog's kennel, a wash tub and the washing out, and the great tiller reaching over the cabin roof; the hengsten as Zeeland fishing boats with round bows, a bowsprit, the wet well amidships, the beam trawl and its iron heads along the rail, nets and baskets; the Scheldt hoogaars with her raked stem, fore cuddy and open well; leeboards, rudders with iron straps, windlasses, anchors and chain, bitts, blocks, pin rails and mast hoops on all of them. The five kinds of lighter now each carry their owner's colours (white, green, black, blue-grey and red), their own wear and their own load, and every rudder lies lashed a little over, as on a moored boat. The hulls carry boards ready for their names.
- The lock of the Petit Bassin is built again in detail: oak mitre gates with a round heel post turning in a bluestone hollow quoin, rails and stiles on the river face, planking on the dock face, an iron tie, two paddles in each leaf lifted by racks and winches on the walkway, a planked walkway with an iron hand rail, and heavy balance beams bound with iron. Cast-iron capstans with their chains and the sluice gear with hand wheels stand on the quay, out of the beams' swing. The lock-keeper has a boarded hut by the chamber with a real room inside (his desk, ledger, stove and shelf), a bell by the door and a lifebuoy on the wall. Tide gauges with red figures, oak rubbing posts and grab chains hang on the walls, fender dolphins stand at the lock's mouths and off the Steen's quay, mooring buoys lie in the Petit Bassin and off the Werf, riding the tide.
- The harbour tugs and the ferry are built again in high detail, and the two tugs no longer look alike. The screw tug has a black riveted hull with a white line, a heavy fender belt and rope fenders, a cream engine casing with portholes, a varnished wheelhouse open behind with the wheel and the binnacle inside, red and green side lights on their screens, two white towing lights on the mast, a tall raked funnel in her owner's colours (black, a red band between white rings) with its whistle, the towing hook on its post and two high towing bows over the after deck. The paddle tug has a buff funnel with a black top, a gold line, green bulwarks, paddle boxes with a fan of vent slots and gilt mouldings over wheels you can see turning in the water, sponsons, an open bridge across the boxes and varnished deckhouses. The ferry St. Anna gets a striped awning over her fore deck, curtained saloon windows, benches with cast-iron ends and a sharper fan on her paddle boxes; her stern board now faces out over the stern instead of inward. The landing stage gets its mooring chains, seamed floats and the rails the quay's gangway rolls on. Each hull now has places for her own name on the bows, the stern and the paddle boxes, which show the names once the names update lands.
- Fog and sky match: on a fog day the sky is the fog itself, a shade brighter overhead, so far houses and ships fade into it or stand as dark shapes, no longer as pale ghosts under a darker sky, and the dark ragged shapes over the Grote Markt are gone; the clouds have soft edges. A misty morning is misty now: the mist lies thick until about ten and lifts toward noon. Gas lamps throw their light down: warm, uneven pools on the paving under each lamp and less of a bright blob on the wall beside it. Rain shows as streaks near you, and wet stone goes darker with a sheen toward the sky and under the lamps.
- The docks are busier and better made. Cast-iron bollards (old cannons sunk muzzle-up, green-painted bollards, double bitts), mooring rings and coils of tarred hawser stand every few metres along the working quays, with chains and flaked lines lying out; oak rubbing fenders run down the wall faces of the Werf, the Rijnkaai and the Petit Bassin, slimy below the tide line. Every barge, lighter, tug and hengst moored along a wall is tied to its bollards with real mooring lines that hang slack at high water and pull taut at low water. Four busy work spots have lanes left open between their stacks: coffee and sugar at the Anna Maria's berth, petroleum casks on the Werf, timber, wool and a public weighbridge by the Entrepot, and hides and crates by the Hanseatic House. Each has a tally clerk's desk, a scale, sack trucks and hand barrows. The rust-red strip along the coping is gone.
- The iron railing round the Steenplein no longer runs on over the water at the mouth of the Sint-Pietersvliet, beside its opening bridge: it stops at the corner of the quay.
- The ground looks finer and more real: the gate roads, yards and gravel walks are trodden earth with gravel, hoof and boot prints instead of big blurry blotches; the grass is made of blades instead of light and dark patches; fallen leaves round the trees, outside the wall and in the drifts are real plane and lime leaves of 7 to 18 cm instead of orange squares; puddles are dark water that mirrors softly instead of pale sheets with black specks; the hard black band of shadow along the foot of the cathedral and other tall walls is gone.
- The children's chalk on the squares is drawn by hand in faint grey chalk (hopscotch squares with their numbers, a marbles ring, a little scrawl) and takes the light, instead of a clean white ring that shone at dusk like a marker.
- The Grote Markt's guild houses are no longer one block with swapped gables: fourteen fronts made by hand after Antwerp's own, each with its own width, storey heights, windows and cornices, and a little forward lean. Stepped, scrolled, bell and neck gables; late Gothic tracery, Renaissance and Baroque pilaster orders; brick with stone bands, sandstone, bluestone and painted plaster; leaded cross windows and 18th-century sashes; carved panels, niches, obelisks, and gilt figures on the tops (an angel over Den Engel, St George, a saint, an eagle). Their windows light up at night as before. The square has its liberty tree again, an old lime inside a low iron railing on a bluestone kerb.
- Washing lines are tied to houses on both sides and hang below the eaves of both, so no more sheets flap over a cottage roof or in the tree tops of the Sint-Jansplein. In Godot a moored steamer that is not drawn no longer leaves its smoke hanging over the river, her lanterns go with her, and a moored steamer's funnel smokes thinly, as in the browser.
- The town hall's upper windows no longer show bright cream slivers beside their frames: the sun no longer reaches through the front onto the window reveals.
- Fanlights over the house doors have thin dark glazing bars in a sunburst, real 3D bars up close, instead of thick white bars that read as a spider and glowed at night.
- The cathedral's windows are glazed all round: dark from the street with a hint of their colours, stained glass from inside; the sun's beams show only from inside the cathedral and the other churches, no longer as white sheets in the windows and the open doors.
- The Steen looks its age: sooted, streaked stone with green damp at its foot.
- The blind side and back walls of plastered houses are bare brick, the portal steps of the old halls are worn bluestone, and the arms of Antwerp over the Hanseatic House gate are a proper coat of arms. In the Godot version, the flat beige slabs at the Vleeshuis, the Hanseatic House and the town hall doors are gone ([#65](https://github.com/Steve-Sitax/Moodygame/issues/65)).
- The town wall's brick shows soft, uneven stains of weather and smoke, so the long faces no longer look like one even picture.
- Every boat, the lock gates' boat parts, the opening bridges and the ferry have new, detailed surfaces with real relief: tarred planking with caulked seams, oak trenails and tar drips; weed and barnacles on the bottoms; riveted iron plates in and out with rust runs; copper sheathing gone green at the nails and edges; red lead; deck planks with black pitch seams and bungs; lapped clinker strakes with copper nails; chipped paint; canvas with folds and gaskets; tarred tarpaulins with their lashings; laid rope; wet bilge boards. The pictures are four times sharper and smooth at any distance, without seams where they repeat.
- The canal and the vliet at low water look like real Scheldt mud instead of an empty concrete pool that shone like snow at night: dark wet silt with ripple marks, a trickle winding down a channel from the sewer at the head, pools that keep their water, the bank rising to the walls, a broken basket, cart wheels, chains, bottles, an old grapnel and staves left by the tide, and arched sewer outfalls in the walls with a grating and a black stain on the mud below. The shallow water there now lies still instead of heaving up through the mud.
- The quay walls along the river, the canal, the vliet, the lock and the Petit Bassin are built again in coursed bluestone with lime joints, the courses running on round every corner, and they carry the tide's marks where the water leaves them: white salt bloom above the high-water line, a dark tide mark, a brown film with barnacles, green weed from half tide down, black mussels and brown wrack at the foot, rust runs under the mooring rings, and the stone the ebb has just left stays dark and wet for some hours. The copings are bluestone blocks with a rounded nose and iron cramps leaded in across the joints. The stone stairs down the walls are cut from the same stone, their low steps green and slimy like the wall beside them. At night the walls and the stairs no longer glow as if lit from inside: they are dark except where a lamp falls.
- The loaded lighters and the bumboats no longer have river water standing in them, and the bumboats have their oars laid in again.
- In the Godot version, the river no longer shows inside open boats (lighters, punts, rowboats, the eel boat, the barges' holds) at high water, in a swell or in the great storm, and the rowing boat you hire stays dry inside too.
- The quay walls no longer glow at night. Their light off the water was a fixed glow, as bright at three in the morning as at noon; it now follows the sky, so at night the walls and the stone steps down them are as dark as the houses beside them and only the lamps light them. In the Godot version everything with a glow of its own (the quay walls, the cathedral's stone, the paintings, gilt) was also about three times too bright, by day too; it now matches the browser.
- The bluestone flags of the squares, pavements and door steps and the kerbs along the streets are real bluestone now, at the same detail as the quay wall: worn blue-grey stone with its small pale fossils, white veins and old chisel marks, soot and rust stains, chipped edges and a few cracks, narrow sandy joints, and each stone a little different; the kerbs are point-dressed and weathered paler. The wooden shutters and doors, the bridges' and piers' boards and the furniture show real weathered oak and pine boards, and coiled rope is real tarred hemp.
- In the Godot version, dev mode's flying (F9) turns with the mouse again and flies with your own keys from Settings, Controls (walk keys, Jump up, Crouch down, Hurry fast), at your mouse speed and invert; the mouse wheel makes it faster or slower. While flying the game sends no walking moves, so the server no longer refuses them.
- In the Godot version, the Mouse speed and Invert settings now also turn Jef's own view (they did nothing before).
- In the Godot version, no bare "HTTP 409" message shows any more: a refusal from the server is said in words, and the emigrants' boarding is checked quietly in the background.
- The street gas lamps (and the doss house's lantern) are hollow now: clear, slightly sooty glass with one real flame on its brass burner inside, the same from every side, and the glass glows warm when lit. The other lanterns show frosted glass with a soft glow instead of a flame painted on each pane.
- In the Godot version, the omnibus boards (the route along each side, the destination over the driver and the advertisements over the windows) no longer hang in the air over the Rijnkaai, some of them mirrored: every omnibus carries its own boards again, the right way round.
- In the Godot version, people no longer walk on air over the water when a bridge is up: they wait at its end and cross when it is down again, and a bridge does not lift while someone is on it (the canal and vliet bridges and the lock's bridge).
- The Godot version has a console: the key left of 1 (² on a Belgian keyboard) opens it, in the game and on the menu; `help` lists its commands. `dev on` there (or Ctrl+Alt+Shift+D) switches on dev mode, the browser's dev tools: the menu's Dev line or F8 opens a Dev sheet with the time, the weather, the tide, the NPC stress test, every event (ships through the lock, boats up the canal and the vliet, thick fog, a shower, each director event, started in front of you) and places to go to, and F9 flies over the town and lands you where you are.
- In the Godot version, F (Second choice) no longer throws you into a free camera when there is nothing to choose.
- Real herring gulls over the river and the quays. They are detailed birds now, not flat paper shapes: a white head with autumn streaks, the yellow bill with its red spot, grey back and wings with black tips and white spots, pink legs and webbed feet. By day they wheel in loose circles over the water, follow the fishing boats, stand on the bollards, the roof ridges and the rails of the moored boats, float and bob on the river, and squabble over scraps on the Vismarkt. They flap and glide, bank in the turns, take off and land, walk, peck, preen and call. At dusk they come down to the water and the roofs: no gull hangs still in the night sky, and they take the night's light like everything else. Walk or run at them and they go up. The gull calls you hear come from a gull near you. The pigeons on the squares fold their wings when they land (Godot; in the browser the gulls have the new shape and settle on the water at dusk).
- No more flickering ground in the Godot version: the cart ruts, the setts between the rails and the pale edge stones no longer fight the cobbles, and the cobbles and other fine textures no longer shimmer as you move. The edge stones between pavings are real stones now, standing a little proud with rounded edges, and the pavements' bluestone kerbs have a rounded top edge and a row of gutter stones at their foot.
- Every packing crate in town is now one detailed crate: pine boards with gaps and worn, chamfered edges, the ends framed in cleats, a lid with two battens, skids underneath, iron straps nailed over the corners and a rope handle at each end. The stencil says what is in it, where it comes from and whose it is (glass from Liege, tea from Canton, cigars from Havana and fifteen more), and a crate keeps its stencil wherever it goes: on the pile, in your hands, on a cart. Before, crates mixed many textures, and in Godot a stack showed patches of every texture at once. Open crates have their lid off, leaning on an end, with straw inside.
- In the Godot version, the town's dung, straw, heaps and rubbish lie where they belong again. The bake drew one of each at the Rijnkaai's quay edge, so the manure heap hung over the water by the bollard and the rails, and the rest of the town had none. The heaps also keep 3 m clear of the water and off the rails and crane tracks wherever the town puts them.
- Two timber stagings stand out over the water, on the Rijnkaai and on the Petit Bassin's south quay: a plank deck held from the quay wall on joists and raking struts with iron shoes and knees, a railing on the water side, a davit with a block and a hook, and goods waiting on it. You can walk out onto them.
- You can dive: in the water press C (or Ctrl) to go under, swim where you look with W, Space to come up, C to go deeper. You hold your breath for half a minute; you are told when it runs short, and if it runs out you struggle up to open water. Under the water the view is the river's dark murk and the town's sounds are dull. You can dive under moored boats and the quay staging, never through a hull, a wall or the bed.
- In the Godot version, swimmers no longer pass through boats: every hull holds you off by its real shape (the bow and stern taper, the keel lies deep), and under its keel you can dive through. Rowing boats lying at a landing hold you off too: go round them or dive under.
- Swimming at high water you float over a handrail or a parapet that lies under the surface, find your feet where the water gets shallow, and you can climb out over the parapet and its handrail onto the stone steps where the step behind it is at the waterline (Godot; in the browser the old way out at the landings stays).
- Jumping feels like a proper first-person game: you leave the ground the moment you press Space, fly a true arc that keeps your running speed, steer a little in the air, can still jump a moment after running off an edge, and a press just before you land is kept. The view dips a little as your legs take the landing, more after a longer drop.
- Getting on and off ladders is one smooth move: in to the rungs and up, over the hoop at the top of a quay ladder, onto a crane's gallery and back down, off at the foot, out onto the steps from the water. Vaulting over a rail or onto a crate no longer stops at each point of the move.
- On a working crane whose cabin has swung away from the ladder, you no longer wait at the top: you climb over the gallery's railing onto it, and from the gallery you can climb back over the railing onto the ladder.

- In the Godot version, the town gates, the roofs of Sint-Paulus and Sint-Jacob and the Entrepot's upper floors are there again: the town was baked with them hidden because they were far from the camera at that moment ([#61](https://github.com/Steve-Sitax/Moodygame/issues/61)).
- In the Godot version, things that share one model (the lamp posts, the second calvary, church pumps, lock gate leaves, small boats, omnibus parts) are drawn every time, not only the first copy ([#61](https://github.com/Steve-Sitax/Moodygame/issues/61)).
- The water looks like water: soft ripples that never repeat in a pattern, with no zigzag stamp or bands over the river, the lock and the basin, and a wide soft sheen instead of a hard white glint. Rain makes many small, quick rings and a dimple where each drop lands, and in a downpour the whole surface roughens; the puddles in the streets get the same rain. Boats under way leave a V wake and a bow wave, oars leave rings at each stroke, moored boats send faint rings off their hulls, and a swimming Jef leaves rings and a small wake.
- In the Godot version, after loading a game the ferry and the boats float on the right tide at once; before, Jef could start on the water of a minute earlier, some 10 cm off.
- A new look: no more PS1 style. Textures stay sharp and true on every surface (no swimming, no blocky pixels), colours are smooth (no dither). In Godot the High quality setting now draws at the full window size with smooth edges. Fog and a fine film grain keep the mood. The PS1 colour and wobble settings are gone.
- Every lamp and lantern in town is rebuilt in detail (the street posts, the park and quay-step lamps, the wall and door lanterns, the oil lamps at the landing stage and on boats, the hand lanterns), and their light is now the same in kind: warm gas or a little warmer oil, stronger for the big ones. The park lamps and the passage lanterns now light up at dusk.
- The stone stairs down the quay walls to the water are built again, all eight of them (the Werf, the Vismarkt, the canal, the Rijnkaai, north of the lock and the Petit Bassin). They now look like part of the wall: the same bluestone, courses and colours, dressed corner stones, a head wall with a square stone pier at the top, a raked parapet with an iron handrail, granite treads with worn, rounded nosings, green and slimy below the high-water mark, a landing of big slabs with rounded edge stones, mooring rings and a grab chain. They are easier to use: a landing level with the quay at the top to step onto, 19 cm steps with a 31 cm going, and a wider walk between the wall and the parapet.
- The quay cranes keep working while you climb them: they no longer stop rolling along the quay while you are low on the ladder, or refuse to make way for another crane while you are aboard. You ride along on the ladder, the gallery and in the cabin, and the view turns with the cabin at once. At the bottom you step off where the ladder's foot is now.
- The calvary at the foot of the Steen's ramp and the one in St James's churchyard are now one detailed wayside crucifix: an oak cross with a small gabled hood and the INRI board, a painted Christ with his head bowed under the crown of thorns, the loincloth and the nailed hands and feet, on a bluestone plinth with an iron railing, a votive lantern and a pot of chrysanthemums.
- When an opening bridge on the quay lifts, the cart ruts across it no longer hang in the air over the water: they lie on the leaves and rise with them. Short plank ramps lead from the quay up onto the bridges' fixed decks.
- In the Godot editor's town view, the lamp posts, the cranes and the omnibuses show again, without the stray player body and the parked train's wheels.
- The big flat flagstones (the market squares, the quay, the pavements and the kerbs, and the gothic hall floors) no longer show wide bright streaks and dark blobs over every stone. The flags are laid again as old worn bluestone: thin uneven joints of sand and dirt, chipped edges, a few cracks, each stone its own grey. The round cobbles keep their rounded look.
- In the Godot version, the moored boats no longer stop moving when the town was baked with one of them out of sight.
- For Godot development, `godot/editor/town_preview.tscn` shows the baked town in the Godot editor.
- In the Godot version, people waiting at an omnibus stop only walk to a bus that has room for them; the others wait for the next one instead of vanishing at the step.
- In the Godot version, ferry passengers still on the landing stage when the ferry leaves walk on to the quay instead of standing frozen in the way.
- In the Godot version's play together, a player riding the omnibus is drawn on the bus floor as the other player sees it, instead of lagging behind it when the bus jumps.
- In the Godot version, townspeople with a long way to go take the omnibus: they walk to the stop, wait, take a real seat, get off at the right stop and walk on. Jef can ride along with them.
- In the Godot version, Jef can save while on a dockside crane's ladder and load back onto the same rung.
- In the Godot version, the prison has its people again: warders at their posts, prisoners pacing their cells, the exercise ring in the yard in exercise hours, and townspeople sent into the prison walk its real corridors.
- In Godot, a Sunday sermon retries with the current priest if a service refresh interrupts his climb or speech.

- The five windows by the Steen's museum door now show dark leaded glass like the rest of the Steen, by day and at night, instead of the fog behind them (browser and Godot; [#56](https://github.com/Steve-Sitax/Moodygame/issues/56)).
- In the Godot version, the random patterns in water foam, rain rings, cobbles, walls, smoke and the screen's grain no longer go flat in patches on some graphics cards ([#58](https://github.com/Steve-Sitax/Moodygame/issues/58)).
- Street traders’ speech bubbles disappear safely when the speaker leaves view.

- Godot's isolated sound check keeps passing traffic and railway sounds out of its scripted recording; ride checks use silent Dummy audio so they do not open a Windows output device.

- In Godot, street games, travelling trades and upstairs neighbours have their own visible props and movements; traffic, rooms, puddles, animals and the great storm now drive placed sounds.

- Watch and haul job twists now bring townspeople to Jef: bribes, theft, parcel offers and foremen use real actors and the original goods.

- Closing Godot during sound loading now lets the audio workers finish before the engine tears down, preventing a crash on very quick exits.

- In Godot, entering your rented room brings a neighbour's remark about its comfort and furniture. The server chooses who visits; they leave when you leave and speak once a day.

- In Godot, people summoned for jobs walk in from the living town and return to their day when the encounter ends, using reachable street points around doors and piers.

- In Godot, ducks defend their young from cats, unguarded ducks can be caught, and caught birds return only when nobody is watching. Stray dogs seek the fish-market scraps, owned dogs wait for a clear place beside their owner, and nearby cats and fleeing birds make their own sounds.
- In the Godot version, bats hunt over the water and round the trees at dusk and before dawn, as in the browser game.
- In the Godot version, the great storm tears things loose: slates and shingles off the roofs, washing, newspapers, hats and straw fly down the street, and slates smash on the stones.
- In the Godot version, storms bring thunder and lightning (a bolt over the roofs, the air flashing white, the thunder after it), lone drops fall off the eaves in the rain, horses blow clouds of breath on cold mornings, and the broken gutters' streams start right at their eaves.
- In the Godot version, the ships riding in the stream show their white lights at night, the moored ships' bilge pumps spout dirty water over the side now and then, and the priests, tourists, urchins, soldiers, beggars and the ragman are drawn whole ([#54](https://github.com/Steve-Sitax/Moodygame/issues/54)).
- In the Godot version, the great storm's rain pours as in the browser game: the far sheets of rain fall again, and the streaks are long and dense instead of a few short dashes ([#53](https://github.com/Steve-Sitax/Moodygame/issues/53)).
- In the Godot version, the town hall, the Oostershuis, the Vleeshuis and the Steen light their windows room by room through the night as in the browser game (clerks going home, late meetings, the porter, a watchman going round), and the Steen's lanterns burn by its gate and museum door after dusk ([#52](https://github.com/Steve-Sitax/Moodygame/issues/52)).
- In the Godot version, the sky at midday is a plain grey overcast again: large flat grey shapes no longer hang over the roofs, and the works' chimneys smoke in fuller, darker plumes ([#55](https://github.com/Steve-Sitax/Moodygame/issues/55)).
- Townspeople's outdoor activity spots stay on reachable ground instead of landing inside houses or the park pond; path snapping also keeps room for their bodies at lane edges.
- In the Godot version, the townspeople and Jef have their soft shadow on the ground again, as in the browser game.

- In the Godot version, the town's small life in the air is back: moths round the lit gas lamps on a still night, cats' eyes in the dark lanes, breath in the cold, water running from broken gutters with the damp stains under them, the great storm's surf bursting up the river walls and its rain splashing on the stones, and the white veils of heavier rain that each gust brings.

- In the Godot version, the breweries, the sugar refinery and the gasworks smoke from their tall stacks by their working hours, and steamers and barges smoke from their funnels and stoves as in the browser game.
- The Godot ferryman guides idle passengers around the ferry deck and onto the pontoon, then gives walking control back.

- Godot railway crews accompany the horses and gate; cranes replenish docker piles, make room for higher-priority neighbours, and trains stop for loose goods. River tows back out of verified blocked water and slow for rowing boats.

- Godot event actors use the server’s NPC ownership and the browser puppet pose format when playing together.

- Godot save/load keeps Jef aboard his omnibus, ship, crane, rowing boat, handcart or velocipede; rowing reboarding follows the moving thwart.

- The St. Anna ferry has night navigation lamps and warm saloon windows; moving carts and ships feed the Godot soundscape.

- Climbing onto a moving ship follows its deck throughout the climb.
- Godot Poesje spectators return to town when you leave the cellar behind and reappear when you return, without charging for another ticket that day.

- In Godot, emigrant mothers carry and hush their babies, departing passengers wave, and a Red Star Line notice shows the boarding day. Camp luggage keeps clear of tracks, omnibus routes and market fields.

- In Godot multiplayer, an arrested player appears at the police cell while other players continue walking, then leaves at dawn. Tavern rounds keep the engine’s three-round limit.

- The Godot Poesje now has a seated and standing audience, a bench for you, and puppet stick hits timed to the play.

- In Godot taverns, patrons talk at their tables and F lets you speak to an ordinary table companion.

- Godot hanging lamps fit the room’s ceiling and their glass glows in a dark room.

- Godot churchgoers nod and whisper during the sermon, the organ follows the service, and running among them draws the beadle’s warning.

- Godot home stoves warm you, placed clocks show the time and hanging lamps light the room. Furniture can go onto a lent handcart and return to your household.

- Godot shows your hands leaning on a mill capstan or hauling its chain when the wind calls.

- Godot keeps completed mill work when you follow another job or load a saved game.

- In the Godot version, lamps in rooms, shops and taverns and the lanterns people carry now glow the warm amber of the browser game instead of a deep red-orange, and a lantern left in the street lights the stones in the same colour ([#48](https://github.com/Steve-Sitax/Moodygame/issues/48)).

- Godot profiling records turning callbacks and identifies main-thread async continuations; the shared fresh-town check runner now includes street deeds.

- Godot keeps distant door and ride candidates from allocating prompts during walking and turning, retaining the same reach, text and actions.

- Godot deeds scan residents without boxing their enumerator and read nearby prompt heights only when needed, preserving theft and catch actions.

- The Godot places check waits for furniture's timed refresh instead of assuming a fixed number of uncapped frames.

- Godot checks now measure sustained turning and walking, GC generations and managed allocation medians, enforce the full performance limits, and run jobs, places, events, rides and play against disposable local test towns.

- Godot avoids allocating inactive collision and lamp checks, repeated sound wiring closures, bus names and home-door lookups during steady play.

- Godot skips identical mover instance-buffer uploads, while retaining every pose, colour and visible instance.

- Godot reuses unchanged carry and watch job papers, their rounded distance labels and carry-goal queries, keeping the same text and picture.

- Godot keeps incomplete walking plans when a newly learned path cannot affect them, avoiding repeated rebuilding of the whole town.

- Godot avoids temporary reflection matrices, floor-query arrays and room-selection containers; exact floor, room and pixel comparisons retain the same picture.

- Godot reuses interaction selection buffers and unchanged prompt text, while keeping live controls and the same action priority.

- Godot creates less temporary garbage while finding townspeople's daily walks, avoiding the measured route-learning hitch without changing their schedules.
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
