using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Player;
using Scheldemist.World;
using Scheldemist.World.Ruien;

namespace Scheldemist.Native.World;

public static class NativeRuienLandmarksProof
{
    private sealed record Site(string Mesh,string Area,Vector3 Eye,Vector3 Detail,Vector3 Target);
    private static readonly Site[] Sites = {
        new("RijnkaaiRepair","network_j026",new(56.94f,-2.30f,13.85f),new(58.15f,-2.63f,15.45f),new(59.89f,-2.59f,15.08f)),
        new("HanseaticBlindArch","network_j064",new(70.30f,-2.24f,201.60f),new(72.80f,-2.54f,200.57f),new(74.43f,-3.05f,202))
    };

    // Sample the whole face at 55 mm spacing. The open culvert between the two
    // piers has a reserved rectangle: prove first that no new triangle enters it.
    private static object CheckWall(PhysicsDirectSpaceState3D space,MeshInstance3D detail,List<string> issues)
    {
        var box = detail.GetAabb();
        var pose = detail.GlobalTransform;
        int cols = Mathf.CeilToInt(box.Size.X/.055f), rows = Mathf.CeilToInt(box.Size.Y/.055f);
        int hits = 0, expected = 0;
        float depth = 0;
        bool arch = detail.Name == "HanseaticBlindArch";
        var faces=detail.Mesh.GetFaces();
        var samplesOffWall=new List<object>();
        int uncoveredArtSamples=0;
        (int faces,double worstVisual,double worstSolid,Vector3 spot) coverage=default;
        if (arch)
        {
            var end=detail.GetViewport().GetNode<Node3D>("ruien_end_L51_stub");
            var headwall=end.GetChildren().OfType<MeshInstance3D>().Single(m=>m.Mesh is ArrayMesh a && a.SurfaceGetName(0)=="ruien_brick_header");
            coverage=NativePlaqueSupportProof.FacingCoverage(detail,headwall,end.FindChildren("*","CollisionShape3D",true,false).OfType<CollisionShape3D>());
            if(coverage.faces==0 || coverage.worstSolid>1e-9 || coverage.worstVisual>1e-9)
                issues.Add($"Blind arch face support at {coverage.spot}: {coverage.worstSolid*1e6:F4} mm² without solid, {coverage.worstVisual*1e6:F4} mm² without visible masonry");
            for (int i=0; i<faces.Length; i+=3)
            {
                var lo=faces[i].Min(faces[i+1]).Min(faces[i+2]);
                var hi=faces[i].Max(faces[i+1]).Max(faces[i+2]);
                if (lo.Y<-.64f && lo.X<.58f && hi.X>-.58f)
                {
                    issues.Add("New arch masonry overlaps the reserved culvert throat");
                    break;
                }
            }
        }
        using var query = new PhysicsRayQueryParameters3D { CollisionMask = Solid.Layer };
        for (int row=0; row<=rows; row++)
        for (int col=0; col<=cols; col++)
        {
            var local = new Vector3(Mathf.Lerp(box.Position.X,box.End.X,(float)col/cols),Mathf.Lerp(box.Position.Y,box.End.Y,(float)row/rows),0);
            if (arch && local.Y<-.64f && MathF.Abs(local.X)<.58f) continue;
            expected++;
            var p = pose * local;
            query.From = p + pose.Basis.Z*.055f;
            query.To = p - pose.Basis.Z*.055f;
            var hit = space.IntersectRay(query);
            if (hit.Count==0 || hit["normal"].AsVector3().Dot(pose.Basis.Z)<.80f)
            {
                var q=new Vector2(local.X,local.Y);
                bool underArt=false;
                for(int i=0;i<faces.Length && !underArt;i+=3)
                {
                    var a=new Vector2(faces[i].X,faces[i].Y);
                    var b=new Vector2(faces[i+1].X,faces[i+1].Y);
                    var c=new Vector2(faces[i+2].X,faces[i+2].Y);
                    if(MathF.Abs((b-a).Cross(c-a))>1e-10f) underArt=Geometry2D.PointIsInsideTriangle(q,a,b,c);
                }
                // A sloping ledge meets the left pier at foot level. Test the masonry
                // behind that distinct collider when its upward face was the first hit.
                bool backingBehindOccluder=false;
                if (hit.Count!=0 && hit["collider"].AsGodotObject() is CollisionObject3D occluder)
                {
                    using var beyond=PhysicsRayQueryParameters3D.Create(query.From,query.To,Solid.Layer);
                    beyond.Exclude=new Godot.Collections.Array<Rid>{occluder.GetRid()};
                    var behind=space.IntersectRay(beyond);
                    backingBehindOccluder=behind.Count!=0 && behind["normal"].AsVector3().Dot(pose.Basis.Z)>.80f
                        && MathF.Abs((behind["position"].AsVector3()-p).Dot(pose.Basis.Z))<.035f;
                }
                if(underArt && !backingBehindOccluder) uncoveredArtSamples++;
                samplesOffWall.Add(new {x=p.X,y=p.Y,z=p.Z,underArt,backingBehindOccluder,nearest=hit.Count==0?"no solid":
                    (hit["collider"].AsGodotObject() as Node)?.GetPath().ToString(),normal=hit.Count==0?"":hit["normal"].AsVector3().ToString()});
                continue;
            }
            depth = MathF.Max(depth,MathF.Abs((hit["position"].AsVector3()-p).Dot(pose.Basis.Z)));
            hits++;
        }
        if (uncoveredArtSamples>0 || (!arch && hits!=expected) || depth>.035f)
            issues.Add($"{detail.Name}: backing at {hits}/{expected} wall samples, max offset {depth:F3} m");
        if (box.End.Z>.020f || detail.FindChildren("*","CollisionObject3D").Count!=0)
            issues.Add(detail.Name+" has excessive relief or its own collision");
        return new {samples=expected,firstHitOnWall=hits,maxWallOffset=depth,samplesOffWall,uncoveredArtSamples,
            archFaceProjections=coverage.faces,worstVisualGapSquareMm=coverage.worstVisual*1e6,worstPhysicsGapSquareMm=coverage.worstSolid*1e6};
    }

    private static async Task<int> CheckOpenings(PhysicsDirectSpaceState3D space,Site site,List<string> issues)
    {
        var ruien = Ruien.I!;
        var area = ruien.Data.Areas.Single(a => a.Id == site.Area);
        var mouths = area.Zones.Where(z => z.Kind == "line").ToArray();
        int count = 0;
        if (mouths.Length != 3 || area.Bridges.Count != 2)
            issues.Add($"{site.Area}: expected three gallery mouths and two folding bridges");
        void Walk(string name, Vector3 from, Vector3 to)
        {
            if (!NativeRuienNetworkProof.Reach(space, from, to, out string obstruction))
                issues.Add($"{name}: {obstruction}");
            else count++;
        }
        async Task Phase(float? phase)
        {
            RuienFoldBridge.ProofPhase = phase;
            for (int i=0; i<3; i++) await ruien.ToSignal(ruien.GetTree(),SceneTree.SignalName.PhysicsFrame);
        }
        var previous = RuienFoldBridge.ProofPhase;
        try
        {
            await Phase(0);
            foreach (var zone in mouths)
            {
                if (zone.Id == "J064_L51")
                {
                    // L51 terminates in a barred culvert. From the stairs, the railing leads
                    // along the authored return walkway to the bridge over the mouth.
                    using var layout=JsonDocument.Parse(Godot.FileAccess.GetFileAsString(RuienData.AreasFile));
                    var definition=layout.RootElement.GetProperty("areas").EnumerateArray().Single(a=>a.GetProperty("id").GetString()==area.Id);
                    var bypass=definition.GetProperty("walkProof").EnumerateArray().Where(r=>r.GetProperty("name").GetString()=="stair_bypass").ToArray();
                    if(bypass.Length==0) issues.Add(zone.Id+": missing stair bypass to the bridge");
                    Vector3 Position(JsonElement p)=>new(p[0].GetSingle(),p[1].GetSingle(),p[2].GetSingle());
                    foreach(var leg in bypass)
                        Walk(zone.Id+" stair bypass",Position(leg.GetProperty("from")),Position(leg.GetProperty("to")));
                    continue;
                }
                // At open branches Jef steps off the heel onto the single dry ledge.
                // Follow the water-side line, with space for his cylinder beneath the arch.
                var (inside,dir) = zone.Frame(0);
                var across = new Vector2(dir.Y,-dir.X);
                var ledge = across * (zone.S.WalkwaySide * (zone.S.Width/2 - zone.S.Ledge + Jef.Radius));
                Vector3 At(Vector2 p) => new(p.X,zone.S.LedgeY,p.Y);
                Walk(zone.Id+" side ledge",At(inside - dir*.35f + ledge),At(zone.Path[^1] - dir*.65f + ledge));
            }
            foreach (var spec in area.Bridges)
            {
                if (!RuienFoldBridge.All.TryGetValue(spec.Id,out var bridge) || bridge.Phase > .001f)
                { issues.Add(spec.Id+": bridge did not lower"); continue; }
                var a = bridge.GlobalPosition;
                Walk(spec.Id+" lowered deck",a,a + bridge.GlobalBasis.X*bridge.Span);
            }
            await Phase(1);
            foreach (var spec in area.Bridges)
            {
                if (!RuienFoldBridge.All.TryGetValue(spec.Id,out var bridge) || bridge.Phase < .999f)
                { issues.Add(spec.Id+": bridge did not raise"); continue; }
                // Once the leaves stand, the clear way is on the channel bed between them.
                var zone = mouths.Single(z => z.Id == spec.Id);
                var mid = (spec.A + spec.B) * .5f;
                mid.Y = zone.S.Bed;
                var through = bridge.GlobalBasis.Z*.94f;
                Walk(spec.Id+" raised channel",mid - through,mid + through);
            }
        }
        finally
        {
            if (previous==null) await Phase(0);
            await Phase(previous);
        }
        if(site.Area=="network_j064")
        {
            // The working throat is clear up to the grille, 9 cm behind the original face.
            using var query = new PhysicsRayQueryParameters3D { CollisionMask=Solid.Layer };
            foreach (float h in new[]{-4.52f,-4.22f,-4.06f})
            foreach (float offset in new[]{-.22f,0,.22f})
            {
                query.From = new(74.22f,h,202+offset); query.To = new(74.50f,h,202+offset);
                if (space.IntersectRay(query).Count != 0) issues.Add($"L51 culvert blocked at {query.From}");
                else count++;
            }
            if(Ruien.I!.WaterAt(74.46f,202) is null) issues.Add("L51's live water sheet ends before the culvert");
        }
        return count;
    }

    public static async Task Run(NativeTownGame game,string output)
    {
        Directory.CreateDirectory(output);
        var issues=new List<string>();
        var sites=new List<object>();
        var player=Jef.I;
        var oldFeet=new Vector3(player.X,player.Y,player.Z);
        var (yaw,pitch,frozen)=(player.Yaw,player.Pitch,player.Frozen);
        var previousCam=game.Cam;
        var (hour,weather)=(GameState.I.HourF,GameState.I.Weather);
        var huds=game.GetTree().Root.FindChildren("*","CanvasLayer",true,false).OfType<CanvasLayer>().Where(layer=>layer.Visible).ToArray();
        var camera=new Camera3D {Near=.035f,Fov=61,CullMask=previousCam.CullMask & ~Arms.BodyLayer,Environment=previousCam.Environment};
        async Task Frames(int count)
        {
            for(int i=0;i<count;i++) await game.ToSignal(game.GetTree(),SceneTree.SignalName.ProcessFrame);
        }
        void Place(Vector3 eye,Vector3 target)
        {
            camera.LookAtFromPosition(eye,target);
            var look=camera.GlobalBasis.GetEuler(EulerOrder.Yxz);
            player.Place(eye.X,eye.Z,look.Y,look.X,eye.Y-Jef.Eye);
        }
        async Task Picture(string file)
        {
            await game.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
            using var image=game.View.GetTexture().GetImage();
            if(image.SavePng(Path.Combine(output,file+".png"))!=Error.Ok) throw new IOException(file);
        }
        game.View.AddChild(camera);
        camera.MakeCurrent();game.Cam=camera;player.Frozen=true;
        foreach(var hud in huds) hud.Visible=false;
        try
        {
            foreach(var site in Sites)
            {
                Place(site.Eye,site.Target);
                await Frames(8);
                var until=DateTime.UtcNow.AddSeconds(90);
                while(Ruien.I!.PendingVisuals(site.Eye).Any())
                {
                    if(DateTime.UtcNow>until)throw new TimeoutException("Waiting for "+site.Area);
                    await Frames(1);
                }
                var mesh=game.View.GetNode<MeshInstance3D>("RuienJunctionLandmarks/"+site.Mesh);
                if(!mesh.IsVisibleInTree() || (mesh.Layers&camera.CullMask)==0 || !camera.IsPositionInFrustum(site.Target))
                    issues.Add(site.Mesh+" missing from approach camera");
                var space=game.View.FindWorld3D().DirectSpaceState;
                var backing=CheckWall(space,mesh,issues);
                int openings=await CheckOpenings(space,site,issues);
                foreach(var (state,clock) in new[]{("clear",13),("rain",13),("clear",23)})
                {
                    await Scheldemist.Dev.Kit.I.Light(clock,state,false);
                    await Frames(24);
                    if(state=="clear" && clock==13)
                    {
                        await Picture(site.Mesh+"-approach");
                        Place(site.Detail,site.Target);
                        await Frames(8);
                    }
                    await Picture($"{site.Mesh}-{state}-{clock}");
                }
                sites.Add(new {site.Mesh,site.Area,backing,openingChecks=openings,
                    maxFacingDepth=mesh.GetAabb().End.Z,materials=mesh.Mesh.GetSurfaceCount()});
            }
        }
        finally
        {
            previousCam.MakeCurrent();game.Cam=previousCam;
            player.Place(oldFeet.X,oldFeet.Z,yaw,pitch,oldFeet.Y);
            player.Frozen=frozen;
            foreach(var hud in huds) hud.Visible=true;
            camera.QueueFree();
            await Scheldemist.Dev.Kit.I.Light(hour,weather,false);
        }
        File.WriteAllText(Path.Combine(output,"landmarks.json"),JsonSerializer.Serialize(new {passed=issues.Count==0,sites,issues},new JsonSerializerOptions{WriteIndented=true}));
        if(issues.Count>0) throw new InvalidOperationException(string.Join(" | ",issues));
        GD.Print("Ruien junction masonry: both facings supported; gallery mouths and barred culvert clear");
    }
}
