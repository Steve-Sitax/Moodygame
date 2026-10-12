using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Menu;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Town;
using Scheldemist.People;
using Scheldemist.Play;

namespace Scheldemist.Native.Game;

public static class NativePlayProof
{
    public static async Task Run(NativeGame main, string output)
    {
        var rows = new List<object>(); bool pass = true;
        void Check(string name, bool okay, object? value = null) { rows.Add(new { name, pass = okay, value }); pass &= okay; GD.Print($"PLAY {(okay ? "PASS" : "FAIL")}: {name}: {value}"); }
        async Task Frame(int count = 1) { for (int i = 0; i < count; i++) await main.ToSignal(main.GetTree(), SceneTree.SignalName.ProcessFrame); }
        async Task Shot(string name) { await Frame(8); await main.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw); main.GetViewport().GetTexture().GetImage().SavePng(Path.Combine(output, name + ".png")); }
        try
        {
            Directory.CreateDirectory(output);
            ulong until = Time.GetTicksMsec() + 45000;
            while ((!main.Loaded || Loading.Busy || main.GetNodeOrNull<Townspeople>("Townspeople")?.Data == null) && Time.GetTicksMsec() < until) await Frame();
            var town = main.GetNodeOrNull<Townspeople>("Townspeople");
            Check("native district loaded", main.Loaded && main.World is NativeGameWorld);
            Check("server owns live game state", ServerLink.I?.Up == true && GameState.I.Live);
            Check("loading finishes", !Loading.Busy);
            Check("title menu visible", MainMenu.I?.Open == true && !MainMenu.I.Entered);
            Check("residents loaded", town?.Data != null, town?.Sims.Count);
            Check("native physics navigation", town?.Walk == main.World.NativeWalk && town?.Walk != null && town.Walk.Free(20, 26) && !town.Walk.Free(500, 500));
            Check("saved authored placements", ((NativeGameWorld)main.World).AuthoredCount == 15, ((NativeGameWorld)main.World).AuthoredCount);
            Check("work outside converted ground unavailable", GameState.I.Jobs.Where(j => JobTask.Of(j) is { Kind: "carry", From: "pier_head" }).All(j => !main.World.SupportsJob(j)));
            Check("native people preserve clips and skeleton", Scheldemist.Models.ModelLibrary.Get("people") is { } people && people.Clips.Count == 36 && Scheldemist.World.BakedWorld.All(people.Scene).OfType<Skeleton3D>().Any());
            await Shot("01-title");
            MainMenu.I!.Start(); await Frame(120);
            Check("menu enters play", MainMenu.I.InPlay && !MainMenu.I.Open);
            Check("posted people visible", PostedPeople.I?.List.Any(p => p.Present && p.Group.Visible) == true, PostedPeople.I?.List.Count);
            Check("crowd visible", town!.Sims.Any(s => s.P != null), town.Sims.Count(s => s.P != null));
            var sooi = PostedPeople.I?.Get("sooi");
            Check("Sooi interactive actor with animation", sooi?.Human != null && sooi.Group.GetChildren().Count > 0);
            if (sooi != null) { Jef.I.Place((float)sooi.X, (float)sooi.Z - 2, MathF.PI); await Frame(20); }
            await Shot("02-people");
            var (bx, bz) = Spots.Board; Jef.I.Place(bx, bz - 1.8f, MathF.PI); await Frame(25);
            var boardAction = Interact.I.Acts.FirstOrDefault(a => a.Text == "read the hiring board");
            Check("hiring board has real interaction", boardAction != null, Interact.I.Text); boardAction?.Run();
            await Frame(20); Check("hiring board opens", Jobs.I.BoardOpen); await Shot("03-hiring-board");
            Scheldemist.Windows.Dialogs.I!.Top?.OnKey("Escape", "Escape");
            if (sooi != null) { Jef.I.Place((float)sooi.X, (float)sooi.Z - 2, MathF.PI); Scheldemist.Talks.Talk.I!.Open(sooi.Id, sooi.Name, "foreman"); await Frame(120); Check("conversation opens", Scheldemist.Talks.Talk.I.IsOpen); await Shot("04-conversation"); Scheldemist.Windows.Dialogs.I.Top?.OnKey("Escape", "Escape"); }
            MainMenu.I.ShowMenu(true); await Frame(5); Check("pause menu pauses game", Pause.Paused && MainMenu.I.Open); await Shot("05-pause");
            MainMenu.I.Start(); await Frame(5); Check("resume returns to game", !Pause.Paused && MainMenu.I.InPlay);
            var savedAt = new Vector2(Jef.I.X, Jef.I.Z); string? saved = null;
            MainMenu.I.Saves.Save("slot1", "Native district proof", outcome => saved = outcome);
            until = Time.GetTicksMsec() + 8000; while (saved == null && Time.GetTicksMsec() < until) await Frame();
            Check("game save writes isolated slot", saved?.StartsWith("saved slot1 in ") == true, saved);
            Jef.I.Place(20, 26, 0); string? loaded = null; MainMenu.I.Saves.Load("slot1", outcome => loaded = outcome);
            until = Time.GetTicksMsec() + 8000; while (loaded == null && Time.GetTicksMsec() < until) await Frame();
            await Frame(10); Check("game load restores player", loaded == "loaded slot1" && savedAt.DistanceTo(new Vector2(Jef.I.X, Jef.I.Z)) < 0.1f, loaded);
        }
        catch (Exception error) { Check("proof completes", false, error.ToString()); GD.PrintErr(error); }
        File.WriteAllText(Path.Combine(output, "result.json"), JsonSerializer.Serialize(new { pass, rows }, new JsonSerializerOptions { WriteIndented = true }));
        main.GetTree().Quit(pass ? 0 : 1);
    }
}
