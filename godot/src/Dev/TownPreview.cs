using System.IO;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Dev;

/// <summary>
/// The baked town in the editor, to look at (Steve, 2026-10-11: "how come we don't see anything in the editor"). The
/// game loads the town at run time, so main.tscn is one empty node; open editor/town_preview.tscn instead. It loads
/// the same bake the game loads, with the same psx materials, but only in the editor: nothing it makes is saved in
/// the scene (no owner), and a change made here is lost. The town's source is the browser's world code: change it
/// there and bake again (tools/godot/export-scene.mjs). Loading takes a few seconds; the editor waits.
/// </summary>
[Tool]
public partial class TownPreview : Node3D
{
    /// <summary>The bake to show; empty: res://baked/next/town.glb, else res://baked/town.glb.</summary>
    [Export(PropertyHint.GlobalFile, "*.glb")]
    public string Town { get; set; } = "";

    /// <summary>Tick it to load the town again (after a new bake).</summary>
    [Export]
    public bool Reload
    {
        get => false;
        set { if (value && IsInsideTree()) Build(); }
    }

    public override void _Ready()
    {
        if (Engine.IsEditorHint()) Build();
    }

    private string Pick()
    {
        if (Town != "") return Town;
        foreach (var p in new[] { "res://baked/next/town.glb", "res://baked/town.glb" })
        {
            string file = ProjectSettings.GlobalizePath(p);
            if (File.Exists(file)) return file;
        }
        return "";
    }

    private void Build()
    {
        if (GetNodeOrNull("town") is { } old) { RemoveChild(old); old.QueueFree(); }
        string town = Pick();
        if (town == "" || !File.Exists(town) || !File.Exists(Paths.TownFacts(town)))
        {
            GD.PushWarning("TownPreview: no bake found (res://baked/next/town.glb). Bake it: node tools/godot/export-scene.mjs");
            return;
        }
        ulong t0 = Time.GetTicksMsec();
        var world = new BakedWorld { Name = "town" };
        var err = world.Load(town);
        if (err != Error.Ok)
        {
            GD.PushWarning($"TownPreview: the town did not load ({err}): {town}");
            world.Free();
            return;
        }
        AddChild(world);
        GD.Print($"TownPreview: {town} in {Time.GetTicksMsec() - t0} ms");
    }
}
