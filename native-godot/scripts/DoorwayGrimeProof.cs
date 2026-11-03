using Godot;
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using Scheldemist;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Play;
using Scheldemist.Player;
using Scheldemist.Render;
using Scheldemist.World;
using Scheldemist.Native.World;

/// <summary>Native review scene: hold shop/tavern doors open and inspect weathering across their openings.
/// Writes only to --doorway-record; never edits the world or the player's settings.</summary>
public partial class DoorwayGrimeProof : Node
{
    // Review only: remove the four damp/moss/salt atlas cells, preserving posters and lettering
    // that share streetlife_walldecal. Atlas coordinates are top-left native UVs (256 x 512).
    private static ArrayMesh WithoutWeathering(ArrayMesh source)
    {
        var result = new ArrayMesh();
        foreach (var key in source.GetMetaList()) result.SetMeta(key, source.GetMeta(key));
        var cells = new[] { new Rect2(128, 88, 64, 32), new Rect2(192, 88, 64, 32),
            new Rect2(0, 176, 64, 32), new Rect2(64, 176, 64, 32) };
        for (int s = 0; s < source.GetSurfaceCount(); s++)
        {
            var arrays = source.SurfaceGetArrays(s);
            if (source.SurfaceGetMaterial(s)?.ResourceName == "streetlife_walldecal")
            {
                var uv = arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();
                var value = arrays[(int)Mesh.ArrayType.Index];
                var ix = value.VariantType == Variant.Type.Nil ? Enumerable.Range(0, uv.Length).ToArray() : value.AsInt32Array();
                var keep = new List<int>();
                for (int i = 0; i < ix.Length; i += 3)
                {
                    var at = (uv[ix[i]] + uv[ix[i+1]] + uv[ix[i+2]]) / 3 * new Vector2(256, 512);
                    if (!cells.Any(c => c.HasPoint(at))) keep.AddRange(new[] { ix[i], ix[i+1], ix[i+2] });
                }
                if (keep.Count == 0) continue;
                arrays[(int)Mesh.ArrayType.Index] = keep.ToArray();
            }
            result.AddSurfaceFromArrays(source.SurfaceGetPrimitiveType(s), arrays, null, null, source.SurfaceGetFormat(s));
            result.SurfaceSetMaterial(result.GetSurfaceCount()-1, source.SurfaceGetMaterial(s));
        }
        return result;
    }

    private async Task Frames(int count)
    {
        for (int i = 0; i < count; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
    }

    public override async void _Ready()
    {
        try
        {
            var game = (NativeTownGame)GetParent();
            var deadline = DateTime.UtcNow.AddSeconds(1200);
            while (!game.Loaded || ServerLink.I?.Up != true || !GameState.I.Live || Scheldemist.Menu.Loading.Busy || Doors.I == null)
            {
                if (DateTime.UtcNow > deadline) throw new TimeoutException("Doorway proof startup");
                await Frames(1);
            }
            string output = Main.I.Arg("doorway-record");
            if (string.IsNullOrWhiteSpace(output)) throw new ArgumentException("--doorway-record <external directory>");
            Directory.CreateDirectory(output);
            Engine.MaxFps = 30;
            Jef.I.TestInput = true;
            GameState.I.Apply(await ServerLink.I!.Api!.Post<JobsPayload>("api/dev/set", new { day = 1, hour = 13, minute = 0, weather = "clear" }));
            Daylight.I.Settle();
            await Frames(60);
            Doors.I.Held = true;
            var doors = Doors.I.All.Where(d => d.Leaves.Count == 1 &&
                (d.Id.StartsWith("shop") || d.Id.StartsWith("tavern"))).ToArray();
            foreach (var door in doors) Doors.I.Force(door, true);
            var rows = new List<object>();
            foreach (var door in doors)
            {
                var hinge = door.Leaves[0].Hinge;
                var frame = (Node3D)hinge.GetParent();
                var inverse = frame.GlobalTransform.AffineInverse();
                var was = hinge.Rotation;
                hinge.Rotation = new Vector3(was.X, 0, was.Z);
                Aabb? box = null;
                foreach (var mi in BakedWorld.All(hinge).OfType<MeshInstance3D>().Where(m => m.Mesh != null))
                {
                    var part = (inverse * mi.GlobalTransform) * mi.Mesh.GetAabb();
                    box = box == null ? part : box.Value.Merge(part);
                }
                hinge.Rotation = was;
                if (box == null) continue;
                var bounds = box.Value;
                var lo = bounds.Position - new Vector3(.005f, .2f, .6f);
                var hi = bounds.End + new Vector3(.005f, .01f, .6f);
                var worldBox = frame.GlobalTransform * new Aabb(lo, hi - lo);
                var intersections = new List<object>();
                foreach (var mi in BakedWorld.All(GetTree().Root).OfType<MeshInstance3D>().Where(m => m.Mesh is ArrayMesh))
                {
                    if (!(mi.GlobalTransform * mi.Mesh.GetAabb()).Intersects(worldBox)) continue;
                    for (int s = 0; s < mi.Mesh.GetSurfaceCount(); s++)
                    {
                        var material = mi.GetActiveMaterial(s) as ShaderMaterial;
                        string code = material?.Shader?.Code ?? "";
                        if (!code.Contains("blend_mul") && !code.Contains("depth_draw_never")) continue;
                        var arrays = mi.Mesh.SurfaceGetArrays(s);
                        var xf = inverse * mi.GlobalTransform;
                        var planes = new List<Func<Vector3, float>> { p => p.X - lo.X, p => hi.X - p.X,
                            p => p.Y - lo.Y, p => hi.Y - p.Y, p => p.Z - lo.Z, p => hi.Z - p.Z };
                        int count = QuayNotch.CutSurfaceWith(arrays, xf, _ => true, planes);
                        if (count == 0) continue;
                        intersections.Add(new { node = mi.GetPath().ToString(), mesh = mi.Mesh.ResourcePath,
                            material = material!.ResourceName, surface = s, triangles = count, shown = mi.IsVisibleInTree() });
                    }
                }
                rows.Add(new { door = door.Id, middle = new[] { door.Middle.X, door.Middle.Y, door.Middle.Z }, intersections });
            }
            File.WriteAllText(Path.Combine(output, "doorway-overlays.json"), JsonSerializer.Serialize(rows, new JsonSerializerOptions { WriteIndented = true }));
            bool compare = Main.I.Flag("doorway-compare");
            var decals = BakedWorld.All(GetTree().Root).OfType<MeshInstance3D>().Where(m => m.Mesh is ArrayMesh &&
                Enumerable.Range(0, m.Mesh.GetSurfaceCount()).Any(s => m.GetActiveMaterial(s)?.ResourceName == "streetlife_walldecal"))
                .Select(m => (Node: m, Original: m.Mesh, Filtered: WithoutWeathering((ArrayMesh)m.Mesh), Shown: m.Visible)).ToArray();
            async Task Shot(string name, Vector3 eye, Vector3 target)
            {
                game.Cam.GlobalPosition = eye;
                var rotation = new Transform3D(Basis.Identity, eye).LookingAt(target).Basis.GetRotationQuaternion();
                if (game.Cam is FlyCam fly) fly.Face(rotation); else game.Cam.Quaternion = rotation;
                await Frames(25);
                await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
                using var picture = game.GetViewport().GetTexture().GetImage();
                picture.SavePng(Path.Combine(output, name + ".png"));
                GD.Print("doorway proof: " + name);
            }
            foreach (string weather in compare ? new[] { "day", "rain", "night" } : new[] { "day" })
            {
            GameState.I.Apply(await ServerLink.I!.Api!.Post<JobsPayload>("api/dev/set", new { day = 1, hour = weather == "night" ? 22 : 13, minute = 0, weather = weather == "rain" ? "rain" : "clear" }));
            Daylight.I.Settle();
            foreach (var door in doors)
            {
                string pick = Main.I.Arg("doorway-pick");
                if (pick != "" && !pick.Split(',').Any(p => door.Id.Contains(p))) continue;
                var frame = (Node3D)door.Leaves[0].Hinge.GetParent();
                var middle = door.Middle;
                var outward = new Vector3(door.Step.X - middle.X, 0, door.Step.Y - middle.Z);
                if (outward.LengthSquared() < .01f) outward = -frame.GlobalBasis.Z;
                outward = outward.Normalized();
                Jef.I.Place(middle.X + outward.X * 2.8f, middle.Z + outward.Z * 2.8f, 0, 0, .18f);
                if (!Jef.I.Fly) Jef.I.ToggleFly();
                await Frames(20);
                var eye = new Vector3(middle.X, 1.65f, middle.Z) + outward * 2.8f;
                string name = door.Id.Replace(':', '_');
                if (!compare) await Shot(name + "-open", eye, middle);
                else
                {
                    var side = new Vector3(outward.Z, 0, -outward.X);
                    foreach (string angle in new[] { "front", "oblique" })
                    {
                        var at = angle == "front" ? eye : eye + side * 1.35f;
                        await Shot($"{name}-{weather}-{angle}-with", at, middle);
                        foreach (var decal in decals)
                        {
                            decal.Node.Mesh = decal.Filtered;
                            decal.Node.Visible = decal.Shown && decal.Filtered.GetSurfaceCount() > 0;
                        }
                        await Shot($"{name}-{weather}-{angle}-without", at, middle);
                        foreach (var decal in decals) { decal.Node.Mesh = decal.Original; decal.Node.Visible = decal.Shown; }
                    }
                }
            }
            }
            File.WriteAllText(Path.Combine(output, "complete.json"), JsonSerializer.Serialize(new { doors = doors.Length, complete = true }));
            GetTree().Quit();
        }
        catch (Exception e) { GD.PrintErr(e); GetTree().Quit(1); }
    }
}
