using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.World;

// Read-only survey of the actual native town, before any new gate or buried-room promotion.
public partial class RuienConstructionSurvey : Node
{
    private static Transform3D Frame(Node3D node)
    {
        var xf=Transform3D.Identity;for(Node? n=node;n is Node3D p;n=n.GetParent())xf=p.Transform*xf;return xf;
    }
    private static Vector3 Closest(Vector3 p,Vector3 a,Vector3 b,Vector3 c)
    {
        var ab=b-a;var ac=c-a;var ap=p-a;float d1=ab.Dot(ap),d2=ac.Dot(ap);
        if(d1<=0&&d2<=0)return a;var bp=p-b;float d3=ab.Dot(bp),d4=ac.Dot(bp);
        if(d3>=0&&d4<=d3)return b;float vc=d1*d4-d3*d2;
        if(vc<=0&&d1>=0&&d3<=0)return a+ab*(d1/(d1-d3));
        var cp=p-c;float d5=ab.Dot(cp),d6=ac.Dot(cp);
        if(d6>=0&&d5<=d6)return c;float vb=d5*d2-d1*d6;
        if(vb<=0&&d2>=0&&d6<=0)return a+ac*(d2/(d2-d6));
        float va=d3*d6-d5*d4;if(va<=0&&d4-d3>=0&&d5-d6>=0)return b+(c-b)*((d4-d3)/((d4-d3)+(d5-d6)));
        float inv=1/(va+vb+vc);return a+ab*(vb*inv)+ac*(vc*inv);
    }
    public override void _Ready()
    {
        try
        {
            var args=OS.GetCmdlineUserArgs();string Arg(string key)=>args[Array.IndexOf(args,key)+1];
            using var planDoc=JsonDocument.Parse(File.ReadAllText(Arg("--plan")));var plan=planDoc.RootElement;
            using var timing=Scheldemist.Dev.StartupTiming.Split("ruien.construction-survey");
            var town=ResourceLoader.Load<PackedScene>("res://world/town/scene.tscn").Instantiate<Node3D>();
            timing?.Next("load-town");var nodes=BakedWorld.All(town).ToArray();
            var meshes=nodes.OfType<MeshInstance3D>().Where(m=>m.Mesh!=null).Select(m=>(node:m,xf:Frame(m),box:Frame(m)*m.Mesh!.GetAabb())).ToArray();
            var read=new Dictionary<Mesh,Vector3[]>();Vector3[] Faces(Mesh m){if(!read.TryGetValue(m,out var f))read[m]=f=m.GetFaces();return f;}
            var gates=new List<object>();
            foreach(var gate in plan.GetProperty("gates").EnumerateArray())
            {
                string id=gate.GetProperty("id").GetString()!;var at=gate.GetProperty("at");var target=new Vector3(at[0].GetSingle(),id=="F1"?-1.0f:-3.5f,at[1].GetSingle());
                float radius=id is "O1" or "F1"?60:12;
                var found=new List<(string name,string path,float distance,Vector3 at,Vector3 normal,Aabb box)>();
                foreach(var item in meshes)
                {
                    string name=item.node.Name.ToString();
                    if(!item.box.Grow(radius).HasPoint(target)||id is not ("O1" or "F1")&&(item.box.Position.Y> -1.3f||item.box.End.Y< -4.5f))continue;
                    if(!new[]{"quay","canal","vliet","moat","bassin","basin","wall","steen"}.Any(k=>name.Contains(k,StringComparison.OrdinalIgnoreCase)))continue;
                    var p=Faces(item.node.Mesh!);float best=float.MaxValue;Vector3 hit=default,normal=default;
                    for(int i=0;i+2<p.Length;i+=3)
                    {
                        var a=item.xf*p[i];var b=item.xf*p[i+1];var c=item.xf*p[i+2];var n=(b-a).Cross(c-a);
                        if(n.LengthSquared()<1e-10f)continue;n=n.Normalized();if(MathF.Abs(n.Y)>.3f)continue;
                        var q=Closest(target,a,b,c);float d=q.DistanceTo(target);
                        if(d<best){best=d;hit=q;normal=n;}
                    }
                    if(best<radius)found.Add((name,town.GetPathTo(item.node).ToString(),best,hit,normal,item.box));
                }
                var nearest=found.OrderBy(f=>f.distance).Take(12).ToArray();
                gates.Add(new{id,planned=new[]{target.X,target.Z},walls=found.Where(f=>f.name=="quay_walls"||nearest.Contains(f)).OrderBy(f=>f.distance).Select(f=>new{f.name,f.path,f.distance,at=new[]{f.at.X,f.at.Y,f.at.Z},normal=new[]{f.normal.X,f.normal.Y,f.normal.Z},min=new[]{f.box.Position.X,f.box.Position.Y,f.box.Position.Z},max=new[]{f.box.End.X,f.box.End.Y,f.box.End.Z}}).ToArray()});
                GD.Print($"RUIEN SURVEY gate {id}: {found.Count} nearby native wall meshes");
            }
            timing?.Next("survey-gates");
            var cellars=new List<object>();
            foreach(var room in nodes.OfType<Node3D>().Where(n=>n.Name.ToString().StartsWith("ROOM_")))
            {
                var parts=meshes.Where(m=>room==m.node||room.IsAncestorOf(m.node)).ToArray();if(parts.Length==0)continue;
                var low=new List<Vector3>();
                foreach(var part in parts)
                    foreach(var p in Faces(part.node.Mesh!)){var world=part.xf*p;if(world.Y<-.9f)low.Add(world);}
                if(low.Count==0)continue;
                var box=new Aabb(low[0],Vector3.Zero);foreach(var p in low.Skip(1))box=box.Expand(p);
                var paths=new HashSet<string>();
                foreach(var route in plan.GetProperty("routes").EnumerateObject())
                {
                    float hw=route.Value.GetProperty("class").GetString()=="G"?3:1.8f;
                    var p=route.Value.GetProperty("pts").EnumerateArray().Select(q=>new Vector2(q[0].GetSingle(),q[1].GetSingle())).ToArray();
                    var rect=new Rect2(box.Position.X-hw-.5f,box.Position.Z-hw-.5f,box.Size.X+2*hw+1,box.Size.Z+2*hw+1);
                    for(int i=0;i+1<p.Length;i++)
                    {
                        var lo=p[i].Min(p[i+1]);var hi=p[i].Max(p[i+1]);
                        if(rect.Intersects(new Rect2(lo,hi-lo).Grow(.01f))){paths.Add(route.Name);break;}
                    }
                }
                cellars.Add(new{id=room.Name.ToString(),min=new[]{box.Position.X,box.Position.Y,box.Position.Z},max=new[]{box.End.X,box.End.Y,box.End.Z},nearRoutes=paths.Order().ToArray()});
            }
            var ladders=meshes.Where(m=>m.node.Name.ToString().StartsWith("quay_iron")).SelectMany(m=>QuayExits.FindLadders(m.node,m.xf))
                .Select(l=>new{x=l.X,z=l.Z,nx=l.Nx,nz=l.Nz,l.Foot}).ToArray();
            var flights=QuayExits.AuthoredFlightRuns.Select(f=>new{from=new[]{f.From.X,f.From.Y},to=new[]{f.To.X,f.To.Y}}).ToArray();
            File.WriteAllText(Arg("--out"),JsonSerializer.Serialize(new{gates,cellars,ladders,flights},new JsonSerializerOptions{WriteIndented=true}));
            town.Free();GD.Print($"RUIEN CONSTRUCTION SURVEY COMPLETE: {gates.Count} gates, {cellars.Count} underground room bounds");GetTree().Quit();
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
}
