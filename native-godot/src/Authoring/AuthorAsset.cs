using Godot;

namespace Scheldemist.Native.Authoring;

/// <summary>The persistent asset id stays the same when its model, materials or behavior change.</summary>
[GlobalClass]
[Tool]
public partial class AuthorAsset : Resource
{
    [Export] public string Id { get; set; } = "";
    [Export] public string Title { get; set; } = "";
    [Export] public string Category { get; set; } = "Scenery";
    [Export] public PackedScene? Scene { get; set; }
    /// <summary>A conservative clearance box, measured from the object's ground origin.</summary>
    [Export] public Vector3 Footprint { get; set; } = Vector3.One;
}
