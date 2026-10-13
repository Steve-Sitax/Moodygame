using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;

namespace Scheldemist.Play;

/// <summary>
/// `-- --leftover-scan &lt;dir&gt; --no-ai --db &lt;dir&gt;/test.sqlite`: lists everything the loaded town draws, so a leftover
/// one-time event snapshot of the bake (soot sheet, fire pump, horse template, crowd, debris ...) can be found. Writes
/// leftover-scan.json: one row per mesh (path, owner group, source name, size, place, whether it shows) and the groups the
/// game itself added at run time. With `--leftover-shot x,y,z,tx,ty,tz` (repeatable by ';') it also takes pictures
/// from those places at 13:00, clear, to see what a candidate looks like.
/// </summary>
[GamePart(993)]
public partial class LeftoverScan : Node
{
    public override void _Ready()
    {
        string dir = Main.I.Arg("leftover-scan");
        if (dir == "") return;
        _ = Run(Path.GetFullPath(dir));
    }

    private async Task Run(string dir)
    {
        Directory.CreateDirectory(dir);
        try
        {
            GD.Print("leftover-scan: waiting for the game");
            await Until(() => ServerLink.I?.Up == true && GameState.I.Live, 100);
            GD.Print("leftover-scan: game live " + GameState.I.Live);
            Jef.I.TestInput = true;
            GameState.I.PlayingWhen = () => false;
            var api = ServerLink.I!.Api!;
            await api.Post<OkReply>("api/arrival/ashore");
            Jef.I.Place(10, 12, 0);
            await Until(() => FerryArrival.I.Ashore && !Jef.I.Riding, 15);
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { hour = 13, minute = 0, weather = "clear", food = 10, sleep = 10, warmth = 10, health = 10, money_c = 500 }));
            Scheldemist.World.Daylight.I!.SetTime(13f);
            Scheldemist.World.Daylight.I.Settle();
            GD.Print("leftover-scan: ashore, settling");
            await Frames(120);
            var rows = new List<object>();
            var skip = new HashSet<Node>();
            foreach (var n in Scheldemist.World.BakedWorld.All(Main.I))
            {
                if (n is not GeometryInstance3D g) continue;
                Mesh? mesh = (g as MeshInstance3D)?.Mesh ?? (g as MultiMeshInstance3D)?.Multimesh?.Mesh;
                if (mesh == null) continue;
                Node top = n; string inWorld = "no";
                while (top.GetParent() is { } p && p != Main.I) { if (p == Main.I.World) inWorld = "yes"; top = p; }
                // group = the first two names below the world's node (e.g. town / soot)
                var chain = new List<string>(); Node c = n;
                while (c != null && c != Main.I) { chain.Add(c.Name.ToString()); c = c.GetParent(); }
                chain.Reverse();
                var box = g.GlobalTransform * mesh.GetAabb();
                string source = ""; Node q = n;
                while (q != null && q != Main.I) { if (q.HasMeta("source_name")) { source = q.GetMeta("source_name").AsString(); break; } q = q.GetParent(); }
                string mat = "";
                if (mesh.GetSurfaceCount() > 0 && ((g as MeshInstance3D)?.GetActiveMaterial(0) ?? mesh.SurfaceGetMaterial(0)) is { } m) mat = m.ResourceName + (m is ShaderMaterial sm ? " albedo=" + sm.GetShaderParameter("albedo") : "");
                rows.Add(new { path = string.Join("/", chain), top = chain.Count > 1 ? chain[1] : chain[0], inWorld, source, name = n.Name.ToString(), kind = n.GetType().Name,
                    visible = g.IsVisibleInTree(), layers = g.Layers, surfaces = mesh.GetSurfaceCount(),
                    cx = box.GetCenter().X, cy = box.GetCenter().Y, cz = box.GetCenter().Z, sx = box.Size.X, sy = box.Size.Y, sz = box.Size.Z, mat });
            }
            var tops = Main.I.World.GetChildren().Select(ch => new { name = ch.Name.ToString(), type = ch.GetType().Name, source = ch.HasMeta("source_name") ? ch.GetMeta("source_name").AsString() : "", kids = ch.GetChildCount() }).ToArray();
            var mainKids = Main.I.GetChildren().Select(ch => new { name = ch.Name.ToString(), type = ch.GetType().Name, kids = ch.GetChildCount() }).ToArray();
            File.WriteAllText(Path.Combine(dir, "leftover-scan.json"), JsonSerializer.Serialize(new { meshes = rows, worldChildren = tops, mainChildren = mainKids }, new JsonSerializerOptions { WriteIndented = true }));
            GD.Print("leftover-scan: wrote " + rows.Count + " meshes");

            if (Main.I.Arg("leftover-detail") is { Length: > 0 } detail)
                foreach (var want in detail.Split(','))
                    foreach (var n in Scheldemist.World.BakedWorld.All(Main.I.World).OfType<MeshInstance3D>().Where(m => m.Name.ToString() == want && m.Mesh != null))
                    {
                        var mesh = n.Mesh!;
                        for (int surface = 0; surface < mesh.GetSurfaceCount(); surface++)
                        {
                            var arrays = mesh.SurfaceGetArrays(surface);
                            int verts = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array().Length;
                            var sm = n.GetActiveMaterial(surface) as ShaderMaterial;
                            GD.Print($"leftover-detail {n.GetPath()} surface {surface} verts {verts} global {n.GlobalPosition} scale {n.GlobalTransform.Basis.Scale} layers {n.Layers} cast {n.CastShadow} transparency {n.Transparency} visible {n.IsVisibleInTree()} material {sm?.ResourceName} kind {(sm != null ? Scheldemist.Render.Psx.KindOf(sm.Shader) : null)} albedo {sm?.GetShaderParameter("albedo")} extras {(n.HasMeta("extras") ? n.GetMeta("extras") : "")}");
                        }
                    }
            if (Main.I.Arg("leftover-solo") is { Length: > 0 } solo)
                foreach (var top in Main.I.World.GetChild(0).GetChildren().OfType<Node3D>())
                    top.Visible = top.Name.ToString() == solo || Scheldemist.World.BakedWorld.All(top).Any(x => x.Name.ToString() == solo);
            string shots = Main.I.Arg("leftover-shot");
            if (shots != "")
            {
                int i = 0;
                foreach (var spec in shots.Split(';'))
                {
                    var v = spec.Split(',').Select(s => float.Parse(s, System.Globalization.CultureInfo.InvariantCulture)).ToArray();
                    if (!Jef.I.Fly) Jef.I.ToggleFly();
                    var cam = (FlyCam)Main.I.Cam;
                    cam.Position = new Vector3(v[0], v[1], v[2]);
                    cam.LookAt(new Vector3(v[3], v[4], v[5]));
                    cam.Face(cam.Quaternion);
                    await Frames(30);
                    GetViewport().GetTexture().GetImage().SavePng(Path.Combine(dir, $"shot-{++i}.png"));
                }
            }
        }
        catch (Exception e) { GD.PrintErr("leftover-scan failed: " + e); }
        GetTree().Quit();
    }

    private async Task<bool> Until(Func<bool> test, double seconds) { ulong end = Time.GetTicksMsec() + (ulong)(seconds * 1000); while (Time.GetTicksMsec() < end) { if (test()) return true; await Frames(1); } return test(); }
    private async Task Frames(int n) { for (int i = 0; i < n; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame); }
}
