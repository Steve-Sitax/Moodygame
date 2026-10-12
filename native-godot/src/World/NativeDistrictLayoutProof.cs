using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Native.Authoring;
using Scheldemist.Native.Game;

namespace Scheldemist.Native.World;

/// <summary>Cold-load and isolated-save checks; never saves a live player layout or the reviewed scene.</summary>
public partial class NativeDistrictLayoutProof : Node
{
    private readonly List<object> checks = new();
    private void Check(bool pass, string description)
    {
        checks.Add(new { check = description, pass });
        if (!pass) throw new InvalidOperationException("Native district layout check failed: " + description);
    }

    public override void _Ready()
    {
        string proof = WorkshopSession.Arg("layout-proof");
        if (proof == "") { GD.PrintErr("Supply an isolated --layout-proof directory."); GetTree().Quit(1); return; }
        try
        {
            Directory.CreateDirectory(proof); NativeGlobals.Ensure();
            var town = new Node3D { Name = "LayoutOnlyTown" };
            try
            {
                var applied = NativeDistrictLayouts.Apply(town);
                Check(applied.Districts.Count > 1, "Reviewed quay and additive native districts load together");
                Check(town.GetChildCount() == applied.Districts.Count, "Only object overlays are attached; no duplicated district scenery");
                Check(applied.ObjectCount == applied.Scenes.Sum(s => s.GetChildCount()), "Authored object count agrees with wrapper children");
                var identities = new HashSet<string>(StringComparer.Ordinal);
                foreach (var state in applied.Districts)
                {
                    var captured = NativeDistrictLayouts.Capture(state.District, state.Objects);
                    Check(captured.Objects.Count == state.ObjectCount, "Valid complete object document for " + state.District.Id);
                    foreach (var authored in state.Objects.GetChildren().OfType<AuthoredObject>())
                        Check(identities.Add(authored.GetMeta("native_author_identity").AsString()), "Unique qualified identity " + state.District.Id + "/" + authored.ObjectId);
                    if (state.LayoutSource == "scene seed") continue;
                    string before = File.ReadAllText(state.Store.File);
                    var saved = state.Store.Read()!;
                    Check(captured.Encode() == saved.Encode(), "Saved complete layout takes precedence without moving objects: " + state.District.Id);
                    Check(File.ReadAllText(state.Store.File) == before, "Loading does not write the saved layout: " + state.District.Id);
                }
                int count = town.GetChildCount(); bool duplicateAttach = false;
                try { NativeDistrictLayouts.Apply(town); } catch (InvalidOperationException) { duplicateAttach = true; }
                Check(duplicateAttach && town.GetChildCount() == count, "Repeated attachment rejects duplicate overlays without changing the town");
                TestAtomicSave(applied.Districts[0].District.Catalog, Path.Combine(proof, "save-fixture"));
            }
            finally { town.Free(); }
            File.WriteAllText(Path.Combine(proof, "result.json"), JsonSerializer.Serialize(new { checks }, new JsonSerializerOptions { WriteIndented = true }));
            GD.Print("Native district layout proof passed " + checks.Count + " checks."); GetTree().Quit();
        }
        catch (Exception error)
        {
            GD.PrintErr(error);
            File.WriteAllText(Path.Combine(proof, "result.json"), JsonSerializer.Serialize(new { checks, error = error.Message }, new JsonSerializerOptions { WriteIndented = true }));
            GetTree().Quit(1);
        }
    }

    private void TestAtomicSave(AuthorCatalog catalog, string folder)
    {
        var district = new AuthorDistrict { Id = "layout-proof-fixture", Catalog = catalog };
        var asset = catalog.Assets.First(); var objects = new Node3D();
        try
        {
            var authored = new AuthoredObject { ObjectId = "proof-lamp-001", Asset = asset, Position = new(8, 0, 8) };
            objects.AddChild(authored);
            string path = Path.Combine(folder, "layout.json"); var store = new LayoutStore(path);
            var state = new NativeDistrictLayouts.DistrictState(district, objects, store, "isolated fixture");
            NativeDistrictLayouts.Save(state); string first = File.ReadAllText(path);
            authored.Position = new(9, 0, 8); NativeDistrictLayouts.Save(state);
            Check(File.ReadAllText(path + ".bak") == first, "Atomic save retains the exact previous layout as backup");
            Check(store.Read()!.Objects.Single().Position[0] == 9, "Atomic save/reload preserves the moved object");
            string valid = File.ReadAllText(path);
            var duplicate = new AuthoredObject { ObjectId = authored.ObjectId, Asset = asset, Position = new(10, 0, 8) };
            objects.AddChild(duplicate); bool rejected = false;
            try { NativeDistrictLayouts.Save(state); } catch (InvalidDataException) { rejected = true; }
            Check(rejected && File.ReadAllText(path) == valid, "Duplicate object ids cannot overwrite an existing valid save");
            objects.RemoveChild(duplicate); duplicate.Free();
            const string corrupt = "{ incomplete isolated fixture"; File.WriteAllText(path, corrupt); rejected = false;
            try { NativeDistrictLayouts.Save(state); } catch (JsonException) { rejected = true; }
            Check(rejected && !store.Writable && File.ReadAllText(path) == corrupt, "Unreadable saved layout is preserved and further writes are refused");
            Check(File.ReadAllText(path + ".bak") == first, "A rejected save leaves the previous backup untouched");
        }
        finally { objects.Free(); }
    }
}
