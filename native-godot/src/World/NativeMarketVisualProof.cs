using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.People;
using Scheldemist.World;

namespace Scheldemist.Native.World;

public static class NativeMarketVisualProof
{
    public static async Task Run(NativeTownGame game, string output)
    {
        if (!Path.GetFullPath(Paths.Database).StartsWith(Path.GetFullPath(".scratch", Path.GetDirectoryName(ProjectSettings.GlobalizePath("res://").TrimEnd('/','\\'))!) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Market review needs an isolated scratch save.");
        Directory.CreateDirectory(output);
        async Task Frames(int n)
        {
            for (int i=0; i<n; i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame);
        }
        var stalls = MarketStalls.I!;
        await Scheldemist.Dev.Kit.I.Light(9,"clear", day:1);
        for(int i=0; i<600 && !stalls.List.Any(s=>s.Open); i++) await Frames(1);
        var market = stalls.List.First(s=>s.Open && game.GetNode<Town.Townspeople>("Townspeople").Data!.Stalls.Any(t=>t.Place==s.Label));
        var shop = stalls.List.Where(s=>game.GetNode<Town.Townspeople>("Townspeople").Data!.Shops.Any(t=>t.Id==s.Label)).OrderByDescending(s=>s.Open).ThenByDescending(s=>s.Scale).FirstOrDefault();
        var camera = new Camera3D { Fov=58, Near=.025f };
        game.View.AddChild(camera);
        camera.MakeCurrent();
        var parts = Scheldemist.Models.ModelLibrary.Get("stalls")!;
        var materials = new[]{"stall_frame","shop_table","stall_awning","shop_awning","stall_awning_canvas","shop_tarp"}
            .SelectMany(name=>{
                var mesh=((MeshInstance3D)parts.Roots[name]).Mesh;
                return Enumerable.Range(0,mesh.GetSurfaceCount()).Select(slot=>{
                    var m=(ShaderMaterial)mesh.SurfaceGetMaterial(slot);
                    var colour=m.GetShaderParameter("tex").AsGodotObject() as Texture2D;
                    var bump=m.GetShaderParameter("bump_map").AsGodotObject() as Texture2D;
                    return new {name,material=m.ResourceName,colour=colour?.GetWidth(),height=bump?.GetWidth(), triangles=mesh is ArrayMesh arrays ? Math.Max(arrays.SurfaceGetArrayIndexLen(slot),arrays.SurfaceGetArrayLen(slot))/3 : 0};
                });
            }).ToArray();
        var bodies=BakedWorld.All(game.View).OfType<StaticBody3D>().Where(n=>n.GetParent()?.Name=="live_town_stalls").ToArray();
        if(bodies.Length!=stalls.List.Count || bodies.Any(n=>n.GetChildCount()!=1 || n.GetChild<CollisionShape3D>(0).Shape is not BoxShape3D))
            throw new InvalidOperationException("Unexpected stall collision.");
        var finishes=materials.Where(m=>m.material.StartsWith("market_joinery") || m.material is "awning_blue" or "awning_red" or "canvas_patched" or "tarpaulin").ToArray();
        if(game.Flag("market-after") && (finishes.Select(m=>m.material).Distinct().Count()!=6 || finishes.Any(m=>m.colour!=512 || m.height!=512)))
            throw new InvalidOperationException("Market colour/height textures missing from live model.");
        File.WriteAllText(Path.Combine(output,"materials.json"),JsonSerializer.Serialize(new{bodies=bodies.Length, market=market.Label, shop=shop?.Label,materials}));
        foreach(var (light,hour,weather) in new[]{("day",9,"clear"),("rain",9,"rain"),("night",23,"clear")})
        {
            await Scheldemist.Dev.Kit.I.Light(hour,weather,day:1);
            await Frames(30);
            foreach(var (id,stall,eye,target) in new[]{
                ("stall",market,new Vector3(2.9f,1.65f,3.6f),new Vector3(0,1.12f,0)),
                ("under",market,new Vector3(.25f,.40f,1.27f),new Vector3(0,1.6f,-.45f)),
                ("reverse",market,new Vector3(-1.9f,1.2f,-2.6f),new Vector3(0,1.23f,0)),
                ("shop",shop,new Vector3(2.2f,1.5f,3.4f),new Vector3(0,1.28f,.5f))})
            {
                if (stall == null) continue;
                var floor=game.GetNode<Town.Townspeople>("Townspeople").Walk!.BaseAt(stall.X,stall.Z);
                var frame=new Transform3D(new Basis(Vector3.Up,(float)stall.Yaw),new Vector3((float)stall.X,(float)floor,(float)stall.Z));
                camera.GlobalPosition=frame*eye;
                camera.LookAt(frame*target);
                await Frames(6);
                await game.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
                using var shot=game.GetViewport().GetTexture().GetImage();
                if(shot.SavePng(Path.Combine(output,light+"-"+id+".png"))!=Error.Ok) throw new IOException(id);
            }
        }
        game.GetTree().Quit();
    }
}
