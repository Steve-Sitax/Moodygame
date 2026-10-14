using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Talks;

namespace Scheldemist.Menu;

/// <summary>
/// A window read in play does not pause the game: `-- --dialog-pause-proof dir` (with --no-ai, and a --db, --prefs and
/// --port of its own). It walks in, puts a bill up, waits past the menu's half-second mouse check, then presses E as
/// the keyboard does: the bill must go. The same with Esc: the bill goes and the menu stays down. The mouse is let go
/// for the bill as in play (no KeepMouse): the menu once took that for "the game lost the mouse", paused, and the
/// paused window heard no key (2026-10-14). What it saw goes to dir/dialogpausetest.json; it quits (1 on a failure).
/// </summary>
[GamePart(212)]
public partial class DialogPauseTest : Node
{
    private string dir = "";
    private readonly List<Dictionary<string, object?>> steps = new();
    private readonly List<string> failed = new();

    public DialogPauseTest()
    {
        ProcessMode = ProcessModeEnum.Always;
    }

    public override void _Ready()
    {
        dir = Paths.TestOutput("dialog-pause-proof");
        if (dir == "") return;
        Directory.CreateDirectory(dir);
        _ = Run();
    }

    private async Task Wait(double s) => await ToSignal(GetTree().CreateTimer(s, true, false, true), SceneTreeTimer.SignalName.Timeout);

    private async Task<bool> Until(Func<bool> ok, double s)
    {
        for (double left = s; !ok(); left -= 0.1)
        {
            if (left <= 0) return false;
            await Wait(0.1);
        }
        return true;
    }

    private void Note(string what, object? got, bool ok)
    {
        steps.Add(new() { ["step"] = what, ["got"] = got, ["ok"] = ok });
        if (!ok) failed.Add(what);
        GD.Print($"[dialogpausetest] {what}: {got}{(ok ? "" : "  FAILED")}");
    }

    private static void Tap(Key key)
    {
        foreach (bool down in new[] { true, false })
            Input.ParseInputEvent(new InputEventKey { Keycode = key, PhysicalKeycode = key, Pressed = down });
    }

    private static Bill Sailing => new()
    {
        Id = 1, Kind = "sailing", Day = 1,
        Text = new BillText { Heading = "SAILINGS", Body = "The steamer for London sails from the Rijnkaai on Tuesday at noon, with the tide." },
    };

    private async Task Run()
    {
        try
        {
            bool loaded = await Until(() => Main.I.Loaded && !Loading.Busy, 160);
            Note("the game loaded", loaded, loaded);
            var menu = MainMenu.I;
            var press = Talks.Press.I;
            var dialogs = Windows.Dialogs.I;
            if (menu == null || press == null || dialogs == null) throw new InvalidOperationException($"a part is off: menu {menu != null}, press {press != null}, dialogs {dialogs != null}");
            menu.Start();
            await Wait(0.3);
            Note("walked in", menu.Entered, menu.Entered);

            foreach (var (key, name) in new[] { (Key.E, "E"), (Key.Escape, "Esc") })
            {
                press.ShowBill(Sailing);
                await Wait(1.2); // past the menu's mouse check (every 0.5 s)
                Note($"bill up before {name}", press.Page, press.Page == "bill" && dialogs.Any);
                Note($"the mouse is let go for the bill ({name})", dialogs.MouseFree, dialogs.MouseFree);
                Note($"no pause under the bill ({name})", string.Join(",", Pause.Reasons), !Pause.Paused);
                Tap(key);
                await Wait(0.3);
                Note($"{name} put the bill away", press.Page ?? "none", !press.IsOpen && !dialogs.Any);
                Note($"the menu stayed down after {name}", menu.Open, !menu.Open);
            }
        }
        catch (Exception e)
        {
            Note("ran", e.Message, false);
        }
        File.WriteAllText(Path.Combine(dir, "dialogpausetest.json"), JsonSerializer.Serialize(new { failed, steps }, new JsonSerializerOptions { WriteIndented = true }));
        GetTree().Quit(failed.Count == 0 ? 0 : 1);
    }
}
