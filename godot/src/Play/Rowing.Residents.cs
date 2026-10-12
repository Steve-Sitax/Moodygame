using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.Movers;
using Scheldemist.Net.Mp;
using Scheldemist.People;
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.Play;

public partial class Rowing
{
    private sealed class ResidentHull
    {
        public string Id="",Kind="rowboat";public Drawn Hull=null!;
        public JourneyRules.Point[] Path=Array.Empty<JourneyRules.Point>();public int Point;
        public float Phase,Wait;public bool Done,Near;public double Pace=1.35;
        public readonly List<(string Id,string Kind,Human Human,Node3D Frame)> Crew=new();
        public readonly List<Node3D> Cargo=new();
    }
    private readonly Dictionary<string,ResidentHull> residentHulls=new();
    private readonly Dictionary<string,Vector3> residentHomes=new();
    private readonly Dictionary<string,double> residentPending=new();
    public bool ResidentRemote;
    public Action<string,JsonArray>? ResidentCommand;
    public bool ResidentWaterFree(float x,float z)
    {
        const float r=1.05f;
        if(!Water.In(x,z)||!Water.In(x+r,z)||!Water.In(x-r,z)||!Water.In(x,z+r)||!Water.In(x,z-r)||x>100-r&&x<120+r&&z>-6-r&&z<48+r)return false;
        float bed=Boats.BedAt(x,z);if(float.IsFinite(bed)&&Water.Level(x,z)-bed<.6f)return false;
        if(!Boats.I.PlayerWaterFree(x,z,r))return false;
        foreach(var b in Bridges.I.List){var rect=b.Rect;if(x>rect.MinX-1.5f&&x<rect.MaxX+1.5f&&z>rect.MinZ-1.5f&&z<rect.MaxZ+1.5f)return false;}
        return true;
    }
    public void ResidentBoatOut(string id,string kind,JourneyRules.Point[] path,(string Id,string Kind)[] crew,int sacks,bool returning=false)
    {
        if(kind is not("rowboat" or "punt")||path.Length==0||path.Length>512)return;
        if(ResidentRemote){residentPending[id]=MoverClock.T+5;ResidentCommand?.Invoke("town_boat_out",new JsonArray(id,new JsonObject{["kind"]=kind,["_path"]=new JsonArray(path.Select(p=>(JsonNode)new JsonArray(p.X,p.Z)).ToArray()),["crew"]=new JsonArray(crew.Take(3).Select(p=>(JsonNode)new JsonObject{["id"]=p.Id,["kind"]=p.Kind}).ToArray()),["sacks"]=Math.Clamp(sacks,0,12),["returning"]=returning}));}
        ResidentBoatStart(id,kind,path,crew,sacks,returning);
    }
    private void ResidentBoatStart(string id,string kind,JourneyRules.Point[] path,(string Id,string Kind)[] crew,int sacks,bool returning)
    {
        DropResidentHull(id);string key="town:"+id;Vector3? previous=returning&&Drawings.TryGetValue(key,out var old)?new(old.X,old.Z,old.Yaw):null;
        if(Drawings.TryGetValue(key,out var existing)){existing.Root.QueueFree();Drawings.Remove(key);}
        var first=path[0];var next=path.Length>1?path[1]:new(first.X,first.Z+1);float yaw=(float)Math.Atan2(next.X-first.X,next.Z-first.Z);
        float x=previous?.X??(float)first.X,z=previous?.Y??(float)first.Z;if(previous is {} p)yaw=p.Z;
        var hull=Make(key,kind,x,z,yaw);hull.Oars.Visible=true;
        var boat=new ResidentHull{Id=id,Kind=kind,Hull=hull,Path=path};residentHulls[id]=boat;
        var source=ResidentJourneys.I?.Transport?.Vehicles.FirstOrDefault(v=>v.Id==id);if(source?.Home.Length>=3)residentHomes[id]=new((float)source.Home[0],(float)source.Home[1],(float)source.Home[2]);
        for(int i=0;i<Math.Min(3,crew.Length);i++){var h=Humans.Make(crew[i].Kind);if(h==null)continue;var frame=new Node3D{Name="crew_"+crew[i].Id};frame.AddChild(h.Root);hull.Root.AddChild(frame);h.Start();bool row=i==0;frame.Position=new(0,hull.Hull.SeatY+h.SitDrop(0)+.02f,row?hull.Hull.SeatZ:i==1?hull.Hull.SeatZ+1.4f:hull.Hull.SeatZ-1.25f);frame.Rotation=new(0,row||i==1?MathF.PI:0,0);h.Play(row?"row":h.CanSit?"sit":"idle",0);boat.Crew.Add((crew[i].Id,crew[i].Kind,h,frame));}
        for(int i=0;i<Math.Clamp(sacks,0,12);i++){var sack=Carried.Sack(.42f,.2f,.3f);if(sack==null)continue;sack.Position=new(i%2==1?.2f:-.2f,.42f,hull.Hull.SeatZ-.8f-i/2*.42f);sack.Rotation=new(0,i*.7f,0);hull.Root.AddChild(sack);boat.Cargo.Add(sack);}
        if(residentHomes.TryGetValue(id,out var home))Boats.I.PlayerHideSmall(home.X,home.Y,true);
    }
    public (Vector2 At,bool Done)? ResidentBoatStep(string id,double dt,bool near,double pace)
    {if(!residentHulls.TryGetValue(id,out var b))return null;b.Near=near;b.Pace=pace;return(new(b.Hull.X,b.Hull.Z),b.Done);}
    private void StepResidentBoat(ResidentHull b,double dt)
    {
        var d=b.Hull;if(b.Point>=b.Path.Length){b.Done=true;return;}var target=b.Path[b.Point];double dx=target.X-d.X,dz=target.Z-d.Z,distance=Math.Sqrt(dx*dx+dz*dz);
        if(distance<.8){b.Point++;b.Done=b.Point>=b.Path.Length;return;}
        double want=Math.Atan2(dx,dz),turn=Math.Atan2(Math.Sin(want-d.Yaw),Math.Cos(want-d.Yaw));d.Yaw+=(float)Math.Clamp(turn,-.9*dt,.9*dt);
        double step=Math.Min(distance,b.Pace*dt*(.35+.65*Math.Max(0,Math.Cos(turn))));float nx=d.X+(float)(Math.Sin(d.Yaw)*step),nz=d.Z+(float)(Math.Cos(d.Yaw)*step);
        bool ahead=!b.Near||Boats.I.PlayerWaterFree(nx+MathF.Sin(d.Yaw)*2.2f,nz+MathF.Cos(d.Yaw)*2.2f,.6f);
        if(ahead){d.X=nx;d.Z=nz;b.Wait=0;}else b.Wait+=(float)dt;b.Phase=(b.Phase+(float)dt/2)%1;PoseResidentBoat(b,dt,ahead?b.Phase:-1);
    }
    private void PoseResidentBoat(ResidentHull b,double dt,float phase)
    {
        var d=b.Hull;var eye=Main.I.Cam.GlobalPosition;bool shown=new Vector2(d.X-eye.X,d.Z-eye.Z).Length()<90;d.Root.Visible=shown;
        d.Root.Position=new(d.X,Water.Level(d.X,d.Z),d.Z);d.Root.Rotation=new(0,d.Yaw,MathF.Sin((float)MoverClock.T*1.3f+d.X)*.02f);
        if(!shown)return;for(int i=0;i<b.Crew.Count;i++){if(i==0)b.Crew[i].Human.SetPhase("row",phase<0?.7f:phase);b.Crew[i].Human.Update((float)dt);}
        float mid=Out-Blade/2,dipIn=MathF.Asin(Math.Min(.95f,(d.Hull.Pin.Y+.06f)/mid)),dipOut=MathF.Asin(Math.Min(.95f,Math.Max(0,d.Hull.Pin.Y-.22f)/mid)),th=0,dp=dipOut+.04f,fe=0;
        if(phase>=0&&phase<.42f){float u=Mathf.SmoothStep(0,1,phase/.42f);th=.55f-u;dp=dipIn;}else if(phase>=.42f){float u=(phase-.42f)/.58f;th=-.45f+Mathf.SmoothStep(0,1,u);dp=dipOut;fe=MathF.Sin(MathF.PI*Math.Min(1,u*1.15f))*MathF.PI/2*.95f;}
        for(int i=0;i<2;i++){d.Pivot[i].Rotation=new(0,i==0?-th:th,0);d.Dip[i].Rotation=new(0,0,-dp);d.Feather[i].Rotation=new(i==0?fe:-fe,0,0);}
    }
    public void ResidentBoatEnd(string id,Vector3? at,bool home)
    {
        if(ResidentRemote)ResidentCommand?.Invoke("town_boat_end",new JsonArray(id,at is Vector3 p?new JsonArray(p.X,p.Y,p.Z):null,home));
        ResidentBoatEndNow(id,at,home);
    }
    private void ResidentBoatEndNow(string id,Vector3? at,bool home)
    {
        residentPending.Remove(id);
        DropResidentHull(id);string key="town:"+id;if(!Drawings.TryGetValue(key,out var d))return;
        d.Oars.Visible=false;if(at is Vector3 p&&!home){d.X=p.X;d.Z=p.Y;d.Yaw=p.Z;d.Root.Visible=true;}else{d.Root.QueueFree();Drawings.Remove(key);}
        if(home&&residentHomes.Remove(id,out var mooring))Boats.I.PlayerHideSmall(mooring.X,mooring.Y,false);
    }
    private void DropResidentHull(string id){if(!residentHulls.Remove(id,out var b))return;foreach(var q in b.Crew){q.Human.Dispose();q.Frame.QueueFree();}foreach(var item in b.Cargo)item.QueueFree();}
    private void ClearResidentBoats(){foreach(string id in residentHulls.Keys.ToArray())DropResidentHull(id);residentHomes.Clear();residentPending.Clear();}
    private void UpdateResidentBoats(double dt){foreach(var b in residentHulls.Values){if(!ResidentRemote&&!b.Done)StepResidentBoat(b,dt);else PoseResidentBoat(b,dt,b.Phase);}foreach(var home in residentHomes.Values)Boats.I.PlayerHideSmall(home.X,home.Y,true);}
    public JsonObject ResidentNetState()=>new(){
        ["boats"]=new JsonArray(residentHulls.Values.Select(b=>(JsonNode)new JsonObject{["id"]=b.Id,["kind"]=b.Kind,["x"]=b.Hull.X,["z"]=b.Hull.Z,["yaw"]=b.Hull.Yaw,["_point"]=b.Point,["phase"]=b.Phase,["_done"]=b.Done,["_pace"]=b.Pace,["_near"]=b.Near,["_path"]=new JsonArray(b.Path.Select(p=>(JsonNode)new JsonArray(p.X,p.Z)).ToArray()),["_crew"]=new JsonArray(b.Crew.Select(q=>(JsonNode)new JsonObject{["id"]=q.Id,["kind"]=q.Kind}).ToArray()),["_sacks"]=b.Cargo.Count}).ToArray()),
        ["lying"]=new JsonArray(Drawings.Values.Where(d=>d.Key.StartsWith("town:",StringComparison.Ordinal)&&!residentHulls.ContainsKey(d.Key[5..])).Select(d=>(JsonNode)new JsonObject{["id"]=d.Key[5..],["kind"]=d.Kind,["x"]=d.X,["z"]=d.Z,["yaw"]=d.Yaw}).ToArray()),
        ["_homes"]=new JsonArray(residentHomes.Select(h=>(JsonNode)new JsonObject{["id"]=h.Key,["x"]=h.Value.X,["z"]=h.Value.Y,["yaw"]=h.Value.Z}).ToArray())};
    public void ResidentNetApply(JsonObject state,double dt)
    {
        var rows=NativeWorldFields.A(state["boats"]).OfType<JsonObject>().Take(20).ToArray();var lying=NativeWorldFields.A(state["lying"]).OfType<JsonObject>().Take(20).ToArray();var wanted=rows.Concat(lying).Select(r=>NativeWorldFields.S(r,"id")).ToHashSet(StringComparer.Ordinal);foreach(string key in Drawings.Keys.Where(k=>k.StartsWith("town:",StringComparison.Ordinal)).ToArray()){string id=key[5..];if(!wanted.Contains(id)&&residentPending.GetValueOrDefault(id)<MoverClock.T)ResidentBoatEndNow(id,null,true);}
        foreach(var row in rows){string id=NativeWorldFields.S(row,"id"),kind=NativeWorldFields.S(row,"kind");if(id.Length>64||kind is not("rowboat" or "punt"))continue;
            residentPending.Remove(id);
            if(!residentHulls.TryGetValue(id,out var b)){var path=NativeWorldFields.A(row["_path"]).OfType<JsonArray>().Take(512).Where(p=>p.Count==2).Select(p=>new JourneyRules.Point(Number(p[0]),Number(p[1]))).ToArray();if(path.Length==0)continue;var crew=NativeWorldFields.A(row["_crew"]).OfType<JsonObject>().Take(3).Select(q=>(NativeWorldFields.S(q,"id"),NativeWorldFields.S(q,"kind"))).Where(q=>Humans.IsKind(q.Item2)).ToArray();ResidentBoatStart(id,kind,path,crew,(int)NativeWorldFields.N(row,"_sacks"),false);b=residentHulls[id];}
            b.Hull.X=(float)NativeWorldFields.N(row,"x");b.Hull.Z=(float)NativeWorldFields.N(row,"z");b.Hull.Yaw=(float)NativeWorldFields.N(row,"yaw");b.Point=(int)NativeWorldFields.N(row,"_point");b.Phase=(float)NativeWorldFields.N(row,"phase");b.Done=NativeWorldFields.B(row,"_done");b.Pace=NativeWorldFields.N(row,"_pace",1.35);b.Near=NativeWorldFields.B(row,"_near");PoseResidentBoat(b,dt,b.Phase);
        }
        foreach(var row in lying){string id=NativeWorldFields.S(row,"id"),kind=NativeWorldFields.S(row,"kind");if(id.Length==0||id.Length>64||kind is not("rowboat" or "punt"))continue;float x=(float)NativeWorldFields.N(row,"x"),z=(float)NativeWorldFields.N(row,"z"),yaw=(float)NativeWorldFields.N(row,"yaw");if(!float.IsFinite(x)||!float.IsFinite(z)||!float.IsFinite(yaw))continue;residentPending.Remove(id);DropResidentHull(id);string key="town:"+id;if(Drawings.TryGetValue(key,out var hull)&&hull.Kind!=kind){hull.Root.QueueFree();Drawings.Remove(key);hull=null;}hull??=Make(key,kind,x,z,yaw);hull.X=x;hull.Z=z;hull.Yaw=yaw;hull.Oars.Visible=false;}
        var homes=NativeWorldFields.A(state["_homes"]).OfType<JsonObject>().Take(40).ToArray();var homeIds=homes.Select(h=>NativeWorldFields.S(h,"id")).ToHashSet(StringComparer.Ordinal);
        foreach(string id in residentHomes.Keys.ToArray())if(!homeIds.Contains(id)&&residentPending.GetValueOrDefault(id)<MoverClock.T){var home=residentHomes[id];Boats.I.PlayerHideSmall(home.X,home.Y,false);residentHomes.Remove(id);}
        foreach(var home in homes){string id=NativeWorldFields.S(home,"id");if(id.Length==0||id.Length>64)continue;residentHomes[id]=new((float)NativeWorldFields.N(home,"x"),(float)NativeWorldFields.N(home,"z"),(float)NativeWorldFields.N(home,"yaw"));}
    }
    private static double Number(JsonNode? node)=>NativeWorldFields.N(new JsonObject{["n"]=node?.DeepClone()},"n");
    public void ResidentAsked(string what,JsonArray args,int from)
    {
        if(ResidentRemote||args.Count<2||args[0] is not JsonValue v||!v.TryGetValue<string>(out var id))return;
        var vehicle=ResidentJourneys.I?.Transport?.Vehicles.FirstOrDefault(q=>q.Id==id&&q.Kind=="boat"&&!q.Gone);if(vehicle?.Boat==null||NativeStreet.I?.OwnerOf(vehicle.Owner) is int owner&&owner>0&&owner!=from)return;
        if(what=="town_boat_end"){Vector3? at=args[1] is JsonArray p&&p.Count==3?new((float)Number(p[0]),(float)Number(p[1]),(float)Number(p[2])):null;bool home=args.Count>2&&args[2] is JsonValue hv&&hv.TryGetValue<bool>(out bool flag)&&flag;ResidentBoatEndNow(id,at,home);return;}
        if(what!="town_boat_out"||args[1] is not JsonObject spec)return;
        var path=NativeWorldFields.A(spec["_path"]).OfType<JsonArray>().Take(512).Where(p=>p.Count==2).Select(p=>new JourneyRules.Point(Number(p[0]),Number(p[1]))).ToArray();if(path.Length<1||path.Any(p=>!double.IsFinite(p.X)||!double.IsFinite(p.Z)||p.X is <-1000 or >1000||p.Z is <-1000 or >1000))return;
        var crew=NativeWorldFields.A(spec["crew"]).OfType<JsonObject>().Take(3).Select(q=>(NativeWorldFields.S(q,"id"),NativeWorldFields.S(q,"kind"))).Where(q=>Humans.IsKind(q.Item2)&&ResidentJourneys.I!.Transport!.Errands.Any(e=>e.Vehicle==id&&e.Who.Contains(q.Item1))).ToArray();
        if(crew.Length==0||crew[0].Item1!=vehicle.Owner)return;ResidentBoatStart(id,vehicle.Boat.Kind,path,crew,Math.Clamp((int)NativeWorldFields.N(spec,"sacks"),0,12),NativeWorldFields.B(spec,"returning"));
    }
}

