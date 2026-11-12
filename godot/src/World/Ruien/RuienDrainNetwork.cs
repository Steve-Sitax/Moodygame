using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist.World.Ruien;

/// <summary>Connected street collectors: exact surveyed drops, shared downstream branches and detailed open heads.</summary>
public static partial class RuienDrainNetwork
{
    public static Network? Active {get;set;}
    public static string File
    {
        get{var args=OS.GetCmdlineUserArgs();int i=Array.IndexOf(args,"--ruien-drainage");return i>=0?args[i+1]:"res://world/ruien/drainage-network.json";}
    }
    public static Network? Installed(RuienData data)
    {
        if(!Godot.FileAccess.FileExists(File))return null;
        using var doc=JsonDocument.Parse(Godot.FileAccess.GetFileAsString(File));string kit=doc.RootElement.GetProperty("templates").GetString()!;
        var args=OS.GetCmdlineUserArgs();int i=Array.IndexOf(args,"--ruien-drain-kit");if(i>=0)kit=args[i+1];
        return Read(File,kit,data);
    }
    public sealed class Template
    {
        public string Name="";public float Invert,HalfWidth,Walk,Spring,Crown=-.9f;
        public Vector2[] Profile=Array.Empty<Vector2>();public Vector3[] Ring=Array.Empty<Vector3>();
        public Vector3 Seam,Tangent;
    }
    public sealed class Host
    {
        public string Id="",Area="";public RuienData.Zone Zone=null!;public bool Flat;
    }
    public sealed class Head
    {
        public string Id="",Area="";public Host Host=null!;public Template Template=null!;
        public float U,Invert;public int Side,Bend;public bool Flat,Curved;
        public (Vector2 at,Vector2 tan) Frame(float u)
        {
            var z=Host.Zone;var at=z.Frame(u).at;
            var t=(z.Frame(Math.Min(z.Length,u+.14f)).at-z.Frame(Math.Max(0,u-.14f)).at).Normalized();
            return(at,t.LengthSquared()>0?t:z.Frame(u).tan);
        }
        private float Flatten(Vector3 p)
        {
            var s=Host.Zone.S;var template=Template;
            float rise=template.Crown-template.Spring,t=Math.Clamp((p.Y-template.Spring)/rise,0,1);
            float source=template.HalfWidth*MathF.Sqrt(Math.Max(0,1-t*t));
            float desired=Flat?s.Width/2:s.Shell(p.Y);
            float shift=source-desired,depth=-source-p.Z;
            // Fade behind the actual curved face. A fixed 0.5 m band can fold
            // a flattened haunch onto itself; this width bounds its derivative.
            float width=Math.Max(2.4f,MathF.Abs(shift)*2);
            return shift*(1-Mathf.SmoothStep(0,width,Math.Max(0,depth)));
        }
        public Vector3 Map(Vector3 p)
        {
            p.Z+=Flatten(p);
            float radial=-p.Z,along=p.X*Side*Bend;
            if(Curved)
            {
                var a=Frame(U-.5f).tan;var b=Frame(U+.5f).tan;
                float curvature=MathF.Atan2(a.Cross(b),a.Dot(b));
                // Metric distance along the offset wall, rather than along its centre line.
                float scale=1+curvature*Side*radial;
                if(scale<=.15f)throw new InvalidDataException($"Drain head {Id} folds inside its host bend; choose another bearing bay");
                along/=scale;
            }
            var f=Frame(Curved?U+along:U);var n=new Vector2(f.tan.Y,-f.tan.X)*Side;
            var q=f.at+n*radial+(Curved?Vector2.Zero:f.tan*along);return new Vector3(q.X,p.Y,q.Y);
        }
        public Vector3 Normal(Vector3 p,Vector3 n)
        {
            const float e=.03f;
            var x=(Map(p+Vector3.Right*e)-Map(p-Vector3.Right*e))/(2*e);
            var y=(Map(p+Vector3.Up*e)-Map(p-Vector3.Up*e))/(2*e);
            var z=(Map(p+Vector3.Back*e)-Map(p-Vector3.Back*e))/(2*e);
            var jacobian=new Basis(x,y,z);
            if(MathF.Abs(jacobian.Determinant())<.00001f)
                throw new InvalidDataException($"Non-invertible head chart {Id}: x={x}, y={y}, z={z}, mapped={Map(p)}");
            return (jacobian.Inverse().Transposed()*n).Normalized();
        }
        public Vector3 Seam=>Map(Template.Seam);
        public Vector3[] SeamRing=>Template.Ring.Select(Map).ToArray();
        public bool Crossing=>Template.Name.EndsWith("crossing",StringComparison.Ordinal);
        public Aabb CutBox
        {
            get
            {
                var f=Frame(U);var n=new Vector2(f.tan.Y,-f.tan.X)*Side;var c=f.at+n*(Host.Zone.S.Width/2);
                return new Aabb(new Vector3(c.X-.95f,Invert-.35f,c.Y-.95f),new Vector3(1.9f,2.35f,1.9f)).Grow(Crossing?Host.Zone.S.Ledge:0);
            }
        }
        public List<List<Func<Vector3,float>>> Cuts()
        {
            var f=Frame(U);var along=new Vector3(f.tan.X,0,f.tan.Y)*Side*Bend;
            var normal=new Vector3(f.tan.Y,0,-f.tan.X)*Side;var centre=new Vector3(f.at.X,0,f.at.Y);
            float PlanX(Vector3 p)=>(p-centre).Dot(along);
            float PlanS(Vector3 p)=>(p-centre).Dot(normal);
            var memo=new Dictionary<Vector3,Vector2>();
            Vector2 Local(Vector3 p)
            {
                if(!Curved)return new Vector2(PlanX(p),-PlanS(p));
                if(memo.TryGetValue(p,out var found))return found;
                float x=PlanX(p),z=-PlanS(p);const float e=.02f;
                for(int i=0;i<8;i++)
                {
                    var at=new Vector3(x,p.Y,z);var error=Map(at)-p;
                    if(new Vector2(error.X,error.Z).LengthSquared()<1e-9f)break;
                    var dx=(Map(at+Vector3.Right*e)-Map(at-Vector3.Right*e))/(2*e);
                    var dz=(Map(at+Vector3.Back*e)-Map(at-Vector3.Back*e))/(2*e);float det=dx.X*dz.Z-dx.Z*dz.X;
                    // The curved chart folds at the bend's centre, metres behind the wall. A vertex of the
                    // area's drawn mesh out there is no part of this mouth: its flat plan place (far outside
                    // the profile) answers for it. Throwing here stopped the whole network's construction.
                    if(MathF.Abs(det)<.00001f){x=PlanX(p);z=-PlanS(p);break;}
                    x-=Math.Clamp((error.X*dz.Z-error.Z*dz.X)/det,-1,1);
                    z-=Math.Clamp((dx.X*error.Z-dx.Z*error.X)/det,-1,1);
                }
                return memo[p]=new Vector2(x,z);
            }
            float X(Vector3 p)=>Local(p).X;
            float S(Vector3 p)=>-Local(p).Y;
            var points=Template.Profile;var planes=new List<Func<Vector3,float>>
            {
                p=>.85f-MathF.Abs(PlanX(p)),p=>p.Y-Invert+.02f,p=>Invert+1.62f-p.Y,
            };
            for(int i=0;i<points.Length;i++)
            {
                var a=points[i];var d=points[(i+1)%points.Length]-a;
                if(d.LengthSquared()<1e-12f)continue;
                var inward=new Vector2(-d.Y,d.X).Normalized();
                if(inward.Dot(new Vector2(0,.8f)-a)<0)inward=-inward;
                var nn=inward;var origin=a;
                planes.Add(p=>nn.Dot(new Vector2(X(p),p.Y-Invert)-origin)+.012f);
            }
            float hw=Host.Zone.S.Width/2;
            planes.Add(p=>S(p)-(hw-.45f));planes.Add(p=>hw+1.1f-S(p));
            var result=new List<List<Func<Vector3,float>>>{planes};
            if(Crossing)
            {
                float walk=Host.Zone.S.LedgeY,ledge=Host.Zone.S.Ledge;
                result.Add(new(){p=>X(p)+.403f,p=>.403f-X(p),p=>S(p)-(hw-ledge-.12f),p=>hw+.25f-S(p),
                                 p=>p.Y-(walk-.32f),p=>walk+.12f-p.Y});
            }
            return result;
        }
    }
    public sealed class Collector
    {
        public string Id="",Destination="",DestinationKind="";public Vector2[] Path=Array.Empty<Vector2>();
        public float[] Along=Array.Empty<float>();public float InvertStart,InvertEnd;
        public float Length=>Along[^1];
        public Vector3 At(float u)
        {
            int at=Array.BinarySearch(Along,Math.Clamp(u,0,Length));int i=Math.Clamp(at<0?~at-1:at,0,Path.Length-2);
            float t=(Math.Clamp(u,0,Length)-Along[i])/Math.Max(Along[i+1]-Along[i],1e-6f);
            var p=Path[i].Lerp(Path[i+1],t);return new Vector3(p.X,Mathf.Lerp(InvertStart,InvertEnd,Math.Clamp(u/Length,0,1)),p.Y);
        }
        public Vector3 Tangent(float u)
        {
            var t=At(Math.Min(Length,u+.12f))-At(Math.Max(0,u-.12f));return t.Normalized();
        }
    }
    public sealed record Inlet(string Id,Vector3 From,Vector3 To,string Collector,float U,float Diameter,Vector2[]? Via=null);
    public sealed class Network
    {
        public string Source="",Kit="";public readonly Dictionary<string,Host> Hosts=new();
        public readonly Dictionary<string,Template> Templates=new();public readonly List<Head> Heads=new();
        public readonly List<Collector> Collectors=new();public readonly List<Inlet> Inlets=new();
        public Dictionary<string,Head[]> ByArea=new();
    }
    private static Vector2 V2(JsonElement p)=>new(p[0].GetSingle(),p[1].GetSingle());
    private static Vector3 V3(JsonElement p)=>new(p[0].GetSingle(),p[1].GetSingle(),p[2].GetSingle());
    private static string S(JsonElement e,string key)=>e.GetProperty(key).GetString()!;
    public static Network Read(string source,string kit,RuienData data)
    {
        using var doc=JsonDocument.Parse(Godot.FileAccess.GetFileAsString(source));
        using var td=JsonDocument.Parse(Godot.FileAccess.GetFileAsString(kit+"/templates.json"));
        var root=doc.RootElement;var net=new Network{Source=source,Kit=kit};
        if(root.GetProperty("failures").GetArrayLength()!=0)throw new InvalidDataException("Unresolved drainage construction failures");
        foreach(var e in td.RootElement.EnumerateObject())
        {
            var v=e.Value;net.Templates[e.Name]=new Template{Name=e.Name,Invert=v.GetProperty("invert").GetSingle(),HalfWidth=v.GetProperty("halfWidth").GetSingle(),
                Walk=v.GetProperty("walk").GetSingle(),Spring=v.TryGetProperty("spring",out var spring)?spring.GetSingle():(e.Name.StartsWith("g")?-3.1f:-2.7f),
                Crown=v.TryGetProperty("crown",out var crown)?crown.GetSingle():-.9f,Seam=V3(v.GetProperty("seam")),Tangent=V3(v.GetProperty("tangent")),
                Profile=v.GetProperty("eggProfile").EnumerateArray().Select(V2).ToArray(),Ring=v.GetProperty("seamRing").EnumerateArray().Select(V3).ToArray()};
        }
        foreach(var e in root.GetProperty("hosts").EnumerateObject())
        {
            var v=e.Value;var path=v.GetProperty("path").EnumerateArray().Select(V2).ToArray();var section=data.Classes[S(v,"cls")];
            if(v.TryGetProperty("walkwaySide",out var side))section=section with{WalkwaySide=side.GetInt32()};
            if(v.TryGetProperty("spring",out var spring))section=section with{Spring=spring.GetSingle()};
            if(v.TryGetProperty("walk",out var walk))section=section with{LedgeY=walk.GetSingle()};
            var zone=new RuienData.Zone{Id=e.Name,S=section,Path=path,Along=new float[path.Length]};
            for(int i=1;i<path.Length;i++)zone.Along[i]=zone.Along[i-1]+path[i].DistanceTo(path[i-1]);
            net.Hosts[e.Name]=new Host{Id=e.Name,Area=S(v,"area"),Zone=zone,Flat=v.TryGetProperty("flat",out var flat)&&flat.GetBoolean()};
        }
        foreach(var h in root.GetProperty("heads").EnumerateArray())
            net.Heads.Add(new Head{Id=S(h,"id"),Area=S(h,"area"),Host=net.Hosts[S(h,"host")],Template=net.Templates[S(h,"template")],
                U=h.GetProperty("u").GetSingle(),Invert=h.GetProperty("invert").GetSingle(),Side=h.GetProperty("side").GetInt32(),Bend=h.GetProperty("bend").GetInt32(),
                Flat=h.TryGetProperty("flat",out var flat)&&flat.GetBoolean(),Curved=h.TryGetProperty("curved",out var curved)&&curved.GetBoolean()});
        foreach(var d in root.GetProperty("collectors").EnumerateArray())
        {
            var path=d.GetProperty("path").EnumerateArray().Select(V2).ToArray();
            var c=new Collector{Id=S(d,"id"),Path=path,Along=new float[path.Length],InvertStart=d.GetProperty("invertStart").GetSingle(),InvertEnd=d.GetProperty("invertEnd").GetSingle(),
                Destination=S(d.GetProperty("destination"),"id"),DestinationKind=S(d.GetProperty("destination"),"kind")};
            for(int i=1;i<path.Length;i++)c.Along[i]=c.Along[i-1]+path[i].DistanceTo(path[i-1]);
            net.Collectors.Add(c);
        }
        foreach(var d in root.GetProperty("inlets").EnumerateArray())net.Inlets.Add(new Inlet(S(d,"id"),V3(d.GetProperty("fromPoint")),V3(d.GetProperty("toPoint")),S(d,"collector"),d.GetProperty("u").GetSingle(),d.GetProperty("diameter").GetSingle(),d.TryGetProperty("horizontalPath",out var via)?via.EnumerateArray().Select(V2).ToArray():null));
        net.ByArea=net.Heads.GroupBy(h=>h.Area).ToDictionary(g=>g.Key,g=>g.ToArray());return net;
    }
    /// <summary>Cut visible masonry and its matching collision at the head's own clear bore and covered gutter.</summary>
    public static int Trim(Network net,Godot.Collections.Array arrays,string area,Aabb bounds)
    {
        if(!net.ByArea.TryGetValue(area,out var heads))return 0;
        var regions=new List<QuayNotch.Region>();
        foreach(var h in heads)
        {
            var box=h.CutBox;if(!box.Intersects(bounds))continue;
            foreach(var cut in h.Cuts())regions.Add(new QuayNotch.Region(box,cut));
        }
        return QuayNotch.CutSurfaceRegions(arrays,Transform3D.Identity,regions);
    }
}
