using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.World.Ruien;

/// <summary>Shared worn quay setts, with the town's height map carried by real geometry.</summary>
public static class RuienPaving
{
    public const string Colour = "res://world/town/resources/r000033.res";
    public const string Height = "res://world/town/resources/r000035.res";
    public const float Tile = 2.5f, Relief = .016f;
    private static Image? height;
    private static float[]? heightRed;
    private static int heightWidth,heightRows;
    private static RuienData.Zone[] paths=Array.Empty<RuienData.Zone>();
    private static float? uniformFloor;
    private static RuienData.Zone[] rooms=Array.Empty<RuienData.Zone>();
    private static readonly Dictionary<RuienData.Zone,RuienPavingSearch> pathSearch=new();
    private static readonly Dictionary<(RuienData.Zone,float),RuienPavingSearch> offsetSearch=new();
    private static readonly Dictionary<Vector3,Vector2> chartMemo=new();
    /// <summary>Proof switch: compare the same construction with the original full searches.</summary>
    public static bool FullSearchProof;
    public static void Layout(RuienData.Area area,IReadOnlyDictionary<string,RuienData.Zone>? built=null)
    {
        pathSearch.Clear();offsetSearch.Clear();chartMemo.Clear();offsets.Clear();
        // The export was swept along its own smoothed key line; rows must turn where its walls turn, not where the
        // plan's coarser line bends (that put a phantom bend into the straight walk by the gate and smeared the setts).
        // `built` holds each line zone's repair path by zone id.
        paths=System.Linq.Enumerable.ToArray(System.Linq.Enumerable.Select(System.Linq.Enumerable.Where(area.Zones,z=>z.Kind=="line"),
            z=>built!=null&&built.TryGetValue(z.Id,out var b)?b:z));
        uniformFloor=System.Linq.Enumerable.All(area.Zones,z=>z.S.WalkwaySide==0 && z.S.LedgeY==area.Zones[0].S.LedgeY) && area.Zones.Count>0 ? area.Zones[0].S.LedgeY : null;
        rooms=System.Linq.Enumerable.ToArray(System.Linq.Enumerable.Where(area.Zones,z=>z.Kind=="room"));
        foreach(var path in paths)pathSearch[path]=new RuienPavingSearch(path.Path);
    }
    private static float Inside(RuienData.Zone z,Vector2 p,out float along)=>FullSearchProof?z.Inside(p,out along):z.Inside(p,out along,pathSearch[z].Candidates(p));

    // Coordinates follow the ledge's own centre line. Offset arc length accounts for the shorter inside
    // and longer outside of a bend; the logarithmic transverse coordinate keeps the rows locally square.
    public static Vector2 Coordinates(Vector3 p)
    {
        if(FullSearchProof)return FindCoordinates(p);
        if(chartMemo.TryGetValue(p,out var hit))return hit;
        return chartMemo[p]=FindCoordinates(p);
    }
    private static Vector2 FindCoordinates(Vector3 p)
    {
        var q=new Vector2(p.X,p.Z);
        foreach(var room in rooms)
            if(room.Rect.HasPoint(q))
            {
                float edge=Math.Min(q.X-room.Rect.Position.X,room.Rect.End.X-q.X);
                bool alongZ=edge<room.S.Ledge && q.Y>room.Rect.Position.Y+room.S.Ledge &&
                    (q.Y<room.Rect.End.Y-room.S.Ledge || p.Y>room.S.LedgeY+.05f);
                return alongZ?new Vector2(p.X,p.Z):new Vector2(p.Z,p.X);
            }
        RuienData.Zone? best=null;float distance=float.MaxValue,u=0;
        foreach(var path in paths)
        {
            float inside=Inside(path,q,out float at);
            if(inside>=-1.1f && path.S.Width/2-inside<distance){best=path;distance=path.S.Width/2-inside;u=at;}
        }
        if(best==null)return new Vector2(p.X,p.Z);
        var z=best;
        (Vector2 at,Vector2 tangent) Frame(float s)
        {
            var at=z.Frame(s).at;
            var t=(z.Frame(Math.Min(z.Length,s+.14f)).at-z.Frame(Math.Max(0,s-.14f)).at).Normalized();
            return(at,t);
        }
        var f=Frame(u);var n=new Vector2(f.tangent.Y,-f.tangent.X);
        float side=(q-f.at).Dot(n),centre=MathF.Sign(side)*(z.S.Edge(side>=0?1:-1)+z.S.Width/2)/2;
        // Rows run along the walk's own centre line: the path offset by the walk's centre, mitred at corners.
        // Arc length on that line is metric for every vertex of the walk, at bends and sharp corners alike
        // (a sharp corner meets under its dressed seam stone).
        var line=Offset(z,centre);
        if(!offsetSearch.TryGetValue((z,centre),out var lookup))offsetSearch[(z,centre)]=lookup=new RuienPavingSearch(line.points);
        var candidates=FullSearchProof?null:lookup.Candidates(q);
        float bestD=float.MaxValue,along=0,across=0;
        int count=candidates?.Length??Math.Max(0,line.points.Length-1);
        for(int k=0;k<count;k++)
        {
            int i=candidates==null?k:candidates[k];
            var a=line.points[i];var b=line.points[i+1];var ab=b-a;float len=ab.Length();if(len<1e-5f)continue;
            // Past the line's ends the rows run straight on (the throat and the gate seam), not smeared at one u.
            float t=Math.Clamp((q-a).Dot(ab)/(len*len),i==0?-4f:0,i+2==line.points.Length?4f:1);var c=a+ab*t;
            float d=q.DistanceSquaredTo(a+ab*Math.Clamp(t,0,1));
            if(d<bestD){bestD=d;along=line.cum[i]+t*len;var nn=new Vector2(ab.Y,-ab.X)/len;across=(q-c).Dot(nn);}
        }
        return new Vector2(across+centre,along);
    }
    private static readonly Dictionary<(RuienData.Zone,float),(Vector2[] points,float[] cum)> offsets=new();
    private static (Vector2[] points,float[] cum) Offset(RuienData.Zone z,float d)
    {
        if(offsets.TryGetValue((z,d),out var hit))return hit;
        var p=z.Path;var pts=new List<Vector2>();
        Vector2 N(Vector2 a,Vector2 b){var t=(b-a).Normalized();return new Vector2(t.Y,-t.X);}
        for(int i=0;i<p.Length;i++)
        {
            if(i==0){pts.Add(p[0]+N(p[0],p[1])*d);continue;}
            if(i==p.Length-1){pts.Add(p[i]+N(p[i-1],p[i])*d);continue;}
            var n0=N(p[i-1],p[i]);var n1=N(p[i],p[i+1]);var m=(n0+n1);
            if(m.LengthSquared()<1e-6f){pts.Add(p[i]+n0*d);continue;}
            m=m.Normalized();float c=Math.Max(.3f,m.Dot(n0));pts.Add(p[i]+m*(d/c));
        }
        var cum=new float[pts.Count];for(int i=1;i<pts.Count;i++)cum[i]=cum[i-1]+pts[i].DistanceTo(pts[i-1]);
        return offsets[(z,d)]=(pts.ToArray(),cum);
    }
    private static Image Heights
    {
        get
        {
            if (height != null) return height;
            height = ResourceLoader.Load<Texture2D>(Height).GetImage();
            if (height.IsCompressed()) height.Decompress();
            return height;
        }
    }
    public static float Sample(float x, float z)
    {
        var im=Heights;
        if(!FullSearchProof && heightRed==null)
        {
            heightWidth=im.GetWidth();heightRows=im.GetHeight();heightRed=new float[heightWidth*heightRows];
            // Capture the engine's exact red floats once, including its source format
            // conversion. Repeated relief samples then stay on managed arrays.
            for(int row=0;row<heightRows;row++)for(int column=0;column<heightWidth;column++)
                heightRed[row*heightWidth+column]=im.GetPixel(column,row).R;
        }
        int width=FullSearchProof?im.GetWidth():heightWidth,rows=FullSearchProof?im.GetHeight():heightRows;
        float u=Mathf.PosMod(x/Tile,1)*width, v=Mathf.PosMod(z/Tile,1)*rows;
        int ix=(int)u, iz=(int)v;
        float H(int a,int b)=>FullSearchProof?im.GetPixel(a%width,b%rows).R:heightRed![(b%rows)*width+a%width];
        return Mathf.Lerp(Mathf.Lerp(H(ix,iz),H(ix+1,iz),u-ix),Mathf.Lerp(H(ix,iz+1),H(ix+1,iz+1),u-ix),v-iz);
    }
    public static void Triangle(SurfaceTool st,Vector3 a,Vector3 b,Vector3 c,float spacing=.045f,Vector3 origin=default,Func<Vector3,Vector2>? chart=null)
    {
        float ab=a.DistanceSquaredTo(b),bc=b.DistanceSquaredTo(c),ca=c.DistanceSquaredTo(a);
        if(MathF.Max(ab,MathF.Max(bc,ca))>spacing*spacing)
        {
            if(ab>=bc && ab>=ca){var m=(a+b)/2;Triangle(st,a,m,c,spacing,origin,chart);Triangle(st,m,b,c,spacing,origin,chart);}
            else if(bc>=ca){var m=(b+c)/2;Triangle(st,a,b,m,spacing,origin,chart);Triangle(st,a,m,c,spacing,origin,chart);}
            else {var m=(c+a)/2;Triangle(st,a,b,m,spacing,origin,chart);Triangle(st,m,b,c,spacing,origin,chart);}
            return;
        }
        foreach(var p0 in new[]{a,b,c})
        {
            var p=p0;var world=p+origin;var uv=(chart??Coordinates)(world);
            // Relief low-passed over 1 cm: the vertices are 4.5 cm apart, single texels alias into facets.
            float S(Vector2 q)=>(Sample(q.X,q.Y)*2+Sample(q.X+.01f,q.Y)+Sample(q.X-.01f,q.Y)+Sample(q.X,q.Y+.01f)+Sample(q.X,q.Y-.01f))/6;
            float H(Vector3 at)=>S((chart??Coordinates)(at));
            float h=S(uv);
            p.Y+=Relief*h;
            // (sampled over 18 mm: the height picture's grain at 2.4 mm turned low daylight into streaks on each sett)
            const float e=.018f;
            var n=new Vector3(-(H(world+Vector3.Right*e)-H(world-Vector3.Right*e))*Relief/(2*e),1,-(H(world+Vector3.Back*e)-H(world-Vector3.Back*e))*Relief/(2*e)).Normalized();
            st.SetNormal(n);st.SetUV(uv/Tile);
            // Existing dirt stays in the joints; the water-facing strip takes more slime and damp.
            float wet=.48f;
            if(Ruien.I?.WaterAt(world.X,world.Z) is float water) wet+=.2f*Math.Clamp(1-MathF.Abs(world.Y-water)/2,0,1);
            // Sediment collects in recessed joints and at the wall foot; traffic keeps the crowns clearer.
            float wall=0;
            var q=new Vector2(world.X,world.Z);
            foreach(var z in paths)
                if(Inside(z,q,out _)>=-.1f)wall=Math.Max(wall,Math.Clamp(1-MathF.Abs(Inside(z,q,out _))/.22f,0,1));
            foreach(var z in rooms)
                if(z.Rect.HasPoint(q))wall=Math.Max(wall,Math.Clamp(1-Math.Min(Math.Min(q.X-z.Rect.Position.X,z.Rect.End.X-q.X),Math.Min(q.Y-z.Rect.Position.Y,z.Rect.End.Y-q.Y))/.22f,0,1));
            float patch=.5f+.5f*MathF.Sin(world.X*1.37f+MathF.Sin(world.Z*.81f))*MathF.Sin(world.Z*1.13f);
            float joint=Math.Clamp((.68f-h)*2.4f,0,1);
            wet+=.14f*wall+.08f*patch;
            st.SetColor(new Color(wet,0,.18f+.28f*joint+.12f*wall*patch,.12f*wall*joint*patch));st.AddVertex(p);
        }
    }
    public static void Rectangle(SurfaceTool st,Transform3D xf,float width,float length,Vector3 origin)
    {
        var a=xf*new Vector3(-width/2,0,-length/2);var b=xf*new Vector3(width/2,0,-length/2);
        var c=xf*new Vector3(width/2,0,length/2);var d=xf*new Vector3(-width/2,0,length/2);
        // A common phase along this direction avoids repeating the same stone on every stair tread.
        Vector2 Chart(Vector3 p)=>new(p.Dot(xf.Basis.X),p.Dot(xf.Basis.Z));
        Triangle(st,a,b,c,origin:origin,chart:Chart);Triangle(st,a,c,d,origin:origin,chart:Chart);
    }
    public static void Quad(SurfaceTool st,Vector3 a,Vector3 b,Vector3 c,Vector3 d,Vector3 along,Vector3 origin)
    {
        var across=new Vector3(along.Z,0,-along.X);
        Vector2 Chart(Vector3 p)=>new(p.Dot(across),p.Dot(along));
        Triangle(st,a,b,c,origin:origin,chart:Chart);Triangle(st,a,c,d,origin:origin,chart:Chart);
    }

    /// <summary>A mitred landing slab, with geometric bevels on its top, bottom and upright corners.</summary>
    public static void Slab(SurfaceTool st,Vector3[] corners,float thickness=.18f,float bevel=.006f)
    {
        var outline=new List<Vector3>();
        for(int i=0;i<corners.Length;i++)
        {
            var p=corners[i];
            outline.Add(p+(corners[(i+corners.Length-1)%corners.Length]-p).Normalized()*bevel);
            outline.Add(p+(corners[(i+1)%corners.Length]-p).Normalized()*bevel);
        }
        var centre=Vector3.Zero;foreach(var p in corners)centre+=p/corners.Length;
        var inner=new Vector3[outline.Count];
        for(int i=0;i<outline.Count;i++)
        {
            var p=outline[i];var prev=(p-outline[(i+outline.Count-1)%outline.Count]).Normalized();var next=(outline[(i+1)%outline.Count]-p).Normalized();
            var n0=new Vector3(-prev.Z,0,prev.X);var n1=new Vector3(-next.Z,0,next.X);
            if(n0.Dot(centre-p)<0)n0=-n0;if(n1.Dot(centre-p)<0)n1=-n1;
            var bis=(n0+n1).Normalized();inner[i]=p+bis*(bevel/Math.Max(.2f,bis.Dot(n0)));
        }
        void Face(Vector3[] points,Vector3 outward)
        {
            var n=(points[1]-points[0]).Cross(points[2]-points[0]).Normalized();if(n.Dot(outward)<0)n=-n;
            var u=n.Cross(MathF.Abs(n.Y)<.8f?Vector3.Up:Vector3.Right).Normalized();var v=n.Cross(u);
            for(int i=1;i+1<points.Length;i++)
            {
                var a=points[0];var b=points[i];var c=points[i+1];if((b-a).Cross(c-a).Dot(n)>0)(b,c)=(c,b);
                foreach(var p in new[]{a,b,c}){st.SetNormal(n);st.SetUV(new Vector2(p.Dot(u),p.Dot(v)));st.AddVertex(p);}
            }
        }
        Face(inner,Vector3.Up);Face(Array.ConvertAll(inner,p=>p-Vector3.Up*thickness),Vector3.Down);
        for(int i=0;i<outline.Count;i++)
        {
            int j=(i+1)%outline.Count;var outward=(outline[i]+outline[j])/2-centre;
            var a=outline[i]-Vector3.Up*bevel;var b=outline[j]-Vector3.Up*bevel;
            var c=outline[i]-Vector3.Up*(thickness-bevel);var d=outline[j]-Vector3.Up*(thickness-bevel);
            Face(new[]{inner[i],inner[j],b,a},outward+Vector3.Up);
            Face(new[]{a,b,d,c},outward);
            Face(new[]{c,d,inner[j]-Vector3.Up*thickness,inner[i]-Vector3.Up*thickness},outward-Vector3.Up);
        }
    }
    /// <summary>Dressed transverse bond, 10 mm above the highest sett, with 6 mm worn arrises.</summary>
    public static void Border(SurfaceTool stone,Vector3 a,Vector3 b,float width=.16f)
    {
        float length=a.DistanceTo(b);int count=Math.Max(1,(int)MathF.Ceiling(length/.48f));
        var direction=(b-a).Normalized();var basis=Basis.LookingAt(direction);
        for(int i=0;i<count;i++)
        {
            var at=a.Lerp(b,(i+.5f)/count)-Vector3.Up*.04f;
            var block=BevelMesh.Shared(new Vector3(width,.08f,length/count-.005f),.006f,RuienMaterials.Get("ruien_bluestone"));
            stone.AppendFrom(block,0,new Transform3D(basis,at));
        }
    }
    public static float? Floor(Vector3 p)
    {
        // Uniform two-sided areas need no path search per vertex (the original G extraction semantics).
        if(uniformFloor is float walk)
        {
            float dy=walk-(-3.6f);
            return p.Y> -3.66f+dy && p.Y< -3.54f+dy ? walk : null;
        }
        var q=new Vector2(p.X,p.Z);
        RuienData.Zone? best=null;float distance=float.MaxValue;
        foreach(var z in paths)
        {
            float inside=Inside(z,q,out _);
            if(z.S.Width/2-inside<distance){best=z;distance=z.S.Width/2-inside;}
        }
        foreach(var z in rooms) if(z.Rect.HasPoint(q)) { best=z;break; }
        if(best==null)return p.Y> -3.66f && p.Y< -3.54f ? -3.6f : null;
        var s=best.S;
        if(best.Kind=="line" && s.WalkwaySide!=0)
        {
            Inside(best,q,out float u);var(c,t)=best.Frame(u);
            float across=(q-c).Dot(new Vector2(t.Y,-t.X))*s.WalkwaySide;
            if(across<s.Edge(s.WalkwaySide)-.06f || across>s.Width/2+.06f)return null;
        }
        return p.Y> -3.66f+s.WalkOffset && p.Y< -3.54f+s.WalkOffset ? s.LedgeY : null;
    }
    public static bool Extract(Godot.Collections.Array arrays,SurfaceTool paving,float spacing,Func<Vector3,float?>? floor=null)
    {
        var p=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();var ix=arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
        var keep=new List<int>();bool changed=false;
        floor ??= Floor;
        for(int i=0;i<ix.Length;i+=3)
        {
            var a=p[ix[i]];var b=p[ix[i+1]];var c=p[ix[i+2]];
            float? ha=floor.Invoke(a),hb=floor.Invoke(b),hc=floor.Invoke(c);
            bool top=(ha.HasValue && hb.HasValue && hc.HasValue && MathF.Abs(ha.Value-hb.Value)<.001f && MathF.Abs(ha.Value-hc.Value)<.001f)
                && MathF.Abs((b-a).Cross(c-a).Normalized().Y)>.65f;
            if(!top){keep.AddRange(new[]{ix[i],ix[i+1],ix[i+2]});continue;}
            a.Y=b.Y=c.Y=ha!.Value;Triangle(paving,a,b,c,spacing);changed=true;
        }
        arrays[(int)Mesh.ArrayType.Index]=keep.ToArray();return changed;
    }
    public static void PrepareTextures()
    {
        var h=Heights;int w=h.GetWidth(),hh=h.GetHeight();
        var hra=Image.CreateEmpty(w,hh,false,Image.Format.Rgb8);var normal=Image.CreateEmpty(w,hh,false,Image.Format.Rgb8);
        for(int y=0;y<hh;y++)for(int x=0;x<w;x++)
        {
            float v=h.GetPixel(x,y).R;
            float dx=(h.GetPixel((x+1)%w,y).R-h.GetPixel((x+w-1)%w,y).R)*Relief*w/(Tile*2);
            float dz=(h.GetPixel(x,(y+1)%hh).R-h.GetPixel(x,(y+hh-1)%hh).R)*Relief*hh/(Tile*2);
            var n=new Vector3(-dx,-dz,1).Normalized();
            normal.SetPixel(x,y,new Color(n.X*.5f+.5f,n.Y*.5f+.5f,n.Z*.5f+.5f));
            hra.SetPixel(x,y,new Color(v,.85f,.65f+.35f*v));
        }
        foreach(var pair in new[]{(hra,"hra"),(normal,"normal")})
        {
            pair.Item1.GenerateMipmaps();pair.Item1.Compress(Image.CompressMode.Bptc);
            ResourceSaver.Save(ImageTexture.CreateFromImage(pair.Item1),$"{RuienTextures.Dir}/setts_{pair.Item2}.res",ResourceSaver.SaverFlags.Compress);
        }
        var path=ProjectSettings.GlobalizePath(RuienTextures.Dir+"/families.json");
        var families=System.Text.Json.Nodes.JsonNode.Parse(System.IO.File.ReadAllText(path))!;
        families["setts"]=System.Text.Json.Nodes.JsonNode.Parse("{\"tile\":[2.5,2.5],\"relief\":0.016,\"variants\":false}");
        System.IO.File.WriteAllText(path,families.ToJsonString(new(){WriteIndented=true})+"\n");
    }
}
