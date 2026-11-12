using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.World.Ruien;

/// <summary>Measured quay sluices, sharing dimensioned fixed meshes and moving oak leaves.</summary>
public sealed class RuienNetworkGates
{
    public sealed record Spec(string Id,string Kit,Transform3D Frame,float Sill,float Bed,float Channel,float IncomingChannel,float IncomingOffset,float Water,bool Held,bool Flush);
    private readonly List<(Spec Spec,Node3D Leaf,StaticBody3D Solid,Vector3 Pivot,float Degrees,float[] Open)> doors=new();
    private readonly List<(MeshInstance3D Film,Spec Spec)> flushFilms=new();
    public readonly List<Audio.Soundscape.RuienPoint> SoundPoints=new();
    public readonly List<Spec> Specs=new();
    public static string File
    {
        get{var args=OS.GetCmdlineUserArgs();int at=Array.IndexOf(args,"--ruien-gates");return at>=0?args[at+1]:"res://world/ruien/network-gates.json";}
    }
    public static RuienNetworkGates Read()
    {
        var result=new RuienNetworkGates();if(!Godot.FileAccess.FileExists(File))return result;
        using var doc=JsonDocument.Parse(Godot.FileAccess.GetFileAsString(File));
        foreach(var e in doc.RootElement.GetProperty("gates").EnumerateArray())
        {
            var p=e.GetProperty("origin");var n=e.GetProperty("normal");var outward=new Vector3(n[0].GetSingle(),0,n[1].GetSingle());
            var frame=new Transform3D(new Basis(new Vector3(-outward.Z,0,outward.X),Vector3.Up,-outward),new Vector3(p[0].GetSingle(),0,p[1].GetSingle()));
            string kit=e.GetProperty("kit").GetString()!;var args=OS.GetCmdlineUserArgs();int overrideAt=Array.IndexOf(args,"--ruien-gate-kit");
            if(overrideAt>=0)kit=args[overrideAt+1]+"/"+e.GetProperty("variant").GetString();
            result.Specs.Add(new(e.GetProperty("id").GetString()!,kit,frame,
                e.GetProperty("sill").GetSingle(),e.GetProperty("bed").GetSingle(),e.GetProperty("channel").GetSingle(),
                e.GetProperty("incomingChannel").GetSingle(),e.TryGetProperty("incomingOffset",out var offset)?offset.GetSingle():0,e.GetProperty("water").GetSingle(),e.TryGetProperty("held",out var held)&&held.GetBoolean(),
                e.TryGetProperty("flush",out var flush)&&flush.GetBoolean()));
        }
        return result;
    }
    public IEnumerable<string> StartupFiles()=>Specs.Where(s=>!s.Flush).Select(s=>s.Kit).Distinct().SelectMany(dir=>StartupResources.Folder(dir,".res"));
    public float ExternalLevel(string id)=>Specs.Any(s=>s.Id==id&&s.Held)?-.7f:Tide.River;
    public bool ClosedBoundary(string id)=>Specs.Any(s=>s.Id==id&&(s.Held||s.Flush));
    public bool IsFlush(string id)=>Specs.Any(s=>s.Id==id&&s.Flush);
    public Node3D Build()
    {
        using var timing=Dev.StartupTiming.Measure("ruien.network-gates");
        var root=new Node3D{Name="ruien_network_gates"};
        foreach(var s in Specs)
        {
            var frame=new Node3D{Name="gate_"+s.Id,Transform=s.Frame};root.AddChild(frame);
            if(s.Flush){BuildFlush(frame,s);continue;}
            using var doc=JsonDocument.Parse(Godot.FileAccess.GetFileAsString(s.Kit+"/area.json"));
            using var markers=JsonDocument.Parse(Godot.FileAccess.GetFileAsString(s.Kit+"/markers.json"));
            var keys=doc.RootElement.GetProperty("keys");
            foreach(var key in keys.EnumerateObject())
            {
                var part=new Node3D{Name=key.Name};frame.AddChild(part);
                foreach(var file in key.Value.GetProperty("lod0").EnumerateArray())
                {
                    var mesh=ResourceLoader.Load<ArrayMesh>(s.Kit+"/"+file.GetProperty("file").GetString());
                    for(int i=0;i<mesh.GetSurfaceCount();i++)mesh.SurfaceSetMaterial(i,RuienMaterials.Get(mesh.SurfaceGetName(i)));
                    part.AddChild(new MeshInstance3D{Name="mesh",Mesh=mesh,Layers=Ruien.Layer,CastShadow=GeometryInstance3D.ShadowCastingSetting.Off});
                }
                if(!key.Name.StartsWith("outlet_door_",StringComparison.Ordinal))continue;
                var m=markers.RootElement.GetProperty("movers").EnumerateArray().Single(x=>x.GetProperty("id").GetString()==key.Name);
                var p=m.GetProperty("pivot");var pivot=new Vector3(p[0].GetSingle(),p[1].GetSingle(),p[2].GetSingle());
                var solid=new StaticBody3D{Name=key.Name+"_solid",CollisionLayer=Solid.Layer,CollisionMask=0};
                solid.AddChild(new CollisionShape3D{Shape=ResourceLoader.Load<ConcavePolygonShape3D>(s.Kit+"/"+m.GetProperty("collision").GetString())});frame.AddChild(solid);
                doors.Add((s,part,solid,pivot,m.GetProperty("openDeg").GetSingle(),new[]{-1f}));
            }
            var body=new StaticBody3D{Name="quay_solid",CollisionLayer=Solid.Layer,CollisionMask=0};
            body.AddChild(new CollisionShape3D{Shape=ResourceLoader.Load<ConcavePolygonShape3D>(s.Kit+"/collision.res")});frame.AddChild(body);
            frame.AddChild(Ramp(s));
        }
        return root;
    }
    private static ArrayMesh DetailedBox(Vector3 size,float radius,string family)
        =>RuienGeometryCache.Get(File,FormattableString.Invariant($"gate-box:{family}:{size.X:R}:{size.Y:R}:{size.Z:R}:{radius:R}"),()=>MakeDetailedBox(size,radius,family));
    private static ArrayMesh MakeDetailedBox(Vector3 size,float radius,string family)
    {
        var source=BevelMesh.Box(size,radius,RuienMaterials.Get(family));
        using var arrays=source.SurfaceGetArrays(0);var p=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        var normals=arrays[(int)Mesh.ArrayType.Normal].AsVector3Array();var uv=arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();
        var indices=arrays[(int)Mesh.ArrayType.Index].AsInt32Array();if(indices.Length==0)indices=Enumerable.Range(0,p.Length).ToArray();
        var tile=RuienTextures.Families()[RuienTextures.Key(family)];var scale=new Vector2(tile.TileU,tile.TileV);
        var st=new SurfaceTool();st.Begin(Mesh.PrimitiveType.Triangles);bool brick=family.Contains("brick");
        for(int t=0;t<indices.Length;t+=3)
        {
            int ia=indices[t],ib=indices[t+1],ic=indices[t+2];var normal=normals[ia];
            bool flat=brick&&Math.Max(Math.Max(MathF.Abs(normal.X),MathF.Abs(normal.Y)),MathF.Abs(normal.Z))>.9999f
                &&normal.Dot(normals[ib])>.9999f&&normal.Dot(normals[ic])>.9999f;
            int count=flat?Math.Max(1,(int)MathF.Ceiling(Math.Max(p[ia].DistanceTo(p[ib]),Math.Max(p[ia].DistanceTo(p[ic]),p[ib].DistanceTo(p[ic])))/.04f)):1;
            void Vertex(float b,float c)
            {
                float a=1-b-c;var point=p[ia]*a+p[ib]*b+p[ic]*c;var n=(normals[ia]*a+normals[ib]*b+normals[ic]*c).Normalized();var chart=(uv[ia]*a+uv[ib]*b+uv[ic]*c)/scale;
                if(flat)
                {
                    var half=size/2-new Vector3(radius,radius,radius);float edge=MathF.Abs(normal.X)>.9f?Math.Min(half.Y-MathF.Abs(point.Y),half.Z-MathF.Abs(point.Z))
                        :MathF.Abs(normal.Y)>.9f?Math.Min(half.X-MathF.Abs(point.X),half.Z-MathF.Abs(point.Z)):Math.Min(half.X-MathF.Abs(point.X),half.Y-MathF.Abs(point.Y));
                    point+=n*(.001f+.007f*RuienPassage.BrickHeight(chart))*Math.Clamp(edge/.025f,0,1);
                }
                st.SetNormal(n);st.SetUV(chart);st.SetColor(new Color(.6f,.08f,.5f,.1f));st.AddVertex(point);
            }
            for(int i=0;i<count;i++)for(int j=0;j<count-i;j++)
            {
                Vertex(i/(float)count,j/(float)count);Vertex((i+1)/(float)count,j/(float)count);Vertex(i/(float)count,(j+1)/(float)count);
                if(i+j+1<count){Vertex((i+1)/(float)count,j/(float)count);Vertex((i+1)/(float)count,(j+1)/(float)count);Vertex(i/(float)count,(j+1)/(float)count);}
            }
        }
        var result=st.Commit();result.SurfaceSetName(0,family);result.SurfaceSetMaterial(0,RuienMaterials.Get(family));return result;
    }
    private void BuildFlush(Node3D root,Spec s)
    {
        var solid=new List<Vector3>();int part=0;
        void Box(string family,Vector3 at,Vector3 size,float radius,Basis? rotation=null)
        {
            var mesh=DetailedBox(size,radius,family);var xf=new Transform3D(rotation??Basis.Identity,at);
            root.AddChild(new MeshInstance3D{Name="flush_"+part++,Mesh=mesh,Transform=xf,Layers=Ruien.Layer,CastShadow=GeometryInstance3D.ShadowCastingSetting.Off});
            solid.AddRange(mesh.GetFaces().Select(p=>xf*p));
        }
        const string brick="ruien_brick_stretcher",stone="ruien_bluestone",iron="ruien_iron";
        const float half=1.8f,opening=.5f,depth=1.2f,low=-1.55f,high=-.98f;
        // The shallow moat feeds a small barred inlet. The full-height buried
        // head wall closes the rui below it; no deeper outside waterway is cut.
        Box(brick,new Vector3(0,(s.Bed-.2f+low)/2,depth/2),new Vector3(half*2,low-s.Bed+.2f,depth),.008f);
        foreach(float side in new[]{-1f,1f})
            Box(brick,new Vector3(side*(half+opening)/2,(low-.72f)/2,depth/2),new Vector3(half-opening,-.72f-low,depth),.008f);
        Box(stone,new Vector3(0,low-.075f,depth/2),new Vector3(1.18f,.15f,depth+.16f),.012f);
        Box(stone,new Vector3(0,high+.075f,depth/2),new Vector3(1.25f,.15f,depth+.16f),.012f);
        foreach(float side in new[]{-1f,1f})
            Box(stone,new Vector3(side*.57f,(low+high)/2,depth/2),new Vector3(.14f,high-low,depth+.12f),.01f);
        for(int i=-2;i<=2;i++)Box(iron,new Vector3(i*.18f,(low+high)/2,-.055f),new Vector3(.022f,high-low,.028f),.0015f);
        // A partly raised penstock admits flushing water beneath its plate.
        // Its hand wheel and screw are inside, reachable from the existing ledge.
        Box(iron,new Vector3(0,-1.11f,.16f),new Vector3(1.07f,.40f,.035f),.002f);
        foreach(float side in new[]{-1f,1f})Box(iron,new Vector3(side*.565f,-1.20f,.17f),new Vector3(.05f,.66f,.075f),.003f);
        Box(iron,new Vector3(-1.25f,-1.76f,1.28f),new Vector3(.026f,1.35f,.026f),.002f);
        var wheel=new TorusMesh{InnerRadius=.142f,OuterRadius=.172f,Rings=24,RingSegments=12,Material=RuienMaterials.Get(iron)};
        var wheelXf=new Transform3D(new Basis(Vector3.Right,MathF.PI/2),new Vector3(-1.25f,-2.40f,1.31f));
        root.AddChild(new MeshInstance3D{Name="flush_handwheel",Mesh=wheel,Transform=wheelXf,Layers=Ruien.Layer});
        solid.AddRange(wheel.GetFaces().Select(p=>wheelXf*p));
        for(int i=0;i<6;i++)Box(iron,new Vector3(-1.25f,-2.40f,1.31f),new Vector3(.31f,.018f,.018f),.002f,new Basis(Vector3.Back,i*MathF.PI/3));
        var body=new StaticBody3D{Name="flush_solid",CollisionLayer=Solid.Layer,CollisionMask=0};
        body.AddChild(new CollisionShape3D{Shape=new ConcavePolygonShape3D{Data=solid.ToArray(),BackfaceCollision=true}});root.AddChild(body);
        var st=new SurfaceTool();st.Begin(Mesh.PrimitiveType.Triangles);
        // Unit-height film: update its lower end to the receiving water surface.
        foreach(var p in new[]{new Vector3(-.35f,0,.35f),new Vector3(.35f,0,.35f),new Vector3(.22f,-1,.68f),
                              new Vector3(-.35f,0,.35f),new Vector3(.22f,-1,.68f),new Vector3(-.22f,-1,.68f)})
        {st.SetNormal(Vector3.Forward);st.SetUV(new Vector2(p.X,p.Y));st.AddVertex(p);}
        var film=st.Commit();film.SurfaceSetMaterial(0,RuienMaterials.Get("ruien_misc_Water_spout"));
        var falling=new MeshInstance3D{Name="flush_fall",Mesh=film,Position=new Vector3(0,s.Sill,0),Visible=false,Layers=Ruien.Layer,CastShadow=GeometryInstance3D.ShadowCastingSetting.Off};
        root.AddChild(falling);flushFilms.Add((falling,s));
        SoundPoints.Add(new(){Kind="spill",At=s.Frame*new Vector3(0,s.Water,.68f),Reach=8,Gain=.65,Flowing=()=>falling.Visible});
    }
    private static Node3D Ramp(Spec s)
    {
        var root=new Node3D{Name="bed_ramp"};var stone=new SurfaceTool();stone.Begin(Mesh.PrimitiveType.Triangles);
        const float start=1.5f,length=4.5f,thickness=.22f;float slope=(s.Sill-s.Bed)/length,angle=MathF.Atan(slope);
        var basis=new Basis(Vector3.Right,angle);
        for(int i=0;i<9;i++)
        {
            float t=(i+.5f)/9,z=start+t*length,y=Mathf.Lerp(s.Sill,s.Bed,t),width=Mathf.Lerp(s.Channel,s.IncomingChannel,t);
            var mesh=DetailedBox(new Vector3(width,thickness,length/9/MathF.Cos(angle)-.004f),.012f,"ruien_bluestone");
            stone.AppendFrom(mesh,0,new Transform3D(basis,new Vector3(s.IncomingOffset*t,y-thickness/(2*MathF.Cos(angle)),z)));
        }
        // AppendFrom copies vertex channels, not the source surface's material.
        var flags=stone.Commit();flags.SurfaceSetName(0,"ruien_bluestone");flags.SurfaceSetMaterial(0,RuienMaterials.Get("ruien_bluestone"));
        root.AddChild(new MeshInstance3D{Name="flags",Mesh=flags,Layers=Ruien.Layer,CastShadow=GeometryInstance3D.ShadowCastingSetting.Off});
        // Bearing wedge: its top mates inside the flags, its bottom inside the
        // existing channel bed. The straight mating edges remain concealed.
        float a=s.Channel/2,b=s.IncomingChannel/2,low=s.Bed-.2f;
        var v=new[]{new Vector3(-a,low,start),new Vector3(a,low,start),new Vector3(-a,s.Sill-thickness,start),new Vector3(a,s.Sill-thickness,start),
            new Vector3(-b+s.IncomingOffset,low,start+length),new Vector3(b+s.IncomingOffset,low,start+length),new Vector3(-b+s.IncomingOffset,s.Bed-thickness,start+length),new Vector3(b+s.IncomingOffset,s.Bed-thickness,start+length)};
        var triangles=new[]{0,2,3,0,3,1,4,5,7,4,7,6,0,4,6,0,6,2,1,3,7,1,7,5,2,6,7,2,7,3,0,1,5,0,5,4};
        var st=new SurfaceTool();st.Begin(Mesh.PrimitiveType.Triangles);
        foreach(int i in triangles){st.SetUV(new Vector2(v[i].X/4.8f,v[i].Y/2.4f));st.SetColor(new Color(.6f,.08f,.7f,.15f));st.AddVertex(v[i]);}st.GenerateNormals();
        var rawBearing=st.Commit();using var bearingArrays=rawBearing.SurfaceGetArrays(0);RuienUnfold.Apply(bearingArrays,"ruien_brick_stretcher");var bearing=new ArrayMesh();bearing.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,bearingArrays);bearing.SurfaceSetName(0,"ruien_brick_stretcher");bearing.SurfaceSetMaterial(0,RuienMaterials.Get("ruien_brick_stretcher"));
        root.AddChild(new MeshInstance3D{Name="bearing",Mesh=bearing,Layers=Ruien.Layer,CastShadow=GeometryInstance3D.ShadowCastingSetting.Off});
        var body=new StaticBody3D{Name="ramp_solid",CollisionLayer=Solid.Layer,CollisionMask=0};
        body.AddChild(new CollisionShape3D{Shape=new ConcavePolygonShape3D{Data=flags.GetFaces().Concat(bearing.GetFaces()).ToArray(),BackfaceCollision=true}});root.AddChild(body);return root;
    }
    public void Update(float dt,float river,Func<string,float?>? receivingLevel=null)
    {
        foreach(var flush in flushFilms)
        {
            float water=receivingLevel?.Invoke(flush.Spec.Id)??flush.Spec.Water;
            float fall=flush.Spec.Sill-water-.02f;
            flush.Film.Visible=river>Math.Max(flush.Spec.Sill,water)+.03f&&fall>.01f;
            flush.Film.Scale=new Vector3(1,Math.Max(.001f,fall),1);
        }
        foreach(var d in doors)
        {
            float target=!d.Spec.Held&&river<d.Spec.Water-.02f?1:0;
            float now=d.Open[0]<0||dt<=0||Tide.Held!=null?target:Mathf.MoveToward(d.Open[0],target,dt/60);
            if(now==d.Open[0])continue;d.Open[0]=now;
            var basis=new Basis(Vector3.Up,Mathf.DegToRad(d.Degrees*Mathf.SmoothStep(0,1,now)));
            var xf=new Transform3D(basis,d.Pivot-basis*d.Pivot);d.Leaf.Transform=xf;d.Solid.Transform=xf;
        }
    }
}
