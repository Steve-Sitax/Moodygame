using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services;

/// <summary>Original memory gossip, bounded fact-preserving wording and per-player reputation rules.</summary>
public sealed class NativeCoreRumours : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private NativeServiceContext C=>host.Context;
    private readonly Dictionary<string,JsonObject> residents=new();
    private static readonly Dictionary<string,int> Gossip=new(){{"fientje",10},{"peeters",6},{"sooi",4},{"tuur",3}};
    private static readonly Dictionary<string,string[]> NamedCircle=new(){
        ["sooi"]=new[]{"hessenatie","rijnkaai"},["peeters"]=new[]{"rijnkaai","back_lane","bakery_rijn","cobbler_lane","tavern:ankere"},
        ["tuur"]=new[]{"werf","rijnkaai","night","vismarkt"},["fientje"]=new[]{"vismarkt","rijnkaai","market:vismarkt","play:vismarkt","tavern:vliet","vleeshuis"}};
    public readonly List<Func<int,string,bool>> StillTrueChecks=new();
    public NativeCoreRumours(NativeServiceHost host)=>this.host=host;
    public void Refresh(){residents.Clear();foreach(var row in C.Rows("SELECT id,data_json FROM resident ORDER BY id"))residents[row!["id"]!.GetValue<string>()]=JsonNode.Parse(row["data_json"]!.GetValue<string>())!.AsObject();}
    private int GossipOf(string id)=>Gossip.TryGetValue(id,out int g)?g:residents.TryGetValue(id,out var person)?N(person["stats"]!.AsObject(),"gossip"):5;
    private string NameOf(string id)=>C.Scalar<string>("SELECT name FROM npc WHERE id=$p0",id)??"someone";
    private int? Household(string id)=>residents.TryGetValue(id,out var resident)?N(resident,"household"):null;
    private static bool Away(JsonObject resident)=>resident["visitor"]?["role"]?.GetValue<string>()=="stranger"&&resident["visitor"]?["here"]?.GetValue<bool>()!=true;
    public List<string> CircleOf(string id)
    {
        var result=new List<string>();
        void add(JsonObject person){string who=person["id"]!.GetValue<string>();if(who!=id&&!result.Contains(who)&&person["trade"]?.GetValue<string>()!="infant"&&!Away(person))result.Add(who);}
        if(!residents.TryGetValue(id,out var me)){
            var where=NamedCircle.GetValueOrDefault(id,Array.Empty<string>());foreach(var person in residents.Values)if(where.Contains(person["work"]!["place"]!.GetValue<string>())||id=="fientje"&&N(person["stats"]!.AsObject(),"gossip")>=8)add(person);return result;
        }
        foreach(var person in residents.Values)if(N(person,"household")==N(me,"household"))add(person);
        string work=me["work"]!["place"]!.GetValue<string>();foreach(var person in residents.Values)if(person["work"]!["place"]!.GetValue<string>()==work&&work!="home")add(person);
        foreach(var person in residents.Values){var a=person["home"]!.AsObject();var b=me["home"]!.AsObject();if(Math.Sqrt(Math.Pow(D(a,"sx")-D(b,"sx"),2)+Math.Pow(D(a,"sz")-D(b,"sz"),2))<30)add(person);}
        foreach(var pair in NamedCircle)if(pair.Value.Contains(work)&&!result.Contains(pair.Key))result.Add(pair.Key);return result;
    }
    public int SpreadGossip()
    {
        var rows=C.Rows("SELECT m.id,m.npc_id,m.text,m.weight,m.gist,m.tone,COALESCE(m.origin,m.id) AS origin,n.name FROM npc_memory m JOIN npc n ON n.id=m.npc_id WHERE m.source='seen' AND m.weight>=6 AND m.spread=0 AND m.npc_id<>'fientje'");
        int day=N(host.Clock.View(),"day");C.Atomic(()=>{foreach(var node in rows){var row=node!.AsObject();int origin=N(row,"origin");
            if(C.Scalar<long>("SELECT COUNT(*) FROM npc_memory WHERE npc_id='fientje' AND origin=$p0",origin)==0)C.Execute("INSERT INTO npc_memory(npc_id,text,source,heard_from,weight,day,spread,gist,tone,origin) VALUES('fientje',$p0,'heard',$p1,$p2,$p3,1,$p4,$p5,$p6)",S(row,"name")+" was saying: "+S(row,"text"),S(row,"npc_id"),Math.Max(1,N(row,"weight")-2),day,row["gist"]?.GetValue<string>(),N(row,"tone"),origin);
            C.Execute("UPDATE npc_memory SET spread=1 WHERE id=$p0",N(row,"id"));}});return rows.Count;
    }
    public int Spread(int maxRows=60)
    {
        var rows=C.Rows("SELECT id,npc_id,weight,gist,tone,COALESCE(origin,id) AS origin,source,told_as,about_player FROM npc_memory WHERE gist IS NOT NULL AND gist<>'' AND town_spread=0 AND weight>=3 ORDER BY weight DESC,id LIMIT $p0",maxRows);if(rows.Count==0)return 0;
        Refresh();int heard=0,day=N(host.Clock.View(),"day");
        C.Atomic(()=>{foreach(var node in rows){var row=node!.AsObject();C.Execute("UPDATE npc_memory SET town_spread=1 WHERE id=$p0",N(row,"id"));string teller=S(row,"npc_id");int gossip=GossipOf(teller);int k=teller=="fientje"?4:Gossip.ContainsKey(teller)?2:gossip<=1?0:1+gossip/4;if(k==0)continue;
            bool firstHand=S(row,"source")=="seen"&&N(row,"tone")!=0&&(Regex.IsMatch(S(row,"gist"),@"^Jef\b")||(row["about_player"]==null?1:N(row,"about_player"))!=1);int? mine=firstHand?Household(teller):null;
            var circle=CircleOf(teller).Where(id=>C.Scalar<long>("SELECT COUNT(*) FROM npc_memory WHERE npc_id=$p0 AND(origin=$p1 OR id=$p1)",id,N(row,"origin"))==0&&C.Scalar<long>("SELECT COUNT(*) FROM npc WHERE id=$p0",id)>0&&(mine==null||Household(id)!=mine)).Take(Math.Max(k*3,6)).ToList();
            int weight=N(row,"weight")-(gossip>=7?1:2);if(weight<1)continue;string whoSays=NameOf(teller);
            for(int i=0;i<k&&circle.Count>0;i++){int pick=Math.Min(circle.Count-1,(int)Math.Floor(C.Roll()*circle.Count));string who=circle[pick];circle.RemoveAt(pick);string fact=S(row,"gist"),told=Drift(S(row,"told_as",fact),fact,C.Roll);
                C.Execute("INSERT INTO npc_memory(npc_id,text,source,heard_from,weight,day,spread,gist,tone,origin,town_spread,told_as,about_player) VALUES($p0,$p1,'heard',$p2,$p3,$p4,1,$p5,$p6,$p7,0,$p8,$p9)",who,whoSays+" told me: "+told,teller,weight,day,fact,N(row,"tone"),N(row,"origin"),told==fact?null:told,row["about_player"]==null?null:N(row,"about_player"));heard++;
            }
        }});return heard;
    }
    public JsonArray Of(string npc,int playerId=1,int count=5)
    {
        var rows=C.Rows("SELECT gist,told_as,tone,weight,source,heard_from FROM npc_memory WHERE npc_id=$p0 AND gist IS NOT NULL AND gist<>'' AND COALESCE(about_player,1)=$p1 ORDER BY weight DESC,id DESC LIMIT $p2",npc,playerId,count);var result=new JsonArray();
        string mend(string text)=>Regex.Replace(text,@"\btold (.+?) a lie to get (?:her|his) (.+?) cheaper\b","lied to $1 to get $2 cheaper");
        foreach(var node in rows){var row=node!.AsObject();string fact=mend(S(row,"gist")),gist=mend(S(row,"told_as",fact));if(playerId!=1){string first=C.Scalar<string>("SELECT name FROM player WHERE id=$p0",playerId)??"Jef";string pattern=@"(?<![\p{L}\p{M}])"+Regex.Escape(first)+@"(?![\p{L}\p{M}])";fact=Regex.Replace(fact,pattern,"Jef");gist=Regex.Replace(gist,pattern,"Jef");}
            result.Add(new JsonObject{["gist"]=gist,["fact"]=fact,["tone"]=row["tone"]!.DeepClone(),["weight"]=row["weight"]!.DeepClone(),["source"]=row["source"]!.DeepClone(),["from"]=row["heard_from"]==null?null:NameOf(S(row,"heard_from"))});}
        return result;
    }
    public double ReputationWith(string npc,int playerId=1)
    {
        var rows=Of(npc,playerId,8);double weight=rows.Sum(r=>D(r!.AsObject(),"weight"));return weight==0?0:Math.Clamp(rows.Sum(r=>D(r!.AsObject(),"tone")*D(r.AsObject(),"weight"))/weight,-2,2);
    }
    public bool StillTrue(int playerId,string fact)=>StillTrueChecks.All(f=>f(playerId,fact));
    public JsonObject Relationship(string npc,int playerId=1)
    {
        C.Execute("INSERT OR IGNORE INTO npc_relationship(npc_id,player_id) SELECT id,$p0 FROM npc WHERE id=$p1",playerId,npc);
        return C.One("SELECT trust,affection,respect,fear,times_met,last_seen_day,last_place,view_of_player FROM npc_relationship WHERE npc_id=$p0 AND player_id=$p1",npc,playerId)??new JsonObject();
    }
    public int ApplyTrust(string npc,int playerId,int delta,int soFar)
    {
        int clamped=Math.Clamp(delta,-2-soFar,2-soFar),change=Math.Clamp(clamped,-2,2);if(change!=0)C.Execute("UPDATE npc_relationship SET trust=MAX(-5,MIN(10,trust+$p0)) WHERE npc_id=$p1 AND player_id=$p2",change,npc,playerId);return change;
    }
    public JsonArray Memories(string npc,int count=8)=>C.Rows("SELECT id,text,source,heard_from,weight,day FROM npc_memory WHERE npc_id=$p0 ORDER BY weight DESC,id DESC LIMIT $p1",npc,count);
    public static string TrustText(int trust)=>trust>=0?$"{trust} of 10":$"{trust}, on a scale from -5 to 10: {(trust<=-3?"can't stand Jef":"dislikes Jef")}";
    public static string OwnVoice(string text,IEnumerable<string> names)
    {
        foreach(string name in names.Where(n=>n.Length>0).OrderByDescending(n=>n.Length)){string e=Regex.Escape(name);text=Regex.Replace(text,@"\b"+e+@"'s\b","my");text=Regex.Replace(text,@"\b"+e+@" (saw|was|is|has|had|said|says|thinks|knows)\b","I $1");text=Regex.Replace(text,@"(^|[.!?]\s+)"+e+@"\b","$1I");text=Regex.Replace(text,@"\b(from|to|at|with|of|by|for|off|on|behind|near|past) "+e+@"\b","$1 me");text=Regex.Replace(text,@"\b"+e+@"\b","me");}
        return Regex.Replace(Regex.Replace(Regex.Replace(Regex.Replace(Regex.Replace(text,@"\bI is\b","I am"),@"\bI has\b","I have"),@"\bI says\b","I say"),@"\bI thinks\b","I think"),@"\bI knows\b","I know");
    }
    public static string ToYou(string gist)
    {
        string text=Regex.Replace(gist.Trim(),@"\.$","");if(!Regex.IsMatch(text,@"^Jef\b"))return text;
        text=Regex.Replace(text,@"\bJef's\b","your");text=Regex.Replace(text,@"\bJef\b","you");foreach(var pair in new[]{("was","were"),("is","are"),("has","have"),("does","do")})text=Regex.Replace(text,@"^you "+pair.Item1+@"\b","you "+pair.Item2);
        text=Pronouns(text);return Regex.Replace(text,@"^you (\w+)\b",m=>"you "+PlainVerb(m.Groups[1].Value));
    }
    public static string? WhoYou(string gist)
    {
        string text=Regex.Replace(gist.Trim(),@"\.$","");if(!Regex.IsMatch(text,@"^Jef\s"))return null;text=Regex.Replace(text,@"^Jef\s+","");text=Regex.Replace(text,@"\bJef's\b","your");text=Regex.Replace(text,@"\bJef\b","you");return Pronouns(text) is {Length:>0} result?result:null;
    }
    private static string Pronouns(string text)=>Regex.Replace(Regex.Replace(Regex.Replace(text,@"\bhimself\b","yourself"),@"\bhis\b","your"),@"\bhim\b","you");
    private static string PlainVerb(string verb)
    {
        string low=verb.ToLowerInvariant();if(new[]{"was","is","has","does","always","perhaps","across","towards","this","thus","yes","less","unless","as"}.Contains(low)||!Regex.IsMatch(low,@"[a-z]s$")||Regex.IsMatch(low,@"(ss|us|is|ous)$"))return verb;
        return Regex.IsMatch(low,@"[^aeiou]ies$")?verb[..^3]+"y":Regex.IsMatch(low,@"(sh|ch|x|z|o)es$")?verb[..^2]:verb[..^1];
    }
    private static readonly string[] FactGroups={@"\b(stole|steal\w*|thie[fv]\w*|robb?\w*|pinch\w*|lifted|made off|pickpocket\w*|pocket)\b",@"\b(beat\w*|knock\w*|hit|struck|strike|punch\w*|shov\w*|fight\w*|fought|brawl\w*|scuffl\w*|kick\w*|blows?)\b",@"\b(police|agent|arrest\w*|cell|fined?|jail|gaol|prison|constable|law)\b",@"\b(drunk\w*|jenever|gin|beer|drink\w*|tipsy|sot)\b",@"\b(lie|lied|lies|liar|cheat\w*|swindl\w*|trick\w*|fraud|crook\w*)\b"};
    private const string Violence=@"\b(kill(s|ed|er|ing)?|murder\w*|stab\w*|shoot\w*|shot dead|guns?|gunfire|pistols?|revolvers?|rifles?|muskets?|knife|knives|daggers?|swords?|blades?|cudgels?|clubbed|clubbing|bludgeon\w*|strangl\w*|throttl\w*|blood\w*|wound\w*|injur\w*|beat (him|her|them) up|beaten up|beaten to|riot\w*|hanged|corpse|weapons?|dead body|bodies)\b";
    public static bool WithinFact(string fact,string told)
    {
        told=told.Trim();if(told.Length<8||told.Length>160||!Regex.IsMatch(told,@"^Jef\b"))return false;
        bool has(string s,string pattern)=>Regex.IsMatch(s,pattern,RegexOptions.IgnoreCase|RegexOptions.CultureInvariant);
        if(has(told,Violence)&&!has(fact,Violence))return false;foreach(string group in FactGroups)if(has(told,group)&&!has(fact,group))return false;
        if(has(told,@"\b(not|never|no)\b|n't\b")!=has(fact,@"\b(not|never|no)\b|n't\b"))return false;
        var words=Regex.Matches(fact.ToLowerInvariant(),"[a-z']+").Select(m=>m.Value).ToHashSet();foreach(Match m in Regex.Matches(told,@"\b[A-Z][a-z'-]+"))if(m.Value is not ("Jef" or "I" or "God")&&!words.Contains(m.Value.ToLowerInvariant()))return false;
        foreach(Match m in Regex.Matches(told,@"\d+"))if(!fact.Contains(m.Value))return false;foreach(Match m in Regex.Matches(told,@"\b(one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|hundred|thousand)\b",RegexOptions.IgnoreCase))if(!words.Contains(m.Value.ToLowerInvariant()))return false;return true;
    }
    public static string Drift(string told,string fact,Func<double> random)
    {
        if(random()>=.35)return told;string text=Regex.Replace(told,@"\.$","");
        var swaps=new (string pattern,string[] words)[]{(@"\bstole\b",new[]{"pinched","lifted","made off with"}),(@"\bwas rude to\b",new[]{"was short with","spoke rough to","had sharp words for"}),(@"\bhelped\b",new[]{"lent a hand to","gave a hand to"}),(@"\bcarried\b",new[]{"hauled","lugged"}),(@"\bgave\b",new[]{"handed","passed"}),(@"\btalked strange\b",new[]{"talked queer","talked nonsense"}),(@"\basked after\b",new[]{"asked about","was asking after"})};
        var swap=swaps.FirstOrDefault(s=>Regex.IsMatch(text,s.pattern));string result=text;string[] hedges={", or so they say",", they say",", if you believe it",", so I heard"};
        if(swap.words!=null&&random()<.6)result=new Regex(swap.pattern).Replace(text,swap.words[Math.Min(swap.words.Length-1,(int)Math.Floor(random()*swap.words.Length))],1);
        else if(!hedges.Any(text.EndsWith))result+=hedges[Math.Min(hedges.Length-1,(int)Math.Floor(random()*hedges.Length))];return WithinFact(fact,result)?result:told;
    }
    public void Register(NativeServiceHost service)
    {
        Refresh();service.NewGame+=Refresh;service.Loaded+=Refresh;service.RumourRound=_=>Spread();service.MemoryHook=(_,npc,weight)=>{if(weight>=6&&npc!="fientje")SpreadGossip();};
    }
    private static int N(JsonObject obj,string key)=>NativeCoreClock.Number(obj,key);
    private static double D(JsonObject obj,string key)=>obj[key]?.GetValue<double>()??0;
    private static string S(JsonObject obj,string key,string fallback="")=>obj[key]?.GetValue<string>()??fallback;
}
