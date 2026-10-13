using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.People;

/// <summary>Bounded native art views and an allocation/time trace over the live haunts.</summary>
[GamePart(898)]
internal partial class SmallLifeProof : Node
{
    private readonly List<object> pictures = new();
    private string dir = "";
    private async System.Threading.Tasks.Task Frame() => await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
    public override async void _Ready()
    {
        string cap=Main.I.Arg("smalllife-captures"),trace=Main.I.Arg("smalllife-trace"),integration=Main.I.Arg("smalllife-integration");
        if(cap==""&&trace==""&&integration==""){SetProcess(false);return;}
        dir=Paths.Absolute(cap!=""?cap:trace!=""?trace:integration);
        try
        {
            Directory.CreateDirectory(dir);var town=Main.I.GetNode<Townspeople>("Townspeople");
            for(int i=0;(town.Data==null||!Dev.Kit.I.IsReady)&&i<2400;i++)await Frame();
            if(town.Data==null||town.Walk==null||!Dev.Kit.I.IsReady||!SmallLifeKit.Ready)throw new InvalidOperationException("smalllife proof not ready");
            town.ClockRuns=false;Game.GameState.I.PlayingWhen=()=>false;
            if(Player.Jef.I is{Fly:false} jef)jef.ToggleFly();Player.Jef.I.TestInput=true;Main.I.Cam.SetProcess(false);Input.MouseMode=Input.MouseModeEnum.Visible;
            await Dev.Kit.I.Light(13,"clear");for(int i=0;i<120;i++)await Frame();
            if(trace!="")await Trace(town);else if(integration!="")await Integration(town);else await Captures(town);
            GetTree().Quit();
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
    private (Vector3 At,Vector3 Face) Spot(Townspeople town,bool lamp)
    {
        var sun=Daylight.I.SunDir;var lights=Lights.I.Lamps.Select(l=>l.at).ToArray();
        var centre=Main.I.World.Facts.RootElement.GetProperty("places").EnumerateArray().First(p=>p.GetProperty("place").GetString()=="vismarkt").GetProperty("pos");
        var square=new Vector2(centre[0].GetSingle(),centre[2].GetSingle());
        (Vector3,Vector3)? best=null;double score=double.PositiveInfinity;
        foreach(var r in town.Data!.Residents)
        {
            var face=new Vector3((float)(r.HomeSx-r.HomeX),0,(float)(r.HomeSz-r.HomeZ)).Normalized();
            if(face.LengthSquared()<.5)continue;var side=new Vector3(face.Z,0,-face.X);
            var p=new Vector3((float)r.HomeSx,0,(float)r.HomeSz)+face*2;
            bool open=true;
            foreach(var d in new[]{Vector3.Zero,face*4,side*4,-side*4,face*3+side*3,face*3-side*3,-face*1.5f})
                if(!town.Walk!.Free(p.X+d.X,p.Z+d.Z))open=false;
            if(!open)continue;p.Y=(float)town.Walk!.BaseAt(p.X,p.Z);
            float near=lights.Min(l=>new Vector2(l.X-p.X,l.Z-p.Z).Length());
            if(lamp && (near>7||near<2))continue;
            if(!lamp)
            {
                using var ray=PhysicsRayQueryParameters3D.Create(p+Vector3.Up*.35f,p+Vector3.Up*.35f+sun*80);
                if(Main.I.Cam.GetWorld3D().DirectSpaceState.IntersectRay(ray).Count>0)continue;
            }
            double s=new Vector2(p.X,p.Z).DistanceTo(square)*.25+(lamp?near:face.Dot(sun)*-3);
            if(s<score){score=s;best=(p,face);}
        }
        return best??throw new InvalidOperationException("No open smalllife exhibit point");
    }
    private void View(Vector3 at,Vector3 target)
    {
        Main.I.Cam.LookAtFromPosition(at,target);
        if(Main.I.Cam is Player.FlyCam fly)fly.Face(Main.I.Cam.GlobalBasis.GetRotationQuaternion());
    }
    private async System.Threading.Tasks.Task Shot(string name,Vector3 at,Vector3 target,string kind,string motion,double phase)
    {
        View(at,target);await Frame();await Frame();await ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
        using var image=Main.I.View.GetTexture().GetImage();string file=name+".png";
        if(image.SavePng(Path.Combine(dir,file))!=Error.Ok)throw new IOException(file);
        pictures.Add(new{file,kind,motion,phase,hour=Daylight.I.Hour,weather=Daylight.I.Weather,camera=new[]{at.X,at.Y,at.Z},target=new[]{target.X,target.Y,target.Z}});
    }
    private async System.Threading.Tasks.Task Captures(Townspeople town)
    {
        var day=Spot(town,false);var lamps=Spot(town,true);
        town.SetProcess(false);if(town.Crowd is{} crowd)foreach(var p in crowd.Walking)p.Group.Visible=false;
        if(Animals.I is{} animals){animals.SetProcess(false);foreach(var root in animals.Groups)root.Visible=false;}
        if(ParkWildlife.I is{} park){park.SetProcess(false);foreach(var root in park.Groups)root.Visible=false;}
        if(SmallLife.I is{} small){small.SetProcess(false);small.Batch.Root.Visible=false;}
        foreach(var court in Main.I.GetChildren().OfType<NativeCourtyards>()){court.SetProcess(false);foreach(var a in court.List)a.Body.Visible=false;}
        string[] kinds=Main.I.Flag("smalllife-preview")?new[]{"hen","goat","duck_mallard","swan","squirrel","pigeon","rat"}:SmallLifeKit.Kinds.Keys.ToArray();
        string selected=Main.I.Arg("smalllife-kinds");
        if(selected!="") {
            kinds=selected.Split(',',StringSplitOptions.RemoveEmptyEntries|StringSplitOptions.TrimEntries);
            if(kinds.Length==0||kinds.Any(k=>!SmallLifeKit.Kinds.ContainsKey(k)))throw new ArgumentException("smalllife-kinds");
        }
        bool frontOnly=Main.I.Flag("smalllife-reframe-front");
        var batch=new SmallLifeKit.Batch(Main.I.View,"smalllife_art_exhibit",1,kinds);
        foreach(var (tag,hour,weather) in Main.I.Flag("smalllife-preview")?new[]{("day",13f,"clear")}:new[]{("day",13f,"clear"),("rain",13f,"rain"),("lamps",19.5f,"clear")})
        {
            await Dev.Kit.I.Light(hour,weather);for(int i=0;i<30;i++)await Frame();
            var (at,face)=tag=="lamps"?lamps:day;var side=new Vector3(face.Z,0,-face.X);float yaw=MathF.Atan2(face.X,face.Z);
            foreach(string kind in kinds)
            {
                var k=SmallLifeKit.Kinds[kind];float h=k.Height;
                var tr=new Transform3D(Basis.FromEuler(new Vector3(0,yaw,0)),at);
                batch.Begin();batch.Put(kind,"idle",0,tr);batch.End();
                float lookHeight=Math.Max(h,k.Box.End.Y)*.50f;
                var bounds=k.Mesh.GetAabb();float frontGap=Math.Max(0,bounds.End.Z),sideGap=bounds.Size.X*.5f;
                var target=at+Vector3.Up*lookHeight;
                foreach(float metres in new[]{1f,3f,8f})
                {
                    if(frontOnly&&metres==1)continue;
                    // The straight 3/8 m approach crossed native dock litter/stock with no navigation collider.
                    // A front-quarter camera keeps the real street visible while clearing that foreground.
                    var forward=metres>1?(face+side*.45f).Normalized():face;
                    await Shot($"{tag}-{kind}-{metres}m-front",target+forward*(metres+frontGap)+Vector3.Up*h*.14f,target,kind,"idle",0);
                    if(frontOnly)continue;
                    await Shot($"{tag}-{kind}-{metres}m-side",target+side*(metres+sideGap)+Vector3.Up*h*.08f,target,kind,"idle",0);
                }
                if(frontOnly)continue;
                await Shot($"{tag}-{kind}-1m-lowback",at-face*(1+Math.Max(0,-bounds.Position.Z))+Vector3.Up*(h*.10f+.025f),target,kind,"idle",0);
                await Shot($"{tag}-{kind}-1m-top",target-face*.4f+Vector3.Up*.92f,target,kind,"idle",0);
                foreach(var motion in k.Clips.Keys.Where(n=>n!="idle"))
                {
                    double phase=motion=="fly"?.25:motion=="graze"?.25:motion=="peck"?.25:.45;
                    var placed=tr;if(motion is "fly" or "takeoff")placed.Origin+=Vector3.Up*1.4f;
                    batch.Begin();batch.Put(kind,motion,phase,placed);batch.End();
                    var look=placed.Origin+Vector3.Up*lookHeight;
                    foreach(float metres in new[]{1f,3f})await Shot($"{tag}-{kind}-{metres}m-{motion}",look+side*(metres+sideGap)+face*.20f+Vector3.Up*h*.18f,look,kind,motion,phase);
                }
            }
        }
        // Eight phases give a visible gait/flight strip in addition to the anatomical views.
        if(!frontOnly)await Dev.Kit.I.Light(13,"clear");
        foreach(var kind in kinds)
        {
            if(frontOnly)break;
            var k=SmallLifeKit.Kinds[kind];var(at,face)=day;var side=new Vector3(face.Z,0,-face.X);
            foreach(var motion in new[]{k.Clips.ContainsKey("scurry")?"scurry":"walk",k.Clips.ContainsKey("fly")?"fly":"idle"}.Distinct())
                for(int i=0;i<8;i++)
                { var tr=new Transform3D(Basis.FromEuler(new Vector3(0,MathF.Atan2(face.X,face.Z),0)),at+(motion=="fly"?Vector3.Up*1.4f:Vector3.Zero));
                  batch.Begin();batch.Put(kind,motion,i/8.0,tr);batch.End();var look=tr.Origin+Vector3.Up*k.Height*.45f;
                  await Shot($"strip-{kind}-{motion}-{i}",look+side*1.1f+Vector3.Up*k.Height*.12f,look,kind,motion,i/8.0); }
        }
        File.WriteAllText(Path.Combine(dir,"smalllife-captures.json"),JsonSerializer.Serialize(new{ok=true,kinds=kinds.Length,pictures},new JsonSerializerOptions{WriteIndented=true}));
        GD.Print($"smalllife captures: {pictures.Count}");batch.Root.QueueFree();
    }
    private async System.Threading.Tasks.Task Trace(Townspeople town)
    {
        var courts=Main.I.GetChildren().OfType<NativeCourtyards>().ToArray();
        var points=SmallLife.I!.List.Select(b=>(Kind:b.Kind,At:b.At))
            .Concat(ParkWildlife.I!.List.Select(b=>(Kind:b.Species,At:new Vector3((float)b.X,(float)b.Y,(float)b.Z))))
            .Concat(courts.SelectMany(c=>c.List.Select(b=>(Kind:b.Kind,At:b.Body.GlobalPosition)))).ToArray();
        var primary=points.GroupBy(p=>p.Kind).Select(g=>g.First().At).ToArray();
        var route=primary.Concat(points.Select(p=>p.At).OrderBy(p=>NativeCourtyardRules.Dice("smalllife-trace",p.X,p.Z))).Distinct().ToArray();
        if(route.Length<70)throw new InvalidOperationException("smalllife populations not built");
        var rows=new List<double[]>();double time=0;int stop=0;float next=0;
        // Complete the loading garbage collection before this warmed, bounded measurement. All subsequent
        // collections and raw wall times remain in the trace; none is filtered out of the 1 ms gate.
        GC.Collect(2,GCCollectionMode.Forced,true,false);
        for(int i=0;i<30;i++)await Frame();
        while(time<90)
        {
            float dt=(float)GetProcessDeltaTime();time+=dt;next-=dt;
            if(next<=0){next=2;stop=(stop+1)%route.Length;var p=route[stop];View(p+new Vector3(3,1.7f,3),p+Vector3.Up*.2f);}
            int gc=GC.CollectionCount(0);await Frame();double court=courts.Sum(c=>c.LogicMs),pigeon=Gulls.I?.SmallPigeonMs??0;
            double ms=SmallLife.I.LogicMs+ParkWildlife.I.LogicMs+court+pigeon;
            rows.Add(new[]{time,ms,SmallLife.I.LogicMs,ParkWildlife.I.LogicMs,court,pigeon,(double)(GC.CollectionCount(0)-gc),SmallLife.I.AllocatedBytes,ParkWildlife.I.AllocatedBytesLastFrame});
        }
        var sorted=rows.Skip(30).Select(r=>r[1]).OrderBy(v=>v).ToArray();int over=sorted.Count(v=>v>=1);
        var counts=SmallLife.I.List.GroupBy(b=>b.Kind).ToDictionary(g=>g.Key,g=>g.Count());
        bool populations=counts.GetValueOrDefault("rat")==8&&counts.GetValueOrDefault("sparrow")==18&&counts.GetValueOrDefault("jackdaw")==26&&counts.GetValueOrDefault("crow")==12;
        File.WriteAllText(Path.Combine(dir,"smalllife-trace.json"),JsonSerializer.Serialize(new{ok=over==0&&populations,frames=sorted.Length,
            max=sorted[^1],mean=sorted.Average(),p99=sorted[(int)(sorted.Length*.99)],framesOver1ms=over,populations=counts,
            pictureBytes=SmallLifeKit.PictureBytes,animationBytes=SmallLifeKit.AnimationBytes,columns=new[]{"t","ms","townMs","parkMs","courtyardMs","pigeonMs","gen0Collections","townBytes","parkBytes"},rows}));
        GD.Print($"smalllife trace: {sorted.Length} frames, max {sorted[^1]:0.000} ms, over 1 ms {over}, populations {populations}");
    }
    private async System.Threading.Tasks.Task Integration(Townspeople town)
    {
        var receipts=new List<object>();
        var checks=new Dictionary<string,bool>();
        var counts=SmallLife.I!.List.GroupBy(b=>b.Kind).ToDictionary(g=>g.Key,g=>g.Count());
        checks["eight wall-foot rats"]=counts.GetValueOrDefault("rat")==8;
        checks["three six-bird sparrow flocks"]=counts.GetValueOrDefault("sparrow")==18;
        checks["26 native roof jackdaws"]=counts.GetValueOrDefault("jackdaw")==26;
        checks["12 native roof crows"]=counts.GetValueOrDefault("crow")==12;
        var court=NativeCourtyards.I!;var ids=court.List.Select(a=>a.Id).ToArray();
        checks["courtyard permanent IDs remain unique"]=ids.Distinct().Count()==ids.Length&&ids.All(id=>id.StartsWith("a:hen:")||id.StartsWith("a:goat:"));
        checks["source-sized courtyard population"]=court.Hens>0&&court.Hens<=18&&court.Hens%3==0&&court.Goats>0&&court.Goats<=2;
        checks["stable variants"]=SmallLife.I.List.All(b=>Math.Abs(b.Size-(.93f+.14f*(float)NativeCourtyardRules.H01(b.Id)))<.00001);
        foreach(var (tag,hour,weather) in new[]{("day",13f,"clear"),("rain",13f,"rain"),("lamps",19.5f,"clear")})
        {
            await Dev.Kit.I.Light(hour,weather);for(int i=0;i<30;i++)await Frame();
            foreach(string kind in new[]{"hen","goat"})
            {
                var a=court.List.First(b=>b.Kind==kind);
                var stateAt=new Vector3((float)a.X,(float)town.Walk!.BaseAt(a.X,a.Z),(float)a.Z);
                View(stateAt+new Vector3(2,1,2),stateAt+Vector3.Up*.2f);
                for(int i=0;i<30;i++)await Frame();
                a=court.List.First(b=>b.Id==a.Id);var at=a.Body.GlobalPosition;
                float h=SmallLifeKit.Kinds[kind].Height;var target=at+Vector3.Up*h*.5f;
                await Shot($"integration-{tag}-courtyard-{kind}",ClearView(target,1.3f,.25f),target,kind,"live",0);
                checks[$"{tag} courtyard {kind} actually drawn"]=a.Body.IsVisibleInTree()&&at.DistanceTo(stateAt)<5;
                receipts.Add(new{phase=tag,kind,id=a.Id,at=new[]{at.X,at.Y,at.Z},drawn=a.Body.IsVisibleInTree()});
            }
            foreach(string kind in new[]{"duck","swan","goose","squirrel","songbird"})
            {
                var a=ParkWildlife.I!.List.First(b=>b.Species==kind);var target=new Vector3((float)a.X,(float)a.Y+.25f,(float)a.Z);
                await Shot($"integration-{tag}-park-{kind}",ClearView(target,1.3f,.25f),target,kind,a.Mode,0);
                receipts.Add(new{phase=tag,kind,id=a.Id,a.Home,a.Mode,at=new[]{a.X,a.Y,a.Z},instanced=true});
            }
            foreach(string kind in new[]{"sparrow","jackdaw","crow","rat"})
            {
                var a=SmallLife.I.List.First(b=>b.Kind==kind);var target=a.At+Vector3.Up*SmallLifeKit.Kinds[kind].Height*.5f;
                await Shot($"integration-{tag}-town-{kind}",ClearView(target,1.3f,.25f),target,kind,a.Motion,0);
                receipts.Add(new{phase=tag,kind,id=a.Id,at=new[]{a.At.X,a.At.Y,a.At.Z},home=new[]{a.Home.X,a.Home.Y,a.Home.Z},a.Perched,a.Size,instanced=true});
            }
        }
        File.WriteAllText(Path.Combine(dir,"smalllife-integration.json"),JsonSerializer.Serialize(new{ok=checks.Values.All(v=>v),checks,receipts,pictures},new JsonSerializerOptions{WriteIndented=true}));
        GD.Print($"smalllife integration: {checks.Count} checks, {pictures.Count} pictures");
    }
    private Vector3 ClearView(Vector3 target,float gap,float height)
    {
        for(int i=0;i<16;i++) {
            float angle=i*MathF.Tau/16;
            var at=target+new Vector3(MathF.Cos(angle)*gap,height,MathF.Sin(angle)*gap);
            using var ray=PhysicsRayQueryParameters3D.Create(target,at);
            if(Main.I.Cam.GetWorld3D().DirectSpaceState.IntersectRay(ray).Count==0)return at;
        }
        return target+Vector3.Up*gap+new Vector3(.1f,0,.1f);
    }
}
