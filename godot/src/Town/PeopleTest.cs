using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Player;

namespace Scheldemist.Town;

/// <summary>
/// The townspeople's self-test: `-- --peopletest dir` (with --server) sets a busy hour (10:30 unless --hour says
/// otherwise), goes to the Vismarkt and the Grote Markt, lets the town run some seconds at each, saves pictures (the
/// place, then one walker close from the front and from the side), times the frame with the people and without,
/// and writes peopletest.json: how many residents there are, how many are out, drawn and in view, the frame time,
/// what the people cost. If dir holds where_expected.json (tools/godot/wherecheck.mjs: the server's own sum for
/// every resident at a few hours) the C# sum is set against it. Then it quits.
/// </summary>
[GamePart(220)]
public partial class PeopleTest : Node
{
    private string dir = "";
    private Townspeople town = null!;
    private readonly List<string> wanted = new() { "vismarkt", "grote markt" };
    private readonly List<Dictionary<string, object>> rows = new();
    private Dictionary<string, object>? where;
    private Dictionary<string, object> row = new();
    private int place = -1;
    private string phase = "load";
    private double t;
    private int frames;
    private ulong last;
    private readonly List<double> times = new();
    private readonly List<double> logic = new();
    private Puppet? model;
    private JsonElement placeFacts;
    private double waited;
    private bool aimed;
    private int shotAt;
    private readonly Dictionary<Puppet, (double x, double z, bool walk)> before = new();

    public override void _Ready()
    {
        dir = Main.I.Arg("peopletest", "");
        if (dir == "")
        {
            SetProcess(false);
            return;
        }
        Directory.CreateDirectory(dir);
        town = GetParent().GetNode<Townspeople>("Townspeople");
        if (Main.I.Arg("hour", "") == "") town.SetClock(1, 10.5);
        // the test's camera stands in the street at eye height: it is not a body to walk round
        town.PlayerBody = () => null;
        DisplayServer.WindowSetVsyncMode(DisplayServer.VSyncMode.Disabled);
        Engine.MaxFps = 0;
    }

    private void Fail(string why)
    {
        GD.PrintErr("peopletest: " + why);
        File.WriteAllText(Path.Combine(dir, "peopletest.json"), JsonSerializer.Serialize(new { ok = false, why, status = town.Status }));
        GetTree().Quit(1);
        SetProcess(false);
    }

    private void Shot(string name) => Main.I.View.GetTexture().GetImage().SavePng(Path.Combine(dir, name));

    private void Next(string p)
    {
        phase = p;
        t = 0;
        frames = 0;
    }

    private bool Go()
    {
        place++;
        if (place >= wanted.Count) return false;
        placeFacts = default;
        foreach (var p in Main.I.World.Facts.RootElement.GetProperty("places").EnumerateArray())
            if (p.GetProperty("place").GetString() == wanted[place]) placeFacts = p;
        view = null;
        if (placeFacts.ValueKind != JsonValueKind.Object)
        {
            // not a place of this bake: a view of the town's own place of that name, from open ground at its edge
            if (!town.Data!.Places.TryGetValue(wanted[place].Replace(' ', '_'), out var pl)) return Go();
            for (int i = 0; i < 16 && view == null; i++)
            {
                double a = i * Math.PI / 8, d = Math.Max(8, pl.R * 0.8);
                double x = pl.X + Math.Sin(a) * d, z = pl.Z + Math.Cos(a) * d;
                if (town.Walk!.Open(x, z) && town.Walk.Free(x, z)) view = (new Vector3((float)x, (float)town.Walk.BaseAt(x, z) + 1.6f, (float)z), new Vector3((float)pl.X, 1.2f, (float)pl.Z));
            }
            if (view == null) return Go();
        }
        Home();
        aimed = false;
        shotAt = 0;
        town.Refill();
        row = new Dictionary<string, object> { ["place"] = wanted[place] };
        return true;
    }

    private (Vector3 from, Vector3 to)? view;

    /// <summary>The camera at the bake's view of the place.</summary>
    private void Home()
    {
        var cam = Main.I.Cam;
        if (view != null)
        {
            cam.LookAtFromPosition(view.Value.from, view.Value.to, Vector3.Up);
            return;
        }
        var pos = placeFacts.GetProperty("pos");
        var q = placeFacts.GetProperty("quat");
        cam.Position = new Vector3(pos[0].GetSingle(), pos[1].GetSingle(), pos[2].GetSingle());
        if (cam is FlyCam fly) fly.Face(new Quaternion(q[0].GetSingle(), q[1].GetSingle(), q[2].GetSingle(), q[3].GetSingle()));
    }

    private static Dictionary<string, object> Stats(List<double> v)
    {
        var s = v.OrderBy(x => x).ToList();
        return new Dictionary<string, object> { ["mean"] = Math.Round(s.Average(), 3), ["p95"] = Math.Round(s[(int)(s.Count * 0.95)], 3), ["max"] = Math.Round(s[^1], 3) };
    }

    public override void _Process(double delta)
    {
        t += delta;
        frames++;
        ulong now = Time.GetTicksUsec();
        double ms = (now - last) / 1000.0;
        last = now;
        var crowd = town.Crowd;
        switch (phase)
        {
            case "load":
                if (town.Data != null && town.WaysWaiting >= 0) Next("where");
                else if (t > 90) Fail("the town did not load: " + town.Status);
                break;
            case "where":
                // every way the sums ask for must be in before they are compared (asked for in the background)
                if (!File.Exists(Path.Combine(dir, "where_expected.json")))
                {
                    Next("warm");
                    break;
                }
                waited += delta;
                if (waited < 1 && frames > 1) break;
                waited = 0;
                where = WhereCheck(Path.Combine(dir, "where_expected.json"));
                if (town.WaysWaiting == 0 || t > 60) Next("warm");
                break;
            case "warm":
                if (!Go() && rows.Count > 0)
                {
                    Next("done");
                    break;
                }
                if (place >= wanted.Count)
                {
                    Fail("neither the Vismarkt nor the Grote Markt is a place of this bake or town");
                    break;
                }
                Next("run");
                break;
            case "run":
                // some seconds of the town living there; the view turns to where most of them are
                if (t >= 2 && !aimed && crowd!.Walking.Count > 0)
                {
                    aimed = true;
                    var cp = Main.I.Cam.GlobalPosition;
                    // (someone may stand right where the camera is: Jef's body would have him step aside; the test's camera steps aside itself)
                    for (int i = 0; i < 48 && crowd.Walking.Any(p => Whereabouts.Hypot(p.X - cp.X, p.Z - cp.Z) < 2.5); i++)
                    {
                        double a = i * 0.7, d = 2 + i * 0.25;
                        double x = Main.I.Cam.GlobalPosition.X + Math.Sin(a) * d, z = Main.I.Cam.GlobalPosition.Z + Math.Cos(a) * d;
                        if (town.Walk!.Free(x, z)) cp = new Vector3((float)x, (float)town.Walk.BaseAt(x, z) + 1.6f, (float)z);
                    }
                    var near = crowd.Walking.OrderBy(p => Whereabouts.Hypot(p.X - cp.X, p.Z - cp.Z)).Skip(1).Take(14).ToList();
                    if (near.Count > 0) Main.I.Cam.LookAtFromPosition(cp, new Vector3((float)near.Average(p => p.X), 1.0f, (float)near.Average(p => p.Z)), Vector3.Up);
                }
                foreach (int sec in new[] { 4, 5, 6 })
                    if (t >= sec && shotAt < sec)
                    {
                        shotAt = sec;
                        Shot($"people_{wanted[place].Replace(' ', '_')}_t{sec}.png");
                    }
                if (t >= 3 && before.Count == 0)
                    foreach (var p in crowd!.Walking) before[p] = (p.X, p.Z, p.State == "walk");
                if (t < 7) break;
                // walkers who did not get anywhere in four seconds, and bodies where no body fits
                row["walkersNotMoving"] = crowd!.Walking.Count(p => p.State == "walk" && before.TryGetValue(p, out var b) && b.walk && Whereabouts.Hypot(p.X - b.x, p.Z - b.z) < 0.5);
                row["standingWhereNoBodyFits"] = crowd.Walking.Count(p => !town.Walk!.Free(p.X, p.Z));
                before.Clear();
                Shot($"people_{wanted[place].Replace(' ', '_')}_wide.png");
                times.Clear();
                logic.Clear();
                Next("time");
                break;
            case "time":
                if (frames > 5)
                {
                    times.Add(ms);
                    logic.Add(town.LogicMs);
                }
                if (frames < 245) break;
                row["residents"] = town.Data!.Residents.Count;
                row["simulated"] = town.Sims.Count;
                row["employersAmongThem"] = town.EmployerResidents.Count;
                row["outInTheStreet"] = town.Sims.Count(s => !s.Inside);
                row["drawn"] = town.Sims.Count(s => s.P != null);
                row["inView"] = crowd!.Drawn;
                row["animatedThisFrame"] = crowd.Animated;
                row["walking"] = crowd.Walking.Count(p => p.State == "walk");
                row["overlaps"] = crowd.Overlaps();
                row["feetOffTheGroundMaxM"] = Math.Round(crowd.Walking.Max(p => Math.Abs(p.Group.Position.Y - town.Walk!.BaseAt(p.X, p.Z))), 3);
                row["frame"] = Stats(times);
                row["logicMs"] = Stats(logic);
                row["drawCalls"] = RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalDrawCallsInFrame);
                // the same view without them
                town.Paused = true;
                foreach (var p in crowd.Walking) p.Group.Visible = false;
                times.Clear();
                Next("bare");
                break;
            case "bare":
                if (frames > 5) times.Add(ms);
                if (frames < 245) break;
                row["frameWithoutPeople"] = Stats(times);
                row["drawCallsWithoutPeople"] = RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalDrawCallsInFrame);
                row["peopleCostMs"] = Math.Round((double)((Dictionary<string, object>)row["frame"])["mean"] - (double)((Dictionary<string, object>)row["frameWithoutPeople"])["mean"], 3);
                town.Paused = false;
                Next("pick");
                break;
            case "pick":
            {
                if (frames < 3) break;
                // someone walking, a few metres off, in view
                var cp = Main.I.Cam.GlobalPosition;
                model = crowd!.Walking.Where(p => p.Shown && p.State == "walk").OrderBy(p => Math.Abs(Whereabouts.Hypot(p.X - cp.X, p.Z - cp.Z) - 8)).FirstOrDefault()
                    ?? crowd.Walking.Where(p => p.Shown).OrderBy(p => Whereabouts.Hypot(p.X - cp.X, p.Z - cp.Z)).FirstOrDefault();
                if (model == null)
                {
                    row["closeShots"] = "nobody in view";
                    rows.Add(row);
                    Next("warm");
                    break;
                }
                row["closeShotOf"] = $"{model.Kind}, {model.State}, {model.Human.Motion}";
                Close(3.0, 0);
                Next("front");
                break;
            }
            case "front":
                Close(3.0, 0);
                if (frames < 4) break;
                Shot($"people_{wanted[place].Replace(' ', '_')}_front.png");
                Close(3.0, Math.PI / 2);
                Next("side");
                break;
            case "side":
                Close(3.0, Math.PI / 2);
                if (frames < 4) break;
                Shot($"people_{wanted[place].Replace(' ', '_')}_side.png");
                rows.Add(row);
                Next("warm");
                break;
            case "done":
                File.WriteAllText(Path.Combine(dir, "peopletest.json"), JsonSerializer.Serialize(new
                {
                    ok = true,
                    day = town.Day,
                    hour = Math.Round(town.Hour, 3),
                    maxDrawn = town.MaxPuppets,
                    bakedPeopleHidden = town.BakedHidden,
                    peopleModelLoadMs = Math.Round(People.Humans.LoadMs, 1),
                    routesWorkedOut = Whereabouts.RoutesMade,
                    whereCheck = where,
                    places = rows,
                }, new JsonSerializerOptions { WriteIndented = true }));
                GD.Print("peopletest: written " + Path.Combine(dir, "peopletest.json"));
                SetProcess(false);
                GetTree().Quit();
                break;
        }
    }

    /// <summary>The camera at eye height, `dist` metres from the model, `turn` round from his front (or near that, on open ground), looking at his chest.</summary>
    private void Close(double dist, double turn)
    {
        var p = model!;
        double y = town.Walk!.BaseAt(p.X, p.Z);
        foreach (double off in new[] { 0, 0.35, -0.35, 0.7, -0.7 })
        {
            double a = p.Yaw + turn + off;
            double x = p.X + Math.Sin(a) * dist, z = p.Z + Math.Cos(a) * dist;
            if (!town.Walk.Free(x, z) || !town.Walk.Open(x, z)) continue;
            Main.I.Cam.LookAtFromPosition(new Vector3((float)x, (float)(y + 1.35), (float)z), new Vector3((float)p.X, (float)(y + 0.95 * p.Size), (float)p.Z), Vector3.Up);
            return;
        }
        double fa = p.Yaw + turn;
        Main.I.Cam.LookAtFromPosition(new Vector3((float)(p.X + Math.Sin(fa) * dist), (float)(y + 1.35), (float)(p.Z + Math.Cos(fa) * dist)), new Vector3((float)p.X, (float)(y + 0.95 * p.Size), (float)p.Z), Vector3.Up);
    }

    /// <summary>The C# sum against the server's own (tools/godot/wherecheck.mjs): every resident at every hour of the file.</summary>
    private Dictionary<string, object> WhereCheck(string file)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(file));
        int day = doc.RootElement.GetProperty("day").GetInt32();
        var byId = town.Data!.Residents.ToDictionary(r => r.Id);
        int n = 0, same = 0, cart = 0, missing = 0;
        double worst = 0;
        var wrong = new List<string>();
        foreach (var e in doc.RootElement.GetProperty("rows").EnumerateArray())
        {
            string id = e.GetProperty("id").GetString()!;
            if (!byId.TryGetValue(id, out var r))
            {
                missing++;
                continue;
            }
            // (the mill's man on a run with his cart goes by the cart's timetable: shared/mills.ts, not ported yet)
            if (e.GetProperty("cart").GetBoolean())
            {
                cart++;
                continue;
            }
            n++;
            double hour = e.GetProperty("hour").GetDouble();
            var w = town.WhereOf(r, day, hour)!;
            double d = Whereabouts.Hypot(w.X - e.GetProperty("x").GetDouble(), w.Z - e.GetProperty("z").GetDouble());
            bool ok = d < 0.01 && w.Indoor == e.GetProperty("indoor").GetBoolean() && w.Moving == e.GetProperty("moving").GetBoolean() && w.Act == e.GetProperty("act").GetString() && w.Place == e.GetProperty("place").GetString() && w.Stop == e.GetProperty("stop").GetInt32();
            worst = Math.Max(worst, d);
            if (ok) same++;
            else if (wrong.Count < 12) wrong.Add($"{id} at {hour}: {d:F2} m off, {w.Act}:{w.Place} stop {w.Stop} moving {w.Moving} (server {e.GetProperty("act").GetString()}:{e.GetProperty("place").GetString()} stop {e.GetProperty("stop").GetInt32()} moving {e.GetProperty("moving").GetBoolean()})");
        }
        return new Dictionary<string, object> { ["answers"] = n, ["same"] = same, ["worstM"] = Math.Round(worst, 3), ["onACartRunSkipped"] = cart, ["notInThisTown"] = missing, ["waysStillAskedFor"] = town.WaysWaiting, ["different"] = wrong };
    }
}
