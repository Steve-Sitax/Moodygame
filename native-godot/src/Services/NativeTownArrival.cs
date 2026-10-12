using System;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>The persisted ferry opening; older saves without its key remain ashore.</summary>
public sealed class NativeTownArrival : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private NativeServiceContext C => host.Context;
    public Func<bool> MultiplayerOn = () => false;
    public Func<int, int>? RetirePlayer;
    public NativeTownArrival(NativeServiceHost host) => this.host = host;
    private JsonNode? State(int player) => C.PlayerState(player, "arrival") ?? (player == 1 ? C.World("arrival") : null);
    private void Save(int player, JsonNode value) { C.SetPlayerState(player, "arrival", value); if (player == 1) C.Execute("DELETE FROM world_state WHERE key='arrival'"); }
    public string Stage(int player = 1) => NativeTown.S(State(player), "stage") == "ferry" ? "ferry" : "ashore";
    public JsonObject View(int player = 1) => new() { ["stage"] = Stage(player), ["creator"] = Stage(player) == "ferry" && State(player)?["creator"]?.GetValue<bool>() == true };
    public void Register(NativeServiceHost service)
    {
        service.Register("GET", "/api/arrival", r => View(r.PlayerId));
        service.Register("POST", "/api/arrival/ashore", r => { var state = State(r.PlayerId); if (Stage(r.PlayerId) == "ferry") { Save(r.PlayerId, new JsonObject { ["stage"] = "ashore" }); if (state?["log"]?.GetValue<bool>() == true) C.Log(r.PlayerId, "arrived", null, "Jef came off the ferry at the Werf, with 50 centimes and no name."); } return new JsonObject { ["stage"] = Stage(r.PlayerId) }; });
        service.Register("POST", "/api/arrival/made", r => { var state = State(r.PlayerId); if (Stage(r.PlayerId) == "ferry" && state?["creator"]?.GetValue<bool>() == true) { state["creator"] = false; Save(r.PlayerId, state); } return View(r.PlayerId); });
        service.Register("POST", "/api/player/new-man", r => {
            if (!MultiplayerOn()) throw new NativeServiceException("Played alone, a new week begins with the new man.", 409);
            if (C.PlayerState(r.PlayerId, "ending") == null) throw new NativeServiceException("your man is still in the town", 409);
            if (C.PlayerState(1, "ending") is { } ending && NativeTown.S(ending, "kind") == "week") throw new NativeServiceException("The week is over for everyone. The host starts the next one.", 409);
            if (RetirePlayer == null) throw new NativeServiceException("A native multiplayer session is required.", 409);
            int retired = RetirePlayer(r.PlayerId); return new JsonObject { ["stage"] = Stage(r.PlayerId), ["retired"] = retired };
        });
    }
}
