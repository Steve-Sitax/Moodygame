using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Godot;
using Scheldemist.Models;

public partial class MarketJoineryRepair : Node
{
    private const string Maps = "res://assets/textures/plan-84/6/";
    private const string Models = "res://assets/game-models/resources/";
    private const string Finish = "res://assets/market-joinery/";
    private static void Save(Resource resource, string path)
    {
        if (path.StartsWith(Models,StringComparison.Ordinal) && OS.GetCmdlineUserArgs().Contains("--market-candidates"))
        {
            string candidates=ProjectSettings.GlobalizePath("res://../.scratch/city-market/candidates");
            Directory.CreateDirectory(candidates);
            path=candidates+"/"+Path.GetFileName(path);
        }
        if (ResourceSaver.Save(resource,path,ResourceSaver.SaverFlags.Compress)!=Error.Ok) throw new IOException(path);
    }

    private static readonly Dictionary<string,Texture2D> Pictures=new();

    // Bake the existing canvas weave into colour and relief together. The packed mip chain
    // lets individual threads disappear gradually as the player steps away.
    private static Texture2D Picture(string texture,string channel,bool fabric)
    {
        string key=texture+"_"+channel;
        if(Pictures.TryGetValue(key,out var cached)) return cached;
        using var source=Image.LoadFromFile(ProjectSettings.GlobalizePath(Maps+key+".png"));
        bool height=channel=="height";
        var format=height?Image.Format.L8:Image.Format.Rgb8;
        source.Convert(format);
        using var result=(Image)source.Duplicate();
        if(fabric)
        {
            using var yarn=Image.LoadFromFile(ProjectSettings.GlobalizePath("res://assets/people2-pictures/detail_canvas_colour.png"));
            yarn.Convert(Image.Format.L8);
            if(yarn.GetSize()!=source.GetSize())throw new InvalidDataException("Unexpected weave dimensions");
            var threads=yarn.GetData();
            var data=source.GetData();
            float mean=(float)threads.Average(x=>(double)x);
            float amount=texture=="tarpaulin"?.38f:1f;
            int channels=height?1:3;
            for(int i=0;i<threads.Length;i++)
            {
                float thread=(threads[i]-mean)*amount;
                for(int c=0;c<channels;c++)
                {
                    int j=i*channels+c;
                    float sample=height?data[j]+thread*.80f:data[j]*(1+thread/250f);
                    data[j]=(byte)Math.Clamp(MathF.Round(sample),0,255);
                }
            }
            result.SetData(source.GetWidth(),source.GetHeight(),false,format,data);
        }
        result.GenerateMipmaps();
        var picture=ImageTexture.CreateFromImage(result);
        string path=Finish+key+".res";
        Save(picture,path);
        picture.TakeOverPath(path);
        return Pictures[key]=picture;
    }

    private static ShaderMaterial FinishMaterial(string texture, string name, Color tint, float strength, bool twoSided)
    {
        var material=NetRackGeometry.Material(name,colour:tint);
        bool fabric=texture!="wood_single";
        material.SetShaderParameter("tex",Picture(texture,"colour",fabric));
        material.SetShaderParameter("bump_map",Picture(texture,"height",fabric));
        if (!twoSided) material.Shader=GD.Load<Shader>("res://world/town/resources/r000557.res");
        material.SetShaderParameter("bump_scale",strength);
        string path=Finish+name+".res";
        Save(material,path);
        material.TakeOverPath(path);
        return material;
    }

    // X follows the cut length. Map all four long faces along the grain, including the narrow edge.
    private static void Board(NetRackGeometry.Builder mesh, Material wood, Vector3 a, Vector3 b, float height, float width, int cut)
    {
        var x=(b-a).Normalized();
        var reference=Math.Abs(x.Dot(Vector3.Up))>.9f ? Vector3.Forward : Vector3.Up;
        var z=x.Cross(reference).Normalized();
        var basis=new Basis(x,z.Cross(x),z);
        var size=new Vector3(a.DistanceTo(b),height,width);
        using var shape=BevelMesh.Box(size,.0025f,wood);
        var arrays=shape.SurfaceGetArrays(0);
        var points=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        var normals=arrays[(int)Mesh.ArrayType.Normal].AsVector3Array();
        Vector2 UV(Vector3 p,Vector3 n)
        {
            float offset=cut*.283f;
            if(Math.Abs(n.X)>.8f) return new(p.Y/.7f+offset,p.Z/.18f+offset);
            return new((Math.Abs(n.Y)>Math.Abs(n.Z)?p.Z:p.Y)/.9f+offset,p.X/.43f+offset);
        }
        var centre=(a+b)/2;
        var colour=Colors.White.Darkened(.03f*(cut%4));
        for(int i=0;i<points.Length;i+=3)
            mesh.Triangle(centre+basis*points[i],centre+basis*points[i+1],centre+basis*points[i+2],
                basis*normals[i],basis*normals[i+1],basis*normals[i+2],
                UV(points[i],normals[i]),UV(points[i+1],normals[i+1]),UV(points[i+2],normals[i+2]),colour);
    }

    private static void Table(ArrayMesh original,bool stall,Material topWood,Material frameWood)
    {
        using var mesh=new NetRackGeometry.Builder();
        float top=stall?.85f:.80f, half=stall?1.2f:.8f, depth=stall?1.1f:.7f, centre=stall?0:.6f;
        int boards=stall?7:5, cut=0;
        for(int i=0;i<boards;i++)
        {
            float z=centre+depth*((i+.5f)/boards-.5f);
            Board(mesh,topWood,new(-half,top-.02f,z),new(half,top-.02f,z),.04f,depth/boards-.0015f,cut++);
        }
        mesh.Finish(topWood,"individual_deal_boards");
        void Beam(Vector3 a,Vector3 b,float h,float w)=>Board(mesh,frameWood,a,b,h,w,cut++);
        foreach(int side in new[]{-1,1})
        {
            float x=side*(stall?.8f:.55f);
            Beam(new(x,top-.07f,centre-depth/2+.05f),new(x,top-.07f,centre+depth/2-.05f),.06f,.068f);
            foreach(int end in new[]{-1,1})
            foreach(int leg in new[]{-1,1})
                Beam(new(x+leg*.14f,.004f,centre+end*(depth/2-.06f)),
                     new(x+leg*.021f,top-.069f,centre+end*(depth/2-.09f)),.045f,.045f);
            // A lower stretcher ties each pair of splayed trestles together.
            foreach(int end in new[]{-1,1})
            {
                float z=centre+end*(depth/2-.068f);
                Beam(new(x-.126f,.24f,z),new(x+.126f,.24f,z),.043f,.055f);
            }
            Beam(new(x,.24f,centre-depth/2+.07f),new(x,.24f,centre+depth/2-.07f),.043f,.05f);
        }
        if(stall)
        {
            float Eave(float z)=>1.9f+(.92f-z)*(.3f/1.64f)-.008f;
            foreach(float z in new[]{-.65f,.65f})
            {
                float y=Eave(z);
                Beam(new(-1.375f,y-.034f,z),new(1.375f,y-.034f,z),.06f,.052f);
                foreach(float x in new[]{-1.34f,1.34f})
                {
                    // Square foot blocks sit on the flags, with short diagonal braces under the rail.
                    Beam(new(x,.03f,z-.06f),new(x,.03f,z+.06f),.06f,.12f);
                    Beam(new(x,.06f,z),new(x,y-.01f,z),.07f,.07f);
                    Beam(new(x,y-.31f,z),new(x-Math.Sign(x)*.26f,y-.061f,z),.047f,.045f);
                }
            }
            foreach(float x in new[]{-1.34f,1.34f})
            {
                Beam(new(x,Eave(-.65f)-.035f,-.65f),new(x,Eave(.65f)-.035f,.65f),.058f,.05f);
                Beam(new(x,.25f,-.615f),new(x,.25f,.615f),.05f,.04f);
            }
            Beam(new(-1.375f,1.4f,.695f),new(-1.015f,1.4f,.695f),.18f,.02f);
        }
        mesh.Finish(frameWood,"braced_timber_frame");
        if(stall)
        {
            // Keep the painted lettering and its authored UV rectangle and position.
            int s=Enumerable.Range(0,original.GetSurfaceCount()).Single(i=>original.SurfaceGetMaterial(i).ResourceName=="stall_sign");
            mesh.Mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,original.SurfaceGetArrays(s));
            mesh.Mesh.SurfaceSetMaterial(mesh.Mesh.GetSurfaceCount()-1,original.SurfaceGetMaterial(s));
        }
        mesh.Mesh.ResourceName=original.ResourceName;
        foreach(var key in original.GetMetaList())mesh.Mesh.SetMeta(key,original.GetMeta(key));
        Save(mesh.Mesh,original.ResourcePath);
    }

    // The original canopy is two exactly coincident skins. Keep their individual UVs and underside shading.
    // Offset the inner skin into the fabric and connect the exposed cut edges with a narrow hem.
    private static void Canopy(ArrayMesh original,Material material)
    {
        using var builder=new NetRackGeometry.Builder();
        int slot=Enumerable.Range(0,original.GetSurfaceCount()).Single(i=>original.SurfaceGetMaterial(i).ResourceName==material.ResourceName);
        var arr=original.SurfaceGetArrays(slot);
        var v=arr[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        var n=arr[(int)Mesh.ArrayType.Normal].AsVector3Array();
        var uv=arr[(int)Mesh.ArrayType.TexUV].AsVector2Array();
        var colours=arr[(int)Mesh.ArrayType.Color].AsColorArray();
        var indices=arr[(int)Mesh.ArrayType.Index].AsInt32Array();
        var shift=new Vector3(0,-.002f,-.002f);
        var edges=new Dictionary<(Vector3I,Vector3I),(int A,int B)>();
        Vector3I Key(int i)=>(Vector3I)(v[i]*1000).Round();
        void Edge(int a,int b)
        {
            var ka=Key(a);var kb=Key(b);
            if(ka==kb)return;
            var key=ka<kb?(ka,kb):(kb,ka);
            if(!edges.Remove(key)) edges.Add(key,(a,b));
        }
        int front=0,back=0;
        for(int i=0;i<indices.Length;i+=3)
        {
            int a=indices[i],b=indices[i+1],c=indices[i+2];
            var normal=(v[c]-v[a]).Cross(v[b]-v[a]).Normalized();
            bool outside=normal.Dot(-shift)>0;
            var delta=outside?Vector3.Zero:shift;
            var tint=colours.Length==0?Colors.White:colours[a];
            builder.Triangle(v[a]+delta,v[b]+delta,v[c]+delta,n[a],n[b],n[c],uv[a],uv[b],uv[c],tint);
            if(outside){front++;Edge(a,b);Edge(b,c);Edge(c,a);}else back++;
        }
        if(front!=back || front==0 || edges.Count==0) throw new InvalidDataException("Unexpected canopy topology: "+original.ResourcePath);
        foreach(var (a,b) in edges.Values)
        {
            var side=(v[b]-v[a]).Cross(shift).Normalized();
            builder.Triangle(v[a],v[b],v[b]+shift,side,side,side,uv[a],uv[b],uv[b]+Vector2.Down*.002f,Colors.White);
            builder.Triangle(v[a],v[b]+shift,v[a]+shift,side,side,side,uv[a],uv[b]+Vector2.Down*.002f,uv[a]+Vector2.Down*.002f,Colors.White);
        }
        builder.Finish(material,material.ResourceName);
        for(int i=0;i<original.GetSurfaceCount();i++)if(i!=slot)
        {
            builder.Mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,original.SurfaceGetArrays(i));
            builder.Mesh.SurfaceSetMaterial(builder.Mesh.GetSurfaceCount()-1,original.SurfaceGetMaterial(i));
        }
        builder.Mesh.ResourceName=original.ResourceName;
        foreach(var key in original.GetMetaList())builder.Mesh.SetMeta(key,original.GetMeta(key));
        builder.Mesh.SetMeta("hemmed_canopy",true);
        Save(builder.Mesh,original.ResourcePath);
    }

    public override void _Ready()
    {
        try
        {
            Scheldemist.Native.Game.NativeGlobals.Ensure();
            Scheldemist.Render.Psx.EnsureGlobals();
            const string backups="res://../.scratch/city-market/originals";
            var source=ProjectSettings.GlobalizePath(backups);
            Directory.CreateDirectory(source);
            DirAccess.MakeDirRecursiveAbsolute(Finish);
            var cloth=new Dictionary<string,ShaderMaterial>();
            foreach(string name in new[]{"awning_red","awning_blue","canvas_patched","tarpaulin"})
                cloth[name]=FinishMaterial(name,name,Colors.White,.28f,name=="tarpaulin");
            var top=FinishMaterial("wood_single","market_joinery_deal",new Color(.99f,.94f,.85f),.16f,false);
            var frame=FinishMaterial("wood_single","market_joinery_oak",new Color(.81f,.76f,.68f),.19f,false);
            void Backup(string path)
            {
                string file=Path.Combine(source,Path.GetFileName(path));
                if(!File.Exists(file))File.Copy(ProjectSettings.GlobalizePath(path),file);
            }
            foreach(string id in new[]{"r001185","r001167"}) Backup(Models+id+".res");
            var scene=GD.Load<PackedScene>("res://assets/game-models/stalls.scn").Instantiate<Node3D>();
            foreach(var node in scene.GetChildren().OfType<MeshInstance3D>())
            {
                var mesh=(ArrayMesh)node.Mesh;
                for(int i=0;i<mesh.GetSurfaceCount();i++)
                {
                    if(!cloth.TryGetValue(mesh.SurfaceGetMaterial(i).ResourceName,out var material)) continue;
                    Backup(mesh.ResourcePath);
                    string name=node.Name.ToString();
                    if((name is "shop_awning" or "stall_awning_canvas" or "stall_awning") && !mesh.HasMeta("hemmed_canopy"))
                        Canopy(mesh,material);
                    else
                    {
                        mesh.SurfaceSetMaterial(i,material);
                        Save(mesh,mesh.ResourcePath);
                    }
                    break;
                }
            }
            scene.Free();
            Table(GD.Load<ArrayMesh>(Models+"r001185.res"),true,top,frame);
            Table(GD.Load<ArrayMesh>(Models+"r001167.res"),false,top,frame);
            GD.Print("MARKET_JOINERY_AUTHORED");
            GetTree().Quit();
        }
        catch(Exception e){GD.PushError(e.ToString());GetTree().Quit(1);}
    }
}
