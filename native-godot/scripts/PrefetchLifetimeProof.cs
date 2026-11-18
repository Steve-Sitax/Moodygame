using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Native.Authoring;
using Scheldemist.Native.World;
using Scheldemist.World;

public partial class PrefetchLifetimeProof : Node
{
    public override async void _Ready()
    {
        try
        {
            Scheldemist.Native.Game.NativeGlobals.Ensure();
            Scheldemist.Render.Psx.EnsureGlobals();
            const string folder="res://assets/library/interiors";
            var roots=ResourceLoader.ListDirectory(folder).Where(p=>p.EndsWith(".tres",StringComparison.Ordinal)).Order(StringComparer.Ordinal).Select(p=>folder+"/"+p).ToArray();
            bool parallelScripts=!OS.GetCmdlineUserArgs().Contains("--serial-script-prefetch");
            bool town=OS.GetCmdlineUserArgs().Contains("--prefetch-lifetime-town");
            Scheldemist.Main? owner=null;
            if(town)
            {
                owner=new Scheldemist.Main();
                typeof(Scheldemist.Main).GetProperty("I")!.SetValue(null,owner);
                StartupResources.Declare(NativeTownMaterials.GameMaterialFiles);
            }
            // NativeTown.Load runs beside the loading screen, including its serial scripted-resource phase.
            var held=await Task.Run(()=>
            {
            var dependencies=InputFiles.DependencyHints(roots);
            var levels=NativeTownPrefetch.DependencyLevels(dependencies,!parallelScripts);
            var groups=levels.Where(p=>p.Value>=0).GroupBy(p=>p.Value).OrderBy(g=>g.Key)
                .Select(level=>level.Select(p=>p.Key));
            var loaded=town?NativeTownPrefetch.Run(NativeDistrictLayouts.DescriptorPaths()):NativeTownPrefetch.LoadLevels(groups);
            if(town)
            {
                const string scene="res://world/town/scene.tscn";
                if(ResourceLoader.LoadThreadedRequest(scene)!=Error.Ok)throw new InvalidOperationException("Town request failed");
                loaded.Add(ResourceLoader.LoadThreadedGet(scene));
                _=NativeDistrictLayouts.Available();
            }
            foreach(var path in roots)
            {
                var asset=ResourceLoader.Load<AuthorAsset>(path);
                if(asset==null||asset.Id.Length==0||asset.Scene==null)throw new InvalidOperationException("Invalid authored asset "+path);
                loaded.Add(asset);
            }
            return loaded;
            });
            GD.Print($"PREFETCH_LIFETIME_PASS: {roots.Length} real scripted assets, {held.Count} held resources, parallelScripts={parallelScripts}");
            // Match the game's end-of-loading handoff, then let ordinary shutdown dispose tracked wrappers.
            held.Clear();
            owner?.Free();
            for(int i=0;i<5;i++)await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);
            GetTree().Quit();
        }
        catch(Exception e){GD.PushError(e.ToString());GetTree().Quit(1);}
    }
}
