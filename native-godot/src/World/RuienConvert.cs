using System;
using System.Linq;
using Godot;
using Scheldemist.World.Ruien;

namespace Scheldemist.Native.World;

/// <summary>
/// The Ruien's one-time conversion of a Blender export into game resources (docs/ruien-native.md), headless:
///   godot --headless --path native-godot res://world/ruien/convert.tscn -- --ruien-textures &lt;export/textures&gt;
///   godot --headless --path native-godot res://world/ruien/convert.tscn -- --ruien-area &lt;export folder&gt; --area o2
/// It writes under res://world/ruien and quits; the game itself only loads what it wrote.
/// </summary>
public partial class RuienConvert : Node
{
    public override async void _Ready()
    {
        var args = OS.GetCmdlineUserArgs();
        string Arg(string k) => Array.IndexOf(args, "--" + k) is var i and >= 0 && i + 1 < args.Length ? args[i + 1] : "";
        int code = 0;
        try
        {
            if(Arg("ruien-uv-audit") is {Length:>0} audit)RuienUv.Audit(audit,Arg("report"));
            if(args.Contains("--ruien-paving-textures")) RuienPaving.PrepareTextures();
            if(Arg("ruien-screen") is {Length:>0} screen) RuienRepair.Screen(screen);
            if (Arg("ruien-repair") is { Length: > 0 } repair)
                RuienRepair.Convert(repair, Arg("area") is { Length: > 0 } repairArea ? repairArea : "o2", Arg("headers"));
            if (Arg("ruien-textures") is { Length: > 0 } tex)
                GD.Print("ruien convert: textures " + string.Join(", ", RuienTextures.Convert(tex)));
            if (Arg("ruien-area") is { Length: > 0 } area)
                GD.Print("ruien convert: area " + RuienImport.Convert(area, Arg("area") is { Length: > 0 } id ? id : "o2", Arg("lods") is { Length: > 0 } ls ? ls : "0"));
            if (Arg("ruien-kit") is { Length: > 0 } kit)
                GD.Print("ruien convert: kit " + RuienImport.ConvertKit(kit, Arg("pieces")));
            if (args.Contains("--ruien-shader-check"))
            {
                // (dev: the three kinds compiled on a quad each in a real window, a few frames, then quit)
                Ruien.EnsureGlobals();
                foreach (var name in new[] { "ruien_brick_stretcher", "ruien_misc_water", "ruien_misc_Lamp_flame" })
                    AddChild(new MeshInstance3D { Mesh = new BoxMesh { Material = RuienMaterials.Get(name) } });
                AddChild(new MeshInstance3D { Mesh = new BoxMesh { Material = RuienMaterials.Beam(Colors.White, Vector3.Zero, Vector3.Down, 2, 0.3f) } });
                AddChild(new MeshInstance3D { Mesh = new BoxMesh { Material = RuienMaterials.Mist(-Vector3.One, Vector3.One, 0.2f) } });
                AddChild(new Camera3D { Position = new Vector3(0, 0, 3), Current = true });
                for (int i = 0; i < 5; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
                GD.Print("ruien convert: shader check done");
            }
        }
        catch (Exception e)
        {
            GD.PrintErr("ruien convert: " + e);
            code = 1;
        }
        GetTree().Quit(code);
    }
}
