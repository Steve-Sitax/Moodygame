using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Net;
using Scheldemist.Net.Mp;
using Scheldemist.Ui;

namespace Scheldemist.Menu;

/// <summary>A bounded check of the Together handbill and its paper, using a fresh --db and --prefs.</summary>
[GamePart(211)]
public partial class TogetherMenuTest : Node
{
    private string dir = "";
    private readonly Dictionary<string, object?> report = new();
    public override void _Ready()
    {
        dir = Main.I.Arg("togethertest");
        if (dir == "") return;
        ProcessMode = ProcessModeEnum.Always;
        Directory.CreateDirectory(dir);
        _ = Run();
    }
    private async Task<bool> Until(Func<bool> check, int seconds = 10)
    {
        ulong end = Time.GetTicksMsec() + (ulong)(seconds * 1000);
        while (!check())
        {
            if (Time.GetTicksMsec() > end) return false;
            await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
        }
        return true;
    }
    private async Task Shot(string name)
    {
        for (int i = 0; i < 20; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
        await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
        GetViewport().GetTexture().GetImage().SavePng(Path.Combine(dir, name + ".png"));
    }
    private async Task Run()
    {
        bool ok = false;
        try
        {
            if (!await Until(() => ServerLink.I?.Up == true && !Loading.Busy, 110)) throw new Exception("The game did not start.");
            var menu = MainMenu.I ?? throw new Exception("No handbill.");
            var item = Dialogs.Focusables(menu.GetParent()).OfType<InkButton>().FirstOrDefault(b => b.Label == "Together" && b.IsVisibleInTree());
            report["handbill_item"] = item != null;
            if (item == null) throw new Exception("Together is missing on the handbill.");
            await Shot("together-title");
            item.EmitSignal(BaseButton.SignalName.Pressed);
            if (!await Until(() => Dialogs.Top is Sheet)) throw new Exception("Together did not open.");
            report["join_fields"] = Dialogs.Focusables(Dialogs.Top!).OfType<LineEdit>().Count() == 3;
            await Shot("together-join");
            Dialogs.CloseAll();
            var tg = Together.I!;
            await tg.Host(false);
            await Until(() => tg.PlayerId == 1 && tg.On);
            TogetherSheet.Open();
            await Until(() => tg.House != null);
            await Shot("together-host");
            report["host_address"] = tg.House?.Multiplayer == true;
            Dialogs.CloseAll();
            menu.Start();
            menu.KeyPause(true);
            report["no_pause_together"] = !Pause.Paused && !GetTree().Paused && Input.MouseMode == Input.MouseModeEnum.Captured;
            await tg.StopHosting();
            report["closed"] = !tg.On;
            // All three gear kinds are real decoded models, disposed on release.
            int models = 0;
            foreach (int kind in new[] { MpProtocol.GearRowboat, MpProtocol.GearVelo, MpProtocol.GearHandcart })
            {
                var gear = RemoteGear.Make(kind, 0);
                if (gear != null) { models++; gear.Place(-118, 0, 36, 0, 0.016f, true); gear.Dispose(); }
            }
            report["gear_models"] = models;
            ok = report.Values.Where(v => v is bool).All(v => (bool)v!) && models == 3;
        }
        catch (Exception e) { report["error"] = e.ToString(); }
        report["ok"] = ok;
        File.WriteAllText(Path.Combine(dir, "togethertest.json"), JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
        GetTree().Quit(ok ? 0 : 1);
    }
}
