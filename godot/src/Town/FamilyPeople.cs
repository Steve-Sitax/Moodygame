using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Net;
using Scheldemist.Render;
using Scheldemist.World;

namespace Scheldemist.Town;

/// <summary>game/families.ts's people side: strangers' names and days are patched from the server,
/// a visiting relative opens the talk when Jef is near and free, and Zelie's table stands where the server put it.
/// Director presentation (menace, dream, veil) is handed to ActionReceived, without deciding an outcome here.</summary>
[GamePart(211)]
public partial class FamilyPeople : Node
{
    public static FamilyPeople? I { get; private set; }
    public Action<JsonElement>? ActionReceived;
    public int VisitorsPatched { get; private set; }
    public bool Loaded { get; private set; }
    public Node3D? Table { get; private set; }
    private Api? api;
    private Townspeople? town;
    private JsonElement visit;
    private double visitLeft, retry;
    private bool busy;
    public override void _Ready() { I = this; town = GetParent().GetNodeOrNull<Townspeople>("Townspeople"); }
    public void Apply(JsonElement state)
    {
        if (state.TryGetProperty("visitors", out var visitors)) foreach (var visitor in visitors.EnumerateArray()) Patch(visitor);
        if (state.TryGetProperty("visitor", out var one)) Patch(one);
        if (state.TryGetProperty("fortune", out var fortune) && fortune.ValueKind == JsonValueKind.Object && fortune.TryGetProperty("at", out var at) && at.ValueKind == JsonValueKind.Array && Table == null) MakeTable(at);
        if (state.TryGetProperty("visit", out var incoming) && incoming.ValueKind == JsonValueKind.Object) { visit = incoming.Clone(); visitLeft = 180; }
        ActionReceived?.Invoke(state.Clone());
    }
    private void Patch(JsonElement visitor)
    {
        var s = town!.Sims.FirstOrDefault(s => s.R.Id == visitor.GetProperty("id").GetString());
        if (s == null) return;
        s.R.Name = visitor.GetProperty("name").GetString()!; s.R.First = visitor.GetProperty("first").GetString()!; s.R.Label = visitor.GetProperty("label").GetString()!;
        s.R.Sched = TownData.ScheduleOf(visitor.GetProperty("sched")); s.R.RouteCache.Clear(); s.R.PartialRoute = null;
        s.Key = ""; town.Refill(); VisitorsPatched++;
    }
    private void Push(PushMsg message) { if (message.Type == "families") Apply(message.Body); }
    private void MakeTable(JsonElement at)
    {
        double yaw = at[2].GetDouble(), x = at[0].GetDouble() + Math.Sin(yaw) * 0.75, z = at[1].GetDouble() + Math.Cos(yaw) * 0.75;
        Table = new Node3D { Name = "zelie_table", Position = new Vector3((float)x, (float)town!.Walk!.BaseAt(x, z), (float)z), Rotation = new Vector3(0, (float)yaw, 0) }; Main.I.View.AddChild(Table);
        ShaderMaterial Material(int color) => BakedWorld.PsxMaterial(new StandardMaterial3D { AlbedoColor = new Color((color >> 16) / 255f, ((color >> 8) & 255) / 255f, (color & 255) / 255f) }, new Psx.Kind(false, false, false, false, true, true, 0, false, false, true), 1, 1, 0);
        var wood = Material(0x4a3322); var cloth = Material(0x6e1f1c); var card = Material(0xe8e0c8); var back = Material(0x23304a);
        var merged = new Dictionary<Material, SurfaceTool>();
        void Piece(Mesh mesh, Vector3 pos, Material material, float turn = 0)
        {
            if (!merged.TryGetValue(material, out var tool)) { tool = new SurfaceTool(); tool.Begin(Mesh.PrimitiveType.Triangles); tool.SetMaterial(material); merged[material] = tool; }
            tool.AppendFrom(mesh, 0, new Transform3D(new Basis(Vector3.Up, turn), pos));
        }
        void Box(Vector3 size, Vector3 pos, Material material, float turn = 0) => Piece(new BoxMesh { Size = size }, pos, material, turn);
        Box(new Vector3(0.72f, 0.04f, 0.52f), new Vector3(0, 0.74f, 0), cloth); Box(new Vector3(0.74f, 0.3f, 0.54f), new Vector3(0, 0.6f, 0), cloth);
        foreach (float lx in new[] { -0.3f, 0.3f }) foreach (float lz in new[] { -0.2f, 0.2f }) Box(new Vector3(0.04f, 0.46f, 0.04f), new Vector3(lx, 0.23f, lz), wood);
        foreach (var c in new[] { (0f, 0f, 0f, true), (-0.12f, 0f, 0.1f, true), (0.12f, 0f, -0.1f, true), (0f, -0.13f, 0.05f, false), (0f, 0.13f, -0.05f, true) }) Box(new Vector3(0.06f, 0.004f, 0.09f), new Vector3(c.Item1, 0.765f, c.Item2), c.Item4 ? card : back, c.Item3);
        Box(new Vector3(0.06f, 0.03f, 0.09f), new Vector3(0.26f, 0.775f, 0.16f), back);
        Piece(new CylinderMesh { TopRadius = 0.17f, BottomRadius = 0.17f, Height = 0.05f, RadialSegments = 8 }, new Vector3(0, 0.45f, 0.62f), wood);
        Box(new Vector3(0.05f, 0.43f, 0.05f), new Vector3(0, 0.215f, 0.62f), wood);
        foreach (var tool in merged.Values) { Table.AddChild(new MeshInstance3D { Mesh = tool.Commit() }); tool.Dispose(); }
        var body = new StaticBody3D { CollisionLayer = Solid.Layer, CollisionMask = 0 };
        body.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = new Vector3(0.74f, 0.76f, 0.54f) }, Position = new Vector3(0, 0.38f, 0) }); Table.AddChild(body);
        town.Walk.AddBox(x, z, -0.37, 0.37, -0.27, 0.27, yaw);
        var crowd = town.Crowd!; var eye = Main.I.Cam.GlobalPosition; crowd.RebuildGrid(eye.X, eye.Z);
        foreach (var p in crowd.Walking.Where(p => !town.Walk.Free(p.X, p.Z)).ToList())
            if (crowd.OpenNearFree(p.X, p.Z) is { } safe) { p.X = safe.x; p.Z = safe.z; }
    }
    public override void _Process(double delta)
    {
        if (town?.Data == null || town.Paused) return;
        if (api == null && ServerLink.I?.Api is { } link) { api = link; api.OtherPushed += Push; }
        if (!Loaded && !busy && (retry -= delta) <= 0 && api != null)
        {
            busy = true;
            api.Run(api.Get<JsonElement>("api/families/state"), state => { busy = false; Loaded = true; Apply(state); }, _ => { busy = false; retry = 5; });
        }
        if (visit.ValueKind != JsonValueKind.Object || (visitLeft -= delta) <= 0 || Scheldemist.Player.Jef.I is not { } jef || Scheldemist.Talks.Talk.I is not { IsOpen: false } talk || Scheldemist.Windows.Dialogs.I?.Any == true) return;
        var at = town.PositionOf(visit.GetProperty("npc").GetString()!);
        if (at != null && Whereabouts.Hypot(at.Value.x - jef.X, at.Value.z - jef.Z) > 8) return;
        talk.Open(visit.GetProperty("npc").GetString()!, visit.GetProperty("name").GetString()!, visit.GetProperty("title").GetString()); visit = default;
    }
    public override void _ExitTree() { if (api != null) api.OtherPushed -= Push; Table?.QueueFree(); if (I == this) I = null; }
}
