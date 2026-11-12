using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Godot;

namespace Scheldemist.Native.World;

public static partial class NativeSquareDressing
{
    private sealed record GroundReceipt(string Key,string File,string Hash,int Drawn);
    private static string GroundHash(string file) { using var stream=System.IO.File.OpenRead(file);return Convert.ToHexString(SHA256.HashData(stream)); }

    /// <summary>Lossless cache of the procedural dirt and puddle mask, keyed by its pixels, layout and construction inputs.</summary>
    public static int Ground(Plan plan,NativeRazedHouses.Result razed,string mapsDir)
    {
        if(razed.Razed.Count==0 || NativeCutCache.CurrentKey is not {} inputs)return BuildGround(plan,razed,mapsDir);
        var clock=System.Diagnostics.Stopwatch.StartNew();
        string key,folder,manifest;
        try
        {
            string squares=ProjectSettings.GlobalizePath(NativeRazedHouses.SquaresFile);
            string identity=inputs+"\n"+JsonSerializer.Serialize(new{plan,razed.Razed,razed.Standing},new JsonSerializerOptions{IncludeFields=true})
                +"\n"+GroundHash(System.IO.Path.Combine(mapsDir,"dirt.png"))+"\n"+GroundHash(System.IO.Path.Combine(mapsDir,"dirt.json"))
                +"\n"+(System.IO.File.Exists(squares)?GroundHash(squares):"missing");
            key=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identity))).ToLowerInvariant();
            folder=Scheldemist.World.StartupCachePrune.Locate(System.IO.Path.Combine("square-ground",key),System.IO.Path.DirectorySeparatorChar+"complete.json");
            manifest=System.IO.Path.Combine(folder,"complete.json");
        }
        catch(Exception e){GD.Print("startup cache: ground bypass: "+e.Message);return BuildGround(plan,razed,mapsDir);}
        try
        {
            if(System.IO.File.Exists(manifest))
            {
                var receipt=JsonSerializer.Deserialize<GroundReceipt>(System.IO.File.ReadAllText(manifest))!;
                if(receipt.Key!=key || System.IO.Path.GetFileName(receipt.File)!=receipt.File)throw new IOException("Invalid ground cache receipt");
                string path=System.IO.Path.Combine(folder,receipt.File);
                if(GroundHash(path)!=receipt.Hash)throw new IOException("Ground cache checksum mismatch");
                using var image=Image.LoadFromFile(path);
                if(image==null || image.IsEmpty())throw new IOException("Ground cache image missing");
                var texture=ImageTexture.CreateFromImage(image);
                Dirt=texture;RenderingServer.GlobalShaderParameterSet("psx_dirt",texture.GetRid());
                Scheldemist.World.StartupCachePrune.Touch(manifest);
                GD.Print($"startup cache: square ground hit, {clock.ElapsedMilliseconds} ms");
                return receipt.Drawn;
            }
        }
        catch(Exception e){GD.Print("startup cache: rebuilding ground: "+e.Message);}
        int drawn=BuildGround(plan,razed,mapsDir);
        try
        {
            if(Dirt==null)return drawn;
            Directory.CreateDirectory(folder);
            string generation=Guid.NewGuid().ToString("N"),name=generation+".png",path=System.IO.Path.Combine(folder,name);
            using var image=Dirt.GetImage();
            if(image.SavePng(path)!=Error.Ok)throw new IOException("Cannot save ground mask");
            var receipt=new GroundReceipt(key,name,GroundHash(path),drawn);
            string temp=System.IO.Path.Combine(folder,generation+".json");System.IO.File.WriteAllText(temp,JsonSerializer.Serialize(receipt));System.IO.File.Move(temp,manifest,true);
            GD.Print($"startup cache: square ground stored, {clock.ElapsedMilliseconds} ms");
        }
        catch(Exception e){GD.Print("startup cache: could not store ground: "+e.Message);}
        return drawn;
    }
}
