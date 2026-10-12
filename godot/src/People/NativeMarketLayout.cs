using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.People;

public readonly record struct NativeMarketPoint(double X,double Z);
public readonly record struct NativeMarketRect(double MinX,double MaxX,double MinZ,double MaxZ,double Top=0)
{public bool Contains(double x,double z,double pad=0)=>x>MinX-pad&&x<MaxX+pad&&z>MinZ-pad&&z<MaxZ+pad;}
public readonly record struct NativeMarketCircle(double X,double Z,double Radius);
public readonly record struct NativeMarketExtent(double U0,double U1,double V0,double V1);
public sealed class NativeMarketPut
{
    public string Source="",Name="";
    public double U,Y,V,Yaw;
    public double[] Scale={1,1,1};
    public double[]? Tint;
    public string? Awning;
    public bool Solid=true;
}
public sealed class NativeMarketItem
{
    public string Kind="",Goods="",SellerKind="";
    public double X,Z,Yaw,HalfLength,HalfDepth,Talk;
    public bool Sits;
    public int Rank;
    public NativeMarketPoint SellerAt,FrontAt,Seller,Front;
    public NativeMarketRect[] Rects=Array.Empty<NativeMarketRect>();
    public readonly List<NativeMarketPut> Puts=new();
}
/// <summary>Original market layout/dressing decisions, driven by the native scene's model points and navigation.</summary>
public sealed partial class NativeMarketLayout
{
    private readonly JsonObject data;
    private readonly Func<string,string,bool> has;
    private readonly Func<string,string,double[]> points;
    private readonly HashSet<string> materials;
    public int Tried {get;private set;}
    public readonly Dictionary<string,int> Refused=new();
    public NativeMarketLayout(JsonObject data,Func<string,string,bool> has,Func<string,string,double[]> points,IEnumerable<string> materials)=>(this.data,this.has,this.points,this.materials)=(data,has,points,materials.ToHashSet());
    private static double N(JsonNode? n)=>n?.GetValue<double>()??0;
    private static string S(JsonNode? n)=>n?.GetValue<string>()??"";
    private static NativeMarketPoint P(JsonNode n)=>new(N(n[0]),N(n[1]));
    private static double Dist(NativeMarketPoint a,NativeMarketPoint b)=>Math.Sqrt(Math.Pow(a.X-b.X,2)+Math.Pow(a.Z-b.Z,2));
    private static Func<double> Random(uint seed)=>()=>{seed=unchecked(seed+0x6d2b79f5);uint t=seed;t=unchecked((t^(t>>15))*(t|1));t^=unchecked(t+((t^(t>>7))*(t|61)));return(t^(t>>14))/4294967296.0;};
    public NativeMarketExtent Extent(IReadOnlyList<NativeMarketPut> puts,double below=99,double uMin=double.NegativeInfinity,double uMax=double.PositiveInfinity)
    {
        double u0=double.PositiveInfinity,u1=double.NegativeInfinity,v0=double.PositiveInfinity,v1=double.NegativeInfinity;
        foreach(var q in puts){if(!q.Solid)continue;var pts=points(q.Source,q.Name);double c=Math.Cos(q.Yaw),s=Math.Sin(q.Yaw);
            for(int i=0;i+2<pts.Length;i+=3){if(q.Y+pts[i+1]*q.Scale[1]>below)continue;double lx=pts[i]*q.Scale[0],lz=pts[i+2]*q.Scale[2],u=q.U+lx*c+lz*s,v=q.V-lx*s+lz*c;if(u<uMin||u>uMax)continue;u0=Math.Min(u0,u);u1=Math.Max(u1,u);v0=Math.Min(v0,v);v1=Math.Max(v1,v);}}
        return double.IsFinite(u0)?new(u0,u1,v0,v1):new(-.5,.5,-.4,.4);
    }
    public void Place(NativeMarketItem it,double x,double z,double yaw,NativeMarketExtent low)
    {
        it.X=x;it.Z=z;it.Yaw=yaw;double c=Math.Cos(yaw),s=Math.Sin(yaw);NativeMarketPoint World(double u,double v)=>new(x+u*c+v*s,z-u*s+v*c);
        NativeMarketRect Box(NativeMarketExtent b,double top){var ps=new[]{World(b.U0,b.V0),World(b.U1,b.V0),World(b.U0,b.V1),World(b.U1,b.V1)};return new(ps.Min(p=>p.X),ps.Max(p=>p.X),ps.Min(p=>p.Z),ps.Max(p=>p.Z),top);}
        double top=it.Kind is"baskets"or"pottery"?.5:it.Kind=="barrow"?.7:1.1,mid=(low.U0+low.U1)/2;it.Rects=new[]{Box(Extent(it.Puts,1.3,low.U0,mid),top),Box(Extent(it.Puts,1.3,mid,low.U1),top)};
        it.FrontAt=new(it.FrontAt.X,low.V1+.6);it.Seller=World(it.SellerAt.X,it.SellerAt.Z);it.Front=World(it.FrontAt.X,it.FrontAt.Z);
    }
    public List<NativeMarketItem> Layout(JsonObject def,IReadOnlyList<NativeMarketCircle> circles,IReadOnlyList<NativeMarketRect> solids,IReadOnlyList<NativeMarketRect> lanes,IReadOnlyList<NativeMarketRect> tracks,Func<double,double,int> flags)
    {
        Tried=0;Refused.Clear();var R=Random((uint)N(def["seed"]));double J(double range)=>(R()*2-1)*range;
        var bounds=def["bounds"]!.AsArray().Select(n=>new NativeMarketRect(N(n!["minX"]),N(n["maxX"]),N(n["minZ"]),N(n["maxZ"]))).ToArray();
        var keeps=def["keep"]!.AsArray().Select(n=>new NativeMarketRect(N(n![0]),N(n[1]),N(n[2]),N(n[3]))).ToArray();
        var placed=new List<(double X,double Z,double C,double S,NativeMarketExtent Box)>();var items=new List<NativeMarketItem>();
        bool No(string why){Refused[why]=Refused.GetValueOrDefault(why)+1;return false;}
        bool Fits(double x,double z,double yaw,NativeMarketExtent b,double back,double front){
            double c=Math.Cos(yaw),s=Math.Sin(yaw),du=Math.Max(.2,(b.U1-b.U0)/10);
            for(double u=b.U0;u<=b.U1+1e-6;u+=du)for(double v=b.V0-back;v<=b.V1+front+1e-6;v+=.3){
                double px=x+u*c+v*s,pz=z-u*s+v*c;bool body=v<b.V1+.2;if(body&&!bounds.Any(r=>r.Contains(px,pz)))return No("bounds");if(flags(px,pz)!=0)return No("walk map");
                if(lanes.Any(r=>r.Contains(px,pz,.2)))return No("omnibus");if(tracks.Any(r=>r.Contains(px,pz,.2)))return No("railway");if(body&&keeps.Any(r=>r.Contains(px,pz)))return No("kept free");if(solids.Any(r=>r.Contains(px,pz,.25)))return No("solid");
                if(circles.Any(q=>Math.Pow(px-q.X,2)+Math.Pow(pz-q.Z,2)<q.Radius*q.Radius))return No("circle");
                foreach(var q in placed){double dx=px-q.X,dz=pz-q.Z,lu=dx*q.C-dz*q.S,lv=dx*q.S+dz*q.C;if(lu>q.Box.U0-.15&&lu<q.Box.U1+.15&&lv>q.Box.V0-.15&&lv<q.Box.V1+.15)return No("another stall");}
            }return true;
        }
        var lengths=new Dictionary<string,(double Low,double High)>{{"stall",(2.2,3.1)},{"table",(1.6,1.6)},{"bench",(2.2,2.2)},{"barrow",(2.1,2.1)},{"cart",(2.8,2.8)},{"baskets",(1.5,2.1)},{"fishtable",(2.2,2.2)},{"vegstall",(2.4,2.4)},{"pottery",(1.9,1.9)},{"brazier",(1.6,1.6)},{"clothstall",(2.2,2.2)}};
        var depths=new Dictionary<string,double>{{"stall",.72},{"table",.4},{"bench",.42},{"barrow",.42},{"cart",.7},{"baskets",.45},{"fishtable",.5},{"vegstall",.5},{"pottery",.6},{"brazier",.45},{"clothstall",.42}};
        bool rough=def["rough"]!.GetValue<bool>();string[] awnings=(rough?new[]{"awning_red","awning_blue","canvas_patched","canvas_patched","sackcloth"}:new[]{"awning_red","awning_blue","awning_red","awning_blue","canvas_patched"}).Where(materials.Contains).ToArray();
        (NativeMarketItem Item,NativeMarketExtent All,NativeMarketExtent Low) Make(string kind,string goods,double length){var sellers=data["sellers"]![goods]!.AsArray();string seller=S(sellers[(int)Math.Floor(R()*sellers.Count)]);double su=R()*.6-.3,fu=R()*.8-.4;var it=new NativeMarketItem{Kind=kind,Goods=goods,SellerKind=seller,Sits=seller=="old_man"||kind=="pottery",HalfLength=length/2,HalfDepth=depths[kind],Talk=R()*5,SellerAt=new(su,-(depths[kind]+.5)),FrontAt=new(fu,depths[kind]+.75)};Dress(it,awnings,R,rough);return(it,Extent(it.Puts),Extent(it.Puts,1.3));}
        (string Kind,string Goods) PickMix(){var mix=def["mix"]!.AsArray();double r=R()*mix.Sum(n=>N(n![0]));foreach(var m in mix)if((r-=N(m![0]))<=0)return(S(m[1]),S(m[2]));return(S(mix[0]![1]),S(mix[0]![2]));}
        foreach(var row in def["rows"]!.AsArray()){
            var pts=row!["pts"]!.AsArray().Select(n=>P(n!)).ToArray();var line=new List<NativeMarketPoint>();
            for(int i=0;i<pts.Length-1;i++){var p0=pts[Math.Max(0,i-1)];var p1=pts[i];var p2=pts[i+1];var p3=pts[Math.Min(pts.Length-1,i+2)];for(int k=0;k<8;k++){double t=k/8.0,t2=t*t,t3=t2*t;double F(double a,double b,double c,double d)=>.5*(2*b+(-a+c)*t+(2*a-5*b+4*c-d)*t2+(-a+3*b-3*c+d)*t3);line.Add(new(F(p0.X,p1.X,p2.X,p3.X),F(p0.Z,p1.Z,p2.Z,p3.Z)));}}line.Add(pts[^1]);
            var acc=new List<double>{0};for(int i=1;i<line.Count;i++)acc.Add(acc[^1]+Dist(line[i],line[i-1]));double total=acc[^1];var face=P(row["face"]!);
            (double X,double Z,double TX,double TZ) At(double pos){int i=1;while(i<acc.Count-1&&acc[i]<pos)i++;double k=(pos-acc[i-1])/Math.Max(1e-6,acc[i]-acc[i-1]);var a=line[i-1];var b=line[i];double len=Dist(a,b);if(len==0)len=1;return(a.X+(b.X-a.X)*k,a.Z+(b.Z-a.Z)*k,(b.X-a.X)/len,(b.Z-a.Z)/len);}
            double pos=R()*.8;while(pos<total-1){var (kind,goods)=PickMix();var length=lengths[kind];double len=length.Low+R()*(length.High-length.Low);var made=Make(kind,goods,len);double half=Math.Max(-made.All.U0,made.All.U1);if(pos+2*half>total+.3)break;var c=At(pos+half);double nx=-c.TZ,nz=c.TX;if(nx*face.X+nz*face.Z<0){nx=-nx;nz=-nz;}double x=c.X+nx*J(.45)+c.TX*J(.2),z=c.Z+nz*J(.45)+c.TZ*J(.2),yaw=Math.Atan2(nx,nz)+J(.22);Tried++;
                if(!Fits(x,z,yaw,made.All,.9,1.25)){pos+=.7;continue;}Place(made.Item,x,z,yaw,made.Low);items.Add(made.Item);placed.Add((x,z,Math.Cos(yaw),Math.Sin(yaw),new(made.All.U0,made.All.U1,made.All.V0-.85,made.All.V1+1.1)));pos+=2*half+(R()<.1?1.8+R()*.8:.2+R()*.45);
            }
        }
        int scattered=0,scatter=(int)N(def["scatter"]);
        for(int k=0;k<scatter*8&&items.Count<999;k++){var b=bounds[(int)Math.Floor(R()*bounds.Length)];double x=b.MinX+R()*(b.MaxX-b.MinX),z=b.MinZ+R()*(b.MaxZ-b.MinZ),yaw=R()*Math.Tau;string kind=R()<.7?"baskets":"barrow",goods=S(def["place"])=="vismarkt"?(R()<.75?"fish":"veg"):"veg";var made=Make(kind,goods,kind=="baskets"?1.5:2.1);Tried++;if(!Fits(x,z,yaw,made.All,.8,1.2))continue;Place(made.Item,x,z,yaw,made.Low);items.Add(made.Item);placed.Add((x,z,Math.Cos(yaw),Math.Sin(yaw),new(made.All.U0,made.All.U1,made.All.V0-.8,made.All.V1+1)));if(++scattered>=scatter)break;}
        var ordered=items.Select(it=>(Item:it,Key:(it.Goods=="fish"?0:.4)+R())).OrderBy(o=>o.Key).ToArray();for(int i=0;i<ordered.Length;i++)ordered[i].Item.Rank=i;return ordered.Select(o=>o.Item).ToList();
    }
}
