using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.World.Ruien;

/// <summary>Reusable supported walks and dressed street surrounds; collision comes from their visible solids.</summary>
public static partial class RuienConnections
{
    public static Node3D Build(JsonElement spec,RuienData.Area area)
    {
        var root=new Node3D{Name="ruien_connections_"+area.Id};
        AddExportFloors(root,area);
        var stone=new SurfaceTool();var iron=new SurfaceTool();var paving=new SurfaceTool();var brick=new SurfaceTool();
        foreach(var s in new[]{stone,iron,paving,brick})s.Begin(Mesh.PrimitiveType.Triangles);
        bool hasStone=false,hasIron=false,hasPaving=false,hasBrick=false;
        if(spec.TryGetProperty("landingBlocks",out var landingBlocks))
        {
            int index=0;
            foreach(var block in landingBlocks.EnumerateArray())
            {
                Vector3 V(JsonElement v)=>new(v[0].GetSingle(),v[1].GetSingle(),v[2].GetSingle());
                var across=block.GetProperty("across");var along=block.GetProperty("along");
                var lateral=new Vector3(across[0].GetSingle(),0,across[1].GetSingle());
                var basis=new Basis(lateral,Vector3.Up,lateral.Cross(Vector3.Up));
                var size=V(block.GetProperty("size"));
                bool isBrick=block.TryGetProperty("brick",out var material)&&material.GetBoolean();
                string family=isBrick?"ruien_brick_stretcher":"ruien_bluestone";
                var mesh=RuienGeometryCache.Get(RuienData.AreasFile,area.Id+"/portal-landing/"+index++,()=>BevelMesh.Box(size,.010f,RuienMaterials.Get(family)));
                (isBrick?brick:stone).AppendFrom(mesh,0,new Transform3D(basis,V(block.GetProperty("at"))));
                if(isBrick)hasBrick=true;else hasStone=true;
            }
        }
        void Box(SurfaceTool s,Vector3 p,Vector3 size,float radius,Basis? basis=null)
        {
            var m=BevelMesh.Box(size,radius,RuienMaterials.Get(s==iron?"ruien_iron":s==brick?"ruien_brick_stretcher":"ruien_bluestone"));
            s.AppendFrom(m,0,new Transform3D(basis??Basis.Identity,p));
            if(s==iron)hasIron=true;else if(s==brick)hasBrick=true;else hasStone=true;
        }
        if(spec.TryGetProperty("bridgeRailPosts",out var railPosts))
            foreach(var p in railPosts.EnumerateArray())
            {
                var at=new Vector3(p[0].GetSingle(),p[1].GetSingle(),p[2].GetSingle());
                Box(iron,at+Vector3.Up*.54f,new Vector3(.065f,1.08f,.065f),.003f);
                Box(iron,at+Vector3.Up*.021f,new Vector3(.13f,.032f,.13f),.003f);
                Box(iron,at+Vector3.Up*1.087f,new Vector3(.083f,.025f,.083f),.003f);
            }
        if(spec.TryGetProperty("landingRails",out var landingRails))
            foreach(var rail in landingRails.EnumerateArray())
            {
                Vector3 V(JsonElement v)=>new(v[0].GetSingle(),v[1].GetSingle(),v[2].GetSingle());
                var a=V(rail.GetProperty("from"));var b=V(rail.GetProperty("to"));float length=a.DistanceTo(b);
                if(length<.05f)continue;
                var basis=Basis.LookingAt((b-a).Normalized());
                Box(iron,(a+b)/2+Vector3.Up*1.03f,new Vector3(.035f,.035f,length),.003f,basis);
                int count=Math.Max(1,(int)MathF.Ceiling(length/.75f));
                for(int i=0;i<=count;i++)
                {
                    var p=a.Lerp(b,i/(float)count);
                    Box(iron,p+Vector3.Up*.525f,new Vector3(.032f,1.02f,.032f),.002f,basis);
                    Box(iron,p+Vector3.Up*.021f,new Vector3(.11f,.028f,.10f),.002f,basis);
                }
            }
        if(spec.TryGetProperty("walkConnections",out var walks))
        {
            Vector3 V(JsonElement v)=>new(v[0].GetSingle(),v[1].GetSingle(),v[2].GetSingle());
            var all=walks.EnumerateArray().Select(w=>(a:V(w.GetProperty("from")),b:V(w.GetProperty("to")),width:w.GetProperty("width").GetSingle(),bed:w.GetProperty("bed").GetSingle())).ToArray();
            for(int wi=0;wi<all.Length;wi++)
            {
                var w=all[wi];var a=w.a;var b=w.b;float width=w.width,bed=w.bed,length=a.DistanceTo(b);
                var basis=Basis.LookingAt((b-a).Normalized());
                int count=(int)MathF.Ceiling(length/.75f);
                for(int i=0;i<count;i++)
                {
                    var p=a.Lerp(b,(i+.5f)/count);
                    Box(stone,p-Vector3.Up*.14f,new Vector3(width,.28f,length/count+.003f),.012f,basis);
                    RuienPaving.Rectangle(paving,new Transform3D(basis,p),width-.09f,length/count-.005f,Vector3.Zero);hasPaving=true;
                }
                // The jointed flags bear on two iron I-girders, not on unsupported stone joints.
                foreach(float side in new[]{-1f,1f})
                {
                    var off=basis.X*side*width*.32f;var mid=(a+b)/2+off;
                    Box(iron,mid-Vector3.Up*.289f,new Vector3(.13f,.018f,length),.002f,basis);
                    Box(iron,mid-Vector3.Up*.374f,new Vector3(.016f,.152f,length),.002f,basis);
                    Box(iron,mid-Vector3.Up*.459f,new Vector3(.13f,.018f,length),.002f,basis);
                }
                foreach(float u in new[]{.25f,.65f})
                {
                    var p=a.Lerp(b,u);float h=p.Y-bed-.68f;
                    Box(stone,new Vector3(p.X,bed+h/2,p.Z),new Vector3(.39f,h,.39f),.008f);
                    int blocks=(int)MathF.Ceiling(h/.42f);
                    for(int i=0;i<blocks;i++)
                        Box(stone,new Vector3(p.X,bed+(i+.5f)*h/blocks,p.Z),new Vector3(.44f,h/blocks-.003f,.44f),.010f);
                    Box(stone,p-Vector3.Up*.59f,new Vector3(width-.10f,.18f,.55f),.012f,basis);
                    Box(iron,p-Vector3.Up*.484f,new Vector3(width-.14f,.032f,.46f),.003f,basis);
                }
                // Open a side rail wherever another supported walk joins it. Each remaining span gets end posts.
                foreach(float side in new[]{-1f,1f})
                {
                    var off=basis.X*side*(width/2-.04f);var spans=new List<(float lo,float hi)>{(.015f,.985f)};
                    for(int oi=0;oi<all.Length;oi++)
                    {
                        if(oi==wi)continue;var other=all[oi];var dir=(other.b-other.a).Normalized();var across=Vector3.Up.Cross(dir);
                        var q=a+off-other.a;var delta=b-a;float lo=0,hi=1;
                        bool Clip(float value,float slope,float min,float max)
                        {
                            if(MathF.Abs(slope)<1e-6f)return value>=min&&value<=max;
                            float x=(min-value)/slope,y=(max-value)/slope;if(x>y)(x,y)=(y,x);
                            lo=Math.Max(lo,x);hi=Math.Min(hi,y);return lo<hi;
                        }
                        if(!Clip(q.Dot(dir),delta.Dot(dir),-.08f,other.a.DistanceTo(other.b)+.08f) ||
                           !Clip(q.Dot(across),delta.Dot(across),-other.width/2-.06f,other.width/2+.06f))continue;
                        var left=new List<(float,float)>();
                        foreach(var span in spans)
                        {
                            if(hi<=span.lo||lo>=span.hi){left.Add(span);continue;}
                            if(lo>span.lo)left.Add((span.lo,lo));if(hi<span.hi)left.Add((hi,span.hi));
                        }
                        spans=left;
                    }
                    foreach(var (lo,hi) in spans)
                    {
                        if((hi-lo)*length<.04f)continue;
                        Box(iron,a.Lerp(b,(lo+hi)/2)+off+Vector3.Up*1.03f,new Vector3(.035f,.035f,length*(hi-lo)),.003f,basis);
                        int posts=Math.Max(1,(int)MathF.Ceiling(length*(hi-lo)/.7f));
                        for(int i=0;i<=posts;i++)
                        {
                            var p=a.Lerp(b,Mathf.Lerp(lo,hi,i/(float)posts))+off;
                            Box(iron,p+Vector3.Up*.525f,new Vector3(.032f,1.02f,.032f),.002f,basis);
                            Box(iron,p+Vector3.Up*.021f,new Vector3(.11f,.028f,.10f),.002f,basis);
                        }
                    }
                }
            }
        }
        if(spec.TryGetProperty("stairSurrounds",out var surrounds))
            foreach(var id in surrounds.EnumerateArray())
            {
                var way=area.Ways.Single(w=>w.Id==(id.ValueKind==JsonValueKind.String?id.GetString():id.GetProperty("id").GetString()));var h=way.Hole;
                // A relocated flight exposes the side formerly against the hall wall. Close and support it.
                var section=area.StairZone(way)?.S ?? area.Zones[0].S;
                int steps=id.ValueKind==JsonValueKind.Object && id.TryGetProperty("steps",out var st)?st.GetInt32():(int)MathF.Round((way.Top.Y-.18f-way.Bottom.Y)/.18f);
                float going=id.ValueKind==JsonValueKind.Object && id.TryGetProperty("going",out var go)?go.GetSingle():.27f;
                float bed=section.Bed+.25f;
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
        // Hidden fills: solid brick in a hollow of the lining's masonry, wholly behind its visible faces (#213).
        if(spec.TryGetProperty("throatFills",out var fills))
            foreach(var fill in fills.EnumerateArray())
            {
                Vector3 V(JsonElement v)=>new(v[0].GetSingle(),v[1].GetSingle(),v[2].GetSingle());
                var lo=V(fill.GetProperty("min"));var hi=V(fill.GetProperty("max"));
                Box(brick,(lo+hi)/2,hi-lo,.01f);
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
