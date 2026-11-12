using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using Godot;
using Scheldemist.World.Ruien;

namespace Scheldemist.Native.World;

/// <summary>Checks hydraulic interiors against the assembled entrance foundations, independently of walking clearance.</summary>
public static class NativeRuienDrainClearance
{
    public sealed record Failure(string Id,string Entrance,Vector3 At);
    public sealed record Report(int Entrances,int Heads,int Collectors,int Inlets,int Samples,List<Failure> Errors);

    private static IEnumerable<Node> Descendants(Node root)
    {
        yield return root;
        foreach(var child in root.GetChildren())foreach(var node in Descendants(child))yield return node;
    }

    public static async Task<Report> Run(Node scene,RuienDrainNetwork.Network net)
    {
        var nodes=Descendants(scene).ToArray();
        var solids=new Dictionary<StaticBody3D,(uint Layer,string Entrance)>();
        foreach(var body in nodes.OfType<StaticBody3D>())
        {
            string entrance="";
            for(Node? p=body;p!=null&&p!=scene;p=p.GetParent())
                if(p.Name.ToString().StartsWith("entrance_",StringComparison.Ordinal))entrance=p.Name.ToString();
            if(entrance.Length>0)solids.Add(body,(body.CollisionLayer,entrance));
        }
        uint used=0;foreach(var body in Descendants(scene.GetTree().Root).OfType<CollisionObject3D>())used|=body.CollisionLayer;
        uint mask=0;for(int bit=31;bit>=0;bit--)if((used&(1u<<bit))==0){mask=1u<<bit;break;}
        if(mask==0)throw new InvalidOperationException("No unused physics layer for entrance/drain proof");
        var errors=new List<Failure>();var reported=new HashSet<(string,string)>();int samples=0;
        // The game's SubViewport inherits its physics world; its explicit World3D property is null.
        var space=(scene as Viewport??scene.GetViewport()).FindWorld3D().DirectSpaceState;
        void Ray(string id,Vector3 a,Vector3 b)
        {
            if(a.DistanceSquaredTo(b)<1e-10f)return;
            samples++;
            using var ray=PhysicsRayQueryParameters3D.Create(a,b,mask);
            ray.HitBackFaces=true;ray.HitFromInside=true;
            var hit=space.IntersectRay(ray);
            if(hit.Count==0)return;
            var body=hit["collider"].AsGodotObject() as StaticBody3D;
            string entrance=body!=null&&solids.TryGetValue(body,out var item)?item.Entrance:"unknown";
            if(reported.Add((id,entrance)))errors.Add(new Failure(id,entrance,hit["position"].AsVector3()));
        }
        void Path(string id,Vector3[] points)
        {
            for(int i=0;i+1<points.Length;i++)Ray(id,points[i],points[i+1]);
        }
        // The exported kit uses this barrel chart. Check its seam before using it,
        // so a later kit change cannot silently make this diagnostic approximate.
        var barrel=new List<(Vector2 P,Vector2 T)>();
        for(int i=0;i<10;i++)barrel.Add((new Vector2(0,-.9f*i/9),new Vector2(0,-1)));
        for(int i=1;i<14;i++)
        {
            float a=Mathf.DegToRad(70)*i/13;
            barrel.Add((new Vector2(1.05f*(1-MathF.Cos(a)),-.9f-1.05f*MathF.Sin(a)),new Vector2(MathF.Sin(a),-MathF.Cos(a))));
        }
        for(int i=0;i<5;i++){var end=barrel[^1];barrel.Add((end.P+end.T*.18f,end.T));}
        var profile=net.Templates.Values.First().Profile;
        var sections=new[]{new Vector2(0,.8f)}.Concat(profile.Where((_,i)=>i%8==0).Select(p=>new Vector2(p.X*.94f,.8f+(p.Y-.8f)*.94f))).ToArray();
        try
        {
            foreach(var item in solids)item.Key.CollisionLayer=item.Value.Layer|mask;
            for(int i=0;i<3;i++)await scene.ToSignal(scene.GetTree(),SceneTree.SignalName.PhysicsFrame);
            foreach(var head in net.Heads)
            {
                var end=barrel[^1].P;
                var seam=new Vector3(end.X,head.Invert,end.Y-head.Template.HalfWidth);
                if(seam.DistanceTo(head.Template.Seam)>.005f)throw new InvalidOperationException("Drain kit barrel changed: "+head.Template.Name);
                foreach(var section in sections)
                {
                    var path=barrel.Select(row=>
                    {
                        var across=new Vector2(-row.T.Y,row.T.X);
                        var p=row.P+across*section.X;
                        return head.Map(new Vector3(p.X,head.Invert+section.Y,p.Y-head.Template.HalfWidth));
                    }).ToArray();
                    Path("head/"+head.Id,path);
                }
            }
            foreach(var collector in net.Collectors)
            {
                foreach(var section in sections)
                {
                    var path=collector.Along.Select(u=>
                    {
                        var t=collector.Tangent(u);var side=new Vector3(-t.Z,0,t.X).Normalized();
                        return collector.At(u)+side*section.X+Vector3.Up*section.Y;
                    }).ToArray();
                    Path("collector/"+collector.Id,path);
                }
            }
            // Call the construction's actual rounded path, without duplicating its elbow rules.
            var inletPath=typeof(RuienDrainNetwork).GetMethod("InletPath",BindingFlags.Static|BindingFlags.NonPublic)
                ??throw new MissingMethodException("RuienDrainNetwork.InletPath");
            foreach(var inlet in net.Inlets)
            {
                var path=(Vector3[])inletPath.Invoke(null,new object[]{inlet})!;
                Path("inlet/"+inlet.Id,path);
                foreach(var axis in new[]{Vector3.Right,Vector3.Up,Vector3.Back})foreach(int sign in new[]{-1,1})
                {
                    var shifted=path.Select((p,i)=>
                    {
                        var tangent=(path[Math.Min(path.Length-1,i+1)]-path[Math.Max(0,i-1)]).Normalized();
                        var across=axis-tangent*axis.Dot(tangent);
                        return p+across.Normalized()*(sign*inlet.Diameter*.45f);
                    }).ToArray();
                    Path("inlet/"+inlet.Id,shifted);
                }
            }
        }
        finally
        {
            foreach(var item in solids)item.Key.CollisionLayer=item.Value.Layer;
            for(int i=0;i<3;i++)await scene.ToSignal(scene.GetTree(),SceneTree.SignalName.PhysicsFrame);
        }
        return new Report(solids.Values.Select(v=>v.Entrance).Distinct().Count(),net.Heads.Count,net.Collectors.Count,net.Inlets.Count,samples,errors);
    }
}
