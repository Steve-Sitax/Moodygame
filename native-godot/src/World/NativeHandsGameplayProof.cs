using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Play;
using Scheldemist.Town;
using Scheldemist.World;
using Scheldemist.Native.Services;

namespace Scheldemist.Native.World;

/// <summary>A real hired worker approaches, lifts and delivers through the normal Godot walker and native API.</summary>
public static class NativeHandsGameplayProof
{
    public static async Task Run(NativeTownGame game, string output)
    {
        var checks = new List<object>(); var transitions = new List<object>();
        void Check(string name, bool passed) { checks.Add(new { name, passed }); if (!passed) throw new InvalidOperationException(name); }
        async Task Frames(int count) { for (int i = 0; i < count; i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame); }
        try {
            // This fixture deliberately changes the test world. Never run it against a real save.
            Check("hired-hand proof uses its own isolated database", Path.GetFullPath(Paths.Database).StartsWith(Path.GetFullPath(output) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase));
            var api = ServerLink.I!.Api!; var town = game.GetNode<Townspeople>("Townspeople");
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day=1, hour=13, minute=0, weather="clear", money_c=1000 }));
            await Frames(3); Daylight.I.Settle();
            var state = await api.Jobs();
            var job = state.Jobs.First(j => j.Status == "offered" && j.Task is {} task && task.GetProperty("kind").GetString() == "carry"
                && task.GetProperty("from").GetString() != "ship_gangway" && (!task.TryGetProperty("cart", out var cart) || cart.ValueKind != JsonValueKind.True));
            await api.Take(job.Id); await Frames(30);
            var goods = Goods.I.Items.First(item => item.JobId == job.Id && !Goods.I.Above(item));
            var spots = JsonNode.Parse(File.ReadAllText(Path.Combine(Paths.NativeDataRoot!, "services", "native-goods.json")))!["spots"]!;
            var approaches = new[] { "from", "to" }.Select(key => {
                string id = job.Task!.Value.GetProperty(key).GetString()!; var spot = spots[id]!;
                double x = NativeGoods.N(spot,"x"), z = NativeGoods.N(spot,"z");
                var near = Ways.NearestOpen(x,z,4);
                return new { id,x,z,free=game.World.NativeWalk!.PathFree(x,z),flags=Ways.Flags(x,z),reachable=Ways.Reachable(x,z),near=near.HasValue?new[]{near.Value.X,near.Value.Y}:null };
            }).ToArray();
            transitions.Add(new { approaches });
            var support = BakedWorld.All(game.World).OfType<MeshInstance3D>().Where(m => m.Mesh != null && (m.Name.ToString().Contains("pier") || (m.HasMeta("source_name") && m.GetMeta("source_name").AsString().Contains("pier"))))
                .Select(m => new { name=m.Name.ToString(), source=m.HasMeta("source_name")?m.GetMeta("source_name").AsString():"", visible=m.IsVisibleInTree(),box=(m.GlobalTransform*m.Mesh!.GetAabb()).ToString() }).ToArray();
            transitions.Add(new { pierMeshes=support });
            game.Cam.GlobalPosition = new Vector3(goods.X + 9, goods.Y + 5, goods.Z + 9);
            if (game.Cam is FlyCam fly) fly.Face(new Transform3D(Basis.Identity, game.Cam.GlobalPosition).LookingAt(new Vector3(goods.X, goods.Y + 1, goods.Z)).Basis.GetRotationQuaternion());
            Jef.I.Place(goods.X + 7, goods.Z + 7, 0, near: goods.Y); await Frames(45);
            // The authored facts choose a dependable adult; they do not supply any test responses.
            var seed = JsonNode.Parse(File.ReadAllText(Path.Combine(Paths.NativeDataRoot!, "services", "native-seed.json")))!;
            var worker = seed["tables"]!["resident"]!.AsArray().Select(row => JsonNode.Parse(row!["data_json"]!.GetValue<string>())!.AsObject())
                .First(person => NativeGoods.N(person,"age") is >=18 and <=55 && NativeGoods.N(person["stats"],"wealth") <=3
                    && NativeGoods.N(person["stats"],"honesty") >=6 && NativeGoods.N(person["stats"],"greed") <7
                    && NativeGoods.S(person,"trade") is "docker" or "natie" or "porter" && town.ActionPerson(NativeGoods.S(person,"id")) != null);
            string npc = NativeGoods.S(worker,"id"); var sim = town.ActionPerson(npc)!;
            var hired = await api.Post<JsonElement>("api/dev/action", new { npc, kind="work_for_pay", asked_words="I pay 300 centimes to carry my goods, half now", amount_c=300 });
            transitions.Add(new { hiring = hired, npc, job=job.Id, task=job.Task });
            Check("real hiring rules accept worker", hired.TryGetProperty("action_id", out var action) && action.ValueKind == JsonValueKind.Number);
            int actionId = action.GetInt32(); var start = Ways.NearestOpen(goods.X, goods.Z + 9, 4) ?? throw new InvalidOperationException("No native approach beside the job goods.");
            town.ActionHide(sim); sim.X = start.X; sim.Z = start.Y; sim.Inside = false;
            await Hands.I!.Poll(); var deadline = DateTime.UtcNow.AddSeconds(120); bool lifted=false, visibleLoad=false, delivered=false; int previous=-1;
            double firstX=sim.X, firstZ=sim.Z; bool moved=false;
            while (DateTime.UtcNow < deadline) {
                await Frames(12);
                moved |= Math.Sqrt(Math.Pow(sim.X-firstX,2)+Math.Pow(sim.Z-firstZ,2)) > 2;
                var routine = Hands.I.Routines.FirstOrDefault(r => r.Id == actionId);
                if (routine != null && routine.I != previous) { previous=routine.I; transitions.Add(new { step=routine.I, kind=routine.Step?.Kind, x=sim.X, z=sim.Z, holding=routine.Holding }); }
                bool holds = Goods.I.All.Values.Any(item => item.JobId == job.Id && item.S.By is { ValueKind: JsonValueKind.Object } holder && holder.TryGetProperty("npc", out var owner) && owner.GetString() == npc);
                lifted |= holds; visibleLoad |= holds && sim.P is { Loaded:true };
                var now = (await api.Jobs()).Jobs.First(j=>j.Id==job.Id);
                delivered = now.Task is {} task && task.TryGetProperty("progress",out var progress) && progress.TryGetProperty("delivered",out var count) && count.GetInt32()>0;
                if (delivered) break;
                if (routine == null && transitions.Count > 0) break;
            }
            Check("worker moves on the native crowd grid", moved);
            Check("worker lifts an actual stable job goods ID", lifted);
            Check("carried goods have a visible load on the worker", visibleLoad);
            Check("physical delivery increases authoritative job progress", delivered);
            File.WriteAllText(Path.Combine(output,"hands.json"),JsonSerializer.Serialize(new { passed=true,npc,job=job.Id,checks,transitions }));
            GD.Print($"Native hired-hand gameplay: {checks.Count} checks PASS");
        } catch(Exception error) {
            File.WriteAllText(Path.Combine(output,"hands.json"),JsonSerializer.Serialize(new { passed=false,error=error.ToString(),checks,transitions })); throw;
        }
    }
}
