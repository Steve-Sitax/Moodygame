using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Play;
using Scheldemist.Player;
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.Dev;

/// <summary>
/// The Godot test kit. --dev-command runs semicolon-separated console commands at the start; in dev mode the console
/// (the key left of 1, Dev/DevConsole.cs) and the Dev sheet's line (F8, Dev/DevSheet.cs) run them too.
/// </summary>
[GamePart(950)]
public partial class Kit : Node
{
    public static Kit I { get; private set; } = null!;
    public bool IsReady { get; private set; }
    public string Error { get; private set; } = "";
    private bool started;
    private readonly Dictionary<Townspeople.Sim, (Townspeople.Goal goal, string key)> held = new();
    public Townspeople? People => Main.I.GetNodeOrNull<Townspeople>("Townspeople");
    private Api Api => ServerLink.I?.Api ?? throw new InvalidOperationException("the server is not ready");
    public Kit() => I = this;
    public const string Help = "commands: help, dev on|off; in dev mode: hour 13 [clear], weather rain, go vismarkt | go -118 36, summon fishwife, clear, job {...}, skip 10, tide high|low|clock, event musicians, pass canal|vliet, lock in|out, fog on|off, shower on|off, fly, where (place and view on screen), ruien [area] (Jef on a Ruien ledge)";
    public override void _Ready()
    {
        ProcessMode = ProcessModeEnum.Always; // the console works over the paused town too
    }
    /// <summary>Run console commands and say how it went (an error is the answer, not a throw).</summary>
    public async Task<string> Run(string text)
    {
        try
        {
            var said = await Commands(text);
            return said.Count > 0 ? string.Join(" ", said) : "done: " + text;
        }
        catch (Exception e)
        {
            GD.PrintErr("dev: " + e.Message);
            return "failed: " + e.Message;
        }
    }
    public override void _Process(double delta)
    {
        // Reschedule only replaces a goal when its key changes. Keep summoned residents on the dev goal.
        foreach (var s in held.Keys)
        {
            var now = Whereabouts.ActivityAt(s.R.Sched, People!.Day, People.Hour);
            s.Key = $"{now.Act}:{now.Place}";
        }
        if (started || !GameState.I.Live || People?.Data == null) return;
        started = true;
        _ = Start();
    }
    private async Task Start()
    {
        try
        {
            string commands = Main.I.Arg("dev-command");
            if (commands != "") await Commands(commands);
            IsReady = true;
        }
        catch (Exception e) { Error = e.Message; GD.PrintErr("dev: " + Error); }
    }
    /// <summary>The clock and the weather through the server (`fill`: Jef's needs full too, as the checks want).</summary>
    public async Task Light(double hour = 13, string weather = "clear", bool fill = true, int day = 0)
    {
        if (hour < 0 || hour >= 24 || !new[] { "clear", "fog", "mist", "rain", "storm" }.Contains(weather)) throw new ArgumentException("hour 0..24 and a known weather required");
        int whole = (int)hour, minute = (int)Math.Round((hour % 1) * 60);
        if (minute == 60) { whole = (whole + 1) % 24; minute = 0; }
        // (day > 0: the game's day too, 1 Monday to 7 Sunday)
        var set = new Dictionary<string, object> { ["hour"] = whole, ["minute"] = minute, ["weather"] = weather };
        if (day > 0) set["day"] = day;
        if (fill) foreach (var need in new[] { "food", "warmth", "sleep", "health" }) set[need] = 10;
        var p = await Api.Post<JobsPayload>("api/dev/set", set);
        GameState.I.Apply(p);
        if (Movers.MoverClock.Held) Movers.MoverClock.Hold(hour, GameState.I.Day);
        Daylight.I.SetTime((float)hour);
        Daylight.I.SetWeather(weather);
        Daylight.I.Settle();
        People?.SetClock(GameState.I.Day, hour);
    }
    public void Go(string place)
    {
        var a = place.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        double x, z;
        if (a.Length >= 2 && double.TryParse(a[0], NumberStyles.Float, CultureInfo.InvariantCulture, out x) && double.TryParse(a[1], NumberStyles.Float, CultureInfo.InvariantCulture, out z)) { }
        else if (Spots.Get(place) is { } spot) { x = spot.X; z = spot.Z; }
        else if (People?.Data?.Places.FirstOrDefault(p => p.Key.Equals(place, StringComparison.OrdinalIgnoreCase) || p.Value.Label.Equals(place, StringComparison.OrdinalIgnoreCase)).Value is { } p) { x = p.X; z = p.Z; }
        else if (TownMap.I?.NamedPlace(place) is { } named) { x = named.X; z = named.Y; }
        else throw new ArgumentException("no place called " + place);
        var q = FreeNear(x, z);
        Jef.I.Place((float)q.X, (float)q.Z, 0, near: Jef.I.GroundAt((float)q.X, (float)q.Z, (float)People!.Walk!.BaseAt(q.X, q.Z)));
        People.Refill();
    }
    public Pt FreeNear(double x, double z, bool crowd = false)
    {
        var w = People?.Walk ?? throw new InvalidOperationException("walk dump missing");
        for (double r = 0; r <= 8; r += 0.5)
            for (int i = 0; i < 16; i++)
            {
                double a = i * Math.PI / 8, xx = x + Math.Cos(a) * r, zz = z + Math.Sin(a) * r;
                if (!w.Free(xx, zz) || crowd && !w.Open(xx, zz)) continue;
                float ground = Jef.I.GroundAt((float)xx, (float)zz, (float)w.BaseAt(xx, zz));
                if (!float.IsFinite(ground) || Water.In((float)xx, (float)zz) && ground < Water.Level((float)xx, (float)zz) + 0.1f) continue;
                if (Jef.I.BodyFree((float)xx, ground, (float)zz)) return new Pt(xx, zz);
            }
        throw new InvalidOperationException($"no free ground near {x}, {z}");
    }
    public string Summon(string query)
    {
        var t = People ?? throw new InvalidOperationException("town not ready");
        var s = t.Sims.FirstOrDefault(s => (s.R.Id + " " + s.R.Name + " " + s.R.Trade).Contains(query, StringComparison.OrdinalIgnoreCase)) ?? throw new ArgumentException("no resident called " + query);
        var q = FreeNear(Jef.I.X - Math.Sin(Jef.I.Yaw) * 3, Jef.I.Z - Math.Cos(Jef.I.Yaw) * 3, crowd: true);
        if (!held.ContainsKey(s)) held[s] = (s.Goal, s.Key);
        if (s.P != null) t.Crowd!.RemovePuppet(s.P);
        s.P = t.Crowd!.AddPuppet(s.Kind, q.X, q.Z, Math.Atan2(Jef.I.X - q.X, Jef.I.Z - q.Z));
        if (s.P == null) throw new InvalidOperationException("the resident's model could not be drawn");
        s.X = q.X; s.Z = q.Z; s.Inside = false; s.Plain = false;
        s.Goal = new Townspeople.Goal { Mode = "stand", X = q.X, Z = q.Z, Motion = "idle", Yaw = s.P.Yaw };
        t.Crowd.PuppetStand(s.P, "idle", s.P.Yaw);
        return s.R.Id;
    }
    public void Clear()
    {
        foreach (var (s, old) in held) { s.Goal = old.goal; s.Key = "dev-release"; }
        held.Clear();
    }
    public async Task<int> Job(string json)
    {
        using var spec = JsonDocument.Parse(json);
        var r = await Api.Post<JsonElement>("api/dev/job", spec.RootElement);
        int id = r.GetProperty("id").GetInt32();
        GameState.I.Apply(await Api.Jobs());
        await Jobs.I.TakeJob(GameState.I.Jobs.First(j => j.Id == id));
        if (Jobs.I.Active?.Id != id) throw new InvalidOperationException("the job was not taken");
        if (JobTask.Of(Jobs.I.Active) is { } task && Spots.Get(task.From ?? task.Post) is { } from) Go(from.Id);
        return id;
    }
    /// <summary>
    /// W1 tide kit: hold the river (with the canal and the vlieten) at a level in metres (quay top 0), at spring
    /// "high" or "low" water, or let it follow the "clock" again. The drawn water eases there at 0.6 m a second.
    /// </summary>
    public static string TideHold(string arg)
    {
        string a = arg.Trim().ToLowerInvariant();
        if (a == "clock")
        {
            Tide.Hold(null);
            Tide.Set(Movers.MoverClock.Day, (float)Movers.MoverClock.HourF);
        }
        else if (a == "high") Tide.Hold(Tide.HwMax);
        else if (a == "low") Tide.Hold(Tide.LwMin);
        else if (float.TryParse(a, NumberStyles.Float, CultureInfo.InvariantCulture, out float y) && float.IsFinite(y)) Tide.Hold(y);
        else throw new ArgumentException("tide <y|high|low|clock>");
        return $"the river {(Tide.Held is { } h ? $"held at {h:0.00}" : $"by the clock, at {Tide.River:0.00}")} (the drawn water now {Waters.Level:0.00}), the dock {Tide.Dock:0.00}, the lock {Tide.ChamberA:0.00} / {Tide.ChamberB:0.00}";
    }

    /// <summary>Run semicolon-separated commands (Help lists them); the answers of those that have one.</summary>
    public async Task<List<string>> Commands(string text)
    {
        var said = new List<string>();
        foreach (string command in text.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            int split = command.IndexOf(' ');
            string verb = split < 0 ? command : command[..split], arg = split < 0 ? "" : command[(split + 1)..].Trim();
            var tools = DevTools.I;
            switch (verb)
            {
                case "hour": var a = arg.Split(' '); await Light(double.Parse(a[0], CultureInfo.InvariantCulture), a.Length > 1 ? a[1] : GameState.I.Weather); break;
                case "weather": await Light(GameState.I.HourF, arg); break;
                case "go": Go(arg); break;
                case "summon": said.Add("summoned " + Summon(arg)); break;
                case "job": said.Add("job " + await Job(arg)); break;
                case "skip": GameState.I.Apply(await Api.Post<JobsPayload>("api/dev/advance", new { minutes = int.Parse(arg, CultureInfo.InvariantCulture) })); break;
                case "clear": Clear(); break;
                case "tide" when tools != null: said.Add(tools.TideHold(arg)); break;
                case "event" when tools != null: said.Add(await tools.Event(arg)); break;
                case "pass" when tools != null: said.Add(tools.Passage(arg)); break;
                case "lock" when tools != null: said.Add(tools.LockPass(arg)); break;
                case "fog" when tools != null: said.Add(tools.ThickFog(arg != "off")); break;
                case "shower" when tools != null: said.Add(tools.Shower(arg != "off")); break;
                case "fly" when tools != null: said.Add(tools.ToggleFly()); break;
                case "where": said.Add(WhereOverlay.Toggle(this)); break;
                // (the Ruien: Jef on an area's dev entry, docs/ruien-native.md; `ruien o2`)
                case "ruien": said.Add(World.Ruien.Ruien.I?.Enter(arg) ?? "no Ruien part"); break;
                default: throw new ArgumentException(Help);
            }
            GD.Print("dev: " + command);
        }
        return said;
    }
}
