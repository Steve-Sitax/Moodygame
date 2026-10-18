using Godot;
using Scheldemist.Native.Game;
using Scheldemist.World;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Scheldemist.Net;
using Scheldemist.Native.Services;
using Scheldemist.Native.Services.Multiplayer;
using System.Text.Json.Nodes;
using System.Threading;

namespace Scheldemist.Native.World;

/// <summary>All existing game systems, supplied with the full editable native town.</summary>
public partial class NativeTownGame : Scheldemist.Main
{
    protected override BakedWorld CreateWorld() => new NativeTown();
    public override bool UsesLocalBackend => true;
    public override bool MultiplayerAvailable => true;
    public override bool DedicatedServer => Flag("dedicated") || OS.HasFeature("dedicated_server");
    private string fingerprint = "";
    public override string WorldFingerprint => fingerprint;
    private ILocalGameBackend? dedicatedBackend;
    protected override async Task PrepareWorldLoad()
    {
        NativeDistrictLayouts.RemoteLayouts = null;
        bool guest = Scheldemist.Net.Mp.Together.Pending != null || Arg("join") != "" && !Scheldemist.Net.Mp.Together.LeftAsGuest;
        if (!guest || DedicatedServer) return;
        while (ServerLink.I?.Api == null)
        {
            if (ServerLink.I?.Error is { Length: > 0 } error) throw new System.InvalidOperationException(error);
            await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
        }
        string world = await ServerLink.I.Api.GetJson("api/native/world", 30000);
        NativeWorldIdentity.UseRemote(JsonNode.Parse(world)!.AsObject(), fingerprint);
    }
    public override async Task<ILocalGameBackend> CreateLocalBackend()
    {
        while (!Loaded) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
        var navigation = World.NativeWalk!;
        bool freshWorld = !File.Exists(Paths.Database) || new FileInfo(Paths.Database).Length == 0;
        var host = new NativeServiceHost(new NativeServiceOptions(Paths.Database, Path.Combine(Paths.NativeDataRoot!, "services"), Paths.SaveSlots));
        var furniture=((NativeTown)World).NativeFurniture!.Select(p=>(p.Room,p.Kind)).ToArray();
        host.Homes.AuthoredBedAvailable=id=>furniture.Any(p=>p.Room=="home:"+id&&p.Kind=="bed");
        host.Homes.AuthoredFireAvailable=id=>furniture.Any(p=>p.Room=="home:"+id&&p.Kind=="stove");
        foreach(var room in ((NativeTown)World).Layouts.Districts.Where(d=>d.District.RoomId.StartsWith("home:")))
        {
            string id=room.District.RoomId[5..];
            if(host.Context.Rules["homeClasses"]?[id] is JsonObject definition)
            {
                definition["fixed"]=InteriorFurniture.FixedCells(((NativeTown)World).NativeFurniture!.Where(p=>p.Room==room.District.RoomId),room.District.RoomFrame,room.District.RoomBounds);
                definition["fire"]=furniture.Any(p=>p.Room==room.District.RoomId&&p.Kind=="stove");
            }
        }
        // #162: the fires that warm, from the scene: tavern hearths and stoves, and the outdoor fire baskets.
        var heat=new System.Collections.Generic.List<NativeHeatSource>();
        foreach(var (at,size,room) in Scheldemist.World.Fires.BakedSpots(World))
            if(room!=null||Scheldemist.World.Fires.IsBasket(size,room,at))heat.Add(new((room??"basket")+"@"+heat.Count,room,at.X,at.Y,at.Z));
        foreach(var stove in ((NativeTown)World).NativeFurniture!.Where(p=>p.Kind=="stove"&&p.Room.StartsWith("tavern:")))
        {var at=stove.Node.GlobalPosition;heat.Add(new(stove.Id,stove.Room,at.X,at.Y,at.Z));}
        host.Clock.HeatSources=heat;
        GD.Print($"warmth: {heat.Count(h=>h.Place!=null)} tavern fires, {heat.Count(h=>h.Place==null)} fire baskets");
        try
        {
            var town = new Services.NativeTown(host); host.AddModule(town);
            var profile = new NativeTownProfile(host); host.AddModule(profile);
            host.AddModule(new NativeTownArrival(host));
            var goods = new NativeGoods(host); host.AddModule(goods);
            var transport = new NativeTransport(host, goods) { GroundOpen = (x, z, radius) =>
                navigation.PathFree(x, z) && navigation.PathFree(x - radius, z) && navigation.PathFree(x + radius, z) && navigation.PathFree(x, z - radius) && navigation.PathFree(x, z + radius) };
            host.AddModule(transport);
            var deeds = new NativeDeeds(host, transport); host.AddModule(deeds);
            host.AddModule(new NativeShops(host));
            var rowing = new NativeRowing(host, goods, deeds); host.AddModule(rowing);
            var actions = new NativeActions(host, goods) {
                Conversations = host.Interiors.RecentConvos,
                NearestOpen = (x, z, maximum) => Ways.NearestOpen(x, z, maximum) is { } point ? new JsonObject { ["x"] = point.X, ["z"] = point.Y } : null
            }; host.AddModule(actions);
            var walkup = new NativeWalkup(host, actions); host.AddModule(walkup);
            var gifts = new NativeGifts(host, actions, deeds); host.AddModule(gifts);
            var routines = new NativeRoutines(host, actions, transport); host.AddModule(routines);
            var events = new NativeEvents(host, actions); host.AddModule(events);
            var townLife = new NativeTownLife(host, events, actions); host.AddModule(townLife);
            var talk = new NativeTownTalk(host, town); host.AddModule(talk);
            var haggle = new NativeHaggle(host, actions); host.AddModule(haggle); haggle.AttachTalk(talk);
            gifts.AttachTalk(talk);
            var treats = new NativeTreats(host, actions, routines, gifts); host.AddModule(treats); treats.AttachTalk(talk);
            var hands = new NativeHands(host, actions, routines, goods, transport); host.AddModule(hands); hands.AttachTalk(talk);
            var families = new NativeFamilies(host, actions); host.AddModule(families); families.AttachTalk(talk);
            var emigrants = new NativeEmigrants(host, actions) { TextFor = profile.Read }; host.AddModule(emigrants); emigrants.AttachTalk(talk);
            events.EmigrantShip = emigrants.Ship;
            var surprises = new NativeSurprises(host, actions, families); host.AddModule(surprises); surprises.AttachTalk(talk);
            talk.FullTalkOverrides.Add((request, _) => deeds.Talk(request));
            talk.OpeningOverrides.Add((request, person) => host.Night.Greeting(request.PlayerId, person));
            talk.ReplyOverrides.Add((request, person, topic) => topic == "self" && NativeCoreNight.AboutSelf(person["id"]!.GetValue<string>()) is { } line ? talk.Line(request, person, line) : null);
            host.AddModule(new NativeLively(town));
            var prison = new NativePrison(host, town); host.AddModule(prison); prison.AttachTalk(talk);
            host.AddModule(new NativeStreetIncidents(host) { ThiefCaught = prison.ThiefCaught });
            var park = new NativePark(host, town) { PositionOf = _ => {
                var position = Volatile.Read(ref playerPosition); return position == null ? null : (position.X, position.Z); } };
            host.AddModule(park);
            var landmarks = new NativeLandmarks(host, town) { TextFor = profile.Read }; host.AddModule(landmarks);
            host.AddModule(new NativeDev());
            var ai = new NativeAI(host, Flag("no-ai") ? Paths.WalkAiSetup : Paths.AiSetup, Flag("no-ai")); host.AddModule(ai);
            talk.CanUseHook = hook => ai.Settings.ChoiceForHook(hook) != null;
            haggle.CanUseHook = talk.CanUseHook;
            var press = new NativePress(host) { TextFor = profile.Read }; host.AddModule(press);
            var mills = new NativeMills(host); host.AddModule(mills);
            var tradeLedger = new NativeTradeLedger(host, goods, actions) {
                WayBetween = (x, z, bx, bz) => Ways.Path(new Vector2((float)x, (float)z), new Vector2((float)bx, (float)bz)) is { } path
                    ? new JsonArray(path.Select(point => (JsonNode)new JsonArray(point.X, point.Y)).ToArray()) : null
            }; host.AddModule(tradeLedger);
            mills.StockEventHooks.Add(tradeLedger.OnMillEvents);
            var population = new NativeTownPopulation(host, town);
            population.Facts["LAMPS"] = ((NativeTown)World).LampFacts.DeepClone();
            var streetLighting = new NativeStreetLighting(host, () => population.Facts["LAMPS"]!.AsArray());
            deeds.LampLight = streetLighting.At;
            uint townSeed = (uint)NativeTownPopulation.N(host.Context.World("town")?["seed"]);
            new NativeTownEmigrantsPopulation(population, emigrants).Ensure(townSeed);
            var populationLifecycle = new NativeTownPopulationLifecycle(population, emigrants);
            deeds.Stealables = populationLifecycle.Assets.Stealables;
            rowing.BoatDefinitions = populationLifecycle.Assets.Boats;
            rowing.PublicBoats = populationLifecycle.Assets.PublicBoats;
            rowing.LandingWaterman = populationLifecycle.Assets.Waterman;
            transport.TransportRecord = populationLifecycle.Transport.Record;
            transport.TripPoints = populationLifecycle.Transport.TripPoints;
            transport.Errands = populationLifecycle.Transport.Errands;
            transport.ParkedCartSnapshot = id => Scheldemist.Play.ResidentJourneys.I?.CartSnapshot(id);
            events.EventPeopleMax = populationLifecycle.EventPeopleMax;
            surprises.SaveVisitor = populationLifecycle.Visitors.SaveVisitor;
            var ideas = new NativeCoreIdeas(host) {
                TextFor = profile.Read, StoreText = profile.Store, PostCounter = press.PostCounter,
                Flags = Ways.Flags,
                Reachable = Ways.Reachable,
                Snap = (x, z, maximum) => Ways.NearestOpen(x, z, maximum) is { } point ? (point.X, point.Y) : null,
                Doors = () => population.Doors
            }; host.AddModule(ideas);
            press.RollNews = (day, ship) => ideas.RollNews(day, ship);
            ideas.PlayerPosition = actions.PlayerPosition;
            ideas.PickResponder = (role, at, maximum) => walkup.PickResponder(role, at, maximum);
            ideas.CallResponder = (player, role, why, reference, at) => walkup.CallResponder(player, role, why, reference, at);
            ideas.Comings = walkup.Comings; walkup.CallTrouble = ideas.CallTrouble;
            walkup.CustomsTrouble = ideas.CustomsTrouble;
            talk.ContextProviders.Add((player, person) => JsonValue.Create(ideas.NewsTalkLine(NativeGoods.S(person, "trade"))));
            press.PlanComing = () => press.AnnounceComing(events.Data["templates"]!.AsArray(), proposed => events.Plan(proposed)["ok"]?.GetValue<bool>() == true);
            var ballads = new NativeBallads(host, actions, events) { TextFor = profile.Read, Inside = landmarks.Inside, CathedralView = player => landmarks.View("cathedral", player) }; host.AddModule(ballads);
            async Task<JsonObject?> Narration(int who, string hook, JsonObject request)
            {
                var result = await ai.Call(hook, request["system"]!.GetValue<string>(), request["prompt"]!.GetValue<string>(), request["schema"]!.AsObject(), who).ConfigureAwait(false);
                return result.Ok ? result.Output?.AsObject() : null;
            }
            host.Interiors.NarrateAsync = Narration; host.Interiors.DailyCallLimit = () => ai.Settings.CallsPerDay;
            routines.NarrateAsync = Narration; events.NarrateAsync = Narration; townLife.NarrateAsync = Narration;
            talk.NarrateAsync = Narration; talk.DailyCallLimit = () => ai.Settings.CallsPerDay;
            talk.ApplyAction = (player, npc, proposal) => actions.Apply(player, npc, proposal);
            routines.DailyCallLimit = () => ai.Settings.CallsPerDay;
            events.DailyCallLimit = () => ai.Settings.CallsPerDay; townLife.DailyCallLimit = () => ai.Settings.CallsPerDay;
            press.NarrateAsync = Narration; press.DailyCallLimit = () => ai.Settings.CallsPerDay;
            ballads.NarrateAsync = Narration; ballads.DailyCallLimit = () => ai.Settings.CallsPerDay;
            hands.NarrateAsync = Narration; hands.DailyCallLimit = () => ai.Settings.CallsPerDay;
            haggle.NarrateAsync = Narration; haggle.DailyCallLimit = () => ai.Settings.CallsPerDay;
            families.NarrateAsync = Narration; families.DailyCallLimit = () => ai.Settings.CallsPerDay;
            surprises.NarrateAsync = Narration; surprises.DailyCallLimit = () => ai.Settings.CallsPerDay;
            surprises.CanUseHook = hook => ai.Settings.ChoiceForHook(hook) != null;
            ideas.NarrateAsync = Narration; ideas.DailyCallLimit = () => ai.Settings.CallsPerDay;
            host.Night.NarrateAsync = Narration; host.Night.DailyCallLimit = () => ai.Settings.CallsPerDay;
            landmarks.NarrateAsync = Narration; landmarks.DailyCallLimit = () => ai.Settings.CallsPerDay;
            host.Night.SyncPerception = actions.Sync; host.Night.PlayerPosition = actions.PlayerPosition;
            host.Night.PeopleNear = actions.PeopleNear; host.Night.CallGang = walkup.CallGang;
            host.Night.EndCallsFor = prefix => { actions.EndCallsFor(prefix); };
            // Navigation and people are initialized before the backend is exposed. Replanning edited lamps
            // and fresh-world lifecycle registration need no scene-node calls or render-thread blocking.
            await Task.Run(() => host.WithState(_ => { host.AddModule(populationLifecycle); return true; }));
            host.AddModule(new NativeLampJobs(host));
            var story = new NativeStory(host) {
                Resident = town.Resident, Doing = id => town.Activity(id).Act,
                Open = (x, z, maximum) => Ways.NearestOpen(x, z, maximum) is { } point ? (point.X, point.Y) : null,
                // "Down by the river" only where the water really is within a few strides.
                Where = (x, z) => Enumerable.Range(0, 16).Any(i => Water.In((float)(x + System.Math.Sin(i * System.Math.PI / 8) * 14), (float)(z + System.Math.Cos(i * System.Math.PI / 8) * 14))) ? "down by the river" : "at the end of my round"
            };
            host.AddModule(story); story.AttachTalk(talk);
            streetLighting.StoryDark = story.Dark; streetLighting.StoryLit = story.Lit;
            StoryService = story; ServiceHost = host;
            var multiplayer = new NativeMultiplayer(host, Path.ChangeExtension(Paths.Database, ".mp-config.json"), fingerprint) {
                EnsurePlayer = host.Saves.EnsurePlayer,
                CreateProfile = (id, name) => profile.Save(id, new JsonObject { ["sex"] = "man", ["first"] = name, ["last"] = "" }),
                Profile = id => new JsonObject { ["first"] = profile.Of(id).First, ["code"] = NativeTownProfile.Code(profile.Of(id)) },
                PlayerLeft = (id, at) => goods.PlayerLeft(id, at)
            };
            host.AddModule(multiplayer);
            host.MultiplayerEnabled = () => multiplayer.Enabled;
            host.OnlinePlayers = multiplayer.OnlineIds;
            AttachAntigoon(host, multiplayer, navigation, streetLighting, actions, population.City);
            AntigoonService!.StoryWanted = story.SightingWanted; AntigoonService.StoryWitnessed = story.Witness;
            actions.Walker = multiplayer.Walker;
            goods.NpcMayReport = multiplayer.MayReportNpc;
            park.PositionOf = player => {
                if (multiplayer.Enabled) return multiplayer.Position(player) is { } at ? (NativeGoods.Number(at["x"]), NativeGoods.Number(at["z"])) : null;
                var position = Volatile.Read(ref playerPosition); return position == null ? null : (position.X, position.Z);
            };
            var sharedWorld = NativeWorldIdentity.Capture((NativeTown)World, fingerprint);
            var network = new NativeNetworkHost(host, multiplayer, profile, sharedWorld);
            // Reset runs board extras, which can start asynchronous newspaper/notebook work.
            // Finish every constructor and authority callback before allowing that work to use SQLite.
            // The jobs setter can also start a board, so it belongs in this same short state section.
            await host.WithState(_ => {
                if (freshWorld) { host.Jobs.ConfigureNarration(Narration, startStartup: false); host.Reset(); }
                else host.Jobs.NarrateAsync = Narration;
                ideas.Start();
                return true;
            });
            try
            {
                int port = int.TryParse(Arg("port"), out int chosenPort) ? chosenPort : 8800;
                await network.Start(port, Arg("port") != "");
                if (DedicatedServer)
                {
                    await host.WithState(_ => multiplayer.HandleLocal("POST", "/api/mp/config", 1, new JsonObject { ["multiplayer"] = true, ["lan"] = true }));
                    await network.WaitForConfigurationAsync();
                    var details = await host.WithState(_ => multiplayer.HandleLocal("GET", "/api/mp/host", 1, new JsonObject()).Body);
                    File.WriteAllText(Path.Combine(Paths.Data, "server-admin.json"), new JsonObject { ["url"] = network.Url, ["token"] = multiplayer.HostToken, ["fingerprint"] = fingerprint }.ToJsonString());
                    GD.Print("Dedicated server join code: " + details["code"]?.GetValue<string>() + "; addresses: " + details["urls"]?.ToJsonString());
                }
                if (Arg("server-ready") is { Length: > 0 } ready)
                {
                    var info = await host.WithState(_ => multiplayer.HandleLocal("GET", "/api/mp/host", 1, new JsonObject()).Body);
                    info["url"] = network.Url; info["fingerprint"] = fingerprint;
                    File.WriteAllText(Paths.Absolute(ready), info.ToJsonString());
                }
            }
            catch { network.Dispose(); throw; }
            GD.Print($"native gameplay rules: {host.RoutePatterns.Count} registered routes; Godot server {network.Url}");
            if (Arg("native-registry") is { Length: > 0 } registry)
                File.WriteAllText(Paths.Absolute(registry), System.Text.Json.JsonSerializer.Serialize(new { routes = host.RoutePatterns.Concat(NativeNetworkHost.TransportRoutes).Distinct().ToArray() }));
            return new NativeHostedBackend(new NativeBackendAdapter(host, ai, profile), network, multiplayer.HostToken, fingerprint);
        }
        catch (System.Exception error)
        {
            GD.PrintErr("Native service startup failed: " + error);
            try { host.Dispose(); }
            catch (System.Exception cleanupError) { GD.PrintErr("Native service startup cleanup failed: " + cleanupError); }
            throw;
        }
    }
    public override void _Ready()
    {
        try
        {
            Paths.NativeUserDirectory = Path.Combine(ProjectSettings.GlobalizePath("user://"), DedicatedServer ? "native-server" : "native-playtest");
            NativeGlobals.Ensure(); NativeData.Initialize();
            fingerprint = NativeWorldIdentity.ReadFingerprint();
            Scheldemist.Models.ModelLibrary.NativeScene = name =>
                ResourceLoader.Load<PackedScene>("res://assets/game-models/" + name + ".scn").Instantiate<Node3D>();
            base._Ready(); initialized = true;
#if DEBUG
            if(Arg("furniture-game-proof") is {Length:>0} furnitureProof) _ = Interiors.FurnitureGameProof.Run(this,Paths.Absolute(furnitureProof));
#endif
            if (DedicatedServer) _ = StartDedicated();
            if (Arg("conversation-proof") is { Length: > 0 } conversationProof) _ = NativeConversationProof.Run(this, Paths.Absolute(conversationProof));
            if (Arg("native-smoke") is { Length: > 0 } proof) _ = NativeGameplayProof.Run(this, Paths.Absolute(proof));
            if (Arg("native-package-smoke") is { Length: > 0 } packageProof) _ = NativePackageProof.Run(this, Paths.Absolute(packageProof));
            if (Arg("native-journey-proof") is { Length: > 0 } journeyProof) _ = RunJourneyProof(Paths.Absolute(journeyProof));
            if (Arg("native-extras-proof") is { Length: > 0 } extrasProof) _ = RunExtrasProof(Paths.Absolute(extrasProof));
            if (Arg("antigoon-event-proof") is { Length: > 0 } antigoonProof) _ = NativeAntigoonEventProof.Run(this, Paths.Absolute(antigoonProof));
            if (Arg("antigoon-story-map") is { Length: > 0 } storyMap) _ = NativeAntigoonStoryMap.Run(this, Paths.Absolute(storyMap));
            if (Arg("story-proof") is { Length: > 0 } storyProof) _ = NativeStoryProof.Run(this, Paths.Absolute(storyProof));
            if (Arg("work-board-proof") is { Length: > 0 } boardProof) _ = NativeWorkBoardProof.Run(this, Paths.Absolute(boardProof));
            if (Arg("arrival-pier-proof") is { Length: > 0 } pierProof) _ = NativeArrivalPierProof.Run(this, Paths.Absolute(pierProof));
            if (Arg("stone-corners-proof") is { Length: > 0 } stoneProof) _ = NativeStoneCornersProof.Run(this, Paths.Absolute(stoneProof));
        }
        catch (System.Exception error) { GD.PrintErr(error); GetTree().Quit(1); }
    }
    private bool titled;
    private bool initialized;
    private async Task RunJourneyProof(string output)
    {
        try { await NativeJourneyGameplayProof.Run(this, output); GetTree().Quit(); }
        catch (System.Exception error) { GD.PrintErr(error); GetTree().Quit(1); }
    }
    private sealed record Position(double X, double Z);
    private async Task RunExtrasProof(string output)
    {
        try { await NativeExtrasGameplayProof.Run(this, output); GetTree().Quit(); }
        catch (System.Exception error) { GD.PrintErr(error); GetTree().Quit(1); }
    }
    private Position? playerPosition;
    private async Task StartDedicated()
    {
        try {
            dedicatedBackend = await CreateLocalBackend(); GD.Print("Dedicated Godot server ready.");
            if (Arg("native-network-smoke") is { Length: > 0 } output) {
                await NativeNetworkProof.Run((NativeHostedBackend)dedicatedBackend, Paths.Absolute(output));
                GD.Print("Native dedicated network proof passed."); GetTree().Quit();
            }
        }
        catch (System.Exception error) { GD.PrintErr(error); GetTree().Quit(1); }
    }
    public override void _ExitTree()
    {
        dedicatedBackend?.Dispose(); dedicatedBackend = null;
        base._ExitTree();
    }
    public override void _Process(double delta)
    {
        if (!initialized) return;
        if (DedicatedServer) return;
        base._Process(delta);
        if (Scheldemist.Player.Jef.I is { Body: { } body }) { var p = body.GlobalPosition; Volatile.Write(ref playerPosition, new Position(p.X, p.Z)); }
        if (Loaded && !titled) { titled = true; GetTree().Root.Title = "Scheldemist · Native Godot Town"; }
        if (!Scheldemist.Menu.Pause.Paused) Tide.Advance((float)delta);
    }
}
