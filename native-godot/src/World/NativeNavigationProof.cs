using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>Headless native navigation fixture: stairs, cliff links, authored props, roofs and overhead clearance.</summary>
public partial class NativeNavigationProof : Node3D
{
    public override void _Ready()
    {
        try
        {
            var town = new Node3D { Name = "NativeTown" };
            AddChild(town);
            Plane(town, "ground_quay", new Vector3(8, 0, 5), new Vector2(20, 14));
            Plane(town, "warehouse_roof", new Vector3(2, 4, 2), new Vector2(3, 3));
            for (int i = 0; i < 10; i++)
                Plane(town, "wall_chunk_stair_" + i, new Vector3(7, (i + 1) * 0.18f, 2 + (i + 0.5f) * 0.4f), new Vector2(2, 0.4f));
            Plane(town, "wall_chunk_landing", new Vector3(7, 1.8f, 7), new Vector2(2, 2));
            Plane(town, "wall_chunk_isolated", new Vector3(14, 6.5f, 7), new Vector2(2, 2));
            Box(town, "authored_crate", new Vector3(0, 1, 2), new Vector3(1, 2, 1));
            Box(town, "bridge_overhead", new Vector3(3, 3, 5), new Vector3(3, 0.4f, 1));
            var map = NativeWorldNavigation.Build(town, new Rect2(-2, -2, 20, 14));
            var rows = new List<object>();
            void Check(string name, bool passed, object evidence)
            {
                rows.Add(new { name, passed, evidence });
                if (!passed) throw new InvalidOperationException($"Native navigation proof failed: {name}; {JsonSerializer.Serialize(evidence)}");
            }
            Check("native town bounds", map.W == 20 && map.D == 14, new { map.X0, map.Z0, map.W, map.D });
            Check("ground free", map.Free(4.125, 1.125), map.BaseAt(4.125, 1.125));
            Check("roof excluded from support", Math.Abs(map.BaseAt(2.125, 2.125)) < 0.01 && map.Free(2.125, 2.125), map.BaseAt(2.125, 2.125));
            Check("authored crate blocks native ground", !map.Free(0.125, 2.125), map.Free(0.125, 2.125));
            Check("authored crate clearance", !map.Free(0.625, 2.125), map.Free(0.625, 2.125));
            Check("overhead beam leaves ground open", map.Free(3.125, 5.125), map.Free(3.125, 5.125));
            Check("stair first tread", Math.Abs(map.BaseAt(7.125, 2.125) - 0.18) < 0.01 && map.Free(7.125, 2.125), map.BaseAt(7.125, 2.125));
            Check("stair last tread", Math.Abs(map.BaseAt(7.125, 5.875) - 1.8) < 0.01 && map.Free(7.125, 5.875), map.BaseAt(7.125, 5.875));
            Check("raised landing connected", map.Free(7.125, 7.125) && Math.Abs(map.BaseAt(7.125, 7.125) - 1.8) < 0.01, map.BaseAt(7.125, 7.125));
            Check("isolated elevated platform refused", !map.Free(14.125, 7.125), map.Free(14.125, 7.125));
            Check("continuous stair link", map.CanStep(7.125, 1.875, 7.125, 7.125), map.CanStep(7.125, 1.875, 7.125, 7.125));
            Check("landing side cliff link refused", !map.CanStep(7.875, 7.125, 8.875, 7.125), map.CanStep(7.875, 7.125, 8.875, 7.125));
            Check("outside bounds refused", !map.Free(-3, 0) && !map.Free(19, 0), new { a = map.Free(-3, 0), b = map.Free(19, 0) });
            Check("body kept off unsupported shore edge", !map.Free(-1.875, 1.125) && map.Free(-1.375, 1.125), new { edge = map.Free(-1.875, 1.125), inland = map.Free(-1.375, 1.125) });
            var grid = new NavGrid(10); grid.Build(map, 8, 5);
            var path = grid.Path(7.5, 1.5, 7.5, 7.5);
            Check("crowd routes up stairs", path != null && path.Count > 0, path ?? new());
            Check("crowd string pulling cannot cross cliff", !grid.LineOpen(7.5, 7.5, 9.5, 7.5), grid.LineOpen(7.5, 7.5, 9.5, 7.5));
            Ways.InstallNative(map, (_, _) => false);
            Check("long range native route grid", Ways.Error == "" && Ways.Reachable(7.125, 7.125), Ways.Error);
            var longPath = Ways.Path(new Vector2(7, 1), new Vector2(7, 7));
            Check("long range route climbs native stairs", longPath != null && longPath.Count > 1, longPath?.Count ?? 0);
            var cliffPath = Ways.Path(new Vector2(7, 7), new Vector2(9, 7));
            Check("long range route goes around cliff", cliffPath != null && Ways.Length(cliffPath) > 4, cliffPath == null ? 0 : Ways.Length(cliffPath));
            Check("native flags preserve solid obstacles", Ways.Flags(0.125, 2.125) == Ways.Wall, Ways.Flags(0.125, 2.125));
            var moving = new Node3D { Name = "TemporaryCart", Position = new Vector3(4, .8f, 1) }; town.AddChild(moving);
            WalkMap.RegisterBody(moving, new Aabb(new Vector3(-.2f, -.8f, -.2f), new Vector3(.4f, 1.6f, .4f))); map.RefreshBodies();
            Check("crowd still avoids live cart", !map.CanStep(3.5, 1.125, 4.5, 1.125), map.CanStep(3.5, 1.125, 4.5, 1.125));
            Check("long-range support ignores temporary obstruction", map.SupportsStep(3.5, 1.125, 4.5, 1.125), map.SupportsStep(3.5, 1.125, 4.5, 1.125));
            Check("cached native links retain a route around moving bodies", Ways.Path(new Vector2(3, 1), new Vector2(5, 1)) is { Count: > 1 }, "live-body avoidance remains in Crowd");
            var pier = new Node3D { Name="BoardedPier" }; AddChild(pier);
            Plane(pier,"ground_quay",new Vector3(0,0,1),new Vector2(4,2));
            for (int board=0; board<9; board++) Plane(pier,"pier_deck",new Vector3(0,0,-.01f-board*.29f),new Vector2(2,.26f));
            Plane(pier,"pier_deck",new Vector3(0,0,-4),new Vector2(2,1));
            var pierMap=NativeWorldNavigation.Build(pier,new Rect2(-2,-5,4,7));
            Check("plank seams do not sever a wooden pier", Enumerable.Range(0,9).All(i=>pierMap.Free(.125,-.125-i*.25)),"26 cm boards, 3 cm gaps");
            Check("boarded pier still keeps bodies off its sides", !pierMap.Free(1.125,-1.125),pierMap.Free(1.125,-1.125));
            Check("real water gap does not connect another deck", !pierMap.Free(.125,-4.125),pierMap.Free(.125,-4.125));
            var args = OS.GetCmdlineUserArgs();
            string output = args.Length > 0 ? args[0] : ProjectSettings.GlobalizePath("res://proof/native-navigation/fixture.json");
            Directory.CreateDirectory(Path.GetDirectoryName(output)!);
            File.WriteAllText(output, JsonSerializer.Serialize(new { passed = true, checks = rows }, new JsonSerializerOptions { WriteIndented = true }));
            GD.Print($"native navigation proof: {rows.Count} checks passed; {output}");
            GetTree().Quit();
        }
        catch (Exception error) { GD.PushError(error.ToString()); GetTree().Quit(1); }
    }

    private static void Plane(Node parent, string name, Vector3 centre, Vector2 size)
    {
        var mesh = new MeshInstance3D { Name = name, Position = centre, Mesh = new PlaneMesh { Size = size } };
        mesh.SetMeta("source_name",name); parent.AddChild(mesh);
    }

    private static void Box(Node parent, string name, Vector3 centre, Vector3 size)
    {
        var body = new StaticBody3D { Name = name, Position = centre, CollisionLayer = 1 };
        body.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = size } });
        parent.AddChild(body);
    }
}
