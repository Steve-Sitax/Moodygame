using System;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Ui;

namespace Scheldemist.Menu;

/// <summary>
/// The handbill's small sheets (the browser's menu/menu.ts): Help, Credits, A new game, Quit to title, and (a
/// program's own) Leave the game.
/// </summary>
public static class Sheets
{
    private static string K(string id) => KeyedText.Key(Keys.Label(id));

    /// <summary>Two columns of short pieces (the CSS .cols): each a heading and its paragraphs.</summary>
    private static void Columns(Sheet s, (string head, string[] paras)[] left, (string head, string[] paras)[] right)
    {
        var cols = new HBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        cols.AddThemeConstantOverride("separation", Kit.Px(34));
        foreach (var side in new[] { left, right })
        {
            var col = new VBoxContainer { SizeFlagsHorizontal = Control.SizeFlags.ExpandFill, MouseFilter = Control.MouseFilterEnum.Ignore };
            col.AddThemeConstantOverride("separation", 0);
            bool first = true;
            foreach (var (head, paras) in side)
            {
                var h = Kit.Heading(head);
                if (h is MarginContainer mc) mc.AddThemeConstantOverride("margin_top", Kit.Px(first ? 2 : 10));
                first = false;
                col.AddChild(h);
                foreach (string p in paras)
                {
                    var m = new MarginContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
                    m.AddThemeConstantOverride("margin_top", Kit.Px(4));
                    m.AddThemeConstantOverride("margin_bottom", Kit.Px(5));
                    m.AddChild(p.StartsWith("@") ? Sample(p) : new KeyedText(p) { CssSize = 15.5f });
                    col.AddChild(m);
                }
            }
            cols.AddChild(col);
        }
        s.Body.AddChild(cols);
    }

    /// <summary>Credits: a line set in the face it names ("@hand Kalam, by ...").</summary>
    private static Control Sample(string p)
    {
        int sp = p.IndexOf(' ');
        string face = p[1..sp], text = p[(sp + 1)..];
        Font f = face switch { "hand" => Fonts.Hand, "slab" => Fonts.Slab, "mono" => Fonts.Mono, "small" => Fonts.Print, _ => Fonts.Print };
        return face == "small" ? Kit.Text(text, f, 13, Kit.InkSoft, true) : Kit.Text(text, f, 19, Kit.Ink, true);
    }

    public static void Help()
    {
        var s = new Sheet("Help", "A newcomer's guide");
        Columns(s,
            new[]
            {
                ("Where to start", new[]
                {
                    "You are Jef, new in Antwerp with fifty centimes and a bed at the doss house. Walk to the Rijnkaai: the job board stands on the quay. Work, eat, keep warm, and pay your rent by Sunday.",
                    $"The paper map ({K("map")}) shows the town and where you are. Ask people: anyone in the street will talk.",
                }),
                ("The keys", new[]
                {
                    $"{K("forward")}{K("left")}{K("back")}{K("right")} walk, {K("hurry")} hurry, {K("crouch")} crouch, {K("jump")} jump (hold to climb onto or over a reachable obstacle), the mouse to look.",
                    $"{K("use")} does the first thing the hint on screen offers; {K("second")}, {K("third")} and {K("fourth")} the others. {K("pockets")} pockets, {K("lantern")} lantern, {K("pause")} pause, {{Esc}} this menu.",
                    $"In a talk: the digits pick an answer, {K("talk")} lets you say your own words, {K("buy")} buys, {K("haggle")} haggles or says goodbye.",
                }),
                ("Jobs", new[]
                {
                    $"The board on the quay has the day's work; a new board goes up at midnight. The naties hire day men at their gates at dawn. Carry, watch, deliver: take a job ({K("use")}), do it, and bring the proof back for your pay. Some jobs change on the way: a thief, a bribe, thick fog.",
                }),
            },
            new[]
            {
                ("Needs", new[]
                {
                    "Food, warmth, sleep and health, in the corner. Food falls through the day: bread, herring or a meal fill it. Warmth goes in the cold and the rain: a coat, a fire, a warm bed. Sleep in a bed (the doss house, or a room you rent) at any hour, for as long as you choose; a bench will do, but you rest less and the cold gets into your coat. A need at 2 or less is marked, and costs you.",
                }),
                ("Money and rent", new[]
                {
                    "Money is in centimes: 100 make a franc, and a good day on the docks pays two or three. The rent of your bed is due every Sunday: no rent, no bed, and a night on the quay costs health. The pawnshop lends on what you carry.",
                }),
                ("The night and saving", new[]
                {
                    $"The clock runs on through the night: the day's employers go home, a lamp burns at their quest box, and other men offer other work. The game saves itself every game hour and when you leave; {K("pause")} or {{Esc}} stops the town.",
                }),
            });
        s.Foot.AddChild(Kit.Spring());
        s.AddBack();
        Dialogs.Open(s);
    }

    // HOOK (licence 2026-09-26): the game is AGPL-3.0-or-later and its server serves it over a network, so
    // AGPL section 13 asks us to offer every player the source. Keep this address in the credits (see LICENSE).
    private const string SourceUrl = "https://github.com/Steve-Sitax/Moodygame";

    public static void Credits()
    {
        var s = new Sheet("Credits", "Printed and made by");
        Columns(s,
            new[]
            {
                ("Scheldemist", new[]
                {
                    "Antwerp, the Rijnkaai, October 1873. Designed by Steve (Sitax); built by Steve with Claude, Anthropic's model, which also speaks for the townspeople. Some pictures and small texts are made with OpenAI's Codex from our own prompts.",
                }),
                ("Type", new[]
                {
                    "@hand Kalam, by the Indian Type Foundry",
                    "@print Old Standard TT, by Alexey Kryukov",
                    "@slab Alfa Slab One, by JM Solé",
                    "@mono Courier Prime, by Alan Dague-Greene",
                    "@small All under the SIL Open Font License 1.1, through the Fontsource packages.",
                }),
                ("Sound", new[]
                {
                    "Recordings from Kenney's Impact Sounds, BigSoundBank (Joseph Sardin) and the Freesound community (craigsmith, Robo9418, v23, Sojan, ldezem, xkeril and others), all CC0. Voices, wind, water and the organ are made in code.",
                }),
            },
            new[]
            {
                ("The map", new[]
                {
                    "The town is traced from the 1873 plan of Antwerp by Vuillaume (FelixArchief, via Wikimedia Commons, CC0), with landmark outlines from OpenStreetMap (© OpenStreetMap contributors, ODbL).",
                }),
                ("Code", new[]
                {
                    "Godot Engine (MIT) with .NET; the town is built by the browser game's three.js code (MIT) and Google Draco (Apache-2.0); on the server Hono, ws, better-sqlite3 and Zod (MIT), and the Claude Agent SDK.",
                    $"Scheldemist is free software under the GNU AGPL, version 3 or later. Source: {SourceUrl.Replace("https://", "")}",
                }),
                ("The rest", new[]
                {
                    "Models are our own, built in Blender by our scripts; textures painted in code or made for the game. The full list of every asset and its licence: assets/ATTRIBUTION.md.",
                }),
            });
        s.Foot.AddChild(Kit.Spring());
        s.AddBack();
        Dialogs.Open(s);
    }

    /// <summary>menu.ts "new": a character first (CharacterSheet), then the new week.</summary>
    public static void NewGame(MainMenu menu)
    {
        var s = new Sheet("A new game", "", 560, false);
        s.Body.AddChild(Kit.Para("Start a new week in Antwerp: a new town, Jef back at the doss house with his fifty centimes.", 18));
        s.Body.AddChild(Kit.Para("Your saves are kept: you can load any of them later."));
        var msg = Kit.Text("", Fonts.Hand, 15, Kit.Rust, true);
        msg.CustomMinimumSize = new Vector2(0, Kit.Px(20));
        s.Body.AddChild(msg);
        s.Foot.AddChild(Kit.Spring());
        s.AddBack();
        s.Foot.AddChild(new InkButton(InkButton.Look.Primary, "Start a new week", () =>
        {
            // the new week starts once the character is made; cancelled: back to this sheet
            Dialogs.Close(s);
            CharacterSheet.Open(_ => StartNewWeek(menu), () => NewGame(menu));
        }) { Name = "newgame" });
        Dialogs.Open(s);
    }

    /// <summary>menu.ts startNewWeek: the server makes a new town; every part starts again from it.</summary>
    public static void StartNewWeek(MainMenu menu, Action<string>? done = null)
    {
        var api = ServerLink.I?.Api;
        if (api == null)
        {
            GameState.I.Say("Could not start a new week (the game server does not answer).");
            done?.Invoke("no server");
            return;
        }
        Pause.Set("loading", true);
        var card = new Control { MouseFilter = Control.MouseFilterEnum.Stop, ProcessMode = Node.ProcessModeEnum.Always, ZIndex = 20 };
        card.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        var dim = new ColorRect { Color = new Color(0.031f, 0.035f, 0.039f, 0.5f), MouseFilter = Control.MouseFilterEnum.Ignore };
        dim.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        card.AddChild(dim);
        card.AddChild(MainMenu.Centre(MainMenu.PlainCard("A new week", "Starting a new week...")));
        Main.I.Ui.AddChild(card);
        api.Run(api.Call<JobsPayload>(System.Net.Http.HttpMethod.Post, "api/new-game", null, 60_000), p =>
        {
            card.QueueFree();
            GameState.I.Apply(p);
            menu.Replaced("new", null);
            menu.ToTitle();
            menu.Saves.Refresh();
            done?.Invoke("new week");
        }, e =>
        {
            card.QueueFree();
            Pause.Set("loading", false);
            GameState.I.Say($"Could not start a new week ({e.Message}).");
            done?.Invoke($"failed: {e.Message}");
        });
    }

    public static void Quit(MainMenu menu)
    {
        var s = new Sheet("Quit to title", "", 560, false);
        s.Body.AddChild(Kit.Para("Back to the first page. The game is saved as it stands (the autosave), so Continue brings you back here.", 18));
        s.Foot.AddChild(Kit.Spring());
        s.AddBack();
        s.Foot.AddChild(new InkButton(InkButton.Look.Primary, "Quit to title", () =>
        {
            Dialogs.Close(s);
            QuitToTitle(menu);
        }) { Name = "quit" });
        Dialogs.Open(s);
    }

    /// <summary>The game is saved as it stands, then the first page (the browser reloads its page, which autosaves on the way out).</summary>
    public static void QuitToTitle(MainMenu menu, Action? done = null)
    {
        menu.Saves.Autosave(false, _ =>
        {
            menu.ToTitle();
            menu.Saves.Refresh();
            done?.Invoke();
        });
    }

    /// <summary>A program's own: close the game (saved first when it was entered).</summary>
    public static void Leave(MainMenu menu)
    {
        var s = new Sheet("Leave the game", "", 560, false);
        s.Body.AddChild(Kit.Para(menu.Entered ? "Close Scheldemist. The game is saved as it stands (the autosave), so Continue brings you back here." : "Close Scheldemist.", 18));
        s.Foot.AddChild(Kit.Spring());
        s.AddBack();
        s.Foot.AddChild(new InkButton(InkButton.Look.Primary, "Leave", () =>
        {
            Dialogs.Close(s);
            menu.Saves.Autosave(false, _ => menu.GetTree().Quit());
        }) { Name = "leave" });
        Dialogs.Open(s);
    }
}
