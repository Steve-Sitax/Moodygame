using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Net;
using Scheldemist.Windows;

namespace Scheldemist.Game;

/// <summary>
/// The day sheets' own test: `-- --daytest dir --no-ai --db copy.sqlite` (a copy of a save: the test ends its
/// week). By the dev routes it makes Jef drop asleep on a tick (the night sheet, got up from with the E key), turns
/// the date at midnight (the line in the middle), pays the rent, and ends the week (the end sheet, waiting, then
/// with its epilogue). A picture of each and what was on the papers go to dir (daytest.json); then it quits.
/// </summary>
[GamePart(202)]
public partial class DayTest : Node
{
    private string dir = "";
    private readonly Dictionary<string, object?> doc = new();
    private readonly List<string> said = new();

    public override void _Ready()
    {
        dir = Main.I.Arg("daytest");
        if (dir == "") return;
        Directory.CreateDirectory(dir);
        GameState.I.Message += said.Add;
        _ = Run();
    }

    private async Task Frames(int n)
    {
        for (int i = 0; i < n; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
    }

    private async Task<bool> Until(Func<bool> ok, double seconds)
    {
        ulong end = Time.GetTicksMsec() + (ulong)(seconds * 1000);
        while (!ok())
        {
            if (Time.GetTicksMsec() > end) return false;
            await Frames(1);
        }
        return true;
    }

    private async Task Shot(string name)
    {
        await Frames(20);
        GetViewport().GetTexture().GetImage().SavePng(Path.Combine(dir, name + ".png"));
    }

    private async Task Run()
    {
        bool ok = false;
        try
        {
            ok = await Steps();
        }
        catch (Exception e)
        {
            doc["error"] = e.ToString();
        }
        doc["ok"] = ok;
        doc["said"] = said;
        File.WriteAllText(Path.Combine(dir, "daytest.json"), JsonSerializer.Serialize(doc, new JsonSerializerOptions(Api.Json) { WriteIndented = true }));
        GetTree().Quit(ok ? 0 : 1);
    }

    private async Task<TickReply?> Tick(ServerLink link)
    {
        TickReply? got = null;
        void On(TickReply r) => got = r;
        link.Ticked += On;
        link.Tick();
        await Until(() => got != null, 10);
        link.Ticked -= On;
        return got;
    }

    private async Task<bool> Steps()
    {
        var st = GameState.I;
        if (ServerLink.I is not { } link || DaySheets.I is not { } day || Dialogs.I is not { } dialogs) return Fail("a part is off");
        dialogs.KeepMouse = true;
        if (!await Until(() => st.Live && link.Up, 100)) return Fail(link.Error != "" ? link.Error : "no first state");
        var api = link.Api!;
        st.PlayingWhen = () => true;

        // 1. dead on his feet as the hour turns: he drops where he stands; the night sheet
        st.Apply(await api.DevSet(new Dictionary<string, double> { ["day"] = 2, ["hour"] = 14, ["minute"] = 55, ["sleep"] = 0, ["food"] = 8, ["warmth"] = 8, ["health"] = 8 }));
        var t1 = await Tick(link);
        doc["night_tick"] = new Dictionary<string, object?> { ["advanced"] = t1?.Advanced, ["night"] = t1?.Night };
        if (!await Until(() => day.Shown == "night", 5)) return Fail("no night sheet");
        doc["night_sheet"] = new List<string>(day.Lines);
        doc["night_playing"] = st.Playing;
        doc["night_dialogs"] = dialogs.Up;
        await Shot("day_night");
        dialogs.SendKey("KeyE");
        await Frames(3);
        doc["night_closed"] = day.Shown == "none" && !dialogs.Any;
        await Shot("day_morning");

        // 2. the rent
        var before = st.Money;
        st.Apply(await api.DevSet(new Dictionary<string, double> { ["money_c"] = 400 }));
        day.PayRent();
        await Until(() => st.RentPaid, 5);
        doc["rent"] = new Dictionary<string, object?> { ["paid"] = st.RentPaid, ["money_c"] = st.Money };

        // 3. midnight while he is up: the date turns, a line in the middle
        st.Apply(await api.DevSet(new Dictionary<string, double> { ["day"] = 3, ["hour"] = 23, ["minute"] = 55, ["sleep"] = 9, ["food"] = 9, ["warmth"] = 9, ["health"] = 9 }));
        int saidBefore = said.Count;
        var t2 = await Tick(link);
        doc["midnight_tick"] = new Dictionary<string, object?> { ["advanced"] = t2?.Advanced, ["turned"] = t2?.Turned, ["weekday"] = st.Weekday, ["day"] = st.Day };
        doc["midnight_line"] = said.Count > saidBefore ? said[^1] : null;
        await Shot("day_midnight");

        // 4. Sunday midnight: the week ends; the end sheet waits for the epilogue, then shows it
        st.Apply(await api.DevSet(new Dictionary<string, double> { ["day"] = 7, ["hour"] = 23, ["minute"] = 55 }));
        var t3 = await Tick(link);
        doc["end_tick"] = new Dictionary<string, object?> { ["advanced"] = t3?.Advanced, ["ended"] = t3?.Ended };
        if (!await Until(() => day.Shown == "end", 8)) return Fail("no end sheet");
        doc["end_sheet_first"] = new List<string>(day.Lines);
        if (st.Ending?.Epilogue == null) await Shot("day_end_waiting");
        if (!await Until(() => st.Ending?.Epilogue != null, 40)) return Fail("no epilogue");
        await Frames(5);
        doc["end_sheet"] = new List<string>(day.Lines);
        doc["end_playing"] = st.Playing;
        await Shot("day_end");
        // Esc does not close the end
        dialogs.SendKey("Escape");
        await Frames(3);
        doc["end_stays_on_esc"] = day.Shown == "end";
        return true;
    }

    private bool Fail(string why)
    {
        doc["why"] = why;
        GD.PrintErr($"daytest: {why}");
        return false;
    }
}
