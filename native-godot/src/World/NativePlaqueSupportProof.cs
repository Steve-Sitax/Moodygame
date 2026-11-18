using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.World.Ruien;

namespace Scheldemist.Native.World;

/// <summary>Continuous mounting footprint against the cut, installed masonry and the corresponding area solid.</summary>
public sealed class NativePlaqueSupportProof
{
    private const float Margin = .012f;
    private const double AreaTolerance = 1e-9; // square metres; below the positional precision of the export
    private readonly NativeTownGame game;
    private readonly Dictionary<MeshInstance3D, FaceIndex> pieceFaces = new();
    private string lastArea = "";
    private FaceIndex? collision;

    public NativePlaqueSupportProof(NativeTownGame game)
    {
        this.game = game;
        CheckCoverageControls();
    }

    private readonly record struct Triangle(Vector3 A, Vector3 B, Vector3 C);
    private readonly record struct Point(double X, double Y)
    {
        public static double Side(Point a, Point b, Point p) => (b.X-a.X)*(p.Y-a.Y) - (b.Y-a.Y)*(p.X-a.X);
        public static Point Lerp(Point a, Point b, double f) => new(a.X+(b.X-a.X)*f, a.Y+(b.Y-a.Y)*f);
    }

    // Keep just nearby face indices in each 2 m cell. A whole cut area can contain hundreds of thousands of faces.
    private sealed class FaceIndex
    {
        private readonly List<Triangle> faces = new();
        private readonly Dictionary<(int, int), List<int>> cells = new();
        private static int Cell(float x) => (int)MathF.Floor(x * .5f);

        public void Add(Triangle t)
        {
            int index = faces.Count;
            faces.Add(t);
            var min = t.A.Min(t.B).Min(t.C);
            var max = t.A.Max(t.B).Max(t.C);
            for (int x=Cell(min.X); x<=Cell(max.X); x++)
            for (int z=Cell(min.Z); z<=Cell(max.Z); z++)
            {
                if (!cells.TryGetValue((x,z), out var ids)) cells[(x,z)] = ids = new();
                ids.Add(index);
            }
        }

        public IEnumerable<Triangle> Near(Aabb box)
        {
            var seen = new HashSet<int>();
            for (int x=Cell(box.Position.X); x<=Cell(box.End.X); x++)
            for (int z=Cell(box.Position.Z); z<=Cell(box.End.Z); z++)
            {
                if (!cells.TryGetValue((x,z), out var ids)) continue;
                foreach (int id in ids)
                {
                    if (!seen.Add(id)) continue;
                    var t = faces[id];
                    if (t.A.Y<box.Position.Y && t.B.Y<box.Position.Y && t.C.Y<box.Position.Y ||
                        t.A.Y>box.End.Y && t.B.Y>box.End.Y && t.C.Y>box.End.Y) continue;
                    yield return t;
                }
            }
        }
    }

    private static bool Structural(string family) => family is "ruien_brick_stretcher" or "ruien_brick_flemish"
        or "ruien_brick_header" or "ruien_sandstone" or "ruien_bluestone" or "ruien_misc_Mortar_header";

    private FaceIndex Faces(RuienArea area, MeshInstance3D part)
    {
        if (pieceFaces.TryGetValue(part, out var cached)) return cached;
        // Bound the working set on long stretches. The certificate only reads the host being tested.
        if (pieceFaces.Count >= 12) pieceFaces.Remove(pieceFaces.Keys.First());
        var result = new FaceIndex();
        var xf = part.GlobalTransform;
        using var privateMesh = part.Mesh == null && area.MountingProofFile(part) is { } file
            ? ResourceLoader.Load<ArrayMesh>(file, cacheMode:ResourceLoader.CacheMode.Ignore) : null;
        if ((part.Mesh as ArrayMesh ?? privateMesh) is not { } mesh)
            throw new InvalidOperationException("Missing installed visual mesh for " + part.GetPath());
        for (int s=0; s<mesh.GetSurfaceCount(); s++)
        {
            if (!Structural(mesh.SurfaceGetName(s))) continue;
            using var arrays = mesh.SurfaceGetArrays(s);
            var vertices = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            var indices = arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
            if (xf != Transform3D.Identity)
                for (int i=0; i<vertices.Length; i++) vertices[i] = xf * vertices[i];
            int count = indices.Length == 0 ? vertices.Length : indices.Length;
            for (int i=0; i+2<count; i+=3)
            {
                int a = indices.Length == 0 ? i : indices[i];
                int b = indices.Length == 0 ? i+1 : indices[i+1];
                int c = indices.Length == 0 ? i+2 : indices[i+2];
                result.Add(new Triangle(vertices[a], vertices[b], vertices[c]));
            }
        }
        return pieceFaces[part] = result;
    }

    private FaceIndex? Collision(string areaId)
    {
        var shape = game.View.GetNodeOrNull<StaticBody3D>("ruien_"+areaId+"_solid")?.GetChildren()
            .OfType<CollisionShape3D>().FirstOrDefault(s=>!s.Disabled && s.Shape is ConcavePolygonShape3D);
        if (shape?.Shape is not ConcavePolygonShape3D owner) return null;
        var verts = owner.GetFaces();
        var xf = shape.GlobalTransform;
        if (xf != Transform3D.Identity)
            for (int i=0; i<verts.Length; i++) verts[i] = xf * verts[i];
        var index = new FaceIndex();
        for (int i=0; i+2<verts.Length; i+=3) index.Add(new Triangle(verts[i], verts[i+1], verts[i+2]));
        return index;
    }

    public bool Supports(string areaId, MeshInstance3D plaque, out string reason)
    {
        if (Ruien.I?.MountingProofArea(areaId) is not { } area)
        {
            reason = "missing exported host " + areaId;
            return false;
        }
        if (areaId != lastArea)
        {
            lastArea = areaId;
            pieceFaces.Clear();
            collision = Collision(areaId);
        }
        if (collision == null)
        {
            reason = "missing area collision " + areaId;
            return false;
        }
        var xf = plaque.IsInsideTree() ? plaque.GlobalTransform : plaque.Transform;
        var back = plaque.GetAabb();
        float x0=back.Position.X-Margin, y0=back.Position.Y-Margin, x1=back.End.X+Margin, y1=back.End.Y+Margin;
        // The recessed flange must reach the drawn wall, which must remain behind the lettered face.
        var contact = new Aabb(new Vector3(x0,y0,back.Position.Z),new Vector3(x1-x0,y1-y0,.001f-back.Position.Z));
        var world = xf * contact;
        var inv = xf.AffineInverse();
        var rim = Rectangle(x0,y0,x1,y1);
        // A simplified collider can sit slightly inside its detailed surface. It must still be this host's
        // continuous wall, across the same rim, while render geometry proves the physical seating depth.
        var physical = contact.Grow(.025f);
        double missing = Unsupported(rim, collision.Near(xf*physical), inv, physical.Position.Z, physical.End.Z, false);
        if (missing>AreaTolerance)
        {
            reason = $"host collision leaves {missing*1e6:F2} mm² unsupported";
            return false;
        }
        double best = Area(rim);
        string where = "no host mesh at this site";
        foreach (var key in area.Keys)
        {
            if (!(area.Root.GlobalTransform * key.Box).Grow(.005f).Intersects(world)) continue;
            // A single structural key must carry the whole plaque at each distance. This also certifies
            // the transition where adjacent vault sections can independently choose different LODs.
            double worst = 0;
            int failedLevel = 0;
            for (int lod=0; lod<key.Lods.Length; lod++)
            {
                if (lod>0 && key.Lods[lod].Count==0) continue;
                var tris = key.Lods[lod].SelectMany(p=>Faces(area,p).Near(world));
                double uncovered = Unsupported(rim,tris,inv,contact.Position.Z,contact.End.Z,true);
                if (uncovered>worst) { worst=uncovered; failedLevel=lod; }
                if (worst>=best) break;
            }
            if (worst<=AreaTolerance) { reason=""; return true; }
            if (worst<=best)
            {
                best=worst;
                where=$"{key.Name} LOD{failedLevel}";
            }
        }
        reason=$"{where} leaves {best*1e6:F2} mm² without masonry within the flange";
        return false;
    }

    private static Point[] Rectangle(double x0,double y0,double x1,double y1) =>
        new[]{new Point(x0,y0),new Point(x1,y0),new Point(x1,y1),new Point(x0,y1)};

    private static double Area(IReadOnlyList<Point> poly)
    {
        double a=0;
        for(int i=1;i+1<poly.Count;i++) a+=Point.Side(poly[0],poly[i],poly[i+1]);
        return Math.Abs(a)*.5;
    }

    private static double Unsupported(Point[] rim,IEnumerable<Triangle> triangles, Transform3D inv, float minZ,float maxZ,bool visual)
    {
        var remaining = new List<Point[]> {rim};
        double left=rim.Min(p=>p.X), right=rim.Max(p=>p.X), bottom=rim.Min(p=>p.Y), top=rim.Max(p=>p.Y);
        foreach(var t in triangles)
        {
            var a=inv*t.A; var b=inv*t.B; var c=inv*t.C;
            if (MathF.Max(a.X,MathF.Max(b.X,c.X))<left || MathF.Min(a.X,MathF.Min(b.X,c.X))>right ||
                MathF.Max(a.Y,MathF.Max(b.Y,c.Y))<bottom || MathF.Min(a.Y,MathF.Min(b.Y,c.Y))>top ||
                MathF.Max(a.Z,MathF.Max(b.Z,c.Z))<minZ || MathF.Min(a.Z,MathF.Min(b.Z,c.Z))>maxZ) continue;
            var outward=(c-a).Cross(b-a); // Godot front faces are clockwise.
            if (visual && outward.Z<=0 || MathF.Abs(outward.Z)<=.05f*outward.Length()) continue;
            var flat=ClipDepth(ClipDepth(new[]{a,b,c},minZ,true),maxZ,false)
                .Select(p=>new Point(p.X,p.Y)).ToArray();
            if(flat.Length<3) continue;
            if(outward.Z>0) Array.Reverse(flat); // counter-clockwise clip polygon in the mounting plane
            Subtract(remaining,flat);
            if(remaining.Count==0) break;
        }
        return remaining.Sum(Area);
    }

    // A bevelled arch has no continuous rectangular footprint. Prove its actual
    // projected triangles, right out to each arris, on the installed end wall.
    public static (int faces,double worstVisual,double worstSolid,Vector3 spot) FacingCoverage(
        MeshInstance3D facing,MeshInstance3D wall,IEnumerable<CollisionShape3D> solids)
    {
        var inv=facing.GlobalTransform.AffineInverse();
        List<Triangle> InWall(Vector3[] faces,Transform3D pose)
        {
            var mounted=new List<Triangle>();
            var xf=inv*pose;
            for(int i=0;i<faces.Length;i+=3)
            {
                var a=xf*faces[i];var b=xf*faces[i+1];var c=xf*faces[i+2];
                if(MathF.Abs(a.Z)<.002f && MathF.Abs(b.Z)<.002f && MathF.Abs(c.Z)<.002f)
                    mounted.Add(new(a,b,c));
            }
            return mounted;
        }
        var drawn=InWall(wall.Mesh.GetFaces(),wall.GlobalTransform);
        var physical=solids.Where(s=>!s.Disabled && s.Shape is ConcavePolygonShape3D)
            .SelectMany(s=>InWall(((ConcavePolygonShape3D)s.Shape).GetFaces(),s.GlobalTransform)).ToArray();
        var faces=facing.Mesh.GetFaces();
        int tested=0;
        double worstVisual=0,worstSolid=0;
        var spot=Vector3.Zero;
        for(int i=0;i<faces.Length;i+=3)
        {
            var rim=new Point[]{new(faces[i].X,faces[i].Y),new(faces[i+1].X,faces[i+1].Y),new(faces[i+2].X,faces[i+2].Y)};
            if(Area(rim)<1e-12) continue; // a strictly edge-on side projects onto the edge of its bevel
            tested++;
            double v=Unsupported(rim,drawn,Transform3D.Identity,-.002f,.002f,true);
            double p=Unsupported(rim,physical,Transform3D.Identity,-.002f,.002f,false);
            if(v>worstVisual || p>worstSolid) spot=facing.GlobalTransform*((faces[i]+faces[i+1]+faces[i+2])/3);
            worstVisual=Math.Max(v,worstVisual);worstSolid=Math.Max(p,worstSolid);
        }
        return(tested,worstVisual,worstSolid,spot);
    }

    private static List<Vector3> ClipDepth(IReadOnlyList<Vector3> points,float z,bool above)
    {
        var result=new List<Vector3>(5);
        if(points.Count==0) return result;
        var a=points[^1];
        foreach(var b in points)
        {
            bool ina=above?a.Z>=z:a.Z<=z, inb=above?b.Z>=z:b.Z<=z;
            if(ina!=inb) result.Add(a.Lerp(b,(z-a.Z)/(b.Z-a.Z)));
            if(inb) result.Add(b);
            a=b;
        }
        return result;
    }

    // Subtract a convex clipped face from disjoint convex remainders. Never replace their union by a hull:
    // a closed ring of triangles around a hole must preserve the interior hole.
    private static void Subtract(List<Point[]> remaining,Point[] face)
    {
        double x0=face.Min(p=>p.X),x1=face.Max(p=>p.X),y0=face.Min(p=>p.Y),y1=face.Max(p=>p.Y);
        for(int n=remaining.Count-1;n>=0;n--)
        {
            var poly=remaining[n];
            if(poly.All(p=>p.X<=x0)||poly.All(p=>p.X>=x1)||poly.All(p=>p.Y<=y0)||poly.All(p=>p.Y>=y1)) continue;
            var inside=poly;
            var outside=new List<Point[]>();
            var a=face[^1];
            foreach(var b in face)
            {
                if(inside.Length<3) break;
                if (a!=b)
                {
                    var left=new List<Point>(); var right=new List<Point>();
                    var prev=inside[^1];
                    double before=Point.Side(a,b,prev);
                    foreach(var curr in inside)
                    {
                        double here=Point.Side(a,b,curr);
                        if(before*here<0)
                        {
                            var cross=Point.Lerp(prev,curr,before/(before-here));
                            left.Add(cross); right.Add(cross);
                        }
                        if(here>=0)left.Add(curr);
                        if(here<=0)right.Add(curr);
                        prev=curr; before=here;
                    }
                    if(right.Count>=3 && Area(right)>1e-16) outside.Add(right.ToArray());
                    inside=left.ToArray();
                }
                a=b;
            }
            if(inside.Length<3 || Area(inside)<1e-16) continue;
            remaining.RemoveAt(n);
            remaining.AddRange(outside);
        }
    }

    private static void CheckCoverageControls()
    {
        // All corners, screws, and the centre row are backed. A 2 mm square opening between
        // those probes must still be found, even if a second copy of the same wall is present.
        var whole=Rectangle(-.45,-.10,.45,.10);
        var pieces=new[] {Rectangle(-.45,-.10,.103,.10),Rectangle(.105,-.10,.45,.10),
            Rectangle(.103,-.10,.105,.037),Rectangle(.103,.039,.105,.10)};
        var missing=new List<Point[]>{whole};
        foreach(var p in pieces.Concat(pieces)) Subtract(missing,p);
        if(Math.Abs(missing.Sum(Area)-.002*.002)>AreaTolerance)
            throw new InvalidOperationException("Plaque footprint missed its enclosed 2 mm opening");
        Subtract(missing,Rectangle(.103,.037,.105,.039));
        if(missing.Sum(Area)>AreaTolerance) throw new InvalidOperationException("Continuous wall failed footprint control");
        Triangle[] Panel(float depth)
        {
            var bl=new Vector3(-.5f,-.15f,depth); var br=new Vector3(.5f,-.15f,depth);
            var tl=new Vector3(-.5f,.15f,depth); var tr=new Vector3(.5f,.15f,depth);
            return new[]{new Triangle(bl,tl,tr),new Triangle(bl,tr,br)};
        }
        var facing=Panel(-.012f);
        double Gap(IEnumerable<Triangle> faces) => Unsupported(whole,faces,Transform3D.Identity,-.041f,.001f,true);
        if(Gap(facing)>AreaTolerance || Gap(Panel(-.065f))<Area(whole)-AreaTolerance ||
            Gap(facing.Select(t=>new Triangle(t.A,t.C,t.B)))<Area(whole)-AreaTolerance)
            throw new InvalidOperationException("Plaque mounting depth or front-face test failed its controls");
    }
}
