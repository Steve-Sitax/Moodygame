<p align="center">
  <img src="docs/media/hero.jpg" alt="Tall ships at night by the Rijnkaai, a gas lamp mirrored in a puddle" width="100%">
</p>

<h1 align="center">Scheldemist</h1>

<p align="center">
  <i>Antwerp, autumn 1873. Fog on the Scheldt, work on the quays, and a town that remembers you.</i>
</p>

<p align="center">
  <a href="https://steve-sitax.github.io/Moodygame/"><b>Try it in your browser</b></a> (a limited demo, just a look)
  &nbsp;·&nbsp; <a href="https://github.com/Steve-Sitax/Moodygame/releases/latest"><b>Download the full game</b></a>
  <br><a href="#play-it">How to play</a>
  &nbsp;·&nbsp; <a href="docs/README.md">Design notes</a>
  &nbsp;·&nbsp; <a href="#made-with-ai">Made with AI</a>
</p>

A 3D browser game in first person. You are Jef, new in town, with a few coins and
rent due by Sunday. You look for work on the quays. The townspeople talk, remember and act: an AI
proposes their words and plans, and the game engine checks every proposal and owns every number.

- **A real town.** The streets are traced from the 1873 Vuillaume map. About 190 townspeople have
  homes, trades, families and a day of their own.
- **Talk to anyone, in your own words.** Ask the fishwife for work, haggle at a stall, lie to the
  police. The town answers in its own voice, and the engine decides what it costs you.
- **Work the quays.** Carry, watch and deliver. A job can turn: a thief, a bribe, a load that breaks.
- **Things happen.** A director plans the town's events every game hour: fires, auctions, strangers,
  ballads on the corners, a sermon on Sunday.
- **Weather and night.** Mist, fog, rain and storms; gas lamps and lit windows after dark; tides,
  tall ships, cranes, opening bridges and a working lock.
- **Real rooms.** Every building you can enter is built inside, at its true size. You see the street
  from inside and the room from the street.
- **Play alone, or with the people in your house.** And with no AI at all, if you like: then it is a
  walk through 1873.

<table>
  <tr>
    <td width="50%"><img src="docs/media/alley-night.jpg" alt="A back alley at night: a woman with a lantern, men carrying loads, wet cobbles"><br><sub>A back alley at eight in the evening</sub></td>
    <td width="50%"><img src="docs/media/cathedral-night.jpg" alt="The cathedral at night, gentlemen in top hats under a gas lamp"><br><sub>The cathedral from the Handschoenmarkt</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/media/vleeshuis.jpg" alt="The Vleeshuis over the canal, lit windows around it"><br><sub>The Vleeshuis over the canal</sub></td>
    <td width="50%"><img src="docs/media/quay-night.jpg" alt="A dock crane and a gas lamp on the wet quay, a man mirrored in a puddle"><br><sub>After the rain on the Rijnkaai</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/media/het-steen.jpg" alt="Het Steen at night beyond the fish market stalls"><br><sub>Het Steen beyond the fish market</sub></td>
    <td width="50%"><img src="docs/media/talk.jpg" alt="Talking with a fishwife about work"><br><sub>"Where does a stranger find honest work in this fog?"</sub></td>
  </tr>
</table>

## Play it

**Just a look: [try the web demo in your browser](https://steve-sitax.github.io/Moodygame/).** It is a limited version: you walk about the
town among its people, press **F9** to fly over it, and **F8** to set the time and the weather or start
one of the town's events (a wedding, a house fire, street musicians, the night watch and ten more). No talking, no jobs, no AI and no saves. About 80 MB loads the first time.

**The whole game:** download it below.

**[Download the latest version](https://github.com/Steve-Sitax/Moodygame/releases/latest)**. You need to
install nothing. What changed in each version: [CHANGELOG.md](CHANGELOG.md).

1. On the download page, pick the file for your computer: Windows (`windows-x64.zip`), Mac with an Apple
   M1 or newer (`mac-arm64.zip`), or Linux (`linux-x64.tar.gz`).
2. Unzip it.
3. Start it:
   - **Windows:** double-click `Start Scheldemist.bat`. If Windows says "Windows protected your PC",
     click **More info**, then **Run anyway**.
   - **Mac:** double-click `Start Scheldemist.command`. If the Mac says it cannot open it, open
     **System Settings > Privacy & Security**, scroll down, click **Open Anyway**, and double-click the
     file again.
   - **Linux:** run `./start-scheldemist.sh`.
4. The game opens in your browser. Keep the small black window open while you play. Close it to stop.

Chrome gives the best speed. Your save is in the `data` folder; to move to a new version, copy `data`
into the new folder. `PLAY.txt` in the download says the same.

**The town's voice (AI).** The game works with no AI at all: the townspeople then use written lines. To let
an AI speak for the town, open the menu (Esc), then **AI setup**, and pick one:

| Choice | What you need |
|---|---|
| Claude, your Claude login | [Claude Code](https://claude.com/claude-code) installed; run `claude` once and log in |
| Claude, API key | a key from console.anthropic.com (paid per call) |
| Codex (GPT) | the Codex CLI installed and logged in |
| Ollama | [Ollama](https://ollama.com) on your computer with a model pulled (free) |
| Any OpenAI-compatible server | its address, model name and key |
| No AI | nothing: walk around |

Press **Test** next to your choice to see if it works. More in `docs/ai-setup.md`.

## Run it from the source (developers)

1. Install Node.js 24 or newer.
2. `npm run setup` once, then `npm run dev` in this folder.
3. Open http://localhost:5173. The server runs on 127.0.0.1:8787; the save is `data/game.sqlite`.

`node tools/package.mjs` makes the player's download for your own system; `docs/release.md` says how a
Release is made. The design notes start at `docs/README.md`.

## Made with AI

Scheldemist is an experiment: the whole game was made by AI, steered by one person. Steve (Sitax)
designed it, played it and decided; Claude (Anthropic's Claude Code, mostly Claude Opus 5.5) wrote the
code, the Blender scripts that build every model, the tests and the docs. Most textures and concept
pictures were made with OpenAI's image tool through Codex. The sounds are CC0 recordings and the fonts
are free fonts made by people (see `assets/ATTRIBUTION.md`); the street plan is traced from the 1873
Vuillaume map.

What it took, up to version 0.1.0 (counted from the Claude Code logs on the main PC):

| | |
|---|---|
| Time | 5 days, 23 to 27 September 2026; about 70 hours with an AI at work |
| Sessions | 37 Claude Code sessions, plus 238 helper agents they started |
| Tokens | about 16 billion processed; most were re-read from the cache, about 190 million were new, and about 11 million were written out |
| Commits | about 300 |

Not counted: the work on the laptop, the Codex runs for the pictures, and the AI calls the game makes
while you play.

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
