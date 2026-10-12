using System;
using System.Linq;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.People;
using Scheldemist.Net.Mp;

namespace Scheldemist.Movers;

public partial class Omnibus
{
    public bool NetRemote {get;set;}
    public Action<string,JsonArray>? NetAsk;
    private static readonly string[] BusNetworkFields={"NextI","S","V","DwellT","RollR","RollF","Gait","BlockT","BackM","DepartAt","WaitWhy"};
    private static JsonObject Point(Vector3 p)=>new(){["x"]=p.X,["y"]=p.Y,["z"]=p.Z};
    private static Vector3 Point(JsonNode? p)=>new((float)NativeWorldFields.N(p,"x"),(float)NativeWorldFields.N(p,"y"),(float)NativeWorldFields.N(p,"z"));
    public JsonObject NetState()=>new(){
        ["b"]=new JsonArray(buses.Select(b=>{var row=NativeWorldFields.Read(b,BusNetworkFields);row["id"]=b.Index;row["at"]=b.At?.Id;row["_held"]=PlayerHeld(b);row["_people"]=new JsonArray(Passengers(b).Select(p=>{var q=NativeWorldFields.Read(p,"Id","Alight","State","Seat","Walked");q["kind"]=p.Human.Kind;q["p"]=Point(p.Root.Position);q["yaw"]=p.Root.Rotation.Y;q["_path"]=new JsonArray(p.Path.Select(v=>(JsonNode)new JsonArray(v.X,v.Y)).ToArray());return(JsonNode)q;}).ToArray());return(JsonNode)row;}).ToArray()),
        ["_slots"]=new JsonArray(lastSlot.Select(p=>(JsonNode)new JsonArray(p.Key,p.Value)).ToArray()),["_nextWaiter"]=nextWaiter,["_waitersT"]=waitersT,
        ["_waiters"]=new JsonArray(waiters.Select(w=>(JsonNode)new JsonObject{["id"]=w.Id,["_post"]=Array.IndexOf(Posts,w.Post),["_bus"]=w.Bus?.Index??-1,["kind"]=w.Human.Kind,["t"]=w.T,["p"]=Point(w.Root.Position),["yaw"]=w.Root.Rotation.Y}).ToArray())};
    public void NetApply(JsonObject value,double dt){
        if(buses.Count==0)return;
        foreach(var entry in NativeWorldFields.A(value["_slots"]).OfType<JsonArray>())if(entry.Count>=2&&entry[0] is JsonValue v&&v.TryGetValue<string>(out var id))lastSlot[id]=NativeWorldFields.N(new JsonObject{["v"]=entry[1]?.DeepClone()},"v");
        foreach(var row in NativeWorldFields.A(value["b"]).OfType<JsonObject>()){
            var bus=buses.FirstOrDefault(b=>b.Index==NativeWorldFields.N(row,"id",-1));if(bus==null)continue;NativeWorldFields.Apply(bus,row,BusNetworkFields);bus.NextI=Math.Clamp(bus.NextI,0,bus.StopAt.Count-1);bus.At=bus.StopAt.Select(s=>s.Stop).FirstOrDefault(s=>s.Id==NativeWorldFields.S(row,"at"));if(NativeWorldFields.B(row,"_held"))playerHeld.Add(bus);else playerHeld.Remove(bus);
            if(!passengers.TryGetValue(bus,out var list))passengers[bus]=list=new();var wanted=NativeWorldFields.A(row["_people"]).OfType<JsonObject>().Take(14).ToArray();
            foreach(var p in list.ToArray())if(!wanted.Any(q=>NativeWorldFields.S(q,"id")==p.Id)){var foot=bus.Frame.GlobalTransform*new Vector3(.15f,0,-2.35f);if(p.Alight.Length>0)ResidentOff?.Invoke(bus,p.Id,foot);p.Human.Dispose();p.Root.QueueFree();list.Remove(p);}
            foreach(var q in wanted){string person=NativeWorldFields.S(q,"id"),kind=NativeWorldFields.S(q,"kind");if(person.Length==0||person.Length>64||!Humans.IsKind(kind))continue;var p=list.FirstOrDefault(p=>p.Id==person);if(p!=null&&p.Human.Kind!=kind){p.Human.Dispose();p.Root.QueueFree();list.Remove(p);p=null;}
                if(p==null){var human=Humans.Make(kind);if(human==null)continue;var root=new Node3D{Name="passenger"};bus.Frame.AddChild(root);root.AddChild(human.Root);human.Start();if(kind=="carter")Carters.HideBakedCart(human);p=new Passenger{Id=person,Human=human,Root=root};list.Add(p);}
                NativeWorldFields.Apply(p,q,"Alight","State","Seat","Walked");p.Root.Position=Point(q["p"]);p.Root.Rotation=new Vector3(0,(float)NativeWorldFields.N(q,"yaw"),0);p.Path=NativeWorldFields.A(q["_path"]).OfType<JsonArray>().Where(a=>a.Count>=2).Select(a=>new Vector2((float)NativeWorldFields.N(new JsonObject{["v"]=a[0]!.DeepClone()},"v"),(float)NativeWorldFields.N(new JsonObject{["v"]=a[1]!.DeepClone()},"v"))).ToArray();if(p.Path.Length==0)p.Path=SeatPath(Math.Clamp(p.Seat,0,11));p.Human.Play(p.State=="seated"?(p.Seat>=0?"sit":"idle"):"walk",.2f);p.Human.SetPace(1.1f);
            }
            Place(bus,0);
        }
        int restoredNextWaiter=(int)NativeWorldFields.N(value,"_nextWaiter",nextWaiter);waitersT=(float)NativeWorldFields.N(value,"_waitersT",waitersT);
        var waits=NativeWorldFields.A(value["_waiters"]).OfType<JsonObject>().Take(64).ToArray();foreach(var w in waiters.ToArray())if(!waits.Any(q=>NativeWorldFields.N(q,"id",-1)==w.Id))Drop(w);
        foreach(var q in waits){int id=(int)NativeWorldFields.N(q,"id",-1),post=(int)NativeWorldFields.N(q,"_post",-1);string kind=NativeWorldFields.S(q,"kind");if(id<0||post<0||post>=Posts.Length||!Humans.IsKind(kind))continue;var w=waiters.FirstOrDefault(w=>w.Id==id);if(w!=null&&(w.Human.Kind!=kind||w.Post!=Posts[post])){Drop(w);w=null;}if(w==null){int before=waiters.Count;AddWaiter(Posts[post],0,kind);if(waiters.Count==before)continue;w=waiters[^1];w.Id=id;}w.Bus=buses.FirstOrDefault(b=>b.Index==NativeWorldFields.N(q,"_bus",-1));w.T=(float)NativeWorldFields.N(q,"t");w.Root.Position=Point(q["p"]);w.Root.Rotation=new(0,(float)NativeWorldFields.N(q,"yaw"),0);w.Human.Play(w.Bus==null?(w.Root.Position.Y>.1f?"sit":"idle"):"walk",.2f);w.Human.SetPace(1.1f);}
        nextWaiter=Math.Max(restoredNextWaiter,waiters.Count==0?0:waiters.Max(w=>w.Id)+1);
    }
    private void NetAnimatePeople(Bus bus,float dt){foreach(var p in Passengers(bus))if(bus.Near)p.Human.Update(dt);}
    private void NetAnimateWaiters(float dt){foreach(var w in waiters)w.Human.Update(dt);}
    public JsonNode? NetLerp(JsonNode a,JsonNode b,double u){var result=NativeWorldInterpolation.Lerp(a,b,u)!.AsObject();foreach(var row in NativeWorldFields.A(result["b"]).OfType<JsonObject>()){int id=(int)NativeWorldFields.N(row,"id",-1);var bus=buses.FirstOrDefault(b=>b.Index==id);var old=NativeWorldFields.A(a["b"]).FirstOrDefault(x=>NativeWorldFields.N(x,"id",-1)==id);var next=NativeWorldFields.A(b["b"]).FirstOrDefault(x=>NativeWorldFields.N(x,"id",-1)==id);if(bus==null||old==null||next==null)continue;double s0=NativeWorldFields.N(old,"s"),s1=NativeWorldFields.N(next,"s"),diff=s1-s0,length=bus.Loop.Length;if(diff>length/2)diff-=length;if(diff< -length/2)diff+=length;row["s"]=bus.Loop.Wrap((float)(s0+diff*u));}return result;}
    public void NetBoard(int index,string id,string kind,string alight){var bus=buses.FirstOrDefault(b=>b.Index==index);if(bus==null||NetRemote||!bus.StopAt.Any(s=>s.Stop.Id==alight)||!Humans.IsKind(kind)||id.Length>40)return;BoardResident(bus,id,kind,alight);}
}

