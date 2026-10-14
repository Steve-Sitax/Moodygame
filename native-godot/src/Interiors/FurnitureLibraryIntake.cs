using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Godot;
using Scheldemist.Native.Authoring;
using Scheldemist.World;
namespace Scheldemist.Native.Interiors;
public partial class FurnitureLibraryIntake : Node
{
    public override void _Ready(){try{Build();GetTree().Quit();}catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}}
    private static readonly StandardMaterial3D Wood=new(){AlbedoColor=new Color("70503a"),Roughness=.85f};
    private static readonly StandardMaterial3D Iron=new(){AlbedoColor=new Color("292724"),Roughness=.8f,Metallic=.7f};
    private static readonly StandardMaterial3D Linen=new(){AlbedoColor=new Color("bdb59f"),Roughness=.95f};
    private void Build()
    {
        var catalog=new AuthorCatalog();
        foreach(string kind in new[]{"chair","stool","bench","settle","table","counter","shelf","cupboard","bed","stove","clock","cask","lamp"})
        {
            var root=new FurnitureVisual{Name=kind,Kind=kind}; Vector3 size=Vector3.One;float height=.46f;Vector3[] seats=Array.Empty<Vector3>();
            void Box(Vector3 dims,Vector3 at,Material? mat=null,float bevel=.003f){root.AddChild(new MeshInstance3D{Name="Part",Mesh=BevelBox(dims,bevel,mat??Wood),Position=at});}
            void Legs(float w,float d,float h){foreach(float x in new[]{-w/2,w/2})foreach(float z in new[]{-d/2,d/2})Box(new(.05f,h,.05f),new(x,h/2,z));}
            switch(kind)
            {
                case "chair":size=new(.46f,1,.46f);Box(new(.44f,.045f,.44f),new(0,.46f,0));Legs(.36f,.36f,.44f);foreach(float x in new[]{-.18f,.18f})Box(new(.045f,.52f,.045f),new(x,.74f,-.18f));foreach(float y in new[]{.65f,.91f})Box(new(.4f,.07f,.03f),new(0,y,-.18f));seats=new[]{Vector3.Zero};break;
                case "stool":size=new(.4f,.69f,.4f);height=.68f;Box(new(.4f,.04f,.4f),new(0,.66f,0));Legs(.3f,.3f,.64f);seats=new[]{Vector3.Zero};break;
                case "bench":case "settle":size=new(1.6f,kind=="settle"?1:.49f,.46f);Box(new(1.6f,.06f,.44f),new(0,.45f,0));Legs(1.4f,.32f,.42f);if(kind=="settle")Box(new(1.6f,.5f,.06f),new(0,.75f,-.19f));seats=new[]{new Vector3(-.4f,0,0),new Vector3(.4f,0,0)};break;
                case "table":size=new(1.2f,.8f,.9f);Box(new(1.2f,.06f,.9f),new(0,.77f,0));Legs(1.05f,.75f,.74f);break;
                case "counter":size=new(2.4f,1.1f,.65f);Box(new(2.35f,1.04f,.58f),new(0,.52f,0));Box(new(2.4f,.06f,.65f),new(0,1.07f,0));break;
                case "shelf":size=new(1.4f,1.8f,.35f);foreach(float x in new[]{-.67f,.67f})Box(new(.06f,1.8f,.35f),new(x,.9f,0));foreach(float y in new[]{.08f,.65f,1.2f,1.76f})Box(new(1.4f,.05f,.35f),new(0,y,0));break;
                case "cupboard":size=new(1.2f,1.8f,.5f);Box(size,new(0,.9f,0));foreach(float x in new[]{-.3f,.3f})Box(new(.57f,1.6f,.035f),new(x,.93f,.26f));break;
                case "bed":size=new(1.05f,.92f,2.05f);Box(new(1,.15f,2),new(0,.55f,0),Linen,.007f);Legs(.88f,1.85f,.48f);Box(new(1.05f,.65f,.055f),new(0,.59f,-1));Box(new(.6f,.08f,.38f),new(0,.665f,-.72f),Linen,.015f);break;
                case "stove":size=new(.62f,2.7f,.62f);Box(new(.62f,.07f,.62f),new(0,.035f,0),Iron,.003f);Box(new(.5f,.74f,.5f),new(0,.46f,0),Iron,.012f);Box(new(.59f,.04f,.59f),new(0,.85f,0),Iron);Box(new(.12f,1.8f,.12f),new(0,1.8f,-.12f),Iron,.004f);Box(new(.15f,.12f,.01f),new(0,.42f,.255f),new StandardMaterial3D{AlbedoColor=new Color("ad5426"),EmissionEnabled=true,Emission=new Color("ad5426"),EmissionEnergyMultiplier=.25f},.001f);break;
                case "clock":size=new(.45f,1.95f,.25f);Box(new(.4f,1.9f,.22f),new(0,.95f,0));Box(new(.45f,.05f,.25f),new(0,1.925f,0));Box(new(.3f,.3f,.012f),new(0,1.7f,.116f),Linen,.002f);
                    var dial=new Node3D{Name="clock_dial",Position=new(0,1.7f,.128f)};
                    foreach(var hand in new[]{(Name:"clock_hour_hand",Length:.07f),(Name:"clock_minute_hand",Length:.105f)})
                    {var pivot=new Node3D{Name=hand.Name};pivot.AddChild(new MeshInstance3D{Name="Hand",Mesh=BevelBox(new(.008f,hand.Length,.006f),.001f,Iron),Position=new(0,hand.Length/2,0)});dial.AddChild(pivot);}
                    root.AddChild(dial);break;
                                case "cask":
                    // Reuse the town's sole keg mesh, which is also used in carried loads.
                    var pack=ResourceLoader.Load<PackedScene>("res://assets/game-models/clutter.scn").Instantiate<Node3D>();
                    var keg=BakedWorld.All(pack).OfType<MeshInstance3D>().First(m=>m.Name.ToString()=="keg" || m.HasMeta("source_name")&&m.GetMeta("source_name").AsString()=="keg");
                    var kg=(MeshInstance3D)keg.Duplicate();kg.Transform=Transform3D.Identity;var kb=kg.GetAabb();kg.Position=new(-kb.GetCenter().X,-kb.Position.Y,-kb.GetCenter().Z);root.AddChild(kg);size=kb.Size;pack.Free();break;
                case "lamp":size=new(.24f,.5f,.24f);Box(new(.24f,.045f,.24f),new(0,.03f,0),Iron,.002f);Box(new(.15f,.12f,.15f),new(0,.13f,0),Iron);Box(new(.1f,.25f,.1f),new(0,.32f,0),Linen,.003f);break;
            }
            root.ModelSize=size;
            var body=new StaticBody3D{Name="Solid",CollisionLayer=2,CollisionMask=0};body.AddChild(new CollisionShape3D{Name="Shape",Shape=new BoxShape3D{Size=size},Position=new(0,size.Y/2,0)});root.AddChild(body);
            foreach(var node in BakedWorld.All(root).Where(n=>n!=root))node.Owner=root;
            var scene=new PackedScene();scene.Pack(root);string path="res://assets/props/furniture-"+kind+".tscn";ResourceSaver.Save(scene,path);root.Free();
            var asset=new AuthorAsset{Id="furniture-"+kind,Title=char.ToUpperInvariant(kind[0])+kind[1..],Category="Furniture",Scene=ResourceLoader.Load<PackedScene>(path),Footprint=size,FurnitureKind=kind,SeatPoints=seats,SeatHeight=height,UsePoint=new(0,kind=="clock"?1.7f:.5f,size.Z/2),StandPoint=new(0,0,-size.Z/2-.6f)};
            ResourceSaver.Save(asset,"res://assets/library/furniture-"+kind+".tres");catalog.Assets.Add(asset);
        }
        ResourceSaver.Save(catalog,"res://assets/library/furniture-catalog.tres");GD.Print("Furniture library: 13 reusable scenes; geometric wood/iron bevels; shared keg mesh.");
    }
    private static ArrayMesh BevelBox(Vector3 size,float bevel,Material material)
    {
        var h=size*.5f;float b=Math.Min(bevel,Math.Min(h.X,Math.Min(h.Y,h.Z))*.4f);var inner=h-new Vector3(b,b,b);
        // Six inset faces, twelve chamfer strips and eight clipped corners.
        var planes=new List<(Vector3 n,float d)>();for(int axis=0;axis<3;axis++)foreach(int sign in new[]{-1,1}){var n=Vector3.Zero;n[axis]=sign;planes.Add((n,h[axis]));}
        for(int a=0;a<3;a++)for(int c=a+1;c<3;c++)foreach(int sa in new[]{-1,1})foreach(int sc in new[]{-1,1}){var n=Vector3.Zero;n[a]=sa;n[c]=sc;planes.Add((n,h[a]+h[c]-b));}
        foreach(int x in new[]{-1,1})foreach(int y in new[]{-1,1})foreach(int z in new[]{-1,1})planes.Add((new(x,y,z),h.X+h.Y+h.Z-2*b));
        var points=new List<Vector3>();for(int a=0;a<planes.Count;a++)for(int c=a+1;c<planes.Count;c++)for(int d=c+1;d<planes.Count;d++)
        {var p=planes[a];var q=planes[c];var r=planes[d];float det=p.n.Dot(q.n.Cross(r.n));if(Math.Abs(det)<.0001f)continue;var v=(q.n.Cross(r.n)*p.d+r.n.Cross(p.n)*q.d+p.n.Cross(q.n)*r.d)/det;if(planes.All(f=>f.n.Dot(v)<=f.d+.00001f)&&!points.Any(t=>t.DistanceSquaredTo(v)<1e-10f))points.Add(v);}
        var tool=new SurfaceTool();tool.Begin(Mesh.PrimitiveType.Triangles);tool.SetMaterial(material);
        foreach(var plane in planes)
        {var n=plane.n.Normalized();var poly=points.Where(v=>Math.Abs(plane.n.Dot(v)-plane.d)<.00002f).ToArray();if(poly.Length<3)continue;var centre=poly.Aggregate(Vector3.Zero,(a,v)=>a+v)/poly.Length;var u=n.Cross(Math.Abs(n.Y)<.8f?Vector3.Up:Vector3.Right).Normalized();var v=n.Cross(u);poly=poly.OrderBy(p=>Math.Atan2((p-centre).Dot(v),(p-centre).Dot(u))).ToArray();for(int i=1;i<poly.Length-1;i++)foreach(var p in new[]{poly[0],poly[i+1],poly[i]}){tool.SetNormal(n);tool.SetUV(new(p.Dot(u),p.Dot(v)));tool.AddVertex(p);}}
        return tool.Commit();
    }
}
