using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.World.Ruien;

/// <summary>B2's reusable sill and grated gutter; all clear widths stay walkable.</summary>
public static class RuienDrain
{
    public static readonly (float u,int side)[] Mouths={(16.6f,1),(23.8f,-1),(33f,1)};
    public static List<Func<Vector3,float>> GutterCut(RuienData.Zone zone,float u,int side)
    {
        var(c,t)=zone.Frame(u);var n=new Vector2(t.Y,-t.X)*side;
        float A(Vector3 p)=>(new Vector2(p.X,p.Z)-c).Dot(t);
        float S(Vector3 p)=>(new Vector2(p.X,p.Z)-c).Dot(n);
        return new(){p=>A(p)+.17f,p=>.17f-A(p),p=>S(p)-1.43f,p=>3.10f-S(p),p=>p.Y+3.82f,p=>-3.3f-p.Y};
    }
    /// <summary>
    /// The drain's continuing throat behind an exported lining's end ring: straight on, a quarter bend in plan and a
    /// sealed run beyond sight, so the mouth is open and goes dark with depth instead of stopping at a flat card.
    /// <paramref name="sample"/> gives the lining's weather and baked colour at a ring point; occlusion falls from
    /// <paramref name="aoStart"/> at the ring to near black past the bend.
    /// </summary>
    public static RuienPatch.Tris Throat(Vector3[] ring,Vector3 centre,Vector3 axis,Func<Vector3,(Color c,byte[] bake)> sample,float aoStart)
    {
        var a=new Vector3(axis.X,0,axis.Z).Normalized();var l=Vector3.Up.Cross(a).Normalized();
        var local=ring.Select(p=>new Vector2((p-centre).Dot(l),(p-centre).Y)).ToArray();
        var info=ring.Select(sample).ToArray();
        const float straight=.9f,radius=1.05f,after=.9f;
        // Stations: centre point, tangent, lateral, distance along.
        var stations=new List<(Vector3 c,Vector3 lat,float s)>();
        for(int i=0;i<=4;i++)stations.Add((centre+a*(straight*i/4),l,straight*i/4));
        var turn=centre+a*straight+l*radius;
        for(int i=1;i<=10;i++)
        {
            float phi=MathF.PI/2*i/10;var lat=l*MathF.Cos(phi)-a*MathF.Sin(phi);
            stations.Add((turn-lat*radius,lat,straight+radius*phi));
        }
        var last=stations[^1];var dir=last.lat.Cross(Vector3.Up).Normalized();if(dir.Dot(l)<0)dir=-dir;
        for(int i=1;i<=3;i++)stations.Add((last.c+dir*(after*i/3),last.lat,last.s+after*i/3));
        float total=stations[^1].s;
        float Ao(float s)=>aoStart*MathF.Max(.04f,MathF.Pow(1-Math.Clamp(s/(straight+radius*1.1f),0,1),1.6f));
        Vector3 At(int st,int k)=>stations[st].c+stations[st].lat*local[k].X+Vector3.Up*local[k].Y;
        var t=new RuienPatch.Tris();int n=ring.Length;
        void Corner(int st,int k)
        {
            var p=At(st,k);var inward=(stations[st].c+Vector3.Up*local.Average(q=>q.Y)-p).Normalized();
            float wet=Math.Clamp(stations[st].s/1.2f,0,1);var c=info[k].c;
            c=new Color(Math.Max(c.R,.55f+.35f*wet),c.G*(1-wet),Math.Max(c.B,.35f+.4f*wet),c.A);
            var b=info[k].bake;float dark=1-.55f*wet;
            t.Add(p,inward,Vector2.Zero,c,(byte)(b[0]*dark),(byte)(b[1]*dark),(byte)(b[2]*dark),(byte)Math.Clamp(MathF.Round(Ao(stations[st].s)*b[3]),1,255));
        }
        for(int st=0;st+1<stations.Count;st++)
            for(int k=0;k<n;k++)
            {
                int k1=(k+1)%n;
                // Wind each quad so its inward normal is the front face.
                var p0=At(st,k);var p1=At(st+1,k);var p2=At(st+1,k1);
                var inward=(stations[st].c+Vector3.Up*local.Average(q=>q.Y)-p0);
                bool flip=(p1-p0).Cross(p2-p0).Dot(inward)>0;
                foreach(var (s0,kk) in flip?new[]{(st,k),(st+1,k1),(st+1,k),(st,k),(st,k1),(st+1,k1)}:new[]{(st,k),(st+1,k),(st+1,k1),(st,k),(st+1,k1),(st,k1)})
                    Corner(s0,kk);
            }
        // Sealed end, far beyond the bend: a fan of the same brick.
        int e=stations.Count-1;var mid=stations[e].c+Vector3.Up*local.Average(q=>q.Y);var back=-dir;
        for(int k=0;k<n;k++)
        {
            int k1=(k+1)%n;var p0=At(e,k);var p1=At(e,k1);
            var tri=new[]{mid,p0,p1};if((p0-mid).Cross(p1-mid).Dot(back)>0)tri=new[]{mid,p1,p0};
            foreach(var p in tri)t.Add(p,back,Vector2.Zero,new Color(.9f,0,.8f,0),0,0,0,(byte)9);
        }
        return t;
    }

    /// <summary>Half width of the 1.0 x 1.6 m egg mouth at height h above its invert (narrow end down).</summary>
    public static float EggHalf(float h)=>h>=1.1f?MathF.Sqrt(Math.Max(0,.25f-(h-1.1f)*(h-1.1f))):.5f*MathF.Pow(Math.Max(0,1-MathF.Pow((1.1f-h)/1.1f,2)),.425f);
    public const float Invert=-3.35f;
    /// <summary>The giant gallery's inside face: upright to the springing, then its basket vault (across, at height y).</summary>
    public static float Shell(float y)=>y<= -3.1f?3f:3f*MathF.Sqrt(Math.Max(0,1-MathF.Pow((y+3.1f)/2.2f,2)));

    /// <summary>
    /// The mouth's rowlock ring: radial headers set 15 mm proud and 31 cm deep, following the leaning vault face,
    /// with wedge-shaped joints opening outward onto a continuous lime mortar bed.
    /// </summary>
    private static void Headers(Node3D root,Func<float,float,float,Vector3> P)
    {
        // Egg outline (along, y), closed, by arc length.
        var outline=new List<Vector2>();
        for(int k=0;k<=200;k++){float h=1.6f*k/200;outline.Add(new Vector2(EggHalf(h),Invert+h));}
        for(int k=199;k>0;k--){float h=1.6f*k/200;outline.Add(new Vector2(-EggHalf(h),Invert+h));}
        var arc=new float[outline.Count+1];
        for(int i=0;i<outline.Count;i++)arc[i+1]=arc[i]+outline[i].DistanceTo(outline[(i+1)%outline.Count]);
        float total=arc[^1];
        Vector2 At(float a)
        {
            a=((a%total)+total)%total;int i=Array.FindLastIndex(arc,x=>x<=a);i=Math.Min(i,outline.Count-1);
            float f=(a-arc[i])/Math.Max(arc[i+1]-arc[i],1e-6f);return outline[i].Lerp(outline[(i+1)%outline.Count],f);
        }
        var eggCentre=new Vector2(0,Invert+.8f);
        Vector2 Out(float a){var d=At(a+.01f)-At(a-.01f);var nrm=new Vector2(d.Y,-d.X).Normalized();return nrm.Dot(At(a)-eggCentre)<0?-nrm:nrm;}
        Vector3 F(Vector2 q,float depth)=>P(q.X,q.Y,Shell(q.Y)+depth);
        var st=new SurfaceTool();st.Begin(Mesh.PrimitiveType.Triangles);st.SetCustomFormat(0,SurfaceTool.CustomFormat.Rgba8Unorm);
        var bed=new SurfaceTool();bed.Begin(Mesh.PrimitiveType.Triangles);
        // Two rowlock rings of headers on edge, the outer with more bricks, so the wedge joints stay narrow.
        for(int ring=0;ring<2;ring++)
        {
        float r0=ring*.114f;
        int count=(int)MathF.Round((total+Mathf.Tau*(r0+.054f))/.069f);
        for(int k=0;k<count;k++)
        {
            float a0=total*k/count,a1=total*(k+1)/count,am=(a0+a1)/2;
            var q=At(am);var o=Out(am);var qr=q+o*(r0+.054f);
            var et=(F(At(am+.01f),0)-F(At(am-.01f),0)).Normalized();
            var er=(F(q+o*.01f,0)-F(q,0)).Normalized();
            var into=F(q,.01f)-F(q,0);var ed=et.Cross(er).Normalized();if(ed.Dot(into)<0)ed=-ed;
            er=ed.Cross(et).Normalized();if(er.Dot(F(q+o*.01f,0)-F(q,0))<0)er=-er;
            float width=F(At(a0)+Out(a0)*r0,0).DistanceTo(F(At(a1)+Out(a1)*r0,0))-.007f;
            var basis=new Basis(et,er,ed);var centre=F(qr,0)+ed*(.31f/2-.015f);
            // Wet and slimed low on the ring, lime bloom on the upper headers, a little moss in the low joints.
            float low=Math.Clamp(1-(q.Y-Invert)/.6f,0,1),high=Math.Clamp((q.Y-Invert-.9f)/.7f,0,1);
            var weather=new Color(.3f+.55f*low,.05f+.3f*high*((k*7)%3==0?1:.4f),.18f+.1f*high,.2f*low);
            float size=.106f-.006f*((k*5)%3);
            var arrays=BevelMesh.Box(new Vector3(width,size,.31f),.008f,null!).SurfaceGetArrays(0);
            var pv=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();var nv=arrays[(int)Mesh.ArrayType.Normal].AsVector3Array();var uv=arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();
            for(int i=0;i<pv.Length;i++)
            {
                st.SetNormal(basis*nv[i]);st.SetUV(uv[i]);st.SetColor(weather);
                // The headers' own reveal into the mouth is in shadow.
                float inner=Math.Clamp(-(pv[i].Y)/.05f,0,1)*Math.Clamp(pv[i].Z/.15f,0,1);
                st.SetCustom(0,new Color(0,0,0,1-.45f*inner*(1-ring)));st.AddVertex(centre+basis*pv[i]);
            }
        }
        }
        // The mortar bed behind and between them, flush with the vault face.
        const int seg=240;
        for(int i=0;i<seg;i++)
        {
            float a0=total*i/seg,a1=total*(i+1)/seg;
            Vector3 B(float a,float r)=>F(At(a)+Out(a)*r,.004f);
            var p0=B(a0,-.004f);var p1=B(a1,-.004f);var p2=B(a1,.232f);var p3=B(a0,.232f);
            var nrm=-(F(At(a0),.01f)-F(At(a0),0)).Normalized();
            // A skirt from the bed's outer edge back into the wall closes any gap to the cut host's relief.
            Vector3 S(float a)=>F(At(a)+Out(a)*.232f,.16f);
            var s1=S(a1);var s0=S(a0);
            foreach(var p in new[]{p0,p2,p1,p0,p3,p2,p3,s1,p2,p3,s0,s1})
            {
                var tri=p;bed.SetNormal(nrm);bed.SetColor(new Color(.35f,.05f,.12f,0));bed.SetUV(new Vector2(a0,0));bed.AddVertex(tri);
            }
        }
        RuienStair.Add(root,st,"ruien_brick_header",true);
        var mortar=bed.Commit();var ma=mortar.SurfaceGetArrays(0);
        // Wind the bed so its gallery-facing side is the front.
        var pa=ma[(int)Mesh.ArrayType.Vertex].AsVector3Array();var na=ma[(int)Mesh.ArrayType.Normal].AsVector3Array();
        for(int i=0;i<pa.Length;i+=3)if((pa[i+1]-pa[i]).Cross(pa[i+2]-pa[i]).Dot(na[i])>0)(pa[i+1],pa[i+2])=(pa[i+2],pa[i+1]);
        ma[(int)Mesh.ArrayType.Vertex]=pa;
        var done=new ArrayMesh();done.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,ma);done.SurfaceSetName(0,"ruien_misc_Mortar_header");
        done.SurfaceSetMaterial(0,RuienMaterials.Get("ruien_misc_Mortar_header"));
        root.AddChild(new MeshInstance3D{Mesh=done,Layers=Ruien.Layer,CastShadow=GeometryInstance3D.ShadowCastingSetting.Off});
    }

    public static Node3D Build(RuienData.Zone zone,float u,int side)
    {
        var(c,t)=zone.Frame(u);var n=new Vector2(t.Y,-t.X)*side;
        Vector3 P(float along,float y,float across)=>new(c.X+t.X*along+n.X*across,y,c.Y+t.Y*along+n.Y*across);
        var basis=new Basis(new Vector3(t.X,0,t.Y),Vector3.Up,new Vector3(-t.Y,0,t.X));
        var root=new Node3D{Name=$"drain_B2_{u}_{side}"};
        var stone=new SurfaceTool();var iron=new SurfaceTool();var water=new SurfaceTool();
        foreach(var tool in new[]{stone,iron,water})tool.Begin(Mesh.PrimitiveType.Triangles);
        void Box(SurfaceTool tool,float along,float y,float across,Vector3 size,float radius)
            =>tool.AppendFrom(BevelMesh.Box(size,radius,RuienMaterials.Get(tool==iron?"ruien_iron":"ruien_bluestone")),0,new Transform3D(basis,P(along,y,across)));
        // Thick sill with a central runnel, and a lined trough recessed below the walking surface.
        foreach(float sign in new[]{-1f,1f})Box(stone,sign*.30f,-3.40f,2.97f,new Vector3(.48f,.18f,.37f),.011f);
        Box(stone,0,-3.50f,2.97f,new Vector3(1.13f,.10f,.37f),.008f);
        Box(stone,0,-3.80f,2.23f,new Vector3(.34f,.10f,1.62f),.007f);
        foreach(float sign in new[]{-1f,1f})
        {
            Box(stone,sign*.18f,-3.69f,2.23f,new Vector3(.08f,.22f,1.62f),.007f);
            Box(iron,sign*.15f,-3.597f,2.23f,new Vector3(.026f,.045f,1.62f),.002f);
        }
        for(float s=1.46f;s<3.04f;s+=.075f)Box(iron,0,-3.597f,s,new Vector3(.31f,.045f,.021f),.002f);
        // Wet flow stays below the bars. The visible drop connects sill, gutter and channel water.
        Box(water,0,-3.747f,2.24f,new Vector3(.085f,.013f,1.58f),.004f);
        Box(water,0,-3.61f,2.87f,new Vector3(.025f,.27f,.018f),.006f);
        Box(water,0,-4.17f,1.44f,new Vector3(.022f,.86f,.018f),.006f);
        RuienStair.Add(root,stone,"ruien_bluestone",true);RuienStair.Add(root,iron,"ruien_iron",true);
        Headers(root,P);
        var flow=water.Commit();flow.SurfaceSetMaterial(0,RuienMaterials.Get("ruien_misc_Water_film"));
        root.AddChild(new MeshInstance3D{Mesh=flow,Layers=Ruien.Layer,CastShadow=GeometryInstance3D.ShadowCastingSetting.Off});
        return root;
    }
}
