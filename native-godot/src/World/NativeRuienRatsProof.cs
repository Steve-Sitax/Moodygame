using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.People;
using Scheldemist.Player;
using Scheldemist.World;
using Scheldemist.World.Ruien;
using Site = Scheldemist.People.RuienRatSites.Site;

namespace Scheldemist.Native.World;

/// <summary>Exercise the real subterranean rat batches after entering native play.</summary>
public static class NativeRuienRatsProof
{
    private const string DrawPath = "ruien_rats/rat";
    private const float Runout = .39f, HalfWidth = .07f;
    private static Vector3 Along(Site site) => new Vector3(site.B.X-site.A.X,0,site.B.Z-site.A.Z).Normalized();

    // Intersect a whole longitudinal probe with the projection of a real floor triangle. The
    // union of intervals must reach the far end without jumping across cracks or open hatches.
    private static bool FloorInterval(Vector3 origin, Vector3 dir, Vector3 side, float grade,
        float length, Vector3 a, Vector3 b, Vector3 c, out (float Lo,float Hi) interval)
    {
        interval = default;
        var normal = (b-a).Cross(c-a);
        if (MathF.Abs(normal.Y) < .72f*normal.Length() || MathF.Abs(normal.Y)<1e-9f) return false;
        a -= origin; b -= origin; c -= origin;
        Vector2 Project(Vector3 p) => new(p.Dot(dir),p.Dot(side));
        Vector2 u=Project(a),v=Project(b),w=Project(c);
        float sign=MathF.Sign((v-u).Cross(w-u));
        float lo=0,hi=length;
        bool Clip(float intercept,float slope)
        {
            if (MathF.Abs(slope)<1e-7f) return intercept>=-1e-6f;
            float t=-intercept/slope;
            if(slope>0) lo=MathF.Max(lo,t); else hi=MathF.Min(hi,t);
            return lo<=hi;
        }
        bool Edge(Vector2 first,Vector2 last)
        {
            var e=last-first;
            return Clip(sign*e.Cross(-first),-sign*e.Y);
        }
        if (sign==0 || !Edge(u,v) || !Edge(v,w) || !Edge(w,u)) return false;
        float z0=normal.Dot(a)/normal.Y, slope=-normal.Dot(dir)/normal.Y-grade;
        if (!Clip(.05f+z0,slope) || !Clip(.05f-z0,-slope)) return false;
        interval=(lo,hi);
        return true;
    }

    private static void CheckLedge(NativeTownGame game, Site site,List<string> issues)
    {
        var ruien=Ruien.I!;
        var area=ruien.Data.Areas.First(a=>a.Id==site.Area);
        var dryLevel=area.WaterMin+area.WaterRise+MathF.Max(0,area.Water.Select(w=>w.LevelOffset).DefaultIfEmpty(0).Max());
        if(MathF.Min(site.A.Y,site.B.Y)<dryLevel+.03f) issues.Add(site.Id+" reaches flood level");
        var owner=game.View.GetNodeOrNull<StaticBody3D>("ruien_"+site.Area+"_solid");
        var ground=owner?.GetChildren().OfType<CollisionShape3D>().FirstOrDefault(n=>!n.Disabled && n.Shape is ConcavePolygonShape3D);
        if(ground?.Shape is not ConcavePolygonShape3D shape) { issues.Add(site.Id+" lacks its installed solid"); return; }
        var faces=shape.GetFaces(); var xf=ground.GlobalTransform;
        if(xf!=Transform3D.Identity) for(int i=0;i<faces.Length;i++) faces[i]=xf*faces[i];
        var dir=Along(site); var side=dir.Cross(Vector3.Up);
        float length=(site.B-site.A).Dot(dir), grade=(site.B.Y-site.A.Y)/length;
        var run=dir+Vector3.Up*grade;
        var start=site.A-run*Runout; length+=2*Runout;
        var bounds=new Aabb(start,Vector3.Zero).Expand(start+run*length).Grow(.18f);
        var strips=new List<(float Lo,float Hi)>[5];
        for(int j=0;j<strips.Length;j++) strips[j]=new();
        for(int i=0;i+2<faces.Length;i+=3)
        {
            var a=faces[i]; var b=faces[i+1]; var c=faces[i+2];
            var lo=a.Min(b).Min(c); var hi=a.Max(b).Max(c);
            if(hi.X<bounds.Position.X || lo.X>bounds.End.X || hi.Z<bounds.Position.Z || lo.Z>bounds.End.Z || hi.Y<bounds.Position.Y || lo.Y>bounds.End.Y) continue;
            for(int j=0;j<strips.Length;j++)
                if(FloorInterval(start+side*((j-2)*HalfWidth*.5f),dir,side,grade,length,a,b,c,out var span)) strips[j].Add(span);
        }
        var space=game.View.FindWorld3D().DirectSpaceState;
        using var ray=new PhysicsRayQueryParameters3D{CollisionMask=Solid.Layer};
        for(int j=0;j<strips.Length;j++)
        {
            float end=0;
            foreach(var span in strips[j].OrderBy(s=>s.Lo))
            {
                if(span.Lo>end+.001f)break;
                end=MathF.Max(end,span.Hi);
            }
            if(end<length-.001f) { issues.Add($"{site.Id} floor gap at {end:F3} m on strip {j}"); break; }
            var edge=start+side*((j-2)*HalfWidth*.5f);
            ray.From=edge+Vector3.Up*.08f;ray.To=ray.From+run*length;
            if(space.IntersectRay(ray).Count>0) { issues.Add($"{site.Id} obstructed at body height on strip {j}");break; }
            for(int k=0;k<=Mathf.CeilToInt(length/.10f);k++)
            {
                var p=edge+run*MathF.Min(length,.10f*k);
                if(ruien.WaterAt(p.X,p.Z) is {} water && water>=p.Y-.025f)
                {issues.Add(site.Id+" intersects the live water sheet");break;}
            }
        }
    }

    private static bool ViewClear(PhysicsDirectSpaceState3D space, Vector3 eye, Vector3 target)
    {
        using var ray=PhysicsRayQueryParameters3D.Create(target,eye,Solid.Layer);
        ray.HitFromInside=true;
        return space.IntersectRay(ray).Count==0;
    }

    private static Vector3 Vantage(PhysicsDirectSpaceState3D space,Site site,Vector3 target,bool close)
    {
        var dir=Along(site);var side=dir.Cross(Vector3.Up);
        // Standing on the ledge to approach; for the close view crouch at animal height and
        // look back across the ledge. Reject positions separated from the rat by masonry.
        foreach(float direction in new[]{1f,-1f})
        foreach(float lateral in close?new[]{.63f,-.63f,.40f,-.40f,0f}:new[]{0f,.15f,-.15f})
        {
            var at=target+dir*(direction*(close?.44f:4.5f))+side*lateral+Vector3.Up*(close?.14f:1.49f);
            if(ViewClear(space,at,target))return at;
        }
        throw new InvalidOperationException("Blocked camera approach at "+site.Id);
    }

    private static int Instance(MultiMeshInstance3D? draw,Site site,Camera3D camera, out Vector3 feet)
    {
        feet=default;
        if(draw is not {Multimesh:{} mesh} || !draw.IsVisibleInTree() || (draw.Layers & camera.CullMask)==0 || mesh.Mesh==null) return -1;
        for(int i=0;i<mesh.VisibleInstanceCount;i++)
        {
            var p=draw.GlobalTransform*mesh.GetInstanceTransform(i).Origin;
            if(Geometry3D.GetClosestPointToSegment(p,site.A,site.B).DistanceTo(p)>.14f)continue;
            feet=p;return i;
        }
        return -1;
    }

    public static async Task Run(NativeTownGame game,string output)
    {
        Directory.CreateDirectory(output);
        var issues=new List<string>();
        var receipts=new List<object>();
        var ruien=Ruien.I!;
        var sites=RuienRatSites.All;
        if(sites.Length==0 || sites.Select(s=>s.Id).Distinct().Count()!=sites.Length) throw new InvalidOperationException("Missing or duplicate rat sites");
        foreach(var site in sites) CheckLedge(game,site,issues);
        var previousCamera=game.Cam;
        var player=Jef.I;
        var oldFeet=new Vector3(player.X,player.Y,player.Z);
        var (yaw,pitch,frozen,testing)=(player.Yaw,player.Pitch,player.Frozen,player.TestInput);
        var (hour,weather)=(GameState.I.HourF,GameState.I.Weather);
        var huds=game.GetTree().Root.FindChildren("*","CanvasLayer",true,false).OfType<CanvasLayer>().Where(h=>h.Visible).ToArray();
        var camera=new Camera3D { Near=.025f, Fov=69, CullMask=game.Cam.CullMask & ~Arms.BodyLayer, Environment=game.Cam.Environment };
        game.View.AddChild(camera);camera.MakeCurrent();game.Cam=camera;
        Jef.I.TestInput=true;Jef.I.Frozen=true;
        foreach(var hud in huds) hud.Visible=false;
        async Task Frame() => await game.ToSignal(game.GetTree(),SceneTree.SignalName.ProcessFrame);
        async Task Frames(int count) { for(int i=0;i<count;i++) await Frame(); }
        void Place(Vector3 at,Vector3 target)
        {
            camera.LookAtFromPosition(at,target);
            var angle=camera.GlobalBasis.GetEuler(EulerOrder.Yxz);
            Jef.I.Place(at.X,at.Z,angle.Y,angle.X,at.Y-Jef.Eye);
        }
        MultiMeshInstance3D? Draw() => game.View.GetNodeOrNull<MultiMeshInstance3D>(DrawPath);
        async Task Surface(Site site)
        {
            var at=site.A;at.Y=1.65f;Place(at,at+Along(site));await Frames(8);
            if(Draw() is {} d && d.IsVisibleInTree() && d.Multimesh.VisibleInstanceCount>0)issues.Add("underground rats drawn from street above "+site.Id);
        }
        async Task Shot(string filename)
        {
            await game.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
            using var image=game.View.GetTexture().GetImage();
            if(image.SavePng(Path.Combine(output,filename))!=Error.Ok) throw new IOException(filename);
        }
        try
        {
            await Surface(sites[0]);
            await Scheldemist.Dev.Kit.I.Light(13,"clear",false);
            var space=game.View.FindWorld3D().DirectSpaceState;
            foreach(var site in sites)
            {
                var centre=(site.A+site.B)*.5f+Vector3.Up*.065f;
                Place(Vantage(space,site,centre,false),centre);
                await Frames(6);
                var deadline=DateTime.UtcNow.AddSeconds(25);
                Vector3 feet;
                while(Instance(Draw(),site,camera,out feet)<0 && DateTime.UtcNow<deadline) await Frame();
                var draw=Draw();int index=Instance(draw,site,camera,out feet);
                if(index<0 || draw==null) {issues.Add("no rat submitted to renderer at "+site.Id);continue;}
                var mesh=draw.Multimesh;
                var original=feet;var pose=mesh.GetInstanceCustomData(index);
                float moved=0;
                bool changed=false;
                deadline=DateTime.UtcNow.AddSeconds(12);
                while((moved<.15f || !changed) && DateTime.UtcNow<deadline)
                {
                    await Frame();
                    index=Instance(draw,site,camera,out feet);
                    if(index<0)continue;
                    moved=MathF.Max(moved,original.DistanceTo(feet));
                    changed|=mesh.GetInstanceCustomData(index)!=pose;
                }
                if(moved<.15f || !changed)issues.Add("no animated scurry at "+site.Id);
                bool hero=site.Id.EndsWith(":entrepot",StringComparison.Ordinal) || site.Id.EndsWith(":vleeshuis",StringComparison.Ordinal);
                if(hero)
                {
                    deadline=DateTime.UtcNow.AddSeconds(60);
                    while(ruien.PendingVisuals(camera.GlobalPosition).Any() && DateTime.UtcNow<deadline) await Frame();
                    if(ruien.PendingVisuals(camera.GlobalPosition).Any()) issues.Add("unloaded gallery in "+site.Id);
                    if(Instance(draw,site,camera,out feet)>=0) camera.LookAt(feet+Vector3.Up*.07f);
                    string name=site.Id.Split(':')[^1];
                    await Shot(name+"-approach.png");
                    Place(Vantage(space,site,feet+Vector3.Up*.07f,true),feet+Vector3.Up*.07f);
                    await Frames(8);
                    // Frame the live animal after its response to the close approach.
                    if(Instance(draw,site,camera,out feet)>=0)
                    {
                        var target=feet+Vector3.Up*.07f;
                        camera.LookAtFromPosition(Vantage(space,site,target,true),target);
                        await Shot(name+"-close.png");
                    }
                    else issues.Add("close camera lost "+site.Id);
                }
                // Approach from the nearer end of the ledge and observe the submitted instance
                // moving away, even if its ordinary patrol had been heading towards the player.
                float fled=0;
                if(Instance(draw,site,camera,out feet)>=0)
                {
                    var from=feet;
                    var away=feet.DistanceSquaredTo(site.A)<feet.DistanceSquaredTo(site.B)?Along(site):-Along(site);
                    var eye=from-away*.60f+Vector3.Up*1.48f;
                    Place(eye,from+Vector3.Up*.075f);
                    deadline=DateTime.UtcNow.AddSeconds(7);
                    while(fled<.30f && DateTime.UtcNow<deadline)
                    {
                        await Frame();
                        if(Instance(draw,site,camera,out feet)>=0) fled=MathF.Max(fled,(feet-from).Dot(away));
                    }
                }
                if(fled<.30f) issues.Add("rat failed to flee approaching player at "+site.Id);
                receipts.Add(new{site.Id,site.Entrance,site.Area,visibleInstances=mesh.VisibleInstanceCount,maximumDisplacement=moved,skinPoseChanged=changed,fledMetres=fled});
            }
            await Surface(sites[0]);
        }
        finally
        {
            game.Cam=previousCamera;previousCamera.MakeCurrent();
            player.Place(oldFeet.X,oldFeet.Z,yaw,pitch,oldFeet.Y);
            player.Frozen=frozen;player.TestInput=testing;
            foreach(var hud in huds) hud.Visible=true;
            camera.QueueFree();
            await Scheldemist.Dev.Kit.I.Light(hour,weather,false);
        }
        File.WriteAllText(Path.Combine(output,"rats.json"),JsonSerializer.Serialize(new{passed=issues.Count==0,sites=receipts,issues},new JsonSerializerOptions{WriteIndented=true}));
        if(issues.Count>0) throw new InvalidOperationException(string.Join(" | ",issues));
        GD.Print($"Ruien rats: {sites.Length} dry, supported runs and live animated draws verified");
    }
}
