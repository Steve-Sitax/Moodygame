# St James's churchyard made larger · 27 October 2026

Steve: "You could make the cemetery a bit bigger on one side and put premium graves in for important people, maybe even
sort of cellars like there were in the time."

## Where

The yard (`townplaces.json` "stjacob_yard": two small railed plots against the church) grows over the plots of the razed
houses 459 to 461 (church-squares-20261027), from the old east plot's rail (x -94.6) to x -76.0, z 334.4 to 343.4:
167 m², twice the old plots together. The old east plot's rail on that side is taken out of the baked railing, so the old
plot and the new ground are one yard. Kerbed railings like the old ones (the same heights and bar spacing, the same dark
green paint) close it; a blue-stone kerb now runs under the old plots' railings too.
The keizer omnibus passes 2.7 m beyond the south railing; route audit 0 hits.

A gravel walk runs from the old plot's west gap through both, edged with small stones; a second walk runs to a new gate in
the south railing (two blue-stone piers with caps and balls, iron leaves standing open into the yard).

## The graves (scripts/churchyard.py, churchyard_kit.py; models assets/models/churchyard)

By 1873 Antwerp buried at the Kiel; the churchyards took their last burials before 1784. So all are old, weathered blue
stone (the town stairs' stone; the vaults' walls the town plinths' coursed ashlar), with soil splash and damp at the
foot, moss on level and low faces, pale lichen spots, rain runs under the tops. Every stone arris is rounded 8 to 15 mm,
iron 2 to 4 mm. Invented families; Latin formulas cut into the stone's own picture (Old Standard TT, SIL OFL):

- **Vault chapel, Moens** (`vault_chapel`): plinth, coursed walls with corner pilasters, cornice, gables and a roof of
  stone slabs with their joints, a ridge roll and a stone cross; a plated iron door with straps, rivets, ring and keyhole
  up two steps; "SEPULTURA FAMILIAE MOENS" on the lintel; an epitaph tablet on a corbel on its side.
- **Stair vault, Van Ertvelde** (`vault_stairs`): four worn steps down between coped parapets to a plated iron door in a
  pedimented portal (1742), the vault's barrel hood of three stone courses behind; a locked gate with spear heads and a
  padlock across the top step. The ground is cut away under the stair (NativeChurchyard).
- **Vault ledger, De Pauw** (`vault_ledger`): a raised ledger on a stone curb over a vault, four lifting rings in iron
  plates, a carved shield of arms (chevron, three stars), 1738.
- **Chest tomb, Verstraeten** (`chest_tomb`), merchant, 1758: plinth, corner pilasters, raised panel frames, moulded lid.
- **Obelisk, Van Loon** (`obelisk`), doctor of medicine, 1783, and his wife: stepped base, inscribed die, tapering shaft.
- **Family plot, Claes** (`family_plot`): stone kerb and cast-iron railing with spear heads and urn finials round a cross
  on its pedestal and two ledgers (1767, 1780).
- Six headstones (round, segmental and gabled tops), a stone cross, two ledger slabs worn into the grass, the oldest
  inscriptions nearly gone.

Collision: boxes round every grave, vault, pier and railing run (31). The gate's leaves are solid; the plots are closed.

## Also

- `squares.py` keeps its trees and benches out of the yard and 1.2 m round it (3 trees, 2 benches left out after the draw:
  every other tree and bench stays where it stood). `squares.json` regenerated.
- The cleared ground: the street's litter, leaves, the razed houses' raised flags and kerbs and their plinth tops left
  floating at 0.71 m are taken out of the new ground; the paving's drawn faces under the grass are cut (they showed through
  it), its collision and walk support kept.
- The sky map still held the razed houses' roofs, so the cleared squares round all three churches lay in their shadow at
  noon: `Psx.ClearRoofs` takes them out at load, with the yard's.

## Checked

Game pictures at 10:00 and 13:00 clear, 13:00 rain and 22:00, close and wide (D:/Code/ScheldemistWork/churchyard). At
13:00 the church's own shadow lies over the yard (the sun is south-south-west, the church west of it): the morning is when
it is in the sun.

## Not yet

- Mourners or a sexton visiting the yard: the native places and routes have no visit kind for a churchyard yet.
- The razed houses' plinth tops floating at 0.71 m are cleared inside the yard only; the other cleared plots round the
  churches probably still have them (NativeRazedHouses.Cut leaves them: not checked outside the yard).
