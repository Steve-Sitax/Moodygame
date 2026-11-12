using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.World.Ruien;

public static partial class RuienDrainNetwork
{
    private sealed class Geometry
    {
        public readonly List<Vector3> P=new(),N=new();public readonly List<Vector2> Uv=new();
        public readonly List<Color> Weather=new();public readonly List<int> Ix=new();
        public void Vertex(Vector3 p,Vector3 n,Vector2 uv,Color weather){P.Add(p);N.Add(n);Uv.Add(uv);Weather.Add(weather);}
        public void Triangle(int a,int b,int c,Vector3 want)
        {
            if((P[b]-P[a]).Cross(P[c]-P[a]).Dot(want)>0)(b,c)=(c,b);
            Ix.Add(a);Ix.Add(b);Ix.Add(c);
        }
        public Godot.Collections.Array Arrays()
        {
            var a=new Godot.Collections.Array();a.Resize((int)Mesh.ArrayType.Max);
            a[(int)Mesh.ArrayType.Vertex]=P.ToArray();a[(int)Mesh.ArrayType.Normal]=N.ToArray();a[(int)Mesh.ArrayType.TexUV]=Uv.ToArray();
            a[(int)Mesh.ArrayType.Color]=Weather.ToArray();a[(int)Mesh.ArrayType.Index]=Ix.ToArray();return a;
        }
    }
    private static void AddMesh(Node3D root,ArrayMesh mesh,string name,float begin=0,float end=85)
    {
        for(int s=0;s<mesh.GetSurfaceCount();s++)mesh.SurfaceSetMaterial(s,RuienMaterials.Get(mesh.SurfaceGetName(s)));
        root.AddChild(new MeshInstance3D{Name=name,Mesh=mesh,Layers=Ruien.Layer,CastShadow=GeometryInstance3D.ShadowCastingSetting.Off,
            VisibilityRangeBegin=begin,VisibilityRangeEnd=end});
    }
    private static ArrayMesh Warp(ArrayMesh source,Head h)
    {
        var result=new ArrayMesh{ResourceName=h.Id};
        for(int s=0;s<source.GetSurfaceCount();s++)
        {
            using var arrays=source.SurfaceGetArrays(s);
            var p=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();var n=arrays[(int)Mesh.ArrayType.Normal].AsVector3Array();
            var ix=arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
            for(int i=0;i<p.Length;i++){var original=p[i];p[i]=h.Map(original);if(n.Length==p.Length)
                {
                    try{n[i]=h.Normal(original,n[i]);}
                    catch(Exception e){throw new InvalidOperationException($"Drain {h.Id}, curved={h.Curved}, flat={h.Flat}, u={h.U}, source={original}, section={h.Host.Zone.S}",e);}
                }}
            if(h.Bend<0)for(int i=0;i+2<ix.Length;i+=3)(ix[i+1],ix[i+2])=(ix[i+2],ix[i+1]);
            arrays[(int)Mesh.ArrayType.Vertex]=p;arrays[(int)Mesh.ArrayType.Normal]=n;arrays[(int)Mesh.ArrayType.Index]=ix;
            result.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,arrays,null,null,source.SurfaceGetFormat(s)&~Mesh.ArrayFormat.FlagCompressAttributes);
            result.SurfaceSetName(result.GetSurfaceCount()-1,source.SurfaceGetName(s));
        }
        return result;
    }
    private static Transform3D RigidFrame(Head h)
    {
        var f=h.Frame(h.U);float side=h.Side;
        return new Transform3D(new Basis(new Vector3(f.tan.X*side,0,f.tan.Y*side),Vector3.Up,
            new Vector3(-f.tan.Y*side,0,f.tan.X*side)),new Vector3(f.at.X,0,f.at.Y));
    }
    private static Head LocalVariant(Head h)
    {
        var z=new RuienData.Zone{Id="template",S=h.Host.Zone.S,Path=new[]{new Vector2(-5,0),new Vector2(5,0)},Along=new[]{0f,10f}};
        return new Head{Id=h.Template.Name,Template=h.Template,Host=new Host{Zone=z,Flat=h.Flat},
            U=5,Side=1,Bend=h.Bend,Flat=h.Flat,Invert=h.Invert};
    }
    private static Vector2 ProfileNormal(Vector2[] q,int i)
    {
        var edge=q[(i+1)%q.Length]-q[(i+q.Length-1)%q.Length];var n=new Vector2(-edge.Y,edge.X).Normalized();
        return n.Dot(new Vector2(0,.8f)-q[i])>=0?n:-n;
    }
    private static ArrayMesh PipeChunk(Collector c,float a,float b,Vector2[] profile,Head? head)
    {
        var g=new Geometry();int around=profile.Length+1;int rows=Math.Max(1,(int)MathF.Ceiling((b-a)/.06f))+1;
        var arc=new float[around];for(int j=1;j<around;j++)arc[j]=arc[j-1]+profile[j%profile.Length].DistanceTo(profile[(j-1)%profile.Length]);
        var exact=head?.SeamRing;float handed=head?.Bend??1;
        for(int row=0;row<rows;row++)
        {
            float u=Mathf.Lerp(a,b,row/(float)(rows-1));var centre=c.At(u);var tangent=c.Tangent(u);
            var lat=Vector3.Up.Cross(tangent).Normalized();
            float blend=head==null?0:Mathf.SmoothStep(0,1,Math.Clamp((u-(c.Length-2))/2,0,1));
            var oldEnd=c.At(c.Length);var endLat=Vector3.Up.Cross(c.Tangent(c.Length)).Normalized();
            for(int j=0;j<around;j++)
            {
                int k=j%profile.Length;var q=profile[k];var n2=ProfileNormal(profile,k);var n=(lat*(n2.X*handed)+Vector3.Up*n2.Y).Normalized();
                n=(n-tangent*n.Dot(tangent)).Normalized();
                var p=centre+lat*(q.X*handed)+Vector3.Up*q.Y;
                if(exact!=null)
                {
                    var oldRing=oldEnd+endLat*(q.X*handed)+Vector3.Up*q.Y;
                    p+=(exact[k]-oldRing)*blend;
                }
                // Continuous, restrained wet brick relief; the mating ring stays exact.
                float grain=(.001f+.006f*RuienPassage.BrickHeight(new Vector2(u/4.8f,arc[j]/2.4f)))*Math.Clamp(Math.Min(u,c.Length-u)/.06f,0,1);
                p-=n*grain;
                float low=Math.Clamp(1-q.Y/.45f,0,1),patch=.5f+.5f*MathF.Sin(u*.63f+arc[j]*2.1f);
                g.Vertex(p,n,new Vector2(u/4.8f,arc[j]/2.4f),new Color(.55f+.35f*low,.08f+.16f*(1-low)*patch,.35f+.5f*low,.12f*low));
            }
        }
        for(int row=0;row+1<rows;row++)for(int j=0;j+1<around;j++)
        {
            int x=row*around+j,y=x+around;var want=(g.N[x]+g.N[y]+g.N[y+1]).Normalized();
            g.Triangle(x,y,y+1,want);g.Triangle(x,y+1,x+1,want);
        }
        using var arrays=g.Arrays();var mesh=new ArrayMesh{ResourceName=c.Id+"_"+a.ToString("0.00",System.Globalization.CultureInfo.InvariantCulture)};
        mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,arrays);mesh.SurfaceSetName(0,"ruien_brick_stretcher");
        var water=new Geometry();
        for(int row=0;row<rows;row++)
        {
            float u=Mathf.Lerp(a,b,row/(float)(rows-1));var centre=c.At(u)+Vector3.Up*.018f;var across=Vector3.Up.Cross(c.Tangent(u)).Normalized();
            foreach(float side in new[]{-1f,1f})water.Vertex(centre+across*(side*.022f),Vector3.Up,new Vector2(u,side*.022f),Colors.White);
        }
        for(int row=0;row+1<rows;row++){int i=row*2;water.Triangle(i,i+2,i+3,Vector3.Up);water.Triangle(i,i+3,i+1,Vector3.Up);}
        using var film=water.Arrays();mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,film);mesh.SurfaceSetName(1,"ruien_misc_Water_film");return mesh;
    }
    /// <summary>All static solids are returned before play; deep 1 x 1.6 m collectors do not admit Jef's full collision cylinder.</summary>
    public static Node3D Build(Network net,IEnumerable<string>? onlyHeads=null,IEnumerable<string>? onlyCollectors=null,bool drops=true,bool visuals=true)
    {
        var root=new Node3D{Name="ruien_drainage"};var chosenHeads=onlyHeads?.ToHashSet();var chosenPipes=onlyCollectors?.ToHashSet();
        var templates=new Dictionary<(string,int),ArrayMesh>();var collisions=new Dictionary<string,Vector3[]>();
        var rigidMeshes=new Dictionary<(string,bool,int,int,RuienData.Section),ArrayMesh>();
        var rigidShapes=new Dictionary<(string,bool,int,RuienData.Section),ConcavePolygonShape3D>();
        var byId=net.Heads.ToDictionary(h=>h.Id);
        var cuts=visuals?JunctionCuts(net):null;
        foreach(var h in net.Heads)
        {
            if(chosenHeads!=null&&!chosenHeads.Contains(h.Id))continue;
            using var timing=Dev.StartupTiming.Measure("ruien.drain-head."+h.Id);
            for(int lod=0;visuals&&lod<2;lod++)
            {
                var key=(h.Template.Name,lod);
                if(!templates.TryGetValue(key,out var mesh))templates[key]=mesh=ResourceLoader.Load<ArrayMesh>($"{net.Kit}/{key.Item1}_lod{lod}.res");
                if(h.Curved)AddMesh(root,Warp(mesh,h),h.Id+"_lod"+lod,lod==0?0:16,lod==0?16:85);
                else
                {
                    var variant=(h.Template.Name,h.Flat,h.Bend,lod,h.Host.Zone.S);
                    if(!rigidMeshes.TryGetValue(variant,out var shared))rigidMeshes[variant]=shared=Warp(mesh,LocalVariant(h));
                    AddMesh(root,shared,h.Id+"_lod"+lod,lod==0?0:16,lod==0?16:85);
                    ((Node3D)root.GetChild(-1)).Transform=RigidFrame(h);
                }
            }
            if(!collisions.TryGetValue(h.Template.Name,out var faces))
                collisions[h.Template.Name]=faces=ResourceLoader.Load<ConcavePolygonShape3D>($"{net.Kit}/{h.Template.Name}_collision.res").Data;
            var body=new StaticBody3D{Name="drain_"+h.Id+"_solid",CollisionLayer=Solid.Layer,CollisionMask=0};
            ConcavePolygonShape3D shape;
            if(h.Curved)shape=new ConcavePolygonShape3D{Data=faces.Select(h.Map).ToArray(),BackfaceCollision=true};
            else
            {
                var variant=(h.Template.Name,h.Flat,h.Bend,h.Host.Zone.S);
                if(!rigidShapes.TryGetValue(variant,out shape!))
                    rigidShapes[variant]=shape=new ConcavePolygonShape3D{Data=faces.Select(LocalVariant(h).Map).ToArray(),BackfaceCollision=true};
                body.Transform=RigidFrame(h);
            }
            body.AddChild(new CollisionShape3D{Shape=shape});root.AddChild(body);
        }
        var profile=net.Templates.Values.First().Profile;
        foreach(var c in net.Collectors)
        {
            if(!visuals)continue;
            if(chosenPipes!=null&&!chosenPipes.Contains(c.Id))continue;
            using var timing=Dev.StartupTiming.Measure("ruien.collector."+c.Id);
            var head=c.DestinationKind=="head"?byId[c.Destination]:null;
            for(float a=0;a<c.Length-.001f;a+=2)
                AddMesh(root,CutPipe(PipeChunk(c,a,Math.Min(c.Length,a+2),profile,head),cuts![c.Id]),c.Id+"_"+((int)(a/2)));
            AddMesh(root,CutPipe(CollectorCap(c,profile),cuts![c.Id]),c.Id+"_upstream_cap");
        }
        if(drops)foreach(var inlet in net.Inlets)root.AddChild(BuildInlet(inlet));
        return root;
    }
    private static Node3D BuildInlet(Inlet inlet)
    {
        var root=new Node3D{Name="gully_connection_"+inlet.Id};
        AddMesh(root,InletMesh(inlet),"pipe");return root;
    }
}
