using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.World.Ruien;

/// <summary>Dressed bluestone opening kit: deep reveals, recessed bearing seats and bonded corner stones.</summary>
public static class RuienSurround
{
    public const float Bottom=-.30f, Joint=.005f, Seat=-.015f, LidTop=.027f;
    public static bool Applies(RuienData.Way w)=>w.Kind is "keeper_stair" or "stair" or "ladder" or "grate";
    public static float Width(RuienData.Way w)=>w.Kind is "keeper_stair" or "stair"?.32f:.23f;
    public static float Top(RuienData.Way w)=>w.Kind is "keeper_stair" or "stair"?.065f:.035f;
    public static Rect2 Opening(RuienData.Way w)
    {
        // Extend the covered end for head clearance, whichever direction the flight descends.
        if(w.Kind!="stair")return w.Hole;
        var d=new Vector2(w.Bottom.X-w.Top.X,w.Bottom.Z-w.Top.Z);
        var end=MathF.Abs(d.Y)>=MathF.Abs(d.X)?(d.Y<0?Side.Top:Side.Bottom):(d.X<0?Side.Left:Side.Right);
        return w.Hole.GrowSide(end,.16f);
    }
    public static Rect2 Footprint(RuienData.Way w)=>Opening(w).Grow(Width(w)+.005f);

    public static Node3D Build(RuienData.Way w)
    {
        var h=Opening(w);var root=new Node3D{Name="surround_"+w.Id,Position=new Vector3(h.GetCenter().X,0,h.GetCenter().Y)};
        var stone=new SurfaceTool();stone.Begin(Mesh.PrimitiveType.Triangles);
        var mortar=new SurfaceTool();mortar.Begin(Mesh.PrimitiveType.Triangles);
        float width=Width(w),top=Top(w),half=h.Size.X/2,length=h.Size.Y;
        // Rebate is a deliberately machined seat; its corners are eased 2 mm, exposed arrises 8 mm.
        Vector2[] Section(float bottom,float upper,float inner,float outer,float lip)=>new[]{
            new Vector2(inner,bottom),new Vector2(outer,bottom),new Vector2(outer,upper),
            new Vector2(lip,upper),new Vector2(lip,Seat),new Vector2(inner,Seat)};
        var profile=Round(Section(Bottom,top,0,width,.095f),.008f);
        var bed=Round(Section(Bottom+.008f,top-.009f,.009f,width-.009f,.103f),.002f);
        // At a bonded corner the mortar reaches both arrises; an inset straight-course joint leaves a pinhole.
        var cornerBed=Round(Section(Bottom+.001f,top-.009f,-.005f,width+.005f,.10f),.001f);
        var bedding=new[]{new Vector2(-.004f,Bottom-.018f),new Vector2(width+.008f,Bottom-.018f),
            new Vector2(width+.008f,Bottom+.001f),new Vector2(-.004f,Bottom+.001f)};
        var packing=new[]{new Vector2(width-.009f,Bottom),new Vector2(width+.008f,Bottom),
            new Vector2(width+.008f,top-.012f),new Vector2(width-.009f,top-.012f)};
        if(w.Round)
        {
            float radius=half;const int count=8;
            for(int i=0;i<count;i++)
            {
                float a=i*Mathf.Tau/count,b=(i+1)*Mathf.Tau/count;
                Sweep(stone,profile,a+Joint/(2*radius),b-Joint/(2*radius),(p,t)=>new Vector3((radius+p.X)*MathF.Cos(t),p.Y,(radius+p.X)*MathF.Sin(t)),radius);
                Sweep(mortar,bed,a-Joint/(2*radius),a+Joint/(2*radius),(p,t)=>new Vector3((radius+p.X)*MathF.Cos(t),p.Y,(radius+p.X)*MathF.Sin(t)),radius);
                foreach(var section in new[]{bedding,packing})
                    Sweep(mortar,section,a,b,(p,t)=>new Vector3((radius+p.X)*MathF.Cos(t),p.Y,(radius+p.X)*MathF.Sin(t)),radius,roundedEnds:false);
            }
        }
        else
        {
            // The end stones pass across the corner; side stones butt to their inner ends.
            foreach(float side in new[]{-1f,1f})
            {
                Course(length,(p,t)=>new Vector3(side*(half+p.X),p.Y,t),width);
                Course(h.Size.X+2*width,(p,t)=>new Vector3(t,p.Y,side*(length/2+p.X)));
            }
        }
        void Course(float span,Func<Vector2,float,Vector3> place,float endPacking=0)
        {
            Sweep(mortar,bedding,-span/2-.01f,span/2+.01f,place,roundedEnds:false);
            // The perimeter also runs behind the ends of the transverse stones, beside their recessed seats.
            Sweep(mortar,packing,-span/2-endPacking-.01f,span/2+endPacking+.01f,place,roundedEnds:false);
            // Bond the end-stone/side-stone junction too; their rounded end faces must not open onto the sky.
            foreach(float end in new[]{-span/2,span/2})
                Sweep(mortar,cornerBed,end-Joint,end+Joint,place,roundedEnds:false);
            int count=(int)MathF.Ceiling(span/.72f);
            for(int i=0;i<count;i++)
            {
                float a=-span/2+i*span/count,b=-span/2+(i+1)*span/count;
                Sweep(stone,profile,a+Joint/2,b-Joint/2,place);
                if(i>0)Sweep(mortar,bed,a-Joint/2,a+Joint/2,place);
            }
        }
        RuienStair.Add(root,stone,"ruien_bluestone",true);
        RuienStair.Add(root,mortar,"ruien_misc_Mortar_header",true,metric:false);
        if(w.Kind=="stair")
        {
            // The hall retains its authored oak leaves, standing open. Bed their hinge pins into this same cap.
            var hinges=new SurfaceTool();hinges.Begin(Mesh.PrimitiveType.Triangles);
            foreach(float side in new[]{-1f,1f})foreach(float z in new[]{w.Hole.Position.Y+.18f,w.Hole.GetCenter().Y,w.Hole.End.Y-.18f})
            {
                float pivot=side*(half-.04f),localZ=z-h.GetCenter().Y;
                var pin=new SurfaceTool();pin.CreateFrom(new CylinderMesh{TopRadius=.025f,BottomRadius=.025f,Height=.12f,RadialSegments=32},0);pin.Deindex();
                hinges.AppendFrom(pin.Commit(),0,new Transform3D(new Basis(Vector3.Right,Mathf.Pi/2),new Vector3(pivot,.026f,localZ)));
                hinges.AppendFrom(BevelMesh.Box(new Vector3(.23f,.08f,.095f),.003f,RuienMaterials.Get("ruien_iron")),0,
                    new Transform3D(Basis.Identity,new Vector3(pivot+side*.11f,.027f,localZ)));
                foreach(float dz in new[]{-.027f,.027f})
                    hinges.AppendFrom(BevelMesh.Box(new Vector3(.02f,.014f,.02f),.003f,RuienMaterials.Get("ruien_iron")),0,
                        new Transform3D(Basis.Identity,new Vector3(pivot+side*.19f,.073f,localZ+dz)));
            }
            RuienStair.Add(root,hinges,"ruien_iron",true);
        }
        return root;
    }

    // Round each corner of the cross section with true circular arcs, including the concave rebate.
    private static Vector2[] Round(Vector2[] outline,float radius)
    {
        var result=new List<Vector2>();
        for(int i=0;i<outline.Length;i++)
        {
            var p=outline[i];var a=(outline[(i+outline.Length-1)%outline.Length]-p).Normalized();
            var b=(outline[(i+1)%outline.Length]-p).Normalized();
            float r=i>=3?Math.Min(radius,.002f):radius;
            var centre=p+(a+b)*r;var start=-b*r;float angle=start.AngleTo(-a*r);
            for(int k=0;k<=4;k++)result.Add(centre+start.Rotated(angle*k/4));
        }
        return result.ToArray();
    }

    private static void Sweep(SurfaceTool st,Vector2[] profile,float start,float end,Func<Vector2,float,Vector3> place,float radius=0,bool roundedEnds=true)
    {
        var centre=profile.Aggregate(Vector2.Zero,(a,b)=>a+b)/profile.Length;
        float metric=radius>0?radius+centre.X:1;
        float edge=roundedEnds?Math.Min(.006f,(end-start)*metric/6):0;
        var stations=new List<(float t,float inset)>();
        if(edge>0)
            for(int i=0;i<=4;i++){float a=i*MathF.PI/8;stations.Add((start+edge*(1-MathF.Cos(a))/metric,edge*(1-MathF.Sin(a))));}
        else stations.Add((start,0));
        if(radius>0)for(int i=1;i<24;i++)stations.Add((Mathf.Lerp(start+edge/metric,end-edge/metric,i/24f),0));
        if(edge>0)
            for(int i=4;i>=0;i--){float a=i*MathF.PI/8;stations.Add((end-edge*(1-MathF.Cos(a))/metric,edge*(1-MathF.Sin(a))));}
        else stations.Add((end,0));
        Vector2 Inset(int index,float amount)
        {
            var p=profile[index];var a=(p-profile[(index+profile.Length-1)%profile.Length]).Normalized();
            var b=(profile[(index+1)%profile.Length]-p).Normalized();
            var n0=new Vector2(-a.Y,a.X);var n1=new Vector2(-b.Y,b.X);var bis=(n0+n1).Normalized();
            return p+bis*amount/Math.Max(.2f,bis.Dot(n0));
        }
        void Face(Vector3 a,Vector3 b,Vector3 c,Vector2 ua,Vector2 ub,Vector2 uc,Vector3 outward)
        {
            if((b-a).Cross(c-a).Dot(outward)>0){(b,c)=(c,b);(ub,uc)=(uc,ub);}
            var n=-(b-a).Cross(c-a).Normalized();
            foreach(var (p,uv) in new[]{(a,ua),(b,ub),(c,uc)}){st.SetNormal(n);st.SetUV(uv);st.AddVertex(p);}
        }
        // Swept profile has metric charts on every face, including seat, reveal and underside.
        float v=0;
        for(int j=0;j<profile.Length;j++)
        {
            var p=profile[j];var q=profile[(j+1)%profile.Length];float dv=p.DistanceTo(q);
            for(int i=0;i<stations.Count-1;i++)
            {
                var from=stations[i];var to=stations[i+1];float a=from.t,b=to.t;
                var pa=place(Inset(j,from.inset),a);var pb=place(Inset(j,to.inset),b);
                var qb=place(Inset((j+1)%profile.Length,to.inset),b);var qa=place(Inset((j+1)%profile.Length,from.inset),a);
                // Profile is counterclockwise; the right-hand side is outside (also at the concave seat).
                var tangent=q-p;var outside=new Vector2(tangent.Y,-tangent.X).Normalized();
                var at=(p+q)/2;var normal=(place(at+outside*.01f,(a+b)/2)-place(at,(a+b)/2)).Normalized();
                float scale=radius>0?radius+(p.X+q.X)/2:1;
                float u=(a-start)*scale,du=(b-a)*scale;
                Face(pa,pb,qb,new(u,v),new(u+du,v),new(u+du,v+dv),normal);
                Face(pa,qb,qa,new(u,v),new(u+du,v+dv),new(u,v+dv),normal);
            }
            v+=dv;
        }
        // Triangulate the concave L profile so end stones remain closed at a mortar joint.
        var indices=Geometry2D.TriangulatePolygon(profile);
        foreach(float t in new[]{start,end})
        {
            var normal=(place(centre,t)-place(centre,t==start?end:start)).Normalized();
            for(int i=0;i<indices.Length;i+=3)
            {
                var a=Inset(indices[i],edge);var b=Inset(indices[i+1],edge);var c=Inset(indices[i+2],edge);
                Face(place(a,t),place(b,t),place(c,t),a,b,c,normal);
            }
        }
    }

    /// <summary>Remove the old lining/coping under the replacement cap in both exported LODs and collision.</summary>
    public static bool Trim(Godot.Collections.Array arrays,RuienData.Area area)
    {
        bool changed=false;
        foreach(var w in area.Ways.Where(w=>w.Kind is "stair" or "ladder" or "grate"))
        {
            var h=Footprint(w);var cuts=new List<Func<Vector3,float>>{
                p=>p.X-h.Position.X,p=>h.End.X-p.X,p=>p.Z-h.Position.Y,p=>h.End.Y-p.Z,
                p=>p.Y-(Bottom-.015f),p=>.15f-p.Y};
            if(w.Round)
            {
                var centre=h.GetCenter();float r=h.Size.X/2;
                for(int i=0;i<64;i++){float a=i*Mathf.Tau/64;var n=new Vector2(MathF.Cos(a),MathF.Sin(a));cuts.Add(p=>r-n.Dot(new Vector2(p.X,p.Z)-centre));}
            }
            bool Lining((Vector3 a,Vector3 b,Vector3 c) tri)
            {
                // The last hall tread is at -0.18: it must remain inside the clear opening.
                // Only the lining and old cap are replaced, not the walkable top step.
                var centre=(tri.a+tri.b+tri.c)/3;
                return !(w.Kind=="stair"&&MathF.Max(tri.a.Y,MathF.Max(tri.b.Y,tri.c.Y))<-.10f
                    &&Opening(w).Grow(-.04f).HasPoint(new Vector2(centre.X,centre.Z)));
            }
            changed|=QuayNotch.CutSurfaceWith(arrays,Transform3D.Identity,Lining,cuts)>0;
        }
        return changed;
    }
}
