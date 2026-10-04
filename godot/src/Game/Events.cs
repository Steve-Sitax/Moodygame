using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Audio;
using Scheldemist.Net;
using Scheldemist.People;
using Scheldemist.Play;
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.Game;

/// <summary>game/events.ts: server stages, placed props, nearby sound, notice and map marks.
/// Polls replace authoritative stages; only minutes remaining interpolate between replies.</summary>
[GamePart(230)]
public partial class Events : Node
{
    public sealed class Live
    {
        public TownEvent Event = null!;
        public double Left;
        public int Stage = -1, SoundStage = -1;
        public double SoundUntil, CuesUntil;
        public SoundHandle? Sound, Cues;
        public CueSpec[] CueSpecs = Array.Empty<CueSpec>();
        public string PropsKind = "none";
        public readonly List<Node3D> Props = new(5);
        public bool Told, Seen;
        public string Notice = "";
        public MapMark? Mark;
        public Node3D? Coffin;
        public double MetAt = -1, MeetSince = -1, LiftedAt = -1, MeetX, MeetZ, MeetUx, MeetUz;
    }
    public static Events? I { get; private set; }
    public readonly List<Live> List = new();
    private readonly List<MapMark> marks = new(12);
    private Townspeople? town;
    private float storm;
    public float StormLevel => storm;
    public int SoundStarts { get; private set; }
    public int CueStarts { get; private set; }
    public int PropCount { get { int n = 0; foreach (var l in List) n += l.Props.Count; return n; } }
    public double LogicMs { get; private set; }
    public long AllocatedBytes { get; private set; }
    public override void _Ready()
    {
        I = this; town = GetParent().GetNodeOrNull<Townspeople>("Townspeople");
        foreach (uint colour in new uint[] { 0xb03a2c, 0x6a4a2c, 0x2c2c2e, 0xd8aa48, 0xffc27a, 0x0e0d10, 0x141214, 0x151417, 0x1a181c, 0x241e1c, 0x24402a, 0x2a1c14, 0x2a2a2c, 0x3a2616, 0x3a3430, 0x3a3a3c, 0x3b2c24, 0x3e5a2c, 0x4a3222, 0x5a3a20, 0x5a3a24, 0x685032, 0x6a2a5a, 0x6a3f22, 0x7a4a9a, 0x8a2520, 0x8a2a24, 0x9a2924, 0x9a7448, 0xa68434, 0xa8a49a, 0xb04a6a, 0xb8923a, 0xb89a4a, 0xc89a4a, 0xd8c060, 0xd8cfb4, 0xd8cfb8, 0xe6e2d6, 0xe8e0d0, 0xece8dc, 0xf4efe0 }) Goods.I.Plain(colour);
        TownMap.I?.AddMarks(MapMarks);
        if (Soundscape.I != null) Soundscape.I.TempestNow = TempestNow;
    }
    private (double level, double gust, double shelter) TempestNow() => (storm, 0, 0);
    public Live? Find(int? id)
    {
        if (id == null) return null;
        foreach (var l in List) if (l.Event.Id == id) return l;
        return null;
    }
    public static EventStage? StageOf(TownEvent ev) => ev.Stage >= 0 && ev.Stage < ev.Stages.Count ? ev.Stages[ev.Stage] : null;
    public double StageT(int? id)
    {
        var l = Find(id); var s = l == null ? null : StageOf(l.Event);
        return s == null || s.Minutes <= 0 ? 0 : Math.Clamp(1 - l!.Left / s.Minutes, 0, 1);
    }
    public void Apply(ActionsPayload payload)
    {
        foreach (var l in List) l.Seen = false;
        foreach (var ev in payload.Events)
        {
            var l = Find(ev.Id);
            if (l == null) { l = new Live(); List.Add(l); }
            l.Seen = true; l.Event = ev; l.Left = ev.StageLeft;
            var st = StageOf(ev);
            if (l.Stage != ev.Stage)
            {
                StopSounds(l); l.Stage = ev.Stage; l.SoundStage = -1;
                l.CueSpecs = st?.Cues == null ? Array.Empty<CueSpec>() : new CueSpec[st.Cues.Count];
                for (int i = 0; i < l.CueSpecs.Length; i++) { var c = st!.Cues![i]; l.CueSpecs[i] = new CueSpec(c.Source, c.EveryS, c.Pitch, c.Level); }
            }
            string names = "";
            var seenNames = new HashSet<string>();
            foreach (var lead in ev.Leads) if (lead.Role != "agent" && seenNames.Add(lead.Name)) names += (names == "" ? "" : " and ") + lead.Name;
            l.Notice = ev.Title + (names == "" ? "" : " (" + names + ")") + ": people are gathering at " + (st?.Label ?? ev.Place) + ".";
            l.Mark = new MapMark((float)(st?.X ?? ev.X), (float)(st?.Z ?? ev.Z), ev.Title, "event", "at " + (st?.Label ?? ev.Place));
            if (ev.Status != "running") Clear(l);
        }
        for (int i = List.Count - 1; i >= 0; i--) if (!List[i].Seen) { Clear(List[i]); List.RemoveAt(i); }
        MarketStalls.I?.SetEventClosed(payload.Closed);
    }
    private IEnumerable<MapMark> MapMarks()
    {
        marks.Clear(); var j = Scheldemist.Player.Jef.I;
        foreach (var l in List)
        {
            var st = StageOf(l.Event);
            if (l.Event.Status != "running" || l.Mark == null || (st == null || st.Mood == "tense" && st.Count < 2) && !l.Told) continue;
            float d = j == null ? 0 : new Vector2(l.Mark.X - j.X, l.Mark.Z - j.Z).LengthSquared();
            int at = marks.Count;
            while (at > 0 && j != null && new Vector2(marks[at - 1].X - j.X, marks[at - 1].Z - j.Z).LengthSquared() > d) at--;
            marks.Insert(at, l.Mark); if (marks.Count > 12) marks.RemoveAt(12);
        }
        return marks;
    }
    public override void _Process(double delta)
    {
        long before = GC.GetAllocatedBytesForCurrentThread(); ulong start = Time.GetTicksUsec();
        var j = Scheldemist.Player.Jef.I;
        float target = 0; int stormId = 0;
        foreach (var l in List)
        {
            var ev = l.Event; if (ev.Status != "running") continue;
            l.Left = Math.Max(0, l.Left - delta * 0.5);
            var s = StageOf(ev); if (s == null) continue;
            CarryCoffin(l);
            if (ev.Tempest is { } tempest)
            {
                double t = s.Minutes > 0 ? Math.Clamp(1 - l.Left / s.Minutes, 0, 1) : 1;
                target = tempest.Phase switch { "coming" => (float)(0.12 + (0.55 - 0.12) * t), "peak" => 1, "easing" => (float)(1 + (0.25 - 1) * t), _ => 0 }; stormId = ev.Id;
            }
            if (j == null) continue;
            double d = Whereabouts.Hypot(s.X - j.X, s.Z - j.Z); bool near = d < 90;
            if (!l.Told && near && town != null)
            {
                int there = 0;
                foreach (string id in ev.People) if (town.PositionOf(id) is { } p && Whereabouts.Hypot(p.x - s.X, p.z - s.Z) < ev.R + 6) there++;
                if (there >= Math.Min(5, Math.Max(2, (ev.People.Count + 1) / 2))) { l.Told = true; if (Hud.I != null) Hud.I.Outcome("In town", l.Notice); else GameState.I.Say(l.Notice); }
            }
            if (l.Sound != null && l.Left < l.SoundUntil) { l.Sound.Stop(); l.Sound = null; l.SoundStage = -1; }
            if (l.SoundStage != ev.Stage && s.Sound != "none" && near && l.Left > 2 && Soundscape.I != null)
            {
                double seconds = Math.Clamp(l.Left * 2, 6, 180); l.SoundUntil = l.Left - seconds * 0.5;
                l.Sound = Soundscape.I.EventSound(s.Sound, s.X, s.Z, seconds); l.SoundStage = ev.Stage; SoundStarts++;
            }
            else l.Sound?.Move(s.X, s.Z);
            if (l.Cues != null && (l.Left < l.CuesUntil || d > 135)) { l.Cues.Stop(); l.Cues = null; }
            if (l.Cues == null && l.CueSpecs.Length > 0 && near && l.Left > 2 && Soundscape.I != null)
            {
                double seconds = Math.Clamp(l.Left * 2, 6, 180); l.CuesUntil = l.Left - seconds * 0.5;
                l.Cues = Soundscape.I.EventCues(l.CueSpecs, s.X, s.Z, seconds); CueStarts++;
            }
            else l.Cues?.Move(s.X, s.Z);
            if (s.Props != "none" && l.PropsKind != s.Props && near) { DropProps(l); PlaceProps(l, s); }
        }
        storm += (target - storm) * (float)Math.Min(1, delta * (target > storm ? 0.18 : 0.05));
        if (storm < 0.002f && target == 0) storm = 0;
        Daylight.I?.SetStorm(storm); town?.SetStorm(storm, stormId);
        LogicMs = (Time.GetTicksUsec() - start) / 1000.0; AllocatedBytes = GC.GetAllocatedBytesForCurrentThread() - before;
    }
    private void PlaceProps(Live l, EventStage stage)
    {
        if (town?.Walk is not { } walk) return;
        int n = stage.Props == "black_cloth" ? 2 : stage.Props == "flowers" ? 5 : 4;
        double r = Math.Clamp(l.Event.R, 2.5, 6) * 0.9;
        for (int i = 0; i < n; i++)
        {
            double a = i * Math.PI * 2 / n + 0.7, x = stage.X + Math.Cos(a) * r, z = stage.Z + Math.Sin(a) * r;
            if (!PropPoint(l, x, z, out x, out z)) continue;
            var prop = EventProps.Make(stage.Props);
            double h = Math.Sin(x * 12.9898 + z * 78.233 + i * 37.719) * 43758.5453;
            prop.Position = new Vector3((float)x, (float)walk.BaseAt(x, z), (float)z);
            prop.Rotation = new Vector3(0, (float)((h - Math.Floor(h)) * Math.PI * 2), 0);
            Main.I.View.AddChild(prop); l.Props.Add(prop);
        }
        l.PropsKind = stage.Props;
    }
    private bool PropPoint(Live live, double anchorX, double anchorZ, out double x, out double z)
    {
        x = anchorX; z = anchorZ;
        if (town?.Walk == null) return false;
        bool Free(double px, double pz)
        {
            if (!town.Walk.Free(px,pz)) return false;
            foreach (var prop in live.Props) if (Whereabouts.Hypot(px-prop.Position.X,pz-prop.Position.Z)<.9) return false;
            return true;
        }
        if (Free(x,z)) return true;
        // The merged town has live footprints absent from the original prop ring. Keep valid anchors,
        // but find a nearby clear patch for a blocked one rather than silently losing the scene's props.
        for (double radius=.5; radius<=6; radius+=.5) for (int k=0; k<16; k++)
        {
            double angle=.7+k*Math.PI/8, px=anchorX+Math.Cos(angle)*radius, pz=anchorZ+Math.Sin(angle)*radius;
            if (!Free(px,pz)) continue;
            x=px; z=pz; return true;
        }
        return false;
    }
    private static void StopSounds(Live l) { l.Sound?.Stop(); l.Cues?.Stop(); l.Sound = l.Cues = null; }
    private static void DropProps(Live l) { foreach (var p in l.Props) p.QueueFree(); l.Props.Clear(); l.PropsKind = "none"; }
    private static void Clear(Live l) { StopSounds(l); DropProps(l); l.Coffin?.QueueFree(); l.Coffin = null; }
    private void CarryCoffin(Live live)
    {
        if (town?.Walk == null) return;
        int count = 0; double x = 0, z = 0, frontX = 0, frontZ = 0; Puppet? first = null;
        bool inside = false;
        foreach (var lead in live.Event.Leads) if (lead.Role == "bearers")
        {
            var s = town.ActionPerson(lead.Id); inside |= s?.Inside == true;
            if (s?.P is not { } p) continue;
            first ??= p; if (count < 2) { frontX += p.X; frontZ += p.Z; }
            count++; x += p.X; z += p.Z;
        }
        bool show = count >= 2 && !inside && Hearses.I?.HasCoffin(live.Event.Id) != true;
        if (!show) { if (live.Coffin != null) live.Coffin.Visible = false; return; }
        x /= count; z /= count;
        foreach (var lead in live.Event.Leads) if (lead.Role == "bearers" && town.ActionPerson(lead.Id)?.P is { } p && Whereabouts.Hypot(p.X - x, p.Z - z) >= 3) show = false;
        if (live.Coffin == null) { live.Coffin = LeadLooks.Coffin(); Main.I.View.AddChild(live.Coffin); }
        live.Coffin.Visible = show;
        if (!show) return;
        double dx = frontX / 2 - x, dz = frontZ / 2 - z;
        live.Coffin.Position = new Vector3((float)x, (float)town.Walk.BaseAt(x, z) + 1.5f * first!.Human.Scale, (float)z);
        live.Coffin.Rotation = new Vector3(0, (float)(Whereabouts.Hypot(dx, dz) > 0.2 ? Math.Atan2(dx, dz) : first.Yaw), 0);
    }
    public void Reset() { foreach (var l in List) Clear(l); List.Clear(); MarketStalls.I?.SetEventClosed(Array.Empty<string>()); }
    public override void _ExitTree() { Reset(); if (Soundscape.I != null) Soundscape.I.TempestNow = null; if (I == this) I = null; }
}

internal static class EventProps
{
    public static MeshInstance3D Box(Node root, Vector3 size, Vector3 at, uint color)
    {
        var mesh = new MeshInstance3D { Mesh = new BoxMesh { Size = size, Material = Goods.I.Plain(color) }, Position = at }; root.AddChild(mesh); return mesh;
    }
    public static Node3D Make(string kind)
    {
        var root = new Node3D { Name = "event_" + kind };
        if (kind is "crates" or "sacks" or "barrels")
        {
            root.AddChild(Goods.I.MakeGoods(kind));
            if (kind != "barrels") { var top = Goods.I.MakeGoods(kind); top.Position = new Vector3(kind == "sacks" ? 0.12f : 0, kind == "crates" ? 0.7f : 0.26f, 0); top.Rotation = new Vector3(0, kind == "sacks" ? 0.08f : 0.3f, 0); root.AddChild(top); }
        }
        else if (kind == "black_cloth")
        {
            Box(root, new Vector3(1.6f, 0.06f, 0.7f), new Vector3(0, 0.75f, 0), 0x141214);
            Box(root, new Vector3(1.7f, 0.7f, 0.04f), new Vector3(0, 0.4f, 0.34f), 0x141214);
        }
        else
        {
            root.AddChild(new MeshInstance3D { Mesh = new CylinderMesh { TopRadius = 0.22f, BottomRadius = 0.16f, Height = 0.22f, RadialSegments = 6, Material = Goods.I.Plain(0x685032) }, Position = new Vector3(0, 0.11f, 0) });
            uint[] colors = { 0xb04a6a, 0xd8c060, 0xe8e0d0, 0x7a4a9a };
            for (int i = 0; i < 6; i++) root.AddChild(new MeshInstance3D { Mesh = new SphereMesh { Radius = 0.07f, Height = 0.14f, RadialSegments = 5, Rings = 2, Material = Goods.I.Plain(colors[i % 4]) }, Position = new Vector3(MathF.Cos(i * MathF.Tau / 6) * 0.12f, 0.3f + i % 2 * 0.06f, MathF.Sin(i * MathF.Tau / 6) * 0.12f) });
        }
        return root;
    }
}
