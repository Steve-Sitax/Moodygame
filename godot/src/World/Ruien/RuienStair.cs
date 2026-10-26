using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.World.Ruien;

/// <summary>A1: a lined flight behind the gallery wall, with a vaulted side entry and flush twin lids.</summary>
public static class RuienStair
{
    public static List<Func<Vector3,float>> Cut(RuienData.Way w)
    {
        float z=w.Bottom.Z+.6f,half=.60f,spring=w.Bottom.Y+1.50f;
        var planes=new List<Func<Vector3,float>>{p=>p.X-w.Top.X+.85f,p=>w.LandingPath[1].X+.03f-p.X,
            p=>p.Z-z+half,p=>z+half-p.Z,p=>p.Y-w.Bottom.Y-.015f};
        // A convex arch opening, including the returns through the thick host wall/vault.
        for(int i=0;i<=32;i++)
        {
            float a=i*MathF.PI/32;var n=new Vector2(MathF.Cos(a),MathF.Sin(a));
            planes.Add(p=>half-n.Dot(new Vector2(p.Z-z,p.Y-spring)));
        }
        return planes;
    }

    /// <summary>
    /// How far a point stands inside the gallery's open section (metres, positive in the air): the wall face up to the
    /// springing, then the basket vault. Native pieces set into its wall are cut `proud` out from that face, so the
    /// exported relief (within about a centimetre of it) meets them without a gap.
    /// </summary>
    public static Func<Vector3,float>? GalleryAir(RuienData.Zone? zone,float proud=.02f)
    {
        if(zone is not { Kind: "line" })return null;
        var s=zone.S;float wall=s.Width/2;
        return p=>
        {
            if(p.Y<s.LedgeY-.06f || p.Y>s.Crown)return -1;
            float t=Math.Clamp((p.Y-s.Spring)/(s.Crown-s.Spring),0,1);
            return zone.Inside(new Vector2(p.X,p.Z),out _)-wall*(1-MathF.Sqrt(1-t*t))-proud;
        };
    }

    public static Node3D Build(RuienData.Way w,RuienData.Zone? gallery=null)
    {
        var root=new Node3D{Name="keeper_stair_"+w.Id,Position=w.Top};
        // The side entry's jambs and arch are set into the gallery wall: trimmed to its curved face, not standing proud.
        var air=GalleryAir(gallery);
        Func<Vector3,float>? flush=air==null?null:p=>air(p+w.Top);
        float length=w.Bottom.Z-w.Top.Z,drop=w.Top.Y-w.Bottom.Y,width=w.Hole.Size.X;
        var stone=new SurfaceTool();var iron=new SurfaceTool();var brick=new SurfaceTool();var paving=new SurfaceTool();
        foreach(var s in new[]{stone,iron,brick,paving})s.Begin(Mesh.PrimitiveType.Triangles);
        void Box(SurfaceTool s,Vector3 p,Vector3 size,float radius,Basis? basis=null)
        {
            var m=BevelMesh.Box(size,radius,RuienMaterials.Get(s==iron?"ruien_iron":s==brick?"ruien_brick_stretcher":"ruien_bluestone"));
            s.AppendFrom(m,0,new Transform3D(basis??Basis.Identity,p));
        }
        int steps=(int)MathF.Ceiling(drop/.18f);float rise=drop/steps,going=length/steps;
        for(int i=0;i<steps;i++)
        {
            float top=-(i+1)*rise,height=drop+top+.24f;
            Box(stone,new Vector3(0,top-height/2,(i+.5f)*going),new Vector3(width,height,going+.006f),.010f+.002f*MathF.Sin(i*1.7f));
        }
        float landing=length+.6f,exit=w.LandingPath[1].X-w.Top.X;
        Box(stone,new Vector3(exit/2,-drop-.12f,landing),new Vector3(exit+width,.24f,1.2f),.012f);
        RuienPaving.Rectangle(paving,new Transform3D(Basis.Identity,new Vector3(exit/2,-drop,landing)),exit+width-.06f,1.14f,w.Top);
        // Bonded retaining walls outside the flight. Lower east wall opens into the side-entry landing.
        foreach(float side in new[]{-1f,1f})
        {
            float wallTop=RuienSurround.Bottom-.015f,wallBase=-drop-.16f;
            Box(brick,new Vector3(side*(width/2+.14f),(wallBase+wallTop)/2,length/2),new Vector3(.28f,wallTop-wallBase,length),.009f);
            var tilt=new Basis(Vector3.Right,MathF.Atan2(drop,length));
            // The closed lids leave a flush quay: handrails begin below their underside, not above the paving.
            float railStart=MathF.Ceiling(1.05f/rise)*going,railMid=(railStart+length)/2;
            Box(iron,new Vector3(side*(width/2-.09f),-railMid*drop/length+.93f,railMid),new Vector3(.035f,.035f,(length-railStart)*MathF.Sqrt(1+drop*drop/(length*length))),.003f,tilt);
            for(int i=(int)MathF.Round(railStart/going);i<steps;i+=4)
                Box(iron,new Vector3(side*(width/2-.09f),-i*rise+.465f,i*going),new Vector3(.028f,.93f,.028f),.002f);
        }
        // Inclined barrel ceiling; the first four metres are open beneath the lifting lids.
        // Even the outer crown stays below the paving at the covered end of the hatch.
        float Ceiling(float z)=>-Math.Min(drop,z*drop/length)+1.88f;
        Vault(brick,new Vector3(0,Ceiling(w.Hole.Size.Y),w.Hole.Size.Y),new Vector3(0,Ceiling(length),length),Vector3.Right,width/2,.27f,.22f);
        Vault(brick,new Vector3(0,Ceiling(length),length),new Vector3(0,Ceiling(length+1.2f),length+1.2f),Vector3.Right,width/2,.27f,.22f);
        // The side niche is entirely behind the wall. Its crown meets the cut gallery vault.
        float spring=-drop+1.5f;
        // Level through the gallery wall's depth, so the soffit is the arch cut in its curved face (Cut). It runs out
        // past the cut and is trimmed flush with the vault: ended at `exit`, it stopped short of the face at the crown
        // and left a slot open behind the gallery vault. It rises behind the wall to meet the flight.
        float level=exit-1.25f;
        Vault(brick,new Vector3(-width/2,spring+1.10f,landing),new Vector3(level,spring,landing),Vector3.Back,.60f,.60f,.24f);
        Vault(brick,new Vector3(level,spring,landing),new Vector3(exit+(flush==null?0:.3f),spring,landing),Vector3.Back,.60f,.60f,.24f);
        // Leave the full flight-width opening in the near jamb: the stair turns here into the niche.
        Box(brick,new Vector3((exit+width/2)/2,-drop+1.35f,landing-.74f),new Vector3(exit-width/2,2.7f,.28f),.010f);
        Box(brick,new Vector3((exit-width/2)/2,-drop+1.35f,landing+.74f),new Vector3(exit+width/2,2.7f,.28f),.010f);
        Box(brick,new Vector3(-width/2-.14f,-drop+1.625f,landing),new Vector3(.28f,3.25f,1.2f),.009f);
        Add(root,stone,"ruien_bluestone",true);Add(root,iron,"ruien_iron",true);Add(root,brick,"ruien_brick_stretcher",true,trim:flush);
        Add(root,paving,"ruien_setts",true,metric:false);
        root.AddChild(new RuienHatch{Way=w});
        return root;
    }

    internal static void Vault(SurfaceTool st,Vector3 a,Vector3 b,Vector3 across,float half,float rise,float thick)
    {
        const int count=48;float along=0;
        Vector3 P(Vector3 c,int i,float t){float theta=i*MathF.PI/count;return c+across*((half+t)*MathF.Cos(theta))+Vector3.Up*((rise+t)*MathF.Sin(theta));}
        void Quad(Vector3 p,Vector3 q,Vector3 r,Vector3 s,float u,float v,float du,float dv)
        {
            var normal=(q-p).Cross(r-p).Normalized();
            foreach(var (point,uv) in new[]{(p,new Vector2(u,v)),(q,new Vector2(u+du,v)),(r,new Vector2(u+du,v+dv)),(p,new Vector2(u,v)),(r,new Vector2(u+du,v+dv)),(s,new Vector2(u,v+dv))})
            {st.SetNormal(normal);st.SetUV(uv);st.AddVertex(point);}
        }
        float depth=a.DistanceTo(b),edge=.008f;
        var profile=new[]{new Vector2(0,edge),new Vector2(.003f,.002f),new Vector2(edge,0),
            new Vector2(thick-edge,0),new Vector2(thick-.003f,.002f),new Vector2(thick,edge),
            new Vector2(thick,depth-edge),new Vector2(thick-.003f,depth-.002f),new Vector2(thick-edge,depth),
            new Vector2(edge,depth),new Vector2(.003f,depth-.002f),new Vector2(0,depth-edge)};
        for(int i=0;i<count;i++)
        {
            float step=P(a,i,0).DistanceTo(P(a,i+1,0)),around=0;
            for(int j=0;j<profile.Length;j++)
            {
                var q=profile[j];var r=profile[(j+1)%profile.Length];
                var c=a.Lerp(b,q.Y/depth);var d=a.Lerp(b,r.Y/depth);float width=q.DistanceTo(r);
                Quad(P(c,i,q.X),P(c,i+1,q.X),P(d,i+1,r.X),P(d,i,r.X),along,around,step,width);
                around+=width;
            }
            along+=step;
        }
        // Spring faces are hidden against the closed jambs but remain solid from below.
        foreach(int i in new[]{0,count})Quad(P(a,i,0),P(a,i,thick),P(b,i,thick),P(b,i,0),0,0,thick,depth);
    }

    internal static void Add(Node3D root,SurfaceTool tool,string family,bool solid,bool metric=true,Func<Vector3,float>? trim=null)
    {
        var mesh=tool.Commit();var a=mesh.SurfaceGetArrays(0);
        // Trimmed before the brick is charted, so the courses and the collision both follow the cut face.
        if(trim!=null)RuienPatch.Trim(a,trim);
        var p=a[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        if(metric)
        {
            var tile=RuienTextures.Families()[family[6..]];
            a[(int)Mesh.ArrayType.TexUV]=a[(int)Mesh.ArrayType.TexUV].AsVector2Array().Select(uv=>uv/new Vector2(tile.TileU,tile.TileV)).ToArray();
            if(a[(int)Mesh.ArrayType.Color].VariantType==Variant.Type.Nil)
                a[(int)Mesh.ArrayType.Color]=p.Select(v=>new Color(.32f,.015f,.14f,0)).ToArray();
            // Separate boxes, vaults and reveals share one unfolded chart: courses continue round every corner.
            if(family.StartsWith("ruien_brick"))RuienUnfold.Apply(a,family,null,0);
        }
        RuienUv.Repair(a,family);
        var done=new ArrayMesh();done.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,a);done.SurfaceSetMaterial(0,RuienMaterials.Get(family));
        done.SurfaceSetName(0,family);
        root.AddChild(new MeshInstance3D{Mesh=done,Layers=Ruien.Layer,CastShadow=GeometryInstance3D.ShadowCastingSetting.Off});
        if(solid)
        {
            var body=new StaticBody3D{CollisionLayer=Solid.Layer,CollisionMask=0};
            body.AddChild(new CollisionShape3D{Shape=new ConcavePolygonShape3D{Data=done.GetFaces(),BackfaceCollision=true}});root.AddChild(body);
        }
    }
}
