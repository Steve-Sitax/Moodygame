using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using Godot;
using Scheldemist.Game;
using Scheldemist.People;
using Scheldemist.Play;
using Scheldemist.Town;
using Scheldemist.World;
using Scheldemist.Movers;
namespace Scheldemist.Audio;

/// <summary>main.ts producer hooks: reuse live positions, exact room floors, and the street's own puddle mask.</summary>
[GamePart(365)]
public partial class LifeSound : Node
{
    public static LifeSound? I { get; private set; }
    private Soundscape? sound;
    private Townspeople? town;
    private readonly List<VehicleSound> vehicles = new(48);
    private readonly List<MovingShip> ships = new(48);
    private readonly Dictionary<int, MovingShip> riverSounds = new();
    private readonly Dictionary<string, double> worked=new();
    private readonly Dictionary<string, double> cried = new();
    private readonly List<(string id, float x, float z, float y, float c, float s, float minX, float maxX, float minZ, float maxZ)> counters = new();
    private readonly Dictionary<string, float> groundPuddles = new();
    private double poll;
    private readonly Dictionary<string, Vector2> cartPositions = new();
    private bool CartRolling(Handcarts.Drawn d)
    {
        var p = new Vector2(d.X,d.Z); bool moved = cartPositions.TryGetValue(d.Info.Id,out var old) && p.DistanceSquaredTo(old)>.0001f;
        cartPositions[d.Info.Id]=p; return moved;
    }
    public int VehicleCount => vehicles.Count;
    public int ShipCount => ships.Count;
    public int WorkStarts { get; private set; }
    public int CryStarts { get; private set; }
    public override void _Ready()
    {
        I = this; sound = Soundscape.I; town = Main.I.GetNodeOrNull<Townspeople>("Townspeople");
        if (sound == null) { SetProcess(false); return; }
        using var data = JsonDocument.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://assets/places.json")));
        foreach (var e in data.RootElement.GetProperty("counters").EnumerateArray())
        {
            var o = e.GetProperty("origin"); var b = e.GetProperty("rect"); float a = e.GetProperty("yaw").GetSingle();
            counters.Add((e.GetProperty("id").GetString()!,o.GetProperty("x").GetSingle(),o.GetProperty("z").GetSingle(),e.GetProperty("floor_y").GetSingle(),MathF.Cos(a),MathF.Sin(a),b.GetProperty("minX").GetSingle(),b.GetProperty("maxX").GetSingle(),b.GetProperty("minZ").GetSingle(),b.GetProperty("maxZ").GetSingle()));
        }
        foreach (var node in BakedWorld.All(Main.I.World)) if (node is MeshInstance3D mesh && mesh.Mesh != null)
        {
            for (int i=0;i<mesh.Mesh.GetSurfaceCount();i++) if ((mesh.GetSurfaceOverrideMaterial(i) ?? mesh.Mesh.SurfaceGetMaterial(i)) is ShaderMaterial m && m.GetShaderParameter("puddles").VariantType == Variant.Type.Float) { groundPuddles[mesh.Name.ToString()] = m.GetShaderParameter("puddles").AsSingle(); break; }
        }
        sound.InteriorAt = Interior; sound.PuddleAt = Puddle;
        if (Events.I != null) sound.TempestNow = Tempest;
        // These new producer callbacks are ready before the first audible footstep.
        if(Player.Jef.I is {} j){_=Puddle(new(j.X,j.Y,j.Z));_=Rooms.I?.SoundRoomAt(new(j.X,j.Y,j.Z));}
    }
    public string? Interior(Vector3 p)
    {
        if (HomeLife.I != null) foreach (var home in HomeLife.I.Frames.Values)
        { var q = home.Local(p.X,p.Z); if (Math.Abs(p.Y-home.Y)<.6 && Math.Abs(q.X)<home.W/2 && q.Y>0 && q.Y<home.D) return "home"; }
        foreach (var r in counters)
        {
            if (Math.Abs(p.Y-r.y)>.6) continue; float dx=p.X-r.x,dz=p.Z-r.z,x=dx*r.c-dz*r.s,z=dx*r.s+dz*r.c;
            if (x>r.minX&&x<r.maxX&&z>r.minZ&&z<r.maxZ) return r.id.StartsWith("tavern:") ? "tavern" : r.id=="poesje"?"cellar":"shop";
        }
        if (LandmarkLife.I?.RoomAt(p) is { } hall) return hall=="cathedral"?"church":hall=="steen"?"vault":hall=="vleeshuis"?"museum":hall=="oostershuis"?"store":"hall";
        return Rooms.I?.SoundRoomAt(p) is { } room ? room.Kind is "tavern" or "shop" or "home" ? room.Kind : room.Id.Contains("church")||room.Id.Contains("cathedral")||room.Id.Contains("carolus")?"church":"hall" : null;
    }
    public double Puddle(Vector3 p)
    {
        string ground = Solid.I?.NameAt(p + Vector3.Up * .15f,p - Vector3.Up * .4f) ?? "";
        return Puddles.At(p.X,p.Z,Daylight.I?.Puddle ?? 0,groundPuddles.GetValueOrDefault(ground,1.1f));
    }
    public (double level,double gust,double shelter) Tempest()
    {
        double level = GameState.I.Weather=="storm" ? Events.I?.StormLevel ?? 0 : 0;
        var j=Player.Jef.I;
        double t = Net.Mp.Together.I is { On: true } together ? together.ServerNow / 1000 : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0;
        double gust = j == null ? 0 : StormGusts.At(t,GameState.I.Weather,level,j.X,j.Z);
        int walls=0;
        if (level>0 && j!=null && town?.Walk is { } walk) for(int k=0;k<8;k++) for(int r=0;r<2;r++)
        { double distance = r==0?1.2:2.6; if(Ways.Flags(j.X+Math.Cos(k*Math.PI/4)*distance,j.Z+Math.Sin(k*Math.PI/4)*distance)==1) walls++; }
        return(level,gust,Math.Min(1,walls/6.0));
    }
    public override void _Process(double delta)
    {
        if (sound==null || !sound.Prepared || town?.Paused==true || Main.I.Arg("soundtest")!="") return;
        if ((poll-=delta)>0) return; poll=.25;
        RoomPeople(); Trades(); HorseSnorts(); Gale(.25);
    }
    public void CollectVehicles()
    {
        vehicles.Clear();
        if (Traffic.I is { } traffic) for(int i=0;i<traffic.Vehicles.Count;i++) { var v=traffic.Vehicles[i]; vehicles.Add(new(v.Kind,v.At.X,v.At.Y,Math.Abs(v.V)>.03?"go":"wait")); }
        if (Omnibus.I is { } bus) for(int i=0;i<bus.Buses.Count;i++) { var b=bus.Buses[i]; vehicles.Add(new("dray",b.Pa.X,b.Pa.Y,Math.Abs(b.V)>.03?"go":"wait")); }
        if (Railway.I is { Running:true } rail && rail.State!="shed") { var p=rail.HeadAt; vehicles.Add(new("dray",p.X,p.Z,rail.Speed>.03?"go":"wait")); }
        if (Handcarts.I is { } carts) foreach(var d in carts.Drawings.Values) vehicles.Add(new("handcart",d.X,d.Z,carts.Held==d.Info.Id && CartRolling(d)?"go":"wait"));
        if (Velocipedes.I is { Ridden:not null } velo) { var p=velo.Ridden.Root.GlobalPosition; vehicles.Add(new("handcart",p.X,p.Z,Math.Abs(velo.Speed)>.03?"go":"wait")); }
    }
    public void CollectShips()
    {
        ships.Clear();
        if (River.I is not { } river) return;
        foreach(var m in river.Movers)
        {
            if (!riverSounds.TryGetValue(m.Id,out var s)) riverSounds[m.Id]=s=new MovingShip { Id="river:"+m.Id };
            s.Kind=m.Parts.Count>0?m.Parts[0].Boat.Kind:"";s.X=m.X;s.Z=m.Z;s.Heading=m.Yaw;s.Speed=m.V;s.Steam=Boats.IsSteam(s.Kind);s.Anchored=m.V<.01;ships.Add(s);
        }
        Bridges.I?.FillSoundShips(ships); Lock.I?.FillSoundShips(ships);
    }
    private void RoomPeople()
    {
        var j=Player.Jef.I;if(j==null)return;
        int? count=null; string? place=null;
        foreach(var r in counters)
        { float dx=j.X-r.x,dz=j.Z-r.z,x=dx*r.c-dz*r.s,z=dx*r.s+dz*r.c; if(Math.Abs(j.Y-r.y)<.6&&x>r.minX&&x<r.maxX&&z>r.minZ&&z<r.maxZ){place=r.id;break;} }
        if(town?.Indoors!=null) foreach(var house in town.Indoors.Houses) if(house.Id==place){count=house.Figures.Count;break;}
        if(LandmarkLife.I?.Here is { } id && HallPeople.I is { } halls) foreach(var hall in halls.Halls) if(hall.Id==id){count=hall.Figures.Count;break;}
        if(Interior(new(j.X,j.Y,j.Z))=="home")count=HomeVisitors.I?.Drawn??0;
        sound!.SetPlacePeople(place,count??0);sound.SetRoomPeople(count);
    }
    private void Trades()
    {
        if(town==null)return;
        foreach(var s in town.Simulations)
        {
            if(s.P is not { Shown:true } p || s.Inside || s.ActionHeld || town.Crowd!.PuppetBusy(p))continue;
            if(Whereabouts.Hypot(p.X-sound!.Ear.X,p.Z-sound.Ear.Z)>40)continue;
            if(s.Goal.Motion=="scrub"&&worked.GetValueOrDefault(s.R.Id)<=Time.GetTicksMsec()/1000.0){worked[s.R.Id]=Time.GetTicksMsec()/1000.0+2.4;sound.StreetWork("scrub",p.X,p.Z,2.4);WorkStarts++;}
            if(s.Goal.Mode!="patrol"||s.R.Work.Kind!="round"||!Cries.All.TryGetValue(s.R.Trade,out var cry))continue;
            double stamp=Time.GetTicksMsec()/1000.0;
            if(cried.GetValueOrDefault(s.R.Id)>stamp)continue;cried[s.R.Id]=stamp+18+Whereabouts.HashId(s.R.Id)%15;
            sound.Sing(p.X,p.Z,new(s.R.Sex,s.R.Age),cry.Notes,cry.Beat);CryStarts++;
            if(s.R.Trade=="ragman")sound.EventSound("handbell",p.X,p.Z,3);
            Talks.Bubbles.I?.Say(null,s.R.First,cry.Words,s.R.Id);
            string? work=s.R.Trade=="grinder"?"grind":s.R.Trade=="mussel_seller"?"rattle":s.R.Trade=="milk_woman"?"clink":null;
            if(work!=null){sound.StreetWork(work,p.X,p.Z,work=="grind"?2.4:work=="rattle"?1.2:1);WorkStarts++;}
        }
    }
    private readonly Dictionary<ulong,double> horseNext=new();
    private readonly Random horseDice=new();
    private void HorseSnort(Node3D body,float side=0,ulong variant=0)
    {
        var head=body.GlobalTransform*new Vector3(side,1.68f,1.56f);if(head.DistanceTo(sound!.Ear)>25)return;
        ulong id=body.GetInstanceId()*2+variant;double now=Time.GetTicksMsec()/1000.0;
        if(!horseNext.TryGetValue(id,out double next)){horseNext[id]=now+horseDice.NextDouble()*3;return;}
        if(now<next)return;horseNext[id]=now+2.6+horseDice.NextDouble()*1.6;
        if(head.DistanceTo(sound.Ear)<12&&horseDice.NextDouble()<.12)LifeAnimalSounds.Snort(head);
    }
    private void HorseSnorts()
    {
        double hour=GameState.I.HourF,age=(hour-20+24)%24,early=age<13.5?Math.Clamp(Math.Min(age,13.5-age)/2,0,1):0;
        double cold=early*(GameState.I.Weather=="clear"?1:GameState.I.Weather is "fog" or "mist"?.9:.6);if(cold<=.3)return;
        if(Traffic.I is {} traffic)for(int i=0;i<traffic.Vehicles.Count;i++)if(traffic.Vehicles[i] is {Kind:"dray",HorseBody:{} horse,Frame.Visible:true})HorseSnort(horse);
        if(Omnibus.I is {} bus)for(int i=0;i<bus.Buses.Count;i++)if(bus.Buses[i] is {Near:true} b){HorseSnort(b.Team,.55f);HorseSnort(b.Team,-.55f,1);}
    }
    public override void _ExitTree()
    {
        if(sound!=null){if(sound.InteriorAt==Interior)sound.InteriorAt=null;if(sound.PuddleAt==Puddle)sound.PuddleAt=null;if(sound.TempestNow==Tempest)sound.TempestNow=null;}
        if(I==this)I=null;
    }
}
