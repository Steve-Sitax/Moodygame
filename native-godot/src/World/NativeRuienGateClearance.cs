using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.World;
using Scheldemist.World.Ruien;

namespace Scheldemist.Native.World;

/// <summary>Gate leaves through their full motion against the assembled town, including native pier timbers.</summary>
public static class NativeRuienGateClearance
{
    private static List<Vector2> Stations(Vector3[] faces,out Aabb bounds)
    {
        bounds=new Aabb(faces[0],Vector3.Zero);foreach(var face in faces)bounds=bounds.Expand(face);
        var outline=Geometry2D.ConvexHull(faces.Select(v=>new Vector2(v.X,v.Z)).Distinct().ToArray());
        var result=new List<Vector2>();
        for(float x=bounds.Position.X+.025f;x<=bounds.End.X;x+=.1f)
            for(float z=bounds.Position.Z+.025f;z<=bounds.End.Z;z+=.1f)
                if(Geometry2D.IsPointInPolygon(new Vector2(x,z),outline))result.Add(new Vector2(x,z));
        return result;
    }

    private static Vector3[] ApronStations(string kit,float sill)
    {
        var faces=ResourceLoader.Load<ConcavePolygonShape3D>(kit+"/collision.res").GetFaces();
        // The dressed apron uses small relief triangles. Sample its actual top
        // vertices, including worn edges, rather than a box spanning empty water.
        return faces.Where(p=>p.Z<-.48f&&p.Y>sill-.12f&&p.Y<sill+.05f)
            .GroupBy(p=>(MathF.Round(p.X*40),MathF.Round(p.Y*40),MathF.Round(p.Z*40))).Select(g=>g.First()).ToArray();
    }

    private static object? ApronHit(Scheldemist.Movers.Boats boats,Vector3[] stations,Transform3D frame)
    {
        foreach(var local in stations)
        {
            var p=frame*local;
            if(boats.HullIn(p.X,p.Z,.05f,p.Y-.015f,p.Y+.015f,out var boat))
                return new{at=p.ToString(),local=local.ToString(),boatAt=boat.Origin.ToString()};
        }
        return null;
    }

    /// <summary>Read-only placement candidates against actual live boat hulls. This is
    /// only a boat survey; candidate masonry and route continuity need separate proofs.</summary>
    public static void SurveyBoats(string input,string output)
    {
        var boats=Scheldemist.Movers.Boats.I??throw new InvalidOperationException("Boat survey requires the assembled town");
        using var candidates=JsonDocument.Parse(System.IO.File.ReadAllText(input));
        var gates=RuienNetworkGates.Read().Specs.ToDictionary(g=>g.Id);
        var results=new List<object>();
        foreach(var group in candidates.RootElement.EnumerateArray().GroupBy(c=>(c.GetProperty("id").GetString()!,c.GetProperty("variant").GetString()!)))
        {
            var gate=gates[group.Key.Item1];string kit=gate.Kit[..gate.Kit.LastIndexOf('/')]+"/"+group.Key.Item2;
            var apron=ApronStations(kit,gate.Sill);
            using var markers=JsonDocument.Parse(Godot.FileAccess.GetFileAsString(kit+"/markers.json"));
            var movers=markers.RootElement.GetProperty("movers").EnumerateArray().Select(m=>
            {
                var collision=ResourceLoader.Load<ConcavePolygonShape3D>(kit+"/"+m.GetProperty("collision").GetString());
                var stations=Stations(collision.GetFaces(),out var bounds);var p=m.GetProperty("pivot");
                return (id:m.GetProperty("id").GetString(),stations,bounds,pivot:new Vector3(p[0].GetSingle(),p[1].GetSingle(),p[2].GetSingle()),degrees:m.GetProperty("openDeg").GetSingle());
            }).ToArray();
            foreach(var candidate in group)
            {
                var p=candidate.GetProperty("origin");var frame=gate.Frame;frame.Origin=new Vector3(p[0].GetSingle(),0,p[1].GetSingle());
                object? hit=null;int samples=0;
                foreach(var mover in movers)
                {
                    for(int step=0;step<=32&&hit==null;step++)
                    {
                        float degrees=candidate.TryGetProperty("openDegrees",out var opening)?MathF.Sign(mover.degrees)*opening.GetSingle():mover.degrees;
                        float fraction=step/32f;var basis=new Basis(Vector3.Up,Mathf.DegToRad(degrees*fraction));
                        var pose=frame*new Transform3D(basis,mover.pivot-basis*mover.pivot);
                        foreach(var station in mover.stations)
                        {
                            var low=pose*new Vector3(station.X,mover.bounds.Position.Y,station.Y);
                            var high=pose*new Vector3(station.X,mover.bounds.End.Y,station.Y);samples++;
                            if(!boats.HullIn(low.X,low.Z,.075f,low.Y,high.Y,out var boat))continue;
                            hit=new{mover.id,fraction,at=low.ToString(),boatAt=boat.Origin.ToString()};break;
                        }
                    }
                    if(hit!=null)break;
                }
                var apronHit=ApronHit(boats,apron,frame);
                results.Add(new{id=gate.Id,variant=group.Key.Item2,origin=new[]{frame.Origin.X,frame.Origin.Z},openDegrees=candidate.TryGetProperty("openDegrees",out var angle)?angle.GetSingle():MathF.Abs(movers[0].degrees),clear=hit==null&&apronHit==null,leafClear=hit==null,apronClear=apronHit==null,samples,hit,apronHit});
            }
        }
        System.IO.File.WriteAllText(output,JsonSerializer.Serialize(new{tide=Tide.River,candidates=results},new JsonSerializerOptions{WriteIndented=true}));
    }

    public static int Run(Node scene,List<object> errors)
    {
        var space=(scene as Viewport??scene.GetViewport()).FindWorld3D().DirectSpaceState;
        var nodes=BakedWorld.All(scene).ToArray();int samples=0;
        var obstructionRegions=new Dictionary<Rid,List<Aabb>>();
        foreach(var gate in RuienNetworkGates.Read().Specs.Where(g=>!g.Flush))
        {
            var frame=nodes.OfType<Node3D>().Single(n=>n.Name=="gate_"+gate.Id);
            if(Scheldemist.Movers.Boats.I is {} liveBoats)
            {
                var apron=ApronStations(gate.Kit,gate.Sill);samples+=apron.Length;
                if(ApronHit(liveBoats,apron,frame.GlobalTransform) is {} hit)
                    errors.Add(new{id="gate-apron/"+gate.Id,error="gate apron intersects a boat hull",tide=Tide.River,hit});
            }
            var exclude=new Godot.Collections.Array<Rid>(BakedWorld.All(frame).OfType<CollisionObject3D>().Select(b=>b.GetRid()));
            using var markers=JsonDocument.Parse(Godot.FileAccess.GetFileAsString(gate.Kit+"/markers.json"));
            foreach(var mover in markers.RootElement.GetProperty("movers").EnumerateArray())
            {
                string id=mover.GetProperty("id").GetString()!;
                var collision=ResourceLoader.Load<ConcavePolygonShape3D>(gate.Kit+"/"+mover.GetProperty("collision").GetString());
                var faces=collision.GetFaces();
                using var hull=new ConvexPolygonShape3D{Points=faces};
                // Moored hulls use Boats.HullIn rather than Solid. Include their
                // measured, tapered hull columns in the gate's swept clearance.
                var stations=Stations(faces,out var bounds);
                var p=mover.GetProperty("pivot");var pivot=new Vector3(p[0].GetSingle(),p[1].GetSingle(),p[2].GetSingle());
                float degrees=mover.GetProperty("openDeg").GetSingle();
                for(int step=0;step<=32;step++)
                {
                    float fraction=step/32f;var basis=new Basis(Vector3.Up,Mathf.DegToRad(degrees*fraction));
                    using var query=new PhysicsShapeQueryParameters3D{Shape=hull,Margin=0,CollisionMask=Solid.Layer,Exclude=exclude,
                        Transform=frame.GlobalTransform*new Transform3D(basis,pivot-basis*pivot)};
                    var hits=space.IntersectShape(query,32);samples++;
                    if(Scheldemist.Movers.Boats.I is {} boats && (!gate.Held || step==0))
                    {
                        foreach(var station in stations)
                        {
                            var low=query.Transform*new Vector3(station.X,bounds.Position.Y,station.Y);
                            var high=query.Transform*new Vector3(station.X,bounds.End.Y,station.Y);
                            samples++;
                            if(!boats.HullIn(low.X,low.Z,.075f,low.Y,high.Y,out var boatFrame))continue;
                            errors.Add(new{id="gate-hull/"+gate.Id+"/"+id,error="gate leaf overlaps a boat hull",fraction,tide=Tide.River,
                                at=low.ToString(),boatAt=boatFrame.Origin.ToString()});
                            break;
                        }
                    }
                    if(hits.Count==0)continue;
                    foreach(var hit in hits)
                    {
                        var rid=hit["rid"].AsRid();
                        if(!obstructionRegions.TryGetValue(rid,out var regions))obstructionRegions[rid]=regions=new();
                        var region=frame.GlobalTransform*new Aabb(new Vector3(-4.5f,-6.5f,-5),new Vector3(9,7.5f,7));
                        if(!regions.Contains(region))regions.Add(region);
                    }
                    errors.Add(new{id="gate-swing/"+gate.Id+"/"+id,error="gate leaf overlaps surrounding town",fraction,
                        hits=hits.Select(h=>(h["collider"].AsGodotObject() as Node)?.GetPath().ToString()
                            ??Solid.I.BodyName(h["rid"].AsRid())).Distinct().ToArray(),
                        contacts=space.CollideShape(query,4).Select(v=>v.ToString()).ToArray()});
                }
            }
        }
        if(Scheldemist.Main.I?.Arg("ruien-gate-collision-out") is {Length:>0} output)
        {
            var geometry=new List<object>();
            foreach(var (body,regions) in obstructionRegions)
            {
                var xf=PhysicsServer3D.BodyGetState(body,PhysicsServer3D.BodyState.Transform).AsTransform3D();
                for(int i=0;i<PhysicsServer3D.BodyGetShapeCount(body);i++)
                {
                    var shape=PhysicsServer3D.BodyGetShape(body,i);
                    if(PhysicsServer3D.ShapeGetType(shape)!=PhysicsServer3D.ShapeType.ConcavePolygon)continue;
                    var data=PhysicsServer3D.ShapeGetData(shape).AsGodotDictionary();
                    var points=data["faces"].AsVector3Array();var pose=xf*PhysicsServer3D.BodyGetShapeTransform(body,i);
                    var kept=new List<float[]>();
                    for(int t=0;t+2<points.Length;t+=3)
                    {
                        var a=pose*points[t];var b=pose*points[t+1];var c=pose*points[t+2];
                        var bounds=new Aabb(a,Vector3.Zero).Expand(b).Expand(c).Grow(.002f);
                        if(!regions.Any(r=>r.Intersects(bounds)))continue;
                        foreach(var v in new[]{a,b,c})kept.Add(new[]{v.X,v.Y,v.Z});
                    }
                    geometry.Add(new{name=Solid.I.BodyName(body),shape=i,faces=kept});
                }
            }
            System.IO.File.WriteAllText(Scheldemist.Paths.Absolute(output),JsonSerializer.Serialize(geometry));
        }
        return samples;
    }
}
