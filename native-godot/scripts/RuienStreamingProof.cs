using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using Godot;
using Scheldemist.World.Ruien;

/// <summary>Exercise shared prepared resources through asynchronous loads, camera moves and collection.</summary>
public partial class RuienStreamingProof : Node3D
{
    public override async void _Ready()
    {
        try
        {
            var args=OS.GetCmdlineUserArgs();string output=args[Array.IndexOf(args,"--out")+1];
            string folder=Path.GetDirectoryName(Path.GetFullPath(output))!;Directory.CreateDirectory(folder);
            string file=Path.Combine(folder,"streaming-fixture.res");
            using(var box=new BoxMesh())
            using(var mesh=new ArrayMesh())
            {
                mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,box.SurfaceGetArrays(0));
                mesh.SurfaceSetName(0,"ruien_bluestone");
                if(ResourceSaver.Save(mesh,file)!=Error.Ok)throw new IOException("Cannot save fixture");
            }
            File.WriteAllText(file+".sha256","streaming-proof-fixture");
            const BindingFlags flags=BindingFlags.Static|BindingFlags.Instance|BindingFlags.NonPublic;
            var streamer=(RuienArea)typeof(RuienArea).GetMethod("Streamer",flags)!.Invoke(null,new object[]{"streaming_proof"})!;
            var prepare=typeof(RuienArea).GetMethod("Prepared",flags)!;
            for(int i=0;i<32;i++)
            {
                var p=new Vector3(i<16?i*.1f:400+i*.1f,0,0);
                prepare.Invoke(streamer,new object[]{"copy_"+i,file,"fixture",new Aabb(p,Vector3.One),0,new Transform3D(Basis.Identity,p)});
            }
            AddChild(streamer.Root);int checks=0;
            async System.Threading.Tasks.Task Frame()=>await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);
            for(int cycle=0;cycle<64;cycle++)
            {
                var eye=new Vector3(cycle%2==0?0:400,0,0);
                streamer.Lod(eye);
                // Leave before completion as well as after: cancellation must drain once and be reusable.
                if(cycle%3==0){streamer.ReleaseVisuals();GC.Collect();await Frame();}
                for(int frame=0;frame<300;frame++)
                {
                    streamer.Lod(eye);
                    if(streamer.Keys.SelectMany(k=>k.Lods[0]).Count(m=>m.Visible&&m.Mesh!=null)==16)break;
                    await Frame();
                }
                var shown=streamer.Keys.SelectMany(k=>k.Lods[0]).Where(m=>m.Visible&&m.Mesh!=null).ToArray();
                if(shown.Length!=16||shown.Select(m=>m.Mesh!.GetInstanceId()).Distinct().Count()!=1)
                    throw new InvalidOperationException("Shared mesh did not become visible exactly once per near copy");
                var held=shown[0].Mesh!;
                if(held.GetSurfaceCount()!=1||held.SurfaceGetMaterial(0)==null)throw new InvalidOperationException("Mesh content changed");
                GC.Collect();GC.WaitForPendingFinalizers();streamer.Lod(eye);checks++;
                if(shown.Any(m=>m.Mesh!=held))throw new InvalidOperationException("Collection lost a live shared mesh");
                streamer.ReleaseVisuals();
                if(streamer.Keys.SelectMany(k=>k.Lods[0]).Any(m=>m.Mesh!=null||m.Visible))throw new InvalidOperationException("Released visuals remain resident");
                if(GodotObject.IsInstanceValid(held))throw new InvalidOperationException("Private mesh was not retired");
                await Frame();
            }
            File.WriteAllText(output,JsonSerializer.Serialize(new{pass=true,cycles=checks,copies=32,sharedLoads=true,released=true}));
            GD.Print($"RUIEN STREAMING PROOF: {checks} shared load/release cycles passed");GetTree().Quit();
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
}
