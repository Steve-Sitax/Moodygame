using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Menu;
using Scheldemist.Net;
using Scheldemist.People;
using Scheldemist.Town;

namespace Scheldemist.Native.World;

/// <summary>Replace the population through the real menu, then restore the saved world and its visible people.</summary>
public static class NativeNewWeekGameplayProof
{
    public static async Task Run(NativeTownGame game, string output)
    {
        var checks = new List<object>();
        void Check(string name, bool passed) { checks.Add(new { name, passed }); if (!passed) throw new InvalidOperationException(name); }
        async Task Frames(int count) { for (int i = 0; i < count; i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame); }
        async Task Until(Func<bool> ready)
        {
            var end = DateTime.UtcNow.AddSeconds(90);
            while (!ready()) { if (DateTime.UtcNow >= end) throw new TimeoutException("The replacement town did not become ready."); await Frames(1); }
        }
        string Identity(TownData town) => string.Join("\n", town.Residents.OrderBy(r => r.Id, StringComparer.Ordinal).Select(r => r.Id + ":" + r.Name));
        try
        {
            Check("new-week proof uses an isolated database", Path.GetFullPath(Paths.Database).StartsWith(Path.GetFullPath(output) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase));
            var town = game.GetNode<Townspeople>("Townspeople"); var original = town.Data!;
            string originalPeople = Identity(original); int originalCount = original.Residents.Count;
            void CheckPopulationViews(string phase)
            {
                var residents = town.Data!.Residents.ToDictionary(r => r.Id, StringComparer.Ordinal);
                var posted = PostedPeople.I!.List.Where(p => p.Resident != null).ToArray();
                Check(phase + " posted employers use current residents", posted.Length > 0 && posted.All(p => residents.TryGetValue(p.Id, out var r) && ReferenceEquals(r, p.Resident)));
                var stalls = MarketStalls.I!.List;
                Check(phase + " market keepers belong to the current population", stalls.Count > 0 && stalls.All(s => residents.ContainsKey(s.Keeper)));
                Check(phase + " animal owners belong to current simulations", Animals.I!.List.All(a => a.owner == null || town.Sims.Any(s => s.R.Id == a.owner)));
            }
            var api = ServerLink.I!.Api!; var menu = MainMenu.I!;
            string saved = ""; menu.Saves.Save("slot4", "Before native new week", outcome => saved = outcome);
            await Until(() => saved != ""); Check("real menu saved the original world", saved.StartsWith("saved slot4", StringComparison.Ordinal));
            var settings = await api.SetPopulation(new Dictionary<string, object?> { ["townSize"] = "small", ["eventSize"] = 20 });
            Check("settings API accepted the next town size", settings.GetProperty("townSize").GetString() == "small" && settings.GetProperty("eventSize").GetInt32() == 20);
            Check("population setting preserves the live town", town.Data == original && town.Data.Residents.Count == originalCount);
            string started = ""; Sheets.StartNewWeek(menu, outcome => started = outcome);
            await Until(() => started != ""); Check("real new-week action succeeded", started == "new week");
            await Until(() => town.Data != null && town.Data != original && town.WaysWaiting >= 0);
            using var current = await api.Get<JsonDocument>("api/settings/population");
            int count = current.RootElement.GetProperty("current").GetProperty("residents").GetInt32();
            Check("small population rebuilt from native rules", count > 200 && count < originalCount && current.RootElement.GetProperty("current").GetProperty("size").GetString() == "small");
            Check("rendered town uses the new population", town.Data!.Residents.Count == count && town.Sims.Count + town.EmployerResidents.Count == count && Identity(town.Data) != originalPeople);
            Check("new population has no duplicate simulations", town.Sims.Select(s => s.R.Id).Distinct(StringComparer.Ordinal).Count() == town.Sims.Count);
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = 13, minute = 0, weather = "clear" }));
            menu.Start(); await Frames(180);
            Check("new town can enter real gameplay", menu.InPlay && town.Sims.Any(s => s.P != null));
            CheckPopulationViews("new week");
            await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
            using (var picture = game.GetViewport().GetTexture().GetImage()) Check("new-town screenshot written", picture.SavePng(Path.Combine(output, "new-town.png")) == Error.Ok);
            var fresh = town.Data;
            string loaded = ""; menu.Saves.Load("slot4", outcome => loaded = outcome);
            await Until(() => loaded != ""); Check("real menu reloaded the saved world", loaded == "loaded slot4");
            await Until(() => town.Data != null && town.Data != fresh && town.WaysWaiting >= 0);
            Check("load restores original residents in the running scene", town.Data!.Residents.Count == originalCount && Identity(town.Data) == originalPeople && town.Sims.Count + town.EmployerResidents.Count == originalCount);
            Check("load preserves the authored lamp", Scheldemist.World.Lights.I.Lamps.Any(l => l.id == "authored:rijnkaai-recovered/0b6dbc5dc53b48c98eb69b148cb310c8" && Math.Abs(l.at.X - 52.5) < .05 && Math.Abs(l.at.Z - 2.25) < .05));
            menu.Start(); await Frames(120);
            CheckPopulationViews("loaded week");
            File.WriteAllText(Path.Combine(output, "new-week.json"), JsonSerializer.Serialize(new { passed = true, checks }));
            GD.Print($"Native new-week gameplay: {checks.Count} checks PASS");
        }
        catch (Exception error)
        {
            File.WriteAllText(Path.Combine(output, "new-week.json"), JsonSerializer.Serialize(new { passed = false, error = error.ToString(), checks }));
            throw;
        }
    }
}
