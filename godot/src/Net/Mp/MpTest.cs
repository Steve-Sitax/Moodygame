using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Player;

namespace Scheldemist.Net.Mp;

/// <summary>
/// Play together, tested on one PC: `-- --mptest dir`. This game hosts (its own server on a fresh test database,
/// no AI), starts a second Godot game as a guest (seat 2, joined with the code as a second seat on the host's PC
/// may), and both walk the Vismarkt by script (Jef.SetKey, as the walk test does). For eight seconds both walk and
/// the meter runs (the browser's mp.report(): camSnaps must be 0; the other's drawn pace, jitter, delay); then
/// each in turn stops, looks at the other walking and saves a picture (dir/mp_host.png, dir/mp_guest.png). The
/// guest then goes home (its own game again: the scene loads again with its own server) and quits; the host
/// writes dir/mptest.json and quits. Every server is gone afterwards; the disposable databases and test token are deleted.
/// </summary>
[GamePart(210)]
public partial class MpTest : Node
{
    private const double WalkS = 8;
    private string dir = "";
    private bool guest;
    private static bool wentHome;
    private readonly Dictionary<string, object?> doc = new();
    private Process? other;
    private IntPtr otherJob = IntPtr.Zero;

    /// <summary>Is this run the test's host (the link gives it a fresh test database and no AI)?</summary>
    public static bool Hosting(Main main) => main.Arg("mptest") != "" && main.Arg("join") == "";

    /// <summary>A fresh, disposable database for this test; no player save is opened or copied.</summary>
    private static readonly HashSet<string> prepared = new();

    public static string TestDb(Main main)
    {
        string dir = Path.GetFullPath(main.Arg("mptest"));
        Directory.CreateDirectory(dir);
        string db = Path.Combine(dir, main.Arg("join") != "" ? "mp-guest.sqlite" : "mp-host.sqlite");
        if (prepared.Add(db))
        {
            Clean(db);
            File.Delete(Path.ChangeExtension(db, ".mp-config.json"));
            if (Hosting(main)) File.Delete(Path.Combine(dir, "mp-tokens.json"));
        }
        return db;
    }

    private static void Clean(string db)
    {
        foreach (string ext in new[] { "", "-wal", "-shm" })
            if (File.Exists(db + ext)) File.Delete(db + ext);
    }

    public override void _Ready()
    {
        dir = Main.I.Arg("mptest");
        if (dir == "") return;
        ProcessMode = ProcessModeEnum.Always;
        Directory.CreateDirectory(dir);
        guest = Main.I.Arg("join") != "";
        if (Windows.Dialogs.I is { } d) d.KeepMouse = true;
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

    private async Task Run()
    {
        bool ok = false;
        try
        {
            ok = guest ? (wentHome ? await GuestHome() : await GuestSteps()) : await HostSteps();
        }
        catch (Exception e)
        {
            doc["error"] = e.ToString();
            GD.PrintErr($"mptest: {e}");
        }
        if (guest && ok && !wentHome && Together.LeftAsGuest)
        {
            // the scene loads again as his own game: the test goes on in the new scene
            wentHome = true;
            return;
        }
        doc["ok"] = ok;
        string name = guest ? (wentHome ? "mptest-guest-home.json" : "mptest-guest.json") : "mptest.json";
        File.WriteAllText(Path.Combine(dir, name), JsonSerializer.Serialize(doc, new JsonSerializerOptions(Api.Json) { WriteIndented = true }));
        if (!guest)
        {
            StopOther();
            // Every server gone, and the disposable test databases with them.
            var link = ServerLink.I;
            string db = TestDb(Main.I);
            link?.Shutdown();
            Clean(db);
            Clean(Path.Combine(dir, "mp-guest.sqlite"));
            foreach (string f in new[] { "mp-tokens.json", "mp-host.mp-config.json", "mp-guest.mp-config.json" }) File.Delete(Path.Combine(dir, f));
        }
        GetTree().Quit(ok ? 0 : 1);
    }

    private bool Fail(string why)
    {
        doc["why"] = why;
        doc["report_at_fail"] = Together.I?.Report();
        GD.PrintErr($"mptest ({(guest ? "guest" : "host")}): {why}");
        return false;
    }

    // ------------------------------------------------------------------ walking by script

    private (float X, float Z)[] route = Array.Empty<(float, float)>();
    private int leg;
    private bool walking;
    private Vector3? lookAt;

    public override void _Process(double delta)
    {
        var j = Jef.I;
        if (j == null || dir == "") return;
        if (walking && route.Length > 0)
        {
            var (tx, tz) = route[leg];
            float dx = tx - j.X, dz = tz - j.Z;
            if (dx * dx + dz * dz < 0.16f) leg = (leg + 1) % route.Length;
            j.Yaw = MathF.Atan2(-dx, -dz);
            j.SetKey(Key.W, true);
        }
        else
        {
            j.SetKey(Key.W, false);
            if (lookAt is { } p) j.Yaw = MathF.Atan2(-(p.X - j.X), -(p.Z - j.Z));
        }
    }

    /// <summary>What both do from the agreed start (the server's clock): walk, the meter, a stop to look and a picture.</summary>
    private async Task<bool> Play(double t0, int otherId, double lookFrom, double lookTo, string picture)
    {
        var tg = Together.I!;
        double At() => (tg.ServerNow - t0) / 1000;
        if (!await Until(() => At() >= 0, 30)) return Fail("the start never came");
        tg.ResetMeter();
        walking = true;
        // 1. both walk: the meter
        if (!await Until(() => At() >= WalkS, WalkS + 5)) return Fail("the walk did not end");
        doc["report"] = tg.Report();
        doc["me_walked_to"] = new[] { Jef.I.X, Jef.I.Z };
        // 2. in turn: stop, look at the other walking, a picture
        await Until(() => At() >= lookFrom, 20);
        walking = false;
        lookAt = tg.PlayerAt(otherId);
        if (!await Until(() => At() >= lookFrom + 0.9, 5)) return Fail("no look");
        lookAt = tg.PlayerAt(otherId);
        await Frames(6);
        var fig = tg.FigureOf(otherId);
        var cam = Main.I.Cam;
        var there = tg.PlayerAt(otherId);
        bool inView = false;
        if (there is { } q && cam != null && !cam.IsPositionBehind(q + Vector3.Up))
        {
            var on = cam.UnprojectPosition(q + Vector3.Up) / (Vector2)Main.I.View.Size;
            inView = on.X > 0.05f && on.X < 0.95f && on.Y > 0.05f && on.Y < 0.95f;
        }
        doc["picture"] = new Dictionary<string, object?>
        {
            ["file"] = picture, ["other_shown"] = fig?.Shown, ["other_in_view"] = inView, ["other_motion"] = fig?.Figure?.Motion, ["other_name"] = fig?.Name,
            ["other_at"] = there is { } w ? new[] { w.X, w.Y, w.Z } : null, ["distance"] = there is { } v ? Math.Round(new Vector2(v.X - Jef.I.X, v.Z - Jef.I.Z).Length(), 2) : null,
        };
        GetViewport().GetTexture().GetImage().SavePng(Path.Combine(dir, picture));
        await Until(() => At() >= lookTo, 10);
        lookAt = null;
        walking = true;
        await Until(() => At() >= 13.5, 20);
        walking = false;
        doc["report_whole"] = tg.Report();
        var rep = (Dictionary<string, object?>)doc["report"]!;
        var remotes = (List<Dictionary<string, object?>>)rep["remotes"]!;
        var r = remotes.FirstOrDefault(x => (int)x["id"]! == otherId);
        if ((int)rep["camSnaps"]! != 0) return Fail($"camSnaps {rep["camSnaps"]}");
        if (r == null) return Fail("the other was never drawn");
        double pace = Convert.ToDouble(r["pace"]);
        if (pace < 1.2 || pace > 1.9) return Fail($"the other's drawn pace is {pace} m/s, not a walk's 1.55");
        if (fig?.Shown != true || !inView) return Fail("the other is not in the picture");
        return true;
    }

    // ------------------------------------------------------------------ the host

    private async Task<bool> HostSteps()
    {
        var st = GameState.I;
        if (ServerLink.I is not { } link || Together.I is not { } tg) return Fail("a part is off");
        if (!await Until(() => st.Live && link.Up && Jef.I != null, 110)) return Fail(link.Error != "" ? link.Error : "no first state");
        var api = link.Api!;
        var jef = Jef.I;
        jef.TestInput = true;
        // a good view: midday, clear
        try
        {
            st.Apply(await api.DevSet(new Dictionary<string, double> { ["money_c"] = 123, ["hour"] = 13, ["minute"] = 0, ["food"] = 9, ["warmth"] = 9, ["sleep"] = 9, ["health"] = 9 }));
            await api.Post<JsonElement>("api/dev/set", new Dictionary<string, object?> { ["weather"] = "clear" });
        }
        catch (ApiException e)
        {
            doc["dev_set"] = e.Message;
        }
        var house = await tg.Host(false);
        doc["house"] = new Dictionary<string, object?> { ["multiplayer"] = house.Multiplayer, ["lan"] = house.Lan, ["code_given"] = house.Code != "", ["server"] = link.Server?.Url, ["save"] = "mp-host.sqlite" };
        if (!await Until(() => tg.Connected && tg.PlayerId == 1, 10)) return Fail("the host's own movement socket did not open");
        link.SetPause("menu", true);
        link.SetPause("key", true);
        doc["no_pause_together"] = !Menu.Pause.Paused && !GetTree().Paused;
        if (Menu.Pause.Paused) return Fail("a menu or P paused a together game");
        await tg.PauseAll(true);
        if (!await Until(() => tg.PausedAll && GetTree().Paused, 5)) return Fail("pause all was not heard");
        await tg.PauseAll(false);
        if (!await Until(() => !tg.PausedAll && !GetTree().Paused, 5)) return Fail("pause all did not end");
        doc["pause_all"] = true;
        jef.Place(-118, 36, 0);
        route = new[] { (-118f, 26f), (-126f, 26f), (-126f, 36f), (-118f, 36f) };
        await Frames(30);

        // the guest: a second game, on this PC, with nothing but the host's address
        string exe = OS.GetExecutablePath();
        var info = new ProcessStartInfo { FileName = exe, UseShellExecute = false, CreateNoWindow = false };
        // Keep the guest's own server beside the test host's port, including after it leaves.
        string guestPort = (new Uri(link.Server!.Url).Port + 1).ToString();
        foreach (string a in new[] { "--path", ProjectSettings.GlobalizePath("res://"), "--log-file", Path.Combine(dir, "guest-engine.log"), "--position", "120,120", "--", "--join", link.Server.Url, "--seat", "2", "--port", guestPort, "--prefs", Path.Combine(dir, "guest-settings.json"), "--no-ai", "--mptest", dir })
            info.ArgumentList.Add(a);
        if (Main.I.Arg("town") != "")
        {
            info.ArgumentList.Add("--town");
            info.ArgumentList.Add(Main.I.Arg("town"));
        }
        foreach (string f in new[] { "mptest-guest.json", "mptest-guest-home.json", "mptest-start.json", "mptest.json", "mp_host.png", "mp_guest.png" }) File.Delete(Path.Combine(dir, f));
        info.ArgumentList.Add("--models");
        info.ArgumentList.Add(Models.ModelLibrary.Dir);
        if (OS.GetCmdlineArgs().Contains("--verbose")) info.ArgumentList.Insert(0, "--verbose");
        other = Process.Start(info);
        if (other == null) return Fail("the second game did not start");
        if (OperatingSystem.IsWindows()) otherJob = WinJob.KillOnClose(other);
        doc["guest_pid"] = other.Id;

        if (!await Until(() => tg.Roster.Count(r => r.Online) >= 2 && tg.PlayerAt(2) != null, 120)) return Fail($"the guest did not come into the town (roster {tg.Roster.Count}, guest exited {other.HasExited})");
        doc["roster"] = tg.Roster;
        // the start both walk from, on the server's clock
        double t0 = tg.ServerNow + 3000;
        File.WriteAllText(Path.Combine(dir, "mptest-start.json"), JsonSerializer.Serialize(new { t0 }));
        bool ok = await Play(t0, 2, WalkS + 0.3, WalkS + 2.0, "mp_host.png");

        // the guest's own numbers, its going home, and its end
        string gfile = Path.Combine(dir, "mptest-guest.json"), hfile = Path.Combine(dir, "mptest-guest-home.json");
        if (!await Until(() => File.Exists(gfile), 30)) return Fail("the guest wrote no report");
        await Frames(10);
        doc["guest"] = JsonSerializer.Deserialize<JsonElement>(File.ReadAllText(gfile));
        bool went = await Until(() => tg.Roster.All(r => r.Id != 2 || !r.Online), 40);
        doc["guest_went"] = went;
        bool home = await Until(() => File.Exists(hfile) || other.HasExited, 120);
        await Until(() => other.HasExited, 20);
        doc["guest_home"] = File.Exists(hfile) ? JsonSerializer.Deserialize<JsonElement>(File.ReadAllText(hfile)) : null;
        doc["guest_exited"] = other.HasExited;
        StopOther();
        foreach (string f in new[] { "mptest-guest.json", "mptest-guest-home.json", "mptest-start.json" }) File.Delete(Path.Combine(dir, f));
        bool guestOk = doc["guest"] is JsonElement g && g.TryGetProperty("ok", out var gk) && gk.ValueKind == JsonValueKind.True;
        bool homeOk = doc["guest_home"] is JsonElement h && h.TryGetProperty("ok", out var hk) && hk.ValueKind == JsonValueKind.True;
        if (!ok) return false;
        if (!guestOk) return Fail("the guest's side failed (see guest.why)");
        if (!went) return Fail("the host never heard the guest go");
        if (!home || !homeOk) return Fail("the guest did not get home to its own game");
        return true;
    }

    // ------------------------------------------------------------------ the guest

    private async Task<bool> GuestSteps()
    {
        var st = GameState.I;
        if (ServerLink.I is not { } link || Together.I is not { } tg) return Fail("a part is off");
        if (!await Until(() => (st.Live && link.Up && Jef.I != null) || link.Error != "", 110) || link.Error != "") return Fail(link.Error != "" ? link.Error : "no first state");
        Jef.I.TestInput = true;
        doc["server"] = new Dictionary<string, object?> { ["url"] = link.Server?.Url, ["own"] = link.Server?.Own, ["token"] = link.Api!.Guest };
        if (!await Until(() => tg.On && tg.PlayerId > 1 && tg.PlayerAt(1) != null, 60)) return Fail($"not in the host's town (on {tg.On}, id {tg.PlayerId})");
        doc["me"] = new Dictionary<string, object?> { ["id"] = tg.PlayerId, ["name"] = st.PlayerName, ["money_c"] = st.Money, ["placed_at"] = new[] { Jef.I.X, Jef.I.Z } };
        doc["roster"] = tg.Roster;
        if (st.PlayerName != "Anna" || st.Money != 50) return Fail("the guest did not have its own player state");
        doc["own_state"] = true;
        // beside the host's square, on its own round
        Jef.I.Place(-113, 34, 0);
        route = new[] { (-113f, 24f), (-121f, 22f), (-121f, 32f), (-113f, 34f) };
        string start = Path.Combine(dir, "mptest-start.json");
        if (!await Until(() => File.Exists(start), 60)) return Fail("the host gave no start");
        await Frames(5);
        double t0 = JsonSerializer.Deserialize<JsonElement>(File.ReadAllText(start)).GetProperty("t0").GetDouble();
        bool ok = await Play(t0, 1, WalkS + 2.4, WalkS + 4.2, "mp_guest.png");
        if (!ok) return false;
        doc["ok"] = true;
        File.WriteAllText(Path.Combine(dir, "mptest-guest.json"), JsonSerializer.Serialize(doc, new JsonSerializerOptions(Api.Json) { WriteIndented = true }));
        // home again: his own game (the scene loads again, his own server starts)
        // Fill the hands' resident cache too; after reload it must read the new town's bodies.
        _ = Scheldemist.Play.Folk.Near(0, 0, 10_000).Count();
        Jef.I.ClearKeys();
        tg.Leave();
        return true;
    }

    private async Task<bool> GuestHome()
    {
        var st = GameState.I;
        if (ServerLink.I is not { } link) return Fail("no link");
        if (!await Until(() => (st.Live && link.Up) || link.Error != "", 110) || link.Error != "") return Fail(link.Error != "" ? link.Error : "no first state at home");
        await Frames(30);
        doc["home_people"] = Scheldemist.Play.Folk.Near(0, 0, 10_000).Count();
        // A scene reload must also replace the cached source of new walking bodies.
        var body = People.Humans.Make("clerk");
        if (body == null) return Fail("no player body after going home");
        Main.I.View.AddChild(body.Root);
        body.Start();
        body.Update(1f / 60);
        await Frames(2);
        bool bodyOk = GodotObject.IsInstanceValid(body.Root) && body.Motion == "idle";
        doc["home_body"] = bodyOk;
        body.Dispose();
        if (!bodyOk) return Fail("the body after going home did not animate");

        doc["server"] = new Dictionary<string, object?> { ["url"] = link.Server?.Url, ["own"] = link.Server?.Own, ["guest"] = link.Api!.Guest };
        doc["together"] = Together.I?.On;
        doc["name"] = st.PlayerName;
        return link.Server is { Own: true } && !link.Api.Guest && Together.I?.On != true && st.Money == 50;
    }

    private void StopOther()
    {
        if (other is { HasExited: false })
        {
            try { other.Kill(true); other.WaitForExit(5000); }
            catch (InvalidOperationException) { /* already gone */ }
        }
        if (otherJob != IntPtr.Zero) { WinJob.Close(otherJob); otherJob = IntPtr.Zero; }
    }

    public override void _ExitTree() => StopOther();
}
