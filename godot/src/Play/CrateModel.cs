using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.Play;

/// <summary>
/// The one packing crate of the town (Steve 2026-10-11: "wooden boxes have a bunch of textures, I think we only need
/// one, and make it high detail"): crate.glb (tools/blender/build_crate.py), the browser's game/crateModel.ts. Sizes
/// are classes of the one model scaled as a whole; what it says (its goods' stencil) is picked by its lot the same way
/// as shared/crateCatalog.ts does, so a crate says the same in the browser and here, on the pile, in hands, on a cart.
/// The front and back boards ("crate_marks") are the goods' cell of the picture: their uv moved by the cell.
/// </summary>
public static class CrateModel
{
    /// <summary>The model at class 1 (m): length along x, depth along z, height (shared/crateCatalog.ts).</summary>
    public const float L = 0.8f, D = 0.56f, H = 0.5f;
    /// <summary>The sides' top under the lid, over the height (an open crate's height).</summary>
    public const float OpenH = 0.462f / 0.5f;
    public static readonly Dictionary<string, float> Class = new() { ["small"] = 0.88f, ["standard"] = 1f, ["large"] = 1.25f, ["big"] = 1.5f };
    /// <summary>props.glb's crate models (the goods' "p:" looks): class and open (crateModel.ts PROP_CRATES).</summary>
    public static readonly Dictionary<string, (string Cls, bool Open)> PropCrates = new()
    {
        ["crate"] = ("large", false),
        ["crate_small"] = ("small", false),
        ["crate_seat"] = ("small", false),
        ["crate_big"] = ("big", false),
        ["crate_open"] = ("big", true),
        ["crate_broken"] = ("big", true),
    };
    /// <summary>How many goods the picture has (shared/crateCatalog.ts CRATE_GOODS).</summary>
    public const int Goods = 18;
    // the goods' cells in the picture (tools/textures/crate_sheet.mjs): width, height (uv), columns
    private const float CellW = 432f / 4096f, CellH = 462f / 2048f;
    private const int Cols = 9;

    public static float Height(string cls = "standard") => H * Class[cls];

    /// <summary>shared/crateCatalog.ts crateHash (FNV-1a).</summary>
    private static uint Hash(string s)
    {
        uint h = 2166136261;
        foreach (char c in s) h = unchecked((h ^ c) * 16777619);
        return h;
    }

    /// <summary>The goods of a lot (shared/crateCatalog.ts pickCrate).</summary>
    public static int Pick(string seed) => (int)((Hash(seed + "#crate") >> 3) % Goods);

    private static readonly Regex Lot = new("^(haul:|crate:|qg:|job:|pile:|own:|spawn:)");
    private static readonly Regex LastNumber = new(":\\d+$");

    /// <summary>What a goods item's crate says, by its id (shared/crateCatalog.ts crateLabelFor).</summary>
    public static int LabelFor(string? id)
    {
        string s = id ?? "";
        string lot = Lot.IsMatch(s) ? LastNumber.Replace(s, "") : s;
        return Pick(lot);
    }

    private static ModelLibrary.Model? Lib => ModelLibrary.Get("crate", new ModelLibrary.Look(Affine: 0, VertexColor: true));
    private static readonly Dictionary<(int, bool), Mesh> marks = new();

    /// <summary>The stencilled boards of the goods `cell`: the model's marks with their uv moved to the cell.</summary>
    private static Mesh? Marks(Mesh src, int cell, bool open)
    {
        cell = ((cell % Goods) + Goods) % Goods;
        if (cell == 0) return src;
        if (marks.TryGetValue((cell, open), out var hit)) return hit;
        var du = cell % Cols * CellW;
        var dv = cell / Cols * CellH;
        var outMesh = new ArrayMesh();
        for (int s = 0; s < src.GetSurfaceCount(); s++)
        {
            var arrays = src.SurfaceGetArrays(s);
            var uv = arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();
            for (int i = 0; i < uv.Length; i++) uv[i] = new Vector2(uv[i].X + du, uv[i].Y + dv);
            arrays[(int)Mesh.ArrayType.TexUV] = uv;
            outMesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);
            outMesh.SurfaceSetMaterial(s, src.SurfaceGetMaterial(s));
        }
        marks[(cell, open)] = outMesh;
        return outMesh;
    }

    /// <summary>The one crate, the goods `cell`, closed or open, scaled as a whole; its foot at y 0, its front to +z. Null without crate.glb.</summary>
    public static Node3D? Make(int cell, bool open = false, float scale = 1f)
    {
        var lib = Lib;
        string name = open ? "crate_open" : "crate";
        var c = lib?.Copy(name);
        if (c == null) return null;
        foreach (var n in c.FindChildren("*", "MeshInstance3D", true, false))
            if (n is MeshInstance3D mi && mi.Name.ToString().EndsWith("_marks", StringComparison.Ordinal) && mi.Mesh != null)
                mi.Mesh = Marks(mi.Mesh, cell, open);
        c.Transform = Transform3D.Identity;
        c.Scale = Vector3.One * scale;
        c.Name = "crate";
        return c;
    }

    /// <summary>A goods item's crate (its stencil by its id), at a class.</summary>
    public static Node3D? Of(string? id, string cls = "standard", bool open = false, float scale = 1f) => Make(LabelFor(id), open, Class[cls] * scale);
}
