using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Net.Mp;
using Scheldemist.Player;
using Scheldemist.Play;
using Scheldemist.Town;
using Scheldemist.World;
using Scheldemist.Native.Authoring;
using Scheldemist.Native.World;
namespace Scheldemist.Native.Interiors;
public static class FurnitureGameProof
{
    public static async Task Run(NativeTownGame game,string output)
    {
        Directory.CreateDirectory(output);var rows=new List<object>();string? error=null;
        void Check(bool pass,string name){rows.Add(new{name,pass});if(!pass)throw new InvalidOperationException(name);}
        async Task Frames(int n=3){for(int i=0;i<n;i++)await game.ToSignal(game.GetTree(),SceneTree.SignalName.ProcessFrame);}
        async Task Shot(string name,Vector3 eye,Vector3 target)
        {
            if(!Jef.I.Fly)Jef.I.ToggleFly();
            Input.MouseMode=Input.MouseModeEnum.Visible;
            game.Cam.GlobalPosition=eye;var rotation=new Transform3D(Basis.Identity,eye).LookingAt(target).Basis.GetRotationQuaternion();
            if(game.Cam is FlyCam fly)fly.Face(rotation);else game.Cam.Quaternion=rotation;
            await Frames(15);await game.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);using var picture=game.GetViewport().GetTexture().GetImage();Check(picture.SavePng(Path.Combine(output,name+".png"))==Error.Ok,name+" picture");
        }
        try
        {
            Engine.MaxFps=30;var deadline=DateTime.UtcNow.AddSeconds(160);
            while(!game.Loaded || ServerLink.I?.Up!=true || !GameState.I.Live || Scheldemist.Menu.Loading.Busy){if(DateTime.UtcNow>deadline)throw new TimeoutException("Native game did not become ready.");await Frames(1);}
            var town=(NativeTown)game.World;var api=ServerLink.I!.Api!;Check(game.UsesLocalBackend&&api.IsLocal,"AI-off native backend ready");
            if(!Jef.I.Fly)Jef.I.ToggleFly();
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{day=1,hour=13,minute=0,weather="clear",money_c=500}));await Frames(3);
            foreach(string id in new[]{"room-tavern-ankere","room-home-widow","room-shop-bakery_rijn"})
            {
                var state=town.Layouts.Districts.Single(d=>d.District.Id==id);var expected=LayoutDocument.Decode(File.ReadAllText(Path.Combine(output,id+".expected.json")));var current=NativeDistrictLayouts.Capture(state.District,state.Objects);
                Check(Equal(expected,current),id+" game restores every saved id, asset and transform");
                var r=state.District;var rect=r.RoomBounds;var eye=r.RoomFrame*new Vector3(rect.Position.X+.7f,1.5f,rect.Position.Y+.7f);var target=r.RoomFrame*new Vector3(rect.GetCenter().X,.65f,rect.GetCenter().Y);
                Jef.I.Place(target.X,target.Z,0,0,r.RoomFrame.Origin.Y);await Shot(id+"-game",eye,target);
            }
            var fingerprint=NativeWorldIdentity.ReadFingerprint();var shared=NativeWorldIdentity.Capture(town,fingerprint);var packet=NativeWorldPacket.Encode(0,shared);
            Check(packet!=null,"all room edits fit the unchanged native world packet bound");Check(NativeWorldPacket.TryDecode(packet!,out _,out var received),"world packet round trip");
            NativeWorldIdentity.UseRemote(received!,fingerprint);
            foreach(var state in town.Layouts.Districts)Check(Equal(NativeDistrictLayouts.Capture(state.District,state.Objects),NativeDistrictLayouts.RemoteLayouts![state.District.Id]),"host/guest authored layout identical: "+state.District.Id);
            NativeDistrictLayouts.RemoteLayouts=null;
            var chair=town.Layouts.Districts.Single(d=>d.District.Id=="room-tavern-ankere").Objects.GetChildren().OfType<AuthoredObject>().Single(o=>o.Asset!.Id=="furniture-chair");
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{day=1,hour=20,minute=0,weather="clear"}));
            var at=chair.ToGlobal(chair.Asset!.SeatPoints[0]);Jef.I.Place(at.X,at.Z,0,0,at.Y);await Frames(60);await TavernSeats.I.Load();
            var seats=TavernSeats.I.Rooms.Single(r=>r.Id=="tavern:ankere");var seat=seats.Seats.Single(s=>s.At.DistanceTo(at)<.01f);Check(seat.Room.Open,"tavern opens by authoritative hours");
            var people=game.GetNode<Townspeople>("Townspeople");var patrons=await api.Tavern(seats.Id);
            var person=patrons.Patrons.FirstOrDefault(p=>!p.Stand&&p.Age>=16&&Scheldemist.People.Humans.CanSitKind(p.Kind));
            Check(person!=null,"a live tavern patron is available for the moved chair");
            var resident=people.ActionPerson(person!.Id)!;var fixtureOwner=new object();people.ActionHold(resident,fixtureOwner);
            game.Cam.GlobalPosition=at+new Vector3(1.3f,1.2f,1.8f);
            var house=people.Indoors!.Houses.Single(h=>h.Id==seats.Id);people.ActionInside(resident,house.Goal.X,house.Goal.Z);resident.Goal=new Townspeople.Goal{Mode="inside",X=house.Goal.X,Z=house.Goal.Z};
            people.Indoors.Update(.6,at+Vector3.Up*1.5f);
            foreach(var old in seats.Seats)if(old.Occupant?.Id==person!.Id)old.Occupant=null;seat.Occupant=person;TavernSeats.I._Process(.3);await Frames(6);
            var figure=people.Indoors!.FigureAt(seats.Id,person!.Id);
            File.WriteAllText(Path.Combine(output,"patron-debug.json"),JsonSerializer.Serialize(new{person.Id,kind=person.Kind,simKind=resident.Kind,resident.Inside,resident.ActionHeld,goal=resident.Goal.Mode,drawn=people.Indoors.Drawn,wanted=people.Indoors.Inside(house).Select(p=>p.R.Id).ToArray(),figure,seat.At,occupied=seats.Seats.Where(s=>s.Occupant?.Id==person.Id).Select(s=>s.At).ToArray(),eye=game.Cam.GlobalPosition},new JsonSerializerOptions{IncludeFields=true,WriteIndented=true}));
            Check(figure.HasValue&&figure.Value.Motion=="sit"&&new Vector2(figure.Value.At.X,figure.Value.At.Z).DistanceTo(new(at.X,at.Z))<.01f,"live patron uses the sitting hook at the moved chair");
            await Shot("moved-chair-patron",at+new Vector3(-1.4f,1.2f,.8f),at+Vector3.Up*.7f);
            people.ActionRelease(resident,fixtureOwner);
            seat.Occupant=null;TavernSeats.I.Sit(seat);Check(TavernSeats.I.Sitting==seat&&Jef.I.Frozen,"Jef sits on the authored chair");TavernSeats.I.Stand();
            var bed=town.NativeFurniture!.Single(p=>p.Room=="home:widow"&&p.Kind=="bed");
            await HomeLife.I.Change(()=>api.HomeTake(new("widow","day")));Check(HomeLife.I.Info?.Lease?.Home=="widow","Jef rents the real home");
            Check(HomeLife.I.Frames["widow"].Bed.DistanceTo(bed.UseAt)<.001f,"sleep interaction follows the moved bed");
            var foot=new Vector3(bed.UseAt.X,HomeLife.I.Frames["widow"].Y,bed.UseAt.Z);Jef.I.Place(foot.X,foot.Z,0,0,foot.Y);
            GameState.I.Apply(await api.Tick(new("home:widow",false),pos:new(foot.X,foot.Z,foot.Y)));
            var sleep=await api.Sleep(new(){Place="home",Hours=1,Pos=new(foot.X,foot.Z,foot.Y)});GameState.I.Apply(sleep);Check(sleep.Rest?.Place=="home","Jef starts authoritative sleep in the moved bed");
            var home=town.Layouts.Districts.Single(d=>d.District.Id=="room-home-widow").District;
            var localBed=home.RoomFrame.AffineInverse()*foot;
            var bedEye=home.RoomFrame*new Vector3(Math.Clamp(localBed.X+1,home.RoomBounds.Position.X+.4f,home.RoomBounds.End.X-.4f),1.2f,Math.Clamp(localBed.Z+1.4f,home.RoomBounds.Position.Y+.4f,home.RoomBounds.End.Y-.4f));
            await Shot("moved-bed-sleep",bedEye,bed.UseAt);GameState.I.Apply(await api.Wake());
            var outdoor=new AuthoredObject{ObjectId="proof-outdoor-chair",Asset=town.Layouts.Districts[0].District.Catalog.Index()["furniture-chair"],Name="OutdoorFurnitureProof",Position=new(-52,0,38),Rotation=new(0,.4f,0)};game.View.AddChild(outdoor);
            foreach(var view in new[]{(Name:"day",Hour:13,Minute:0,Weather:"clear"),(Name:"rain",Hour:13,Minute:0,Weather:"rain"),(Name:"fog",Hour:13,Minute:0,Weather:"fog"),(Name:"lamps",Hour:19,Minute:30,Weather:"clear"),(Name:"night",Hour:22,Minute:0,Weather:"mist")})
            {
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{day=1,hour=view.Hour,minute=view.Minute,weather=view.Weather}));Scheldemist.World.Daylight.I.Settle();await Frames(60);
                await Shot("furniture-"+view.Name,bedEye,bed.UseAt);Check(Scheldemist.Movers.Clocks.I.Report().All(r=>r.Running),view.Name+" clocks show authoritative time");
                Jef.I.Place(at.X,at.Z,0,0,at.Y);
                await Shot("chair-low-"+view.Name,at+new Vector3(-.7f,.28f,.4f),at+Vector3.Up*.35f);
                await Shot("chair-back-"+view.Name,at+new Vector3(-.7f,1.1f,-.55f),at+Vector3.Up*.6f);
                Jef.I.Place(outdoor.Position.X,outdoor.Position.Z,0,0,0);
                await Shot("outdoor-chair-"+view.Name,outdoor.Position+new Vector3(-1.2f,1.1f,1.8f),outdoor.Position+Vector3.Up*.5f);
                foreach(var mesh in BakedWorld.All(outdoor).OfType<MeshInstance3D>().Where(m=>m.Mesh!=null&&m.IsVisibleInTree()))
                    for(int surface=0;surface<mesh.Mesh!.GetSurfaceCount();surface++)Check(mesh.GetActiveMaterial(surface) is ShaderMaterial,"outdoor chair uses the town shader: "+view.Name);
            }
            outdoor.QueueFree();
            File.WriteAllText(Path.Combine(output,"world-packet.json"),JsonSerializer.Serialize(new{compressedBytes=packet!.Length,expandedBytes=System.Text.Encoding.UTF8.GetByteCount(shared.ToJsonString()),districts=town.Layouts.Districts.Count,objects=town.Layouts.ObjectCount}));
        }
        catch(Exception e){error=e.ToString();GD.PrintErr(error);}
        File.WriteAllText(Path.Combine(output,"game.json"),JsonSerializer.Serialize(new{rows,error},new JsonSerializerOptions{WriteIndented=true}));game.GetTree().Quit(error==null?0:1);
    }
    private static bool Equal(LayoutDocument a,LayoutDocument b)=>a.District==b.District&&a.Objects.Count==b.Objects.Count&&a.Objects.All(p=>b.Objects.Any(q=>q.Id==p.Id&&q.Asset==p.Asset&&q.Position.SequenceEqual(p.Position)&&q.Rotation.SequenceEqual(p.Rotation)&&q.Scale.SequenceEqual(p.Scale)));
}
