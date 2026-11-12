using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using Godot;
using Scheldemist.World.Ruien;
using Scheldemist.Native.World;

public partial class RuienDrainEntranceProbe : Node3D
{
    public override async void _Ready()
    {
        try
        {
            var args=OS.GetCmdlineUserArgs();string Arg(string key)=>args[Array.IndexOf(args,key)+1];
            var net=RuienDrainNetwork.Read(Arg("--network"),Arg("--kit"),RuienData.Load());
            var scenes=JsonSerializer.Deserialize<string[]>(File.ReadAllText(Arg("--entrance-scenes")))!;
            for(int i=0;i<scenes.Length;i++)
            {
                var root=ResourceLoader.Load<PackedScene>(scenes[i]).Instantiate<Node3D>();
                if(args.Contains("--refresh-connections"))
                {
                    var spec=RuienEntrance.All.Single(e=>"entrance_"+e.Id==root.Name);
                    if(spec.ConnectLength>0)
                    {
                        if(root.GetNodeOrNull<Node3D>("connected_passage") is {} old){root.RemoveChild(old);old.Free();}
                        root.AddChild(RuienEntrance.BuildConnection(spec));
                    }
                    string folder=Arg("--refresh-connections");Directory.CreateDirectory(folder);
                    foreach(var node in Scheldemist.World.BakedWorld.All(root).Where(n=>n!=root))node.Owner=root;
                    using var packed=new PackedScene();
                    if(packed.Pack(root)!=Error.Ok)throw new Exception("Cannot pack refreshed entrance "+spec.Id);
                    scenes[i]=Path.Combine(folder,spec.Id+".scn");
                    if(ResourceSaver.Save(packed,scenes[i])!=Error.Ok)throw new Exception("Cannot save refreshed entrance "+spec.Id);
                }
                AddChild(root);
            }
            if(args.Contains("--refresh-connections"))File.WriteAllText(Path.Combine(Arg("--refresh-connections"),"scenes.json"),JsonSerializer.Serialize(scenes));
            var result=await NativeRuienDrainClearance.Run(this,net);
            string Hash(string path)=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path)));
            File.WriteAllText(Arg("--out"),JsonSerializer.Serialize(new{networkSha256=Hash(Arg("--network")),
                scenes=scenes.Select(path=>new{path,sha256=Hash(path)}),result.Entrances,result.Heads,result.Collectors,result.Inlets,result.Samples,
                errors=result.Errors.Select(e=>new{id=e.Id,entrance=e.Entrance,at=new[]{e.At.X,e.At.Y,e.At.Z}})},new JsonSerializerOptions{WriteIndented=true}));
            GD.Print($"DRAIN/ENTRANCE PROOF: {result.Entrances} entrances, {result.Samples} samples, {result.Errors.Count} clashes");
            GetTree().Quit(result.Entrances>0&&result.Errors.Count==0?0:1);
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
}
