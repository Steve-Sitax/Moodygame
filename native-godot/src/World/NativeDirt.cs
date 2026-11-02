using System;
using System.Linq;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>
/// Issue #244 (Steve, 2026-10-28: "very low detail dirt where the tree stands ... find more dirt in the game and change if
/// new dirt is better"): the bake's other bare earth that the eye comes close to takes the tree pits' soil
/// (assets/materials/dirt-20261028/pit-soil.tres: a 1 m picture with its height, wet and dry, water in its hollows). The planted
/// beds of the Lijnwaadmarkt, St James's yard and the court green (one 32 px picture with a bump map) and the earth under
/// the liberty tree (a plain colour). Each keeps its mesh; its picture is laid in metres (`uv_xform` from the mesh's own uv
/// per metre), one copy of the soil material per bed, the same shader and pictures (no new kind, no new texture).
/// </summary>
public static partial class NativeDirt
{
    private const string Soil = "res://assets/materials/dirt-20261028/pit-soil.tres";
    private const float BedPool = 0.58f;
    private static readonly string[] Beds ={ "place_lijnwaadmarkt_pl_earth", "place_stjacob_yard_pl_earth", "place_court_green_pl_earth", "liberty_tree_earth" };

    /// <summary>Lays the soil on the beds found; returns how many.</summary>
    public static int Lay(Node3D town)
    {
        // (#250) the paving's mud (the setts kinds' mud lines, Psx.MudLines): Codex's wet mud, colour, wet colour and height
        const string MudDir = "res://assets/materials/dirt-20261028/wet_mud_";
        if (ResourceLoader.Exists(MudDir + "dry.res") && ResourceLoader.Exists(MudDir + "wet.res") && ResourceLoader.Exists(MudDir + "height.res"))
        {
            Scheldemist.Render.Psx.SetMud(GD.Load<Texture2D>(MudDir + "dry.res"), GD.Load<Texture2D>(MudDir + "wet.res"), GD.Load<Texture2D>(MudDir + "height.res"));
            MarketMud(town);
            RutMud(town);
        }
        if (!ResourceLoader.Exists(Soil)) return 0;
        var soil = GD.Load<ShaderMaterial>(Soil);
        int n = 0;
        foreach (var bed in BakedWorld.All(town).OfType<MeshInstance3D>().Where(m => Beds.Contains(m.Name.ToString()) && m.Mesh is ArrayMesh))
        {
            float perMetre = UvPerMetre((ArrayMesh)bed.Mesh, Scale(bed));
            if (perMetre <= 0) continue;
            var m = (ShaderMaterial)soil.Duplicate();
            m.ResourceName = "soil_" + bed.Name;
            m.SetShaderParameter("uv_xform", new Vector4(1 / perMetre, 1 / perMetre, 0, 0));
            // (#257) a bed is wide and flat: after rain its water stands higher than a pit's, so its hollows join into a pool
            m.SetShaderParameter("soil_pool", BedPool);
            for (int s = 0; s < bed.Mesh.GetSurfaceCount(); s++) bed.SetSurfaceOverrideMaterial(s, m);
            GD.Print($"dirt: {bed.Name} soil, {perMetre:0.###} uv a metre");
            n++;
        }
        return n + Yards(town) + Mud(town);
    }

    /// <summary>
    /// #254: the back yards' bare earth (city/ground_earth, 20,400 m2: the courts inside the blocks, 14,100 m2 of them
    /// walked in, with their pumps, barrels and weeds) was flat: its relief kind had its height map (r000006, 4 m a repeat)
    /// but a depth of 0 and a bump of 0.25. Its own picture stays (Codex's yard dirt was tried and read blurrier than its
    /// crisp grit); its pebbles and hollows get real depth (parallax, <see cref="YardDepth"/>) and the relief light
    /// (<see cref="YardBump"/>). A uniform of its kind changed, no new kind. Returns 1 if laid.
    /// </summary>
    private const float YardDepth = 0.025f, YardBump = 3.5f;
    private static int Yards(Node3D town)
    {
        int n = 0;
        foreach (var yard in BakedWorld.All(town).OfType<MeshInstance3D>().Where(m => m.Name.ToString() == "ground_earth" && m.Mesh is ArrayMesh))
            for (int s = 0; s < yard.Mesh.GetSurfaceCount(); s++)
            {
                if ((yard.GetSurfaceOverrideMaterial(s) ?? yard.Mesh.SurfaceGetMaterial(s)) is not ShaderMaterial old || old.GetShaderParameter("relief_h").Obj == null) continue;
                var m = (ShaderMaterial)old.Duplicate();
                m.ResourceName = "yard_earth";
                m.SetShaderParameter("relief_depth", YardDepth);
                m.SetShaderParameter("relief_bump", YardBump);
                yard.SetSurfaceOverrideMaterial(s, m);
                GD.Print($"dirt: {yard.Name} yard earth, relief {YardDepth * 1000:0} mm, bump {YardBump}");
                n++;
            }
        return n;
    }

    /// <summary>
    /// #251: the market's mud stains (market_mud, on the flags of the Grote Markt, the Vismarkt and round the stalls) take the
    /// street mud's picture and relief in their shape (their decal kind's mud lines, Psx.DecalMudLines: off unless
    /// `mud_relief`). One material, shared by every stain; the chalk marks in the same kind stay as they were.
    /// </summary>
    /// <summary>
    /// #249: the town's cart-track rut strips (the `ruts` node, 1,886 m2 along the cart roads) take deep grooves where they
    /// cross the street mud (their decal kind's rut lines, Psx.RutMudLines: off unless `rut_mud`). Their own copy of the
    /// material: the opening bridges' decks share it and have no mud.
    /// </summary>
    private static void RutMud(Node3D town)
    {
        int n = 0;
        foreach (var mi in BakedWorld.All(town).OfType<MeshInstance3D>().Where(m => m.Name.ToString() == "ruts" && m.Mesh != null))
            for (int s = 0; s < mi.Mesh.GetSurfaceCount(); s++)
            {
                if ((mi.GetSurfaceOverrideMaterial(s) ?? mi.Mesh.SurfaceGetMaterial(s)) is not ShaderMaterial old || old.Shader?.Code.Contains("uniform float rut_mud") != true) continue;
                var m = (ShaderMaterial)old.Duplicate();
                m.ResourceName = "ruts_mud";
                m.SetShaderParameter("rut_mud", 1f);
                mi.SetSurfaceOverrideMaterial(s, m);
                n++;
            }
        GD.Print($"dirt: ruts, deep grooves in the street mud on {n} surface(s)");
    }

    private static void MarketMud(Node3D town)
    {
        var done = new System.Collections.Generic.HashSet<ShaderMaterial>();
        foreach (var mi in BakedWorld.All(town).OfType<MeshInstance3D>())
        {
            if (mi.Mesh == null) continue;
            for (int s = 0; s < mi.Mesh.GetSurfaceCount(); s++)
                if (mi.Mesh.SurfaceGetMaterial(s) is ShaderMaterial m && m.ResourceName == "market_mud" && m.Shader?.Code.Contains("uniform float mud_relief") == true && done.Add(m))
                    m.SetShaderParameter("mud_relief", 1f);
        }
        GD.Print($"dirt: market mud, the street mud's picture and relief in {done.Count} material(s)");
    }

    /// <summary>
    /// The canals' beds (town/tide_mud's tide_bed surface, bared at low water; #252): Codex's tidal silt instead of the pale
    /// sand ripples, in the mud's own stored shader with its silt lines (Psx.SiltLines, scripts/SiltRepair.cs: no new kind).
    /// The wet silt and the drier silt higher up, hex-tiled in world metres with each hexagon turned its own way (a 2 m tile
    /// laid plain repeats like a camouflage print); the water is laid in world space from the river's level now (SiltLevel),
    /// so the water line breaks into inlets and the pools join up. No parallax: the silt's relief is a few millimetres, the
    /// lights take it from its normal map. The thin sloped strip at the moat's and the river's walls (the tide_mud surface)
    /// kept its sand ripples after #252 (the plain silt there read blurred, its water's edge ruled). Since #255 it takes the
    /// silt with the strip's own detail (silt_strip: lumps, the ebb's runnels, burrows and casts, grit and pebbles, a broken
    /// water line); its mesh's normals are smoothed and its length along the wall goes into UV2 (StripMesh).
    /// </summary>
    private static int Mud(Node3D town)
    {
        const string Dir = "res://assets/materials/dirt-20261028/";
        if (!ResourceLoader.Exists(Dir + "silt_wet.res")) return 0;
        var mud = BakedWorld.All(town).OfType<MeshInstance3D>().FirstOrDefault(m => m.Name == "tide_mud" && m.Mesh is ArrayMesh);
        if (mud == null) return 0;
        var wet = GD.Load<Texture2D>(Dir + "silt_wet.res");
        var dry = GD.Load<Texture2D>(Dir + "silt_dry.res");
        var rel = GD.Load<Texture2D>(Dir + "silt_relief.res");
        var silts = new System.Collections.Generic.List<ShaderMaterial>();
        var strips = new System.Collections.Generic.List<ShaderMaterial>();
        int stripSurface = -1;
        for (int s = 0; s < mud.Mesh.GetSurfaceCount(); s++)
        {
            // (the stored shader without the silt lines: the ripples stay; without the strip's lines the strip keeps them)
            if (mud.Mesh.SurfaceGetMaterial(s) is not ShaderMaterial m || m.Shader?.Code.Contains("uniform float silt ") != true) continue;
            bool strip = m.ResourceName == WallFoot;
            if (strip && m.Shader.Code.Contains("uniform float silt_strip") != true) continue;
            if (m.ResourceName != CanalBeds && !strip) continue;
            if (strip)
            {
                stripSurface = s;
                m.SetShaderParameter("silt_strip", 1f);
                m.SetShaderParameter("silt_tile", 1.6f);
                m.SetShaderParameter("albedo", StripTint);
                strips.Add(m);
            }
            else
            {
                m.SetShaderParameter("albedo", BedTint);
                silts.Add(m);
            }
            m.SetShaderParameter("tex", wet);
            m.SetShaderParameter("silt_dry", dry);
            m.SetShaderParameter("silt_rel", rel);
            // (the ripples' height goes; the relief light and the parallax are the sand's, not the silt's)
            m.SetShaderParameter("relief_h", rel);
            m.SetShaderParameter("relief_depth", 0f);
            m.SetShaderParameter("silt", 1f);
            if (!strip) m.SetShaderParameter("silt_tile", 2f);
            m.SetShaderParameter("silt_bump", SiltBump);
            m.SetShaderParameter("silt_pools", SiltPools);
            // (the silt's own wet: no second darkening by the tide band; a dielectric's highlight, a wet sheet's)
            m.SetShaderParameter("tide_wet", 0f);
            m.SetShaderParameter("spec_color", new Vector3(0.02f, 0.02f, 0.02f));
            m.SetShaderParameter("shininess", 48f);
        }
        if (silts.Count + strips.Count == 0) return 0;
        string runs = stripSurface >= 0 ? StripMesh((ArrayMesh)mud.Mesh, stripSurface) : "";
        mud.AddChild(new SiltLevel { Name = "silt_level", Silts = silts, Strips = strips });
        // (#256) the silt draws the beds' water itself: the old calm sheet's bright ribbon and the pools' flat sheets go
        if (silts.Count > 0) Waters.BedsDrawWater = true;
        GD.Print($"dirt: tide mud, tidal silt on the canals' beds ({silts.Count} surface) and the walls' foot ({strips.Count} surface{runs})");
        return 1;
    }

    /// <summary>
    /// (#255) The walls' foot strip's mesh (2 m triangles in three rows: the wall's foot, the middle, the water's side) had
    /// a flat normal on each triangle: the light broke at every edge into straight lines across the silt. Its normals are
    /// smoothed (by area, over the corners at one place), and UV2 gets each corner's length along its run of the wall in
    /// metres (x; its wall-foot row chained from one end, every corner placed on that line) and how far the nearer end of
    /// the run is (y): the runnels' measure across the slope. Places and triangles stay as they are; the canals' beds'
    /// surface is laid again as it was.
    /// </summary>
    private static string StripMesh(ArrayMesh mesh, int surface)
    {
        var all = new Godot.Collections.Array[mesh.GetSurfaceCount()];
        var mats = new Material[all.Length];
        var names = new string[all.Length];
        for (int s = 0; s < all.Length; s++)
        {
            all[s] = mesh.SurfaceGetArrays(s);
            mats[s] = mesh.SurfaceGetMaterial(s);
            names[s] = mesh.SurfaceGetName(s);
        }
        var a = all[surface];
        var v = a[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        var ix = a[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.PackedInt32Array ? a[(int)Mesh.ArrayType.Index].AsInt32Array() : Enumerable.Range(0, v.Length).ToArray();
        // (the corners at one place, to the millimetre)
        var weld = new System.Collections.Generic.Dictionary<(long, long, long), int>();
        var id = new int[v.Length];
        for (int i = 0; i < v.Length; i++)
        {
            var k = ((long)MathF.Round(v[i].X * 1000), (long)MathF.Round(v[i].Y * 1000), (long)MathF.Round(v[i].Z * 1000));
            if (!weld.TryGetValue(k, out id[i])) weld[k] = id[i] = weld.Count;
        }
        int n = weld.Count;
        var pos = new Vector3[n];
        for (int i = 0; i < v.Length; i++) pos[id[i]] = v[i];
        var sum = new Vector3[n];
        var root = Enumerable.Range(0, n).ToArray();
        int Find(int x) { while (root[x] != x) x = root[x] = root[root[x]]; return x; }
        for (int t = 0; t + 2 < ix.Length; t += 3)
        {
            int p = id[ix[t]], q = id[ix[t + 1]], r = id[ix[t + 2]];
            var f = (pos[q] - pos[p]).Cross(pos[r] - pos[p]);
            if (f.Y < 0) f = -f;
            sum[p] += f; sum[q] += f; sum[r] += f;
            root[Find(p)] = Find(q); root[Find(r)] = Find(q);
        }
        var normals = new Vector3[v.Length];
        for (int i = 0; i < v.Length; i++) normals[i] = sum[id[i]].LengthSquared() > 1e-12f ? sum[id[i]].Normalized() : Vector3.Up;
        // each run of the wall: its wall-foot corners (within 12 cm of its top) chained from one end, nearest first
        var along = new Vector2[n];
        int count = 0;
        foreach (var run in Enumerable.Range(0, n).GroupBy(Find))
        {
            var corners = run.ToList();
            float top = corners.Max(c => pos[c].Y);
            var foot = corners.Where(c => pos[c].Y > top - 0.12f).Select(c => new Vector2(pos[c].X, pos[c].Z)).ToList();
            var line = new System.Collections.Generic.List<Vector2>();
            if (foot.Count >= 2)
            {
                var mid = foot.Aggregate(Vector2.Zero, (s, p) => s + p) / foot.Count;
                var at = foot.OrderByDescending(p => p.DistanceSquaredTo(mid)).First();
                var left = foot.ToList();
                while (left.Count > 0)
                {
                    var near = left.OrderBy(p => p.DistanceSquaredTo(at)).First();
                    left.Remove(near);
                    line.Add(near);
                    at = near;
                }
            }
            else
            {
                // (no wall-foot row: along the run's longest way)
                var ps = corners.Select(c => new Vector2(pos[c].X, pos[c].Z)).ToList();
                var p0 = ps.OrderByDescending(p => p.DistanceSquaredTo(ps[0])).First();
                line.Add(p0);
                line.Add(ps.OrderByDescending(p => p.DistanceSquaredTo(p0)).First());
            }
            var length = new float[line.Count];
            for (int k = 1; k < line.Count; k++) length[k] = length[k - 1] + line[k].DistanceTo(line[k - 1]);
            float total = length[^1];
            // (each run's measure starts at its own offset: the runnels of two runs side by side do not line up)
            float offset = 37.1f * count++;
            foreach (int c in corners)
            {
                var q = new Vector2(pos[c].X, pos[c].Z);
                float best = float.MaxValue, u = 0;
                for (int k = 0; k + 1 < line.Count; k++)
                {
                    var d = line[k + 1] - line[k];
                    float l2 = d.LengthSquared();
                    float t = l2 > 1e-9f ? Math.Clamp((q - line[k]).Dot(d) / l2, 0, 1) : 0;
                    float dist = q.DistanceTo(line[k] + d * t);
                    if (dist < best) { best = dist; u = length[k] + t * MathF.Sqrt(l2); }
                }
                along[c] = new Vector2(offset + u, Math.Min(u, total - u));
            }
        }
        var uv2 = new Vector2[v.Length];
        for (int i = 0; i < v.Length; i++) uv2[i] = along[id[i]];
        a[(int)Mesh.ArrayType.Normal] = normals;
        a[(int)Mesh.ArrayType.TexUV2] = uv2;
        // (tangents for the old normals would be wrong: none, the shader does not read them)
        a[(int)Mesh.ArrayType.Tangent] = default;
        mesh.ClearSurfaces();
        for (int s = 0; s < all.Length; s++)
        {
            // (no custom channels on this mesh; no compression: the arrays came out of it already)
            mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, all[s]);
            mesh.SurfaceSetMaterial(s, mats[s]);
            mesh.SurfaceSetName(s, names[s]);
        }
        return $", {count} runs, normals smoothed";
    }
    // (the canals' beds' surface; the mesh's vertex colour tints it green-grey, the silt comes back to its own grey-brown)
    private const string CanalBeds = "tide_bed";
    private static readonly Color BedTint = new(1.35f, 1.18f, 1.02f, 1);
    // (#255) the sloped strip at the moat's and the river's walls; its vertex colour is a paler grey-brown, not the beds'
    // green: the silt's own grey-brown, a little darker than the beds' (fresh off the tide)
    private const string WallFoot = "tide_mud";
    private static readonly Color StripTint = new(1.5f, 1.32f, 1.06f, 1);
    private const float SiltBump = 1.2f, SiltPools = 0.18f;
    // (#256) how deep the trickle stands in the canals' bed trench at low water (the trench is 0.22 m deep)
    private const float TrickleDepth = 0.15f;

    /// <summary>The river's level now for the silt's water line (Tide.River follows the clock or the tide kit's hold).</summary>
    private sealed partial class SiltLevel : Node
    {
        public System.Collections.Generic.List<ShaderMaterial> Silts = new();
        // (#255) the walls' foot strip: the moat's and the river's own water, no trickle
        public System.Collections.Generic.List<ShaderMaterial> Strips = new();
        private float last = float.NaN, lastRiver = float.NaN;
        public override void _Process(double delta)
        {
            if (Tide.River != lastRiver)
            {
                lastRiver = Tide.River;
                foreach (var m in Strips) m.SetShaderParameter("silt_level", lastRiver);
            }
            // (#256: at low water the canals keep a trickle in their bed's trench: the silt's water line holds there, so the
            // trickle is drawn in the silt's own water, its edge broken, instead of the old calm sheet)
            float level = MathF.Max(Tide.River, Waters.TrickleY + TrickleDepth);
            if (level == last) return;
            last = level;
            foreach (var m in Silts) m.SetShaderParameter("silt_level", last);
        }
    }

    /// <summary>A node's turn and scale in the town (the town is not in the tree yet: its parents' own transforms).</summary>
    private static Basis Scale(Node3D node)
    {
        var b = Basis.Identity;
        for (Node? n = node; n is Node3D n3; n = n.GetParent()) b = n3.Transform.Basis * b;
        return b;
    }

    /// <summary>The mesh's uv per world metre: the square root of its uv area over its world area.</summary>
    private static float UvPerMetre(ArrayMesh mesh, Basis basis)
    {
        double uvArea = 0, area = 0;
        for (int s = 0; s < mesh.GetSurfaceCount(); s++)
        {
            var a = mesh.SurfaceGetArrays(s);
            var v = a[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            if (a[(int)Mesh.ArrayType.TexUV].VariantType != Variant.Type.PackedVector2Array) continue;
            var uv = a[(int)Mesh.ArrayType.TexUV].AsVector2Array();
            var ix = a[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.PackedInt32Array ? a[(int)Mesh.ArrayType.Index].AsInt32Array() : Enumerable.Range(0, v.Length).ToArray();
            for (int t = 0; t + 2 < ix.Length; t += 3)
            {
                int i = ix[t], j = ix[t + 1], k = ix[t + 2];
                area += (basis * (v[j] - v[i])).Cross(basis * (v[k] - v[i])).Length() / 2;
                var du = uv[j] - uv[i]; var dv = uv[k] - uv[i];
                uvArea += Math.Abs(du.X * dv.Y - du.Y * dv.X) / 2;
            }
        }
        return area > 1e-6 ? (float)Math.Sqrt(uvArea / area) : 0;
    }
}
