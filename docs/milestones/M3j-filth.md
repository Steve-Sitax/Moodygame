# M3j - Filth: trash and dirt in the streets of 1873 (2026-09-24, not yet committed)

Steve: "Research trash and dirt at that time, I feel we need that more." The streets still
looked too clean for a port town of 1873. This note holds the research, what was built from
it, and how to wire it in.

## Research

Sources are for reading only. Nothing was copied from them. "Comparison" means the fact comes
from another Belgian or Dutch town. "Unconfirmed" means no source was found for Antwerp.

### Street cleaning in Antwerp around 1870
- The city ran its own cleaning service from 1 January 1862, the Mestpacht (in French: Régie des vidanges, boues et immondices). Its depot lay between the Sint-Andriesplaats and the Prekersstraat. In 1875 the depot was a walled yard with a gate, a wooden shed and stables. Source: Inventaris Onroerend Erfgoed, "Openbare Reinigingsdienst", https://inventaris.onroerenderfgoed.be/erfgoedobjecten/6119
- During the 1866 cholera the city added a pickup at 7 a.m. in the poor quarters. Pigs and rabbits were banned inside the town, so people normally kept them there. Alleys had to be whitewashed twice a year (a rule from 1851). Crews poured 60-90 hl of iron sulphate and chloride of lime into the alleys every day. In 1866 there were 4,996 cases and 2,961 deaths among about 123,500 people, worst in the old sailors' quarter by Sint-Paulus. Source: S. Van De Vijver, "De bestrijding van de cholera in Antwerpen tijdens de 19de eeuw", https://schipperskwartier.gilbertus.com/pdf/013.pdf
- A scholarly summary lists alleys and slums, polluted wells, dirty ditches and ruien, shared privies, refuse, dogs, pigs and rats. Clean piped water came only in 1880. Source: K. De Schrijver, "Cholera in Antwerpen in de negentiende eeuw", https://www.zorg-en-gezondheid.be/sites/default/files/2022-04/Cholera.19de.eeuw_2006_56_2_De.Schrijver.K..pdf
- In 19th-century Flemish towns, waste went away mostly through open gutters in the streets. Sewers came in the second half of the century. Source: ETWIE, "Riolering", https://etwie.be/nl/kennisbank/themas/riolering
- Comparison, Aalst in the 1860s: a city cart went round on fixed days and people put their buckets out by the door. The street dung was sold to farmers by the cartload. Source: R.J. van de Maele, "De Aalsterse mestpleinen...", https://www.hetlandvanaalst.be/wordpress/article/de-aalsterse-mestpleinen-of-stortplaatsen-en-de-reacties-op-de-geuroverlast-en-de-eventuele-verspreiding-van-besmettelijke-ziekten-circa-1830-circa-1990/

### Horse dung and the dung collectors
- The narrow streets where the dock carts ran smelled of horse dung. In 1848 a dock company's house was sold "with stable and dung pit" in its yard. Source: "Paarden in Antwerpen in de 19e eeuw", https://schipperskwartier.gilbertus.com/pdf/010.pdf
- Autumn 1873 is new: Antwerp's first horse tram ran from 25 May 1873, and more lines opened that summer. Sources: the same thesis, and https://en.wikipedia.org/wiki/Antwerp_tramway_network
- Comparison, Bruges: the dung scrapers (mestrapers) were licensed poor people who wore a tin badge. The trade faded late in the century. Source: B. Debaenst, "Historische stront op Vlaamse grond", ch. 3, https://www.ethesis.net/faecologie/faecologie_hfst_3.htm. Unconfirmed for Antwerp in 1873.

### Gutters, chamber pots and slops
- Houses built over the vaulted canals drained straight into them, and the stink came up into the houses. U-bend traps were ordered in 1866. Source: Van De Vijver (above).
- Comparison, Ghent: in the Batavia beluik (1848), about 580 people shared 6 privies and 2 pumps, and doctors called these courts "dirty gutters". Source: Industriemuseum Gent, https://www.industriemuseum.be/nl/collectie-item/vieze-goten-en-verborgen-gevels-drie-eeuwen-gentse-beluiken
- Comparison, Dutch towns: privy gutters that ran straight into the canals were tolerated. Source: NEMO Kennislink on Roos van Oosten, https://www.nemokennislink.nl/publicaties/waar-bleef-de-poep/
- Unconfirmed for Antwerp: whether a street had one gutter down the middle or one along each side, and where the gratings were. The game's streets have kerbs (tools/blender/build_city.py), so the gutter runs outside the kerb.

### The vlieten
- Filling-in dates: the Koolvliet was half filled in 1867 and fully in 1877. The Brouwersvliet was filled about 1880 (one source says the last open rui was covered in 1882). The Sint-Pietersvliet went in 1884. So in autumn 1873 the Brouwersvliet and the Sint-Pietersvliet are open water. Sources: https://inventaris.onroerenderfgoed.be/themas/951 , https://inventaris.onroerenderfgoed.be/themas/991/teksten , https://inventaris.onroerenderfgoed.be/themas/11126
- People dumped household refuse, trade waste and privy waste in them despite the bans, and workers dug out the sludge now and then. Cholera was the stated reason to vault them. Source: https://magazine.antwerpen.be/open-monumentendag-2021/de-ruien. The quay works of 1877-85 came mainly because the Scheldt was silting up. Source: https://inventaris.onroerenderfgoed.be/themas/14749/teksten
- Herring boats unloaded at the Koolvliet and the Sint-Pietersvliet (nicknamed the "Haringvliet"). About 16 breweries stood along the Brouwersvliet. Source: https://www.sintpaulusantwerpen.be/nieuws/kolen-of-haringen/

### Cesspits, night soil, refuse, ash
- In Belgium, cesspits could only be emptied at night, with a cart, a tub and a ladle. Source: https://www.dekroniekenvandewesthoek.be/het-leeghalen-van-de-aalput/
- In 1865 the Mestpacht ordered three night-soil boats ("beerotters"), each 18.5 m long with one watertight tank of 715 hl. They carried the town's dung upriver to the farms. Source: https://www.schoolvoorscheepsmodelbouw.be/portfolio-items/beerotter/
- Street dirt was dumped on the Hooikaai and by the Stenen Kraan (the "Mestkaai"). The date is unclear. Source: https://weekend.knack.be/lifestyle/reizen/antwerpen-de-onderbuik-van-antwerpen/article-normal-853141.html
- Comparison, Aalst: coal ash piled up and poor people picked it over for cinders. Source: van de Maele (above). Ash set out by the door is unconfirmed for Antwerp.

### The fish market
- The Vismarkt by the Steen had Bourla's market hall (1841-43). Fish were auctioned every day by falling price. Fish traders and fishwives worked there, and the porters wore a brass badge. It was cleared in 1883. Source: OKV, "Farasyn", https://www.okv.be/artikel/farasyn-een-kapitaal-stuk-voor-antwerpen
- Antwerp shipped mussels in bulk to Paris, Lille and Bordeaux in the 1860s. Source: R.J. van de Maele, "Vismarkten en vismijnen in Vlaanderen", https://www.vliz.be/imisdocs/publications/ocrd/222154.pdf
- Comparison, Roeselare 1848: streets had to be swept at least twice a week because of the waste from cleaning fish, rabbits and poultry. Fish sellers dumped their waste in pits. Source: https://filipbommarez.com/geschiedenis%20van%20de%20nieuwmarkt/de%20vismarkt. Cleaning after hours in Antwerp is unconfirmed.

### The quays
- Each quay had its own goods (the Houtkaai for timber, the Hooikaai for hay, and so on), and the Werf headland lay by the Steen. About 700 buildings were pulled down for the works of 1877-85. Source: https://inventaris.onroerenderfgoed.be/themas/14749/teksten
- Coal carriers had their own "naties". Later sources praise newer methods for avoiding "the unavoidable dust" of the old way, which confirms visible coal dust. Source: https://magazine.antwerpen.be/open-monumentendag-2024/en-route-via-de-schelde (read only in summary)
- Unconfirmed: tar, oakum, rope ends, spilled grain and sacking on the Antwerp quays. They are built as common port waste of the time.

### Rats, gulls and dogs
- Rats and dogs are in the scholarly list of Antwerp's cholera factors (De Schrijver, above). The city's dog catcher is older history (https://www.fragys.be/hondenslagers/). Gulls are unconfirmed; the game already has gulls (ambient.ts).

### Sweepers and rag-and-bone men
- Comparison, Bruges 1859: 109 street sweepers, mostly men with no other work (Musea Brugge Museumbulletin 2011/3, snippet only).
- Antwerp 1866: old-clothes and furniture dealers bought the goods of the dead, and straw bedding was stolen from the burning places (Van De Vijver, above).
- Comparison, Brussels: the chiffonniers (rag pickers) raked through the rubbish with a hook (fr.wikipedia "Chiffonnier (métier)", pointer only).

### Pictures looked at (reference only)
- Jan Michiel Ruyten, *View of the Brouwersvliet in Antwerp*, 1876, MAS Antwerp (public domain), https://www.wikidata.org/wiki/Q123271080
- Edgard Farasyn, *De oude vismijn* (1882), KMSKA; Louis Artan, *Quay in Antwerp*, 1873, MSK Gent 1931-A; François Bossuet, *De oude vismarkt in Antwerpen*, 1833, KMSKA 1005; Commons category "Antwerp in the 1870s".

## What was built, and why

| Research | In the game |
|---|---|
| Dung thickest where carts ran, and in stable yards | 3D dung piles and trodden dung, muck and straw along the cart roads of ruts.ts. A horse line down the middle of every street. Heavy dung, a wet patch and dirt stamps at all 12 omnibus stops, the 4 drays' stops and the farrier. A manure heap with board edging, a fork, and the dung collector's barrow and broom, in a dead end near the drays |
| Open gutters, slops thrown out | Dark wet gutter runs outside the kerb, with a pale line of wet shine, straw and scraps in them, and a drain grating at some ends. Slops thrown from doors, running into the gutter, sometimes with the bucket |
| Refuse and ash put out | Ash heaps beside doors, with ash spilled. Refuse heaps (ash, sweepings, cabbage, a broken basket, rags, crocks, boards) in back corners, dead ends first |
| Corners | Urine stains on the ground at street corners, and a wet tongue up the wall |
| Fish market | Fish heads, guts, small fish, scales, mussel and oyster shells, shell heaps, straw, slats, sacking and paper on the Vismarkt. Its waste follows the engine's market hours: about 70 bits while the market runs, 261 from packing-up until the dawn sweep, 48 on a Sunday. The Grote Markt gets cabbage leaves and rotten vegetables on its market days |
| Quays | Fish waste on the fish quays. Elsewhere slats, crushed crates, sacking, rope ends, straw, spilled grain, oil, tar and soot. Coal dust and lumps round every coal heap, with a black trail toward the water. Tar by the tar fires and the boat trestles. Grain and sacking at the storehouse doors |
| Vlieten as open sewers | Foul water in the vliet (thickest), the canal and along the fish quays of the river: browner and duller, a drifting skin of scum. About 140 bits of rubbish float and bob, mostly by the walls |
| Rats | At night up to 8 rats run along the wall foot near you, stop to sniff, and bolt when you come within 4.5 m |
| Swept squares | The Grote Markt, the Handschoenmarkt and the cathedral front get about a third of the litter |

Not built: street sweepers and dung-collector figures, and a night-soil cart. These are optional; the barrow and broom stand for the collector.

## Files
- `tools/blender/build_litter.py` makes `client/public/models/litter.glb` (37 models, 2,632 tris, 172 KB, Draco). Preview: `blender -b --factory-startup -P tools/blender/build_litter.py -- --preview` writes `data/shots/litter_preview.png`.
- `client/src/world/litter.ts`: `createLitter(scene, flags, opts)` and `setLitterClock(day, hour)`.
- `client/src/world/dirt.ts` (additive): `cartRoads()` returns the smoothed cart roads that ruts.ts hands to `dirtAlong`. `dirtStamp(spots)` darkens the dirt map in soft spots (stands, gutters, heaps, coal, markets).
- `client/src/retro/psx.ts` (additive): uniforms `uFoul` and `uFoulBox` on the water material, for foul water and scum. The default is a 1x1 texture of 0, which means clean water.

## Wiring (not applied)
rijnkaai.ts, in the import block:
```ts
import { createLitter, type Litter } from "./litter";
```
rijnkaai.ts, next to `let fires: Fires | null = null;`:
```ts
  // horse dung, gutters, heaps, fish waste, floating rubbish, rats at night (world/litter.ts, M3j)
  let litter: Litter | null = null;
```
rijnkaai.ts, at the end of the `.then((qf) => { ... })` block, after `fires = createFires(...)`:
```ts
      return createLitter(scene, city.flags, {
        avoid: [...colliders, ...craneRunways],
        quaySites: qf.sites,
        quayInfo: () => ({ flights: steps.flights, ladders: steps.ladders }),
        swimFree,
        waterY: WATER_Y,
      }).then((l) => {
        litter = l;
        colliders.push(...l.colliders);
      });
```
rijnkaai.ts, in `update()`, after `quayKit?.update(...)`:
```ts
    litter?.update(t, dt, camera ?? undefined);
```
main.ts, import and one line in `frame()` next to `market.update(...)`:
```ts
import { setLitterClock } from "./world/litter";
  setLitterClock(jobs.day.dayNum, jobs.day.hourF);
```
(If `__scheldemist.step()` should move the market waste with the clock too, add the same line there.)

## Checked in the browser (2026-09-24, own tab, dev view)
- `__scheldemist.paths()` returned `[]` with the heaps' colliders added.
- Checked against the keep-outs: no instance on the rails, on a bridge, or inside a trade's workshop, and no solid bit within 1.5 m of a job spot or at a game door.
- Cost: +3 draw calls (three BatchedMeshes) and about +17k triangles in view. The frame time change was lost in noise (±1 ms spikes from the rest of the game). `update()` takes 0.035 ms. Placement takes about 0.2-0.3 s once, after the quay furniture loads.
- Shots are in `data/shots/`: m3j_road, m3j_gutter, m3j_gutter3, m3j_vismarkt, m3j_vismarkt_after, m3j_coal, m3j_corner, m3j_heap_*, m3j_vliet3, m3j_canal, m3j_rat.
