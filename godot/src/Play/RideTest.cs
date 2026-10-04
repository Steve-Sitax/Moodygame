using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;

namespace Scheldemist.Play;

/// <summary>Bounded server-backed transport check. Unsupported features remain explicit in its report.</summary>
[GamePart(992)]
public partial class RideTest : Node
{
    private string dir = "";
    private readonly List<object> checks = new(), replies = new();
    private readonly List<string> pictures = new();
    public override void _Ready()
    {
        dir = Main.I.Arg("ridetest");
        if (dir == "") return;
        dir = Path.GetFullPath(dir);
        Directory.CreateDirectory(dir);
        _ = Run();
    }
    private async Task Run()
    {
        string error = "";
        try
        {
            if (!Main.I.Flag("no-ai") || Paths.Database != Path.Combine(dir, "test.sqlite")) throw new InvalidOperationException("ridetest needs --no-ai and --db <dir>/test.sqlite");
            Require(await Until(() => ServerLink.I?.Up == true && GameState.I.Live, 100), "server ready");
            var api = ServerLink.I!.Api!;
            Jef.I.TestInput = true;
            GameState.I.PlayingWhen = () => false;
            await api.Post<OkReply>("api/arrival/ashore");
            Jef.I.Place(-118, 36, 0);
            foreach (float height in new[] { 2.99f, 3, 5, 8, 12 })
            {
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { hour = 13, minute = 45, weather = "clear", health = 10 }));
                int expected = height < 3 ? 0 : height < 5 ? 1 : height < 8 ? 2 : height < 12 ? 3 : 4;
                var r = await Falls.I.Report(height, false);
                replies.Add(new { height, water = false, reply = r });
                Require(r != null && r.Hurt == expected && r.Player.Health == 10 - expected, $"stone fall {height} m");
                if (height >= 3) await Shot("fall-" + height);
                var wet = await Falls.I.Report(height, true);
                replies.Add(new { height, water = true, reply = wet });
                Require(wet != null && wet.Hurt == 0 && wet.Player.Health == 10 - expected, $"water takes {height} m fall");
            }
        }
        catch (Exception e) { error = e.ToString(); GD.PrintErr("ridetest: " + error); }
        finally
        {
            File.WriteAllText(Path.Combine(dir, "ridetest.json"), JsonSerializer.Serialize(new { ok = error == "", error, checks, replies, pictures, incomplete = new[] { "handcart", "rowing", "ship frames", "omnibus", "velocipede", "crane", "ferry" } }, new JsonSerializerOptions(Api.Json) { WriteIndented = true }));
            GetTree().Quit(error == "" ? 0 : 1);
        }
    }
    private void Require(bool ok, string name)
    {
        checks.Add(new { name, ok });
        GD.Print($"ridetest: {(ok ? "ok" : "FAIL")} {name}");
        if (!ok) throw new InvalidOperationException(name);
    }
    private async Task<bool> Until(Func<bool> condition, double seconds)
    {
        ulong end = Time.GetTicksMsec() + (ulong)(seconds * 1000);
        while (Time.GetTicksMsec() < end) { if (condition()) return true; await Frames(1); }
        return condition();
    }
    private async Task Frames(int n) { for (int i = 0; i < n; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame); }
    private async Task Shot(string name)
    {
        await Frames(8);
        string file = Path.Combine(dir, name + ".png");
        GetViewport().GetTexture().GetImage().SavePng(file);
        pictures.Add(file);
    }
}
