using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services;

/// <summary>The authoritative native goods store: ownership, stacking, job loads, dock piles and cart transfers.</summary>
public sealed class NativeGoods : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private NativeServiceContext C => host.Context;
    public JsonObject Data { get; }
    public Func<string, JsonObject, bool>? NpcMayLift;
    public Func<string, bool>? NpcHasErrand;
    public Func<int,string,bool>? NpcMayReport;
    public Func<string, string?>? NpcCarryBack;
    public Action<string>? HauledIn;
    public Func<string, string, bool?>? CartContains;
    private static readonly HashSet<string> Kinds = new(StringComparer.Ordinal) { "crates", "sacks", "barrels", "hides", "rope", "parcel", "chests" };
    private static readonly HashSet<string> Ops = new(StringComparer.Ordinal) { "lift", "put", "drop", "take", "job", "lower", "handover", "end", "restore", "npc_lift", "npc_put", "npc_drop", "haul_in", "haul_deliver", "crane_put" };

    public NativeGoods(NativeServiceHost host)
    {
        this.host = host;
        Data = JsonNode.Parse(File.ReadAllText(Path.Combine(C.Options.DataDirectory, "native-goods.json")))!.AsObject();
        if (Data["initial"] is not JsonArray { Count: > 0 } || N(Data, "version") != 1)
            throw new InvalidDataException("Recover the complete authored native goods data before starting the game.");
    }

    internal static double Number(JsonNode? value, double fallback = 0) => value != null && double.TryParse(value.ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture, out double n) && double.IsFinite(n) ? n : fallback;
    internal static double N(JsonNode? value, string key, double fallback = 0) => Number(value?[key], fallback);
    internal static string S(JsonNode? value, string key, string fallback = "") => value?[key] is JsonValue v && v.TryGetValue<string>(out var s) ? s : fallback;
    internal static bool B(JsonNode? value, string key) => value?[key] is JsonValue v && v.TryGetValue<bool>(out bool b) && b;
    internal static double R3(double value) => Math.Floor(value * 1000 + .5) / 1000;
    internal static double Distance(double ax, double az, double bx, double bz) => Math.Sqrt((ax-bx)*(ax-bx)+(az-bz)*(az-bz));
    internal static JsonArray A(JsonNode? value) => value as JsonArray ?? new JsonArray();
    private static JsonArray Copies(IEnumerable<JsonObject> items) => new(items.Select(i => (JsonNode)i.DeepClone()).ToArray());
    private static JsonArray Strings(IEnumerable<string> items) => new(items.Select(i => (JsonNode)JsonValue.Create(i)!).ToArray());
    private static List<JsonObject> Items(JsonObject state) => state["items"]!.AsArray().Select(n => n!.AsObject()).ToList();
    private static bool Held(JsonObject item, string holder, string value) => item["by"] is JsonObject by && S(by, holder) == value;
    private static bool Held(JsonObject item, int player) => item["by"] is JsonObject by && N(by, "p", -1) == player;
    private static bool Above(JsonObject state, string id) => Items(state).Any(i => i["by"] == null && A(i["on"]).Any(n => n?.GetValue<string>() == id));
    private static bool Finite(JsonNode? x, JsonNode? z) => x != null && z != null && double.IsFinite(Number(x, double.NaN)) && double.IsFinite(Number(z, double.NaN)) && Math.Abs(Number(x)) < 5000 && Math.Abs(Number(z)) < 5000;
    private static void Refuse(string message) => throw new NativeServiceException(message, 409);

    private JsonObject State() => C.World("native_goods") as JsonObject ?? Fresh();
    private JsonObject Fresh() => new() { ["v"] = 0, ["items"] = Data["initial"]!.DeepClone(), ["made"] = new JsonArray(), ["jobN"] = new JsonObject(), ["spawnN"] = 0,
        ["lowered"] = new JsonArray(), ["from"] = new JsonObject(), ["reporter"] = new JsonObject(), ["orphan"] = new JsonObject(), ["offSince"] = new JsonObject(), ["runs"] = new JsonObject(), ["craneAt"] = new JsonObject(), ["supplyAt"] = new JsonObject(), ["carryAt"] = new JsonObject(), ["lastDawn"] = -1 };
    public JsonArray List() => State()["items"]!.DeepClone().AsArray();
    public JsonObject? Get(string id) => Items(State()).FirstOrDefault(i => S(i,"id") == id)?.DeepClone().AsObject();
    public JsonObject? CarriedBy(int player) => Items(State()).FirstOrDefault(i => Held(i,player))?.DeepClone().AsObject();
    public JsonArray PlayerLeft(int player,JsonObject? at=null)
    {
        var state=State();var changed=new List<JsonObject>();
        foreach(var item in Items(state).Where(i=>Held(i,player))) { var back=A(state["from"]?[S(item,"id")]);double x=at==null?(back.Count>=2?Number(back[0],double.NaN):double.NaN):N(at,"x",double.NaN),z=at==null?(back.Count>=2?Number(back[1],double.NaN):double.NaN):N(at,"z",double.NaN);
            if(!double.IsFinite(x)||!double.IsFinite(z))continue;var held=item["by"]!.DeepClone();item["by"]=null;if(!Rest(state,item,x,z,true)){item["by"]=held;continue;}changed.Add(item);
        }
        Commit(state,changed,Array.Empty<string>(),"put",new(){["p"]=player});return Copies(changed);
    }
    public JsonObject View(int player) { var state = State(); return new() { ["v"] = state["v"]!.DeepClone(), ["you"] = player, ["items"] = state["items"]!.DeepClone() }; }
    public void Reset()
    {
        var state = Fresh(); state["v"] = N(State(),"v") + 1; C.SetWorld("native_goods",state);
        host.Publish("goods",new JsonObject { ["v"] = state["v"]!.DeepClone(), ["items"] = state["items"]!.DeepClone(), ["gone"] = new JsonArray(), ["why"] = "reset", ["full"] = true });
    }

    public void Register(NativeServiceHost service)
    {
        if (C.World("native_goods") == null) C.SetWorld("native_goods",Fresh());
        service.Register("GET","/api/goods",r=>View(r.PlayerId));
        service.Register("POST","/api/goods",Ask);
        service.Register("GET","/api/docks/book",r=>new JsonObject { ["book"] = HasBook(r.PlayerId) });
        service.Register("POST","/api/docks/book",r=>AskBook(r.PlayerId));
        service.Register("POST","/api/dev/goods",Dev);
        service.NewGame += Reset; service.Loaded += ()=>{if(C.World("native_goods") is not JsonObject restored||restored["items"]is not JsonArray||restored["v"]==null){Reset();return;}host.Publish("goods",new JsonObject{["v"]=restored["v"]!.DeepClone(),["items"]=restored["items"]!.DeepClone(),["gone"]=new JsonArray(),["why"]="loaded",["full"]=true});};
        service.EndJobHooks.Add(EndJob);
        service.PresenceHooks.Add(request=>{if(request.Body["pos"] is JsonObject pos&&Finite(pos["x"],pos["z"]))C.SetPlayerState(request.PlayerId,"native_position",new{x=N(pos,"x"),z=N(pos,"z"),at=C.Now});});service.TickHooks.Add((request,advanced)=>{if(advanced)Tick();});
    }

    private void Commit(JsonObject state, IEnumerable<JsonObject> changed, IEnumerable<string> removed, string why, JsonObject? who = null, bool full = false, JsonNode? at = null)
    {
        var update = changed.Distinct().ToList(); var gone = removed.Distinct(StringComparer.Ordinal).ToList();
        if (update.Count == 0 && gone.Count == 0 && !full) { C.SetWorld("native_goods",state); return; }
        foreach (var item in update) item["rev"] = N(item,"rev") + 1;
        var array = state["items"]!.AsArray();
        for (int i=array.Count-1;i>=0;i--) if (gone.Contains(S(array[i],"id"))) array.RemoveAt(i);
        foreach(string id in gone) foreach(string key in new[]{"from","reporter","orphan","offSince"}) state[key]!.AsObject().Remove(id);
        state["v"] = N(state,"v") + 1; C.SetWorld("native_goods",state);
        var push = new JsonObject { ["v"] = state["v"]!.DeepClone(), ["items"] = Copies(update), ["gone"] = Strings(gone), ["why"] = why };
        if(who!=null)push["who"]=who.DeepClone(); if(full)push["full"]=true; if(at!=null)push["at"]=at.DeepClone(); host.Publish("goods",push);
    }

    private int Level(JsonObject state, JsonObject item, int guard=0)
    {
        var on=A(item["on"]); if(on.Count==0 || guard>8)return 1;
        return 1+on.Max(n=>{var under=Items(state).FirstOrDefault(i=>S(i,"id")==n!.GetValue<string>());return under==null?0:Level(state,under,guard+1);});
    }
    private double Height(JsonObject item) => item["h"]!=null?N(item,"h"):S(item,"look")=="cask"?.95:Number(Data["heights"]?[S(item,"kind")],.5);
    private (double x,double z,double y,List<string> on)? Place(JsonObject state,string kind,double x,double z,string? skip=null)
    {
        var lying=Items(state).Where(i=>i["by"]==null && S(i,"id")!=skip && Math.Abs(N(i,"x")-x)<3 && Math.Abs(N(i,"z")-z)<3).ToList();
        var tops=lying.Where(i=>!lying.Any(o=>A(o["on"]).Any(id=>id!.GetValue<string>()==S(i,"id")))).ToList();
        JsonObject? under=null; double underD=double.PositiveInfinity;
        foreach(var item in tops) { double d=Distance(N(item,"x"),N(item,"z"),x,z); if(d>.55)continue;
            if(under==null || N(item,"y")>N(under,"y")+1e-6 || Math.Abs(N(item,"y")-N(under,"y"))<=1e-6 && d<underD){under=item;underD=d;} }
        if(kind=="barrels") {
            (JsonObject a,JsonObject b,double x,double z,double d)? pair=null;var barrels=tops.Where(i=>S(i,"kind")=="barrels").ToList();
            for(int i=0;i<barrels.Count;i++)for(int j=i+1;j<barrels.Count;j++){var a=barrels[i];var b=barrels[j];double ab=Distance(N(a,"x"),N(a,"z"),N(b,"x"),N(b,"z"));
                if(Math.Abs(N(a,"y")-N(b,"y"))>.05 || ab<.45 || ab>1)continue;double mx=(N(a,"x")+N(b,"x"))/2,mz=(N(a,"z")+N(b,"z"))/2,d=Distance(mx,mz,x,z);
                if(d<.3 && (pair==null || d<pair.Value.d))pair=(a,b,mx,mz,d);}
            if(pair is { } best && best.d<underD){if(Math.Max(Level(state,best.a),Level(state,best.b))>=3)return null;return(R3(best.x),R3(best.z),R3(Math.Max(N(best.a,"y")+Height(best.a),N(best.b,"y")+Height(best.b))),new(){S(best.a,"id"),S(best.b,"id")});}
        }
        if(under!=null){if(Level(state,under)>=3)return null;return(N(under,"x"),N(under,"z"),R3(N(under,"y")+Height(under)),new(){S(under,"id")});}
        return(R3(x),R3(z),0,new());
    }
    private static double Rotation(string id,int n) { uint hash=0x811c9dc5;foreach(char c in id+"#"+n){hash^=c;hash=unchecked(hash*0x01000193);}return R3(hash/4294967296.0*.4); }
    public (double x,double z) Slot(string spot,int i,double gap=.95)
    {
        var s=Data["spots"]?[spot];if(s==null)return(0,0);var dir=A(s["dir"]);double dx=Number(dir.ElementAtOrDefault(0)),dz=Number(dir.ElementAtOrDefault(1)),side=(i%2==1?1:-1)*.5,along=Math.Floor(i/2.0)*gap;
        return(N(s,"x")+dx*along-dz*side,N(s,"z")+dz*along+dx*side);
    }
    private string NextJob(JsonObject state,int job){var table=state["jobN"]!.AsObject();int n=(int)Number(table[job.ToString()]);table[job.ToString()]=n+1;return $"job:{job}:{n}";}
    private JsonObject Make(JsonObject state,string id,string kind,string? owner,int? job,double x,double z,bool broken=false,bool heavy=false,bool keep=false,JsonObject? by=null,double? rot=null)
    {
        var p=by!=null?(x:x,z:z,y:0.0,on:new List<string>()):Place(state,kind,x,z)??(R3(x),R3(z),0.0,new List<string>());
        var item=new JsonObject{["id"]=id,["kind"]=kind,["owner"]=owner,["job"]=job,["x"]=p.x,["z"]=p.z,["y"]=p.y,["on"]=Strings(p.on),["rot"]=rot??Rotation(id,0),["by"]=by?.DeepClone(),["n"]=0,["rev"]=0};
        if(broken)item["broken"]=true;if(heavy)item["heavy"]=true;if(keep)item["keep"]=true;state["items"]!.AsArray().Add(item);return item;
    }
    private bool Rest(JsonObject state,JsonObject item,double x,double z,bool nearby=false)
    {
        var p=Place(state,S(item,"kind"),x,z,S(item,"id"));
        if(p==null && nearby)foreach(double r in new[]{.7,1.1,1.6})for(int k=0;k<8 && p==null;k++)p=Place(state,S(item,"kind"),x+Math.Cos(k*Math.PI/4)*r,z+Math.Sin(k*Math.PI/4)*r,S(item,"id"));
        if(p==null)return false;item["x"]=p.Value.x;item["z"]=p.Value.z;item["y"]=p.Value.y;item["on"]=Strings(p.Value.on);item["by"]=null;item["n"]=N(item,"n")+1;item["rot"]=Rotation(S(item,"id"),(int)N(item,"n"));
        foreach(string key in new[]{"from","reporter","orphan"})state[key]!.AsObject().Remove(S(item,"id"));
        if(item["job"]!=null){var j=C.One("SELECT task_json FROM job WHERE id=$p0",(int)N(item,"job"));var t=j==null?null:JsonNode.Parse(S(j,"task_json","{}"));var to=Data["spots"]?[S(t,"to")];if(S(t,"kind")=="carry" && to!=null && Distance(N(item,"x"),N(item,"z"),N(to,"x"),N(to,"z"))<2.2)item["job"]=null;}
        return true;
    }
    private void RememberFrom(JsonObject state,JsonObject item)=>state["from"]![S(item,"id")]=new JsonArray(N(item,"x"),N(item,"z"),N(item,"rot"));
    private JsonObject Job(int id,int player){var job=host.Jobs.Get(id);if(!host.Jobs.InHand(job,player))Refuse("That work is over or is another man's work.");return job;}
    private void Reach(int player,double x,double z){var pos=C.PlayerState(player,"native_position");if(pos!=null && C.Now-N(pos,"at")<30000 && Distance(x,z,N(pos,"x"),N(pos,"z"))>4)Refuse("You cannot reach it from there.");}
    private static List<JsonObject> JobItems(JsonObject state,int job)=>Items(state).Where(i=>i["job"]!=null && N(i,"job")==job).ToList();
    private void MarkMade(JsonObject state,int job){if(!A(state["made"]).Any(n=>Number(n)==job))state["made"]!.AsArray().Add(job);}

    private List<JsonObject> Layout(JsonObject state,JsonObject job,bool lay)
    {
        int jid=(int)N(job,"id");if(A(state["made"]).Any(n=>Number(n)==jid))return JobItems(state,jid);var t=job["task"] as JsonObject;if(t==null || !Kinds.Contains(S(t,"goods")))return new();
        string kind=S(t,"goods"),task=S(t,"kind");var made=new List<JsonObject>();string? owner=S(job,"employer_npc");
        if(task=="watch" && Data["spots"]?[S(t,"post")]!=null)for(int i=0;i<3;i++){var p=Slot(S(t,"post"),i,.9);made.Add(Make(state,NextJob(state,jid),kind,owner,jid,p.x,p.z,keep:true,rot:R3(i*.4)));}
        else if(task is "carry" or "deliver" && Data["spots"]?[S(t,"from")]!=null){var progress=t["progress"];int count=task=="carry"?(int)N(t,"count",1):1;
            int left=Math.Max(0,count-(int)(N(progress,"delivered")+N(progress,"lost")+N(progress,"sold"))-JobItems(state,jid).Count-Items(state).Count(i=>i["job"]!=null && N(i,"job")==jid && i["by"]?["cart"]!=null));
            int k=0;if(lay && !(task=="carry" && S(t,"from")=="ship_gangway"))for(int i=0;i<left;i++){var p=Slot(S(t,"from"),k);while(k<40 && Items(state).Any(o=>o["by"]==null && Distance(N(o,"x"),N(o,"z"),p.x,p.z)<.55))p=Slot(S(t,"from"),++k);k++;
                made.Add(Make(state,NextJob(state,jid),kind,owner,jid,p.x,p.z,S(t,"twist")=="broken_goods" && i==Math.Min(1,left-1),S(t,"twist")=="heavy_load" && i==0));}
            if(task=="carry" && Data["spots"]?[S(t,"to")]!=null)for(int i=0;i<N(progress,"delivered");i++){var p=Slot(S(t,"to"),i,.8);made.Add(Make(state,$"job:{jid}:d{i}",kind,owner,null,p.x,p.z));}
        }
        MarkMade(state,jid);Commit(state,made,Array.Empty<string>(),"spawn",new(){["world"]=true});return JobItems(state,jid);
    }

    public Func<string,bool>? NpcHasCart;
    public JsonObject Operate(int player,JsonObject command)=>Ask(new NativeServiceRequest(C,"POST","/api/goods",player,command,new(),new()));
    private JsonObject Ask(NativeServiceRequest r)
    {
        var touched=new HashSet<string>(StringComparer.Ordinal);var state=State();
        // The ask carries where he stands now: a tick every ten seconds is too old to judge the reach of a man who walked up to the crate.
        if(r.Body["pos"] is JsonObject here&&Finite(here["x"],here["z"]))C.SetPlayerState(r.PlayerId,"native_position",new{x=N(here,"x"),z=N(here,"z"),at=C.Now});
        try { return C.Atomic(()=>Run(r,state,touched)); }
        catch(NativeServiceException e){var now=State();return new(){["ok"]=false,["why"]=e.Message,["error"]=e.Message,["v"]=now["v"]!.DeepClone(),["items"]=Copies(Items(now).Where(i=>touched.Contains(S(i,"id"))))};}
    }
    private JsonObject Run(NativeServiceRequest r,JsonObject state,HashSet<string> touched)
    {
        string op=r.Text("op");if(!Ops.Contains(op))Refuse("bad request");var changed=new List<JsonObject>();var gone=new List<string>();var who=new JsonObject{["p"]=r.PlayerId};string why=op;JsonNode? at=null;
        if((op.StartsWith("npc_",StringComparison.Ordinal)||op=="haul_in")&&NpcMayReport?.Invoke(r.PlayerId,r.Text("npc"))==false)Refuse("Not yours to report.");
        JsonObject Item(string id){if(id.Length==0 || id.Length>60)Refuse("bad item");touched.Add(id);return Items(state).FirstOrDefault(i=>S(i,"id")==id)??throw new NativeServiceException("It is not there any more.",409);}
        void Add(JsonObject item){if(!changed.Contains(item))changed.Add(item);}
        JsonObject Existing(IEnumerable<JsonObject> items)=>new(){["ok"]=true,["v"]=state["v"]!.DeepClone(),["items"]=Copies(items),["gone"]=new JsonArray()};
        string npc=r.Text("npc");if(op.StartsWith("npc_") || op=="haul_in"){if(!Regex.IsMatch(npc,"^[a-z0-9_:-]{1,40}$",RegexOptions.IgnoreCase))Refuse("bad townsperson");who=new(){["npc"]=npc};}
        switch(op)
        {
            case "lift": {var it=Item(r.Text("id"));if(it["by"]!=null){if(!Held(it,r.PlayerId))Refuse("Someone was quicker.");return Existing(new[]{it});}if(B(it,"cartOnly")&&NpcHasCart?.Invoke(npc)!=true)Refuse("Too big to carry: that is a cart's work.");if(Items(state).Any(i=>Held(i,r.PlayerId)))Refuse("Your hands are full.");if(Above(state,S(it,"id")))Refuse("Something is on top of it.");if(it["job"]!=null)Job((int)N(it,"job"),r.PlayerId);if(HaulForItem(S(it,"id"))!=null && !HasBook(r.PlayerId))Refuse("That is the natie's load. Ask the foreman at the Hessenatie for his book first.");Reach(r.PlayerId,N(it,"x"),N(it,"z"));RememberFrom(state,it);it["by"]=new JsonObject{["p"]=r.PlayerId};it["on"]=new JsonArray();Add(it);break;}
            case "put": {var it=Item(r.Text("id"));if(!Held(it,r.PlayerId))Refuse("You are not carrying that.");if(!Finite(r.Body["x"],r.Body["z"]))Refuse("bad place");Reach(r.PlayerId,N(r.Body,"x"),N(r.Body,"z"));if(!Rest(state,it,N(r.Body,"x"),N(r.Body,"z")))Refuse("No room there: the stack is full.");Add(it);break;}
            case "drop": {var it=Item(r.Text("id"));if(!Held(it,r.PlayerId))Refuse("You are not carrying that.");why=new[]{"sunk","handed","sold","snatched","taken"}.Contains(r.Text("why"))?r.Text("why"):"taken";if(why=="sunk" && r.Body["at"] is JsonArray point && point.Count>=2 && Finite(point[0],point[1]))at=new JsonArray(R3(Number(point[0])),R3(Number(point[1])));gone.Add(S(it,"id"));break;}
            case "take": {var it=Item(r.Text("id"));if(it["by"]!=null)Refuse("Someone was quicker.");if(it["job"]==null)Refuse("That is another man's work.");Job((int)N(it,"job"),r.PlayerId);if(Above(state,S(it,"id")))Refuse("Something is on top of it.");gone.Add(S(it,"id"));why="taken";break;}
            case "job": {var j=Job(r.Int("job"),r.PlayerId);var result=Layout(state,j,r.Bool("lay"));return new(){["ok"]=true,["v"]=state["v"]!.DeepClone(),["items"]=Copies(result),["gone"]=new JsonArray()};}
            case "lower": {var j=Job(r.Int("job"),r.PlayerId);var t=j["task"]!;int index=r.Int("i",-1),jid=(int)N(j,"id");if(S(t,"kind")!="carry" || S(t,"from")!="ship_gangway" || !Kinds.Contains(S(t,"goods")))Refuse("nothing to swing down for that job");if(index<0 || index>=20)Refuse("bad place");string key=jid+":"+index;if(A(state["lowered"]).Any(n=>n!.GetValue<string>()==key)){changed=JobItems(state,jid);break;}var p=t["progress"];if(JobItems(state,jid).Count+N(p,"delivered")+N(p,"lost")+N(p,"sold")>=N(t,"count",1))Refuse("more goods than the job has");state["lowered"]!.AsArray().Add(key);var pos=Slot("ship_gangway",index);Add(Make(state,NextJob(state,jid),S(t,"goods"),S(j,"employer_npc"),jid,pos.x,pos.z,r.Bool("broken")&&S(t,"twist")=="broken_goods",r.Bool("heavy")&&S(t,"twist")=="heavy_load"));why="spawn";break;}
            case "handover": {var j=Job(r.Int("job"),r.PlayerId);var t=j["task"]!;int jid=(int)N(j,"id");if(S(t,"kind")!="deliver" || !Kinds.Contains(S(t,"goods")) || S(t,"goods")=="parcel")Refuse("nothing to hand over for that job");changed=JobItems(state,jid);if(changed.Count>0)break;if(Items(state).Any(i=>Held(i,r.PlayerId)))Refuse("Your hands are full.");Add(Make(state,NextJob(state,jid),S(t,"goods"),S(j,"employer_npc"),jid,0,0,by:new(){["p"]=r.PlayerId}));MarkMade(state,jid);why="spawn";break;}
            case "end": {int jid=r.Int("job");var row=C.One("SELECT status,taken_by FROM job WHERE id=$p0",jid);if(S(row,"status")=="taken" && N(row,"taken_by",1)!=r.PlayerId)Refuse("That is another man's work.");(changed,gone)=End(state,jid);who=new(){["world"]=true};break;}
            case "restore": Restore(r,state,changed,gone);break;
            case "npc_lift": {var ids=A(r.Body["ids"]).Select(n=>n?.GetValue<string>()??"").Distinct().Take(6).ToList();if(ids.Count==0)Refuse("nothing to lift");foreach(string id in ids){var it=Item(id);if(it["by"]!=null){if(!Held(it,"npc",npc))Refuse("Someone was quicker.");Add(it);continue;}if(Above(state,id))Refuse("Something is on top of it.");if(B(it,"cartOnly")&&NpcHasCart?.Invoke(npc)!=true)Refuse("Too big to carry: that is a cart's work.");if(!MayNpc(npc,it))Refuse("That is not his to lift.");RememberFrom(state,it);it["by"]=new JsonObject{["npc"]=npc};it["on"]=new JsonArray();state["reporter"]![id]=r.PlayerId;Add(it);}why="lift";break;}
            case "npc_put": {var it=Item(r.Text("id"));if(!Held(it,"npc",npc))Refuse("He is not carrying that.");if(!Finite(r.Body["x"],r.Body["z"]))Refuse("bad place");var home=NpcCarryBack?.Invoke(npc)==S(it,"id")?it["home"]as JsonArray:null;double x=home==null?N(r.Body,"x"):Number(home[0]),z=home==null?N(r.Body,"z"):Number(home[1]);if(!Rest(state,it,x,z,true))Refuse("No room there: the stack is full.");if(home!=null && Distance(x,z,N(it,"x"),N(it,"z"))<.05)it["rot"]=home[2]!.DeepClone();Add(it);why="put";break;}
            case "npc_drop": {var it=Item(r.Text("id"));if(!Held(it,"npc",npc))Refuse("He is not carrying that.");gone.Add(S(it,"id"));why="taken";break;}
            case "haul_in": {var it=Item(r.Text("id"));if(!Held(it,"npc",npc))Refuse("He is not carrying that.");var route=HaulForNpc(npc);if(route==null || !S(it,"id").StartsWith("haul:"+S(route,"id")+"a:",StringComparison.Ordinal))Refuse("That is not his route's load.");var made=S(route,"into")=="pile"?HaulSlot(state,route!,"b"):null;if(made!=null)Add(made);gone.Add(S(it,"id"));HauledIn?.Invoke(S(route,"id"));why=made==null?"taken":"haul";break;}
            case "haul_deliver": {var it=Item(r.Text("id"));if(!Held(it,r.PlayerId))Refuse("You are not carrying that.");var route=HaulForItem(S(it,"id"));if(route==null)Refuse("That is not the natie's load.");if(!HasBook(r.PlayerId))Refuse("You are not in the foreman's book.");var target=route!["b"]!.AsArray();Reach(r.PlayerId,Number(target[0]),Number(target[1]));var made=S(route,"into")=="pile"?HaulSlot(state,route,"b"):null;if(made!=null)Add(made);gone.Add(S(it,"id"));var start=route["a"]!.AsArray();double way=Distance(Number(start[0]),Number(start[1]),Number(target[0]),Number(target[1]))*1.3;int pay=(int)Math.Clamp(Math.Floor((2+way/12)*(S(route,"carry")=="crate"?1.4:1)+.5),2,12);C.Execute("UPDATE player SET money_c=money_c+$p0 WHERE id=$p1",pay,r.PlayerId);HauledIn?.Invoke(S(route,"id"));why="delivered";break;}
            case "crane_put": {var route=A(Data["hauls"]).FirstOrDefault(n=>S(n,"id")==r.Text("route")) as JsonObject;if(route==null || !A(Data["craneFed"]).Any(n=>n!.GetValue<string>()==r.Text("route")))Refuse("No crane reaches that pile.");string id=S(route,"id");if(C.Now-Number(state["craneAt"]![id])<6000)Refuse("The crane is still swinging.");int count=Math.Clamp(r.Int("n",1),1,S(route!["pile"],"kind")=="sacks"?3:1);for(int i=0;i<count;i++){var it=HaulSlot(state,route,"a");if(it==null)break;Add(it);}if(changed.Count==0)Refuse("The pile is whole.");state["craneAt"]![id]=C.Now;who=new(){["world"]=true};why="spawn";break;}
        }
        Commit(state,changed,gone,why,who,at:at);return new(){["ok"]=true,["v"]=state["v"]!.DeepClone(),["items"]=Copies(changed),["gone"]=Strings(gone)};
    }

    private void Restore(NativeServiceRequest r,JsonObject state,List<JsonObject> changed,List<string> gone)
    {
        if(r.Body["job"]!=null){var j=Job(r.Int("job"),r.PlayerId);int jid=(int)N(j,"id");gone.AddRange(JobItems(state,jid).Where(i=>i["by"]==null && !Above(state,S(i,"id"))).Select(i=>S(i,"id")));var arr=state["items"]!.AsArray();for(int i=arr.Count-1;i>=0;i--)if(gone.Contains(S(arr[i],"id")))arr.RemoveAt(i);
            foreach(var n in A(r.Body["lying"]).Take(12)){var l=n!.AsObject();if(!Kinds.Contains(S(l,"kind")) || !Finite(l["x"],l["z"]))continue;changed.Add(Make(state,NextJob(state,jid),S(l,"kind"),S(j,"employer_npc"),jid,N(l,"x"),N(l,"z"),B(l,"broken"),B(l,"heavy"),S(j["task"],"kind")=="watch",rot:l["rot"]==null?null:N(l,"rot")));}MarkMade(state,jid);}
        if(r.Body["carried"] is not JsonObject c || !Kinds.Contains(S(c,"kind")) || Items(state).Any(i=>Held(i,r.PlayerId)))return;
        if(c["job"]==null){var it=Items(state).FirstOrDefault(i=>i["by"]==null && S(i,"kind")==S(c,"kind") && i["job"]==null && S(i,"owner")==S(c,"owner") && !Above(state,S(i,"id")));if(it==null)return;RememberFrom(state,it);it["by"]=new JsonObject{["p"]=r.PlayerId};it["on"]=new JsonArray();changed.Add(it);}
        else {var j=Job((int)N(c,"job"),r.PlayerId);changed.Add(Make(state,NextJob(state,(int)N(j,"id")),S(c,"kind"),S(j,"employer_npc"),(int)N(j,"id"),0,0,B(c,"broken"),B(c,"heavy"),by:new(){["p"]=r.PlayerId}));}
    }
    private (List<JsonObject> changed,List<string> gone) End(JsonObject state,int job)
    {
        var changed=new List<JsonObject>();var gone=new List<string>();foreach(var it in JobItems(state,job)){if(it["by"]?["cart"]!=null)continue;if(B(it,"keep") && it["by"]==null){it["job"]=null;it.Remove("keep");changed.Add(it);}else gone.Add(S(it,"id"));}
        foreach(var it in Items(state)){if(it["by"]!=null || !A(it["on"]).Any(n=>gone.Contains(n!.GetValue<string>())))continue;it["on"]=Strings(A(it["on"]).Select(n=>n!.GetValue<string>()).Where(id=>!gone.Contains(id)));if(A(it["on"]).Count==0)it["y"]=0;if(!changed.Contains(it))changed.Add(it);}return(changed,gone);
    }
    public void EndJob(int job){var state=State();var result=End(state,job);Commit(state,result.changed,result.gone,"end",new(){["world"]=true});}
    private JsonObject? HaulForItem(string id){var match=Regex.Match(id,@"^haul:(.+)a:\d+$");return match.Success?A(Data["hauls"]).FirstOrDefault(n=>S(n,"id")==match.Groups[1].Value)as JsonObject:null;}
    private JsonObject? HaulForNpc(string npc)
    {
        var row=C.One("SELECT data_json FROM resident WHERE id=$p0",npc);if(row==null)return null;var work=JsonNode.Parse(S(row,"data_json","{}"))?["work"];if(S(work,"kind")!="haul")return null;
        return A(Data["hauls"]).FirstOrDefault(route=>JsonNode.DeepEquals(route?["a"],work?["a"]) && JsonNode.DeepEquals(route?["b"],work?["b"]))as JsonObject;
    }
    private bool MayNpc(string npc,JsonObject item){if(NpcMayLift?.Invoke(npc,item)==true)return true;var route=HaulForNpc(npc);return route!=null && S(item,"id").StartsWith("haul:"+S(route,"id")+"a:",StringComparison.Ordinal);}
    private JsonObject? HaulSlot(JsonObject state,JsonObject route,string tag)
    {
        foreach(var node in A(Data["haulTemplates"]?[S(route,"id")+":"+tag])){var template=node!.AsObject();if(Items(state).Any(i=>S(i,"id")==S(template,"id")))continue;if(A(template["on"]).Any(n=>!Items(state).Any(i=>S(i,"id")==n!.GetValue<string>() && i["by"]==null)))continue;var item=template.DeepClone().AsObject();item["rev"]=0;state["items"]!.AsArray().Add(item);return item;}return null;
    }
    private bool HasBook(int player)=>C.World("dockbook:"+player)!=null;
    private JsonObject AskBook(int player)
    {
        if(HasBook(player))return new(){["ok"]=true,["line"]="Sooi taps the book. \"You are in it already. Take from the piles, set it in at the end, and I pay by the piece.\""};
        var c=host.Clock.View();if(N(c,"day")%7==0)return new(){["ok"]=false,["line"]="\"Sunday. No book on a Sunday. Come back tomorrow.\""};if(N(c,"hour")<6 || N(c,"hour")>=19)return new(){["ok"]=false,["line"]="\"The book is shut. Come at six, when the quays open.\""};if(C.Scalar<int>("SELECT trust FROM npc_relationship WHERE npc_id='sooi' AND player_id=$p0",player)<0)return new(){["ok"]=false,["line"]="Sooi looks at you a long time. \"Not you. Not after what I heard.\""};C.SetWorld("dockbook:"+player,new{day=N(c,"day")});return new(){["ok"]=true,["line"]="Sooi writes your name in the book. \"Take from the natie's piles, set it in where the others do: a few cents a load, paid on the spot.\""};
    }

    public JsonObject? ToCart(int player,string id,string cart){var state=State();var it=Items(state).FirstOrDefault(i=>S(i,"id")==id);if(it==null || !Held(it,player))return null;it["by"]=new JsonObject{["cart"]=cart};Commit(state,new[]{it},Array.Empty<string>(),"cart",new(){["p"]=player});return it.DeepClone().AsObject();}
    public JsonObject? FromCart(int player,string id,string cart){var state=State();var it=Items(state).FirstOrDefault(i=>S(i,"id")==id);if(it==null || !Held(it,"cart",cart) || Items(state).Any(i=>Held(i,player)))return null;it["by"]=new JsonObject{["p"]=player};Commit(state,new[]{it},Array.Empty<string>(),"lift",new(){["p"]=player});return it.DeepClone().AsObject();}
    public JsonArray CartUnload(string cart,IEnumerable<JsonObject> positions)
    {
        var state=State();var changed=new List<JsonObject>();foreach(var pos in positions){var it=Items(state).FirstOrDefault(i=>S(i,"id")==S(pos,"id"));if(it==null || !Held(it,"cart",cart))continue;
            bool exact=pos["y"]!=null && A(pos["on"]).All(n=>Items(state).Any(i=>S(i,"id")==n!.GetValue<string>() && i["by"]==null)) && (A(pos["on"]).Count>0 || N(pos,"y")<.05);
            if(exact){it["x"]=R3(N(pos,"x"));it["z"]=R3(N(pos,"z"));it["y"]=R3(N(pos,"y"));it["on"]=pos["on"]?.DeepClone()??new JsonArray();it["by"]=null;it["n"]=N(it,"n")+1;it["rot"]=Rotation(S(it,"id"),(int)N(it,"n"));state["from"]!.AsObject().Remove(S(it,"id"));}
            else if(!Rest(state,it,N(pos,"x"),N(pos,"z"),true))continue;if(pos["rot"]!=null)it["rot"]=R3(N(pos,"rot"));changed.Add(it);}
        Commit(state,changed,Array.Empty<string>(),"put",new(){["cart"]=cart});return Copies(changed);
    }
    public JsonObject? GiveTo(int player,JsonObject spec){var state=State();if(Items(state).Any(i=>Held(i,player)) || !Kinds.Contains(S(spec,"kind")))return null;int?job=spec["job"]==null?null:(int)N(spec,"job");state["spawnN"]=N(state,"spawnN")+1;string id=job==null?"spawn:"+N(state,"spawnN"):NextJob(state,job.Value);var it=Make(state,id,S(spec,"kind"),spec["owner"]==null?null:S(spec,"owner"),job,0,0,B(spec,"broken"),B(spec,"heavy"),by:new(){["p"]=player});Commit(state,new[]{it},Array.Empty<string>(),"spawn",new(){["p"]=player});return it.DeepClone().AsObject();}
    public JsonArray Spawn(IEnumerable<JsonObject> specs)
    {
        var state=State();var changed=new List<JsonObject>();foreach(var spec in specs){if(!Kinds.Contains(S(spec,"kind")) || !Finite(spec["x"],spec["z"]))continue;string id=S(spec,"id");if(id=="" || Items(state).Any(i=>S(i,"id")==id)){state["spawnN"]=N(state,"spawnN")+1;id="spawn:"+N(state,"spawnN");}var it=Make(state,id,S(spec,"kind"),spec["owner"]==null?null:S(spec,"owner"),spec["job"]==null?null:(int)N(spec,"job"),N(spec,"x"),N(spec,"z"),B(spec,"broken"),B(spec,"heavy"),rot:spec["rot"]==null?null:N(spec,"rot"));if(spec["look"]!=null)it["look"]=spec["look"]!.DeepClone();changed.Add(it);}Commit(state,changed,Array.Empty<string>(),"spawn",new(){["world"]=true});return Copies(changed);
    }
    private void CartTake(JsonObject state,string cart,IEnumerable<string> ids,List<JsonObject> changed)
    {
        var list=Items(state).Where(i=>ids.Contains(S(i,"id")) && i["by"]==null).OrderByDescending(i=>Level(state,i)).ToList();foreach(var it in list){if(Above(state,S(it,"id")))continue;RememberFrom(state,it);it["by"]=new JsonObject{["cart"]=cart};it["on"]=new JsonArray();changed.Add(it);}
    }
    private void RunCart(JsonObject state,JsonObject run,int day,int minute,string? force=null)
    {
        string id=S(run,"id"),cart=S(run,"cart");var runs=state["runs"]!.AsObject();var status=runs[id]as JsonObject??new JsonObject{["state"]="home",["day"]=day};if(runs[id]==null)runs[id]=status;
        var names=A(run["items"]).Select(n=>n!.GetValue<string>()).ToList();if(names.Any(n=>Data["homes"]?[n]==null))return;string phase=S(status,"state");if(N(status,"day")!=day){phase="home";status["state"]=phase;status["day"]=day;}
        if(force!=null){phase=new Dictionary<string,string>{{"out","home"},{"down","out"},{"back","down"},{"home","back"}}[force];minute=(int)N(run,force);status["state"]=phase;status["day"]=day%7==0?day+1:day;}
        if(day%7==0 && force==null || phase=="skip")return;var changed=new List<JsonObject>();
        if(phase=="home" && minute>=N(run,"out") && minute<N(run,"down")){bool whole=names.All(name=>Items(state).Any(i=>S(i,"id")==name && i["by"]==null && Distance(N(i,"x"),N(i,"z"),N(Data["homes"]![name],"x"),N(Data["homes"]![name],"z"))<.05 && Math.Abs(N(i,"y")-N(Data["homes"]![name],"y"))<.01));bool burden=Items(state).Any(i=>i["by"]==null && !names.Contains(S(i,"id")) && A(i["on"]).Any(n=>names.Contains(n!.GetValue<string>())));if(!whole || burden){status["state"]="skip";C.SetWorld("native_goods",state);return;}CartTake(state,cart,names,changed);status["state"]="out";Commit(state,changed,Array.Empty<string>(),"cart",new(){["cart"]=cart});}
        else if(phase=="out" && minute>=N(run,"down") || phase=="back" && minute>=N(run,"home")){var places=phase=="out"?A(Data["runSpots"]?[id]).Select(n=>n!.AsObject()).ToList():names.Select(name=>{var n=Data["homes"]![name]!.DeepClone().AsObject();n["id"]=name;return n;}).ToList();foreach(var pos in places){var it=Items(state).FirstOrDefault(i=>S(i,"id")==S(pos,"id") && Held(i,"cart",cart));if(it!=null && Rest(state,it,N(pos,"x"),N(pos,"z"),true)){if(pos["y"]!=null){it["y"]=pos["y"]!.DeepClone();it["on"]=pos["on"]?.DeepClone()??new JsonArray();}it["rot"]=pos["rot"]!.DeepClone();changed.Add(it);}}status["state"]=phase=="out"?"down":"skip";Commit(state,changed,Array.Empty<string>(),"put",new(){["cart"]=cart});}
        else if(phase=="down" && minute>=N(run,"back")){var spots=A(Data["runSpots"]?[id]);var there=names.Where(name=>Items(state).Any(i=>S(i,"id")==name && i["by"]==null && spots.Any(s=>S(s,"id")==name && Distance(N(i,"x"),N(i,"z"),N(s,"x"),N(s,"z"))<.4)));CartTake(state,cart,there,changed);status["state"]="back";Commit(state,changed,Array.Empty<string>(),"cart",new(){["cart"]=cart});}
    }
    private void Tick()
    {
        var state=State();foreach(int jid in Items(state).Where(i=>i["job"]!=null).Select(i=>(int)N(i,"job")).Distinct().ToList()){var row=C.One("SELECT status,task_json FROM job WHERE id=$p0",jid);if(row==null || S(row,"status")!="taken" || JsonNode.Parse(S(row,"task_json","{}"))?["held"]!=null){var result=End(state,jid);Commit(state,result.changed,result.gone,"end",new(){["world"]=true});}}
        var changed=new List<JsonObject>();var gone=new List<string>();foreach(var it in Items(state)){string id=S(it,"id");if(it["by"]?["npc"] is JsonValue nv){string npc=nv.GetValue<string>();if(NpcHasErrand?.Invoke(npc)==true){state["orphan"]!.AsObject().Remove(id);continue;}if(state["orphan"]![id]==null)state["orphan"]![id]=C.Now;if(C.Now-Number(state["orphan"]![id])>=20000){var back=A(state["from"]![id]??it["home"]);if(back.Count>=2 && Rest(state,it,Number(back[0]),Number(back[1]),true))changed.Add(it);}}
            else if(it["by"]?["cart"] is JsonValue cv && CartContains?.Invoke(cv.GetValue<string>(),id)==false)gone.Add(id);}
        Commit(state,changed,gone,"sweep",new(){["world"]=true});var clock=host.Clock.View();int day=(int)N(clock,"day"),minute=(int)(N(clock,"hour")*60+N(clock,"minute"));foreach(var run in A(Data["cartRuns"]))RunCart(state,run!.AsObject(),day,minute);
        if(N(clock,"hour")>=5 && N(state,"lastDawn",-1)!=day){changed.Clear();state["lastDawn"]=day;foreach(var route in A(Data["hauls"]))foreach(string tag in new[]{"a","b"})for(int i=0;i<5;i++){var next=HaulSlot(state,route!.AsObject(),tag);if(next==null)break;changed.Add(next);}Commit(state,changed,Array.Empty<string>(),"dawn",new(){["world"]=true});}
        var pos=C.PlayerState(1,"native_position");if(pos==null || day%7==0 || minute<360 || minute>1110)return;
        changed.Clear();gone.Clear();foreach(var node in A(Data["hauls"])){var route=node!.AsObject();string id=S(route,"id");if(Distance(N(pos,"x"),N(pos,"z"),N(route["pile"],"x"),N(route["pile"],"z"))<45)continue;string key=B(route,"dawnOnly")?"carryAt":"supplyAt";double now=day*1440+minute;if(now-Number(state[key]![id],-99999)<(B(route,"dawnOnly")?6:4))continue;state[key]![id]=now;
            if(B(route,"dawnOnly")){if(minute>720)continue;var top=Items(state).Where(i=>S(i,"id").StartsWith("haul:"+id+"a:") && i["by"]==null && !Above(state,S(i,"id"))).OrderByDescending(i=>N(i,"y")).FirstOrDefault();if(top!=null){gone.Add(S(top,"id"));HauledIn?.Invoke(id);}}
            else {var next=HaulSlot(state,route,"a");if(next!=null)changed.Add(next);}}
        Commit(state,changed,gone,"haul",new(){["world"]=true});
    }
    private JsonObject Dev(NativeServiceRequest r)
    {
        if(r.Bool("reset"))Reset();var state=State();var result=new JsonObject();
        if(r.Text("dray") is {Length:>0}stage){if(!new[]{"out","down","back","home"}.Contains(stage))throw new NativeServiceException("dray: out, down, back or home",400);var run=A(Data["cartRuns"]).FirstOrDefault(n=>S(n,"id")==r.Text("run","casks"));if(run!=null){RunCart(state,run.AsObject(),(int)N(host.Clock.View(),"day"),0,stage);result["dray"]=stage;}}
        if(r.Body["move"] is JsonArray move && move.Count>=3){var it=Items(state).FirstOrDefault(i=>S(i,"id")==move[0]!.GetValue<string>());if(it!=null && (it["by"]==null || it["by"]?["npc"]!=null) && !Above(state,S(it,"id")) && Rest(state,it,Number(move[1]),Number(move[2]),true)){Commit(state,new[]{it},Array.Empty<string>(),"put",new(){["world"]=true});result["moved"]=it.DeepClone();}}
        result["v"]=State()["v"]!.DeepClone();result["items"]=List();return result;
    }
}

