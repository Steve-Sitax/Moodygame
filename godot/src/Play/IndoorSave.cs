using System;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
namespace Scheldemist.Play;
[GamePart(920)]
public partial class IndoorSave : Node
{
    private Func<ClientState>? previous;
    private ClientState Capture()
    {
        var st = GameState.I; var (h, m) = st.Shown; var j = Jef.I;
        var saved = previous?.Invoke() ?? new ClientState(new(st.Day,h,m), "Antwerp", new(j.X,j.Z,j.Y,j.Yaw,j.Pitch));
        var more = saved.More == null ? new Dictionary<string,JsonElement>() : new(saved.More);
        more["indoor_work"] = Jobs.I.IndoorSnapshot();
        return saved with { More = more };
    }
    public override void _Ready() { if (Scheldemist.Menu.MainMenu.I is {} menu) { previous = menu.Saves.Capture; menu.Saves.Capture = Capture; } }
    public override void _ExitTree() { if (Scheldemist.Menu.MainMenu.I is {} menu) menu.Saves.Capture = previous; }
}
