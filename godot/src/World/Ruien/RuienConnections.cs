using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.World.Ruien;

/// <summary>Reusable supported walks and dressed street surrounds; collision comes from their visible solids.</summary>
public static class RuienConnections
{
    public static Node3D Build(JsonElement spec,RuienData.Area area)
    {
        var root=new Node3D{Name="ruien_connections_"+area.Id};
        var stone=new SurfaceTool();var iron=new SurfaceTool();var paving=new SurfaceTool();var brick=new SurfaceTool();
        foreach(var s in new[]{stone,iron,paving,brick})s.Begin(Mesh.PrimitiveType.Triangles);
        bool hasStone=false,hasIron=false,hasPaving=false,hasBrick=false;
        void Box(SurfaceTool s,Vector3 p,Vector3 size,float radius,Basis? basis=null)
        {
            var m=BevelMesh.Box(size,radius,RuienMaterials.Get(s==iron?"ruien_iron":s==brick?"ruien_brick_stretcher":"ruien_bluestone"));
            s.AppendFrom(m,0,new Transform3D(basis??Basis.Identity,p));
            if(s==iron)hasIron=true;else if(s==brick)hasBrick=true;else hasStone=true;
        }
        if(spec.TryGetProperty("walkConnections",out var walks))
            foreach(var w in walks.EnumerateArray())
            {
                Vector3 V(JsonElement v)=>new(v[0].GetSingle(),v[1].GetSingle(),v[2].GetSingle());
                var a=V(w.GetProperty("from"));var b=V(w.GetProperty("to"));float width=w.GetProperty("width").GetSingle();
                float bed=w.GetProperty("bed").GetSingle();var basis=Basis.LookingAt((b-a).Normalized());
                int count=(int)MathF.Ceiling(a.DistanceTo(b)/.75f);
                for(int i=0;i<count;i++)
                {
                    var p=a.Lerp(b,(i+.5f)/count);
                    Box(stone,p-Vector3.Up*.14f,new Vector3(width,.28f,a.DistanceTo(b)/count+.003f),.012f,basis);
                    RuienPaving.Rectangle(paving,new Transform3D(basis,p),width-.09f,a.DistanceTo(b)/count-.005f,Vector3.Zero);hasPaving=true;
                }
                foreach(float u in new[]{.25f,.65f})
                {
                    var p=a.Lerp(b,u);float h=p.Y-bed-.28f;
                    Box(stone,new Vector3(p.X,bed+h/2,p.Z),new Vector3(.42f,h,.42f),.012f);
                }
                // Both exposed sides have rails; each end remains open to its landing.
                foreach(float side in new[]{-1f,1f})
                {
                    var off=basis.X*side*(width/2-.04f);
                    Box(iron,a.Lerp(b,.44f)+off+Vector3.Up*1.03f,new Vector3(.035f,.035f,a.DistanceTo(b)*.80f),.003f,basis);
                    for(int i=0;i<=count;i++)Box(iron,a.Lerp(b,.04f+.80f*i/count)+off+Vector3.Up*.51f,new Vector3(.032f,1.02f,.032f),.002f);
                }
            }
        if(spec.TryGetProperty("stairSurrounds",out var surrounds))
            foreach(var id in surrounds.EnumerateArray())
            {
                var way=area.Ways.Single(w=>w.Id==id.GetString());var h=way.Hole;
                // A relocated flight exposes the side formerly against the hall wall. Close and support it.
                const int steps=19;const float going=.27f,bed=-5.85f;
                float rise=(way.Top.Y-.18f-way.Bottom.Y)/steps;
                for(int i=0;i<steps;i++)
                {
                    float z0=way.Bottom.Z+(i==0?0:.3f+(i-1)*going);
                    float z1=i==steps-1?h.End.Y:way.Bottom.Z+.3f+i*going+.03f;
                    float top=way.Bottom.Y+(i+1)*rise-.24f;
                    Box(brick,new Vector3(way.Bottom.X,(bed+top)/2,(z0+z1)/2),new Vector3(h.Size.X-.08f,top-bed,z1-z0),.009f);
                }
                // The complete street frame is the shared RuienSurround kit, also used by the keeper and grates.
            }
        if(spec.TryGetProperty("archBackings",out var backings))
            foreach(var backing in backings.EnumerateArray())
            {
                Vector3 V(JsonElement v)=>new(v[0].GetSingle(),v[1].GetSingle(),v[2].GetSingle());
                var mortar=new SurfaceTool();mortar.Begin(Mesh.PrimitiveType.Triangles);
                RuienStair.Vault(mortar,V(backing.GetProperty("from")),V(backing.GetProperty("to")),Vector3.Right,
                    backing.GetProperty("half").GetSingle(),backing.GetProperty("rise").GetSingle(),backing.GetProperty("thickness").GetSingle());
                RuienStair.Add(root,mortar,"ruien_brick_header",true);
            }
        var solid=new List<Vector3>();
        foreach(var (s,family,used) in new[]{(stone,"ruien_bluestone",hasStone),(iron,"ruien_iron",hasIron),(paving,"ruien_setts",hasPaving),(brick,"ruien_brick_stretcher",hasBrick)})
        {
            if(!used)continue;
            var mesh=s.Commit();var arr=mesh.SurfaceGetArrays(0);var v=arr[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            if(s!=paving)
            {
                float tile=s==iron?.9f:2.4f;
                arr[(int)Mesh.ArrayType.TexUV]=arr[(int)Mesh.ArrayType.TexUV].AsVector2Array().Select(uv=>uv/tile).ToArray();
                arr[(int)Mesh.ArrayType.Color]=v.Select(p=>new Color(p.Y<0?.28f:.10f,0,.15f,0)).ToArray();
                if(s==brick)
                {
                    var normals=arr[(int)Mesh.ArrayType.Normal].AsVector3Array();
                    var texture=RuienTextures.Families()["brick_stretcher"];
                    var uv=new Vector2[v.Length];
                    for(int i=0;i<v.Length;i++)
                    {
                        var n=normals[i];var u=n.Cross(MathF.Abs(n.Y)<.8f?Vector3.Up:Vector3.Right).Normalized();var t=n.Cross(u);
                        uv[i]=new Vector2(v[i].Dot(u)/texture.TileU,v[i].Dot(t)/texture.TileV);
                    }
                    arr[(int)Mesh.ArrayType.TexUV]=uv;
                }
            }
            var done=new ArrayMesh();done.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,arr);done.SurfaceSetMaterial(0,RuienMaterials.Get(family));
            root.AddChild(new MeshInstance3D{Mesh=done,Layers=Ruien.Layer,CastShadow=GeometryInstance3D.ShadowCastingSetting.Off});
            solid.AddRange(done.GetFaces());
        }
        if(solid.Count>0)
        {
            var body=new StaticBody3D{CollisionLayer=Solid.Layer,CollisionMask=0};
            body.AddChild(new CollisionShape3D{Shape=new ConcavePolygonShape3D{Data=solid.ToArray(),BackfaceCollision=true}});root.AddChild(body);
        }
        return root;
    }
}
