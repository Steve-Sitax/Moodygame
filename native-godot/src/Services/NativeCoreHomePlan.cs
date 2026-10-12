using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>Exact shared/homes.ts grid, layered footprint, bed access and comfort rules.</summary>
public sealed class NativeCoreHomePlan
{
    private readonly NativeServiceContext context;
    public NativeCoreHomePlan(NativeServiceContext context)=>this.context=context;
    public JsonObject Class(string cls)=>context.Rules["homeClasses"]![cls]!.AsObject();
    public JsonObject? Furniture(string kind)=>context.Rules["furniture"]?[kind] as JsonObject;
    public (int x,int z) Grid(string cls){var c=Class(cls);return((int)Math.Floor(D(c,"W")/.5+.5),(int)Math.Floor(D(c,"D")/.5+.5));}
    private static IEnumerable<(int x,int z)> Cells(int gx,int gz,int w,int d){for(int x=0;x<w;x++)for(int z=0;z<d;z++)yield return(gx+x,gz+z);}
    private static (int w,int d) Footprint(JsonObject def,int rot)=>rot%2==0?(N(def,"w"),N(def,"d")):(N(def,"d"),N(def,"w"));
    private static (int wall,int start,int end) WallSpan(int gx,int gz,int width,int rot){int wall=((rot%4)+4)%4;int at=wall is 0 or 2?gx:gz;return(wall,at,at+width-1);}
    public string? CanPlace(string cls,JsonArray placed,string kind,double x,double z,double turn,int ignoreId=-1)
    {
        var def=Furniture(kind);if(def==null)return "no such piece";
        if(!new[]{x,z,turn}.All(n=>double.IsFinite(n)&&Math.Floor(n)==n))return "off the grid";
        if(turn<0||turn>3)return "bad turn";
        int gx=(int)x,gz=(int)z,rot=(int)turn;var c=Class(cls);var(nx,nz)=Grid(cls);
        var others=placed.Where(p=>p!=null&&N(p.AsObject(),"id")!=ignoreId&&Furniture(S(p.AsObject(),"kind"))!=null).Select(p=>p!.AsObject()).ToArray();
        string layer=S(def,"layer");
        if(layer=="wall"){
            int wall=rot;if(wall==0&&gz!=nz-1||wall==2&&gz!=0||wall==1&&gx!=nx-1||wall==3&&gx!=0)return "not against a wall";
            var(_,a,b)=WallSpan(gx,gz,N(def,"w"),rot);int length=wall is 0 or 2?nx:nz;if(a<0||b>=length)return "off the wall";
            var windows=c["windows"]!.AsArray();bool overWindow=wall==2&&windows.Any(n=>a<=I(n![1])&&b>=I(n[0]));
            if(kind=="curtains"){if(!(wall==2&&windows.Any(n=>a>=I(n![0])&&b<=I(n[1]))))return "curtains go at a window";if(c["drapes"]?.GetValue<bool>()==true)return "heavy curtains hang there already";}else if(overWindow)return "that is the window";
            if(wall==(c["doorWall"]==null?2:N(c,"doorWall"))&&a<=I(c["door"]![1])&&b>=I(c["door"]![0]))return "that is the door";
            if(N(c,"eaves")>0&&(wall==2||(wall is 1 or 3&&a<N(c,"eaves"))))return "the roof is too low there";
            if(c["noHang"]!.AsArray().Any(n=>I(n![0])==wall&&a<=I(n[2])&&b>=I(n[1])))return "nothing hangs there";
            foreach(var other in others){var pd=Furniture(S(other,"kind"))!;if(S(pd,"layer")!="wall")continue;var(pw,pa,pb)=WallSpan(N(other,"gx"),N(other,"gz"),N(pd,"w"),N(other,"rot"));if(pw==wall&&a<=pb&&b>=pa)return "something hangs there already";}
            return null;
        }
        var footprint=layer=="ceiling"?(w:1,d:1):Footprint(def,rot);var cells=Cells(gx,gz,footprint.w,footprint.d).ToArray();if(cells.Any(p=>p.x<0||p.z<0||p.x>=nx||p.z>=nz))return "it does not fit there";
        if(layer=="ceiling"){
            if(c["lampCols"]!=null&&(gx<I(c["lampCols"]![0])||gx>I(c["lampCols"]![1])))return "the roof is too low there";
            if(N(c,"eaves")>0&&gz<N(c,"eaves"))return "the roof is too low there";
            if(others.Any(p=>S(Furniture(S(p,"kind"))!,"layer")=="ceiling"&&N(p,"gx")==gx&&N(p,"gz")==gz))return "a lamp hangs there already";return null;
        }
        var fixedCells=new HashSet<(int,int)>();foreach(var node in c["fixed"]!.AsArray()){var f=node!.AsObject();foreach(var cell in Cells(N(f,"gx"),N(f,"gz"),N(f,"w"),N(f,"d")))fixedCells.Add(cell);}
        if(cells.Any(fixedCells.Contains))return "the room's own furniture is there";
        HashSet<(int,int)> LayerCells(string wanted){var result=new HashSet<(int,int)>();foreach(var p in others){var pd=Furniture(S(p,"kind"))!;if(S(pd,"layer")!=wanted)continue;var(w,d)=Footprint(pd,N(p,"rot"));foreach(var cell in Cells(N(p,"gx"),N(p,"gz"),w,d))result.Add(cell);}return result;}
        if(layer=="rug"){var rugs=LayerCells("rug");return cells.Any(rugs.Contains)?"a rug lies there already":null;}
        if(N(c,"eaves")>0&&cells.Any(p=>p.z<N(c,"eaves")))return "the roof is too low there";
        var floor=LayerCells("floor");if(cells.Any(floor.Contains))return "something stands there already";
        bool doorRow(int zz)=>(c["doorWall"]==null?2:N(c,"doorWall"))==0?zz>=nz-2:zz<=1;
        if(cells.Any(p=>doorRow(p.z)&&p.x>=I(c["door"]![0])&&p.x<=I(c["door"]![1])))return "that blocks the door";
        foreach(var cell in cells)floor.Add(cell);return BedReachable(c,nx,nz,p=>fixedCells.Contains(p)||floor.Contains(p))?null:"that shuts off the bed";
    }
    private static bool BedReachable(JsonObject c,int nx,int nz,Func<(int,int),bool> blocked)
    {
        var bed=c["fixed"]!.AsArray().FirstOrDefault(p=>S(p!.AsObject(),"kind").StartsWith("bed"))?.AsObject();if(bed==null)return true;
        var beside=new HashSet<(int,int)>();var dirs=new[]{(1,0),(-1,0),(0,1),(0,-1)};foreach(var p in Cells(N(bed,"gx"),N(bed,"gz"),N(bed,"w"),N(bed,"d")))foreach(var delta in dirs)beside.Add((p.x+delta.Item1,p.z+delta.Item2));
        var seen=new HashSet<(int,int)>();var queue=new Queue<(int x,int z)>();int z0=(c["doorWall"]==null?2:N(c,"doorWall"))==0?nz-1:0;for(int x=I(c["door"]![0]);x<=I(c["door"]![1]);x++)if(!blocked((x,z0)))queue.Enqueue((x,z0));
        while(queue.Count>0){var p=queue.Dequeue();if(!seen.Add(p))continue;if(beside.Contains(p))return true;foreach(var delta in dirs){var next=(x:p.x+delta.Item1,z:p.z+delta.Item2);if(next.x<0||next.z<0||next.x>=nx||next.z>=nz||blocked(next)||seen.Contains(next))continue;queue.Enqueue(next);}}return false;
    }
    public JsonObject? FirstFit(string cls,JsonArray placed,string kind)
    {
        var(nx,nz)=Grid(cls);for(int gz=nz-1;gz>=0;gz--)for(int gx=nx-1;gx>=0;gx--)for(int rot=0;rot<4;rot++)if(CanPlace(cls,placed,kind,gx,gz,rot)==null)return new JsonObject{["gx"]=gx,["gz"]=gz,["rot"]=rot};return null;
    }
    public JsonObject Comfort(string cls,JsonArray placed)
    {
        var comfort=Class(cls)["base"]!.DeepClone().AsObject();foreach(string kind in placed.Select(p=>S(p!.AsObject(),"kind")).Where(k=>Furniture(k)!=null).Distinct()){var extra=Furniture(kind)!["comfort"]!.AsObject();foreach(string key in new[]{"warmth","light","cheer"})comfort[key]=N(comfort,key)+N(extra,key);}
        comfort["warmth"]=Math.Min(6,N(comfort,"warmth"));comfort["light"]=Math.Min(4,N(comfort,"light"));comfort["cheer"]=Math.Min(6,N(comfort,"cheer"));int rest=N(comfort,"warmth")+N(comfort,"light")+N(comfort,"cheer");comfort["rest"]=rest;comfort["restful"]=rest>=6;return comfort;
    }
    public JsonObject Night(string cls,JsonArray placed)
    {
        var comfort=Comfort(cls,placed);int restful=comfort["restful"]!.GetValue<bool>()?1:0;return new JsonObject{["warmth"]=4+N(comfort,"warmth")/2,["healthFed"]=1+restful,["healthHungry"]=restful,["food"]=N(Class(cls),"nightFood"),["restful"]=restful==1};
    }
    public static JsonArray Words(JsonObject comfort)=>new(N(comfort,"warmth")>=5?"warm":N(comfort,"warmth")>=3?"snug enough":N(comfort,"warmth")>=1?"chilly":"cold",N(comfort,"light")>=3?"bright":N(comfort,"light")>=1?"a little light":"dark",N(comfort,"cheer")>=5?"homely":N(comfort,"cheer")>=2?"lived in":"bare");
    private static int N(JsonObject obj,string key)=>NativeCoreClock.Number(obj,key);
    private static int I(JsonNode? node)=>node==null?0:int.Parse(node.ToJsonString(),System.Globalization.CultureInfo.InvariantCulture);
    private static double D(JsonObject obj,string key)=>obj[key]?.GetValue<double>()??0;
    private static string S(JsonObject obj,string key)=>obj[key]?.GetValue<string>()??"";
}
