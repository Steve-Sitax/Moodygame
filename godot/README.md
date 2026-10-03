# Scheldemist in Godot

The Godot game (Godot 4.7.2, C#, .NET 8). The plan and the decisions: `docs/godot-port.md`. The browser game in
`client/` is the model: a part is ported from its TypeScript, with the same numbers and the same words.

## Run it
1. Once: `npm run setup` in the repo root (the server and the bake need their packages), and a save
   (`data/game.sqlite`: start the server once).
2. Bake the town: `node tools/godot/export-scene.mjs` (about 2 minutes; writes `godot/baked/town.glb`, `town.json`,
   `town_tex/`, 500 MB, not in git). Bake again when the browser's world code changes.
3. Build: `dotnet build godot`.
4. Run: the Godot console program with `--path godot`. Use the real program in the WinGet package folder
   (`...\WinGet\Packages\GodotEngine.GodotEngine.Mono_...\Godot_v4.7.2-stable_mono_win64\Godot_v4.7.2-stable_mono_win64_console.exe`);
   the `godot` link on the PATH fails with ".NET: Assemblies not found".

Options after `--`: `--town <glb>` (or the environment variable `SCHELDEMIST_BAKE`) for a bake somewhere else,
`--shots <dir>` (a picture and the frame time at each baked place, then quit), `--no-<part>` and `--only a,b`
(game parts off).
The server's options: `--server http://127.0.0.1:PORT` (use a server that runs already, start none), `--port N`
(the first port to try; default 8800), `--db <file>` (another save), `--no-ai` (the server makes no model calls:
walk-around mode), `--nettest <dir>` (the net part's own test: start the server with no AI, wait for the first
state, one tick, a picture with the HUD and `nettest.json` in `<dir>`, quit; the server is gone afterwards).
The menus' options: `--prefs <file>` (the settings kept somewhere else than the player's own folder; the keys go
beside it), `--no-mainmenu` (no loading screen and no menus: the town at once, as before), `--menutest <dir>` (the
menus' own test, below). A run with `--shots` or another part's `--...test` has no menus either, and keeps the
picture as it was (720 lines, wobble on) whatever the player's settings say.

## How it is built
- **The baked town** (`src/World/BakedWorld.cs`). The browser game builds its world in code (67,000 lines). The bake
  runs that code and writes the scene it made: every node with its name and place, hidden ones marked, the copies
  of every InstancedMesh, each material's three.js kind and its psx options. Godot loads it at run time. A part
  finds its nodes by the names the TypeScript gave them (`Main.I.World.FindChild("omnibuses", true, false)`).
  What stands still needs no port; what moves or changes is ported and takes its nodes over.
- **The psx material** (`src/Render/Psx.cs`): the browser's `retro/psx.ts`. One shader per set of switches
  (`Psx.Kind`), shared; the rest are uniforms. The values every material reads are global shader uniforms
  (`psx_*` in `project.godot`), set once a frame, like the browser's `psxUniforms`. A new feature is a switch in
  `Kind` or a uniform, not a new shader file.
- **The screen** (`src/Main.cs`, `shaders/retro.gdshader`): the world is drawn at 720 lines into `Main.I.View`,
  then full screen through the retro pass (grade, grain, dither).
- **Game parts** (`src/GamePart.cs`): a Node class with `[GamePart(order)]` is made and added under Main when the
  town is in. A new part is a new file under `src/<Area>/`; it reaches the rest through `Main.I` (`View`, `World`,
  `Cam`, `Ui`, `Arg`). No edits to `Main.cs` for a new part.
- **The server stays in Node** (`server/`): the game talks to it over the same HTTP and WebSocket API as the
  browser (`client/src/net/api.ts`).
  - `src/Net/ServerProcess.cs` starts it with the game (`node src/index.ts` in `server/`, a free port from 8800,
    never 8787 or 5173: Steve's own game) and stops it with the game, its whole process tree (on Windows a job
    object: the server ends even when the game is ended by force). Where Node and the server are is in one place,
    `ServerPaths`: a checkout, or later the download's `runtime/` and `server/` beside the program. Its log:
    `data/godot-server.log`. It does not come up in 90 s: the reason shows on screen.
  - `src/Net/Api.cs` is the client: every call of `api.ts` with a time limit, and the push channel (`/ws`) that
    comes back by itself. `await ServerLink.I.Api.Jobs()` from the main thread goes on on the main thread; the
    push events and `Api.Run(call, ok, fail)` are handed over there too. The payloads are records in
    `src/Net/Payloads.cs` (the server's snake_case names).
  - `src/Net/ServerLink.cs` is the part that holds both (`ServerLink.I.Api`, `ServerLink.I.WhenUp(...)`), feeds
    the store, and asks for the clock's tick every 10 s while Jef plays.
- **The store** (`src/Game/GameState.cs`): what the server last said, for every part: `GameState.I.HourF` (the
  running clock), `.Day`, `.Weekday`, `.Weather`, `.Food` ..., `.Money`, `.Pockets`, with events
  (`ClockChanged`, `WeatherChanged`, `NeedsChanged`, `MoneyChanged`, `Message` ...). `GameState.I` is never null:
  before the server has spoken it holds 13:00 on a clear Monday and `Live` is false. The player's part sets
  `PlayingWhen` (time runs only while Jef plays), the rooms' part `Where` (the cold).
- **The HUD** (`src/Game/Hud.cs`): the browser's papers as Controls under `Main.I.Ui`, the CSS sizes times the
  browser's `--ui`. A line in the middle of the screen: `GameState.I.Say("...")`. Fonts: `Fonts.Hand`,
  `Fonts.Print`, `Fonts.PrintItalic`, `Fonts.Slab`, `Fonts.Mono` (`godot/fonts/`, the browser's own faces).
- **The paper kit** (`src/Ui/`): what every screen of paper and ink is built from, the browser's `menu/menu.css`
  carried over. Sizes are CSS pixels: `Kit.Px(16)` is 16 CSS px at the window's scale (the CSS `--ui`, times the
  Text size setting); a screen builds itself in real pixels and builds again on `Kit.LookChanged`.
  - `Kit` (`Kit.cs`): the colours (`Kit.Paper`, `Kit.Ink`, `Kit.Rust` ...), and the makers of small parts:
    `Kit.Text(...)` a line, `Kit.Rich(...)` a paragraph with bold and italics, `Kit.Para(...)`, `Kit.Heading(...)`,
    `Kit.Row(label, control, note)` a setting's row, `Kit.Side(a, b)` controls side by side, `Kit.Input(...)` a
    text box, `Kit.Rule(width)` the printer's rule, `Kit.DrawCaps(...)` small caps, `Kit.Picture("res://ui/x.jpg")`.
  - `PaperCard`: a piece of paper with its content (kinds: `Plain` the old cards, `Title`, `Sheet`, `Boot`), with
    `Pad(left, top, right, bottom)` and `Tilt`. A Godot container takes a child's turn away: centre a tilted paper
    with `new Centred(card)`, not a CenterContainer.
  - `InkButton`: every button (`Look.Btn`, `Primary`, `Seg`, `Tab`, `MenuItem`, `MenuPlay`, `KeyCap`, `Chip`,
    `ModeCard`, `Swatch`, `Plain`); `Seg` a row of choices; `Tick` on and off; `InkSlider`; `Select` a list to
    pick from; `KeyedText` a paragraph with keys drawn in it (`"{E} use"`).
  - `Sheet`: a paper in the middle with a head, a scrolling `Body` and a `Foot`; `AddBack()` gives "Back [Esc]".
  - `Dialogs`: the stack (`Dialogs.Open(sheet)`, Esc closes the top one, the keys move in it: Up and Down from
    control to control, Left and Right change a choice) and the list of the game's own dialogs
    (`Dialogs.Register("talk", () => open, close: Close)`): while one is up in play the mouse moves the ink quill
    (`InkCursor`) instead of the view, it cannot leave the window, and Esc closes the dialog, not the game.
- **The menus** (`src/Menu/`, the browser's `menu/`, `boot/loader.ts`, `game/pause.ts`, `saves.ts`, `prefs.ts`):
  - `Loading`: the loading screen. Main shows it first, reads the town beside the main thread, and the card follows
    the real steps (the town's file, the scene, the materials counted, the server's first state, the first frames).
  - `MainMenu` (a game part): the handbill, into the game and out of it. `MainMenu.I.Entered`, `.InPlay`, the
    events `WalkedIn` and `WorldReplaced(how, client)` (a save loaded, a new week: every part starts again from
    the server). A part that takes pictures of the bare town runs with `--no-mainmenu`.
  - `Pause`: reasons to be paused ("menu", "key", "saving", "loading"). Paused: the scene tree stands still and the
    server's gate is shut (`POST /api/pause`). A node that must go on sets `ProcessMode = Always`.
  - `Prefs` (the settings, `user://settings.json`), `Keys` (the bindings, `user://keys.json`), `Apply` (what each
    setting does: the list is at the top of `Apply.cs`), `Tuning` (mouse speed, head bob, view distance, bubble
    size, for the parts that use them). Ask for a key by its action: `Keys.Is(e, "use")`, `Keys.Down("forward")`,
    `Keys.Label("use")`.
  - `Saves` (the list, save, load, Continue, autosaves; `Saves.Capture` is the walking part's hook for what a save
    keeps of Jef), `SettingsSheet`, `AiSheet`, `Sheets` (Help, Credits, New game, Quit), `CharacterSheet` with
    `Character.cs` (the port of `shared/character.ts`: keep the two in step). `CharacterSheet.MakePreview` is the
    people's part's hook for the turning figure; until then a flat dummy in the chosen colours stands there.
  - The test: `-- --no-ai --port 8953 --db <dir>/menutest.sqlite --prefs <dir>/settings.json --menutest <dir>`
    walks through every screen by script, checks what each step did, saves a picture of each and `menutest.json`,
    and quits (1 when a check failed). The browser's pictures to lay beside them:
    `node tools/godot/menu-refs.mjs --out godot/baked/menu-ref`.

## Rules
- The engine owns all numbers; the Godot game shows them and asks the server, as the browser does.
- Colour: three.js gives a matt face `colour x intensity / pi`; Godot gives `colour x energy`. A three.js light of
  intensity I is a Godot light of energy I / pi. Hex colours are sRGB: `.SrgbToLinear()` before a shader gets them.
- three.js and Godot share the axes (y up, -z ahead, metres): positions and quaternions carry over as they are.
- Light counts do not change at run time (dim with energy 0), as in `docs/rendering.md`.
- Every step ends with a run: a picture looked at, and the frame time at the baked places (`--shots`). The budget
  is 16.7 ms a frame on PCX with everything on.
- Comments say what the code is for, in the plain English of the rest of the repo; name the TypeScript file a part
  comes from.
