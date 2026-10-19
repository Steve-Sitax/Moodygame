using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.World.Ruien;

/// <summary>A reusable, north/south aligned keeper's stair: masonry treads, lined shaft, hatch and handrails.</summary>
public static class RuienStair
{
    public static List<Func<Vector3,float>> Cut(RuienData.Way w) => new()
    {
        p=>p.X-w.Hole.Position.X, p=>w.Hole.End.X-p.X,
        p=>p.Z-w.Hole.Position.Y, p=>w.Hole.End.Y-p.Z,
        p=>p.Y-w.Bottom.Y-.015f, p=>w.Top.Y+.3f-p.Y
    };

    public static Node3D Build(RuienData.Way w)
    {
        var root=new Node3D { Name="keeper_stair_"+w.Id, Position=w.Top };
        float length=w.Bottom.Z-w.Top.Z, drop=w.Top.Y-w.Bottom.Y, width=w.Hole.Size.X;
        var stone=new SurfaceTool(); var iron=new SurfaceTool(); var oak=new SurfaceTool();var paving=new SurfaceTool();
        foreach(var st in new[]{stone,iron,oak,paving}) st.Begin(Mesh.PrimitiveType.Triangles);
        void Box(SurfaceTool st,Vector3 at,Vector3 size,float bevel,float tilt=0)
        {
            var b=BevelMesh.Shared(size,bevel,RuienMaterials.Get(st==iron?"ruien_iron":st==oak?"ruien_oak":"ruien_bluestone"));
            st.AppendFrom(b,0,new Transform3D(new Basis(Vector3.Right,tilt),at));
        }
        int steps=(int)MathF.Ceiling(drop/.18f); float rise=drop/steps, going=length/steps;
        // Full blocks below the treads prevent the player seeing daylight between the risers.
        for(int i=0;i<steps;i++)
        {
            float top=-(i+1)*rise, height=drop+top+.22f;
            Box(stone,new Vector3(0,top-height/2,(i+.5f)*going),new Vector3(width,height,going+.008f),.009f);
            RuienPaving.Rectangle(paving,new Transform3D(Basis.Identity,new Vector3(0,top,(i+.5f)*going)),width-.08f,going-.06f,w.Top);
        }
        Box(stone,new Vector3(0,-drop-.11f,length+.575f),new Vector3(width,.22f,1.15f),.009f);
        RuienPaving.Rectangle(paving,new Transform3D(Basis.Identity,new Vector3(0,-drop,length+.575f)),width-.06f,1.09f,w.Top);
        // Retaining masonry on each side: individual dressed blocks and visible joints.
        for(int k=0;k<2;k++)
        {
            float x=(k==0?-1:1)*(width/2+.15f);
            for(int row=0;row<12;row++)
                for(int col=0;col<10;col++)
                {
                    float z=(col+.5f)*(length+1.1f)/10;
                    Box(stone,new Vector3(x,-drop+(row+.5f)*drop/12,z),new Vector3(.3f,drop/12-.008f,(length+1.1f)/10-.009f),.006f);
                }
            // The covered part has a ceiling more than two metres above the lower treads.
            Box(stone,new Vector3(x,.065f,2),new Vector3(.34f,.13f,4),.01f);
            for(float z=.1f;z<4;z+=.7f)
                Box(iron,new Vector3(x,.54f,z),new Vector3(.035f,1,.035f),.003f);
            Box(iron,new Vector3(x,1.03f,2),new Vector3(.04f,.04f,4),.003f);
            float slope=MathF.Atan2(drop,length);
            float railX=MathF.Sign(x)*(width/2-.08f);
            Box(iron,new Vector3(railX,-drop/2+.95f,length/2),new Vector3(.04f,.04f,MathF.Sqrt(length*length+drop*drop)),.003f,slope);
            for(int i=1;i<steps;i+=4)
                Box(iron,new Vector3(railX,-i*rise+.48f,i*going),new Vector3(.03f,.95f,.03f),.003f);
        }
        Box(stone,new Vector3(0,-.10f,(4f+length+1.1f)/2),new Vector3(width,.2f,length+1.1f-4f),.008f);
        // Two oak hatch leaves stand open against the entrance rails, with iron hinges and straps.
        foreach(float side in new[]{-1f,1f})
        {
            float x=side*(width/2+.01f);
            for(int i=0;i<10;i++) Box(oak,new Vector3(x,.36f,(i+.5f)*.4f),new Vector3(.045f,.65f,.394f),.002f);
            foreach(float z in new[]{.25f,3.75f}) Box(iron,new Vector3(x-side*.03f,.36f,z),new Vector3(.018f,.6f,.055f),.002f);
        }
        // A supported side walk keeps the interrupted ledge connected around the stair shaft.
        Vector3 Local(Vector2 p,float y)=>new(p.X-w.Top.X,y-w.Top.Y,p.Y-w.Top.Z);
        void Beam(Vector3 a,Vector3 b,float size)
        {
            var mesh=BevelMesh.Shared(new Vector3(size,size,a.DistanceTo(b)),.003f,RuienMaterials.Get("ruien_iron"));
            iron.AppendFrom(mesh,0,new Transform3D(Basis.LookingAt((b-a).Normalized(),MathF.Abs((b-a).Normalized().Y)>.9f?Vector3.Right:Vector3.Up),(a+b)/2));
        }
        Vector3 Turn(int index,float half)
        {
            var before=(w.LandingPath[index]-w.LandingPath[Math.Max(0,index-1)]).Normalized();
            var after=(w.LandingPath[Math.Min(w.LandingPath.Length-1,index+1)]-w.LandingPath[index]).Normalized();
            if(index==0)before=after;if(index==w.LandingPath.Length-1)after=before;
            var n0=new Vector3(before.Y,0,-before.X);var n1=new Vector3(after.Y,0,-after.X);
            var bis=(n0+n1).Normalized();return bis*(half/Math.Max(.3f,bis.Dot(n0)));
        }
        for(int i=0;i<w.LandingPath.Length;i++)
        {
            var joint=Local(w.LandingPath[i],w.Bottom.Y+.026f);var side=Turn(i,.415f);
            RuienPaving.Border(stone,joint-side,joint+side);
        }
        for(int i=0;i+1<w.LandingPath.Length;i++)
        {
            var a=Local(w.LandingPath[i],w.Bottom.Y-.09f);var b=Local(w.LandingPath[i+1],w.Bottom.Y-.09f);
            var basis=Basis.LookingAt((b-a).Normalized());
            var topA=a+Vector3.Up*.09f;var topB=b+Vector3.Up*.09f;
            var sa=Turn(i,.43f);var sb=Turn(i+1,.43f);
            RuienPaving.Slab(stone,new[]{topA-sa,topA+sa,topB+sb,topB-sb});
            var pa=Turn(i,.39f);var pb=Turn(i+1,.39f);
            RuienPaving.Quad(paving,topA-pa,topA+pa,topB+pb,topB-pb,(b-a).Normalized(),w.Top);
            if(i==0)continue; // the short landing turns into the stair, so its end stays open
            var outw=basis.X*.40f;
            if(outw.X<0)outw=-outw;
            // Stop handrails short of each turning landing, leaving its full body clearance.
            var dir=(b-a).Normalized();var railA=a+dir*.55f;var railB=b-dir*.55f;
            Beam(railA+outw+Vector3.Up*1.1f,railB+outw+Vector3.Up*1.1f,.035f);
            int n=Math.Max(1,(int)MathF.Ceiling(railA.DistanceTo(railB)/.85f));
            for(int k=0;k<=n;k++)
            {
                var at=railA.Lerp(railB,k/(float)n);
                Beam(at+outw,at+outw+Vector3.Up*1.1f,.035f);
                Beam(at-outw-Vector3.Up*.65f,at+outw-Vector3.Up*.08f,.045f);
            }
        }
        var allFaces=new List<Vector3>();
        foreach(var (tool,family) in new[]{(stone,"ruien_bluestone"),(iron,"ruien_iron"),(oak,"ruien_oak"),(paving,"ruien_setts")})
        {
            var mesh=tool.Commit();
            // Procedural pieces have no baked weather; use a measured damp mask instead of implicit white COLOR.
            var arrays=mesh.SurfaceGetArrays(0); var vertices=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            if(tool!=paving)
            {
                arrays[(int)Mesh.ArrayType.Color]=vertices.Select(p=>new Color(Math.Clamp(-p.Y/drop,0,1)*.25f,0,.08f,0)).ToArray();
                // BevelMesh supplies orthonormal face UVs in metres, including its thin risers and bevels.
                var tile=RuienTextures.Families()[family[6..]];
                arrays[(int)Mesh.ArrayType.TexUV]=arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array().Select(uv=>uv/new Vector2(tile.TileU,tile.TileV)).ToArray();
            }
            var finished=new ArrayMesh(); finished.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,arrays);
            finished.SurfaceSetMaterial(0,RuienMaterials.Get(family));
            root.AddChild(new MeshInstance3D{Mesh=finished,Layers=Ruien.Layer,CastShadow=GeometryInstance3D.ShadowCastingSetting.Off});
            allFaces.AddRange(finished.GetFaces());
        }
        var body=new StaticBody3D{CollisionLayer=Solid.Layer,CollisionMask=0};
        body.AddChild(new CollisionShape3D{Shape=new ConcavePolygonShape3D{Data=allFaces.ToArray(),BackfaceCollision=true}});
        root.AddChild(body);
        return root;
    }
}
