using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text.Json;
using System.Security.Cryptography;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using Godot;
namespace Scheldemist.World.Ruien;
public sealed partial class RuienCover
{
    public static bool CacheForProof;
    public string CacheEntry {get;private set;}="";
    private string? CoverCacheFile(RuienData data,IReadOnlyList<RuienEntrance.Spec> entries)
    {
        if(FullSearchProof||Main.I==null&&!CacheForProof||Main.I?.Flag("no-startup-cache")==true)return null;
        using var inputs=new MemoryStream();using(var b=new BinaryWriter(inputs,System.Text.Encoding.UTF8,true))
        {
            b.Write("ruien-cover-v1");b.Write(StartupCacheCode.Revision(typeof(RuienCover).Assembly));b.Write(Engine.GetVersionInfo().ToString());
            void V2(Vector2 v){b.Write(v.X);b.Write(v.Y);}void V3(Vector3 v){b.Write(v.X);b.Write(v.Y);b.Write(v.Z);}
            b.Write(data.Areas.Count);
            foreach(var area in data.Areas)
            {
                b.Write(area.Id);V3(area.Box.Position);V3(area.Box.Size);b.Write(area.Zones.Count);
                foreach(var z in area.Zones)
                {
                    b.Write(z.Kind);b.Write(JsonSerializer.Serialize(z.S));b.Write(z.Wall);b.Write(z.FadeStart);b.Write(z.FadeEnd);
                    V2(z.Rect.Position);V2(z.Rect.Size);b.Write(z.Path.Length);foreach(var p in z.Path)V2(p);
                }
            }
            b.Write(entries.Count);
            foreach(var entry in entries)
            {
                var footprints=RuienEntrance.Footprint(entry).ToArray();b.Write(footprints.Length);
                foreach(var (frame,lo,hi,top)in footprints){V3(frame.Basis.X);V3(frame.Basis.Y);V3(frame.Basis.Z);V3(frame.Origin);V2(lo);V2(hi);b.Write(top);}
            }
        }
        string key=Convert.ToHexString(SHA256.HashData(inputs.ToArray())).ToLowerInvariant();
        return CacheEntry=Path.Combine(StartupCachePrune.Root,"ruien","cover-"+key+".bin");
    }
    private bool ReadCoverCache(string file)
    {
        try
        {
            if(!File.Exists(file)||!File.Exists(file+".sha256"))return false;
            byte[] saved=File.ReadAllBytes(file);if(Convert.ToHexString(SHA256.HashData(saved))!=File.ReadAllText(file+".sha256"))return false;
            using var stream=new GZipStream(new MemoryStream(saved),CompressionMode.Decompress);using var b=new BinaryReader(stream);
            if(b.ReadString()!="RUIEN_COVER_1")return false;
            int width=b.ReadInt32(),height=b.ReadInt32();if(width<1||height<1||width>4096||height>4096)return false;
            int count=checked(width*height);var box=new Vector4(b.ReadSingle(),b.ReadSingle(),b.ReadSingle(),b.ReadSingle());
            float[] Read(){var bytes=b.ReadBytes(checked(count*4));if(bytes.Length!=count*4)throw new EndOfStreamException();return MemoryMarshal.Cast<byte,float>(bytes).ToArray();}
            var a=Read();var c=Read();var ceil=Read();var pixels=b.ReadBytes(count*3);if(pixels.Length!=count*3)return false;
            w=width;h=height;Box=box;map=a;closed=c;ceiling=ceil;
            using var image=Image.CreateFromData(w,h,false,Image.Format.Rgb8,pixels);Texture=ImageTexture.CreateFromImage(image);
            StartupCachePrune.Touch(file);return true;
        }
        catch(Exception e){GD.Print("ruien cover cache: rebuilding: "+e.Message);return false;}
    }
    private void WriteCoverCache(string file,byte[] pixels)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(file)!);using var encoded=new MemoryStream();
            using(var zip=new GZipStream(encoded,CompressionLevel.Fastest,true))using(var b=new BinaryWriter(zip))
            {
                b.Write("RUIEN_COVER_1");b.Write(w);b.Write(h);b.Write(Box.X);b.Write(Box.Y);b.Write(Box.Z);b.Write(Box.W);
                foreach(var values in new[]{map,closed,ceiling})b.Write(MemoryMarshal.AsBytes(values.AsSpan()));b.Write(pixels);
            }
            byte[] bytes=encoded.ToArray();string temp=file+"."+Guid.NewGuid().ToString("N")+".tmp";
            File.WriteAllBytes(temp,bytes);File.Move(temp,file,true);
            File.WriteAllText(file+".sha256",Convert.ToHexString(SHA256.HashData(bytes)));
        }
        catch(Exception e){GD.Print("ruien cover cache: not stored: "+e.Message);}
    }
}
