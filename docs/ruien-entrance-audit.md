# Ruien entrance audit — 5 November 2026

The built entrance repairs are implemented: RE29’s street obstruction is retired, RE28 follows the quay, O2 uses a connected facade door, RE14 is clear, and the shared stair-house kit has individual slate courses and connected surface drainage. Native acceptance results are recorded below. Unbuilt network markers remain proposals.

[Annotated entrance map](media/ruien-entrance-audit.png). Green marks built wall doors, blue the connected R1/O2 doors, brown the reserved stair-house footprints, grey the retired street openings and purple the planned stair targets. The rail overlay is schematic; the clearance calculations use the actual runtime curves.

## Scope and rule

Inspected the 26 installed doorway/stair-house entries in `native-godot/world/ruien/entrances.json`, the legacy O2 surface access and water outlet, all 18 planned stair targets, 148 planned grate positions, six special access markers and ten planned water gates. These categories overlap; they are not a count of finished entrances.

Use a facade doorway or a traffic-free square. The surround, open leaf, stair-house, landing and approach must fit outside cart and tram corridors and follow the adjacent facade/boundary/paving. Street grates ventilate; they are not entrances. A walkable pixel and a room centre do not approve a surface site.

## Repairs to the audit findings

- **Rijnkaai / RE28:** turned onto the quay’s flagstone axes (`out [-1, 0]`). Its complete reserved apron includes roof/gutters, both gullies and the 1.6 m doorway approach.
- **Sint-Paulus / RE29:** disabled the duplicate street access house. The connected R1 facade door serves this area. The record and permanent ID remain, with `supersededBy: r1_paulus`; original street paving/collision is no longer cut.
- **Shared stair-house kit:** all seven active houses now have separate 4.5 mm slates with 200 mm exposure and 190 mm headlap, timber boarding, lead soakers, a raised ridge roll, falling gutters with open outlets, hollow downpipes/shoes, sloped U channels and grated gullies. Brick faces have up to 8 mm of geometry sampled from the town’s own height map, keeping both header and stretcher joints aligned; lower-wall and outlet weathering carries onto conforming transparent ground films. The retired eighth house uses the same repaired kit if reinstated at a safe site.
- **RE14:** clear plants after native street dressing as well as during the original baked-town cut. Native dressing previously put plants back in the walking strip.
- **O2:** retire both road hatches, leave solid stone ceilings under restored town paving, and suppress their daylight/beams and acoustic openings. The street grate is closed ventilation. A new inward-opening house door at `(-157.787, 132.000)` leads down through a brick passage to a supported maintenance walk and the existing hall bridge. Its projecting 260 mm threshold is replaced by a 25 mm worn sill within the retained surround. Iron girders and stone piers support the jointed walk; rails open at the T junction. A brick barrel under the new stair preserves the existing bridge route. The joining bank strip is replaced in both imported LODs and collision rather than covered by another pavement. The retired opening's stone closure overlaps the old lining's flared corners; a lid-sized cap left small sky sightlines from below.

The seven reserved footprints have no standing-building overlap, clear the goods-rail 2.2 m band and all crane runways, and remain outside the fixed vehicle routes’ conservative 2 m corridor. The closest full footprint is 2.575 m from a vehicle-route centre (RE24); RE28 is 3.280 m away. These are current-route checks, not permission to put future tram or cart routes through the aprons.

Surface reservations: `native-godot/world/ruien/surface-reservations.json`. Roof drainage: `surface-drainage.json` records all 14 inlet positions, 100 mm pipe diameters, -0.95 m invert levels and unique connection IDs. The roof-to-gully path is built; the onward Ruien connections are explicitly **reserved**, not claimed complete.

Edge notes: stone arrises 8–12 mm; the brick height field retains the wall boxes’ 5–6 mm corner bevels; timber boarding 2 mm; slate edges about 0.9 mm within their 4.5 mm thickness; pipe mouths and sheet flashings 1 mm. Gutter stop plates retain an intentional thin sheet lip. Gable mating edges sit under the coping or against the side walls. Collision follows the shell and the actual inlet cuts; damp films have no thickness or collision.

## R1 changes completed

The cobbles are darker and rougher, with dirt concentrated in joints and along damp wall feet. The shared paving material also affects O2; its gallery and hall were rechecked in daylight, rain and darkness. R1 coping is now 0.50 m wide and 0.32 m deep, with 8–14 mm bevels. Paving stops at its inner arris instead of covering its top. All four R1 areas were rebuilt at both LODs.

The old road hatch is retired. Access uses the existing doorway of house 82, beside the bakery, with an inward-opening oak leaf, an enclosed stair and a vaulted passage into R1. The original facade surround, town placements, R1 mouths and object IDs were preserved. The street grates remain closed vents.

## Installed doorway entrances

Positions are world `(x, z)` in metres. “Fits” describes the doorway site, not the completion of the underground network. There are 26 active entrances: 24 survey entries ending at works closures plus connected R1 and O2 doors. RE29’s retired record is retained in the table.

| ID | Position | Siting / appearance finding |
|---|---|---|
| re06_rode_poort | 223.37, 127.45 | Existing gate-house doorway; clear of the carriageway. |
| re07_entrepot | 209.94, 12.50 | Rampart doorway; aligned with the stone base. |
| re08_north_hall | 220.67, 271.78 | Rampart doorway; aligned with the stone base. |
| re09_keizerspoort | 37.27, 348.62 | Rampart doorway at a wall return; no freestanding road obstruction. |
| re10_kipdorppoort | -149.70, 347.61 | Existing gate-house doorway; retain the hood. |
| re11_werf | -352.79, 56.19 | Rampart doorway; approach stays outside the traffic opening. |
| re12_prison | -360.45, 253.55 | Rampart doorway; no surface stairwell. |
| re13_vestrui | -223.35, 345.92 | Rampart doorway; keep the vegetation outside its approach. |
| re14_rode_poort_rui | 228.41, 194.14 | Doorway aligned; walking strip and lower door cleared after native dressing. |
| re01_sint_joris_poort | -312.50, 142.96 | Side door in the gateway passage; inward leaf. Keep the passage clear. |
| re02_keizerspoort_poort | 49.50, 326.68 | Side door in the gateway passage; inward leaf. Keep the passage clear. |
| re03_kanaalrui_poort | -81.21, 220.00 | Side door in the narrow gateway passage; inward leaf. |
| re04_sint_jansplein_poort | -17.00, 289.14 | Side door in the gateway passage; inward leaf. |
| re17_kipdorprui_cottage | -169.65, 230.07 | Door between the cottage windows; follows the gable face. |
| re18_paulusrui_house | 28.11, 115.07 | Side door in the brick house wall; follows the facade. |
| re20_kanaalrui_cottage | -45.68, 221.70 | Door between the cottage windows; follows the gable face. |
| re21_entrepotrui_cottage | 179.80, 250.55 | Door between the cottage windows; follows the gable face. |
| re24_steenplein | -208.45, 14.91 | Square/quay site; full apron reserved and clear. Shared roof/drainage kit repaired. |
| re27_werf | -301.20, 58.58 | Open square; complete footprint reserved outside vehicle corridors. Shared kit repaired. |
| re28_rijnkaai | 39.75, 31.89 | Aligned with quay flagstones; complete footprint reserved and clear. Shared kit repaired. |
| re29_sint_paulus | 150.70, 272.92 | Retired. Street ground restored; connected R1 doorway replaces this access. |
| re30_hanseatic | 78.64, 199.12 | Green/court site; complete footprint reserved and clear. Shared kit repaired. |
| re31_kipdorp | -174.90, 289.63 | Green/court site; complete footprint reserved and clear. Shared kit repaired. |
| re32_stadspark | -221.34, 319.08 | Green/court site; complete footprint reserved and clear. Shared kit repaired. |
| re33_lijnwaadmarkt | -214.25, 147.04 | Aligned forecourt; complete footprint reserved and clear. Shared kit repaired. |
| r1_paulus | 162.71, 301.48 | Existing house doorway, inward leaf, facade-parallel stair, vaulted link to R1. |
| o2_vleeshuis_door | -157.79, 132.00 | Existing facade doorway; lowered sill, inward leaf, buried stair, supported walk and underpass to the hall bridge. |

Native flank rays generally agree with the host-wall normal within 0.2 degrees. RE08 has one low ray on a transverse stone edge; its upper wall rays agree with the facade. All 26 intended 0.45 m and 0.9 m approaches have body clearance. Longer perpendicular probes strike the opposite walls in the narrow gateway passages; those are not valid approach routes. These measurements do not prove cart or future tram clearance.

## O2 and closed vents

| Access | Position | Finding / action |
|---|---|---|
| `vleeshuis_hatch` | -153.50, 136.38 | Retired: no moving leaves or street cut; stone closure below continuous town paving. Replaced by the O2 facade door. |
| `o2_keeper` | -154.00, 74.50 | Retired: preserve the underground flight/niche below a solid closure; no lid service, street opening or daylight beam. Footway/kerb restored. |
| `grate_shaft` | -146.90, 92.54 | Closed ventilation only; no E-climb action or moving lid. |
| O2 water gate | -146.10, 72.10 | Water-side outlet, with the access below the quay rather than an opening across the street. Retain that form; it does not approve new street access above it. |
| R1 former road hatch | 159.55, 294.91–299.69 | Retired. No exported stair/hatch marker remains; original town paving/collision stays whole. |
| R1 L65 / L100 / L114 grates | See installed area markers | Closed ventilation only; no E-climb prompt or moving street lid. |
| R1/O2 crown shafts | See area `grates` | Closed ventilation; not an entrance. |

## Planned stair targets

These markers identify an underground connection need. Most have no surveyed surface footprint, orientation or opening geometry, so their appearance cannot be approved. Suggested nearby existing entrances are alternatives to study, not completed connections.

| Target | Position | Required decision |
|---|---|---|
| A1 | -212.0, 22.0 | Use the Steenplein square edge; consider the existing RE24 rather than another opening in the haul route. |
| A2 | -258.0, 62.0 | Measure an actual Stadhuis cellar doorway; the marker is not a door-face survey. |
| A5 | -118.0, 152.0 | Use a facade door or a confirmed square edge; the marker is 2.59 m from the Keizer omnibus line, so a full entrance footprint could intrude. |
| A6 | -152.0, 330.0 | Marker lies inside the wall/building mask. Survey a keeper-house door; do not open the street over it. |
| A10 | 205.0, 120.0 | Use a rampart/guard doorway; study the existing Rode Poort access first. |
| S-C3 | 210.7, 271.7 | Study a link to RE08; do not turn the underground hall centre into a hatch. |
| S-R1 | 156.8, 290.5 | Resolved by the R1 facade doorway and built passage; the original centre marker is not a surface hatch. |
| S-R2 | 79.7, 172.0 | Choose a warehouse-side doorway or a confirmed green/square edge; no surveyed footprint yet. |
| S-R3 | 14.6, 37.4 | Reject a surface hatch here: the marker is 0.40 m from the current quay omnibus line. Use a side doorway and keep loading lanes clear. |
| S-R4 | 27.6, 172.3 | Survey a facade doorway or square edge; do not cut the street junction. |
| S-R5 | -28.8, 262.5 | Confirm the actual Sint-Jansplein edge and traffic lanes before siting the entrance. |
| S-C2 | -149.1, 124.1 | Built O2 access now uses the house doorway. The hall-centre marker remains an underground connection target, 0.47 m from the town omnibus line; no surface hatch. |
| S-R6 | -181.6, 304.7 | Study a connection from RE31 on the green/court; no extra street hatch. |
| S-R7 | -218.4, 306.7 | Study a connection from RE32; preserve park paths and cart access. |
| S-C1 | -255.0, 100.0 | Use a Grote Markt facade/cellar door or square edge outside market and through routes. |
| S-R8 | -358.5, 218.7 | Survey a prison/rampart doorway: the marker is only 2.09 m from the town omnibus line. No room-centre street exit. |
| S17 | 201.1, 2.0 | Quay/Entrepot traffic: consider existing RE07 rather than a new house on the road. |
| S18 | 55.0, 341.4 | Reject an access house/hatch here: only 1.37 m from the Keizer omnibus line. Study existing RE02/RE09 instead. |

## Special access and water gates

| Marker | Finding |
|---|---|
| A3 Vismarkt waste hatch | Unbuilt. Put any operable waste drop/access on a market service apron or behind a wall, outside deliveries and through routes. |
| A4 Vleeshuis cellar hatch | Unbuilt. Use a wall/service-yard opening; no operable road lid. |
| A11 inn cellar | Doorway is the correct form; the exact wall and approach still need a native survey. |
| V1 / V2 air shafts | Ventilation only. Include the pump/shaft enclosure in square circulation checks. |
| X1 collapse option | Yard-only proposal. Confirm a real yard, fence and escape clearance; no opening into a road. |

| Water gate | Status / surface implication |
|---|---|
| O10 Noorder gate | Unbuilt hydraulic/boat opening. Detailed quay/bank siting and structure still required; do not create a road entrance above it. |
| P1 Bassin boat door | Unbuilt hydraulic/boat opening. Detailed quay/bank siting and structure still required; do not create a road entrance above it. |
| O9 Paulus gate | Unbuilt hydraulic/boat opening. Detailed quay/bank siting and structure still required; do not create a road entrance above it. |
| O8 Rijnkaai gate | Unbuilt hydraulic/boat opening. Detailed quay/bank siting and structure still required; do not create a road entrance above it. |
| O7 Jans gate | Unbuilt hydraulic/boat opening. Detailed quay/bank siting and structure still required; do not create a road entrance above it. |
| O6 Canal head gate | Unbuilt hydraulic/boat opening. Detailed quay/bank siting and structure still required; do not create a road entrance above it. |
| O4 Brouwers sluice | Unbuilt hydraulic/boat opening. Detailed quay/bank siting and structure still required; do not create a road entrance above it. |
| O2 Vliet sluice | Built water-side outlet; no street hatch. |
| O1 Steen gate | Unbuilt hydraulic/boat opening. Detailed quay/bank siting and structure still required; do not create a road entrance above it. |
| F1 Kipdorp flush sluice | Unbuilt hydraulic/boat opening. Detailed quay/bank siting and structure still required; do not create a road entrance above it. |

## Evidence and limits

- Current proof folder: `D:/Code/Proofs/ruien-entrance-fixes/`. The original audit and R1 proof remain in `D:/Code/Proofs/ruien-r1-feedback/`.
- `final-access`: **170/170 native checks**, including RE14/R1/O2 doors and stairs, both directions along the O2 supported walks and underpass, the survey of all 26 active entrances, and 244 floor rays across the retired street openings. Its 35 mood/inspection views also exposed the small ceiling-cap gap, repaired afterwards. Two oblique cameras are superseded by the clearer final walkway views.
- `arch-accepted`: **90/90 native checks** after the crown/end-joint repair, repeating the O2 door/stair, both walk directions and restored-street checks. All 16 final views were reviewed: clear passage/walk angles, the closed ceiling, dry daylight, rain, darkness and explicit inspection fill. The bright inspection views are construction evidence, not the production lighting. The final builds have zero errors.
- All seven active stair-house player routes passed **30/30 checks each** in `review2/live.log`: inward doors, descent, body clearance, return, closed collision and saved door state. The later shared-shell changes concern exterior relief, roof/drainage and vault winding; the final run rechecks representative native vaults. The clipping regression also passes (`cut-accepted/engine.log`).
- The focused native-scene probe samples actual floor heights and full player-body clearance along the final supported route: **0 blocked samples out of 341**, `physics-arch.json`. Its four ceiling sightlines must hit the front of the closed stone cap; before the repair they hit only the back of the street paving. The imported passage cut follows the barrel's inner facets, retaining masonry above and beside it; the new lining overlaps its far cut by 30 mm. Earlier full-town failures exposed the raised sill and blocked hall connections; those checks led to the lowered sill, supported walk and stair underpass. Failed runs remain in the proof folder.
- The 91 `accepted2` captures cover all seven shared shells, both gullies, low eaves, rear/context views, repaired doorway vegetation and restored street openings. The roofs, wall relief, ground junctions and drainage were visually reviewed in daylight, rain and darkness. That run’s obsolete O2 route failed; its screenshots are evidence for the unchanged surface assets, not a passing route result.
- Shared shell check: all seven active roofs have individual slates; zero winding/normal disagreements. All six material surfaces have zero stretched UV area (`roof-uv.json`). The brick relief’s tiny non-planar facets reach 5.32 degrees of shear over 0.002348 m²; its image and height use the same metric chart. The other surfaces stay below 5 degrees. Slate edge faces keep their own metric chart.
- `surface-clearance.json` uses full polygons including gullies and approaches against the runtime-rounded vehicle routes, current goods railway and crane runways. Future circulation must preserve `surface-reservations.json`.
- Unbuilt stair targets, special access and water gates retain the siting decisions in their tables. These repairs do not construct or approve the rest of the underground network. Street grates remain ventilation-only; a room centre never authorises a hatch.
