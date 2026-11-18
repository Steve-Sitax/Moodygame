using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Native.World;

public partial class PrefetchOrderProof : Node
{
    public override void _Ready()
    {
        try
        {
            var graph = new Dictionary<string,string[]>
            {
                ["texture.res"]=Array.Empty<string>(), ["shader.gdshader"]=Array.Empty<string>(),
                ["material.res"]=new[]{"texture.res","shader.gdshader"}, ["mesh.res"]=new[]{"material.res"},
                ["scene.scn"]=new[]{"mesh.res"}, ["asset.cs"]=Array.Empty<string>(), ["editor.gd"]=Array.Empty<string>(),
                ["asset.tres"]=new[]{"asset.cs","scene.scn"}, ["catalog.tres"]=new[]{"asset.tres"},
                ["district.tres"]=new[]{"catalog.tres"}, ["scripted.scn"]=new[]{"editor.gd","mesh.res"},
                ["cycle-a"]=new[]{"cycle-b"}, ["cycle-b"]=new[]{"cycle-a"}, ["unknown-parent"]=new[]{"absent"}
            };
            var levels=NativeTownPrefetch.DependencyLevels(graph);
            int checks=0;
            void Check(bool ok,string why){if(!ok)throw new InvalidOperationException(why);checks++;}
            foreach(string file in new[]{"asset.cs","editor.gd","asset.tres","catalog.tres","district.tres","scripted.scn","cycle-a","cycle-b","unknown-parent","absent"})
                Check(levels[file]<0,"Deferred unsafe/unknown branch: "+file);
            Check(levels["texture.res"]==0 && levels["shader.gdshader"]==0,"Native leaves stay eligible");
            Check(levels["material.res"]==1 && levels["mesh.res"]==2 && levels["scene.scn"]==3,"Native dependencies retain topological order");
            Check(NativeTownPrefetch.DependencyLevels(graph,false)["asset.tres"]>=0,"Control reproduces the old scripted-resource prefetch");
            GD.Print($"PREFETCH_ORDER_PASS: {checks} dependency ordering and script-branch checks");GetTree().Quit();
        }
        catch(Exception e){GD.PushError(e.ToString());GetTree().Quit(1);}
    }
}
