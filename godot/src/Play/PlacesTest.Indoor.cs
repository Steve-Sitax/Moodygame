using System;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
namespace Scheldemist.Play;
public partial class PlacesTest
{
    private async Task FurnitureLife(Api api,HomeLife.HomeFrame room)
    {
        foreach(string kind in new[]{"stove","clock","lamp"})
        {
            var bought=await api.Buy(HomeLife.I.Info!.Dealer!.Id,kind);GameState.I.Apply(bought);await HomeLife.I.Load();await Frames(30);
            var item=HomeLife.I.Info!.Items.Last(i=>i.Kind==kind);HomePlace? place=null;
            for(int z=kind=="stove"?0:3;z<(int)(room.D*2)&&place==null;z++)for(int x=kind=="lamp"?4:0;x<(int)(room.W*2)&&place==null;x++)for(int rot=0;rot<4&&place==null;rot++)
                if(HomeFurniture.I.CheckPlacement(room,item,x,z,rot)==null)place=new(item.Id,x,z,rot);
            Check(place!=null,kind+" fits real home grid");await HomeLife.I.Change(()=>api.HomePlace(place!));await Frames(40);
            Check(HomeLife.I.Info!.Items.Any(i=>i.Id==item.Id&&i.State=="placed"),kind+" placement kept by engine");
            replies.Add(new{furnitureKind=kind,placed=place});
            if(kind=="stove")
            {
                var centre=room.World(-room.W/2+(place!.Gx+1f)*.5f,(place.Gz+1f)*.5f);
                var approach=room.World(-room.W/2+(place.Gx+1f)*.5f,(place.Gz+1f)*.5f+1f);
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/advance",new { minutes=60 }));
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new { warmth=5 }));
                await At(approach.X,approach.Z,centre.X,centre.Z,room.Y+.5f,room.Y);
                Check(await Until(()=>Interact.I.Find().Any(a=>a.Text=="warm yourself at the fire"),5),"placed stove has warmth prompt");
                Interact.I.Press(Key.E);Check(await Until(()=>GameState.I.Warmth==6&&!HomeLife.I.Busy,10),"placed stove engine warmth");await Shot("home-placed-stove");
            }
            if(kind=="clock")Check(await Until(()=>Scheldemist.Movers.Clocks.I.Dials.Any(d=>d.Kind=="home furniture clock"&&d.Shows>=0),5),"placed clock registered with game time");
            if(kind=="lamp"){Check(await Until(()=>HomeFurniture.I.LitLamps>0,5),"placed lamp uses fixed spill pool");}
            if(kind is "clock" or "lamp")
            {
                Check(await Until(()=>HomeFurniture.I.PositionOf(item.Id)!=null,5),kind+" has real placed model");
                var target=HomeFurniture.I.PositionOf(item.Id)!.Value+Vector3.Up*(kind=="clock"?1.74f:HomeFurniture.I.LampHeight(room.Id));
                var middle=room.World(0,room.D/2);var direction=new Vector3(middle.X-target.X,0,middle.Z-target.Z).Normalized();
                pictureAt=target+direction*1.2f+Vector3.Down*.3f;pictureTarget=target;
                Scheldemist.World.Daylight.I!.SetTime(13.75f);Scheldemist.World.Daylight.I.Settle();
                await Shot("home-placed-"+kind);pictureAt=pictureTarget=null;
            }
        }
        var snapshot=IndoorSave.I.Capture();
        Check(snapshot?.More?.ContainsKey("indoor_work")==true,"save capture preserves indoor work extension");
        Jobs.I.RestoreWorld(snapshot);Check(Jobs.I.Run==null,"empty indoor save restores without false followed job");
        await FurnitureCart(api);
    }
    private async Task FurnitureCart(Api api)
    {
        var fixture=await api.Post<JsonElement>("api/dev/job",new {type="carry",cart=true,twist="none",employer="sooi"});int id=fixture.GetProperty("id").GetInt32();GameState.I.Apply(await api.Jobs());await Jobs.I.TakeJob(GameState.I.Jobs.First(j=>j.Id==id));await Handcarts.I.Load();
        Check(await Until(()=>Handcarts.I.View.List.Any(c=>c.Kind=="lent"&&c.Job==id&&c.Placed),12),"lent cart placed by actual lender hook");
        var cart=Handcarts.I.View.List.First(c=>c.Job==id);
        GameState.I.Apply(await api.Buy(HomeLife.I.Info!.Dealer!.Id,"plant"));await HomeLife.I.Load();
        var plant=HomeLife.I.Info!.Items.Last(i=>i.Kind=="plant");
        Check(await Until(()=>HomeFurniture.I.CarriedFurniture?.Id==plant.Id,10),"new furniture carried in arms");
        await At(cart.X+.95f,cart.Z,cart.X,cart.Z,.7f);Check(Interact.I.Find().Any(a=>a.Text=="put the "+plant.Name+" on the cart"),"carried furniture cart E prompt");Interact.I.Press(Key.E);
        Check(await Until(()=>Handcarts.I.View.List.Any(c=>c.Id==cart.Id&&c.Load.Any(p=>p.Piece==plant.Id))&&!HomeFurniture.I.CartBusy,10),"engine transfers furniture from arms to lent cart");
        Check(await Until(()=>!HomeLife.I.Info!.Items.Any(i=>i.Id==plant.Id),10),"furniture on cart leaves home arms");await Shot("lent-cart-furniture");
        Check(Interact.I.Find().Any(a=>a.Text=="lift the furniture off the cart"),"furniture cart G unload prompt");Interact.I.Press(Key.G);
        Check(await Until(()=>HomeFurniture.I.CarriedFurniture?.Id==plant.Id&&!HomeFurniture.I.CartBusy,10),"cart furniture returns to arms");
        await HomeFurniture.I.LoadToCart(cart.Id);await api.GiveUp(id);GameState.I.Apply(await api.Tick());GameState.I.Apply(await api.Jobs());await Handcarts.I.Load();await HomeLife.I.Load();
        Check(!Handcarts.I.View.List.Any(c=>c.Job==id),"ending cart job returns employer cart");Check(await Until(()=>HomeLife.I.Info!.Items.Any(i=>i.Id==plant.Id&&i.State=="stored")&&!HomeLife.I.Busy,10),"loan return stores household furniture in own home");replies.Add(new {furnitureCart=new {plant=plant.Id,loan=cart.Id,returned=HomeLife.I.Info.Items.First(i=>i.Id==plant.Id)}});
        var next=HomeLife.I.Info.Homes.First(h=>h.Id!=HomeLife.I.Info.Lease!.Home);await HomeLife.I.Change(()=>api.HomeTake(new(next.Id,"day")));
        Check(HomeLife.I.Info!.Lease?.Home==next.Id,"household takes key for second home");Check(HomeLife.I.Info.Items.Any(i=>i.Id==plant.Id&&i.Home==next.Id&&i.State is "placed" or "stored"),"engine places or stores household furniture in second home");
    }
}
