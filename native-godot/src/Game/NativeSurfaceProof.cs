using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Player;
using Scheldemist.World;
using Scheldemist.Native.Authoring;
using Scheldemist.Native.Recovery;

namespace Scheldemist.Native.Game;

/// <summary>Close views rendered by the real game, with an isolated copy of the player's layout.</summary>
public static class NativeSurfaceProof
{
    public static async Task Run(NativeGame game, string output)
    {
        var rows = new List<object>();
        void Check(bool pass, string description) { rows.Add(new { pass, description }); if (!pass) throw new InvalidOperationException(description); }
        async Task Frames(int count) { for (int i = 0; i < count; i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame); }
        async Task Picture(string name, Vector3 eye, Vector3 target)
        {
            game.Cam.GlobalPosition = eye; game.Cam.LookAt(target);
            await Frames(45);
            await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
            if (game.GetViewport().GetTexture().GetImage().SavePng(Path.Combine(output, name + ".png")) != Error.Ok) throw new IOException(name);
        }
        try
        {
            Directory.CreateDirectory(output); await Frames(40); Jef.I.ToggleFly();
            var coping = ResourceLoader.Load<ArrayMesh>("res://recovered/rijnkaai-20261012/resources/r0085.res");
            Check(coping.HasMeta("native_coping_projection") && (coping.SurfaceGetFormat(0) & Mesh.ArrayFormat.FlagCompressAttributes) == 0, "coping retains full-precision positions and UVs");
            var arrays = coping.SurfaceGetArrays(0); var vertices = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array(); var normals = arrays[(int)Mesh.ArrayType.Normal].AsVector3Array(); var uv = arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();
            var top = Enumerable.Range(0, vertices.Length / 3).Select(t => t * 3).Where(t => Enumerable.Range(t, 3).All(i => vertices[i].X > 16 && vertices[i].X < 22 && Math.Abs(vertices[i].Y - 0.06f) < 0.00001f && normals[i].Y > 0.999f)).ToArray();
            Check(top.Length > 0 && top.All(t => {
                var dp1 = vertices[t + 1] - vertices[t]; var dp2 = vertices[t + 2] - vertices[t]; float det = dp1.X * dp2.Z - dp2.X * dp1.Z;
                float uAcross = ((uv[t + 2].X - uv[t].X) * dp1.X - (uv[t + 1].X - uv[t].X) * dp2.X) / det;
                return Math.Abs(uAcross) < 0.0002f;
            }), "coping joints run straight across both triangles of the top face");
            var nose = Enumerable.Range(0, vertices.Length).Where(i => vertices[i].X > 16 && vertices[i].X < 22 && vertices[i].Z < -0.1849f && vertices[i].Z > -0.2351f && vertices[i].Y > 0.0099f && normals[i].Y >= -0.0001f && normals[i].Z <= 0.0001f).ToArray();
            float radiusError = nose.Length == 0 ? 1 : nose.Max(i => Math.Abs(new Vector2(vertices[i].Z + 0.185f, vertices[i].Y - 0.01f).Length() - 0.05f));
            var angles = nose.Select(i => Math.Atan2(-normals[i].Z, normals[i].Y) / (Math.PI / 24)).ToArray();
            File.WriteAllText(Path.Combine(output, "nose.json"), JsonSerializer.Serialize(nose.Select(i => new { i, p = new[] { vertices[i].X, vertices[i].Y, vertices[i].Z }, n = new[] { normals[i].X, normals[i].Y, normals[i].Z } })));
            int normalCount = angles.Select(a => Math.Round(a)).Distinct().Count();
            Check(nose.Length > 0 && radiusError < 0.00002f && normalCount == 13 && angles.All(a => Math.Abs(a - Math.Round(a)) < 0.01), $"coping has a true 50 mm round nose with twelve strips (radius error {radiusError}, normal levels {normalCount}: {string.Join(',', angles.Select(a => Math.Round(a, 3)).Distinct().Order())})");
            var land = Enumerable.Range(0, vertices.Length).Where(i => vertices[i].X > 16 && vertices[i].X < 22 && vertices[i].Z >= 0.2379f && vertices[i].Z <= 0.2501f && vertices[i].Y >= 0.0479f && normals[i].Z >= -0.0001f).ToArray();
            Check(land.Length > 0 && land.All(i => Math.Abs(new Vector2(vertices[i].Z - 0.238f, vertices[i].Y - 0.048f).Length() - RecoveryCoping.LandRadius) < 0.00002f)
                && land.Select(i => Math.Round(Math.Atan2(normals[i].Y, normals[i].Z) / (Math.PI / 12))).Distinct().Count() == 7, "paving-side top arris has a true twelve-millimetre worn radius");
            var lower = Enumerable.Range(0, vertices.Length).Where(i => vertices[i].X > 16 && vertices[i].X < 22 && vertices[i].Z >= -0.2351f && vertices[i].Z <= -0.2249f && vertices[i].Y <= -0.2699f && normals[i].Y <= 0.0001f).ToArray();
            Check(lower.Length > 0 && lower.All(i => Math.Abs(new Vector2(vertices[i].Z + 0.225f, vertices[i].Y + 0.27f).Length() - RecoveryCoping.UnderRadius) < 0.00002f)
                && lower.Select(i => Math.Round(Math.Atan2(-normals[i].Y, -normals[i].Z) / (Math.PI / 12))).Distinct().Count() == 7, "underside outer arris has a true ten-millimetre worn radius");
            Check(vertices.Any(p => p.X > 16 && p.X < 22 && Math.Abs(p.Z) < 0.00001f && Math.Abs(p.Y + 0.28f) < 0.00001f), "underside still meets the wall at its original elevation");
            Check(coping.GetMeta("native_bevelled_corners").AsInt32() > 0 && !vertices.Any(p => Math.Abs(p.X - 104.235f) < 0.0001f && Math.Abs(p.Z + 0.235f) < 0.0001f)
                && normals.Any(n => Math.Abs(n.Y) < 0.001f && n.X > 0.70f && n.Z < -0.70f), "exposed vertical quay corners have an eight-millimetre geometric bevel");
            var material = (ShaderMaterial)coping.SurfaceGetMaterial(0);
            Check(material.GetShaderParameter("bump_tex").As<Texture2D>() != null && material.GetShaderParameter("bump_depth").AsSingle() == 0.008f, "editor coping uses the matching eight-millimetre height map");
            var casting = TownRecovery.Nodes(game.World).OfType<MeshInstance3D>().Where(m => m.Mesh != null).SelectMany(m => Enumerable.Range(0, m.Mesh!.GetSurfaceCount()).Select(m.Mesh.SurfaceGetMaterial)).OfType<ShaderMaterial>().First(m => m.HasMeta("native_surface_kind"));
            Check(casting.Shader.Code.Contains("iron_height") && casting.Shader.Code.Contains("psx_wet"), "native iron pits and wear participate in game weather and lighting");
            foreach (string path in new[] { "r0004", "r0006" })
            {
                var bollard = ResourceLoader.Load<ArrayMesh>("res://recovered/quay-models-20261012/resources/" + path + ".res");
                Check(bollard.SurfaceGetMaterial(0) is ShaderMaterial flange && flange.GetInstanceId() == bollard.SurfaceGetMaterial(1).GetInstanceId()
                    && bollard.SurfaceGetArrays(0)[(int)Mesh.ArrayType.Normal].AsVector3Array().Any(n => Math.Abs(n.X) > 0.1f && Math.Abs(n.Z) > 0.1f), path + " base has rounded corners and shares the body's iron material");
            }
            var hit = game.World.GetWorld3D().DirectSpaceState.IntersectRay(PhysicsRayQueryParameters3D.Create(new Vector3(18.46f, 0.2f, 0.9f), new Vector3(18.46f, -0.2f, 0.9f), Solid.Layer));
            Check(hit.Count > 0 && Math.Abs(hit["position"].AsVector3().Y) < 0.015f, "rust stain adds no floating collision plate above the paving");
            using (var alpha = new StandardMaterial3D { Transparency = BaseMaterial3D.TransparencyEnum.AlphaDepthPrePass })
                Check(NativeGameWorld.IsBlended(alpha), "imported depth-prepass transparency remains blended");
            var surfaceWorld = (NativeGameWorld)game.World;
            Check(surfaceWorld.AuthoredCount == (surfaceWorld.LayoutObjects ?? 14), $"the layout in use still builds all its {surfaceWorld.LayoutObjects ?? 14} objects");
            Daylight.I.SetTime(13); Daylight.I.SetWeather("clear"); Daylight.I.SetRain(0); Daylight.I.Settle();
            await Picture("01-coping-day", new Vector3(17.2f, 1.1f, -1.1f), new Vector3(18, 0.055f, 0.02f));
            await Picture("02-bollard-day", new Vector3(17.08f, 1.13f, 2.08f), new Vector3(18, 0.35f, 0.9f));
            ((NativeGameWorld)game.World).SetBumps(false);
            Check(casting.GetShaderParameter("surface_depth").AsSingle() == 0, "B switches iron relief off");
            await Picture("03-bollard-no-bump", new Vector3(17.08f, 1.13f, 2.08f), new Vector3(18, 0.35f, 0.9f));
            ((NativeGameWorld)game.World).SetBumps(true);
            Check(casting.GetShaderParameter("surface_depth").AsSingle() == 1, "B restores iron relief");
            Daylight.I.SetWeather("rain"); Daylight.I.SetRain(0.85f); Daylight.I.Settle();
            await Picture("04-bollard-rain", new Vector3(17.08f, 1.13f, 2.08f), new Vector3(18, 0.35f, 0.9f));
            await Picture("05-coping-rain", new Vector3(17.2f, 1.1f, -1.1f), new Vector3(18, 0.055f, 0.02f));
            Daylight.I.SetWeather("clear"); Daylight.I.SetRain(0); Daylight.I.Settle();
            await Picture("08-coping-land-edge", new Vector3(22.8f, 0.15f, 0.70f), new Vector3(22, 0.055f, 0.24f));
            await Picture("09-coping-underside", new Vector3(18.8f, -0.70f, -1.35f), new Vector3(18, -0.27f, 0.04f));
            await Picture("11-coping-corner", new Vector3(104.8f, -0.55f, -1.1f), new Vector3(104.18f, -0.14f, -0.14f));
            Daylight.I.SetTime(21); Daylight.I.Settle();
            await Picture("10-coping-underside-night", new Vector3(18.8f, -0.70f, -1.35f), new Vector3(18, -0.27f, 0.04f));
            File.WriteAllText(Path.Combine(output, "result.json"), JsonSerializer.Serialize(rows, new JsonSerializerOptions { WriteIndented = true }));
            GD.Print($"Surface game views: {rows.Count} checks PASS"); game.GetTree().Quit();
        }
        catch (Exception e) { GD.PrintErr(e); game.GetTree().Quit(1); }
    }

    public static async Task Workshop(WorkshopSession session, string output)
    {
        try
        {
            Directory.CreateDirectory(output); session.Camera.SetPhysicsProcess(false);
            foreach (var view in new[] {
                ("06-workshop-coping", new Vector3(17.2f, 1.1f, -1.1f), new Vector3(18, 0.055f, 0.02f)),
                ("07-workshop-bollard", new Vector3(17.08f, 1.13f, 2.08f), new Vector3(18, 0.35f, 0.9f)) })
            {
                session.Camera.Eye.GlobalPosition = view.Item2; session.Camera.Eye.LookAt(view.Item3);
                for (int i = 0; i < 12; i++) await session.ToSignal(session.GetTree(), SceneTree.SignalName.ProcessFrame);
                await session.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
                if (session.GetViewport().GetTexture().GetImage().SavePng(Path.Combine(output, view.Item1 + ".png")) != Error.Ok) throw new IOException(view.Item1);
            }
            GD.Print("Native workshop surface views: PASS"); session.GetTree().Quit();
        }
        catch (Exception e) { GD.PrintErr(e); session.GetTree().Quit(1); }
    }
}
