using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;

namespace Scheldemist.Native.Authoring;

/// <summary>Two separate processes prove persistence, real physics, UI wiring, and safe failure of bad layouts.</summary>
public static class WorkshopProof
{
    private static IEnumerable<Node> Nodes(Node root)
    {
        yield return root;
        foreach (var child in root.GetChildren()) foreach (var node in Nodes(child)) yield return node;
    }
    private static async Task Frames(WorkshopSession s, int count = 3)
    {
        for (int i = 0; i < count; i++) await s.ToSignal(s.GetTree(), SceneTree.SignalName.PhysicsFrame);
    }
    public static async Task Run(WorkshopSession s, string directory, string stage)
    {
        directory = Path.GetFullPath(directory); Directory.CreateDirectory(directory);
        var rows = new List<object>();
        string? error = null;
        void Check(bool pass, string name)
        {
            rows.Add(new { name, pass });
            if (!pass) throw new InvalidOperationException(name);
        }
        try
        {
            await Frames(s);
            Check(s.Assets.Count == 3, "complete Godot asset resources load without a browser or bake");
            Check(s.Store.Writable, "isolated layout is writable");
            if (stage == "reload")
            {
                var earlier = LayoutDocument.Decode(File.ReadAllText(Path.Combine(directory, "expected.json")));
                Check(s.Document.Encode() == earlier.Encode(), "new Godot process restores the exact saved ids and transforms");
                Check(!s.Dirty, "restored layout starts clean");
                Check(s.Document.Objects.Count == 4, "placed object survives restart");
                var persisted = s.Document.Objects.Single(p => p.Id != "pilot-bench" && p.Id != "pilot-crate" && p.Id != "pilot-lamp");
                var screen = s.Camera.Eye.UnprojectPosition(LayoutDocument.Vector(persisted.Position) + Vector3.Up * 0.2f);
                Check(s.Pick(screen) == persisted.Id, "restored object has selectable physics");
            }
            else if (stage == "write")
            {
                Check(s.Document.Objects.Count == 3, "native district seed contains three editable objects");
                var bench = s.Instances["pilot-bench"];
                var screen = s.Camera.Eye.UnprojectPosition(bench.ToGlobal(bench.Asset!.FootprintOffset + new Vector3(0, bench.Asset.Footprint.Y * 0.95f, 0)));
                Check(s.Pick(screen) == "pilot-bench", "physics ray selects the visible bench by permanent id");
                Check(!s.Place("crate", bench.Position, Vector3.Zero, Vector3.One), "placement refuses occupied ground");
                Check(!s.Place("crate", new(21, 0, 0), Vector3.Zero, Vector3.One), "placement refuses ground outside the quay");
                Check(s.Place("crate", new(10, 0, 4), new(0, 0.5f, 0), Vector3.One), "new crate can be placed on clear ground");
                string placed = s.SelectedId!;
                await Frames(s);
                s.Undo(); Check(!s.Instances.ContainsKey(placed), "undo removes the new object and its scene");
                s.Redo(); Check(s.Instances.ContainsKey(placed), "redo restores the same object id");
                await Frames(s);
                s.Select(placed); s.MoveSelected();
                Check(!s.Instances[placed].Visible && s.HasPreview, "move previews hide the original without committing");
                s.CancelPreview(); Check(s.Instances[placed].Visible, "cancel restores the original object");
                Check(s.SetSelectedPose(new(10, 0, 6), 90), "numeric position and rotation commit one edit");
                s.Undo(); Check(s.Instances[placed].Position == new Vector3(10, 0, 4), "undo restores the previous transform");
                s.Redo(); Check(Math.Abs(s.Instances[placed].Rotation.Y - MathF.PI / 2) < 0.0001f, "redo restores rotation");
                s.Select(placed); s.DeleteSelected(); Check(!s.Instances.ContainsKey(placed), "delete removes the selected instance");
                s.Undo(); Check(s.Instances.ContainsKey(placed), "deletion is reversible");
                await Frames(s);

                var libraryButton = Nodes(s.Ui).OfType<Button>().Single(b => b.Text == "Wooden bench");
                libraryButton.EmitSignal(BaseButton.SignalName.Pressed);
                Check(s.HasPreview, "library button starts object placement"); s.CancelPreview();
                s.Select(placed); s.DuplicateSelected();
                var target = s.Camera.Eye.UnprojectPosition(new Vector3(12, 0, 0));
                s.GetViewport().PushInput(new InputEventMouseButton { ButtonIndex = MouseButton.Left, Pressed = true, Position = target, GlobalPosition = target }, true);
                await Frames(s);
                s.GetViewport().PushInput(new InputEventMouseButton { ButtonIndex = MouseButton.Left, Pressed = false, Position = target, GlobalPosition = target }, true);
                GD.Print($"click proof: point={target}, viewport={s.GetViewport().GetVisibleRect()}, over-panel={s.Ui.OverPanel(target)}, count={s.Document.Objects.Count}, preview={s.HasPreview}");
                Check(s.Document.Objects.Count == 5 && !s.HasPreview, "a viewport click commits the duplicate preview");
                Check(s.SelectedId != placed && Math.Abs(s.Instances[s.SelectedId!].Rotation.Y - MathF.PI / 2) < 0.0001f,
                    "copied object has a new id and retains the original rotation");
                s.Undo(); Check(s.Document.Objects.Count == 4, "duplicate placement is one undo action");

                Nodes(s.Ui).OfType<LineEdit>().First().GrabFocus();
                s.GetViewport().PushInput(new InputEventKey { Keycode = Key.S, PhysicalKeycode = Key.S, CtrlPressed = true, Pressed = true }, true);
                await Frames(s);
                s.GetViewport().PushInput(new InputEventKey { Keycode = Key.S, PhysicalKeycode = Key.S, CtrlPressed = true, Pressed = false }, true);
                Check(!s.Dirty && File.Exists(s.Store.File), "Ctrl+S saves even with a text field focused");
                s.GetViewport().GuiGetFocusOwner()?.ReleaseFocus();
                Nodes(s.Ui).OfType<Button>().Single(b => b.Text == "Day / night").EmitSignal(BaseButton.SignalName.Pressed);
                Check(s.Night && Nodes(s.Instances["pilot-lamp"]).OfType<WorkshopLamp>().Single().Lit, "night control lights the placed lamp");
                s.SetNight(false); Check(!Nodes(s.Instances["pilot-lamp"]).OfType<WorkshopLamp>().Single().Lit, "day extinguishes its light");
                s.SetEditing(false);
                s.Camera.Position = new(bench.Position.X, 0.02f, bench.Position.Z + 3);
                s.Camera.ProofDrive = Vector3.Forward;
                await Frames(s, 90); s.Camera.ProofDrive = null;
                Check(s.Camera.Position.Z > bench.Position.Z + 0.55f && s.Camera.Position.Z < bench.Position.Z + 1.1f,
                    "walking capsule stops at the placed bench");
                s.SetEditing(true);

                Check(s.Save() && !s.Dirty, "layout save clears unsaved state");
                Check(s.Save() && File.Exists(s.Store.File + ".bak"), "second save retains the previous layout backup");
                File.WriteAllText(Path.Combine(directory, "expected.json"), s.Document.Encode());
                Check(s.ExportScene(Path.Combine(directory, "objects-export.tscn")), "authored wrappers export to an editable Godot scene");
                var packed = ResourceLoader.Load<PackedScene>(Path.Combine(directory, "objects-export.tscn"));
                var exported = packed.Instantiate<Node3D>();
                Check(exported.GetChildren().OfType<AuthoredObject>().Select(o => o.Record()).Select(p => p.Id)
                    .SequenceEqual(s.Document.Objects.Select(p => p.Id)), "export retains stable ids and asset references");
                exported.Free();

                var wrongAsset = s.Document.Copy(); wrongAsset.Objects[0] = wrongAsset.Objects[0] with { Asset = "res://arbitrary-script.tscn" };
                bool refused = false;
                try { wrongAsset.Validate(s.DistrictId, s.Assets); } catch (InvalidDataException) { refused = true; }
                Check(refused, "layout cannot load an arbitrary scene path");
                var duplicate = s.Document.Copy(); duplicate.Objects.Add(duplicate.Objects[0]); refused = false;
                try { duplicate.Validate(s.DistrictId, s.Assets); } catch (InvalidDataException) { refused = true; }
                Check(refused, "duplicate permanent ids are refused");
                var nonfinite = s.Document.Copy(); nonfinite.Objects[0] = nonfinite.Objects[0] with { Position = new[] { float.NaN, 0f, 0f } }; refused = false;
                try { nonfinite.Validate(s.DistrictId, s.Assets); } catch (InvalidDataException) { refused = true; }
                Check(refused, "non-finite transforms are refused");
                string corrupt = Path.Combine(directory, "corrupt-layout.json"); File.WriteAllText(corrupt, "{ broken");
                var brokenStore = new LayoutStore(corrupt);
                try { brokenStore.Read(); } catch (JsonException) { }
                Check(!brokenStore.Writable, "unreadable layout locks writes");
                refused = false; try { brokenStore.Save(s.Document); } catch (InvalidOperationException) { refused = true; }
                Check(refused && File.ReadAllText(corrupt) == "{ broken", "bad layout is preserved rather than silently replaced");
            }
            else throw new ArgumentException("proof-stage must be write or reload");
        }
        catch (Exception e) { error = e.ToString(); GD.PrintErr(error); }
        File.WriteAllText(Path.Combine(directory, stage + ".json"), JsonSerializer.Serialize(new { stage, rows, error,
            nativeOnly = true, objects = s.Document?.Objects.Count }, new JsonSerializerOptions { WriteIndented = true }));
        GD.Print($"workshop proof {stage}: {rows.Count} checks, {(error == null ? "PASS" : "FAIL")}");
        s.GetTree().Quit(error == null ? 0 : 1);
    }

    public static async Task Picture(WorkshopSession s, string file)
    {
        try
        {
            await Frames(s, 15);
            await s.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(file))!);
            var result = s.GetViewport().GetTexture().GetImage().SavePng(file);
            if (result != Error.Ok) throw new IOException("Workshop picture failed: " + result);
            s.SetNight(true); s.Select("pilot-lamp");
            await Frames(s, 5);
            await s.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
            string night = Path.Combine(Path.GetDirectoryName(file)!, Path.GetFileNameWithoutExtension(file) + "-night.png");
            result = s.GetViewport().GetTexture().GetImage().SavePng(night);
            GD.Print("workshop pictures: " + result); s.GetTree().Quit(result == Error.Ok ? 0 : 1);
        }
        catch (Exception e) { GD.PrintErr(e); s.GetTree().Quit(1); }
    }
}
