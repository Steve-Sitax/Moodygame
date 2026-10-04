using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Net;
using Scheldemist.Play;
using Scheldemist.Town;
using Scheldemist.World;
using Scheldemist.Audio;

namespace Scheldemist.Game;

/// <summary>game/townlife.ts: the engine's burning house, bucket line and dawn call for men.</summary>
[GamePart(233)]
public partial class TownLife : Node
{
    private sealed class FireLive
    {
        public int Id, Stage = -1;
        public bool Seen;
        public bool Alarmed;
        public SoundHandle? Alarm;
        public Fires.Fire? Fx;
        public Node3D? Pump;
        public MeshInstance3D? Hose;
        public readonly List<(Node3D Wheel, float Radius)> Wheels = new(4);
        public readonly List<Node3D> Brakes = new(2);
        public double LastTravel;
        public readonly List<EventHorse> Horses = new(2);
        public double PumpLength;
        public FireView View = null!;
        public readonly Vector2?[] Hands = new Vector2?[64];
        public readonly List<Vector2> FullHands = new(64), BackHands = new(64);
        public float Flame;
    }
    public static TownLife? I { get; private set; }
    private Townspeople? town;
    private readonly List<FireLive> fires = new(2);
    private readonly HashSet<string> said = new();
    private MultiMesh buckets = null!;
    private MultiMeshInstance3D bucketNode = null!;
    private double clock;
    public int FiresDrawn => fires.Count;
    public int BucketCount => buckets.VisibleInstanceCount;
    public double LogicMs { get; private set; }
    public long AllocatedBytes { get; private set; }
    public override void _Ready()
    {
        I = this; town = GetParent().GetNodeOrNull<Townspeople>("Townspeople");
        buckets = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, Mesh = new CylinderMesh { TopRadius = 0.16f, BottomRadius = 0.12f, Height = 0.32f, RadialSegments = 7, Rings = 1, Material = Goods.I.Plain(0x9a7448) }, InstanceCount = 64, VisibleInstanceCount = 0 };
        PrepareSoot();
        bucketNode = new MultiMeshInstance3D { Multimesh = buckets, Name = "chain_buckets" }; Main.I.View.AddChild(bucketNode);
    }
    public override void _Process(double delta)
    {
        clock += delta; PollLife(delta);
        ulong start = Time.GetTicksUsec(); long before = GC.GetAllocatedBytesForCurrentThread();
        if (Events.I == null || town?.Walk == null) return;
        WalkLamps(delta);
        foreach (var f in fires) f.Seen = false;
        int count = 0;
        foreach (var live in Events.I.List)
        {
            var ev = live.Event; if (ev.Status != "running") continue;
            if (ev.Fire != null) count = Fire(live, count, delta);
            if (ev.Hiring != null) Hiring(live);
        }
        for (int i = fires.Count - 1; i >= 0; i--) if (!fires[i].Seen) { Drop(fires[i]); fires.RemoveAt(i); }
        DrawSoot();
        buckets.VisibleInstanceCount = count;
        LogicMs = (Time.GetTicksUsec() - start) / 1000.0; AllocatedBytes = GC.GetAllocatedBytesForCurrentThread() - before;
    }
    private int Fire(Events.Live live, int count, double delta)
    {
        var ev = live.Event; var v = ev.Fire!; FireLive? f = null;
        foreach (var old in fires) if (old.Id == ev.Id) { f = old; break; }
        if (f == null) { f = new FireLive { Id = ev.Id }; fires.Add(f); for (int i = 1; i < v.PumpPath.Count; i++) f.PumpLength += Whereabouts.Hypot(v.PumpPath[i][0] - v.PumpPath[i - 1][0], v.PumpPath[i][1] - v.PumpPath[i - 1][1]); }
        f.Seen = true; f.View = v;
        string? act = ev.Acts != null && ev.Stage < ev.Acts.Count ? ev.Acts[ev.Stage] : null;
        if (!f.Alarmed && act == "fire_start" && Soundscape.I != null)
        {
            f.Alarmed = true; f.Alarm = Soundscape.I.EventSound("alarm", -266, 158, Math.Max(12, live.Left * 2));
            if (Scheldemist.Player.Jef.I is { } j && Whereabouts.Hypot(j.X - v.Step[0], j.Z - v.Step[1]) < 260) GameState.I.Say("Fire! The alarm bell rings: " + v.OwnerName + "'s house is burning.");
        }
        float t = (float)Events.I!.StageT(ev.Id), smoke = 0;
        f.Flame = act switch { "fire_start" => 0.35f + 0.6f * t, "fire_brigade" => 1, "fire_chain" => 1 - 0.55f * t, "fire_down" => 0.45f * (1 - t), _ => 0 };
        smoke = act switch { "fire_start" => 1.3f + 0.6f * t, "fire_brigade" => 2, "fire_chain" => 2 + 0.4f * t, "fire_down" => 2.4f * (1 - t) + 0.2f, _ => 0 };
        var eye = Main.I.Cam.GlobalPosition;
        if (f.Fx == null && Whereabouts.Hypot(v.Door[0] - eye.X, v.Door[1] - eye.Z) < 140 && Fires.I != null) f.Fx = Fires.I.Create(FireSpots(v), 18);
        f.Fx?.SetLevel(f.Flame, smoke);
        f.Stage = ev.Stage;
        if (act is "fire_brigade" or "fire_chain" or "fire_down")
        {
            if (f.Pump == null)
            {
                f.Pump = MakePump(f); Main.I.View.AddChild(f.Pump);
                foreach (float x in new[] { -0.55f, 0.55f }) { var horse = new EventHorse(); horse.Root.Position = new Vector3(x, 0, 3.6f); f.Pump.AddChild(horse.Root); f.Horses.Add(horse); }
            }
            double from = Math.Max(0, f.PumpLength - 150), seconds = (Events.StageOf(ev)!.Minutes - live.Left) * 2;
            double travelled = act != "fire_brigade" ? f.PumpLength : Math.Min(f.PumpLength, from + seconds * Math.Max(3.5, (f.PumpLength - from) / 16));
            bool arrived = travelled >= f.PumpLength - 0.05;
            double xAt = v.PumpAt[0], zAt = v.PumpAt[1], yaw = v.PumpAt[2];
            if (!arrived) Along(v.PumpPath, travelled, out xAt, out zAt, out yaw);
            f.Pump.Position = new Vector3((float)xAt, (float)town!.Walk!.BaseAt(xAt, zAt), (float)zAt); f.Pump.Rotation = new Vector3(0, (float)yaw, 0);
            foreach (var horse in f.Horses) horse.Set(travelled, arrived ? 0 : 1, true);
            foreach (var wheel in f.Wheels) wheel.Wheel.RotateX((float)((travelled - f.LastTravel) / wheel.Radius));
            f.LastTravel = travelled;
            foreach (var brake in f.Brakes) brake.Rotation = new Vector3(arrived && f.Flame > 0.04 ? (float)Math.Sin(clock * 6.3) * 0.2f : 0, 0, 0);
            if (arrived && f.Hose == null) f.Hose = MakeHose(f.Pump, v, town.Walk!);
        }
        if (act is "fire_brigade" or "fire_chain" or "fire_down") count = Chain(f, ev.Id, act, count, delta);
        SetSoot(ev.Id, v.Door, v.Out, v.Storeys, act switch { "fire_start" => 0.15f * t, "fire_brigade" => 0.15f + 0.2f * t, "fire_chain" => 0.35f + 0.4f * t, _ => 0.75f + 0.1f * t });
        return count;
    }
    private static List<(Vector3 at, float size)> FireSpots(FireView v)
    {
        var spots = new List<(Vector3, float)>(26);
        void At(double side, double outward, double y, float size) => spots.Add((new Vector3((float)(v.Door[0] - v.Out[1] * side + v.Out[0] * outward), (float)y, (float)(v.Door[1] + v.Out[0] * side + v.Out[1] * outward)), size));
        void Window(double side, double y, float size) { At(side - 0.32, 0.3, y, size); At(side + 0.32, 0.3, y, size); }
        int storeys = Math.Clamp(v.Storeys, 2, 5);
        Window(-3, 1.6, 0.95f); Window(3, 1.6, 1.05f);
        for (int k = 1; k < Math.Min(storeys, 4); k++) { double y = 3.8 + 3 * (k - 1) + 1; Window(-3, y, 1.3f); Window(0, y, 1.45f); Window(3, y, 1.35f); }
        foreach (double side in new[] { -3.3, -1.1, 1.1, 3.3 }) At(side, -2.4 - Math.Abs(side) * 0.15, 3.8 + 3 * (storeys - 1) + 1, side > 0 ? 2.8f : 2.5f);
        return spots;
    }
    private static void Along(List<double[]> path, double distance, out double x, out double z, out double yaw)
    {
        x = z = yaw = 0;
        for (int i = 1; i < path.Count; i++)
        {
            var a = path[i - 1]; var b = path[i]; double length = Whereabouts.Hypot(b[0] - a[0], b[1] - a[1]);
            if (distance <= length || i == path.Count - 1) { double k = length > 0 ? Math.Min(1, distance / length) : 0; x = a[0] + (b[0] - a[0]) * k; z = a[1] + (b[1] - a[1]) * k; yaw = Math.Atan2(b[0] - a[0], b[1] - a[1]); return; }
            distance -= length;
        }
    }
    private void Hiring(Events.Live live)
    {
        var ev = live.Event; var h = ev.Hiring!;
        foreach (var spot in h.Spots)
        {
            if (spot.Call != null && said.Add(spot.Call) && spot.Foreman != null)
            {
                var lines = new List<Scheldemist.Talks.ConvoLine> { new() { Who = spot.Foreman, Name = Play.Folk.NameOf(spot.Foreman), Text = spot.Call } };
                foreach (string remark in spot.Remarks) lines.Add(new() { Who = spot.Foreman, Name = Play.Folk.NameOf(spot.Foreman), Text = remark });
                Scheldemist.Talks.Bubbles.I?.Show(new Scheldemist.Talks.Convo { Id = -1000 - ev.Id * 10 - h.Spots.IndexOf(spot), A = spot.Foreman, B = spot.Foreman, Lines = lines });
            }
            if (spot.JefResult != null && said.Add(spot.JefResult.Text)) GameState.I.Say(spot.JefResult.Text);
        }
    }
    private static void Drop(FireLive f) { f.Alarm?.Stop(); f.Fx?.Free(); f.Pump?.QueueFree(); f.Hose?.QueueFree(); }
    public void Reset() { ResetLife(); foreach (var f in fires) Drop(f); fires.Clear(); said.Clear(); buckets.VisibleInstanceCount = 0; }
    public override void _ExitTree() { ResetLife(); foreach (var s in sootPool) s.Node.QueueFree(); foreach (var f in fires) Drop(f); bucketNode.QueueFree(); if (I == this) I = null; }
}
