using System;
using System.Text.Json;
using Godot;
using Scheldemist.Net;
using Scheldemist.Play;
using Scheldemist.Town;
using Scheldemist.Ui;

namespace Scheldemist.Game;

/// <summary>game/families.ts after FamilyPeople's names, table and visit: menace, supper veil and dreams.
/// The server narrates and settles harm; this client offers only the engine's choices.</summary>
[GamePart(234)]
public partial class FamilyScenes : Node
{
    private int menace;
    private string npc = "", name = "";
    private int demand;
    private double left, veilLeft;
    private bool asking, typing;
    private Townspeople? town;
    private Control panel = null!;
    private Label message = null!;
    private LineEdit input = null!;
    private ColorRect veil = null!;
    private Label veilText = null!;
    private string dream = "";
    public override void _Ready()
    {
        ProcessPriority = 950; // after Wiring: a focused reply field keeps Jef still
        town = GetParent().GetNodeOrNull<Townspeople>("Townspeople");
        if (FamilyPeople.I != null) FamilyPeople.I.ActionReceived += Apply;
        panel = new PaperCard(PaperCard.Kind.Plain) { Visible = false, Position = new Vector2(450, 560), CustomMinimumSize = new Vector2(700, 100) };
        var col = new VBoxContainer(); panel.AddChild(col); message = Kit.Text("", Fonts.Print, 16, Kit.Ink, true); col.AddChild(message);
        input = Kit.Input("", 440, placeholder: "Your own words, then Enter (Esc: never mind)"); input.MaxLength = 300; input.Visible = false; col.AddChild(input);
        input.TextSubmitted += text => Answer("talk", text); Main.I.Ui.AddChild(panel);
        veil = new ColorRect { Color = new Color(0.03f, 0.02f, 0.016f, 0.78f), Visible = false, MouseFilter = Control.MouseFilterEnum.Ignore }; veil.SetAnchorsAndOffsetsPreset(Control.LayoutPreset.FullRect);
        veilText = Kit.Text("", Fonts.PrintItalic, 20, Kit.Paper, true); veilText.Position = new Vector2(450, 350); veilText.Size = new Vector2(700, 200); veil.AddChild(veilText); Main.I.Ui.AddChild(veil);
        Ui.Dialogs.Register("menace", () => menace != 0, cursor: false, esc: () => false);
    }
    private void Apply(JsonElement state)
    {
        if (state.TryGetProperty("menace", out var m) && m.ValueKind == JsonValueKind.Object)
        {
            menace = m.GetProperty("action").GetInt32(); npc = m.GetProperty("npc").GetString() ?? ""; name = m.GetProperty("name").GetString() ?? ""; demand = m.GetProperty("demand_c").GetInt32();
            left = 12; asking = typing = false; input.Visible = false; panel.Visible = true;
            message.Text = name + " means you harm. Get clear of him, talk [T]" + (demand > 0 ? " or pay " + demand + " centimes [P]." : ".") + " People about, or an agent near, would stop him.";
            if (m.TryGetProperty("line", out var line)) GameState.I.Say(line.GetString() ?? "");
        }
        if (state.TryGetProperty("menace_end", out var end) && end.ValueKind == JsonValueKind.Object) End(end.TryGetProperty("text", out var text) ? text.GetString() ?? "" : "");
        if (state.TryGetProperty("veil", out var veilLine) && veilLine.ValueKind == JsonValueKind.String) Veil(veilLine.GetString() ?? "");
        if (state.TryGetProperty("say", out var say) && say.ValueKind == JsonValueKind.String) GameState.I.Say(say.GetString() ?? "");
        if (state.TryGetProperty("dream", out var incoming))
        {
            string? next = incoming.ValueKind == JsonValueKind.String ? incoming.GetString() : incoming.ValueKind == JsonValueKind.Object && incoming.TryGetProperty("text", out var text) ? text.GetString() : null;
            if (!string.IsNullOrEmpty(next) && next != dream) { dream = next; GameState.I.Say("You dreamt: " + dream); }
        }
    }
    private void Veil(string text) { veil.Visible = true; veilText.Text = text; veilLeft = 6 + text.Length / 40.0; }
    private void End(string text) { menace = 0; typing = asking = false; panel.Visible = false; input.Visible = false; if (text != "") { GameState.I.Say(text); Veil(text); } }
    private void Answer(string how, string? words = null)
    {
        if (menace == 0 || asking || ServerLink.I?.Api is not { } api) return;
        asking = true; typing = false; input.Visible = false;
        api.Run(api.FamilyMenace(menace, how, words), reply =>
        {
            asking = false;
            var state = reply.Deserialize<JobsPayload>(Api.Json); if (state != null) GameState.I.Apply(state);
            if (reply.TryGetProperty("gated", out var gate)) { GameState.I.Say(gate.GetString() == "too fast" ? "Catch your breath first." : "Too many words at once."); return; }
            if (reply.TryGetProperty("result", out var result) && result.ValueKind == JsonValueKind.Object) End(result.GetProperty("text").GetString() ?? ""); else End("");
        }, e => { asking = false; GameState.I.Say(e.Message); });
    }
    public override void _Process(double delta)
    {
        if (typing && Scheldemist.Player.Jef.I is { } player) player.Frozen = true;
        if (veil.Visible && (veilLeft -= delta) <= 0) veil.Visible = false;
        if (menace == 0 || asking || Scheldemist.Player.Jef.I is not { } j) return;
        var at = town?.PositionOf(npc);
        if (at is { } p && Whereabouts.Hypot(p.x - j.X, p.z - j.Z) > 12) { Answer("ran"); return; }
        if ((left -= delta) <= 0) Answer("stand");
    }
    public override void _Input(InputEvent e)
    {
        if (menace == 0 || asking || e is not InputEventKey { Pressed: true, Echo: false } key) return;
        if (typing && key.Keycode == Key.Escape) { typing = false; input.Visible = false; input.ReleaseFocus(); left = 12; GetViewport().SetInputAsHandled(); }
        else if (!typing && key.Keycode == Key.T) { typing = true; left = 45; input.Text = ""; input.Visible = true; input.GrabFocus(); GetViewport().SetInputAsHandled(); }
        else if (!typing && key.Keycode == Key.P && demand > 0) { Answer("pay"); GetViewport().SetInputAsHandled(); }
    }
    public override void _ExitTree() { if (FamilyPeople.I != null) FamilyPeople.I.ActionReceived -= Apply; panel.QueueFree(); veil.QueueFree(); }
}
