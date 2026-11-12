using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Dev;

namespace Scheldemist.World.Ruien;

/// <summary>Proof-only complete rendered frames. Inventories run after the timing window.</summary>
public sealed class RuienFrameProfile : IDisposable
{
    private readonly SceneTree tree;
    private readonly bool parts;
    private bool began, disposed;
    private FrameCost.Scope process, submit;
    private ulong last;
    private readonly List<double> wall = new(), calls = new();
    public RuienFrameProfile(SceneTree tree)
    {
        this.tree = tree; parts = Main.I.Flag("profile-parts");
        FrameCost.Clear();
        tree.ProcessFrame += Begin; tree.PhysicsFrame += Begin;
        RenderingServer.FramePreDraw += BeforeDraw;
        RenderingServer.FramePostDraw += End;
    }
    private void Begin()
    {
        if (began) return;
        began = true;
        if (parts) { FrameCost.Frame(); process = FrameCost.Track("Engine.process-and-physics"); }
    }
    private void BeforeDraw()
    {
        if (!began || !parts) return;
        process.Dispose(); process = default;
        submit = FrameCost.Track("Engine.render-submission");
    }
    private void End()
    {
        submit.Dispose(); submit = default;
        var now = Time.GetTicksUsec();
        if (began && last != 0)
        {
            wall.Add((now-last)/1000.0);
            calls.Add(RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalDrawCallsInFrame));
        }
        last = now; began = false;
    }
    public object Finish(string name)
    {
        Dispose();
        var sorted = wall.Order().ToArray();
        foreach(var group in Geometry().GroupBy(Part).Where(g=>g.Key.StartsWith("town/")))
            GD.Print($"RUIEN_MESHES {name} {group.Key}: {group.Count(m=>m.IsVisibleInTree())}/{group.Count()} scene-visible");
        var top = parts ? FrameCost.Report() : Array.Empty<object>();
        var result = new { name, samples = wall.Count, meanMs = wall.DefaultIfEmpty().Average(),
            p95Ms = sorted.Length == 0 ? 0 : sorted[(int)(sorted.Length*.95)],
            drawCalls = calls.DefaultIfEmpty().Average(), shaders = Render.Psx.ShaderCount, top,
            scene = SceneInventory.Capture(), townParts = Inventory() };
        GD.Print($"RUIEN_DRAWS {name}: {result.drawCalls:0.00} calls/frame");
        GD.Print("RUIEN_PARTS " + name + " " + System.Text.Json.JsonSerializer.Serialize(top));
        return result;
    }
    internal static string Part(Node node)
    {
        while (node.GetParent() is { } parent && parent != Main.I && parent != Main.I.View && parent != Main.I.World && parent.GetParent() != Main.I.World)
            node = parent;
        return node.GetParent()?.GetParent() == Main.I.World ? "town/"+node.Name : node.Name.ToString();
    }
    internal static GeometryInstance3D[] Geometry() => BakedWorld.All(Main.I).OfType<GeometryInstance3D>().ToArray();
    private static object[] Inventory() => Geometry().GroupBy(Part).OrderBy(g=>g.Key).Select(g=>(object)new {
        part=g.Key, meshes=g.Count(), visibleMeshes=g.Count(m=>m.IsVisibleInTree()),
        // Visibility flags are not renderer submission counts (frustum, LOD and mirrors differ).
        visiblePaths=g.Where(m=>m.IsVisibleInTree()).Select(m=>m.GetPath().ToString()).ToArray()
    }).ToArray();
    internal sealed class HiddenParts : IDisposable
    {
        private readonly (GeometryInstance3D mesh,uint layers)[] saved;
        public HiddenParts(IEnumerable<string> parts)
        {
            var selected=parts.ToHashSet();
            // "ruien_<area>/<name prefix>": only that area's pieces whose node name starts so (mist_, beam_, water_, mesh_)
            var pieces=selected.Where(p=>p.StartsWith("ruien_")&&p.Contains('/')).Select(p=>(part:p[..p.IndexOf('/')],name:p[(p.IndexOf('/')+1)..])).ToArray();
            saved=selected.Count==0?Array.Empty<(GeometryInstance3D,uint)>():Geometry()
                .Where(m=>selected.Contains(Part(m))||pieces.Any(q=>q.part==Part(m)&&m.Name.ToString().StartsWith(q.name))).Select(m=>(m,m.Layers)).ToArray();
            foreach(var (mesh,_) in saved)mesh.Layers=0;
        }
        public void Dispose(){foreach(var (mesh,layers) in saved)mesh.Layers=layers;}
    }
    // Diagnostic ablation only: this deliberately changes pictures, never enables gameplay culling.
    public static async Task<object[]> Audit(Node owner, string output, string view)
    {
        var rows = new List<object>();
        var selected = Main.I.Arg("ruien-proof-audit-parts").Split(',',StringSplitOptions.RemoveEmptyEntries).ToHashSet();
        async Task<double> Draws()
        {
            var values = new List<double>();
            for(int i=0;i<8;i++)
            {
                Main.I.GetNodeOrNull<Mirrors>("Mirrors")?._Process(0);
                await owner.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
                if(i>=4)values.Add(RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalDrawCallsInFrame));
            }
            return values.Average();
        }
        var groups=Geometry().GroupBy(Part).Where(g=>selected.Contains(g.Key)).ToArray();
        var missing=selected.Except(groups.Select(g=>g.Key)).ToArray();
        if(missing.Length>0)throw new ArgumentException("Unknown town parts: "+string.Join(",",missing));
        var tree=owner.GetTree();bool paused=tree.Paused;var mode=owner.ProcessMode;
        owner.ProcessMode=Node.ProcessModeEnum.Always;Main.I.PictureTime(12);tree.Paused=true;
        try
        {
        foreach(var group in groups)
        {
            var meshes=group.ToArray(); var layers=meshes.Select(m=>m.Layers).ToArray();
            int visible=meshes.Count(m=>m.IsVisibleInTree());
            double before=await Draws(), hidden;
            using var imageBefore=owner.GetViewport().GetTexture().GetImage();
            Image? imageHidden=null;
            try { foreach(var mesh in meshes)mesh.Layers=0; hidden=await Draws(); imageHidden=owner.GetViewport().GetTexture().GetImage(); }
            finally { for(int i=0;i<meshes.Length;i++)meshes[i].Layers=layers[i]; }
            var restored=await Draws();
            using var imageRestored=owner.GetViewport().GetTexture().GetImage();
            int Diff(Image a,Image b)
            {
                a.Convert(Image.Format.Rgba8);b.Convert(Image.Format.Rgba8);
                if(a.GetSize()!=b.GetSize())throw new InvalidOperationException("Picture dimensions changed");
                var x=a.GetData();var y=b.GetData();int changed=0;
                if(!x.Where((_,i)=>i%4!=3).Any(v=>v!=0))throw new InvalidOperationException("Black image readback");
                for(int i=0;i<x.Length;i+=4)if(x[i]!=y[i]||x[i+1]!=y[i+1]||x[i+2]!=y[i+2]||x[i+3]!=y[i+3])changed++;
                return changed;
            }
            int changedPixels=Diff(imageBefore,imageHidden!), controlPixels=Diff(imageBefore,imageRestored);
            uint mask=Main.I.Cam.CullMask;int positiveControlPixels;
            try
            {
                Main.I.Cam.CullMask=0;await Draws();
                using var positive=owner.GetViewport().GetTexture().GetImage();
                positiveControlPixels=Diff(imageBefore,positive);
            }
            finally { Main.I.Cam.CullMask=mask; }
            await Draws();
            string prefix=System.IO.Path.Combine(output,view+"-"+group.Key.Replace('/','_'));
            imageBefore.SavePng(prefix+"-before.png");imageHidden!.SavePng(prefix+"-hidden.png");imageRestored.SavePng(prefix+"-restored.png");imageHidden.Dispose();
            rows.Add(new { part=group.Key,visibleMeshes=visible,before,hidden,restored,positiveControlPixels,
                changedPixels,controlPixels,removedDrawCalls=(before+restored)/2-hidden });
        }
        }
        finally { tree.Paused=paused;owner.ProcessMode=mode;Main.I.PictureTime(-1); }
        return rows.ToArray();
    }
    public void Dispose()
    {
        if(disposed)return;disposed=true;
        tree.ProcessFrame -= Begin; tree.PhysicsFrame -= Begin;
        RenderingServer.FramePreDraw -= BeforeDraw; RenderingServer.FramePostDraw -= End;
        process.Dispose(); process=default; submit.Dispose(); submit=default;
    }
}
