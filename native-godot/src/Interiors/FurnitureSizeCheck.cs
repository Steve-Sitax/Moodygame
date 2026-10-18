using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Native.Authoring;
using Scheldemist.Native.World;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Native.Interiors;

/// <summary>
/// `--furniture-size-check &lt;dir&gt;` (#183): every room item drawn with a kit piece in the loaded town is measured against that
/// piece's own size. A piece stretched or squashed beyond <see cref="FurnitureVisual.MostStretch"/> on any axis fails, as does
/// any placed object scaled away from 1. Writes furniture-size.json and 13:00 pictures of the rows and misfits that were
/// stretched before; exit 1 on a failure. `--furniture-size-shots id,id` picks the items to photograph.
/// </summary>
public static class FurnitureSizeCheck
{
    private static readonly string[] DefaultShots = { "room-tavern-vliet-seat-19", "room-tavern-vliet-source-11799-33", "room-tavern-bassin-seat-11",
        "room-tavern-engel-seat-15", "room-tavern-linde-seat-23", "room-shop-clock_markt-source-11018-2", "room-shop-clock_markt-source-11018-1",
        "room-shop-apothecary_markt-source-10631-3", "room-tavern-engel-source-11888-30", "room-tavern-ankere-table-0", "room-tavern-ankere-counter",
        "room-oostershuis-source-9290-520", "room-shop-chandler_werf-source-10197-7", "room-home-cellar-fixed-0", "room-home-garret-fixed-0", "room-home-alley-fixed-0",
        "room-home-merchant-fixed-0", "room-shop-clock_markt-source-11018-5", "room-shop-bakery_rijn-source-9979-6", "room-shop-bakery_rijn-source-9979-2", "room-shop-clock_markt-source-11020-6", "room-tavern-bassin-seat-3", "room-tavern-linde-counter" };
    public static async Task Run(NativeTownGame game, string output)
    {
        Directory.CreateDirectory(output); string? error = null; var checks = new List<object>(); var items = new List<object>(); var facts = new Dictionary<string, object>();
        void Check(bool pass, string name) { checks.Add(new { name, pass }); GD.Print($"furniture-size: {(pass ? "PASS" : "FAIL")} {name}"); }
        async Task Frames(int n) { for (int i = 0; i < n; i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame); }
        async Task Wait(Func<bool> ok, int seconds) { var until = DateTime.UtcNow.AddSeconds(seconds); while (!ok()) { if (DateTime.UtcNow > until) throw new TimeoutException("furniture size wait"); await Frames(1); } }
        try
        {
            Engine.MaxFps = 30; await Wait(() => game.Loaded && ServerLink.I?.Up == true && GameState.I.Live && !Scheldemist.Menu.Loading.Busy, 160);
            Jef.I.TestInput = true; var api = ServerLink.I!.Api!;
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = 13, minute = 0, weather = "clear" })); Daylight.I.Settle();
            await Frames(30);
            var visuals = BakedWorld.All(game.World).OfType<FurnitureVisual>().Where(v => !v.ResidentSnapshot).ToArray();
            int stretched = 0, kit = 0;
            foreach (var v in visuals)
            {
                string id = (v.GetParent() as AuthoredObject)?.ObjectId ?? v.GetPath().ToString();
                bool usesKit = v.KitFit is "fit" or "kit" or "sized" or "wall" || v.KitFit.StartsWith("row ");
                var s = v.KitStretch; float worst = Math.Max(Math.Max(Worst(s.X), Worst(s.Y)), Worst(s.Z));
                bool bad = usesKit && worst > FurnitureVisual.MostStretch + 1e-3f;
                if (usesKit) kit++;
                if (bad) stretched++;
                if (usesKit || v.KitFit == "recovered")
                    items.Add(new { id, kind = v.Kind, fit = v.KitFit, size = Round(v.ModelSize), natural = Round(v.KitNatural), stretch = Round(s), scale = MathF.Round(v.KitScale, 3), worst = MathF.Round(worst, 3), bad });
            }
            Check(kit > 0, $"room items drawn with kit pieces were found ({kit} of {visuals.Length})");
            // measured on the drawn pieces themselves, not on the item's own account: each kit piece's scale on its three axes.
            // Casks and clocks come in sizes (one scale on all axes, within MostStretch of each other); every other piece keeps its
            // own size within MostStretch on each axis.
            var drawn = new List<object>(); int pieces = 0;
            foreach (var v in visuals)
                foreach (var piece in v.GetChildren().OfType<Node3D>().Where(n => n.HasMeta(FurnitureVisual.KitPieceMeta)))
                {
                    pieces++; var sc = piece.Basis.Scale;
                    float spread = Math.Max(sc.X, Math.Max(sc.Y, sc.Z)) / Math.Max(1e-4f, Math.Min(sc.X, Math.Min(sc.Y, sc.Z)));
                    bool sized = v.Kind is "cask" or "clock";
                    float off = sized ? spread : Math.Max(Math.Max(Worst(sc.X), Worst(sc.Y)), Worst(sc.Z));
                    if (off > FurnitureVisual.MostStretch + 1e-3f) drawn.Add(new { id = (v.GetParent() as AuthoredObject)?.ObjectId ?? v.GetPath().ToString(), kind = v.Kind, scale = Round(sc) });
                }
            facts["drawnPieces"] = pieces; facts["drawnStretched"] = drawn;
            Check(pieces > 0 && drawn.Count == 0, $"every drawn kit piece keeps its shape ({drawn.Count} of {pieces} stretched or squashed)");
            Check(stretched == 0, $"no kit piece stretched or squashed beyond {FurnitureVisual.MostStretch}x on an axis ({stretched} found)");
            // placed objects (town and rooms) keep the scale of their library asset
            var scaled = BakedWorld.All(game.World).OfType<AuthoredObject>().Where(o => { var sc = o.Scale; return Worst(sc.X) > 1.02f || Worst(sc.Y) > 1.02f || Worst(sc.Z) > 1.02f; })
                .Select(o => new { id = o.ObjectId, scale = Round(o.Scale) }).ToArray();
            Check(scaled.Length == 0, $"no placed object is scaled away from its library size ({scaled.Length} found)");
            // the rows and misfits that were stretched before, as drawn now
            if (!Jef.I.Fly) Jef.I.ToggleFly();
            string want = Main.I.Arg("furniture-size-shots"); var shots = want != "" ? want.Split(',') : DefaultShots;
            foreach (string id in shots)
            {
                var item = BakedWorld.All(game.World).OfType<AuthoredObject>().FirstOrDefault(o => o.ObjectId == id); if (item == null) { GD.Print("furniture-size: no item " + id); continue; }
                string room = id.Split('-').Length > 2 ? id.Substring(0, id.LastIndexOf('-', id.LastIndexOf('-') - 1)) : id;
                var near = BakedWorld.All(game.World).OfType<AuthoredObject>().Where(o => o.ObjectId.StartsWith(room + "-") && o != item).Select(o => o.GlobalPosition).ToArray();
                var centre = near.Length > 0 ? near.Aggregate(Vector3.Zero, (a, b) => a + b) / near.Length : item.GlobalPosition + item.GlobalBasis.Z * 3;
                var toward = new Vector3(centre.X - item.GlobalPosition.X, 0, centre.Z - item.GlobalPosition.Z); if (toward.LengthSquared() < .01f) toward = item.GlobalBasis.Z; toward = toward.Normalized();
                var size = item.GetChildren().OfType<FurnitureVisual>().FirstOrDefault()?.ModelSize ?? Vector3.One;
                float back = Math.Clamp(Math.Max(size.X, size.Z) * .75f + 1.4f, 2f, 4.5f);
                var target = item.GlobalPosition + Vector3.Up * Math.Clamp(size.Y * .5f, .4f, 1.4f);
                var eye = item.GlobalPosition + toward * back + Vector3.Up * 1.65f;
                game.Cam.GlobalPosition = eye; var q = new Transform3D(Basis.Identity, eye).LookingAt(target).Basis.GetRotationQuaternion();
                if (game.Cam is FlyCam fly) fly.Face(q); else game.Cam.Quaternion = q;
                await Frames(20); await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
                using var image = game.GetViewport().GetTexture().GetImage(); image.SavePng(Path.Combine(output, id + ".png"));
            }
        }
        catch (Exception e) { error = e.ToString(); GD.PrintErr(error); }
        File.WriteAllText(Path.Combine(output, "furniture-size.json"), JsonSerializer.Serialize(new { checks, error, facts, items }, new JsonSerializerOptions { WriteIndented = true }));
        game.GetTree().Quit(error == null && checks.All(c => (bool)c.GetType().GetProperty("pass")!.GetValue(c)!) ? 0 : 1);
    }
    private static float Worst(float ratio) => ratio <= 1e-4f ? float.PositiveInfinity : Math.Max(ratio, 1 / ratio);
    private static float[] Round(Vector3 v) => new[] { MathF.Round(v.X, 3), MathF.Round(v.Y, 3), MathF.Round(v.Z, 3) };
}
