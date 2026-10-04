using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Net;
using Scheldemist.Town;
using Scheldemist.Models;
using Scheldemist.World;

namespace Scheldemist.People;

/// <summary>The hall occupants sent by /api/landmark/:id (game/landmarks.ts).
/// Roles use the browser's marks, sets, floor heights and loops, copied by tools/godot/peopledata.mjs.
/// This owns figures only; the hall shells, doors, light and event scenes belong to their own parts.</summary>
[GamePart(208)]
public partial class HallPeople : Node
{
    public static HallPeople? I { get; private set; }
    public sealed class Hall
    {
        public string Id = "";
        public JsonElement Plan, Roles;
        public Vector3 Origin;
        public double Yaw;
        public bool Loading;
        public double Poll;
        public readonly Dictionary<string, Figure> Figures = new();
    }
    public sealed class Figure
    {
        public string Id = "", Role = "", Kind = "";
        public Human Human = null!;
        public Node3D Group = null!;
        public List<Vector3> Loop = new();
        public readonly Queue<Vector3> Path = new();
        public Vector3 Target;
        public int Index;
        public double Wait, Speed = 0.7;
        public string Motion = "idle";
        public bool Moving;
        public float RestLift;
    }
    public readonly List<Hall> Halls = new();
    public IEnumerable<Node3D> Groups => Halls.SelectMany(h => h.Figures.Values.Select(f => f.Group));
    public double LogicMs { get; private set; }
    private Townspeople? town;
    private JsonDocument? data;
    public override void _Ready()
    {
        I = this; town = GetParent().GetNodeOrNull<Townspeople>("Townspeople");
        data = JsonDocument.Parse(HallPeopleData.Json);
        foreach (var p in data.RootElement.GetProperty("rooms").EnumerateArray())
        {
            string id = p.GetProperty("id").GetString()!;
            var o = p.GetProperty("origin");
            Halls.Add(new Hall { Id = id, Plan = p, Roles = data.RootElement.GetProperty("roles").GetProperty(id), Origin = new Vector3(o.GetProperty("x").GetSingle(), p.GetProperty("floorY").GetSingle(), o.GetProperty("z").GetSingle()), Yaw = p.GetProperty("yaw").GetDouble() });
        }
    }
    private static Vector3 World(Hall h, JsonElement mark)
    {
        double x = mark.GetProperty("x").GetDouble(), z = mark.GetProperty("z").GetDouble(), c = Math.Cos(h.Yaw), s = Math.Sin(h.Yaw);
        return h.Origin + new Vector3((float)(x * c + z * s), mark.TryGetProperty("y", out var y) ? y.GetSingle() : 0, (float)(-x * s + z * c));
    }
    private void Roster(Hall h, JsonElement reply)
    {
        h.Loading = false;
        var want = reply.GetProperty("people").EnumerateArray().Take(24).ToList();
        foreach (var id in h.Figures.Keys.Where(id => !want.Any(p => p.GetProperty("id").GetString() == id)).ToList()) { h.Figures[id].Group.QueueFree(); h.Figures.Remove(id); }
        var occupied = new List<Vector3>();
        foreach (var person in want)
        {
            string id = person.GetProperty("id").GetString()!, role = person.GetProperty("role").GetString()!, kind = person.GetProperty("kind").GetString()!;
            if (h.Figures.TryGetValue(id, out var old) && old.Role == role) { occupied.Add(old.Target); continue; }
            if (old != null) { old.Group.QueueFree(); h.Figures.Remove(id); }
            if (!h.Roles.TryGetProperty(role, out var spec)) continue;
            var points = new List<Vector3>();
            var marks = new List<JsonElement>();
            bool loop = spec.TryGetProperty("loop", out var loopName);
            if (spec.TryGetProperty("at", out var at) && h.Plan.GetProperty("marks").TryGetProperty(at.GetString()!, out var mark)) marks.Add(mark);
            else if ((spec.TryGetProperty("set", out var setName) || loop) && h.Plan.GetProperty("sets").TryGetProperty((loop ? loopName : setName).GetString()!, out var set)) marks.AddRange(set.EnumerateArray());
            points.AddRange(marks.Select(m => World(h, m)));
            if (points.Count == 0) continue;
            int first = (int)(Whereabouts.HashId(id) % (uint)points.Count);
            for (int k = 0; k < points.Count && occupied.Any(p => p.DistanceTo(points[first]) < 0.7f); k++) first = (first + 1) % points.Count;
            if (occupied.Any(p => p.DistanceTo(points[first]) < 0.7f)) continue;
            var human = Humans.Make(Humans.IsKind(kind) ? kind : "docker_a"); if (human == null) continue;
            var group = new Node3D { Name = "hall_person_" + id, Position = points[first], Rotation = new Vector3(0, (float)(h.Yaw + marks[first].GetProperty("yaw").GetDouble()), 0) };
            group.AddChild(human.Root); Main.I.View.AddChild(group); human.Start();
            var body = new StaticBody3D { CollisionLayer = Solid.Layer, CollisionMask = 0 };
            body.AddChild(new CollisionShape3D { Shape = new CylinderShape3D { Radius = 0.3f, Height = 1.5f }, Position = new Vector3(0, 0.75f, 0) }); group.AddChild(body);
            string motion = spec.TryGetProperty("motion", out var m) ? m.GetString()! : "idle";
            float lift = 0;
            if (spec.TryGetProperty("sit", out var seat) && human.CanSit) { motion = "sit"; lift = human.SitDrop(seat.GetSingle()); }
            else if (motion == "sit") motion = "idle";
            human.Play(motion); human.Root.Position = new Vector3(0, lift, 0);
            if (motion == "sit")
            {
                var chair = ModelLibrary.Get("lively", new ModelLibrary.Look(TwoSided: true, Affine: 0, VertexColor: true))?.Copy("chair");
                if (chair != null) { chair.Scale = new Vector3(1, seat.GetSingle() / 0.45f, 1); group.AddChild(chair); }
            }
            var fig = new Figure { Id = id, Role = role, Kind = kind, Human = human, Group = group, Target = points[first], Index = first, Loop = loop ? points : new List<Vector3>(), Motion = motion, Speed = spec.TryGetProperty("speed", out var speed) ? speed.GetDouble() : 0.7, Wait = spec.TryGetProperty("pause", out var pause) ? pause.GetDouble() : 5 };
            fig.RestLift = lift; occupied.Add(fig.Target); h.Figures[id] = fig;
        }
    }
    public Vector3? PositionOf(string id) => Halls.SelectMany(h => h.Figures.Values).FirstOrDefault(f => f.Id == id)?.Group.GlobalPosition;
    public override void _Process(double delta)
    {
        if (town?.Data == null || town.Paused) return;
        ulong started = Time.GetTicksUsec(); var eye = Main.I.Cam.GlobalPosition;
        foreach (var h in Halls)
        {
            bool near = new Vector2(h.Origin.X - eye.X, h.Origin.Z - eye.Z).Length() < (h.Id == "cathedral" ? 140 : 65);
            h.Poll -= delta;
            if (near && !h.Loading && h.Poll <= 0 && ServerLink.I?.Api is { } api)
            {
                h.Loading = true; h.Poll = 5;
                api.Run(api.Get<JsonElement>("api/landmark/" + h.Id), reply => Roster(h, reply), _ => h.Loading = false);
            }
            foreach (var f in h.Figures.Values)
            {
                f.Group.Visible = near;
                if (!near) continue;
                if (f.Loop.Count > 0)
                {
                    if (f.Moving)
                    {
                        var p = f.Group.Position; float step = (float)(f.Speed * delta);
                        // Only same-floor steps along verified straight segments; furniture and walls come from the plan.
                        var to = p.MoveToward(f.Target, step);
                        bool occupied = h.Figures.Values.Any(o => o != f && Math.Abs(o.Group.Position.Y - to.Y) < 0.5 && new Vector2(o.Group.Position.X - to.X, o.Group.Position.Z - to.Z).Length() < 0.7f);
                        if (!FreeSegment(h, p, to) || occupied) { f.Moving = false; f.Path.Clear(); f.Wait = 1; f.Human.Play(f.Motion); }
                        else { f.Group.Position = to; f.Group.Rotation = new Vector3(0, MathF.Atan2(f.Target.X - p.X, f.Target.Z - p.Z), 0); if (to.DistanceTo(f.Target) < 0.05f) { if (f.Path.Count > 0) f.Target = f.Path.Dequeue(); else { f.Moving = false; f.Wait = 5; f.Human.Play(f.Motion); } } }
                    }
                    else if ((f.Wait -= delta) <= 0)
                    {
                        f.Index = (f.Index + 1) % f.Loop.Count; f.Target = f.Loop[f.Index];
                        var path = Route(h, f.Group.Position, f.Target);
                        if (path.Count > 0) { foreach (var p in path) f.Path.Enqueue(p); f.Target = f.Path.Dequeue(); f.Moving = true; f.Human.Play("walk"); } else f.Wait = 3;
                    }
                }
                f.Human.Root.Position = new Vector3(0, f.Moving ? f.Human.Bob() : f.RestLift + f.Human.MotionLift(), 0);
                f.Human.Update((float)Math.Min(delta, 0.1));
            }
        }
        LogicMs = (Time.GetTicksUsec() - started) / 1000.0;
    }
    private static bool FreeSegment(Hall h, Vector3 from, Vector3 to)
    {
        // Exact floor solids from shared/hallPlan.ts. A blocked loop stands and tries the next mark.
        if (Math.Abs(from.Y - to.Y) > 0.4) return false;
        var levels = h.Plan.GetProperty("levels");
        int n = Math.Max(1, (int)Math.Ceiling(from.DistanceTo(to) / 0.2));
        for (int i = 1; i <= n; i++)
        {
            var p = from.Lerp(to, (float)i / n) - h.Origin; double c = Math.Cos(h.Yaw), s = Math.Sin(h.Yaw), x = p.X * c - p.Z * s, z = p.X * s + p.Z * c;
            if (h.Plan.TryGetProperty("freeGrid", out var grid))
            {
                int ix = (int)Math.Round((x - grid.GetProperty("x").GetDouble()) / grid.GetProperty("step").GetDouble()), iz = (int)Math.Round((z - grid.GetProperty("z").GetDouble()) / grid.GetProperty("step").GetDouble());
                var rows = grid.GetProperty("rows");
                if (iz < 0 || iz >= rows.GetArrayLength()) return false;
                string row = rows[iz].GetString()!;
                if (ix < 0 || ix >= row.Length || row[ix] != '1') return false;
                continue;
            }
            bool In(JsonElement r, double margin) => x >= r.GetProperty("minX").GetDouble() - margin && x <= r.GetProperty("maxX").GetDouble() + margin && z >= r.GetProperty("minZ").GetDouble() - margin && z <= r.GetProperty("maxZ").GetDouble() + margin;
            var floor = levels.EnumerateArray().Where(l => Math.Abs(l.GetProperty("y").GetDouble() - p.Y) < 0.4).ToList();
            if (!floor.Any(l => l.GetProperty("floors").EnumerateArray().Any(r => In(r, -0.3)))) return false;
            if (floor.Any(l => l.GetProperty("solids").EnumerateArray().Any(r => In(r, 0.3)))) return false;
        }
        return true;
    }
    private static List<Vector3> Route(Hall h, Vector3 from, Vector3 to)
    {
        if (FreeSegment(h, from, to)) return new() { to };
        var nodes = new List<Vector3> { from, to };
        foreach (var p in h.Plan.GetProperty("nodes").EnumerateArray())
        {
            double c = Math.Cos(h.Yaw), s = Math.Sin(h.Yaw), x = p[0].GetDouble(), z = p[1].GetDouble();
            nodes.Add(new Vector3(h.Origin.X + (float)(x * c + z * s), from.Y, h.Origin.Z + (float)(-x * s + z * c)));
        }
        var dist = Enumerable.Repeat(float.PositiveInfinity, nodes.Count).ToArray();
        var previous = Enumerable.Repeat(-1, nodes.Count).ToArray(); var used = new bool[nodes.Count]; dist[0] = 0;
        for (int k = 0; k < nodes.Count; k++)
        {
            int at = -1;
            for (int i = 0; i < nodes.Count; i++) if (!used[i] && (at < 0 || dist[i] < dist[at])) at = i;
            if (at < 0 || float.IsPositiveInfinity(dist[at])) break;
            if (at == 1) { var result = new List<Vector3>(); for (int i = 1; i != 0; i = previous[i]) result.Add(nodes[i]); result.Reverse(); return result; }
            used[at] = true;
            for (int i = 0; i < nodes.Count; i++) if (!used[i]) { float d = dist[at] + nodes[at].DistanceTo(nodes[i]); if (d < dist[i] && FreeSegment(h, nodes[at], nodes[i])) { dist[i] = d; previous[i] = at; } }
        }
        return new();
    }
    public override void _ExitTree() { foreach (var g in Groups) g.QueueFree(); data?.Dispose(); if (I == this) I = null; }
}
