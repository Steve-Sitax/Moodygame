using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Talks;
using Scheldemist.Town;
using Scheldemist.Ui;

namespace Scheldemist.Menu;

/// <summary>
/// --aiswitchtest &lt;dir&gt; (2026-11-02): the menu's AI switch in play. Walks in, opens the Esc menu, and turns AI
/// off and on with the menu item; after each turn the server's state, a resident's talk ("free": may type) and the
/// talk box are checked, with pictures. --aiswitch-expect says what the start must show: "ready" (a working provider),
/// "no_login" (AI on without a login: the note points to AI setup) or "off" (after a restart that ended with AI off).
/// Runs on its own data folder and settings; its AI config is the test's own file next to its database.
/// </summary>
[GamePart(212)]
public partial class AiSwitchTest : Node
{
    private string dir = "";
    private readonly List<Dictionary<string, object?>> steps = new();
    private readonly List<string> failed = new();
    private int shot;

    public AiSwitchTest() => ProcessMode = ProcessModeEnum.Always;

    public override void _Ready()
    {
        dir = Paths.TestOutput("aiswitchtest");
        if (dir == "") return;
        Directory.CreateDirectory(dir);
        _ = Run();
    }

    private async Task Wait(double s) => await ToSignal(GetTree().CreateTimer(s, true, false, true), SceneTreeTimer.SignalName.Timeout);
    private async Task<bool> Until(Func<bool> ok, double s)
    {
        for (double left = s; !ok(); left -= 0.1) { if (left <= 0) return false; await Wait(0.1); }
        return true;
    }
    private async Task Shot(string name)
    {
        await Wait(0.4);
        await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
        string file = $"{++shot:00}-{name}.png";
        GetViewport().GetTexture().GetImage().SavePng(Path.Combine(dir, file));
        steps.Add(new() { ["picture"] = file });
    }
    private void Note(string what, object? got = null, bool? ok = null)
    {
        var d = new Dictionary<string, object?> { ["step"] = what };
        if (got != null) d["got"] = got;
        if (ok != null) d["ok"] = ok;
        steps.Add(d);
        if (ok == false) failed.Add(what);
        GD.Print($"[aiswitchtest] {what}{(got != null ? $": {JsonSerializer.Serialize(got)}" : "")}{(ok == false ? "  FAILED" : "")}");
    }

    private async Task Run()
    {
        try { await Script(); }
        catch (Exception e) { Note("the test broke", e.ToString(), false); }
        File.WriteAllText(Path.Combine(dir, "aiswitch.json"), JsonSerializer.Serialize(new Dictionary<string, object?> { ["ok"] = failed.Count == 0, ["failed"] = failed, ["steps"] = steps }, new JsonSerializerOptions { WriteIndented = true }));
        GetTree().Quit(failed.Count == 0 ? 0 : 1);
    }

    private async Task<TalkLine> Open(string id) => await ServerLink.I!.Api!.Talk(id, "open");

    private async Task Script()
    {
        string expect = Main.I.Arg("aiswitch-expect", "ready");
        bool up = await Until(() => MainMenu.I != null && !Loading.Busy && ServerLink.I is { Up: true } && Main.I.Loaded, 300);
        var menu = MainMenu.I ?? throw new InvalidOperationException("no menu");
        Note("the town and its server are up", ServerLink.I?.Server?.Url, up);
        var api = ServerLink.I!.Api!;
        AiState.Update(await api.AiConfig());
        Note($"the start shows: {expect}", new { AiState.Mode, AiState.State, AiState.Title, AiState.Text, AiState.Locked }, AiState.State == expect && AiState.Mode == (expect == "off" ? "walk" : "ai") && !AiState.Locked);
        await Shot("title-menu");
        // walk in, then the Esc menu in play
        menu.Start();
        await Wait(2.5);
        GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = 13, minute = 0, weather = "clear" }));
        var town = Main.I.GetNode<Townspeople>("Townspeople");
        bool Fit(Townspeople.Sim s) => !s.Inside && s.R.Trade is not ("thief" or "police") && s.R.Age >= 16;
        bool someone = await Until(() => town.Sims.Any(Fit), 90);
        if (!someone) { Note("a townsperson to talk to", town.Sims.Count(), false); return; }
        var sim = town.Sims.Where(Fit).OrderBy(s => new Vector2((float)s.X - Jef.I.X, (float)s.Z - Jef.I.Z).LengthSquared()).First();
        Jef.I.Place((float)sim.X + 1.2f, (float)sim.Z + 1.4f, 0);
        bool near = await Until(() => sim.P != null, 30);
        Note("a townsperson to talk to", new { sim.R.Id, near }, someone && (near || expect == "no_login"));
        menu.ShowMenu(true);
        await Wait(0.6);
        Note("the Esc menu in play has the AI item", AiState.Label, Find(menu.GetParent(), "ai_switch") is InkButton { Visible: true });
        await Shot($"menu-in-play-{expect}");
        if (expect == "no_login")
        {
            var line = await Open(sim.R.Id);
            Note("no login: no typing, the note says why and points to AI setup", new { line.Free, AiState.Text }, line.Free == false && !AiState.AllowsTyping && AiState.Text.Contains("AI setup"));
            AiSheet.Open();
            await Until(() => AiSheet.Shown, 10);
            await Shot("ai-setup-no-login");
            Dialogs.CloseAll();
            return;
        }
        // the switch: from the start state, each turn checked by the server, a talk and the box
        var order = expect == "off" ? new[] { true } : new[] { false, true, false };
        foreach (bool want in order)
        {
            menu.ToggleAi();
            bool changed = await Until(() => AiState.On == want, 10);
            var server = await api.AiConfig();
            AiState.Update(server);
            var line = await Open(sim.R.Id);
            Note($"AI {(want ? "on" : "off")} at once from the menu", new { AiState.Mode, AiState.State, free = line.Free, typing = AiState.AllowsTyping },
                changed && AiState.On == want && line.Free == want && AiState.AllowsTyping == want);
            await Shot($"menu-ai-{(want ? "on" : "off")}");
            // the talk box: the hint offers T only with AI
            menu.ShowMenu(false);
            menu.Start();
            await Until(() => sim.P != null, 15);
            Jef.I.Place((float)(sim.P?.X ?? sim.X) + 1.2f, (float)(sim.P?.Z ?? sim.Z) + 1.4f, 0);
            await Wait(0.3);
            Jef.I.Yaw = MathF.Atan2(Jef.I.X - (float)(sim.P?.X ?? sim.X), Jef.I.Z - (float)(sim.P?.Z ?? sim.Z));
            Talk.I!.Open(sim.R.Id, sim.R.Name);
            bool answered = await Until(() => Talk.I.LastReply != null, 15);
            await Wait(0.8);
            Note($"talk box with AI {(want ? "on" : "off")}", new { answered, free = Talk.I.LastReply?.Free }, answered && Talk.I.LastReply?.Free == want);
            await Shot($"talk-ai-{(want ? "on" : "off")}");
            Talk.I.Close();
            await Wait(0.5);
            menu.ShowMenu(true);
            await Wait(0.4);
        }
        AiSheet.Open();
        await Until(() => AiSheet.Shown, 10);
        await Shot($"ai-setup-{(AiState.On ? "on" : "off")}");
        Dialogs.CloseAll();
        string file = Paths.AiSetup;
        string saved = File.Exists(file) ? (JsonDocument.Parse(File.ReadAllText(file)).RootElement.TryGetProperty("mode", out var m) ? m.GetString() ?? "" : "") : "";
        Note("the switch is saved in this run's own AI setup file", new { file = Path.GetFileName(file), saved }, saved == AiState.Mode);
    }

    private static Node? Find(Node root, string name)
    {
        foreach (var c in root.GetChildren(true))
        {
            if (c.Name == name) return c;
            if (Find(c, name) is { } deep) return deep;
        }
        return null;
    }
}
