using System;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.Models;
using Scheldemist.People;
using Scheldemist.Play;
using Scheldemist.World;
namespace Scheldemist.Town;

/// <summary>lively.ts window residents: only behind a real upper-floor opening, never over a blind wall.</summary>
[GamePart(198)]
public partial class StreetWindows : Node
{
    public static StreetWindows? I { get; private set; }
    public static Mesh RopeMesh = null!, CardMesh = null!, PipeStem = null!, PipeBowl = null!;
    private sealed class Window { public Human Human = null!; public Node3D Root = null!; public Resident Person = null!; public Vector3 At; public Vector2 Out; public bool Seen; }
    private readonly Dictionary<string, Window> figures = new();
    private readonly List<string> gone = new();
    private readonly List<Vector3> openings = new();
    private readonly List<Vector2> upstairsDoors = new();
    private double poll;
    private Townspeople? town;
    public int Count => figures.Count;
    public int UpperOpenings => openings.Count;
    internal Vector3? PositionOf(string id)=>figures.TryGetValue(id,out var w)&&w.Root.Visible?w.Root.GlobalPosition:null;
    internal bool HasOpening(Resident r){foreach(var o in openings)if(o.Y<6.5&&Whereabouts.Hypot(o.X-r.HomeX,o.Z-r.HomeZ)<1.5)return true;foreach(var door in upstairsDoors)if(Whereabouts.Hypot(door.X-r.HomeX,door.Y-r.HomeZ)<1)return true;return false;}
    public override void _Ready()
    {
        I = this;
        ModelLibrary.Get("lively", new(TwoSided:true, Affine:0, VertexColor:true));
        if (ModelLibrary.Get("streetlife")?.Roots.TryGetValue("streetlife_meta", out var meta) == true && meta.HasMeta("extras"))
        {
            var extras=meta.GetMeta("extras").AsGodotDictionary();
            if(extras.TryGetValue("meta",out var value))
            {
                using var doc=JsonDocument.Parse(value.AsString());
                foreach(var wall in doc.RootElement.GetProperty("walls").EnumerateArray())
                    if(wall[8].GetInt32()==0&&wall[7].GetInt32()>=2&&wall[10].GetDouble()>=0)
                    { double f=wall[10].GetDouble();upstairsDoors.Add(new((float)(wall[0].GetDouble()+(wall[2].GetDouble()-wall[0].GetDouble())*f),(float)(wall[1].GetDouble()+(wall[3].GetDouble()-wall[1].GetDouble())*f))); }
            }
        }
        RopeMesh = new CylinderMesh { TopRadius=.018f,BottomRadius=.018f,Height=1,RadialSegments=3,Rings=1,Material = Goods.I.Plain(0xc2ae84) };
        CardMesh = new BoxMesh { Size = new(.32f,.004f,.22f), Material = Goods.I.Plain(0xd8cfb8) };
        PipeStem = new CylinderMesh{TopRadius=.012f,BottomRadius=.012f,Height=.22f,RadialSegments=5,Rings=1,Material=Goods.I.Plain(0x473225)};
        PipeBowl = new CylinderMesh{TopRadius=.033f,BottomRadius=.025f,Height=.07f,RadialSegments=6,Rings=1,Material=Goods.I.Plain(0x473225)};
        foreach (var node in BakedWorld.All(Main.I.World)) if (node is Node3D n && n.Name.ToString().StartsWith("opening_") && n.GlobalPosition.Y > 3 && n.HasMeta("extras"))
        { var e = n.GetMeta("extras").AsGodotDictionary(); if (e.ContainsKey("kind") && e["kind"].AsString().Contains("window")) openings.Add(n.GlobalPosition); }
        if (Menu.MainMenu.I is { } menu) menu.WorldReplaced += Reset;
    }
    private void Reset(string how, Net.ClientState? state) { foreach (var w in figures.Values) w.Root.QueueFree(); figures.Clear();town?.ClearStreetGames(); }
    public override void _Process(double delta)
    {
        town ??= Main.I.GetNodeOrNull<Townspeople>("Townspeople"); if (town?.Data == null || town.Paused) return;
        town.HideOldGames();
        if ((poll -= delta) <= 0)
        {
            poll = .5; foreach (var w in figures.Values) w.Seen = false;
            foreach (var s in town.Simulations)
            {
                var r = s.R; if (s.ActionHeld || !town.WindowNow(s) || Whereabouts.Hypot(r.HomeX - Main.I.Cam.GlobalPosition.X, r.HomeZ - Main.I.Cam.GlobalPosition.Z) > 45) continue;
                if (figures.TryGetValue(r.Id, out var old)) { old.Seen = true; continue; }
                Vector3? opening = null; double best = 1.5;
                foreach (var p in openings) { double d = Whereabouts.Hypot(p.X - r.HomeX, p.Z - r.HomeZ); if (d < best && p.Y < 6.5) { best = d; opening = p; } }
                // Painted upper windows have no room-opening marker; the browser uses the facade's actual door bay.
                if(opening==null) foreach(var door in upstairsDoors) if(Whereabouts.Hypot(door.X-r.HomeX,door.Y-r.HomeZ)<1) { opening=new((float)r.HomeX,4.45f,(float)r.HomeZ);break; }
                if (opening is not { } o) continue;
                double length = Math.Max(.1, Whereabouts.Hypot(r.HomeSx-r.HomeX,r.HomeSz-r.HomeZ)); var outward = new Vector2((float)((r.HomeSx-r.HomeX)/length),(float)((r.HomeSz-r.HomeZ)/length));
                var human = Humans.Make(r.Kind); if (human == null) continue;
                var at = new Vector3(o.X-outward.X*.6f, o.Y-1.05f, o.Z-outward.Y*.6f);
                var root = new Node3D { Name = "window_resident_" + r.Id, Position = at, RotationOrder=EulerOrder.Yxz, Rotation = new(.38f,MathF.Atan2(outward.X,outward.Y),0) }; root.AddChild(human.Root); Main.I.View.AddChild(root); human.Start(); human.Play("lean");
                figures[r.Id] = new Window { Human = human, Root = root, Person = r, At = at, Out = outward, Seen = true };
            }
            gone.Clear(); foreach (var p in figures) if (!p.Value.Seen) gone.Add(p.Key);
            foreach (string id in gone) { figures[id].Root.QueueFree(); figures.Remove(id); }
        }
        foreach (var w in figures.Values)
        {
            double phase = ((town.Day * 1440 + town.Hour * 60) * 2 + Townspeople.WindowSeed(w.Person.Id)) % 52;
            bool inside = phase >= 23 && phase < 48; float retreat = (float)(phase >= 22 && phase < 23 ? phase-22 : phase>=48 && phase<49 ? 49-phase : inside ? 1 : 0);
            w.Root.Visible = !inside; w.Root.Position = w.At - new Vector3(w.Out.X,0,w.Out.Y)*retreat*.8f; w.Root.Rotation = new(.38f*(1-retreat),MathF.Atan2(w.Out.X,w.Out.Y),0);
            if (!inside) w.Human.Update((float)Math.Min(delta,.1));
        }
    }
    public override void _ExitTree() { Reset("exit",null); if (Menu.MainMenu.I is { } menu) menu.WorldReplaced -= Reset; if (I == this) I = null; }
}
public partial class Townspeople
{
    internal static double WindowSeed(string id)=>LifeHash(id)*52;
    internal bool WindowNow(Sim s)
    {
        if (Whereabouts.ActivityAt(s.R.Sched, day, hour).Act != "home" || !doorLife.TryGetValue(s.R.Id, out var plan)) return false;
        foreach (var seg in plan) if (seg.Act == "window" && seg.Day == (day-1)%7+1 && hour >= seg.From && hour < seg.To) return true;
        return false;
    }
    internal (Sim person,double hour)? WindowTrial()
    {
        foreach(var pair in doorLife)if(byId.TryGetValue(pair.Key,out var s)&&StreetWindows.I?.HasOpening(s.R)==true)
            foreach(var seg in pair.Value)if(seg.Act=="window"&&seg.Day==(day-1)%7+1)
            {
                double h=(seg.From+seg.To)/2;
                double phase=((day*1440+h*60)*2+WindowSeed(s.R.Id))%52;
                h+=(10-phase)/120;
                if(h>=seg.From&&h<seg.To&&Whereabouts.ActivityAt(s.R.Sched,day,h).Act=="home")return(s,h);
            }
        return null;
    }
}
