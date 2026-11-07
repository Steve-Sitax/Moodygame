using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Godot;

namespace Scheldemist.World.Ruien;

/// <summary>Content-addressed derived exports; source exports remain editable and untouched.</summary>
internal static class RuienGeometryCache
{
    private static string? configuration;
    private static string Hash(byte[] data) => Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
    private static string FileHash(string path)
    {
        string disk=ProjectSettings.GlobalizePath(path);
        if(System.IO.File.Exists(disk)) { using var file=System.IO.File.OpenRead(disk); return Convert.ToHexString(SHA256.HashData(file)).ToLowerInvariant(); }
        return Hash(Godot.FileAccess.GetFileAsBytes(path));
    }
    private static string Configuration()
    {
        if(configuration!=null)return configuration;
        using var hash=IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        void Add(string value) => hash.AppendData(Encoding.UTF8.GetBytes(value+"\n"));
        Add("ruien-trim-v1"); Add(StartupCacheCode.Revision(typeof(RuienGeometryCache).Assembly)); Add(Engine.GetVersionInfo().ToString()); Add(DisplayServer.GetName()); Add(RenderingServer.GetCurrentRenderingMethod());
        void Folder(string path)
        {
            foreach(string file in DirAccess.GetFilesAt(path).Where(f=>f.EndsWith(".json",StringComparison.Ordinal)).Order(StringComparer.Ordinal))
            { Add(path+"/"+file); Add(FileHash(path+"/"+file)); }
            foreach(string child in DirAccess.GetDirectoriesAt(path).Order(StringComparer.Ordinal))Folder(path+"/"+child);
        }
        // Procedural entrance paving samples this texture into its actual vertices.
        Add(RuienPaving.Height); Add(FileHash(RuienPaving.Height));
        Folder("res://world/ruien"); Add(RuienData.AreasFile); Add(FileHash(RuienData.AreasFile));
        configuration=Convert.ToHexString(hash.GetHashAndReset());return configuration;
    }
    internal static T Get<T>(string source, string area, Func<T> build) where T:Resource
    {
        if(Main.I.Flag("no-startup-cache"))return build();
        string file;
        string extension=typeof(T)==typeof(PackedScene)?".scn":".res";
        try
        {
            string key=Hash(Encoding.UTF8.GetBytes(Configuration()+"\n"+source+"\n"+area+"\n"+FileHash(source)));
            file=Path.Combine(ProjectSettings.GlobalizePath("user://"),"startup-cache","ruien",key+extension);
            if(System.IO.File.Exists(file+".sha256") && System.IO.File.Exists(file) && System.IO.File.ReadAllText(file+".sha256")==FileHash(file))
            {
                var cached=ResourceLoader.Load<T>(file,cacheMode:ResourceLoader.CacheMode.Ignore);
                if(cached!=null){StartupCachePrune.Touch(file);return cached;}
            }
        }
        catch(Exception e) { GD.Print("ruien cache: bypass: "+e.Message); return build(); }
        var resource=build();
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(file)!);
            string temp=file+"."+Guid.NewGuid().ToString("N")+extension;
            if(ResourceSaver.Save(resource,temp)!=Error.Ok)throw new IOException("Cannot save derived Ruien geometry");
            string digest=FileHash(temp);
            System.IO.File.Move(temp,file,true);
            string receipt=file+"."+Guid.NewGuid().ToString("N")+".tmp";
            System.IO.File.WriteAllText(receipt,digest); System.IO.File.Move(receipt,file+".sha256",true);
        }
        catch(Exception e) { GD.Print("ruien cache: could not store: "+e.Message); }
        return resource;
    }
}
