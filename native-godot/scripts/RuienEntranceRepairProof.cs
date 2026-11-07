using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.World;
using Scheldemist.World.Ruien;

public partial class RuienEntranceRepairProof : Node3D
{
    public override async void _Ready()
    {
        try
        {
            var data=RuienData.Load();var area=data.Areas.Single(a=>a.Id=="o2");
            if(area.Ways.Any(w=>!w.Retired && w.Kind is "stair" or "keeper_stair" or "ladder"))throw new Exception("O2 still has road access");
            if(RuienEntrance.All.Any(s=>s.Id=="re29_sint_paulus"))throw new Exception("street house still active");
            var s=RuienEntrance.All.Single(s=>s.Id=="o2_vleeshuis_door");
            var records=new List<object>();
            foreach(var house in RuienEntrance.All.Where(e=>e.House))
            {
                var n=RuienStairHouse.Build(house);var mesh=(ArrayMesh)n.GetNode<MeshInstance3D>("shell").Mesh;
                int slate=0;
                for(int k=0;k<mesh.GetSurfaceCount();k++)if(mesh.SurfaceGetName(k)=="house_slate")slate=mesh.SurfaceGetArrays(k)[(int)Mesh.ArrayType.Vertex].AsVector3Array().Length/3;
                if(slate<1000)throw new Exception("roof has no individual slates: "+house.Id);
                int wrong=0,triangles=0;
                for(int si=0;si<mesh.GetSurfaceCount();si++)
                {
                    var ar=mesh.SurfaceGetArrays(si);var v=ar[(int)Mesh.ArrayType.Vertex].AsVector3Array();var ns=ar[(int)Mesh.ArrayType.Normal].AsVector3Array();
                    var ix=ar[(int)Mesh.ArrayType.Index].AsInt32Array();if(ix.Length==0)ix=Enumerable.Range(0,v.Length).ToArray();
                    for(int k=0;k+2<ix.Length;k+=3)
                    {
                        var cross=(v[ix[k+1]]-v[ix[k]]).Cross(v[ix[k+2]]-v[ix[k]]);
                        if(cross.LengthSquared()<1e-14f)continue;triangles++;
                        if(cross.Dot(ns[ix[k]]+ns[ix[k+1]]+ns[ix[k+2]])>1e-9f)wrong++;
                    }
                }
                if(records.Count==0)
                {
                    var outputDir=Path.GetDirectoryName(OS.GetCmdlineUserArgs().First())!;
                    var uvDir=Path.Combine(outputDir,"uv");Directory.CreateDirectory(uvDir);
                    ResourceSaver.Save(mesh,Path.Combine(uvDir,"mesh_stair_house.res"));
                    RuienUv.Audit(uvDir,Path.Combine(outputDir,"roof-uv.json"));
                }
                if(wrong>0)throw new Exception($"shell winding/normal mismatch: {wrong}/{triangles}");
                records.Add(new{house=house.Id,slateTriangles=slate});n.Free();
            }
            ((List<RuienEntrance.Spec>)RuienEntrance.All).RemoveAll(e=>e.Id!=s.Id);
            var town=ResourceLoader.Load<PackedScene>("res://world/town/scene.tscn").Instantiate<Node3D>();AddChild(town);RuienEntrance.Cut(town);
            var loaded=RuienArea.Load(area)!;AddChild(loaded.Root);
            var spec=JsonDocument.Parse(Godot.FileAccess.GetFileAsString(RuienData.AreasFile)).RootElement.GetProperty("areas").EnumerateArray().Single(a=>a.GetProperty("id").GetString()=="o2");
            AddChild(RuienConnections.Build(spec,area));
            foreach(var way in area.Ways.Where(w=>w.Retired))AddChild(RuienStreetClosure.Cap(way));
            var body=new StaticBody3D{CollisionLayer=Solid.Layer,CollisionMask=0};body.AddChild(new CollisionShape3D{Shape=loaded.Shape});AddChild(body);
            var entrance=RuienEntrance.Build(s);var leaf=entrance.GetNode("door");entrance.RemoveChild(leaf);leaf.Free();AddChild(entrance);
            var region=s.Local*new Aabb(new Vector3(-3,-5,-10),new Vector3(6,10,12));
            foreach(var mi in BakedWorld.All(town).OfType<MeshInstance3D>())
            {
                if(mi.Mesh==null||!(mi.GlobalTransform*mi.GetAabb()).Intersects(region))continue;
                var faces=mi.Mesh.HasMeta("native_solid_stand_in")?mi.Mesh.GetMeta("native_solid_stand_in").AsVector3Array():mi.Mesh.GetFaces();
                var near=new List<Vector3>();
                for(int i=0;i+2<faces.Length;i+=3)
                {
                    var a=mi.GlobalTransform*faces[i];var b=mi.GlobalTransform*faces[i+1];var c=mi.GlobalTransform*faces[i+2];
                    if(new Aabb(a,Vector3.Zero).Expand(b).Expand(c).Intersects(region))near.AddRange(new[]{a,b,c});
                }
                if(near.Count==0)continue;
                var solid=new StaticBody3D{Name="town_"+mi.Name,CollisionLayer=Solid.Layer,CollisionMask=0};
                solid.AddChild(new CollisionShape3D{Shape=new ConcavePolygonShape3D{Data=near.ToArray(),BackfaceCollision=true}});AddChild(solid);
            }
            for(int i=0;i<5;i++)await ToSignal(GetTree(),SceneTree.SignalName.PhysicsFrame);
            DumpCeilingRays(Path.GetDirectoryName(OS.GetCmdlineUserArgs().First())!);
            var points=new List<Vector3>();
            foreach(var local in s.Route)points.Add(s.World(local));
            var link=RuienEntrance.LinkFrame(s);points.Add(link.Origin);points.Add(link*new Vector3(0,0,s.ConnectLength));
            var blocked=new List<object>();int count=0;
            for(int k=0;k+1<points.Count;k++)
            {
                int n=Math.Max(1,(int)MathF.Ceiling(points[k].DistanceTo(points[k+1])/.15f));
                for(int i=0;i<=n;i++)
                {
                    var feet=points[k].Lerp(points[k+1],i/(float)n);count++;
                    var floor=GetWorld3D().DirectSpaceState.IntersectRay(PhysicsRayQueryParameters3D.Create(feet+Vector3.Up*.5f,feet-Vector3.Up*1.0f,Solid.Layer));
                    if(floor.Count>0)feet.Y=floor["position"].AsVector3().Y;
                    else {blocked.Add(new{feet=feet.ToString(),hits=new[]{"no floor"}});continue;}
                    var q=new PhysicsShapeQueryParameters3D{Shape=new CylinderShape3D{Radius=.32f,Height=1.39f},Transform=new Transform3D(Basis.Identity,feet+Vector3.Up*1.105f),CollisionMask=Solid.Layer,Margin=0};
                    var hits=GetWorld3D().DirectSpaceState.IntersectShape(q,12);
                    if(hits.Count>0)blocked.Add(new{feet=feet.ToString(),hits=hits.Select(h=>(h["collider"].AsGodotObject() as Node)?.Name.ToString()).ToArray()});
                }
            }
            if(OS.GetCmdlineUserArgs().Length>1)
            {
                var routes=JsonDocument.Parse(File.ReadAllText(OS.GetCmdlineUserArgs()[1])).RootElement.GetProperty("routes");
                foreach(var route in routes.EnumerateArray())
                {
                    var start=route.GetProperty("start");float y=route.GetProperty("y").GetSingle();
                    var path=new List<Vector3>{new(start[0].GetSingle(),y,start[2].GetSingle())};
                    path.AddRange(route.GetProperty("points").EnumerateArray().Select(p=>new Vector3(p[0].GetSingle(),y,p[1].GetSingle())));
                    for(int k=0;k+1<path.Count;k++)
                    {
                        int n=(int)MathF.Ceiling(path[k].DistanceTo(path[k+1])/.10f);
                        for(int i=0;i<=n;i++)
                        {
                            var feet=path[k].Lerp(path[k+1],i/(float)n);count++;
                            var floor=GetWorld3D().DirectSpaceState.IntersectRay(PhysicsRayQueryParameters3D.Create(feet+Vector3.Up*.5f,feet-Vector3.Up*1.0f,Solid.Layer));
                            if(floor.Count==0||MathF.Abs(floor["position"].AsVector3().Y-y)>.12f){blocked.Add(new{feet=feet.ToString(),hits=new[]{"not at the dry walkway level"}});continue;}
                            feet.Y=floor["position"].AsVector3().Y;
                            var q=new PhysicsShapeQueryParameters3D{Shape=new CylinderShape3D{Radius=.32f,Height=1.39f},Transform=new Transform3D(Basis.Identity,feet+Vector3.Up*1.105f),CollisionMask=Solid.Layer,Margin=0};
                            var hits=GetWorld3D().DirectSpaceState.IntersectShape(q,12);
                            if(hits.Count>0)blocked.Add(new{feet=feet.ToString(),hits=hits.Select(h=>(h["collider"].AsGodotObject() as Node)?.Name.ToString()).ToArray()});
                        }
                    }
                }
            }
            if(OS.GetCmdlineUserArgs().Length>2)
            {
                var grid=new List<object>();
                for(float x=-160.1f;x<=-152.0f;x+=.1f)for(float z=131.0f;z<=138.1f;z+=.1f)
                {
                    var hit=GetWorld3D().DirectSpaceState.IntersectRay(PhysicsRayQueryParameters3D.Create(new Vector3(x,-3.05f,z),new Vector3(x,-6.5f,z),Solid.Layer));
                    float? y=hit.Count>0?hit["position"].AsVector3().Y:null;
                    bool free=false;
                    if(y.HasValue && MathF.Abs(y.Value+3.6f)<.12f)
                    {
                        var q=new PhysicsShapeQueryParameters3D{Shape=new CylinderShape3D{Radius=.32f,Height=1.39f},Transform=new Transform3D(Basis.Identity,new Vector3(x,y.Value+1.105f,z)),CollisionMask=Solid.Layer,Margin=0};
                        free=GetWorld3D().DirectSpaceState.IntersectShape(q,4).Count==0;
                    }
                    grid.Add(new{x,z,y,free});
                }
                File.WriteAllText(OS.GetCmdlineUserArgs()[2],JsonSerializer.Serialize(grid));
            }
            var output=OS.GetCmdlineUserArgs().FirstOrDefault()??"user://entrance-repair.json";
            File.WriteAllText(ProjectSettings.GlobalizePath(output),JsonSerializer.Serialize(new{samples=count,blocked,roofs=records},new JsonSerializerOptions{WriteIndented=true}));
            GD.Print($"ENTRANCE REPAIR PROOF {(blocked.Count==0?"PASS":"FAIL")}: {blocked.Count}/{count} blocked samples");
            GetTree().Quit(blocked.Count==0?0:1);
        }
        catch(Exception e){GD.PushError(e.ToString());GetTree().Quit(1);}
    }

    private void DumpCeilingRays(string output)
    {
        var eye=new Vector3(-156.3f,-4.25f,134.5f);
        var basis=Basis.FromEuler(new Vector3(Mathf.DegToRad(12.094757f),-Mathf.Pi/2,0),EulerOrder.Yxz);
        var rows=new List<object>();
        foreach(var pixel in new[]{new Vector2(600,3),new Vector2(600,83),new Vector2(645,80),new Vector2(580,80)})
        {
            float tan=MathF.Tan(Mathf.DegToRad(75)/2);
            var direction=basis*new Vector3((pixel.X/600-1)*1.5f*tan,(1-pixel.Y/400)*tan,-1).Normalized();
            var hits=new List<(float distance,string node,Vector3 at,bool front)>();
            foreach(var mi in BakedWorld.All(this).OfType<MeshInstance3D>())
            {
                if(mi.Mesh==null || !mi.IsVisibleInTree())continue;
                var bounds=mi.GlobalTransform*mi.GetAabb();
                if(!bounds.Grow(.01f).IntersectsSegment(eye,eye+direction*20))continue;
                var faces=mi.Mesh.GetFaces();
                for(int k=0;k+2<faces.Length;k+=3)
                {
                    var a=mi.GlobalTransform*faces[k];var b=mi.GlobalTransform*faces[k+1];var c=mi.GlobalTransform*faces[k+2];
                    var hit=Geometry3D.RayIntersectsTriangle(eye,direction,a,b,c);
                    if(hit.VariantType==Variant.Type.Nil)continue;
                    var at=hit.AsVector3();float distance=eye.DistanceTo(at);if(distance>20)continue;
                    hits.Add((distance,mi.GetPath().ToString(),at,(b-a).Cross(c-a).Dot(direction)>0));
                }
            }
            if(!hits.Any(h=>h.front && h.node.Contains("sealed_vleeshuis_hatch",StringComparison.Ordinal)))
                throw new Exception("retired hall opening still has a sky sightline at "+pixel);
            rows.Add(new{pixel=pixel.ToString(),direction=direction.ToString(),hits=hits.OrderBy(h=>h.distance).Take(8).Select(h=>new{h.distance,h.node,at=h.at.ToString(),h.front}).ToArray()});
        }
        File.WriteAllText(Path.Combine(output,"ceiling-rays.json"),JsonSerializer.Serialize(rows,new JsonSerializerOptions{WriteIndented=true}));
    }
}
