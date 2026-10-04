using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Player;

/// <summary>
/// The walk check: with `-- --walktest dir` Jef is walked by script along a few routes (keys held for him, as a
/// player would), what happened is written to dir/walktest.json, a picture is saved at the end of each route, and
/// the game quits. `--walkspeed n` runs the clock n times as fast; `--walkonly a,b` picks routes.
/// </summary>
[GamePart(90)]
public partial class WalkTest : Node
{
    private enum Until { Reach, Blocked, Swim, Out, Fall }

    private sealed record Leg(float X, float Z, Until Until = Until.Reach, bool Run = true, float Timeout = 25, bool Jump = false);

    private sealed class Route
    {
        public string Name = "";
        public string What = "";
        public float X, Z, Near;
        public Leg[] Legs = Array.Empty<Leg>();
        /// <summary>What must be true at the end: the feet's height (within 0.25 m), or NaN.</summary>
        public float EndY = float.NaN;
        /// <summary>The feet must have been at least this high at some moment (a jump), or NaN.</summary>
        public float High = float.NaN;
    }

    private string dir = "";
    private readonly List<Route> routes = new();
    private readonly List<Dictionary<string, object?>> results = new();
    private int route = -1, leg;
    private float legT, routeT, blockedT, sampleT, shotWait = -1;
    private bool swam, fell, wasAir;
    private float airTop, biggestDrop, minY, maxY, walked;
    private Vector3 last;
    private int splashes, climbOuts, landings, steps;
    private List<Dictionary<string, object?>> legRows = new();
    private List<float[]> track = new();
    private ulong frames;
    private double frameMs, worstMs;
    private ulong lastUsec;

    public override void _Ready()
    {
        dir = Paths.TestOutput("walktest");
        if (dir == "")
        {
            SetProcess(false);
            return;
        }
        Directory.CreateDirectory(dir);
        float speed = float.Parse(Main.I.Arg("walkspeed", "1"), CultureInfo.InvariantCulture);
        Engine.TimeScale = speed;
        var jef = Jef.I;
        jef.TestInput = true;
        jef.Splashed += () => splashes++;
        jef.ClimbedOut += () => climbOuts++;
        jef.Landed += () => landings++;
        jef.Stepped += _ => steps++;
        figure = Main.I.World.FindChild("player_figure", true, false) as Node3D;
        MakeRoutes();
        string only = Main.I.Arg("walkonly");
        if (only != "") routes.RemoveAll(r => !only.Split(',').Contains(r.Name));
    }

    private void MakeRoutes()
    {
        // the Vismarkt: the first baked place, the fish market's square by the river
        routes.Add(new Route
        {
            Name = "square", What = "across the Vismarkt square, at a walk and then at a run",
            X = -118, Z = 36, EndY = 0,
            Legs = new[] { new Leg(-118, 30, Run: false), new Leg(-124, 22), new Leg(-112, 14), new Leg(-118, 36) },
        });
        routes.Add(new Route
        {
            Name = "jump", What = "a jump on the square with Space: the feet leave the ground by about 0.66 m and come down again",
            X = -118, Z = 36, EndY = 0, High = 0.55f,
            Legs = new[] { new Leg(-118, 31, Run: false, Jump: true) },
        });
        routes.Add(new Route
        {
            Name = "wall", What = "from the square straight at a house front: the wall must stop him",
            X = -118, Z = 36,
            Legs = new[] { new Leg(-118, 80, Until.Blocked) },
        });
        // the flight of stone steps at the Vismarkt quay: top at (-110, 0), down along -x over the water (z < 0)
        routes.Add(new Route
        {
            Name = "stairs", What = "from the quay down the stone steps to the landing by the water, and up again",
            X = -110.4f, Z = 2.5f, EndY = 0,
            Legs = new[] { new Leg(-110.5f, -0.65f, Run: false), new Leg(-115.6f, -0.65f, Run: false), new Leg(-110.5f, -0.65f, Run: false), new Leg(-110.4f, 2.5f, Run: false) },
        });
        routes.Add(new Route
        {
            Name = "swim", What = "off the quay edge into the Schelde, a swim round the steps, out up the ladder at the landing's end and up the steps to the quay",
            X = 0, Z = 0, Near = float.NaN, EndY = 0,
        });
        // the Werf's railing along the river (shared/city.json decor rails): it holds him; with Space he vaults it
        routes.Add(new Route
        {
            Name = "vault", What = "up to the iron railing over the river (it must hold him), then over it with Space and into the water",
            X = -218, Z = 3,
            Legs = new[] { new Leg(-218, -4, Until.Blocked, Run: false), new Leg(-218, -4, Until.Swim, Run: false, Jump: true, Timeout: 8) },
        });
        routes.Add(new Route
        {
            Name = "ladder", What = "into the water again and out up the nearest iron ladder",
            X = 0, Z = 0, Near = float.NaN, EndY = float.NaN,
        });
        routes.Add(new Route
        {
            Name = "door", What = "through a street door that stands open in the bake, into the room behind it",
            X = 0, Z = 0, Near = float.NaN, EndY = float.NaN,
        });
    }

    /// <summary>Routes that need the world looked at first: the nearest ladder, an open door.</summary>
    private bool Prepare(Route r)
    {
        if (r.Name == "swim")
        {
            // a free stretch of the Vismarkt quay's edge east of the steps (benches, bollards and goods stand along it)
            var j = Jef.I;
            for (float x = -106; x <= -86; x += 0.5f)
            {
                bool free = true;
                for (float z = 2.5f; z >= -1.2f && free; z -= 0.1f) free = j.BodyFree(x, 0, z);
                if (!free) continue;
                r.X = x;
                r.Z = 2.5f;
                r.Near = 0;
                r.Legs = new[]
                {
                    new Leg(x, -4, Until.Swim, Run: false), new Leg(-112, -3.6f), new Leg(-118.6f, -3.2f), new Leg(-118.6f, -0.81f),
                    new Leg(-114.5f, -0.81f, Until.Out, Timeout: 14), new Leg(-114.5f, -0.65f, Run: false), new Leg(-110.5f, -0.65f, Run: false), new Leg(-110.4f, 2.5f, Run: false),
                };
                return true;
            }
            return false;
        }
        if (r.Name == "ladder")
        {
            var l = QuayExits.Ladders.Where(a => MathF.Abs(a.Top) < 0.1f).OrderBy(a => new Vector2(a.X + 118, a.Z - 36).Length()).FirstOrDefault();
            if (l == null) return false;
            // from the quay behind the ladder, 3 m along the wall: off the edge, swim to the foot of the ladder, push in
            float tx = -l.Nz, tz = l.Nx;
            r.X = l.X - l.Nx * 2 + tx * 3;
            r.Z = l.Z - l.Nz * 2 + tz * 3;
            r.Near = 0;
            r.EndY = l.Top;
            r.What += $" (the ladder at {l.X:0.0}, {l.Z:0.0})";
            r.Legs = new[]
            {
                new Leg(l.X + l.Nx * 3 + tx * 3, l.Z + l.Nz * 3 + tz * 3, Until.Swim),
                new Leg(l.X - l.Nx * 2, l.Z - l.Nz * 2, Until.Out, Timeout: 15),
            };
            return true;
        }
        if (r.Name == "door")
        {
            var d = OpenDoor();
            if (d == null) return false;
            var (name, at, into) = d.Value;
            r.X = at.X - into.X * 3;
            r.Z = at.Y - into.Y * 3;
            r.Near = 0;
            r.What += $" ({name})";
            r.Legs = new[] { new Leg(at.X + into.X * 2.2f, at.Y + into.Y * 2.2f, Run: false, Timeout: 12) };
            return true;
        }
        return true;
    }

    /// <summary>
    /// A street door Jef can walk through as the bake stands: the door openings are nodes "opening_..._door" with
    /// their place and facing; one is open when a body fits all the way from 1.5 m outside to 2 m inside.
    /// </summary>
    private (string name, Vector2 at, Vector2 into)? OpenDoor()
    {
        var jef = Jef.I;
        var doors = new List<(string, Vector2, Vector2, float)>();
        foreach (var n in BakedWorld.All(Main.I.World))
        {
            if (n is not Node3D d) continue;
            string name = d.Name.ToString();
            if (!name.StartsWith("opening_") || !name.EndsWith("_door")) continue;
            var p = d.GlobalPosition;
            var z = d.GlobalBasis.Z;
            var dirs = new[] { new Vector2(z.X, z.Z).Normalized(), -new Vector2(z.X, z.Z).Normalized() };
            foreach (var into in dirs)
                doors.Add((name, new Vector2(p.X, p.Z), into, new Vector2(p.X + 118, p.Z - 36).Length()));
        }
        foreach (var (name, at, into, far) in doors.OrderBy(d => d.Item4))
        {
            if (far > DoorReach) break;
            doorsTried++;
            bool free = true;
            float g0 = jef.GroundAt(at.X - into.X * 1.5f, at.Y - into.Y * 1.5f, 0.3f);
            if (!float.IsFinite(g0) || MathF.Abs(g0) > 0.5f) continue;
            float feet = g0;
            for (float s = -1.5f; s <= 2.01f && free; s += 0.1f)
            {
                float x = at.X + into.X * s, z = at.Y + into.Y * s;
                float g = jef.GroundAt(x, z, feet);
                if (!float.IsFinite(g) || MathF.Abs(g - feet) > Jef.Step) free = false;
                else
                {
                    feet = g;
                    free = jef.BodyFree(x, feet, z);
                }
            }
            if (free) return (name, at, into);
        }
        return null;
    }
    private const float DoorReach = 250;
    private bool seen;
    private Camera3D? outside;
    private Node3D? figure;
    private int doorsTried;
    private bool doorScanWait, swimScanWait;
    private ulong waitTick;

    private void Start()
    {
        var r = routes[route];
        if (r.Name == "swim" && !swimScanWait)
        {
            swimScanWait = true;
            Solid.I.Ensure(new Vector3(-96, 0, 0), 20);
            waitTick = Engine.GetPhysicsFrames() + 1;
            return;
        }
        if (r.Name == "door" && !doorScanWait)
        {
            // the doors near the start are made solid first; the physics knows them a tick later
            doorScanWait = true;
            foreach (var n in BakedWorld.All(Main.I.World))
                if (n is Node3D d && d.Name.ToString().StartsWith("opening_") && d.Name.ToString().EndsWith("_door") && new Vector2(d.GlobalPosition.X + 118, d.GlobalPosition.Z - 36).Length() < DoorReach)
                    Solid.I.Ensure(d.GlobalPosition, 14);
            waitTick = Engine.GetPhysicsFrames() + 1;
            return;
        }
        if (float.IsNaN(r.Near) && !Prepare(r))
        {
            results.Add(new() { ["route"] = r.Name, ["what"] = r.What, ["ok"] = false, ["skipped"] = r.Name == "door" ? $"no street door is open in the bake ({doorsTried} door sides tried)" : r.Name == "swim" ? "no free stretch of quay edge found" : "no ladder found in the baked quay iron" });
            Next();
            return;
        }
        var first = r.Legs[0];
        Jef.I.ClearKeys();
        Jef.I.Place(r.X, r.Z, MathF.Atan2(-(first.X - r.X), -(first.Z - r.Z)), 0, r.Near);
        leg = 0;
        legT = routeT = blockedT = sampleT = 0;
        swam = fell = wasAir = false;
        biggestDrop = walked = 0;
        minY = float.PositiveInfinity;
        maxY = float.NegativeInfinity;
        splashes = climbOuts = landings = steps = 0;
        legRows = new();
        track = new();
        last = new Vector3(r.X, 0, r.Z);
        started = false;
    }
    private bool started;

    private void Next()
    {
        route++;
        if (route < routes.Count)
        {
            Start();
            return;
        }
        var jef = Jef.I;
        var report = new Dictionary<string, object?>
        {
            ["made"] = Time.GetDatetimeStringFromSystem(),
            ["ok"] = results.All(r => r["ok"] is true),
            ["clockSpeed"] = Engine.TimeScale,
            ["frameMs"] = new { mean = Math.Round(frameMs / Math.Max(1, frames), 3), worst = Math.Round(worstMs, 3), frames },
            ["solid"] = new { things = Main.I.World.Report.GetValueOrDefault("solidItems"), shapes = Solid.I.Built, triangles = Solid.I.Triangles, buildMs = Math.Round(Solid.I.BuildMs, 1), startMs = Math.Round(Jef.I.StartMs, 1), scanMs = Main.I.World.Report.GetValueOrDefault("solidScanMs") },
            ["water"] = new { river = Math.Round(Tide.River, 3), ladders = QuayExits.Ladders.Count, flights = QuayExits.Flights.Count },
            ["rescued"] = jef.Rescued,
            ["routes"] = results,
        };
        File.WriteAllText(Path.Combine(dir, "walktest.json"), JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
        GD.Print($"walk test: {(report["ok"] is true ? "all routes as they should be" : "NOT all as it should be")}; {Path.Combine(dir, "walktest.json")}");
        foreach (var r in results)
            if (r.TryGetValue("legs", out var lg))
                foreach (var l in (List<Dictionary<string, object?>>)lg!)
                    GD.Print($"    {r["route"]}: {JsonSerializer.Serialize(l)}");
        foreach (var r in results) GD.Print($"  {r["route"]}: {(r["ok"] is true ? "ok" : "WRONG")} {JsonSerializer.Serialize(r.Where(k => k.Key is "end" or "skipped" or "swam" or "biggestDrop").ToDictionary(k => k.Key, k => k.Value))}");
        SetProcess(false);
        GetTree().Quit(report["ok"] is true ? 0 : 1);
    }

    private static string State(Jef j) => j.Fly ? "fly" : j.Climbing ? "climb" : j.Swimming ? "swim" : j.Grounded ? "walk" : "air";

    private void EndRoute()
    {
        var r = routes[route];
        var j = Jef.I;
        j.ClearKeys();
        bool legsOk = legRows.Count == r.Legs.Length && legRows.All(l => (string)l["result"]! != "timeout" && ((string)l["until"]! != "blocked" || (string)l["result"]! == "blocked"));
        bool yOk = float.IsNaN(r.EndY) || MathF.Abs(j.Y - r.EndY) <= 0.25f;
        string pic = Path.Combine(dir, $"walk_{r.Name}.png");
        results.Add(new()
        {
            ["route"] = r.Name, ["what"] = r.What, ["ok"] = legsOk && yOk && j.Rescued == 0 && (float.IsNaN(r.High) || maxY >= r.High),
            ["start"] = new[] { r.X, r.Z }, ["end"] = Round(j.X, j.Y, j.Z), ["endState"] = State(j),
            ["seconds"] = Math.Round(routeT, 1), ["metres"] = Math.Round(walked, 1),
            ["stoppedByWall"] = legRows.Any(l => (string)l["result"]! == "blocked"),
            ["swam"] = swam, ["fell"] = fell, ["biggestDrop"] = Math.Round(biggestDrop, 2),
            ["lowest"] = Math.Round(minY, 2), ["highest"] = Math.Round(maxY, 2),
            ["splashes"] = splashes, ["climbedOut"] = climbOuts, ["footsteps"] = steps,
            ["legs"] = legRows, ["track"] = track, ["picture"] = DisplayServer.GetName() == "headless" ? null : pic, ["pictureFromOutside"] = DisplayServer.GetName() == "headless" ? null : pic.Replace(".png", "_seen.png"),
        });
        shotWait = 0.4f; // stand still a moment, then the picture
    }

    /// <summary>What stands in front of him: rays ahead at shin, hip and chest height.</summary>
    private static string Ahead(Jef j)
    {
        var d = new Vector3(-MathF.Sin(j.Yaw), 0, -MathF.Cos(j.Yaw));
        foreach (float h in new[] { 1.0f, 0.5f, 1.5f, 0.38f })
        {
            var a = new Vector3(j.X, j.Y + h, j.Z);
            string s = Solid.I.NameAt(a, a + d * 1.2f);
            if (s != "") return s;
        }
        return "";
    }

    private static float[] Round(float x, float y, float z) => new[] { MathF.Round(x, 2), MathF.Round(y, 2), MathF.Round(z, 2) };

    public override void _Process(double delta)
    {
        ulong now = Time.GetTicksUsec();
        if (lastUsec != 0 && route >= 0)
        {
            double ms = (now - lastUsec) / 1000.0;
            frameMs += ms;
            frames++;
            if (frames > 30) worstMs = Math.Max(worstMs, ms);
        }
        lastUsec = now;
        float dt = (float)Math.Min(delta, 0.05);
        if (route < 0)
        {
            // a few frames for the town to settle, then the first route
            if (Engine.GetProcessFrames() > 10) Next();
            return;
        }
        if (waitTick != 0)
        {
            if (Engine.GetPhysicsFrames() <= waitTick) return;
            waitTick = 0;
            Start();
            return;
        }
        if (shotWait >= 0)
        {
            lastUsec = 0; // (saving a picture is not a frame of play)
            shotWait -= dt;
            if (shotWait > 0) return;
            if (DisplayServer.GetName() == "headless")
            {
                shotWait = -1;
                Next();
                return;
            }
            var jf = Jef.I;
            if (!seen)
            {
                // his own view; then one from behind and above, with his figure put where he stands
                GetViewport().GetTexture().GetImage().SavePng(Path.Combine(dir, $"walk_{routes[route].Name}.png"));
                seen = true;
                shotWait = 0.3f;
                var back = new Vector3(MathF.Sin(jf.Yaw), 0, MathF.Cos(jf.Yaw));
                var feet = new Vector3(jf.X, jf.Swimming ? Tide.LevelAt(jf.X, jf.Z) - Jef.SwimFeet : jf.Y, jf.Z);
                outside ??= new Camera3D { Fov = jf.Cam.Fov, Near = jf.Cam.Near, Far = jf.Cam.Far };
                if (outside.GetParent() == null) Main.I.View.AddChild(outside);
                outside.LookAtFromPosition(new Vector3(feet.X, Math.Max(feet.Y + 3.2f, 3), feet.Z) + back * 4.5f, feet + new Vector3(0, 1.2f, 0), Vector3.Up);
                outside.Current = true;
                if (figure != null)
                {
                    figure.GlobalPosition = feet;
                    figure.Rotation = new Vector3(0, jf.Yaw + MathF.PI, 0);
                    figure.Visible = true;
                }
                return;
            }
            GetViewport().GetTexture().GetImage().SavePng(Path.Combine(dir, $"walk_{routes[route].Name}_seen.png"));
            seen = false;
            shotWait = -1;
            if (figure != null) figure.Visible = false;
            jf.Cam.Current = true;
            Next();
            return;
        }
        var j = Jef.I;
        var r = routes[route];
        var l = r.Legs[leg];
        if (!started)
        {
            // (Place takes a physics tick to find the ground)
            started = true;
            last = new Vector3(j.X, j.Y, j.Z);
            return;
        }
        legT += dt;
        routeT += dt;
        // what happened since the last frame
        walked += new Vector2(j.X - last.X, j.Z - last.Z).Length();
        last = new Vector3(j.X, j.Y, j.Z);
        minY = Math.Min(minY, j.Y);
        maxY = Math.Max(maxY, j.Y);
        if (j.Swimming) swam = true;
        bool air = !j.Grounded && !j.Swimming && !j.Climbing;
        if (air && !wasAir) airTop = j.Y;
        if (air) biggestDrop = Math.Max(biggestDrop, airTop - j.Y);
        if (biggestDrop > 0.5f) fell = true;
        wasAir = air;
        sampleT += dt;
        if (sampleT >= 0.5f)
        {
            sampleT = 0;
            track.Add(new[] { MathF.Round(routeT, 1), MathF.Round(j.X, 2), MathF.Round(j.Y, 2), MathF.Round(j.Z, 2), j.Swimming ? 2 : j.Climbing ? 3 : j.Grounded ? 0 : 1 });
        }

        // the keys for this leg: face the goal, hold W
        float dx = l.X - j.X, dz = l.Z - j.Z;
        float dist = MathF.Sqrt(dx * dx + dz * dz);
        if (!j.Climbing) j.Yaw = MathF.Atan2(-dx, -dz);
        j.SetKey(Key.W, true);
        j.SetKey(Key.Shift, l.Run);
        j.SetKey(Key.Space, l.Jump);
        blockedT = j.Blocked ? blockedT + dt : 0;

        string? result = null;
        switch (l.Until)
        {
            case Until.Reach: if (dist < 0.3f) result = "reached"; break;
            case Until.Blocked: if (blockedT > 0.8f) result = "blocked"; else if (dist < 0.3f) result = "reached"; break;
            case Until.Swim: if (j.Swimming) result = "swimming"; break;
            case Until.Out: if (!j.Swimming && !j.Climbing && j.Grounded && climbOuts > 0) result = "out"; break;
            case Until.Fall: if (fell && j.Grounded) result = "landed"; break;
        }
        if (result == null && l.Until == Until.Reach && blockedT > 2.5f) result = "timeout"; // held by something that should not be there
        if (result == null && legT > l.Timeout) result = "timeout";
        if (result == null) return;
        legRows.Add(new()
        {
            ["to"] = new[] { l.X, l.Z }, ["until"] = l.Until.ToString().ToLowerInvariant(), ["result"] = result == "timeout" && blockedT > 0.8f ? "timeout" : result,
            ["heldByWall"] = blockedT > 0.8f, ["heldBy"] = blockedT > 0.8f ? Ahead(j) : null, ["standsOn"] = Solid.I.NameAt(new Vector3(j.X, j.Y + 0.3f, j.Z), new Vector3(j.X, j.Y - 0.5f, j.Z)), ["seconds"] = Math.Round(legT, 1), ["at"] = Round(j.X, j.Y, j.Z), ["state"] = State(j),
        });
        legT = 0;
        blockedT = 0;
        leg++;
        if (result == "timeout" || leg >= r.Legs.Length) EndRoute();
    }
}
