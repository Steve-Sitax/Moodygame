using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Menu;
using Scheldemist.Movers;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Town;
using Scheldemist.Ui;
using UiKit = Scheldemist.Ui.Kit;
using Scheldemist.World;

namespace Scheldemist.Dev;

/// <summary>
/// Dev mode's tools (the browser's game/devmenu.ts, the F9 fly of main.ts and the crowd's stress load): what the Dev
/// sheet's buttons and the console's commands do, each answering in a line the sheet shows. On only in dev mode
/// (the console's `dev on`, Ctrl+Alt+Shift+D, or `-- --dev`: DevConsole.cs). The keys: F8 the Dev sheet (also while
/// walking), F9 fly over the town and back to Jef where you are.
///
/// Time and weather go through the server (it owns the clock and the weather) and change the save, as in the
/// browser; the tide's hold, the thick fog, the shower and the extra street people are this game's picture only.
/// </summary>
[GamePart(955)]
public partial class DevTools : Node
{
    public static DevTools? I { get; private set; }

    /// <summary>The browser's JUMPS (dev/testkit.ts): the "Go to" places.</summary>
    public static readonly (string Name, double X, double Z)[] Places =
    {
        ("Rijnkaai", 20, 20), ("Werf", -270, 9), ("Steenplein", -180, 20), ("Het Steen (ramp)", -202.2, 0.5), ("Vismarkt", -118, 30),
        ("Vleeshuis", -122, 84), ("Grote Markt", -254, 90), ("Cathedral", -262, 138), ("Canal", -64, 100), ("Lock", 96, 26), ("Petit Bassin", 120, 117),
    };

    /// <summary>The director's templates the browser's Dev panel offers (server/src/director templates).</summary>
    public static readonly string[] Templates =
    {
        "musicians", "fish_auction", "quarrel", "scuffle", "house_fire", "hiring", "wedding", "funeral", "emigrant_ship", "street_robbery",
        "tavern_brawl", "night_watch", "burglary", "smuggling", "tempest",
    };

    private static readonly string[] StressKinds = { "docker_a", "docker_b", "docker_c", "wife_a", "wife_b", "gentleman", "boy", "girl" };

    private Api Api => ServerLink.I?.Api ?? throw new InvalidOperationException("the game server is not ready");
    private Townspeople? People => Main.I.GetNodeOrNull<Townspeople>("Townspeople");
    private readonly Random rng = new();

    public DevTools()
    {
        I = this;
        ProcessMode = ProcessModeEnum.Always; // F8 and F9 work over the paused town and the menu
    }

    public override void _ExitTree()
    {
        if (I == this) I = null;
    }

    // ------------------------------------------------------------------ the clock, the weather, Jef

    public async Task<string> Hour(int hour)
    {
        await Kit.I.Light(hour, GameState.I.Weather, fill: false);
        return $"time {hour}:00: done (day {GameState.I.Day}, {GameState.I.HourF.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture)} h)";
    }

    public async Task<string> Weather(string weather)
    {
        await Kit.I.Light(GameState.I.HourF, weather, fill: false);
        return $"weather {weather}: done (the server says {GameState.I.Weather})";
    }

    public async Task<string> NeedsFull()
    {
        GameState.I.Apply(await Api.Post<JobsPayload>("api/dev/set", new { food = 10, warmth = 10, sleep = 10, health = 10 }));
        return "needs: full";
    }

    public async Task<string> Money(int centimes)
    {
        int now = GameState.I.Money;
        GameState.I.Apply(await Api.Post<JobsPayload>("api/dev/set", new { money_c = now + centimes }));
        return $"money: {now} c, now {GameState.I.Money} c";
    }

    public string GoTo(int i)
    {
        var p = Places[i];
        if (Jef.I.Fly) ToggleFly();
        Kit.I.Go($"{p.X.ToString(System.Globalization.CultureInfo.InvariantCulture)} {p.Z.ToString(System.Globalization.CultureInfo.InvariantCulture)}");
        return $"at {p.Name}";
    }

    // ------------------------------------------------------------------ the tide (World/Tide.cs Hold)

    /// <summary>"now" (just say it), "high", "low" (held at spring high or low water), a level in metres, "clock" (follow the clock).</summary>
    public string TideHold(string how)
    {
        // (one hold for the dev panel and the W1 tide kit: a level in metres, "high", "low" or "clock"; Kit.TideHold)
        string a = how.Trim().ToLowerInvariant();
        if (a is "off" or "") a = "clock";
        if (a != "now") Kit.TideHold(a);
        return Tide.Describe((int)GameState.I.Day, (float)GameState.I.HourF);
    }

    // ------------------------------------------------------------------ the movers' passages, the sky's own

    /// <summary>The browser's lock.passNow: "in" a ship from the river into the dock, "out" the one lying there.</summary>
    public string LockPass(string dir)
    {
        if (dir is not ("in" or "out")) throw new ArgumentException("lock in or lock out");
        var l = Lock.I ?? throw new InvalidOperationException("the lock is not in this run");
        string was = l.State;
        l.Start(dir);
        string now = l.State;
        if (now == dir) return dir == "in" ? "a ship comes into the dock now: the lock opens for it (at the lock, x 96 z 26)" : "the ship in the dock goes out now: the lock opens for it";
        if (was is "in" or "out" or "turn" or "back") return $"the lock is busy (a ship is {(was == "in" ? "coming in" : "going out")}): try again when it is done";
        return dir == "out" ? "no ship lies in the dock to go out: send one in first" : "no ship fits the lock just now";
    }

    /// <summary>The browser's bridges.passNow: a boat up the canal or the vliet (or down again if one is up).</summary>
    public string Passage(string where)
    {
        if (where is not ("canal" or "vliet")) throw new ArgumentException("pass canal or pass vliet");
        var b = Bridges.I ?? throw new InvalidOperationException("the bridges are not in this run");
        string was = b.PassageState(where);
        if (was is "in" or "out") return $"a boat is already going {(was == "in" ? "up" : "down")} the {where}: wait until it is through";
        b.PassNow(where);
        string s = b.PassageState(where);
        return s switch
        {
            "in" => $"a boat goes up the {where} now: the bridges open as it comes",
            "out" => $"the boat in the {where} comes back down now",
            _ => $"the {where}'s boat: {s}",
        };
    }

    public string ThickFog(bool on)
    {
        Daylight.I.SetThickFog(on);
        return on ? "thick fog: coming in (a few seconds)" : "thick fog: lifting";
    }

    public string Shower(bool on)
    {
        Daylight.I.SetRain(on ? 1 : 0);
        return on ? "a rain shower: on" : "the rain shower: off (the weather's own rain stays)";
    }

    // ------------------------------------------------------------------ the director's events

    /// <summary>
    /// A template planned now through the server's dev route (it starts a game minute later). The server's clock
    /// stands while the game is paused under the sheet, so the event begins once the town runs again; then Jef is
    /// put on free ground near it, facing it (as the web demo's buttons do), and a line says so.
    /// </summary>
    public async Task<string> Event(string template)
    {
        if (template == "antigoon") return await Antigoon();
        if (!Templates.Contains(template) && template != "ballad") throw new ArgumentException("event " + string.Join(", ", Templates));
        var plan = await Api.DevEvent(template);
        if (!plan.Ok) return $"{Words(template)}: not now ({plan.Why})";
        if (template == "tempest") return $"{plan.Title}: it comes in a game minute, over the whole town. Close this and stay outside.";
        Pending = (plan.Id, plan.Title);
        pendingLeft = 90;
        return GetTree().Paused
            ? $"planned \"{plan.Title}\": it starts a game minute after you go on, and you are put right in front of it. Close this and watch."
            : $"planned \"{plan.Title}\": it starts in a game minute, and you are put right in front of it.";
    }

    /// <summary>Start the native street encounter while keeping Jef at his current position.</summary>
    public async Task<string> Antigoon()
    {
        var result = await Api.Post<JsonElement>("api/dev/antigoon", new { }, timeoutMs: 30000);
        GameState.I.Apply(JsonSerializer.Deserialize<JobsPayload>(result.GetProperty("world"), Scheldemist.Net.Api.Json)!);
        People?.Refill();
        return $"Antigoon is walking from a back alley at 22:00 (x {result.GetProperty("x").GetDouble():0}, z {result.GetProperty("z").GetDouble():0}). Your position stays the same. Close this panel to watch.";
    }

    /// <summary>An event a button planned that has not begun yet (its id, its title).</summary>
    public (int Id, string Title)? Pending { get; private set; }
    private double pendingLeft, pendingPoll;

    /// <summary>The town runs: is the planned event on yet? Then Jef goes to it.</summary>
    private void WatchPending(double delta)
    {
        if (Pending is not { } want || (pendingPoll -= delta) > 0) return;
        pendingPoll = 0.5;
        pendingLeft -= 0.5;
        var live = Events.I?.Find(want.Id);
        var stage = live == null || live.Event.Status != "running" ? null : Events.StageOf(live.Event);
        if (stage == null)
        {
            if (pendingLeft > 0) return;
            Pending = null;
            GameState.I.Say($"{want.Title} did not start (the director's checks may have stopped it).");
            return;
        }
        Pending = null;
        GameState.I.Say(PutJefAt(want.Id, want.Title, stage.Label, stage.X, stage.Z));
    }

    private string PutJefAt(int id, string title, string where, double x, double z)
    {
        LastEvent = (id, x, z);
        foreach (double d in new[] { 10.0, 14, 18, 24, 7 })
            for (int k = 0; k < 12; k++)
            {
                double a = k * Math.PI / 6, px = x + Math.Sin(a) * d, pz = z + Math.Cos(a) * d;
                Pt q;
                try { q = Kit.I.FreeNear(px, pz); }
                catch (InvalidOperationException) { continue; }
                if (Whereabouts.Hypot(q.X - px, q.Z - pz) > 1.5) continue;
                if (Jef.I.Fly) ToggleFly();
                float yaw = MathF.Atan2((float)-(x - q.X), (float)-(z - q.Z));
                Jef.I.Place((float)q.X, (float)q.Z, yaw, -0.08f, Jef.I.GroundAt((float)q.X, (float)q.Z, (float)People!.Walk!.BaseAt(q.X, q.Z)));
                People.Refill();
                return $"{title} at {where}: it starts now, right in front of you.";
            }
        return $"{title} at {where}: it starts now (x {x:0}, z {z:0}).";
    }

    /// <summary>The last event a button started with Jef put in front of it, for the self-test.</summary>
    public (int Id, double X, double Z)? LastEvent { get; private set; }

    /// <summary>The browser's "Director: think now" and "invent an event now" (the second needs the AI).</summary>
    public async Task<string> Director(bool invent)
    {
        var r = await Api.DevDirector(think: invent ? null : true, invent: invent ? true : null);
        string S(string k) => r.TryGetProperty(k, out var v) && v.ValueKind != JsonValueKind.Null ? v.ToString() : "";
        if (invent)
            return r.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True
                ? $"invented \"{S("title")}\" ({S("kind")}) at {S("where")}, starts in {S("starts_in")} game minutes. Why: {S("why")}"
                : $"no event: {S("why")}";
        string planned = "";
        if (r.TryGetProperty("planned", out var p) && p.ValueKind == JsonValueKind.Object)
            planned = p.TryGetProperty("ok", out var pok) && pok.ValueKind == JsonValueKind.True ? $": planned \"{p.GetProperty("title")}\"" : $": refused, {(p.TryGetProperty("why", out var w) ? w.ToString() : "")}";
        else if (S("why") != "") planned = ": " + S("why");
        return $"{S("decision")} ({S("source")}){planned}";
    }

    public static string Words(string template) => template.Replace('_', ' ');

    // ------------------------------------------------------------------ fly (F9)

    private Vector3 takeoff;
    /// <summary>The fly keys as the player has them bound (Settings, Controls).</summary>
    private static string FlyKeys => $"{Keys.Label("forward")}{Keys.Label("left")}{Keys.Label("back")}{Keys.Label("right")} fly, mouse look, {Keys.Label("jump")} up, {Keys.Label("crouch")} down, {Keys.Label("hurry")} fast, wheel speed";
    private Label? flyLine;

    /// <summary>F9: the free camera from where Jef stands; again: Jef lands under it if he can stand there, else where he took off.</summary>
    public string ToggleFly()
    {
        var jef = Jef.I ?? throw new InvalidOperationException("Jef is not in this run");
        if (!jef.Fly)
        {
            takeoff = new Vector3(jef.X, jef.Y, jef.Z);
            jef.ToggleFly();
            if (!jef.Fly) return "no free camera in this run";
            ShowFlyLine(true);
            return $"flying: {FlyKeys}, F9 lands";
        }
        var fly = (FlyCam)Main.I.Cam;
        var at = fly.GlobalPosition;
        Pt? land = null;
        try
        {
            var q = Kit.I.FreeNear(at.X, at.Z);
            if (Whereabouts.Hypot(q.X - at.X, q.Z - at.Z) < 6) land = q;
        }
        catch (InvalidOperationException)
        {
            // nowhere to stand under the camera (the river, a roof block): back where he took off
        }
        float gx = land != null ? (float)land.Value.X : takeoff.X, gz = land != null ? (float)land.Value.Z : takeoff.Z;
        float ground = land != null ? jef.GroundAt(gx, gz, (float)(People?.Walk?.BaseAt(gx, gz) ?? 0)) : takeoff.Y;
        if (!float.IsFinite(ground)) ground = takeoff.Y;
        // Jef.ToggleFly puts him under the camera: the camera first goes down to where he lands
        fly.GlobalPosition = new Vector3(gx, ground + Jef.Eye, gz);
        jef.ToggleFly();
        People?.Refill();
        ShowFlyLine(false);
        return land != null ? $"landed at x {gx:0} z {gz:0}" : $"nowhere to stand there: back where you took off (x {gx:0} z {gz:0})";
    }

    private void ShowFlyLine(bool on)
    {
        if (flyLine == null || !IsInstanceValid(flyLine))
        {
            flyLine = UiKit.Text("", Fonts.Mono, 13, UiKit.Ink);
            var box = UiKit.Box(new Color(UiKit.Paper, 0.88f), UiKit.Ink, 1, 2, 10, 4);
            flyLine.AddThemeStyleboxOverride("normal", box);
            // top right, clear of the clock card
            flyLine.AnchorLeft = flyLine.AnchorRight = 1;
            flyLine.GrowHorizontal = Control.GrowDirection.Begin;
            flyLine.OffsetRight = -UiKit.Px(16);
            flyLine.OffsetTop = UiKit.Px(12);
            flyLine.Name = "devfly";
            Main.I.Ui.AddChild(flyLine);
        }
        flyLine.Visible = on;
    }

    // ------------------------------------------------------------------ the NPC stress test (crowd.ts setStressMultiplier)

    private readonly List<Puppet> stress = new();
    private Crowd? stressCrowd;
    /// <summary>1 (off) .. 100: extra street people, (multiplier - 1) times the normal street limit.</summary>
    public int StressMultiplier { get; private set; } = 1;
    public int StressBase => Prefs.StreetCap;
    public int StressTarget => (StressMultiplier - 1) * StressBase;
    public int StressExtra => stress.Count;

    public void SetStress(int multiplier)
    {
        StressMultiplier = Math.Clamp(multiplier, 1, 100);
        while (stress.Count > StressTarget) Recycle(stress[^1]);
    }

    private void Recycle(Puppet p)
    {
        stress.Remove(p);
        stressCrowd?.RemovePuppet(p);
    }

    /// <summary>The extra people walk the streets round the view: they grow eight a frame, wander, and go when far behind.</summary>
    private void StressStep()
    {
        var town = People;
        var crowd = town?.Crowd;
        if (crowd != stressCrowd)
        {
            // a load or a new week made the crowd again: the old extra people went with it
            stress.Clear();
            stressCrowd = crowd;
        }
        if (crowd == null || town?.Walk == null || (stress.Count == 0 && StressTarget == 0)) return;
        var eye = Main.I.Cam.GlobalPosition;
        for (int i = stress.Count - 1; i >= 0; i--)
        {
            var p = stress[i];
            if (!crowd.Alive(p)) { stress.RemoveAt(i); continue; }
            if (Whereabouts.Hypot(p.X - eye.X, p.Z - eye.Z) > 78) { Recycle(p); continue; }
            if (!crowd.PuppetBusy(p) && Spot(crowd, town.Walk, eye, 50) is { } to) crowd.PuppetGo(p, to.x, to.z);
        }
        for (int i = 0; i < 8 && stress.Count < StressTarget; i++)
        {
            if (Spot(crowd, town.Walk, eye, 60) is not { } q || Whereabouts.Hypot(q.x - eye.X, q.z - eye.Z) < 4) continue;
            var p = crowd.AddPuppet(StressKinds[rng.Next(StressKinds.Length)], q.x, q.z, rng.NextDouble() * Math.Tau);
            if (p == null) break;
            stress.Add(p);
            if (Spot(crowd, town.Walk, eye, 50) is { } to) crowd.PuppetGo(p, to.x, to.z);
        }
    }

    /// <summary>A free open street point round (x, z), on the crowd's grid, with nobody on it.</summary>
    private (double x, double z)? Spot(Crowd crowd, WalkMap walk, Vector3 at, double r)
    {
        for (int t = 0; t < 12; t++)
        {
            double x = at.X + (rng.NextDouble() * 2 - 1) * r, z = at.Z + (rng.NextDouble() * 2 - 1) * r;
            if (crowd.OnGrid(x, z) && crowd.CanStand(x, z) && walk.Open(x, z) && !crowd.SomeoneAt(x, z) && !Water.In((float)x, (float)z)) return (x, z);
        }
        return null;
    }

    // ------------------------------------------------------------------ the keys

    public override void _Input(InputEvent e)
    {
        if (e is not InputEventKey { Pressed: true, Echo: false } k || k.Keycode is not (Key.F8 or Key.F9 or Key.Escape)) return;
        if (k.Keycode == Key.Escape)
        {
            // without the menus (--no-mainmenu) nothing else closes the sheet
            if (MainMenu.I == null && DevSheet.IsOpen)
            {
                DevSheet.Close();
                GetViewport().SetInputAsHandled();
            }
            return;
        }
        if (!Prefs.DevMode || Loading.Busy || MainMenu.I?.KeyGrab != null || Jef.I == null) return;
        if (k.Keycode == Key.F8)
        {
            if (DevSheet.IsOpen) DevSheet.Close();
            else if (!Dialogs.Any()) DevSheet.Open();
            GetViewport().SetInputAsHandled();
            return;
        }
        // F9: only in play (or flying), never over a sheet or a window of the game
        bool play = MainMenu.I == null ? Dialogs.Count == 0 : MainMenu.I.InPlay;
        if (!play || Dialogs.Count > 0 || Dialogs.Any()) return;
        GD.Print("dev: " + ToggleFly());
        GetViewport().SetInputAsHandled();
    }

    public override void _Process(double delta)
    {
        if (flyLine != null && IsInstanceValid(flyLine) && flyLine.Visible)
        {
            if (Jef.I is not { Fly: true }) flyLine.Visible = false;
            else
            {
                var p = Main.I.Cam.GlobalPosition;
                flyLine.Text = $"DEV FLY  x {p.X:0}  y {p.Y:0}  z {p.Z:0}    {FlyKeys}, F9 land";
            }
        }
        if (GetTree().Paused) return;
        StressStep();
        WatchPending(delta);
    }
}
