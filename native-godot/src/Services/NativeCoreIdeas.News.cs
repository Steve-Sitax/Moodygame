using System;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services;

public sealed partial class NativeCoreIdeas
{
    public JsonObject? NewsRow(int day)=>C.One("SELECT * FROM news_abroad WHERE day=$p0",day);
    public JsonArray NewsToday()=>C.Rows("SELECT * FROM news_abroad WHERE day<=$p0 AND until_day>=$p0 ORDER BY day",Day);
    public string NewsTalkLine(string trade)=>A(data["newsTrades"]).Any(n=>n?.GetValue<string>()==trade)&&NewsToday() is {Count:>0} rows
        ?"\nNEWS FROM ABROAD (in the paper, and you know it from your trade; mention it if talk turns to prices or the ships): "+string.Join("; ",rows.Select(n=>S(n,"talk")))+".":"";
    public int? LowestPrice(string item)
    {
        int? best=null;var sellers=C.Rules["wares"]?.AsObject().Select(e=>e.Key)??Enumerable.Empty<string>();
        sellers=sellers.Concat(Residents().Where(r=>r["work"]?["stall"]!=null||S(r["work"],"shop")!=""||S(r,"trade") is "publican" or "chandler").Select(r=>S(r,"id")));
        foreach(string id in sellers)foreach(var ware in host.Trade.Wares(id))if(S(ware,"kind")==item){int price=(int)N(ware,"price_c");best=best==null?price:Math.Min(best.Value,price);}return best;
    }
    public JsonObject? RollNews(int day,JsonObject? ship=null,Func<double>? random=null,string? force=null)
    {
        if(NewsRow(day)!=null)return null;double seed=N(Town,"seed",1873);if(seed==0)seed=1873;var rng=random??Random(unchecked((uint)(seed*7+day*4099)));
        if(force==null&&(day<2||rng()>.55))return null;string? yesterday=C.Scalar<string>("SELECT key FROM news_abroad WHERE day=$p0",day-1);
        var pool=A(data["news"]).Where(n=>force!=null?S(n,"key")==force:S(n,"key")!=yesterday).ToArray();if(pool.Length==0)return null;int selected=(int)Math.Floor(rng()*pool.Length);if(selected<0||selected>=pool.Length)return null;var def=pool[selected]!;
        var span=A(def["days"]);int days=(int)Math.Clamp(V(span[0])+Math.Floor(rng()*(V(span[1])-V(span[0])+1)),1,3);var before=O(def["prices"]).ToDictionary(e=>e.Key,e=>LowestPrice(e.Key));var prices=new JsonObject();
        foreach(var pair in O(def["prices"])){var range=A(pair.Value);int pct=Round(V(range[0])+rng()*(V(range[1])-V(range[0])));pct=(pct<0?-1:1)*Math.Clamp(Math.Abs(pct),10,30);int? original=before[pair.Key];if(original==null)continue;int after=Math.Max(1,Round(original.Value*(1+pct/100.0)));if(after==original.Value)continue;prices[pair.Key]=new JsonObject{["factor"]=1+pct/100.0,["pct"]=pct,["before_c"]=original,["after_c"]=after};}
        if(prices.Count==0)return null;int until=day+days-1;string moves=string.Join(", ",prices.Select(p=>Regex.Replace(S(host.Trade.Item(p.Key),"name",p.Key),@"^(a|an) (pot of |loaf of |nip of |salt |smoked )?","")+" "+(N(p.Value,"pct")>0?"up":"down")+" from "+N(p.Value,"before_c")+" to "+N(p.Value,"after_c")+" centimes"));
        string lasting=days==1?"for today":$"for {days} days",by=ship==null?"The mail brought "+S(def,"from"):$"The {S(ship,"type")} {S(ship,"name")} brought {S(def,"from")}",text=$"{by}: {S(def,"what")}. In the town, {moves}, {lasting}.",talk=$"{S(def,"talk")} ({moves}, {lasting})";
        C.Execute("INSERT INTO news_abroad(day,key,text,talk,prices_json,until_day) VALUES($p0,$p1,$p2,$p3,$p4,$p5)",day,S(def,"key"),text,talk,prices.ToJsonString(),until);
        Event("news_abroad",text,6,details:new JsonObject{["key"]=S(def,"key"),["prices"]=prices.DeepClone(),["until_day"]=until});C.Execute("INSERT INTO world_fact(text,weight,day,tags) VALUES($p0,5,$p1,'news_abroad')","News from abroad: "+talk+".",day);return NewsRow(day);
    }
    public double WantedFactor(int who)=>C.Scalar<int>("SELECT COUNT(*) FROM poster WHERE status='up' AND names_jef=$p0",who)>0?1.35:1;
}
