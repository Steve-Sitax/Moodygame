using Godot;
using System.Text.Json;

namespace Scheldemist.Native.Authoring;

/// <summary>The wrapper is saved by the Godot editor; its asset supplies the reusable model and behavior.</summary>
[Tool]
[GlobalClass]
public partial class AuthoredObject : Node3D
{
    [Export] public string ObjectId { get; set; } = "";
    [Export] public string SeedPlacement {get;set;}="";
    private AuthorAsset? asset;
    [Export] public AuthorAsset? Asset
    {
        get => asset;
        set { asset = value; if (IsInsideTree()) Build(); }
    }
    private Node3D? visual;

    public override void _Ready()
    {
        if(SeedPlacement!="")Pose(JsonSerializer.Deserialize<Placement>(SeedPlacement)!);
        Build();
    }

    private void Build()
    {
        if (visual != null) { RemoveChild(visual); visual.QueueFree(); visual = null; }
        if (asset?.Scene?.Instantiate() is not Node3D model) return;
        visual = model;
        model.Name = "Asset";
        AddChild(model);
    }

    public Placement Record() => !IsInsideTree()&&SeedPlacement!=""?JsonSerializer.Deserialize<Placement>(SeedPlacement)!:new()
    {
        Id = ObjectId, Asset = asset!.Id,
        Position = LayoutDocument.Floats(Position), Rotation = LayoutDocument.Floats(Rotation), Scale = LayoutDocument.Floats(Scale)
    };

    public void Pose(Placement record)
    {
        Position = LayoutDocument.Vector(record.Position);
        Rotation = LayoutDocument.Vector(record.Rotation);
        Scale = LayoutDocument.Vector(record.Scale);
    }
}
