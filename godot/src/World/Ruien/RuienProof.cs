using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Player;
using Scheldemist.Play;

namespace Scheldemist.World.Ruien;

/// <summary>Bounded native swimming and escape-ladder proof, with isolated data supplied by the caller.</summary>
[GamePart(986)]
public partial class RuienProof : Node
{
    private readonly List<object> checks = new();
    private string output = "";
    private int failures;
    private async Task Seconds(float seconds)
    {
        ulong end = Time.GetTicksMsec() + (ulong)(seconds * 1000);
        while (Time.GetTicksMsec() < end) await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
    }
    private void Check(string name, bool ok, string detail = "")
    {
        checks.Add(new { name, ok, detail });
        if (!ok) failures++;
        GD.Print($"RUIEN_PROOF {name}: {(ok ? "PASS" : "FAIL")} {detail}");
    }
    private async Task Shot(string name)
    {
        await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
        Main.I.GetViewport().GetTexture().GetImage().SavePng(Path.Combine(output,name + ".png"));
    }
    private async Task SetTide(float level)
    {
        Tide.Hold(level);ulong end=Time.GetTicksMsec()+12000;
        while(MathF.Abs(Tide.River-level)>.004f && Time.GetTicksMsec()<end)
            await ToSignal(GetTree(),SceneTree.SignalName.PhysicsFrame);
        Check("tide settled",MathF.Abs(Tide.River-level)<.005f,$"requested {level}, actual {Tide.River}");
    }
    private async Task WalkTo(Vector2 target,string name,bool afloat=false)
    {
        var j=Jef.I!;ulong until=Time.GetTicksMsec()+15000;
        while(new Vector2(j.X,j.Z).DistanceTo(target)>.12f && Time.GetTicksMsec()<until)
        {
            var d=target-new Vector2(j.X,j.Z);j.Yaw=MathF.Atan2(-d.X,-d.Y);
            j.SetKey(Key.W,true);await ToSignal(GetTree(),SceneTree.SignalName.PhysicsFrame);
        }
        j.ClearKeys();await Seconds(.3f);
        Check(name,new Vector2(j.X,j.Z).DistanceTo(target)<.22f && (afloat?j.Swimming:j.Grounded && !j.Swimming),$"{j.X},{j.Y},{j.Z}: {j.LastShove}");
    }
    public override async void _Ready()
    {
        output = Main.I.Arg("ruien-proof");
        if (output.Length == 0) return;
        Directory.CreateDirectory(output);
        try
        {
            for (int i=0; i<3600 && (Jef.I == null || Ruien.I == null || !Dev.Kit.I.IsReady); i++)
                await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            var j = Jef.I ?? throw new InvalidOperationException("Player did not become ready.");
            if (j.Fly) j.ToggleFly();
            j.TestInput = true; j.Frozen = false;
            await Dev.Kit.I.Light(13,"clear");
            await Seconds(3); // The initial saved spawn is applied after the kit becomes ready.
            bool access=Main.I.Flag("ruien-proof-access");
            if(!Main.I.Flag("ruien-proof-views-only"))
            {
            if(!Main.I.Flag("ruien-proof-stairs"))
            {
            foreach (float tide in access?Array.Empty<float>():new[] { -4.95f, -0.65f })
            {
                await SetTide(tide);
                j.Place(-149.3f, 97, 0, 0, -5.8f); await Seconds(1);
                j.Place(-149.3f, 97, 0, 0, -5.8f); await Seconds(3);
                Check($"gallery swims at tide {tide}",j.Swimming && !j.Grounded,$"feet {j.Y}, surface {Water.Level(j.X,j.Z)}");
                Check("street above gallery remains dry in street map",!Water.In(-149.3f,97));
                var start = new Vector2(j.X,j.Z); j.SetKey(Key.W,true); await Seconds(2); j.ClearKeys();
                Check("swim advances through gallery",start.DistanceTo(new Vector2(j.X,j.Z)) > 1);
                await Shot(tide < -4 ? "swim-low" : "swim-high");
            }
            await SetTide(-4.95f);
            foreach (var w in Ruien.I!.Data.Areas.SelectMany(a=>a.Ways).Where(w=>w.Kind=="rungs" && w.Irons && (!access || w.Id=="gate_north" || w.Id.EndsWith("_0"))))
            {
                j.Place(w.Bottom.X,w.Bottom.Z,MathF.Atan2(w.Out.X,w.Out.Y),0,Water.Level(w.Bottom.X,w.Bottom.Z)-Jef.SwimFeet);
                await Seconds(1.5f);
                if(access && j.Y>w.Top.Y+.2f)
                {
                    // A late initial-save placement may arrive during the first access-only setup.
                    j.Place(w.Bottom.X,w.Bottom.Z,MathF.Atan2(w.Out.X,w.Out.Y),0,Water.Level(w.Bottom.X,w.Bottom.Z)-Jef.SwimFeet);
                    await Seconds(2);
                }
                Check(w.Id+" water reachable",j.Swimming || j.Grounded,$"{j.X},{j.Y},{j.Z}");
                var action=Interact.I.Acts.FirstOrDefault(a=>a.Key==Key.E && a.Text=="climb onto the ledge");
                Check(w.Id+" E prompt",action!=null,Interact.I.Text);
                if(action!=null)Check(w.Id+" E accepted",Interact.I.Press(Key.E));
                await Seconds(7);
                Check(w.Id+" up",!j.Climbing && j.Grounded && !j.Swimming && MathF.Abs(j.Y-w.Top.Y)<.18f,$"feet {j.Y}, target {w.Top.Y}");
                var q=new PhysicsShapeQueryParameters3D { CollisionMask=Solid.Layer, Shape=new CylinderShape3D{Radius=Jef.Radius,Height=1.4f}, Transform=new Transform3D(Basis.Identity,w.Top+Vector3.Up*1.05f) };
                var hits=GetViewport().World3D.DirectSpaceState.IntersectShape(q,8);
                Check(w.Id+" landing clearance",j.BodyFree(w.Top.X,w.Top.Y+.03f,w.Top.Z),string.Join(",",hits.Select(h=>h["collider"].AsGodotObject() is Node n?n.GetPath().ToString():"?")));
                await Shot(w.Id+"-top");
                RuienWays.RungsDown(w); await Seconds(7);
                Check(w.Id+" down",!j.Climbing && (j.Swimming || j.Grounded));
            }
            await SetTide(-.65f);
            j.Place(-146.1f,66,0,0,-3); await Seconds(3);
            Check("vliet swims at high water",j.Swimming);
            await Shot("vliet-swim");
            await SetTide(-4.95f); await Seconds(1);
            Check("vliet wades at low water",j.Grounded && !j.Swimming);
            await Shot("vliet-wade");
            j.Place(-146.1f,69,MathF.PI,near:-5.05f);await Seconds(2);
            await WalkTo(new Vector2(-147.4f,79),"vliet enters gallery through open sluice",true);
            await Shot("sluice-swim-entry");
            }
            foreach(var stair in Ruien.I!.Data.Areas.SelectMany(a=>a.Ways).Where(w=>w.Kind=="keeper_stair"))
            {
                var hatch=RuienHatch.All[stair.Id];
                j.Place(stair.Top.X,stair.Top.Z-.4f,MathF.PI,near:stair.Top.Y); await Seconds(2);
                hatch.Set(false);await Seconds(3);
                j.Pitch=-.8f;await Seconds(.3f);
                Check(stair.Id+" E open offered",Interact.I.Acts.Any(a=>a.Key==Key.E&&a.Text=="open the iron lids"));
                Check(stair.Id+" E open accepted",Interact.I.Press(Key.E));await Seconds(3);
                Check(stair.Id+" lids swung open",hatch.Open>.99f);j.Pitch=0;
                await Shot(stair.Id+"-open");
                await WalkTo(new Vector2(stair.Bottom.X,stair.Bottom.Z+.6f),stair.Id+" full flight descent");
                Check(stair.Id+" walked down",j.Grounded && !j.Swimming && j.Z>stair.Bottom.Z && MathF.Abs(j.Y-stair.Bottom.Y)<.2f,$"{j.X},{j.Y},{j.Z}: {j.LastShove}");
                await Shot(stair.Id+"-down");
                foreach(var p in stair.LandingPath)await WalkTo(p,stair.Id+" landing path "+p);
                await WalkTo(new Vector2(-148.05f,75.75f),"keeper reaches winch");
                await Shot("keeper-winch");
                j.Place(stair.Bottom.X,stair.Bottom.Z+.8f,0,near:stair.Bottom.Y);await Seconds(1);
                await WalkTo(new Vector2(stair.Top.X,stair.Top.Z-.4f),stair.Id+" full flight ascent");
                Check(stair.Id+" walked up",j.Grounded && j.Z<stair.Top.Z+.2f && MathF.Abs(j.Y-stair.Top.Y)<.2f,$"{j.X},{j.Y},{j.Z}: {j.LastShove}");
                await Shot(stair.Id+"-up");
                j.Yaw=MathF.PI;j.Pitch=-.8f;await Seconds(.3f);
                ulong closeUntil=Time.GetTicksMsec()+2000;
                while(!Interact.I.Acts.Any(a=>a.Key==Key.E&&a.Text=="close the iron lids")&&Time.GetTicksMsec()<closeUntil)await Seconds(.1f);
                Check(stair.Id+" E close offered",Interact.I.Acts.Any(a=>a.Key==Key.E&&a.Text=="close the iron lids"));
                Check(stair.Id+" E close accepted",Interact.I.Press(Key.E));await Seconds(3);
                Check(stair.Id+" lids shut",hatch.Open<.01f);
                foreach(float dx in new[]{-.3f,0,.3f})
                {
                    var p=stair.Top+new Vector3(dx,1,1);
                    var hit=Main.I.View.FindWorld3D().DirectSpaceState.IntersectRay(PhysicsRayQueryParameters3D.Create(p,p-Vector3.Up*2,Solid.Layer));
                    Check("closed lid physical surface "+dx,hit.Count>0&&MathF.Abs(hit["position"].AsVector3().Y-stair.Top.Y)<.08f);
                }
                j.Yaw=MathF.PI;await Seconds(.2f);await Shot(stair.Id+"-closed-before-crossing");
                await WalkTo(new Vector2(stair.Top.X,stair.Top.Z+1),"closed keeper lids support feet");
                Check("closed lid collision at street",j.Grounded&&MathF.Abs(j.Y)<.12f);
                await Shot(stair.Id+"-closed");j.Pitch=0;
            }
            j.Place(-147.65f,107,MathF.PI,near:-3.6f);await Seconds(2);
            await WalkTo(new Vector2(-147.65f,111.3f),"gallery dry route enters hall");
            await Shot("gallery-hall-throat");
            // The new arch must also leave the central channel clear, including a 3.85 m upright giant.
            foreach(float z in new[]{109.5f,110f,110.5f,111f})
            {
                var space=GetViewport().World3D.DirectSpaceState;float bed=-6.1f;
                foreach(float dz in new[]{-.46f,0,.46f})
                {
                    var hit=space.IntersectRay(PhysicsRayQueryParameters3D.Create(new Vector3(-149.5f,-5,z+dz),new Vector3(-149.5f,-6.4f,z+dz),Solid.Layer));
                    if(hit.Count>0)bed=Math.Max(bed,hit["position"].AsVector3().Y);
                }
                var query=new PhysicsShapeQueryParameters3D{Shape=new CapsuleShape3D{Height=3.86f,Radius=.464f},
                    Transform=new Transform3D(Basis.Identity,new Vector3(-149.5f,bed+1.97f,z)),CollisionMask=Solid.Layer,Margin=0};
                var hits=space.IntersectShape(query);
                Check("hall arch channel clearance "+z,hits.Count==0,string.Join(",",hits.Select(h=>(h["collider"].AsGodotObject() as Node)?.GetPath().ToString())));
            }
            var hallStair=Ruien.I.Data.Areas.SelectMany(a=>a.Ways).Single(w=>w.Id=="vleeshuis_hatch");
            j.Place(-158.8f,132.3f,-MathF.PI/2,near:-3.6f);await Seconds(2);
            await WalkTo(new Vector2(hallStair.Bottom.X,132.3f),"hall supported walk reaches stair");
            await WalkTo(new Vector2(hallStair.Bottom.X,137.65f),"hall bluestone stair ascends");
            Check("hall stair reaches top tread",j.Grounded && j.Y>-.5f,$"feet {j.Y}");
            await Shot("hall-stair-top");
            await WalkTo(new Vector2(hallStair.Top.X,139.2f),"hall stair exits onto open street");
            Check("hall street exit clear",j.BodyFree(hallStair.Top.X,.05f,139.2f));
            }
            // Optional review cameras after physics assertions, without restarting the whole native town.
            string views=Main.I.Arg("ruien-proof-views");
            if(views.Length>0)
            {
                RuienWorkmen.ProofActive=Main.I.Flag("ruien-proof-crew");
                if(!j.Fly)j.ToggleFly();j.Frozen=true;j.ClearKeys();
                DisplayServer.WindowSetVsyncMode(DisplayServer.VSyncMode.Disabled);Engine.MaxFps=0;
                var performance=new List<object>();
                var authoredFill=Ruien.I!.Data.Fill;
                foreach(var v in JsonDocument.Parse(File.ReadAllText(views)).RootElement.EnumerateArray())
                {
                    await Dev.Kit.I.Light(v.GetProperty("hour").GetDouble(),v.GetProperty("weather").GetString()!);
                    await SetTide(v.GetProperty("tide").GetSingle());
                    var p=v.GetProperty("at");var cam=Main.I.Cam;
                    cam.GlobalPosition=new Vector3(p[0].GetSingle(),p[1].GetSingle(),p[2].GetSingle());
                    cam.Basis=Basis.FromEuler(new Vector3(Mathf.DegToRad(v.GetProperty("pitch").GetSingle()),Mathf.DegToRad(v.GetProperty("yaw").GetSingle()),0),EulerOrder.Yxz);
                    // Optional geometry-inspection exposure: reuse the existing fill, never add a light.
                    // Production mood cameras omit this and restore the area's authored value.
                    var fill=authoredFill;
                    if(v.TryGetProperty("inspectionFill",out var inspect))fill=new Color(.55f,.50f,.42f)*inspect.GetSingle();
                    Ruien.I!.Data.Fill=fill;
                    string name=v.GetProperty("name").GetString()!;
                    if(v.TryGetProperty("wait",out var wait))await Seconds(wait.GetSingle());
                    await Seconds(1);
                    var times=new List<double>();ulong last=Time.GetTicksUsec();
                    for(int frame=0;frame<140;frame++)
                    {
                        await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);
                        ulong now=Time.GetTicksUsec();if(frame>50)times.Add((now-last)/1000.0);last=now;
                    }
                    times.Sort();double mean=times.Average(),p95=times[(int)(times.Count*.95)];
                    performance.Add(new{name,meanMs=mean,p95Ms=p95,shaders=Render.Psx.ShaderCount});
                    GD.Print($"RUIEN_FRAME {name}: {mean:0.00} ms, p95 {p95:0.00}");
                    await Shot(name);
                }
                Ruien.I!.Data.Fill=authoredFill;
                File.WriteAllText(Path.Combine(output,"frames.json"),JsonSerializer.Serialize(performance,new JsonSerializerOptions{WriteIndented=true}));
            }
        }
        catch (Exception e) { Check("exception",false,e.ToString()); }
        File.WriteAllText(Path.Combine(output,"routes.json"),JsonSerializer.Serialize(checks,new JsonSerializerOptions{WriteIndented=true}));
        GetTree().Quit(failures == 0 ? 0 : 1);
    }
}
