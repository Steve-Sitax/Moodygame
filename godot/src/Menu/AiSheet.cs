using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Ui;

namespace Scheldemist.Menu;

/// <summary>
/// The AI setup sheet (the browser's menu/ai.ts; the contract: docs/ai-setup.md): AI on or walk-around mode, an AI
/// for every kind of work (a default, and one per kind where the player wants another), a Test button beside each,
/// where the player's typed lines go, the connections (keys and addresses), and a guide. Drawn from the server's
/// own description (GET /api/ai/config); every change goes to the server (PUT) and the sheet is drawn again from
/// its answer. A key typed here goes to the server once and never comes back: the sheet shows "set, ends in abcd".
/// </summary>
public static class AiSheet
{
    private static Sheet? sheet;
    private static JsonElement view;
    private static bool have;
    private static string msg = "";
    private static string? helpFor;
    private static bool guideOpen, guideSet;
    /// <summary>Test results by target ("default", a kind, "all"): the server's list, "testing", or what went wrong.</summary>
    private static readonly Dictionary<string, object> results = new();
    private static readonly Dictionary<string, string> typedModel = new();
    private static readonly Dictionary<string, LineEdit> conn = new();

    /// <summary>The sheet is up and drawn from the server's description.</summary>
    public static bool Shown => sheet != null && Dialogs.IsOpen(sheet) && have;
    public static string Mode => have ? S(view, "mode") : "";
    public static string Status => have && view.TryGetProperty("status", out var s) ? $"{S(s, "title")}. {S(s, "text")}" : "";

    private static readonly Dictionary<string, string> Cost = new() { ["plan"] = "on your plan", ["paid"] = "paid per call", ["local"] = "free, on this PC", ["none"] = "nothing" };

    private static string S(JsonElement e, string k) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
    private static bool B(JsonElement e, string k) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.True;
    private static JsonElement? O(JsonElement e, string k) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out var v) && v.ValueKind != JsonValueKind.Null ? v : null;
    private static IEnumerable<JsonElement> A(JsonElement e, string k) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Array ? v.EnumerateArray() : Enumerable.Empty<JsonElement>();

    public static void Open()
    {
        msg = "";
        have = false;
        guideSet = false;
        Draw();
        var api = ServerLink.I?.Api;
        var s = sheet;
        if (api == null)
        {
            Unreachable("the game server does not answer");
            return;
        }
        api.Run(api.AiConfig(), v =>
        {
            if (sheet != s) return;
            view = v;
            have = true;
            Draw();
        }, e =>
        {
            if (sheet == s) Unreachable(e.Message);
        });
    }

    private static void Unreachable(string why)
    {
        if (sheet == null) return;
        foreach (var c in sheet.Body.GetChildren()) c.QueueFree();
        sheet.Body.AddChild(Kit.Para($"The AI settings cannot be reached just now ({why}). Is the game's server running?", 16, true));
    }

    private static JsonElement? Provider(string id) => have ? A(O(view, "options") ?? default, "providers").Where(p => S(p, "id") == id).Cast<JsonElement?>().FirstOrDefault() : null;

    private static void Put(Dictionary<string, object?> patch, string done = "")
    {
        var api = ServerLink.I?.Api;
        var s = sheet;
        if (api == null) return;
        api.Run(api.PutAiConfig(patch), v =>
        {
            view = v;
            have = true;
            msg = done;
            MainMenu.I?.RefreshAiNote();
            if (sheet == s) Draw();
        }, e =>
        {
            msg = $"Not saved: {e.Message}";
            if (sheet == s) Draw();
        });
    }

    private static void Test(string key)
    {
        var api = ServerLink.I?.Api;
        var s = sheet;
        if (api == null) return;
        var body = key == "all" ? new Dictionary<string, object?> { ["all"] = true } : key == "default" ? new Dictionary<string, object?> { ["choice"] = view.GetProperty("default") } : new Dictionary<string, object?> { ["kind"] = key };
        results[key] = "testing";
        Draw();
        api.Run(api.AiTest(body), r =>
        {
            results[key] = A(r, "results").Select(x => x.Clone()).ToList();
            if (sheet == s) Draw();
        }, e =>
        {
            results[key] = $"The test did not run: {e.Message}";
            if (sheet == s) Draw();
        });
    }

    /// <summary>The choice now at `key` ("default" or a kind), as the server has it: null for "Same as the default".</summary>
    private static JsonElement? ChoiceAt(string key)
    {
        if (key == "default") return view.GetProperty("default");
        var k = O(O(view, "kinds") ?? default, key);
        return k is { ValueKind: JsonValueKind.Object } ? k : null;
    }

    private static Dictionary<string, object?> PatchChoice(string key, object? choice) => key == "default"
        ? new Dictionary<string, object?> { ["default"] = choice ?? "default" }
        : new Dictionary<string, object?> { ["kinds"] = new Dictionary<string, object?> { [key] = choice ?? "default" } };

    private static Dictionary<string, object?> Choice(string provider, string? model = null, string? effort = null)
    {
        var c = new Dictionary<string, object?> { ["provider"] = provider };
        if (!string.IsNullOrEmpty(model)) c["model"] = model;
        if (!string.IsNullOrEmpty(effort)) c["effort"] = effort;
        return c;
    }

    /// <summary>For a test: press one of the sheet's buttons by its job ("mode" "walk", "typed" "same", "recommended").</summary>
    public static void Press(string what, string val = "")
    {
        if (!have) return;
        switch (what)
        {
            case "mode":
                Put(new Dictionary<string, object?> { ["mode"] = val }, val == "walk" ? "Walk-around mode: no AI is called." : "AI on.");
                break;
            case "typed":
                Put(new Dictionary<string, object?> { ["typedLines"] = val });
                break;
            case "recommended":
                Put(new Dictionary<string, object?>
                {
                    ["default"] = Choice("recommended"),
                    ["kinds"] = A(O(view, "options") ?? default, "kinds").ToDictionary(k => S(k, "id"), _ => (object?)"default"),
                }, "The recommended mix, for every kind.");
                break;
        }
    }

    // ------------------------------------------------------------------ drawing

    private static void Draw()
    {
        int scroll = 0;
        bool again = sheet != null && Dialogs.IsOpen(sheet);
        if (again)
        {
            scroll = sheet!.Scroll.ScrollVertical;
            var old = sheet;
            sheet = null;
            Dialogs.Close(old);
        }
        var s = new Sheet("AI setup", "Who writes the town's words");
        sheet = s;
        conn.Clear();
        var body = s.Body;
        if (!have) body.AddChild(Kit.Para("Asking the town...", 16, true));
        else Fill(body, s);
        s.Foot.AddChild(Kit.Spring());
        s.AddBack();
        Dialogs.Open(s, () =>
        {
            if (sheet == s) sheet = null;
        });
        if (again) Callable.From(() =>
        {
            if (sheet == s) s.Scroll.ScrollVertical = scroll;
        }).CallDeferred();
    }

    private static void Fill(VBoxContainer body, Sheet s)
    {
        var v = view;
        var options = v.GetProperty("options");
        bool walk = S(v, "mode") == "walk";
        var walkOpt = options.GetProperty("walk");
        float half = (s.BodyWidth - Kit.Px(12)) / 2;

        // .ai-mode: AI on, or walk around
        var modes = new HBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        modes.AddThemeConstantOverride("separation", Kit.Px(12));
        modes.AddChild(new InkButton(InkButton.Look.ModeCard, "AI on", () => Press("mode", "ai")) { Sub = "The townspeople answer in their own words; the director plans the day.", On = !walk, WrapWidth = half / Kit.Scale - 28, Name = "mode_ai" });
        modes.AddChild(new InkButton(InkButton.Look.ModeCard, S(walkOpt, "label"), () => Press("mode", "walk")) { Sub = S(walkOpt, "text"), On = walk, WrapWidth = half / Kit.Scale - 28, Name = "mode_walk" });
        body.AddChild(Pad(modes, 6, 8));
        var status = v.GetProperty("status");
        body.AddChild(Kit.Rich($"[b]{Kit.Esc(S(status, "title"))}.[/b] {Kit.Esc(S(status, "text"))}", 15, Kit.InkSoft));
        if (msg != "") body.AddChild(Pad(Kit.Text(msg, Fonts.Hand, 15, Kit.Rust, true), 6, 0));

        // .ai-kinds: greyed in walk-around mode
        var kinds = new VBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore, Modulate = new Color(1, 1, 1, walk ? 0.45f : 1) };
        kinds.AddThemeConstantOverride("separation", 0);
        body.AddChild(kinds);
        var def = v.GetProperty("default");
        var defP = Provider(S(def, "provider"));
        kinds.AddChild(Kit.Heading("The default"));
        kinds.AddChild(Kit.Row("Every kind of work, unless set below", Kit.Side(ChoiceControls("default", def, false).Append(TestButton("default")).ToArray()), defP is { } dp ? S(dp, "short") : ""));
        Results(kinds, "default");
        kinds.AddChild(Kit.Heading("By kind of work"));
        foreach (var k in A(options, "kinds"))
        {
            string id = S(k, "id");
            var eff = O(O(v, "effective") ?? default, id);
            kinds.AddChild(Kit.Row(S(k, "label"), Kit.Side(ChoiceControls(id, ChoiceAt(id), true).Append(TestButton(id)).ToArray()), $"{S(k, "what")} Now: {(eff is { } e ? S(e, "label") : "")}."));
            Results(kinds, id);
        }

        // where the player's typed lines go
        if (O(options, "typedLines") is { } t && S(v, "typedLines") != "")
        {
            kinds.AddChild(Kit.Heading(S(t, "label")));
            var cards = new HBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
            cards.AddThemeConstantOverride("separation", Kit.Px(12));
            foreach (var o in A(t, "values"))
            {
                string id = S(o, "id");
                cards.AddChild(new InkButton(InkButton.Look.ModeCard, S(o, "label"), () => Press("typed", id)) { Sub = S(o, "text"), On = S(v, "typedLines") == id, Small = true, WrapWidth = half / Kit.Scale - 28, Name = "typed_" + id });
            }
            kinds.AddChild(Pad(cards, 6, 8));
            kinds.AddChild(Kit.Para($"{S(t, "what")} {S(t, "privacy")}", 16, true));
        }

        var btns = new HBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        btns.AddThemeConstantOverride("separation", Kit.Px(10));
        btns.AddChild(new InkButton(InkButton.Look.Btn, "Test all", () => Test("all")) { Name = "testAll" });
        btns.AddChild(new InkButton(InkButton.Look.Btn, "Use the recommended mix", () => Press("recommended")) { Name = "recommended" });
        kinds.AddChild(Pad(btns, 12, 4));
        Results(kinds, "all");

        // the connections
        kinds.AddChild(Kit.Heading("Connections"));
        var c = v.GetProperty("connections");
        kinds.AddChild(KeyField("anthropic_api", "Anthropic API key", c.GetProperty("anthropic_api").GetProperty("apiKey")));
        kinds.AddChild(UrlField("openai_url", "openai_compat", "OpenAI-compatible server", "OpenAI, OpenRouter, LM Studio, llama.cpp or vLLM: its address, ending in /v1.", S(c.GetProperty("openai_compat"), "baseUrl")));
        kinds.AddChild(KeyField("openai_compat", "Its key (if it wants one)", c.GetProperty("openai_compat").GetProperty("apiKey")));
        kinds.AddChild(UrlField("ollama_url", "ollama", "Ollama on this PC", "Where Ollama listens.", S(c.GetProperty("ollama"), "baseUrl")));
        if (walk) Disable(kinds);

        // .ai-guide: how to use it, and each AI in a few lines
        var guide = options.GetProperty("guide");
        if (!guideSet)
        {
            guideSet = true;
            guideOpen = !B(v, "saved");
        }
        var box = new PanelContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        box.AddThemeStyleboxOverride("panel", Kit.Box(Kit.Wash(0.2f), Kit.InkFaint, 1, 0, 12, 8));
        var gcol = new VBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        gcol.AddThemeConstantOverride("separation", 0);
        box.AddChild(gcol);
        var summary = new InkButton(InkButton.Look.Tab, (guideOpen ? "▾ " : "▸ ") + S(guide, "title"), () =>
        {
            guideOpen = !guideOpen;
            Draw();
        }) { SizeFlagsHorizontal = Control.SizeFlags.ShrinkBegin, Name = "guide" };
        gcol.AddChild(summary);
        if (guideOpen)
        {
            foreach (var p in A(guide, "paragraphs")) gcol.AddChild(Kit.Para(p.GetString() ?? "", 15));
            var shown = Provider(helpFor ?? S(def, "provider")) ?? defP;
            var pick = new HFlowContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
            pick.AddThemeConstantOverride("h_separation", Kit.Px(6));
            pick.AddThemeConstantOverride("v_separation", Kit.Px(6));
            pick.AddChild(Kit.Text("About:", Fonts.PrintItalic, 14, Kit.Ink));
            foreach (var p in A(options, "providers"))
            {
                string id = S(p, "id");
                pick.AddChild(new InkButton(InkButton.Look.Chip, S(p, "label"), () =>
                {
                    helpFor = id;
                    Draw();
                }) { On = shown is { } sh && S(sh, "id") == id, Name = "help_" + id });
            }
            gcol.AddChild(Pad(pick, 8, 8));
            if (shown is { } hp) gcol.AddChild(Help(hp));
        }
        body.AddChild(Pad(box, 14, 4));
    }

    private static Control Pad(Control c, float top, float bottom)
    {
        var m = new MarginContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        m.AddThemeConstantOverride("margin_top", Kit.Px(top));
        m.AddThemeConstantOverride("margin_bottom", Kit.Px(bottom));
        m.AddChild(c);
        return m;
    }

    /// <summary>Walk-around mode: the pickers are there to read, not to use (the CSS fieldset[disabled]).</summary>
    private static void Disable(Node n)
    {
        foreach (var c in n.GetChildren())
        {
            if (c is BaseButton b) b.Disabled = true;
            if (c is LineEdit e) e.Editable = false;
            if (c is Control k && c is BaseButton or LineEdit or InkSlider) k.FocusMode = Control.FocusModeEnum.None;
            Disable(c);
        }
    }

    private static InkButton TestButton(string key) => new(InkButton.Look.Btn, "Test", () => Test(key)) { Small = true, Name = "test_" + key };

    /// <summary>The provider, model and effort pickers of one choice.</summary>
    private static List<Control> ChoiceControls(string key, JsonElement? c, bool allowDefault)
    {
        var o = new List<Control>();
        var options = view.GetProperty("options");
        var avail = view.GetProperty("available");
        string cur = c is { } cc ? S(cc, "provider") : "default";
        var list = new List<(string, string)>();
        if (allowDefault) list.Add(("default", "Same as the default"));
        foreach (var p in A(options, "providers"))
        {
            string id = S(p, "id");
            bool missing = (id == "claude_local" && avail.TryGetProperty("claude_local", out var cl) && cl.ValueKind == JsonValueKind.False) || (id == "codex_cli" && !B(avail, "codex_cli"));
            list.Add((id, S(p, "label") + (missing ? " (not found)" : "")));
        }
        o.Add(new Select(list.ToArray(), cur, val =>
        {
            if (val == "default")
            {
                Put(PatchChoice(key, null));
                return;
            }
            helpFor = val;
            var p = Provider(val);
            Put(PatchChoice(key, Choice(val, p is { } pp ? S(pp, "defaultModel") : null)));
        }, 230) { Name = "provider_" + key });
        if (c is not { } ch || Provider(cur) is not { } prov) return o;
        string model = S(ch, "model"), effort = S(ch, "effort");
        var models = A(prov, "models").ToList();
        bool free = B(prov, "freeModel");
        bool known = models.Any(m => S(m, "id") == model);
        bool own = typedModel.ContainsKey(key);
        if (models.Count > 0)
        {
            var ml = models.Select(m => (S(m, "id"), S(m, "label"))).ToList();
            if (free) ml.Add(("__own", "Another model..."));
            o.Add(new Select(ml.ToArray(), known && !own ? model : free ? "__own" : model, val =>
            {
                if (val == "__own")
                {
                    // an own model name: the text box comes, the choice is saved when it is typed
                    typedModel[key] = "";
                    Draw();
                    return;
                }
                typedModel.Remove(key);
                Put(PatchChoice(key, Choice(cur, val, effort)));
            }, 230) { Name = "model_" + key });
        }
        if (free && (!known || models.Count == 0 || own))
        {
            var box = Kit.Input(known ? "" : model, 220, true, false, S(prov, "modelHint") is { Length: > 0 } h ? h : "model name");
            box.Name = "modelText_" + key;
            box.TextSubmitted += t =>
            {
                if (t.Trim() == "") return;
                typedModel.Remove(key);
                Put(PatchChoice(key, Choice(cur, t.Trim())));
            };
            box.FocusExited += () =>
            {
                if (box.Text.Trim() != "" && box.Text.Trim() != model) Put(PatchChoice(key, Choice(cur, box.Text.Trim())));
            };
            o.Add(box);
        }
        var m0 = models.Where(m => S(m, "id") == model).Cast<JsonElement?>().FirstOrDefault();
        if (B(prov, "effort") && m0 is { } mm && B(mm, "effort"))
        {
            var efforts = A(options, "efforts").Select(e => (e.GetString() ?? "", e.GetString() ?? "")).ToArray();
            o.Add(new Seg(efforts, effort == "" ? "medium" : effort, val => Put(PatchChoice(key, Choice(cur, model, val))), true) { Name = "effort_" + key });
        }
        return o;
    }

    /// <summary>ai.ts resultHtml: what a test came to, under its row.</summary>
    private static void Results(VBoxContainer into, string key)
    {
        if (!results.TryGetValue(key, out object? r)) return;
        Control line;
        if (r is string s) line = s == "testing" ? Kit.Text("Asking... (20 seconds at most)", Fonts.PrintItalic, 14, Kit.InkSoft, true) : Kit.Text(s, Fonts.Print, 14, Kit.Bad, true);
        else
        {
            var col = new VBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
            foreach (var t in (List<JsonElement>)r)
            {
                bool ok = B(t, "ok");
                double ms = t.TryGetProperty("ms", out var m) && m.ValueKind == JsonValueKind.Number ? m.GetDouble() : 0;
                string model = S(t, "model"), said = S(t, "line"), note = S(t, "note");
                string text = $"[color=#{(ok ? Kit.Good : Kit.Bad).ToHtml(false)}][b]{(ok ? "✓" : "✗")}[/b][/color] [b]{Kit.Esc(S(t, "label"))}[/b]"
                    + (model != "" ? $" [color=#{Kit.InkSoft.ToHtml(false)}][code]{Kit.Esc(model)}[/code][/color]" : "") + ": "
                    + (ok ? $"answered in {ms / 1000:0.0} s" + (said != "" ? $": “{Kit.Esc(said)}”" : "") : Kit.Esc(S(t, "error") is { Length: > 0 } er ? er : "no answer"))
                    + (note != "" ? $" [i]{Kit.Esc(note)}[/i]" : "");
                col.AddChild(Kit.Rich(text, 14, ok ? Kit.Ink : Kit.Bad));
            }
            line = col;
        }
        var mgn = new MarginContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        mgn.AddThemeConstantOverride("margin_left", Kit.Px(18));
        mgn.AddThemeConstantOverride("margin_top", Kit.Px(2));
        mgn.AddThemeConstantOverride("margin_bottom", Kit.Px(6));
        mgn.AddChild(line);
        into.AddChild(mgn);
    }

    private static Control KeyField(string name, string label, JsonElement st)
    {
        bool set = B(st, "set");
        var input = Kit.Input("", 220, true, true, set ? "(unchanged)" : "paste the key");
        input.Name = "conn_" + name;
        conn[name] = input;
        var parts = new List<Control>
        {
            input,
            new InkButton(InkButton.Look.Btn, "Save", () =>
            {
                string k = input.Text.Trim();
                if (k == "") return;
                // the key leaves the box at once: it goes to the server and is never shown again
                input.Text = "";
                Put(new Dictionary<string, object?> { ["connections"] = new Dictionary<string, object?> { [name] = new Dictionary<string, object?> { ["apiKey"] = k } } }, "The key is saved on this PC.");
            }) { Small = true, Name = "saveKey_" + name },
        };
        if (set) parts.Add(new InkButton(InkButton.Look.Btn, "Remove", () => Put(new Dictionary<string, object?> { ["connections"] = new Dictionary<string, object?> { [name] = new Dictionary<string, object?> { ["apiKey"] = null } } }, "The key is removed.")) { Small = true, Name = "clearKey_" + name });
        string last4 = S(st, "last4");
        return Kit.Row(label, Kit.Side(parts.ToArray()), (set ? $"Set, ends in {(last4 == "" ? "????" : last4)}. Type a new one to change it." : "Not set.") + " Kept only on this PC, never shown again.");
    }

    private static Control UrlField(string name, string which, string label, string note, string value)
    {
        var input = Kit.Input(value, 220, true);
        input.Name = "conn_" + name;
        var save = new InkButton(InkButton.Look.Btn, "Save", () => Put(new Dictionary<string, object?> { ["connections"] = new Dictionary<string, object?> { [which] = new Dictionary<string, object?> { ["baseUrl"] = input.Text.Trim() } } }, "The address is saved.")) { Small = true, Name = "saveUrl_" + name };
        return Kit.Row(label, Kit.Side(input, save), note);
    }

    /// <summary>ai.ts helpHtml: one AI in a few lines: what it is, what you need, the cost, the privacy, your typed lines.</summary>
    private static Control Help(JsonElement p)
    {
        var col = new VBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        col.AddThemeConstantOverride("separation", Kit.Px(3));
        var head = new HBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        head.AddThemeConstantOverride("separation", Kit.Px(6));
        head.AddChild(Kit.Text(S(p, "label"), Fonts.PrintBold, 18, Kit.Ink));
        var cost = Kit.Text(Cost.GetValueOrDefault(S(p, "cost"), ""), Fonts.PrintItalic, 13, Kit.InkSoft);
        cost.SizeFlagsVertical = Control.SizeFlags.ShrinkEnd;
        head.AddChild(cost);
        col.AddChild(head);
        var help = p.GetProperty("help");
        var grid = new GridContainer { Columns = 2, MouseFilter = Control.MouseFilterEnum.Ignore };
        grid.AddThemeConstantOverride("h_separation", Kit.Px(12));
        grid.AddThemeConstantOverride("v_separation", Kit.Px(3));
        foreach (var (dt, dd) in new[] { ("What", S(help, "what")), ("You need", S(help, "need")), ("Cost", S(help, "cost")), ("Privacy", S(help, "privacy")), ("Your typed lines", S(p, "typedLines")) })
        {
            var t = new CapsText { Text = dt, CustomMinimumSize = new Vector2(Kit.Px(130), 0) };
            grid.AddChild(t);
            grid.AddChild(Kit.Text(dd, Fonts.Print, 14.5f, Kit.Ink, true));
        }
        col.AddChild(grid);
        return col;
    }
}

/// <summary>A short label in small caps (the CSS dt).</summary>
public partial class CapsText : Control
{
    public string Text = "";
    public float CssSize = 14.5f;
    public Color? Colour;
    public override Vector2 _GetMinimumSize() => new(CustomMinimumSize.X, Fonts.Print.GetHeight(Kit.Px(CssSize)));
    public override void _Draw() => Kit.DrawCaps(this, Fonts.Print, Vector2.Zero, Text, Kit.Px(CssSize), Colour ?? Kit.InkSoft);
}
