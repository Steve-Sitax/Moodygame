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
    private void PrepareMaterials()
    {
        // Native markets arrive after asynchronous population loading. Prepare their existing tint variants
        // before frame one, with hidden references for the inventory; no stalls or extra draws are added.
        // (#180) and the fish laid on the fish tables: the herring of the work goods, the cod and plaice of the small goods
        ReadModel("stalls"); ReadModel("trades"); ReadModel("workgoods"); ReadModel("smallgoods"); FishOnTheTable();
        int i = 0;
        foreach (var material in materials.Values)
            AddChild(new MeshInstance3D { Name = "prepared_market_material_" + i++, Visible = false, Mesh = new QuadMesh { Material = Colour(material) } });
    }
    private void ReadModel(string source)
    {
        var model=ModelLibrary.Get(source,new(TwoSided:true,VertexColor:true));if(model==null)return;
        foreach(var root in model.Roots){var found=new List<ModelPart>();var pts=new List<double>();var spots=new List<MarketCatch.Spot>();
            void Read(Node node,Transform3D local){if(node is MeshInstance3D mi&&mi.Mesh!=null)for(int surface=0;surface<mi.Mesh.GetSurfaceCount();surface++){
                var mat=mi.GetActiveMaterial(surface);string name=mat?.ResourceName??"";if(source=="stalls"&&name=="stall_sign")continue;if(mat!=null)materials[name]=mat;
                var arrays=mi.Mesh.SurfaceGetArrays(surface);if(source=="stalls"&&root.Key=="mk2_fish_table")arrays=WithoutTableFish(arrays,local,name);arrays=MarketCatch.Take(source,root.Key,arrays,local,name,spots);if(MarketCatch.Empty(arrays))continue;var vertices=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();if(name!="market_mud")foreach(var vertex in vertices){var p=local*vertex;pts.Add(p.X);pts.Add(p.Y);pts.Add(p.Z);}
                var mesh=new ArrayMesh{ResourceName=source+"_"+root.Key+"_"+surface};mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,arrays);mesh.SurfaceSetMaterial(0,mat);found.Add(new(mesh,local,name));
            }foreach(var child in node.GetChildren())Read(child,child is Node3D n?local*n.Transform:local);}
            Read(root.Value,Transform3D.Identity);parts[(source,root.Key)]=found;modelPoints[(source,root.Key)]=pts.ToArray();if(spots.Count>0)catches[(source,root.Key)]=spots;
        }
    }
    /// <summary>
    /// #180: the fish table's own coarse fish (build_stalls.py mk2_fish_table: fifteen herring and three cod drawn on the goods
    /// atlas's herring and cod cells, and a plaice turned on the detail atlas) come out of the table: the market lays the
    /// fish models on its ice instead (FishOnTheTable), the herring the fishwives hold and the cod and plaice of the small
    /// goods. The bed of ice and small fish, the eels in their basket and everything under the table stay.
    /// </summary>
    private static Godot.Collections.Array WithoutTableFish(Godot.Collections.Array arrays,Transform3D local,string material)
    {
        if(material is not("market_goods" or "market_detail"))return arrays;
        var v=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();var uv=arrays[(int)Mesh.ArrayType.TexUV].VariantType==Variant.Type.Nil?null:arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();
        var index=arrays[(int)Mesh.ArrayType.Index].VariantType==Variant.Type.Nil?Enumerable.Range(0,v.Length).ToArray():arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
        // the herring and cod cells: the goods atlas's bottom row's first two 32 px cells (u 0-0.5, v 0.75-1 once flipped)
        bool Fish(int i)=>uv!=null&&uv[i].X<.5f&&uv[i].Y>.75f;
        // the plaice: a turned disc 0.15 m round over the ice at (0.3, 0.26) of the table (game z -0.26), on the ice's top
        bool Plaice(int i){var p=local*v[i];return new Vector2(p.X-.3f,p.Z+.26f).Length()<.17f&&p.Y>.845f;}
        var keep=new List<int>(index.Length);int taken=0;
        for(int k=0;k+2<index.Length;k+=3)
        {
            bool fish=material=="market_goods"?Fish(index[k])&&Fish(index[k+1])&&Fish(index[k+2]):Plaice(index[k])&&Plaice(index[k+1])&&Plaice(index[k+2]);
            if(fish){taken++;continue;}keep.Add(index[k]);keep.Add(index[k+1]);keep.Add(index[k+2]);
        }
        if(taken==0)return arrays;
        var copy=(Godot.Collections.Array)arrays.Duplicate();copy[(int)Mesh.ArrayType.Index]=keep.ToArray();FishTrianglesTaken+=taken;return copy;
    }
    /// <summary>What lies in a stall or trade model where its painted fish were (MarketCatch), by its source and name.</summary>
    private readonly Dictionary<(string,string),List<MarketCatch.Spot>> catches=new();
    private static string CatchName(string model)=>model switch{"herring"=>"mk_goods_fish_herring","cod"=>"mk_goods_fish_cod","ice_round"=>"mk_goods_ice_round",_=>"mk_goods_ice"};
    /// <summary>For the checks: how many of the table's own fish triangles were taken out.</summary>
    public static int FishTrianglesTaken{get;private set;}
    public static string FishModelsNote{get;private set;}="";
    /// <summary>The fish the table shows, lying as they lie on ice: the herring and the cod on their sides, the plaice flat,
    /// each the one model of its kind (the herring is the one the fishwives gut and hold).</summary>
    private void FishOnTheTable()
    {
        var side=new Transform3D(new Basis(Vector3.Right,MathF.PI/2),Vector3.Zero);
        void Lying(string source,string model,string name,Transform3D turn)
        {if(parts.TryGetValue((source,model),out var list)){parts[("catch",name)]=list.Select(p=>p with{Local=turn*p.Local}).ToList();modelPoints[("catch",name)]=Array.Empty<double>();}}
        FishModelsNote=string.Join(", ",parts.Keys.Where(k=>k.Item1 is "workgoods" or "smallgoods").Select(k=>k.Item1+"/"+k.Item2));
        Lying("workgoods","held_fish","mk_goods_fish_herring",side);
        Lying("smallgoods","cod","mk_goods_fish_cod",side);
        Lying("smallgoods","plaice","mk_goods_fish_plaice",Transform3D.Identity);
        // (#190) the crushed ice the stalls' fish lie on, in place of their painted heaps (MarketCatch)
        Lying("smallgoods","ice","mk_goods_ice",Transform3D.Identity);
        Lying("smallgoods","ice_round","mk_goods_ice_round",Transform3D.Identity);
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
        if(parts.Count==0){ReadModel("stalls");ReadModel("trades");ReadModel("workgoods");ReadModel("smallgoods");FishOnTheTable();}else if(!parts.ContainsKey(("catch","mk_goods_fish_herring"))){ReadModel("workgoods");ReadModel("smallgoods");FishOnTheTable();}if(parts.Count==0){built=true;return;}
        definitions=JsonNode.Parse(File.ReadAllText(Path.Combine(Paths.NativeDataRoot??Paths.Root,"services","native-extras.json")))!.AsObject();layout=new(definitions,(s,n)=>parts.ContainsKey((s,n)),(s,n)=>modelPoints.GetValueOrDefault((s,n))??Array.Empty<double>(),materials.Keys);
        var circles=Circles();var lanes=definitions["marketLanes"]!.AsArray().Select(n=>Rect(n!)).ToArray();var tracks=definitions["marketTracks"]!.AsArray().Select(n=>Rect(n!)).ToArray();
        town.Walk!.RefreshBodies();
        foreach(var row in definitions["fields"]!.AsArray()){var def=row!.AsObject();string place=S(def["place"]);var own=circles.ToList();foreach(var s in town.Data!.Stalls)if(s.Place==place){own.Add(new(s.X,s.Z,2));own.Add(new(s.X+s.Face.X*1.4,s.Z+s.Face.Z*1.4,1.2));own.Add(new(s.X-s.Face.X*1.2,s.Z-s.Face.Z*1.2,1));}
            var f=new Field{Definition=def,Place=place,Centre=new(N(def["centre"]![0]),N(def["centre"]![1])),Entries=def["entries"]!.AsArray().Select(p=>new NativeMarketPoint(N(p![0]),N(p[1]))).ToArray(),Group=new(){Name="market_"+place}};
            f.Items=layout.Layout(def,own,Array.Empty<NativeMarketRect>(),lanes,tracks,(x,z)=>town.Walk.Free(x,z)?0:1);f.Pitched=def["pitches"]!=null;f.Prefix=def["pitches"]?["prefix"]?.GetValue<string>()??SellerPrefix;f.Level=Enumerable.Repeat(-1,f.Items.Count).ToArray();Main.I.View.AddChild(f.Group);BuildBatches(f);BuildBodies(f);fields.Add(f);
        }built=true;
    }
    private void BuildBatches(Field f)
    {
        var batches=new Dictionary<(Mesh,Material?),Batch>();
        void Put(string source,string name,double x,double y,double z,double yaw,double[] scale,double[]? tint,string? awning,int rank){
            if(!parts.TryGetValue((source,name),out var list))return;var at=new Transform3D(new Basis(Vector3.Up,(float)yaw).Scaled(new((float)scale[0],(float)scale[1],(float)scale[2])),new((float)x,(float)y,(float)z));
            foreach(var p in list){var original=p.Mesh.SurfaceGetMaterial(0);var material=awning!=null&&p.Material=="awning_red"?materials.GetValueOrDefault(awning)??original:original;if(material!=null)material=Colour(material);var key=(p.Mesh,material);if(!batches.TryGetValue(key,out var b))batches[key]=b=new(){Mesh=new(){TransformFormat=MultiMesh.TransformFormatEnum.Transform3D,UseColors=true,Mesh=p.Mesh},Node=new(){MaterialOverride=material}};b.Rows.Add((rank,at*p.Local,tint==null?Colors.White:new((float)tint[0],(float)tint[1],(float)tint[2],1),Stage(name)));}
            // (#190) the fish models and the ice laid where the model's painted fish were: untinted, out with the goods
            if(catches.TryGetValue((source,name),out var laid))foreach(var spot in laid)if(parts.TryGetValue(("catch",CatchName(spot.Model)),out var fish))foreach(var p in fish){var original=p.Mesh.SurfaceGetMaterial(0);var material=original==null?null:Colour(original);var key=(p.Mesh,material);if(!batches.TryGetValue(key,out var b))batches[key]=b=new(){Mesh=new(){TransformFormat=MultiMesh.TransformFormatEnum.Transform3D,UseColors=true,Mesh=p.Mesh},Node=new(){MaterialOverride=material}};b.Rows.Add((rank,at*spot.At*p.Local,Colors.White,2));}
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
        var level=new int[f.Items.Count];for(int i=0;i<level.Length;i++)level[i]=i>=low&&i<high?2:-1;Show(f,level);
    }
    /// <summary>A stall is built and struck in three stages (#150): its frame (and the table or barrow itself), then its
    /// awning or cloth, then its goods.</summary>
    private static int Stage(string name)=>name.StartsWith("stall_goods_")||name.StartsWith("stall_more_")||name.StartsWith("mk2_goods_")||name.StartsWith("shop_goods_")||name.StartsWith("shop_more_")||name.StartsWith("mk_goods_")||name.StartsWith("mk_basket")||name is"mk2_fish_crates"or"mk_crates"or"mk_fishbox"or"mk_gull"or"mk2_ground_baskets"or"mk_leaves"or"mk2_under"?2
        :name is"stall_awning"or"stall_cloth"?1:0;
    /// <summary>Draw each stall (by rank) as far as its level: -1 down, 0 frame, 1 cover, 2 goods; its collision while any of it stands.</summary>
    private void Show(Field f,int[] level)
    {
        if(f.Shown.Length==level.Length&&f.Shown.AsSpan().SequenceEqual(level))return;
        bool bodies=f.Shown.Length!=level.Length;for(int i=0;i<level.Length&&!bodies;i++)bodies=f.Shown[i]>=0!=level[i]>=0;f.Shown=(int[])level.Clone();
        foreach(var b in f.Batches){int n=0;foreach(var row in b.Rows)if(row.Rank<0||row.Rank<level.Length&&level[row.Rank]>=row.Stage){b.Mesh.SetInstanceTransform(n,row.Transform);b.Mesh.SetInstanceColor(n,row.Tint);n++;}b.Mesh.VisibleInstanceCount=n;b.Node.Visible=n>0;}
        if(!bodies)return;
        foreach(var pair in f.Bodies){bool up=pair.Key.Rank<level.Length&&level[pair.Key.Rank]>=0;foreach(var body in pair.Value){body.Visible=up;body.CollisionLayer=up?Solid.Layer:0;}}
        town.Walk!.RefreshBodies();
    }
}
