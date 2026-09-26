# Scheldemist

A 3D browser game. Antwerp, autumn 1873: first person, a PS1 look, fog on the Scheldt. You are Jef,
new in town, looking for work on the quays. The townspeople talk, remember and act; an AI proposes
their words and plans, and the game engine checks every proposal and owns every number.

## Run it

1. Install a current Node.js.
2. `npm run setup` once, then `npm run dev` in this folder.
3. Open http://localhost:5173. The server runs on 127.0.0.1:8787; the save is `data/game.sqlite`.

The game works with no AI at all. To let an AI speak for the town, pick one in the game's AI setup
(see `docs/ai-setup.md`). The design notes start at `docs/README.md`.

## Licence

Copyright (C) 2026 Steve (Sitax)

Scheldemist is free software under the GNU Affero General Public License, version 3 or (at your
option) any later version. The full text is in `LICENSE`.

In short: you may use, study, change and share the game, as long as what you pass on stays under
the same licence with its source. If you run a changed version on a server that other people play
over a network, you must offer them the source of your version too.

This program comes with no warranty; see sections 15 and 16 of the licence.

Third-party material keeps its own licence. Every sound, font, picture and data source, and where
it came from, is listed in `assets/ATTRIBUTION.md`. Among them: CC0 sounds (Kenney, BigSoundBank,
Freesound), fonts under the SIL Open Font License 1.1 (installed from npm), a street plan traced
from the 1873 Vuillaume map (CC0), and landmark outlines from OpenStreetMap
(© OpenStreetMap contributors, available under the Open Database License 1.0). The npm packages
keep their own licences; the Claude Agent SDK is Anthropic's proprietary software, installed by npm
and not part of this repository.
