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
    private async Task Until(Func<bool> condition,float timeout=12)
    {
        ulong end=Time.GetTicksMsec()+(ulong)(timeout*1000);
        while(!condition()&&Time.GetTicksMsec()<end)await ToSignal(GetTree(),SceneTree.SignalName.PhysicsFrame);
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
    /// <summary>
    /// Camera paths for a review film (run with Godot's --write-movie and --fixed-fps): each segment sets the hour,
    /// weather, tide and optional inspection fill, then flies the eye through its keys (t s, at, look) with eased
    /// motion. The log marks each segment's first and last drawn frame (RUIEN_MOVIE), so the film can be cut.
    /// With "probe" the Ruien water sounds' gains at the ear are logged every half second (RUIEN_SOUND).
    /// </summary>
    private async Task Paths(string file)
    {
        var j=Jef.I!;if(!j.Fly)j.ToggleFly();j.Frozen=true;j.ClearKeys();
        var authoredFill=Ruien.I!.Data.Fill;
        foreach(var seg in JsonDocument.Parse(File.ReadAllText(file)).RootElement.EnumerateArray())
        {
            string name=seg.GetProperty("name").GetString()!;
            await Dev.Kit.I.Light(seg.GetProperty("hour").GetDouble(),seg.GetProperty("weather").GetString()!);
            await SetTide(seg.GetProperty("tide").GetSingle());
            Ruien.I!.Data.Fill=seg.TryGetProperty("inspectionFill",out var inspect)?new Color(.55f,.50f,.42f)*inspect.GetSingle():authoredFill;
            var keys=seg.GetProperty("keys").EnumerateArray().Select(k=>(t:k.GetProperty("t").GetSingle(),
                at:new Vector3(k.GetProperty("at")[0].GetSingle(),k.GetProperty("at")[1].GetSingle(),k.GetProperty("at")[2].GetSingle()),
                look:new Vector3(k.GetProperty("look")[0].GetSingle(),k.GetProperty("look")[1].GetSingle(),k.GetProperty("look")[2].GetSingle()))).ToArray();
            bool probe=seg.TryGetProperty("probe",out var pr)&&pr.GetBoolean();
            Audio.Soundscape.RuienSolo=seg.TryGetProperty("solo",out var so)?so.GetInt32():-1;
            var cam=Main.I.Cam;
            // Jef's place goes with the eye: the sound takes its room (the Ruien's echo, the street's rumble) from him.
            void Put(Vector3 at,Vector3 look){cam.GlobalPosition=at;cam.Basis=Basis.LookingAt(look-at,Vector3.Up);j.X=at.X;j.Y=at.Y-1.55f;j.Z=at.Z;}
            Put(keys[0].at,keys[0].look);
            await Seconds(2.5f);
            GD.Print($"RUIEN_MOVIE start {name} frame {Engine.GetFramesDrawn()}");
            using var profile = new RuienFrameProfile(GetTree());
            float t=0,total=keys[^1].t,nextProbe=0;
            while(t<=total)
            {
                int i=0;while(i<keys.Length-2&&t>keys[i+1].t)i++;
                var a=keys[i];var b=keys[Math.Min(i+1,keys.Length-1)];
                float k=b.t>a.t?Mathf.SmoothStep(0,1,Math.Clamp((t-a.t)/(b.t-a.t),0,1)):1;
                Put(a.at.Lerp(b.at,k),a.look.Lerp(b.look,k));
                if(probe&&t>=nextProbe&&Audio.Soundscape.I is {} sound)
                {
                    nextProbe+=.5f;
                    foreach(var (kind,at,d,gain) in sound.RuienProbe().Where(p=>p.d<12))
                        GD.Print($"RUIEN_SOUND {name} t {t:0.00} frame {Engine.GetFramesDrawn()} {kind} ({at.X:0.00},{at.Y:0.00},{at.Z:0.00}) d {d:0.00} gain {gain:0.0000} echo-open {sound.RuienEchoOpen:0.00} room {sound.Interior}");
                }
                await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);
                t+=(float)GetProcessDeltaTime();
            }
            await ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
            File.WriteAllText(Path.Combine(output,name+"-parts.json"),JsonSerializer.Serialize(profile.Finish(name),new JsonSerializerOptions{WriteIndented=true}));
            GD.Print($"RUIEN_MOVIE end {name} frame {Engine.GetFramesDrawn()}");
            if(Main.I.Arg("ruien-proof-audit-parts").Length>0)
                File.WriteAllText(Path.Combine(output,name+"-draw-audit.json"),JsonSerializer.Serialize(await RuienFrameProfile.Audit(this,output,name),new JsonSerializerOptions{WriteIndented=true}));
        }
        Audio.Soundscape.RuienSolo=-1;
        Ruien.I!.Data.Fill=authoredFill;
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
        var j=Jef.I!;ulong until=Time.GetTicksMsec()+30000;
        while(new Vector2(j.X,j.Z).DistanceTo(target)>.12f && Time.GetTicksMsec()<until)
        {
            var d=target-new Vector2(j.X,j.Z);j.Yaw=MathF.Atan2(-d.X,-d.Y);
            j.SetKey(Key.W,true);await ToSignal(GetTree(),SceneTree.SignalName.PhysicsFrame);
        }
        j.ClearKeys();await Seconds(.3f);
        Check(name,new Vector2(j.X,j.Z).DistanceTo(target)<.22f && (afloat?j.Swimming:j.Grounded && !j.Swimming),$"{j.X},{j.Y},{j.Z}: {j.LastShove}");
    }
    /// <summary>
    /// Walk tests from a JSON list. "walk": from a point on the walkway through waypoints, grounded at the walk
    /// level (y, tolerance tol) at each, never swimming. "push": hold W along dir for some seconds; with blocked
    /// true Jef must stay on the walkway (the rail holds him), with blocked false he must leave it (a ladder gap).
    /// </summary>
    private async Task Walks(string file)
    {
        var j=Jef.I!;if(j.Fly)j.ToggleFly();j.Frozen=false;j.ClearKeys();
        await SetTide(-4.95f);
        foreach(var w in JsonDocument.Parse(File.ReadAllText(file)).RootElement.EnumerateArray())
        {
            string name=w.GetProperty("name").GetString()!;string kind=w.GetProperty("kind").GetString()!;
            var from=new Vector2(w.GetProperty("from")[0].GetSingle(),w.GetProperty("from")[1].GetSingle());
            float y=w.GetProperty("y").GetSingle(),tol=w.TryGetProperty("tol",out var t)?t.GetSingle():.08f;
            if(kind=="walk")
            {
                var pts=w.GetProperty("path").EnumerateArray().Select(p=>new Vector2(p[0].GetSingle(),p[1].GetSingle())).ToArray();
                var d0=pts[0]-from;j.Place(from.X,from.Y,MathF.Atan2(-d0.X,-d0.Y),near:y+.05f);await Seconds(1);
                Check(name+" starts on the walkway",j.Grounded&&!j.Swimming&&MathF.Abs(j.Y-y)<tol,$"{j.X},{j.Y},{j.Z}");
                float low=j.Y,high=j.Y;int i=0;
                foreach(var p in pts)
                {
                    ulong until=Time.GetTicksMsec()+20000;
                    while(new Vector2(j.X,j.Z).DistanceTo(p)>.12f&&Time.GetTicksMsec()<until&&!j.Swimming)
                    {
                        var d=p-new Vector2(j.X,j.Z);j.Yaw=MathF.Atan2(-d.X,-d.Y);j.SetKey(Key.W,true);
                        await ToSignal(GetTree(),SceneTree.SignalName.PhysicsFrame);
                        if(j.Grounded){low=MathF.Min(low,j.Y);high=MathF.Max(high,j.Y);}
                    }
                    j.ClearKeys();await Seconds(.2f);
                    Check($"{name} waypoint {i++}",new Vector2(j.X,j.Z).DistanceTo(p)<.22f&&j.Grounded&&!j.Swimming&&MathF.Abs(j.Y-y)<tol,$"{j.X},{j.Y},{j.Z}: {j.LastShove}");
                }
                Check(name+" stays level",high-low<tol*2,$"feet {low:0.000} to {high:0.000}");
                await Shot("walk-"+name);
            }
            else
            {
                var dir=new Vector2(w.GetProperty("dir")[0].GetSingle(),w.GetProperty("dir")[1].GetSingle()).Normalized();
                bool blocked=w.GetProperty("blocked").GetBoolean();float secs=w.TryGetProperty("seconds",out var sv)?sv.GetSingle():2.5f;
                j.Place(from.X,from.Y,MathF.Atan2(-dir.X,-dir.Y),near:y+.05f);await Seconds(1);
                var start=new Vector2(j.X,j.Z);j.SetKey(Key.W,true);await Seconds(secs);j.ClearKeys();await Seconds(1);
                float moved=(new Vector2(j.X,j.Z)-start).Dot(dir);
                bool onWalk=j.Grounded&&!j.Swimming&&MathF.Abs(j.Y-y)<tol;
                Check(name,blocked?onWalk&&moved<.45f:(j.Swimming||j.Y<y-.3f),$"moved {moved:0.00} m, feet {j.Y:0.00}, swimming {j.Swimming}");
            }
        }
    }
    /// <summary>
    /// Generic route proof for any area (#272 stage 1d): Jef walks each route's points from its start (the walk
    /// must stay grounded and dry), and an upright 3.85 m giant capsule is tested on the bed at each "giant" point.
    /// {"routes":[{"name","start":[x,y,z,yawDeg],"points":[[x,z],..],"topAbove":y?}],"giant":[{"name","at":[x,z]}]}
    /// </summary>
    private async Task RouteWalks(string file)
    {
        var j=Jef.I!;if(j.Fly)j.ToggleFly();j.Frozen=false;
        var root=JsonDocument.Parse(File.ReadAllText(file)).RootElement;
        var space=GetViewport().World3D.DirectSpaceState;
        if(root.TryGetProperty("giant",out var giants))
            foreach(var g in giants.EnumerateArray())
            {
                var at=g.GetProperty("at");float x=at[0].GetSingle(),z=at[1].GetSingle();
                var hit=space.IntersectRay(PhysicsRayQueryParameters3D.Create(new Vector3(x,-4.2f,z),new Vector3(x,-6f,z),Solid.Layer));
                float bed=hit.Count>0?hit["position"].AsVector3().Y:-9;
                var query=new PhysicsShapeQueryParameters3D{Shape=new CapsuleShape3D{Height=3.86f,Radius=.464f},
                    Transform=new Transform3D(Basis.Identity,new Vector3(x,bed+1.94f,z)),CollisionMask=Solid.Layer,Margin=0};
                var hits=space.IntersectShape(query);
                var up=space.IntersectRay(PhysicsRayQueryParameters3D.Create(new Vector3(x,bed+.2f,z),new Vector3(x,0,z),Solid.Layer));
                float head=up.Count>0?up["position"].AsVector3().Y-(bed+3.86f):99;
                Check("giant upright at "+g.GetProperty("name").GetString(),bed>-5.2f&&hits.Count==0,$"bed {bed:0.000}, clearance over the head {head:0.000} m, {string.Join(",",hits.Select(h=>(h["collider"].AsGodotObject() as Node)?.Name.ToString()))}");
            }
        foreach(var r in root.GetProperty("routes").EnumerateArray())
        {
            string name=r.GetProperty("name").GetString()!;var s=r.GetProperty("start");
            j.Place(s[0].GetSingle(),s[2].GetSingle(),Mathf.DegToRad(s[3].GetSingle()),0,s[1].GetSingle());await Seconds(1.5f);
            Check(name+" starts on its feet",j.Grounded&&!j.Swimming,$"{j.X},{j.Y},{j.Z}");
            int k=0;
            foreach(var p in r.GetProperty("points").EnumerateArray())
                await WalkTo(new Vector2(p[0].GetSingle(),p[1].GetSingle()),$"{name} point {k++}");
            if(r.TryGetProperty("topAbove",out var top))Check(name+" ends at the top",j.Y>top.GetSingle(),$"feet {j.Y}");
            if(r.TryGetProperty("shot",out var shot))await Shot(shot.GetString()!);
        }
        if(!j.Fly)j.ToggleFly();
    }
    private void Surrounds()
    {
        var space=Main.I.View.FindWorld3D().DirectSpaceState;
        string meshes=Path.Combine(output,"kit-meshes");Directory.CreateDirectory(meshes);int meshIndex=0;
        foreach(var root in Main.I.View.GetChildren().OfType<Node3D>().Where(n=>new[]{"keeper_stair_","surround_","grate_","round_grate_","entrance_"}.Any(prefix=>n.Name.ToString().StartsWith(prefix))))
        foreach(var mi in BakedWorld.All(root).OfType<MeshInstance3D>())
            ResourceSaver.Save(mi.Mesh,Path.Combine(meshes,$"mesh_{meshIndex++}.res"));
        RuienUv.Audit(meshes,Path.Combine(output,"kit-uv.json"));
        var audit=JsonDocument.Parse(File.ReadAllText(Path.Combine(output,"kit-uv.json"))).RootElement;
        double bad=audit.EnumerateArray().Sum(a=>a.GetProperty("badArea").GetDouble());
        Check("kit metric UVs on broad and narrow faces",bad<.0001,$"stretched area {bad} m2 across {meshIndex} meshes");
        foreach(var w in Ruien.I!.Data.Areas.SelectMany(a=>a.Ways).Where(RuienSurround.Applies))
        {
            var h=RuienSurround.Opening(w);var centre=h.GetCenter();var points=new List<Vector2>();
            if(w.Round)
                for(int i=0;i<16;i++){float angle=i*Mathf.Tau/16;points.Add(centre+new Vector2(MathF.Cos(angle),MathF.Sin(angle))*(h.Size.X/2+.16f));}
            else foreach(float s in new[]{-1f,1f})
            {
                for(int i=0;i<7;i++)points.Add(new Vector2(centre.X+s*(h.Size.X/2+.19f),h.Position.Y+.06f+(h.Size.Y-.12f)*i/6));
                for(int i=0;i<3;i++)points.Add(new Vector2(h.Position.X+h.Size.X*i/2,centre.Y+s*(h.Size.Y/2+.19f)));
            }
            var gaps=new List<string>();
            foreach(var p in points)
            {
                var hit=space.IntersectRay(PhysicsRayQueryParameters3D.Create(new Vector3(p.X,.14f,p.Y),new Vector3(p.X,-.5f,p.Y),Solid.Layer));
                float y=hit.Count>0?hit["position"].AsVector3().Y:float.NegativeInfinity;
                if(y<RuienSurround.Top(w)-.018f||y>RuienSurround.Top(w)+.05f)gaps.Add(p.ToString());
            }
            Check(w.Id+" complete raised surround collision",gaps.Count==0,string.Join(";",gaps));
            if(!w.Round)
            {
                gaps.Clear();
                foreach(float sx in new[]{-1f,1f})foreach(float sz in new[]{-1f,1f})
                foreach(float offset in new[]{.003f,RuienSurround.Width(w)+.002f})
                foreach(float end in new[]{0f,RuienSurround.Width(w)*.25f,RuienSurround.Width(w)*.75f})
                {
                    var p=centre+new Vector2(sx*(h.Size.X/2+offset),sz*(h.Size.Y/2+end));
                    var hit=space.IntersectRay(PhysicsRayQueryParameters3D.Create(new Vector3(p.X,.14f,p.Y),new Vector3(p.X,-.34f,p.Y),Solid.Layer));
                    if(hit.Count==0||hit["position"].AsVector3().Y<RuienSurround.Seat-.006f)gaps.Add(p.ToString());
                }
                Check(w.Id+" bonded corner joints sealed",gaps.Count==0,string.Join(";",gaps));
            }
        }
        foreach(var root in Main.I.View.GetChildren().OfType<Node3D>().Where(n=>n.Name.ToString().StartsWith("keeper_stair_")))
        foreach(var mi in BakedWorld.All(root).OfType<MeshInstance3D>())
        {
            var m=mi.Mesh!;
            if(!m.SurfaceGetMaterial(0).ResourceName.Contains("brick"))continue;
            float top=m.GetFaces().Max(p=>(mi.GlobalTransform*p).Y);
            Check("keeper brick crown and walls below street",top<-.14f,$"highest brick {top}");
        }
    }
    private static float YawTo(Vector3 d)=>MathF.Atan2(-d.X,-d.Z);
    private async Task WalkFor(Vector3 target,float seconds)
    {
        var j=Jef.I!;ulong until=Time.GetTicksMsec()+(ulong)(seconds*1000);
        while(Time.GetTicksMsec()<until)
        {
            var d=new Vector2(target.X-j.X,target.Z-j.Z);if(d.Length()<.05f)break;
            j.Yaw=MathF.Atan2(-d.X,-d.Y);j.SetKey(Key.W,true);await ToSignal(GetTree(),SceneTree.SignalName.PhysicsFrame);
        }
        j.ClearKeys();await Seconds(.3f);
    }
    /// <summary>
    /// Each street entrance (RuienEntrance): from the street E opens the door, Jef walks in, down the whole flight to the
    /// landing, the closure answers E and holds him, and he walks back up and out and shuts the door. The way is checked
    /// for room for his body every 20 cm. `--ruien-proof-entrance-ids a,b` takes some of them.
    /// </summary>
    private async Task Entrances()
    {
        var j=Jef.I!;var space=GetViewport().World3D.DirectSpaceState;
        string only=Main.I.Arg("ruien-proof-entrance-ids");
        bool saved=false;
        foreach(var e in RuienEntrance.All.Where(e=>only.Length==0||only.Split(',').Contains(e.Id)))
        {
            if(!RuienEntranceDoor.All.TryGetValue(e.Id,out var door)){Check(e.Id+" door built",false);continue;}
            var r=e.Route.Select(p=>e.World(p)).ToArray();
            float yawIn=YawTo(e.World(Vector3.Zero)-r[0]);
            Player.Arms.I!.ProofLantern=false;
            if(e.From.Length>0)
            {
                // the way to the door from the street (a gateway's passage, an alley): walked, not placed
                j.Place(e.From[0].X,e.From[0].Y,YawTo(new Vector3(r[0].X-e.From[0].X,0,r[0].Z-e.From[0].Y)),0,e.Street);await Seconds(1.5f);
                j.Place(e.From[0].X,e.From[0].Y,YawTo(new Vector3(r[0].X-e.From[0].X,0,r[0].Z-e.From[0].Y)),0,e.Street);await Seconds(1.5f);
                for(int k=1;k<e.From.Length;k++)await WalkTo(e.From[k],e.Id+$" from the street {k}");
                await WalkTo(new Vector2(r[0].X,r[0].Z),e.Id+" from the street to the door");
                j.Yaw=yawIn;await Seconds(.3f);
            }
            else
            {
                j.Place(r[0].X,r[0].Z,yawIn,0,e.Street);await Seconds(1.5f);
                j.Place(r[0].X,r[0].Z,yawIn,0,e.Street);await Seconds(1.5f);
            }
            await Until(()=>door.Known,10);
            Check(e.Id+" door state known",door.Known);
            if(door.Target){door.Set(false);await Until(()=>!door.Target&&door.Open<.001f);}
            Check(e.Id+" street before the door",j.Grounded&&MathF.Abs(j.Y-e.Street)<.1f,$"{j.X},{j.Y},{j.Z}");
            bool Blocked(Vector3 a,Vector3 b)=>space.IntersectRay(PhysicsRayQueryParameters3D.Create(a,b,Solid.Layer)).Count>0;
            Check(e.Id+" shut door is solid",Blocked(e.World(new Vector3(0,1,.4f)),e.World(new Vector3(0,1,e.LeafFace-.25f))));
            j.Pitch=0;await Seconds(.4f);
            await Shot(e.Id+"-1-street-shut");
            var open=Interact.I.Acts.FirstOrDefault(a=>a.Key==Key.E&&a.Text=="open the door");
            Check(e.Id+" E open offered",open!=null,Interact.I.Text);
            if(open!=null)Check(e.Id+" E open accepted",Interact.I.Press(Key.E));
            await Until(()=>door.Open>.999f,10);
            Check(e.Id+" door swung open inward",door.Open>.99f&&door.Target,$"open={door.Open}");
            Check(e.Id+" open doorway clear",!Blocked(e.World(new Vector3(0,1,.4f)),e.World(new Vector3(0,1,-e.Wall+.05f))));
            await Seconds(.5f);
            await Shot(e.Id+"-2-door-open");
            // room for his body all the way (floor found under each point, then the body there)
            var gaps=new List<string>();
            for(int k=1;k+1<r.Length;k++)
            {
                int n=Math.Max(1,(int)(r[k].DistanceTo(r[k+1])/.2f));
                for(int i=0;i<=n;i++)
                {
                    var p=r[k].Lerp(r[k+1],(float)i/n);
                    var hit=space.IntersectRay(PhysicsRayQueryParameters3D.Create(p+Vector3.Up*1.0f,p+Vector3.Down*1.2f,Solid.Layer));
                    if(hit.Count==0){gaps.Add($"no floor {p}");continue;}
                    var f=hit["position"].AsVector3();
                    if(!j.BodyFree(f.X,f.Y+.05f,f.Z))gaps.Add($"no room {f}");
                }
            }
            Check(e.Id+" room for a body on the whole way",gaps.Count==0,string.Join(";",gaps.Take(6)));
            Player.Arms.I!.ProofLantern=true;
            await WalkTo(new Vector2(r[1].X,r[1].Z),e.Id+" through the doorway");
            await WalkTo(new Vector2(r[2].X,r[2].Z),e.Id+" top landing");
            await WalkTo(new Vector2(r[3].X,r[3].Z),e.Id+" head of the flight");
            var half=(r[3]+r[4])/2;
            await WalkTo(new Vector2(half.X,half.Z),e.Id+" halfway down");
            j.Pitch=-.3f;await Seconds(.4f);await Shot(e.Id+"-3-halfway");j.Pitch=0;
            await WalkTo(new Vector2(r[4].X,r[4].Z),e.Id+" foot of the flight");
            await WalkTo(new Vector2(r[5].X,r[5].Z),e.Id+" bottom landing");
            Check(e.Id+" landing at its depth",j.Grounded&&MathF.Abs(j.Y-e.Depth)<.12f,$"feet {j.Y}, depth {e.Depth}");
            var front=RuienEntrance.ClosureFront(e,.75f);var c0=RuienEntrance.ClosureFront(e,0);
            await WalkTo(new Vector2(front.X,front.Z),e.Id+" before the closure");
            j.Yaw=YawTo(c0-front);j.Pitch=-.05f;await Seconds(.6f);
            var cl=Interact.I.Acts.FirstOrDefault(a=>a.Key==Key.E&&(a.Text=="try the iron gate"||a.Text=="look at the new brickwork"));
            Check(e.Id+" closure answers E",cl!=null,Interact.I.Text);
            if(cl!=null)Check(e.Id+" closure E accepted",Interact.I.Press(Key.E));
            await Shot(e.Id+"-4-landing-closure");
            // the closure holds: walk at it for two seconds
            var beyond=RuienEntrance.ClosureFront(e,-.9f);
            await WalkFor(beyond,2);
            var wallIn=e.Local.Basis*(e.ClosureWall.Basis.Z);
            float past=(new Vector3(j.X,0,j.Z)-new Vector3(c0.X,0,c0.Z)).Dot(new Vector3(wallIn.X,0,wallIn.Z).Normalized());
            Check(e.Id+" closure holds",past< -Jef.Radius+.12f,$"{past:0.00} m past the wall's face");
            j.ClearKeys();
            await WalkTo(new Vector2(r[5].X,r[5].Z),e.Id+" back on the landing");
            await WalkTo(new Vector2(r[4].X,r[4].Z),e.Id+" back at the foot");
            await WalkTo(new Vector2(r[3].X,r[3].Z),e.Id+" up the whole flight");
            Check(e.Id+" climbed back to the street's level",j.Grounded&&MathF.Abs(j.Y-e.Street)<.12f,$"feet {j.Y}");
            await WalkTo(new Vector2(r[2].X,r[2].Z),e.Id+" back on the top landing");
            await WalkTo(new Vector2(r[1].X,r[1].Z),e.Id+" back in the doorway");
            await WalkTo(new Vector2(r[0].X,r[0].Z),e.Id+" back on the street");
            Player.Arms.I!.ProofLantern=false;
            j.Yaw=yawIn;j.Pitch=0;await Seconds(.5f);
            var shut=Interact.I.Acts.FirstOrDefault(a=>a.Key==Key.E&&a.Text=="close the door");
            Check(e.Id+" E close offered",shut!=null,Interact.I.Text);
            if(shut!=null)Check(e.Id+" E close accepted",Interact.I.Press(Key.E));
            await Until(()=>door.Open<.001f,10);
            Check(e.Id+" door shut again",door.Open<.01f&&!door.Target,$"open={door.Open}");
            Check(e.Id+" shut again and solid",Blocked(e.World(new Vector3(0,1,.4f)),e.World(new Vector3(0,1,e.LeafFace-.25f))));
            for(int k=e.From.Length-1;k>=0;k--)await WalkTo(e.From[k],e.Id+$" back to the street {k}");
            if(!saved&&Scheldemist.Net.ServerLink.I?.Api is {} api)
            {
                // the door's state is the world's: saved and loaded with the game
                saved=true;
                door.Set(true);await Until(()=>door.Target&&door.Open>.999f);
                await api.Post<JsonElement>("api/save",new{slot="slot1",label="Ruien entrance door"});
                door.Set(false);await Until(()=>!door.Target&&door.Open<.001f);
                await api.Post<JsonElement>("api/load",new{slot="slot1"});
                await Until(()=>door.Target&&door.Open>.999f);
                Check(e.Id+" saved open door comes back open",door.Target&&door.Open>.999f);
                door.Set(false);await Until(()=>!door.Target&&door.Open<.001f);
                Check(e.Id+" and shuts again",!door.Target&&door.Open<.001f);
            }
        }
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
            DisplayServer.WindowSetVsyncMode(DisplayServer.VSyncMode.Disabled);Engine.MaxFps=0;
            await Dev.Kit.I.Light(13,"clear");
            await Seconds(3); // The initial saved spawn is applied after the kit becomes ready.
            // A fresh isolated save may still carry Jef on the arrival ferry. The Ruien fixture starts on foot.
            j.Drive=null;
            if(Main.I.Flag("ruien-proof-surrounds"))Surrounds();
            bool access=Main.I.Flag("ruien-proof-access");
            bool entrances=Main.I.Flag("ruien-proof-entrances");
            if(entrances)await Entrances();
            if(!Main.I.Flag("ruien-proof-views-only")&&!entrances)
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
                var start = new Vector2(j.X,j.Z); j.SetKey(Key.W,true);
                await Until(()=>start.DistanceTo(new Vector2(j.X,j.Z))>1.2f,30); j.ClearKeys();
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
                await Until(()=>!j.Climbing,60);await Seconds(.5f);
                Check(w.Id+" up",!j.Climbing && j.Grounded && !j.Swimming && MathF.Abs(j.Y-w.Top.Y)<.18f,$"feet {j.Y}, target {w.Top.Y}");
                var q=new PhysicsShapeQueryParameters3D { CollisionMask=Solid.Layer, Shape=new CylinderShape3D{Radius=Jef.Radius,Height=1.4f}, Transform=new Transform3D(Basis.Identity,w.Top+Vector3.Up*1.05f) };
                var hits=GetViewport().World3D.DirectSpaceState.IntersectShape(q,8);
                Check(w.Id+" landing clearance",j.BodyFree(w.Top.X,w.Top.Y+.03f,w.Top.Z),string.Join(",",hits.Select(h=>h["collider"].AsGodotObject() is Node n?n.GetPath().ToString():"?")));
                await Shot(w.Id+"-top");
                RuienWays.RungsDown(w); await Until(()=>!j.Climbing,60);await Seconds(.5f);
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
                await Until(()=>hatch.Known);
                hatch.Set(false);await Until(()=>!hatch.Target&&hatch.Open<.001f);
                await Seconds(.3f);
                j.Pitch=-.8f;await Seconds(.3f);
                await Shot(stair.Id+"-initial-closed");
                Check(stair.Id+" E open offered",Interact.I.Acts.Any(a=>a.Key==Key.E&&a.Text=="open the iron lids"));
                Check(stair.Id+" E open accepted",Interact.I.Press(Key.E));await Until(()=>hatch.Open>.999f);
                Check(stair.Id+" lids swung open",hatch.Open>.99f,$"open={hatch.Open}, target={hatch.Target}, known={hatch.Known}");j.Pitch=0;
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
                Check(stair.Id+" E close accepted",Interact.I.Press(Key.E));await Until(()=>hatch.Open<.001f);
                Check(stair.Id+" lids shut",hatch.Open<.01f,$"open={hatch.Open}, target={hatch.Target}, known={hatch.Known}");
                foreach(float dx in new[]{-.55f,-.3f,0,.3f,.55f})
                foreach(float dz in new[]{.1f,1f,stair.Hole.Size.Y-.1f})
                {
                    var p=stair.Top+new Vector3(dx,1,dz);
                    var hit=Main.I.View.FindWorld3D().DirectSpaceState.IntersectRay(PhysicsRayQueryParameters3D.Create(p,p-Vector3.Up*2,Solid.Layer));
                    Check($"closed lid physical surface {dx}/{dz}",hit.Count>0&&MathF.Abs(hit["position"].AsVector3().Y-stair.Top.Y)<.08f);
                }
                j.Yaw=MathF.PI;await Seconds(.2f);await Shot(stair.Id+"-closed-before-crossing");
                await WalkTo(new Vector2(stair.Top.X,stair.Top.Z+1),"closed keeper lids support feet");
                Check("closed lid collision at street",j.Grounded&&MathF.Abs(j.Y)<.12f);
                await Shot(stair.Id+"-closed");j.Pitch=0;
                if(Main.I.Flag("ruien-proof-surrounds"))
                {
                    var api=Scheldemist.Net.ServerLink.I!.Api!;
                    hatch.Set(true);await Until(()=>hatch.Open>.999f);
                    await api.Post<JsonElement>("api/save",new{slot="slot1",label="Ruien frame state"});
                    hatch.Set(false);await Until(()=>hatch.Open<.001f);
                    await api.Post<JsonElement>("api/load",new{slot="slot1"});
                    await Until(()=>hatch.Open>.999f);
                    Check("saved hatch restores open visual",hatch.Target&&hatch.Open>.999f);
                    hatch.Set(false);await Until(()=>hatch.Open<.001f);
                    Check("restored hatch closes again",!hatch.Target&&hatch.Open<.001f);
                }
            }
            if(Main.I.Flag("ruien-proof-surrounds"))
            foreach(var w in Ruien.I!.Data.Areas.SelectMany(a=>a.Ways).Where(w=>w.Kind=="ladder"))
            {
                j.Place(w.Top.X+.15f,w.Top.Z,MathF.PI/2,-.5f,w.Top.Y+.04f);await Seconds(1);
                Check(w.Id+" street grate supports player",j.Grounded&&j.Y>-.02f);
                await Until(()=>Interact.I.Acts.Any(a=>a.Key==Key.E&&a.Text=="lift the grate and climb down"));
                Check(w.Id+" descend action",Interact.I.Press(Key.E));await Until(()=>!j.Climbing,60);
                await Seconds(1);
                Check(w.Id+" ladder reaches ledge",j.Grounded&&MathF.Abs(j.Y-w.Bottom.Y)<.2f);
                // He comes down facing the rungs: the climb-up prompt shows without turning round (#202).
                var aim=w.Bottom+Vector3.Up*1.4f-j.Cam.GlobalPosition;
                float facing=MathF.Abs(Mathf.AngleDifference(j.Yaw,MathF.Atan2(-aim.X,-aim.Z)));
                Check(w.Id+" faces the ladder at its foot",facing<.35f,$"yaw off by {Mathf.RadToDeg(facing):0} degrees");
                await Until(()=>Interact.I.Acts.Any(a=>a.Key==Key.E&&a.Text=="climb up to the street"),3);
                Check(w.Id+" climb-up prompt without turning",Interact.I.Acts.Any(a=>a.Key==Key.E&&a.Text=="climb up to the street"),Interact.I.Text);
                await Shot(w.Id+"-return-prompt");
                Check(w.Id+" ascend action",Interact.I.Press(Key.E));await Until(()=>!j.Climbing,60);
                await Seconds(1);
                Check(w.Id+" ladder returns to street",j.Grounded&&MathF.Abs(j.Y-w.Top.Y)<.15f);
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
            // Optional walk tests on a stretch (`--ruien-proof-walks <json>`): rail, bends, grates and ladder gaps.
            string walks=Main.I.Arg("ruien-proof-walks");
            if(walks.Length>0)await Walks(walks);
            // Generic routes and giant checks for any area (`--ruien-proof-walk <json>`, #272 stage 1d junction rooms).
            string routeWalks=Main.I.Arg("ruien-proof-walk");
            if(routeWalks.Length>0)await RouteWalks(routeWalks);
            // Optional review cameras after physics assertions, without restarting the whole native town.
            using var lease=await Dev.PerformanceLease.Acquire("Ruien proof");
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
                    if(v.TryGetProperty("crew",out var crewState))RuienWorkmen.ProofActive=crewState.GetBoolean();
                    await Dev.Kit.I.Light(v.GetProperty("hour").GetDouble(),v.GetProperty("weather").GetString()!);
                    await SetTide(v.GetProperty("tide").GetSingle());
                    if(v.TryGetProperty("doorsOpen",out var doorsState))
                        foreach(var door in RuienEntranceDoor.All.Values)
                        {
                            bool open=doorsState.GetBoolean();await Until(()=>door.Known);
                            door.Set(open);await Until(()=>door.Target==open&&MathF.Abs(door.Open-(open?1:0))<.001f);
                        }
                    if(v.TryGetProperty("hatchOpen",out var hatchState))
                        foreach(var hatch in RuienHatch.All.Values)
                        {
                            bool open=hatchState.GetBoolean();await Until(()=>hatch.Known);
                            hatch.Set(open);await Until(()=>hatch.Target==open&&MathF.Abs(hatch.Open-(open?1:0))<.001f);
                            Check("review hatch state "+v.GetProperty("name").GetString(),hatch.Target==open&&MathF.Abs(hatch.Open-(open?1:0))<.001f,$"{hatch.Open}/{hatch.Target}");
                        }
                    var p=v.GetProperty("at");var cam=Main.I.Cam;
                    cam.GlobalPosition=new Vector3(p[0].GetSingle(),p[1].GetSingle(),p[2].GetSingle());
                    cam.Basis=Basis.FromEuler(new Vector3(Mathf.DegToRad(v.GetProperty("pitch").GetSingle()),Mathf.DegToRad(v.GetProperty("yaw").GetSingle()),0),EulerOrder.Yxz);
                    // Optional geometry-inspection exposure: reuse the existing fill, never add a light.
                    // Production mood cameras omit this and restore the area's authored value.
                    var fill=authoredFill;
                    if(v.TryGetProperty("inspectionFill",out var inspect))fill=new Color(.55f,.50f,.42f)*inspect.GetSingle();
                    Ruien.I!.Data.Fill=fill;
                    string name=v.GetProperty("name").GetString()!;
                    // Proof fixture only: an explicit candidate for paired timing and pixel rejection.
                    using var hiddenParts=new RuienFrameProfile.HiddenParts(v.TryGetProperty("hideParts",out var hidden)
                        ?hidden.EnumerateArray().Select(p=>p.GetString()!):Array.Empty<string>());
                    if(v.TryGetProperty("wait",out var wait))await Seconds(wait.GetSingle());
                    await Seconds(1);
                    if(RuienWorkmen.ProofActive)
                    {
                        var workers=Main.I.View.GetChildren().OfType<Node3D>().Where(n=>n.Name.ToString().Contains("_workman_")).ToArray();
                        Check("two native gate workmen visible at "+name,workers.Length==2&&workers.All(n=>n.IsVisibleInTree()));
                        foreach(var worker in workers)
                        {
                            var at=worker.GlobalPosition;
                            Check(worker.Name+" clear route at "+name,j.BodyFree(at.X,at.Y+.04f,at.Z),at.ToString());
                        }
                    }
                    var crewAt=RuienWorkmen.ProofActive?Main.I.View.GetChildren().OfType<Node3D>().Where(n=>n.Name.ToString().Contains("_workman_")).ToDictionary(n=>n,n=>n.GlobalPosition):new();
                    for(int warm=0;warm<51;warm++)await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);
                    using var profile=new RuienFrameProfile(GetTree());
                    var times=new List<double>();ulong last=Time.GetTicksUsec();
                    for(int frame=51;frame<140;frame++)
                    {
                        await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);
                        ulong now=Time.GetTicksUsec();if(frame>50)times.Add((now-last)/1000.0);last=now;
                        // (the last 40 frames' steps: over the whole sample he may have turned a corner)
                        if(frame==99)foreach(var w in crewAt.Keys.ToArray())crewAt[w]=w.GlobalPosition;
                    }
                    // A walking workman faces the way he walks (a person model faces +Z; RU-ruien2: they walked backwards).
                    foreach(var (worker,from) in crewAt)
                    {
                        var moved=worker.GlobalPosition-from;moved.Y=0;
                        if(moved.Length()<.08f)continue;
                        var facing=worker.GlobalBasis.Z;facing.Y=0;
                        Check(worker.Name+" faces his walk at "+name,facing.Normalized().Dot(moved.Normalized())>.5f,$"facing {facing}, moved {moved}");
                    }
                    times.Sort();double mean=times.Average(),p95=times[(int)(times.Count*.95)];
                    await ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
                    var parts=profile.Finish(name);
                    performance.Add(new{name,meanMs=mean,p95Ms=p95,shaders=Render.Psx.ShaderCount,parts});
                    GD.Print($"RUIEN_FRAME {name}: {mean:0.00} ms, p95 {p95:0.00}");
                    await Shot(name);
                    if(Main.I.Arg("ruien-proof-audit-parts").Length>0 && (!v.TryGetProperty("audit",out var audit)||audit.GetBoolean()))
                        File.WriteAllText(Path.Combine(output,name+"-draw-audit.json"),JsonSerializer.Serialize(await RuienFrameProfile.Audit(this,output,name),new JsonSerializerOptions{WriteIndented=true}));
                }
                Ruien.I!.Data.Fill=authoredFill;
                File.WriteAllText(Path.Combine(output,"frames.json"),JsonSerializer.Serialize(performance,new JsonSerializerOptions{WriteIndented=true}));
            }
            string paths=Main.I.Arg("ruien-proof-path");
            if(paths.Length>0)await Paths(paths);
            File.WriteAllText(Path.Combine(output,"isolation.json"),JsonSerializer.Serialize(lease.Report(),new JsonSerializerOptions{WriteIndented=true}));
        }
        catch (Exception e) { Check("exception",false,e.ToString()); }
        File.WriteAllText(Path.Combine(output,"routes.json"),JsonSerializer.Serialize(checks,new JsonSerializerOptions{WriteIndented=true}));
        GetTree().Quit(failures == 0 ? 0 : 1);
    }
}
