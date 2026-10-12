using System;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services;

/// <summary>Pure playable job planner, including native load/count/pay rules. Authored spot distances can be replaced by the native navigation map.</summary>
public sealed class NativeCoreJobPlan
{
    private readonly NativeServiceHost host;
    public JsonObject Data {get;}
    public Func<string,string,double?>? DistanceResolver;
    public NativeCoreJobPlan(NativeServiceHost host){this.host=host;Data=JsonNode.Parse(File.ReadAllText(Path.Combine(host.Context.Options.DataDirectory,"native-night.json")))!.AsObject();}
    private static string S(JsonNode? n,string key,string fallback="")=>n?[key]?.GetValue<string>()??fallback;
    private static double V(JsonNode? n){if(n is not JsonValue v)return 0;if(v.TryGetValue<double>(out var d))return d;if(v.TryGetValue<int>(out var i))return i;if(v.TryGetValue<long>(out var l))return l;return 0;}
    private static int R(double n)=>(int)Math.Floor(n+.5);
    private static int R5(double n)=>R(n/5)*5;
    private static int Clamp(double value,(int Low,int High) band)=>Math.Clamp(R5(value),band.Low,band.High);
    private static bool B(JsonNode? n,string key)=>n?[key]?.GetValue<bool>()==true;
    public double Distance(string a,string b){var p=Data["spots"]?[a];var q=Data["spots"]?[b];return p==null||q==null?0:Math.Sqrt(Math.Pow(V(p["x"])-V(q["x"]),2)+Math.Pow(V(p["z"])-V(q["z"]),2));}
    public double WalkDistance(string a,string b)=>a==b?0:DistanceResolver?.Invoke(a,b)??(Data["distances"]?[a+">"+b] is {} value?V(value):Distance(a,b)*1.1);
    public static (int Low,int High) CarryBand((int Low,int High) band,bool cart,bool one=false)=>cart?(R5(band.Low+(band.High-band.Low)*.5),band.High):(band.Low,R5(band.Low+(band.High-band.Low)*(one?.2:.4)));
    public static int HandMinutes(string goods,int count,double way,bool heavy=false){double[] paces={.62,.6,.55,.66,.75,.6,.95};int i=Array.IndexOf(new[]{"crates","sacks","barrels","hides","rope","chests","parcel"},goods);double pace=i<0?.6:paces[i],seconds=Math.Max(0,count-1)*way/1.55;for(int n=0;n<count;n++)seconds+=way/(1.55*(heavy&&n==0?.4:pace))+3;return(int)Math.Ceiling(seconds*.5);}
    private static double PushSpeed(double kg)=>R((.85-.3*Math.Clamp(kg/260,0,1))*100)/100.0;
    public int CartMinutes(string goods,int count,double way,bool heavy=false,bool back=true){double kg=(Data["load"]?[goods] is {} l?V(l["kg"]):45)*(count+(heavy?1:0));return(int)Math.Ceiling((count*10+way/(1.55*PushSpeed(Math.Min(kg,260)))+5+(back?way/(1.55*PushSpeed(0)):0))*.5);}
    public int CartCap(string goods,bool heavy=false){var load=Data["load"]?[goods];if(load==null)return 0;int count=0;double size=0,kg=0;while(count<8){double addKg=V(load["kg"])*(heavy&&count==0?2:1);if(size+V(load["size"])>6+1e-9||kg+addKg>260)break;size=Math.Floor((size+V(load["size"]))*100+.5)/100;kg=R(kg+addKg);count++;}return count;}
    public JsonObject? TaskFor(JsonObject proposal)
    {
        var j=proposal.DeepClone().AsObject();string employer=S(j,"employer");var e=host.Context.Rules["employers"]?[employer];if(e==null)return null;var area=e["area"]!.AsArray().Select(n=>n!.GetValue<string>()).ToArray();string door=S(e,"door"),kind=S(j,"task_type"),twist=S(j,"twist"),from=S(j,"from"),to=S(j,"to"),goods=S(j,"goods");
        string[] allowed=kind=="carry"?new[]{"none","broken_goods","stranger_offer","foreman_watches","thick_fog","heavy_load"}:kind=="watch"?new[]{"none","thief","bribe","foreman_watches","thick_fog"}:kind=="deliver"?new[]{"none","stranger_offer","thick_fog"}:new[]{"none"};if(!allowed.Contains(twist))twist="none";
        string own(string s,string other)=>area.Contains(s)?s:area.FirstOrDefault(a=>a!=other&&a!=door)??door;
        // Both replacements use the source proposal, as the original object literal does.
        string sourceFrom=from;from=own(from,to);to=own(to,sourceFrom);
        if(B(e,"town")){if(kind!="watch"&&from==to)to=from==door?area.FirstOrDefault(a=>a!=door)??door:door;if(kind=="carry"&&Distance(from,to)>70)to=area.Where(a=>a!=from).OrderBy(a=>Distance(from,a)).FirstOrDefault()??to;}
        if(kind=="carry"){
            if(from==to)to=from==door?"hessenatie_door":door;if(from==to)to="crane_foot";if(goods=="parcel")goods="crates";bool heavy=twist=="heavy_load",cart=B(j,"cart");int count=0;string[] noCart={"pier_head","ship_gangway","vismarkt_stalls","markt_stalls"};bool cartOk(string a)=>!noCart.Contains(a);bool startOk(string a)=>cartOk(a)&&a is not("katoen_door" or "entrepot_quay");string nearest(Func<string,bool> fits,Func<string,bool>? ok=null)=>area.Where(a=>a!=from&&(ok?.Invoke(a)??true)).OrderByDescending(fits).ThenBy(a=>Distance(from,a)).FirstOrDefault()??to;
            if(cart){if(!startOk(from))from=area.FirstOrDefault(a=>startOk(a)&&a!=to)??from;if(!cartOk(to)||to==from)to=area.FirstOrDefault(a=>cartOk(a)&&a!=from)??to;if(heavy&&CartCap(goods,true)<3&&CartCap(goods)>=3){twist="none";heavy=false;}int cap=Math.Min(8,CartCap(goods,heavy));if(!startOk(from)||!cartOk(to)||from==to||cap<3)cart=false;else{count=Math.Clamp(R(j["items"]==null?4:V(j["items"])),3,cap);while(count>3&&CartMinutes(goods,count,WalkDistance(from,to),heavy)>120)count--;if(CartMinutes(goods,count,WalkDistance(from,to),heavy)>120)to=nearest(s=>CartMinutes(goods,count,WalkDistance(from,s),heavy)<=120,cartOk);}}
            if(!cart){count=Math.Clamp(R(j["items"]==null?2:V(j["items"])),1,2);if(HandMinutes(goods,count,WalkDistance(from,to),heavy)>60)count=1;if(HandMinutes(goods,1,WalkDistance(from,to),heavy)>60)to=nearest(s=>HandMinutes(goods,1,WalkDistance(from,s),heavy)<=60);}
            var task=new JsonObject{["kind"]="carry",["goods"]=goods,["count"]=count,["from"]=from,["to"]=to,["twist"]=twist,["limit_s"]=!B(j,"urgent")?null:cart?R(CartMinutes(goods,count,WalkDistance(from,to),heavy)*2*1.5+20):R(count*(Distance(from,to)/.9+Distance(from,to)/1.4+4)*1.5+20)};if(cart)task["cart"]=true;return task;
        }
        if(kind=="watch")return new JsonObject{["kind"]="watch",["goods"]=goods=="parcel"?"barrels":goods,["post"]=to,["duration_s"]=V(j["pay_c"])>=110?120:90,["twist"]=twist};
        if(kind=="deliver"){from=door;if(to==from)to=B(e,"town")?area.FirstOrDefault(a=>a!=from)??to:"ship_gangway";if(to==from)to="east_carts";return new JsonObject{["kind"]="deliver",["goods"]=goods,["from"]=from,["to"]=to,["recipient"]=S(j,"recipient").Length>0?S(j,"recipient"):"the mate on watch",["twist"]=twist,["limit_s"]=B(j,"urgent")?R(Distance(from,to)/.95*1.6+20):null};}return null;
    }
    public JsonObject FitCarry(JsonObject proposal,(int Low,int High) band)
    {
        var j=proposal.DeepClone().AsObject();if(S(j,"task_type")!="carry")return j;bool want=B(j,"cart");var b=CarryBand(band,want);int pay=Clamp(V(j["pay_c"]),b);double pos=(pay-b.Low)/(double)Math.Max(1,b.High-b.Low);int items=j["items"]!=null?R(V(j["items"])):want?3+R(pos*5):pos>=.5?2:1;var n=j.DeepClone().AsObject();n["cart"]=want;n["items"]=items;n["pay_c"]=pay;var task=TaskFor(n);if(task==null||S(task,"kind")!="carry"){j["cart"]=false;j["pay_c"]=pay;return j;}bool cart=B(task,"cart");int count=(int)V(task["count"]);j["title"]=SayCount(S(j,"title"),count);j["pitch"]=SayCount(S(j,"pitch"),count);j["cart"]=cart;j["items"]=count;j["pay_c"]=Clamp(V(j["pay_c"]),CarryBand(band,cart,!cart&&count==1));return j;
    }
    public static string SayCount(string text,int count)
    {
        string[] words={"","one","two","three","four","five","six","seven","eight","nine","ten"};string word=count<words.Length?words[count]:count.ToString();
        bool sentence(string whole,int at)=>at==0||Regex.IsMatch(whole[..at],@"[.!?]\s*$");string cap(string w,string number,bool start)=>start||char.IsUpper(number[0])?char.ToUpperInvariant(w[0])+w[1..]:w;
        if(count>=2){string before=text;text=Regex.Replace(text,@"\b(a|an|one)(\s+(?:[a-z'-]+\s+){0,2}?)(crate|sack|barrel|cask|keg|bale|hide|bundle|coil|chest|box|bag|tub|hogshead|parcel|case|basket|roll)\b(?!-)",m=>{string mid=m.Groups[2].Value,noun=m.Groups[3].Value;if(Regex.IsMatch(mid.Trim()+" ",@"^(of|and|or|the|to|from|for|with|by|at|in|on)\s",RegexOptions.IgnoreCase))return m.Value;return cap(word,m.Groups[1].Value,sentence(before,m.Index))+mid+noun+(Regex.IsMatch(noun,@"(x|s|sh|ch)$",RegexOptions.IgnoreCase)?"es":"s");},RegexOptions.IgnoreCase);}
        string snapshot=text;return Regex.Replace(text,@"\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)(\s+(?:[a-z'-]+\s+){0,2}?)(crates|sacks|barrels|casks|kegs|bales|hides|bundles|coils|chests|boxes|bags|tubs|hogsheads|loads|pieces|parcels|cases|baskets|rolls)\b",m=>{string number=m.Groups[1].Value,mid=m.Groups[2].Value,noun=m.Groups[3].Value;bool digit=int.TryParse(number,out int n);if(!digit)n=Array.IndexOf(words,number.ToLowerInvariant());if(n<=0||n==count)return m.Value;if(count==1){string one=noun.ToLowerInvariant()=="boxes"?noun[..^2]:noun.ToLowerInvariant()=="hides"?"hide":noun[..^1];string next=mid.Trim().Length==0?one:mid.Trim();return cap(Regex.IsMatch(next,@"^[aeiou]",RegexOptions.IgnoreCase)?"an":"a",number,sentence(snapshot,m.Index))+mid+one;}return(digit?count.ToString():cap(word,number,sentence(snapshot,m.Index)))+mid+noun;},RegexOptions.IgnoreCase);
    }
}
