using System;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Net;
using Scheldemist.Net.Mp;
using Scheldemist.Ui;

namespace Scheldemist.Menu;

/// <summary>The handbill's Together page (menu/menu.ts): host, the address and code, join, and go home.</summary>
public static class TogetherSheet
{
    private static Sheet? sheet;
    private static string address = "", code = "", name = "Anna", note = "";
    private static bool busy;

    public static void Open()
    {
        note = "";
        Draw();
        if (Together.I is { On: true, Guest: false } tg) _ = Run(() => tg.Refresh());
    }

    private static void Draw()
    {
        if (sheet != null && Dialogs.IsOpen(sheet)) Dialogs.Close(sheet);
        var s = new Sheet("Together", "A town for the whole house", width: 720);
        sheet = s;
        var tg = Together.I;
        s.Body.AddChild(Kit.Para("Everyone needs the Godot download. Your own walking stays on your PC; money, work and the clock come from the host."));
        if (tg is { Guest: true })
        {
            s.Body.AddChild(Kit.Para($"You are visiting {ServerLink.I?.Api?.Url}. Your name is {Game.GameState.I.PlayerName}."));
            s.Body.AddChild(new InkButton(InkButton.Look.Btn, "Leave and go home", () => tg.Leave()));
        }
        else
        {
            s.Body.AddChild(new InkButton(InkButton.Look.Btn, tg?.On == true ? "Close the game to guests" : "Host a game for the house", () =>
            {
                if (tg == null) return;
                _ = Run(async () => { if (tg.On) await tg.StopHosting(); else await tg.Host(true); });
            }) { Name = "host_game", Disabled = busy || ServerLink.I?.Up != true });
            if (tg is { On: true })
            {
                var h = tg.House;
                s.Body.AddChild(Kit.Para("Address: " + (h?.Urls.Count > 0 ? string.Join("\n", h.Urls) : ServerLink.I?.Api?.Url)));
                s.Body.AddChild(Kit.Para("Join code: " + (h?.Code ?? "Waiting for the host...")));
                foreach (var r in tg.Roster) s.Body.AddChild(Kit.Para(r.Name + (r.Host ? " (host)" : "") + (r.Online ? "" : " (away)")));
                s.Body.AddChild(new InkButton(InkButton.Look.Btn, tg.PausedAll ? "Go on for everyone" : "Pause the town for everyone", () => _ = Run(() => tg.PauseAll(!tg.PausedAll))) { Disabled = busy });
            }
            s.Body.AddChild(Kit.Para("Join another game: type the host's address and its join code. A code identifies a game at that address; it does not locate a PC."));
            Field(s, "Host address", address, "http://192.168.1.20:8800", v => address = v);
            Field(s, "Join code", code, "KADE-47", v => code = v);
            Field(s, "Your first name", name, "Anna", v => name = v);
            s.Body.AddChild(new InkButton(InkButton.Look.Btn, "Join", () =>
            {
                if (!Uri.TryCreate(Together.AddressOf(address), UriKind.Absolute, out var u) || u.Scheme is not ("http" or "https") || string.IsNullOrWhiteSpace(name))
                { note = "Type the host's address and your first name."; Draw(); return; }
                tg?.Join(address, code, name);
            }) { Disabled = busy || tg == null });
        }
        if (note != "") s.Body.AddChild(Kit.Para(note));
        s.AddBack();
        Dialogs.Open(s, () => { if (sheet == s) sheet = null; });
    }

    private static void Field(Sheet s, string label, string text, string hint, Action<string> change)
    {
        var input = Kit.Input(text, 280, placeholder: hint);
        input.Name = label.Replace(" ", "_");
        input.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;
        input.TextChanged += v => change(v);
        s.Body.AddChild(Kit.Row(label, input));
    }

    private static async Task Run(Func<Task> action)
    {
        if (busy) return;
        busy = true;
        note = "Asking the host...";
        Draw();
        try { await action(); note = ""; }
        catch (Exception e) { note = e.Message; }
        finally { busy = false; if (sheet != null && Dialogs.IsOpen(sheet)) Draw(); }
    }
}
