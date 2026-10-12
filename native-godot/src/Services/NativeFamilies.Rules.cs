using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
namespace Scheldemist.Native.Services;
public sealed partial class NativeFamilies
{
    public static readonly string[] Reactions={"none","talk_calm","talk_angry","demand_apology","demand_payment","warn_others","call_police","knock_down","mug","thank","invite_supper","gift"};
    public static string KinWord(JsonObject listener,JsonObject teller)
    {
        bool Spouse(JsonObject p)=>S(p,"family_role")is "wife"or"husband"or"head";bool Child(JsonObject p)=>S(p,"family_role")is "son"or"daughter";bool female=S(teller,"sex")=="f";
        if(Spouse(listener)&&Spouse(teller)&&S(listener,"sex")!=S(teller,"sex")&&N(listener,"age")>=16&&N(teller,"age")>=16)return "My "+(female?"wife ":"husband ")+S(teller,"first");
        if(Child(teller)&&!Child(listener))return "My "+(female?"daughter ":"son ")+S(teller,"first");if(Child(listener)&&!Child(teller))return "My "+(female?"mother":"father");if(Child(listener)&&Child(teller))return "My "+(female?"sister ":"brother ")+S(teller,"first");return S(teller,"family_role")=="lodger"?S(teller,"first")+", who lodges with us,":S(teller,"first")+" at home";
    }
    public int Grudge(int player,JsonObject person,int tone)
    {
        int trust=C.Scalar<int>("SELECT trust FROM npc_relationship WHERE npc_id=$p0 AND player_id=$p1",S(person,"id"),player),bad=C.Scalar<int>("SELECT COUNT(*) FROM npc_memory WHERE npc_id=$p0 AND tone<0 AND COALESCE(about_player,1)=$p1",S(person,"id"),player);return(int)Math.Clamp(-tone*2+N(person["stats"],"temper")-5+(trust<=1?1:0)+Math.Min(3,bad),0,10);
    }
    public JsonArray Allowed(int player,JsonObject person,JsonObject news)
    {
        var list=new List<(string Reaction,double Weight)>{("none",1)};if(N(person,"age")<16||S(person,"trade")=="police"||Away(person))return new(new JsonObject{["reaction"]="none",["weight"]=1});var stats=person["stats"];bool day=Hour>=7&&Hour<21;double tone=N(news,"tone");
        void Add(string kind,double weight)=>list.Add((kind,weight*(kind=="warn_others"||kind=="call_police"?1:2.5)));bool loss=Regex.IsMatch(S(news,"gist"),@"\b(stole|steal|took|lifted|pinched|broke|smashed|spoiled|cheat|owe|robbed)\w*",RegexOptions.IgnoreCase);
        if(tone<0){int grudge=Grudge(player,person,(int)tone);if(N(stats,"gossip")>=4)Add("warn_others",.6+N(stats,"gossip")/10);if(day&&(N(stats,"warmth")>=4||N(stats,"temper")<=5))Add("talk_calm",.6+N(stats,"warmth")/10);if(day&&N(stats,"temper")>=5)Add("talk_angry",.4+N(stats,"temper")/10);if(day)Add("demand_apology",.5+(N(stats,"piety")+N(stats,"courage"))/20);if(day&&loss)Add("demand_payment",.4+N(stats,"greed")/10);
            var home=new JsonObject{["x"]=N(person["home"],"sx"),["z"]=N(person["home"],"sz")};if(day&&N(person,"age")>=18&&(N(stats,"honesty")>=5||N(stats,"courage")<=4)&&(tone<=-2||loss)&&Agent(home)!=null)Add("call_police",.3+N(stats,"honesty")/20);
            bool rough=S(person,"sex")=="m"&&N(person,"age")>=18&&N(person,"age")<=60&&N(stats,"temper")>=7&&N(stats,"courage")>=5&&grudge>=5&&new[]{"docker","natie","porter","carter","boatman","sailor","thief"}.Contains(S(person,"trade"));if(rough&&Hour>=7&&Hour<23){Add("knock_down",.2+(N(stats,"temper")-6)/10);if(N(stats,"honesty")<=4&&(N(stats,"greed")>=5||S(person,"trade")=="thief"))Add("mug",.15+(N(stats,"greed")-4)/10);}
        }else if(tone>0){if(N(stats,"gossip")>=4)Add("warn_others",.4+N(stats,"gossip")/10);if(day)Add("thank",.6+N(stats,"warmth")/10);int supper=C.PlayerState(player,"supper_day")is {} own?(int)NativeGoods.Number(own):player==1?(int)N(C.World("families"),"supperDay"):0;if(day&&N(person,"age")>=20&&N(stats,"warmth")>=6&&supper!=Day&&Hour>=11)Add("invite_supper",.4+N(stats,"warmth")/20);if(day&&N(stats,"warmth")>=5&&N(stats,"greed")<=6&&host.Trade.Wares(S(person,"id")).Count>0)Add("gift",.4+N(stats,"warmth")/20);}
        return new JsonArray(list.OrderByDescending(p=>p.Weight).Select(p=>(JsonNode)new JsonObject{["reaction"]=p.Reaction,["weight"]=p.Weight}).ToArray());
    }
    public int ClampAmount(int player,string reaction,int proposed)
    {
        int money=C.Scalar<int>("SELECT money_c FROM player WHERE id=$p0",player);int Round(int n)=>(int)Math.Floor(n/5.0+.5)*5;return reaction switch{"demand_payment"=>Math.Max(5,Math.Min(30,Round(proposed>0?proposed:15))),"mug"=>Math.Min(money,Math.Min(40,Math.Max(5,(int)Math.Floor(money*.4/5+.5)*5))),"knock_down"=>Math.Min(money,10),_=>0};
    }
    public JsonObject Decide(int player,JsonObject person,JsonObject news,JsonObject? proposal=null,Func<double>? roll=null)
    {
        var allowed=Allowed(player,person,news);string want=S(proposal,"reaction"),refused="";bool valid=proposal!=null&&Reactions.Contains(want)&&proposal["amount_c"]is JsonValue n&&n.TryGetValue<int>(out int amount)&&amount>=0&&amount<=100000;
        if(valid&&allowed.Any(a=>S(a,"reaction")==want))return new(){["reaction"]=want,["amount_c"]=ClampAmount(player,want,(int)N(proposal,"amount_c")),["source"]="claude",["refused"]=null};if(proposal!=null)refused=valid?want+" not allowed by the stats":"not in the list";double ticket=(roll??C.Roll)()*allowed.Sum(a=>N(a,"weight"));string pick=S(allowed[0],"reaction");foreach(var a in allowed){ticket-=N(a,"weight");if(ticket<=0){pick=S(a,"reaction");break;}}
        return new(){["reaction"]=pick,["amount_c"]=ClampAmount(player,pick,0),["source"]="engine",["refused"]=refused==""?null:refused};
    }
    public static string Stance(string words)
    {
        string t=words.ToLowerInvariant();if(Regex.IsMatch(t,@"\b(sorry|apolog|forgive|my fault|i was wrong|meant no harm)\b"))return "apologetic";if(Regex.IsMatch(t,@"\b(please|beg|mercy|don't hurt|let me go)\b"))return "pleading";if(Regex.IsMatch(t,@"\b(fool|idiot|swine|dog|bastard|coward|pig|rat)\b"))return "insulting";return Regex.IsMatch(t,@"\b(make me|try it|come on then|go on then|i'm not afraid|so what)\b")?"defiant":"calm";
    }
    public static double TalkDownChance(JsonObject person,string stance,int grudge)
    {
        double basis=stance switch{"apologetic"=>.6,"calm"=>.5,"pleading"=>.45,"defiant"=>.15,"insulting"=>.03,_=>.08};return Math.Clamp(basis+(N(person["stats"],"warmth")-5)*.03-(N(person["stats"],"temper")-5)*.04-(grudge-5)*.02,.03,.85);
    }
}
