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
            Check("local directed links prepared", map.HasCachedRouteLinks, map.HasCachedRouteLinks);
            int edges = 0, differences = 0;
            for (int z = 0; z < map.D; z++) for (int x = 0; x < map.W; x++) {
                double ax = map.X0 + x + .5, az = map.Z0 + z + .5;
                if (!map.Open(ax, az)) continue;
                for (int dz = -1; dz <= 1; dz++) for (int dx = -1; dx <= 1; dx++) {
                    if (dx == 0 && dz == 0) continue;
                    WalkMap.CachedRouteLinks = false; bool original = map.CanStep(ax, az, ax + dx, az + dz);
                    WalkMap.CachedRouteLinks = true; edges++;
                    if (original != map.GridStep(ax, az, ax + dx, az + dz)) differences++;
                }
            }
            Check("cached local links equal original cliff and stair samples", differences == 0, new { edges, differences });
            int hits = grid.RouteCacheHits;
            var secondPath = grid.Path(7.5, 1.5, 7.5, 7.5);
            Check("same-frame route is reused exactly", grid.RouteCacheHits == hits + 1 && path!.SequenceEqual(secondPath!), new { hits = grid.RouteCacheHits });
            secondPath!.Clear();
            Check("caller cannot change cached waypoints", grid.Path(7.5, 1.5, 7.5, 7.5)!.SequenceEqual(path!), path!);
            hits = grid.RouteCacheHits; grid.Block(7.5, 1.5); grid.Path(7.5, 1.5, 7.5, 7.5);
            Check("closing a grid cell invalidates route answers", grid.RouteCacheHits == hits, grid.RouteCacheHits);
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
            int beforeRefreshHit = grid.RouteCacheHits;
            grid.Path(7.5, 1.5, 7.5, 7.5);
            Check("body refresh invalidates route answers within a frame", grid.RouteCacheHits == beforeRefreshHit, grid.RouteCacheHits);
            Check("crowd still avoids live cart", !map.CanStep(3.5, 1.125, 4.5, 1.125), map.CanStep(3.5, 1.125, 4.5, 1.125));
            Check("cached grid link avoids live cart", !map.GridStep(3.5, 1.5, 4.5, 1.5), map.GridStep(3.5, 1.5, 4.5, 1.5));
            moving.Position += Vector3.Right * 4; map.RefreshBodies();
            Check("cached grid link reopens after cart moves", map.GridStep(3.5, 1.5, 4.5, 1.5), map.GridStep(3.5, 1.5, 4.5, 1.5));
            moving.Position -= Vector3.Right * 4; map.RefreshBodies();
            Check("long-range support ignores temporary obstruction", map.SupportsStep(3.5, 1.125, 4.5, 1.125), map.SupportsStep(3.5, 1.125, 4.5, 1.125));
            Check("cached native links retain a route around moving bodies", Ways.Path(new Vector2(3, 1), new Vector2(5, 1)) is { Count: > 1 }, "live-body avoidance remains in Crowd");
            grid.Path(7.5, 1.5, 7.5, 7.5); hits = grid.RouteCacheHits;
            map.AddBox(3.5, 3.5, -.25, .25, -.25, .25, 0);
            grid.Path(7.5, 1.5, 7.5, 7.5);
            Check("permanent footprint invalidates route answers", grid.RouteCacheHits == hits && !map.HasCachedRouteLinks, new { hits = grid.RouteCacheHits, map.TopologyRevision });
            var pier = new Node3D { Name="BoardedPier" }; AddChild(pier);
            Plane(pier,"ground_quay",new Vector3(0,0,1),new Vector2(4,2));
            for (int board=0; board<9; board++) Plane(pier,"pier_deck",new Vector3(0,0,-.01f-board*.29f),new Vector2(2,.26f));
            Plane(pier,"pier_deck",new Vector3(0,0,-4),new Vector2(2,1));
            var pierMap=NativeWorldNavigation.Build(pier,new Rect2(-2,-5,4,7));
            Check("plank seams do not sever a wooden pier", Enumerable.Range(0,9).All(i=>pierMap.Free(.125,-.125-i*.25)),"26 cm boards, 3 cm gaps");
            Check("boarded pier still keeps bodies off its sides", !pierMap.Free(1.125,-1.125),pierMap.Free(1.125,-1.125));
            Check("real water gap does not connect another deck", !pierMap.Free(.125,-4.125),pierMap.Free(.125,-4.125));
            // A cell accepts every point, not just its centre. This vertical corner is over 40 cm from
            // the centre but under one physical body radius from the far corner of the same cell.
            var cornerCells = Enumerable.Repeat((byte)1, 4 * 4 * 16).ToArray();
            var cornerMap = WalkMap.FromNativeData(new Rect2(-2, -2, 4, 4), cornerCells, new short[4 * 4 * 4], new short[cornerCells.Length]);
            cornerMap.AddTriangles(new[] { new Vector3(.415f, 0, .415f), new Vector3(.415f, 2, .415f), new Vector3(1, 0, .415f) });
            double centreDistance = Math.Sqrt(2) * (.415 - .125), actorDistance = Math.Sqrt(2) * (.415 - .249);
            Check("corner fixture reaches a physical body beyond the old centre margin", centreDistance > .4 && actorDistance < .25, new { centreDistance, actorDistance });
            Check("triangle corner closes the entire unsafe quarter cell", !cornerMap.Free(.125, .125) && !cornerMap.Free(.249, .249), new { centreFree = cornerMap.Free(.125, .125), actorFree = cornerMap.Free(.249, .249) });
            Check("nearby clear quarter cell remains open", cornerMap.Free(-.125, .125) && cornerMap.Free(-.001, .249), new { centreFree = cornerMap.Free(-.125, .125), edgeFree = cornerMap.Free(-.001, .249) });
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
