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

/// <summary>The Godot test kit. --dev-command runs semicolon-separated console commands; F9 opens it with --dev.</summary>
[GamePart(950)]
public partial class Kit : Node
{
    public static Kit I { get; private set; } = null!;
    public bool IsReady { get; private set; }
    public string Error { get; private set; } = "";
    private bool started, busy;
    private LineEdit? console;
    private bool previousTestInput;
    private Input.MouseModeEnum previousMouse;
    private readonly Dictionary<Townspeople.Sim, (Townspeople.Goal goal, string key)> held = new();
    public Townspeople? People => Main.I.GetNodeOrNull<Townspeople>("Townspeople");
    private Api Api => ServerLink.I?.Api ?? throw new InvalidOperationException("the server is not ready");
    public Kit() => I = this;
    public override void _Ready()
    {
        if (!Main.I.Flag("dev") && Main.I.Arg("dev-command") == "") return;
        console = new LineEdit { PlaceholderText = "hour 13 clear; go vismarkt; summon fishwife; job {\"type\":\"carry\"}; clear", Visible = false, Position = new Vector2(20, 260), Size = new Vector2(1100, 45) };
        Main.I.Ui.AddChild(console);
        console.TextSubmitted += async text =>
        {
            if (busy) return;
            busy = true;
            try { await Commands(text); console.Text = ""; }
            catch (Exception e) { GD.PrintErr("dev: " + e.Message); }
            finally { busy = false; }
        };
    }
    public override void _UnhandledKeyInput(InputEvent e)
    {
        if (console == null || e is not InputEventKey { Pressed: true, Echo: false, Keycode: Key.F9 }) return;
        if (!console.Visible) { previousTestInput = Jef.I.TestInput; previousMouse = Input.MouseMode; }
        console.Visible = !console.Visible;
        Jef.I.TestInput = console.Visible || previousTestInput;
        Jef.I.ClearKeys();
        Input.MouseMode = console.Visible ? Input.MouseModeEnum.Visible : previousMouse;
        if (console.Visible) console.GrabFocus();
        GetViewport().SetInputAsHandled();
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
    public async Task Light(double hour = 13, string weather = "clear")
    {
        if (hour < 0 || hour >= 24 || !new[] { "clear", "fog", "mist", "rain", "storm" }.Contains(weather)) throw new ArgumentException("hour 0..24 and a known weather required");
        var p = await Api.Post<JobsPayload>("api/dev/set", new { hour = (int)hour, minute = (int)Math.Round((hour % 1) * 60), weather, food = 10, warmth = 10, sleep = 10, health = 10 });
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
    public async Task Commands(string text)
    {
        foreach (string command in text.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            int split = command.IndexOf(' ');
            string verb = split < 0 ? command : command[..split], arg = split < 0 ? "" : command[(split + 1)..];
            switch (verb)
            {
                case "hour": var a = arg.Split(' '); await Light(double.Parse(a[0], CultureInfo.InvariantCulture), a.Length > 1 ? a[1] : GameState.I.Weather); break;
                case "weather": await Light(GameState.I.HourF, arg); break;
                case "go": Go(arg); break;
                case "summon": GD.Print("dev summoned " + Summon(arg)); break;
                case "job": GD.Print("dev job " + await Job(arg)); break;
                case "skip": GameState.I.Apply(await Api.Post<JobsPayload>("api/dev/advance", new { minutes = int.Parse(arg, CultureInfo.InvariantCulture) })); break;
                case "clear": Clear(); break;
                default: throw new ArgumentException("commands: hour, weather, go, summon, job, skip, clear");
            }
            GD.Print("dev: " + command);
        }
    }
}
