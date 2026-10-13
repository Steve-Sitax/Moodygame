using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Models;
using Scheldemist.World;

namespace Scheldemist.People;

/// <summary>Weighted Blender skins baked once to half-float bone palettes. One MultiMesh draw per kind,
/// shared with the people2 shader. All decompression, resources and buffers are prepared while loading.</summary>
internal static class SmallLifeKit
{
    internal readonly record struct Clip(int First, int Frames, float Seconds, float Stride);
    internal sealed class Kind
    {
        internal Mesh Mesh = null!;
        internal ShaderMaterial Material = null!;
        internal float Height;
        internal Aabb Box;
        internal readonly Dictionary<string, Clip> Clips = new();
    }
    internal static readonly Dictionary<string, Kind> Kinds = new();
    private static Node3D? source;
    private static readonly List<Texture2D> textures = new();
    internal static long AnimationBytes { get; private set; }
    internal static long PictureBytes { get; private set; }
    private const string Root = "res://assets/smalllife/";
    internal static bool Ready
    {
        get
        {
            if (source != null) return true;
            if (ModelLibrary.NativeScene == null || !ModelLibrary.Available("smalllife")) return false;
            source = ModelLibrary.NativeScene("smalllife") ?? throw new IOException("smalllife native scene");
            using var doc = JsonDocument.Parse(Godot.FileAccess.GetFileAsString(Root + "kit.json"));
            foreach (var entry in doc.RootElement.GetProperty("kinds").EnumerateObject())
            {
                string name = entry.Name;
                var mesh = source.GetNodeOrNull<MeshInstance3D>(name)?.Mesh ??
                    throw new InvalidDataException("smalllife mesh " + name);
                var facts = entry.Value;
                var k = new Kind { Mesh = mesh, Height = facts.GetProperty("height").GetSingle() };
                Vector3 V(string p) { var a = facts.GetProperty(p); return new(a[0].GetSingle(), a[1].GetSingle(), a[2].GetSingle()); }
                var min = V("min"); k.Box = new(min, V("max") - min);
                foreach (var c in facts.GetProperty("clips").EnumerateObject())
                    k.Clips[c.Name] = new(c.Value.GetProperty("first").GetInt32(), c.Value.GetProperty("frames").GetInt32(),
                        c.Value.GetProperty("seconds").GetSingle(), c.Value.GetProperty("stride").GetSingle());
                var sm = new ShaderMaterial { Shader = People2Material.Skin(), ResourceName = "smalllife_" + name };
                sm.SetShaderParameter("layered_pictures", false);
                sm.SetShaderParameter("vertex_animation", true);
                sm.SetShaderParameter("tex", Picture(name + "_colour", false));
                sm.SetShaderParameter("skin_normal", Picture(name + "_normal", true));
                sm.SetShaderParameter("normal_strength", .55f);
                using var packed = new MemoryStream(Godot.FileAccess.GetFileAsBytes(Root + name + "_skin.bin"));
                using var zip = new GZipStream(packed, CompressionMode.Decompress);
                using var reader = new BinaryReader(zip);
                int width = reader.ReadInt32(), height = reader.ReadInt32();
                if (width <= 0 || width > 16384 || height <= 0 || height > 1024) throw new InvalidDataException("smalllife animation dimensions");
                int bytes = checked(width * height * 8);
                foreach (string parameter in new[] { "pose_positions", "pose_normals" })
                {
                    byte[] data = reader.ReadBytes(bytes);
                    if (data.Length != bytes) throw new InvalidDataException("truncated smalllife skin " + name);
                    using var image = Image.CreateFromData(width, height, false, Image.Format.Rgbah, data);
                    var texture = ImageTexture.CreateFromImage(image); textures.Add(texture);
                    sm.SetShaderParameter(parameter, texture);
                    AnimationBytes += bytes;
                }
                if (zip.ReadByte() != -1) throw new InvalidDataException("trailing smalllife skin data");
                k.Material = sm; mesh.SurfaceSetMaterial(0, sm); Kinds.Add(name, k);
            }
            GD.Print($"smalllife: {Kinds.Count} kinds, {PictureBytes} compressed picture bytes, {AnimationBytes} baked skin bytes");
            return true;
        }
    }
    private static Texture2D Picture(string name, bool normal)
    {
        var texture = ResourceLoader.Load<Texture2D>(Root + name + ".png") ?? throw new IOException(name);
        using var image = texture.GetImage();
        if (!image.HasMipmaps() || !image.IsCompressed() || image.GetWidth() != 1024 || image.GetHeight() != 1024 ||
            image.GetFormat() != (normal ? Image.Format.RgtcRg : Image.Format.BptcRgba)) throw new InvalidDataException("smalllife picture preset " + name);
        PictureBytes += image.GetDataSize();
        textures.Add(texture);
        return texture;
    }
    internal static void Forget()
    {
        source?.Free(); source = null;
        foreach (var k in Kinds.Values) { k.Material.Dispose(); k.Mesh.Dispose(); }
        Kinds.Clear();
        foreach (var texture in textures) texture.Dispose(); textures.Clear();
        AnimationBytes = PictureBytes = 0;
    }
    internal sealed class Actor
    {
        internal readonly MeshInstance3D Body;
        internal readonly string Kind;
        internal Actor(Node parent, string kind)
        {
            if (!Ready) throw new IOException("smalllife missing");
            Kind = kind; var k = Kinds[kind];
            Body = new() { Name = "smalllife_" + kind, Mesh = k.Mesh, MaterialOverride = k.Material,
                CustomAabb = k.Box, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
            parent.AddChild(Body); Body.Visible = false; Pose("idle",0);
        }
        internal void Pose(string motion, double phase)
        {
            var k = Kinds[Kind]; if (!k.Clips.TryGetValue(motion, out var c)) c = k.Clips["idle"];
            float f = (float)(phase - Math.Floor(phase)) * c.Frames; int first = (int)f;
            Body.SetInstanceShaderParameter("skin_pose", new Vector3(c.First + first, c.First + (first+1)%c.Frames, f-first));
        }
    }
    internal sealed class Batch
    {
        private sealed class Draw
        {
            internal Kind Kind = null!;
            internal MultiMesh Multi = null!;
            internal float[] Buffer = Array.Empty<float>();
            internal Rid Rid;
            internal int Count, Shown = -1;
        }
        internal readonly Node3D Root;
        private readonly Dictionary<string, Draw> draws = new();
        internal int Count { get; private set; }
        internal Batch(Node parent, string name, int capacity, params string[] kinds)
        {
            if (!Ready) throw new IOException("Build and intake smalllife first");
            Root = new() { Name = name }; parent.AddChild(Root);
            foreach (string kind in kinds.Length == 0 ? (IEnumerable<string>)Kinds.Keys : kinds)
            {
                var k = Kinds[kind];
                var mm = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseCustomData = true,
                    Mesh = k.Mesh, InstanceCount = capacity, VisibleInstanceCount = 0 };
                // Town-space copies move over the entire map. Geometry bounds include every baked pose.
                mm.CustomAabb = new(new Vector3(-3000, -100, -3000), new Vector3(6000, 600, 6000));
                Root.AddChild(new MultiMeshInstance3D { Name = kind, Multimesh = mm, MaterialOverride = k.Material,
                    CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
                draws.Add(kind, new() { Kind = k, Multi = mm, Rid = mm.GetRid(), Buffer = new float[capacity * 16] });
            }
        }
        internal void Begin() { Count = 0; foreach (var d in draws.Values) d.Count = 0; }
        internal void Put(string kind, string motion, double phase, in Transform3D t)
        {
            var d = draws[kind];
            if (d.Count >= d.Multi.InstanceCount) throw new InvalidOperationException("smalllife capacity " + kind);
            if (!d.Kind.Clips.TryGetValue(motion, out var c)) c = d.Kind.Clips["idle"];
            float f = (float)(phase - Math.Floor(phase)) * c.Frames;
            int first = (int)f, o = d.Count++ * 16; var b = d.Buffer;
            b[o] = t.Basis.X.X; b[o+1] = t.Basis.Y.X; b[o+2] = t.Basis.Z.X; b[o+3] = t.Origin.X;
            b[o+4] = t.Basis.X.Y; b[o+5] = t.Basis.Y.Y; b[o+6] = t.Basis.Z.Y; b[o+7] = t.Origin.Y;
            b[o+8] = t.Basis.X.Z; b[o+9] = t.Basis.Y.Z; b[o+10] = t.Basis.Z.Z; b[o+11] = t.Origin.Z;
            b[o+12] = c.First + first; b[o+13] = c.First + (first+1)%c.Frames; b[o+14] = f-first; b[o+15] = 0;
            Count++;
        }
        internal void End()
        {
            foreach (var d in draws.Values)
            {
                if (d.Count > 0) RenderingServer.MultimeshSetBuffer(d.Rid, d.Buffer);
                if (d.Shown != d.Count) d.Multi.VisibleInstanceCount = d.Count;
                d.Shown = d.Count;
            }
        }
        internal float Stride(string kind, string motion) => draws[kind].Kind.Clips[motion].Stride;
        internal float Seconds(string kind, string motion) => draws[kind].Kind.Clips[motion].Seconds;
    }
}
