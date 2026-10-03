using Godot;
using Scheldemist.Models;

namespace Scheldemist.People;

/// <summary>Temporary: prints what Godot makes of people.glb.</summary>
[GamePart(900)]
public partial class PeopleProbe : Node
{
    public override void _Ready()
    {
        if (!Main.I.Flag("peopleprobe")) return;
        var m = ModelLibrary.Get("people", new ModelLibrary.Look(TwoSided: true));
        if (m == null) { GetTree().Quit(1); return; }
        GD.Print($"people: {m.Roots.Count} roots, {m.Clips.Count} clips, {m.Materials} materials, {m.LoadMs:F0} ms");
        foreach (var l in ModelLibrary.Describe(m.Roots["baker"])) GD.Print(l);
        foreach (var l in ModelLibrary.Describe(m.Roots["boy"])) GD.Print(l);
        var a = m.Clips["walk"];
        GD.Print($"walk: len {a.Length} tracks {a.GetTrackCount()} loop {a.LoopMode}");
        for (int i = 0; i < a.GetTrackCount(); i++) GD.Print($"  {a.TrackGetType(i)} {a.TrackGetPath(i)} keys {a.TrackGetKeyCount(i)}");
        var sk = m.Roots["baker"].FindChild("Skeleton3D", true, false) as Skeleton3D;
        if (sk != null) for (int i = 0; i < sk.GetBoneCount(); i++) GD.Print($"  bone {sk.GetBoneName(i)} parent {sk.GetBoneParent(i)} rest {sk.GetBoneRest(i).Origin} rot {sk.GetBoneRest(i).Basis.GetRotationQuaternion()}");
        GetTree().Quit();
    }
}
