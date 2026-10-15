using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using P=Scheldemist.Native.Services.AntigoonBrain.Point;

namespace Scheldemist.Native.Services;

/// <summary>One shared giant. Requests advance a single real-time clock; hits are checked on the host.</summary>
public sealed partial class NativeAntigoon : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private AntigoonBrain? brain;
    private long last, saved;
    public Func<int,P?> PositionOf = _=>null;
    public Func<P,bool> Clear = _=>false;
    public Func<P,double> Ground = _=>0;
    public Func<P,double> Light = _=>1;
    public Func<P,P,IReadOnlyList<P>?> Path = (_,_)=>null;
    public Func<P,P,bool> Sight = (_,_)=>false;
    public Func<P,bool> BackAlley = _=>true;
    public Func<P,P?> Snap = p=>p;
    public Func<P,double,IReadOnlyList<P>>? Roamable;
    public Func<P,bool> Jumpable = _=>false;
    /// <summary>Nearest spot of the giant's own street area to `p`, within `radius` metres, from `home`'s area.</summary>
    public Func<P,P,double,P?> StandNear = (_,_,_)=>null;
    /// <summary>Extra food spots the town knows outside its stall and shop lists (fish scraps by the market).</summary>
    public Func<IEnumerable<(string Id,string Kind,P At)>> MoreFood = ()=>Array.Empty<(string,string,P)>();
    /// <summary>(giant, spot): can he stand within kicking reach of the spot, walking from where he is?</summary>
    public Func<P,P,bool> Reach = (_,_)=>true;
    private bool developmentEnabled;
    public NativeAntigoon(NativeServiceHost host)=>this.host=host;
    internal System.Threading.Tasks.Task<T> WithState<T>(Func<NativeAntigoon,T> operation)=>host.WithState(_=>operation(this));
    private double Hour { get { var c=host.Clock.View();return NativeGoods.Number(c["hour"])+NativeGoods.Number(c["minute"])/60; } }
    private bool Night=>Hour>=20||Hour<6;
    public void Register(NativeServiceHost service)
    {
        RegisterEvent(service);
        RegisterDevelopment(service);
        service.Register("GET","/api/antigoon",r=>{Advance();return View(r.PlayerId);});
        service.Register("POST","/api/antigoon/investigate",r=>throw new NativeServiceException("Antigoon is currently a development-only event. Use the developer Events panel.",409));
        service.Register("POST","/api/antigoon/strike",r=>
        {
            if(host.Saves.Paused)throw new NativeServiceException("The town is paused.",409);
            Advance();bool hit=developmentEnabled&&brain!=null&&PositionOf(r.PlayerId) is {} p&&brain.Strike(new(r.PlayerId,p,Available(r.PlayerId)));
            if(hit)Save();var v=View(r.PlayerId);v["hit"]=hit;return v;
        });
        service.NewGame+=Reset;service.Loaded+=Reset;
    }
    private void Reset(){brain=null;last=0;saved=0;developmentEnabled=false;street=null;observed.Clear();}
    private bool Available(int id)=>NativeGoods.Number(host.Player(id)["health"])>0&&host.Clock.Where(id)["shelter"]?.GetValue<string>()=="outside";
    private void Advance()
    {
        long now=host.Context.Now;
        if(!developmentEnabled||host.Saves.Paused){last=now;return;}
        var players=host.OnlinePlayers().Distinct().Select(id=>(id,p:PositionOf(id))).Where(v=>v.p!=null).Select(v=>new AntigoonBrain.Player(v.id,v.p!.Value,Available(v.id))).ToArray();
        double elapsed=last==0||now-last>1000?0:Math.Clamp((now-last)/1000.0,0,.5);last=now;
        if(brain==null)return;
        var witnesses=observed.Values.Where(v=>now-v.At<1500).Select(v=>v.Person).ToArray();
        while(elapsed>.0001){double dt=Math.Min(.05,elapsed);street!.Step(dt,Night,brain,witnesses);brain.Step(dt,Night,players.Concat(street.Targets()).ToArray());elapsed-=dt;}
        if(now-saved>2000)Save();
        if(!Night&&brain.State=="hidden")
        {developmentEnabled=false;brain=null;street=null;observed.Clear();}
    }
    private void Create(P home)
    {
        street=new(){HumanPath=HumanPath,HumanClear=HumanClear,Lamps=()=>Lighting?.Targets()??Array.Empty<AntigoonNightEvent.Lamp>(),Extinguish=id=>Lighting?.Extinguish(id)};
        brain=new(home){Clear=Clear,Light=Light,Path=Path,Sight=Sight,Jumpable=Jumpable,HurtPlayer=(id,damage)=>
        {
            if(id<0){street.KnockDown(id);return;}
            host.Context.Execute("UPDATE player SET health=MAX(0,health-$p0) WHERE id=$p1",damage,id);
            if(NativeGoods.Number(host.Player(id)["health"])<=0)host.Clock.End(id,"health");
            host.PublishState(id);
        }};
        var giant=brain;brain.Reach=p=>Reach(giant.Position,p);brain.Beasts=Beasts;
        // A thrown body flies at chest height until a wall stops it; it comes down just short of the wall.
        brain.Landing=(from,to)=>
        {
            int n=Math.Max(1,(int)Math.Ceiling(from.Distance(to)/.3));var last=from;
            for(int i=1;i<=n;i++){var p=new P(from.X+(to.X-from.X)*i/n,from.Z+(to.Z-from.Z)*i/n);if(!Sight(from,p)||!HumanClear(p))break;last=p;}
            return last.Distance(from)>.6?last.Toward(from,.35):last;
        };
        brain.Thrown=t=>
        {
            if(t.Victim<0){street.Thrown(t);return;}
            int damage=AntigoonBrain.ThrowDamage+(t.Wall?AntigoonBrain.WallDamage:0);
            host.Context.Execute("UPDATE player SET health=MAX(0,health-$p0) WHERE id=$p1",damage,t.Victim);
            if(NativeGoods.Number(host.Player(t.Victim)["health"])<=0)host.Clock.End(t.Victim,"health");
            host.PublishState(t.Victim);
        };
        // Patrol a shuffled loop of reachable dark streets, ordered so each leg goes to the nearest next spot.
        var spots=(Roamable?.Invoke(home,46)??Array.Empty<P>()).ToList();var at=home;
        while(spots.Count>0&&brain.Patrol.Count<10)
        {
            var next=spots.OrderBy(p=>p.Distance(at)).First();spots.Remove(next);
            if(brain.Patrol.All(q=>q.Distance(next)>9)){brain.Patrol.Add(next);at=next;}
        }
        for(int i=0;i<16&&brain.Patrol.Count<4;i++)
        {
            double a=i*Math.PI/8;var candidate=Snap(new(home.X+Math.Sin(a)*(16+i%3*12),home.Z+Math.Cos(a)*(16+i%3*12)));
            if(candidate is {} p&&Clear(p)&&Path(home,p)!=null)brain.Patrol.Add(p);
        }
        // Preserve usable intermediate street points when radial destinations fall inside houses.
        foreach(int id in host.OnlinePlayers())if(PositionOf(id) is {} eye&&Path(home,eye) is {} approach)
            foreach(var p in approach.Where(p=>p.Distance(home)>6&&p.Distance(home)<55))
                if(brain.Patrol.All(q=>q.Distance(p)>7))brain.Patrol.Add(p);
        brain.Patrol.Add(home);
        Feed(home);
    }
    /// <summary>
    /// His food in the town: fish stalls and fish scraps, the butcher, the meat hall, bakeries for grain. Each gets a
    /// spot on his own streets to stand at; places he cannot reach are left out.
    /// </summary>
    private void Feed(P home)
    {
        var town=host.Context.World("town");var spots=new List<(string Id,string Kind,P At)>();
        foreach(var stall in (town?["stalls"] as JsonArray??new()).OfType<JsonObject>().Select((v,i)=>(v,i)))
        {
            string goods=NativeGoods.S(stall.v,"goods");string kind=goods=="fish"?"fish":goods is "meat" or "sausage"?"meat":goods=="bread"?"grain":"";
            if(kind!="")spots.Add(("stall:"+stall.i,kind,new(NativeGoods.Number(stall.v["x"]),NativeGoods.Number(stall.v["z"]))));
        }
        foreach(var shop in (town?["shops"] as JsonArray??new()).OfType<JsonObject>())
        {
            string id=NativeGoods.S(shop,"id"),goods=NativeGoods.S(shop,"goods");
            string kind=id.Contains("butcher")?"meat":id.Contains("fish")?"fish":goods=="bread"||id.Contains("bakery")?"grain":"";
            var door=shop["door"] as JsonArray;
            if(kind!=""&&door?.Count>=2)spots.Add(("shop:"+id,kind,new(NativeGoods.Number(door[0]),NativeGoods.Number(door[1]))));
        }
        foreach(var (id,kind) in new[]{("vismarkt","fish"),("vleeshuis","meat")})
            if(town?["places"]?[id] is JsonObject place)spots.Add(("place:"+id,kind,new(NativeGoods.Number(place["x"]),NativeGoods.Number(place["z"]))));
        spots.AddRange(MoreFood());
        foreach(var (id,kind,at) in spots)
            if(StandNear(home,at,7) is {} stand)
                brain!.Foods.Add(new(id,kind,at,stand,kind is "fish" or "meat"?3:1));
    }
    private void Save()
    {
        if(brain==null)return;saved=host.Context.Now;
        host.Context.SetWorld("antigoon",new JsonObject{["x"]=brain.Position.X,["z"]=brain.Position.Z,["hx"]=brain.Home.X,["hz"]=brain.Home.Z,["health"]=brain.Health});
    }
    private JsonObject View(int player)
    {
        var v=new JsonObject{["active"]=developmentEnabled&&brain!=null&&brain.State!="hidden",["night"]=Night,["multiplayer"]=host.MultiplayerEnabled(),["development_only"]=true,["server_ms"]=host.Context.Now};
        v["development_spawn"]=developmentEnabled&&brain!=null;
        if(brain!=null){v["x"]=brain.Position.X;v["y"]=Ground(brain.Position)+brain.Lift;v["z"]=brain.Position.Z;v["yaw"]=brain.Yaw;v["health"]=brain.Health;v["state"]=brain.State;v["state_time"]=brain.StateTime;v["attack_serial"]=brain.AttackSerial;v["target"]=brain.Target;v["kicked"]=brain.Kicks.GetValueOrDefault(player);
            v["held"]=brain.Held;v["you"]=player;
            v["meal"]=brain.Meal;v["prey"]=brain.Prey;
            v["eaten"]=new JsonArray(brain.Eaten.Select(id=>(JsonNode)JsonValue.Create(id)!).ToArray());
            if(brain.LastThrow is {} t)v["throw"]=new JsonObject{["serial"]=t.Serial,["victim"]=t.Victim,["fx"]=t.From.X,["fz"]=t.From.Z,["tx"]=t.To.X,["tz"]=t.To.Z,["wall"]=t.Wall};}
        EventView(v);
        return v;
    }
}
