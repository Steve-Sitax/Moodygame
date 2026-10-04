using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.People;
using Scheldemist.Player;

namespace Scheldemist.Town;

/// <summary>
/// The townspeople's self-test: `-- --peopletest dir` starts its own server and sets a busy hour (10:30 unless --hour says
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
    private readonly Dictionary<string, object> jefRow = new();
    private readonly Dictionary<string, object> postedRow = new();
    private int postedStep;
    private readonly Dictionary<string, object> goodsRow = new();
    private readonly List<(Puppet p, string what)> exhibits = new();
    private int goodsStep;
    private readonly Dictionary<string, object> layersRow = new();
    private Townspeople.Sim? millMan;
    private readonly Dictionary<string, object> roomsRow = new();
    private Indoors.House? room;
    private readonly Dictionary<string, object> animalsRow = new();
    private List<(string kind, double x, double z, string? owner)> beastShots = new();
    private int beastStep;
    private readonly Dictionary<string, object> wildlifeRow = new();
    private readonly Dictionary<string, object> hallsRow = new();
    private int hallStep;
    private ParkWildlife.Beast? bird;
    private Pt birdStart;
    private List<Node3D> hiddenForTiming = new();
    private double jefMin;
    private int jefBlocked;
    private (double x, double z) jefFrom;
    private int shotAt;
    private readonly Dictionary<Puppet, (double x, double z, bool walk)> before = new();
    private readonly List<Puppet> timingPeople = new();

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
        // the pictures are taken from the free camera (no body to walk round); Jef comes back for his own part of the test
        if (Scheldemist.Player.Jef.I is { Fly: false } jef) jef.ToggleFly();
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
        // the test holds the clock: the sky follows it (clear weather: the pictures are to be seen)
        if (Scheldemist.World.Daylight.I is { } sky)
        {
            sky.SetTime((float)town.Hour);
            if (sky.Weather != "clear") sky.SetWeather("clear");
        }
        switch (phase)
        {
            case "load":
                if (town.Data != null && town.WaysWaiting >= 0) Next(Main.I.Flag("peopleadvance") ? "advance" : Main.I.Arg("peoplechecks", "where"));
                else if (t > 90) Fail("the town did not load: " + town.Status);
                break;
            case "advance":
                if (frames != 1) break;
                if (Scheldemist.Net.ServerLink.I?.Api is not { } testApi) { Fail("the test has no server"); break; }
                testApi.Run(testApi.Post<JsonElement>("api/dev/set", new { day = 1, hour = 13, minute = 0 }), _ => Next(Main.I.Arg("peoplechecks", "where")), e => Fail("test clock setting: " + e.Message));
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
                // (a sum that asked for a way is worked out again once it is in: compared only when nothing is asked for)
                bool settled = town.WaysWaiting == 0;
                where = WhereCheck(Path.Combine(dir, "where_expected.json"));
                if ((where.TryGetValue("answers", out var checkedAnswers) && (int)checkedAnswers > 0 && (int)checkedAnswers == (int)where["same"]) || (settled && town.WaysWaiting == 0) || t > 60) Next("warm");
                break;
            case "reference":
                if (File.Exists(Path.Combine(dir, "where_expected.json"))) Next("where");
                else if (t > 60) Fail("the server reference file did not arrive");
                break;
            case "warm":
                if (!Go() && rows.Count > 0)
                {
                    Next(Scheldemist.Player.Jef.I != null ? "jef" : "done");
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
                if (frames == 1)
                {
                    // Time exactly 50 bodies, even when the chosen hour puts fewer residents near this view.
                    var eye = Main.I.Cam.GlobalPosition;
                    for (int i = 0; crowd!.Walking.Count < 50 && i < 100; i++)
                    {
                        var at = crowd.OpenNearFree(eye.X + Math.Sin(i * 2.399) * (6 + i * 0.2), eye.Z + Math.Cos(i * 2.399) * (6 + i * 0.2));
                        if (at == null) continue;
                        var extra = crowd.AddPuppet("docker_a", at.Value.x, at.Value.z);
                        if (extra == null) break;
                        crowd.PuppetStand(extra, "idle"); timingPeople.Add(extra);
                    }
                    town.MaxPuppets = 50 - timingPeople.Count;
                }
                if (frames > 5)
                {
                    times.Add(ms);
                    logic.Add(town.LogicMs);
                }
                if (frames < 245) break;
                row["residents"] = town.Data!.Residents.Count;
                row["simulated"] = town.Sims.Count;
                row["employersAtPosts"] = town.EmployerResidents.Count;
                row["outInTheStreet"] = town.Sims.Count(s => !s.Inside);
                row["drawn"] = crowd!.Walking.Count;
                row["timingExhibits"] = timingPeople.Count;
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
                hiddenForTiming = (PostedPeople.I?.List.Where(n => n.Present).Select(n => n.Group) ?? Enumerable.Empty<Node3D>())
                    .Concat(town.Indoors?.Groups ?? Enumerable.Empty<Node3D>()).Concat(HallPeople.I?.Groups ?? Enumerable.Empty<Node3D>()).Concat(HomeVisitors.I?.Groups ?? Enumerable.Empty<Node3D>()).Concat(Scheldemist.People.Animals.I?.Groups ?? Enumerable.Empty<Node3D>()).Concat(ParkWildlife.I?.Groups ?? Enumerable.Empty<Node3D>()).Where(g => g.Visible).ToList();
                foreach (var g in hiddenForTiming) g.Visible = false;
                row["postedIndoorsAndAnimalsDrawn"] = hiddenForTiming.Count;
                times.Clear();
                Next("bare");
                break;
            case "bare":
                if (frames > 5) times.Add(ms);
                if (frames < 245) break;
                row["frameWithoutPeople"] = Stats(times);
                row["drawCallsWithoutPeople"] = RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalDrawCallsInFrame);
                row["peopleAndAnimalsCostMs"] = Math.Round((double)((Dictionary<string, object>)row["frame"])["mean"] - (double)((Dictionary<string, object>)row["frameWithoutPeople"])["mean"], 3);
                town.Paused = false;
                foreach (var g in hiddenForTiming) g.Visible = true;
                foreach (var extra in timingPeople) crowd!.RemovePuppet(extra);
                timingPeople.Clear(); town.MaxPuppets = 50;
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
            case "jef":
            {
                // Jef among the people: he stands in a walker's way (they stop short and go round), then walks into
                // the crowd (the standing step aside). Nobody ends up in him.
                var jef = Scheldemist.Player.Jef.I;
                var cp = Main.I.Cam.GlobalPosition;
                model = crowd!.Walking.Where(p => p.State == "walk" && p.Path.Count > 0).OrderBy(p => Whereabouts.Hypot(p.X - cp.X, p.Z - cp.Z)).FirstOrDefault();
                if (model == null)
                {
                    jefRow["note"] = "nobody walking";
                    Next("done");
                    break;
                }
                var to = model.Path[Math.Min(model.Pi, model.Path.Count - 1)];
                double dx = to.x - model.X, dz = to.z - model.Z, len = Math.Max(0.01, Whereabouts.Hypot(dx, dz));
                double ahead = Math.Min(3.5, len * 0.6);
                if (jef.Fly) jef.ToggleFly();
                jef.TestInput = true;
                jef.ClearKeys();
                jef.Place((float)(model.X + dx / len * ahead), (float)(model.Z + dz / len * ahead), (float)Math.Atan2(dx, dz), 0, (float)town.Walk!.BaseAt(model.X, model.Z));
                jefRow["inTheWayOf"] = model.Kind;
                jefMin = double.PositiveInfinity;
                jefBlocked = 0;
                Next("jefstand");
                break;
            }
            case "jefstand":
            case "jefwalk":
            {
                var jef = Scheldemist.Player.Jef.I;
                foreach (var p in crowd!.Walking)
                {
                    jefMin = Math.Min(jefMin, Whereabouts.Hypot(p.X - jef.X, p.Z - jef.Z));
                    if (p.State == "blocked") jefBlocked++;
                }
                if (phase == "jefstand")
                {
                    if (frames == 400) Shot("people_jef_stand.png");
                    if (t < 7) break;
                    jefRow["standing"] = new Dictionary<string, object> { ["nearestAnyoneCameM"] = Math.Round(jefMin, 2), ["framesSomeoneWaitedForHim"] = jefBlocked, ["theWalkerGotPast"] = Whereabouts.Hypot(model!.X - jef.X, model.Z - jef.Z) > 1.2 };
                    // into the crowd: towards where most of them are
                    var near = crowd.Walking.OrderBy(p => Whereabouts.Hypot(p.X - jef.X, p.Z - jef.Z)).Take(12).ToList();
                    double cx = near.Average(p => p.X), cz = near.Average(p => p.Z);
                    jef.Place(jef.X, jef.Z, (float)Math.Atan2(jef.X - cx, jef.Z - cz), 0, jef.Y);
                    jef.SetKey(Key.W, true);
                    jefMin = double.PositiveInfinity;
                    jefBlocked = 0;
                    jefFrom = (jef.X, jef.Z);
                    Next("jefwalk");
                    break;
                }
                if (frames == 600) Shot("people_jef_walk.png");
                if (t < 6) break;
                jef.ClearKeys();
                jefRow["walking"] = new Dictionary<string, object> { ["nearestAnyoneCameM"] = Math.Round(jefMin, 2), ["framesSomeoneWaitedForHim"] = jefBlocked, ["jefWalkedM"] = Math.Round(Whereabouts.Hypot(jef.X - jefFrom.x, jef.Z - jefFrom.z), 1), ["overlaps"] = crowd.Overlaps() };
                jef.ToggleFly();
                Next("posted");
                break;
            }
            case "posted":
            {
                // the people at their posts: Sooi at the Hessenatie's door and the fish merchant on the Vismarkt, close;
                // Jef walks at Sooi and is held (he is solid), and Sooi turns to look at him
                var posted = Scheldemist.People.PostedPeople.I;
                if (posted == null || posted.List.Count == 0)
                {
                    if (t < 3) break;
                    postedRow["note"] = "no posted people";
                    Next("goods");
                    break;
                }
                if (frames < 3) break;
                postedRow["posted"] = posted.List.Count;
                postedRow["atTheirPostNow"] = posted.List.Where(n => n.Present).Select(n => n.Id).ToList();
                postedRow["notInTheTownsList"] = posted.List.Count(n => n.Resident != null && town.Sims.All(s => s.R != n.Resident));
                postedStep = 0;
                Next("postedshots");
                break;
            }
            case "postedshots":
            {
                var posted = Scheldemist.People.PostedPeople.I!;
                string[] who = { "sooi", "vishandel", "fientje" };
                if (postedStep >= who.Length)
                {
                    Next("postedjef");
                    break;
                }
                var n = posted.Get(who[postedStep]);
                if (n == null || !n.Present)
                {
                    postedStep++;
                    break;
                }
                if (frames == 1)
                {
                    // from his front, a little to the side, on ground a body fits on
                    foreach (double off in new[] { 0.4, -0.4, 0.9, -0.9, 0 })
                    {
                        double a = n.Anchor.yaw + off, x = n.X + Math.Sin(a) * 2.8, z = n.Z + Math.Cos(a) * 2.8;
                        if (off != 0 && !town.Walk!.Free(x, z)) continue;
                        Main.I.Cam.LookAtFromPosition(new Vector3((float)x, (float)n.Y + 1.4f, (float)z), new Vector3((float)n.X, (float)n.Y + 0.95f, (float)n.Z), Vector3.Up);
                        break;
                    }
                }
                if (frames < 400) break;
                Shot($"people_posted_{n.Id}.png");
                postedStep++;
                Next("postedshots");
                break;
            }
            case "postedjef":
            {
                var posted = Scheldemist.People.PostedPeople.I!;
                var jef = Scheldemist.Player.Jef.I;
                var n = posted.Get("sooi");
                if (n == null || !n.Present)
                {
                    Next("goods");
                    break;
                }
                if (frames == 1)
                {
                    // four metres to his left, walking straight at him
                    double a = n.Anchor.yaw + Math.PI / 2, x = n.X + Math.Sin(a) * 4, z = n.Z + Math.Cos(a) * 4;
                    if (jef.Fly) jef.ToggleFly();
                    jef.TestInput = true;
                    jef.ClearKeys();
                    jef.Place((float)x, (float)z, (float)Math.Atan2(x - n.X, z - n.Z), 0, (float)n.Y);
                    jef.SetKey(Key.W, true);
                    jefMin = double.PositiveInfinity;
                }
                jefMin = Math.Min(jefMin, Whereabouts.Hypot(n.X - jef.X, n.Z - jef.Z));
                if (t < 6) break;
                Shot("people_posted_sooi_looks_at_jef.png");
                double facing = Math.Atan2(jef.X - n.X, jef.Z - n.Z);
                postedRow["jefWalkedAtSooi"] = new Dictionary<string, object>
                {
                    ["nearestHeGotM"] = Math.Round(jefMin, 2),
                    ["sooiLooksAtHimOffByRad"] = Math.Round(Math.Abs(Math.Atan2(Math.Sin(facing - n.Yaw), Math.Cos(facing - n.Yaw))), 2),
                };
                jef.ClearKeys();
                jef.ToggleFly();
                Next("goods");
                break;
            }
            case "goods":
            {
                // carried goods and tools, each close: a row of walkers on the Grote Markt with a sack, a crate, a box of
                // fish and a keg in the arms, the docker with the sack on his shoulder, the porter with his sack truck,
                // the carter pushing his handcart
                if (!town.Data!.Places.TryGetValue("grote_markt", out var gm))
                {
                    Next("done");
                    break;
                }
                town.SetClock(1, 10.5);
                string[][] show = { new[] { "docker_a", "sack" }, new[] { "docker_b", "crate" }, new[] { "docker_c", "fishbox" }, new[] { "docker_a", "keg" }, new[] { "docker_sack", "" }, new[] { "porter", "" }, new[] { "carter", "" } };
                exhibits.Clear();
                // a free lane to walk along
                (double x, double z, double dx, double dz) lane = (gm.X, gm.Z, 0, 1);
                for (int i = 0; i < 16; i++)
                {
                    double a = i * Math.PI / 8;
                    bool ok = true;
                    for (double d = -4; d <= 30 && ok; d += 1)
                        for (double w = -13; w <= 13 && ok; w += 2) ok = town.Walk!.Free(gm.X + Math.Cos(a) * w + Math.Sin(a) * d, gm.Z - Math.Sin(a) * w + Math.Cos(a) * d);
                    if (!ok) continue;
                    lane = (gm.X, gm.Z, Math.Sin(a), Math.Cos(a));
                    break;
                }
                for (int i = 0; i < show.Length; i++)
                {
                    // side by side across the lane, 2.4 m apart (the cart is wide), all walking the same way
                    double off = (i - show.Length / 2.0) * 3.6;
                    double x = lane.x + lane.dz * off, z = lane.z - lane.dx * off;
                    var p = crowd!.AddPuppet(show[i][0], x, z, Math.Atan2(lane.dx, lane.dz), 1.0, 1f);
                    if (p == null) continue;
                    if (show[i][1] != "") crowd.PuppetLoad(p, true, show[i][1]);
                    crowd.PuppetGo(p, x + lane.dx * 28, z + lane.dz * 28, 1.0);
                    exhibits.Add((p, show[i][1] != "" ? show[i][1] : show[i][0]));
                }
                goodsStep = 0;
                Next("goodswalk");
                break;
            }
            case "goodswalk":
            {
                if (t < 3 && goodsStep == 0)
                {
                    frames = 0;
                    break;
                }
                if (goodsStep >= exhibits.Count)
                {
                    goodsRow["shown"] = exhibits.Select(e => e.what).ToList();
                    goodsRow["loadsInArms"] = exhibits.Count(e => e.p.LoadNode != null);
                    goodsRow["cartsPushed"] = exhibits.Count(e => e.p.Cart != null);
                    goodsRow["sacksHungOnBones"] = exhibits.Count(e => e.p.Human.Root.FindChild("sack_on_*", true, false) != null);
                    // night: two of them take a lantern
                    town.SetClock(1, 22.5);
                    foreach (var e in exhibits.Take(5).Skip(3)) crowd!.PuppetLantern(e.p, true);
                    Next("goodsnight");
                    break;
                }
                model = exhibits[goodsStep].p;
                if (exhibits[goodsStep].what is "carter" or "porter") Close(3.4, -1.25);
                else Close(2.4, 0.75);
                if (frames < 40) break;
                Shot($"people_carry_{exhibits[goodsStep].what}.png");
                goodsStep++;
                Next("goodswalk");
                break;
            }
            case "goodsnight":
            {
                model = exhibits[Math.Min(3, exhibits.Count - 1)].p;
                Close(3.2, 0.5);
                if (t < 2.5) break;
                Shot("people_lantern.png");
                goodsRow["lanternLightsInThePool"] = LanternPool.Pool;
                goodsRow["lanternLightsLit"] = LanternPool.I?.Lit ?? 0;
                goodsRow["lanternsCarried"] = LanternPool.I?.Sources ?? 0;
                goodsRow["townspeopleWithALanternDrawn"] = town.Sims.Count(s => s.Lamp);
                foreach (var e in exhibits) crowd!.RemovePuppet(e.p);
                exhibits.Clear();
                Next("layers");
                break;
            }
            case "layers":
            {
                // the layers over the day plan. First the calls at the shops this hour, then the great storm on the Grote Markt
                town.SetClock(1, 10.5);
                if (t < 0.8) break;
                layersRow["callingAtAShopThisHour"] = town.Sims.Count(s => s.Key.Contains("|shop@"));
                if (town.Data!.Places.TryGetValue("grote_markt", out var gm))
                {
                    Main.I.Cam.LookAtFromPosition(new Vector3((float)gm.X + 14, 1.7f, (float)gm.Z + 10), new Vector3((float)gm.X - 6, 1.0f, (float)gm.Z - 4), Vector3.Up);
                    town.Refill();
                }
                Next("stormcalm");
                break;
            }
            case "stormcalm":
                if (t < 5) break;
                layersRow["outBeforeTheStorm"] = town.Sims.Count(s => !s.Inside);
                town.SetStorm(1);
                Next("storm");
                break;
            case "storm":
            {
                if (frames == 900) Shot("people_storm_running.png");
                if (t < 14) break;
                Shot("people_storm.png");
                var by = town.Sims.GroupBy(s => s.Shelter ?? "none").ToDictionary(g => g.Key, g => g.Count());
                layersRow["storm"] = new Dictionary<string, object>
                {
                    ["shelter"] = by,
                    ["stillOut"] = town.Sims.Count(s => !s.Inside),
                    ["drawnRunning"] = crowd!.Walking.Count(p => p.State == "walk" && p.Pace >= 2.2),
                    ["drawnUnderADoorway"] = town.Sims.Count(s => s.P != null && s.Shelter is "under" or "tavern" && s.P.State == "stand"),
                };
                // someone pressed into a doorway, close
                model = town.Sims.Where(s => s.P is { Shown: true, State: "stand" } && s.Shelter is "under" or "tavern").Select(s => s.P).FirstOrDefault();
                Next(model != null ? "stormdoor" : "stormover");
                break;
            }
            case "stormdoor":
                Close(3.0, 0.3);
                if (frames < 30) break;
                Shot("people_storm_doorway.png");
                Next("stormover");
                break;
            case "stormover":
                town.SetStorm(0);
                if (t < 0.8) break;
                layersRow["afterTheStormStillSheltering"] = town.Sims.Count(s => s.Shelter != null);
                Next("mill");
                break;
            case "mill":
            {
                // the mills' flour runs at dawn: the north mill's man pushes the handcart to the bakery
                town.SetClock(1, 5.2);
                if (t < 0.8) break;
                var men = town.Sims.Where(s => s.MillRun).ToList();
                layersRow["millMenOnARun"] = men.Count;
                var man = men.FirstOrDefault(s => s.R.Work.Place == "mill_ne") ?? men.FirstOrDefault();
                if (man == null)
                {
                    Next("rooms");
                    break;
                }
                millMan = man;
                Main.I.Cam.LookAtFromPosition(new Vector3((float)man.X + 5, (float)town.Walk!.BaseAt(man.X, man.Z) + 1.6f, (float)man.Z + 5), new Vector3((float)man.X, 1, (float)man.Z), Vector3.Up);
                town.Refill();
                Next("millshot");
                break;
            }
            case "millshot":
            {
                Scheldemist.World.Daylight.I?.SetTime(12);
                if (millMan?.P == null)
                {
                    if (t > 8)
                    {
                        layersRow["millManDrawn"] = false;
                        Next("rooms");
                    }
                    break;
                }
                model = millMan.P;
                Close(3.6, -1.2);
                if (t < 6) break;
                Shot("people_mill_cart.png");
                var w = town.WhereNow(millMan);
                layersRow["millMan"] = new Dictionary<string, object>
                {
                    ["mill"] = millMan.R.Work.Place,
                    ["run"] = w?.Cart != null ? $"{w.Cart.Value.kind}, {w.Cart.Value.phase}" : "none",
                    ["pushesTheHandcart"] = millMan.P.Pushes && millMan.P.Cart != null,
                    ["offTheCartsWayM"] = w?.Way != null ? Math.Round(Whereabouts.ProjectOn(w.Way, millMan.P.X, millMan.P.Z).off, 2) : -1,
                    ["behindTheTimetableM"] = w != null ? Math.Round(Whereabouts.Hypot(w.X - millMan.P.X, w.Z - millMan.P.Z), 1) : -1,
                };
                Next("streetlife");
                break;
            }

            case "streetlife":
            {
                town.SetClock(1, 14.5);
                if (t < 1) break;
                layersRow["doorPlans"] = town.DoorPlans;
                layersRow["doorRoutinesNow"] = town.Sims.Count(s => s.Key.Contains("|door:"));
                layersRow["childrenGames"] = town.Sims.Where(s => s.Goal.Mode == "play").GroupBy(town.GameOf).ToDictionary(g => g.Key, g => g.Count());
                layersRow["streetRounds"] = town.Sims.Count(s => s.R.Work.Kind == "round" && s.Goal.Mode == "patrol");
                var door = town.Sims.FirstOrDefault(s => s.Key.Contains("|door:") && s.Goal.Motion == "lace");
                if (door == null) { Next("rooms"); break; }
                Main.I.Cam.LookAtFromPosition(new Vector3((float)door.Goal.X + 4, 1.6f, (float)door.Goal.Z + 3), new Vector3((float)door.Goal.X, 1, (float)door.Goal.Z), Vector3.Up);
                town.Refill();
                // A close exhibit of the server's actual door routine; the whole town still runs normally.
                var exhibit = crowd!.AddPuppet(door.Kind, door.Goal.X, door.Goal.Z, door.Goal.Yaw ?? 0);
                if (exhibit != null)
                {
                    crowd.PuppetStand(exhibit, door.Goal.Motion ?? "idle", door.Goal.Yaw);
                    var chair = Scheldemist.Models.ModelLibrary.Get("lively", new Scheldemist.Models.ModelLibrary.Look(TwoSided: true, Affine: 0, VertexColor: true))?.Copy("chair");
                    if (chair != null) exhibit.Group.AddChild(chair);
                    exhibits.Add((exhibit, "door")); model = exhibit;
                }
                millMan = door;
                Next("doorlifeclose");
                break;
            }
            case "doorlifeclose":
                if (exhibits.Count > 0) Close(2.5, 0.6);
                if (t < 5) break;
                Shot("people_door_lace.png");
                foreach (var e in exhibits) crowd!.RemovePuppet(e.p);
                exhibits.Clear();
                Next("rooms");
                break;

                        case "rooms":
            {
                // rooms: the people of the taverns and shops that stand in the world go in at the door and are seen inside
                town.SetClock(1, 12.2);
                if (t < 1.2) break;
                var indoors = town.Indoors;
                if (indoors == null || indoors.Houses.Count == 0)
                {
                    roomsRow["note"] = "no houses with rooms";
                    Next("animals");
                    break;
                }
                var busiest = indoors.Houses.Where(h => indoors.Open(h.Id)).OrderByDescending(h => indoors.Inside(h).Count).FirstOrDefault();
                roomsRow["housesWithRooms"] = indoors.Houses.Count;
                roomsRow["openNow"] = indoors.Houses.Count(h => indoors.Open(h.Id));
                roomsRow["peopleInsideThem"] = indoors.Houses.Sum(h => indoors.Inside(h).Count);
                roomsRow["standingBeforeATavernDoor"] = town.Sims.Count(s => s.Goal.Mode == "tavern");
                if (busiest == null)
                {
                    Next("animals");
                    break;
                }
                room = busiest;
                roomsRow["shown"] = $"{busiest.Id}: {indoors.Inside(busiest).Count} inside";
                // from the street, looking in at the door
                var d = busiest.Door;
                var o = busiest.Out;
                Main.I.Cam.LookAtFromPosition(new Vector3((float)(d.X + o.X * 4.5), (float)town.Walk!.BaseAt(d.X + o.X * 2, d.Z + o.Z * 2) + 1.6f, (float)(d.Z + o.Z * 4.5)), new Vector3((float)(d.X - o.X * 3), 1.2f, (float)(d.Z - o.Z * 3)), Vector3.Up);
                Next("roomsdoor");
                break;
            }
            case "roomsdoor":
            {
                if (t < 2.5) break;
                Shot("people_rooms_from_street.png");
                roomsRow["figuresDrawnInside"] = town.Indoors!.Drawn;
                // inside, from just within the door
                var d = room!.Door;
                var o = room.Out;
                var y = (float)town.Walk!.BaseAt(d.X - o.X * 1.5, d.Z - o.Z * 1.5);
                Main.I.Cam.LookAtFromPosition(new Vector3((float)(d.X - o.X * 0.9), y + 1.6f, (float)(d.Z - o.Z * 0.9)), new Vector3((float)(d.X - o.X * 5), y + 1.1f, (float)(d.Z - o.Z * 5)), Vector3.Up);
                Next("roomsin");
                break;
            }
            case "roomsin":
                if (t < 1.5) break;
                Shot("people_rooms_inside.png");
                Next("halls");
                break;
            case "animals":
            {
                // the animals: the cats on their doorsteps and the strays round the Vismarkt, each kind close
                town.SetClock(1, 12);
                var animals = Scheldemist.People.Animals.I;
                if (animals == null)
                {
                    Next("done");
                    break;
                }
                if (frames == 1)
                {
                    place = wanted.IndexOf("vismarkt") - 1;
                    Go();
                }
                if (t < 4) break;
                animalsRow["hauntsInTown"] = animals.Haunts;
                animalsRow["hereNow"] = animals.Count;
                animalsRow["inView"] = animals.Shown;
                animalsRow["logicMs"] = Math.Round(animals.LogicMs, 3);
                animalsRow["kinds"] = animals.List.GroupBy(a => a.kind).ToDictionary(g => g.Key, g => g.Count());
                animalsRow["dogsAtHeel"] = animals.List.Count(a => a.owner != null);
                var cp = Main.I.Cam.GlobalPosition;
                beastShots = animals.List.Where(a => a.kind.StartsWith("cat")).OrderBy(a => Whereabouts.Hypot(a.x - cp.X, a.z - cp.Z)).Take(1)
                    .Concat(animals.List.Where(a => a.kind.StartsWith("dog") && a.owner == null).OrderBy(a => Whereabouts.Hypot(a.x - cp.X, a.z - cp.Z)).Take(1))
                    .Concat(animals.List.Where(a => a.owner != null).Take(1)).Select(a => (a.kind, a.x, a.z, a.owner)).ToList();
                beastStep = 0;
                Next("animalshots");
                break;
            }
            case "animalshots":
            {
                var animals = Scheldemist.People.Animals.I!;
                if (beastStep >= beastShots.Count)
                {
                    Next("wildlife");
                    break;
                }
                var want = beastShots[beastStep];
                // (it may have walked on: the same one, where it is now)
                var it = animals.List.Where(a => a.kind == want.kind && a.owner == want.owner).OrderBy(a => Whereabouts.Hypot(a.x - want.x, a.z - want.z)).FirstOrDefault();
                if (it.kind == null)
                {
                    beastStep++;
                    break;
                }
                double y = town.Walk!.BaseAt(it.x, it.z);
                foreach (double a in new[] { 0.6, 2.2, 3.8, 5.4, 0 })
                {
                    double x = it.x + Math.Sin(a) * 1.9, z = it.z + Math.Cos(a) * 1.9;
                    if (a != 0 && !town.Walk.Free(x, z)) continue;
                    Main.I.Cam.LookAtFromPosition(new Vector3((float)x, (float)y + 0.75f, (float)z), new Vector3((float)it.x, (float)y + 0.25f, (float)it.z), Vector3.Up);
                    break;
                }
                if (frames < 150) break;
                Shot($"animals_{(want.owner != null ? "dog_at_heel" : want.kind.StartsWith("cat") ? "cat" : "stray_dog")}.png");
                ((List<string>)(animalsRow.TryGetValue("closeShots", out var l) ? l : animalsRow["closeShots"] = new List<string>())).Add($"{it.kind}, {it.motion}{(want.owner != null ? ", at heel" : "")}");
                beastStep++;
                Next("animalshots");
                break;
            }
            case "wildlife":
            {
                town.SetClock(1, 12);
                var wildlife = ParkWildlife.I;
                if (wildlife == null || wildlife.List.Count == 0) { wildlifeRow["missing"] = true; Next("done"); break; }
                wildlifeRow["animals"] = wildlife.List.Count;
                wildlifeRow["kinds"] = wildlife.List.GroupBy(a => a.Species).ToDictionary(g => g.Key, g => g.Count());
                bird = wildlife.List.First(a => a.Species == "duck" && !a.Young && !wildlife.List.Any(b => b.Parent == a.Id));
                birdStart = new Pt(bird.X, bird.Z);
                Main.I.Cam.LookAtFromPosition(new Vector3((float)bird.X + 4, (float)bird.Y + 1, (float)bird.Z + 1), new Vector3((float)bird.X, (float)bird.Y + 0.2f, (float)bird.Z), Vector3.Up);
                Next("birdwalk"); break;
            }
            case "birdwalk":
                if (t < 2) break;
                wildlifeRow["movedAwayM"] = Math.Round(Whereabouts.Hypot(bird!.X - birdStart.X, bird.Z - birdStart.Z), 3);
                Shot("animals_ducks_move_off.png");
                Next("birdflight"); break;
            case "birdflight":
                if (bird!.Mode != "flight")
                {
                    Main.I.Cam.LookAtFromPosition(new Vector3((float)bird.X + 0.7f, (float)bird.Y + 1, (float)bird.Z), new Vector3((float)bird.X, (float)bird.Y + 0.1f, (float)bird.Z), Vector3.Up);
                    if (t < 4) break;
                    wildlifeRow["flewWhenPressed"] = false; Next("birdstorm"); break;
                }
                wildlifeRow["flewWhenPressed"] = true;
                Main.I.Cam.LookAtFromPosition(new Vector3((float)bird.X + 3, (float)bird.Y + 1, (float)bird.Z + 2), new Vector3((float)bird.X, (float)bird.Y, (float)bird.Z), Vector3.Up);
                if (t < 1.5) break;
                Shot("animals_duck_flight.png");
                Next("birdstorm"); break;
            case "birdstorm":
                town.SetStorm(1);
                if (t < 2) break;
                wildlifeRow["sheltering"] = ParkWildlife.I!.List.Count(a => a.Mode == "shelter" || a.Mode == "climb" || a.Mode == "perch");
                wildlifeRow["logicMs"] = Math.Round(ParkWildlife.I.LogicMs, 3);
                town.SetStorm(0);
                Next("done"); break;
            case "done":
                File.WriteAllText(Path.Combine(dir, "peopletest.json"), JsonSerializer.Serialize(new
                {
                    ok = ChecksPass(),
                    day = town.Day,
                    hour = Math.Round(town.Hour, 3),
                    maxDrawn = town.MaxPuppets,
                    bakedPeopleHidden = town.BakedHidden,
                    peopleModelLoadMs = Math.Round(People.Humans.LoadMs, 1),
                    routesWorkedOut = Whereabouts.RoutesMade,
                    whereCheck = where,
                    jef = jefRow,
                    postedPeople = postedRow,
                    carried = goodsRow,
                    layers = layersRow,
                    rooms = roomsRow,
                    animals = animalsRow,
                    wildlife = wildlifeRow,
                    halls = hallsRow,
                    places = rows,
                }, new JsonSerializerOptions { WriteIndented = true }));
                GD.Print("peopletest: written " + Path.Combine(dir, "peopletest.json"));
                SetProcess(false);
                GetTree().Quit(ChecksPass() ? 0 : 1);
                break;
            case "halls":
                if (frames != 1) break;
                if (Scheldemist.Net.ServerLink.I?.Api is not { } hallApi) { Fail("the hall test has no server"); break; }
                // The test's own isolated server chooses the rosters; advance it through its supported dev route.
                hallApi.Run(hallApi.Post<JsonElement>("api/dev/set", new { day = 1, hour = 13, minute = 0 }), _ => Next("hallview"), e => Fail("hall clock setting: " + e.Message));
                break;
            case "hallview":
            {
                town.SetClock(1, 13);
                if (HallPeople.I == null) { Fail("the hall part is missing"); break; }
                if (hallStep >= HallPeople.I.Halls.Count) { Next("homevisit"); break; }
                var h = HallPeople.I.Halls[hallStep];
                if (frames == 1) { Main.I.Cam.Position = h.Origin + new Vector3(0, 1.6f, 6); h.Poll = 0; }
                if (t < 6) break;
                hallsRow[h.Id] = h.Figures.Count;
                var f = h.Figures.Values.FirstOrDefault();
                if (f != null) Main.I.Cam.LookAtFromPosition(f.Group.Position + new Vector3(2, 1.6f, 2), f.Group.Position + Vector3.Up, Vector3.Up);
                else Main.I.Cam.LookAtFromPosition(h.Origin + new Vector3(0, 1.6f, 6), h.Origin + new Vector3(0, 1, 15), Vector3.Up);
                Next("hallshot"); break;
            }
            case "hallshot":
                if (t < 1) break;
                Shot("people_hall_" + HallPeople.I!.Halls[hallStep].Id + ".png");
                hallStep++; Next("hallview"); break;
            case "homevisit":
            {
                if (HomeVisitors.I is not { } homes) { Fail("the home visitor part is missing"); break; }
                var home = homes.Homes.First(h => h.Value.Count > 0);
                Main.I.Cam.Position = home.Value[0] + new Vector3(0, 1.6f, 0);
                bool made = homes.Visit(home.Key, town.Data!.Residents.First(r => r.Kind == "old_woman"));
                roomsRow["homeVisitorMade"] = made;
                roomsRow["home"] = home.Key;
                if (!made) { Fail("no reachable home visitor spot"); break; }
                var at = homes.Groups.First().Position;
                var cameraSpot = home.Value.Where(p => p.DistanceTo(at) >= 1.2 && Jef.I!.StandFree(p.X, p.Z, p.Y)).OrderBy(p => Math.Abs(p.DistanceTo(at) - 2)).FirstOrDefault(at + new Vector3(0, 0, 1.2f));
                Main.I.Cam.LookAtFromPosition(cameraSpot + new Vector3(0, 1.5f, 0), at + Vector3.Up, Vector3.Up);
                Next("homevisitshot"); break;
            }
            case "homevisitshot":
                if (t < 1) break;
                Shot("people_home_visitor.png"); Next("homevisitend"); break;
            case "homevisitend":
                if (t < 14) break;
                roomsRow["homeVisitorLeft"] = HomeVisitors.I!.Drawn == 0;
                Next(Main.I.Arg("peoplechecks") is "halls" or "homevisit" ? "done" : "animals"); break;
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
            if ((!town.Walk.Free(x, z) || !town.Walk.Open(x, z)) && exhibits.Count == 0) continue;
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
        if (!doc.RootElement.TryGetProperty("seed", out var seed) || seed.GetInt64() != town.Data!.Seed)
            return new Dictionary<string, object> { ["wrongTown"] = true };
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
            if (e.GetProperty("cart").GetBoolean()) cart++;
            n++;
            double hour = e.GetProperty("hour").GetDouble();
            var w = town.WhereOf(r, day, hour)!;
            double d = Whereabouts.Hypot(w.X - e.GetProperty("x").GetDouble(), w.Z - e.GetProperty("z").GetDouble());
            bool ok = d < 0.01 && (w.Cart != null) == e.GetProperty("cart").GetBoolean() && w.Indoor == e.GetProperty("indoor").GetBoolean() && w.Moving == e.GetProperty("moving").GetBoolean() && w.Act == e.GetProperty("act").GetString() && w.Place == e.GetProperty("place").GetString() && w.Stop == e.GetProperty("stop").GetInt32();
            worst = Math.Max(worst, d);
            if (ok) same++;
            else if (wrong.Count < 12) wrong.Add($"{id} at {hour}: {d:F2} m off, {w.Act}:{w.Place} stop {w.Stop} moving {w.Moving} (server {e.GetProperty("act").GetString()}:{e.GetProperty("place").GetString()} stop {e.GetProperty("stop").GetInt32()} moving {e.GetProperty("moving").GetBoolean()})");
        }
        return new Dictionary<string, object> { ["answers"] = n, ["same"] = same, ["worstM"] = Math.Round(worst, 3), ["ofThemOnACartRun"] = cart, ["notInThisTown"] = missing, ["waysStillAskedFor"] = town.WaysWaiting, ["different"] = wrong };
    }

    private bool ChecksPass()
    {
        if (where?.ContainsKey("wrongTown") == true) return false;
        if (where != null && where.TryGetValue("answers", out var answers) && ((int)answers != (int)where["same"] || (int)where["notInThisTown"] != 0)) return false;
        foreach (var r in rows)
        {
            if (r.TryGetValue("overlaps", out var overlaps) && Convert.ToInt32(overlaps) != 0) return false;
            if (r.TryGetValue("drawn", out var drawn) && Convert.ToInt32(drawn) != 50) return false;
            if (r.TryGetValue("peopleAndAnimalsCostMs", out var cost) && Convert.ToDouble(cost) >= 1.5) return false;
        }
        if (wildlifeRow.ContainsKey("missing")) return false;
        if (wildlifeRow.TryGetValue("flewWhenPressed", out var flight) && !(bool)flight) return false;
        if (hallsRow.Count > 0 && hallsRow.Values.All(v => Convert.ToInt32(v) == 0)) return false;
        return true;
    }
}
