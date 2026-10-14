using Godot;

namespace Scheldemist.Native.Authoring;

/// <summary>The persistent asset id stays the same when its model, materials or behavior change.</summary>
[GlobalClass]
[Tool]
public partial class AuthorAsset : Resource
{
    [Export] public bool GeometryClearance {get;set;}
    [Export] public Vector3 PlacementAnchor {get;set;}
    [Export] public string Id { get; set; } = "";
    [Export] public string Title { get; set; } = "";
    [Export] public string Category { get; set; } = "Scenery";
    [Export] public PackedScene? Scene { get; set; }
    /// <summary>A conservative clearance box, measured from the object's ground origin.</summary>
    [Export] public Vector3 Footprint { get; set; } = Vector3.One;
    /// <summary>Offset from the asset origin to its clearance box; old models need not be centred.</summary>
    [Export] public Vector3 FootprintOffset { get; set; } = Vector3.Zero;
    [Export] public string FurnitureKind { get; set; } = "";
    [Export] public Vector3[] SeatPoints { get; set; } = System.Array.Empty<Vector3>();
    [Export] public float SeatHeight { get; set; } = 0.46f;
    [Export] public float SeatYaw { get; set; }
    [Export] public int Table { get; set; } = -1;
    [Export] public Vector3 UsePoint { get; set; }
    [Export] public Vector3 StandPoint { get; set; }
    [Export] public Vector3 KeeperPoint { get; set; }
}
