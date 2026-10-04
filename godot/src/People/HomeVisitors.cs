using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.People;

/// <summary>The visitor supplied by the homes helper's /api/homes/remark reply.
/// Visit(null) dismisses them; the browser's visit lasts fourteen seconds.
/// This does not choose a visitor or change a lease, furniture, dialogue or server state.</summary>
[GamePart(209)]
public partial class HomeVisitors : Node
{
    public static HomeVisitors? I { get; private set; }
    public Func<Vector3, bool>? SpotFree;
    private readonly Dictionary<string, List<Vector3>> spots = new();
    private readonly Dictionary<string, (Human human, Node3D group, string id, double until)> visitors = new();
    private double time;
    private Townspeople? town;
    public IEnumerable<Node3D> Groups => visitors.Values.Select(v => v.group);
    public int Drawn => visitors.Count;
    public IReadOnlyDictionary<string, List<Vector3>> Homes => spots;
    public override void _Ready()
    {
        I = this;
        town = GetParent().GetNodeOrNull<Townspeople>("Townspeople");
        using var data = JsonDocument.Parse(HallPeopleData.Json);
        foreach (var home in data.RootElement.GetProperty("homes").EnumerateArray())
            spots[home.GetProperty("id").GetString()!] = home.GetProperty("spots").EnumerateArray().Select(p => new Vector3(p.GetProperty("x").GetSingle(), p.GetProperty("y").GetSingle(), p.GetProperty("z").GetSingle())).ToList();
    }
    public Vector3? PositionOf(string id) { if (town?.ActionPerson(id)?.ActionHeld == true) return null; foreach (var v in visitors.Values) if (v.id == id) return v.group.GlobalPosition; return null; }
    /// <summary>Pass the server's person, or null when the room is left. The homes helper can supply its furniture free-space check.</summary>
    public bool Visit(string home, Resident? person, double seconds = 14)
    {
        if (visitors.Remove(home, out var old)) old.group.QueueFree();
        if (person == null) return true;
        if (town?.ActionPerson(person.Id)?.ActionHeld == true) return false;
        if (!spots.TryGetValue(home, out var candidates)) return false;
        var eye = Main.I.Cam.GlobalPosition;
        var jef = Scheldemist.Player.Jef.I;
        var options = candidates.Where(p => (SpotFree?.Invoke(p) ?? jef?.StandFree(p.X, p.Z, p.Y) ?? false)
            && (jef == null || jef.Fly || Math.Abs(jef.Y - p.Y) > 1.8 || Whereabouts.Hypot(jef.X - p.X, jef.Z - p.Z) >= 0.9)
            && visitors.Values.All(v => v.group.Position.DistanceTo(p) >= 0.7f)).OrderBy(p => p.DistanceSquaredTo(eye)).ToList();
        if (options.Count == 0) return false;
        var human = Humans.Make(Humans.IsKind(person.Kind) ? person.Kind : "docker_a");
        if (human == null) return false;
        var at = options[0];
        var group = new Node3D { Name = "home_visitor_" + person.Id, Position = at, Rotation = new Vector3(0, MathF.Atan2(eye.X - at.X, eye.Z - at.Z), 0) };
        group.AddChild(human.Root); Main.I.View.AddChild(group); human.Start(); human.Play("talk");
        var body = new StaticBody3D { CollisionLayer = Solid.Layer, CollisionMask = 0 };
        body.AddChild(new CollisionShape3D { Shape = new CylinderShape3D { Radius = 0.3f, Height = 1.5f }, Position = new Vector3(0, 0.75f, 0) }); group.AddChild(body);
        visitors[home] = (human, group, person.Id, time + Math.Max(0, seconds));
        return true;
    }
    private readonly List<string> expired = new(8);
    public long AllocatedBytesLastFrame { get; private set; }
    public override void _Process(double delta)
    {
        long before = GC.GetAllocatedBytesForCurrentThread();
        ProcessFrame(delta);
        AllocatedBytesLastFrame = GC.GetAllocatedBytesForCurrentThread() - before;
    }
    private void ProcessFrame(double delta)
    {
        if (town?.Paused == true) return;
        time += delta;
        expired.Clear();
        foreach (var pair in visitors)
        {
            var v = pair.Value;
            if (time >= v.until || town?.ActionPerson(v.id)?.ActionHeld == true) { expired.Add(pair.Key); continue; }
            bool near = Main.I.Cam.GlobalPosition.DistanceTo(v.group.Position) < 45;
            v.group.Visible = near;
            if (near) v.human.Update((float)Math.Min(delta, 0.1));
        }
        foreach (string id in expired) Visit(id, null);
    }
    public override void _ExitTree() { foreach (var home in visitors.Keys.ToList()) Visit(home, null); if (I == this) I = null; }
}
