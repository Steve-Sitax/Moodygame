using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Models;
using Scheldemist.Town;

namespace Scheldemist.Game;

/// <summary>game/hearses.ts: load behind the bearers, then follow the engine's road out of town.</summary>
[GamePart(232)]
public partial class Hearses : Node
{
    private sealed class Run
    {
        public int Id;
        public List<double[]> Route = null!;
        public double Length, Distance, Off = 2, X, Z, Yaw;
        public bool Loaded, Seen;
        public Node3D? Root, Coffin;
        public readonly List<Node3D> Wheels = new(4);
        public readonly List<string> Bearers = new(4);
        public readonly List<EventHorse> Horses = new(2);
    }
    public static Hearses? I { get; private set; }
    private readonly List<Run> runs = new(2);
    private Townspeople? town;
    public int Count => runs.Count;
    public double LogicMs { get; private set; }
    public long AllocatedBytes { get; private set; }
    public override void _Ready() { I = this; town = GetParent().GetNodeOrNull<Townspeople>("Townspeople"); }
    public Vector2? BackOf(int? id)
    {
        foreach (var r in runs) if (r.Id == id) return new Vector2((float)(r.X - Math.Sin(r.Yaw) * 2.8), (float)(r.Z - Math.Cos(r.Yaw) * 2.8));
        return null;
    }
    public bool HasCoffin(int? id) { foreach (var r in runs) if (r.Id == id) return r.Loaded; return false; }
    public override void _Process(double delta)
    {
        ulong start = Time.GetTicksUsec(); long before = GC.GetAllocatedBytesForCurrentThread();
        if (Events.I == null || town?.Walk == null) return;
        foreach (var r in runs) r.Seen = false;
        foreach (var live in Events.I.List)
        {
            var ev = live.Event; var st = Events.StageOf(ev);
            if (ev.Status != "running" || st?.Op != "depart" || st.Hearse != true || st.Route is not { Count: >= 2 }) continue;
            Run? run = null; foreach (var r in runs) if (r.Id == ev.Id) { run = r; break; }
            if (run == null)
            {
                run = new Run { Id = ev.Id, Route = st.Route };
                for (int i = 1; i < run.Route.Count; i++) run.Length += Whereabouts.Hypot(run.Route[i][0] - run.Route[i - 1][0], run.Route[i][1] - run.Route[i - 1][1]);
                run.Distance = Math.Min(9, run.Length * 0.2);
                double secs = Math.Max(0, (st.Minutes - live.Left) * 2), load = st.Minutes * 0.4 * 2;
                if (secs > load + 2) { run.Loaded = true; run.Off = 0; run.Distance = Math.Min(run.Length, run.Distance + (secs - load - 2) * 1.05); }
                foreach (var lead in ev.Leads) if (lead.Role == "bearers") run.Bearers.Add(lead.Id);
                Along(run); runs.Add(run);
            }
            run.Seen = true;
            if (!run.Loaded)
            {
                int near = 0; var back = BackOf(ev.Id)!.Value;
                foreach (string id in run.Bearers) if (town.ActionPerson(id)?.P is { } p && Whereabouts.Hypot(p.X - back.X, p.Z - back.Y) < 3.2) near++;
                if (near >= 2 || Events.I.StageT(ev.Id) >= 0.4) run.Loaded = true;
            }
        }
        var eye = Main.I.Cam.GlobalPosition;
        for (int i = runs.Count - 1; i >= 0; i--)
        {
            var r = runs[i]; double previous = r.Distance;
            if (r.Loaded) { if (r.Off > 0) r.Off -= delta; else r.Distance = Math.Min(r.Length, r.Distance + delta * 1.05); }
            Along(r); double distance = Whereabouts.Hypot(r.X - eye.X, r.Z - eye.Z);
            if (!r.Seen && (r.Distance >= r.Length - 0.1 || distance > 45 || r.Root == null)) { Drop(r); runs.RemoveAt(i); continue; }
            if (r.Root == null && distance < 150) Make(r);
            if (distance > 170 && r.Root != null) Drop(r);
            if (r.Root == null) continue;
            r.Root.Position = new Vector3((float)r.X, (float)town.Walk.BaseAt(r.X, r.Z), (float)r.Z); r.Root.Rotation = new Vector3(0, (float)r.Yaw, 0);
            r.Coffin!.Visible = r.Loaded;
            foreach (var w in r.Wheels) w.RotateX((float)(r.Distance - previous) / 0.5f);
            foreach (var horse in r.Horses) horse.Set(r.Distance, r.Distance > previous ? 1 : 0, false);
        }
        LogicMs = (Time.GetTicksUsec() - start) / 1000.0; AllocatedBytes = GC.GetAllocatedBytesForCurrentThread() - before;
    }
    private static void Along(Run r)
    {
        double left = r.Distance;
        for (int i = 1; i < r.Route.Count; i++)
        {
            var a = r.Route[i - 1]; var b = r.Route[i]; double length = Whereabouts.Hypot(b[0] - a[0], b[1] - a[1]);
            if (left <= length || i == r.Route.Count - 1) { double t = length > 0 ? Math.Min(1, left / length) : 0; r.X = a[0] + (b[0] - a[0]) * t; r.Z = a[1] + (b[1] - a[1]) * t; r.Yaw = Math.Atan2(b[0] - a[0], b[1] - a[1]); return; }
            left -= length;
        }
    }
    private static void Make(Run r)
    {
        r.Root = new Node3D { Name = "event_hearse" }; Main.I.View.AddChild(r.Root);
        EventProps.Box(r.Root, new Vector3(1.12f, 0.44f, 2.6f), new Vector3(0, 0.77f, -0.05f), 0x1a181c);
        EventProps.Box(r.Root, new Vector3(1.22f, 0.1f, 2.72f), new Vector3(0, 2.5f, -0.05f), 0x1a181c);
        EventProps.Box(r.Root, new Vector3(1.22f, 0.04f, 2.72f), new Vector3(0, 2.2f, -0.05f), 0xa8a49a);
        foreach (float x in new[] { -0.5f, 0.5f }) foreach (float z in new[] { -1.25f, 1.15f }) LeadLooks.Cylinder(r.Root, 0.035f, 0.045f, 1.5f, 0x1a181c, x, 1.72f, z);
        EventProps.Box(r.Root, new Vector3(0.04f, 0.3f, 0.04f), new Vector3(0, 2.75f, 0), 0xa8a49a); EventProps.Box(r.Root, new Vector3(0.2f, 0.04f, 0.04f), new Vector3(0, 2.8f, 0), 0xa8a49a);
        foreach (float x in new[] { -0.66f, 0.66f }) foreach (float z in new[] { -0.95f, 1.05f })
        {
            var w = LeadLooks.Cylinder(r.Root, 0.5f, 0.5f, 0.05f, 0x241e1c, x, 0.5f, z); w.Rotation = new Vector3(0, 0, MathF.PI / 2); r.Wheels.Add(w);
        }
        foreach (float x in new[] { -0.55f, 0.55f })
        {
            var horse = new EventHorse(); horse.Root.Position = new Vector3(x, 0, 4); r.Root.AddChild(horse.Root); r.Horses.Add(horse);
        }
        r.Coffin = LeadLooks.Coffin(); r.Coffin.Position = new Vector3(0, 0.98f, -0.05f); r.Root.AddChild(r.Coffin);
    }
    private static void Drop(Run r) { r.Root?.QueueFree(); r.Root = r.Coffin = null; r.Wheels.Clear(); r.Horses.Clear(); }
    public void Reset() { foreach (var r in runs) Drop(r); runs.Clear(); }
    public override void _ExitTree() { Reset(); if (I == this) I = null; }
}
