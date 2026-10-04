using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Audio;
using Scheldemist.Game;
using Scheldemist.Menu;
using Scheldemist.Movers;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Ui;
using Scheldemist.World;

namespace Scheldemist.Play;
public partial class RideTest
{
    private async Task FerryScenarios(Api api)
    {
        GameState.I.Apply(await api.NewGame());var f=FerryArrival.I;CharacterSheet.Open(profile=>_=f.Ask(false),null,"Before you step ashore in Antwerp");
        Require(CharacterSheet.IsOpen&&CharacterSheet.Draft!=null,"solo character creator opens before ferry boarding");
        var start=BakedWorld.All(Main.I.Ui).OfType<InkButton>().First(b=>b.Name=="start");start.EmitSignal(BaseButton.SignalName.Pressed);
        Require(await Until(()=>!CharacterSheet.IsOpen&&f.Stage=="waiting",15),"creator submits real profile and starts ferry");Require(!(await api.Arrival()).Creator,"solo ferry does not request the guest creator again");
        Require(await Until(()=>f.Stage=="moored",8),"guide scenario lowers gangway");f.RiderTestTime(35);Require(f.Nags==1,"first ferryman warning at 35 seconds");f.RiderTestTime(75);Require(f.Nags==2,"second warning at 75 seconds");
        await Scheldemist.Dev.Kit.I.Light(23,"clear");Require(await Until(()=>BoatLamps.I.LampLevel>.9f,10),"fixed boat lamp pool lights at night");Require(BoatLamps.I.FerryLanterns>=3&&BoatLamps.I.FerryWindows>0,"ferry loads navigation lamps and saloon panes from model");
        Jef.I.Place(-240,-58,Mathf.Pi/2,.12f,2.5f);Jef.I.Drive=null;await Shot("ferry-night");
        f.Start();f.RiderTestTime(115);Require(f.Guided,"idle passenger receives ferry guidance at 115 seconds");Require(await Until(()=>f.Ashore,30),"guide actually walks Jef down the gangway to the landing");
        await Scheldemist.Dev.Kit.I.Light(13.75,"clear");await Shot("ferry-guided");
        MovingSounds.I.Gather(.25);Require(MovingSounds.I.Vehicles>=12&&MovingSounds.I.Ships>0,"live vehicles and ships feed the existing Soundscape hooks");
        for(int i=0;i<5;i++)MovingSounds.I.Gather(.25);long before=System.GC.GetAllocatedBytesForCurrentThread();for(int i=0;i<100;i++)MovingSounds.I.Gather(.25);Require(System.GC.GetAllocatedBytesForCurrentThread()-before==0,"steady moving sound input allocates zero bytes");
    }
}
