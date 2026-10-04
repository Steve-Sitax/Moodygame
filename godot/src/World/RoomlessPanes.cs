using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.World;

/// <summary>
/// The Steen's old window panes where no room stands behind (issue #56; Steve, 2026-10-04: the cheap outside fix).
/// The bake hides a landmark's old panes ("steen_glass_lit", BakedWorld: their glass is the room's, issue #10); the
/// Steen's room reaches only the two small windows by the museum door; behind the three tall ones to its right are
/// only the hall's faint beams of light, and from the street the far fog showed through. Here each old pane is looked
/// behind: a pane with no solid face of a room turned to it in the 3 m behind is drawn again, with the Steen's own glass (the dark leaded panes of its other windows, as the browser shows them there).
/// One mesh, the shell glass's material: no new shader, no light. The window light at night lies 3 cm out in front.
/// </summary>
[GamePart(28)]
public partial class RoomlessPanes : Node
{
    /// <summary>The old panes looked at, and the shell glass each takes when it has no room behind.</summary>
    private static readonly (string panes, string glass)[] Sets = { ("steen_glass_lit", "steen_glass") };

    /// <summary>For a check: old panes looked at, and those drawn again (no room behind).</summary>
    public static (int panes, int drawn) Info { get; private set; }

    public override void _Ready()
    {
        var town = Main.I.World.GetNodeOrNull<Node3D>("town");
        if (town == null) return;
        var all = BakedWorld.All(town).OfType<MeshInstance3D>().ToList();
        // the rooms' own meshes (not their glass): what a pane may have behind it
        // (not its glass, nor a see-through card: the hall's beams of light behind the tall windows are 8 % added light)
        var rooms = all.Where(m => InRoom(m) && m.Mesh != null && !Enumerable.Range(0, m.Mesh.GetSurfaceCount()).Any(s => m.Mesh.SurfaceGetMaterial(s) is Material sm
                && (sm.ResourceName.Contains("glass") || (sm is ShaderMaterial sh && Render.Psx.KindOf(sh.Shader) is { Blend: true }))))
            .Select(m => (box: (m.GlobalTransform * m.GetAabb()).Grow(0.05f), m)).ToList();
        // (a room's mesh behind the pane: its own faces met, not only its box: a room's walls' box spans its whole front)
        var tris = new Dictionary<MeshInstance3D, TriangleMesh?>();
        bool Behind(Vector3 a, Vector3 b)
        {
            foreach (var (box, m) in rooms)
            {
                if (!box.IntersectsSegment(a, b)) continue;
                if (!tris.TryGetValue(m, out var tm)) tris[m] = tm = m.Mesh.GenerateTriangleMesh();
                var inv = m.GlobalTransform.AffineInverse();
                if (tm == null) continue;
                var hit = tm.IntersectSegment(inv * a, inv * b);
                // (only a face turned to the window is seen from the street: a room's inner lining faces into the room)
                if (hit.Count > 0 && (m.GlobalTransform.Basis * hit["normal"].AsVector3()).Dot(a - b) > 0) return true;
            }
            return false;
        }
        int seen = 0, drawn = 0;
        foreach (var (paneName, glassName) in Sets)
        {
            var old = all.FirstOrDefault(m => m.Name == paneName && m.Mesh is ArrayMesh);
            var shell = all.FirstOrDefault(m => m.Name == glassName && m.GetParent() == old?.GetParent());
            var glass = shell?.Mesh?.SurfaceGetMaterial(0);
            if (old == null || glass == null) continue;
            // (a bake made after the browser's fix draws them itself: nothing to do)
            if (old.Mesh.SurfaceGetMaterial(0) is not ShaderMaterial om || !om.HasMeta("baked_invisible")) continue;
            var arr = ((ArrayMesh)old.Mesh).SurfaceGetArrays(0);
            var pos = arr[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            var nrm = arr[(int)Mesh.ArrayType.Normal].AsVector3Array();
            var uv = arr[(int)Mesh.ArrayType.TexUV].AsVector2Array();
            var col = arr[(int)Mesh.ArrayType.Color].AsColorArray();
            var idx = arr[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? Enumerable.Range(0, pos.Length).ToArray() : arr[(int)Mesh.ArrayType.Index].AsInt32Array();
            var xf = old.GlobalTransform;
            var inside = (xf * old.GetAabb()).GetCenter();
            if (shell != null) inside = (shell.GlobalTransform * shell.GetAabb()).GetCenter();
            // the panes: triangles sharing a corner
            var parent = Enumerable.Range(0, pos.Length).ToArray();
            int Find(int i) { while (parent[i] != i) i = parent[i] = parent[parent[i]]; return i; }
            var at = new Dictionary<(int, int, int), int>();
            for (int i = 0; i < pos.Length; i++)
            {
                var k = ((int)Mathf.Round(pos[i].X * 50), (int)Mathf.Round(pos[i].Y * 50), (int)Mathf.Round(pos[i].Z * 50));
                if (at.TryGetValue(k, out int j)) parent[Find(i)] = Find(j);
                else at[k] = i;
            }
            for (int t = 0; t < idx.Length; t += 3) { parent[Find(idx[t + 1])] = Find(idx[t]); parent[Find(idx[t + 2])] = Find(idx[t]); }
            var keep = new List<int>();
            foreach (var pane in Enumerable.Range(0, idx.Length / 3).GroupBy(t => Find(idx[t * 3])))
            {
                seen++;
                var c = Vector3.Zero;
                foreach (int t in pane) for (int q = 0; q < 3; q++) c += xf * pos[idx[t * 3 + q]];
                c /= pane.Count() * 3;
                int t0 = pane.First();
                var n = (xf * pos[idx[t0 * 3 + 1]] - xf * pos[idx[t0 * 3]]).Cross(xf * pos[idx[t0 * 3 + 2]] - xf * pos[idx[t0 * 3]]).Normalized();
                // (into the building: toward its middle, level)
                var inn = new Vector3(n.X, 0, n.Z).Normalized();
                if (inn.Dot(new Vector3(inside.X - c.X, 0, inside.Z - c.Z)) < 0) inn = -inn;
                Vector3 a = c + inn * 0.3f, b = c + inn * 3;
                bool behind = Behind(a, b);
                GD.Print($"roomless panes: {paneName} pane at {c.Round()} {(behind ? "has a room behind" : "has no room behind")}");
                if (behind) continue;
                foreach (int t in pane) for (int q = 0; q < 3; q++) keep.Add(idx[t * 3 + q]);
                drawn++;
            }
            if (keep.Count == 0) continue;
            var outArr = new Godot.Collections.Array();
            outArr.Resize((int)Mesh.ArrayType.Max);
            outArr[(int)Mesh.ArrayType.Vertex] = pos;
            if (nrm.Length == pos.Length) outArr[(int)Mesh.ArrayType.Normal] = nrm;
            if (uv.Length == pos.Length) outArr[(int)Mesh.ArrayType.TexUV] = uv;
            if (col.Length == pos.Length) outArr[(int)Mesh.ArrayType.Color] = col;
            outArr[(int)Mesh.ArrayType.Index] = keep.ToArray();
            var mesh = new ArrayMesh();
            mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, outArr);
            mesh.SurfaceSetMaterial(0, glass);
            old.GetParent().AddChild(new MeshInstance3D { Name = paneName + "_roomless", Mesh = mesh, Transform = old.Transform, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
        }
        Info = (seen, drawn);
        GD.Print($"roomless panes: {seen} old panes, {drawn} with no room behind drawn with their shell's glass");
    }

    private static bool InRoom(Node n)
    {
        for (var q = n; q != null; q = q.GetParent()) if (q.Name.ToString().StartsWith("ROOM_")) return true;
        return false;
    }
}
