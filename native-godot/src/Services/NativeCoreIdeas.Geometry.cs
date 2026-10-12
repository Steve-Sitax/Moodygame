using System;
using System.Collections.Generic;
using System.Linq;
using System.Numerics;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

public sealed partial class NativeCoreIdeas
{
    public Func<double,double,int>? Flags;
    public Func<double,double,double,(double X,double Z)?>? Snap;
    public Func<JsonArray>? Walls;
    public Func<IEnumerable<JsonObject>>? Doors;
    public Func<JsonObject> PolicePost=()=>new(){["x"]=-272,["z"]=100,["label"]="the police post by the town hall"};
    private JsonArray? spotCache;
    private string spotKey="";
    public void InvalidateSpots()=>spotCache=null;
    private static readonly (string Id,string Label,double X,double Z)[] anchors={
        ("rijnkaai","the Rijnkaai",12,44),("vismarkt","the Vismarkt",-110,42),("steenplein","the Steenplein",-176,34),("werf","the Werf",-262,26),
        ("grote_markt","the Grote Markt",-246,100),("vleeshuis","the Vleeshuis",-122,84),("cathedral","the cathedral square",-258,132),("canal","the canal",-64,100)};
    private static readonly (string Label,double X,double Z)[] labels={
        ("the Rijnkaai",10,30),("the Vismarkt",-116,30),("the Steenplein",-180,20),("the Werf",-270,9),("the Grote Markt",-254,94),
        ("the Vleeshuis",-122,84),("the cathedral",-262,138),("the canal",-64,100),("the Petit Bassin",120,117),("the lock",96,26)};
    public static string NearLabel(double x,double z)=>labels.OrderBy(l=>Math.Sqrt(Math.Pow(l.X-x,2)+Math.Pow(l.Z-z,2))).First().Label;
    private static double HalfEven(double n){double f=Math.Floor(n),d=n-f;return Math.Abs(d-.5)<1e-9?(f%2==0?f:f+1):Math.Floor(n+.5);}
    public static JsonArray WallOpenings(JsonObject wall,double gh=3.8,double sh=3)
    {
        var result=new JsonArray();double length=N(wall,"L"),height=N(wall,"H"),door=N(wall,"door",-1);int style=(int)N(wall,"style");bool shut=style is 1 or 2;
        void Add(string what,double s0,double s1,double y0,double y1)=>result.Add(new JsonObject{["what"]=what,["s0"]=s0,["s1"]=s1,["y0"]=y0,["y1"]=y1});
        if(S(wall,"windows")=="front"){
            int bays=Math.Max(1,(int)HalfEven(length/3));double bw=length/bays,ground=Math.Min(gh,height);int doorBay=door>=0?bays/2:-1;
            for(int k=0;k<bays;k++){double begin=k*bw;if(k==doorBay){double half=Math.Min(bw/2,Math.Max(length>=6.5&&!B(wall,"store")?1.6:1,14/64.0*bw));Add("door",begin+bw/2-half,begin+bw/2+half,0,Math.Min(ground,3.45));}else Add("window",begin+9/64.0*bw,begin+55/64.0*bw,gh*(1-55/64.0),Math.Min(ground,gh*(1-10/64.0)));}
            if(B(wall,"store")&&door>=0){for(double k=4.5;k<length-3;k+=9)Add("door",k-1.75,k+1.75,0,3.6);Add("door",door-1.1,door+1.1,0,3.45);}
            for(double y=gh;y<height-.05;y+=sh){double y0=y+sh*9/64.0,y1=Math.Min(height,y+sh*(1-8/64.0));if(y1<=y0)break;for(int k=0;k<bays;k++)Add("upper window",k*bw+(shut?12:18)/64.0*bw,k*bw+(shut?52:46)/64.0*bw,y0,y1);}
        }else if(S(wall,"windows")=="cottage"){
            var spans=new List<(double A,double B)>{(.22,length-.22)};if(door>=0){spans=new(){(.22,door-.45-.12-.15),(door+.45+.12+.15,length-.22)};Add("door",door-.45-.12,door+.45+.12,0,2.5);}
            foreach(var span in spans)foreach(bool shutter in shut?new[]{true,false}:new[]{false}){double ww=1.3*(shutter?40:shut?26:28)/47;int count=span.B-span.A>=ww?(int)Math.Floor((span.B-span.A+.45)/(ww+.45)):0;if(count==0)continue;count=Math.Min(count,Math.Max(1,(int)HalfEven((span.B-span.A)/2)));for(int k=0;k<count;k++){double middle=span.A+(span.B-span.A)*(k+.5)/count;Add("window",middle-ww/2-.05,middle+ww/2+.05,.9,2.3);Add("upper window",middle-ww/2-.05,middle+ww/2+.05,2.6,height);}break;}
            if(door>=0)Add("upper window",door-.6,door+.6,2.6,height);
        }
        if(wall["poort"] is JsonArray passage)Add("passage",V(passage[0]),V(passage[1]),0,4.2);return result;
    }
    public static JsonArray BlankRuns(JsonObject wall,double halfWidth,double y0,double y1,double pad=.12,double end=.35)
    {
        var cuts=WallOpenings(wall).Where(o=>N(o,"y0")<y1+pad&&y0-pad<N(o,"y1")).Select(o=>(A:N(o,"s0")-pad-halfWidth,B:N(o,"s1")+pad+halfWidth)).OrderBy(o=>o.A);double begin=end+halfWidth;var result=new JsonArray();foreach(var cut in cuts){if(cut.A>begin)result.Add(new JsonArray(begin,cut.A));begin=Math.Max(begin,cut.B);}if(N(wall,"L")-end-halfWidth>begin)result.Add(new JsonArray(begin,N(wall,"L")-end-halfWidth));return result;
    }
    // JS toFixed rounds the actual IEEE-754 value, not a multiplication already rounded to a decimal tie.
    public static double Fixed(double n,int places)
    {
        if(!double.IsFinite(n))return n;long bits=BitConverter.DoubleToInt64Bits(Math.Abs(n));int exponent=(int)((bits>>52)&2047);ulong mantissa=(ulong)bits&0xFFFFFFFFFFFFF;if(exponent!=0)mantissa|=1UL<<52;
        int shift=exponent==0?-1074:exponent-1023-52;BigInteger numerator=new BigInteger(mantissa)*BigInteger.Pow(10,places),denominator=BigInteger.One;if(shift>=0)numerator<<=shift;else denominator<<=-shift;
        BigInteger q=BigInteger.DivRem(numerator,denominator,out var remainder);if(remainder*2>=denominator)q++;return(double)q/Math.Pow(10,places)*(n<0?-1:1);
    }
    public JsonArray PosterSpots()
    {
        if(Flags==null||Snap==null)return new();var post=C.World("press")?["post"];string key=N(Town,"seed")+":"+(post?["step"]?.ToJsonString()??"-");if(spotCache!=null&&key==spotKey)return spotCache.DeepClone().AsArray();
        var candidates=new List<JsonObject>();const double hu=.28;foreach(var node in Walls?.Invoke()??A(data["walls"])){
            var w=node!.AsObject();if(B(w,"inWorld"))continue;double tx=N(w,"tx"),tz=N(w,"tz"),ox=N(w,"ox"),oz=N(w,"oz");
            foreach(var run in BlankRuns(w,hu,1.23,2.01,.14,.6)){double r0=V(run![0]),r1=V(run[1]);int count=Math.Max(1,(int)Math.Floor((r1-r0)/.9)+1);for(int k=0;k<count;k++){double s=count==1?(r0+r1)/2:r0+(r1-r0)*k/(count-1),x=N(w,"ax")+tx*s,z=N(w,"az")+tz*s;
                if((Flags(x-ox*.3,z-oz*.3)&1)==0)continue;bool open=true;foreach(double edge in new[]{-hu,0,hu})foreach(double d in new[]{.45,.9})if(Flags(x+tx*edge+ox*d,z+tz*edge+oz*d)!=0)open=false;if(!open)continue;
                if(A(data["lamps"]).Any(l=>Math.Sqrt(Math.Pow(V(l![0])-x,2)+Math.Pow(V(l[2])-z,2))<.75))continue;var stand=Snap(x+ox*1.3,z+oz*1.3,2.5);if(stand==null||Math.Sqrt(Math.Pow(stand.Value.X-x,2)+Math.Pow(stand.Value.Z-z,2))>3)continue;
                candidates.Add(new JsonObject{["x"]=x,["z"]=z,["out"]=new JsonArray(ox,oz),["at"]=new JsonArray(Fixed(stand.Value.X,2),Fixed(stand.Value.Z,2))});}}
        }
        var wanted=anchors.ToList();var pp=PolicePost();wanted.Add(("police",S(pp,"label"),N(pp,"x"),N(pp,"z")));if(post?["step"] is JsonArray step)wanted.Add(("post","the post office",V(step[0]),V(step[1])));
        var output=new JsonArray();var used=new List<JsonObject>();foreach(var anchor in wanted){int count=0;foreach(var c in candidates.Where(c=>Distance(c,Point(anchor.X,anchor.Z))<45).OrderBy(c=>Distance(c,Point(anchor.X,anchor.Z)))){if(count>=2)break;if(used.Any(p=>Distance(p,c)<2.5))continue;used.Add(c);output.Add(new JsonObject{["id"]=$"{anchor.Id}:{count}",["label"]=anchor.Label,["x"]=Fixed(N(c,"x"),3),["z"]=Fixed(N(c,"z"),3),["out"]=new JsonArray(Fixed(V(c["out"]![0]),4),Fixed(V(c["out"]![1]),4)),["at"]=c["at"]!.DeepClone()});count++;}}
        spotCache=output;spotKey=key;return output.DeepClone().AsArray();
    }
}
