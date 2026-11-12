using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Collections.Concurrent;
using Godot;

namespace Scheldemist.World.Ruien;

/// <summary>Content-addressed derived exports; source exports remain editable and untouched.</summary>
internal static class RuienGeometryCache
{
    private static string? configuration;
    private static readonly ConcurrentDictionary<string,Lazy<string>> inputHashes=new(StringComparer.Ordinal);
    private static readonly ConcurrentDictionary<string,Lazy<string>> cacheHashes=new(StringComparer.Ordinal);
    private static readonly string transientRun=Guid.NewGuid().ToString("N");
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
        foreach(string extra in new[]{RuienEntrance.File,RuienNetworkGates.File})
            if(Godot.FileAccess.FileExists(extra)){Add(extra);Add(FileHash(extra));}
        if(RuienDrainNetwork.Active is {} drainage)
        {
            Add(drainage.Source);Add(FileHash(drainage.Source));Add(drainage.Kit+"/templates.json");Add(FileHash(drainage.Kit+"/templates.json"));
            foreach(string file in DirAccess.GetFilesAt(drainage.Kit).Where(f=>f.EndsWith(".res",StringComparison.Ordinal)).Order(StringComparer.Ordinal))
            {Add(drainage.Kit+"/"+file);Add(FileHash(drainage.Kit+"/"+file));}
        }
        string brick=RuienTextures.Dir+"/brick_stretcher_hra.res";Add(brick);Add(FileHash(brick));
        configuration=Convert.ToHexString(hash.GetHashAndReset());
        StartValidation(configuration);
        return configuration;
    }
    private static string InputHash(string source)=>inputHashes.GetOrAdd(source,p=>new Lazy<string>(()=>FileHash(p))).Value;
    internal static string ContentHash(string source)=>InputHash(source);
    private static bool SerialValidation=>Main.I?.Flag("serial-ruien-cache-validation")==true;
    private static string DiskHash(string path)
    {using var stream=System.IO.File.OpenRead(path);return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();}
    private static string ValidatedHash(string file)=>SerialValidation?FileHash(file):cacheHashes.GetOrAdd(file,p=>new Lazy<string>(()=>DiskHash(p))).Value;

    // Validate immutable input/cache bytes beside town loading. Capture all
    // Godot paths and JSON on the calling thread; workers only read disk bytes.
    // Lazy hashes also avoid reading the same collision cache at prefetch/Get.
    private static void StartValidation(string config)
    {
        if(Main.I==null||!Main.I.IsInsideTree()||Main.I.Flag("no-startup-cache")||SerialValidation)return;
        using var timing=Dev.StartupTiming.Measure("ruien.cache-validation-capture");
        var work=new System.Collections.Generic.List<(string Source,string Area,string Disk)>();
        using var areas=JsonDocument.Parse(Godot.FileAccess.GetFileAsString(RuienData.AreasFile));
        foreach(var area in areas.RootElement.GetProperty("areas").EnumerateArray())
        {
            if(!area.TryGetProperty("export",out var export))continue;
            string folder=export.GetString()!,id=area.GetProperty("id").GetString()!;
            string index=folder+"/area.json";if(!Godot.FileAccess.FileExists(index))continue;
            var skipped=area.TryGetProperty("skipKeys",out var skip)?skip.EnumerateArray().Select(k=>k.GetString()!).ToHashSet():new System.Collections.Generic.HashSet<string>();
            using var keys=JsonDocument.Parse(Godot.FileAccess.GetFileAsString(index));
            var files=keys.RootElement.GetProperty("keys").EnumerateObject().Where(k=>!skipped.Contains(k.Name))
                .SelectMany(k=>k.Value.EnumerateObject()).SelectMany(l=>l.Value.EnumerateArray()).Select(f=>folder+"/"+f.GetProperty("file").GetString()).Append(folder+"/collision.res");
            foreach(string source in files.Distinct(StringComparer.Ordinal))
            {
                string disk=ProjectSettings.GlobalizePath(source);if(!System.IO.File.Exists(disk))continue;
                inputHashes.TryAdd(source,new Lazy<string>(()=>DiskHash(disk)));
                work.Add((source,id,disk));
            }
        }
        string root=StartupCachePrune.Root;string? seed=StartupCachePrune.Seed;
        _=Task.Run(()=>
        {
            using var validation=Dev.StartupTiming.Measure("ruien.cache-validation");
            Parallel.ForEach(work,new ParallelOptions{MaxDegreeOfParallelism=4},item=>
            {
                try
                {
                    string key=Hash(Encoding.UTF8.GetBytes(config+"\n"+item.Source+"\n"+item.Area+"\n"+InputHash(item.Source)));
                    string file=StartupCachePrune.Locate(root,seed,Path.Combine("ruien",key+".res"),".sha256");
                    if(System.IO.File.Exists(file)&&System.IO.File.Exists(file+".sha256"))_ = cacheHashes.GetOrAdd(file,p=>new Lazy<string>(()=>DiskHash(p))).Value;
                }
                catch(System.IO.IOException){inputHashes.TryRemove(item.Source,out _);}
                catch(UnauthorizedAccessException){inputHashes.TryRemove(item.Source,out _);}
            });
        });
    }
    private static string CacheFile(string source,string area,string extension)
    {
        string key=Hash(Encoding.UTF8.GetBytes(Configuration()+"\n"+source+"\n"+area+"\n"+InputHash(source)));
        return StartupCachePrune.Locate(Path.Combine("ruien",key+extension),".sha256");
    }
    internal static string PreparedDigest(string file)=>System.IO.File.ReadAllText(file+".sha256");
    internal static string Prefetch(string source,string area)
    {
        if(Main.I?.Flag("no-startup-cache")==true)return source;
        string file=CacheFile(source,area,".res");
        return System.IO.File.Exists(file+".sha256")&&System.IO.File.Exists(file)&&System.IO.File.ReadAllText(file+".sha256")==ValidatedHash(file)?file:source;
    }
    internal static T Get<T>(string source, string area, Func<T> build) where T:Resource
    {
        if(Main.I?.Flag("no-startup-cache")==true)return build();
        string file;
        string extension=typeof(T)==typeof(PackedScene)?".scn":".res";
        try
        {
            file=CacheFile(source,area,extension);
            if(System.IO.File.Exists(file+".sha256") && System.IO.File.Exists(file) && System.IO.File.ReadAllText(file+".sha256")==ValidatedHash(file))
            {
                var cached=ResourceLoader.Load<T>(file,cacheMode:ResourceLoader.CacheMode.Reuse);
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
            cacheHashes[file]=new Lazy<string>(()=>digest);
            string receipt=file+"."+Guid.NewGuid().ToString("N")+".tmp";
            System.IO.File.WriteAllText(receipt,digest); System.IO.File.Move(receipt,file+".sha256",true);
        }
        catch(Exception e) { GD.Print("ruien cache: could not store: "+e.Message); }
        return resource;
    }

    /// <summary>Construct fixed geometry before play, but leave its visual resource
    /// on disk until the camera needs it. Validation still hashes actual contents.</summary>
    internal static string Prepare<T>(string source,string area,Func<T> build) where T:Resource
    {
        using var timing=Dev.StartupTiming.Measure("ruien.visual-prepare");
        bool uncached=Main.I?.Flag("no-startup-cache")==true;
        string key=Hash(Encoding.UTF8.GetBytes(Configuration()+"\n"+source+"\n"+area+"\n"+InputHash(source)));
        string file=uncached?Path.Combine(StartupCachePrune.Root,"ruien","transient-"+transientRun,key+".res")
            :StartupCachePrune.Locate(Path.Combine("ruien",key+".res"),".sha256");
        string folder=Path.GetDirectoryName(file)!;
        if(!uncached && System.IO.File.Exists(file+".sha256")&&System.IO.File.Exists(file)&&System.IO.File.ReadAllText(file+".sha256")==ValidatedHash(file))
        { StartupCachePrune.Touch(file);return file; }
        var resource=build();Directory.CreateDirectory(folder);
        string temp=file+"."+Guid.NewGuid().ToString("N")+".res";
        if(ResourceSaver.Save(resource,temp,ResourceSaver.SaverFlags.Compress)!=Error.Ok)throw new IOException("Cannot spool Ruien visual "+source);
        string digest=FileHash(temp);System.IO.File.Move(temp,file,true);
        cacheHashes[file]=new Lazy<string>(()=>digest);
        System.IO.File.WriteAllText(file+".sha256",digest);return file;
    }
}
