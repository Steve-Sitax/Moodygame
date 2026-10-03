using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Ui.Dialogs;

namespace Scheldemist.Talks;

/// <summary>
/// The pockets opened (client/src/game/pockets.ts, M3b): I shows what Jef carries, each thing with its drawing and
/// what a number key does with it (eat, drink, read); the key uses it and closes the pockets. The six slots at the
/// bottom right are the HUD's (Game/Hud.cs). Under the list: his good name in the town, in the server's words.
///
///   Pockets.I.Toggle(), Pockets.I.IsOpen
///   OnRead      a paper, a letter or a pawn ticket to read (set by Press)
/// </summary>
[GamePart(310)]
public partial class Pockets : Node, IDialog
{
    public static Pockets? I { get; private set; }
    private const int Slots = 6;

    private bool open;
    private Sheet? sheet;
    private string nameWords = "";

    /// <summary>M6 (Press): a paper, a letter or a pawn ticket to read.</summary>
    public Action<PocketItem>? OnRead { get; set; }
    /// <summary>What the server last answered to a use (the checks).</summary>
    public string LastUse { get; private set; } = "";

    public Pockets()
    {
        I = this;
    }

    public override void _Ready()
    {
        GameState.I.PocketsChanged += Render;
        if (Dialogs.I is { } d) d.Resized += Render;
    }

    public override void _ExitTree()
    {
        GameState.I.PocketsChanged -= Render;
        if (Dialogs.I is { } d) d.Resized -= Render;
        if (I == this) I = null;
    }

    public string DialogName => "pockets";
    public bool IsOpen => open;

    /// <summary>M9 theft: his good name in the town, in words (the server's; never a number).</summary>
    public void SetGoodName(string words)
    {
        if (words == nameWords) return;
        nameWords = words;
        if (open) Render();
    }

    public void Toggle()
    {
        open = !open;
        if (open)
        {
            Dialogs.I?.Open(this);
            Render();
            _ = AskName();
        }
        else
        {
            Dialogs.I?.Close(this);
            Drop();
        }
    }

    /// <summary>The police's view carries his name in the town (game/deeds.ts poll); asked as the pockets open until the deeds' part keeps it.</summary>
    private async Task AskName()
    {
        if (ServerLink.I?.Api is not { } api) return;
        try
        {
            var v = await api.Get<JsonElement>("api/police");
            if (v.ValueKind == JsonValueKind.Object && v.TryGetProperty("name", out var n) && n.ValueKind == JsonValueKind.String) SetGoodName(n.GetString() ?? "");
        }
        catch (ApiException)
        {
            // no word of it now
        }
    }

    private void Drop()
    {
        sheet?.Card.QueueFree();
        sheet = null;
    }

    private void Render()
    {
        if (!open || Dialogs.I is not { } dialogs) return;
        Drop();
        var win = GetViewport().GetVisibleRect().Size;
        float s = dialogs.Ui;
        // .pocket-panel.paper: right 14, bottom 64, width min(340px, 80vw), padding 10 16 6, the paper's turn
        float w = Math.Min(340 * s, win.X * 0.8f) + 32 * s;
        var sh = new Sheet(s, w, Css.Hex("d4cab0"), (16, 10, 16, 6), -1.2f, sepia: 0.35f, shadow: 30)
        {
            Where = (v, size) => new Vector2(v.X - 14 * s - size.X, v.Y - 64 * s - size.Y),
        };
        sheet = sh;
        sh.Text("[b]Pockets[/b]", Face.Hand, 18.72f, bottom: 6, align: HorizontalAlignment.Center);
        var items = GameState.I.Pockets;
        if (items.Count == 0) sh.Text("Your pockets are empty. Lint, and a button.", Face.Print, 14, 0.7f, top: 2, bottom: 2, align: HorizontalAlignment.Center);
        for (int i = 0; i < items.Count && i < 9; i++)
        {
            var it = items[i];
            var icon = new PocketIcon { MouseFilter = Control.MouseFilterEnum.Ignore };
            icon.SetUi(s * 0.75f);
            icon.ShowKind(it.Kind, "");
            sh.Row(i + 1, Css.Esc(it.Name), it.Use ?? it.Note ?? "", size: 14, padY: 2, gap: 6, icon: icon, rightSize: 13, rightBold: false, rightOpacity: 0.85f, click: i < Slots);
        }
        if (nameWords != "") sh.Text(Css.Esc(nameWords), Face.Hand, 16, top: 6.4f, align: HorizontalAlignment.Center);
        sh.Keys("1-6 eat, drink or read · I to close", Face.Hand, top: 6, bottom: 0);
        dialogs.Layer.AddChild(sh.Card);
        sh.Place();
    }

    private async Task Use(int index)
    {
        var items = GameState.I.Pockets;
        if (index >= items.Count) return;
        var it = items[index];
        if (it.Use == "read")
        {
            if (OnRead != null) OnRead(it);
            return;
        }
        if (it.Use == null)
        {
            GameState.I.Say(it.Note ?? "Not yours to use.");
            return;
        }
        try
        {
            if (ServerLink.I?.Api is not { } api) throw new ApiException("no server", 0);
            var r = await api.Use(it.Id);
            LastUse = r.Text;
            GameState.I.Apply(r);
            GameState.I.Say(r.Text);
        }
        catch (ApiException e)
        {
            LastUse = e.Message;
            GameState.I.Say(e.Message);
        }
    }

    /// <summary>I with no other paper up opens the pockets.</summary>
    public override void _UnhandledKeyInput(InputEvent e)
    {
        if (open || e is not InputEventKey { Pressed: true, Echo: false } k || Dialogs.I is not { Any: false } d) return;
        if (d.GameCode(k) != "KeyI") return;
        GetViewport().SetInputAsHandled();
        Toggle();
    }

    public void OnKey(string code, string key)
    {
        if (code is "KeyI" or "Escape")
        {
            Toggle();
            return;
        }
        int n = Dialogs.Digit(key);
        if (n >= 1 && n <= Slots)
        {
            // use it and close the pockets (Steve: "when pressed I and a number, close I")
            Toggle();
            _ = Use(n - 1);
        }
    }
}
