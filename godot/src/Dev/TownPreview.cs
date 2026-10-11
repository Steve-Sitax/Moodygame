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
    /// <summary>The bake to show; empty: the user argument --town, else res://baked/next/town.glb, else res://baked/town.glb.</summary>
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
        if (!Engine.IsEditorHint()) return;
        Build();
        // pictures from inside the editor, to see this view as Steve sees it:
        //   godot --editor --path godot res://editor/town_preview.tscn -- --preview-snap <dir> --views "name:x,y,z,yaw,pitch;..."
        // (yaw 0 looks to -z, 180 to +z; pitch up, degrees: as Dev/Snap.cs). The editor closes when they are written.
        var args = OS.GetCmdlineUserArgs();
        int i = System.Array.IndexOf(args, "--preview-snap"), j = System.Array.IndexOf(args, "--views");
        if (i >= 0 && i + 1 < args.Length && j >= 0 && j + 1 < args.Length) SnapViews(args[i + 1], args[j + 1]);
    }

    private async void SnapViews(string dir, string views)
    {
        Directory.CreateDirectory(dir);
        // (the editor draws only when something changes: draw every frame while the pictures are taken)
        OS.LowProcessorUsageMode = false;
        var vp = new SubViewport { Size = new Vector2I(1600, 900), RenderTargetUpdateMode = SubViewport.UpdateMode.Always };
        var cam = new Camera3D { Fov = 75, Near = 0.05f, Far = 3000, Current = true };
        vp.AddChild(cam);
        AddChild(vp);
        foreach (var one in views.Split(';', System.StringSplitOptions.RemoveEmptyEntries))
        {
            int c = one.IndexOf(':');
            if (c < 0) continue;
            var v = one[(c + 1)..].Split(',');
            float F(int k) => k < v.Length && float.TryParse(v[k], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var f) ? f : 0;
            var basis = new Basis(Vector3.Up, Mathf.DegToRad(F(3))) * new Basis(Vector3.Right, Mathf.DegToRad(F(4)));
            cam.Transform = new Transform3D(basis, new Vector3(F(0), F(1), F(2)));
            for (int k = 0; k < 20; k++) await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
            string file = Path.Combine(dir, one[..c] + ".png");
            vp.GetTexture().GetImage().SavePng(file);
            GD.Print("TownPreview picture: " + file);
        }
        RemoveChild(vp);
        vp.QueueFree();
        GetTree().Quit();
    }

    private string Pick()
    {
        if (Town != "") return Town;
        var args = OS.GetCmdlineUserArgs();
        int t = System.Array.IndexOf(args, "--town");
        if (t >= 0 && t + 1 < args.Length) return args[t + 1];
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
        // what the game's parts take care of: the bake's own player body (under its camera), and the train's wheels and
        // chains while its wagons stand in the shed at zero size (the railway part places them all)
        if (world.FindChild("Camera", true, false) is Node3D body) body.Visible = false;
        bool parked = true;
        foreach (var n in world.FindChildren("INST*_wagon*_mm", "MultiMeshInstance3D", true, false))
            if (n is MultiMeshInstance3D w && !w.Name.ToString().Contains("wheels") && !w.Name.ToString().Contains("chains")
                && w.Multimesh is { InstanceCount: > 0 } mmw && Mathf.Abs(mmw.GetInstanceTransform(0).Basis.Determinant()) > 1e-9f)
                parked = false;
        if (parked)
            foreach (var n in world.FindChildren("INST*_wagon*_mm", "MultiMeshInstance3D", true, false))
                if (n is MultiMeshInstance3D w) w.Visible = false;
        int meshes = 0, shown = 0;
        var box = new Aabb();
        foreach (var n in world.FindChildren("*", "GeometryInstance3D", true, false))
        {
            if (n is not GeometryInstance3D g) continue;
            meshes++;
            if (!g.IsVisibleInTree()) continue;
            shown++;
            var b = g.GlobalTransform * g.GetAabb();
            box = shown == 1 ? b : box.Merge(b);
        }
        GD.Print($"TownPreview: {town} in {Time.GetTicksMsec() - t0} ms, {shown} of {meshes} drawn things visible, in {box.Position} + {box.Size}");
    }
}
