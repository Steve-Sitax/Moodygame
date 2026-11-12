using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Godot;
using Scheldemist;
using Scheldemist.Dev;
using Scheldemist.World.Ruien;

/// <summary>Compare every planned bridge with fresh construction, including full vertex attributes and moving collision.</summary>
public partial class RuienBridgeCacheProof : Node
{
    public override void _Ready()
    {
        Main? game = null;
        try
        {
            var args = OS.GetCmdlineUserArgs(); string Arg(string key) => args[Array.IndexOf(args, key) + 1];
            game = new Main();
            typeof(Main).GetProperty("I")!.SetValue(null, game);
            var arguments = typeof(Main).GetField("arguments", BindingFlags.NonPublic | BindingFlags.Instance)!;
            var models = (IDictionary)typeof(RuienFoldBridge).GetField("Models", BindingFlags.NonPublic | BindingFlags.Static)!.GetValue(null)!;
            var data = RuienData.Load();
            var specs = data.Areas.SelectMany(a => a.Bridges).ToArray();
            if (specs.Length == 0) throw new Exception("Fixture has no bridges");
            var differences = new List<string>();
            int meshes = 0, surfaces = 0, collisionShapes = 0;
            string Digest(RuienFoldBridge bridge)
            {
                using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
                void Bytes(Variant value) => hash.AppendData(GD.VarToBytes(value));
                void Text(string value) => hash.AppendData(Encoding.UTF8.GetBytes(value + "\n"));
                void Visit(Node node)
                {
                    Text(node.GetType().Name); Bytes(node.GetChildCount());
                    if (node is Node3D n) Bytes(n.Transform);
                    if (node is MeshInstance3D mi)
                    {
                        meshes++; Bytes(mi.Layers); Bytes((int)mi.CastShadow);
                        Bytes(mi.Mesh.GetSurfaceCount());
                        for (int i = 0; i < mi.Mesh.GetSurfaceCount(); i++)
                        {
                            surfaces++; Bytes((int)((ArrayMesh)mi.Mesh).SurfaceGetPrimitiveType(i));
                            using var arrays = mi.Mesh.SurfaceGetArrays(i); Bytes(arrays);
                            var material = mi.Mesh.SurfaceGetMaterial(i);
                            Text(material?.ResourceName ?? "");
                            if (material == null || material != RuienMaterials.Get(material.ResourceName))
                                differences.Add(bridge.Spec.Id + ": material is not shared live material");
                        }
                    }
                    if (node is StaticBody3D body) { Text(body.Name); Bytes(body.CollisionLayer); Bytes(body.CollisionMask); }
                    if (node is CollisionShape3D shape && shape.Shape is ConcavePolygonShape3D poly)
                    { collisionShapes++; Bytes(poly.Data); Bytes(poly.BackfaceCollision); }
                    foreach (var child in node.GetChildren()) Visit(child);
                }
                Visit(bridge);
                foreach (float phase in new[] { 0f, .5f, 1f })
                {
                    RuienFoldBridge.ProofPhase = phase; bridge._PhysicsProcess(1 / 60.0);
                    Bytes(bridge.GetNode<Node3D>("leaf_a").Transform); Bytes(bridge.GetNode<Node3D>("leaf_b").Transform);
                    Bytes(bridge.Phase);
                }
                return Convert.ToHexString(hash.GetHashAndReset());
            }
            Dictionary<string, string> Pass(bool uncached)
            {
                models.Clear(); arguments.SetValue(game, uncached ? new[] { "--no-startup-cache" } : args);
                var result = new Dictionary<string, string>();
                foreach (var spec in specs)
                {
                    var bridge = RuienFoldBridge.Build(spec, data.Bridge);
                    try { result.Add(spec.Id, Digest(bridge)); }
                    finally { bridge.Free(); }
                }
                return result;
            }
            var reference = Pass(true);
            int priorBuilds = StartupTiming.Snapshot().Count(e => e.Stage == "ruien.bridge-model.build");
            var actual = Pass(false);
            int built = StartupTiming.Snapshot().Count(e => e.Stage == "ruien.bridge-model.build") - priorBuilds;
            foreach (var (id, digest) in reference) if (actual[id] != digest) differences.Add(id + ": cached geometry or collision differs");
            int expected = int.Parse(Arg("--expected-builds"));
            if (expected < 0) expected = models.Count;
            if (built != expected) differences.Add($"Expected {expected} builds, got {built}");
            var cache = typeof(RuienData).Assembly.GetType("Scheldemist.World.Ruien.RuienGeometryCache")!;
            var fileMethod = cache.GetMethod("CacheFile", BindingFlags.NonPublic | BindingFlags.Static)!;
            var kind = (string)typeof(RuienFoldBridge).GetField("ModelCacheKind", BindingFlags.NonPublic | BindingFlags.Static)!.GetRawConstantValue()!;
            var files = models.Keys.Cast<string>().Select(key => (string)fileMethod.Invoke(null,
                new object[] { RuienData.AreasFile, kind + key, ".scn" })!).ToArray();
            File.WriteAllText(Arg("--out"), JsonSerializer.Serialize(new { pass = differences.Count == 0, bridges = specs.Length,
                shapes = models.Count, built, expected, meshes, surfaces, collisionShapes, differences, digests = actual, files }, new JsonSerializerOptions { WriteIndented = true }));
            GD.Print($"BRIDGE CACHE PROOF: {specs.Length} bridges, {models.Count} shapes, {built} builds, {differences.Count} differences");
            GetTree().Quit(differences.Count == 0 ? 0 : 1);
        }
        catch (Exception e) { GD.PrintErr(e); GetTree().Quit(1); }
        finally { RuienFoldBridge.ProofPhase = null; typeof(Main).GetProperty("I")!.SetValue(null, null); game?.Free(); }
    }
}
