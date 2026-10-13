using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.Models;
using Scheldemist.Render;
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.People;

public partial class NativeMarket
{
    private void ReadModel(string source)
    {
        var model=ModelLibrary.Get(source,new(TwoSided:true,VertexColor:true));if(model==null)return;
        foreach(var root in model.Roots){var found=new List<ModelPart>();var pts=new List<double>();
            void Read(Node node,Transform3D local){if(node is MeshInstance3D mi&&mi.Mesh!=null)for(int surface=0;surface<mi.Mesh.GetSurfaceCount();surface++){
                var mat=mi.GetActiveMaterial(surface);string name=mat?.ResourceName??"";if(source=="stalls"&&name=="stall_sign")continue;if(mat!=null)materials[name]=mat;
                var arrays=mi.Mesh.SurfaceGetArrays(surface);var vertices=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();if(name!="market_mud")foreach(var vertex in vertices){var p=local*vertex;pts.Add(p.X);pts.Add(p.Y);pts.Add(p.Z);}
                var mesh=new ArrayMesh{ResourceName=source+"_"+root.Key+"_"+surface};mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,arrays);mesh.SurfaceSetMaterial(0,mat);found.Add(new(mesh,local,name));
            }foreach(var child in node.GetChildren())Read(child,child is Node3D n?local*n.Transform:local);}
            Read(root.Value,Transform3D.Identity);parts[(source,root.Key)]=found;modelPoints[(source,root.Key)]=pts.ToArray();
        }
    }
    private Material Colour(Material material)
    {
        if(coloured.TryGetValue(material,out var result))return result;result=(Material)material.Duplicate();
        if(result is ShaderMaterial shader&&Psx.KindOf(shader.Shader)is{} kind)shader.Shader=Psx.ShaderOf(kind with{VertexColor=true});
        else if(result is BaseMaterial3D baseMaterial)baseMaterial.VertexColorUseAsAlbedo=true;
        coloured[material]=result;return result;
    }
    private List<NativeMarketCircle> Circles()
    {
        var result=new List<NativeMarketCircle>();var data=town.Data!;
        var city=JsonNode.Parse(File.ReadAllText(Paths.Shared("city.json")))!;foreach(string key in new[]{"lamps","trees"})if(city["decor"]?[key]is JsonArray list)foreach(var p in list)result.Add(new(N(p![0]),N(p[1]),.9));
        var spots=JsonNode.Parse(File.ReadAllText(Paths.Shared("spots.json")))!.AsObject();foreach(var p in spots)if(!p.Key.StartsWith("_")&&p.Value is JsonObject o&&o["x"]!=null&&o["z"]!=null)result.Add(new(N(o["x"]),N(o["z"]),2.4));
        foreach(var r in data.Residents){result.Add(new(r.HomeX,r.HomeZ,2.6));foreach(var p in new[]{r.Work.A,r.Work.B})if(p is{} at)result.Add(new(at.X,at.Z,1.7));if(r.Work.At is{Length:>=2} w&&r.Work.Kind!="stall")result.Add(new(w[0],w[1],1.5));}
        foreach(var p in data.Places.Values)result.Add(new(p.X,p.Z,1.6));return result;
    }
    private void Build()
    {
        if(parts.Count==0){ReadModel("stalls");ReadModel("trades");}if(parts.Count==0){built=true;return;}
        definitions=JsonNode.Parse(File.ReadAllText(Path.Combine(Paths.NativeDataRoot??Paths.Root,"services","native-extras.json")))!.AsObject();layout=new(definitions,(s,n)=>parts.ContainsKey((s,n)),(s,n)=>modelPoints.GetValueOrDefault((s,n))??Array.Empty<double>(),materials.Keys);
        var circles=Circles();var lanes=definitions["marketLanes"]!.AsArray().Select(n=>Rect(n!)).ToArray();var tracks=definitions["marketTracks"]!.AsArray().Select(n=>Rect(n!)).ToArray();
        town.Walk!.RefreshBodies();
        foreach(var row in definitions["fields"]!.AsArray()){var def=row!.AsObject();string place=S(def["place"]);var own=circles.ToList();foreach(var s in town.Data!.Stalls)if(s.Place==place){own.Add(new(s.X,s.Z,2));own.Add(new(s.X+s.Face.X*1.4,s.Z+s.Face.Z*1.4,1.2));own.Add(new(s.X-s.Face.X*1.2,s.Z-s.Face.Z*1.2,1));}
            var f=new Field{Definition=def,Place=place,Centre=new(N(def["centre"]![0]),N(def["centre"]![1])),Entries=def["entries"]!.AsArray().Select(p=>new NativeMarketPoint(N(p![0]),N(p[1]))).ToArray(),Group=new(){Name="market_"+place}};
            f.Items=layout.Layout(def,own,Array.Empty<NativeMarketRect>(),lanes,tracks,(x,z)=>town.Walk.Free(x,z)?0:1);Main.I.View.AddChild(f.Group);BuildBatches(f);BuildBodies(f);fields.Add(f);
        }built=true;
    }
    private void BuildBatches(Field f)
    {
        var batches=new Dictionary<(Mesh,Material?),Batch>();
        void Put(string source,string name,double x,double y,double z,double yaw,double[] scale,double[]? tint,string? awning,int rank){
            if(!parts.TryGetValue((source,name),out var list))return;var at=new Transform3D(new Basis(Vector3.Up,(float)yaw).Scaled(new((float)scale[0],(float)scale[1],(float)scale[2])),new((float)x,(float)y,(float)z));
            foreach(var p in list){var original=p.Mesh.SurfaceGetMaterial(0);var material=awning!=null&&p.Material=="awning_red"?materials.GetValueOrDefault(awning)??original:original;if(material!=null)material=Colour(material);var key=(p.Mesh,material);if(!batches.TryGetValue(key,out var b))batches[key]=b=new(){Mesh=new(){TransformFormat=MultiMesh.TransformFormatEnum.Transform3D,UseColors=true,Mesh=p.Mesh},Node=new(){MaterialOverride=material}};b.Rows.Add((rank,at*p.Local,tint==null?Colors.White:new((float)tint[0],(float)tint[1],(float)tint[2],1)));}
        }
        foreach(var item in f.Items){double c=Math.Cos(item.Yaw),s=Math.Sin(item.Yaw);foreach(var q in item.Puts)Put(q.Source,q.Name,item.X+q.U*c+q.V*s,q.Y+town.Walk!.BaseAt(item.X,item.Z),item.Z-q.U*s+q.V*c,item.Yaw+q.Yaw,q.Scale,q.Tint,q.Awning,item.Rank);}
        foreach(var l in f.Definition["litter"]!.AsArray())Put("trades",S(l![0]),N(l[1]),town.Walk!.BaseAt(N(l[1]),N(l[2])),N(l[2]),N(l[3]),new[]{1.0,1,1},null,null,-1);
        foreach(var b in batches.Values){b.Mesh.InstanceCount=b.Rows.Count;b.Mesh.VisibleInstanceCount=0;b.Node.Multimesh=b.Mesh;f.Group.AddChild(b.Node);f.Batches.Add(b);}
    }
    private void BuildBodies(Field f)
    {
        foreach(var item in f.Items){var bodies=new List<StaticBody3D>();foreach(var r in item.Rects){double height=Math.Max(.05,r.Top);var size=new Vector3((float)Math.Max(.01,r.MaxX-r.MinX),(float)height,(float)Math.Max(.01,r.MaxZ-r.MinZ));var body=new StaticBody3D{CollisionLayer=0,CollisionMask=0,Visible=false,Position=new((float)((r.MinX+r.MaxX)/2),(float)(town.Walk!.BaseAt(item.X,item.Z)+height/2),(float)((r.MinZ+r.MaxZ)/2))};body.AddChild(new CollisionShape3D{Shape=new BoxShape3D{Size=size}});body.SetMeta("held_by",$"a market {item.Kind} ({item.Goods}) at {item.X:0.0}, {item.Z:0.0}");f.Group.AddChild(body);WalkMap.RegisterBody(body,new Aabb(-size/2,size));bodies.Add(body);}f.Bodies[item]=bodies.ToArray();}
    }
    private void Window(Field f,int low,int high)
    {
        if(f.Low==low&&f.High==high)return;f.Low=low;f.High=high;
        foreach(var b in f.Batches){int n=0;foreach(var row in b.Rows)if(row.Rank<0||row.Rank>=low&&row.Rank<high){b.Mesh.SetInstanceTransform(n,row.Transform);b.Mesh.SetInstanceColor(n,row.Tint);n++;}b.Mesh.VisibleInstanceCount=n;b.Node.Visible=n>0;}
        foreach(var pair in f.Bodies){bool up=pair.Key.Rank>=low&&pair.Key.Rank<high;foreach(var body in pair.Value){body.Visible=up;body.CollisionLayer=up?Solid.Layer:0;}}
        town.Walk!.RefreshBodies();
    }
}
