using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using Godot;
using Scheldemist.Game;
using Scheldemist.Menu;
using Scheldemist.Net;
using Scheldemist.Player;

namespace Scheldemist.Native.World;

public partial class NativePumpRenderingProof : Node
{
    public override async void _Ready()
    {
        var game=GetParent<NativeTownGame>();string output=game.Arg("pump-render-proof");
        Directory.CreateDirectory(output);var checks=new List<object>();
        void Check(string name,bool passed){checks.Add(new{name,passed});if(!passed)throw new InvalidOperationException(name);}
        try {
            var until=DateTime.UtcNow.AddSeconds(100);
            while(!game.Loaded || Loading.Busy || ServerLink.I?.Up != true || !GameState.I.Live) {
                if(DateTime.UtcNow>until)throw new TimeoutException("Pump proof startup");
                await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);
            }
            MainMenu.I!.Start();if(Jef.I is {Fly:false} player)player.ToggleFly();
            var state=await ServerLink.I!.Api!.Post<JobsPayload>("api/dev/set",new{day=1,hour=22,minute=0,weather="mist"});
            GameState.I.Apply(state);
            await NativePackageProof.InspectPump(game,output,Check);
            File.WriteAllText(Path.Combine(output,"result.json"),JsonSerializer.Serialize(new{passed=true,checks}));GetTree().Quit();
        } catch(Exception error) {
            File.WriteAllText(Path.Combine(output,"result.json"),JsonSerializer.Serialize(new{passed=false,checks,error=error.ToString()}));GD.PrintErr(error);GetTree().Quit(1);
        }
    }
}
