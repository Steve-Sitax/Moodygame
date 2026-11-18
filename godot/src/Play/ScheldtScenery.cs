using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.World;
namespace Scheldemist.Play;
// Offline-authored meshes and primitive colliders; no geometry is rebuilt during launch.
[GamePart(970)]
public partial class ScheldtScenery : Node
{
 public const string Scene="res://assets/river-20261117/scenery.scn";
 public const string GroundMaterial="res://assets/river-20261117/bank-ground.res";
 public static IEnumerable<string> Resources()=>new[]{Scene,GroundMaterial};
 public override void _Ready()
 {
  if(!ResourceLoader.Exists(Scene))return;
  using var time=Dev.StartupTiming.Measure("river.scenery.load");
  Main.I.View.AddChild(ResourceLoader.Load<PackedScene>(Scene).Instantiate<Node3D>());
  // Retain the authored shore mesh, IDs and collision; repair its surface and distant haze together.
  if(BakedWorld.All(Main.I.World).OfType<MeshInstance3D>().FirstOrDefault(n=>n.Name=="far_bank_land") is {} bank)
   bank.MaterialOverride=ResourceLoader.Load<Material>(GroundMaterial);
  SetProcess(false);
 }
}
