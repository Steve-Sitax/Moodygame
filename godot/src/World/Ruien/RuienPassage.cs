using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.World.Ruien;

/// <summary>Continuous curved lining between an existing stair landing and a main ledge.</summary>
internal static class RuienPassage
{
    internal readonly record struct Segment(Transform3D Frame,float Length,Aabb Box);
    internal static IEnumerable<Segment> Segments(Vector3[] path)
    {
        for(int i=0;i+1<path.Length;i++)
        {
            var delta=path[i+1]-path[i];float length=new Vector2(delta.X,delta.Z).Length();if(length<.001f)continue;
            var along=delta/length;var across=new Vector3(along.Z,0,-along.X);
            var xf=new Transform3D(new Basis(across,Vector3.Up,along),path[i]);
            var box=new Aabb(path[i],Vector3.Zero).Expand(path[i+1]).Grow(1);
            box.Position-=Vector3.Up*.3f;box.Size+=Vector3.Up*2.8f;
            yield return new Segment(xf,length,box);
        }
    }
    internal static List<Func<Vector3,float>> Air(Segment segment,float floor=-.25f)
    {
        var inv=segment.Frame.AffineInverse();var planes=new List<Func<Vector3,float>>
        {p=>(inv*p).X+.602f,p=>.602f-(inv*p).X,p=>(inv*p).Y-floor,
         p=>(inv*p).Z+.09f,p=>segment.Length+.09f-(inv*p).Z};
        for(int i=0;i<24;i++)
        {
            float angle=(i+.5f)*MathF.PI/24,cos=MathF.Cos(angle),sin=MathF.Sin(angle);
            planes.Add(p=>.602f*MathF.Cos(MathF.PI/48)-(inv*p).X*cos-((inv*p).Y-1.6f)*sin);
        }
        return planes;
    }
    internal static bool Trim(Godot.Collections.Array arrays,Vector3[] path)
    {
        return QuayNotch.CutSurfaceRegions(arrays,Transform3D.Identity,Segments(path).Select(s=>new QuayNotch.Region(s.Box,Air(s))).ToArray())>0;
    }
    internal static void CutTown(Node3D town,RuienEntrance.Spec spec)
    {
        using var timing=Dev.StartupTiming.Measure("ruien.passage-town-cut");
        QuayNotch.CutRegions(town,_=>true,_=>true,Segments(spec.ConnectPath).Select(segment=>new QuayNotch.Region(segment.Box,Air(segment))).ToArray());
    }
    private static Vector3 Across(Vector3[] p,int i)
    {
        var t=p[Math.Min(p.Length-1,i+1)]-p[Math.Max(0,i-1)];return new Vector3(t.Z,0,-t.X).Normalized();
    }
    private static float[]? brick;private static int bw,bh;
    private static RuienData? mainData;
    private static readonly Dictionary<string,RuienHostCeiling> ceilings=new();
    internal static string? CeilingSource(RuienEntrance.Spec spec)
    {
        if(spec.ConnectArea.Length==0)return null;
        mainData??=RuienData.Load();var host=mainData.Areas.Single(a=>a.Id==spec.ConnectArea);
        return host.Exported&&host.Zones.Any(z=>z.Kind=="room")?host.Export+"/collision.res":null;
    }
    internal static Func<Vector3,float> HostAir(RuienEntrance.Spec spec)
    {
        mainData??=RuienData.Load();var host=mainData.Areas.Single(a=>a.Id==spec.ConnectArea);
        RuienHostCeiling? ceiling=null;
        if(CeilingSource(spec)!=null&&!ceilings.TryGetValue(host.Id,out ceiling))
            ceilings[host.Id]=ceiling=new RuienHostCeiling(host);
        var memo=new Dictionary<Vector3,float>();
        return p=>
        {
            if(memo.TryGetValue(p,out float saved))return saved;
            float air=-100;
            foreach(var zone in host.Zones)
            {
                // A room's crown is its highest point, not a flat ceiling. Trimming to that
                // plane removed the passage lining above a low groin and exposed the sky.
                // Finish inside the roof's backing: a margin below its collision face
                // leaves a projecting strip of lining and end web across the vault.
                float top=zone.Kind=="room"&&ceiling!=null?ceiling.At(p,zone.S.LedgeY,zone.S.Crown)+.005f:zone.S.Crown;
                float inside=zone.Inside(new Vector2(p.X,p.Z),out _);
                if(zone.Kind=="line")inside-=zone.S.Width/2-zone.S.Shell(p.Y);
                air=Math.Max(air,Math.Min(inside-.002f,Math.Min(p.Y-zone.S.LedgeY-.025f,top-p.Y)));
            }
            return memo[p]=air;
        };
    }
    internal static float BrickHeight(Vector2 uv)
    {
        if(brick==null)
        {
            using var im=RuienTextures.Get("brick_stretcher","hra")!.GetImage();if(im.IsCompressed())im.Decompress();
            bw=im.GetWidth();bh=im.GetHeight();brick=new float[bw*bh];
            for(int y=0;y<bh;y++)for(int x=0;x<bw;x++)brick[y*bw+x]=im.GetPixel(x,y).R;
        }
        float xx=Mathf.PosMod(uv.X,1)*bw,yy=Mathf.PosMod(uv.Y,1)*bh;int ix=(int)xx,iy=(int)yy;
        float P(int x,int y)=>brick![(y%bh)*bw+x%bw];
        return Mathf.Lerp(Mathf.Lerp(P(ix,iy),P(ix+1,iy),xx-ix),Mathf.Lerp(P(ix,iy+1),P(ix+1,iy+1),xx-ix),yy-iy);
    }
    // A passage's crown can finish above a low side of the receiving vault.
    // Close that part of its end in bonded brick; remove only the host's actual
    // air. Without this web an open crescent looks out through the earth.
    // The outer arch mates inside the lining; the exposed face has the same
    // metric brick chart and collision as the passage walls.
    internal static void EndWeb(Node3D root,Transform3D end,Transform3D world,Func<Vector3,float> hostAir,float radius)
    {
        var tool=new SurfaceTool();tool.Begin(Mesh.PrimitiveType.Triangles);
        // The continuous stone floor already closes the foot. Start above its
        // joint so the web cannot add a raised brick strip across the walkway.
        const float foot=.03f;
        tool.AppendFrom(Scheldemist.Models.BevelMesh.Box(new Vector3(radius*2,1.6f+radius-foot,.18f),.008f,
            RuienMaterials.Get("ruien_brick_stretcher")),0,end*new Transform3D(Basis.Identity,new Vector3(0,(1.6f+radius+foot)/2,-.07f)));
        var into=end.AffineInverse();
        float Trim(Vector3 p)
        {
            var q=into*p;
            float outside=Math.Min(q.Y-1.6f,new Vector2(q.X,q.Y-1.6f).Length()-radius);
            return Math.Max(hostAir(world*p),outside);
        }
        RuienStair.Add(root,tool,"ruien_brick_stretcher",true,trim:Trim);
    }
    private static void Quad(SurfaceTool st,Vector3 a,Vector3 b,Vector3 c,Vector3 d,Vector2 ua,Vector2 ub,Vector2 uc,Vector2 ud,Vector3 want,Color weather,Vector3[]? normals=null)
    {
        var p=new[]{a,b,c,d};var uv=new[]{ua,ub,uc,ud};var indices=(b-a).Cross(c-a).Dot(want)>0?new[]{0,2,1,0,3,2}:new[]{0,1,2,0,2,3};
        foreach(int i in indices){st.SetNormal(normals==null?want:normals[i]);st.SetUV(uv[i]);st.SetColor(weather);st.AddVertex(p[i]);}
    }
    internal static Node3D Build(RuienEntrance.Spec spec)
    {
        using var timing=Dev.StartupTiming.Measure("ruien.entrance-passage");
        var originalEnd=spec.ConnectPath[^1];var endDirection=(originalEnd-spec.ConnectPath[^2]).Normalized();
        var path=spec.ConnectPath.Concat(new[]{originalEnd+endDirection*.12f}).ToArray();
        var root=new Node3D{Name="connected_passage",Transform=spec.Local.AffineInverse()};
        var along=new float[path.Length];for(int i=1;i<path.Length;i++)along[i]=along[i-1]+path[i].DistanceTo(path[i-1]);
        var lining=new SurfaceTool();lining.Begin(Mesh.PrimitiveType.Triangles);
        var stone=new SurfaceTool();stone.Begin(Mesh.PrimitiveType.Triangles);
        var paving=new SurfaceTool();paving.Begin(Mesh.PrimitiveType.Triangles);
        // Both sides and the back of the lining exist. The end rings mate inside
        // the stair and main-vault masonry; their straight mating edges are hidden.
        var profile=new List<Vector2>();
        for(int i=0;i<=48;i++)profile.Add(new Vector2(-.6f,Mathf.Lerp(-.24f,1.6f,i/48f)));
        for(int i=1;i<=64;i++){float a=MathF.PI*(1-i/64f);profile.Add(new Vector2(.6f*MathF.Cos(a),1.6f+.6f*MathF.Sin(a)));}
        for(int i=1;i<=48;i++)profile.Add(new Vector2(.6f,Mathf.Lerp(1.6f,-.24f,i/48f)));
        var arc=new float[profile.Count];for(int i=1;i<arc.Length;i++)arc[i]=arc[i-1]+profile[i].DistanceTo(profile[i-1]);
        Vector3 At(int row,int j,bool outer)
        {
            var q=profile[j];var lat=Across(path,row);var edge=profile[Math.Min(profile.Count-1,j+1)]-profile[Math.Max(0,j-1)];
            var normal=new Vector2(-edge.Y,edge.X).Normalized(); // out of the bore
            if(outer)q+=normal*.26f;
            else
            {
                float h=.001f+.007f*BrickHeight(new Vector2(along[row]/4.8f,arc[j]/2.4f));
                float fade=Math.Clamp(Math.Min(along[row],along[^1]-along[row])/.04f,0,1);
                q-=normal*h*fade;
            }
            return path[row]+lat*q.X+Vector3.Up*q.Y;
        }
        Vector3 Normal(int row,int j,bool outer)
        {
            var u=At(Math.Min(path.Length-1,row+1),j,outer)-At(Math.Max(0,row-1),j,outer);
            var v=At(row,Math.Min(profile.Count-1,j+1),outer)-At(row,Math.Max(0,j-1),outer);
            return v.Cross(u).Normalized()*(outer?-1:1);
        }
        for(int row=0;row+1<path.Length;row++)for(int j=0;j+1<profile.Count;j++)
            foreach(bool outer in new[]{false,true})
            {
                var a=At(row,j,outer);var b=At(row,j+1,outer);var c=At(row+1,j+1,outer);var d=At(row+1,j,outer);
                var normal=Normal(row,j,outer);float foot=Math.Clamp(1-profile[j].Y/.6f,0,1);
                Quad(lining,a,b,c,d,new Vector2(along[row]/4.8f,arc[j]/2.4f),new Vector2(along[row]/4.8f,arc[j+1]/2.4f),
                    new Vector2(along[row+1]/4.8f,arc[j+1]/2.4f),new Vector2(along[row+1]/4.8f,arc[j]/2.4f),normal,
                    new Color(.38f+.26f*foot,.02f,.22f+.35f*foot,.13f*foot),
                    new[]{normal,Normal(row,j+1,outer),Normal(row+1,j+1,outer),Normal(row+1,j,outer)});
            }
        foreach(int row in new[]{0,path.Length-1})for(int j=0;j+1<profile.Count;j++)
        {
            var want=(path[1]-path[0]).Normalized()*(row==0?-1:1);
            Quad(lining,At(row,j,false),At(row,j+1,false),At(row,j+1,true),At(row,j,true),
                new Vector2(along[row]/4.8f,arc[j]/2.4f),new Vector2(along[row]/4.8f,arc[j+1]/2.4f),
                new Vector2(along[row]/4.8f,.26f+arc[j+1]/2.4f),new Vector2(along[row]/4.8f,.26f+arc[j]/2.4f),want,new Color(.38f,.02f,.3f,.1f));
        }
        var chartMemo=new Dictionary<Vector3,Vector2>();
        Vector2 Chart(Vector3 p)
        {
            if(chartMemo.TryGetValue(p,out var saved))return saved;
            var query=new Vector2(p.X,p.Z);float best=float.MaxValue;Vector2 uv=default;
            for(int k=0;k+1<path.Length;k++)
            {
                var a=new Vector2(path[k].X,path[k].Z);var b=new Vector2(path[k+1].X,path[k+1].Z);var ab=b-a;
                float t=Math.Clamp((query-a).Dot(ab)/Math.Max(ab.LengthSquared(),1e-8f),0,1);var q=a+ab*t;float d=query.DistanceSquaredTo(q);
                if(d>=best)continue;best=d;var lat=Across(path,k).Lerp(Across(path,k+1),t).Normalized();
                uv=new Vector2((p-path[k].Lerp(path[k+1],t)).Dot(lat),Mathf.Lerp(along[k],along[k+1],t));
            }
            chartMemo[p]=uv;return uv;
        }
        for(int row=0;row+1<path.Length;row++)
        {
            var la=Across(path,row);var lb=Across(path,row+1);
            var a=path[row]-la*.613f;var b=path[row]+la*.613f;var c=path[row+1]+lb*.613f;var d=path[row+1]-lb*.613f;
            RuienPaving.Slab(stone,new[]{a,b,c,d},.26f,.008f);
            RuienPaving.Triangle(paving,a,b,c,chart:Chart);RuienPaving.Triangle(paving,a,c,d,chart:Chart);
        }
        RuienStair.Add(root,lining,"ruien_brick_stretcher_rim",true,metric:false,trim:HostAir(spec));
        var acrossEnd=Across(path,path.Length-1);
        RuienPaving.Border(stone,originalEnd+endDirection*.09f-acrossEnd*.61f+Vector3.Up*.026f,
            originalEnd+endDirection*.09f+acrossEnd*.61f+Vector3.Up*.026f);
        RuienStair.Add(root,stone,"ruien_bluestone",true);
        RuienStair.Add(root,paving,"ruien_setts",true,metric:false);
        var endFrame=new Transform3D(new Basis(acrossEnd,Vector3.Up,endDirection),path[^1]);
        EndWeb(root,endFrame,Transform3D.Identity,HostAir(spec),.86f);
        return root;
    }
}
